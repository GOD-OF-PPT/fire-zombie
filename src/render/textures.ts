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

/** Paints a gate's holographic number plate with high-contrast chamfered glass, scanlines, and crisp typography. */
export function paintGatePlate(ctx: CanvasRenderingContext2D, w: number, h: number, g: GateSnapshot): void {
  ctx.clearRect(0, 0, w, h);
  const { main, dark } = gateColors(g);
  const pad = 14;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, dark);
  grad.addColorStop(0.55, 'rgba(4,12,24,0.88)');
  grad.addColorStop(1, 'rgba(0,0,0,0.92)');
  roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, 32);
  ctx.globalAlpha = g.dimmed ? 0.35 : 0.9;
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.globalAlpha = g.dimmed ? 0.4 : 1;
  ctx.lineWidth = 6;
  ctx.strokeStyle = main;
  ctx.stroke();

  // Inner holographic bezel, diagonal specular reflection & telemetry header
  ctx.save();
  roundRect(ctx, pad + 8, pad + 8, w - pad * 2 - 16, h - pad * 2 - 16, 24);
  ctx.clip();
  const glass = ctx.createLinearGradient(0, 0, w * 0.85, h);
  glass.addColorStop(0, 'rgba(220,255,255,0.2)');
  glass.addColorStop(0.38, 'rgba(220,255,255,0.03)');
  glass.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  glass.addColorStop(0.62, 'rgba(0,0,0,0)');
  glass.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = glass;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(195,255,245,0.05)';
  for (let y = 22; y < h - 18; y += 6) ctx.fillRect(pad, y, w - pad * 2, 1.5);

  ctx.strokeStyle = main;
  ctx.globalAlpha = g.dimmed ? 0.25 : 0.45;
  ctx.lineWidth = 2;
  ctx.strokeRect(pad + 14, pad + 14, w - pad * 2 - 28, h - pad * 2 - 28);

  ctx.globalAlpha = g.dimmed ? 0.35 : 0.92;
  ctx.font = '800 15px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = g.mutable ? COLORS.gold : main;
  ctx.fillText(g.mutable ? '◈ TARGETABLE // SHOOT TO BOOST' : '◈ SWARM GATE // FIXED', 36, 44);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(215,245,255,0.65)';
  ctx.fillText('PRISM-V5', w - 36, 44);
  ctx.restore();

  if (g.mutable) {
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = 15;
    ctx.lineCap = 'round';
    const L = 62;
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
    ctx.lineCap = 'butt';
  }

  const isLock = g.lockHp > 0;
  const label = g.label;
  let fontSize = label.length >= 3 ? 152 : 174;
  ctx.font = `900 ${fontSize}px ${FONT}`;
  while (ctx.measureText(label).width > w - 150 && fontSize > 80) {
    fontSize -= 8;
    ctx.font = `900 ${fontSize}px ${FONT}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cy = g.mutable ? h * 0.44 : h * 0.52;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 20;
  ctx.strokeStyle = 'rgba(0,0,0,0.94)';
  ctx.strokeText(label, w / 2 + (isLock ? 34 : 0), cy);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, w / 2 + (isLock ? 34 : 0), cy);

  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = main;
  ctx.globalAlpha = 0.36;
  ctx.fillRect(0, cy + fontSize * 0.08, w, fontSize * 0.5);
  ctx.restore();

  if (!isLock && g.polarity !== 'neutral') {
    ctx.fillStyle = main;
    ctx.globalAlpha = g.dimmed ? 0.4 : 1;
    const ax = 58;
    const ay = cy;
    ctx.beginPath();
    if (g.polarity === 'positive') {
      ctx.moveTo(ax, ay - 32); ctx.lineTo(ax + 27, ay + 18); ctx.lineTo(ax - 27, ay + 18);
    } else {
      ctx.moveTo(ax, ay + 32); ctx.lineTo(ax + 27, ay - 18); ctx.lineTo(ax - 27, ay - 18);
    }
    ctx.closePath();
    ctx.fill();
  }

  if (isLock) {
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
    ctx.fillStyle = '#1d1200';
    ctx.beginPath();
    ctx.arc(lx, ly + 8, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(lx - 4, ly + 12, 8, 14);
  }

  if (g.mutable) {
    const bx = 66;
    const bw = w - 132;
    const by = h - 68;
    const bh = 24;
    roundRect(ctx, bx, by, bw, bh, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,197,49,0.5)';
    ctx.stroke();
    const ratio = isLock ? 1 - g.lockHp / Math.max(1, g.maxLockHp) : g.chargeRatio;
    if (ratio > 0) {
      const barGrad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      barGrad.addColorStop(0, '#ffb21a');
      barGrad.addColorStop(1, '#fff38a');
      roundRect(ctx, bx + 2, by + 2, Math.max(20, (bw - 4) * ratio), bh - 4, 10);
      ctx.fillStyle = barGrad;
      ctx.fill();
    }
    ctx.font = `900 29px ${FONT}`;
    ctx.fillStyle = COLORS.gold;
    ctx.textAlign = 'center';
    ctx.fillText(isLock ? `破锁 (${Math.ceil(g.lockHp)}) → ×2` : '▲ 射击充能升阶 ▲', w / 2, by - 22);
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
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, 'rgba(18,10,46,0.92)');
  bg.addColorStop(1, 'rgba(6,8,24,0.95)');
  roundRect(ctx, 8, 8, w - 16, h - 16, 26);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = meta.color;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 62px ${FONT}`;
  ctx.fillStyle = meta.color;
  ctx.fillText(meta.glyph, 68, 70);
  ctx.textAlign = 'left';
  ctx.font = `900 42px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText(meta.name, 120, 52);
  ctx.font = `800 27px ${FONT}`;
  ctx.fillStyle = meta.color;
  ctx.fillText(`${meta.short}武装 · 射击解锁`, 122, 95);
  const bx = 28;
  const bw = w - 56;
  const by = h - 60;
  roundRect(ctx, bx, by, bw, 34, 17);
  ctx.fillStyle = 'rgba(0,0,0,0.84)';
  ctx.fill();
  const r = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  if (r > 0) {
    roundRect(ctx, bx, by, Math.max(34, bw * r), 34, 17);
    ctx.fillStyle = meta.color;
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.font = `900 29px ${FONT}`;
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000';
  ctx.strokeText(String(Math.ceil(hp)), w / 2, by + 18);
  ctx.fillStyle = '#fff';
  ctx.fillText(String(Math.ceil(hp)), w / 2, by + 18);
}

export function paintLensPlate(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, 'rgba(65,42,0,0.86)');
  bg.addColorStop(1, 'rgba(28,16,0,0.9)');
  roundRect(ctx, 6, 6, w - 12, h - 12, 22);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = COLORS.gold;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 50px ${FONT}`;
  ctx.fillStyle = '#fff5cc';
  ctx.fillText('✦ 棱镜 ×2 增幅', w / 2, h / 2 + 2);
}

/** Paints holographic signboards for V5 runway tactical set-pieces (Jump Pad, 45° Reflector, Contract Wall). */
export function paintSetPiecePlate(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  kind: 'jump' | 'reflector' | 'bounty',
): void {
  ctx.clearRect(0, 0, w, h);
  const cfg =
    kind === 'jump'
      ? { c1: 'rgba(6,44,62,0.9)', c2: 'rgba(4,16,32,0.94)', stroke: '#3ef3ff', text: '▲ 跃空跳台 · 震地清场' }
      : kind === 'reflector'
        ? { c1: 'rgba(8,46,36,0.9)', c2: 'rgba(4,18,24,0.94)', stroke: '#7dff6b', text: '◈ 45° 折射镜 · ×1.45' }
        : { c1: 'rgba(58,28,4,0.92)', c2: 'rgba(26,8,16,0.95)', stroke: '#ffc531', text: '★ 死斗悬赏 · 破甲大奖' };
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, cfg.c1);
  bg.addColorStop(1, cfg.c2);
  roundRect(ctx, 6, 6, w - 12, h - 12, 22);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = cfg.stroke;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 38px ${FONT}`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#000';
  ctx.strokeText(cfg.text, w / 2, h / 2 + 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(cfg.text, w / 2, h / 2 + 2);
}

/** Paints the Boss's Giant Numbered Doom-Orb counter-parry plate (-18 -> +1 反击破核!). */
export function paintDoomOrbPlate(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  value: number,
  chargeRatio: number,
  reflected: boolean,
): void {
  ctx.clearRect(0, 0, w, h);
  const border = reflected ? '#19f5a8' : '#ff3b5c';
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, reflected ? 'rgba(6,58,38,0.94)' : 'rgba(68,6,26,0.94)');
  bg.addColorStop(1, 'rgba(6,8,20,0.96)');
  roundRect(ctx, 8, 8, w - 16, h - 16, 26);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = reflected ? COLORS.gold : border;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 24px ${FONT}`;
  ctx.fillStyle = reflected ? '#9fffe0' : '#ffd84a';
  ctx.fillText(reflected ? '⚡ 逆转反击 · 轰击首领！' : '⚠ 湮灭棱球 · 集火转正反击', w / 2, 34);

  const label = value > 0 ? `+${value}` : String(value);
  ctx.font = `900 94px ${FONT}`;
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#000';
  ctx.strokeText(label, w / 2, 102);
  ctx.fillStyle = reflected ? '#19f5a8' : '#ffffff';
  ctx.fillText(label, w / 2, 102);

  if (!reflected) {
    const bx = 34;
    const bw = w - 68;
    const by = h - 34;
    roundRect(ctx, bx, by, bw, 16, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fill();
    const prog = Math.max(0, Math.min(1, (20 + value + chargeRatio) / 20));
    if (prog > 0) {
      roundRect(ctx, bx + 2, by + 2, Math.max(12, (bw - 4) * prog), 12, 6);
      ctx.fillStyle = COLORS.gold;
      ctx.fill();
    }
  }
}

/** High-detail 1024×1024 stylized cyberpunk skybox with aurora nebula, ringed cyber-planet, and horizon spires. */
export function makeSkyTexture(stops: [string, string, string]): THREE.CanvasTexture {
  const { ctx, tex, canvas } = makeCanvasTexture(1024, 1024);
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.54, stops[1]);
  g.addColorStop(0.86, stops[2]);
  g.addColorStop(1, stops[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let band = 0; band < 3; band++) {
    const ag = ctx.createLinearGradient(120 + band * 210, 40, 880 - band * 120, 560);
    ag.addColorStop(0, 'rgba(0,0,0,0)');
    ag.addColorStop(0.45, band === 1 ? 'rgba(255,140,240,0.11)' : 'rgba(90,235,255,0.13)');
    ag.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ag;
    ctx.beginPath();
    ctx.ellipse(512 + (band - 1) * 180, 290 + band * 55, 480, 95, -0.22 + band * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  let seed = 73;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 320; i++) {
    const sx = rnd() * 1024;
    const sy = rnd() * 680;
    const sr = 0.6 + rnd() * (i % 19 === 0 ? 2.4 : 1.2);
    ctx.fillStyle = i % 7 === 0 ? 'rgba(255,235,170,0.8)' : 'rgba(205,240,255,0.68)';
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  const mx = 710;
  const my = 212;
  const radius = 108;
  const halo = ctx.createRadialGradient(mx, my, radius * 0.65, mx, my, radius * 2.3);
  halo.addColorStop(0, 'rgba(145,225,255,0.28)');
  halo.addColorStop(0.5, 'rgba(120,185,255,0.09)');
  halo.addColorStop(1, 'rgba(120,185,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(mx - radius * 2.5, my - radius * 2.5, radius * 5, radius * 5);

  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(-0.32);
  ctx.strokeStyle = 'rgba(165,235,255,0.28)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 1.92, radius * 0.36, 0, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(mx, my, radius, 0, Math.PI * 2);
  ctx.clip();
  const moon = ctx.createRadialGradient(mx - 42, my - 40, 10, mx + 16, my + 20, radius * 1.3);
  moon.addColorStop(0, '#e0f4ff');
  moon.addColorStop(0.42, '#8db4d2');
  moon.addColorStop(0.76, '#334e78');
  moon.addColorStop(1, '#0e1f3d');
  ctx.fillStyle = moon;
  ctx.fillRect(mx - radius, my - radius, radius * 2, radius * 2);

  for (let i = 0; i < 140; i++) {
    const x = mx + (rnd() - 0.5) * radius * 2;
    const y = my + (rnd() - 0.5) * radius * 2;
    const r = 2 + rnd() * 16;
    ctx.fillStyle = i % 3 ? 'rgba(14,34,62,0.16)' : 'rgba(245,250,255,0.08)';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.68, -0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(98,244,255,0.38)';
  ctx.lineWidth = 1.6;
  for (let k = 0; k < 5; k++) {
    ctx.beginPath();
    ctx.arc(mx + 34, my + 26, 26 + k * 14, 0.2 + k * 0.3, 1.35 + k * 0.22);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(-0.32);
  ctx.strokeStyle = 'rgba(185,245,255,0.52)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 1.92, radius * 0.36, 0, 0, Math.PI);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,210,110,0.34)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 1.68, radius * 0.31, 0, 0, Math.PI);
  ctx.stroke();
  ctx.restore();

  const hg = ctx.createLinearGradient(0, 560, 0, 920);
  hg.addColorStop(0, 'rgba(160,235,255,0)');
  hg.addColorStop(0.55, 'rgba(150,220,255,0.16)');
  hg.addColorStop(1, 'rgba(10,18,40,0.45)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, 560, 1024, 360);

  ctx.fillStyle = 'rgba(8,16,38,0.42)';
  for (let x = 0; x < 1024; x += 28) {
    const sh = 35 + Math.floor(rnd() * 125);
    const sw = 16 + Math.floor(rnd() * 18);
    ctx.fillRect(x, 790 - sh, sw, sh + 240);
    if (sh > 95) {
      ctx.fillRect(x + sw * 0.44, 790 - sh - 34, 3, 34);
    }
  }

  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function makeGlowTexture(): THREE.CanvasTexture {
  const { ctx, tex } = makeCanvasTexture(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.58)');
  g.addColorStop(0.65, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function makeHexCommandTexture(): THREE.CanvasTexture {
  const { ctx, tex } = makeCanvasTexture(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.translate(128, 128);

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 5;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2 + 0.08;
    const a1 = ((i + 1) / 6) * Math.PI * 2 - 0.08;
    ctx.beginPath();
    ctx.arc(0, 0, 108, a0, a1);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * 82;
    const y = Math.sin(a) * 82;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.fillRect(92, -3, 12, 6);
    ctx.restore();
  }

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
