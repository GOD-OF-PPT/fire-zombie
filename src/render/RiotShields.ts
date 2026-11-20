import * as THREE from 'three';
import { makeCanvasTexture } from './textures';

// Three interlocking armour plates share one atlas and one instanced draw.
// The UVs stay attached to the pieces when the shield comes apart.
const SIZE = 256;
const OUTLINE = [[40, 27], [94, 14], [162, 14], [216, 27], [232, 61], [222, 183], [181, 222], [128, 244], [75, 222], [34, 183], [24, 61]];
const PANELS = [
  [[40, 27], [94, 14], [103, 78], [86, 105], [102, 137], [75, 222], [34, 183], [24, 61]],
  [[94, 14], [162, 14], [153, 78], [170, 105], [154, 137], [181, 222], [128, 244], [75, 222], [102, 137], [86, 105], [103, 78]],
  [[162, 14], [216, 27], [232, 61], [222, 183], [181, 222], [154, 137], [170, 105], [153, 78]],
];

function armourAtlas(): THREE.CanvasTexture {
  const { ctx, tex } = makeCanvasTexture(SIZE * 3, SIZE);
  function path(points: number[][], close = true): void {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x!, y!) : ctx.moveTo(x!, y!));
    if (close) ctx.closePath();
  }
  for (let wear = 0; wear < 3; wear++) {
    ctx.save();
    ctx.translate(wear * SIZE, 0);
    const enamel = ctx.createLinearGradient(38, 16, 192, 242);
    enamel.addColorStop(0, '#566d79'); enamel.addColorStop(0.32, '#273c4d');
    enamel.addColorStop(0.67, '#142531'); enamel.addColorStop(1, '#334858');
    ctx.fillStyle = enamel;
    path(OUTLINE); ctx.fill(); ctx.strokeStyle = '#b4cad0'; ctx.lineWidth = 8; ctx.stroke();
    ctx.lineWidth = 4; ctx.strokeStyle = '#101c26';
    for (const panel of PANELS) { path(panel); ctx.stroke(); }
    // A wide enamel brow, recessed viewport and physical corner fasteners read at phone scale.
    ctx.fillStyle = '#12232d'; ctx.fillRect(47, 43, 162, 27);
    ctx.fillStyle = '#70d8cd'; ctx.fillRect(52, 48, 58, 7); ctx.fillRect(146, 48, 58, 7);
    ctx.fillStyle = '#df9854';
    path([[36, 111], [66, 128], [62, 143], [36, 127]]); ctx.fill();
    path([[220, 111], [190, 128], [194, 143], [220, 127]]); ctx.fill();
    ctx.strokeStyle = '#8097a3'; ctx.lineWidth = 3;
    path([[108, 172], [128, 185], [148, 172]], false); ctx.stroke();
    for (const [x, y] of [[51, 35], [204, 35], [52, 171], [203, 171], [128, 216]]) {
      ctx.fillStyle = '#0b151c'; ctx.beginPath(); ctx.arc(x!, y!, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b8c8cc'; ctx.fillRect(x! - 2, y! - 2, 4, 2);
    }
    if (wear) {
      const cracks = [[[128, 100], [114, 113], [119, 123], [97, 137], [73, 148]],
        [[119, 123], [137, 143], [131, 166]], [[128, 100], [145, 90], [157, 92], [180, 74]]];
      if (wear === 2) cracks.push([[73, 148], [61, 159], [37, 165]], [[137, 143], [161, 148], [180, 169], [213, 175]],
        [[128, 100], [119, 79], [126, 68], [111, 40]]);
      for (const crack of cracks) {
        path(crack, false); ctx.strokeStyle = '#080e13'; ctx.lineWidth = 8; ctx.stroke();
        ctx.strokeStyle = wear === 2 ? '#ffbe73' : '#c1eee8'; ctx.lineWidth = 3; ctx.stroke();
      }
    }
    ctx.restore();
  }
  tex.needsUpdate = true;
  return tex;
}

function armourGeometry(): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], sides: number[] = [];
  PANELS.forEach((panel, i) => {
    const contour = panel.map(([x, y]) => new THREE.Vector2(x! / SIZE, 1 - y! / SIZE));
    for (const face of THREE.ShapeUtils.triangulateShape(contour, [])) {
      for (const index of face) {
        const { x, y } = contour[index]!;
        positions.push((x - 0.5) * 1.78, (y - 0.5) * 1.68, i === 1 ? 0.06 : 0);
        uvs.push(x, y); sides.push(i - 1);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('plateSide', new THREE.Float32BufferAttribute(sides, 1));
  return g;
}

export class RiotShields {
  private readonly states = new THREE.InstancedBufferAttribute(new Float32Array(48 * 4), 4).setUsage(THREE.DynamicDrawUsage);
  private readonly atlas = armourAtlas();
  private readonly transform = new THREE.Object3D();
  private readonly debris = Array.from({ length: 16 }, () => ({ x: 0, z: 0, scale: 1, age: 1 }));
  private cursor = 0;
  readonly mesh: THREE.InstancedMesh;

  constructor() {
    const g = armourGeometry();
    g.setAttribute('plateState', this.states);
    const mat = new THREE.MeshBasicMaterial({ map: this.atlas, side: THREE.DoubleSide, toneMapped: false });
    mat.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float plateSide; attribute vec4 plateState; varying vec4 vRiotImpact;\n' + shader.vertexShader
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRiotImpact = vec4(vMapUv, plateState.zw); vMapUv.x = (vMapUv.x + plateState.x) / 3.;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float t = plateState.y;
          float side = plateSide;
          float a = -side*t*1.35;
          transformed.xy = mat2(cos(a), sin(a), -sin(a), cos(a)) * transformed.xy;
          transformed.x += side*(0.016*plateState.x + t*1.25);
          transformed.y += t*(0.85 + abs(side)*0.55) - 2.3*t*t;
          transformed.z += t*(0.3 + abs(side)*0.55);`);
      shader.fragmentShader = 'varying vec4 vRiotImpact;\n' + shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         float dist = length(vRiotImpact.xy - vec2(0.5 + 0.34*vRiotImpact.z, 0.53));
         float heat = max(0., 1.-dist*5.) * vRiotImpact.w;
         diffuseColor.rgb += heat * vec3(1., 0.62, 0.24);`,
      );
    };
    this.mesh = new THREE.InstancedMesh(g, mat, 48);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.reset();
  }

  private write(i: number, x: number, y: number, z: number, scale: number, yaw: number, tile: number, age: number, impactX = 0, heat = 0): void {
    const t = this.transform;
    t.position.set(x, y, z);
    t.rotation.set(-0.11, yaw, 0);
    t.scale.setScalar(scale);
    t.updateMatrix();
    this.mesh.setMatrixAt(i, t.matrix);
    this.states.setXYZW(i, tile, age, impactX, heat);
  }

  guard(i: number, x: number, z: number, scale: number, yaw: number, hp: number, hit: number, impactX: number): void {
    this.write(i, x, scale, z + (0.84 - hit * 0.08) * scale, scale, yaw, hp > 0.67 ? 0 : hp > 0.3 ? 1 : 2, 0, impactX, hit);
  }

  shatter(x: number, z: number, scale: number): void {
    Object.assign(this.debris[this.cursor]!, { x, z, scale, age: 0 });
    this.cursor = (this.cursor + 1) % this.debris.length;
  }

  finish(count: number, dt: number): void {
    for (const part of this.debris) {
      if (part.age >= 0.48) continue;
      this.write(count++, part.x, part.scale, part.z + 0.84 * part.scale, part.scale, 0, 2, part.age / 0.48);
      part.age += dt;
    }
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    if (count) { this.mesh.instanceMatrix.needsUpdate = true; this.states.needsUpdate = true; }
  }

  reset(): void {
    this.mesh.count = 0; this.mesh.visible = false;
    for (const part of this.debris) part.age = 1;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose(); this.atlas.dispose();
  }
}
