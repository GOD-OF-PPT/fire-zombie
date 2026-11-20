import { FIXED_DT, PLAYER_Z, TRACK_HALF_WIDTH } from '../config/constants';
import type {
  AbyssalApexMoveKind,
  AbyssalPactId,
  SimEvent,
  WingmanFormation,
  WingmanId,
  WingmanStateSnapshot,
} from '../types/game';
import { mitigateLossWithAegis } from './aegis';
import { damageBossCore } from './bosses';
import { deployReserveIfAvailable, recordDamage } from './competition';
import { damageEnemy } from './enemies';
import type { SimReflector, SimWorld } from './entities';
import { clamp, normalizeZero } from './math';
import { addResonance } from './resonance';
import { spawnTacticalFormation } from './v21Mechanics';

let v22EntitySeq = 950000;
export function allocV22Id(): number {
  v22EntitySeq = v22EntitySeq >= 995000 ? 950000 : v22EntitySeq + 1;
  return v22EntitySeq;
}

// ===========================================================================
// Stage 2: Abyssal Protocol (Heat Tier 1–10) Pact Matrix & Boss Apex Movesets
// ===========================================================================
export interface AbyssalPactMeta {
  readonly id: AbyssalPactId;
  readonly name: string;
  readonly heat: 1 | 2;
  readonly glyph: string;
  readonly color: string;
  readonly desc: string;
}

export const ABYSSAL_PACTS: readonly AbyssalPactMeta[] = [
  {
    id: 'pact_oscillating_mirrors',
    name: '折镜周期摆动',
    heat: 1,
    glyph: '🪞',
    color: '#7dff9a',
    desc: '全场 45° 折射镜呈 ±24° 正弦周期摆动，抓准黄金折射角可触发高倍斜射清场。',
  },
  {
    id: 'pact_volatile_chain',
    name: '过热连锁极速化',
    heat: 1,
    glyph: '💥',
    color: '#ff9a3c',
    desc: '电容桶与自爆兵引信提速 2.2×、爆炸半径 +18%，近距引爆需果断走位规避。',
  },
  {
    id: 'pact_harmonic_aegis',
    name: '首领双核同频护盾',
    heat: 2,
    glyph: '🛡',
    color: '#62f4ff',
    desc: '首领周期展开同频力场（正面直击衰减至 0.32×），用 45° 折镜/僚机折镜斜射可 1.85× 破盾暴击！',
  },
  {
    id: 'pact_rift_turbulence',
    name: '裂谷引力乱流',
    heat: 2,
    glyph: '🌪',
    color: '#b98cff',
    desc: '坍缩裂谷与首领战区产生横向引力侧风（±1.35m/s），踩极性滑轨或跃空可免疫乱流。',
  },
  {
    id: 'pact_apex_mutations',
    name: '首领灾变基因变异',
    heat: 2,
    glyph: '🧬',
    color: '#ff4b78',
    desc: '总热度 ≥4 或勾选本约时解锁首领【灾变变异招式】（交叉旋转激光网 / 镜像分身齐射 / 全跑道磁暴潮汐）。',
  },
  {
    id: 'pact_elite_vanguard',
    name: '深渊双编队先遣',
    heat: 2,
    glyph: '⚔',
    color: '#ffd84a',
    desc: '精英协同编队增派重盾先遣卫队；每点灾变热度提供 +15% 晶核与结算积分加成（10 阶 +150%）！',
  },
];

export function computeAbyssalHeatTier(pacts: readonly AbyssalPactId[] | undefined): number {
  if (!pacts || pacts.length === 0) return 0;
  const seen = new Set<AbyssalPactId>();
  let total = 0;
  for (const id of pacts) {
    if (seen.has(id)) continue;
    seen.add(id);
    const meta = ABYSSAL_PACTS.find((p) => p.id === id);
    if (meta) total += meta.heat;
  }
  return clamp(total, 0, 10);
}

export function hasAbyssalPact(world: SimWorld, id: AbyssalPactId): boolean {
  if (world.mods.fairTrial) return false;
  return Boolean(world.mods.abyssalPacts && world.mods.abyssalPacts.includes(id));
}

export function isBossApexMutated(world: SimWorld): boolean {
  if (world.mods.fairTrial) return false;
  const heat = computeAbyssalHeatTier(world.mods.abyssalPacts);
  return heat >= 4 || hasAbyssalPact(world, 'pact_apex_mutations');
}

// ===========================================================================
// Stage 3: Tactical Drone Wingmen (3 Archetypes × 3 Switchable Formations)
// ===========================================================================
export interface WingmanMeta {
  readonly id: WingmanId;
  readonly name: string;
  readonly short: string;
  readonly glyph: string;
  readonly color: string;
  readonly cost: number;
  readonly desc: string;
}

export const WINGMAN_META: Record<WingmanId, WingmanMeta> = {
  prism_mirror: {
    id: 'prism_mirror',
    name: '棱镜浮游折镜机',
    short: '浮游折镜',
    glyph: '❖',
    color: '#62f4ff',
    cost: 0,
    desc: '前出架镜时在侧前方展开宽幅 45° 移动折镜（折射伤害额外 ×1.18），无折镜路段也能自主打出斜角折射！',
  },
  gravity_anchor: {
    id: 'gravity_anchor',
    name: '引力锚定僚机',
    short: '引力锚定',
    glyph: '◎',
    color: '#b98cff',
    cost: 120,
    desc: '持续将散落电容桶牵引聚拢至怪群中心，晶核磁吸半径扩大 +7.5m，随行齐射附带微重力减速。',
  },
  phase_escort: {
    id: 'phase_escort',
    name: '相位护卫僚机',
    short: '相位护卫',
    glyph: '◈',
    color: '#ffdf58',
    cost: 140,
    desc: '环轨护卫时加速相位脉冲冷却 +30%，每次触发脉冲或完美弹反时同步发射双道交叉反击光束重创首领！',
  },
};

export const WINGMAN_FORMATION_LABELS: Record<WingmanFormation, { name: string; short: string; glyph: string }> = {
  volley_sync: { name: '随行齐射阵', short: '随行齐射', glyph: '⇈' },
  forward_mirror: { name: '前出架镜阵', short: '前出架镜', glyph: '⟋⟍' },
  orbit_guard: { name: '环轨护卫阵', short: '环轨护卫', glyph: '⟳' },
};

export function cycleWingmanFormation(world: SimWorld, events: SimEvent[]): void {
  const wm = world.wingmanId;
  if (!wm) return;
  const order: WingmanFormation[] = ['volley_sync', 'forward_mirror', 'orbit_guard'];
  const idx = order.indexOf(world.wingmanFormation);
  const next = order[(idx + 1) % order.length]!;
  world.wingmanFormation = next;
  events.push({
    type: 'WINGMAN_FORMATION_SHIFT',
    wingman: wm,
    formation: next,
  });
}

function syncWingmanMirrors(
  world: SimWorld,
  active: boolean,
  lx: number,
  lz: number,
  rx: number,
  rz: number,
): void {
  if (!active) {
    for (let i = world.reflectors.length - 1; i >= 0; i--) {
      if (world.reflectors[i]?.isWingmanMirror) {
        world.reflectors.splice(i, 1);
      }
    }
    return;
  }

  const isPrismSpec = world.wingmanId === 'prism_mirror';
  const hw = isPrismSpec ? 1.38 : 0.96;
  let leftMirror: SimReflector | null = null;
  let rightMirror: SimReflector | null = null;

  for (let i = 0; i < world.reflectors.length; i++) {
    const rf = world.reflectors[i]!;
    if (rf.isWingmanMirror) {
      if (rf.lean === 1 && !leftMirror) leftMirror = rf;
      else if (rf.lean === -1 && !rightMirror) rightMirror = rf;
    }
  }

  if (!leftMirror) {
    leftMirror = {
      id: allocV22Id(),
      prevX: lx,
      prevZ: lz,
      x: lx,
      z: lz,
      vz: 0,
      lean: 1,
      angleDeg: 34,
      halfWidth: hw,
      halfDepth: 0.42,
      pulse: 0,
      active: true,
      isWingmanMirror: true,
    };
    world.reflectors.push(leftMirror);
  } else {
    leftMirror.prevX = leftMirror.x;
    leftMirror.prevZ = leftMirror.z;
    leftMirror.x = lx;
    leftMirror.z = lz;
    leftMirror.halfWidth = hw;
    leftMirror.angleDeg = 34;
    leftMirror.active = true;
  }

  if (!rightMirror) {
    rightMirror = {
      id: allocV22Id(),
      prevX: rx,
      prevZ: rz,
      x: rx,
      z: rz,
      vz: 0,
      lean: -1,
      angleDeg: -34,
      halfWidth: hw,
      halfDepth: 0.42,
      pulse: 0,
      active: true,
      isWingmanMirror: true,
    };
    world.reflectors.push(rightMirror);
  } else {
    rightMirror.prevX = rightMirror.x;
    rightMirror.prevZ = rightMirror.z;
    rightMirror.x = rx;
    rightMirror.z = rz;
    rightMirror.halfWidth = hw;
    rightMirror.angleDeg = -34;
    rightMirror.active = true;
  }
}

export function triggerWingmanAegisCounter(world: SimWorld, events: SimEvent[]): void {
  if (!world.wingmanId) return;
  const mult = world.wingmanId === 'phase_escort' ? 1.85 : 0.85;
  const beamDmg = Math.max(85, Math.round(world.trueSquadDps * 0.65 * mult));
  let hits = 0;

  if (world.boss && world.boss.active && world.boss.hp > 0 && !world.boss.shielded) {
    recordDamage(world, 'deflect', beamDmg);
    damageBossCore(world, false, beamDmg, events);
    hits += 1;
    events.push({
      type: 'WINGMAN_COUNTER_BEAM',
      fromX: clamp(world.squadX - 1.4, -TRACK_HALF_WIDTH + 0.3, TRACK_HALF_WIDTH - 0.3),
      fromZ: PLAYER_Z - 1.2,
      toX: world.boss.x,
      toZ: world.boss.z,
      damage: beamDmg,
    });
  } else {
    for (let i = 0; i < world.enemies.length && hits < 2; i++) {
      const e = world.enemies[i]!;
      if (!e.active || e.consumed || e.hp <= 0 || e.z < -42) continue;
      recordDamage(world, 'deflect', Math.min(e.hp, beamDmg));
      damageEnemy(world, e, beamDmg, 1.2, events, { bypassShield: true, weapon: 'rail' });
      events.push({
        type: 'WINGMAN_COUNTER_BEAM',
        fromX: world.squadX + (hits === 0 ? -1.4 : 1.4),
        fromZ: PLAYER_Z - 1.2,
        toX: e.x,
        toZ: e.z,
        damage: beamDmg,
      });
      hits += 1;
    }
  }
}

export function stepV22WingmenAndAbyss(world: SimWorld, events: SimEvent[]): void {
  // 1. Tactical Drone Wingmen Update
  const wm = world.wingmanId;
  if (wm && world.squadCount > 0) {
    const form = world.wingmanFormation;
    const airY = world.squadAirY;
    let lx = world.squadX - 1.55;
    let lz = PLAYER_Z - 0.45;
    let rx = world.squadX + 1.55;
    let rz = PLAYER_Z - 0.45;
    let ly = 1.25 + airY;
    let ry = 1.25 + airY;

    if (form === 'forward_mirror') {
      const span = wm === 'prism_mirror' ? 1.52 : 1.38;
      lx = clamp(world.squadX - span, -TRACK_HALF_WIDTH + 0.55, TRACK_HALF_WIDTH - 0.55);
      rx = clamp(world.squadX + span, -TRACK_HALF_WIDTH + 0.55, TRACK_HALF_WIDTH - 0.55);
      lz = PLAYER_Z - 5.25;
      rz = PLAYER_Z - 5.25;
      ly = 0.95 + airY * 0.5;
      ry = 0.95 + airY * 0.5;
      syncWingmanMirrors(world, true, lx, lz, rx, rz);
    } else if (form === 'orbit_guard') {
      syncWingmanMirrors(world, false, 0, 0, 0, 0);
      world.wingmanOrbitAngle = (world.wingmanOrbitAngle + FIXED_DT * 4.2) % (Math.PI * 2);
      const rad = Math.max(2.15, world.formationRadius + 1.05);
      lx = clamp(world.squadX + Math.cos(world.wingmanOrbitAngle) * rad, -TRACK_HALF_WIDTH + 0.3, TRACK_HALF_WIDTH - 0.3);
      lz = PLAYER_Z + Math.sin(world.wingmanOrbitAngle) * rad * 0.78;
      rx = clamp(world.squadX + Math.cos(world.wingmanOrbitAngle + Math.PI) * rad, -TRACK_HALF_WIDTH + 0.3, TRACK_HALF_WIDTH - 0.3);
      rz = PLAYER_Z + Math.sin(world.wingmanOrbitAngle + Math.PI) * rad * 0.78;

      if (wm === 'phase_escort' && world.aegisCooldown > 0) {
        world.aegisCooldown = Math.max(0, world.aegisCooldown - FIXED_DT * 0.32);
      }
      world.wingmanPulseTimer -= FIXED_DT;
      if (world.wingmanPulseTimer <= 0) {
        world.wingmanPulseTimer = 0.25;
        const slashDmg = Math.max(6, world.trueSquadDps * 0.065);
        for (let i = 0; i < world.enemies.length; i++) {
          const e = world.enemies[i]!;
          if (!e.active || e.consumed || e.hp <= 0) continue;
          if (Math.hypot(e.x - lx, e.z - lz) <= 1.45 + e.radius || Math.hypot(e.x - rx, e.z - rz) <= 1.45 + e.radius) {
            recordDamage(world, 'blades', Math.min(e.hp, slashDmg));
            damageEnemy(world, e, slashDmg, 0.4, events, { bypassShield: true });
          }
        }
      }
    } else {
      // volley_sync
      syncWingmanMirrors(world, false, 0, 0, 0, 0);
      lx = clamp(world.squadX - (world.formationRadius + 0.92), -TRACK_HALF_WIDTH + 0.35, TRACK_HALF_WIDTH - 0.35);
      rx = clamp(world.squadX + (world.formationRadius + 0.92), -TRACK_HALF_WIDTH + 0.35, TRACK_HALF_WIDTH - 0.35);
      lz = PLAYER_Z - 0.55;
      rz = PLAYER_Z - 0.55;

      world.wingmanFireTimer -= FIXED_DT;
      if (world.wingmanFireTimer <= 0) {
        world.wingmanFireTimer = 0.36;
        const perBoltDmg = Math.max(5, (world.trueSquadDps * 0.16 * 0.36) / 2);
        for (const wx of [lx, rx]) {
          const p = world.projectilePool.acquire();
          p.id = allocV22Id();
          p.weapon = wm === 'gravity_anchor' ? 'cryo' : 'rail';
          p.radius = 0.22;
          p.damage = perBoltDmg;
          p.remainingPierce = 1;
          p.amplified = wm === 'prism_mirror';
          p.powerScale = 1.05;
          p.hostile = false;
          p.hostileLoss = 0;
          p.distanceTraveled = 0;
          p.maxRange = 54;
          p.splashRadius = 0;
          p.splashDamageRatio = 0;
          p.cryoSlowDuration = wm === 'gravity_anchor' ? 1.1 : 0;
          p.sweepStartFraction = 0;
          p.vx = 0;
          p.vz = -46;
          p.prevX = wx;
          p.prevZ = lz - 0.3;
          p.x = wx;
          p.z = lz - 0.3;
          p.active = true;
          world.projectiles.push(p);
        }
      }
    }

    // Gravity Anchor Passive: pull barrels toward enemy cluster & magnetize Core Shards from afar
    if (wm === 'gravity_anchor') {
      for (let i = 0; i < world.coreShards.length; i++) {
        const cs = world.coreShards[i]!;
        if (!cs.active) continue;
        const dx = world.squadX - cs.x;
        const dz = PLAYER_Z - cs.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.2 && dist <= 12.5) {
          cs.x += (dx / dist) * 14.0 * FIXED_DT;
          cs.z += (dz / dist) * 14.0 * FIXED_DT;
        }
      }
      if (world.enemies.length > 0 && world.barrels.length > 0) {
        const frontE = world.enemies[0]!;
        for (let b = 0; b < world.barrels.length; b++) {
          const br = world.barrels[b]!;
          if (!br.active || br.detonated || br.z < -42 || br.z > PLAYER_Z - 3) continue;
          const dx = frontE.x - br.x;
          br.x = clamp(br.x + clamp(dx, -1, 1) * 1.65 * FIXED_DT, -TRACK_HALF_WIDTH + 0.8, TRACK_HALF_WIDTH - 0.8);
        }
      }
    }

    world.wingmanLeftPos = { x: normalizeZero(lx), y: ly, z: normalizeZero(lz) };
    world.wingmanRightPos = { x: normalizeZero(rx), y: ry, z: normalizeZero(rz) };
  } else {
    syncWingmanMirrors(world, false, 0, 0, 0, 0);
  }

  // 2. Abyssal Protocol Heat Tier Mechanics (Zero effect when abyssalHeat === 0 or Fair Trial!)
  const heat = world.abyssalHeat;
  if (heat <= 0 || world.mods.fairTrial) return;

  // Pact 1: Oscillating 45° Reflector Mirrors (`±24°` smooth sinusoidal sweep)
  if (hasAbyssalPact(world, 'pact_oscillating_mirrors')) {
    const osc = Math.sin(world.simTime * 2.15) * 24;
    for (let i = 0; i < world.reflectors.length; i++) {
      const rf = world.reflectors[i]!;
      if (!rf.active || rf.isWingmanMirror) continue;
      const baseAngle = rf.lean === 1 ? 34 : -34;
      rf.angleDeg = Math.round(clamp(baseAngle + osc, -58, 58));
    }
  }

  // Pact 2: Volatile Chain Overheat Barrels
  if (hasAbyssalPact(world, 'pact_volatile_chain')) {
    for (let i = 0; i < world.barrels.length; i++) {
      const br = world.barrels[i]!;
      if (!br.active || br.detonated) continue;
      if (br.blastRadius < 5.2) br.blastRadius = 5.3;
      if (br.z >= PLAYER_Z - 10.5 && br.z <= PLAYER_Z - 1.2) {
        br.overheat = clamp((br.z - (PLAYER_Z - 10.5)) / 7.2, 0, 1);
      }
    }
  }

  // Pact 3: Rift & Arena Gravitational Crosswind Turbulence
  if (hasAbyssalPact(world, 'pact_rift_turbulence') && !world.isFiringRange) {
    const nearRiftOrBoss = Boolean(world.boss?.active) || world.collapseRifts.some((r) => r.active && Math.abs(r.z - PLAYER_Z) <= 14);
    if (nearRiftOrBoss && world.squadAirY <= 0.25 && !world.onMagRail) {
      const wind = Math.sin(world.simTime * 1.4) * 1.32 * FIXED_DT;
      world.squadX = clamp(world.squadX + wind, -(TRACK_HALF_WIDTH - world.formationRadius), TRACK_HALF_WIDTH - world.formationRadius);
    }
  }

  // Pact 4: Elite Vanguard Extra Tactical Squad Formation at mid-runway
  if (hasAbyssalPact(world, 'pact_elite_vanguard') && !world.isFiringRange && !world.boss) {
    const stageIdx = Math.floor(world.scrollDistance / 190);
    if (stageIdx > world.lastAbyssVanguardStage && world.enemies.length < 180) {
      world.lastAbyssVanguardStage = stageIdx;
      spawnTacticalFormation(world, stageIdx % 2 === 0 ? 'aegis_refract' : 'pincer_ambush', stageIdx % 2 === 0 ? -1.4 : 1.4, -52);
    }
  }

  // Pact 5 & 6: Boss Harmonic Aegis Shield + Heat >= 4 Boss Apex Mutated Movesets!
  const boss = world.boss;
  if (boss && boss.active && boss.hp > 0 && boss.introProgress >= 0.98) {
    if (hasAbyssalPact(world, 'pact_harmonic_aegis')) {
      const cycle = world.simTime % 7.6;
      world.bossHarmonicShield = cycle >= 4.8 && (boss.breakTimer ?? 0) <= 0;
    } else {
      world.bossHarmonicShield = false;
    }

    if (isBossApexMutated(world)) {
      world.bossApexTimer -= FIXED_DT;
      if (world.bossApexActiveTimer > 0) {
        world.bossApexActiveTimer = Math.max(0, world.bossApexActiveTimer - FIXED_DT);
        // Resolve Apex Move active threat window (at t == 0.45s before end, check lane safety!)
        if (world.bossApexActiveTimer > 0.38 && world.bossApexActiveTimer - FIXED_DT <= 0.38 && !world.isFiringRange) {
          const safeX = world.bossApexSafeX;
          const inDanger = Math.abs(world.squadX - safeX) > 1.85 && world.squadAirY <= 0.35;
          if (inDanger) {
            const rawLoss = Math.max(3, Math.min(10, Math.round(world.squadCount * 0.09)));
            const loss = mitigateLossWithAegis(world, rawLoss, events);
            if (loss > 0 && world.squadCount > 2) {
              world.squadCount = Math.max(1, world.squadCount - loss);
              events.push({ type: 'SQUAD_LOSS', x: world.squadX, z: PLAYER_Z, lost: loss, reason: 'BOSS_ATTACK' });
              deployReserveIfAvailable(world, loss, events);
            } else if (loss === 0) {
              addResonance(world, 0.25, events);
            }
          }
        }
      } else if (world.bossApexTimer <= 0) {
        world.bossApexTimer = Math.max(5.8, 8.6 - heat * 0.22);
        world.bossApexActiveTimer = 2.15;
        const moveKind: AbyssalApexMoveKind =
          boss.id === 'warden_01'
            ? 'cross_laser_grid'
            : boss.id === 'hydra_02'
              ? 'phantom_clone_salvo'
              : 'mag_storm_tide';
        world.bossApexMove = moveKind;
        // Alternate safe lane deterministically from simTime tick
        const side = Math.sin(world.simTime * 3.7) >= 0 ? 1 : -1;
        world.bossApexSafeX = moveKind === 'cross_laser_grid' ? 0 : side * 2.65;
        events.push({
          type: 'ABYSSAL_BOSS_MUTATION',
          bossId: boss.id,
          moveKind,
          safeX: world.bossApexSafeX,
          heatTier: heat,
        });
      }
    }
  } else {
    world.bossHarmonicShield = false;
    world.bossApexActiveTimer = 0;
  }
}

export function buildWingmanSnapshot(world: SimWorld): WingmanStateSnapshot | null {
  if (!world.wingmanId || world.squadCount <= 0) return null;
  return {
    id: world.wingmanId,
    formation: world.wingmanFormation,
    leftX: world.wingmanLeftPos.x,
    leftY: world.wingmanLeftPos.y,
    leftZ: world.wingmanLeftPos.z,
    rightX: world.wingmanRightPos.x,
    rightY: world.wingmanRightPos.y,
    rightZ: world.wingmanRightPos.z,
  };
}
