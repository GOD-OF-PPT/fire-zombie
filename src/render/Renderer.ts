import * as THREE from 'three';
import type {
  BarrelSnapshot,
  BossSnapshot,
  EnemyKind,
  GateSnapshot,
  PrismLensSnapshot,
  SectorId,
  SimSnapshot,
  VaultSnapshot,
  WeaponId,
} from '../types/game';
import { BLADES_ORBIT_RADIUS, PLAYER_Z, TRACK_HALF_WIDTH } from '../config/constants';
import { SECTORS } from '../config/sectors';
import { ENEMY_META, REWARD_META, SECTOR_META } from '../app/meta';
import { Effects } from './Effects';
import {
  COLORS,
  gateColors,
  gateTextureKey,
  makeCanvasTexture,
  makeGlowTexture,
  makeSkyTexture,
  makeStripeTexture,
  paintGatePlate,
  paintLensPlate,
  paintVaultPlate,
} from './textures';
import { InstancedRig, makeCharacterMaterial } from './models/rig';
import { buildBladeGeo, buildBoltGeo, buildRewardDisplayGeo, buildSoldierModels, type SoldierModel } from './models/soldiers';
import { buildMonsterModels, poseMonster, type MonsterModel } from './models/monsters';
import { buildBossRigs, type BossRig } from './models/bosses';
import { GeoBuilder, box, cyl, sph, tor } from './models/kit';

export const WEAPON_COLOR: Record<WeaponId, number> = {
  pulse: 0x3ef3ff,
  scatter: 0x7dff6b,
  rail: 0xc29bff,
  plasma: 0xff9a3c,
  cryo: 0x9fe6ff,
};

const TRACK_LEN = 150;
const TRACK_CENTER_Z = -60;
const MAX_DRONES = 48;
const MAX_PROJ = 900;
const MAX_ENEMY_PER_KIND = 72;
const MAX_SHADOWS = 320;
/** visual-only upscale of squad members so individual soldiers read on phones */
const SOLDIER_SCALE = 1.25;

const ENEMY_ANIM_SPEED: Record<EnemyKind, number> = { crawler: 11, dasher: 12, bastion: 4.5, mitosis: 4, siphon: 3 };
const ENEMY_BAR_H: Record<EnemyKind, number> = { crawler: 1.15, dasher: 1.4, bastion: 2.55, mitosis: 1.8, siphon: 2.2 };
const TINT_SLOW = new THREE.Color(0.62, 0.92, 1.55);

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
  core: THREE.Mesh;
  coreMat: THREE.MeshStandardMaterial;
  frame: THREE.Mesh;
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

interface BossView {
  rig: BossRig;
  pylons?: THREE.Group[];
  beams?: THREE.Mesh[];
  shield: THREE.Mesh;
  shield2?: THREE.Mesh;
}

function std(color: number, emissive = 0.5, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
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
    map: map ?? null,
    toneMapped: false,
  });
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 9 / 16, 0.5, 220);
  readonly effects = new Effects();
  private width = 1;
  private height = 1;
  private sector: SectorId = 1;
  private time = 0;

  // environment
  private trackMat!: THREE.ShaderMaterial;
  private groundMat!: THREE.ShaderMaterial;
  private railMat!: THREE.MeshBasicMaterial;
  private towers!: THREE.InstancedMesh;
  private towerCaps!: THREE.InstancedMesh;
  private towerCapMat!: THREE.MeshBasicMaterial;
  private towerData: Array<{ x: number; z: number; w: number; d: number; h: number }> = [];
  private posts!: THREE.InstancedMesh;
  private postMat!: THREE.MeshBasicMaterial;
  private hemi!: THREE.HemisphereLight;

  // squad
  private charMat!: THREE.MeshStandardMaterial;
  private soldierModels: SoldierModel[] = [];
  private soldierRigs: InstancedRig[] = [];
  private soldierWeapon: WeaponId | null = null;
  private droneCur: Array<{ x: number; z: number; s: number; alive: boolean; ph: number; vx: number }> = [];
  private squadGlow!: THREE.Mesh;
  private squadGlowMat!: THREE.MeshBasicMaterial;
  private blades!: THREE.InstancedMesh;
  private flashes!: THREE.InstancedMesh;
  private flashMat!: THREE.MeshBasicMaterial;
  private muzzleFlash = 0;
  private shadows!: THREE.InstancedMesh;
  private shadowCount = 0;
  private rot18 = new Float32Array(18);
  private off18 = new Float32Array(18);
  private rootM = new THREE.Matrix4();
  private rootQ = new THREE.Quaternion();
  private rootP = new THREE.Vector3();
  private rootS = new THREE.Vector3();
  private yAxis = new THREE.Vector3(0, 1, 0);
  private tint = new THREE.Color();

  // entities
  private monsterModels!: Record<EnemyKind, MonsterModel>;
  private enemyRigs = new Map<EnemyKind, InstancedRig>();
  private enemyPose = new Map<EnemyKind, { rot: Float32Array; scl: Float32Array; off: Float32Array }>();
  private enemyCounts: Record<EnemyKind, number> = { crawler: 0, dasher: 0, bastion: 0, mitosis: 0, siphon: 0 };
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
  private bossViews = new Map<BossSnapshot['id'], BossView>();
  private bossDeathT = -1;
  private bossHidden = false;

  // shared
  private glowTex = makeGlowTexture();
  private stripeTex = makeStripeTexture();
  private propMat = makeCharacterMaterial(0xbfe8ff, 0.35, 1.8);
  private rewardGeos = new Map<string, THREE.BufferGeometry>();
  private vaultFrameGeo!: THREE.BufferGeometry;
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
  private fov = 60;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(this.effects.group);

    const lensC = makeCanvasTexture(384, 112);
    paintLensPlate(lensC.ctx, 384, 112);
    lensC.tex.needsUpdate = true;
    this.lensTex = lensC.tex;

    this.buildLights();
    this.buildEnvironment();
    this.buildSquad();
    this.buildEnemies();
    this.buildProjectiles();
    this.buildHazards();
    this.buildBosses();
    this.setSector(1);
  }

  // ------------------------------------------------------------------ build
  private buildLights(): void {
    this.hemi = new THREE.HemisphereLight(0xbfdcff, 0x10061a, 1.4);
    this.scene.add(this.hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(4, 12, 8);
    this.scene.add(dir);
    // back light from down-track: rims the soldiers' silhouettes and the monsters' tops
    const back = new THREE.DirectionalLight(0x9fd8ff, 0.9);
    back.position.set(-3, 7, -14);
    this.scene.add(back);
  }

  private buildEnvironment(): void {
    // Track
    this.trackMat = new THREE.ShaderMaterial({
      uniforms: {
        uScroll: { value: 0 },
        uTime: { value: 0 },
        uTrack: { value: new THREE.Color(0x0b1126) },
        uGrid: { value: new THREE.Color(0x1f6dff) },
        uEdge: { value: new THREE.Color(0x3ef3ff) },
        uFog: { value: new THREE.Color(0x0a1640) },
        uHalf: { value: TRACK_HALF_WIDTH },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uScroll; uniform float uTime; uniform float uHalf;
        uniform vec3 uTrack; uniform vec3 uGrid; uniform vec3 uEdge; uniform vec3 uFog;
        varying vec3 vW;
        float line(float v, float w) { float f = abs(fract(v) - 0.5); return smoothstep(w, 0.0, 0.5 - f); }
        void main() {
          float zz = vW.z - uScroll;
          float ax = abs(vW.x);
          vec3 c = uTrack;
          // cross lines every 4u, lane marks
          float cross = line(zz / 4.0, 0.035);
          c += uGrid * cross * 0.35;
          float lanes = line((vW.x + uHalf) / (uHalf * 2.0 / 3.0), 0.012) * step(0.5, fract(zz / 6.0));
          c += uGrid * lanes * 0.25;
          // center seam
          c += uGrid * smoothstep(0.06, 0.0, ax) * 0.25;
          // chevrons scrolling
          float chev = fract((zz + ax * 0.9) / 10.0);
          c += uEdge * smoothstep(0.03, 0.0, abs(chev - 0.5)) * smoothstep(uHalf, uHalf - 1.2, ax) * smoothstep(uHalf - 2.2, uHalf - 1.4, ax) * 0.5;
          // edge glow
          float edge = smoothstep(uHalf - 0.35, uHalf, ax);
          c = mix(c, uEdge, edge * 0.85);
          float fog = smoothstep(18.0, 95.0, -vW.z);
          c = mix(c, uFog, fog);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const track = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_HALF_WIDTH * 2 + 0.2, TRACK_LEN), this.trackMat);
    track.rotation.x = -Math.PI / 2;
    track.position.z = TRACK_CENTER_Z;
    this.scene.add(track);

    this.groundMat = new THREE.ShaderMaterial({
      uniforms: {
        uScroll: { value: 0 },
        uGrid: { value: new THREE.Color(0x1f6dff) },
        uFog: { value: new THREE.Color(0x0a1640) },
        uBase: { value: new THREE.Color(0x03050c) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uScroll; uniform vec3 uGrid; uniform vec3 uFog; uniform vec3 uBase;
        varying vec3 vW;
        void main() {
          vec2 p = vec2(vW.x, vW.z - uScroll) / 3.0;
          vec2 g = abs(fract(p) - 0.5);
          float l = smoothstep(0.47, 0.5, max(g.x, g.y));
          vec3 c = uBase + uGrid * l * 0.18;
          float fog = smoothstep(10.0, 90.0, -vW.z + abs(vW.x) * 0.4);
          gl_FragColor = vec4(mix(c, uFog, fog), 1.0);
        }`,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, TRACK_LEN), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.6, TRACK_CENTER_Z);
    this.scene.add(ground);

    // track side walls (the runway is a raised data bridge)
    const wallMat = std(0x0a0f22, 0.05, { flatShading: false });
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, TRACK_LEN), wallMat);
      wall.position.set(s * (TRACK_HALF_WIDTH + 0.25), -0.25, TRACK_CENTER_Z);
      this.scene.add(wall);
    }
    this.railMat = new THREE.MeshBasicMaterial({ color: 0x3ef3ff, toneMapped: false });
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, TRACK_LEN), this.railMat);
      rail.position.set(s * (TRACK_HALF_WIDTH + 0.25), 0.18, TRACK_CENTER_Z);
      this.scene.add(rail);
    }
    // moving rail posts
    this.postMat = new THREE.MeshBasicMaterial({ color: 0x3ef3ff, toneMapped: false });
    this.posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.7, 0.16), this.postMat, 64);
    this.scene.add(this.posts);

    // skyline towers: lit window grids computed in the shader (no textures)
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    towerGeo.translate(0, 0.5, 0);
    this.towerMat = new THREE.ShaderMaterial({
      uniforms: {
        uBase: { value: new THREE.Color(0x0b1230) },
        uWinA: { value: new THREE.Color(0x3ef3ff) },
        uWinB: { value: new THREE.Color(0xff3fd2) },
        uFog: { value: new THREE.Color(0x0a1640) },
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
          vec3 c = uBase * (0.55 + 0.6 * clamp(vL.y / max(vH, 1.0), 0.0, 1.0));
          if (n.y < 0.5) {
            float u = (n.x > 0.5 ? vL.z : vL.x) / 0.55;
            float v = vL.y / 0.7;
            vec2 cell = floor(vec2(u, v));
            vec2 f = fract(vec2(u, v));
            float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.25, f.y) * step(f.y, 0.75);
            float h = hash(cell + vSeed);
            float lit = step(0.62, h) * win * step(0.6, vL.y);
            vec3 wc = mix(uWinA, uWinB, step(0.86, h));
            c += wc * lit * (0.55 + 0.45 * sin(uTime * 0.7 + h * 40.0));
            // thin vertical neon trims every few window columns
            c += uWinA * 0.3 * smoothstep(0.47, 0.5, abs(fract(u * 0.125) - 0.5));
          } else {
            c = uWinA * 0.25;
          }
          float fog = smoothstep(30.0, 112.0, -vW.z) * 0.85 + 0.1;
          gl_FragColor = vec4(mix(c, uFog, fog), 1.0);
        }`,
    });
    const n = 72;
    this.towers = new THREE.InstancedMesh(towerGeo, this.towerMat, n);
    this.towerCapMat = new THREE.MeshBasicMaterial({ color: 0x3ef3ff, toneMapped: false });
    this.towerCaps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 1), this.towerCapMat, n);
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.towerData.push({
        x: side * (7.5 + rnd() * 16),
        z: rnd() * 130,
        w: 1.5 + rnd() * 3,
        d: 1.5 + rnd() * 3,
        h: 1.5 + rnd() * rnd() * 22,
      });
    }
    this.towers.frustumCulled = false;
    this.towerCaps.frustumCulled = false;
    this.scene.add(this.towers, this.towerCaps);
  }

  private buildSquad(): void {
    // 「棱镜战士」: tier 1 trooper, tier 2 heavy trooper (=5), tier 3 Prism mech (=25)
    this.charMat = makeCharacterMaterial(0x7fe9ff, 0.6, 1.7, 0.22);
    this.soldierModels = buildSoldierModels();
    for (const model of this.soldierModels) {
      this.soldierRigs.push(new InstancedRig(model.parts, this.charMat, MAX_DRONES, this.scene));
    }
    for (let i = 0; i < MAX_DRONES; i++) this.droneCur.push({ x: 0, z: PLAYER_Z, s: 0, alive: false, ph: i * 0.37, vx: 0 });

    this.squadGlowMat = additive(0x3ef3ff, 0.5, this.glowTex);
    this.squadGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.squadGlowMat);
    this.squadGlow.rotation.x = -Math.PI / 2;
    this.squadGlow.position.y = 0.04;
    this.scene.add(this.squadGlow);

    // soft blob shadows under every character (soldiers + monsters), one draw call
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: this.glowTex, transparent: true, opacity: 0.55, depthWrite: false });
    this.shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMat, MAX_SHADOWS);
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.scene.add(this.shadows);

    this.blades = new THREE.InstancedMesh(buildBladeGeo(), this.charMat, 4);
    this.blades.count = 0;
    this.blades.frustumCulled = false;
    this.scene.add(this.blades);

    // per-soldier muzzle flashes (camera-facing additive sprites)
    this.flashMat = additive(0xffffff, 0.95, this.glowTex);
    this.flashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.flashMat, MAX_DRONES);
    this.flashes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DRONES * 3), 3);
    this.flashes.count = 0;
    this.flashes.frustumCulled = false;
    this.flashes.renderOrder = 3;
    this.scene.add(this.flashes);
  }

  private buildEnemies(): void {
    // 「故障病毒」 monsters: one multi-part instanced rig per kind
    const enemyMat = makeCharacterMaterial(0xff8ac0, 0.85, 1.9, 0.6);
    this.monsterModels = buildMonsterModels();
    for (const kind of Object.keys(this.monsterModels) as EnemyKind[]) {
      const model = this.monsterModels[kind];
      this.enemyRigs.set(kind, new InstancedRig(model.parts, enemyMat, MAX_ENEMY_PER_KIND, this.scene));
      const n = model.parts.length;
      this.enemyPose.set(kind, { rot: new Float32Array(n * 3), scl: new Float32Array(n), off: new Float32Array(n * 3) });
    }
    const barGeo = new THREE.PlaneGeometry(1, 0.16);
    const fgGeo = new THREE.PlaneGeometry(1, 0.16).translate(0.5, 0, 0);
    this.hpBg = new THREE.InstancedMesh(barGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7, depthWrite: false }), 64);
    this.hpFg = new THREE.InstancedMesh(fgGeo, new THREE.MeshBasicMaterial({ color: 0xff3b5c, toneMapped: false, depthWrite: false }), 64);
    this.hpBg.renderOrder = 5;
    this.hpFg.renderOrder = 6;
    this.hpBg.frustumCulled = this.hpFg.frustumCulled = false;
    this.hpBg.count = this.hpFg.count = 0;
    this.scene.add(this.hpBg, this.hpFg);

    const telGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.telegraphs = new THREE.InstancedMesh(telGeo, additive(0xffffff, 0.55, this.stripeTex), 24);
    this.telegraphs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24 * 3), 3);
    this.telegraphs.count = 0;
    this.telegraphs.frustumCulled = false;
    this.scene.add(this.telegraphs);

    const tGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Mesh(tGeo, additive(0xb04dff, 0.85));
      t.visible = false;
      this.tethers.push(t);
      this.scene.add(t);
    }
  }

  private buildProjectiles(): void {
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.projMesh = new THREE.InstancedMesh(buildBoltGeo(), mat, MAX_PROJ);
    this.projMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PROJ * 3), 3);
    this.projMesh.count = 0;
    this.projMesh.frustumCulled = false;
    this.scene.add(this.projMesh);

    this.orbMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.36, 1), new THREE.MeshBasicMaterial({ color: 0xff2a55, toneMapped: false }), 64);
    this.orbMesh.count = 0;
    this.orbMesh.frustumCulled = false;
    this.orbMarks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), additive(0xff2a55, 0.7, this.glowTex), 64);
    this.orbMarks.count = 0;
    this.orbMarks.frustumCulled = false;
    this.scene.add(this.orbMesh, this.orbMarks);
  }

  private buildHazards(): void {
    const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const group = new THREE.Group();
      const fillMat = additive(0xff2040, 0.18);
      const fill = new THREE.Mesh(flat, fillMat);
      const stripe = this.stripeTex.clone();
      stripe.needsUpdate = true;
      stripe.repeat.set(2, 10);
      const progressMat = additive(0xff2040, 0.55, stripe);
      const progress = new THREE.Mesh(flat, progressMat);
      const columnMat = additive(0xffd0d8, 0.0);
      const column = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), columnMat);
      const edgeMat = additive(0xff4060, 0.9);
      const edgeL = new THREE.Mesh(flat, edgeMat);
      const edgeR = new THREE.Mesh(flat, edgeMat);
      fill.position.y = 0.05;
      progress.position.y = 0.07;
      edgeL.position.y = edgeR.position.y = 0.08;
      group.add(fill, progress, column, edgeL, edgeR);
      group.visible = false;
      this.scene.add(group);
      this.hazardViews.push({ group, fill, fillMat, progress, progressMat, column, columnMat, edgeL, edgeR });
    }
  }

  private makeShield(r: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), additive(0x8ff6ff, 0.16));
    m.visible = false;
    return m;
  }

  private buildBosses(): void {
    const rigs = buildBossRigs();
    // WARDEN-01 赤棱守卫: crystal golem
    {
      const rig = rigs.warden_01;
      const shield = this.makeShield(3.4);
      shield.position.y = rig.coreHeight;
      rig.root.add(shield);
      rig.root.visible = false;
      this.scene.add(rig.root);
      this.bossViews.set('warden_01', { rig, shield });
    }
    // HYDRA-02 双生执政官: twin serpent heads (the cyan one splits off as the secondary core)
    {
      const rig = rigs.hydra_02;
      const shield = this.makeShield(2.8);
      shield.position.y = rig.coreHeight;
      rig.root.add(shield);
      const shield2 = this.makeShield(2.4);
      shield2.position.y = rig.secondaryCoreHeight ?? 3;
      rig.secondary!.add(shield2);
      rig.root.visible = false;
      rig.secondary!.visible = false;
      this.scene.add(rig.root, rig.secondary!);
      this.bossViews.set('hydra_02', { rig, shield, shield2 });
    }
    // OMEGA-ZERO 奇点主脑: giant eye + shield pylons (crystal obelisks)
    {
      const rig = rigs.omega_zero;
      const shield = this.makeShield(3.9);
      shield.position.y = rig.coreHeight;
      rig.root.add(shield);
      rig.root.visible = false;
      this.scene.add(rig.root);
      const crystalB = new GeoBuilder();
      crystalB
        .add(new THREE.OctahedronGeometry(0.9, 0), 0x3fa8c8, 0.5, { s: [1, 2.2, 1] })
        .add(new THREE.OctahedronGeometry(0.3, 0), 0xffffff, 2.0, { s: [1, 2.2, 1], p: [0, 0, 0.55] })
        .add(tor(1.1, 0.06, 4, 20), 0x8ff6ff, 2.6, { r: [Math.PI / 2, 0, 0], p: [0, -0.6, 0] });
      const crystalGeo = crystalB.build();
      const footB = new GeoBuilder();
      footB
        .add(cyl(0.9, 1.25, 0.45, 6), 0x1c0f24, 0, { p: [0, 0.22, 0] })
        .add(cyl(0.7, 0.9, 0.2, 6), 0x2c1236, 0, { p: [0, 0.55, 0] })
        .add(tor(1.0, 0.05, 4, 6), 0x8ff6ff, 2.4, { r: [Math.PI / 2, 0, 0], p: [0, 0.46, 0] });
      const footGeo = footB.build();
      const pylons: THREE.Group[] = [];
      const beams: THREE.Mesh[] = [];
      for (let i = 0; i < 2; i++) {
        const p = new THREE.Group();
        const crystal = new THREE.Mesh(crystalGeo, this.propMat);
        crystal.position.y = 2.1;
        const foot = new THREE.Mesh(footGeo, this.propMat);
        p.add(crystal, foot);
        p.visible = false;
        pylons.push(p);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2), additive(0x8ff6ff, 0.8));
        beam.visible = false;
        beams.push(beam);
        this.scene.add(p, beam);
      }
      this.bossViews.set('omega_zero', { rig, pylons, beams, shield });
    }
  }

  // ------------------------------------------------------------------ public API
  setSector(sector: SectorId): void {
    this.sector = sector;
    const pal = SECTOR_META[sector].palette;
    this.scene.background = makeSkyTexture(pal.sky);
    this.scene.fog = new THREE.Fog(pal.fog, 40, 120);
    (this.trackMat.uniforms.uTrack!.value as THREE.Color).set(pal.track);
    (this.trackMat.uniforms.uGrid!.value as THREE.Color).set(pal.grid);
    (this.trackMat.uniforms.uEdge!.value as THREE.Color).set(pal.edge);
    (this.trackMat.uniforms.uFog!.value as THREE.Color).set(pal.fog);
    (this.groundMat.uniforms.uGrid!.value as THREE.Color).set(pal.grid);
    (this.groundMat.uniforms.uFog!.value as THREE.Color).set(pal.fog);
    this.railMat.color.set(pal.edge);
    this.postMat.color.set(pal.edge);
    this.towerCapMat.color.set(pal.grid);
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    const aspect = this.width / this.height;
    this.camera.aspect = aspect;
    // keep ~12.8 world units of horizontal track visible at the squad's depth on any aspect
    const halfTan = 0.36 / aspect;
    this.fov = THREE.MathUtils.clamp((2 * Math.atan(halfTan) * 180) / Math.PI, 42, 72);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.effects.setViewportScale(this.height * this.renderer.getPixelRatio(), this.fov);
  }

  /** visible world width at the squad depth, for drag→world mapping */
  visibleWidthAtPlayer(): number {
    const d = 18;
    return 2 * d * Math.tan((this.fov * Math.PI) / 360) * this.camera.aspect;
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

  resetRun(): void {
    this.effects.clear();
    this.bossDeathT = -1;
    this.bossHidden = false;
    this.trauma = 0;
    for (const d of this.droneCur) {
      d.alive = false;
      d.s = 0;
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

  startBossDeath(x: number, z: number, color: number): void {
    this.bossDeathT = 0;
    this.bossHidden = false;
    const fx = this.effects;
    for (let i = 0; i < 7; i++) {
      fx.after(i * 0.16, () => {
        const ox = (Math.random() - 0.5) * 4;
        const oz = (Math.random() - 0.5) * 2;
        fx.burst(x + ox, 2 + Math.random() * 2, z + oz, i % 2 ? 0xffffff : color, 40, { speed: 9, size: 0.6, life: 0.7 });
        fx.ring(x + ox, z + oz, color, 3.5, 0.4);
        this.shake(0.25);
      });
    }
    fx.after(1.25, () => {
      this.bossHidden = true;
      fx.burst(x, 2.4, z, 0xffffff, 260, { speed: 22, size: 0.9, life: 1.3, up: 0.8, gravity: 6 });
      fx.burst(x, 2.4, z, color, 260, { speed: 15, size: 0.8, life: 1.6, up: 0.9, gravity: 4 });
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
    const scroll = snap.runwayProgress * sectorCfg.runwayLength;
    this.trackMat.uniforms.uScroll!.value = scroll;
    this.trackMat.uniforms.uTime!.value = t;
    this.groundMat.uniforms.uScroll!.value = scroll;
    this.towerMat.uniforms.uTime!.value = t;

    this.updateEnvironment(scroll);
    this.updateSquad(snap, dt, t);
    this.updateEnemies(snap, t);
    this.updateProjectiles(snap);
    this.updateGates(snap, dt, t);
    this.updateVaults(snap, t);
    this.updateBarrels(snap, t);
    this.updateLenses(snap, t);
    this.updateBoss(snap, dt, t);
    this.effects.update(dt);
    this.updateCamera(snap, dt, cinematic);
    this.renderer.render(this.scene, this.camera);
  }

  private updateEnvironment(scroll: number): void {
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
  }

  private pushShadow(x: number, z: number, r: number): void {
    if (this.shadowCount >= MAX_SHADOWS) return;
    const d = this.dummy;
    d.position.set(x, 0.03, z);
    d.rotation.set(0, 0, 0);
    d.scale.set(r * 2, 1, r * 2);
    d.updateMatrix();
    this.shadows.setMatrixAt(this.shadowCount++, d.matrix);
  }

  private updateSquad(snap: SimSnapshot, dt: number, t: number): void {
    this.shadowCount = 0;
    if (snap.weapon !== this.soldierWeapon) {
      // everyone visibly switches to the newly unlocked weapon model
      this.soldierWeapon = snap.weapon;
      this.soldierRigs.forEach((rig, i) => rig.setPartGeometry('gun', this.soldierModels[i]!.weapons[snap.weapon]));
    }
    const positions = snap.dronePositions;
    const follow = 1 - Math.exp(-dt * 16);
    const d = this.dummy;
    const overdrive = snap.overdriveTimer > 0;
    const wc = WEAPON_COLOR[snap.weapon];
    const camQuat = this.camera.quaternion;
    const rot = this.rot18;
    const off = this.off18;
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 12);
    let flashes = 0;
    for (const rig of this.soldierRigs) rig.begin();
    for (let i = 0; i < MAX_DRONES; i++) {
      const cur = this.droneCur[i]!;
      const target = positions[i];
      if (!target) {
        if (cur.alive) {
          cur.alive = false;
          cur.s = 0;
        }
        continue;
      }
      if (!cur.alive) {
        // new members "drop in" from the squad center
        cur.alive = true;
        cur.x = snap.squadX;
        cur.z = PLAYER_Z + 0.6;
        cur.s = 0.01;
        cur.vx = 0;
      }
      const px = cur.x;
      cur.x += (target.x - cur.x) * follow;
      cur.z += (target.z - cur.z) * follow;
      cur.vx += ((cur.x - px) / Math.max(dt, 1e-4) - cur.vx) * Math.min(1, dt * 10);
      cur.s += (1 - cur.s) * (1 - Math.exp(-dt * 10));
      const tierIdx = target.tier - 1;
      const model = this.soldierModels[tierIdx]!;
      const rig = this.soldierRigs[tierIdx]!;
      const mech = tierIdx === 2;
      cur.ph += dt * (mech ? 7 : 11);
      const sp = Math.sin(cur.ph);
      const legA = mech ? 0.45 : 0.75;
      rot.fill(0);
      off.fill(0);
      // parts: legL, legR, body, head, arms, gun
      rot[0] = sp * legA;
      rot[3] = -sp * legA;
      const bob = Math.abs(Math.cos(cur.ph)) * (mech ? 0.05 : 0.035) * model.scale;
      const bank = THREE.MathUtils.clamp(-cur.vx * 0.02, -0.12, 0.12);
      rot[6] = -0.05;
      rot[8] = bank;
      rot[9] = 0.04 + Math.sin(cur.ph * 0.5) * 0.03;
      rot[11] = bank * 0.5;
      const fl = this.muzzleFlash * (0.55 + 0.45 * Math.sin(i * 7.3 + t * 37));
      const recoil = fl * 0.06 * model.scale;
      rot[12] = -fl * 0.1;
      rot[15] = -fl * 0.1;
      for (let k = 2; k < 6; k++) off[k * 3 + 1] = bob;
      off[14] += recoil;
      off[17] += recoil;
      const s = cur.s * (overdrive ? 1.1 : 1) * SOLDIER_SCALE;
      this.rootP.set(cur.x, 0, cur.z);
      this.rootQ.setFromAxisAngle(this.yAxis, THREE.MathUtils.clamp(-cur.vx * 0.03, -0.4, 0.4));
      this.rootS.setScalar(s);
      this.rootM.compose(this.rootP, this.rootQ, this.rootS);
      const od = overdrive ? 0.35 + Math.sin(t * 20 + i) * 0.15 : 0;
      this.tint.setScalar(1 + (1 - cur.s) * 2.5 + od);
      rig.push(this.rootM, rot, this.tint, undefined, off);
      this.pushShadow(cur.x, cur.z, 0.26 * SOLDIER_SCALE * model.scale * (mech ? 2 : 1));

      if (fl > 0.08 && flashes < MAX_DRONES) {
        this.tmpV.set(model.muzzle[0], model.muzzle[1] + bob, model.muzzle[2] + recoil).applyMatrix4(this.rootM);
        d.position.copy(this.tmpV);
        d.quaternion.copy(camQuat);
        const fs = (mech ? 0.95 : 0.5) * (0.6 + fl * 0.6);
        d.scale.set(fs, fs, fs);
        d.updateMatrix();
        this.flashes.setMatrixAt(flashes, d.matrix);
        this.tmpColor.setHex(wc).multiplyScalar(0.4 + fl);
        this.flashes.setColorAt(flashes, this.tmpColor);
        flashes++;
      }
    }
    for (const rig of this.soldierRigs) rig.end();
    this.flashes.count = flashes;
    this.flashes.instanceMatrix.needsUpdate = true;
    if (this.flashes.instanceColor) this.flashes.instanceColor.needsUpdate = true;
    d.rotation.set(0, 0, 0);

    this.squadGlowMat.color.setHex(overdrive ? 0xffffff : wc);
    const gs = snap.formationRadius * 2.4 + 1.6 + (overdrive ? 0.8 : 0);
    this.squadGlow.scale.set(gs, gs, 1);
    this.squadGlow.position.set(snap.squadX, 0.04, PLAYER_Z - 0.1);
    this.squadGlow.visible = snap.squadCount > 0;
    this.squadGlowMat.opacity = 0.32 + (overdrive ? 0.25 : 0);

    // orbital blades
    const nb = snap.bladesCount;
    this.blades.count = nb;
    for (let i = 0; i < nb; i++) {
      const a = snap.bladesAngle + (i / nb) * Math.PI * 2;
      d.position.set(snap.squadX + Math.cos(a) * BLADES_ORBIT_RADIUS, 0.55, PLAYER_Z + Math.sin(a) * BLADES_ORBIT_RADIUS * 0.85);
      d.rotation.set(0.25, -a * 3 + t * 14, 0);
      d.scale.set(1.5, 1.5, 1.5);
      d.updateMatrix();
      this.blades.setMatrixAt(i, d.matrix);
    }
    this.blades.instanceMatrix.needsUpdate = true;
  }

  private updateEnemies(snap: SimSnapshot, t: number): void {
    const d = this.dummy;
    let bars = 0;
    let tels = 0;
    let tetherIdx = 0;
    const camQuat = this.camera.quaternion;
    for (const rig of this.enemyRigs.values()) rig.begin();
    for (const e of snap.enemies) {
      const rig = this.enemyRigs.get(e.kind)!;
      if (rig.size >= MAX_ENEMY_PER_KIND) continue;
      const model = this.monsterModels[e.kind];
      const pose = this.enemyPose.get(e.kind)!;
      const sc = e.radius / model.baseRadius;
      const hit = e.hitPulse;
      const tele = e.kind === 'dasher' && e.telegraphTimer > 0;
      const slowed = e.slowTimer > 0;
      const ph = t * ENEMY_ANIM_SPEED[e.kind] * (slowed ? 0.45 : 1) + e.id * 1.913;
      poseMonster(e.kind, ph, tele, pose.rot, pose.scl, pose.off);
      // monsters turn to face the squad
      const yaw = THREE.MathUtils.clamp(Math.atan2(snap.squadX - e.x, PLAYER_Z - e.z), -0.7, 0.7);
      const jitter = tele ? (Math.random() - 0.5) * 0.1 : 0;
      this.rootP.set(e.x + jitter, 0, e.z);
      this.rootQ.setFromAxisAngle(this.yAxis, yaw);
      const squash = 1 + hit * 0.18;
      this.rootS.set(sc * squash, sc * (1 - hit * 0.1), sc * squash);
      this.rootM.compose(this.rootP, this.rootQ, this.rootS);
      if (slowed) this.tint.copy(TINT_SLOW);
      else this.tint.setScalar(1);
      if (hit > 0) {
        const k = Math.min(1, hit * 0.9);
        this.tint.setRGB(this.tint.r + (3.2 - this.tint.r) * k, this.tint.g + (3.2 - this.tint.g) * k, this.tint.b + (3.2 - this.tint.b) * k);
      }
      rig.push(this.rootM, pose.rot, this.tint, pose.scl, pose.off);
      this.pushShadow(e.x, e.z, e.radius * (e.kind === 'siphon' ? 0.75 : 1.15));

      // HP bars on tougher enemies
      if (e.maxHp >= 40 && e.hp < e.maxHp && bars < 64) {
        const w = Math.max(0.9, e.radius * 2);
        const y = ENEMY_BAR_H[e.kind] * sc + 0.2;
        d.position.set(e.x, y, e.z);
        d.quaternion.copy(camQuat);
        d.scale.set(w + 0.08, 1.4, 1);
        d.updateMatrix();
        this.hpBg.setMatrixAt(bars, d.matrix);
        d.position.set(e.x - w / 2, y, e.z + 0.01);
        d.scale.set(Math.max(0.001, (w * e.hp) / e.maxHp), 1, 1);
        d.updateMatrix();
        this.hpFg.setMatrixAt(bars, d.matrix);
        bars++;
        d.rotation.set(0, 0, 0);
      }
      // Dasher lock-on lane telegraph
      if (tele && tels < 24) {
        d.rotation.set(0, 0, 0);
        d.position.set(e.x, 0.06, e.z);
        d.scale.set(e.radius * 2.2, 1, Math.max(1, PLAYER_Z + 3 - e.z));
        d.updateMatrix();
        this.telegraphs.setMatrixAt(tels, d.matrix);
        const pulse = 0.5 + 0.5 * Math.sin(t * 30);
        this.tmpColor.setRGB(1, 0.15 + pulse * 0.2, 0.2);
        this.tmpColor.multiplyScalar(0.6 + pulse * 0.4);
        this.telegraphs.setColorAt(tels, this.tmpColor);
        tels++;
      }
      // Siphon tether to the gate it drains
      if (e.kind === 'siphon' && e.linkedGateId !== null && tetherIdx < this.tethers.length) {
        const g = snap.gates.find((q) => q.id === e.linkedGateId && !q.triggered && !q.dimmed);
        if (g) {
          const tm = this.tethers[tetherIdx++]!;
          const from = this.tmpA.set(e.x, 1.25 * sc, e.z);
          const to = this.tmpB.set(g.x, 1.5, g.z);
          const len = from.distanceTo(to);
          tm.position.copy(from);
          tm.lookAt(to);
          tm.scale.set(1 + Math.sin(t * 25) * 0.4, 1 + Math.sin(t * 25) * 0.4, len);
          tm.visible = true;
        }
      }
    }
    for (const rig of this.enemyRigs.values()) rig.end();
    this.hpBg.count = this.hpFg.count = bars;
    this.hpBg.instanceMatrix.needsUpdate = this.hpFg.instanceMatrix.needsUpdate = true;
    this.telegraphs.count = tels;
    this.telegraphs.instanceMatrix.needsUpdate = true;
    if (this.telegraphs.instanceColor) this.telegraphs.instanceColor.needsUpdate = true;
    for (let i = tetherIdx; i < this.tethers.length; i++) this.tethers[i]!.visible = false;
    this.shadows.count = this.shadowCount;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  private updateProjectiles(snap: SimSnapshot): void {
    const d = this.dummy;
    let n = 0;
    let orbs = 0;
    for (const p of snap.projectiles) {
      if (p.hostile) {
        if (orbs >= 64) continue;
        d.position.set(p.x, 0.7, p.z);
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
      let sx = 0.1;
      let sz = 0.8;
      switch (p.weapon) {
        case 'scatter': sx = 0.13; sz = 0.55; break;
        case 'rail': sx = 0.15; sz = 2.4; break;
        case 'plasma': sx = 0.42; sz = 0.42; break;
        case 'cryo': sx = 0.12; sz = 1.0; break;
        default: break;
      }
      d.position.set(p.x, 0.55, p.z);
      d.rotation.set(p.weapon === 'plasma' ? this.time * 8 : 0, Math.atan2(p.vx, p.vz), 0);
      const amp = p.amplified ? 1.3 : 1;
      d.scale.set(sx * ps * amp, sx * ps * amp, sz * (0.8 + ps * 0.2) * amp);
      d.updateMatrix();
      this.projMesh.setMatrixAt(n, d.matrix);
      this.tmpColor.setHex(p.amplified ? 0xffe27a : WEAPON_COLOR[p.weapon]);
      this.projMesh.setColorAt(n, this.tmpColor);
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
    const postMat = std(0xffffff, 0.8);
    const postGeo = new THREE.BoxGeometry(0.24, 2.9, 0.24).translate(0, 1.45, 0);
    const postL = new THREE.Mesh(postGeo, postMat);
    const postR = new THREE.Mesh(postGeo, postMat);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1, 0.22, 0.24), postMat);
    beam.position.y = 2.9;
    const curtainMat = additive(0xffffff, 0.2);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.8).translate(0, 1.4, 0), curtainMat);
    const { ctx, tex } = makeCanvasTexture(512, 288);
    const plateMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1, 288 / 512), plateMat);
    plate.position.set(0, 1.55, 0.08);
    plate.rotation.x = -0.3;
    plate.renderOrder = 4;
    group.add(postL, postR, beam, curtain, plate);
    this.scene.add(group);
    return { id: -1, group, postMat, curtainMat, beam, postL, postR, curtain, plate, plateMat, ctx, tex, key: '', seen: false, fade: 1 };
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
    v.curtainMat.opacity = (0.16 + pulse * 0.12 + flip * 0.4 + Math.sin(t * 4 + g.id) * 0.03) * v.fade;
    v.plateMat.opacity = g.triggered ? v.fade : 1;
    const plateW = Math.min(w * 0.94, 4.8);
    const ps = plateW * (1 + pulse * 0.07 + flip * 0.18);
    v.plate.scale.set(ps, ps, 1);
    v.postMat.emissiveIntensity = 0.7 + flip * 1.5 + pulse * 0.4;
    const ts = g.triggered ? 1 + (1 - v.fade) * 0.4 : 1;
    v.group.scale.set(ts, ts, 1);
  }

  // ---------------------------------------------------------------- vaults
  private acquireVault(): VaultView {
    const pooled = this.vaultPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    if (!this.vaultFrameGeo) {
      const b = new GeoBuilder();
      b.add(cyl(1.12, 1.25, 0.3, 12), 0x1a2140, 0, { p: [0, 0.15, 0] })
        .add(cyl(1.0, 1.1, 0.12, 12), 0x2b3560, 0, { p: [0, 0.36, 0] })
        .add(tor(1.06, 0.045, 4, 24), 0xffffff, 2.2, { p: [0, 0.31, 0], r: [Math.PI / 2, 0, 0] })
        .add(cyl(1.0, 0.9, 0.22, 12), 0x1a2140, 0, { p: [0, 1.74, 0] })
        .add(tor(0.96, 0.04, 4, 24), 0xffffff, 2.2, { p: [0, 1.66, 0], r: [Math.PI / 2, 0, 0] })
        .add(sph(0.14, 8, 6), 0xffffff, 3, { p: [0, 1.9, 0] });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        b.add(box(0.12, 1.3, 0.12), 0x2b3560, 0, { p: [Math.cos(a) * 1.0, 1.0, Math.sin(a) * 1.0], r: [0, -a, 0] })
          .add(box(0.03, 1.1, 0.03), 0xffffff, 1.8, { p: [Math.cos(a) * 1.07, 1.0, Math.sin(a) * 1.07], r: [0, -a, 0] });
      }
      this.vaultFrameGeo = b.build();
    }
    const frame = new THREE.Mesh(this.vaultFrameGeo, this.propMat);
    const crystalMat = std(0xffffff, 0.35, { transparent: true, opacity: 0.32, metalness: 0.2, roughness: 0.1, flatShading: false, depthWrite: false });
    const crystal = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.3, 16, 1, true), crystalMat);
    crystal.position.y = 1.0;
    crystal.renderOrder = 2;
    const coreMat = makeCharacterMaterial(0xffffff, 0.6, 2.2);
    const core = new THREE.Mesh(buildRewardDisplayGeo('pulse'), coreMat);
    core.position.y = 1.0;
    const ringMat = additive(0xffffff, 0.5, this.glowTex);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.05;
    const { ctx, tex } = makeCanvasTexture(384, 192);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.3),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    plate.position.set(0, 2.75, 0);
    plate.rotation.x = -0.35;
    plate.renderOrder = 4;
    group.add(ring, frame, core, crystal, plate);
    this.scene.add(group);
    return { id: -1, group, crystal, crystalMat, core, coreMat, frame, ringMat, reward: '', plate, ctx, tex, key: '', seen: false };
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
    if (v.reward !== s.rewardWeapon) {
      v.reward = s.rewardWeapon;
      let geo = this.rewardGeos.get(s.rewardWeapon);
      if (!geo) {
        geo = buildRewardDisplayGeo(s.rewardWeapon);
        this.rewardGeos.set(s.rewardWeapon, geo);
      }
      v.core.geometry = geo;
    }
    const hp = s.hitPulse;
    v.crystalMat.color.set(meta.color);
    v.crystalMat.emissive.set(meta.color);
    v.crystalMat.emissiveIntensity = 0.3 + hp * 1.4;
    v.crystalMat.opacity = 0.3 + hp * 0.25;
    v.ringMat.color.set(meta.color);
    v.ringMat.opacity = 0.35 + Math.sin(t * 4 + s.id) * 0.1 + hp * 0.3;
    v.coreMat.emissive.setScalar(hp * 0.5);
    v.core.rotation.set(0.35, t * 1.6, Math.sin(t * 2) * 0.15);
    v.core.position.y = 1.0 + Math.sin(t * 3 + s.id) * 0.1;
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
      const ORANGE = 0xff8a1a;
      const DARK = 0x1a1208;
      b.add(cyl(0.6, 0.6, 1.2, 14), ORANGE, 0.25, { p: [0, 0.7, 0] })
        .add(cyl(0.64, 0.66, 0.16, 14), DARK, 0, { p: [0, 0.12, 0] })
        .add(cyl(0.63, 0.63, 0.1, 14), DARK, 0, { p: [0, 0.45, 0] })
        .add(cyl(0.63, 0.63, 0.1, 14), DARK, 0, { p: [0, 0.98, 0] })
        .add(cyl(0.5, 0.6, 0.14, 14), DARK, 0, { p: [0, 1.36, 0] })
        // glowing fuel window facing the squad
        .add(box(0.34, 0.36, 0.08), 0xfff06a, 2.8, { p: [0, 0.72, 0.58] })
        .add(box(0.34, 0.36, 0.08), 0xfff06a, 2.8, { p: [0, 0.72, -0.58] })
        // hazard chevrons
        .add(box(0.12, 0.05, 0.03), DARK, 0, { p: [-0.36, 0.72, 0.5], r: [0, 0.6, 0.6] })
        .add(box(0.12, 0.05, 0.03), DARK, 0, { p: [0.36, 0.72, 0.5], r: [0, -0.6, -0.6] })
        .add(cyl(0.05, 0.05, 0.22, 6), DARK, 0, { p: [0.28, 1.5, 0] });
      this.barrelGeo = b.build();
    }
    const bodyMat = makeCharacterMaterial(0xffc06a, 0.4, 1.6);
    const body = new THREE.Mesh(this.barrelGeo, bodyMat);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, toneMapped: false });
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lightMat);
    light.position.y = 1.5;
    const ringMat = additive(0xff9a1a, 0.4);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.05;
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2), additive(0xff9a1a, 0.05));
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
    v.ring.scale.set(b.blastRadius, 1, b.blastRadius);
    v.fill.scale.set(b.blastRadius, 1, b.blastRadius);
    v.ringMat.opacity = 0.3 + Math.sin(t * 6 + b.id) * 0.12;
    const dmg = 1 - b.hp / 15;
    v.bodyMat.emissive.setRGB(1, 0.55, 0.1).multiplyScalar(b.hitPulse * 0.8 + dmg * 0.25);
    const blink = Math.sin(t * (6 + dmg * 18) + b.id) > 0 ? 1 : 0.25;
    v.lightMat.color.setRGB(1 * blink + b.hitPulse, 0.23 * blink + b.hitPulse, 0.23 * blink + b.hitPulse);
    const s = 1 + b.hitPulse * 0.15;
    v.body.scale.set(s, s, s);
    v.light.position.y = 1.5 * s;
  }

  // ---------------------------------------------------------------- lenses
  private acquireLens(): LensView {
    const pooled = this.lensPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    const frameMat = std(0xffc531, 0.9, { metalness: 0.8 });
    const postGeo = new THREE.BoxGeometry(0.16, 2.2, 0.16).translate(0, 1.1, 0);
    const l = new THREE.Mesh(postGeo, frameMat);
    const r = new THREE.Mesh(postGeo, frameMat);
    l.name = 'l';
    r.name = 'r';
    const paneMat = additive(0xffd84a, 0.28);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.0).translate(0, 1.1, 0), paneMat);
    pane.name = 'pane';
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.76),
      new THREE.MeshBasicMaterial({ map: this.lensTex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    label.position.set(0, 2.75, 0);
    label.rotation.x = -0.35;
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
    v.paneMat.opacity = 0.22 + s.pulse * 0.5 + Math.sin(t * 5) * 0.05;
  }

  // ---------------------------------------------------------------- boss
  private updateBoss(snap: SimSnapshot, dt: number, t: number): void {
    const b = snap.boss;
    for (const [id, view] of this.bossViews) {
      if (!b || b.id !== id) {
        view.rig.root.visible = false;
        if (view.rig.secondary) view.rig.secondary.visible = false;
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
    const view = this.bossViews.get(b.id)!;
    const rig = view.rig;
    if (this.bossDeathT >= 0) this.bossDeathT += dt;
    const dying = !b.active;
    const show = !this.bossHidden;
    rig.root.visible = show;
    const jitter = dying ? (Math.random() - 0.5) * 0.5 : 0;
    const intro = b.introProgress;
    // the creature rises out of the data floor during its intro and sinks/shrinks while dying
    const rise = -(1 - intro) * 5;
    const deathK = dying ? Math.max(0.2, 1 - this.bossDeathT * 0.3) : 1;
    rig.root.position.set(b.x + jitter, rise, b.z + jitter);
    rig.root.scale.setScalar((0.75 + 0.25 * intro) * deathK);
    const flash = b.hitPulse;
    const sc = b.secondaryCore ?? null;
    rig.update({ t, dt, phase: b.phase, flash, dying, squadX: snap.squadX, x: b.x, z: b.z, secondary: sc ? { x: sc.x, z: sc.z } : null });
    view.shield.visible = show && b.shielded && b.active;
    view.shield.rotation.y = t;
    (view.shield.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(t * 8) * 0.05 + flash * 0.1;
    const coreY = rise + rig.coreHeight * (0.75 + 0.25 * intro);

    if (rig.secondary) {
      rig.secondary.visible = Boolean(sc) && show;
      if (sc) {
        rig.secondary.position.set(sc.x, rise, sc.z);
        rig.secondary.scale.setScalar(rig.root.scale.x);
        if (view.shield2) view.shield2.visible = sc.shielded;
      }
    }
    if (view.pylons && view.beams) {
      for (let i = 0; i < view.pylons.length; i++) {
        const p = b.pylons[i];
        const pv = view.pylons[i]!;
        const beam = view.beams[i]!;
        if (p && !p.destroyed && b.active) {
          pv.visible = true;
          pv.position.set(p.x, 0, p.z);
          pv.children[0]!.rotation.y = t * 2;
          const from = this.tmpA.set(p.x, 2.6, p.z);
          const to = this.tmpB.set(b.x, coreY, b.z);
          beam.position.copy(from);
          beam.lookAt(to);
          beam.scale.set(1 + Math.sin(t * 30) * 0.5, 1 + Math.sin(t * 30) * 0.5, from.distanceTo(to));
          beam.visible = true;
        } else {
          pv.visible = false;
          beam.visible = false;
        }
      }
    }

    // telegraphed hazard lanes
    for (let i = 0; i < b.hazardZones.length && i < this.hazardViews.length; i++) {
      const hz = b.hazardZones[i]!;
      const hv = this.hazardViews[i]!;
      hv.group.visible = true;
      const w = hz.halfWidth * 2;
      hv.group.position.set(hz.x, 0, hz.z);
      hv.fill.scale.set(w, 1, hz.depth);
      hv.fillMat.opacity = hz.firing ? 0.5 : 0.1 + hz.warningProgress * 0.15;
      // progress fills from the far end toward the squad
      const pz = Math.max(0.001, hz.warningProgress);
      hv.progress.scale.set(w, 1, hz.depth * pz);
      hv.progress.position.z = -hz.depth / 2 + (hz.depth * pz) / 2;
      hv.progressMat.opacity = hz.firing ? 0.9 : 0.35 + hz.warningProgress * 0.3;
      const map = hv.progressMat.map;
      if (map) map.offset.y = -t * 2;
      hv.edgeL.scale.set(0.1, 1, hz.depth);
      hv.edgeR.scale.set(0.1, 1, hz.depth);
      hv.edgeL.position.x = -hz.halfWidth;
      hv.edgeR.position.x = hz.halfWidth;
      hv.column.visible = hz.firing;
      if (hz.firing) {
        hv.column.scale.set(w * (0.85 + Math.random() * 0.15), 7, hz.depth);
        hv.column.position.y = 3.5;
        hv.columnMat.opacity = 0.45 + Math.random() * 0.2;
      }
    }
  }

  // ---------------------------------------------------------------- camera
  private updateCamera(snap: SimSnapshot, dt: number, cinematic: boolean): void {
    this.camX += (snap.squadX * 0.32 - this.camX) * (1 - Math.exp(-dt * 5));
    const bb = this.bossBlend;
    const y = 12.6 + bb * 1.6 + (cinematic ? 1.2 : 0);
    const z = 18.2 + bb * 1.8 + (cinematic ? 1.5 : 0);
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const sh = this.trauma * this.trauma;
    const sx = (Math.random() - 0.5) * sh * 1.1;
    const sy = (Math.random() - 0.5) * sh * 0.8;
    this.camera.position.set(this.camX + sx, y + sy, z);
    this.camera.lookAt(this.camX * 0.55, 0, -8 - bb * 2);
  }
}
