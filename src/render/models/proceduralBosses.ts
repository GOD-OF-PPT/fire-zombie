import * as THREE from 'three';
import type { ActorTemplate, GltfLibrary } from './gltfLibrary';
import { GeoBuilder, addLimb, box, cone, cyl, ico, oct, sph, tor, type V3 } from './kit';
import {
  TAU,
  bump,
  childFrame,
  deathClip,
  ease,
  quat,
  rigTemplate,
  type Frame,
  type PartSpec,
  type Pose,
  type PoseFn,
} from './proceduralRig';

/**
 * Procedural fallback bosses (crystal golem Warden, twin serpent Hydra, giant-eye Omega), rebuilt as
 * rigid-skinned rigs with the clip names the renderer plays on the GLB bosses. All face +Z.
 */

const WHITE = 0xfff4ea;
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const framePose = (f: Frame) => ({ p: f.p, q: f.q });

// ------------------------------------------------------------------ WARDEN-01
function warden(): ActorTemplate {
  const ROCK = 0x3a1220;
  const ROCK2 = 0x5a1a2a;
  const RED = 0xff2a4a;
  const EMBER = 0xffa04a;

  const legs = new GeoBuilder();
  for (const s of [1, -1]) {
    addLimb(legs, [s * 0.75, 2.1, 0], [s * 1.0, 1.0, 0.25], 0.42, 0.36, ROCK);
    addLimb(legs, [s * 1.0, 1.0, 0.25], [s * 1.05, 0.25, 0.05], 0.36, 0.3, ROCK);
    legs
      .add(ico(0.36, 0), ROCK2, 0, { p: [s * 1.0, 1.05, 0.4], s: [1, 1, 0.8] })
      .add(box(0.95, 0.38, 1.25), ROCK, 0, { p: [s * 1.05, 0.19, 0.18] })
      .add(cone(0.12, 0.4, 4), RED, 2.2, { p: [s * 1.05, 0.25, 0.85], r: [Math.PI / 2, 0, 0] })
      .add(oct(0.18), RED, 2.6, { p: [s * 1.02, 1.05, 0.68] });
  }

  const torso = new GeoBuilder();
  torso
    .add(box(1.6, 0.5, 1.0), ROCK, 0, { p: [0, 0.05, 0] })
    .add(ico(1.25, 0), ROCK, 0, { p: [0, 1.25, 0], s: [1.35, 1.05, 0.85] })
    .add(ico(0.9, 0), ROCK2, 0, { p: [0, 1.45, 0.25], s: [1.3, 0.9, 0.8] })
    .add(oct(0.55), RED, 3.2, { p: [0, 1.35, 0.95], s: [1, 1.35, 0.7] })
    .add(tor(0.62, 0.07, 5, 18), EMBER, 2.4, { p: [0, 1.35, 0.9] })
    .add(box(0.08, 0.9, 0.05), EMBER, 2.4, { p: [0.55, 1.1, 0.78], r: [0, 0, 0.5] })
    .add(box(0.08, 0.7, 0.05), EMBER, 2.4, { p: [-0.6, 1.0, 0.76], r: [0, 0, -0.6] })
    .add(box(0.5, 0.08, 0.05), EMBER, 2.2, { p: [0, 0.4, 0.62] });
  for (const s of [1, -1]) {
    torso
      .add(ico(0.55, 0), ROCK2, 0, { p: [s * 1.45, 1.9, 0] })
      .add(cone(0.22, 1.1, 5), RED, 2.6, { p: [s * 1.55, 2.55, -0.05], r: [-0.15, 0, -s * 0.35] })
      .add(cone(0.15, 0.75, 5), RED, 2.4, { p: [s * 1.85, 2.3, 0.15], r: [0.2, 0, -s * 0.8] })
      .add(cone(0.13, 0.6, 5), EMBER, 2.2, { p: [s * 1.2, 2.45, -0.3], r: [-0.4, 0, -s * 0.15] });
  }
  for (let i = 0; i < 4; i++) {
    torso.add(cone(0.18 - i * 0.02, 0.9 - i * 0.12, 5), RED, 2.2, { p: [0, 2.2 - i * 0.35, -0.65 - i * 0.05], r: [-0.9, 0, 0] });
  }

  const head = new GeoBuilder();
  head
    .add(ico(0.48, 0), ROCK, 0, { s: [1.15, 0.9, 1] })
    .add(box(0.8, 0.12, 0.3), ROCK2, 0, { p: [0, 0.08, 0.32] })
    .add(oct(0.1), 0xffe14a, 3.4, { p: [0.2, 0.0, 0.45], s: [1.6, 0.8, 0.5] })
    .add(oct(0.1), 0xffe14a, 3.4, { p: [-0.2, 0.0, 0.45], s: [1.6, 0.8, 0.5] })
    .add(box(0.42, 0.05, 0.05), EMBER, 2.4, { p: [0, -0.25, 0.42] })
    .add(cone(0.12, 0.85, 5), RED, 2.4, { p: [0.38, 0.5, -0.05], r: [-0.3, 0, -0.5] })
    .add(cone(0.12, 0.85, 5), RED, 2.4, { p: [-0.38, 0.5, -0.05], r: [-0.3, 0, 0.5] })
    .add(cone(0.1, 0.55, 5), EMBER, 2.2, { p: [0, 0.55, -0.1], r: [-0.4, 0, 0] });

  const arm = (s: number): THREE.BufferGeometry => {
    const a = new GeoBuilder();
    addLimb(a, [0, 0, 0], [s * 0.45, -1.15, 0.35], 0.36, 0.3, ROCK);
    addLimb(a, [s * 0.45, -1.15, 0.35], [s * 0.5, -2.05, 0.95], 0.3, 0.36, ROCK);
    a.add(ico(0.32, 0), ROCK2, 0, { p: [s * 0.45, -1.15, 0.35] })
      .add(ico(0.62, 0), ROCK2, 0, { p: [s * 0.52, -2.35, 1.1], s: [1, 0.9, 1] })
      .add(oct(0.32), RED, 3, { p: [s * 0.52, -2.3, 1.62], s: [1, 1, 1.2] })
      .add(cone(0.12, 0.5, 4), RED, 2.6, { p: [s * 0.9, -2.2, 1.2], r: [0, 0, -s * 1.3] })
      .add(cone(0.12, 0.5, 4), RED, 2.6, { p: [s * 0.52, -1.85, 1.2], r: [-0.3, 0, 0] })
      .add(box(0.06, 0.6, 0.05), EMBER, 2.2, { p: [s * 0.25, -0.6, 0.35], r: [0.3, 0, s * 0.35] });
    return a.build();
  };

  const BODY: V3 = [0, 2.1, 0];
  const HEAD: V3 = [0, 2.6, 0.35];
  const ARM_L: V3 = [1.55, 1.75, 0];
  const ARM_R: V3 = [-1.55, 1.75, 0];
  const parts: PartSpec[] = [
    { name: 'legs', joint: [0, 0, 0], geo: legs.build() },
    { name: 'body', joint: BODY, geo: torso.build() },
    { name: 'head', joint: add3(BODY, HEAD), geo: head.build() },
    { name: 'armL', joint: add3(BODY, ARM_L), geo: arm(1) },
    { name: 'armR', joint: add3(BODY, ARM_R), geo: arm(-1) },
  ];

  const pose = (bodyY: number, bodyRot: V3, armL: V3, armR: V3, headRot: V3): Pose => {
    const body: Frame = { p: [0, bodyY, 0], q: quat(...bodyRot) };
    return {
      body: framePose(body),
      head: framePose(childFrame(body, HEAD, quat(...headRot))),
      armL: framePose(childFrame(body, ARM_L, quat(...armL))),
      armR: framePose(childFrame(body, ARM_R, quat(...armR))),
    };
  };
  const idle: PoseFn = (u) => {
    const ph = u * TAU;
    const breathe = Math.sin(ph);
    const swing = Math.sin(ph);
    return pose(
      2.1 + breathe * 0.06,
      [0.06 + breathe * 0.02, 0, Math.sin(ph) * 0.04],
      [-0.15 + swing * 0.25, 0, 0.12 + Math.abs(swing) * 0.1],
      [-0.15 - swing * 0.25, 0, -0.12 - Math.abs(swing) * 0.1],
      [0.15 + Math.sin(ph * 2) * 0.04, 0, 0],
    );
  };
  // Both fists swing up over the head, then slam down in front
  const punch: PoseFn = (u) => {
    const raise = u < 0.4 ? ease(u / 0.4) : 1 - ease((u - 0.4) / 0.3);
    const slam = u < 0.4 ? 0 : bump(u, 0.62, 0.25);
    const armX = -0.15 - raise * 2.1;
    return pose(
      2.1 + raise * 0.15 - slam * 0.2,
      [0.06 + slam * 0.3 - raise * 0.1, 0, 0],
      [armX, 0, 0.12 + raise * 0.2],
      [armX, 0, -0.12 - raise * 0.2],
      [0.15 - raise * 0.25, 0, 0],
    );
  };
  return rigTemplate(
    'warden',
    parts,
    [
      { name: 'Fast_Flying', duration: 4, pose: idle, samples: 32 },
      { name: 'Punch', duration: 1.1, pose: punch, samples: 24 },
      deathClip(idle, 1.8, 1.25, 0.3),
    ],
    { targetHeight: 4.35, facingYaw: 0 },
  );
}

// ------------------------------------------------------------------ HYDRA-02 (one serpent per template)
function serpent(id: string, hide: number, belly: number, accent: number, eye: number, k: number, targetHeight: number): ActorTemplate {
  const NECK = 9;
  const coil = new GeoBuilder();
  for (let i = 0; i < 3; i++) {
    coil.add(tor(1.25 - i * 0.28, 0.36 - i * 0.05, 8, 20), i % 2 ? belly : hide, 0, {
      p: [0, 0.3 + i * 0.5, -1.4],
      r: [Math.PI / 2, 0, i * 0.7],
    });
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * TAU + i;
      const r = 1.25 - i * 0.28;
      coil.add(cone(0.12, 0.4, 4), accent, 2.2, { p: [Math.cos(a) * r, 0.62 + i * 0.5, -1.4 + Math.sin(a) * r] });
    }
  }
  const coilGeo = coil.build();
  coilGeo.scale(k, k, k);

  const segment = (r: number): THREE.BufferGeometry => {
    const sg = new GeoBuilder();
    sg.add(sph(1, 12, 8), hide, 0, { s: [1, 0.9, 1] })
      .add(sph(0.82, 10, 6), belly, 0, { p: [0, -0.05, 0.3], s: [0.9, 0.85, 0.8] })
      .add(cone(0.22, 0.6, 4), accent, 2.4, { p: [0, 0.95, -0.2], r: [-0.5, 0, 0] });
    const g = sg.build();
    g.scale(r, r, r);
    return g;
  };

  const hg = new GeoBuilder();
  hg.add(sph(0.75, 14, 10), hide, 0, { s: [1.05, 0.8, 1.15] })
    .add(box(0.95, 0.42, 1.2), hide, 0, { p: [0, -0.05, 0.85], r: [0.08, 0, 0] })
    .add(box(0.85, 0.12, 1.1), belly, 0, { p: [0, -0.24, 0.85] })
    .add(sph(0.16, 10, 8), eye, 3.4, { p: [0.42, 0.2, 0.55], s: [1, 0.7, 1] })
    .add(sph(0.16, 10, 8), eye, 3.4, { p: [-0.42, 0.2, 0.55], s: [1, 0.7, 1] })
    .add(box(0.36, 0.1, 0.4), hide, 0, { p: [0.42, 0.34, 0.52], r: [0, 0, -0.35] })
    .add(box(0.36, 0.1, 0.4), hide, 0, { p: [-0.42, 0.34, 0.52], r: [0, 0, 0.35] })
    .add(sph(0.06, 6, 4), accent, 3, { p: [0.18, 0.12, 1.45] })
    .add(sph(0.06, 6, 4), accent, 3, { p: [-0.18, 0.12, 1.45] })
    .add(cone(0.06, 0.22, 4), WHITE, 0.3, { p: [0.32, -0.32, 1.3], r: [Math.PI, 0, 0] })
    .add(cone(0.06, 0.22, 4), WHITE, 0.3, { p: [-0.32, -0.32, 1.3], r: [Math.PI, 0, 0] })
    .add(cone(0.05, 0.18, 4), WHITE, 0.3, { p: [0.32, -0.3, 0.95], r: [Math.PI, 0, 0] })
    .add(cone(0.05, 0.18, 4), WHITE, 0.3, { p: [-0.32, -0.3, 0.95], r: [Math.PI, 0, 0] });
  for (const s of [1, -1]) {
    hg.add(cone(0.14, 1.2, 5), 0xffd84a, 1.6, { p: [s * 0.45, 0.6, -0.35], r: [-1.0, 0, -s * 0.35] })
      .add(cone(0.1, 0.7, 5), accent, 2.2, { p: [s * 0.7, 0.3, -0.2], r: [-1.2, 0, -s * 1.0] })
      .add(cone(0.08, 0.5, 4), accent, 2.2, { p: [s * 0.62, -0.05, 0.1], r: [-1.3, 0, -s * 1.3] });
  }
  hg.add(oct(0.24), accent, 3.2, { p: [0, 0.62, 0.15], s: [1, 1.6, 0.6] });
  const headGeo = hg.build();
  headGeo.scale(k, k, k);

  const jg = new GeoBuilder();
  jg.add(box(0.85, 0.2, 1.15), hide, 0, { p: [0, -0.1, 0.55] })
    .add(box(0.7, 0.08, 1.0), 0x2a0418, 0, { p: [0, 0.02, 0.55] })
    .add(cone(0.05, 0.18, 4), WHITE, 0.3, { p: [0.3, 0.08, 1.0] })
    .add(cone(0.05, 0.18, 4), WHITE, 0.3, { p: [-0.3, 0.08, 1.0] })
    .add(sph(0.2, 8, 6), accent, 2.8, { p: [0, 0.05, 0.35] });
  const jawGeo = jg.build();
  jawGeo.scale(k, k, k);

  const headY = 3.1 * k;
  const JAW: V3 = [0, -0.32 * k, 0.25 * k];
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const pt = new THREE.Vector3();

  /** Head position/attitude drive the neck: a quadratic bezier from the coil top to behind the head. */
  const pose = (sway: number, bob: number, pitch: number, jawOpen: number, lunge: number): Pose => {
    const hx = sway;
    const hy = headY + bob - lunge * 1.1 * k;
    const hz = 0.2 + lunge * 1.6 * k;
    const headF: Frame = { p: [hx, hy, hz], q: quat(pitch, 0, -sway * 0.25) };
    const out: Pose = {
      head: framePose(headF),
      jaw: framePose(childFrame(headF, JAW, quat(jawOpen, 0, 0))),
    };
    p0.set(0, 1.3 * k, -1.4 * k);
    p1.set(hx * 0.3, hy * 0.95, -1.6 * k);
    p2.set(hx, hy - 0.35 * k, hz - 0.55 * k);
    for (let i = 0; i < NECK; i++) {
      const u = i / (NECK - 1);
      pt.set(0, 0, 0)
        .addScaledVector(p0, (1 - u) * (1 - u))
        .addScaledVector(p1, 2 * (1 - u) * u)
        .addScaledVector(p2, u * u);
      out[`neck${i}`] = { p: [pt.x, pt.y, pt.z], r: [-0.3 - u * 0.5, 0, 0] };
    }
    return out;
  };

  const rest = pose(0, 0, 0.25, 0.12, 0);
  const at = (name: string): V3 => rest[name]!.p!;
  const parts: PartSpec[] = [{ name: 'coil', joint: [0, 0, 0], geo: coilGeo }];
  for (let i = 0; i < NECK; i++) {
    parts.push({ name: `neck${i}`, joint: at(`neck${i}`), geo: segment((0.62 - i * 0.035) * k) });
  }
  parts.push({ name: 'head', joint: at('head'), geo: headGeo }, { name: 'jaw', joint: at('jaw'), geo: jawGeo });

  const fly: PoseFn = (u) => {
    const ph = u * TAU;
    return pose(
      Math.sin(ph) * 0.45,
      Math.sin(ph * 2) * 0.25,
      0.25 + Math.sin(ph * 2) * 0.06,
      0.12 + Math.abs(Math.sin(ph * 1.5)) * 0.12,
      0,
    );
  };
  const headbutt: PoseFn = (u) => {
    const l = Math.sin(Math.PI * Math.min(1, u / 0.85));
    return pose(0, 0, 0.25 + l * 0.35, 0.12 + l * 0.6, l);
  };
  const death: PoseFn = (u) => {
    const d = ease(u);
    return pose(0, -d * headY * 0.55, 0.25 + d * 0.9, 0.12 + d * 0.5, 0);
  };
  return rigTemplate(
    id,
    parts,
    [
      { name: 'Fast_Flying', duration: 6, pose: fly, samples: 48 },
      { name: 'Headbutt', duration: 1.0, pose: headbutt, samples: 20 },
      { name: 'Death', duration: 2.0, pose: death, samples: 16 },
    ],
    { targetHeight, facingYaw: 0 },
  );
}

// ------------------------------------------------------------------ OMEGA-ZERO
function omega(): ActorTemplate {
  const SHELL = 0x1c0f24;
  const GOLD = 0xffc531;
  const HOVER: V3 = [0, 3, 0];
  const TENT = 6;
  const SEG = 7;

  const shell = new GeoBuilder();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    shell
      .add(box(0.9, 0.5, 0.9), SHELL, 0, { p: [Math.cos(a) * 1.75, Math.sin(a) * 1.75, -0.5], r: [0, 0, a] })
      .add(cone(0.22, 1.1, 4), i % 2 ? 0xff3355 : GOLD, 2.4, {
        p: [Math.cos(a) * 2.45, Math.sin(a) * 2.45, -0.5],
        r: [0, 0, a - Math.PI / 2],
      });
  }
  shell.add(sph(1.75, 18, 12), SHELL, 0, { p: [0, 0, -0.45], s: [1, 1, 0.8] });

  const eg = new GeoBuilder();
  eg.add(sph(1.45, 24, 16), 0xf3e9f6, 0.15)
    .add(cyl(0.95, 0.95, 0.06, 28).rotateX(Math.PI / 2), GOLD, 2.8, { p: [0, 0, 1.36] })
    .add(tor(0.95, 0.06, 6, 28), 0xff3355, 2.8, { p: [0, 0, 1.38] })
    .add(cyl(0.42, 0.42, 0.08, 20).rotateX(Math.PI / 2), 0x05010a, 0, { p: [0, 0, 1.4], s: [0.55, 1.25, 1] });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    eg.add(box(0.04, 0.5, 0.02), 0xff3355, 1.4, { p: [Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0.8], r: [0, 0, a + Math.PI / 2] });
  }

  const lb = new GeoBuilder();
  lb.add(new THREE.SphereGeometry(1.56, 20, 10, 0, TAU, 0, Math.PI * 0.32), SHELL, 0).add(
    tor(1.32, 0.06, 4, 24),
    GOLD,
    2.4,
    { p: [0, 0.83, 0], r: [Math.PI / 2, 0, 0] },
  );
  const lidTop = lb.build();
  const lidBot = lidTop.clone().rotateZ(Math.PI);

  const ringGeo = (i: number): THREE.BufferGeometry => {
    const rg = new GeoBuilder();
    const R = 2.75 + i * 0.4;
    rg.add(tor(R, 0.07, 6, 48), i === 1 ? 0xff3355 : GOLD, 2.6);
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * TAU;
      rg.add(oct(0.16), 0xffffff, 3, { p: [Math.cos(a) * R, Math.sin(a) * R, 0] });
    }
    return rg.build();
  };
  const segGeo = new GeoBuilder()
    .add(sph(1, 10, 8), 0x2c1236, 0)
    .add(tor(0.9, 0.12, 4, 12), 0xff3355, 2.2, { r: [Math.PI / 2, 0, 0] })
    .build();
  const tipGeo = new GeoBuilder()
    .add(cone(0.6, 1.8, 6).rotateX(Math.PI), 0x2c1236, 0)
    .add(oct(0.45), GOLD, 3, { p: [0, -0.2, 0] })
    .build();

  /**
   * `rage` (0 | 1) doubles ring spin and tentacle tempo while keeping whole cycles per loop;
   * `lunge` pushes the eye toward the squad, `lid` overrides the blink, `sink` lowers the hover.
   */
  const pose = (u: number, rage: number, lunge = 0, lid: number | null = null, sink = 0, spin = 0): Pose => {
    const ph = u * TAU;
    const hover: Frame = { p: [0, HOVER[1] + Math.sin(ph * 2) * 0.22 - sink, lunge * 0.9], q: new THREE.Quaternion() };
    const pitch = quat(0.35 + Math.sin(ph) * 0.05 - lunge * 0.25, 0, 0);
    const blink = Math.max(bump(u, 0.32, 0.016), bump(u, 0.78, 0.016));
    const close = Math.min(1, blink + rage * 0.12);
    const lidA = lid ?? -0.25 + close * 0.82;
    const out: Pose = {
      hover: framePose(hover),
      eye: { p: hover.p, q: pitch },
      lidTop: { p: hover.p, q: pitch.clone().multiply(quat(lidA, 0, 0)) },
      lidBot: { p: hover.p, q: pitch.clone().multiply(quat(-lidA, 0, 0)) },
    };
    const turns = 1 + rage;
    for (let i = 0; i < 3; i++) {
      out[`ring${i}`] = {
        p: hover.p,
        r: [i * 1.1 + TAU * (i + 1) * turns * u + spin * (i + 1), i * 0.7 + (i % 2 ? -1 : 1) * TAU * turns * u + spin, 0],
      };
    }
    const n = 2 + rage;
    for (let i = 0; i < TENT; i++) {
      const a = (i / TENT) * TAU + 0.3;
      let x = Math.cos(a) * 1.1;
      let z = Math.sin(a) * 0.9 - 0.3;
      let y = -1.2;
      for (let j = 0; j < SEG; j++) {
        const w = Math.sin(ph * n + i * 1.3 + j * 0.6) * (0.12 + j * 0.05) * (1 + lunge);
        x += Math.cos(a) * (0.18 + lunge * 0.08) + w;
        z += Math.sin(a) * 0.18 + Math.cos(ph * 2 + i + j * 0.5) * 0.06;
        y -= 0.36 - j * 0.02;
        out[`t${i}_${j}`] = { p: [hover.p[0] + x, hover.p[1] + y, hover.p[2] + z], r: [0, 0, w * 0.8] };
      }
    }
    return out;
  };

  const rest = pose(0, 0);
  const parts: PartSpec[] = [
    { name: 'hover', joint: HOVER, geo: shell.build() },
    { name: 'eye', joint: HOVER, geo: eg.build() },
    { name: 'lidTop', joint: HOVER, geo: lidTop },
    { name: 'lidBot', joint: HOVER, geo: lidBot },
  ];
  for (let i = 0; i < 3; i++) parts.push({ name: `ring${i}`, joint: HOVER, geo: ringGeo(i) });
  for (let i = 0; i < TENT; i++) {
    for (let j = 0; j < SEG; j++) {
      const name = `t${i}_${j}`;
      const g = (j === SEG - 1 ? tipGeo : segGeo).clone();
      const s = 0.32 - j * 0.03;
      g.scale(s, s, s);
      parts.push({ name, joint: rest[name]!.p!, geo: g });
    }
  }

  const idle: PoseFn = (u) => pose(u, 0);
  const rage: PoseFn = (u) => pose(u, 1);
  const weapon: PoseFn = (u) => {
    const l = Math.sin(Math.PI * Math.min(1, u / 0.9));
    return pose(u * (1.1 / 9), 0, l, -0.25 - l * 0.2, 0, l * 1.5);
  };
  const death: PoseFn = (u) => {
    const d = ease(u);
    return pose(0, 0, 0, -0.25 + d * 0.82, d * 1.6);
  };
  return rigTemplate(
    'omega',
    parts,
    [
      { name: 'Idle', duration: 9, pose: idle, samples: 160 },
      { name: 'Walk', duration: 9, pose: rage, samples: 160 },
      { name: 'Weapon', duration: 1.1, pose: weapon, samples: 24 },
      { name: 'Death', duration: 2.2, pose: death, samples: 16 },
    ],
    { targetHeight: 5.3, facingYaw: 0 },
  );
}

export function buildProceduralBosses(): GltfLibrary['bosses'] {
  return {
    warden: warden(),
    hydraA: serpent('hydraA', 0x4a0f3e, 0xc23a8e, 0xff3fd2, 0xffe14a, 1.5, 4.6),
    hydraB: serpent('hydraB', 0x0e2f4a, 0x3aa6c2, 0x5fd8ff, 0xfff4ea, 1.25, 3.6),
    omega: omega(),
  };
}
