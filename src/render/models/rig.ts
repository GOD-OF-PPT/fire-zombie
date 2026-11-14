import * as THREE from 'three';

/**
 * Shared toon-ish character material: vertex RGBA colours (A = glow) + fresnel rim light.
 * Instance colours multiply everything, so values > 1 produce a white hit-flash.
 */
export function makeCharacterMaterial(rimColor = 0x7fe9ff, rimStrength = 0.55, glow = 1.6, self = 0.18): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0.15,
  });
  const uniforms = {
    uRim: { value: new THREE.Color(rimColor) },
    uRimStrength: { value: rimStrength },
    uGlow: { value: glow },
    uSelf: { value: self },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uRim;\nuniform float uRimStrength;\nuniform float uGlow;\nuniform float uSelf;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #if defined( USE_COLOR_ALPHA )
          totalEmissiveRadiance += vColor.rgb * (vColor.a * uGlow + uSelf);
        #endif
        float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.6);
        totalEmissiveRadiance += uRim * rimF * uRimStrength;`,
      );
  };
  mat.customProgramCacheKey = () => 'char-mat-v2';
  return mat;
}

export interface RigPartDef {
  name: string;
  geo: THREE.BufferGeometry;
  /** joint position relative to the rig root (geometry must already be centred on its pivot) */
  joint: readonly [number, number, number];
}

/**
 * Multi-part instanced character. Each part is one InstancedMesh; the caller supplies a root
 * matrix and per-part local rotations each frame. Cheap for the few hundred instances we draw.
 */
export class InstancedRig {
  readonly meshes: THREE.InstancedMesh[] = [];
  private readonly joints: THREE.Vector3[] = [];
  private readonly names: string[];
  private count = 0;
  private readonly local = new THREE.Matrix4();
  private readonly tmp = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly sv = new THREE.Vector3();

  constructor(
    parts: readonly RigPartDef[],
    material: THREE.Material,
    readonly capacity: number,
    scene: THREE.Object3D,
  ) {
    this.names = parts.map((p) => p.name);
    for (const p of parts) {
      const m = new THREE.InstancedMesh(p.geo, material, capacity);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      m.frustumCulled = false;
      m.count = 0;
      this.meshes.push(m);
      this.joints.push(new THREE.Vector3(...p.joint));
      scene.add(m);
    }
  }

  partIndex(name: string): number {
    return this.names.indexOf(name);
  }

  begin(): void {
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  /**
   * Adds one instance. `rot` holds xyz euler triples per part (length = parts*3);
   * `scl` optional per-part uniform scale; `off` optional per-part extra offset (xyz triples).
   */
  push(root: THREE.Matrix4, rot: ArrayLike<number>, tint: THREE.Color, scl?: ArrayLike<number>, off?: ArrayLike<number>): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    for (let k = 0; k < this.meshes.length; k++) {
      const j = this.joints[k]!;
      this.e.set(rot[k * 3] ?? 0, rot[k * 3 + 1] ?? 0, rot[k * 3 + 2] ?? 0);
      this.q.setFromEuler(this.e);
      const s = scl ? (scl[k] ?? 1) : 1;
      this.sv.copy(this.one).multiplyScalar(s);
      this.tmp.compose(j, this.q, this.sv);
      if (off) {
        this.tmp.elements[12]! += off[k * 3] ?? 0;
        this.tmp.elements[13]! += off[k * 3 + 1] ?? 0;
        this.tmp.elements[14]! += off[k * 3 + 2] ?? 0;
      }
      this.local.multiplyMatrices(root, this.tmp);
      const mesh = this.meshes[k]!;
      mesh.setMatrixAt(i, this.local);
      mesh.setColorAt(i, tint);
    }
  }

  end(): void {
    for (const m of this.meshes) {
      m.count = this.count;
      m.visible = this.count > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Swap the geometry of one part (e.g. the weapon held by soldiers). */
  setPartGeometry(name: string, geo: THREE.BufferGeometry): void {
    const k = this.partIndex(name);
    if (k >= 0) this.meshes[k]!.geometry = geo;
  }
}
