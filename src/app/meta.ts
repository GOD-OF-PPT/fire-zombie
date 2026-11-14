import type { BossId, EnemyKind, NonNullDefeatReason, RewardId, RunModifiers, SectorId } from '../types/game';

export const GAME_TITLE_CN = '棱镜蜂群';
export const GAME_TITLE_EN = 'PRISM SWARM';

export interface RewardMeta {
  name: string;
  short: string;
  desc: string;
  color: string;
  glyph: string;
}

export const REWARD_META: Record<RewardId, RewardMeta> = {
  pulse: { name: '棱光脉冲', short: '连射', desc: '高射速直线弹幕', color: '#3ef3ff', glyph: '❙❙' },
  scatter: { name: '折射散弹', short: '散射', desc: '扇形弹幕，清理成群小怪', color: '#7dff6b', glyph: '⋰⋱' },
  rail: { name: '超导贯穿', short: '穿透', desc: '一发贯穿多个目标，克制排队敌人', color: '#b98cff', glyph: '➤' },
  plasma: { name: '新星迫击', short: '爆破', desc: '命中后范围爆炸，克制密集敌群', color: '#ff9a3c', glyph: '✹' },
  cryo: { name: '绝对零度', short: '冰冻', desc: '命中减速并使敌人易伤 +25%', color: '#8fdcff', glyph: '❄' },
  blades: { name: '环轨刃', short: '护卫', desc: '环绕旋刃切割近敌，并 +6 架无人机', color: '#ffd84a', glyph: '✦' },
};

export interface EnemyMeta {
  name: string;
  color: number;
  score: number;
}

export const ENEMY_META: Record<EnemyKind, EnemyMeta> = {
  crawler: { name: '故障爬虫', color: 0xff3b5c, score: 10 },
  dasher: { name: '矢量突袭者', color: 0xff7a1a, score: 25 },
  bastion: { name: '防火墙堡垒', color: 0xc8243f, score: 60 },
  mitosis: { name: '分裂节点', color: 0xff3fd2, score: 30 },
  siphon: { name: '腐蚀虹吸者', color: 0xa64dff, score: 45 },
};

export const DEFEAT_META: Record<NonNullDefeatReason, { title: string; tip: string }> = {
  NEGATIVE_GATE: {
    title: '穿过减员门，蜂群归零',
    tip: '金色边框的门可以被射击：提前对准它，把负数一点点打成正数。',
  },
  DIVISION_GATE: {
    title: '除法门把蜂群削减为零',
    tip: '带锁的金框 ÷ 门被打破后会翻转成 ×2；人少时千万别碰 ÷ 门。',
  },
  ENEMY_BREACH: {
    title: '敌人冲入蜂群',
    tip: '优先清理正前方的敌人；体型大的堡垒可以横移绕开，或用爆炸桶炸掉。',
  },
  BOSS_ATTACK: {
    title: '被首领火力击溃',
    tip: '地面红色警示区填满前，移动到没有红色的车道；能量弹可以左右闪避。',
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
    bossTitle: '赤棱守卫',
    starSquad: [35, 75],
    palette: {
      sky: ['#02040d', '#0a1640', '#1b3a8a'],
      fog: 0x0a1640,
      track: 0x0b1126,
      grid: 0x1f6dff,
      edge: 0x3ef3ff,
      accent: 0x3ef3ff,
    },
  },
  2: {
    name: '超频回廊',
    subtitle: 'SECTOR 02 · OVERCLOCK CONDUIT',
    bossName: 'HYDRA-02',
    bossTitle: '双生执政官',
    starSquad: [70, 160],
    palette: {
      sky: ['#05020f', '#1f0b46', '#5a1a8f'],
      fog: 0x1f0b46,
      track: 0x120a26,
      grid: 0x9b4dff,
      edge: 0xff4fd8,
      accent: 0xff4fd8,
    },
  },
  3: {
    name: '零号奇点',
    subtitle: 'SECTOR 03 · SINGULARITY CORE',
    bossName: 'OMEGA-ZERO',
    bossTitle: '奇点主脑',
    starSquad: [60, 140],
    palette: {
      sky: ['#070205', '#2a0716', '#7a1830'],
      fog: 0x2a0716,
      track: 0x150910,
      grid: 0xff3355,
      edge: 0xffc531,
      accent: 0xffc531,
    },
  },
};

export const BOSS_META: Record<BossId, { name: string; title: string }> = {
  warden_01: { name: 'WARDEN-01', title: '赤棱守卫' },
  hydra_02: { name: 'HYDRA-02', title: '双生执政官' },
  omega_zero: { name: 'OMEGA-ZERO', title: '奇点主脑' },
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
export type UpgradeId = 'squad' | 'power' | 'reso';

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
    costs: [60, 110, 170, 240, 320],
    effect: (lv) => `开局 +${lv * 2} 架`,
  },
  {
    id: 'power',
    name: '超频弹芯',
    glyph: '✸',
    color: '#ff9a3c',
    max: 5,
    costs: [80, 130, 190, 260, 340],
    effect: (lv) => `伤害 +${lv * 8}%`,
  },
  {
    id: 'reso',
    name: '共鸣放大器',
    glyph: '⚡',
    color: '#fff36b',
    max: 5,
    costs: [50, 90, 140, 200, 270],
    effect: (lv) => `充能 +${lv * 15}%`,
  },
];

export function runModsFromUpgrades(u: Record<UpgradeId, number>): RunModifiers {
  return {
    bonusSquad: u.squad * 2,
    damageMult: 1 + u.power * 0.08,
    resonanceMult: 1 + u.reso * 0.15,
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
};
