import { triggerWingmanAegisCounter } from './v22Mechanics';
import { FIXED_DT, PLAYER_Z } from '../config/constants';
import { hasSynergy } from '../config/protocols';
import type { SimEvent } from '../types/game';
import { damageEnemy } from './enemies';
import { allocEntityId, type SimWorld } from './entities';
import { clamp, normalizeZero } from './math';
import { recordDamage, spawnOrRefreshSingularity } from './competition';
import { addResonance } from './resonance';
import { hasChip, tryParryBossOmegaBeam } from './v20Mechanics';
import { triggerCoreReactorDomainPulse } from './v21Mechanics';

const AEGIS_ORB_CLEAR_RADIUS = 6.2;
const AEGIS_REPEL_RADIUS = 5.2;
const AEGIS_SHOCK_DAMAGE = 55;
const AEGIS_SLOW_SEC = 1.8;

export function tryTriggerAegisPulse(
  world: SimWorld,
  events: SimEvent[],
  autoTriggered = false,
): boolean {
  if (world.squadCount <= 0) return false;
  if (!autoTriggered && world.aegisCooldown > 1e-9) {
    return false;
  }

  world.aegisTimer = Math.max(world.aegisTimer, world.aegisDurationSec);
  if (!autoTriggered) {
    world.aegisCooldown = world.aegisMaxCooldown;
  }
  if (hasChip(world, 'chip_phase_blink')) {
    world.phaseSyncTimer = Math.max(world.phaseSyncTimer, 1.65);
    world.magBoostTimer = Math.max(world.magBoostTimer, 1.65);
  }
  const omegaBeamParried = !autoTriggered && tryParryBossOmegaBeam(world, events);
  if (!autoTriggered) {
    triggerCoreReactorDomainPulse(world, 'aegis', events);
  }
  triggerWingmanAegisCounter(world, events);

  let orbsCleared = 0;
  const reflectOrbs = (world.endless?.upgrades.resonance ?? 0) >= 1;
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    if (!p || !p.active || !p.hostile) continue;
    if (Math.hypot(p.x - world.squadX, p.z - PLAYER_Z) <= AEGIS_ORB_CLEAR_RADIUS) {
      const ox = p.x;
      const oz = p.z;
      p.active = false;
      world.projectilePool.release(p);
      world.projectiles.splice(i, 1);
      orbsCleared += 1;

      if (reflectOrbs) {
        const counter = world.projectilePool.acquire();
        counter.id = allocEntityId(world);
        counter.weapon = 'rail';
        counter.radius = 0.34;
        counter.damage = Math.max(95, world.trueSquadDps * 0.45);
        counter.remainingPierce = 3;
        counter.amplified = true;
        counter.powerScale = 1.45;
        counter.hostile = false;
        counter.hostileLoss = 0;
        counter.maxRange = 46;
        counter.splashRadius = 2.0;
        counter.splashDamageRatio = 0.5;
        counter.cryoSlowDuration = 0;
        counter.sweepStartFraction = 0;
        counter.active = true;
        const tx = world.boss && world.boss.active ? world.boss.x : world.enemies[0]?.x ?? ox;
        const tz = world.boss && world.boss.active ? world.boss.z : world.enemies[0]?.z ?? oz - 20;
        const ang = Math.atan2(tx - ox, tz - oz);
        counter.vx = Math.sin(ang) * 34;
        counter.vz = Math.min(-18, Math.cos(ang) * 34);
        counter.prevX = normalizeZero(ox);
        counter.prevZ = oz;
        counter.x = normalizeZero(ox + counter.vx * FIXED_DT);
        counter.z = oz + counter.vz * FIXED_DT;
        counter.distanceTraveled = 34 * FIXED_DT;
        world.projectiles.push(counter);
      }
    }
  }

  // Singularity Guard Protocol: Phase Aegis Pulse also collapses a mini Gravity Singularity ahead!
  if ((world.endless?.upgrades.blades ?? 0) >= 1) {
    spawnOrRefreshSingularity(world, world.squadX, PLAYER_Z - 4.4, events, 4.0, 2.4);
  }

  let enemiesRepelled = 0;
  let rushInterrupted = false;
  const shockDamage = AEGIS_SHOCK_DAMAGE * world.mods.damageMult;
  // Snapshot current length because Mitosis split may append children
  const enemyLen = world.enemies.length;
  for (let i = 0; i < enemyLen; i++) {
    const e = world.enemies[i];
    if (!e || !e.active || e.consumed || e.bypassed || e.hp <= 0) continue;
    const dist = Math.hypot(e.x - world.squadX, e.z - PLAYER_Z);
    if (dist <= AEGIS_REPEL_RADIUS + e.radius) {
      if (
        (e.kind === 'dasher' && (e.dasherState === 'DASH' || e.telegraphTimer > 0)) ||
        (e.kind === 'burrower' && e.specialAcc > 0)
      ) {
        rushInterrupted = true;
      }
      const pushedZ = clamp(Math.min(e.z - 3.4, PLAYER_Z - 3.6), -76, PLAYER_Z - 1.2);
      e.z = normalizeZero(pushedZ);
      e.prevZ = e.z;
      if (e.kind === 'dasher' && (e.dasherState === 'DASH' || e.telegraphTimer > 0)) {
        e.dasherState = 'APPROACH';
        e.telegraphTimer = 0;
      }
      enemiesRepelled += 1;
      recordDamage(world, 'deflect', Math.min(e.hp, shockDamage));
      damageEnemy(world, e, shockDamage, AEGIS_SLOW_SEC, events);
    }
  }

  // Timely Parry Check: clearing >=2 incoming orbs, interrupting a Dasher/Burrower rush, OR pulsing right before a Boss Hazard Strike!
  const hazardImminent = Boolean(
    world.boss &&
      world.boss.active &&
      world.boss.hazardZones.some(
        (hz) => (hz.firing || hz.warningProgress >= 0.62) && Math.abs(world.squadX - hz.x) <= hz.halfWidth + 0.5,
      ),
  );
  if (!autoTriggered && (omegaBeamParried || orbsCleared >= 2 || hazardImminent || rushInterrupted)) {
    const chipNova = hasChip(world, 'chip_aegis_nova');
    const shatterRefund = 2.6 + Math.max(0, world.mods.specShatter ?? 0) * 0.6 + (chipNova ? 1.8 : 0);
    world.aegisCooldown = Math.max(0.8, world.aegisCooldown - shatterRefund);
    addResonance(world, 0.32, events);
    if (chipNova) {
      const novaDmg = 145 * world.mods.damageMult;
      for (let i = 0; i < world.enemies.length; i++) {
        const ne = world.enemies[i];
        if (ne && ne.active && !ne.consumed && !ne.bypassed && ne.hp > 0 && Math.hypot(ne.x - world.squadX, ne.z - PLAYER_Z) <= 7.8) {
          recordDamage(world, 'deflect', Math.min(ne.hp, novaDmg));
          damageEnemy(world, ne, novaDmg, 2.0, events, { bypassShield: true });
        }
      }
    }
    events.push({ type: 'AEGIS_PARRY', x: world.squadX, z: PLAYER_Z, blocked: Math.max(1, orbsCleared) });
  }

  events.push({
    type: 'AEGIS_PULSE',
    x: world.squadX,
    z: PLAYER_Z,
    orbsCleared,
    enemiesRepelled,
    ...(autoTriggered ? { autoTriggered: true } : {}),
  });
  return true;
}

export function mitigateLossWithAegis(
  world: SimWorld,
  rawLoss: number,
  events: SimEvent[],
): number {
  if (rawLoss <= 0) return 0;
  let loss = rawLoss;

  if (hasSynergy(world.endless?.upgrades, 'immortal_legion')) {
    loss = Math.max(1, Math.floor(loss * 0.75));
  }

  if (
    world.aegisTimer <= 0 &&
    world.autoAegisCharges > 0 &&
    (loss >= world.squadCount || loss >= Math.max(4, Math.ceil(world.squadCount * 0.45)))
  ) {
    world.autoAegisCharges -= 1;
    tryTriggerAegisPulse(world, events, true);
  }

  if (world.aegisTimer > 0) {
    loss = Math.max(0, Math.floor(loss * 0.5));
  }

  return loss;
}

export function getEffectiveCritChance(world: SimWorld): number {
  const base = world.mods.critChance ?? 0;
  const syn = hasSynergy(world.endless?.upgrades, 'hyper_annihilation') ? 0.18 : 0;
  const gc = world.mods.mutators?.includes('glass_cannon') ? 0.25 : 0;
  const air = world.squadAirY > 0.6 ? 0.45 : 0;
  return Math.min(0.9, Math.max(0, base + syn + gc + air));
}

export function rollDeterministicCrit(world: SimWorld): boolean {
  const chance = getEffectiveCritChance(world);
  if (chance <= 0) return false;
  world.critSeed = (Math.imul(world.critSeed, 1664525) + 1013904223) >>> 0;
  return world.critSeed / 4294967296 < chance;
}
