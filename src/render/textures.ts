import * as THREE from 'three';
import type { GateSnapshot, RewardId } from '../types/game';
import { REWARD_META } from '../app/meta';

export const COLORS = {
  positive: '#19f5a8',
  positiveDark: '#03362a',
  negative: '#ff3b5c',
  negativeDark: '#45061a',
  neutral: '#c3ccd8',
  neutralDark: '#232b38',
  gold: '#ffc531',
};

const FONT = `'Arial Black', 'Segoe UI Black', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif`;

export function makeCanvasTexture(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return { canvas, ctx, tex };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function gateColors(g: Pick<GateSnapshot, 'polarity'>): { main: string; dark: string } {
  if (g.polarity === 'positive') return { main: COLORS.positive, dark: COLORS.positiveDark };
  if (g.polarity === 'negative') return { main: COLORS.negative, dark: COLORS.negativeDark };
  return { main: COLORS.neutral, dark: COLORS.neutralDark };
}

export function gateTextureKey(g: GateSnapshot): string {
  return `${g.label}|${g.polarity}|${g.mutable ? 1 : 0}|${Math.round(g.chargeRatio * 20)}|${Math.ceil(g.lockHp)}|${g.dimmed ? 1 : 0}`;
}

/** Paints a gate's number plate. Text is drawn huge with a dark stroke so it stays readable while moving/scaling. */
export function paintGatePlate(ctx: CanvasRenderingContext2D, w: number, h: number, g: GateSnapshot): void {
  ctx.clearRect(0, 0, w, h);
  const { main, dark } = gateColors(g);
  const pad = 14;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, dark);
  grad.addColorStop(1, 'rgba(0,0,0,0.85)');
  roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, 34);
  ctx.globalAlpha = g.dimmed ? 0.35 : 0.86;
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.globalAlpha = g.dimmed ? 0.4 : 1;
  ctx.lineWidth = 5;
  ctx.strokeStyle = main;
  ctx.stroke();

  // Instrument glass: inner bevel, scan lines and small engraved identification.
  ctx.save();
  roundRect(ctx, pad + 8, pad + 8, w - pad * 2 - 16, h - pad * 2 - 16, 26);
  ctx.clip();
  const glass = ctx.createLinearGradient(0, 0, w, h);
  glass.addColorStop(0, '#d8ffff26'); glass.addColorStop(0.45, '#d8ffff00'); glass.addColorStop(1, '#00000010');
  ctx.fillStyle = glass; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#bfffea0b';
  for (let y = 24; y < h - 20; y += 7) ctx.fillRect(pad, y, w - pad * 2, 1);
  ctx.font = '700 15px monospace'; ctx.textAlign = 'left'; ctx.fillStyle = main;
  ctx.fillText(g.mutable ? 'CHARGE // MODIFY' : 'SWARM // TRANSFER', 40, 46);
  ctx.textAlign = 'right'; ctx.fillStyle = '#c8e0da88'; ctx.fillText('PR-07', w - 40, 46);
  ctx.restore();

  // Mutable gates: gold target brackets = "shoot me"
  if (g.mutable) {
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = 14;
    const L = 58;
    const x0 = pad - 2;
    const y0 = pad - 2;
    const x1 = w - pad + 2;
    const y1 = h - pad + 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + L); ctx.lineTo(x0, y0); ctx.lineTo(x0 + L, y0);
    ctx.moveTo(x1 - L, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + L);
    ctx.moveTo(x0, y1 - L); ctx.lineTo(x0, y1); ctx.lineTo(x0 + L, y1);
    ctx.moveTo(x1 - L, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 - L);
    ctx.stroke();
  }

  // Main label
  const isLock = g.lockHp > 0;
  const label = g.label;
  let fontSize = label.length >= 3 ? 150 : 172;
  ctx.font = `900 ${fontSize}px ${FONT}`;
  while (ctx.measureText(label).width > w - 150 && fontSize > 80) {
    fontSize -= 8;
    ctx.font = `900 ${fontSize}px ${FONT}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cy = g.mutable ? h * 0.44 : h * 0.5;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 18;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.strokeText(label, w / 2 + (isLock ? 34 : 0), cy);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, w / 2 + (isLock ? 34 : 0), cy);
  // tinted top highlight
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = main;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(0, cy + fontSize * 0.08, w, fontSize * 0.5);
  ctx.restore();

  // Arrow glyph
  if (!isLock && g.polarity !== 'neutral') {
    ctx.fillStyle = main;
    ctx.globalAlpha = g.dimmed ? 0.4 : 1;
    const ax = 58;
    const ay = cy;
    ctx.beginPath();
    if (g.polarity === 'positive') {
      ctx.moveTo(ax, ay - 30); ctx.lineTo(ax + 26, ay + 18); ctx.lineTo(ax - 26, ay + 18);
    } else {
      ctx.moveTo(ax, ay + 30); ctx.lineTo(ax + 26, ay - 18); ctx.lineTo(ax - 26, ay - 18);
    }
    ctx.closePath();
    ctx.fill();
  }

  if (isLock) {
    // padlock
    const lx = 92;
    const ly = cy;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(lx, ly - 16, 22, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = COLORS.gold;
    roundRect(ctx, lx - 34, ly - 14, 68, 54, 10);
    ctx.fill();
  }

  if (g.mutable) {
    // charge / lock bar
    const bx = 70;
    const bw = w - 140;
    const by = h - 70;
    const bh = 22;
    roundRect(ctx, bx, by, bw, bh, 11);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fill();
    const ratio = isLock ? 1 - g.lockHp / Math.max(1, g.maxLockHp) : g.chargeRatio;
    if (ratio > 0) {
      roundRect(ctx, bx, by, Math.max(22, bw * ratio), bh, 11);
      ctx.fillStyle = COLORS.gold;
      ctx.fill();
    }
    ctx.font = `800 30px ${FONT}`;
    ctx.fillStyle = COLORS.gold;
    ctx.textAlign = 'center';
    ctx.fillText(isLock ? `破锁 → ×2` : '射击提升 ▲', w / 2, by - 24);
  }
  ctx.globalAlpha = 1;
}

export function paintVaultPlate(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  reward: RewardId,
  hp: number,
  maxHp: number,
): void {
  const meta = REWARD_META[reward];
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 8, 8, w - 16, h - 16, 26);
  ctx.fillStyle = 'rgba(20,6,40,0.88)';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = meta.color;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 64px ${FONT}`;
  ctx.fillStyle = meta.color;
  ctx.fillText(meta.glyph, 70, 74);
  ctx.textAlign = 'left';
  ctx.font = `900 44px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText(meta.name, 122, 56);
  ctx.font = `800 30px ${FONT}`;
  ctx.fillStyle = meta.color;
  ctx.fillText(meta.short + ' 升级', 124, 100);
  // HP bar
  const bx = 30;
  const bw = w - 60;
  const by = h - 62;
  roundRect(ctx, bx, by, bw, 34, 17);
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fill();
  const r = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  if (r > 0) {
    roundRect(ctx, bx, by, Math.max(34, bw * r), 34, 17);
    ctx.fillStyle = meta.color;
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.font = `900 30px ${FONT}`;
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000';
  ctx.strokeText(String(Math.ceil(hp)), w / 2, by + 18);
  ctx.fillStyle = '#fff';
  ctx.fillText(String(Math.ceil(hp)), w / 2, by + 18);
}

export function paintLensPlate(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 6, 6, w - 12, h - 12, 22);
  ctx.fillStyle = 'rgba(60,40,0,0.7)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = COLORS.gold;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 56px ${FONT}`;
  ctx.fillStyle = '#fff3c4';
  ctx.fillText('✦ ×2 分裂', w / 2, h / 2 + 2);
}

export function makeSkyTexture(stops: [string, string, string]): THREE.CanvasTexture {
  const { ctx, tex, canvas } = makeCanvasTexture(512, 1024);
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.62, stops[1]);
  g.addColorStop(1, stops[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const haze = ctx.createRadialGradient(420, 425, 4, 420, 425, 380);
  haze.addColorStop(0, '#859ecf22'); haze.addColorStop(0.5, '#8099bf0b'); haze.addColorStop(1, '#8099bf00');
  ctx.fillStyle = haze; ctx.fillRect(0, 0, 768, 1024);
  const mx = 345; const my = 188; const radius = 58;
  const halo = ctx.createRadialGradient(mx, my, radius * 0.7, mx, my, radius * 1.8);
  halo.addColorStop(0, '#8bc9ed22'); halo.addColorStop(0.5, '#8bc9ed0c'); halo.addColorStop(1, '#8bc9ed00');
  ctx.fillStyle = halo; ctx.fillRect(mx - radius * 2, my - radius * 2, radius * 4, radius * 4);
  ctx.save(); ctx.beginPath(); ctx.arc(mx, my, radius, 0, Math.PI * 2); ctx.clip();
  const moon = ctx.createRadialGradient(mx - 24, my - 23, 5, mx + 8, my + 10, radius * 1.25);
  moon.addColorStop(0, '#c9d9d6'); moon.addColorStop(0.45, '#8ba5b7'); moon.addColorStop(0.78, '#3c5679'); moon.addColorStop(1, '#13294b');
  ctx.fillStyle = moon; ctx.fillRect(mx - radius, my - radius, radius * 2, radius * 2);
  let seed = 47;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 190; i++) {
    const x = mx + (rnd() - 0.5) * radius * 2;
    const y = my + (rnd() - 0.5) * radius * 2;
    const r = 1 + rnd() * 10;
    ctx.fillStyle = i % 3 ? '#132b4210' : '#f5f2d40b';
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.65, -0.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = '#acdbf822'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(mx, my, radius * 1.7, radius * 0.33, -0.33, 0, Math.PI * 2); ctx.stroke();
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function makeGlowTexture(): THREE.CanvasTexture {
  const { ctx, tex } = makeCanvasTexture(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function makeStripeTexture(): THREE.CanvasTexture {
  const { ctx, tex } = makeCanvasTexture(128, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.0)';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  for (let i = -128; i < 256; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 16, 0);
    ctx.lineTo(i + 16 + 128, 128);
    ctx.lineTo(i + 128, 128);
    ctx.closePath();
    ctx.fill();
  }
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
