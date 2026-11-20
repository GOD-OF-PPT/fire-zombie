import type { EnemyKind, SimEvent, SimSnapshot } from '../types/game';
import { ENEMY_CONFIGS } from '../config/enemies';
import { FIXED_DT, HORIZON_AHEAD, PLAYER_Z, TRACK_HALF_WIDTH } from '../config/constants';
import type { RunwayEncounter } from '../config/sectors';
import { spawnBarrel } from './barrels';
import { spawnSectorBoss } from './bosses';
import { spawnEnemy } from './enemies';
import type { SimWorld } from './entities';
import { spawnGateRow } from './gates';
import { clamp } from './math';
import { hasMutator, spawnContractLane, spawnJumpPad, spawnReflector } from './competition';
import { computeAuthoritativeEffectiveDps, spawnPrismLens, spawnVault } from './weapons';

export const SWARM_TIER_NAMES: Record<number, string> = {
  1: '常规侦测',
  2: '蜂拥警报',
  3: '狂潮涌动',
  4: '深渊尸海',
  5: '湮灭兽潮',
  6: '终焉狂潮',
};

export interface DynamicSwarmProfile {
  swarmMult: number;
  swarmTier: 1 | 2 | 3 | 4 | 5 | 6;
  targetHorde: number;
  hasMetaPower: boolean;
}

/**
 * Computes real-time monster tide density from BOTH live in-run character strength
 * (squad size, stacked co-firing weapons, Overclock stacks, Orbital Blades, Superweapon Fusions,
 * Overdrive & Rampage combo) AND Workshop / Mutator modifiers — realizing "角色越强，小怪越多"
 * while maintaining a smooth baseline curve with zero sudden cliff jumps!
 */
export function computeDynamicSwarmProfile(world: SimWorld): DynamicSwarmProfile {
  const hasMetaPower =
    world.mods.damageMult > 1.04 ||
    world.mods.bonusSquad >= 6 ||
    (world.mods.critChance ?? 0) > 0.04 ||
    (world.mods.mutators?.length ?? 0) > 0;

  const squadFactor =
    world.squadCount <= 12
      ? 0
      : Math.pow((world.squadCount - 12) / 10.5, 0.96) * 0.92;

  const lv = world.learnedWeaponLevels;
  const extraWeaponLv =
    Math.max(0, lv.pulse - 1) + lv.scatter + lv.rail + lv.plasma + lv.cryo;
  const arsenalFactor =
    extraWeaponLv * 0.52 +
    world.overclockStacks * 0.55 +
    world.bladesCount * 0.24 +
    world.activeFusions.length * 1.15;

  const frenzyFactor =
    (world.overdriveTimer > 0 ? 1.35 : 0) + Math.min(1.15, world.rampageStacks * 0.032);

  const metaFactor =
    Math.max(0, world.mods.damageMult - 1) * 1.05 +
    world.mods.bonusSquad / 20 +
    (world.mods.critChance ?? 0) * 1.2 +
    (world.mods.mutators?.length ?? 0) * 0.45;

  const rawMult = 1 + squadFactor + arsenalFactor + frenzyFactor + metaFactor;
  const swarmMult = Math.round(clamp(rawMult, 1.0, 16.0) * 100) / 100;

  const swarmTier: 1 | 2 | 3 | 4 | 5 | 6 =
    swarmMult >= 9.0
      ? 6
      : swarmMult >= 6.2
        ? 5
        : swarmMult >= 4.0
          ? 4
          : swarmMult >= 2.4
            ? 3
            : swarmMult >= 1.28
              ? 2
              : 1;

  const targetHorde = Math.round(clamp(16 * swarmMult + (swarmTier - 1) * 15, 14, 320));

  return {
    swarmMult,
    swarmTier,
    targetHorde,
    hasMetaPower,
  };
}

/**
 * Computes real combined effective player firepower (primary + co-firing auxiliary arsenal + meta/mutators)
 * so monster HP across all 4 Tiers scales realistically with actual bullet output — eliminating 1-hit insta-pops!
 */
function computeEffectiveArsenalDps(world: SimWorld): number {
  return Math.max(18, computeAuthoritativeEffectiveDps(world, false));
}

/**
 * V10 4-Tier Monster Durability Curve (scaled with pow 0.54 of squad DPS, matching individual per-stream bullet growth!):
 *  - Tier 1 (Swarm Minion: crawler): 4–6 individual bullet hits (never dies to a 1-bullet graze!)
 *  - Tier 2 (Raider: bomber/stalker/burrower/dasher/mitosis): 14–22 bullet hits (sustained skirmisher TTK)
 *  - Tier 3 (Armored Elite: phalanx/howler/beholder/necromancer/siphon): 32–48 bullet hits (fortified specialist)
 *  - Tier 4 (Juggernaut Titan: bastion/glacier/brood): 65–95+ bullet hits (true Super-Armor mini-boss!)
 */
export function computeTieredEnemyHp(world: SimWorld, kind: EnemyKind): number {
  const cfg = ENEMY_CONFIGS[kind];
  const effDps = computeEffectiveArsenalDps(world);
  const scale = Math.pow(Math.max(1, effDps / 24), 0.54);

  switch (cfg.tier) {
    case 1:
      return Math.max(8, Math.round(8.5 * scale));
    case 2: {
      const base = kind === 'mitosis' ? 30 : kind === 'burrower' ? 28 : kind === 'stalker' ? 26 : 23;
      return Math.max(cfg.hp, Math.round(base * scale));
    }
    case 3: {
      const base = kind === 'phalanx' ? 62 : kind === 'necromancer' ? 56 : 52;
      return Math.max(cfg.hp, Math.round(base * scale));
    }
    case 4: {
      const base = kind === 'bastion' ? 112 : kind === 'glacier' ? 96 : 90;
      return Math.max(cfg.hp, Math.round(base * scale));
    }
  }
}

const HORIZON_COLUMN_MIN_Z = -162.0;
const SLICE_WIDTH_Z = 5.0;
const MAX_SLICE_5M_DENSITY = 14;
const LATERAL_BANDS = 6;

/**
 * 6-Band Coprime Permutation across Left [-4.32..-1.44], Center [-1.44..+1.44], Right [+1.44..+4.32].
 * Order [2, 4, 1, 5, 0, 3] guarantees:
 *  - Every 3 consecutive spawns cover Center, Right, Left (1 per third!)
 *  - Every 6 consecutive spawns cover all 6 sub-bands evenly across the full bridge width
 *  - Golden-Ratio / R2 quasi-random sub-band offset eliminates rigid grid/railroad lines!
 */
const STRATIFIED_BAND_ORDER = [2, 4, 1, 5, 0, 3] as const;
const GOLDEN_CONJ = 0.6180339887498949;
const R2_ALPHA_Z = 0.5698402909980532;

/**
 * Samples a mathematically uniform, non-grid lateral X coordinate across [-4.32, +4.32]
 * using stratified 6-band permutation + Golden-Ratio blue-noise jitter.
 */
export function sampleUniformSwarmX(world: SimWorld): { x: number; zJitter: number; seq: number; band: number } {
  const seq = world.swarmSpatialCursor;
  world.swarmSpatialCursor = seq + 1;

  const epoch = Math.floor(seq / LATERAL_BANDS);
  const slot = (seq + (epoch % 2 === 1 ? 3 : 0)) % LATERAL_BANDS;
  const band = STRATIFIED_BAND_ORDER[slot]!;

  // Smooth low-discrepancy intra-band offset in [0.08, 0.92] (zero edge pileup, zero rigid column center!)
  const u = ((seq * GOLDEN_CONJ + 0.38196601125) % 1 + 1) % 1;
  const bandMin = -4.32 + band * 1.44;
  const rawX = bandMin + (0.08 + u * 0.84) * 1.44;

  const uz = ((seq * R2_ALPHA_Z + 0.2360679775) % 1 + 1) % 1;
  const zJitter = (uz - 0.5) * 2.1;

  return {
    x: clamp(rawX, -TRACK_HALF_WIDTH + 0.48, TRACK_HALF_WIDTH - 0.48),
    zJitter,
    seq,
    band,
  };
}

/**
 * Local 2D obstacle clearance (eliminates V7's 6.4m full-width gate dead-zones & horizontal line-snapping!):
 * Monsters flow seamlessly across non-mutable gate lanes and disperse organically behind physical Vault crates
 * and shootable Mutable Gates without ever snapping onto a single horizontal Z line.
 */
function nudgeClearOfRunwayObstacles(world: SimWorld, x: number, z: number, seq: number): { x: number; z: number } {
  let outX = x;
  let outZ = z;
  const spread = ((seq * GOLDEN_CONJ + 0.19) % 1 + 1) % 1;

  for (let i = 0; i < world.vaults.length; i++) {
    const v = world.vaults[i];
    if (v && v.active && !v.broken && Math.abs(v.z - outZ) < 1.55 && Math.abs(v.x - outX) < v.halfWidth + 0.62) {
      outZ = v.z - 1.65 - spread * 1.45;
    }
  }
  for (let i = 0; i < world.gates.length; i++) {
    const g = world.gates[i];
    if (
      g &&
      g.active &&
      g.mutable &&
      !g.triggered &&
      !g.dimmed &&
      outZ > g.z - 0.7 &&
      outZ < g.z + 2.25 &&
      Math.abs(g.x - outX) < g.halfWidth + 0.25
    ) {
      outZ = g.z - 0.85 - spread * 1.6;
    }
  }
  outX = clamp(outX, -TRACK_HALF_WIDTH + 0.48, TRACK_HALF_WIDTH - 0.48);
  outZ = clamp(outZ, HORIZON_COLUMN_MIN_Z, PLAYER_Z - 15.5);
  return { x: outX, z: outZ };
}

interface RunwayColumnMetrics {
  columnCount: number;
  frontCount: number;
  tailZ: number;
  sliceCounts: Map<number, number>;
  cellCounts: Map<number, number>;
}

const _sliceCountsScratch = new Map<number, number>();
const _cellCountsScratch = new Map<number, number>();

function xToBand(x: number): number {
  return clamp(Math.floor((x + 4.32) / 1.44), 0, LATERAL_BANDS - 1);
}

function measureRunwayHordeColumn(world: SimWorld): RunwayColumnMetrics {
  _sliceCountsScratch.clear();
  _cellCountsScratch.clear();
  let columnCount = 0;
  let frontCount = 0;
  let tailZ = PLAYER_Z;
  for (let i = 0; i < world.enemies.length; i++) {
    const e = world.enemies[i];
    if (e && e.active && !e.consumed && !e.bypassed && e.hp > 0 && e.z >= HORIZON_COLUMN_MIN_Z) {
      columnCount += 1;
      if (e.z >= PLAYER_Z - 58) frontCount += 1;
      if (e.z < tailZ) tailZ = e.z;
      const slice = Math.floor(e.z / SLICE_WIDTH_Z);
      const band = xToBand(e.x);
      _sliceCountsScratch.set(slice, (_sliceCountsScratch.get(slice) ?? 0) + 1);
      const cellKey = slice * 8 + band;
      _cellCountsScratch.set(cellKey, (_cellCountsScratch.get(cellKey) ?? 0) + 1);
    }
  }
  return {
    columnCount,
    frontCount,
    tailZ,
    sliceCounts: _sliceCountsScratch,
    cellCounts: _cellCountsScratch,
  };
}

/**
 * 2D Poisson-Disc + Least-Loaded (Slice × Lateral-Band) Sampler:
 * Always selects the sparsest 5m Z-slice across `[farZ, nearZ]`, and if the stratified blue-noise X-band
 * is locally busier than a sibling band in that slice, shifts into the least-populated lateral band
 * while enforcing >= 1.32m 2D nearest-neighbor clearance against existing active monsters!
 */
function pickLeastLoaded2DSpawnCoord(
  world: SimWorld,
  metrics: RunwayColumnMetrics,
  nearZ: number,
  farZ: number,
): { x: number; z: number; seq: number } | null {
  const sample = sampleUniformSwarmX(world);
  const topSlice = Math.floor(nearZ / SLICE_WIDTH_Z);
  const botSlice = Math.floor(farZ / SLICE_WIDTH_Z);

  let bestSlice = topSlice;
  let bestSliceCount = Infinity;
  // Scan front-to-back with slight preference for filling engagement highway gaps before deep horizon
  for (let s = topSlice; s >= botSlice; s--) {
    const c = metrics.sliceCounts.get(s) ?? 0;
    if (c >= MAX_SLICE_5M_DENSITY) continue;
    // Gentle +0.18 per-slice distance bias so front/mid gaps fill smoothly before stacking at farZ
    const score = c + (topSlice - s) * 0.18;
    if (score < bestSliceCount) {
      bestSliceCount = score;
      bestSlice = s;
    }
  }
  if ((metrics.sliceCounts.get(bestSlice) ?? 0) >= MAX_SLICE_5M_DENSITY) {
    return null;
  }

  // Within bestSlice, honor sample.band unless another band in the same third or neighbor has >= 2 fewer units
  let chosenBand = sample.band;
  const sampleCellCnt = metrics.cellCounts.get(bestSlice * 8 + chosenBand) ?? 0;
  if (sampleCellCnt >= 2) {
    let minBandCnt = sampleCellCnt;
    for (let k = 0; k < LATERAL_BANDS; k++) {
      const b = STRATIFIED_BAND_ORDER[(sample.seq + k) % LATERAL_BANDS]!;
      const cnt = metrics.cellCounts.get(bestSlice * 8 + b) ?? 0;
      if (cnt + 1 < minBandCnt) {
        minBandCnt = cnt;
        chosenBand = b;
      }
    }
  }

  const u = ((sample.seq * GOLDEN_CONJ + 0.38196601125) % 1 + 1) % 1;
  const uz = ((sample.seq * R2_ALPHA_Z + 0.2360679775) % 1 + 1) % 1;
  const sliceCenterZ = (bestSlice + 0.5) * SLICE_WIDTH_Z;
  let candX = -4.32 + chosenBand * 1.44 + (0.09 + u * 0.82) * 1.44;
  let candZ = clamp(sliceCenterZ + (uz - 0.5) * (SLICE_WIDTH_Z * 0.86), farZ, nearZ);

  const cleared = nudgeClearOfRunwayObstacles(world, candX, candZ, sample.seq);
  candX = cleared.x;
  candZ = cleared.z;

  // 2D Poisson-disc relaxation matched to larger V9 3D monster silhouettes (>= 1.62m clearance!)
  const minDistSq = 1.62 * 1.62;
  for (let attempt = 0; attempt < 4; attempt++) {
    let clash = false;
    for (let i = 0; i < world.enemies.length; i++) {
      const e = world.enemies[i];
      if (!e || !e.active || e.consumed || e.bypassed || e.hp <= 0) continue;
      const dx = e.x - candX;
      const dz = e.z - candZ;
      if (dx * dx + dz * dz < minDistSq) {
        clash = true;
        break;
      }
    }
    if (!clash) break;
    const ang = (sample.seq * 2.3999632 + (attempt + 1) * 2.1) % (Math.PI * 2);
    candX = clamp(cleared.x + Math.cos(ang) * 1.18, -TRACK_HALF_WIDTH + 0.48, TRACK_HALF_WIDTH - 0.48);
    candZ = clamp(cleared.z + Math.sin(ang) * 1.25, HORIZON_COLUMN_MIN_Z, nearZ);
  }

  const finalSlice = Math.floor(candZ / SLICE_WIDTH_Z);
  const finalBand = xToBand(candX);
  metrics.sliceCounts.set(finalSlice, (metrics.sliceCounts.get(finalSlice) ?? 0) + 1);
  metrics.cellCounts.set(finalSlice * 8 + finalBand, (metrics.cellCounts.get(finalSlice * 8 + finalBand) ?? 0) + 1);

  return { x: candX, z: candZ, seq: sample.seq };
}

/**
 * 14-Archetype Deck-Balanced Swarm Selector:
 * Unlocks rich visual & mechanical monster variety right from d >= 36 (~2.5s into Sector 1!)
 * while scaling specialist HP to popcorn-friendly ratios when spawned as dynamic fodder.
 */
/**
 * V10 Authentic 4-Tier Tactical Pyramid Spawner (24-Slot Coprime Formation Wheel):
 *  - ~58% Tier 1 Swarm Minions (`crawler` in 4 chromatic sub-breeds, 2-4 hit durability)
 *  - ~21% Tier 2 Raiders (`bomber`, `stalker`, `burrower`, `dasher`, `mitosis` — multi-volley skirmishers)
 *  - ~13% Tier 3 Armored Elites (`phalanx`, `howler`, `beholder`, `necromancer` — fortified specialists)
 *  -  ~8% Tier 4 Juggernaut Titans (`glacier`, `brood`, `bastion` — towering super-armor commanders!)
 */
function spawnDiverseSwarmUnit(
  world: SimWorld,
  profile: DynamicSwarmProfile,
  sx: number,
  sz: number,
  seq: number,
): void {
  const fastTrack =
    profile.hasMetaPower ||
    world.mods.blitz === true ||
    world.endless !== null ||
    world.sector >= 2 ||
    world.stats.vaultsCracked > 0;

  const stageA = world.scrollDistance >= 36 || fastTrack;
  const stageB = world.scrollDistance >= 88 || profile.swarmTier >= 2 || fastTrack;
  const stageC = world.scrollDistance >= 145 || profile.swarmTier >= 3 || fastTrack;

  const wheel = (seq * 11 + world.swarmDirectorCycle * 5) % 24;
  let kind: EnemyKind = 'crawler';

  // Tier 4 Juggernauts (2 / 24 = ~8.3%, capped at 5 simultaneous Tier 4 giants so each feels like a mini-boss!)
  let activeTier4 = 0;
  for (let i = 0; i < world.enemies.length; i++) {
    const e = world.enemies[i];
    if (e && e.active && !e.consumed && e.hp > 0 && ENEMY_CONFIGS[e.kind].tier === 4) activeTier4++;
  }

  if (stageC && wheel === 23 && activeTier4 < 5) {
    kind = seq % 3 === 0 ? 'bastion' : 'brood';
  } else if (stageB && wheel === 11 && activeTier4 < 5) {
    kind = 'glacier';
  } else if (stageC && wheel === 19) {
    // Tier 3 Armored Elites (3 / 24 = ~12.5%)
    kind = 'necromancer';
  } else if (stageB && wheel === 15) {
    kind = seq % 2 === 0 ? 'beholder' : 'howler';
  } else if (stageB && wheel === 7) {
    kind = 'phalanx';
  } else if (stageA && wheel === 3) {
    // Tier 2 Raiders (5 / 24 = ~20.8%)
    kind = 'burrower';
  } else if (stageA && wheel === 9) {
    kind = 'stalker';
  } else if (stageA && wheel === 17) {
    kind = 'bomber';
  } else if (stageC && wheel === 21) {
    kind = 'dasher';
  } else if (wheel === 5) {
    kind = 'mitosis';
  } else {
    // Tier 1 Swarm Minions (14 / 24 = ~58.3%)
    kind = 'crawler';
  }

  const hp = computeTieredEnemyHp(world, kind);
  spawnEnemy(world, kind, sx, sz, { hp, isSwarmFodder: true });
}

/**
 * Spawns an organically distributed 2D Blue-Noise / Least-Loaded Cell monster stream
 * across `[farZ, nearZ]` with guaranteed uniform lateral & longitudinal density and rich 14-archetype variety!
 */
function spawnDynamicHordeWave(
  world: SimWorld,
  profile: DynamicSwarmProfile,
  nearZ: number,
  farZ: number,
  desiredCount: number,
  scrollSpeed: number,
  metrics: RunwayColumnMetrics,
): number {
  const activeCap = Math.round(clamp(82 + profile.swarmMult * 19, 104, 300));
  if (world.enemies.length >= activeCap || desiredCount <= 0) return 0;

  const budget = Math.min(activeCap - world.enemies.length, desiredCount);
  world.swarmDirectorCycle += 1;
  const cycle = world.swarmDirectorCycle;
  let spawned = 0;

  for (let i = 0; i < budget; i++) {
    const slot = pickLeastLoaded2DSpawnCoord(world, metrics, nearZ, farZ);
    if (!slot) break;
    spawnDiverseSwarmUnit(world, profile, slot.x, slot.z, slot.seq);
    spawned += 1;
  }

  // Drop volatile Surge Barrels inside deep marching columns when clear of gates!
  const barrelZ = (nearZ + farZ) * 0.5;
  if (
    scrollSpeed > 0 &&
    (profile.hasMetaPower || world.mods.blitz || world.endless !== null) &&
    profile.swarmTier >= 3 &&
    spawned >= 8 &&
    cycle % 5 === 0 &&
    barrelZ > -92 &&
    world.barrels.length < 24 &&
    !world.gateRows.some((r) => r.active && Math.abs(r.z - barrelZ) < 6.0)
  ) {
    const bx = clamp(world.squadX * 0.35 + (cycle % 2 === 0 ? -1.6 : 1.6), -3.2, 3.2);
    spawnBarrel(world, bx, barrelZ, scrollSpeed);
  }

  return spawned;
}

function stepDynamicSwarmDirector(
  world: SimWorld,
  events: SimEvent[],
  remainingDist: number,
  scrollSpeed: number,
): void {
  const drill = world.script.blitzDrill;
  // Leave room for the authored mirror target, switch and jump. Resume waves after the landing.
  if (drill && world.scrollDistance >= drill.mirror - HORIZON_AHEAD - 58 && world.scrollDistance < drill.pad + 24) return;
  const profile = computeDynamicSwarmProfile(world);
  const inBossArena = world.runwayProgress >= 1.0 && world.boss !== null && world.boss.active && world.boss.hp > 0;
  if (inBossArena) {
    const strongForArenaFlood =
      profile.hasMetaPower ||
      world.mods.blitz === true ||
      world.endless !== null ||
      world.activeFusions.length > 0 ||
      world.squadCount >= 95;
    if (!strongForArenaFlood) return;
  } else if (world.scrollDistance < 24 || remainingDist <= 22) {
    return;
  }

  // Preserve pure zero-input AFK runs (0 steering, 0 upgrades) so deterministic AFK balance invariants hold!
  const isPureZeroInputAfk =
    !world.playerHasSteered &&
    !profile.hasMetaPower &&
    !world.mods.blitz &&
    world.endless === null;
  if (isPureZeroInputAfk) return;

  if (!profile.hasMetaPower && !world.mods.blitz && world.endless === null && world.squadCount < 10 && profile.swarmMult < 1.15) {
    return;
  }

  const metrics = measureRunwayHordeColumn(world);
  const isSustainedCombat = world.stats.kills >= 85;
  const nearZ = inBossArena
    ? (isSustainedCombat ? -34 : -20)
    : world.scrollDistance < 95 && world.endless === null && !world.mods.blitz
      ? PLAYER_Z - 26
      : isSustainedCombat
        ? PLAYER_Z - 38
        : PLAYER_Z - 21;
  const farZ = inBossArena ? -88 : profile.swarmMult >= 2.2 ? -146 : -108;

  // Celebratory Horizon Tide when character power crosses a new Swarm Escalation Tier —
  // spread evenly across all least-loaded 2D bridge cells!
  if (profile.swarmTier >= 2 && profile.swarmTier > world.swarmPeakTier) {
    world.swarmPeakTier = profile.swarmTier;
    const surgeDesired = Math.round(
      clamp(14 + Math.pow(profile.swarmMult - 1, 1.28) * 8.5, 16, 84),
    );
    const surgeFarZ = inBossArena ? -72 : -68;
    const spawned = spawnDynamicHordeWave(
      world,
      profile,
      nearZ,
      surgeFarZ,
      surgeDesired,
      scrollSpeed,
      metrics,
    );
    world.swarmDirectorTimer = clamp(0.46 / Math.pow(profile.swarmMult, 0.82), 0.08, 0.34);
    if (spawned > 0) {
      events.push({
        type: 'SWARM_SURGE',
        tier: profile.swarmTier,
        mult: profile.swarmMult,
        count: spawned,
      });
    }
    return;
  }

  world.swarmDirectorTimer -= FIXED_DT;
  if (world.swarmDirectorTimer > 0) return;

  const arenaScale = inBossArena ? 0.78 : 1.0;
  // Calibrated for V10 multi-hit Tier 1..4 durability: steady, non-empty tactical stream without DPS walling!
  const baseCarpet = !inBossArena && !profile.hasMetaPower && world.squadCount < 24 ? 8 : (!inBossArena && world.scrollDistance < 80 && !profile.hasMetaPower ? 13 : 18);
  const columnTarget = Math.round(
    clamp(
      (baseCarpet + 7.6 * Math.max(0, profile.swarmMult - 1) + Math.pow(Math.max(0, profile.swarmMult - 1), 1.44) * 7.2) *
        arenaScale,
      11,
      240,
    ),
  );
  const frontEngageTarget = Math.min(86, Math.max(10, Math.round(columnTarget * 0.48)));
  const frontStarved = metrics.frontCount < frontEngageTarget;

  // Initial horizon fill stays fast; once sustained combat kills >= 85, pace horizon reinforcements cleanly (~20-32/s max)
  world.swarmDirectorTimer = isSustainedCombat
    ? clamp(0.56 / Math.pow(profile.swarmMult, 0.28), 0.28, 0.52)
    : frontStarved && profile.swarmMult >= 6.0
      ? 0.08
      : clamp(0.44 / Math.pow(profile.swarmMult, 0.82), 0.08, 0.32);

  const maxActive = Math.round(clamp(82 + profile.swarmMult * 19, 104, 300));
  if ((metrics.columnCount < columnTarget || frontStarved) && world.enemies.length < maxActive) {
    const deficit = Math.max(frontEngageTarget - metrics.frontCount, columnTarget - metrics.columnCount);
    const maxPulse = isSustainedCombat
      ? Math.round(clamp(2 + profile.swarmMult * 0.42, 3, 9))
      : Math.round(clamp(3 + Math.pow(Math.max(0, profile.swarmMult - 0.8), 1.22) * 2.2, 3, 36));
    const pulseCount = clamp(deficit, Math.min(deficit, 2), maxPulse);
    if (pulseCount > 0) {
      const targetFarZ = frontStarved ? Math.max(farZ, isSustainedCombat ? -96 : -78) : farZ;
      spawnDynamicHordeWave(world, profile, nearZ, targetFarZ, pulseCount, scrollSpeed, metrics);
    }
  }
}

function spawnEncounter(world: SimWorld, enc: RunwayEncounter, scrollSpeed: number): void {
  const baseZ = PLAYER_Z - (enc.crossDist - world.scrollDistance);

  switch (enc.type) {
    case 'gate_row': {
      const row = spawnGateRow(world, {
        layout: enc.layout,
        z: baseZ,
        vz: scrollSpeed,
        dividerX: enc.dividerX,
        left: enc.left,
        right: enc.right,
        single: enc.single,
      });

      if (enc.crossDist === world.script.blitzDrill?.gate && world.cutback) {
        world.cutback.supplyGateId = (world.cutback.vaultX < 0 ? row.rightGateId : row.leftGateId) ?? -1;
      }
      if (enc.tetheredSiphon) {
        const targetGateId =
          enc.tetheredSiphon.side === 'left'
            ? row.leftGateId
            : enc.tetheredSiphon.side === 'right'
              ? row.rightGateId
              : row.singleGateId;
        const targetX =
          enc.tetheredSiphon.side === 'left'
            ? -2.5
            : enc.tetheredSiphon.side === 'right'
              ? 2.5
              : (enc.single?.x ?? 0);
        const zAhead = enc.tetheredSiphon.zAhead ?? 5.5;
        spawnEnemy(world, 'siphon', targetX, baseZ + zAhead, {
          linkedGateId: targetGateId,
        });
      }
      break;
    }
    case 'vault': {
      const vault = spawnVault(world, enc.x, baseZ, scrollSpeed, enc.hp, enc.reward);
      if (enc.crossDist === world.script.blitzDrill?.vault) {
        world.cutback = { vaultId: vault.id, vaultX: enc.x, supplyGateId: -1, primed: false };
      }
      break;
    }
    case 'enemies': {
      const profile = computeDynamicSwarmProfile(world);
      const isPureEarlyAfk =
        !world.playerHasSteered &&
        !profile.hasMetaPower &&
        !world.mods.blitz &&
        world.endless === null;

      const isSwarmWave = enc.units.length >= 6;
      for (let i = 0; i < enc.units.length; i++) {
        const u = enc.units[i];
        if (!u) continue;
        const z = baseZ - (u.dz ?? 0);
        const lowPowerGateGuard =
          !profile.hasMetaPower &&
          !world.mods.blitz &&
          world.squadCount < 28 &&
          world.learnedWeaponLevels.rail === 0 &&
          world.learnedWeaponLevels.plasma === 0;
        if (isPureEarlyAfk || lowPowerGateGuard) {
          if (isSwarmWave && u.kind === 'crawler') {
            spawnEnemy(world, u.kind, u.x, z, { hp: isPureEarlyAfk ? 5 : 7 });
          } else {
            spawnEnemy(world, u.kind, u.x, z);
          }
        } else {
          // Active mid/high-power runs use authentic 4-Tier scaled HP so scripted monsters never die in 1 graze!
          const tieredHp = computeTieredEnemyHp(world, u.kind);
          spawnEnemy(world, u.kind, u.x, z, { hp: tieredHp });
        }
      }

      if (
        !isPureEarlyAfk &&
        world.scrollDistance >= 45 &&
        profile.swarmMult >= 1.15 &&
        enc.units.length >= 2 &&
        world.enemies.length < 260
      ) {
        const metrics = measureRunwayHordeColumn(world);
        const extra = Math.min(
          42,
          Math.min(
            260 - world.enemies.length,
            Math.round(enc.units.length * (profile.swarmMult - 1) * 1.15 + (profile.swarmMult - 1) * 4.2),
          ),
        );
        const nearBandZ = clamp(baseZ - 1.5, -130, PLAYER_Z - 22);
        const farBandZ = clamp(baseZ - 34.0, HORIZON_COLUMN_MIN_Z, nearBandZ - 10.0);
        for (let k = 0; k < extra; k++) {
          const slot = pickLeastLoaded2DSpawnCoord(world, metrics, nearBandZ, farBandZ);
          if (!slot) break;
          spawnDiverseSwarmUnit(world, profile, slot.x, slot.z, slot.seq);
        }
      }

      if (isSwarmWave && hasMutator(world, 'barrel_carnival')) {
        spawnBarrel(world, -1.9, baseZ - 1.5, scrollSpeed);
        spawnBarrel(world, 1.9, baseZ - 4.2, scrollSpeed);
      }
      break;
    }
    case 'barrels': {
      for (let i = 0; i < enc.placements.length; i++) {
        const p = enc.placements[i];
        if (!p) continue;
        const z = baseZ - (p.dz ?? 0);
        spawnBarrel(world, p.x, z, scrollSpeed);
      }
      break;
    }
    case 'lens': {
      spawnPrismLens(
        world,
        enc.x,
        baseZ,
        scrollSpeed,
        enc.driftAmp ?? 0,
        enc.driftFreq ?? 0,
      );
      break;
    }
    case 'jump_pad': {
      spawnJumpPad(world, enc.x, baseZ, scrollSpeed).flankAmbush = enc.crossDist === world.script.blitzDrill?.pad;
      break;
    }
    case 'reflector': {
      spawnReflector(world, enc.x, baseZ, scrollSpeed, enc.lean);
      break;
    }
    case 'contract_lane': {
      spawnContractLane(world, baseZ, enc.length, scrollSpeed, enc.bountySide, enc.bountyHp);
      break;
    }
  }
}

function mirrorEncounter(enc: RunwayEncounter): RunwayEncounter {
  switch (enc.type) {
    case 'gate_row': {
      const siphon = enc.tetheredSiphon;
      return {
        type: 'gate_row',
        crossDist: enc.crossDist,
        layout: enc.layout,
        ...(enc.dividerX !== undefined ? { dividerX: -enc.dividerX } : {}),
        ...(enc.right ? { left: enc.right } : {}),
        ...(enc.left ? { right: enc.left } : {}),
        ...(enc.single ? { single: { ...enc.single, x: -enc.single.x } } : {}),
        ...(siphon
          ? {
              tetheredSiphon: {
                ...siphon,
                side: siphon.side === 'left' ? 'right' : siphon.side === 'right' ? 'left' : 'single',
              },
            }
          : {}),
      };
    }
    case 'vault':
      return { ...enc, x: -enc.x };
    case 'lens':
      return { ...enc, x: -enc.x };
    case 'jump_pad':
      return { ...enc, x: -enc.x };
    case 'reflector':
      return { ...enc, x: -enc.x, lean: (enc.lean === 1 ? -1 : 1) as 1 | -1 };
    case 'contract_lane':
      return { ...enc, bountySide: enc.bountySide === 'left' ? 'right' : 'left' };
    case 'enemies':
      return { ...enc, units: enc.units.map((u) => ({ ...u, x: -u.x })) };
    case 'barrels':
      return { ...enc, placements: enc.placements.map((p) => ({ ...p, x: -p.x })) };
  }
}

/**
 * Mirrors whole segments (a gate row plus the encounters leading up to it) so each authored
 * setup stays intact while the safe side varies per run. Seed 0 keeps the authored layout.
 */
export function computeMirrorFlags(
  encounters: readonly RunwayEncounter[],
  seed: number,
  sector: number,
): boolean[] {
  if (!seed) return [];
  let state = (seed ^ Math.imul(sector, 0x9e3779b1)) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const flags: boolean[] = [];
  let flip = next() < 0.5;
  for (let i = 0; i < encounters.length; i++) {
    flags.push(flip);
    if (encounters[i]?.type === 'gate_row') flip = next() < 0.5;
  }
  return flags;
}

export function spawnReadyRunwayEncounters(world: SimWorld): void {
  const sectorCfg = world.script;
  const encounters = sectorCfg.encounters;

  while (world.spawnCursor < encounters.length) {
    const enc = encounters[world.spawnCursor];
    if (!enc) break;
    if (enc.crossDist <= world.scrollDistance + HORIZON_AHEAD) {
      const mirrored = world.mirrorFlags[world.spawnCursor] === true;
      spawnEncounter(world, mirrored ? mirrorEncounter(enc) : enc, sectorCfg.scrollSpeed);
      world.spawnCursor += 1;
    } else {
      break;
    }
  }
}

/**
 * Step 2: Advances simTime, runway scrollDistance & runwayProgress, streams
 * distance-scripted encounters + live uniform 2D blue-noise monster tides, and triggers Boss arrival.
 */
export function stepTrackAndSpawner(world: SimWorld, events: SimEvent[]): void {
  world.simTime += FIXED_DT;

  const sectorCfg = world.script;
  if (world.scrollDistance < sectorCfg.runwayLength) {
    const previousDistance = world.scrollDistance;
    const remaining = sectorCfg.runwayLength - previousDistance;
    const decelFactor = remaining < 20.0 ? clamp(remaining / 20.0, 0.25, 1.0) : 1.0;
    world.currentScrollSpeed = sectorCfg.scrollSpeed * decelFactor;
    world.scrollDistance = Math.min(
      sectorCfg.runwayLength,
      world.scrollDistance + world.currentScrollSpeed * FIXED_DT,
    );
    world.runwayProgress = clamp(world.scrollDistance / sectorCfg.runwayLength, 0, 1);
    const drill = sectorCfg.blitzDrill;
    if (drill) {
      const deployAt = drill.guard - 42;
      // The sentry walks on from the verge, after the player can see the mirror.
      if (previousDistance < deployAt && world.scrollDistance >= deployAt) {
        const side = -Math.sign(drill.mirrorX);
        const sentry = spawnEnemy(world, 'phalanx', side * 4.5,
          PLAYER_Z - (drill.guard - world.scrollDistance), { hp: 330 });
        sentry.anchoredGuard = true;
        sentry.flankTargetX = drill.mirrorX + side * 4.9;
      }
    }
    spawnReadyRunwayEncounters(world);
    stepDynamicSwarmDirector(
      world,
      events,
      sectorCfg.runwayLength - world.scrollDistance,
      world.currentScrollSpeed,
    );

    if (world.scrollDistance >= sectorCfg.runwayLength) {
      world.currentScrollSpeed = 0;
      world.runwayProgress = 1.0;
    }
  } else {
    world.currentScrollSpeed = 0;
    world.runwayProgress = 1.0;
    stepDynamicSwarmDirector(world, events, 0, 0);
  }

  if (world.runwayProgress >= 1.0 && !world.bossSpawned) {
    spawnSectorBoss(world, events);
  }
}

export function getBlitzDrillCue(world: SimWorld): SimSnapshot['drillCue'] {
  const drill = world.script.blitzDrill;
  if (!drill) return;
  const distance = world.scrollDistance;
  if (distance >= drill.mirror - 51 && distance < drill.mirror - 3 &&
      (distance < drill.guard - 42 || world.enemies.some(e => e.active && e.anchoredGuard && e.shieldHp > 0))) {
    return { action: 'mirror', x: drill.mirrorX };
  }
  const relay = world.cutback;
  if (relay && distance >= drill.vault - 54 && distance < drill.gate) {
    if (relay.primed) return { action: 'switch', x: -relay.vaultX };
    if (world.vaults.some(v => v.id === relay.vaultId && !v.broken && v.z < PLAYER_Z))
      return { action: 'vault', x: relay.vaultX };
  }
  if (distance > drill.pad - 28 && distance < drill.pad) {
    const pad = world.jumpPads.find(p => p.flankAmbush && !p.triggered);
    if (pad) return { action: 'pad', x: pad.x };
  }
}
