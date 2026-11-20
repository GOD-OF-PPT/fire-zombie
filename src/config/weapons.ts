import type { EnemyKind, WeaponId } from '../types/game';

export interface WeaponLevelStats {
  readonly level: 1 | 2 | 3;
  readonly dpsMult: number;
  readonly shotsPerSecond: number;
  readonly projectileSpeed: number;
  readonly maxRange: number;
  readonly radius: number;
  readonly basePierce: number;
  readonly fanPellets: number;
  readonly fanSpreadRad: number;
  readonly splashRadius: number;
  readonly splashDamageRatio: number;
  readonly cryoSlowDuration: number;
}

export interface WeaponDefinition {
  readonly id: WeaponId;
  readonly name: string;
  readonly levels: readonly [WeaponLevelStats, WeaponLevelStats, WeaponLevelStats];
}

const DEG_TO_RAD = Math.PI / 180;

export const CRYO_SLOW_MOVE_SCALE = 0.55; // 45% slow
export const CRYO_BRITTLE_DAMAGE_MULT = 1.25; // +25% brittle damage vulnerability

export const WEAPON_CONFIGS: Readonly<Record<WeaponId, WeaponDefinition>> = {
  pulse: {
    id: 'pulse',
    name: 'Prism Pulse',
    levels: [
      {
        level: 1,
        dpsMult: 1.0,
        shotsPerSecond: 12.5,
        projectileSpeed: 58.0,
        maxRange: 64.0,
        radius: 0.14,
        basePierce: 0,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 0,
      },
      {
        level: 2,
        dpsMult: 1.24,
        shotsPerSecond: 14.0,
        projectileSpeed: 60.0,
        maxRange: 66.0,
        radius: 0.15,
        basePierce: 1,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 0,
      },
      {
        level: 3,
        dpsMult: 1.52,
        shotsPerSecond: 15.5,
        projectileSpeed: 62.0,
        maxRange: 68.0,
        radius: 0.16,
        basePierce: 2,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 0,
      },
    ],
  },
  scatter: {
    id: 'scatter',
    name: 'Refractor Scatter',
    levels: [
      {
        level: 1,
        dpsMult: 1.32,
        shotsPerSecond: 8.5,
        projectileSpeed: 52.0,
        maxRange: 48.0,
        radius: 0.15,
        basePierce: 0,
        fanPellets: 5,
        fanSpreadRad: 32 * DEG_TO_RAD,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 0,
      },
      {
        level: 2,
        dpsMult: 1.60,
        shotsPerSecond: 9.5,
        projectileSpeed: 54.0,
        maxRange: 50.0,
        radius: 0.16,
        basePierce: 1,
        fanPellets: 7,
        fanSpreadRad: 34 * DEG_TO_RAD,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 0,
      },
      {
        level: 3,
        dpsMult: 1.90,
        shotsPerSecond: 10.5,
        projectileSpeed: 56.0,
        maxRange: 52.0,
        radius: 0.17,
        basePierce: 1,
        fanPellets: 9,
        fanSpreadRad: 36 * DEG_TO_RAD,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 0,
      },
    ],
  },
  rail: {
    id: 'rail',
    name: 'Hyper-Rail Lance',
    levels: [
      {
        level: 1,
        dpsMult: 1.20,
        shotsPerSecond: 5.5,
        projectileSpeed: 76.0,
        maxRange: 78.0,
        radius: 0.18,
        basePierce: 3,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 0,
      },
      {
        level: 2,
        dpsMult: 1.48,
        shotsPerSecond: 6.2,
        projectileSpeed: 80.0,
        maxRange: 80.0,
        radius: 0.20,
        basePierce: 5,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 0,
      },
      {
        level: 3,
        dpsMult: 1.80,
        shotsPerSecond: 7.0,
        projectileSpeed: 84.0,
        maxRange: 82.0,
        radius: 0.22,
        basePierce: 8,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 0,
      },
    ],
  },
  plasma: {
    id: 'plasma',
    name: 'Nova Plasma Mortar',
    levels: [
      {
        level: 1,
        dpsMult: 1.25,
        shotsPerSecond: 4.5,
        projectileSpeed: 46.0,
        maxRange: 60.0,
        radius: 0.24,
        basePierce: 0,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 3.2,
        splashDamageRatio: 0.75,
        cryoSlowDuration: 0,
      },
      {
        level: 2,
        dpsMult: 1.52,
        shotsPerSecond: 5.2,
        projectileSpeed: 48.0,
        maxRange: 62.0,
        radius: 0.26,
        basePierce: 0,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 4.0,
        splashDamageRatio: 0.75,
        cryoSlowDuration: 0,
      },
      {
        level: 3,
        dpsMult: 1.85,
        shotsPerSecond: 6.0,
        projectileSpeed: 50.0,
        maxRange: 64.0,
        radius: 0.28,
        basePierce: 0,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 4.6,
        splashDamageRatio: 0.75,
        cryoSlowDuration: 0,
      },
    ],
  },
  cryo: {
    id: 'cryo',
    name: 'Absolute Cryo Beam',
    levels: [
      {
        level: 1,
        dpsMult: 1.08,
        shotsPerSecond: 12.5,
        projectileSpeed: 58.0,
        maxRange: 60.0,
        radius: 0.15,
        basePierce: 0,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 2.5,
      },
      {
        level: 2,
        dpsMult: 1.34,
        shotsPerSecond: 14.0,
        projectileSpeed: 60.0,
        maxRange: 62.0,
        radius: 0.16,
        basePierce: 1,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 2.5,
      },
      {
        level: 3,
        dpsMult: 1.62,
        shotsPerSecond: 15.5,
        projectileSpeed: 62.0,
        maxRange: 64.0,
        radius: 0.17,
        basePierce: 2,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 2.5,
      },
    ],
  },
};

/** Per-enemy damage multipliers so each weapon is the clear answer to one threat. */
export const WEAPON_COUNTER_MULT: Readonly<Record<WeaponId, Partial<Record<EnemyKind, number>>>> = {
  pulse: { siphon: 1.5, bomber: 1.5, howler: 1.45, beholder: 1.65 },
  scatter: { crawler: 1.4, mitosis: 1.3, stalker: 1.4, bomber: 1.35, burrower: 1.65, necromancer: 1.45 },
  rail: { bastion: 1.8, phalanx: 2.0, howler: 1.6, brood: 1.45, glacier: 1.65, beholder: 1.75, necromancer: 1.7 },
  plasma: { mitosis: 1.6, crawler: 1.2, brood: 1.75, phalanx: 1.65, glacier: 1.85, necromancer: 1.6 },
  cryo: { dasher: 1.6, stalker: 1.75, howler: 1.35, burrower: 1.7, beholder: 1.45 },
};

export function getWeaponCounterMult(weapon: WeaponId, kind: EnemyKind): number {
  return WEAPON_COUNTER_MULT[weapon][kind] ?? 1;
}

export function getWeaponLevelStats(weapon: WeaponId, level: 1 | 2 | 3): WeaponLevelStats {
  const idx = level === 3 ? 2 : level === 2 ? 1 : 0;
  return WEAPON_CONFIGS[weapon].levels[idx];
}

/**
 * Dynamic Legion Volley Stream Count:
 * Every gate that grows your squad immediately expands visible bullet streams across all 5 weapons,
 * while total volley damage remains normalized to exact trueSquadDps / shotsPerSecond.
 */
export function getVolleyStreamCount(
  weapon: WeaponId,
  level: 1 | 2 | 3,
  squadCount: number,
): number {
  if (squadCount <= 0) return 0;
  const stats = getWeaponLevelStats(weapon, level);

  if (weapon === 'scatter') {
    const bonus =
      squadCount >= 96
        ? 10
        : squadCount >= 49
          ? 8
          : squadCount >= 23
            ? 6
            : squadCount >= 10
              ? 4
              : squadCount >= 4
                ? 2
                : 0;
    return stats.fanPellets + bonus;
  }
  if (weapon === 'rail') {
    if (squadCount <= 1) return 1;
    if (squadCount <= 4) return 2;
    if (squadCount <= 10) return 3;
    if (squadCount <= 22) return 4;
    if (squadCount <= 45) return 5;
    if (squadCount <= 85) return 6;
    return 8;
  }
  if (weapon === 'plasma') {
    if (squadCount <= 1) return 1;
    if (squadCount <= 5) return 2;
    if (squadCount <= 14) return 3;
    if (squadCount <= 32) return 4;
    if (squadCount <= 65) return 5;
    if (squadCount <= 110) return 6;
    return 7;
  }

  // pulse & cryo: 1..18 wide staggered parallel streams matching squad formation growth
  if (squadCount <= 1) return 1;
  if (squadCount === 2) return 2;
  if (squadCount === 3) return 3;
  if (squadCount <= 5) return 4;
  if (squadCount <= 8) return 6;
  if (squadCount <= 14) return 8;
  if (squadCount <= 24) return 10;
  if (squadCount <= 42) return 12;
  if (squadCount <= 75) return 14;
  if (squadCount <= 130) return 16;
  return 18;
}
