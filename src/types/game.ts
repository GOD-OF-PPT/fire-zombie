export type GamePhase = 'TITLE' | 'PLAYING' | 'PAUSED' | 'VICTORY' | 'DEFEAT';
export type SectorId = 1 | 2 | 3 | 4;
export type WeaponId = 'pulse' | 'scatter' | 'rail' | 'plasma' | 'cryo';
export type GateOp = 'add' | 'sub' | 'mul' | 'div';
export type GatePolarity = 'positive' | 'negative' | 'neutral';
export type EnemyKind =
  | 'crawler'
  | 'dasher'
  | 'bastion'
  | 'mitosis'
  | 'siphon'
  | 'bomber'
  | 'phalanx'
  | 'stalker'
  | 'brood'
  | 'howler'
  | 'glacier'
  | 'beholder'
  | 'burrower'
  | 'necromancer';

/** 4-Tier Monster Combat Hierarchy: 1=Swarm Minion, 2=Raider, 3=Armored Elite, 4=Super-Armor Juggernaut */
export type EnemyTier = 1 | 2 | 3 | 4;
export type DefeatReason =
  | 'NEGATIVE_GATE'
  | 'DIVISION_GATE'
  | 'ENEMY_BREACH'
  | 'BOSS_ATTACK'
  | null;

export type NonNullDefeatReason = Exclude<DefeatReason, null>;
export type RewardId = WeaponId | 'blades';
export type BossId = 'warden_01' | 'hydra_02' | 'omega_zero';
export type FusionId = 'cryo_singularity' | 'prism_ricochet_web' | 'seeker_sword_array';
export type DualSynergyId =
  | 'cluster_shrapnel'
  | 'frost_shatter_lance'
  | 'thermo_rail_lance'
  | 'overcharge_rail_grid'
  | 'prism_storm_barrage';
export type SquadSkinId =
  | 'cyan'
  | 'gold'
  | 'crimson'
  | 'emerald'
  | 'abyss_violet'
  | 'solar_prism'
  | 'void_aurora';

export type AbyssalPactId =
  | 'pact_oscillating_mirrors'
  | 'pact_volatile_chain'
  | 'pact_harmonic_aegis'
  | 'pact_rift_turbulence'
  | 'pact_apex_mutations'
  | 'pact_elite_vanguard';

export type AbyssalApexMoveKind = 'cross_laser_grid' | 'phantom_clone_salvo' | 'mag_storm_tide';
export type WingmanId = 'prism_mirror' | 'gravity_anchor' | 'phase_escort';
export type WingmanFormation = 'volley_sync' | 'forward_mirror' | 'orbit_guard';

export interface WingmanStateSnapshot {
  id: WingmanId;
  formation: WingmanFormation;
  leftX: number;
  leftY: number;
  leftZ: number;
  rightX: number;
  rightY: number;
  rightZ: number;
}
export type BossPartSlot = 'left' | 'right' | 'reactor';
export type OverlimitResonanceId =
  | 'prism_arc_lattice'
  | 'gravity_lens_well'
  | 'cryo_thermo_shatter'
  | 'photon_prism_fan'
  | 'plasma_overcharge_mortar'
  | 'zero_kelvin_needle'
  | 'hyper_rail_flechette'
  | 'hailstorm_mirror_shatter'
  | 'magma_lance_cataclysm'
  | 'glacial_rail_skewer';
export type OverclockChipId =
  | 'chip_phase_blink'
  | 'chip_aegis_nova'
  | 'chip_prism_split'
  | 'chip_volatile_core'
  | 'chip_exec_protocol'
  | 'chip_magnet_harvester';
export type WeatherKind = 'none' | 'solar_emp' | 'prism_tide' | 'cryo_blizzard';
export type PhaseGateAttune = 'kinetic' | 'energy';
export type SpecializationId = 'spec_ricochet' | 'spec_vortex' | 'spec_shatter';
export type RangePresetId = 'armored' | 'mixed' | 'barrel_bank' | 'boss_dummy' | 'setpieces' | 'verticality';
export type CollapseRiftKind = 'bridge_gap' | 'flank_chasm';
export type FormationKind = 'aegis_refract' | 'pincer_ambush';
export type CoreReactorTier = 0 | 1 | 2 | 3;
export type TacticalEventKind = 'supply_beacon' | 'runaway_cart';
export type ColorblindMode = 'none' | 'deuteranopia' | 'tritanopia';
export type ReplayCameraMode = 'chase' | 'tactical_top' | 'action_closeup';
export type KeybindAction = 'moveLeft' | 'moveRight' | 'overdrive' | 'aegis' | 'nuke' | 'swapWeapon' | 'wingmanMode'
  | 'nirvanaBurst' | 'skyJump';

export interface KeybindMap {
  moveLeft: string;
  moveRight: string;
  overdrive: string;
  aegis: string;
  nuke: string;
  swapWeapon: string;
  wingmanMode: string;
  nirvanaBurst: string;
  skyJump: string;
}

export const DEFAULT_KEYBINDS: KeybindMap = {
  moveLeft: 'a',
  moveRight: 'd',
  overdrive: ' ',
  aegis: 'e',
  nuke: 'q',
  swapWeapon: 'Tab',
  wingmanMode: 'f',
  nirvanaBurst: 'g',
  skyJump: 'w',
};

export interface RangeControlCommand {
  triggerNirvana?: boolean;
  spawnNemesis?: boolean;
  leadWeapon?: WeaponId;
  partnerWeapon?: WeaponId;
  reflectorAngle?: number;
  overlimit?: boolean;
  preset?: RangePresetId;
  respawn?: boolean;
  wingman?: WingmanId;
  wingmanFormation?: WingmanFormation;

}
export type MutatorId = 'mirror_twin' | 'glass_cannon' | 'barrel_carnival';
export type DamageSourceKey = WeaponId | 'blades' | 'fusions' | 'deflect' | 'explosives';

export type PhotoFilterKind = 'neon_raw' | 'noir_gold' | 'glitch_scan';

export type ExpeditionNodeKind = 'prism_lab' | 'black_market' | 'cargo_intercept' | 'abyss_ambush' | 'core_forge';
export type ExpeditionRelicId =
  | 'relic_prism_capacitor'
  | 'relic_hunter_fang'
  | 'relic_nirvana_core'
  | 'relic_nano_reserve';

export interface ExpeditionNodeDef {
  id: string;
  act: 1 | 2 | 3;
  col: number;
  lane: number;
  kind: ExpeditionNodeKind;
  sectorTheme: SectorId;
  nemesisRisk: boolean;
  nextIds: string[];
}

export interface ExpeditionMapState {
  seed: number;
  act: 1 | 2 | 3;
  currentNodeId: string | null;
  clearedNodeIds: string[];
  availableNodeIds: string[];
  carrySquad: number;
  carryWeapon: WeaponId;
  carryPartner: WeaponId;
  relics: ExpeditionRelicId[];
  completed: boolean;
}

export interface NemesisSnapshot {
  id: number;
  name: string;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  adaptedWeapon: WeaponId;
  shieldBroken: boolean;
  dashTelegraph: number;
  hitPulse: number;
}

export type NirvanaArchetype = 'prism_kaleidoscope' | 'singularity_supernova' | 'absolute_zero_storm';

export interface TriPrismLinkSnapshot {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export type CustomTrackItemKind =
  | 'reflector'
  | 'lens'
  | 'mag_rail'
  | 'cap_tower'
  | 'bridge_gap'
  | 'high_spire'
  | 'gate_pair'
  | 'vault'
  | 'enemy_wave';

export interface CustomTrackItem {
  id: number;
  kind: CustomTrackItemKind;
  dist: number;
  x: number;
  angleDeg?: number;
  enemyKind?: EnemyKind;
}

export interface CustomTrackBlueprint {
  title: string;
  sectorTheme: SectorId;
  runwayLength: number;
  bossId: BossId;
  abyssalPacts: AbyssalPactId[];
  forceNemesis: boolean;
  items: CustomTrackItem[];
}

export interface InputSample {
  /** Relative horizontal delta in world units since previous step (from touch/mouse drag) */
  dragDeltaX: number;
  /** Continuous keyboard axis in [-1, 0, +1] */
  keyAxisX: number;
  /** Fire a charged Resonance Overdrive (honoured when the run uses manualOverdrive). */
  overdrive?: boolean;
  /** Trigger active Phase Aegis tactical shock-shield when off cooldown. */
  aegisPulse?: boolean;
  /** Launch the slowly descending Tactical Thermonuclear Warhead screen-clear skill when charged. */
  nukeStrike?: boolean;
  /** Toggle which of the 2 cultivated Main Weapons leads primary salvo ([Tab]/[C] or HUD weapon-chip tap). */
  swapWeapon?: boolean;
  /** Cycle Tactical Drone Wingman formation ([F] / Gamepad L3 / HUD wingman chip). */
  cycleWingman?: boolean;
  /** Fires 2nd-order Overlimit Nirvana Burst [G / LB+RB] */
  nirvanaBurst?: boolean;
  /** Triggers stackable Sky-Vault Orbital Leap [W / ArrowUp / HUD 🚀] */
  skyJump?: boolean;
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
  tier?: EnemyTier;
  x: number;
  z: number;
  radius: number;
  hp: number;
  maxHp: number;
  slowTimer: number;
  telegraphTimer: number; // >0 while Vector Dasher locks red floor laser before dashing
  linkedGateId: number | null; // For Corruptor Siphon tether beam
  hitPulse: number;
  isBountyElite?: boolean;
  shieldImpactX?: number;
  shieldRatio?: number;   // >0 while Aegis Phalanx directional energy shield is active
  frenzyBuffed?: boolean; // true while inside a Frenzy Howler war-aura
  armorBroken?: boolean;  // true once Tier-3/4 elite drops <= 50% HP and sheds outer armor
  formationId?: number;
  formationKind?: FormationKind;
  isFormationLeader?: boolean;
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
  overheat?: number;
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

export interface BossPartSnapshot {
  id: number;
  slot: BossPartSlot;
  label: string;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  hitPulse: number;
  telegraph?: number;
  destroyed: boolean;
}

export interface DoomOrbSnapshot {
  id: number;
  x: number;
  z: number;
  radius: number;
  value: number;
  chargeRatio: number;
  reflected: boolean;
  hitPulse: number;
}

export interface SingularitySnapshot {
  id: number;
  x: number;
  z: number;
  radius: number;
  timer: number;
}

export interface JumpPadSnapshot {
  id: number;
  x: number;
  z: number;
  triggered: boolean;
}

export interface ReflectorSnapshot {
  id: number;
  x: number;
  z: number;
  lean: 1 | -1;
  angleDeg?: number;
  pulse: number;
  isWingmanMirror?: boolean;
}

export interface ContractWallSnapshot {
  id: number;
  zFront: number;
  zBack: number;
  bountySide: 'left' | 'right';
}

export interface SkyCargoSnapshot {
  id: number;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  state: 'hanging' | 'falling' | 'slammed';
  hitPulse: number;
}

export interface MaglevTrainSnapshot {
  id: number;
  z: number;
  dir: 1 | -1;
  trainX: number;
  state: 'warning' | 'crossing';
  warningProgress: number;
}

export interface MagRailSnapshot {
  id: number;
  x: number;
  z: number;
  length: number;
  halfWidth: number;
  polarity: 1 | -1;
}

export interface CapacitorTowerSnapshot {
  id: number;
  x: number;
  z: number;
  charge: number;
  maxCharge: number;
  hitPulse: number;
}

export interface PhaseGateSnapshot {
  id: number;
  x: number;
  z: number;
  halfWidth: number;
  attune: PhaseGateAttune;
}

export interface CoreShardSnapshot {
  id: number;
  x: number;
  z: number;
  value: number;
}

export interface CollapseRiftSnapshot {
  id: number;
  kind: CollapseRiftKind;
  x: number;
  z: number;
  length: number;
  halfWidth: number;
}

export interface HighSpireSnapshot {
  id: number;
  x: number;
  z: number;
  elevationY: number;
  hp: number;
  maxHp: number;
  shieldRatio: number;
  chargeProgress: number;
  hitPulse: number;
}

export interface TacticalEventSnapshot {
  id: number;
  kind: TacticalEventKind;
  x: number;
  z: number;
  radius: number;
  hp: number;
  maxHp: number;
  captureProgress: number;
  timer: number;
  hitPulse: number;
}

export interface PantheonCoBossSnapshot {
  active: boolean;
  shielded: boolean;
  id: BossId;
  name: string;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  hitPulse: number;
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
  titanRank?: number;    // 1..10 dynamic ascension rank scaled to player power
  titanScale?: number;   // 1.0..1.52 colossal size multiplier on top of giant base rig
  hpBars?: number;       // 1..14 multi-layered arcade boss HP bar count
  secondaryCore?: { x: number; z: number; shielded: boolean } | null; // For Hydra-02 split
  shielded: boolean;
  pylons: readonly BossPylonSnapshot[];
  parts?: readonly BossPartSnapshot[];
  breakTimer?: number;
  hazardZones: readonly BossHazardZone[];
  hitPulse: number;
  introProgress: number; // [0, 1] Boss arrival transition
  enrage?: number; // >1 once the fight overruns: attacks come faster
  omegaOverdrive?: boolean;
  omegaBeamState?: 'idle' | 'charging' | 'firing';
  omegaBeamX?: number;
  omegaBeamProgress?: number;
  omegaExecuted?: boolean;
  harmonicShield?: boolean;
  apexMoveKind?: AbyssalApexMoveKind | null;
  abyssalMutation?: AbyssalApexMoveKind | null;
  apexMoveTimer?: number;
  apexSafeX?: number;
}

export type SimEvent =
  | { type: 'SHOOT'; weapon: WeaponId; amplified: boolean; auxiliary?: boolean }
  | { type: 'ENEMY_HIT'; x: number; z: number; fatal: boolean; kind: EnemyKind; damage?: number; weapon?: WeaponId; hpRatio?: number }
  | { type: 'BOMBER_BLAST'; x: number; z: number; kills: number }
  | { type: 'SHIELD_BREAK'; enemyId: number; x: number; z: number; reflected?: boolean }
  | { type: 'CUTBACK_COMPLETE'; x: number; z: number }
  | { type: 'ENEMY_ARMOR_BREAK'; kind: EnemyKind; x: number; z: number }
  | { type: 'SKY_CARGO_SPAWN'; x: number; z: number }
  | { type: 'SKY_CARGO_DROP'; x: number; z: number }
  | { type: 'SKY_CARGO_SLAM'; x: number; z: number; kills: number }
  | { type: 'MAGLEV_WARN'; z: number; dir: 1 | -1 }
  | { type: 'MAGLEV_SWEEP'; z: number; dir: 1 | -1; kills: number }
  | { type: 'PHASE_BLINK'; fromX: number; toX: number; z: number }
  | { type: 'BROOD_SPAWN'; x: number; z: number; count: number }
  | { type: 'HOWLER_PURGE'; x: number; z: number; stunned: number }
  | { type: 'GLACIER_NOVA'; x: number; z: number; chilled: number }
  | { type: 'WATCHER_SHOT'; x: number; z: number }
  | { type: 'BURROW_ERUPT'; x: number; z: number }
  | { type: 'NECRO_HEAL'; x: number; z: number; healed: number }
  | { type: 'BOSS_HIT'; x: number; z: number; damage: number; weapon?: WeaponId }
  | { type: 'CHAIN_ARC'; fromX: number; fromZ: number; toX: number; toZ: number; damage: number; webColor?: number }
  | { type: 'GATE_STREAK'; x: number; z: number; streak: number; bonus: number }
  | { type: 'SWARM_SURGE'; tier: number; mult: number; count: number }
  | { type: 'FUSION_UNLOCK'; fusionId: FusionId }
  | { type: 'SINGULARITY_SPAWN'; x: number; z: number; radius: number }
  | { type: 'JUMP_LAUNCH'; x: number; z: number; skillStage?: number; remainingStocks?: number; peakY?: number }
  | { type: 'JUMP_SLAM'; x: number; z: number; hits: number; skillStage?: number; radius?: number; bossDamage?: number }
  | { type: 'REFLECTOR_BOUNCE'; x: number; z: number }
  | { type: 'BOUNTY_JACKPOT'; x: number; z: number; squadGain: number; weapon: WeaponId; newLevel: number }
  | { type: 'BOSS_PART_BREAK'; slot: BossPartSlot; label: string; effectDesc?: string; x: number; z: number }
  | { type: 'OVERLIMIT_UNLOCK'; resonanceId: OverlimitResonanceId }
  | { type: 'DUAL_SYNERGY_UNLOCK'; synergyId: DualSynergyId }
  | { type: 'DOOM_ORB_SPAWN'; x: number; z: number; value: number }
  | { type: 'DOOM_ORB_REFLECT'; x: number; z: number }
  | { type: 'DOOM_ORB_SLAM'; x: number; z: number; damage: number }
  | { type: 'CRIT_HIT'; x: number; z: number; damage: number }
  | { type: 'GATE_HIT'; gateId: number; x: number; z: number; newValue: number; flippedPositive: boolean }
  | { type: 'GATE_PASS'; gateId: number; x: number; z: number; delta: number; polarity: GatePolarity }
  | { type: 'VAULT_HIT'; x: number; z: number }
  | { type: 'VAULT_BREAK'; x: number; z: number; reward: WeaponId | 'blades'; newWeaponLevel: number }
  | { type: 'BARREL_EXPLODE'; x: number; z: number; radius: number; chainIndex: number; kills: number; amplified?: boolean }
  | { type: 'LENS_REFRACT'; x: number; z: number }
  | { type: 'OVERDRIVE_START'; x: number; z: number; overdriveBreakSync?: boolean }
  | { type: 'WEAPON_SWAP'; weapon: WeaponId; level: number }
  | { type: 'AFK_LOCK_STRIKE'; x: number; z: number }
  | { type: 'AEGIS_PULSE'; x: number; z: number; orbsCleared: number; enemiesRepelled: number; autoTriggered?: boolean }
  | { type: 'AEGIS_PARRY'; x: number; z: number; blocked: number }
  | { type: 'VAULT_SALVAGE'; x: number; z: number; upgradedWeapon: WeaponId; newLevel: number; reserveGain: number }
  | { type: 'TRI_FUSION_CLIMAX'; duration: number }
  | { type: 'RESERVE_DEPLOY'; count: number }
  | { type: 'NUKE_LAUNCH'; x: number; z: number; duration: number; salvoIndex?: number; remainingStocks?: number }
  | { type: 'NUKE_DETONATE'; x: number; z: number; kills: number; bossDamage: number; salvoIndex?: number }
  | { type: 'SQUAD_LOSS'; x: number; z: number; lost: number; reason: Exclude<DefeatReason, null> }
  | { type: 'BOSS_INTRO'; bossId: BossSnapshot['id']; name: string; titanRank?: number }
  | { type: 'BOSS_PHASE_BREAK'; phase: 2 | 3; x: number; z: number; arenaShift?: string }
  | { type: 'BOSS_OMEGA_OVERDRIVE'; bossId: BossId; weather: WeatherKind; x: number; z: number }
  | { type: 'OMEGA_BEAM_CHARGE'; x: number; z: number }
  | { type: 'OMEGA_EXECUTION'; bossId: BossId; trigger: 'mirror_focus' | 'aegis_parry'; damage: number; kills: number; x: number; z: number }
  | { type: 'MAG_RAIL_BOOST'; x: number; z: number; polarity: 1 | -1 }
  | { type: 'CAPACITOR_DISCHARGE'; x: number; z: number; kills: number; damage: number }
  | { type: 'PHASE_GATE_SYNC'; x: number; z: number; attune: PhaseGateAttune; synced: boolean }
  | { type: 'SHARD_COLLECT'; x: number; z: number; value: number; total: number }
  | { type: 'SPIRE_CHARGE'; x: number; z: number; y: number }
  | { type: 'SPIRE_SHATTER'; x: number; z: number; elevated: boolean }
  | { type: 'RIFT_LEAP_BONUS'; x: number; z: number; kind: CollapseRiftKind; bonusSquad: number }
  | { type: 'FORMATION_DEPLOY'; kind: FormationKind; x: number; z: number }
  | { type: 'FORMATION_BACKLASH'; x: number; z: number; stunned: number; kind: FormationKind }
  | { type: 'PANTHEON_STAGE_START'; stage: 1 | 2 | 3 | 4; affixName: string; bonusSquad: number }
  | { type: 'PANTHEON_DUAL_BOSS'; primaryId: BossId; coBossId: BossId }
  | { type: 'CORE_REACTOR_AWAKEN'; tier: CoreReactorTier }
  | { type: 'REACTOR_PULSE_WALL'; x: number; z: number; hits: number; source: 'overdrive' | 'aegis' }
  | { type: 'TACTICAL_DROP_SPAWN'; kind: TacticalEventKind; x: number; z: number }
  | { type: 'TACTICAL_DROP_CLAIM'; kind: TacticalEventKind; x: number; z: number; newReactorTier: CoreReactorTier; rewardText?: string }
  | { type: 'WINGMAN_FORMATION_SHIFT'; wingman: WingmanId; formation: WingmanFormation }
  | { type: 'WINGMAN_COUNTER_BEAM'; fromX: number; fromZ: number; toX: number; toZ: number; damage: number }
  | { type: 'ABYSSAL_BOSS_MUTATION'; bossId: BossId; moveKind: AbyssalApexMoveKind; safeX: number; heatTier: number }
  | { type: 'NEMESIS_AMBUSH'; name: string; adaptedWeapon: WeaponId; x: number; z: number }
  | { type: 'NEMESIS_SHIELD_BREAK'; x: number; z: number; newWeakness: WeaponId }
  | { type: 'NEMESIS_DEFEAT'; x: number; z: number; relicId: ExpeditionRelicId; bonusSquad: number }
  | { type: 'TRI_PRISM_LATTICE_ONLINE'; x: number; z: number; duration: number }
  | { type: 'OVERLIMIT_NIRVANA_BURST'; archetype: NirvanaArchetype; kills: number; bossDamage: number; x: number; z: number }
  | { type: 'NIRVANA_WAVE_PULSE'; archetype: NirvanaArchetype; wave: 1 | 2; kills: number; bossDamage: number; x: number; z: number }
  | { type: 'BOSS_DEFEAT'; x: number; z: number; bossId: BossSnapshot['id'] }
  | { type: 'ENDLESS_STAGE_START'; wave: number; bosses: number; bonus: number }
  | { type: 'RUN_VICTORY'; sector: SectorId; finalSquad: number }
  | { type: 'RUN_DEFEAT'; sector: SectorId; reason: Exclude<DefeatReason, null> };

export interface NukeStrikeSnapshot {
  id: number;
  x: number;
  z: number;
  dropTimer: number;
  dropDuration: number;
  blastTimer: number;
  blastDuration: number;
  salvoIndex: number;
}

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

export type EndlessUpgradeId = 'power' | 'recruits' | 'resonance' | 'weapon' | 'blades' | 'supply';

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
  arsenal: Readonly<Record<WeaponId, 0 | 1 | 2 | 3>>;
  overclockStacks: number;     // Extra vault upgrades beyond Lv.3
  rampageStacks: number;       // Live kill-streak attack-speed & lightning stacks
  gateStreak: number;          // Consecutive positive gates crossed
  bladesCount: number;         // 0..4 Orbital Bit-Blades
  bladesAngle: number;
  masteryCount: number;
  resonance: number;           // [0, 1] gauge
  overdriveTimer: number;      // >0 while 6s V-Wing Overdrive active
  aegisTimer: number;          // >0 while Phase Aegis force-dome active
  aegisCooldown: number;       // >0 remaining cooldown seconds
  aegisMaxCooldown: number;    // max cooldown seconds for UI ring
  nukeCharge: number;          // [0, 1] Tactical Nuke recharge progress toward next warhead
  nukeStocks?: number;         // Ready warhead stocks in orbital magazine (0..nukeMaxStocks)
  nukeMaxStocks?: number;      // Max stocked warheads (default 3)
  nukeSalvoChain?: number;     // Consecutive rapid-tap salvo chain index
  nukeStrikes?: readonly NukeStrikeSnapshot[]; // Active concurrent orbital warheads & mushroom clouds
  nukeDropTimer: number;       // >0 while 3D Tactical Nuclear Warhead descends
  nukeDropDuration: number;    // 1.15s total descent duration
  nukeBlastTimer: number;      // >0 while 3D thermonuclear mushroom cloud & shockwave active
  nukeTargetX: number;
  nukeTargetZ: number;
  trueSquadDps: number;
  effectiveSquadDps?: number;  // Exact authoritative total DPS including active co-firing, rampage & mutators
  activeLoadout?: readonly WeaponId[]; // Up to 2 specialized main weapons actively cultivated this run
  activeDualSynergy?: DualSynergyId | null;
  overlimitResonance?: OverlimitResonanceId | null;
  isFiringRange?: boolean;
  fairTrial?: boolean;
  rangeRealizedDps?: number;
  rangeCounterMult?: number;
  rangeReflectorAngle?: number;
  rangePreset?: RangePresetId;
  pendingSwapWeapon?: WeaponId | null;
  reserveTroops?: number;      // Overflow soldiers above 999 stored as automatic frontline reinforcements
  triFusionTimer?: number;     // >0 during 12s Ultimate All-3-Fusions Climax burst
  swarmMult: number;           // [1.0, 16.0] live power-driven monster tide multiplier
  swarmTier: number;           // 1..6 dynamic swarm escalation tier
  defeatReason: DefeatReason;
  stats: {
    kills: number;
    gatesImproved: number;
    vaultsCracked: number;
    maxChain: number;
    peakSquad: number;
  };
  squadAirY: number;
  jumpTimeLeft: number;
  jumpDuration?: number;
  jumpStocks?: number;
  jumpMaxStocks?: number;
  jumpCharge?: number;
  jumpSkillStage?: number;
  inBlitzDrill: boolean;
  runwaySpeed: number;
  drillCue?: { action: 'mirror' | 'vault' | 'switch' | 'pad'; x: number };
  mirrorTwinActive: boolean;
  blitzActive: boolean;
  activeFusions: readonly FusionId[];
  mutators: readonly MutatorId[];
  seekerPositions: ReadonlyArray<{ x: number; z: number; hunting: boolean }>;
  damageBySource: Readonly<Record<DamageSourceKey, number>>;
  singularities: readonly SingularitySnapshot[];
  jumpPads: readonly JumpPadSnapshot[];
  reflectors: readonly ReflectorSnapshot[];
  contractWalls: readonly ContractWallSnapshot[];
  doomOrbs: readonly DoomOrbSnapshot[];
  skyCargos?: readonly SkyCargoSnapshot[];
  maglevTrains?: readonly MaglevTrainSnapshot[];
  magRails?: readonly MagRailSnapshot[];
  capTowers?: readonly CapacitorTowerSnapshot[];
  phaseGates?: readonly PhaseGateSnapshot[];
  coreShards?: readonly CoreShardSnapshot[];
  weatherState?: WeatherKind;
  magBoostTimer?: number;
  phaseSyncTimer?: number;
  collectedShards?: number;
  collapseRifts?: readonly CollapseRiftSnapshot[];
  highSpires?: readonly HighSpireSnapshot[];
  tacticalEvents?: readonly TacticalEventSnapshot[];
  coreReactorTier?: CoreReactorTier;
  reactorPrismRingTimer?: number;
  reactorWallZ?: number | null;
  pantheonActive?: boolean;
  pantheonStage?: 1 | 2 | 3 | 4;
  pantheonAffixName?: string;
  pantheonCoBoss?: PantheonCoBossSnapshot | null;
  abyssalHeat?: number;
  abyssalHeatTier?: number;
  abyssalPacts?: readonly AbyssalPactId[];
  wingmanState?: WingmanStateSnapshot | null;
  nemesis?: NemesisSnapshot | null;
  nirvanaCharge?: number;
  nirvanaActiveTimer?: number;
  nirvanaArchetype?: NirvanaArchetype | null;
  triPrismLatticeTimer?: number;
  triPrismLinks?: readonly TriPrismLinkSnapshot[];
  refractionDmgTotal?: number;
  latticeDmgTotal?: number;
  nirvanaDmgTotal?: number;
  expeditionActive?: boolean;
  expeditionAct?: 1 | 2 | 3;
  customTrackTitle?: string | null;
  gates: readonly GateSnapshot[];
  vaults: readonly VaultSnapshot[];
  enemies: readonly EnemySnapshot[];
  barrels: readonly BarrelSnapshot[];
  lenses: readonly PrismLensSnapshot[];
  projectiles: readonly ProjectileSnapshot[];
  boss: BossSnapshot | null;
  /** Present only in endless mode: the current loop and cumulative run progress. */
  endless?: {
    wave: number;
    bosses: number;
    distance: number;
    upgrades: Partial<Record<EndlessUpgradeId, number>>;
    offers: readonly EndlessUpgradeId[];
  };
}

/** Persistent meta-upgrades applied to a run (workshop). Defaults are neutral (0 / 1 / 1). */
export interface RunModifiers {
  expeditionNode?: ExpeditionNodeDef;
  expeditionNodeKind?: ExpeditionNodeKind;
  expeditionRelics?: readonly ExpeditionRelicId[];
  forceNemesisAmbush?: boolean;
  customBlueprint?: CustomTrackBlueprint;
  customTrackProps?: Array<{ kind: CustomTrackItemKind; dist: number; x: number; angleDeg?: number; spawned?: boolean }>;
  /** Extra drones at run start (integer >= 0). */
  bonusSquad: number;
  /** Multiplier on player projectile damage (>= 1). */
  damageMult: number;
  /** Multiplier on all resonance gains (>= 1). */
  resonanceMult: number;
  /** A full gauge waits for an explicit `InputSample.overdrive` request instead of firing at once. */
  manualOverdrive?: boolean;
  /** Seed for mirroring whole encounter segments; 0 / absent = authored layout. */
  layoutSeed?: number;
  /** Multiplier on boss and pylon HP (>= 1). */
  bossHpMult?: number;
  /** Loop generated stages forever; boss kills advance the wave instead of ending the run. */
  endless?: boolean;
  /** Wait for a between-stage protocol choice; headless simulations may leave this disabled. */
  manualEndlessDraft?: boolean;
  /** Cooldown seconds of Phase Aegis tactical pulse (default 14). */
  aegisCooldownSec?: number;
  /** Active shield duration seconds of Phase Aegis (default 1.25). */
  aegisDurationSec?: number;
  /** Emergency auto-trigger Phase Aegis charges per run (default 0). */
  autoAegisCharges?: number;
  /** Critical strike probability in [0, 0.75] (default 0). */
  critChance?: number;
  /** 90-second Blitz Mode ("极速闪击模式"). */
  blitz?: boolean;
  /** Active combat mutators (mirror_twin, glass_cannon, barrel_carnival). */
  mutators?: readonly MutatorId[];
  /** Pure-skill Fair Seeded Trial: disables all Workshop/Apex modifiers. */
  fairTrial?: boolean;
  /** Workshop Horizontal Starter Modules (disabled in Fair Trial). */
  starterWeapon?: WeaponId;
  starterBlade?: boolean;
  /** Workshop Build Specialization Branches Lv.0-3 (disabled in Fair Trial). */
  specRicochet?: number;
  specVortex?: number;
  specShatter?: number;
  /** Up to 3 Tactical Overclock Chips equipped pre-run (disabled in Fair Trial). */
  equippedChips?: readonly OverclockChipId[];
  /** Boots Holographic Tactical Firing Range sandbox mode. */
  firingRange?: boolean;
  /** Boots 4-Stage Boss Rush Pantheon ("棱镜万神殿") endgame gauntlet. */
  pantheon?: boolean;
  /** Accessibility soft reticle snap toward priority targets (disabled in Fair Trial). */
  aimAssist?: boolean;
  /** V22 Abyssal Protocol Heat Pact list (Heat Tier 1–10, disabled in Fair Trial). */
  abyssalPacts?: readonly AbyssalPactId[];
  /** V22 Equipped Tactical Drone Wingman (disabled in Fair Trial). */
  wingmanId?: WingmanId | null;
  equippedWingman?: WingmanId | null;
  /** Initial Wingman Formation. */
  wingmanFormation?: WingmanFormation;
}

export interface SimulationController {
  /** Starts a sector; `mods` are remembered and reused by retry(). */
  startSector(sector: SectorId, mods?: Partial<RunModifiers>): void;
  pause(): void;
  resume(): void;
  chooseEndlessUpgrade(id: EndlessUpgradeId): boolean;
  retry(): void;
  returnToTitle(): void;
  setSpeedMultiplier(mult: 1 | 2): void;
  /** Advances accumulator by wallDt * speedMultiplier in FIXED_DT=1/60s steps when PLAYING */
  tickFrame(wallDtSeconds: number, input: InputSample): readonly SimEvent[];
  /** Direct deterministic single fixed-step advance (used by tickFrame & unit tests) */
  stepFixed(input: InputSample): readonly SimEvent[];
  configureRange(cmd: RangeControlCommand): void;
  exportReplayLog(): import('../sim/replay').DeterministicReplayLog;
  seekReplayTick(log: import('../sim/replay').DeterministicReplayLog, targetTick: number): import('../sim/replay').ReplayPlayer;
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
