import type { SimEvent } from '../types/game';
import {
  FIXED_DT,
  PLAYER_Z,
  RESONANCE_GAIN_VAULT_BREAK,
  TRACK_HALF_WIDTH,
} from '../config/constants';
import { getActiveSynergies } from '../config/protocols';
import { spawnBarrel } from './barrels';
import { intersectSweptSegmentAABB } from './ccd';
import { spawnEnemy } from './enemies';
import {
  allocEntityId,
  type SimBossHazardZone,
  type SimBossPylon,
  type SimBossState,
  type SimWorld,
} from './entities';
import { spawnGateRow } from './gates';
import { clamp, clampSquadCount, normalizeZero } from './math';
import { addResonance } from './resonance';
import { advanceEndlessStage } from './endless';
import { resolvePantheonBossClear } from './v21Mechanics';
import { mitigateLossWithAegis } from './aegis';
import { createBossShoulderParts, deployReserveIfAvailable, hasMutator, recordDamage, spawnContractLane, spawnDoomOrb, spawnPhaseTwoReactorPart, spawnReflector, syncBossShoulderParts } from './competition';
import { computeDynamicSwarmProfile } from './spawner';
import { computeAuthoritativeEffectiveDps, spawnPrismLens } from './weapons';

const BOSS_INTRO_DURATION_SEC = 1.2;
const BOSS_START_Z = -34.0;
const BOSS_BASE_Z = -20.0;
const HAZARD_Z_CENTER = -6.0;
const HAZARD_DEPTH = 28.0; // [-20, +8], covers PLAYER_Z = +6.0
const BOSS_ENRAGE_RAMP_PER_SEC = 0.08;
const BOSS_ENRAGE_MAX = 2.0;
/** While enraged the core emits an unavoidable pulse, so slow fights cost drones even with perfect dodging. */
const BOSS_ENRAGE_PULSE_SEC = 2.0;
const BOSS_ENRAGE_PULSE_LOSS = 4;

export interface BossTitanProfile {
  titanRank: number;
  titanScale: number;
  titanHpMult: number;
  hpBars: number;
  hasMetaPower: boolean;
}

/**
 * Dynamically scales Boss colossal stature, multi-layer HP bars, and tsunami minion floods
 * to match the player's accumulated Workshop upgrades, Mutators, and stacked Arsenal power,
 * while strictly keeping 0-upgrade baseline HP at 1.0x for deterministic balance invariants.
 */
export function computeBossTitanProfile(world: SimWorld): BossTitanProfile {
  const hasMetaPower =
    world.mods.damageMult > 1.001 ||
    world.mods.bonusSquad > 0 ||
    (world.mods.critChance ?? 0) > 0.001 ||
    (world.mods.mutators?.length ?? 0) > 0 ||
    (world.mods.bossHpMult ?? 1) > 1.001;

  if (!hasMetaPower) {
    const snowball =
      (world.squadCount >= 180 ? 2 : world.squadCount >= 110 ? 1 : 0) +
      (world.activeFusions.length >= 1 ? 1 : 0) +
      Math.floor(world.overclockStacks / 2) +
      (world.endless ? Math.max(0, world.endless.wave - 1) : 0);
    const titanRank = clamp(1 + Math.min(3, snowball), 1, 4);
    const titanScale = Number((1 + (titanRank - 1) * 0.09).toFixed(3));
    return {
      titanRank,
      titanScale,
      titanHpMult: 1.0,
      hpBars: titanRank,
      hasMetaPower: false,
    };
  }

  const dmgMult =
    world.mods.damageMult *
    (1 + (world.mods.critChance ?? 0) * 0.75) *
    (hasMutator(world, 'glass_cannon') ? 2.0 : 1.0) *
    (hasMutator(world, 'mirror_twin') ? 1.16 : 1.0);
  const squadMult = 1 + Math.min(2.0, world.mods.bonusSquad / 28);
  const arsenalCount = Math.min(3, Object.values(world.learnedWeaponLevels).filter((v) => v > 0).length);
  const arsenalMult =
    1 +
    Math.max(0, arsenalCount - 1) * 0.14 +
    world.activeFusions.length * 0.22 +
    Math.min(0.45, world.overclockStacks * 0.08);

  const rawPower = Math.max(1.15, dmgMult * squadMult * arsenalMult);
  const titanHpMult = world.endless
    ? clamp(Math.pow(rawPower, 0.48), 1.12, 4.2)
    : clamp(Math.pow(rawPower, 0.60), 1.18, 9.5);
  const titanRank = clamp(1 + Math.ceil(Math.log2(Math.max(1.2, rawPower)) * 1.65), 2, 10);
  const titanScale = Number(clamp(1.06 + (titanRank - 1) * 0.052, 1.1, 1.52).toFixed(3));
  const hpBars = clamp(Math.max(2, Math.round(titanHpMult * 1.15)), 2, 14);

  return {
    titanRank,
    titanScale,
    titanHpMult,
    hpBars,
    hasMetaPower: true,
  };
}

/**
 * Spawns a colossal multi-lane Sea of Minions ("尸潮洪流") from dimensional rifts flanking the Boss
 * when the player enters combat upgraded, turning Boss fights into epic horde + Titan duels!
 */
function spawnTitanSwarmReinforcements(
  world: SimWorld,
  boss: SimBossState,
  extraBase: number,
  isPhaseSurge = false,
): void {
  const profile = computeDynamicSwarmProfile(world);
  if (!boss.hasMetaPower && profile.swarmMult < 2.2) return;
  const activeCap = 310;
  if (world.enemies.length >= activeCap) return;

  boss.swarmCycle += 1;
  const effectiveRank = Math.max(boss.titanRank, profile.swarmTier);
  const powerExtra = Math.round((profile.swarmMult - 1) * 7.5);
  const squadBonus = Math.min(28, Math.floor(world.squadCount / 14));
  const rightPodBroken = boss.parts[1]?.destroyed === true;
  const rawCount = Math.min(
    activeCap - world.enemies.length,
    extraBase + effectiveRank * 3 + powerExtra + squadBonus + (isPhaseSurge ? 14 : 0),
  );
  const count = rightPodBroken
    ? clamp(Math.round(rawCount * 0.36), 4, 26)
    : clamp(rawCount, 12, 72);

  const hpScale = boss.hasMetaPower
    ? Math.sqrt(Math.max(1, boss.titanHpMult))
    : clamp(0.85 + Math.sqrt(Math.max(1, world.trueSquadDps / 120)) * 0.25, 0.85, 1.45);
  const rightBroken = boss.parts[1]?.destroyed === true;
  const crawlerHp = Math.max(4, Math.round((rightBroken ? 3.2 : 4.8) * hpScale));
  const eliteScale = rightBroken ? 0.55 : 1.0;

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 7);
    const col = i % 7;
    const jitter = (((i * 5 + boss.swarmCycle * 3) % 7) - 3) * 0.14;
    const sx = clamp(-4.2 + col * 1.4 + jitter, -TRACK_HALF_WIDTH + 0.55, TRACK_HALF_WIDTH - 0.55);
    const sz = boss.z + 2.5 - row * 1.55 - (col % 2) * 0.55;

    if (isPhaseSurge && boss.hasMetaPower && effectiveRank >= 4 && i === 3) {
      spawnEnemy(world, 'bastion', sx, sz - 0.8, {
        hp: Math.max(40, Math.round(75 * hpScale * eliteScale)),
        isSwarmFodder: true,
      });
    } else if (boss.hasMetaPower && effectiveRank >= 3 && i % 15 === 11) {
      spawnEnemy(world, 'glacier', sx, sz - 0.4, {
        hp: Math.max(24, Math.round(38 * hpScale * eliteScale)),
        isSwarmFodder: true,
      });
    } else if (boss.hasMetaPower && effectiveRank >= 2 && i % 14 === 3) {
      spawnEnemy(world, 'burrower', sx, sz, {
        hp: Math.max(12, Math.round(18 * hpScale * eliteScale)),
        isSwarmFodder: true,
      });
    } else if (boss.hasMetaPower && effectiveRank >= 3 && i % 13 === 7) {
      spawnEnemy(world, 'phalanx', sx, sz - 0.4, {
        hp: Math.max(22, Math.round(36 * hpScale * eliteScale)),
        isSwarmFodder: true,
      });
    } else if (i % 11 === 5) {
      spawnEnemy(world, 'bomber', sx, sz, {
        hp: Math.max(10, Math.round(14 * hpScale * eliteScale)),
        isSwarmFodder: true,
      });
    } else if (boss.hasMetaPower && effectiveRank >= 2 && i % 10 === 8) {
      spawnEnemy(world, 'stalker', sx, sz, {
        hp: Math.max(12, Math.round(18 * hpScale * eliteScale)),
        isSwarmFodder: true,
      });
    } else if (boss.hasMetaPower && effectiveRank >= 3 && i % 9 === 4) {
      spawnEnemy(world, 'dasher', sx, sz, {
        hp: Math.max(12, Math.round(18 * hpScale * eliteScale)),
        isSwarmFodder: true,
      });
    } else if (i % 6 === 2) {
      spawnEnemy(world, 'mitosis', sx, sz, {
        hp: Math.max(9, Math.round(14 * hpScale * eliteScale)),
        isSwarmFodder: true,
      });
    } else {
      spawnEnemy(world, 'crawler', sx, sz, { hp: crawlerHp, isSwarmFodder: true });
    }
  }
}

/**
 * Boss hits remove `base` drones per 100 in the squad, so large late-game swarms still feel
 * each hit; the floor (half of `base`) keeps small squads from shrugging hits off.
 */
function scaledBossLoss(base: number, squad: number): number {
  return Math.max(1, Math.ceil(base * 0.5), Math.round((squad * base) / 100));
}

export function spawnSectorBoss(world: SimWorld, events: SimEvent[]): SimBossState {
  const bossCfg = world.script.boss;
  const hpMult = world.mods.bossHpMult ?? 1;
  const profile = computeBossTitanProfile(world);
  let bossMaxHp = Math.max(1, Math.round(bossCfg.maxHp * hpMult * profile.titanHpMult));

  // Live Encounter Climax Calibration (preserves isolated scrollDistance=0 unit-test exact 7500 HP invariant!):
  // Guarantees 15-25s interactive duel for normal builds, 8-12s rewarding melt for strong Fusion/Mutator builds,
  // and prevents <2s instant-deletes in late Endless waves without spongy invulnerability!
  const isLiveRunwayArrival =
    (world.simTime >= 5 && world.scrollDistance >= 50) ||
    (Boolean(world.mods.blitz) && world.simTime >= 5) ||
    (Boolean(world.endless) && world.simTime >= 5);
  if (isLiveRunwayArrival && world.squadCount >= 6) {
    const liveDps = Math.max(24, computeAuthoritativeEffectiveDps(world, false));
    const wave = world.endless?.wave ?? 1;
    const refDps = world.endless
      ? 920 * (1 + (wave - 1) * 0.48)
      : world.mods.blitz
        ? 980
        : world.sector === 1
          ? 640
          : world.sector === 2
            ? 860
            : world.sector === 3
              ? 1120
              : 980;
    const relPower = clamp(liveDps / refDps, 0.55, 28.0);
    // Realized Boss DPS (including Pierce, 2.0x Shoulder Break, 16% Doom-Orb Slam & Fusion AoE) is ~2.35x sustainedDps:
    // Normal Build (relPower ~ 1.0) -> ~42 / 2.35 ≈ 17.8s (15-24s target window!)
    // Strong Build (relPower ~ 3.2) -> ~23.5 / 2.35 ≈ 10.0s (8-12s target window!)
    const baseWindowSec = world.endless ? 46.0 : world.mods.blitz ? 52.0 : 64.0;
    const targetEffectiveSec = clamp(
      baseWindowSec / Math.pow(relPower, 0.52),
      world.endless ? 28.0 : 32.0,
      74.0,
    );
    const bossFactor = bossCfg.id === 'omega_zero' ? 0.84 : bossCfg.id === 'hydra_02' ? 1.24 : 1.06;
    const calibratedHp = Math.round(liveDps * targetEffectiveSec * bossFactor);
    const baseFloorHp = Math.round(bossCfg.maxHp * hpMult);
    bossMaxHp = world.endless
      ? Math.max(Math.round(bossMaxHp * 0.85), calibratedHp)
      : Math.max(baseFloorHp, calibratedHp);
    const minClimaxHp = Math.round(liveDps * (world.endless ? 30.0 : 38.0) * bossFactor);
    if (bossMaxHp < minClimaxHp) bossMaxHp = minClimaxHp;
  }

  const pylons: SimBossPylon[] = [];
  let initialShielded = false;

  if (bossCfg.id === 'omega_zero') {
    const pylonHp = isLiveRunwayArrival
      ? Math.max(180, Math.round(bossMaxHp * 0.14))
      : Math.max(
          1,
          Math.round((bossCfg.pylonHp ?? 3500) * hpMult * Math.pow(profile.titanHpMult, 0.82)),
        );
    initialShielded = true;
    pylons.push(
      {
        id: allocEntityId(world),
        prevX: -3.1,
        prevZ: -16.5,
        x: -3.1,
        z: -16.5,
        halfWidth: 1.05,
        halfDepth: 0.9,
        hp: pylonHp,
        maxHp: pylonHp,
        destroyed: false,
      },
      {
        id: allocEntityId(world),
        prevX: 3.1,
        prevZ: -16.5,
        x: 3.1,
        z: -16.5,
        halfWidth: 1.05,
        halfDepth: 0.9,
        hp: pylonHp,
        maxHp: pylonHp,
        destroyed: false,
      },
    );
  }

  const baseHalfW = bossCfg.id === 'hydra_02' ? 2.4 : bossCfg.id === 'omega_zero' ? 2.3 : 2.1;
  const hitScale = profile.hasMetaPower ? 1 + (profile.titanScale - 1) * 0.35 : 1;

  const boss: SimBossState = {
    entityId: allocEntityId(world),
    secondaryEntityId: allocEntityId(world),
    active: true,
    id: bossCfg.id,
    name: bossCfg.name,
    phase: 1,
    maxPhases: bossCfg.maxPhases,
    prevX: 0,
    prevZ: BOSS_START_Z,
    x: 0,
    z: BOSS_START_Z,
    halfWidth: Number((baseHalfW * hitScale).toFixed(3)),
    halfDepth: Number((1.5 * hitScale).toFixed(3)),
    hp: bossMaxHp,
    maxHp: bossMaxHp,
    titanRank: profile.titanRank,
    titanScale: profile.titanScale,
    hpBars: profile.hpBars,
    hasMetaPower: profile.hasMetaPower,
    titanHpMult: profile.titanHpMult,
    swarmCycle: 0,
    secondaryCore: null,
    shielded: initialShielded,
    pylons,
    parts: createBossShoulderParts(world, bossMaxHp, profile.titanScale, bossCfg.id),
    breakTimer: 0,
    doomOrbTimer: 1.05,
    hazardZones: [],
    hitPulse: 0,
    introProgress: 0,
    phaseElapsed: 0,
    fightElapsed: 0,
    enrage: 1,
    enragePulseTimer: BOSS_ENRAGE_PULSE_SEC,
    hazardTimer: 1.5,
    hazardCycle: 0,
    summonTimer: profile.hasMetaPower ? 1.2 : 3.2,
    lensTimer: 2.6,
    orbTimer: 2.2,
    shieldSwapTimer: 3.6,
    barrelTimer: 0.8,
  };

  world.boss = boss;
  world.bossSpawned = true;

  events.push({
    type: 'BOSS_INTRO',
    bossId: boss.id,
    name: boss.name,
    titanRank: boss.titanRank,
  });

  return boss;
}

function addBossHazard(
  world: SimWorld,
  boss: SimBossState,
  x: number,
  halfWidth: number,
  warningDuration: number,
  fireDuration: number,
  strikeLoss: number,
): void {
  const zone: SimBossHazardZone = {
    id: allocEntityId(world),
    x: normalizeZero(x),
    z: HAZARD_Z_CENTER,
    halfWidth,
    depth: HAZARD_DEPTH,
    warningDuration,
    fireDuration,
    elapsed: 0,
    warningProgress: 0,
    firing: false,
    strikeLoss,
    damageApplied: false,
  };
  boss.hazardZones.push(zone);
}

function spawnTwoOfThreeLaneHazards(
  world: SimWorld,
  boss: SimBossState,
  warningDuration: number,
  strikeLoss: number,
): void {
  const lanes = [-3.35, 0.0, 3.35] as const;
  const openLaneIndex = boss.hazardCycle % 3;
  boss.hazardCycle += 1;

  for (let idx = 0; idx < 3; idx++) {
    if (idx === openLaneIndex) continue;
    addBossHazard(world, boss, lanes[idx] ?? 0, 1.42, warningDuration, 0.35, strikeLoss);
  }
}

function spawnHostileOrb(
  world: SimWorld,
  x: number,
  z: number,
  vx: number,
  vz: number,
  loss: number,
  powerScale = 1.1,
): void {
  const orb = world.projectilePool.acquire();
  orb.id = allocEntityId(world);
  orb.prevX = normalizeZero(x);
  orb.prevZ = z;
  orb.x = normalizeZero(x);
  orb.z = z;
  orb.vx = vx;
  orb.vz = vz;
  orb.radius = 0.32;
  orb.weapon = 'plasma';
  orb.damage = 0;
  orb.remainingPierce = 0;
  orb.amplified = false;
  orb.powerScale = powerScale;
  orb.hostile = true;
  orb.hostileLoss = loss;
  orb.distanceTraveled = 0;
  orb.maxRange = 48.0;
  orb.splashRadius = 0;
  orb.splashDamageRatio = 0;
  orb.cryoSlowDuration = 0;
  orb.sweepStartFraction = 0;
  orb.active = true;
  world.projectiles.push(orb);
}

function fireTitanFanOrbs(world: SimWorld, boss: SimBossState, speed: number, loss: number): void {
  if (boss.parts[0]?.destroyed || !boss.hasMetaPower || boss.titanRank < 3) return;
  const fanPairs = Math.min(2, Math.floor((boss.titanRank - 1) / 2));
  for (let k = 1; k <= fanPairs; k++) {
    const angle = (k * 13 * Math.PI) / 180;
    const vx = Math.sin(angle) * speed;
    const vz = Math.cos(angle) * speed;
    spawnHostileOrb(world, boss.x - 1.2, boss.z + 1.5, -vx, vz, loss, 1.35);
    spawnHostileOrb(world, boss.x + 1.2, boss.z + 1.5, vx, vz, loss, 1.35);
  }
}

export function checkBossPhaseTransitions(world: SimWorld, events: SimEvent[]): void {
  const boss = world.boss;
  if (!boss || !boss.active || boss.hp <= 0) {
    return;
  }

  if (boss.id === 'warden_01') {
    if (boss.phase === 1 && boss.hp <= boss.maxHp * 0.5) {
      boss.phase = 2;
      boss.phaseElapsed = 0;
      boss.hazardZones.length = 0;
      boss.hazardTimer = 1.1;
      spawnPhaseTwoReactorPart(world, boss);
      // Arena Transformation: deploy twin inward-angled 45° Holographic Reflectors + flanking Surge Barrels!
      world.reflectors.length = 0;
      const refL = spawnReflector(world, -3.05, -9.2, 0, 1);
      refL.angleDeg = 32;
      const refR = spawnReflector(world, 3.05, -9.2, 0, -1);
      refR.angleDeg = -32;
      spawnBarrel(world, -2.5, -15.8, 0);
      spawnBarrel(world, 2.5, -15.8, 0);
      events.push({
        type: 'BOSS_PHASE_BREAK',
        phase: 2,
        x: boss.x,
        z: boss.z,
        arenaShift: '双侧 45° 折镜反击阵 + 侧翼高能爆桶已展开！',
      });
      spawnTitanSwarmReinforcements(world, boss, 12, true);
      // Emergency shootable supply gate (-2 -> +8) sliding toward player
      spawnGateRow(world, {
        layout: 'standalone',
        z: -18.5,
        vz: 6.5,
        single: {
          x: 0.0,
          halfWidth: 2.4,
          op: 'sub',
          value: 2,
          mutable: true,
          damagePerStep: 10,
          stepDelta: 1,
          maxValue: 8,
        },
      });
    }
  } else if (boss.id === 'hydra_02') {
    if (boss.phase === 1 && boss.hp <= boss.maxHp * 0.5) {
      boss.phase = 2;
      boss.phaseElapsed = 0;
      boss.hazardZones.length = 0;
      boss.hazardTimer = 1.15;
      boss.shieldSwapTimer = 3.6;
      const splitHitScale = boss.hasMetaPower ? 1 + (boss.titanScale - 1) * 0.3 : 1;
      boss.halfWidth = Number((1.75 * splitHitScale).toFixed(3));
      boss.x = -2.6;
      boss.z = -20.5;
      boss.prevX = -2.6;
      boss.prevZ = -20.5;
      boss.shielded = false;
      boss.secondaryCore = {
        prevX: 2.6,
        prevZ: -19.0,
        x: 2.6,
        z: -19.0,
        halfWidth: Number((1.75 * splitHitScale).toFixed(3)),
        halfDepth: 1.35,
        shielded: true,
      };
      spawnPhaseTwoReactorPart(world, boss);
      // Arena Transformation: Twin-Dragon Flanking Reflector + Off-Center Prism Lens!
      world.reflectors.length = 0;
      const hRefL = spawnReflector(world, -3.1, -9.6, 0, 1);
      hRefL.angleDeg = 30;
      const hRefR = spawnReflector(world, 3.1, -9.6, 0, -1);
      hRefR.angleDeg = -30;
      spawnPrismLens(world, -2.1, -11.2, 0, 2.0, 1.0);
      spawnTitanSwarmReinforcements(world, boss, 14, true);
      events.push({
        type: 'BOSS_PHASE_BREAK',
        phase: 2,
        x: 0,
        z: boss.z,
        arenaShift: '双龙分体 · 中央聚能棱镜与双翼交替护盾开启！',
      });
    }
  } else if (boss.id === 'omega_zero') {
    const allPylonsBroken = boss.pylons.every((p) => p.destroyed);
    if (boss.phase === 1 && (allPylonsBroken || boss.hp <= boss.maxHp * 0.65)) {
      for (let i = 0; i < boss.pylons.length; i++) {
        const p = boss.pylons[i];
        if (p && !p.destroyed) {
          p.destroyed = true;
          p.hp = 0;
        }
      }
      boss.shielded = false;
      boss.phase = 2;
      boss.phaseElapsed = 0;
      boss.hazardZones.length = 0;
      boss.hazardTimer = 1.2;
      boss.summonTimer = boss.hasMetaPower ? 1.2 : 2.4;
      boss.lensTimer = 2.0;
      spawnPhaseTwoReactorPart(world, boss);
      // Omega-Zero P2 Arena Transformation: Flanking Reflector Array + Off-Center Prism Lens!
      world.reflectors.length = 0;
      const oRefL = spawnReflector(world, -3.15, -9.8, 0, 1);
      oRefL.angleDeg = 34;
      const oRefR = spawnReflector(world, 3.15, -9.8, 0, -1);
      oRefR.angleDeg = -34;
      spawnPrismLens(world, 2.1, -12.0, 0, 2.0, 1.0);
      spawnTitanSwarmReinforcements(world, boss, 14, true);
      events.push({
        type: 'BOSS_PHASE_BREAK',
        phase: 2,
        x: boss.x,
        z: boss.z,
        arenaShift: '护盾崩解 · 深渊双折镜增幅矩阵已激活！',
      });
    }
    if (boss.phase === 2 && boss.hp <= boss.maxHp * 0.3) {
      boss.phase = 3;
      boss.phaseElapsed = 0;
      boss.hazardZones.length = 0;
      boss.hazardTimer = 1.15;
      boss.barrelTimer = 0.6;
      boss.summonTimer = boss.hasMetaPower ? 1.4 : 3.0;
      boss.z = -15.5;
      // Re-angle arena reflectors into tight 42° Phase-3 crossfire while boss.barrelTimer drops the 3 chain barrels!
      for (const rf of world.reflectors) {
        rf.angleDeg = rf.lean * 42;
      }
      spawnTitanSwarmReinforcements(world, boss, 16, true);
      events.push({
        type: 'BOSS_PHASE_BREAK',
        phase: 3,
        x: boss.x,
        z: boss.z,
        arenaShift: '终焉压境 · 交叉激光走廊与连环电容桶全开！',
      });
    }
  }
}

export function damageBossPylon(
  world: SimWorld,
  pylon: SimBossPylon,
  damage: number,
  events: SimEvent[],
): void {
  const boss = world.boss;
  if (!boss || !boss.active || boss.hp <= 0 || pylon.destroyed || damage <= 0) {
    return;
  }

  pylon.hp = Math.max(0, pylon.hp - damage);
  boss.hitPulse = 1.0;

  if (pylon.hp <= 0) {
    pylon.hp = 0;
    pylon.destroyed = true;

    // Deal 18% maxHp stun chunk to Omega-Zero and empower player arsenal
    const stunDamage = Math.ceil(boss.maxHp * 0.18);
    recordDamage(world, 'deflect', Math.min(boss.hp, stunDamage));
    boss.hp = Math.max(0, boss.hp - stunDamage);

    world.masteryCount += 1;
    const nextLvl = Math.min(3, world.weaponLevel + 1) as 1 | 2 | 3;
    world.learnedWeaponLevels[world.weapon] = nextLvl;
    world.weaponLevel = nextLvl;
    addResonance(world, RESONANCE_GAIN_VAULT_BREAK, events);

    if (boss.pylons.every((p) => p.destroyed)) {
      boss.shielded = false;
    }
    checkBossPhaseTransitions(world, events);
  }
}

export function damageBossCore(
  world: SimWorld,
  hitSecondary: boolean,
  rawDamage: number,
  events: SimEvent[],
): void {
  const boss = world.boss;
  if (!boss || !boss.active || boss.hp <= 0 || rawDamage <= 0) {
    return;
  }

  let synergyEnrageMult = 1.0;
  if (boss.enrage > 1.01 && world.endless) {
    const syns = getActiveSynergies(world.endless.upgrades);
    if (syns.some((s) => s.id === 'hyper_annihilation')) {
      synergyEnrageMult = 1.35;
    }
  }

  const syncOverdriveBreak = boss.breakTimer > 0 && world.overdriveTimer > 0 ? 1.25 : 1.0;
  if (hitSecondary) {
    if (!boss.secondaryCore || boss.secondaryCore.shielded) {
      return;
    }
    const secBreakMult = (boss.breakTimer > 0 ? 2.0 : 1.0) * syncOverdriveBreak;
    const baseSec = rawDamage * 1.5;
    const dealt = Math.min(boss.hp, baseSec * secBreakMult * synergyEnrageMult);
    if (dealt > baseSec) {
      recordDamage(world, 'deflect', dealt - baseSec);
    }
    boss.hitPulse = 1.0;
    boss.hp = Math.max(0, boss.hp - dealt);
    events.push({
      type: 'BOSS_HIT',
      x: boss.secondaryCore.x,
      z: boss.secondaryCore.z,
      damage: Math.max(1, Math.round(dealt)),
    });
    checkBossPhaseTransitions(world, events);
    return;
  }

  if (boss.shielded) {
    return;
  }

  const weakpointMult =
    (boss.id === 'hydra_02' && boss.phase === 2 ? 1.5 : 1.0) *
    (boss.breakTimer > 0 ? 2.0 : 1.0) *
    syncOverdriveBreak *
    synergyEnrageMult;
  const dealt = Math.min(boss.hp, rawDamage * weakpointMult);
  if (dealt > rawDamage) {
    recordDamage(world, 'deflect', dealt - rawDamage);
  }
  boss.hitPulse = 1.0;
  boss.hp = Math.max(0, boss.hp - dealt);
  events.push({
    type: 'BOSS_HIT',
    x: boss.x,
    z: boss.z,
    damage: Math.max(1, Math.round(dealt)),
  });
  checkBossPhaseTransitions(world, events);
}

export function applyBarrelBlastToBoss(
  world: SimWorld,
  barrelX: number,
  barrelZ: number,
  blastRadius: number,
  blastDamage: number,
  events: SimEvent[],
): void {
  const boss = world.boss;
  if (!boss || !boss.active || boss.hp <= 0) {
    return;
  }

  for (let i = 0; i < boss.pylons.length; i++) {
    const pylon = boss.pylons[i];
    if (pylon && !pylon.destroyed) {
      if (Math.hypot(pylon.x - barrelX, pylon.z - barrelZ) <= blastRadius + pylon.halfWidth) {
        damageBossPylon(world, pylon, blastDamage, events);
      }
    }
  }

  if (boss.hp <= 0) return;

  if (!boss.shielded) {
    if (Math.hypot(boss.x - barrelX, boss.z - barrelZ) <= blastRadius + boss.halfWidth) {
      recordDamage(world, 'explosives', Math.min(boss.hp, blastDamage));
      boss.hitPulse = 1.0;
      boss.hp = Math.max(0, boss.hp - blastDamage);
      checkBossPhaseTransitions(world, events);
      return;
    }
  }

  if (boss.secondaryCore && !boss.secondaryCore.shielded) {
    const sec = boss.secondaryCore;
    if (Math.hypot(sec.x - barrelX, sec.z - barrelZ) <= blastRadius + sec.halfWidth) {
      recordDamage(world, 'explosives', Math.min(boss.hp, blastDamage));
      boss.hitPulse = 1.0;
      boss.hp = Math.max(0, boss.hp - blastDamage);
      checkBossPhaseTransitions(world, events);
    }
  }
}

/**
 * Step 4c: Updates Boss arrival intro, lateral choreography, shield swaps,
 * >=0.8s telegraphed BossHazardZones, minion escorts, Prism Lenses, and Phase 3 Barrels.
 */
export function stepBossAI(world: SimWorld, _events: SimEvent[]): void {
  const boss = world.boss;
  if (!boss || !boss.active || boss.hp <= 0) {
    return;
  }

  boss.prevX = boss.x;
  boss.prevZ = boss.z;
  for (let i = 0; i < boss.pylons.length; i++) {
    const p = boss.pylons[i];
    if (p) {
      p.prevX = p.x;
      p.prevZ = p.z;
    }
  }
  if (boss.secondaryCore) {
    boss.secondaryCore.prevX = boss.secondaryCore.x;
    boss.secondaryCore.prevZ = boss.secondaryCore.z;
  }

  if (boss.introProgress < 1.0) {
    boss.introProgress = Math.min(1.0, boss.introProgress + FIXED_DT / BOSS_INTRO_DURATION_SEC);
    const smooth = 1 - Math.pow(1 - boss.introProgress, 2);
    boss.z = BOSS_START_Z + (BOSS_BASE_Z - BOSS_START_Z) * smooth;
    syncBossShoulderParts(boss);
    if (boss.introProgress >= 1.0 && (boss.hasMetaPower || computeDynamicSwarmProfile(world).swarmMult >= 1.55)) {
      spawnTitanSwarmReinforcements(world, boss, 12, true);
    }
    return;
  }

  if (boss.breakTimer > 0) {
    const nextBt = boss.breakTimer - FIXED_DT;
    boss.breakTimer = nextBt <= 1e-9 ? 0 : nextBt;
  }

  boss.phaseElapsed += FIXED_DT;
  const t = boss.phaseElapsed;
  boss.fightElapsed += FIXED_DT;
  const enrageAfter = world.script.boss.enrageAfterSec;
  if (enrageAfter !== undefined) {
    boss.enrage =
      1 + clamp((boss.fightElapsed - enrageAfter) * BOSS_ENRAGE_RAMP_PER_SEC, 0, BOSS_ENRAGE_MAX - 1);
  }
  const leftBroken = boss.parts[0]?.destroyed === true;
  const rightBroken = boss.parts[1]?.destroyed === true;
  const staggerScale = boss.breakTimer > 0 ? 0.35 : 1.0;
  const rageDt = FIXED_DT * boss.enrage * staggerScale;
  const liveSwarm = computeDynamicSwarmProfile(world);
  const swarmIntervalScale = boss.hasMetaPower
    ? clamp(0.52 - (boss.titanRank - 2) * 0.032, 0.34, 0.55)
    : liveSwarm.swarmMult >= 1.55
      ? clamp(0.86 / Math.pow(liveSwarm.swarmMult, 0.34), 0.42, 0.72)
      : 1.0;
  const summonTickDt = rageDt * (rightBroken ? 0.28 : 1.0);

  if (boss.orbTimer < 100 && world.doomOrbs.length === 0) {
    boss.doomOrbTimer -= rageDt;
    if (boss.doomOrbTimer <= 0) {
      spawnDoomOrb(world, boss, _events);
      boss.doomOrbTimer = world.mods.blitz ? 4.8 : 5.6;
    }
  }

  // Update active BossHazardZones
  for (let i = boss.hazardZones.length - 1; i >= 0; i--) {
    const z = boss.hazardZones[i];
    if (!z) continue;
    z.elapsed += FIXED_DT;
    if (z.elapsed < z.warningDuration) {
      z.warningProgress = clamp(z.elapsed / z.warningDuration, 0, 1);
      z.firing = false;
    } else if (z.elapsed < z.warningDuration + z.fireDuration) {
      z.warningProgress = 1.0;
      z.firing = true;
    } else {
      boss.hazardZones.splice(i, 1);
    }
  }

  if (boss.id === 'warden_01') {
    if (boss.phase === 1) {
      boss.x = normalizeZero(2.8 * Math.sin(0.85 * t));
      boss.z = BOSS_BASE_Z;

      boss.hazardTimer -= rageDt;
      if (boss.hazardTimer <= 0) {
        spawnTwoOfThreeLaneHazards(world, boss, 0.95, 9);
        boss.hazardTimer = 3.1;
      }

      boss.summonTimer -= summonTickDt;
      if (boss.summonTimer <= 0) {
        for (const [ox, oz] of [
          [-2.4, 2.8],
          [-1.2, 2.1],
          [0, 1.6],
          [1.2, 2.1],
          [2.4, 2.8],
          [-0.6, 3.2],
          [0.6, 3.2],
        ] as const) {
          spawnEnemy(world, 'crawler', clamp(boss.x + ox, -3.6, 3.6), boss.z + oz, { hp: 5 });
        }
        spawnTitanSwarmReinforcements(world, boss, 10);
        boss.summonTimer = 4.6 * swarmIntervalScale;
      }

      boss.lensTimer -= FIXED_DT;
      if (boss.lensTimer <= 0) {
        spawnPrismLens(world, 0, -13.5, 2.4, 2.5, 1.15);
        boss.lensTimer = 10.5;
      }

      boss.orbTimer -= rageDt * (leftBroken ? 0.28 : 1.0);
      if (boss.orbTimer <= 0) {
        if (leftBroken) {
          spawnHostileOrb(world, boss.x, boss.z + 1.5, 0, 15.5, 3, 0.85);
        } else {
          spawnHostileOrb(world, boss.x - 0.9, boss.z + 1.5, 0, 18.0, 5);
          spawnHostileOrb(world, boss.x + 0.9, boss.z + 1.5, 0, 18.0, 5);
        }
        fireTitanFanOrbs(world, boss, 17.5, 5);
        boss.orbTimer = 2.7;
      }
    } else {
      boss.x = normalizeZero(3.2 * Math.sin(1.25 * t));
      boss.z = -19.0;

      boss.hazardTimer -= rageDt;
      if (boss.hazardTimer <= 0) {
        spawnTwoOfThreeLaneHazards(world, boss, 0.85, 10);
        boss.hazardTimer = 2.3;
      }

      boss.summonTimer -= summonTickDt;
      if (boss.summonTimer <= 0) {
        for (const [ox, oz] of [
          [-2.6, 2.6],
          [-1.4, 1.9],
          [-0.4, 2.4],
          [0.4, 2.4],
          [1.4, 1.9],
          [2.6, 2.6],
          [0, 3.3],
        ] as const) {
          spawnEnemy(world, 'crawler', clamp(boss.x + ox, -3.6, 3.6), boss.z + oz, { hp: 5 });
        }
        spawnTitanSwarmReinforcements(world, boss, 12);
        boss.summonTimer = 4.2 * swarmIntervalScale;
      }

      boss.lensTimer -= FIXED_DT;
      if (boss.lensTimer <= 0) {
        spawnPrismLens(world, 0, -13.5, 2.4, 2.6, 1.2);
        boss.lensTimer = 9.5;
      }

      boss.orbTimer -= rageDt * (leftBroken ? 0.28 : 1.0);
      if (boss.orbTimer <= 0) {
        if (leftBroken) {
          spawnHostileOrb(world, boss.x, boss.z + 1.5, 0, 16.0, 3, 0.85);
        } else {
          spawnHostileOrb(world, boss.x - 0.95, boss.z + 1.5, 0, 19.0, 5);
          spawnHostileOrb(world, boss.x + 0.95, boss.z + 1.5, 0, 19.0, 5);
        }
        fireTitanFanOrbs(world, boss, 18.5, 5);
        boss.orbTimer = 2.4;
      }
    }
  } else if (boss.id === 'hydra_02') {
    if (boss.phase === 1) {
      boss.x = normalizeZero(2.3 * Math.sin(0.95 * t));
      boss.z = BOSS_BASE_Z;

      boss.hazardTimer -= rageDt;
      if (boss.hazardTimer <= 0) {
        const leftStrike = boss.hazardCycle % 2 === 0;
        boss.hazardCycle += 1;
        addBossHazard(world, boss, leftStrike ? -2.45 : 2.45, leftBroken ? 1.68 : 2.25, 0.9, 0.35, 11);
        boss.hazardTimer = 2.9;
      }

      boss.orbTimer -= rageDt * (leftBroken ? 0.28 : 1.0);
      if (boss.orbTimer <= 0) {
        if (leftBroken) {
          spawnHostileOrb(world, boss.x, boss.z + 1.6, 0, 16.5, 3, 0.85);
        } else {
          spawnHostileOrb(world, boss.x - 1.35, boss.z + 1.6, -2.2, 18.2, 5, 1.15);
          spawnHostileOrb(world, boss.x + 1.35, boss.z + 1.6, 2.2, 18.2, 5, 1.15);
          fireTitanFanOrbs(world, boss, 17.8, 5);
        }
        boss.orbTimer = 2.8;
      }

      boss.summonTimer -= summonTickDt;
      if (boss.summonTimer <= 0) {
        spawnEnemy(world, 'mitosis', -2.1, boss.z + 2.0);
        spawnEnemy(world, 'mitosis', 2.1, boss.z + 2.0);
        spawnEnemy(world, 'crawler', -3.1, boss.z + 2.8, { hp: 5 });
        spawnEnemy(world, 'crawler', -0.8, boss.z + 2.5, { hp: 5 });
        spawnEnemy(world, 'crawler', 0.8, boss.z + 2.5, { hp: 5 });
        spawnEnemy(world, 'crawler', 3.1, boss.z + 2.8, { hp: 5 });
        spawnTitanSwarmReinforcements(world, boss, 11);
        boss.summonTimer = 4.8 * swarmIntervalScale;
      }

      boss.lensTimer -= FIXED_DT;
      if (boss.lensTimer <= 0) {
        spawnPrismLens(world, 0, -13.5, 2.3, 2.5, 1.15);
        boss.lensTimer = 10.0;
      }
    } else {
      boss.x = normalizeZero(-2.6 * Math.cos(1.15 * t));
      boss.z = -20.5;
      if (boss.secondaryCore) {
        boss.secondaryCore.x = normalizeZero(2.6 * Math.cos(1.15 * t));
        boss.secondaryCore.z = -19.0;
      }

      boss.shieldSwapTimer -= FIXED_DT;
      if (boss.shieldSwapTimer <= 0) {
        boss.shielded = !boss.shielded;
        if (boss.secondaryCore) {
          boss.secondaryCore.shielded = !boss.shielded;
        }
        boss.shieldSwapTimer = rightBroken ? 5.0 : 3.6;
      }

      boss.orbTimer -= rageDt * (leftBroken ? 0.28 : 1.0);
      if (boss.orbTimer <= 0) {
        const dragonX = boss.shielded && boss.secondaryCore ? boss.secondaryCore.x : boss.x;
        if (leftBroken) {
          spawnHostileOrb(world, dragonX, boss.z + 1.6, 0, 17.0, 3, 0.85);
        } else {
          spawnHostileOrb(world, dragonX - 0.9, boss.z + 1.6, -1.8, 19.0, 5, 1.2);
          spawnHostileOrb(world, dragonX + 0.9, boss.z + 1.6, 1.8, 19.0, 5, 1.2);
        }
        boss.orbTimer = 2.6;
      }

      boss.hazardTimer -= rageDt;
      if (boss.hazardTimer <= 0) {
        const casterX = boss.shielded
          ? boss.x
          : boss.secondaryCore
            ? boss.secondaryCore.x
            : boss.x;
        addBossHazard(world, boss, casterX, leftBroken ? 1.32 : 1.75, 0.9, 0.35, 12);
        boss.hazardTimer = 2.5;
      }

      boss.summonTimer -= summonTickDt;
      if (boss.summonTimer <= 0) {
        spawnEnemy(world, 'mitosis', -2.2, -17.5);
        spawnEnemy(world, 'mitosis', 2.2, -17.5);
        spawnEnemy(world, 'crawler', -3.2, -16.6, { hp: 5 });
        spawnEnemy(world, 'crawler', -0.9, -16.8, { hp: 5 });
        spawnEnemy(world, 'crawler', 0.9, -16.8, { hp: 5 });
        spawnEnemy(world, 'crawler', 3.2, -16.6, { hp: 5 });
        spawnTitanSwarmReinforcements(world, boss, 12);
        boss.summonTimer = 5.0 * swarmIntervalScale;
      }
    }
  } else if (boss.id === 'omega_zero') {
    if (boss.phase === 1) {
      boss.x = normalizeZero(1.6 * Math.sin(0.75 * t));
      boss.z = -21.0;

      boss.hazardTimer -= rageDt;
      if (boss.hazardTimer <= 0) {
        spawnTwoOfThreeLaneHazards(world, boss, 0.9, 13);
        boss.hazardTimer = 2.8;
      }

      boss.summonTimer -= summonTickDt;
      if (boss.summonTimer <= 0) {
        for (const [sx, sz] of [
          [-2.8, -17.2],
          [-1.7, -17.5],
          [-0.6, -17.8],
          [0.6, -17.8],
          [1.7, -17.5],
          [2.8, -17.2],
          [0, -16.6],
        ] as const) {
          spawnEnemy(world, 'crawler', sx, sz, { hp: 5 });
        }
        spawnTitanSwarmReinforcements(world, boss, 11);
        boss.summonTimer = 4.8 * swarmIntervalScale;
      }

      boss.orbTimer -= rageDt * (leftBroken ? 0.28 : 1.0);
      if (boss.orbTimer <= 0) {
        if (leftBroken) {
          spawnHostileOrb(world, boss.x, boss.z + 1.6, 0, 16.0, 3, 0.85);
        } else {
          spawnHostileOrb(world, boss.x - 1.1, boss.z + 1.6, -1.2, 18.5, 5, 1.2);
          spawnHostileOrb(world, boss.x + 1.1, boss.z + 1.6, 1.2, 18.5, 5, 1.2);
        }
        boss.orbTimer = 2.9;
      }
    } else if (boss.phase === 2) {
      boss.x = normalizeZero(2.9 * Math.sin(1.1 * t));
      boss.z = -19.5;

      boss.hazardTimer -= rageDt;
      if (boss.hazardTimer <= 0) {
        spawnTwoOfThreeLaneHazards(world, boss, 0.85, 14);
        boss.hazardTimer = 2.6;
      }

      boss.summonTimer -= summonTickDt;
      if (boss.summonTimer <= 0) {
        spawnEnemy(world, 'dasher', -2.6, -21.5);
        spawnEnemy(world, 'dasher', 2.6, -21.5);
        spawnEnemy(world, 'crawler', -1.5, -18.2, { hp: 5 });
        spawnEnemy(world, 'crawler', 0.0, -18.0, { hp: 5 });
        spawnEnemy(world, 'crawler', 1.5, -18.2, { hp: 5 });
        spawnEnemy(world, 'mitosis', 0.0, -19.2);
        spawnTitanSwarmReinforcements(world, boss, 12);
        boss.summonTimer = 4.6 * swarmIntervalScale;
      }

      boss.lensTimer -= FIXED_DT;
      if (boss.lensTimer <= 0) {
        spawnPrismLens(world, 0, -13.0, 2.3, 2.5, 1.15);
        boss.lensTimer = 9.2;
      }

      boss.orbTimer -= rageDt * (leftBroken ? 0.28 : 1.0);
      if (boss.orbTimer <= 0) {
        if (leftBroken) {
          spawnHostileOrb(world, boss.x, boss.z + 1.5, 0, 16.5, 3, 0.85);
        } else {
          spawnHostileOrb(world, boss.x - 1.0, boss.z + 1.5, 0, 19.5, 6);
          spawnHostileOrb(world, boss.x + 1.0, boss.z + 1.5, 0, 19.5, 6);
        }
        fireTitanFanOrbs(world, boss, 19.0, 6);
        boss.orbTimer = 2.6;
      }
    } else {
      boss.x = normalizeZero(2.6 * Math.sin(1.3 * t));
      boss.z = -15.5;

      boss.hazardTimer -= rageDt;
      if (boss.hazardTimer <= 0) {
        spawnTwoOfThreeLaneHazards(world, boss, 0.85, 15);
        boss.hazardTimer = 2.4;
      }

      if (boss.hasMetaPower || liveSwarm.swarmMult >= 1.55) {
        boss.summonTimer -= summonTickDt;
        if (boss.summonTimer <= 0) {
          spawnTitanSwarmReinforcements(world, boss, 14);
          boss.summonTimer = 4.4 * swarmIntervalScale;
        }
      }

      boss.barrelTimer -= FIXED_DT;
      if (boss.barrelTimer <= 0) {
        const cx = clamp(boss.x * 0.5, -TRACK_HALF_WIDTH + 2.6, TRACK_HALF_WIDTH - 2.6);
        spawnBarrel(world, cx, -11.6, 1.8);
        spawnBarrel(world, cx - 1.8, -13.4, 1.8);
        spawnBarrel(world, cx + 1.8, -14.8, 1.8);
        boss.barrelTimer = rightBroken ? 2.75 : 4.0;
      }

      boss.orbTimer -= rageDt * (leftBroken ? 0.28 : 1.0);
      if (boss.orbTimer <= 0) {
        if (leftBroken) {
          spawnHostileOrb(world, boss.x, boss.z + 1.4, 0, 16.5, 3, 0.85);
        } else {
          spawnHostileOrb(world, boss.x - 1.05, boss.z + 1.4, -1.6, 19.5, 6, 1.25);
          spawnHostileOrb(world, boss.x + 1.05, boss.z + 1.4, 1.6, 19.5, 6, 1.25);
        }
        boss.orbTimer = 2.6;
      }
    }
  }

  syncBossShoulderParts(boss);
}

/**
 * Step 7: Evaluates Boss Victory BEFORE Step 8/9 squad attrition so a simultaneous
 * Boss kill + incoming attack cleanly locks VICTORY and clears hostile hazards.
 */
export function checkBossVictory(world: SimWorld, events: SimEvent[]): boolean {
  const boss = world.boss;
  if (
    world.mods.pantheon &&
    boss &&
    !boss.active &&
    boss.hp <= 0 &&
    (!world.pantheonCoBoss || !world.pantheonCoBoss.active || world.pantheonCoBoss.hp <= 0)
  ) {
    world.phase = 'VICTORY';
    world.defeatReason = null;
    events.push({ type: 'RUN_VICTORY', sector: world.sector, finalSquad: world.squadCount });
    return true;
  }
  if (!boss || !boss.active || boss.hp > 0) {
    return false;
  }
  if (world.mods.pantheon && world.pantheonCoBoss && world.pantheonCoBoss.active && world.pantheonCoBoss.hp > 0) {
    // Wait until Co-Boss is also defeated in Stage 4 Simultaneous Dual-Boss Showdown!
    boss.hp = 0;
    boss.active = false;
    boss.shielded = false;
    boss.hazardZones.length = 0;
    events.push({ type: 'BOSS_DEFEAT', x: boss.x, z: boss.z, bossId: boss.id });
    return false;
  }

  boss.hp = 0;
  boss.active = false;
  boss.shielded = false;
  boss.secondaryCore = null;
  boss.hazardZones.length = 0;
  world.doomOrbs.length = 0;

  // Neutralize all remaining hostile projectiles and active enemies
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    if (p && p.hostile) {
      world.projectilePool.release(p);
      world.projectiles.splice(i, 1);
    }
  }
  for (let i = 0; i < world.enemies.length; i++) {
    const e = world.enemies[i];
    if (e && e.active) {
      e.consumed = true;
      e.active = false;
    }
  }

  world.phase = 'VICTORY';
  world.defeatReason = null;

  events.push({
    type: 'BOSS_DEFEAT',
    x: boss.x,
    z: boss.z,
    bossId: boss.id,
  });
  if (world.mods.pantheon) {
    const res = resolvePantheonBossClear(world, events);
    if (res === 'advanced') {
      return true;
    }
  }
  if (world.endless) {
    world.phase = 'PLAYING';
    const stage = advanceEndlessStage(world);
    events.push({
      type: 'ENDLESS_STAGE_START',
      wave: stage.wave,
      bosses: stage.bosses,
      bonus: stage.bonus,
    });
    return true;
  }

  events.push({
    type: 'RUN_VICTORY',
    sector: world.sector,
    finalSquad: world.squadCount,
  });
  return true;
}

/**
 * Step 9b: Evaluates firing BossHazardZones and hostile Boss projectiles against the squad.
 * Returns true if squadCount reached 0 and transitioned to DEFEAT.
 */
export function resolveBossAttacks(world: SimWorld, events: SimEvent[]): boolean {
  const boss = world.boss;
  if (boss && boss.active && boss.hp > 0) {
    if (boss.enrage > 1) {
      boss.enragePulseTimer -= FIXED_DT;
      if (boss.enragePulseTimer <= 0) {
        boss.enragePulseTimer += BOSS_ENRAGE_PULSE_SEC;
        const before = world.squadCount;
        world.squadCount = clampSquadCount(before - scaledBossLoss(BOSS_ENRAGE_PULSE_LOSS, before));
        const lost = before - world.squadCount;
        if (lost > 0) {
          events.push({ type: 'SQUAD_LOSS', x: world.squadX, z: PLAYER_Z, lost, reason: 'BOSS_ATTACK' });
        }
        if (world.squadCount === 0) {
          world.phase = 'DEFEAT';
          world.defeatReason = 'BOSS_ATTACK';
          events.push({ type: 'RUN_DEFEAT', sector: world.sector, reason: 'BOSS_ATTACK' });
          return true;
        }
      }
    }
    for (let i = 0; i < boss.hazardZones.length; i++) {
      const zone = boss.hazardZones[i];
      if (!zone || !zone.firing || zone.damageApplied) {
        continue;
      }

      const hitMainHz = Math.abs(world.squadX - zone.x) <= zone.halfWidth + 0.45 * world.formationRadius;
      const hitTwinHz =
        !hitMainHz &&
        hasMutator(world, 'mirror_twin') &&
        Math.abs(world.squadX) > 0.45 &&
        Math.abs(-world.squadX - zone.x) <= zone.halfWidth + 0.35 * world.formationRadius;
      if (hitMainHz || hitTwinHz) {
        zone.damageApplied = true;
        const baseStrike = scaledBossLoss(zone.strikeLoss, world.squadCount);
        const rawStrike = Math.max(1, Math.round(baseStrike * (hitTwinHz ? 0.6 : 1.0)));
        const mitigatedStrike = mitigateLossWithAegis(world, rawStrike, events);
        const before = world.squadCount;
        world.squadCount = clampSquadCount(before - mitigatedStrike);
        const lost = before - world.squadCount;

        if (lost > 0) {
          events.push({
            type: 'SQUAD_LOSS',
            x: hitTwinHz ? -world.squadX : world.squadX,
            z: PLAYER_Z,
            lost,
            reason: 'BOSS_ATTACK',
          });
          deployReserveIfAvailable(world, lost, events);
        }

        if (world.squadCount === 0) {
          world.phase = 'DEFEAT';
          world.defeatReason = 'BOSS_ATTACK';
          events.push({
            type: 'RUN_DEFEAT',
            sector: world.sector,
            reason: 'BOSS_ATTACK',
          });
          return true;
        }
      }
    }
  }

  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    if (!p || !p.active || !p.hostile) {
      continue;
    }
    if (world.squadAirY > 0.6 && p.prevZ < PLAYER_Z && p.z >= PLAYER_Z) {
      world.projectilePool.release(p);
      world.projectiles.splice(i, 1);
      continue;
    }

    const hitMainOrb = intersectSweptSegmentAABB(
      p.prevX,
      p.prevZ,
      p.x,
      p.z,
      p.radius,
      world.prevSquadX,
      PLAYER_Z,
      world.squadX,
      PLAYER_Z,
      world.formationRadius,
      0.28,
    );
    const hitTwinOrb =
      hitMainOrb === null && hasMutator(world, 'mirror_twin') && Math.abs(world.squadX) > 0.45
        ? intersectSweptSegmentAABB(
            p.prevX,
            p.prevZ,
            p.x,
            p.z,
            p.radius,
            -world.prevSquadX,
            PLAYER_Z,
            -world.squadX,
            PLAYER_Z,
            world.formationRadius * 0.85,
            0.28,
          )
        : null;
    const hit = hitMainOrb ?? hitTwinOrb;

    if (hit !== null) {
      world.projectilePool.release(p);
      world.projectiles.splice(i, 1);

      const baseOrbLoss = scaledBossLoss(p.hostileLoss, world.squadCount);
      const rawOrbLoss = Math.max(1, Math.round(baseOrbLoss * (hitMainOrb === null ? 0.6 : 1.0)));
      const mitigatedOrbLoss = mitigateLossWithAegis(world, rawOrbLoss, events);
      const before = world.squadCount;
      world.squadCount = clampSquadCount(before - mitigatedOrbLoss);
      const lost = before - world.squadCount;

      if (lost > 0) {
        events.push({
          type: 'SQUAD_LOSS',
          x: hit.hitX,
          z: PLAYER_Z,
          lost,
          reason: 'BOSS_ATTACK',
        });
        deployReserveIfAvailable(world, lost, events);
      }

      if (world.squadCount === 0) {
        world.phase = 'DEFEAT';
        world.defeatReason = 'BOSS_ATTACK';
        events.push({
          type: 'RUN_DEFEAT',
          sector: world.sector,
          reason: 'BOSS_ATTACK',
        });
        return true;
      }
    }
  }

  return false;
}
