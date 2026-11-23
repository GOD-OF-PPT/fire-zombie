import * as THREE from 'three';
import { box, cyl, GeoBuilder, tor } from './models/kit';
import { makeCanvasTexture } from './textures';

/** Repeated bridge service units, built once and instanced rather than individual scene objects. */
export class Infrastructure {
  readonly group = new THREE.Group();
  private readonly modules: THREE.InstancedMesh;
  private readonly markings: THREE.InstancedMesh;
  private readonly d = new THREE.Object3D();

  constructor() {
    const b = new GeoBuilder();
    b.add(box(0.8, 0.28, 5.4), 0x293b52, 0, { p: [0, -0.14, 0] });
    b.add(box(0.76, 0.1, 5.1), 0x58677a, 0, { p: [0, 0.02, 0] });
    // Beam joints and spliced end plates remain visible beside the moving squad.
    for (const z of [-2.1, 0, 2.1]) {
      b.add(box(0.2, 0.10, 0.34), 0x617781, 0, { p: [0.32, 0.10, z] })
        .add(box(0.11, 0.49, 0.15), 0x314659, 0, { p: [0.32, 0.36, z] });
    }
    b.add(box(0.105, 0.14, 5.12), 0x7f959e, 0, { p: [0.32, 0.54, 0] })
      .add(box(0.14, 0.17, 0.44), 0xc19b62, 0, { p: [0.32, 0.54, -2.31] });
    b.add(box(0.42, 0.6, 1.2), 0x1d2b40, 0, { p: [0, 0.35, -1.6] });
    b.add(box(0.5, 0.08, 1.3), 0x718498, 0, { p: [0, 0.67, -1.6] });
    // Recessed heat exchangers and copper conduit.
    for (let i = 0; i < 6; i++) {
      b.add(box(0.34, 0.025, 0.065), 0x080f1e, 0, { p: [0, 0.718, -2 + i * 0.15] });
      b.add(box(0.62, 0.018, 0.08), 0x202e3e, 0, { p: [0, 0.085, -0.3 + i * 0.28] });
    }
    for (const x of [-0.23, 0.23]) {
      b.add(cyl(0.045, 0.045, 2.5, 8), 0xa67a46, 0, { p: [x, 0.16, 0.6], r: [Math.PI / 2, 0, 0] });
      for (const z of [-0.5, 1.5]) b.add(tor(0.064, 0.023, 4, 8), 0xc1cbd1, 0, { p: [x, 0.16, z] });
    }
    b.add(box(0.09, 0.3, 0.4), 0x50cad7, 0, { p: [-0.23, 0.36, -1.6] });
    b.add(box(0.4, 2.2, 0.35), 0x172337, 0, { p: [0.12, -1.25, -1.5] });
    b.add(box(0.2, 1.8, 0.24), 0x344d65, 0, { p: [-0.25, -0.9, -1.5], r: [0, 0, -0.35] });
    this.modules = new THREE.InstancedMesh(b.build(), new THREE.MeshStandardMaterial({
      vertexColors: true, metalness: 0.38, roughness: 0.5,
    }), 40);
    this.modules.frustumCulled = false;

    const { ctx, tex } = makeCanvasTexture(512, 1024);
    ctx.clearRect(0, 0, 512, 1024);
    // Painted maintenance stencil and diagonal caution tape, with deliberate open space.
    ctx.strokeStyle = '#a1b8c7'; ctx.lineWidth = 3;
    ctx.strokeRect(54, 60, 404, 900);
    ctx.font = '700 120px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = '#b4cedb'; ctx.fillText('07', 256, 290);
    ctx.font = '700 30px monospace'; ctx.fillText('PRISM //', 256, 365);
    ctx.fillText('TRANSIT', 256, 415);
    ctx.font = '700 22px monospace'; ctx.fillText('KEEP CLEAR', 256, 775);
    ctx.strokeStyle = '#8ca9b9'; ctx.lineWidth = 8;
    for (let i = 0; i < 3; i++) {
      const y = 510 + i * 57;
      ctx.beginPath(); ctx.moveTo(185, y + 28); ctx.lineTo(256, y); ctx.lineTo(327, y + 28); ctx.stroke();
    }
    ctx.save(); ctx.beginPath(); ctx.rect(56, 855, 400, 74); ctx.clip();
    ctx.fillStyle = '#ca9d55';
    for (let x = -100; x < 600; x += 84) {
      ctx.beginPath(); ctx.moveTo(x, 855); ctx.lineTo(x + 35, 855); ctx.lineTo(x + 109, 929); ctx.lineTo(x + 74, 929); ctx.fill();
    }
    ctx.restore(); tex.needsUpdate = true;
    this.markings = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.95, 3.8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    }), 20);
    this.markings.frustumCulled = false;
    this.group.add(this.modules, this.markings);
  }

  update(scroll: number): void {
    const d = this.d;
    for (let i = 0; i < 20; i++) {
      const z = -170 + ((((i * 9 + scroll) % 180) + 180) % 180);
      for (let side = 0; side < 2; side++) {
        d.position.set((side ? 1 : -1) * 5.95, 0, z);
        d.rotation.set(0, side ? 0 : Math.PI, 0);
        d.updateMatrix(); this.modules.setMatrixAt(i * 2 + side, d.matrix);
      }
      d.position.set(i % 2 ? 3.95 : -3.95, 0.018, z);
      d.rotation.set(0, 0, 0); d.updateMatrix();
      this.markings.setMatrixAt(i, d.matrix);
    }
    this.modules.instanceMatrix.needsUpdate = true;
    this.markings.instanceMatrix.needsUpdate = true;
  }
}
