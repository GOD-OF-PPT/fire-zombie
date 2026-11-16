import * as THREE from 'three';
import { makeCanvasTexture, makeGlowTexture } from './textures';

export interface TowerDatum {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

interface DetailPalette {
  track: number;
  grid: number;
  edge: number;
  fog: number;
}

const CITY_SPAN = 130;

function billboardTexture(): THREE.CanvasTexture {
  const { ctx, tex } = makeCanvasTexture(1536, 256);
  const titles = ['PRISM', 'NOVA', 'SECTOR'];
  const subtitles = ['NEON PROTOCOL  //  07', 'OPTICAL TRANSIT', 'AUTHORIZED ROUTE'];
  const accents = ['#8ffaff', '#ffc531', '#c29bff'];
  for (let panel = 0; panel < 3; panel++) {
    ctx.save();
    ctx.translate(panel * 512, 0);
    const bg = ctx.createLinearGradient(0, 0, 512, 256);
    bg.addColorStop(0, 'rgba(2,12,30,0.94)');
    bg.addColorStop(1, 'rgba(10,32,58,0.72)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = accents[panel]!;
    ctx.lineWidth = 5;
    ctx.strokeRect(8, 8, 496, 240);
    ctx.strokeStyle = 'rgba(180,240,255,0.2)';
    ctx.lineWidth = 2;
    for (let y = 28; y < 240; y += 24) {
      ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(498, y); ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${panel === 2 ? 58 : 70}px Arial, sans-serif`;
    ctx.fillText(titles[panel]!, 34, 102);
    ctx.fillStyle = accents[panel]!;
    ctx.font = '700 25px Arial, sans-serif';
    ctx.fillText(subtitles[panel]!, 38, 148);
    ctx.fillRect(38, 176, 278, 8);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 19px Arial, sans-serif';
    ctx.fillText(['OPTICAL TRANSIT NETWORK', 'SWARM LINK ESTABLISHED', 'GATE CONTROL ONLINE'][panel]!, 38, 216);
    ctx.strokeStyle = accents[panel]!;
    ctx.fillStyle = accents[panel]!;
    ctx.lineWidth = 10;
    if (panel === 0) {
      ctx.beginPath();
      ctx.moveTo(422, 64); ctx.lineTo(474, 128); ctx.lineTo(422, 192); ctx.lineTo(422, 152);
      ctx.lineTo(378, 152); ctx.lineTo(378, 104); ctx.lineTo(422, 104); ctx.closePath(); ctx.fill();
    } else if (panel === 1) {
      ctx.beginPath(); ctx.arc(426, 126, 54, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(426, 72); ctx.lineTo(472, 126); ctx.lineTo(426, 180); ctx.lineTo(380, 126); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(426, 126, 12, 0, Math.PI * 2); ctx.fill();
    } else {
      for (let i = 0; i < 3; i++) ctx.fillRect(382 + i * 34, 76 + i * 18, 18, 100 - i * 36);
    }
    ctx.restore();
  }
  tex.needsUpdate = true;
  return tex;
}

/**
 * Instanced architectural detail layer. Adds silhouette and material variety for a handful of
 * draw calls, independently from the simulation and actor pools.
 */
export class EnvironmentDetail {
  readonly group = new THREE.Group();
  private readonly bands: THREE.InstancedMesh;
  private readonly crowns: THREE.InstancedMesh;
  private readonly antennas: THREE.InstancedMesh;
  private readonly gantries: THREE.InstancedMesh;
  private readonly billboards: THREE.InstancedMesh;
  private readonly bandMat: THREE.MeshStandardMaterial;
  private readonly crownMat: THREE.MeshStandardMaterial;
  private readonly gantryMat: THREE.MeshStandardMaterial;
  private readonly billboardMat: THREE.MeshBasicMaterial;
  private readonly starMat: THREE.PointsMaterial;
  private readonly dummy = new THREE.Object3D();

  constructor(private readonly towers: readonly TowerDatum[]) {
    const n = towers.length;
    this.bandMat = new THREE.MeshStandardMaterial({
      color: 0x315279,
      emissive: 0x3ef3ff,
      emissiveIntensity: 0.32,
      metalness: 0.72,
      roughness: 0.28,
    });
    this.bands = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.bandMat, n * 3);
    this.bands.frustumCulled = false;

    this.crownMat = new THREE.MeshStandardMaterial({
      color: 0x172a4b,
      emissive: 0x1c3468,
      emissiveIntensity: 0.3,
      metalness: 0.82,
      roughness: 0.3,
    });
    const crownGeo = new THREE.CylinderGeometry(0.56, 0.78, 1, 6, 1, false);
    crownGeo.translate(0, 0.5, 0);
    this.crowns = new THREE.InstancedMesh(crownGeo, this.crownMat, n);
    this.crowns.frustumCulled = false;

    this.antennas = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.055, 1, 5), this.bandMat, n);
    this.antennas.frustumCulled = false;

    this.gantryMat = new THREE.MeshStandardMaterial({
      color: 0x1a2d4c,
      emissive: 0x3ef3ff,
      emissiveIntensity: 0.18,
      metalness: 0.85,
      roughness: 0.32,
    });
    this.gantries = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.gantryMat, 48);
    this.gantries.frustumCulled = false;

    this.billboardMat = new THREE.MeshBasicMaterial({
      map: billboardTexture(),
      color: 0x9fefff,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.billboardMat.customProgramCacheKey = () => 'prism-billboard-atlas-v1';
    this.billboardMat.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute float panelIndex;\n${shader.vertexShader}`.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv.x = (vMapUv.x + panelIndex) / 3.0;\n#endif',
      );
    };
    const billboardGeo = new THREE.PlaneGeometry(3.8, 1.9);
    billboardGeo.setAttribute(
      'panelIndex',
      new THREE.InstancedBufferAttribute(new Float32Array(Array.from({ length: 12 }, (_, i) => i % 3)), 1),
    );
    this.billboards = new THREE.InstancedMesh(billboardGeo, this.billboardMat, 12);
    this.billboards.frustumCulled = false;

    const starPositions = new Float32Array(180 * 3);
    let seed = 19;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 180; i++) {
      starPositions[i * 3] = (rnd() - 0.5) * 150;
      starPositions[i * 3 + 1] = 8 + rnd() * 48;
      starPositions[i * 3 + 2] = -70 - rnd() * 100;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xbfe8ff,
      size: 0.32,
      map: makeGlowTexture(),
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      fog: false,
    });
    const stars = new THREE.Points(starGeo, this.starMat);
    stars.frustumCulled = false;

    this.group.add(this.bands, this.crowns, this.antennas, this.gantries, this.billboards, stars);
  }

  setPalette(pal: DetailPalette): void {
    this.bandMat.color.set(pal.track).multiplyScalar(1.5);
    this.bandMat.emissive.set(pal.grid);
    this.crownMat.color.set(pal.track).multiplyScalar(0.7);
    this.crownMat.emissive.set(pal.track);
    this.gantryMat.color.set(pal.track).multiplyScalar(0.85);
    this.gantryMat.emissive.set(pal.edge);
    this.billboardMat.color.set(0xffffff);
    const tint = new THREE.Color();
    for (let i = 0; i < 12; i++) {
      tint.set(i % 3 === 0 ? pal.edge : i % 3 === 1 ? pal.grid : 0xffffff).lerp(new THREE.Color(0xffffff), 0.58);
      this.billboards.setColorAt(i, tint);
    }
    if (this.billboards.instanceColor) this.billboards.instanceColor.needsUpdate = true;
    this.starMat.color.set(pal.edge).lerp(new THREE.Color(0xffffff), 0.62);
  }

  update(scroll: number, time: number): void {
    const d = this.dummy;
    let antennaIndex = 0;
    for (let i = 0; i < this.towers.length; i++) {
      const tw = this.towers[i]!;
      const z = -112 + ((((tw.z + scroll * 0.9) % CITY_SPAN) + CITY_SPAN) % CITY_SPAN);
      for (let band = 0; band < 3; band++) {
        const y = band === 2 ? tw.h - 0.15 : tw.h * (band === 0 ? 0.28 : 0.64);
        d.position.set(tw.x, -0.6 + y, z);
        d.rotation.set(0, 0, 0);
        d.scale.set(tw.w * 1.025, band === 2 ? 0.11 : 0.065, tw.d * 1.025);
        d.updateMatrix();
        this.bands.setMatrixAt(i * 3 + band, d.matrix);
      }
      const crownH = 0.65 + (i % 4) * 0.28;
      d.position.set(tw.x, -0.55 + tw.h, z);
      d.scale.set(tw.w * 0.7, crownH, tw.d * 0.7);
      d.updateMatrix();
      this.crowns.setMatrixAt(i, d.matrix);

      if (tw.h > 7 && i % 2 === 0) {
        const ah = 1.4 + (i % 5) * 0.35;
        d.position.set(tw.x + tw.w * 0.14, tw.h + crownH + ah * 0.5 - 0.55, z);
        d.scale.set(1, ah, 1);
        d.updateMatrix();
        this.antennas.setMatrixAt(antennaIndex++, d.matrix);
      }
    }
    this.antennas.count = antennaIndex;
    this.bands.instanceMatrix.needsUpdate = true;
    this.crowns.instanceMatrix.needsUpdate = true;
    this.antennas.instanceMatrix.needsUpdate = true;

    let gi = 0;
    for (let i = 0; i < 12; i++) {
      const z = -128 + ((((i * 12 + scroll * 0.9) % 144) + 144) % 144);
      for (const side of [-1, 1]) {
        d.position.set(side * 5.85, 1.85, z);
        d.rotation.set(0, 0, 0);
        d.scale.set(0.18, 3.7, 0.22);
        d.updateMatrix();
        this.gantries.setMatrixAt(gi++, d.matrix);
        d.position.set(side * 6.45, 3.66, z);
        d.scale.set(1.35, 0.16, 0.22);
        d.updateMatrix();
        this.gantries.setMatrixAt(gi++, d.matrix);
      }
    }
    this.gantries.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < 12; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -120 + ((((i * 11.3 + scroll * 0.9) % 136) + 136) % 136);
      const y = 3.3 + (i % 3) * 1.35;
      d.position.set(side * (7.3 + (i % 3) * 0.8), y, z);
      d.rotation.set(0, -side * 0.32, 0);
      const pulse = 0.94 + Math.sin(time * 1.4 + i * 2.1) * 0.04;
      d.scale.set(pulse, pulse, pulse);
      d.updateMatrix();
      this.billboards.setMatrixAt(i, d.matrix);
    }
    this.billboards.instanceMatrix.needsUpdate = true;
    this.billboardMat.opacity = 0.78 + Math.sin(time * 0.8) * 0.06;
  }
}
