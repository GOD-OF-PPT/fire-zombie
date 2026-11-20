import type { BossId, DualSynergyId, FusionId, MutatorId, OverlimitResonanceId, RewardId, WeaponId } from '../types/game';
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


export interface DualSynergyMeta {
  readonly id: DualSynergyId;
  readonly name: string;
  readonly short: string;
  readonly glyph: string;
  readonly color: string;
  readonly hex: number;
  readonly recipeText: string;
  readonly desc: string;
}

export const DUAL_SYNERGIES: Readonly<Record<DualSynergyId, DualSynergyMeta>> = {
  cluster_shrapnel: {
    id: 'cluster_shrapnel',
    name: '集束榴霰弹',
    short: '集束榴霰',
    glyph: '💥',
    color: '#ffae42',
    hex: 0xffae42,
    recipeText: '新星迫击 + 折射散弹 / 棱光脉冲（总等级 ≥3）',
    desc: '迫击爆炸向四周迸射 4 枚高穿集束破片，大范围撕裂周围怪群',
  },
  frost_shatter_lance: {
    id: 'frost_shatter_lance',
    name: '极寒碎冰枪',
    short: '极寒碎冰',
    glyph: '❄',
    color: '#7be8ff',
    hex: 0x7be8ff,
    recipeText: '绝对零度 + 超导贯穿 / 折射散弹 / 棱光脉冲（总等级 ≥3）',
    desc: '命中冰缓目标触发碎冰爆破（额外 +42% 碎裂伤害并扩散寒霜）',
  },
  thermo_rail_lance: {
    id: 'thermo_rail_lance',
    name: '熔核穿甲炮',
    short: '熔核穿甲',
    glyph: '🔥',
    color: '#ff784f',
    hex: 0xff784f,
    recipeText: '超导贯穿 + 新星迫击（总等级 ≥3）',
    desc: '超导轨炮每次贯穿敌人均引爆 2.2m 熔核热浪灼烧邻近目标',
  },
  overcharge_rail_grid: {
    id: 'overcharge_rail_grid',
    name: '超导磁轨网',
    short: '超导磁轨',
    glyph: '⚡',
    color: '#c69cff',
    hex: 0xc69cff,
    recipeText: '超导贯穿 + 棱光脉冲（总等级 ≥3）',
    desc: '脉冲电容过载磁轨：全弹幕穿透 +1，轨炮命中额外跃迁电弧',
  },
  prism_storm_barrage: {
    id: 'prism_storm_barrage',
    name: '棱光弹幕风暴',
    short: '弹幕风暴',
    glyph: '🌪',
    color: '#6dffb8',
    hex: 0x6dffb8,
    recipeText: '折射散弹 + 棱光脉冲（总等级 ≥3）',
    desc: '高频散射谐振：主武器射速 +16%，外侧散射弹道向目标智能聚拢',
  },
};

export interface OverlimitResonanceMeta {
  readonly id: OverlimitResonanceId;
  readonly name: string;
  readonly short: string;
  readonly glyph: string;
  readonly color: string;
  readonly hex: number;
  readonly recipeText: string;
  readonly desc: string;
}

export const OVERLIMIT_RESONANCES: Readonly<Record<OverlimitResonanceId, OverlimitResonanceMeta>> = {
  prism_arc_lattice: {
    id: 'prism_arc_lattice',
    name: '折镜链式电弧',
    short: '折镜电弧',
    glyph: '⚡',
    color: '#7dff6b',
    hex: 0x7dff6b,
    recipeText: '棱光脉冲 + 超导贯穿（总等级 ≥5 或超载期间）',
    desc: '弹丸经 45° 折镜或聚能透镜折射时裂变为超导电弧，自动串联 4 名敌军并引爆沿途电容桶与电容塔',
  },
  gravity_lens_well: {
    id: 'gravity_lens_well',
    name: '引力聚怪透镜',
    short: '引力透镜',
    glyph: '🌀',
    color: '#b98cff',
    hex: 0xb98cff,
    recipeText: '折射散弹 + 新星迫击（总等级 ≥5 或超载期间）',
    desc: '穿过透镜/折镜及高频齐射在前方坍缩微缩引力井，将双侧怪群强行拽入迫击中心集火',
  },
  cryo_thermo_shatter: {
    id: 'cryo_thermo_shatter',
    name: '低温碎甲爆燃',
    short: '碎甲爆燃',
    glyph: '❄🔥',
    color: '#ff9a3c',
    hex: 0xff9a3c,
    recipeText: '绝对零度 + 新星迫击（总等级 ≥5 或超载期间）',
    desc: '交替热冷齐射命中冰缓或破甲目标时引发 2.6m 低温爆燃（+55% 范围碎裂伤害并削剥护盾 35%）',
  },
  photon_prism_fan: {
    id: 'photon_prism_fan',
    name: '光子棱扇矩阵',
    short: '光子棱扇',
    glyph: '🔆',
    color: '#6dffb8',
    hex: 0x6dffb8,
    recipeText: '棱光脉冲 + 折射散弹（总等级 ≥5 或超载期间）',
    desc: '高频光子谐振折射：每第 5 击向两侧迸发棱扇电弧，并对跑道过载电容塔提供高倍充能',
  },
  plasma_overcharge_mortar: {
    id: 'plasma_overcharge_mortar',
    name: '超频电磁迫击',
    short: '电磁迫击',
    glyph: '☄',
    color: '#ffb84d',
    hex: 0xffb84d,
    recipeText: '棱光脉冲 + 新星迫击（总等级 ≥5 或超载期间）',
    desc: '脉冲磁化引信使迫击炮落点释放 3.1m 穿盾电磁震波，瞬间满充邻近过载电容塔',
  },
  zero_kelvin_needle: {
    id: 'zero_kelvin_needle',
    name: '极寒零度冰针',
    short: '零度冰针',
    glyph: '💠',
    color: '#7be8ff',
    hex: 0x7be8ff,
    recipeText: '棱光脉冲 + 绝对零度（总等级 ≥5 或超载期间）',
    desc: '命中冰缓目标或击杀敌人时向前方迸射 3 枚绝对零度穿刺冰矛，冻结纵深防线',
  },
  hyper_rail_flechette: {
    id: 'hyper_rail_flechette',
    name: '超导磁轨霰弹',
    short: '磁轨霰弹',
    glyph: '⟁',
    color: '#d49cff',
    hex: 0xd49cff,
    recipeText: '折射散弹 + 超导贯穿（总等级 ≥5 或超载期间）',
    desc: '霰弹与磁轨弹命中后在横向怪群之间拉起超导激光绊线，无视护盾切割同排目标',
  },
  hailstorm_mirror_shatter: {
    id: 'hailstorm_mirror_shatter',
    name: '冰雹碎镜风暴',
    short: '碎镜冰暴',
    glyph: '🌨',
    color: '#9fe6ff',
    hex: 0x9fe6ff,
    recipeText: '折射散弹 + 绝对零度（总等级 ≥5 或超载期间）',
    desc: '宽幅寒霜弹雨周期引爆 3.0m 碎镜冰雹风暴，大范围减速撕裂突击种与尸潮',
  },
  magma_lance_cataclysm: {
    id: 'magma_lance_cataclysm',
    name: '熔核穿星巨枪',
    short: '熔核巨枪',
    glyph: '🌋',
    color: '#ff6e4a',
    hex: 0xff6e4a,
    recipeText: '超导贯穿 + 新星迫击（总等级 ≥5 或超载期间）',
    desc: '超导穿甲弹沿纵向轨迹引爆 5.2m 熔岩火柱，并直接瞬爆沿途高能电容桶',
  },
  glacial_rail_skewer: {
    id: 'glacial_rail_skewer',
    name: '极寒穿甲冰矛',
    short: '穿甲冰矛',
    glyph: '🗡',
    color: '#62f4ff',
    hex: 0x62f4ff,
    recipeText: '超导贯穿 + 绝对零度（总等级 ≥5 或超载期间）',
    desc: '超导冰矛深度冻结路径目标 2.2s，并对带盾精英、巨像与首领部件追加 +65% 碎甲斩杀',
  },
};

export function matchOverlimitResonance(a: WeaponId, b: WeaponId): OverlimitResonanceId {
  const pair = new Set<WeaponId>([a, b]);
  if (pair.has('pulse') && pair.has('rail')) return 'prism_arc_lattice';
  if (pair.has('scatter') && pair.has('plasma')) return 'gravity_lens_well';
  if (pair.has('cryo') && pair.has('plasma')) return 'cryo_thermo_shatter';
  if (pair.has('pulse') && pair.has('scatter')) return 'photon_prism_fan';
  if (pair.has('pulse') && pair.has('plasma')) return 'plasma_overcharge_mortar';
  if (pair.has('pulse') && pair.has('cryo')) return 'zero_kelvin_needle';
  if (pair.has('scatter') && pair.has('rail')) return 'hyper_rail_flechette';
  if (pair.has('scatter') && pair.has('cryo')) return 'hailstorm_mirror_shatter';
  if (pair.has('rail') && pair.has('plasma')) return 'magma_lance_cataclysm';
  if (pair.has('rail') && pair.has('cryo')) return 'glacial_rail_skewer';
  return 'prism_arc_lattice';
}

export function matchDualSynergyPair(a: WeaponId, b: WeaponId): DualSynergyId | null {
  const pair = new Set<WeaponId>([a, b]);
  if (pair.size < 2) return null;
  if (pair.has('plasma') && pair.has('cryo')) return null; // Covered by Major Fusion cryo_singularity
  if (pair.has('scatter') && pair.has('rail')) return null; // Covered by Major Fusion prism_ricochet_web
  if (pair.has('plasma') && (pair.has('scatter') || pair.has('pulse'))) return 'cluster_shrapnel';
  if (pair.has('cryo') && (pair.has('rail') || pair.has('scatter') || pair.has('pulse'))) return 'frost_shatter_lance';
  if (pair.has('rail') && pair.has('plasma')) return 'thermo_rail_lance';
  if (pair.has('rail') && pair.has('pulse')) return 'overcharge_rail_grid';
  if (pair.has('scatter') && pair.has('pulse')) return 'prism_storm_barrage';
  return null;
}

export function describeVaultRelation(
  reward: RewardId,
  activeLoadout: readonly WeaponId[],
  arsenal: Readonly<Record<WeaponId, number>> | undefined,
  bladesCount: number,
  activeFusions: readonly FusionId[] = [],
  pendingSwap: WeaponId | null = null,
): { tag: string; color: string } {
  const ars = arsenal ?? { pulse: 1, scatter: 0, rail: 0, plasma: 0, cryo: 0 };
  void activeFusions;
  if (reward === 'blades') {
    if ((ars.pulse ?? 1) >= 2 && bladesCount >= 1) {
      return { tag: '★ 合成浮游剑阵', color: '#ffd84a' };
    }
    return { tag: `✦ 护卫飞刃 +6兵`, color: '#ffd84a' };
  }
  if (reward === 'pulse' && bladesCount >= 2 && (ars.pulse ?? 1) < 2) {
    return { tag: '★ 合成浮游剑阵', color: '#ffd84a' };
  }
  const inLoadout = activeLoadout.includes(reward);
  if (inLoadout) {
    const curLv = ars[reward] ?? 0;
    if (activeLoadout.length === 2) {
      const other = activeLoadout[0] === reward ? activeLoadout[1]! : activeLoadout[0]!;
      const sumNext = Math.min(3, curLv + 1) + (ars[other] ?? 1);
      if (curLv + (ars[other] ?? 1) < 3 && sumNext >= 3) {
        if ((reward === 'plasma' && other === 'cryo') || (reward === 'cryo' && other === 'plasma')) {
          return { tag: '★ 激活极寒黑洞', color: '#ffd84a' };
        }
        if ((reward === 'scatter' && other === 'rail') || (reward === 'rail' && other === 'scatter')) {
          return { tag: '★ 激活折射电网', color: '#ffd84a' };
        }
        const syn = matchDualSynergyPair(reward, other);
        if (syn) return { tag: `✦ 激活${DUAL_SYNERGIES[syn].short}`, color: '#62f4ff' };
      }
    }
    return { tag: curLv >= 3 ? '✦ 超限进化叠层' : `⬆ 主武升至 Lv.${curLv + 1}`, color: '#19f5a8' };
  }
  if (activeLoadout.length === 0) {
    return { tag: '🎯 锁定 1 号主武', color: '#62f4ff' };
  }
  if (activeLoadout.length === 1) {
    const w0 = activeLoadout[0]!;
    if ((w0 === 'plasma' && reward === 'cryo') || (w0 === 'cryo' && reward === 'plasma')) {
      return { tag: '★ 黑洞超武组件', color: '#ffd84a' };
    }
    if ((w0 === 'scatter' && reward === 'rail') || (w0 === 'rail' && reward === 'scatter')) {
      return { tag: '★ 电网超武组件', color: '#ffd84a' };
    }
    const syn = matchDualSynergyPair(w0, reward);
    if (syn) {
      return { tag: `✦ 配对${DUAL_SYNERGIES[syn].short}`, color: '#62f4ff' };
    }
    return { tag: '🎯 锁定 2 号主武', color: '#62f4ff' };
  }
  if (pendingSwap === reward) {
    return { tag: '🔄 再破切换构筑!', color: '#e28cff' };
  }
  return { tag: '🔧 异系拆解+储8', color: '#ffae42' };
}

export interface MutatorMeta {
  readonly id: MutatorId;
  readonly name: string;
  readonly glyph: string;
  readonly color: string;
  readonly bonusPct: number;
  readonly category: 'style' | 'challenge';
  readonly tagLabel: string;
  readonly desc: string;
}

export const MUTATORS: readonly MutatorMeta[] = [
  {
    id: 'mirror_twin',
    name: '镜像双子',
    glyph: '🪞',
    color: '#62f4ff',
    bonusPct: 15,
    category: 'style',
    tagLabel: '风格',
    desc: '【玩法风格】左右对称分出镜像副编队（总火力 ×1.16），但镜像侧同样承受危险区与冲撞 60% 战损',
  },
  {
    id: 'glass_cannon',
    name: '玻璃大炮',
    glyph: '💥',
    color: '#ff5ce0',
    bonusPct: 30,
    category: 'challenge',
    tagLabel: '挑战',
    desc: '【挑战词缀】全军伤害 ×2.0、暴击率 +25%，但冲撞与负面门战损提升至 ×2.2',
  },
  {
    id: 'barrel_carnival',
    name: '连锁狂欢',
    glyph: '🛢',
    color: '#ff9a3c',
    bonusPct: 20,
    category: 'challenge',
    tagLabel: '挑战',
    desc: '【挑战词缀】额外部署高危电容桶且爆炸半径 +35%，但贴脸引爆会灼伤前排小队',
  },
];

const BLITZ_BOSSES: readonly BossConfig[] = [
  { id: 'warden_01', name: 'WARDEN-01《赤焰魔像王》·闪击', maxHp: 21000, maxPhases: 2, enrageAfterSec: 26 },
  { id: 'hydra_02', name: 'HYDRA-02《双生魔龙》·闪击', maxHp: 24000, maxPhases: 2, enrageAfterSec: 28 },
  { id: 'omega_zero', name: 'OMEGA-ZERO《深渊魔王》·闪击', maxHp: 39000, maxPhases: 3, pylonHp: 2400, enrageAfterSec: 34 },
];

const FUSION_STARTER_PAIRS: ReadonlyArray<[RewardId, RewardId, RewardId]> = [
  ['plasma', 'cryo', 'scatter'],
  ['scatter', 'rail', 'plasma'],
  ['blades', 'blades', 'cryo'],
];

/**
 * Generates the 6-Act Blitz Showcase ("极速闪击模式"):
 * 745m @ 13.8 m/s (~54s structured 5-act runway + ~14-20s Boss Climax = ~68-74s total!):
 * Act 1 (0..8s):   Rapid Squad Expansion
 * Act 2 (9..19s):  Build Route Selection (contested Weapon Vault vs Gold Gate / Off-Spec Temptation)
 * Act 3 (20..27s): Mid-Run Elite & Division Pressure (45° Reflector + Mag-Lev Jump Pad)
 * Act 4 (28..34s): Core Fusion Completion Choice (Left = +26 Troops vs Right = Fusion Lv.3 Key!)
 * Act 5 (35..53s): Rewarding Full-Screen Catharsis (Deathmatch Contract + Prism Lens + Horde Sweep)
 * Act 6 (54s+):    Multi-Part Boss Climax + Early Doom-Orb Deflection Test
 */
export function generateBlitzScript(seed: number): SectorScriptConfig {
  const s = (seed >>> 0) || 1;
  const boss = BLITZ_BOSSES[s % BLITZ_BOSSES.length]!;
  const [r1, r2, offSpec] = FUSION_STARTER_PAIRS[s % FUSION_STARTER_PAIRS.length]!;
  const flip = (s & 1) === 1 ? -1 : 1;

  const drill = { mirrorX: -2.65 * flip, mirror: 232, guard: 238.8, vault: 296, gate: 302, pad: 334 };
  const encounters: RunwayEncounter[] = [
    // ACT 1: Rapid Squad Expansion (0..110m, t = 0..8s)
    {
      type: 'gate_row',
      crossDist: 30,
      layout: 'paired',
      left: { op: 'mul', value: 2, mutable: false },
      right: { op: 'add', value: 14, mutable: false },
    },
    {
      type: 'enemies',
      crossDist: 78,
      units: [
        { kind: 'crawler', x: -3.1, dz: 0 },
        { kind: 'crawler', x: -1.9, dz: 0.7 },
        { kind: 'crawler', x: -0.7, dz: 1.3 },
        { kind: 'crawler', x: 0.7, dz: 1.3 },
        { kind: 'crawler', x: 1.9, dz: 0.7 },
        { kind: 'crawler', x: 3.1, dz: 0 },
        { kind: 'bomber', x: 0.0, dz: 2.1 },
        { kind: 'mitosis', x: -1.6, dz: 2.9 },
        { kind: 'mitosis', x: 1.6, dz: 2.9 },
      ],
    },

    // ACT 2: Build Route Selection — Contested Vaults vs Supply Gates (125..250m, t = 9..18s)
    // Choice A: Crack Starter Core Weapon r1 OR charge opposite Gold Gate!
    {
      type: 'vault',
      crossDist: 172,
      x: -2.45 * flip,
      hp: 68,
      reward: r1,
    },
    {
      type: 'gate_row',
      crossDist: 176,
      layout: 'paired',
      left: flip > 0
        ? { op: 'add', value: 4, mutable: false }
        : { op: 'sub', value: 3, mutable: true, damagePerStep: 12, stepDelta: 3, maxValue: 20 },
      right: flip > 0
        ? { op: 'sub', value: 3, mutable: true, damagePerStep: 12, stepDelta: 3, maxValue: 20 }
        : { op: 'add', value: 4, mutable: false },
    },
    // The mirror leads into the same braced sentry, vault and jump on either layout.
    {
      type: 'reflector',
      crossDist: drill.mirror,
      x: drill.mirrorX,
      lean: (1 * flip) as 1 | -1,
    },
    // Choice B: Pick Fusion Partner r2 (Lv.1+Lv.1 => sum=2, recognizing both weapons before Fusion!) OR +16 Squad Gate!
    {
      type: 'vault',
      crossDist: drill.vault,
      x: 2.45 * flip,
      hp: 82,
      reward: r2,
    },
    {
      type: 'gate_row',
      crossDist: drill.gate,
      layout: 'paired',
      left: flip > 0 ? { op: 'add', value: 16, mutable: false } : { op: 'add', value: 4, mutable: false },
      right: flip > 0 ? { op: 'add', value: 4, mutable: false } : { op: 'add', value: 16, mutable: false },
    },

    {
      type: 'jump_pad',
      crossDist: drill.pad,
      x: -2.25 * flip,
    },
    {
      type: 'gate_row',
      crossDist: 346,
      layout: 'paired',
      left: flip > 0
        ? { op: 'div', value: 2, mutable: false }
        : { op: 'add', value: 10, mutable: true, damagePerStep: 16, stepDelta: 2, maxValue: 22 },
      right: flip > 0
        ? { op: 'add', value: 10, mutable: true, damagePerStep: 16, stepDelta: 2, maxValue: 22 }
        : { op: 'div', value: 2, mutable: false },
      tetheredSiphon: { side: flip > 0 ? 'right' : 'left', zAhead: 5.5 },
    },
    {
      type: 'enemies',
      crossDist: 360,
      units: [
        { kind: 'crawler', x: -3.2, dz: 0 },
        { kind: 'crawler', x: -2.0, dz: 0.7 },
        { kind: 'crawler', x: -0.8, dz: 1.2 },
        { kind: 'crawler', x: 0.8, dz: 1.2 },
        { kind: 'crawler', x: 2.0, dz: 0.7 },
        { kind: 'crawler', x: 3.2, dz: 0 },
        { kind: 'dasher', x: -2.6, dz: 3.4 },
        { kind: 'dasher', x: 2.6, dz: 3.4 },
      ],
    },

    // ACT 4: True Risk-vs-Build Choice (~405m, t = ~29s) — Complete Superweapon Fusion vs +26 Squad Reinforcements!
    {
      type: 'vault',
      crossDist: 458,
      x: -2.45 * flip,
      hp: 108,
      reward: r1 === 'blades' ? 'pulse' : r1,
    },
    {
      type: 'gate_row',
      crossDist: 464,
      layout: 'paired',
      left: flip > 0 ? { op: 'add', value: 4, mutable: false } : { op: 'add', value: 26, mutable: false },
      right: flip > 0 ? { op: 'add', value: 26, mutable: false } : { op: 'add', value: 4, mutable: false },
    },

    // ACT 5: Fusion Catharsis Sweep — Deathmatch Contract + Prism Lens + Final Horde! (465..705m, t = 34..51s)
    {
      type: 'contract_lane',
      crossDist: 472,
      length: 68,
      bountySide: flip > 0 ? 'left' : 'right',
      bountyHp: 280,
    },
    {
      type: 'gate_row',
      crossDist: 536,
      layout: 'paired',
      left: flip > 0 ? { op: 'add', value: 18, mutable: false } : { op: 'add', value: 10, mutable: false },
      right: flip > 0 ? { op: 'add', value: 10, mutable: false } : { op: 'add', value: 18, mutable: false },
    },
    {
      type: 'lens',
      crossDist: 588,
      x: 0.0,
      driftAmp: 1.8,
      driftFreq: 1.25,
    },
    {
      type: 'vault',
      crossDist: 602,
      x: 2.45 * flip,
      hp: 115,
      reward: r2,
    },
    {
      type: 'jump_pad',
      crossDist: 408,
      x: 2.35 * flip,
    },
    {
      type: 'jump_pad',
      crossDist: 628,
      x: -2.35 * flip,
    },
    {
      type: 'barrels',
      crossDist: 642,
      placements: [
        { x: -2.4, dz: 0 },
        { x: 0.0, dz: 3.2 },
        { x: 2.4, dz: 6.4 },
      ],
    },
    {
      type: 'enemies',
      crossDist: 648,
      units: [
        { kind: 'phalanx', x: -2.2, dz: 0.8 },
        { kind: 'glacier', x: 2.2, dz: 0.8 },
        { kind: 'bomber', x: 0.0, dz: 1.8 },
        { kind: 'necromancer', x: -1.2, dz: 3.4 },
        { kind: 'howler', x: 1.2, dz: 3.8 },
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
      crossDist: 696,
      layout: 'paired',
      left: { op: 'add', value: 14, mutable: false },
      right: { op: 'sub', value: 5, mutable: true, damagePerStep: 15, stepDelta: 3, maxValue: 26 },
    },
  ];

  encounters.sort((a, b) => a.crossDist - b.crossDist);

  return {
    id: 4 as const,
    name: '极速闪击',
    subtitle: 'OVERLIMIT BLITZ · 六幕超限决战',
    scrollSpeed: 13.8,
    runwayLength: 745,
    startSquad: 14,
    blitzDrill: drill,
    boss: { ...boss },
    encounters,
  };
}
