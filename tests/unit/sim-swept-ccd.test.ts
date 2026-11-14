import { describe, expect, it } from 'vitest';
import {
  FIXED_DT,
  intersectSweptSegmentAABB,
  sweepCircleVsMovingAABB,
} from '../../src/sim/index';
import { spawnEnemy } from '../../src/sim/enemies';
import { spawnGateRow } from '../../src/sim/gates';
import {
  createSimWorld,
  reconcileFormationAndDps,
  resetSimWorldForSector,
  stepWorldFixed,
} from '../../src/sim/world';

function prepareEmptyArenaWorld() {
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
  world.fireCooldown = 999; // Disable auto-fire so we control exact test projectiles
  reconcileFormationAndDps(world);
  return world;
}

describe('Relative-Velocity Liang-Barsky Swept CCD & Intra-Tick Front-to-Back Ordering', () => {
  it('computes exact tEnter and hit coordinates on moving circle vs moving AABB and rejects misses', () => {
    expect(sweepCircleVsMovingAABB).toBe(intersectSweptSegmentAABB);

    // Bullet moves from z = 10 -> 0, target moves from z = 0 -> 10 (head-on meet near midpoint)
    const hit = intersectSweptSegmentAABB(0, 10, 0, 0, 0.2, 0, 0, 0, 10, 1.0, 0.3);
    expect(hit).not.toBeNull();
    // Combined half-extent along Z = 0.3 + 0.2 = 0.5; relative Z goes +10 -> -10 (dz = -20)
    // Enters +0.5 at t = (10 - 0.5) / 20 = 0.475
    expect(hit!.tEnter).toBeCloseTo(0.475, 9);
    expect(hit!.hitX).toBeCloseTo(0, 9);
    expect(hit!.hitZ).toBeCloseTo(10 - 0.475 * 10, 9);

    // Lateral miss
    const miss = intersectSweptSegmentAABB(3.5, 10, 3.5, 0, 0.2, 0, 0, 0, 10, 1.0, 0.3);
    expect(miss).toBeNull();

    // Already overlapping at t = 0 clamps tEnter to 0
    const overlap = intersectSweptSegmentAABB(0, 1.0, 0, -5.0, 0.2, 0, 1.0, 0, 2.0, 1.0, 0.5);
    expect(overlap).not.toBeNull();
    expect(overlap!.tEnter).toBe(0);
  });

  it('achieves 100/100 single hits (0 tunneling misses, 0 double hits) for fast piercing rail bolts vs thin oncoming mutable gates', () => {
    const bulletVz = -82.0;
    const gateVz = 16.0;
    const relativeStep = (Math.abs(bulletVz) + gateVz) * FIXED_DT;

    for (let phase = 0; phase < 100; phase++) {
      const world = prepareEmptyArenaWorld();
      const offset = (phase / 100) * relativeStep;

      const row = spawnGateRow(world, {
        layout: 'standalone',
        z: -4.0 + offset,
        vz: gateVz,
        single: {
          x: 0,
          halfWidth: 2.0,
          op: 'sub',
          value: 5,
          mutable: true,
          damagePerStep: 10,
          stepDelta: 1,
          maxValue: 10,
        },
      });
      const gate = world.gates.find((g) => g.rowId === row.id)!;
      // Make gate ultra-thin (halfDepth = 0.05) to stress anti-tunneling
      gate.halfDepth = 0.05;

      const bolt = world.projectilePool.acquire();
      bolt.id = 9001;
      bolt.x = 0;
      bolt.z = 2.0;
      bolt.prevX = 0;
      bolt.prevZ = 2.0;
      bolt.vx = 0;
      bolt.vz = bulletVz;
      bolt.radius = 0.05;
      bolt.weapon = 'rail';
      bolt.damage = 10;
      bolt.remainingPierce = 6;
      bolt.maxRange = 80;
      bolt.active = true;
      world.projectiles.push(bolt);

      let gateHitEvents = 0;
      for (let tick = 0; tick < 10; tick++) {
        const evs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
        gateHitEvents += evs.filter((e) => e.type === 'GATE_HIT').length;
      }

      expect(gateHitEvents).toBe(1);
      expect(gate.value).toBe(-4);
    }
  });

  it('achieves 100/100 single hits (0 tunneling misses) for fast bolts against dashing Vector Dashers (vz = +35.2)', () => {
    const bulletVz = -82.0;
    const dashVz = 35.2;
    const relativeStep = (Math.abs(bulletVz) + dashVz) * FIXED_DT;

    for (let phase = 0; phase < 100; phase++) {
      const world = prepareEmptyArenaWorld();
      world.currentScrollSpeed = 15.0; // Runway context so dash speed = 2.2 * 16 = 35.2
      const offset = (phase / 100) * relativeStep;

      const dasher = spawnEnemy(world, 'dasher', 0, -6.0 + offset, { hp: 100 });
      dasher.dasherState = 'DASH';
      dasher.telegraphTimer = 0;

      const bolt = world.projectilePool.acquire();
      bolt.id = 9100 + phase;
      bolt.x = 0;
      bolt.z = 3.0;
      bolt.prevX = 0;
      bolt.prevZ = 3.0;
      bolt.vx = 0;
      bolt.vz = bulletVz;
      bolt.radius = 0.16;
      bolt.weapon = 'rail';
      bolt.damage = 25;
      bolt.remainingPierce = 4;
      bolt.maxRange = 80;
      bolt.active = true;
      world.projectiles.push(bolt);

      let hitCount = 0;
      for (let tick = 0; tick < 10; tick++) {
        // Keep runway open so dasher never triggers arena transition
        world.scrollDistance = 100;
        const evs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
        hitCount += evs.filter((e) => e.type === 'ENEMY_HIT').length;
      }

      expect(hitCount).toBe(1);
      expect(dasher.hp).toBe(75);
    }
  });

  it('sorts same-tick swept candidates strictly by earliest tEnter so non-piercing pulse stops on front Bastion before rear Gate', () => {
    const world = prepareEmptyArenaWorld();

    // Place mutable gate behind Bastion (further toward -Z), both inside a single fast bolt step
    spawnGateRow(world, {
      layout: 'standalone',
      z: 1.2,
      vz: 0,
      single: {
        x: 0,
        halfWidth: 2.2,
        op: 'sub',
        value: 5,
        mutable: true,
        damagePerStep: 10,
        stepDelta: 1,
        maxValue: 10,
      },
    });
    const rearGate = world.gates[0]!;
    const frontBastion = spawnEnemy(world, 'bastion', 0, 3.2, { hp: 110 });

    const pulseBolt = world.projectilePool.acquire();
    pulseBolt.id = 9500;
    pulseBolt.x = 0;
    pulseBolt.z = 5.0;
    pulseBolt.prevX = 0;
    pulseBolt.prevZ = 5.0;
    pulseBolt.vx = 0;
    pulseBolt.vz = -360.0; // Sweeps 6.0 units in 1 tick (z: 5.0 -> -1.0), crossing BOTH Bastion and Gate!
    pulseBolt.radius = 0.14;
    pulseBolt.weapon = 'pulse';
    pulseBolt.damage = 30;
    pulseBolt.remainingPierce = 0; // Non-piercing!
    pulseBolt.maxRange = 80;
    pulseBolt.active = true;
    world.projectiles.push(pulseBolt);

    const events = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });

    expect(frontBastion.hp).toBe(80);
    expect(rearGate.value).toBe(-5);
    expect(rearGate.accumulatedDamage).toBe(0);
    expect(events.some((e) => e.type === 'ENEMY_HIT')).toBe(true);
    expect(events.some((e) => e.type === 'GATE_HIT')).toBe(false);
  });
});
