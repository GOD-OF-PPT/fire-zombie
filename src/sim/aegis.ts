import { PLAYER_Z } from '../config/constants';
import { hasSynergy } from '../config/protocols';
import type { SimEvent } from '../types/game';
import { damageEnemy } from './enemies';
import type { SimWorld } from './entities';
import { clamp, normalizeZero } from './math';

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
  if (!autoTriggered && (world.aegisCooldown > 1e-9 || world.aegisTimer > 1e-9)) {
    return false;
  }

  world.aegisTimer = Math.max(world.aegisTimer, world.aegisDurationSec);
  if (!autoTriggered) {
    world.aegisCooldown = world.aegisMaxCooldown;
  }

  let orbsCleared = 0;
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    if (!p || !p.active || !p.hostile) continue;
    if (Math.hypot(p.x - world.squadX, p.z - PLAYER_Z) <= AEGIS_ORB_CLEAR_RADIUS) {
      world.projectilePool.release(p);
      world.projectiles.splice(i, 1);
      orbsCleared += 1;
    }
  }

  let enemiesRepelled = 0;
  const shockDamage = AEGIS_SHOCK_DAMAGE * world.mods.damageMult;
  // Snapshot current length because Mitosis split may append children
  const enemyLen = world.enemies.length;
  for (let i = 0; i < enemyLen; i++) {
    const e = world.enemies[i];
    if (!e || !e.active || e.consumed || e.bypassed || e.hp <= 0) continue;
    const dist = Math.hypot(e.x - world.squadX, e.z - PLAYER_Z);
    if (dist <= AEGIS_REPEL_RADIUS + e.radius) {
      const pushedZ = clamp(Math.min(e.z - 3.4, PLAYER_Z - 3.6), -76, PLAYER_Z - 1.2);
      e.z = normalizeZero(pushedZ);
      e.prevZ = e.z;
      if (e.kind === 'dasher' && e.dasherState === 'DASH') {
        e.dasherState = 'APPROACH';
        e.telegraphTimer = 0;
      }
      enemiesRepelled += 1;
      damageEnemy(world, e, shockDamage, AEGIS_SLOW_SEC, events);
    }
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
