import { ENEMY_CONFIGS } from '../config/enemies';
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
import { generateBlitzScript } from '../config/blitz';
import { generateEndlessStage } from '../config/endless';
import {
  applyContractWallClamp,
  hasMutator,
  resolveDoomOrbImpacts,
  resolveJumpPadCrossings,
  stepCompetitionEntitiesMotion,
  stepJumpArc,
  stepMidRunSpectacles,
  stepSingularities,
  syncActiveFusions,
} from './competition';
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
import { resolveGateRowCrossings, spawnGateRow } from './gates';
import {
  clamp,
  clampSquadX,
  computeFormationPositions,
  computeFormationRadius,
  computeTierBreakdown,
  computeTrueSquadDps,
  normalizeZero,
} from './math';
import { computeDynamicSwarmProfile, computeMirrorFlags, getBlitzDrillCue, spawnReadyRunwayEncounters, stepTrackAndSpawner } from './spawner';
import { addResonance, getEffectiveOverdriveDuration, tryStartManualOverdrive } from './resonance';
import { tryTriggerAegisPulse } from './aegis';
import { NUKE_BLAST_DURATION, NUKE_DROP_DURATION, NUKE_MAX_STOCKS, NUKE_TARGET_Z, stepNukeStrike, tryTriggerNukeStrike } from './nuke';
import { computeAuthoritativeEffectiveDps, stepProjectilesAndAutoFire, trySwapLeadWeapon } from './weapons';
import { computeRangeFrontCounterMult, initFiringRangeWorld, stepFiringRangeWorld } from './firingRange';
import { checkAndStepBossOmegaOverdrive, stepCoreShards, stepV20SetPieces } from './v20Mechanics';
import {
  applyAimAssistNudge,
  buildPantheonCoBossSnapshot,
  generatePantheonStageScript,
  PANTHEON_STAGE_META,
  stepPantheonCoBoss,
  stepTacticalDropEvents,
  stepTacticalFormations,
  stepV21Verticality,
  syncCoreReactorAwakening,
} from './v21Mechanics';
import {
  buildWingmanSnapshot,
  computeAbyssalHeatTier,
  cycleWingmanFormation,
  stepV22WingmenAndAbyss,
} from './v22Mechanics';
import {
  buildExpeditionNodeScript,
  buildNemesisSnapshot,
  stepV23Systems,
  tryTriggerNirvanaBurst,
} from './v23Mechanics';
import { compileCustomBlueprint } from './trackEditor';

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
  world.singularities.length = 0;
  world.jumpPads.length = 0;
  world.reflectors.length = 0;
  world.contractWalls.length = 0;
  world.doomOrbs.length = 0;
  world.skyCargos.length = 0;
  world.maglevTrains.length = 0;
  world.magRails.length = 0;
  world.capTowers.length = 0;
  world.phaseGates.length = 0;
  world.coreShards.length = 0;
  world.collapseRifts.length = 0;
  world.highSpires.length = 0;
  world.tacticalEvents.length = 0;
  world.pantheonCoBoss = null;
  world.seekerBlades.length = 0;
  world.boss = null;
  world.nemesis = null;
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
  world.squadAirY = 0;
  world.jumpTimer = 0;
  world.landingAmbushX = undefined;
  world.cutback = undefined;
  world.ricochetsThisTick = 0;
  world.spectacleIdSeq = 0;
  world.lastCargoStage = 0;
  world.lastMaglevStage = 0;
  world.lastTacStage = 0;
  world.lastVertStage = 0;
  world.lastFormationStage = 0;
  world.lastDropEventStage = 0;
  world.weatherState = 'none';
  world.onMagRail = false;
  world.magBoostTimer = 0;
  world.phaseSyncTimer = 0;
  world.collectedShards = 0;
  world.coreReactorTier = 0;
  world.reactorPrismRingTimer = 0;
  world.reactorWallActive = false;
  world.reactorWallZ = 0;
  world.reactorDropUpgrades = 0;
  world.pantheonStage = 1;
  world.pantheonClears = 0;
  world.pantheonArenaInitialized = false;
  world.pantheonCoBoss = null;
  world.abyssalHeat = world.mods.fairTrial ? 0 : computeAbyssalHeatTier(world.mods.abyssalPacts);
  world.lastAbyssVanguardStage = 0;
  world.bossHarmonicShield = false;
  world.bossApexMove = null;
  world.bossApexTimer = 4.2;
  world.bossApexActiveTimer = 0;
  world.bossApexSafeX = 0;
  world.wingmanId = world.mods.fairTrial ? null : (world.mods.wingmanId ?? null);
  world.wingmanFormation = world.mods.wingmanFormation ?? 'volley_sync';
  world.wingmanOrbitAngle = 0;
  world.wingmanFireTimer = 0.24;
  world.wingmanPulseTimer = 0.2;
  world.wingmanLeftPos = { x: -1.5, y: 1.25, z: PLAYER_Z - 0.5 };
  world.wingmanRightPos = { x: 1.5, y: 1.25, z: PLAYER_Z - 0.5 };
  world.nemesis = null;
  world.nemesisSpawned = false;
  world.nirvanaCharge = world.mods.expeditionRelics?.includes('relic_nirvana_core') ? 0.5 : 0;
  world.nirvanaActiveTimer = 0;
  world.nirvanaArchetype = null;
  world.triPrismLatticeTimer = 0;
  world.triPrismTickTimer = 0.12;
  world.triPrismLinks = [];
  world.lastWingmanMirrorTick = -999;
  world.lastFixedMirrorTick = -999;
  world.v23RefractedDmg = 0;
  world.v23LatticeDmg = 0;
  world.v23NirvanaDmg = 0;
  world.activeFusions = [];
  world.damageBySource = {
    pulse: 0,
    scatter: 0,
    rail: 0,
    plasma: 0,
    cryo: 0,
    blades: 0,
    fusions: 0,
    deflect: 0,
    explosives: 0,
  };
  world.squadCount = startSquad;

  const startW = !world.mods.fairTrial && world.mods.starterWeapon ? world.mods.starterWeapon : 'pulse';
  world.weapon = startW;
  world.weaponLevel = 1;
  world.learnedWeaponLevels = {
    pulse: 1,
    scatter: 0,
    rail: 0,
    plasma: 0,
    cryo: 0,
  };
  world.learnedWeaponLevels[startW] = 1;
  world.auxCooldowns = { pulse: 0.18, scatter: 0.24, rail: 0.3, plasma: 0.36, cryo: 0.22 };
  world.overclockStacks = 0;
  world.rampageStacks = 0;
  world.rampageKillCounter = 0;
  world.rampageTimer = 0;
  world.activeLoadout = startW !== 'pulse' ? [startW] : [];
  world.primaryFusion = null;
  world.activeDualSynergy = null;
  world.overlimitResonance = null;
  world.overlimitTickCounter = 0;
  world.isFiringRange = Boolean(world.mods.firingRange);
  world.rangePreset = 'armored';
  world.rangeReflectorAngle = 36;
  world.rangeForceOverlimit = true;
  world.rangeDamageBuckets = new Float64Array(180);
  world.rangeBucketCursor = 0;
  world.rangePrevTotalDmg = 0;
  world.rangeRealizedDps = 0;
  world.rangeRespawnTimer = 0;
  world.pendingSwapWeapon = null;
  world.reserveTroops = 0;
  world.triFusionTimer = 0;
  world.gateStreak = 0;
  world.swarmDirectorTimer = 0.18;
  world.swarmDirectorCycle = 0;
  world.swarmSpatialCursor = 0;
  world.swarmPeakTier = 1;
  world.swarmBreachGrace = 0;
  world.nukeMaxStocks = world.mods.fairTrial ? 1 : NUKE_MAX_STOCKS;
  world.nukeStocks = world.nukeMaxStocks;
  world.nukeCharge = 1.0;
  world.nukeSalvoChain = 0;
  world.nukeChainWindowTimer = 0;
  world.nukeSalvo = [];
  world.nukeDropTimer = 0;
  world.nukeBlastTimer = 0;
  world.nukeTargetX = 0;
  world.nukeTargetZ = NUKE_TARGET_Z;
  world.isNukeDetonating = false;
  world.playerHasSteered = false;
  world.afkIdleTimer = 0;
  world.fireCooldown = 0;
  world.volleyIndex = 0;

  world.bladesCount = !world.mods.fairTrial && world.mods.starterBlade ? 1 : 0;
  world.bladesAngle = 0;
  world.masteryCount = 0;

  world.resonance = 0;
  world.overdriveTimer = 0;
  world.overdriveJustStarted = false;
  world.aegisTimer = 0;
  world.aegisCooldown = 0;
  world.aegisMaxCooldown = Math.max(2.0, world.mods.aegisCooldownSec ?? 5.5);
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
    rampageKillCounter: 0,
    rampageTimer: 0,
    activeLoadout: [],
    primaryFusion: null,
    activeDualSynergy: null,
    overlimitResonance: null,
    overlimitTickCounter: 0,
    isFiringRange: false,
    rangePreset: 'armored',
    rangeReflectorAngle: 36,
    rangeForceOverlimit: true,
    rangeDamageBuckets: new Float64Array(180),
    rangeBucketCursor: 0,
    rangePrevTotalDmg: 0,
    rangeRealizedDps: 0,
    rangeRespawnTimer: 0,
    pendingSwapWeapon: null,
    reserveTroops: 0,
    triFusionTimer: 0,
    gateStreak: 0,
    swarmDirectorTimer: 0.18,
    swarmDirectorCycle: 0,
    swarmSpatialCursor: 0,
    swarmPeakTier: 1,
    swarmBreachGrace: 0,
    nukeCharge: 1.0,
    nukeStocks: NUKE_MAX_STOCKS,
    nukeMaxStocks: NUKE_MAX_STOCKS,
    nukeSalvoChain: 0,
    nukeChainWindowTimer: 0,
    nukeSalvo: [],
    nukeDropTimer: 0,
    nukeBlastTimer: 0,
    nukeTargetX: 0,
    nukeTargetZ: NUKE_TARGET_Z,
    isNukeDetonating: false,
    playerHasSteered: false,
    afkIdleTimer: 0,
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
    aegisMaxCooldown: 5.5,
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

    squadAirY: 0,
    jumpTimer: 0,
    ricochetsThisTick: 0,
    activeFusions: [],
    seekerBlades: [],
    damageBySource: {
      blades: 0,
      pulse: 0,
      scatter: 0,
      rail: 0,
      plasma: 0,
      cryo: 0,
      fusions: 0,
      deflect: 0,
      explosives: 0,
    },
    singularities: [],
    jumpPads: [],
    reflectors: [],
    contractWalls: [],
    doomOrbs: [],
    skyCargos: [],
    maglevTrains: [],
    magRails: [],
    capTowers: [],
    phaseGates: [],
    coreShards: [],
    weatherState: 'none',
    onMagRail: false,
    magBoostTimer: 0,
    phaseSyncTimer: 0,
    collectedShards: 0,
    collapseRifts: [],
    highSpires: [],
    tacticalEvents: [],
    coreReactorTier: 0,
    reactorPrismRingTimer: 0,
    reactorWallActive: false,
    reactorWallZ: 0,
    reactorDropUpgrades: 0,
    pantheonStage: 1,
    pantheonClears: 0,
    pantheonArenaInitialized: false,
    pantheonCoBoss: null,
    abyssalHeat: 0,
    lastAbyssVanguardStage: 0,
    bossHarmonicShield: false,
    bossApexMove: null,
    bossApexTimer: 4.2,
    bossApexActiveTimer: 0,
    bossApexSafeX: 0,
    wingmanId: null,
    wingmanFormation: 'volley_sync',
    wingmanOrbitAngle: 0,
    wingmanFireTimer: 0.24,
    wingmanPulseTimer: 0.2,
    wingmanLeftPos: { x: -1.5, y: 1.25, z: PLAYER_Z - 0.5 },
    wingmanRightPos: { x: 1.5, y: 1.25, z: PLAYER_Z - 0.5 },
    nemesis: null,
    nemesisSpawned: false,
    nirvanaCharge: 0,
    nirvanaActiveTimer: 0,
    nirvanaArchetype: null,
    triPrismLatticeTimer: 0,
    triPrismTickTimer: 0.12,
    triPrismLinks: [],
    lastWingmanMirrorTick: -999,
    lastFixedMirrorTick: -999,
    v23RefractedDmg: 0,
    v23LatticeDmg: 0,
    v23NirvanaDmg: 0,
    lastVertStage: 0,
    lastFormationStage: 0,
    lastDropEventStage: 0,
    lastTacStage: 0,
    spectacleIdSeq: 0,
    lastCargoStage: 0,
    lastMaglevStage: 0,

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
      bossHpMult: Math.max(1, (mods.bossHpMult ?? 1) * (mods.fairTrial ? 1 : 1 + computeAbyssalHeatTier(mods.abyssalPacts) * 0.08)),
      endless: mods.endless === true,
      manualEndlessDraft: mods.manualEndlessDraft === true,
      aegisCooldownSec: mods.aegisCooldownSec,
      aegisDurationSec: mods.aegisDurationSec,
      autoAegisCharges: mods.autoAegisCharges,
      critChance: mods.critChance,
      blitz: mods.blitz === true,
      mutators: mods.mutators ? [...mods.mutators] : undefined,
      fairTrial: mods.fairTrial === true,
      starterWeapon: mods.starterWeapon,
      starterBlade: mods.starterBlade === true,
      specRicochet: mods.fairTrial ? 0 : Math.max(0, Math.min(3, Math.floor(mods.specRicochet ?? 0))),
      specVortex: mods.fairTrial ? 0 : Math.max(0, Math.min(3, Math.floor(mods.specVortex ?? 0))),
      specShatter: mods.fairTrial ? 0 : Math.max(0, Math.min(3, Math.floor(mods.specShatter ?? 0))),
      equippedChips: mods.fairTrial || !mods.equippedChips ? [] : mods.equippedChips.slice(0, 3),
      firingRange: mods.firingRange === true,
      pantheon: mods.pantheon === true,
      aimAssist: mods.fairTrial ? false : mods.aimAssist === true,
      abyssalPacts: mods.fairTrial || !mods.abyssalPacts ? [] : [...mods.abyssalPacts],
      wingmanId: mods.fairTrial ? null : (mods.wingmanId ?? (mods as { equippedWingman?: typeof mods.wingmanId }).equippedWingman ?? null),
      wingmanFormation: mods.wingmanFormation ?? 'volley_sync',
      expeditionNode: mods.fairTrial ? undefined : mods.expeditionNode,
      expeditionNodeKind: mods.fairTrial ? undefined : (mods.expeditionNode?.kind ?? mods.expeditionNodeKind),
      expeditionRelics: mods.fairTrial || !mods.expeditionRelics ? undefined : [...mods.expeditionRelics],
      forceNemesisAmbush: mods.fairTrial ? false : mods.forceNemesisAmbush,
      customBlueprint: mods.fairTrial ? undefined : mods.customBlueprint,
    };
  } else {
    world.mods = { bonusSquad: 0, damageMult: 1, resonanceMult: 1 };
  }
  const pantheon = world.mods.pantheon === true;
  const endless = world.mods.endless === true && !pantheon;
  const blitz = world.mods.blitz === true && !endless && !pantheon;
  world.endless = endless ? { wave: 1, bossesDefeated: 0, completedDistance: 0, upgrades: {}, offers: [] } : null;
  let compiledCustom: ReturnType<typeof compileCustomBlueprint> | null = null;
  if (world.mods.customBlueprint && !world.mods.fairTrial) {
    compiledCustom = compileCustomBlueprint(world.mods.customBlueprint);
    world.mods.customTrackProps = compiledCustom.runtimeProps.map((p) => ({ ...p, spawned: false }));
    if (world.mods.customBlueprint.forceNemesis) world.mods.forceNemesisAmbush = true;
    if (world.mods.customBlueprint.abyssalPacts?.length) {
      world.mods.abyssalPacts = [...world.mods.customBlueprint.abyssalPacts];
    }
  }
  const sectorCfg = compiledCustom
    ? compiledCustom.script
    : world.mods.expeditionNode && !world.mods.fairTrial
      ? buildExpeditionNodeScript(world.mods.expeditionNode, world.mods.layoutSeed || 202623, 24 + world.mods.bonusSquad)
      : pantheon
        ? generatePantheonStageScript(world.mods.layoutSeed || 202621, 1)
        : endless
          ? generateEndlessStage(world.mods.layoutSeed ?? 1, 1)
          : blitz
            ? generateBlitzScript(world.mods.layoutSeed || 1)
            : getSectorScript(sector, world.mods.layoutSeed ?? 0);
  world.script = sectorCfg;
  world.mirrorFlags =
    endless || blitz
      ? []
      : computeMirrorFlags(sectorCfg.encounters, world.mods.layoutSeed ?? 0, sector);
  clearCoreRunFields(world, sectorCfg.startSquad + world.mods.bonusSquad);
  if (blitz || pantheon) {
    const bw = !world.mods.fairTrial && world.mods.starterWeapon ? world.mods.starterWeapon : 'pulse';
    world.weapon = bw;
    world.weaponLevel = 2;
    world.learnedWeaponLevels[bw] = 2;
    if (bw !== 'pulse') world.activeLoadout = [bw];
    world.stats.vaultsCracked = 1;
    syncActiveFusions(world);
  }
  world.phase = 'PLAYING';
  if (world.mods.firingRange) {
    initFiringRangeWorld(world);
  } else {
    world.currentScrollSpeed = sectorCfg.scrollSpeed;
    spawnReadyRunwayEncounters(world);
  }
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
      // Round 4 (`barrel_carnival`): Volatile Overheat Barrels glow & auto-ignite if allowed to drift to point-blank!
      if (hasMutator(world, 'barrel_carnival') && !barrel.detonated && barrel.z >= PLAYER_Z - 7.6 && barrel.z <= PLAYER_Z - 1.2) {
        barrel.overheat = clamp((barrel.z - (PLAYER_Z - 7.6)) / 5.8, 0, 1);
        if (barrel.overheat >= 0.99 && barrel.chainTimer === null) {
          barrel.chainTimer = 0.02;
          barrel.chainScheduledAt = -1;
          barrel.scheduledChainIndex = 1;
        }
      }
    }
  }

  // Golden Prism Lenses
  for (let i = 0; i < world.lenses.length; i++) {
    const lens = world.lenses[i];
    if (lens && lens.active) {
      lens.prevX = lens.x;
      lens.prevZ = lens.z;
      lens.age += FIXED_DT;
      if (lens.driftFreq === -999) {
        lens.x = normalizeZero(
          clamp(world.squadX, -TRACK_HALF_WIDTH + lens.halfWidth, TRACK_HALF_WIDTH - lens.halfWidth),
        );
        lens.z = PLAYER_Z - 4.2;
        if (lens.age >= 3.8) lens.active = false;
      } else {
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
  }

  // Enemies & Boss AI
  stepEnemiesAI(world, events);
  stepBossAI(world, events);
}

function cullExpiredEntities(world: SimWorld): void {
  for (let i = world.reflectors.length - 1; i >= 0; i--) {
    const rf = world.reflectors[i]!;
    if (!rf.isWingmanMirror && (!rf.active || rf.z > DESPAWN_Z)) {
      world.reflectors.splice(i, 1);
    }
  }
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
  } else if (world.mods.manualOverdrive && !world.mods.fairTrial && world.squadCount > 0 && world.resonance < 1) {
    addResonance(world, 0.032 * FIXED_DT, []);
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

  if (world.swarmBreachGrace > 0) {
    world.swarmBreachGrace = snapTimerZero(world.swarmBreachGrace - FIXED_DT);
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
  if (Math.abs(input.dragDeltaX) > 1e-4 || input.keyAxisX !== 0) {
    world.playerHasSteered = true;
  }
  const railSpeedMult = world.onMagRail ? 1.55 : 1.0;
  const rawSquadX =
    world.squadX + input.dragDeltaX * railSpeedMult + input.keyAxisX * KEYBOARD_MOVE_SPEED * railSpeedMult * FIXED_DT;
  world.squadX = clampSquadX(rawSquadX, world.formationRadius);
  applyAimAssistNudge(world, Math.abs(input.dragDeltaX) > 1e-4 || input.keyAxisX !== 0);
  applyContractWallClamp(world);
  if (input.overdrive === true) {
    tryStartManualOverdrive(world, events);
  }
  if (input.aegisPulse === true) {
    tryTriggerAegisPulse(world, events, false);
  }
  if (input.nukeStrike === true) {
    tryTriggerNukeStrike(world, events);
  }
  if (input.swapWeapon === true) {
    trySwapLeadWeapon(world, events);
  }
  if (input.cycleWingman === true) {
    cycleWingmanFormation(world, events);
  }
  if (input.nirvanaBurst === true) {
    tryTriggerNirvanaBurst(world, events);
  }

  // Round 1: Endless Wave 2+ Orbital Anti-AFK Lockout — punishes pure 0-movement AFK parking while never touching active players!
  if (world.endless && world.endless.wave >= 2) {
    const moved =
      Math.abs(world.squadX - world.prevSquadX) > 0.006 ||
      input.overdrive === true ||
      input.aegisPulse === true ||
      input.nukeStrike === true ||
      input.swapWeapon === true ||
      input.cycleWingman === true ||
      input.nirvanaBurst === true;
    if (moved) {
      world.afkIdleTimer = 0;
    } else {
      world.afkIdleTimer += FIXED_DT;
      if (world.afkIdleTimer >= 5.2) {
        world.afkIdleTimer = 1.6;
        events.push({ type: 'AFK_LOCK_STRIKE', x: world.squadX, z: PLAYER_Z - 14 });
        if (world.boss && world.boss.active) {
          world.boss.hazardZones.push({
            id: world.nextEntityId++,
            x: world.squadX,
            z: -6.0,
            halfWidth: 1.85,
            depth: 28.0,
            warningProgress: 0.72,
            firing: false,
            warningDuration: 1.25,
            elapsed: 0.9,
            fireDuration: 0.35,
            strikeLoss: 10,
            damageApplied: false,
          });
        } else {
          spawnGateRow(world, {
            layout: 'standalone',
            z: PLAYER_Z - 15.0,
            vz: world.currentScrollSpeed,
            single: { x: world.squadX, halfWidth: 2.2, op: 'div', value: 3, mutable: false },
          });
        }
      }
    }
  }

  // Step 2: Track, Spawner & Tactical Nuke Descent/Detonation
  if (!world.isFiringRange) stepTrackAndSpawner(world, events);
  stepNukeStrike(world, events);

  // Step 3: Projectiles, Auto-Fire, Orbital/Seeker Blades & Fusion Singularities
  stepProjectilesAndAutoFire(world, events);
  stepOrbitalBlades(world, events);
  if (world.triFusionTimer > 0) {
    const nextTri = world.triFusionTimer - FIXED_DT;
    world.triFusionTimer = nextTri <= 1e-9 ? 0 : nextTri;
    if (world.triFusionTimer === 0) {
      syncActiveFusions(world);
    }
  }
  stepSingularities(world, events);

  // Step 4: World Entities Z, Set-Pieces, Jump Arc & Enemy / Boss AI
  stepWorldEntitiesMotion(world, events);
  stepCompetitionEntitiesMotion(world, events);
  if (!world.isFiringRange) stepMidRunSpectacles(world, events);
  stepV20SetPieces(world, events);
  stepV21Verticality(world, events);
  stepTacticalFormations(world, events);
  stepTacticalDropEvents(world, events);
  stepPantheonCoBoss(world, events);
  checkAndStepBossOmegaOverdrive(world, events);
  stepCoreShards(world, events);
  stepV22WingmenAndAbyss(world, events);
  stepV23Systems(world, events);
  stepJumpArc(world, events);

  // Step 5: Swept Projectile Collisions (Lenses, Enemies, Shootable Gates, Vaults, Barrels, Boss)
  resolveFriendlyProjectileCollisions(world, events);

  // Step 6: Staggered Chain Explosions
  stepChainExplosions(world, events, applyBarrelBlastToBoss);

  // Step 7: Boss Victory Check (locks VICTORY before Step 8/9 attrition!)
  if (!world.isFiringRange && checkBossVictory(world, events)) {
    cullExpiredEntities(world);
    reconcileFormationAndDps(world);
    return events;
  }

  // Step 8: Swept Jump Pads & Squad Gate Crossings
  resolveJumpPadCrossings(world, events);
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
  if (resolveBossAttacks(world, events) || resolveDoomOrbImpacts(world, events)) {
    cullExpiredEntities(world);
    reconcileFormationAndDps(world);
    return events;
  }

  // Step 10: Formation, True DPS, Culling & Timers (+ Firing Range Telemetry)
  if (world.isFiringRange) {
    stepFiringRangeWorld(world, events);
  }
  syncActiveFusions(world, events);
  syncCoreReactorAwakening(world, events);
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
      tier: ENEMY_CONFIGS[e.kind].tier,
      x: e.x,
      z: e.z,
      radius: e.radius,
      hp: e.hp,
      maxHp: e.maxHp,
      slowTimer: e.slowTimer,
      telegraphTimer: e.telegraphTimer,
      linkedGateId: e.linkedGateId,
      hitPulse: e.hitPulse,
      ...(e.isBountyElite ? { isBountyElite: true } : {}),
      ...(e.maxShieldHp > 0 && e.shieldHp > 0 ? { shieldRatio: e.shieldHp / e.maxShieldHp, shieldImpactX: e.shieldImpactX } : {}),
      ...(e.frenzyBuffed ? { frenzyBuffed: true } : {}),
      ...(e.armorBroken ? { armorBroken: true } : {}),
      ...(e.formationId ? { formationId: e.formationId, formationKind: e.formationKind, isFormationLeader: Boolean(e.isFormationLeader) } : {}),
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
      ...(b.overheat > 0 ? { overheat: b.overheat } : {}),
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
      titanRank: b.titanRank,
      titanScale: b.titanScale,
      hpBars: b.hpBars,
      secondaryCore: b.secondaryCore
        ? {
            x: b.secondaryCore.x,
            z: b.secondaryCore.z,
            shielded: b.secondaryCore.shielded,
          }
        : null,
      shielded: b.shielded,
      pylons,
      parts: b.parts.map((pt) => ({
        id: pt.id,
        slot: pt.slot,
        label: pt.label,
        x: pt.x,
        z: pt.z,
        hp: pt.hp,
        maxHp: pt.maxHp,
        hitPulse: pt.hitPulse,
        telegraph: pt.telegraph,
        destroyed: pt.destroyed,
      })),
      breakTimer: b.breakTimer,
      hazardZones,
      hitPulse: b.hitPulse,
      introProgress: b.introProgress,
      enrage: b.enrage,
      ...(world.bossHarmonicShield ? { harmonicShield: true } : {}),
      ...(world.bossApexActiveTimer > 0 && world.bossApexMove
        ? {
            apexMoveKind: world.bossApexMove,
                abyssalMutation: world.bossApexMove,
            apexMoveTimer: world.bossApexActiveTimer,
            apexSafeX: world.bossApexSafeX,
          }
        : {}),
      ...(b.omegaOverdrive
        ? {
            omegaOverdrive: true,
            omegaBeamState: b.omegaBeamState ?? 'idle',
            omegaBeamX: b.omegaBeamX ?? 0,
            omegaBeamProgress:
              b.omegaBeamState === 'charging'
                ? clamp(1 - (b.omegaBeamTimer ?? 0) / 1.45, 0, 1)
                : b.omegaBeamState === 'firing'
                  ? 1
                  : 0,
            omegaExecuted: Boolean(b.omegaExecuted),
          }
        : {}),
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
    nukeCharge: world.nukeCharge,
    nukeStocks: world.nukeStocks,
    nukeMaxStocks: world.nukeMaxStocks,
    nukeSalvoChain: world.nukeSalvoChain,
    nukeStrikes: world.nukeSalvo.map((s) => ({
      id: s.id,
      x: s.x,
      z: s.z,
      dropTimer: s.dropTimer,
      dropDuration: s.dropDuration,
      blastTimer: s.blastTimer,
      blastDuration: NUKE_BLAST_DURATION,
      salvoIndex: s.salvoIndex,
    })),
    nukeDropTimer: world.nukeDropTimer,
    nukeDropDuration: NUKE_DROP_DURATION,
    nukeBlastTimer: world.nukeBlastTimer,
    nukeTargetX: world.nukeTargetX,
    nukeTargetZ: world.nukeTargetZ,
    trueSquadDps: world.trueSquadDps,
    effectiveSquadDps: computeAuthoritativeEffectiveDps(world, true),
    activeLoadout: [...world.activeLoadout],
    activeDualSynergy: world.activeDualSynergy,
    overlimitResonance: world.overlimitResonance,
    ...(world.mods.fairTrial ? { fairTrial: true } : {}),
    ...(world.isFiringRange
      ? {
          isFiringRange: true,
          rangeRealizedDps: world.rangeRealizedDps,
          rangeCounterMult: computeRangeFrontCounterMult(world),
          rangeReflectorAngle: world.rangeReflectorAngle,
          rangePreset: world.rangePreset,
        }
      : {}),
    pendingSwapWeapon: world.pendingSwapWeapon,
    reserveTroops: world.reserveTroops,
    triFusionTimer: world.triFusionTimer,
    swarmMult: computeDynamicSwarmProfile(world).swarmMult,
    swarmTier: computeDynamicSwarmProfile(world).swarmTier,
    defeatReason: world.defeatReason,
    stats: {
      kills: world.stats.kills,
      gatesImproved: world.stats.gatesImproved,
      vaultsCracked: world.stats.vaultsCracked,
      maxChain: world.stats.maxChain,
      peakSquad: world.stats.peakSquad,
    },
    squadAirY: world.squadAirY,
    jumpTimeLeft: world.jumpTimer,
    inBlitzDrill: !!world.script.blitzDrill && world.scrollDistance >= world.script.blitzDrill.mirror - 64 &&
      world.scrollDistance < world.script.blitzDrill.pad + 26,
    runwaySpeed: world.currentScrollSpeed,
    drillCue: getBlitzDrillCue(world),
    mirrorTwinActive: hasMutator(world, 'mirror_twin'),
    blitzActive: world.mods.blitz === true && !world.endless,
    activeFusions: [...world.activeFusions],
    mutators: world.mods.mutators ? [...world.mods.mutators] : [],
    seekerPositions: world.seekerBlades.map((sb) => ({ x: sb.x, z: sb.z, hunting: sb.hunting })),
    damageBySource: { ...world.damageBySource },
    singularities: world.singularities.map((s) => ({
      id: s.id,
      x: s.x,
      z: s.z,
      radius: s.radius,
      timer: s.timer,
    })),
    jumpPads: world.jumpPads.map((p) => ({
      id: p.id,
      x: p.x,
      z: p.z,
      triggered: p.triggered,
    })),
    reflectors: world.reflectors.map((r) => ({
      id: r.id,
      x: r.x,
      z: r.z,
      lean: r.lean,
      ...(r.angleDeg !== undefined ? { angleDeg: r.angleDeg } : {}),
      pulse: r.pulse,
      ...(r.isWingmanMirror ? { isWingmanMirror: true } : {}),
    })),
    contractWalls: world.contractWalls.map((w) => ({
      id: w.id,
      zFront: w.zFront,
      zBack: w.zBack,
      bountySide: w.bountySide,
    })),
    doomOrbs: world.doomOrbs.map((o) => ({
      id: o.id,
      x: o.x,
      z: o.z,
      radius: o.radius,
      value: o.value,
      chargeRatio: o.chargeRatio,
      reflected: o.reflected,
      hitPulse: o.hitPulse,
    })),
    skyCargos: world.skyCargos.map((c) => ({
      id: c.id,
      x: c.x,
      y: c.y,
      z: c.z,
      hp: c.hp,
      maxHp: c.maxHp,
      state: c.state,
      hitPulse: c.hitPulse,
    })),
    maglevTrains: world.maglevTrains.map((tr) => ({
      id: tr.id,
      z: tr.z,
      dir: tr.dir,
      trainX: tr.trainX,
      state: tr.state,
      warningProgress: tr.warningProgress,
    })),
    magRails: world.magRails.map((r) => ({
      id: r.id,
      x: r.x,
      z: r.z,
      length: r.length,
      halfWidth: r.halfWidth,
      polarity: r.polarity,
    })),
    capTowers: world.capTowers.filter((c) => c.active && !c.discharged).map((c) => ({
      id: c.id,
      x: c.x,
      z: c.z,
      charge: c.charge,
      maxCharge: c.maxCharge,
      hitPulse: c.hitPulse,
    })),
    phaseGates: world.phaseGates.filter((pg) => pg.active && !pg.triggered).map((pg) => ({
      id: pg.id,
      x: pg.x,
      z: pg.z,
      halfWidth: pg.halfWidth,
      attune: pg.attune,
    })),
    coreShards: world.coreShards.filter((cs) => cs.active).map((cs) => ({
      id: cs.id,
      x: cs.x,
      z: cs.z,
      value: cs.value,
    })),
    weatherState: world.weatherState,
    magBoostTimer: world.magBoostTimer,
    phaseSyncTimer: world.phaseSyncTimer,
    collectedShards: world.collectedShards,
    collapseRifts: world.collapseRifts.filter((r) => r.active).map((r) => ({
      id: r.id,
      kind: r.kind,
      x: r.x,
      z: r.z,
      length: r.length,
      halfWidth: r.halfWidth,
    })),
    highSpires: world.highSpires.filter((sp) => sp.active && !sp.destroyed).map((sp) => ({
      id: sp.id,
      x: sp.x,
      z: sp.z,
      elevationY: sp.elevationY,
      hp: sp.hp,
      maxHp: sp.maxHp,
      shieldRatio: sp.maxShieldHp > 0 ? sp.shieldHp / sp.maxShieldHp : 0,
      chargeProgress: clamp(sp.chargeTimer / Math.max(0.1, sp.chargeDuration), 0, 1),
      hitPulse: sp.hitPulse,
    })),
    tacticalEvents: world.tacticalEvents.filter((te) => te.active && !te.completed).map((te) => ({
      id: te.id,
      kind: te.kind,
      x: te.x,
      z: te.z,
      radius: te.radius,
      hp: te.hp,
      maxHp: te.maxHp,
      captureProgress: te.captureProgress,
      timer: te.timer,
      hitPulse: te.hitPulse,
    })),
    coreReactorTier: world.coreReactorTier,
    reactorPrismRingTimer: world.reactorPrismRingTimer,
    reactorWallZ: world.reactorWallActive ? world.reactorWallZ : null,
    ...(world.abyssalHeat > 0 ? { abyssalHeat: world.abyssalHeat, abyssalHeatTier: world.abyssalHeat, abyssalPacts: world.mods.abyssalPacts ?? [] } : {}),
    wingmanState: buildWingmanSnapshot(world),
    nemesis: buildNemesisSnapshot(world),
    nirvanaCharge: world.nirvanaCharge,
    nirvanaActiveTimer: world.nirvanaActiveTimer,
    nirvanaArchetype: world.nirvanaArchetype,
    triPrismLatticeTimer: world.triPrismLatticeTimer,
    triPrismLinks: world.triPrismLinks,
    refractionDmgTotal: world.v23RefractedDmg,
    latticeDmgTotal: world.v23LatticeDmg,
    nirvanaDmgTotal: world.v23NirvanaDmg,
    ...(world.mods.expeditionNode ? { expeditionActive: true, expeditionAct: world.mods.expeditionNode.act } : {}),
    ...(world.mods.customBlueprint ? { customTrackTitle: world.mods.customBlueprint.title } : {}),
    ...(world.mods.pantheon
      ? {
          pantheonActive: true,
          pantheonStage: world.pantheonStage,
          pantheonAffixName: PANTHEON_STAGE_META[world.pantheonStage - 1]?.affixName ?? '',
          pantheonCoBoss: buildPantheonCoBossSnapshot(world.pantheonCoBoss),
        }
      : {}),
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
