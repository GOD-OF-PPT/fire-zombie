import type { WeaponId } from '../types/game';

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
        shotsPerSecond: 8.0,
        projectileSpeed: 56.0,
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
        shotsPerSecond: 8.8,
        projectileSpeed: 58.0,
        maxRange: 66.0,
        radius: 0.15,
        basePierce: 0,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 0,
      },
      {
        level: 3,
        dpsMult: 1.52,
        shotsPerSecond: 9.6,
        projectileSpeed: 60.0,
        maxRange: 68.0,
        radius: 0.16,
        basePierce: 1,
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
        shotsPerSecond: 6.0,
        projectileSpeed: 50.0,
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
        shotsPerSecond: 6.5,
        projectileSpeed: 52.0,
        maxRange: 50.0,
        radius: 0.16,
        basePierce: 0,
        fanPellets: 7,
        fanSpreadRad: 34 * DEG_TO_RAD,
        splashRadius: 0,
        splashDamageRatio: 0,
        cryoSlowDuration: 0,
      },
      {
        level: 3,
        dpsMult: 1.90,
        shotsPerSecond: 7.0,
        projectileSpeed: 54.0,
        maxRange: 52.0,
        radius: 0.17,
        basePierce: 0,
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
        shotsPerSecond: 3.5,
        projectileSpeed: 74.0,
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
        shotsPerSecond: 3.8,
        projectileSpeed: 78.0,
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
        shotsPerSecond: 4.2,
        projectileSpeed: 82.0,
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
        shotsPerSecond: 2.8,
        projectileSpeed: 44.0,
        maxRange: 60.0,
        radius: 0.24,
        basePierce: 0,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 3.0,
        splashDamageRatio: 0.75,
        cryoSlowDuration: 0,
      },
      {
        level: 2,
        dpsMult: 1.52,
        shotsPerSecond: 3.1,
        projectileSpeed: 45.0,
        maxRange: 62.0,
        radius: 0.26,
        basePierce: 0,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 3.8,
        splashDamageRatio: 0.75,
        cryoSlowDuration: 0,
      },
      {
        level: 3,
        dpsMult: 1.85,
        shotsPerSecond: 3.4,
        projectileSpeed: 46.0,
        maxRange: 64.0,
        radius: 0.28,
        basePierce: 0,
        fanPellets: 0,
        fanSpreadRad: 0,
        splashRadius: 4.5,
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
        shotsPerSecond: 8.0,
        projectileSpeed: 56.0,
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
        shotsPerSecond: 9.0,
        projectileSpeed: 58.0,
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
        shotsPerSecond: 10.0,
        projectileSpeed: 60.0,
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

export function getWeaponLevelStats(weapon: WeaponId, level: 1 | 2 | 3): WeaponLevelStats {
  const idx = level === 3 ? 2 : level === 2 ? 1 : 0;
  return WEAPON_CONFIGS[weapon].levels[idx];
}

export function getVolleyStreamCount(
  weapon: WeaponId,
  level: 1 | 2 | 3,
  squadCount: number,
): number {
  if (squadCount <= 0) return 0;
  const stats = getWeaponLevelStats(weapon, level);

  if (weapon === 'scatter') {
    return stats.fanPellets;
  }
  if (weapon === 'rail') {
    if (squadCount < 8) return 1;
    if (squadCount < 30) return 2;
    if (squadCount < 80) return 3;
    return 4;
  }
  if (weapon === 'plasma') {
    if (squadCount < 15) return 1;
    if (squadCount < 60) return 2;
    return 3;
  }

  // pulse & cryo: 1..10 compact parallel streams within [-0.42, +0.42]
  if (squadCount <= 2) return 1;
  if (squadCount <= 9) return 2;
  if (squadCount <= 24) return 4;
  if (squadCount <= 59) return 6;
  if (squadCount <= 99) return 8;
  return 10;
}
