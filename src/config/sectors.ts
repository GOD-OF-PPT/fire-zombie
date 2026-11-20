import type { BossId, EnemyKind, GateOp, RewardId, SectorId } from '../types/game';
import { GAUNTLET_RUNWAY_LENGTH, generateGauntlet } from './gauntlet';

export interface GateSpecConfig {
  readonly op: GateOp;
  readonly value: number;
  readonly mutable: boolean;
  readonly damagePerStep?: number;
  readonly stepDelta?: number;
  readonly maxValue?: number;
  readonly minValue?: number;
  readonly lockHp?: number;
}

export interface GateRowEncounter {
  readonly type: 'gate_row';
  readonly crossDist: number;
  readonly layout: 'paired' | 'standalone';
  readonly dividerX?: number;
  readonly left?: GateSpecConfig;
  readonly right?: GateSpecConfig;
  readonly single?: GateSpecConfig & { readonly x: number; readonly halfWidth?: number };
  /** Optional Corruptor Siphon spawned directly ahead of the specified gate */
  readonly tetheredSiphon?: {
    readonly side: 'left' | 'right' | 'single';
    readonly zAhead?: number;
  };
}

export interface VaultEncounter {
  readonly type: 'vault';
  readonly crossDist: number;
  readonly x: number;
  readonly hp: number;
  readonly reward: RewardId;
}

export interface EnemySpawnItem {
  readonly kind: EnemyKind;
  readonly x: number;
  readonly dz?: number; // Extra distance behind crossDist (spawns further toward -Z)
}

export interface EnemyGroupEncounter {
  readonly type: 'enemies';
  readonly crossDist: number;
  readonly units: readonly EnemySpawnItem[];
}

export interface BarrelClusterEncounter {
  readonly type: 'barrels';
  readonly crossDist: number;
  readonly placements: ReadonlyArray<{ readonly x: number; readonly dz?: number }>;
}

export interface PrismLensEncounter {
  readonly type: 'lens';
  readonly crossDist: number;
  readonly x: number;
  readonly driftAmp?: number;
  readonly driftFreq?: number;
}

export interface JumpPadEncounter {
  readonly type: 'jump_pad';
  readonly crossDist: number;
  readonly x: number;
}

export interface ReflectorEncounter {
  readonly type: 'reflector';
  readonly crossDist: number;
  readonly x: number;
  readonly lean: 1 | -1;
}

export interface ContractLaneEncounter {
  readonly type: 'contract_lane';
  readonly crossDist: number;
  readonly length: number;
  readonly bountySide: 'left' | 'right';
  readonly bountyHp: number;
}

export type RunwayEncounter =
  | GateRowEncounter
  | VaultEncounter
  | EnemyGroupEncounter
  | BarrelClusterEncounter
  | PrismLensEncounter
  | JumpPadEncounter
  | ReflectorEncounter
  | ContractLaneEncounter;

export interface BossConfig {
  readonly id: BossId;
  readonly name: string;
  readonly maxHp: number;
  readonly maxPhases: 2 | 3;
  readonly pylonHp?: number;
  /** Fight seconds after which hazard/summon/orb timers start ticking faster (soft enrage). */
  readonly enrageAfterSec?: number;
}

export interface SectorScriptConfig {
  readonly id: SectorId;
  readonly name: string;
  readonly subtitle: string;
  readonly scrollSpeed: number;
  readonly runwayLength: number;
  readonly startSquad: number;
  /** Distances of the linked mirror, vault, supply gate and landing drill on this track. */
  readonly blitzDrill?: { mirrorX: number; mirror: number; guard: number; vault: number; gate: number; pad: number };
  readonly boss: BossConfig;
  readonly encounters: readonly RunwayEncounter[];
}

const SECTOR_1_ENCOUNTERS: readonly RunwayEncounter[] = [
  // Act 1 — Onboarding (d = 32..158)
  {
    type: 'gate_row',
    crossDist: 32,
    layout: 'paired',
    left: { op: 'add', value: 3, mutable: false },
    right: { op: 'add', value: 5, mutable: false },
  },
  {
    type: 'enemies',
    crossDist: 75,
    units: [
      { kind: 'crawler', x: -0.35, dz: 0 },
      { kind: 'crawler', x: 0.55, dz: 1.3 },
      { kind: 'bomber', x: -2.05, dz: 2.4 },
      { kind: 'crawler', x: 1.85, dz: 3.4 },
      { kind: 'burrower', x: -2.85, dz: 4.4 },
      { kind: 'crawler', x: 2.65, dz: 5.0 },
      { kind: 'mitosis', x: -1.65, dz: 5.8 },
      { kind: 'crawler', x: 1.95, dz: 6.4 },
      { kind: 'crawler', x: -3.25, dz: 7.0 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 118,
    layout: 'paired',
    left: { op: 'add', value: 2, mutable: false },
    right: { op: 'sub', value: 4, mutable: true, damagePerStep: 5, stepDelta: 1, maxValue: 8 },
  },
  {
    type: 'enemies',
    crossDist: 138,
    units: [
      { kind: 'crawler', x: -3.15, dz: 0 },
      { kind: 'burrower', x: 1.35, dz: 1.5 },
      { kind: 'crawler', x: -1.45, dz: 3.1 },
      { kind: 'bomber', x: 2.55, dz: 4.6 },
      { kind: 'glacier', x: -2.75, dz: 6.2 },
      { kind: 'mitosis', x: 2.15, dz: 7.8 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 158,
    layout: 'paired',
    left: { op: 'mul', value: 2, mutable: false },
    right: { op: 'add', value: 4, mutable: false },
  },
  {
    type: 'gate_row',
    crossDist: 185,
    layout: 'standalone',
    single: {
      x: -2.6,
      halfWidth: 1.9,
      op: 'sub',
      value: 5,
      mutable: true,
      damagePerStep: 8,
      stepDelta: 1,
      maxValue: 6,
    },
  },

  // Act 2 — Meaningful Choice (d = 212..368)
  {
    type: 'vault',
    crossDist: 212,
    x: -2.5,
    hp: 70,
    reward: 'scatter',
  },
  {
    type: 'enemies',
    crossDist: 214,
    units: [
      { kind: 'crawler', x: -3.35, dz: 0.3 },
      { kind: 'phalanx', x: 1.65, dz: 1.4 },
      { kind: 'crawler', x: -1.45, dz: 2.7 },
      { kind: 'burrower', x: 3.05, dz: 3.9 },
      { kind: 'bomber', x: -2.55, dz: 5.2 },
      { kind: 'beholder', x: 2.35, dz: 6.5 },
      { kind: 'crawler', x: -2.45, dz: 7.9 },
      { kind: 'crawler', x: 2.15, dz: 9.2 },
      { kind: 'glacier', x: -2.15, dz: 10.6 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 228,
    layout: 'paired',
    left: { op: 'add', value: 6, mutable: false },
    right: { op: 'sub', value: 22, mutable: false },
  },
  {
    type: 'enemies',
    crossDist: 244,
    units: [
      { kind: 'crawler', x: -3.2, dz: 0 },
      { kind: 'crawler', x: -2.1, dz: 0.8 },
      { kind: 'crawler', x: -1.0, dz: 1.6 },
      { kind: 'crawler', x: 0.0, dz: 2.0 },
      { kind: 'crawler', x: 1.1, dz: 1.6 },
      { kind: 'crawler', x: 2.2, dz: 0.8 },
      { kind: 'crawler', x: 3.2, dz: 0 },
      { kind: 'crawler', x: -2.6, dz: 3.2 },
      { kind: 'crawler', x: -0.6, dz: 3.6 },
      { kind: 'crawler', x: 0.7, dz: 3.6 },
      { kind: 'crawler', x: 2.6, dz: 3.2 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 260,
    layout: 'paired',
    left: { op: 'sub', value: 28, mutable: false },
    right: { op: 'add', value: 5, mutable: false },
  },
  {
    type: 'barrels',
    crossDist: 278,
    placements: [
      { x: -2.2, dz: 0 },
      { x: 0.0, dz: 3.5 },
      { x: 2.2, dz: 7.0 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 280,
    units: [
      { kind: 'crawler', x: -3.3, dz: 0 },
      { kind: 'bomber', x: 0.2, dz: 1.1 },
      { kind: 'crawler', x: 2.7, dz: 2.0 },
      { kind: 'burrower', x: -1.7, dz: 3.1 },
      { kind: 'howler', x: 1.5, dz: 4.2 },
      { kind: 'crawler', x: -2.9, dz: 5.2 },
      { kind: 'necromancer', x: -0.4, dz: 6.4 },
      { kind: 'stalker', x: 2.9, dz: 7.5 },
      { kind: 'mitosis', x: -1.9, dz: 8.6 },
      { kind: 'crawler', x: 0.9, dz: 9.5 },
      { kind: 'glacier', x: 2.3, dz: 10.6 },
      { kind: 'crawler', x: -3.2, dz: 11.6 },
      { kind: 'beholder', x: -0.9, dz: 12.6 },
      { kind: 'crawler', x: 1.6, dz: 13.5 },
      { kind: 'crawler', x: 3.2, dz: 14.4 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 289,
    layout: 'paired',
    left: { op: 'sub', value: 3, mutable: true, damagePerStep: 10, stepDelta: 1, maxValue: 10 },
    right: { op: 'add', value: 4, mutable: false },
  },
  {
    type: 'vault',
    crossDist: 340,
    x: -2.5,
    hp: 100,
    reward: 'blades',
  },
  {
    type: 'enemies',
    crossDist: 315,
    units: [
      { kind: 'crawler', x: -3.0, dz: 0 },
      { kind: 'crawler', x: -1.8, dz: 1.0 },
      { kind: 'crawler', x: -0.6, dz: 2.0 },
      { kind: 'crawler', x: 0.6, dz: 2.0 },
      { kind: 'crawler', x: 1.8, dz: 1.0 },
      { kind: 'crawler', x: 3.0, dz: 0 },
      { kind: 'crawler', x: -2.2, dz: 3.5 },
      { kind: 'crawler', x: 0.0, dz: 4.0 },
      { kind: 'crawler', x: 2.2, dz: 3.5 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 344,
    units: [
      { kind: 'dasher', x: -1.8, dz: 0 },
      { kind: 'crawler', x: 0.4, dz: 1.2 },
      { kind: 'crawler', x: 1.5, dz: 2.0 },
      { kind: 'crawler', x: 2.8, dz: 2.8 },
      { kind: 'crawler', x: -0.6, dz: 3.6 },
      { kind: 'dasher', x: 2.4, dz: 5.0 },
      { kind: 'crawler', x: -2.8, dz: 5.5 },
      { kind: 'crawler', x: 0.9, dz: 6.2 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 368,
    layout: 'paired',
    left: { op: 'add', value: 6, mutable: false },
    right: { op: 'sub', value: 2, mutable: true, damagePerStep: 12, stepDelta: 2, maxValue: 16 },
  },

  // Act 3 — Arsenal Assembly (d = 396..592)
  {
    type: 'enemies',
    crossDist: 396,
    units: [
      { kind: 'crawler', x: -3.3, dz: 0 },
      { kind: 'crawler', x: -2.1, dz: 0.9 },
      { kind: 'bomber', x: 0.0, dz: 1.6 },
      { kind: 'crawler', x: 0.3, dz: 2.2 },
      { kind: 'crawler', x: 1.5, dz: 1.8 },
      { kind: 'crawler', x: 2.7, dz: 0.9 },
      { kind: 'crawler', x: -2.6, dz: 3.4 },
      { kind: 'crawler', x: -1.2, dz: 4.2 },
      { kind: 'crawler', x: 1.0, dz: 4.2 },
      { kind: 'crawler', x: 2.4, dz: 3.4 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 422,
    units: [
      { kind: 'bastion', x: 2.5, dz: 0 },
      { kind: 'crawler', x: -2.8, dz: 0.8 },
      { kind: 'crawler', x: -1.6, dz: 1.8 },
      { kind: 'crawler', x: -0.4, dz: 2.6 },
      { kind: 'crawler', x: 1.1, dz: 3.2 },
      { kind: 'crawler', x: -2.2, dz: 4.0 },
    ],
  },
  {
    type: 'barrels',
    crossDist: 425,
    placements: [{ x: 0.8, dz: 0 }],
  },
  {
    type: 'vault',
    crossDist: 432,
    x: 2.5,
    hp: 110,
    reward: 'rail',
  },
  {
    type: 'gate_row',
    crossDist: 440,
    layout: 'paired',
    left: { op: 'add', value: 12, mutable: false },
    right: { op: 'sub', value: 4, mutable: true, damagePerStep: 16, stepDelta: 2, maxValue: 24 },
  },
  {
    type: 'enemies',
    crossDist: 476,
    units: [
      { kind: 'glacier', x: -2.4, dz: 0 },
      { kind: 'crawler', x: 0.6, dz: 0.9 },
      { kind: 'burrower', x: 2.8, dz: 1.8 },
      { kind: 'bomber', x: -0.8, dz: 2.8 },
      { kind: 'beholder', x: 1.8, dz: 3.8 },
      { kind: 'crawler', x: -3.2, dz: 4.8 },
      { kind: 'necromancer', x: 0.0, dz: 5.8 },
      { kind: 'stalker', x: -1.9, dz: 6.8 },
      { kind: 'phalanx', x: 2.4, dz: 7.8 },
      { kind: 'crawler', x: -0.6, dz: 8.8 },
      { kind: 'brood', x: -2.2, dz: 9.8 },
      { kind: 'howler', x: 1.2, dz: 10.8 },
      { kind: 'crawler', x: 3.1, dz: 11.8 },
      { kind: 'mitosis', x: -1.1, dz: 12.8 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 490,
    layout: 'paired',
    left: { op: 'sub', value: 8, mutable: true, damagePerStep: 14, stepDelta: 2, maxValue: 12 },
    right: { op: 'sub', value: 14, mutable: false },
  },
  {
    type: 'reflector',
    crossDist: 468,
    x: -3.5,
    lean: 1,
  },
  {
    type: 'lens',
    crossDist: 534,
    x: 2.4,
    driftAmp: 0.6,
    driftFreq: 1.1,
  },
  {
    type: 'jump_pad',
    crossDist: 668,
    x: -3.2,
  },
  {
    type: 'enemies',
    crossDist: 514,
    units: [
      { kind: 'crawler', x: -3.1, dz: 0 },
      { kind: 'crawler', x: -1.9, dz: 1.0 },
      { kind: 'crawler', x: -0.7, dz: 2.0 },
      { kind: 'crawler', x: 0.7, dz: 2.0 },
      { kind: 'crawler', x: 1.9, dz: 1.0 },
      { kind: 'crawler', x: 3.1, dz: 0 },
      { kind: 'dasher', x: -2.4, dz: 3.8 },
      { kind: 'crawler', x: 0.0, dz: 4.2 },
      { kind: 'crawler', x: 1.4, dz: 4.8 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 552,
    units: [
      { kind: 'bastion', x: 2.4, dz: 0 },
      { kind: 'phalanx', x: -2.2, dz: 0.4 },
      { kind: 'crawler', x: -3.0, dz: 0.6 },
      { kind: 'crawler', x: -1.8, dz: 1.6 },
      { kind: 'crawler', x: -0.6, dz: 2.4 },
      { kind: 'crawler', x: 0.8, dz: 3.0 },
      { kind: 'crawler', x: -2.4, dz: 3.8 },
      { kind: 'crawler', x: -1.0, dz: 4.6 },
    ],
  },
  {
    type: 'vault',
    crossDist: 562,
    x: 2.4,
    hp: 130,
    reward: 'scatter',
  },
  {
    type: 'gate_row',
    crossDist: 592,
    layout: 'paired',
    left: { op: 'sub', value: 18, mutable: false },
    right: { op: 'add', value: 14, mutable: false },
  },

  // Act 4 — Climax Pressure (d = 618..814)
  {
    type: 'enemies',
    crossDist: 618,
    units: [
      { kind: 'crawler', x: -3.3, dz: 0 },
      { kind: 'crawler', x: -2.2, dz: 0.8 },
      { kind: 'crawler', x: -1.1, dz: 1.6 },
      { kind: 'crawler', x: 0.0, dz: 2.2 },
      { kind: 'crawler', x: 1.1, dz: 1.6 },
      { kind: 'crawler', x: 2.2, dz: 0.8 },
      { kind: 'crawler', x: 3.3, dz: 0 },
      { kind: 'crawler', x: -1.8, dz: 3.2 },
      { kind: 'crawler', x: 1.8, dz: 3.2 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 642,
    units: [
      { kind: 'dasher', x: -3.0, dz: 0 },
      { kind: 'crawler', x: -2.0, dz: 1.2 },
      { kind: 'crawler', x: -1.0, dz: 2.2 },
      { kind: 'crawler', x: 0.4, dz: 3.2 },
      { kind: 'crawler', x: 1.8, dz: 4.2 },
      { kind: 'dasher', x: 0.0, dz: 6.0 },
      { kind: 'crawler', x: -2.6, dz: 7.0 },
      { kind: 'crawler', x: -1.2, dz: 8.0 },
      { kind: 'crawler', x: 1.2, dz: 8.5 },
      { kind: 'crawler', x: 2.5, dz: 9.6 },
      { kind: 'dasher', x: 3.0, dz: 12.0 },
      { kind: 'crawler', x: -1.6, dz: 13.0 },
      { kind: 'crawler', x: 0.0, dz: 14.0 },
      { kind: 'crawler', x: 1.6, dz: 14.6 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 680,
    layout: 'standalone',
    single: {
      x: 2.6,
      halfWidth: 1.9,
      op: 'sub',
      value: 8,
      mutable: false,
    },
  },
  {
    type: 'vault',
    crossDist: 706,
    x: -2.6,
    hp: 150,
    reward: 'plasma',
  },
  {
    type: 'vault',
    crossDist: 714,
    x: 2.6,
    hp: 150,
    reward: 'cryo',
  },
  {
    type: 'gate_row',
    crossDist: 734,
    layout: 'paired',
    left: { op: 'add', value: 10, mutable: false },
    right: { op: 'sub', value: 6, mutable: true, damagePerStep: 18, stepDelta: 2, maxValue: 12 },
  },
  {
    type: 'barrels',
    crossDist: 774,
    placements: [
      { x: 0.0, dz: 0 },
      { x: -2.2, dz: 3.5 },
      { x: 2.2, dz: 3.5 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 752,
    units: [
      { kind: 'bomber', x: 0.0, dz: 0.8 },
      { kind: 'crawler', x: -3.2, dz: 0 },
      { kind: 'phalanx', x: -2.0, dz: 0.9 },
      { kind: 'crawler', x: -0.8, dz: 1.8 },
      { kind: 'crawler', x: 0.8, dz: 1.8 },
      { kind: 'crawler', x: 2.0, dz: 0.9 },
      { kind: 'crawler', x: 3.2, dz: 0 },
      { kind: 'crawler', x: -2.6, dz: 3.2 },
      { kind: 'crawler', x: 0.0, dz: 3.6 },
      { kind: 'crawler', x: 2.6, dz: 3.2 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 776,
    units: [
      { kind: 'bastion', x: -2.2, dz: 1.5 },
      { kind: 'bastion', x: 2.2, dz: 1.5 },
      { kind: 'crawler', x: -3.4, dz: 2.6 },
      { kind: 'crawler', x: -1.2, dz: 3.4 },
      { kind: 'crawler', x: 0.0, dz: 3.8 },
      { kind: 'crawler', x: 1.2, dz: 3.4 },
      { kind: 'crawler', x: 3.4, dz: 2.6 },
      { kind: 'crawler', x: -2.4, dz: 5.2 },
      { kind: 'crawler', x: -0.9, dz: 5.8 },
      { kind: 'crawler', x: 0.0, dz: 6.4 },
      { kind: 'crawler', x: 0.9, dz: 5.8 },
      { kind: 'crawler', x: 2.4, dz: 5.2 },
      { kind: 'crawler', x: -1.6, dz: 7.4 },
      { kind: 'crawler', x: 1.6, dz: 7.4 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 814,
    layout: 'paired',
    left: { op: 'sub', value: 16, mutable: false },
    right: { op: 'add', value: 8, mutable: false },
  },
];

const SECTOR_2_ENCOUNTERS: readonly RunwayEncounter[] = [
  // Act 1 — Onboarding (d = 34..186)
  {
    type: 'gate_row',
    crossDist: 34,
    layout: 'paired',
    left: { op: 'add', value: 3, mutable: false },
    right: { op: 'add', value: 6, mutable: false },
  },
  {
    type: 'enemies',
    crossDist: 86,
    units: [
      { kind: 'mitosis', x: -1.8, dz: 0 },
      { kind: 'crawler', x: -2.8, dz: 1.2 },
      { kind: 'crawler', x: -0.4, dz: 1.8 },
      { kind: 'crawler', x: 0.5, dz: 2.4 },
      { kind: 'mitosis', x: 1.8, dz: 3.0 },
      { kind: 'crawler', x: 2.9, dz: 4.0 },
      { kind: 'crawler', x: -2.2, dz: 4.8 },
      { kind: 'crawler', x: 2.2, dz: 5.4 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 138,
    layout: 'paired',
    left: { op: 'sub', value: 8, mutable: false },
    right: { op: 'add', value: 4, mutable: true, damagePerStep: 10, stepDelta: 1, maxValue: 12 },
    tetheredSiphon: { side: 'right', zAhead: 5.5 },
  },
  {
    type: 'gate_row',
    crossDist: 186,
    layout: 'paired',
    left: { op: 'mul', value: 2, mutable: false },
    right: { op: 'add', value: 12, mutable: false },
  },
  {
    type: 'gate_row',
    crossDist: 215,
    layout: 'standalone',
    single: {
      x: -2.6,
      halfWidth: 1.9,
      op: 'sub',
      value: 6,
      mutable: false,
    },
  },

  // Act 2 — Meaningful Choice (d = 248..402)
  {
    type: 'vault',
    crossDist: 248,
    x: 2.5,
    hp: 90,
    reward: 'rail',
  },
  {
    type: 'enemies',
    crossDist: 250,
    units: [
      { kind: 'mitosis', x: -2.2, dz: 0 },
      { kind: 'crawler', x: -1.5, dz: 1.4 },
      { kind: 'crawler', x: -3.1, dz: 1.8 },
      { kind: 'mitosis', x: -2.6, dz: 3.2 },
      { kind: 'crawler', x: -1.8, dz: 4.4 },
      { kind: 'crawler', x: 2.0, dz: 1.6 },
      { kind: 'crawler', x: 3.1, dz: 2.8 },
      { kind: 'crawler', x: 2.4, dz: 4.2 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 268,
    layout: 'paired',
    left: { op: 'add', value: 6, mutable: false },
    right: { op: 'sub', value: 34, mutable: false },
  },
  {
    type: 'gate_row',
    crossDist: 328,
    layout: 'paired',
    left: { op: 'add', value: 3, mutable: false },
    right: { op: 'div', value: 2, mutable: true, lockHp: 80 },
  },
  {
    type: 'enemies',
    crossDist: 300,
    units: [
      { kind: 'crawler', x: -3.2, dz: 0 },
      { kind: 'crawler', x: -2.0, dz: 0.9 },
      { kind: 'mitosis', x: -0.8, dz: 1.8 },
      { kind: 'mitosis', x: 0.8, dz: 1.8 },
      { kind: 'crawler', x: 2.0, dz: 0.9 },
      { kind: 'crawler', x: 3.2, dz: 0 },
      { kind: 'crawler', x: -2.4, dz: 3.6 },
      { kind: 'crawler', x: 0.0, dz: 4.2 },
      { kind: 'crawler', x: 2.4, dz: 3.6 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 360,
    units: [
      { kind: 'crawler', x: -3.0, dz: 0 },
      { kind: 'crawler', x: -1.6, dz: 1.0 },
      { kind: 'crawler', x: 0.0, dz: 1.8 },
      { kind: 'crawler', x: 1.6, dz: 1.0 },
      { kind: 'crawler', x: 3.0, dz: 0 },
      { kind: 'mitosis', x: -1.8, dz: 3.4 },
      { kind: 'mitosis', x: 1.8, dz: 3.4 },
      { kind: 'crawler', x: -0.6, dz: 4.6 },
      { kind: 'crawler', x: 0.6, dz: 4.6 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 391,
    units: [
      { kind: 'bastion', x: -2.5, dz: 0 },
      { kind: 'crawler', x: 1.2, dz: 0.8 },
      { kind: 'crawler', x: 2.4, dz: 1.8 },
      { kind: 'crawler', x: 3.4, dz: 2.6 },
      { kind: 'mitosis', x: 1.8, dz: 3.8 },
    ],
  },
  {
    type: 'barrels',
    crossDist: 394,
    placements: [{ x: -0.6, dz: 0 }],
  },
  {
    type: 'gate_row',
    crossDist: 402,
    layout: 'paired',
    left: { op: 'sub', value: 2, mutable: true, damagePerStep: 14, stepDelta: 2, maxValue: 12 },
    right: { op: 'sub', value: 15, mutable: false },
    tetheredSiphon: { side: 'left', zAhead: 5.5 },
  },

  {
    type: 'contract_lane',
    crossDist: 418,
    length: 44,
    bountySide: 'left',
    bountyHp: 195,
  },

  // Act 3 — Arsenal Assembly (d = 496..722)
  {
    type: 'barrels',
    crossDist: 496,
    placements: [
      { x: -3.3, dz: 0 },
      { x: -1.1, dz: 3.5 },
      { x: 1.1, dz: 7.0 },
      { x: 3.3, dz: 10.5 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 452,
    units: [
      { kind: 'stalker', x: -2.4, dz: 0.4 },
      { kind: 'bomber', x: 0.0, dz: 1.4 },
      { kind: 'glacier', x: 2.4, dz: 2.2 },
      { kind: 'necromancer', x: -1.2, dz: 3.8 },
      { kind: 'beholder', x: 1.4, dz: 4.4 },
      { kind: 'crawler', x: -0.9, dz: 1.6 },
      { kind: 'crawler', x: 0.9, dz: 1.6 },
      { kind: 'crawler', x: 2.1, dz: 0.8 },
      { kind: 'crawler', x: 3.3, dz: 0 },
      { kind: 'mitosis', x: -1.6, dz: 3.2 },
      { kind: 'mitosis', x: 1.6, dz: 3.2 },
      { kind: 'crawler', x: -2.8, dz: 4.8 },
      { kind: 'crawler', x: 0.0, dz: 5.0 },
      { kind: 'crawler', x: 2.8, dz: 4.8 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 498,
    units: [
      { kind: 'mitosis', x: -2.2, dz: 1.5 },
      { kind: 'crawler', x: -3.2, dz: 2.2 },
      { kind: 'crawler', x: -1.0, dz: 2.8 },
      { kind: 'crawler', x: 1.0, dz: 3.6 },
      { kind: 'mitosis', x: 0.0, dz: 5.0 },
      { kind: 'crawler', x: -2.4, dz: 5.8 },
      { kind: 'crawler', x: 2.4, dz: 6.4 },
      { kind: 'crawler', x: -0.8, dz: 7.4 },
      { kind: 'mitosis', x: 2.2, dz: 8.5 },
      { kind: 'crawler', x: 3.2, dz: 9.5 },
      { kind: 'crawler', x: -1.8, dz: 10.2 },
      { kind: 'crawler', x: 1.2, dz: 10.8 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 510,
    layout: 'paired',
    left: { op: 'sub', value: 16, mutable: false },
    right: { op: 'sub', value: 1, mutable: true, damagePerStep: 16, stepDelta: 2, maxValue: 12 },
  },
  {
    type: 'reflector',
    crossDist: 492,
    x: -3.5,
    lean: 1,
  },
  {
    type: 'lens',
    crossDist: 564,
    x: 2.5,
    driftAmp: 0.7,
    driftFreq: 1.2,
  },
  {
    type: 'jump_pad',
    crossDist: 816,
    x: -3.2,
  },
  {
    type: 'enemies',
    crossDist: 540,
    units: [
      { kind: 'crawler', x: -3.2, dz: 0 },
      { kind: 'crawler', x: -1.8, dz: 1.0 },
      { kind: 'crawler', x: -0.4, dz: 1.8 },
      { kind: 'crawler', x: 1.0, dz: 1.8 },
      { kind: 'crawler', x: 2.4, dz: 1.0 },
      { kind: 'mitosis', x: -2.2, dz: 3.4 },
      { kind: 'mitosis', x: 2.0, dz: 3.4 },
      { kind: 'crawler', x: 0.0, dz: 4.6 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 578,
    units: [
      { kind: 'dasher', x: 0.0, dz: 0 },
      { kind: 'crawler', x: -2.8, dz: 1.2 },
      { kind: 'crawler', x: -1.4, dz: 2.2 },
      { kind: 'crawler', x: 1.4, dz: 2.8 },
      { kind: 'dasher', x: 2.8, dz: 5.0 },
      { kind: 'crawler', x: -2.2, dz: 5.8 },
      { kind: 'crawler', x: 0.6, dz: 6.4 },
    ],
  },
  {
    type: 'vault',
    crossDist: 582,
    x: 2.5,
    hp: 155,
    reward: 'cryo',
  },
  {
    type: 'vault',
    crossDist: 584,
    x: -2.5,
    hp: 155,
    reward: 'scatter',
  },
  {
    type: 'vault',
    crossDist: 648,
    x: -2.4,
    hp: 150,
    reward: 'blades',
  },
  {
    type: 'gate_row',
    crossDist: 658,
    layout: 'paired',
    left: { op: 'div', value: 2, mutable: false },
    right: { op: 'add', value: 2, mutable: true, damagePerStep: 18, stepDelta: 2, maxValue: 12 },
    tetheredSiphon: { side: 'right', zAhead: 5.5 },
  },
  {
    type: 'vault',
    crossDist: 706,
    x: 2.5,
    hp: 165,
    reward: 'rail',
  },
  {
    type: 'gate_row',
    crossDist: 722,
    layout: 'paired',
    left: { op: 'add', value: 8, mutable: true, damagePerStep: 24, stepDelta: 4, maxValue: 36 },
    right: { op: 'add', value: 24, mutable: false },
  },

  // Act 4 — Climax Pressure (d = 768..1012)
  {
    type: 'lens',
    crossDist: 768,
    x: 2.4,
    driftAmp: 0.8,
    driftFreq: 1.1,
  },
  {
    type: 'enemies',
    crossDist: 784,
    units: [
      { kind: 'bastion', x: -2.4, dz: 0 },
      { kind: 'bastion', x: 2.4, dz: 0 },
      { kind: 'crawler', x: -1.2, dz: 1.5 },
      { kind: 'crawler', x: 0.0, dz: 2.0 },
      { kind: 'crawler', x: 1.2, dz: 1.5 },
      { kind: 'mitosis', x: -0.8, dz: 3.4 },
      { kind: 'crawler', x: -3.2, dz: 4.2 },
      { kind: 'crawler', x: 3.2, dz: 4.2 },
      { kind: 'mitosis', x: 0.8, dz: 5.6 },
      { kind: 'crawler', x: -1.8, dz: 6.8 },
      { kind: 'crawler', x: 0.0, dz: 7.2 },
      { kind: 'crawler', x: 1.8, dz: 6.8 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 832,
    units: [
      { kind: 'crawler', x: -3.3, dz: 0 },
      { kind: 'crawler', x: -2.1, dz: 0.8 },
      { kind: 'crawler', x: -0.9, dz: 1.6 },
      { kind: 'crawler', x: 0.9, dz: 1.6 },
      { kind: 'crawler', x: 2.1, dz: 0.8 },
      { kind: 'crawler', x: 3.3, dz: 0 },
      { kind: 'mitosis', x: -1.5, dz: 3.2 },
      { kind: 'mitosis', x: 1.5, dz: 3.2 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 858,
    units: [
      { kind: 'dasher', x: -3.2, dz: 0 },
      { kind: 'crawler', x: -1.6, dz: 1.8 },
      { kind: 'crawler', x: 1.6, dz: 2.4 },
      { kind: 'dasher', x: 0.0, dz: 6.0 },
      { kind: 'crawler', x: -2.4, dz: 7.5 },
      { kind: 'crawler', x: 2.4, dz: 8.2 },
      { kind: 'dasher', x: 3.2, dz: 12.0 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 872,
    units: [
      { kind: 'bastion', x: 2.5, dz: 0 },
      { kind: 'crawler', x: 1.6, dz: 2 },
      { kind: 'crawler', x: 3.4, dz: 2 },
      { kind: 'crawler', x: -2.8, dz: 1.4 },
      { kind: 'crawler', x: -1.4, dz: 2.4 },
      { kind: 'crawler', x: 0.2, dz: 3.2 },
      { kind: 'crawler', x: -2.0, dz: 4.2 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 884,
    layout: 'paired',
    left: { op: 'sub', value: 20, mutable: false },
    right: { op: 'sub', value: 8, mutable: true, damagePerStep: 18, stepDelta: 2, maxValue: 12 },
  },
  {
    type: 'vault',
    crossDist: 940,
    x: 2.5,
    hp: 175,
    reward: 'plasma',
  },
  {
    type: 'vault',
    crossDist: 942,
    x: -2.5,
    hp: 175,
    reward: 'cryo',
  },
  {
    type: 'barrels',
    crossDist: 944,
    placements: [
      { x: 0.0, dz: 0 },
      { x: -2.2, dz: 3.5 },
      { x: 2.2, dz: 3.5 },
      { x: 0.0, dz: 7.0 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 946,
    units: [{ kind: 'bastion', x: 0.0, dz: 1.5 }],
  },
  {
    type: 'gate_row',
    crossDist: 958,
    layout: 'paired',
    left: { op: 'sub', value: 2, mutable: true, damagePerStep: 18, stepDelta: 2, maxValue: 12 },
    right: { op: 'sub', value: 22, mutable: false },
    tetheredSiphon: { side: 'left', zAhead: 5.5 },
  },
  {
    type: 'enemies',
    crossDist: 998,
    units: [
      { kind: 'phalanx', x: -1.8, dz: 0.4 },
      { kind: 'howler', x: 1.8, dz: 2.2 },
      { kind: 'stalker', x: -2.8, dz: 1.8 },
      { kind: 'crawler', x: -3.0, dz: 0 },
      { kind: 'crawler', x: -1.6, dz: 0.9 },
      { kind: 'crawler', x: 0.0, dz: 1.4 },
      { kind: 'crawler', x: 1.6, dz: 0 },
      { kind: 'crawler', x: 2.6, dz: 1.5 },
      { kind: 'crawler', x: 3.6, dz: 3.0 },
      { kind: 'mitosis', x: -2.0, dz: 2.8 },
      { kind: 'crawler', x: -0.6, dz: 3.8 },
      { kind: 'crawler', x: 1.0, dz: 4.2 },
      { kind: 'dasher', x: 2.4, dz: 5.0 },
      { kind: 'crawler', x: -2.8, dz: 5.6 },
      { kind: 'crawler', x: 0.4, dz: 6.2 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 1012,
    layout: 'paired',
    left: { op: 'sub', value: 18, mutable: false },
    right: { op: 'add', value: 10, mutable: false },
  },
];

const SECTOR_3_ENCOUNTERS: readonly RunwayEncounter[] = [
  // Act 1 — Onboarding (d = 36..212)
  {
    type: 'gate_row',
    crossDist: 36,
    layout: 'paired',
    left: { op: 'add', value: 4, mutable: false },
    right: { op: 'add', value: 7, mutable: false },
  },
  {
    type: 'enemies',
    crossDist: 94,
    units: [
      { kind: 'crawler', x: -3.2, dz: 0 },
      { kind: 'crawler', x: -2.2, dz: 0.8 },
      { kind: 'crawler', x: -1.0, dz: 1.8 },
      { kind: 'crawler', x: 0.2, dz: 2.8 },
      { kind: 'crawler', x: 1.8, dz: 1.2 },
      { kind: 'dasher', x: 2.6, dz: 2.0 },
      { kind: 'crawler', x: 3.4, dz: 3.2 },
      { kind: 'crawler', x: -2.6, dz: 4.2 },
      { kind: 'mitosis', x: -1.8, dz: 5.2 },
      { kind: 'crawler', x: 2.2, dz: 5.6 },
      { kind: 'crawler', x: -3.0, dz: 6.4 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 152,
    layout: 'paired',
    left: { op: 'sub', value: 12, mutable: false },
    right: { op: 'sub', value: 2, mutable: true, damagePerStep: 12, stepDelta: 2, maxValue: 12 },
    tetheredSiphon: { side: 'right', zAhead: 5.5 },
  },
  {
    type: 'gate_row',
    crossDist: 212,
    layout: 'paired',
    left: { op: 'mul', value: 2, mutable: false },
    right: { op: 'add', value: 5, mutable: false },
  },
  {
    type: 'gate_row',
    crossDist: 243,
    layout: 'standalone',
    single: {
      x: -2.6,
      halfWidth: 1.9,
      op: 'sub',
      value: 8,
      mutable: false,
    },
  },

  // Act 2 — Meaningful Choice (d = 270..458)
  {
    type: 'vault',
    crossDist: 270,
    x: -2.6,
    hp: 115,
    reward: 'plasma',
  },
  {
    type: 'vault',
    crossDist: 278,
    x: 2.6,
    hp: 115,
    reward: 'cryo',
  },
  {
    type: 'gate_row',
    crossDist: 294,
    layout: 'paired',
    left: { op: 'add', value: 6, mutable: false },
    right: { op: 'sub', value: 32, mutable: false },
  },
  {
    type: 'enemies',
    crossDist: 326,
    units: [
      { kind: 'crawler', x: -3.3, dz: 0 },
      { kind: 'crawler', x: -2.1, dz: 0.8 },
      { kind: 'crawler', x: -0.9, dz: 1.6 },
      { kind: 'crawler', x: 0.9, dz: 1.6 },
      { kind: 'crawler', x: 2.1, dz: 0.8 },
      { kind: 'crawler', x: 3.3, dz: 0 },
      { kind: 'mitosis', x: -1.8, dz: 3.2 },
      { kind: 'mitosis', x: 1.8, dz: 3.2 },
      { kind: 'crawler', x: 0.0, dz: 4.4 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 356,
    units: [
      { kind: 'dasher', x: -2.8, dz: 0 },
      { kind: 'bastion', x: 0.0, dz: 1.5 },
      { kind: 'crawler', x: -1.6, dz: 2.2 },
      { kind: 'crawler', x: 1.6, dz: 2.2 },
      { kind: 'crawler', x: -3.2, dz: 3.6 },
      { kind: 'crawler', x: 3.2, dz: 3.6 },
      { kind: 'dasher', x: 2.8, dz: 5.0 },
      { kind: 'crawler', x: -1.0, dz: 5.8 },
      { kind: 'crawler', x: 1.0, dz: 5.8 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 378,
    layout: 'paired',
    left: { op: 'div', value: 2, mutable: false },
    right: { op: 'div', value: 2, mutable: true, lockHp: 110 },
  },
  {
    type: 'barrels',
    crossDist: 446,
    placements: [{ x: -0.7, dz: 0 }],
  },
  {
    type: 'enemies',
    crossDist: 416,
    units: [
      { kind: 'bomber', x: 0.0, dz: 0.8 },
      { kind: 'stalker', x: -2.2, dz: 1.2 },
      { kind: 'crawler', x: -3.2, dz: 0 },
      { kind: 'crawler', x: -1.8, dz: 0.9 },
      { kind: 'crawler', x: -0.4, dz: 1.6 },
      { kind: 'crawler', x: 1.0, dz: 1.6 },
      { kind: 'crawler', x: 2.4, dz: 0.9 },
      { kind: 'mitosis', x: -2.2, dz: 3.0 },
      { kind: 'mitosis', x: 2.2, dz: 3.0 },
      { kind: 'crawler', x: -0.8, dz: 4.2 },
      { kind: 'crawler', x: 0.8, dz: 4.2 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 447,
    units: [
      { kind: 'bastion', x: -2.5, dz: 0 },
      { kind: 'crawler', x: -1.2, dz: 1.2 },
      { kind: 'mitosis', x: 1.8, dz: 2.0 },
      { kind: 'crawler', x: 0.5, dz: 3.0 },
      { kind: 'crawler', x: 2.8, dz: 3.4 },
      { kind: 'dasher', x: 3.2, dz: 4.5 },
      { kind: 'crawler', x: -3.3, dz: 4.8 },
      { kind: 'crawler', x: 1.4, dz: 5.0 },
      { kind: 'crawler', x: -0.4, dz: 6.0 },
      { kind: 'crawler', x: 2.2, dz: 6.6 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 458,
    layout: 'paired',
    left: { op: 'sub', value: 20, mutable: false },
    right: { op: 'sub', value: 6, mutable: true, damagePerStep: 16, stepDelta: 2, maxValue: 14 },
    tetheredSiphon: { side: 'right', zAhead: 5.5 },
  },

  // Act 3 — Arsenal Assembly (d = 568..860)
  {
    type: 'enemies',
    crossDist: 506,
    units: [
      { kind: 'crawler', x: -3.4, dz: 0 },
      { kind: 'crawler', x: -2.4, dz: 0.8 },
      { kind: 'crawler', x: -1.4, dz: 1.6 },
      { kind: 'crawler', x: 0.0, dz: 2.0 },
      { kind: 'mitosis', x: 2.4, dz: 2.0 },
      { kind: 'crawler', x: 1.2, dz: 2.8 },
      { kind: 'crawler', x: 3.3, dz: 3.2 },
      { kind: 'dasher', x: -3.0, dz: 4.0 },
      { kind: 'mitosis', x: -1.2, dz: 4.8 },
      { kind: 'crawler', x: 0.8, dz: 5.4 },
      { kind: 'crawler', x: 2.2, dz: 6.0 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 520,
    layout: 'paired',
    left: { op: 'sub', value: 4, mutable: true, damagePerStep: 22, stepDelta: 3, maxValue: 20 },
    right: { op: 'add', value: 12, mutable: false },
  },
  {
    type: 'contract_lane',
    crossDist: 528,
    length: 46,
    bountySide: 'right',
    bountyHp: 310,
  },
  {
    type: 'reflector',
    crossDist: 662,
    x: 3.5,
    lean: -1,
  },
  {
    type: 'jump_pad',
    crossDist: 966,
    x: 3.2,
  },
  {
    type: 'lens',
    crossDist: 568,
    x: -2.4,
    driftAmp: 0.5,
    driftFreq: 1.0,
  },
  {
    type: 'lens',
    crossDist: 580,
    x: 2.4,
    driftAmp: 0.5,
    driftFreq: 1.0,
  },
  {
    type: 'vault',
    crossDist: 592,
    x: -2.4,
    hp: 200,
    reward: 'plasma',
  },
  {
    type: 'vault',
    crossDist: 600,
    x: 2.4,
    hp: 185,
    reward: 'blades',
  },
  {
    type: 'enemies',
    crossDist: 628,
    units: [
      { kind: 'brood', x: -2.0, dz: 0.6 },
      { kind: 'glacier', x: 2.4, dz: 0.2 },
      { kind: 'burrower', x: 0.8, dz: 2.0 },
      { kind: 'necromancer', x: -0.8, dz: 3.8 },
      { kind: 'beholder', x: 1.8, dz: 4.8 },
      { kind: 'crawler', x: -3.2, dz: 0.8 },
      { kind: 'crawler', x: -2.2, dz: 1.8 },
      { kind: 'crawler', x: -1.0, dz: 2.6 },
      { kind: 'mitosis', x: 0.4, dz: 3.2 },
      { kind: 'crawler', x: -0.8, dz: 4.2 },
      { kind: 'crawler', x: 1.6, dz: 4.8 },
      { kind: 'crawler', x: -2.6, dz: 5.4 },
      { kind: 'dasher', x: 3.2, dz: 6.0 },
      { kind: 'crawler', x: -1.4, dz: 6.8 },
      { kind: 'crawler', x: 0.2, dz: 7.4 },
    ],
  },
  {
    type: 'barrels',
    crossDist: 668,
    placements: [
      { x: -3.3, dz: 0 },
      { x: -1.1, dz: 3.5 },
      { x: 1.1, dz: 7.0 },
      { x: 3.3, dz: 10.5 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 670,
    units: [
      { kind: 'bastion', x: -2.0, dz: 1.5 },
      { kind: 'crawler', x: -3.3, dz: 2.2 },
      { kind: 'crawler', x: -0.8, dz: 2.8 },
      { kind: 'crawler', x: 1.0, dz: 3.2 },
      { kind: 'mitosis', x: -0.2, dz: 4.0 },
      { kind: 'crawler', x: -2.4, dz: 5.0 },
      { kind: 'crawler', x: 2.8, dz: 5.4 },
      { kind: 'bastion', x: 2.0, dz: 6.5 },
      { kind: 'crawler', x: -1.4, dz: 7.4 },
      { kind: 'mitosis', x: 0.8, dz: 8.5 },
      { kind: 'crawler', x: -2.8, dz: 9.4 },
      { kind: 'crawler', x: 0.0, dz: 9.8 },
      { kind: 'crawler', x: 3.1, dz: 10.2 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 686,
    layout: 'paired',
    left: { op: 'add', value: 10, mutable: false },
    right: { op: 'div', value: 3, mutable: false },
  },
  {
    type: 'gate_row',
    crossDist: 722,
    layout: 'standalone',
    single: {
      x: 2.6,
      halfWidth: 1.9,
      op: 'sub',
      value: 6,
      mutable: true,
      damagePerStep: 20,
      stepDelta: 2,
      maxValue: 12,
    },
  },
  {
    type: 'lens',
    crossDist: 746,
    x: -2.5,
    driftAmp: 0.5,
    driftFreq: 1.0,
  },
  {
    type: 'barrels',
    crossDist: 758,
    placements: [{ x: -0.8, dz: 0 }],
  },
  {
    type: 'enemies',
    crossDist: 760,
    units: [{ kind: 'bastion', x: -2.5, dz: 0 }],
  },
  {
    type: 'gate_row',
    crossDist: 770,
    layout: 'paired',
    left: { op: 'sub', value: 24, mutable: true, damagePerStep: 14, stepDelta: 4, maxValue: 18 },
    right: { op: 'div', value: 2, mutable: false },
  },
  {
    type: 'enemies',
    crossDist: 812,
    units: [
      { kind: 'mitosis', x: -2.0, dz: 0 },
      { kind: 'crawler', x: -3.2, dz: 0.8 },
      { kind: 'crawler', x: -0.8, dz: 1.4 },
      { kind: 'crawler', x: 0.8, dz: 2.0 },
      { kind: 'mitosis', x: 2.0, dz: 3.0 },
      { kind: 'crawler', x: 3.2, dz: 3.6 },
      { kind: 'crawler', x: -2.4, dz: 4.4 },
      { kind: 'crawler', x: 0.0, dz: 5.0 },
      { kind: 'mitosis', x: 0.0, dz: 6.2 },
      { kind: 'crawler', x: -1.4, dz: 7.2 },
      { kind: 'crawler', x: 1.4, dz: 7.2 },
    ],
  },
  {
    type: 'lens',
    crossDist: 830,
    x: -2.5,
    driftAmp: 0.5,
    driftFreq: 1.0,
  },
  {
    type: 'lens',
    crossDist: 842,
    x: 2.5,
    driftAmp: 0.5,
    driftFreq: 1.0,
  },
  {
    type: 'vault',
    crossDist: 852,
    x: -2.6,
    hp: 240,
    reward: 'plasma',
  },
  {
    type: 'vault',
    crossDist: 860,
    x: 2.6,
    hp: 240,
    reward: 'rail',
  },

  // Act 4 — Climax Pressure (d = 926..1208)
  {
    type: 'gate_row',
    crossDist: 905,
    layout: 'paired',
    left: { op: 'add', value: 15, mutable: false },
    right: { op: 'sub', value: 10, mutable: true, damagePerStep: 26, stepDelta: 4, maxValue: 30 },
  },
  {
    type: 'enemies',
    crossDist: 926,
    units: [
      { kind: 'dasher', x: -3.4, dz: 0 },
      { kind: 'crawler', x: -2.0, dz: 1.2 },
      { kind: 'crawler', x: 0.0, dz: 2.2 },
      { kind: 'crawler', x: 2.0, dz: 3.2 },
      { kind: 'dasher', x: -1.1, dz: 5.0 },
      { kind: 'crawler', x: -2.8, dz: 6.4 },
      { kind: 'mitosis', x: 1.6, dz: 7.4 },
      { kind: 'crawler', x: -0.4, dz: 8.6 },
      { kind: 'dasher', x: 1.1, dz: 10.0 },
      { kind: 'crawler', x: -2.2, dz: 11.4 },
      { kind: 'crawler', x: 2.6, dz: 12.6 },
      { kind: 'dasher', x: 3.4, dz: 15.0 },
    ],
  },
  {
    type: 'vault',
    crossDist: 948,
    x: -2.4,
    hp: 210,
    reward: 'blades',
  },
  {
    type: 'gate_row',
    crossDist: 982,
    layout: 'standalone',
    single: {
      x: -2.6,
      halfWidth: 1.9,
      op: 'sub',
      value: 4,
      mutable: true,
      damagePerStep: 24,
      stepDelta: 2,
      maxValue: 10,
    },
  },
  {
    type: 'barrels',
    crossDist: 1018,
    placements: [
      { x: -2.2, dz: 0 },
      { x: 0.0, dz: 3.5 },
      { x: 2.2, dz: 7.0 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 1020,
    units: [
      { kind: 'bastion', x: -2.5, dz: 1.0 },
      { kind: 'crawler', x: -1.1, dz: 1.8 },
      { kind: 'crawler', x: 1.1, dz: 2.2 },
      { kind: 'mitosis', x: 0.0, dz: 3.0 },
      { kind: 'crawler', x: -3.3, dz: 3.8 },
      { kind: 'bastion', x: 2.5, dz: 4.5 },
      { kind: 'crawler', x: -1.6, dz: 5.4 },
      { kind: 'crawler', x: 0.8, dz: 5.8 },
      { kind: 'dasher', x: -3.5, dz: 6.5 },
      { kind: 'mitosis', x: -0.8, dz: 7.6 },
      { kind: 'crawler', x: 1.8, dz: 8.4 },
      { kind: 'dasher', x: 3.5, dz: 9.5 },
      { kind: 'crawler', x: -2.2, dz: 10.4 },
      { kind: 'crawler', x: 0.0, dz: 10.8 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 1032,
    layout: 'paired',
    left: { op: 'sub', value: 25, mutable: false },
    right: { op: 'add', value: 6, mutable: true, damagePerStep: 20, stepDelta: 2, maxValue: 16 },
    tetheredSiphon: { side: 'right', zAhead: 5.5 },
  },
  {
    type: 'enemies',
    crossDist: 1075,
    units: [
      { kind: 'brood', x: 2.2, dz: 0.8 },
      { kind: 'phalanx', x: -2.5, dz: 0 },
      { kind: 'bomber', x: 0.0, dz: 1.5 },
      { kind: 'howler', x: -0.8, dz: 3.4 },
      { kind: 'stalker', x: 1.8, dz: 2.6 },
      { kind: 'crawler', x: -1.5, dz: 1.4 },
      { kind: 'crawler', x: -3.3, dz: 1.8 },
      { kind: 'crawler', x: 0.4, dz: 2.2 },
      { kind: 'mitosis', x: 2.0, dz: 2.8 },
      { kind: 'crawler', x: 3.2, dz: 3.6 },
      { kind: 'crawler', x: -0.6, dz: 4.2 },
      { kind: 'crawler', x: 1.2, dz: 4.8 },
    ],
  },
  {
    type: 'enemies',
    crossDist: 1118,
    units: [
      { kind: 'bastion', x: 0.0, dz: 0 },
      { kind: 'crawler', x: -3.2, dz: 1.0 },
      { kind: 'crawler', x: 3.2, dz: 1.0 },
      { kind: 'mitosis', x: -2.2, dz: 2.5 },
      { kind: 'mitosis', x: 2.2, dz: 2.5 },
      { kind: 'crawler', x: -1.2, dz: 3.6 },
      { kind: 'crawler', x: 0.0, dz: 4.0 },
      { kind: 'crawler', x: 1.2, dz: 3.6 },
      { kind: 'crawler', x: -2.6, dz: 5.2 },
      { kind: 'crawler', x: -0.8, dz: 5.8 },
      { kind: 'crawler', x: 0.8, dz: 5.8 },
      { kind: 'crawler', x: 2.6, dz: 5.2 },
      { kind: 'mitosis', x: 0.0, dz: 7.0 },
    ],
  },
  {
    type: 'gate_row',
    crossDist: 1134,
    layout: 'paired',
    left: { op: 'sub', value: 8, mutable: true, damagePerStep: 20, stepDelta: 3, maxValue: 14 },
    right: { op: 'sub', value: 24, mutable: false },
  },
  {
    type: 'gate_row',
    crossDist: 1208,
    layout: 'paired',
    left: { op: 'div', value: 2, mutable: false },
    right: { op: 'add', value: 12, mutable: false },
  },
];

export const SECTORS: Readonly<Record<SectorId, SectorScriptConfig>> = {
  1: {
    id: 1,
    name: 'Optical Trunkline',
    subtitle: '光学干线',
    scrollSpeed: 14.0,
    runwayLength: 850,
    startSquad: 1,
    boss: {
      id: 'warden_01',
      name: 'WARDEN-01《赤焰魔像王》',
      maxHp: 7500,
      maxPhases: 2,
      enrageAfterSec: 11,
    },
    encounters: [...SECTOR_1_ENCOUNTERS].sort((a, b) => a.crossDist - b.crossDist),
  },
  2: {
    id: 2,
    name: 'Overclock Conduit',
    subtitle: '超频回廊',
    scrollSpeed: 15.0,
    runwayLength: 1050,
    startSquad: 3,
    boss: {
      id: 'hydra_02',
      name: 'HYDRA-02《双生魔龙》',
      maxHp: 26000,
      maxPhases: 2,
      enrageAfterSec: 26,
    },
    encounters: [...SECTOR_2_ENCOUNTERS].sort((a, b) => a.crossDist - b.crossDist),
  },
  3: {
    id: 3,
    name: 'Singularity Core',
    subtitle: '零号奇点',
    scrollSpeed: 16.0,
    runwayLength: 1250,
    startSquad: 5,
    boss: {
      id: 'omega_zero',
      name: 'OMEGA-ZERO《深渊魔王》',
      maxHp: 70000,
      maxPhases: 3,
      pylonHp: 3500,
      enrageAfterSec: 42,
    },
    encounters: [...SECTOR_3_ENCOUNTERS].sort((a, b) => a.crossDist - b.crossDist),
  },
  4: buildGauntletScript(0),
};

function buildGauntletScript(seed: number): SectorScriptConfig {
  const generated = generateGauntlet(seed);
  return {
    id: 4,
    name: 'Random Corridor',
    subtitle: '随机回廊',
    scrollSpeed: 16.5,
    runwayLength: GAUNTLET_RUNWAY_LENGTH,
    startSquad: 6,
    boss: generated.boss,
    encounters: generated.encounters,
  };
}

let gauntletCache: { seed: number; script: SectorScriptConfig } | null = null;

/** Sector 4 is regenerated from the run's layout seed; sectors 1–3 are authored. */
export function getSectorScript(sector: SectorId, seed: number): SectorScriptConfig {
  if (sector !== 4) return SECTORS[sector];
  if (!gauntletCache || gauntletCache.seed !== seed) {
    gauntletCache = { seed, script: seed === 0 ? SECTORS[4] : buildGauntletScript(seed) };
  }
  return gauntletCache.script;
}
