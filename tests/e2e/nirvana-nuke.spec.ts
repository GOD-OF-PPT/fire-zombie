import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/games/fire-zombie/**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'TEST_NETWORK_DISABLED' }) }),
  );
  await page.goto('/?seed=0');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('title-screen')).toBeVisible();
});

test('Nirvana ultimate fires reliably via HUD click, [G] hotkey, and Firing Range button', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.getByTestId('start-btn').click();
  await expect(page.getByTestId('hud')).toBeVisible();

  // Enter playing state immediately
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => (window as any).__prism.state)).toBe('playing');

  // Confirm HUD nirvana button is actually clickable (pointer-events: auto)
  const pointerEvents = await page.getByTestId('nirvana-btn').evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pointerEvents).toBe('auto');

  // Pressing [G] while charging gives clear status toast instead of failing silently
  await page.keyboard.press('g');
  await expect(page.getByTestId('toast')).toContainText('奥义充能中');

  // Advance gameplay until Nirvana reaches 100% naturally in a standard Sector 1 run
  await page.evaluate(() => {
    const g = (window as any).__prism;
    for (let i = 0; i < 120 && (g.sim.getSnapshot().nirvanaCharge ?? 0) < 0.999 && g.state === 'playing'; i++) {
      g.fastForward(0.5, true);
    }
    g.frame(0);
  });
  const preCharge = await page.evaluate(() => (window as any).__prism.sim.getSnapshot().nirvanaCharge ?? 0);
  expect(preCharge).toBeGreaterThanOrEqual(0.999);
  await expect(page.getByTestId('nirvana-btn')).toHaveClass(/ready/);

  // Click the HUD Nirvana button directly
  await page.getByTestId('nirvana-btn').click();
  await expect(page.getByTestId('nirvana-btn')).toContainText('奥义释放');
  await expect(page.locator('.banner')).toContainText('终焉奥义');

  const afterHudClick = await page.evaluate(() => {
    const s = (window as any).__prism.sim.getSnapshot();
    return { activeTimer: s.nirvanaActiveTimer ?? 0, charge: s.nirvanaCharge ?? 0 };
  });
  expect(afterHudClick.activeTimer).toBeGreaterThan(0);
  expect(afterHudClick.charge).toBe(0);

  // Also test Firing Range [G] hotkey & Firing Range trigger button emit full banner & burst
  await page.goto('/?seed=0');
  await page.getByTestId('range-btn').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__prism.state)).toBe('playing');

  await page.keyboard.press('g');
  await expect.poll(() => page.evaluate(() => (window as any).__prism.sim.getSnapshot().nirvanaActiveTimer ?? 0)).toBeGreaterThan(0);

  // Wait for banner or re-trigger via Firing Range panel button
  await page.getByTestId('rg-nirvana-btn').click();
  await expect(page.locator('.banner')).toContainText('终焉奥义');
  await expect.poll(() => page.evaluate(() => (window as any).__prism.sim.getSnapshot().nirvanaActiveTimer ?? 0)).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('Tactical Nuke triggers multi-wave seismic screen shake, viewport oscillation, and respects shakeScale=0', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.getByTestId('start-btn').click();
  await expect(page.getByTestId('hud')).toBeVisible();

  // Rapid-tap Tactical Nuke twice back-to-back via HUD button (`连点核弹`)!
  await expect(page.getByTestId('nuke-btn')).toContainText('×3');
  await page.getByTestId('nuke-btn').click();
  await expect.poll(() => page.evaluate(() => (window as any).__prism.sim.getSnapshot().nukeStrikes?.length ?? 0)).toBe(1);
  await expect(page.getByTestId('nuke-btn')).toHaveClass(/salvo-hot/);

  // Second rapid click while first warhead is still descending in mid-air!
  await page.getByTestId('nuke-btn').click();
  await expect.poll(() => page.evaluate(() => (window as any).__prism.sim.getSnapshot().nukeStrikes?.length ?? 0)).toBe(2);
  await expect(page.locator('.banner')).toContainText('双星连环核打击');

  // Step warhead descent cleanly via sim.stepFixed, then sample real Game.frame(dt) across every seismic wave!
  const shakeSamples = await page.evaluate(() => {
    const g = (window as any).__prism;
    const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
    const uiRoot = document.querySelector<HTMLElement>('#ui-root')!;
    const scorch = document.querySelector<HTMLElement>('.nuke-scorch')!;

    // Fast-step the 1.15s orbital descent until all launched warheads detonate (accounting for any warhead that already entered blastTimer during Playwright UI clicks!)
    const preSnap = g.sim.getSnapshot();
    let detonateCount = (preSnap.nukeStrikes ?? []).filter((s: any) => s.blastTimer > 0).length;
    let maxSalvoIdx = (preSnap.nukeStrikes ?? []).reduce((m: number, s: any) => Math.max(m, s.salvoIndex ?? 1), 0);
    for (let step = 0; step < 100; step++) {
      if ((g.sim.getSnapshot().nukeStrikes ?? []).every((s: any) => s.dropTimer <= 0)) break;
      const evs = g.sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0 });
      const snap = g.sim.getSnapshot();
      g.handleEvents(evs, snap, true);
      for (const e of evs) {
        if (e.type === 'NUKE_DETONATE') {
          detonateCount++;
          maxSalvoIdx = Math.max(maxSalvoIdx, e.salvoIndex ?? 1);
        }
      }
    }
    const detonated = detonateCount >= 2 && maxSalvoIdx >= 2;

    const sampleFrames = (dtStep: number, count: number) => {
      let peakMag = 0;
      let peakScale = 1;
      let peakRot = 0;
      let sawCanvasTransform = false;
      let sawUiTransform = false;
      for (let i = 0; i < count; i++) {
        g.frame(dtStep);
        const sh = g.renderer.getScreenShakeOffset();
        const mag = Math.hypot(sh.x, sh.y);
        if (mag > peakMag) peakMag = mag;
        if (sh.scale > peakScale) peakScale = sh.scale;
        if (Math.abs(sh.rotDeg) > peakRot) peakRot = Math.abs(sh.rotDeg);
        if (canvas.style.transform.includes('translate3d')) sawCanvasTransform = true;
        if (uiRoot.style.transform.includes('translate3d')) sawUiTransform = true;
      }
      return { peakMag, peakScale, peakRot, sawCanvasTransform, sawUiTransform };
    };

    const scorchOpacity = Number(scorch.style.opacity || 0);
    const wave1 = sampleFrames(0.03, 5);   // 0.00s..0.15s (Wave 1 ground-zero impact slam)
    const wave2 = sampleFrames(0.04, 8);   // 0.15s..0.47s (Wave 2 shockwave arrival slam @ 0.28s)
    const wave3 = sampleFrames(0.06, 9);   // 0.47s..1.01s (Wave 3 tectonic aftershock @ 0.78s)
    // Drain past 2.65s quake duration and verify clean transform reset
    for (let i = 0; i < 12; i++) g.frame(0.18);
    const settled = { ...g.renderer.getScreenShakeOffset() };
    const settledCanvasTransform = canvas.style.transform;
    const settledUiTransform = uiRoot.style.transform;

    // Verify Meteor Sky-Slam landing VFX (`triggerJumpSlamVfx`) produces crisp 3D dome + screen quake!
    g.renderer.triggerJumpSlamVfx(0, 17, 5);
    const jumpSlamWave = sampleFrames(0.03, 3);
    for (let i = 0; i < 6; i++) g.frame(0.15);

    // Verify shakeScale = 0 completely disables BOTH 3D quake and viewport CSS transform
    g.renderer.setAccessibility({ shakeScale: 0, flashScale: 1, colorblind: 'off', aimAssist: false });
    g.renderer.triggerNukeDetonationVfx(0, -19.5);
    g.frame(0.03);
    const zeroScaleOffset = { ...g.renderer.getScreenShakeOffset() };
    const zeroScaleCanvasTransform = canvas.style.transform;

    return {
      detonated,
      scorchOpacity,
      wave1,
      wave2,
      wave3,
      jumpSlamWave,
      settled,
      settledCanvasTransform,
      settledUiTransform,
      zeroScaleOffset,
      zeroScaleCanvasTransform,
    };
  });

  expect(shakeSamples.detonated).toBe(true);
  expect(shakeSamples.scorchOpacity).toBeGreaterThan(0.3);
  expect(shakeSamples.jumpSlamWave.peakMag).toBeGreaterThan(1.5);
  // Wave 1 & Wave 2 deliver powerful multi-pixel screen oscillation + overscan zoom + tilt via real Game.frame()
  expect(shakeSamples.wave1.peakMag).toBeGreaterThan(5);
  expect(shakeSamples.wave1.peakScale).toBeGreaterThan(1.01);
  expect(shakeSamples.wave1.sawCanvasTransform).toBe(true);
  expect(shakeSamples.wave1.sawUiTransform).toBe(true);
  expect(shakeSamples.wave2.peakMag).toBeGreaterThan(5);
  expect(shakeSamples.wave2.peakRot).toBeGreaterThan(0.2);
  // Wave 3 sustained tectonic aftershock continues visibly shaking past 0.5s!
  expect(shakeSamples.wave3.peakMag).toBeGreaterThan(1.5);
  // Clean settle back to 0 and empty inline transform when earthquake finishes
  expect(shakeSamples.settled.x).toBe(0);
  expect(shakeSamples.settled.y).toBe(0);
  expect(shakeSamples.settled.scale).toBe(1);
  expect(shakeSamples.settledCanvasTransform).toBe('');
  expect(shakeSamples.settledUiTransform).toBe('');
  // Accessibility shakeScale=0 produces zero screen shake and empty transform
  expect(shakeSamples.zeroScaleOffset.x).toBe(0);
  expect(shakeSamples.zeroScaleOffset.y).toBe(0);
  expect(shakeSamples.zeroScaleOffset.scale).toBe(1);
  expect(shakeSamples.zeroScaleCanvasTransform).toBe('');

  expect(errors).toEqual([]);
});
