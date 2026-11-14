import { describe, expect, it } from 'vitest';
import { PLAYER_Z } from '../../src/config/constants';
import { spawnEnemy } from '../../src/sim/enemies';
import { applyFlatDeltaToGate, applyProjectileHitToGate, spawnGateRow } from '../../src/sim/gates';
import {
  buildSimSnapshot,
  createSimWorld,
  reconcileFormationAndDps,
  resetSimWorldForSector,
  stepWorldFixed,
} from '../../src/sim/world';

function createCleanGateWorld() {
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

describe('Number Gates: Wide-Squad Row Mutex, Standalone Dodge, Shoot-to-Improve, Lock-Flip & Siphon Non-Farming', () => {
  it('enforces gap-free single-trigger GateRow mutex across squadX in {-2.5, -0.0001, 0, +0.0001, +2.5} even for 150-drone max-width squads', () => {
    const cases: Array<{ x: number; expectedAfter: number; chosenSide: 'left' | 'right' }> = [
      { x: -2.5, expectedAfter: 160, chosenSide: 'left' },
      { x: -0.0001, expectedAfter: 160, chosenSide: 'left' },
      { x: 0, expectedAfter: 300, chosenSide: 'right' },
      { x: 0.0001, expectedAfter: 300, chosenSide: 'right' },
      { x: 2.5, expectedAfter: 300, chosenSide: 'right' },
    ];

    for (const tc of cases) {
      const world = createCleanGateWorld();
      world.squadCount = 150;
      reconcileFormationAndDps(world);
      world.squadX = tc.x;
      world.prevSquadX = tc.x;

      spawnGateRow(world, {
        layout: 'paired',
        z: PLAYER_Z - 0.1,
        vz: 15.0,
        dividerX: 0,
        left: { op: 'add', value: 10, mutable: false },
        right: { op: 'mul', value: 2, mutable: false },
      });

      const allPassEvents = [];
      for (let tick = 0; tick < 5; tick++) {
        const evs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
        for (const e of evs) {
          if (e.type === 'GATE_PASS') allPassEvents.push(e);
        }
      }

      expect(allPassEvents.length).toBe(1);
      expect(world.squadCount).toBe(tc.expectedAfter);

      const snap = buildSimSnapshot(world);
      const leftSnap = snap.gates.find((g) => g.x < 0)!;
      const rightSnap = snap.gates.find((g) => g.x > 0)!;
      if (tc.chosenSide === 'left') {
        expect(leftSnap.triggered).toBe(true);
        expect(leftSnap.dimmed).toBe(false);
        expect(rightSnap.triggered).toBe(false);
        expect(rightSnap.dimmed).toBe(true);
      } else {
        expect(rightSnap.triggered).toBe(true);
        expect(rightSnap.dimmed).toBe(false);
        expect(leftSnap.triggered).toBe(false);
        expect(leftSnap.dimmed).toBe(true);
      }
    }
  });

  it('allows dodging standalone gates cleanly while triggering when overlapping', () => {
    // 1. Clean lateral dodge (0 squad loss)
    const dodgeWorld = createCleanGateWorld();
    dodgeWorld.squadCount = 20;
    dodgeWorld.squadX = -2.2;
    reconcileFormationAndDps(dodgeWorld);

    spawnGateRow(dodgeWorld, {
      layout: 'standalone',
      z: PLAYER_Z - 0.1,
      vz: 14.0,
      single: { x: 2.6, halfWidth: 1.9, op: 'sub', value: 8, mutable: false },
    });

    const dodgeEvents = stepWorldFixed(dodgeWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(dodgeWorld.squadCount).toBe(20);
    expect(dodgeEvents.some((e) => e.type === 'GATE_PASS')).toBe(false);
    expect(dodgeEvents.some((e) => e.type === 'SQUAD_LOSS')).toBe(false);
    expect(dodgeWorld.gates[0]!.dimmed).toBe(true);
    expect(dodgeWorld.gates[0]!.triggered).toBe(false);

    // 2. Direct overlap triggers standalone gate once
    const hitWorld = createCleanGateWorld();
    hitWorld.squadCount = 20;
    hitWorld.squadX = 2.4;
    reconcileFormationAndDps(hitWorld);

    spawnGateRow(hitWorld, {
      layout: 'standalone',
      z: PLAYER_Z - 0.1,
      vz: 14.0,
      single: { x: 2.6, halfWidth: 1.9, op: 'sub', value: 8, mutable: false },
    });

    const hitEvents = stepWorldFixed(hitWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(hitWorld.squadCount).toBe(12);
    expect(hitEvents.some((e) => e.type === 'GATE_PASS' && e.delta === -8)).toBe(true);
    expect(hitWorld.gates[0]!.triggered).toBe(true);
  });

  it('atomically syncs op, value, polarity, and label across -2 -> -1 -> 0 -> +1 and flips same-tick Step 5 before Step 8 crossing', () => {
    const world = createCleanGateWorld();
    spawnGateRow(world, {
      layout: 'standalone',
      z: 0,
      vz: 0,
      single: {
        x: 0,
        halfWidth: 2.2,
        op: 'sub',
        value: 2,
        mutable: true,
        damagePerStep: 10,
        stepDelta: 1,
        maxValue: 5,
      },
    });
    const gate = world.gates[0]!;
    const events: Parameters<typeof applyProjectileHitToGate>[3] = [];

    expect({ op: gate.op, val: gate.value, pol: gate.polarity, lbl: gate.label }).toEqual({
      op: 'sub',
      val: -2,
      pol: 'negative',
      lbl: '-2',
    });

    // Partial charge (+5 dmg) updates chargeRatio without stepping
    applyProjectileHitToGate(world, gate, 5, events);
    expect(gate.value).toBe(-2);
    expect(gate.chargeRatio).toBeCloseTo(0.5, 6);

    // Complete first step -> -1
    applyProjectileHitToGate(world, gate, 5, events);
    expect({ op: gate.op, val: gate.value, pol: gate.polarity, lbl: gate.label }).toEqual({
      op: 'sub',
      val: -1,
      pol: 'negative',
      lbl: '-1',
    });
    expect(world.stats.gatesImproved).toBe(0);

    // Step -> 0 (neutral, never "-0")
    applyProjectileHitToGate(world, gate, 10, events);
    expect({ op: gate.op, val: gate.value, pol: gate.polarity, lbl: gate.label }).toEqual({
      op: 'add',
      val: 0,
      pol: 'neutral',
      lbl: '0',
    });
    expect(Object.is(gate.value, -0)).toBe(false);
    expect(world.stats.gatesImproved).toBe(0);

    // Step -> +1 (positive flip!)
    events.length = 0;
    applyProjectileHitToGate(world, gate, 10, events);
    expect({ op: gate.op, val: gate.value, pol: gate.polarity, lbl: gate.label }).toEqual({
      op: 'add',
      val: 1,
      pol: 'positive',
      lbl: '+1',
    });
    expect(gate.flipPulse).toBe(1.0);
    expect(world.stats.gatesImproved).toBe(1);
    expect(events[0]).toMatchObject({ type: 'GATE_HIT', newValue: 1, flippedPositive: true });

    // Same-tick Step 5 projectile gate flip BEFORE Step 8 squad crossing
    const crossWorld = createCleanGateWorld();
    crossWorld.squadCount = 5;
    crossWorld.squadX = 0;
    reconcileFormationAndDps(crossWorld);

    spawnGateRow(crossWorld, {
      layout: 'standalone',
      z: PLAYER_Z - 0.1,
      vz: 12.0, // Crosses PLAYER_Z on this tick in Step 4!
      single: {
        x: 0,
        halfWidth: 2.2,
        op: 'sub',
        value: 1,
        mutable: true,
        damagePerStep: 10,
        stepDelta: 1,
        maxValue: 8,
      },
    });

    const bolt = crossWorld.projectilePool.acquire();
    bolt.id = 8801;
    bolt.x = 0;
    bolt.z = PLAYER_Z + 0.1;
    bolt.prevX = 0;
    bolt.prevZ = PLAYER_Z + 0.1;
    bolt.vx = 0;
    bolt.vz = -60;
    bolt.radius = 0.15;
    bolt.weapon = 'pulse';
    bolt.damage = 20; // Flips -1 -> +1 in Step 5 before Step 8 evaluates crossing!
    bolt.remainingPierce = 0;
    bolt.maxRange = 60;
    bolt.active = true;
    crossWorld.projectiles.push(bolt);

    const tickEvents = stepWorldFixed(crossWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(crossWorld.squadCount).toBe(6);
    expect(tickEvents.some((e) => e.type === 'GATE_HIT' && e.newValue === 1)).toBe(true);
    expect(tickEvents.some((e) => e.type === 'GATE_PASS' && e.delta === 1)).toBe(true);
  });

  it('flips Lock-Flip gates from ÷2 -> ×2 when lockHp breaks to 0 and prevents Siphon flip-bonus farming ([BUG-SIM-01])', () => {
    const world = createCleanGateWorld();
    spawnGateRow(world, {
      layout: 'paired',
      z: -10,
      vz: 0,
      left: { op: 'div', value: 2, mutable: true, lockHp: 80 },
      right: {
        op: 'sub',
        value: 1,
        mutable: true,
        damagePerStep: 10,
        stepDelta: 1,
        maxValue: 10,
      },
    });

    const lockGate = world.gates.find((g) => g.x < 0)!;
    const linearGate = world.gates.find((g) => g.x > 0)!;
    const events: Parameters<typeof applyProjectileHitToGate>[3] = [];

    expect(lockGate.label).toBe('÷2');
    expect(lockGate.polarity).toBe('negative');

    applyProjectileHitToGate(world, lockGate, 50, events);
    expect(lockGate.lockHp).toBe(30);
    expect(lockGate.label).toBe('÷2');
    expect(lockGate.chargeRatio).toBeCloseTo(50 / 80, 5);

    applyProjectileHitToGate(world, lockGate, 40, events);
    expect(lockGate.lockHp).toBe(0);
    expect(lockGate.op).toBe('mul');
    expect(lockGate.value).toBe(2);
    expect(lockGate.label).toBe('×2');
    expect(lockGate.polarity).toBe('positive');
    expect(world.stats.gatesImproved).toBe(1);
    expect(world.resonance).toBeCloseTo(0.35, 9);

    // Extra hits after lock broken do not double-count gatesImproved
    applyProjectileHitToGate(world, lockGate, 40, events);
    expect(lockGate.label).toBe('×2');
    expect(world.stats.gatesImproved).toBe(1);

    // [BUG-SIM-01]: Siphon flip-farming regression check on linearGate
    // 1. Shoot -1 -> +1 (awards flip bonus once: gatesImproved becomes 2, resonance becomes 0.70)
    applyProjectileHitToGate(world, linearGate, 20, events);
    expect(linearGate.label).toBe('+1');
    expect(world.stats.gatesImproved).toBe(2);
    expect(world.resonance).toBeCloseTo(0.7, 9);

    // 2. Corruptor Siphon drains +1 -> -1
    applyFlatDeltaToGate(world, linearGate, -2, false, events);
    expect(linearGate.label).toBe('-1');
    expect(linearGate.polarity).toBe('negative');

    // 3. Player shoots -1 -> +1 again: gate flips back to +1, but MUST NOT farm gatesImproved or Resonance!
    events.length = 0;
    applyProjectileHitToGate(world, linearGate, 20, events);
    expect(linearGate.label).toBe('+1');
    expect(linearGate.polarity).toBe('positive');
    expect(world.stats.gatesImproved).toBe(2);
    expect(world.resonance).toBeCloseTo(0.7, 9);
    expect(events[0]).toMatchObject({ type: 'GATE_HIT', newValue: 1, flippedPositive: false });
  });

  it('lets player bullets pass harmlessly through fixed (mutable: false) gates to hit enemies behind them', () => {
    const world = createCleanGateWorld();

    spawnGateRow(world, {
      layout: 'standalone',
      z: 0.0,
      vz: 0,
      single: { x: 0, halfWidth: 2.5, op: 'add', value: 6, mutable: false },
    });
    const enemyBehind = spawnEnemy(world, 'crawler', 0, -2.0, { hp: 14 });

    const bolt = world.projectilePool.acquire();
    bolt.id = 8900;
    bolt.x = 0;
    bolt.z = 3.0;
    bolt.prevX = 0;
    bolt.prevZ = 3.0;
    bolt.vx = 0;
    bolt.vz = -420; // Sweeps 3.0 -> -4.0 across BOTH the fixed gate at z=0 and enemy at z=-2
    bolt.radius = 0.14;
    bolt.weapon = 'pulse';
    bolt.damage = 20;
    bolt.remainingPierce = 0;
    bolt.maxRange = 80;
    bolt.active = true;
    world.projectiles.push(bolt);

    const events = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(events.some((e) => e.type === 'GATE_HIT')).toBe(false);
    expect(events.some((e) => e.type === 'ENEMY_HIT' && e.fatal)).toBe(true);
    expect(world.enemies.length).toBe(0);
    expect(world.stats.kills).toBe(1);
    expect(world.gates[0]!.value).toBe(6);
  });
});
