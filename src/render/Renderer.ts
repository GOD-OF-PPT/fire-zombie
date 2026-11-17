import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type {
  BarrelSnapshot,
  BossSnapshot,
  EnemyKind,
  GateSnapshot,
  PrismLensSnapshot,
  RewardId,
  SectorId,
  SimSnapshot,
  VaultSnapshot,
  WeaponId,
} from '../types/game';
import { BLADES_ORBIT_RADIUS, GOLDEN_ANGLE_RAD, PLAYER_Z, TRACK_HALF_WIDTH } from '../config/constants';
import { SECTORS } from '../config/sectors';
import { REWARD_META, SECTOR_META } from '../app/meta';
import { Effects } from './Effects';
import { EnvironmentDetail } from './environmentDetail';
import { Infrastructure } from './infrastructure';
import {
  COLORS,
  gateColors,
  gateTextureKey,
  makeCanvasTexture,
  makeGlowTexture,
  makeHexCommandTexture,
  makeSkyTexture,
  makeStripeTexture,
  paintGatePlate,
  paintLensPlate,
  paintVaultPlate,
} from './textures';
import { makeCharacterMaterial } from './models/rig';
import { buildBladeGeo, buildBoltGeo, buildRewardDisplayGeo } from './models/soldiers';
import { GeoBuilder, box, cyl, oct, sph, tor } from './models/kit';
import {
  AnimatedActor,
  loadGltfLibrary,
  spawnActor,
  type GltfLibrary,
} from './models/gltfLibrary';
import { buildProceduralLibrary } from './models/proceduralLibrary';
import { createToonCharMaterial, getOutlineMaterial } from './models/toon';
import { loadTrialVault } from './models/trialVault';

export const WEAPON_COLOR: Record<WeaponId, number> = {
  pulse: 0x3ef3ff,
  scatter: 0x7dff6b,
  rail: 0xc29bff,
  plasma: 0xff9a3c,
  cryo: 0x9fe6ff,
};

const TRACK_LEN = 150;
const TRACK_CENTER_Z = -60;
/** Max rendered squad actors so every chibi trooper & weapon stays distinct (never a mushy overlap blob) */
const MAX_RENDER_SQUAD = 20;
const SQUAD_POOL_SIZES: [number, number, number] = [20, 14, 5];
const MAX_PROJ = 900;
const MAX_SHADOWS = 320;

const ENEMY_POOL_SIZE: Record<EnemyKind, number> = {
  crawler: 34,
  dasher: 18,
  bastion: 12,
  mitosis: 18,
  siphon: 12,
};

const ENEMY_BAR_H: Record<EnemyKind, number> = {
  crawler: 1.42,
  dasher: 1.88,
  bastion: 2.95,
  mitosis: 1.92,
  siphon: 2.45,
};

/** A stalled model download falls back to procedural actors instead of leaving the run empty */
const GLTF_LOAD_TIMEOUT_MS = 30000;

export type ActorModelSource = 'loading' | 'gltf' | 'procedural' | 'failed';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const CAM_BASE_Y = 10.6;
const CAM_BASE_Z = 16.0;
const CAM_DIST_TO_PLAYER = Math.hypot(CAM_BASE_Y, CAM_BASE_Z - PLAYER_Z);

interface GateView {
  id: number;
  group: THREE.Group;
  postMat: THREE.MeshStandardMaterial;
  curtainMat: THREE.MeshBasicMaterial;
  beam: THREE.Mesh;
  postL: THREE.Mesh;
  postR: THREE.Mesh;
  curtain: THREE.Mesh;
  plate: THREE.Mesh;
  plateMat: THREE.MeshBasicMaterial;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  key: string;
  seen: boolean;
  fade: number;
}

interface VaultView {
  id: number;
  group: THREE.Group;
  crystal: THREE.Mesh;
  crystalMat: THREE.MeshStandardMaterial;
  coreGroup: THREE.Group;
  core: THREE.Mesh;
  coreOutline: THREE.Mesh;
  coreMat: THREE.Material;
  frame: THREE.Object3D;
  ringMat: THREE.MeshBasicMaterial;
  reward: string;
  plate: THREE.Mesh;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  key: string;
  seen: boolean;
}

interface BarrelView {
  id: number;
  group: THREE.Group;
  body: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  light: THREE.Mesh;
  lightMat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  seen: boolean;
}

interface LensView {
  id: number;
  group: THREE.Group;
  paneMat: THREE.MeshBasicMaterial;
  seen: boolean;
}

interface HazardView {
  group: THREE.Group;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  progress: THREE.Mesh;
  progressMat: THREE.MeshBasicMaterial;
  column: THREE.Mesh;
  columnMat: THREE.MeshBasicMaterial;
  edgeL: THREE.Mesh;
  edgeR: THREE.Mesh;
}

interface SquadSlotState {
  x: number;
  z: number;
  s: number;
  alive: boolean;
  vx: number;
  tier: 1 | 2 | 3;
  actor: AnimatedActor | null;
}

interface ActiveEnemyEntry {
  kind: EnemyKind;
  actor: AnimatedActor;
  x: number;
  z: number;
  scale: number;
  seen: boolean;
}

interface DyingEnemyEntry {
  kind: EnemyKind;
  actor: AnimatedActor;
  x: number;
  z: number;
  scale: number;
  age: number;
  duration: number;
}

interface BossActorView {
  root: THREE.Group;
  primary: AnimatedActor;
  secondary?: AnimatedActor;
  secondaryRoot?: THREE.Group;
  halo?: THREE.Mesh;
  coreHeight: number;
  secondaryCoreHeight?: number;
  pylons?: THREE.Group[];
  beams?: THREE.Mesh[];
  shield: THREE.Mesh;
  shield2?: THREE.Mesh;
  attackCooldown: number;
}

function std(
  color: number,
  emissive = 0.5,
  opts: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: emissive,
    roughness: 0.35,
    metalness: 0.25,
    flatShading: true,
    ...opts,
  });
}

function additive(color: number, opacity: number, map?: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    // Additive glow is order-independent; without this three.js draws transparent DoubleSide meshes twice
    // (back then front) and redoes the program lookup for each half.
    forceSinglePass: true,
    map: map ?? null,
    toneMapped: false,
  });
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 9 / 16, 0.5, 220);
  readonly effects = new Effects();
  readonly assetsReady: Promise<void>;

  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private width = 1;
  private height = 1;
  private sector: SectorId = 1;
  private time = 0;

  // GLTF asset library & actor pools
  private gltfLib: GltfLibrary | null = null;
  private actorModelSource: ActorModelSource = 'loading';
  private squadPools: [AnimatedActor[], AnimatedActor[], AnimatedActor[]] = [[], [], []];
  private squadSlots: SquadSlotState[] = [];
  private currentWeapon: WeaponId = 'pulse';

  private enemyPools: Record<EnemyKind, AnimatedActor[]> = {
    crawler: [],
    dasher: [],
    bastion: [],
    mitosis: [],
    siphon: [],
  };
  private activeEnemies = new Map<number, ActiveEnemyEntry>();
  private dyingEnemies: DyingEnemyEntry[] = [];
  private bossViews = new Map<BossSnapshot['id'], BossActorView>();
  private bossDeathT = -1;
  private bossHidden = false;

  // environment
  private trackMat!: THREE.ShaderMaterial;
  private groundMat!: THREE.ShaderMaterial;
  private railMat!: THREE.MeshBasicMaterial;
  private towers!: THREE.InstancedMesh;
  private towerCaps!: THREE.InstancedMesh;
  private towerCapMat!: THREE.MeshBasicMaterial;
  private towerData: Array<{ x: number; z: number; w: number; d: number; h: number }> = [];
  private environmentDetail!: EnvironmentDetail;
  private infrastructure!: Infrastructure;
  private skyTextures = new Map<SectorId, THREE.Texture>();
  private posts!: THREE.InstancedMesh;
  private postMat!: THREE.MeshBasicMaterial;
  private hemi!: THREE.HemisphereLight;

  // squad & shared VFX meshes
  private squadGlow!: THREE.Mesh;
  private squadGlowMat!: THREE.MeshBasicMaterial;
  private squadRing!: THREE.Mesh;
  private squadRingMat!: THREE.MeshBasicMaterial;
  private aegisGroup!: THREE.Group;
  private aegisWire!: THREE.Mesh;
  private aegisWireMat!: THREE.MeshBasicMaterial;
  private aegisShellMat!: THREE.MeshBasicMaterial;
  private blades!: THREE.InstancedMesh;
  private flashes!: THREE.InstancedMesh;
  private flashMat!: THREE.MeshBasicMaterial;
  private muzzleFlash = 0;
  private shadows!: THREE.InstancedMesh;
  private shadowCount = 0;

  // HUD / telegraph / projectile instanced meshes
  private hpBg!: THREE.InstancedMesh;
  private hpFg!: THREE.InstancedMesh;
  private telegraphs!: THREE.InstancedMesh;
  private tethers: THREE.Mesh[] = [];
  private projMesh!: THREE.InstancedMesh;
  private orbMesh!: THREE.InstancedMesh;
  private orbMarks!: THREE.InstancedMesh;
  private gateViews = new Map<number, GateView>();
  private gatePool: GateView[] = [];
  private vaultViews = new Map<number, VaultView>();
  private vaultPool: VaultView[] = [];
  private barrelViews = new Map<number, BarrelView>();
  private barrelPool: BarrelView[] = [];
  private lensViews = new Map<number, LensView>();
  private lensPool: LensView[] = [];
  private hazardViews: HazardView[] = [];

  // shared props
  private glowTex = makeGlowTexture();
  private hexTex = makeHexCommandTexture();
  private readonly forceProcedural: boolean;
  private stripeTex = makeStripeTexture();
  private propMat = makeCharacterMaterial(0xbfe8ff, 0.35, 1.6);
  private vaultToonMat = createToonCharMaterial({ rimColor: 0xffffff, rimStrength: 0.55 });
  private fallbackRewardGeos = new Map<string, THREE.BufferGeometry>();
  private vaultFrameGeo!: THREE.BufferGeometry;
  private trialVault: THREE.Group | null = null;
  private trialPropSource: 'off' | 'loading' | 'tripo' | 'fallback' = 'off';
  private barrelGeo!: THREE.BufferGeometry;
  private towerMat!: THREE.ShaderMaterial;
  private lensTex: THREE.CanvasTexture;
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private tmpV = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  // camera
  private camX = 0;
  private trauma = 0;
  private bossBlend = 0;
  private fov = 58;

  constructor(canvas: HTMLCanvasElement, opts: { forceProcedural?: boolean; trialArt?: boolean } = {}) {
    this.forceProcedural = opts.forceProcedural === true;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(this.effects.group);

    const lensC = makeCanvasTexture(384, 112);
    paintLensPlate(lensC.ctx, 384, 112);
    lensC.tex.needsUpdate = true;
    this.lensTex = lensC.tex;

    this.buildLights();
    this.buildEnvironment();
    this.buildSquadShell();
    this.buildEnemyShell();
    this.buildProjectiles();
    this.buildHazards();
    this.initPostProcessing();
    this.setSector(1);

    const actorsReady = this.loadActorModels().catch((err: unknown) => {
      this.actorModelSource = 'failed';
      console.error('Failed building actor models:', err);
    });
    this.assetsReady = Promise.all([actorsReady, opts.trialArt ? this.loadTrialProps() : Promise.resolve()]).then(() => undefined);
  }

  get propSource(): 'off' | 'loading' | 'tripo' | 'fallback' {
    return this.trialPropSource;
  }

  private async loadTrialProps(): Promise<void> {
    this.trialPropSource = 'loading';
    try {
      this.trialVault = await withTimeout(loadTrialVault(), 12000, 'Tripo trial prop');
      this.trialPropSource = 'tripo';
      for (const view of [...this.vaultViews.values(), ...this.vaultPool]) this.installTrialCasing(view);
    } catch (err) {
      this.trialPropSource = 'fallback';
      console.warn('Tripo trial prop unavailable; retaining the original vault casing.', err);
    }
  }

  private installTrialCasing(view: VaultView): void {
    if (!this.trialVault || view.frame.userData.tripoTrial) return;
    view.frame.removeFromParent();
    view.frame = this.trialVault.clone(true);
    view.group.add(view.frame);
    view.crystal.visible = false;
  }

  /** Which actor models are in use; 'procedural' means the GLB models could not be loaded. */
  get modelSource(): ActorModelSource {
    return this.actorModelSource;
  }

  private async loadActorModels(): Promise<void> {
    let lib: GltfLibrary | null = null;
    if (!this.forceProcedural) {
      try {
        lib = await withTimeout(loadGltfLibrary(), GLTF_LOAD_TIMEOUT_MS, 'GLB model load');
      } catch (err) {
        console.error('GLB models unavailable, using procedural fallback models:', err);
      }
    }
    const source = lib ? 'gltf' : 'procedural';
    lib ??= buildProceduralLibrary();
    this.initGltfPools(lib);
    this.gltfLib = lib;
    this.actorModelSource = source;
  }

  private initPostProcessing(): void {
    try {
      const composer = new EffectComposer(this.renderer);
      const renderPass = new RenderPass(this.scene, this.camera);
      // High threshold (0.93) keeps cartoon outlines, character faces, and gate numbers razor-sharp
      // while giving HDR projectiles, muzzle flashes, and explosions a crisp neon bloom!
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.28, 0.35, 0.93);
      const outputPass = new OutputPass();
      composer.addPass(renderPass);
      composer.addPass(bloomPass);
      composer.addPass(outputPass);
      this.composer = composer;
      this.bloomPass = bloomPass;
    } catch {
      this.composer = null;
      this.bloomPass = null;
    }
  }

  private initGltfPools(lib: GltfLibrary): void {
    // 1. Pre-warm hero squad pools (Tier 1 trooper, Tier 2 gold heavy, Tier 3 assault mech)
    const heroRims: [number, number, number] = [0x9beeff, 0xffe484, 0x8ff6ff];
    const heroOutlines: [number, number, number] = [0.0027, 0.003, 0.0032];
    for (let tierIdx = 0; tierIdx < 3; tierIdx++) {
      const count = SQUAD_POOL_SIZES[tierIdx]!;
      const tmpl = lib.heroes[tierIdx]!;
      for (let i = 0; i < count; i++) {
        const actor = spawnActor(tmpl, {
          rimColor: heroRims[tierIdx],
          rimStrength: 0.24,
          outlineWidth: heroOutlines[tierIdx],
          weapons: tierIdx < 2 ? lib.weapons : undefined,
          initialWeapon: this.currentWeapon,
        });
        actor.root.visible = false;
        this.scene.add(actor.root);
        this.squadPools[tierIdx]!.push(actor);
      }
    }

    // 2. Pre-warm monster pools per archetype
    const enemyRims: Record<EnemyKind, number> = {
      crawler: 0xff9eb2,
      dasher: 0xffcf70,
      bastion: 0xff8598,
      mitosis: 0xffb3f0,
      siphon: 0xd4a6ff,
    };
    for (const kind of Object.keys(ENEMY_POOL_SIZE) as EnemyKind[]) {
      const count = ENEMY_POOL_SIZE[kind];
      const tmpl = lib.enemies[kind];
      for (let i = 0; i < count; i++) {
        const actor = spawnActor(tmpl, {
          rimColor: enemyRims[kind],
          rimStrength: 0.28,
          outlineWidth: kind === 'bastion' ? 0.0035 : 0.003,
        });
        actor.root.visible = false;
        this.scene.add(actor.root);
        this.enemyPools[kind].push(actor);
      }
    }

    // 3. Build the 3 sculpted CC0 sector bosses
    this.buildGltfBosses(lib);

    // 4. Refresh any active Reward Vaults to show the 3D Toon weapon + outline
    for (const v of this.vaultViews.values()) {
      v.reward = '';
    }
  }

  private buildGltfBosses(lib: GltfLibrary): void {
    // Sector 1: WARDEN-01《赤焰魔像王》
    {
      const root = new THREE.Group();
      const primary = spawnActor(lib.bosses.warden, {
        rimColor: 0xffb36b,
        rimStrength: 0.5,
        outlineWidth: 0.0062,
      });
      primary.play('Fast_Flying', { timeScale: 0.95 });
      const shield = this.makeShield(3.2);
      shield.position.y = 2.6;
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(2.1, 2.55, 36).rotateX(-Math.PI / 2),
        additive(0xff5238, 0.45),
      );
      halo.position.y = 0.06;
      root.add(primary.root, shield, halo);
      root.visible = false;
      this.scene.add(root);
      this.bossViews.set('warden_01', {
        root,
        primary,
        halo,
        coreHeight: 2.65,
        shield,
        attackCooldown: 0,
      });
    }

    // Sector 2: HYDRA-02《双生魔龙》
    {
      const root = new THREE.Group();
      const primary = spawnActor(lib.bosses.hydraA, {
        rimColor: 0xff94ec,
        rimStrength: 0.5,
        outlineWidth: 0.006,
      });
      primary.play('Fast_Flying', { timeScale: 1.0 });
      const shield = this.makeShield(2.8);
      shield.position.y = 2.7;
      root.add(primary.root, shield);
      root.visible = false;

      const secondaryRoot = new THREE.Group();
      const secondary = spawnActor(lib.bosses.hydraB, {
        rimColor: 0x8ff6ff,
        rimStrength: 0.5,
        outlineWidth: 0.0058,
      });
      secondary.play('Fast_Flying', { timeScale: 1.1, startOffset: 0.4 });
      const shield2 = this.makeShield(2.35);
      shield2.position.y = 2.3;
      secondaryRoot.add(secondary.root, shield2);
      secondaryRoot.visible = false;

      this.scene.add(root, secondaryRoot);
      this.bossViews.set('hydra_02', {
        root,
        primary,
        secondary,
        secondaryRoot,
        coreHeight: 2.7,
        secondaryCoreHeight: 2.3,
        shield,
        shield2,
        attackCooldown: 0,
      });
    }

    // Sector 3: OMEGA-ZERO《深渊魔王》 + Singularity Halo + 2 Crystal Shield Pylons
    {
      const root = new THREE.Group();
      const primary = spawnActor(lib.bosses.omega, {
        rimColor: 0xffd86b,
        rimStrength: 0.55,
        outlineWidth: 0.0064,
      });
      primary.play('Idle', { timeScale: 1.0 });

      // Cosmic singularity halo floating behind the Demon Overlord's wings
      const haloGeo = new GeoBuilder()
        .add(tor(2.35, 0.085, 6, 36), 0xffc531, 0.48)
        .add(tor(1.85, 0.055, 5, 28), 0xff3b6b, 0.45)
        .build();
      const halo = new THREE.Mesh(haloGeo, this.propMat);
      halo.position.set(0, 3.1, -1.05);

      const shield = this.makeShield(3.45);
      shield.position.y = 2.75;
      root.add(halo, primary.root, shield);
      root.visible = false;
      this.scene.add(root);

      const crystalGeo = new GeoBuilder()
        .add(new THREE.OctahedronGeometry(0.85, 0), 0x3fa8c8, 0.5, { s: [1, 2.1, 1] })
        .add(new THREE.OctahedronGeometry(0.3, 0), 0xffffff, 1.8, { s: [1, 2.1, 1], p: [0, 0, 0.52] })
        .add(tor(1.05, 0.06, 4, 20), 0x8ff6ff, 2.2, { r: [Math.PI / 2, 0, 0], p: [0, -0.55, 0] })
        .build();
      const footGeo = new GeoBuilder()
        .add(cyl(0.88, 1.2, 0.42, 6), 0x1c0f24, 0, { p: [0, 0.21, 0] })
        .add(cyl(0.68, 0.88, 0.2, 6), 0x2c1236, 0, { p: [0, 0.52, 0] })
        .add(tor(0.96, 0.05, 4, 6), 0x8ff6ff, 2.0, { r: [Math.PI / 2, 0, 0], p: [0, 0.44, 0] })
        .build();

      const pylons: THREE.Group[] = [];
      const beams: THREE.Mesh[] = [];
      for (let i = 0; i < 2; i++) {
        const p = new THREE.Group();
        const crystal = new THREE.Mesh(crystalGeo, this.propMat);
        crystal.position.y = 2.05;
        const foot = new THREE.Mesh(footGeo, this.propMat);
        p.add(crystal, foot);
        p.visible = false;
        pylons.push(p);
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.08, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2),
          additive(0x8ff6ff, 0.8),
        );
        beam.visible = false;
        beams.push(beam);
        this.scene.add(p, beam);
      }

      this.bossViews.set('omega_zero', {
        root,
        primary,
        halo,
        pylons,
        beams,
        coreHeight: 2.85,
        shield,
        attackCooldown: 0,
      });
    }
  }

  // ------------------------------------------------------------------ scene setup
  private buildLights(): void {
    // Bright commercial cartoon lighting so cel bands & silhouettes pop cleanly
    this.hemi = new THREE.HemisphereLight(0xdcf0ff, 0x3b2c6e, 0.9);
    this.scene.add(this.hemi);
    const dir = new THREE.DirectionalLight(0xffe7ce, 2.2);
    dir.position.set(-8, 14, 4);
    this.scene.add(dir);
    const back = new THREE.DirectionalLight(0x9be8ff, 0.85);
    back.position.set(-4, 8, -14);
    this.scene.add(back);
  }

  private buildEnvironment(): void {
    // Stylized luminous bridge deck so dark cartoon outlines & blob shadows read crisply
    this.trackMat = new THREE.ShaderMaterial({
      uniforms: {
        uScroll: { value: 0 },
        uTime: { value: 0 },
        uTrack: { value: new THREE.Color(0x1c3468) },
        uGrid: { value: new THREE.Color(0x3f8cff) },
        uEdge: { value: new THREE.Color(0x48f5ff) },
        uFog: { value: new THREE.Color(0x122a68) },
        uHalf: { value: TRACK_HALF_WIDTH },
        uOverdrive: { value: 0 },
        uBoss: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uScroll; uniform float uTime; uniform float uHalf; uniform float uOverdrive; uniform float uBoss;
        uniform vec3 uTrack; uniform vec3 uGrid; uniform vec3 uEdge; uniform vec3 uFog;
        varying vec3 vW;
        float line(float v, float w) { float f = abs(fract(v) - 0.5); return smoothstep(w, 0.0, 0.5 - f); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float zz = vW.z - uScroll;
          float ax = abs(vW.x);
          float plate = floor(zz / 8.0);
          float plateTone = 0.94 + hash(vec2(plate, floor(ax / 2.5))) * 0.1;
          float brushed = sin(vW.x * 160.0 + sin(zz * 0.3)) * 0.004;
          float centerSheen = pow(max(0.0, 1.0 - ax / uHalf), 2.0);
          vec3 c = uTrack * (plateTone * 0.72 + centerSheen * 0.24 + brushed);
          float px = abs(fract((vW.x + 5.5) / 2.75) - 0.5);
          float seam = smoothstep(0.48 - fwidth(px), 0.49, px);
          c *= 1.0 - seam * 0.3;
          // Soft specular pools from the lamps at the edge of the deck.
          float lampZ = abs(fract((zz + 1.5) / 8.0) - 0.5) * 8.0;
          float reflection = exp(-lampZ * lampZ * 0.3) * pow(ax / uHalf, 7.0);
          c += uEdge * reflection * 0.11;
          // Recessed 8m armour panels with a dark seam and a narrow lit bevel.
          float cross = line(zz / 8.0, 0.018);
          float bevel = line((zz + 0.11) / 8.0, 0.008);
          c *= 1.0 - cross * 0.28;
          c += uGrid * bevel * 0.16;
          float innerFrame = smoothstep(0.025, 0.0, abs(ax - (uHalf - 0.72)));
          c += uGrid * innerFrame * 0.16;
          // Tiny paired fasteners sell the deck as manufactured metal rather than a flat plane.
          float rz = min(fract(zz / 8.0), 1.0 - fract(zz / 8.0)) * 8.0;
          float rivet = smoothstep(0.14, 0.035, length(vec2(ax - (uHalf - 0.94), rz)));
          c += mix(uGrid, vec3(0.85), 0.55) * rivet * 0.38;
          float lanes = line((vW.x + uHalf) / (uHalf * 2.0 / 3.0), 0.012) * step(0.52, fract(zz / 5.0));
          c += uGrid * lanes * 0.24;
          // Forward speed chevrons remain at the outer lane, clear of combat readability.
          float chev = fract((zz + ax * 0.85) / 10.0);
          c += uEdge * smoothstep(0.026, 0.0, abs(chev - 0.5)) * smoothstep(uHalf, uHalf - 1.1, ax) * smoothstep(uHalf - 2.3, uHalf - 1.4, ax) * 0.3;
          // Pulsing neon data-conduit traces running along the lane dividers
          float lanePos = abs(fract((vW.x + uHalf) / (uHalf * 2.0 / 3.0)) - 0.5);
          float conduit = smoothstep(0.018, 0.003, lanePos);
          float packet = pow(max(0.0, sin((zz + uTime * 22.0) * 0.28)), 8.0);
          c += mix(uGrid, uEdge, 0.5) * conduit * (0.12 + packet * 0.28);
          // Overdrive golden hyper-warp streaks
          if (uOverdrive > 0.01) {
            float warp = pow(max(0.0, sin(vW.x * 14.0) * sin((zz + uTime * 48.0) * 0.35)), 6.0);
            c += vec3(1.0, 0.88, 0.35) * warp * uOverdrive * 0.32;
          }
          // Boss arena crimson perimeter hazard ticks
          if (uBoss > 0.01) {
            float bossBand = smoothstep(uHalf - 0.85, uHalf - 0.32, ax) * step(0.5, fract((zz - uTime * 6.0) / 2.4));
            c += vec3(1.0, 0.18, 0.32) * bossBand * uBoss * 0.26;
          }
          float scan = exp(-900.0 * pow(fract((zz + uTime * 4.0) / 32.0) - 0.5, 2.0));
          c += uEdge * scan * smoothstep(uHalf, 0.0, ax) * 0.065;
          float edge = smoothstep(uHalf - 0.32, uHalf, ax);
          c = mix(c, uEdge * 0.92, edge * 0.85);
          float fog = smoothstep(22.0, 96.0, -vW.z);
          c = mix(c, uFog, fog);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(TRACK_HALF_WIDTH * 2 + 0.2, TRACK_LEN),
      this.trackMat,
    );
    track.rotation.x = -Math.PI / 2;
    track.position.z = TRACK_CENTER_Z;
    this.scene.add(track);

    this.groundMat = new THREE.ShaderMaterial({
      uniforms: {
        uScroll: { value: 0 },
        uGrid: { value: new THREE.Color(0x3f8cff) },
        uFog: { value: new THREE.Color(0x122a68) },
        uBase: { value: new THREE.Color(0x060c22) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uScroll; uniform vec3 uGrid; uniform vec3 uFog; uniform vec3 uBase;
        varying vec3 vW;
        void main() {
          vec2 p = vec2(vW.x, vW.z - uScroll) / 3.5;
          vec2 g = abs(fract(p) - 0.5);
          float l = smoothstep(0.47, 0.5, max(g.x, g.y));
          vec3 c = uBase + uGrid * l * 0.16;
          float fog = smoothstep(12.0, 90.0, -vW.z + abs(vW.x) * 0.4);
          gl_FragColor = vec4(mix(c, uFog, fog), 1.0);
        }`,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, TRACK_LEN), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.6, TRACK_CENTER_Z);
    this.scene.add(ground);

    const wallMat = std(0x111d42, 0.08, { flatShading: false });
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.72, TRACK_LEN), wallMat);
      wall.position.set(s * (TRACK_HALF_WIDTH + 0.25), -0.25, TRACK_CENTER_Z);
      this.scene.add(wall);
    }
    this.railMat = new THREE.MeshBasicMaterial({ color: 0x48f5ff });
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.065, TRACK_LEN), this.railMat);
      rail.position.set(s * (TRACK_HALF_WIDTH + 0.25), 0.18, TRACK_CENTER_Z);
      this.scene.add(rail);
    }
    this.postMat = new THREE.MeshBasicMaterial({ color: 0x48f5ff });
    this.posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.72, 0.18), this.postMat, 64);
    this.scene.add(this.posts);

    // Stylized city skyline towers
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    towerGeo.translate(0, 0.5, 0);
    this.towerMat = new THREE.ShaderMaterial({
      uniforms: {
        uBase: { value: new THREE.Color(0x0f1e4a) },
        uWinA: { value: new THREE.Color(0x3ef3ff) },
        uWinB: { value: new THREE.Color(0xff5ce0) },
        uFog: { value: new THREE.Color(0x122a68) },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vL; varying vec3 vN; varying vec3 vW; varying float vSeed; varying float vH;
        void main() {
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vL = position * sc;
          vH = sc.y;
          vN = normal;
          vSeed = instanceMatrix[3].x * 7.31 + sc.x * 3.7;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uBase; uniform vec3 uWinA; uniform vec3 uWinB; uniform vec3 uFog; uniform float uTime;
        varying vec3 vL; varying vec3 vN; varying vec3 vW; varying float vSeed; varying float vH;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec3 n = abs(vN);
          vec3 c = uBase * (0.6 + 0.55 * clamp(vL.y / max(vH, 1.0), 0.0, 1.0));
          if (n.y < 0.5) {
            float u = (n.x > 0.5 ? vL.z : vL.x) / 0.6;
            float v = vL.y / 0.75;
            vec2 cell = floor(vec2(u, v));
            vec2 f = fract(vec2(u, v));
            vec2 aa = max(fwidth(vec2(u, v)), vec2(0.015));
            vec2 windowMask = smoothstep(vec2(0.18), vec2(0.18) + aa, f) * (1.0 - smoothstep(vec2(0.78) - aa, vec2(0.78), f));
            float win = windowMask.x * windowMask.y;
            // Quantize the instance seed before hashing: tiny interpolator errors otherwise
            // turn a constant window into sparkling pixel noise on mobile GPUs.
            float h = hash(cell + floor(vSeed + 0.5));
            float lit = step(0.58, h) * win * step(0.6, vL.y);
            vec3 wc = mix(uWinA, uWinB, step(0.86, h));
            c += wc * lit * (0.16 + 0.12 * sin(uTime * 0.18 + h * 40.0));
            c += uWinA * 0.09 * smoothstep(0.47, 0.5, abs(fract(u * 0.125) - 0.5));
            float floorLine = 1.0 - smoothstep(0.018, 0.035 + aa.y, min(f.y, 1.0 - f.y));
            c *= 1.0 - floorLine * 0.25;
          } else {
            c = uWinA * 0.22;
          }
          float fog = smoothstep(26.0, 108.0, -vW.z) * 0.88 + 0.12;
          gl_FragColor = vec4(mix(c, uFog, fog), 1.0);
        }`,
    });
    const n = 72;
    this.towers = new THREE.InstancedMesh(towerGeo, this.towerMat, n);
    this.towerCapMat = new THREE.MeshBasicMaterial({ color: 0x3f8cff });
    this.towerCaps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 1), this.towerCapMat, n);
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.towerData.push({
        x: side * (7.8 + rnd() * 16),
        z: rnd() * 130,
        w: 1.5 + rnd() * 3,
        d: 1.5 + rnd() * 3,
        h: 1.5 + rnd() * rnd() * 20,
      });
    }
    this.towers.frustumCulled = false;
    this.towerCaps.frustumCulled = false;
    this.scene.add(this.towers, this.towerCaps);
    this.environmentDetail = new EnvironmentDetail(this.towerData);
    this.infrastructure = new Infrastructure();
    this.scene.add(this.environmentDetail.group, this.infrastructure.group);
  }

  private buildSquadShell(): void {
    for (let i = 0; i < MAX_RENDER_SQUAD; i++) {
      this.squadSlots.push({
        x: 0,
        z: PLAYER_Z,
        s: 0,
        alive: false,
        vx: 0,
        tier: 1,
        actor: null,
      });
    }

    this.squadGlowMat = additive(0x3ef3ff, 0.35, this.glowTex);
    this.squadGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.squadGlowMat);
    this.squadGlow.rotation.x = -Math.PI / 2;
    this.squadGlow.position.y = 0.03;
    this.scene.add(this.squadGlow);

    this.squadRingMat = additive(0x3ef3ff, 0.52, this.hexTex);
    this.squadRing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.squadRingMat);
    this.squadRing.rotation.x = -Math.PI / 2;
    this.squadRing.position.y = 0.038;
    this.scene.add(this.squadRing);

    // 3D Geodesic Phase Aegis Force-Dome
    this.aegisGroup = new THREE.Group();
    this.aegisWireMat = new THREE.MeshBasicMaterial({
      color: 0x62f4ff,
      wireframe: true,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.aegisWire = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), this.aegisWireMat);
    this.aegisShellMat = additive(0x3ef3ff, 0.16);
    const aegisShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.98, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
      this.aegisShellMat,
    );
    this.aegisGroup.add(aegisShell, this.aegisWire);
    this.aegisGroup.visible = false;
    this.scene.add(this.aegisGroup);

    // Crisp contact shadows under every soldier & monster so characters sit solidly on the bridge deck
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x030614,
      map: this.glowTex,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    });
    this.shadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      shadowMat,
      MAX_SHADOWS,
    );
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.scene.add(this.shadows);

    this.blades = new THREE.InstancedMesh(buildBladeGeo(), this.propMat, 4);
    this.blades.count = 0;
    this.blades.frustumCulled = false;
    this.scene.add(this.blades);

    this.flashMat = additive(0xffffff, 0.95, this.glowTex);
    this.flashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.flashMat, MAX_RENDER_SQUAD);
    this.flashes.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_RENDER_SQUAD * 3),
      3,
    );
    this.flashes.count = 0;
    this.flashes.frustumCulled = false;
    this.flashes.renderOrder = 3;
    this.scene.add(this.flashes);
  }

  private buildEnemyShell(): void {
    const barGeo = new THREE.PlaneGeometry(1, 0.17);
    const fgGeo = new THREE.PlaneGeometry(1, 0.17).translate(0.5, 0, 0);
    this.hpBg = new THREE.InstancedMesh(
      barGeo,
      new THREE.MeshBasicMaterial({ color: 0x060814, transparent: true, opacity: 0.78, depthWrite: false }),
      64,
    );
    this.hpFg = new THREE.InstancedMesh(
      fgGeo,
      new THREE.MeshBasicMaterial({ color: 0xff3b5c, toneMapped: false, depthWrite: false }),
      64,
    );
    this.hpBg.renderOrder = 5;
    this.hpFg.renderOrder = 6;
    this.hpBg.frustumCulled = this.hpFg.frustumCulled = false;
    this.hpBg.count = this.hpFg.count = 0;
    this.scene.add(this.hpBg, this.hpFg);

    const telGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.telegraphs = new THREE.InstancedMesh(telGeo, additive(0xffffff, 0.6, this.stripeTex), 24);
    this.telegraphs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24 * 3), 3);
    this.telegraphs.count = 0;
    this.telegraphs.frustumCulled = false;
    this.scene.add(this.telegraphs);

    const tGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Mesh(tGeo, additive(0xb85cff, 0.88));
      t.visible = false;
      this.tethers.push(t);
      this.scene.add(t);
    }
  }

  private buildProjectiles(): void {
    const mat = new THREE.MeshBasicMaterial({
      toneMapped: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.projMesh = new THREE.InstancedMesh(buildBoltGeo(), mat, MAX_PROJ);
    this.projMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PROJ * 3), 3);
    this.projMesh.count = 0;
    this.projMesh.frustumCulled = false;
    this.scene.add(this.projMesh);

    this.orbMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.38, 1),
      new THREE.MeshBasicMaterial({ color: 0xff3864, toneMapped: false }),
      64,
    );
    this.orbMesh.count = 0;
    this.orbMesh.frustumCulled = false;
    this.orbMarks = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      additive(0xff2a55, 0.72, this.glowTex),
      64,
    );
    this.orbMarks.count = 0;
    this.orbMarks.frustumCulled = false;
    this.scene.add(this.orbMesh, this.orbMarks);
  }

  private buildHazards(): void {
    const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const group = new THREE.Group();
      const fillMat = additive(0xff2040, 0.2);
      const fill = new THREE.Mesh(flat, fillMat);
      const stripe = this.stripeTex.clone();
      stripe.needsUpdate = true;
      stripe.repeat.set(2, 10);
      const progressMat = additive(0xff2040, 0.58, stripe);
      const progress = new THREE.Mesh(flat, progressMat);
      const columnMat = additive(0xff2958, 0.0);
      columnMat.side = THREE.FrontSide;
      const column = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), columnMat);
      const edgeMat = additive(0xff4060, 0.92);
      const edgeL = new THREE.Mesh(flat, edgeMat);
      const edgeR = new THREE.Mesh(flat, edgeMat);
      fill.position.y = 0.05;
      progress.position.y = 0.07;
      edgeL.position.y = edgeR.position.y = 0.08;
      group.add(fill, progress, column, edgeL, edgeR);
      group.visible = false;
      this.scene.add(group);
      this.hazardViews.push({
        group,
        fill,
        fillMat,
        progress,
        progressMat,
        column,
        columnMat,
        edgeL,
        edgeR,
      });
    }
  }

  private makeShield(r: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x62f4ff,
      wireframe: true,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      toneMapped: false,
    });
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat);
    m.visible = false;
    return m;
  }

  // ------------------------------------------------------------------ public API
  setSector(sector: SectorId): void {
    this.sector = sector;
    const pal = SECTOR_META[sector].palette;
    let sky = this.skyTextures.get(sector);
    if (!sky) {
      sky = makeSkyTexture(pal.sky);
      this.skyTextures.set(sector, sky);
    }
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(pal.fog, 42, 118);
    (this.trackMat.uniforms.uTrack!.value as THREE.Color).set(pal.track);
    (this.trackMat.uniforms.uGrid!.value as THREE.Color).set(pal.grid);
    (this.trackMat.uniforms.uEdge!.value as THREE.Color).set(pal.edge);
    (this.trackMat.uniforms.uFog!.value as THREE.Color).set(pal.fog);
    (this.groundMat.uniforms.uGrid!.value as THREE.Color).set(pal.grid);
    (this.groundMat.uniforms.uFog!.value as THREE.Color).set(pal.fog);
    (this.towerMat.uniforms.uFog!.value as THREE.Color).set(pal.fog);
    (this.towerMat.uniforms.uBase!.value as THREE.Color).set(pal.track).multiplyScalar(0.55);
    (this.towerMat.uniforms.uWinA!.value as THREE.Color).set(pal.grid);
    (this.towerMat.uniforms.uWinB!.value as THREE.Color).set(pal.edge);
    (this.groundMat.uniforms.uBase!.value as THREE.Color).set(pal.fog).multiplyScalar(0.28);
    this.hemi.color.set(pal.edge).lerp(new THREE.Color(0xffffff), 0.76);
    this.hemi.groundColor.set(pal.fog).multiplyScalar(0.8);
    this.railMat.color.set(pal.edge);
    this.postMat.color.set(pal.edge);
    this.towerCapMat.color.set(pal.grid);
    this.environmentDetail.setPalette(pal);
  }

  /** Cycles all four art palettes as endless stages advance without changing the underlying sector id. */
  setEndlessWave(wave: number): void {
    const paletteSector = (Math.max(0, Math.floor(wave) - 1) % 4 + 1) as SectorId;
    this.setSector(paletteSector);
    this.sector = 4;
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    const pr = this.renderer.getPixelRatio();
    this.renderer.setSize(this.width, this.height, false);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(this.width, this.height);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(Math.max(1, Math.floor(this.width / 2)), Math.max(1, Math.floor(this.height / 2)));
    }
    const aspect = this.width / this.height;
    this.camera.aspect = aspect;
    // Keep ~12.7 world units of horizontal track visible at the squad's depth across aspect ratios
    const halfTan = 0.435 / aspect;
    this.fov = THREE.MathUtils.clamp((2 * Math.atan(halfTan) * 180) / Math.PI, 40, 72);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.effects.setViewportScale(this.height * pr, this.fov);
  }

  /** Visible world width at the squad depth, for 1:1 drag→world mapping */
  visibleWidthAtPlayer(): number {
    return 2 * CAM_DIST_TO_PLAYER * Math.tan((this.fov * Math.PI) / 360) * this.camera.aspect;
  }

  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    this.tmpV.set(x, y, z).project(this.camera);
    return {
      x: (this.tmpV.x * 0.5 + 0.5) * this.width,
      y: (-this.tmpV.y * 0.5 + 0.5) * this.height,
      visible: this.tmpV.z < 1,
    };
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  flashMuzzle(): void {
    this.muzzleFlash = 1;
  }

  private releaseSquadSlot(slot: SquadSlotState): void {
    if (slot.actor) {
      slot.actor.root.visible = false;
      this.squadPools[slot.tier - 1]!.push(slot.actor);
      slot.actor = null;
    }
    slot.alive = false;
    slot.s = 0;
  }

  resetRun(): void {
    this.effects.clear();
    this.bossDeathT = -1;
    this.bossHidden = false;
    this.trauma = 0;

    for (const slot of this.squadSlots) {
      this.releaseSquadSlot(slot);
    }
    for (const entry of this.activeEnemies.values()) {
      entry.actor.root.visible = false;
      this.enemyPools[entry.kind].push(entry.actor);
    }
    this.activeEnemies.clear();

    for (const dying of this.dyingEnemies) {
      dying.actor.root.visible = false;
      this.enemyPools[dying.kind].push(dying.actor);
    }
    this.dyingEnemies.length = 0;

    for (const view of this.bossViews.values()) {
      view.root.visible = false;
      if (view.secondaryRoot) view.secondaryRoot.visible = false;
      view.pylons?.forEach((p) => (p.visible = false));
      view.beams?.forEach((p) => (p.visible = false));
      view.attackCooldown = 0;
    }

    for (const v of this.gateViews.values()) this.releaseGate(v);
    this.gateViews.clear();
    for (const v of this.vaultViews.values()) this.releaseVault(v);
    this.vaultViews.clear();
    for (const v of this.barrelViews.values()) this.releaseBarrel(v);
    this.barrelViews.clear();
    for (const v of this.lensViews.values()) this.releaseLens(v);
    this.lensViews.clear();
  }

  beginBoss(): void {
    this.bossHidden = false;
    this.bossDeathT = -1;
    for (const view of this.bossViews.values()) {
      view.attackCooldown = 0;
      view.primary.resetAnimation();
      view.secondary?.resetAnimation();
    }
  }

  startBossDeath(x: number, z: number, color: number): void {
    this.bossDeathT = 0;
    this.bossHidden = false;
    for (const view of this.bossViews.values()) {
      if (view.root.visible) {
        view.primary.play('Death', { loop: false, fade: 0.08, timeScale: 0.85 });
        view.secondary?.play('Death', { loop: false, fade: 0.08, timeScale: 0.85 });
      }
    }
    const fx = this.effects;
    for (let i = 0; i < 7; i++) {
      fx.after(i * 0.16, () => {
        const ox = (Math.random() - 0.5) * 4;
        const oz = (Math.random() - 0.5) * 2;
        fx.burst(x + ox, 2 + Math.random() * 2, z + oz, i % 2 ? 0xffffff : color, 40, {
          speed: 9,
          size: 0.6,
          life: 0.7,
        });
        fx.ring(x + ox, z + oz, color, 3.5, 0.4);
        this.shake(0.25);
      });
    }
    fx.after(1.25, () => {
      this.bossHidden = true;
      fx.burst(x, 2.4, z, 0xffffff, 240, { speed: 22, size: 0.9, life: 1.3, up: 0.8, gravity: 6 });
      fx.burst(x, 2.4, z, color, 240, { speed: 15, size: 0.8, life: 1.6, up: 0.9, gravity: 4 });
      fx.ring(x, z, 0xffffff, 16, 0.9);
      fx.ring(x, z, color, 11, 1.2);
      this.shake(1);
    });
  }

  // ------------------------------------------------------------------ per-frame
  render(snap: SimSnapshot, dt: number, cinematic = false): void {
    this.time += dt;
    const t = this.time;
    const sectorCfg = SECTORS[snap.sector];
    const scroll = snap.endless?.distance ?? snap.runwayProgress * sectorCfg.runwayLength;
    this.trackMat.uniforms.uScroll!.value = scroll;
    this.trackMat.uniforms.uTime!.value = t;
    this.trackMat.uniforms.uOverdrive!.value = snap.overdriveTimer > 0 ? Math.min(1, snap.overdriveTimer * 2) : 0;
    this.trackMat.uniforms.uBoss!.value = this.bossBlend;
    this.groundMat.uniforms.uScroll!.value = scroll;
    this.towerMat.uniforms.uTime!.value = t;

    this.shadowCount = 0;
    this.updateEnvironment(scroll, t);
    this.updateSquad(snap, dt, t);
    this.updateEnemies(snap, dt, t);
    this.updateProjectiles(snap);
    this.updateGates(snap, dt, t);
    this.updateVaults(snap, t);
    this.updateBarrels(snap, t);
    this.updateLenses(snap, t);
    this.updateBoss(snap, dt, t);
    this.shadows.count = this.shadowCount;
    this.shadows.instanceMatrix.needsUpdate = true;

    this.effects.update(dt);
    this.updateCamera(snap, dt, cinematic);

    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private updateEnvironment(scroll: number, time: number): void {
    const d = this.dummy;
    const span = 130;
    for (let i = 0; i < this.towerData.length; i++) {
      const tw = this.towerData[i]!;
      const z = -112 + ((((tw.z + scroll * 0.9) % span) + span) % span);
      d.position.set(tw.x, -0.6, z);
      d.rotation.set(0, 0, 0);
      d.scale.set(tw.w, tw.h, tw.d);
      d.updateMatrix();
      this.towers.setMatrixAt(i, d.matrix);
      d.position.set(tw.x, -0.6 + tw.h, z);
      d.scale.set(tw.w * 1.02, 1, tw.d * 1.02);
      d.updateMatrix();
      this.towerCaps.setMatrixAt(i, d.matrix);
    }
    this.towers.instanceMatrix.needsUpdate = true;
    this.towerCaps.instanceMatrix.needsUpdate = true;

    const step = 6;
    let k = 0;
    for (let i = 0; i < 32; i++) {
      const z = -125 + ((((i * step + scroll) % (32 * step)) + 32 * step) % (32 * step));
      for (const s of [-1, 1]) {
        d.position.set(s * (TRACK_HALF_WIDTH + 0.25), 0.35, z);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        this.posts.setMatrixAt(k++, d.matrix);
      }
    }
    this.posts.instanceMatrix.needsUpdate = true;
    this.environmentDetail.update(scroll, time);
    this.infrastructure.update(scroll);
  }

  private pushShadow(x: number, z: number, r: number): void {
    if (this.shadowCount >= MAX_SHADOWS) return;
    const d = this.dummy;
    d.position.set(x, 0.025, z);
    d.rotation.set(0, 0, 0);
    d.scale.set(r * 2.1, 1, r * 1.9);
    d.updateMatrix();
    this.shadows.setMatrixAt(this.shadowCount++, d.matrix);
  }

  /**
   * Selects up to MAX_RENDER_SQUAD breathable, non-overlapping visual slots so individual
   * Q-version troopers, golden captains, and assault mechs always have clear silhouette separation.
   */
  private computeVisualSquadTargets(
    snap: SimSnapshot,
  ): Array<{ x: number; z: number; tier: 1 | 2 | 3 }> {
    const sc = snap.squadCount;
    const { u3, totalVisible } = snap.tiers;
    if (sc <= 0 || totalVisible <= 0) return [];

    // Smooth visual hero promotion across real run squad sizes (without touching sim math):
    // - 14+ deploys Golden Heavy Captains (capped at 5 so Cobalt-Cyan Troopers stay dominant)
    // - 55+ deploys towering Stan Assault Mechs on heroic rear-flanks
    const n3 = Math.min(3, Math.max(u3, sc >= 175 ? 3 : sc >= 105 ? 2 : sc >= 55 ? 1 : 0));
    const n2 = sc >= 85 ? 5 : sc >= 55 ? 4 : sc >= 34 ? 3 : sc >= 20 ? 2 : sc >= 14 ? 1 : 0;
    const maxSlots = Math.max(1, MAX_RENDER_SQUAD - n3 * 2);
    const total = Math.min(maxSlots, Math.max(n3 + n2, totalVisible));
    const n1 = Math.max(0, total - n3 - n2);

    const out: Array<{ x: number; z: number; tier: 1 | 2 | 3 }> = [];
    const overdrive = snap.overdriveTimer > 0;
    const maxTrackX = TRACK_HALF_WIDTH - 0.58;

    // 1. Assault Mechs lead from the formation's far edge: the camera sits behind the squad, so anything
    //    nearer the camera covers the troopers beyond it, while a vanguard mech only has its legs overlapped.
    const infCount = n2 + n1;
    const spacing = infCount <= 8 ? 0.7 : 0.65;
    const front = -spacing * Math.sqrt(Math.max(0, infCount - 1) + 0.35) * 0.8 + 0.25;
    const mechOffsets: Array<[number, number]> =
      n3 === 1
        ? [[0, front - 0.55]]
        : n3 === 2
          ? [
              [-1.15, front - 0.35],
              [1.15, front - 0.35],
            ]
          : [
              [0, front - 0.7],
              [-1.5, front - 0.2],
              [1.5, front - 0.2],
            ];
    for (let m = 0; m < n3; m++) {
      const [ox, oz] = mechOffsets[m]!;
      out.push({
        x: THREE.MathUtils.clamp(snap.squadX + ox, -maxTrackX, maxTrackX),
        z: PLAYER_Z + oz,
        tier: 3,
      });
    }

    // 2. Golden Captains + Cobalt-Cyan Troopers arranged in breathable spiral / V-Wing chevron
    for (let k = 0; k < infCount; k++) {
      const tier: 1 | 2 = k < n2 ? 2 : 1;
      let ox = 0;
      let oz = 0;
      if (infCount > 1) {
        if (overdrive) {
          const rank = Math.ceil(k / 2);
          const side = k % 2 === 1 ? 1 : -1;
          ox = k === 0 ? 0 : side * rank * 0.44;
          oz = k === 0 ? -0.42 : rank * 0.25 - 0.28;
        } else {
          const r = spacing * Math.sqrt(k + 0.35);
          const theta = k * GOLDEN_ANGLE_RAD;
          ox = Math.cos(theta) * r;
          oz = Math.sin(theta) * r * 0.8 + (n3 > 0 ? 0.25 : 0);
        }
      } else if (n3 > 0) {
        oz = 0.3;
      }
      out.push({
        x: THREE.MathUtils.clamp(snap.squadX + ox, -maxTrackX, maxTrackX),
        z: PLAYER_Z + oz,
        tier,
      });
    }
    return out;
  }

  private updateSquad(snap: SimSnapshot, dt: number, t: number): void {
    const lib = this.gltfLib;
    const weaponChanged = snap.weapon !== this.currentWeapon;
    if (weaponChanged) {
      this.currentWeapon = snap.weapon;
      if (lib) {
        for (let tierIdx = 0; tierIdx < 2; tierIdx++) {
          for (const actor of this.squadPools[tierIdx]!) {
            actor.setWeapon(snap.weapon, lib.weapons);
          }
        }
        for (const slot of this.squadSlots) {
          if (slot.actor && slot.tier < 3) {
            slot.actor.setWeapon(snap.weapon, lib.weapons);
          }
        }
      }
    }

    const targets = lib ? this.computeVisualSquadTargets(snap) : [];
    const follow = 1 - Math.exp(-Math.max(dt, 0.001) * 15);
    const overdrive = snap.overdriveTimer > 0;
    const wc = WEAPON_COLOR[snap.weapon];
    const camQuat = this.camera.quaternion;
    const d = this.dummy;
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 11);
    let flashes = 0;

    const isVictory = snap.phase === 'VICTORY';
    const isIdleReady = snap.simTime === 0 && snap.phase === 'PLAYING';

    for (let i = 0; i < MAX_RENDER_SQUAD; i++) {
      const slot = this.squadSlots[i]!;
      const target = targets[i];
      if (!target || !lib) {
        if (slot.alive) this.releaseSquadSlot(slot);
        continue;
      }

      // Swap pooled actor if tier upgraded/downgraded
      if (slot.actor && slot.tier !== target.tier) {
        slot.actor.root.visible = false;
        this.squadPools[slot.tier - 1]!.push(slot.actor);
        slot.actor = null;
      }

      if (!slot.actor) {
        const pool = this.squadPools[target.tier - 1]!;
        const acquired =
          pool.pop() ??
          spawnActor(lib.heroes[target.tier - 1]!, {
            rimColor: target.tier === 2 ? 0xffe484 : 0x9beeff,
            rimStrength: 0.42,
            outlineWidth: 0.0054,
            weapons: target.tier < 3 ? lib.weapons : undefined,
            initialWeapon: this.currentWeapon,
          });
        if (!acquired.root.parent) this.scene.add(acquired.root);
        if (target.tier < 3) acquired.setWeapon(this.currentWeapon, lib.weapons);
        acquired.root.visible = true;
        slot.actor = acquired;
        slot.tier = target.tier;
        if (!slot.alive) {
          slot.alive = true;
          slot.x = snap.squadX;
          slot.z = PLAYER_Z + 0.5;
          slot.s = 0.05;
          slot.vx = 0;
        }
      }

      const px = slot.x;
      slot.x += (target.x - slot.x) * follow;
      slot.z += (target.z - slot.z) * follow;
      slot.vx += ((slot.x - px) / Math.max(dt, 1e-3) - slot.vx) * Math.min(1, dt * 10);
      slot.s += (1 - slot.s) * (1 - Math.exp(-Math.max(dt, 0.001) * 11));

      const actor = slot.actor;
      const isMech = slot.tier === 3;

      if (isVictory) {
        // Turn toward the player & celebrate on Victory!
        actor.play(isMech ? 'Idle' : 'Wave', { timeScale: 1.1, startOffset: (i * 0.19) % 1.2 });
        actor.inner.rotation.y += (0 - actor.inner.rotation.y) * Math.min(1, dt * 6);
      } else if (isIdleReady) {
        actor.play(isMech ? 'Idle' : 'Idle_Shoot', { timeScale: 1.0, startOffset: (i * 0.13) % 0.35 });
        actor.inner.rotation.y = Math.PI;
      } else {
        const runClip = isMech ? 'Run' : 'Run_Shoot';
        const runSpeed = (isMech ? 1.15 : 1.28) * (overdrive ? 1.28 : 1);
        actor.play(runClip, { timeScale: runSpeed, startOffset: (i * 0.17) % 0.7 });
        actor.setTimeScale(runSpeed);
        actor.inner.rotation.y = Math.PI;
      }

      actor.update(dt);

      const fl = this.muzzleFlash * (0.55 + 0.45 * Math.sin(i * 7.3 + t * 37));
      const recoilZ = fl * 0.06;
      const sc = slot.s * (overdrive ? 1.08 : 1);
      actor.root.position.set(slot.x, 0, slot.z + recoilZ);
      const yaw = THREE.MathUtils.clamp(-slot.vx * 0.028, -0.35, 0.35);
      const bank = THREE.MathUtils.clamp(-slot.vx * 0.014, -0.1, 0.1);
      actor.root.rotation.set(0, yaw, bank);
      actor.root.scale.setScalar(sc);

      const spawnFlash = Math.max(0, (1 - slot.s) * 0.8);
      const aegisOn = (snap.aegisTimer ?? 0) > 0;
      if (overdrive) {
        const od = 1.08 + Math.sin(t * 18 + i) * 0.08;
        actor.setVisuals(spawnFlash, od * 1.1, od * 1.04, od * 0.86);
        if (Math.random() < dt * 16) {
          this.effects.burst(slot.x, 0.38, slot.z + 0.25, 0xffe66d, 1, { speed: 2.2, size: 0.22, life: 0.22, up: -0.4, gravity: -3 });
        }
      } else if (aegisOn) {
        actor.setVisuals(spawnFlash, 0.92, 1.06, 1.14);
      } else {
        actor.setVisuals(spawnFlash, 1, 1, 1);
      }

      const shadowR = isMech ? 0.68 : slot.tier === 2 ? 0.44 : 0.36;
      this.pushShadow(slot.x, slot.z, shadowR * slot.s);

      if (fl > 0.08 && !isVictory && !isIdleReady && flashes < MAX_RENDER_SQUAD) {
        const mx = slot.x + (isMech ? 0 : 0.16);
        const my = isMech ? 1.45 : slot.tier === 2 ? 0.92 : 0.76;
        const mz = slot.z - (isMech ? 0.95 : 0.72);
        d.position.set(mx, my, mz);
        d.quaternion.copy(camQuat);
        const fs = (isMech ? 0.92 : 0.52) * (0.6 + fl * 0.55);
        d.scale.set(fs, fs, fs);
        d.updateMatrix();
        this.flashes.setMatrixAt(flashes, d.matrix);
        this.tmpColor.setHex(wc).multiplyScalar(0.65 + fl * 0.95);
        this.flashes.setColorAt(flashes, this.tmpColor);
        flashes++;
      }
    }

    this.flashes.count = flashes;
    this.flashes.instanceMatrix.needsUpdate = true;
    if (this.flashes.instanceColor) this.flashes.instanceColor.needsUpdate = true;
    d.rotation.set(0, 0, 0);

    const aegisActive = (snap.aegisTimer ?? 0) > 0;
    this.squadGlowMat.color.setHex(overdrive ? 0xffea75 : aegisActive ? 0x62f4ff : wc);
    const gs = snap.formationRadius * 2.5 + 1.5 + (overdrive ? 0.8 : 0);
    this.squadGlow.scale.set(gs, gs, 1);
    this.squadGlow.position.set(snap.squadX, 0.03, PLAYER_Z - 0.05);
    this.squadGlow.visible = snap.squadCount > 0;
    this.squadGlowMat.opacity = 0.28 + (overdrive ? 0.24 : aegisActive ? 0.18 : 0);

    const ringScale = snap.formationRadius * 2.15 + 1.05 + Math.sin(t * 4) * 0.04;
    this.squadRing.scale.set(ringScale, ringScale, 1);
    this.squadRing.position.set(snap.squadX, 0.038, PLAYER_Z);
    this.squadRing.rotation.z = t * (overdrive ? 1.6 : 0.48);
    this.squadRing.visible = snap.squadCount > 0;
    this.squadRingMat.color.setHex(overdrive ? 0xffe46b : aegisActive ? 0x62f4ff : wc);
    this.squadRingMat.opacity = 0.38 + (overdrive ? 0.28 : 0);

    if (aegisActive && snap.squadCount > 0) {
      this.aegisGroup.visible = true;
      const domeR = snap.formationRadius + 1.35;
      this.aegisGroup.position.set(snap.squadX, 0.15, PLAYER_Z);
      this.aegisGroup.scale.set(domeR, Math.max(1.85, domeR * 0.92), domeR);
      this.aegisWire.rotation.y = t * 1.8;
      this.aegisWire.rotation.z = Math.sin(t * 2.5) * 0.2;
      const fade = Math.min(1, (snap.aegisTimer ?? 0) * 3.5);
      this.aegisWireMat.opacity = (0.52 + Math.sin(t * 18) * 0.14) * fade;
      this.aegisShellMat.opacity = (0.14 + Math.sin(t * 12) * 0.04) * fade;
    } else {
      this.aegisGroup.visible = false;
    }

    const nb = snap.bladesCount;
    this.blades.count = nb;
    for (let i = 0; i < nb; i++) {
      const a = snap.bladesAngle + (i / nb) * Math.PI * 2;
      d.position.set(
        snap.squadX + Math.cos(a) * BLADES_ORBIT_RADIUS,
        0.65,
        PLAYER_Z + Math.sin(a) * BLADES_ORBIT_RADIUS * 0.85,
      );
      d.rotation.set(0.25, -a * 3 + t * 14, 0);
      d.scale.set(1.55, 1.55, 1.55);
      d.updateMatrix();
      this.blades.setMatrixAt(i, d.matrix);
    }
    this.blades.instanceMatrix.needsUpdate = true;
  }

  private updateEnemies(snap: SimSnapshot, dt: number, t: number): void {
    const lib = this.gltfLib;
    const d = this.dummy;
    const camQuat = this.camera.quaternion;
    let bars = 0;
    let tels = 0;
    let tetherIdx = 0;

    for (const entry of this.activeEnemies.values()) entry.seen = false;

    if (lib) {
      for (const e of snap.enemies) {
        let entry = this.activeEnemies.get(e.id);
        if (!entry) {
          const pool = this.enemyPools[e.kind];
          const actor = pool.pop();
          if (!actor) continue;
          actor.root.visible = true;
          actor.resetAnimation();
          entry = {
            kind: e.kind,
            actor,
            x: e.x,
            z: e.z,
            scale: 1,
            seen: true,
          };
          this.activeEnemies.set(e.id, entry);
        }
        entry.seen = true;
        entry.x = e.x;
        entry.z = e.z;

        const tmpl = lib.enemies[e.kind];
        const sc = e.radius / tmpl.refRadius;
        entry.scale = sc;

        const hit = e.hitPulse;
        const slowed = e.slowTimer > 0;
        const tele = e.kind === 'dasher' && e.telegraphTimer > 0;
        const speedMod = slowed ? 0.45 : 1;

        // Pick dynamic skeletal animation clip per monster archetype & combat state
        const phaseOffset = (e.id * 0.23) % 0.8;
        switch (e.kind) {
          case 'crawler': {
            const near = e.z > PLAYER_Z - 3.8;
            entry.actor.play(near ? 'Bite_Front' : 'Walk', {
              timeScale: (near ? 1.35 : 1.5) * speedMod,
              startOffset: phaseOffset,
            });
            break;
          }
          case 'dasher': {
            if (tele) {
              entry.actor.play('Duck', { timeScale: 1.2 * speedMod, fade: 0.08 });
            } else {
              const dashing = e.z > -34;
              entry.actor.play('Run', {
                timeScale: (dashing ? 2.15 : 1.3) * speedMod,
                fade: 0.08,
                startOffset: phaseOffset,
              });
            }
            break;
          }
          case 'bastion': {
            const swinging = e.z > PLAYER_Z - 5.2;
            entry.actor.play(swinging ? 'Weapon' : 'Walk', {
              timeScale: (swinging ? 1.15 : 1.05) * speedMod,
              startOffset: phaseOffset,
            });
            break;
          }
          case 'mitosis': {
            entry.actor.play('Walk', {
              timeScale: 1.25 * speedMod,
              startOffset: phaseOffset,
            });
            break;
          }
          case 'siphon': {
            const draining = e.linkedGateId !== null;
            entry.actor.play(draining ? 'Fast_Flying' : 'Flying_Idle', {
              timeScale: 1.15 * speedMod,
              startOffset: phaseOffset,
            });
            break;
          }
        }
        entry.actor.update(dt);

        const yaw = THREE.MathUtils.clamp(Math.atan2(snap.squadX - e.x, PLAYER_Z - e.z), -0.65, 0.65);
        const jitter = tele ? (Math.random() - 0.5) * 0.08 : 0;
        entry.actor.root.position.set(e.x + jitter, 0, e.z);
        entry.actor.root.rotation.set(0, yaw, 0);

        // Snappy cartoon squash-and-stretch on bullet impact
        const squashXZ = sc * (1 + hit * 0.16);
        const squashY = sc * (1 - hit * 0.1);
        entry.actor.root.scale.set(squashXZ, squashY, squashXZ);

        const hitFlash = hit > 0.6 ? (0.5 + 0.5 * Math.sin(t * 44 + e.id)) * 0.3 : hit * 0.28;
        entry.actor.setVisuals(hitFlash, 1, 1, 1, slowed ? 0.78 : 0);

        this.pushShadow(e.x, e.z, e.radius * (e.kind === 'siphon' ? 0.75 : 1.08));

        if (e.maxHp >= 40 && e.hp < e.maxHp && bars < 64) {
          const w = Math.max(0.95, e.radius * 2);
          const y = ENEMY_BAR_H[e.kind] * sc + 0.15;
          d.position.set(e.x, y, e.z);
          d.quaternion.copy(camQuat);
          d.scale.set(w + 0.1, 1.4, 1);
          d.updateMatrix();
          this.hpBg.setMatrixAt(bars, d.matrix);
          d.position.set(e.x - w / 2, y, e.z + 0.01);
          d.scale.set(Math.max(0.001, (w * e.hp) / e.maxHp), 1, 1);
          d.updateMatrix();
          this.hpFg.setMatrixAt(bars, d.matrix);
          bars++;
          d.rotation.set(0, 0, 0);
        }

        if (tele && tels < 24) {
          d.rotation.set(0, 0, 0);
          d.position.set(e.x, 0.06, e.z);
          d.scale.set(e.radius * 2.2, 1, Math.max(1, PLAYER_Z + 3 - e.z));
          d.updateMatrix();
          this.telegraphs.setMatrixAt(tels, d.matrix);
          const pulse = 0.5 + 0.5 * Math.sin(t * 30);
          this.tmpColor.setRGB(1, 0.15 + pulse * 0.2, 0.2).multiplyScalar(0.7 + pulse * 0.45);
          this.telegraphs.setColorAt(tels, this.tmpColor);
          tels++;
        }

        if (e.kind === 'siphon' && e.linkedGateId !== null && tetherIdx < this.tethers.length) {
          const g = snap.gates.find((q) => q.id === e.linkedGateId && !q.triggered && !q.dimmed);
          if (g) {
            const tm = this.tethers[tetherIdx++]!;
            const from = this.tmpA.set(e.x, 1.3 * sc, e.z);
            const to = this.tmpB.set(g.x, 1.5, g.z);
            const len = from.distanceTo(to);
            tm.position.copy(from);
            tm.lookAt(to);
            tm.scale.set(1 + Math.sin(t * 25) * 0.4, 1 + Math.sin(t * 25) * 0.4, len);
            tm.visible = true;
          }
        }
      }
    }

    // Transition killed monsters into a brief juicy skeletal Death animation
    for (const [id, entry] of this.activeEnemies) {
      if (!entry.seen) {
        this.activeEnemies.delete(id);
        if (entry.z < PLAYER_Z - 0.35 && this.dyingEnemies.length < 24) {
          entry.actor.play('Death', { loop: false, fade: 0.05, timeScale: 1.35 });
          entry.actor.setVisuals(0.65, 1, 1, 1);
          this.dyingEnemies.push({
            kind: entry.kind,
            actor: entry.actor,
            x: entry.x,
            z: entry.z,
            scale: entry.scale,
            age: 0,
            duration: 0.46,
          });
        } else {
          entry.actor.root.visible = false;
          this.enemyPools[entry.kind].push(entry.actor);
        }
      }
    }

    // Advance skeletal Death tumble animations
    for (let i = this.dyingEnemies.length - 1; i >= 0; i--) {
      const dm = this.dyingEnemies[i]!;
      dm.age += dt;
      if (dm.age >= dm.duration) {
        dm.actor.root.visible = false;
        this.enemyPools[dm.kind].push(dm.actor);
        this.dyingEnemies.splice(i, 1);
        continue;
      }
      dm.z -= dt * 2.2;
      const p = dm.age / dm.duration;
      const shrink = p > 0.65 ? Math.max(0.05, 1 - (p - 0.65) / 0.35) : 1;
      dm.actor.root.position.set(dm.x, 0, dm.z);
      dm.actor.root.scale.setScalar(dm.scale * shrink);
      dm.actor.setVisuals(Math.max(0, (1 - p * 3) * 0.6), 1, 1, 1);
      dm.actor.update(dt);
    }

    this.hpBg.count = this.hpFg.count = bars;
    this.hpBg.instanceMatrix.needsUpdate = this.hpFg.instanceMatrix.needsUpdate = true;
    this.telegraphs.count = tels;
    this.telegraphs.instanceMatrix.needsUpdate = true;
    if (this.telegraphs.instanceColor) this.telegraphs.instanceColor.needsUpdate = true;
    for (let i = tetherIdx; i < this.tethers.length; i++) this.tethers[i]!.visible = false;
  }

  private updateProjectiles(snap: SimSnapshot): void {
    const d = this.dummy;
    let n = 0;
    let orbs = 0;
    for (const p of snap.projectiles) {
      if (p.hostile) {
        if (orbs >= 64) continue;
        d.position.set(p.x, 0.75, p.z);
        d.rotation.set(this.time * 5, this.time * 4, 0);
        d.scale.setScalar(1 + Math.sin(this.time * 20 + p.id) * 0.12);
        d.updateMatrix();
        this.orbMesh.setMatrixAt(orbs, d.matrix);
        d.position.set(p.x, 0.05, p.z);
        d.rotation.set(0, 0, 0);
        d.scale.set(1.6, 1, 1.6);
        d.updateMatrix();
        this.orbMarks.setMatrixAt(orbs, d.matrix);
        orbs++;
        continue;
      }
      if (n >= MAX_PROJ) continue;
      const ps = p.powerScale;
      let sx = 0.11;
      let sz = 0.85;
      switch (p.weapon) {
        case 'scatter': sx = 0.14; sz = 0.58; break;
        case 'rail': sx = 0.16; sz = 2.4; break;
        case 'plasma': sx = 0.44; sz = 0.44; break;
        case 'cryo': sx = 0.13; sz = 1.02; break;
        default: break;
      }
      d.position.set(p.x, 0.65, p.z);
      d.rotation.set(p.weapon === 'plasma' ? this.time * 8 : 0, Math.atan2(p.vx, p.vz), 0);
      const amp = p.amplified ? 1.3 : 1;
      d.scale.set(sx * ps * amp, sx * ps * amp, sz * (0.8 + ps * 0.2) * amp);
      d.updateMatrix();
      this.projMesh.setMatrixAt(n, d.matrix);
      // Slight >1 HDR boost so UnrealBloomPass gives projectiles a clean neon glow
      const boltHex = p.amplified ? 0xffe27a : WEAPON_COLOR[p.weapon];
      this.tmpColor.setHex(boltHex).multiplyScalar(1.36);
      this.projMesh.setColorAt(n, this.tmpColor);
      if ((p.amplified || p.weapon === 'plasma' || p.weapon === 'rail') && Math.random() < 0.14) {
        this.effects.burst(p.x, 0.65, p.z + 0.3, boltHex, 1, { speed: 1.4, size: p.weapon === 'plasma' ? 0.26 : 0.18, life: 0.16, gravity: 0 });
      }
      n++;
    }
    this.projMesh.count = n;
    this.projMesh.instanceMatrix.needsUpdate = true;
    if (this.projMesh.instanceColor) this.projMesh.instanceColor.needsUpdate = true;
    this.orbMesh.count = orbs;
    this.orbMarks.count = orbs;
    this.orbMesh.instanceMatrix.needsUpdate = true;
    this.orbMarks.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- gates
  private acquireGate(): GateView {
    const pooled = this.gatePool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    const postMat = std(0xffffff, 0.12, { vertexColors: true, metalness: 0.55, roughness: 0.38 });
    const hardware = new GeoBuilder()
      .add(box(0.24, 2.85, 0.26), 0x536776, 0, { p: [0, 1.44, 0] })
      .add(box(0.48, 0.18, 0.65), 0x263448, 0, { p: [0, 0.09, 0] })
      .add(box(0.34, 0.4, 0.36), 0x8596a8, 0, { p: [0, 0.4, 0] })
      .add(box(0.12, 2.18, 0.04), 0xd2eeff, 0, { p: [0, 1.67, 0.16] })
      .add(box(0.38, 0.18, 0.38), 0xc2d0dd, 0, { p: [0, 2.85, 0] });
    for (let i = 0; i < 3; i++) hardware.add(box(0.36, 0.06, 0.37), 0x263448, 0, { p: [0, 0.34 + i * 0.11, 0] });
    const postGeo = hardware.build();
    const postL = new THREE.Mesh(postGeo, postMat);
    const postR = new THREE.Mesh(postGeo, postMat);
    const beam = new THREE.Mesh(new GeoBuilder().add(box(1, 0.16, 0.28), 0x617889).add(box(1, 0.045, 0.31), 0xd2eeff, 0, { p: [0, -0.1, 0] }).add(oct(0.18), 0xffffff, 0, { p: [0, 0.26, 0], s: [0.85, 1.35, 0.6] }).build(), postMat);
    beam.position.y = 2.9;
    const curtainMat = additive(0xffffff, 0.18);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.8).translate(0, 1.4, 0), curtainMat);
    const { ctx, tex } = makeCanvasTexture(512, 288);
    // Clamped color <= 0.90 linear so bloom threshold (0.93) never blurs gate numbers!
    const plateMat = new THREE.MeshBasicMaterial({
      color: 0xf4f8ff,
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1, 288 / 512), plateMat);
    plate.position.set(0, 1.55, 0.08);
    plate.rotation.x = -0.28;
    plate.renderOrder = 4;
    group.add(postL, postR, beam, curtain, plate);
    this.scene.add(group);
    return {
      id: -1,
      group,
      postMat,
      curtainMat,
      beam,
      postL,
      postR,
      curtain,
      plate,
      plateMat,
      ctx,
      tex,
      key: '',
      seen: false,
      fade: 1,
    };
  }

  private releaseGate(v: GateView): void {
    v.group.visible = false;
    v.key = '';
    v.id = -1;
    this.gatePool.push(v);
  }

  private updateGates(snap: SimSnapshot, dt: number, t: number): void {
    for (const v of this.gateViews.values()) v.seen = false;
    for (const g of snap.gates) {
      let v = this.gateViews.get(g.id);
      if (!v) {
        v = this.acquireGate();
        v.id = g.id;
        v.fade = 1;
        this.gateViews.set(g.id, v);
      }
      v.seen = true;
      this.layoutGate(v, g, dt, t);
    }
    for (const [id, v] of this.gateViews) {
      if (!v.seen) {
        this.releaseGate(v);
        this.gateViews.delete(id);
      }
    }
  }

  private layoutGate(v: GateView, g: GateSnapshot, dt: number, t: number): void {
    const w = g.halfWidth * 2;
    v.group.position.set(g.x, 0, g.z);
    v.postL.position.x = -g.halfWidth;
    v.postR.position.x = g.halfWidth;
    v.beam.scale.x = w + 0.24;
    v.curtain.scale.x = w;
    const key = gateTextureKey(g);
    if (key !== v.key) {
      v.key = key;
      paintGatePlate(v.ctx, 512, 288, g);
      v.tex.needsUpdate = true;
    }
    const { main } = gateColors(g);
    v.postMat.color.set(g.mutable ? COLORS.gold : main);
    v.postMat.emissive.set(g.mutable ? COLORS.gold : main);
    v.curtainMat.color.set(main);
    if (g.triggered) {
      v.fade = Math.max(0, v.fade - dt * 3);
    } else if (g.dimmed) {
      v.fade = Math.max(0.25, v.fade - dt * 2);
    }
    const pulse = g.hitPulse;
    const flip = g.flipPulse;
    v.curtainMat.opacity = (0.15 + pulse * 0.1 + flip * 0.35 + Math.sin(t * 4 + g.id) * 0.03) * v.fade;
    v.plateMat.opacity = g.triggered ? v.fade : 1;
    const plateW = Math.min(w * 0.94, 4.8);
    const ps = plateW * (1 + pulse * 0.07 + flip * 0.18);
    v.plate.scale.set(ps, ps, 1);
    v.postMat.emissiveIntensity = 0.12 + flip * 0.8 + pulse * 0.25;
    const ts = g.triggered ? 1 + (1 - v.fade) * 0.4 : 1;
    v.group.scale.set(ts, ts, 1);
  }

  // ---------------------------------------------------------------- vaults
  private acquireVault(): VaultView {
    const pooled = this.vaultPool.pop();
    if (pooled) {
      this.installTrialCasing(pooled);
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    if (!this.vaultFrameGeo) {
      const b = new GeoBuilder();
      b.add(cyl(1.12, 1.25, 0.3, 12), 0x1a2140, 0, { p: [0, 0.15, 0] })
        .add(cyl(1.0, 1.1, 0.12, 12), 0x2b3560, 0, { p: [0, 0.36, 0] })
        .add(tor(1.06, 0.045, 4, 24), 0xffffff, 1.8, { p: [0, 0.31, 0], r: [Math.PI / 2, 0, 0] })
        .add(cyl(1.0, 0.9, 0.22, 12), 0x1a2140, 0, { p: [0, 1.74, 0] })
        .add(tor(0.96, 0.04, 4, 24), 0xffffff, 1.8, { p: [0, 1.66, 0], r: [Math.PI / 2, 0, 0] })
        .add(sph(0.14, 8, 6), 0xffffff, 2.2, { p: [0, 1.9, 0] });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        b.add(box(0.12, 1.3, 0.12), 0x2b3560, 0, { p: [Math.cos(a) * 1.0, 1.0, Math.sin(a) * 1.0], r: [0, -a, 0] })
          .add(box(0.03, 1.1, 0.03), 0xffffff, 1.5, { p: [Math.cos(a) * 1.07, 1.0, Math.sin(a) * 1.07], r: [0, -a, 0] });
      }
      this.vaultFrameGeo = b.build();
    }
    const frame = new THREE.Mesh(this.vaultFrameGeo, this.propMat);
    const crystalMat = std(0xffffff, 0.25, {
      transparent: true,
      opacity: 0.26,
      metalness: 0.2,
      roughness: 0.1,
      flatShading: false,
      depthWrite: false,
    });
    const crystal = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.3, 16, 1, true), crystalMat);
    crystal.position.y = 1.0;
    crystal.renderOrder = 2;

    const coreGroup = new THREE.Group();
    coreGroup.position.y = 1.0;
    const core = new THREE.Mesh(buildRewardDisplayGeo('pulse'), this.vaultToonMat);
    const coreOutline = new THREE.Mesh(new THREE.BufferGeometry(), getOutlineMaterial(0.0052));
    coreOutline.visible = false;
    coreGroup.add(core, coreOutline);

    const ringMat = additive(0xffffff, 0.45, this.glowTex);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.05;
    const { ctx, tex } = makeCanvasTexture(384, 192);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.3),
      new THREE.MeshBasicMaterial({ color: 0xf4f8ff, map: tex, transparent: true, depthWrite: false }),
    );
    plate.position.set(0, 2.75, 0);
    plate.rotation.x = -0.32;
    plate.renderOrder = 4;
    group.add(ring, frame, coreGroup, crystal, plate);
    this.scene.add(group);
    const view: VaultView = {
      id: -1,
      group,
      crystal,
      crystalMat,
      coreGroup,
      core,
      coreOutline,
      coreMat: this.vaultToonMat,
      frame,
      ringMat,
      reward: '',
      plate,
      ctx,
      tex,
      key: '',
      seen: false,
    };
    this.installTrialCasing(view);
    return view;
  }

  private releaseVault(v: VaultView): void {
    v.group.visible = false;
    v.key = '';
    this.vaultPool.push(v);
  }

  private updateVaults(snap: SimSnapshot, t: number): void {
    for (const v of this.vaultViews.values()) v.seen = false;
    for (const s of snap.vaults) {
      if (s.broken) continue;
      let v = this.vaultViews.get(s.id);
      if (!v) {
        v = this.acquireVault();
        v.id = s.id;
        this.vaultViews.set(s.id, v);
      }
      v.seen = true;
      this.layoutVault(v, s, t);
    }
    for (const [id, v] of this.vaultViews) {
      if (!v.seen) {
        this.releaseVault(v);
        this.vaultViews.delete(id);
      }
    }
  }

  private layoutVault(v: VaultView, s: VaultSnapshot, t: number): void {
    const meta = REWARD_META[s.rewardWeapon];
    v.group.position.set(s.x, 0, s.z);
    const key = `${s.rewardWeapon}|${s.displayHp}`;
    if (key !== v.key) {
      v.key = key;
      paintVaultPlate(v.ctx, 384, 192, s.rewardWeapon, s.displayHp, s.maxHp);
      v.tex.needsUpdate = true;
    }
    const rewardKey = `${s.rewardWeapon}:${Boolean(this.gltfLib)}`;
    if (v.reward !== rewardKey) {
      v.reward = rewardKey;
      const libDef = this.gltfLib?.vaultRewards[s.rewardWeapon as RewardId];
      if (libDef) {
        v.core.geometry = libDef.geo;
        v.coreOutline.geometry = libDef.outlineGeo;
        v.coreOutline.visible = true;
      } else {
        let geo = this.fallbackRewardGeos.get(s.rewardWeapon);
        if (!geo) {
          geo = buildRewardDisplayGeo(s.rewardWeapon);
          this.fallbackRewardGeos.set(s.rewardWeapon, geo);
        }
        v.core.geometry = geo;
        v.coreOutline.visible = false;
      }
    }
    const hp = s.hitPulse;
    v.crystalMat.color.set(meta.color);
    v.crystalMat.emissive.set(meta.color);
    v.crystalMat.emissiveIntensity = 0.25 + hp * 1.1;
    v.crystalMat.opacity = 0.26 + hp * 0.2;
    v.ringMat.color.set(meta.color);
    v.ringMat.opacity = 0.35 + Math.sin(t * 4 + s.id) * 0.1 + hp * 0.25;
    v.coreGroup.rotation.set(0.28, t * 1.7, Math.sin(t * 2) * 0.12);
    v.coreGroup.position.y = 1.05 + Math.sin(t * 3 + s.id) * 0.1;
    const sc = 1 + hp * 0.08;
    v.crystal.scale.set(sc, 1, sc);
    v.frame.scale.set(sc, 1, sc);
  }

  // ---------------------------------------------------------------- barrels
  private acquireBarrel(): BarrelView {
    const pooled = this.barrelPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    if (!this.barrelGeo) {
      const b = new GeoBuilder();
      const ORANGE = 0xff7a1a;
      const DARK = 0x1a1426;
      b.add(cyl(0.62, 0.62, 1.22, 16), ORANGE, 0.2, { p: [0, 0.7, 0] })
        .add(cyl(0.66, 0.68, 0.16, 16), DARK, 0, { p: [0, 0.12, 0] })
        .add(cyl(0.65, 0.65, 0.1, 16), DARK, 0, { p: [0, 0.45, 0] })
        .add(cyl(0.65, 0.65, 0.1, 16), DARK, 0, { p: [0, 0.98, 0] })
        .add(cyl(0.52, 0.62, 0.14, 16), DARK, 0, { p: [0, 1.36, 0] })
        .add(box(0.36, 0.38, 0.08), 0xfff06a, 2.2, { p: [0, 0.72, 0.6] })
        .add(box(0.36, 0.38, 0.08), 0xfff06a, 2.2, { p: [0, 0.72, -0.6] })
        .add(box(0.12, 0.05, 0.03), DARK, 0, { p: [-0.36, 0.72, 0.52], r: [0, 0.6, 0.6] })
        .add(box(0.12, 0.05, 0.03), DARK, 0, { p: [0.36, 0.72, 0.52], r: [0, -0.6, -0.6] })
        .add(cyl(0.05, 0.05, 0.22, 6), DARK, 0, { p: [0.28, 1.5, 0] });
      this.barrelGeo = b.build();
    }
    const bodyMat = makeCharacterMaterial(0xffc06a, 0.4, 1.4);
    const body = new THREE.Mesh(this.barrelGeo, bodyMat);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, toneMapped: false });
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lightMat);
    light.position.y = 1.52;
    const ringMat = additive(0xff9a1a, 0.42);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.05;
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2),
      additive(0xff9a1a, 0.06),
    );
    fill.position.y = 0.04;
    group.add(body, light, ring, fill);
    this.scene.add(group);
    return { id: -1, group, body, bodyMat, light, lightMat, ring, fill, ringMat, seen: false };
  }

  private releaseBarrel(v: BarrelView): void {
    v.group.visible = false;
    this.barrelPool.push(v);
  }

  private updateBarrels(snap: SimSnapshot, t: number): void {
    for (const v of this.barrelViews.values()) v.seen = false;
    for (const b of snap.barrels) {
      if (b.detonated) continue;
      let v = this.barrelViews.get(b.id);
      if (!v) {
        v = this.acquireBarrel();
        v.id = b.id;
        this.barrelViews.set(b.id, v);
      }
      v.seen = true;
      this.layoutBarrel(v, b, t);
    }
    for (const [id, v] of this.barrelViews) {
      if (!v.seen) {
        this.releaseBarrel(v);
        this.barrelViews.delete(id);
      }
    }
  }

  private layoutBarrel(v: BarrelView, b: BarrelSnapshot, t: number): void {
    v.group.position.set(b.x, 0, b.z);
    this.pushShadow(b.x, b.z, 0.72);
    v.ring.scale.set(b.blastRadius, 1, b.blastRadius);
    v.fill.scale.set(b.blastRadius, 1, b.blastRadius);
    v.ringMat.opacity = 0.32 + Math.sin(t * 6 + b.id) * 0.12;
    const dmg = 1 - b.hp / 15;
    v.bodyMat.emissive.setRGB(1, 0.55, 0.1).multiplyScalar(b.hitPulse * 0.65 + dmg * 0.22);
    const blink = Math.sin(t * (6 + dmg * 18) + b.id) > 0 ? 1.2 : 0.25;
    v.lightMat.color.setRGB(blink + b.hitPulse, 0.23 * blink + b.hitPulse, 0.23 * blink + b.hitPulse);
    const s = 1 + b.hitPulse * 0.15;
    v.body.scale.set(s, s, s);
    v.light.position.y = 1.52 * s;
  }

  // ---------------------------------------------------------------- lenses
  private acquireLens(): LensView {
    const pooled = this.lensPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    const frameMat = std(0xffc531, 0.75, { metalness: 0.8 });
    const postGeo = new THREE.BoxGeometry(0.18, 2.2, 0.18).translate(0, 1.1, 0);
    const l = new THREE.Mesh(postGeo, frameMat);
    const r = new THREE.Mesh(postGeo, frameMat);
    l.name = 'l';
    r.name = 'r';
    const paneMat = additive(0xffd84a, 0.26);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.0).translate(0, 1.1, 0), paneMat);
    pane.name = 'pane';
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.76),
      new THREE.MeshBasicMaterial({ color: 0xf4f8ff, map: this.lensTex, transparent: true, depthWrite: false }),
    );
    label.position.set(0, 2.75, 0);
    label.rotation.x = -0.32;
    label.renderOrder = 4;
    group.add(l, r, pane, label);
    this.scene.add(group);
    return { id: -1, group, paneMat, seen: false };
  }

  private releaseLens(v: LensView): void {
    v.group.visible = false;
    this.lensPool.push(v);
  }

  private updateLenses(snap: SimSnapshot, t: number): void {
    for (const v of this.lensViews.values()) v.seen = false;
    for (const s of snap.lenses) {
      let v = this.lensViews.get(s.id);
      if (!v) {
        v = this.acquireLens();
        v.id = s.id;
        this.lensViews.set(s.id, v);
      }
      v.seen = true;
      this.layoutLens(v, s, t);
    }
    for (const [id, v] of this.lensViews) {
      if (!v.seen) {
        this.releaseLens(v);
        this.lensViews.delete(id);
      }
    }
  }

  private layoutLens(v: LensView, s: PrismLensSnapshot, t: number): void {
    v.group.position.set(s.x, 0, s.z);
    const l = v.group.getObjectByName('l')!;
    const r = v.group.getObjectByName('r')!;
    const pane = v.group.getObjectByName('pane')!;
    l.position.x = -s.halfWidth;
    r.position.x = s.halfWidth;
    pane.scale.x = s.halfWidth * 2;
    v.paneMat.opacity = 0.2 + s.pulse * 0.45 + Math.sin(t * 5) * 0.05;
  }

  // ---------------------------------------------------------------- boss
  private updateBoss(snap: SimSnapshot, dt: number, t: number): void {
    const b = snap.boss;
    for (const [id, view] of this.bossViews) {
      if (!b || b.id !== id) {
        view.root.visible = false;
        if (view.secondaryRoot) view.secondaryRoot.visible = false;
        view.pylons?.forEach((p) => (p.visible = false));
        view.beams?.forEach((p) => (p.visible = false));
      }
    }
    for (const h of this.hazardViews) h.group.visible = false;
    if (!b) {
      this.bossBlend = Math.max(0, this.bossBlend - dt);
      return;
    }
    this.bossBlend = Math.min(1, this.bossBlend + dt * 0.8);

    const view = this.bossViews.get(b.id);
    if (view) {
      if (this.bossDeathT >= 0) this.bossDeathT += dt;
      const dying = !b.active;
      const show = !this.bossHidden;
      view.root.visible = show;

      const jitter = dying ? (Math.random() - 0.5) * 0.4 : 0;
      const intro = b.introProgress;
      const rise = -(1 - intro) * 4.5;
      const deathK = dying ? Math.max(0.25, 1 - this.bossDeathT * 0.25) : 1;
      const scale = (0.78 + 0.22 * intro) * deathK;

      view.root.position.set(b.x + jitter, rise, b.z + jitter);
      const squash = 1 + b.hitPulse * 0.07;
      view.root.scale.set(scale * squash, scale * (1 - b.hitPulse * 0.04), scale * squash);

      // Smoothly turn boss toward the squad
      const lookYaw = THREE.MathUtils.clamp((snap.squadX - b.x) * 0.06, -0.45, 0.45);
      view.primary.root.rotation.y += (lookYaw - view.primary.root.rotation.y) * Math.min(1, dt * 5);

      const rageSpeed = 1 + (b.phase - 1) * 0.22;
      const hazardCharging = b.hazardZones.some((hz) => hz.warningProgress > 0.55 || hz.firing);
      view.attackCooldown = Math.max(0, view.attackCooldown - dt);

      if (!dying) {
        if (b.id === 'warden_01') {
          if (hazardCharging && view.attackCooldown <= 0) {
            view.primary.play('Punch', { loop: false, fade: 0.1, timeScale: 1.15 * rageSpeed });
            view.attackCooldown = 1.3;
          } else if (view.attackCooldown <= 0.15) {
            view.primary.play('Fast_Flying', { timeScale: 0.95 * rageSpeed, fade: 0.2 });
          }
          if (view.halo) view.halo.rotation.z = t * 1.2;
        } else if (b.id === 'hydra_02') {
          if (hazardCharging && view.attackCooldown <= 0) {
            view.primary.play('Headbutt', { loop: false, fade: 0.1, timeScale: 1.2 * rageSpeed });
            view.secondary?.play('Headbutt', { loop: false, fade: 0.1, timeScale: 1.2 * rageSpeed });
            view.attackCooldown = 1.3;
          } else if (view.attackCooldown <= 0.15) {
            view.primary.play('Fast_Flying', { timeScale: 1.05 * rageSpeed, fade: 0.2 });
            view.secondary?.play('Fast_Flying', { timeScale: 1.12 * rageSpeed, fade: 0.2 });
          }
        } else if (b.id === 'omega_zero') {
          if (hazardCharging && view.attackCooldown <= 0) {
            view.primary.play('Weapon', { loop: false, fade: 0.1, timeScale: 1.15 * rageSpeed });
            view.attackCooldown = 1.1;
          } else if (view.attackCooldown <= 0.15) {
            view.primary.play(b.phase >= 2 ? 'Walk' : 'Idle', { timeScale: 1.05 * rageSpeed, fade: 0.2 });
          }
          if (view.halo) {
            view.halo.rotation.z = t * (0.9 + (b.phase - 1) * 0.7);
            view.halo.scale.setScalar(1 + Math.sin(t * 5) * 0.05);
          }
        }
      }

      const heatTintR = 1 + (b.phase - 1) * 0.08;
      const bossHitFlash =
        b.hitPulse > 0.55 ? (0.45 + 0.55 * Math.sin(t * 42)) * 0.16 : b.hitPulse * 0.14;
      const flashVal = bossHitFlash + (dying ? Math.random() * 0.35 : 0);
      view.primary.setVisuals(flashVal, heatTintR, 1, 1);
      view.primary.update(dt);
      this.pushShadow(b.x, b.z, 2.35 * scale);

      view.shield.visible = show && b.shielded && b.active;
      view.shield.rotation.y = t * 0.8;
      view.shield.rotation.x = t * 0.35;
      (view.shield.material as THREE.MeshBasicMaterial).opacity =
        0.34 + Math.sin(t * 7) * 0.08 + b.hitPulse * 0.12;

      const sc = b.secondaryCore ?? null;
      if (view.secondary && view.secondaryRoot) {
        if (b.id === 'hydra_02' && !sc && show && !dying) {
          // Phase 1 Twin-Dragon presentation: Cyan twin hovers beside the Violet Elder Dragon before splitting!
          view.secondaryRoot.visible = true;
          view.secondaryRoot.position.set(
            b.x + 2.35 + Math.sin(t * 1.8) * 0.35,
            rise + 0.35,
            b.z - 1.35,
          );
          view.secondaryRoot.scale.setScalar(scale * 0.85);
          if (view.shield2) view.shield2.visible = false;
        } else {
          view.secondaryRoot.visible = Boolean(sc) && show;
          if (sc) {
            view.secondaryRoot.position.set(sc.x, rise, sc.z);
            view.secondaryRoot.scale.setScalar(scale);
            if (view.shield2) view.shield2.visible = sc.shielded;
            this.pushShadow(sc.x, sc.z, 1.85 * scale);
          }
        }
        view.secondary.setVisuals(flashVal * 0.85, 1, 1, 1);
        view.secondary.update(dt);
      }

      const coreY = rise + view.coreHeight * scale;
      if (view.pylons && view.beams) {
        for (let i = 0; i < view.pylons.length; i++) {
          const p = b.pylons[i];
          const pv = view.pylons[i]!;
          const beam = view.beams[i]!;
          if (p && !p.destroyed && b.active) {
            pv.visible = true;
            pv.position.set(p.x, 0, p.z);
            pv.children[0]!.rotation.y = t * 2;
            this.pushShadow(p.x, p.z, 1.05);
            const from = this.tmpA.set(p.x, 2.5, p.z);
            const to = this.tmpB.set(b.x, coreY, b.z);
            beam.position.copy(from);
            beam.lookAt(to);
            beam.scale.set(
              1 + Math.sin(t * 30) * 0.45,
              1 + Math.sin(t * 30) * 0.45,
              from.distanceTo(to),
            );
            beam.visible = true;
          } else {
            pv.visible = false;
            beam.visible = false;
          }
        }
      }
    }

    // Telegraphed hazard lanes
    for (let i = 0; i < b.hazardZones.length && i < this.hazardViews.length; i++) {
      const hz = b.hazardZones[i]!;
      const hv = this.hazardViews[i]!;
      hv.group.visible = true;
      const w = hz.halfWidth * 2;
      hv.group.position.set(hz.x, 0, hz.z);
      hv.fill.scale.set(w, 1, hz.depth);
      hv.fillMat.opacity = hz.firing ? 0.24 : 0.1 + hz.warningProgress * 0.14;
      const pz = Math.max(0.001, hz.warningProgress);
      hv.progress.scale.set(w, 1, hz.depth * pz);
      hv.progress.position.z = -hz.depth / 2 + (hz.depth * pz) / 2;
      hv.progressMat.opacity = hz.firing ? 0.48 : 0.3 + hz.warningProgress * 0.25;
      const map = hv.progressMat.map;
      if (map) map.offset.y = -t * 2;
      hv.edgeL.scale.set(0.1, 1, hz.depth);
      hv.edgeR.scale.set(0.1, 1, hz.depth);
      hv.edgeL.position.x = -hz.halfWidth;
      hv.edgeR.position.x = hz.halfWidth;
      hv.column.visible = hz.firing;
      if (hz.firing) {
        hv.column.scale.set(w * (0.85 + Math.random() * 0.12), 6.2, hz.depth);
        hv.column.position.y = 3.1;
        hv.columnMat.opacity = 0.16 + Math.random() * 0.07;
      }
    }
  }

  // ---------------------------------------------------------------- camera
  private updateCamera(snap: SimSnapshot, dt: number, cinematic: boolean): void {
    this.camX += (snap.squadX * 0.34 - this.camX) * (1 - Math.exp(-Math.max(dt, 0.001) * 5.5));
    const bb = this.bossBlend;
    const y = CAM_BASE_Y + bb * 1.65 + (cinematic ? 1.1 : 0);
    const z = CAM_BASE_Z + bb * 1.9 + (cinematic ? 1.4 : 0);
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const sh = this.trauma * this.trauma;
    const sx = (Math.random() - 0.5) * sh * 1.05;
    const sy = (Math.random() - 0.5) * sh * 0.75;
    this.camera.position.set(this.camX + sx, y + sy, z);
    this.camera.lookAt(this.camX * 0.55, 0.3, -8.2 - bb * 2.2);
  }
}
