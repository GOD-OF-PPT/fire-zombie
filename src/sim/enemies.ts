import type { EnemyKind, SimEvent, WeaponId } from '../types/game';
import {
  BLADES_DAMAGE,
  BLADES_HIT_COOLDOWN,
  BLADES_HIT_RADIUS,
  BLADES_ORBIT_RADIUS,
  FIXED_DT,
  PLAYER_Z,
  TRACK_HALF_WIDTH,
} from '../config/constants';
import {
  BOMBER_BLAST_DAMAGE,
  BOMBER_BLAST_RADIUS,
  BOMBER_GATE_BONUS,
  BROOD_CHILD_HP,
  BROOD_CHILD_RADIUS,
  BROOD_MAX_SPAWNS,
  BROOD_SPAWN_INTERVAL_SEC,
  DASHER_ARENA_TRIGGER_Z,
  DASHER_BRAKE_VZ,
  DASHER_RUNWAY_TRIGGER_Z,
  ENEMY_CONFIGS,
  HOWLER_AURA_RADIUS,
  HOWLER_PURGE_DAMAGE,
  BEHOLDER_FIRE_INTERVAL_SEC,
  BEHOLDER_MAX_SHOTS,
  BEHOLDER_ORB_SPEED,
  BEHOLDER_TELEGRAPH_SEC,
  BURROWER_SURGE_MULT,
  BURROWER_SURGE_SEC,
  BURROWER_TRIGGER_Z,
  GLACIER_ARMOR_RESIST,
  GLACIER_NOVA_DAMAGE,
  GLACIER_NOVA_RADIUS,
  GLACIER_NOVA_SLOW_SEC,
  HOWLER_PURGE_RADIUS,
  HOWLER_PURGE_SLOW_SEC,
  HOWLER_SPEED_MULT,
  MITOSIS_CHILD_HP,
  NECRO_HEAL_INTERVAL_SEC,
  NECRO_HEAL_RADIUS,
  NECRO_HEAL_RATIO,
  MITOSIS_CHILD_RADIUS,
  MITOSIS_SPLIT_HALF_OFFSET,
  PHALANX_FRONT_LEAK_RATIO,
  PHALANX_SHIELD_HP,
  SIPHON_DRAIN_INTERVAL_SEC,
  SIPHON_KILL_GATE_BONUS,
  SIPHON_MIN_GATE_VALUE,
  STALKER_BLINK_INTERVAL_SEC,
  STALKER_BLINK_SPAN,
} from '../config/enemies';
import { CRYO_BRITTLE_DAMAGE_MULT, CRYO_SLOW_MOVE_SCALE } from '../config/weapons';
import { getEndlessEnemyHpMult } from '../config/endless';
import { hasSynergy } from '../config/protocols';
import { mitigateLossWithAegis } from './aegis';
import { deployReserveIfAvailable, grantBountyJackpot, hasMutator, recordDamage, stepSeekerBlades } from './competition';
import { addNukeKillCharge } from './nuke';
import { triggerFormationLeaderBacklash } from './v21Mechanics';
import { addNirvanaCharge } from './v23Mechanics';
import { allocEntityId, type SimEnemy, type SimWorld } from './entities';
import { applyFlatDeltaToGate, findGateById } from './gates';
import { clamp, clampSquadCount, normalizeZero } from './math';

export interface EnemySpawnOptions {
  hp?: number;
  radius?: number;
  linkedGateId?: number | null;
  mitosisGeneration?: number;
  isSwarmFodder?: boolean;
  customId?: number;
}

export interface DamageEnemyOptions {
  /** True when hit by Rail pierce, Plasma splash, Amplified Lens/Reflector bolt, or Orbital Blades */
  bypassShield?: boolean;
  reflected?: boolean;
  impactX?: number;
  /** Prevents unbounded recursive chain explosions within the same tick */
  chainDepth?: number;
  /** Ballistic weapon caliber for material-accurate impact audio & VFX */
  weapon?: WeaponId;
}

export function spawnEnemy(
  world: SimWorld,
  kind: EnemyKind,
  x: number,
  z: number,
  options: EnemySpawnOptions = {},
): SimEnemy {
  const cfg = ENEMY_CONFIGS[kind];
  const radius = options.radius ?? cfg.radius;
  const clampedX = clamp(x, -TRACK_HALF_WIDTH + radius, TRACK_HALF_WIDTH - radius);

  const enemy = world.enemyPool.acquire();
  enemy.id = options.customId ?? allocEntityId(world);
  enemy.kind = kind;
  enemy.shieldImpactX = 0;
  enemy.flankTargetX = undefined;
  enemy.anchoredGuard = false;
  enemy.prevX = normalizeZero(clampedX);
  enemy.prevZ = z;
  enemy.x = normalizeZero(clampedX);
  enemy.z = z;
  enemy.radius = radius;
  const endlessHpMult = world.endless ? getEndlessEnemyHpMult(world.endless.wave) : 1;
  enemy.maxHp = Math.max(1, Math.round((options.hp ?? cfg.hp) * endlessHpMult));
  enemy.hp = enemy.maxHp;
  const shieldScale = options.hp !== undefined ? Math.max(0.25, options.hp / cfg.hp) : 1;
  enemy.maxShieldHp =
    kind === 'phalanx' ? Math.max(8, Math.round(PHALANX_SHIELD_HP * shieldScale * endlessHpMult)) : 0;
  enemy.shieldHp = enemy.maxShieldHp;
  enemy.specialAcc = 0;
  enemy.specialCount = 0;
  enemy.frenzyBuffed = false;
  enemy.slowTimer = 0;
  enemy.telegraphTimer = 0;
  enemy.dasherState = 'APPROACH';
  enemy.linkedGateId = options.linkedGateId ?? null;
  enemy.siphonDrainAcc = 0;
  enemy.mitosisGeneration = options.mitosisGeneration ?? 0;
  enemy.bladeHitCooldown = 0;
  enemy.hitPulse = 0;
  enemy.isSwarmFodder = options.isSwarmFodder === true;
  enemy.formationId = undefined;
  enemy.formationKind = undefined;
  enemy.isFormationLeader = false;
  enemy.consumed = false;
  enemy.bypassed = false;
  enemy.active = true;

  // If a siphon spawns without an explicit linkedGateId, link to nearest mutable gate behind it
  if (kind === 'siphon' && enemy.linkedGateId === null) {
    let bestGateId: number | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < world.gates.length; i++) {
      const g = world.gates[i];
      if (
        g &&
        g.active &&
        g.mutable &&
        !g.isLockFlip &&
        !g.triggered &&
        !g.dimmed &&
        g.z <= enemy.z + 1.0 &&
        Math.abs(g.x - enemy.x) <= 2.8
      ) {
        const d = Math.hypot(g.x - enemy.x, g.z - enemy.z);
        if (d < bestDist) {
          bestDist = d;
          bestGateId = g.id;
        }
      }
    }
    enemy.linkedGateId = bestGateId;
  }

  world.enemies.push(enemy);
  return enemy;
}

/**
 * Applies combat damage to an enemy (with Cryo brittle amplification, Phalanx directional energy shield,
 * Mitosis combat-kill split, Corruptor Siphon +6 gate injection, Volatile Bomber AoE detonation,
 * and Frenzy Howler sonic purge backlash).
 * Returns true if the hit killed the enemy.
 */
export function damageEnemy(
  world: SimWorld,
  enemy: SimEnemy,
  rawDamage: number,
  cryoSlowDuration: number,
  events: SimEvent[],
  opts: DamageEnemyOptions = {},
): boolean {
  if (!enemy.active || enemy.consumed || enemy.bypassed || enemy.hp <= 0 || rawDamage <= 0) {
    return false;
  }

  const damageAmp = enemy.slowTimer > 0 ? CRYO_BRITTLE_DAMAGE_MULT : 1.0;
  let effectiveDamage = rawDamage * damageAmp;

  // Cryo-Colossus permafrost crystal shell shrugs off light non-thermal/non-piercing fire
  if (
    enemy.kind === 'glacier' &&
    !opts.bypassShield &&
    opts.weapon !== 'plasma' &&
    opts.weapon !== 'rail'
  ) {
    effectiveDamage *= GLACIER_ARMOR_RESIST;
  }

  // Aegis Phalanx directional energy shield mechanics
  if (enemy.kind === 'phalanx' && enemy.shieldHp > 0) {
    if (opts.impactX !== undefined) enemy.shieldImpactX = clamp((opts.impactX - enemy.x) / enemy.radius, -1, 1);
    if (enemy.anchoredGuard) {
      // A braced sentry absorbs frontal fire. Shots through the marked mirror strike the hinges.
      effectiveDamage = opts.reflected
        ? Math.max(effectiveDamage, enemy.maxShieldHp * 0.12)
        : effectiveDamage * 0.28;
    }
    if (opts.bypassShield) {
      enemy.shieldHp = Math.max(0, enemy.shieldHp - effectiveDamage * 1.6);
      if (enemy.shieldHp <= 0) {
        enemy.shieldHp = 0;
        enemy.slowTimer = Math.max(enemy.slowTimer, 0.9);
        events.push({ type: 'SHIELD_BREAK', enemyId: enemy.id, x: enemy.x, z: enemy.z, reflected: opts.reflected });
      }
    } else {
      const absorbed = effectiveDamage * (1 - PHALANX_FRONT_LEAK_RATIO);
      const prevShield = enemy.shieldHp;
      enemy.shieldHp = Math.max(0, prevShield - absorbed);
      const spill = Math.max(0, absorbed - prevShield);
      effectiveDamage = effectiveDamage * PHALANX_FRONT_LEAK_RATIO + spill;
      if (prevShield > 0 && enemy.shieldHp <= 0) {
        enemy.shieldHp = 0;
        enemy.slowTimer = Math.max(enemy.slowTimer, 0.9);
        events.push({ type: 'SHIELD_BREAK', enemyId: enemy.id, x: enemy.x, z: enemy.z, reflected: opts.reflected });
      }
    }
  }

  const prevHp = enemy.hp;
  enemy.hp = Math.max(0, prevHp - effectiveDamage);
  enemy.hitPulse = 1.0;

  if (
    enemy.hp > 0 &&
    !enemy.armorBroken &&
    prevHp > enemy.maxHp * 0.5 &&
    enemy.hp <= enemy.maxHp * 0.5 &&
    ENEMY_CONFIGS[enemy.kind].tier >= 3
  ) {
    enemy.armorBroken = true;
    events.push({ type: 'ENEMY_ARMOR_BREAK', kind: enemy.kind, x: enemy.x, z: enemy.z });
  }

  if (cryoSlowDuration > 0 && enemy.hp > 0 && enemy.kind !== 'glacier') {
    enemy.slowTimer = Math.max(enemy.slowTimer, cryoSlowDuration);
  }

  const fatal = enemy.hp <= 0;
  events.push({
    type: 'ENEMY_HIT',
    x: enemy.x,
    z: enemy.z,
    fatal,
    kind: enemy.kind,
    damage: Math.max(1, Math.round(effectiveDamage)),
    hpRatio: fatal ? 0 : Math.max(0, Math.min(1, enemy.hp / Math.max(1, enemy.maxHp))),
    ...(opts.weapon ? { weapon: opts.weapon } : {}),
  });

  if (fatal) {
    const killedX = enemy.x;
    const killedZ = enemy.z;
    const killedId = enemy.id;
    const chainDepth = opts.chainDepth ?? 0;
    enemy.hp = 0;
    enemy.shieldHp = 0;
    enemy.consumed = true;
    enemy.active = false;
    world.stats.kills += 1;
    addNukeKillCharge(world);
    addNirvanaCharge(world, ENEMY_CONFIGS[enemy.kind].tier >= 3 ? 0.030 : 0.012);
    if (world.mods.manualOverdrive && !world.mods.fairTrial && world.overdriveTimer <= 0) {
      world.resonance = Math.min(1.0, world.resonance + 0.005 * world.mods.resonanceMult);
    }

    if (enemy.isBountyElite) {
      grantBountyJackpot(world, killedX, killedZ, events);
    }
    if (enemy.isFormationLeader && (opts.chainDepth ?? 0) < 2) {
      triggerFormationLeaderBacklash(world, enemy, events);
    }

    // Stack live Rampage Frenzy (+attack speed & Chain-Lightning overdrive procs!)
    const skipUnmoddedBossFodderRamp =
      enemy.isSwarmFodder &&
      ((world.boss !== null && world.boss.active && !world.boss.hasMetaPower) || (world.sector === 1 && world.scrollDistance > 600 && world.mods.damageMult <= 1.02)) &&
      !world.mods.blitz &&
      world.endless === null;
    let rampAdvanced = false;
    if (!skipUnmoddedBossFodderRamp) {
      world.rampageTimer = 2.6;
      world.rampageStacks = Math.min(60, world.rampageStacks + 1);
      world.rampageKillCounter = (world.rampageKillCounter ?? 0) + 1;
      rampAdvanced = true;
    }

    const arcStride = world.rampageStacks >= 24 ? 3 : 5;
    if (rampAdvanced && world.rampageStacks >= 5 && world.rampageKillCounter % arcStride === 0) {
      const arcDmg = (12 + world.squadCount * 0.28) * world.mods.damageMult;
      let jumps = 0;
      const snapshotLen = world.enemies.length;
      for (let k = 0; k < snapshotLen && jumps < 3; k++) {
        const other = world.enemies[k];
        if (!other || !other.active || other.consumed || other.bypassed || other.hp <= 0 || other.id === killedId) {
          continue;
        }
        if (Math.hypot(other.x - killedX, other.z - killedZ) <= 5.2) {
          jumps += 1;
          events.push({
            type: 'CHAIN_ARC',
            fromX: killedX,
            fromZ: killedZ,
            toX: other.x,
            toZ: other.z,
            damage: Math.max(1, Math.round(arcDmg)),
          });
          recordDamage(world, 'fusions', Math.min(other.hp, arcDmg));
          other.hp = Math.max(0, other.hp - arcDmg);
          other.hitPulse = 1.0;
          if (other.hp <= 0) {
            other.hp = 0;
            other.shieldHp = 0;
            other.consumed = true;
            other.active = false;
            world.stats.kills += 1;
            addNukeKillCharge(world, 0.005);
            addNirvanaCharge(world, 0.008);
            events.push({
              type: 'ENEMY_HIT',
              x: other.x,
              z: other.z,
              fatal: true,
              kind: other.kind,
              damage: Math.max(1, Math.round(arcDmg)),
            });
          }
        }
      }
    }

    // Corruptor Siphon on-kill +6 gate injection
    if (enemy.kind === 'siphon' && enemy.linkedGateId !== null) {
      const linkedGate = findGateById(world, enemy.linkedGateId);
      if (linkedGate && !linkedGate.triggered && !linkedGate.dimmed && linkedGate.z < PLAYER_Z) {
        applyFlatDeltaToGate(world, linkedGate, SIPHON_KILL_GATE_BONUS, true, events);
      }
      enemy.linkedGateId = null;
    }

    // Mitosis Node combat-kill split (generation 0 ONLY; children inherit proportional scaled HP so they aren't 1-shot!)
    if (enemy.kind === 'mitosis' && enemy.mitosisGeneration === 0) {
      const margin = MITOSIS_SPLIT_HALF_OFFSET + MITOSIS_CHILD_RADIUS;
      const safeCenter = clamp(enemy.x, -TRACK_HALF_WIDTH + margin, TRACK_HALF_WIDTH - margin);
      const childHp = Math.max(MITOSIS_CHILD_HP, Math.round(enemy.maxHp * 0.34));
      spawnEnemy(world, 'crawler', safeCenter - MITOSIS_SPLIT_HALF_OFFSET, enemy.z, {
        hp: childHp,
        radius: MITOSIS_CHILD_RADIUS,
        mitosisGeneration: 1,
        isSwarmFodder: enemy.isSwarmFodder,
      });
      spawnEnemy(world, 'crawler', safeCenter + MITOSIS_SPLIT_HALF_OFFSET, enemy.z, {
        hp: childHp,
        radius: MITOSIS_CHILD_RADIUS,
        mitosisGeneration: 1,
        isSwarmFodder: enemy.isSwarmFodder,
      });
    }

    // Volatile Bomber pressurized bio-tank AoE blast + nearby mutable gate +2 boost!
    if (enemy.kind === 'bomber' && chainDepth < 3) {
      const blastDmg = BOMBER_BLAST_DAMAGE * world.mods.damageMult;
      let blastKills = 0;
      const snapCount = world.enemies.length;
      for (let k = 0; k < snapCount; k++) {
        const other = world.enemies[k];
        if (!other || !other.active || other.consumed || other.bypassed || other.hp <= 0 || other.id === killedId) {
          continue;
        }
        if (Math.hypot(other.x - killedX, other.z - killedZ) <= BOMBER_BLAST_RADIUS + other.radius) {
          recordDamage(world, 'explosives', Math.min(other.hp, blastDmg));
          if (damageEnemy(world, other, blastDmg, 0, events, { bypassShield: true, chainDepth: chainDepth + 1 })) {
            blastKills += 1;
          }
        }
      }
      for (let gIdx = 0; !enemy.isSwarmFodder && gIdx < world.gates.length; gIdx++) {
        const g = world.gates[gIdx];
        if (
          g &&
          g.active &&
          g.mutable &&
          !g.isLockFlip &&
          !g.triggered &&
          !g.dimmed &&
          g.z < PLAYER_Z &&
          Math.hypot(g.x - killedX, g.z - killedZ) <= 3.6
        ) {
          applyFlatDeltaToGate(world, g, BOMBER_GATE_BONUS, true, events);
        }
      }
      events.push({ type: 'BOMBER_BLAST', x: killedX, z: killedZ, kills: blastKills });
    }

    // Frenzy Howler sonic totem shatter -> chills & shocks nearby pack!
    if (enemy.kind === 'howler' && chainDepth < 2) {
      const shockDmg = HOWLER_PURGE_DAMAGE * world.mods.damageMult;
      let stunned = 0;
      const snapCount = world.enemies.length;
      for (let k = 0; k < snapCount; k++) {
        const other = world.enemies[k];
        if (!other || !other.active || other.consumed || other.bypassed || other.hp <= 0 || other.id === killedId) {
          continue;
        }
        if (Math.hypot(other.x - killedX, other.z - killedZ) <= HOWLER_PURGE_RADIUS + other.radius) {
          stunned += 1;
          other.slowTimer = Math.max(other.slowTimer, HOWLER_PURGE_SLOW_SEC);
          recordDamage(world, 'explosives', Math.min(other.hp, shockDmg));
          damageEnemy(world, other, shockDmg, HOWLER_PURGE_SLOW_SEC, events, {
            bypassShield: true,
            chainDepth: chainDepth + 1,
          });
        }
      }
      events.push({ type: 'HOWLER_PURGE', x: killedX, z: killedZ, stunned });
    }

    // Cryo-Colossus permafrost core shatter -> freezes & brittles nearby horde!
    if (enemy.kind === 'glacier' && chainDepth < 2) {
      const novaDmg = GLACIER_NOVA_DAMAGE * world.mods.damageMult;
      let chilled = 0;
      const snapCount = world.enemies.length;
      for (let k = 0; k < snapCount; k++) {
        const other = world.enemies[k];
        if (!other || !other.active || other.consumed || other.bypassed || other.hp <= 0 || other.id === killedId) {
          continue;
        }
        if (Math.hypot(other.x - killedX, other.z - killedZ) <= GLACIER_NOVA_RADIUS + other.radius) {
          chilled += 1;
          if (other.kind !== 'glacier') {
            other.slowTimer = Math.max(other.slowTimer, GLACIER_NOVA_SLOW_SEC);
          }
          recordDamage(world, 'explosives', Math.min(other.hp, novaDmg));
          damageEnemy(world, other, novaDmg, GLACIER_NOVA_SLOW_SEC, events, {
            bypassShield: true,
            chainDepth: chainDepth + 1,
          });
        }
      }
      events.push({ type: 'GLACIER_NOVA', x: killedX, z: killedZ, chilled });
    }

    // Nano-Weaver reactor overload -> refunds squad Resonance & Nuke charge!
    if (enemy.kind === 'necromancer') {
      const resGain = enemy.isSwarmFodder ? (world.mods.damageMult > 1.02 || world.sector >= 2 ? 0.02 : 0) : 0.045;
      world.resonance = Math.min(1, world.resonance + resGain * world.mods.resonanceMult);
      addNukeKillCharge(world, 0.006);
    }
  }

  return fatal;
}

/**
 * Step 3c: Close-range Orbital Bit-Blades defense ring around (squadX, PLAYER_Z).
 */
export function stepOrbitalBlades(world: SimWorld, events: SimEvent[]): void {
  if (stepSeekerBlades(world, events)) return;
  if (world.bladesCount <= 0 || world.squadCount <= 0) {
    return;
  }

  const count = world.bladesCount;
  for (let eIdx = 0; eIdx < world.enemies.length; eIdx++) {
    const enemy = world.enemies[eIdx];
    if (!enemy || !enemy.active || enemy.consumed || enemy.bypassed || enemy.hp <= 0) {
      continue;
    }
    if (enemy.bladeHitCooldown > 0) {
      continue;
    }

    for (let b = 0; b < count; b++) {
      const theta = world.bladesAngle + (b * Math.PI * 2) / count;
      const bx = world.squadX + Math.cos(theta) * BLADES_ORBIT_RADIUS;
      const bz = PLAYER_Z + Math.sin(theta) * BLADES_ORBIT_RADIUS;
      const dist = Math.hypot(enemy.x - bx, enemy.z - bz);
      if (dist <= BLADES_HIT_RADIUS + enemy.radius) {
        enemy.bladeHitCooldown = BLADES_HIT_COOLDOWN;
        const bladeMult = hasSynergy(world.endless?.upgrades, 'tempest_blades') ? 1.4 : 1.0;
        recordDamage(world, 'blades', Math.min(enemy.hp, BLADES_DAMAGE * bladeMult));
        damageEnemy(world, enemy, BLADES_DAMAGE * bladeMult, 0, events, { bypassShield: true });
        break;
      }
    }
  }
}

const _howlersScratch: Array<{ id: number; x: number; z: number }> = [];
const QUEUE_LANE_COUNT = 8;
const _queueLanes: SimEnemy[][] = Array.from({ length: QUEUE_LANE_COUNT }, () => []);

/**
 * O(N) longitudinal lane-queue organizer: keeps swarm fodder ranks cleanly spaced in 9 highway
 * columns from the front line all the way back to -142u in the horizon (zero clumping/overlapping),
 * without altering isolated scripted encounter unit trajectories.
 */
function enforceRunwayQueueSpacing(world: SimWorld): void {
  if (world.enemies.length < 6) return;
  for (let l = 0; l < QUEUE_LANE_COUNT; l++) {
    _queueLanes[l]!.length = 0;
  }
  const fullWidth = TRACK_HALF_WIDTH * 2;
  const maxLateral = TRACK_HALF_WIDTH - 0.48;
  for (let i = 0; i < world.enemies.length; i++) {
    const e = world.enemies[i];
    if (
      !e ||
      !e.active ||
      e.consumed ||
      e.bypassed ||
      e.hp <= 0 ||
      (e.kind === 'dasher' && e.dasherState === 'DASH')
    ) {
      continue;
    }
    const normX = (e.x + TRACK_HALF_WIDTH) / fullWidth;
    const laneIdx = clamp(Math.floor(normX * QUEUE_LANE_COUNT), 0, QUEUE_LANE_COUNT - 1);
    _queueLanes[laneIdx]!.push(e);
  }

  // Pass 1: Longitudinal spacing for collinear stacks + intra-corridor 2D organic lateral spread
  for (let l = 0; l < QUEUE_LANE_COUNT; l++) {
    const lane = _queueLanes[l]!;
    if (lane.length < 2) continue;
    lane.sort((a, b) => b.z - a.z || a.id - b.id);
    for (let k = 1; k < lane.length; k++) {
      const front = lane[k - 1]!;
      const cur = lane[k]!;
      const canAdjustCur =
        cur.isSwarmFodder ||
        (world.playerHasSteered && world.enemies.length >= 8 && cur.linkedGateId === null && cur.telegraphTimer <= 0 && !cur.isBountyElite);
      if (!canAdjustCur) continue;
      const dx = cur.x - front.x;
      const absDx = Math.abs(dx);
      const sumR = front.radius + cur.radius;
      // Smooth 2D radial soft-repulsion scaled for large V9 3D monster bodies so giant silhouettes never clip!
      if (absDx < sumR * 2.08) {
        const dz = front.z - cur.z;
        if (dz < sumR * 2.35) {
          const dir = absDx > 0.015 ? (dx > 0 ? 1 : -1) : cur.id % 2 === 0 ? 1 : -1;
          const pushX = Math.min(0.21, (sumR * 2.08 - absDx) * 0.38);
          if (front.isSwarmFodder) {
            front.x = clamp(front.x - dir * pushX * 0.5, -maxLateral, maxLateral);
            cur.x = clamp(cur.x + dir * pushX * 0.5, -maxLateral, maxLateral);
          } else {
            cur.x = clamp(cur.x + dir * pushX, -maxLateral, maxLateral);
          }
        }
      }
      // Guarantee smooth longitudinal breathing room without rigid train-car stacking
      const lateralClearance = Math.abs(cur.x - front.x);
      const minGap =
        lateralClearance < 0.02
          ? sumR * 1.52 + 1.1
          : Math.max(0.92, (sumR * 1.52 + 1.0) * (1 - Math.min(0.68, lateralClearance / 1.42)));
      const maxAllowedZ = front.z - minGap;
      if (cur.z > maxAllowedZ) {
        cur.z = Math.max(-166, maxAllowedZ);
      }
    }
  }

  // Pass 2: Cross-corridor boundary 2D soft-separation so adjacent lane borders never blob together
  for (let l = 0; l < QUEUE_LANE_COUNT - 1; l++) {
    const leftLane = _queueLanes[l]!;
    const rightLane = _queueLanes[l + 1]!;
    if (leftLane.length === 0 || rightLane.length === 0) continue;
    let rStart = 0;
    for (let i = 0; i < leftLane.length; i++) {
      const a = leftLane[i]!;
      while (rStart < rightLane.length && rightLane[rStart]!.z > a.z + 2.4) {
        rStart++;
      }
      for (let j = rStart; j < rightLane.length; j++) {
        const b = rightLane[j]!;
        if (b.z < a.z - 2.4) break;
        if (!a.isSwarmFodder && !b.isSwarmFodder) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const minSep = (a.radius + b.radius) * 1.86;
        const distSq = dx * dx + dz * dz;
        if (distSq > 1e-6 && distSq < minSep * minSep) {
          const dist = Math.sqrt(distSq);
          const overlap = Math.min(0.14, (minSep - dist) * 0.36);
          const nx = dx / dist;
          if (a.isSwarmFodder && b.isSwarmFodder) {
            a.x = clamp(a.x - nx * overlap * 0.5, -maxLateral, maxLateral);
            b.x = clamp(b.x + nx * overlap * 0.5, -maxLateral, maxLateral);
          } else if (a.isSwarmFodder) {
            a.x = clamp(a.x - nx * overlap, -maxLateral, maxLateral);
          } else {
            b.x = clamp(b.x + nx * overlap, -maxLateral, maxLateral);
          }
        }
      }
    }
  }
}

/**
 * Step 4b: Advances all active enemy positions, timers, Vector Dasher 0.65s
 * laser telegraphs, Corruptor Siphon -1/s gate drains, Phase Stalker lateral blinks,
 * Brood Carrier swarmling hatches, and Frenzy Howler pack speed auras.
 */
export function stepEnemiesAI(world: SimWorld, events: SimEvent[]): void {
  const onRunway = world.currentScrollSpeed > 0;

  _howlersScratch.length = 0;
  for (let i = 0; i < world.enemies.length; i++) {
    const e = world.enemies[i];
    if (e && e.active && !e.consumed && !e.bypassed && e.hp > 0 && e.kind === 'howler') {
      _howlersScratch.push({ id: e.id, x: e.x, z: e.z });
    }
  }

  const initialCount = world.enemies.length;
  for (let i = 0; i < initialCount; i++) {
    const enemy = world.enemies[i];
    if (!enemy || !enemy.active || enemy.consumed) {
      continue;
    }

    enemy.prevX = enemy.x;
    enemy.prevZ = enemy.z;
    enemy.frenzyBuffed = false;

    if (enemy.bladeHitCooldown > 0) {
      const nextBladeCd = enemy.bladeHitCooldown - FIXED_DT;
      enemy.bladeHitCooldown = nextBladeCd <= 1e-9 ? 0 : nextBladeCd;
    }

    const isChilled = enemy.slowTimer > 0;
    const speedScale = isChilled ? CRYO_SLOW_MOVE_SCALE : 1.0;
    if (enemy.slowTimer > 0) {
      const nextSlow = enemy.slowTimer - FIXED_DT;
      enemy.slowTimer = nextSlow <= 1e-9 ? 0 : nextSlow;
    }

    if (enemy.kind !== 'howler' && _howlersScratch.length > 0 && !enemy.bypassed) {
      for (let h = 0; h < _howlersScratch.length; h++) {
        const hw = _howlersScratch[h]!;
        if (Math.hypot(enemy.x - hw.x, enemy.z - hw.z) <= HOWLER_AURA_RADIUS + enemy.radius) {
          enemy.frenzyBuffed = true;
          break;
        }
      }
    }

    const cfg = ENEMY_CONFIGS[enemy.kind];
    const baseVz = onRunway ? world.currentScrollSpeed + cfg.runwayMarchOffset : cfg.arenaSpeed;
    // Steady uniform column cadence (eliminates the z=-11 brake-check pileup so columns stay evenly queued!)
    const stampedeScale = enemy.isSwarmFodder && world.squadCount >= 24 ? 1.06 : 1.0;
    const frenzyScale = enemy.frenzyBuffed ? HOWLER_SPEED_MULT : 1.0;
    let vz = baseVz * speedScale * stampedeScale * frenzyScale;

    if (enemy.kind === 'dasher') {
      const triggerZ = onRunway ? DASHER_RUNWAY_TRIGGER_Z : DASHER_ARENA_TRIGGER_Z;
      if (enemy.dasherState === 'APPROACH' && enemy.z >= triggerZ && !enemy.bypassed) {
        enemy.dasherState = 'TELEGRAPH';
        enemy.telegraphTimer = cfg.dashTelegraphSec;
      }

      if (enemy.dasherState === 'TELEGRAPH') {
        vz = DASHER_BRAKE_VZ * speedScale;
        const nextTelegraph = enemy.telegraphTimer - FIXED_DT;
        enemy.telegraphTimer = nextTelegraph <= 1e-9 ? 0 : nextTelegraph;
        if (enemy.telegraphTimer <= 0) {
          enemy.telegraphTimer = 0;
          enemy.dasherState = 'DASH';
        }
      } else if (enemy.dasherState === 'DASH') {
        vz = cfg.dashSpeedMultiplier * Math.max(14.0, baseVz) * speedScale * frenzyScale;
      }
    }

    // Tunnel Ripper (burrower) molten breach surge at mid-runway
    if (enemy.kind === 'burrower' && !enemy.bypassed) {
      if (enemy.specialCount === 0 && !isChilled && enemy.z >= BURROWER_TRIGGER_Z && enemy.z < PLAYER_Z - 5.5) {
        enemy.specialCount = 1;
        enemy.specialAcc = BURROWER_SURGE_SEC;
        events.push({ type: 'BURROW_ERUPT', x: enemy.x, z: enemy.z });
      }
      if (enemy.specialCount === 1 && enemy.specialAcc > 0) {
        enemy.specialAcc = Math.max(0, enemy.specialAcc - FIXED_DT);
        if (!isChilled) {
          vz *= BURROWER_SURGE_MULT;
          const steer = (world.playerHasSteered || world.mods.blitz || world.endless !== null ? clamp(world.squadX - enemy.x, -1.25, 1.25) : 0) * FIXED_DT;
          const limit = TRACK_HALF_WIDTH - enemy.radius - 0.25;
          enemy.x = normalizeZero(clamp(enemy.x + steer, -limit, limit));
        }
      }
    }

    if (enemy.flankTargetX !== undefined) {
      const step = (enemy.anchoredGuard ? 2.0 : 4.4) * FIXED_DT;
      const dx = clamp(enemy.flankTargetX - enemy.x, -step, step);
      enemy.x = normalizeZero(enemy.x + dx * speedScale);
    }
    if (enemy.anchoredGuard && enemy.shieldHp > 0) vz = world.currentScrollSpeed;
    enemy.z += vz * FIXED_DT;

    // Phase Stalker lateral blink (disabled while Cryo-chilled!)
    if (
      enemy.kind === 'stalker' &&
      !isChilled &&
      !enemy.bypassed &&
      enemy.z > PLAYER_Z - 48 &&
      enemy.z < PLAYER_Z - 4.8
    ) {
      enemy.specialAcc += FIXED_DT;
      if (enemy.specialAcc >= STALKER_BLINK_INTERVAL_SEC - 1e-9) {
        enemy.specialAcc = 0;
        const fromX = enemy.x;
        const limit = TRACK_HALF_WIDTH - enemy.radius - 0.25;
        let dir = (enemy.id + enemy.specialCount) % 2 === 0 ? 1 : -1;
        if (fromX + dir * STALKER_BLINK_SPAN > limit) dir = -1;
        else if (fromX + dir * STALKER_BLINK_SPAN < -limit) dir = 1;
        const toX = normalizeZero(clamp(fromX + dir * STALKER_BLINK_SPAN, -limit, limit));
        enemy.x = toX;
        enemy.prevX = toX;
        enemy.specialCount += 1;
        events.push({ type: 'PHASE_BLINK', fromX, toX, z: enemy.z });
      }
    }

    // Brood Carrier periodic swarmling hatch
    if (
      enemy.kind === 'brood' &&
      !enemy.bypassed &&
      enemy.specialCount < BROOD_MAX_SPAWNS &&
      enemy.z > PLAYER_Z - 50 &&
      enemy.z < PLAYER_Z - 7.5 &&
      world.enemies.length < 295
    ) {
      enemy.specialAcc += FIXED_DT * speedScale;
      if (enemy.specialAcc >= BROOD_SPAWN_INTERVAL_SEC - 1e-9) {
        enemy.specialAcc = 0;
        enemy.specialCount += 1;
        const margin = 0.85 + BROOD_CHILD_RADIUS;
        const cx = clamp(enemy.x, -TRACK_HALF_WIDTH + margin, TRACK_HALF_WIDTH - margin);
        const hatchHp = Math.max(BROOD_CHILD_HP, Math.round(enemy.maxHp * 0.16));
        spawnEnemy(world, 'crawler', cx - 0.85, enemy.z + 0.75, {
          hp: hatchHp,
          radius: BROOD_CHILD_RADIUS,
          mitosisGeneration: 1,
          isSwarmFodder: true,
        });
        spawnEnemy(world, 'crawler', cx + 0.85, enemy.z + 0.75, {
          hp: hatchHp,
          radius: BROOD_CHILD_RADIUS,
          mitosisGeneration: 1,
          isSwarmFodder: true,
        });
        events.push({ type: 'BROOD_SPAWN', x: enemy.x, z: enemy.z, count: 2 });
      }
    }

    // Prism Watcher (beholder) optic lock-on & dodgeable hostile plasma shot
    if (
      enemy.kind === 'beholder' &&
      !enemy.bypassed &&
      enemy.specialCount < BEHOLDER_MAX_SHOTS &&
      enemy.z > PLAYER_Z - 42 &&
      enemy.z < PLAYER_Z - 11.5
    ) {
      if (isChilled) {
        enemy.telegraphTimer = 0;
      } else {
        enemy.specialAcc += FIXED_DT;
        const rem = BEHOLDER_FIRE_INTERVAL_SEC - enemy.specialAcc;
        enemy.telegraphTimer = rem <= BEHOLDER_TELEGRAPH_SEC && rem > 0 ? rem : 0;
        if (enemy.specialAcc >= BEHOLDER_FIRE_INTERVAL_SEC - 1e-9) {
          enemy.specialAcc = 0;
          enemy.telegraphTimer = 0;
          enemy.specialCount += 1;
          let activeHostile = 0;
          for (let pIdx = 0; pIdx < world.projectiles.length; pIdx++) {
            const pr = world.projectiles[pIdx];
            if (pr && pr.active && pr.hostile) activeHostile++;
          }
          if (activeHostile < 4 && world.squadCount >= 5) {
            const orb = world.projectilePool.acquire();
            orb.id = allocEntityId(world);
            orb.prevX = normalizeZero(enemy.x);
            orb.prevZ = enemy.z + 0.55;
            orb.x = normalizeZero(enemy.x);
            orb.z = enemy.z + 0.55;
            const aimDx = clamp((world.squadX - enemy.x) * 0.42, -3.1, 3.1);
            orb.vx = aimDx;
            orb.vz = BEHOLDER_ORB_SPEED;
            orb.radius = 0.3;
            orb.weapon = 'plasma';
            orb.damage = 0;
            orb.remainingPierce = 0;
            orb.amplified = false;
            orb.powerScale = 0.95;
            orb.hostile = true;
            orb.hostileLoss = 3;
            orb.distanceTraveled = 0;
            orb.maxRange = 46.0;
            orb.splashRadius = 0;
            orb.splashDamageRatio = 0;
            orb.cryoSlowDuration = 0;
            orb.sweepStartFraction = 0;
            orb.active = true;
            world.projectiles.push(orb);
            events.push({ type: 'WATCHER_SHOT', x: enemy.x, z: enemy.z });
          }
        }
      }
    } else if (enemy.kind === 'beholder') {
      enemy.telegraphTimer = 0;
    }

    // Nano-Weaver (necromancer) periodic emerald bio-repair wave
    if (
      enemy.kind === 'necromancer' &&
      !isChilled &&
      !enemy.bypassed &&
      enemy.z > PLAYER_Z - 48 &&
      enemy.z < PLAYER_Z - 6.5
    ) {
      enemy.specialAcc += FIXED_DT;
      if (enemy.specialAcc >= NECRO_HEAL_INTERVAL_SEC - 1e-9) {
        enemy.specialAcc = 0;
        enemy.specialCount += 1;
        let healed = 0;
        for (let k = 0; k < world.enemies.length && healed < 4; k++) {
          const ally = world.enemies[k];
          if (
            !ally ||
            !ally.active ||
            ally.consumed ||
            ally.bypassed ||
            ally.hp <= 0 ||
            ally.id === enemy.id ||
            ally.hp >= ally.maxHp
          ) {
            continue;
          }
          if (Math.hypot(ally.x - enemy.x, ally.z - enemy.z) <= NECRO_HEAL_RADIUS + ally.radius) {
            const restore = Math.max(3, Math.round(ally.maxHp * NECRO_HEAL_RATIO));
            ally.hp = Math.min(ally.maxHp, ally.hp + restore);
            ally.hitPulse = Math.max(ally.hitPulse, 0.38);
            healed += 1;
          }
        }
        if (healed > 0) {
          events.push({ type: 'NECRO_HEAL', x: enemy.x, z: enemy.z, healed });
        }
      }
    }

    // Corruptor Siphon -1/s gate drain down to floor -30
    if (enemy.kind === 'siphon' && enemy.linkedGateId !== null && !enemy.bypassed) {
      const gate = findGateById(world, enemy.linkedGateId);
      if (
        !gate ||
        !gate.active ||
        gate.triggered ||
        gate.dimmed ||
        gate.z >= PLAYER_Z ||
        enemy.z >= PLAYER_Z
      ) {
        enemy.linkedGateId = null;
      } else {
        enemy.siphonDrainAcc += FIXED_DT;
        while (enemy.siphonDrainAcc >= SIPHON_DRAIN_INTERVAL_SEC - 1e-9) {
          const nextAcc = enemy.siphonDrainAcc - SIPHON_DRAIN_INTERVAL_SEC;
          enemy.siphonDrainAcc = nextAcc <= 1e-9 ? 0 : nextAcc;
          if (gate.value > SIPHON_MIN_GATE_VALUE) {
            applyFlatDeltaToGate(world, gate, -1, false, events);
          }
        }
      }
    }
  }

  enforceRunwayQueueSpacing(world);
}

/**
 * Step 9a: Swept PLAYER_Z enemy breach vs clean lateral dodge.
 * Returns true if squadCount reached 0 and transitioned to DEFEAT.
 */
export function resolveEnemyBreaches(world: SimWorld, events: SimEvent[]): boolean {
  for (let i = 0; i < world.enemies.length; i++) {
    const enemy = world.enemies[i];
    if (!enemy || !enemy.active || enemy.consumed || enemy.bypassed || enemy.hp <= 0) {
      continue;
    }

    if (enemy.prevZ < PLAYER_Z && enemy.z >= PLAYER_Z) {
      const dz = enemy.z - enemy.prevZ;
      const t = dz > 1e-9 ? clamp((PLAYER_Z - enemy.prevZ) / dz, 0, 1) : 1;
      const enemyCrossX = enemy.prevX + (enemy.x - enemy.prevX) * t;
      const squadCrossX = world.prevSquadX + (world.squadX - world.prevSquadX) * t;

      if (world.squadAirY > 0.6) {
        enemy.bypassed = true;
        enemy.linkedGateId = null;
        enemy.telegraphTimer = 0;
        continue;
      }
      const hitMain = Math.abs(enemyCrossX - squadCrossX) <= world.formationRadius + enemy.radius;
      const hitMirror =
        !hitMain &&
        hasMutator(world, 'mirror_twin') &&
        Math.abs(squadCrossX) > 0.45 &&
        Math.abs(enemyCrossX - -squadCrossX) <= world.formationRadius * 0.85 + enemy.radius;
      if (hitMain || hitMirror) {
        enemy.consumed = true;
        enemy.active = false;
        enemy.linkedGateId = null;
        enemy.telegraphTimer = 0;

        if (enemy.isSwarmFodder) {
          if (world.swarmBreachGrace > 0 || world.squadCount <= 4) {
            continue;
          }
          world.swarmBreachGrace = 0.65;
        }
        const cfg = ENEMY_CONFIGS[enemy.kind];
        const tierFodderLoss = world.squadCount >= 36 ? (cfg.tier === 4 ? 3 : cfg.tier >= 2 ? 2 : 1) : 1;
        const baseLoss = enemy.isSwarmFodder
          ? tierFodderLoss
          : clamp(Math.ceil(enemy.hp / cfg.hpPerDroneLoss), 1, cfg.maxLoss);
        const twinScale = hitMirror ? 0.6 : 1.0;
        const gcMult = hasMutator(world, 'glass_cannon') ? 2.2 : 1.0;
        const rawBreachLoss = Math.max(1, Math.round(baseLoss * twinScale * gcMult));
        const breachLoss = mitigateLossWithAegis(world, rawBreachLoss, events);
        const before = world.squadCount;
        world.squadCount = clampSquadCount(before - breachLoss);
        const actualLost = before - world.squadCount;

        if (actualLost > 0) {
          events.push({
            type: 'SQUAD_LOSS',
            x: normalizeZero(enemyCrossX),
            z: PLAYER_Z,
            lost: actualLost,
            reason: 'ENEMY_BREACH',
          });
          deployReserveIfAvailable(world, actualLost, events);
        }

        if (world.squadCount === 0) {
          world.phase = 'DEFEAT';
          world.defeatReason = 'ENEMY_BREACH';
          events.push({
            type: 'RUN_DEFEAT',
            sector: world.sector,
            reason: 'ENEMY_BREACH',
          });
          return true;
        }
      } else {
        enemy.bypassed = true;
        enemy.linkedGateId = null;
        enemy.telegraphTimer = 0;
      }
    }
  }
  return false;
}
