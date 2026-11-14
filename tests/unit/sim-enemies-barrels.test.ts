import { describe, expect, it } from 'vitest';
import {
  BARREL_BLAST_DAMAGE,
  DESPAWN_Z,
  FIXED_DT,
  PLAYER_Z,
  TRACK_HALF_WIDTH,
} from '../../src/config/constants';
import { SIPHON_MIN_GATE_VALUE } from '../../src/config/enemies';
import { damageBarrel, spawnBarrel } from '../../src/sim/barrels';
import { applyBarrelBlastToBoss } from '../../src/sim/bosses';
import { damageEnemy, spawnEnemy } from '../../src/sim/enemies';
import { spawnGateRow } from '../../src/sim/gates';
import { spawnVault } from '../../src/sim/weapons';
import {
  buildSimSnapshot,
  createSimWorld,
  reconcileFormationAndDps,
  resetSimWorldForSector,
  stepWorldFixed,
} from '../../src/sim/world';

function createCleanCombatWorld() {
  const world = createSimWorld();
  resetSimWorldForSector(world, 1);
  world.gateRowPool.releaseAll(world.gateRows);
  world.gatePool.releaseAll(world.gates);
  world.vaultPool.releaseAll(world.vaults);
  world.enemyPool.releaseAll(world.enemies);
  world.barrelPool.releaseAll(world.barrels);
  world.lensPool.releaseAll(world.lenses);
  world.projectilePool.releaseAll(world.projectiles);
  world.scrollDistance = 850;
  world.currentScrollSpeed = 0;
  world.runwayProgress = 1.0;
  world.bossSpawned = true;
  world.fireCooldown = 999;
  reconcileFormationAndDps(world);
  return world;
}

describe('5 Malware Enemy Archetypes, Fair Breach vs Dodge & Order-Invariant Surge Barrels', () => {
  it('verifies Vector Dasher exact 39-tick (0.65s) laser telegraph brake before 2.2x dash ([BUG-SIM-02])', () => {
    const world = createCleanCombatWorld();
    world.currentScrollSpeed = 14.0;
    world.scrollDistance = 100; // Active runway context

    // Spawn at z = -34.0 so Step 4 immediately enters TELEGRAPH
    const dasher = spawnEnemy(world, 'dasher', 0, -34.0, { hp: 26 });

    // Ticks 1..38: dasher stays in TELEGRAPH with telegraphTimer > 0 and slow brake vz = 1.5
    for (let tick = 1; tick <= 38; tick++) {
      world.scrollDistance = 100;
      stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
      expect(dasher.dasherState).toBe('TELEGRAPH');
      expect(dasher.telegraphTimer).toBeGreaterThan(0);
    }

    // Exact tick 39 (39 / 60 = 0.6500s): telegraphTimer snaps cleanly to 0 and transitions to DASH
    world.scrollDistance = 100;
    stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(dasher.telegraphTimer).toBe(0);
    expect(dasher.dasherState).toBe('DASH');

    // Tick 40: moves at 2.2 * (14.0 + 1.0) = 33.0 u/s!
    const zBeforeDash = dasher.z;
    world.scrollDistance = 100;
    stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(dasher.z - zBeforeDash).toBeCloseTo(33.0 * FIXED_DT, 9);
  });

  it('verifies Bastion partial-HP breach scaling, Mitosis wall-clamped combat-only split (non-recursive), and Siphon -1/s drain + +6 kill bonus', () => {
    // 1. Bastion breach loss scales with remaining HP: 110 -> 8, 56 -> 4, 14 -> 1
    for (const [remHp, expectedLost] of [
      [110, 8],
      [56, 4],
      [14, 1],
    ] as const) {
      const w = createCleanCombatWorld();
      w.squadCount = 20;
      w.squadX = 0;
      reconcileFormationAndDps(w);

      spawnEnemy(w, 'bastion', 0, PLAYER_Z - 0.05, { hp: remHp });
      stepWorldFixed(w, { dragDeltaX: 0, keyAxisX: 0 });
      expect(w.squadCount).toBe(20 - expectedLost);
    }

    // 2. Mitosis Node splits ONLY on fatal combat hit, clamps children inside [-5, +5], and never splits recursively
    const mitWorld = createCleanCombatWorld();
    const rightEdgeMitosis = spawnEnemy(mitWorld, 'mitosis', 4.9, -10.0);
    damageEnemy(mitWorld, rightEdgeMitosis, 100, 0, []);

    const activeShards = mitWorld.enemies.filter((e) => e.active && !e.consumed);
    expect(activeShards.length).toBe(2);
    expect(Math.abs(activeShards[1]!.x - activeShards[0]!.x)).toBeCloseTo(2.2, 9);
    for (const shard of activeShards) {
      expect(shard.kind).toBe('crawler');
      expect(shard.mitosisGeneration).toBe(1);
      expect(Math.abs(shard.x) + shard.radius).toBeLessThanOrEqual(TRACK_HALF_WIDTH + 1e-9);
    }

    // Killing generation-1 shard MUST NOT split again!
    damageEnemy(mitWorld, activeShards[0]!, 100, 0, []);
    expect(mitWorld.enemies.filter((e) => e.active && !e.consumed).length).toBe(1);

    // Breaching a Mitosis Node at PLAYER_Z MUST NOT spawn split children
    const breachMitWorld = createCleanCombatWorld();
    breachMitWorld.squadCount = 15;
    spawnEnemy(breachMitWorld, 'mitosis', 0, PLAYER_Z - 0.05);
    stepWorldFixed(breachMitWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(breachMitWorld.squadCount).toBe(11);
    expect(breachMitWorld.enemies.length).toBe(0);

    // 3. Corruptor Siphon drains linked gate -1/s down to -30 floor and injects +6 on combat kill
    const siphonWorld = createCleanCombatWorld();
    const row = spawnGateRow(siphonWorld, {
      layout: 'standalone',
      z: -20.0,
      vz: 0,
      single: {
        x: 0,
        halfWidth: 2.2,
        op: 'sub',
        value: 28,
        mutable: true,
        damagePerStep: 10,
        stepDelta: 1,
        maxValue: 12,
        minValue: -35,
      },
    });
    const gate = siphonWorld.gates.find((g) => g.rowId === row.id)!;
    const siphon = spawnEnemy(siphonWorld, 'siphon', 0, -15.0, { linkedGateId: gate.id });
    // Freeze siphon Z so it drains in place for 4 seconds (240 ticks)
    for (let tick = 1; tick <= 240; tick++) {
      siphon.z = -15.0;
      stepWorldFixed(siphonWorld, { dragDeltaX: 0, keyAxisX: 0 });
      if (tick === 60) expect(gate.value).toBe(-29);
      if (tick === 120) expect(gate.value).toBe(-30);
    }
    // Clamped at floor -30 even after 4 seconds!
    expect(gate.value).toBe(SIPHON_MIN_GATE_VALUE);
    expect(gate.label).toBe('-30');

    // Killing the Siphon injects +6 -> -24
    const killEvents: Parameters<typeof damageEnemy>[4] = [];
    damageEnemy(siphonWorld, siphon, 100, 0, killEvents);
    expect(gate.value).toBe(-24);
    expect(gate.label).toBe('-24');
    expect(killEvents.some((e) => e.type === 'GATE_HIT' && e.newValue === -24)).toBe(true);
  });

  it('prevents phantom rear hits when dragging squad onto a dodged (bypassed) enemy behind PLAYER_Z', () => {
    const world = createCleanCombatWorld();
    world.squadCount = 10;
    world.squadX = -3.0;
    reconcileFormationAndDps(world);

    const enemy = spawnEnemy(world, 'crawler', 2.5, PLAYER_Z - 0.05);

    // Tick 1: enemy crosses PLAYER_Z at x = +2.5 while squad is at x = -3.0 -> dodged cleanly!
    const ev1 = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(ev1.some((e) => e.type === 'SQUAD_LOSS')).toBe(false);
    expect(enemy.bypassed).toBe(true);
    expect(enemy.z).toBeGreaterThanOrEqual(PLAYER_Z);

    // Tick 2..5: drag squad directly onto x = +2.5 where bypassed enemy is still departing toward DESPAWN_Z
    const ev2 = stepWorldFixed(world, { dragDeltaX: 5.5, keyAxisX: 0 });
    expect(ev2.some((e) => e.type === 'SQUAD_LOSS')).toBe(false);
    expect(world.squadCount).toBe(10);
  });

  it('executes cycle-safe mutual A<->B barrels, 130 AoE + +5 gate boost, order-invariant 7-tick (>=0.11s) 4-barrel chains, and detonated snapshot visibility ([BUG-BARREL-1/2])', () => {
    // 1. Mutual A <-> B cycle safety + AoE effects
    const cycleWorld = createCleanCombatWorld();
    const bA = spawnBarrel(cycleWorld, -0.5, -10.0, 0);
    const bB = spawnBarrel(cycleWorld, 0.5, -10.0, 0);
    const victim = spawnEnemy(cycleWorld, 'bastion', 0, -9.0, { hp: 200 });
    const vault = spawnVault(cycleWorld, -2.0, -10.0, 0, 100, 'plasma');
    spawnGateRow(cycleWorld, {
      layout: 'standalone',
      z: -12.0,
      vz: 0,
      single: {
        x: 0,
        halfWidth: 2.2,
        op: 'sub',
        value: 2,
        mutable: true,
        damagePerStep: 10,
        stepDelta: 1,
        maxValue: 12,
      },
    });
    const gate = cycleWorld.gates[0]!;

    const initEvents: Parameters<typeof damageBarrel>[3] = [];
    damageBarrel(cycleWorld, bA, 20, initEvents, applyBarrelBlastToBoss);
    expect(initEvents.filter((e) => e.type === 'BARREL_EXPLODE').length).toBe(1);
    expect(victim.hp).toBe(200 - BARREL_BLAST_DAMAGE);
    expect(vault.broken).toBe(true);
    expect(gate.value).toBe(3); // -2 + 5 = +3!
    expect(gate.polarity).toBe('positive');

    let bExplodeTick = -1;
    for (let tick = 1; tick <= 12; tick++) {
      const evs = stepWorldFixed(cycleWorld, { dragDeltaX: 0, keyAxisX: 0 });
      if (evs.some((e) => e.type === 'BARREL_EXPLODE')) {
        expect(bExplodeTick).toBe(-1); // Never explodes more than once!
        bExplodeTick = tick;
        // [BUG-BARREL-2]: chained barrel B must expose detonated: true in getSnapshot()!
        const snap = buildSimSnapshot(cycleWorld);
        expect(snap.barrels.some((sb) => sb.id === bB.id && sb.detonated)).toBe(true);
      }
    }
    expect(bExplodeTick).toBe(7); // 7 / 60 = 0.1167s >= 0.11s!
    expect(cycleWorld.stats.maxChain).toBe(2);

    // 2. [BUG-BARREL-1]: 4-barrel chain is 100% order-invariant (Forward vs Reverse spawn order)
    const runFourBarrelChain = (reverseOrder: boolean) => {
      const w = createCleanCombatWorld();
      const coords = [-3.0, 0.0, 3.0, 3.0];
      const zCoords = [-8.0, -10.5, -13.0, -16.8];
      const indices = reverseOrder ? [3, 2, 1, 0] : [0, 1, 2, 3];
      const byLogicalIdx: ReturnType<typeof spawnBarrel>[] = [];

      for (const idx of indices) {
        byLogicalIdx[idx] = spawnBarrel(w, coords[idx]!, zCoords[idx]!, 0);
      }

      // Shoot logical barrel 0 via projectile in Step 5 of tick 0
      const shot = w.projectilePool.acquire();
      shot.id = 6001;
      shot.x = -3.0;
      shot.z = -6.0;
      shot.prevX = -3.0;
      shot.prevZ = -6.0;
      shot.vx = 0;
      shot.vz = -240;
      shot.radius = 0.2;
      shot.weapon = 'pulse';
      shot.damage = 25;
      shot.remainingPierce = 0;
      shot.maxRange = 60;
      shot.active = true;
      w.projectiles.push(shot);

      const explosionLog: Array<{ tick: number; chainIndex: number }> = [];
      for (let tick = 0; tick <= 25; tick++) {
        const evs = stepWorldFixed(w, { dragDeltaX: 0, keyAxisX: 0 });
        for (const ev of evs) {
          if (ev.type === 'BARREL_EXPLODE') {
            explosionLog.push({ tick, chainIndex: ev.chainIndex });
            const snap = buildSimSnapshot(w);
            expect(snap.barrels.some((b) => b.detonated)).toBe(true);
          }
        }
      }
      return { explosionLog, maxChain: w.stats.maxChain };
    };

    const forwardRes = runFourBarrelChain(false);
    const reverseRes = runFourBarrelChain(true);

    expect(forwardRes.explosionLog).toEqual([
      { tick: 0, chainIndex: 1 },
      { tick: 7, chainIndex: 2 },
      { tick: 14, chainIndex: 3 },
      { tick: 21, chainIndex: 4 },
    ]);
    expect(reverseRes).toEqual(forwardRes);
    expect(forwardRes.maxChain).toBe(4);

    // 3. Un-shot barrel passes PLAYER_Z and DESPAWN_Z harmlessly
    const passWorld = createCleanCombatWorld();
    passWorld.squadCount = 9;
    spawnBarrel(passWorld, 0, PLAYER_Z - 0.5, 25.0);
    while (passWorld.barrels.length > 0 && passWorld.simTime < 2.0) {
      const evs = stepWorldFixed(passWorld, { dragDeltaX: 0, keyAxisX: 0 });
      expect(evs.some((e) => e.type === 'SQUAD_LOSS')).toBe(false);
    }
    expect(passWorld.squadCount).toBe(9);
    expect(DESPAWN_Z).toBe(12.0);
  });
});
