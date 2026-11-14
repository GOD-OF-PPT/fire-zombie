import * as THREE from 'three';

const MAX_PARTICLES = 2400;
const MAX_RINGS = 24;

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  r0: number;
  r1: number;
  alive: boolean;
}

interface Timed {
  at: number;
  fn: () => void;
}

/** Pooled additive particle bursts + ground shockwave rings. All CPU-updated in a single draw call each. */
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
  private geo: THREE.BufferGeometry;
  private points: THREE.Points;
  private rings: Ring[] = [];
  private timed: Timed[] = [];
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
          gl_FragColor = vec4(vColor * (0.6 + core), vAlpha * core);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    const ringGeo = new THREE.RingGeometry(0.86, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, m);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.rings.push({ mesh, mat: m, t: 0, dur: 1, r0: 0, r1: 1, alive: false });
    }
  }

  setViewportScale(heightPx: number, fovDeg: number): void {
    const mat = this.points.material as THREE.ShaderMaterial;
    mat.uniforms.uScale!.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
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
    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
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

  ring(x: number, z: number, color: number | string, radius: number, dur = 0.45, startRadius = 0.2): void {
    let r = this.rings.find((q) => !q.alive);
    if (!r) r = this.rings.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    r.alive = true;
    r.t = 0;
    r.dur = dur;
    r.r0 = startRadius;
    r.r1 = radius;
    r.mat.color.set(color);
    r.mesh.position.set(x, 0.06, z);
    r.mesh.visible = true;
  }

  after(delaySec: number, fn: () => void): void {
    this.timed.push({ at: this.clock + delaySec, fn });
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    for (const r of this.rings) {
      r.alive = false;
      r.mesh.visible = false;
    }
    this.timed.length = 0;
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
    const drag = Math.exp(-2.4 * dt);
    for (let k = 0; k < MAX_PARTICLES; k++) {
      const l = this.life[k]!;
      if (l <= 0) {
        if (this.alpha[k] !== 0) this.alpha[k] = 0;
        continue;
      }
      const nl = l - dt;
      this.life[k] = nl;
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
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;

    for (const r of this.rings) {
      if (!r.alive) continue;
      r.t += dt;
      const p = Math.min(1, r.t / r.dur);
      const e = 1 - Math.pow(1 - p, 3);
      const rad = r.r0 + (r.r1 - r.r0) * e;
      r.mesh.scale.set(rad, 1, rad);
      r.mat.opacity = (1 - p) * 0.9;
      if (p >= 1) {
        r.alive = false;
        r.mesh.visible = false;
      }
    }
  }
}
