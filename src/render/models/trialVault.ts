import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Optional, non-commercial Tripo art trial. Keep PBR maps instead of baking them into toon colours. */
export async function loadTrialVault(): Promise<THREE.Group> {
  const base = import.meta.env.BASE_URL ?? '/';
  const gltf = await new GLTFLoader().loadAsync(`${base}models/tripo/energy_vault.glb`);
  const model = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('Invalid trial vault bounds');
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = Math.min(1.95 / size.y, 2.3 / Math.max(size.x, size.z));
  const root = new THREE.Group();
  root.name = 'Tripo_EnergyVault_Trial';
  root.userData.tripoTrial = true;
  model.scale.multiplyScalar(scale);
  model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const mat = material as THREE.MeshStandardMaterial;
      for (const map of [mat.map, mat.normalMap, mat.metalnessMap, mat.roughnessMap]) {
        if (map) map.anisotropy = 4;
      }
    }
  });
  root.add(model);
  return root;
}
