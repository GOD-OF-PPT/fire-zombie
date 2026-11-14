import * as THREE from 'three';
import type { EnemyKind } from '../../types/game';
import { GeoBuilder, addLimb, box, cone, cyl, sph, tor } from './kit';
import type { RigPartDef } from './rig';

/**
 * 「故障病毒」 monster roster. All monsters face +Z (toward the camera / the squad),
 * so faces, eyes and teeth are the readable side. Built at their sim base radius;
 * the renderer scales the root by (radius / baseRadius).
 */

export interface MonsterModel {
  parts: RigPartDef[];
  baseRadius: number;
}

const WHITE = 0xfff4ea;
const BLACK = 0x07020a;

function crawler(): MonsterModel {
  const body = new GeoBuilder();
  body
    .add(sph(0.3, 14, 10), 0x3b0f33, 0, { p: [0, 0.04, -0.2], s: [1, 0.8, 1.25] })
    .add(sph(0.22, 14, 10), 0x5c1438, 0, { p: [0, 0, 0.12] })
    .add(sph(0.088, 10, 8), 0xffe14a, 2.6, { p: [0, 0.08, 0.3] })
    .add(sph(0.04, 8, 6), BLACK, 0, { p: [0, 0.08, 0.38] })
    .add(sph(0.05, 8, 6), 0xffe14a, 2.4, { p: [0.11, 0.12, 0.25] })
    .add(sph(0.05, 8, 6), 0xffe14a, 2.4, { p: [-0.11, 0.12, 0.25] })
    .add(cone(0.035, 0.16, 6), WHITE, 0.2, { p: [0.08, -0.08, 0.34], r: [Math.PI / 2, 0, 0.4] })
    .add(cone(0.035, 0.16, 6), WHITE, 0.2, { p: [-0.08, -0.08, 0.34], r: [Math.PI / 2, 0, -0.4] });
  for (let i = 0; i < 3; i++) {
    body.add(box(0.36 - i * 0.06, 0.025, 0.035), 0xff3fd2, 2, { p: [0, 0.26 - i * 0.015, -0.08 - i * 0.12] });
    body.add(cone(0.04, 0.14, 5), 0xff3b5c, 1, { p: [0, 0.28 - i * 0.02, -0.12 - i * 0.12], r: [-0.4, 0, 0] });
  }
  const legs = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    for (const z of [0.14, 0, -0.15]) {
      const dz = z * 0.6;
      addLimb(b, [0, 0, z], [side * 0.28, 0.14, z + dz], 0.035, 0.03, 0x2a0a26);
      addLimb(b, [side * 0.28, 0.14, z + dz], [side * 0.43, -0.34, z + dz * 1.5], 0.03, 0.016, 0x2a0a26);
      b.add(sph(0.025, 6, 4), 0xff3fd2, 2, { p: [side * 0.43, -0.34, z + dz * 1.5] });
    }
    return b.build();
  };
  return {
    baseRadius: 0.48,
    parts: [
      { name: 'body', geo: body.build(), joint: [0, 0.38, 0] },
      { name: 'legsL', geo: legs(1), joint: [0.15, 0.36, 0] },
      { name: 'legsR', geo: legs(-1), joint: [-0.15, 0.36, 0] },
    ],
  };
}

function dasher(): MonsterModel {
  const hide = 0x3d1414;
  const body = new GeoBuilder();
  body
    .add(sph(0.22, 14, 10), hide, 0, { s: [1, 0.9, 1.6] })
    .add(sph(0.18, 12, 8), 0x6a2418, 0, { p: [0, -0.05, 0.05], s: [0.9, 0.8, 1.4] });
  for (let i = 0; i < 4; i++) {
    body.add(cone(0.05, 0.2 - i * 0.02, 4), 0xff7a1a, 1.6, { p: [0, 0.22 - i * 0.01, 0.22 - i * 0.15], r: [-0.6, 0, 0] });
  }
  addLimb(body, [0, 0.05, -0.3], [0, 0.22, -0.62], 0.06, 0.015, hide);
  body.add(sph(0.03, 6, 4), 0xff7a1a, 2.5, { p: [0, 0.22, -0.62] });
  const head = new GeoBuilder();
  head
    .add(sph(0.17, 14, 10), 0x521a1a, 0, { p: [0, 0.03, 0.08], s: [0.85, 0.75, 1.2] })
    .add(box(0.14, 0.09, 0.18), 0x521a1a, 0, { p: [0, -0.01, 0.24] })
    .add(sph(0.042, 8, 6), 0xffd23f, 3, { p: [0.075, 0.07, 0.19] })
    .add(sph(0.042, 8, 6), 0xffd23f, 3, { p: [-0.075, 0.07, 0.19] })
    .add(cone(0.035, 0.22, 5), 0xffe2c0, 0.1, { p: [0.09, 0.15, 0.0], r: [-1.1, 0, -0.3] })
    .add(cone(0.035, 0.22, 5), 0xffe2c0, 0.1, { p: [-0.09, 0.15, 0.0], r: [-1.1, 0, 0.3] });
  for (const x of [-0.045, 0, 0.045]) head.add(cone(0.014, 0.05, 4), WHITE, 0.2, { p: [x, -0.07, 0.31], r: [Math.PI, 0, 0] });
  const jaw = new GeoBuilder();
  jaw.add(box(0.12, 0.04, 0.2), 0x2a0c0c, 0, { p: [0, -0.02, 0.1] }).add(box(0.09, 0.015, 0.16), 0xff5a3c, 1.2, { p: [0, 0.0, 0.1] });
  for (const x of [-0.04, 0.04]) jaw.add(cone(0.014, 0.05, 4), WHITE, 0.2, { p: [x, 0.02, 0.18] });
  const leg = (): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [0, -0.25, -0.06], 0.065, 0.045, hide);
    addLimb(b, [0, -0.25, -0.06], [0, -0.5, 0.02], 0.045, 0.035, 0x2b0e0e);
    b.add(sph(0.05, 8, 6), 0x2b0e0e, 0, { p: [0, -0.5, 0.04], s: [1, 0.6, 1.3] });
    b.add(cone(0.012, 0.05, 4), WHITE, 0.2, { p: [0, -0.52, 0.1], r: [Math.PI / 2, 0, 0] });
    return b.build();
  };
  return {
    baseRadius: 0.58,
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
  const stone = 0x2c3040;
  const plate = 0x3a3f55;
  const red = 0xff2a4a;
  const body = new GeoBuilder();
  body
    .add(sph(0.7, 16, 12), stone, 0, { p: [0, 0.2, 0], s: [1.15, 0.9, 0.75] })
    .add(box(0.7, 0.4, 0.2), plate, 0, { p: [0, 0.3, 0.42] })
    .add(box(0.5, 0.03, 0.03), red, 2.2, { p: [0, 0.38, 0.53] })
    .add(box(0.03, 0.3, 0.03), red, 2.2, { p: [0, 0.25, 0.53] })
    .add(sph(0.32, 12, 8), plate, 0, { p: [0.62, 0.42, 0] })
    .add(sph(0.32, 12, 8), plate, 0, { p: [-0.62, 0.42, 0] });
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) body.add(cone(0.07, 0.3, 5), red, 1.2, { p: [s * (0.55 + i * 0.1), 0.72 - i * 0.05, -0.05 + i * 0.05], r: [0, 0, -s * (0.3 + i * 0.25)] });
  }
  const head = new GeoBuilder();
  head
    .add(box(0.36, 0.3, 0.34), plate, 0, { p: [0, 0.12, 0] })
    .add(sph(0.1, 10, 8), red, 3.2, { p: [0, 0.14, 0.17] })
    .add(box(0.4, 0.06, 0.06), stone, 0, { p: [0, 0.25, 0.16] })
    .add(cone(0.06, 0.3, 5), 0xd8d0c0, 0.1, { p: [0.2, 0.3, 0], r: [0, 0, -0.6] })
    .add(cone(0.06, 0.3, 5), 0xd8d0c0, 0.1, { p: [-0.2, 0.3, 0], r: [0, 0, 0.6] });
  const arm = (side: 1 | -1): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [side * 0.1, -0.48, 0.12], 0.17, 0.14, stone);
    addLimb(b, [side * 0.1, -0.48, 0.12], [side * 0.05, -0.92, 0.3], 0.15, 0.18, plate);
    b.add(sph(0.23, 12, 8), stone, 0, { p: [side * 0.05, -1.0, 0.34] });
    for (const z of [-0.1, 0.1]) b.add(cone(0.05, 0.16, 5), red, 1.4, { p: [side * 0.2, -0.95, 0.34 + z], r: [0, 0, -side * 1.3] });
    b.add(box(0.03, 0.3, 0.03), red, 2, { p: [side * 0.18, -0.7, 0.24] });
    return b.build();
  };
  const leg = (): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    addLimb(b, [0, 0, 0], [0, -0.48, 0.02], 0.2, 0.17, stone);
    b.add(box(0.34, 0.14, 0.44), plate, 0, { p: [0, -0.55, 0.06] });
    return b.build();
  };
  const shield = new GeoBuilder();
  shield
    .add(cyl(0.95, 0.95, 0.12, 6).rotateX(Math.PI / 2), 0x3a0810, 0)
    .add(cyl(0.78, 0.78, 0.04, 6).rotateX(Math.PI / 2), red, 0.55, { p: [0, 0, 0.07] })
    .add(tor(0.93, 0.05, 4, 6).rotateZ(Math.PI / 6), red, 2.4, { p: [0, 0, 0.07] })
    .add(tor(0.45, 0.03, 4, 6).rotateZ(Math.PI / 6), 0xff9a3c, 2.2, { p: [0, 0, 0.1] })
    .add(box(1.5, 0.035, 0.03), red, 1.8, { p: [0, 0, 0.1] })
    .add(box(0.035, 1.5, 0.03), red, 1.8, { p: [0, 0, 0.1] });
  return {
    baseRadius: 1.15,
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
    .add(sph(0.62, 24, 16), 0xd02aa8, 0.55)
    .add(sph(0.6, 20, 10), 0x5a0e4a, 0.1, { p: [0, -0.18, 0], s: [1.04, 0.55, 1.04] });
  const spots: Array<[number, number, number]> = [[0.3, 0.45, 0.1], [-0.35, 0.4, -0.15], [0.05, 0.55, -0.3], [0.45, 0.15, -0.35], [-0.5, 0.1, 0.15]];
  for (const p of spots) body.add(sph(0.09, 8, 6), 0xffa3ec, 1.8, { p });
  const face = new GeoBuilder();
  for (const s of [1, -1]) {
    face
      .add(sph(0.17, 12, 10), WHITE, 0.5, { p: [s * 0.21, 0.13, 0.48] })
      .add(sph(0.085, 10, 8), BLACK, 0, { p: [s * 0.2, 0.12, 0.62] })
      .add(sph(0.03, 6, 4), 0xffffff, 3, { p: [s * 0.17, 0.16, 0.69] });
  }
  face.add(tor(0.11, 0.028, 4, 12, Math.PI), 0x3a0030, 0, { p: [0, -0.1, 0.57], r: [0, 0, Math.PI] });
  const cells = new GeoBuilder();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    cells.add(sph(0.11, 10, 8), 0xff7ae0, 1.4, { p: [Math.cos(a) * 0.82, 0.1 + (i % 2) * 0.25, Math.sin(a) * 0.82] });
  }
  return {
    baseRadius: 0.72,
    parts: [
      { name: 'body', geo: body.build(), joint: [0, 0.62, 0] },
      { name: 'face', geo: face.build(), joint: [0, 0.62, 0] },
      { name: 'cells', geo: cells.build(), joint: [0, 0.62, 0] },
    ],
  };
}

function siphon(): MonsterModel {
  const head = new GeoBuilder();
  head
    .add(new THREE.SphereGeometry(0.45, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x5a1f9a, 0.5)
    .add(cyl(0.45, 0.36, 0.1, 18), 0x2a0a4a, 0, { p: [0, -0.05, 0] })
    .add(tor(0.45, 0.035, 6, 24).rotateX(Math.PI / 2), 0xd08bff, 2.2)
    .add(sph(0.17, 12, 10), WHITE, 0.3, { p: [0, 0.14, 0.33] })
    .add(sph(0.095, 10, 8), 0x7dff6b, 2.6, { p: [0, 0.14, 0.45] })
    .add(sph(0.045, 8, 6), BLACK, 0, { p: [0, 0.14, 0.53] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    head.add(sph(0.05, 6, 4), 0x7dff6b, 2, { p: [Math.cos(a) * 0.3, 0.3, Math.sin(a) * 0.3 - 0.05] });
  }
  const tents = (offset: number): THREE.BufferGeometry => {
    const b = new GeoBuilder();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + offset;
      const rx = Math.cos(a) * 0.26;
      const rz = Math.sin(a) * 0.26;
      addLimb(b, [rx, 0, rz], [rx * 1.35, -0.4, rz * 1.35], 0.07, 0.045, 0x3a1066);
      addLimb(b, [rx * 1.35, -0.4, rz * 1.35], [rx * 1.05, -0.85, rz * 1.05], 0.045, 0.018, 0x3a1066);
      b.add(sph(0.03, 6, 4), 0x7dff6b, 2.6, { p: [rx * 1.05, -0.86, rz * 1.05] });
    }
    return b.build();
  };
  return {
    baseRadius: 0.68,
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

/**
 * Procedural animation. Writes per-part euler rotations (rot, xyz triples), uniform scales (scl)
 * and offsets (off, xyz triples). `ph` is a per-instance running phase.
 */
export function poseMonster(
  kind: EnemyKind,
  ph: number,
  tele: boolean,
  rot: Float32Array,
  scl: Float32Array,
  off: Float32Array,
): void {
  rot.fill(0);
  scl.fill(1);
  off.fill(0);
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  switch (kind) {
    case 'crawler': {
      const bob = Math.abs(Math.sin(ph * 2)) * 0.05;
      off[1] = bob;
      rot[2] = s * 0.08;
      rot[3 + 1] = s * 0.35; rot[3 + 2] = c * 0.25; off[4] = bob;
      rot[6 + 1] = s * 0.35; rot[6 + 2] = c * 0.25; off[7] = bob;
      break;
    }
    case 'dasher': {
      const run = tele ? 0.15 : 0.85;
      const crouch = tele ? -0.12 : Math.abs(s) * 0.05;
      for (let k = 0; k < 3; k++) off[k * 3 + 1] = crouch;
      rot[0] = s * 0.1 * run + (tele ? 0.15 : 0);
      rot[3] = (tele ? 0.45 : -s * 0.12) ; // head
      rot[6] = tele ? 0.75 + Math.sin(ph * 6) * 0.1 : 0.15 + Math.abs(c) * 0.25; // jaw open
      rot[9] = s * run; rot[12] = s * run; // front pair
      rot[15] = -s * run; rot[18] = -s * run; // back pair
      if (tele) { for (let k = 3; k < 7; k++) rot[k * 3] = 0.25; }
      break;
    }
    case 'bastion': {
      const step = Math.sin(ph * 0.6);
      off[1] = Math.abs(step) * 0.06;
      rot[2] = step * 0.06;
      rot[3 + 1] = Math.sin(ph * 0.3) * 0.25; off[4] = off[1];
      rot[6] = -0.75 + step * 0.08; off[7] = off[1];
      rot[9] = -0.75 - step * 0.08; off[10] = off[1];
      rot[12] = step * 0.35;
      rot[15] = -step * 0.35;
      off[19] = off[1];
      break;
    }
    case 'mitosis': {
      const sq = Math.sin(ph * 1.6);
      const bounce = Math.abs(Math.sin(ph * 0.8)) * 0.18;
      scl[0] = 1 + sq * 0.06;
      off[1] = bounce; off[4] = bounce + sq * 0.02; off[7] = bounce;
      rot[1] = Math.sin(ph * 0.4) * 0.3; rot[4] = rot[1];
      rot[7] = ph * 0.9;
      break;
    }
    case 'siphon': {
      const bob = Math.sin(ph * 0.7) * 0.12;
      off[1] = bob; off[4] = bob; off[7] = bob;
      rot[0] = Math.sin(ph * 0.5) * 0.08;
      rot[3] = s * 0.22; rot[5] = c * 0.12;
      rot[6] = -s * 0.22; rot[8] = -c * 0.12;
      rot[4] = ph * 0.3; rot[7] = -ph * 0.3;
      break;
    }
  }
}
