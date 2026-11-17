import {
  BLADES_DAMAGE,
  BLADES_ORBIT_RADIUS,
  DESPAWN_Z,
  FIXED_DT,
  PLAYER_Z,
  RESONANCE_GAIN_VAULT_BREAK,
  TRACK_HALF_WIDTH,
} from '../config/constants';
import type { DamageSourceKey, FusionId, MutatorId, SimEvent, WeaponId } from '../types/game';
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
  type SimReflector,
  type SimSingularity,
  type SimWorld,
} from './entities';
import { applyProjectileHitToGate } from './gates';
import { clamp, clampSquadCount, normalizeZero } from './math';
import { addResonance } from './resonance';
import { damageVault } from './weapons';

const JUMP_DURATION_SEC = 1.32;
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
 * Evaluates which of the 3 Competition Weapon Evolution Fusions are currently unlocked
 * and emits FUSION_UNLOCK events on newly synthesized superweapons.
 */
export function syncActiveFusions(world: SimWorld, events?: SimEvent[]): FusionId[] {
  if (world.stats.vaultsCracked <= 0 && !world.mods.blitz) {
    world.activeFusions.length = 0;
    return world.activeFusions;
  }
  const lv = world.learnedWeaponLevels;
  const reqSum = world.mods.blitz ? 2 : 3;
  const next: FusionId[] = [];

  if (lv.plasma > 0 && lv.cryo > 0 && lv.plasma + lv.cryo >= reqSum) {
    next.push('cryo_singularity');
  }
  if (lv.scatter > 0 && lv.rail > 0 && lv.scatter + lv.rail >= reqSum) {
    next.push('prism_ricochet_web');
  }
  if (
    world.bladesCount > 0 &&
    lv.pulse > 0 &&
    (world.bladesCount + lv.pulse >= 3 || (world.mods.blitz && world.bladesCount >= 1 && lv.pulse >= 1))
  ) {
    next.push('seeker_sword_array');
  }

  if (events) {
    for (const fId of next) {
      if (!world.activeFusions.includes(fId)) {
        events.push({ type: 'FUSION_UNLOCK', fusionId: fId });
      }
    }
  }
  world.activeFusions = next;
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
): void {
  // Refresh existing nearby singularity if within 2.5u
  for (let i = 0; i < world.singularities.length; i++) {
    const s = world.singularities[i]!;
    if (Math.hypot(s.x - x, s.z - z) <= 2.5) {
      s.timer = SINGULARITY_DURATION;
      return;
    }
  }
  if (world.singularities.length >= 3) {
    world.singularities.shift();
  }
  const sing: SimSingularity = {
    id: allocEntityId(world),
    x: normalizeZero(clamp(x, -TRACK_HALF_WIDTH + 0.8, TRACK_HALF_WIDTH - 0.8)),
    z,
    radius: SINGULARITY_RADIUS,
    timer: SINGULARITY_DURATION,
    maxTimer: SINGULARITY_DURATION,
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
        (hasMutator(world, 'glass_cannon') ? 2.4 : 1.0);
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

  const glassMult = hasMutator(world, 'glass_cannon') ? 2.4 : 1.0;
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
  world.squadCount = clampSquadCount(before + gain);
  const actualGain = world.squadCount - before;
  if (world.squadCount > world.stats.peakSquad) {
    world.stats.peakSquad = world.squadCount;
  }

  // Fill Resonance to 100% and upgrade an Arsenal Weapon!
  addResonance(world, 1.0, events);
  world.stats.vaultsCracked += 1;
  world.masteryCount += 1;
  const order: readonly WeaponId[] = ['plasma', 'cryo', 'scatter', 'rail', 'pulse'];
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

export function bounceProjectileAtReflector(
  proj: SimProjectile,
  ref: SimReflector,
  hitX: number,
  hitZ: number,
  events: SimEvent[],
): void {
  proj.hitIds.add(ref.id);
  const speed = Math.hypot(proj.vx, proj.vz);
  const bounceAngle = ref.lean * ((36 * Math.PI) / 180);
  proj.vx = Math.sin(bounceAngle) * speed;
  proj.vz = -Math.cos(bounceAngle) * speed;
  proj.damage *= 1.45;
  proj.amplified = true;
  proj.remainingPierce += 2;
  proj.prevX = normalizeZero(hitX);
  proj.prevZ = hitZ;
  proj.x = normalizeZero(clamp(hitX + proj.vx * FIXED_DT, -TRACK_HALF_WIDTH + 0.18, TRACK_HALF_WIDTH - 0.18));
  proj.z = hitZ + proj.vz * FIXED_DT;
  ref.pulse = 1.0;
  events.push({ type: 'REFLECTOR_BOUNCE', x: hitX, z: hitZ });
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
  if (nextT <= 1e-9) {
    world.jumpTimer = 0;
    world.squadAirY = 0;
    // Touchdown Sky-Slam Shockwave!
    const slamRadius = 7.2;
    const slamDmg = 95 * world.mods.damageMult * (hasMutator(world, 'glass_cannon') ? 2.4 : 1.0);
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
export function createBossShoulderParts(world: SimWorld, bossMaxHp: number): SimBossPart[] {
  const partHp = Math.max(220, Math.round(bossMaxHp * 0.15));
  return [
    {
      id: allocEntityId(world),
      slot: 'left',
      label: '重火炮肩甲',
      prevX: -2.05,
      prevZ: -32.8,
      x: -2.05,
      z: -32.8,
      halfWidth: 0.88,
      halfDepth: 0.85,
      hp: partHp,
      maxHp: partHp,
      hitPulse: 0,
      destroyed: false,
    },
    {
      id: allocEntityId(world),
      slot: 'right',
      label: '虫巢孵化肩',
      prevX: 2.05,
      prevZ: -32.8,
      x: 2.05,
      z: -32.8,
      halfWidth: 0.88,
      halfDepth: 0.85,
      hp: partHp,
      maxHp: partHp,
      hitPulse: 0,
      destroyed: false,
    },
  ];
}

export function syncBossShoulderParts(boss: SimBossState): void {
  for (let i = 0; i < boss.parts.length; i++) {
    const pt = boss.parts[i]!;
    pt.prevX = pt.x;
    pt.prevZ = pt.z;
    const ox = pt.slot === 'left' ? -2.05 : 2.05;
    if (boss.id === 'hydra_02' && boss.phase === 2 && boss.secondaryCore) {
      const anchor = pt.slot === 'left' ? boss : boss.secondaryCore;
      pt.x = normalizeZero(clamp(anchor.x + (pt.slot === 'left' ? -1.2 : 1.2), -4.2, 4.2));
      pt.z = anchor.z + 1.05;
    } else {
      pt.x = normalizeZero(clamp(boss.x + ox, -4.2, 4.2));
      pt.z = boss.z + 1.15;
    }
    if (pt.hitPulse > 0) {
      const next = pt.hitPulse - 6.0 * FIXED_DT;
      pt.hitPulse = next <= 1e-9 ? 0 : next;
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
    boss.breakTimer = 4.0;
    addResonance(world, RESONANCE_GAIN_VAULT_BREAK, events);
    events.push({
      type: 'BOSS_PART_BREAK',
      slot: part.slot,
      label: part.label,
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
    vz: 5.4,
    radius: 1.08,
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

    if (orb.z > DESPAWN_Z || orb.z < -85) {
      world.doomOrbs.splice(i, 1);
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
