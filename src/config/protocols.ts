import type { EndlessUpgradeId } from '../types/game';

export const PROTOCOLS: Record<EndlessUpgradeId, { name: string; tag: string; glyph: string; color: string; description: string }> = {
  power: { name: '棱镜增幅', tag: '火力构筑', glyph: '✦', color: '#75e6ff', description: '全武器伤害 +18%，本局持续生效，可叠加。' },
  recruits: { name: '空降援军', tag: '即时补给', glyph: '◇', color: '#88efba', description: '立即补充 40 名战士，扩充编队与基础火力。' },
  resonance: { name: '共鸣回路', tag: '超载构筑', glyph: 'ϟ', color: '#d7adff', description: '共鸣充能效率 +30%，更频繁地释放超载。' },
  weapon: { name: '武装校准', tag: '武器进化', glyph: '⌖', color: '#ffca75', description: '当前武器升 1 级；已满级则获得 3 层武器精通。' },
  blades: { name: '环轨护卫', tag: '近身防线', glyph: '⟡', color: '#a8bdff', description: '增加 2 枚环轨刃（最多 4 枚）；已满编则全武器伤害 +12%。' },
  supply: { name: '后勤链路', tag: '长期成长', glyph: '▱', color: '#f9b3ce', description: '此后每次击破首领额外补员 12 人，可叠加。' },
};

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
