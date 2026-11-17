import type { SimEvent } from '../types/game';
import { FIXED_DT, PLAYER_Z, RESONANCE_GAIN_VAULT_BREAK, TRACK_HALF_WIDTH } from '../config/constants';
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
import { mitigateLossWithAegis } from './aegis';
import { createBossShoulderParts, hasMutator, spawnDoomOrb, syncBossShoulderParts } from './competition';
import { spawnPrismLens } from './weapons';

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
  const bossMaxHp = Math.round(bossCfg.maxHp * hpMult);
  const pylons: SimBossPylon[] = [];
  let initialShielded = false;

  if (bossCfg.id === 'omega_zero') {
    const pylonHp = Math.round((bossCfg.pylonHp ?? 3500) * hpMult);
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
    halfWidth: bossCfg.id === 'hydra_02' ? 2.4 : bossCfg.id === 'omega_zero' ? 2.3 : 2.1,
    halfDepth: 1.5,
    hp: bossMaxHp,
    maxHp: bossMaxHp,
    secondaryCore: null,
    shielded: initialShielded,
    pylons,
    parts: createBossShoulderParts(world, bossMaxHp),
    breakTimer: 0,
    doomOrbTimer: world.mods.blitz ? 3.2 : 4.6,
    hazardZones: [],
    hitPulse: 0,
    introProgress: 0,
    phaseElapsed: 0,
    fightElapsed: 0,
    enrage: 1,
    enragePulseTimer: BOSS_ENRAGE_PULSE_SEC,
    hazardTimer: 1.5,
    hazardCycle: 0,
    summonTimer: 3.2,
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
  orb.powerScale = 1.1;
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
      events.push({
        type: 'BOSS_PHASE_BREAK',
        phase: 2,
        x: boss.x,
        z: boss.z,
      });
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
      boss.halfWidth = 1.75;
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
        halfWidth: 1.75,
        halfDepth: 1.35,
        shielded: true,
      };
      events.push({
        type: 'BOSS_PHASE_BREAK',
        phase: 2,
        x: 0,
        z: boss.z,
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
      boss.summonTimer = 2.4;
      boss.lensTimer = 2.0;
      events.push({
        type: 'BOSS_PHASE_BREAK',
        phase: 2,
        x: boss.x,
        z: boss.z,
      });
    }
    if (boss.phase === 2 && boss.hp <= boss.maxHp * 0.3) {
      boss.phase = 3;
      boss.phaseElapsed = 0;
      boss.hazardZones.length = 0;
      boss.hazardTimer = 1.25;
      boss.barrelTimer = 0.6;
      boss.z = -15.5;
      events.push({
        type: 'BOSS_PHASE_BREAK',
        phase: 3,
        x: boss.x,
        z: boss.z,
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

  if (hitSecondary) {
    if (!boss.secondaryCore || boss.secondaryCore.shielded) {
      return;
    }
    // Hydra-02 Phase 2 exposed secondary core takes 1.5x weakpoint damage (and 2.0x more during BREAK!)
    const secBreakMult = boss.breakTimer > 0 ? 2.0 : 1.0;
    boss.hitPulse = 1.0;
    boss.hp = Math.max(0, boss.hp - rawDamage * 1.5 * secBreakMult);
    checkBossPhaseTransitions(world, events);
    return;
  }

  if (boss.shielded) {
    return;
  }

  const weakpointMult = (boss.id === 'hydra_02' && boss.phase === 2 ? 1.5 : 1.0) * (boss.breakTimer > 0 ? 2.0 : 1.0);
  boss.hitPulse = 1.0;
  boss.hp = Math.max(0, boss.hp - rawDamage * weakpointMult);
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
      boss.hitPulse = 1.0;
      boss.hp = Math.max(0, boss.hp - blastDamage);
      checkBossPhaseTransitions(world, events);
      return;
    }
  }

  if (boss.secondaryCore && !boss.secondaryCore.shielded) {
    const sec = boss.secondaryCore;
    if (Math.hypot(sec.x - barrelX, sec.z - barrelZ) <= blastRadius + sec.halfWidth) {
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
    boss.enrage = 1 + clamp((boss.fightElapsed - enrageAfter) * BOSS_ENRAGE_RAMP_PER_SEC, 0, BOSS_ENRAGE_MAX - 1);
  }
  const leftBroken = boss.parts[0]?.destroyed === true;
  const rightBroken = boss.parts[1]?.destroyed === true;
  const staggerScale = boss.breakTimer > 0 ? 0.35 : 1.0;
  const rageDt = FIXED_DT * boss.enrage * staggerScale;

  if (boss.orbTimer < 100 && world.doomOrbs.length === 0) {
    boss.doomOrbTimer -= rageDt;
    if (boss.doomOrbTimer <= 0) {
      spawnDoomOrb(world, boss, _events);
      boss.doomOrbTimer = world.mods.blitz ? 5.6 : 6.8;
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

      boss.summonTimer -= rageDt * (rightBroken ? 0.45 : 1.0);
      if (boss.summonTimer <= 0) {
        for (const [ox, oz] of [[-2.4, 2.8], [-1.2, 2.1], [0, 1.6], [1.2, 2.1], [2.4, 2.8], [-0.6, 3.2], [0.6, 3.2]] as const) {
          spawnEnemy(world, 'crawler', clamp(boss.x + ox, -3.6, 3.6), boss.z + oz, { hp: 5 });
        }
        boss.summonTimer = 4.6;
      }

      boss.lensTimer -= FIXED_DT;
      if (boss.lensTimer <= 0) {
        spawnPrismLens(world, 0, -13.5, 2.4, 2.5, 1.15);
        boss.lensTimer = 10.5;
      }

      boss.orbTimer -= rageDt * (leftBroken ? 0.42 : 1.0);
      if (boss.orbTimer <= 0) {
        spawnHostileOrb(world, boss.x - 0.9, boss.z + 1.5, 0, 18.0, 5);
        spawnHostileOrb(world, boss.x + 0.9, boss.z + 1.5, 0, 18.0, 5);
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

      boss.summonTimer -= rageDt * (rightBroken ? 0.45 : 1.0);
      if (boss.summonTimer <= 0) {
        for (const [ox, oz] of [[-2.6, 2.6], [-1.4, 1.9], [-0.4, 2.4], [0.4, 2.4], [1.4, 1.9], [2.6, 2.6], [0, 3.3]] as const) {
          spawnEnemy(world, 'crawler', clamp(boss.x + ox, -3.6, 3.6), boss.z + oz, { hp: 5 });
        }
        boss.summonTimer = 4.2;
      }

      boss.lensTimer -= FIXED_DT;
      if (boss.lensTimer <= 0) {
        spawnPrismLens(world, 0, -13.5, 2.4, 2.6, 1.2);
        boss.lensTimer = 9.5;
      }

      boss.orbTimer -= rageDt * (leftBroken ? 0.42 : 1.0);
      if (boss.orbTimer <= 0) {
        spawnHostileOrb(world, boss.x - 0.95, boss.z + 1.5, 0, 19.0, 5);
        spawnHostileOrb(world, boss.x + 0.95, boss.z + 1.5, 0, 19.0, 5);
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
        addBossHazard(world, boss, leftStrike ? -2.45 : 2.45, 2.25, 0.9, 0.35, 11);
        boss.hazardTimer = 2.9;
      }

      boss.summonTimer -= rageDt * (rightBroken ? 0.45 : 1.0);
      if (boss.summonTimer <= 0) {
        spawnEnemy(world, 'mitosis', -2.1, boss.z + 2.0);
        spawnEnemy(world, 'mitosis', 2.1, boss.z + 2.0);
        spawnEnemy(world, 'crawler', -3.1, boss.z + 2.8, { hp: 5 });
        spawnEnemy(world, 'crawler', -0.8, boss.z + 2.5, { hp: 5 });
        spawnEnemy(world, 'crawler', 0.8, boss.z + 2.5, { hp: 5 });
        spawnEnemy(world, 'crawler', 3.1, boss.z + 2.8, { hp: 5 });
        boss.summonTimer = 4.8;
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
        boss.shieldSwapTimer = 3.6;
      }

      boss.hazardTimer -= rageDt;
      if (boss.hazardTimer <= 0) {
        const casterX = boss.shielded
          ? boss.x
          : boss.secondaryCore
            ? boss.secondaryCore.x
            : boss.x;
        addBossHazard(world, boss, casterX, 1.75, 0.9, 0.35, 12);
        boss.hazardTimer = 2.5;
      }

      boss.summonTimer -= rageDt * (rightBroken ? 0.45 : 1.0);
      if (boss.summonTimer <= 0) {
        spawnEnemy(world, 'mitosis', -2.2, -17.5);
        spawnEnemy(world, 'mitosis', 2.2, -17.5);
        spawnEnemy(world, 'crawler', -3.2, -16.6, { hp: 5 });
        spawnEnemy(world, 'crawler', -0.9, -16.8, { hp: 5 });
        spawnEnemy(world, 'crawler', 0.9, -16.8, { hp: 5 });
        spawnEnemy(world, 'crawler', 3.2, -16.6, { hp: 5 });
        boss.summonTimer = 5.0;
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

      boss.summonTimer -= rageDt * (rightBroken ? 0.45 : 1.0);
      if (boss.summonTimer <= 0) {
        for (const [sx, sz] of [[-2.8, -17.2], [-1.7, -17.5], [-0.6, -17.8], [0.6, -17.8], [1.7, -17.5], [2.8, -17.2], [0, -16.6]] as const) {
          spawnEnemy(world, 'crawler', sx, sz, { hp: 5 });
        }
        boss.summonTimer = 4.8;
      }
    } else if (boss.phase === 2) {
      boss.x = normalizeZero(2.9 * Math.sin(1.1 * t));
      boss.z = -19.5;

      boss.hazardTimer -= rageDt;
      if (boss.hazardTimer <= 0) {
        spawnTwoOfThreeLaneHazards(world, boss, 0.85, 14);
        boss.hazardTimer = 2.6;
      }

      boss.summonTimer -= rageDt * (rightBroken ? 0.45 : 1.0);
      if (boss.summonTimer <= 0) {
        spawnEnemy(world, 'dasher', -2.6, -21.5);
        spawnEnemy(world, 'dasher', 2.6, -21.5);
        spawnEnemy(world, 'crawler', -1.5, -18.2, { hp: 5 });
        spawnEnemy(world, 'crawler', 0.0, -18.0, { hp: 5 });
        spawnEnemy(world, 'crawler', 1.5, -18.2, { hp: 5 });
        spawnEnemy(world, 'mitosis', 0.0, -19.2);
        boss.summonTimer = 4.6;
      }

      boss.lensTimer -= FIXED_DT;
      if (boss.lensTimer <= 0) {
        spawnPrismLens(world, 0, -13.0, 2.3, 2.5, 1.15);
        boss.lensTimer = 9.2;
      }

      boss.orbTimer -= rageDt * (leftBroken ? 0.42 : 1.0);
      if (boss.orbTimer <= 0) {
        spawnHostileOrb(world, boss.x - 1.0, boss.z + 1.5, 0, 19.5, 6);
        spawnHostileOrb(world, boss.x + 1.0, boss.z + 1.5, 0, 19.5, 6);
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

      boss.barrelTimer -= FIXED_DT;
      if (boss.barrelTimer <= 0) {
        const cx = clamp(boss.x * 0.5, -TRACK_HALF_WIDTH + 2.6, TRACK_HALF_WIDTH - 2.6);
        spawnBarrel(world, cx, -11.6, 1.8);
        spawnBarrel(world, cx - 1.8, -13.4, 1.8);
        spawnBarrel(world, cx + 1.8, -14.8, 1.8);
        boss.barrelTimer = 4.0;
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
  if (!boss || !boss.active || boss.hp > 0) {
    return false;
  }

  boss.hp = 0;
  boss.active = false;
  boss.shielded = false;
  boss.secondaryCore = null;
  boss.hazardZones.length = 0;

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

      if (Math.abs(world.squadX - zone.x) <= zone.halfWidth + 0.45 * world.formationRadius) {
        zone.damageApplied = true;
        const rawStrike = scaledBossLoss(zone.strikeLoss, world.squadCount);
        const mitigatedStrike = mitigateLossWithAegis(world, rawStrike, events);
        const before = world.squadCount;
        world.squadCount = clampSquadCount(before - mitigatedStrike);
        const lost = before - world.squadCount;

        if (lost > 0) {
          events.push({
            type: 'SQUAD_LOSS',
            x: world.squadX,
            z: PLAYER_Z,
            lost,
            reason: 'BOSS_ATTACK',
          });
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

    const hit = intersectSweptSegmentAABB(
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

    if (hit !== null) {
      world.projectilePool.release(p);
      world.projectiles.splice(i, 1);

      const rawOrbLoss = scaledBossLoss(p.hostileLoss, world.squadCount);
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
