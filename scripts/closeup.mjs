// Close-up model inspection against the dev server (npm run dev on :5173):
//   node scripts/closeup.mjs <outdir> [subject,...]
// Subjects: trooper heavy mech crawler dasher bastion mitosis siphon warden hydra omega
// Each subject is rendered from the gameplay angle (back), the front and the side.
// GPU=1 uses the host GPU (much faster than SwiftShader when available); BLOCK_GLB=1 shows the
// procedural fallback models.
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'shots';
const only = process.argv[3]?.split(',');
const base = process.env.URL ?? 'http://localhost:5173/';
const SYSTEM_CHROMIUM = '/usr/lib/chromium/chromium';
const gpu = process.env.GPU === '1';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? (fs.existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined),
  args: gpu
    ? ['--enable-gpu', '--ignore-gpu-blocklist']
    : ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const size = Number(process.env.SIZE ?? '540');
const ctx = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
if (process.env.BLOCK_GLB === '1') await page.route('**/*.glb', (route) => route.abort());

await page.goto(base + '?play=1&unlock=1&sector=1');
await page.waitForFunction(() => window.__prism?.renderer?.assetsReady);
await page.evaluate(() => window.__prism.renderer.assetsReady);
await page.waitForTimeout(500);

const gl = await page.evaluate(() => {
  const r = window.__prism.renderer.renderer;
  const c = r.getContext();
  const ext = c.getExtension('WEBGL_debug_renderer_info');
  return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('GL renderer:', gl);

await page.evaluate(() => {
  const g = window.__prism;
  const R = g.renderer;
  g.stop();
  document.querySelector('#ui-root').style.display = 'none';
  // Square stage so wide subjects (bosses, side views) fit; the ResizeObserver re-syncs the renderer
  document.querySelector('#app').style.maxWidth = 'none';
  const keep = new Set([R.trackMat, R.groundMat]);
  for (const c of R.scene.children) {
    c.visible = Boolean(c.isLight) || keep.has(c.material);
  }
  const bossIds = { warden: 'warden_01', hydra: 'hydra_02', omega: 'omega_zero' };
  const heroTier = { trooper: 0, heavy: 1, mech: 2 };
  let shown = [];
  window.__closeup = {
    show(name, clip, t) {
      for (const o of shown) o.visible = false;
      shown = [];
      let actor;
      let root;
      if (name in heroTier) {
        actor = R.squadPools[heroTier[name]][0];
        root = actor.root;
      } else if (name in bossIds) {
        const v = R.bossViews.get(bossIds[name]);
        actor = v.primary;
        root = v.root;
        v.shield.visible = false;
      } else {
        actor = R.enemyPools[name][0];
        root = actor.root;
      }
      root.visible = true;
      root.position.set(0, 0, 0);
      root.rotation.set(0, 0, 0);
      root.scale.setScalar(1);
      shown.push(root);
      actor.mixer.stopAllAction();
      actor.activeClip = '';
      const clips = [...actor.actions.keys()];
      actor.play(clip && actor.actions.has(clip) ? clip : clips[0], { fade: 0 });
      actor.mixer.setTime(t ?? 0.3);
      actor.setVisuals(0, 1, 1, 1);
      this.root = root;
      return { clips, playing: actor.activeClip };
    },
    render(view, h) {
      const cam = R.camera;
      cam.fov = 40;
      cam.updateProjectionMatrix();
      const d = h * 1.9;
      const cy = h * 0.5;
      this.root.rotation.y = view === 'front' ? Math.PI : view === 'side' ? -Math.PI / 2 : 0;
      // Gameplay camera sits behind and above the squad (~46 deg elevation from the player's feet)
      if (view === 'game') cam.position.set(0, cy + 0.727 * d, 0.686 * d);
      else cam.position.set(0, cy + 0.25 * d, d);
      cam.lookAt(0, cy, 0);
      cam.updateMatrixWorld();
      R.scene.updateMatrixWorld(true);
      R.renderer.info.autoReset = true;
      if (R.composer) R.composer.render();
      else R.renderer.render(R.scene, cam);
    },
  };
});
await page.waitForTimeout(200);

// Heroes face -Z in-game (backs to the camera); monsters face +Z (toward the squad).
const SUBJECTS = [
  { name: 'trooper', h: 1.38, clip: 'Run_Shoot', hero: true },
  { name: 'heavy', h: 1.72, clip: 'Run_Shoot', hero: true },
  { name: 'mech', h: 2.08, clip: 'Run', hero: true },
  { name: 'crawler', h: 1.28, clip: 'Walk' },
  { name: 'dasher', h: 1.72, clip: 'Run' },
  { name: 'bastion', h: 2.75, clip: 'Walk' },
  { name: 'mitosis', h: 1.78, clip: 'Walk' },
  { name: 'siphon', h: 2.4, clip: 'Flying_Idle' },
  { name: 'warden', h: 4.9, clip: 'Fast_Flying' },
  { name: 'hydra', h: 5.1, clip: 'Fast_Flying' },
  { name: 'omega', h: 5.2, clip: 'Idle' },
];
const extra = process.env.CLIP;
for (const s of SUBJECTS) {
  if (only && !only.includes(s.name)) continue;
  const info = await page.evaluate(([n, c]) => window.__closeup.show(n, c, 0.3), [s.name, extra ?? s.clip]);
  console.log(s.name, JSON.stringify(info));
  // Hero templates already include facingYaw=PI, so the "game" view (camera at +Z) sees the back.
  const views = s.hero ? ['game', 'front', 'side'] : ['front', 'side'];
  for (const v of views) {
    // For monsters the default orientation already faces the camera (+Z), so swap labels.
    const rot = s.hero ? v : v === 'front' ? 'game' : v;
    await page.evaluate(([vv, h]) => window.__closeup.render(vv, h), [rot, s.h]);
    await page.screenshot({ path: `${out}/${s.name}-${v}${extra ? '-' + extra : ''}.png` });
  }
}
console.log(logs.filter((l) => !l.includes('[vite]')).slice(0, 20).join('\n'));
await browser.close();
