import type { BossId, EnemyKind, NonNullDefeatReason, RewardId, RunModifiers, SectorId } from '../types/game';

export const GAME_TITLE_CN = '棱镜蜂群';
export const GAME_TITLE_EN = 'PRISM SWARM';

export interface RewardMeta {
  name: string;
  short: string;
  desc: string;
  color: string;
  glyph: string;
  counters: string;
}

export const REWARD_META: Record<RewardId, RewardMeta> = {
  pulse: { name: '棱光脉冲', short: '连射', desc: '高射速直线弹幕，克制噬能骷髅灵', color: '#3ef3ff', glyph: '❙❙', counters: '噬能骷髅灵 ×1.5' },
  scatter: { name: '折射散弹', short: '散射', desc: '扇形弹幕，克制刺球与史莱姆群', color: '#7dff6b', glyph: '⋰⋱', counters: '狂暴刺球 ×1.4 · 分裂史莱姆 ×1.3' },
  rail: { name: '超导贯穿', short: '穿透', desc: '贯穿多个目标，对重甲巨魔伤害 ×1.8', color: '#b98cff', glyph: '➤', counters: '重甲巨魔 ×1.8 · 直线贯穿 3~8 目标' },
  plasma: { name: '新星迫击', short: '爆破', desc: '范围爆炸，克制分裂史莱姆', color: '#ff9a3c', glyph: '✹', counters: '分裂史莱姆 ×1.6 · 狂暴刺球 ×1.2' },
  cryo: { name: '绝对零度', short: '冰冻', desc: '减速并易伤 +25%，克制烈焰迅龙', color: '#8fdcff', glyph: '❄', counters: '烈焰迅龙 ×1.6 · 冻结易伤 +25%' },
  blades: { name: '环轨刃', short: '护卫', desc: '环绕旋刃切割近敌，并 +6 名战士', color: '#ffd84a', glyph: '✦', counters: '全近身怪群持续切割 + 补充 6 名战士' },
};

export interface EnemyMeta {
  name: string;
  color: number;
  hex: string;
  score: number;
  role: string;
  weakness: string;
  detail: string;
}

export const ENEMY_META: Record<EnemyKind, EnemyMeta> = {
  crawler: {
    name: '狂暴刺球',
    color: 0xff3b5c,
    hex: '#ff3b5c',
    score: 10,
    role: '集群突袭体',
    weakness: '折射散弹 ×1.4 / 新星迫击 ×1.2',
    detail: '成群涌出的棘刺感染体，单体脆弱但数量庞大，散射或范围爆破可瞬间清场。',
  },
  dasher: {
    name: '烈焰迅龙',
    color: 0xff7a1a,
    hex: '#ff7a1a',
    score: 25,
    role: '激光锁定冲锋兽',
    weakness: '绝对零度 ×1.6（减速克制）',
    detail: '蓄力时投射红色地面锁定线，0.65 秒后以 2.2 倍极速突进；可用冰冻减速或横向闪避。',
  },
  bastion: {
    name: '重甲巨魔',
    color: 0xd92648,
    hex: '#d92648',
    score: 60,
    role: '重装破阵巨兽',
    weakness: '超导贯穿 ×1.8 / 电容桶引爆',
    detail: '披挂金红重甲的巨型怪物，冲入防线最多造成 12 人减员；贯穿轨炮或连锁电容桶可高效击破。',
  },
  mitosis: {
    name: '分裂史莱姆',
    color: 0xff3fd2,
    hex: '#ff3fd2',
    score: 30,
    role: '双核裂变母体',
    weakness: '新星迫击 ×1.6 / 折射散弹 ×1.3',
    detail: '被击破时会分裂成两只次生刺球，利用迫击炮溅射可在分裂瞬间同步歼灭子体。',
  },
  siphon: {
    name: '噬能骷髅灵',
    color: 0xa64dff,
    hex: '#a64dff',
    score: 45,
    role: '门能窃取幽体',
    weakness: '棱光脉冲 ×1.5（集火秒杀）',
    detail: '连接前方金框数字门每秒窃取 -1 数值，优先集火击杀可立即为该门返还注入 +6 数值！',
  },
};

export const DEFEAT_META: Record<NonNullDefeatReason, { title: string; tip: string }> = {
  NEGATIVE_GATE: {
    title: '穿过减员门，小队归零',
    tip: '金色边框的门可以被射击：提前对准它，把负数一点点打成正数。',
  },
  DIVISION_GATE: {
    title: '除法门把小队削减为零',
    tip: '带锁的金框 ÷ 门被打破后会翻转成 ×2；人少时千万别碰 ÷ 门。',
  },
  ENEMY_BREACH: {
    title: '怪兽冲垮防线',
    tip: '危急时刻点击左下角「相位脉冲」（或按 E/Shift）震退近身怪群并开启减伤力场！',
  },
  BOSS_ATTACK: {
    title: '被首领火力击溃',
    tip: '地面红色警示区填满前移到安全车道；首领能量弹可用「相位脉冲」直接震碎清除。',
  },
};

export interface SectorMeta {
  name: string;
  subtitle: string;
  bossName: string;
  bossTitle: string;
  starSquad: [number, number];
  palette: {
    sky: [string, string, string];
    fog: number;
    track: number;
    grid: number;
    edge: number;
    accent: number;
  };
}

export const SECTOR_META: Record<SectorId, SectorMeta> = {
  1: {
    name: '光学干线',
    subtitle: 'SECTOR 01 · OPTICAL TRUNKLINE',
    bossName: 'WARDEN-01',
    bossTitle: '赤焰魔像王',
    starSquad: [60, 140],
    palette: {
      sky: ['#061030', '#122f74', '#2864c4'],
      fog: 0x112864,
      track: 0x1a3266,
      grid: 0x3f92ff,
      edge: 0x48f5ff,
      accent: 0x3ef3ff,
    },
  },
  2: {
    name: '超频回廊',
    subtitle: 'SECTOR 02 · OVERCLOCK CONDUIT',
    bossName: 'HYDRA-02',
    bossTitle: '双生魔龙',
    starSquad: [80, 165],
    palette: {
      sky: ['#0b0524', '#291166', '#7624b8'],
      fog: 0x220f56,
      track: 0x2a185a,
      grid: 0xb368ff,
      edge: 0xff5ce0,
      accent: 0xff4fd8,
    },
  },
  3: {
    name: '零号奇点',
    subtitle: 'SECTOR 03 · SINGULARITY CORE',
    bossName: 'OMEGA-ZERO',
    bossTitle: '深渊魔王',
    starSquad: [100, 200],
    palette: {
      sky: ['#12040c', '#420c26', '#9c1f44'],
      fog: 0x300a1d,
      track: 0x36162a,
      grid: 0xff476e,
      edge: 0xffcf40,
      accent: 0xffc531,
    },
  },
  4: {
    name: '随机回廊',
    subtitle: 'SECTOR 04 · RANDOM CORRIDOR',
    bossName: '???',
    bossTitle: '每局随机',
    starSquad: [150, 300],
    palette: {
      sky: ['#03140f', '#0a3a2d', '#1d8a66'],
      fog: 0x0a3024,
      track: 0x11382e,
      grid: 0x3dffb0,
      edge: 0xb6ff4a,
      accent: 0x7dff9a,
    },
  },
};

export interface BossCodexEntry {
  name: string;
  title: string;
  color: string;
  phases: number;
  mechanic: string;
  counterTip: string;
}

export const BOSS_META: Record<BossId, BossCodexEntry> = {
  warden_01: {
    name: 'WARDEN-01',
    title: '赤焰魔像王',
    color: '#ff4b5c',
    phases: 2,
    mechanic: '多车道重拳轰击 + 召唤金色棱镜；二阶段滑出紧急金框门支援。',
    counterTip: '站在金色棱镜正后方让弹幕分裂倍增，避开地面红区即可稳健破核。',
  },
  hydra_02: {
    name: 'HYDRA-02',
    title: '双生魔龙',
    color: '#ff4fd8',
    phases: 2,
    mechanic: '紫焰古龙与电光苍龙协同吐息；二阶段双核分体，每 3.6 秒交替切换无敌护盾。',
    counterTip: '紧盯未开启蓝盾的暴露龙核（承受 1.5 倍弱点伤害），切勿把火力浪费在护盾上。',
  },
  omega_zero: {
    name: 'OMEGA-ZERO',
    title: '深渊魔王',
    color: '#ffc531',
    phases: 3,
    mechanic: '一阶段双晶塔维持无敌力场；二阶段召唤烈焰迅龙突袭；三阶段投下连锁电容桶。',
    counterTip: '先击碎左右两座护盾晶塔触发魔王眩晕并领武器升级；三阶段引爆电容桶重创本体！',
  },
};

export const SCORE = {
  gateImproved: 120,
  gateGainPerUnit: 6,
  vault: 180,
  barrelBase: 30,
  bossBase: 2500,
  finalSquadPerUnit: 12,
};

// ------------------------------------------------------------------ workshop (meta progression)
export type UpgradeId = 'squad' | 'power' | 'reso' | 'aegis' | 'crit' | 'bounty';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  glyph: string;
  color: string;
  max: number;
  costs: readonly number[];
  effect(level: number): string;
}

export const CORE_GLYPH = '⬡';

export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'squad',
    name: '先遣编队',
    glyph: '◆',
    color: '#3ef3ff',
    max: 5,
    costs: [50, 90, 140, 200, 260],
    effect: (lv) => `开局 +${lv * 2} 名战士`,
  },
  {
    id: 'power',
    name: '超频弹芯',
    glyph: '✸',
    color: '#ff9a3c',
    max: 5,
    costs: [60, 100, 150, 210, 280],
    effect: (lv) => `伤害 +${lv * 6}%`,
  },
  {
    id: 'reso',
    name: '共鸣放大器',
    glyph: '⚡',
    color: '#fff36b',
    max: 5,
    costs: [40, 70, 110, 160, 220],
    effect: (lv) => `充能 +${lv * 15}%`,
  },
  {
    id: 'aegis',
    name: '相位力场',
    glyph: '🛡',
    color: '#62f4ff',
    max: 5,
    costs: [55, 95, 145, 205, 275],
    effect: (lv) =>
      `脉冲冷却 -${(lv * 1.1).toFixed(1)}s · 护盾 ${(1.25 + lv * 0.2).toFixed(2)}s${lv >= 3 ? ' · 绝境自启' : ''}`,
  },
  {
    id: 'crit',
    name: '聚变棱镜',
    glyph: '❖',
    color: '#ff5ce0',
    max: 5,
    costs: [65, 110, 165, 230, 300],
    effect: (lv) => `暴击率 +${lv * 5}%（暴击 ×1.75 伤害）`,
  },
  {
    id: 'bounty',
    name: '晶核萃取',
    glyph: '⬡',
    color: '#b98cff',
    max: 5,
    costs: [45, 85, 135, 195, 265],
    effect: (lv) => `结算晶核 +${lv * 15}% · 得分加成 +${lv * 8}%`,
  },
];

export function getApexCost(apexLevel: number): number {
  return 160 + Math.max(0, Math.floor(apexLevel)) * 75;
}

export function isApexUnlocked(upgrades: Record<UpgradeId, number>): boolean {
  return UPGRADES.some((u) => (upgrades[u.id] ?? 0) >= u.max);
}

export function getTotalWorkshopSpent(upgrades: Record<UpgradeId, number>, apexLevel = 0): number {
  let spent = 0;
  for (const u of UPGRADES) {
    const lv = Math.max(0, Math.min(u.max, upgrades[u.id] ?? 0));
    for (let i = 0; i < lv; i++) spent += u.costs[i]!;
  }
  for (let i = 0; i < apexLevel; i++) spent += getApexCost(i);
  return spent;
}

export function runModsFromUpgrades(
  u: Partial<Record<UpgradeId, number>>,
  apexLevel = 0,
): RunModifiers {
  const squad = u.squad ?? 0;
  const power = u.power ?? 0;
  const reso = u.reso ?? 0;
  const aegis = u.aegis ?? 0;
  const crit = u.crit ?? 0;
  const apex = Math.max(0, Math.floor(apexLevel));
  return {
    bonusSquad: squad * 2 + apex,
    damageMult: (1 + power * 0.06) * (1 + apex * 0.04),
    resonanceMult: 1 + reso * 0.15,
    bossHpMult: 1 + (squad + power + reso) * 0.025 + apex * 0.02,
    aegisCooldownSec: Math.max(7.5, 14 - aegis * 1.1),
    aegisDurationSec: 1.25 + aegis * 0.2,
    autoAegisCharges: aegis >= 5 ? 2 : aegis >= 3 ? 1 : 0,
    critChance: crit * 0.05,
  };
}

/** Core shards earned at the end of a run. Defeats still pay out so every attempt progresses. */
export function computeCoreReward(opts: {
  victory: boolean;
  stars: number;
  score: number;
  progress: number;
  firstClear: boolean;
  sector: SectorId;
  bountyLevel?: number;
}): { total: number; lines: Array<[string, number]> } {
  const lines: Array<[string, number]> = [];
  if (opts.victory) {
    lines.push(['区域突破', 30 + opts.sector * 10]);
    if (opts.stars > 1) lines.push([`星级 ×${opts.stars}`, (opts.stars - 1) * 15]);
    if (opts.firstClear) lines.push(['首次通关', 60]);
  } else {
    lines.push([`推进 ${Math.round(opts.progress * 100)}%`, Math.round(opts.progress * 35)]);
  }
  lines.push(['得分换算', Math.floor(opts.score / 250)]);
  const baseTotal = lines.reduce((s, l) => s + l[1], 0);
  const bountyLv = Math.max(0, opts.bountyLevel ?? 0);
  if (bountyLv > 0 && baseTotal > 0) {
    const bonus = Math.max(1, Math.round(baseTotal * bountyLv * 0.15));
    lines.push([`晶核萃取 +${bountyLv * 15}%`, bonus]);
  }
  const total = lines.reduce((s, l) => s + l[1], 0);
  return { total, lines };
}

// ------------------------------------------------------------------ sector challenges (one-time bonus goals)
export interface ChallengeInput {
  victory: boolean;
  finalSquad: number;
  bossLoss: number;
  maxCombo: number;
  stats: { kills: number; gatesImproved: number; vaultsCracked: number; maxChain: number; peakSquad: number };
}

export interface ChallengeDef {
  id: string;
  text: string;
  reward: number;
  check(r: ChallengeInput): boolean;
}

export const SECTOR_CHALLENGES: Record<SectorId, readonly ChallengeDef[]> = {
  1: [
    { id: 's1-gates', text: '改善 4 扇金框门', reward: 40, check: (r) => r.stats.gatesImproved >= 4 },
    { id: 's1-chain', text: '引发 3 连锁爆炸', reward: 40, check: (r) => r.stats.maxChain >= 3 },
    { id: 's1-boss', text: '首领战损失 ≤ 10 并通关', reward: 60, check: (r) => r.victory && r.bossLoss <= 10 },
  ],
  2: [
    { id: 's2-vaults', text: '击破 5 个能量舱', reward: 50, check: (r) => r.stats.vaultsCracked >= 5 },
    { id: 's2-combo', text: '达成 30 连杀', reward: 50, check: (r) => r.maxCombo >= 30 },
    { id: 's2-squad', text: '通关时蜂群 ≥ 150', reward: 70, check: (r) => r.victory && r.finalSquad >= 150 },
  ],
  3: [
    { id: 's3-gates', text: '改善 8 扇金框门', reward: 60, check: (r) => r.stats.gatesImproved >= 8 },
    { id: 's3-peak', text: '蜂群峰值 ≥ 200', reward: 60, check: (r) => r.stats.peakSquad >= 200 },
    { id: 's3-boss', text: '首领战损失 ≤ 20 并通关', reward: 90, check: (r) => r.victory && r.bossLoss <= 20 },
  ],
  4: [
    { id: 's4-clear', text: '通关一次随机回廊', reward: 80, check: (r) => r.victory },
    { id: 's4-vaults', text: '击破 6 个能量舱', reward: 60, check: (r) => r.stats.vaultsCracked >= 6 },
    { id: 's4-squad', text: '通关时蜂群 ≥ 300', reward: 100, check: (r) => r.victory && r.finalSquad >= 300 },
  ],
};

// ------------------------------------------------------------------ global achievements / medals
export interface AchievementContext {
  victory: boolean;
  sector: SectorId;
  endlessWave: number;
  maxCombo: number;
  bossLoss: number;
  stats: { kills: number; gatesImproved: number; vaultsCracked: number; maxChain: number; peakSquad: number };
  totalKills: number;
  allThreeStars: boolean;
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  glyph: string;
  color: string;
  reward: number;
  check(ctx: AchievementContext): boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'ach-s1', name: '干线贯通', desc: '首次通关第 1 区域「光学干线」', glyph: '★', color: '#3ef3ff', reward: 50, check: (c) => c.victory && c.sector === 1 },
  { id: 'ach-s2', name: '屠龙协议', desc: '通关第 2 区域并击败双生魔龙', glyph: '🐉', color: '#ff5ce0', reward: 70, check: (c) => c.victory && c.sector === 2 },
  { id: 'ach-s3', name: '奇点征服者', desc: '通关第 3 区域并终结深渊魔王', glyph: '👑', color: '#ffc531', reward: 100, check: (c) => c.victory && c.sector === 3 },
  { id: 'ach-s4', name: '混沌领航员', desc: '突破第 4 区域「随机回廊」', glyph: '🧭', color: '#7dff9a', reward: 90, check: (c) => c.victory && c.sector === 4 },
  { id: 'ach-swarm-150', name: '百人成军', desc: '单局蜂群峰值达到 150 人', glyph: '◆', color: '#3ef3ff', reward: 50, check: (c) => c.stats.peakSquad >= 150 },
  { id: 'ach-swarm-350', name: '钢铁洪流', desc: '单局蜂群峰值达到 350 人', glyph: '❖', color: '#ffd84a', reward: 110, check: (c) => c.stats.peakSquad >= 350 },
  { id: 'ach-combo-50', name: '炽热风暴', desc: '单局达成 50 连杀（满阶狂热）', glyph: '🔥', color: '#ff9a3c', reward: 65, check: (c) => c.maxCombo >= 50 },
  { id: 'ach-chain-4', name: '连锁艺术', desc: '单次引爆达成 ≥ 4 电容桶连锁', glyph: '💥', color: '#ff7a1a', reward: 65, check: (c) => c.stats.maxChain >= 4 },
  { id: 'ach-flawless', name: '零损神迹', desc: '任意区域首领战 0 减员通关', glyph: '🛡', color: '#62f4ff', reward: 100, check: (c) => c.victory && c.bossLoss === 0 },
  { id: 'ach-endless-3', name: '轮回先锋', desc: '无尽协议抵达阶段 3', glyph: '∞', color: '#b98cff', reward: 80, check: (c) => c.endlessWave >= 3 },
  { id: 'ach-endless-6', name: '无尽传奇', desc: '无尽协议抵达阶段 6', glyph: '۞', color: '#ff4fd8', reward: 140, check: (c) => c.endlessWave >= 6 },
  { id: 'ach-slayer-500', name: '霓虹清道夫', desc: '生涯累计歼灭 500 只感染体与首领', glyph: '⚔', color: '#19f5a8', reward: 90, check: (c) => c.totalKills >= 500 },
];
