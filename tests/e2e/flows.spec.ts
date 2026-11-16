import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end flow checks against the production build (`npm run test:e2e`).
 * Uses the `window.__prism` verification hook: `fastForward(seconds, useAutopilot)` advances the
 * deterministic sim in fixed 1/60 s steps through the real event → UI pipeline.
 */

type Snap = {
  state: string;
  phase: string;
  squad: number;
  squadX: number;
  sector: number;
  simTime: number;
  enemies: number;
  projectiles: number;
  gates: number;
  boss: boolean;
  weapon: string;
};

const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => {
    const g = (window as any).__prism;
    const s = g.sim.getSnapshot();
    return {
      state: g.state,
      phase: s.phase,
      squad: s.squadCount,
      squadX: s.squadX,
      sector: s.sector,
      simTime: s.simTime,
      enemies: s.enemies.length,
      projectiles: s.projectiles.length,
      gates: s.gates.length,
      boss: Boolean(s.boss),
      weapon: `${s.weapon}${s.weaponLevel}`,
    };
  });

const ff = (page: Page, sec: number, auto = true): Promise<void> =>
  page.evaluate(([s, a]) => (window as any).__prism.fastForward(s, a), [sec, auto] as const);

/** Synthetic touch drag (pointerType=touch) across the stage. */
async function touchDrag(page: Page, dx: number): Promise<void> {
  await page.evaluate((dx) => {
    const stage = document.querySelector('[data-testid=game-stage]') as HTMLElement;
    const r = stage.getBoundingClientRect();
    const x0 = r.left + r.width / 2;
    const y = r.top + r.height * 0.7;
    const ev = (type: string, x: number) =>
      stage.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true }));
    ev('pointerdown', x0);
    for (let i = 1; i <= 10; i++) ev('pointermove', x0 + (dx * i) / 10);
    ev('pointerup', x0 + dx);
  }, dx);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?seed=0');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('title-screen')).toBeVisible();
});

test('title → start → touch drag moves the swarm and stays in bounds', async ({ page }) => {
  await page.evaluate(() => (window as any).__prism.renderer.assetsReady);
  expect(await page.evaluate(() => (window as any).__prism.renderer.modelSource)).toBe('gltf');
  await page.getByTestId('start-btn').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await touchDrag(page, -120);
  await page.waitForTimeout(400);
  const a = await snap(page);
  expect(a.state).toBe('playing');
  expect(a.squadX).toBeLessThan(-0.5);
  // massive drag must clamp inside the track
  await touchDrag(page, 4000);
  await page.waitForTimeout(400);
  const b = await snap(page);
  expect(b.squadX).toBeGreaterThan(0);
  expect(b.squadX).toBeLessThanOrEqual(5);
  // keyboard also works
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowLeft');
  expect((await snap(page)).squadX).toBeLessThan(b.squadX);
});

test('full clear → results → next sector is playable; badge matches true squad', async ({ page }) => {
  await page.getByTestId('start-btn').click();
  await touchDrag(page, 10);
  await ff(page, 30);
  const mid = await snap(page);
  await page.waitForTimeout(150);
  await expect(page.getByTestId('squad-count')).toContainText(String((await snap(page)).squad));
  expect(mid.weapon).not.toBe('pulse1'); // a vault upgrade was collected
  await ff(page, 200);
  await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 20000 });
  expect((await snap(page)).phase).toBe('VICTORY');
  await expect(page.getByTestId('result-cores')).toBeVisible();
  await page.getByTestId('next-btn').click();
  const s2 = await snap(page);
  expect(s2.sector).toBe(2);
  expect(s2.squad).toBe(3);
  expect(s2.enemies + s2.projectiles).toBe(0);
  await ff(page, 220);
  await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 20000 });
  expect((await snap(page)).phase).toBe('VICTORY');
});

test('sector 4 random corridor stays locked until unlocked, then plays a seeded layout to victory', async ({ page }) => {
  await expect(page.getByTestId('sector-4')).toHaveClass(/locked/);
  await page.evaluate(() =>
    localStorage.setItem('prism-swarm-save-v1', JSON.stringify({ unlocked: 4, cores: 0, upgrades: { squad: 0, power: 0, reso: 0 } })),
  );
  await page.goto('/?seed=5');
  await page.getByTestId('sector-4').click();
  await page.getByTestId('start-btn').click();
  await touchDrag(page, 10);
  expect((await snap(page)).sector).toBe(4);
  await ff(page, 240);
  await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 20000 });
  expect((await snap(page)).phase).toBe('VICTORY');
});

test('defeat shows a reason, retry fully resets the run', async ({ page }) => {
  await page.getByTestId('start-btn').click();
  await touchDrag(page, 10);
  await ff(page, 250, false); // AFK
  await expect(page.getByTestId('defeat-reason')).toBeVisible({ timeout: 20000 });
  expect((await snap(page)).phase).toBe('DEFEAT');
  await page.getByTestId('retry-btn').click();
  const r = await snap(page);
  expect(r.phase).toBe('PLAYING');
  expect(r.squad).toBe(1);
  expect(r.boss).toBe(false);
  expect(r.projectiles).toBe(0);
  expect(r.simTime).toBe(0);
  await expect(page.getByTestId('result-screen')).toBeHidden();
});

test('pause freezes simulation; resume via Esc; mute persists', async ({ page }) => {
  await page.getByTestId('start-btn').click();
  await touchDrag(page, 10);
  await page.waitForTimeout(500);
  await page.getByTestId('pause-btn').click();
  await expect(page.getByTestId('pause-screen')).toBeVisible();
  const t0 = (await snap(page)).simTime;
  await page.waitForTimeout(700);
  expect((await snap(page)).simTime).toBe(t0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  expect((await snap(page)).simTime).toBeGreaterThan(t0);
  await page.getByTestId('mute-btn').click();
  await page.reload();
  const muted = await page.evaluate(() => JSON.parse(localStorage.getItem('prism-swarm-save-v1')!).muted);
  expect(muted).toBe(true);
});

test('GLB load failure falls back to procedural models with a notice', async ({ page }) => {
  await page.route('**/*.glb', (route) => route.abort());
  await page.reload();
  await expect(page.getByTestId('toast')).toHaveClass(/show/, { timeout: 15000 });
  await expect(page.getByTestId('toast')).toContainText('简化模型');
  expect(await page.evaluate(() => (window as any).__prism.renderer.modelSource)).toBe('procedural');
  await page.getByTestId('start-btn').click();
  await touchDrag(page, 10);
  await ff(page, 20);
  await page.waitForTimeout(600);
  const shown = await page.evaluate(() => {
    const r = (window as any).__prism.renderer;
    return {
      squad: r.squadSlots.filter((s: any) => s.actor?.root.visible).length,
      enemies: r.activeEnemies.size,
    };
  });
  expect(shown.squad).toBeGreaterThan(1);
  expect(shown.enemies).toBeGreaterThan(0);
});

test('workshop purchase spends cores and boosts the next run', async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem('prism-swarm-save-v1', JSON.stringify({ unlocked: 1, cores: 100, upgrades: { squad: 0, power: 0, reso: 0 } })),
  );
  await page.reload();
  await page.getByTestId('workshop-btn').click();
  await page.getByTestId('buy-squad').click();
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('prism-swarm-save-v1')!));
  expect(save.cores).toBe(50); // 100 − 50 (先遣编队 Lv1 cost)
  expect(save.upgrades.squad).toBe(1);
  await page.getByTestId('workshop-close').click();
  await page.getByTestId('start-btn').click();
  expect((await snap(page)).squad).toBe(3); // 1 base + 2 from 先遣编队 Lv1
});
