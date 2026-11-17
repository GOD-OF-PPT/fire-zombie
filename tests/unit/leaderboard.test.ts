import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeaderboardClient, LEADERBOARD, RankingError, validateRankingName, type EndlessRunScore } from '../../src/services/leaderboard';
import { loadSave, writeSave } from '../../src/app/save';

const run: EndlessRunScore = { score: 1200, duration: 65.12345, wave: 2, distance: 980.1256, bosses: 1, kills: 40, maxCombo: 12 };
const identity = () => ({ playerId: 'guest_test-player', token: 'test-player-token', expiresAt: Date.now() / 1000 + 3600 });
const entry = { rank: 7, playerId: 'guest_test-player', username: '测试玩家', metrics: { score: 1200, wave: 2, distance: 980.126 }, info: {}, achievedAt: '2026-11-17T08:00:00.000Z' };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const key = `ranking:v1:${LEADERBOARD.baseUrl}:${LEADERBOARD.game}`;
function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, value: string) => { map.set(k, value); } };
}
function transport() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/sessions')) return json(identity(), 201);
    if (url.endsWith('/scores')) return json({ accepted: true, playerId: entry.playerId, message: '成绩已记录' });
    if (url.includes('/players/')) return json({ entry });
    return json({ entries: [entry], total: 1, limit: 20, offset: 0 });
  });
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('endless leaderboard protocol', () => {
  it('validates and trims a public name without treating it as HTML', () => {
    expect(validateRankingName('  小明 🐱  ')).toBe('小明 🐱');
    expect(validateRankingName('<b>name</b>')).toBe('<b>name</b>');
    for (const value of ['', '   ', 'x'.repeat(81), 'a\u0000b']) expect(() => validateRankingName(value)).toThrow(RankingError);
  });

  it('submits one actual run with the configured fields and only a player bearer token', async () => {
    const fetcher = transport();
    const client = new LeaderboardClient({ fetcher, storage: null });
    await client.submit('  测试玩家  ', run);
    const [url, init] = fetcher.mock.calls.find(([url]) => String(url).endsWith('/scores'))!;
    expect(String(url)).toBe(`${LEADERBOARD.baseUrl}/api/v1/games/fire-zombie/boards/endless-score/scores`);
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer test-player-token' });
    expect(init?.credentials).toBe('omit');
    expect(JSON.parse(String(init?.body))).toEqual({
      username: '测试玩家', metrics: { score: 1200, wave: 2, distance: 980.126, duration: 65.123 },
      info: { mode: 'endless', bosses: 1, kills: 40, maxCombo: 12 },
    });
  });

  it('shares a pending session and restores the same player after a page reload', async () => {
    const fetcher = transport(), storage = memoryStorage();
    const client = new LeaderboardClient({ fetcher, storage });
    await Promise.all([client.submit('测试玩家', run), client.me()]);
    await new LeaderboardClient({ fetcher, storage }).submit('测试玩家', { ...run, score: 100 });
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/sessions'))).toHaveLength(1);
    expect(JSON.parse(storage.getItem(key)!)).toMatchObject({ playerId: entry.playerId });
  });

  it('loads public pages without requesting or storing an identity, keeping server ranks and ties', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ entries: [entry, { ...entry, playerId: 'another-player' }], total: 42, limit: 20, offset: 20 }));
    const client = new LeaderboardClient({ fetcher, storage: null });
    const page = await client.top(20);
    expect(page.entries.map(e => e.rank)).toEqual([7, 7]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('offset=20');
  });

  it('falls back to an in-memory identity when browser storage is blocked', async () => {
    const fetcher = transport();
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const client = new LeaderboardClient({ fetcher, storage });
    await client.submit('测试玩家', run); await client.me();
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/sessions'))).toHaveLength(1);
  });

  it('renews an expired identity but never loops on a rejected, locally valid token', async () => {
    const storage = memoryStorage(); storage.setItem(key, JSON.stringify({ ...identity(), expiresAt: 1 }));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/sessions') ? json(identity(), 201) : json({ code: 'UNAUTHORIZED' }, 401));
    const client = new LeaderboardClient({ fetcher, storage });
    await expect(client.submit('测试玩家', run)).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    await expect(client.submit('测试玩家', run)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/sessions'))).toHaveLength(1);
  });

  it('treats a worse score and a not-yet-ranked player as normal business results', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sessions')) return json(identity(), 201);
      if (url.includes('/players/')) return json({ code: 'PLAYER_NOT_RANKED' }, 404);
      return json({ accepted: false, playerId: entry.playerId, message: '保留最佳' });
    });
    const client = new LeaderboardClient({ fetcher, storage: null });
    expect((await client.submit('测试玩家', run)).accepted).toBe(false);
    expect(await client.me()).toBeNull();
  });

  it('rejects invalid scores before creating a player or making a request', async () => {
    const fetcher = transport(), client = new LeaderboardClient({ fetcher, storage: null });
    await expect(client.submit('测试玩家', { ...run, score: NaN })).rejects.toMatchObject({ code: 'INVALID_SCORE' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('aborts a stalled request and exposes a retryable timeout', async () => {
    vi.useFakeTimers();
    const fetcher: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
    const pending = new LeaderboardClient({ fetcher, storage: null, timeoutMs: 10 }).top();
    const check = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(11); await check;
  });

  it('migrates old game saves and retains the ranking name without touching old progress', () => {
    const storage = memoryStorage(); vi.stubGlobal('localStorage', storage);
    storage.setItem('prism-swarm-save-v1', JSON.stringify({ unlocked: 3, cores: 99, endless: { bestScore: 5000 } }));
    const old = loadSave(); expect(old.leaderboardName).toBe(''); expect(old.endless.bestScore).toBe(5000);
    old.leaderboardName = '已记住的姓名'; writeSave(old);
    expect(loadSave()).toMatchObject({ leaderboardName: '已记住的姓名', cores: 99, unlocked: 3 });
  });
});
