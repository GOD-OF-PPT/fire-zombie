import type {
  InputSample,
  RunModifiers,
  SectorId,
  SimEvent,
  SimSnapshot,
  SimulationController,
} from '../types/game';
import { ACCUMULATOR_EPS, FIXED_DT, MAX_WALL_DT } from '../config/constants';
import {
  buildSimSnapshot,
  createSimWorld,
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

export function createSimulation(): SimulationController {
  const world = createSimWorld();
  let accumulator = 0;
  let pendingDragDeltaX = 0;
  let cachedSnapshot: SimSnapshot | null = null;

  function invalidateSnapshot(): void {
    cachedSnapshot = null;
  }

  return {
    startSector(sector: SectorId, mods?: Partial<RunModifiers>): void {
      accumulator = 0;
      pendingDragDeltaX = 0;
      // explicit (possibly empty) mods replace the previous run's modifiers
      resetSimWorldForSector(world, sector, mods ?? {});
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
      if (world.phase === 'PAUSED') {
        world.phase = 'PLAYING';
        pendingDragDeltaX = 0;
        invalidateSnapshot();
      }
    },

    retry(): void {
      accumulator = 0;
      pendingDragDeltaX = 0;
      resetSimWorldForSector(world, world.sector);
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
      const events = stepWorldFixed(world, { dragDeltaX, keyAxisX });
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
        const stepEvents = stepWorldFixed(world, {
          dragDeltaX: perStepDrag,
          keyAxisX,
        });
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

    getSnapshot(): SimSnapshot {
      if (cachedSnapshot === null) {
        cachedSnapshot = buildSimSnapshot(world);
      }
      return cachedSnapshot;
    },
  };
}
