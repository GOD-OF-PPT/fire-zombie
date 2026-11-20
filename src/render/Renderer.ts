import { JUMP_DURATION_SEC } from '../config/constants';
import type { AccessibilityConfig } from '../app/save';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { describeVaultRelation } from '../config/blitz';
import { SQUAD_SKINS } from '../app/meta';
import type {
  BarrelSnapshot,
  CollapseRiftSnapshot,
  HighSpireSnapshot,
  PantheonCoBossSnapshot,
  TacticalEventSnapshot,
  BossSnapshot,
  ContractWallSnapshot,
  DoomOrbSnapshot,
  EnemyKind,
  JumpPadSnapshot,
  ReflectorSnapshot,
  SingularitySnapshot,
  GateSnapshot,
  PrismLensSnapshot,
  RewardId,
  SectorId,
  SimSnapshot,
  SquadSkinId,
  VaultSnapshot,
  WeaponId,
  NemesisSnapshot,
  NirvanaArchetype,
  PhotoFilterKind,
  TriPrismLinkSnapshot,
} from '../types/game';
import { BLADES_ORBIT_RADIUS, GOLDEN_ANGLE_RAD, PLAYER_Z, TRACK_HALF_WIDTH } from '../config/constants';
import { ENEMY_CONFIGS } from '../config/enemies';
import { SECTORS } from '../config/sectors';
import { REWARD_META, SECTOR_META } from '../app/meta';
import { Effects } from './Effects';
import { EnvironmentDetail } from './environmentDetail';
import { Infrastructure } from './infrastructure';
import {
  COLORS,
  gateColors,
  gateTextureKey,
  setGateColorblindMode,
  makeCanvasTexture,
  makeGlowTexture,
  makeHexCommandTexture,
  makeSkyTexture,
  makeStripeTexture,
  paintGatePlate,
  paintDoomOrbPlate,
  paintLensPlate,
  paintSetPiecePlate,
  paintVaultPlate,
} from './textures';
import { makeCharacterMaterial } from './models/rig';
import { buildBladeGeo, buildBoltGeo, buildRewardDisplayGeo } from './models/soldiers';
import { GeoBuilder, box, cone, cyl, oct, sph, tor } from './models/kit';
import {
  AnimatedActor,
  bakeEnemyPoseFrames,
  loadGltfLibrary,
  spawnActor,
  type BakedPosePair,
  type GltfLibrary,
} from './models/gltfLibrary';
import { buildProceduralLibrary } from './models/proceduralLibrary';
import {
  createInstancedEnemyToonMaterial,
  createToonCharMaterial,
  getOutlineMaterial,
} from './models/toon';
import { RiotShields } from './RiotShields';
import { loadTrialVault } from './models/trialVault';

export const WEAPON_COLOR: Record<WeaponId, number> = {
  pulse: 0x3ef3ff,
  scatter: 0x7dff6b,
  rail: 0xc29bff,
  plasma: 0xff9a3c,
  cryo: 0x9fe6ff,
};

const TRACK_LEN = 220;
const TRACK_CENTER_Z = -95;
/** Max rendered squad actors so every chibi trooper & weapon stays distinct (never a mushy overlap blob) */
const MAX_RENDER_SQUAD = 32;
const SQUAD_POOL_SIZES: [number, number, number] = [32, 18, 6];
const MAX_PROJ = 2400;
const MAX_SHADOWS = 1280;
const MAX_DECALS = 1024;

interface DecalEntry {
  active: boolean;
  x: number;
  z: number;
  radius: number;
  rot: number;
  age: number;
  maxAge: number;
  kind: 0 | 1 | 2 | 3 | 4 | 5; // 0=crater, 1=acid, 2=frost, 3=slash, 4=magma_fissure, 5=mag_tidal_ripple
  r: number;
  g: number;
  b: number;
}

interface SkyCargoView {
  id: number;
  group: THREE.Group;
  drone: THREE.Group;
  crate: THREE.Mesh;
  tether: THREE.Mesh;
  reticle: THREE.Mesh;
  hpFill: THREE.Mesh;
  seen: boolean;
}

interface MaglevView {
  id: number;
  group: THREE.Group;
  railWarn: THREE.Mesh;
  railMat: THREE.MeshBasicMaterial;
  train: THREE.Group;
  seen: boolean;
}

/** Per-pose InstancedMesh capacity per EnemyKind (7 pose buckets each -> handles 350+ simultaneous horde smoothly!) */
const ENEMY_BATCH_CAP: Record<EnemyKind, number> = {
  crawler: 260,
  dasher: 64,
  bastion: 32,
  mitosis: 96,
  siphon: 32,
  bomber: 56,
  phalanx: 42,
  stalker: 52,
  brood: 28,
  howler: 32,
  glacier: 36,
  beholder: 36,
  burrower: 48,
  necromancer: 32,
};

/**
 * V10 4-Tier Visual Size Hierarchy:
 *  - Tier 1 Swarm Minion (crawler): 1.24x solid hound-scale fodder
 *  - Tier 2 Raiders (bomber/stalker/burrower/dasher/mitosis): 1.46x-1.56x chunky skirmishers
 *  - Tier 3 Armored Elites (phalanx/howler/beholder/necromancer/siphon): 1.64x-1.70x imposing specialists
 *  - Tier 4 Super-Armor Juggernauts (glacier/brood/bastion): 1.72x-1.84x towering raid-miniboss giants!
 */
const ENEMY_VISUAL_SCALE: Record<EnemyKind, number> = {
  crawler: 1.24,
  bomber: 1.48,
  stalker: 1.5,
  burrower: 1.56,
  dasher: 1.48,
  mitosis: 1.46,
  siphon: 1.64,
  beholder: 1.68,
  howler: 1.64,
  necromancer: 1.66,
  phalanx: 1.68,
  brood: 1.62,
  glacier: 1.70,
  bastion: 1.66,
};

const ENEMY_BAR_H: Record<EnemyKind, number> = {
  crawler: 1.45,
  dasher: 1.92,
  bastion: 2.98,
  mitosis: 1.96,
  siphon: 2.48,
  bomber: 1.8,
  phalanx: 2.2,
  stalker: 1.86,
  brood: 2.15,
  howler: 2.32,
  glacier: 2.42,
  beholder: 2.2,
  burrower: 1.62,
  necromancer: 2.32,
};

/** A stalled model download falls back to procedural actors instead of leaving the run empty */
const GLTF_LOAD_TIMEOUT_MS = 30000;

export type ActorModelSource = 'loading' | 'gltf' | 'procedural' | 'failed';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const CAM_BASE_Y = 10.6;
const CAM_BASE_Z = 16.0;
const CAM_DIST_TO_PLAYER = Math.hypot(CAM_BASE_Y, CAM_BASE_Z - PLAYER_Z);

interface GateView {
  id: number;
  group: THREE.Group;
  postMat: THREE.MeshStandardMaterial;
  curtainMat: THREE.MeshBasicMaterial;
  beam: THREE.Mesh;
  postL: THREE.Mesh;
  postR: THREE.Mesh;
  curtain: THREE.Mesh;
  plate: THREE.Mesh;
  plateMat: THREE.MeshBasicMaterial;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  key: string;
  seen: boolean;
  fade: number;
}

interface VaultView {
  id: number;
  group: THREE.Group;
  crystal: THREE.Mesh;
  crystalMat: THREE.MeshStandardMaterial;
  coreGroup: THREE.Group;
  core: THREE.Mesh;
  coreOutline: THREE.Mesh;
  coreMat: THREE.Material;
  frame: THREE.Object3D;
  ringMat: THREE.MeshBasicMaterial;
  reward: string;
  plate: THREE.Mesh;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  key: string;
  seen: boolean;
}

interface BarrelView {
  id: number;
  group: THREE.Group;
  body: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  light: THREE.Mesh;
  lightMat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  seen: boolean;
}

interface LensView {
  id: number;
  group: THREE.Group;
  paneMat: THREE.MeshBasicMaterial;
  seen: boolean;
}

interface SingularityView {
  id: number;
  group: THREE.Group;
  ringOuter: THREE.Mesh;
  ringInner: THREE.Mesh;
  cage: THREE.Mesh;
  seen: boolean;
}

interface JumpPadView {
  id: number;
  group: THREE.Group;
  stripMat: THREE.MeshBasicMaterial;
  seen: boolean;
}

interface ReflectorView {
  id: number;
  group: THREE.Group;
  paneMat: THREE.MeshBasicMaterial;
  seen: boolean;
}

interface ContractWallView {
  id: number;
  group: THREE.Group;
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  postBack: THREE.Mesh;
  postFront: THREE.Mesh;
  sign: THREE.Mesh;
  seen: boolean;
}

interface DoomOrbView {
  id: number;
  group: THREE.Group;
  coreMat: THREE.MeshStandardMaterial;
  cage: THREE.Mesh;
  cageMat: THREE.MeshBasicMaterial;
  haloMat: THREE.MeshBasicMaterial;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  key: string;
  seen: boolean;
}

interface HazardView {
  group: THREE.Group;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  progress: THREE.Mesh;
  progressMat: THREE.MeshBasicMaterial;
  column: THREE.Mesh;
  columnMat: THREE.MeshBasicMaterial;
  edgeL: THREE.Mesh;
  edgeR: THREE.Mesh;
}

interface SquadSlotState {
  x: number;
  z: number;
  s: number;
  alive: boolean;
  vx: number;
  tier: 1 | 2 | 3;
  weaponShown: WeaponId;
  actor: AnimatedActor | null;
}

interface EnemyPoseBatch {
  body: THREE.InstancedMesh;
  outline: THREE.InstancedMesh;
  fxAttr: THREE.InstancedBufferAttribute;
  fxArray: Float32Array;
  count: number;
  outlineCount: number;
  cap: number;
}

interface ActiveEnemyEntry {
  kind: EnemyKind;
  x: number;
  z: number;
  scale: number;
  animTime: number;
  recoilZ: number;
  recoilX: number;
  recoilTilt: number;
  recoilRoll: number;
  prevHit: number;
  seen: boolean;
}

interface DyingEnemyEntry {
  kind: EnemyKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinZ: number;
  scale: number;
  age: number;
  duration: number;
  nukeScorched: boolean;
}

interface BossActorView {
  root: THREE.Group;
  primary: AnimatedActor;
  secondary?: AnimatedActor;
  secondaryRoot?: THREE.Group;
  halo?: THREE.Mesh;
  coreHeight: number;
  secondaryCoreHeight?: number;
  pylons?: THREE.Group[];
  beams?: THREE.Mesh[];
  shield: THREE.Mesh;
  shield2?: THREE.Mesh;
  attackCooldown: number;
}

function std(
  color: number,
  emissive = 0.5,
  opts: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: emissive,
    roughness: 0.35,
    metalness: 0.25,
    flatShading: true,
    ...opts,
  });
}

function additive(color: number, opacity: number, map?: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    // Additive glow is order-independent; without this three.js draws transparent DoubleSide meshes twice
    // (back then front) and redoes the program lookup for each half.
    forceSinglePass: true,
    map: map ?? null,
    toneMapped: false,
  });
}

interface NukeDropSlot {
  group: THREE.Group;
  warhead: THREE.Group;
  plumeMat: THREE.MeshBasicMaterial;
  plume: THREE.Mesh;
  reticleOuter: THREE.Mesh;
  reticleOuterMat: THREE.MeshBasicMaterial;
  reticleInner: THREE.Mesh;
  reticleInnerMat: THREE.MeshBasicMaterial;
  crosshair: THREE.Mesh;
  crosshairMat: THREE.MeshBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
  lockBeam: THREE.Mesh;
  lockBeamMat: THREE.MeshBasicMaterial;
  helixRingA: THREE.Mesh;
  helixRingAMat: THREE.MeshBasicMaterial;
  helixRingB: THREE.Mesh;
  helixRingBMat: THREE.MeshBasicMaterial;
  sweepPillars: THREE.Mesh[];
}

interface NukeBlastSlot {
  group: THREE.Group;
  groundScorch: THREE.Mesh;
  groundScorchMat: THREE.MeshBasicMaterial;
  craterRing: THREE.Mesh;
  craterRingMat: THREE.MeshBasicMaterial;
  shockWall: THREE.Mesh;
  shockWallMat: THREE.MeshBasicMaterial;
  blastRing2: THREE.Mesh;
  blastRing2Mat: THREE.MeshBasicMaterial;
  sunPillar: THREE.Mesh;
  sunPillarMat: THREE.MeshBasicMaterial;
  equatorHalo: THREE.Mesh;
  equatorHaloMat: THREE.MeshBasicMaterial;
  fireball: THREE.Mesh;
  fireballMat: THREE.MeshBasicMaterial;
  coreDome: THREE.Mesh;
  coreDomeMat: THREE.MeshBasicMaterial;
  stem: THREE.Mesh;
  stemMat: THREE.ShaderMaterial;
  cap: THREE.Mesh;
  capMat: THREE.ShaderMaterial;
  crown: THREE.Mesh;
  crownMat: THREE.ShaderMaterial;
  vortexLower: THREE.Mesh;
  vortexLowerMat: THREE.MeshBasicMaterial;
  vortexUpper: THREE.Mesh;
  vortexUpperMat: THREE.MeshBasicMaterial;
  machRing: THREE.Mesh;
  machRingMat: THREE.MeshBasicMaterial;
  wilsonDome: THREE.Mesh;
  wilsonDomeMat: THREE.MeshBasicMaterial;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 9 / 16, 0.5, 265);
  readonly effects = new Effects();
  readonly assetsReady: Promise<void>;

  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private impactPass: ShaderPass | null = null;
  private chromaAmt = 0;
  private radialBlurAmt = 0;
  private impactCenter = new THREE.Vector2(0.5, 0.5);
  private phaseCamTimer = 0;
  private phaseCamDur = 1.15;
  private awakenCamTimer = 0;
  private awakenCamDur = 0.85;
  private splitToneAmt = 0;
  private v22SkinColorB = new THREE.Color();
  private wingmanLeftGroup!: THREE.Group;
  private wingmanRightGroup!: THREE.Group;
  private wingmanLeftMirror!: THREE.Mesh;
  private wingmanRightMirror!: THREE.Mesh;
  private wingmanCoreMatL!: THREE.MeshBasicMaterial;
  private wingmanCoreMatR!: THREE.MeshBasicMaterial;
  private reactorMandalaGroup!: THREE.Group;
  private reactorMandalaOuter!: THREE.Mesh;
  private reactorMandalaInner!: THREE.Mesh;
  private reactorMandalaMat!: THREE.MeshBasicMaterial;
  private bossApexGroup!: THREE.Group;
  private bossApexLaserA!: THREE.Mesh;
  private bossApexLaserB!: THREE.Mesh;
  private bossApexCloneL!: THREE.Mesh;
  private bossApexCloneR!: THREE.Mesh;
  private bossApexTideRing!: THREE.Mesh;
  private bossHarmonicDome!: THREE.Mesh;
  private ghostGroup!: THREE.Group;
  private ghostBodyMat!: THREE.MeshBasicMaterial;
  private ghostRingMat!: THREE.MeshBasicMaterial;
  public activePointLightsCount = 0;
  private visualSquadScratch: Array<{ x: number; z: number; tier: 1 | 2 | 3 }> = [];
  private width = 1;
  private height = 1;
  private sector: SectorId = 1;
  private time = 0;

  // GLTF asset library & actor pools
  private gltfLib: GltfLibrary | null = null;
  private actorModelSource: ActorModelSource = 'loading';
  private squadPools: [AnimatedActor[], AnimatedActor[], AnimatedActor[]] = [[], [], []];
  private squadSlots: SquadSlotState[] = [];
  private currentWeapon: WeaponId = 'pulse';

  private enemyBatches: Partial<Record<EnemyKind, EnemyPoseBatch[]>> = {};
  private activeEnemies = new Map<number, ActiveEnemyEntry>();
  private dyingEnemies: DyingEnemyEntry[] = [];
  private bossViews = new Map<BossSnapshot['id'], BossActorView>();
  private bossDeathT = -1;
  private bossHidden = false;

  // environment
  private trackMat!: THREE.ShaderMaterial;
  private groundMat!: THREE.ShaderMaterial;
  private railMat!: THREE.MeshBasicMaterial;
  private towers!: THREE.InstancedMesh;
  private towerCaps!: THREE.InstancedMesh;
  private towerCapMat!: THREE.MeshBasicMaterial;
  private towerData: Array<{ x: number; z: number; w: number; d: number; h: number }> = [];
  private environmentDetail!: EnvironmentDetail;
  private infrastructure!: Infrastructure;
  private skyTextures = new Map<SectorId, THREE.Texture>();
  private posts!: THREE.InstancedMesh;
  private postMat!: THREE.MeshBasicMaterial;
  private hemi!: THREE.HemisphereLight;
  private dirLight!: THREE.DirectionalLight;
  private readonly baseFogColor = new THREE.Color(0x122a68);
  private readonly nukeFogColor = new THREE.Color(0xff9c42);

  // squad & shared VFX meshes
  private squadGlow!: THREE.Mesh;
  private squadGlowMat!: THREE.MeshBasicMaterial;
  private squadRing!: THREE.Mesh;
  private squadRingMat!: THREE.MeshBasicMaterial;
  private aegisGroup!: THREE.Group;
  private aegisWire!: THREE.Mesh;
  private aegisWireMat!: THREE.MeshBasicMaterial;
  private aegisShellMat!: THREE.MeshBasicMaterial;
  private blades!: THREE.InstancedMesh;
  private flashes!: THREE.InstancedMesh;
  private flashMat!: THREE.MeshBasicMaterial;
  private muzzleFlash = 0;
  private shadows!: THREE.InstancedMesh;
  private shadowCount = 0;

  // HUD / telegraph / projectile instanced meshes
  private hpBg!: THREE.InstancedMesh;
  private hpFg!: THREE.InstancedMesh;
  private telegraphs!: THREE.InstancedMesh;
  private tethers: THREE.Mesh[] = [];
  private readonly riotShields = new RiotShields();
  private landingMarker!: THREE.Group;
  private jumpSlamPool: Array<{
    group: THREE.Group;
    dome: THREE.Mesh;
    domeMat: THREE.MeshBasicMaterial;
    crown: THREE.Mesh;
    crownMat: THREE.MeshBasicMaterial;
    fissure: THREE.Mesh;
    fissureMat: THREE.MeshBasicMaterial;
    timer: number;
    dur: number;
    crowd: boolean;
  }> = [];
  private jumpSlamCursor = 0;
  public auraInstMesh!: THREE.InstancedMesh;
  public jugHaloInstMesh!: THREE.InstancedMesh;
  public shardDropInstMesh!: THREE.InstancedMesh;
  public weatherMesh!: THREE.InstancedMesh;
  private projMesh!: THREE.InstancedMesh;
  private projCoreMesh!: THREE.InstancedMesh;
  private orbMesh!: THREE.InstancedMesh;
  private orbMarks!: THREE.InstancedMesh;
  private gateViews = new Map<number, GateView>();
  private gatePool: GateView[] = [];
  private vaultViews = new Map<number, VaultView>();
  private vaultPool: VaultView[] = [];
  private barrelViews = new Map<number, BarrelView>();
  private barrelPool: BarrelView[] = [];
  private lensViews = new Map<number, LensView>();
  private lensPool: LensView[] = [];
  private singularityViews = new Map<number, SingularityView>();
  private singularityPool: SingularityView[] = [];
  private jumpPadViews = new Map<number, JumpPadView>();
  private jumpPadPool: JumpPadView[] = [];
  private reflectorViews = new Map<number, ReflectorView>();
  private reflectorPool: ReflectorView[] = [];
  private contractViews = new Map<number, ContractWallView>();
  private contractPool: ContractWallView[] = [];
  private doomOrbViews = new Map<number, DoomOrbView>();
  private doomOrbPool: DoomOrbView[] = [];
  private skyCargoViews = new Map<number, SkyCargoView>();
  private skyCargoPool: SkyCargoView[] = [];
  private maglevViews = new Map<number, MaglevView>();
  private maglevPool: MaglevView[] = [];
  private magRailViews = new Map<number, { id: number; group: THREE.Group; stripMat: THREE.MeshBasicMaterial; seen: boolean }>();
  private magRailPool: Array<{ id: number; group: THREE.Group; stripMat: THREE.MeshBasicMaterial; seen: boolean }> = [];
  private capTowerViews = new Map<number, { id: number; group: THREE.Group; core: THREE.Mesh; ring: THREE.Mesh; fillMat: THREE.MeshBasicMaterial; seen: boolean }>();
  private capTowerPool: Array<{ id: number; group: THREE.Group; core: THREE.Mesh; ring: THREE.Mesh; fillMat: THREE.MeshBasicMaterial; seen: boolean }> = [];
  private phaseGateViews = new Map<number, { id: number; group: THREE.Group; curtainMat: THREE.MeshBasicMaterial; signMat: THREE.MeshBasicMaterial; polarity: string; seen: boolean }>();
  private phaseGatePool: Array<{ id: number; group: THREE.Group; curtainMat: THREE.MeshBasicMaterial; signMat: THREE.MeshBasicMaterial; polarity: string; seen: boolean }> = [];
  private refractRibbonMesh!: THREE.InstancedMesh;
  private ribbonDispersionMat!: THREE.ShaderMaterial;
  private anamorphicFlareMesh!: THREE.InstancedMesh;
  private triPrismLatticeMesh!: THREE.InstancedMesh;
  private nemesisGroup!: THREE.Group;
  private nemesisShieldMesh!: THREE.Mesh;
  private nemesisShieldMat!: THREE.MeshBasicMaterial;
  private nemesisTelegraphBeam!: THREE.Mesh;
  private nirvanaBurstGroup!: THREE.Group;
  private nirvanaRingOuter!: THREE.Mesh;
  private nirvanaRingInner!: THREE.Mesh;
  private nirvanaOuterMat!: THREE.MeshBasicMaterial;
  private nirvanaInnerMat!: THREE.MeshBasicMaterial;
  private decalShaderMat!: THREE.ShaderMaterial;
  public photoModeState: { active: boolean; yaw: number; pitch: number; fov: number; filter: PhotoFilterKind } | null = null;
  private formationTetherMesh!: THREE.InstancedMesh;
  private collapseRiftViews = new Map<number, { id: number; group: THREE.Group; rimMat: THREE.MeshBasicMaterial; leapArc: THREE.Mesh; seen: boolean }>();
  private collapseRiftPool: Array<{ id: number; group: THREE.Group; rimMat: THREE.MeshBasicMaterial; leapArc: THREE.Mesh; seen: boolean }> = [];
  private highSpireViews = new Map<number, { id: number; group: THREE.Group; dome: THREE.Mesh; domeMat: THREE.MeshBasicMaterial; turret: THREE.Mesh; laser: THREE.Mesh; laserMat: THREE.MeshBasicMaterial; seen: boolean }>();
  private highSpirePool: Array<{ id: number; group: THREE.Group; dome: THREE.Mesh; domeMat: THREE.MeshBasicMaterial; turret: THREE.Mesh; laser: THREE.Mesh; laserMat: THREE.MeshBasicMaterial; seen: boolean }> = [];
  private tacticalEventViews = new Map<number, { id: number; kind: string; group: THREE.Group; core: THREE.Mesh; ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial; seen: boolean }>();
  private tacticalEventPool: Array<{ id: number; kind: string; group: THREE.Group; core: THREE.Mesh; ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial; seen: boolean }> = [];
  private sharedBeaconGeo: THREE.BufferGeometry | null = null;
  private sharedCartGeo: THREE.BufferGeometry | null = null;
  private reactorHaloGroup!: THREE.Group;
  private reactorPrisms: THREE.Mesh[] = [];
  private reactorWallMesh!: THREE.Mesh;
  private reactorWallMat!: THREE.MeshBasicMaterial;
  private coBossGroup!: THREE.Group;
  private coBossActor: ReturnType<typeof spawnActor> | null = null;
  private coBossShield!: THREE.Mesh;
  private coBossHalo!: THREE.Mesh;
  private codexStageGroup!: THREE.Group;
  private codexPedestal!: THREE.Mesh;
  private codexContentGroup!: THREE.Group;
  public codexPreviewSpec: { tab: string; itemId: string } | null = null;
  public codexYaw = 0.45;
  private shakeScale = 1.0;
  public replayCameraMode: 'chase' | 'tactical_top' | 'action_closeup' = 'chase';
  private omegaBeamGroup!: THREE.Group;
  private omegaBeamCore!: THREE.Mesh;
  private omegaBeamWarn!: THREE.Mesh;
  private omegaBeamCoreMat!: THREE.MeshBasicMaterial;
  private omegaBeamWarnMat!: THREE.MeshBasicMaterial;
  private phaseKinTex!: THREE.CanvasTexture;
  private phaseEngTex!: THREE.CanvasTexture;
  private execCamTimer = 0;
  private execCamDur = 1.35;
  private frameTimesMs = new Float32Array(48);
  private frameTimeCursor = 0;
  private decals!: THREE.InstancedMesh;
  private decalDataArr = new Float32Array(MAX_DECALS * 4);
  private decalDataAttr!: THREE.InstancedBufferAttribute;
  private decalPool: DecalEntry[] = Array.from({ length: MAX_DECALS }, () => ({
    active: false, x: 0, z: 0, radius: 1, rot: 0, age: 0, maxAge: 12, kind: 0, r: 1, g: 1, b: 1,
  }));
  private decalCursor = 0;
  private lastScrollVal = 0;
  private holoRing!: THREE.Mesh;
  private holoRingMat!: THREE.ShaderMaterial;
  private neonLightsUniform: THREE.Vector4[] = Array.from({ length: 12 }, () => new THREE.Vector4(0, -999, 1, 0));
  private neonColorsUniform: THREE.Vector3[] = Array.from({ length: 12 }, () => new THREE.Vector3(0, 0, 0));
  private bossShoulderPods: [THREE.Group, THREE.Group, THREE.Group] | null = null;
  private bossPodReticles: [THREE.Mesh, THREE.Mesh, THREE.Mesh] | null = null;
  private squadSkin: SquadSkinId = 'cyan';
  public qualityScale = 1.0;
  public emaFrameMs = 16.0;
  private slowFrameStreak = 0;
  private fastFrameStreak = 0;
  private mirrorTroopers!: THREE.InstancedMesh;
  private mirrorGlow!: THREE.Mesh;
  private mirrorRing!: THREE.Mesh;
  private frameTick = 0;
  private nukeDropPool: NukeDropSlot[] = [];
  private nukeBlastPool: NukeBlastSlot[] = [];
  private nukeBlastWasActive = false;
  private nukeJustDetonated = false;
  private jumpTex!: THREE.CanvasTexture;
  private reflectorTex!: THREE.CanvasTexture;
  private bountyTex!: THREE.CanvasTexture;
  private hazardViews: HazardView[] = [];

  // shared props
  private glowTex = makeGlowTexture();
  private hexTex = makeHexCommandTexture();
  private readonly forceProcedural: boolean;
  private stripeTex = makeStripeTexture();
  private propMat = makeCharacterMaterial(0xbfe8ff, 0.35, 1.6);
  private vaultToonMat = createToonCharMaterial({ rimColor: 0xffffff, rimStrength: 0.55 });
  private fallbackRewardGeos = new Map<string, THREE.BufferGeometry>();
  private vaultFrameGeo!: THREE.BufferGeometry;
  private trialVault: THREE.Group | null = null;
  private trialPropSource: 'off' | 'loading' | 'tripo' | 'fallback' = 'off';
  private barrelGeo!: THREE.BufferGeometry;
  private towerMat!: THREE.ShaderMaterial;
  private lensTex: THREE.CanvasTexture;
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private tmpV = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  // camera & seismic screen shake
  private camX = 0;
  private prevSquadXForCam = 0;
  private camBankRoll = 0;
  private dynFovOffset = 0;
  private shockwaveAmt = 0;
  private trauma = 0;
  private camKickZ = 0;
  private camKickRoll = 0;
  private bossBlend = 0;
  private fov = 58;
  private nukeQuakeTimer = 0;
  private nukeQuakeDur = 2.65;
  private nukeQuakeStrength = 0;
  private nukeWaveTimer = 0;
  private nukeWaveDur = 1.15;
  private nukeHeatAmt = 0;
  private nukeFlareAmt = 0;
  private readonly nukeTintVec = new THREE.Vector3(1.18, 0.80, 0.38);
  private nukeDescentTremor = 0;
  private readonly screenShakeOut = { x: 0, y: 0, rotDeg: 0, scale: 1 };

  constructor(canvas: HTMLCanvasElement, opts: { forceProcedural?: boolean; trialArt?: boolean } = {}) {
    this.forceProcedural = opts.forceProcedural === true;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.24;
    this.scene.add(this.effects.group);

    const lensC = makeCanvasTexture(384, 112);
    paintLensPlate(lensC.ctx, 384, 112);
    lensC.tex.needsUpdate = true;
    this.lensTex = lensC.tex;

    const jumpC = makeCanvasTexture(384, 108);
    paintSetPiecePlate(jumpC.ctx, 384, 108, 'jump');
    jumpC.tex.needsUpdate = true;
    this.jumpTex = jumpC.tex;

    const refC = makeCanvasTexture(384, 108);
    paintSetPiecePlate(refC.ctx, 384, 108, 'reflector');
    refC.tex.needsUpdate = true;
    this.reflectorTex = refC.tex;

    const btyC = makeCanvasTexture(384, 108);
    paintSetPiecePlate(btyC.ctx, 384, 108, 'bounty');
    btyC.tex.needsUpdate = true;
    this.bountyTex = btyC.tex;

    const makePhasePlate = (txt: string, hex: string): THREE.CanvasTexture => {
      const c = makeCanvasTexture(384, 96);
      c.ctx.clearRect(0, 0, 384, 96);
      c.ctx.fillStyle = 'rgba(8, 16, 34, 0.88)';
      c.ctx.fillRect(10, 10, 364, 76);
      c.ctx.strokeStyle = hex;
      c.ctx.lineWidth = 5;
      c.ctx.strokeRect(10, 10, 364, 76);
      c.ctx.fillStyle = hex;
      c.ctx.font = '900 32px system-ui, sans-serif';
      c.ctx.textAlign = 'center';
      c.ctx.textBaseline = 'middle';
      c.ctx.fillText(txt, 192, 50);
      c.tex.needsUpdate = true;
      return c.tex;
    };
    this.phaseKinTex = makePhasePlate('⚡ 动能相位 · 切实弹/脉冲', '#c99bff');
    this.phaseEngTex = makePhasePlate('✦ 能量相位 · 切能武/脉冲', '#5ef6ff');

    this.buildLights();
    this.buildEnvironment();
    this.buildSquadShell();
    this.buildEnemyShell();
    this.buildProjectiles();
    this.buildHazards();
    this.buildNukeVisuals();
    this.buildV22Visuals();
    this.buildV23Visuals();
    this.initPostProcessing();
    this.setSector(1);

    const actorsReady = this.loadActorModels().catch((err: unknown) => {
      this.actorModelSource = 'failed';
      console.error('Failed building actor models:', err);
    });
    this.assetsReady = Promise.all([actorsReady, opts.trialArt ? this.loadTrialProps() : Promise.resolve()]).then(() => undefined);
  }

  get propSource(): 'off' | 'loading' | 'tripo' | 'fallback' {
    return this.trialPropSource;
  }

  private async loadTrialProps(): Promise<void> {
    this.trialPropSource = 'loading';
    try {
      this.trialVault = await withTimeout(loadTrialVault(), 12000, 'Tripo trial prop');
      this.trialPropSource = 'tripo';
      for (const view of [...this.vaultViews.values(), ...this.vaultPool]) this.installTrialCasing(view);
    } catch (err) {
      this.trialPropSource = 'fallback';
      console.warn('Tripo trial prop unavailable; retaining the original vault casing.', err);
    }
  }

  private installTrialCasing(view: VaultView): void {
    if (!this.trialVault || view.frame.userData.tripoTrial) return;
    view.frame.removeFromParent();
    view.frame = this.trialVault.clone(true);
    view.group.add(view.frame);
    view.crystal.visible = false;
  }

  /** Which actor models are in use; 'procedural' means the GLB models could not be loaded. */
  get modelSource(): ActorModelSource {
    return this.actorModelSource;
  }

  private async loadActorModels(): Promise<void> {
    let lib: GltfLibrary | null = null;
    if (!this.forceProcedural) {
      try {
        lib = await withTimeout(loadGltfLibrary(), GLTF_LOAD_TIMEOUT_MS, 'GLB model load');
      } catch (err) {
        console.error('GLB models unavailable, using procedural fallback models:', err);
      }
    }
    const source = lib ? 'gltf' : 'procedural';
    lib ??= buildProceduralLibrary();
    this.initGltfPools(lib);
    this.gltfLib = lib;
    this.actorModelSource = source;
  }

  private initPostProcessing(): void {
    try {
      const composer = new EffectComposer(this.renderer);
      const renderPass = new RenderPass(this.scene, this.camera);
      // High threshold (0.93) keeps cartoon outlines, character faces, and gate numbers razor-sharp
      // while giving HDR projectiles, muzzle flashes, and explosions a crisp neon bloom!
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.38, 0.91);
      const impactPass = new ShaderPass({
        uniforms: {
          tDiffuse: { value: null },
          uChroma: { value: 0.0 },
          uRadialBlur: { value: 0.0 },
          uSplitTone: { value: 0.0 },
          uPhotoFilter: { value: 0.0 },
          uPhotoTime: { value: 0.0 },
          uNukeWave: { value: 0.0 },
          uNukeHeat: { value: 0.0 },
          uNukeFlare: { value: 0.0 },
          uNukeTint: { value: new THREE.Vector3(1.18, 0.80, 0.38) },
          uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse;
          uniform float uChroma;
          uniform float uRadialBlur;
          uniform float uSplitTone;
          uniform float uPhotoFilter;
          uniform float uPhotoTime;
          uniform float uNukeWave;
          uniform float uNukeHeat;
          uniform float uNukeFlare;
          uniform vec3 uNukeTint;
          uniform vec2 uCenter;
          varying vec2 vUv;
          void main() {
            vec2 dir = vUv - uCenter;
            float dist = length(dir);
            if (uChroma <= 0.0002 && uRadialBlur <= 0.001 && uSplitTone <= 0.001 && uPhotoFilter < 0.5 && uNukeWave <= 0.001 && uNukeHeat <= 0.001 && uNukeFlare <= 0.001) {
              gl_FragColor = texture2D(tDiffuse, vUv);
              return;
            }
            vec2 uvBase = vUv;
            float shockBand = 0.0;
            if (uNukeWave > 0.001) {
              float ringR1 = uNukeWave * 1.48;
              float d1 = (dist - ringR1) / 0.082;
              float band1 = exp(-d1 * d1) * (1.0 - uNukeWave * 0.68);
              float ringR2 = max(0.0, uNukeWave - 0.12) * 1.35;
              float d2 = (dist - ringR2) / 0.062;
              float band2 = uNukeWave > 0.12 ? exp(-d2 * d2) * (1.0 - uNukeWave * 0.78) * 0.72 : 0.0;
              shockBand = band1 + band2;
              vec2 nDir = dist > 0.0005 ? dir / dist : vec2(0.0, 1.0);
              uvBase = clamp(vUv - nDir * shockBand * 0.052, 0.001, 0.999);
            }
            vec2 dirW = uvBase - uCenter;
            float distW = length(dirW);
            vec2 cOff = dirW * (uChroma + shockBand * 0.028) * (0.35 + distW * 1.45);
            vec3 acc = vec3(0.0);
            const int SAMPLES = 6;
            for (int i = 0; i < SAMPLES; i++) {
              float fi = float(i) / float(SAMPLES - 1);
              float scale = 1.0 - (uRadialBlur + shockBand * 0.28) * 0.16 * fi * smoothstep(0.05, 0.65, distW);
              vec2 suv = uCenter + dirW * scale;
              float r = texture2D(tDiffuse, clamp(suv + cOff, 0.001, 0.999)).r;
              float g = texture2D(tDiffuse, clamp(suv, 0.001, 0.999)).g;
              float b = texture2D(tDiffuse, clamp(suv - cOff, 0.001, 0.999)).b;
              acc += vec3(r, g, b);
            }
            vec3 finalCol = acc / float(SAMPLES);
            if (shockBand > 0.001) {
              finalCol += uNukeTint * shockBand * 0.42;
            }
            // Crisp high-contrast anime solarized impact flash on initial detonation frames
            if (uNukeWave > 0.001 && uNukeWave < 0.09) {
              float impFade = 1.0 - uNukeWave / 0.09;
              float lumImp = dot(finalCol, vec3(0.299, 0.587, 0.114));
              vec3 solarRim = mix(vec3(0.04, 0.02, 0.08), uNukeTint * 1.35 + vec3(0.35), smoothstep(0.32, 0.78, lumImp));
              finalCol = mix(finalCol, solarRim, impFade * 0.46);
            }
            // Cinema Horizontal Anamorphic Lens Flare Streak across epicenter
            if (uNukeFlare > 0.001) {
              float dy = abs(vUv.y - uCenter.y);
              float dx = abs(vUv.x - uCenter.x);
              float streakCore = exp(-dy * 68.0) * exp(-dx * 1.65);
              float streakWide = exp(-dy * 18.0) * exp(-dx * 3.2) * 0.45;
              finalCol += (uNukeTint * 0.85 + vec3(0.55)) * (streakCore + streakWide) * uNukeFlare * 1.25;
            }
            if (uNukeHeat > 0.001) {
              float edgeHeat = smoothstep(0.16, 0.94, dist);
              finalCol = mix(finalCol, finalCol * (vec3(0.88) + uNukeTint * 0.34) + uNukeTint * 0.12, uNukeHeat * (0.28 + 0.44 * edgeHeat));
            }
            if (uSplitTone > 0.001) {
              float luma = dot(finalCol, vec3(0.299, 0.587, 0.114));
              vec3 hiTint = vec3(1.15, 1.08, 0.88);
              vec3 loTint = vec3(0.90, 1.04, 1.15);
              finalCol *= mix(loTint, hiTint, smoothstep(0.25, 0.82, luma) * uSplitTone);
            }
            if (uPhotoFilter > 0.5 && uPhotoFilter < 1.5) {
              // Filter 1: Cyber Noir-Gold Matrix (high-contrast obsidian + selective neon gold/cyan)
              float lum = dot(finalCol, vec3(0.299, 0.587, 0.114));
              float hi = smoothstep(0.42, 0.92, lum);
              vec3 noir = mix(vec3(0.05, 0.07, 0.13), vec3(1.08, 0.86, 0.36), hi);
              finalCol = mix(noir, finalCol * vec3(1.18, 1.02, 0.72), 0.38);
            } else if (uPhotoFilter >= 1.5) {
              // Filter 2: Cyber Glitch Scanlines + Holographic RGB Split
              float scan = 0.90 + 0.10 * sin(vUv.y * 520.0 + uPhotoTime * 18.0);
              float band = step(0.965, fract(sin(floor(vUv.y * 28.0) * 43.17 + floor(uPhotoTime * 8.0)) * 197.3));
              vec2 gShift = vec2(0.0045 + band * 0.014, 0.0);
              float gr = texture2D(tDiffuse, clamp(vUv + gShift, 0.001, 0.999)).r;
              float gb = texture2D(tDiffuse, clamp(vUv - gShift, 0.001, 0.999)).b;
              finalCol = vec3(gr, finalCol.g, gb) * scan;
            }
            gl_FragColor = vec4(finalCol, 1.0);
          }`,
      });
      const outputPass = new OutputPass();
      composer.addPass(renderPass);
      composer.addPass(bloomPass);
      composer.addPass(impactPass);
      composer.addPass(outputPass);
      this.composer = composer;
      this.bloomPass = bloomPass;
      this.impactPass = impactPass;
    } catch {
      this.composer = null;
      this.bloomPass = null;
    }
  }

  private initGltfPools(lib: GltfLibrary): void {
    // 1. Pre-warm hero squad pools (Tier 1 trooper, Tier 2 gold heavy, Tier 3 assault mech)
    const heroRims: [number, number, number] = [0x9beeff, 0xffe484, 0x8ff6ff];
    const heroOutlines: [number, number, number] = [0.0027, 0.003, 0.0032];
    for (let tierIdx = 0; tierIdx < 3; tierIdx++) {
      const count = SQUAD_POOL_SIZES[tierIdx]!;
      const tmpl = lib.heroes[tierIdx]!;
      for (let i = 0; i < count; i++) {
        const actor = spawnActor(tmpl, {
          rimColor: heroRims[tierIdx],
          rimStrength: 0.24,
          outlineWidth: heroOutlines[tierIdx],
          weapons: tierIdx < 2 ? lib.weapons : undefined,
          initialWeapon: this.currentWeapon,
        });
        actor.root.visible = false;
        this.scene.add(actor.root);
        this.squadPools[tierIdx]!.push(actor);
      }
    }

    // 2. Pre-bake 7-pose GPU InstancedMesh batches per monster archetype (zero runtime CPU skinning!)
    const enemyRims: Record<EnemyKind, number> = {
      crawler: 0xff9eb2,
      dasher: 0xffcf70,
      bastion: 0xff8598,
      mitosis: 0xffb3f0,
      siphon: 0xd4a6ff,
      bomber: 0xc2ff66,
      phalanx: 0x7df3ff,
      stalker: 0xf29eff,
      brood: 0xffcf6e,
      howler: 0xff7da6,
      glacier: 0x9bf6ff,
      beholder: 0xffe07d,
      burrower: 0xff9f59,
      necromancer: 0x6dffbe,
    };
    const makeBatch = (
      pair: BakedPosePair,
      toonMat: THREE.MeshToonMaterial,
      outlineMat: THREE.MeshBasicMaterial,
      cap: number,
    ): EnemyPoseBatch => {
      const fxArray = new Float32Array(cap * 4);
      const fxAttr = new THREE.InstancedBufferAttribute(fxArray, 4);
      fxAttr.setUsage(THREE.DynamicDrawUsage);

      const bodyGeo = pair.geo.clone();
      bodyGeo.setAttribute('aInstanceFx', fxAttr);
      const body = new THREE.InstancedMesh(bodyGeo, toonMat, cap);
      body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      body.frustumCulled = false;
      body.count = 0;
      body.visible = false;

      const outline = new THREE.InstancedMesh(pair.outlineGeo, outlineMat, cap);
      outline.instanceMatrix = body.instanceMatrix; // Share exact 4x4 instanceMatrix buffer!
      outline.frustumCulled = false;
      outline.count = 0;
      outline.visible = false;

      this.scene.add(body, outline);
      return { body, outline, fxAttr, fxArray, count: 0, outlineCount: 0, cap };
    };

    for (const kind of Object.keys(ENEMY_BATCH_CAP) as EnemyKind[]) {
      const cap = ENEMY_BATCH_CAP[kind];
      const tmpl = lib.enemies[kind];
      const poseSet = bakeEnemyPoseFrames(kind, tmpl);
      const toonMat = createInstancedEnemyToonMaterial({
        rimColor: enemyRims[kind],
        rimStrength: 0.28,
        vertexColors: !tmpl.textured,
        map: tmpl.texture,
      });
      const outlineMat = getOutlineMaterial(kind === 'bastion' || kind === 'glacier' ? 0.004 : 0.0034);
      const allFrames = [...poseSet.locomotion, poseSet.action];
      this.enemyBatches[kind] = allFrames.map((pair) => makeBatch(pair, toonMat, outlineMat, cap));
    }

    // 3. Build the 3 sculpted CC0 sector bosses + dedicated Pantheon Dual-Boss Co-Boss clone
    this.buildGltfBosses(lib);
    if (!this.coBossActor && this.coBossGroup) {
      const fb = this.coBossGroup.getObjectByName('fallbackCoBoss');
      if (fb) fb.visible = false;
      this.coBossActor = spawnActor(lib.bosses.warden, {
        rimColor: 0xff6289,
        rimStrength: 0.58,
        outlineWidth: 0.006,
      });
      this.coBossActor.play('Fast_Flying', { timeScale: 1.05 });
      this.coBossGroup.add(this.coBossActor.root);
    }

    // 4. Refresh any active Reward Vaults to show the 3D Toon weapon + outline
    for (const v of this.vaultViews.values()) {
      v.reward = '';
    }
  }

  private buildGltfBosses(lib: GltfLibrary): void {
    // Sector 1: WARDEN-01《赤焰魔像王》
    {
      const root = new THREE.Group();
      const primary = spawnActor(lib.bosses.warden, {
        rimColor: 0xffb36b,
        rimStrength: 0.5,
        outlineWidth: 0.0062,
      });
      primary.play('Fast_Flying', { timeScale: 0.95 });
      const shield = this.makeShield(3.2);
      shield.position.y = 2.6;
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(2.1, 2.55, 36).rotateX(-Math.PI / 2),
        additive(0xff5238, 0.45),
      );
      halo.position.y = 0.06;
      root.add(primary.root, shield, halo);
      root.visible = false;
      this.scene.add(root);
      this.bossViews.set('warden_01', {
        root,
        primary,
        halo,
        coreHeight: 2.65,
        shield,
        attackCooldown: 0,
      });
    }

    // Sector 2: HYDRA-02《双生魔龙》
    {
      const root = new THREE.Group();
      const primary = spawnActor(lib.bosses.hydraA, {
        rimColor: 0xff94ec,
        rimStrength: 0.5,
        outlineWidth: 0.006,
      });
      primary.play('Fast_Flying', { timeScale: 1.0 });
      const shield = this.makeShield(2.8);
      shield.position.y = 2.7;
      root.add(primary.root, shield);
      root.visible = false;

      const secondaryRoot = new THREE.Group();
      const secondary = spawnActor(lib.bosses.hydraB, {
        rimColor: 0x8ff6ff,
        rimStrength: 0.5,
        outlineWidth: 0.0058,
      });
      secondary.play('Fast_Flying', { timeScale: 1.1, startOffset: 0.4 });
      const shield2 = this.makeShield(2.35);
      shield2.position.y = 2.3;
      secondaryRoot.add(secondary.root, shield2);
      secondaryRoot.visible = false;

      this.scene.add(root, secondaryRoot);
      this.bossViews.set('hydra_02', {
        root,
        primary,
        secondary,
        secondaryRoot,
        coreHeight: 2.7,
        secondaryCoreHeight: 2.3,
        shield,
        shield2,
        attackCooldown: 0,
      });
    }

    // Sector 3: OMEGA-ZERO《深渊魔王》 + Singularity Halo + 2 Crystal Shield Pylons
    {
      const root = new THREE.Group();
      const primary = spawnActor(lib.bosses.omega, {
        rimColor: 0xffd86b,
        rimStrength: 0.55,
        outlineWidth: 0.0064,
      });
      primary.play('Idle', { timeScale: 1.0 });

      // Cosmic singularity halo floating behind the Demon Overlord's wings
      const haloGeo = new GeoBuilder()
        .add(tor(2.35, 0.085, 6, 36), 0xffc531, 0.48)
        .add(tor(1.85, 0.055, 5, 28), 0xff3b6b, 0.45)
        .build();
      const halo = new THREE.Mesh(haloGeo, this.propMat);
      halo.position.set(0, 3.1, -1.05);

      const shield = this.makeShield(3.45);
      shield.position.y = 2.75;
      root.add(halo, primary.root, shield);
      root.visible = false;
      this.scene.add(root);

      const crystalGeo = new GeoBuilder()
        .add(new THREE.OctahedronGeometry(0.85, 0), 0x3fa8c8, 0.5, { s: [1, 2.1, 1] })
        .add(new THREE.OctahedronGeometry(0.3, 0), 0xffffff, 1.8, { s: [1, 2.1, 1], p: [0, 0, 0.52] })
        .add(tor(1.05, 0.06, 4, 20), 0x8ff6ff, 2.2, { r: [Math.PI / 2, 0, 0], p: [0, -0.55, 0] })
        .build();
      const footGeo = new GeoBuilder()
        .add(cyl(0.88, 1.2, 0.42, 6), 0x1c0f24, 0, { p: [0, 0.21, 0] })
        .add(cyl(0.68, 0.88, 0.2, 6), 0x2c1236, 0, { p: [0, 0.52, 0] })
        .add(tor(0.96, 0.05, 4, 6), 0x8ff6ff, 2.0, { r: [Math.PI / 2, 0, 0], p: [0, 0.44, 0] })
        .build();

      const pylons: THREE.Group[] = [];
      const beams: THREE.Mesh[] = [];
      for (let i = 0; i < 2; i++) {
        const p = new THREE.Group();
        const crystal = new THREE.Mesh(crystalGeo, this.propMat);
        crystal.position.y = 2.05;
        const foot = new THREE.Mesh(footGeo, this.propMat);
        p.add(crystal, foot);
        p.visible = false;
        pylons.push(p);
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.08, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2),
          additive(0x8ff6ff, 0.8),
        );
        beam.visible = false;
        beams.push(beam);
        this.scene.add(p, beam);
      }

      this.bossViews.set('omega_zero', {
        root,
        primary,
        halo,
        pylons,
        beams,
        coreHeight: 2.85,
        shield,
        attackCooldown: 0,
      });
    }
  }

  // ------------------------------------------------------------------ scene setup
  private buildLights(): void {
    // Sculptural 3-point lighting: deep indigo ground fill + crisp 3/4 directional key + subtle rim kicker
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x1b1642, 0.56);
    this.scene.add(this.hemi);
    this.dirLight = new THREE.DirectionalLight(0xfff0dc, 1.45);
    this.dirLight.position.set(-9, 14, 6);
    this.scene.add(this.dirLight);
    const back = new THREE.DirectionalLight(0x6ad8ff, 0.45);
    back.position.set(5, 7, -14);
    this.scene.add(back);
  }

  private buildEnvironment(): void {
    // AAA Wet Rain-Slick Cyberpunk Bridge Deck with 8-Source Real-Time Anisotropic Neon Puddle Reflections!
    this.trackMat = new THREE.ShaderMaterial({
      uniforms: {
        uScroll: { value: 0 },
        uTime: { value: 0 },
        uTrack: { value: new THREE.Color(0x1c3468) },
        uGrid: { value: new THREE.Color(0x3f8cff) },
        uEdge: { value: new THREE.Color(0x48f5ff) },
        uFog: { value: new THREE.Color(0x122a68) },
        uHalf: { value: TRACK_HALF_WIDTH },
        uOverdrive: { value: 0 },
        uBoss: { value: 0 },
        uNeonLights: { value: this.neonLightsUniform },
        uNeonColors: { value: this.neonColorsUniform },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uScroll; uniform float uTime; uniform float uHalf; uniform float uOverdrive; uniform float uBoss;
        uniform vec3 uTrack; uniform vec3 uGrid; uniform vec3 uEdge; uniform vec3 uFog;
        uniform vec4 uNeonLights[12];
        uniform vec3 uNeonColors[12];
        varying vec3 vW;
        float line(float v, float w) { float f = abs(fract(v) - 0.5); return smoothstep(w, 0.0, 0.5 - f); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        void main() {
          float zz = vW.z - uScroll;
          float ax = abs(vW.x);
          float plate = floor(zz / 8.0);
          float plateTone = 0.94 + hash(vec2(plate, floor(ax / 2.5))) * 0.1;
          float brushed = sin(vW.x * 160.0 + sin(zz * 0.3)) * 0.004;
          float centerSheen = pow(max(0.0, 1.0 - ax / uHalf), 2.0);
          vec3 c = uTrack * (plateTone * 0.74 + centerSheen * 0.25 + brushed);

          // Procedural wet-rain puddle mask + subtle animated raindrop concentric micro-ripples
          float n1 = vnoise(vec2(vW.x * 0.52, zz * 0.16));
          float n2 = vnoise(vec2(vW.x * 1.35 + 4.1, zz * 0.42 - 2.3));
          float puddle = smoothstep(0.38, 0.74, n1 * 0.65 + n2 * 0.35);
          vec2 rainCell = floor(vec2(vW.x * 2.2, zz * 2.2));
          vec2 rainUv = fract(vec2(vW.x * 2.2, zz * 2.2)) - 0.5;
          float rPhase = fract(hash(rainCell) + uTime * 1.35);
          float rRing = smoothstep(0.06, 0.0, abs(length(rainUv) - rPhase * 0.45)) * (1.0 - rPhase);
          float wetShimmer = puddle * (0.72 + rRing * 0.85);
          // PBR Schlick Fresnel wet-metal grazing specular + brushed titanium micro-anisotropy (additive bright parity!)
          vec3 viewVec = normalize(vec3(-vW.x * 0.25, 10.6, 16.0 - vW.z));
          float ndv = clamp(viewVec.y, 0.05, 1.0);
          float f0 = mix(0.06, 0.42, puddle);
          float fresnel = f0 + (1.0 - f0) * pow(1.0 - ndv, 4.2);
          c += mix(uGrid, uEdge, 0.48) * (puddle * (0.08 + rRing * 0.13) + fresnel * 0.14);

          float px = abs(fract((vW.x + 5.5) / 2.75) - 0.5);
          float seam = smoothstep(0.48 - fwidth(px), 0.49, px);
          c *= 1.0 - seam * 0.26;
          // Elongated wet specular pools from edge neon lamps
          float lampZ = abs(fract((zz + 1.5) / 8.0) - 0.5) * 8.0;
          float reflection = exp(-lampZ * lampZ * 0.24) * pow(ax / uHalf, 5.2) * (0.75 + puddle * 0.9);
          c += uEdge * reflection * 0.16;

          float cross = line(zz / 8.0, 0.018);
          float bevel = line((zz + 0.11) / 8.0, 0.008);
          c *= 1.0 - cross * 0.24;
          c += uGrid * bevel * 0.18;
          float innerFrame = smoothstep(0.025, 0.0, abs(ax - (uHalf - 0.72)));
          c += uGrid * innerFrame * 0.17;

          float rz = min(fract(zz / 8.0), 1.0 - fract(zz / 8.0)) * 8.0;
          float rivet = smoothstep(0.14, 0.035, length(vec2(ax - (uHalf - 0.94), rz)));
          c += mix(uGrid, vec3(0.85), 0.55) * rivet * 0.38;
          float lanes = line((vW.x + uHalf) / (uHalf * 2.0 / 3.0), 0.012) * step(0.52, fract(zz / 5.0));
          c += uGrid * lanes * 0.24;
          float chev = fract((zz + ax * 0.85) / 10.0);
          c += uEdge * smoothstep(0.026, 0.0, abs(chev - 0.5)) * smoothstep(uHalf, uHalf - 1.1, ax) * smoothstep(uHalf - 2.3, uHalf - 1.4, ax) * 0.3;
          float lanePos = abs(fract((vW.x + uHalf) / (uHalf * 2.0 / 3.0)) - 0.5);
          float conduit = smoothstep(0.018, 0.003, lanePos);
          float packet = pow(max(0.0, sin((zz + uTime * 22.0) * 0.28)), 8.0);
          c += mix(uGrid, uEdge, 0.5) * conduit * (0.12 + packet * 0.28);

          // 12-Source Real-Time Anisotropic Wet-Metal Flowing Neon Reflections!
          vec2 rippleWarp = rainUv * rRing * 0.35;
          float flowWave = 0.88 + 0.22 * sin(zz * 1.9 + uTime * 4.8 + vW.x * 1.6);
          for (int i = 0; i < 12; i++) {
            vec4 L = uNeonLights[i];
            if (L.w > 0.01) {
              float dx = (vW.x + rippleWarp.x) - L.x;
              float dz = (vW.z + rippleWarp.y - L.y) * 0.29;
              float d2 = (dx * dx + dz * dz) / max(0.35, L.z * L.z);
              float spec = exp(-d2 * 1.52) * L.w * (0.38 + wetShimmer * 0.94) * flowWave;
              c += uNeonColors[i] * spec;
            }
          }

          if (uOverdrive > 0.01) {
            float warp = pow(max(0.0, sin(vW.x * 14.0) * sin((zz + uTime * 48.0) * 0.35)), 6.0);
            c += vec3(1.0, 0.88, 0.35) * warp * uOverdrive * 0.32;
          }
          if (uBoss > 0.01) {
            float bossBand = smoothstep(uHalf - 0.85, uHalf - 0.32, ax) * step(0.5, fract((zz - uTime * 6.0) / 2.4));
            c += vec3(1.0, 0.18, 0.32) * bossBand * uBoss * 0.26;
          }
          float scan = exp(-900.0 * pow(fract((zz + uTime * 4.0) / 32.0) - 0.5, 2.0));
          c += uEdge * scan * smoothstep(uHalf, 0.0, ax) * 0.065;
          float edge = smoothstep(uHalf - 0.32, uHalf, ax);
          c = mix(c, uEdge * 0.95, edge * 0.88);
          float fog = smoothstep(64.0, 162.0, -vW.z);
          c = mix(c, uFog, fog);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(TRACK_HALF_WIDTH * 2 + 0.2, TRACK_LEN),
      this.trackMat,
    );
    track.rotation.x = -Math.PI / 2;
    track.position.z = TRACK_CENTER_Z;
    this.scene.add(track);

    this.groundMat = new THREE.ShaderMaterial({
      uniforms: {
        uScroll: { value: 0 },
        uGrid: { value: new THREE.Color(0x3f8cff) },
        uFog: { value: new THREE.Color(0x122a68) },
        uBase: { value: new THREE.Color(0x060c22) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uScroll; uniform vec3 uGrid; uniform vec3 uFog; uniform vec3 uBase;
        varying vec3 vW;
        void main() {
          vec2 p = vec2(vW.x, vW.z - uScroll) / 3.5;
          vec2 g = abs(fract(p) - 0.5);
          float l = smoothstep(0.47, 0.5, max(g.x, g.y));
          vec3 c = uBase + uGrid * l * 0.16;
          float fog = smoothstep(38.0, 152.0, -vW.z + abs(vW.x) * 0.4);
          gl_FragColor = vec4(mix(c, uFog, fog), 1.0);
        }`,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, TRACK_LEN), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.6, TRACK_CENTER_Z);
    this.scene.add(ground);

    const wallMat = std(0x111d42, 0.08, { flatShading: false });
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.72, TRACK_LEN), wallMat);
      wall.position.set(s * (TRACK_HALF_WIDTH + 0.25), -0.25, TRACK_CENTER_Z);
      this.scene.add(wall);
    }
    this.railMat = new THREE.MeshBasicMaterial({ color: 0x48f5ff });
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.065, TRACK_LEN), this.railMat);
      rail.position.set(s * (TRACK_HALF_WIDTH + 0.25), 0.18, TRACK_CENTER_Z);
      this.scene.add(rail);
    }
    this.postMat = new THREE.MeshBasicMaterial({ color: 0x48f5ff });
    this.posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.72, 0.18), this.postMat, 64);
    this.scene.add(this.posts);

    // Stylized city skyline towers
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    towerGeo.translate(0, 0.5, 0);
    this.towerMat = new THREE.ShaderMaterial({
      uniforms: {
        uBase: { value: new THREE.Color(0x0f1e4a) },
        uWinA: { value: new THREE.Color(0x3ef3ff) },
        uWinB: { value: new THREE.Color(0xff5ce0) },
        uFog: { value: new THREE.Color(0x122a68) },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vL; varying vec3 vN; varying vec3 vW; varying float vSeed; varying float vH;
        void main() {
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vL = position * sc;
          vH = sc.y;
          vN = normal;
          vSeed = instanceMatrix[3].x * 7.31 + sc.x * 3.7;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uBase; uniform vec3 uWinA; uniform vec3 uWinB; uniform vec3 uFog; uniform float uTime;
        varying vec3 vL; varying vec3 vN; varying vec3 vW; varying float vSeed; varying float vH;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec3 n = abs(vN);
          vec3 c = uBase * (0.6 + 0.55 * clamp(vL.y / max(vH, 1.0), 0.0, 1.0));
          if (n.y < 0.5) {
            float u = (n.x > 0.5 ? vL.z : vL.x) / 0.6;
            float v = vL.y / 0.75;
            vec2 cell = floor(vec2(u, v));
            vec2 f = fract(vec2(u, v));
            vec2 aa = max(fwidth(vec2(u, v)), vec2(0.015));
            vec2 windowMask = smoothstep(vec2(0.18), vec2(0.18) + aa, f) * (1.0 - smoothstep(vec2(0.78) - aa, vec2(0.78), f));
            float win = windowMask.x * windowMask.y;
            // Quantize the instance seed before hashing: tiny interpolator errors otherwise
            // turn a constant window into sparkling pixel noise on mobile GPUs.
            float h = hash(cell + floor(vSeed + 0.5));
            float lit = step(0.58, h) * win * step(0.6, vL.y);
            vec3 wc = mix(uWinA, uWinB, step(0.86, h));
            c += wc * lit * (0.16 + 0.12 * sin(uTime * 0.18 + h * 40.0));
            c += uWinA * 0.09 * smoothstep(0.47, 0.5, abs(fract(u * 0.125) - 0.5));
            float floorLine = 1.0 - smoothstep(0.018, 0.035 + aa.y, min(f.y, 1.0 - f.y));
            c *= 1.0 - floorLine * 0.25;
          } else {
            c = uWinA * 0.22;
          }
          // Dual-band volumetric cyber haze + sweeping horizon searchlight shafts
          float depthFog = smoothstep(46.0, 158.0, -vW.z) * 0.86 + 0.10;
          float lowHaze = exp(-max(0.0, vL.y) * 0.16) * smoothstep(24.0, 130.0, -vW.z);
          float shaft = pow(max(0.0, sin(vW.x * 0.11 + vW.y * 0.07 + uTime * 0.35)), 8.0) * smoothstep(55.0, 145.0, -vW.z);
          vec3 volFog = uFog + uWinB * lowHaze * 0.14 + uWinA * shaft * 0.18;
          gl_FragColor = vec4(mix(c, volFog, depthFog), 1.0);
        }`,
    });
    const n = 72;
    this.towers = new THREE.InstancedMesh(towerGeo, this.towerMat, n);
    this.towerCapMat = new THREE.MeshBasicMaterial({ color: 0x3f8cff });
    this.towerCaps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 1), this.towerCapMat, n);
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.towerData.push({
        x: side * (7.8 + rnd() * 16),
        z: rnd() * 130,
        w: 1.5 + rnd() * 3,
        d: 1.5 + rnd() * 3,
        h: 1.5 + rnd() * rnd() * 20,
      });
    }
    this.towers.frustumCulled = false;
    this.towerCaps.frustumCulled = false;
    this.scene.add(this.towers, this.towerCaps);
    this.environmentDetail = new EnvironmentDetail(this.towerData);
    this.infrastructure = new Infrastructure();
    this.scene.add(this.environmentDetail.group, this.infrastructure.group);
  }

  private buildSquadShell(): void {
    for (let i = 0; i < MAX_RENDER_SQUAD; i++) {
      this.squadSlots.push({
        x: 0,
        z: PLAYER_Z,
        s: 0,
        alive: false,
        vx: 0,
        tier: 1,
        weaponShown: 'pulse',
        actor: null,
      });
    }

    this.squadGlowMat = additive(0x3ef3ff, 0.35, this.glowTex);
    this.squadGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.squadGlowMat);
    this.squadGlow.rotation.x = -Math.PI / 2;
    this.squadGlow.position.y = 0.03;
    this.scene.add(this.squadGlow);

    this.squadRingMat = additive(0x3ef3ff, 0.42, this.hexTex);
    this.squadRing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.squadRingMat);
    this.squadRing.rotation.x = -Math.PI / 2;
    this.squadRing.position.y = 0.036;
    this.scene.add(this.squadRing);

    // 3D Diegetic Holographic Tactical Ring (projects Resonance Overdrive, Aegis Shield, and Tactical Nuke arcs!)
    this.holoRingMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uResonance: { value: 0 },
        uAegis: { value: 1 },
        uNuke: { value: 1 },
        uStreams: { value: 6 },
        uColor: { value: new THREE.Color(0x3ef3ff) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uResonance;
        uniform float uAegis;
        uniform float uNuke;
        uniform float uStreams;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          if (r < 0.58 || r > 1.0) discard;
          float ang = atan(vUv.x, -vUv.y); // -PI..PI, 0 = forward (-Z)
          float normA = (ang + 3.14159265) / 6.2831853;

          vec3 col = vec3(0.0);
          float alpha = 0.0;

          // 1) Inner Rotating Tactical Compass & Stream Ticks (r in 0.66..0.72)
          float innerBand = smoothstep(0.65, 0.675, r) * (1.0 - smoothstep(0.70, 0.725, r));
          float tick = step(0.55, fract(normA * max(6.0, uStreams * 2.0) - uTime * 0.45));
          col += uColor * innerBand * (0.28 + 0.52 * tick);
          alpha += innerBand * (0.22 + 0.35 * tick);

          // 2) Middle 360° Resonance Overdrive Arc (r in 0.76..0.84)
          float midBand = smoothstep(0.755, 0.78, r) * (1.0 - smoothstep(0.82, 0.845, r));
          float resoFill = step(normA, clamp(uResonance, 0.0, 1.0));
          vec3 resoCol = uResonance >= 0.99 ? vec3(1.0, 0.92, 0.42) : mix(uColor, vec3(1.0, 0.84, 0.32), 0.72);
          col += mix(vec3(0.12, 0.22, 0.36), resoCol, resoFill) * midBand;
          alpha += midBand * (0.16 + 0.68 * resoFill);

          // 3) Outer Split Tactical Arcs: Left = Phase Aegis [E] (Cyan), Right = Tactical Nuke [Q] (Amber-Gold)
          float outerBand = smoothstep(0.88, 0.905, r) * (1.0 - smoothstep(0.945, 0.97, r));
          if (vUv.x < -0.12) {
            float spanL = clamp((-vUv.y + 0.75) / 1.5, 0.0, 1.0);
            float fillL = step(spanL, clamp(uAegis, 0.0, 1.0));
            col += vec3(0.32, 0.96, 1.0) * outerBand * (0.18 + 0.78 * fillL);
            alpha += outerBand * (0.15 + 0.62 * fillL);
          } else if (vUv.x > 0.12) {
            float spanR = clamp((-vUv.y + 0.75) / 1.5, 0.0, 1.0);
            float fillR = step(spanR, clamp(uNuke, 0.0, 1.0));
            col += vec3(1.0, 0.68, 0.22) * outerBand * (0.18 + 0.78 * fillR);
            alpha += outerBand * (0.15 + 0.62 * fillR);
          }

          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
        }
      `,
    });
    this.holoRing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.holoRingMat);
    this.holoRing.position.y = 0.052;
    this.holoRing.renderOrder = 2;
    this.scene.add(this.holoRing);

    // 1024-Slot GPU-Instanced Battlefield Decal Pool (Blast Craters, Bio-Acid, Cryo Frost, Armor Slashes!)
    const decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.decalDataAttr = new THREE.InstancedBufferAttribute(this.decalDataArr, 4);
    this.decalDataAttr.setUsage(THREE.DynamicDrawUsage);
    decalGeo.setAttribute('aDecalData', this.decalDataAttr);
    const decalMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      toneMapped: false,
      vertexShader: /* glsl */ `
        attribute vec4 aDecalData;
        varying vec2 vUv;
        varying vec4 vDecal;
        varying vec3 vCol;
        void main() {
          vUv = uv * 2.0 - 1.0;
          vDecal = aDecalData;
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #else
            vCol = vec3(1.0, 0.7, 0.3);
          #endif
          vec4 mv = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            mv = instanceMatrix * mv;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying vec4 vDecal;
        varying vec3 vCol;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float kind = vDecal.x;
          float alpha = vDecal.y;
          float seed = vDecal.z;
          float ang = atan(vUv.y, vUv.x) + seed * 6.2831;

          vec3 col = vCol;
          float mask = 0.0;
          if (kind < 0.5) {
            // 0: Scorched Blast Crater + Glowing Radial Ember Fissures
            float darkPit = smoothstep(0.95, 0.2, r);
            float rimRing = smoothstep(0.18, 0.0, abs(r - 0.62));
            float rays = pow(max(0.0, cos(ang * 7.0 + sin(r * 10.0))), 6.0) * smoothstep(0.95, 0.15, r);
            float glow = rimRing * 0.65 + rays * 0.85;
            col = mix(vec3(0.04, 0.06, 0.14), vCol * 1.25, clamp(glow, 0.0, 1.0));
            mask = clamp(darkPit * 0.52 + glow * 0.72, 0.0, 1.0);
          } else if (kind < 1.5) {
            // 1: Bioluminescent Acid / Plasma Ichor Splatter
            float lobes = 0.58 + 0.28 * sin(ang * 5.0 + seed * 9.0) + 0.14 * cos(ang * 9.0 - seed * 4.0);
            float blob = smoothstep(lobes, lobes - 0.22, r);
            float edgeGlow = smoothstep(lobes, lobes - 0.08, r) * (1.0 - smoothstep(lobes - 0.1, lobes - 0.28, r));
            col = vCol * (0.78 + edgeGlow * 0.65);
            mask = blob * 0.64;
          } else if (kind < 2.5) {
            // 2: Crystalline Permafrost Fracture Star
            float star = pow(abs(cos(ang * 3.0)), 2.2) * 0.85 + 0.15;
            float shard = smoothstep(star, star - 0.25, r);
            col = mix(vCol, vec3(0.92, 0.98, 1.0), smoothstep(0.55, 0.0, r) * 0.55);
            mask = shard * 0.72;
          } else if (kind < 3.5) {
            // 3: Shattered Armor Scorch & Diagonal Plasma Slash
            float slash = smoothstep(0.16, 0.02, abs(vUv.y + sin(vUv.x * 3.0) * 0.08)) * smoothstep(0.96, 0.3, abs(vUv.x));
            col = vCol * 1.25;
            mask = slash * 0.82;
          } else if (kind < 4.5) {
            // 4: Molten Magma Fissure Veins (Omega Execution / Supernova / Nuke)
            float veins = pow(max(0.0, cos(ang * 5.0 + sin(r * 13.0 - seed * 6.0) * 1.8)), 8.0) * smoothstep(0.98, 0.08, r);
            float corePool = smoothstep(0.42, 0.05, r);
            float pulse = 0.86 + 0.14 * sin(uTime * 7.0 + seed * 12.0);
            col = mix(vec3(0.22, 0.14, 0.28), mix(vCol, vec3(1.0, 0.96, 0.68), corePool * 0.72) * 1.68 * pulse, clamp(veins * 1.15 + corePool, 0.0, 1.0));
            mask = clamp(veins * 0.86 + corePool * 0.68, 0.0, 0.88);
          } else {
            // 5: Magnetic Storm Tidal Ripple & Electro-Field Scar
            float rings = smoothstep(0.085, 0.0, abs(fract(r * 3.2 - uTime * 0.9 + seed) - 0.5) - 0.36) * smoothstep(0.98, 0.12, r);
            float arc = pow(max(0.0, cos(ang * 6.0 + r * 8.0)), 7.0) * smoothstep(0.92, 0.2, r);
            col = mix(vCol, vec3(0.82, 0.98, 1.0), 0.45) * 1.28;
            mask = clamp(rings * 0.65 + arc * 0.55, 0.0, 0.88);
          }
          gl_FragColor = vec4(col, mask * alpha);
        }
      `,
    });
    this.decalShaderMat = decalMat;
    this.decals = new THREE.InstancedMesh(decalGeo, decalMat, MAX_DECALS);
    this.decals.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DECALS * 3), 3);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 1;
    this.scene.add(this.decals);

    // 3D Geodesic Phase Aegis Force-Dome
    this.aegisGroup = new THREE.Group();
    this.aegisWireMat = new THREE.MeshBasicMaterial({
      color: 0x62f4ff,
      wireframe: true,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.aegisWire = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), this.aegisWireMat);
    this.aegisShellMat = additive(0x3ef3ff, 0.16);
    const aegisShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.98, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
      this.aegisShellMat,
    );
    this.aegisGroup.add(aegisShell, this.aegisWire);
    this.aegisGroup.visible = false;
    this.scene.add(this.aegisGroup);

    // Crisp contact shadows under every soldier & monster so characters sit solidly on the bridge deck
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x030614,
      map: this.glowTex,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    });
    this.shadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      shadowMat,
      MAX_SHADOWS,
    );
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.scene.add(this.shadows);

    this.blades = new THREE.InstancedMesh(buildBladeGeo(), this.propMat, 8);
    this.blades.count = 0;
    this.blades.frustumCulled = false;
    this.scene.add(this.blades);

    // Holographic Mirror-Twin Platoon (zero extra skinning cost, crisp neon prism troopers!)
    const holoGeo = new GeoBuilder()
      .add(cyl(0.18, 0.25, 0.56, 6), 0x62f4ff, 1.4, { p: [0, 0.42, 0] })
      .add(sph(0.21, 8, 6), 0xd8faff, 1.8, { p: [0, 0.86, 0] })
      .add(box(0.12, 0.12, 0.52), 0xc29bff, 1.8, { p: [0.18, 0.54, -0.24] })
      .build();
    this.mirrorTroopers = new THREE.InstancedMesh(holoGeo, additive(0x78f0ff, 0.58), MAX_RENDER_SQUAD);
    this.mirrorTroopers.count = 0;
    this.mirrorTroopers.frustumCulled = false;
    this.mirrorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), additive(0xc29bff, 0.28, this.glowTex));
    this.mirrorGlow.position.y = 0.03;
    this.mirrorGlow.visible = false;
    this.mirrorRing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), additive(0x62f4ff, 0.48, this.hexTex));
    this.mirrorRing.position.y = 0.038;
    this.mirrorRing.visible = false;
    this.scene.add(this.mirrorTroopers, this.mirrorGlow, this.mirrorRing);

    // Sculpted Boss Destructible Shoulder Pods (Left Heavy Cannon & Right Spawner Hive)
    const leftPodGeo = new GeoBuilder()
      .add(box(1.05, 0.92, 1.25), 0x3b1830, 0.35)
      .add(cyl(0.18, 0.2, 1.35, 8), 0xff4b5c, 1.6, { p: [-0.24, -0.05, 0.72], r: [Math.PI / 2, 0, 0] })
      .add(cyl(0.18, 0.2, 1.35, 8), 0xff4b5c, 1.6, { p: [0.24, -0.05, 0.72], r: [Math.PI / 2, 0, 0] })
      .add(oct(0.36), 0xffcf40, 2.0, { p: [0, 0.48, 0] })
      .build();
    const rightPodGeo = new GeoBuilder()
      .add(cyl(0.68, 0.52, 1.15, 6), 0x2c1544, 0.35)
      .add(oct(0.46), 0xc29bff, 1.9, { p: [0, 0.52, 0.15] })
      .add(tor(0.64, 0.07, 5, 16), 0x3ef3ff, 2.0, { r: [Math.PI / 2, 0, 0] })
      .build();
    const retL = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.24, 28), additive(0xff3b5c, 0.85));
    retL.position.set(0, 0.15, 0.82);
    retL.visible = false;
    const podL = new THREE.Group();
    podL.add(new THREE.Mesh(leftPodGeo, this.propMat), retL);
    podL.visible = false;
    const retR = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.24, 28), additive(0xc29bff, 0.85));
    retR.position.set(0, 0.15, 0.82);
    retR.visible = false;
    const podR = new THREE.Group();
    podR.add(new THREE.Mesh(rightPodGeo, this.propMat), retR);
    podR.visible = false;
    const reactorPodGeo = new GeoBuilder()
      .add(oct(0.62), 0x3ef3ff, 2.2)
      .add(tor(0.76, 0.08, 6, 20), 0xffd84a, 2.4, { r: [Math.PI / 3, 0.4, 0] })
      .add(tor(0.76, 0.08, 6, 20), 0xff5ce0, 2.1, { r: [-Math.PI / 3, -0.4, 0] })
      .build();
    const retC = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.28, 32), additive(0xffd84a, 0.9));
    retC.position.set(0, 0.12, 0.85);
    retC.visible = false;
    const podReactor = new THREE.Group();
    podReactor.add(new THREE.Mesh(reactorPodGeo, this.propMat), retC);
    podReactor.visible = false;
    this.scene.add(podL, podR, podReactor);
    this.bossShoulderPods = [podL, podR, podReactor];
    this.bossPodReticles = [retL, retR, retC];

    this.flashMat = additive(0xffffff, 0.95, this.glowTex);
    this.flashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.flashMat, MAX_RENDER_SQUAD);
    this.flashes.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_RENDER_SQUAD * 3),
      3,
    );
    this.flashes.count = 0;
    this.flashes.frustumCulled = false;
    this.flashes.renderOrder = 3;
    this.scene.add(this.flashes);
  }

  private buildEnemyShell(): void {
    const barGeo = new THREE.PlaneGeometry(1, 0.2);
    const fgGeo = new THREE.PlaneGeometry(1, 0.15).translate(0.5, 0, 0);
    const barInfoArr = new Float32Array(192 * 4);
    const barInfoAttr = new THREE.InstancedBufferAttribute(barInfoArr, 4);
    barInfoAttr.setUsage(THREE.DynamicDrawUsage);
    fgGeo.setAttribute('aBarInfo', barInfoAttr);

    this.hpBg = new THREE.InstancedMesh(
      barGeo,
      new THREE.MeshBasicMaterial({
        color: 0x060a18,
        transparent: true,
        opacity: 0.86,
        depthTest: false,
        depthWrite: false,
      }),
      192,
    );
    const hpFgMat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      vertexShader: /* glsl */ `
        attribute vec4 aBarInfo;
        varying vec2 vUvBar;
        varying vec4 vBarInfo;
        void main() {
          vUvBar = uv;
          vBarInfo = aBarInfo;
          vec4 mvPosition = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
          #endif
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUvBar;
        varying vec4 vBarInfo;
        void main() {
          vec3 col = vBarInfo.rgb;
          float segs = max(1.0, vBarInfo.w);
          // Crisp ARPG-style HP tick dividers + glossy top bevel highlight
          float cell = fract(vUvBar.x * segs);
          float tick = segs > 1.5 ? smoothstep(0.0, 0.09, cell) * smoothstep(1.0, 0.91, cell) : 1.0;
          float topGloss = smoothstep(0.52, 0.95, vUvBar.y) * 0.28;
          vec3 finalCol = col * (0.72 + 0.28 * tick) + vec3(topGloss);
          gl_FragColor = vec4(finalCol, 0.96);
        }
      `,
    });
    this.hpFg = new THREE.InstancedMesh(fgGeo, hpFgMat, 192);
    this.hpFg.userData.barInfoAttr = barInfoAttr;
    this.hpFg.userData.barInfoArr = barInfoArr;
    this.hpBg.renderOrder = 12;
    this.hpFg.renderOrder = 13;
    this.hpBg.frustumCulled = this.hpFg.frustumCulled = false;
    this.hpBg.count = this.hpFg.count = 0;
    this.scene.add(this.hpBg, this.hpFg);

    const telGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.telegraphs = new THREE.InstancedMesh(telGeo, additive(0xffffff, 0.6, this.stripeTex), 24);
    this.telegraphs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24 * 3), 3);
    this.telegraphs.count = 0;
    this.telegraphs.frustumCulled = false;
    this.scene.add(this.telegraphs);

    const tGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Mesh(tGeo, additive(0xb85cff, 0.88));
      t.visible = false;
      this.tethers.push(t);
      this.scene.add(t);
    }

    // V20 Stage 5: Single-Draw-Call InstancedMesh batching for Phalanx shields, Howler war-auras, Juggernaut halos, Core Shards & Dynamic Weather!
    this.scene.add(this.riotShields.mesh);
    this.landingMarker = new THREE.Group();
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffce6b,
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    for (let i = 0; i < 4; i++) {
      const arc = new THREE.Mesh(new THREE.RingGeometry(2.45, 2.75, 14, 1, i * Math.PI / 2 + 0.16, 1.23), markerMaterial);
      arc.rotation.x = -Math.PI / 2;
      this.landingMarker.add(arc);
    }
    const innerBullseye = new THREE.Mesh(
      new THREE.RingGeometry(0.68, 1.08, 24).rotateX(-Math.PI / 2),
      additive(0x3ef3ff, 0.78),
    );
    innerBullseye.name = 'bullseye';
    innerBullseye.position.y = 0.02;
    const beaconPillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.72, 6.2, 16, 1, true).translate(0, 3.1, 0),
      additive(0x62f4ff, 0.34),
    );
    beaconPillar.name = 'beacon';
    this.landingMarker.add(innerBullseye, beaconPillar);
    this.landingMarker.visible = false;
    this.scene.add(this.landingMarker);

    const slamDomeGeo = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const slamCrownGeo = new THREE.CylinderGeometry(1.18, 0.65, 1, 20, 1, true).translate(0, 0.5, 0);
    const slamFissureGeo = new THREE.RingGeometry(0.35, 1.0, 24).rotateX(-Math.PI / 2);
    for (let s = 0; s < 3; s++) {
      const sGroup = new THREE.Group();
      const domeMat = new THREE.MeshBasicMaterial({
        color: 0x62f4ff,
        wireframe: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const dome = new THREE.Mesh(slamDomeGeo, domeMat);
      dome.userData.sharedGeo = true;
      const crownMat = additive(0xffd84a, 0);
      const crown = new THREE.Mesh(slamCrownGeo, crownMat);
      crown.userData.sharedGeo = true;
      const fissureMat = additive(0xfff0a8, 0);
      const fissure = new THREE.Mesh(slamFissureGeo, fissureMat);
      fissure.userData.sharedGeo = true;
      fissure.position.y = 0.06;
      sGroup.add(dome, crown, fissure);
      sGroup.visible = false;
      this.scene.add(sGroup);
      this.jumpSlamPool.push({
        group: sGroup,
        dome,
        domeMat,
        crown,
        crownMat,
        fissure,
        fissureMat,
        timer: 0,
        dur: 0.52,
        crowd: false,
      });
    }

    const auraGeo = new THREE.RingGeometry(3.25, 3.85, 32).rotateX(-Math.PI / 2);
    this.auraInstMesh = new THREE.InstancedMesh(auraGeo, additive(0xff2a6d, 0.34), 24);
    this.auraInstMesh.count = 0;
    this.auraInstMesh.visible = false;
    this.auraInstMesh.frustumCulled = false;
    this.auraInstMesh.renderOrder = 2;
    this.scene.add(this.auraInstMesh);

    const jugGeo = new THREE.RingGeometry(1.18, 1.52, 28).rotateX(-Math.PI / 2);
    const jugMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.jugHaloInstMesh = new THREE.InstancedMesh(jugGeo, jugMat, 24);
    this.jugHaloInstMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24 * 3), 3);
    this.jugHaloInstMesh.count = 0;
    this.jugHaloInstMesh.visible = false;
    this.jugHaloInstMesh.frustumCulled = false;
    this.jugHaloInstMesh.renderOrder = 2;
    this.scene.add(this.jugHaloInstMesh);

    // 3D Magnetized Core Shard Drops (single InstancedMesh, 160 capacity, zero GC!)
    const shardGeo = new THREE.OctahedronGeometry(0.32, 0);
    const shardMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.shardDropInstMesh = new THREE.InstancedMesh(shardGeo, shardMat, 160);
    this.shardDropInstMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(160 * 3), 3);
    this.shardDropInstMesh.count = 0;
    this.shardDropInstMesh.visible = false;
    this.shardDropInstMesh.frustumCulled = false;
    this.shardDropInstMesh.renderOrder = 5;
    this.scene.add(this.shardDropInstMesh);

    // Sector Dynamic Weather Particles (solar_emp / prism_tide / cryo_blizzard — single InstancedMesh, 220 capacity!)
    const weatherGeo = new THREE.BoxGeometry(0.08, 0.08, 1.35);
    const weatherMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.weatherMesh = new THREE.InstancedMesh(weatherGeo, weatherMat, 220);
    this.weatherMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(220 * 3), 3);
    this.weatherMesh.count = 0;
    this.weatherMesh.visible = false;
    this.weatherMesh.frustumCulled = false;
    this.weatherMesh.renderOrder = 6;
    this.scene.add(this.weatherMesh);

    // V23 RGB 3-Band Chromatic Dispersion Refraction Ribbons (45° Reflectors, Golden Lenses, Wingman Mirrors — single InstancedMesh, 56 cap!)
    const ribbonGeo = new THREE.PlaneGeometry(0.52, 1.0).rotateX(-Math.PI / 2);
    this.ribbonDispersionMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          vUv = uv;
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #else
            vCol = vec3(0.45, 0.96, 1.0);
          #endif
          vec4 mv = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            mv = instanceMatrix * mv;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          float cx = vUv.x * 2.0 - 1.0;
          // RGB 3-Band Prismatic Spectral Dispersion across ribbon width
          float rBand = exp(-pow((cx + 0.34) * 2.25, 2.0));
          float gBand = exp(-pow(cx * 2.05, 2.0));
          float bBand = exp(-pow((cx - 0.34) * 2.25, 2.0));
          vec3 prismSpec = vec3(rBand * 1.28 + gBand * 0.52, gBand * 1.24 + bBand * 0.44, bBand * 1.36 + rBand * 0.32);
          float flow = 0.84 + 0.16 * sin(vUv.y * 22.0 - uTime * 16.0);
          float endFade = smoothstep(0.0, 0.10, vUv.y) * smoothstep(1.0, 0.86, vUv.y);
          vec3 col = mix(vCol, prismSpec, 0.68) * flow * 1.48;
          float alpha = max(max(rBand, gBand), bBand) * endFade * 0.92;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    this.refractRibbonMesh = new THREE.InstancedMesh(ribbonGeo, this.ribbonDispersionMat, 56);
    this.refractRibbonMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(56 * 3), 3);
    // V23 Screen-Space Anamorphic Lens Flare Streaks (single InstancedMesh, 32 cap!)
    const flareGeo = new THREE.PlaneGeometry(1.0, 1.0);
    const flareMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          vUv = uv * 2.0 - 1.0;
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #else
            vCol = vec3(0.5, 0.95, 1.0);
          #endif
          vec4 mv = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            mv = instanceMatrix * mv;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          float core = exp(-dot(vUv * vec2(2.6, 5.5), vUv * vec2(2.6, 5.5)));
          float hStreak = exp(-abs(vUv.y) * 15.0) * smoothstep(1.0, 0.0, abs(vUv.x));
          vec3 spec = mix(vCol, vec3(0.95, 0.98, 1.0), core * 0.65);
          spec.r += hStreak * 0.22 * smoothstep(0.0, 0.8, -vUv.x);
          spec.b += hStreak * 0.28 * smoothstep(0.0, 0.8, vUv.x);
          float a = clamp(core * 0.92 + hStreak * 0.68, 0.0, 1.0);
          if (a < 0.01) discard;
          gl_FragColor = vec4(spec * 1.45, a * 0.88);
        }
      `,
    });
    this.anamorphicFlareMesh = new THREE.InstancedMesh(flareGeo, flareMat, 32);
    this.anamorphicFlareMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(32 * 3), 3);
    this.anamorphicFlareMesh.count = 0;
    this.anamorphicFlareMesh.visible = false;
    this.anamorphicFlareMesh.frustumCulled = false;
    this.anamorphicFlareMesh.renderOrder = 8;
    this.scene.add(this.anamorphicFlareMesh);
    this.refractRibbonMesh.count = 0;
    this.refractRibbonMesh.visible = false;
    this.refractRibbonMesh.frustumCulled = false;
    this.refractRibbonMesh.renderOrder = 4;
    this.scene.add(this.refractRibbonMesh);

    // V21 Tactical Squad Formation Command Tethers (single InstancedMesh, 24 cap!)
    const fTetherGeo = new THREE.BoxGeometry(0.11, 0.08, 1.0);
    const fTetherMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.formationTetherMesh = new THREE.InstancedMesh(fTetherGeo, fTetherMat, 24);
    this.formationTetherMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24 * 3), 3);
    this.formationTetherMesh.count = 0;
    this.formationTetherMesh.visible = false;
    this.formationTetherMesh.frustumCulled = false;
    this.scene.add(this.formationTetherMesh);

    // V21 Core Reactor 3-Tier Awakening Orbiting Prism Halo + Sweeping EMP Wall
    this.reactorHaloGroup = new THREE.Group();
    this.reactorHaloGroup.visible = false;
    const prismCrystalGeo = new THREE.OctahedronGeometry(0.24, 0);
    for (let i = 0; i < 6; i++) {
      const pm = new THREE.Mesh(prismCrystalGeo, additive(i % 2 === 0 ? 0x62f4ff : 0xffdf58, 0.92));
      this.reactorPrisms.push(pm);
      this.reactorHaloGroup.add(pm);
    }
    const haloTrack = new THREE.Mesh(new THREE.RingGeometry(1.65, 1.78, 36).rotateX(-Math.PI / 2), additive(0x62f4ff, 0.42));
    haloTrack.position.y = 0.25;
    this.reactorHaloGroup.add(haloTrack);
    this.scene.add(this.reactorHaloGroup);

    this.reactorWallMat = additive(0x62f4ff, 0.85, this.stripeTex);
    this.reactorWallMesh = new THREE.Mesh(new THREE.BoxGeometry(TRACK_HALF_WIDTH * 2.05, 2.35, 0.65), this.reactorWallMat);
    this.reactorWallMesh.visible = false;
    this.scene.add(this.reactorWallMesh);

    // V21 Pantheon Stage-4 Simultaneous Co-Boss Root
    this.coBossGroup = new THREE.Group();
    this.coBossGroup.visible = false;
    this.coBossShield = this.makeShield(2.85);
    this.coBossShield.position.y = 2.45;
    this.coBossHalo = new THREE.Mesh(new THREE.RingGeometry(1.95, 2.42, 36).rotateX(-Math.PI / 2), additive(0xff3864, 0.68));
    this.coBossHalo.position.y = 0.07;
    const fallbackCoBoss = new THREE.Mesh(
      new GeoBuilder()
        .add(new THREE.OctahedronGeometry(1.35, 1), 0xff4b6e, 0.65, { p: [0, 2.35, 0], s: [1.15, 1.45, 1.0] })
        .add(tor(1.85, 0.11, 6, 28), 0xffd84a, 2.2, { p: [0, 2.35, 0], r: [0.5, 0, 0] })
        .build(),
      this.propMat,
    );
    fallbackCoBoss.name = 'fallbackCoBoss';
    this.coBossGroup.add(fallbackCoBoss, this.coBossShield, this.coBossHalo);
    this.scene.add(this.coBossGroup);

    // V21 360° Interactive 3D Holographic Codex Turntable Stage
    this.codexStageGroup = new THREE.Group();
    this.codexStageGroup.visible = false;
    const pedGeo = new GeoBuilder()
      .add(cyl(1.65, 1.88, 0.18, 32), 0x102342, 0.35, { p: [0, -0.09, 0] })
      .add(tor(1.72, 0.055, 6, 36), 0x3ef3ff, 2.6, { p: [0, 0.02, 0], r: [Math.PI / 2, 0, 0] })
      .add(tor(1.22, 0.035, 6, 32), 0xffd84a, 2.2, { p: [0, 0.04, 0], r: [Math.PI / 2, 0, 0] })
      .build();
    this.codexPedestal = new THREE.Mesh(pedGeo, this.propMat);
    const holoBeam = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.68, 2.6, 28, 1, true), additive(0x38d8ff, 0.14));
    holoBeam.position.y = 1.3;
    this.codexContentGroup = new THREE.Group();
    this.codexStageGroup.add(this.codexPedestal, holoBeam, this.codexContentGroup);
    this.scene.add(this.codexStageGroup);

    this.hemi.intensity = 1.02;

    // Boss Phase-3 Omega Ultimate Beam visual assembly
    this.omegaBeamGroup = new THREE.Group();
    this.omegaBeamGroup.visible = false;
    this.omegaBeamWarnMat = additive(0xff2a55, 0.52, this.stripeTex);
    this.omegaBeamWarn = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 36).rotateX(-Math.PI / 2), this.omegaBeamWarnMat);
    this.omegaBeamWarn.position.set(0, 0.075, 18);
    this.omegaBeamCoreMat = additive(0xffdf6e, 0.92);
    this.omegaBeamCore = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.25, 36, 16, 1, true).rotateX(Math.PI / 2), this.omegaBeamCoreMat);
    this.omegaBeamCore.position.set(0, 1.25, 18);
    this.omegaBeamGroup.add(this.omegaBeamWarn, this.omegaBeamCore);
    this.scene.add(this.omegaBeamGroup);
  }

  private buildProjectiles(): void {
    const boltGeo = buildBoltGeo();
    const mat = new THREE.MeshBasicMaterial({
      toneMapped: false,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.projMesh = new THREE.InstancedMesh(boltGeo, mat, MAX_PROJ);
    this.projMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PROJ * 3), 3);
    this.projMesh.count = 0;
    this.projMesh.frustumCulled = false;

    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.projCoreMesh = new THREE.InstancedMesh(boltGeo, coreMat, MAX_PROJ);
    this.projCoreMesh.count = 0;
    this.projCoreMesh.frustumCulled = false;
    this.projCoreMesh.renderOrder = 3;
    this.scene.add(this.projMesh, this.projCoreMesh);

    this.orbMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.38, 1),
      new THREE.MeshBasicMaterial({ color: 0xff3864, toneMapped: false }),
      64,
    );
    this.orbMesh.count = 0;
    this.orbMesh.frustumCulled = false;
    this.orbMarks = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      additive(0xff2a55, 0.72, this.glowTex),
      64,
    );
    this.orbMarks.count = 0;
    this.orbMarks.frustumCulled = false;
    this.scene.add(this.orbMesh, this.orbMarks);
  }

  private buildHazards(): void {
    const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const group = new THREE.Group();
      const fillMat = additive(0xff2040, 0.2);
      const fill = new THREE.Mesh(flat, fillMat);
      const stripe = this.stripeTex.clone();
      stripe.needsUpdate = true;
      stripe.repeat.set(2, 10);
      const progressMat = additive(0xff2040, 0.58, stripe);
      const progress = new THREE.Mesh(flat, progressMat);
      const columnMat = additive(0xff2958, 0.0);
      columnMat.side = THREE.FrontSide;
      const column = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), columnMat);
      const edgeMat = additive(0xff4060, 0.92);
      const edgeL = new THREE.Mesh(flat, edgeMat);
      const edgeR = new THREE.Mesh(flat, edgeMat);
      fill.position.y = 0.05;
      progress.position.y = 0.07;
      edgeL.position.y = edgeR.position.y = 0.08;
      group.add(fill, progress, column, edgeL, edgeR);
      group.visible = false;
      this.scene.add(group);
      this.hazardViews.push({
        group,
        fill,
        fillMat,
        progress,
        progressMat,
        column,
        columnMat,
        edgeL,
        edgeR,
      });
    }
  }

  private makeShield(r: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x62f4ff,
      wireframe: true,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      toneMapped: false,
    });
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat);
    m.visible = false;
    return m;
  }

  // ------------------------------------------------------------------ public API
  setSquadSkin(skin: SquadSkinId): void {
    this.squadSkin = skin;
  }

  setSector(sector: SectorId): void {
    this.sector = sector;
    const pal = SECTOR_META[sector].palette;
    let sky = this.skyTextures.get(sector);
    if (!sky) {
      sky = makeSkyTexture(pal.sky);
      this.skyTextures.set(sector, sky);
    }
    this.scene.background = sky;
    this.baseFogColor.set(pal.fog);
    this.scene.fog = new THREE.Fog(pal.fog, 68, 172);
    (this.trackMat.uniforms.uTrack!.value as THREE.Color).set(pal.track);
    (this.trackMat.uniforms.uGrid!.value as THREE.Color).set(pal.grid);
    (this.trackMat.uniforms.uEdge!.value as THREE.Color).set(pal.edge);
    (this.trackMat.uniforms.uFog!.value as THREE.Color).set(pal.fog);
    (this.groundMat.uniforms.uGrid!.value as THREE.Color).set(pal.grid);
    (this.groundMat.uniforms.uFog!.value as THREE.Color).set(pal.fog);
    (this.towerMat.uniforms.uFog!.value as THREE.Color).set(pal.fog);
    (this.towerMat.uniforms.uBase!.value as THREE.Color).set(pal.track).multiplyScalar(0.55);
    (this.towerMat.uniforms.uWinA!.value as THREE.Color).set(pal.grid);
    (this.towerMat.uniforms.uWinB!.value as THREE.Color).set(pal.edge);
    (this.groundMat.uniforms.uBase!.value as THREE.Color).set(pal.fog).multiplyScalar(0.28);
    this.hemi.color.set(pal.edge).lerp(new THREE.Color(0xffffff), 0.76);
    this.hemi.groundColor.set(pal.fog).multiplyScalar(0.8);
    this.railMat.color.set(pal.edge);
    this.postMat.color.set(pal.edge);
    this.towerCapMat.color.set(pal.grid);
    this.environmentDetail.setPalette(pal);
  }

  /** Cycles all four art palettes as endless stages advance without changing the underlying sector id. */
  setEndlessWave(wave: number): void {
    const paletteSector = (Math.max(0, Math.floor(wave) - 1) % 4 + 1) as SectorId;
    this.setSector(paletteSector);
    this.sector = 4;
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    const pr = this.renderer.getPixelRatio();
    this.renderer.setSize(this.width, this.height, false);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(this.width, this.height);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(Math.max(1, Math.floor(this.width / 2)), Math.max(1, Math.floor(this.height / 2)));
    }
    const aspect = this.width / this.height;
    this.camera.aspect = aspect;
    // Keep ~12.7 world units of horizontal track visible at the squad's depth across aspect ratios
    const halfTan = 0.435 / aspect;
    this.fov = THREE.MathUtils.clamp((2 * Math.atan(halfTan) * 180) / Math.PI, 40, 72);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.effects.setViewportScale(this.height * pr, this.fov);
  }

  /** Visible world width at the squad depth, for 1:1 drag→world mapping */
  visibleWidthAtPlayer(): number {
    return 2 * CAM_DIST_TO_PLAYER * Math.tan((this.fov * Math.PI) / 360) * this.camera.aspect;
  }

  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    this.tmpV.set(x, y, z).project(this.camera);
    return {
      x: (this.tmpV.x * 0.5 + 0.5) * this.width,
      y: (-this.tmpV.y * 0.5 + 0.5) * this.height,
      visible: this.tmpV.z < 1,
    };
  }

  setAccessibility(cfg: AccessibilityConfig): void {
    this.shakeScale = THREE.MathUtils.clamp(cfg.shakeScale ?? 1.0, 0, 1.5);
    setGateColorblindMode(cfg.colorblindMode ?? 'none');
  }

  setReplayCameraMode(mode: 'chase' | 'tactical_top' | 'action_closeup'): void {
    this.replayCameraMode = mode;
  }

  rotateCodexTurntable(deltaRad: number): void {
    this.codexYaw += deltaRad;
  }

  setCodexPreview(spec: { tab: string; itemId: string } | null): void {
    this.codexPreviewSpec = spec;
    if (!this.codexStageGroup) return;
    if (!spec) {
      this.codexStageGroup.visible = false;
      return;
    }
    this.codexStageGroup.visible = true;
    while (this.codexContentGroup.children.length > 0) {
      const ch = this.codexContentGroup.children[0]!;
      this.codexContentGroup.remove(ch);
      ch.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.isMesh) {
          if (m.geometry && !m.userData.sharedGeo) m.geometry.dispose();
          if (m.material && m.material !== this.propMat && m.material !== this.vaultToonMat && !Array.isArray(m.material)) {
            (m.material as THREE.Material).dispose();
          }
        }
      });
    }
    const id = spec.itemId;
    if (spec.tab === 'bestiary' && (id === 'warden_01' || id === 'hydra_02' || id === 'omega_zero')) {
      const lib = this.gltfLib;
      if (lib) {
        const tmpl = id === 'warden_01' ? lib.bosses.warden : id === 'hydra_02' ? lib.bosses.hydraA : lib.bosses.omega;
        const actor = spawnActor(tmpl, { rimColor: 0x62f4ff, rimStrength: 0.58, outlineWidth: 0.0055 });
        actor.play(id === 'omega_zero' ? 'Idle' : 'Fast_Flying', { timeScale: 0.9 });
        actor.root.scale.setScalar(0.54);
        actor.root.traverse((o) => { o.userData.sharedGeo = true; });
        this.codexContentGroup.add(actor.root);
      } else {
        const bossSculpt = new THREE.Mesh(
          new GeoBuilder()
            .add(new THREE.OctahedronGeometry(0.85, 1), id === 'warden_01' ? 0xff4b6e : id === 'hydra_02' ? 0xd96bff : 0xffd84a, 0.55, { p: [0, 1.05, 0], s: [1.1, 1.35, 0.95] })
            .build(),
          this.propMat,
        );
        this.codexContentGroup.add(bossSculpt);
      }
      // Highlight 3 destructible tactical weak-point pods on the 3D Boss anatomy!
      const podPositions: Array<[number, number, number, number]> = [
        [-0.95, 1.15, 0.25, 0xff3b5c],
        [0.95, 1.15, 0.25, 0x3ef3ff],
        [0, 1.72, 0.15, 0xffdf58],
      ];
      for (const [px, py, pz, hex] of podPositions) {
        const wp = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), additive(hex, 0.92));
        wp.position.set(px, py, pz);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.35, 20), additive(hex, 0.85));
        ring.position.set(px, py, pz + 0.08);
        this.codexContentGroup.add(wp, ring);
      }
    } else if (spec.tab === 'setpieces') {
      const spire = new THREE.Mesh(
        new GeoBuilder()
          .add(cyl(0.32, 0.48, 1.55, 6), 0x1f365c, 0.3, { p: [-0.65, 0.78, 0] })
          .add(new THREE.OctahedronGeometry(0.32, 0), 0xff4b78, 2.2, { p: [-0.65, 1.78, 0] })
          .add(box(0.85, 0.95, 0.08), 0x7dff6b, 2.1, { p: [0.68, 0.55, 0.15], r: [0, -0.65, 0] })
          .add(box(1.9, 0.08, 0.42), 0x3ef3ff, 2.0, { p: [0, 0.06, 0.55] })
          .build(),
        this.propMat,
      );
      const dome = this.makeShield(0.62);
      dome.position.set(-0.65, 1.72, 0);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 1.45), additive(0x7dff6b, 0.88));
      beam.position.set(0.05, 0.65, 0.08);
      beam.rotation.y = 0.72;
      this.codexContentGroup.add(spire, dome, beam);
    } else {
      const pairWeapons: [WeaponId, WeaponId] = id.includes('scatter')
        ? ['scatter', 'rail']
        : id.includes('plasma')
          ? ['plasma', 'cryo']
          : ['pulse', 'rail'];
      const g1 = buildRewardDisplayGeo(pairWeapons[0]);
      const g2 = buildRewardDisplayGeo(pairWeapons[1]);
      const m1 = new THREE.Mesh(g1, this.vaultToonMat);
      m1.position.set(-0.62, 0.98, 0);
      m1.scale.setScalar(0.95);
      const m2 = new THREE.Mesh(g2, this.vaultToonMat);
      m2.position.set(0.62, 0.98, 0);
      m2.scale.setScalar(0.95);
      const coreOrb = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 1), additive(0xffdf58, 0.92));
      coreOrb.position.set(0, 1.05, 0);
      const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.035, 8, 36), additive(0x62f4ff, 0.78));
      ringA.position.y = 1.02;
      ringA.rotation.x = 0.65;
      const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.035, 8, 36), additive(0xff66c4, 0.72));
      ringB.position.y = 1.02;
      ringB.rotation.x = -0.65;
      this.codexContentGroup.add(m1, m2, coreOrb, ringA, ringB);
    }
    if (spec.itemId === 'wingman_prism') {
      this.codexContentGroup.clear();
      const wmGeo = new GeoBuilder()
        .add(oct(0.44), 0x5ef6ff, 2.6, { p: [0, 1.05, 0] })
        .add(box(1.65, 0.08, 0.42), 0x26487a, 0.5, { p: [0, 1.05, 0.1] })
        .add(tor(0.68, 0.045, 6, 24).rotateX(Math.PI / 2), 0xffe26a, 2.4, { p: [0, 1.05, 0] })
        .build();
      const drone = new THREE.Mesh(wmGeo, this.propMat);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.72, 0.06), additive(0x62f4ff, 0.78));
      pane.position.set(0, 1.05, -0.75);
      pane.rotation.y = 0.62;
      this.codexContentGroup.add(drone, pane);
    }
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount * this.shakeScale);
  }

  /** Triggers multi-wave seismic camera + viewport oscillation (respects accessibility shakeScale) */
  triggerScreenQuake(durationSec = 2.65, strength = 1.0): void {
    const dur = Math.max(0.25, durationSec);
    if (this.nukeQuakeTimer <= 0 || strength >= this.nukeQuakeStrength) {
      this.nukeQuakeDur = dur;
      this.nukeQuakeTimer = dur;
      this.nukeQuakeStrength = Math.max(this.nukeQuakeStrength, strength);
    } else {
      this.nukeQuakeTimer = Math.max(this.nukeQuakeTimer, dur * 0.6);
    }
  }

  /** Returns synchronized viewport oscillation offsets (px, deg, overscan scale) for DOM/canvas seismic shake */
  getScreenShakeOffset(): Readonly<{ x: number; y: number; rotDeg: number; scale: number }> {
    return this.screenShakeOut;
  }

  /** Directional ballistic camera punch (pushes lens along Z + subtle roll snap) */
  kickCamera(punchZ: number, dirX = 0): void {
    this.camKickZ = Math.min(1.65, this.camKickZ + punchZ);
    this.camKickRoll = THREE.MathUtils.clamp(this.camKickRoll + dirX * 0.014, -0.045, 0.045);
  }

  /** Triggers radial edge chromatic dispersion shockwave on monumental impacts */
  triggerShockwave(strength = 0.65): void {
    this.shockwaveAmt = Math.min(1.2, Math.max(this.shockwaveAmt, strength));
    this.chromaAmt = Math.max(this.chromaAmt, strength * 0.0095);
    this.radialBlurAmt = Math.max(this.radialBlurAmt, strength * 0.18);
  }

  /** Triggers focused screen-space Chromatic Aberration + Radial Motion Blur around a 3D world event */
  triggerCinematicImpact(chroma: number, radialBlur: number, worldX = 0, worldZ = -6): void {
    const sc = this.shakeScale;
    this.chromaAmt = Math.min(0.022, Math.max(this.chromaAmt, chroma * sc));
    this.radialBlurAmt = Math.min(0.42, Math.max(this.radialBlurAmt, radialBlur * sc));
    this.tmpV.set(worldX, 1.2, worldZ).project(this.camera);
    this.impactCenter.set(
      THREE.MathUtils.clamp(this.tmpV.x * 0.5 + 0.5, 0.15, 0.85),
      THREE.MathUtils.clamp(this.tmpV.y * 0.5 + 0.5, 0.15, 0.85),
    );
  }

  /** Triggers a 1.15s cinematic Boss Phase-Break close-up camera push-in */
  triggerPhaseCamZoom(durationSec = 1.15): void {
    this.phaseCamDur = Math.max(0.4, durationSec);
    this.phaseCamTimer = this.phaseCamDur;
  }

  /** Triggers a 0.85s Core Reactor Tier-3 Awakening orbital push-in + holographic mandala + split-tone peak */
  triggerReactorAwakenCam(durationSec = 0.85): void {
    this.awakenCamDur = Math.max(0.45, durationSec);
    this.awakenCamTimer = this.awakenCamDur;
    this.splitToneAmt = 0.85;
    this.triggerCinematicImpact(0.014, 0.26, 0, PLAYER_Z - 1.5);
  }

  /** Triggers a 1.35s cinematic Boss Omega Execution close-up camera push-in + dramatic FOV focus */
  triggerExecutionCam(durationSec = 1.35): void {
    this.execCamDur = Math.max(0.6, durationSec);
    this.execCamTimer = this.execCamDur;
    this.triggerCinematicImpact(0.018, 0.36, 0, -15);
  }

  getFrameTimeHistory(): Float32Array {
    return this.frameTimesMs;
  }

  getPerfStats(): { drawCalls: number; triangles: number; geometries: number; textures: number; fps: number; instances: number } {
    const info = this.renderer.info;
    const extR = this.renderer as unknown as { _lastSceneCalls?: number; _lastSceneTriangles?: number };
    const inst =
      (this.projMesh?.count ?? 0) +
      (this.orbMesh?.count ?? 0) +
      this.riotShields.mesh.count +
      (this.auraInstMesh?.count ?? 0) +
      (this.jugHaloInstMesh?.count ?? 0) +
      (this.shardDropInstMesh?.count ?? 0) +
      (this.weatherMesh?.count ?? 0);
    return {
      drawCalls: extR._lastSceneCalls ?? info.render.calls,
      triangles: extR._lastSceneTriangles ?? info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      fps: Math.min(120, Math.round(1000 / Math.max(8.33, this.emaFrameMs))),
      instances: inst,
    };
  }

  dispose(): void {
    this.resetRun();
    this.effects.dispose();
    this.glowTex.dispose();
    this.hexTex.dispose();
    this.riotShields.dispose();
    const seenMats = new Set<THREE.Material>();
    for (const child of this.landingMarker.children) {
      const m = child as THREE.Mesh;
      m.geometry.dispose();
      const mat = m.material as THREE.Material;
      if (mat && !seenMats.has(mat)) {
        seenMats.add(mat);
        mat.dispose();
      }
    }
    if (this.jumpSlamPool[0]) {
      this.jumpSlamPool[0].dome.geometry.dispose();
      this.jumpSlamPool[0].crown.geometry.dispose();
      this.jumpSlamPool[0].fissure.geometry.dispose();
    }
    for (const s of this.jumpSlamPool) {
      s.domeMat.dispose();
      s.crownMat.dispose();
      s.fissureMat.dispose();
    }
    this.stripeTex.dispose();
    this.lensTex.dispose();
    this.jumpTex.dispose();
    this.reflectorTex.dispose();
    this.bountyTex.dispose();
    this.phaseKinTex.dispose();
    this.phaseEngTex.dispose();
    this.composer?.dispose?.();
    this.renderer.dispose();
  }

  /** Stamps a persistent GPU-instanced battlefield decal onto the highway deck */
  spawnDecal(x: number, z: number, radius: number, colorHex: number, kind: 0 | 1 | 2 | 3 | 4 | 5 = 0, maxAge = 13.5): void {
    if (z < -125 || z > PLAYER_Z + 4) return;
    const d = this.decalPool[this.decalCursor]!;
    this.decalCursor = (this.decalCursor + 1) % MAX_DECALS;
    d.active = true;
    d.x = THREE.MathUtils.clamp(x, -TRACK_HALF_WIDTH + 0.45, TRACK_HALF_WIDTH - 0.45);
    d.z = z;
    d.radius = radius;
    d.rot = Math.random() * Math.PI * 2;
    d.age = 0;
    d.maxAge = maxAge;
    d.kind = kind;
    this.tmpColor.setHex(colorHex);
    d.r = this.tmpColor.r;
    d.g = this.tmpColor.g;
    d.b = this.tmpColor.b;
  }

  flashMuzzle(): void {
    this.muzzleFlash = 1;
  }

  private releaseSquadSlot(slot: SquadSlotState): void {
    if (slot.actor) {
      slot.actor.root.visible = false;
      this.squadPools[slot.tier - 1]!.push(slot.actor);
      slot.actor = null;
    }
    slot.alive = false;
    slot.s = 0;
  }

  resetRun(): void {
    this.effects.clear();
    this.bossDeathT = -1;
    this.bossHidden = false;
    this.trauma = 0;
    this.camKickZ = 0;
    this.camKickRoll = 0;

    for (const slot of this.squadSlots) {
      this.releaseSquadSlot(slot);
    }
    this.activeEnemies.clear();
    this.dyingEnemies.length = 0;
    for (const list of Object.values(this.enemyBatches)) {
      if (!list) continue;
      for (const b of list) {
        b.count = 0;
        b.outlineCount = 0;
        b.body.count = 0;
        b.outline.count = 0;
        b.body.visible = false;
        b.outline.visible = false;
      }
    }

    for (const view of this.bossViews.values()) {
      view.root.visible = false;
      if (view.secondaryRoot) view.secondaryRoot.visible = false;
      view.pylons?.forEach((p) => (p.visible = false));
      view.beams?.forEach((p) => (p.visible = false));
      view.attackCooldown = 0;
    }

    for (const v of this.gateViews.values()) this.releaseGate(v);
    this.gateViews.clear();
    for (const v of this.vaultViews.values()) this.releaseVault(v);
    this.vaultViews.clear();
    for (const v of this.barrelViews.values()) this.releaseBarrel(v);
    this.barrelViews.clear();
    for (const v of this.lensViews.values()) this.releaseLens(v);
    this.lensViews.clear();
    for (const v of this.singularityViews.values()) { v.group.visible = false; this.singularityPool.push(v); }
    this.singularityViews.clear();
    for (const v of this.jumpPadViews.values()) { v.group.visible = false; this.jumpPadPool.push(v); }
    this.jumpPadViews.clear();
    for (const v of this.reflectorViews.values()) { v.group.visible = false; this.reflectorPool.push(v); }
    this.reflectorViews.clear();
    for (const v of this.contractViews.values()) { v.group.visible = false; this.contractPool.push(v); }
    this.contractViews.clear();
    for (const v of this.doomOrbViews.values()) { v.group.visible = false; v.key = ''; this.doomOrbPool.push(v); }
    this.doomOrbViews.clear();
    for (const v of this.skyCargoViews.values()) { v.group.visible = false; this.skyCargoPool.push(v); }
    this.skyCargoViews.clear();
    for (const v of this.maglevViews.values()) { v.group.visible = false; this.maglevPool.push(v); }
    this.maglevViews.clear();
    for (const v of this.magRailViews.values()) { v.group.visible = false; this.magRailPool.push(v); }
    this.magRailViews.clear();
    for (const v of this.capTowerViews.values()) { v.group.visible = false; this.capTowerPool.push(v); }
    this.capTowerViews.clear();
    for (const v of this.phaseGateViews.values()) { v.group.visible = false; this.phaseGatePool.push(v); }
    this.phaseGateViews.clear();
    if (this.omegaBeamGroup) this.omegaBeamGroup.visible = false;
    this.riotShields.reset();
    this.landingMarker.visible = false;
    for (const s of this.jumpSlamPool) {
      s.timer = 0;
      s.group.visible = false;
    }
    if (this.auraInstMesh) { this.auraInstMesh.count = 0; this.auraInstMesh.visible = false; }
    if (this.jugHaloInstMesh) { this.jugHaloInstMesh.count = 0; this.jugHaloInstMesh.visible = false; }
    if (this.shardDropInstMesh) { this.shardDropInstMesh.count = 0; this.shardDropInstMesh.visible = false; }
    if (this.weatherMesh) { this.weatherMesh.count = 0; this.weatherMesh.visible = false; }
    if (this.refractRibbonMesh) { this.refractRibbonMesh.count = 0; this.refractRibbonMesh.visible = false; }
    if (this.formationTetherMesh) { this.formationTetherMesh.count = 0; this.formationTetherMesh.visible = false; }
    if (this.reactorHaloGroup) this.reactorHaloGroup.visible = false;
    if (this.reactorWallMesh) this.reactorWallMesh.visible = false;
    if (this.coBossGroup) this.coBossGroup.visible = false;
    for (const v of this.collapseRiftViews.values()) { v.group.visible = false; this.collapseRiftPool.push(v); }
    this.collapseRiftViews.clear();
    for (const v of this.highSpireViews.values()) { v.group.visible = false; this.highSpirePool.push(v); }
    this.highSpireViews.clear();
    for (const v of this.tacticalEventViews.values()) { v.group.visible = false; this.tacticalEventPool.push(v); }
    this.tacticalEventViews.clear();
    for (let i = 0; i < this.decalPool.length; i++) this.decalPool[i]!.active = false;
    if (this.decals) { this.decals.count = 0; this.decals.visible = false; }
    this.lastScrollVal = 0;
    this.shockwaveAmt = 0;
    this.chromaAmt = 0;
    this.radialBlurAmt = 0;
    this.nukeQuakeTimer = 0;
    this.nukeQuakeStrength = 0;
    this.nukeWaveTimer = 0;
    this.nukeHeatAmt = 0;
    this.nukeFlareAmt = 0;
    this.nukeDescentTremor = 0;
    this.nukeBlastWasActive = false;
    for (const s of this.nukeDropPool) s.group.visible = false;
    for (const b of this.nukeBlastPool) b.group.visible = false;
    this.screenShakeOut.x = 0;
    this.screenShakeOut.y = 0;
    this.screenShakeOut.rotDeg = 0;
    this.screenShakeOut.scale = 1;
    if (this.hemi) this.hemi.intensity = 1.02;
    if (this.dirLight) this.dirLight.intensity = 1.45;
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(this.baseFogColor);
    this.phaseCamTimer = 0;
    this.execCamTimer = 0;
    this.awakenCamTimer = 0;
    this.splitToneAmt = 0;
    if (this.wingmanLeftGroup) this.wingmanLeftGroup.visible = false;
    if (this.wingmanRightGroup) this.wingmanRightGroup.visible = false;
    if (this.reactorMandalaGroup) this.reactorMandalaGroup.visible = false;
    if (this.bossApexGroup) this.bossApexGroup.visible = false;
    if (this.ghostGroup) this.ghostGroup.visible = false;
    if (this.anamorphicFlareMesh) { this.anamorphicFlareMesh.count = 0; this.anamorphicFlareMesh.visible = false; }
    if (this.triPrismLatticeMesh) { this.triPrismLatticeMesh.count = 0; this.triPrismLatticeMesh.visible = false; }
    if (this.nemesisGroup) this.nemesisGroup.visible = false;
    if (this.nirvanaBurstGroup) this.nirvanaBurstGroup.visible = false;
    this.photoModeState = null;
    if (this.bossShoulderPods) {
      for (const pod of this.bossShoulderPods) pod.visible = false;
    }
    this.mirrorTroopers.count = 0;
    this.mirrorGlow.visible = false;
    this.mirrorRing.visible = false;
  }

  beginBoss(): void {
    this.bossHidden = false;
    this.bossDeathT = -1;
    for (const view of this.bossViews.values()) {
      view.attackCooldown = 0;
      view.primary.resetAnimation();
      view.secondary?.resetAnimation();
    }
  }

  startBossDeath(x: number, z: number, color: number): void {
    this.bossDeathT = 0;
    this.bossHidden = false;
    for (const view of this.bossViews.values()) {
      if (view.root.visible) {
        view.primary.play('Death', { loop: false, fade: 0.08, timeScale: 0.85 });
        view.secondary?.play('Death', { loop: false, fade: 0.08, timeScale: 0.85 });
      }
    }
    const fx = this.effects;
    for (let i = 0; i < 7; i++) {
      fx.after(i * 0.16, () => {
        const ox = (Math.random() - 0.5) * 4;
        const oz = (Math.random() - 0.5) * 2;
        fx.burst(x + ox, 2 + Math.random() * 2, z + oz, i % 2 ? 0xffffff : color, 40, {
          speed: 9,
          size: 0.6,
          life: 0.7,
        });
        fx.ring(x + ox, z + oz, color, 3.5, 0.4);
        this.shake(0.25);
      });
    }
    fx.after(1.25, () => {
      this.bossHidden = true;
      fx.burst(x, 2.4, z, 0xffffff, 240, { speed: 22, size: 0.9, life: 1.3, up: 0.8, gravity: 6 });
      fx.burst(x, 2.4, z, color, 240, { speed: 15, size: 0.8, life: 1.6, up: 0.9, gravity: 4 });
      fx.ring(x, z, 0xffffff, 16, 0.9);
      fx.ring(x, z, color, 11, 1.2);
      this.shake(1);
    });
  }

  // ------------------------------------------------------------------ per-frame
  render(snap: SimSnapshot, dt: number, cinematic = false): void {
    // Adaptive 60fps Quality Scaler: smoothly scales decal cap & pixelRatio on sustained mobile load while keeping sRGB Bloom 100% intact!
    if (dt > 0.001 && dt < 0.095) {
      const frameMs = dt * 1000;
      this.frameTimesMs[this.frameTimeCursor] = frameMs;
      this.frameTimeCursor = (this.frameTimeCursor + 1) % this.frameTimesMs.length;
      this.emaFrameMs = this.emaFrameMs * 0.9 + frameMs * 0.1;
      if (this.emaFrameMs > 23.0) {
        this.slowFrameStreak += 1;
        this.fastFrameStreak = 0;
        if (this.slowFrameStreak >= 24 && this.qualityScale > 0.7) {
          this.qualityScale = 0.65;
          this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.15));
        }
      } else if (this.emaFrameMs < 14.5) {
        this.fastFrameStreak += 1;
        this.slowFrameStreak = 0;
        if (this.fastFrameStreak >= 48 && this.qualityScale < 0.95) {
          this.qualityScale = 1.0;
          this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        }
      }
    }
    this.time += dt;
    const t = this.time;
    const sectorCfg = SECTORS[snap.sector];
    const scroll = snap.endless?.distance ?? snap.runwayProgress * sectorCfg.runwayLength;
    this.trackMat.uniforms.uScroll!.value = scroll;
    this.trackMat.uniforms.uTime!.value = t;
    this.trackMat.uniforms.uOverdrive!.value = snap.overdriveTimer > 0 ? Math.min(1, snap.overdriveTimer * 2) : 0;
    this.trackMat.uniforms.uBoss!.value = this.bossBlend;
    this.groundMat.uniforms.uScroll!.value = scroll;
    this.towerMat.uniforms.uTime!.value = t;

    this.shadowCount = 0;
    this.updateEnvironment(scroll, t);
    this.updateSquad(snap, dt, t);
    this.updateEnemies(snap, dt, t);
    this.updateProjectiles(snap);
    this.updateGates(snap, dt, t);
    this.updateVaults(snap, t);
    this.updateBarrels(snap, t);
    this.updateLenses(snap, t);
    const deltaScroll = scroll >= this.lastScrollVal && scroll - this.lastScrollVal < 4.0 ? scroll - this.lastScrollVal : 0;
    this.lastScrollVal = scroll;
    this.updateCompetitionProps(snap, t, dt, deltaScroll);
    this.updateV20PropsAndWeather(snap, t);
    this.updateV21World(snap, dt, t);
    if (this.decalShaderMat) this.decalShaderMat.uniforms.uTime!.value = t;
    if (this.ribbonDispersionMat) this.ribbonDispersionMat.uniforms.uTime!.value = t;
    this.updateV22Visuals(snap, dt, t);
    this.updateV23Visuals(snap, dt, t);
    this.updateBoss(snap, dt, t);
    this.updateNukeVisuals(snap, dt, t);
    this.updateDecalsAndWetLights(snap, dt, deltaScroll);
    if (snap.inBlitzDrill) this.decals.visible = false;
    this.shadows.count = this.shadowCount;
    this.shadows.instanceMatrix.needsUpdate = true;

    this.effects.update(dt);
    this.updateCamera(snap, dt, cinematic);
    this.updateCodexStageAfterCamera(dt, t);

    if (this.impactPass) {
      const pf = this.photoModeState?.active
        ? this.photoModeState.filter === 'noir_gold'
          ? 1.0
          : this.photoModeState.filter === 'glitch_scan'
            ? 2.0
            : 0.0
        : 0.0;
      const nukeWaveProg = this.nukeWaveTimer > 0 ? 1 - this.nukeWaveTimer / Math.max(0.1, this.nukeWaveDur) : 0;
      this.impactPass.uniforms.uChroma!.value = snap.inBlitzDrill ? 0 : this.chromaAmt;
      this.impactPass.uniforms.uRadialBlur!.value = snap.inBlitzDrill ? 0 : this.radialBlurAmt;
      this.impactPass.uniforms.uSplitTone!.value = this.splitToneAmt;
      this.impactPass.uniforms.uPhotoFilter!.value = pf;
      this.impactPass.uniforms.uPhotoTime!.value = t;
      this.impactPass.uniforms.uNukeWave!.value = snap.inBlitzDrill ? 0 : nukeWaveProg;
      this.impactPass.uniforms.uNukeHeat!.value = snap.inBlitzDrill ? 0 : this.nukeHeatAmt;
      this.impactPass.uniforms.uNukeFlare!.value = snap.inBlitzDrill ? 0 : this.nukeFlareAmt;
      (this.impactPass.uniforms.uNukeTint!.value as THREE.Vector3).copy(this.nukeTintVec);
      (this.impactPass.uniforms.uCenter!.value as THREE.Vector2).copy(this.impactCenter);
    }
    if (this.composer) {
      if (this.bloomPass) {
        this.bloomPass.strength = snap.inBlitzDrill ? 0.16 : 0.32 + this.nukeHeatAmt * 0.76;
      }
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private updateEnvironment(scroll: number, time: number): void {
    const d = this.dummy;
    const span = 175;
    for (let i = 0; i < this.towerData.length; i++) {
      const tw = this.towerData[i]!;
      const z = -162 + ((((tw.z * 1.34 + scroll * 0.9) % span) + span) % span);
      d.position.set(tw.x, -0.6, z);
      d.rotation.set(0, 0, 0);
      d.scale.set(tw.w, tw.h, tw.d);
      d.updateMatrix();
      this.towers.setMatrixAt(i, d.matrix);
      d.position.set(tw.x, -0.6 + tw.h, z);
      d.scale.set(tw.w * 1.02, 1, tw.d * 1.02);
      d.updateMatrix();
      this.towerCaps.setMatrixAt(i, d.matrix);
    }
    this.towers.instanceMatrix.needsUpdate = true;
    this.towerCaps.instanceMatrix.needsUpdate = true;

    const step = 6;
    let k = 0;
    for (let i = 0; i < 32; i++) {
      const z = -176 + ((((i * step + scroll) % (32 * step)) + 32 * step) % (32 * step));
      for (const s of [-1, 1]) {
        d.position.set(s * (TRACK_HALF_WIDTH + 0.25), 0.35, z);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        this.posts.setMatrixAt(k++, d.matrix);
      }
    }
    this.posts.instanceMatrix.needsUpdate = true;
    this.environmentDetail.update(scroll, time);
    this.infrastructure.update(scroll);
  }

  private pushShadow(x: number, z: number, r: number): void {
    if (this.shadowCount >= MAX_SHADOWS) return;
    const d = this.dummy;
    d.position.set(x, 0.025, z);
    d.rotation.set(0, 0, 0);
    d.scale.set(r * 2.1, 1, r * 1.9);
    d.updateMatrix();
    this.shadows.setMatrixAt(this.shadowCount++, d.matrix);
  }

  /**
   * Selects up to MAX_RENDER_SQUAD breathable, non-overlapping visual slots so individual
   * Q-version troopers, golden captains, and assault mechs always have clear silhouette separation.
   */
  private computeVisualSquadTargets(
    snap: SimSnapshot,
  ): Array<{ x: number; z: number; tier: 1 | 2 | 3 }> {
    const sc = snap.squadCount;
    const { u3, totalVisible } = snap.tiers;
    if (sc <= 0 || totalVisible <= 0) return [];

    // Smooth visual hero promotion across real run squad sizes (without touching sim math):
    // - 14+ deploys Golden Heavy Captains (capped at 5 so Cobalt-Cyan Troopers stay dominant)
    // - 55+ deploys towering Stan Assault Mechs on heroic rear-flanks
    const n3 = Math.min(3, Math.max(u3, sc >= 150 ? 3 : sc >= 90 ? 2 : sc >= 48 ? 1 : 0));
    const n2 = sc >= 80 ? 7 : sc >= 50 ? 5 : sc >= 30 ? 4 : sc >= 18 ? 2 : sc >= 10 ? 1 : 0;
    const maxSlots = Math.max(1, MAX_RENDER_SQUAD - n3 * 2);
    const total = Math.min(maxSlots, Math.max(n3 + n2, totalVisible));
    const n1 = Math.max(0, total - n3 - n2);

    const out = this.visualSquadScratch;
    out.length = 0;
    const overdrive = snap.overdriveTimer > 0;
    const maxTrackX = TRACK_HALF_WIDTH - 0.58;

    // 1. Assault Mechs lead from the formation's far edge: the camera sits behind the squad, so anything
    //    nearer the camera covers the troopers beyond it, while a vanguard mech only has its legs overlapped.
    const infCount = n2 + n1;
    const spacing = infCount <= 8 ? 0.62 : infCount <= 18 ? 0.54 : 0.48;
    const front = -spacing * Math.sqrt(Math.max(0, infCount - 1) + 0.35) * 0.8 + 0.25;
    const mechOffsets: Array<[number, number]> =
      n3 === 1
        ? [[0, front - 0.55]]
        : n3 === 2
          ? [
              [-1.15, front - 0.35],
              [1.15, front - 0.35],
            ]
          : [
              [0, front - 0.7],
              [-1.5, front - 0.2],
              [1.5, front - 0.2],
            ];
    for (let m = 0; m < n3; m++) {
      const [ox, oz] = mechOffsets[m]!;
      out.push({
        x: THREE.MathUtils.clamp(snap.squadX + ox, -maxTrackX, maxTrackX),
        z: PLAYER_Z + oz,
        tier: 3,
      });
    }

    // 2. Golden Captains + Cobalt-Cyan Troopers arranged in breathable spiral / V-Wing chevron
    for (let k = 0; k < infCount; k++) {
      const tier: 1 | 2 = k < n2 ? 2 : 1;
      let ox = 0;
      let oz = 0;
      if (infCount > 1) {
        if (overdrive) {
          const rank = Math.ceil(k / 2);
          const side = k % 2 === 1 ? 1 : -1;
          ox = k === 0 ? 0 : side * rank * 0.44;
          oz = k === 0 ? -0.42 : rank * 0.25 - 0.28;
        } else {
          const r = spacing * Math.sqrt(k + 0.35);
          const theta = k * GOLDEN_ANGLE_RAD;
          ox = Math.cos(theta) * r;
          oz = Math.sin(theta) * r * 0.8 + (n3 > 0 ? 0.25 : 0);
        }
      } else if (n3 > 0) {
        oz = 0.3;
      }
      out.push({
        x: THREE.MathUtils.clamp(snap.squadX + ox, -maxTrackX, maxTrackX),
        z: PLAYER_Z + oz,
        tier,
      });
    }
    return out;
  }

  private updateSquad(snap: SimSnapshot, dt: number, t: number): void {
    const lib = this.gltfLib;
    const unlockedSecondary: WeaponId[] = [];
    if (snap.arsenal && snap.stats.vaultsCracked > 0) {
      for (const wId of ['pulse', 'scatter', 'rail', 'plasma', 'cryo'] as const) {
        if (wId !== snap.weapon && (snap.arsenal[wId] ?? 0) > 0) unlockedSecondary.push(wId);
      }
    }
    this.currentWeapon = snap.weapon;

    const targets = lib ? this.computeVisualSquadTargets(snap) : [];
    const follow = 1 - Math.exp(-Math.max(dt, 0.001) * 15);
    const overdrive = snap.overdriveTimer > 0;
    const wc = WEAPON_COLOR[snap.weapon];
    const camQuat = this.camera.quaternion;
    const d = this.dummy;
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 11);
    let flashes = 0;

    const isVictory = snap.phase === 'VICTORY';
    const isIdleReady = snap.simTime === 0 && snap.phase === 'PLAYING';

    for (let i = 0; i < MAX_RENDER_SQUAD; i++) {
      const slot = this.squadSlots[i]!;
      const target = targets[i];
      if (!target || !lib) {
        if (slot.alive) this.releaseSquadSlot(slot);
        continue;
      }

      // Swap pooled actor if tier upgraded/downgraded
      if (slot.actor && slot.tier !== target.tier) {
        slot.actor.root.visible = false;
        this.squadPools[slot.tier - 1]!.push(slot.actor);
        slot.actor = null;
      }

      if (!slot.actor) {
        const pool = this.squadPools[target.tier - 1]!;
        const acquired =
          pool.pop() ??
          spawnActor(lib.heroes[target.tier - 1]!, {
            rimColor: target.tier === 2 ? 0xffe484 : 0x9beeff,
            rimStrength: 0.42,
            outlineWidth: 0.0054,
            weapons: target.tier < 3 ? lib.weapons : undefined,
            initialWeapon: this.currentWeapon,
          });
        if (!acquired.root.parent) this.scene.add(acquired.root);
        const desiredW =
          unlockedSecondary.length > 0 && i >= 3 && i % 2 === 1
            ? unlockedSecondary[(i >> 1) % unlockedSecondary.length]!
            : snap.weapon;
        if (target.tier < 3) acquired.setWeapon(desiredW, lib.weapons);
        acquired.root.visible = true;
        slot.actor = acquired;
        slot.weaponShown = desiredW;
        slot.tier = target.tier;
        if (!slot.alive) {
          slot.alive = true;
          slot.x = snap.squadX;
          slot.z = PLAYER_Z + 0.5;
          slot.s = 0.05;
          slot.vx = 0;
        }
      }

      const px = slot.x;
      slot.x += (target.x - slot.x) * follow;
      slot.z += (target.z - slot.z) * follow;
      slot.vx += ((slot.x - px) / Math.max(dt, 1e-3) - slot.vx) * Math.min(1, dt * 10);
      slot.s += (1 - slot.s) * (1 - Math.exp(-Math.max(dt, 0.001) * 11));

      const actor = slot.actor;
      const isMech = slot.tier === 3;
      if (!isMech && lib) {
        const desiredW =
          unlockedSecondary.length > 0 && i >= 3 && i % 2 === 1
            ? unlockedSecondary[(i >> 1) % unlockedSecondary.length]!
            : snap.weapon;
        if (slot.weaponShown !== desiredW) {
          actor.setWeapon(desiredW, lib.weapons);
          slot.weaponShown = desiredW;
        }
      }

      if (isVictory) {
        // Turn toward the player & celebrate on Victory!
        actor.play(isMech ? 'Idle' : 'Wave', { timeScale: 1.1, startOffset: (i * 0.19) % 1.2 });
        actor.inner.rotation.y += (0 - actor.inner.rotation.y) * Math.min(1, dt * 6);
      } else if (isIdleReady) {
        actor.play(isMech ? 'Idle' : 'Idle_Shoot', { timeScale: 1.0, startOffset: (i * 0.13) % 0.35 });
        actor.inner.rotation.y = Math.PI;
      } else {
        const runClip = isMech ? 'Run' : 'Run_Shoot';
        const runSpeed = (isMech ? 1.15 : 1.28) * (overdrive ? 1.28 : 1);
        actor.play(runClip, { timeScale: runSpeed, startOffset: (i * 0.17) % 0.7 });
        actor.setTimeScale(runSpeed);
        actor.inner.rotation.y = Math.PI;
      }

      actor.update(dt);

      const airY = snap.squadAirY ?? 0;
      const fl = this.muzzleFlash * (0.55 + 0.45 * Math.sin(i * 7.3 + t * 37));
      const recoilZ = fl * 0.06;
      const heroBoost = isMech ? 1.08 : 1.18;
      const sc = slot.s * heroBoost * (overdrive ? 1.08 : 1);
      actor.root.position.set(slot.x, airY, slot.z + recoilZ);
      const yaw = THREE.MathUtils.clamp(-slot.vx * 0.028, -0.35, 0.35);
      const bank = THREE.MathUtils.clamp(-slot.vx * 0.014, -0.1, 0.1);
      actor.root.rotation.set(0, yaw, bank);
      actor.root.scale.setScalar(sc);

      const spawnFlash = Math.max(0, (1 - slot.s) * 0.8);
      const aegisOn = (snap.aegisTimer ?? 0) > 0;
      if (overdrive) {
        const od = 1.08 + Math.sin(t * 18 + i) * 0.08;
        actor.setVisuals(spawnFlash, od * 1.1, od * 1.04, od * 0.86);
        if (Math.random() < dt * 16) {
          this.effects.burst(slot.x, 0.38, slot.z + 0.25, 0xffe66d, 1, { speed: 2.2, size: 0.22, life: 0.22, up: -0.4, gravity: -3 });
        }
      } else if (aegisOn) {
        actor.setVisuals(spawnFlash, 0.92, 1.06, 1.14);
      } else {
        actor.setVisuals(spawnFlash, 1, 1, 1);
      }

      const shadowScale = Math.max(0.42, 1 - airY * 0.14);
      const shadowR = (isMech ? 0.68 : slot.tier === 2 ? 0.44 : 0.36) * shadowScale;
      this.pushShadow(slot.x, slot.z, shadowR * slot.s);
      if (airY > 0.35 && Math.random() < dt * 14) {
        this.effects.burst(slot.x, airY + 0.12, slot.z + 0.2, 0x3ef3ff, 1, { speed: 2.0, size: 0.2, life: 0.18, up: -0.6, gravity: 4 });
      }

      if (fl > 0.08 && !isVictory && !isIdleReady && flashes < MAX_RENDER_SQUAD) {
        const mx = slot.x + (isMech ? 0 : 0.16);
        const my = (isMech ? 1.45 : slot.tier === 2 ? 0.92 : 0.76) + airY;
        const mz = slot.z - (isMech ? 0.95 : 0.72);
        d.position.set(mx, my, mz);
        d.quaternion.copy(camQuat);
        const fs = (isMech ? 0.92 : 0.52) * (0.6 + fl * 0.55);
        d.scale.set(fs, fs, fs);
        d.updateMatrix();
        this.flashes.setMatrixAt(flashes, d.matrix);
        const slotWc = isMech ? wc : WEAPON_COLOR[slot.weaponShown];
        this.tmpColor.setHex(slotWc).multiplyScalar(0.68 + fl * 0.98);
        this.flashes.setColorAt(flashes, this.tmpColor);
        flashes++;
      }
    }

    this.flashes.count = flashes;
    this.flashes.instanceMatrix.needsUpdate = true;
    if (this.flashes.instanceColor) this.flashes.instanceColor.needsUpdate = true;
    d.rotation.set(0, 0, 0);

    const aegisActive = (snap.aegisTimer ?? 0) > 0;
    const skinEntry = SQUAD_SKINS.find((sk) => sk.id === this.squadSkin);
    let baseTrimHex = this.squadSkin !== 'cyan' && skinEntry ? skinEntry.hex : wc;
    if (this.squadSkin === 'abyss_violet') {
      this.tmpColor.setHex(0xc44dff).lerp(this.v22SkinColorB.setHex(0x4ef6ff), 0.5 + 0.5 * Math.sin(t * 4.2));
      baseTrimHex = this.tmpColor.getHex();
    } else if (this.squadSkin === 'solar_prism') {
      this.tmpColor.setHex(0xffe259).lerp(this.v22SkinColorB.setHex(0xff5e3a), 0.5 + 0.5 * Math.sin(t * 4.8));
      baseTrimHex = this.tmpColor.getHex();
    } else if (this.squadSkin === 'void_aurora') {
      this.tmpColor.setHex(0x2af598).lerp(this.v22SkinColorB.setHex(0x00c6ff), 0.5 + 0.5 * Math.sin(t * 3.8));
      baseTrimHex = this.tmpColor.getHex();
    }
    this.squadGlowMat.color.setHex(overdrive ? 0xffea75 : aegisActive ? 0x62f4ff : baseTrimHex);
    const gs = snap.formationRadius * 2.5 + 1.5 + (overdrive ? 0.8 : 0);
    this.squadGlow.scale.set(gs, gs, 1);
    this.squadGlow.position.set(snap.squadX, 0.03, PLAYER_Z - 0.05);
    this.squadGlow.visible = snap.squadCount > 0;
    this.squadGlowMat.opacity = 0.28 + (overdrive ? 0.24 : aegisActive ? 0.18 : 0);

    const ringScale = snap.formationRadius * 2.15 + 1.05 + Math.sin(t * 4) * 0.04;
    this.squadRing.scale.set(ringScale, ringScale, 1);
    this.squadRing.position.set(snap.squadX, 0.036, PLAYER_Z);
    this.squadRing.rotation.z = t * (overdrive ? 1.6 : 0.48);
    this.squadRing.visible = snap.squadCount > 0;
    this.squadRingMat.color.setHex(overdrive ? 0xffe46b : aegisActive ? 0x62f4ff : baseTrimHex);
    this.squadRingMat.opacity = 0.28 + (overdrive ? 0.22 : 0);

    // Update 3D Diegetic Holographic Tactical Ring around the squad
    const holoScale = ringScale * 1.28;
    this.holoRing.visible = snap.squadCount > 0;
    this.holoRing.position.set(snap.squadX, 0.052 + (snap.squadAirY ?? 0) * 0.85, PLAYER_Z);
    this.holoRing.scale.set(holoScale, holoScale, 1);
    this.holoRingMat.uniforms.uTime!.value = t;
    this.holoRingMat.uniforms.uResonance!.value = overdrive ? 1.0 : snap.resonance;
    const aegisProg = aegisActive ? 1.0 : 1.0 - THREE.MathUtils.clamp(snap.aegisCooldown / Math.max(1, snap.aegisMaxCooldown), 0, 1);
    this.holoRingMat.uniforms.uAegis!.value = aegisProg;
    this.holoRingMat.uniforms.uNuke!.value = THREE.MathUtils.clamp(snap.nukeCharge ?? 0, 0, 1);
    this.holoRingMat.uniforms.uStreams!.value = Math.min(20, Math.max(4, Math.round(snap.squadCount * 0.35 + snap.weaponLevel * 2)));
    (this.holoRingMat.uniforms.uColor!.value as THREE.Color).setHex(overdrive ? 0xffe46b : baseTrimHex);

    const squadAir = snap.squadAirY ?? 0;
    if (aegisActive && snap.squadCount > 0) {
      this.aegisGroup.visible = true;
      const domeR = snap.formationRadius + 1.35;
      this.aegisGroup.position.set(snap.squadX, 0.15 + squadAir, PLAYER_Z);
      this.aegisGroup.scale.set(domeR, Math.max(1.85, domeR * 0.92), domeR);
      this.aegisWire.rotation.y = t * 1.8;
      this.aegisWire.rotation.z = Math.sin(t * 2.5) * 0.2;
      const fade = Math.min(1, (snap.aegisTimer ?? 0) * 3.5);
      this.aegisWireMat.opacity = (0.52 + Math.sin(t * 18) * 0.14) * fade;
      this.aegisShellMat.opacity = (0.14 + Math.sin(t * 12) * 0.04) * fade;
    } else {
      this.aegisGroup.visible = false;
    }

    // Mirror-Twin Holographic Platoon rendering
    if (snap.mirrorTwinActive && snap.squadCount > 0 && Math.abs(snap.squadX) > 0.32) {
      const twinX = -snap.squadX;
      this.mirrorGlow.visible = true;
      this.mirrorGlow.position.set(twinX, 0.03, PLAYER_Z - 0.05);
      this.mirrorGlow.scale.set(gs * 0.88, gs * 0.88, 1);
      this.mirrorRing.visible = true;
      this.mirrorRing.position.set(twinX, 0.038, PLAYER_Z);
      this.mirrorRing.scale.set(ringScale * 0.88, ringScale * 0.88, 1);
      this.mirrorRing.rotation.z = -t * 1.1;
      const mCount = Math.min(18, targets.length);
      this.mirrorTroopers.count = mCount;
      for (let i = 0; i < mCount; i++) {
        const tg = targets[i]!;
        const mx = THREE.MathUtils.clamp(-tg.x, -TRACK_HALF_WIDTH + 0.55, TRACK_HALF_WIDTH - 0.55);
        const bob = Math.abs(Math.sin(t * 11 + i * 0.9)) * 0.09;
        d.position.set(mx, squadAir + bob, tg.z);
        d.rotation.set(0, Math.PI, Math.sin(t * 6 + i) * 0.06);
        const ms = tg.tier === 3 ? 1.45 : tg.tier === 2 ? 1.12 : 0.96;
        d.scale.setScalar(ms);
        d.updateMatrix();
        this.mirrorTroopers.setMatrixAt(i, d.matrix);
      }
      this.mirrorTroopers.instanceMatrix.needsUpdate = true;
    } else {
      this.mirrorTroopers.count = 0;
      this.mirrorGlow.visible = false;
      this.mirrorRing.visible = false;
    }

    // Seeker Sword-Array autonomous hunting drones OR standard Orbital Blades
    const seekers = snap.seekerPositions ?? [];
    if (seekers.length > 0) {
      const scnt = Math.min(8, seekers.length);
      this.blades.count = scnt;
      for (let i = 0; i < scnt; i++) {
        const sp = seekers[i]!;
        d.position.set(sp.x, 0.88 + (sp.hunting ? 0.18 * Math.sin(t * 12 + i) : squadAir), sp.z);
        d.rotation.set(0.32, t * 24 + i * 1.5, 0.15 * Math.sin(t * 10 + i));
        const bScale = sp.hunting ? 1.92 : 1.62;
        d.scale.set(bScale, bScale, bScale);
        d.updateMatrix();
        this.blades.setMatrixAt(i, d.matrix);
        if (sp.hunting && Math.random() < dt * 22) {
          this.effects.burst(sp.x, 0.88, sp.z + 0.25, 0x3ef3ff, 1, { speed: 2.2, size: 0.22, life: 0.18, gravity: 0 });
        }
      }
      this.blades.instanceMatrix.needsUpdate = true;
    } else {
      const nb = Math.min(8, snap.bladesCount);
      this.blades.count = nb;
      for (let i = 0; i < nb; i++) {
        const a = snap.bladesAngle + (i / nb) * Math.PI * 2;
        d.position.set(
          snap.squadX + Math.cos(a) * BLADES_ORBIT_RADIUS,
          0.65 + squadAir,
          PLAYER_Z + Math.sin(a) * BLADES_ORBIT_RADIUS * 0.85,
        );
        d.rotation.set(0.25, -a * 3 + t * 14, 0);
        d.scale.set(1.55, 1.55, 1.55);
        d.updateMatrix();
        this.blades.setMatrixAt(i, d.matrix);
      }
      this.blades.instanceMatrix.needsUpdate = true;
    }
  }

  private sortedEnemiesScratch: SimSnapshot['enemies'][number][] = [];

  private pushEnemyInstance(
    kind: EnemyKind,
    poseIdx: number,
    matrix: THREE.Matrix4,
    hitFlash: number,
    frost: number,
    tintMode: number,
    withOutline: boolean,
    subVariant = 0,
  ): void {
    const list = this.enemyBatches[kind];
    if (!list) return;
    const batch = list[poseIdx] ?? list[0];
    if (!batch || batch.count >= batch.cap) return;
    const idx = batch.count++;
    if (withOutline) batch.outlineCount = idx + 1;
    batch.body.setMatrixAt(idx, matrix);
    const i4 = idx * 4;
    batch.fxArray[i4] = hitFlash;
    batch.fxArray[i4 + 1] = frost;
    batch.fxArray[i4 + 2] = tintMode;
    batch.fxArray[i4 + 3] = subVariant;
  }

  breakRiotShield(id: number, x: number, z: number): void {
    const actor = this.activeEnemies.get(id);
    this.riotShields.shatter(x, z, actor?.scale ?? ENEMY_VISUAL_SCALE.phalanx);
    if (actor) { actor.recoilZ = 0.48; actor.recoilTilt = -0.32; actor.recoilRoll = 0.14; }
  }

  private updateEnemies(snap: SimSnapshot, dt: number, t: number): void {
    this.frameTick = (this.frameTick + 1) & 0xffff;
    const lib = this.gltfLib;
    const d = this.dummy;
    const camQuat = this.camera.quaternion;
    let bars = 0;
    let tels = 0;
    let tetherIdx = 0;
    let shieldIdx = 0;
    let auraIdx = 0;
    let jugIdx = 0;

    for (const list of Object.values(this.enemyBatches)) {
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        list[i]!.count = 0;
        list[i]!.outlineCount = 0;
      }
    }

    for (const entry of this.activeEnemies.values()) entry.seen = false;
    const springDecay = Math.exp(-Math.max(dt, 0.001) * 18);

    if (lib) {
      // Sort front-to-back so near/mid enemies (z > -46) occupy indices [0..outlineCount-1] with crisp cartoon outlines,
      // while distant horizon columns (z <= -46) skip sub-pixel outline triangles (-45% GPU vertex load, cleaner horizon!)
      const ordered = this.sortedEnemiesScratch;
      ordered.length = snap.enemies.length;
      for (let i = 0; i < snap.enemies.length; i++) ordered[i] = snap.enemies[i]!;
      ordered.sort((a, b) => b.z - a.z);

      for (let idx = 0; idx < ordered.length; idx++) {
        const e = ordered[idx]!;
        let entry = this.activeEnemies.get(e.id);
        if (!entry) {
          entry = {
            kind: e.kind,
            x: e.x,
            z: e.z,
            scale: 1,
            animTime: (e.id * 0.29) % 1.0,
            recoilZ: 0,
            recoilX: 0,
            recoilTilt: 0,
            recoilRoll: 0,
            prevHit: 0,
            seen: true,
          };
          this.activeEnemies.set(e.id, entry);
        }
        entry.seen = true;
        entry.x = e.x;
        entry.z = e.z;

        const tmpl = lib.enemies[e.kind];
        const radRatio = Math.max(0.86, e.radius / tmpl.refRadius);
        const depthPresence = 1 + THREE.MathUtils.clamp((-e.z - 8) / 90, 0, 0.22);
        // Gentle near-lens framing taper when a giant steps right up to/past PLAYER_Z so it never blocks half the viewport
        const nearTaper = e.z > PLAYER_Z - 4.2 ? THREE.MathUtils.clamp(1 - (e.z - (PLAYER_Z - 4.2)) * 0.052, 0.68, 1) : 1;
        const sc = radRatio * ENEMY_VISUAL_SCALE[e.kind] * depthPresence * nearTaper;
        entry.scale = sc;

        const hit = e.hitPulse;
        const slowed = e.slowTimer > 0;
        const tele = (e.kind === 'dasher' || e.kind === 'beholder') && e.telegraphTimer > 0;
        const speedMod = (slowed ? 0.45 : 1) * (e.frenzyBuffed ? 1.24 : 1);

        let cycleRate = 1.65;
        let useActionPose = false;
        switch (e.kind) {
          case 'crawler':
            cycleRate = 1.95;
            useActionPose = e.z > PLAYER_Z - 3.8;
            break;
          case 'dasher':
            cycleRate = e.z > -34 ? 2.75 : 1.75;
            useActionPose = tele;
            break;
          case 'bastion':
            cycleRate = 1.25;
            useActionPose = e.z > PLAYER_Z - 5.2;
            break;
          case 'mitosis':
            cycleRate = 1.55;
            break;
          case 'siphon':
            cycleRate = 1.45;
            useActionPose = e.linkedGateId !== null;
            break;
          case 'bomber':
            cycleRate = 2.05;
            useActionPose = e.z > PLAYER_Z - 9.0 || e.hp < e.maxHp * 0.55;
            break;
          case 'phalanx':
            cycleRate = 1.32;
            useActionPose = e.z > PLAYER_Z - 4.8;
            break;
          case 'stalker':
            cycleRate = 1.95;
            useActionPose = e.z > PLAYER_Z - 5.2;
            break;
          case 'brood':
            cycleRate = 1.38;
            useActionPose = Math.sin(t * 2.2 + e.id) > 0.62;
            break;
          case 'howler':
            cycleRate = 1.42;
            useActionPose = Math.sin(t * 2.6 + e.id * 0.7) > 0.35;
            break;
          case 'glacier':
            cycleRate = 1.18;
            useActionPose = e.z > PLAYER_Z - 5.4;
            break;
          case 'beholder':
            cycleRate = 1.52;
            useActionPose = tele || Math.sin(t * 2.4 + e.id) > 0.55;
            break;
          case 'burrower':
            cycleRate = e.z > -28 ? 2.65 : 1.85;
            useActionPose = e.z > -28;
            break;
          case 'necromancer':
            cycleRate = 1.36;
            useActionPose = Math.sin(t * 2.5 + e.id * 0.9) > 0.42;
            break;
        }
        entry.animTime = (entry.animTime + dt * cycleRate * speedMod) % 1.0;
        const poseIdx = useActionPose ? 6 : Math.min(5, Math.floor(entry.animTime * 6));

        const tier = e.tier ?? ENEMY_CONFIGS[e.kind].tier;
        if (hit > entry.prevHit + 0.04 || hit > 0.92) {
          // Authentic 4-Tier Poise ("霸体韧性"): Tier 4 Juggernauts barely flinch; Tier 1 minions stagger back!
          const knock = tier === 4 ? 0.045 : tier === 3 ? 0.11 : tier === 2 ? 0.21 : 0.34;
          const tiltAmt = tier === 4 ? 0.06 : tier === 3 ? 0.14 : tier === 2 ? 0.24 : 0.34;
          const sideSign = ((e.id * 7 + this.frameTick) % 2 === 0 ? 1 : -1);
          entry.recoilZ = Math.min(tier === 4 ? 0.14 : 0.54, entry.recoilZ + knock);
          entry.recoilX = THREE.MathUtils.clamp(entry.recoilX + sideSign * knock * 0.32, -0.22, 0.22);
          entry.recoilTilt = Math.max(-0.46, entry.recoilTilt - tiltAmt);
          entry.recoilRoll = THREE.MathUtils.clamp(entry.recoilRoll + sideSign * tiltAmt * 0.7, -0.3, 0.3);
        }
        entry.prevHit = hit;
        entry.recoilZ *= springDecay;
        entry.recoilX *= springDecay;
        entry.recoilTilt *= springDecay;
        entry.recoilRoll *= springDecay;

        const yaw = THREE.MathUtils.clamp(Math.atan2(snap.squadX - e.x, PLAYER_Z - e.z), -0.62, 0.62);
        const jitter = tele ? Math.sin(t * 60 + e.id) * 0.04 : hit > 0.45 ? Math.sin(t * 88 + e.id) * 0.045 : 0;
        const strideBob = useActionPose ? 0 : Math.abs(Math.sin(entry.animTime * Math.PI * 2)) * 0.055 * sc;
        d.position.set(e.x + entry.recoilX + jitter, strideBob + entry.recoilZ * 0.3, e.z - entry.recoilZ);
        d.rotation.set(entry.recoilTilt, yaw, entry.recoilRoll);

        // Rhythmic elastic impact snap (oscillates crisply under sustained rapid fire instead of locking into a wide pancake!)
        const snapPulse = hit > 0.25 ? Math.max(0, Math.sin(t * 46 + e.id * 1.7)) * hit : hit;
        const squashXZ = sc * (1 + snapPulse * 0.11);
        const squashY = sc * (1 - snapPulse * 0.08);
        d.scale.set(squashXZ, squashY, squashXZ);
        d.updateMatrix();

        const bomberPulse =
          e.kind === 'bomber' && e.z > PLAYER_Z - 11 ? Math.max(0, Math.sin(t * 24 + e.id)) * 0.32 : 0;
        const hitFlash = snapPulse * 0.78 + bomberPulse;
        const frost = slowed ? (e.isBountyElite ? 0.5 : 0.78) : 0;
        const tintMode = e.isBountyElite ? 2 : e.armorBroken ? 4 : e.frenzyBuffed ? 1 : 0;
        const subVariant = e.kind === 'crawler' ? e.id % 4 : 0;
        this.pushEnemyInstance(
          e.kind,
          poseIdx,
          d.matrix,
          e.isBountyElite ? hitFlash + 0.16 + 0.08 * Math.sin(t * 9) : e.frenzyBuffed ? hitFlash + 0.08 : hitFlash,
          frost,
          tintMode,
          e.z > -46,
          subVariant,
        );

        if (e.isBountyElite && Math.random() < dt * 8) {
          this.effects.burst(e.x, 1.4, e.z, 0xffd84a, 1, { speed: 2.5, size: 0.24, life: 0.25, up: 1.0 });
        }

        if (e.z > -108) {
          this.pushShadow(e.x, e.z, e.radius * ENEMY_VISUAL_SCALE[e.kind] * (e.kind === 'siphon' ? 0.82 : 1.15));
        }

        // Tier-4 Juggernaut glowing ground command ring (batched into 1 InstancedMesh draw call)
        if (tier === 4 && e.z > -78 && jugIdx < 24) {
          const ringScale = e.radius * 1.45 * (0.95 + 0.07 * Math.sin(t * 5.5 + e.id));
          d.position.set(e.x, 0.048, e.z);
          d.rotation.set(0, 0, 0);
          d.scale.setScalar(ringScale);
          d.updateMatrix();
          this.jugHaloInstMesh.setMatrixAt(jugIdx, d.matrix);
          this.tmpColor.setHex(e.kind === 'glacier' ? 0x5ceeff : e.kind === 'brood' ? 0xff9f1c : 0xff3b5c);
          this.jugHaloInstMesh.setColorAt(jugIdx, this.tmpColor);
          jugIdx++;
        }

        // Color-coded 4-Tier Overhead Health Bars:
        //  - Tier 4 Juggernaut: wide Gold-Crimson bar shown proactively from z > -66!
        //  - Tier 3 Elite: Neon-Violet bar when damaged (or within z > -38)
        //  - Tier 2 Raider: Amber-Orange bar when damaged
        //  - Tier 1 Minion: Compact Coral-Red bar when wounded in close/mid range (z > -44)
        const showBar =
          e.isBountyElite ||
          (tier === 4 && e.z > -66) ||
          (tier === 3 && (e.hp < e.maxHp || e.z > -34) && e.z > -68) ||
          (tier === 2 && e.hp < e.maxHp && e.z > -60) ||
          (tier === 1 && e.hp < e.maxHp && e.z > -44);

        if (showBar && bars < 192) {
          const w =
            tier === 4
              ? Math.max(1.9, e.radius * 2.4)
              : tier === 3
                ? Math.max(1.38, e.radius * 2.1)
                : tier === 2
                  ? Math.max(1.06, e.radius * 1.85)
                  : 0.8;
          const barThick = tier === 4 ? 1.65 : tier === 3 ? 1.32 : tier === 2 ? 1.1 : 0.88;
          const y = ENEMY_BAR_H[e.kind] * sc + (tier === 4 ? 0.3 : 0.18);
          d.position.set(e.x, y, e.z);
          d.quaternion.copy(camQuat);
          d.scale.set(w + 0.14, barThick, 1);
          d.updateMatrix();
          this.hpBg.setMatrixAt(bars, d.matrix);

          // Offset left edge along camera local X so rotated billboard aligns cleanly at every lane X!
          this.tmpA.set(-w * 0.5, 0, 0.02).applyQuaternion(camQuat);
          d.position.set(e.x + this.tmpA.x, y + this.tmpA.y, e.z + this.tmpA.z);
          const hpRatio = THREE.MathUtils.clamp(e.hp / Math.max(1, e.maxHp), 0.001, 1);
          d.scale.set(w * hpRatio, barThick, 1);
          d.updateMatrix();
          this.hpFg.setMatrixAt(bars, d.matrix);

          if (e.isBountyElite) {
            this.tmpColor.setHex(0xffe048);
          } else if (tier === 4) {
            this.tmpColor.setHex(0xff3355);
          } else if (tier === 3) {
            this.tmpColor.setHex(0xd966ff);
          } else if (tier === 2) {
            this.tmpColor.setHex(0xffa42b);
          } else {
            this.tmpColor.setHex(0x4ef5a8);
          }
          const infoArr = this.hpFg.userData.barInfoArr as Float32Array;
          const b4 = bars * 4;
          infoArr[b4] = this.tmpColor.r;
          infoArr[b4 + 1] = this.tmpColor.g;
          infoArr[b4 + 2] = this.tmpColor.b;
          const totalSegs = tier === 4 ? 10 : tier === 3 ? 6 : tier === 2 ? 4 : 2;
          infoArr[b4 + 3] = Math.max(1, totalSegs * hpRatio);
          bars++;
          d.rotation.set(0, 0, 0);
        }

        if (tele && tels < 24) {
          d.rotation.set(0, 0, 0);
          d.position.set(e.x, 0.06, e.z);
          d.scale.set(e.kind === 'beholder' ? 0.55 : e.radius * 2.2, 1, Math.max(1, PLAYER_Z + 3 - e.z));
          d.updateMatrix();
          this.telegraphs.setMatrixAt(tels, d.matrix);
          const pulse = 0.5 + 0.5 * Math.sin(t * 30);
          if (e.kind === 'beholder') {
            this.tmpColor.setRGB(1.0, 0.72 + pulse * 0.2, 0.18).multiplyScalar(0.75 + pulse * 0.45);
          } else {
            this.tmpColor.setRGB(1, 0.15 + pulse * 0.2, 0.2).multiplyScalar(0.7 + pulse * 0.45);
          }
          this.telegraphs.setColorAt(tels, this.tmpColor);
          tels++;
        }

        if (e.kind === 'siphon' && e.linkedGateId !== null && tetherIdx < this.tethers.length) {
          const g = snap.gates.find((q) => q.id === e.linkedGateId && !q.triggered && !q.dimmed);
          if (g) {
            const tm = this.tethers[tetherIdx++]!;
            const from = this.tmpA.set(e.x, 1.3 * sc, e.z);
            const to = this.tmpB.set(g.x, 1.5, g.z);
            const len = from.distanceTo(to);
            tm.position.copy(from);
            tm.lookAt(to);
            tm.scale.set(1 + Math.sin(t * 25) * 0.4, 1 + Math.sin(t * 25) * 0.4, len);
            tm.visible = true;
          }
        }

        if (e.kind === 'phalanx' && (e.shieldRatio ?? 0) > 0 && shieldIdx < 32) {
          this.riotShields.guard(shieldIdx++, e.x, e.z - entry.recoilZ, sc, yaw, e.shieldRatio!, hit, e.shieldImpactX ?? 0);
        }

        if (e.kind === 'howler' && auraIdx < 24) {
          const wave = 0.94 + Math.sin(t * 6.5 + e.id) * 0.08;
          d.position.set(e.x, 0.045, e.z);
          d.rotation.set(0, 0, 0);
          d.scale.setScalar(wave);
          d.updateMatrix();
          this.auraInstMesh.setMatrixAt(auraIdx++, d.matrix);
        }
      }
    }

    const nukeBlastActive = this.nukeJustDetonated || (snap.nukeBlastTimer ?? 0) > 2.85;
    this.nukeJustDetonated = false;
    const maxRagdolls = nukeBlastActive ? 96 : 64;
    for (const [id, entry] of this.activeEnemies) {
      if (!entry.seen) {
        this.activeEnemies.delete(id);
        if (entry.z < PLAYER_Z - 0.35 && entry.z > -95 && this.dyingEnemies.length < maxRagdolls) {
          const heavy =
            entry.kind === 'bastion' ||
            entry.kind === 'brood' ||
            entry.kind === 'phalanx' ||
            entry.kind === 'glacier';
          const rdx = entry.x - (snap.nukeTargetX ?? 0);
          const rdz = entry.z - (snap.nukeTargetZ ?? -19.5);
          const rLen = Math.max(0.6, Math.hypot(rdx, rdz));
          const vx = nukeBlastActive
            ? (rdx / rLen) * (12.5 + Math.random() * 8.5) + (Math.random() - 0.5) * 4.0
            : (Math.random() - 0.5) * (heavy ? 3.8 : 7.2);
          const vy = nukeBlastActive
            ? 12.0 + Math.random() * 9.5
            : (heavy ? 4.8 : 7.2) + Math.random() * 2.8;
          const vz = nukeBlastActive
            ? (rdz / rLen) * (11.0 + Math.random() * 7.5) - 5.0
            : -((heavy ? 8.2 : 12.8) + Math.random() * 5.2);
          this.dyingEnemies.push({
            kind: entry.kind,
            x: entry.x,
            y: 0.14,
            z: entry.z,
            vx,
            vy,
            vz,
            spinX: -((heavy ? 4.2 : 8.5) + Math.random() * (nukeBlastActive ? 12.0 : 5.0)),
            spinZ: (Math.random() - 0.5) * (nukeBlastActive ? 13.0 : 6.0),
            scale: entry.scale,
            age: 0,
            duration: nukeBlastActive ? 0.92 : 0.48,
            nukeScorched: nukeBlastActive,
          });
        }
      }
    }

    for (let i = this.dyingEnemies.length - 1; i >= 0; i--) {
      const dm = this.dyingEnemies[i]!;
      dm.age += dt;
      if (dm.age >= dm.duration) {
        this.dyingEnemies.splice(i, 1);
        continue;
      }
      dm.vy -= 22.0 * dt;
      dm.x = THREE.MathUtils.clamp(dm.x + dm.vx * dt, -TRACK_HALF_WIDTH + 0.3, TRACK_HALF_WIDTH - 0.3);
      dm.y += dm.vy * dt;
      if (dm.y < 0) {
        if (dm.vy < -3.2 && dm.z > -48) {
          this.effects.streaks(dm.x, 0.08, dm.z, 0xffd87a, 3, { speed: 7.5, len: 0.7, life: 0.16, coneBiasZ: -0.3 });
        }
        dm.y = 0;
        dm.vy = Math.abs(dm.vy) * 0.38;
        dm.vx *= 0.72;
        dm.vz *= 0.74;
      }
      dm.z += dm.vz * dt;
      const p = dm.age / dm.duration;
      const shrink = p > 0.62 ? Math.max(0.05, 1 - (p - 0.62) / 0.38) : 1.06;
      d.position.set(dm.x, dm.y, dm.z);
      d.rotation.set(dm.spinX * dm.age, 0, dm.spinZ * dm.age);
      d.scale.setScalar(dm.scale * shrink);
      d.updateMatrix();
      this.pushEnemyInstance(
        dm.kind,
        6,
        d.matrix,
        Math.max(0, (1 - p * 2.0) * (dm.nukeScorched ? 0.92 : 0.78)),
        0,
        dm.nukeScorched ? 3 : 0,
        dm.z > -44,
      );
    }

    for (const list of Object.values(this.enemyBatches)) {
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const b = list[i]!;
        b.body.count = b.count;
        b.outline.count = b.outlineCount;
        if (b.count > 0) {
          b.body.visible = true;
          b.outline.visible = b.outlineCount > 0;
          b.body.instanceMatrix.needsUpdate = true;
          b.fxAttr.needsUpdate = true;
        } else {
          b.body.visible = false;
          b.outline.visible = false;
        }
      }
    }

    this.hpBg.count = this.hpFg.count = bars;
    this.hpBg.visible = this.hpFg.visible = bars > 0;
    if (bars > 0) {
      this.hpBg.instanceMatrix.needsUpdate = this.hpFg.instanceMatrix.needsUpdate = true;
      const barAttr = this.hpFg.userData.barInfoAttr as THREE.InstancedBufferAttribute | undefined;
      if (barAttr) barAttr.needsUpdate = true;
    }
    this.telegraphs.count = tels;
    this.telegraphs.visible = tels > 0;
    if (tels > 0) {
      this.telegraphs.instanceMatrix.needsUpdate = true;
      if (this.telegraphs.instanceColor) this.telegraphs.instanceColor.needsUpdate = true;
    }
    for (let i = tetherIdx; i < this.tethers.length; i++) this.tethers[i]!.visible = false;

    this.riotShields.finish(shieldIdx, dt);

    this.auraInstMesh.count = auraIdx;
    this.auraInstMesh.visible = auraIdx > 0;
    if (auraIdx > 0) this.auraInstMesh.instanceMatrix.needsUpdate = true;

    this.jugHaloInstMesh.count = jugIdx;
    this.jugHaloInstMesh.visible = jugIdx > 0;
    if (jugIdx > 0) {
      this.jugHaloInstMesh.instanceMatrix.needsUpdate = true;
      if (this.jugHaloInstMesh.instanceColor) this.jugHaloInstMesh.instanceColor.needsUpdate = true;
    }
  }

  private updateProjectiles(snap: SimSnapshot): void {
    const d = this.dummy;
    let n = 0;
    let orbs = 0;
    for (const p of snap.projectiles) {
      if (p.hostile) {
        if (orbs >= 64) continue;
        d.position.set(p.x, 0.75, p.z);
        d.rotation.set(this.time * 5, this.time * 4, 0);
        d.scale.setScalar(1 + Math.sin(this.time * 20 + p.id) * 0.12);
        d.updateMatrix();
        this.orbMesh.setMatrixAt(orbs, d.matrix);
        d.position.set(p.x, 0.055, p.z);
        d.rotation.set(0, 0, 0);
        const warnScale = 2.05 + Math.sin(this.time * 18 + p.id) * 0.24;
        d.scale.set(warnScale, 1, warnScale);
        d.updateMatrix();
        this.orbMarks.setMatrixAt(orbs, d.matrix);
        orbs++;
        continue;
      }
      if (n >= MAX_PROJ) continue;
      const ps = 0.88 + Math.min(0.45, (p.powerScale - 1) * 0.42);
      let sx = 0.172;
      let sz = 1.48;
      switch (p.weapon) {
        case 'scatter': sx = 0.178; sz = 1.04; break;
        case 'rail': sx = 0.215; sz = 3.15; break;
        case 'plasma': sx = 0.48; sz = 0.62; break;
        case 'cryo': sx = 0.178; sz = 1.62; break;
        default: break;
      }
      const yaw = Math.atan2(p.vx, p.vz);
      const amp = p.amplified ? 1.28 : 1;
      const ox = sx * ps * amp;
      const oz = sz * (0.85 + ps * 0.18) * amp;
      d.position.set(p.x, 0.66, p.z);
      d.rotation.set(p.weapon === 'plasma' ? this.time * 8 : 0, yaw, 0);
      d.scale.set(ox, ox * 0.85, oz);
      d.updateMatrix();
      this.projMesh.setMatrixAt(n, d.matrix);

      // Blazing pure-white inner needle core so every stream pops with razor-sharp contrast
      d.scale.set(ox * 0.46, ox * 0.46, oz * 0.78);
      d.updateMatrix();
      this.projCoreMesh.setMatrixAt(n, d.matrix);

      const boltHex = p.amplified ? 0xffe27a : WEAPON_COLOR[p.weapon];
      const glowGain = snap.projectiles.length > 55 ? 1.38 : 1.72;
      this.tmpColor.setHex(boltHex).multiplyScalar(glowGain);
      this.projMesh.setColorAt(n, this.tmpColor);
      if ((p.amplified || p.weapon === 'plasma' || p.weapon === 'rail') && Math.random() < 0.16) {
        this.effects.burst(p.x, 0.66, p.z + 0.3, boltHex, 1, { speed: 1.4, size: p.weapon === 'plasma' ? 0.26 : 0.18, life: 0.15, gravity: 0 });
      }
      n++;
    }
    this.projMesh.count = n;
    this.projCoreMesh.count = n;
    this.projMesh.visible = n > 0;
    this.projCoreMesh.visible = n > 0;
    if (n > 0) {
      this.projMesh.instanceMatrix.needsUpdate = true;
      this.projCoreMesh.instanceMatrix.needsUpdate = true;
      if (this.projMesh.instanceColor) this.projMesh.instanceColor.needsUpdate = true;
    }
    this.orbMesh.count = orbs;
    this.orbMarks.count = orbs;
    this.orbMesh.visible = orbs > 0;
    this.orbMarks.visible = orbs > 0;
    if (orbs > 0) {
      this.orbMesh.instanceMatrix.needsUpdate = true;
      this.orbMarks.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- gates
  private acquireGate(): GateView {
    const pooled = this.gatePool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    const postMat = std(0xffffff, 0.12, { vertexColors: true, metalness: 0.55, roughness: 0.38 });
    const hardware = new GeoBuilder()
      .add(box(0.24, 2.85, 0.26), 0x536776, 0, { p: [0, 1.44, 0] })
      .add(box(0.48, 0.18, 0.65), 0x263448, 0, { p: [0, 0.09, 0] })
      .add(box(0.34, 0.4, 0.36), 0x8596a8, 0, { p: [0, 0.4, 0] })
      .add(box(0.12, 2.18, 0.04), 0xd2eeff, 0, { p: [0, 1.67, 0.16] })
      .add(box(0.38, 0.18, 0.38), 0xc2d0dd, 0, { p: [0, 2.85, 0] });
    for (let i = 0; i < 3; i++) hardware.add(box(0.36, 0.06, 0.37), 0x263448, 0, { p: [0, 0.34 + i * 0.11, 0] });
    const postGeo = hardware.build();
    const postL = new THREE.Mesh(postGeo, postMat);
    const postR = new THREE.Mesh(postGeo, postMat);
    const beam = new THREE.Mesh(new GeoBuilder().add(box(1, 0.16, 0.28), 0x617889).add(box(1, 0.045, 0.31), 0xd2eeff, 0, { p: [0, -0.1, 0] }).add(oct(0.18), 0xffffff, 0, { p: [0, 0.26, 0], s: [0.85, 1.35, 0.6] }).build(), postMat);
    beam.position.y = 2.9;
    const curtainMat = additive(0xffffff, 0.18);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.8).translate(0, 1.4, 0), curtainMat);
    const { ctx, tex } = makeCanvasTexture(512, 288);
    // Clamped color <= 0.90 linear so bloom threshold (0.93) never blurs gate numbers!
    const plateMat = new THREE.MeshBasicMaterial({
      color: 0xf4f8ff,
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1, 288 / 512), plateMat);
    plate.position.set(0, 1.55, 0.08);
    plate.rotation.x = -0.28;
    plate.renderOrder = 4;
    group.add(postL, postR, beam, curtain, plate);
    this.scene.add(group);
    return {
      id: -1,
      group,
      postMat,
      curtainMat,
      beam,
      postL,
      postR,
      curtain,
      plate,
      plateMat,
      ctx,
      tex,
      key: '',
      seen: false,
      fade: 1,
    };
  }

  private releaseGate(v: GateView): void {
    v.group.visible = false;
    v.key = '';
    v.id = -1;
    this.gatePool.push(v);
  }

  private updateGates(snap: SimSnapshot, dt: number, t: number): void {
    for (const v of this.gateViews.values()) v.seen = false;
    for (const g of snap.gates) {
      let v = this.gateViews.get(g.id);
      if (!v) {
        v = this.acquireGate();
        v.id = g.id;
        v.fade = 1;
        this.gateViews.set(g.id, v);
      }
      v.seen = true;
      this.layoutGate(v, g, dt, t);
    }
    for (const [id, v] of this.gateViews) {
      if (!v.seen) {
        this.releaseGate(v);
        this.gateViews.delete(id);
      }
    }
  }

  private layoutGate(v: GateView, g: GateSnapshot, dt: number, t: number): void {
    const w = g.halfWidth * 2;
    v.group.position.set(g.x, 0, g.z);
    v.postL.position.x = -g.halfWidth;
    v.postR.position.x = g.halfWidth;
    v.beam.scale.x = w + 0.24;
    v.curtain.scale.x = w;
    const key = gateTextureKey(g);
    if (key !== v.key) {
      v.key = key;
      paintGatePlate(v.ctx, 512, 288, g);
      v.tex.needsUpdate = true;
    }
    const { main } = gateColors(g);
    v.postMat.color.set(g.mutable ? COLORS.gold : main);
    v.postMat.emissive.set(g.mutable ? COLORS.gold : main);
    v.curtainMat.color.set(main);
    if (g.triggered) {
      v.fade = Math.max(0, v.fade - dt * 3);
    } else if (g.dimmed) {
      v.fade = Math.max(0.25, v.fade - dt * 2);
    }
    const pulse = g.hitPulse;
    const flip = g.flipPulse;
    v.curtainMat.opacity = (0.15 + pulse * 0.1 + flip * 0.35 + Math.sin(t * 4 + g.id) * 0.03) * v.fade;
    v.plateMat.opacity = g.triggered ? v.fade : 1;
    const plateW = Math.min(w * 0.94, 4.8);
    const ps = plateW * (1 + pulse * 0.07 + flip * 0.18);
    v.plate.scale.set(ps, ps, 1);
    v.postMat.emissiveIntensity = 0.12 + flip * 0.8 + pulse * 0.25;
    const ts = g.triggered ? 1 + (1 - v.fade) * 0.4 : 1;
    v.group.scale.set(ts, ts, 1);
  }

  // ---------------------------------------------------------------- vaults
  private acquireVault(): VaultView {
    const pooled = this.vaultPool.pop();
    if (pooled) {
      this.installTrialCasing(pooled);
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    if (!this.vaultFrameGeo) {
      const b = new GeoBuilder();
      b.add(cyl(1.12, 1.25, 0.3, 12), 0x1a2140, 0, { p: [0, 0.15, 0] })
        .add(cyl(1.0, 1.1, 0.12, 12), 0x2b3560, 0, { p: [0, 0.36, 0] })
        .add(tor(1.06, 0.045, 4, 24), 0xffffff, 1.8, { p: [0, 0.31, 0], r: [Math.PI / 2, 0, 0] })
        .add(cyl(1.0, 0.9, 0.22, 12), 0x1a2140, 0, { p: [0, 1.74, 0] })
        .add(tor(0.96, 0.04, 4, 24), 0xffffff, 1.8, { p: [0, 1.66, 0], r: [Math.PI / 2, 0, 0] })
        .add(sph(0.14, 8, 6), 0xffffff, 2.2, { p: [0, 1.9, 0] });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        b.add(box(0.12, 1.3, 0.12), 0x2b3560, 0, { p: [Math.cos(a) * 1.0, 1.0, Math.sin(a) * 1.0], r: [0, -a, 0] })
          .add(box(0.03, 1.1, 0.03), 0xffffff, 1.5, { p: [Math.cos(a) * 1.07, 1.0, Math.sin(a) * 1.07], r: [0, -a, 0] });
      }
      this.vaultFrameGeo = b.build();
    }
    const frame = new THREE.Mesh(this.vaultFrameGeo, this.propMat);
    const crystalMat = std(0xffffff, 0.25, {
      transparent: true,
      opacity: 0.26,
      metalness: 0.2,
      roughness: 0.1,
      flatShading: false,
      depthWrite: false,
    });
    const crystal = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.3, 16, 1, true), crystalMat);
    crystal.position.y = 1.0;
    crystal.renderOrder = 2;

    const coreGroup = new THREE.Group();
    coreGroup.position.y = 1.0;
    const core = new THREE.Mesh(buildRewardDisplayGeo('pulse'), this.vaultToonMat);
    const coreOutline = new THREE.Mesh(new THREE.BufferGeometry(), getOutlineMaterial(0.0052));
    coreOutline.visible = false;
    coreGroup.add(core, coreOutline);

    const ringMat = additive(0xffffff, 0.45, this.glowTex);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.05;
    const { ctx, tex } = makeCanvasTexture(384, 192);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.3),
      new THREE.MeshBasicMaterial({ color: 0xf4f8ff, map: tex, transparent: true, depthWrite: false }),
    );
    plate.position.set(0, 2.75, 0);
    plate.rotation.x = -0.32;
    plate.renderOrder = 4;
    group.add(ring, frame, coreGroup, crystal, plate);
    this.scene.add(group);
    const view: VaultView = {
      id: -1,
      group,
      crystal,
      crystalMat,
      coreGroup,
      core,
      coreOutline,
      coreMat: this.vaultToonMat,
      frame,
      ringMat,
      reward: '',
      plate,
      ctx,
      tex,
      key: '',
      seen: false,
    };
    this.installTrialCasing(view);
    return view;
  }

  private releaseVault(v: VaultView): void {
    v.group.visible = false;
    v.key = '';
    this.vaultPool.push(v);
  }

  private updateVaults(snap: SimSnapshot, t: number): void {
    for (const v of this.vaultViews.values()) v.seen = false;
    for (const s of snap.vaults) {
      if (s.broken) continue;
      let v = this.vaultViews.get(s.id);
      if (!v) {
        v = this.acquireVault();
        v.id = s.id;
        this.vaultViews.set(s.id, v);
      }
      v.seen = true;
      this.layoutVault(v, s, snap, t);
    }
    for (const [id, v] of this.vaultViews) {
      if (!v.seen) {
        this.releaseVault(v);
        this.vaultViews.delete(id);
      }
    }
  }

  private layoutVault(v: VaultView, s: VaultSnapshot, snap: SimSnapshot, t: number): void {
    const meta = REWARD_META[s.rewardWeapon];
    v.group.position.set(s.x, 0, s.z);
    const rel = describeVaultRelation(
      s.rewardWeapon,
      snap.activeLoadout ?? [],
      snap.arsenal,
      snap.bladesCount,
      snap.activeFusions ?? [],
      snap.pendingSwapWeapon ?? null,
    );
    const key = `${s.rewardWeapon}|${s.displayHp}|${rel.tag}`;
    if (key !== v.key) {
      v.key = key;
      paintVaultPlate(v.ctx, 384, 192, s.rewardWeapon, s.displayHp, s.maxHp, rel.tag, rel.color);
      v.tex.needsUpdate = true;
    }
    const rewardKey = `${s.rewardWeapon}:${Boolean(this.gltfLib)}`;
    if (v.reward !== rewardKey) {
      v.reward = rewardKey;
      const libDef = this.gltfLib?.vaultRewards[s.rewardWeapon as RewardId];
      if (libDef) {
        v.core.geometry = libDef.geo;
        v.coreOutline.geometry = libDef.outlineGeo;
        v.coreOutline.visible = true;
      } else {
        let geo = this.fallbackRewardGeos.get(s.rewardWeapon);
        if (!geo) {
          geo = buildRewardDisplayGeo(s.rewardWeapon);
          this.fallbackRewardGeos.set(s.rewardWeapon, geo);
        }
        v.core.geometry = geo;
        v.coreOutline.visible = false;
      }
    }
    const hp = s.hitPulse;
    v.crystalMat.color.set(meta.color);
    v.crystalMat.emissive.set(meta.color);
    v.crystalMat.emissiveIntensity = 0.25 + hp * 1.1;
    v.crystalMat.opacity = 0.26 + hp * 0.2;
    v.ringMat.color.set(meta.color);
    v.ringMat.opacity = 0.35 + Math.sin(t * 4 + s.id) * 0.1 + hp * 0.25;
    v.coreGroup.rotation.set(0.28, t * 1.7, Math.sin(t * 2) * 0.12);
    v.coreGroup.position.y = 1.05 + Math.sin(t * 3 + s.id) * 0.1;
    const sc = 1 + hp * 0.08;
    v.crystal.scale.set(sc, 1, sc);
    v.frame.scale.set(sc, 1, sc);
  }

  // ---------------------------------------------------------------- barrels
  private acquireBarrel(): BarrelView {
    const pooled = this.barrelPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    if (!this.barrelGeo) {
      const b = new GeoBuilder();
      const ORANGE = 0xff7a1a;
      const DARK = 0x1a1426;
      b.add(cyl(0.62, 0.62, 1.22, 16), ORANGE, 0.2, { p: [0, 0.7, 0] })
        .add(cyl(0.66, 0.68, 0.16, 16), DARK, 0, { p: [0, 0.12, 0] })
        .add(cyl(0.65, 0.65, 0.1, 16), DARK, 0, { p: [0, 0.45, 0] })
        .add(cyl(0.65, 0.65, 0.1, 16), DARK, 0, { p: [0, 0.98, 0] })
        .add(cyl(0.52, 0.62, 0.14, 16), DARK, 0, { p: [0, 1.36, 0] })
        .add(box(0.36, 0.38, 0.08), 0xfff06a, 2.2, { p: [0, 0.72, 0.6] })
        .add(box(0.36, 0.38, 0.08), 0xfff06a, 2.2, { p: [0, 0.72, -0.6] })
        .add(box(0.12, 0.05, 0.03), DARK, 0, { p: [-0.36, 0.72, 0.52], r: [0, 0.6, 0.6] })
        .add(box(0.12, 0.05, 0.03), DARK, 0, { p: [0.36, 0.72, 0.52], r: [0, -0.6, -0.6] })
        .add(cyl(0.05, 0.05, 0.22, 6), DARK, 0, { p: [0.28, 1.5, 0] });
      this.barrelGeo = b.build();
    }
    const bodyMat = makeCharacterMaterial(0xffc06a, 0.4, 1.4);
    const body = new THREE.Mesh(this.barrelGeo, bodyMat);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, toneMapped: false });
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lightMat);
    light.position.y = 1.52;
    const ringMat = additive(0xff9a1a, 0.42);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.05;
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2),
      additive(0xff9a1a, 0.06),
    );
    fill.position.y = 0.04;
    group.add(body, light, ring, fill);
    this.scene.add(group);
    return { id: -1, group, body, bodyMat, light, lightMat, ring, fill, ringMat, seen: false };
  }

  private releaseBarrel(v: BarrelView): void {
    v.group.visible = false;
    this.barrelPool.push(v);
  }

  private updateBarrels(snap: SimSnapshot, t: number): void {
    for (const v of this.barrelViews.values()) v.seen = false;
    for (const b of snap.barrels) {
      if (b.detonated) continue;
      let v = this.barrelViews.get(b.id);
      if (!v) {
        v = this.acquireBarrel();
        v.id = b.id;
        this.barrelViews.set(b.id, v);
      }
      v.seen = true;
      this.layoutBarrel(v, b, t);
    }
    for (const [id, v] of this.barrelViews) {
      if (!v.seen) {
        this.releaseBarrel(v);
        this.barrelViews.delete(id);
      }
    }
  }

  private layoutBarrel(v: BarrelView, b: BarrelSnapshot, t: number): void {
    v.group.position.set(b.x, 0, b.z);
    this.pushShadow(b.x, b.z, 0.72);
    v.ring.scale.set(b.blastRadius, 1, b.blastRadius);
    v.fill.scale.set(b.blastRadius, 1, b.blastRadius);
    v.ringMat.opacity = 0.32 + Math.sin(t * 6 + b.id) * 0.12;
    const dmg = 1 - b.hp / 15;
    const oh = b.overheat ?? 0;
    v.bodyMat.emissive.setRGB(1, oh > 0.2 ? 0.18 : 0.55, oh > 0.2 ? 0.28 : 0.1).multiplyScalar(b.hitPulse * 0.65 + dmg * 0.22 + oh * 0.95);
    const blink = Math.sin(t * (6 + dmg * 18 + oh * 28) + b.id) > 0 ? 1.35 : 0.25;
    v.lightMat.color.setRGB(blink + b.hitPulse + oh, 0.23 * blink + b.hitPulse, 0.23 * blink + b.hitPulse);
    if (oh > 0.05) {
      v.ringMat.color.setHex(oh > 0.6 ? 0xff2a55 : 0xff9a1a);
      v.ringMat.opacity = Math.min(0.92, 0.42 + oh * 0.48);
    } else {
      v.ringMat.color.setHex(0xff9a1a);
    }
    const s = 1 + b.hitPulse * 0.15 + oh * 0.2 * (0.5 + 0.5 * Math.sin(t * 26));
    v.body.scale.set(s, s, s);
    v.light.position.y = 1.52 * s;
  }

  // ---------------------------------------------------------------- lenses
  private acquireLens(): LensView {
    const pooled = this.lensPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    const frameMat = std(0xffc531, 0.75, { metalness: 0.8 });
    const postGeo = new THREE.BoxGeometry(0.18, 2.2, 0.18).translate(0, 1.1, 0);
    const l = new THREE.Mesh(postGeo, frameMat);
    const r = new THREE.Mesh(postGeo, frameMat);
    l.name = 'l';
    r.name = 'r';
    const paneMat = additive(0xffd84a, 0.26);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.0).translate(0, 1.1, 0), paneMat);
    pane.name = 'pane';
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.76),
      new THREE.MeshBasicMaterial({ color: 0xf4f8ff, map: this.lensTex, transparent: true, depthWrite: false }),
    );
    label.position.set(0, 2.75, 0);
    label.rotation.x = -0.32;
    label.renderOrder = 4;
    group.add(l, r, pane, label);
    this.scene.add(group);
    return { id: -1, group, paneMat, seen: false };
  }

  private releaseLens(v: LensView): void {
    v.group.visible = false;
    this.lensPool.push(v);
  }

  private updateLenses(snap: SimSnapshot, t: number): void {
    for (const v of this.lensViews.values()) v.seen = false;
    for (const s of snap.lenses) {
      let v = this.lensViews.get(s.id);
      if (!v) {
        v = this.acquireLens();
        v.id = s.id;
        this.lensViews.set(s.id, v);
      }
      v.seen = true;
      this.layoutLens(v, s, t);
    }
    for (const [id, v] of this.lensViews) {
      if (!v.seen) {
        this.releaseLens(v);
        this.lensViews.delete(id);
      }
    }
  }

  private layoutLens(v: LensView, s: PrismLensSnapshot, t: number): void {
    v.group.position.set(s.x, 0, s.z);
    const l = v.group.getObjectByName('l')!;
    const r = v.group.getObjectByName('r')!;
    const pane = v.group.getObjectByName('pane')!;
    l.position.x = -s.halfWidth;
    r.position.x = s.halfWidth;
    pane.scale.x = s.halfWidth * 2;
    v.paneMat.opacity = 0.2 + s.pulse * 0.45 + Math.sin(t * 5) * 0.05;
  }

  // ---------------------------------------------------------------- V5 competition set-pieces & superweapons
  private acquireSingularity(): SingularityView {
    const pooled = this.singularityPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.68, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x070114 }),
    );
    core.position.y = 0.55;
    const cage = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.84, 1),
      new THREE.MeshBasicMaterial({
        color: 0xb98cff,
        wireframe: true,
        transparent: true,
        opacity: 0.78,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    cage.position.y = 0.55;
    const ringOuter = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 1.0, 48).rotateX(-Math.PI / 2),
      additive(0xb98cff, 0.52),
    );
    ringOuter.position.y = 0.08;
    const ringInner = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.68, 40).rotateX(-Math.PI / 2),
      additive(0x3ef3ff, 0.62),
    );
    ringInner.position.y = 0.12;
    group.add(ringOuter, ringInner, core, cage);
    this.scene.add(group);
    return { id: -1, group, ringOuter, ringInner, cage, seen: false };
  }

  private acquireJumpPad(): JumpPadView {
    const pooled = this.jumpPadPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    const baseGeo = new GeoBuilder()
      .add(box(3.3, 0.24, 2.3), 0x163258, 0.25, { p: [0, 0.12, 0], r: [0.16, 0, 0] })
      .add(box(3.0, 0.08, 0.36), 0x3ef3ff, 1.9, { p: [0, 0.28, 0.55], r: [0.16, 0, 0] })
      .add(box(2.5, 0.08, 0.36), 0xffd84a, 2.0, { p: [0, 0.38, -0.05], r: [0.16, 0, 0] })
      .add(box(2.0, 0.08, 0.36), 0x19f5a8, 2.0, { p: [0, 0.48, -0.65], r: [0.16, 0, 0] })
      .build();
    const mesh = new THREE.Mesh(baseGeo, this.propMat);
    const stripMat = additive(0x3ef3ff, 0.48, this.glowTex);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.4).rotateX(-Math.PI / 2), stripMat);
    glow.position.y = 0.05;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, 0.82),
      new THREE.MeshBasicMaterial({ color: 0xf4f8ff, map: this.jumpTex, transparent: true, depthWrite: false }),
    );
    sign.position.set(0, 2.05, 0);
    sign.rotation.x = -0.3;
    sign.renderOrder = 4;
    // Projected Landing-Zone Payoff Ring (~16.2m ahead on bridge) so player sees exact Sky-Slam zone!
    const landRingMat = additive(0xffd84a, 0.52);
    const landRing = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.25, 28).rotateX(-Math.PI / 2),
      landRingMat,
    );
    landRing.position.set(0, 0.06, -16.2);
    landRing.name = 'landRing';
    const landCore = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.95, 20).rotateX(-Math.PI / 2),
      additive(0x3ef3ff, 0.46),
    );
    landCore.name = 'landCore';
    landCore.position.set(0, 0.07, -16.2);
    const arcGuide = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 15.2).rotateX(-Math.PI / 2),
      additive(0x62f4ff, 0.28),
    );
    arcGuide.position.set(0, 0.05, -8.1);
    group.add(glow, mesh, sign, arcGuide, landRing, landCore);
    this.scene.add(group);
    return { id: -1, group, stripMat, seen: false };
  }

  private acquireReflector(): ReflectorView {
    const pooled = this.reflectorPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    const mirrorPivot = new THREE.Group();
    mirrorPivot.name = 'pivot';
    const frameMat = std(0x465b68, 0.12, { metalness: 0.65 });
    const brass = std(0xdb9c52, 0.22, { metalness: 0.56 });
    const postGeo = new THREE.BoxGeometry(0.22, 2.35, 0.22).translate(0, 1.18, 0);
    const l = new THREE.Mesh(postGeo, frameMat);
    const r = new THREE.Mesh(postGeo, frameMat);
    l.position.x = -1.75;
    r.position.x = 1.75;
    const paneMat = additive(0x7dff6b, 0.38);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.15).translate(0, 1.15, 0), paneMat);
    const capGeo = new THREE.BoxGeometry(3.65, 0.13, 0.24);
    const brow = new THREE.Mesh(capGeo, frameMat);
    brow.position.y = 2.28;
    const foot = new THREE.Mesh(capGeo, frameMat);
    foot.position.y = 0.13;
    const brackets = new GeoBuilder();
    for (const x of [-1.7, 1.7]) {
      brackets.add(box(0.38, 0.36, 0.32), 0xb5854d, 0, { p: [x, 0.38, 0] })
        .add(box(0.30, 0.19, 0.28), 0x9eb1b2, 0, { p: [x, 2.09, 0] });
    }
    const hinges = new THREE.Mesh(brackets.build(), this.propMat);
    const bearing = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.56, 0.16, 12), brass);
    bearing.position.y = 0.12;
    mirrorPivot.add(l, r, brow, foot, pane, hinges, bearing);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 0.8),
      new THREE.MeshBasicMaterial({ color: 0xf4f8ff, map: this.reflectorTex, transparent: true, depthWrite: false }),
    );
    sign.position.set(0, 2.85, 0);
    sign.rotation.x = -0.3;
    sign.renderOrder = 4;
    // Deflected Bank-Shot Trajectory Laser Preview (shows exact 36° bounce line toward rear barrels!)
    const aimPivot = new THREE.Group();
    aimPivot.name = 'aimPivot';
    const aimBeam = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 15.5).rotateX(-Math.PI / 2).translate(0, 0.12, -7.75),
      additive(0x7dff6b, 0.46),
    );
    const inBeam = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, 6.5).rotateX(-Math.PI / 2).translate(0, 0.1, 3.25),
      additive(0x3ef3ff, 0.28),
    );
    const arrowGeo = new THREE.BufferGeometry();
    arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.42, 0, 0.42, 0.42, 0, 0.42, 0, 0, -0.58], 3));
    for (const z of [-2.3, -5.25, -8.2]) {
      const arrow = new THREE.Mesh(arrowGeo, additive(0xa4ead0, 0.82));
      arrow.position.set(0, 0.15, z);
      aimPivot.add(arrow);
    }
    aimPivot.add(aimBeam);
    group.add(mirrorPivot, sign, inBeam, aimPivot);
    this.scene.add(group);
    return { id: -1, group, paneMat, seen: false };
  }

  private acquireContractWall(): ContractWallView {
    const pooled = this.contractPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    const pylonGeo = new GeoBuilder()
      .add(cyl(0.26, 0.34, 2.1, 8), 0x26142e, 0.3, { p: [0, 1.05, 0] })
      .add(sph(0.26, 8, 6), 0xffc531, 2.1, { p: [0, 2.2, 0] })
      .build();
    const postBack = new THREE.Mesh(pylonGeo, this.propMat);
    const postFront = new THREE.Mesh(pylonGeo, this.propMat);
    const beamMat = additive(0xff476e, 0.42);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.65, 1), beamMat);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.1, 0.88),
      new THREE.MeshBasicMaterial({ color: 0xf4f8ff, map: this.bountyTex, transparent: true, depthWrite: false }),
    );
    sign.rotation.x = -0.3;
    sign.renderOrder = 4;
    const bountyStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 5.5).rotateX(-Math.PI / 2),
      additive(0xffc531, 0.26),
    );
    bountyStrip.name = 'bountyStrip';
    const safeStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 5.5).rotateX(-Math.PI / 2),
      additive(0x19f5a8, 0.18),
    );
    safeStrip.name = 'safeStrip';
    group.add(postBack, postFront, beam, sign, bountyStrip, safeStrip);
    this.scene.add(group);
    return { id: -1, group, beam, beamMat, postBack, postFront, sign, seen: false };
  }

  private acquireDoomOrb(): DoomOrbView {
    const pooled = this.doomOrbPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    const coreMat = std(0xff2a55, 0.85, { roughness: 0.2, metalness: 0.3 });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.82, 2), coreMat);
    core.position.y = 1.18;
    const cageMat = new THREE.MeshBasicMaterial({
      color: 0xffcf40,
      wireframe: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.06, 1), cageMat);
    cage.position.y = 1.18;
    const haloMat = additive(0xff2a55, 0.65, this.glowTex);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2), haloMat);
    halo.position.y = 0.05;
    const { ctx, tex } = makeCanvasTexture(384, 176);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.75, 1.26),
      new THREE.MeshBasicMaterial({ color: 0xf4f8ff, map: tex, transparent: true, depthWrite: false }),
    );
    plate.position.set(0, 2.75, 0);
    plate.rotation.x = -0.28;
    plate.renderOrder = 5;
    group.add(halo, core, cage, plate);
    this.scene.add(group);
    return { id: -1, group, coreMat, cage, cageMat, haloMat, ctx, tex, key: '', seen: false };
  }

  /** Triggers a 3D Meteor Sky-Slam shock-dome, plasma crown, crater decal, seismic quake, and radial shockwaves on jump landing! */
  triggerJumpSlamVfx(x: number, z: number, hits = 0): void {
    const crowd = hits >= 3;
    const slot = this.jumpSlamPool[this.jumpSlamCursor]!;
    this.jumpSlamCursor = (this.jumpSlamCursor + 1) % this.jumpSlamPool.length;
    slot.dur = crowd ? 0.62 : 0.48;
    slot.timer = slot.dur;
    slot.crowd = crowd;
    slot.group.position.set(x, 0, z);
    slot.group.visible = true;
    slot.domeMat.color.setHex(crowd ? 0xffd84a : 0x3ef3ff);
    slot.crownMat.color.setHex(crowd ? 0xff9a1f : 0x62f4ff);
    slot.fissureMat.color.setHex(crowd ? 0xfff3a8 : 0xb8ffff);

    const fx = this.effects;
    const colCore = 0xffffff;
    const colMid = crowd ? 0xffd84a : 0x62f4ff;
    const colOuter = crowd ? 0xff5a2a : 0x2b88ff;

    // Multi-wave ground shockwave rings + delayed secondary seismic ripple!
    fx.ring(x, z, colCore, crowd ? 9.8 : 6.8, 0.34);
    fx.ring(x, z, colMid, crowd ? 8.2 : 5.4, 0.52);
    fx.ring(x, z, colOuter, crowd ? 11.4 : 7.6, 0.68);
    fx.after(0.11, () => fx.ring(x, z, colMid, crowd ? 13.2 : 8.8, 0.48));

    // Upward crystal/rock shatter + radial ground sparks + dense 2-layer particle eruption!
    fx.groundFlash(x, z, colMid, crowd ? 6.4 : 4.4, 0.32);
    fx.shatter(x, 0.65, z, colMid, crowd ? 26 : 14, true);
    fx.streaks(x, 0.55, z, colCore, crowd ? 24 : 14, { speed: crowd ? 22 : 16, len: 1.75, life: 0.32, coneBiasZ: 0 });
    fx.burst(x, 0.35, z, colCore, crowd ? 85 : 46, { speed: crowd ? 16 : 11.5, size: crowd ? 0.56 : 0.42, life: 0.58, up: 1.45, gravity: 4.2 });
    fx.burst(x, 0.9, z, colMid, crowd ? 65 : 34, { speed: crowd ? 12.5 : 9.0, size: crowd ? 0.48 : 0.36, life: 0.72, up: 1.85, gravity: 2.8 });

    // Persistent glowing ground crater / plasma fissure decal!
    this.spawnDecal(x, z, crowd ? 5.2 : 3.6, crowd ? 0xff9a24 : 0x3ef3ff, crowd ? 4 : 5, 16);

    // Camera downward thud + seismic screen quake + post-process shockwave ring + anamorphic lens streak!
    this.shake(crowd ? 0.52 : 0.32);
    this.triggerScreenQuake(crowd ? 0.52 : 0.36, crowd ? 0.46 : 0.28);
    this.kickCamera((crowd ? 0.52 : 0.32) * this.shakeScale, (Math.random() - 0.5) * 0.55);
    this.triggerShockwave(crowd ? 0.85 : 0.54);
    this.triggerAnamorphicFlare(x, z, crowd ? 0.58 : 0.36, crowd ? 1 : 2);
  }

  private updateCompetitionProps(snap: SimSnapshot, t: number, dt = 0.016, deltaScroll = 0): void {
    // 1. 3D Cryo-Nova Singularity Vortices
    for (const v of this.singularityViews.values()) v.seen = false;
    for (const s of snap.singularities ?? []) {
      let v = this.singularityViews.get(s.id);
      if (!v) {
        v = this.acquireSingularity();
        v.id = s.id;
        this.singularityViews.set(s.id, v);
      }
      v.seen = true;
      v.group.position.set(s.x, 0, s.z);
      const pulse = 0.92 + 0.1 * Math.sin(t * 14 + s.id);
      v.ringOuter.scale.set(s.radius * pulse, s.radius * pulse, 1);
      v.ringOuter.rotation.z = t * 3.5;
      v.ringInner.scale.set(s.radius * 0.78, s.radius * 0.78, 1);
      v.ringInner.rotation.z = -t * 5.8;
      v.cage.rotation.set(t * 2.8, t * 4.1, 0);
      if (Math.random() < 0.35) {
        const ang = Math.random() * Math.PI * 2;
        const rx = s.x + Math.cos(ang) * s.radius * 0.75;
        const rz = s.z + Math.sin(ang) * s.radius * 0.75;
        this.effects.burst(rx, 0.35, rz, 0xb98cff, 1, { speed: 2.6, size: 0.26, life: 0.24, up: 0.6 });
      }
    }
    for (const [id, v] of this.singularityViews) {
      if (!v.seen) {
        v.group.visible = false;
        this.singularityPool.push(v);
        this.singularityViews.delete(id);
      }
    }

    // 2. Mag-Lev Jump Pads, Airborne Meteor Dive Trail & 3D Sky-Slam Shock-Domes
    const flight = snap.jumpTimeLeft ?? 0;
    this.landingMarker.visible = flight > 0;
    if (flight > 0) {
      const fracLeft = THREE.MathUtils.clamp(flight / JUMP_DURATION_SEC, 0, 1);
      const landZ = PLAYER_Z - flight * snap.runwaySpeed;
      this.landingMarker.position.set(snap.squadX, 0.10, landZ);
      this.landingMarker.rotation.y = t * 4.2;
      this.landingMarker.scale.setScalar(0.82 + 0.58 * fracLeft);
      const bull = this.landingMarker.getObjectByName('bullseye') as THREE.Mesh | undefined;
      if (bull) {
        bull.scale.setScalar(0.85 + (1 - fracLeft) * 0.65 + 0.12 * Math.sin(t * 22));
      }
      const beacon = this.landingMarker.getObjectByName('beacon') as THREE.Mesh | undefined;
      if (beacon) {
        beacon.scale.set(0.75 + (1 - fracLeft) * 0.5, 0.6 + (1 - fracLeft) * 0.85, 0.75 + (1 - fracLeft) * 0.5);
        (beacon.material as THREE.MeshBasicMaterial).opacity = 0.18 + (1 - fracLeft) * 0.42;
      }
      // Emit fiery cyan-gold meteor dive trail off the airborne squad during the downward slam half!
      if (fracLeft < 0.52 && dt > 0 && Math.random() < 0.78) {
        const airY = snap.squadAirY ?? 1.5;
        this.effects.burst(
          snap.squadX + (Math.random() - 0.5) * 1.4,
          airY + 0.45,
          PLAYER_Z + (Math.random() - 0.5) * 0.8,
          fracLeft < 0.25 ? 0xffd84a : 0x62f4ff,
          2,
          { speed: 4.8, size: 0.36, life: 0.22, up: 0.8, gravity: 0 },
        );
      }
    }

    // Animate active 3D Meteor Sky-Slam shock-domes & upward plasma crowns
    for (let i = 0; i < this.jumpSlamPool.length; i++) {
      const s = this.jumpSlamPool[i]!;
      if (s.timer <= 0) continue;
      s.timer = Math.max(0, s.timer - dt);
      if (s.timer <= 0) {
        s.group.visible = false;
        continue;
      }
      s.group.position.z += deltaScroll;
      const p = 1 - s.timer / Math.max(0.01, s.dur);
      const easeOut = 1 - Math.pow(1 - p, 3);
      const fade = Math.pow(1 - p, 1.55);
      const maxR = s.crowd ? 7.6 : 5.2;
      const rNow = 1.1 + easeOut * maxR;
      s.dome.scale.set(rNow, 1.0 + easeOut * (s.crowd ? 3.8 : 2.6), rNow);
      s.dome.rotation.y = t * 5.0;
      s.domeMat.opacity = 0.78 * fade;

      const crownR = 0.85 + easeOut * (s.crowd ? 4.4 : 3.0);
      const crownH = (s.crowd ? 6.8 : 4.6) * Math.sin(Math.min(1, p * 1.4) * Math.PI * 0.5);
      s.crown.scale.set(crownR, Math.max(0.2, crownH), crownR);
      s.crown.rotation.y = -t * 7.5;
      s.crownMat.opacity = 0.68 * fade;

      const fisR = 1.2 + easeOut * (s.crowd ? 8.2 : 5.6);
      s.fissure.scale.set(fisR, fisR, 1);
      s.fissureMat.opacity = 0.85 * fade;
    }

    for (const v of this.jumpPadViews.values()) v.seen = false;
    for (const jp of snap.jumpPads ?? []) {
      if (jp.triggered) continue;
      let v = this.jumpPadViews.get(jp.id);
      if (!v) {
        v = this.acquireJumpPad();
        v.id = jp.id;
        this.jumpPadViews.set(jp.id, v);
      }
      v.seen = true;
      v.group.position.set(jp.x, 0, jp.z);
      const alignedJp = jp.z < PLAYER_Z && Math.abs(snap.squadX - jp.x) <= 1.85;
      v.stripMat.opacity = (alignedJp ? 0.78 : 0.44) + 0.18 * Math.sin(t * (alignedJp ? 16 : 9) + jp.id);
      const landRing = v.group.getObjectByName('landRing');
      if (landRing) landRing.position.z = -snap.runwaySpeed * JUMP_DURATION_SEC;
      const landCore = v.group.getObjectByName('landCore');
      if (landCore) landCore.position.z = -snap.runwaySpeed * JUMP_DURATION_SEC;
      if (landRing) landRing.scale.setScalar(alignedJp ? 1.18 + 0.08 * Math.sin(t * 14) : 1.04);
    }
    for (const [id, v] of this.jumpPadViews) {
      if (!v.seen) {
        v.group.visible = false;
        this.jumpPadPool.push(v);
        this.jumpPadViews.delete(id);
      }
    }

    // 3. 45° Angled Reflector Mirrors
    for (const v of this.reflectorViews.values()) v.seen = false;
    for (const rf of snap.reflectors ?? []) {
      let v = this.reflectorViews.get(rf.id);
      if (!v) {
        v = this.acquireReflector();
        v.id = rf.id;
        this.reflectorViews.set(rf.id, v);
      }
      v.seen = true;
      v.group.position.set(rf.x, 0, rf.z);
      const deg = rf.angleDeg !== undefined ? rf.angleDeg : rf.lean * 36;
      const rad = (deg * Math.PI) / 180;
      const pivot = v.group.getObjectByName('pivot')!;
      pivot.rotation.y = rad * 0.95;
      const alignedRf = rf.z < PLAYER_Z && Math.abs(snap.squadX - rf.x) <= 1.95;
      const aimPivot = v.group.getObjectByName('aimPivot');
      if (aimPivot) {
        aimPivot.rotation.y = -rad;
        aimPivot.scale.setScalar(alignedRf ? 1.22 : 1.0);
      }
      v.paneMat.opacity = (alignedRf ? 0.58 : 0.28) + rf.pulse * 0.48 + 0.06 * Math.sin(t * (alignedRf ? 14 : 7));
    }
    for (const [id, v] of this.reflectorViews) {
      if (!v.seen) {
        v.group.visible = false;
        this.reflectorPool.push(v);
        this.reflectorViews.delete(id);
      }
    }

    // 4. Dual-Lane Deathmatch Contract Laser Barriers
    for (const v of this.contractViews.values()) v.seen = false;
    for (const cw of snap.contractWalls ?? []) {
      let v = this.contractViews.get(cw.id);
      if (!v) {
        v = this.acquireContractWall();
        v.id = cw.id;
        this.contractViews.set(cw.id, v);
      }
      v.seen = true;
      const len = Math.max(1, cw.zFront - cw.zBack);
      const midZ = (cw.zFront + cw.zBack) * 0.5;
      v.group.position.set(0, 0, 0);
      v.postFront.position.set(0, 0, cw.zFront);
      v.postBack.position.set(0, 0, cw.zBack);
      v.beam.position.set(0, 0.95, midZ);
      v.beam.scale.set(1, 1, len);
      v.beamMat.opacity = 0.34 + 0.12 * Math.sin(t * 14);
      const bSideX = cw.bountySide === 'left' ? -2.35 : 2.35;
      v.sign.position.set(bSideX, 2.75, Math.min(cw.zFront + 1.2, PLAYER_Z - 5.5));
      const bStrip = v.group.getObjectByName('bountyStrip');
      const sStrip = v.group.getObjectByName('safeStrip');
      if (bStrip) bStrip.position.set(bSideX, 0.05, cw.zFront + 2.4);
      if (sStrip) sStrip.position.set(-bSideX, 0.05, cw.zFront + 2.4);
    }
    for (const [id, v] of this.contractViews) {
      if (!v.seen) {
        v.group.visible = false;
        this.contractPool.push(v);
        this.contractViews.delete(id);
      }
    }

    // 5. Boss Deflectable Numbered Doom-Orbs
    for (const v of this.doomOrbViews.values()) v.seen = false;
    for (const orb of snap.doomOrbs ?? []) {
      let v = this.doomOrbViews.get(orb.id);
      if (!v) {
        v = this.acquireDoomOrb();
        v.id = orb.id;
        this.doomOrbViews.set(orb.id, v);
      }
      v.seen = true;
      v.group.position.set(orb.x, 0, orb.z);
      const key = `${orb.value}|${Math.round(orb.chargeRatio * 12)}|${orb.reflected ? 1 : 0}`;
      if (key !== v.key) {
        v.key = key;
        paintDoomOrbPlate(v.ctx, 384, 176, orb.value, orb.chargeRatio, orb.reflected);
        v.tex.needsUpdate = true;
      }
      const hex = orb.reflected ? 0x19f5a8 : 0xff2a55;
      v.coreMat.color.setHex(hex);
      v.coreMat.emissive.setHex(hex);
      v.coreMat.emissiveIntensity = 0.75 + orb.hitPulse * 0.9;
      v.cageMat.color.setHex(orb.reflected ? 0xffd84a : 0xff85a2);
      v.haloMat.color.setHex(hex);
      v.cage.rotation.set(t * 3.2, -t * 4.5, 0);
      const sc = 1.15 + orb.hitPulse * 0.18 + 0.07 * Math.sin(t * 12);
      v.cage.scale.setScalar(sc);
    }
    for (const [id, v] of this.doomOrbViews) {
      if (!v.seen) {
        v.group.visible = false;
        v.key = '';
        this.doomOrbPool.push(v);
        this.doomOrbViews.delete(id);
      }
    }

    // 6. Shootable Sky-Drop Plasma Cargo Cranes
    for (const v of this.skyCargoViews.values()) v.seen = false;
    for (const c of snap.skyCargos ?? []) {
      let v = this.skyCargoViews.get(c.id);
      if (!v) {
        v = this.acquireSkyCargo();
        v.id = c.id;
        this.skyCargoViews.set(c.id, v);
      }
      v.seen = true;
      v.group.visible = c.state !== 'slammed';
      v.group.position.set(c.x, 0, c.z);
      const bob = c.state === 'hanging' ? Math.sin(t * 5.2 + c.id) * 0.14 : 0;
      const cy = c.y + bob;
      v.crate.position.set(0, cy + 0.72, 0);
      v.crate.rotation.set(c.hitPulse * 0.18, t * (c.state === 'falling' ? 6.0 : 0.9), c.hitPulse * 0.15);
      v.crate.scale.setScalar(1 + c.hitPulse * 0.14);
      v.drone.position.set(0, 7.6 + Math.sin(t * 4.0) * 0.18, 0);
      v.drone.rotation.y = t * 2.4;
      v.tether.visible = c.state === 'hanging';
      const tLen = Math.max(0.2, 7.4 - (cy + 1.2));
      v.tether.position.set(0, cy + 1.2 + tLen * 0.5, 0);
      v.tether.scale.set(1 + c.hitPulse * 0.8, tLen, 1 + c.hitPulse * 0.8);
      v.reticle.position.set(0, 0.05, 0);
      v.reticle.rotation.z = -t * 2.2;
      v.reticle.scale.setScalar(c.state === 'falling' ? 6.2 : 5.2 + Math.sin(t * 7) * 0.22);
      const hpFrac = THREE.MathUtils.clamp(c.hp / Math.max(1, c.maxHp), 0.02, 1);
      v.hpFill.visible = c.state === 'hanging';
      v.hpFill.position.set(-1.1 * (1 - hpFrac), cy + 1.85, 0);
      v.hpFill.scale.set(hpFrac, 1, 1);
    }
    for (const [id, v] of this.skyCargoViews) {
      if (!v.seen) {
        v.group.visible = false;
        this.skyCargoPool.push(v);
        this.skyCargoViews.delete(id);
      }
    }

    // 7. Supersonic Elevated Maglev Express Bullet Train Sweep
    for (const v of this.maglevViews.values()) v.seen = false;
    for (const tr of snap.maglevTrains ?? []) {
      let v = this.maglevViews.get(tr.id);
      if (!v) {
        v = this.acquireMaglev();
        v.id = tr.id;
        this.maglevViews.set(tr.id, v);
      }
      v.seen = true;
      v.group.visible = true;
      v.group.position.set(0, 0, tr.z);
      v.railWarn.visible = true;
      const blink = 0.5 + 0.5 * Math.sin(t * (tr.state === 'warning' ? 22 : 36));
      v.railMat.opacity = tr.state === 'warning' ? 0.24 + tr.warningProgress * 0.45 + blink * 0.18 : 0.55;
      v.railMat.color.setHex(tr.state === 'warning' ? 0xff2a55 : 0x3ef3ff);
      if (tr.state === 'crossing') {
        v.train.visible = true;
        v.train.position.set(tr.trainX, 1.25, 0);
        v.train.scale.set(tr.dir, 1, 1);
        if (Math.abs(tr.trainX) < 12 && Math.random() < 0.7) {
          this.effects.streaks(tr.trainX, 0.9, tr.z, 0x62f4ff, 4, { speed: 18, len: 2.2, life: 0.2, coneBiasZ: 0 });
        }
      } else {
        v.train.visible = false;
      }
    }
    for (const [id, v] of this.maglevViews) {
      if (!v.seen) {
        v.group.visible = false;
        this.maglevPool.push(v);
        this.maglevViews.delete(id);
      }
    }
  }

  private updateV20PropsAndWeather(snap: SimSnapshot, t: number): void {
    const d = this.dummy;

    // 1. Polarity Mag-Rails (极性电磁滑轨)
    for (const v of this.magRailViews.values()) v.seen = false;
    for (const mr of snap.magRails ?? []) {
      let v = this.magRailViews.get(mr.id);
      if (!v) {
        const pooled = this.magRailPool.pop();
        if (pooled) {
          pooled.group.visible = true;
          v = pooled;
        } else {
          const group = new THREE.Group();
          const stripMat = additive(0x3ef3ff, 0.72, this.stripeTex);
          const deck = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), stripMat);
          deck.position.y = 0.048;
          const railGeo = new GeoBuilder()
            .add(box(0.14, 0.18, 1), 0x62f4ff, 2.8, { p: [-0.48, 0.1, 0] })
            .add(box(0.14, 0.18, 1), 0xb98cff, 2.8, { p: [0.48, 0.1, 0] })
            .build();
          const rails = new THREE.Mesh(railGeo, this.propMat);
          rails.name = 'rails';
          group.add(deck, rails);
          this.scene.add(group);
          v = { id: mr.id, group, stripMat, seen: true };
        }
        v.id = mr.id;
        this.magRailViews.set(mr.id, v);
      }
      v.seen = true;
      const len = Math.max(1.5, mr.length);
      const activeOnRail = Math.abs(snap.squadX - mr.x) <= mr.halfWidth + 0.5 && Math.abs(PLAYER_Z - mr.z) <= len * 0.5;
      v.group.position.set(mr.x, 0, mr.z);
      v.group.children[0]!.scale.set(mr.halfWidth * 2, len, 1);
      v.group.children[1]!.scale.set(mr.halfWidth * 2, 1, len);
      v.stripMat.opacity = (activeOnRail ? 0.82 : 0.44) + 0.16 * Math.sin(t * 16 + mr.id);
      if (v.stripMat.map) v.stripMat.map.offset.y = -t * 3.8;
    }
    for (const [id, v] of this.magRailViews) {
      if (!v.seen) {
        v.group.visible = false;
        this.magRailPool.push(v);
        this.magRailViews.delete(id);
      }
    }

    // 2. Overload Capacitor Towers (过载电容塔)
    for (const v of this.capTowerViews.values()) v.seen = false;
    for (const ct of snap.capTowers ?? []) {
      let v = this.capTowerViews.get(ct.id);
      if (!v) {
        const pooled = this.capTowerPool.pop();
        if (pooled) {
          pooled.group.visible = true;
          v = pooled;
        } else {
          const group = new THREE.Group();
          const pylonGeo = new GeoBuilder()
            .add(cyl(0.62, 0.85, 2.35, 6), 0x1c2b48, 0.2, { p: [0, 1.18, 0] })
            .add(tor(0.76, 0.08, 6, 18).rotateX(Math.PI / 2), 0x62f4ff, 2.6, { p: [0, 1.65, 0] })
            .add(tor(0.92, 0.07, 6, 18).rotateX(Math.PI / 2), 0xffd84a, 2.6, { p: [0, 0.85, 0] })
            .build();
          const pylon = new THREE.Mesh(pylonGeo, this.propMat);
          const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 0), additive(0x62f4ff, 0.95));
          core.position.y = 2.68;
          const fillMat = additive(0x62f4ff, 0.65);
          const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.42, 32).rotateX(-Math.PI / 2), fillMat);
          ring.position.y = 0.06;
          group.add(pylon, core, ring);
          this.scene.add(group);
          v = { id: ct.id, group, core, ring, fillMat, seen: true };
        }
        v.id = ct.id;
        this.capTowerViews.set(ct.id, v);
      }
      v.seen = true;
      v.group.visible = true;
      v.group.position.set(ct.x, 0, ct.z);
      const ratio = THREE.MathUtils.clamp(ct.charge / Math.max(1, ct.maxCharge), 0, 1);
      v.core.rotation.set(t * 2.5, t * 4.2, 0);
      v.core.scale.setScalar(0.85 + ratio * 0.72 + ct.hitPulse * 0.22);
      v.ring.scale.setScalar(0.95 + ratio * 0.65);
      v.fillMat.color.setHex(ratio > 0.75 ? 0xffdf58 : 0x62f4ff);
      v.fillMat.opacity = 0.35 + ratio * 0.55;
    }
    for (const [id, v] of this.capTowerViews) {
      if (!v.seen) {
        v.group.visible = false;
        this.capTowerPool.push(v);
        this.capTowerViews.delete(id);
      }
    }

    // 3. Dual-Color Phase Barrier Gates (双色相位屏障门)
    for (const v of this.phaseGateViews.values()) v.seen = false;
    for (const pg of snap.phaseGates ?? []) {
      let v = this.phaseGateViews.get(pg.id);
      if (!v) {
        const pooled = this.phaseGatePool.pop();
        if (pooled) {
          pooled.group.visible = true;
          v = pooled;
        } else {
          const group = new THREE.Group();
          const frameGeo = new GeoBuilder()
            .add(cyl(0.14, 0.18, 2.7, 8), 0x243456, 0.2, { p: [-2.15, 1.35, 0] })
            .add(cyl(0.14, 0.18, 2.7, 8), 0x243456, 0.2, { p: [2.15, 1.35, 0] })
            .add(box(4.5, 0.18, 0.22), 0x62f4ff, 2.4, { p: [0, 2.68, 0] })
            .build();
          const frame = new THREE.Mesh(frameGeo, this.propMat);
          const curtainMat = additive(0x3ef3ff, 0.44, this.stripeTex);
          const curtain = new THREE.Mesh(new THREE.PlaneGeometry(4.15, 2.45), curtainMat);
          curtain.position.y = 1.32;
          const signMat = new THREE.MeshBasicMaterial({ map: this.phaseEngTex, transparent: true, toneMapped: false, depthWrite: false });
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 0.88), signMat);
          sign.position.set(0, 3.22, 0.05);
          group.add(frame, curtain, sign);
          this.scene.add(group);
          v = { id: pg.id, group, curtainMat, signMat, polarity: '', seen: true };
        }
        v.id = pg.id;
        this.phaseGateViews.set(pg.id, v);
      }
      v.seen = true;
      v.group.position.set(pg.x, 0, pg.z);
      if (v.polarity !== pg.attune) {
        v.polarity = pg.attune;
        v.curtainMat.color.setHex(pg.attune === 'kinetic' ? 0xb98cff : 0x3ef3ff);
        v.signMat.map = pg.attune === 'kinetic' ? this.phaseKinTex : this.phaseEngTex;
        v.signMat.needsUpdate = true;
      }
      v.curtainMat.opacity = 0.34 + 0.14 * Math.sin(t * 12 + pg.id);
    }
    for (const [id, v] of this.phaseGateViews) {
      if (!v.seen) {
        v.group.visible = false;
        this.phaseGatePool.push(v);
        this.phaseGateViews.delete(id);
      }
    }

    // 4. 3D Magnetized Core Shards (single InstancedMesh draw call)
    let shardCount = 0;
    for (const cs of snap.coreShards ?? []) {
      if (shardCount >= 160) break;
      const bob = 0.52 + 0.14 * Math.sin(t * 9 + cs.id);
      d.position.set(cs.x, bob, cs.z);
      d.rotation.set(t * 3.6 + cs.id, t * 5.2, 0);
      const magnetized = Math.hypot(snap.squadX - cs.x, PLAYER_Z - cs.z) <= 4.2;
      d.scale.setScalar(magnetized ? 1.24 : 0.95);
      d.updateMatrix();
      this.shardDropInstMesh.setMatrixAt(shardCount, d.matrix);
      this.tmpColor.setHex(cs.value >= 2 ? 0xffe26a : 0x5ef6ff);
      this.shardDropInstMesh.setColorAt(shardCount, this.tmpColor);
      shardCount++;
    }
    this.shardDropInstMesh.count = shardCount;
    this.shardDropInstMesh.visible = shardCount > 0;
    if (shardCount > 0) {
      this.shardDropInstMesh.instanceMatrix.needsUpdate = true;
      if (this.shardDropInstMesh.instanceColor) this.shardDropInstMesh.instanceColor.needsUpdate = true;
    }

    // 5. Sector Dynamic Weather Anomaly (solar_emp / prism_tide / cryo_blizzard — single InstancedMesh draw call!)
    const weather = snap.weatherState ?? 'none';
    if (weather === 'none') {
      this.weatherMesh.count = 0;
      this.weatherMesh.visible = false;
    } else {
      const cap = this.qualityScale < 0.85 ? 120 : 200;
      const hexA = weather === 'solar_emp' ? 0xff9a2e : weather === 'prism_tide' ? 0xd875ff : 0x8ef4ff;
      const hexB = weather === 'solar_emp' ? 0xff3b5c : weather === 'prism_tide' ? 0x3ef3ff : 0xffffff;
      for (let i = 0; i < cap; i++) {
        const seed = (i * 73.137) % 1;
        const seed2 = (i * 31.719) % 1;
        const speedZ = weather === 'cryo_blizzard' ? 42 : weather === 'prism_tide' ? 28 : 22;
        const z = PLAYER_Z + 4 - (((t * speedZ + seed * 68) % 68));
        const sway = weather === 'cryo_blizzard' ? Math.sin(t * 3.5 + i) * 2.2 : Math.sin(t * 2.0 + i) * 0.9;
        const x = (seed2 - 0.5) * 22 + sway;
        const y = weather === 'solar_emp'
          ? 0.4 + ((t * 5.5 + seed * 9) % 8.5)
          : 0.6 + ((1 - ((t * 3.2 + seed2 * 8) % 8) / 8) * 8.2);
        d.position.set(x, y, z);
        d.rotation.set(weather === 'solar_emp' ? -Math.PI * 0.35 : 0.18, weather === 'cryo_blizzard' ? 0.28 : 0, 0);
        d.scale.set(1, 1, weather === 'cryo_blizzard' ? 1.45 : 0.95);
        d.updateMatrix();
        this.weatherMesh.setMatrixAt(i, d.matrix);
        this.tmpColor.setHex(i % 2 === 0 ? hexA : hexB);
        this.weatherMesh.setColorAt(i, this.tmpColor);
      }
      this.weatherMesh.count = cap;
      this.weatherMesh.visible = true;
      this.weatherMesh.instanceMatrix.needsUpdate = true;
      if (this.weatherMesh.instanceColor) this.weatherMesh.instanceColor.needsUpdate = true;
    }
  }

  private acquireSkyCargo(): SkyCargoView {
    const pooled = this.skyCargoPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    // Hexagonal glowing plasma cargo reactor container
    const crateGeo = new GeoBuilder()
      .add(cyl(0.95, 0.95, 1.38, 6), 0x1e2c4a, 0)
      .add(cyl(0.82, 0.82, 1.05, 6), 0x3ef3ff, 2.8)
      .add(tor(0.98, 0.08, 6, 6).rotateX(Math.PI / 2), 0xffc531, 2.4, { p: [0, 0.42, 0] })
      .add(tor(0.98, 0.08, 6, 6).rotateX(Math.PI / 2), 0xffc531, 2.4, { p: [0, -0.42, 0] })
      .add(oct(0.34), 0xffffff, 3.0, { p: [0, 0.82, 0] })
      .build();
    const crate = new THREE.Mesh(crateGeo, this.propMat);
    const droneGeo = new GeoBuilder()
      .add(box(2.2, 0.24, 2.2), 0x263859, 0)
      .add(oct(0.32), 0x3ef3ff, 2.8)
      .add(tor(0.55, 0.06, 5, 12).rotateX(Math.PI / 2), 0x62f4ff, 2.6, { p: [1.05, 0, 1.05] })
      .add(tor(0.55, 0.06, 5, 12).rotateX(Math.PI / 2), 0x62f4ff, 2.6, { p: [-1.05, 0, 1.05] })
      .add(tor(0.55, 0.06, 5, 12).rotateX(Math.PI / 2), 0x62f4ff, 2.6, { p: [1.05, 0, -1.05] })
      .add(tor(0.55, 0.06, 5, 12).rotateX(Math.PI / 2), 0x62f4ff, 2.6, { p: [-1.05, 0, -1.05] })
      .build();
    const drone = new THREE.Group();
    drone.add(new THREE.Mesh(droneGeo, this.propMat));
    const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8), additive(0x62f4ff, 0.85));
    const reticle = new THREE.Mesh(new THREE.RingGeometry(0.88, 1.0, 36).rotateX(-Math.PI / 2), additive(0xffc531, 0.68));
    const hpFill = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffd84a, depthTest: false, toneMapped: false }),
    );
    hpFill.renderOrder = 14;
    group.add(crate, drone, tether, reticle, hpFill);
    this.scene.add(group);
    return { id: 0, group, drone, crate, tether, reticle, hpFill, seen: true };
  }

  private acquireMaglev(): MaglevView {
    const pooled = this.maglevPool.pop();
    if (pooled) {
      pooled.group.visible = true;
      return pooled;
    }
    const group = new THREE.Group();
    const railMat = additive(0xff2a55, 0.55, this.stripeTex);
    const railWarn = new THREE.Mesh(new THREE.PlaneGeometry(34, 5.4).rotateX(-Math.PI / 2), railMat);
    railWarn.position.y = 0.06;

    // Sleek 3-Car Cyberpunk Maglev Bullet Train (+X nose direction)
    const trainGeo = new GeoBuilder()
      // Aerodynamic Lead Car + Glowing Cyan Cockpit Visor
      .add(box(7.8, 1.75, 2.35), 0xeaf6ff, 0, { p: [5.2, 0, 0] })
      .add(cone(1.22, 3.6, 6).rotateZ(-Math.PI / 2), 0x3ef3ff, 2.6, { p: [10.8, -0.08, 0] })
      .add(box(7.4, 0.36, 2.45), 0x3ef3ff, 2.9, { p: [5.2, 0.28, 0] })
      // Center Reactor Car
      .add(box(7.6, 1.72, 2.32), 0x22365e, 0, { p: [-3.1, 0, 0] })
      .add(box(7.2, 0.34, 2.44), 0xffc531, 2.8, { p: [-3.1, 0.28, 0] })
      // Tail Car + Twin Plasma Slipstream Thrusters
      .add(box(6.8, 1.68, 2.28), 0xeaf6ff, 0, { p: [-10.9, 0, 0] })
      .add(box(6.4, 0.34, 2.42), 0xff3b5c, 2.8, { p: [-10.9, 0.28, 0] })
      .build();
    const train = new THREE.Group();
    train.add(new THREE.Mesh(trainGeo, this.propMat));
    group.add(railWarn, train);
    this.scene.add(group);
    return { id: 0, group, railWarn, railMat, train, seen: true };
  }

  private updateDecalsAndWetLights(snap: SimSnapshot, dt: number, deltaScroll: number): void {
    // 1. Update scrolling & fading GPU-instanced battlefield decals
    const d = this.dummy;
    const decalCap = this.qualityScale < 0.85 ? 384 : MAX_DECALS;
    let count = 0;
    for (let i = 0; i < MAX_DECALS; i++) {
      if (count >= decalCap) break;
      const dec = this.decalPool[i]!;
      if (!dec.active) continue;
      dec.age += dt;
      dec.z += deltaScroll;
      if (dec.age >= dec.maxAge || dec.z > PLAYER_Z + 8) {
        dec.active = false;
        continue;
      }
      const lifeRatio = dec.age / dec.maxAge;
      const fade = lifeRatio > 0.65 ? (1 - lifeRatio) / 0.35 : 1.0;
      d.position.set(dec.x, 0.032, dec.z);
      d.rotation.set(0, dec.rot, 0);
      d.scale.set(dec.radius * 2, 1, dec.radius * 2);
      d.updateMatrix();
      this.decals.setMatrixAt(count, d.matrix);
      this.tmpColor.setRGB(dec.r, dec.g, dec.b);
      this.decals.setColorAt(count, this.tmpColor);
      const c4 = count * 4;
      this.decalDataArr[c4] = dec.kind;
      this.decalDataArr[c4 + 1] = fade;
      this.decalDataArr[c4 + 2] = (i % 17) / 17;
      this.decalDataArr[c4 + 3] = 0;
      count++;
    }
    this.decals.count = count;
    this.decals.visible = count > 0;
    if (count > 0) {
      this.decals.instanceMatrix.needsUpdate = true;
      this.decalDataAttr.needsUpdate = true;
      if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;
    }

    // 2. Populate 8 brightest real-time neon light sources for wet-bridge specular reflections!
    let li = 0;
    const pushLight = (x: number, z: number, radius: number, intensity: number, hex: number): void => {
      if (li >= 12) return;
      this.neonLightsUniform[li]!.set(x, z, radius, intensity);
      this.tmpColor.setHex(hex);
      this.neonColorsUniform[li]!.set(this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
      li++;
    };

    // Slot 0: Player Squad / Muzzle / Overdrive core reflection
    if (snap.squadCount > 0) {
      const sqHex = snap.overdriveTimer > 0 ? 0xffdf58 : WEAPON_COLOR[snap.weapon];
      pushLight(snap.squadX, PLAYER_Z - 0.8, 3.2, 0.42 + this.muzzleFlash * 0.36 + (snap.overdriveTimer > 0 ? 0.25 : 0), sqHex);
    }
    // Active Nuke Fireball reflection
    if ((snap.nukeBlastTimer ?? 0) > 0) {
      pushLight(snap.nukeTargetX ?? 0, snap.nukeTargetZ ?? -19.5, 14.0, 0.95, 0xffaa32);
    }
    // Active Maglev Crossing reflection
    for (const tr of snap.maglevTrains ?? []) {
      pushLight(tr.state === 'crossing' ? THREE.MathUtils.clamp(tr.trainX, -5, 5) : 0, tr.z, 5.5, tr.state === 'crossing' ? 0.72 : 0.42, tr.state === 'crossing' ? 0x3ef3ff : 0xff2a55);
    }
    // Active Sky-Cargo drop-zone reflection
    for (const c of snap.skyCargos ?? []) {
      if (c.z > -58 && c.z < PLAYER_Z + 2) pushLight(c.x, c.z, 4.2, 0.46, 0xffc531);
    }
    // Closest Gates (cast vivid emerald/crimson/gold neon reflections onto the wet deck!)
    for (const g of snap.gates) {
      if (li >= 12) break;
      if (!g.triggered && !g.dimmed && g.z > -62 && g.z < PLAYER_Z + 1) {
        const gHex = g.mutable ? 0xffc531 : g.polarity === 'positive' ? 0x19f5a8 : 0xff3b5c;
        pushLight(g.x, g.z, 3.8, 0.48, gHex);
      }
    }
    // Singularities or Vaults fill remaining slots
    for (const s of snap.singularities ?? []) {
      if (li >= 12) break;
      pushLight(s.x, s.z, 4.4, 0.55, 0xb98cff);
    }
    for (const v of snap.vaults) {
      if (li >= 12) break;
      if (!v.broken && v.z > -56 && v.z < PLAYER_Z) {
        pushLight(v.x, v.z, 3.0, 0.36, 0x62f4ff);
      }
    }
    if (snap.wingmanState) {
      const wmHex = snap.wingmanState.id === 'prism_mirror' ? 0x5ef6ff : snap.wingmanState.id === 'gravity_anchor' ? 0xc47dff : 0xffe26a;
      pushLight(snap.wingmanState.leftX, snap.wingmanState.leftZ, 3.6, 0.54, wmHex);
      pushLight(snap.wingmanState.rightX, snap.wingmanState.rightZ, 3.6, 0.54, wmHex);
    }
    for (const rf of snap.collapseRifts ?? []) {
      if (li >= 12) break;
      if (rf.z > -68 && rf.z < PLAYER_Z + 3) {
        pushLight(rf.x, rf.z, 4.8, 0.56, rf.kind === 'bridge_gap' ? 0x4ef6ff : 0xff4b78);
      }
    }
    for (const mr of snap.magRails ?? []) {
      if (li >= 12) break;
      if ((mr.z + mr.length * 0.5) > -68 && (mr.z - mr.length * 0.5) < PLAYER_Z + 3) {
        pushLight(mr.x, mr.z, 4.4, Math.abs(snap.squadX - mr.x) <= mr.halfWidth && Math.abs(PLAYER_Z - mr.z) <= mr.length * 0.5 ? 0.72 : 0.48, 0x3ef3ff);
      }
    }
    for (const ct of snap.capTowers ?? []) {
      if (li >= 12) break;
      if (ct.z > -68 && ct.z < PLAYER_Z + 3) {
        pushLight(ct.x, ct.z, 4.6, 0.48 + ct.charge * 0.42, ct.charge > 0.5 ? 0xffe26a : 0x62f4ff);
      }
    }
    this.activePointLightsCount = li;
    while (li < 12) {
      this.neonLightsUniform[li]!.set(0, -999, 1, 0);
      li++;
    }
  }

  // ---------------------------------------------------------------- boss
  private updateBoss(snap: SimSnapshot, dt: number, t: number): void {
    const b = snap.boss;
    for (const [id, view] of this.bossViews) {
      if (!b || b.id !== id) {
        view.root.visible = false;
        if (view.secondaryRoot) view.secondaryRoot.visible = false;
        view.pylons?.forEach((p) => (p.visible = false));
        view.beams?.forEach((p) => (p.visible = false));
      }
    }
    for (const h of this.hazardViews) h.group.visible = false;
    if (!b) {
      if (this.omegaBeamGroup) this.omegaBeamGroup.visible = false;
      if (this.bossShoulderPods) {
        for (const pod of this.bossShoulderPods) pod.visible = false;
      }
      if (this.bossBlend > 0) {
        this.bossBlend = Math.max(0, this.bossBlend - dt);
        const pal = SECTOR_META[this.sector].palette;
        (this.trackMat.uniforms.uEdge!.value as THREE.Color).set(pal.edge);
        this.railMat.color.set(pal.edge);
      }
      return;
    }
    this.bossBlend = Math.min(1, this.bossBlend + dt * 0.8);
    // Boss Phase & Break Visual Highway Shift: Phase 2/3 intensifies crimson-gold edge rails, Break window flashes cyan-gold!
    {
      const pal = SECTOR_META[this.sector].palette;
      const brk = (b.breakTimer ?? 0) > 0;
      const targetHex = brk ? 0x62f4ff : b.omegaOverdrive ? 0xffe052 : b.phase >= 3 ? 0xffcf40 : b.phase >= 2 ? 0xff4b78 : pal.edge;
      (this.trackMat.uniforms.uEdge!.value as THREE.Color).lerp(this.tmpColor.setHex(targetHex), Math.min(1, dt * 6));
      this.railMat.color.copy(this.trackMat.uniforms.uEdge!.value as THREE.Color);
    }
    if (this.omegaBeamGroup) {
      const bState = b.omegaBeamState ?? 'idle';
      if (b.active && (bState === 'charging' || bState === 'firing')) {
        this.omegaBeamGroup.visible = true;
        this.omegaBeamGroup.position.set(b.omegaBeamX ?? b.x, 0, b.z);
        this.omegaBeamWarn.visible = true;
        this.omegaBeamWarnMat.opacity = bState === 'charging' ? 0.35 + 0.35 * Math.sin(t * 28) : 0.72;
        if (this.omegaBeamWarnMat.map) this.omegaBeamWarnMat.map.offset.y = -t * 5.2;
        this.omegaBeamCore.visible = bState === 'firing' || (bState === 'charging' && (b.omegaBeamProgress ?? 0) > 0.78);
        const pulseW = bState === 'firing' ? 1.05 + 0.22 * Math.sin(t * 48) : 0.28;
        this.omegaBeamCore.scale.set(pulseW, 1, pulseW);
        this.omegaBeamCoreMat.color.setHex(bState === 'firing' ? 0xfff08a : 0xff4b78);
      } else {
        this.omegaBeamGroup.visible = false;
      }
    }

    const view = this.bossViews.get(b.id);
    if (view) {
      if (this.bossDeathT >= 0) this.bossDeathT += dt;
      const dying = !b.active;
      const show = !this.bossHidden;
      view.root.visible = show;

      const jitter = dying ? (Math.random() - 0.5) * 0.4 : 0;
      const intro = b.introProgress;
      const rise = -(1 - intro) * 4.5;
      const deathK = dying ? Math.max(0.25, 1 - this.bossDeathT * 0.25) : 1;
      const baseScale = (0.78 + 0.22 * intro) * deathK;
      const titanScale = b.titanScale ?? 1;
      const scale = baseScale * titanScale;

      view.root.position.set(b.x + jitter, rise, b.z + jitter);
      const squash = 1 + b.hitPulse * 0.07;
      view.root.scale.set(scale * squash, scale * (1 - b.hitPulse * 0.04), scale * squash);

      // Smoothly turn boss toward the squad
      const lookYaw = THREE.MathUtils.clamp((snap.squadX - b.x) * 0.06, -0.45, 0.45);
      view.primary.root.rotation.y += (lookYaw - view.primary.root.rotation.y) * Math.min(1, dt * 5);

      const rageSpeed = 1 + (b.phase - 1) * 0.22;
      const hazardCharging = b.hazardZones.some((hz) => hz.warningProgress > 0.55 || hz.firing);
      view.attackCooldown = Math.max(0, view.attackCooldown - dt);

      if (!dying) {
        if (b.id === 'warden_01') {
          if (hazardCharging && view.attackCooldown <= 0) {
            view.primary.play('Punch', { loop: false, fade: 0.1, timeScale: 1.15 * rageSpeed });
            view.attackCooldown = 1.3;
          } else if (view.attackCooldown <= 0.15) {
            view.primary.play('Fast_Flying', { timeScale: 0.95 * rageSpeed, fade: 0.2 });
          }
          if (view.halo) view.halo.rotation.z = t * 1.2;
        } else if (b.id === 'hydra_02') {
          if (hazardCharging && view.attackCooldown <= 0) {
            view.primary.play('Headbutt', { loop: false, fade: 0.1, timeScale: 1.2 * rageSpeed });
            view.secondary?.play('Headbutt', { loop: false, fade: 0.1, timeScale: 1.2 * rageSpeed });
            view.attackCooldown = 1.3;
          } else if (view.attackCooldown <= 0.15) {
            view.primary.play('Fast_Flying', { timeScale: 1.05 * rageSpeed, fade: 0.2 });
            view.secondary?.play('Fast_Flying', { timeScale: 1.12 * rageSpeed, fade: 0.2 });
          }
        } else if (b.id === 'omega_zero') {
          if (hazardCharging && view.attackCooldown <= 0) {
            view.primary.play('Weapon', { loop: false, fade: 0.1, timeScale: 1.15 * rageSpeed });
            view.attackCooldown = 1.1;
          } else if (view.attackCooldown <= 0.15) {
            view.primary.play(b.phase >= 2 ? 'Walk' : 'Idle', { timeScale: 1.05 * rageSpeed, fade: 0.2 });
          }
          if (view.halo) {
            view.halo.rotation.z = t * (0.9 + (b.phase - 1) * 0.7);
            view.halo.scale.setScalar(1 + Math.sin(t * 5) * 0.05);
          }
        }
      }

      const breakActive = (b.breakTimer ?? 0) > 0;
      const heatTintR = breakActive ? 0.85 : 1 + (b.phase - 1) * 0.08;
      const bossHitFlash =
        b.hitPulse > 0.55 ? (0.45 + 0.55 * Math.sin(t * 42)) * 0.16 : b.hitPulse * 0.14;
      const breakFlicker = breakActive ? 0.22 + 0.16 * Math.sin(t * 36) : 0;
      const flashVal = bossHitFlash + breakFlicker + (dying ? Math.random() * 0.35 : 0);
      view.primary.setVisuals(flashVal, heatTintR, breakActive ? 1.18 : 1, breakActive ? 1.32 : 1);

      // Render Destructible Tactical Subsystems (Left Cannon, Right Hive & Phase-2 Shield/Overload Reactor!)
      if (this.bossShoulderPods) {
        const parts = b.parts ?? [];
        for (let pi = 0; pi < this.bossShoulderPods.length; pi++) {
          const pod = this.bossShoulderPods[pi]!;
          const pt = parts[pi];
          if (pt && !pt.destroyed && show && !dying) {
            pod.visible = true;
            const podScaleK = baseScale * (1 + (titanScale - 1) * 0.52);
            const yOff = pt.slot === 'reactor' ? 3.15 : 2.15;
            pod.position.set(pt.x, rise + yOff * podScaleK + Math.sin(t * 3.8 + pi * 2) * 0.14, pt.z);
            pod.rotation.set(pt.slot === 'reactor' ? t * 1.8 : 0, pt.slot === 'reactor' ? t * 2.6 : Math.sin(t * 2 + pi) * 0.15, (pi === 0 ? -0.12 : pi === 1 ? 0.12 : 0));
            const tele = pt.telegraph ?? 0;
            const pScale = podScaleK * (1 + pt.hitPulse * 0.18 + tele * 0.12);
            pod.scale.setScalar(pScale);
            const ret = this.bossPodReticles?.[pi];
            if (ret) {
              ret.visible = tele > 0.06;
              if (ret.visible) {
                ret.rotation.z = t * (pi === 0 ? 5.5 : -5.5);
                const rPulse = 0.92 + tele * 0.36 + Math.sin(t * 20) * 0.08;
                ret.scale.setScalar(rPulse);
                const rMat = ret.material as THREE.MeshBasicMaterial;
                rMat.opacity = Math.min(0.95, 0.35 + tele * 0.6);
                rMat.color.setHex(tele > 0.65 ? 0xffd84a : pi === 0 ? 0xff3b5c : 0x3ef3ff);
              }
            }
          } else {
            pod.visible = false;
          }
        }
      }
      view.primary.update(dt);
      this.pushShadow(b.x, b.z, 2.35 * scale);

      view.shield.visible = show && b.shielded && b.active;
      view.shield.rotation.y = t * 0.8;
      view.shield.rotation.x = t * 0.35;
      (view.shield.material as THREE.MeshBasicMaterial).opacity =
        0.34 + Math.sin(t * 7) * 0.08 + b.hitPulse * 0.12;

      const sc = b.secondaryCore ?? null;
      if (view.secondary && view.secondaryRoot) {
        if (b.id === 'hydra_02' && !sc && show && !dying) {
          // Phase 1 Twin-Dragon presentation: Cyan twin hovers beside the Violet Elder Dragon before splitting!
          view.secondaryRoot.visible = true;
          view.secondaryRoot.position.set(
            b.x + 2.35 + Math.sin(t * 1.8) * 0.35,
            rise + 0.35,
            b.z - 1.35,
          );
          view.secondaryRoot.scale.setScalar(scale * 0.85);
          if (view.shield2) view.shield2.visible = false;
        } else {
          view.secondaryRoot.visible = Boolean(sc) && show;
          if (sc) {
            view.secondaryRoot.position.set(sc.x, rise, sc.z);
            view.secondaryRoot.scale.setScalar(scale);
            if (view.shield2) view.shield2.visible = sc.shielded;
            this.pushShadow(sc.x, sc.z, 1.85 * scale);
          }
        }
        view.secondary.setVisuals(flashVal * 0.85, 1, 1, 1);
        view.secondary.update(dt);
      }

      const coreY = rise + view.coreHeight * scale;
      if (view.pylons && view.beams) {
        for (let i = 0; i < view.pylons.length; i++) {
          const p = b.pylons[i];
          const pv = view.pylons[i]!;
          const beam = view.beams[i]!;
          if (p && !p.destroyed && b.active) {
            pv.visible = true;
            pv.position.set(p.x, 0, p.z);
            pv.children[0]!.rotation.y = t * 2;
            this.pushShadow(p.x, p.z, 1.05);
            const from = this.tmpA.set(p.x, 2.5, p.z);
            const to = this.tmpB.set(b.x, coreY, b.z);
            beam.position.copy(from);
            beam.lookAt(to);
            beam.scale.set(
              1 + Math.sin(t * 30) * 0.45,
              1 + Math.sin(t * 30) * 0.45,
              from.distanceTo(to),
            );
            beam.visible = true;
          } else {
            pv.visible = false;
            beam.visible = false;
          }
        }
      }
    }

    // Telegraphed hazard lanes
    for (let i = 0; i < b.hazardZones.length && i < this.hazardViews.length; i++) {
      const hz = b.hazardZones[i]!;
      const hv = this.hazardViews[i]!;
      hv.group.visible = true;
      const w = hz.halfWidth * 2;
      hv.group.position.set(hz.x, 0, hz.z);
      hv.fill.scale.set(w, 1, hz.depth);
      hv.fillMat.opacity = hz.firing ? 0.36 : 0.16 + hz.warningProgress * 0.22;
      const pz = Math.max(0.001, hz.warningProgress);
      hv.progress.scale.set(w, 1, hz.depth * pz);
      hv.progress.position.z = -hz.depth / 2 + (hz.depth * pz) / 2;
      hv.progressMat.opacity = hz.firing ? 0.68 : 0.4 + hz.warningProgress * 0.34;
      const map = hv.progressMat.map;
      if (map) map.offset.y = -t * 2.4;
      hv.edgeL.scale.set(0.16, 1, hz.depth);
      hv.edgeR.scale.set(0.16, 1, hz.depth);
      hv.edgeL.position.x = -hz.halfWidth;
      hv.edgeR.position.x = hz.halfWidth;
      hv.column.visible = hz.firing;
      if (hz.firing) {
        hv.column.scale.set(w * (0.85 + Math.random() * 0.12), 6.2, hz.depth);
        hv.column.position.y = 3.1;
        hv.columnMat.opacity = 0.16 + Math.random() * 0.07;
      }
    }
  }

  // ---------------------------------------------------------------- 3D Volumetric GLSL Tactical Nuke & Multi-Salvo Supernova Cloud
  private createNukeCloudShader(scrollSpeedY: number, heatBias: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uOpacity: { value: 1 },
        uScrollY: { value: scrollSpeedY },
        uHeatBias: { value: heatBias },
        uPalette: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uProgress;
        uniform float uScrollY;
        varying vec3 vLocalPos;
        varying vec3 vViewN;
        varying vec3 vViewDir;
        varying float vDisplace;

        float gyroid(vec3 p) {
          return dot(sin(p), cos(p.yzx));
        }

        void main() {
          vLocalPos = position;
          vec3 np = position * 1.65 + vec3(0.0, -uTime * uScrollY, uTime * 0.85);
          float n1 = gyroid(np);
          float n2 = gyroid(np * 2.35 + vec3(1.7, -uTime * uScrollY * 1.4, -1.2));
          float billow = (n1 * 0.58 + n2 * 0.32) * 0.5 + 0.5;
          vDisplace = clamp(billow, 0.0, 1.0);
          vec3 displaced = position + normal * ((billow - 0.35) * (0.26 + uProgress * 0.18));
          vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
          vViewN = normalize(normalMatrix * normal);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uProgress;
        uniform float uOpacity;
        uniform float uScrollY;
        uniform float uHeatBias;
        uniform float uPalette;
        varying vec3 vLocalPos;
        varying vec3 vViewN;
        varying vec3 vViewDir;
        varying float vDisplace;

        float gyroid(vec3 p) {
          return dot(sin(p), cos(p.yzx));
        }

        void main() {
          vec3 p = vLocalPos * 2.4 + vec3(0.0, -uTime * uScrollY * 1.35, uTime * 1.1);
          float f1 = gyroid(p) * 0.5 + 0.5;
          float f2 = gyroid(p * 2.6 - vec3(uTime * 0.9, uTime * uScrollY * 1.8, 0.0)) * 0.5 + 0.5;
          float f3 = gyroid(p * 5.2 + vec3(2.1, -uTime * 2.2, 1.4)) * 0.5 + 0.5;
          float turb = clamp(f1 * 0.50 + f2 * 0.32 + f3 * 0.18, 0.0, 1.0);

          float fresnel = 1.0 - clamp(dot(normalize(vViewN), normalize(vViewDir)), 0.0, 1.0);
          float coolFactor = clamp(uProgress * 0.58 + fresnel * 0.42 - uHeatBias, 0.0, 0.95);
          float heat = clamp(turb * 0.74 + (1.0 - vDisplace) * 0.44 - coolFactor * 0.50 + 0.24, 0.0, 1.0);

          vec3 darkAsh = vec3(0.14, 0.05, 0.11);
          vec3 midGlow = vec3(0.95, 0.18, 0.08);
          vec3 hiGlow = vec3(1.22, 0.58, 0.10);
          vec3 coreWhite = vec3(1.55, 1.40, 0.92);
          vec3 rimTint = vec3(1.10, 0.46, 0.14);

          if (uPalette > 0.5 && uPalette < 1.5) {
            // Salvo #2: Hyper-Ion Electric Cyan & Cobalt Super-Star
            darkAsh = vec3(0.04, 0.08, 0.22);
            midGlow = vec3(0.10, 0.38, 1.05);
            hiGlow = vec3(0.22, 1.12, 1.38);
            coreWhite = vec3(1.25, 1.55, 1.62);
            rimTint = vec3(0.24, 0.95, 1.35);
          } else if (uPalette >= 1.5) {
            // Salvo #3+: Antimatter Neon Magenta-Violet & Prismatic Gold Supernova
            darkAsh = vec3(0.16, 0.03, 0.24);
            midGlow = vec3(0.88, 0.12, 0.96);
            hiGlow = vec3(1.32, 0.36, 1.18);
            coreWhite = vec3(1.60, 1.42, 1.15);
            rimTint = vec3(1.25, 0.32, 1.15);
          }

          vec3 col = mix(darkAsh, midGlow, smoothstep(0.10, 0.42, heat));
          col = mix(col, hiGlow, smoothstep(0.38, 0.70, heat));
          col = mix(col, coreWhite, smoothstep(0.68, 0.95, heat));
          col += rimTint * pow(fresnel, 2.1) * (0.62 - uProgress * 0.25);

          gl_FragColor = vec4(col, uOpacity);
        }
      `,
      transparent: true,
      depthWrite: true,
      toneMapped: false,
    });
  }

  private buildNukeVisuals(): void {
    const reticleOuterGeo = new THREE.RingGeometry(8.2, 9.1, 56).rotateX(-Math.PI / 2);
    const reticleInnerGeo = new THREE.RingGeometry(3.1, 3.85, 6).rotateX(-Math.PI / 2);
    const crossGeo = new GeoBuilder()
      .add(box(17.5, 0.04, 0.22), 0xffffff, 1.8)
      .add(box(0.22, 0.04, 17.5), 0xffffff, 1.8)
      .build();
    const fillDiscGeo = new THREE.CircleGeometry(8.2, 40).rotateX(-Math.PI / 2);
    const lockBeamGeo = new THREE.CylinderGeometry(0.26, 1.55, 34, 18, 1, true);
    const pillarGeo = new THREE.CylinderGeometry(0.12, 0.24, 30, 8, 1, true);
    const helixGeo = new THREE.TorusGeometry(2.15, 0.13, 8, 28);
    const plumeGeo = new THREE.ConeGeometry(1.08, 5.4, 16);
    const plumeCoreGeo = new THREE.ConeGeometry(0.58, 3.5, 14);
    const machConeGeo = new THREE.ConeGeometry(2.15, 2.8, 20, 1, true);

    const warheadGeo = new GeoBuilder()
      .add(cyl(0.92, 1.02, 3.6, 16), 0x222938, 0.22, { p: [0, 0.45, 0] })
      .add(cone(1.02, 1.9, 16), 0xe02438, 0.65, { p: [0, -2.28, 0], r: [Math.PI, 0, 0] })
      .add(sph(0.36, 12, 10), 0xfff6b8, 2.8, { p: [0, -3.12, 0] })
      .add(cyl(1.06, 1.06, 0.44, 16), 0xffcf38, 1.95, { p: [0, -0.58, 0] })
      .add(cyl(1.01, 1.01, 0.38, 16), 0xff5522, 2.05, { p: [0, 1.02, 0] })
      .add(tor(1.08, 0.09, 6, 18), 0x62f4ff, 2.1, { r: [Math.PI / 2, 0, 0], p: [0, 0.22, 0] })
      .add(cyl(0.72, 0.92, 0.92, 14), 0x181d2c, 0.15, { p: [0, 2.62, 0] })
      .add(box(3.55, 1.58, 0.18), 0xe02438, 0.55, { p: [0, 2.52, 0] })
      .add(box(0.18, 1.58, 3.55), 0xffb830, 0.55, { p: [0, 2.52, 0] })
      .build();

    const scorchGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const craterRingGeo = new THREE.RingGeometry(0.72, 1.0, 48).rotateX(-Math.PI / 2);
    const shockWallGeo = new THREE.CylinderGeometry(1, 1, 2.8, 48, 1, true);
    const blastRing2Geo = new THREE.CylinderGeometry(1, 1.06, 3.8, 48, 1, true);
    const sunPillarGeo = new THREE.CylinderGeometry(1.2, 2.55, 44, 20, 1, true);
    const equatorHaloGeo = new THREE.RingGeometry(0.78, 1.0, 56).rotateX(-Math.PI / 2);
    const fireballGeo = new THREE.SphereGeometry(1, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.72);
    const coreDomeGeo = new THREE.SphereGeometry(0.72, 20, 14);
    const stemGeo = new THREE.CylinderGeometry(1.18, 2.65, 1, 26, 14, false);
    const capGeo = new THREE.TorusGeometry(2.75, 1.42, 22, 36).rotateX(Math.PI / 2);
    const crownGeo = new THREE.SphereGeometry(2.35, 28, 20);
    const vortexLowerGeo = new THREE.TorusGeometry(1.65, 0.24, 10, 32).rotateX(Math.PI / 2);
    const vortexUpperGeo = new THREE.TorusGeometry(3.55, 0.28, 12, 40).rotateX(Math.PI / 2);
    const machRingGeo = new THREE.RingGeometry(0.86, 1.0, 56).rotateX(-Math.PI / 2);
    const wilsonDomeGeo = new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.52);

    this.nukeDropPool = [];
    this.nukeBlastPool = [];
    const POOL_SLOTS = 4;

    for (let slot = 0; slot < POOL_SLOTS; slot++) {
      const dropGroup = new THREE.Group();
      dropGroup.visible = false;

      const reticleOuterMat = additive(0xff2a55, 0.85);
      const reticleOuter = new THREE.Mesh(reticleOuterGeo, reticleOuterMat);
      reticleOuter.position.y = 0.06;

      const reticleInnerMat = additive(0xffd84a, 0.92);
      const reticleInner = new THREE.Mesh(reticleInnerGeo, reticleInnerMat);
      reticleInner.position.y = 0.08;

      const crosshairMat = additive(0xffaa38, 0.68);
      const crosshair = new THREE.Mesh(crossGeo, crosshairMat);
      crosshair.position.y = 0.07;

      const fillMat = additive(0xff3020, 0.18);
      const fillDisc = new THREE.Mesh(fillDiscGeo, fillMat);
      fillDisc.position.y = 0.04;

      const lockBeamMat = additive(0xff7828, 0.36);
      const lockBeam = new THREE.Mesh(lockBeamGeo, lockBeamMat);
      lockBeam.position.y = 17;

      const helixRingAMat = additive(0x62f4ff, 0.76);
      const helixRingA = new THREE.Mesh(helixGeo, helixRingAMat);
      const helixRingBMat = additive(0xffd84a, 0.76);
      const helixRingB = new THREE.Mesh(helixGeo, helixRingBMat);

      const sweepPillars: THREE.Mesh[] = [];
      for (let i = 0; i < 4; i++) {
        const pil = new THREE.Mesh(pillarGeo, additive(i % 2 === 0 ? 0xff2a55 : 0xffd84a, 0.56));
        pil.position.y = 15;
        sweepPillars.push(pil);
        dropGroup.add(pil);
      }

      const warheadMesh = new THREE.Mesh(warheadGeo, this.propMat);
      const warheadOutline = new THREE.Mesh(warheadGeo, getOutlineMaterial(0.045));
      const plumeMat = additive(0xffa828, 0.9);
      const plume = new THREE.Mesh(plumeGeo, plumeMat);
      plume.position.y = 5.4;
      const plumeCore = new THREE.Mesh(plumeCoreGeo, additive(0xffffff, 0.96));
      plumeCore.position.y = 4.4;
      const machCone = new THREE.Mesh(machConeGeo, additive(0xfff0b8, 0.3));
      machCone.position.y = -0.9;

      const warhead = new THREE.Group();
      warhead.add(warheadMesh, warheadOutline, plume, plumeCore, machCone);
      dropGroup.add(fillDisc, reticleOuter, reticleInner, crosshair, lockBeam, helixRingA, helixRingB, warhead);
      this.scene.add(dropGroup);

      this.nukeDropPool.push({
        group: dropGroup,
        warhead,
        plumeMat,
        plume,
        reticleOuter,
        reticleOuterMat,
        reticleInner,
        reticleInnerMat,
        crosshair,
        crosshairMat,
        fillMat,
        lockBeam,
        lockBeamMat,
        helixRingA,
        helixRingAMat,
        helixRingB,
        helixRingBMat,
        sweepPillars,
      });

      const blastGroup = new THREE.Group();
      blastGroup.visible = false;

      const groundScorchMat = additive(0xff7a1a, 0.85, this.glowTex);
      const groundScorch = new THREE.Mesh(scorchGeo, groundScorchMat);
      groundScorch.position.y = 0.065;

      const craterRingMat = additive(0xffd84a, 0.8);
      const craterRing = new THREE.Mesh(craterRingGeo, craterRingMat);
      craterRing.position.y = 0.08;

      const shockWallMat = additive(0xffcf58, 0.88);
      const shockWall = new THREE.Mesh(shockWallGeo, shockWallMat);
      shockWall.position.y = 1.4;

      const blastRing2Mat = additive(0xff922b, 0.88);
      const blastRing2 = new THREE.Mesh(blastRing2Geo, blastRing2Mat);
      blastRing2.position.y = 1.9;

      const sunPillarMat = additive(0xfff6d2, 0.94);
      const sunPillar = new THREE.Mesh(sunPillarGeo, sunPillarMat);
      sunPillar.position.y = 22;

      const equatorHaloMat = additive(0xffe680, 0.9);
      const equatorHalo = new THREE.Mesh(equatorHaloGeo, equatorHaloMat);
      equatorHalo.position.y = 4.2;

      const fireballMat = additive(0xffb838, 0.85);
      const fireball = new THREE.Mesh(fireballGeo, fireballMat);

      const coreDomeMat = additive(0xffffff, 0.95);
      const coreDome = new THREE.Mesh(coreDomeGeo, coreDomeMat);

      const stemMat = this.createNukeCloudShader(3.2, 0.18);
      const stem = new THREE.Mesh(stemGeo, stemMat);

      const capMat = this.createNukeCloudShader(1.85, 0.22);
      const cap = new THREE.Mesh(capGeo, capMat);

      const crownMat = this.createNukeCloudShader(1.45, 0.30);
      const crown = new THREE.Mesh(crownGeo, crownMat);

      const vortexLowerMat = additive(0xff8c24, 0.8);
      const vortexLower = new THREE.Mesh(vortexLowerGeo, vortexLowerMat);

      const vortexUpperMat = additive(0xffe066, 0.84);
      const vortexUpper = new THREE.Mesh(vortexUpperGeo, vortexUpperMat);

      const machRingMat = additive(0xffffff, 0.84);
      const machRing = new THREE.Mesh(machRingGeo, machRingMat);

      const wilsonDomeMat = additive(0xd8f4ff, 0.38);
      const wilsonDome = new THREE.Mesh(wilsonDomeGeo, wilsonDomeMat);

      blastGroup.add(
        groundScorch,
        craterRing,
        shockWall,
        blastRing2,
        sunPillar,
        equatorHalo,
        fireball,
        coreDome,
        stem,
        cap,
        crown,
        vortexLower,
        vortexUpper,
        machRing,
        wilsonDome,
      );
      this.scene.add(blastGroup);

      this.nukeBlastPool.push({
        group: blastGroup,
        groundScorch,
        groundScorchMat,
        craterRing,
        craterRingMat,
        shockWall,
        shockWallMat,
        blastRing2,
        blastRing2Mat,
        sunPillar,
        sunPillarMat,
        equatorHalo,
        equatorHaloMat,
        fireball,
        fireballMat,
        coreDome,
        coreDomeMat,
        stem,
        stemMat,
        cap,
        capMat,
        crown,
        crownMat,
        vortexLower,
        vortexLowerMat,
        vortexUpper,
        vortexUpperMat,
        machRing,
        machRingMat,
        wilsonDome,
        wilsonDomeMat,
      });
    }
  }

  /** Triggers a cinema horizontal anamorphic lens flare streak around a 3D world event */
  triggerAnamorphicFlare(worldX: number, worldZ: number, strength = 0.85, salvoIdx = 1): void {
    const sc = this.shakeScale;
    this.nukeFlareAmt = Math.max(this.nukeFlareAmt, strength * Math.max(0.35, sc));
    const pIdx = (Math.max(1, salvoIdx) - 1) % 3;
    if (pIdx === 1) this.nukeTintVec.set(0.35, 1.08, 1.35);
    else if (pIdx === 2) this.nukeTintVec.set(1.28, 0.42, 1.32);
    else this.nukeTintVec.set(1.22, 0.82, 0.36);
    this.tmpV.set(worldX, 2.2, worldZ).project(this.camera);
    this.impactCenter.set(
      THREE.MathUtils.clamp(this.tmpV.x * 0.5 + 0.5, 0.16, 0.84),
      THREE.MathUtils.clamp(this.tmpV.y * 0.5 + 0.5, 0.20, 0.80),
    );
  }

  triggerNukeDetonationVfx(x: number, z: number, salvoIndex = 1): void {
    this.nukeJustDetonated = true;
    const chainEscalate = Math.min(1.32, 1.0 + (Math.max(1, salvoIndex) - 1) * 0.14);
    this.shake(1.0);
    this.triggerScreenQuake(2.65, chainEscalate);
    this.nukeWaveDur = 1.15;
    this.nukeWaveTimer = 1.15;
    this.nukeHeatAmt = Math.min(1.25, 1.0 + (salvoIndex - 1) * 0.12);
    this.triggerAnamorphicFlare(x, z, Math.min(1.35, 1.0 + (salvoIndex - 1) * 0.16), salvoIndex);
    this.kickCamera(1.18 * chainEscalate * this.shakeScale, (Math.random() - 0.5) * 1.6);

    const pIdx = (Math.max(1, salvoIndex) - 1) % 3;
    const colCore = pIdx === 1 ? 0xe0ffff : pIdx === 2 ? 0xffe6ff : 0xfff8d6;
    const colMid = pIdx === 1 ? 0x3ef3ff : pIdx === 2 ? 0xff42f5 : 0xffd84a;
    const colDeep = pIdx === 1 ? 0x2b68ff : pIdx === 2 ? 0x9b38ff : 0xff4820;

    const fx = this.effects;
    fx.ring(x, z, 0xffffff, 45, 0.78);
    fx.ring(x, z, colMid, 33, 1.12);
    fx.ring(x, z, colDeep, 24, 1.48);
    // Forward shockwaves sweeping directly past the squad & camera lens + horizon shockwaves!
    fx.after(0.09, () => fx.ring(x, z + 12, colCore, 28, 0.60));
    fx.after(0.20, () => fx.ring(x, z + 23, colMid, 34, 0.68));
    fx.after(0.11, () => fx.ring(x, z - 28, colMid, 32, 0.74));
    fx.after(0.22, () => fx.ring(x, z - 58, colDeep, 36, 0.80));
    fx.after(0.34, () => fx.ring(x, z - 88, colMid, 38, 0.84));
    fx.burst(x, 1.6, z, colCore, 155, { speed: 32, size: 1.22, life: 1.38, up: 1.65, gravity: 3.1 });
    fx.burst(x, 3.4, z, colMid, 150, { speed: 25, size: 1.08, life: 1.78, up: 1.98, gravity: 1.9 });
    fx.burst(x, 5.2, z, colDeep, 105, { speed: 19, size: 0.96, life: 2.1, up: 2.25, gravity: 1.05 });
    fx.shatter(x, 2.4, z, colMid, 38, true);
    // Secondary shockwave arrival ember cascade synced with Wave 2 camera slam!
    fx.after(0.26, () => {
      fx.burst(x, 5.6, z, colCore, 80, { speed: 24, size: 1.0, life: 1.4, up: 1.7, gravity: 1.7 });
      fx.shatter(x, 1.8, z + 10, colDeep, 24, true);
    });
  }

  private updateNukeVisuals(snap: SimSnapshot, dt: number, t: number): void {
    // Support full multi-salvo array (`snap.nukeStrikes`) with fallback to scalar fields
    const strikes =
      snap.nukeStrikes && snap.nukeStrikes.length > 0
        ? snap.nukeStrikes
        : (snap.nukeDropTimer ?? 0) > 0 || (snap.nukeBlastTimer ?? 0) > 0
          ? [
              {
                id: 1,
                x: snap.nukeTargetX ?? 0,
                z: snap.nukeTargetZ ?? -19.5,
                dropTimer: snap.nukeDropTimer ?? 0,
                dropDuration: Math.max(0.1, snap.nukeDropDuration ?? 1.15),
                blastTimer: snap.nukeBlastTimer ?? 0,
                blastDuration: 3.25,
                salvoIndex: 1,
              },
            ]
          : [];

    let dropSlotIdx = 0;
    let blastSlotIdx = 0;
    let maxTremor = 0;
    let peakThermalFlash = 0;
    let dominantPalette = 0;

    for (let sIdx = 0; sIdx < strikes.length; sIdx++) {
      const st = strikes[sIdx]!;
      const pIdx = (Math.max(1, st.salvoIndex) - 1) % 3;
      const cPrimary = pIdx === 1 ? 0x3ef3ff : pIdx === 2 ? 0xff3bf0 : 0xffd84a;
      const cSecondary = pIdx === 1 ? 0x2b68ff : pIdx === 2 ? 0x9b38ff : 0xff2a55;
      const cBeam = pIdx === 1 ? 0x62f4ff : pIdx === 2 ? 0xe05cff : 0xff7828;

      if (st.dropTimer > 0 && dropSlotIdx < this.nukeDropPool.length) {
        const slot = this.nukeDropPool[dropSlotIdx++]!;
        const dropDur = Math.max(0.1, st.dropDuration || 1.15);
        const p = THREE.MathUtils.clamp(1 - st.dropTimer / dropDur, 0, 1);
        const eased = 0.46 * p + 0.54 * p * p * p;
        const warheadY = 17.5 * (1 - eased) + 1.75;
        const tremor = p > 0.25 ? Math.pow((p - 0.25) / 0.75, 2) * 0.34 : 0;
        if (tremor > maxTremor) maxTremor = tremor;

        slot.group.visible = true;
        slot.group.position.set(st.x, 0, st.z);

        slot.reticleOuterMat.color.setHex(cSecondary);
        slot.reticleInnerMat.color.setHex(cPrimary);
        slot.crosshairMat.color.setHex(cPrimary);
        slot.fillMat.color.setHex(cSecondary);
        slot.lockBeamMat.color.setHex(cBeam);
        slot.plumeMat.color.setHex(cPrimary);

        slot.reticleOuter.rotation.z = t * 3.4 + sIdx;
        const pulse = 1 + Math.sin(t * 28 + sIdx * 1.7) * 0.08;
        slot.reticleOuter.scale.setScalar(pulse * (1.14 - p * 0.22));
        slot.reticleInner.rotation.z = -t * 5.6 - sIdx;
        slot.reticleInner.scale.setScalar(1.5 - p * 0.58);
        slot.crosshair.rotation.y = t * 2.2 + sIdx;
        slot.crosshair.scale.setScalar(1.18 - p * 0.3);
        slot.lockBeamMat.opacity = 0.30 + p * 0.48 + Math.sin(t * 42) * 0.1;

        // Twin helical plasma spirals corkscrewing down the orbital lock-on laser!
        const hProgA = (t * 2.6 + sIdx * 0.33) % 1.0;
        const hProgB = (t * 2.6 + 0.5 + sIdx * 0.33) % 1.0;
        slot.helixRingAMat.color.setHex(cPrimary);
        slot.helixRingAMat.opacity = Math.sin(hProgA * Math.PI) * (0.55 + p * 0.35);
        slot.helixRingA.position.y = 24 * (1 - hProgA) + 0.6;
        slot.helixRingA.rotation.set(Math.PI * 0.36, t * 7.5, 0.35);
        slot.helixRingA.scale.setScalar(0.55 + (1 - p) * 0.85);

        slot.helixRingBMat.color.setHex(cSecondary);
        slot.helixRingBMat.opacity = Math.sin(hProgB * Math.PI) * (0.55 + p * 0.35);
        slot.helixRingB.position.y = 24 * (1 - hProgB) + 0.6;
        slot.helixRingB.rotation.set(-Math.PI * 0.36, -t * 7.5, -0.35);
        slot.helixRingB.scale.setScalar(0.55 + (1 - p) * 0.85);

        const lockRadius = Math.max(0.32, (1 - p) * 8.2);
        for (let i = 0; i < slot.sweepPillars.length; i++) {
          const pil = slot.sweepPillars[i]!;
          const ang = t * 4.2 + (i * Math.PI) / 2 + sIdx * 0.8;
          pil.position.set(Math.cos(ang) * lockRadius, 15, Math.sin(ang) * lockRadius);
          const pilMat = pil.material as THREE.MeshBasicMaterial;
          pilMat.color.setHex(i % 2 === 0 ? cSecondary : cPrimary);
          pilMat.opacity = 0.28 + p * 0.56;
        }

        slot.warhead.position.set(0, warheadY, 0);
        slot.warhead.rotation.set(0.05 * Math.sin(t * 12), t * 5.2 + sIdx, 0.05 * Math.cos(t * 12));
        slot.warhead.scale.setScalar(1.82);
        slot.plume.scale.set(1 + Math.sin(t * 52) * 0.22, 1.05 + Math.sin(t * 62) * 0.32, 1 + Math.cos(t * 52) * 0.22);

        if (Math.random() < dt * 48) {
          this.effects.burst(st.x + (Math.random() - 0.5) * 0.5, warheadY + 4.0, st.z + (Math.random() - 0.5) * 0.5, cPrimary, 2, {
            speed: 4.5,
            size: 0.6,
            life: 0.44,
            up: 1.6,
            gravity: -2.4,
          });
        }
      }

      if (st.dropTimer <= 0 && st.blastTimer > 0 && blastSlotIdx < this.nukeBlastPool.length) {
        const bSlot = this.nukeBlastPool[blastSlotIdx++]!;
        const blastDur = Math.max(0.5, st.blastDuration || 3.25);
        const p = THREE.MathUtils.clamp(1 - st.blastTimer / blastDur, 0, 1);
        const fade = p < 0.62 ? 1 : Math.max(0, 1 - (p - 0.62) / 0.38);

        bSlot.group.visible = true;
        bSlot.group.position.set(st.x, 0, st.z);

        const thermalFlash = Math.max(0, 1 - p * 2.1);
        if (thermalFlash >= peakThermalFlash) {
          peakThermalFlash = thermalFlash;
          dominantPalette = pIdx;
        }

        const scorchScale = 15 + p * 25;
        bSlot.groundScorch.scale.set(scorchScale, scorchScale, 1);
        bSlot.groundScorchMat.color.setHex(cSecondary);
        bSlot.groundScorchMat.opacity = 0.88 * fade;

        const craterR = 5.2 + Math.pow(p, 0.4) * 13.5;
        bSlot.craterRing.scale.set(craterR, craterR, 1);
        bSlot.craterRingMat.color.setHex(cPrimary);
        bSlot.craterRingMat.opacity = Math.max(0, (1 - p * 1.15) * 0.86);

        const shockP = Math.min(1, p / 0.42);
        const shockR = 1.6 + Math.pow(shockP, 0.66) * 132.0;
        bSlot.shockWall.scale.set(shockR, Math.max(0.35, 2.1 - shockP * 1.45), shockR);
        bSlot.shockWallMat.opacity = p < 0.42 ? (1 - shockP) * 0.94 : 0;
        bSlot.shockWallMat.color.setHex(p < 0.11 ? 0xffffff : cPrimary);

        const shock2P = THREE.MathUtils.clamp((p - 0.06) / 0.42, 0, 1);
        const shock2R = 1.8 + Math.pow(shock2P, 0.68) * 102.0;
        bSlot.blastRing2.visible = p >= 0.06 && p < 0.48;
        bSlot.blastRing2.scale.set(shock2R, Math.max(0.28, 1.55 - shock2P * 1.05), shock2R);
        bSlot.blastRing2Mat.color.setHex(cSecondary);
        bSlot.blastRing2Mat.opacity = p >= 0.06 && p < 0.48 ? (1 - shock2P) * 0.88 : 0;

        // Heaven-Piercing Orbital Judgment Beam
        const pillarP = Math.min(1, p / 0.40);
        bSlot.sunPillar.visible = p < 0.40;
        const pillarRad = 0.85 + Math.sin(pillarP * Math.PI) * 2.75;
        bSlot.sunPillar.scale.set(pillarRad, 1.0 + pillarP * 0.35, pillarRad);
        bSlot.sunPillarMat.opacity = p < 0.40 ? Math.pow(1 - pillarP, 1.35) * 0.94 : 0;
        bSlot.sunPillarMat.color.setHex(p < 0.12 ? 0xffffff : cPrimary);

        // Tilted Planetary Equatorial Plasma Halo (anime planet-buster ring!)
        const eqP = Math.min(1, p / 0.55);
        const eqR = 3.2 + Math.pow(eqP, 0.52) * 32.0;
        bSlot.equatorHalo.visible = p < 0.55;
        const tiltDir = st.salvoIndex % 2 === 0 ? -1 : 1;
        bSlot.equatorHalo.position.y = 3.6 + p * 3.8;
        bSlot.equatorHalo.rotation.set(0.38 * tiltDir, t * 2.4 * tiltDir, -0.26 * tiltDir);
        bSlot.equatorHalo.scale.set(eqR, eqR, 1);
        bSlot.equatorHaloMat.color.setHex(p < 0.14 ? 0xffffff : cPrimary);
        bSlot.equatorHaloMat.opacity = p < 0.55 ? Math.pow(1 - eqP, 1.15) * 0.9 : 0;

        const fbRadius = p < 0.16 ? 2.6 + (p / 0.16) * 11.2 : 13.8 + (p - 0.16) * 4.8;
        const fbFade = Math.max(0, 1 - p * 1.82);
        bSlot.fireball.scale.set(fbRadius, fbRadius * 0.78, fbRadius);
        bSlot.fireballMat.opacity = 0.86 * fbFade;
        bSlot.fireballMat.color.setHex(p < 0.10 ? 0xffffff : cBeam);

        const capY = 3.4 + Math.pow(p, 0.48) * 10.8;
        const stemH = Math.max(1.4, capY - 0.35);
        bSlot.stem.scale.set(1.18 + p * 0.62, stemH, 1.18 + p * 0.62);
        bSlot.stem.position.y = stemH * 0.48;
        bSlot.stem.rotation.set(0, t * 2.1 + sIdx, 0);
        bSlot.stemMat.uniforms.uTime!.value = t + sIdx * 1.7;
        bSlot.stemMat.uniforms.uProgress!.value = p;
        bSlot.stemMat.uniforms.uOpacity!.value = 0.98 * fade;
        bSlot.stemMat.uniforms.uPalette!.value = pIdx;

        const capScale = 1.0 + Math.pow(p, 0.42) * 2.48;
        bSlot.cap.position.y = capY;
        bSlot.cap.scale.set(capScale * 1.30, capScale * 0.94, capScale * 1.30);
        bSlot.cap.rotation.set(0, -t * 1.3 - sIdx, 0);
        bSlot.capMat.uniforms.uTime!.value = t + sIdx * 1.7;
        bSlot.capMat.uniforms.uProgress!.value = p;
        bSlot.capMat.uniforms.uOpacity!.value = 0.99 * fade;
        bSlot.capMat.uniforms.uPalette!.value = pIdx;

        bSlot.crown.position.y = capY + 0.58 * capScale;
        bSlot.crown.scale.set(capScale * 1.44, capScale * 0.80, capScale * 1.44);
        bSlot.crown.rotation.set(0, t * 1.0 + sIdx, 0);
        bSlot.crownMat.uniforms.uTime!.value = t + sIdx * 1.7;
        bSlot.crownMat.uniforms.uProgress!.value = p * 0.82;
        bSlot.crownMat.uniforms.uOpacity!.value = 0.98 * fade;
        bSlot.crownMat.uniforms.uPalette!.value = pIdx;

        bSlot.coreDome.position.y = capY * 0.92;
        bSlot.coreDome.scale.setScalar(capScale * 2.12);
        bSlot.coreDomeMat.opacity = Math.max(0, (1 - p * 1.32) * 0.82) * fade;
        bSlot.coreDomeMat.color.setHex(p < 0.22 ? 0xffffff : cPrimary);

        const lowCycle = (p * 2.4 + sIdx * 0.25) % 1.0;
        bSlot.vortexLower.position.y = stemH * (0.20 + lowCycle * 0.65);
        bSlot.vortexLower.scale.setScalar(1.15 + lowCycle * 1.12 + p * 0.4);
        bSlot.vortexLower.rotation.set(0, t * 4.0, 0);
        bSlot.vortexLowerMat.color.setHex(cSecondary);
        bSlot.vortexLowerMat.opacity = Math.sin(lowCycle * Math.PI) * 0.86 * fade;

        bSlot.vortexUpper.position.y = capY - 0.36 * capScale;
        bSlot.vortexUpper.scale.setScalar(capScale * 1.28);
        bSlot.vortexUpper.rotation.set(0, -t * 3.0, 0);
        bSlot.vortexUpperMat.color.setHex(cPrimary);
        bSlot.vortexUpperMat.opacity = 0.84 * fade;

        const wilsonP = Math.min(1, p / 0.38);
        const wilsonR = 4.4 + wilsonP * 25.5;
        bSlot.wilsonDome.position.y = 0.2;
        bSlot.wilsonDome.scale.set(wilsonR, wilsonR * 0.76, wilsonR);
        bSlot.wilsonDomeMat.opacity = p < 0.38 ? Math.sin(wilsonP * Math.PI) * 0.56 : 0;

        const machR = 3.8 + p * 38.0;
        bSlot.machRing.position.y = capY * 0.82;
        bSlot.machRing.scale.set(machR, machR, 1);
        bSlot.machRingMat.color.setHex(cPrimary);
        bSlot.machRingMat.opacity = Math.max(0, (1 - p * 1.15) * 0.88);

        if (p < 0.82 && Math.random() < dt * 42) {
          const ang = Math.random() * Math.PI * 2;
          const rad = capScale * 3.0;
          this.effects.burst(st.x + Math.cos(ang) * rad, capY, st.z + Math.sin(ang) * rad, p < 0.35 ? cPrimary : cSecondary, 3, {
            speed: 6.8,
            size: 0.86,
            life: 0.74,
            up: 1.55,
            gravity: -1.6,
          });
        }
      }
    }

    // Hide unused pool slots
    for (let i = dropSlotIdx; i < this.nukeDropPool.length; i++) {
      this.nukeDropPool[i]!.group.visible = false;
    }
    for (let i = blastSlotIdx; i < this.nukeBlastPool.length; i++) {
      this.nukeBlastPool[i]!.group.visible = false;
    }

    this.nukeDescentTremor = maxTremor;
    if (blastSlotIdx > 0) {
      this.nukeBlastWasActive = true;
      this.hemi.intensity = 1.02 + peakThermalFlash * 2.05;
      if (this.dirLight) {
        this.dirLight.intensity = 1.45 + peakThermalFlash * 2.35;
      }
      if (this.scene.fog instanceof THREE.Fog) {
        this.nukeFogColor.setHex(dominantPalette === 1 ? 0x2ec8ff : dominantPalette === 2 ? 0xd946ff : 0xff9c42);
        this.scene.fog.color.copy(this.baseFogColor).lerp(this.nukeFogColor, peakThermalFlash * 0.65);
      }
    } else if (this.nukeBlastWasActive) {
      this.nukeBlastWasActive = false;
      this.hemi.intensity = 1.02;
      if (this.dirLight) this.dirLight.intensity = 1.45;
      if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(this.baseFogColor);
    }
  }

  // ---------------------------------------------------------------- V21 Verticality, Volumetric Ribbons, Reactor, Drops & Co-Boss
  private updateV21World(snap: SimSnapshot, dt: number, t: number): void {
    const d = this.dummy;

    // 1. Volumetric Refraction Ribbons (45° Reflectors, Golden Lenses, Phase Gates & Reactor Spokes)
    let ribIdx = 0;
    const pushRibbon = (x: number, y: number, z: number, yaw: number, width: number, length: number, hex: number): void => {
      if (ribIdx >= 56 || z < -92 || z > PLAYER_Z + 4) return;
      d.position.set(x + Math.sin(yaw) * (length * 0.5), y, z - Math.cos(yaw) * (length * 0.5));
      d.rotation.set(0, -yaw, 0);
      d.scale.set(width, 1, length);
      d.updateMatrix();
      this.refractRibbonMesh.setMatrixAt(ribIdx, d.matrix);
      this.tmpColor.setHex(hex).multiplyScalar(1.25 + 0.18 * Math.sin(t * 14 + ribIdx));
      this.refractRibbonMesh.setColorAt(ribIdx, this.tmpColor);
      ribIdx++;
    };

    for (const rf of snap.reflectors ?? []) {
      if (rf.z < -85 || rf.z > PLAYER_Z + 1) continue;
      const inLen = Math.min(14, Math.max(3.5, PLAYER_Z - rf.z));
      pushRibbon(rf.x, 0.72, rf.z + inLen, 0, 0.55, inLen, 0x62f4ff);
      const rad = ((rf.angleDeg || 36) * Math.PI) / 180;
      const bounceYaw = rad * 1.35;
      pushRibbon(rf.x, 0.76, rf.z, bounceYaw, 0.75 + rf.pulse * 0.45, 16.5, rf.pulse > 0.08 ? 0xffe46b : 0x7dff9b);
    }
    for (const ln of snap.lenses ?? []) {
      if (ln.z < -82 || ln.z > PLAYER_Z + 1) continue;
      pushRibbon(ln.x - 0.35, 0.68, ln.z, -0.24, 0.48, 11.5, 0xffdf6e);
      pushRibbon(ln.x + 0.35, 0.68, ln.z, 0.24, 0.48, 11.5, 0xffdf6e);
    }
    for (const pg of snap.phaseGates ?? []) {
      if (pg.z < -82 || pg.z > PLAYER_Z + 1) continue;
      const pHex = pg.attune === 'kinetic' ? 0xc59bff : 0x4ef6ff;
      pushRibbon(pg.x, 0.42, pg.z + 2.8, 0, 1.35, 5.6, pHex);
    }
    if ((snap.reactorPrismRingTimer ?? 0) > 0 && snap.squadCount > 0) {
      for (let s = 0; s < 4; s++) {
        const ang = t * 2.4 + (s * Math.PI) / 2;
        pushRibbon(snap.squadX + Math.cos(ang) * 1.4, 0.65 + (snap.squadAirY ?? 0), PLAYER_Z + Math.sin(ang) * 0.9, (s - 1.5) * 0.18, 0.38, 9.5, 0x72f8ff);
      }
    }
    const wmRef = snap.wingmanState;
    if (wmRef && wmRef.formation === 'forward_mirror' && snap.squadCount > 0) {
      pushRibbon(wmRef.leftX, 0.88 + (snap.squadAirY ?? 0), wmRef.leftZ, 0.34, 0.62, 13.5, 0x62f4ff);
      pushRibbon(wmRef.rightX, 0.88 + (snap.squadAirY ?? 0), wmRef.rightZ, -0.34, 0.62, 13.5, 0xffdf6e);
    }
    this.refractRibbonMesh.count = ribIdx;
    this.refractRibbonMesh.visible = ribIdx > 0;
    if (ribIdx > 0) {
      this.refractRibbonMesh.instanceMatrix.needsUpdate = true;
      if (this.refractRibbonMesh.instanceColor) this.refractRibbonMesh.instanceColor.needsUpdate = true;
    }

    // V23 Screen-Space Anamorphic Lens Flares at active Prisms, Lenses & Wingman Mirrors
    let flIdx = 0;
    const camQ = this.camera.quaternion;
    const pushFlare = (fx: number, fy: number, fz: number, wScale: number, hex: number): void => {
      if (flIdx >= 32 || fz < -78 || fz > PLAYER_Z + 3) return;
      d.position.set(fx, fy, fz);
      d.quaternion.copy(camQ);
      d.scale.set(wScale, wScale * 0.24, 1);
      d.updateMatrix();
      this.anamorphicFlareMesh.setMatrixAt(flIdx, d.matrix);
      this.tmpColor.setHex(hex);
      this.anamorphicFlareMesh.setColorAt(flIdx, this.tmpColor);
      flIdx++;
    };
    for (const rf of snap.reflectors ?? []) {
      pushFlare(rf.x, 1.05, rf.z, 2.8 + rf.pulse * 2.2, rf.pulse > 0.06 ? 0xffe678 : 0x62f4ff);
    }
    for (const ln of snap.lenses ?? []) {
      pushFlare(ln.x, 1.02, ln.z, 2.6 + (ln.pulse ?? 0) * 1.5, 0xffdf6e);
    }
    if (wmRef && wmRef.formation === 'forward_mirror' && snap.squadCount > 0) {
      pushFlare(wmRef.leftX, 1.02 + (snap.squadAirY ?? 0), wmRef.leftZ - 0.35, 2.4, 0x62f4ff);
      pushFlare(wmRef.rightX, 1.02 + (snap.squadAirY ?? 0), wmRef.rightZ - 0.35, 2.4, 0xffdf6e);
    }
    this.anamorphicFlareMesh.count = flIdx;
    this.anamorphicFlareMesh.visible = flIdx > 0;
    if (flIdx > 0) {
      this.anamorphicFlareMesh.instanceMatrix.needsUpdate = true;
      if (this.anamorphicFlareMesh.instanceColor) this.anamorphicFlareMesh.instanceColor.needsUpdate = true;
    }

    // 2. Collapse Rifts (磁悬浮断桥跃迁 & 侧翼坍缩裂谷)
    for (const v of this.collapseRiftViews.values()) v.seen = false;
    for (const rf of (snap.collapseRifts ?? []) as readonly CollapseRiftSnapshot[]) {
      let v = this.collapseRiftViews.get(rf.id);
      if (!v) {
        const pooled = this.collapseRiftPool.pop();
        if (pooled) {
          pooled.group.visible = true;
          v = pooled;
        } else {
          const group = new THREE.Group();
          const pit = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0x05030d, transparent: true, opacity: 0.92 }),
          );
          pit.position.y = 0.032;
          const rimMat = additive(0xff3868, 0.86, this.stripeTex);
          const rim = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.54, 4).rotateX(-Math.PI / 2).rotateY(Math.PI / 4), rimMat);
          rim.position.y = 0.055;
          const leapArc = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 6, 24, Math.PI), additive(0x62f4ff, 0.82));
          leapArc.rotation.y = Math.PI / 2;
          leapArc.position.y = 0.2;
          group.add(pit, rim, leapArc);
          this.scene.add(group);
          v = { id: rf.id, group, rimMat, leapArc, seen: true };
        }
        v.id = rf.id;
        this.collapseRiftViews.set(rf.id, v);
      }
      v.seen = true;
      v.group.position.set(rf.x, 0, rf.z);
      const w = rf.halfWidth * 2;
      const len = Math.max(1.8, rf.length);
      v.group.children[0]!.scale.set(w, len, 1);
      v.group.children[1]!.scale.set(w * 1.35, len * 1.35, 1);
      v.rimMat.color.setHex(rf.kind === 'bridge_gap' ? 0xff4b78 : 0xff9a28);
      v.rimMat.opacity = 0.62 + 0.24 * Math.sin(t * 12 + rf.id);
      v.leapArc.visible = rf.kind === 'bridge_gap';
      v.leapArc.scale.set(len * 0.48, 1.55 + 0.15 * Math.sin(t * 8), 1);
    }
    for (const [id, v] of this.collapseRiftViews) {
      if (!v.seen) {
        v.group.visible = false;
        this.collapseRiftPool.push(v);
        this.collapseRiftViews.delete(id);
      }
    }

    // 3. Elevated High-Ground Sniper Prism Spires (高台狙击棱塔, elevationY = 2.85m)
    for (const v of this.highSpireViews.values()) v.seen = false;
    for (const sp of (snap.highSpires ?? []) as readonly HighSpireSnapshot[]) {
      let v = this.highSpireViews.get(sp.id);
      if (!v) {
        const pooled = this.highSpirePool.pop();
        if (pooled) {
          pooled.group.visible = true;
          v = pooled;
        } else {
          const group = new THREE.Group();
          const colGeo = new GeoBuilder()
            .add(cyl(0.56, 0.92, 2.75, 6), 0x1a2d52, 0.28, { p: [0, 1.38, 0] })
            .add(cyl(1.05, 0.72, 0.28, 6), 0x2b4a80, 0.45, { p: [0, 2.78, 0] })
            .add(tor(0.98, 0.065, 6, 18), 0x62f4ff, 2.5, { p: [0, 2.82, 0], r: [Math.PI / 2, 0, 0] })
            .build();
          const column = new THREE.Mesh(colGeo, this.propMat);
          const turret = new THREE.Mesh(new THREE.OctahedronGeometry(0.58, 0), additive(0xffdf6e, 0.96));
          turret.position.y = 3.35;
          const domeMat = additive(0x4ef6ff, 0.48);
          const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(1.18, 1), domeMat);
          dome.position.y = 3.25;
          const laserMat = additive(0xff2a55, 0.78);
          const laser = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 1.0), laserMat);
          group.add(column, turret, dome, laser);
          this.scene.add(group);
          v = { id: sp.id, group, dome, domeMat, turret, laser, laserMat, seen: true };
        }
        v.id = sp.id;
        this.highSpireViews.set(sp.id, v);
      }
      v.seen = true;
      v.group.position.set(sp.x, 0, sp.z);
      v.turret.position.y = sp.elevationY + 0.48 + Math.sin(t * 4.5 + sp.id) * 0.12;
      v.turret.rotation.set(t * 2.2, t * 3.6, 0);
      const sScale = 1 + sp.hitPulse * 0.24 + sp.chargeProgress * 0.22;
      v.turret.scale.setScalar(sScale);
      v.dome.visible = sp.shieldRatio > 0;
      v.dome.position.y = sp.elevationY + 0.42;
      v.dome.rotation.y = -t * 1.6;
      v.domeMat.opacity = 0.30 + sp.shieldRatio * 0.26 + sp.hitPulse * 0.2;
      if (sp.chargeProgress > 0.15 && sp.z < PLAYER_Z - 1.5) {
        v.laser.visible = true;
        const dx = snap.squadX - sp.x;
        const dy = 0.9 - (sp.elevationY + 0.45);
        const dz = PLAYER_Z - sp.z;
        const dist = Math.hypot(dx, dy, dz);
        v.laser.position.set(dx * 0.5, sp.elevationY + 0.45 + dy * 0.5, dz * 0.5);
        v.laser.lookAt(snap.squadX, 0.9, PLAYER_Z);
        v.laser.scale.set(1 + sp.chargeProgress * 1.4, 1 + sp.chargeProgress * 1.4, dist);
        v.laserMat.opacity = 0.25 + sp.chargeProgress * 0.65;
        v.laserMat.color.setHex(sp.chargeProgress > 0.78 ? 0xffe26a : 0xff2a55);
      } else {
        v.laser.visible = false;
      }
    }
    for (const [id, v] of this.highSpireViews) {
      if (!v.seen) {
        v.group.visible = false;
        this.highSpirePool.push(v);
        this.highSpireViews.delete(id);
      }
    }

    // 4. Tactical Squad Formation Command Tethers (精英协同编队指挥节点光链)
    let ftIdx = 0;
    const leaders = new Map<number, { x: number; y: number; z: number; role: string }>();
    for (const e of snap.enemies) {
      if (e.formationId && e.isFormationLeader) {
        leaders.set(e.formationId, { x: e.x, y: 1.15, z: e.z, role: e.formationKind ?? 'aegis_refract' });
      }
    }
    if (leaders.size > 0) {
      for (const e of snap.enemies) {
        if (!e.formationId || e.isFormationLeader || ftIdx >= 24) continue;
        const ld = leaders.get(e.formationId);
        if (!ld) continue;
        const dx = e.x - ld.x;
        const dz = e.z - ld.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.2 || len > 14) continue;
        d.position.set(ld.x + dx * 0.5, 1.05, ld.z + dz * 0.5);
        d.rotation.set(0, Math.atan2(dx, dz), 0);
        d.scale.set(1.15, 1.0, len);
        d.updateMatrix();
        this.formationTetherMesh.setMatrixAt(ftIdx, d.matrix);
        this.tmpColor.setHex(ld.role === 'aegis_refract' ? 0x4ef6ff : 0xffb340);
        this.formationTetherMesh.setColorAt(ftIdx, this.tmpColor);
        ftIdx++;
      }
    }
    this.formationTetherMesh.count = ftIdx;
    this.formationTetherMesh.visible = ftIdx > 0;
    if (ftIdx > 0) {
      this.formationTetherMesh.instanceMatrix.needsUpdate = true;
      if (this.formationTetherMesh.instanceColor) this.formationTetherMesh.instanceColor.needsUpdate = true;
    }

    // 5. Core Reactor 3-Tier Awakening Orbiting Halo & Sweeping EMP Pulse Wall
    const rTier = snap.coreReactorTier ?? 0;
    if (rTier > 0 && snap.squadCount > 0) {
      this.reactorHaloGroup.visible = true;
      const ringActive = (snap.reactorPrismRingTimer ?? 0) > 0;
      const orbitR = snap.formationRadius + (ringActive ? 1.55 : 1.15);
      this.reactorHaloGroup.position.set(snap.squadX, 0.55 + (snap.squadAirY ?? 0), PLAYER_Z);
      const visCount = rTier * 2;
      for (let i = 0; i < this.reactorPrisms.length; i++) {
        const pm = this.reactorPrisms[i]!;
        pm.visible = i < visCount;
        if (pm.visible) {
          const ang = t * (ringActive ? 4.2 : 2.1) + (i / visCount) * Math.PI * 2;
          pm.position.set(Math.cos(ang) * orbitR, 0.35 + Math.sin(t * 5 + i) * 0.14, Math.sin(ang) * orbitR * 0.78);
          pm.rotation.set(t * 3, ang, 0);
          pm.scale.setScalar(ringActive ? 1.32 : 0.92);
        }
      }
    } else {
      this.reactorHaloGroup.visible = false;
    }

    if (snap.reactorWallZ !== null && snap.reactorWallZ !== undefined) {
      this.reactorWallMesh.visible = true;
      this.reactorWallMesh.position.set(0, 1.2, snap.reactorWallZ);
      this.reactorWallMat.opacity = 0.68 + 0.22 * Math.sin(t * 30);
    } else {
      this.reactorWallMesh.visible = false;
    }

    // 6. Dynamic Tactical Drop Events (限时战术空投信标 & 失控核心货运车 — Pooled & Shared Geometry)
    for (const v of this.tacticalEventViews.values()) v.seen = false;
    for (const ev of (snap.tacticalEvents ?? []) as readonly TacticalEventSnapshot[]) {
      let v = this.tacticalEventViews.get(ev.id);
      if (!v) {
        const idxPool = this.tacticalEventPool.findIndex((p) => p.kind === ev.kind);
        if (idxPool >= 0) {
          v = this.tacticalEventPool.splice(idxPool, 1)[0]!;
          v.group.visible = true;
        } else {
          const group = new THREE.Group();
          const isBeacon = ev.kind === 'supply_beacon';
          if (isBeacon && !this.sharedBeaconGeo) {
            this.sharedBeaconGeo = new GeoBuilder()
              .add(cyl(0.45, 0.62, 1.45, 8), 0x1d3b66, 0.35, { p: [0, 0.72, 0] })
              .add(new THREE.OctahedronGeometry(0.46, 0), 0x62f4ff, 2.4, { p: [0, 1.78, 0] })
              .build();
          } else if (!isBeacon && !this.sharedCartGeo) {
            this.sharedCartGeo = new GeoBuilder()
              .add(box(1.55, 0.78, 2.15), 0x3b2c14, 0.35, { p: [0, 0.58, 0] })
              .add(box(1.12, 0.62, 1.25), 0xffcf40, 2.2, { p: [0, 1.18, 0] })
              .build();
          }
          const core = new THREE.Mesh(isBeacon ? this.sharedBeaconGeo! : this.sharedCartGeo!, this.propMat);
          const ringMat = additive(isBeacon ? 0x3ef3ff : 0xffdf58, 0.78);
          const ring = new THREE.Mesh(new THREE.RingGeometry(isBeacon ? 1.85 : 1.25, isBeacon ? 2.15 : 1.52, 36).rotateX(-Math.PI / 2), ringMat);
          ring.position.y = 0.06;
          group.add(core, ring);
          this.scene.add(group);
          v = { id: ev.id, kind: ev.kind, group, core, ring, ringMat, seen: true };
        }
        v.id = ev.id;
        this.tacticalEventViews.set(ev.id, v);
      }
      v.seen = true;
      v.group.visible = true;
      v.group.position.set(ev.x, 0, ev.z);
      v.core.rotation.y = ev.kind === 'supply_beacon' ? t * 2.2 : Math.sin(t * 8) * 0.08;
      v.core.scale.setScalar(1 + ev.captureProgress * 0.22);
      v.ring.scale.setScalar(1 + 0.08 * Math.sin(t * 10));
      v.ringMat.opacity = 0.45 + ev.captureProgress * 0.48;
    }
    for (const [id, v] of this.tacticalEventViews) {
      if (!v.seen) {
        v.group.visible = false;
        this.tacticalEventPool.push(v);
        this.tacticalEventViews.delete(id);
      }
    }

    // 7. Pantheon Stage-4 Simultaneous Dual-Boss Co-Boss
    const co = (snap.pantheonCoBoss ?? null) as PantheonCoBossSnapshot | null;
    if (co && co.active) {
      this.coBossGroup.visible = true;
      this.coBossGroup.position.set(co.x, 0, co.z);
      const sc = 0.92 + co.hitPulse * 0.08;
      this.coBossGroup.scale.set(sc, sc, sc);
      this.coBossShield.visible = co.shielded;
      this.coBossShield.rotation.y = -t * 1.1;
      this.coBossHalo.rotation.z = -t * 1.6;
      if (this.coBossActor) {
        this.coBossActor.setVisuals(co.hitPulse * 0.24, 1.12, 0.96, 1.08);
        this.coBossActor.update(dt);
      }
      this.pushShadow(co.x, co.z, 2.15);
    } else {
      this.coBossGroup.visible = false;
    }
  }

  private updateCodexStageAfterCamera(dt: number, t: number): void {
    if (!this.codexStageGroup || !this.codexPreviewSpec || !this.codexStageGroup.visible) return;
    this.codexYaw += dt * 0.65;
    const fwd = this.tmpV.set(0, 1.48, -8.65).applyQuaternion(this.camera.quaternion);
    this.codexStageGroup.position.copy(this.camera.position).add(fwd);
    this.codexStageGroup.scale.setScalar(0.68);
    this.codexStageGroup.rotation.set(0.16, this.codexYaw, 0);
    this.codexPedestal.rotation.y = -this.codexYaw * 1.5 + t * 0.8;
  }

  // ---------------------------------------------------------------- AAA Dynamic Camera State Machine
  private updateCamera(snap: SimSnapshot, dt: number, cinematic: boolean): void {
    if (this.photoModeState && this.photoModeState.active) {
      this.screenShakeOut.x = 0;
      this.screenShakeOut.y = 0;
      this.screenShakeOut.rotDeg = 0;
      this.screenShakeOut.scale = 1;
      const pm = this.photoModeState;
      const focusX = snap.squadX * 0.45;
      const focusY = 1.15 + (snap.squadAirY ?? 0) * 0.4;
      const focusZ = snap.boss?.active ? -5.5 : PLAYER_Z - 6.5;
      const dist = 14.5;
      const pitchRad = (THREE.MathUtils.clamp(pm.pitch, -20, 68) * Math.PI) / 180;
      const yawRad = (pm.yaw * Math.PI) / 180;
      const horiz = Math.cos(pitchRad) * dist;
      this.camera.position.set(
        focusX + Math.sin(yawRad) * horiz,
        Math.max(0.55, focusY + Math.sin(pitchRad) * dist),
        focusZ + Math.cos(yawRad) * horiz,
      );
      this.camera.lookAt(focusX, focusY, focusZ);
      const clampedFov = THREE.MathUtils.clamp(pm.fov, 28, 82);
      if (Math.abs(this.camera.fov - clampedFov) > 0.05) {
        this.camera.fov = clampedFov;
        this.camera.updateProjectionMatrix();
      }
      return;
    }
    const safeDt = Math.max(dt, 0.001);
    const followAlpha = 1 - Math.exp(-safeDt * 6.0);
    const rawVx = (snap.squadX - this.prevSquadXForCam) / safeDt;
    this.prevSquadXForCam = snap.squadX;

    // 1. Fighter-jet lateral banking roll proportional to strafe velocity
    const targetBank = THREE.MathUtils.clamp(-rawVx * 0.0042, -0.048, 0.048);
    this.camBankRoll += (targetBank - this.camBankRoll) * (1 - Math.exp(-safeDt * 10));

    // Advance nuclear shockwave ripple, thermal heat glow & multi-wave seismic quake timers
    if (this.nukeWaveTimer > 0) {
      this.nukeWaveTimer = Math.max(0, this.nukeWaveTimer - dt);
    }
    if (this.nukeHeatAmt > 0) {
      this.nukeHeatAmt *= Math.exp(-safeDt * 1.45);
      if (this.nukeHeatAmt < 0.003) this.nukeHeatAmt = 0;
    }
    if (this.nukeFlareAmt > 0) {
      this.nukeFlareAmt *= Math.exp(-safeDt * 3.8);
      if (this.nukeFlareAmt < 0.003) this.nukeFlareAmt = 0;
    }

    let nukeQuakeAmp = 0;
    let nukeFovPunch = 0;
    let nukeElapsed = 0;
    if (this.nukeQuakeTimer > 0) {
      this.nukeQuakeTimer = Math.max(0, this.nukeQuakeTimer - dt);
      nukeElapsed = Math.max(0, this.nukeQuakeDur - this.nukeQuakeTimer);
      // 4-Wave Seismic Envelope:
      //  Wave 1: Ground-zero impact slam (0.00s..0.55s)
      //  Wave 2: Hypersonic shockwave arrival slam right after initial flash clears (peaks @ 0.28s!)
      //  Wave 3: Mushroom cloud tectonic aftershock #1 (peaks @ 0.78s)
      //  Wave 4: Deep rumbling tectonic tail (peaks @ 1.45s -> 2.65s)
      const w1 = Math.exp(-nukeElapsed * 3.8) * 1.15;
      const d2 = (nukeElapsed - 0.28) / 0.16;
      const w2 = Math.exp(-d2 * d2) * 1.05;
      const d3 = (nukeElapsed - 0.78) / 0.24;
      const w3 = Math.exp(-d3 * d3) * 0.48;
      const d4 = (nukeElapsed - 1.45) / 0.42;
      const w4 = Math.exp(-d4 * d4) * 0.24;
      const fadeOut = this.nukeQuakeTimer < 0.35 ? this.nukeQuakeTimer / 0.35 : 1;
      nukeQuakeAmp = Math.min(1.45, (w1 + w2 + w3 + w4) * this.nukeQuakeStrength * fadeOut);
      // Dynamic FOV blast punch: brief vacuum pinch -> wide-angle shockwave blowout!
      if (nukeElapsed < 0.12) {
        nukeFovPunch = -5.0 * (1 - nukeElapsed / 0.12) * this.nukeQuakeStrength;
      } else {
        nukeFovPunch = 9.5 * Math.exp(-(nukeElapsed - 0.12) * 3.2) * this.nukeQuakeStrength;
      }
      if (this.nukeQuakeTimer <= 0) {
        this.nukeQuakeStrength = 0;
      }
    }

    // 2. Speed/Overdrive/Airborne Dynamic FOV + Chromatic Shockwave Decay + Nuclear Blast Punch
    const airY = snap.squadAirY ?? 0;
    const descentZoom = this.nukeDescentTremor > 0 ? -this.nukeDescentTremor * 9.5 : 0;
    const targetFovOff =
      (snap.overdriveTimer > 0 ? 5.2 : 0) +
      (airY > 0.1 ? Math.min(6.2, airY * 2.2) : 0) +
      (snap.blitzActive ? 2.0 : 0) +
      nukeFovPunch * this.shakeScale +
      descentZoom -
      (this.shockwaveAmt > 0.25 ? this.shockwaveAmt * 2.4 : 0) -
      (this.phaseCamTimer > 0 ? Math.sin((1 - this.phaseCamTimer / this.phaseCamDur) * Math.PI) * 6.2 : 0);
    this.dynFovOffset += (targetFovOff - this.dynFovOffset) * (1 - Math.exp(-safeDt * 9.5));
    const desiredFov = THREE.MathUtils.clamp(this.fov + this.dynFovOffset, 42, 78);
    if (Math.abs(this.camera.fov - desiredFov) > 0.03) {
      this.camera.fov = desiredFov;
      this.camera.updateProjectionMatrix();
    }
    this.shockwaveAmt *= Math.exp(-safeDt * 6.5);
    if (this.shockwaveAmt < 0.002) this.shockwaveAmt = 0;
    this.chromaAmt *= Math.exp(-safeDt * 4.8);
    if (this.chromaAmt < 0.0002) this.chromaAmt = 0;
    this.radialBlurAmt *= Math.exp(-safeDt * 4.5);
    if (this.radialBlurAmt < 0.001) this.radialBlurAmt = 0;

    let phaseZoomBell = 0;
    if (this.phaseCamTimer > 0) {
      this.phaseCamTimer = Math.max(0, this.phaseCamTimer - safeDt);
      const prog = 1 - this.phaseCamTimer / this.phaseCamDur;
      phaseZoomBell = Math.sin(prog * Math.PI);
    }
    if (this.execCamTimer > 0) {
      this.execCamTimer = Math.max(0, this.execCamTimer - safeDt);
      const eProg = 1 - this.execCamTimer / this.execCamDur;
      phaseZoomBell = Math.max(phaseZoomBell, Math.sin(eProg * Math.PI) * 1.38);
    }
    let awakenOrbitX = 0;
    if (this.awakenCamTimer > 0) {
      this.awakenCamTimer = Math.max(0, this.awakenCamTimer - safeDt);
      const aProg = 1 - this.awakenCamTimer / this.awakenCamDur;
      const aBell = Math.sin(aProg * Math.PI);
      phaseZoomBell = Math.max(phaseZoomBell, aBell * 1.12);
      awakenOrbitX = Math.sin(aProg * Math.PI * 2) * 1.48 * aBell;
      this.splitToneAmt = aBell * 0.85;
    } else if (this.splitToneAmt > 0.001) {
      this.splitToneAmt *= Math.exp(-safeDt * 7.0);
    }

    this.camX += (snap.squadX * 0.35 - this.camX) * followAlpha;
    const kickDecay = Math.exp(-safeDt * 11.5);
    this.camKickZ *= kickDecay;
    this.camKickRoll *= kickDecay;

    const bb = this.bossBlend;
    const y = CAM_BASE_Y + bb * 1.65 - phaseZoomBell * 1.35 + airY * 0.38 + (cinematic ? 1.1 : 0) - this.camKickZ * 0.18;
    const z = CAM_BASE_Z + bb * 1.9 - phaseZoomBell * 3.6 + (snap.overdriveTimer > 0 ? 0.45 : 0) + (cinematic ? 1.4 : 0) + this.camKickZ;
    this.trauma = Math.max(0, this.trauma - dt * 1.85);
    const sh = this.trauma * this.trauma;

    // Multi-octave seismic harmonic oscillators for true physical shockwave vibration
    const totalQuake = Math.min(1.5, nukeQuakeAmp + this.nukeDescentTremor) * this.shakeScale;
    const qt = this.time;
    const oscX = Math.sin(qt * 53.0) * 0.52 + Math.sin(qt * 27.4 + 1.1) * 0.34 + Math.cos(qt * 13.7 + 2.3) * 0.14;
    const oscY = Math.cos(qt * 47.0 + 0.7) * 0.50 + Math.sin(qt * 23.1 + 2.0) * 0.36 + Math.sin(qt * 11.3) * 0.14;
    const oscZ = Math.sin(qt * 37.0 + 0.4) * 0.6 + Math.cos(qt * 19.2) * 0.4;
    const oscRoll = Math.sin(qt * 31.0 + 0.5) * 0.62 + Math.cos(qt * 15.8 + 1.7) * 0.38;

    const sx = (Math.random() - 0.5) * sh * 1.18 + oscX * totalQuake * 1.38;
    const sy = (Math.random() - 0.5) * sh * 0.86 + oscY * totalQuake * 1.08;
    const sz = oscZ * totalQuake * 0.92;
    const lookQx = oscX * totalQuake * 0.92 + (Math.random() - 0.5) * sh * 0.32;
    const lookQy = oscY * totalQuake * 0.78 + (Math.random() - 0.5) * sh * 0.24;
    const rollQuake = oscRoll * totalQuake * 0.082 + (Math.random() - 0.5) * sh * 0.026;

    // Synchronized viewport CSS seismic shake (scaled by shakeScale, overscan zoom eliminates edge gaps)
    if (!cinematic && (totalQuake > 0.008 || sh > 0.18)) {
      const domAmp = totalQuake + Math.max(0, sh - 0.18) * 0.28;
      this.screenShakeOut.x = oscX * 16.5 * totalQuake + (Math.random() - 0.5) * sh * 5.0;
      this.screenShakeOut.y = oscY * 13.5 * totalQuake + (Math.random() - 0.5) * sh * 4.2;
      this.screenShakeOut.rotDeg = oscRoll * 1.95 * totalQuake + (Math.random() - 0.5) * sh * 0.35;
      this.screenShakeOut.scale = 1 + Math.min(0.058, domAmp * 0.044);
    } else {
      this.screenShakeOut.x = 0;
      this.screenShakeOut.y = 0;
      this.screenShakeOut.rotDeg = 0;
      this.screenShakeOut.scale = 1;
    }

    if (this.replayCameraMode === 'tactical_top' && !cinematic) {
      this.camera.position.set(this.camX * 0.45 + sx, y + 9.2 + sy, z + 3.2 + sz);
      this.camera.lookAt(this.camX * 0.35 + lookQx, lookQy, -16.5 - bb * 2.5);
    } else if (this.replayCameraMode === 'action_closeup' && !cinematic) {
      this.camera.position.set(snap.squadX * 0.72 + sx, y - 2.35 + airY * 0.5 + sy, z - 3.4 + sz);
      this.camera.lookAt(snap.squadX * 0.42 + lookQx, 1.05 + airY * 0.35 + lookQy, -13.5 - bb * 3.0);
      this.camera.rotation.z += this.camBankRoll * 1.45 + this.camKickRoll + rollQuake;
    } else {
      this.camera.position.set(this.camX + awakenOrbitX + sx, y + sy, z + sz);
      this.camera.lookAt(this.camX * 0.56 + lookQx, 0.3 + airY * 0.25 + lookQy, -8.4 - bb * 2.2);
      this.camera.rotation.z += this.camBankRoll + this.camKickRoll + rollQuake;
    }
  }

  private buildV22Visuals(): void {
    // 1. Twin Tactical Drone Wingmen (left & right cyber wingmen + deployable 45-degree laser mirror fins)
    const makeDrone = (isRight: boolean): { group: THREE.Group; mirror: THREE.Mesh; coreMat: THREE.MeshBasicMaterial } => {
      const group = new THREE.Group();
      const bodyGeo = new GeoBuilder()
        .add(oct(0.32), 0xffffff, 2.4, { p: [0, 0, 0] })
        .add(box(1.18, 0.06, 0.34), 0x1d3b6b, 0.45, { p: [0, 0, 0.08], r: [0, 0, isRight ? -0.14 : 0.14] })
        .add(cone(0.14, 0.46, 6).rotateX(Math.PI / 2), 0x62f4ff, 2.2, { p: [0, 0, 0.32] })
        .build();
      const body = new THREE.Mesh(bodyGeo, this.propMat);
      const coreMat = additive(0x5ef6ff, 0.92);
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.54, 6).rotateX(-Math.PI / 2), coreMat);
      halo.position.y = -0.12;
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.78, 0.06), additive(0x7dff9b, 0.72, this.reflectorTex));
      mirror.position.set(0, -0.05, -0.45);
      mirror.visible = false;
      group.add(body, halo, mirror);
      group.visible = false;
      this.scene.add(group);
      return { group, mirror, coreMat };
    };
    const wl = makeDrone(false);
    const wr = makeDrone(true);
    this.wingmanLeftGroup = wl.group;
    this.wingmanLeftMirror = wl.mirror;
    this.wingmanCoreMatL = wl.coreMat;
    this.wingmanRightGroup = wr.group;
    this.wingmanRightMirror = wr.mirror;
    this.wingmanCoreMatR = wr.coreMat;

    // 2. Core Reactor Tier-3 Awakening Holographic Energy Mandala
    this.reactorMandalaGroup = new THREE.Group();
    this.reactorMandalaMat = additive(0xffdf58, 0.78);
    this.reactorMandalaOuter = new THREE.Mesh(
      new THREE.RingGeometry(2.35, 2.68, 6).rotateX(-Math.PI / 2),
      this.reactorMandalaMat,
    );
    this.reactorMandalaInner = new THREE.Mesh(
      new THREE.RingGeometry(1.42, 1.72, 8).rotateX(-Math.PI / 2),
      additive(0x62f4ff, 0.74),
    );
    const crossSpoke = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 0.16).rotateX(-Math.PI / 2),
      additive(0xffe885, 0.58),
    );
    const crossSpokeB = crossSpoke.clone();
    crossSpokeB.rotation.y = Math.PI / 2;
    this.reactorMandalaGroup.add(this.reactorMandalaOuter, this.reactorMandalaInner, crossSpoke, crossSpokeB);
    this.reactorMandalaGroup.position.y = 0.062;
    this.reactorMandalaGroup.visible = false;
    this.scene.add(this.reactorMandalaGroup);

    // 3. Abyssal Protocol Heat >= 4 Boss Apex Mutated Moveset Visuals & Dual-Core Harmonic Shield
    this.bossApexGroup = new THREE.Group();
    const laserGeo = new THREE.BoxGeometry(0.18, 0.18, 28);
    this.bossApexLaserA = new THREE.Mesh(laserGeo, additive(0xff3878, 0.78));
    this.bossApexLaserB = new THREE.Mesh(laserGeo, additive(0xc44dff, 0.78));
    const cloneGeo = new THREE.OctahedronGeometry(1.05, 1);
    this.bossApexCloneL = new THREE.Mesh(cloneGeo, additive(0x5ef6ff, 0.62));
    this.bossApexCloneR = new THREE.Mesh(cloneGeo, additive(0xff5ce0, 0.62));
    this.bossApexTideRing = new THREE.Mesh(
      new THREE.RingGeometry(5.2, 6.1, 40).rotateX(-Math.PI / 2),
      additive(0x62f4ff, 0.68),
    );
    this.bossHarmonicDome = new THREE.Mesh(
      new THREE.IcosahedronGeometry(3.55, 1),
      additive(0xffd84a, 0.34),
    );
    this.bossApexGroup.add(
      this.bossApexLaserA,
      this.bossApexLaserB,
      this.bossApexCloneL,
      this.bossApexCloneR,
      this.bossApexTideRing,
      this.bossHarmonicDome,
    );
    this.bossApexGroup.visible = false;
    this.scene.add(this.bossApexGroup);

    // 4. Stage 5: 3D Translucent Holographic Ghost Runner (Fair Trial #202611 & Same-Seed Duel)
    this.ghostGroup = new THREE.Group();
    this.ghostBodyMat = additive(0x3ef3ff, 0.56);
    const ghostSilGeo = new GeoBuilder()
      .add(cyl(0.26, 0.34, 0.88, 8), 0x62f4ff, 2.2, { p: [0, 0.62, 0] })
      .add(sph(0.28, 10, 8), 0xb8ffff, 2.6, { p: [0, 1.26, 0] })
      .add(box(0.18, 0.16, 0.68), 0xffe26a, 2.4, { p: [0.24, 0.78, -0.32] })
      .build();
    const ghostMesh = new THREE.Mesh(ghostSilGeo, this.ghostBodyMat);
    this.ghostRingMat = additive(0x19f5a8, 0.74);
    const ghostFloorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.68, 0.88, 6).rotateX(-Math.PI / 2),
      this.ghostRingMat,
    );
    ghostFloorRing.position.y = 0.048;
    const ghostBeacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.18, 2.2, 8, 1, true),
      additive(0x62f4ff, 0.26),
    );
    ghostBeacon.position.y = 1.1;
    this.ghostGroup.add(ghostMesh, ghostFloorRing, ghostBeacon);
    this.ghostGroup.visible = false;
    this.scene.add(this.ghostGroup);
  }

  private updateV22Visuals(snap: SimSnapshot, _dt: number, t: number): void {
    const airY = snap.squadAirY ?? 0;

    // 1. Update Twin Tactical Drone Wingmen
    const wm = snap.wingmanState;
    if (wm && snap.squadCount > 0) {
      const hex = wm.id === 'prism_mirror' ? 0x5ef6ff : wm.id === 'gravity_anchor' ? 0xc47dff : 0xffe26a;
      this.wingmanCoreMatL.color.setHex(hex);
      this.wingmanCoreMatR.color.setHex(hex);
      const bobL = Math.sin(t * 5.2) * 0.12;
      const bobR = Math.cos(t * 5.2) * 0.12;
      const hoverY = (wm.formation === 'forward_mirror' ? 0.92 : 1.38) + airY;
      this.wingmanLeftGroup.visible = true;
      this.wingmanRightGroup.visible = true;
      this.wingmanLeftGroup.position.set(wm.leftX, hoverY + bobL, wm.leftZ);
      this.wingmanRightGroup.position.set(wm.rightX, hoverY + bobR, wm.rightZ);
      const pulseScale = 1 + ((wm as { pulseTimer?: number }).pulseTimer ?? 0) * 0.35;
      this.wingmanLeftGroup.scale.setScalar(pulseScale);
      this.wingmanRightGroup.scale.setScalar(pulseScale);
      const isMirror = wm.formation === 'forward_mirror';
      this.wingmanLeftMirror.visible = isMirror;
      this.wingmanRightMirror.visible = isMirror;
      if (isMirror) {
        this.wingmanLeftMirror.rotation.y = (34 * Math.PI) / 180;
        this.wingmanRightMirror.rotation.y = (-34 * Math.PI) / 180;
      }
      this.wingmanLeftGroup.children[0]!.rotation.y = Math.sin(t * 2.5) * 0.22;
      this.wingmanRightGroup.children[0]!.rotation.y = -Math.sin(t * 2.5) * 0.22;
    } else {
      this.wingmanLeftGroup.visible = false;
      this.wingmanRightGroup.visible = false;
    }

    // 2. Update Core Reactor Tier-3 Awakening Mandala
    const rTier = snap.coreReactorTier ?? 0;
    if ((this.awakenCamTimer > 0 || rTier >= 3) && snap.squadCount > 0) {
      this.reactorMandalaGroup.visible = true;
      this.reactorMandalaGroup.position.set(snap.squadX, 0.058 + airY * 0.85, PLAYER_Z);
      const burstBoost = this.awakenCamTimer > 0 ? 1 + Math.sin((1 - this.awakenCamTimer / this.awakenCamDur) * Math.PI) * 0.82 : 1;
      const baseS = (snap.formationRadius * 0.62 + 0.95) * burstBoost;
      this.reactorMandalaGroup.scale.setScalar(baseS);
      this.reactorMandalaOuter.rotation.z = t * 1.45;
      this.reactorMandalaInner.rotation.z = -t * 2.15;
      this.reactorMandalaMat.opacity = this.awakenCamTimer > 0 ? 0.92 : 0.44 + 0.14 * Math.sin(t * 5);
    } else {
      this.reactorMandalaGroup.visible = false;
    }

    // 3. Update Abyssal Boss Apex Mutation & Harmonic Dual-Core Shield Visuals
    const b = snap.boss;
    if (b && b.active && (b.abyssalMutation || b.harmonicShield)) {
      this.bossApexGroup.visible = true;
      this.bossApexGroup.position.set(b.x, 0, b.z);
      this.bossHarmonicDome.visible = Boolean(b.harmonicShield) && (b.parts ?? []).some((p) => !p.destroyed);
      this.bossHarmonicDome.position.y = 2.55;
      this.bossHarmonicDome.rotation.y = t * 1.9;

      const mut = b.abyssalMutation;
      this.bossApexLaserA.visible = mut === 'cross_laser_grid';
      this.bossApexLaserB.visible = mut === 'cross_laser_grid';
      if (mut === 'cross_laser_grid') {
        const sweep = Math.sin(t * 1.85) * 0.46;
        this.bossApexLaserA.position.set(0, 1.15, 11);
        this.bossApexLaserA.rotation.y = sweep + 0.28;
        this.bossApexLaserB.position.set(0, 1.15, 11);
        this.bossApexLaserB.rotation.y = -sweep - 0.28;
      }

      this.bossApexCloneL.visible = mut === 'phantom_clone_salvo';
      this.bossApexCloneR.visible = mut === 'phantom_clone_salvo';
      if (mut === 'phantom_clone_salvo') {
        this.bossApexCloneL.position.set(-3.4 + Math.sin(t * 3.2) * 0.5, 2.2, 1.5);
        this.bossApexCloneR.position.set(3.4 - Math.sin(t * 3.2) * 0.5, 2.2, 1.5);
        this.bossApexCloneL.rotation.y = t * 3.2;
        this.bossApexCloneR.rotation.y = -t * 3.2;
      }

      this.bossApexTideRing.visible = mut === 'mag_storm_tide';
      if (mut === 'mag_storm_tide') {
        const tideZ = ((t * 14) % 26);
        this.bossApexTideRing.position.set(0, 0.14, tideZ);
        this.bossApexTideRing.scale.setScalar(1 + tideZ * 0.04);
      }
    } else {
      this.bossApexGroup.visible = false;
    }
  }

  /** Stage 5: Updates 3D Translucent Holographic Ghost Runner on the highway */
  updateGhostRunner(ghost: { active: boolean; x: number; zOffset: number; weapon: WeaponId; playerAhead: boolean } | null, t: number): void {
    if (!this.ghostGroup) return;
    if (!ghost || !ghost.active) {
      this.ghostGroup.visible = false;
      return;
    }
    this.ghostGroup.visible = true;
    const gz = THREE.MathUtils.clamp(PLAYER_Z - ghost.zOffset, -26, PLAYER_Z + 3.2);
    const bob = Math.abs(Math.sin(t * 11.5)) * 0.08;
    this.ghostGroup.position.set(ghost.x, bob, gz);
    this.ghostGroup.rotation.y = Math.sin(t * 3) * 0.08;
    this.ghostBodyMat.color.setHex(WEAPON_COLOR[ghost.weapon] ?? 0x3ef3ff);
    this.ghostBodyMat.opacity = 0.48 + 0.12 * Math.sin(t * 9);
    this.ghostRingMat.color.setHex(ghost.playerAhead ? 0x19f5a8 : 0xffbe3d);
  }

  /** V23 Stage 1: Configures 3A Holographic Free-Cam Photo Mode */
  setPhotoMode(state: { active: boolean; yaw: number; pitch: number; fov: number; filter: PhotoFilterKind } | null): void {
    this.photoModeState = state && state.active ? { ...state } : null;
    if (!this.photoModeState) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** V23 Stage 1: Renders an immediate clean frame & returns PNG Data URL for HD Photo Capture */
  captureFrameDataUrl(snap: SimSnapshot): string {
    this.render(snap, 0, false);
    return this.renderer.domElement.toDataURL('image/png');
  }

  private buildV23Visuals(): void {
    // 1. Tri-Prism Resonance Lattice Plasma Cutter Grid (single InstancedMesh, cap 16)
    const latGeo = new THREE.BoxGeometry(0.18, 0.14, 1.0);
    const latMat = additive(0xffffff, 0.92);
    this.triPrismLatticeMesh = new THREE.InstancedMesh(latGeo, latMat, 16);
    this.triPrismLatticeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(16 * 3), 3);
    this.triPrismLatticeMesh.count = 0;
    this.triPrismLatticeMesh.visible = false;
    this.triPrismLatticeMesh.frustumCulled = false;
    this.triPrismLatticeMesh.renderOrder = 7;
    this.scene.add(this.triPrismLatticeMesh);

    // 2. Dynamic Nemesis Pursuer ("PRISM HUNTER · 零号猎犬") + Adaptive Polarized Counter-Shield
    this.nemesisGroup = new THREE.Group();
    const houndGeo = new GeoBuilder()
      .add(box(1.35, 0.62, 2.25), 0x182544, 0.42, { p: [0, 0.95, 0] })
      .add(cone(0.56, 1.35, 6).rotateX(Math.PI / 2), 0xff3b6e, 2.2, { p: [0, 0.98, 1.32] })
      .add(box(2.45, 0.12, 0.68), 0x2c487c, 0.55, { p: [0, 1.08, -0.15] })
      .add(oct(0.42), 0xffe26a, 2.6, { p: [0, 1.48, 0.15] })
      .build();
    const houndBody = new THREE.Mesh(houndGeo, this.propMat);
    this.nemesisShieldMat = new THREE.MeshBasicMaterial({
      color: 0x3ef3ff,
      wireframe: true,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.nemesisShieldMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.72, 1), this.nemesisShieldMat);
    this.nemesisShieldMesh.position.y = 1.08;
    this.nemesisTelegraphBeam = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.12, 26),
      additive(0xff2a55, 0.72),
    );
    this.nemesisTelegraphBeam.position.set(0, 0.42, 13);
    this.nemesisTelegraphBeam.visible = false;
    this.nemesisGroup.add(houndBody, this.nemesisShieldMesh, this.nemesisTelegraphBeam);
    this.nemesisGroup.visible = false;
    this.scene.add(this.nemesisGroup);

    // 3. 2nd-Order Overlimit Nirvana Burst Expanding Cataclysm Mandala
    this.nirvanaBurstGroup = new THREE.Group();
    this.nirvanaOuterMat = additive(0xffe26a, 0.88);
    this.nirvanaInnerMat = additive(0x62f4ff, 0.85);
    this.nirvanaRingOuter = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.55, 12).rotateX(-Math.PI / 2), this.nirvanaOuterMat);
    this.nirvanaRingInner = new THREE.Mesh(new THREE.RingGeometry(1.35, 2.05, 16).rotateX(-Math.PI / 2), this.nirvanaInnerMat);
    this.nirvanaBurstGroup.add(this.nirvanaRingOuter, this.nirvanaRingInner);
    this.nirvanaBurstGroup.position.y = 0.14;
    this.nirvanaBurstGroup.visible = false;
    this.scene.add(this.nirvanaBurstGroup);
  }

  private updateV23Visuals(snap: SimSnapshot, _dt: number, t: number): void {
    const d = this.dummy;

    // 1. Tri-Prism Resonance Lattice Cutter Grid
    const links = (snap.triPrismLinks ?? []) as readonly TriPrismLinkSnapshot[];
    let lIdx = 0;
    if ((snap.triPrismLatticeTimer ?? 0) > 0 && links.length > 0) {
      for (const lk of links) {
        if (lIdx >= 16) break;
        const dx = lk.x2 - lk.x1;
        const dz = lk.z2 - lk.z1;
        const len = Math.hypot(dx, dz);
        if (len < 0.25) continue;
        d.position.set(lk.x1 + dx * 0.5, 0.86 + 0.08 * Math.sin(t * 24 + lIdx), lk.z1 + dz * 0.5);
        d.rotation.set(0, Math.atan2(dx, dz), 0);
        d.scale.set(1.15 + 0.35 * Math.sin(t * 32 + lIdx), 1.0, len);
        d.updateMatrix();
        this.triPrismLatticeMesh.setMatrixAt(lIdx, d.matrix);
        this.tmpColor.setHex(lIdx % 2 === 0 ? 0x62f4ff : 0xffe46b);
        this.triPrismLatticeMesh.setColorAt(lIdx, this.tmpColor);
        lIdx++;
      }
    }
    this.triPrismLatticeMesh.count = lIdx;
    this.triPrismLatticeMesh.visible = lIdx > 0;
    if (lIdx > 0) {
      this.triPrismLatticeMesh.instanceMatrix.needsUpdate = true;
      if (this.triPrismLatticeMesh.instanceColor) this.triPrismLatticeMesh.instanceColor.needsUpdate = true;
    }

    // 2. Dynamic Nemesis Pursuer ("PRISM HUNTER · 零号猎犬")
    const nem = (snap.nemesis ?? null) as NemesisSnapshot | null;
    if (nem && nem.hp > 0) {
      this.nemesisGroup.visible = true;
      const hover = Math.sin(t * 6.5) * 0.16;
      this.nemesisGroup.position.set(nem.x, hover, nem.z);
      this.nemesisGroup.rotation.z = Math.sin(t * 4.2) * 0.08;
      const s = 1.0 + nem.hitPulse * 0.14;
      this.nemesisGroup.scale.setScalar(s);
      this.nemesisShieldMesh.visible = !nem.shieldBroken;
      if (!nem.shieldBroken) {
        this.nemesisShieldMat.color.setHex(WEAPON_COLOR[nem.adaptedWeapon] ?? 0x3ef3ff);
        this.nemesisShieldMat.opacity = 0.46 + 0.22 * Math.sin(t * 10);
        this.nemesisShieldMesh.rotation.y = t * 2.4;
      }
      this.nemesisTelegraphBeam.visible = nem.dashTelegraph > 0.05;
      this.pushShadow(nem.x, nem.z, 1.55);
    } else {
      this.nemesisGroup.visible = false;
    }

    // 3. 2nd-Order Overlimit Nirvana Burst Mandala
    const nirRem = snap.nirvanaActiveTimer ?? 0;
    if (nirRem > 0) {
      const p = 1 - Math.min(1, nirRem / 2.6);
      const arch: NirvanaArchetype = snap.nirvanaArchetype ?? 'prism_kaleidoscope';
      this.nirvanaBurstGroup.visible = true;
      this.nirvanaBurstGroup.position.set(snap.squadX * 0.35, 0.16, -12.0);
      const sc = 1.2 + p * 8.5;
      this.nirvanaBurstGroup.scale.setScalar(sc);
      this.nirvanaRingOuter.rotation.z = t * 4.2;
      this.nirvanaRingInner.rotation.z = -t * 6.0;
      this.nirvanaOuterMat.color.setHex(
        arch === 'singularity_supernova' ? 0xd982ff : arch === 'absolute_zero_storm' ? 0x80f8ff : 0xffe46b,
      );
      this.nirvanaInnerMat.color.setHex(
        arch === 'singularity_supernova' ? 0xffb84d : arch === 'absolute_zero_storm' ? 0xffffff : 0x62f4ff,
      );
      const fade = Math.max(0, 1 - p);
      this.nirvanaOuterMat.opacity = 0.86 * fade;
      this.nirvanaInnerMat.opacity = 0.82 * fade;
    } else {
      this.nirvanaBurstGroup.visible = false;
    }
  }
}
