import { expect, test, type Page } from '@playwright/test';
import { PLAYER_Z } from '../../src/config/constants';
import type { GateSnapshot, SimEvent, SimSnapshot } from '../../src/types/game';

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
  endless: { wave: number; bosses: number; distance: number; upgrades: Record<string, number>; offers: string[] } | null;
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
      endless: s.endless ?? null,
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
  // These gameplay regressions never create players or scores on the live service.
  await page.route('**/api/v1/games/fire-zombie/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'TEST_NETWORK_DISABLED' }) }));
  await page.goto('/?seed=0');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('title-screen')).toBeVisible();
});

test('title → start → touch drag moves the swarm and stays in bounds', async ({ page }) => {
  await page.evaluate(() => (window as any).__prism.renderer.assetsReady);
  expect(await page.evaluate(() => (window as any).__prism.renderer.modelSource)).toBe('procedural');
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

test('endless is immediately available, drafts an upgrade, saves records, and retries the same mode', async ({ page }) => {
  await expect(page.getByTestId('endless-btn')).toBeEnabled();
  await page.getByTestId('endless-btn').click();
  expect((await snap(page)).sector).toBe(4);
  expect((await snap(page)).endless?.wave).toBe(1);
  await page.evaluate(() =>
    localStorage.setItem('prism-swarm-save-v1', JSON.stringify({ unlocked: 4, cores: 0, upgrades: { squad: 0, power: 0, reso: 0 } })),
  );
  await page.goto('/?seed=5&mode=endless&play=1&unlock=1');
  await page.evaluate(() => (window as any).__prism.renderer.assetsReady);
  await expect(page.getByTestId('endless-hud')).toBeVisible();
  await touchDrag(page, 10);
  await ff(page, 200);
  const loop = await snap(page);
  expect(loop.phase).toBe('PAUSED');
  expect(loop.endless?.wave).toBeGreaterThanOrEqual(2);
  expect(loop.endless?.bosses).toBeGreaterThanOrEqual(1);
  expect(loop.endless?.distance).toBeGreaterThan(900);
  await expect(page.getByTestId('endless-hud')).toContainText(`阶段 ${loop.endless!.wave}`);
  await expect(page.getByTestId('protocol-screen')).toBeVisible();
  const time = loop.simTime;
  await page.waitForTimeout(250);
  expect((await snap(page)).simTime).toBe(time);
  await expect(page.locator('[data-protocol]')).toHaveCount(3);
  await page.keyboard.press('1');
  await expect(page.getByTestId('protocol-screen')).toBeHidden();
  expect((await snap(page)).phase).toBe('PLAYING');
  const upgrades = await page.evaluate(() => (window as any).__prism.sim.getSnapshot().endless.upgrades);
  expect(Object.values(upgrades)).toEqual([1]);

  // A new boss must be visible after the previous one's death animation has hidden its actor.
  await page.evaluate(() => {
    const g = (window as any).__prism;
    for (let i = 0; i < 200 && !g.sim.getSnapshot().boss && g.state === 'playing'; i++) g.fastForward(0.5, true);
    g.frame(0);
  });
  expect((await snap(page)).boss).toBe(true);
  expect(await page.evaluate(() => {
    const g = (window as any).__prism;
    return g.renderer.bossViews.get(g.sim.getSnapshot().boss.id).root.visible;
  })).toBe(true);

  // Stacked weapons sustain idle runs. Choose harmful gates at the last moment so
  // auto-fire cannot improve them first. Drive only simulation inputs; never edit health.
  const losses = await page.evaluate((playerZ) => {
    const g = (window as any).__prism;
    const after = (gate: GateSnapshot, n: number): number => {
      switch (gate.op) {
        case 'add': return n + Math.trunc(gate.value);
        case 'sub': return n - Math.abs(Math.trunc(gate.value));
        case 'mul': return Math.floor(n * Math.max(0, gate.value));
        case 'div': return gate.value > 0 ? Math.floor(n / gate.value) : 0;
      }
    };
    let negativeGates = 0;
    for (let step = 0; step < 900 * 60; step++) {
      const s = g.sim.getSnapshot() as SimSnapshot;
      if (s.phase === 'DEFEAT') break;
      if (g.state === 'draft') { g.chooseProtocol(s.endless!.offers[0]); continue; }
      if (g.state !== 'playing') break;
      const gates = s.gates.filter(v => !v.triggered && !v.dimmed && v.z < playerZ).sort((a, b) => b.z - a.z);
      const next = gates[0];
      let target = -5;
      if (next) {
        const row = gates.filter(v => v.rowId === next.rowId).sort((a, b) => after(a, s.squadCount) - after(b, s.squadCount));
        const worst = row[0]!;
        target = next.z >= playerZ - 0.5 ? worst.x : worst.x < 0 ? 5 : -5;
      }
      const events: readonly SimEvent[] = g.sim.stepFixed({ dragDeltaX: target - s.squadX, keyAxisX: 0 });
      g.runTime += 1 / 60;
      g.handleEvents(events, g.sim.getSnapshot(), true);
      g.ui.updateFloats(1 / 60);
      g.renderer.effects.update(1 / 60);
      negativeGates += events.filter(e => e.type === 'GATE_PASS' && e.delta < 0).length;
    }
    g.frame(0);
    return negativeGates;
  }, PLAYER_Z);
  expect(losses).toBeGreaterThan(0);
  await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 20000 });
  expect((await snap(page)).phase).toBe('DEFEAT');
  const finalWave = (await snap(page)).endless!.wave;
  await expect(page.getByTestId('result-wave')).toHaveText(String(finalWave));
  await page.getByTestId('ranking-name-skip').click();
  await expect(page.getByTestId('next-btn')).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('prism-swarm-save-v1')!));
  expect(saved.endless.bestWave).toBe(finalWave);
  expect(saved.endless.bosses).toBeGreaterThanOrEqual(1);
  expect(saved.endless.bestDistance).toBeGreaterThan(900);
  expect(saved.records[4].score).toBe(0); // endless never overwrites the authored sector record

  await page.getByTestId('retry-btn').click();
  const retry = await snap(page);
  expect(retry.phase).toBe('PLAYING');
  expect(retry.endless).toEqual({ wave: 1, bosses: 0, distance: 0, upgrades: {}, offers: [] });
  expect(retry.squad).toBe(8);
  expect(retry.simTime).toBe(0);
  await page.getByTestId('pause-btn').click();
  await page.getByTestId('home-btn').click();
  await expect(page.getByTestId('title-screen')).toBeVisible();
  await expect(page.getByTestId('endless-btn')).toBeEnabled();
  await expect(page.getByTestId('endless-btn')).toContainText(`最佳 阶段 ${finalWave}`);
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

test('default playable entry needs no external GLB downloads', async ({ page }) => {
  let modelRequests = 0;
  await page.route('**/*.glb', (route) => { modelRequests++; return route.abort(); });
  await page.reload();
  await page.evaluate(() => (window as any).__prism.renderer.assetsReady);
  expect(await page.evaluate(() => (window as any).__prism.renderer.modelSource)).toBe('procedural');
  expect(modelRequests).toBe(0);
  await expect(page.getByTestId('toast')).not.toContainText('简化模型');
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

test('root loads the default index entry and the legacy playable URL preserves run parameters', async ({ page }) => {
  const root = await page.request.get('/?play=1&mode=endless&seed=5', { maxRedirects: 0 });
  expect(root.status()).toBe(200);
  expect(root.headers().location).toBeUndefined();
  const legacy = await page.request.get('/playable-v2.html?play=1&mode=endless&seed=5', { maxRedirects: 0 });
  expect(legacy.status()).toBe(302);
  expect(legacy.headers().location).toBe('./index.html?play=1&mode=endless&seed=5');
  await page.goto('/index.html?play=1&sector=2&seed=0&unlock=1');
  await expect(page).toHaveURL(/\/index\.html\?play=1&sector=2&seed=0&unlock=1$/);
  expect((await snap(page)).sector).toBe(2);
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
