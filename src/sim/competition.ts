import { matchDualSynergyPair, matchOverlimitResonance } from '../config/blitz';
import {
  BLADES_DAMAGE,
  BLADES_ORBIT_RADIUS,
  DESPAWN_Z,
  FIXED_DT,
  JUMP_DURATION_SEC,
  PLAYER_Z,
  RESONANCE_GAIN_VAULT_BREAK,
  TRACK_HALF_WIDTH,
} from '../config/constants';
import type { BossId, BossPartSlot, DamageSourceKey, DualSynergyId, FusionId, MutatorId, OverlimitResonanceId, SimEvent, WeaponId } from '../types/game';
import { applyBarrelBlastToBoss, checkBossPhaseTransitions } from './bosses';
import { damageBarrel } from './barrels';
import { mitigateLossWithAegis } from './aegis';
import { damageEnemy, spawnEnemy } from './enemies';
import {
  allocEntityId,
  type SimBossPart,
  type SimBossState,
  type SimContractWall,
  type SimDoomOrb,
  type SimEnemy,
  type SimJumpPad,
  type SimProjectile,
  type SimMaglevTrain,
  type SimReflector,
  type SimSingularity,
  type SimSkyCargo,
  type SimWorld,
} from './entities';
import { applyProjectileHitToGate } from './gates';
import { clamp, clampSquadCount, normalizeZero } from './math';
import { addResonance } from './resonance';
import { chargeCapacitorTower, hasChip, spawnCoreShard } from './v20Mechanics';
import { damageVault, spawnPrismLens } from './weapons';

const JUMP_PEAK_Y = 2.85;
const SINGULARITY_RADIUS = 4.1;
const SINGULARITY_DURATION = 2.2;

export function hasMutator(world: SimWorld, id: MutatorId): boolean {
  return Boolean(world.mods.mutators && world.mods.mutators.includes(id));
}

export function recordDamage(world: SimWorld, source: DamageSourceKey, amount: number): void {
  if (amount <= 0 || !Number.isFinite(amount)) return;
  world.damageBySource[source] = (world.damageBySource[source] ?? 0) + amount;
}

/**
 * Grants squad recruits while converting any overflow above MAX_SQUAD_COUNT (999) into
 * Reserve Troops (up to 180) + tangible Resonance Overdrive energy!
 */
export function grantSquadWithReserve(world: SimWorld, rawGain: number, events?: SimEvent[]): number {
  if (rawGain <= 0) return 0;
  const before = world.squadCount;
  const rawAfter = before + Math.floor(rawGain);
  const after = clampSquadCount(rawAfter);
  world.squadCount = after;
  if (after > world.stats.peakSquad) {
    world.stats.peakSquad = after;
  }
  const overflow = Math.max(0, rawAfter - after);
  if (overflow > 0) {
    world.reserveTroops = Math.min(180, (world.reserveTroops ?? 0) + overflow);
    if (events) {
      addResonance(world, Math.min(0.45, overflow * 0.009), events);
    } else {
      world.resonance = Math.min(1, world.resonance + Math.min(0.45, overflow * 0.009));
    }
  }
  return after - before;
}

/**
 * Automatically deploys Reserve Troops after non-lethal squad losses so high-count players
 * immediately feel the value of banked reserve reinforcements!
 */
export function deployReserveIfAvailable(world: SimWorld, lost: number, events: SimEvent[]): void {
  if (lost <= 0 || world.squadCount <= 0 || (world.reserveTroops ?? 0) <= 0) return;
  const deploy = Math.min(world.reserveTroops, Math.max(1, Math.ceil(lost * 0.7)));
  if (deploy <= 0) return;
  const before = world.squadCount;
  world.squadCount = clampSquadCount(before + deploy);
  const used = world.squadCount - before;
  if (used > 0) {
    world.reserveTroops -= used;
    events.push({ type: 'RESERVE_DEPLOY', count: used });
  }
}

/**
 * Evaluates which of the 3 Competition Weapon Evolution Fusions are currently unlocked
 * and emits FUSION_UNLOCK events on newly synthesized superweapons.
 */
export function syncActiveFusions(world: SimWorld, events?: SimEvent[]): FusionId[] {
  if (world.stats.vaultsCracked <= 0) {
    world.activeFusions.length = 0;
    return world.activeFusions;
  }

  // Ultimate 12s Tri-Fusion Climax: ignite ALL 3 Superweapons simultaneously!
  if ((world.triFusionTimer ?? 0) > 0) {
    const allThree: FusionId[] = ['cryo_singularity', 'prism_ricochet_web', 'seeker_sword_array'];
    world.activeFusions = allThree;
    return world.activeFusions;
  }

  const lv = world.learnedWeaponLevels;
  const loadout = world.activeLoadout ?? [];
  const inLoadout = (w: WeaponId): boolean => loadout.length === 0 || loadout.includes(w);

  const candidates: FusionId[] = [];
  if (lv.plasma > 0 && lv.cryo > 0 && lv.plasma + lv.cryo >= 3 && inLoadout('plasma') && inLoadout('cryo')) {
    candidates.push('cryo_singularity');
  }
  if (lv.scatter > 0 && lv.rail > 0 && lv.scatter + lv.rail >= 3 && inLoadout('scatter') && inLoadout('rail')) {
    candidates.push('prism_ricochet_web');
  }
  const reqBlades = world.simTime >= 2 ? 2 : 1;
  if (world.bladesCount >= reqBlades && lv.pulse >= 2 && world.bladesCount + lv.pulse >= 3 && (inLoadout('pulse') || loadout.length < 2)) {
    candidates.push('seeker_sword_array');
  }

  // Select the single active Core Fusion best matching the current 2-weapon activeLoadout!
  let chosen: FusionId | null = null;
  if (inLoadout('plasma') && inLoadout('cryo') && candidates.includes('cryo_singularity')) {
    chosen = 'cryo_singularity';
  } else if (inLoadout('scatter') && inLoadout('rail') && candidates.includes('prism_ricochet_web')) {
    chosen = 'prism_ricochet_web';
  } else if (inLoadout('pulse') && candidates.includes('seeker_sword_array')) {
    chosen = 'seeker_sword_array';
  } else if (world.primaryFusion && candidates.includes(world.primaryFusion)) {
    chosen = world.primaryFusion;
  } else if (candidates.length > 0) {
    chosen = candidates[candidates.length - 1]!;
  }

  world.primaryFusion = chosen;
  const next: FusionId[] = chosen ? [chosen] : [];

  if (events) {
    for (const fId of next) {
      if (!world.activeFusions.includes(fId)) {
        events.push({ type: 'FUSION_UNLOCK', fusionId: fId });
      }
    }
  }
  world.activeFusions = next;

  // Evaluate Tactical Dual-Weapon Synergy when no Major Fusion overrides it (zero dead-end 2-weapon pairs!)
  let nextDual: DualSynergyId | null = null;
  if (next.length === 0) {
    const pairA = loadout.length >= 2 ? loadout[0]! : loadout.length === 1 ? loadout[0]! : null;
    const pairB = loadout.length >= 2 ? loadout[1]! : loadout.length === 1 && loadout[0] !== 'pulse' ? 'pulse' : null;
    if (pairA && pairB) {
      const lvSum = (lv[pairA] ?? 0) + (lv[pairB] ?? 0);
      if (lvSum >= 3) {
        nextDual = matchDualSynergyPair(pairA, pairB);
      }
    }
  }
  if (nextDual && world.activeDualSynergy !== nextDual && events) {
    events.push({ type: 'DUAL_SYNERGY_UNLOCK', synergyId: nextDual });
  }
  world.activeDualSynergy = nextDual;

  // Stage 3: Overlimit Dual-Weapon Resonance Synthesis (unlocks at LvSum >= 5, OR LvSum >= 3 during Overdrive, OR Range toggle!)
  let nextOverlimit: OverlimitResonanceId | null = null;
  const pA = loadout.length >= 2 ? loadout[0]! : loadout.length === 1 ? loadout[0]! : null;
  const pB = loadout.length >= 2 ? loadout[1]! : loadout.length === 1 && loadout[0] !== 'pulse' ? 'pulse' : null;
  if (pA && pB) {
    const sumLv = (lv[pA] ?? 0) + (lv[pB] ?? 0);
    const ready =
      (world.isFiringRange && world.rangeForceOverlimit) ||
      sumLv >= 5 ||
      (sumLv >= 3 && world.overdriveTimer > 0);
    if (ready) {
      nextOverlimit = matchOverlimitResonance(pA, pB);
    }
  }
  if (nextOverlimit && world.overlimitResonance !== nextOverlimit && events && world.overdriveTimer <= 0) {
    events.push({ type: 'OVERLIMIT_UNLOCK', resonanceId: nextOverlimit });
  }
  world.overlimitResonance = nextOverlimit;
  return next;
}

export function hasFusion(world: SimWorld, id: FusionId): boolean {
  return world.activeFusions.includes(id);
}

// ---------------------------------------------------------------------------
// 1. Cryo-Nova Singularity Vortex (Plasma + Cryo Fusion)
// ---------------------------------------------------------------------------
export function spawnOrRefreshSingularity(
  world: SimWorld,
  x: number,
  z: number,
  events: SimEvent[],
  customRadius = SINGULARITY_RADIUS,
  customDuration = SINGULARITY_DURATION,
): void {
  // Refresh existing nearby singularity if within 2.5u
  for (let i = 0; i < world.singularities.length; i++) {
    const s = world.singularities[i]!;
    if (Math.hypot(s.x - x, s.z - z) <= 2.5) {
      s.timer = Math.max(s.timer, customDuration);
      return;
    }
  }
  if (world.singularities.length >= 3) {
    world.singularities.shift();
  }
  const vortexMult = 1 + Math.max(0, world.mods.specVortex ?? 0) * 0.10;
  const effRadius = Number((customRadius * vortexMult).toFixed(2));
  const sing: SimSingularity = {
    id: allocEntityId(world),
    x: normalizeZero(clamp(x, -TRACK_HALF_WIDTH + 0.8, TRACK_HALF_WIDTH - 0.8)),
    z,
    radius: effRadius,
    timer: customDuration,
    maxTimer: customDuration,
    tickAcc: 0,
  };
  world.singularities.push(sing);
  events.push({ type: 'SINGULARITY_SPAWN', x: sing.x, z: sing.z, radius: sing.radius });
}

export function stepSingularities(world: SimWorld, events: SimEvent[]): void {
  for (let i = world.singularities.length - 1; i >= 0; i--) {
    const s = world.singularities[i]!;
    s.z += world.currentScrollSpeed * 0.45 * FIXED_DT;
    s.timer -= FIXED_DT;
    s.tickAcc += FIXED_DT;

    const pullSpeed = 6.2;
    for (let k = 0; k < world.enemies.length; k++) {
      const e = world.enemies[k];
      if (!e || !e.active || e.consumed || e.bypassed || e.hp <= 0) continue;
      const dx = s.x - e.x;
      const dz = s.z - e.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= s.radius + e.radius && dist > 0.05) {
        const pull = Math.min(dist * 0.6, pullSpeed * FIXED_DT * (e.kind === 'bastion' ? 0.4 : 1.0));
        e.x = normalizeZero(
          clamp(e.x + (dx / dist) * pull, -TRACK_HALF_WIDTH + e.radius, TRACK_HALF_WIDTH - e.radius),
        );
        e.z = normalizeZero(e.z + (dz / dist) * pull * 0.65);
        e.slowTimer = Math.max(e.slowTimer, 1.5);
      }
    }

    if (s.tickAcc >= 0.25) {
      s.tickAcc -= 0.25;
      const pulseDmg =
        (9 + world.squadCount * 0.22) *
        world.mods.damageMult *
        (hasMutator(world, 'glass_cannon') ? 2.0 : 1.0);
      const snapLen = world.enemies.length;
      for (let k = 0; k < snapLen; k++) {
        const e = world.enemies[k];
        if (!e || !e.active || e.consumed || e.bypassed || e.hp <= 0) continue;
        if (Math.hypot(e.x - s.x, e.z - s.z) <= s.radius + e.radius) {
          recordDamage(world, 'fusions', Math.min(e.hp, pulseDmg));
          damageEnemy(world, e, pulseDmg, 1.8, events);
        }
      }
    }

    if (s.timer <= 1e-9 || s.z > DESPAWN_Z) {
      world.singularities.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Prism Ricochet Laser Web (Scatter + Rail Fusion)
// ---------------------------------------------------------------------------
export function triggerRicochetWeb(
  world: SimWorld,
  originEnemy: SimEnemy,
  baseDamage: number,
  events: SimEvent[],
): void {
  if (world.ricochetsThisTick >= 4) return;
  world.ricochetsThisTick += 1;

  let curX = originEnemy.x;
  let curZ = originEnemy.z;
  const visited = new Set<number>([originEnemy.id]);
  const bounceDmg = baseDamage * 0.68;

  for (let b = 0; b < 3; b++) {
    let bestEnemy: SimEnemy | null = null;
    let bestDist = 5.0;
    for (let i = 0; i < world.enemies.length; i++) {
      const cand = world.enemies[i];
      if (!cand || !cand.active || cand.consumed || cand.bypassed || cand.hp <= 0 || visited.has(cand.id)) {
        continue;
      }
      const d = Math.hypot(cand.x - curX, cand.z - curZ);
      if (d <= bestDist) {
        bestDist = d;
        bestEnemy = cand;
      }
    }
    if (!bestEnemy) break;
    visited.add(bestEnemy.id);
    events.push({
      type: 'CHAIN_ARC',
      fromX: curX,
      fromZ: curZ,
      toX: bestEnemy.x,
      toZ: bestEnemy.z,
      damage: Math.max(1, Math.round(bounceDmg)),
      webColor: 0x7dff6b,
    });
    recordDamage(world, 'fusions', Math.min(bestEnemy.hp, bounceDmg));
    curX = bestEnemy.x;
    curZ = bestEnemy.z;
    damageEnemy(world, bestEnemy, bounceDmg, 0, events);
  }
}

// ---------------------------------------------------------------------------
// 3. Autonomous Seeker Sword-Array (Orbital Blades + Pulse Fusion)
// ---------------------------------------------------------------------------
export function stepSeekerBlades(world: SimWorld, events: SimEvent[]): boolean {
  if (!hasFusion(world, 'seeker_sword_array') || world.bladesCount <= 0 || world.squadCount <= 0) {
    world.seekerBlades.length = 0;
    return false;
  }

  const count = world.bladesCount;
  while (world.seekerBlades.length < count) {
    const idx = world.seekerBlades.length;
    const a = world.bladesAngle + (idx / count) * Math.PI * 2;
    world.seekerBlades.push({
      x: normalizeZero(world.squadX + Math.cos(a) * BLADES_ORBIT_RADIUS),
      z: normalizeZero(PLAYER_Z + Math.sin(a) * BLADES_ORBIT_RADIUS * 0.85),
      cooldown: 0,
      hunting: false,
    });
  }
  if (world.seekerBlades.length > count) {
    world.seekerBlades.length = count;
  }

  const glassMult = hasMutator(world, 'glass_cannon') ? 2.0 : 1.0;
  const sliceDmg = BLADES_DAMAGE * 1.45 * world.mods.damageMult * glassMult;

  for (let i = 0; i < count; i++) {
    const sb = world.seekerBlades[i]!;
    if (sb.cooldown > 0) sb.cooldown = Math.max(0, sb.cooldown - FIXED_DT);

    // Acquire priority target within 28u ahead of playerZ
    let tx: number | null = null;
    let tz: number | null = null;
    let targetKind: 'enemy' | 'gate' | 'vault' | 'doom' | 'part' | null = null;
    let targetIndex = -1;

    // Priority 1: Deflectable Doom-Orb
    for (let k = 0; k < world.doomOrbs.length; k++) {
      const orb = world.doomOrbs[k]!;
      if (orb.active && !orb.reflected && orb.z > PLAYER_Z - 26 && orb.z < PLAYER_Z) {
        tx = orb.x;
        tz = orb.z;
        targetKind = 'doom';
        targetIndex = k;
        break;
      }
    }

    // Priority 2: Corruptor Siphon
    if (tx === null) {
      for (let k = 0; k < world.enemies.length; k++) {
        const e = world.enemies[k];
        if (e && e.active && !e.consumed && !e.bypassed && e.kind === 'siphon' && e.z > PLAYER_Z - 28 && e.z < PLAYER_Z) {
          tx = e.x;
          tz = e.z;
          targetKind = 'enemy';
          targetIndex = k;
          break;
        }
      }
    }

    // Priority 3: Negative / Lock Mutable Gate
    if (tx === null && i % 2 === 0) {
      for (let k = 0; k < world.gates.length; k++) {
        const g = world.gates[k];
        if (g && g.active && g.mutable && !g.triggered && !g.dimmed && g.z > PLAYER_Z - 24 && g.z < PLAYER_Z - 1 && (g.polarity !== 'positive' || g.lockHp > 0)) {
          tx = g.x;
          tz = g.z;
          targetKind = 'gate';
          targetIndex = k;
          break;
        }
      }
    }

    // Priority 4: Boss Shoulder Parts or Closest Enemy
    if (tx === null && world.boss && world.boss.active && world.boss.introProgress >= 1) {
      const pIdx = world.boss.parts.findIndex((pt) => !pt.destroyed && pt.hp > 0);
      if (pIdx >= 0) {
        const pt = world.boss.parts[pIdx]!;
        tx = pt.x;
        tz = pt.z;
        targetKind = 'part';
        targetIndex = pIdx;
      }
    }

    if (tx === null) {
      let bestD = 24.0;
      for (let k = 0; k < world.enemies.length; k++) {
        const e = world.enemies[(k + i * 3) % world.enemies.length];
        if (!e || !e.active || e.consumed || e.bypassed || e.hp <= 0 || e.z >= PLAYER_Z) continue;
        const d = Math.hypot(e.x - sb.x, e.z - sb.z);
        if (d < bestD && e.z > PLAYER_Z - 26) {
          bestD = d;
          tx = e.x;
          tz = e.z;
          targetKind = 'enemy';
          targetIndex = (k + i * 3) % world.enemies.length;
        }
      }
    }

    if (tx !== null && tz !== null) {
      sb.hunting = true;
      const dx = tx - sb.x;
      const dz = tz - sb.z;
      const dist = Math.hypot(dx, dz);
      const speed = 29.0 * FIXED_DT;
      if (dist > speed) {
        sb.x = normalizeZero(clamp(sb.x + (dx / dist) * speed, -TRACK_HALF_WIDTH + 0.25, TRACK_HALF_WIDTH - 0.25));
        sb.z = normalizeZero(sb.z + (dz / dist) * speed);
      } else {
        sb.x = normalizeZero(tx);
        sb.z = normalizeZero(tz);
      }

      if (dist <= 1.25 && sb.cooldown <= 0) {
        sb.cooldown = 0.17;
        if (targetKind === 'enemy') {
          const e = world.enemies[targetIndex];
          if (e && e.active && !e.consumed && e.hp > 0) {
            recordDamage(world, 'fusions', Math.min(e.hp, sliceDmg));
            damageEnemy(world, e, sliceDmg, 0, events);
          }
        } else if (targetKind === 'gate') {
          const g = world.gates[targetIndex];
          if (g && g.active && g.mutable) {
            applyProjectileHitToGate(world, g, sliceDmg * 0.75, events);
          }
        } else if (targetKind === 'doom') {
          const orb = world.doomOrbs[targetIndex];
          if (orb && orb.active && !orb.reflected) {
            hitDoomOrbWithDamage(world, orb, sliceDmg, events);
          }
        } else if (targetKind === 'part' && world.boss) {
          const pt = world.boss.parts[targetIndex];
          if (pt && !pt.destroyed) {
            recordDamage(world, 'fusions', Math.min(pt.hp, sliceDmg));
            damageBossPart(world, pt, sliceDmg, events);
          }
        }
      }
    } else {
      // Return smoothly to orbital guard formation
      sb.hunting = false;
      const a = world.bladesAngle + (i / count) * Math.PI * 2;
      const ox = world.squadX + Math.cos(a) * BLADES_ORBIT_RADIUS;
      const oz = PLAYER_Z + Math.sin(a) * BLADES_ORBIT_RADIUS * 0.85;
      const dx = ox - sb.x;
      const dz = oz - sb.z;
      const dist = Math.hypot(dx, dz);
      const speed = 22.0 * FIXED_DT;
      if (dist > speed) {
        sb.x = normalizeZero(sb.x + (dx / dist) * speed);
        sb.z = normalizeZero(sb.z + (dz / dist) * speed);
      } else {
        sb.x = normalizeZero(ox);
        sb.z = normalizeZero(oz);
      }
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// 4. Interactive Runway Set-Pieces: Jump Pads, 45° Reflectors & Contract Walls
// ---------------------------------------------------------------------------
export function spawnJumpPad(world: SimWorld, x: number, z: number, vz: number): SimJumpPad {
  const pad: SimJumpPad = {
    id: allocEntityId(world),
    prevZ: z,
    x: normalizeZero(clamp(x, -TRACK_HALF_WIDTH + 1.5, TRACK_HALF_WIDTH - 1.5)),
    z,
    vz,
    halfWidth: 1.5,
    halfDepth: 0.85,
    triggered: false,
    active: true,
  };
  world.jumpPads.push(pad);
  return pad;
}

export function spawnReflector(
  world: SimWorld,
  x: number,
  z: number,
  vz: number,
  lean: 1 | -1,
): SimReflector {
  const ref: SimReflector = {
    id: allocEntityId(world),
    prevX: normalizeZero(x),
    prevZ: z,
    x: normalizeZero(clamp(x, -TRACK_HALF_WIDTH + 1.15, TRACK_HALF_WIDTH - 1.15)),
    z,
    vz,
    lean,
    halfWidth: 1.15,
    halfDepth: 0.45,
    pulse: 0,
    active: true,
  };
  world.reflectors.push(ref);
  return ref;
}

export function spawnContractLane(
  world: SimWorld,
  zFront: number,
  length: number,
  vz: number,
  bountySide: 'left' | 'right',
  bountyHp: number,
): SimContractWall {
  const wall: SimContractWall = {
    id: allocEntityId(world),
    zFront,
    zBack: zFront - length,
    length,
    vz,
    bountySide,
    active: true,
  };
  world.contractWalls.push(wall);

  const bx = bountySide === 'left' ? -2.4 : 2.4;
  const elite = spawnEnemy(world, 'bastion', bx, zFront - length * 0.45, {
    hp: bountyHp,
    radius: 1.22,
  });
  elite.isBountyElite = true;

  // Escort crawlers in bounty lane
  for (let i = 0; i < 6; i++) {
    spawnEnemy(
      world,
      'crawler',
      bx + ((i % 3) - 1) * 0.75,
      zFront - 8 - i * 3.2,
      { hp: 6 },
    );
  }
  return wall;
}

export function applyContractWallClamp(world: SimWorld): void {
  for (let i = 0; i < world.contractWalls.length; i++) {
    const w = world.contractWalls[i]!;
    if (!w.active) continue;
    // Active barrier spans [zBack, zFront]; if PLAYER_Z lies inside, lock player to chosen lane!
    if (w.zBack <= PLAYER_Z && w.zFront >= PLAYER_Z) {
      const margin = Math.min(1.6, world.formationRadius * 0.55 + 0.22);
      if (world.prevSquadX < 0) {
        world.squadX = normalizeZero(Math.min(-margin, world.squadX));
      } else {
        world.squadX = normalizeZero(Math.max(margin, world.squadX));
      }
      break;
    }
  }
}

export function grantBountyJackpot(world: SimWorld, x: number, z: number, events: SimEvent[]): void {
  const gain = Math.min(60, Math.max(12, Math.floor(world.squadCount * 0.85)));
  const before = world.squadCount;
  grantSquadWithReserve(world, gain, events);
  const actualGain = world.squadCount - before;
  if (world.squadCount > world.stats.peakSquad) {
    world.stats.peakSquad = world.squadCount;
  }

  // Fill Resonance to 100% and upgrade an Arsenal Weapon!
  addResonance(world, 1.0, events);
  world.stats.vaultsCracked += 1;
  world.masteryCount += 1;
  const order: readonly WeaponId[] =
    world.activeLoadout.length > 0
      ? [...world.activeLoadout, world.weapon]
      : ['plasma', 'cryo', 'scatter', 'rail', 'pulse'];
  let upgradedW: WeaponId = world.weapon;
  for (const w of order) {
    if (world.learnedWeaponLevels[w] < 3) {
      upgradedW = w;
      break;
    }
  }
  const prevLv = world.learnedWeaponLevels[upgradedW];
  const nextLv = Math.min(3, prevLv + 1) as 1 | 2 | 3;
  world.learnedWeaponLevels[upgradedW] = nextLv;
  if (prevLv >= 3) world.overclockStacks += 1;
  syncActiveFusions(world, events);

  events.push({
    type: 'BOUNTY_JACKPOT',
    x,
    z,
    squadGain: actualGain,
    weapon: upgradedW,
    newLevel: nextLv,
  });
}

export function triggerOverlimitOpticEvolution(
  world: SimWorld,
  proj: SimProjectile,
  hitX: number,
  hitZ: number,
  events: SimEvent[],
): void {
  const ov = world.overlimitResonance;
  if (!ov || world.ricochetsThisTick >= 5) return;
  const specRic = Math.max(0, world.mods.specRicochet ?? 0);

  if (ov === 'prism_arc_lattice' || ov === 'photon_prism_fan') {
    world.ricochetsThisTick += 1;
    const maxJumps = 3 + (specRic >= 2 ? 1 : 0);
    const arcDmg = proj.damage * (0.58 + specRic * 0.08);
    let curX = hitX;
    let curZ = hitZ;
    const visited = new Set<number>();
    for (let j = 0; j < maxJumps; j++) {
      let bestE: SimEnemy | null = null;
      let bestD = 9.5;
      for (let i = 0; i < world.enemies.length; i++) {
        const e = world.enemies[i];
        if (!e || !e.active || e.consumed || e.bypassed || e.hp <= 0 || visited.has(e.id)) continue;
        const d = Math.hypot(e.x - curX, e.z - curZ);
        if (d <= bestD && e.z < PLAYER_Z) {
          bestD = d;
          bestE = e;
        }
      }
      if (!bestE) break;
      visited.add(bestE.id);
      events.push({
        type: 'CHAIN_ARC',
        fromX: curX,
        fromZ: curZ,
        toX: bestE.x,
        toZ: bestE.z,
        damage: Math.max(1, Math.round(arcDmg)),
        webColor: 0x7dff6b,
      });
      recordDamage(world, 'fusions', Math.min(bestE.hp, arcDmg));
      curX = bestE.x;
      curZ = bestE.z;
      damageEnemy(world, bestE, arcDmg, 0, events, { bypassShield: true });
    }
    // Also spark-ignite any Surge Barrel near the bounce line!
    for (let bIdx = 0; bIdx < world.barrels.length; bIdx++) {
      const b = world.barrels[bIdx];
      if (b && b.active && !b.detonated && Math.hypot(b.x - curX, b.z - curZ) <= 5.5) {
        damageBarrel(world, b, arcDmg, events, applyBarrelBlastToBoss, true);
        break;
      }
    }
    for (let cIdx = 0; cIdx < world.capTowers.length; cIdx++) {
      const cap = world.capTowers[cIdx];
      if (cap && cap.active && !cap.discharged && Math.hypot(cap.x - curX, cap.z - curZ) <= 7.5) {
        chargeCapacitorTower(world, cap, arcDmg * 1.35, true, events);
      }
    }
  } else if (ov === 'gravity_lens_well') {
    world.ricochetsThisTick += 1;
    spawnOrRefreshSingularity(world, clamp(hitX + proj.vx * 0.18, -3.6, 3.6), hitZ - 7.5, events, 3.4, 1.85);
  }
}

export function bounceProjectileAtReflector(
  world: SimWorld,
  proj: SimProjectile,
  ref: SimReflector,
  hitX: number,
  hitZ: number,
  events: SimEvent[],
): void {
  proj.hitIds.add(ref.id);
  const speed = Math.hypot(proj.vx, proj.vz);
  const deg = ref.angleDeg !== undefined ? ref.angleDeg : ref.lean * 36;
  const bounceAngle = (deg * Math.PI) / 180;
  proj.vx = Math.sin(bounceAngle) * speed;
  proj.vz = -Math.cos(bounceAngle) * speed;
  const specRicMult = 1 + Math.max(0, world.mods.specRicochet ?? 0) * 0.12;
  proj.damage *= 1.45 * specRicMult;
  proj.amplified = true;
  proj.remainingPierce += 2 + ((world.mods.specRicochet ?? 0) >= 2 ? 1 : 0);
  proj.prevX = normalizeZero(hitX);
  proj.prevZ = hitZ;
  proj.x = normalizeZero(clamp(hitX + proj.vx * FIXED_DT, -TRACK_HALF_WIDTH + 0.18, TRACK_HALF_WIDTH - 0.18));
  proj.z = hitZ + proj.vz * FIXED_DT;
  ref.pulse = 1.0;
  events.push({ type: 'REFLECTOR_BOUNCE', x: hitX, z: hitZ });
  triggerOverlimitOpticEvolution(world, proj, hitX, hitZ, events);

  // Chip `chip_prism_split`: 45° Reflector spawns an extra counter-angled split bolt at 38% damage!
  if (hasChip(world, 'chip_prism_split') && world.projectiles.length < 360) {
    const sp = world.projectilePool.acquire();
    sp.id = allocEntityId(world);
    sp.weapon = proj.weapon;
    sp.radius = proj.radius;
    sp.damage = proj.damage * 0.38;
    sp.remainingPierce = 2;
    sp.amplified = true;
    sp.powerScale = proj.powerScale;
    sp.hostile = false;
    sp.hostileLoss = 0;
    sp.maxRange = proj.maxRange;
    sp.splashRadius = proj.splashRadius;
    sp.splashDamageRatio = proj.splashDamageRatio;
    sp.cryoSlowDuration = proj.cryoSlowDuration;
    sp.sweepStartFraction = 0;
    sp.fodderPunches = 0;
    sp.active = true;
    sp.hitIds.clear();
    sp.hitIds.add(ref.id);
    const twinAng = ((-deg * 0.65) * Math.PI) / 180;
    sp.vx = Math.sin(twinAng) * speed;
    sp.vz = -Math.cos(twinAng) * speed;
    sp.prevX = normalizeZero(hitX);
    sp.prevZ = hitZ;
    sp.x = normalizeZero(clamp(hitX + sp.vx * FIXED_DT, -TRACK_HALF_WIDTH + 0.18, TRACK_HALF_WIDTH - 0.18));
    sp.z = hitZ + sp.vz * FIXED_DT;
    sp.distanceTraveled = speed * FIXED_DT;
    world.projectiles.push(sp);
  }
}

export function resolveJumpPadCrossings(world: SimWorld, events: SimEvent[]): void {
  if (world.jumpTimer > 0) return;
  for (let i = 0; i < world.jumpPads.length; i++) {
    const pad = world.jumpPads[i]!;
    if (!pad.active || pad.triggered) continue;
    if (pad.prevZ <= PLAYER_Z && pad.z >= PLAYER_Z) {
      if (Math.abs(world.squadX - pad.x) <= pad.halfWidth + world.formationRadius * 0.5) {
        pad.triggered = true;
        world.jumpTimer = JUMP_DURATION_SEC;
        world.landingAmbushX = pad.flankAmbush ? pad.x : undefined;
        events.push({ type: 'JUMP_LAUNCH', x: world.squadX, z: PLAYER_Z });
        break;
      }
    }
  }
}

export function stepJumpArc(world: SimWorld, events: SimEvent[]): void {
  if (world.jumpTimer <= 0) {
    world.squadAirY = 0;
    return;
  }
  const nextT = world.jumpTimer - FIXED_DT;
  if (world.landingAmbushX !== undefined && world.jumpTimer > 0.43 && nextT <= 0.43) {
    const lane = world.landingAmbushX;
    const side = Math.sign(lane);
    for (let i = 0; i < 7; i++) {
      const startX = side * (i % 2 ? 4.45 : 3.85);
      const startZ = PLAYER_Z - world.currentScrollSpeed * 0.43 - 1.7 - i * 0.5;
      const runner = spawnEnemy(world, 'crawler', startX, startZ, { hp: 60 });
      runner.flankTargetX = lane + (i % 3 - 1) * 0.7;
    }
    world.landingAmbushX = undefined;
  }
  if (nextT <= 1e-9) {
    world.jumpTimer = 0;
    world.squadAirY = 0;
    // Touchdown Sky-Slam Shockwave!
    const slamRadius = 7.2;
    const slamDmg = 95 * world.mods.damageMult * (hasMutator(world, 'glass_cannon') ? 2.0 : 1.0);
    let slammed = 0;
    const snapLen = world.enemies.length;
    for (let i = 0; i < snapLen; i++) {
      const e = world.enemies[i];
      if (!e || !e.active || e.consumed || e.bypassed || e.hp <= 0) continue;
      if (Math.hypot(e.x - world.squadX, e.z - PLAYER_Z) <= slamRadius + e.radius) {
        e.z = normalizeZero(Math.min(e.z - 2.6, PLAYER_Z - 2.8));
        e.prevZ = e.z;
        slammed += 1;
        recordDamage(world, 'explosives', Math.min(e.hp, slamDmg));
        damageEnemy(world, e, slamDmg, 1.4, events);
      }
    }
    if ((world.endless?.upgrades.blades ?? 0) >= 1) {
      spawnOrRefreshSingularity(world, world.squadX, PLAYER_Z - 4.0, events, 4.2, 2.6);
    }
    events.push({ type: 'JUMP_SLAM', x: world.squadX, z: PLAYER_Z, hits: slammed });
  } else {
    world.jumpTimer = nextT;
    const p = 1 - nextT / JUMP_DURATION_SEC;
    world.squadAirY = normalizeZero(JUMP_PEAK_Y * 4 * p * (1 - p));
  }
}

// ---------------------------------------------------------------------------
// 5. Destructible Boss Shoulder Parts & Polarity-Flip Deflectable Doom-Orbs
// ---------------------------------------------------------------------------
export function createBossShoulderParts(
  world: SimWorld,
  bossMaxHp: number,
  titanScale = 1,
  bossId: BossId = 'warden_01',
): SimBossPart[] {
  const partHp = Math.max(165, Math.round(bossMaxHp * 0.082));
  const reactorHp = Math.max(190, Math.round(bossMaxHp * 0.092));
  const sx = Number((2.15 * (1 + (titanScale - 1) * 0.42)).toFixed(3));
  const hw = Number((1.05 * (1 + (titanScale - 1) * 0.35)).toFixed(3));
  const leftLabel =
    bossId === 'hydra_02' ? '紫焰吐息翼' : bossId === 'omega_zero' ? '歼星重炮肩' : '重火炮肩甲';
  const rightLabel =
    bossId === 'hydra_02' ? '苍雷分体翼' : bossId === 'omega_zero' ? '深渊裂隙肩' : '孵化巢肩甲';
  const reactorLabel =
    bossId === 'hydra_02' ? '双生共鸣冠核' : bossId === 'omega_zero' ? '相位护盾发生器' : '超压熔炉核心';
  return [
    {
      id: allocEntityId(world),
      slot: 'left',
      label: leftLabel,
      prevX: -sx,
      prevZ: -32.8,
      x: -sx,
      z: -32.8,
      halfWidth: hw,
      halfDepth: hw,
      hp: partHp,
      maxHp: partHp,
      hitPulse: 0,
      telegraph: 0,
      destroyed: false,
    },
    {
      id: allocEntityId(world),
      slot: 'right',
      label: rightLabel,
      prevX: sx,
      prevZ: -32.8,
      x: sx,
      z: -32.8,
      halfWidth: hw,
      halfDepth: hw,
      hp: partHp,
      maxHp: partHp,
      hitPulse: 0,
      telegraph: 0,
      destroyed: false,
    },
  ];
  void reactorHp;
  void reactorLabel;
}

export function spawnPhaseTwoReactorPart(world: SimWorld, boss: SimBossState): void {
  if (boss.parts.some((p) => p.slot === 'reactor')) return;
  const reactorHp = Math.max(190, Math.round(boss.maxHp * 0.092));
  const hw = Number((0.98 * (1 + ((boss.titanScale ?? 1) - 1) * 0.35)).toFixed(3));
  const reactorLabel =
    boss.id === 'hydra_02' ? '双生共鸣冠核' : boss.id === 'omega_zero' ? '相位护盾发生器' : '超压熔炉核心';
  boss.parts.push({
    id: allocEntityId(world),
    slot: 'reactor',
    label: reactorLabel,
    prevX: 2.15,
    prevZ: boss.z + 1.55,
    x: 2.15,
    z: boss.z + 1.55,
    halfWidth: hw,
    halfDepth: hw,
    hp: reactorHp,
    maxHp: reactorHp,
    hitPulse: 0,
    telegraph: 0,
    destroyed: false,
  });
}

export function syncBossShoulderParts(boss: SimBossState): void {
  const sx = 2.15 * (1 + ((boss.titanScale ?? 1) - 1) * 0.42);
  for (let i = 0; i < boss.parts.length; i++) {
    const pt = boss.parts[i]!;
    pt.prevX = pt.x;
    pt.prevZ = pt.z;
    // In HYDRA-02 Phase 2 Twin-Dragon split, Left Wing tracks Primary Dragon and Right Wing tracks Secondary Dragon!
    if (pt.slot === 'reactor') {
      // Orbits across lateral flanks (±2.25m) so active players snipe it while AFK x=0 players cannot!
      const orbitX = Math.sin(boss.phaseElapsed * 1.65 + 1.1) >= 0 ? 2.25 : -2.25;
      const rx = boss.id === 'hydra_02' && boss.phase >= 2 && boss.secondaryCore
        ? clamp((boss.x + boss.secondaryCore.x) * 0.5 + orbitX * 0.85, -3.6, 3.6)
        : clamp(boss.x + orbitX * 0.65, -3.6, 3.6);
      pt.x = normalizeZero(rx);
      pt.z = normalizeZero(boss.z + 1.65);
    } else if (boss.id === 'hydra_02' && boss.phase >= 2 && boss.secondaryCore && pt.slot === 'right') {
      pt.x = normalizeZero(boss.secondaryCore.x + 1.35);
      pt.z = normalizeZero(boss.secondaryCore.z + 1.05);
    } else if (boss.id === 'hydra_02' && boss.phase >= 2 && pt.slot === 'left') {
      pt.x = normalizeZero(boss.x - 1.35);
      pt.z = normalizeZero(boss.z + 1.05);
    } else {
      pt.x = normalizeZero(boss.x + (pt.slot === 'left' ? -sx : sx));
      pt.z = normalizeZero(boss.z + 1.15);
    }
    if (pt.destroyed) {
      pt.telegraph = 0;
    } else if (pt.slot === 'left') {
      const nextShot = Math.min(boss.orbTimer, boss.doomOrbTimer);
      pt.telegraph = boss.introProgress >= 1 && nextShot < 1.15 ? clamp(1 - nextShot / 1.15, 0, 1) : 0;
    } else if (pt.slot === 'reactor') {
      pt.telegraph = boss.introProgress >= 1 && (boss.shielded || boss.hazardTimer < 1.05) ? clamp(boss.shielded ? 0.85 : 1 - boss.hazardTimer / 1.05, 0, 1) : 0;
    } else {
      pt.telegraph = boss.introProgress >= 1 && boss.summonTimer < 1.15 ? clamp(1 - boss.summonTimer / 1.15, 0, 1) : 0;
    }
    if (pt.hitPulse > 0) {
      pt.hitPulse = Math.max(0, pt.hitPulse - FIXED_DT * 5);
    }
  }
}

export function damageBossPart(
  world: SimWorld,
  part: SimBossPart,
  damage: number,
  events: SimEvent[],
): void {
  const boss = world.boss;
  if (!boss || !boss.active || boss.hp <= 0 || part.destroyed || damage <= 0) return;

  part.hp = Math.max(0, part.hp - damage);
  part.hitPulse = 1.0;
  boss.hitPulse = Math.max(boss.hitPulse, 0.55);

  if (part.hp <= 0) {
    part.hp = 0;
    part.destroyed = true;
    // Shatter bonus damage (8% Boss Max HP, leaving >= 1 HP if shielded in Omega-Zero P1? If shielded, break shield or deal direct!)
    if (!boss.shielded) {
      const shatterChunk = Math.ceil(boss.maxHp * 0.08);
      recordDamage(world, 'explosives', Math.min(boss.hp, shatterChunk));
      boss.hp = Math.max(0, boss.hp - shatterChunk);
    }
    boss.breakTimer = part.slot === 'reactor' ? 4.5 : 4.0;
    if (part.slot === 'reactor') {
      // Breaking Dorsal Shield/Overload Reactor immediately collapses active shields, suppresses Enrage pulse & drops an Amplified Prism Lens!
      boss.shielded = false;
      if (boss.secondaryCore) boss.secondaryCore.shielded = false;
      for (const py of boss.pylons) {
        if (!py.destroyed) {
          py.hp = Math.max(0, Math.round(py.hp * 0.35));
          if (py.hp <= 0) py.destroyed = true;
        }
      }
      boss.enragePulseTimer = 8.0;
      spawnPrismLens(world, clamp(boss.x, -2.5, 2.5), -11.5, 1.8, 2.2, 1.1);
    } else if (part.slot === 'left') {
      // Breaking Left Heavy Cannon Shoulder immediately purges all airborne Boss projectiles!
      for (let i = world.projectiles.length - 1; i >= 0; i--) {
        const p = world.projectiles[i];
        if (p && p.active && p.hostile) {
          world.projectilePool.release(p);
          world.projectiles.splice(i, 1);
        }
      }
    } else {
      // Breaking Right Hive Shoulder immediately collapses half of active summoned swarm minions!
      let purged = 0;
      for (let i = 0; i < world.enemies.length; i++) {
        const e = world.enemies[i];
        if (e && e.active && e.isSwarmFodder && !e.consumed && e.hp > 0 && purged % 2 === 0) {
          e.hp = 0;
          e.consumed = true;
          e.active = false;
        }
        if (e && e.isSwarmFodder) purged += 1;
      }
    }
    addResonance(world, RESONANCE_GAIN_VAULT_BREAK + (hasChip(world, 'chip_exec_protocol') ? 0.25 : 0), events);
    if (hasChip(world, 'chip_exec_protocol')) {
      world.nukeCharge = Math.min(1, world.nukeCharge + 0.25);
    }
    spawnCoreShard(world, part.x, part.z + 1.5, 2);
    const effectDesc =
      part.slot === 'reactor'
        ? '护盾过载崩解 · 投射黄金聚能透镜 · 4.5s 2.0× 破防暴露'
        : boss.id === 'hydra_02'
        ? part.slot === 'left'
          ? '紫焰吐息弹幕锐减 72% · 侧翼红区收窄 25%'
          : '召唤裂变锐减 72% · 二阶段破盾暴露延长至 5.0s'
        : boss.id === 'omega_zero'
          ? part.slot === 'left'
            ? '全阶段歼星重炮锐减 72% · 空中弹球清空'
            : '深渊虫潮召唤锐减 72% · 额外空投引爆电容桶'
          : part.slot === 'left'
            ? '重火炮弹幕锐减 72% · 空中弹球瞬间清空'
            : '母巢召唤频率锐减 72% · 场上半数杂兵湮灭';
    events.push({
      type: 'BOSS_PART_BREAK',
      slot: part.slot,
      label: part.label,
      effectDesc,
      x: part.x,
      z: part.z,
    });
    checkBossPhaseTransitions(world, events);
  }
}

export function spawnDoomOrb(world: SimWorld, boss: SimBossState, events: SimEvent[]): SimDoomOrb {
  const startVal = world.mods.blitz ? -16 : world.sector === 1 ? -18 : world.sector === 2 ? -24 : -30;
  const dmgPerStep = Math.max(6, Math.round(boss.maxHp * 0.0016));
  const orb: SimDoomOrb = {
    id: allocEntityId(world),
    prevX: boss.x,
    prevZ: boss.z + 1.8,
    x: normalizeZero(clamp(boss.x, -3.2, 3.2)),
    z: boss.z + 1.8,
    vz: 7.2,
    radius: 1.12,
    value: startVal,
    damagePerStep: dmgPerStep,
    accDamage: 0,
    chargeRatio: 0,
    reflected: false,
    hitPulse: 0,
    active: true,
  };
  world.doomOrbs.push(orb);
  events.push({ type: 'DOOM_ORB_SPAWN', x: orb.x, z: orb.z, value: orb.value });
  return orb;
}

export function hitDoomOrbWithDamage(
  world: SimWorld,
  orb: SimDoomOrb,
  damage: number,
  events: SimEvent[],
): void {
  if (!orb.active || orb.reflected || damage <= 0) return;
  orb.hitPulse = 1.0;
  orb.accDamage += damage;
  while (orb.accDamage >= orb.damagePerStep && !orb.reflected) {
    orb.accDamage -= orb.damagePerStep;
    orb.value += 1;
    if (orb.value >= 1) {
      orb.value = 1;
      orb.reflected = true;
      orb.vz = -46.0;
      orb.chargeRatio = 1;
      addResonance(world, 0.35, events);
      events.push({ type: 'DOOM_ORB_REFLECT', x: orb.x, z: orb.z });
      return;
    }
  }
  orb.chargeRatio = clamp(orb.accDamage / Math.max(1, orb.damagePerStep), 0, 0.999);
}

export function stepCompetitionEntitiesMotion(world: SimWorld, events: SimEvent[]): void {
  for (let i = world.jumpPads.length - 1; i >= 0; i--) {
    const pad = world.jumpPads[i]!;
    pad.prevZ = pad.z;
    pad.z += pad.vz * FIXED_DT;
    if (pad.z > DESPAWN_Z) world.jumpPads.splice(i, 1);
  }

  for (let i = world.reflectors.length - 1; i >= 0; i--) {
    const r = world.reflectors[i]!;
    r.prevX = r.x;
    r.prevZ = r.z;
    r.z += r.vz * FIXED_DT;
    if (r.pulse > 0) {
      const n = r.pulse - 4.5 * FIXED_DT;
      r.pulse = n <= 1e-9 ? 0 : n;
    }
    if (r.z > DESPAWN_Z) world.reflectors.splice(i, 1);
  }

  for (let i = world.contractWalls.length - 1; i >= 0; i--) {
    const w = world.contractWalls[i]!;
    w.zFront += w.vz * FIXED_DT;
    w.zBack += w.vz * FIXED_DT;
    if (w.zBack > DESPAWN_Z) world.contractWalls.splice(i, 1);
  }

  const boss = world.boss;
  for (let i = world.doomOrbs.length - 1; i >= 0; i--) {
    const orb = world.doomOrbs[i]!;
    if (!orb.active) {
      world.doomOrbs.splice(i, 1);
      continue;
    }
    orb.prevX = orb.x;
    orb.prevZ = orb.z;
    if (orb.reflected && boss && boss.active) {
      // Homing slam straight back into Boss chest core!
      const dx = boss.x - orb.x;
      orb.x = normalizeZero(orb.x + clamp(dx * 8 * FIXED_DT, -0.6, 0.6));
    }
    orb.z += orb.vz * FIXED_DT;
    if (orb.hitPulse > 0) {
      const n = orb.hitPulse - 6.0 * FIXED_DT;
      orb.hitPulse = n <= 1e-9 ? 0 : n;
    }

    if (orb.reflected && boss && boss.active && boss.hp > 0 && orb.z <= boss.z + 1.8) {
      orb.active = false;
      const slamChunk = Math.ceil(boss.maxHp * 0.16);
      // Reflected Doom-Orb cracks Omega-Zero Pylons or slams Boss Core directly!
      const livePylon = boss.pylons.find((p) => !p.destroyed);
      if (boss.shielded && livePylon) {
        livePylon.hp = 0;
        livePylon.destroyed = true;
        if (boss.pylons.every((p) => p.destroyed)) boss.shielded = false;
      }
      recordDamage(world, 'deflect', Math.min(boss.hp, slamChunk));
      boss.hp = Math.max(0, boss.hp - slamChunk);
      boss.hitPulse = 1.0;
      boss.breakTimer = Math.max(boss.breakTimer, 2.5);
      events.push({ type: 'DOOM_ORB_SLAM', x: boss.x, z: boss.z, damage: slamChunk });
      checkBossPhaseTransitions(world, events);
      world.doomOrbs.splice(i, 1);
      continue;
    }

    // Unreflected Negative Doom-Orb crossing PLAYER_Z punishes AFK/undodged squad!
    if (!orb.reflected && orb.prevZ < PLAYER_Z && orb.z >= PLAYER_Z && world.squadAirY <= 0.6) {
      const hitCenter = Math.abs(world.squadX - orb.x) <= orb.radius + 0.42 * world.formationRadius;
      const hitTwin =
        hasMutator(world, 'mirror_twin') &&
        Math.abs(world.squadX) > 0.45 &&
        Math.abs(-world.squadX - orb.x) <= orb.radius + 0.36 * world.formationRadius;
      if (hitCenter || hitTwin) {
        orb.active = false;
        const baseOrbLoss = Math.max(2, Math.min(18, Math.round(Math.abs(orb.value) * (hitCenter ? 0.55 : 0.3))));
        const endlessScaleLoss =
          world.endless && world.endless.wave >= 2 && hitCenter
            ? Math.round(world.squadCount * (world.endless.wave >= 3 ? 0.38 : 0.25))
            : 0;
        const rawLoss = Math.max(baseOrbLoss, endlessScaleLoss);
        const loss = mitigateLossWithAegis(world, rawLoss, events);
        const before = world.squadCount;
        world.squadCount = clampSquadCount(before - loss);
        const actual = before - world.squadCount;
        if (actual > 0) {
          events.push({ type: 'SQUAD_LOSS', x: orb.x, z: PLAYER_Z, lost: actual, reason: 'BOSS_ATTACK' });
          deployReserveIfAvailable(world, actual, events);
        }
        if (world.squadCount === 0) {
          world.phase = 'DEFEAT';
          world.defeatReason = 'BOSS_ATTACK';
          events.push({ type: 'RUN_DEFEAT', sector: world.sector, reason: 'BOSS_ATTACK' });
        }
        world.doomOrbs.splice(i, 1);
        continue;
      }
    }
    if (orb.z > DESPAWN_Z || orb.z < -85) {
      world.doomOrbs.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. AAA Mid-Run Set-Pieces: Shootable Sky-Drop Plasma Cargo & Maglev Express Sweep
// ---------------------------------------------------------------------------
function allocSpectacleId(world: SimWorld): number {
  world.spectacleIdSeq = (world.spectacleIdSeq ?? 0) + 1;
  return 900000 + world.spectacleIdSeq;
}

export function spawnSkyCargo(
  world: SimWorld,
  x: number,
  z: number,
  vz: number,
  events?: SimEvent[],
  overrideHp?: number,
): SimSkyCargo {
  const maxHp = Math.max(18, Math.round(overrideHp ?? Math.max(24, world.trueSquadDps * 0.48)));
  const clampedX = normalizeZero(clamp(x, -TRACK_HALF_WIDTH + 1.5, TRACK_HALF_WIDTH - 1.5));
  const cargo: SimSkyCargo = {
    id: allocSpectacleId(world),
    prevX: clampedX,
    prevZ: z,
    x: clampedX,
    y: 3.85,
    z,
    vy: 0,
    vz,
    halfWidth: 1.48,
    halfDepth: 1.15,
    hp: maxHp,
    maxHp,
    state: 'hanging',
    slamTimer: 0,
    hitPulse: 0,
    active: true,
  };
  world.skyCargos.push(cargo);
  if (events) events.push({ type: 'SKY_CARGO_SPAWN', x: cargo.x, z: cargo.z });
  return cargo;
}

export function damageSkyCargo(
  world: SimWorld,
  cargo: SimSkyCargo,
  damage: number,
  events: SimEvent[],
): void {
  if (!cargo.active || cargo.state !== 'hanging' || damage <= 0) return;
  cargo.hp = Math.max(0, cargo.hp - damage);
  cargo.hitPulse = 1.0;
  if (cargo.hp <= 0) {
    cargo.hp = 0;
    cargo.state = 'falling';
    cargo.vy = -4.5;
    events.push({ type: 'SKY_CARGO_DROP', x: cargo.x, z: cargo.z });
  }
}

export function spawnMaglevSweep(
  world: SimWorld,
  z: number,
  dir: 1 | -1,
  events?: SimEvent[],
): SimMaglevTrain {
  const train: SimMaglevTrain = {
    id: allocSpectacleId(world),
    z,
    dir,
    trainX: -dir * 34,
    prevTrainX: -dir * 34,
    state: 'warning',
    elapsed: 0,
    warningDuration: 1.25,
    warningProgress: 0,
    sweepEmitted: false,
    kills: 0,
    active: true,
  };
  world.maglevTrains.push(train);
  if (events) events.push({ type: 'MAGLEV_WARN', z, dir });
  return train;
}

export function stepMidRunSpectacles(world: SimWorld, events: SimEvent[]): void {
  // Auto-schedule mid-run spectacles during active runway advance (never mutating RNG or boss fight)
  if (!world.boss && world.currentScrollSpeed > 1) {
    const isLooped = Boolean(world.endless || world.mods.blitz);
    const cargoStage = isLooped
      ? Math.floor((world.simTime + 8.5) / 16.5)
      : world.runwayProgress >= 0.74
        ? 3
        : world.runwayProgress >= 0.44
          ? 2
          : world.runwayProgress >= 0.14
            ? 1
            : 0;
    if (cargoStage > world.lastCargoStage && world.skyCargos.length < 2) {
      world.lastCargoStage = cargoStage;
      const laneX = ((cargoStage + world.sector) % 3 - 1) * 2.15;
      spawnSkyCargo(world, laneX, PLAYER_Z - 42, world.currentScrollSpeed * 0.68, events);
    }

    const magStage = isLooped
      ? Math.floor((world.simTime + 11.0) / 21.0)
      : world.runwayProgress >= 0.62
        ? 2
        : world.runwayProgress >= 0.28
          ? 1
          : 0;
    if (magStage > world.lastMaglevStage && world.maglevTrains.length === 0) {
      world.lastMaglevStage = magStage;
      const dir: 1 | -1 = (magStage + world.sector) % 2 === 0 ? 1 : -1;
      spawnMaglevSweep(world, PLAYER_Z - 23.5, dir, events);
    }
  }

  // Step SkyCargos (hanging -> falling -> slammed AoE crush)
  for (let i = world.skyCargos.length - 1; i >= 0; i--) {
    const c = world.skyCargos[i]!;
    if (!c.active) {
      world.skyCargos.splice(i, 1);
      continue;
    }
    c.prevX = c.x;
    c.prevZ = c.z;
    if (c.hitPulse > 0) {
      const np = c.hitPulse - 6.0 * FIXED_DT;
      c.hitPulse = np <= 1e-9 ? 0 : np;
    }

    if (c.state === 'hanging') {
      c.z += (world.currentScrollSpeed > 0 ? world.currentScrollSpeed * 0.68 : c.vz) * FIXED_DT;
      if (c.z > DESPAWN_Z) {
        c.active = false;
        world.skyCargos.splice(i, 1);
      }
    } else if (c.state === 'falling') {
      c.z += world.currentScrollSpeed * 0.35 * FIXED_DT;
      c.vy -= 38.0 * FIXED_DT;
      c.y += c.vy * FIXED_DT;
      if (c.y <= 0.05) {
        c.y = 0;
        c.state = 'slammed';
        c.slamTimer = 0.55;
        const crushRadius = 6.2;
        const crushDmg = (240 + world.trueSquadDps * 2.4) * world.mods.damageMult;
        let kills = 0;
        const snapLen = world.enemies.length;
        for (let k = 0; k < snapLen; k++) {
          const e = world.enemies[k];
          if (!e || !e.active || e.consumed || e.bypassed || e.hp <= 0) continue;
          if (Math.hypot(e.x - c.x, e.z - c.z) <= crushRadius + e.radius) {
            recordDamage(world, 'explosives', Math.min(e.hp, crushDmg));
            if (damageEnemy(world, e, crushDmg, 2.0, events, { bypassShield: true })) {
              kills += 1;
            }
          }
        }
        addResonance(world, 0.28, events);
        events.push({ type: 'SKY_CARGO_SLAM', x: c.x, z: c.z, kills });
      }
    } else {
      c.z += world.currentScrollSpeed * FIXED_DT;
      c.slamTimer -= FIXED_DT;
      if (c.slamTimer <= 0 || c.z > DESPAWN_Z) {
        c.active = false;
        world.skyCargos.splice(i, 1);
      }
    }
  }

  // Step Maglev Express Crossings (1.25s laser telegraph -> 136 m/s lateral bullet-train sweep!)
  for (let i = world.maglevTrains.length - 1; i >= 0; i--) {
    const tr = world.maglevTrains[i]!;
    if (!tr.active) {
      world.maglevTrains.splice(i, 1);
      continue;
    }
    tr.elapsed += FIXED_DT;
    if (tr.state === 'warning') {
      tr.warningProgress = clamp(tr.elapsed / tr.warningDuration, 0, 1);
      if (tr.elapsed >= tr.warningDuration) {
        tr.state = 'crossing';
        tr.elapsed = 0;
        tr.warningProgress = 1;
      }
    } else {
      tr.prevTrainX = tr.trainX;
      tr.trainX += tr.dir * 136.0 * FIXED_DT;
      const minSweepX = Math.min(tr.prevTrainX, tr.trainX) - 7.5;
      const maxSweepX = Math.max(tr.prevTrainX, tr.trainX) + 7.5;
      const snapLen = world.enemies.length;
      for (let k = 0; k < snapLen; k++) {
        const e = world.enemies[k];
        if (!e || !e.active || e.consumed || e.bypassed || e.hp <= 0) continue;
        if (Math.abs(e.z - tr.z) <= 3.35 + e.radius && e.x >= minSweepX && e.x <= maxSweepX) {
          const ramDmg = Math.max(e.hp + 50, 9999);
          recordDamage(world, 'explosives', e.hp);
          if (damageEnemy(world, e, ramDmg, 0, events, { bypassShield: true })) {
            tr.kills += 1;
          }
        }
      }
      if (!tr.sweepEmitted && tr.dir * tr.trainX >= -2.0) {
        tr.sweepEmitted = true;
        events.push({ type: 'MAGLEV_SWEEP', z: tr.z, dir: tr.dir, kills: tr.kills });
      }
      if (Math.abs(tr.trainX) > 38) {
        tr.active = false;
        world.maglevTrains.splice(i, 1);
      }
    }
  }
}

export function resolveDoomOrbImpacts(world: SimWorld, events: SimEvent[]): boolean {
  for (let i = world.doomOrbs.length - 1; i >= 0; i--) {
    const orb = world.doomOrbs[i]!;
    if (!orb.active || orb.reflected) continue;
    if (orb.prevZ < PLAYER_Z && orb.z >= PLAYER_Z) {
      orb.active = false;
      world.doomOrbs.splice(i, 1);
      if (world.squadAirY > 0.6) continue; // Airborne jump flies cleanly over!

      if (Math.abs(orb.x - world.squadX) <= world.formationRadius + orb.radius) {
        const rawLoss = Math.min(28, Math.max(2, Math.abs(orb.value))) * (hasMutator(world, 'glass_cannon') ? 2 : 1);
        const loss = mitigateLossWithAegis(world, rawLoss, events);
        const before = world.squadCount;
        world.squadCount = clampSquadCount(before - loss);
        const lost = before - world.squadCount;
        if (lost > 0) {
          events.push({
            type: 'SQUAD_LOSS',
            x: orb.x,
            z: PLAYER_Z,
            lost,
            reason: 'BOSS_ATTACK',
          });
        }
        if (world.squadCount === 0) {
          world.phase = 'DEFEAT';
          world.defeatReason = 'BOSS_ATTACK';
          events.push({ type: 'RUN_DEFEAT', sector: world.sector, reason: 'BOSS_ATTACK' });
          return true;
        }
      }
    }
  }
  return false;
}
