import type { RewardId, SimEvent } from '../types/game';
import {
  BASE_DRONE_DPS,
  BLADES_ANGULAR_SPEED,
  BLADES_BONUS_DRONES,
  BLADES_MAX_COUNT,
  DESPAWN_Z,
  FIXED_DT,
  MASTERY_DAMAGE_PER_VAULT,
  OVERDRIVE_BONUS_PIERCE,
  OVERDRIVE_FIRE_RATE_MULT,
  PLAYER_Z,
  PRISM_LENS_DAMAGE_MULT,
  PRISM_LENS_HALF_DEPTH,
  PRISM_LENS_HALF_WIDTH,
  PRISM_LENS_SPLIT_ANGLE_RAD,
  PRISM_LENS_SPLIT_OFFSET_X,
  RESONANCE_GAIN_VAULT_BREAK,
  SPAWN_Z,
  TRACK_HALF_WIDTH,
  VAULT_HALF_DEPTH,
  VAULT_HALF_WIDTH,
} from '../config/constants';
import { getVolleyStreamCount, getWeaponLevelStats } from '../config/weapons';
import {
  allocEntityId,
  type SimPrismLens,
  type SimProjectile,
  type SimVault,
  type SimWorld,
} from './entities';
import { clamp, clampSquadCount, computeProjectilePowerScale, normalizeZero } from './math';
import { addResonance } from './resonance';

export function spawnVault(
  world: SimWorld,
  x: number,
  z: number,
  vz: number,
  hp: number,
  reward: RewardId,
): SimVault {
  const vault = world.vaultPool.acquire();
  vault.id = allocEntityId(world);
  vault.prevX = normalizeZero(x);
  vault.prevZ = z;
  vault.x = normalizeZero(x);
  vault.z = z;
  vault.vz = vz;
  vault.halfWidth = VAULT_HALF_WIDTH;
  vault.halfDepth = VAULT_HALF_DEPTH;
  vault.maxHp = Math.max(1, hp);
  vault.hp = vault.maxHp;
  vault.displayHp = Math.ceil(Math.max(0, vault.hp));
  vault.rewardWeapon = reward;
  vault.broken = false;
  vault.hitPulse = 0;
  vault.active = true;
  world.vaults.push(vault);
  return vault;
}

export function spawnPrismLens(
  world: SimWorld,
  x: number,
  z: number,
  vz: number | null,
  driftAmp = 0,
  driftFreq = 0,
): SimPrismLens {
  const lens = world.lensPool.acquire();
  lens.id = allocEntityId(world);
  lens.baseX = normalizeZero(x);
  lens.prevX = lens.baseX;
  lens.prevZ = z;
  lens.x = lens.baseX;
  lens.z = z;
  lens.vz = vz;
  lens.driftAmp = driftAmp;
  lens.driftFreq = driftFreq;
  lens.age = 0;
  lens.halfWidth = PRISM_LENS_HALF_WIDTH;
  lens.halfDepth = PRISM_LENS_HALF_DEPTH;
  lens.pulse = 0;
  lens.active = true;
  world.lenses.push(lens);
  return lens;
}

export function damageVault(
  world: SimWorld,
  vault: SimVault,
  damage: number,
  events: SimEvent[],
): void {
  if (!vault.active || vault.broken || damage <= 0) {
    return;
  }

  vault.hitPulse = 1.0;
  vault.hp = Math.max(0, vault.hp - damage);
  vault.displayHp = Math.ceil(Math.max(0, vault.hp));

  if (vault.hp <= 0) {
    vault.broken = true;
    vault.hp = 0;
    vault.displayHp = 0;
    vault.active = false;

    world.stats.vaultsCracked += 1;
    world.masteryCount += 1;

    let emittedLevel: number;
    if (vault.rewardWeapon === 'blades') {
      world.bladesCount = Math.min(BLADES_MAX_COUNT, world.bladesCount + 1);
      world.squadCount = clampSquadCount(world.squadCount + BLADES_BONUS_DRONES);
      if (world.squadCount > world.stats.peakSquad) {
        world.stats.peakSquad = world.squadCount;
      }
      emittedLevel = world.bladesCount;
    } else {
      const prevLearned = world.learnedWeaponLevels[vault.rewardWeapon];
      const nextLevel = Math.min(3, Math.max(1, prevLearned + 1)) as 1 | 2 | 3;
      world.learnedWeaponLevels[vault.rewardWeapon] = nextLevel;
      world.weapon = vault.rewardWeapon;
      world.weaponLevel = nextLevel;
      emittedLevel = nextLevel;
    }

    events.push({
      type: 'VAULT_BREAK',
      x: vault.x,
      z: vault.z,
      reward: vault.rewardWeapon,
      newWeaponLevel: emittedLevel,
    });
    addResonance(world, RESONANCE_GAIN_VAULT_BREAK, events);
  } else {
    events.push({
      type: 'VAULT_HIT',
      x: vault.x,
      z: vault.z,
    });
  }
}

function emitPlayerVolley(world: SimWorld, events: SimEvent[]): void {
  if (world.squadCount <= 0) return;

  const weapon = world.weapon;
  const level = world.weaponLevel;
  const stats = getWeaponLevelStats(weapon, level);
  const streamCount = getVolleyStreamCount(weapon, level, world.squadCount);
  if (streamCount <= 0) return;

  const overdriveActive = world.overdriveTimer > 0;
  const masteryMult = 1 + MASTERY_DAMAGE_PER_VAULT * Math.max(0, world.masteryCount);
  // Total volley damage is normalized against base shotsPerSecond so Overdrive's 1.5x fire rate yields exact 1.5x DPS
  const totalVolleyDamage =
    (BASE_DRONE_DPS * world.squadCount * stats.dpsMult * masteryMult * world.mods.damageMult) /
    stats.shotsPerSecond;
  const damagePerProjectile = totalVolleyDamage / streamCount;
  const pierce = stats.basePierce + (overdriveActive ? OVERDRIVE_BONUS_PIERCE : 0);
  const powerScale = computeProjectilePowerScale(world.squadCount, level, false);
  const muzzleZ = PLAYER_Z - 0.35;

  for (let i = 0; i < streamCount; i++) {
    const proj = world.projectilePool.acquire();
    proj.id = allocEntityId(world);
    proj.weapon = weapon;
    proj.radius = stats.radius;
    proj.damage = damagePerProjectile;
    proj.remainingPierce = pierce;
    proj.amplified = false;
    proj.powerScale = powerScale;
    proj.hostile = false;
    proj.hostileLoss = 0;
    proj.maxRange = stats.maxRange;
    proj.splashRadius = stats.splashRadius;
    proj.splashDamageRatio = stats.splashDamageRatio;
    proj.cryoSlowDuration = stats.cryoSlowDuration;
    proj.sweepStartFraction = 0;
    proj.active = true;

    let spawnX = world.squadX;
    let vx = 0;
    let vz = -stats.projectileSpeed;

    if (weapon === 'scatter') {
      const frac = streamCount <= 1 ? 0 : i / (streamCount - 1) - 0.5;
      const angle = frac * stats.fanSpreadRad;
      vx = Math.sin(angle) * stats.projectileSpeed;
      vz = -Math.cos(angle) * stats.projectileSpeed;
      spawnX = clamp(world.squadX + frac * 0.28, -TRACK_HALF_WIDTH + 0.18, TRACK_HALF_WIDTH - 0.18);
    } else {
      const maxSpan =
        weapon === 'rail'
          ? Math.min(0.3, (streamCount - 1) * 0.1)
          : weapon === 'plasma'
            ? Math.min(0.32, (streamCount - 1) * 0.14)
            : Math.min(0.42, (streamCount - 1) * 0.046);
      const offset =
        streamCount <= 1 ? 0 : (-1 + (2 * i) / (streamCount - 1)) * maxSpan;
      spawnX = clamp(world.squadX + offset, -TRACK_HALF_WIDTH + 0.18, TRACK_HALF_WIDTH - 0.18);
    }

    proj.prevX = normalizeZero(spawnX);
    proj.prevZ = muzzleZ;
    proj.vx = vx;
    proj.vz = vz;
    proj.x = normalizeZero(proj.prevX + vx * FIXED_DT);
    proj.z = proj.prevZ + vz * FIXED_DT;
    proj.distanceTraveled = stats.projectileSpeed * FIXED_DT;

    world.projectiles.push(proj);
  }

  events.push({
    type: 'SHOOT',
    weapon,
    amplified: false,
  });
}

/**
 * Step 3a & 3b: Advances existing projectiles, emits ready player volleys,
 * and rotates Orbital Bit-Blades.
 */
export function stepProjectilesAndAutoFire(world: SimWorld, events: SimEvent[]): void {
  // 1. Advance existing projectiles (both friendly and hostile)
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    if (!p || !p.active) {
      if (p) world.projectilePool.release(p);
      world.projectiles.splice(i, 1);
      continue;
    }

    if (
      p.distanceTraveled >= p.maxRange ||
      p.z < SPAWN_Z - 6 ||
      p.z > DESPAWN_Z + 2 ||
      Math.abs(p.x) > TRACK_HALF_WIDTH + 3.5
    ) {
      world.projectilePool.release(p);
      world.projectiles.splice(i, 1);
      continue;
    }

    p.sweepStartFraction = 0;
    p.prevX = p.x;
    p.prevZ = p.z;
    p.x = normalizeZero(p.x + p.vx * FIXED_DT);
    p.z = p.z + p.vz * FIXED_DT;
    p.distanceTraveled += Math.hypot(p.vx, p.vz) * FIXED_DT;
  }

  // 2. Autonomous firing cadence
  if (world.squadCount > 0) {
    const stats = getWeaponLevelStats(world.weapon, world.weaponLevel);
    const overdriveMult = world.overdriveTimer > 0 ? OVERDRIVE_FIRE_RATE_MULT : 1.0;
    const interval = 1.0 / (stats.shotsPerSecond * overdriveMult);

    world.fireCooldown -= FIXED_DT;
    while (world.fireCooldown <= 1e-9) {
      emitPlayerVolley(world, events);
      world.fireCooldown += interval;
    }
  }

  // 3. Rotate Orbital Bit-Blades
  if (world.bladesCount > 0) {
    world.bladesAngle = (world.bladesAngle + BLADES_ANGULAR_SPEED * FIXED_DT) % (Math.PI * 2);
  }
}

/**
 * Splits an un-amplified friendly projectile through a Golden Prism Lens into
 * 2 amplified (1.35x damage) bolts with slight angular & lateral separation,
 * recording lens.id in hitIds so neither bolt can re-split on the same lens.
 */
export function refractProjectileAtLens(
  world: SimWorld,
  proj: SimProjectile,
  lens: SimPrismLens,
  hitX: number,
  hitZ: number,
  tEnter: number,
  events: SimEvent[],
): void {
  proj.hitIds.add(lens.id);
  const remFraction = Math.max(0, 1.0 - tEnter);

  const origVx = proj.vx;
  const origVz = proj.vz;
  const cosNeg = Math.cos(-PRISM_LENS_SPLIT_ANGLE_RAD);
  const sinNeg = Math.sin(-PRISM_LENS_SPLIT_ANGLE_RAD);
  const cosPos = Math.cos(PRISM_LENS_SPLIT_ANGLE_RAD);
  const sinPos = Math.sin(PRISM_LENS_SPLIT_ANGLE_RAD);

  const leftVx = origVx * cosNeg - origVz * sinNeg;
  const leftVz = origVx * sinNeg + origVz * cosNeg;
  const rightVx = origVx * cosPos - origVz * sinPos;
  const rightVz = origVx * sinPos + origVz * cosPos;

  const newDamage = proj.damage * PRISM_LENS_DAMAGE_MULT;
  const newScale = proj.powerScale * 1.18;

  // Mutate original bolt into Left Amplified Bolt
  const leftStartX = clamp(
    hitX - PRISM_LENS_SPLIT_OFFSET_X,
    -TRACK_HALF_WIDTH + 0.18,
    TRACK_HALF_WIDTH - 0.18,
  );
  proj.amplified = true;
  proj.damage = newDamage;
  proj.powerScale = newScale;
  proj.vx = leftVx;
  proj.vz = leftVz;
  proj.prevX = normalizeZero(leftStartX);
  proj.prevZ = hitZ;
  proj.x = normalizeZero(leftStartX + leftVx * FIXED_DT * remFraction);
  proj.z = hitZ + leftVz * FIXED_DT * remFraction;
  proj.sweepStartFraction = tEnter;

  // Spawn sibling Right Amplified Bolt
  const sibling = world.projectilePool.acquire();
  sibling.id = allocEntityId(world);
  sibling.weapon = proj.weapon;
  sibling.radius = proj.radius;
  sibling.damage = newDamage;
  sibling.remainingPierce = proj.remainingPierce;
  sibling.amplified = true;
  sibling.powerScale = newScale;
  sibling.hostile = false;
  sibling.hostileLoss = 0;
  sibling.distanceTraveled = proj.distanceTraveled;
  sibling.maxRange = proj.maxRange;
  sibling.splashRadius = proj.splashRadius;
  sibling.splashDamageRatio = proj.splashDamageRatio;
  sibling.cryoSlowDuration = proj.cryoSlowDuration;
  sibling.sweepStartFraction = tEnter;
  sibling.active = true;
  for (const hitId of proj.hitIds) {
    sibling.hitIds.add(hitId);
  }

  const rightStartX = clamp(
    hitX + PRISM_LENS_SPLIT_OFFSET_X,
    -TRACK_HALF_WIDTH + 0.18,
    TRACK_HALF_WIDTH - 0.18,
  );
  sibling.vx = rightVx;
  sibling.vz = rightVz;
  sibling.prevX = normalizeZero(rightStartX);
  sibling.prevZ = hitZ;
  sibling.x = normalizeZero(rightStartX + rightVx * FIXED_DT * remFraction);
  sibling.z = hitZ + rightVz * FIXED_DT * remFraction;

  world.projectiles.push(sibling);

  lens.pulse = 1.0;
  events.push({
    type: 'LENS_REFRACT',
    x: hitX,
    z: hitZ,
  });
}
