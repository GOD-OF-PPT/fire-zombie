/** Public browser configuration; no administrator or backend key belongs here. */
export const LEADERBOARD = {
  baseUrl: 'https://ranking-api-production-a8ed42bc.up.railway.app',
  game: 'fire-zombie',
  board: 'endless-score',
  pageSize: 20,
} as const;

export interface RankingEntry {
  rank: number;
  playerId: string;
  username: string;
  metrics: Record<string, number>;
  info: Record<string, unknown>;
  achievedAt: string;
}

export interface RankingPage {
  entries: RankingEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface EndlessRunScore {
  score: number;
  duration: number;
  wave: number;
  distance: number;
  bosses: number;
  kills: number;
  maxCombo: number;
}

export interface SubmitResult { accepted: boolean; playerId: string; message: string }
interface Identity { playerId: string; token: string; expiresAt: number }
interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

export class RankingError extends Error {
  constructor(public readonly code: string, public readonly status?: number) {
    super(code);
    this.name = 'RankingError';
  }
}

export function validateRankingName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name)) throw new RankingError('INVALID_NAME');
  return name;
}

export function rankingErrorMessage(error: unknown): string {
  const code = error instanceof RankingError ? error.code : '';
  if (code === 'INVALID_NAME') return '请输入 1–80 个字符的姓名或昵称';
  if (code === 'GAME_NOT_FOUND' || code === 'BOARD_NOT_FOUND' || code === 'GUEST_DISABLED') return '排行榜尚未开放，请稍后再试';
  if (code === 'UNAUTHORIZED' || (error instanceof RankingError && error.status === 401)) return '排行榜身份暂不可用，请稍后重试';
  if (error instanceof RankingError && error.status === 429) return '操作太频繁，请稍后再试';
  if (code === 'INVALID_SCORE' || code === 'VALIDATION_ERROR' || code === 'MISSING_METRIC') return '本局成绩格式异常，暂时无法上榜';
  if (code === 'TIMEOUT') return '排行榜连接超时，请重试';
  return '网络暂不可用，请稍后重试';
}

function defaultStorage(): StorageLike | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function isIdentity(value: unknown): value is Identity {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<Identity>;
  return typeof v.playerId === 'string' && !!v.playerId && typeof v.token === 'string' && !!v.token &&
    typeof v.expiresAt === 'number' && Number.isFinite(v.expiresAt);
}

function isEntry(value: unknown): value is RankingEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<RankingEntry>;
  return typeof v.rank === 'number' && Number.isFinite(v.rank) && v.rank >= 1 &&
    typeof v.playerId === 'string' && typeof v.username === 'string' && !!v.metrics &&
    ['score', 'wave', 'distance'].every(field => typeof v.metrics![field] === 'number' && Number.isFinite(v.metrics![field]));
}

/** One client per game page, following the deployed v1 SDK's identity/storage contract. */
export class LeaderboardClient {
  private identity: Identity | null = null;
  private pendingSession: Promise<Identity> | null = null;
  private readonly storage: StorageLike | null;
  private readonly storageKey: string;
  private readonly baseUrl: string;
  private readonly game: string;
  private readonly board: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: { baseUrl?: string; game?: string; board?: string; storage?: StorageLike | null; timeoutMs?: number; fetcher?: typeof fetch } = {}) {
    this.baseUrl = (options.baseUrl ?? LEADERBOARD.baseUrl).replace(/\/$/, '');
    this.game = options.game ?? LEADERBOARD.game;
    this.board = options.board ?? LEADERBOARD.board;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.fetcher = options.fetcher ?? ((...args) => fetch(...args));
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.storageKey = `ranking:v1:${this.baseUrl}:${this.game}`;
    try {
      const parsed: unknown = JSON.parse(this.storage?.getItem(this.storageKey) ?? 'null');
      if (isIdentity(parsed)) this.identity = parsed;
    } catch { /* A blocked or damaged local store must not prevent play. */ }
  }

  private async request<T>(path: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}/api/v1/games/${encodeURIComponent(this.game)}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
      let data: unknown;
      try { data = await response.json(); } catch { throw new RankingError('INVALID_RESPONSE', response.status); }
      if (!response.ok) {
        const code = data && typeof data === 'object' && 'code' in data ? String(data.code) : 'HTTP_ERROR';
        throw new RankingError(code, response.status);
      }
      return data as T;
    } catch (error) {
      if (controller.signal.aborted) throw new RankingError('TIMEOUT');
      if (error instanceof RankingError) throw error;
      throw new RankingError('NETWORK');
    } finally { clearTimeout(timer); }
  }

  private async session(): Promise<Identity> {
    if (this.identity && this.identity.expiresAt > Date.now() / 1000 + 60) return this.identity;
    if (!this.pendingSession) {
      this.pendingSession = this.request<unknown>('/sessions', { method: 'POST' }).then((data) => {
        if (!isIdentity(data)) throw new RankingError('INVALID_RESPONSE');
        this.identity = data;
        try { this.storage?.setItem(this.storageKey, JSON.stringify(data)); } catch { /* memory fallback */ }
        return data;
      }).finally(() => { this.pendingSession = null; });
    }
    return this.pendingSession;
  }

  async submit(username: string, run: Readonly<EndlessRunScore>): Promise<SubmitResult> {
    const name = validateRankingName(username);
    if (Object.values(run).some(n => !Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) || run.wave < 1) {
      throw new RankingError('INVALID_SCORE');
    }
    const { token } = await this.session();
    const result = await this.request<SubmitResult>(`/boards/${encodeURIComponent(this.board)}/scores`, {
      method: 'POST', token,
      body: {
        username: name,
        metrics: { score: Math.floor(run.score), wave: Math.floor(run.wave), distance: Math.round(run.distance * 1000) / 1000, duration: Math.round(run.duration * 1000) / 1000 },
        info: { mode: 'endless', bosses: run.bosses, kills: run.kills, maxCombo: run.maxCombo },
      },
    });
    if (typeof result.accepted !== 'boolean') throw new RankingError('INVALID_RESPONSE');
    return result;
  }

  async top(offset = 0): Promise<RankingPage> {
    const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.min(10000, Math.floor(offset))) : 0;
    const page = await this.request<RankingPage>(`/boards/${encodeURIComponent(this.board)}?limit=${LEADERBOARD.pageSize}&offset=${safeOffset}`);
    if (!Array.isArray(page.entries) || !page.entries.every(isEntry) || !Number.isFinite(page.total) || page.total < 0 ||
      !Number.isInteger(page.offset) || page.offset < 0 || !Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100) throw new RankingError('INVALID_RESPONSE');
    return page;
  }

  async me(): Promise<RankingEntry | null> {
    const { token, playerId } = await this.session();
    try {
      const data = await this.request<{ entry: RankingEntry }>(`/boards/${encodeURIComponent(this.board)}/players/${encodeURIComponent(playerId)}`, { token });
      if (!isEntry(data.entry)) throw new RankingError('INVALID_RESPONSE');
      return data.entry;
    } catch (error) {
      if (error instanceof RankingError && error.code === 'PLAYER_NOT_RANKED') return null;
      throw error;
    }
  }
}
