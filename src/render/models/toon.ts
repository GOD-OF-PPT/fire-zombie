import * as THREE from 'three';

let sharedCelRamp: THREE.DataTexture | null = null;
const outlineMats = new Map<string, THREE.MeshBasicMaterial>();

/**
 * Crisp 5-zone stylized anime-cel ramp with deep indigo-lifted shadows and smooth ceramic midtones,
 * giving curved chibi armour and boss silhouettes commercial vibrancy at gameplay scale.
 */
export function getToonGradientMap(): THREE.DataTexture {
  if (sharedCelRamp) return sharedCelRamp;
  // High-contrast sculptural 3D ramp: deep core shadows (34..78) -> rich midtones -> crisp highlight crown
  const stops = [
    34, 42, 54, 72, 96,
    122, 146, 168, 188, 204,
    218, 230, 240, 248, 252, 255,
  ];
  const data = new Uint8Array(stops.length * 4);
  for (let i = 0; i < stops.length; i++) {
    const v = stops[i]!;
    // Subtle cool shadow lift in lowest band so dark undersides stay rich sapphire rather than muddy grey
    const cool = Math.max(0, 1 - i / 5);
    data[i * 4] = Math.round(v * (1 - cool * 0.08));
    data[i * 4 + 1] = Math.round(v * (1 - cool * 0.02));
    data[i * 4 + 2] = Math.min(255, Math.round(v * (1 + cool * 0.12)));
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
 * - Multi-band cel shading + crisp stylized specular highlight via MeshToonMaterial
 * - View-angle Fresnel rim light + top sky bounce
 * - Per-actor uniform tint (overdrive gold / aegis cyan), cryo frost hue shift and non-clipping hit-flash
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
    uRimStrength: { value: opts.rimStrength ?? 0.42 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uFlash: { value: 0 },
    uFrost: { value: 0 },
    uArmorDetail: { value: opts.armorDetail ? 1 : 0 },
  };
  mat.userData.toonUniforms = uniforms;

  const applyHook = (target: THREE.MeshToonMaterial, uni: ToonCharUniforms): void => {
    target.customProgramCacheKey = () => 'prism-toon-char-v13';
    target.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = uni.uRimColor;
      shader.uniforms.uRimStrength = uni.uRimStrength;
      shader.uniforms.uTint = uni.uTint;
      shader.uniforms.uFlash = uni.uFlash;
      shader.uniforms.uFrost = uni.uFrost;
      shader.uniforms.uArmorDetail = uni.uArmorDetail;
      shader.vertexShader = `varying vec3 vPaintPosition;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\n vPaintPosition = position;',
      );
      shader.fragmentShader =
        `varying vec3 vPaintPosition;\nuniform float uArmorDetail;\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform vec3 uTint;\nuniform float uFlash;\nuniform float uFrost;\n` +
        shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          /* glsl */ `
          vec3 N = normalize(normal);
          vec3 V = normalize(vViewPosition);
          float rimDot = 1.0 - clamp(dot(N, V), 0.0, 1.0);
          float rim = smoothstep(0.48, 0.88, rimDot);
          vec3 H = normalize(V + normalize(vec3(-0.52, 0.92, 0.62)));
          float ceramicSpec = smoothstep(0.86, 0.95, max(0.0, dot(N, H))) * 0.42 + pow(max(0.0, dot(N, H)), 42.0) * 0.55;
          float skyCrown = max(0.0, N.y) * 0.06;
          outgoingLight = outgoingLight / (1.0 + outgoingLight * 0.13);
          outgoingLight += vec3(0.32, 0.38, 0.44) * ceramicSpec + uRimColor * skyCrown;
          if (uArmorDetail > 0.5) {
            vec3 p = vPaintPosition;
            float aa = max(fwidth(p.x), 0.003);
            float centerStripe = 1.0 - smoothstep(0.035, 0.035 + aa, abs(p.x));
            float helmet = smoothstep(1.48, 1.58, p.y);
            outgoingLight = mix(outgoingLight, vec3(0.82, 0.91, 0.96) * (0.5 + 0.5 * max(N.y, 0.0)), centerStripe * helmet * 0.84);
            float seam = 1.0 - smoothstep(0.008, 0.018, abs(p.y - 1.74));
            outgoingLight *= 1.0 - seam * helmet * 0.27;
            float panel = smoothstep(0.07, 0.09, abs(p.x)) * (1.0 - smoothstep(0.18, 0.2, abs(p.x)));
            float pack = smoothstep(0.73, 0.77, p.y) * (1.0 - smoothstep(1.2, 1.24, p.y)) * (1.0 - smoothstep(-0.11, -0.07, p.z));
            outgoingLight = mix(outgoingLight, vec3(0.06, 0.13, 0.22), pack * 0.8);
            float vent = 1.0 - smoothstep(0.12, 0.2, abs(fract(p.y * 22.0) - 0.5));
            outgoingLight += vec3(0.28, 0.72, 0.82) * panel * pack * vent * 0.65;
          }
          outgoingLight += uRimColor * rim * uRimStrength;
          // Smooth filmic shoulder preserves 3D light-to-shadow contrast instead of flattening to constant luminance!
          outgoingLight = outgoingLight / (1.0 + outgoingLight * 0.24);
          outgoingLight *= uTint;
          float frostV = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
          vec3 iceTone = vec3(0.42, 0.84, 1.02) * frostV + vec3(0.12, 0.26, 0.34) * rim;
          outgoingLight = mix(outgoingLight, iceTone, clamp(uFrost, 0.0, 1.0));
          outgoingLight = mix(outgoingLight, vec3(1.18, 1.14, 1.08), clamp(uFlash, 0.0, 0.82));
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

export function getOutlineMaterial(ndcWidth = 0.0052, color = 0x070a18, skinned = false): THREE.MeshBasicMaterial {
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
          mvPosition.z -= 0.035;
          gl_Position = projectionMatrix * mvPosition;
          vec3 outlineN = transformedNormal;
          #ifdef FLIP_SIDED
            outlineN = -outlineN;
          #endif
          vec2 viewN = outlineN.xy / max(length(outlineN.xy), 0.6);
          float aspectFix = projectionMatrix[0][0] / projectionMatrix[1][1];
          float distAtten = clamp(15.0 / max(-mvPosition.z, 6.0), 0.55, 1.18);
          vec2 offset = vec2(viewN.x * aspectFix, viewN.y) * (uOutlineWidth * distAtten);
          gl_Position.xy += offset * gl_Position.w;
          `,
        );
  };
  outlineMats.set(key, mat);
  return mat;
}


/**
 * GPU-Instanced Toon Monster Material:
 * Reads per-instance `attribute vec4 aInstanceFx` = (hitFlash, frost, tintMode, 0)
 * so 300+ monsters draw in tiny batched InstancedMesh calls with ZERO CPU skinning or per-actor uniform clones!
 * tintMode: 0 = normal, 1 = Howler frenzy crimson, 2 = Bounty elite gold, 3 = Nuke thermal scorch.
 */
export function createInstancedEnemyToonMaterial(opts: {
  rimColor: number;
  rimStrength?: number;
  vertexColors?: boolean;
  map?: THREE.Texture | null;
}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: 0xffffff,
    gradientMap: getToonGradientMap(),
    vertexColors: opts.vertexColors ?? true,
    map: opts.map ?? null,
  });
  const uRimColor = { value: new THREE.Color(opts.rimColor) };
  const uRimStrength = { value: opts.rimStrength ?? 0.28 };
  mat.customProgramCacheKey = () => 'prism-toon-instanced-enemy-v140';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = uRimColor;
    shader.uniforms.uRimStrength = uRimStrength;
    shader.vertexShader =
      `attribute vec4 aInstanceFx;\nattribute float aPartGlow;\nvarying vec4 vInstanceFx;\nvarying float vPartGlow;\nvarying vec3 vObjPos;\nvarying vec3 vWorldNorm;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vInstanceFx = aInstanceFx;
        vPartGlow = aPartGlow;
        vObjPos = position;
        #ifdef USE_INSTANCING
          vWorldNorm = normalize(mat3(instanceMatrix) * objectNormal);
        #else
          vWorldNorm = normalize(objectNormal);
        #endif
        `,
      );
    shader.fragmentShader =
      `varying vec4 vInstanceFx;\nvarying float vPartGlow;\nvarying vec3 vObjPos;\nvarying vec3 vWorldNorm;\nuniform vec3 uRimColor;\nuniform float uRimStrength;\n` +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        vec3 N = normalize(normal);
        vec3 Nw = normalize(vWorldNorm);
        vec3 V = normalize(vViewPosition);

        // Extract intrinsic base albedo (before flat scene-light washout)
        vec3 baseAlbedo = diffuseColor.rgb;
        float tMode = vInstanceFx.z;
        float subVar = vInstanceFx.w;
        if (tMode < 0.5) {
          float lumA = dot(baseAlbedo, vec3(0.30, 0.56, 0.14));
          if (subVar > 2.5) {
            baseAlbedo = mix(baseAlbedo, vec3(1.28, 0.78, 0.22) * lumA, 0.76);
          } else if (subVar > 1.5) {
            baseAlbedo = mix(baseAlbedo, vec3(0.32, 0.88, 1.42) * lumA, 0.78);
          } else if (subVar > 0.5) {
            baseAlbedo = mix(baseAlbedo, vec3(0.36, 1.32, 0.58) * lumA, 0.76);
          }
        }

        // Studio 3-Point Volumetric 3D Sculpting:
        // 1) Strong 3/4 Upper-Front-Left Key Light with rich core-shadow terminator (5.2:1 contrast!)
        vec3 Lkey = normalize(vec3(-0.58, 0.74, 0.34));
        float ndl = dot(Nw, Lkey);
        float keySmooth = smoothstep(-0.34, 0.68, ndl);
        float keySculpt = mix(keySmooth, smoothstep(-0.08, 0.18, ndl) * 0.42 + smoothstep(0.36, 0.72, ndl) * 0.58, 0.36);

        // Crisp sapphire-lifted shadow core vs bright key highlight
        vec3 shadowCol = baseAlbedo * vec3(0.24, 0.27, 0.42);
        vec3 litCol = baseAlbedo * vec3(1.18, 1.13, 1.07);
        vec3 sculpted = mix(shadowCol, litCol, keySculpt);

        // 2) Vertical Ground-Contact Ambient Occlusion + Underbelly Curvature Darkening + Neon Deck Bounce
        float groundAO = mix(0.46, 1.0, smoothstep(0.0, 0.78, vObjPos.y));
        float underAO = mix(0.66, 1.0, clamp(Nw.y * 0.5 + 0.5, 0.0, 1.0));
        sculpted *= groundAO * underAO;
        sculpted += vec3(0.05, 0.16, 0.26) * max(0.0, -Nw.y) * (1.0 - smoothstep(0.0, 1.05, vObjPos.y));

        // 3) Dual-Lobe 3D Specular Highlights (broad curved carapace sheen + sharp wet/metal glint)
        vec3 H = normalize(V + normalize(vec3(-0.46, 0.78, 0.42)));
        float ndh = max(0.0, dot(N, H));
        float broadSheen = pow(ndh, 9.0) * 0.24;
        float sharpSpec = pow(ndh, 48.0) * 0.52 * (0.25 + 0.75 * keySculpt);
        sculpted += (baseAlbedo * 0.45 + vec3(0.55)) * broadSheen + vec3(0.92, 0.96, 1.0) * sharpSpec;

        // 4) Sharp Grazing Silhouette Rim Kicker (separates overlapping 3D forms cleanly in depth!)
        float rimDot = 1.0 - clamp(dot(N, V), 0.0, 1.0);
        float rim = pow(rimDot, 3.3) * (0.35 + 0.65 * clamp(Nw.y * 0.4 + abs(Nw.x) * 0.75, 0.0, 1.0));
        sculpted += uRimColor * rim * (uRimStrength * 1.45);

        // 4b) Luminance-Preserving Cyber-Carapace Bevel Highlights
        float glowMask = clamp(vPartGlow, 0.0, 1.0);
        if (glowMask < 0.08) {
          vec3 mp = vObjPos * 7.2;
          float seamAA = clamp(fwidth(mp.y) * 1.4, 0.04, 0.35);
          float ribSeam = 1.0 - smoothstep(0.04, 0.04 + seamAA, abs(fract(mp.y + abs(vObjPos.x) * 1.35) - 0.5));
          float plateBevel = 1.0 - smoothstep(0.04, 0.04 + seamAA, abs(fract(mp.z * 0.85 - vObjPos.y * 0.45) - 0.5));
          float nearFade = 1.0 - smoothstep(26.0, 48.0, -vViewPosition.z);
          sculpted *= (1.0 - ribSeam * 0.055 * nearFade);
          sculpted += (baseAlbedo * 0.55 + vec3(0.45)) * plateBevel * (0.07 + sharpSpec * 0.36) * nearFade;
        } else {
          vec3 emissivePop = baseAlbedo * (1.12 + glowMask * 0.44) + uRimColor * glowMask * 0.14;
          sculpted = mix(sculpted, emissivePop, glowMask * 0.90);
        }

        // V21 Thermal Fracture Shader: procedural molten plasma vein network on armor-broken & heavy-impact plates!
        float hitThermal = smoothstep(0.32, 0.92, clamp(vInstanceFx.x, 0.0, 1.0));
        if (tMode > 3.5 || hitThermal > 0.05) {
          float coreRadius = length(vec2(vObjPos.x * 1.12, (vObjPos.y - 0.66) * 0.88));
          float fA = abs(sin(vObjPos.x * 19.5 + vObjPos.y * 12.4) * cos(vObjPos.y * 16.2 - vObjPos.z * 10.5));
          float fB = abs(sin(vObjPos.z * 23.0 - vObjPos.x * 14.0 + vObjPos.y * 8.5));
          float veinMask = smoothstep(0.74, 0.95, fA) + smoothstep(0.86, 0.98, fB) * 0.65;
          float fractureWeight = tMode > 3.5 ? clamp(smoothstep(0.48, 0.14, coreRadius) + veinMask * smoothstep(0.95, 0.22, coreRadius), 0.0, 0.95) : clamp(veinMask * hitThermal * 0.72, 0.0, 0.78);
          vec3 magmaEdge = mix(vec3(1.68, 0.48, 0.16), vec3(1.85, 1.42, 0.52), clamp(veinMask * 0.85, 0.0, 1.0));
          vec3 moltenCore = mix(magmaEdge, uRimColor * 1.72 + vec3(0.52), 0.36);
          sculpted = mix(sculpted * (tMode > 3.5 ? vec3(0.92, 0.88, 0.96) : vec3(1.0)), moltenCore, fractureWeight);
        }
        if (tMode > 3.5) {
          sculpted += vec3(0.14, 0.06, 0.02) * rim;
        } else if (tMode > 2.5) {
          sculpted *= vec3(1.34, 0.88, 0.54);
        } else if (tMode > 1.5) {
          sculpted *= vec3(1.38, 1.16, 0.50);
        } else if (tMode > 0.5) {
          sculpted *= vec3(1.24, 0.86, 0.94);
        }

        outgoingLight = sculpted / (1.0 + sculpted * 0.18);

        float frostAmt = clamp(vInstanceFx.y, 0.0, 1.0);
        float frostV = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
        vec3 iceTone = vec3(0.38, 0.82, 1.04) * frostV + vec3(0.14, 0.30, 0.40) * rim;
        outgoingLight = mix(outgoingLight, iceTone, frostAmt);
        float hitAmt = pow(clamp(vInstanceFx.x, 0.0, 1.0), 1.75) * 0.62;
        vec3 rimFlash = (baseAlbedo * 0.42 + vec3(0.62, 0.56, 0.46)) * hitAmt * (0.22 + 0.78 * keySculpt + rim * 1.05);
        outgoingLight = (outgoingLight + rimFlash) / (1.0 + hitAmt * 0.24);
        #include <opaque_fragment>
        `,
      );
  };
  return mat;
}
