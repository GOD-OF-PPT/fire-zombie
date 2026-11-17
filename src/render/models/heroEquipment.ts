import * as THREE from 'three';
import { box, cone, cyl, oct, tor, GeoBuilder } from './kit';

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
  const dark = 0x152942;
  const steel = 0x587488;
  const ivory = 0xdbeaf0;
  const accent = heavy ? 0xffd666 : 0x4ef6ff;
  const coreGlow = heavy ? 0xff9d2e : 0x26d8ff;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true });

  const pack = new GeoBuilder()
    .add(box(0.46, 0.5, 0.22), dark, 0, { p: [0, 0.1, -0.3] })
    .add(box(0.34, 0.4, 0.085), steel, 0, { p: [0, 0.1, -0.43] })
    .add(box(0.26, 0.08, 0.024), accent, 0, { p: [0, 0.22, -0.482] })
    .add(oct(0.075), coreGlow, 0, { p: [0, 0.06, -0.485], s: [1, 1.35, 0.55] })
    .add(tor(0.095, 0.016, 5, 14), accent, 0, { p: [0, 0.06, -0.478] });

  for (const side of [-1, 1]) {
    pack.add(cyl(0.072, 0.078, 0.42, 10), ivory, 0, { p: [side * 0.235, 0.08, -0.33] });
    pack.add(cyl(0.082, 0.092, 0.08, 10), dark, 0, { p: [side * 0.235, -0.1, -0.33] });
    pack.add(cone(0.062, 0.13, 8).rotateX(Math.PI), accent, 0, { p: [side * 0.235, -0.19, -0.33] });
    pack.add(box(0.058, 0.16, 0.02), accent, 0, { p: [side * 0.235, 0.11, -0.408] });
    // Stabilizer winglets angled cleanly off the reactor pack
    pack.add(
      box(0.18, 0.045, 0.12),
      heavy ? ivory : steel,
      0,
      { p: [side * 0.31, 0.26, -0.34], r: [0.15, 0, -side * 0.38] },
    );
    pack.add(
      box(0.15, 0.018, 0.03),
      accent,
      0,
      { p: [side * 0.32, 0.285, -0.34], r: [0.15, 0, -side * 0.38] },
    );
  }
  for (let i = 0; i < 3; i++) {
    pack.add(box(0.21, 0.018, 0.03), dark, 0, { p: [0, -0.055 - i * 0.042, -0.478] });
  }
  const backpack = new THREE.Mesh(pack.build(), mat);
  backpack.name = 'Protocol_ReactorPack';
  torso.add(backpack);

  const helmet = new GeoBuilder();
  for (const side of [-1, 1]) {
    helmet.add(cyl(0.092, 0.092, 0.062, 12), steel, 0, { p: [side * 0.3, 0.3, 0.01], r: [0, 0, Math.PI / 2] });
    helmet.add(cyl(0.055, 0.055, 0.07, 12), accent, 0, { p: [side * 0.312, 0.3, 0.01], r: [0, 0, Math.PI / 2] });
  }
  // Tactical dorsal crest & dual comms antenna
  helmet.add(box(0.05, 0.065, 0.28), ivory, 0, { p: [0, 0.53, -0.02] });
  helmet.add(box(0.026, 0.03, 0.26), accent, 0, { p: [0, 0.568, -0.02] });
  helmet.add(cyl(0.012, 0.022, 0.21, 6), dark, 0, { p: [0.28, 0.47, -0.03], r: [0, 0, -0.12] });
  helmet.add(oct(0.026), accent, 0, { p: [0.3, 0.58, -0.03] });
  if (heavy) {
    helmet.add(cone(0.055, 0.2, 6), accent, 0, { p: [0, 0.62, 0.05], r: [-0.35, 0, 0] });
  }
  const comms = new THREE.Mesh(helmet.build(), mat);
  comms.name = 'Protocol_HelmetComms';
  head.add(comms);
}
