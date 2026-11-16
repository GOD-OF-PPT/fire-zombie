import * as THREE from 'three';

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max > 0 ? d / max : 0, max];
}

function hsvToRgb(h: number, s: number, v: number, out: Float32Array): void {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  out[0] = r + m;
  out[1] = g + m;
  out[2] = b + m;
}

const isRust = (h: number, s: number, v: number): boolean => h >= 8 && h <= 48 && s >= 0.3 && v < 0.6;

/**
 * Re-grades the Stan mech atlas (teal / grey / orange panels with rust decals) into the squad palette:
 * teal -> cyan armour, greys -> cool steel/navy, orange trim -> gold, rust painted out from neighbours.
 * Swaps the texture's image in place so every clone sharing the template texture picks it up.
 */
export function regradeMechTexture(tex: THREE.Texture): boolean {
  const src = tex.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (typeof document === 'undefined' || !src || !src.width || !src.height) return false;
  const w = src.width;
  const h = src.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const n = w * h;

  // 1. Paint out rust: repeatedly fill masked pixels with the mean of their already-clean neighbours
  const rgb = new Float32Array(n * 3);
  const mask = new Uint8Array(n);
  let pending: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = px[i * 4]! / 255;
    const g = px[i * 4 + 1]! / 255;
    const b = px[i * 4 + 2]! / 255;
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
    const [hh, ss, vv] = rgbToHsv(r, g, b);
    if (isRust(hh, ss, vv)) {
      mask[i] = 1;
      pending.push(i);
    }
  }
  for (let pass = 0; pass < 32 && pending.length > 0; pass++) {
    const filled: Array<[number, number, number, number]> = [];
    const still: number[] = [];
    for (const i of pending) {
      const x = i % w;
      const y = (i - x) / w;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j]) continue;
          sr += rgb[j * 3]!;
          sg += rgb[j * 3 + 1]!;
          sb += rgb[j * 3 + 2]!;
          c++;
        }
      }
      if (c > 0) filled.push([i, sr / c, sg / c, sb / c]);
      else still.push(i);
    }
    for (const [i, r, g, b] of filled) {
      rgb[i * 3] = r;
      rgb[i * 3 + 1] = g;
      rgb[i * 3 + 2] = b;
      mask[i] = 0;
    }
    pending = still;
  }

  // 2. Hue-family remap into the squad palette
  const o = new Float32Array(3);
  for (let i = 0; i < n; i++) {
    const [hh, ss, vv] = rgbToHsv(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!);
    if (hh >= 130 && hh <= 210 && ss > 0.22) {
      hsvToRgb(197, Math.min(1, ss * 1.1 + 0.12), Math.min(1, vv * 1.45 + 0.05), o);
    } else if (hh >= 12 && hh <= 50 && ss > 0.45) {
      hsvToRgb(44, 0.86, Math.min(1, vv * 1.15 + 0.1), o);
    } else {
      hsvToRgb(214, Math.min(0.45, 0.12 + (1 - vv) * 0.28), Math.min(1, 0.16 + vv * 0.98), o);
    }
    px[i * 4] = Math.round(o[0]! * 255);
    px[i * 4 + 1] = Math.round(o[1]! * 255);
    px[i * 4 + 2] = Math.round(o[2]! * 255);
  }
  ctx.putImageData(img, 0, 0);

  if (typeof (src as ImageBitmap).close === 'function') (src as ImageBitmap).close();
  tex.image = canvas;
  tex.needsUpdate = true;
  return true;
}
