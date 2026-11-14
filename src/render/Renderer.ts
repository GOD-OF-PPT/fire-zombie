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

const COLOR_SLOW = new THREE.Color(0x9fe6ff);
const COLOR_WHITE = new THREE.Color(0xffffff);

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
  coreMat: THREE.MeshBasicMaterial;
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
  root: THREE.Group;
  body: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  spinners: THREE.Object3D[];
  secondary?: THREE.Group;
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
  private droneMeshes: THREE.InstancedMesh[] = [];
  private droneMats: THREE.MeshStandardMaterial[] = [];
  private droneCur: Array<{ x: number; z: number; s: number; alive: boolean }> = [];
  private squadGlow!: THREE.Mesh;
  private squadGlowMat!: THREE.MeshBasicMaterial;
  private blades!: THREE.InstancedMesh;
  private muzzle!: THREE.Mesh;
  private muzzleMat!: THREE.MeshBasicMaterial;
  private muzzleFlash = 0;

  // entities
  private enemyMeshes = new Map<EnemyKind, THREE.InstancedMesh>();
  private enemyBaseRadius: Record<EnemyKind, number> = { crawler: 0.48, dasher: 0.58, bastion: 1.15, mitosis: 0.72, siphon: 0.68 };
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

    // skyline towers
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    towerGeo.translate(0, 0.5, 0);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x0b1230, roughness: 0.8, metalness: 0.2, emissive: 0x050a20, emissiveIntensity: 1 });
    const n = 72;
    this.towers = new THREE.InstancedMesh(towerGeo, towerMat, n);
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
    this.scene.add(this.towers, this.towerCaps);
  }

  private buildSquad(): void {
    const geos = [
      new THREE.ConeGeometry(0.15, 0.48, 3),
      new THREE.ConeGeometry(0.22, 0.66, 4),
      new THREE.OctahedronGeometry(0.36, 0),
    ];
    geos[0]!.rotateX(-Math.PI / 2);
    geos[1]!.rotateX(-Math.PI / 2);
    geos[2]!.scale(1, 0.55, 1.5);
    const colors = [0x3ef3ff, 0x9ffcff, 0xffe27a];
    for (let t = 0; t < 3; t++) {
      const mat = std(colors[t]!, t === 2 ? 0.9 : 0.6, { metalness: 0.4 });
      const m = new THREE.InstancedMesh(geos[t]!, mat, MAX_DRONES);
      m.frustumCulled = false;
      m.count = 0;
      this.droneMats.push(mat);
      this.droneMeshes.push(m);
      this.scene.add(m);
    }
    for (let i = 0; i < MAX_DRONES; i++) this.droneCur.push({ x: 0, z: PLAYER_Z, s: 0, alive: false });

    this.squadGlowMat = additive(0x3ef3ff, 0.5, this.glowTex);
    this.squadGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.squadGlowMat);
    this.squadGlow.rotation.x = -Math.PI / 2;
    this.squadGlow.position.y = 0.04;
    this.scene.add(this.squadGlow);

    const bladeGeo = new THREE.OctahedronGeometry(0.42, 0);
    bladeGeo.scale(1, 0.18, 0.45);
    this.blades = new THREE.InstancedMesh(bladeGeo, std(0xffd84a, 1.0, { metalness: 0.7 }), 4);
    this.blades.count = 0;
    this.blades.frustumCulled = false;
    this.scene.add(this.blades);

    this.muzzleMat = additive(0x3ef3ff, 0, this.glowTex);
    this.muzzle = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.muzzleMat);
    this.muzzle.rotation.x = -Math.PI / 2;
    this.scene.add(this.muzzle);
  }

  private buildEnemies(): void {
    const defs: Array<[EnemyKind, THREE.BufferGeometry]> = [
      ['crawler', new THREE.IcosahedronGeometry(0.48, 0)],
      ['dasher', new THREE.ConeGeometry(0.58, 1.35, 4).rotateX(Math.PI / 2)],
      ['bastion', new THREE.BoxGeometry(2.3, 1.7, 0.75)],
      ['mitosis', new THREE.DodecahedronGeometry(0.72, 0)],
      ['siphon', new THREE.TorusGeometry(0.48, 0.18, 6, 12)],
    ];
    for (const [kind, geo] of defs) {
      const mat = std(0xffffff, 0.55, { metalness: 0.2 });
      const m = new THREE.InstancedMesh(geo, mat, MAX_ENEMY_PER_KIND);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ENEMY_PER_KIND * 3), 3);
      m.count = 0;
      m.frustumCulled = false;
      this.enemyMeshes.set(kind, m);
      this.scene.add(m);
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
    this.projMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX_PROJ);
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
    // WARDEN-01: red crystal fortress with orbiting shards
    {
      const root = new THREE.Group();
      const body = new THREE.Group();
      const coreMat = std(0xff2a4a, 0.7, { metalness: 0.5 });
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.7, 0), coreMat);
      core.scale.set(1, 1.25, 1);
      const armMat = std(0x5a0a1c, 0.35, { metalness: 0.7 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.16, 6, 24), std(0xff6a3c, 0.8));
      ring.rotation.x = Math.PI / 2;
      const spin = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.62, 0), armMat);
        const a = (i / 4) * Math.PI * 2;
        shard.position.set(Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6);
        spin.add(shard);
      }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 0.5, 8), armMat);
      base.position.y = -1.9;
      body.add(core, ring, spin, base);
      const shield = this.makeShield(3.2);
      root.add(body, shield);
      root.visible = false;
      this.scene.add(root);
      this.bossViews.set('warden_01', { root, body, mats: [coreMat, armMat], spinners: [spin, ring], shield });
    }
    // HYDRA-02: twin-headed executor
    {
      const root = new THREE.Group();
      const body = new THREE.Group();
      const headMat = std(0xff3fd2, 0.7, { metalness: 0.5 });
      const head = new THREE.Mesh(new THREE.DodecahedronGeometry(1.5, 0), headMat);
      const crown = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.12, 6, 20), std(0xffd84a, 0.9));
      crown.rotation.x = Math.PI / 2.4;
      const fins = new THREE.Group();
      const finMat = std(0x3a0b46, 0.3, { metalness: 0.8 });
      for (let i = 0; i < 6; i++) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 3), finMat);
        const a = (i / 6) * Math.PI * 2;
        fin.position.set(Math.cos(a) * 1.9, Math.sin(a) * 1.9, 0);
        fin.rotation.z = a - Math.PI / 2;
        fins.add(fin);
      }
      body.add(head, crown, fins);
      const shield = this.makeShield(2.6);
      const secondary = new THREE.Group();
      const head2Mat = std(0x5fd8ff, 0.8, { metalness: 0.5 });
      const head2 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2, 0), head2Mat);
      const crown2 = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.1, 6, 20), std(0xffd84a, 0.9));
      crown2.rotation.x = Math.PI / 2.4;
      const shield2 = this.makeShield(2.2);
      secondary.add(head2, crown2, shield2);
      secondary.visible = false;
      root.add(body, shield);
      root.visible = false;
      this.scene.add(root, secondary);
      this.bossViews.set('hydra_02', { root, body, mats: [headMat, finMat, head2Mat], spinners: [crown, fins, crown2], secondary, shield, shield2 });
    }
    // OMEGA-ZERO: singularity core with gyroscope rings + shield pylons
    {
      const root = new THREE.Group();
      const body = new THREE.Group();
      const coreMat = std(0xffc531, 0.8, { metalness: 0.8 });
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 1), coreMat);
      const darkMat = std(0x220510, 0.25, { metalness: 0.9 });
      const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 0), darkMat);
      (inner.material as THREE.MeshStandardMaterial).wireframe = true;
      const spinners: THREE.Object3D[] = [inner];
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(2.7 + i * 0.45, 0.08, 6, 36), std(i === 1 ? 0xff3355 : 0xffc531, 0.9));
        r.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        body.add(r);
        spinners.push(r);
      }
      body.add(core, inner);
      const shield = this.makeShield(3.3);
      root.add(body, shield);
      root.visible = false;
      const pylons: THREE.Group[] = [];
      const beams: THREE.Mesh[] = [];
      const pylonMat = std(0x8ff6ff, 0.8, { metalness: 0.6 });
      for (let i = 0; i < 2; i++) {
        const p = new THREE.Group();
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), pylonMat);
        crystal.scale.set(1, 2.2, 1);
        crystal.position.y = 1.8;
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 0.4, 6), darkMat);
        foot.position.y = 0.2;
        p.add(crystal, foot);
        p.visible = false;
        pylons.push(p);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2), additive(0x8ff6ff, 0.8));
        beam.visible = false;
        beams.push(beam);
        this.scene.add(p, beam);
      }
      this.scene.add(root);
      this.bossViews.set('omega_zero', { root, body, mats: [coreMat, darkMat, pylonMat], spinners, pylons, beams, shield });
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

  private updateSquad(snap: SimSnapshot, dt: number, t: number): void {
    const positions = snap.dronePositions;
    const follow = 1 - Math.exp(-dt * 16);
    const counts = [0, 0, 0];
    const d = this.dummy;
    const overdrive = snap.overdriveTimer > 0;
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
        // new drones "fly in" from the squad center
        cur.alive = true;
        cur.x = snap.squadX;
        cur.z = PLAYER_Z + 0.6;
        cur.s = 0.01;
      }
      cur.x += (target.x - cur.x) * follow;
      cur.z += (target.z - cur.z) * follow;
      cur.s += (1 - cur.s) * (1 - Math.exp(-dt * 10));
      const tierIdx = target.tier - 1;
      const mesh = this.droneMeshes[tierIdx]!;
      const bob = Math.sin(t * 6 + i * 1.7) * 0.06;
      d.position.set(cur.x, 0.45 + bob + tierIdx * 0.12, cur.z);
      d.rotation.set(0, 0, Math.sin(t * 3 + i) * 0.15 + (snap.squadX - cur.x) * 0.1);
      const s = cur.s * (overdrive ? 1.12 : 1);
      d.scale.set(s, s, s);
      d.updateMatrix();
      mesh.setMatrixAt(counts[tierIdx]!, d.matrix);
      counts[tierIdx]! += 1;
    }
    for (let ti = 0; ti < 3; ti++) {
      const mesh = this.droneMeshes[ti]!;
      mesh.count = counts[ti]!;
      mesh.instanceMatrix.needsUpdate = true;
      this.droneMats[ti]!.emissiveIntensity = (ti === 2 ? 0.9 : 0.6) + (overdrive ? 0.6 + Math.sin(t * 20) * 0.2 : 0);
    }
    const wc = WEAPON_COLOR[snap.weapon];
    this.squadGlowMat.color.setHex(overdrive ? 0xffffff : wc);
    const gs = snap.formationRadius * 2.4 + 1.6 + (overdrive ? 0.8 : 0);
    this.squadGlow.scale.set(gs, gs, 1);
    this.squadGlow.position.set(snap.squadX, 0.04, PLAYER_Z - 0.1);
    this.squadGlow.visible = snap.squadCount > 0;
    this.squadGlowMat.opacity = 0.45 + (overdrive ? 0.25 : 0);

    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 14);
    this.muzzleMat.color.setHex(wc);
    this.muzzleMat.opacity = this.muzzleFlash * 0.8;
    const ms = 1.2 + snap.formationRadius;
    this.muzzle.scale.set(ms, ms * 0.7, 1);
    this.muzzle.position.set(snap.squadX, 0.6, PLAYER_Z - snap.formationRadius - 0.6);

    // orbital blades
    const nb = snap.bladesCount;
    this.blades.count = nb;
    for (let i = 0; i < nb; i++) {
      const a = snap.bladesAngle + (i / nb) * Math.PI * 2;
      d.position.set(snap.squadX + Math.cos(a) * BLADES_ORBIT_RADIUS, 0.55, PLAYER_Z + Math.sin(a) * BLADES_ORBIT_RADIUS * 0.85);
      d.rotation.set(0, -a * 3 + t * 12, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this.blades.setMatrixAt(i, d.matrix);
    }
    this.blades.instanceMatrix.needsUpdate = true;
  }

  private updateEnemies(snap: SimSnapshot, t: number): void {
    const counts = new Map<EnemyKind, number>();
    const d = this.dummy;
    let bars = 0;
    let tels = 0;
    let tetherIdx = 0;
    const camQuat = this.camera.quaternion;
    for (const e of snap.enemies) {
      const mesh = this.enemyMeshes.get(e.kind)!;
      const idx = counts.get(e.kind) ?? 0;
      if (idx >= MAX_ENEMY_PER_KIND) continue;
      counts.set(e.kind, idx + 1);
      const sc = e.radius / this.enemyBaseRadius[e.kind];
      const wob = Math.sin(t * 9 + e.id) * 0.08;
      const hit = e.hitPulse;
      switch (e.kind) {
        case 'crawler':
          d.position.set(e.x, e.radius + Math.abs(Math.sin(t * 12 + e.id)) * 0.18, e.z);
          d.rotation.set(t * 4 + e.id, t * 3, 0);
          d.scale.setScalar(sc * (1 + hit * 0.25));
          break;
        case 'dasher':
          d.position.set(e.x, 0.65, e.z);
          d.rotation.set(0, 0, t * (e.telegraphTimer > 0 ? 30 : 6));
          d.scale.setScalar(sc * (1 + hit * 0.2));
          break;
        case 'bastion':
          d.position.set(e.x, 0.85 + wob * 0.3, e.z);
          d.rotation.set(0, 0, 0);
          d.scale.set(sc * (1 + hit * 0.06), sc, sc);
          break;
        case 'mitosis': {
          const p = 1 + Math.sin(t * 7 + e.id) * 0.08;
          d.position.set(e.x, e.radius + 0.1, e.z);
          d.rotation.set(t * 1.5, t * 2 + e.id, 0);
          d.scale.setScalar(sc * p * (1 + hit * 0.2));
          break;
        }
        case 'siphon':
          d.position.set(e.x, 1.1 + wob, e.z);
          d.rotation.set(0, t * 3, 0);
          d.scale.setScalar(sc * (1 + hit * 0.2));
          break;
      }
      d.updateMatrix();
      mesh.setMatrixAt(idx, d.matrix);
      this.tmpColor.setHex(ENEMY_META[e.kind].color);
      if (e.slowTimer > 0) this.tmpColor.lerp(COLOR_SLOW, 0.55);
      if (hit > 0) this.tmpColor.lerp(COLOR_WHITE, Math.min(1, hit * 0.9));
      mesh.setColorAt(idx, this.tmpColor);

      // HP bars on tougher enemies
      if (e.maxHp >= 40 && e.hp < e.maxHp && bars < 64) {
        const w = Math.max(0.9, e.radius * 2);
        const y = e.kind === 'bastion' ? 2.1 : e.kind === 'siphon' ? 2.0 : e.radius * 2 + 0.55;
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
      if (e.kind === 'dasher' && e.telegraphTimer > 0 && tels < 24) {
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
          const from = this.tmpA.set(e.x, 1.1, e.z);
          const to = this.tmpB.set(g.x, 1.5, g.z);
          const len = from.distanceTo(to);
          tm.position.copy(from);
          tm.lookAt(to);
          tm.scale.set(1 + Math.sin(t * 25) * 0.4, 1 + Math.sin(t * 25) * 0.4, len);
          tm.visible = true;
        }
      }
    }
    for (const [kind, mesh] of this.enemyMeshes) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
    const crystalMat = std(0xffffff, 0.45, { transparent: true, opacity: 0.72, metalness: 0.6 });
    const crystal = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 1.3, 6), crystalMat);
    crystal.position.y = 0.9;
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), coreMat);
    core.position.y = 0.9;
    const { ctx, tex } = makeCanvasTexture(384, 192);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.3),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    plate.position.set(0, 2.55, 0);
    plate.rotation.x = -0.35;
    plate.renderOrder = 4;
    group.add(crystal, core, plate);
    this.scene.add(group);
    return { id: -1, group, crystal, crystalMat, core, coreMat, plate, ctx, tex, key: '', seen: false };
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
    v.crystalMat.color.set(meta.color);
    v.crystalMat.emissive.set(meta.color);
    v.crystalMat.emissiveIntensity = 0.35 + s.hitPulse * 1.2;
    v.coreMat.color.set(s.hitPulse > 0.5 ? '#ffffff' : meta.color);
    v.crystal.rotation.y = t * 1.2;
    v.core.rotation.set(t * 2, t * 3, 0);
    const sc = 1 + s.hitPulse * 0.1;
    v.crystal.scale.set(sc, sc, sc);
    v.crystal.position.y = 0.9 + Math.sin(t * 3 + s.id) * 0.12;
  }

  // ---------------------------------------------------------------- barrels
  private acquireBarrel(): BarrelView {
    const pooled = this.barrelPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    const bodyMat = std(0xffa21a, 0.55, { metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.3, 12), bodyMat);
    body.position.y = 0.65;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.07, 6, 16), std(0x201005, 0.1));
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.65;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 8), new THREE.MeshBasicMaterial({ color: 0xfff2a0, toneMapped: false }));
    cap.position.y = 1.38;
    const ringMat = additive(0xff9a1a, 0.4);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.05;
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2), additive(0xff9a1a, 0.05));
    fill.position.y = 0.04;
    group.add(body, band, cap, ring, fill);
    this.scene.add(group);
    return { id: -1, group, body, bodyMat, ring, fill, ringMat, seen: false };
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
    v.bodyMat.emissiveIntensity = 0.5 + b.hitPulse * 1.5 + (1 - b.hp / 15) * 0.6;
    const s = 1 + b.hitPulse * 0.15;
    v.body.scale.set(s, s, s);
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
        view.root.visible = false;
        if (view.secondary) view.secondary.visible = false;
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
    if (this.bossDeathT >= 0) this.bossDeathT += dt;
    const dying = !b.active;
    const show = !this.bossHidden;
    view.root.visible = show;
    const jitter = dying ? (Math.random() - 0.5) * 0.5 : 0;
    const hover = 2.3 + Math.sin(t * 1.8) * 0.25;
    view.root.position.set(b.x + jitter, hover, b.z + jitter);
    const intro = b.introProgress;
    // 1.2x keeps the core silhouette aligned with the sim hit half-width (~2.1)
    const scl = 1.2 * (0.4 + 0.6 * intro) * (dying ? Math.max(0.2, 1 - this.bossDeathT * 0.3) : 1);
    view.root.scale.setScalar(scl);
    const flash = b.hitPulse;
    const phaseHeat = b.phase - 1;
    view.mats.forEach((m, i) => {
      if (i === 0) m.emissiveIntensity = 0.6 + flash * 0.9 + phaseHeat * 0.35 + (dying ? Math.random() * 2 : 0);
    });
    const spinRate = 1 + phaseHeat * 0.8;
    view.spinners.forEach((s, i) => {
      s.rotation.y += dt * spinRate * (i % 2 ? -1.3 : 1);
      if (b.id === 'omega_zero') s.rotation.x += dt * 0.6 * (i + 1) * spinRate;
    });
    view.body.rotation.y = Math.sin(t * 0.7) * 0.3;
    view.shield.visible = show && b.shielded && b.active;
    view.shield.rotation.y = t;
    (view.shield.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(t * 8) * 0.05 + flash * 0.1;

    if (view.secondary) {
      const sc = b.secondaryCore;
      view.secondary.visible = Boolean(sc) && show;
      if (sc) {
        view.secondary.position.set(sc.x, 2.1 + Math.cos(t * 1.8) * 0.25, sc.z);
        view.secondary.rotation.y = -t * 0.8;
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
          const from = this.tmpA.set(p.x, 2.2, p.z);
          const to = this.tmpB.set(b.x, hover, b.z);
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
