import { spawnNemesisPursuer, tryTriggerNirvanaBurst } from './v23Mechanics';
import { FIXED_DT } from '../config/constants';
import { getWeaponCounterMult } from '../config/weapons';
import type { RangeControlCommand, RangePresetId, SimEvent, WeaponId } from '../types/game';
import { spawnBarrel } from './barrels';
import { spawnSectorBoss } from './bosses';
import { spawnJumpPad, spawnPhaseTwoReactorPart, spawnReflector, syncActiveFusions } from './competition';
import { spawnEnemy } from './enemies';
import type { SimWorld } from './entities';
import { clamp } from './math';
import { spawnPrismLens } from './weapons';
import { spawnCapacitorTower, spawnMagRail, spawnPhaseGate } from './v20Mechanics';
import { spawnCollapseRift, spawnHighSpire, spawnTacticalEvent, spawnTacticalFormation } from './v21Mechanics';

/**
 * Holographic Tactical Firing Range (`全息战术靶场`):
 * Non-scrolling zero-attrition live sandbox where players can freely switch Lead & Partner Main Weapons,
 * toggle Overlimit Resonance Fusions, rotate the 45° Holographic Reflector (`-50°..+50°`), spawn armored/barrel/boss
 * dummy formations, and observe real-time Authoritative DPS, Rolling Realized Hit DPS, and Counter Multipliers!
 */
export function initFiringRangeWorld(world: SimWorld): void {
  world.isFiringRange = true;
  if (!world.wingmanId) { world.wingmanId = "prism_mirror"; world.wingmanFormation = "forward_mirror"; }
  world.rangePreset = 'armored';
  world.rangeReflectorAngle = 36;
  world.rangeForceOverlimit = true;
  world.rangeDamageBuckets = new Float64Array(180);
  world.rangeBucketCursor = 0;
  world.rangePrevTotalDmg = 0;
  world.rangeRealizedDps = 0;
  world.rangeRespawnTimer = 0;

  world.squadCount = 120;
  world.stats.peakSquad = 120;
  world.stats.vaultsCracked = 4;
  world.masteryCount = 3;
  world.bladesCount = 2;
  world.resonance = 1.0;
  world.nukeCharge = 1.0;
  world.currentScrollSpeed = 0;
  world.scrollDistance = 0;
  world.runwayProgress = 0.5;
  world.spawnCursor = 999999;

  // Default Dual-Weapon Range Loadout: Rail Lv.3 + Scatter Lv.3 (with Overlimit Resonance active!)
  world.learnedWeaponLevels = {
    pulse: 2,
    scatter: 3,
    rail: 3,
    plasma: 0,
    cryo: 0,
  };
  world.activeLoadout = ['rail', 'scatter'];
  world.weapon = 'rail';
  world.weaponLevel = 3;

  rebuildRangePropsAndTargets(world, []);
  syncActiveFusions(world);
}

export function rebuildRangePropsAndTargets(world: SimWorld, events: SimEvent[]): void {
  world.enemyPool.releaseAll(world.enemies);
  world.barrelPool.releaseAll(world.barrels);
  world.lensPool.releaseAll(world.lenses);
  world.reflectors.length = 0;
  world.singularities.length = 0;
  world.doomOrbs.length = 0;
  world.magRails.length = 0;
  world.capTowers.length = 0;
  world.phaseGates.length = 0;
  world.coreShards.length = 0;
  world.collapseRifts.length = 0;
  world.highSpires.length = 0;
  world.tacticalEvents.length = 0;
  world.weatherState = 'none';
  world.boss = null;
  world.bossSpawned = false;

  // Stationary steerable Holographic Reflector on Left-Center (`x = -1.65, z = -9.5`) + Golden Prism Lens on Right (`x = 2.05, z = -10.5`)
  const ref = spawnReflector(world, -1.65, -9.5, 0, 1);
  ref.angleDeg = world.rangeReflectorAngle;
  spawnPrismLens(world, 2.05, -10.5, 0, 2.1);

  spawnRangeTargetsOnly(world, events);
}

function spawnRangeTargetsOnly(world: SimWorld, events: SimEvent[]): void {
  const preset: RangePresetId = world.rangePreset ?? 'armored';
  if (preset === 'boss_dummy') {
    const boss = spawnSectorBoss(world, events);
    boss.introProgress = 1.0;
    boss.z = -20.5;
    boss.maxHp = 85000;
    boss.hp = 85000;
    boss.shielded = false;
    for (const p of boss.pylons) p.destroyed = true;
    spawnPhaseTwoReactorPart(world, boss);
    boss.phase = 2;
    boss.omegaOverdrive = true;
    boss.omegaBeamState = 'charging';
    boss.omegaBeamTimer = 1.35;
    boss.omegaBeamX = 0;
    world.weatherState = 'solar_emp';
    spawnBarrel(world, -2.8, -16.5, 0);
    spawnBarrel(world, 2.8, -16.5, 0);
    return;
  }

  if (preset === 'verticality') {
    spawnCollapseRift(world, -3.65, -4.5, 9.0, 'flank_chasm');
    spawnCollapseRift(world, 0, -14.0, 5.5, 'bridge_gap');
    spawnHighSpire(world, -3.15, -17.5, 2200);
    spawnHighSpire(world, 3.15, -17.5, 2200);
    spawnJumpPad(world, 0, 1.5, 0);
    spawnTacticalFormation(world, 'aegis_refract', 0, -21.5);
    spawnTacticalEvent(world, 'runaway_cart', 1.8, -15.0);
    return;
  }

  if (preset === 'setpieces') {
    spawnMagRail(world, -2.65, -4.0, 16.0, 1);
    spawnCapacitorTower(world, 2.15, -15.5, 0);
    spawnPhaseGate(world, 2.15, 2.5, 'kinetic', 2.0);
    spawnBarrel(world, -1.65, -15.5, 0);
    for (let i = 0; i < 8; i++) {
      const col = (i % 4) - 1.5;
      const row = Math.floor(i / 4);
      spawnEnemy(world, i % 2 === 0 ? 'phalanx' : 'glacier', col * 2.1, -18.5 - row * 4.0, { hp: 3600 });
    }
    return;
  }

  if (preset === 'barrel_bank') {
    for (const [bx, bz] of [
      [-2.8, -18.5],
      [0.0, -19.5],
      [2.8, -18.5],
      [-1.4, -24.5],
      [1.4, -24.5],
    ] as const) {
      spawnBarrel(world, bx, bz, 0);
    }
    for (let i = 0; i < 12; i++) {
      const col = (i % 6) - 2.5;
      const row = Math.floor(i / 6);
      spawnEnemy(world, i % 3 === 0 ? 'phalanx' : 'crawler', col * 1.45, -17.5 - row * 3.8, {
        hp: i % 3 === 0 ? 1800 : 650,
      });
    }
    return;
  }

  if (preset === 'armored') {
    // Showcase Counter Matrix: Phalanx (Shield), Glacier (Permafrost), Bastion (Juggernaut), Dasher + Barrels!
    spawnEnemy(world, 'phalanx', -2.7, -17.5, { hp: 3200 });
    spawnEnemy(world, 'glacier', 0.0, -18.5, { hp: 4200 });
    spawnEnemy(world, 'bastion', 2.7, -17.5, { hp: 4800 });
    spawnEnemy(world, 'dasher', -1.35, -22.5, { hp: 1800 });
    spawnEnemy(world, 'necromancer', 1.35, -22.5, { hp: 2200 });
    spawnBarrel(world, 2.6, -16.0, 0);
    return;
  }

  // 'mixed' 14-archetype horde matrix
  const kinds = ['crawler', 'bomber', 'phalanx', 'glacier', 'bastion', 'stalker', 'howler', 'beholder'] as const;
  for (let i = 0; i < 16; i++) {
    const col = (i % 4) - 1.5;
    const row = Math.floor(i / 4);
    const k = kinds[i % kinds.length]!;
    spawnEnemy(world, k, col * 2.2, -16.0 - row * 4.2, { hp: 1600 + row * 600 });
  }
  spawnBarrel(world, 0.0, -18.0, 0);
}

export function stepFiringRangeWorld(world: SimWorld, events: SimEvent[]): void {
  if (!world.isFiringRange) return;

  // Lock stationary range state & prevent accidental defeat or scroll drift
  world.currentScrollSpeed = 0;
  world.scrollDistance = 0;
  world.runwayProgress = 0.5;
  if (world.squadCount < 120) world.squadCount = 120;
  if (world.resonance < 1.0 && world.overdriveTimer <= 0) {
    world.resonance = Math.min(1.0, world.resonance + FIXED_DT * 0.85);
  }
  world.nukeStocks = world.nukeMaxStocks;
  world.nukeCharge = 1.0;
  world.jumpStocks = world.jumpMaxStocks;
  world.jumpCharge = 1.0;

  // Keep stationary dummies anchored in the holographic target zone (`z <= -13.5`)
  for (let i = 0; i < world.enemies.length; i++) {
    const e = world.enemies[i];
    if (!e || !e.active) continue;
    if (e.z > -13.2) {
      e.z = -22.0;
      e.prevZ = -22.0;
    }
    e.dasherState = 'APPROACH';
    e.telegraphTimer = 0;
  }
  if (world.boss && world.boss.active) {
    world.boss.hazardZones.length = 0;
    world.boss.orbTimer = 99;
    world.boss.doomOrbTimer = 99;
    world.boss.summonTimer = 99;
    if (world.boss.hp < world.boss.maxHp * 0.15) {
      world.boss.hp = world.boss.maxHp;
      for (const pt of world.boss.parts) {
        pt.destroyed = false;
        pt.hp = pt.maxHp;
      }
    }
  }

  // In `setpieces` preset, automatically respawn Capacitor Tower & Phase Gate when consumed so sandbox testing is continuous!
  if (world.rangePreset === 'verticality') {
    if (world.highSpires.length === 0) {
      spawnHighSpire(world, -3.15, -17.5, 2200);
      spawnHighSpire(world, 3.15, -17.5, 2200);
    }
    const jp = world.jumpPads[0];
    if (jp && jp.triggered) jp.triggered = false;
  }
  if (world.rangePreset === 'setpieces') {
    if (world.capTowers.length === 0) {
      spawnCapacitorTower(world, 2.15, -15.5, 0);
    }
    if (world.phaseGates.length === 0) {
      spawnPhaseGate(world, 2.15, 2.5, world.weapon === 'plasma' || world.weapon === 'cryo' ? 'energy' : 'kinetic', 2.0);
    }
  }

  // Sync reflector mirror angle continuously
  if (world.reflectors.length > 0) {
    const rf = world.reflectors[0]!;
    rf.angleDeg = world.rangeReflectorAngle;
    rf.lean = world.rangeReflectorAngle >= 0 ? 1 : -1;
  }

  // Auto-respawn targets when cleared
  const aliveEnemies = world.enemies.filter((e) => e.active && !e.consumed && e.hp > 0).length;
  const hasBoss = Boolean(world.boss && world.boss.active && world.boss.hp > 0);
  if (!hasBoss && aliveEnemies === 0) {
    world.rangeRespawnTimer += FIXED_DT;
    if (world.rangeRespawnTimer >= 0.45) {
      world.rangeRespawnTimer = 0;
      world.barrelPool.releaseAll(world.barrels);
      spawnRangeTargetsOnly(world, events);
    }
  } else {
    world.rangeRespawnTimer = 0;
  }

  // Rolling 3.0s (180-tick) Realized Damage DPS meter
  let totalNow = 0;
  const src = world.damageBySource;
  totalNow =
    src.pulse + src.scatter + src.rail + src.plasma + src.cryo + src.blades + src.fusions + src.deflect + src.explosives;
  const frameDmg = Math.max(0, totalNow - world.rangePrevTotalDmg);
  world.rangePrevTotalDmg = totalNow;
  world.rangeDamageBuckets[world.rangeBucketCursor] = frameDmg;
  world.rangeBucketCursor = (world.rangeBucketCursor + 1) % world.rangeDamageBuckets.length;

  let windowSum = 0;
  for (let i = 0; i < world.rangeDamageBuckets.length; i++) {
    windowSum += world.rangeDamageBuckets[i]!;
  }
  const windowSec = Math.min(3.0, Math.max(0.25, world.simTime));
  world.rangeRealizedDps = Math.round(windowSum / windowSec);
}

export function computeRangeFrontCounterMult(world: SimWorld): number {
  let bestTargetKind: import('../types/game').EnemyKind | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < world.enemies.length; i++) {
    const e = world.enemies[i];
    if (!e || !e.active || e.consumed || e.hp <= 0) continue;
    const dx = Math.abs(e.x - world.squadX);
    if (dx < bestDist) {
      bestDist = dx;
      bestTargetKind = e.kind;
    }
  }
  if (!bestTargetKind) return 1.0;
  return getWeaponCounterMult(world.weapon, bestTargetKind);
}

export function applyFiringRangeCommand(world: SimWorld, cmd: RangeControlCommand): void {
  if (!world.isFiringRange) return;
  const ALL_W: readonly WeaponId[] = ['pulse', 'scatter', 'rail', 'plasma', 'cryo'];

  if (cmd.leadWeapon && ALL_W.includes(cmd.leadWeapon)) {
    const curPartner = world.activeLoadout.find((w) => w !== cmd.leadWeapon) ?? (cmd.leadWeapon === 'rail' ? 'scatter' : 'rail');
    world.activeLoadout = [curPartner, cmd.leadWeapon];
    world.weapon = cmd.leadWeapon;
    world.weaponLevel = 3;
    for (const w of ALL_W) {
      world.learnedWeaponLevels[w] = w === cmd.leadWeapon || w === curPartner ? 3 : 0;
    }
  }

  if (cmd.partnerWeapon && ALL_W.includes(cmd.partnerWeapon)) {
    const lead = world.weapon === cmd.partnerWeapon ? (cmd.partnerWeapon === 'pulse' ? 'rail' : 'pulse') : world.weapon;
    world.activeLoadout = [cmd.partnerWeapon, lead];
    world.weapon = lead;
    world.weaponLevel = 3;
    for (const w of ALL_W) {
      world.learnedWeaponLevels[w] = w === lead || w === cmd.partnerWeapon ? 3 : 0;
    }
  }

  if (typeof cmd.reflectorAngle === 'number' && Number.isFinite(cmd.reflectorAngle)) {
    world.rangeReflectorAngle = clamp(Math.round(cmd.reflectorAngle), -50, 50);
    if (world.reflectors.length > 0) {
      world.reflectors[0]!.angleDeg = world.rangeReflectorAngle;
      world.reflectors[0]!.lean = world.rangeReflectorAngle >= 0 ? 1 : -1;
    }
  }

  if (typeof cmd.overlimit === 'boolean') {
    world.rangeForceOverlimit = cmd.overlimit;
  }

  if (cmd.preset) {
    world.rangePreset = cmd.preset;
    rebuildRangePropsAndTargets(world, []);
  }

  if (cmd.respawn) {
    rebuildRangePropsAndTargets(world, []);
  }

  const wmPick = cmd.wingman;
  if (wmPick !== undefined) {
    world.wingmanId = wmPick;
    if (wmPick === 'prism_mirror' && !cmd.wingmanFormation) {
      world.wingmanFormation = 'forward_mirror';
    }
  }
  if (cmd.wingmanFormation) {
    world.wingmanFormation = cmd.wingmanFormation;
  }
  if (cmd.triggerNirvana) {
    world.nirvanaCharge = 1.0;
    tryTriggerNirvanaBurst(world, []);
  }
  if (cmd.spawnNemesis) {
    world.nemesis = null;
    spawnNemesisPursuer(world, []);
  }

  syncActiveFusions(world);
}
