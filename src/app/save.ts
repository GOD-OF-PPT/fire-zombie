import type { BossId, EnemyKind, SectorId } from '../types/game';
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

export type CodexKillKey = EnemyKind | BossId;

export interface SaveData {
  version: 1;
  unlocked: SectorId;
  records: Record<SectorId, SectorRecord>;
  endless: EndlessRecord;
  /** Public ranking display name, entered once on an endless defeat. */
  leaderboardName: string;
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
}

const KEY = 'prism-swarm-save-v1';

const KILL_KEYS: readonly CodexKillKey[] = [
  'crawler',
  'dasher',
  'bastion',
  'mitosis',
  'siphon',
  'warden_01',
  'hydra_02',
  'omega_zero',
];

function defaultKills(): Record<CodexKillKey, number> {
  return {
    crawler: 0,
    dasher: 0,
    bastion: 0,
    mitosis: 0,
    siphon: 0,
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
    muted: false,
    seenHints: [],
    cores: 0,
    upgrades: { squad: 0, power: 0, reso: 0, aegis: 0, crit: 0, bounty: 0 },
    apexLevel: 0,
    challenges: [],
    achievements: [],
    bestiaryKills: defaultKills(),
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
