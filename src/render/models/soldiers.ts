import * as THREE from 'three';
import type { RewardId, WeaponId } from '../../types/game';
import { GeoBuilder, addLimb, box, capsule, cone, cyl, oct, sph, tor, type V3 } from './kit';
import type { RigPartDef } from './rig';

/**
 * The player's squad: 「棱镜战士」.
 * Tier 1 = chibi trooper, tier 2 = heavy trooper (represents 5), tier 3 = Prism mech (represents 25).
 * All face −Z (away from the camera) — backs, backpacks, helmets and guns are the readable silhouette.
 */

const SUIT = 0x1b2442;
const SUIT_DARK = 0x0c1122;
const ARMOR = 0xeaf7ff;
const CYAN = 0x3ef3ff;
const GOLD = 0xffc531;
const GOLD_ARMOR = 0xfff0c4;

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
  const metal = 0x2a3350;
  const dark = 0x10142a;
  const g = weapon === 'blades' ? GOLD : WEAPON_GLOW[weapon];
  switch (weapon) {
    case 'pulse':
      b.add(box(0.07, 0.09, 0.3), metal, 0, { p: [0, 0, -0.1] })
        .add(box(0.05, 0.1, 0.06), dark, 0, { p: [0, -0.07, 0.0], r: [0.3, 0, 0] })
        .add(along(0.16, 0.022), dark, 0, { p: [0, 0.01, -0.32] })
        .add(box(0.075, 0.02, 0.2), g, 2.2, { p: [0, 0.045, -0.1] })
        .add(sph(0.03, 8, 6), g, 3, { p: [0, 0.01, -0.41] })
        .add(box(0.05, 0.05, 0.08), dark, 0, { p: [0, 0.07, -0.05] });
      break;
    case 'scatter':
      b.add(box(0.12, 0.1, 0.26), metal, 0, { p: [0, 0, -0.08] })
        .add(box(0.05, 0.1, 0.06), dark, 0, { p: [0, -0.07, 0.02], r: [0.3, 0, 0] });
      for (const x of [-0.04, 0, 0.04]) b.add(along(0.14, 0.022), dark, 0, { p: [x, 0.015, -0.27] });
      b.add(box(0.15, 0.03, 0.03), g, 2.6, { p: [0, 0.015, -0.34] })
        .add(box(0.13, 0.02, 0.16), g, 1.6, { p: [0, 0.06, -0.08] });
      break;
    case 'rail':
      b.add(box(0.06, 0.08, 0.32), metal, 0, { p: [0, 0, -0.08] })
        .add(box(0.05, 0.1, 0.06), dark, 0, { p: [0, -0.07, 0.02], r: [0.3, 0, 0] })
        .add(along(0.42, 0.018), dark, 0, { p: [0, 0.01, -0.44] })
        .add(along(0.12, 0.028), dark, 0, { p: [0, 0.075, -0.1] });
      for (let i = 0; i < 4; i++) b.add(tor(0.035, 0.01, 4, 10), g, 2.6, { p: [0, 0.01, -0.3 - i * 0.09] });
      b.add(sph(0.032, 8, 6), g, 3, { p: [0, 0.01, -0.66] });
      break;
    case 'plasma':
      b.add(along(0.46, 0.075, 12), metal, 0, { p: [0, 0.05, -0.12] })
        .add(tor(0.078, 0.02, 6, 14), dark, 0, { p: [0, 0.05, -0.34] })
        .add(tor(0.078, 0.02, 6, 14), dark, 0, { p: [0, 0.05, 0.08] })
        .add(sph(0.06, 10, 8), g, 3, { p: [0, 0.05, -0.34] })
        .add(box(0.05, 0.1, 0.06), dark, 0, { p: [0, -0.05, -0.05] })
        .add(box(0.02, 0.06, 0.28), g, 1.6, { p: [0.07, 0.05, -0.12] });
      break;
    case 'cryo':
      b.add(box(0.08, 0.09, 0.28), metal, 0, { p: [0, 0, -0.08] })
        .add(box(0.05, 0.1, 0.06), dark, 0, { p: [0, -0.07, 0.02], r: [0.3, 0, 0] })
        .add(cone(0.05, 0.14, 8).rotateX(-Math.PI / 2), dark, 0, { p: [0, 0.01, -0.29] })
        .add(along(0.18, 0.045, 10), g, 1.8, { p: [0, 0.09, -0.06] })
        .add(sph(0.035, 8, 6), 0xffffff, 3, { p: [0, 0.01, -0.37] });
      break;
    case 'blades':
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.add(cone(0.07, 0.36, 3).rotateZ(-Math.PI / 2), GOLD_ARMOR, 1.2, { p: [Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18], r: [0, -a, 0] });
      }
      b.add(cyl(0.08, 0.08, 0.05, 10), GOLD, 2.4);
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
  const k = heavy ? 1.32 : 1;
  const hipY = 0.3;
  const legs = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    b.add(box(0.1, 0.16, 0.12), SUIT, 0, { p: [0, -0.07, 0] })
      .add(box(0.11, 0.07, 0.12), armor, 0, { p: [0, -0.16, -0.012] })
      .add(box(0.095, 0.1, 0.11), SUIT, 0, { p: [0, -0.22, 0] })
      .add(box(0.12, 0.07, 0.18), SUIT_DARK, 0, { p: [0, -0.275, -0.025] })
      .add(box(0.02, 0.02, 0.1), accent, 1.6, { p: [side * 0.055, -0.275, -0.03] });
    return b.build();
  };
  const body = new GeoBuilder();
  body
    .add(box(0.28, 0.26, 0.19), SUIT, 0, { p: [0, 0.14, 0] })
    .add(box(0.3, 0.15, 0.2), armor, 0, { p: [0, 0.2, -0.005] })
    .add(box(0.3, 0.05, 0.2), SUIT_DARK, 0, { p: [0, 0.03, 0] })
    .add(box(0.05, 0.035, 0.02), accent, 2, { p: [0, 0.03, -0.105] })
    // backpack (faces the camera)
    .add(box(0.22, 0.22, 0.1), 0x24345e, 0, { p: [0, 0.18, 0.14] })
    .add(box(0.035, 0.15, 0.02), accent, 2.2, { p: [0.055, 0.18, 0.195] })
    .add(box(0.035, 0.15, 0.02), accent, 2.2, { p: [-0.055, 0.18, 0.195] })
    .add(cyl(0.01, 0.01, 0.16, 5), SUIT_DARK, 0, { p: [0.08, 0.36, 0.15] })
    .add(sph(0.018, 6, 4), accent, 3, { p: [0.08, 0.45, 0.15] })
    // shoulder pads
    .add(sph(0.085, 10, 6), armor, 0, { p: [0.18, 0.27, 0], s: [1.1, 0.8, 1.1] })
    .add(sph(0.085, 10, 6), armor, 0, { p: [-0.18, 0.27, 0], s: [1.1, 0.8, 1.1] })
    .add(box(0.02, 0.02, 0.12), accent, 2, { p: [0.2, 0.31, 0] })
    .add(box(0.02, 0.02, 0.12), accent, 2, { p: [-0.2, 0.31, 0] });
  if (heavy) {
    // jetpack thrusters + big pauldrons
    body
      .add(cyl(0.045, 0.06, 0.16, 8), 0x3a3320, 0, { p: [0.07, 0.1, 0.21] })
      .add(cyl(0.045, 0.06, 0.16, 8), 0x3a3320, 0, { p: [-0.07, 0.1, 0.21] })
      .add(cone(0.05, 0.1, 8).rotateX(Math.PI), GOLD, 2.6, { p: [0.07, -0.02, 0.21] })
      .add(cone(0.05, 0.1, 8).rotateX(Math.PI), GOLD, 2.6, { p: [-0.07, -0.02, 0.21] })
      .add(box(0.12, 0.05, 0.16), armor, 0, { p: [0.21, 0.33, 0], r: [0, 0, -0.35] })
      .add(box(0.12, 0.05, 0.16), armor, 0, { p: [-0.21, 0.33, 0], r: [0, 0, 0.35] });
  }
  const head = new GeoBuilder();
  const helmet = heavy ? 0xffa81a : 0x2f7bff;
  head
    .add(sph(0.155, 14, 10), helmet, 0, { p: [0, 0.11, 0] })
    .add(sph(0.158, 14, 10, ), SUIT_DARK, 0, { p: [0, 0.07, -0.02], s: [1, 0.55, 1] })
    .add(box(0.2, 0.06, 0.05), accent, 2.6, { p: [0, 0.1, -0.13] })
    .add(box(0.03, 0.03, 0.3), accent, 2.2, { p: [0, 0.27, 0.01] })
    .add(cyl(0.035, 0.035, 0.05, 8).rotateZ(Math.PI / 2), accent, 2.2, { p: [0.16, 0.1, 0] })
    .add(cyl(0.035, 0.035, 0.05, 8).rotateZ(Math.PI / 2), accent, 2.2, { p: [-0.16, 0.1, 0] });
  if (heavy) head.add(cone(0.05, 0.16, 6), GOLD, 1.4, { p: [0, 0.3, 0.04], r: [-0.4, 0, 0] });
  const arms = new GeoBuilder();
  addLimb(arms, [0.18, 0, 0], [0.13, -0.12, -0.12], 0.045, 0.04, SUIT);
  addLimb(arms, [-0.18, 0, 0], [-0.02, -0.08, -0.22], 0.045, 0.04, SUIT);
  arms
    .add(sph(0.045, 8, 6), armor, 0, { p: [0.12, -0.12, -0.13] })
    .add(sph(0.045, 8, 6), armor, 0, { p: [-0.01, -0.08, -0.23] });
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
  const shell = 0xfff3cf;
  const frame = 0x2b2c3a;
  const legs = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [side * 0.05, -0.28, 0.1], 0.1, 0.08, frame);
    b.add(box(0.2, 0.22, 0.2), shell, 0, { p: [side * 0.03, -0.12, 0.02] });
    addLimb(b, [side * 0.05, -0.28, 0.1], [side * 0.05, -0.56, -0.02], 0.08, 0.07, frame);
    b.add(box(0.16, 0.2, 0.16), shell, 0, { p: [side * 0.05, -0.42, 0.03] })
      .add(box(0.24, 0.08, 0.34), frame, 0, { p: [side * 0.05, -0.6, -0.04] })
      .add(box(0.04, 0.04, 0.2), GOLD, 2.4, { p: [side * 0.16, -0.6, -0.04] });
    return b.build();
  };
  const body = new GeoBuilder();
  body
    .add(box(0.6, 0.42, 0.5), shell, 0, { p: [0, 0.3, 0] })
    .add(box(0.62, 0.1, 0.52), frame, 0, { p: [0, 0.08, 0] })
    .add(box(0.36, 0.28, 0.2), frame, 0, { p: [0, 0.32, 0.32] })
    .add(cyl(0.07, 0.09, 0.22, 8), 0x3a3320, 0, { p: [0.12, 0.2, 0.42] })
    .add(cyl(0.07, 0.09, 0.22, 8), 0x3a3320, 0, { p: [-0.12, 0.2, 0.42] })
    .add(cone(0.08, 0.18, 8).rotateX(Math.PI), GOLD, 3, { p: [0.12, 0.02, 0.42] })
    .add(cone(0.08, 0.18, 8).rotateX(Math.PI), GOLD, 3, { p: [-0.12, 0.02, 0.42] })
    .add(box(0.3, 0.04, 0.03), GOLD, 2.4, { p: [0, 0.42, 0.425] })
    .add(box(0.3, 0.04, 0.03), GOLD, 2.4, { p: [0, 0.34, 0.425] })
    .add(box(0.22, 0.12, 0.3), shell, 0, { p: [0.4, 0.46, 0], r: [0, 0, -0.3] })
    .add(box(0.22, 0.12, 0.3), shell, 0, { p: [-0.4, 0.46, 0], r: [0, 0, 0.3] })
    .add(box(0.03, 0.03, 0.3), GOLD, 2.4, { p: [0.47, 0.52, 0], r: [0, 0, -0.3] })
    .add(box(0.03, 0.03, 0.3), GOLD, 2.4, { p: [-0.47, 0.52, 0], r: [0, 0, 0.3] });
  const head = new GeoBuilder();
  head
    .add(sph(0.2, 14, 10), frame, 0, { s: [1.2, 0.8, 1.1], p: [0, 0.08, -0.05] })
    .add(sph(0.16, 14, 10), CYAN, 1.8, { s: [1.1, 0.6, 1], p: [0, 0.1, -0.14] })
    .add(cone(0.035, 0.3, 5), GOLD, 1.6, { p: [0.14, 0.3, 0.05], r: [-0.3, 0, -0.2] })
    .add(cone(0.035, 0.3, 5), GOLD, 1.6, { p: [-0.14, 0.3, 0.05], r: [-0.3, 0, 0.2] });
  const arms = new GeoBuilder();
  for (const s of [1, -1]) {
    addLimb(arms, [s * 0.4, 0, 0], [s * 0.46, -0.2, -0.12], 0.08, 0.07, frame);
    arms
      .add(box(0.2, 0.2, 0.36), shell, 0, { p: [s * 0.46, -0.24, -0.2] })
      .add(along(0.3, 0.05), frame, 0, { p: [s * 0.46, -0.24, -0.5] })
      .add(tor(0.055, 0.015, 4, 10), GOLD, 2.6, { p: [s * 0.46, -0.24, -0.62] });
  }
  const weapons = {} as Record<WeaponId, THREE.BufferGeometry>;
  for (const w of ['pulse', 'scatter', 'rail', 'plasma', 'cryo'] as WeaponId[]) {
    const g = buildWeaponGeo(w, 1.7);
    g.translate(0, 0.32, -0.15); // shoulder-mounted main gun
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
  if (reward === 'blades') return buildWeaponGeo('blades', 2.4);
  const g = buildWeaponGeo(reward, 2.6);
  g.center();
  return g;
}

/** Orbital Bit-Blade (shuriken). */
export function buildBladeGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.add(cone(0.1, 0.5, 3).rotateZ(-Math.PI / 2), GOLD_ARMOR, 1.4, { p: [Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24], r: [0, -a, 0], s: [1, 0.35, 1] });
  }
  b.add(cyl(0.12, 0.12, 0.08, 12), GOLD, 2.6).add(oct(0.06), 0xffffff, 3, { p: [0, 0.06, 0] });
  return b.build();
}

/** Projectile bolt (unit-length capsule pointing +Z, scaled per weapon). */
export function buildBoltGeo(): THREE.BufferGeometry {
  return capsule(0.5, 1, 3, 8).rotateX(Math.PI / 2).scale(1, 1, 0.5);
}

