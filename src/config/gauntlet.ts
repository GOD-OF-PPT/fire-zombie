import type { EnemyKind, RewardId } from '../types/game';
import type {
  BossConfig,
  EnemySpawnItem,
  GateRowEncounter,
  GateSpecConfig,
  RunwayEncounter,
} from './sectors';

export const GAUNTLET_RUNWAY_LENGTH = 1300;

const BOSS_POOL: readonly BossConfig[] = [
  { id: 'warden_01', name: 'WARDEN-01《赤焰魔像王》·极', maxHp: 24000, maxPhases: 2, enrageAfterSec: 30 },
  { id: 'hydra_02', name: 'HYDRA-02《双生魔龙》·极', maxHp: 27000, maxPhases: 2, enrageAfterSec: 34 },
  { id: 'omega_zero', name: 'OMEGA-ZERO《深渊魔王》·极', maxHp: 70000, maxPhases: 3, pylonHp: 3500, enrageAfterSec: 42 },
];

const REWARD_POOL: readonly RewardId[] = ['scatter', 'rail', 'plasma', 'cryo', 'blades', 'pulse'];

type RowKind = 'warmup' | 'lethal' | 'dilemma' | 'mandatory' | 'mult' | 'lock' | 'soloMutable' | 'soloNegative';
type SetPiece = 'pack' | 'vaults' | 'barrels' | 'lens';

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds the sector-4 runway from a seed: rows come from per-act decks (so every run gets the
 * same mix of decisions, only order/sides/values change) with set pieces filling each gap.
 */
export function generateGauntlet(seed: number): { boss: BossConfig; encounters: RunwayEncounter[] } {
  const rand = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const shuffle = <T>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  };
  const sideSign = (): 1 | -1 => (rand() < 0.5 ? -1 : 1);
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  const L = GAUNTLET_RUNWAY_LENGTH;
  const out: RunwayEncounter[] = [];

  const paired = (d: number, good: GateSpecConfig, bad: GateSpecConfig, siphonOnGood = false): void => {
    const goodLeft = rand() < 0.5;
    const enc: GateRowEncounter = {
      type: 'gate_row',
      crossDist: d,
      layout: 'paired',
      left: goodLeft ? good : bad,
      right: goodLeft ? bad : good,
      ...(siphonOnGood ? { tetheredSiphon: { side: goodLeft ? 'left' : 'right', zAhead: 5.5 } } : {}),
    };
    out.push(enc);
  };

  const mutableSub = (start: number, max: number, dps: number, step = 2): GateSpecConfig => ({
    op: 'sub',
    value: start,
    mutable: true,
    damagePerStep: dps,
    stepDelta: step,
    maxValue: max,
  });

  const emitRow = (kind: RowKind, d: number, opening: boolean): void => {
    const t = d / L;
    // Opening rows punish instead of kill: the squad is still single digits there.
    const lethalCost = opening ? Math.round(5 + t * 20) : Math.round(18 + t * 18);
    switch (kind) {
      case 'warmup':
        paired(d, { op: 'add', value: 2, mutable: true, damagePerStep: 10, stepDelta: 2, maxValue: 10 }, { op: 'add', value: 5, mutable: false });
        break;
      case 'lethal': {
        const good: GateSpecConfig =
          rand() < 0.35
            ? { op: 'add', value: Math.round(4 + t * 10), mutable: true, damagePerStep: Math.round(14 + t * 14), stepDelta: 2, maxValue: Math.round(12 + t * 14) }
            : { op: 'add', value: Math.round(5 + t * 14), mutable: false };
        paired(d, good, { op: 'sub', value: lethalCost, mutable: false });
        break;
      }
      case 'dilemma': {
        const a = Math.round(8 + t * 10);
        const step = t > 0.5 ? 3 : 2;
        paired(d, mutableSub(Math.round(2 + t * 8), Math.round(a * 1.9), Math.round(14 + t * 14), step), { op: 'add', value: a, mutable: false });
        break;
      }
      case 'mandatory':
        paired(
          d,
          mutableSub(Math.round(2 + t * 8), Math.round(10 + t * 6), Math.round(14 + t * 10)),
          { op: 'sub', value: opening ? lethalCost : Math.round(18 + t * 14), mutable: false },
          t > 0.3 && rand() < 0.4,
        );
        break;
      case 'mult':
        paired(d, { op: 'mul', value: 2, mutable: false }, { op: 'add', value: Math.round(5 + t * 10), mutable: false });
        break;
      case 'lock':
        paired(d, { op: 'div', value: 2, mutable: true, lockHp: Math.round(80 + t * 50) }, { op: 'div', value: 2, mutable: false });
        break;
      case 'soloMutable':
        out.push({
          type: 'gate_row',
          crossDist: d,
          layout: 'standalone',
          single: { x: 2.6 * sideSign(), halfWidth: 1.9, ...mutableSub(Math.round(3 + t * 4), Math.round(8 + t * 6), Math.round(16 + t * 10)) },
        });
        break;
      case 'soloNegative':
        out.push({
          type: 'gate_row',
          crossDist: d,
          layout: 'standalone',
          single: { x: 2.6 * sideSign(), halfWidth: 1.9, op: 'sub', value: Math.round(6 + t * 8), mutable: false },
        });
        break;
    }
  };

  const packKinds = (t: number): EnemyKind[] =>
    t < 0.2
      ? ['crawler', 'crawler', 'dasher', 'bomber', 'burrower', 'stalker']
      : t < 0.45
        ? ['crawler', 'dasher', 'mitosis', 'bomber', 'stalker', 'phalanx', 'burrower', 'glacier', 'beholder']
        : [
            'crawler',
            'dasher',
            'mitosis',
            'bastion',
            'bomber',
            'phalanx',
            'stalker',
            'brood',
            'howler',
            'glacier',
            'beholder',
            'burrower',
            'necromancer',
          ];

  const emitPack = (d: number, extra = 0): void => {
    const t = d / L;
    const n = 2 + Math.floor(t * 5) + (rand() < 0.4 ? 1 : 0) + extra;
    const kinds = packKinds(t);
    const units: EnemySpawnItem[] = [];
    let bastions = 0;
    for (let i = 0; i < n; i++) {
      let kind = pick(kinds);
      if ((kind === 'bastion' || kind === 'brood' || kind === 'glacier') && ++bastions > 2) kind = 'crawler';
      units.push({ kind, x: round1(rand() * 6.6 - 3.3), dz: round1(i * 1.6 + rand() * 1.2) });
    }
    // Add deterministic high-density crawler swarm escorts via isolated sub-PRNG so gate PRNG stays rock-solid
    const subRand = mulberry32((Math.imul(d, 0x9e3779b1) ^ (seed >>> 0)) >>> 0);
    const swarmExtra = 6 + Math.floor(t * 8);
    for (let j = 0; j < swarmExtra; j++) {
      units.push({
        kind: 'crawler',
        x: round1(subRand() * 6.6 - 3.3),
        dz: round1(0.6 + j * 0.85 + subRand() * 0.7),
      });
    }
    out.push({ type: 'enemies', crossDist: d, units });
  };

  const rewards = shuffle([...REWARD_POOL]);
  let rewardCursor = 0;
  const nextReward = (): RewardId => rewards[rewardCursor++ % rewards.length]!;

  const emitSetPiece = (piece: SetPiece, d: number): void => {
    const t = d / L;
    switch (piece) {
      case 'pack':
        emitPack(d);
        break;
      case 'vaults': {
        const hp = Math.round(150 + t * 120);
        out.push({ type: 'vault', crossDist: d, x: -2.4, hp, reward: nextReward() });
        out.push({ type: 'vault', crossDist: d + 2, x: 2.4, hp: hp - 10, reward: nextReward() });
        break;
      }
      case 'barrels': {
        const dir = sideSign();
        out.push({
          type: 'barrels',
          crossDist: d,
          placements: [-3.3, -1.1, 1.1, 3.3].map((x, i) => ({ x: x * dir, dz: i * 3.5 })),
        });
        emitPack(d + 2, 1);
        break;
      }
      case 'lens':
        out.push({ type: 'lens', crossDist: d, x: 2.4 * sideSign(), driftAmp: 0.5, driftFreq: 1.0 });
        break;
    }
  };

  // Act decks keep the decision mix fixed per run; multipliers stay early where they are fair.
  const rows: RowKind[] = [
    'warmup',
    ...shuffle<RowKind>(['mult', 'lethal', 'mandatory', 'soloMutable']),
    ...shuffle<RowKind>(['lethal', 'dilemma', 'mandatory', 'lock', 'soloNegative']),
    ...shuffle<RowKind>(['lethal', 'dilemma', 'dilemma', 'mandatory', 'lethal']),
  ];
  const pieces: SetPiece[][] = rows.map((_, i) =>
    i === 2 || i === 6 || i === 10 ? ['vaults', 'pack'] : i % 3 === 0 && i > 0 ? ['barrels'] : i % 4 === 3 ? ['lens', 'pack'] : ['pack'],
  );

  paired(36, { op: 'add', value: 6, mutable: false }, { op: 'add', value: 3, mutable: false });
  let prev = 36;
  const gapStarts: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const gap = 64 + Math.floor(rand() * 24);
    const d = Math.min(L - 40, prev + gap);
    gapStarts.push(prev);
    const set = pieces[i]!;
    set.forEach((p, k) => emitSetPiece(p, Math.round(prev + gap * (set.length === 1 ? 0.55 : 0.3 + k * 0.38))));
    emitRow(rows[i]!, d, i < 5);
    prev = d;
  }

  // Inject 4 tactical Mag-Lev Jump Pads across Acts 1-4 via isolated sub-PRNG (preserves exact gate/vault PRNG & avoids x=0 AFK lane!)
  // Launching at prev + 16 lands ~21m ahead right into the mid-gap monster pack, well clear of the next gate row!
  const jumpRand = mulberry32(((seed >>> 0) ^ 0x7f4a7c15) >>> 0);
  const jumpSlots = [1, 4, 8, 11];
  for (let k = 0; k < jumpSlots.length; k++) {
    const idx = jumpSlots[k]!;
    const base = gapStarts[idx];
    if (base !== undefined && base + 42 < L - 40) {
      const side = jumpRand() < 0.5 ? -1 : 1;
      const laneX = round1((2.25 + jumpRand() * 0.65) * side);
      out.push({ type: 'jump_pad', crossDist: base + 16, x: laneX });
    }
  }

  out.sort((a, b) => a.crossDist - b.crossDist);
  return { boss: BOSS_POOL[(seed >>> 0) % BOSS_POOL.length]!, encounters: out };
}
