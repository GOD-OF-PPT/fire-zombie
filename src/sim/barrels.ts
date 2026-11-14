import type { SimEvent } from '../types/game';
import {
  BARREL_BLAST_DAMAGE,
  BARREL_BLAST_RADIUS,
  BARREL_CHAIN_DELAY_SEC,
  BARREL_CHAIN_TRIGGER_RADIUS,
  BARREL_GATE_BOOST_DELTA,
  BARREL_GATE_BOOST_RADIUS,
  BARREL_MAX_HP,
  BARREL_RADIUS,
  FIXED_DT,
  RESONANCE_GAIN_BARREL_CHAIN,
  RESONANCE_GAIN_BARREL_EXPLODE,
  TRACK_HALF_WIDTH,
} from '../config/constants';
import { allocEntityId, type SimBarrel, type SimWorld } from './entities';
import { damageEnemy } from './enemies';
import { applyFlatDeltaToGate, applyProjectileHitToGate } from './gates';
import { clamp, normalizeZero } from './math';
import { addResonance } from './resonance';
import { damageVault } from './weapons';

export type BarrelBossBlastCallback = (
  world: SimWorld,
  barrelX: number,
  barrelZ: number,
  blastRadius: number,
  blastDamage: number,
  events: SimEvent[],
) => void;

export function spawnBarrel(
  world: SimWorld,
  x: number,
  z: number,
  vz: number | null = null,
): SimBarrel {
  const clampedX = clamp(x, -TRACK_HALF_WIDTH + BARREL_RADIUS, TRACK_HALF_WIDTH - BARREL_RADIUS);
  const barrel = world.barrelPool.acquire();
  barrel.id = allocEntityId(world);
  barrel.prevX = normalizeZero(clampedX);
  barrel.prevZ = z;
  barrel.x = normalizeZero(clampedX);
  barrel.z = z;
  barrel.vz = vz;
  barrel.radius = BARREL_RADIUS;
  barrel.blastRadius = BARREL_BLAST_RADIUS;
  barrel.hp = BARREL_MAX_HP;
  barrel.displayHp = BARREL_MAX_HP;
  barrel.detonated = false;
  barrel.chainTimer = null;
  barrel.chainScheduledAt = null;
  barrel.scheduledChainIndex = 1;
  barrel.hitPulse = 0;
  barrel.active = true;
  world.barrels.push(barrel);
  return barrel;
}

/**
 * Cycle-safe Surge Barrel detonation:
 * Locks `barrel.detonated = true` BEFORE scanning neighbors so mutual `A <-> B`
 * pairs can never loop infinitely.
 */
export function detonateBarrel(
  world: SimWorld,
  barrel: SimBarrel,
  chainIndex: number,
  events: SimEvent[],
  onBossBlast: BarrelBossBlastCallback,
): void {
  if (!barrel.active || barrel.detonated) {
    return;
  }

  // 1. Immediate idempotency lock BEFORE neighbor scan
  barrel.detonated = true;
  barrel.hp = 0;
  barrel.displayHp = 0;
  barrel.chainTimer = null;
  barrel.chainScheduledAt = null;
  barrel.hitPulse = 1.0;
  barrel.active = false;

  const bx = barrel.x;
  const bz = barrel.z;
  const blastR = barrel.blastRadius;
  let killsInBlast = 0;

  // 2a. AoE enemy damage (snapshot current length so newly split Mitosis shards aren't double-blasted by same barrel)
  const enemySnapshotCount = world.enemies.length;
  for (let i = 0; i < enemySnapshotCount; i++) {
    const enemy = world.enemies[i];
    if (!enemy || !enemy.active || enemy.consumed || enemy.bypassed || enemy.hp <= 0) {
      continue;
    }
    if (Math.hypot(enemy.x - bx, enemy.z - bz) <= blastR + enemy.radius) {
      if (damageEnemy(world, enemy, BARREL_BLAST_DAMAGE, 0, events)) {
        killsInBlast += 1;
      }
    }
  }

  // 2b. AoE Overclock Vault damage
  for (let i = 0; i < world.vaults.length; i++) {
    const vault = world.vaults[i];
    if (!vault || !vault.active || vault.broken) {
      continue;
    }
    if (Math.hypot(vault.x - bx, vault.z - bz) <= blastR + vault.halfWidth) {
      damageVault(world, vault, BARREL_BLAST_DAMAGE, events);
    }
  }

  // 2c. AoE Boss & Shield Pylon damage
  onBossBlast(world, bx, bz, blastR, BARREL_BLAST_DAMAGE, events);

  // 3. Mutable Gate Boost (+5 within r = 5.0, or 130 lock damage on Lock-Flip gates)
  for (let i = 0; i < world.gates.length; i++) {
    const gate = world.gates[i];
    if (!gate || !gate.active || !gate.mutable || gate.triggered || gate.dimmed) {
      continue;
    }
    if (Math.hypot(gate.x - bx, gate.z - bz) <= BARREL_GATE_BOOST_RADIUS) {
      if (gate.isLockFlip) {
        applyProjectileHitToGate(world, gate, BARREL_BLAST_DAMAGE, events);
      } else {
        applyFlatDeltaToGate(world, gate, BARREL_GATE_BOOST_DELTA, true, events);
      }
    }
  }

  // 4. Schedule neighbor chain detonations with 0.11s stagger
  const nextChainIdx = chainIndex + 1;
  for (let i = 0; i < world.barrels.length; i++) {
    const other = world.barrels[i];
    if (!other || !other.active || other.detonated) {
      continue;
    }
    if (Math.hypot(other.x - bx, other.z - bz) <= BARREL_CHAIN_TRIGGER_RADIUS) {
      if (other.chainTimer === null) {
        other.chainTimer = BARREL_CHAIN_DELAY_SEC;
        other.chainScheduledAt = world.simTime;
        other.scheduledChainIndex = nextChainIdx;
      } else {
        if (BARREL_CHAIN_DELAY_SEC < other.chainTimer) {
          other.chainTimer = BARREL_CHAIN_DELAY_SEC;
          other.chainScheduledAt = world.simTime;
        }
        other.scheduledChainIndex = Math.max(other.scheduledChainIndex, nextChainIdx);
      }
    }
  }

  // 5. Stats, Resonance & Event
  if (chainIndex > world.stats.maxChain) {
    world.stats.maxChain = chainIndex;
  }
  const resGain =
    chainIndex === 1 ? RESONANCE_GAIN_BARREL_EXPLODE : RESONANCE_GAIN_BARREL_CHAIN;
  addResonance(world, resGain, events);

  events.push({
    type: 'BARREL_EXPLODE',
    x: bx,
    z: bz,
    radius: blastR,
    chainIndex,
    kills: killsInBlast,
  });
}

export function damageBarrel(
  world: SimWorld,
  barrel: SimBarrel,
  damage: number,
  events: SimEvent[],
  onBossBlast: BarrelBossBlastCallback,
): void {
  if (!barrel.active || barrel.detonated || damage <= 0) {
    return;
  }

  barrel.hitPulse = 1.0;
  barrel.hp = Math.max(0, barrel.hp - damage);
  barrel.displayHp = Math.ceil(Math.max(0, barrel.hp));

  if (barrel.hp <= 0) {
    const idx = barrel.scheduledChainIndex >= 1 ? barrel.scheduledChainIndex : 1;
    detonateBarrel(world, barrel, idx, events, onBossBlast);
  }
}

/**
 * Step 6: Ticks scheduled 0.11s staggered chain explosions on Surge Barrels.
 */
export function stepChainExplosions(
  world: SimWorld,
  events: SimEvent[],
  onBossBlast: BarrelBossBlastCallback,
): void {
  for (let i = 0; i < world.barrels.length; i++) {
    const barrel = world.barrels[i];
    if (
      !barrel ||
      !barrel.active ||
      barrel.detonated ||
      barrel.chainTimer === null ||
      barrel.chainScheduledAt === world.simTime
    ) {
      continue;
    }
    const nextTimer = barrel.chainTimer - FIXED_DT;
    barrel.chainTimer = nextTimer <= 1e-9 ? 0 : nextTimer;
    if (barrel.chainTimer <= 0) {
      detonateBarrel(world, barrel, barrel.scheduledChainIndex, events, onBossBlast);
    }
  }
}
