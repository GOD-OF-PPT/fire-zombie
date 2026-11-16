// Dev visual check (requires `npm run dev` on :5173 and Playwright Chromium):
//   node scripts/shot.mjs <outdir> [basic|boss|workshop|result|defeat|mid|endless]
// GPU=1 renders on the host GPU instead of SwiftShader; CHROMIUM overrides the browser binary;
// BLOCK_GLB=1 aborts the GLB downloads to exercise the procedural fallback models.
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '/tmp/shots';
const scenario = process.argv[3] ?? 'basic';
const base = process.env.URL ?? 'http://localhost:5173/';
const SYSTEM_CHROMIUM = '/usr/lib/chromium/chromium';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? (fs.existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined),
  args:
    process.env.GPU === '1'
      ? ['--enable-gpu', '--ignore-gpu-blocklist']
      : ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const dpr = Number(process.env.DPR ?? '1');
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
if (process.env.BLOCK_GLB === '1') await page.route('**/*.glb', (route) => route.abort());

const shot = async (name) => page.screenshot({ path: `${out}/${name}.png` });
const waitAssets = async () => page.evaluate(() => window.__prism?.renderer?.assetsReady);
const state = () => page.evaluate(() => {
  const g = window.__prism;
  const s = g.sim.getSnapshot();
  return { state: g.state, phase: s.phase, squad: s.squadCount, prog: s.runwayProgress.toFixed(3), weapon: s.weapon + s.weaponLevel, boss: s.boss ? `${s.boss.phase}:${Math.round(s.boss.hp)}` : null, score: g.score, drawCalls: g.renderer.renderer.info.render.calls, triangles: g.renderer.renderer.info.render.triangles };
});
const drag = async () => {
  const box = await page.locator('[data-testid=game-stage]').boundingBox();
  await page.mouse.move(box.x + 200, box.y + 600);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 600, { steps: 6 });
  await page.mouse.up();
};

if (scenario === 'workshop') {
  await page.goto(base);
  await waitAssets();
  await page.evaluate(() => {
    localStorage.setItem('prism-swarm-save-v1', JSON.stringify({ unlocked: 2, records: { 1: { stars: 2, score: 5000, cleared: true } }, cores: 260, upgrades: { squad: 1, power: 0, reso: 0 } }));
  });
  await page.reload();
  await waitAssets();
  await page.waitForTimeout(2000);
  await shot('w1-title');
  await page.click('[data-testid=workshop-btn]');
  await page.waitForTimeout(500);
  await shot('w2-workshop');
  await page.click('[data-testid=buy-power]');
  await page.waitForTimeout(300);
  await shot('w3-bought');
  console.log(await page.evaluate(() => localStorage.getItem('prism-swarm-save-v1')));
} else if (scenario === 'endless') {
  await page.goto(base);
  await page.evaluate(() => localStorage.setItem('prism-swarm-save-v1', JSON.stringify({ unlocked: 4, cores: 0, upgrades: { squad: 0, power: 0, reso: 0 } })));
  await page.goto(base + '?play=1&unlock=1&mode=endless&seed=5');
  await waitAssets();
  await page.waitForTimeout(800);
  await drag();
  await page.evaluate(() => window.__prism.fastForward(200, true));
  await page.waitForTimeout(1600);
  console.log('endless stage', await state(), await page.evaluate(() => window.__prism.sim.getSnapshot().endless));
  await shot('e1-stage');
  for (let i = 0; i < 15; i++) {
    if (await page.evaluate(() => window.__prism.state === 'draft')) {
      await page.locator('[data-protocol]').first().click();
    }
    await page.evaluate(() => window.__prism.fastForward(900, false));
    if (await page.evaluate(() => ['outro', 'result'].includes(window.__prism.state))) break;
  }
  await page.waitForTimeout(2500);
  console.log('endless result', await state());
  await shot('e2-result');
} else if (scenario === 'result' || scenario === 'defeat') {
  await page.goto(base + `?play=1&unlock=1&sector=${process.env.SECTOR ?? '1'}`);
  await waitAssets();
  await page.waitForTimeout(800);
  await drag();
  await page.evaluate((auto) => window.__prism.fastForward(250, auto), scenario === 'result');
  await page.waitForTimeout(4500);
  console.log(scenario, await state());
  await shot(`r-${scenario}`);
  if (scenario === 'defeat') {
    await page.click('[data-testid=retry-btn]');
    await page.waitForTimeout(800);
    console.log('after retry', await state());
    await shot('r-retry');
  }
} else if (scenario === 'mid') {
  // jump to runway progress PROG (default 0.35) with autopilot, then capture real-time frames
  const sector = process.env.SECTOR ?? '1';
  const prog = Number(process.env.PROG ?? '0.35');
  await page.goto(base + `?play=1&unlock=1&sector=${sector}`);
  await waitAssets();
  await page.waitForTimeout(800);
  await drag();
  await page.evaluate((p) => {
    const g = window.__prism;
    g.autoplay = true;
    for (let i = 0; i < 400 && g.sim.getSnapshot().runwayProgress < p; i++) g.fastForward(0.5, true);
  }, prog);
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1200);
    console.log('mid', i, await state());
    await shot(`m${i}`);
  }
} else if (scenario === 'boss') {
  const sector = process.env.SECTOR ?? '1';
  await page.goto(base + `?play=1&unlock=1&sector=${sector}`);
  await waitAssets();
  await page.waitForTimeout(800);
  await drag();
  // jump to just before the boss, then watch in real time with autopilot
  await page.evaluate((skip) => {
    const g = window.__prism;
    for (let i = 0; i < 400 && g.sim.getSnapshot().runwayProgress < 0.94; i++) g.fastForward(0.5);
    if (skip !== null) {
      for (let i = 0; i < 80; i++) {
        const b = g.sim.getSnapshot().boss;
        if (b && b.introProgress >= 1) break;
        g.fastForward(0.5);
      }
      g.fastForward(Number(skip || 0));
    }
    g.autoplay = true;
  }, process.env.SKIPINTRO ?? null);
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1500);
    console.log('rt', i, await state());
    await shot(`b${i}`);
  }
} else {
  await page.goto(base);
  await waitAssets();
  await page.waitForTimeout(2000);
  await shot('01-title');
  await page.click('[data-testid=start-btn]');
  await page.waitForTimeout(600);
  await shot('02-ready');
  await drag();
  await page.waitForTimeout(1500);
  await shot('03-play');
  await page.evaluate(() => (window.__prism.autoplay = true));
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(2500);
    console.log('rt', i, await state());
    await shot(`04-rt${i}`);
  }
  await page.evaluate(() => window.__prism.fastForward(200));
  await page.waitForTimeout(4500);
  console.log('result', await state());
  await shot('13-result');
}
console.log(logs.filter((l) => !l.includes('[vite]')).slice(0, 30).join('\n'));
await browser.close();
