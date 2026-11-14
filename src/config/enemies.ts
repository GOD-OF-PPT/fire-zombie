import type { EnemyKind } from '../types/game';

export interface EnemyArchetypeConfig {
  readonly kind: EnemyKind;
  readonly name: string;
  readonly hp: number;
  readonly radius: number;
  /** Additional +Z speed relative to runway scrollSpeed while on runway */
  readonly runwayMarchOffset: number;
  /** World +Z approach speed when runway scrollSpeed === 0 inside Boss Arena */
  readonly arenaSpeed: number;
  readonly hpPerDroneLoss: number;
  readonly maxLoss: number;
  readonly dashTelegraphSec: number;
  readonly dashSpeedMultiplier: number;
}

export const MITOSIS_CHILD_HP = 14;
export const MITOSIS_CHILD_RADIUS = 0.44;
export const MITOSIS_SPLIT_HALF_OFFSET = 1.1;

export const SIPHON_DRAIN_INTERVAL_SEC = 1.0;
export const SIPHON_MIN_GATE_VALUE = -30;
export const SIPHON_KILL_GATE_BONUS = 6;

export const DASHER_RUNWAY_TRIGGER_Z = -34.0;
export const DASHER_ARENA_TRIGGER_Z = -20.0;
export const DASHER_BRAKE_VZ = 1.5;

export const ENEMY_CONFIGS: Readonly<Record<EnemyKind, EnemyArchetypeConfig>> = {
  crawler: {
    kind: 'crawler',
    name: 'Bit-Crawler',
    hp: 14,
    radius: 0.48,
    runwayMarchOffset: 2.5,
    arenaSpeed: 9.5,
    hpPerDroneLoss: 7,
    maxLoss: 2,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
  dasher: {
    kind: 'dasher',
    name: 'Vector Dasher',
    hp: 26,
    radius: 0.58,
    runwayMarchOffset: 1.0,
    arenaSpeed: 8.5,
    hpPerDroneLoss: 7,
    maxLoss: 4,
    dashTelegraphSec: 0.65,
    dashSpeedMultiplier: 2.2,
  },
  bastion: {
    kind: 'bastion',
    name: 'Firewall Bastion',
    hp: 110,
    radius: 1.15,
    runwayMarchOffset: 0.4,
    arenaSpeed: 5.5,
    hpPerDroneLoss: 14,
    maxLoss: 8,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
  mitosis: {
    kind: 'mitosis',
    name: 'Mitosis Node',
    hp: 48,
    radius: 0.72,
    runwayMarchOffset: 1.5,
    arenaSpeed: 8.2,
    hpPerDroneLoss: 12,
    maxLoss: 4,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
  siphon: {
    kind: 'siphon',
    name: 'Corruptor Siphon',
    hp: 55,
    radius: 0.68,
    runwayMarchOffset: 0.0,
    arenaSpeed: 6.5,
    hpPerDroneLoss: 14,
    maxLoss: 4,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
};
