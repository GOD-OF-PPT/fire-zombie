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
import { clamp, clampSquadCount, normalizeZero } from './math';
import { PLAYER_Z } from '../config/constants';
import { hasMutator, recordDamage } from './competition';
import { chargeCapacitorTower, hasChip, spawnCoreShard } from './v20Mechanics';
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
  barrel.blastRadius = hasMutator(world, 'barrel_carnival') ? BARREL_BLAST_RADIUS * 1.35 : BARREL_BLAST_RADIUS;
  barrel.hp = BARREL_MAX_HP;
  barrel.displayHp = BARREL_MAX_HP;
  barrel.detonated = false;
  barrel.chainTimer = null;
  barrel.chainScheduledAt = null;
  barrel.scheduledChainIndex = 1;
  barrel.hitPulse = 0;
  barrel.overheat = 0;
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
  amplifiedHit = false,
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
  const vortexScale =
    (1 + Math.max(0, world.mods.specVortex ?? 0) * 0.10) *
    (hasChip(world, 'chip_volatile_core') ? 1.25 : 1.0);
  const blastR = barrel.blastRadius * (amplifiedHit ? 1.22 : 1.0) * vortexScale;
  // Scales smoothly in mid/late game while keeping exact 130 floor in early sectors & unit tests!
  const scaledBlastDmg = Math.round(
    Math.max(BARREL_BLAST_DAMAGE, world.simTime >= 12 ? world.trueSquadDps * 0.56 : BARREL_BLAST_DAMAGE) *
      (amplifiedHit ? 1.32 : 1.0),
  );
  const gateBoostDelta = amplifiedHit ? BARREL_GATE_BOOST_DELTA + 3 : BARREL_GATE_BOOST_DELTA;
  let killsInBlast = 0;

  // 2a. AoE enemy damage (snapshot current length so newly split Mitosis shards aren't double-blasted by same barrel)
  const enemySnapshotCount = world.enemies.length;
  for (let i = 0; i < enemySnapshotCount; i++) {
    const enemy = world.enemies[i];
    if (!enemy || !enemy.active || enemy.consumed || enemy.bypassed || enemy.hp <= 0) {
      continue;
    }
    if (Math.hypot(enemy.x - bx, enemy.z - bz) <= blastR + enemy.radius) {
      recordDamage(world, 'explosives', Math.min(enemy.hp, scaledBlastDmg));
      if (damageEnemy(world, enemy, scaledBlastDmg, 0, events, { bypassShield: true })) {
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
      damageVault(world, vault, scaledBlastDmg, events);
    }
  }

  // 2c. AoE Boss & Shield Pylon damage + Capacitor Tower Supercharge!
  onBossBlast(world, bx, bz, blastR, scaledBlastDmg, events);
  for (let i = 0; i < world.capTowers.length; i++) {
    const cap = world.capTowers[i];
    if (cap && cap.active && !cap.discharged && Math.hypot(cap.x - bx, cap.z - bz) <= blastR + 4.0) {
      chargeCapacitorTower(world, cap, scaledBlastDmg * 1.8, true, events);
    }
  }
  if (hasChip(world, 'chip_volatile_core')) {
    spawnCoreShard(world, bx - 0.4, bz, 1);
    spawnCoreShard(world, bx + 0.4, bz, 1);
  }

  // 3. Mutable Gate Boost (+5 or +8 on Reflector/Lens amplified bank-shot!)
  for (let i = 0; i < world.gates.length; i++) {
    const gate = world.gates[i];
    if (!gate || !gate.active || !gate.mutable || gate.triggered || gate.dimmed) {
      continue;
    }
    if (Math.hypot(gate.x - bx, gate.z - bz) <= BARREL_GATE_BOOST_RADIUS) {
      if (gate.isLockFlip) {
        applyProjectileHitToGate(world, gate, scaledBlastDmg, events);
      } else {
        applyFlatDeltaToGate(world, gate, gateBoostDelta, true, events);
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
    if (Math.hypot(other.x - bx, other.z - bz) <= (hasMutator(world, 'barrel_carnival') ? BARREL_CHAIN_TRIGGER_RADIUS * 1.35 : BARREL_CHAIN_TRIGGER_RADIUS)) {
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

  // Challenge Mutator Risk (`barrel_carnival`): point-blank blast backwash singes squad if detonated right in your face!
  if (
    hasMutator(world, 'barrel_carnival') &&
    world.aegisTimer <= 0 &&
    world.squadAirY <= 0.6 &&
    world.squadCount > 3 &&
    bz >= PLAYER_Z - 3.6 &&
    bz <= PLAYER_Z + 1.2 &&
    Math.abs(bx - world.squadX) <= 2.4
  ) {
    const singe = Math.min(world.squadCount - 1, 3);
    if (singe > 0) {
      world.squadCount = clampSquadCount(world.squadCount - singe);
      events.push({ type: 'SQUAD_LOSS', x: bx, z: PLAYER_Z, lost: singe, reason: 'ENEMY_BREACH' });
    }
  }

  events.push({
    type: 'BARREL_EXPLODE',
    x: bx,
    z: bz,
    radius: blastR,
    chainIndex,
    kills: killsInBlast,
    ...(amplifiedHit ? { amplified: true } : {}),
  });
}

export function damageBarrel(
  world: SimWorld,
  barrel: SimBarrel,
  damage: number,
  events: SimEvent[],
  onBossBlast: BarrelBossBlastCallback,
  amplifiedHit = false,
): void {
  if (!barrel.active || barrel.detonated || damage <= 0) {
    return;
  }

  barrel.hitPulse = 1.0;
  barrel.hp = Math.max(0, barrel.hp - damage);
  barrel.displayHp = Math.ceil(Math.max(0, barrel.hp));

  if (barrel.hp <= 0) {
    const idx = barrel.scheduledChainIndex >= 1 ? barrel.scheduledChainIndex : 1;
    detonateBarrel(world, barrel, idx, events, onBossBlast, amplifiedHit);
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
