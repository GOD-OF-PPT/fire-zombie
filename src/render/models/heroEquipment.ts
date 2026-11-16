import * as THREE from 'three';
import { box, cyl, GeoBuilder } from './kit';

/** Authored kitbash, folded into the existing skin by buildTemplate: no per-soldier draw calls. */
export function addHeroEquipment(scene: THREE.Group, heavy: boolean): void {
  let torso: THREE.Bone | undefined;
  let head: THREE.Bone | undefined;
  scene.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    if (o.name === 'Torso') torso = o as THREE.Bone;
    if (o.name === 'Head') head = o as THREE.Bone;
  });
  if (!torso || !head) return;
  const dark = 0x172f48;
  const steel = 0x526b7c;
  const ivory = 0xc7d7d9;
  const accent = heavy ? 0xffd47b : 0x71e2ed;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
  const pack = new GeoBuilder()
    .add(box(0.45, 0.49, 0.21), dark, 0, { p: [0, 0.1, -0.3] })
    .add(box(0.32, 0.39, 0.08), steel, 0, { p: [0, 0.1, -0.43] })
    .add(box(0.24, 0.075, 0.02), accent, 0, { p: [0, 0.21, -0.48] })
    .add(box(0.065, 0.28, 0.025), ivory, 0, { p: [0, 0.02, -0.48] });
  for (const side of [-1, 1]) {
    pack.add(cyl(0.07, 0.07, 0.4, 10), ivory, 0, { p: [side * 0.23, 0.08, -0.33] });
    pack.add(cyl(0.076, 0.076, 0.065, 10), dark, 0, { p: [side * 0.23, -0.08, -0.33] });
    pack.add(box(0.055, 0.15, 0.018), accent, 0, { p: [side * 0.23, 0.1, -0.404] });
  }
  for (let i = 0; i < 3; i++) pack.add(box(0.2, 0.018, 0.03), dark, 0, { p: [0, -0.025 - i * 0.045, -0.477] });
  const backpack = new THREE.Mesh(pack.build(), mat);
  backpack.name = 'Protocol_ReactorPack';
  torso.add(backpack);

  const helmet = new GeoBuilder();
  for (const side of [-1, 1]) {
    helmet.add(cyl(0.09, 0.09, 0.06, 12), steel, 0, { p: [side * 0.3, 0.3, 0.01], r: [0, 0, Math.PI / 2] });
    helmet.add(cyl(0.052, 0.052, 0.067, 12), accent, 0, { p: [side * 0.31, 0.3, 0.01], r: [0, 0, Math.PI / 2] });
  }
  helmet.add(cyl(0.012, 0.022, 0.19, 6), dark, 0, { p: [0.28, 0.46, -0.03], r: [0, 0, -0.12] });
  const comms = new THREE.Mesh(helmet.build(), mat);
  comms.name = 'Protocol_HelmetComms';
  head.add(comms);
}
