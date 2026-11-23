import type {
  AbyssalPactId,
  BossId,
  ColorblindMode,
  EnemyKind,
  MutatorId,
  OverclockChipId,
  SectorId,
  SpecializationId,
  SquadSkinId,
  WeaponId,
  WingmanId,
  CustomTrackBlueprint,
  ExpeditionMapState,
} from '../types/game';
import { DEFAULT_KEYBINDS, type KeybindMap } from '../types/game';
import type { UpgradeId } from './meta';

export interface SectorRecord {
  stars: number;
  score: number;
  cleared: boolean;
}

export interface EndlessRecord {
  bestScore: number;
  bestWave: number;
  bestTime: number;
  bestDistance: number;
  bosses: number;
}

export interface BlitzRecord {
  bestScore: number;
  bestTime: number;
  clears: number;
}

export interface PantheonRecord {
  bestScore: number;
  bestTime: number;
  bestStage: number;
  clears: number;
}

export type GhostSample = [number, number, WeaponId];

export interface GhostRunRecord {
  seed: number;
  score: number;
  duration: number;
  samples: GhostSample[];
}

export interface AbyssalSaveState {
  activePacts: AbyssalPactId[];
  maxHeatCleared: number;
  totalAbyssClears: number;
}

export interface AccessibilityConfig {
  colorblindMode: ColorblindMode;
  shakeScale: number;
  flashScale: number;
  aimAssist: boolean;
}

export type CodexKillKey = EnemyKind | BossId;

export interface SaveData {
  version: 1;
  unlocked: SectorId;
  records: Record<SectorId, SectorRecord>;
  endless: EndlessRecord;
  /** Public ranking display name saved after an endless run. */
  leaderboardName: string;
  blitz: BlitzRecord;
  fairTrial: BlitzRecord;
  pantheon: PantheonRecord;
  mutators: MutatorId[];
  muted: boolean;
  seenHints: string[];
  /** workshop currency */
  cores: number;
  upgrades: Record<UpgradeId, number>;
  /** infinite endgame workshop overclock level */
  apexLevel: number;
  /** completed one-time sector challenge ids */
  challenges: string[];
  /** unlocked global achievement ids */
  achievements: string[];
  /** cumulative bestiary & boss kills */
  bestiaryKills: Record<CodexKillKey, number>;
  /** horizontal starter main weapons unlocked in workshop */
  unlockedStarters: WeaponId[];
  /** currently selected starter main weapon */
  starterWeapon: WeaponId;
  /** whether vanguard orbital escort blade is unlocked */
  starterBladeUnlocked: boolean;
  /** whether vanguard orbital escort blade is active */
  starterBlade: boolean;
  /** cosmetic squadron neon trim skin */
  squadSkin: SquadSkinId;
  /** build specialization branches (Lv.0-3) */
  specializations: Record<SpecializationId, number>;
  /** user-customized keyboard bindings */
  keybinds: KeybindMap;
  /** unlocked Tactical Overclock Chips */
  unlockedChips: OverclockChipId[];
  /** up to 3 equipped Tactical Overclock Chips */
  equippedChips: OverclockChipId[];
  /** Holographic Tactical Vox toggle & volume [0..1] */
  voxEnabled: boolean;
  voxVolume: number;
  /** Real-time 60/120Hz frame-time micro-graph HUD toggle */
  showPerfHud: boolean;
  /** AAA Accessibility & Visual Comfort settings */
  accessibility: AccessibilityConfig;
  /** V22 Abyssal Protocol active pacts & highest cleared Heat Tier (0..10) */
  abyssal: AbyssalSaveState;
  unlockedAbyssSkins: SquadSkinId[];
  /** V22 Tactical Drone Wingman unlocks & currently equipped wingman */
  unlockedWingmen: WingmanId[];
  equippedWingman: WingmanId | null;
  /** V22 Personal Best Holographic Ghost trajectory for Fair Trial #202611 */
  fairTrialGhost: GhostRunRecord | null;
  expedition: ExpeditionMapState | null;
  expeditionClears: number;
  savedBlueprint: CustomTrackBlueprint | null;
  showLiveTelemetry: boolean;
}

const KEY = 'prism-swarm-save-v1';
const VALID_CHIPS: readonly OverclockChipId[] = [
  'chip_phase_blink',
  'chip_aegis_nova',
  'chip_prism_split',
  'chip_volatile_core',
  'chip_exec_protocol',
  'chip_magnet_harvester',
];

const KILL_KEYS: readonly CodexKillKey[] = [
  'crawler',
  'dasher',
  'bastion',
  'mitosis',
  'siphon',
  'bomber',
  'phalanx',
  'stalker',
  'brood',
  'howler',
  'glacier',
  'beholder',
  'burrower',
  'necromancer',
  'warden_01',
  'hydra_02',
  'omega_zero',
];

const VALID_MUTATORS: readonly MutatorId[] = ['mirror_twin', 'glass_cannon', 'barrel_carnival'];
const VALID_WEAPONS: readonly WeaponId[] = ['pulse', 'scatter', 'rail', 'plasma', 'cryo'];
const VALID_SKINS: readonly SquadSkinId[] = ['cyan', 'gold', 'crimson', 'emerald', 'abyss_violet', 'solar_prism', 'void_aurora'];
const VALID_PACTS: readonly AbyssalPactId[] = [
  'pact_oscillating_mirrors',
  'pact_volatile_chain',
  'pact_harmonic_aegis',
  'pact_rift_turbulence',
  'pact_apex_mutations',
  'pact_elite_vanguard',
];
const VALID_WINGMEN: readonly WingmanId[] = ['prism_mirror', 'gravity_anchor', 'phase_escort'];

function defaultKills(): Record<CodexKillKey, number> {
  return {
    crawler: 0,
    dasher: 0,
    bastion: 0,
    mitosis: 0,
    siphon: 0,
    bomber: 0,
    phalanx: 0,
    stalker: 0,
    brood: 0,
    howler: 0,
    glacier: 0,
    beholder: 0,
    burrower: 0,
    necromancer: 0,
    warden_01: 0,
    hydra_02: 0,
    omega_zero: 0,
  };
}

function defaults(): SaveData {
  return {
    version: 1,
    unlocked: 1,
    records: {
      1: { stars: 0, score: 0, cleared: false },
      2: { stars: 0, score: 0, cleared: false },
      3: { stars: 0, score: 0, cleared: false },
      4: { stars: 0, score: 0, cleared: false },
    },
    endless: { bestScore: 0, bestWave: 0, bestTime: 0, bestDistance: 0, bosses: 0 },
    leaderboardName: '',
    blitz: { bestScore: 0, bestTime: 0, clears: 0 },
    fairTrial: { bestScore: 0, bestTime: 0, clears: 0 },
    pantheon: { bestScore: 0, bestTime: 0, bestStage: 0, clears: 0 },
    mutators: [],
    muted: false,
    seenHints: [],
    cores: 0,
    upgrades: { squad: 0, power: 0, reso: 0, aegis: 0, crit: 0, bounty: 0 },
    apexLevel: 0,
    challenges: [],
    achievements: [],
    bestiaryKills: defaultKills(),
    unlockedStarters: ['pulse'],
    starterWeapon: 'pulse',
    starterBladeUnlocked: false,
    starterBlade: false,
    squadSkin: 'cyan',
    specializations: { spec_ricochet: 0, spec_vortex: 0, spec_shatter: 0 },
    keybinds: { ...DEFAULT_KEYBINDS },
    unlockedChips: [],
    equippedChips: [],
    voxEnabled: true,
    voxVolume: 0.85,
    showPerfHud: false,
    accessibility: {
      colorblindMode: 'none',
      shakeScale: 1.0,
      flashScale: 1.0,
      aimAssist: false,
    },
    abyssal: { activePacts: [], maxHeatCleared: 0, totalAbyssClears: 0 },
    unlockedAbyssSkins: [],
    unlockedWingmen: [],
    equippedWingman: null,
    fairTrialGhost: null,
    expedition: null,
    expeditionClears: 0,
    savedBlueprint: null,
    showLiveTelemetry: false,
  };
}

function clampLv(v: unknown): number {
  return Math.max(0, Math.min(5, Math.floor(Number(v) || 0)));
}

export function loadSave(): SaveData {
  const base = defaults();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    const unlocked = parsed.unlocked === 2 || parsed.unlocked === 3 || parsed.unlocked === 4 ? parsed.unlocked : 1;
    const records = { ...base.records };
    for (const id of [1, 2, 3, 4] as SectorId[]) {
      const r = parsed.records?.[id];
      if (r) {
        records[id] = {
          stars: Math.max(0, Math.min(3, Math.floor(Number(r.stars) || 0))),
          score: Math.max(0, Math.floor(Number(r.score) || 0)),
          cleared: Boolean(r.cleared),
        };
      }
    }
    const kills = defaultKills();
    for (const k of KILL_KEYS) {
      kills[k] = Math.max(0, Math.floor(Number(parsed.bestiaryKills?.[k]) || 0));
    }
    const mutators = Array.isArray(parsed.mutators)
      ? parsed.mutators.filter((m): m is MutatorId => VALID_MUTATORS.includes(m as MutatorId))
      : [];
    return {
      version: 1,
      unlocked,
      records,
      leaderboardName: typeof parsed.leaderboardName === 'string' ? parsed.leaderboardName.trim().slice(0, 80) : '',
      endless: {
        bestScore: Math.max(0, Math.floor(Number(parsed.endless?.bestScore) || 0)),
        bestWave: Math.max(0, Math.floor(Number(parsed.endless?.bestWave) || 0)),
        bestTime: Math.max(0, Number(parsed.endless?.bestTime) || 0),
        bestDistance: Math.max(0, Math.floor(Number(parsed.endless?.bestDistance) || 0)),
        bosses: Math.max(0, Math.floor(Number(parsed.endless?.bosses) || 0)),
      },
      blitz: {
        bestScore: Math.max(0, Math.floor(Number(parsed.blitz?.bestScore) || 0)),
        bestTime: Math.max(0, Number(parsed.blitz?.bestTime) || 0),
        clears: Math.max(0, Math.floor(Number(parsed.blitz?.clears) || 0)),
      },
      fairTrial: {
        bestScore: Math.max(0, Math.floor(Number(parsed.fairTrial?.bestScore) || 0)),
        bestTime: Math.max(0, Number(parsed.fairTrial?.bestTime) || 0),
        clears: Math.max(0, Math.floor(Number(parsed.fairTrial?.clears) || 0)),
      },
      pantheon: {
        bestScore: Math.max(0, Math.floor(Number(parsed.pantheon?.bestScore) || 0)),
        bestTime: Math.max(0, Number(parsed.pantheon?.bestTime) || 0),
        bestStage: Math.max(0, Math.min(4, Math.floor(Number(parsed.pantheon?.bestStage) || 0))),
        clears: Math.max(0, Math.floor(Number(parsed.pantheon?.clears) || 0)),
      },
      mutators,
      muted: Boolean(parsed.muted),
      seenHints: Array.isArray(parsed.seenHints) ? parsed.seenHints.filter((s) => typeof s === 'string') : [],
      cores: Math.max(0, Math.floor(Number(parsed.cores) || 0)),
      upgrades: {
        squad: clampLv(parsed.upgrades?.squad),
        power: clampLv(parsed.upgrades?.power),
        reso: clampLv(parsed.upgrades?.reso),
        aegis: clampLv(parsed.upgrades?.aegis),
        crit: clampLv(parsed.upgrades?.crit),
        bounty: clampLv(parsed.upgrades?.bounty),
      },
      apexLevel: Math.max(0, Math.floor(Number(parsed.apexLevel) || 0)),
      challenges: Array.isArray(parsed.challenges) ? parsed.challenges.filter((s) => typeof s === 'string') : [],
      achievements: Array.isArray(parsed.achievements) ? parsed.achievements.filter((s) => typeof s === 'string') : [],
      bestiaryKills: kills,
      unlockedStarters: (() => {
        const list = Array.isArray(parsed.unlockedStarters)
          ? parsed.unlockedStarters.filter((w): w is WeaponId => VALID_WEAPONS.includes(w as WeaponId))
          : [];
        return list.includes('pulse') ? list : ['pulse', ...list];
      })(),
      starterWeapon: VALID_WEAPONS.includes(parsed.starterWeapon as WeaponId)
        ? (parsed.starterWeapon as WeaponId)
        : 'pulse',
      starterBladeUnlocked: Boolean(parsed.starterBladeUnlocked),
      starterBlade: Boolean(parsed.starterBlade),
      squadSkin: VALID_SKINS.includes(parsed.squadSkin as SquadSkinId) ? (parsed.squadSkin as SquadSkinId) : 'cyan',
      specializations: {
        spec_ricochet: Math.max(0, Math.min(3, Math.floor(Number(parsed.specializations?.spec_ricochet) || 0))),
        spec_vortex: Math.max(0, Math.min(3, Math.floor(Number(parsed.specializations?.spec_vortex) || 0))),
        spec_shatter: Math.max(0, Math.min(3, Math.floor(Number(parsed.specializations?.spec_shatter) || 0))),
      },
      keybinds: {
        moveLeft: typeof parsed.keybinds?.moveLeft === 'string' && parsed.keybinds.moveLeft ? parsed.keybinds.moveLeft : DEFAULT_KEYBINDS.moveLeft,
        moveRight: typeof parsed.keybinds?.moveRight === 'string' && parsed.keybinds.moveRight ? parsed.keybinds.moveRight : DEFAULT_KEYBINDS.moveRight,
        overdrive: typeof parsed.keybinds?.overdrive === 'string' && parsed.keybinds.overdrive ? parsed.keybinds.overdrive : DEFAULT_KEYBINDS.overdrive,
        aegis: typeof parsed.keybinds?.aegis === 'string' && parsed.keybinds.aegis ? parsed.keybinds.aegis : DEFAULT_KEYBINDS.aegis,
        nuke: typeof parsed.keybinds?.nuke === 'string' && parsed.keybinds.nuke ? parsed.keybinds.nuke : DEFAULT_KEYBINDS.nuke,
        swapWeapon: typeof parsed.keybinds?.swapWeapon === 'string' && parsed.keybinds.swapWeapon ? parsed.keybinds.swapWeapon : DEFAULT_KEYBINDS.swapWeapon,
        wingmanMode: typeof parsed.keybinds?.wingmanMode === 'string' && parsed.keybinds.wingmanMode ? parsed.keybinds.wingmanMode : DEFAULT_KEYBINDS.wingmanMode,
        nirvanaBurst: typeof parsed.keybinds?.nirvanaBurst === 'string' && parsed.keybinds.nirvanaBurst ? parsed.keybinds.nirvanaBurst : DEFAULT_KEYBINDS.nirvanaBurst,
        skyJump: typeof parsed.keybinds?.skyJump === 'string' && parsed.keybinds.skyJump ? parsed.keybinds.skyJump : DEFAULT_KEYBINDS.skyJump,
      },
      unlockedChips: Array.isArray(parsed.unlockedChips)
        ? parsed.unlockedChips.filter((c): c is OverclockChipId => VALID_CHIPS.includes(c as OverclockChipId))
        : [],
      equippedChips: (() => {
        const unlockedSet = new Set(
          Array.isArray(parsed.unlockedChips)
            ? parsed.unlockedChips.filter((c): c is OverclockChipId => VALID_CHIPS.includes(c as OverclockChipId))
            : [],
        );
        return Array.isArray(parsed.equippedChips)
          ? parsed.equippedChips
              .filter((c): c is OverclockChipId => unlockedSet.has(c as OverclockChipId))
              .slice(0, 3)
          : [];
      })(),
      voxEnabled: parsed.voxEnabled === undefined ? true : Boolean(parsed.voxEnabled),
      voxVolume:
        typeof parsed.voxVolume === 'number' && Number.isFinite(parsed.voxVolume)
          ? Math.max(0, Math.min(1, parsed.voxVolume))
          : 0.85,
      showPerfHud: Boolean(parsed.showPerfHud),
      accessibility: {
        colorblindMode:
          parsed.accessibility?.colorblindMode === 'deuteranopia' || parsed.accessibility?.colorblindMode === 'tritanopia'
            ? parsed.accessibility.colorblindMode
            : 'none',
        shakeScale:
          typeof parsed.accessibility?.shakeScale === 'number' && Number.isFinite(parsed.accessibility.shakeScale)
            ? Math.max(0, Math.min(1, parsed.accessibility.shakeScale))
            : 1.0,
        flashScale:
          typeof parsed.accessibility?.flashScale === 'number' && Number.isFinite(parsed.accessibility.flashScale)
            ? Math.max(0, Math.min(1, parsed.accessibility.flashScale))
            : 1.0,
        aimAssist: Boolean(parsed.accessibility?.aimAssist),
      },
      abyssal: {
        activePacts: Array.isArray(parsed.abyssal?.activePacts)
          ? parsed.abyssal!.activePacts.filter((p): p is AbyssalPactId => VALID_PACTS.includes(p as AbyssalPactId))
          : [],
        maxHeatCleared: Math.max(0, Math.min(10, Math.floor(Number(parsed.abyssal?.maxHeatCleared) || 0))),
        totalAbyssClears: Math.max(0, Math.floor(Number(parsed.abyssal?.totalAbyssClears) || 0)),
      },
      unlockedAbyssSkins: Array.isArray(parsed.unlockedAbyssSkins)
        ? parsed.unlockedAbyssSkins.filter((sk): sk is SquadSkinId => VALID_SKINS.includes(sk as SquadSkinId))
        : [],
      unlockedWingmen: Array.isArray(parsed.unlockedWingmen)
        ? parsed.unlockedWingmen.filter((w): w is WingmanId => VALID_WINGMEN.includes(w as WingmanId))
        : [],
      equippedWingman: VALID_WINGMEN.includes(parsed.equippedWingman as WingmanId)
        ? (parsed.equippedWingman as WingmanId)
        : null,
      fairTrialGhost:
        parsed.fairTrialGhost && Array.isArray(parsed.fairTrialGhost.samples)
          ? parsed.fairTrialGhost
          : null,
      expedition: parsed.expedition && Array.isArray(parsed.expedition.clearedNodeIds) ? parsed.expedition : null,
      expeditionClears: Math.max(0, Math.floor(Number(parsed.expeditionClears) || 0)),
      savedBlueprint: parsed.savedBlueprint && Array.isArray(parsed.savedBlueprint.items) ? parsed.savedBlueprint : null,
      showLiveTelemetry: Boolean(parsed.showLiveTelemetry),
    };
  } catch {
    return base;
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable (private mode) — progress stays in memory */
  }
}
