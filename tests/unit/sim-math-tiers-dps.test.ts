import { describe, expect, it } from 'vitest';
import {
  FIXED_DT,
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
  createSimulation,
  formatGateLabel,
  normalizeZero,
  type WeaponId,
} from '../../src/sim/index';
import { PLAYER_Z, TRACK_HALF_WIDTH } from '../../src/config/constants';
import { spawnEnemy } from '../../src/sim/enemies';
import { spawnGateRow } from '../../src/sim/gates';
import {
  createSimWorld,
  reconcileFormationAndDps,
  resetSimWorldForSector,
  stepWorldFixed,
} from '../../src/sim/world';

const ALL_WEAPONS: readonly WeaponId[] = ['pulse', 'scatter', 'rail', 'plasma', 'cryo'];

describe('Squad Integer Math, Gate Labels, 48-Unit 3-Tier Promotion & True DPS', () => {
  it('normalizes -0 and clamps squadCount strictly to integers in [0, 999]', () => {
    expect(Object.is(normalizeZero(-0), -0)).toBe(false);
    expect(normalizeZero(-0)).toBe(0);

    expect(clampSquadCount(-50)).toBe(0);
    expect(clampSquadCount(-0)).toBe(0);
    expect(Object.is(clampSquadCount(-0), -0)).toBe(false);
    expect(clampSquadCount(NaN)).toBe(0);
    expect(clampSquadCount(Infinity)).toBe(0);
    expect(clampSquadCount(14.9)).toBe(14);
    expect(clampSquadCount(999)).toBe(999);
    expect(clampSquadCount(1500)).toBe(999);
  });

  it('applies +, -, ×, ÷ gate operations with Math.floor and exact actualDelta = after - before', () => {
    expect(applyGateArithmetic).toBe(applyGateOperation);

    // Addition & ceiling clamp
    expect(applyGateOperation(4, 'add', 5)).toEqual({ after: 9, actualDelta: 5 });
    expect(applyGateOperation(995, 'add', 10)).toEqual({ after: 999, actualDelta: 4 });
    const cappedAdd = applyGateOperation(999, 'add', 25);
    expect(cappedAdd).toEqual({ after: 999, actualDelta: 0 });
    expect(Object.is(cappedAdd.actualDelta, -0)).toBe(false);

    // Subtraction & floor clamp
    expect(applyGateOperation(10, 'sub', 4)).toEqual({ after: 6, actualDelta: -4 });
    expect(applyGateOperation(3, 'sub', 10)).toEqual({ after: 0, actualDelta: -3 });
    const zeroSub = applyGateOperation(0, 'sub', 8);
    expect(zeroSub).toEqual({ after: 0, actualDelta: 0 });
    expect(Object.is(zeroSub.actualDelta, -0)).toBe(false);

    // Multiplication with Math.floor & ceiling clamp
    expect(applyGateOperation(7, 'mul', 2)).toEqual({ after: 14, actualDelta: 7 });
    expect(applyGateOperation(600, 'mul', 2)).toEqual({ after: 999, actualDelta: 399 });
    const zeroMul = applyGateOperation(0, 'mul', 3);
    expect(zeroMul).toEqual({ after: 0, actualDelta: 0 });
    expect(Object.is(zeroMul.actualDelta, -0)).toBe(false);

    // Division with Math.floor (including 1 ÷ 2 = 0)
    expect(applyGateOperation(5, 'div', 2)).toEqual({ after: 2, actualDelta: -3 });
    expect(applyGateOperation(9, 'div', 3)).toEqual({ after: 3, actualDelta: -6 });
    expect(applyGateOperation(1, 'div', 2)).toEqual({ after: 0, actualDelta: -1 });
  });

  it('transitions immediately to DEFEAT with DIVISION_GATE when 1 drone crosses ÷2', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1);
    world.gateRowPool.releaseAll(world.gateRows);
    world.gatePool.releaseAll(world.gates);
    world.enemyPool.releaseAll(world.enemies);
    world.squadCount = 1;
    world.squadX = 1.5;
    reconcileFormationAndDps(world);

    spawnGateRow(world, {
      layout: 'paired',
      z: PLAYER_Z - 0.1,
      vz: 14.0,
      left: { op: 'add', value: 5, mutable: false },
      right: { op: 'div', value: 2, mutable: false },
    });

    const events = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(world.squadCount).toBe(0);
    expect(world.phase).toBe('DEFEAT');
    expect(world.defeatReason).toBe('DIVISION_GATE');
    expect(events.some((e) => e.type === 'GATE_PASS' && e.delta === -1)).toBe(true);
    expect(events.some((e) => e.type === 'RUN_DEFEAT' && e.reason === 'DIVISION_GATE')).toBe(true);
  });

  it('formats crisp gate labels and polarities without ever producing -0, +0, or +-N', () => {
    expect(computeGatePolarity('add', 12)).toBe('positive');
    expect(formatGateLabel('add', 12)).toBe('+12');

    expect(computeGatePolarity('add', 0)).toBe('neutral');
    expect(formatGateLabel('add', 0)).toBe('0');
    expect(formatGateLabel('add', -0)).toBe('0');
    expect(formatGateLabel('sub', 0)).toBe('0');

    expect(computeGatePolarity('sub', 8)).toBe('negative');
    expect(formatGateLabel('sub', 8)).toBe('-8');
    expect(formatGateLabel('add', -8)).toBe('-8');

    expect(computeGatePolarity('mul', 2)).toBe('positive');
    expect(formatGateLabel('mul', 2)).toBe('×2');

    expect(computeGatePolarity('div', 2)).toBe('negative');
    expect(formatGateLabel('div', 2)).toBe('÷2');
  });

  it('exhaustively proves 3-tier decomposition, <=48 visible cap, radius <=1.65, and [-5, +5] bounds for all n in 0..999', () => {
    expect(computeDronePositions).toBe(computeFormationPositions);

    for (let n = 0; n <= 999; n++) {
      const tiers = computeTierBreakdown(n);
      expect(tiers.u1 + 5 * tiers.u2 + 25 * tiers.u3).toBe(n);
      expect(tiers.u1 + tiers.u2 + tiers.u3).toBe(tiers.totalVisible);
      expect(tiers.totalVisible).toBeLessThanOrEqual(48);

      if (n <= 48) {
        expect(tiers.totalVisible).toBe(n);
        expect(tiers.u2).toBe(0);
        expect(tiers.u3).toBe(0);
      } else {
        expect(tiers.totalVisible).toBeGreaterThanOrEqual(44);
        expect(tiers.totalVisible).toBeLessThanOrEqual(48);
      }

      const radius = computeFormationRadius(tiers.totalVisible);
      expect(radius).toBeGreaterThanOrEqual(0.35);
      expect(radius).toBeLessThanOrEqual(1.65);

      for (const rawX of [-99, 0, 99]) {
        const clampedX = clampSquadX(rawX, radius);
        expect(clampedX).toBeGreaterThanOrEqual(-TRACK_HALF_WIDTH + radius - 1e-12);
        expect(clampedX).toBeLessThanOrEqual(TRACK_HALF_WIDTH - radius + 1e-12);

        for (const overdrive of [false, true]) {
          const positions = computeDronePositions(tiers, clampedX, PLAYER_Z, overdrive);
          expect(positions.length).toBe(tiers.totalVisible);

          let c1 = 0;
          let c2 = 0;
          let c3 = 0;
          for (const p of positions) {
            if (p.x < -TRACK_HALF_WIDTH || p.x > TRACK_HALF_WIDTH || Object.is(p.x, -0)) {
              expect.unreachable(`Out-of-bounds or -0 drone x=${p.x} at n=${n}`);
            }
            if (p.tier === 1) c1 += 1;
            else if (p.tier === 2) c2 += 1;
            else c3 += 1;
          }
          expect(c1).toBe(tiers.u1);
          expect(c2).toBe(tiers.u2);
          expect(c3).toBe(tiers.u3);
        }
      }
    }
  });

  it('scales trueSquadDps strictly monotonically for 0..999 and deals exact 4.0x empirical damage at N=200 vs N=50 across all 5 weapons', () => {
    for (const weapon of ALL_WEAPONS) {
      for (let n = 0; n < 999; n++) {
        const d0 = computeTrueSquadDps(n, weapon, 2, 1, false);
        const d1 = computeTrueSquadDps(n + 1, weapon, 2, 1, false);
        expect(d1).toBeGreaterThan(d0);
      }

      for (const level of [1, 2, 3] as const) {
        const dps50 = computeTrueSquadDps(50, weapon, level, 2, true);
        const dps200 = computeTrueSquadDps(200, weapon, level, 2, true);
        expect(dps200 / dps50).toBeCloseTo(4.0, 10);
      }

      // Empirical combat damage test against a close target (both cold-start & steady-state)
      const measureEmpiricalDamage = (squadCount: number) => {
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

        world.squadCount = squadCount;
        world.weapon = weapon;
        world.weaponLevel = 2;
        world.squadX = 0;
        reconcileFormationAndDps(world);

        const target = spawnEnemy(world, 'bastion', 0, PLAYER_Z - 2.2, {
          hp: 500_000,
          radius: 1.8,
        });

        let hpAtSteadyStart = target.hp;
        for (let step = 0; step < 210; step++) {
          if (step === 30) {
            hpAtSteadyStart = target.hp;
          }
          target.z = PLAYER_Z - 2.2;
          target.prevZ = PLAYER_Z - 2.2;
          stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
        }

        expect(world.tiers.totalVisible).toBeLessThanOrEqual(48);
        return {
          totalDealt: 500_000 - target.hp,
          steadyDealt: hpAtSteadyStart - target.hp,
        };
      };

      const res50 = measureEmpiricalDamage(50);
      const res200 = measureEmpiricalDamage(200);
      expect(res50.steadyDealt).toBeGreaterThan(300);
      // Steady-state ratio across 180 ticks is exact 4.000000000x on all 5 weapons!
      expect(res200.steadyDealt / res50.steadyDealt).toBeCloseTo(4.0, 9);
      if (weapon !== 'cryo') {
        expect(res200.totalDealt / res50.totalDealt).toBeCloseTo(4.0, 9);
      } else {
        expect(res200.totalDealt / res50.totalDealt).toBeCloseTo(4.0, 2);
      }
    }

    // Also verify projectile powerScale grows with squadCount, weaponLevel, and lens amplification
    const sSmall = computeProjectilePowerScale(4, 1, false);
    const sLarge = computeProjectilePowerScale(200, 3, false);
    const sAmp = computeProjectilePowerScale(200, 3, true);
    expect(sLarge).toBeGreaterThan(sSmall);
    expect(sAmp).toBeGreaterThan(sLarge);

    // Quick sanity check on controller FIXED_DT export
    const sim = createSimulation();
    expect(FIXED_DT).toBeCloseTo(1 / 60, 12);
    expect(sim.getSnapshot().phase).toBe('TITLE');
  });
});
