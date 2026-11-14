import type { DronePosition, GateOp, GatePolarity, TierBreakdown, WeaponId } from '../types/game';
import {
  BASE_DRONE_DPS,
  DRONE_BODY_MARGIN,
  GOLDEN_ANGLE_RAD,
  MASTERY_DAMAGE_PER_VAULT,
  MAX_FORMATION_RADIUS,
  MAX_SQUAD_COUNT,
  MAX_VISIBLE_UNITS,
  MIN_FORMATION_RADIUS,
  MIN_SQUAD_COUNT,
  OVERDRIVE_FIRE_RATE_MULT,
  SPIRAL_SPACING,
  TRACK_HALF_WIDTH,
} from '../config/constants';
import { getWeaponLevelStats } from '../config/weapons';

/** Normalizes IEEE-754 negative zero (-0) to positive zero (+0). */
export function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function clampSquadCount(count: number): number {
  if (!Number.isFinite(count)) return MIN_SQUAD_COUNT;
  return normalizeZero(Math.max(MIN_SQUAD_COUNT, Math.min(MAX_SQUAD_COUNT, Math.floor(count))));
}

/**
 * Canonical integer squad gate arithmetic in [0, 999]:
 * - add: clamp(S + trunc(V), 0, 999)
 * - sub: clamp(S - |trunc(V)|, 0, 999)
 * - mul: clamp(Math.floor(S * max(0, V)), 0, 999)
 * - div: clamp(V > 0 ? Math.floor(S / V) : 0, 0, 999)
 */
export function applyGateOperation(
  beforeSquad: number,
  op: GateOp,
  value: number,
): { after: number; actualDelta: number } {
  const before = clampSquadCount(beforeSquad);
  let rawAfter = before;

  switch (op) {
    case 'add':
      rawAfter = before + Math.trunc(value);
      break;
    case 'sub':
      rawAfter = before - Math.abs(Math.trunc(value));
      break;
    case 'mul':
      rawAfter = Math.floor(before * Math.max(0, value));
      break;
    case 'div':
      rawAfter = value > 0 ? Math.floor(before / value) : 0;
      break;
  }

  const after = clampSquadCount(rawAfter);
  const actualDelta = normalizeZero(after - before);
  return { after, actualDelta };
}

export const applyGateArithmetic = applyGateOperation;

export function computeGatePolarity(op: GateOp, value: number): GatePolarity {
  if (op === 'mul') {
    return value > 1 ? 'positive' : value === 1 ? 'neutral' : 'negative';
  }
  if (op === 'div') {
    return value > 1 ? 'negative' : 'neutral';
  }
  const signed =
    op === 'sub' ? normalizeZero(-Math.abs(Math.trunc(value))) : normalizeZero(Math.trunc(value));
  if (signed > 0) return 'positive';
  if (signed < 0) return 'negative';
  return 'neutral';
}

/**
 * Formats crisp gate labels ("+12", "0", "-8", "×2", "÷2").
 * Never emits "-0", "+0", or "+-N".
 */
export function formatGateLabel(op: GateOp, value: number): string {
  if (op === 'mul') {
    return `×${Math.abs(Math.trunc(value))}`;
  }
  if (op === 'div') {
    return `÷${Math.abs(Math.trunc(value))}`;
  }
  const signed =
    op === 'sub' ? normalizeZero(-Math.abs(Math.trunc(value))) : normalizeZero(Math.trunc(value));
  if (signed > 0) return `+${signed}`;
  if (signed === 0) return '0';
  return `${signed}`;
}

/**
 * Exact 3-tier promotion decomposition:
 * u1 * 1 + u2 * 5 + u3 * 25 === squadCount, with u1 + u2 + u3 <= 48 for all squadCount in [0, 999].
 */
export function computeTierBreakdown(squadCount: number): TierBreakdown {
  const n = clampSquadCount(squadCount);
  let u1 = n;
  let u2 = 0;
  let u3 = 0;

  while (u1 + u2 + u3 > MAX_VISIBLE_UNITS && u1 >= 5) {
    u1 -= 5;
    u2 += 1;
  }
  while (u1 + u2 + u3 > MAX_VISIBLE_UNITS && u2 >= 5) {
    u2 -= 5;
    u3 += 1;
  }

  return {
    u1,
    u2,
    u3,
    totalVisible: u1 + u2 + u3,
  };
}

export function computeFormationRadius(totalVisible: number): number {
  if (totalVisible <= 1) {
    return MIN_FORMATION_RADIUS;
  }
  const maxSpiralR = SPIRAL_SPACING * Math.sqrt(totalVisible - 1);
  return Math.min(
    MAX_FORMATION_RADIUS,
    Math.max(MIN_FORMATION_RADIUS, maxSpiralR + DRONE_BODY_MARGIN),
  );
}

export function clampSquadX(rawX: number, formationRadius: number): number {
  const safeR = Math.min(MAX_FORMATION_RADIUS, Math.max(MIN_FORMATION_RADIUS, formationRadius));
  const minX = -TRACK_HALF_WIDTH + safeR;
  const maxX = TRACK_HALF_WIDTH - safeR;
  if (!Number.isFinite(rawX)) return 0;
  const clamped = Math.max(minX, Math.min(maxX, rawX));
  return normalizeZero(clamped);
}

export function computeFormationPositions(
  tiers: TierBreakdown,
  squadX: number,
  playerZ: number,
  overdriveActive: boolean,
): DronePosition[] {
  const total = tiers.totalVisible;
  const out: DronePosition[] = [];
  if (total <= 0) return out;

  for (let i = 0; i < total; i++) {
    const tier: 1 | 2 | 3 = i < tiers.u3 ? 3 : i < tiers.u3 + tiers.u2 ? 2 : 1;
    if (i === 0) {
      out.push({ x: normalizeZero(squadX), z: playerZ, tier });
      continue;
    }
    const r = SPIRAL_SPACING * Math.sqrt(i);
    const angle = i * GOLDEN_ANGLE_RAD;
    const localX = Math.sin(angle) * r;
    const baseLocalZ = -Math.cos(angle) * r * 0.85;
    const localZ = overdriveActive
      ? baseLocalZ * 0.6 + Math.abs(localX) * 0.45 - 0.15
      : baseLocalZ;

    out.push({
      x: normalizeZero(squadX + localX),
      z: playerZ + localZ,
      tier,
    });
  }
  return out;
}

export const computeDronePositions = computeFormationPositions;

export function computeTrueSquadDps(
  squadCount: number,
  weapon: WeaponId,
  weaponLevel: 1 | 2 | 3,
  masteryCount: number,
  overdriveActive: boolean,
): number {
  const n = clampSquadCount(squadCount);
  if (n <= 0) return 0;
  const weaponStats = getWeaponLevelStats(weapon, weaponLevel);
  const masteryMult = 1 + MASTERY_DAMAGE_PER_VAULT * Math.max(0, masteryCount);
  const overdriveMult = overdriveActive ? OVERDRIVE_FIRE_RATE_MULT : 1.0;
  return BASE_DRONE_DPS * n * weaponStats.dpsMult * masteryMult * overdriveMult;
}

export function computeProjectilePowerScale(
  squadCount: number,
  weaponLevel: 1 | 2 | 3,
  amplified: boolean,
): number {
  const n = Math.max(1, clampSquadCount(squadCount));
  const squadTerm =
    n <= MAX_VISIBLE_UNITS
      ? 1.0 + (n / MAX_VISIBLE_UNITS) * 0.25
      : 1.25 + Math.min(0.85, Math.log2(n / MAX_VISIBLE_UNITS) * 0.2);
  const levelTerm = (weaponLevel - 1) * 0.12;
  const baseScale = squadTerm + levelTerm;
  return amplified ? baseScale * 1.18 : baseScale;
}
