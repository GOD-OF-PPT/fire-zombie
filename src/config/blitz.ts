import type { BossId, FusionId, MutatorId, RewardId } from '../types/game';
import type { BossConfig, RunwayEncounter, SectorScriptConfig } from './sectors';

export interface FusionMeta {
  readonly id: FusionId;
  readonly name: string;
  readonly short: string;
  readonly glyph: string;
  readonly color: string;
  readonly hex: number;
  readonly recipeText: string;
  readonly desc: string;
}

export const FUSIONS: Readonly<Record<FusionId, FusionMeta>> = {
  cryo_singularity: {
    id: 'cryo_singularity',
    name: '极寒黑洞炮',
    short: '黑洞超武',
    glyph: '🌌',
    color: '#b98cff',
    hex: 0xb98cff,
    recipeText: '新星迫击 + 绝对零度（总等级 ≥3）',
    desc: '迫击落点生成紫青引力奇点，强行吸聚两车道怪群并持续冰脆轰击',
  },
  prism_ricochet_web: {
    id: 'prism_ricochet_web',
    name: '棱镜折射电网',
    short: '折射电网',
    glyph: '🕸',
    color: '#7dff6b',
    hex: 0x7dff6b,
    recipeText: '折射散弹 + 超导贯穿（总等级 ≥3）',
    desc: '散弹与轨炮命中后在怪群与电容桶间自动折跃弹射 3 次织成激光蛛网',
  },
  seeker_sword_array: {
    id: 'seeker_sword_array',
    name: '自律浮游剑阵',
    short: '浮游剑阵',
    glyph: '⚔',
    color: '#3ef3ff',
    hex: 0x3ef3ff,
    recipeText: '环轨护卫刃 + 棱光脉冲 Lv.2+',
    desc: '环轨飞刃解放为自律御剑无人机，自动前出猎杀噬能灵、金框门与首领部件',
  },
};

export interface MutatorMeta {
  readonly id: MutatorId;
  readonly name: string;
  readonly glyph: string;
  readonly color: string;
  readonly bonusPct: number;
  readonly desc: string;
}

export const MUTATORS: readonly MutatorMeta[] = [
  {
    id: 'mirror_twin',
    name: '镜像双子',
    glyph: '🪞',
    color: '#62f4ff',
    bonusPct: 25,
    desc: '左右对称分出全息双子编队同屏齐射，反向联动走位，总火力跃升',
  },
  {
    id: 'glass_cannon',
    name: '玻璃大炮',
    glyph: '💥',
    color: '#ff5ce0',
    bonusPct: 30,
    desc: '全军伤害 ×2.4、暴击率 +25%，但冲撞与负面门战损翻倍',
  },
  {
    id: 'barrel_carnival',
    name: '连锁狂欢',
    glyph: '🛢',
    color: '#ff9a3c',
    bonusPct: 20,
    desc: '尸潮中额外部署高危电容桶，爆炸与连锁半径提升 +35%',
  },
];

const BLITZ_BOSSES: readonly BossConfig[] = [
  { id: 'warden_01', name: 'WARDEN-01《赤焰魔像王》·闪击', maxHp: 18500, maxPhases: 2, enrageAfterSec: 24 },
  { id: 'hydra_02', name: 'HYDRA-02《双生魔龙》·闪击', maxHp: 21500, maxPhases: 2, enrageAfterSec: 26 },
  { id: 'omega_zero', name: 'OMEGA-ZERO《深渊魔王》·闪击', maxHp: 38000, maxPhases: 3, pylonHp: 2100, enrageAfterSec: 32 },
];

const FUSION_STARTER_PAIRS: ReadonlyArray<[RewardId, RewardId]> = [
  ['plasma', 'cryo'],
  ['scatter', 'rail'],
  ['blades', 'plasma'],
];

/**
 * Generates the 90-second Competition Showcase ("锦标赛闪击模式") runway:
 * 560m @ 15.8 m/s (~35.4s ultra-dense action runway + ~25s multi-part Boss & Doom-Orb Showdown),
 * packing Superweapon Fusion Vaults, 45° Reflector Mirrors, Mag-Lev Jump Pad, and Dual-Lane Bounty Contract!
 */
export function generateBlitzScript(seed: number): SectorScriptConfig {
  const s = (seed >>> 0) || 1;
  const boss = BLITZ_BOSSES[s % BLITZ_BOSSES.length]!;
  const [r1, r2] = FUSION_STARTER_PAIRS[s % FUSION_STARTER_PAIRS.length]!;
  const flip = (s & 1) === 1 ? -1 : 1;

  const encounters: RunwayEncounter[] = [
    // 1. Immediate Squad Expansion + Early Fusion Pair (0..95m, t = 0..6s)
    {
      type: 'gate_row',
      crossDist: 28,
      layout: 'paired',
      left: { op: 'mul', value: 2, mutable: false },
      right: { op: 'add', value: 14, mutable: false },
    },
    {
      type: 'vault',
      crossDist: 62,
      x: -2.3 * flip,
      hp: 65,
      reward: r1,
    },
    {
      type: 'vault',
      crossDist: 68,
      x: 2.3 * flip,
      hp: 65,
      reward: r2,
    },
    {
      type: 'enemies',
      crossDist: 92,
      units: [
        { kind: 'crawler', x: -3.2, dz: 0 },
        { kind: 'crawler', x: -2.0, dz: 0.8 },
        { kind: 'crawler', x: -0.8, dz: 1.5 },
        { kind: 'crawler', x: 0.8, dz: 1.5 },
        { kind: 'crawler', x: 2.0, dz: 0.8 },
        { kind: 'crawler', x: 3.2, dz: 0 },
        { kind: 'mitosis', x: -1.6, dz: 2.8 },
        { kind: 'mitosis', x: 1.6, dz: 2.8 },
        { kind: 'crawler', x: -2.6, dz: 4.0 },
        { kind: 'crawler', x: 0.0, dz: 4.2 },
        { kind: 'crawler', x: 2.6, dz: 4.0 },
      ],
    },

    // 2. 45° Angled Reflector Mirror Bank-Shot + Barrel Chain behind Twin Bastions (130..195m, t = 8..12s)
    {
      type: 'reflector',
      crossDist: 136,
      x: -3.4 * flip,
      lean: (1 * flip) as 1 | -1,
    },
    {
      type: 'enemies',
      crossDist: 148,
      units: [
        { kind: 'bastion', x: -1.4, dz: 0 },
        { kind: 'bastion', x: 1.4, dz: 0 },
        { kind: 'crawler', x: -3.0, dz: 1.5 },
        { kind: 'crawler', x: 0.0, dz: 2.0 },
        { kind: 'crawler', x: 3.0, dz: 1.5 },
      ],
    },
    {
      type: 'barrels',
      crossDist: 158,
      placements: [
        { x: 2.4 * flip, dz: 0 },
        { x: 0.0, dz: 3.2 },
        { x: -2.4 * flip, dz: 6.4 },
      ],
    },
    {
      type: 'gate_row',
      crossDist: 176,
      layout: 'paired',
      left: { op: 'sub', value: 4, mutable: true, damagePerStep: 14, stepDelta: 3, maxValue: 22 },
      right: { op: 'add', value: 12, mutable: false },
      tetheredSiphon: { side: 'left', zAhead: 5.5 },
    },

    // 3. Second Upgrade Vault Pair -> Guaranteed Lv.2+ Superweapon Fusion Unlock! (215..250m, t = 14..16s)
    {
      type: 'vault',
      crossDist: 218,
      x: -2.4 * flip,
      hp: 95,
      reward: r1,
    },
    {
      type: 'vault',
      crossDist: 226,
      x: 2.4 * flip,
      hp: 95,
      reward: 'blades',
    },

    // 4. Mag-Lev Jump Pad flying OVER full-width Division Laser Gate into 16-Monster Sky-Slam! (268..320m, t = 17..20s)
    {
      type: 'jump_pad',
      crossDist: 272,
      x: -2.2 * flip,
    },
    {
      type: 'gate_row',
      crossDist: 282,
      layout: 'paired',
      left: { op: 'div', value: 2, mutable: false },
      right: { op: 'add', value: 8, mutable: true, damagePerStep: 18, stepDelta: 2, maxValue: 18 },
    },
    {
      type: 'enemies',
      crossDist: 294,
      units: [
        { kind: 'crawler', x: -3.3, dz: 0 },
        { kind: 'crawler', x: -2.2, dz: 0.7 },
        { kind: 'crawler', x: -1.1, dz: 1.4 },
        { kind: 'crawler', x: 0.0, dz: 1.8 },
        { kind: 'crawler', x: 1.1, dz: 1.4 },
        { kind: 'crawler', x: 2.2, dz: 0.7 },
        { kind: 'crawler', x: 3.3, dz: 0 },
        { kind: 'mitosis', x: -1.8, dz: 2.8 },
        { kind: 'mitosis', x: 1.8, dz: 2.8 },
        { kind: 'dasher', x: -2.8, dz: 4.2 },
        { kind: 'dasher', x: 2.8, dz: 4.2 },
        { kind: 'crawler', x: -1.4, dz: 5.0 },
        { kind: 'crawler', x: 0.0, dz: 5.2 },
        { kind: 'crawler', x: 1.4, dz: 5.0 },
      ],
    },

    // 5. Dual-Lane Deathmatch Contract Corridor: Left = Bounty Gold Juggernaut (Jackpot!), Right = Safe Supply! (350..435m)
    {
      type: 'contract_lane',
      crossDist: 355,
      length: 68,
      bountySide: flip > 0 ? 'left' : 'right',
      bountyHp: 260,
    },
    {
      type: 'gate_row',
      crossDist: 416,
      layout: 'paired',
      left: flip > 0 ? { op: 'add', value: 18, mutable: false } : { op: 'add', value: 10, mutable: false },
      right: flip > 0 ? { op: 'add', value: 10, mutable: false } : { op: 'add', value: 18, mutable: false },
    },

    // 6. Climax Golden Prism Lens + Huge Final Horde before Multi-Part Destructible Boss! (455..525m)
    {
      type: 'lens',
      crossDist: 458,
      x: 0.0,
      driftAmp: 1.8,
      driftFreq: 1.3,
    },
    {
      type: 'vault',
      crossDist: 468,
      x: 2.5 * flip,
      hp: 110,
      reward: r2,
    },
    {
      type: 'barrels',
      crossDist: 492,
      placements: [
        { x: -2.4, dz: 0 },
        { x: 0.0, dz: 3.2 },
        { x: 2.4, dz: 6.4 },
      ],
    },
    {
      type: 'enemies',
      crossDist: 496,
      units: [
        { kind: 'bastion', x: -2.2, dz: 0.8 },
        { kind: 'bastion', x: 2.2, dz: 0.8 },
        { kind: 'mitosis', x: 0.0, dz: 1.8 },
        { kind: 'crawler', x: -3.3, dz: 2.4 },
        { kind: 'crawler', x: -1.1, dz: 2.8 },
        { kind: 'crawler', x: 1.1, dz: 2.8 },
        { kind: 'crawler', x: 3.3, dz: 2.4 },
        { kind: 'dasher', x: -2.8, dz: 4.6 },
        { kind: 'dasher', x: 2.8, dz: 4.6 },
        { kind: 'crawler', x: -1.8, dz: 5.4 },
        { kind: 'crawler', x: 0.0, dz: 5.8 },
        { kind: 'crawler', x: 1.8, dz: 5.4 },
      ],
    },
    {
      type: 'gate_row',
      crossDist: 524,
      layout: 'paired',
      left: { op: 'add', value: 15, mutable: false },
      right: { op: 'sub', value: 6, mutable: true, damagePerStep: 20, stepDelta: 4, maxValue: 26 },
    },
  ];

  return {
    id: 4 as const,
    name: 'Tournament Blitz',
    subtitle: '锦标赛闪击',
    scrollSpeed: 15.8,
    runwayLength: 560,
    startSquad: 14,
    boss: boss as BossConfig & { readonly id: BossId },
    encounters,
  };
}
