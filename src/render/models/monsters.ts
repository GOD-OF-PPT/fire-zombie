import * as THREE from 'three';
import type { EnemyKind } from '../../types/game';
import { GeoBuilder, addLimb, box, cone, cyl, oct, sph, tor } from './kit';
import type { RigPartDef } from './rig';

/**
 * High-detail stylized monster roster (used alongside or in place of GLB models).
 * All monsters face +Z (toward the squad) with crisp Q-version silhouettes & high-contrast accents.
 */

export interface MonsterModel {
  parts: RigPartDef[];
  baseRadius: number;
  height: number;
}

const WHITE = 0xfff6ee;
const BLACK = 0x0a0e1d;

function crawler(): MonsterModel {
  const main = 0xff2852;
  const carapace = 0x8f1133;
  const body = new GeoBuilder();
  body
    .add(sph(0.31, 16, 12), main, 0, { p: [0, 0.05, -0.18], s: [1.05, 0.84, 1.28] })
    .add(sph(0.26, 14, 10), carapace, 0, { p: [0, 0.13, -0.16], s: [0.95, 0.65, 1.15] })
    .add(sph(0.23, 14, 10), 0xff5878, 0, { p: [0, 0.0, 0.13] })
    // Expressive glowing compound eyes & mandibles
    .add(sph(0.094, 10, 8), 0xffe44d, 2.6, { p: [0, 0.09, 0.31] })
    .add(sph(0.044, 8, 6), BLACK, 0, { p: [0, 0.09, 0.39] })
    .add(sph(0.058, 8, 6), 0xffe44d, 2.4, { p: [0.125, 0.125, 0.25] })
    .add(sph(0.058, 8, 6), 0xffe44d, 2.4, { p: [-0.125, 0.125, 0.25] })
    .add(cone(0.04, 0.19, 6), WHITE, 0.2, { p: [0.095, -0.075, 0.35], r: [Math.PI / 2, 0, 0.42] })
    .add(cone(0.04, 0.19, 6), WHITE, 0.2, { p: [-0.095, -0.075, 0.35], r: [Math.PI / 2, 0, -0.42] });
  for (let i = 0; i < 4; i++) {
    body.add(oct(0.068 - i * 0.01), 0xff4ae0, 2.2, {
      p: [0, 0.3 - i * 0.025, 0.02 - i * 0.12],
      s: [0.7, 1.45, 0.8],
      r: [-0.35, 0, 0],
    });
  }
  const legs = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    for (const z of [0.15, 0, -0.16]) {
      const dz = z * 0.6;
      addLimb(b, [0, 0, z], [side * 0.29, 0.15, z + dz], 0.038, 0.032, carapace);
      addLimb(b, [side * 0.29, 0.15, z + dz], [side * 0.44, -0.34, z + dz * 1.5], 0.032, 0.016, main);
      b.add(oct(0.03), 0xff4ae0, 2, { p: [side * 0.44, -0.34, z + dz * 1.5] });
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
    .add(sph(0.23, 14, 10), hide, 0, { s: [1.02, 0.92, 1.62] })
    .add(sph(0.18, 12, 8), armor, 0, { p: [0, 0.1, -0.02], s: [0.92, 0.6, 1.45] })
    .add(sph(0.18, 12, 8), flame, 0.6, { p: [0, -0.05, 0.06], s: [0.88, 0.78, 1.38] });
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
    .add(box(0.38, 0.32, 0.35), hide, 0, { p: [0, 0.12, 0] })
    .add(box(0.42, 0.11, 0.22), darkIron, 0, { p: [0, 0.25, 0.08] })
    .add(sph(0.1, 10, 8), 0xffe44d, 2.4, { p: [0.09, 0.14, 0.16] })
    .add(sph(0.1, 10, 8), 0xffe44d, 2.4, { p: [-0.09, 0.14, 0.16] })
    .add(sph(0.045, 8, 6), BLACK, 0, { p: [0.09, 0.14, 0.25] })
    .add(sph(0.045, 8, 6), BLACK, 0, { p: [-0.09, 0.14, 0.25] })
    .add(cone(0.07, 0.36, 6), plate, 0.8, { p: [0.22, 0.32, 0], r: [0, 0, -0.62] })
    .add(cone(0.07, 0.36, 6), plate, 0.8, { p: [-0.22, 0.32, 0], r: [0, 0, 0.62] })
    .add(cone(0.04, 0.14, 5), WHITE, 0.2, { p: [0.11, 0.02, 0.22], r: [0.4, 0, 0] })
    .add(cone(0.04, 0.14, 5), WHITE, 0.2, { p: [-0.11, 0.02, 0.22], r: [0.4, 0, 0] });

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
      // Spiked magma war-club in right hand
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
  const body = new GeoBuilder();
  body
    .add(sph(0.62, 24, 16), 0xff3ad6, 0.45)
    .add(sph(0.6, 20, 12), 0x8f24ff, 0.15, { p: [0, -0.18, 0], s: [1.06, 0.56, 1.06] })
    // Twin internal dividing nuclei crowns
    .add(oct(0.18), 0x62f4ff, 2.8, { p: [0.18, 0.48, 0], r: [0, 0, -0.25] })
    .add(oct(0.18), 0xffea75, 2.8, { p: [-0.18, 0.48, 0], r: [0, 0, 0.25] });
  const spots: Array<[number, number, number]> = [
    [0.32, 0.42, 0.12],
    [-0.35, 0.38, -0.15],
    [0.05, 0.54, -0.32],
    [0.46, 0.15, -0.35],
    [-0.5, 0.12, 0.15],
  ];
  for (const p of spots) body.add(sph(0.095, 8, 6), 0xffb3f4, 2.0, { p });
  const face = new GeoBuilder();
  for (const s of [1, -1]) {
    face
      .add(sph(0.175, 12, 10), WHITE, 0.5, { p: [s * 0.21, 0.13, 0.48] })
      .add(sph(0.09, 10, 8), BLACK, 0, { p: [s * 0.2, 0.12, 0.62] })
      .add(sph(0.034, 6, 4), 0xffffff, 3, { p: [s * 0.17, 0.16, 0.69] });
  }
  face.add(tor(0.115, 0.03, 5, 14, Math.PI), 0x3a0034, 0, { p: [0, -0.1, 0.57], r: [0, 0, Math.PI] });
  const cells = new GeoBuilder();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cells.add(sph(0.115, 10, 8), i % 2 ? 0x62f4ff : 0xff85e8, 2.0, {
      p: [Math.cos(a) * 0.84, 0.08 + (i % 3) * 0.18, Math.sin(a) * 0.84],
    });
  }
  return {
    baseRadius: 0.72,
    height: 1.28,
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
    // Necromancer crown spikes + skull mask
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

export function buildMonsterModels(): Record<EnemyKind, MonsterModel> {
  return { crawler: crawler(), dasher: dasher(), bastion: bastion(), mitosis: mitosis(), siphon: siphon() };
}
