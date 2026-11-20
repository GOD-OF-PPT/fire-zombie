import type {
  InputSample,
  RangeControlCommand,
  RunModifiers,
  SectorId,
  SimEvent,
  SimSnapshot,
  SimulationController,
} from '../types/game';
import { applyFiringRangeCommand } from './firingRange';
import { ACCUMULATOR_EPS, FIXED_DT, MAX_WALL_DT } from '../config/constants';
import { chooseEndlessUpgrade } from './endless';
import type { EndlessUpgradeId } from '../types/game';
import {
  buildSimSnapshot,
  createSimWorld,
  reconcileFormationAndDps,
  resetSimWorldForSector,
  resetSimWorldToTitle,
  stepWorldFixed,
} from './world';

export type * from '../types/game';
export { FIXED_DT } from '../config/constants';
export {
  applyGateArithmetic,
  applyGateOperation,
  clampSquadCount,
  clampSquadX,
  computeDronePositions,
  computeFormationPositions,
  computeFormationRadius,
  computeGatePolarity,
  computeProjectilePowerScale,
  computeTierBreakdown,
  computeTrueSquadDps,
  formatGateLabel,
  normalizeZero,
} from './math';
export { intersectSweptSegmentAABB, sweepCircleVsMovingAABB } from './ccd';
export { computeDynamicSwarmProfile, SWARM_TIER_NAMES } from './spawner';
import { ReplayPlayer, ReplayRecorder, verifyDeterministicReplay, type DeterministicReplayLog } from './replay';
export { ReplayPlayer, ReplayRecorder, verifyDeterministicReplay };
export type { DeterministicReplayLog, ReplayHighlightMarker, ReplayKeyframe, ReplayMarkerKind, ReplayVerifyResult } from './replay';
export {
  EXPEDITION_NODE_META,
  EXPEDITION_RELICS,
  NIRVANA_META,
  advanceExpeditionAfterVictory,
  generateExpeditionMap,
  getExpeditionNodes,
  pickExpeditionRelicDrop,
  resolveNirvanaArchetype,
} from './v23Mechanics';
export {
  BUILTIN_TRACK_PRESETS,
  compileCustomBlueprint,
  decodeTrackShareCode,
  encodeTrackShareCode,
} from './trackEditor';

export function createSimulation(): SimulationController {
  const world = createSimWorld();
  const recorder = new ReplayRecorder();
  let accumulator = 0;
  let pendingDragDeltaX = 0;
  let cachedSnapshot: SimSnapshot | null = null;
  let pendingOverdrive = false;
  let pendingAegisPulse = false;
  let pendingNukeStrike = false;
  let pendingSwapWeapon = false;
  let pendingCycleWingman = false;
  let pendingNirvanaBurst = false;
  let initialMods: Partial<RunModifiers> = {};

  function invalidateSnapshot(): void {
    cachedSnapshot = null;
  }

  return {
    startSector(sector: SectorId, mods?: Partial<RunModifiers>): void {
      accumulator = 0;
      pendingDragDeltaX = 0;
      pendingOverdrive = false;
      pendingAegisPulse = false;
      pendingNukeStrike = false;
      pendingSwapWeapon = false;
      pendingCycleWingman = false;
      pendingNirvanaBurst = false;
      // explicit (possibly empty) mods replace the previous run's modifiers
      initialMods = { ...mods };
      resetSimWorldForSector(world, sector, initialMods);
      recorder.start(world.sector, world.mods.layoutSeed ?? 0, initialMods);
      invalidateSnapshot();
    },

    pause(): void {
      if (world.phase === 'PLAYING') {
        world.phase = 'PAUSED';
        pendingDragDeltaX = 0;
        invalidateSnapshot();
      }
    },

    resume(): void {
      if (world.phase === 'PAUSED' && !world.endless?.offers.length) {
        world.phase = 'PLAYING';
        pendingDragDeltaX = 0;
        invalidateSnapshot();
      }
    },

    chooseEndlessUpgrade(id: EndlessUpgradeId): boolean {
      const chosen = chooseEndlessUpgrade(world, id);
      if (chosen) {
        recorder.recordProtocol(id);
        reconcileFormationAndDps(world);
        accumulator = 0;
        pendingDragDeltaX = 0;
        pendingOverdrive = false;
        pendingAegisPulse = false;
        pendingNukeStrike = false;
        invalidateSnapshot();
      }
      return chosen;
    },

    retry(): void {
      accumulator = 0;
      pendingDragDeltaX = 0;
      pendingOverdrive = false;
      pendingAegisPulse = false;
      pendingNukeStrike = false;
      resetSimWorldForSector(world, world.sector, initialMods);
      recorder.start(world.sector, world.mods.layoutSeed ?? 0, initialMods);
      invalidateSnapshot();
    },

    returnToTitle(): void {
      accumulator = 0;
      pendingDragDeltaX = 0;
      resetSimWorldToTitle(world);
      invalidateSnapshot();
    },

    setSpeedMultiplier(mult: 1 | 2): void {
      const normalized: 1 | 2 = mult === 2 ? 2 : 1;
      if (world.speedMultiplier !== normalized) {
        world.speedMultiplier = normalized;
        invalidateSnapshot();
      }
    },

    stepFixed(input: InputSample): readonly SimEvent[] {
      if (world.phase !== 'PLAYING') {
        return [];
      }
      const dragDeltaX = Number.isFinite(input.dragDeltaX) ? input.dragDeltaX : 0;
      const keyAxisX = Number.isFinite(input.keyAxisX)
        ? Math.max(-1, Math.min(1, input.keyAxisX))
        : 0;
      const stepInp: InputSample = {
        dragDeltaX,
        keyAxisX,
        overdrive: input.overdrive === true,
        aegisPulse: input.aegisPulse === true,
        nukeStrike: input.nukeStrike === true,
        swapWeapon: input.swapWeapon === true,
        cycleWingman: input.cycleWingman === true,
        nirvanaBurst: input.nirvanaBurst === true,
      };
      recorder.recordStep(stepInp);
      const events = stepWorldFixed(world, stepInp);
      recorder.recordEvents(events);
      invalidateSnapshot();
      return events;
    },

    tickFrame(wallDtSeconds: number, input: InputSample): readonly SimEvent[] {
      if (world.phase !== 'PLAYING') {
        return [];
      }

      const clampedWallDt = Number.isFinite(wallDtSeconds)
        ? Math.max(0, Math.min(MAX_WALL_DT, wallDtSeconds))
        : 0;
      const dragDeltaX = Number.isFinite(input.dragDeltaX) ? input.dragDeltaX : 0;
      const keyAxisX = Number.isFinite(input.keyAxisX)
        ? Math.max(-1, Math.min(1, input.keyAxisX))
        : 0;

      pendingDragDeltaX += dragDeltaX;
      if (input.overdrive === true) pendingOverdrive = true;
      if (input.aegisPulse === true) pendingAegisPulse = true;
      if (input.nukeStrike === true) pendingNukeStrike = true;
      if (input.swapWeapon === true) pendingSwapWeapon = true;
      if (input.cycleWingman === true) pendingCycleWingman = true;
      if (input.nirvanaBurst === true) pendingNirvanaBurst = true;
      accumulator += clampedWallDt * world.speedMultiplier;

      const stepsToRun = Math.floor((accumulator + ACCUMULATOR_EPS) / FIXED_DT);
      if (stepsToRun <= 0) {
        return [];
      }

      const perStepDrag = pendingDragDeltaX / stepsToRun;
      pendingDragDeltaX = 0;

      const frameEvents: SimEvent[] = [];
      for (let i = 0; i < stepsToRun; i++) {
        if (world.phase !== 'PLAYING') {
          accumulator = 0;
          break;
        }
        accumulator = Math.max(0, accumulator - FIXED_DT);
        if (accumulator < ACCUMULATOR_EPS) {
          accumulator = 0;
        }
        const stepInp: InputSample = {
          dragDeltaX: perStepDrag,
          keyAxisX,
          overdrive: pendingOverdrive,
          aegisPulse: pendingAegisPulse,
          nukeStrike: pendingNukeStrike,
          swapWeapon: pendingSwapWeapon,
          cycleWingman: pendingCycleWingman,
          nirvanaBurst: pendingNirvanaBurst,
        };
        recorder.recordStep(stepInp);
        const stepEvents = stepWorldFixed(world, stepInp);
        recorder.recordEvents(stepEvents);
        pendingOverdrive = false;
        pendingAegisPulse = false;
        pendingNukeStrike = false;
        pendingSwapWeapon = false;
        pendingCycleWingman = false;
        pendingNirvanaBurst = false;
        for (let j = 0; j < stepEvents.length; j++) {
          const ev = stepEvents[j];
          if (ev !== undefined) {
            frameEvents.push(ev);
          }
        }
      }

      invalidateSnapshot();
      return frameEvents;
    },

    configureRange(cmd: RangeControlCommand): void {
      applyFiringRangeCommand(world, cmd);
      reconcileFormationAndDps(world);
      invalidateSnapshot();
    },

    exportReplayLog(): DeterministicReplayLog {
      return recorder.finalize(world.phase, world.squadCount, world.stats.kills);
    },

    seekReplayTick(log: DeterministicReplayLog, targetTick: number): ReplayPlayer {
      accumulator = 0;
      pendingDragDeltaX = 0;
      const player = new ReplayPlayer(log);
      player.seekToWorldTick(world, targetTick);
      invalidateSnapshot();
      return player;
    },

    getSnapshot(): SimSnapshot {
      if (cachedSnapshot === null) {
        cachedSnapshot = buildSimSnapshot(world);
      }
      return cachedSnapshot;
    },
  };
}
