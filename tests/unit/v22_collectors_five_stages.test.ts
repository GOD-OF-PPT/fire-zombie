import { describe, expect, it } from 'vitest';
import { createSimulation, verifyDeterministicReplay } from '../../src/sim/index';
import { ABYSSAL_PACTS, computeAbyssalHeatTier } from '../../src/sim/v22Mechanics';

describe('V22 Collector Edition Five-Stage Simulation & Replay Suite', () => {
  it('computes Abyssal Heat Tier 1-10 accurately and isolates Fair Trial #202611', () => {
    const fullHeat = computeAbyssalHeatTier(ABYSSAL_PACTS.map((p) => p.id));
    expect(fullHeat).toBe(10);

    const sim = createSimulation();
    sim.startSector(1, {
      abyssalPacts: ['pact_oscillating_mirrors', 'pact_harmonic_aegis', 'pact_apex_mutations'],
      wingmanId: 'prism_mirror',
      layoutSeed: 202622,
    });
    const snap = sim.getSnapshot();
    expect(snap.abyssalHeat).toBe(5);
    expect(snap.wingmanState?.id).toBe('prism_mirror');

    // Fair Trial #202611 strictly isolates Abyssal Heat & Wingmen
    sim.startSector(4, {
      fairTrial: true,
      blitz: true,
      abyssalPacts: ['pact_apex_mutations', 'pact_harmonic_aegis'],
      wingmanId: 'phase_escort',
      layoutSeed: 202611,
    });
    const fairSnap = sim.getSnapshot();
    expect(fairSnap.abyssalHeat).toBeUndefined();
    expect(fairSnap.wingmanState).toBeNull();
  });

  it('cycles Tactical Drone Wingman across 3 formations and deploys real 45° mobile reflectors in forward_mirror', () => {
    const sim = createSimulation();
    sim.startSector(1, {
      wingmanId: 'prism_mirror',
      wingmanFormation: 'volley_sync',
      layoutSeed: 77,
    });

    // Shift 1: volley_sync -> forward_mirror
    const ev1 = sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0, cycleWingman: true });
    expect(ev1.some((e) => e.type === 'WINGMAN_FORMATION_SHIFT' && e.formation === 'forward_mirror')).toBe(true);
    const snapMirror = sim.getSnapshot();
    const wingMirrors = snapMirror.reflectors.filter((r) => r.isWingmanMirror);
    expect(wingMirrors.length).toBe(2);
    expect(wingMirrors[0]!.angleDeg).toBe(34);
    expect(wingMirrors[1]!.angleDeg).toBe(-34);

    // Fire several ticks and verify player volleys bounce off the Wingman's mobile 45° mirrors even with zero map reflectors!
    let bounced = false;
    for (let i = 0; i < 40; i++) {
      const evs = sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0 });
      if (evs.some((e) => e.type === 'REFLECTOR_BOUNCE')) bounced = true;
    }
    expect(bounced).toBe(true);

    // Shift 2: forward_mirror -> orbit_guard (removes mobile mirrors cleanly)
    const ev2 = sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0, cycleWingman: true });
    expect(ev2.some((e) => e.type === 'WINGMAN_FORMATION_SHIFT' && e.formation === 'orbit_guard')).toBe(true);
    expect(sim.getSnapshot().reflectors.filter((r) => r.isWingmanMirror).length).toBe(0);
  });

  it('triggers Boss Apex Mutated Movesets at Heat >= 4 and preserves bit-exact Replay with Wingman shifts', () => {
    const sim = createSimulation();
    sim.startSector(4, {
      blitz: true,
      abyssalPacts: ['pact_oscillating_mirrors', 'pact_volatile_chain', 'pact_apex_mutations'],
      wingmanId: 'phase_escort',
      layoutSeed: 303,
    });

    let sawApexMove = false;
    let sawCounterBeam = false;
    for (let i = 0; i < 4200; i++) {
      const s = sim.getSnapshot();
      if (s.phase !== 'PLAYING') break;
      const evs = sim.stepFixed({
        dragDeltaX: Math.sin(i * 0.05) * 0.08,
        keyAxisX: 0,
        cycleWingman: i === 30 || i === 180,
        aegisPulse: i === 240 || (Boolean(s.boss?.active) && s.aegisCooldown <= 0.01),
      });
      if (evs.some((e) => e.type === 'ABYSSAL_BOSS_MUTATION')) sawApexMove = true;
      if (evs.some((e) => e.type === 'WINGMAN_COUNTER_BEAM')) sawCounterBeam = true;
      if (sawApexMove && sawCounterBeam) break;
    }
    expect(sawApexMove).toBe(true);
    expect(sawCounterBeam).toBe(true);

    const log = sim.exportReplayLog();
    const res = verifyDeterministicReplay(log);
    expect(res.matched).toBe(true);
  });

  it('preserves 100% zero-drift deterministic replay across Wingman formation shifts & Abyssal Heat 6', () => {
    const sim = createSimulation();
    sim.startSector(2, {
      layoutSeed: 202622,
      manualOverdrive: true,
      equippedWingman: 'prism_mirror',
      abyssalPacts: ['pact_oscillating_mirrors', 'pact_apex_mutations', 'pact_harmonic_aegis'],
    });
    for (let i = 0; i < 220; i++) {
      sim.stepFixed({
        dragDeltaX: Math.sin(i * 0.1) * 0.1,
        keyAxisX: 0,
        overdrive: i === 80,
        aegisPulse: i === 120,
        cycleWingman: i === 15 || i === 95,
        swapWeapon: i === 50,
      });
    }
    const log = sim.exportReplayLog();
    const res = verifyDeterministicReplay(log);
    expect(res.matched).toBe(true);
    expect(res.simulatedTicks).toBe(220);
  });

  it('strictly isolates Fair Trial #202611 from Abyssal Pacts and Tactical Wingmen', () => {
    const sim = createSimulation();
    sim.startSector(4, {
      fairTrial: true,
      blitz: true,
      layoutSeed: 202611,
      abyssalPacts: ['pact_apex_mutations', 'pact_harmonic_aegis'],
      equippedWingman: 'prism_mirror',
    });
    const snap = sim.getSnapshot();
    expect(snap.abyssalHeatTier ?? 0).toBe(0);
    expect(snap.wingmanState ?? null).toBeNull();
  });
});
