import { expect, test, type Page, type Route } from '@playwright/test';

const BASE = '**/api/v1/games/fire-zombie/**';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
type Payload = { username: string; metrics: { score: number; wave: number; distance: number; duration: number }; info: Record<string, unknown> };
const guest = 'guest_leaderboard-test';
const makeEntry = (rank: number, username = '霓虹玩家', id = guest) => ({ rank, playerId: id, username, metrics: { score: 1200, wave: 2, distance: 962, duration: 65 }, info: {}, achievedAt: '2026-11-17T08:00:00.000Z' });

async function mockRanking(page: Page) {
  const state = {
    sessions: 0, scores: [] as Payload[], authorizations: [] as string[], failScores: false,
    accepted: true, entries: [] as ReturnType<typeof makeEntry>[],
    delayScores: false, release: null as (() => void) | null,
  };
  const reply = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  await page.route(BASE, async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
    if (url.pathname.endsWith('/sessions')) {
      state.sessions++;
      await reply(route, { playerId: guest, token: 'guest-test-token', expiresAt: Date.now() / 1000 + 3600 }, 201); return;
    }
    if (url.pathname.endsWith('/scores')) {
      state.scores.push(request.postDataJSON());
      state.authorizations.push(request.headers()['authorization']);
      if (state.delayScores) await new Promise<void>(resolve => { state.release = resolve; });
      if (state.failScores) { await route.abort('failed'); return; }
      await reply(route, { accepted: state.accepted, playerId: guest, message: 'ok' }); return;
    }
    if (url.pathname.includes('/players/')) { await reply(route, { entry: makeEntry(7) }); return; }
    const offset = Number(url.searchParams.get('offset') ?? 0);
    await reply(route, { entries: state.entries.slice(offset, offset + 20), total: state.entries.length, offset, limit: 20 });
  });
  return state;
}

async function defeat(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).__prism;
    for (let i = 0; i < 12; i++) {
      g.fastForward(900, false);
      if (g.state !== 'draft') break;
      g.chooseProtocol(g.sim.getSnapshot().endless.offers[0]);
    }
  });
  await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 20000 });
}

async function endlessDefeat(page: Page) {
  await page.goto('/?play=1&mode=endless&seed=5');
  await page.evaluate(() => (window as any).__prism.renderer.assetsReady);
  await defeat(page);
}

async function extractAtFirstCheckpoint(page: Page) {
  await page.goto('/index.html?seed=5');
  await page.getByTestId('endless-btn').click();
  await page.evaluate(() => (window as any).__prism.fastForward(200, true));
  await page.getByTestId('extract-endless-btn').click();
  await expect(page.getByTestId('result-screen')).toContainText('赏金安全撤离');
  return page.evaluate(() => {
    const g = (window as any).__prism, s = g.sim.getSnapshot();
    return {
      score: g.score,
      wave: s.endless.wave,
      distance: Math.round(s.endless.distance * 1000) / 1000,
      duration: Math.round(Math.max(g.runTime, s.simTime) * 1000) / 1000,
    };
  });
}

test('endless extraction prompts for a name, then submits the final score automatically on later extractions', async ({ page }) => {
  const api = await mockRanking(page);
  const first = await extractAtFirstCheckpoint(page);
  await expect(page.getByTestId('ranking-name-screen')).toBeVisible();
  expect(api.scores).toHaveLength(0);
  await page.getByTestId('ranking-name-input').fill('撤离玩家');
  await page.getByTestId('ranking-name-submit').click();
  await expect(page.getByTestId('ranking-result-status')).toContainText('我的名次 #7');
  expect(api.scores).toHaveLength(1);
  expect(api.scores[0]).toMatchObject({ username: '撤离玩家', metrics: first });

  api.failScores = true;
  const second = await extractAtFirstCheckpoint(page);
  await expect(page.getByTestId('ranking-name-screen')).toBeHidden();
  await expect(page.getByTestId('ranking-retry')).toBeVisible();
  expect(api.scores).toHaveLength(2);
  expect(api.scores[1]).toMatchObject({ username: '撤离玩家', metrics: second });
  api.failScores = false;
  await page.getByTestId('ranking-retry').click();
  await expect(page.getByTestId('ranking-result-status')).toContainText('我的名次 #7');
  await page.getByTestId('result-leaderboard-btn').click();
  await page.getByTestId('ranking-close').click();
  expect(api.scores).toHaveLength(3);
  expect(api.scores[2]).toEqual(api.scores[1]);
  expect(api.sessions).toBe(1);
});

test('first endless defeat asks once, uploads actual metrics and reuses name/player after reload', async ({ page }) => {
  const api = await mockRanking(page);
  await endlessDefeat(page);
  await expect(page.getByTestId('ranking-name-screen')).toBeVisible();
  expect(api.scores).toHaveLength(0); expect(api.sessions).toBe(0);
  await page.getByTestId('ranking-name-input').fill('   ');
  await page.getByTestId('ranking-name-submit').click();
  await expect(page.getByTestId('ranking-name-error')).toContainText('请输入');
  const actual = await page.evaluate(() => {
    const g = (window as any).__prism, s = g.sim.getSnapshot();
    return { score: g.score, wave: s.endless.wave, distance: Math.round(s.endless.distance * 1000) / 1000, duration: Math.round(g.runTime * 1000) / 1000 };
  });
  await page.getByTestId('ranking-name-input').fill('  霓虹玩家  ');
  await page.getByTestId('ranking-name-submit').click();
  await expect(page.getByTestId('ranking-name-screen')).toBeHidden();
  await expect(page.getByTestId('ranking-result-status')).toContainText('我的名次 #7');
  expect(api.scores).toHaveLength(1);
  expect(api.scores[0]).toMatchObject({ username: '霓虹玩家', metrics: actual, info: { mode: 'endless' } });
  expect(api.authorizations).toEqual(['Bearer guest-test-token']);
  expect(api.sessions).toBe(1);
  await page.getByTestId('watch-replay-btn').click();
  await page.getByTestId('exit-replay-btn').click();
  await expect(page.getByTestId('ranking-result-status')).toContainText('我的名次 #7');
  expect(api.scores).toHaveLength(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('prism-swarm-save-v1')!).leaderboardName)).toBe('霓虹玩家');
  api.accepted = false;
  await page.reload();
  await page.evaluate(() => (window as any).__prism.renderer.assetsReady);
  await defeat(page);
  await expect(page.getByTestId('ranking-name-screen')).toBeHidden();
  await expect(page.getByTestId('ranking-result-status')).toContainText('已保留历史最好成绩');
  expect(api.scores).toHaveLength(2); expect(api.sessions).toBe(1);
});

test('network failure keeps one run for retry and late replies cannot restore an old result', async ({ page }) => {
  const api = await mockRanking(page); api.failScores = true;
  await endlessDefeat(page);
  await page.getByTestId('ranking-name-input').fill('断网玩家');
  await page.getByTestId('ranking-name-submit').click();
  await expect(page.getByTestId('ranking-result-status')).toContainText('本局成绩已保留');
  await expect(page.getByTestId('ranking-retry')).toBeVisible();
  const first = api.scores[0];
  api.failScores = false;
  await page.getByTestId('ranking-retry').click();
  await expect(page.getByTestId('ranking-result-status')).toContainText('我的名次 #7');
  expect(api.scores).toHaveLength(2); expect(api.scores[1]).toEqual(first); expect(api.sessions).toBe(1);
  await page.getByTestId('retry-btn').click(); api.delayScores = true;
  await defeat(page);
  await expect(page.getByTestId('ranking-result-status')).toContainText('正在上传');
  await expect.poll(() => !!api.release).toBe(true);
  await page.getByTestId('retry-btn').click();
  api.release!();
  await page.waitForTimeout(250);
  await expect(page.getByTestId('result-screen')).toBeHidden();
  await expect(page.getByTestId('ranking-name-screen')).toBeHidden();
});

test('public browsing uses server ranks, paginates ties and renders hostile names as plain text', async ({ page }) => {
  const api = await mockRanking(page);
  await page.goto('/');
  await page.getByTestId('leaderboard-btn').click();
  await expect(page.getByTestId('ranking-rows')).toContainText('暂无成绩');
  expect(api.sessions).toBe(0);
  const unsafe = '<img src=x onerror=alert(1)>';
  api.entries = Array.from({ length: 22 }, (_, i) => makeEntry(i < 6 ? i + 1 : 7, i === 0 ? unsafe : `玩家${i}`, `player-${i}`));
  await page.getByTestId('ranking-refresh').click();
  await expect(page.locator('.ranking-player')).toHaveCount(20);
  await expect(page.locator('.ranking-player').first()).toContainText(unsafe);
  await expect(page.locator('.ranking-player img')).toHaveCount(0);
  await page.getByTestId('ranking-next').click();
  await expect(page.locator('.ranking-player')).toHaveCount(2);
  await expect(page.locator('.ranking-position')).toHaveText(['7', '7']);
  await expect(page.getByTestId('ranking-prev')).toBeEnabled();
  await expect(page.getByTestId('ranking-next')).toBeDisabled();
  expect(api.sessions).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('leaderboard-screen')).toBeHidden();
});

test('campaign failures never submit; skipping the name still permits retrying endless', async ({ page }) => {
  const api = await mockRanking(page);
  await page.goto('/?play=1&seed=0'); await defeat(page);
  await expect(page.getByTestId('ranking-name-screen')).toBeHidden();
  expect(api.sessions).toBe(0); expect(api.scores).toHaveLength(0);
  await endlessDefeat(page);
  await expect(page.getByTestId('ranking-name-screen')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ranking-name-screen')).toBeHidden();
  await page.getByTestId('ranking-enter-name').click();
  await expect(page.getByTestId('ranking-name-screen')).toBeVisible();
  await page.getByTestId('ranking-name-skip').click();
  await page.getByTestId('retry-btn').click();
  await expect(page.getByTestId('result-screen')).toBeHidden();
  expect(api.sessions).toBe(0); expect(api.scores).toHaveLength(0);
});

test('single-file game includes the same first-defeat ranking flow', async ({ page }) => {
  const api = await mockRanking(page);
  await page.goto('/index.html?play=1&mode=endless&seed=5');
  await page.evaluate(() => (window as any).__prism.renderer.assetsReady);
  expect(await page.evaluate(() => (window as any).__prism.renderer.modelSource)).toBe('procedural');
  await defeat(page);
  await expect(page.getByTestId('ranking-name-screen')).toBeVisible();
  await page.getByTestId('ranking-name-input').fill('单文件玩家');
  await page.getByTestId('ranking-name-submit').click();
  await expect(page.getByTestId('ranking-result-status')).toContainText('我的名次 #7');
  expect(api.scores).toHaveLength(1);
});
