import { FIXED_DT, PLAYER_Z, TRACK_HALF_WIDTH } from '../config/constants';
import type {
  ExpeditionMapState,
  ExpeditionNodeDef,
  ExpeditionNodeKind,
  ExpeditionRelicId,
  NemesisSnapshot,
  NirvanaArchetype,
  SectorId,
  SimEvent,
  TriPrismLinkSnapshot,
  WeaponId,
} from '../types/game';
import type { RunwayEncounter, SectorScriptConfig } from '../config/sectors';
import { getSectorScript } from '../config/sectors';
import { mitigateLossWithAegis } from './aegis';
import { damageBossCore } from './bosses';
import { deployReserveIfAvailable, recordDamage, spawnReflector } from './competition';
import { damageEnemy } from './enemies';
import type { SimWorld } from './entities';
import { clamp, normalizeZero } from './math';
import { addResonance } from './resonance';
import { spawnCapacitorTower, spawnMagRail } from './v20Mechanics';
import { spawnCollapseRift, spawnHighSpire, spawnTacticalEvent, spawnTacticalFormation } from './v21Mechanics';

let v23EntitySeq = 996000;
export function allocV23Id(): number {
  v23EntitySeq = v23EntitySeq >= 1040000 ? 996000 : v23EntitySeq + 1;
  return v23EntitySeq;
}

// ===========================================================================
// Stage 2A: Sector Expedition (3-Act Branching Star-Chart & Relics)
// ===========================================================================
export interface ExpeditionRelicMeta {
  readonly id: ExpeditionRelicId;
  readonly name: string;
  readonly glyph: string;
  readonly color: string;
  readonly desc: string;
}

export const EXPEDITION_RELICS: Record<ExpeditionRelicId, ExpeditionRelicMeta> = {
  relic_prism_capacitor: {
    id: 'relic_prism_capacitor',
    name: '棱镜谐振电容',
    glyph: '💠',
    color: '#62f4ff',
    desc: '折镜折射与三角谐振电网伤害 +28%，每次折射额外充能终极奥义 +2.5%！',
  },
  relic_hunter_fang: {
    id: 'relic_hunter_fang',
    name: '零号猎犬破极獠牙',
    glyph: '🐺',
    color: '#ff4b78',
    desc: '切换领衔主武后 4.0s 内暴击率 +25%、破盾与首领部位伤害 ×1.35！',
  },
  relic_nirvana_core: {
    id: 'relic_nirvana_core',
    name: '超限涅槃炉心',
    glyph: '☀️',
    color: '#ffd84a',
    desc: '每幕开局自动获得 50% 终极奥义充能，释放二阶终极奥义额外扩编 +12 人！',
  },
  relic_nano_reserve: {
    id: 'relic_nano_reserve',
    name: '星舰纳米兵舱',
    glyph: '🧬',
    color: '#19f5a8',
    desc: '每跨过一个远征星图节点额外补员 +18 人并存入 +15 储备兵！',
  },
};

export const EXPEDITION_NODE_META: Record<
  ExpeditionNodeKind,
  { name: string; title: string; subtitle: string; glyph: string; color: string; bonusDesc: string }
> = {
  prism_lab: {
    name: '高压折镜试验场',
    title: '高压折镜试验场',
    subtitle: '密集 45° 折镜走廊 · 折射奥义极速充能',
    glyph: '🪞',
    color: '#62f4ff',
    bonusDesc: '通关奖励：棱镜晶核 +28 · 必出高阶能量舱',
  },
  black_market: {
    name: '黑市超频改装站',
    title: '黑市超频改装站',
    subtitle: '双能量舱补给线 · 开局扩编与武装直升',
    glyph: '🛠',
    color: '#ffd84a',
    bonusDesc: '通关奖励：随机远征遗物 ×1 · 蜂群扩编 +16',
  },
  cargo_intercept: {
    name: '失控货运车阻击点',
    title: '失控货运车阻击点',
    subtitle: '高价值装甲车队 · 限时集火夺取反应堆核心',
    glyph: '🚚',
    color: '#19f5a8',
    bonusDesc: '通关奖励：核心反应堆直升 1 阶 · 晶核 +35',
  },
  abyss_ambush: {
    name: '深渊精英伏击区',
    title: '深渊精英伏击区',
    subtitle: '跨兵种协同编队 + 宿敌零号猎犬高概率乱入',
    glyph: '⚔',
    color: '#ff4b78',
    bonusDesc: '通关奖励：猎犬专属遗物 · 结算得分 +35%',
  },
  core_forge: {
    name: '跨幕核心熔铸台',
    title: '跨幕核心熔铸台',
    subtitle: '幕终镇守首领决战 · 解锁下一星幕跃迁门',
    glyph: '👑',
    color: '#c44dff',
    bonusDesc: '通关奖励：幕终首领大奖 +65 晶核 · 晋升下一幕',
  },
};

function seededHash(seed: number, salt: number): number {
  let x = ((seed ^ (salt * 0x9e3779b9)) >>> 0) || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967296;
}

/** Generates a 3-Act branching Star-Chart (each Act has 4 columns: Entry[1] -> BranchA[2] -> BranchB[2] -> ActBoss[1] = 6 nodes/act, 18 nodes total, or compact 3-Act × 3-Step = 12 nodes so all 3 Acts fit cleanly in one Star-Chart viewport!) */
export function getExpeditionNodes(seed: number): ExpeditionNodeDef[] {
  const cleanSeed = Math.max(1, Math.floor(seed || 202623));
  const nodes: ExpeditionNodeDef[] = [];
  const pool: ExpeditionNodeKind[] = ['prism_lab', 'black_market', 'cargo_intercept', 'abyss_ambush'];

  for (let act = 1 as 1 | 2 | 3; act <= 3; act = (act + 1) as 1 | 2 | 3) {
    const baseCol = (act - 1) * 3;
    const leftId = `a${act}_0`;
    const rightId = `a${act}_1`;
    const midAId = `a${act}_2`;
    const midBId = `a${act}_3`;
    const bossId = `a${act}_boss`;

    const k0 = pool[Math.floor(seededHash(cleanSeed, act * 11 + 1) * pool.length)]!;
    let k1 = pool[Math.floor(seededHash(cleanSeed, act * 11 + 2) * pool.length)]!;
    if (k1 === k0) k1 = pool[(pool.indexOf(k0) + 1) % pool.length]!;

    const k2 = pool[Math.floor(seededHash(cleanSeed, act * 11 + 3) * pool.length)]!;
    let k3 = pool[Math.floor(seededHash(cleanSeed, act * 11 + 4) * pool.length)]!;
    if (k3 === k2) k3 = pool[(pool.indexOf(k2) + 2) % pool.length]!;

    nodes.push(
      {
        id: leftId,
        act,
        col: baseCol,
        lane: 0,
        kind: k0,
        sectorTheme: act as SectorId,
        nemesisRisk: k0 === 'abyss_ambush',
        nextIds: [midAId, midBId],
      },
      {
        id: rightId,
        act,
        col: baseCol,
        lane: 1,
        kind: k1,
        sectorTheme: act as SectorId,
        nemesisRisk: k1 === 'abyss_ambush',
        nextIds: [midAId, midBId],
      },
      {
        id: midAId,
        act,
        col: baseCol + 1,
        lane: 0,
        kind: k2,
        sectorTheme: act as SectorId,
        nemesisRisk: true,
        nextIds: [bossId],
      },
      {
        id: midBId,
        act,
        col: baseCol + 1,
        lane: 1,
        kind: k3,
        sectorTheme: act as SectorId,
        nemesisRisk: k3 === 'abyss_ambush' || act >= 2,
        nextIds: [bossId],
      },
      {
        id: bossId,
        act,
        col: baseCol + 2,
        lane: 0.5,
        kind: 'core_forge',
        sectorTheme: act as SectorId,
        nemesisRisk: act === 3,
        nextIds: act < 3 ? [`a${act + 1}_0`, `a${act + 1}_1`] : [],
      },
    );
  }

  return nodes;
}

export function generateExpeditionMap(seed: number): ExpeditionMapState {
  const cleanSeed = Math.max(1, Math.floor(seed || 202623));
  void getExpeditionNodes(cleanSeed);
  return {
    seed: cleanSeed,
    act: 1,
    currentNodeId: null,
    clearedNodeIds: [],
    availableNodeIds: ['a1_0', 'a1_1'],
    carrySquad: 26,
    carryWeapon: 'pulse',
    carryPartner: 'rail',
    relics: [],
    completed: false,
  };
}

export function pickExpeditionRelicDrop(owned: readonly ExpeditionRelicId[], salt: number): ExpeditionRelicId {
  const all: ExpeditionRelicId[] = [
    'relic_prism_capacitor',
    'relic_hunter_fang',
    'relic_nirvana_core',
    'relic_nano_reserve',
  ];
  const unowned = all.filter((r) => !owned.includes(r));
  const pool = unowned.length > 0 ? unowned : all;
  return pool[Math.abs(Math.floor(salt)) % pool.length]!;
}

export function advanceExpeditionAfterVictory(
  map: ExpeditionMapState,
  nodes: readonly ExpeditionNodeDef[],
  finalSquad: number,
  leadWeapon: WeaponId,
  partnerWeapon: WeaponId,
  salt: number,
): ExpeditionMapState {
  const curId = map.currentNodeId ?? map.availableNodeIds[0] ?? null;
  const curNode = nodes.find((n) => n.id === curId) ?? null;
  const cleared = curId && !map.clearedNodeIds.includes(curId) ? [...map.clearedNodeIds, curId] : [...map.clearedNodeIds];
  const nextAvail = curNode ? [...curNode.nextIds] : [];
  const completed = Boolean(curNode && curNode.act === 3 && curNode.kind === 'core_forge');
  const nextAct = completed ? 3 : curNode && curNode.kind === 'core_forge' && curNode.act < 3 ? ((curNode.act + 1) as 1 | 2 | 3) : map.act;
  const relics = [...map.relics];
  if (curNode && (curNode.kind === 'black_market' || curNode.kind === 'core_forge' || curNode.kind === 'abyss_ambush')) {
    const drop = pickExpeditionRelicDrop(relics, salt);
    if (!relics.includes(drop)) relics.push(drop);
  }
  return {
    ...map,
    act: nextAct,
    currentNodeId: null,
    clearedNodeIds: cleared,
    availableNodeIds: completed ? [] : nextAvail,
    carrySquad: Math.max(22, Math.min(220, Math.round(finalSquad * 0.42) + 18)),
    carryWeapon: leadWeapon,
    carryPartner: partnerWeapon === leadWeapon ? 'rail' : partnerWeapon,
    relics,
    completed,
  };
}

export function buildExpeditionNodeScript(
  node: ExpeditionNodeDef,
  seed: number,
  carrySquad: number,
): SectorScriptConfig {
  const base = getSectorScript(node.sectorTheme, seed + node.col * 97);
  const isBossNode = node.kind === 'core_forge';
  const runwayLength = isBossNode ? 290 : 230;
  const trimmed: RunwayEncounter[] = base.encounters
    .filter((e) => e.crossDist < runwayLength - 28)
    .map((e) => ({ ...e }));

  if (node.kind === 'prism_lab') {
    for (let d = 58; d < runwayLength - 36; d += 48) {
      trimmed.push({ type: 'reflector', crossDist: d, x: d % 96 === 58 ? -2.6 : 2.6, lean: d % 96 === 58 ? 1 : -1 });
      trimmed.push({ type: 'lens', crossDist: d + 18, x: 0 });
    }
  } else if (node.kind === 'black_market') {
    const rewards: WeaponId[] = ['rail', 'scatter', 'plasma', 'cryo'];
    trimmed.push(
      { type: 'vault', crossDist: 72, x: -2.1, hp: 48, reward: rewards[seed % rewards.length]! },
      { type: 'vault', crossDist: 144, x: 2.1, hp: 62, reward: rewards[(seed + 2) % rewards.length]! },
    );
  }
  trimmed.sort((a, b) => a.crossDist - b.crossDist);

  return {
    ...base,
    name: `星区远征 · 第${node.act}幕 · ${EXPEDITION_NODE_META[node.kind].title}`,
    subtitle: EXPEDITION_NODE_META[node.kind].subtitle,
    runwayLength,
    startSquad: Math.max(16, Math.min(260, carrySquad)),
    boss: {
      ...base.boss,
      maxHp: Math.round(base.boss.maxHp * (isBossNode ? 0.95 + node.act * 0.18 : 0.62)),
    },
    encounters: trimmed,
  };
}

// ===========================================================================
// Stage 2B: Dynamic Nemesis Ambush ("PRISM HUNTER · 零号猎犬")
// ===========================================================================
export function spawnNemesisPursuer(world: SimWorld, events: SimEvent[]): void {
  if (world.mods.fairTrial || world.nemesis) return;
  const baseHp = Math.max(620, Math.round(world.trueSquadDps * 5.2));
  world.nemesis = {
    id: allocV23Id(),
    name: 'PRISM HUNTER · 零号猎犬',
    x: 0,
    z: -34,
    targetX: 0,
    hp: baseHp,
    maxHp: baseHp,
    adaptedWeapon: world.weapon,
    adaptExposure: 0,
    shieldBrokenTimer: 0,
    attackTimer: 3.1,
    dashTelegraph: 0,
    hitPulse: 0,
    active: true,
  };
  events.push({
    type: 'NEMESIS_AMBUSH',
    name: 'PRISM HUNTER · 零号猎犬',
    adaptedWeapon: world.weapon,
    x: 0,
    z: -22,
  });
}

export function damageNemesis(
  world: SimWorld,
  rawDamage: number,
  weapon: WeaponId,
  amplified: boolean,
  events: SimEvent[],
): boolean {
  const nem = world.nemesis;
  if (!nem || !nem.active || nem.hp <= 0) return false;

  let mult = 1.0;
  if (nem.shieldBrokenTimer > 0) {
    mult = 1.85;
  } else if (amplified || weapon !== nem.adaptedWeapon) {
    // Counterplay! Switching dual-weapon [Tab/C] OR refracting off 45°/Wingman Mirror shatters polarized shield!
    mult = amplified ? 2.45 : 1.75;
    nem.adaptExposure += rawDamage * 1.4;
    if (nem.adaptExposure >= nem.maxHp * 0.16) {
      nem.shieldBrokenTimer = 4.2;
      nem.adaptExposure = 0;
      events.push({ type: 'NEMESIS_SHIELD_BREAK', x: nem.x, z: nem.z, newWeakness: weapon });
    }
  } else {
    // Polarized shield resists current un-swapped direct weapon!
    mult = 0.24;
  }

  const finalDmg = Math.max(1, rawDamage * mult);
  nem.hp = Math.max(0, nem.hp - finalDmg);
  nem.hitPulse = 1.0;
  recordDamage(world, amplified ? 'deflect' : weapon, finalDmg);

  if (nem.hp <= 0) {
    nem.active = false;
    const relicPool: ExpeditionRelicId[] = [
      'relic_hunter_fang',
      'relic_prism_capacitor',
      'relic_nirvana_core',
      'relic_nano_reserve',
    ];
    const dropped = relicPool[(Math.floor(world.simTime * 7) + world.stats.kills) % relicPool.length]!;
    world.squadCount = Math.min(999, world.squadCount + 22);
    world.collectedShards += 18;
    world.nirvanaCharge = Math.min(1, world.nirvanaCharge + 0.45);
    events.push({
      type: 'NEMESIS_DEFEAT',
      x: nem.x,
      z: nem.z,
      relicId: dropped,
      bonusSquad: 22,
    });
    world.nemesis = null;
  }
  return true;
}

// ===========================================================================
// Stage 3: Tri-Prism Resonance Lattice & Overlimit Nirvana Burst [G / LB+RB]
// ===========================================================================
export function resolveNirvanaArchetype(worldOrWeapon: SimWorld | WeaponId, partnerWeapon?: WeaponId | null): NirvanaArchetype {
  const loadout: WeaponId[] =
    typeof worldOrWeapon === 'string'
      ? partnerWeapon
        ? [worldOrWeapon, partnerWeapon]
        : [worldOrWeapon]
      : worldOrWeapon.activeLoadout.length > 0
        ? worldOrWeapon.activeLoadout
        : [worldOrWeapon.weapon];
  const primary: WeaponId = typeof worldOrWeapon === 'string' ? worldOrWeapon : worldOrWeapon.weapon;
  if (loadout.includes('cryo') || primary === 'cryo') {
    return 'absolute_zero_storm';
  }
  if (loadout.includes('plasma') || primary === 'plasma') {
    return 'singularity_supernova';
  }
  return 'prism_kaleidoscope';
}

export const NIRVANA_META: Record<NirvanaArchetype, { name: string; short: string; glyph: string; color: string; hex: number }> = {
  prism_kaleidoscope: {
    name: '万花筒折镜终焉齐射',
    short: '万花筒',
    glyph: '💠',
    color: '#62f4ff',
    hex: 0x62f4ff,
  },
  singularity_supernova: {
    name: '引力奇点坍缩新星',
    short: '奇点新星',
    glyph: '☀️',
    color: '#ff9a3c',
    hex: 0xff9a3c,
  },
  absolute_zero_storm: {
    name: '绝对零度碎屏风暴',
    short: '零度风暴',
    glyph: '❄️',
    color: '#8ef4ff',
    hex: 0x8ef4ff,
  },
};

export function addNirvanaCharge(world: SimWorld, amount: number): void {
  if (world.mods.fairTrial || amount <= 0) return;
  // Lock self-refund only on the initial 0.75s detonation window (`nirvanaActiveTimer > 1.85`)
  if (world.nirvanaActiveTimer > 1.85) return;
  const relicMult = world.mods.expeditionRelics?.includes('relic_prism_capacitor') ? 1.35 : 1.0;
  world.nirvanaCharge = clamp(world.nirvanaCharge + amount * relicMult, 0, 1);
}

export function registerTriPrismRefraction(world: SimWorld, hitWingmanMirror: boolean, events: SimEvent[]): void {
  if (world.mods.fairTrial) return;
  if (hitWingmanMirror) {
    world.lastWingmanMirrorTick = Math.round(world.simTime * 60);
  } else {
    world.lastFixedMirrorTick = Math.round(world.simTime * 60);
  }
  const tickNow = Math.round(world.simTime * 60);
  const chainedBoth =
    Math.abs(world.lastWingmanMirrorTick - world.lastFixedMirrorTick) <= 50 &&
    world.lastWingmanMirrorTick > 0 &&
    world.lastFixedMirrorTick > 0;

  // Charge Nirvana gauge rapidly on every refracted hit, and 3.5x faster when chaining Wingman + Fixed 45° Mirror!
  const hasCapRelic = world.mods.expeditionRelics?.includes('relic_prism_capacitor') ?? false;
  const gain = (chainedBoth ? 0.14 : 0.042) * (hasCapRelic ? 1.35 : 1.0);
  if (world.nirvanaActiveTimer <= 1.85) {
    world.nirvanaCharge = clamp(world.nirvanaCharge + gain, 0, 1);
  }
  world.v23RefractedDmg = (world.v23RefractedDmg ?? 0) + Math.max(12, world.trueSquadDps * (chainedBoth ? 0.16 : 0.06));

  if (chainedBoth && world.wingmanFormation === 'forward_mirror') {
    const wasOffline = world.triPrismLatticeTimer <= 0.05;
    world.triPrismLatticeTimer = 4.6;
    if (wasOffline && tickNow > 5) {
      events.push({
        type: 'TRI_PRISM_LATTICE_ONLINE',
        x: world.squadX,
        z: PLAYER_Z - 6.5,
        duration: 4.6,
      });
    }
  }
}

export function tryTriggerNirvanaBurst(world: SimWorld, events: SimEvent[]): boolean {
  if (world.mods.fairTrial) return false;
  if (world.squadCount <= 0) return false;
  if (world.nirvanaCharge < 0.999 && !world.isFiringRange) return false;

  const arch = resolveNirvanaArchetype(world);
  world.nirvanaCharge = 0;
  world.nirvanaActiveTimer = 2.6;
  world.nirvanaArchetype = arch;

  const baseBlast = Math.max(320, Math.round(world.trueSquadDps * 4.4));
  let kills = 0;

  // Sweep all active enemies on the highway with archetype-specific devastation
  for (let i = 0; i < world.enemies.length; i++) {
    const e = world.enemies[i]!;
    if (!e.active || e.consumed || e.hp <= 0 || e.z < -82) continue;
    if (arch === 'absolute_zero_storm') {
      e.slowTimer = Math.max(e.slowTimer, 4.5);
      e.armorBroken = true;
      e.shieldHp = 0;
    }
    const dealt = Math.min(e.hp, baseBlast);
    recordDamage(world, 'fusions', dealt);
    world.v23NirvanaDmg = (world.v23NirvanaDmg ?? 0) + dealt;
    const prevHp = e.hp;
    damageEnemy(world, e, baseBlast, 1.4, events, { bypassShield: true, weapon: world.weapon });
    if (prevHp > 0 && (e.hp <= 0 || !e.active || e.consumed)) kills++;
  }

  // Heavy Boss & Nemesis core strike
  let bossDmg = 0;
  if (world.boss && world.boss.active && world.boss.hp > 0) {
    bossDmg = Math.max(420, Math.round(world.boss.maxHp * 0.16));
    if (arch === 'absolute_zero_storm') {
      world.boss.hazardZones.length = 0;
      world.boss.breakTimer = Math.max(world.boss.breakTimer ?? 0, 3.5);
    }
    recordDamage(world, 'fusions', bossDmg);
    world.v23NirvanaDmg = (world.v23NirvanaDmg ?? 0) + bossDmg;
    damageBossCore(world, false, bossDmg, events);
  }
  if (world.nemesis && world.nemesis.active) {
    damageNemesis(world, baseBlast * 1.4, world.weapon, true, events);
  }

  if (arch === 'prism_kaleidoscope') {
    // Fan 18 chromatic prism bolts across the runway
    for (let k = 0; k < 18; k++) {
      const p = world.projectilePool.acquire();
      p.id = allocV23Id();
      p.weapon = k % 2 === 0 ? 'rail' : 'scatter';
      p.radius = 0.28;
      p.damage = Math.max(28, world.trueSquadDps * 0.25);
      p.remainingPierce = 4;
      p.amplified = true;
      p.powerScale = 1.45;
      p.hostile = false;
      p.hostileLoss = 0;
      p.distanceTraveled = 0;
      p.maxRange = 78;
      p.splashRadius = 0;
      p.splashDamageRatio = 0;
      p.cryoSlowDuration = 0;
      p.sweepStartFraction = 0;
      const spreadAngle = ((k - 8.5) / 8.5) * 0.48;
      p.vx = Math.sin(spreadAngle) * 44;
      p.vz = -Math.cos(spreadAngle) * 48;
      p.prevX = world.squadX;
      p.prevZ = PLAYER_Z - 1.2;
      p.x = world.squadX;
      p.z = PLAYER_Z - 1.2;
      p.active = true;
      world.projectiles.push(p);
    }
    world.triPrismLatticeTimer = Math.max(world.triPrismLatticeTimer, 5.2);
  } else if (arch === 'singularity_supernova') {
    world.singularities.push({
      id: allocV23Id(),
      x: 0,
      z: -16.5,
      radius: 6.2,
      timer: 4.0,
      tickAcc: 0.1,
      maxTimer: 4.0,
    });
  }

  if (world.mods.expeditionRelics?.includes('relic_nirvana_core')) {
    world.squadCount = Math.min(999, world.squadCount + 12);
  }
  addResonance(world, 0.45, events);

  events.push({
    type: 'OVERLIMIT_NIRVANA_BURST',
    archetype: arch,
    kills,
    bossDamage: bossDmg,
    x: world.squadX,
    z: -15.5,
  });
  return true;
}

export function stepV23Systems(world: SimWorld, events: SimEvent[]): void {
  if (world.mods.fairTrial) return;

  // 1. Fast Nirvana passive recharge across all non-FairTrial modes, further supercharged by Reactor, Overdrive & Lattice
  if (world.nirvanaActiveTimer > 0) {
    world.nirvanaActiveTimer = Math.max(0, world.nirvanaActiveTimer - FIXED_DT);
  }
  if (world.nirvanaActiveTimer <= 1.85 && world.nirvanaCharge < 1 && world.squadCount > 0) {
    let rate = 0.052;
    if (world.isFiringRange) {
      rate = 0.75;
    } else if (world.triPrismLatticeTimer > 0) {
      rate = 0.22;
    } else if (Boolean(world.overlimitResonance) || world.coreReactorTier >= 2) {
      rate = 0.135;
    } else if (world.overdriveTimer > 0 || world.coreReactorTier >= 1) {
      rate = 0.092;
    }
    world.nirvanaCharge = clamp(world.nirvanaCharge + rate * FIXED_DT, 0, 1);
  }

  // 2. Tri-Prism Resonance Lattice Cutter (Wingman Forward Mirrors <-> Runway Fixed 45° Reflector)
  const links: TriPrismLinkSnapshot[] = [];
  if (world.triPrismLatticeTimer > 0 && world.wingmanId && world.wingmanFormation === 'forward_mirror') {
    world.triPrismLatticeTimer = Math.max(0, world.triPrismLatticeTimer - FIXED_DT);
    const lx = world.wingmanLeftPos.x;
    const lz = world.wingmanLeftPos.z;
    const rx = world.wingmanRightPos.x;
    const rz = world.wingmanRightPos.z;

    // Connect Left <-> Right Wingman Mirrors + nearest Fixed Runway Reflector within z [-38, PLAYER_Z]
    links.push({ x1: lx, z1: lz, x2: rx, z2: rz });
    let anchorRf: { x: number; z: number } | null = null;
    let bestDz = 999;
    for (let i = 0; i < world.reflectors.length; i++) {
      const rf = world.reflectors[i]!;
      if (!rf.active || rf.isWingmanMirror || rf.z < -38 || rf.z > PLAYER_Z) continue;
      const dz = Math.abs(rf.z - (lz - 8));
      if (dz < bestDz) {
        bestDz = dz;
        anchorRf = { x: rf.x, z: rf.z };
      }
    }
    if (anchorRf) {
      links.push(
        { x1: lx, z1: lz, x2: anchorRf.x, z2: anchorRf.z },
        { x1: rx, z1: rz, x2: anchorRf.x, z2: anchorRf.z },
      );
    }

    world.triPrismTickTimer -= FIXED_DT;
    if (world.triPrismTickTimer <= 0) {
      world.triPrismTickTimer = 0.16;
      const relicBoost = world.mods.expeditionRelics?.includes('relic_prism_capacitor') ? 1.28 : 1.0;
      const cutDmg = Math.max(14, world.trueSquadDps * 0.24 * relicBoost);
      for (let eIdx = 0; eIdx < world.enemies.length; eIdx++) {
        const e = world.enemies[eIdx]!;
        if (!e.active || e.consumed || e.hp <= 0) continue;
        // Check proximity to any lattice beam segment
        let hit = false;
        for (let s = 0; s < links.length; s++) {
          const seg = links[s]!;
          const vx = seg.x2 - seg.x1;
          const vz = seg.z2 - seg.z1;
          const len2 = Math.max(0.01, vx * vx + vz * vz);
          const t = clamp(((e.x - seg.x1) * vx + (e.z - seg.z1) * vz) / len2, 0, 1);
          const px = seg.x1 + vx * t;
          const pz = seg.z1 + vz * t;
          if (Math.hypot(e.x - px, e.z - pz) <= e.radius + 0.85) {
            hit = true;
            break;
          }
        }
        if (hit) {
          const dealt = Math.min(e.hp, cutDmg);
          recordDamage(world, 'fusions', dealt);
          world.v23LatticeDmg = (world.v23LatticeDmg ?? 0) + dealt;
          damageEnemy(world, e, cutDmg, 0.5, events, { bypassShield: true, weapon: 'rail' });
        }
      }
    }
  }
  world.triPrismLinks = links;

  // 3. Expedition Node Set-Piece Injection (Cargo Intercept)
  if (world.mods.expeditionNodeKind === 'cargo_intercept' && !world.nemesisSpawned && world.runwayProgress >= 0.28) {
    world.nemesisSpawned = true;
    spawnTacticalEvent(world, 'runaway_cart', -1.8, -42);
    spawnTacticalEvent(world, 'supply_beacon', 1.9, -36);
  }

  // 4. Custom Track Blueprint Runtime Set-Piece Spawner
  if (world.mods.customTrackProps && world.mods.customTrackProps.length > 0) {
    for (const item of world.mods.customTrackProps) {
      if (!item.spawned && world.scrollDistance + 52 >= item.dist) {
        item.spawned = true;
        const spawnZ = PLAYER_Z - (item.dist - world.scrollDistance);
        if (item.kind === 'reflector') {
          spawnReflector(world, item.x, spawnZ, world.currentScrollSpeed, (item.angleDeg ?? 36) >= 0 ? 1 : -1);
          const lastRf = world.reflectors[world.reflectors.length - 1];
          if (lastRf && item.angleDeg !== undefined) lastRf.angleDeg = item.angleDeg;
        } else if (item.kind === 'mag_rail') {
          spawnMagRail(world, item.x, spawnZ, 18, item.x >= 0 ? 1 : -1);
        } else if (item.kind === 'cap_tower') {
          spawnCapacitorTower(world, item.x, spawnZ, 0);
        } else if (item.kind === 'bridge_gap') {
          spawnCollapseRift(world, item.x, spawnZ, 6.5, 'bridge_gap');
        } else if (item.kind === 'high_spire') {
          spawnHighSpire(world, item.x, spawnZ, 420);
        }
      }
    }
  }

  // 5. Dynamic Nemesis Ambush Trigger & AI ("PRISM HUNTER · 零号猎犬")
  const shouldSpawnNemesis =
    !world.isFiringRange &&
    !world.nemesisSpawned &&
    !world.boss &&
    world.runwayProgress >= 0.42 &&
    world.runwayProgress <= 0.78 &&
    (Boolean(world.mods.forceNemesisAmbush) ||
      world.mods.expeditionNodeKind === 'abyss_ambush' ||
      (world.abyssalHeat >= 6 && world.rampageStacks >= 18));

  if (shouldSpawnNemesis) {
    world.nemesisSpawned = true;
    spawnNemesisPursuer(world, events);
  }

  const nem = world.nemesis;
  if (nem && nem.active) {
    nem.z = Math.min(-11.5, nem.z + 18.0 * FIXED_DT);
    nem.targetX = Math.sin(world.simTime * 2.1) * 3.1;
    nem.x = normalizeZero(clamp(nem.x + (nem.targetX - nem.x) * 4.5 * FIXED_DT, -3.8, 3.8));
    if (nem.hitPulse > 0) nem.hitPulse = Math.max(0, nem.hitPulse - 3.2 * FIXED_DT);
    if (nem.shieldBrokenTimer > 0) {
      nem.shieldBrokenTimer = Math.max(0, nem.shieldBrokenTimer - FIXED_DT);
      if (nem.shieldBrokenTimer === 0) {
        // Re-polarizes to counter player's current lead weapon!
        nem.adaptedWeapon = world.weapon;
      }
    }

    nem.attackTimer -= FIXED_DT;
    if (nem.attackTimer <= 0.65 && nem.attackTimer > 0) {
      nem.dashTelegraph = clamp((0.65 - nem.attackTimer) / 0.65, 0, 1);
    } else {
      nem.dashTelegraph = 0;
    }
    if (nem.attackTimer <= 0) {
      nem.attackTimer = 3.2;
      if (Math.abs(world.squadX - nem.x) <= 1.75 && world.squadAirY <= 0.35) {
        const rawLoss = Math.max(2, Math.min(8, Math.round(world.squadCount * 0.08)));
        const loss = mitigateLossWithAegis(world, rawLoss, events);
        if (loss > 0 && world.squadCount > 2) {
          world.squadCount = Math.max(1, world.squadCount - loss);
          events.push({ type: 'SQUAD_LOSS', x: world.squadX, z: PLAYER_Z, lost: loss, reason: 'BOSS_ATTACK' });
          deployReserveIfAvailable(world, loss, events);
        }
      }
    }

    // Nemesis retreats cleanly if Boss arrives
    if (!world.isFiringRange && world.boss && world.boss.active) {
      world.nemesis = null;
    }
  }
}

export function buildNemesisSnapshot(world: SimWorld): NemesisSnapshot | null {
  const n = world.nemesis;
  if (!n || !n.active || n.hp <= 0) return null;
  return {
    id: n.id,
    name: n.name,
    x: n.x,
    z: n.z,
    hp: n.hp,
    maxHp: n.maxHp,
    adaptedWeapon: n.adaptedWeapon,
    shieldBroken: n.shieldBrokenTimer > 0,
    dashTelegraph: n.dashTelegraph,
    hitPulse: n.hitPulse,
  };
}
