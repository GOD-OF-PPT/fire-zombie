import type {
  RunModifiers,
  BarrelSnapshot,
  BossHazardZone,
  BossPylonSnapshot,
  BossSnapshot,
  EnemySnapshot,
  GateSnapshot,
  InputSample,
  PrismLensSnapshot,
  ProjectileSnapshot,
  SectorId,
  SimEvent,
  SimSnapshot,
  VaultSnapshot,
} from '../types/game';
import {
  DESPAWN_Z,
  FIXED_DT,
  FLIP_PULSE_DECAY_PER_SEC,
  HIT_PULSE_DECAY_PER_SEC,
  KEYBOARD_MOVE_SPEED,
  LENS_PULSE_DECAY_PER_SEC,
  OVERDRIVE_DURATION,
  PLAYER_Z,
  TRACK_HALF_WIDTH,
} from '../config/constants';
import { SECTORS, getSectorScript } from '../config/sectors';
import { generateEndlessStage } from '../config/endless';
import { stepChainExplosions } from './barrels';
import {
  applyBarrelBlastToBoss,
  checkBossVictory,
  resolveBossAttacks,
  stepBossAI,
} from './bosses';
import { resolveFriendlyProjectileCollisions } from './combat';
import {
  resolveEnemyBreaches,
  stepEnemiesAI,
  stepOrbitalBlades,
} from './enemies';
import { createEntityPools, type SimWorld } from './entities';
import { resolveGateRowCrossings } from './gates';
import {
  clamp,
  clampSquadX,
  computeFormationPositions,
  computeFormationRadius,
  computeTierBreakdown,
  computeTrueSquadDps,
  normalizeZero,
} from './math';
import { computeMirrorFlags, spawnReadyRunwayEncounters, stepTrackAndSpawner } from './spawner';
import { getEffectiveOverdriveDuration, tryStartManualOverdrive } from './resonance';
import { tryTriggerAegisPulse } from './aegis';
import { stepProjectilesAndAutoFire } from './weapons';

export function reconcileFormationAndDps(world: SimWorld): void {
  world.tiers = computeTierBreakdown(world.squadCount);
  world.formationRadius = computeFormationRadius(world.tiers.totalVisible);
  world.squadX = clampSquadX(world.squadX, world.formationRadius);
  const overdriveActive = world.overdriveTimer > 0;
  world.dronePositions = computeFormationPositions(
    world.tiers,
    world.squadX,
    PLAYER_Z,
    overdriveActive,
  );
  world.trueSquadDps = computeTrueSquadDps(
    world.squadCount,
    world.weapon,
    world.weaponLevel,
    world.masteryCount,
    overdriveActive,
  );
}

function releaseAllActivePools(world: SimWorld): void {
  world.gateRowPool.releaseAll(world.gateRows);
  world.gatePool.releaseAll(world.gates);
  world.vaultPool.releaseAll(world.vaults);
  world.enemyPool.releaseAll(world.enemies);
  world.barrelPool.releaseAll(world.barrels);
  world.lensPool.releaseAll(world.lenses);
  world.projectilePool.releaseAll(world.projectiles);
  world.boss = null;
}

function clearCoreRunFields(world: SimWorld, startSquad: number): void {
  releaseAllActivePools(world);

  world.simTime = 0;
  world.nextEntityId = 1;
  world.scrollDistance = 0;
  world.currentScrollSpeed = 0;
  world.runwayProgress = 0;
  world.spawnCursor = 0;
  world.bossSpawned = false;

  world.prevSquadX = 0;
  world.squadX = 0;
  world.squadCount = startSquad;

  world.weapon = 'pulse';
  world.weaponLevel = 1;
  world.learnedWeaponLevels = {
    pulse: 1,
    scatter: 0,
    rail: 0,
    plasma: 0,
    cryo: 0,
  };
  world.auxCooldowns = { pulse: 0.18, scatter: 0.24, rail: 0.3, plasma: 0.36, cryo: 0.22 };
  world.overclockStacks = 0;
  world.rampageStacks = 0;
  world.rampageTimer = 0;
  world.gateStreak = 0;
  world.fireCooldown = 0;
  world.volleyIndex = 0;

  world.bladesCount = 0;
  world.bladesAngle = 0;
  world.masteryCount = 0;

  world.resonance = 0;
  world.overdriveTimer = 0;
  world.overdriveJustStarted = false;
  world.aegisTimer = 0;
  world.aegisCooldown = 0;
  world.aegisMaxCooldown = Math.max(4, world.mods.aegisCooldownSec ?? 14);
  world.aegisDurationSec = Math.max(0.5, world.mods.aegisDurationSec ?? 1.25);
  world.autoAegisCharges = Math.max(0, Math.floor(world.mods.autoAegisCharges ?? 0));
  world.critSeed = ((world.mods.layoutSeed ?? 1) ^ 0x9e3779b9) >>> 0;
  world.defeatReason = null;

  world.stats = {
    kills: 0,
    gatesImproved: 0,
    vaultsCracked: 0,
    maxChain: 0,
    peakSquad: startSquad,
  };

  reconcileFormationAndDps(world);
}

export function createSimWorld(): SimWorld {
  const pools = createEntityPools();
  const initialTiers = computeTierBreakdown(1);
  const initialRadius = computeFormationRadius(initialTiers.totalVisible);

  const world: SimWorld = {
    phase: 'TITLE',
    sector: 1,
    endless: null,
    simTime: 0,
    speedMultiplier: 1,
    mods: { bonusSquad: 0, damageMult: 1, resonanceMult: 1 },
    nextEntityId: 1,

    scrollDistance: 0,
    currentScrollSpeed: 0,
    runwayProgress: 0,
    spawnCursor: 0,
    script: SECTORS[1],
    mirrorFlags: [],
    bossSpawned: false,

    prevSquadX: 0,
    squadX: 0,
    squadCount: 1,
    formationRadius: initialRadius,
    tiers: initialTiers,
    dronePositions: computeFormationPositions(initialTiers, 0, PLAYER_Z, false),

    weapon: 'pulse',
    weaponLevel: 1,
    learnedWeaponLevels: {
      pulse: 1,
      scatter: 0,
      rail: 0,
      plasma: 0,
      cryo: 0,
    },
    auxCooldowns: { pulse: 0.18, scatter: 0.24, rail: 0.3, plasma: 0.36, cryo: 0.22 },
    overclockStacks: 0,
    rampageStacks: 0,
    rampageTimer: 0,
    gateStreak: 0,
    fireCooldown: 0,
    volleyIndex: 0,

    bladesCount: 0,
    bladesAngle: 0,
    masteryCount: 0,

    resonance: 0,
    overdriveTimer: 0,
    overdriveJustStarted: false,
    aegisTimer: 0,
    aegisCooldown: 0,
    aegisMaxCooldown: 14,
    aegisDurationSec: 1.25,
    autoAegisCharges: 0,
    critSeed: 0x9e3779b9,
    trueSquadDps: computeTrueSquadDps(1, 'pulse', 1, 0, false),

    defeatReason: null,
    stats: {
      kills: 0,
      gatesImproved: 0,
      vaultsCracked: 0,
      maxChain: 0,
      peakSquad: 1,
    },

    gateRows: [],
    gates: [],
    vaults: [],
    enemies: [],
    barrels: [],
    lenses: [],
    projectiles: [],
    boss: null,

    ...pools,
  };

  resetSimWorldToTitle(world);
  return world;
}

export function resetSimWorldToTitle(world: SimWorld): void {
  world.sector = 1;
  world.mods = { bonusSquad: 0, damageMult: 1, resonanceMult: 1 };
  world.endless = null;
  world.script = SECTORS[1];
  world.mirrorFlags = [];
  clearCoreRunFields(world, 1);
  world.phase = 'TITLE';
}

export function resetSimWorldForSector(
  world: SimWorld,
  sector: SectorId,
  mods?: Partial<RunModifiers>,
): void {
  world.sector = sector;
  if (mods) {
    world.mods = {
      bonusSquad: Math.max(0, Math.floor(mods.bonusSquad ?? 0)),
      damageMult: Math.max(1, mods.damageMult ?? 1),
      resonanceMult: Math.max(1, mods.resonanceMult ?? 1),
      manualOverdrive: mods.manualOverdrive === true,
      layoutSeed: Math.max(0, Math.floor(mods.layoutSeed ?? 0)),
      bossHpMult: Math.max(1, mods.bossHpMult ?? 1),
      endless: mods.endless === true,
      manualEndlessDraft: mods.manualEndlessDraft === true,
      aegisCooldownSec: mods.aegisCooldownSec,
      aegisDurationSec: mods.aegisDurationSec,
      autoAegisCharges: mods.autoAegisCharges,
      critChance: mods.critChance,
    };
  }
  const endless = world.mods.endless === true;
  world.endless = endless ? { wave: 1, bossesDefeated: 0, completedDistance: 0, upgrades: {}, offers: [] } : null;
  const sectorCfg = endless
    ? generateEndlessStage(world.mods.layoutSeed ?? 1, 1)
    : getSectorScript(sector, world.mods.layoutSeed ?? 0);
  world.script = sectorCfg;
  world.mirrorFlags = endless
    ? []
    : computeMirrorFlags(sectorCfg.encounters, world.mods.layoutSeed ?? 0, sector);
  clearCoreRunFields(world, sectorCfg.startSquad + world.mods.bonusSquad);
  world.phase = 'PLAYING';
  world.currentScrollSpeed = sectorCfg.scrollSpeed;
  spawnReadyRunwayEncounters(world);
  reconcileFormationAndDps(world);
}

function stepWorldEntitiesMotion(world: SimWorld, events: SimEvent[]): void {
  // GateRows & Gates
  for (let i = 0; i < world.gateRows.length; i++) {
    const row = world.gateRows[i];
    if (row && row.active) {
      row.prevZ = row.z;
      row.z += row.vz * FIXED_DT;
    }
  }
  for (let i = 0; i < world.gates.length; i++) {
    const gate = world.gates[i];
    if (gate && gate.active) {
      gate.prevX = gate.x;
      gate.prevZ = gate.z;
      gate.z += gate.vz * FIXED_DT;
    }
  }

  // Overclock Vaults
  for (let i = 0; i < world.vaults.length; i++) {
    const vault = world.vaults[i];
    if (vault && vault.active && !vault.broken) {
      vault.prevX = vault.x;
      vault.prevZ = vault.z;
      vault.z += vault.vz * FIXED_DT;
    }
  }

  // Surge Barrels
  for (let i = 0; i < world.barrels.length; i++) {
    const barrel = world.barrels[i];
    if (barrel && barrel.active && !barrel.detonated) {
      barrel.prevX = barrel.x;
      barrel.prevZ = barrel.z;
      const vz = barrel.vz !== null ? barrel.vz : world.currentScrollSpeed;
      barrel.z += vz * FIXED_DT;
    }
  }

  // Golden Prism Lenses
  for (let i = 0; i < world.lenses.length; i++) {
    const lens = world.lenses[i];
    if (lens && lens.active) {
      lens.prevX = lens.x;
      lens.prevZ = lens.z;
      lens.age += FIXED_DT;
      const vz = lens.vz !== null ? lens.vz : world.currentScrollSpeed;
      lens.z += vz * FIXED_DT;
      if (lens.driftAmp !== 0 && lens.driftFreq !== 0) {
        const rawX = lens.baseX + lens.driftAmp * Math.sin(lens.age * lens.driftFreq);
        lens.x = normalizeZero(
          clamp(rawX, -TRACK_HALF_WIDTH + lens.halfWidth, TRACK_HALF_WIDTH - lens.halfWidth),
        );
      }
    }
  }

  // Enemies & Boss AI
  stepEnemiesAI(world, events);
  stepBossAI(world, events);
}

function cullExpiredEntities(world: SimWorld): void {
  for (let i = world.gateRows.length - 1; i >= 0; i--) {
    const row = world.gateRows[i];
    if (!row || !row.active || row.z > DESPAWN_Z) {
      if (row) world.gateRowPool.release(row);
      world.gateRows.splice(i, 1);
    }
  }

  for (let i = world.gates.length - 1; i >= 0; i--) {
    const gate = world.gates[i];
    if (!gate || !gate.active || gate.z > DESPAWN_Z) {
      if (gate) world.gatePool.release(gate);
      world.gates.splice(i, 1);
    }
  }

  // Broken vaults stay briefly while hitPulse > 0 so immediate snapshot reads observe broken === true & displayHp === 0
  for (let i = world.vaults.length - 1; i >= 0; i--) {
    const vault = world.vaults[i];
    if (!vault || vault.z > DESPAWN_Z || (vault.broken && vault.hitPulse <= 0)) {
      if (vault) world.vaultPool.release(vault);
      world.vaults.splice(i, 1);
    }
  }

  for (let i = world.barrels.length - 1; i >= 0; i--) {
    const barrel = world.barrels[i];
    if (
      !barrel ||
      (barrel.z > DESPAWN_Z && barrel.chainTimer === null) ||
      (barrel.detonated && barrel.hitPulse <= 0)
    ) {
      if (barrel) world.barrelPool.release(barrel);
      world.barrels.splice(i, 1);
    }
  }

  for (let i = world.lenses.length - 1; i >= 0; i--) {
    const lens = world.lenses[i];
    if (!lens || !lens.active || lens.z > DESPAWN_Z) {
      if (lens) world.lensPool.release(lens);
      world.lenses.splice(i, 1);
    }
  }

  for (let i = world.enemies.length - 1; i >= 0; i--) {
    const enemy = world.enemies[i];
    if (!enemy || !enemy.active || enemy.consumed || enemy.z > DESPAWN_Z) {
      if (enemy) world.enemyPool.release(enemy);
      world.enemies.splice(i, 1);
    }
  }

  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const proj = world.projectiles[i];
    if (!proj || !proj.active) {
      if (proj) world.projectilePool.release(proj);
      world.projectiles.splice(i, 1);
    }
  }
}

function snapTimerZero(next: number): number {
  return next <= 1e-9 ? 0 : next;
}

function decayTimersAndPulses(world: SimWorld): void {
  if (world.overdriveTimer > 0) {
    if (world.overdriveJustStarted) {
      world.overdriveJustStarted = false;
    } else {
      world.overdriveTimer = snapTimerZero(world.overdriveTimer - FIXED_DT);
      const maxOd = getEffectiveOverdriveDuration(world);
      world.resonance = world.overdriveTimer > 0 ? world.overdriveTimer / maxOd : 0;
    }
  }
  if (world.aegisTimer > 0) {
    world.aegisTimer = snapTimerZero(world.aegisTimer - FIXED_DT);
  }
  if (world.rampageTimer > 0) {
    const nextRamp = world.rampageTimer - FIXED_DT;
    if (nextRamp <= 1e-9) {
      world.rampageTimer = 0;
      world.rampageStacks = 0;
    } else {
      world.rampageTimer = nextRamp;
    }
  }
  if (world.aegisCooldown > 0) {
    world.aegisCooldown = snapTimerZero(world.aegisCooldown - FIXED_DT);
  }

  for (let i = 0; i < world.gates.length; i++) {
    const g = world.gates[i];
    if (g) {
      if (g.hitPulse > 0) {
        g.hitPulse = snapTimerZero(g.hitPulse - HIT_PULSE_DECAY_PER_SEC * FIXED_DT);
      }
      if (g.flipPulse > 0) {
        g.flipPulse = snapTimerZero(g.flipPulse - FLIP_PULSE_DECAY_PER_SEC * FIXED_DT);
      }
    }
  }

  for (let i = 0; i < world.vaults.length; i++) {
    const v = world.vaults[i];
    if (v && v.hitPulse > 0) {
      v.hitPulse = snapTimerZero(v.hitPulse - HIT_PULSE_DECAY_PER_SEC * FIXED_DT);
    }
  }

  for (let i = 0; i < world.enemies.length; i++) {
    const e = world.enemies[i];
    if (e && e.hitPulse > 0) {
      e.hitPulse = snapTimerZero(e.hitPulse - HIT_PULSE_DECAY_PER_SEC * FIXED_DT);
    }
  }

  for (let i = 0; i < world.barrels.length; i++) {
    const b = world.barrels[i];
    if (b && b.hitPulse > 0) {
      b.hitPulse = snapTimerZero(b.hitPulse - HIT_PULSE_DECAY_PER_SEC * FIXED_DT);
    }
  }

  for (let i = 0; i < world.lenses.length; i++) {
    const l = world.lenses[i];
    if (l && l.pulse > 0) {
      l.pulse = snapTimerZero(l.pulse - LENS_PULSE_DECAY_PER_SEC * FIXED_DT);
    }
  }

  if (world.boss && world.boss.hitPulse > 0) {
    world.boss.hitPulse = snapTimerZero(world.boss.hitPulse - HIT_PULSE_DECAY_PER_SEC * FIXED_DT);
  }
}

/**
 * Executes a single deterministic FIXED_DT = 1/60s tick in exact 10-step intra-tick order
 * (`PROJECT.md` section 2 Invariant 5).
 */
export function stepWorldFixed(world: SimWorld, input: InputSample): SimEvent[] {
  if (world.phase !== 'PLAYING') {
    return [];
  }

  const events: SimEvent[] = [];

  // Step 1: Input & Squad X
  world.prevSquadX = world.squadX;
  const rawSquadX =
    world.squadX + input.dragDeltaX + input.keyAxisX * KEYBOARD_MOVE_SPEED * FIXED_DT;
  world.squadX = clampSquadX(rawSquadX, world.formationRadius);
  if (input.overdrive === true) {
    tryStartManualOverdrive(world, events);
  }
  if (input.aegisPulse === true) {
    tryTriggerAegisPulse(world, events, false);
  }

  // Step 2: Track & Spawner
  stepTrackAndSpawner(world, events);

  // Step 3: Projectiles, Auto-Fire & Orbital Bit-Blades
  stepProjectilesAndAutoFire(world, events);
  stepOrbitalBlades(world, events);

  // Step 4: World Entities Z & Enemy / Boss AI
  stepWorldEntitiesMotion(world, events);

  // Step 5: Swept Projectile Collisions (Lenses, Enemies, Shootable Gates, Vaults, Barrels, Boss)
  resolveFriendlyProjectileCollisions(world, events);

  // Step 6: Staggered Chain Explosions
  stepChainExplosions(world, events, applyBarrelBlastToBoss);

  // Step 7: Boss Victory Check (locks VICTORY before Step 8/9 attrition!)
  if (checkBossVictory(world, events)) {
    cullExpiredEntities(world);
    reconcileFormationAndDps(world);
    return events;
  }

  // Step 8: Swept Squad Gate Crossings
  if (resolveGateRowCrossings(world, events)) {
    cullExpiredEntities(world);
    reconcileFormationAndDps(world);
    return events;
  }

  // Step 9: Enemy Breach & Boss Hazard Attrition + Defeat Check
  if (resolveEnemyBreaches(world, events)) {
    cullExpiredEntities(world);
    reconcileFormationAndDps(world);
    return events;
  }
  if (resolveBossAttacks(world, events)) {
    cullExpiredEntities(world);
    reconcileFormationAndDps(world);
    return events;
  }

  // Step 10: Formation, True DPS, Culling & Timers
  decayTimersAndPulses(world);
  cullExpiredEntities(world);
  reconcileFormationAndDps(world);
  if (world.squadCount > world.stats.peakSquad) {
    world.stats.peakSquad = world.squadCount;
  }

  return events;
}

/**
 * Materializes a fresh, immutable SimSnapshot completely decoupled from internal
 * pooled entity references so historical snapshots are never mutated in place.
 */
export function buildSimSnapshot(world: SimWorld): SimSnapshot {
  const gates: GateSnapshot[] = [];
  for (let i = 0; i < world.gates.length; i++) {
    const g = world.gates[i];
    if (!g || !g.active) continue;
    gates.push({
      id: g.id,
      rowId: g.rowId,
      x: g.x,
      z: g.z,
      halfWidth: g.halfWidth,
      op: g.op,
      value: g.value,
      label: g.label,
      polarity: g.polarity,
      mutable: g.mutable,
      lockHp: g.lockHp,
      maxLockHp: g.maxLockHp,
      chargeRatio: g.chargeRatio,
      triggered: g.triggered,
      dimmed: g.dimmed,
      hitPulse: g.hitPulse,
      flipPulse: g.flipPulse,
    });
  }

  const vaults: VaultSnapshot[] = [];
  for (let i = 0; i < world.vaults.length; i++) {
    const v = world.vaults[i];
    if (!v || (!v.active && !v.broken)) continue;
    vaults.push({
      id: v.id,
      x: v.x,
      z: v.z,
      halfWidth: v.halfWidth,
      hp: v.hp,
      displayHp: v.displayHp,
      maxHp: v.maxHp,
      rewardWeapon: v.rewardWeapon,
      broken: v.broken,
      hitPulse: v.hitPulse,
    });
  }

  const enemies: EnemySnapshot[] = [];
  for (let i = 0; i < world.enemies.length; i++) {
    const e = world.enemies[i];
    if (!e || !e.active || e.consumed) continue;
    enemies.push({
      id: e.id,
      kind: e.kind,
      x: e.x,
      z: e.z,
      radius: e.radius,
      hp: e.hp,
      maxHp: e.maxHp,
      slowTimer: e.slowTimer,
      telegraphTimer: e.telegraphTimer,
      linkedGateId: e.linkedGateId,
      hitPulse: e.hitPulse,
    });
  }

  const barrels: BarrelSnapshot[] = [];
  for (let i = 0; i < world.barrels.length; i++) {
    const b = world.barrels[i];
    if (!b || (!b.active && !b.detonated)) continue;
    barrels.push({
      id: b.id,
      x: b.x,
      z: b.z,
      radius: b.radius,
      blastRadius: b.blastRadius,
      hp: b.hp,
      displayHp: b.displayHp,
      detonated: b.detonated,
      hitPulse: b.hitPulse,
    });
  }

  const lenses: PrismLensSnapshot[] = [];
  for (let i = 0; i < world.lenses.length; i++) {
    const l = world.lenses[i];
    if (!l || !l.active) continue;
    lenses.push({
      id: l.id,
      x: l.x,
      z: l.z,
      halfWidth: l.halfWidth,
      pulse: l.pulse,
    });
  }

  const projectiles: ProjectileSnapshot[] = [];
  for (let i = 0; i < world.projectiles.length; i++) {
    const p = world.projectiles[i];
    if (!p || !p.active) continue;
    projectiles.push({
      id: p.id,
      x: p.x,
      z: p.z,
      vx: p.vx,
      vz: p.vz,
      weapon: p.weapon,
      amplified: p.amplified,
      powerScale: p.powerScale,
      hostile: p.hostile,
    });
  }

  let bossSnapshot: BossSnapshot | null = null;
  if (world.boss !== null) {
    const b = world.boss;
    const pylons: BossPylonSnapshot[] = b.pylons.map((p) => ({
      id: p.id,
      x: p.x,
      z: p.z,
      hp: p.hp,
      maxHp: p.maxHp,
      destroyed: p.destroyed,
    }));
    const hazardZones: BossHazardZone[] = b.hazardZones.map((z) => ({
      id: z.id,
      x: z.x,
      z: z.z,
      halfWidth: z.halfWidth,
      depth: z.depth,
      warningProgress: z.warningProgress,
      firing: z.firing,
    }));
    bossSnapshot = {
      active: b.active,
      id: b.id,
      name: b.name,
      phase: b.phase,
      maxPhases: b.maxPhases,
      x: b.x,
      z: b.z,
      hp: b.hp,
      maxHp: b.maxHp,
      secondaryCore: b.secondaryCore
        ? {
            x: b.secondaryCore.x,
            z: b.secondaryCore.z,
            shielded: b.secondaryCore.shielded,
          }
        : null,
      shielded: b.shielded,
      pylons,
      hazardZones,
      hitPulse: b.hitPulse,
      introProgress: b.introProgress,
      enrage: b.enrage,
    };
  }

  return {
    phase: world.phase,
    sector: world.sector,
    simTime: world.simTime,
    speedMultiplier: world.speedMultiplier,
    trackHalfWidth: TRACK_HALF_WIDTH,
    playerZ: PLAYER_Z,
    runwayProgress: world.runwayProgress,
    squadX: world.squadX,
    squadCount: world.squadCount,
    formationRadius: world.formationRadius,
    tiers: {
      u1: world.tiers.u1,
      u2: world.tiers.u2,
      u3: world.tiers.u3,
      totalVisible: world.tiers.totalVisible,
    },
    dronePositions: world.dronePositions.map((d) => ({
      x: d.x,
      z: d.z,
      tier: d.tier,
    })),
    weapon: world.weapon,
    weaponLevel: world.weaponLevel,
    arsenal: { ...world.learnedWeaponLevels },
    overclockStacks: world.overclockStacks,
    rampageStacks: world.rampageStacks,
    gateStreak: world.gateStreak,
    bladesCount: world.bladesCount,
    bladesAngle: world.bladesAngle,
    masteryCount: world.masteryCount,
    resonance: world.resonance,
    overdriveTimer: world.overdriveTimer,
    aegisTimer: world.aegisTimer,
    aegisCooldown: world.aegisCooldown,
    aegisMaxCooldown: world.aegisMaxCooldown,
    trueSquadDps: world.trueSquadDps,
    defeatReason: world.defeatReason,
    stats: {
      kills: world.stats.kills,
      gatesImproved: world.stats.gatesImproved,
      vaultsCracked: world.stats.vaultsCracked,
      maxChain: world.stats.maxChain,
      peakSquad: world.stats.peakSquad,
    },
    gates,
    vaults,
    enemies,
    barrels,
    lenses,
    projectiles,
    boss: bossSnapshot,
    ...(world.endless
      ? {
          endless: {
            wave: world.endless.wave,
            bosses: world.endless.bossesDefeated,
            distance: world.endless.completedDistance + world.scrollDistance,
            upgrades: { ...world.endless.upgrades },
            offers: [...world.endless.offers],
          },
        }
      : {}),
  };
}
