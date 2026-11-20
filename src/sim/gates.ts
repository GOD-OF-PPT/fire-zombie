import type { DefeatReason, SimEvent } from '../types/game';
import type { GateSpecConfig } from '../config/sectors';
import {
  DEFAULT_PAIRED_GATE_HALF_WIDTH,
  DEFAULT_STANDALONE_GATE_HALF_WIDTH,
  GATE_HALF_DEPTH,
  PLAYER_Z,
  RESONANCE_GAIN_GATE_FLIP,
  RESONANCE_GAIN_POSITIVE_GATE,
} from '../config/constants';
import { allocEntityId, type SimGate, type SimGateRow, type SimWorld } from './entities';
import {
  applyGateOperation,
  clamp,
  clampSquadCount,
  computeGatePolarity,
  formatGateLabel,
  normalizeZero,
} from './math';
import { deployReserveIfAvailable, grantSquadWithReserve, hasMutator } from './competition';
import { addResonance } from './resonance';

export interface GateRowSpawnOptions {
  layout: 'paired' | 'standalone';
  z: number;
  vz: number;
  dividerX?: number;
  left?: GateSpecConfig;
  right?: GateSpecConfig;
  single?: GateSpecConfig & { x: number; halfWidth?: number };
}

export function syncGateDerivedFields(gate: SimGate): void {
  if (gate.op === 'add' || gate.op === 'sub') {
    gate.value = normalizeZero(Math.trunc(gate.value));
    gate.op = gate.value < 0 ? 'sub' : 'add';
  } else {
    gate.value = Math.max(1, Math.abs(Math.trunc(gate.value)));
  }
  gate.polarity = computeGatePolarity(gate.op, gate.value);
  gate.label = formatGateLabel(gate.op, gate.value);
  if (gate.polarity !== 'positive') {
    gate.wasNonPositive = true;
  }
}

function initGateFromSpec(
  world: SimWorld,
  rowId: number,
  x: number,
  z: number,
  vz: number,
  halfWidth: number,
  spec: GateSpecConfig,
): SimGate {
  const gate = world.gatePool.acquire();
  gate.id = allocEntityId(world);
  gate.rowId = rowId;
  gate.prevX = normalizeZero(x);
  gate.prevZ = z;
  gate.x = normalizeZero(x);
  gate.z = z;
  gate.vz = vz;
  gate.halfWidth = halfWidth;
  gate.halfDepth = GATE_HALF_DEPTH;
  gate.mutable = spec.mutable;
  gate.damagePerStep = Math.max(0.001, spec.damagePerStep ?? 10);
  gate.stepDelta = Math.max(1, Math.trunc(spec.stepDelta ?? 1));
  gate.maxValue = Math.trunc(spec.maxValue ?? 28);
  gate.minValue = Math.trunc(spec.minValue ?? -35);
  gate.accumulatedDamage = 0;
  gate.chargeRatio = 0;
  gate.triggered = false;
  gate.dimmed = false;
  gate.hitPulse = 0;
  gate.flipPulse = 0;
  gate.active = true;

  if (spec.lockHp !== undefined && spec.lockHp > 0) {
    gate.isLockFlip = true;
    gate.mutable = true;
    gate.op = 'div';
    gate.value = Math.max(2, Math.abs(Math.trunc(spec.value)));
    gate.lockHp = spec.lockHp;
    gate.maxLockHp = spec.lockHp;
  } else {
    gate.isLockFlip = false;
    gate.lockHp = 0;
    gate.maxLockHp = 0;
    if (spec.op === 'mul' || spec.op === 'div') {
      gate.op = spec.op;
      gate.value = Math.max(1, Math.abs(Math.trunc(spec.value)));
    } else {
      const signed =
        spec.op === 'sub'
          ? -Math.abs(Math.trunc(spec.value))
          : Math.trunc(spec.value);
      gate.value = normalizeZero(signed);
      gate.op = gate.value < 0 ? 'sub' : 'add';
    }
  }

  syncGateDerivedFields(gate);
  gate.wasNonPositive = gate.polarity !== 'positive';
  gate.flipBonusGranted = false;
  world.gates.push(gate);
  return gate;
}

export function spawnGateRow(world: SimWorld, options: GateRowSpawnOptions): SimGateRow {
  const row = world.gateRowPool.acquire();
  row.id = allocEntityId(world);
  row.layout = options.layout;
  row.prevZ = options.z;
  row.z = options.z;
  row.vz = options.vz;
  row.dividerX = options.dividerX ?? 0;
  row.triggered = false;
  row.active = true;

  if (options.layout === 'paired') {
    const leftSpec = options.left ?? { op: 'add', value: 1, mutable: false };
    const rightSpec = options.right ?? { op: 'add', value: 1, mutable: false };
    const leftHalfW = DEFAULT_PAIRED_GATE_HALF_WIDTH;
    const rightHalfW = DEFAULT_PAIRED_GATE_HALF_WIDTH;
    const leftGate = initGateFromSpec(
      world,
      row.id,
      row.dividerX - leftHalfW,
      options.z,
      options.vz,
      leftHalfW,
      leftSpec,
    );
    const rightGate = initGateFromSpec(
      world,
      row.id,
      row.dividerX + rightHalfW,
      options.z,
      options.vz,
      rightHalfW,
      rightSpec,
    );
    row.leftGateId = leftGate.id;
    row.rightGateId = rightGate.id;
    row.singleGateId = null;
  } else {
    const singleSpec = options.single ?? {
      op: 'add',
      value: 2,
      mutable: false,
      x: 0,
      halfWidth: DEFAULT_STANDALONE_GATE_HALF_WIDTH,
    };
    const hw = singleSpec.halfWidth ?? DEFAULT_STANDALONE_GATE_HALF_WIDTH;
    const singleGate = initGateFromSpec(
      world,
      row.id,
      singleSpec.x,
      options.z,
      options.vz,
      hw,
      singleSpec,
    );
    row.leftGateId = null;
    row.rightGateId = null;
    row.singleGateId = singleGate.id;
  }

  world.gateRows.push(row);
  return row;
}

export function findGateById(world: SimWorld, gateId: number | null): SimGate | null {
  if (gateId === null) return null;
  for (let i = 0; i < world.gates.length; i++) {
    const gate = world.gates[i];
    if (gate && gate.active && gate.id === gateId) {
      return gate;
    }
  }
  return null;
}

export function applyProjectileHitToGate(
  world: SimWorld,
  gate: SimGate,
  damage: number,
  events: SimEvent[],
): void {
  if (!gate.active || !gate.mutable || gate.triggered || gate.dimmed || damage <= 0) {
    return;
  }

  gate.hitPulse = 1.0;
  const wasPositive = gate.polarity === 'positive';
  let flippedPositive = false;

  if (gate.isLockFlip) {
    if (gate.lockHp > 0) {
      gate.lockHp = Math.max(0, gate.lockHp - damage);
      if (gate.lockHp <= 0) {
        gate.lockHp = 0;
        gate.op = 'mul';
        gate.chargeRatio = 0;
        syncGateDerivedFields(gate);
        if (
          !wasPositive &&
          gate.polarity === 'positive' &&
          gate.wasNonPositive &&
          !gate.flipBonusGranted
        ) {
          gate.flipBonusGranted = true;
          flippedPositive = true;
          gate.flipPulse = 1.0;
          world.stats.gatesImproved += 1;
          addResonance(world, RESONANCE_GAIN_GATE_FLIP, events);
        }
      } else {
        gate.chargeRatio = clamp(
          (gate.maxLockHp - gate.lockHp) / Math.max(0.001, gate.maxLockHp),
          0,
          0.999999,
        );
      }
    }
  } else if (gate.op === 'add' || gate.op === 'sub') {
    if (gate.value < gate.maxValue) {
      gate.accumulatedDamage += damage;
      while (gate.accumulatedDamage >= gate.damagePerStep && gate.value < gate.maxValue) {
        gate.accumulatedDamage -= gate.damagePerStep;
        gate.value = normalizeZero(Math.min(gate.maxValue, gate.value + gate.stepDelta));
      }
    }
    if (gate.value >= gate.maxValue) {
      gate.accumulatedDamage = 0;
      gate.chargeRatio = 0;
    } else {
      gate.chargeRatio = clamp(gate.accumulatedDamage / gate.damagePerStep, 0, 0.999999);
    }
    syncGateDerivedFields(gate);
    if (
      !wasPositive &&
      gate.polarity === 'positive' &&
      gate.wasNonPositive &&
      !gate.flipBonusGranted
    ) {
      gate.flipBonusGranted = true;
      flippedPositive = true;
      gate.flipPulse = 1.0;
      world.stats.gatesImproved += 1;
      addResonance(world, RESONANCE_GAIN_GATE_FLIP, events);
    }
  }

  events.push({
    type: 'GATE_HIT',
    gateId: gate.id,
    x: gate.x,
    z: gate.z,
    newValue: gate.value,
    flippedPositive,
  });
}

/**
 * Applies a direct integer delta to a mutable gate (e.g. Corruptor Siphon -1/s drain,
 * Siphon +6 kill injection, or Surge Barrel +5 AoE boost).
 */
export function applyFlatDeltaToGate(
  world: SimWorld,
  gate: SimGate,
  deltaValue: number,
  emitHitEvent: boolean,
  events: SimEvent[],
): void {
  if (!gate.active || !gate.mutable || gate.triggered || gate.dimmed || deltaValue === 0) {
    return;
  }

  if (gate.isLockFlip) {
    if (deltaValue > 0 && gate.lockHp > 0) {
      applyProjectileHitToGate(world, gate, deltaValue, events);
    }
    return;
  }

  if (gate.op !== 'add' && gate.op !== 'sub') {
    return;
  }

  const wasPositive = gate.polarity === 'positive';
  gate.value = normalizeZero(
    clamp(Math.trunc(gate.value + deltaValue), gate.minValue, gate.maxValue),
  );
  if (gate.value >= gate.maxValue) {
    gate.accumulatedDamage = 0;
    gate.chargeRatio = 0;
  }
  syncGateDerivedFields(gate);

  let flippedPositive = false;
  if (deltaValue > 0) {
    gate.hitPulse = 1.0;
    if (
      !wasPositive &&
      gate.polarity === 'positive' &&
      gate.wasNonPositive &&
      !gate.flipBonusGranted
    ) {
      gate.flipBonusGranted = true;
      flippedPositive = true;
      gate.flipPulse = 1.0;
      world.stats.gatesImproved += 1;
      addResonance(world, RESONANCE_GAIN_GATE_FLIP, events);
    }
  }

  if (emitHitEvent) {
    events.push({
      type: 'GATE_HIT',
      gateId: gate.id,
      x: gate.x,
      z: gate.z,
      newValue: gate.value,
      flippedPositive,
    });
  }
}

/**
 * Step 8: Evaluates swept GateRow crossings at PLAYER_Z with single-trigger row mutex.
 * Returns true if squadCount reached 0 and the run transitioned to DEFEAT.
 */
export function resolveGateRowCrossings(world: SimWorld, events: SimEvent[]): boolean {
  for (let i = 0; i < world.gateRows.length; i++) {
    const row = world.gateRows[i];
    if (!row || !row.active || row.triggered) {
      continue;
    }

    if (row.prevZ <= PLAYER_Z && row.z >= PLAYER_Z) {
      let chosenGate: SimGate | null = null;

      if (row.layout === 'paired') {
        const leftGate = findGateById(world, row.leftGateId);
        const rightGate = findGateById(world, row.rightGateId);
        row.triggered = true;

        if (world.squadX < row.dividerX) {
          chosenGate = leftGate;
          if (leftGate) leftGate.triggered = true;
          if (rightGate) rightGate.dimmed = true;
        } else {
          chosenGate = rightGate;
          if (rightGate) rightGate.triggered = true;
          if (leftGate) leftGate.dimmed = true;
        }
      } else {
        const singleGate = findGateById(world, row.singleGateId);
        row.triggered = true;
        if (singleGate) {
          const hitHalfSpan = singleGate.halfWidth + 0.35 * world.formationRadius;
          if (Math.abs(world.squadX - singleGate.x) <= hitHalfSpan) {
            singleGate.triggered = true;
            chosenGate = singleGate;
          } else {
            singleGate.dimmed = true;
          }
        }
      }

      if (chosenGate && world.squadAirY > 0.6 && chosenGate.polarity === 'negative') {
        // Soaring airborne over negative/division gate via Mag-Lev Jump Pad!
        chosenGate.dimmed = true;
        chosenGate = null;
      }

      if (chosenGate) {
        const beforeGate = world.squadCount;
        const effValue =
          hasMutator(world, 'glass_cannon') && chosenGate.polarity === 'negative' && chosenGate.op === 'sub'
            ? Math.round(chosenGate.value * 2.2)
            : chosenGate.value;
        const { after, actualDelta } = applyGateOperation(
          beforeGate,
          chosenGate.op,
          effValue,
        );
        world.squadCount = after;
        if (after > world.stats.peakSquad) {
          world.stats.peakSquad = after;
        }
        // Convert near-cap / above-999 supply overflow into Reserve Troops + Overdrive Surge!
        if (chosenGate.polarity === 'positive') {
          const rawTheo =
            chosenGate.op === 'mul'
              ? beforeGate * Math.max(1, effValue)
              : beforeGate + Math.max(0, effValue);
          const capOverflow = Math.max(0, rawTheo - after);
          const nearCapBonus = beforeGate >= 760 ? Math.min(24, Math.max(2, Math.floor(Math.max(1, effValue) * 0.35))) : 0;
          const reserveAdd = capOverflow + nearCapBonus;
          if (reserveAdd > 0) {
            world.reserveTroops = Math.min(180, (world.reserveTroops ?? 0) + reserveAdd);
            addResonance(world, Math.min(0.42, reserveAdd * 0.01), events);
            if (beforeGate >= 920 && world.overdriveTimer <= 0) {
              world.overdriveTimer = 2.2;
              events.push({ type: 'OVERDRIVE_START', x: world.squadX, z: PLAYER_Z });
            }
          }
        }

        events.push({
          type: 'GATE_PASS',
          gateId: chosenGate.id,
          x: chosenGate.x,
          z: PLAYER_Z,
          delta: actualDelta,
          polarity: chosenGate.polarity,
        });

        const relay = world.cutback;
        if (relay && (row.leftGateId === relay.supplyGateId || row.rightGateId === relay.supplyGateId)) {
          if (relay.primed && chosenGate.id === relay.supplyGateId) {
            events.push({ type: 'CUTBACK_COMPLETE', x: chosenGate.x, z: PLAYER_Z });
          }
          world.cutback = undefined;
        }

        if (chosenGate.polarity === 'positive' && actualDelta > 0) {
          world.gateStreak += 1;
          if (actualDelta >= 6) {
            world.swarmDirectorTimer = Math.min(world.swarmDirectorTimer, 0.06);
          }
          addResonance(
            world,
            RESONANCE_GAIN_POSITIVE_GATE + Math.min(4, Math.max(0, world.gateStreak - 1)) * 0.04,
            events,
          );
          if (world.gateStreak >= 2) {
            const streakBonus = Math.min(6, world.gateStreak - 1);
            const added = grantSquadWithReserve(world, streakBonus, events);
            if (added > 0) {
              events.push({
                type: 'GATE_STREAK',
                x: chosenGate.x,
                z: PLAYER_Z,
                streak: world.gateStreak,
                bonus: added,
              });
            }
          }
        } else if (chosenGate.polarity === 'negative' || actualDelta < 0) {
          world.gateStreak = 0;
        }

        if (actualDelta < 0) {
          const lossReason: Exclude<DefeatReason, null> =
            chosenGate.op === 'div' ? 'DIVISION_GATE' : 'NEGATIVE_GATE';
          events.push({
            type: 'SQUAD_LOSS',
            x: world.squadX,
            z: PLAYER_Z,
            lost: -actualDelta,
            reason: lossReason,
          });
          deployReserveIfAvailable(world, -actualDelta, events);
        }

        if (world.squadCount === 0) {
          const defeatReason: Exclude<DefeatReason, null> =
            chosenGate.op === 'div' ? 'DIVISION_GATE' : 'NEGATIVE_GATE';
          world.phase = 'DEFEAT';
          world.defeatReason = defeatReason;
          events.push({
            type: 'RUN_DEFEAT',
            sector: world.sector,
            reason: defeatReason,
          });
          return true;
        }
      }
    }
  }
  return false;
}
