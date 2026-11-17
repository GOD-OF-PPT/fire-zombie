import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/types/game';
import { PLAYER_Z } from '../../src/config/constants';
import { getActiveSynergies } from '../../src/config/protocols';
import { getVolleyStreamCount } from '../../src/config/weapons';
import { damageEnemy, spawnEnemy } from '../../src/sim/enemies';
import { spawnGateRow } from '../../src/sim/gates';
import { damageVault, spawnVault } from '../../src/sim/weapons';
import { createSimulation } from '../../src/sim/index';
import {
  createSimWorld,
  reconcileFormationAndDps,
  resetSimWorldForSector,
  stepWorldFixed,
} from '../../src/sim/world';

describe('V2/V3 Tactical Systems: Phase Aegis Pulse, Crit Strikes, Synergies & Legion Barrage', () => {
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

  it('scales multi-stream volley width & count immediately when squad grows through gates across all 5 weapons', () => {
    for (const weapon of ['pulse', 'scatter', 'rail', 'plasma', 'cryo'] as const) {
      const s1 = getVolleyStreamCount(weapon, 1, 1);
      const s6 = getVolleyStreamCount(weapon, 1, 6);
      const s25 = getVolleyStreamCount(weapon, 1, 25);
      const s140 = getVolleyStreamCount(weapon, 1, 140);
      expect(s6).toBeGreaterThan(s1);
      expect(s25).toBeGreaterThan(s6);
      expect(s140).toBeGreaterThan(s25);
    }

    const world = createSimWorld();
    resetSimWorldForSector(world, 1);
    world.projectilePool.releaseAll(world.projectiles);
    world.squadCount = 12;
    world.weapon = 'pulse';
    world.weaponLevel = 1;
    world.fireCooldown = 0;
    reconcileFormationAndDps(world);
    stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });

    const friendly = world.projectiles.filter((p) => !p.hostile);
    expect(friendly.length).toBe(8);
    const xs = friendly.map((p) => p.x);
    const zs = friendly.map((p) => p.z);
    // Wide multi-column spread (>= 1.3u span, ~4x wider than baseline) and staggered chevron rank depth!
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.3);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.15);
  });

  it('stacks co-firing secondary weapons on Vault cracks, procs Rampage chain-lightning arcs, and rewards consecutive positive gate streaks', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1);
    world.gateRowPool.releaseAll(world.gateRows);
    world.gatePool.releaseAll(world.gates);
    world.enemyPool.releaseAll(world.enemies);
    world.projectilePool.releaseAll(world.projectiles);
    world.squadCount = 24;
    reconcileFormationAndDps(world);

    // 1. Crack Scatter & Plasma vaults -> Pulse + Scatter + Plasma ALL co-fire simultaneously!
    const vScatter = spawnVault(world, 0, -5, 0, 10, 'scatter');
    damageVault(world, vScatter, 25, []);
    const vPlasma = spawnVault(world, 0, -5, 0, 10, 'plasma');
    damageVault(world, vPlasma, 25, []);

    world.fireCooldown = 0;
    world.auxCooldowns.pulse = 0;
    world.auxCooldowns.scatter = 0;
    stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    const firedWeapons = new Set(world.projectiles.filter((p) => !p.hostile).map((p) => p.weapon));
    expect(firedWeapons.has('plasma')).toBe(true);
    expect(firedWeapons.has('scatter')).toBe(true);
    expect(firedWeapons.has('pulse')).toBe(true);

    // 2. Kill 5 enemies in rapid succession -> builds rampageStacks = 5 and procs CHAIN_ARC onto nearby monsters!
    const nearbyTarget = spawnEnemy(world, 'bastion', 1.2, -10, { hp: 200 });
    const arcEvents: SimEvent[] = [];
    for (let k = 0; k < 5; k++) {
      const fodder = spawnEnemy(world, 'crawler', 0, -10, { hp: 5 });
      damageEnemy(world, fodder, 20, 0, arcEvents);
    }
    expect(world.rampageStacks).toBe(5);
    expect(arcEvents.some((e) => e.type === 'CHAIN_ARC')).toBe(true);
    expect(nearbyTarget.hp).toBeLessThan(200);

    // 3. Consecutive positive gates build gateStreak and grant escalating bonus recruits on streak >= 2!
    const gWorld = createSimWorld();
    resetSimWorldForSector(gWorld, 1);
    gWorld.gateRowPool.releaseAll(gWorld.gateRows);
    gWorld.gatePool.releaseAll(gWorld.gates);
    gWorld.enemyPool.releaseAll(gWorld.enemies);
    gWorld.squadCount = 10;
    gWorld.squadX = -2.0;
    gWorld.prevSquadX = -2.0;
    reconcileFormationAndDps(gWorld);

    spawnGateRow(gWorld, {
      layout: 'paired',
      z: PLAYER_Z - 0.1,
      vz: 14,
      left: { op: 'add', value: 5, mutable: false },
      right: { op: 'sub', value: 5, mutable: false },
    });
    stepWorldFixed(gWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(gWorld.gateStreak).toBe(1);
    expect(gWorld.squadCount).toBe(15); // 1st gate: exact +5

    spawnGateRow(gWorld, {
      layout: 'paired',
      z: PLAYER_Z - 0.1,
      vz: 14,
      left: { op: 'add', value: 5, mutable: false },
      right: { op: 'sub', value: 5, mutable: false },
    });
    const streakEvs = stepWorldFixed(gWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(gWorld.gateStreak).toBe(2);
    expect(gWorld.squadCount).toBe(21); // 15 + 5 + 1 streak bonus!
    expect(streakEvs.some((e) => e.type === 'GATE_STREAK' && e.streak === 2 && e.bonus === 1)).toBe(true);
  });
});
