import type { EnemyKind, SimEvent } from '../types/game';
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
  DASHER_ARENA_TRIGGER_Z,
  DASHER_BRAKE_VZ,
  DASHER_RUNWAY_TRIGGER_Z,
  ENEMY_CONFIGS,
  MITOSIS_CHILD_HP,
  MITOSIS_CHILD_RADIUS,
  MITOSIS_SPLIT_HALF_OFFSET,
  SIPHON_DRAIN_INTERVAL_SEC,
  SIPHON_KILL_GATE_BONUS,
  SIPHON_MIN_GATE_VALUE,
} from '../config/enemies';
import { CRYO_BRITTLE_DAMAGE_MULT, CRYO_SLOW_MOVE_SCALE } from '../config/weapons';
import { allocEntityId, type SimEnemy, type SimWorld } from './entities';
import { applyFlatDeltaToGate, findGateById } from './gates';
import { clamp, clampSquadCount, normalizeZero } from './math';

export interface EnemySpawnOptions {
  hp?: number;
  radius?: number;
  linkedGateId?: number | null;
  mitosisGeneration?: number;
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
  enemy.id = allocEntityId(world);
  enemy.kind = kind;
  enemy.prevX = normalizeZero(clampedX);
  enemy.prevZ = z;
  enemy.x = normalizeZero(clampedX);
  enemy.z = z;
  enemy.radius = radius;
  enemy.maxHp = Math.max(1, options.hp ?? cfg.hp);
  enemy.hp = enemy.maxHp;
  enemy.slowTimer = 0;
  enemy.telegraphTimer = 0;
  enemy.dasherState = 'APPROACH';
  enemy.linkedGateId = options.linkedGateId ?? null;
  enemy.siphonDrainAcc = 0;
  enemy.mitosisGeneration = options.mitosisGeneration ?? 0;
  enemy.bladeHitCooldown = 0;
  enemy.hitPulse = 0;
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
 * Applies combat damage to an enemy (with Cryo brittle amplification and slow refresh),
 * handling Mitosis combat-kill split and Corruptor Siphon +6 gate injection.
 * Returns true if the hit killed the enemy.
 */
export function damageEnemy(
  world: SimWorld,
  enemy: SimEnemy,
  rawDamage: number,
  cryoSlowDuration: number,
  events: SimEvent[],
): boolean {
  if (!enemy.active || enemy.consumed || enemy.bypassed || enemy.hp <= 0 || rawDamage <= 0) {
    return false;
  }

  const damageAmp = enemy.slowTimer > 0 ? CRYO_BRITTLE_DAMAGE_MULT : 1.0;
  const effectiveDamage = rawDamage * damageAmp;
  enemy.hp = Math.max(0, enemy.hp - effectiveDamage);
  enemy.hitPulse = 1.0;

  if (cryoSlowDuration > 0 && enemy.hp > 0) {
    enemy.slowTimer = Math.max(enemy.slowTimer, cryoSlowDuration);
  }

  const fatal = enemy.hp <= 0;
  events.push({
    type: 'ENEMY_HIT',
    x: enemy.x,
    z: enemy.z,
    fatal,
    kind: enemy.kind,
  });

  if (fatal) {
    enemy.hp = 0;
    enemy.consumed = true;
    enemy.active = false;
    world.stats.kills += 1;

    // Corruptor Siphon on-kill +6 gate injection
    if (enemy.kind === 'siphon' && enemy.linkedGateId !== null) {
      const linkedGate = findGateById(world, enemy.linkedGateId);
      if (linkedGate && !linkedGate.triggered && !linkedGate.dimmed && linkedGate.z < PLAYER_Z) {
        applyFlatDeltaToGate(world, linkedGate, SIPHON_KILL_GATE_BONUS, true, events);
      }
      enemy.linkedGateId = null;
    }

    // Mitosis Node combat-kill split (generation 0 ONLY; wall-safe clamped)
    if (enemy.kind === 'mitosis' && enemy.mitosisGeneration === 0) {
      const margin = MITOSIS_SPLIT_HALF_OFFSET + MITOSIS_CHILD_RADIUS;
      const safeCenter = clamp(enemy.x, -TRACK_HALF_WIDTH + margin, TRACK_HALF_WIDTH - margin);
      spawnEnemy(world, 'crawler', safeCenter - MITOSIS_SPLIT_HALF_OFFSET, enemy.z, {
        hp: MITOSIS_CHILD_HP,
        radius: MITOSIS_CHILD_RADIUS,
        mitosisGeneration: 1,
      });
      spawnEnemy(world, 'crawler', safeCenter + MITOSIS_SPLIT_HALF_OFFSET, enemy.z, {
        hp: MITOSIS_CHILD_HP,
        radius: MITOSIS_CHILD_RADIUS,
        mitosisGeneration: 1,
      });
    }
  }

  return fatal;
}

/**
 * Step 3c: Close-range Orbital Bit-Blades defense ring around (squadX, PLAYER_Z).
 */
export function stepOrbitalBlades(world: SimWorld, events: SimEvent[]): void {
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
        damageEnemy(world, enemy, BLADES_DAMAGE, 0, events);
        break;
      }
    }
  }
}

/**
 * Step 4b: Advances all active enemy positions, timers, Vector Dasher 0.65s
 * laser telegraphs, and Corruptor Siphon -1/s gate drains.
 */
export function stepEnemiesAI(world: SimWorld, events: SimEvent[]): void {
  const onRunway = world.currentScrollSpeed > 0;

  for (let i = 0; i < world.enemies.length; i++) {
    const enemy = world.enemies[i];
    if (!enemy || !enemy.active || enemy.consumed) {
      continue;
    }

    enemy.prevX = enemy.x;
    enemy.prevZ = enemy.z;

    if (enemy.bladeHitCooldown > 0) {
      const nextBladeCd = enemy.bladeHitCooldown - FIXED_DT;
      enemy.bladeHitCooldown = nextBladeCd <= 1e-9 ? 0 : nextBladeCd;
    }

    const speedScale = enemy.slowTimer > 0 ? CRYO_SLOW_MOVE_SCALE : 1.0;
    if (enemy.slowTimer > 0) {
      const nextSlow = enemy.slowTimer - FIXED_DT;
      enemy.slowTimer = nextSlow <= 1e-9 ? 0 : nextSlow;
    }

    const cfg = ENEMY_CONFIGS[enemy.kind];
    const baseVz = onRunway ? world.currentScrollSpeed + cfg.runwayMarchOffset : cfg.arenaSpeed;
    let vz = baseVz * speedScale;

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
        vz = cfg.dashSpeedMultiplier * Math.max(14.0, baseVz) * speedScale;
      }
    }

    enemy.z += vz * FIXED_DT;

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

      if (Math.abs(enemyCrossX - squadCrossX) <= world.formationRadius + enemy.radius) {
        enemy.consumed = true;
        enemy.active = false;
        enemy.linkedGateId = null;
        enemy.telegraphTimer = 0;

        const cfg = ENEMY_CONFIGS[enemy.kind];
        const breachLoss = clamp(Math.ceil(enemy.hp / cfg.hpPerDroneLoss), 1, cfg.maxLoss);
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
        // Dodged cleanly: mark bypassed so enemy can never phantom-hit from behind
        enemy.bypassed = true;
        enemy.linkedGateId = null;
        enemy.telegraphTimer = 0;
      }
    }
  }
  return false;
}
