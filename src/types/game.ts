export type GamePhase = 'TITLE' | 'PLAYING' | 'PAUSED' | 'VICTORY' | 'DEFEAT';
export type SectorId = 1 | 2 | 3;
export type WeaponId = 'pulse' | 'scatter' | 'rail' | 'plasma' | 'cryo';
export type GateOp = 'add' | 'sub' | 'mul' | 'div';
export type GatePolarity = 'positive' | 'negative' | 'neutral';
export type EnemyKind = 'crawler' | 'dasher' | 'bastion' | 'mitosis' | 'siphon';
export type DefeatReason =
  | 'NEGATIVE_GATE'
  | 'DIVISION_GATE'
  | 'ENEMY_BREACH'
  | 'BOSS_ATTACK'
  | null;

export type NonNullDefeatReason = Exclude<DefeatReason, null>;
export type RewardId = WeaponId | 'blades';
export type BossId = 'warden_01' | 'hydra_02' | 'omega_zero';

export interface InputSample {
  /** Relative horizontal delta in world units since previous step (from touch/mouse drag) */
  dragDeltaX: number;
  /** Continuous keyboard axis in [-1, 0, +1] */
  keyAxisX: number;
}

export interface TierBreakdown {
  u1: number; // Value 1 Scout Prisms
  u2: number; // Value 5 Vanguard Wings
  u3: number; // Value 25 Sovereign Cruisers
  totalVisible: number; // u1 + u2 + u3 <= 48
}

export interface GateSnapshot {
  id: number;
  rowId: number;
  x: number;
  z: number;
  halfWidth: number;
  op: GateOp;
  value: number;
  label: string;         // e.g. "+12", "0", "-8", "×2", "÷2"
  polarity: GatePolarity;
  mutable: boolean;      // true = gold target brackets (absorbs shots); false = locked (shots pass through)
  lockHp: number;        // >0 for ÷2 -> ×2 lock-flip gates
  maxLockHp: number;
  chargeRatio: number;   // [0, 1) progress toward next step increment
  triggered: boolean;
  dimmed: boolean;       // true when sibling gate in same row was chosen
  hitPulse: number;      // [0, 1] transient hit bounce timer
  flipPulse: number;     // [0, 1] transient polarity-flip shockwave timer
}

export interface VaultSnapshot {
  id: number;
  x: number;
  z: number;
  halfWidth: number;
  hp: number;
  displayHp: number;     // Math.ceil(Math.max(0, hp))
  maxHp: number;
  rewardWeapon: WeaponId | 'blades';
  broken: boolean;
  hitPulse: number;
}

export interface EnemySnapshot {
  id: number;
  kind: EnemyKind;
  x: number;
  z: number;
  radius: number;
  hp: number;
  maxHp: number;
  slowTimer: number;
  telegraphTimer: number; // >0 while Vector Dasher locks red floor laser before dashing
  linkedGateId: number | null; // For Corruptor Siphon tether beam
  hitPulse: number;
}

export interface BarrelSnapshot {
  id: number;
  x: number;
  z: number;
  radius: number;
  blastRadius: number;   // 4.5 world units
  hp: number;
  displayHp: number;
  detonated: boolean;
  hitPulse: number;
}

export interface PrismLensSnapshot {
  id: number;
  x: number;
  z: number;
  halfWidth: number;
  pulse: number;
}

export interface ProjectileSnapshot {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  weapon: WeaponId;
  amplified: boolean;    // true after refracting through Golden Prism Lens
  powerScale: number;    // visual scale tier from squadCount / weaponLevel
  hostile: boolean;      // true for Boss projectiles
}

export interface BossHazardZone {
  id: number;
  x: number;
  z: number;
  halfWidth: number;
  depth: number;
  warningProgress: number; // 0 -> 1 telegraph fill before strike
  firing: boolean;
}

export interface BossPylonSnapshot {
  id: number;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
}

export interface BossSnapshot {
  active: boolean;
  id: 'warden_01' | 'hydra_02' | 'omega_zero';
  name: string;
  phase: 1 | 2 | 3;
  maxPhases: 2 | 3;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  secondaryCore?: { x: number; z: number; shielded: boolean } | null; // For Hydra-02 split
  shielded: boolean;
  pylons: readonly BossPylonSnapshot[];
  hazardZones: readonly BossHazardZone[];
  hitPulse: number;
  introProgress: number; // [0, 1] Boss arrival transition
}

export type SimEvent =
  | { type: 'SHOOT'; weapon: WeaponId; amplified: boolean }
  | { type: 'ENEMY_HIT'; x: number; z: number; fatal: boolean; kind: EnemyKind }
  | { type: 'GATE_HIT'; gateId: number; x: number; z: number; newValue: number; flippedPositive: boolean }
  | { type: 'GATE_PASS'; gateId: number; x: number; z: number; delta: number; polarity: GatePolarity }
  | { type: 'VAULT_HIT'; x: number; z: number }
  | { type: 'VAULT_BREAK'; x: number; z: number; reward: WeaponId | 'blades'; newWeaponLevel: number }
  | { type: 'BARREL_EXPLODE'; x: number; z: number; radius: number; chainIndex: number; kills: number }
  | { type: 'LENS_REFRACT'; x: number; z: number }
  | { type: 'OVERDRIVE_START'; x: number; z: number }
  | { type: 'SQUAD_LOSS'; x: number; z: number; lost: number; reason: Exclude<DefeatReason, null> }
  | { type: 'BOSS_INTRO'; bossId: BossSnapshot['id']; name: string }
  | { type: 'BOSS_PHASE_BREAK'; phase: 2 | 3; x: number; z: number }
  | { type: 'BOSS_DEFEAT'; x: number; z: number; bossId: BossSnapshot['id'] }
  | { type: 'RUN_VICTORY'; sector: SectorId; finalSquad: number }
  | { type: 'RUN_DEFEAT'; sector: SectorId; reason: Exclude<DefeatReason, null> };

export interface DronePosition {
  x: number;
  z: number;
  tier: 1 | 2 | 3;
}

export interface RunStats {
  kills: number;
  gatesImproved: number;
  vaultsCracked: number;
  maxChain: number;
  peakSquad: number;
}

export interface SimSnapshot {
  phase: GamePhase;
  sector: SectorId;
  simTime: number;
  speedMultiplier: 1 | 2;
  trackHalfWidth: number;      // 5.0
  playerZ: number;             // +6.0
  runwayProgress: number;      // [0, 1] distance to Boss Arena
  squadX: number;
  squadCount: number;          // integer [0, 999]
  formationRadius: number;
  tiers: TierBreakdown;
  dronePositions: ReadonlyArray<{ x: number; z: number; tier: 1 | 2 | 3 }>;
  weapon: WeaponId;
  weaponLevel: 1 | 2 | 3;
  bladesCount: number;         // 0..4 Orbital Bit-Blades
  bladesAngle: number;
  masteryCount: number;
  resonance: number;           // [0, 1] gauge
  overdriveTimer: number;      // >0 while 6s V-Wing Overdrive active
  trueSquadDps: number;
  defeatReason: DefeatReason;
  stats: {
    kills: number;
    gatesImproved: number;
    vaultsCracked: number;
    maxChain: number;
    peakSquad: number;
  };
  gates: readonly GateSnapshot[];
  vaults: readonly VaultSnapshot[];
  enemies: readonly EnemySnapshot[];
  barrels: readonly BarrelSnapshot[];
  lenses: readonly PrismLensSnapshot[];
  projectiles: readonly ProjectileSnapshot[];
  boss: BossSnapshot | null;
}

/** Persistent meta-upgrades applied to a run (workshop). Defaults are neutral (0 / 1 / 1). */
export interface RunModifiers {
  /** Extra drones at run start (integer >= 0). */
  bonusSquad: number;
  /** Multiplier on player projectile damage (>= 1). */
  damageMult: number;
  /** Multiplier on all resonance gains (>= 1). */
  resonanceMult: number;
}

export interface SimulationController {
  /** Starts a sector; `mods` are remembered and reused by retry(). */
  startSector(sector: SectorId, mods?: Partial<RunModifiers>): void;
  pause(): void;
  resume(): void;
  retry(): void;
  returnToTitle(): void;
  setSpeedMultiplier(mult: 1 | 2): void;
  /** Advances accumulator by wallDt * speedMultiplier in FIXED_DT=1/60s steps when PLAYING */
  tickFrame(wallDtSeconds: number, input: InputSample): readonly SimEvent[];
  /** Direct deterministic single fixed-step advance (used by tickFrame & unit tests) */
  stepFixed(input: InputSample): readonly SimEvent[];
  getSnapshot(): SimSnapshot;
}

/**
 * Pure read-only telemetry payload shape for runtime diagnostics (`PROJECT.md` section 5.3).
 */
export interface GameDiagnosticsSnapshot {
  readonly phase: GamePhase;
  readonly sector: SectorId;
  readonly simTime: number;
  readonly speedMultiplier: 1 | 2;
  readonly squadX: number;
  readonly squadCount: number;
  readonly visibleDrones: number;
  readonly tiers: Readonly<TierBreakdown>;
  readonly weapon: WeaponId;
  readonly weaponLevel: 1 | 2 | 3;
  readonly bladesCount: number;
  readonly resonance: number;
  readonly overdriveActive: boolean;
  readonly trueSquadDps: number;
  readonly runwayProgress: number;
  readonly defeatReason: DefeatReason;
  readonly isMuted: boolean;
  readonly activeCounts: {
    readonly gates: number;
    readonly vaults: number;
    readonly enemies: number;
    readonly barrels: number;
    readonly lenses: number;
    readonly projectiles: number;
  };
  readonly gates: readonly GateSnapshot[];
  readonly vaults: readonly VaultSnapshot[];
  readonly enemies: readonly EnemySnapshot[];
  readonly barrels: readonly BarrelSnapshot[];
  readonly boss: BossSnapshot | null;
}
