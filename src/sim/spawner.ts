import type { SimEvent } from '../types/game';
import { FIXED_DT, HORIZON_AHEAD, PLAYER_Z } from '../config/constants';
import type { RunwayEncounter } from '../config/sectors';
import { spawnBarrel } from './barrels';
import { spawnSectorBoss } from './bosses';
import { spawnEnemy } from './enemies';
import type { SimWorld } from './entities';
import { spawnGateRow } from './gates';
import { clamp } from './math';
import { spawnPrismLens, spawnVault } from './weapons';

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
      spawnVault(world, enc.x, baseZ, scrollSpeed, enc.hp, enc.reward);
      break;
    }
    case 'enemies': {
      const isSwarmWave = enc.units.length >= 6;
      for (let i = 0; i < enc.units.length; i++) {
        const u = enc.units[i];
        if (!u) continue;
        const z = baseZ - (u.dz ?? 0);
        if (isSwarmWave && u.kind === 'crawler') {
          spawnEnemy(world, u.kind, u.x, z, { hp: 5 });
        } else {
          spawnEnemy(world, u.kind, u.x, z);
        }
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
 * distance-scripted encounters, and triggers Boss arrival at runwayProgress === 1.0.
 */
export function stepTrackAndSpawner(world: SimWorld, events: SimEvent[]): void {
  world.simTime += FIXED_DT;

  const sectorCfg = world.script;
  if (world.scrollDistance < sectorCfg.runwayLength) {
    const remaining = sectorCfg.runwayLength - world.scrollDistance;
    // Smooth arrival deceleration over final 20u into Boss Arena
    const decelFactor = remaining < 20.0 ? clamp(remaining / 20.0, 0.25, 1.0) : 1.0;
    world.currentScrollSpeed = sectorCfg.scrollSpeed * decelFactor;
    world.scrollDistance = Math.min(
      sectorCfg.runwayLength,
      world.scrollDistance + world.currentScrollSpeed * FIXED_DT,
    );
    world.runwayProgress = clamp(world.scrollDistance / sectorCfg.runwayLength, 0, 1);
    spawnReadyRunwayEncounters(world);

    if (world.scrollDistance >= sectorCfg.runwayLength) {
      world.currentScrollSpeed = 0;
      world.runwayProgress = 1.0;
    }
  } else {
    world.currentScrollSpeed = 0;
    world.runwayProgress = 1.0;
  }

  if (world.runwayProgress >= 1.0 && !world.bossSpawned) {
    spawnSectorBoss(world, events);
  }
}
