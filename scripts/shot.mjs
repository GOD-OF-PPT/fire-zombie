// Dev visual check (requires `npm run dev` on :5173 and Playwright Chromium):
//   node scripts/shot.mjs <outdir> [basic|boss|workshop]
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '/tmp/shots';
const scenario = process.argv[3] ?? 'basic';
const base = process.env.URL ?? 'http://localhost:5173/';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/usr/lib/chromium/chromium',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const shot = async (name) => page.screenshot({ path: `${out}/${name}.png` });
const state = () => page.evaluate(() => {
  const g = window.__prism;
  const s = g.sim.getSnapshot();
  return { state: g.state, phase: s.phase, squad: s.squadCount, prog: s.runwayProgress.toFixed(3), weapon: s.weapon + s.weaponLevel, boss: s.boss ? `${s.boss.phase}:${Math.round(s.boss.hp)}` : null, score: g.score };
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
  await page.evaluate(() => {
    localStorage.setItem('prism-swarm-save-v1', JSON.stringify({ unlocked: 2, records: { 1: { stars: 2, score: 5000, cleared: true } }, cores: 260, upgrades: { squad: 1, power: 0, reso: 0 } }));
  });
  await page.reload();
  await page.waitForTimeout(2000);
  await shot('w1-title');
  await page.click('[data-testid=workshop-btn]');
  await page.waitForTimeout(500);
  await shot('w2-workshop');
  await page.click('[data-testid=buy-power]');
  await page.waitForTimeout(300);
  await shot('w3-bought');
  console.log(await page.evaluate(() => localStorage.getItem('prism-swarm-save-v1')));
} else if (scenario === 'result' || scenario === 'defeat') {
  await page.goto(base + `?play=1&unlock=1&sector=${process.env.SECTOR ?? '1'}`);
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
} else if (scenario === 'boss') {
  const sector = process.env.SECTOR ?? '1';
  await page.goto(base + `?play=1&unlock=1&sector=${sector}`);
  await page.waitForTimeout(800);
  await drag();
  // jump to just before the boss, then watch in real time with autopilot
  await page.evaluate(() => {
    const g = window.__prism;
    for (let i = 0; i < 400 && g.sim.getSnapshot().runwayProgress < 0.94; i++) g.fastForward(0.5);
    g.autoplay = true;
  });
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(1500);
    console.log('rt', i, await state());
    await shot(`b${i}`);
  }
} else {
  await page.goto(base);
  await page.waitForTimeout(2500);
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
