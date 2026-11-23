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
import { buildRewardDisplayGeo, buildSoldierModels, buildWeaponGeo, TROOPER_GRIP, type SoldierModel } from './soldiers';
import { buildOutlineGeometry } from './toon';

/**
 * Procedural actor library & custom rigged archetypes.
 * Same template shape, sizes and clip names as `loadGltfLibrary`, so the renderer needs no special cases.
 */

const WEAPON_IDS: readonly WeaponId[] = ['pulse', 'scatter', 'rail', 'plasma', 'cryo'];
const REWARD_IDS: readonly RewardId[] = [...WEAPON_IDS, 'blades'];

function heroTemplate(model: SoldierModel, tier: 1 | 2 | 3, targetHeight: number): ActorTemplate {
  const mech = tier === 3;
  const k = model.scale;
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
  bomber: () => {
    const run = (primed: boolean): PoseFn => (u) => {
      const ph = u * TAU;
      const s = Math.sin(ph);
      const hop = Math.abs(s) * 0.08;
      const swell = primed ? 1 + Math.abs(Math.sin(ph * 3)) * 0.16 : 1 + Math.abs(s) * 0.05;
      return {
        body: { r: [0.18 + Math.abs(s) * 0.1, 0, s * 0.1], o: [0, hop, 0] },
        tank: { s: swell, r: [s * 0.08, 0, -s * 0.12], o: [0, hop, 0] },
        arms: { r: [-0.45 + s * 0.25, 0, 0], o: [0, hop, 0] },
        legL: { r: [s * 0.72, 0, 0] },
        legR: { r: [-s * 0.72, 0, 0] },
      };
    };
    return {
      targetHeight: 1.52,
      clips: [
        { name: 'Run', duration: 0.62, pose: run(false) },
        { name: 'Prime', duration: 0.42, pose: run(true) },
        deathClip(run(false), 0.58, 1.55, 0.05),
      ],
    };
  },
  phalanx: () => {
    const march = (bash: boolean): PoseFn => (u) => {
      const ph = u * TAU;
      const s = Math.sin(ph);
      const lift = Math.abs(s) * 0.05;
      const thrust = bash ? Math.max(0, s) : 0;
      return {
        body: { r: [thrust * 0.14, 0, s * 0.05], o: [0, lift, thrust * 0.14] },
        shieldArm: { r: [-thrust * 0.18, s * 0.06, 0], o: [0, lift, thrust * 0.36] },
        weaponArm: { r: [-thrust * 0.55 - s * 0.18, 0, 0], o: [0, lift, thrust * 0.22] },
        legL: { r: [s * 0.44, 0, 0] },
        legR: { r: [-s * 0.44, 0, 0] },
      };
    };
    return {
      targetHeight: 1.92,
      clips: [
        { name: 'Walk', duration: 1.15, pose: march(false) },
        { name: 'Bash', duration: 0.72, pose: march(true) },
        deathClip(march(false), 0.6, 1.38, 0.05),
      ],
    };
  },
  stalker: () => {
    const sprint = (slash: boolean): PoseFn => (u) => {
      const ph = u * TAU;
      const s = Math.sin(ph);
      const hop = Math.abs(s) * 0.07;
      const swing = slash ? Math.sin(ph * 2) * 0.85 : s * 0.35;
      return {
        body: { r: [0.16, s * 0.14, s * 0.08], o: [0, hop, 0] },
        bladeL: { r: [-0.4 + swing, -0.25 * s, 0], o: [0, hop, 0] },
        bladeR: { r: [-0.4 - swing, 0.25 * s, 0], o: [0, hop, 0] },
        legL: { r: [s * 0.78, 0, 0] },
        legR: { r: [-s * 0.78, 0, 0] },
      };
    };
    return {
      targetHeight: 1.62,
      clips: [
        { name: 'Run', duration: 0.56, pose: sprint(false) },
        { name: 'Slash', duration: 0.46, pose: sprint(true) },
        deathClip(sprint(false), 0.58, 1.5, 0.05),
      ],
    };
  },
  brood: () => {
    const scuttle = (spawning: boolean): PoseFn => (u) => {
      const ph = u * TAU;
      const s = Math.sin(ph);
      const bob = Math.abs(s) * 0.05;
      const pulse = spawning ? 1 + Math.abs(Math.sin(ph * 2)) * 0.18 : 1 + Math.abs(s) * 0.07;
      return {
        thorax: { r: [s * 0.08, s * 0.06, 0], o: [0, bob, 0] },
        sac: { s: pulse, r: [-Math.abs(s) * 0.08, -s * 0.08, 0], o: [0, bob, 0] },
        legsA: { r: [0, s * 0.28, s * 0.08], o: [0, bob, 0] },
        legsB: { r: [0, -s * 0.28, -s * 0.08], o: [0, bob, 0] },
      };
    };
    return {
      targetHeight: 1.78,
      clips: [
        { name: 'Walk', duration: 0.95, pose: scuttle(false) },
        { name: 'Spawn', duration: 0.65, pose: scuttle(true) },
        deathClip(scuttle(false), 0.62, 1.35, 0.05),
      ],
    };
  },
  howler: () => {
    const chant = (howling: boolean): PoseFn => (u) => {
      const ph = u * TAU;
      const s = Math.sin(ph);
      const lift = Math.abs(s) * 0.055;
      const vib = howling ? Math.sin(ph * 4) * 0.14 : s * 0.06;
      return {
        body: { r: [howling ? -0.14 * Math.abs(s) : 0.05, 0, s * 0.06], o: [0, lift, 0] },
        totemL: { r: [vib, 0, -Math.abs(s) * 0.1], s: 1 + Math.abs(s) * (howling ? 0.1 : 0.04), o: [0, lift, 0] },
        totemR: { r: [-vib, 0, Math.abs(s) * 0.1], s: 1 + Math.abs(s) * (howling ? 0.1 : 0.04), o: [0, lift, 0] },
        legL: { r: [s * 0.45, 0, 0] },
        legR: { r: [-s * 0.45, 0, 0] },
      };
    };
    return {
      targetHeight: 2.02,
      clips: [
        { name: 'Walk', duration: 1.05, pose: chant(false) },
        { name: 'Howl', duration: 0.75, pose: chant(true) },
        deathClip(chant(false), 0.6, 1.4, 0.05),
      ],
    };
  },
  glacier: () => {
    const lumber = (smash: boolean): PoseFn => (u) => {
      const ph = u * TAU;
      const s = Math.sin(ph);
      const stomp = Math.abs(s) * 0.05;
      const slam = smash ? -0.65 - Math.sin(ph * 2) * 0.55 : s * 0.36;
      return {
        body: { r: [smash ? 0.16 : 0.06, s * 0.08, s * 0.05], o: [0, stomp, 0] },
        armL: { r: [slam, 0, -0.1], o: [0, stomp, 0] },
        armR: { r: [smash ? slam : -slam, 0, 0.1], o: [0, stomp, 0] },
        legL: { r: [s * 0.42, 0, 0] },
        legR: { r: [-s * 0.42, 0, 0] },
      };
    };
    return {
      targetHeight: 2.18,
      clips: [
        { name: 'Walk', duration: 1.12, pose: lumber(false) },
        { name: 'Smash', duration: 0.72, pose: lumber(true) },
        deathClip(lumber(false), 0.65, 1.35, 0.05),
      ],
    };
  },
  beholder: () => {
    const orbit = (focus: boolean): PoseFn => (u) => {
      const ph = u * TAU;
      const s = Math.sin(ph);
      const bob = Math.sin(ph) * 0.06;
      const spin = focus ? ph * 2 : ph;
      return {
        core: { r: [focus ? 0.12 : s * 0.05, s * 0.12, 0], o: [0, bob, 0], s: focus ? 1 + Math.abs(s) * 0.08 : 1 },
        ringOuter: { r: [s * 0.35, spin * 0.45, Math.cos(ph) * 0.28], o: [0, bob, 0] },
        ringInner: { r: [-Math.cos(ph) * 0.4, -spin * 0.55, s * 0.32], o: [0, bob, 0] },
      };
    };
    return {
      targetHeight: 1.92,
      clips: [
        { name: 'Flying_Idle', duration: 1.15, pose: orbit(false) },
        { name: 'Focus', duration: 0.65, pose: orbit(true) },
        deathClip(orbit(false), 0.58, 1.45, 0.05),
      ],
    };
  },
  burrower: () => {
    const tunnel = (surge: boolean): PoseFn => (u) => {
      const ph = u * TAU;
      const s = Math.sin(ph);
      const hop = Math.abs(s) * (surge ? 0.09 : 0.045);
      return {
        carapace: { r: [surge ? -0.14 : 0.04, s * 0.08, s * 0.06], o: [0, hop, 0] },
        drill: { r: [0, 0, ph * (surge ? 3.0 : 1.5)], o: [0, hop, 0], s: surge ? 1.12 : 1 },
        clawL: { r: [s * 0.55, 0, -Math.abs(s) * 0.12], o: [0, hop, 0] },
        clawR: { r: [-s * 0.55, 0, Math.abs(s) * 0.12], o: [0, hop, 0] },
      };
    };
    return {
      targetHeight: 1.38,
      clips: [
        { name: 'Run', duration: 0.62, pose: tunnel(false) },
        { name: 'Drill', duration: 0.44, pose: tunnel(true) },
        deathClip(tunnel(false), 0.56, 1.5, 0.05),
      ],
    };
  },
  necromancer: () => {
    const weave = (cast: boolean): PoseFn => (u) => {
      const ph = u * TAU;
      const s = Math.sin(ph);
      const floatY = Math.abs(s) * 0.065;
      const raise = cast ? -0.58 - Math.abs(s) * 0.35 : s * 0.22;
      return {
        body: { r: [cast ? -0.08 : 0.05, s * 0.09, s * 0.04], o: [0, floatY, 0] },
        staffL: { r: [raise, 0, -0.12 * Math.abs(s)], o: [0, floatY, 0] },
        staffR: { r: [cast ? raise : -raise, 0, 0.12 * Math.abs(s)], o: [0, floatY, 0] },
      };
    };
    return {
      targetHeight: 2.06,
      clips: [
        { name: 'Flying_Idle', duration: 1.08, pose: weave(false) },
        { name: 'Cast', duration: 0.68, pose: weave(true) },
        deathClip(weave(false), 0.6, 1.4, 0.05),
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

/** Builds procedural ActorTemplates for all 10 EnemyKind archetypes (also shared by loadGltfLibrary for new archetypes). */
export function buildProceduralEnemyTemplates(): Record<EnemyKind, ActorTemplate> {
  const monsters = buildMonsterModels();
  const enemies = {} as Record<EnemyKind, ActorTemplate>;
  for (const kind of Object.keys(MONSTER_RIGS) as EnemyKind[]) {
    enemies[kind] = monsterTemplate(kind, monsters[kind]);
  }
  return enemies;
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
  const enemies = buildProceduralEnemyTemplates();
  const weapons = {} as Record<WeaponId, WeaponMeshDef>;
  for (const w of WEAPON_IDS) weapons[w] = meshDef(buildWeaponGeo(w, 1).translate(...TROOPER_GRIP));
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
