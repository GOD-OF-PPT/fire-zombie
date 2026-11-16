import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { spawnActor, type ActorTemplate, type AnimatedActor } from '../../src/render/models/gltfLibrary';
import { buildProceduralLibrary } from '../../src/render/models/proceduralLibrary';

/**
 * The procedural fallback must satisfy the same contract the renderer relies on for GLB actors:
 * every clip name it plays, a weapon bone on troopers, feet on the ground, and clean clip switching.
 */

const lib = buildProceduralLibrary();

const HERO_CLIPS = [
  ['Run_Shoot', 'Idle_Shoot', 'Wave'],
  ['Run_Shoot', 'Idle_Shoot', 'Wave'],
  ['Run', 'Idle'],
] as const;
const ENEMY_CLIPS = {
  crawler: ['Walk', 'Bite_Front', 'Death'],
  dasher: ['Run', 'Duck', 'Death'],
  bastion: ['Walk', 'Weapon', 'Death'],
  mitosis: ['Walk', 'Death'],
  siphon: ['Fast_Flying', 'Flying_Idle', 'Death'],
} as const;
const BOSS_CLIPS = {
  warden: ['Fast_Flying', 'Punch', 'Death'],
  hydraA: ['Fast_Flying', 'Headbutt', 'Death'],
  hydraB: ['Fast_Flying', 'Headbutt', 'Death'],
  omega: ['Idle', 'Walk', 'Weapon', 'Death'],
} as const;

function allTemplates(): Array<[string, ActorTemplate, readonly string[]]> {
  const out: Array<[string, ActorTemplate, readonly string[]]> = [];
  lib.heroes.forEach((t, i) => out.push([`hero${i + 1}`, t, HERO_CLIPS[i]!]));
  for (const [k, clips] of Object.entries(ENEMY_CLIPS)) out.push([k, lib.enemies[k as keyof typeof ENEMY_CLIPS], clips]);
  for (const [k, clips] of Object.entries(BOSS_CLIPS)) out.push([k, lib.bosses[k as keyof typeof BOSS_CLIPS], clips]);
  return out;
}

function posedBox(actor: AnimatedActor): THREE.Box3 {
  actor.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  actor.root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || m.material !== actor.mat) return;
    const pos = m.geometry.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      box.expandByPoint(v);
    }
  });
  return box;
}

describe('procedural fallback actor library', () => {
  it.each(allTemplates())('%s has every clip the renderer plays, bound to real bones', (_name, tmpl, clips) => {
    expect(Number.isFinite(tmpl.baseScale) && tmpl.baseScale > 0).toBe(true);
    for (const name of clips) {
      const clip = tmpl.clips.get(name);
      expect(clip, name).toBeDefined();
      for (const track of clip!.tracks) {
        const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name);
        expect(THREE.PropertyBinding.findNode(tmpl.scene, nodeName), track.name).toBeTruthy();
      }
    }
  });

  it.each(allTemplates())('%s stands on the ground in its first pose', (name, tmpl) => {
    const actor = spawnActor(tmpl);
    const primary = ['Run_Shoot', 'Run', 'Walk', 'Fast_Flying'].find((c) => tmpl.clips.has(c)) ?? [...tmpl.clips.keys()][0]!;
    actor.play(primary);
    actor.mixer.update(0);
    const box = posedBox(actor);
    const hover = name === 'siphon' ? 0.3 : 0;
    expect(box.min.y).toBeCloseTo(hover, 1);
    expect(box.max.y - box.min.y).toBeGreaterThan(0.8);
  });

  it('troopers carry a swappable gun baked into the skin on the hand bone; the mech does not', () => {
    for (const tier of [0, 1]) {
      const tmpl = lib.heroes[tier]!;
      const actor = spawnActor(tmpl, { weapons: lib.weapons, initialWeapon: 'pulse' });
      const skin = actor.weaponSkin!;
      expect(skin).not.toBeNull();
      expect(actor.weaponMesh).toBeNull();
      // One skinned mesh plus its outline: the gun costs no extra draw call
      let meshes = 0;
      actor.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
      });
      expect(meshes).toBe(2);
      actor.setWeapon('rail', lib.weapons);
      expect(skin.body.geometry).toBe(skin.skins.rail.geo);
      expect(skin.outline.geometry).toBe(skin.skins.rail.outlineGeo);

      // In an animated pose the baked gun sits exactly where the gun mesh would ride on the hand bone
      actor.play('Run_Shoot');
      actor.update(0.23);
      actor.root.updateMatrixWorld(true);
      const hand = actor.root.getObjectByName('Index1R')!;
      let bodyGeo: THREE.BufferGeometry | null = null;
      tmpl.scene.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) bodyGeo = (o as THREE.SkinnedMesh).geometry;
      });
      const bodyCount = bodyGeo!.index ? bodyGeo!.index.count : bodyGeo!.attributes.position!.count;
      const index = skin.body.geometry.index!;
      const gun = lib.weapons.rail.geo.index ? lib.weapons.rail.geo.toNonIndexed() : lib.weapons.rail.geo;
      const gunPos = gun.attributes.position!;
      expect(index.count - bodyCount).toBe(gunPos.count);
      const pos = skin.body.geometry.attributes.position!;
      const actual = new THREE.Vector3();
      const expected = new THREE.Vector3();
      let worst = 0;
      for (let k = 0; k < gunPos.count; k++) {
        actual.fromBufferAttribute(pos, index.getX(bodyCount + k));
        skin.body.applyBoneTransform(index.getX(bodyCount + k), actual).applyMatrix4(skin.body.matrixWorld);
        expected.fromBufferAttribute(gunPos, k).applyMatrix4(hand.matrixWorld);
        worst = Math.max(worst, actual.distanceTo(expected));
      }
      expect(worst).toBeLessThan(1e-4);
    }
    const mech = spawnActor(lib.heroes[2], { weapons: undefined });
    expect(mech.weaponSkin).toBeNull();
    expect(mech.weaponMesh).toBeNull();
  });
  it('weapon and reward meshes use RGB vertex colours with outlines', () => {
    for (const def of [...Object.values(lib.weapons), ...Object.values(lib.vaultRewards)]) {
      expect(def.geo.getAttribute('color').itemSize).toBe(3);
      expect(def.outlineGeo.getAttribute('position').count).toBe(def.geo.getAttribute('position').count);
    }
  });

  it('running animates the legs and a pooled actor recovers from Death', () => {
    const actor = spawnActor(lib.enemies.crawler);
    const legs = actor.root.getObjectByName('legsL')!;
    const root = actor.root.getObjectByName('root')!;
    actor.play('Walk');
    actor.update(0.2);
    const q0 = legs.quaternion.clone();
    actor.update(0.2);
    expect(legs.quaternion.angleTo(q0)).toBeGreaterThan(0.05);

    actor.play('Death', { loop: false, fade: 0.05 });
    actor.update(1);
    expect(root.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(1);

    actor.resetAnimation();
    actor.play('Walk');
    actor.update(0.5);
    expect(root.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-3);
  });
});
