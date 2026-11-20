import type { EnemyKind, EnemyTier } from '../types/game';

export interface EnemyArchetypeConfig {
  readonly kind: EnemyKind;
  readonly tier: EnemyTier;
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

export const BOMBER_BLAST_RADIUS = 2.55;
export const BOMBER_BLAST_DAMAGE = 46;
export const BOMBER_GATE_BONUS = 2;

export const PHALANX_SHIELD_HP = 42;
export const PHALANX_FRONT_LEAK_RATIO = 0.4;

export const STALKER_BLINK_INTERVAL_SEC = 1.75;
export const STALKER_BLINK_SPAN = 2.05;

export const BROOD_SPAWN_INTERVAL_SEC = 2.8;
export const BROOD_MAX_SPAWNS = 3;
export const BROOD_CHILD_HP = 8;
export const BROOD_CHILD_RADIUS = 0.4;

export const HOWLER_AURA_RADIUS = 3.8;
export const HOWLER_SPEED_MULT = 1.28;
export const HOWLER_PURGE_RADIUS = 4.2;
export const HOWLER_PURGE_DAMAGE = 14;
export const HOWLER_PURGE_SLOW_SEC = 1.8;

export const GLACIER_ARMOR_RESIST = 0.72;
export const GLACIER_NOVA_RADIUS = 3.9;
export const GLACIER_NOVA_DAMAGE = 18;
export const GLACIER_NOVA_SLOW_SEC = 2.2;

export const BEHOLDER_FIRE_INTERVAL_SEC = 2.95;
export const BEHOLDER_TELEGRAPH_SEC = 0.55;
export const BEHOLDER_MAX_SHOTS = 2;
export const BEHOLDER_ORB_SPEED = 20.5;

export const BURROWER_TRIGGER_Z = -28.0;
export const BURROWER_SURGE_MULT = 1.44;
export const BURROWER_SURGE_SEC = 1.55;

export const NECRO_HEAL_INTERVAL_SEC = 2.35;
export const NECRO_HEAL_RADIUS = 4.2;
export const NECRO_HEAL_RATIO = 0.24;

export const ENEMY_CONFIGS: Readonly<Record<EnemyKind, EnemyArchetypeConfig>> = {
  crawler: {
    kind: 'crawler',
    tier: 1,
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
    tier: 2,
    name: 'Vector Dasher',
    hp: 26,
    radius: 0.58,
    runwayMarchOffset: 1.0,
    arenaSpeed: 8.5,
    hpPerDroneLoss: 7,
    maxLoss: 6,
    dashTelegraphSec: 0.65,
    dashSpeedMultiplier: 2.2,
  },
  bastion: {
    kind: 'bastion',
    tier: 4,
    name: 'Firewall Bastion',
    hp: 110,
    radius: 1.15,
    runwayMarchOffset: 0.4,
    arenaSpeed: 5.5,
    hpPerDroneLoss: 14,
    maxLoss: 12,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
  mitosis: {
    kind: 'mitosis',
    tier: 2,
    name: 'Mitosis Node',
    hp: 48,
    radius: 0.72,
    runwayMarchOffset: 1.5,
    arenaSpeed: 8.2,
    hpPerDroneLoss: 12,
    maxLoss: 6,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
  siphon: {
    kind: 'siphon',
    tier: 3,
    name: 'Corruptor Siphon',
    hp: 55,
    radius: 0.68,
    runwayMarchOffset: 0.0,
    arenaSpeed: 6.5,
    hpPerDroneLoss: 14,
    maxLoss: 6,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
  bomber: {
    kind: 'bomber',
    tier: 2,
    name: 'Volatile Bomber',
    hp: 22,
    radius: 0.56,
    runwayMarchOffset: 2.1,
    arenaSpeed: 9.2,
    hpPerDroneLoss: 6,
    maxLoss: 8,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
  phalanx: {
    kind: 'phalanx',
    tier: 3,
    name: 'Aegis Phalanx',
    hp: 68,
    radius: 0.78,
    runwayMarchOffset: 0.65,
    arenaSpeed: 6.2,
    hpPerDroneLoss: 12,
    maxLoss: 8,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
  stalker: {
    kind: 'stalker',
    tier: 2,
    name: 'Phase Stalker',
    hp: 30,
    radius: 0.52,
    runwayMarchOffset: 1.85,
    arenaSpeed: 9.0,
    hpPerDroneLoss: 8,
    maxLoss: 5,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
  brood: {
    kind: 'brood',
    tier: 4,
    name: 'Brood Carrier',
    hp: 84,
    radius: 0.92,
    runwayMarchOffset: 0.55,
    arenaSpeed: 5.8,
    hpPerDroneLoss: 14,
    maxLoss: 9,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
  howler: {
    kind: 'howler',
    tier: 3,
    name: 'Frenzy Howler',
    hp: 58,
    radius: 0.68,
    runwayMarchOffset: 0.95,
    arenaSpeed: 6.8,
    hpPerDroneLoss: 12,
    maxLoss: 6,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
  glacier: {
    kind: 'glacier',
    tier: 4,
    name: 'Cryo-Colossus',
    hp: 88,
    radius: 0.86,
    runwayMarchOffset: 0.72,
    arenaSpeed: 5.9,
    hpPerDroneLoss: 13,
    maxLoss: 9,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
  beholder: {
    kind: 'beholder',
    tier: 3,
    name: 'Prism Watcher',
    hp: 46,
    radius: 0.64,
    runwayMarchOffset: 1.05,
    arenaSpeed: 7.0,
    hpPerDroneLoss: 10,
    maxLoss: 6,
    dashTelegraphSec: 0.55,
    dashSpeedMultiplier: 1.0,
  },
  burrower: {
    kind: 'burrower',
    tier: 2,
    name: 'Tunnel Ripper',
    hp: 34,
    radius: 0.62,
    runwayMarchOffset: 1.95,
    arenaSpeed: 9.1,
    hpPerDroneLoss: 8,
    maxLoss: 6,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.44,
  },
  necromancer: {
    kind: 'necromancer',
    tier: 3,
    name: 'Nano-Weaver',
    hp: 62,
    radius: 0.66,
    runwayMarchOffset: 0.88,
    arenaSpeed: 6.5,
    hpPerDroneLoss: 12,
    maxLoss: 7,
    dashTelegraphSec: 0,
    dashSpeedMultiplier: 1.0,
  },
};

export function getEnemyTier(kind: EnemyKind): EnemyTier {
  return ENEMY_CONFIGS[kind].tier;
}
