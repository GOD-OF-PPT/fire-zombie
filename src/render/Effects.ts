import * as THREE from 'three';

const MAX_PARTICLES = 4800;
const MAX_RINGS = 64;
const MAX_ARCS = 32;
const MAX_ARC_SEGS = MAX_ARCS * 3;
const MAX_STREAKS = 320;
const MAX_SHARDS = 380;
const MAX_FLASH_POOLS = 48;

interface RingSlot {
  x: number;
  z: number;
  r: number;
  g: number;
  b: number;
  t: number;
  dur: number;
  r0: number;
  r1: number;
  alive: boolean;
}

interface FlashSlot {
  x: number;
  z: number;
  r: number;
  g: number;
  b: number;
  t: number;
  dur: number;
  rad: number;
  alive: boolean;
}

interface ArcSlot {
  p0x: number; p0y: number; p0z: number;
  p1x: number; p1y: number; p1z: number;
  p2x: number; p2y: number; p2z: number;
  p3x: number; p3y: number; p3z: number;
  r: number;
  g: number;
  b: number;
  t: number;
  dur: number;
  alive: boolean;
}

interface Timed {
  at: number;
  fn: () => void;
}

function makeRadialFlashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, 'rgba(255,255,255,1.0)');
    g.addColorStop(0.28, 'rgba(255,255,255,0.68)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/**
 * V19 Zero-GC GPU-Instanced VFX Suite (6 Total Draw Calls for Thousands of Concurrent Effects):
 *  1) Additive Core Particle Points (`THREE.Points`)
 *  2) Velocity-Aligned Ballistic Spark Streaks (`InstancedMesh`)
 *  3) 3D Tumbling Faceted Armor/Chitin/Crystal Shards (`InstancedMesh`)
 *  4) Expanding Shockwave Rings (`InstancedMesh` — collapses 64 meshes into 1 draw call!)
 *  5) Ground Impact Flash Pools (`InstancedMesh` — collapses 48 meshes into 1 draw call!)
 *  6) Jagged 3D Chain-Lightning Arcs (`InstancedMesh` — collapses 96 bolt segments into 1 draw call!)
 */
export class Effects {
  readonly group = new THREE.Group();
  private pos = new Float32Array(MAX_PARTICLES * 3);
  private vel = new Float32Array(MAX_PARTICLES * 3);
  private col = new Float32Array(MAX_PARTICLES * 3);
  private size = new Float32Array(MAX_PARTICLES);
  private size0 = new Float32Array(MAX_PARTICLES);
  private alpha = new Float32Array(MAX_PARTICLES);
  private life = new Float32Array(MAX_PARTICLES);
  private life0 = new Float32Array(MAX_PARTICLES);
  private grav = new Float32Array(MAX_PARTICLES);
  private cursor = 0;
  private activeCount = 0;
  private colorDirty = false;
  private geo: THREE.BufferGeometry;
  private points: THREE.Points;

  private streakMesh: THREE.InstancedMesh;
  private streakPos = new Float32Array(MAX_STREAKS * 3);
  private streakVel = new Float32Array(MAX_STREAKS * 3);
  private streakCol = new Float32Array(MAX_STREAKS * 3);
  private streakLen = new Float32Array(MAX_STREAKS);
  private streakLife = new Float32Array(MAX_STREAKS);
  private streakLife0 = new Float32Array(MAX_STREAKS);
  private streakCursor = 0;

  private shardMesh: THREE.InstancedMesh;
  private shardPos = new Float32Array(MAX_SHARDS * 3);
  private shardVel = new Float32Array(MAX_SHARDS * 3);
  private shardRot = new Float32Array(MAX_SHARDS * 3);
  private shardSpin = new Float32Array(MAX_SHARDS * 3);
  private shardCol = new Float32Array(MAX_SHARDS * 3);
  private shardHeat = new Float32Array(MAX_SHARDS);
  private shardBounces = new Uint8Array(MAX_SHARDS);
  public onShardBounce: ((x: number, z: number, energy: number) => void) | null = null;
  public totalShardBounces = 0;
  private shardScale = new Float32Array(MAX_SHARDS);
  private shardLife = new Float32Array(MAX_SHARDS);
  private shardLife0 = new Float32Array(MAX_SHARDS);
  private shardCursor = 0;

  // Instanced Rings, Flashes & Chain-Arcs (zero per-spawn Mesh/Material allocations)
  public readonly ringMesh: THREE.InstancedMesh;
  public readonly flashMesh: THREE.InstancedMesh;
  public readonly arcMesh: THREE.InstancedMesh;
  private flashTex: THREE.CanvasTexture;

  private rings: RingSlot[] = [];
  private ringCursor = 0;
  private flashes: FlashSlot[] = [];
  private flashCursor = 0;
  private arcs: ArcSlot[] = [];
  private arcCursor = 0;

  private timed: Timed[] = [];
  private tmpFrom = new THREE.Vector3();
  private tmpTo = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();
  private upAxis = new THREE.Vector3(0, 0, 1);
  private dummy = new THREE.Object3D();
  private clock = 0;
  private tmpColor = new THREE.Color();

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * (0.65 + core * 1.25), vAlpha * core);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    // 1. Velocity-aligned hot welding-spark needles
    const streakGeo = new THREE.OctahedronGeometry(0.095, 0);
    streakGeo.scale(0.78, 0.78, 6.2);
    const streakMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.streakMesh = new THREE.InstancedMesh(streakGeo, streakMat, MAX_STREAKS);
    this.streakMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.streakMesh.setColorAt(0, this.tmpColor.setRGB(1, 1, 1));
    this.streakMesh.count = 0;
    this.streakMesh.frustumCulled = false;
    this.streakMesh.renderOrder = 4;
    this.group.add(this.streakMesh);

    // 2. 3D faceted tumbling armor/crystal/chitin shatter chunks
    const shardGeo = new THREE.OctahedronGeometry(0.21, 0);
    shardGeo.scale(1.24, 0.58, 0.96);
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x6a7890,
      emissiveIntensity: 0.72,
      roughness: 0.24,
      metalness: 0.38,
      flatShading: true,
    });
    this.shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, MAX_SHARDS);
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.setColorAt(0, this.tmpColor.setRGB(1, 1, 1));
    this.shardMesh.count = 0;
    this.shardMesh.frustumCulled = false;
    this.shardMesh.renderOrder = 3;
    this.group.add(this.shardMesh);

    // 3. Single-Draw-Call Instanced Shockwave Rings
    const ringGeo = new THREE.RingGeometry(0.84, 1, 56);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, MAX_RINGS);
    this.ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ringMesh.setColorAt(0, this.tmpColor.setRGB(1, 1, 1));
    this.ringMesh.count = 0;
    this.ringMesh.frustumCulled = false;
    this.ringMesh.renderOrder = 2;
    this.group.add(this.ringMesh);
    for (let i = 0; i < MAX_RINGS; i++) {
      this.rings.push({ x: 0, z: 0, r: 1, g: 1, b: 1, t: 0, dur: 1, r0: 0, r1: 1, alive: false });
    }

    // 4. Single-Draw-Call Instanced Ground Impact Flash Pools
    this.flashTex = makeRadialFlashTexture();
    const flashGeo = new THREE.PlaneGeometry(2, 2);
    flashGeo.rotateX(-Math.PI / 2);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: this.flashTex,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.flashMesh = new THREE.InstancedMesh(flashGeo, flashMat, MAX_FLASH_POOLS);
    this.flashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flashMesh.setColorAt(0, this.tmpColor.setRGB(1, 1, 1));
    this.flashMesh.count = 0;
    this.flashMesh.frustumCulled = false;
    this.flashMesh.renderOrder = 1;
    this.group.add(this.flashMesh);
    for (let i = 0; i < MAX_FLASH_POOLS; i++) {
      this.flashes.push({ x: 0, z: 0, r: 1, g: 1, b: 1, t: 0, dur: 0.16, rad: 1.5, alive: false });
    }

    // 5. Single-Draw-Call Instanced Chain-Lightning Arc Segments
    const segGeo = new THREE.CylinderGeometry(0.068, 0.068, 1, 5).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    const segMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.arcMesh = new THREE.InstancedMesh(segGeo, segMat, MAX_ARC_SEGS);
    this.arcMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arcMesh.setColorAt(0, this.tmpColor.setRGB(1, 1, 1));
    this.arcMesh.count = 0;
    this.arcMesh.frustumCulled = false;
    this.arcMesh.renderOrder = 5;
    this.group.add(this.arcMesh);
    for (let i = 0; i < MAX_ARCS; i++) {
      this.arcs.push({
        p0x: 0, p0y: 0, p0z: 0,
        p1x: 0, p1y: 0, p1z: 0,
        p2x: 0, p2y: 0, p2z: 0,
        p3x: 0, p3y: 0, p3z: 0,
        r: 0.38, g: 0.95, b: 1.0, t: 0, dur: 0.22, alive: false,
      });
    }
  }

  setViewportScale(heightPx: number, fovDeg: number): void {
    const mat = this.points.material as THREE.ShaderMaterial;
    mat.uniforms.uScale!.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  groundFlash(x: number, z: number, color: number | string, radius = 1.6, dur = 0.16): void {
    let fl = this.flashes[this.flashCursor]!;
    for (let i = 0; i < MAX_FLASH_POOLS; i++) {
      const idx = (this.flashCursor + i) % MAX_FLASH_POOLS;
      if (!this.flashes[idx]!.alive) {
        fl = this.flashes[idx]!;
        this.flashCursor = (idx + 1) % MAX_FLASH_POOLS;
        break;
      }
    }
    this.tmpColor.set(color);
    fl.alive = true;
    fl.t = 0;
    fl.dur = dur;
    fl.rad = radius;
    fl.x = x;
    fl.z = z;
    fl.r = this.tmpColor.r;
    fl.g = this.tmpColor.g;
    fl.b = this.tmpColor.b;
  }

  streaks(
    x: number,
    y: number,
    z: number,
    color: number | string,
    count: number,
    opts: { speed?: number; len?: number; life?: number; coneBiasZ?: number } = {},
  ): void {
    const speed = opts.speed ?? 13.5;
    const baseLen = opts.len ?? 1.05;
    const life = opts.life ?? 0.26;
    const coneZ = opts.coneBiasZ ?? -0.55;
    this.tmpColor.set(color);

    for (let i = 0; i < count; i++) {
      const k = this.streakCursor;
      this.streakCursor = (this.streakCursor + 1) % MAX_STREAKS;
      const i3 = k * 3;
      const ang = Math.random() * Math.PI * 2;
      const spd = speed * (0.55 + Math.random() * 0.75);
      this.streakPos[i3] = x + (Math.random() - 0.5) * 0.18;
      this.streakPos[i3 + 1] = y + (Math.random() - 0.5) * 0.16;
      this.streakPos[i3 + 2] = z + (Math.random() - 0.5) * 0.18;
      this.streakVel[i3] = Math.cos(ang) * spd * 0.78;
      this.streakVel[i3 + 1] = (0.28 + Math.random() * 0.75) * spd * 0.58;
      this.streakVel[i3 + 2] = (Math.sin(ang) * 0.55 + coneZ) * spd;

      const hotCore = i % 3 === 0;
      this.streakCol[i3] = hotCore ? 1 : Math.min(1.4, this.tmpColor.r * 1.28 + 0.2);
      this.streakCol[i3 + 1] = hotCore ? 0.97 : Math.min(1.4, this.tmpColor.g * 1.28 + 0.18);
      this.streakCol[i3 + 2] = hotCore ? 0.88 : Math.min(1.4, this.tmpColor.b * 1.28 + 0.15);
      this.streakLen[k] = baseLen * (0.7 + Math.random() * 0.7);
      this.streakLife0[k] = life * (0.7 + Math.random() * 0.55);
      this.streakLife[k] = this.streakLife0[k]!;
    }
  }

  shatter(
    x: number,
    y: number,
    z: number,
    color: number | string,
    count: number,
    heavy = false,
  ): void {
    this.tmpColor.set(color);
    const speed = heavy ? 11.2 : 8.4;
    const baseScale = heavy ? 1.28 : 0.88;
    const life = heavy ? 0.68 : 0.48;

    for (let i = 0; i < count; i++) {
      const k = this.shardCursor;
      this.shardCursor = (this.shardCursor + 1) % MAX_SHARDS;
      const i3 = k * 3;
      const th = Math.random() * Math.PI * 2;
      const spd = speed * (0.45 + Math.random() * 0.8);
      this.shardPos[i3] = x + (Math.random() - 0.5) * 0.35;
      this.shardPos[i3 + 1] = Math.max(0.18, y + (Math.random() - 0.5) * 0.35);
      this.shardPos[i3 + 2] = z + (Math.random() - 0.5) * 0.35;
      this.shardVel[i3] = Math.cos(th) * spd * 0.72;
      this.shardVel[i3 + 1] = 3.6 + Math.random() * (heavy ? 6.2 : 4.4);
      this.shardVel[i3 + 2] = Math.sin(th) * spd * 0.65 - 2.6;
      this.shardRot[i3] = Math.random() * 6.28;
      this.shardRot[i3 + 1] = Math.random() * 6.28;
      this.shardRot[i3 + 2] = Math.random() * 6.28;
      this.shardSpin[i3] = (Math.random() - 0.5) * 22;
      this.shardSpin[i3 + 1] = (Math.random() - 0.5) * 22;
      this.shardSpin[i3 + 2] = (Math.random() - 0.5) * 22;

      const bright = i % 4 === 0 ? 1.35 : 0.85 + Math.random() * 0.35;
      this.shardCol[i3] = Math.min(1, this.tmpColor.r * bright + (i % 4 === 0 ? 0.25 : 0));
      this.shardCol[i3 + 1] = Math.min(1, this.tmpColor.g * bright + (i % 4 === 0 ? 0.25 : 0));
      this.shardCol[i3 + 2] = Math.min(1, this.tmpColor.b * bright + (i % 4 === 0 ? 0.25 : 0));
      this.shardScale[k] = baseScale * (0.65 + Math.random() * 0.7);
      this.shardLife0[k] = life * (0.78 + Math.random() * 0.48);
      this.shardLife[k] = this.shardLife0[k]!;
      this.shardHeat[k] = heavy ? 1.0 : 0.68;
      this.shardBounces[k] = 0;
    }
  }

  burst(
    x: number,
    y: number,
    z: number,
    color: number | string,
    count: number,
    opts: { speed?: number; size?: number; life?: number; up?: number; gravity?: number; spread?: number } = {},
  ): void {
    const speed = opts.speed ?? 6;
    const sz = opts.size ?? 0.35;
    const life = opts.life ?? 0.6;
    const up = opts.up ?? 0.5;
    const gravity = opts.gravity ?? 9;
    const spread = opts.spread ?? 0.2;
    this.tmpColor.set(color);
    this.colorDirty = true;
    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      if (this.life[k]! <= 0) this.activeCount++;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI - Math.PI / 2;
      const s = speed * (0.35 + Math.random() * 0.75);
      this.pos[k * 3] = x + (Math.random() - 0.5) * spread;
      this.pos[k * 3 + 1] = y + (Math.random() - 0.5) * spread;
      this.pos[k * 3 + 2] = z + (Math.random() - 0.5) * spread;
      this.vel[k * 3] = Math.cos(th) * Math.cos(ph) * s;
      this.vel[k * 3 + 1] = Math.abs(Math.sin(ph)) * s * up + s * 0.25 * up;
      this.vel[k * 3 + 2] = Math.sin(th) * Math.cos(ph) * s;
      const jitter = 0.8 + Math.random() * 0.4;
      this.col[k * 3] = Math.min(1, this.tmpColor.r * jitter);
      this.col[k * 3 + 1] = Math.min(1, this.tmpColor.g * jitter);
      this.col[k * 3 + 2] = Math.min(1, this.tmpColor.b * jitter);
      this.size0[k] = sz * (0.6 + Math.random() * 0.8);
      this.size[k] = this.size0[k]!;
      this.life0[k] = life * (0.6 + Math.random() * 0.6);
      this.life[k] = this.life0[k]!;
      this.alpha[k] = 1;
      this.grav[k] = gravity;
    }
  }

  impact(
    x: number,
    y: number,
    z: number,
    color: number | string,
    heavy = false,
    weapon?: string,
  ): void {
    const isRail = weapon === 'rail';
    const isPlasma = weapon === 'plasma';
    const isScatter = weapon === 'scatter';
    const count = heavy || isRail || isPlasma ? 10 : 6;
    const speed = heavy || isRail ? 12.2 : 8.8;
    const sz = heavy || isPlasma ? 0.42 : 0.3;
    this.tmpColor.set(color);
    this.colorDirty = true;

    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      if (this.life[k]! <= 0) this.activeCount++;
      const lateral = (Math.random() - 0.5) * 2.4;
      const s = speed * (0.45 + Math.random() * 0.75);
      this.pos[k * 3] = x + (Math.random() - 0.5) * 0.22;
      this.pos[k * 3 + 1] = y + (Math.random() - 0.5) * 0.18;
      this.pos[k * 3 + 2] = z;
      this.vel[k * 3] = lateral * s * 0.68;
      this.vel[k * 3 + 1] = (0.25 + Math.random() * 0.78) * s * 0.58;
      this.vel[k * 3 + 2] = -(0.38 + Math.random() * 0.9) * s;
      const whiteCore = i < 3;
      this.col[k * 3] = whiteCore ? 1 : Math.min(1, this.tmpColor.r * 1.2);
      this.col[k * 3 + 1] = whiteCore ? 1 : Math.min(1, this.tmpColor.g * 1.2);
      this.col[k * 3 + 2] = whiteCore ? 1 : Math.min(1, this.tmpColor.b * 1.2);
      this.size0[k] = sz * (whiteCore ? 1.35 : 0.78 + Math.random() * 0.55);
      this.size[k] = this.size0[k]!;
      this.life0[k] = heavy ? 0.28 : 0.2;
      this.life[k] = this.life0[k]!;
      this.alpha[k] = 1;
      this.grav[k] = 7.5;
    }

    this.streaks(x, y, z, heavy ? 0xffe694 : color, heavy || isRail ? 8 : isScatter ? 6 : 5, {
      speed: isRail ? 19.5 : heavy ? 16.5 : 14.0,
      len: isRail ? 1.75 : heavy ? 1.42 : 1.12,
      life: heavy ? 0.3 : 0.23,
      coneBiasZ: -0.65,
    });

    if (heavy || isRail || isPlasma) {
      this.shatter(x, y, z, heavy ? 0xa8e4ff : color, heavy ? 5 : 3, heavy);
      this.groundFlash(x, z, color, isPlasma ? 2.6 : 1.75, isPlasma ? 0.25 : 0.16);
      this.ring(x, z, heavy ? 0xffe28a : color, isPlasma ? 2.45 : 1.55, 0.2, 0.2);
    } else {
      if (Math.random() < 0.55) {
        this.groundFlash(x, z, color, 1.35, 0.13);
      }
      if (Math.random() < 0.35) {
        this.shatter(x, y, z, color, 2, false);
        this.ring(x, z, color, 1.15, 0.16, 0.18);
      }
    }
  }

  arc(x1: number, z1: number, x2: number, z2: number, color: number | string = 0x62f4ff): void {
    let a = this.arcs[this.arcCursor]!;
    for (let i = 0; i < MAX_ARCS; i++) {
      const idx = (this.arcCursor + i) % MAX_ARCS;
      if (!this.arcs[idx]!.alive) {
        a = this.arcs[idx]!;
        this.arcCursor = (idx + 1) % MAX_ARCS;
        break;
      }
    }
    this.tmpColor.set(color);
    a.alive = true;
    a.t = 0;
    a.dur = 0.22;
    a.r = this.tmpColor.r;
    a.g = this.tmpColor.g;
    a.b = this.tmpColor.b;

    const dx = x2 - x1;
    const dz = z2 - z1;
    const perpX = -dz * 0.22;
    const perpZ = dx * 0.22;
    const j1 = (Math.random() - 0.5) * 1.6;
    const j2 = (Math.random() - 0.5) * 1.6;
    a.p0x = x1; a.p0y = 0.82; a.p0z = z1;
    a.p1x = x1 + dx * 0.33 + perpX * j1; a.p1y = 0.98 + Math.random() * 0.25; a.p1z = z1 + dz * 0.33 + perpZ * j1;
    a.p2x = x1 + dx * 0.67 - perpX * j2; a.p2y = 0.92 + Math.random() * 0.25; a.p2z = z1 + dz * 0.67 - perpZ * j2;
    a.p3x = x2; a.p3y = 0.82; a.p3z = z2;
    this.ring(x2, z2, color, 1.45, 0.24, 0.15);
  }

  ring(x: number, z: number, color: number | string, radius: number, dur = 0.45, startRadius = 0.2): void {
    let r = this.rings[this.ringCursor]!;
    for (let i = 0; i < MAX_RINGS; i++) {
      const idx = (this.ringCursor + i) % MAX_RINGS;
      if (!this.rings[idx]!.alive) {
        r = this.rings[idx]!;
        this.ringCursor = (idx + 1) % MAX_RINGS;
        break;
      }
    }
    this.tmpColor.set(color);
    r.alive = true;
    r.t = 0;
    r.dur = dur;
    r.r0 = startRadius;
    r.r1 = radius;
    r.x = x;
    r.z = z;
    r.r = this.tmpColor.r;
    r.g = this.tmpColor.g;
    r.b = this.tmpColor.b;
  }

  after(delaySec: number, fn: () => void): void {
    this.timed.push({ at: this.clock + delaySec, fn });
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.activeCount = 0;
    (this.geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;

    this.streakLife.fill(0);
    this.streakMesh.count = 0;
    this.shardLife.fill(0);
    this.shardHeat.fill(0);
    this.shardBounces.fill(0);
    this.shardMesh.count = 0;

    for (let i = 0; i < this.rings.length; i++) this.rings[i]!.alive = false;
    this.ringMesh.count = 0;
    for (let i = 0; i < this.flashes.length; i++) this.flashes[i]!.alive = false;
    this.flashMesh.count = 0;
    for (let i = 0; i < this.arcs.length; i++) this.arcs[i]!.alive = false;
    this.arcMesh.count = 0;
    this.timed.length = 0;
  }

  dispose(): void {
    this.clear();
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
    this.streakMesh.geometry.dispose();
    (this.streakMesh.material as THREE.Material).dispose();
    this.shardMesh.geometry.dispose();
    (this.shardMesh.material as THREE.Material).dispose();
    this.ringMesh.geometry.dispose();
    (this.ringMesh.material as THREE.Material).dispose();
    this.flashMesh.geometry.dispose();
    (this.flashMesh.material as THREE.Material).dispose();
    this.flashTex.dispose();
    this.arcMesh.geometry.dispose();
    (this.arcMesh.material as THREE.Material).dispose();
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.timed.length) {
      for (let i = this.timed.length - 1; i >= 0; i--) {
        const t = this.timed[i]!;
        if (t.at <= this.clock) {
          this.timed.splice(i, 1);
          t.fn();
        }
      }
    }

    // 1. Update core additive particle points
    if (this.activeCount > 0 || this.colorDirty) {
      const drag = Math.exp(-2.4 * dt);
      let aliveNow = 0;
      for (let k = 0; k < MAX_PARTICLES; k++) {
        const l = this.life[k]!;
        if (l <= 0) {
          if (this.alpha[k] !== 0) this.alpha[k] = 0;
          continue;
        }
        const nl = l - dt;
        this.life[k] = nl;
        if (nl <= 0) {
          this.alpha[k] = 0;
          continue;
        }
        aliveNow++;
        const i3 = k * 3;
        this.vel[i3] = this.vel[i3]! * drag;
        this.vel[i3 + 1] = this.vel[i3 + 1]! * drag - this.grav[k]! * dt;
        this.vel[i3 + 2] = this.vel[i3 + 2]! * drag;
        this.pos[i3] = this.pos[i3]! + this.vel[i3]! * dt;
        this.pos[i3 + 1] = Math.max(0.03, this.pos[i3 + 1]! + this.vel[i3 + 1]! * dt);
        this.pos[i3 + 2] = this.pos[i3 + 2]! + this.vel[i3 + 2]! * dt;
        const f = Math.max(0, nl / this.life0[k]!);
        this.alpha[k] = f;
        this.size[k] = this.size0[k]! * (0.4 + 0.6 * f);
      }
      this.activeCount = aliveNow;
      (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      if (this.colorDirty) {
        (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
        this.colorDirty = false;
      }
      (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
    }

    const d = this.dummy;

    // 2. Update velocity-aligned ballistic spark streaks
    const streakDrag = Math.exp(-3.2 * dt);
    let streakOut = 0;
    for (let k = 0; k < MAX_STREAKS; k++) {
      const l = this.streakLife[k]!;
      if (l <= 0) continue;
      const nl = l - dt;
      this.streakLife[k] = nl;
      if (nl <= 0) continue;

      const i3 = k * 3;
      let vx = this.streakVel[i3]! * streakDrag;
      let vy = this.streakVel[i3 + 1]! * streakDrag - 19.5 * dt;
      let vz = this.streakVel[i3 + 2]! * streakDrag;
      let px = this.streakPos[i3]! + vx * dt;
      let py = this.streakPos[i3 + 1]! + vy * dt;
      let pz = this.streakPos[i3 + 2]! + vz * dt;
      if (py < 0.04) {
        py = 0.04;
        vy = Math.abs(vy) * 0.48;
        vx *= 0.82;
        vz *= 0.82;
      }
      this.streakVel[i3] = vx;
      this.streakVel[i3 + 1] = vy;
      this.streakVel[i3 + 2] = vz;
      this.streakPos[i3] = px;
      this.streakPos[i3 + 1] = py;
      this.streakPos[i3 + 2] = pz;

      const f = Math.max(0.05, nl / this.streakLife0[k]!);
      const speedMag = Math.hypot(vx, vy, vz);
      this.tmpDir.set(vx, vy, vz);
      if (speedMag > 0.01) this.tmpDir.divideScalar(speedMag);
      else this.tmpDir.set(0, 0, -1);

      d.position.set(px, py, pz);
      d.quaternion.setFromUnitVectors(this.upAxis, this.tmpDir);
      const stretch = this.streakLen[k]! * (0.45 + 0.75 * f) * Math.min(1.6, 0.5 + speedMag * 0.065);
      d.scale.set(0.7 + 0.45 * f, 0.7 + 0.45 * f, stretch);
      d.updateMatrix();
      this.streakMesh.setMatrixAt(streakOut, d.matrix);
      this.tmpColor.setRGB(this.streakCol[i3]! * f, this.streakCol[i3 + 1]! * f, this.streakCol[i3 + 2]! * f);
      this.streakMesh.setColorAt(streakOut, this.tmpColor);
      streakOut++;
    }
    this.streakMesh.count = streakOut;
    if (streakOut > 0) {
      this.streakMesh.instanceMatrix.needsUpdate = true;
      if (this.streakMesh.instanceColor) this.streakMesh.instanceColor.needsUpdate = true;
    }

    // 3. Update 3D tumbling faceted shatter chunks
    let shardOut = 0;
    for (let k = 0; k < MAX_SHARDS; k++) {
      const l = this.shardLife[k]!;
      if (l <= 0) continue;
      const nl = l - dt;
      this.shardLife[k] = nl;
      if (nl <= 0) continue;

      const i3 = k * 3;
      let vx = this.shardVel[i3]!;
      let vy = this.shardVel[i3 + 1]! - 24.0 * dt;
      let vz = this.shardVel[i3 + 2]!;
      let px = this.shardPos[i3]! + vx * dt;
      let py = this.shardPos[i3 + 1]! + vy * dt;
      let pz = this.shardPos[i3 + 2]! + vz * dt;
      if (py < 0.06 && vy < 0) {
        const impactSpd = Math.abs(vy);
        py = 0.06;
        vy = impactSpd * 0.54;
        vx *= 0.74;
        vz *= 0.74;
        this.shardSpin[i3] = this.shardSpin[i3]! * 0.68;
        this.shardSpin[i3 + 2] = this.shardSpin[i3 + 2]! * 0.68;
        if (this.shardBounces[k]! === 0 && impactSpd > 2.4) {
          this.shardBounces[k] = 1;
          this.totalShardBounces += 1;
          this.burst(px, 0.09, pz, 0xffdf72, 1, {
            speed: 2.3,
            size: 0.16,
            life: 0.16,
            up: 0.85,
            gravity: 6,
          });
          this.onShardBounce?.(px, pz, Math.min(1, impactSpd / 10));
        } else {
          this.shardBounces[k] = Math.min(250, this.shardBounces[k]! + 1);
        }
      }
      this.shardHeat[k] = Math.max(0, this.shardHeat[k]! - dt * 1.45);
      this.shardVel[i3] = vx;
      this.shardVel[i3 + 1] = vy;
      this.shardVel[i3 + 2] = vz;
      this.shardPos[i3] = px;
      this.shardPos[i3 + 1] = py;
      this.shardPos[i3 + 2] = pz;

      this.shardRot[i3] = this.shardRot[i3]! + this.shardSpin[i3]! * dt;
      this.shardRot[i3 + 1] = this.shardRot[i3 + 1]! + this.shardSpin[i3 + 1]! * dt;
      this.shardRot[i3 + 2] = this.shardRot[i3 + 2]! + this.shardSpin[i3 + 2]! * dt;

      const f = Math.max(0.05, nl / this.shardLife0[k]!);
      const shrink = f < 0.35 ? f / 0.35 : 1.0;
      d.position.set(px, py, pz);
      d.rotation.set(this.shardRot[i3]!, this.shardRot[i3 + 1]!, this.shardRot[i3 + 2]!);
      d.scale.setScalar(this.shardScale[k]! * shrink);
      d.updateMatrix();
      this.shardMesh.setMatrixAt(shardOut, d.matrix);
      const heat = this.shardHeat[k]!;
      const emberMul = 0.55 + 0.45 * f + heat * 0.55;
      this.tmpColor.setRGB(
        this.shardCol[i3]! * emberMul + heat * 0.38,
        this.shardCol[i3 + 1]! * emberMul + heat * 0.25,
        this.shardCol[i3 + 2]! * emberMul + heat * 0.06,
      );
      this.shardMesh.setColorAt(shardOut, this.tmpColor);
      shardOut++;
    }
    this.shardMesh.count = shardOut;
    if (shardOut > 0) {
      this.shardMesh.instanceMatrix.needsUpdate = true;
      if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;
    }

    // 4. Update GPU-Instanced Shockwave Rings
    let ringOut = 0;
    for (let i = 0; i < MAX_RINGS; i++) {
      const r = this.rings[i]!;
      if (!r.alive) continue;
      r.t += dt;
      const p = Math.min(1, r.t / r.dur);
      if (p >= 1) {
        r.alive = false;
        continue;
      }
      const e = 1 - Math.pow(1 - p, 3);
      const rad = r.r0 + (r.r1 - r.r0) * e;
      const fade = (1 - p) * 0.94;
      d.position.set(r.x, 0.06, r.z);
      d.rotation.set(0, 0, 0);
      d.scale.set(rad, 1, rad);
      d.updateMatrix();
      this.ringMesh.setMatrixAt(ringOut, d.matrix);
      this.tmpColor.setRGB(r.r * fade * 1.15, r.g * fade * 1.15, r.b * fade * 1.15);
      this.ringMesh.setColorAt(ringOut, this.tmpColor);
      ringOut++;
    }
    this.ringMesh.count = ringOut;
    if (ringOut > 0) {
      this.ringMesh.instanceMatrix.needsUpdate = true;
      if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
    }

    // 5. Update GPU-Instanced Ground Impact Flash Pools
    let flashOut = 0;
    for (let i = 0; i < MAX_FLASH_POOLS; i++) {
      const fl = this.flashes[i]!;
      if (!fl.alive) continue;
      fl.t += dt;
      const p = Math.min(1, fl.t / fl.dur);
      if (p >= 1) {
        fl.alive = false;
        continue;
      }
      const sc = fl.rad * (0.75 + 0.55 * p);
      const fade = Math.pow(1 - p, 1.8) * 0.76;
      d.position.set(fl.x, 0.042, fl.z);
      d.rotation.set(0, 0, 0);
      d.scale.set(sc, 1, sc);
      d.updateMatrix();
      this.flashMesh.setMatrixAt(flashOut, d.matrix);
      this.tmpColor.setRGB(fl.r * fade, fl.g * fade, fl.b * fade);
      this.flashMesh.setColorAt(flashOut, this.tmpColor);
      flashOut++;
    }
    this.flashMesh.count = flashOut;
    if (flashOut > 0) {
      this.flashMesh.instanceMatrix.needsUpdate = true;
      if (this.flashMesh.instanceColor) this.flashMesh.instanceColor.needsUpdate = true;
    }

    // 6. Update GPU-Instanced Chain-Lightning Arcs
    let arcOut = 0;
    for (let i = 0; i < MAX_ARCS; i++) {
      const a = this.arcs[i]!;
      if (!a.alive) continue;
      a.t += dt;
      const p = Math.min(1, a.t / a.dur);
      if (p >= 1) {
        a.alive = false;
        continue;
      }
      const fade = (1 - p) * (0.78 + 0.22 * Math.sin(this.clock * 90));
      const thickness = Math.max(0.2, 1.42 * (1 - p * 0.7));
      this.tmpColor.setRGB(a.r * fade * 1.25, a.g * fade * 1.25, a.b * fade * 1.25);

      const pushSeg = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void => {
        if (arcOut >= MAX_ARC_SEGS) return;
        this.tmpFrom.set(x0, y0, z0);
        this.tmpTo.set(x1, y1, z1);
        const len = Math.max(0.05, this.tmpFrom.distanceTo(this.tmpTo));
        d.position.copy(this.tmpFrom);
        d.lookAt(this.tmpTo);
        d.scale.set(thickness, thickness, len);
        d.updateMatrix();
        this.arcMesh.setMatrixAt(arcOut, d.matrix);
        this.arcMesh.setColorAt(arcOut, this.tmpColor);
        arcOut++;
      };

      pushSeg(a.p0x, a.p0y, a.p0z, a.p1x, a.p1y, a.p1z);
      pushSeg(a.p1x, a.p1y, a.p1z, a.p2x, a.p2y, a.p2z);
      pushSeg(a.p2x, a.p2y, a.p2z, a.p3x, a.p3y, a.p3z);
    }
    this.arcMesh.count = arcOut;
    if (arcOut > 0) {
      this.arcMesh.instanceMatrix.needsUpdate = true;
      if (this.arcMesh.instanceColor) this.arcMesh.instanceColor.needsUpdate = true;
    }
  }
}
