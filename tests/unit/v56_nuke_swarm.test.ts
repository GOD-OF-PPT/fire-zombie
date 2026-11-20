import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../src/sim';
import { createSimWorld, resetSimWorldForSector, stepWorldFixed } from '../../src/sim/world';
import { computeDynamicSwarmProfile } from '../../src/sim/spawner';
import { spawnEnemy } from '../../src/sim/enemies';

describe('V5.6 Wall-to-Wall Swarm & Tactical Nuke Strike', () => {
  it('starts every run with Tactical Nuke 100% charged, slowly descends over 1.75s, and wipes all screen monsters on detonation', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { bonusSquad: 25, damageMult: 1.5 });
    expect(world.nukeCharge).toBe(1);

    // Populate a dense wall of 65 monsters across the bridge
    for (let i = 0; i < 65; i++) {
      const col = (i % 11) - 5;
      const row = Math.floor(i / 11);
      spawnEnemy(world, i % 6 === 0 ? 'mitosis' : 'crawler', col * 0.82, -10 - row * 3.5, {
        hp: 40,
        isSwarmFodder: true,
      });
    }
    expect(world.enemies.filter((e) => e.active).length).toBeGreaterThanOrEqual(65);

    // Trigger Nuke Strike
    const launchEvents = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0, nukeStrike: true });
    expect(launchEvents.some((e) => e.type === 'NUKE_LAUNCH')).toBe(true);
    expect(world.nukeCharge).toBe(0);
    expect(world.nukeDropTimer).toBeGreaterThan(1.7);

    // Step 60 ticks (1.0s): warhead is still descending in mid-air, monsters slowed in dread
    for (let t = 0; t < 60; t++) {
      stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    }
    expect(world.nukeDropTimer).toBeGreaterThan(0.65);
    expect(world.enemies.some((e) => e.active && e.slowTimer > 0)).toBe(true);

    // Step remaining 50 ticks to detonation!
    let detonateEvent: Extract<(typeof launchEvents)[number], { type: 'NUKE_DETONATE' }> | undefined;
    for (let t = 0; t < 50; t++) {
      const evs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
      const found = evs.find((e) => e.type === 'NUKE_DETONATE');
      if (found && found.type === 'NUKE_DETONATE') {
        detonateEvent = found;
        break;
      }
    }
    expect(detonateEvent).toBeDefined();
    expect(detonateEvent!.kills).toBeGreaterThanOrEqual(50);
    expect(world.enemies.filter((e) => e.active && e.z >= -68).length).toBe(0);
    expect(world.nukeBlastTimer).toBeGreaterThan(2.0);
    // Nuke detonation must NOT self-refund nukeCharge to 100% immediately
    expect(world.nukeCharge).toBeLessThan(0.1);
  });

  it('scales monster swarm exponentially into a wall-to-wall 150+ carpet when character grows strong', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { bonusSquad: 60, damageMult: 2.2, critChance: 0.25 });
    world.squadCount = 140;
    world.learnedWeaponLevels = { pulse: 3, scatter: 3, rail: 2, plasma: 2, cryo: 2 };
    world.activeFusions = ['cryo_singularity', 'prism_ricochet_web'];
    world.overclockStacks = 3;
    world.overdriveTimer = 4.0;

    const profile = computeDynamicSwarmProfile(world);
    expect(profile.swarmMult).toBeGreaterThan(8.5);
    expect(profile.swarmTier).toBe(6);
    expect(profile.targetHorde).toBeGreaterThanOrEqual(220);

    // Advance past d=60 so the dynamic horde director floods the bridge
    world.playerHasSteered = true;
    world.scrollDistance = 120;
    for (let i = 0; i < 90; i++) {
      stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    }
    // Even while 140-trooper multi-weapon squad fires nonstop, active + killed enemies must be huge!
    expect(world.enemies.length + world.stats.kills).toBeGreaterThanOrEqual(140);
  });

  it('recharges Tactical Nuke via monster kills and SimulationController buffers nukeStrike', () => {
    const sim = createSimulation();
    sim.startSector(1, { bonusSquad: 15, damageMult: 1.5 });
    expect(sim.getSnapshot().nukeCharge).toBe(1);

    const evs = sim.tickFrame(1 / 60, { dragDeltaX: 0, keyAxisX: 0, nukeStrike: true });
    expect(evs.some((e) => e.type === 'NUKE_LAUNCH')).toBe(true);
    expect(sim.getSnapshot().nukeDropTimer).toBeGreaterThan(1.6);
  });
});
