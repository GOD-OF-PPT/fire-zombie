import { expect, test } from '@playwright/test';

test('blitz launches without campaign unlocks, keeps mutators, reports damage, and stores its own record', async ({ page }) => {
  let scorePosts = 0;
  await page.route('**/api/v1/games/fire-zombie/**', route => {
    if (route.request().method() === 'POST') scorePosts++;
    return route.fulfill({ status: 503, body: '{}' });
  });
  await page.goto('/?seed=7');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('blitz-btn')).toBeVisible();
  await expect(page.getByTestId('leaderboard-btn')).toBeVisible();
  for (const id of ['mirror_twin', 'glass_cannon', 'barrel_carnival']) {
    await page.getByTestId(`mutator-${id}`).click();
    await expect(page.getByTestId(`mutator-${id}`)).toHaveClass(/on/);
  }
  await page.reload();
  for (const id of ['mirror_twin', 'glass_cannon', 'barrel_carnival']) {
    await expect(page.getByTestId(`mutator-${id}`)).toHaveClass(/on/);
  }
  await page.getByTestId('blitz-btn').click();
  const start = await page.evaluate(() => (window as any).__prism.sim.getSnapshot());
  expect(start.blitzActive).toBe(true);
  expect(start.mirrorTwinActive).toBe(true);
  expect(start.mutators).toEqual(['mirror_twin', 'glass_cannon', 'barrel_carnival']);
  await page.evaluate(() => (window as any).__prism.fastForward(180, true));
  await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('result-archetype')).toBeVisible();
  await expect(page.getByTestId('damage-breakdown')).toBeVisible();
  expect(await page.getByTestId('stack-rack').locator('.st-pill').count()).toBeGreaterThan(0);
  await expect(page.getByTestId('stack-rack')).not.toContainText('[object Object]');
  await expect(page.getByTestId('retry-btn')).toHaveText('再战闪击');
  await expect(page.getByTestId('next-btn')).toHaveCount(0);
  await expect(page.getByTestId('ranking-name-screen')).toBeHidden();
  expect(scorePosts).toBe(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('prism-swarm-save-v1')!));
  expect(saved.blitz.bestScore).toBeGreaterThan(0);
  expect(saved.unlocked).toBe(1);
  expect(saved.records[4]).toEqual({ stars: 0, score: 0, cleared: false });
  expect(saved.endless.bestScore).toBe(0);
  await page.getByTestId('retry-btn').click();
  const retry = await page.evaluate(() => (window as any).__prism.sim.getSnapshot());
  expect(retry.blitzActive).toBe(true);
  expect(retry.simTime).toBe(0);
  expect(retry.mutators).toEqual(start.mutators);
});
