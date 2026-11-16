import * as THREE from 'three';
import type { EnemyKind, RewardId, WeaponId } from '../../types/game';
import type { ActorTemplate, GltfLibrary, WeaponMeshDef } from './gltfLibrary';
import { buildMonsterModels, type MonsterModel } from './monsters';
import { buildProceduralBosses } from './proceduralBosses';
import {
  TAU,
  deathClip,
  kitToRgb,
  rigTemplate,
  type ClipSpec,
  type PartSpec,
  type Pose,
  type PoseFn,
} from './proceduralRig';
import { buildRewardDisplayGeo, buildSoldierModels, buildWeaponGeo, type SoldierModel } from './soldiers';
import { buildOutlineGeometry } from './toon';

/**
 * Procedural stand-in for the GLB actor library, used when the models cannot be loaded.
 * Same template shape, sizes and clip names as `loadGltfLibrary`, so the renderer needs no special cases.
 */

const WEAPON_IDS: readonly WeaponId[] = ['pulse', 'scatter', 'rail', 'plasma', 'cryo'];
const REWARD_IDS: readonly RewardId[] = [...WEAPON_IDS, 'blades'];
/** Hand offset of the soldier gun relative to the arms pivot (matches soldiers.ts at scale 1) */
const GRIP_OFFSET: readonly [number, number, number] = [0.08, -0.1, -0.12];

function heroTemplate(model: SoldierModel, tier: 1 | 2 | 3, targetHeight: number): ActorTemplate {
  const mech = tier === 3;
  const k = model.scale;
  // Troopers hold a swappable gun on the same bone name the GLB rigs use; the mech's cannon is part of its body.
  const gun = mech ? 'gun' : 'Index1R';
  const parts: PartSpec[] = model.parts.map((p) =>
    p.name === 'gun' && !mech ? { name: gun, joint: p.joint, scale: k } : { name: p.name, joint: p.joint, geo: p.geo },
  );
  const lift = (pose: Pose, y: number): Pose => {
    for (const n of ['body', 'head', 'arms', gun]) pose[n] = { ...pose[n], o: [0, y, 0] };
    return pose;
  };
  const legA = mech ? 0.45 : 0.75;
  const run: PoseFn = (u) => {
    const ph = u * TAU;
    const s = Math.sin(ph);
    return lift(
      {
        legL: { r: [s * legA, 0, 0] },
        legR: { r: [-s * legA, 0, 0] },
        body: { r: [-0.05, 0, 0] },
        head: { r: [0.04 + s * 0.03, 0, 0] },
      },
      Math.abs(Math.cos(ph)) * (mech ? 0.05 : 0.035) * k,
    );
  };
  const idle: PoseFn = (u) => lift({ head: { r: [0.04, 0, 0] } }, Math.sin(u * TAU) * 0.012 * k);
  const wave: PoseFn = (u) => {
    const ph = u * TAU;
    const raise = 1.05 + Math.sin(ph * 2) * 0.25;
    const pose = lift(
      {
        body: { r: [0, 0, Math.sin(ph) * 0.07] },
        head: { r: [-0.12, 0, 0] },
        arms: { r: [raise, 0, 0] },
        [gun]: { r: [raise, 0, 0] },
      },
      0,
    );
    pose.root = { o: [0, Math.abs(Math.sin(ph)) * 0.09 * k, 0] };
    return pose;
  };
  const runDuration = mech ? 1.0 : 0.72;
  const clips: ClipSpec[] = [
    { name: 'Run_Shoot', duration: runDuration, pose: run },
    { name: 'Run', duration: runDuration, pose: run },
    { name: 'Idle_Shoot', duration: 1.6, pose: idle, samples: 12 },
    { name: 'Idle', duration: 1.6, pose: idle, samples: 12 },
    { name: 'Wave', duration: 0.9, pose: wave },
    deathClip(run, 0.6, 1.4, 0),
  ];
  return rigTemplate(`hero${tier}`, parts, clips, { targetHeight, facingYaw: Math.PI, sceneYaw: Math.PI });
}

interface MonsterRig {
  targetHeight: number;
  hoverOffset?: number;
  clips: ClipSpec[];
}

const MONSTER_RIGS: Record<EnemyKind, () => MonsterRig> = {
  crawler: () => {
    const walk = (lungeAmt: number): PoseFn => (u) => {
      const ph = u * TAU;
      const s = Math.sin(ph);
      const bob = Math.abs(Math.sin(ph * 2)) * 0.05;
      const lunge = Math.max(0, s) * lungeAmt;
      return {
        body: { r: [lunge, 0, s * 0.08], o: [0, bob, lunge * 0.25] },
        legsL: { r: [0, s * 0.35, s * 0.1], o: [0, bob, 0] },
        legsR: { r: [0, s * 0.35, -s * 0.1], o: [0, bob, 0] },
      };
    };
    return {
      targetHeight: 1.0,
      clips: [
        { name: 'Walk', duration: 0.75, pose: walk(0) },
        { name: 'Bite_Front', duration: 0.55, pose: walk(0.45) },
        deathClip(walk(0), 0.6, 1.5, 0.05),
      ],
    };
  },
  dasher: () => {
    const run = (tele: boolean): PoseFn => (u) => {
      const ph = u * TAU;
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      const stride = tele ? 0.15 : 0.85;
      const crouch = tele ? -0.12 : Math.abs(s) * 0.05;
      const front = tele ? 0.25 : s * stride;
      const back = tele ? 0.25 : -s * stride;
      return {
        body: { r: [s * 0.1 * stride + (tele ? 0.15 : 0), 0, 0], o: [0, crouch, 0] },
        head: { r: [tele ? 0.45 : -s * 0.12, 0, 0], o: [0, crouch, 0] },
        jaw: { r: [tele ? 0.75 + Math.sin(ph * 6) * 0.1 : 0.15 + Math.abs(c) * 0.25, 0, 0], o: [0, crouch, 0] },
        legFL: { r: [front, 0, 0] },
        legFR: { r: [front, 0, 0] },
        legBL: { r: [back, 0, 0] },
        legBR: { r: [back, 0, 0] },
      };
    };
    return {
      targetHeight: 1.25,
      clips: [
        { name: 'Run', duration: 0.6, pose: run(false) },
        { name: 'Duck', duration: 0.5, pose: run(true) },
        deathClip(run(false), 0.6, 1.5, 0.05),
      ],
    };
  },
  bastion: () => {
    const walk = (bash: boolean): PoseFn => (u) => {
      const ph = u * TAU;
      const step = Math.sin(ph);
      const lift = Math.abs(step) * 0.06;
      const b = bash ? Math.max(0, Math.sin(ph)) : 0;
      return {
        body: { r: [b * 0.18, 0, step * 0.06], o: [0, lift, b * 0.15] },
        head: { r: [0, Math.sin(ph) * 0.2, 0], o: [0, lift, b * 0.2] },
        armL: { r: [-0.75 + step * 0.08 - b * 0.55, 0, 0], o: [0, lift, b * 0.15] },
        armR: { r: [-0.75 - step * 0.08 - b * 0.55, 0, 0], o: [0, lift, b * 0.15] },
        legL: { r: [bash ? 0 : step * 0.35, 0, 0] },
        legR: { r: [bash ? 0 : -step * 0.35, 0, 0] },
        shield: { o: [0, lift, b * 0.55] },
      };
    };
    return {
      targetHeight: 2.5,
      clips: [
        { name: 'Walk', duration: 1.6, pose: walk(false) },
        { name: 'Weapon', duration: 0.9, pose: walk(true) },
        deathClip(walk(false), 0.6, 1.35, 0.05),
      ],
    };
  },
  mitosis: () => {
    const walk: PoseFn = (u) => {
      const ph = u * TAU;
      const sq = Math.sin(ph * 2);
      const bounce = Math.abs(Math.sin(ph)) * 0.18;
      const sway = Math.sin(ph) * 0.3;
      return {
        body: { s: 1 + sq * 0.06, o: [0, bounce, 0], r: [0, sway, 0] },
        face: { o: [0, bounce + sq * 0.02, 0], r: [0, sway, 0] },
        cells: { o: [0, bounce, 0], r: [0, ph, 0] },
      };
    };
    return {
      targetHeight: 1.55,
      clips: [{ name: 'Walk', duration: 1.4, pose: walk, samples: 32 }, deathClip(walk, 0.6, 1.2, 0.1)],
    };
  },
  siphon: () => {
    const fly = (amp: number): PoseFn => (u) => {
      const ph = u * TAU;
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      const bob = s * 0.12;
      return {
        head: { r: [s * 0.08, 0, 0], o: [0, bob, 0] },
        tentA: { r: [s * amp, s * 0.5, c * 0.12], o: [0, bob, 0] },
        tentB: { r: [-s * amp, -s * 0.5, -c * 0.12], o: [0, bob, 0] },
      };
    };
    return {
      targetHeight: 1.75,
      hoverOffset: 0.3,
      clips: [
        { name: 'Flying_Idle', duration: 2.4, pose: fly(0.22) },
        { name: 'Fast_Flying', duration: 1.3, pose: fly(0.38) },
        deathClip(fly(0.22), 0.6, 1.2, 0.3),
      ],
    };
  },
};

function monsterTemplate(kind: EnemyKind, model: MonsterModel): ActorTemplate {
  const rig = MONSTER_RIGS[kind]();
  const parts: PartSpec[] = model.parts.map((p) => ({ name: p.name, joint: p.joint, geo: p.geo }));
  return rigTemplate(kind, parts, rig.clips, {
    targetHeight: rig.targetHeight,
    facingYaw: 0,
    refRadius: model.baseRadius,
    hoverOffset: rig.hoverOffset,
  });
}

function meshDef(geo: THREE.BufferGeometry): WeaponMeshDef {
  const g = kitToRgb(geo);
  g.computeBoundingSphere();
  return { geo: g, outlineGeo: buildOutlineGeometry(g) };
}

/** Reward capsule hologram, centred and fitted like the GLB vault meshes. */
function rewardDef(id: RewardId): WeaponMeshDef {
  const geo = buildRewardDisplayGeo(id);
  if (id !== 'blades') {
    geo.center();
    geo.computeBoundingBox();
    const size = new THREE.Vector3();
    geo.boundingBox!.getSize(size);
    const fit = 1.42 / Math.max(0.2, size.x, size.y, size.z);
    geo.scale(fit, fit, fit);
  }
  return meshDef(geo);
}

export function buildProceduralLibrary(): GltfLibrary {
  const [trooper, heavy, mech] = buildSoldierModels();
  const monsters = buildMonsterModels();
  const enemies = {} as Record<EnemyKind, ActorTemplate>;
  for (const kind of Object.keys(MONSTER_RIGS) as EnemyKind[]) enemies[kind] = monsterTemplate(kind, monsters[kind]);
  const weapons = {} as Record<WeaponId, WeaponMeshDef>;
  for (const w of WEAPON_IDS) weapons[w] = meshDef(buildWeaponGeo(w, 1).translate(...GRIP_OFFSET));
  const vaultRewards = {} as Record<RewardId, WeaponMeshDef>;
  for (const id of REWARD_IDS) vaultRewards[id] = rewardDef(id);
  return {
    heroes: [heroTemplate(trooper!, 1, 1.38), heroTemplate(heavy!, 2, 1.72), heroTemplate(mech!, 3, 2.08)],
    enemies,
    bosses: buildProceduralBosses(),
    weapons,
    vaultRewards,
  };
}
