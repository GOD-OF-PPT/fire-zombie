import * as THREE from 'three';
import type { BossId } from '../../types/game';
import { GeoBuilder, addLimb, box, cone, cyl, ico, oct, sph, tor } from './kit';
import { makeCharacterMaterial } from './rig';

/**
 * Creature bosses. Each rig is a plain scene-graph (a handful of meshes) driven procedurally.
 * Roots sit on the ground at the boss's sim position; `coreHeight` is where the hit core lives
 * (shield bubbles, pylon beams and death bursts aim there).
 */

export interface BossPose {
  t: number;
  dt: number;
  phase: number;
  flash: number;
  dying: boolean;
  squadX: number;
  /** world x/z of the boss (root is already positioned there) */
  x: number;
  z: number;
  secondary: { x: number; z: number } | null;
}

export interface BossRig {
  root: THREE.Group;
  /** Hydra's second head lives in world space */
  secondary?: THREE.Group;
  coreHeight: number;
  secondaryCoreHeight?: number;
  mats: THREE.MeshStandardMaterial[];
  update(p: BossPose): void;
}

type Uniforms = { uGlow: { value: number }; uRimStrength: { value: number } };
const uni = (m: THREE.MeshStandardMaterial): Uniforms => m.userData.uniforms as Uniforms;

function applyFlash(m: THREE.MeshStandardMaterial, baseGlow: number, p: BossPose): void {
  const u = uni(m);
  const heat = (p.phase - 1) * 0.35;
  u.uGlow.value = baseGlow * (1 + heat) + p.flash * 0.5 + (p.dying ? Math.random() * 2.5 : 0);
  u.uRimStrength.value = 0.45 + p.flash * 0.45 + heat * 0.3;
  m.emissive.setScalar(p.flash * 0.1);
}

const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => new THREE.Mesh(geo, mat);

// ------------------------------------------------------------------ WARDEN-01 赤棱守卫
function warden(): BossRig {
  const mat = makeCharacterMaterial(0xff6a5c, 0.5, 1.6, 0.22);
  const ROCK = 0x3a1220;
  const ROCK2 = 0x5a1a2a;
  const RED = 0xff2a4a;
  const EMBER = 0xffa04a;
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.1;
  root.add(body);

  // legs (static, slightly animated by body bob)
  for (const s of [1, -1]) {
    const lg = new GeoBuilder();
    addLimb(lg, [s * 0.75, 2.1, 0], [s * 1.0, 1.0, 0.25], 0.42, 0.36, ROCK);
    addLimb(lg, [s * 1.0, 1.0, 0.25], [s * 1.05, 0.25, 0.05], 0.36, 0.3, ROCK);
    lg.add(ico(0.36, 0), ROCK2, 0, { p: [s * 1.0, 1.05, 0.4], s: [1, 1, 0.8] })
      .add(box(0.95, 0.38, 1.25), ROCK, 0, { p: [s * 1.05, 0.19, 0.18] })
      .add(cone(0.12, 0.4, 4), RED, 2.2, { p: [s * 1.05, 0.25, 0.85], r: [Math.PI / 2, 0, 0] })
      .add(oct(0.18), RED, 2.6, { p: [s * 1.02, 1.05, 0.68] });
    root.add(mesh(lg.build(), mat));
  }

  // torso
  const torso = new GeoBuilder();
  torso
    .add(box(1.6, 0.5, 1.0), ROCK, 0, { p: [0, 0.05, 0] })
    .add(ico(1.25, 0), ROCK, 0, { p: [0, 1.25, 0], s: [1.35, 1.05, 0.85] })
    .add(ico(0.9, 0), ROCK2, 0, { p: [0, 1.45, 0.25], s: [1.3, 0.9, 0.8] })
    // crystal heart (the weak point)
    .add(oct(0.55), RED, 3.2, { p: [0, 1.35, 0.95], s: [1, 1.35, 0.7] })
    .add(tor(0.62, 0.07, 5, 18), EMBER, 2.4, { p: [0, 1.35, 0.9] })
    // magma cracks
    .add(box(0.08, 0.9, 0.05), EMBER, 2.4, { p: [0.55, 1.1, 0.78], r: [0, 0, 0.5] })
    .add(box(0.08, 0.7, 0.05), EMBER, 2.4, { p: [-0.6, 1.0, 0.76], r: [0, 0, -0.6] })
    .add(box(0.5, 0.08, 0.05), EMBER, 2.2, { p: [0, 0.4, 0.62] });
  // shoulder crystal clusters
  for (const s of [1, -1]) {
    torso
      .add(ico(0.55, 0), ROCK2, 0, { p: [s * 1.45, 1.9, 0] })
      .add(cone(0.22, 1.1, 5), RED, 2.6, { p: [s * 1.55, 2.55, -0.05], r: [-0.15, 0, -s * 0.35] })
      .add(cone(0.15, 0.75, 5), RED, 2.4, { p: [s * 1.85, 2.3, 0.15], r: [0.2, 0, -s * 0.8] })
      .add(cone(0.13, 0.6, 5), EMBER, 2.2, { p: [s * 1.2, 2.45, -0.3], r: [-0.4, 0, -s * 0.15] });
  }
  // back spines
  for (let i = 0; i < 4; i++) torso.add(cone(0.18 - i * 0.02, 0.9 - i * 0.12, 5), RED, 2.2, { p: [0, 2.2 - i * 0.35, -0.65 - i * 0.05], r: [-0.9, 0, 0] });
  body.add(mesh(torso.build(), mat));

  // head
  const headG = new GeoBuilder();
  headG
    .add(ico(0.48, 0), ROCK, 0, { s: [1.15, 0.9, 1] })
    .add(box(0.8, 0.12, 0.3), ROCK2, 0, { p: [0, 0.08, 0.32] })
    .add(oct(0.1), 0xffe14a, 3.4, { p: [0.2, 0.0, 0.45], s: [1.6, 0.8, 0.5] })
    .add(oct(0.1), 0xffe14a, 3.4, { p: [-0.2, 0.0, 0.45], s: [1.6, 0.8, 0.5] })
    .add(box(0.42, 0.05, 0.05), EMBER, 2.4, { p: [0, -0.25, 0.42] })
    .add(cone(0.12, 0.85, 5), RED, 2.4, { p: [0.38, 0.5, -0.05], r: [-0.3, 0, -0.5] })
    .add(cone(0.12, 0.85, 5), RED, 2.4, { p: [-0.38, 0.5, -0.05], r: [-0.3, 0, 0.5] })
    .add(cone(0.1, 0.55, 5), EMBER, 2.2, { p: [0, 0.55, -0.1], r: [-0.4, 0, 0] });
  const head = mesh(headG.build(), mat);
  head.position.set(0, 2.6, 0.35);
  body.add(head);

  // arms on shoulder pivots
  const arms: THREE.Object3D[] = [];
  for (const s of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 1.55, 1.75, 0);
    const a = new GeoBuilder();
    addLimb(a, [0, 0, 0], [s * 0.45, -1.15, 0.35], 0.36, 0.3, ROCK);
    addLimb(a, [s * 0.45, -1.15, 0.35], [s * 0.5, -2.05, 0.95], 0.3, 0.36, ROCK);
    a.add(ico(0.32, 0), ROCK2, 0, { p: [s * 0.45, -1.15, 0.35] })
      // crystal fist
      .add(ico(0.62, 0), ROCK2, 0, { p: [s * 0.52, -2.35, 1.1], s: [1, 0.9, 1] })
      .add(oct(0.32), RED, 3, { p: [s * 0.52, -2.3, 1.62], s: [1, 1, 1.2] })
      .add(cone(0.12, 0.5, 4), RED, 2.6, { p: [s * 0.9, -2.2, 1.2], r: [0, 0, -s * 1.3] })
      .add(cone(0.12, 0.5, 4), RED, 2.6, { p: [s * 0.52, -1.85, 1.2], r: [-0.3, 0, 0] })
      .add(box(0.06, 0.6, 0.05), EMBER, 2.2, { p: [s * 0.25, -0.6, 0.35], r: [0.3, 0, s * 0.35] });
    pivot.add(mesh(a.build(), mat));
    body.add(pivot);
    arms.push(pivot);
  }

  return {
    root,
    coreHeight: 3.4,
    mats: [mat],
    update(p) {
      const t = p.t;
      const rage = p.phase - 1;
      const breathe = Math.sin(t * 1.6);
      body.position.y = 2.1 + breathe * 0.06;
      body.rotation.z = Math.sin(t * 0.8) * 0.04;
      body.rotation.x = 0.06 + breathe * 0.02;
      const swing = Math.sin(t * (1.4 + rage * 0.8));
      arms[0]!.rotation.set(-0.15 + swing * 0.25, 0, 0.12 + Math.abs(swing) * 0.1);
      arms[1]!.rotation.set(-0.15 - swing * 0.25, 0, -0.12 - Math.abs(swing) * 0.1);
      const look = THREE.MathUtils.clamp((p.squadX - p.x) * 0.08, -0.5, 0.5);
      head.rotation.y += (look - head.rotation.y) * Math.min(1, p.dt * 4);
      head.rotation.x = 0.15 + Math.sin(t * 2.3) * 0.04;
      applyFlash(mat, 1.6, p);
    },
  };
}

// ------------------------------------------------------------------ HYDRA-02 双生执政官
interface Serpent {
  group: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Object3D;
  neck: THREE.Mesh[];
  mat: THREE.MeshStandardMaterial;
  headY: number;
}

const NECK_SEGS = 9;

function serpent(hide: number, belly: number, accent: number, eye: number, k: number): Serpent {
  const mat = makeCharacterMaterial(accent, 0.5, 1.6, 0.25);
  const group = new THREE.Group();
  // coiled base
  const base = new GeoBuilder();
  for (let i = 0; i < 3; i++) {
    base.add(tor(1.25 - i * 0.28, 0.36 - i * 0.05, 8, 20), i % 2 ? belly : hide, 0, { p: [0, 0.3 + i * 0.5, -1.4], r: [Math.PI / 2, 0, i * 0.7] });
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * Math.PI * 2 + i;
      const r = 1.25 - i * 0.28;
      base.add(cone(0.12, 0.4, 4), accent, 2.2, { p: [Math.cos(a) * r, 0.62 + i * 0.5, -1.4 + Math.sin(a) * r], r: [0, 0, 0] });
    }
  }
  const baseMesh = mesh(base.build(), mat);
  baseMesh.scale.setScalar(k);
  group.add(baseMesh);

  // neck segments (positioned per frame)
  const neck: THREE.Mesh[] = [];
  for (let i = 0; i < NECK_SEGS; i++) {
    const r = (0.62 - i * 0.035) * k;
    const sg = new GeoBuilder();
    sg.add(sph(1, 12, 8), hide, 0, { s: [1, 0.9, 1] })
      .add(sph(0.82, 10, 6), belly, 0, { p: [0, -0.05, 0.3], s: [0.9, 0.85, 0.8] })
      .add(cone(0.22, 0.6, 4), accent, 2.4, { p: [0, 0.95, -0.2], r: [-0.5, 0, 0] });
    const m = mesh(sg.build(), mat);
    m.scale.setScalar(r);
    neck.push(m);
    group.add(m);
  }

  // dragon head, snout toward +Z
  const head = new THREE.Group();
  const hg = new GeoBuilder();
  hg.add(sph(0.75, 14, 10), hide, 0, { s: [1.05, 0.8, 1.15] })
    .add(box(0.95, 0.42, 1.2), hide, 0, { p: [0, -0.05, 0.85], r: [0.08, 0, 0] })
    .add(box(0.85, 0.12, 1.1), belly, 0, { p: [0, -0.24, 0.85] })
    // eyes + brow ridges
    .add(sph(0.16, 10, 8), eye, 3.4, { p: [0.42, 0.2, 0.55], s: [1, 0.7, 1] })
    .add(sph(0.16, 10, 8), eye, 3.4, { p: [-0.42, 0.2, 0.55], s: [1, 0.7, 1] })
    .add(box(0.36, 0.1, 0.4), hide, 0, { p: [0.42, 0.34, 0.52], r: [0, 0, -0.35] })
    .add(box(0.36, 0.1, 0.4), hide, 0, { p: [-0.42, 0.34, 0.52], r: [0, 0, 0.35] })
    // nostrils glow
    .add(sph(0.06, 6, 4), accent, 3, { p: [0.18, 0.12, 1.45] })
    .add(sph(0.06, 6, 4), accent, 3, { p: [-0.18, 0.12, 1.45] })
    // upper teeth
    .add(cone(0.06, 0.22, 4), 0xfff4ea, 0.3, { p: [0.32, -0.32, 1.3], r: [Math.PI, 0, 0] })
    .add(cone(0.06, 0.22, 4), 0xfff4ea, 0.3, { p: [-0.32, -0.32, 1.3], r: [Math.PI, 0, 0] })
    .add(cone(0.05, 0.18, 4), 0xfff4ea, 0.3, { p: [0.32, -0.3, 0.95], r: [Math.PI, 0, 0] })
    .add(cone(0.05, 0.18, 4), 0xfff4ea, 0.3, { p: [-0.32, -0.3, 0.95], r: [Math.PI, 0, 0] });
  // horns + crown
  for (const s of [1, -1]) {
    hg.add(cone(0.14, 1.2, 5), 0xffd84a, 1.6, { p: [s * 0.45, 0.6, -0.35], r: [-1.0, 0, -s * 0.35] })
      .add(cone(0.1, 0.7, 5), accent, 2.2, { p: [s * 0.7, 0.3, -0.2], r: [-1.2, 0, -s * 1.0] })
      .add(cone(0.08, 0.5, 4), accent, 2.2, { p: [s * 0.62, -0.05, 0.1], r: [-1.3, 0, -s * 1.3] });
  }
  hg.add(oct(0.24), accent, 3.2, { p: [0, 0.62, 0.15], s: [1, 1.6, 0.6] });
  const headMesh = mesh(hg.build(), mat);
  head.add(headMesh);
  const jg = new GeoBuilder();
  jg.add(box(0.85, 0.2, 1.15), hide, 0, { p: [0, -0.1, 0.55] })
    .add(box(0.7, 0.08, 1.0), 0x2a0418, 0, { p: [0, 0.02, 0.55] })
    .add(cone(0.05, 0.18, 4), 0xfff4ea, 0.3, { p: [0.3, 0.08, 1.0] })
    .add(cone(0.05, 0.18, 4), 0xfff4ea, 0.3, { p: [-0.3, 0.08, 1.0] })
    .add(sph(0.2, 8, 6), accent, 2.8, { p: [0, 0.05, 0.35] });
  const jaw = mesh(jg.build(), mat);
  jaw.position.set(0, -0.32, 0.25);
  head.add(jaw);
  head.scale.setScalar(k);
  group.add(head);
  return { group, head, jaw, neck, mat, headY: 3.1 * k };
}

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _pt = new THREE.Vector3();

function poseSerpent(s: Serpent, t: number, rage: number, look: number, k: number, roar: number): void {
  const sway = Math.sin(t * (1.1 + rage * 0.5)) * 0.45;
  const hx = sway;
  const hy = s.headY + Math.sin(t * 1.7) * 0.25;
  const hz = 0.2;
  s.head.position.set(hx, hy, hz);
  s.head.rotation.set(0.25 + Math.sin(t * 2.1) * 0.06 - roar * 0.25, look, -sway * 0.25);
  s.jaw.rotation.x = 0.12 + Math.abs(Math.sin(t * 2.6)) * 0.12 + roar * 0.6;
  // neck: quadratic bezier from coil top → bend behind → head base
  _p0.set(0, 1.3 * k, -1.4 * k);
  _p1.set(hx * 0.3, hy * 0.95, -1.6 * k);
  _p2.set(hx, hy - 0.35 * k, hz - 0.55 * k);
  for (let i = 0; i < s.neck.length; i++) {
    const u = i / (s.neck.length - 1);
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    _pt.set(0, 0, 0).addScaledVector(_p0, a).addScaledVector(_p1, b).addScaledVector(_p2, c);
    s.neck[i]!.position.copy(_pt);
    s.neck[i]!.rotation.set(-0.3 - u * 0.5, look * u, 0);
  }
}

function hydra(): BossRig {
  const prim = serpent(0x4a0f3e, 0xc23a8e, 0xff3fd2, 0xffe14a, 1.5);
  const sec = serpent(0x0e2f4a, 0x3aa6c2, 0x5fd8ff, 0xfff4ea, 1.25);
  const root = prim.group;
  const secondary = sec.group;
  let roar = 0;
  let lastPhase = 1;
  return {
    root,
    secondary,
    coreHeight: prim.headY,
    secondaryCoreHeight: sec.headY,
    mats: [prim.mat, sec.mat],
    update(p) {
      if (p.phase !== lastPhase) {
        lastPhase = p.phase;
        roar = 1;
      }
      roar = Math.max(0, roar - p.dt * 0.8);
      const rage = p.phase - 1;
      const look = THREE.MathUtils.clamp((p.squadX - p.x) * 0.07, -0.5, 0.5);
      poseSerpent(prim, p.t, rage, look, 1.5, roar);
      applyFlash(prim.mat, 1.6, p);
      if (p.secondary) {
        const look2 = THREE.MathUtils.clamp((p.squadX - p.secondary.x) * 0.07, -0.5, 0.5);
        poseSerpent(sec, p.t + 1.7, rage, look2, 1.25, roar);
        applyFlash(sec.mat, 1.6, p);
      }
    },
  };
}

// ------------------------------------------------------------------ OMEGA-ZERO 奇点主脑
function omega(): BossRig {
  const mat = makeCharacterMaterial(0xffc531, 0.5, 1.7, 0.22);
  const SHELL = 0x1c0f24;
  const GOLD = 0xffc531;
  const root = new THREE.Group();
  const hover = new THREE.Group();
  hover.position.y = 3.0;
  root.add(hover);

  // armoured shell around the eye (static relative to hover)
  const shell = new GeoBuilder();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    shell
      .add(box(0.9, 0.5, 0.9), SHELL, 0, { p: [Math.cos(a) * 1.75, Math.sin(a) * 1.75, -0.5], r: [0, 0, a] })
      .add(cone(0.22, 1.1, 4), i % 2 ? 0xff3355 : GOLD, 2.4, { p: [Math.cos(a) * 2.45, Math.sin(a) * 2.45, -0.5], r: [0, 0, a - Math.PI / 2] });
  }
  shell.add(sph(1.75, 18, 12), SHELL, 0, { p: [0, 0, -0.45], s: [1, 1, 0.8] });
  hover.add(mesh(shell.build(), mat));

  // the eye
  const eye = new THREE.Group();
  const eg = new GeoBuilder();
  eg.add(sph(1.45, 24, 16), 0xf3e9f6, 0.15)
    .add(cyl(0.95, 0.95, 0.06, 28).rotateX(Math.PI / 2), GOLD, 2.8, { p: [0, 0, 1.36] })
    .add(tor(0.95, 0.06, 6, 28), 0xff3355, 2.8, { p: [0, 0, 1.38] })
    .add(cyl(0.42, 0.42, 0.08, 20).rotateX(Math.PI / 2), 0x05010a, 0, { p: [0, 0, 1.4], s: [0.55, 1.25, 1] });
  // red veins
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    eg.add(box(0.04, 0.5, 0.02), 0xff3355, 1.4, { p: [Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0.8], r: [0, 0, a + Math.PI / 2] });
  }
  eye.add(mesh(eg.build(), mat));
  // eyelids: spherical caps (axis +Y) tilted toward +Z to close
  const lidGeo = new THREE.SphereGeometry(1.56, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.32);
  const lb = new GeoBuilder();
  lb.add(lidGeo, SHELL, 0).add(tor(1.32, 0.06, 4, 24), GOLD, 2.4, { p: [0, 0.83, 0], r: [Math.PI / 2, 0, 0] });
  const lidBuilt = lb.build();
  const lidTop = mesh(lidBuilt, mat);
  const lidBot = mesh(lidBuilt, mat);
  lidBot.rotation.z = Math.PI;
  const lidTopPivot = new THREE.Group();
  const lidBotPivot = new THREE.Group();
  lidTopPivot.add(lidTop);
  lidBotPivot.add(lidBot);
  // gaze (yaw) → pitch → eye + lids, so the lids follow where the eye looks
  const gaze = new THREE.Group();
  const pitch = new THREE.Group();
  pitch.rotation.x = 0.35;
  pitch.add(eye, lidTopPivot, lidBotPivot);
  gaze.add(pitch);
  hover.add(gaze);

  // gyroscope rings
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const rg = new GeoBuilder();
    rg.add(tor(2.75 + i * 0.4, 0.07, 6, 48), i === 1 ? 0xff3355 : GOLD, 2.6);
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * Math.PI * 2;
      rg.add(oct(0.16), 0xffffff, 3, { p: [Math.cos(a) * (2.75 + i * 0.4), Math.sin(a) * (2.75 + i * 0.4), 0] });
    }
    const r = mesh(rg.build(), mat);
    r.rotation.set(i * 1.1, i * 0.7, 0);
    rings.push(r);
    hover.add(r);
  }

  // tentacles: chains of spheres hanging below
  const TENT = 6;
  const SEG = 7;
  const tentacles: THREE.Mesh[][] = [];
  const segGeo = (() => {
    const g = new GeoBuilder();
    g.add(sph(1, 10, 8), 0x2c1236, 0).add(tor(0.9, 0.12, 4, 12), 0xff3355, 2.2, { r: [Math.PI / 2, 0, 0] });
    return g.build();
  })();
  const tipGeo = (() => {
    const g = new GeoBuilder();
    g.add(cone(0.6, 1.8, 6).rotateX(Math.PI), 0x2c1236, 0).add(oct(0.45), GOLD, 3, { p: [0, -0.2, 0] });
    return g.build();
  })();
  for (let i = 0; i < TENT; i++) {
    const chain: THREE.Mesh[] = [];
    for (let j = 0; j < SEG; j++) {
      const m = mesh(j === SEG - 1 ? tipGeo : segGeo, mat);
      m.scale.setScalar(0.32 - j * 0.03);
      chain.push(m);
      hover.add(m);
    }
    tentacles.push(chain);
  }

  let blink = 0;
  let nextBlink = 2.5;
  return {
    root,
    coreHeight: 3.0,
    mats: [mat],
    update(p) {
      const t = p.t;
      const rage = p.phase - 1;
      hover.position.y = 3.0 + Math.sin(t * 1.4) * 0.22;
      // eye tracks the squad
      const look = THREE.MathUtils.clamp((p.squadX - p.x) * 0.06, -0.45, 0.45);
      gaze.rotation.y += (look - gaze.rotation.y) * Math.min(1, p.dt * 5);
      pitch.rotation.x = 0.35 + Math.sin(t * 0.9) * 0.05;
      // blink / squint when hit
      nextBlink -= p.dt;
      if (nextBlink <= 0) {
        blink = 1;
        nextBlink = 2.5 + Math.random() * 3;
      }
      blink = Math.max(0, blink - p.dt * 5);
      const close = Math.min(1, Math.max(Math.sin(blink * Math.PI), p.flash * 0.45) + rage * 0.12);
      const lid = -0.25 + close * 0.82;
      lidTopPivot.rotation.x = lid;
      lidBotPivot.rotation.x = -lid;
      const spin = 1 + rage * 0.9;
      rings.forEach((r, i) => {
        r.rotation.x += p.dt * 0.5 * (i + 1) * spin;
        r.rotation.y += p.dt * (i % 2 ? -0.8 : 0.6) * spin;
      });
      for (let i = 0; i < tentacles.length; i++) {
        const chain = tentacles[i]!;
        const a = (i / tentacles.length) * Math.PI * 2 + 0.3;
        let x = Math.cos(a) * 1.1;
        let z = Math.sin(a) * 0.9 - 0.3;
        let y = -1.2;
        for (let j = 0; j < chain.length; j++) {
          const w = Math.sin(t * (1.8 + rage * 0.8) + i * 1.3 + j * 0.6) * (0.12 + j * 0.05);
          x += Math.cos(a) * 0.18 + w;
          z += Math.sin(a) * 0.18 + Math.cos(t * 1.3 + i + j * 0.5) * 0.06;
          y -= 0.36 - j * 0.02;
          chain[j]!.position.set(x, y, z);
          chain[j]!.rotation.set(0, 0, w * 0.8);
        }
      }
      applyFlash(mat, 1.7, p);
    },
  };
}

export function buildBossRigs(): Record<BossId, BossRig> {
  return { warden_01: warden(), hydra_02: hydra(), omega_zero: omega() };
}
