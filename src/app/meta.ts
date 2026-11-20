import { WINGMAN_META } from '../sim/v22Mechanics';
import type { WingmanId } from '../types/game';
import type {
  OverclockChipId,
  BossId,
  DamageSourceKey,
  EnemyKind,
  MutatorId,
  NonNullDefeatReason,
  RewardId,
  RunModifiers,
  SectorId,
  SimSnapshot,
  SpecializationId,
  SquadSkinId,
  WeaponId,
} from '../types/game';
import { DUAL_SYNERGIES, FUSIONS, MUTATORS } from '../config/blitz';

export const STARTER_WEAPON_COST = 85;
export const STARTER_BLADE_COST = 110;

export const SQUAD_SKINS: ReadonlyArray<{ id: SquadSkinId; name: string; hex: number; color: string; reqHeat?: number }> = [
  { id: 'cyan', name: '棱光青', hex: 0x3ef3ff, color: '#3ef3ff' },
  { id: 'gold', name: '曜金皇冠', hex: 0xffd84a, color: '#ffd84a' },
  { id: 'crimson', name: '赤绯烈阳', hex: 0xff4b6e, color: '#ff4b6e' },
  { id: 'emerald', name: '翡翠矩阵', hex: 0x19f5a8, color: '#19f5a8' },
  { id: 'abyss_violet', name: '深渊流光紫(灾2)', hex: 0xc266ff, color: '#c266ff', reqHeat: 2 },
  { id: 'solar_prism', name: '日冕流光金(灾5)', hex: 0xff9e2c, color: '#ff9e2c', reqHeat: 5 },
  { id: 'void_aurora', name: '极光幻彩流光(灾8)', hex: 0x00ffd5, color: '#00ffd5', reqHeat: 8 },
];

export const STARTER_WEAPONS: readonly WeaponId[] = ['pulse', 'scatter', 'rail', 'plasma', 'cryo'];

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
  glyph: string;
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
    glyph: '🕷',
    color: 0xff3b5c,
    hex: '#ff3b5c',
    score: 10,
    role: 'Ⅰ阶·集群兵 · 前锋刺球',
    weakness: '折射散弹 ×1.4 / 新星迫击 ×1.2',
    detail: '成群涌出的甲壳棘刺感染体，单体脆弱但如潮水铺满桥面，散射或迫击可成片粉碎。',
  },
  dasher: {
    name: '烈焰迅龙',
    glyph: '🦖',
    color: 0xff7a1a,
    hex: '#ff7a1a',
    score: 25,
    role: 'Ⅱ阶·突击种 · 锁定冲锋兽',
    weakness: '绝对零度 ×1.6（减速克制）',
    detail: '蓄力时投射红色地面锁定线，0.65 秒后以 2.2 倍极速突进；可用冰冻减速或横向闪避。',
  },
  bastion: {
    name: '重甲巨魔',
    glyph: '👹',
    color: 0xd92648,
    hex: '#d92648',
    score: 60,
    role: 'Ⅳ阶·霸体领主 · 重装巨兽',
    weakness: '超导贯穿 ×1.8 / 电容桶引爆',
    detail: '披挂金红重甲的巨型怪物，冲入防线最多造成 12 人减员；贯穿轨炮或连锁电容桶可高效击破。',
  },
  mitosis: {
    name: '分裂史莱姆',
    glyph: '🫧',
    color: 0xff3fd2,
    hex: '#ff3fd2',
    score: 30,
    role: 'Ⅱ阶·突击种 · 双核裂变体',
    weakness: '新星迫击 ×1.6 / 折射散弹 ×1.3',
    detail: '被击破时会分裂成两只次生刺球，利用迫击炮溅射可在分裂瞬间同步歼灭子体。',
  },
  siphon: {
    name: '噬能骷髅灵',
    glyph: '💀',
    color: 0xa64dff,
    hex: '#a64dff',
    score: 45,
    role: 'Ⅲ阶·精英卫 · 门能窃取灵',
    weakness: '棱光脉冲 ×1.5（集火秒杀）',
    detail: '连接前方金框数字门每秒窃取 -1 数值，优先集火击杀可立即为该门返还注入 +6 数值！',
  },
  bomber: {
    name: '爆裂自爆尸',
    glyph: '☣',
    color: 0x92ff24,
    hex: '#92ff24',
    score: 35,
    role: 'Ⅱ阶·突击种 · 背桶自爆体',
    weakness: '棱光脉冲 ×1.5 / 折射散弹 ×1.35',
    detail: '背负高压生化等离子桶狂奔；在怪群中提前射爆可引发范围殉爆清场并为附近金框门 +2！',
  },
  phalanx: {
    name: '电磁盾卫尸',
    glyph: '🛡',
    color: 0x2ee6ff,
    hex: '#2ee6ff',
    score: 50,
    role: 'Ⅲ阶·精英卫 · 电磁防暴盾卫',
    weakness: '超导贯穿 ×2.0（穿盾）/ 新星迫击 ×1.65',
    detail: '手持六角电磁防暴盾吸收 60% 普通正面弹幕；超导轨炮、棱镜增幅弹与迫击溅射可直接破盾！',
  },
  stalker: {
    name: '幽影闪现尸',
    glyph: '⚡',
    color: 0xe45cff,
    hex: '#e45cff',
    score: 40,
    role: 'Ⅱ阶·突击种 · 相位镰刃刺客',
    weakness: '绝对零度 ×1.75（冻结禁闪）/ 折射散弹 ×1.4',
    detail: '挥舞双臂霓虹镰刃，每 1.75 秒横向折跃换道突袭；冰冻减速可彻底锁死其相位闪现！',
  },
  brood: {
    name: '孵化母巢兽',
    glyph: '🦂',
    color: 0xff9f1c,
    hex: '#ff9f1c',
    score: 65,
    role: 'Ⅳ阶·霸体领主 · 虫巢母体',
    weakness: '新星迫击 ×1.75 / 超导贯穿 ×1.45',
    detail: '腹部搏动发光卵囊的六足母巢蛛尸，行进中持续孵化幼体刺球铺满赛道，需优先轰杀断绝虫源！',
  },
  howler: {
    name: '狂怒战嚎尸',
    glyph: '📯',
    color: 0xff2a6d,
    hex: '#ff2a6d',
    score: 55,
    role: 'Ⅲ阶·精英卫 · 狂暴图腾统领',
    weakness: '超导贯穿 ×1.6 / 棱光脉冲 ×1.45',
    detail: '双肩共鸣音爆图腾使周围怪群移速 +28%；精准狙杀可触发音波反噬，震慑减速全场周围感染体！',
  },
  glacier: {
    name: '霜甲巨像',
    glyph: '🧊',
    color: 0x5ceeff,
    hex: '#5ceeff',
    score: 60,
    role: 'Ⅳ阶·霸体领主 · 永冻晶甲泰坦',
    weakness: '新星迫击 ×1.85 / 超导贯穿 ×1.65',
    detail: '身披厚重寒晶棱甲吸收普通轻火力且免疫冰减速；被击碎时引爆霜星新星，冻结周围怪群并赋予脆化易伤！',
  },
  beholder: {
    name: '棱光狙击眼',
    glyph: '👁',
    color: 0xffbe2e,
    hex: '#ffbe2e',
    score: 48,
    role: 'Ⅲ阶·精英卫 · 浮空锁定炮台',
    weakness: '超导贯穿 ×1.75 / 棱光脉冲 ×1.65',
    detail: '悬浮于反重力星环之上的独眼哨卫，周期锁定小队并发射高能等离子球；冰冻或集火点杀可打断充能！',
  },
  burrower: {
    name: '钻地裂甲虫',
    glyph: '🪲',
    color: 0xff7722,
    hex: '#ff7722',
    score: 38,
    role: 'Ⅱ阶·突击种 · 熔岩破土甲虫',
    weakness: '绝对零度 ×1.7 / 折射散弹 ×1.65',
    detail: '前端高速旋转双螺旋钻头的熔岩甲虫，逼近中程时破土狂飙突进；冰冻可卡死钻机齿轮，散弹贴脸成片撕裂！',
  },
  necromancer: {
    name: '纳米织网者',
    glyph: '🧬',
    color: 0x2dff9e,
    hex: '#2dff9e',
    score: 58,
    role: 'Ⅲ阶·精英卫 · 纳米修复祭司',
    weakness: '超导贯穿 ×1.7 / 新星迫击 ×1.6',
    detail: '释放翡翠纳米脉冲持续治疗周围伤残怪群；优先斩首可引爆其反应炉，直接为小队回复共鸣与核弹充能！',
  },
};

export const DEFEAT_META: Record<NonNullDefeatReason, { title: string; tip: string }> = {
  NEGATIVE_GATE: {
    title: '穿过减员门，小队归零',
    tip: '金色边框的门可以被射击：提前对准它，把负数一点点打成正数，或利用磁浮跳台跃空跨过！',
  },
  DIVISION_GATE: {
    title: '除法门把小队削减为零',
    tip: '带锁的金框 ÷ 门被打破后会翻转成 ×2；也可踩磁浮跳台直接飞跃致命 ÷ 门！',
  },
  ENEMY_BREACH: {
    title: '怪兽冲垮防线',
    tip: '危急时刻点击左下角「相位脉冲」（或按 E/Shift）震退近身怪群并开启减伤力场！',
  },
  BOSS_ATTACK: {
    title: '被首领火力击溃',
    tip: '优先击碎首领双肩部件触发 2.0× 破防眩晕，集火「数字湮灭棱球」将其转正反击轰碎首领核心！',
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
    mechanic: '双肩重炮+孵化巢、数字湮灭棱球压制；二阶段滑出紧急金框门支援。',
    counterTip: '先破双肩部件触发 4 秒 2.0× 破防，集火将负值湮灭棱球转正反击轰掉首领 16% 血量！',
  },
  hydra_02: {
    name: 'HYDRA-02',
    title: '双生魔龙',
    color: '#ff4fd8',
    phases: 2,
    mechanic: '紫焰古龙与电光苍龙协同吐息+湮灭棱球；二阶段双核分体交替无敌护盾。',
    counterTip: '紧盯未开启蓝盾的暴露龙核（1.5× 弱点），击破双翼部件与反弹棱球可瞬间蒸发巨额血量。',
  },
  omega_zero: {
    name: 'OMEGA-ZERO',
    title: '深渊魔王',
    color: '#ffc531',
    phases: 3,
    mechanic: '一阶段双晶塔维持无敌力场；二阶段召唤迅龙与湮灭棱球；三阶段投下连锁电容桶。',
    counterTip: '先碎双晶塔破除护盾，再拆双肩重武进入 2.0× 破防窗口，配合棱球反击与电容桶终结魔王！',
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
    effect: (lv) => `结算晶核 +${lv * 18}% · 通关悬赏晶核 +${lv * 6}（不影响竞技榜单得分）`,
  },
];

export interface SpecializationDef {
  id: SpecializationId;
  name: string;
  glyph: string;
  color: string;
  max: 3;
  costs: readonly [number, number, number];
  effect: (lv: number) => string;
}

export const SPECIALIZATIONS: readonly SpecializationDef[] = [
  {
    id: 'spec_ricochet',
    name: '光学折射支线',
    glyph: '⟁',
    color: '#7dff6b',
    max: 3,
    costs: [80, 150, 240],
    effect: (lv) => `折镜/透镜增幅伤害 +${lv * 12}%${lv >= 2 ? ' · 电弧折跃 +1 次' : ''}`,
  },
  {
    id: 'spec_vortex',
    name: '引力奇点支线',
    glyph: '🌀',
    color: '#b98cff',
    max: 3,
    costs: [80, 150, 240],
    effect: (lv) => `黑洞与爆桶半径 +${lv * 10}% · 破防超载共振延长 +${(lv * 0.4).toFixed(1)}s`,
  },
  {
    id: 'spec_shatter',
    name: '重装碎甲支线',
    glyph: '⚡',
    color: '#ff9a3c',
    max: 3,
    costs: [80, 150, 240],
    effect: (lv) => `对首领部件/护盾/冰缓精英伤害 +${lv * 14}% · 弹反返还冷却 +${(lv * 0.6).toFixed(1)}s`,
  },
];

export interface OverclockChipDef {
  id: OverclockChipId;
  name: string;
  short: string;
  glyph: string;
  color: string;
  cost: number;
  desc: string;
}

export const OVERCLOCK_CHIPS: readonly OverclockChipDef[] = [
  {
    id: 'chip_phase_blink',
    name: '闪现折跃芯片',
    short: '闪现折跃',
    glyph: '⚡',
    color: '#3ef3ff',
    cost: 110,
    desc: '开启相位脉冲或踏上极性电磁滑轨时，赋予 1.7s 射速 +22% 与电磁穿透 +2',
  },
  {
    id: 'chip_aegis_nova',
    name: '弹反超新星芯片',
    short: '弹反新星',
    glyph: '🛡',
    color: '#62f4ff',
    cost: 125,
    desc: '完美弹反冲锋怪或首领终焉光束时释放 7.8m 震荡新星，额外返还脉冲冷却 2.0s',
  },
  {
    id: 'chip_prism_split',
    name: '双折射棱镜芯片',
    short: '双折射镜',
    glyph: '⟁',
    color: '#7dff6b',
    cost: 135,
    desc: '弹幕经 45° 折镜折射时额外分裂 1 枚反向斜射增幅弹（38% 伤害 · 穿透 +2）',
  },
  {
    id: 'chip_volatile_core',
    name: '高能殉爆芯片',
    short: '高能殉爆',
    glyph: '💥',
    color: '#ff9a3c',
    cost: 120,
    desc: '电容桶与过载电容塔爆炸范围 +25%，每次引爆额外迸射 2 枚磁吸晶核碎片',
  },
  {
    id: 'chip_exec_protocol',
    name: '终焉处决芯片',
    short: '终焉处决',
    glyph: '👑',
    color: '#ffd84a',
    cost: 150,
    desc: '对首领部件伤害 +25%，折镜交叉聚焦更快触发终焉处决；破甲立即回复 25% 核弹与共鸣',
  },
  {
    id: 'chip_magnet_harvester',
    name: '磁吸晶核芯片',
    short: '磁吸晶核',
    glyph: '🧲',
    color: '#e28cff',
    cost: 115,
    desc: '战场晶核磁吸范围翻倍（6.4m），每拾取 5 枚晶核立即补充 +2 名战士/预备役',
  },
];

export function getApexCost(apexLevel: number): number {
  return 160 + Math.max(0, Math.floor(apexLevel)) * 75;
}

export function isApexUnlocked(upgrades: Record<UpgradeId, number>): boolean {
  return UPGRADES.some((u) => (upgrades[u.id] ?? 0) >= u.max);
}

export function getTotalWorkshopSpent(
  upgrades: Record<UpgradeId, number>,
  apexLevel = 0,
  specializations?: Partial<Record<SpecializationId, number>>,
  unlockedChips?: readonly OverclockChipId[],
  unlockedWingmen: readonly WingmanId[] = [],
): number {
  let spent = 0;
  for (const u of UPGRADES) {
    const lv = Math.max(0, Math.min(u.max, upgrades[u.id] ?? 0));
    for (let i = 0; i < lv; i++) spent += u.costs[i]!;
  }
  if (specializations) {
    for (const sp of SPECIALIZATIONS) {
      const lv = Math.max(0, Math.min(sp.max, specializations[sp.id] ?? 0));
      for (let i = 0; i < lv; i++) spent += sp.costs[i]!;
    }
  }
  if (unlockedChips) {
    for (const cid of unlockedChips) {
      const cDef = OVERCLOCK_CHIPS.find((x) => x.id === cid);
      if (cDef) spent += cDef.cost;
    }
  }
  for (const id of new Set(unlockedWingmen)) spent += WINGMAN_META[id].cost;
  for (let i = 0; i < apexLevel; i++) spent += getApexCost(i);
  return spent;
}

export function runModsFromUpgrades(
  u: Partial<Record<UpgradeId, number>>,
  apexLevel = 0,
  specializations?: Partial<Record<SpecializationId, number>>,
  equippedChips?: readonly OverclockChipId[],
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
    specRicochet: Math.max(0, Math.min(3, Math.floor(specializations?.spec_ricochet ?? 0))),
    specVortex: Math.max(0, Math.min(3, Math.floor(specializations?.spec_vortex ?? 0))),
    specShatter: Math.max(0, Math.min(3, Math.floor(specializations?.spec_shatter ?? 0))),
    equippedChips: equippedChips ? equippedChips.slice(0, 3) : [],
  };
}

export function computeMutatorBonusPct(mutators: readonly MutatorId[] = []): number {
  let pct = 0;
  for (const m of MUTATORS) {
    if (mutators.includes(m.id)) pct += m.bonusPct;
  }
  return pct;
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
  blitz?: boolean;
  mutatorBonusPct?: number;
}): { total: number; lines: Array<[string, number]> } {
  const lines: Array<[string, number]> = [];
  if (opts.victory) {
    lines.push([opts.blitz ? '极速闪击制霸' : '区域突破', opts.blitz ? 65 : 30 + opts.sector * 10]);
    if (opts.stars > 1) lines.push([`星级 ×${opts.stars}`, (opts.stars - 1) * 15]);
    if (opts.firstClear) lines.push(['首次通关', 60]);
  } else {
    lines.push([`推进 ${Math.round(opts.progress * 100)}%`, Math.round(opts.progress * 35)]);
  }
  const scoreCores =
    opts.score <= 40000
      ? Math.floor(opts.score / 250)
      : 160 + Math.floor(Math.sqrt(opts.score - 40000) * 0.34);
  lines.push(['得分换算', scoreCores]);
  const baseTotal = lines.reduce((s, l) => s + l[1], 0);
  const mutPct = Math.max(0, opts.mutatorBonusPct ?? 0);
  if (mutPct > 0 && baseTotal > 0) {
    lines.push([`突变词缀 +${mutPct}%`, Math.max(1, Math.round((baseTotal * mutPct) / 100))]);
  }
  const bountyLv = Math.max(0, opts.bountyLevel ?? 0);
  if (bountyLv > 0 && baseTotal > 0) {
    const bonus = Math.max(1, Math.round(baseTotal * bountyLv * 0.18)) + (opts.victory ? bountyLv * 6 : 0);
    lines.push([`晶核萃取 +${bountyLv * 18}%`, bonus]);
  }
  const total = lines.reduce((s, l) => s + l[1], 0);
  return { total, lines };
}

export interface DamageBreakdownRow {
  key: DamageSourceKey | 'other';
  label: string;
  glyph: string;
  color: string;
  damage: number;
  pct: number;
}

const SOURCE_LABELS: Record<DamageSourceKey, { label: string; glyph: string; color: string }> = {
  pulse: { label: '棱光脉冲', glyph: '❙❙', color: '#3ef3ff' },
  scatter: { label: '折射散弹', glyph: '⋰⋱', color: '#7dff6b' },
  rail: { label: '超导贯穿', glyph: '➤', color: '#b98cff' },
  plasma: { label: '新星迫击', glyph: '✹', color: '#ff9a3c' },
  cryo: { label: '绝对零度', glyph: '❄', color: '#8fdcff' },
  blades: { label: '环轨护卫刃', glyph: '✦', color: '#ffd84a' },
  fusions: { label: '超武聚变 & 电弧', glyph: '🌌', color: '#e28cff' },
  deflect: { label: '棱球反击 & 破防', glyph: '⚡', color: '#19f5a8' },
  explosives: { label: '跳台震地 & 爆破', glyph: '💥', color: '#ffc531' },
};

export function computeDamageBreakdown(
  src: Readonly<Record<DamageSourceKey, number>> | undefined,
): DamageBreakdownRow[] {
  if (!src) return [];
  const entries = (Object.keys(SOURCE_LABELS) as DamageSourceKey[])
    .map((k) => ({ key: k, damage: Math.round(src[k] ?? 0), ...SOURCE_LABELS[k] }))
    .filter((r) => r.damage > 0)
    .sort((a, b) => b.damage - a.damage);
  const sum = entries.reduce((s, r) => s + r.damage, 0);
  if (sum <= 0) return [];
  if (entries.length <= 4) {
    return entries.map((r) => ({
      ...r,
      pct: Math.max(1, Math.round((r.damage / sum) * 100)),
    }));
  }
  const top4 = entries.slice(0, 4);
  const otherDmg = entries.slice(4).reduce((s, r) => s + r.damage, 0);
  const rows: DamageBreakdownRow[] = top4.map((r) => ({
    ...r,
    pct: Math.max(1, Math.round((r.damage / sum) * 100)),
  }));
  if (otherDmg > 0) {
    const topPctSum = rows.reduce((s, r) => s + r.pct, 0);
    rows.push({
      key: 'other',
      label: '其他协同伤害',
      glyph: '◈',
      color: '#9fb3d2',
      damage: otherDmg,
      pct: Math.max(1, 100 - topPctSum),
    });
  }
  return rows;
}

export interface BuildArchetypeSummary {
  glyph: string;
  title: string;
  tags: string;
  color: string;
}

export function computeBuildArchetype(snap: SimSnapshot, maxCombo: number): BuildArchetypeSummary {
  const fusions = snap.activeFusions ?? [];
  const muts = snap.mutators ?? [];
  const mutTag = muts.length
    ? ` · ${muts.map((m) => MUTATORS.find((x) => x.id === m)?.name ?? m).join('+')}`
    : '';
  const unlockedCount = Object.values(snap.arsenal ?? {}).filter((v) => v > 0).length;

  if (fusions.length >= 2) {
    return {
      glyph: '👑',
      title: '双核超武 · 万象神罚统帅',
      tags: `${fusions.map((f) => FUSIONS[f].name).join(' + ')}${mutTag}`,
      color: '#ffd84a',
    };
  }
  if (fusions.includes('cryo_singularity')) {
    return {
      glyph: '🌌',
      title: '极寒奇点 · 坍缩湮灭统帅',
      tags: `极寒黑洞炮 · ${unlockedCount}核专精构筑${mutTag}`,
      color: '#b98cff',
    };
  }
  if (fusions.includes('prism_ricochet_web')) {
    return {
      glyph: '🕸',
      title: '棱镜天网 · 折跃电弧宗师',
      tags: `棱镜折射电网 · ${unlockedCount}核专精构筑${mutTag}`,
      color: '#7dff6b',
    };
  }
  if (fusions.includes('seeker_sword_array')) {
    return {
      glyph: '⚔',
      title: '御剑蜂群 · 浮游剑阵统领',
      tags: `自律浮游剑阵 · 飞刃×${snap.bladesCount}${mutTag}`,
      color: '#3ef3ff',
    };
  }
  if (snap.activeDualSynergy) {
    const ds = DUAL_SYNERGIES[snap.activeDualSynergy];
    return {
      glyph: ds.glyph,
      title: `${ds.name} · 双武战术统帅`,
      tags: `${ds.recipeText} · 峰值 ${snap.stats.peakSquad} 人${mutTag}`,
      color: ds.color,
    };
  }
  if ((snap.damageBySource?.deflect ?? 0) >= 1200) {
    return {
      glyph: '⚡',
      title: '逆转乾坤 · 破甲反击大师',
      tags: `首领棱球反击 · 最高 ${maxCombo} 连杀${mutTag}`,
      color: '#19f5a8',
    };
  }
  if (unlockedCount >= 3) {
    return {
      glyph: '🔥',
      title: '全武矩阵 · 霓虹弹幕暴君',
      tags: `${unlockedCount} 重武装协同齐射 · 峰值 ${snap.stats.peakSquad} 人${mutTag}`,
      color: '#ff9a3c',
    };
  }
  const lead = REWARD_META[snap.weapon];
  return {
    glyph: lead.glyph,
    title: `${lead.name} · 锋矢突击先锋`,
    tags: `Lv.${snap.weaponLevel} 主炮 · 峰值 ${snap.stats.peakSquad} 人${mutTag}`,
    color: lead.color,
  };
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
  pantheonCleared?: boolean;
  maxHeatCleared?: number;
  expeditionCleared?: boolean;
  nemesisDefeated?: boolean;
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
  { id: 'ach-pantheon', name: '万神殿弑神者', desc: '通关终局挑战「棱镜万神殿」四殿首领连战', glyph: '🏛', color: '#ffdf6b', reward: 160, check: (c) => Boolean(c.pantheonCleared) },
  { id: 'ach-abyss-4', name: '灾变觉醒者', desc: '在「深渊协议」热度 ≥ 4 阶（首领基因变异开启）下取得胜利', glyph: '🧬', color: '#c266ff', reward: 140, check: (c) => (c.maxHeatCleared ?? 0) >= 4 },
  { id: 'ach-expedition', name: '星图远征开拓者', desc: '完成三幕式分支星图战役「星区远征」或击退宿敌零号猎犬', glyph: '🌌', color: '#62f4ff', reward: 130, check: (c) => Boolean(c.expeditionCleared || c.nemesisDefeated) },
  { id: 'ach-abyss-10', name: '深渊十阶弑神者', desc: '征服最高难度「深渊协议 · 灾变 10 阶」终局试炼', glyph: '🔥', color: '#00ffd5', reward: 260, check: (c) => (c.maxHeatCleared ?? 0) >= 10 },
];
