import type { SectorId } from '../types/game';
import type { UpgradeId } from './meta';

export interface SectorRecord {
  stars: number;
  score: number;
  cleared: boolean;
}

export interface SaveData {
  version: 1;
  unlocked: SectorId;
  records: Record<SectorId, SectorRecord>;
  muted: boolean;
  seenHints: string[];
  /** workshop currency */
  cores: number;
  upgrades: Record<UpgradeId, number>;
  /** completed one-time sector challenge ids */
  challenges: string[];
}

const KEY = 'prism-swarm-save-v1';

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
    muted: false,
    seenHints: [],
    cores: 0,
    upgrades: { squad: 0, power: 0, reso: 0 },
    challenges: [],
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
    return {
      version: 1,
      unlocked,
      records,
      muted: Boolean(parsed.muted),
      seenHints: Array.isArray(parsed.seenHints) ? parsed.seenHints.filter((s) => typeof s === 'string') : [],
      cores: Math.max(0, Math.floor(Number(parsed.cores) || 0)),
      upgrades: {
        squad: clampLv(parsed.upgrades?.squad),
        power: clampLv(parsed.upgrades?.power),
        reso: clampLv(parsed.upgrades?.reso),
      },
      challenges: Array.isArray(parsed.challenges) ? parsed.challenges.filter((s) => typeof s === 'string') : [],
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
