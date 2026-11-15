// Builds compact, palette-tuned CC0 .glb models into public/models/ from /tmp/qmodels sources.
// Usage: node scripts/build-models.mjs
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = process.env.QMODELS_DIR ?? '/tmp/qmodels';
const OUT_DIR = path.resolve('public/models');
fs.mkdirSync(OUT_DIR, { recursive: true });

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToLinearRgba(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  return [
    +srgbToLinear(r).toFixed(5),
    +srgbToLinear(g).toFixed(5),
    +srgbToLinear(b).toFixed(5),
    1,
  ];
}

function readGltfOrGlb(filePath) {
  if (filePath.endsWith('.gltf')) {
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const uri = json.buffers[0].uri;
    const bin = Buffer.from(uri.split(',')[1], 'base64');
    return { json, bin };
  }
  const buf = fs.readFileSync(filePath);
  const magic = buf.toString('utf8', 0, 4);
  if (magic !== 'glTF') throw new Error(`Invalid GLB header in ${filePath}`);
  const jlen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8'));
  const blen = buf.readUInt32LE(20 + jlen);
  const bin = buf.subarray(28 + jlen, 28 + jlen + blen);
  return { json, bin };
}

function stripClipPrefix(name) {
  const idx = name.indexOf('|');
  return idx >= 0 ? name.slice(idx + 1) : name;
}

/**
 * Optimizes a parsed glTF+bin:
 * - Removes mesh attachment on excluded node names
 * - Filters & renames animation clips (strips "CharacterArmature|")
 * - Remaps material baseColorFactor to vibrant Q-version cartoon palette
 * - Strips KHR_materials_unlit so Three.js MeshToonMaterial lights the mesh cleanly
 * - Garbage-collects unreferenced meshes, accessors, and bufferViews, repacking a tight GLB
 */
function buildCompactGlb({ src, out, keepAnims, dropMeshNodeNames = [], palette = {} }) {
  const { json, bin } = readGltfOrGlb(path.join(SRC_DIR, src));

  // 1. Strip unlit extension if present so cel-shading works uniformly
  if (json.extensionsUsed) {
    json.extensionsUsed = json.extensionsUsed.filter((e) => e !== 'KHR_materials_unlit');
    if (json.extensionsUsed.length === 0) delete json.extensionsUsed;
  }
  for (const mat of json.materials ?? []) {
    if (mat.extensions?.KHR_materials_unlit) {
      delete mat.extensions.KHR_materials_unlit;
      if (Object.keys(mat.extensions).length === 0) delete mat.extensions;
    }
    mat.pbrMetallicRoughness ??= {};
    mat.pbrMetallicRoughness.metallicFactor = 0;
    mat.pbrMetallicRoughness.roughnessFactor = 0.85;
    if (palette[mat.name]) {
      mat.pbrMetallicRoughness.baseColorFactor = hexToLinearRgba(palette[mat.name]);
    }
  }

  // 2. Drop unwanted weapon meshes on nodes while preserving node indices
  const dropSet = new Set(dropMeshNodeNames);
  for (const node of json.nodes ?? []) {
    if (dropSet.has(node.name) && node.mesh !== undefined) {
      delete node.mesh;
    }
  }

  // 3. Filter and clean animation clip names
  const keepSet = new Set(keepAnims);
  json.animations = (json.animations ?? [])
    .map((anim) => ({ ...anim, name: stripClipPrefix(anim.name ?? '') }))
    .filter((anim) => keepSet.has(anim.name));

  // 4. Mark referenced meshes -> accessors -> bufferViews
  const usedMeshes = new Set();
  for (const node of json.nodes ?? []) {
    if (node.mesh !== undefined) usedMeshes.add(node.mesh);
  }
  const meshRemap = new Map();
  const newMeshes = [];
  (json.meshes ?? []).forEach((m, oldIdx) => {
    if (usedMeshes.has(oldIdx)) {
      meshRemap.set(oldIdx, newMeshes.length);
      newMeshes.push(m);
    }
  });
  json.meshes = newMeshes;
  for (const node of json.nodes ?? []) {
    if (node.mesh !== undefined) node.mesh = meshRemap.get(node.mesh);
  }

  const usedAccessors = new Set();
  const markAcc = (idx) => {
    if (idx !== undefined && idx !== null) usedAccessors.add(idx);
  };
  for (const m of json.meshes) {
    for (const prim of m.primitives) {
      markAcc(prim.indices);
      for (const k of Object.values(prim.attributes)) markAcc(k);
      for (const t of prim.targets ?? []) {
        for (const k of Object.values(t)) markAcc(k);
      }
    }
  }
  for (const skin of json.skins ?? []) {
    markAcc(skin.inverseBindMatrices);
  }
  for (const anim of json.animations ?? []) {
    for (const s of anim.samplers) {
      markAcc(s.input);
      markAcc(s.output);
    }
  }

  const accRemap = new Map();
  const newAccessors = [];
  (json.accessors ?? []).forEach((acc, oldIdx) => {
    if (usedAccessors.has(oldIdx)) {
      accRemap.set(oldIdx, newAccessors.length);
      newAccessors.push(acc);
    }
  });
  json.accessors = newAccessors;

  for (const m of json.meshes) {
    for (const prim of m.primitives) {
      if (prim.indices !== undefined) prim.indices = accRemap.get(prim.indices);
      for (const [k, v] of Object.entries(prim.attributes)) prim.attributes[k] = accRemap.get(v);
      for (const t of prim.targets ?? []) {
        for (const [k, v] of Object.entries(t)) t[k] = accRemap.get(v);
      }
    }
  }
  for (const skin of json.skins ?? []) {
    if (skin.inverseBindMatrices !== undefined) {
      skin.inverseBindMatrices = accRemap.get(skin.inverseBindMatrices);
    }
  }
  for (const anim of json.animations ?? []) {
    for (const s of anim.samplers) {
      s.input = accRemap.get(s.input);
      s.output = accRemap.get(s.output);
    }
  }

  const usedViews = new Set();
  for (const acc of json.accessors) {
    if (acc.bufferView !== undefined) usedViews.add(acc.bufferView);
    if (acc.sparse) {
      usedViews.add(acc.sparse.indices.bufferView);
      usedViews.add(acc.sparse.values.bufferView);
    }
  }
  for (const img of json.images ?? []) {
    if (img.bufferView !== undefined) usedViews.add(img.bufferView);
  }

  const viewRemap = new Map();
  const newViews = [];
  const chunks = [];
  let byteOffset = 0;

  (json.bufferViews ?? []).forEach((bv, oldIdx) => {
    if (!usedViews.has(oldIdx)) return;
    const srcStart = bv.byteOffset ?? 0;
    const slice = bin.subarray(srcStart, srcStart + bv.byteLength);
    const pad = (4 - (slice.length % 4)) % 4;
    const copy = Buffer.alloc(slice.length + pad);
    slice.copy(copy, 0);
    viewRemap.set(oldIdx, newViews.length);
    newViews.push({
      ...bv,
      buffer: 0,
      byteOffset,
      byteLength: slice.length,
    });
    chunks.push(copy);
    byteOffset += copy.length;
  });

  json.bufferViews = newViews;
  for (const acc of json.accessors) {
    if (acc.bufferView !== undefined) acc.bufferView = viewRemap.get(acc.bufferView);
    if (acc.sparse) {
      acc.sparse.indices.bufferView = viewRemap.get(acc.sparse.indices.bufferView);
      acc.sparse.values.bufferView = viewRemap.get(acc.sparse.values.bufferView);
    }
  }
  for (const img of json.images ?? []) {
    if (img.bufferView !== undefined) img.bufferView = viewRemap.get(img.bufferView);
  }

  const newBin = Buffer.concat(chunks);
  json.buffers = [{ byteLength: newBin.length }];

  const jsonStr = JSON.stringify(json);
  const jsonBufRaw = Buffer.from(jsonStr, 'utf8');
  const jsonPad = (4 - (jsonBufRaw.length % 4)) % 4;
  const jsonBuf = Buffer.alloc(jsonBufRaw.length + jsonPad, 0x20);
  jsonBufRaw.copy(jsonBuf, 0);

  const totalLen = 12 + 8 + jsonBuf.length + 8 + newBin.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 4, 'utf8');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLen, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // JSON

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(newBin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // BIN\0

  const outPath = path.join(OUT_DIR, out);
  fs.writeFileSync(outPath, Buffer.concat([header, jsonHeader, jsonBuf, binHeader, newBin]));
  const kb = (totalLen / 1024).toFixed(1);
  console.log(`Built ${out.padEnd(20)} ${kb.padStart(7)} KB | anims=[${json.animations.map((a) => a.name).join(', ')}]`);
}

const UNUSED_HERO_WEAPONS = [
  'AK',
  'Knife_1',
  'Knife_2',
  'Pistol',
  'Revolver',
  'Revolver_Small',
  'ShortCannon',
  'Shovel',
  'Sniper_2',
];

// 1. Player Squad (Quaternius Toon Shooter Game Kit + Animated Mech Pack, CC0)
buildCompactGlb({
  src: 'Character_Soldier.gltf',
  out: 'hero_trooper.glb',
  keepAnims: ['Run_Shoot', 'Idle_Shoot', 'Death', 'Wave'],
  dropMeshNodeNames: UNUSED_HERO_WEAPONS,
  palette: {
    Character_Main: '#2ed3ff',
    Pants: '#1e3f80',
    Skin: '#ffbe92',
    DarkGrey: '#384e78',
    Grey: '#c6e0ff',
    Grey2: '#6682ad',
    LightGrey: '#eef7ff',
    Black: '#2257d8',
    Red: '#ff4757',
    Wood: '#ff9a3c',
    DarkWood: '#334872',
  },
});

buildCompactGlb({
  src: 'Character_Hazmat.gltf',
  out: 'hero_heavy.glb',
  keepAnims: ['Run_Shoot', 'Idle_Shoot', 'Death', 'Wave'],
  dropMeshNodeNames: UNUSED_HERO_WEAPONS,
  palette: {
    Hazmat_Main: '#ffbe24',
    DarkGrey: '#354b73',
    Grey: '#c4dcf8',
    Grey2: '#6882ab',
    LightGrey: '#fff6d8',
    Black: '#203259',
    Red: '#ff5252',
    Wood: '#ff9a3c',
    DarkWood: '#334872',
  },
});

buildCompactGlb({
  src: 'Stan.glb',
  out: 'hero_mech.glb',
  keepAnims: ['Run', 'Shoot', 'Idle', 'HitRecieve_1', 'Death'],
});

// 2. Monster Roster (Quaternius Ultimate Monsters, CC0)
buildCompactGlb({
  src: 'm_spiky_blob.glb',
  out: 'enemy_crawler.glb',
  keepAnims: ['Walk', 'Bite_Front', 'HitRecieve', 'Death', 'Idle'],
  palette: {
    Green_Main: '#ff2e55',
    Eye_White: '#ffffff',
    Eye_Black: '#0c1020',
  },
});

buildCompactGlb({
  src: 'm_dino.glb',
  out: 'enemy_dasher.glb',
  keepAnims: ['Run', 'Duck', 'Punch', 'HitReact', 'Death', 'Idle'],
  palette: {
    Dino_Main: '#ff6b1a',
    Dino_Secondary: '#ffe047',
    Dino_Teeth: '#ffffff',
    Dino_Tongue: '#ff2965',
    Eye_White: '#ffffff',
    Eye_Black: '#0c1020',
  },
});

buildCompactGlb({
  src: 'm_blue_demon.glb',
  out: 'enemy_bastion.glb',
  keepAnims: ['Walk', 'Run', 'Weapon', 'Punch', 'HitReact', 'Death', 'Idle'],
  palette: {
    BlueDemon_Main: '#d91e44',
    BlueDemon_Secondary: '#ffc531',
    Wood: '#6b4228',
    Straps: '#2d3754',
    Eye_White: '#ffffff',
    Eye_Black: '#0c1020',
  },
});

buildCompactGlb({
  src: 'm_slime.glb',
  out: 'enemy_mitosis.glb',
  keepAnims: ['Walk', 'Jump', 'Bite_Front', 'HitRecieve', 'Death', 'Idle'],
  palette: {
    Pink_Main: '#ff3bd4',
    Pink_Secondary: '#9f2bff',
    Eye_White: '#ffffff',
    Eye_Black: '#0c1020',
  },
});

buildCompactGlb({
  src: 'm_ghost_skull.glb',
  out: 'enemy_siphon.glb',
  keepAnims: ['Fast_Flying', 'Flying_Idle', 'Headbutt', 'HitReact', 'Death'],
  palette: {
    Ghost_Main: '#8c38ff',
    Ghost_Secondary: '#fff7eb',
  },
});

// 3. Sector Bosses (Quaternius Ultimate Monsters, CC0)
buildCompactGlb({
  src: 'm_golem.glb',
  out: 'boss_warden.glb',
  keepAnims: ['Flying_Idle', 'Fast_Flying', 'Punch', 'Headbutt', 'HitReact', 'Death'],
  palette: {
    Goleling_Main: '#e62248',
    Goleling_Secondary: '#3b1638',
    Gold: '#ffd438',
    Goleling_Teeth: '#fff8ee',
    Eye_White: '#fff59d',
    Eye_Black: '#0c1020',
  },
});

buildCompactGlb({
  src: 'm_dragon_evolved.glb',
  out: 'boss_hydra_a.glb',
  keepAnims: ['Fast_Flying', 'Flying_Idle', 'Headbutt', 'Punch', 'HitReact', 'Death'],
  palette: {
    Dragon_Main: '#c92bff',
    Dragon_Secondary: '#ff4fd8',
    Dragon_Horn: '#ffe055',
    Eye_White: '#ffffff',
    Eye_Black: '#0c1020',
  },
});

buildCompactGlb({
  src: 'm_dragon.glb',
  out: 'boss_hydra_b.glb',
  keepAnims: ['Fast_Flying', 'Flying_Idle', 'Headbutt', 'Punch', 'HitReact', 'Death'],
  palette: {
    Dragon_Main: '#14d2ff',
    Dragon_Secondary: '#3b5bff',
    Dragon_Horn: '#ffe055',
    Eye_White: '#ffffff',
    Eye_Black: '#0c1020',
  },
});

buildCompactGlb({
  src: 'm_demon.glb',
  out: 'boss_omega.glb',
  keepAnims: ['Idle', 'Walk', 'Weapon', 'Punch', 'Jump', 'HitReact', 'Death'],
  palette: {
    Demon_Main: '#eb1c44',
    Black: '#44206e',
    Eye_White: '#ffe855',
    Eye_Black: '#0c1020',
  },
});
