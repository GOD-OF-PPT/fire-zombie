import * as THREE from 'three';

let sharedCelRamp: THREE.DataTexture | null = null;
let sharedOutlineMat: THREE.MeshBasicMaterial | null = null;

/**
 * Crisp 3-band commercial cartoon cel-shading ramp with 1-texel soft anti-aliased transitions
 * so curved heads/bodies never show jagged pixel stair-stepping, while shadows stay rich & clean.
 */
export function getToonGradientMap(): THREE.DataTexture {
  if (sharedCelRamp) return sharedCelRamp;
  // 16-texel luminance ramp: lifted shadow (142) -> midtone (206) -> bright lit (250) -> highlight (255)
  const stops = [
    142, 142, 142, 145, 168,
    204, 206, 206, 206, 210, 228,
    248, 250, 250, 252, 255,
  ];
  const data = new Uint8Array(stops.length * 4);
  for (let i = 0; i < stops.length; i++) {
    const v = stops[i]!;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, stops.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  sharedCelRamp = tex;
  return tex;
}

export interface ToonCharUniforms {
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
  uTint: { value: THREE.Color };
  uFlash: { value: number };
}

export interface ToonCharMaterialOptions {
  rimColor?: number;
  rimStrength?: number;
  vertexColors?: boolean;
  map?: THREE.Texture | null;
  color?: number;
}

/**
 * Stylized Q-version character/monster toon material:
 * - 3-band cel shading via MeshToonMaterial
 * - Crisp view-angle Fresnel rim light
 * - Per-actor uniform tint (cryo slow / overdrive gold) and non-clipping hit-flash
 * Shares a single compiled WebGLProgram across clones via customProgramCacheKey.
 */
export function createToonCharMaterial(opts: ToonCharMaterialOptions = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: opts.color ?? 0xffffff,
    gradientMap: getToonGradientMap(),
    vertexColors: opts.vertexColors ?? true,
    map: opts.map ?? null,
  });

  const uniforms: ToonCharUniforms = {
    uRimColor: { value: new THREE.Color(opts.rimColor ?? 0xaeeeff) },
    uRimStrength: { value: opts.rimStrength ?? 0.38 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uFlash: { value: 0 },
  };
  mat.userData.toonUniforms = uniforms;

  const applyHook = (target: THREE.MeshToonMaterial, uni: ToonCharUniforms): void => {
    target.customProgramCacheKey = () => 'prism-toon-char-v1';
    target.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = uni.uRimColor;
      shader.uniforms.uRimStrength = uni.uRimStrength;
      shader.uniforms.uTint = uni.uTint;
      shader.uniforms.uFlash = uni.uFlash;
      shader.fragmentShader =
        `uniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform vec3 uTint;\nuniform float uFlash;\n` +
        shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          /* glsl */ `
          float rimDot = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          float rim = smoothstep(0.52, 0.92, rimDot);
          outgoingLight *= uTint;
          outgoingLight += uRimColor * rim * uRimStrength;
          outgoingLight = mix(outgoingLight, vec3(1.12, 1.08, 1.04), clamp(uFlash, 0.0, 0.82));
          #include <opaque_fragment>
          `,
        );
    };
  };

  applyHook(mat, uniforms);

  const origClone = mat.clone.bind(mat);
  mat.clone = function cloneToon(): THREE.MeshToonMaterial {
    const c = origClone();
    const cUni: ToonCharUniforms = {
      uRimColor: { value: uniforms.uRimColor.value.clone() },
      uRimStrength: { value: uniforms.uRimStrength.value },
      uTint: { value: uniforms.uTint.value.clone() },
      uFlash: { value: uniforms.uFlash.value },
    };
    c.userData.toonUniforms = cUni;
    applyHook(c, cUni);
    return c;
  } as typeof mat.clone;

  return mat;
}

export function getToonUniforms(mat: THREE.Material): ToonCharUniforms | undefined {
  return mat.userData.toonUniforms as ToonCharUniforms | undefined;
}

const outlineGeoCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * Computes position-welded smooth vertex normals so inverted-hull cartoon outlines
 * stay 100% continuous across hard edges without corner gaps.
 */
export function buildOutlineGeometry(sourceGeo: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = outlineGeoCache.get(sourceGeo);
  if (cached) return cached;

  if (!sourceGeo.attributes.normal) sourceGeo.computeVertexNormals();
  const pos = sourceGeo.attributes.position!;
  const norm = sourceGeo.attributes.normal!;
  const count = pos.count;

  const buckets = new Map<string, [number, number, number]>();
  for (let i = 0; i < count; i++) {
    const kx = Math.round(pos.getX(i) * 1000);
    const ky = Math.round(pos.getY(i) * 1000);
    const kz = Math.round(pos.getZ(i) * 1000);
    const key = `${kx},${ky},${kz}`;
    let acc = buckets.get(key);
    if (!acc) {
      acc = [0, 0, 0];
      buckets.set(key, acc);
    }
    acc[0] += norm.getX(i);
    acc[1] += norm.getY(i);
    acc[2] += norm.getZ(i);
  }

  const smooth = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const kx = Math.round(pos.getX(i) * 1000);
    const ky = Math.round(pos.getY(i) * 1000);
    const kz = Math.round(pos.getZ(i) * 1000);
    const acc = buckets.get(`${kx},${ky},${kz}`)!;
    const len = Math.hypot(acc[0], acc[1], acc[2]) || 1;
    smooth[i * 3] = acc[0] / len;
    smooth[i * 3 + 1] = acc[1] / len;
    smooth[i * 3 + 2] = acc[2] / len;
  }

  // Share position/skinIndex/skinWeight/index buffers directly with sourceGeo (zero duplicate vertex RAM)
  const outlineGeo = new THREE.BufferGeometry();
  outlineGeo.setAttribute('position', pos);
  outlineGeo.setAttribute('normal', new THREE.BufferAttribute(smooth, 3));
  if (sourceGeo.attributes.skinIndex) outlineGeo.setAttribute('skinIndex', sourceGeo.attributes.skinIndex);
  if (sourceGeo.attributes.skinWeight) outlineGeo.setAttribute('skinWeight', sourceGeo.attributes.skinWeight);
  if (sourceGeo.index) outlineGeo.setIndex(sourceGeo.index);
  if (sourceGeo.boundingSphere) outlineGeo.boundingSphere = sourceGeo.boundingSphere.clone();
  if (sourceGeo.boundingBox) outlineGeo.boundingBox = sourceGeo.boundingBox.clone();
  outlineGeoCache.set(sourceGeo, outlineGeo);
  return outlineGeo;
}

/**
 * Screen-space aspect-corrected inverted-hull cartoon outline material.
 * Works identically on SkinnedMesh and regular Mesh regardless of bone/armature scale.
 */
export function getOutlineMaterial(ndcWidth = 0.0052, color = 0x090c1a): THREE.MeshBasicMaterial {
  if (sharedOutlineMat && ndcWidth === 0.0052 && color === 0x090c1a) return sharedOutlineMat;
  const mat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    fog: true,
  });
  const uWidth = { value: ndcWidth };
  mat.userData.uOutlineWidth = uWidth;
  mat.customProgramCacheKey = () => 'prism-toon-outline-v1';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineWidth = uWidth;
    shader.vertexShader =
      `uniform float uOutlineWidth;\n` +
      shader.vertexShader
        .replace(
          '#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )',
          '#if 1',
        )
        .replace(
          '#include <project_vertex>',
          /* glsl */ `
          vec4 mvPosition = vec4( transformed, 1.0 );
          #ifdef USE_BATCHING
            mvPosition = batchingMatrix * mvPosition;
          #endif
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
          #endif
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;
          vec2 viewN = normalize(transformedNormal.xy + vec2(1e-5));
          // Equal pixel width horizontally & vertically on any aspect ratio
          float aspectFix = projectionMatrix[0][0] / projectionMatrix[1][1];
          // Slight distance clamp so outlines thin gracefully far down the runway
          float distAtten = clamp(15.0 / max(-mvPosition.z, 6.0), 0.55, 1.18);
          vec2 offset = vec2(viewN.x * aspectFix, viewN.y) * (uOutlineWidth * distAtten);
          gl_Position.xy += offset * gl_Position.w;
          `,
        );
  };
  if (ndcWidth === 0.0052 && color === 0x090c1a) sharedOutlineMat = mat;
  return mat;
}
