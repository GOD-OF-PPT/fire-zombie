import * as THREE from 'three';
import type { EnemyKind } from '../../types/game';
import { GeoBuilder, addLimb, box, cone, cyl, oct, sph, tor } from './kit';
import type { RigPartDef } from './rig';

/**
 * High-detail stylized 10-archetype cyber-mutant & zombie monster roster.
 * All monsters face +Z (toward the squad) with crisp Q-version silhouettes & high-contrast neon accents.
 */

export interface MonsterModel {
  parts: RigPartDef[];
  baseRadius: number;
  height: number;
}

const WHITE = 0xfff6ee;
const BLACK = 0x0a0e1d;

function crawler(): MonsterModel {
  const main = 0xe81e48;
  const carapace = 0x5c0c24;
  const plate = 0xff4d6d;
  const body = new GeoBuilder();
  body
    // Sculpted 3-segment armored arachnid abdomen + raised thoracic crest + brow horn
    .add(sph(0.33, 18, 14), main, 0, { p: [0, 0.06, -0.2], s: [1.12, 0.88, 1.32] })
    .add(box(0.46, 0.14, 0.38), carapace, 0, { p: [0, 0.24, -0.16], r: [-0.18, 0, 0] })
    .add(sph(0.26, 16, 12), plate, 0, { p: [0, 0.03, 0.14], s: [1.08, 0.92, 1.05] })
    .add(box(0.36, 0.1, 0.22), carapace, 0, { p: [0, 0.18, 0.16], r: [0.24, 0, 0] })
    // Glowing predator eyes + heavy curved scythe mandibles
    .add(sph(0.095, 10, 8), 0xffe44d, 2.6, { p: [0, 0.09, 0.34] })
    .add(sph(0.044, 8, 6), BLACK, 0, { p: [0, 0.09, 0.42] })
    .add(sph(0.062, 8, 6), 0xffe44d, 2.4, { p: [0.14, 0.13, 0.27] })
    .add(sph(0.062, 8, 6), 0xffe44d, 2.4, { p: [-0.14, 0.13, 0.27] })
    .add(cone(0.058, 0.26, 6), WHITE, 0, { p: [0.13, -0.06, 0.38], r: [Math.PI / 2, 0, 0.46] })
    .add(cone(0.058, 0.26, 6), WHITE, 0, { p: [-0.13, -0.06, 0.38], r: [Math.PI / 2, 0, -0.46] });
  // Twin angled 3D dorsal bone-crystal ridges for unmistakable 3D silhouette depth
  for (let i = 0; i < 3; i++) {
    for (const s of [1, -1] as const) {
      body.add(cone(0.056, 0.24 - i * 0.03, 5), i === 0 ? 0xff66e8 : plate, i === 0 ? 1.8 : 0, {
        p: [s * 0.14, 0.33 - i * 0.03, 0.02 - i * 0.16],
        r: [-0.38, 0, -s * 0.38],
      });
    }
  }
  const legs = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    for (const z of [0.17, 0, -0.18]) {
      const dz = z * 0.62;
      addLimb(b, [0, 0, z], [side * 0.33, 0.18, z + dz], 0.052, 0.044, carapace);
      addLimb(b, [side * 0.33, 0.18, z + dz], [side * 0.49, -0.34, z + dz * 1.5], 0.044, 0.022, main);
      b.add(oct(0.038), carapace, 0, { p: [side * 0.33, 0.19, z + dz] });
    }
    return b.build();
  };
  return {
    baseRadius: 0.48,
    height: 0.78,
    parts: [
      { name: 'body', geo: body.build(), joint: [0, 0.38, 0] },
      { name: 'legsL', geo: legs(1), joint: [0.15, 0.36, 0] },
      { name: 'legsR', geo: legs(-1), joint: [-0.15, 0.36, 0] },
    ],
  };
}

function dasher(): MonsterModel {
  const hide = 0xff6a18;
  const armor = 0x3b1710;
  const flame = 0xffcf38;
  const body = new GeoBuilder();
  body
    .add(sph(0.23, 16, 12), hide, 0, { s: [1.02, 0.9, 1.62] })
    .add(box(0.3, 0.09, 0.48), armor, 0, { p: [0, 0.19, -0.02], r: [-0.08, 0, 0] })
    .add(box(0.24, 0.06, 0.36), flame, 1.4, { p: [0, -0.17, 0.06] });
  for (let i = 0; i < 5; i++) {
    body.add(cone(0.055, 0.23 - i * 0.022, 5), flame, 2.0, {
      p: [0, 0.24 - i * 0.012, 0.24 - i * 0.13],
      r: [-0.65, 0, 0],
    });
  }
  addLimb(body, [0, 0.05, -0.3], [0, 0.26, -0.66], 0.065, 0.018, hide);
  body.add(oct(0.055), flame, 2.8, { p: [0, 0.27, -0.68], s: [0.7, 1.3, 1.5] });

  const head = new GeoBuilder();
  head
    .add(sph(0.175, 14, 10), 0xff7c28, 0, { p: [0, 0.035, 0.08], s: [0.88, 0.78, 1.24] })
    .add(box(0.148, 0.095, 0.19), 0xff7c28, 0, { p: [0, -0.01, 0.24] })
    .add(box(0.16, 0.035, 0.12), armor, 0, { p: [0, 0.09, 0.16], r: [0.22, 0, 0] })
    .add(sph(0.045, 8, 6), 0x62f4ff, 2.4, { p: [0.078, 0.07, 0.19] })
    .add(sph(0.045, 8, 6), 0x62f4ff, 2.4, { p: [-0.078, 0.07, 0.19] })
    .add(sph(0.022, 6, 4), BLACK, 0, { p: [0.084, 0.075, 0.228] })
    .add(sph(0.022, 6, 4), BLACK, 0, { p: [-0.084, 0.075, 0.228] })
    .add(cone(0.042, 0.26, 6), flame, 1.2, { p: [0.095, 0.16, -0.01], r: [-1.05, 0, -0.32] })
    .add(cone(0.042, 0.26, 6), flame, 1.2, { p: [-0.095, 0.16, -0.01], r: [-1.05, 0, 0.32] });
  for (const x of [-0.048, 0, 0.048]) {
    head.add(cone(0.015, 0.055, 4), WHITE, 0.2, { p: [x, -0.07, 0.315], r: [Math.PI, 0, 0] });
  }
  const jaw = new GeoBuilder();
  jaw
    .add(box(0.125, 0.042, 0.205), armor, 0, { p: [0, -0.02, 0.1] })
    .add(box(0.092, 0.018, 0.165), 0xff2965, 1.6, { p: [0, 0.0, 0.1] });
  for (const x of [-0.042, 0.042]) jaw.add(cone(0.015, 0.055, 4), WHITE, 0.2, { p: [x, 0.022, 0.185] });

  const leg = (): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [0, -0.25, -0.06], 0.068, 0.048, hide);
    addLimb(b, [0, -0.25, -0.06], [0, -0.5, 0.02], 0.048, 0.036, armor);
    b.add(sph(0.052, 8, 6), armor, 0, { p: [0, -0.5, 0.04], s: [1, 0.6, 1.35] });
    b.add(cone(0.014, 0.055, 4), flame, 1.2, { p: [0, -0.52, 0.105], r: [Math.PI / 2, 0, 0] });
    return b.build();
  };
  return {
    baseRadius: 0.58,
    height: 0.92,
    parts: [
      { name: 'body', geo: body.build(), joint: [0, 0.55, 0] },
      { name: 'head', geo: head.build(), joint: [0, 0.66, 0.36] },
      { name: 'jaw', geo: jaw.build(), joint: [0, 0.6, 0.42] },
      { name: 'legFL', geo: leg(), joint: [0.13, 0.5, 0.22] },
      { name: 'legFR', geo: leg(), joint: [-0.13, 0.5, 0.22] },
      { name: 'legBL', geo: leg(), joint: [0.13, 0.5, -0.22] },
      { name: 'legBR', geo: leg(), joint: [-0.13, 0.5, -0.22] },
    ],
  };
}

function bastion(): MonsterModel {
  const hide = 0xd61c42;
  const darkIron = 0x261626;
  const plate = 0xffc531;
  const glow = 0xff8c2e;
  const body = new GeoBuilder();
  body
    .add(sph(0.72, 16, 12), hide, 0, { p: [0, 0.21, 0], s: [1.18, 0.92, 0.78] })
    .add(box(0.76, 0.44, 0.24), darkIron, 0, { p: [0, 0.3, 0.41] })
    .add(box(0.68, 0.36, 0.06), plate, 0, { p: [0, 0.3, 0.52] })
    .add(oct(0.14), glow, 2.8, { p: [0, 0.3, 0.57], s: [1, 1.25, 0.5] })
    .add(sph(0.35, 12, 10), darkIron, 0, { p: [0.64, 0.44, 0] })
    .add(sph(0.35, 12, 10), darkIron, 0, { p: [-0.64, 0.44, 0] })
    .add(tor(0.34, 0.045, 5, 14), plate, 1.4, { p: [0.64, 0.44, 0], r: [0, 0, -0.4] })
    .add(tor(0.34, 0.045, 5, 14), plate, 1.4, { p: [-0.64, 0.44, 0], r: [0, 0, 0.4] });
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      body.add(cone(0.075, 0.34, 5), WHITE, 1.2, {
        p: [s * (0.56 + i * 0.11), 0.75 - i * 0.05, -0.05 + i * 0.05],
        r: [0, 0, -s * (0.3 + i * 0.25)],
      });
    }
  }
  const head = new GeoBuilder();
  head
    // Armored siege-knight helm + glowing crimson-gold V-visor + iron jaw tusks (zero cartoon pin-eyes!)
    .add(oct(0.28), darkIron, 0, { p: [0, 0.15, 0.02], s: [1.08, 0.96, 1.02] })
    .add(box(0.44, 0.12, 0.26), hide, 0, { p: [0, 0.28, 0.06], r: [0.18, 0, 0] })
    .add(box(0.18, 0.065, 0.09), 0xffe44d, 2.9, { p: [0.1, 0.16, 0.24], r: [0, 0.16, -0.24] })
    .add(box(0.18, 0.065, 0.09), 0xffe44d, 2.9, { p: [-0.1, 0.16, 0.24], r: [0, -0.16, 0.24] })
    .add(box(0.36, 0.11, 0.24), darkIron, 0, { p: [0, 0.01, 0.14] })
    .add(cone(0.085, 0.44, 6), plate, 1.4, { p: [0.25, 0.35, -0.02], r: [-0.18, 0, -0.64] })
    .add(cone(0.085, 0.44, 6), plate, 1.4, { p: [-0.25, 0.35, -0.02], r: [-0.18, 0, 0.64] })
    .add(cone(0.052, 0.2, 5), WHITE, 0.6, { p: [0.13, 0.04, 0.27], r: [0.55, 0, 0.12] })
    .add(cone(0.052, 0.2, 5), WHITE, 0.6, { p: [-0.13, 0.04, 0.27], r: [0.55, 0, -0.12] });

  const arm = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [side * 0.1, -0.48, 0.12], 0.18, 0.15, hide);
    addLimb(b, [side * 0.1, -0.48, 0.12], [side * 0.05, -0.92, 0.3], 0.16, 0.19, darkIron);
    b.add(sph(0.24, 12, 8), plate, 0, { p: [side * 0.05, -1.0, 0.34] });
    for (const z of [-0.1, 0.1]) {
      b.add(cone(0.055, 0.18, 5), WHITE, 1.4, {
        p: [side * 0.21, -0.95, 0.34 + z],
        r: [0, 0, -side * 1.3],
      });
    }
    if (side === -1) {
      b.add(cyl(0.06, 0.05, 0.95, 8).rotateX(Math.PI / 2), darkIron, 0, { p: [-0.05, -1.0, 0.72] })
        .add(cyl(0.18, 0.13, 0.52, 8).rotateX(Math.PI / 2), darkIron, 0, { p: [-0.05, -1.0, 1.12] })
        .add(tor(0.18, 0.035, 5, 12), glow, 2.4, { p: [-0.05, -1.0, 1.2] });
    }
    return b.build();
  };
  const leg = (): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [0, -0.48, 0.02], 0.21, 0.18, hide);
    b.add(box(0.36, 0.15, 0.46), darkIron, 0, { p: [0, -0.55, 0.06] });
    return b.build();
  };
  const shield = new GeoBuilder();
  shield
    .add(cyl(0.96, 0.96, 0.13, 6).rotateX(Math.PI / 2), darkIron, 0)
    .add(cyl(0.78, 0.78, 0.045, 6).rotateX(Math.PI / 2), 0x6b2038, 0.55, { p: [0, 0, 0.075] })
    .add(tor(0.94, 0.055, 5, 6).rotateZ(Math.PI / 6), plate, 2.4, { p: [0, 0, 0.075] })
    .add(oct(0.22), glow, 2.8, { p: [0, 0, 0.13], s: [1, 1, 0.5] })
    .add(box(1.52, 0.04, 0.03), plate, 1.8, { p: [0, 0, 0.1] })
    .add(box(0.04, 1.52, 0.03), plate, 1.8, { p: [0, 0, 0.1] });
  return {
    baseRadius: 1.15,
    height: 2.12,
    parts: [
      { name: 'body', geo: body.build(), joint: [0, 1.0, 0] },
      { name: 'head', geo: head.build(), joint: [0, 1.62, 0.05] },
      { name: 'armL', geo: arm(1), joint: [0.8, 1.38, 0] },
      { name: 'armR', geo: arm(-1), joint: [-0.8, 1.38, 0] },
      { name: 'legL', geo: leg(), joint: [0.36, 0.62, 0] },
      { name: 'legR', geo: leg(), joint: [-0.36, 0.62, 0] },
      { name: 'shield', geo: shield.build(), joint: [0, 0.95, 0.85] },
    ],
  };
}

function mitosis(): MonsterModel {
  const carapace = 0x2c0e4a;
  const bioLobeL = 0xb81d9c;
  const bioLobeR = 0xd62cb8;
  const cyanCore = 0x62f4ff;
  const goldCore = 0xffea75;

  const body = new GeoBuilder();
  body
    // Faceted twin-reactor bio-crystal carapace + glowing central mitotic cleavage ring (zero cartoon smooth ball!)
    .add(oct(0.44), bioLobeL, 0, { p: [-0.24, 0.06, 0], s: [0.95, 1.05, 1.06], r: [0.18, 0.25, 0.12] })
    .add(oct(0.44), bioLobeR, 0, { p: [0.24, 0.06, 0], s: [0.95, 1.05, 1.06], r: [0.18, -0.25, -0.12] })
    .add(tor(0.45, 0.048, 6, 18).rotateY(Math.PI / 2), cyanCore, 2.8, { p: [0, 0.06, 0] })
    .add(box(0.82, 0.14, 0.54), carapace, 0, { p: [0, 0.28, -0.04], r: [0.16, 0, 0] })
    .add(cyl(0.52, 0.62, 0.22, 8), carapace, 0, { p: [0, -0.32, 0] })
    // Cleanly elevated twin crystal spire horns (seated ON TOP of armor, zero coplanar poke-through!)
    .add(cone(0.11, 0.42, 5), cyanCore, 2.7, { p: [0.28, 0.56, 0.02], r: [-0.18, 0, -0.34] })
    .add(cone(0.11, 0.42, 5), goldCore, 2.7, { p: [-0.28, 0.56, 0.02], r: [-0.18, 0, 0.34] });

  const face = new GeoBuilder();
  face
    // Fierce cyber-mutant visor brow + twin slanted glowing predator slits + fanged split maw
    .add(box(0.66, 0.11, 0.22), carapace, 0, { p: [0, 0.18, 0.38], r: [0.24, 0, 0] })
    .add(box(0.2, 0.062, 0.08), cyanCore, 3.0, { p: [0.2, 0.11, 0.45], r: [0, 0.22, -0.28] })
    .add(box(0.2, 0.062, 0.08), goldCore, 3.0, { p: [-0.2, 0.11, 0.45], r: [0, -0.22, 0.28] })
    .add(oct(0.095), 0xff5ce0, 2.8, { p: [0, -0.06, 0.46], s: [1.35, 0.65, 0.55] })
    .add(cone(0.042, 0.16, 4), WHITE, 0.8, { p: [0.16, -0.1, 0.46], r: [Math.PI * 0.72, 0, 0.2] })
    .add(cone(0.042, 0.16, 4), WHITE, 0.8, { p: [-0.16, -0.1, 0.46], r: [Math.PI * 0.72, 0, -0.2] });

  const cells = new GeoBuilder();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cells.add(oct(0.12), i % 2 ? cyanCore : 0xff7ae8, 2.6, {
      p: [Math.cos(a) * 0.82, 0.08 + (i % 3) * 0.16, Math.sin(a) * 0.82],
      r: [a, i * 0.5, 0],
    });
  }
  return {
    baseRadius: 0.72,
    height: 1.32,
    parts: [
      { name: 'body', geo: body.build(), joint: [0, 0.62, 0] },
      { name: 'face', geo: face.build(), joint: [0, 0.62, 0] },
      { name: 'cells', geo: cells.build(), joint: [0, 0.62, 0] },
    ],
  };
}

function siphon(): MonsterModel {
  const main = 0x7c2eff;
  const skull = 0xf4ecff;
  const soul = 0x5eff9a;
  const head = new GeoBuilder();
  head
    .add(new THREE.SphereGeometry(0.46, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), main, 0.4)
    .add(cyl(0.45, 0.34, 0.12, 18), 0x3a1270, 0, { p: [0, -0.06, 0] })
    .add(tor(0.47, 0.036, 6, 24).rotateX(Math.PI / 2), 0xd896ff, 2.4)
    .add(sph(0.24, 12, 10), skull, 0.1, { p: [0, 0.12, 0.28], s: [0.95, 0.9, 0.85] })
    .add(box(0.2, 0.1, 0.12), skull, 0.1, { p: [0, -0.06, 0.36] })
    .add(sph(0.085, 10, 8), soul, 2.8, { p: [0.09, 0.14, 0.44] })
    .add(sph(0.085, 10, 8), soul, 2.8, { p: [-0.09, 0.14, 0.44] })
    .add(oct(0.11), soul, 3.0, { p: [0, 0.56, 0.05], s: [0.8, 1.5, 0.8] });
  for (let i = 0; i < 5; i++) {
    const a = ((i - 2) / 4) * 1.4;
    head.add(cone(0.045, 0.22, 5), 0xffc531, 1.6, {
      p: [Math.sin(a) * 0.34, 0.46, Math.cos(a) * 0.12],
      r: [0.15, 0, -a * 0.65],
    });
  }
  const tents = (offset: number): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + offset;
      const rx = Math.cos(a) * 0.26;
      const rz = Math.sin(a) * 0.26;
      addLimb(b, [rx, 0, rz], [rx * 1.38, -0.4, rz * 1.38], 0.072, 0.046, 0x5c20b8);
      addLimb(b, [rx * 1.38, -0.4, rz * 1.38], [rx * 1.05, -0.85, rz * 1.05], 0.046, 0.018, 0x9b4dff);
      b.add(oct(0.042), soul, 2.8, { p: [rx * 1.05, -0.86, rz * 1.05] });
    }
    return b.build();
  };
  return {
    baseRadius: 0.68,
    height: 1.72,
    parts: [
      { name: 'head', geo: head.build(), joint: [0, 1.25, 0] },
      { name: 'tentA', geo: tents(0), joint: [0, 1.18, 0] },
      { name: 'tentB', geo: tents(Math.PI / 3), joint: [0, 1.18, 0] },
    ],
  };
}

/** 6. BOMBER（爆裂自爆尸）— Hunched mutant sprinter carrying an unstable glowing toxic-lime plasma drum */
function bomber(): MonsterModel {
  const skin = 0x45355e;
  const strap = 0x1d172b;
  const toxic = 0x92ff24;
  const hazard = 0xff9a1f;

  const body = new GeoBuilder();
  body
    .add(sph(0.28, 14, 10), skin, 0, { p: [0, 0.04, 0.04], s: [1.05, 0.92, 0.95], r: [0.35, 0, 0] })
    .add(box(0.42, 0.08, 0.36), strap, 0, { p: [0, 0.1, 0.02], r: [0.35, 0, 0] })
    // Crazed zombie head thrust forward
    .add(sph(0.2, 14, 10), 0x584475, 0, { p: [0, 0.2, 0.28] })
    .add(box(0.22, 0.08, 0.14), BLACK, 0, { p: [0, 0.13, 0.42] })
    .add(sph(0.068, 8, 6), toxic, 2.8, { p: [0.085, 0.24, 0.43] })
    .add(sph(0.052, 8, 6), hazard, 2.8, { p: [-0.085, 0.24, 0.43] })
    .add(cone(0.024, 0.07, 4), WHITE, 0.2, { p: [0.06, 0.16, 0.47], r: [Math.PI, 0, 0] })
    .add(cone(0.024, 0.07, 4), WHITE, 0.2, { p: [-0.06, 0.16, 0.47], r: [Math.PI, 0, 0] });

  // Oversized pressurized bio-plasma barrel strapped on its back
  const tank = new GeoBuilder();
  tank
    .add(cyl(0.29, 0.29, 0.68, 16), toxic, 2.5, { r: [0.42, 0, 0] })
    .add(cyl(0.31, 0.31, 0.1, 16), strap, 0, { p: [0, 0.21, 0.09], r: [0.42, 0, 0] })
    .add(cyl(0.31, 0.31, 0.1, 16), strap, 0, { p: [0, -0.21, -0.09], r: [0.42, 0, 0] })
    .add(tor(0.3, 0.032, 6, 18).rotateX(Math.PI / 2), hazard, 2.2, { r: [0.42, 0, 0] })
    .add(sph(0.14, 10, 8), 0xe8ff7a, 3.0, { p: [0, 0.34, 0.15] })
    .add(oct(0.09), hazard, 2.8, { p: [0, 0.46, 0.2] });

  const arms = new GeoBuilder();
  for (const s of [1, -1] as const) {
    addLimb(arms, [s * 0.24, 0, 0], [s * 0.3, -0.18, 0.26], 0.065, 0.055, skin);
    arms.add(sph(0.075, 8, 6), toxic, 1.8, { p: [s * 0.28, -0.2, 0.3] });
  }

  const leg = (): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [0, -0.36, 0.03], 0.085, 0.068, skin);
    b.add(box(0.16, 0.09, 0.24), strap, 0, { p: [0, -0.4, 0.06] });
    return b.build();
  };

  return {
    baseRadius: 0.56,
    height: 1.38,
    parts: [
      { name: 'body', geo: body.build(), joint: [0, 0.62, 0] },
      { name: 'tank', geo: tank.build(), joint: [0, 0.92, -0.16] },
      { name: 'arms', geo: arms.build(), joint: [0, 0.72, 0.1] },
      { name: 'legL', geo: leg(), joint: [0.16, 0.44, 0] },
      { name: 'legR', geo: leg(), joint: [-0.16, 0.44, 0] },
    ],
  };
}

/** 7. PHALANX（电磁盾卫尸）— Cyber-undead riot trooper behind a glowing electric-cyan hexagonal shield */
function phalanx(): MonsterModel {
  const armor = 0x1b2940;
  const flesh = 0x4b627d;
  const cyan = 0x2ee6ff;

  const body = new GeoBuilder();
  body
    .add(box(0.56, 0.52, 0.36), armor, 0, { p: [0, 0.14, 0] })
    .add(box(0.46, 0.34, 0.08), 0x2d4466, 0, { p: [0, 0.16, 0.18] })
    .add(sph(0.2, 12, 10), armor, 0, { p: [0.34, 0.32, 0] })
    .add(sph(0.2, 12, 10), armor, 0, { p: [-0.34, 0.32, 0] })
    .add(tor(0.19, 0.028, 5, 12), cyan, 2.0, { p: [0.34, 0.32, 0], r: [0, 0, -0.4] })
    .add(tor(0.19, 0.028, 5, 12), cyan, 2.0, { p: [-0.34, 0.32, 0], r: [0, 0, 0.4] })
    // Helmeted head + glowing cyclops tactical visor
    .add(box(0.32, 0.3, 0.3), armor, 0, { p: [0, 0.55, 0.03] })
    .add(box(0.28, 0.08, 0.08), cyan, 2.8, { p: [0, 0.57, 0.17] })
    .add(box(0.08, 0.16, 0.32), cyan, 1.8, { p: [0, 0.72, 0.02] });

  const shieldArm = new GeoBuilder();
  // The detachable face is rendered with its live shield HP. Leave a gauntlet and
  // a warm, recessed power cell on the soldier so breaking the plates exposes a target.
  shieldArm.add(box(0.23, 0.32, 0.26), armor, 0, { p: [0, -0.05, 0.06] });
  body.add(box(0.24, 0.25, 0.08), 0x111b24, 0, { p: [0, 0.15, 0.225] })
    .add(oct(0.112), 0xffb35d, 1.35, { p: [0, 0.15, 0.29], s: [1, 1.26, 0.55] });

  const weaponArm = new GeoBuilder();
  addLimb(weaponArm, [0, 0, 0], [-0.08, -0.34, 0.2], 0.1, 0.085, flesh);
  weaponArm
    .add(cyl(0.038, 0.038, 0.78, 8).rotateX(Math.PI / 2), armor, 0, { p: [-0.08, -0.34, 0.5] })
    .add(cone(0.09, 0.28, 6).rotateX(Math.PI / 2), cyan, 2.8, { p: [-0.08, -0.34, 0.94] });

  const leg = (): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [0, -0.42, 0.02], 0.12, 0.1, flesh);
    b.add(box(0.22, 0.12, 0.3), armor, 0, { p: [0, -0.46, 0.05] });
    return b.build();
  };

  return {
    baseRadius: 0.78,
    height: 1.72,
    parts: [
      { name: 'body', geo: body.build(), joint: [0, 0.85, 0] },
      { name: 'shieldArm', geo: shieldArm.build(), joint: [0.16, 0.92, 0.34] },
      { name: 'weaponArm', geo: weaponArm.build(), joint: [-0.38, 1.05, 0.04] },
      { name: 'legL', geo: leg(), joint: [0.2, 0.52, 0] },
      { name: 'legR', geo: leg(), joint: [-0.2, 0.52, 0] },
    ],
  };
}

/** 8. STALKER（幽影闪现尸）— Blinking cyber-assassin zombie with twin neon-violet mantis scythes */
function stalker(): MonsterModel {
  const suit = 0x221238;
  const plate = 0x6f24cc;
  const blade = 0xe45cff;
  const accent = 0x52f7ff;

  const body = new GeoBuilder();
  body
    .add(sph(0.24, 12, 10), suit, 0, { p: [0, 0.1, 0], s: [0.95, 1.18, 0.85], r: [0.32, 0, 0] })
    .add(oct(0.11), accent, 2.8, { p: [0, 0.14, 0.19], s: [0.8, 1.2, 0.5] })
    // Cyber-oni assassin hood + V-visor + swept horns
    .add(sph(0.18, 12, 10), plate, 0, { p: [0, 0.38, 0.14] })
    .add(box(0.12, 0.045, 0.08), accent, 2.8, { p: [0.06, 0.39, 0.29], r: [0, 0, -0.32] })
    .add(box(0.12, 0.045, 0.08), accent, 2.8, { p: [-0.06, 0.39, 0.29], r: [0, 0, 0.32] })
    .add(cone(0.045, 0.32, 5), blade, 2.2, { p: [0.12, 0.54, 0.02], r: [-0.75, 0, -0.38] })
    .add(cone(0.045, 0.32, 5), blade, 2.2, { p: [-0.12, 0.54, 0.02], r: [-0.75, 0, 0.38] })
    // Trailing phase-cloak fins
    .add(cone(0.09, 0.48, 4), plate, 1.4, { p: [0.14, 0.08, -0.26], r: [-2.3, 0, 0.22] })
    .add(cone(0.09, 0.48, 4), plate, 1.4, { p: [-0.14, 0.08, -0.26], r: [-2.3, 0, -0.22] });

  const scythe = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [side * 0.14, -0.16, 0.22], 0.058, 0.048, suit);
    // Sweeping glowing mantis energy blade
    b.add(box(0.042, 0.14, 0.58), blade, 2.8, {
      p: [side * 0.14, -0.24, 0.42],
      r: [0.38, -side * 0.18, 0],
    });
    b.add(cone(0.07, 0.26, 4).rotateX(Math.PI / 2), WHITE, 2.6, {
      p: [side * 0.1, -0.34, 0.72],
    });
    return b.build();
  };

  const leg = (): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [0, -0.22, -0.06], 0.072, 0.055, plate);
    addLimb(b, [0, -0.22, -0.06], [0, -0.44, 0.05], 0.052, 0.035, suit);
    b.add(cone(0.048, 0.14, 4).rotateX(Math.PI / 2), blade, 1.8, { p: [0, -0.44, 0.11] });
    return b.build();
  };

  return {
    baseRadius: 0.52,
    height: 1.48,
    parts: [
      { name: 'body', geo: body.build(), joint: [0, 0.68, 0] },
      { name: 'bladeL', geo: scythe(1), joint: [0.24, 0.86, 0.06] },
      { name: 'bladeR', geo: scythe(-1), joint: [-0.24, 0.86, 0.06] },
      { name: 'legL', geo: leg(), joint: [0.15, 0.46, 0] },
      { name: 'legR', geo: leg(), joint: [-0.15, 0.46, 0] },
    ],
  };
}

/** 9. BROOD（孵化母巢兽）— Hexapod arachnid-zombie hive mother with throbbing bioluminescent gestation sac */
function brood(): MonsterModel {
  const chitin = 0x4d1d3a;
  const amber = 0xff9f1c;
  const pod = 0x88ff36;

  const thorax = new GeoBuilder();
  thorax
    .add(oct(0.36), chitin, 0, { p: [0, 0.05, 0.12], s: [1.12, 0.84, 1.14] })
    .add(box(0.46, 0.1, 0.36), amber, 0.5, { p: [0, 0.28, 0.1], r: [0.18, 0, 0] })
    // 4 glowing compound eyes + fanged spider mandibles
    .add(sph(0.075, 8, 6), pod, 2.8, { p: [0.12, 0.1, 0.46] })
    .add(sph(0.075, 8, 6), pod, 2.8, { p: [-0.12, 0.1, 0.46] })
    .add(sph(0.048, 8, 6), amber, 2.6, { p: [0.22, 0.15, 0.4] })
    .add(sph(0.048, 8, 6), amber, 2.6, { p: [-0.22, 0.15, 0.4] })
    .add(cone(0.06, 0.28, 6), WHITE, 0.4, { p: [0.15, -0.06, 0.54], r: [Math.PI / 2, 0, 0.38] })
    .add(cone(0.06, 0.28, 6), WHITE, 0.4, { p: [-0.15, -0.06, 0.54], r: [Math.PI / 2, 0, -0.38] });

  const sac = new GeoBuilder();
  sac
    // Segmented obsidian-crimson cyber-arachnid hive abdomen (no coplanar overlapping spheres -> ZERO polygon z-fighting!)
    .add(sph(0.5, 18, 14), 0x3b132b, 0, { s: [1.06, 0.88, 1.26] })
    .add(box(0.82, 0.14, 0.26), 0x6e2042, 0, { p: [0, 0.34, 0.18], r: [0.22, 0, 0] })
    .add(box(0.86, 0.14, 0.26), 0x8a2c48, 0, { p: [0, 0.36, -0.08], r: [0.04, 0, 0] })
    .add(box(0.76, 0.14, 0.26), 0x6e2042, 0, { p: [0, 0.31, -0.34], r: [-0.22, 0, 0] })
    // Dorsal chitinous vent spines
    .add(cone(0.075, 0.34, 5), amber, 1.8, { p: [0, 0.56, 0.06], r: [-0.28, 0, 0] })
    .add(cone(0.068, 0.3, 5), amber, 1.8, { p: [0, 0.5, -0.26], r: [-0.46, 0, 0] });
  // Externalized bioluminescent brood pods mounted cleanly OUTSIDE carapace radius (zero poke-through!)
  const podSockets: Array<[number, number, number]> = [
    [0.48, 0.24, 0.14],
    [-0.48, 0.24, 0.14],
    [0.5, 0.18, -0.22],
    [-0.5, 0.18, -0.22],
    [0.24, 0.44, -0.18],
    [-0.24, 0.44, -0.18],
  ];
  for (let i = 0; i < podSockets.length; i++) {
    const p = podSockets[i]!;
    sac.add(oct(0.135), i % 2 === 0 ? pod : 0xffbe2e, 2.8, { p, s: [1, 1.15, 1] });
  }

  const spiderLegs = (parity: 0 | 1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    const triplets: Array<[1 | -1, number]> =
      parity === 0
        ? [
            [1, 0.28],
            [-1, 0.0],
            [1, -0.28],
          ]
        : [
            [-1, 0.28],
            [1, 0.0],
            [-1, -0.28],
          ];
    for (const [side, z] of triplets) {
      addLimb(b, [side * 0.28, 0, z], [side * 0.68, 0.22, z * 1.15], 0.06, 0.048, chitin);
      addLimb(b, [side * 0.68, 0.22, z * 1.15], [side * 0.88, -0.46, z * 1.3], 0.048, 0.024, amber);
      b.add(oct(0.042), pod, 2.2, { p: [side * 0.88, -0.46, z * 1.3] });
    }
    return b.build();
  };

  return {
    baseRadius: 0.92,
    height: 1.56,
    parts: [
      { name: 'thorax', geo: thorax.build(), joint: [0, 0.52, 0.22] },
      { name: 'sac', geo: sac.build(), joint: [0, 0.72, -0.32] },
      { name: 'legsA', geo: spiderLegs(0), joint: [0, 0.48, 0] },
      { name: 'legsB', geo: spiderLegs(1), joint: [0, 0.48, 0] },
    ],
  };
}

/** 10. HOWLER（狂怒战嚎尸）— Crimson cyber-shaman zombie carrying twin resonating sonic war-totem pylons */
function howler(): MonsterModel {
  const hide = 0x7d1435;
  const obsidian = 0x1e1124;
  const crimson = 0xff2a6d;
  const gold = 0xffd84a;

  const body = new GeoBuilder();
  body
    .add(box(0.5, 0.52, 0.34), obsidian, 0, { p: [0, 0.14, 0] })
    .add(oct(0.14), crimson, 2.8, { p: [0, 0.16, 0.2], s: [1, 1.25, 0.5] })
    // Skull-megaphone shaman head + horned crown
    .add(sph(0.22, 12, 10), WHITE, 0.15, { p: [0, 0.54, 0.06], s: [0.96, 1.0, 0.92] })
    .add(cyl(0.14, 0.09, 0.16, 10).rotateX(Math.PI / 2), obsidian, 0, { p: [0, 0.47, 0.25] })
    .add(tor(0.13, 0.026, 5, 12), crimson, 2.8, { p: [0, 0.47, 0.32] })
    .add(sph(0.065, 8, 6), crimson, 2.8, { p: [0.085, 0.58, 0.23] })
    .add(sph(0.065, 8, 6), crimson, 2.8, { p: [-0.085, 0.58, 0.23] })
    .add(cone(0.055, 0.34, 6), gold, 1.5, { p: [0.18, 0.72, 0], r: [0, 0, -0.5] })
    .add(cone(0.055, 0.34, 6), gold, 1.5, { p: [-0.18, 0.72, 0], r: [0, 0, 0.5] });
  for (const s of [1, -1] as const) {
    addLimb(body, [s * 0.28, 0.28, 0], [s * 0.44, 0.06, 0.22], 0.075, 0.062, hide);
    body.add(oct(0.075), gold, 2.2, { p: [s * 0.45, 0.04, 0.26] });
  }

  const totem = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    b.add(cyl(0.09, 0.12, 0.68, 8), obsidian, 0, { p: [0, 0.28, 0], r: [0, 0, -side * 0.18] })
      .add(tor(0.16, 0.032, 6, 14).rotateX(Math.PI / 2), crimson, 2.8, { p: [side * 0.06, 0.38, 0] })
      .add(tor(0.13, 0.028, 6, 14).rotateX(Math.PI / 2), gold, 2.6, { p: [side * 0.09, 0.54, 0] })
      .add(oct(0.12), crimson, 3.0, { p: [side * 0.12, 0.68, 0], s: [0.85, 1.35, 0.85] });
    return b.build();
  };

  const leg = (): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [0, -0.42, 0.02], 0.11, 0.09, hide);
    b.add(box(0.2, 0.12, 0.28), obsidian, 0, { p: [0, -0.46, 0.05] });
    return b.build();
  };

  return {
    baseRadius: 0.68,
    height: 1.92,
    parts: [
      { name: 'body', geo: body.build(), joint: [0, 0.84, 0] },
      { name: 'totemL', geo: totem(1), joint: [0.34, 1.12, -0.05] },
      { name: 'totemR', geo: totem(-1), joint: [-0.34, 1.12, -0.05] },
      { name: 'legL', geo: leg(), joint: [0.19, 0.52, 0] },
      { name: 'legR', geo: leg(), joint: [-0.19, 0.52, 0] },
    ],
  };
}

/** 11. GLACIER（霜甲巨像）— Asymmetrical permafrost crystal behemoth with dorsal ice spires & cryo-prism fists */
function glacier(): MonsterModel {
  const deepIce = 0x16395c;
  const glacierBlue = 0x5ceeff;
  const frostCore = 0xd6fcff;
  const cobalt = 0x2b6cb0;

  const body = new GeoBuilder();
  body
    .add(oct(0.46), deepIce, 0, { p: [0, 0.16, 0], s: [1.18, 1.05, 0.92] })
    .add(oct(0.24), frostCore, 2.9, { p: [0, 0.2, 0.28], s: [0.95, 1.18, 0.55] })
    .add(tor(0.26, 0.036, 5, 6), glacierBlue, 2.4, { p: [0, 0.2, 0.26] })
    // Horned permafrost helmet + glowing cryo-slit visor
    .add(oct(0.24), cobalt, 0.2, { p: [0, 0.58, 0.08], s: [1.05, 0.92, 0.95] })
    .add(box(0.28, 0.075, 0.09), frostCore, 3.0, { p: [0, 0.58, 0.24] })
    // Towering asymmetrical dorsal glacier crystal spires
    .add(cone(0.14, 0.68, 5), glacierBlue, 2.2, { p: [0.28, 0.72, -0.14], r: [-0.36, 0, -0.34] })
    .add(cone(0.16, 0.76, 5), frostCore, 2.5, { p: [-0.26, 0.76, -0.12], r: [-0.32, 0, 0.36] })
    .add(cone(0.12, 0.58, 5), glacierBlue, 2.0, { p: [0, 0.82, -0.22], r: [-0.48, 0, 0] });

  const iceArm = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    b.add(oct(0.2), cobalt, 0.15, { p: [side * 0.06, -0.04, 0.02] });
    addLimb(b, [side * 0.06, -0.04, 0.02], [side * 0.14, -0.38, 0.18], 0.12, 0.14, deepIce);
    // Jagged crystal war-fist
    b.add(oct(0.22), glacierBlue, 1.8, { p: [side * 0.16, -0.48, 0.24], s: [1.05, 1.2, 1.15] })
      .add(cone(0.08, 0.26, 4).rotateX(Math.PI / 2), frostCore, 2.8, { p: [side * 0.16, -0.48, 0.44] });
    return b.build();
  };

  const leg = (): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [0, -0.44, 0.02], 0.13, 0.15, deepIce);
    b.add(oct(0.18), cobalt, 0.3, { p: [0, -0.48, 0.06], s: [1.1, 0.62, 1.3] });
    return b.build();
  };

  return {
    baseRadius: 0.86,
    height: 2.15,
    parts: [
      { name: 'body', geo: body.build(), joint: [0, 0.92, 0] },
      { name: 'armL', geo: iceArm(1), joint: [0.42, 1.08, 0.04] },
      { name: 'armR', geo: iceArm(-1), joint: [-0.42, 1.08, 0.04] },
      { name: 'legL', geo: leg(), joint: [0.23, 0.54, 0] },
      { name: 'legR', geo: leg(), joint: [-0.23, 0.54, 0] },
    ],
  };
}

/** 12. BEHOLDER（棱光狙击眼）— Solar-gold gyroscopic cyclops sentinel hovering over an anti-grav ground emitter */
function beholder(): MonsterModel {
  const obsidian = 0x1c162b;
  const gold = 0xffbe2e;
  const iris = 0xff3b5c;
  const pupil = 0xfff5d6;

  const core = new GeoBuilder();
  core
    .add(oct(0.38), obsidian, 0, { p: [0, 0.32, 0], s: [1.08, 1.08, 0.96] })
    // Giant glowing sniper lens iris + white-hot reticle pupil
    .add(sph(0.24, 14, 12), iris, 2.8, { p: [0, 0.32, 0.24], s: [1.0, 1.0, 0.62] })
    .add(sph(0.11, 10, 8), pupil, 3.2, { p: [0, 0.32, 0.37], s: [0.85, 1.25, 0.5] })
    .add(tor(0.26, 0.035, 6, 16), gold, 2.4, { p: [0, 0.32, 0.28] })
    // Crown sensor fin + anti-grav ground anchor projector so min.y touches ground cleanly
    .add(cone(0.09, 0.34, 4), gold, 2.2, { p: [0, 0.82, 0], r: [0, Math.PI / 4, 0] })
    .add(tor(0.28, 0.026, 5, 16).rotateX(Math.PI / 2), gold, 2.6, { p: [0, -0.74, 0] })
    .add(cone(0.06, 0.42, 5), iris, 2.0, { p: [0.16, -0.48, -0.06], r: [Math.PI, 0, 0.18] })
    .add(cone(0.06, 0.42, 5), iris, 2.0, { p: [-0.16, -0.48, -0.06], r: [Math.PI, 0, -0.18] });

  const ringOuter = new GeoBuilder();
  ringOuter
    .add(tor(0.56, 0.036, 6, 20), gold, 2.5, { r: [0.42, 0.25, 0] })
    .add(oct(0.085), pupil, 2.8, { p: [0.56, 0, 0] })
    .add(oct(0.085), pupil, 2.8, { p: [-0.56, 0, 0] });

  const ringInner = new GeoBuilder();
  ringInner
    .add(tor(0.46, 0.03, 6, 18).rotateX(Math.PI / 2), iris, 2.4, { r: [0.28, 0, -0.48] })
    .add(oct(0.07), gold, 2.6, { p: [0, 0.46, 0] })
    .add(oct(0.07), gold, 2.6, { p: [0, -0.46, 0] });

  return {
    baseRadius: 0.64,
    height: 1.88,
    parts: [
      { name: 'core', geo: core.build(), joint: [0, 0.78, 0] },
      { name: 'ringOuter', geo: ringOuter.build(), joint: [0, 1.1, 0] },
      { name: 'ringInner', geo: ringInner.build(), joint: [0, 1.1, 0] },
    ],
  };
}

/** 13. BURROWER（钻地裂甲虫）— Low-slung magma-chitin scarab tank with twin spinning nose augers & shovel claws */
function burrower(): MonsterModel {
  const shell = 0x2b1512;
  const plate = 0x7c2d12;
  const magma = 0xff7722;
  const flare = 0xffe066;

  const carapace = new GeoBuilder();
  carapace
    // Faceted armored scarab tank hull + 3 overlapping beveled carapace plates (zero coplanar sphere poke-through!)
    .add(oct(0.44), shell, 0, { p: [0, 0.12, -0.04], s: [1.12, 0.68, 1.32] })
    .add(box(0.68, 0.11, 0.28), plate, 0.15, { p: [0, 0.32, 0.18], r: [0.24, 0, 0] })
    .add(box(0.64, 0.11, 0.28), plate, 0.15, { p: [0, 0.34, -0.08], r: [0.04, 0, 0] })
    .add(box(0.54, 0.11, 0.26), plate, 0.15, { p: [0, 0.29, -0.34], r: [-0.22, 0, 0] })
    // Glowing dorsal magma core vents & slanted armored visor optics
    .add(box(0.44, 0.055, 0.075), magma, 2.9, { p: [0, 0.4, 0.06] })
    .add(box(0.36, 0.055, 0.075), flare, 2.9, { p: [0, 0.38, -0.2] })
    .add(box(0.16, 0.055, 0.08), flare, 3.0, { p: [0.19, 0.2, 0.42], r: [0, 0.22, -0.22] })
    .add(box(0.16, 0.055, 0.08), flare, 3.0, { p: [-0.19, 0.2, 0.42], r: [0, -0.22, 0.22] });

  const drill = new GeoBuilder();
  drill
    // 3-Stage faceted tungsten-magma auger bit (replaces smooth orange cone!)
    .add(cyl(0.18, 0.25, 0.22, 6).rotateX(Math.PI / 2), shell, 0, { p: [0, 0, 0.08] })
    .add(cyl(0.11, 0.19, 0.22, 6).rotateX(Math.PI / 2), plate, 0.6, { p: [0, 0, 0.28], r: [0, 0, 0.52] })
    .add(cone(0.12, 0.3, 6).rotateX(Math.PI / 2), flare, 2.9, { p: [0, 0, 0.52] })
    .add(tor(0.23, 0.032, 5, 8), magma, 2.8, { p: [0, 0, 0.14] })
    .add(tor(0.16, 0.028, 5, 8), flare, 2.9, { p: [0, 0, 0.34] });

  const digClaw = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [side * 0.26, -0.1, 0.14], 0.085, 0.075, plate);
    b.add(box(0.2, 0.09, 0.32), magma, 1.9, {
      p: [side * 0.32, -0.22, 0.26],
      r: [0.25, -side * 0.28, 0],
    });
    // Rear Stabilizer leg touching y = -0.36 so model stands solidly on ground
    addLimb(b, [0, -0.02, -0.32], [side * 0.28, -0.32, -0.36], 0.075, 0.055, shell);
    return b.build();
  };

  return {
    baseRadius: 0.62,
    height: 1.34,
    parts: [
      { name: 'carapace', geo: carapace.build(), joint: [0, 0.38, 0] },
      { name: 'drill', geo: drill.build(), joint: [0, 0.42, 0.44] },
      { name: 'clawL', geo: digClaw(1), joint: [0.3, 0.36, 0.1] },
      { name: 'clawR', geo: digClaw(-1), joint: [-0.3, 0.36, 0.1] },
    ],
  };
}

/** 14. NECROMANCER（纳米织网者）— Towering emerald cyber-lich with horned jade halo & dual DNA-helix conduits */
function necromancer(): MonsterModel {
  const robe = 0x102924;
  const chitin = 0x1b4d3e;
  const emerald = 0x2dff9e;
  const lime = 0xb8ff66;

  const body = new GeoBuilder();
  body
    // Tattered cyber-lich lower shroud reaching ground plane + narrow wasp thorax
    .add(cone(0.36, 0.92, 7), robe, 0, { p: [0, -0.38, 0], r: [Math.PI, 0, 0] })
    .add(oct(0.24), chitin, 0.2, { p: [0, 0.2, 0], s: [1.05, 1.25, 0.85] })
    .add(oct(0.13), emerald, 3.0, { p: [0, 0.24, 0.19], s: [0.85, 1.3, 0.55] })
    // Skull-visored cyber-priest head + floating emerald neural halo crown
    .add(sph(0.19, 12, 10), WHITE, 0.2, { p: [0, 0.58, 0.05], s: [0.9, 1.08, 0.92] })
    .add(sph(0.06, 8, 6), emerald, 3.0, { p: [0.075, 0.6, 0.21] })
    .add(sph(0.06, 8, 6), emerald, 3.0, { p: [-0.075, 0.6, 0.21] })
    .add(tor(0.28, 0.032, 6, 16).rotateX(Math.PI / 2 - 0.35), lime, 2.8, { p: [0, 0.84, -0.04] })
    .add(cone(0.055, 0.36, 5), emerald, 2.2, { p: [0.22, 0.78, -0.06], r: [-0.2, 0, -0.45] })
    .add(cone(0.055, 0.36, 5), emerald, 2.2, { p: [-0.22, 0.78, -0.06], r: [-0.2, 0, 0.45] });

  const staffArm = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [side * 0.16, -0.18, 0.2], 0.062, 0.05, chitin);
    // Tall glowing nano-helix conduit staff
    b.add(cyl(0.032, 0.032, 1.08, 8), robe, 0, { p: [side * 0.18, -0.06, 0.26] })
      .add(oct(0.13), emerald, 3.0, { p: [side * 0.18, 0.52, 0.26], s: [0.9, 1.35, 0.9] })
      .add(tor(0.16, 0.024, 5, 12), lime, 2.6, { p: [side * 0.18, 0.52, 0.26], r: [0.4, side * 0.5, 0] });
    return b.build();
  };

  return {
    baseRadius: 0.66,
    height: 1.98,
    parts: [
      { name: 'body', geo: body.build(), joint: [0, 0.86, 0] },
      { name: 'staffL', geo: staffArm(1), joint: [0.26, 1.04, 0.04] },
      { name: 'staffR', geo: staffArm(-1), joint: [-0.26, 1.04, 0.04] },
    ],
  };
}

export function buildMonsterModels(): Record<EnemyKind, MonsterModel> {
  return {
    crawler: crawler(),
    dasher: dasher(),
    bastion: bastion(),
    mitosis: mitosis(),
    siphon: siphon(),
    bomber: bomber(),
    phalanx: phalanx(),
    stalker: stalker(),
    brood: brood(),
    howler: howler(),
    glacier: glacier(),
    beholder: beholder(),
    burrower: burrower(),
    necromancer: necromancer(),
  };
}
