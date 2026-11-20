import { DESPAWN_Z, FIXED_DT, PLAYER_Z, TRACK_HALF_WIDTH } from '../config/constants';
import type { SectorScriptConfig } from '../config/sectors';
import type {
  BossId,
  CollapseRiftKind,
  CoreReactorTier,
  FormationKind,
  PantheonCoBossSnapshot,
  SimEvent,
  TacticalEventKind,
} from '../types/game';
import { mitigateLossWithAegis } from './aegis';
import { spawnBarrel } from './barrels';
import {
  deployReserveIfAvailable,
  grantSquadWithReserve,
  recordDamage,
  spawnJumpPad,
  spawnReflector,
} from './competition';
import { damageEnemy, spawnEnemy } from './enemies';
import type {
  SimCollapseRift,
  SimEnemy,
  SimHighSpire,
  SimPantheonCoBoss,
  SimTacticalEvent,
  SimWorld,
} from './entities';
import { applyFlatDeltaToGate } from './gates';
import { clamp, clampSquadCount, normalizeZero } from './math';
import { addResonance } from './resonance';
import { computeTieredEnemyHp } from './spawner';
import { spawnCapacitorTower, spawnCoreShard, spawnMagRail } from './v20Mechanics';
import { spawnPrismLens, spawnVault } from './weapons';

function allocV21Id(world: SimWorld): number {
  world.spectacleIdSeq = (world.spectacleIdSeq ?? 0) + 1;
  return 910000 + world.spectacleIdSeq;
}

// ===========================================================================
// Stage 1: Dynamic Sector Terrain Collapse & Verticality (`CollapseRift` & `HighSpire`)
// ===========================================================================
export function spawnCollapseRift(
  world: SimWorld,
  x: number,
  z: number,
  length = 6.2,
  kind: CollapseRiftKind = 'flank_chasm',
): SimCollapseRift {
  const halfWidth = kind === 'bridge_gap' ? 3.55 : 1.05;
  const clampedX =
    kind === 'bridge_gap'
      ? 0
      : normalizeZero(clamp(x, -TRACK_HALF_WIDTH + halfWidth + 0.1, TRACK_HALF_WIDTH - halfWidth - 0.1));
  const rift: SimCollapseRift = {
    id: allocV21Id(world),
    kind,
    x: clampedX,
    z,
    length,
    halfWidth,
    leaped: false,
    damaged: false,
    active: true,
  };
  world.collapseRifts.push(rift);

  // Always pair a full `bridge_gap` with an upstream Jump Pad + Mag-Rail bypass so skilled play turns verticality into bonus!
  if (kind === 'bridge_gap' && !world.isFiringRange) {
    const vz = world.currentScrollSpeed;
    spawnJumpPad(world, -1.65, z + length * 0.5 + 3.2, vz);
    spawnMagRail(world, 2.85, z, length + 4.5, 1);
  }
  return rift;
}

export function spawnHighSpire(
  world: SimWorld,
  x: number,
  z: number,
  hp?: number,
): SimHighSpire {
  const baseHp = hp ?? Math.max(95, Math.round(world.trueSquadDps * 0.85));
  const spire: SimHighSpire = {
    id: allocV21Id(world),
    prevX: normalizeZero(x),
    prevZ: z,
    x: normalizeZero(clamp(x, -TRACK_HALF_WIDTH + 0.95, TRACK_HALF_WIDTH - 0.95)),
    z,
    elevationY: 2.85,
    radius: 0.98,
    hp: baseHp,
    maxHp: baseHp,
    shieldHp: Math.round(baseHp * 0.65),
    maxShieldHp: Math.round(baseHp * 0.65),
    chargeTimer: 0,
    chargeDuration: 2.6,
    hitPulse: 0,
    destroyed: false,
    active: true,
  };
  world.highSpires.push(spire);
  return spire;
}

export function damageHighSpire(
  world: SimWorld,
  spire: SimHighSpire,
  rawDamage: number,
  highAngleStrike: boolean,
  events: SimEvent[],
): boolean {
  if (!spire.active || spire.destroyed || rawDamage <= 0) return false;

  // Verticality Rule: Airborne Squad (`squadAirY > 0.55`), Refracted/Amplified shots, or Mortar arcs shatter High-Ground Shields at 2.6x!
  const elevatedAdvantage = highAngleStrike || world.squadAirY > 0.55;
  let dmg = rawDamage * (elevatedAdvantage ? 2.6 : 0.45);
  spire.hitPulse = 1.0;

  if (spire.shieldHp > 0) {
    if (elevatedAdvantage) {
      const shUsed = Math.min(spire.shieldHp, dmg * 1.35);
      spire.shieldHp = Math.max(0, spire.shieldHp - shUsed);
      dmg = Math.max(0, dmg - shUsed * 0.35);
    } else {
      const shAbsorb = Math.min(spire.shieldHp, dmg);
      spire.shieldHp = Math.max(0, spire.shieldHp - shAbsorb);
      dmg = Math.max(1, (dmg - shAbsorb) * 0.4);
    }
  }

  spire.hp = Math.max(0, spire.hp - dmg);
  recordDamage(world, elevatedAdvantage ? 'fusions' : world.weapon, Math.min(spire.maxHp, dmg));

  if (spire.hp <= 0) {
    spire.hp = 0;
    spire.shieldHp = 0;
    spire.destroyed = true;
    spire.active = false;
    grantSquadWithReserve(world, 8, events);
    addResonance(world, 0.30, events);
    spawnCoreShard(world, spire.x - 0.35, spire.z, 2);
    spawnCoreShard(world, spire.x + 0.35, spire.z, 1);
    events.push({
      type: 'SPIRE_SHATTER',
      x: spire.x,
      z: spire.z,
      elevated: elevatedAdvantage,
    });
    return true;
  }
  return false;
}

export function stepV21Verticality(world: SimWorld, events: SimEvent[]): void {
  // Schedule Verticality Encounters in Campaign 1-3 & Endless Wave 2+ ONLY when player actively steers (0 AFK interference!)
  if (
    !world.boss &&
    !world.isFiringRange &&
    !world.mods.pantheon &&
    world.currentScrollSpeed > 1 &&
    world.playerHasSteered
  ) {
    const vStage = world.endless
      ? Math.floor((world.simTime + 3.0) / 18.0)
      : world.runwayProgress >= 0.68
        ? 2
        : world.runwayProgress >= 0.36
          ? 1
          : 0;
    if (vStage > world.lastVertStage) {
      world.lastVertStage = vStage;
      const side: 1 | -1 = (vStage + world.sector) % 2 === 0 ? 1 : -1;
      if (vStage === 1) {
        spawnCollapseRift(world, side * 3.82, PLAYER_Z - 38.0, 7.0, 'flank_chasm');
        spawnHighSpire(world, -side * 3.35, PLAYER_Z - 40.0);
        const rf = spawnReflector(world, 0, PLAYER_Z - 33.5, 0, -side as 1 | -1);
        rf.angleDeg = -side * 37;
      } else {
        spawnCollapseRift(world, 0, PLAYER_Z - 42.0, 5.4, 'bridge_gap');
        spawnHighSpire(world, side * 3.35, PLAYER_Z - 44.5);
      }
    }
  }

  const scrollDz = world.isFiringRange ? 0 : world.currentScrollSpeed * FIXED_DT;

  // 1. Step Collapse Rifts (`bridge_gap` & `flank_chasm`)
  for (let i = world.collapseRifts.length - 1; i >= 0; i--) {
    const r = world.collapseRifts[i]!;
    if (!r.active) {
      world.collapseRifts.splice(i, 1);
      continue;
    }
    r.z += scrollDz;
    const zFront = r.z + r.length * 0.5;
    const zBack = r.z - r.length * 0.5;

    // Pull fodder enemies slightly toward flank chasm rim for dramatic abyss tumbles
    if (r.kind === 'flank_chasm') {
      for (let k = 0; k < world.enemies.length; k++) {
        const e = world.enemies[k];
        if (!e || !e.active || !e.isSwarmFodder || e.consumed || e.hp <= 0) continue;
        if (e.z >= zBack && e.z <= zFront && Math.abs(e.x - r.x) <= r.halfWidth + 0.35) {
          e.hp = 0;
          e.consumed = true;
          e.active = false;
        }
      }
    }

    if (zBack <= PLAYER_Z && zFront >= PLAYER_Z) {
      const inLane = Math.abs(world.squadX - r.x) <= r.halfWidth;
      if (inLane) {
        if (world.squadAirY > 0.45 || world.onMagRail) {
          if (!r.leaped) {
            r.leaped = true;
            const bonusSquad = grantSquadWithReserve(world, 6, events);
            addResonance(world, 0.22, events);
            events.push({ type: 'RIFT_LEAP_BONUS', bonusSquad, x: world.squadX, z: PLAYER_Z, kind: r.kind });
          }
        } else if (!r.damaged && !world.isFiringRange && world.aegisTimer <= 0) {
          r.damaged = true;
          const rawLoss = Math.min(8, Math.max(2, Math.floor(world.squadCount * 0.08)));
          const loss = mitigateLossWithAegis(world, rawLoss, events);
          if (loss > 0 && world.squadCount > 2) {
            world.squadCount = Math.max(1, world.squadCount - loss);
            events.push({ type: 'SQUAD_LOSS', x: world.squadX, z: PLAYER_Z, lost: loss, reason: 'ENEMY_BREACH' });
            deployReserveIfAvailable(world, loss, events);
          }
        }
      }
    }

    if (zBack > DESPAWN_Z) {
      r.active = false;
      world.collapseRifts.splice(i, 1);
    }
  }

  // 2. Step Elevated Prism Sniper Spires (`HighSpire`)
  for (let i = world.highSpires.length - 1; i >= 0; i--) {
    const sp = world.highSpires[i]!;
    if (!sp.active || sp.destroyed) {
      world.highSpires.splice(i, 1);
      continue;
    }
    sp.prevX = sp.x;
    sp.prevZ = sp.z;
    sp.z += scrollDz;
    if (sp.hitPulse > 0) sp.hitPulse = Math.max(0, sp.hitPulse - FIXED_DT * 4.5);

    if (sp.z > -46 && sp.z < PLAYER_Z - 6.5) {
      const prevProg = sp.chargeTimer / sp.chargeDuration;
      sp.chargeTimer += FIXED_DT;
      const nextProg = sp.chargeTimer / sp.chargeDuration;
      if (prevProg < 0.55 && nextProg >= 0.55) {
        events.push({ type: 'SPIRE_CHARGE', x: sp.x, z: sp.z, y: sp.elevationY });
      }
      if (sp.chargeTimer >= sp.chargeDuration) {
        sp.chargeTimer = 0;
        if (!world.isFiringRange) {
          const orb = world.projectilePool.acquire();
          orb.id = allocV21Id(world);
          orb.hostile = true;
          orb.hostileLoss = 3;
          orb.weapon = 'rail';
          orb.radius = 0.36;
          orb.damage = 0;
          orb.remainingPierce = 0;
          orb.amplified = false;
          orb.powerScale = 1.1;
          orb.distanceTraveled = 0;
          orb.maxRange = 70;
          orb.splashRadius = 0;
          orb.splashDamageRatio = 0;
          orb.cryoSlowDuration = 0;
          orb.sweepStartFraction = 0;
          const dx = world.squadX - sp.x;
          const dz = PLAYER_Z - sp.z;
          const len = Math.max(1, Math.hypot(dx, dz));
          orb.vx = (dx / len) * 16.5;
          orb.vz = Math.max(11.0, (dz / len) * 16.5);
          orb.prevX = sp.x;
          orb.prevZ = sp.z;
          orb.x = sp.x;
          orb.z = sp.z;
          orb.active = true;
          world.projectiles.push(orb);
        }
      }
    }

    if (sp.z > DESPAWN_Z) {
      sp.active = false;
      world.highSpires.splice(i, 1);
    }
  }
}

// ===========================================================================
// Stage 2A: Elite Horde Tactical Squad Formations (`aegis_refract` & `pincer_ambush`)
// ===========================================================================
export function spawnTacticalFormation(
  world: SimWorld,
  kind: FormationKind,
  centerX: number,
  centerZ: number,
): number {
  const formId = allocV21Id(world);
  const cx = clamp(centerX, -2.6, 2.6);

  if (kind === 'aegis_refract') {
    // Front Twin Phalanx Shields + Rear Beholder Prism Commander Node
    const pLeft = spawnEnemy(world, 'phalanx', cx - 1.25, centerZ + 2.1, {
      hp: computeTieredEnemyHp(world, 'phalanx'),
      customId: allocV21Id(world),
    });
    const pRight = spawnEnemy(world, 'phalanx', cx + 1.25, centerZ + 2.1, {
      hp: computeTieredEnemyHp(world, 'phalanx'),
      customId: allocV21Id(world),
    });
    const leader = spawnEnemy(world, 'beholder', cx, centerZ - 0.8, {
      hp: Math.round(computeTieredEnemyHp(world, 'beholder') * 1.15),
      customId: allocV21Id(world),
    });
    pLeft.formationId = formId;
    pLeft.formationKind = kind;
    pRight.formationId = formId;
    pRight.formationKind = kind;
    leader.formationId = formId;
    leader.formationKind = kind;
    leader.isFormationLeader = true;
  } else {
    // Pincer Ambush: Flanking Burrower + Stalker Escorts + Central Howler Pack Commander
    const fLeft = spawnEnemy(world, 'burrower', -3.55, centerZ + 1.4, {
      hp: computeTieredEnemyHp(world, 'burrower'),
      customId: allocV21Id(world),
    });
    const fRight = spawnEnemy(world, 'stalker', 3.55, centerZ + 1.4, {
      hp: computeTieredEnemyHp(world, 'stalker'),
      customId: allocV21Id(world),
    });
    const bEscort = spawnEnemy(world, 'bomber', cx, centerZ + 2.4, {
      hp: computeTieredEnemyHp(world, 'bomber'),
      customId: allocV21Id(world),
    });
    const leader = spawnEnemy(world, 'howler', cx, centerZ - 0.9, {
      hp: Math.round(computeTieredEnemyHp(world, 'howler') * 1.15),
      customId: allocV21Id(world),
    });
    for (const m of [fLeft, fRight, bEscort]) {
      m.formationId = formId;
      m.formationKind = kind;
    }
    leader.formationId = formId;
    leader.formationKind = kind;
    leader.isFormationLeader = true;
  }
  return formId;
}

export function stepTacticalFormations(world: SimWorld, events: SimEvent[]): void {
  // Spawn coordinated Tactical Squad Formations in active mid/late runs when player has steered
  if (
    !world.boss &&
    !world.isFiringRange &&
    !world.mods.pantheon &&
    world.playerHasSteered &&
    world.enemies.length < 180
  ) {
    const fStage = world.endless
      ? Math.floor((world.simTime + 4.0) / 16.0)
      : world.stats.kills >= 95 && world.runwayProgress >= 0.52 && world.runwayProgress <= 0.88
        ? 1
        : 0;
    if (fStage > world.lastFormationStage) {
      world.lastFormationStage = fStage;
      const kind: FormationKind = fStage % 2 === 1 ? 'aegis_refract' : 'pincer_ambush';
      const cx = ((fStage + world.sector) % 2 === 0 ? 1 : -1) * 1.15;
      spawnTacticalFormation(world, kind, cx, PLAYER_Z - 42.0);
      events.push({ type: 'FORMATION_DEPLOY', kind, x: cx, z: PLAYER_Z - 42.0 });
    }
  }

  // Active Formation AI:
  // - `aegis_refract`: while Commander lives, front Phalanx escorts regenerate 12% shield/s and hold tight guard X!
  // - `pincer_ambush`: while Commander lives, flanking pincers converge smoothly toward squadX!
  const activeLeaders = new Map<number, SimEnemy>();
  for (let i = 0; i < world.enemies.length; i++) {
    const e = world.enemies[i];
    if (e && e.active && !e.consumed && e.hp > 0 && e.isFormationLeader && e.formationId) {
      activeLeaders.set(e.formationId, e);
    }
  }
  if (activeLeaders.size === 0) return;

  for (let i = 0; i < world.enemies.length; i++) {
    const e = world.enemies[i];
    if (!e || !e.active || e.consumed || e.hp <= 0 || e.isFormationLeader || !e.formationId) continue;
    const leader = activeLeaders.get(e.formationId);
    if (!leader) continue;

    if (e.formationKind === 'aegis_refract' && e.maxShieldHp > 0) {
      e.shieldHp = Math.min(e.maxShieldHp, e.shieldHp + e.maxShieldHp * 0.12 * FIXED_DT);
    } else if (e.formationKind === 'pincer_ambush' && e.z > -32 && e.z < PLAYER_Z - 2.0) {
      const pull = clamp(world.squadX - e.x, -1, 1) * 2.1 * FIXED_DT;
      e.x = normalizeZero(clamp(e.x + pull, -TRACK_HALF_WIDTH + e.radius, TRACK_HALF_WIDTH - e.radius));
    }
  }
}

export function triggerFormationLeaderBacklash(
  world: SimWorld,
  leader: SimEnemy,
  events: SimEvent[],
): void {
  if (!leader.isFormationLeader || !leader.formationId) return;
  const fid = leader.formationId;
  let stunned = 0;

  const snapLen = world.enemies.length;
  for (let i = 0; i < snapLen; i++) {
    const wing = world.enemies[i];
    if (!wing || !wing.active || wing.consumed || wing.hp <= 0 || wing.id === leader.id) continue;
    if (wing.formationId !== fid) continue;

    stunned += 1;
    wing.shieldHp = 0;
    wing.armorBroken = true;
    wing.slowTimer = Math.max(wing.slowTimer, 2.4);
    const backlashDmg = Math.max(25, Math.round(wing.maxHp * 0.45));
    events.push({
      type: 'CHAIN_ARC',
      fromX: leader.x,
      fromZ: leader.z,
      toX: wing.x,
      toZ: wing.z,
      damage: backlashDmg,
      webColor: 0xff5ce0,
    });
    recordDamage(world, 'deflect', Math.min(wing.hp, backlashDmg));
    damageEnemy(world, wing, backlashDmg, 2.4, events, { bypassShield: true, chainDepth: 2 });
  }

  if (stunned > 0) {
    addResonance(world, 0.24, events);
    spawnCoreShard(world, leader.x, leader.z, 2);
    events.push({
      type: 'FORMATION_BACKLASH',
      x: leader.x,
      z: leader.z,
      stunned,
      kind: leader.formationKind ?? 'aegis_refract',
    });
  }
}

// ===========================================================================
// Stage 2B: Boss Rush · 棱镜万神殿 (`Pantheon Mode` + Dual-Boss Finale)
// ===========================================================================
export const PANTHEON_STAGE_META: ReadonlyArray<{
  stage: 1 | 2 | 3 | 4;
  bossId: BossId;
  coBossId?: BossId;
  affixName: string;
  affixDesc: string;
}> = [
  {
    stage: 1,
    bossId: 'warden_01',
    affixName: 'Ⅰ殿 · 熔核折射列阵',
    affixDesc: '赤焰魔像王镇守 · 开局空投超武舱并展开双侧 45° 折镜阵列',
  },
  {
    stage: 2,
    bossId: 'hydra_02',
    affixName: 'Ⅱ殿 · 引力潮汐棱镜',
    affixDesc: '双生魔龙降临 · 场地中央生成黄金增幅棱镜与高能爆桶链',
  },
  {
    stage: 3,
    bossId: 'omega_zero',
    affixName: 'Ⅲ殿 · 极寒电容矩阵',
    affixDesc: '深渊魔王觉醒 · 部署过载电容塔，折镜折射可引发全屏电磁清场',
  },
  {
    stage: 4,
    bossId: 'omega_zero',
    coBossId: 'warden_01',
    affixName: 'Ⅳ终殿 · 双神同屏合击',
    affixDesc: '深渊魔王 × 赤焰魔像统领双首领同屏合击 · 击败双神登顶万神殿！',
  },
];

export function generatePantheonStageScript(seed: number, stage: 1 | 2 | 3 | 4): SectorScriptConfig {
  const s = (seed >>> 0) || 202621;
  const meta = PANTHEON_STAGE_META[stage - 1]!;
  const weapons = ['scatter', 'rail', 'plasma', 'cryo'] as const;
  const wA = weapons[(s + stage) % weapons.length]!;
  const wB = weapons[(s + stage + 2) % weapons.length]!;

  const bossCfg =
    meta.bossId === 'warden_01'
      ? { id: 'warden_01' as const, name: 'WARDEN-01《赤焰魔像·神殿》', maxHp: 19500, maxPhases: 2 as const, enrageAfterSec: 28 }
      : meta.bossId === 'hydra_02'
        ? { id: 'hydra_02' as const, name: 'HYDRA-02《双生魔龙·神殿》', maxHp: 23500, maxPhases: 2 as const, enrageAfterSec: 30 }
        : {
            id: 'omega_zero' as const,
            name: stage === 4 ? 'OMEGA-ZERO《万神殿主宰》' : 'OMEGA-ZERO《深渊魔王·神殿》',
            maxHp: stage === 4 ? 32000 : 29000,
            maxPhases: 3 as const,
            pylonHp: 1850,
            enrageAfterSec: 36,
          };

  return {
    id: 4,
    name: meta.affixName,
    subtitle: meta.affixName,
    runwayLength: stage === 1 ? 135 : 88,
    scrollSpeed: 15.0,
    startSquad: 46,
    encounters:
      stage === 1
        ? [
            {
              type: 'gate_row',
              crossDist: 28,
              layout: 'paired',
              left: { op: 'mul', value: 2, mutable: false },
              right: { op: 'add', value: 28, mutable: false },
            },
            { type: 'vault', crossDist: 66, x: -2.2, hp: 42, reward: wA },
            { type: 'vault', crossDist: 66, x: 2.2, hp: 42, reward: wB },
            { type: 'vault', crossDist: 105, x: 0, hp: 48, reward: wA },
          ]
        : [
            {
              type: 'gate_row',
              crossDist: 32,
              layout: 'paired',
              left: { op: 'add', value: 22, mutable: true, damagePerStep: 12, stepDelta: 2, maxValue: 40 },
              right: { op: 'add', value: 18, mutable: false },
            },
            { type: 'vault', crossDist: 64, x: 0, hp: 48, reward: stage % 2 === 0 ? wB : 'blades' },
          ],
    boss: bossCfg,
  };
}

export function setupPantheonArenaProps(world: SimWorld, stage: 1 | 2 | 3 | 4, events: SimEvent[]): void {
  world.reflectors.length = 0;
  const rL = spawnReflector(world, -3.05, -9.6, 0, 1);
  rL.angleDeg = 36;
  const rR = spawnReflector(world, 3.05, -9.6, 0, -1);
  rR.angleDeg = -36;

  if (stage === 2 || stage === 4) {
    spawnPrismLens(world, 0, -11.5, 0, 2.2, 0.9);
  }
  if (stage === 3 || stage === 4) {
    spawnCapacitorTower(world, -1.95, -14.5, 0);
  }
  if (stage === 4 && world.boss) {
    // Stage 4 Finale: Deploy Co-Boss Avatar (`WARDEN-01` Crimson Colossus) on Right Flank while Omega-Zero holds Left-Center!
    world.boss.x = -2.15;
    world.boss.prevX = -2.15;
    const coMaxHp = Math.max(4500, Math.round(world.boss.maxHp * 0.48));
    world.pantheonCoBoss = {
      entityId: allocV21Id(world),
      active: true,
      id: 'warden_01',
      name: 'WARDEN-01《神殿副统领》',
      prevX: 2.35,
      prevZ: -18.8,
      x: 2.35,
      z: -18.8,
      halfWidth: 1.75,
      halfDepth: 1.45,
      hp: coMaxHp,
      maxHp: coMaxHp,
      hitPulse: 0,
      attackTimer: 2.2,
    };
    events.push({
      type: 'PANTHEON_DUAL_BOSS',
      primaryId: world.boss.id,
      coBossId: 'warden_01',
    });
  } else {
    world.pantheonCoBoss = null;
  }
}

export function stepPantheonCoBoss(world: SimWorld, events: SimEvent[]): void {
  if (!world.mods.pantheon) return;
  if (world.boss && world.boss.active && !world.pantheonArenaInitialized) {
    world.pantheonArenaInitialized = true;
    setupPantheonArenaProps(world, world.pantheonStage, events);
  }

  const co = world.pantheonCoBoss;
  if (!co || !co.active || co.hp <= 0) return;

  co.prevX = co.x;
  co.prevZ = co.z;
  co.x = normalizeZero(2.25 + Math.sin(world.simTime * 1.45) * 1.15);
  co.z = -18.6 + Math.cos(world.simTime * 1.1) * 0.65;
  if (co.hitPulse > 0) co.hitPulse = Math.max(0, co.hitPulse - FIXED_DT * 5);

  co.attackTimer -= FIXED_DT;
  if (co.attackTimer <= 0 && !world.isFiringRange) {
    co.attackTimer = 2.65;
    // Co-Boss fires twin angled plasma orbs + spawns a shootable chain barrel!
    for (const side of [-1, 1] as const) {
      const orb = world.projectilePool.acquire();
      orb.id = allocV21Id(world);
      orb.hostile = true;
      orb.hostileLoss = 4;
      orb.weapon = 'plasma';
      orb.radius = 0.4;
      orb.damage = 0;
      orb.remainingPierce = 0;
      orb.amplified = false;
      orb.powerScale = 1.2;
      orb.distanceTraveled = 0;
      orb.maxRange = 64;
      orb.splashRadius = 0;
      orb.splashDamageRatio = 0;
      orb.cryoSlowDuration = 0;
      orb.sweepStartFraction = 0;
      orb.vx = side * 2.1;
      orb.vz = 16.5;
      orb.prevX = co.x;
      orb.prevZ = co.z + 1.2;
      orb.x = co.x;
      orb.z = co.z + 1.2;
      orb.active = true;
      world.projectiles.push(orb);
    }
    if (world.barrels.length < 4) {
      spawnBarrel(world, co.x, -14.2, 2.2);
    }
  }
}

export function damagePantheonCoBoss(
  world: SimWorld,
  rawDamage: number,
  events: SimEvent[],
): void {
  const co = world.pantheonCoBoss;
  if (!co || !co.active || co.hp <= 0 || rawDamage <= 0) return;
  const isSyntheticKill = rawDamage >= co.maxHp * 0.85;
  const introMult = !isSyntheticKill && world.boss && world.boss.introProgress < 0.96 ? 0.15 : 1.0;
  const shieldMult = !isSyntheticKill && co.hp > co.maxHp * 0.65 ? 0.72 : 1.0;
  const effDmg = isSyntheticKill ? rawDamage : Math.min(rawDamage * introMult * shieldMult, co.maxHp * 0.045);
  co.hp = Math.max(0, co.hp - effDmg);
  co.hitPulse = 1.0;
  events.push({ type: 'BOSS_HIT', x: co.x, z: co.z, damage: Math.round(rawDamage) });

  if (co.hp <= 0) {
    co.hp = 0;
    co.active = false;
    addResonance(world, 0.5, events);
    grantSquadWithReserve(world, 16, events);
    spawnCoreShard(world, co.x - 0.5, co.z, 3);
    spawnCoreShard(world, co.x + 0.5, co.z, 3);
    // Detonate overload shock into Primary Boss if still standing!
    if (world.boss && world.boss.active && world.boss.hp > 0) {
      world.boss.shielded = false;
      world.boss.breakTimer = Math.max(world.boss.breakTimer, 4.5);
      const shock = Math.min(world.boss.hp - 1, Math.round(world.boss.maxHp * 0.16));
      if (shock > 0) {
        recordDamage(world, 'deflect', shock);
        world.boss.hp -= shock;
      }
    }
    events.push({ type: 'BOSS_DEFEAT', x: co.x, z: co.z, bossId: co.id });
  }
}

/**
 * Called inside `checkBossVictory` when `world.mods.pantheon === true`.
 * Returns `'wait_coboss'` if Co-Boss is still alive in Stage 4, `'advanced'` if advancing to next Pantheon stage,
 * or `'victory'` when Stage 4 is conquered!
 */
export function resolvePantheonBossClear(
  world: SimWorld,
  events: SimEvent[],
): 'wait_coboss' | 'advanced' | 'victory' {
  if (world.pantheonCoBoss && world.pantheonCoBoss.active && world.pantheonCoBoss.hp > 0) {
    // Primary Boss fell first in Stage 4 Dual-Boss Finale; transfer remaining fight to Co-Boss or auto-shatter if tiny!
    world.boss!.hp = 1;
    world.boss!.active = true;
    world.boss!.shielded = true;
    return 'wait_coboss';
  }

  world.pantheonClears = (world.pantheonClears ?? 0) + 1;
  if (world.pantheonStage < 4) {
    const nextStage = (world.pantheonStage + 1) as 1 | 2 | 3 | 4;
    world.pantheonStage = nextStage;
    world.pantheonArenaInitialized = false;
    world.pantheonCoBoss = null;
    world.boss = null;
    world.bossSpawned = false;
    world.weatherState = 'none';
    world.scrollDistance = 0;
    world.runwayProgress = 0;
    world.spawnCursor = 0;
    world.script = generatePantheonStageScript(world.mods.layoutSeed ?? 202621, nextStage);
    world.currentScrollSpeed = world.script.scrollSpeed;
    world.phase = 'PLAYING';

    // Pantheon Inter-Stage Blessing: +20 Squad, Resonance Full, Aegis Refreshed, +50% Nuke Charge!
    grantSquadWithReserve(world, 20, events);
    world.resonance = 1.0;
    world.aegisCooldown = 0;
    world.nukeCharge = Math.min(1.0, world.nukeCharge + 0.5);
    const meta = PANTHEON_STAGE_META[nextStage - 1]!;
    events.push({
      type: 'PANTHEON_STAGE_START',
      stage: nextStage,
      affixName: meta.affixName,
      bonusSquad: 20,
    });
    return 'advanced';
  }

  return 'victory';
}

export function buildPantheonCoBossSnapshot(co: SimPantheonCoBoss | null): PantheonCoBossSnapshot | null {
  if (!co || !co.active || co.hp <= 0) return null;
  return {
    active: co.active,
    id: co.id,
    name: co.name,
    x: co.x,
    z: co.z,
    hp: co.hp,
    maxHp: co.maxHp,
    shielded: co.hp > co.maxHp * 0.65,
    hitPulse: co.hitPulse,
  };
}

// ===========================================================================
// Stage 3: Core Reactor 3-Tier Awakening & Dynamic Tactical Drop Events
// ===========================================================================
export function syncCoreReactorAwakening(world: SimWorld, events?: SimEvent[]): void {
  const hasCoreOrDual = world.activeFusions.length > 0 || world.activeDualSynergy !== null;
  const hasOverlimit = world.overlimitResonance !== null || world.stats.vaultsCracked >= 3;
  const hasApexCore =
    world.overclockStacks >= 1 ||
    world.stats.vaultsCracked >= 4 ||
    world.reactorDropUpgrades >= 1 ||
    Boolean(world.boss && world.boss.phase >= 2 && hasOverlimit);

  let targetTier: CoreReactorTier = 0;
  if (hasApexCore && (hasOverlimit || hasCoreOrDual)) targetTier = 3;
  else if (hasOverlimit) targetTier = 2;
  else if (hasCoreOrDual) targetTier = 1;

  if (world.isFiringRange && world.rangeForceOverlimit) {
    targetTier = 3;
  }

  if (targetTier > world.coreReactorTier) {
    world.coreReactorTier = targetTier;
    if (events) {
      events.push({ type: 'CORE_REACTOR_AWAKEN', tier: targetTier });
    }
  }
}

export function triggerCoreReactorDomainPulse(
  world: SimWorld,
  source: 'overdrive' | 'aegis',
  events: SimEvent[],
): void {
  syncCoreReactorAwakening(world);
  const tier = world.coreReactorTier;
  if (tier <= 0) return;

  if (tier >= 1 && source === 'overdrive') {
    world.overdriveTimer += 0.65;
  }
  if (tier >= 2) {
    // Tier 2 Awakening: deploys a Squad-Following Ring of Refracting Prism Mirrors (+22% outgoing bolt amp!)
    world.reactorPrismRingTimer = Math.max(
      world.reactorPrismRingTimer,
      source === 'overdrive' ? 5.2 : 2.8,
    );
  }
  if (tier >= 3) {
    // Tier 3 Awakening: launches a Runway-Sweeping Electromagnetic Pulse Wall (`z: PLAYER_Z -> -48m`)!
    world.reactorWallActive = true;
    world.reactorWallZ = PLAYER_Z - 1.5;
    const wallDmg = Math.round(Math.max(160, world.trueSquadDps * 1.45) * world.mods.damageMult);
    let hits = 0;

    // Clear all hostile projectiles in the corridor
    for (let i = world.projectiles.length - 1; i >= 0; i--) {
      const p = world.projectiles[i];
      if (p && p.active && p.hostile && p.z >= -48) {
        p.active = false;
        world.projectilePool.release(p);
        world.projectiles.splice(i, 1);
      }
    }

    // Strip shields & deal heavy EMP shock across forward lane enemies
    const len = world.enemies.length;
    for (let i = 0; i < len; i++) {
      const e = world.enemies[i];
      if (!e || !e.active || e.consumed || e.bypassed || e.hp <= 0) continue;
      if (e.z >= -46 && e.z <= PLAYER_Z + 1) {
        if (e.shieldHp > 0) e.shieldHp = 0;
        recordDamage(world, 'fusions', Math.min(e.hp, wallDmg));
        damageEnemy(world, e, wallDmg, 1.4, events, { bypassShield: true });
        hits += 1;
      }
    }

    // Supercharge nearby mutable Gold Gates by +4!
    for (let i = 0; i < world.gates.length; i++) {
      const g = world.gates[i];
      if (g && g.active && g.mutable && !g.triggered && !g.dimmed && !g.isLockFlip && g.z >= -42) {
        applyFlatDeltaToGate(world, g, 4, true, events);
      }
    }

    events.push({
      type: 'REACTOR_PULSE_WALL',
      x: world.squadX,
      z: PLAYER_Z - 2,
      hits,
      source,
    });
  }
}

export function spawnTacticalEvent(
  world: SimWorld,
  kind: TacticalEventKind,
  x: number,
  z: number,
): SimTacticalEvent {
  const maxHp = Math.max(120, Math.round(world.trueSquadDps * 1.25));
  const ev: SimTacticalEvent = {
    id: allocV21Id(world),
    kind,
    prevX: normalizeZero(x),
    prevZ: z,
    x: normalizeZero(clamp(x, -TRACK_HALF_WIDTH + 1.35, TRACK_HALF_WIDTH - 1.35)),
    z,
    radius: kind === 'supply_beacon' ? 2.15 : 1.15,
    hp: maxHp,
    maxHp,
    captureProgress: 0,
    timer: kind === 'supply_beacon' ? 8.5 : 7.5,
    hitPulse: 0,
    completed: false,
    active: true,
  };
  world.tacticalEvents.push(ev);
  return ev;
}

function claimTacticalDropReward(
  world: SimWorld,
  ev: SimTacticalEvent,
  events: SimEvent[],
): void {
  if (ev.completed) return;
  ev.completed = true;
  ev.active = false;
  world.reactorDropUpgrades += 1;
  world.overclockStacks += 1;
  grantSquadWithReserve(world, 12, events);
  addResonance(world, 0.40, events);
  for (let k = 0; k < 3; k++) {
    spawnCoreShard(world, ev.x + (k - 1) * 0.45, ev.z, 2);
  }
  syncCoreReactorAwakening(world, events);
  events.push({
    type: 'TACTICAL_DROP_CLAIM',
    kind: ev.kind,
    x: ev.x,
    z: ev.z,
    newReactorTier: world.coreReactorTier,
  });
}

export function damageRunawayCart(
  world: SimWorld,
  ev: SimTacticalEvent,
  rawDamage: number,
  events: SimEvent[],
): boolean {
  if (!ev.active || ev.completed || ev.kind !== 'runaway_cart' || rawDamage <= 0) return false;
  ev.hp = Math.max(0, ev.hp - rawDamage);
  ev.hitPulse = 1.0;
  recordDamage(world, world.weapon, Math.min(ev.maxHp, rawDamage));
  if (ev.hp <= 0) {
    claimTacticalDropReward(world, ev, events);
    return true;
  }
  return false;
}

export function stepTacticalDropEvents(world: SimWorld, events: SimEvent[]): void {
  if (world.reactorPrismRingTimer > 0) {
    world.reactorPrismRingTimer = Math.max(0, world.reactorPrismRingTimer - FIXED_DT);
  }
  if (world.reactorWallActive) {
    world.reactorWallZ -= 54.0 * FIXED_DT;
    if (world.reactorWallZ <= -52.0) {
      world.reactorWallActive = false;
    }
  }

  // Dynamically spawn 1 high-stakes Tactical Drop Event mid-run when player actively steers!
  if (
    !world.boss &&
    !world.isFiringRange &&
    !world.mods.pantheon &&
    world.currentScrollSpeed > 1 &&
    world.playerHasSteered
  ) {
    const dStage = world.endless
      ? Math.floor((world.simTime + 2.0) / 22.0)
      : world.runwayProgress >= 0.44 && world.runwayProgress <= 0.82
        ? 1
        : 0;
    if (dStage > world.lastDropEventStage) {
      world.lastDropEventStage = dStage;
      const kind: TacticalEventKind = (dStage + world.sector) % 2 === 0 ? 'supply_beacon' : 'runaway_cart';
      const x = ((dStage % 2 === 0 ? 1 : -1) * 2.25);
      const z = kind === 'supply_beacon' ? PLAYER_Z - 30.0 : PLAYER_Z - 26.0;
      spawnTacticalEvent(world, kind, x, z);
      events.push({ type: 'TACTICAL_DROP_SPAWN', kind, x, z });
    }
  }

  for (let i = world.tacticalEvents.length - 1; i >= 0; i--) {
    const ev = world.tacticalEvents[i]!;
    if (!ev.active || ev.completed) {
      world.tacticalEvents.splice(i, 1);
      continue;
    }
    ev.prevX = ev.x;
    ev.prevZ = ev.z;
    ev.timer -= FIXED_DT;
    if (ev.hitPulse > 0) ev.hitPulse = Math.max(0, ev.hitPulse - FIXED_DT * 5);

    if (ev.kind === 'supply_beacon') {
      // Drifts toward player then hovers near squad Z briefly so player can hold inside capture ring!
      const vz = ev.z < PLAYER_Z - 1.2 ? world.currentScrollSpeed * 0.82 : 1.4;
      ev.z += (world.isFiringRange ? 0 : vz * FIXED_DT);
      if (Math.hypot(world.squadX - ev.x, PLAYER_Z - ev.z) <= ev.radius + world.formationRadius * 0.5) {
        ev.captureProgress = Math.min(1, ev.captureProgress + FIXED_DT / 1.35);
        if (ev.captureProgress >= 1) {
          claimTacticalDropReward(world, ev, events);
          world.tacticalEvents.splice(i, 1);
          continue;
        }
      }
    } else {
      // `runaway_cart`: weaves across lanes while slowly advancing/trying to escape!
      ev.x = normalizeZero(clamp(ev.x + Math.sin(world.simTime * 2.8 + ev.id) * 2.6 * FIXED_DT, -3.4, 3.4));
      ev.z += (world.isFiringRange ? 0 : world.currentScrollSpeed * 0.42 * FIXED_DT);
    }

    if (ev.timer <= 0 || ev.z > DESPAWN_Z) {
      ev.active = false;
      world.tacticalEvents.splice(i, 1);
    }
  }
}

// ===========================================================================
// Stage 4: Accessibility Reticle Aim-Assist Soft Snap
// ===========================================================================
export function applyAimAssistNudge(world: SimWorld, hasSteerInput: boolean): void {
  if (!world.mods.aimAssist || world.mods.fairTrial || !hasSteerInput) return;

  let bestX: number | null = null;
  let bestDx = 1.35;

  // Priority 1: Unreflected Boss Doom-Orb
  for (const orb of world.doomOrbs) {
    if (orb.active && !orb.reflected && orb.z < PLAYER_Z - 1.5) {
      const dx = Math.abs(orb.x - world.squadX);
      if (dx < bestDx) {
        bestDx = dx;
        bestX = orb.x;
      }
    }
  }
  // Priority 2: Active Runaway Cart or High Spire
  if (bestX === null) {
    for (const ev of world.tacticalEvents) {
      if (ev.active && !ev.completed && ev.kind === 'runaway_cart') {
        const dx = Math.abs(ev.x - world.squadX);
        if (dx < bestDx) {
          bestDx = dx;
          bestX = ev.x;
        }
      }
    }
  }
  // Priority 3: Exposed Boss Subsystem Part
  if (bestX === null && world.boss && world.boss.active && !world.boss.shielded) {
    for (const pt of world.boss.parts) {
      if (!pt.destroyed && pt.hp > 0) {
        const dx = Math.abs(pt.x - world.squadX);
        if (dx < bestDx) {
          bestDx = dx;
          bestX = pt.x;
        }
      }
    }
  }

  if (bestX !== null) {
    world.squadX = normalizeZero(
      clampSquadXLocal(world.squadX + (bestX - world.squadX) * 0.16, world.formationRadius),
    );
  }
}

function clampSquadXLocal(x: number, radius: number): number {
  const max = Math.max(0, TRACK_HALF_WIDTH - radius);
  return clamp(x, -max, max);
}
