import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildTemplate, type ActorTemplate } from './gltfLibrary';
import type { V3 } from './kit';

/**
 * Rigid-skinned procedural rigs: one bone per part (all children of a `root` bone), merged into a
 * single SkinnedMesh so procedural actors go through the same spawnActor / outline / AnimationMixer
 * path as the GLB templates. Clips are sampled from pose functions and key every bone, so switching
 * clips (or reusing a pooled actor after Death) never leaves a bone stuck in another clip's pose.
 */

export const TAU = Math.PI * 2;

export interface PartSpec {
  name: string;
  /** Rest pivot in rig space */
  joint: V3;
  /** Kit geometry (RGBA colour, A = glow) authored around the pivot; omit for attachment-only bones */
  geo?: THREE.BufferGeometry;
  /** Rest uniform scale of the bone; also scales anything attached to it */
  scale?: number;
}

export interface BonePose {
  /** Euler rotation (rest rotation is identity) */
  r?: V3;
  /** Rotation as a quaternion; overrides `r` */
  q?: THREE.Quaternion;
  /** Offset added to the rest pivot */
  o?: V3;
  /** Absolute rig-space position; overrides `o` */
  p?: V3;
  /** Multiplier on the rest scale */
  s?: number;
}

export type Pose = Record<string, BonePose>;
/** `u` runs 0..1 across the clip; looping clips must return the same pose at u = 0 and u = 1. */
export type PoseFn = (u: number) => Pose;

export interface ClipSpec {
  name: string;
  duration: number;
  pose: PoseFn;
  samples?: number;
}

export interface RigTemplateOptions {
  targetHeight: number;
  facingYaw: number;
  /** Yaw baked into the template scene (heroes are authored facing −Z but templates face +Z) */
  sceneYaw?: number;
  refRadius?: number;
  hoverOffset?: number;
}

export interface Frame {
  p: V3;
  q: THREE.Quaternion;
}

export const ease = (x: number): number => 1 - (1 - THREE.MathUtils.clamp(x, 0, 1)) ** 3;
/** Triangle pulse: 1 at `c`, 0 beyond ±w. */
export const bump = (u: number, c: number, w: number): number => Math.max(0, 1 - Math.abs(u - c) / w);

const _e = new THREE.Euler();
const _v = new THREE.Vector3();

export function quat(x: number, y: number, z: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(_e.set(x, y, z));
}

/** Frame of a child placed at `offset` in the parent's frame, with an extra local rotation. */
export function childFrame(parent: Frame, offset: V3, local?: THREE.Quaternion): Frame {
  _v.set(offset[0], offset[1], offset[2]).applyQuaternion(parent.q);
  const q = parent.q.clone();
  if (local) q.multiply(local);
  return { p: [parent.p[0] + _v.x, parent.p[1] + _v.y, parent.p[2] + _v.z], q };
}

/** Replaces the kit's RGBA (A = glow) colour with plain RGB so toon materials skip vertex alpha. */
export function kitToRgb(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = geo.getAttribute('color');
  if (c && c.itemSize === 3) return geo;
  const n = geo.getAttribute('position').count;
  const rgb = new Float32Array(n * 3).fill(1);
  const glow = new Float32Array(n);
  if (c) {
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = c.getX(i);
      rgb[i * 3 + 1] = c.getY(i);
      rgb[i * 3 + 2] = c.getZ(i);
      glow[i] = c.itemSize >= 4 ? Math.min(1, Math.max(0, c.getW(i) / 2.6)) : 0;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  geo.setAttribute('aPartGlow', new THREE.BufferAttribute(glow, 1));
  return geo;
}

function bakePart(geo: THREE.BufferGeometry, joint: V3, scale: number, boneIndex: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const key of Object.keys(g.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'color' && key !== 'aPartGlow') g.deleteAttribute(key);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.scale(scale, scale, scale).translate(joint[0], joint[1], joint[2]);
  kitToRgb(g);
  const n = g.getAttribute('position').count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = boneIndex;
    w[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
  return g;
}

function buildRigScene(id: string, parts: readonly PartSpec[], sceneYaw: number): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.name = `proc_${id}`;
  wrapper.rotation.y = sceneYaw;
  const root = new THREE.Bone();
  root.name = 'root';
  const bones: THREE.Bone[] = [root];
  const geos: THREE.BufferGeometry[] = [];
  for (const part of parts) {
    const bone = new THREE.Bone();
    bone.name = part.name;
    bone.position.set(part.joint[0], part.joint[1], part.joint[2]);
    bone.scale.setScalar(part.scale ?? 1);
    root.add(bone);
    bones.push(bone);
    if (part.geo) geos.push(bakePart(part.geo, part.joint, part.scale ?? 1, bones.length - 1));
  }
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error(`proceduralRig: failed merging parts of ${id}`);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  const mesh = new THREE.SkinnedMesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true }));
  mesh.name = `${id}_mesh`;
  mesh.frustumCulled = false;
  mesh.add(root);
  wrapper.add(mesh);
  wrapper.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return wrapper;
}

function sampleClip(spec: ClipSpec, parts: readonly PartSpec[]): THREE.AnimationClip {
  const n = Math.max(2, spec.samples ?? 24);
  const bones: PartSpec[] = [{ name: 'root', joint: [0, 0, 0] }, ...parts];
  const times = new Float32Array(n + 1);
  const pos = bones.map(() => new Float32Array((n + 1) * 3));
  const rot = bones.map(() => new Float32Array((n + 1) * 4));
  const scl = bones.map(() => new Float32Array((n + 1) * 3));
  const q = new THREE.Quaternion();
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    times[k] = u * spec.duration;
    const pose = spec.pose(u);
    bones.forEach((bone, b) => {
      const bp = pose[bone.name] ?? {};
      const j = bone.joint;
      const o = bp.o ?? [0, 0, 0];
      const p = bp.p ?? [j[0] + o[0], j[1] + o[1], j[2] + o[2]];
      pos[b]!.set(p, k * 3);
      if (bp.q) q.copy(bp.q);
      else {
        const r = bp.r ?? [0, 0, 0];
        q.setFromEuler(_e.set(r[0], r[1], r[2]));
      }
      const qa = rot[b]!;
      // Keep consecutive keys in the same hemisphere so linear blending never takes the long way round
      if (k > 0) {
        const d = qa[(k - 1) * 4]! * q.x + qa[(k - 1) * 4 + 1]! * q.y + qa[(k - 1) * 4 + 2]! * q.z + qa[(k - 1) * 4 + 3]! * q.w;
        if (d < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      }
      qa.set([q.x, q.y, q.z, q.w], k * 4);
      const s = (bone.scale ?? 1) * (bp.s ?? 1);
      scl[b]!.set([s, s, s], k * 3);
    });
  }
  const tracks: THREE.KeyframeTrack[] = [];
  bones.forEach((bone, b) => {
    tracks.push(
      new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, pos[b]!),
      new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, rot[b]!),
      new THREE.VectorKeyframeTrack(`${bone.name}.scale`, times, scl[b]!),
    );
  });
  return new THREE.AnimationClip(spec.name, spec.duration, tracks).optimize();
}

export function rigTemplate(
  id: string,
  parts: readonly PartSpec[],
  clips: readonly ClipSpec[],
  opts: RigTemplateOptions,
): ActorTemplate {
  const scene = buildRigScene(id, parts, opts.sceneYaw ?? 0);
  const animations = clips.map((c) => sampleClip(c, parts));
  return buildTemplate({ scene, animations }, { ...opts, exactBounds: true });
}

/** One-shot fall: the first pose of `base`, tipping backwards around the feet and sinking. */
export function deathClip(base: PoseFn, duration: number, fall: number, sink: number): ClipSpec {
  return {
    name: 'Death',
    duration,
    samples: 16,
    pose: (u) => {
      const pose = base(0);
      const k = ease(u);
      pose.root = { r: [-fall * k, 0, 0], o: [0, -sink * k, 0] };
      return pose;
    },
  };
}
