import * as THREE from 'three';

let sharedCelRamp: THREE.DataTexture | null = null;
const outlineMats = new Map<string, THREE.MeshBasicMaterial>();

/**
 * Soft toon ramp with deeper shadows and smooth transitions, keeping curved armour readable
 * at gameplay scale without hard bands or jagged highlight edges.
 */
export function getToonGradientMap(): THREE.DataTexture {
  if (sharedCelRamp) return sharedCelRamp;
  // Sixteen luminance samples from deep blue shadow to a polished highlight.
  const stops = [
    78, 89, 104, 121, 142,
    162, 178, 190, 202, 213, 223,
    233, 242, 249, 253, 255,
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
  uFrost: { value: number };
  uArmorDetail: { value: number };
}

export interface ToonCharMaterialOptions {
  rimColor?: number;
  rimStrength?: number;
  vertexColors?: boolean;
  map?: THREE.Texture | null;
  color?: number;
  armorDetail?: boolean;
  /** Reuse another material's uniforms so one setVisuals call drives both (rigid twin of a skinned material) */
  uniforms?: ToonCharUniforms;
}

/**
 * Stylized Q-version character/monster toon material:
 * - Soft toon shading and controlled ceramic highlights via MeshToonMaterial
 * - Crisp view-angle Fresnel rim light
 * - Per-actor uniform tint (overdrive gold), cryo frost hue shift and non-clipping hit-flash
 * Shares a single compiled WebGLProgram across clones via customProgramCacheKey.
 */
export function createToonCharMaterial(opts: ToonCharMaterialOptions = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: opts.color ?? 0xffffff,
    gradientMap: getToonGradientMap(),
    vertexColors: opts.vertexColors ?? true,
    map: opts.map ?? null,
  });

  const uniforms: ToonCharUniforms = opts.uniforms ?? {
    uRimColor: { value: new THREE.Color(opts.rimColor ?? 0xaeeeff) },
    uRimStrength: { value: opts.rimStrength ?? 0.38 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uFlash: { value: 0 },
    uFrost: { value: 0 },
    uArmorDetail: { value: opts.armorDetail ? 1 : 0 },
  };
  mat.userData.toonUniforms = uniforms;

  const applyHook = (target: THREE.MeshToonMaterial, uni: ToonCharUniforms): void => {
    target.customProgramCacheKey = () => 'prism-toon-char-v4';
    target.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = uni.uRimColor;
      shader.uniforms.uRimStrength = uni.uRimStrength;
      shader.uniforms.uTint = uni.uTint;
      shader.uniforms.uFlash = uni.uFlash;
      shader.uniforms.uFrost = uni.uFrost;
      shader.uniforms.uArmorDetail = uni.uArmorDetail;
      // Bind-space detail moves with the skin, so painted stripes never slide over an animation.
      shader.vertexShader = `varying vec3 vPaintPosition;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\n vPaintPosition = position;',
      );
      shader.fragmentShader =
        `varying vec3 vPaintPosition;\nuniform float uArmorDetail;\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform vec3 uTint;\nuniform float uFlash;\nuniform float uFrost;\n` +
        shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          /* glsl */ `
          float rimDot = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          float rim = smoothstep(0.52, 0.92, rimDot);
          vec3 N = normalize(normal);
          vec3 V = normalize(vViewPosition);
          vec3 H = normalize(V + normalize(vec3(-0.55, 0.9, 0.6)));
          float ceramicSpec = pow(max(0.0, dot(N, H)), 38.0);
          outgoingLight = outgoingLight / (1.0 + outgoingLight * 0.14);
          outgoingLight += vec3(0.3, 0.36, 0.4) * ceramicSpec;
          if (uArmorDetail > 0.5) {
            vec3 p = vPaintPosition;
            float aa = max(fwidth(p.x), 0.003);
            float centerStripe = 1.0 - smoothstep(0.035, 0.035 + aa, abs(p.x));
            float helmet = smoothstep(1.48, 1.58, p.y);
            outgoingLight = mix(outgoingLight, vec3(0.78, 0.87, 0.9) * (0.5 + 0.5 * max(N.y, 0.0)), centerStripe * helmet * 0.82);
            float seam = 1.0 - smoothstep(0.008, 0.018, abs(p.y - 1.74));
            outgoingLight *= 1.0 - seam * helmet * 0.27;
            float panel = smoothstep(0.07, 0.09, abs(p.x)) * (1.0 - smoothstep(0.18, 0.2, abs(p.x)));
            float pack = smoothstep(0.73, 0.77, p.y) * (1.0 - smoothstep(1.2, 1.24, p.y)) * (1.0 - smoothstep(-0.11, -0.07, p.z));
            outgoingLight = mix(outgoingLight, vec3(0.06, 0.12, 0.19), pack * 0.8);
            float vent = 1.0 - smoothstep(0.12, 0.2, abs(fract(p.y * 22.0) - 0.5));
            outgoingLight += vec3(0.24, 0.63, 0.7) * panel * pack * vent * 0.6;
          }
          outgoingLight += uRimColor * rim * uRimStrength;
          // Keep lit + rim luminance just under the bloom threshold (0.93) so white eyes, skulls, spikes
          // and grazing-lit gun barrels stay crisp; only tint (overdrive) and hit-flash may bloom.
          float litLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
          outgoingLight *= min(1.0, 0.88 / max(litLum, 1e-4));
          outgoingLight *= uTint;
          // Every monster is warm-coloured, so a multiplicative blue tint barely reads; frost re-hues
          // toward ice while keeping the shaded brightness (max channel) so cel bands survive.
          float frostV = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
          outgoingLight = mix(outgoingLight, vec3(0.45, 0.8, 1.0) * frostV, clamp(uFrost, 0.0, 1.0));
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
      uFrost: { value: uniforms.uFrost.value },
      uArmorDetail: { value: uniforms.uArmorDetail.value },
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
 * Screen-space aspect-corrected inverted-hull cartoon outline material, shared per width/colour.
 * Works identically on SkinnedMesh and regular Mesh regardless of bone/armature scale, but skinned and
 * rigid meshes get separate instances: one material drawn alternately with and without skinning makes
 * three.js redo its full program lookup on every switch.
 */
export function getOutlineMaterial(ndcWidth = 0.0052, color = 0x090c1a, skinned = false): THREE.MeshBasicMaterial {
  const key = `${ndcWidth}|${color}|${skinned ? 'skin' : 'rigid'}`;
  const cached = outlineMats.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    fog: true,
  });
  const uWidth = { value: ndcWidth };
  mat.userData.uOutlineWidth = uWidth;
  mat.customProgramCacheKey = () => 'prism-toon-outline-v2';
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
          // Tiny view-space push keeps any hull face that still lands on the visible surface behind it
          mvPosition.z -= 0.035;
          gl_Position = projectionMatrix * mvPosition;
          // BackSide sets FLIP_SIDED, which negates transformedNormal; undo it so the hull grows outward
          // instead of folding inward over the visible surface.
          vec3 outlineN = transformedNormal;
          #ifdef FLIP_SIDED
            outlineN = -outlineN;
          #endif
          // Soft-normalized screen normal: camera-facing vertices barely move, so tiny far-away triangles
          // keep their winding instead of flipping into view.
          vec2 viewN = outlineN.xy / max(length(outlineN.xy), 0.6);
          // Equal pixel width horizontally & vertically on any aspect ratio
          float aspectFix = projectionMatrix[0][0] / projectionMatrix[1][1];
          // Slight distance clamp so outlines thin gracefully far down the runway
          float distAtten = clamp(15.0 / max(-mvPosition.z, 6.0), 0.55, 1.18);
          vec2 offset = vec2(viewN.x * aspectFix, viewN.y) * (uOutlineWidth * distAtten);
          gl_Position.xy += offset * gl_Position.w;
          `,
        );
  };
  outlineMats.set(key, mat);
  return mat;
}
