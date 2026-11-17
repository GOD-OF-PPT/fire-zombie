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
const TRAFFIC_COUNT = 28;
const SEARCHLIGHT_COUNT = 8;

function billboardTexture(): THREE.CanvasTexture {
  const { ctx, tex } = makeCanvasTexture(1536, 256);
  const titles = ['PRISM', 'NOVA', 'AEGIS'];
  const subtitles = ['NEON PROTOCOL  //  V2', 'HYPER TRANSIT', 'PHASE SHIELD READY'];
  const accents = ['#62f4ff', '#ffc531', '#d29bff'];
  for (let panel = 0; panel < 3; panel++) {
    ctx.save();
    ctx.translate(panel * 512, 0);
    const bg = ctx.createLinearGradient(0, 0, 512, 256);
    bg.addColorStop(0, 'rgba(3,12,32,0.95)');
    bg.addColorStop(1, 'rgba(12,34,64,0.78)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = accents[panel]!;
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 496, 240);
    ctx.strokeStyle = 'rgba(180,240,255,0.18)';
    ctx.lineWidth = 2;
    for (let y = 28; y < 240; y += 24) {
      ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(498, y); ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${panel === 2 ? 62 : 70}px Arial, sans-serif`;
    ctx.fillText(titles[panel]!, 34, 102);
    ctx.fillStyle = accents[panel]!;
    ctx.font = '700 25px Arial, sans-serif';
    ctx.fillText(subtitles[panel]!, 38, 148);
    ctx.fillRect(38, 176, 286, 8);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 19px Arial, sans-serif';
    ctx.fillText(['OPTICAL TRANSIT NETWORK', 'SWARM LINK ESTABLISHED', 'TACTICAL PULSE ONLINE'][panel]!, 38, 216);
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
 * Instanced cyberpunk megacity layer: tower crowns, gantries, holographic billboards,
 * distant flying sky-traffic light trails, and sweeping atmospheric searchlight cones.
 */
export class EnvironmentDetail {
  readonly group = new THREE.Group();
  private readonly bands: THREE.InstancedMesh;
  private readonly crowns: THREE.InstancedMesh;
  private readonly antennas: THREE.InstancedMesh;
  private readonly gantries: THREE.InstancedMesh;
  private readonly billboards: THREE.InstancedMesh;
  private readonly traffic: THREE.InstancedMesh;
  private readonly searchlights: THREE.InstancedMesh;
  private readonly bandMat: THREE.MeshStandardMaterial;
  private readonly crownMat: THREE.MeshStandardMaterial;
  private readonly gantryMat: THREE.MeshStandardMaterial;
  private readonly billboardMat: THREE.MeshBasicMaterial;
  private readonly trafficMat: THREE.MeshBasicMaterial;
  private readonly searchlightMat: THREE.MeshBasicMaterial;
  private readonly starMat: THREE.PointsMaterial;
  private readonly dummy = new THREE.Object3D();

  constructor(private readonly towers: readonly TowerDatum[]) {
    const n = towers.length;
    this.bandMat = new THREE.MeshStandardMaterial({
      color: 0x315279,
      emissive: 0x3ef3ff,
      emissiveIntensity: 0.36,
      metalness: 0.72,
      roughness: 0.28,
    });
    this.bands = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.bandMat, n * 3);
    this.bands.frustumCulled = false;

    this.crownMat = new THREE.MeshStandardMaterial({
      color: 0x172a4b,
      emissive: 0x1c3468,
      emissiveIntensity: 0.32,
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
      emissiveIntensity: 0.22,
      metalness: 0.85,
      roughness: 0.32,
    });
    this.gantries = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.gantryMat, 48);
    this.gantries.frustumCulled = false;

    this.billboardMat = new THREE.MeshBasicMaterial({
      map: billboardTexture(),
      color: 0x9fefff,
      transparent: true,
      opacity: 0.9,
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

    // Distant flying neon sky-traffic streaks along multi-altitude lanes
    this.trafficMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.traffic = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.09, 2.4), this.trafficMat, TRAFFIC_COUNT);
    this.traffic.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TRAFFIC_COUNT * 3), 3);
    this.traffic.frustumCulled = false;

    // Sweeping megacity sky searchlights
    const coneGeo = new THREE.ConeGeometry(2.1, 26, 12, 1, true);
    coneGeo.translate(0, 13, 0);
    coneGeo.rotateZ(Math.PI);
    // Flip cone so narrow tip is at base (y=0) and wide beam fans upward (y=+26)
    const coneUp = new THREE.CylinderGeometry(2.3, 0.14, 26, 12, 1, true);
    coneUp.translate(0, 13, 0);
    coneGeo.dispose();
    this.searchlightMat = new THREE.MeshBasicMaterial({
      color: 0x48f5ff,
      transparent: true,
      opacity: 0.055,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      toneMapped: false,
    });
    this.searchlights = new THREE.InstancedMesh(coneUp, this.searchlightMat, SEARCHLIGHT_COUNT);
    this.searchlights.frustumCulled = false;

    const starPositions = new Float32Array(200 * 3);
    let seed = 19;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 200; i++) {
      starPositions[i * 3] = (rnd() - 0.5) * 155;
      starPositions[i * 3 + 1] = 8 + rnd() * 50;
      starPositions[i * 3 + 2] = -70 - rnd() * 105;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xbfe8ff,
      size: 0.34,
      map: makeGlowTexture(),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      fog: false,
    });
    const stars = new THREE.Points(starGeo, this.starMat);
    stars.frustumCulled = false;

    this.group.add(
      this.bands,
      this.crowns,
      this.antennas,
      this.gantries,
      this.billboards,
      this.traffic,
      this.searchlights,
      stars,
    );
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

    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      tint.set(i % 2 === 0 ? pal.edge : i % 3 === 0 ? 0xffa64d : pal.grid).multiplyScalar(0.92);
      this.traffic.setColorAt(i, tint);
    }
    if (this.traffic.instanceColor) this.traffic.instanceColor.needsUpdate = true;

    this.searchlightMat.color.set(pal.edge).lerp(new THREE.Color(0xffffff), 0.35);
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
    this.billboardMat.opacity = 0.8 + Math.sin(time * 0.8) * 0.06;

    // Update sky-traffic lanes (counter-flowing airborne light trails)
    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const dir = i % 4 < 2 ? 1 : -1;
      const speed = 18 + (i % 5) * 4.5;
      const laneX = side * (9.5 + (i % 4) * 3.8);
      const laneY = 2.2 + (i % 6) * 2.1;
      const rawZ = i * 9.7 + scroll * 0.85 + time * speed * dir;
      const z = -118 + (((rawZ % 134) + 134) % 134);
      d.position.set(laneX, laneY, z);
      d.rotation.set(0, 0, 0);
      d.scale.set(1, 1, 0.75 + (i % 3) * 0.35);
      d.updateMatrix();
      this.traffic.setMatrixAt(i, d.matrix);
    }
    this.traffic.instanceMatrix.needsUpdate = true;

    // Update sweeping volumetric megacity searchlights
    for (let i = 0; i < SEARCHLIGHT_COUNT; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -98 + i * 13.5;
      d.position.set(side * (12.5 + (i % 3) * 3.2), 2.5, z);
      const swayX = Math.sin(time * (0.45 + i * 0.07) + i * 1.9) * 0.24;
      const swayZ = -side * (0.28 + Math.cos(time * 0.38 + i) * 0.16);
      d.rotation.set(swayX, 0, swayZ);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this.searchlights.setMatrixAt(i, d.matrix);
    }
    this.searchlights.instanceMatrix.needsUpdate = true;
  }
}
