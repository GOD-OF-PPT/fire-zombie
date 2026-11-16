import type {
  BossId,
  DefeatReason,
  DronePosition,
  EnemyKind,
  GamePhase,
  GateOp,
  GatePolarity,
  RewardId,
  RunStats,
  SectorId,
  TierBreakdown,
  WeaponId,
  RunModifiers,
} from '../types/game';
import type { SectorScriptConfig } from '../config/sectors';
import { EntityPool } from './pool';

export type DasherState = 'APPROACH' | 'TELEGRAPH' | 'DASH';

export interface SimGate {
  id: number;
  rowId: number;
  prevX: number;
  prevZ: number;
  x: number;
  z: number;
  vz: number;
  halfWidth: number;
  halfDepth: number;
  op: GateOp;
  value: number;
  label: string;
  polarity: GatePolarity;
  mutable: boolean;
  isLockFlip: boolean;
  lockHp: number;
  maxLockHp: number;
  accumulatedDamage: number;
  damagePerStep: number;
  stepDelta: number;
  maxValue: number;
  minValue: number;
  chargeRatio: number;
  wasNonPositive: boolean;
  flipBonusGranted: boolean;
  triggered: boolean;
  dimmed: boolean;
  hitPulse: number;
  flipPulse: number;
  active: boolean;
}

export interface SimGateRow {
  id: number;
  layout: 'paired' | 'standalone';
  prevZ: number;
  z: number;
  vz: number;
  dividerX: number;
  triggered: boolean;
  leftGateId: number | null;
  rightGateId: number | null;
  singleGateId: number | null;
  active: boolean;
}

export interface SimVault {
  id: number;
  prevX: number;
  prevZ: number;
  x: number;
  z: number;
  vz: number;
  halfWidth: number;
  halfDepth: number;
  hp: number;
  displayHp: number;
  maxHp: number;
  rewardWeapon: RewardId;
  broken: boolean;
  hitPulse: number;
  active: boolean;
}

export interface SimEnemy {
  id: number;
  kind: EnemyKind;
  prevX: number;
  prevZ: number;
  x: number;
  z: number;
  radius: number;
  hp: number;
  maxHp: number;
  slowTimer: number;
  telegraphTimer: number;
  dasherState: DasherState;
  linkedGateId: number | null;
  siphonDrainAcc: number;
  mitosisGeneration: number;
  bladeHitCooldown: number;
  hitPulse: number;
  consumed: boolean;
  bypassed: boolean;
  active: boolean;
}

export interface SimBarrel {
  id: number;
  prevX: number;
  prevZ: number;
  x: number;
  z: number;
  vz: number | null;
  radius: number;
  blastRadius: number;
  hp: number;
  displayHp: number;
  detonated: boolean;
  chainTimer: number | null;
  chainScheduledAt: number | null;
  scheduledChainIndex: number;
  hitPulse: number;
  active: boolean;
}

export interface SimPrismLens {
  id: number;
  prevX: number;
  prevZ: number;
  x: number;
  z: number;
  baseX: number;
  vz: number | null;
  driftAmp: number;
  driftFreq: number;
  age: number;
  halfWidth: number;
  halfDepth: number;
  pulse: number;
  active: boolean;
}

export interface SimProjectile {
  id: number;
  prevX: number;
  prevZ: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  weapon: WeaponId;
  damage: number;
  remainingPierce: number;
  amplified: boolean;
  powerScale: number;
  hostile: boolean;
  hostileLoss: number;
  distanceTraveled: number;
  maxRange: number;
  splashRadius: number;
  splashDamageRatio: number;
  cryoSlowDuration: number;
  sweepStartFraction: number;
  hitIds: Set<number>;
  active: boolean;
}

export interface SimBossHazardZone {
  id: number;
  x: number;
  z: number;
  halfWidth: number;
  depth: number;
  warningDuration: number;
  fireDuration: number;
  elapsed: number;
  warningProgress: number;
  firing: boolean;
  strikeLoss: number;
  damageApplied: boolean;
}

export interface SimBossPylon {
  id: number;
  prevX: number;
  prevZ: number;
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
}

export interface SimBossSecondaryCore {
  prevX: number;
  prevZ: number;
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  shielded: boolean;
}

export interface SimBossState {
  entityId: number;
  secondaryEntityId: number;
  active: boolean;
  id: BossId;
  name: string;
  phase: 1 | 2 | 3;
  maxPhases: 2 | 3;
  prevX: number;
  prevZ: number;
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  hp: number;
  maxHp: number;
  secondaryCore: SimBossSecondaryCore | null;
  shielded: boolean;
  pylons: SimBossPylon[];
  hazardZones: SimBossHazardZone[];
  hitPulse: number;
  introProgress: number;
  phaseElapsed: number;
  /** Seconds since the intro finished, across phases. */
  fightElapsed: number;
  /** Timer-rate multiplier (1 = calm) once the fight overruns its enrage threshold. */
  enrage: number;
  enragePulseTimer: number;
  hazardTimer: number;
  hazardCycle: number;
  summonTimer: number;
  lensTimer: number;
  orbTimer: number;
  shieldSwapTimer: number;
  barrelTimer: number;
}

export interface EndlessRunState {
  wave: number;
  bossesDefeated: number;
  completedDistance: number;
  upgrades: Partial<Record<import('../types/game').EndlessUpgradeId, number>>;
  offers: import('../types/game').EndlessUpgradeId[];
}

export interface SimWorld {
  phase: GamePhase;
  mods: RunModifiers;
  sector: SectorId;
  endless: EndlessRunState | null;
  simTime: number;
  speedMultiplier: 1 | 2;
  nextEntityId: number;

  scrollDistance: number;
  currentScrollSpeed: number;
  runwayProgress: number;
  spawnCursor: number;
  /** Runway script for this run (sector 4 is generated from the layout seed). */
  script: SectorScriptConfig;
  /** Per-encounter mirror flags for this run (empty = authored layout). */
  mirrorFlags: boolean[];
  bossSpawned: boolean;

  prevSquadX: number;
  squadX: number;
  squadCount: number;
  formationRadius: number;
  tiers: TierBreakdown;
  dronePositions: DronePosition[];

  weapon: WeaponId;
  weaponLevel: 1 | 2 | 3;
  learnedWeaponLevels: Record<WeaponId, 0 | 1 | 2 | 3>;
  fireCooldown: number;

  bladesCount: number;
  bladesAngle: number;
  masteryCount: number;

  resonance: number;
  overdriveTimer: number;
  overdriveJustStarted: boolean;
  trueSquadDps: number;

  defeatReason: DefeatReason;
  stats: RunStats;

  gateRows: SimGateRow[];
  gates: SimGate[];
  vaults: SimVault[];
  enemies: SimEnemy[];
  barrels: SimBarrel[];
  lenses: SimPrismLens[];
  projectiles: SimProjectile[];
  boss: SimBossState | null;

  gateRowPool: EntityPool<SimGateRow>;
  gatePool: EntityPool<SimGate>;
  vaultPool: EntityPool<SimVault>;
  enemyPool: EntityPool<SimEnemy>;
  barrelPool: EntityPool<SimBarrel>;
  lensPool: EntityPool<SimPrismLens>;
  projectilePool: EntityPool<SimProjectile>;
}

export function allocEntityId(world: SimWorld): number {
  const id = world.nextEntityId;
  world.nextEntityId += 1;
  return id;
}

export function createEntityPools(): Pick<
  SimWorld,
  | 'gateRowPool'
  | 'gatePool'
  | 'vaultPool'
  | 'enemyPool'
  | 'barrelPool'
  | 'lensPool'
  | 'projectilePool'
> {
  const gateRowPool = new EntityPool<SimGateRow>(
    16,
    () => ({
      id: 0,
      layout: 'paired',
      prevZ: 0,
      z: 0,
      vz: 0,
      dividerX: 0,
      triggered: false,
      leftGateId: null,
      rightGateId: null,
      singleGateId: null,
      active: false,
    }),
    (r) => {
      r.id = 0;
      r.layout = 'paired';
      r.prevZ = 0;
      r.z = 0;
      r.vz = 0;
      r.dividerX = 0;
      r.triggered = false;
      r.leftGateId = null;
      r.rightGateId = null;
      r.singleGateId = null;
      r.active = false;
    },
  );

  const gatePool = new EntityPool<SimGate>(
    32,
    () => ({
      id: 0,
      rowId: 0,
      prevX: 0,
      prevZ: 0,
      x: 0,
      z: 0,
      vz: 0,
      halfWidth: 2.5,
      halfDepth: 0.28,
      op: 'add',
      value: 0,
      label: '0',
      polarity: 'neutral',
      mutable: false,
      isLockFlip: false,
      lockHp: 0,
      maxLockHp: 0,
      accumulatedDamage: 0,
      damagePerStep: 10,
      stepDelta: 1,
      maxValue: 28,
      minValue: -35,
      chargeRatio: 0,
      wasNonPositive: false,
      flipBonusGranted: false,
      triggered: false,
      dimmed: false,
      hitPulse: 0,
      flipPulse: 0,
      active: false,
    }),
    (g) => {
      g.id = 0;
      g.rowId = 0;
      g.prevX = 0;
      g.prevZ = 0;
      g.x = 0;
      g.z = 0;
      g.vz = 0;
      g.halfWidth = 2.5;
      g.halfDepth = 0.28;
      g.op = 'add';
      g.value = 0;
      g.label = '0';
      g.polarity = 'neutral';
      g.mutable = false;
      g.isLockFlip = false;
      g.lockHp = 0;
      g.maxLockHp = 0;
      g.accumulatedDamage = 0;
      g.damagePerStep = 10;
      g.stepDelta = 1;
      g.maxValue = 28;
      g.minValue = -35;
      g.chargeRatio = 0;
      g.wasNonPositive = false;
      g.flipBonusGranted = false;
      g.triggered = false;
      g.dimmed = false;
      g.hitPulse = 0;
      g.flipPulse = 0;
      g.active = false;
    },
  );

  const vaultPool = new EntityPool<SimVault>(
    16,
    () => ({
      id: 0,
      prevX: 0,
      prevZ: 0,
      x: 0,
      z: 0,
      vz: 0,
      halfWidth: 1.2,
      halfDepth: 0.65,
      hp: 0,
      displayHp: 0,
      maxHp: 0,
      rewardWeapon: 'pulse',
      broken: false,
      hitPulse: 0,
      active: false,
    }),
    (v) => {
      v.id = 0;
      v.prevX = 0;
      v.prevZ = 0;
      v.x = 0;
      v.z = 0;
      v.vz = 0;
      v.halfWidth = 1.2;
      v.halfDepth = 0.65;
      v.hp = 0;
      v.displayHp = 0;
      v.maxHp = 0;
      v.rewardWeapon = 'pulse';
      v.broken = false;
      v.hitPulse = 0;
      v.active = false;
    },
  );

  const enemyPool = new EntityPool<SimEnemy>(
    128,
    () => ({
      id: 0,
      kind: 'crawler',
      prevX: 0,
      prevZ: 0,
      x: 0,
      z: 0,
      radius: 0.48,
      hp: 1,
      maxHp: 1,
      slowTimer: 0,
      telegraphTimer: 0,
      dasherState: 'APPROACH',
      linkedGateId: null,
      siphonDrainAcc: 0,
      mitosisGeneration: 0,
      bladeHitCooldown: 0,
      hitPulse: 0,
      consumed: false,
      bypassed: false,
      active: false,
    }),
    (e) => {
      e.id = 0;
      e.kind = 'crawler';
      e.prevX = 0;
      e.prevZ = 0;
      e.x = 0;
      e.z = 0;
      e.radius = 0.48;
      e.hp = 1;
      e.maxHp = 1;
      e.slowTimer = 0;
      e.telegraphTimer = 0;
      e.dasherState = 'APPROACH';
      e.linkedGateId = null;
      e.siphonDrainAcc = 0;
      e.mitosisGeneration = 0;
      e.bladeHitCooldown = 0;
      e.hitPulse = 0;
      e.consumed = false;
      e.bypassed = false;
      e.active = false;
    },
  );

  const barrelPool = new EntityPool<SimBarrel>(
    32,
    () => ({
      id: 0,
      prevX: 0,
      prevZ: 0,
      x: 0,
      z: 0,
      vz: null,
      radius: 0.75,
      blastRadius: 4.5,
      hp: 15,
      displayHp: 15,
      detonated: false,
      chainTimer: null,
      chainScheduledAt: null,
      scheduledChainIndex: 1,
      hitPulse: 0,
      active: false,
    }),
    (b) => {
      b.id = 0;
      b.prevX = 0;
      b.prevZ = 0;
      b.x = 0;
      b.z = 0;
      b.vz = null;
      b.radius = 0.75;
      b.blastRadius = 4.5;
      b.hp = 15;
      b.displayHp = 15;
      b.detonated = false;
      b.chainTimer = null;
      b.chainScheduledAt = null;
      b.scheduledChainIndex = 1;
      b.hitPulse = 0;
      b.active = false;
    },
  );

  const lensPool = new EntityPool<SimPrismLens>(
    16,
    () => ({
      id: 0,
      prevX: 0,
      prevZ: 0,
      x: 0,
      z: 0,
      baseX: 0,
      vz: null,
      driftAmp: 0,
      driftFreq: 0,
      age: 0,
      halfWidth: 1.6,
      halfDepth: 0.3,
      pulse: 0,
      active: false,
    }),
    (l) => {
      l.id = 0;
      l.prevX = 0;
      l.prevZ = 0;
      l.x = 0;
      l.z = 0;
      l.baseX = 0;
      l.vz = null;
      l.driftAmp = 0;
      l.driftFreq = 0;
      l.age = 0;
      l.halfWidth = 1.6;
      l.halfDepth = 0.3;
      l.pulse = 0;
      l.active = false;
    },
  );

  const projectilePool = new EntityPool<SimProjectile>(
    256,
    () => ({
      id: 0,
      prevX: 0,
      prevZ: 0,
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      radius: 0.14,
      weapon: 'pulse',
      damage: 1,
      remainingPierce: 0,
      amplified: false,
      powerScale: 1,
      hostile: false,
      hostileLoss: 0,
      distanceTraveled: 0,
      maxRange: 64,
      splashRadius: 0,
      splashDamageRatio: 0,
      cryoSlowDuration: 0,
      sweepStartFraction: 0,
      hitIds: new Set<number>(),
      active: false,
    }),
    (p) => {
      p.id = 0;
      p.prevX = 0;
      p.prevZ = 0;
      p.x = 0;
      p.z = 0;
      p.vx = 0;
      p.vz = 0;
      p.radius = 0.14;
      p.weapon = 'pulse';
      p.damage = 1;
      p.remainingPierce = 0;
      p.amplified = false;
      p.powerScale = 1;
      p.hostile = false;
      p.hostileLoss = 0;
      p.distanceTraveled = 0;
      p.maxRange = 64;
      p.splashRadius = 0;
      p.splashDamageRatio = 0;
      p.cryoSlowDuration = 0;
      p.sweepStartFraction = 0;
      p.hitIds.clear();
      p.active = false;
    },
  );

  return {
    gateRowPool,
    gatePool,
    vaultPool,
    enemyPool,
    barrelPool,
    lensPool,
    projectilePool,
  };
}
