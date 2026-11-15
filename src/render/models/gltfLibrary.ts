import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EnemyKind, RewardId, WeaponId } from '../../types/game';
import { buildBladeGeo } from './soldiers';
import {
  buildOutlineGeometry,
  createToonCharMaterial,
  getOutlineMaterial,
  getToonUniforms,
} from './toon';

export interface WeaponMeshDef {
  geo: THREE.BufferGeometry;
  outlineGeo: THREE.BufferGeometry;
}

export interface ActorTemplate {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  /** Uniform scale so actor stands at targetHeight in world units */
  baseScale: number;
  /** Y offset in template space before scaling (or world offset after scaling) so feet touch y=0 */
  groundYOffset: number;
  /** Native forward rotation around Y (Math.PI for heroes shooting -Z, 0 for monsters facing +Z) */
  facingYaw: number;
  /** Reference collision radius used to scale monsters proportionally when sim radius varies */
  refRadius: number;
  /** True when template uses an embedded UV texture rather than baked vertex colors */
  textured: boolean;
  texture: THREE.Texture | null;
}

export interface GltfLibrary {
  heroes: [ActorTemplate, ActorTemplate, ActorTemplate];
  enemies: Record<EnemyKind, ActorTemplate>;
  bosses: {
    warden: ActorTemplate;
    hydraA: ActorTemplate;
    hydraB: ActorTemplate;
    omega: ActorTemplate;
  };
  weapons: Record<WeaponId, WeaponMeshDef>;
  vaultRewards: Record<RewardId, WeaponMeshDef>;
}

export interface PlayClipOptions {
  fade?: number;
  loop?: boolean;
  timeScale?: number;
  startOffset?: number;
}

export class AnimatedActor {
  readonly root = new THREE.Group();
  readonly inner = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  readonly actions = new Map<string, THREE.AnimationAction>();
  readonly mat: THREE.MeshToonMaterial;
  activeClip = '';
  weaponMesh: THREE.Mesh | null = null;
  weaponOutline: THREE.Mesh | null = null;

  constructor(
    clonedScene: THREE.Object3D,
    clips: Map<string, THREE.AnimationClip>,
    mat: THREE.MeshToonMaterial,
    baseScale: number,
    groundYOffset: number,
    facingYaw: number,
  ) {
    this.mat = mat;
    this.inner.rotation.y = facingYaw;
    this.inner.scale.setScalar(baseScale);
    this.inner.position.y = groundYOffset * baseScale;
    this.inner.add(clonedScene);
    this.root.add(this.inner);

    this.mixer = new THREE.AnimationMixer(clonedScene);
    for (const [name, clip] of clips) {
      this.actions.set(name, this.mixer.clipAction(clip));
    }
  }

  play(name: string, opts: PlayClipOptions = {}): void {
    const next = this.actions.get(name);
    if (!next) return;
    const loop = opts.loop ?? true;
    const speed = opts.timeScale ?? 1;
    next.timeScale = speed;

    if (this.activeClip === name) {
      if (!next.isRunning() && loop) next.play();
      return;
    }

    const prev = this.activeClip ? this.actions.get(this.activeClip) : undefined;
    this.activeClip = name;

    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    if (opts.startOffset !== undefined) {
      next.time = opts.startOffset;
    }
    next.play();

    const fade = opts.fade ?? 0.12;
    if (prev && prev !== next && fade > 0) {
      prev.crossFadeTo(next, fade, false);
    } else if (prev && prev !== next) {
      prev.stop();
    }
  }

  setTimeScale(speed: number): void {
    const cur = this.activeClip ? this.actions.get(this.activeClip) : undefined;
    if (cur) cur.timeScale = speed;
  }

  setWeapon(weapon: WeaponId, weapons: Record<WeaponId, WeaponMeshDef>): void {
    const def = weapons[weapon];
    if (!def || !this.weaponMesh || !this.weaponOutline) return;
    if (this.weaponMesh.geometry !== def.geo) {
      this.weaponMesh.geometry = def.geo;
      this.weaponOutline.geometry = def.outlineGeo;
    }
  }

  setVisuals(flash: number, r = 1, g = 1, b = 1): void {
    const u = getToonUniforms(this.mat);
    if (!u) return;
    u.uFlash.value = flash;
    u.uTint.value.setRGB(r, g, b);
  }

  update(dt: number): void {
    if (dt > 0) this.mixer.update(dt);
  }
}

const WEAPON_NODE_MAP: Record<WeaponId, string> = {
  pulse: 'SMG',
  scatter: 'Shotgun',
  rail: 'Sniper',
  plasma: 'RocketLauncher',
  cryo: 'GrenadeLauncher',
};

const WEAPON_TINT_HEX: Record<WeaponId, number> = {
  pulse: 0x3ef3ff,
  scatter: 0x7dff6b,
  rail: 0xc29bff,
  plasma: 0xff9a3c,
  cryo: 0x8fdcff,
};

/**
 * Bakes a Mesh's material base color into a 3-component linear RGB `color` vertex attribute,
 * optionally shifting bright/accent materials toward an accent color.
 */
function bakeMeshColorGeo(
  mesh: THREE.Mesh,
  accentHex?: number,
  localMatrix?: THREE.Matrix4,
): THREE.BufferGeometry {
  const geo = mesh.geometry.clone();
  if (localMatrix) geo.applyMatrix4(localMatrix);
  if (!geo.attributes.normal) geo.computeVertexNormals();

  // Strip unused UV/tangent attributes so mergeGeometries attributes match cleanly across primitives
  for (const key of Object.keys(geo.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'skinIndex' && key !== 'skinWeight') {
      geo.deleteAttribute(key);
    }
  }

  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const baseCol = new THREE.Color(0xffffff);
  if (mat && 'color' in mat && mat.color instanceof THREE.Color) {
    baseCol.copy(mat.color);
  }
  const matName = mat?.name ?? '';
  if (accentHex !== undefined) {
    const accent = new THREE.Color(accentHex);
    if (matName === 'Red' || matName === 'Wood' || matName === 'LightGrey') {
      baseCol.lerp(accent, matName === 'LightGrey' ? 0.65 : 0.9);
    } else if (matName === 'Grey') {
      baseCol.lerp(accent, 0.35);
    }
  }

  const count = geo.attributes.position!.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = baseCol.r;
    colors[i * 3 + 1] = baseCol.g;
    colors[i * 3 + 2] = baseCol.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

const WEAPON_CHIBI_SCALE: Record<WeaponId, [number, number, number]> = {
  // In Index1.R bone space: X = gun height, Y = barrel length, Z = gun lateral width
  pulse: [1.05, 0.78, 1.55],
  scatter: [1.18, 0.66, 1.9],
  rail: [1.05, 0.56, 1.8],
  plasma: [0.95, 0.72, 1.22],
  cryo: [1.02, 0.75, 1.28],
};

/**
 * Extracts the 5 Toon Shooter weapons from the trooper rig, merges each into a single
 * vertex-colored BufferGeometry + smooth outline geometry, and scales for Q-version readability.
 */
function extractHeroWeapons(trooperScene: THREE.Group): {
  weapons: Record<WeaponId, WeaponMeshDef>;
  vaultRewards: Record<RewardId, WeaponMeshDef>;
} {
  const weapons = {} as Record<WeaponId, WeaponMeshDef>;
  const vaultRewards = {} as Record<RewardId, WeaponMeshDef>;

  for (const weapon of Object.keys(WEAPON_NODE_MAP) as WeaponId[]) {
    const nodeName = WEAPON_NODE_MAP[weapon];
    const node = trooperScene.getObjectByName(nodeName);
    if (!node) throw new Error(`Missing weapon node ${nodeName} in hero_trooper.glb`);
    node.updateMatrix();

    const partGeos: THREE.BufferGeometry[] = [];
    const collect = (obj: THREE.Object3D, matAcc: THREE.Matrix4): void => {
      if ((obj as THREE.Mesh).isMesh) {
        partGeos.push(bakeMeshColorGeo(obj as THREE.Mesh, WEAPON_TINT_HEX[weapon], matAcc));
      }
      for (const child of obj.children) {
        child.updateMatrix();
        const nextMat = matAcc.clone().multiply(child.matrix);
        collect(child, nextMat);
      }
    };
    collect(node, node.matrix.clone());

    const merged = mergeGeometries(partGeos, false);
    if (!merged) throw new Error(`Failed merging weapon ${nodeName}`);
    const [sx, sy, sz] = WEAPON_CHIBI_SCALE[weapon];
    merged.scale(sx, sy, sz);
    merged.computeBoundingSphere();
    const outlineGeo = buildOutlineGeometry(merged);
    weapons[weapon] = { geo: merged, outlineGeo };

    // Centered, horizontally-oriented display mesh normalized to fit Reward Vault capsules cleanly
    const vaultGeo = merged.clone();
    vaultGeo.rotateZ(-Math.PI / 2);
    vaultGeo.center();
    vaultGeo.computeBoundingBox();
    const bSize = new THREE.Vector3();
    vaultGeo.boundingBox!.getSize(bSize);
    const maxDim = Math.max(0.2, bSize.x, bSize.y, bSize.z);
    const fit = 1.42 / maxDim;
    vaultGeo.scale(fit, fit, fit);
    vaultGeo.computeBoundingSphere();
    vaultRewards[weapon] = {
      geo: vaultGeo,
      outlineGeo: buildOutlineGeometry(vaultGeo),
    };
  }

  // Orbital Bit-Blades reward display mesh (strip alpha from 4-comp kit colors -> 3-comp RGB)
  const rawBlade = buildBladeGeo();
  rawBlade.scale(2.2, 2.2, 2.2);
  const c4 = rawBlade.attributes.color;
  if (c4 && c4.itemSize === 4) {
    const rgb = new Float32Array(c4.count * 3);
    for (let i = 0; i < c4.count; i++) {
      rgb[i * 3] = c4.getX(i);
      rgb[i * 3 + 1] = c4.getY(i);
      rgb[i * 3 + 2] = c4.getZ(i);
    }
    rawBlade.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  }
  vaultRewards.blades = {
    geo: rawBlade,
    outlineGeo: buildOutlineGeometry(rawBlade),
  };

  return { weapons, vaultRewards };
}

/**
 * Merges multi-primitive SkinnedMesh/Mesh groups on a template scene into single-draw-call meshes
 * with precomputed smooth outline geometry cached on `mesh.userData.outlineGeo`.
 */
function optimizeTemplateScene(scene: THREE.Group, stripWeaponNodes: boolean): {
  textured: boolean;
  texture: THREE.Texture | null;
} {
  if (stripWeaponNodes) {
    for (const nodeName of Object.values(WEAPON_NODE_MAP)) {
      const n = scene.getObjectByName(nodeName);
      if (n && n.parent) n.parent.remove(n);
    }
  }

  let textured = false;
  let foundTex: THREE.Texture | null = null;

  // First pass: merge any Group whose children are all untextured SkinnedMeshes or all untextured Meshes
  const groupsToMerge: THREE.Object3D[] = [];
  scene.traverse((obj) => {
    if (obj.children.length > 1) {
      const allSkinned = obj.children.every((c) => (c as THREE.SkinnedMesh).isSkinnedMesh);
      const allPlainMesh = obj.children.every(
        (c) => (c as THREE.Mesh).isMesh && !(c as THREE.SkinnedMesh).isSkinnedMesh && c.children.length === 0,
      );
      if (allSkinned || allPlainMesh) groupsToMerge.push(obj);
    }
  });

  for (const grp of groupsToMerge) {
    const first = grp.children[0] as THREE.Mesh;
    const firstMat = Array.isArray(first.material) ? first.material[0] : first.material;
    if (firstMat && 'map' in firstMat && firstMat.map) continue;

    const geos: THREE.BufferGeometry[] = [];
    for (const child of grp.children) {
      const m = child as THREE.Mesh;
      m.updateMatrix();
      const useMat = (m as THREE.SkinnedMesh).isSkinnedMesh ? undefined : m.matrix;
      geos.push(bakeMeshColorGeo(m, undefined, useMat));
    }
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();

    let replacement: THREE.Mesh;
    if ((first as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = first as THREE.SkinnedMesh;
      const mergedSkinned = new THREE.SkinnedMesh(merged, sm.material);
      mergedSkinned.name = grp.name || sm.name;
      mergedSkinned.bind(sm.skeleton, sm.bindMatrix);
      mergedSkinned.frustumCulled = false;
      replacement = mergedSkinned;
    } else {
      replacement = new THREE.Mesh(merged, first.material);
      replacement.name = grp.name || first.name;
    }
    buildOutlineGeometry(merged);

    if (grp.parent) {
      replacement.position.copy(grp.position);
      replacement.quaternion.copy(grp.quaternion);
      replacement.scale.copy(grp.scale);
      const parent = grp.parent;
      parent.remove(grp);
      parent.add(replacement);
    }
  }

  // Second pass: handle standalone single-primitive Meshes / SkinnedMeshes (e.g. ShoulderPads or textured Stan Mech)
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (mat && 'map' in mat && mat.map instanceof THREE.Texture) {
      textured = true;
      foundTex = mat.map;
      foundTex.colorSpace = THREE.SRGBColorSpace;
      buildOutlineGeometry(mesh.geometry);
    } else if (!mesh.geometry.attributes.color) {
      const baked = bakeMeshColorGeo(mesh);
      baked.computeBoundingBox();
      baked.computeBoundingSphere();
      mesh.geometry = baked;
      buildOutlineGeometry(baked);
    }
  });

  return { textured, texture: foundTex };
}

function buildTemplate(
  gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] },
  opts: {
    targetHeight: number;
    facingYaw: number;
    refRadius?: number;
    stripWeapons?: boolean;
    hoverOffset?: number;
  },
): ActorTemplate {
  const { textured, texture } = optimizeTemplateScene(gltf.scene, opts.stripWeapons ?? false);

  const clips = new Map<string, THREE.AnimationClip>();
  for (const clip of gltf.animations) {
    clips.set(clip.name, clip);
  }

  // Sample primary idle/locomotion pose at t=0 to measure accurate posed height & ground minY
  const probe = SkeletonUtils.clone(gltf.scene);
  if (gltf.animations.length > 0) {
    const m = new THREE.AnimationMixer(probe);
    const primary =
      clips.get('Run_Shoot') ??
      clips.get('Run') ??
      clips.get('Walk') ??
      clips.get('Fast_Flying') ??
      gltf.animations[0]!;
    m.clipAction(primary).play();
    m.update(0);
  }
  probe.updateMatrixWorld(true);

  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  probe.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.attributes.position;
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 400));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i);
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        (mesh as THREE.SkinnedMesh).applyBoneTransform(i, v);
      }
      v.applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(v);
    }
  });

  const rawHeight = Math.max(0.2, box.max.y - box.min.y);
  const baseScale = opts.targetHeight / rawHeight;
  const groundYOffset = -box.min.y + (opts.hoverOffset ?? 0) / baseScale;

  return {
    scene: gltf.scene,
    clips,
    baseScale,
    groundYOffset,
    facingYaw: opts.facingYaw,
    refRadius: opts.refRadius ?? 0.5,
    textured,
    texture,
  };
}

export interface SpawnActorOptions {
  rimColor?: number;
  rimStrength?: number;
  outlineWidth?: number;
  weapons?: Record<WeaponId, WeaponMeshDef>;
  initialWeapon?: WeaponId;
}

/**
 * Clones a rigged ActorTemplate with a shared-shader Toon material and single-skeleton
 * inverted-hull cartoon outline meshes.
 */
export function spawnActor(template: ActorTemplate, opts: SpawnActorOptions = {}): AnimatedActor {
  const cloned = SkeletonUtils.clone(template.scene);
  const toonMat = createToonCharMaterial({
    rimColor: opts.rimColor ?? 0xaeeeff,
    rimStrength: opts.rimStrength ?? 0.38,
    vertexColors: !template.textured,
    map: template.texture,
  });
  const outlineMat = getOutlineMaterial(opts.outlineWidth ?? 0.0052);

  const meshes: THREE.Mesh[] = [];
  cloned.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });

  for (const mesh of meshes) {
    const srcOutlineGeo = buildOutlineGeometry(mesh.geometry);
    mesh.material = toonMat;

    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = mesh as THREE.SkinnedMesh;
      sm.frustumCulled = false;
      const outline = new THREE.SkinnedMesh(srcOutlineGeo, outlineMat);
      outline.frustumCulled = false;
      // Share the exact same Skeleton instance so Three.js updates bone matrices ONLY ONCE!
      outline.bind(sm.skeleton, sm.bindMatrix);
      sm.parent?.add(outline);
    } else {
      const outline = new THREE.Mesh(srcOutlineGeo, outlineMat);
      outline.position.copy(mesh.position);
      outline.quaternion.copy(mesh.quaternion);
      outline.scale.copy(mesh.scale);
      mesh.parent?.add(outline);
    }
  }

  const actor = new AnimatedActor(
    cloned,
    template.clips,
    toonMat,
    template.baseScale,
    template.groundYOffset,
    template.facingYaw,
  );

  if (opts.weapons) {
    const hand = cloned.getObjectByName('Index1R') ?? cloned.getObjectByName('Index1.R');
    if (hand) {
      const wId = opts.initialWeapon ?? 'pulse';
      const def = opts.weapons[wId];
      const wMesh = new THREE.Mesh(def.geo, toonMat);
      const wOut = new THREE.Mesh(def.outlineGeo, outlineMat);
      hand.add(wMesh, wOut);
      actor.weaponMesh = wMesh;
      actor.weaponOutline = wOut;
    }
  }

  return actor;
}

let cachedPromise: Promise<GltfLibrary> | null = null;

export function loadGltfLibrary(baseUrl = import.meta.env.BASE_URL ?? '/'): Promise<GltfLibrary> {
  if (cachedPromise) return cachedPromise;
  const prefix = baseUrl.endsWith('/') ? `${baseUrl}models/` : `${baseUrl}/models/`;
  const loader = new GLTFLoader();
  const load = (file: string) =>
    new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
      loader.load(
        `${prefix}${file}`,
        (g) => resolve({ scene: g.scene, animations: g.animations }),
        undefined,
        reject,
      );
    });

  cachedPromise = (async () => {
    const [
      trooperGltf,
      heavyGltf,
      mechGltf,
      crawlerGltf,
      dasherGltf,
      bastionGltf,
      mitosisGltf,
      siphonGltf,
      wardenGltf,
      hydraAGltf,
      hydraBGltf,
      omegaGltf,
    ] = await Promise.all([
      load('hero_trooper.glb'),
      load('hero_heavy.glb'),
      load('hero_mech.glb'),
      load('enemy_crawler.glb'),
      load('enemy_dasher.glb'),
      load('enemy_bastion.glb'),
      load('enemy_mitosis.glb'),
      load('enemy_siphon.glb'),
      load('boss_warden.glb'),
      load('boss_hydra_a.glb'),
      load('boss_hydra_b.glb'),
      load('boss_omega.glb'),
    ]);

    const { weapons, vaultRewards } = extractHeroWeapons(trooperGltf.scene);

    const trooper = buildTemplate(trooperGltf, {
      targetHeight: 1.38,
      facingYaw: Math.PI,
      stripWeapons: true,
    });
    const heavy = buildTemplate(heavyGltf, {
      targetHeight: 1.72,
      facingYaw: Math.PI,
      stripWeapons: true,
    });
    const mech = buildTemplate(mechGltf, {
      targetHeight: 2.42,
      facingYaw: Math.PI,
    });

    const enemies: Record<EnemyKind, ActorTemplate> = {
      crawler: buildTemplate(crawlerGltf, { targetHeight: 1.28, facingYaw: 0, refRadius: 0.48 }),
      dasher: buildTemplate(dasherGltf, { targetHeight: 1.72, facingYaw: 0, refRadius: 0.58 }),
      bastion: buildTemplate(bastionGltf, { targetHeight: 2.75, facingYaw: 0, refRadius: 1.15 }),
      mitosis: buildTemplate(mitosisGltf, { targetHeight: 1.78, facingYaw: 0, refRadius: 0.72 }),
      siphon: buildTemplate(siphonGltf, {
        targetHeight: 2.05,
        facingYaw: 0,
        refRadius: 0.68,
        hoverOffset: 0.35,
      }),
    };

    const bosses = {
      warden: buildTemplate(wardenGltf, { targetHeight: 4.35, facingYaw: 0, hoverOffset: 0.55 }),
      hydraA: buildTemplate(hydraAGltf, { targetHeight: 4.45, facingYaw: 0, hoverOffset: 0.65 }),
      hydraB: buildTemplate(hydraBGltf, { targetHeight: 3.45, facingYaw: 0, hoverOffset: 0.75 }),
      omega: buildTemplate(omegaGltf, { targetHeight: 5.15, facingYaw: 0 }),
    };

    return {
      heroes: [trooper, heavy, mech],
      enemies,
      bosses,
      weapons,
      vaultRewards,
    };
  })();

  return cachedPromise;
}
