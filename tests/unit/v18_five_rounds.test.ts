import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../src/sim/index';
import { createSimWorld, reconcileFormationAndDps, resetSimWorldForSector, stepWorldFixed } from '../../src/sim/world';
import { PLAYER_Z } from '../../src/config/constants';
import { spawnSectorBoss } from '../../src/sim/bosses';
import { spawnBarrel } from '../../src/sim/barrels';
import { spawnEnemy } from '../../src/sim/enemies';
import { spawnGateRow } from '../../src/sim/gates';
import { computeTieredEnemyHp } from '../../src/sim/spawner';
import { computeCoreReward } from '../../src/app/meta';
import { damageVault, spawnVault } from '../../src/sim/weapons';

describe('V18 Five-Round Sequential Quality Overhaul Suite', () => {
  it('Round 1: aligns enemy HP scaling with authoritative DPS (mirror_twin 1.16x) and enforces Endless Wave 2+ Anti-AFK Orbital Lockout', () => {
    const wBase = createSimWorld();
    resetSimWorldForSector(wBase, 1);
    wBase.squadCount = 50;
    wBase.squadX = 1.8;
    reconcileFormationAndDps(wBase);
    const hpBase = computeTieredEnemyHp(wBase, 'bastion');

    const wTwin = createSimWorld();
    resetSimWorldForSector(wTwin, 1, { mutators: ['mirror_twin'] });
    wTwin.squadCount = 50;
    wTwin.squadX = 1.8;
    reconcileFormationAndDps(wTwin);
    const hpTwin = computeTieredEnemyHp(wTwin, 'bastion');
    // 1.16^0.54 ≈ 1.083 (previously inflated by 1.45^0.54 ≈ 1.22!)
    expect(hpTwin / hpBase).toBeGreaterThan(1.04);
    expect(hpTwin / hpBase).toBeLessThan(1.14);

    // Endless Wave 2+ motionless AFK triggers AFK_LOCK_STRIKE after 5.2s
    const wEnd = createSimWorld();
    resetSimWorldForSector(wEnd, 4, { endless: true });
    wEnd.endless!.wave = 2;
    wEnd.squadCount = 120;
    reconcileFormationAndDps(wEnd);
    let afkLocked = false;
    for (let i = 0; i < 330; i++) {
      const evs = stepWorldFixed(wEnd, { dragDeltaX: 0, keyAxisX: 0 });
      if (evs.some((e) => e.type === 'AFK_LOCK_STRIKE')) afkLocked = true;
    }
    expect(afkLocked).toBe(true);
  });

  it('Round 2: toggles Lead Main Weapon mid-run via swapWeapon input', () => {
    const sim = createSimulation();
    sim.startSector(1, { layoutSeed: 42 });
    // Unlock scatter + rail via stepFixed on world
    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { layoutSeed: 42 });
    world.squadCount = 30;
    for (const r of ['scatter', 'rail'] as const) {
      const v = spawnVault(world, 0, PLAYER_Z - 4, 0, 10, r);
      damageVault(world, v, 20, []);
    }
    expect(world.weapon).toBe('rail');
    const ev1 = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0, swapWeapon: true });
    expect(world.weapon).toBe('scatter');
    expect(ev1.some((e) => e.type === 'WEAPON_SWAP' && e.weapon === 'scatter')).toBe(true);

    const ev2 = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0, swapWeapon: true });
    expect(world.weapon).toBe('rail');
    expect(ev2.some((e) => e.type === 'WEAPON_SWAP' && e.weapon === 'rail')).toBe(true);
  });

  it('Round 3: triggers Overdrive × Boss Break Resonance extension, Aegis Dasher-Interrupt Parry, and Amplified Barrel Gate Boost (+8)', () => {
    // 3a. Overdrive during Boss Break extends both overdriveTimer (+1.4s) and boss.breakTimer (+1.0s)
    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { manualOverdrive: true });
    const boss = spawnSectorBoss(world, []);
    boss.breakTimer = 3.0;
    world.resonance = 1.0;
    const evOd = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0, overdrive: true });
    expect(evOd.some((e) => e.type === 'OVERDRIVE_START' && e.overdriveBreakSync === true)).toBe(true);
    expect(world.overdriveTimer).toBeGreaterThan(5.8);
    expect(boss.breakTimer).toBeGreaterThan(3.8);

    // 3b. Phase Aegis interrupting a charging Dasher triggers AEGIS_PARRY
    const wAegis = createSimWorld();
    resetSimWorldForSector(wAegis, 1);
    wAegis.squadCount = 25;
    wAegis.aegisCooldown = 0;
    const dasher = spawnEnemy(wAegis, 'dasher', 0, PLAYER_Z - 3.2);
    dasher.dasherState = 'DASH';
    const evAg = stepWorldFixed(wAegis, { dragDeltaX: 0, keyAxisX: 0, aegisPulse: true });
    expect(evAg.some((e) => e.type === 'AEGIS_PARRY')).toBe(true);

    // 3c. Amplified Reflector/Lens shot on Barrel grants +8 mutable gate boost (instead of +5)
    const wBar = createSimWorld();
    resetSimWorldForSector(wBar, 1);
    wBar.gateRowPool.releaseAll(wBar.gateRows);
    wBar.gatePool.releaseAll(wBar.gates);
    spawnGateRow(wBar, {
      layout: 'standalone',
      z: -10,
      vz: 0,
      single: { x: 0, halfWidth: 2.2, op: 'add', value: 2, mutable: true, maxValue: 30 },
    });
    const barrel = spawnBarrel(wBar, 0, -10.5, 0);
    const proj = wBar.projectilePool.acquire();
    proj.id = 9999;
    proj.weapon = 'rail';
    proj.radius = 0.25;
    proj.damage = 50;
    proj.remainingPierce = 1;
    proj.amplified = true;
    proj.powerScale = 1.2;
    proj.hostile = false;
    proj.hostileLoss = 0;
    proj.maxRange = 60;
    proj.splashRadius = 0;
    proj.splashDamageRatio = 0;
    proj.cryoSlowDuration = 0;
    proj.sweepStartFraction = 0;
    proj.prevX = 0;
    proj.prevZ = -9.5;
    proj.x = 0;
    proj.z = -11.5;
    proj.vx = 0;
    proj.vz = -40;
    proj.distanceTraveled = 0;
    proj.active = true;
    wBar.projectiles.push(proj);
    const evBar = stepWorldFixed(wBar, { dragDeltaX: 0, keyAxisX: 0 });
    expect(evBar.some((e) => e.type === 'BARREL_EXPLODE' && e.amplified === true)).toBe(true);
    expect(wBar.gates[0]!.value).toBe(10); // 2 + 8 = 10!
    void barrel;
  });

  it('Round 4: barrel_carnival Volatile Overheat Barrels heat up near front line and auto-ignite if unshot', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { mutators: ['barrel_carnival'] });
    world.barrelPool.releaseAll(world.barrels);
    const b = spawnBarrel(world, 0, PLAYER_Z - 3.0, 14);
    let exploded = false;
    let peakOverheat = 0;
    for (let i = 0; i < 45; i++) {
      const evs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
      if (!b.detonated && b.overheat > peakOverheat) peakOverheat = b.overheat;
      if (evs.some((e) => e.type === 'BARREL_EXPLODE')) exploded = true;
    }
    expect(peakOverheat).toBeGreaterThan(0.5);
    expect(exploded).toBe(true);
  });

  it('Round 5: calibrates sustained Swarm reinforcement cadence (<2,000 kills/run) and soft-caps Workshop core payouts', () => {
    const sim = createSimulation();
    sim.startSector(4, { blitz: true, layoutSeed: 88818, manualOverdrive: true });
    for (let i = 0; i < 4800; i++) {
      const sn = sim.getSnapshot();
      if (sn.phase !== 'PLAYING') break;
      sim.tickFrame(1 / 60, {
        dragDeltaX: 0,
        keyAxisX: 0,
        overdrive: sn.resonance >= 0.999,
      });
    }
    const end = sim.getSnapshot();
    expect(end.stats.kills).toBeLessThan(2000);

    const lowReward = computeCoreReward({ victory: true, stars: 3, score: 30000, progress: 1, firstClear: false, sector: 1 });
    const runawayReward = computeCoreReward({ victory: true, stars: 3, score: 500000, progress: 1, firstClear: false, sector: 1 });
    expect(lowReward.total).toBeGreaterThanOrEqual(160);
    expect(runawayReward.total).toBeLessThan(500);
  });
});
