import * as THREE from 'three';
import type { RewardId, WeaponId } from '../../types/game';
import { GeoBuilder, addLimb, box, capsule, cone, cyl, oct, sph, tor, type V3 } from './kit';
import type { RigPartDef } from './rig';

/**
 * The player's squad: 「棱镜战士」 (V2 High-Detail Chibi Sculpt).
 * Tier 1 = Cobalt-Cyan Vanguard Trooper, Tier 2 = Golden Heavy Captain, Tier 3 = Sovereign Assault Mech.
 * All face −Z (away from the camera) — reactor packs, thrusters, crests, and weapons read crisply at scale.
 */

const SUIT = 0x192548;
const SUIT_DARK = 0x0b1022;
const ARMOR = 0xeaf8ff;
const CYAN = 0x3ef3ff;
const GOLD = 0xffc531;
const GOLD_ARMOR = 0xfff2cc;

export const WEAPON_GLOW: Record<WeaponId, number> = {
  pulse: 0x3ef3ff,
  scatter: 0x7dff6b,
  rail: 0xc29bff,
  plasma: 0xff9a3c,
  cryo: 0x9fe6ff,
};

const along = (len: number, r: number, seg = 10): THREE.BufferGeometry => cyl(r, r, len, seg).rotateX(Math.PI / 2);

/** Weapon model in "hand space": grip at origin, barrel pointing −Z. ~0.5 units long at scale 1. */
export function buildWeaponGeo(weapon: WeaponId | 'blades', scale = 1): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const metal = 0x2c3858;
  const silver = 0xa8c2dc;
  const dark = 0x0f1428;
  const g = weapon === 'blades' ? GOLD : WEAPON_GLOW[weapon];
  switch (weapon) {
    case 'pulse':
      b.add(box(0.075, 0.095, 0.32), metal, 0, { p: [0, 0, -0.1] })
        .add(box(0.082, 0.032, 0.22), silver, 0, { p: [0, 0.036, -0.11] })
        .add(box(0.05, 0.1, 0.06), dark, 0, { p: [0, -0.07, 0.0], r: [0.3, 0, 0] })
        .add(along(0.18, 0.024), dark, 0, { p: [0, 0.015, -0.33] })
        .add(tor(0.032, 0.009, 5, 12), g, 2.5, { p: [0, 0.015, -0.34] })
        .add(box(0.078, 0.022, 0.22), g, 2.4, { p: [0, 0.052, -0.1] })
        .add(sph(0.033, 10, 8), g, 3, { p: [0, 0.015, -0.43] })
        .add(box(0.052, 0.052, 0.09), dark, 0, { p: [0, 0.075, -0.05] });
      break;
    case 'scatter':
      b.add(box(0.13, 0.105, 0.27), metal, 0, { p: [0, 0, -0.08] })
        .add(box(0.136, 0.03, 0.18), silver, 0, { p: [0, 0.04, -0.08] })
        .add(box(0.05, 0.1, 0.06), dark, 0, { p: [0, -0.07, 0.02], r: [0.3, 0, 0] });
      for (const x of [-0.042, 0, 0.042]) {
        b.add(along(0.16, 0.023), dark, 0, { p: [x, 0.015, -0.28] });
      }
      b.add(box(0.16, 0.035, 0.035), g, 2.8, { p: [0, 0.015, -0.36] })
        .add(box(0.135, 0.022, 0.17), g, 1.8, { p: [0, 0.062, -0.08] });
      break;
    case 'rail':
      b.add(box(0.065, 0.088, 0.34), metal, 0, { p: [0, 0, -0.08] })
        .add(box(0.05, 0.1, 0.06), dark, 0, { p: [0, -0.07, 0.02], r: [0.3, 0, 0] })
        .add(along(0.45, 0.019), silver, 0, { p: [0, 0.012, -0.45] })
        .add(along(0.14, 0.03), dark, 0, { p: [0, 0.08, -0.1] });
      for (let i = 0; i < 4; i++) {
        b.add(tor(0.038, 0.011, 5, 12), g, 2.8, { p: [0, 0.012, -0.3 - i * 0.095] });
      }
      b.add(oct(0.038), g, 3, { p: [0, 0.012, -0.68] });
      break;
    case 'plasma':
      b.add(along(0.48, 0.078, 12), metal, 0, { p: [0, 0.05, -0.12] })
        .add(tor(0.084, 0.022, 6, 14), silver, 0, { p: [0, 0.05, -0.35] })
        .add(tor(0.084, 0.022, 6, 14), dark, 0, { p: [0, 0.05, 0.09] })
        .add(sph(0.065, 12, 10), g, 3, { p: [0, 0.05, -0.36] })
        .add(box(0.05, 0.1, 0.06), dark, 0, { p: [0, -0.05, -0.05] })
        .add(box(0.024, 0.065, 0.3), g, 1.8, { p: [0.074, 0.05, -0.12] })
        .add(box(0.024, 0.065, 0.3), g, 1.8, { p: [-0.074, 0.05, -0.12] });
      break;
    case 'cryo':
      b.add(box(0.085, 0.095, 0.29), metal, 0, { p: [0, 0, -0.08] })
        .add(box(0.05, 0.1, 0.06), dark, 0, { p: [0, -0.07, 0.02], r: [0.3, 0, 0] })
        .add(cone(0.055, 0.16, 8).rotateX(-Math.PI / 2), silver, 0, { p: [0, 0.012, -0.3] })
        .add(along(0.2, 0.048, 10), g, 2.0, { p: [0, 0.095, -0.06] })
        .add(oct(0.042), 0xffffff, 3, { p: [0, 0.012, -0.39] });
      break;
    case 'blades':
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        b.add(cone(0.075, 0.38, 4).rotateZ(-Math.PI / 2), GOLD_ARMOR, 1.4, {
          p: [Math.cos(a) * 0.19, 0, Math.sin(a) * 0.19],
          r: [0, -a, 0],
        });
      }
      b.add(cyl(0.09, 0.09, 0.055, 12), GOLD, 2.6).add(oct(0.055), CYAN, 3, { p: [0, 0.05, 0] });
      break;
  }
  const geo = b.build();
  geo.scale(scale, scale, scale);
  return geo;
}

export interface SoldierModel {
  parts: RigPartDef[];
  weapons: Record<WeaponId, THREE.BufferGeometry>;
  /** muzzle position in rig space (for flash sprites) */
  muzzle: V3;
  scale: number;
  height: number;
}

function trooper(heavy: boolean): SoldierModel {
  const armor = heavy ? GOLD_ARMOR : ARMOR;
  const accent = heavy ? GOLD : CYAN;
  const subAccent = heavy ? 0xff7a2e : 0x2b7dff;
  const k = heavy ? 1.32 : 1;
  const hipY = 0.3;
  const legs = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    b.add(box(0.105, 0.16, 0.125), SUIT, 0, { p: [0, -0.07, 0] })
      .add(box(0.118, 0.078, 0.132), armor, 0, { p: [0, -0.158, -0.012] })
      .add(box(0.04, 0.032, 0.02), accent, 2.0, { p: [0, -0.158, -0.08] })
      .add(box(0.098, 0.1, 0.115), SUIT, 0, { p: [0, -0.22, 0] })
      .add(box(0.126, 0.074, 0.19), SUIT_DARK, 0, { p: [0, -0.275, -0.025] })
      .add(box(0.024, 0.024, 0.11), accent, 1.8, { p: [side * 0.058, -0.275, -0.03] });
    return b.build();
  };
  const body = new GeoBuilder();
  body
    .add(box(0.285, 0.265, 0.195), SUIT, 0, { p: [0, 0.14, 0] })
    .add(box(0.31, 0.16, 0.21), armor, 0, { p: [0, 0.205, -0.005] })
    .add(oct(0.046), accent, 2.8, { p: [0, 0.2, -0.112], s: [1, 1.15, 0.5] })
    .add(box(0.305, 0.052, 0.205), SUIT_DARK, 0, { p: [0, 0.03, 0] })
    .add(box(0.06, 0.038, 0.025), accent, 2.2, { p: [0, 0.03, -0.108] })
    // Detailed camera-facing reactor backpack + winglets
    .add(box(0.23, 0.23, 0.11), 0x21325c, 0, { p: [0, 0.185, 0.142] })
    .add(oct(0.045), accent, 2.8, { p: [0, 0.185, 0.202], s: [1, 1.3, 0.5] })
    .add(box(0.036, 0.16, 0.022), accent, 2.4, { p: [0.068, 0.185, 0.2] })
    .add(box(0.036, 0.16, 0.022), accent, 2.4, { p: [-0.068, 0.185, 0.2] })
    .add(box(0.09, 0.03, 0.07), armor, 0, { p: [0.145, 0.26, 0.15], r: [0, 0, -0.38] })
    .add(box(0.09, 0.03, 0.07), armor, 0, { p: [-0.145, 0.26, 0.15], r: [0, 0, 0.38] })
    .add(cyl(0.011, 0.014, 0.17, 6), SUIT_DARK, 0, { p: [0.085, 0.365, 0.15] })
    .add(sph(0.02, 8, 6), accent, 3, { p: [0.085, 0.46, 0.15] })
    // Layered shoulder pauldrons
    .add(sph(0.09, 12, 8), armor, 0, { p: [0.185, 0.272, 0], s: [1.15, 0.85, 1.12] })
    .add(sph(0.09, 12, 8), armor, 0, { p: [-0.185, 0.272, 0], s: [1.15, 0.85, 1.12] })
    .add(box(0.024, 0.024, 0.13), accent, 2.2, { p: [0.205, 0.315, 0] })
    .add(box(0.024, 0.024, 0.13), accent, 2.2, { p: [-0.205, 0.315, 0] });
  if (heavy) {
    body
      .add(cyl(0.048, 0.064, 0.17, 10), 0x3a3020, 0, { p: [0.075, 0.1, 0.215] })
      .add(cyl(0.048, 0.064, 0.17, 10), 0x3a3020, 0, { p: [-0.075, 0.1, 0.215] })
      .add(cone(0.052, 0.11, 8).rotateX(Math.PI), GOLD, 2.8, { p: [0.075, -0.025, 0.215] })
      .add(cone(0.052, 0.11, 8).rotateX(Math.PI), GOLD, 2.8, { p: [-0.075, -0.025, 0.215] })
      .add(box(0.135, 0.055, 0.17), armor, 0, { p: [0.215, 0.335, 0], r: [0, 0, -0.35] })
      .add(box(0.135, 0.055, 0.17), armor, 0, { p: [-0.215, 0.335, 0], r: [0, 0, 0.35] })
      .add(box(0.11, 0.02, 0.14), subAccent, 2.0, { p: [0.22, 0.365, 0], r: [0, 0, -0.35] })
      .add(box(0.11, 0.02, 0.14), subAccent, 2.0, { p: [-0.22, 0.365, 0], r: [0, 0, 0.35] });
  }
  const head = new GeoBuilder();
  const helmet = heavy ? 0xffa81a : 0x2c78ff;
  head
    .add(sph(0.162, 16, 12), helmet, 0, { p: [0, 0.115, 0] })
    .add(sph(0.135, 14, 10), armor, 0, { p: [0, 0.145, 0.025], s: [0.92, 0.85, 0.96] })
    .add(sph(0.164, 14, 10), SUIT_DARK, 0, { p: [0, 0.072, -0.02], s: [1, 0.55, 1] })
    .add(box(0.215, 0.066, 0.055), accent, 2.8, { p: [0, 0.105, -0.135] })
    .add(box(0.036, 0.038, 0.31), accent, 2.4, { p: [0, 0.278, 0.01] })
    .add(cyl(0.04, 0.04, 0.055, 10).rotateZ(Math.PI / 2), armor, 0, { p: [0.162, 0.105, 0] })
    .add(cyl(0.04, 0.04, 0.055, 10).rotateZ(Math.PI / 2), armor, 0, { p: [-0.162, 0.105, 0] })
    .add(cyl(0.024, 0.024, 0.062, 10).rotateZ(Math.PI / 2), accent, 2.4, { p: [0.165, 0.105, 0] })
    .add(cyl(0.024, 0.024, 0.062, 10).rotateZ(Math.PI / 2), accent, 2.4, { p: [-0.165, 0.105, 0] });
  if (heavy) {
    head
      .add(cone(0.055, 0.18, 6), GOLD, 1.8, { p: [0, 0.31, 0.04], r: [-0.38, 0, 0] })
      .add(tor(0.11, 0.014, 5, 16), GOLD, 2.4, { p: [0, 0.28, 0], r: [Math.PI / 2, 0, 0] });
  }
  const arms = new GeoBuilder();
  addLimb(arms, [0.18, 0, 0], [0.13, -0.12, -0.12], 0.046, 0.042, SUIT);
  addLimb(arms, [-0.18, 0, 0], [-0.02, -0.08, -0.22], 0.046, 0.042, SUIT);
  arms
    .add(sph(0.048, 8, 6), armor, 0, { p: [0.12, -0.12, -0.13] })
    .add(sph(0.048, 8, 6), armor, 0, { p: [-0.01, -0.08, -0.23] });
  const weapons = {} as Record<WeaponId, THREE.BufferGeometry>;
  for (const w of ['pulse', 'scatter', 'rail', 'plasma', 'cryo'] as WeaponId[]) {
    const g = buildWeaponGeo(w, 1);
    g.translate(0.08, -0.1, -0.12);
    weapons[w] = g;
  }
  const scaleAll = (geo: THREE.BufferGeometry): THREE.BufferGeometry => geo.scale(k, k, k);
  for (const w of Object.values(weapons)) scaleAll(w);
  return {
    parts: [
      { name: 'legL', geo: scaleAll(legs(1)), joint: [0.075 * k, hipY * k, 0] },
      { name: 'legR', geo: scaleAll(legs(-1)), joint: [-0.075 * k, hipY * k, 0] },
      { name: 'body', geo: scaleAll(body.build()), joint: [0, hipY * k, 0] },
      { name: 'head', geo: scaleAll(head.build()), joint: [0, 0.6 * k, 0] },
      { name: 'arms', geo: scaleAll(arms.build()), joint: [0, 0.53 * k, 0] },
      { name: 'gun', geo: weapons.pulse, joint: [0, 0.53 * k, 0] },
    ],
    weapons,
    muzzle: [0.08 * k, 0.45 * k, -0.62 * k],
    scale: k,
    height: 0.85 * k,
  };
}

function mech(): SoldierModel {
  const k = 1;
  const shell = 0xf4f8ff;
  const trim = 0x2c6dff;
  const frame = 0x1d2338;
  const legs = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [side * 0.05, -0.28, 0.1], 0.105, 0.085, frame);
    b.add(box(0.21, 0.23, 0.21), shell, 0, { p: [side * 0.03, -0.12, 0.02] })
      .add(box(0.18, 0.05, 0.22), trim, 0, { p: [side * 0.03, -0.22, 0.02] });
    addLimb(b, [side * 0.05, -0.28, 0.1], [side * 0.05, -0.56, -0.02], 0.085, 0.072, frame);
    b.add(box(0.17, 0.21, 0.17), shell, 0, { p: [side * 0.05, -0.42, 0.03] })
      .add(box(0.25, 0.085, 0.36), frame, 0, { p: [side * 0.05, -0.6, -0.04] })
      .add(box(0.045, 0.042, 0.22), CYAN, 2.4, { p: [side * 0.165, -0.6, -0.04] });
    return b.build();
  };
  const body = new GeoBuilder();
  body
    .add(box(0.62, 0.44, 0.52), shell, 0, { p: [0, 0.3, 0] })
    .add(box(0.56, 0.12, 0.54), trim, 0, { p: [0, 0.44, 0] })
    .add(box(0.64, 0.1, 0.54), frame, 0, { p: [0, 0.08, 0] })
    // Twin reactor backpack + shoulder missile pods
    .add(box(0.4, 0.3, 0.22), frame, 0, { p: [0, 0.32, 0.33] })
    .add(oct(0.085), CYAN, 3, { p: [0, 0.32, 0.45], s: [1, 1.3, 0.5] })
    .add(cyl(0.075, 0.095, 0.24, 10), 0x2d3550, 0, { p: [0.135, 0.19, 0.43] })
    .add(cyl(0.075, 0.095, 0.24, 10), 0x2d3550, 0, { p: [-0.135, 0.19, 0.43] })
    .add(cone(0.085, 0.2, 10).rotateX(Math.PI), CYAN, 3, { p: [0.135, 0.0, 0.43] })
    .add(cone(0.085, 0.2, 10).rotateX(Math.PI), CYAN, 3, { p: [-0.135, 0.0, 0.43] })
    .add(box(0.24, 0.14, 0.32), shell, 0, { p: [0.42, 0.48, 0], r: [0, 0, -0.28] })
    .add(box(0.24, 0.14, 0.32), shell, 0, { p: [-0.42, 0.48, 0], r: [0, 0, 0.28] })
    .add(box(0.16, 0.14, 0.22), trim, 0, { p: [0.44, 0.6, 0.04] })
    .add(box(0.16, 0.14, 0.22), trim, 0, { p: [-0.44, 0.6, 0.04] })
    .add(box(0.035, 0.035, 0.32), GOLD, 2.6, { p: [0.49, 0.54, 0], r: [0, 0, -0.28] })
    .add(box(0.035, 0.035, 0.32), GOLD, 2.6, { p: [-0.49, 0.54, 0], r: [0, 0, 0.28] });
  const head = new GeoBuilder();
  head
    .add(sph(0.21, 16, 12), shell, 0, { s: [1.22, 0.82, 1.12], p: [0, 0.09, -0.05] })
    .add(sph(0.165, 14, 10), CYAN, 2.4, { s: [1.15, 0.6, 1], p: [0, 0.105, -0.145] })
    .add(cone(0.04, 0.32, 6), GOLD, 2.0, { p: [0.15, 0.31, 0.05], r: [-0.3, 0, -0.22] })
    .add(cone(0.04, 0.32, 6), GOLD, 2.0, { p: [-0.15, 0.31, 0.05], r: [-0.3, 0, 0.22] });
  const arms = new GeoBuilder();
  for (const s of [1, -1]) {
    addLimb(arms, [s * 0.41, 0, 0], [s * 0.47, -0.2, -0.12], 0.085, 0.075, frame);
    arms
      .add(box(0.21, 0.21, 0.38), shell, 0, { p: [s * 0.47, -0.24, -0.2] })
      .add(along(0.32, 0.052), frame, 0, { p: [s * 0.47, -0.24, -0.51] })
      .add(tor(0.06, 0.016, 5, 12), CYAN, 2.8, { p: [s * 0.47, -0.24, -0.64] });
  }
  const weapons = {} as Record<WeaponId, THREE.BufferGeometry>;
  for (const w of ['pulse', 'scatter', 'rail', 'plasma', 'cryo'] as WeaponId[]) {
    const g = buildWeaponGeo(w, 1.72);
    g.translate(0, 0.32, -0.15);
    weapons[w] = g;
  }
  return {
    parts: [
      { name: 'legL', geo: legs(1), joint: [0.24, 0.66, 0] },
      { name: 'legR', geo: legs(-1), joint: [-0.24, 0.66, 0] },
      { name: 'body', geo: body.build(), joint: [0, 0.66, 0] },
      { name: 'head', geo: head.build(), joint: [0, 1.2, -0.05] },
      { name: 'arms', geo: arms.build(), joint: [0, 1.06, 0] },
      { name: 'gun', geo: weapons.pulse, joint: [0, 1.06, 0] },
    ],
    weapons,
    muzzle: [0, 1.4, -1.3],
    scale: k,
    height: 1.55,
  };
}

export function buildSoldierModels(): SoldierModel[] {
  return [trooper(false), trooper(true), mech()];
}

/** Floating hologram model shown inside reward vaults. */
export function buildRewardDisplayGeo(reward: RewardId): THREE.BufferGeometry {
  if (reward === 'blades') return buildWeaponGeo('blades', 2.45);
  const g = buildWeaponGeo(reward, 2.65);
  g.center();
  return g;
}

/** Orbital Bit-Blade (6-wing plasma star shuriken). */
export function buildBladeGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add(cone(0.095, 0.52, 4).rotateZ(-Math.PI / 2), GOLD_ARMOR, 1.6, {
      p: [Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25],
      r: [0, -a + 0.22, 0],
      s: [1, 0.32, 1],
    });
  }
  b.add(tor(0.22, 0.025, 5, 18).rotateX(Math.PI / 2), CYAN, 2.4)
    .add(cyl(0.125, 0.125, 0.085, 12), GOLD, 2.8)
    .add(oct(0.07), 0xffffff, 3, { p: [0, 0.065, 0] });
  return b.build();
}

/** Projectile bolt (sleek faceted energy lance pointing +Z, scaled per weapon). */
export function buildBoltGeo(): THREE.BufferGeometry {
  return capsule(0.5, 1.05, 4, 10).rotateX(Math.PI / 2).scale(1, 1, 0.52);
}
