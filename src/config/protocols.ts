import type { EndlessUpgradeId } from '../types/game';

export const PROTOCOLS: Record<EndlessUpgradeId, { name: string; tag: string; glyph: string; color: string; description: string }> = {
  power: { name: '棱镜增幅', tag: '火力构筑', glyph: '✦', color: '#75e6ff', description: '全武器伤害 +18%，本局持续生效，可叠加。' },
  recruits: { name: '空降援军', tag: '即时补给', glyph: '◇', color: '#88efba', description: '立即补充 40 名战士，扩充编队与基础火力。' },
  resonance: { name: '共鸣回路', tag: '超载构筑', glyph: 'ϟ', color: '#d7adff', description: '共鸣充能效率 +30%，更频繁地释放超载。' },
  weapon: { name: '武装校准', tag: '武器进化', glyph: '⌖', color: '#ffca75', description: '当前武器升 1 级；已满级则获得 3 层武器精通。' },
  blades: { name: '环轨护卫', tag: '近身防线', glyph: '⟡', color: '#a8bdff', description: '增加 2 枚环轨刃（最多 4 枚）；已满编则全武器伤害 +12%。' },
  supply: { name: '后勤链路', tag: '长期成长', glyph: '▱', color: '#f9b3ce', description: '此后每次击破首领额外补员 12 人，可叠加。' },
};

export type ProtocolSynergyId =
  | 'hyper_annihilation'
  | 'tempest_blades'
  | 'immortal_legion'
  | 'singularity_matrix';

export interface ProtocolSynergyDef {
  id: ProtocolSynergyId;
  name: string;
  glyph: string;
  color: string;
  reqText: string;
  effectText: string;
  active(upgrades: Partial<Record<EndlessUpgradeId, number>>): boolean;
}

export const PROTOCOL_SYNERGIES: readonly ProtocolSynergyDef[] = [
  {
    id: 'hyper_annihilation',
    name: '超导歼灭',
    glyph: '❖',
    color: '#ff9a3c',
    reqText: '棱镜增幅 + 武装校准',
    effectText: '暴击率 +18% · 对首领与护盾晶塔伤害 +20%',
    active: (u) => (u.power ?? 0) >= 1 && (u.weapon ?? 0) >= 1,
  },
  {
    id: 'tempest_blades',
    name: '风暴剑阵',
    glyph: '❈',
    color: '#a8bdff',
    reqText: '环轨护卫 + 共鸣回路',
    effectText: '环轨刃伤害 +40% · 共鸣超载持续时间 +1.5 秒',
    active: (u) => (u.blades ?? 0) >= 1 && (u.resonance ?? 0) >= 1,
  },
  {
    id: 'immortal_legion',
    name: '不朽军团',
    glyph: '⛨',
    color: '#88efba',
    reqText: '空降援军 + 后勤链路',
    effectText: '怪群冲线与首领轰击减员 -25% · 阶段补员 +10',
    active: (u) => (u.recruits ?? 0) >= 1 && (u.supply ?? 0) >= 1,
  },
  {
    id: 'singularity_matrix',
    name: '奇点矩阵',
    glyph: '۞',
    color: '#ffd84a',
    reqText: '累计安装 ≥ 4 种不同协议',
    effectText: '全武器穿透 +1 · 全局火力额外 +15%',
    active: (u) => Object.values(u).filter((v) => (v ?? 0) >= 1).length >= 4,
  },
];

export function getActiveSynergies(
  upgrades: Partial<Record<EndlessUpgradeId, number>> | undefined,
): ProtocolSynergyDef[] {
  if (!upgrades) return [];
  return PROTOCOL_SYNERGIES.filter((s) => s.active(upgrades));
}

export function hasSynergy(
  upgrades: Partial<Record<EndlessUpgradeId, number>> | undefined,
  id: ProtocolSynergyId,
): boolean {
  if (!upgrades) return false;
  const def = PROTOCOL_SYNERGIES.find((s) => s.id === id);
  return def ? def.active(upgrades) : false;
}

const IDS = Object.keys(PROTOCOLS) as EndlessUpgradeId[];

/** Seeded draft: three distinct offers, with different build paths across stages. */
export function getProtocolOffers(seed: number, wave: number): EndlessUpgradeId[] {
  let state = (Math.imul(seed + 1, 1664525) ^ Math.imul(wave, 1013904223)) >>> 0;
  const choices = [...IDS];
  for (let i = choices.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [choices[i], choices[j]] = [choices[j]!, choices[i]!];
  }
  return choices.slice(0, 3);
}

export const ENDLESS_THREATS = [
  { name: '霓虹突围', description: '标准敌潮 · 稳定补给', glyph: '◇' },
  { name: '重装封锁', description: '敌人耐久 +25% · 补给门 +8', glyph: '⬡' },
  { name: '蜂拥浪潮', description: '额外感染体 · 敌人耐久 -15%', glyph: '≋' },
] as const;

export function getEndlessThreat(wave: number): typeof ENDLESS_THREATS[number] {
  return ENDLESS_THREATS[Math.max(0, wave - 1) % ENDLESS_THREATS.length]!;
}
