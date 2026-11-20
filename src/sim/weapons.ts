import type { RewardId, SimEvent, WeaponId } from '../types/game';
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
import { hasSynergy } from '../config/protocols';
import {
  allocEntityId,
  type SimPrismLens,
  type SimProjectile,
  type SimVault,
  type SimWorld,
} from './entities';
import { clamp, clampSquadCount, computeProjectilePowerScale, normalizeZero } from './math';
import { grantSquadWithReserve, hasMutator, syncActiveFusions, triggerOverlimitOpticEvolution } from './competition';
import { computeDynamicSwarmProfile } from './spawner';
import { addResonance } from './resonance';

/**
 * Toggles which of the player's 2 cultivated Main Weapons leads the primary 100% salvo!
 */
export function trySwapLeadWeapon(world: SimWorld, events: SimEvent[]): boolean {
  if (world.squadCount <= 0) return false;
  let nextWeapon: WeaponId | null = null;
  if (world.activeLoadout.length >= 2) {
    nextWeapon = world.weapon === world.activeLoadout[0] ? world.activeLoadout[1]! : world.activeLoadout[0]!;
  } else if (world.activeLoadout.length === 1 && world.activeLoadout[0] !== 'pulse' && world.learnedWeaponLevels.pulse > 0) {
    nextWeapon = world.weapon === world.activeLoadout[0] ? 'pulse' : world.activeLoadout[0]!;
  }
  if (!nextWeapon || nextWeapon === world.weapon) return false;
  const lv = Math.max(1, world.learnedWeaponLevels[nextWeapon]) as 1 | 2 | 3;
  world.weapon = nextWeapon;
  world.weaponLevel = lv;
  world.fireCooldown = Math.min(world.fireCooldown, 0.035);
  events.push({ type: 'WEAPON_SWAP', weapon: nextWeapon, level: lv });
  return true;
}

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
    let salvaged = false;
    if (vault.rewardWeapon === 'blades') {
      world.bladesCount = Math.min(BLADES_MAX_COUNT, world.bladesCount + 1);
      grantSquadWithReserve(world, BLADES_BONUS_DRONES, events);
      emittedLevel = world.bladesCount;
    } else {
      const rw = vault.rewardWeapon;
      const loadout = world.activeLoadout;
      const inLoadout = loadout.includes(rw);
      // Fusion Partner Completion: if you just pivoted to a new lead weapon (e.g. scatter Lv.2) and crack its exact Fusion mate (rail), lock in the pair!
      const leadW = loadout.length > 0 ? loadout[loadout.length - 1]! : null;
      const completesLeadFusion =
        (leadW === 'scatter' && rw === 'rail' && world.learnedWeaponLevels.scatter >= 2) ||
        (leadW === 'rail' && rw === 'scatter' && world.learnedWeaponLevels.rail >= 2) ||
        (leadW === 'plasma' && rw === 'cryo' && world.learnedWeaponLevels.plasma >= 2) ||
        (leadW === 'cryo' && rw === 'plasma' && world.learnedWeaponLevels.cryo >= 2);
      const completesSwordFusion = rw === 'pulse' && world.bladesCount > 0;

      if (inLoadout || loadout.length < 2) {
        if (!inLoadout) loadout.push(rw);
        world.pendingSwapWeapon = null;
        const prevLearned = world.learnedWeaponLevels[rw];
        if (prevLearned >= 3) {
          world.overclockStacks += 1;
        }
        const nextLevel = Math.min(3, Math.max(1, prevLearned + 1)) as 1 | 2 | 3;
        world.learnedWeaponLevels[rw] = nextLevel;
        world.weapon = rw;
        world.weaponLevel = nextLevel;
        emittedLevel = prevLearned >= 3 ? 3 + world.overclockStacks : nextLevel;
      } else if (world.pendingSwapWeapon === rw || completesLeadFusion || completesSwordFusion) {
        // Deliberate 2nd off-spec pickup (or unlocked Sword-Array completion): Pivot Build ("更换构筑")!
        world.pendingSwapWeapon = null;
        world.primaryFusion = null;
        loadout.shift();
        loadout.push(rw);
        const prevLearned = world.learnedWeaponLevels[rw];
        const minPivotLv = completesLeadFusion && prevLearned === 0 ? 1 : 2;
        const nextLevel = Math.min(3, Math.max(minPivotLv, prevLearned + 1)) as 1 | 2 | 3;
        world.learnedWeaponLevels[rw] = nextLevel;
        world.weapon = rw;
        world.weaponLevel = nextLevel;
        emittedLevel = nextLevel;
      } else {
        // 1st off-spec Vault while 2 Main Weapons are active: Salvage into Active Build Upgrade + Reserve Supply!
        salvaged = true;
        world.pendingSwapWeapon = rw;
        world.learnedWeaponLevels[rw] = Math.max(1, world.learnedWeaponLevels[rw]) as 1 | 2 | 3;
        const w0 = loadout[0]!;
        const w1 = loadout[1]!;
        const targetW = world.learnedWeaponLevels[w0] <= world.learnedWeaponLevels[w1] ? w0 : w1;
        const prevT = world.learnedWeaponLevels[targetW];
        if (prevT < 3) {
          const nextT = (prevT + 1) as 2 | 3;
          world.learnedWeaponLevels[targetW] = nextT;
          if (world.weapon === targetW) world.weaponLevel = nextT;
          emittedLevel = nextT;
        } else {
          world.overclockStacks += 1;
          emittedLevel = 3 + world.overclockStacks;
        }
        grantSquadWithReserve(world, 8, events);
        events.push({
          type: 'VAULT_SALVAGE',
          x: vault.x,
          z: vault.z,
          upgradedWeapon: targetW,
          newLevel: emittedLevel,
          reserveGain: 8,
        });
      }

      // Trigger 12.0s Ultimate Tri-Fusion Climax on every 3rd Overclock after locking a Core Fusion!
      if (world.primaryFusion !== null && world.overclockStacks >= 2 && world.overclockStacks % 2 === 0 && world.triFusionTimer <= 0) {
        world.triFusionTimer = 12.0;
        events.push({ type: 'TRI_FUSION_CLIMAX', duration: 12.0 });
      }
    }

    if (!salvaged) {
      events.push({
        type: 'VAULT_BREAK',
        x: vault.x,
        z: vault.z,
        reward: vault.rewardWeapon,
        newWeaponLevel: emittedLevel,
      });
    }
    world.swarmDirectorTimer = Math.min(world.swarmDirectorTimer, 0.06);
    syncActiveFusions(world, events);
    addResonance(world, salvaged ? 0.32 : RESONANCE_GAIN_VAULT_BREAK, events);
  } else {
    events.push({
      type: 'VAULT_HIT',
      x: vault.x,
      z: vault.z,
    });
  }
}

/**
 * Smart Edge Aim Convergence: when the squad is nearly aligned (<= 2.15m laterally) with a high-priority
 * tactical target (unreflected Doom-Orb, charging Boss Shoulder, Shield Pylon, or Gold Mutable Gate),
 * gently converges outer volley streams inward so players don't suffer frustrating edge-leak misses.
 */
function findSmartAimTarget(world: SimWorld): { x: number; z: number } | null {
  const sx = world.squadX;
  const minZ = PLAYER_Z - 29.0;
  const maxZ = PLAYER_Z - 1.2;
  let best: { x: number; z: number; prio: number } | null = null;

  for (let i = 0; i < world.doomOrbs.length; i++) {
    const o = world.doomOrbs[i]!;
    if (o.active && !o.reflected && o.z >= minZ && o.z <= maxZ && Math.abs(o.x - sx) <= 2.15) {
      const prio = 100 - Math.abs(o.x - sx) * 10;
      if (!best || prio > best.prio) best = { x: o.x, z: o.z, prio };
    }
  }
  if (world.boss && world.boss.active) {
    for (let i = 0; i < world.boss.pylons.length; i++) {
      const py = world.boss.pylons[i]!;
      if (!py.destroyed && py.z >= minZ && py.z <= maxZ && Math.abs(py.x - sx) <= 2.25) {
        const prio = 92 - Math.abs(py.x - sx) * 8;
        if (!best || prio > best.prio) best = { x: py.x, z: py.z, prio };
      }
    }
    for (let i = 0; i < world.boss.parts.length; i++) {
      const pt = world.boss.parts[i]!;
      if (!pt.destroyed && pt.z >= minZ && pt.z <= maxZ && Math.abs(pt.x - sx) <= 2.2) {
        const prio = (pt.telegraph > 0.1 ? 88 : 74) - Math.abs(pt.x - sx) * 8;
        if (!best || prio > best.prio) best = { x: pt.x, z: pt.z, prio };
      }
    }
  }
  for (let i = 0; i < world.gates.length; i++) {
    const g = world.gates[i]!;
    if (g.active && !g.triggered && !g.dimmed && g.mutable && g.z >= minZ && g.z <= maxZ && Math.abs(g.x - sx) <= 2.05) {
      const prio = 68 - Math.abs(g.x - sx) * 8;
      if (!best || prio > best.prio) best = { x: g.x, z: g.z, prio };
    }
  }
  return best ? { x: best.x, z: best.z } : null;
}

function emitPlayerVolley(world: SimWorld, events: SimEvent[]): void {
  if (world.squadCount <= 0) return;

  const weapon = world.weapon;
  const level = world.weaponLevel;
  const stats = getWeaponLevelStats(weapon, level);
  const streamCount = getVolleyStreamCount(weapon, level, world.squadCount);
  if (streamCount <= 0) return;

  const overdriveActive = world.overdriveTimer > 0;
  const m = Math.max(0, world.masteryCount);
  const masteryMult = m <= 6 ? 1 + MASTERY_DAMAGE_PER_VAULT * m : 1 + MASTERY_DAMAGE_PER_VAULT * 6 + (m - 6) * 0.03;
  const synMult = hasSynergy(world.endless?.upgrades, 'singularity_matrix') ? 1.15 : 1.0;
  const synPierce = hasSynergy(world.endless?.upgrades, 'singularity_matrix') ? 1 : 0;
  const ocPierce = world.overclockStacks >= 4 ? 2 : world.overclockStacks >= 2 ? 1 : 0;
  const glassMult = hasMutator(world, 'glass_cannon') ? 2.0 : 1.0;
  const twinActive = hasMutator(world, 'mirror_twin') && Math.abs(world.squadX) > 0.45;
  const wingMult = twinActive ? 0.58 : 1.0; // Twin wings fire 0.58x each = 1.16x total symmetrical firepower!
  const reactorRingMult = world.reactorPrismRingTimer > 0 ? 1.22 : 1.0;
  const totalVolleyDamage =
    (BASE_DRONE_DPS * world.squadCount * stats.dpsMult * masteryMult * world.mods.damageMult * synMult * glassMult * wingMult * reactorRingMult) /
    stats.shotsPerSecond;
  const damagePerProjectile = totalVolleyDamage / streamCount;
  const liveSwarmMult = computeDynamicSwarmProfile(world).swarmMult;
  const swarmPierce = liveSwarmMult >= 4.2 ? 3 : liveSwarmMult >= 2.6 ? 2 : liveSwarmMult >= 1.75 ? 1 : 0;
  const dualPierce =
    (world.activeDualSynergy === 'overcharge_rail_grid' ? 1 : 0) +
    (world.overlimitResonance === 'hyper_rail_flechette' ? 2 : 0) +
    (world.magBoostTimer > 0 ? 2 : 0);
  const pierce = stats.basePierce + (overdriveActive ? OVERDRIVE_BONUS_PIERCE : 0) + synPierce + ocPierce + dualPierce + swarmPierce;
  const powerScale = computeProjectilePowerScale(world.squadCount, level, false);
  const volleyIdx = world.volleyIndex;
  world.volleyIndex = (volleyIdx + 1) & 0x3fffffff;
  const squadSpan = clamp(world.formationRadius * 0.76, 0.28, 1.22);
  const smartTarget = findSmartAimTarget(world);
  const stormBarrage = world.activeDualSynergy === 'prism_storm_barrage';

  for (let i = 0; i < streamCount; i++) {
    const proj = world.projectilePool.acquire();
    proj.id = allocEntityId(world);
    proj.weapon = weapon;
    proj.radius = stats.radius;
    proj.damage = damagePerProjectile;
    proj.remainingPierce = pierce;
    proj.amplified = false;
  proj.hitWingmanMirror = false;
  proj.hitFixedMirror = false;
    proj.powerScale = powerScale;
    proj.hostile = false;
    proj.hostileLoss = 0;
    proj.maxRange = stats.maxRange;
    proj.splashRadius = stats.splashRadius;
    proj.splashDamageRatio = stats.splashDamageRatio;
    proj.cryoSlowDuration = stats.cryoSlowDuration;
    proj.sweepStartFraction = 0;
    proj.active = true;

    const frac = streamCount <= 1 ? 0 : i / (streamCount - 1) - 0.5;
    const absNorm = Math.abs(frac) * 2;
    let spawnX = world.squadX;
    let vx = 0;
    let vz = -(stats.projectileSpeed * (world.magBoostTimer > 0 ? 1.18 : 1.0));

    if (weapon === 'scatter') {
      const spreadRad = stormBarrage ? stats.fanSpreadRad * 0.78 : stats.fanSpreadRad;
      const angle = frac * spreadRad;
      vx = Math.sin(angle) * stats.projectileSpeed;
      vz = -Math.cos(angle) * stats.projectileSpeed;
      const scatterSpan = streamCount <= 1 ? 0 : Math.min(0.85, Math.max(0.26, squadSpan * 0.72));
      spawnX = clamp(world.squadX + frac * 2 * scatterSpan, -TRACK_HALF_WIDTH + 0.18, TRACK_HALF_WIDTH - 0.18);
    } else {
      const maxSpan =
        streamCount <= 1
          ? 0
          : weapon === 'rail'
            ? Math.min(1.08, Math.max(squadSpan * 0.88, (streamCount - 1) * 0.18))
            : weapon === 'plasma'
              ? Math.min(1.12, Math.max(squadSpan * 0.86, (streamCount - 1) * 0.20))
              : Math.min(1.22, Math.max(squadSpan, Math.min(1.18, (streamCount - 1) * 0.14)));
      const offset = frac * 2 * maxSpan;
      spawnX = clamp(world.squadX + offset, -TRACK_HALF_WIDTH + 0.18, TRACK_HALF_WIDTH - 0.18);
      // Gentle inward focus on outer wing troopers so full-width volleys still hammer Siphons & Barrels!
      const excess = Math.max(0, Math.abs(offset) - 0.62);
      if (excess > 0) {
        vx = -Math.sign(offset) * excess * 1.9;
        vz = -Math.sqrt(Math.max(1, stats.projectileSpeed * stats.projectileSpeed - vx * vx));
      }
    }

    if (smartTarget !== null && Math.abs(spawnX - world.squadX) > 0.16) {
      const dzToTarget = Math.max(4.5, PLAYER_Z - 0.6 - smartTarget.z);
      const flightT = dzToTarget / Math.max(12, stats.projectileSpeed);
      const desiredVx = clamp((smartTarget.x - spawnX) / flightT, -5.2, 5.2);
      vx = vx * 0.62 + desiredVx * 0.38;
      vz = -Math.sqrt(Math.max(1, stats.projectileSpeed * stats.projectileSpeed - vx * vx));
    }

    // Multi-rank chevron + 3-step alternating ripple in [PLAYER_Z - 0.76, PLAYER_Z - 0.30]
    const rankWave = streamCount <= 1 ? 0 : ((i + volleyIdx) % 3) * 0.12;
    const muzzleZ = PLAYER_Z - 0.76 + absNorm * 0.22 + rankWave;

    proj.prevX = normalizeZero(spawnX);
    proj.prevZ = muzzleZ;
    proj.vx = vx;
    proj.vz = vz;
    proj.x = normalizeZero(proj.prevX + vx * FIXED_DT);
    proj.z = proj.prevZ + vz * FIXED_DT;
    proj.distanceTraveled = stats.projectileSpeed * FIXED_DT;

    world.projectiles.push(proj);

    if (twinActive) {
      const twin = world.projectilePool.acquire();
      twin.id = allocEntityId(world);
      twin.weapon = weapon;
      twin.radius = stats.radius;
      twin.damage = damagePerProjectile;
      twin.remainingPierce = pierce;
      twin.amplified = false;
      twin.powerScale = powerScale * 0.92;
      twin.hostile = false;
      twin.hostileLoss = 0;
      twin.maxRange = stats.maxRange;
      twin.splashRadius = stats.splashRadius;
      twin.splashDamageRatio = stats.splashDamageRatio;
      twin.cryoSlowDuration = stats.cryoSlowDuration;
      twin.sweepStartFraction = 0;
      twin.active = true;
      const twinSpawnX = clamp(-spawnX, -TRACK_HALF_WIDTH + 0.18, TRACK_HALF_WIDTH - 0.18);
      twin.prevX = normalizeZero(twinSpawnX);
      twin.prevZ = muzzleZ;
      twin.vx = -vx;
      twin.vz = vz;
      twin.x = normalizeZero(twin.prevX + twin.vx * FIXED_DT);
      twin.z = twin.prevZ + twin.vz * FIXED_DT;
      twin.distanceTraveled = stats.projectileSpeed * FIXED_DT;
      world.projectiles.push(twin);
    }
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
function emitAuxiliaryVolley(
  world: SimWorld,
  auxWeapon: WeaponId,
  auxLevel: 1 | 2 | 3,
  events: SimEvent[],
): void {
  if (world.squadCount <= 0) return;
  const stats = getWeaponLevelStats(auxWeapon, auxLevel);
  // Crisp recognizable secondary salvo streams (2..6 streams depending on weapon & squadCount)
  const fullStreams = getVolleyStreamCount(auxWeapon, auxLevel, world.squadCount);
  const streamCount =
    auxWeapon === 'scatter'
      ? Math.min(7, Math.max(3, Math.ceil(fullStreams * 0.45)))
      : auxWeapon === 'plasma' || auxWeapon === 'rail'
        ? Math.min(4, Math.max(2, Math.ceil(fullStreams * 0.5)))
        : Math.min(6, Math.max(2, Math.ceil(fullStreams * 0.42)));

  const overdriveActive = world.overdriveTimer > 0;
  const m = Math.max(0, world.masteryCount);
  const masteryMult = m <= 6 ? 1 + MASTERY_DAMAGE_PER_VAULT * m : 1 + MASTERY_DAMAGE_PER_VAULT * 6 + (m - 6) * 0.03;
  const synMult = hasSynergy(world.endless?.upgrades, 'singularity_matrix') ? 1.15 : 1.0;
  const synPierce = hasSynergy(world.endless?.upgrades, 'singularity_matrix') ? 1 : 0;
  const glassMult = hasMutator(world, 'glass_cannon') ? 2.0 : 1.0;
  const twinActive = hasMutator(world, 'mirror_twin') && Math.abs(world.squadX) > 0.45;
  const twinScalar = twinActive ? 1.16 : 1.0;
  const auxPowerRatio = 0.28 + auxLevel * 0.07 + Math.min(0.16, world.overclockStacks * 0.03);
  const totalAuxDamage =
    ((BASE_DRONE_DPS * world.squadCount * stats.dpsMult * masteryMult * world.mods.damageMult * synMult * glassMult * twinScalar) /
      stats.shotsPerSecond) *
    auxPowerRatio;
  const damagePerProjectile = totalAuxDamage / streamCount;
  const auxSwarmMult = computeDynamicSwarmProfile(world).swarmMult;
  const auxSwarmPierce = auxSwarmMult >= 3.5 ? 2 : auxSwarmMult >= 1.85 ? 1 : 0;
  const pierce = stats.basePierce + (overdriveActive ? OVERDRIVE_BONUS_PIERCE : 0) + synPierce + auxSwarmPierce;
  const powerScale = computeProjectilePowerScale(world.squadCount, auxLevel, false) * 0.92;
  const wingSpan = clamp(world.formationRadius * 0.88, 0.42, 1.38);

  for (let i = 0; i < streamCount; i++) {
    const proj = world.projectilePool.acquire();
    proj.id = allocEntityId(world);
    proj.weapon = auxWeapon;
    proj.radius = stats.radius;
    proj.damage = damagePerProjectile;
    proj.remainingPierce = pierce;
    proj.amplified = false;
  proj.hitWingmanMirror = false;
  proj.hitFixedMirror = false;
    proj.powerScale = powerScale;
    proj.hostile = false;
    proj.hostileLoss = 0;
    proj.maxRange = stats.maxRange;
    proj.splashRadius = stats.splashRadius;
    proj.splashDamageRatio = stats.splashDamageRatio;
    proj.cryoSlowDuration = stats.cryoSlowDuration;
    proj.sweepStartFraction = 0;
    proj.active = true;

    const frac = streamCount <= 1 ? 0 : i / (streamCount - 1) - 0.5;
    let vx = 0;
    let vz = -stats.projectileSpeed;
    let spawnX = world.squadX;

    if (auxWeapon === 'scatter') {
      const angle = frac * stats.fanSpreadRad * 1.05;
      vx = Math.sin(angle) * stats.projectileSpeed;
      vz = -Math.cos(angle) * stats.projectileSpeed;
      spawnX = clamp(world.squadX + frac * 1.4 * wingSpan, -TRACK_HALF_WIDTH + 0.18, TRACK_HALF_WIDTH - 0.18);
    } else {
      // Mount auxiliary salvos on outer wing positions so primary + secondary streams weave distinctly!
      const offset = frac * 2 * wingSpan;
      spawnX = clamp(world.squadX + offset, -TRACK_HALF_WIDTH + 0.18, TRACK_HALF_WIDTH - 0.18);
      if (Math.abs(offset) > 0.55) {
        vx = -Math.sign(offset) * (Math.abs(offset) - 0.55) * 1.75;
        vz = -Math.sqrt(Math.max(1, stats.projectileSpeed * stats.projectileSpeed - vx * vx));
      }
    }

    const muzzleZ = PLAYER_Z - 0.52 + Math.abs(frac) * 0.28;
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
    weapon: auxWeapon,
    amplified: false,
    auxiliary: true,
  });
}

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

  // 2. Autonomous firing cadence + Rampage attack-speed stack + Multi-Arsenal Co-Firing Salvos!
  if (world.squadCount > 0) {
    const stats = getWeaponLevelStats(world.weapon, world.weaponLevel);
    const overdriveMult = world.overdriveTimer > 0 ? OVERDRIVE_FIRE_RATE_MULT : 1.0;
    const rampageRateMult =
      world.rampageStacks >= 6
        ? 1.0 + Math.min(0.36, Math.floor(world.rampageStacks / 6) * 0.045)
        : 1.0;
    const stormRateMult = world.activeDualSynergy === 'prism_storm_barrage' ? 1.16 : 1.0;
    const weapProtoLv = world.endless?.upgrades.weapon ?? 0;
    const weapProtoRate = weapProtoLv >= 2 ? 1.0 + Math.min(0.24, (weapProtoLv - 1) * 0.08) : 1.0;
    const interval = 1.0 / ((stats.shotsPerSecond * (world.phaseSyncTimer > 0 ? 1.22 : 1.0)) * overdriveMult * rampageRateMult * stormRateMult * weapProtoRate);

    world.fireCooldown -= FIXED_DT;
    while (world.fireCooldown <= 1e-9) {
      emitPlayerVolley(world, events);
      world.fireCooldown += interval;
    }

    // 2-Weapon Active Loadout Co-Firing: only your cultivated Main Partner Weapon (+ light starter pulse drones) co-fires!
    if (world.stats.vaultsCracked > 0 || world.weapon !== 'pulse') {
      const ALL_W: readonly WeaponId[] = ['pulse', 'scatter', 'rail', 'plasma', 'cryo'];
      for (let wIdx = 0; wIdx < ALL_W.length; wIdx++) {
        const auxW = ALL_W[wIdx]!;
        if (auxW === world.weapon) continue;
        const inLoadout = world.activeLoadout.length === 0 || world.activeLoadout.includes(auxW) || auxW === 'pulse';
        if (!inLoadout) continue;
        const auxLvl = world.learnedWeaponLevels[auxW];
        if (auxLvl <= 0) continue;

        const auxStats = getWeaponLevelStats(auxW, auxLvl as 1 | 2 | 3);
        const auxCadence = auxStats.shotsPerSecond * (0.38 + auxLvl * 0.1) * overdriveMult * rampageRateMult;
        const auxInterval = 1.0 / Math.max(0.5, auxCadence);
        world.auxCooldowns[auxW] -= FIXED_DT;
        while (world.auxCooldowns[auxW] <= 1e-9) {
          emitAuxiliaryVolley(world, auxW, auxLvl as 1 | 2 | 3, events);
          world.auxCooldowns[auxW] += auxInterval;
        }
      }
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

  const specRicMult = 1 + Math.max(0, world.mods.specRicochet ?? 0) * 0.12;
  const newDamage = proj.damage * PRISM_LENS_DAMAGE_MULT * specRicMult;
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
  triggerOverlimitOpticEvolution(world, proj, hitX, hitZ, events);
}

/**
 * Single source of truth for actual simulated Squad DPS (unifies HUD, Boss Encounter Calibration & Battle Report!).
 */
export function computeAuthoritativeEffectiveDps(world: SimWorld, includeTemporaryBursts = true): number {
  if (world.squadCount <= 0) return 0;
  const m = Math.max(0, world.masteryCount);
  const masteryMult = m <= 6 ? 1 + MASTERY_DAMAGE_PER_VAULT * m : 1 + MASTERY_DAMAGE_PER_VAULT * 6 + (m - 6) * 0.03;
  const synMult = hasSynergy(world.endless?.upgrades, 'singularity_matrix') ? 1.15 : 1.0;
  const glassMult = hasMutator(world, 'glass_cannon') ? 2.0 : 1.0;
  const twinMult = hasMutator(world, 'mirror_twin') && Math.abs(world.squadX) > 0.45 ? 1.16 : 1.0;
  const overdriveMult = includeTemporaryBursts && world.overdriveTimer > 0 ? OVERDRIVE_FIRE_RATE_MULT : 1.0;
  const rampageMult =
    includeTemporaryBursts && world.rampageStacks >= 6
      ? 1.0 + Math.min(0.36, Math.floor(world.rampageStacks / 6) * 0.045)
      : 1.0;

  const leadStats = getWeaponLevelStats(world.weapon, world.weaponLevel);
  let totalDps = BASE_DRONE_DPS * world.squadCount * leadStats.dpsMult;

  if (world.stats.vaultsCracked > 0 || world.weapon !== 'pulse') {
    const ALL_W: readonly WeaponId[] = ['pulse', 'scatter', 'rail', 'plasma', 'cryo'];
    for (let i = 0; i < ALL_W.length; i++) {
      const auxW = ALL_W[i]!;
      if (auxW === world.weapon) continue;
      const inLoadout = world.activeLoadout.length === 0 || world.activeLoadout.includes(auxW) || auxW === 'pulse';
      if (!inLoadout) continue;
      const auxLvl = world.learnedWeaponLevels[auxW];
      if (auxLvl <= 0) continue;
      const auxStats = getWeaponLevelStats(auxW, auxLvl as 1 | 2 | 3);
      const auxPowerRatio = 0.28 + auxLvl * 0.07 + Math.min(0.16, world.overclockStacks * 0.03);
      const auxCadenceRatio = 0.38 + auxLvl * 0.1;
      totalDps += BASE_DRONE_DPS * world.squadCount * auxStats.dpsMult * auxPowerRatio * auxCadenceRatio;
    }
  }

  const dualDpsMult = world.activeDualSynergy === 'prism_storm_barrage' ? 1.16 : world.activeDualSynergy ? 1.12 : 1.0;
  return totalDps * masteryMult * world.mods.damageMult * synMult * glassMult * twinMult * overdriveMult * rampageMult * dualDpsMult;
}
