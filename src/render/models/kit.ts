import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Tiny procedural modelling kit.
 * Every part is baked into one non-indexed geometry with an RGBA vertex colour where
 * A = glow strength (read by the character material as emissive). One material can
 * therefore render armour, skin and neon lights in a single draw call.
 */

export type V3 = readonly [number, number, number];

export interface PartTf {
  p?: V3;
  r?: V3;
  s?: V3 | number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export function tfMatrix(tf: PartTf = {}): THREE.Matrix4 {
  const p = tf.p ?? [0, 0, 0];
  const r = tf.r ?? [0, 0, 0];
  const s = tf.s ?? 1;
  _e.set(r[0], r[1], r[2]);
  _q.setFromEuler(_e);
  _p.set(p[0], p[1], p[2]);
  if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  return _m.compose(_p, _q, _s);
}

export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];

  /** Adds a primitive with a colour and optional glow (0..~3). */
  add(geo: THREE.BufferGeometry, color: number, glow = 0, tf?: PartTf): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    if (g.getAttribute('uv1')) g.deleteAttribute('uv1');
    g.applyMatrix4(tfMatrix(tf));
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 4);
    _c.setHex(color);
    for (let i = 0; i < n; i++) {
      col[i * 4] = _c.r;
      col[i * 4 + 1] = _c.g;
      col[i * 4 + 2] = _c.b;
      col[i * 4 + 3] = glow;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    this.parts.push(g);
    return this;
  }

  /** Mirrors the last `count` parts across the X axis (for symmetric limbs/details). */
  mirrorLast(count = 1): this {
    const src = this.parts.slice(-count);
    for (const g of src) {
      const m = g.clone();
      m.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
      // flip winding so faces stay outward
      const pos = m.getAttribute('position') as THREE.BufferAttribute;
      const nor = m.getAttribute('normal') as THREE.BufferAttribute;
      const col = m.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 3) {
        for (const a of [pos, nor, col]) {
          for (let k = 0; k < a.itemSize; k++) {
            const t = a.array[(i + 1) * a.itemSize + k]!;
            (a.array as Float32Array)[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k]!;
            (a.array as Float32Array)[(i + 2) * a.itemSize + k] = t;
          }
        }
      }
      this.parts.push(m);
    }
    return this;
  }

  /** Merges all parts. `pivot` is subtracted so the part rotates around it. */
  build(pivot: V3 = [0, 0, 0]): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error('GeoBuilder: merge failed');
    merged.translate(-pivot[0], -pivot[1], -pivot[2]);
    merged.computeBoundingSphere();
    return merged;
  }
}

// ------------------------------------------------------------------ primitive shortcuts
export const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
export const sph = (r: number, w = 12, h = 8): THREE.BufferGeometry => new THREE.SphereGeometry(r, w, h);
export const cyl = (rt: number, rb: number, h: number, seg = 10): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rt, rb, h, seg);
export const cone = (r: number, h: number, seg = 8): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, seg);
export const ico = (r: number, detail = 0): THREE.BufferGeometry => new THREE.IcosahedronGeometry(r, detail);
export const oct = (r: number): THREE.BufferGeometry => new THREE.OctahedronGeometry(r, 0);
export const tor = (r: number, t: number, rs = 6, ts = 16, arc = Math.PI * 2): THREE.BufferGeometry =>
  new THREE.TorusGeometry(r, t, rs, ts, arc);
export const capsule = (r: number, len: number, cap = 4, rad = 8): THREE.BufferGeometry =>
  new THREE.CapsuleGeometry(r, len, cap, rad);

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** A tapered cylinder spanning two points (for limbs, tentacles, necks). */
export function limb(from: V3, to: V3, rFrom: number, rTo = rFrom, seg = 7): { geo: THREE.BufferGeometry; tf: PartTf } {
  _a.set(...from);
  _b.set(...to);
  _dir.subVectors(_b, _a);
  const len = _dir.length();
  const geo = new THREE.CylinderGeometry(rTo, rFrom, len, seg);
  _q.setFromUnitVectors(_up, _dir.normalize());
  _e.setFromQuaternion(_q);
  const mid: V3 = [(_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2];
  return { geo, tf: { p: mid, r: [_e.x, _e.y, _e.z] } };
}

/** Convenience: add a limb segment (plus a joint ball at `from`). */
export function addLimb(b: GeoBuilder, from: V3, to: V3, r0: number, r1: number, color: number, glow = 0, ball = true): void {
  const l = limb(from, to, r0, r1);
  b.add(l.geo, color, glow, l.tf);
  if (ball) b.add(sph(r0 * 1.08, 8, 6), color, glow, { p: from });
}
