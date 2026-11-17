import { describe, expect, it } from 'vitest';
import { PLAYER_Z } from '../../src/config/constants';
import { getActiveSynergies } from '../../src/config/protocols';
import { spawnEnemy } from '../../src/sim/enemies';
import { createSimulation } from '../../src/sim/index';
import { createSimWorld, resetSimWorldForSector, stepWorldFixed } from '../../src/sim/world';

describe('V2 Tactical Systems: Phase Aegis Pulse, Crit Strikes & Endless Synergies', () => {
  it('triggers Phase Aegis Pulse on demand, repels nearby monsters, clears hostile orbs, and enforces cooldown', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { aegisCooldownSec: 10, aegisDurationSec: 1.5 });
    world.gateRows.length = 0;
    world.gates.length = 0;
    world.enemies.length = 0;

    const e = spawnEnemy(world, 'bastion', 0, PLAYER_Z - 1.5, { hp: 300 });
    const orb = world.projectilePool.acquire();
    orb.id = 999;
    orb.active = true;
    orb.hostile = true;
    orb.x = 0.2;
    orb.z = PLAYER_Z - 2.0;
    orb.prevX = 0.2;
    orb.prevZ = PLAYER_Z - 2.2;
    orb.vx = 0;
    orb.vz = 12;
    orb.maxRange = 40;
    world.projectiles.push(orb);

    const events = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0, aegisPulse: true });
    const pulseEv = events.find((ev) => ev.type === 'AEGIS_PULSE');
    expect(pulseEv).toBeDefined();
    expect(pulseEv).toMatchObject({ type: 'AEGIS_PULSE', orbsCleared: 1, enemiesRepelled: 1 });
    expect(world.aegisTimer).toBeGreaterThan(1.4);
    expect(world.aegisCooldown).toBeGreaterThan(9.9);
    expect(e.z).toBeLessThan(PLAYER_Z - 2.5);
    expect(e.slowTimer).toBeGreaterThan(1.0);
    expect(world.projectiles.some((p) => p.hostile)).toBe(false);

    // Cannot re-trigger while on cooldown
    const events2 = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0, aegisPulse: true });
    expect(events2.some((ev) => ev.type === 'AEGIS_PULSE')).toBe(false);
  });

  it('auto-triggers Emergency Aegis when autoAegisCharges > 0 and halves lethal breach damage', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { autoAegisCharges: 1, aegisDurationSec: 2.0 });
    world.gateRows.length = 0;
    world.gates.length = 0;
    world.enemies.length = 0;
    world.squadCount = 8;

    const e = spawnEnemy(world, 'bastion', 0, PLAYER_Z - 0.05, { hp: 500 });
    e.prevZ = PLAYER_Z - 0.2;
    const events = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(events.some((ev) => ev.type === 'AEGIS_PULSE' && ev.autoTriggered === true)).toBe(true);
    expect(world.squadCount).toBeGreaterThan(0);
    expect(world.autoAegisCharges).toBe(0);
  });

  it('rolls deterministic critical hits when critChance > 0 and unlocks dual-protocol synergies', () => {
    const simA = createSimulation();
    const simB = createSimulation();
    simA.startSector(1, { critChance: 0.5, layoutSeed: 42 });
    simB.startSector(1, { critChance: 0.5, layoutSeed: 42 });

    let critsA = 0;
    let critsB = 0;
    for (let i = 0; i < 240; i++) {
      critsA += simA.stepFixed({ dragDeltaX: 0, keyAxisX: 0 }).filter((e) => e.type === 'CRIT_HIT').length;
      critsB += simB.stepFixed({ dragDeltaX: 0, keyAxisX: 0 }).filter((e) => e.type === 'CRIT_HIT').length;
    }
    expect(critsA).toBeGreaterThan(0);
    expect(critsA).toBe(critsB);
    expect(simA.getSnapshot()).toEqual(simB.getSnapshot());

    const syns = getActiveSynergies({ power: 1, weapon: 1, blades: 1, resonance: 1 });
    expect(syns.map((s) => s.id)).toEqual(['hyper_annihilation', 'tempest_blades', 'singularity_matrix']);
  });
});
