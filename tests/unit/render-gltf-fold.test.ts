import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { buildTemplate } from '../../src/render/models/gltfLibrary';

/**
 * buildTemplate folds each GLB's parts (helmets, pads, split body meshes) into one SkinnedMesh. The folded
 * actor must deform exactly like the original multi-mesh rig in any animated pose, not just the bind pose.
 */

type Gltf = { scene: THREE.Group; animations: THREE.AnimationClip[] };
const WEAPON_NODES = ['SMG', 'Shotgun', 'Sniper', 'RocketLauncher', 'GrenadeLauncher'];

function parse(file: string): Promise<Gltf> {
  const buf = fs.readFileSync(`public/models/${file}`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(ab, '', (g) => resolve({ scene: g.scene, animations: g.animations }), reject);
  });
}

/** World-space vertex positions of every mesh in `scene` posed at `clip`/`time`. */
function posedVertices(scene: THREE.Object3D, clip: THREE.AnimationClip, time: number): THREE.Vector3[] {
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(clip).play();
  mixer.update(time);
  scene.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      if (m.isSkinnedMesh) m.applyBoneTransform(i, v);
      out.push(v.applyMatrix4(m.matrixWorld));
    }
  });
  return out;
}

/** Largest distance from any vertex of `a` to its nearest vertex of `b` (grid hash, cell = 2 * tol). */
function maxNearestDistance(a: THREE.Vector3[], b: THREE.Vector3[], tol: number): number {
  const cell = tol * 2;
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  const grid = new Map<string, THREE.Vector3[]>();
  for (const v of b) {
    const k = key(Math.floor(v.x / cell), Math.floor(v.y / cell), Math.floor(v.z / cell));
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(v);
  }
  let worst = 0;
  for (const v of a) {
    const cx = Math.floor(v.x / cell);
    const cy = Math.floor(v.y / cell);
    const cz = Math.floor(v.z / cell);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const w of grid.get(key(cx + dx, cy + dy, cz + dz)) ?? []) best = Math.min(best, v.distanceTo(w));
        }
      }
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

const meshCount = (scene: THREE.Object3D): number => {
  let n = 0;
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
};

// The textured mech has a single mesh (nothing to fold) and needs an image decoder to parse.
const CASES: Array<[string, boolean]> = [
  ['hero_trooper.glb', true],
  ['hero_heavy.glb', true],
  ['enemy_crawler.glb', false],
  ['enemy_dasher.glb', false],
  ['enemy_bastion.glb', false],
  ['enemy_mitosis.glb', false],
  ['enemy_siphon.glb', false],
  ['boss_warden.glb', false],
  ['boss_hydra_a.glb', false],
  ['boss_hydra_b.glb', false],
  ['boss_omega.glb', false],
];

describe('GLB templates fold into a single skin', () => {
  it.each(CASES)('%s deforms exactly like the original rig', async (file, stripWeapons) => {
    const raw = await parse(file);
    const folded = await parse(file);
    if (stripWeapons) {
      for (const name of WEAPON_NODES) raw.scene.getObjectByName(name)?.removeFromParent();
    }
    const tmpl = buildTemplate(folded, { targetHeight: 2, facingYaw: 0, stripWeapons });
    expect(meshCount(tmpl.scene)).toBe(1);

    for (const clip of raw.animations.slice(0, 3)) {
      const t = clip.duration * 0.37;
      const before = posedVertices(raw.scene, clip, t);
      const after = posedVertices(tmpl.scene, tmpl.clips.get(clip.name)!, t);
      expect(after.length).toBe(before.length);
      expect(maxNearestDistance(after, before, 1e-3), clip.name).toBeLessThan(1e-3);
      expect(maxNearestDistance(before, after, 1e-3), clip.name).toBeLessThan(1e-3);
    }
  });
});
