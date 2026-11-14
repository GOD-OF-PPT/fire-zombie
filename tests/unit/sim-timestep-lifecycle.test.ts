import { describe, expect, it } from 'vitest';
import { FIXED_DT, createSimulation, type SimSnapshot } from '../../src/sim/index';

function runSimulatedWallSeconds(
  hz: number,
  seconds: number,
  totalDragX: number,
): SimSnapshot {
  const sim = createSimulation();
  sim.startSector(1);
  const frameCount = Math.round(hz * seconds);
  const dt = 1 / hz;
  const dragPerFrame = totalDragX / frameCount;

  for (let f = 0; f < frameCount; f++) {
    const t = f / hz;
    const keyAxisX = t < 2.5 ? -1 : t < 5.0 ? 1 : 0;
    sim.tickFrame(dt, { dragDeltaX: dragPerFrame, keyAxisX });
  }
  return sim.getSnapshot();
}

describe('Fixed-Timestep FPS Invariance, Drag Buffering, Lifecycle Freeze & Clean Reset', () => {
  it('achieves exact 600-step toEqual snapshot parity across 30Hz, 60Hz, 120Hz, 144Hz, and 240Hz', () => {
    const snap60 = runSimulatedWallSeconds(60, 10.0, 0);
    const snap30 = runSimulatedWallSeconds(30, 10.0, 0);
    const snap120 = runSimulatedWallSeconds(120, 10.0, 0);
    const snap144 = runSimulatedWallSeconds(144, 10.0, 0);
    const snap240 = runSimulatedWallSeconds(240, 10.0, 0);

    expect(snap60.simTime).toBeCloseTo(10.0, 9);
    expect(snap30).toEqual(snap60);
    expect(snap120).toEqual(snap60);
    expect(snap144).toEqual(snap60);
    expect(snap240).toEqual(snap60);
  });

  it('buffers fractional sub-step dragDeltaX on high-FPS frames so 30/60/120/144Hz land at identical squadX', () => {
    const s30 = runSimulatedWallSeconds(30, 4.0, 1.8);
    const s60 = runSimulatedWallSeconds(60, 4.0, 1.8);
    const s120 = runSimulatedWallSeconds(120, 4.0, 1.8);
    const s144 = runSimulatedWallSeconds(144, 4.0, 1.8);

    expect(s30.squadCount).toBe(s60.squadCount);
    expect(s120.squadCount).toBe(s60.squadCount);
    expect(s144.squadCount).toBe(s60.squadCount);

    expect(s30.squadX).toBeCloseTo(s60.squadX, 11);
    expect(s120.squadX).toBeCloseTo(s60.squadX, 11);
    expect(s144.squadX).toBeCloseTo(s60.squadX, 11);
  });

  it('clamps huge wallDt spikes to MAX_WALL_DT = 0.1s (at most 6 steps at 1x, 12 steps at 2x)', () => {
    const sim1x = createSimulation();
    sim1x.startSector(1);
    sim1x.tickFrame(5.0, { dragDeltaX: 0, keyAxisX: 0 });
    expect(sim1x.getSnapshot().simTime).toBeCloseTo(6 * FIXED_DT, 10);

    const sim2x = createSimulation();
    sim2x.startSector(1);
    sim2x.setSpeedMultiplier(2);
    sim2x.tickFrame(5.0, { dragDeltaX: 0, keyAxisX: 0 });
    expect(sim2x.getSnapshot().simTime).toBeCloseTo(12 * FIXED_DT, 10);

    // Negative and NaN wallDt are safely ignored
    sim2x.tickFrame(-2.0, { dragDeltaX: 0, keyAxisX: 0 });
    sim2x.tickFrame(NaN, { dragDeltaX: 0, keyAxisX: 0 });
    expect(sim2x.getSnapshot().simTime).toBeCloseTo(12 * FIXED_DT, 10);
  });

  it('advances 2x simulation steps under speedMultiplier = 2 WITHOUT doubling pointer dragDeltaX', () => {
    const sim1x = createSimulation();
    sim1x.startSector(1);
    sim1x.tickFrame(FIXED_DT, { dragDeltaX: 1.75, keyAxisX: 0 });

    const sim2x = createSimulation();
    sim2x.startSector(1);
    sim2x.setSpeedMultiplier(2);
    sim2x.tickFrame(FIXED_DT, { dragDeltaX: 1.75, keyAxisX: 0 });

    expect(sim2x.getSnapshot().speedMultiplier).toBe(2);
    expect(sim2x.getSnapshot().simTime).toBeCloseTo(2 * sim1x.getSnapshot().simTime, 12);
    expect(sim2x.getSnapshot().squadX).toBeCloseTo(1.75, 12);
    expect(sim1x.getSnapshot().squadX).toBeCloseTo(1.75, 12);
  });

  it('freezes 100% of simulation state during TITLE, PAUSED, DEFEAT, and VICTORY', () => {
    const sim = createSimulation();

    // TITLE freeze
    const titleBefore = structuredClone(sim.getSnapshot());
    expect(titleBefore.phase).toBe('TITLE');
    expect(sim.tickFrame(0.5, { dragDeltaX: 2.0, keyAxisX: 1 })).toEqual([]);
    expect(sim.stepFixed({ dragDeltaX: 2.0, keyAxisX: 1 })).toEqual([]);
    expect(sim.getSnapshot()).toEqual(titleBefore);

    // PAUSED freeze across 300 frames
    sim.startSector(1);
    for (let i = 0; i < 90; i++) {
      sim.stepFixed({ dragDeltaX: 0, keyAxisX: -1 });
    }
    sim.pause();
    const pausedRef = structuredClone(sim.getSnapshot());
    expect(pausedRef.phase).toBe('PAUSED');

    for (let i = 0; i < 300; i++) {
      const evs = sim.tickFrame(FIXED_DT, { dragDeltaX: 0.5, keyAxisX: 1 });
      expect(evs.length).toBe(0);
    }
    expect(sim.stepFixed({ dragDeltaX: 1.0, keyAxisX: 1 }).length).toBe(0);
    expect(sim.getSnapshot()).toEqual(pausedRef);

    // Resume continues cleanly from exact frozen state
    sim.resume();
    expect(sim.getSnapshot().phase).toBe('PLAYING');
    expect(sim.getSnapshot().simTime).toBe(pausedRef.simTime);
    sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0 });
    expect(sim.getSnapshot().simTime).toBeCloseTo(pausedRef.simTime + FIXED_DT, 12);

    // Run AFK to DEFEAT and verify post-DEFEAT freeze
    sim.retry();
    let safety = 0;
    while (sim.getSnapshot().phase === 'PLAYING' && safety < 3000) {
      sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0 });
      safety += 1;
    }
    expect(sim.getSnapshot().phase).toBe('DEFEAT');
    const defeatRef = structuredClone(sim.getSnapshot());
    expect(sim.tickFrame(0.1, { dragDeltaX: -2, keyAxisX: -1 })).toEqual([]);
    expect(sim.stepFixed({ dragDeltaX: -2, keyAxisX: -1 })).toEqual([]);
    expect(sim.getSnapshot()).toEqual(defeatRef);
  });

  it('scrubs 100% of pooled entities & counters across 10x retry/startSector/returnToTitle cycles and preserves historical snapshot immutability', () => {
    const sim = createSimulation();
    const initialTitle = structuredClone(sim.getSnapshot());

    for (const sector of [1, 2, 3] as const) {
      sim.startSector(sector);
      const freshSectorStart = structuredClone(sim.getSnapshot());

      for (let cycle = 0; cycle < 10; cycle++) {
        const snapAtZero = sim.getSnapshot();
        const frozenCopyAtZero = structuredClone(snapAtZero);

        // Run active combat, steering, shooting, gate crossings, vault hits
        for (let step = 0; step < 260; step++) {
          const dir = step % 80 < 40 ? -1 : 1;
          sim.stepFixed({ dragDeltaX: 0, keyAxisX: dir });
        }

        // Historical snapshot captured at step 0 must never be mutated in place
        expect(snapAtZero).toEqual(frozenCopyAtZero);

        sim.retry();
        expect(sim.getSnapshot()).toEqual(freshSectorStart);
      }
    }

    sim.returnToTitle();
    expect(sim.getSnapshot()).toEqual(initialTitle);
  });
});
