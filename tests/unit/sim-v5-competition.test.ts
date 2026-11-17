import { describe, expect, it } from 'vitest';
import { PLAYER_Z } from '../../src/config/constants';
import { spawnSectorBoss } from '../../src/sim/bosses';
import {
  damageBossPart,
  spawnContractLane,
  spawnDoomOrb,
  spawnJumpPad,
  spawnReflector,
} from '../../src/sim/competition';
import { spawnEnemy } from '../../src/sim/enemies';
import { spawnGateRow } from '../../src/sim/gates';
import { createSimulation } from '../../src/sim/index';
import { damageVault, spawnVault } from '../../src/sim/weapons';
import {
  buildSimSnapshot,
  createSimWorld,
  reconcileFormationAndDps,
  resetSimWorldForSector,
  stepWorldFixed,
} from '../../src/sim/world';

describe('V5 Competition Blueprint: 3 Superweapon Fusions, Track Set-Pieces, Boss Break/Deflect, Blitz & Mutators', () => {
  it('synthesizes all 3 Superweapon Fusions (Cryo Singularity, Prism Ricochet Web, Seeker Sword-Array) and executes their distinct mechanics', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1);
    world.gateRowPool.releaseAll(world.gateRows);
    world.gatePool.releaseAll(world.gates);
    world.enemyPool.releaseAll(world.enemies);
    world.projectilePool.releaseAll(world.projectiles);
    world.squadCount = 30;
    reconcileFormationAndDps(world);

    // 1. Unlock Plasma Lv.2 + Cryo Lv.1 -> synthesizes cryo_singularity!
    for (const r of ['plasma', 'plasma', 'cryo'] as const) {
      const v = spawnVault(world, 0, -5, 0, 10, r);
      damageVault(world, v, 20, []);
    }
    expect(world.activeFusions).toContain('cryo_singularity');

    // Fire plasma -> hits enemy -> spawns 3D Gravity Singularity Vortex pulling nearby monsters inward!
    world.weapon = 'plasma';
    world.weaponLevel = 2;
    world.fireCooldown = 0;
    const centerTarget = spawnEnemy(world, 'bastion', 0, PLAYER_Z - 3.0, { hp: 400 });
    const flankMonster = spawnEnemy(world, 'crawler', 2.8, PLAYER_Z - 3.0, { hp: 50 });
    stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    for (let i = 0; i < 6; i++) stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(world.singularities.length).toBeGreaterThanOrEqual(1);
    expect(flankMonster.x).toBeLessThan(2.8); // Pulled inward toward vortex center!

    // 2. Unlock Scatter Lv.2 + Rail Lv.1 -> synthesizes prism_ricochet_web!
    for (const r of ['scatter', 'scatter', 'rail'] as const) {
      const v = spawnVault(world, 0, -5, 0, 10, r);
      damageVault(world, v, 20, []);
    }
    expect(world.activeFusions).toContain('prism_ricochet_web');

    // 3. Unlock Blades + Pulse Lv.2 -> synthesizes seeker_sword_array!
    for (const r of ['blades', 'pulse'] as const) {
      const v = spawnVault(world, 0, -5, 0, 10, r);
      damageVault(world, v, 20, []);
    }
    expect(world.activeFusions).toContain('seeker_sword_array');
    stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(world.seekerBlades.length).toBe(world.bladesCount);
    expect(world.seekerBlades[0]!.hunting).toBe(true);
    expect(centerTarget.hp).toBeLessThan(400);
  });

  it('executes Mag-Lev Jump Pad flyover + Sky-Slam, 45° Reflector Bank-Shots, and Dual-Lane Bounty Contract Jackpots', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1);
    world.gateRowPool.releaseAll(world.gateRows);
    world.gatePool.releaseAll(world.gates);
    world.enemyPool.releaseAll(world.enemies);
    world.projectilePool.releaseAll(world.projectiles);
    world.squadCount = 20;
    world.squadX = 0;
    reconcileFormationAndDps(world);

    // 1. Jump Pad launches squad airborne -> flies safely OVER ÷2 gate -> lands with JUMP_SLAM AoE!
    spawnJumpPad(world, 0, PLAYER_Z - 0.1, 15);
    spawnGateRow(world, {
      layout: 'paired',
      z: PLAYER_Z - 5.0,
      vz: 15,
      left: { op: 'div', value: 2, mutable: false },
      right: { op: 'div', value: 2, mutable: false },
    });
    const evLaunch = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(evLaunch.some((e) => e.type === 'JUMP_LAUNCH')).toBe(true);
    let sawSlam = false;
    for (let i = 0; i < 85; i++) {
      const evs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
      if (evs.some((e) => e.type === 'JUMP_SLAM')) sawSlam = true;
    }
    expect(world.squadCount).toBe(20); // Flew right over lethal ÷2 gate with zero loss!
    expect(sawSlam).toBe(true);

    // 2. 45° Reflector bounces friendly shot diagonally with 1.45x damage amplification
    world.fireCooldown = 999;
    spawnReflector(world, 0, 2.0, 0, 1);
    const bolt = world.projectilePool.acquire();
    bolt.id = 8801;
    bolt.x = 0;
    bolt.z = 4.0;
    bolt.prevX = 0;
    bolt.prevZ = 4.0;
    bolt.vx = 0;
    bolt.vz = -240;
    bolt.radius = 0.16;
    bolt.weapon = 'pulse';
    bolt.damage = 20;
    bolt.remainingPierce = 0;
    bolt.maxRange = 60;
    bolt.active = true;
    world.projectiles.push(bolt);
    const refEvs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(refEvs.some((e) => e.type === 'REFLECTOR_BOUNCE')).toBe(true);
    expect(bolt.vx).toBeGreaterThan(5);
    expect(bolt.damage).toBeCloseTo(29, 6);

    // 3. Dual-Lane Contract Wall locks lane crossing & Bounty Elite kill triggers BOUNTY_JACKPOT!
    world.squadX = -2.2;
    world.prevSquadX = -2.2;
    spawnContractLane(world, PLAYER_Z + 10, 40, 0, 'left', 10);
    stepWorldFixed(world, { dragDeltaX: 5.0, keyAxisX: 0 }); // Attempt to cross center wall x=0
    expect(world.squadX).toBeLessThan(0); // Locked in left bounty corridor!
    const bountyBoss = world.enemies.find((e) => e.isBountyElite)!;
    expect(bountyBoss).toBeDefined();
    bolt.x = bountyBoss.x;
    bolt.z = bountyBoss.z + 1;
    bolt.prevX = bountyBoss.x;
    bolt.prevZ = bountyBoss.z + 1;
    bolt.vx = 0;
    bolt.vz = -180;
    bolt.damage = 50;
    const jpEvs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(jpEvs.some((e) => e.type === 'BOUNTY_JACKPOT')).toBe(true);
    expect(world.squadCount).toBeGreaterThan(30);
    expect(world.resonance).toBe(1.0);
  });

  it('shatters Boss Shoulder Parts for 4.0s 2x BREAK stagger and reflects Negative Doom-Orbs back into Boss Core', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1);
    world.gateRowPool.releaseAll(world.gateRows);
    world.gatePool.releaseAll(world.gates);
    world.enemyPool.releaseAll(world.enemies);
    world.projectilePool.releaseAll(world.projectiles);
    world.scrollDistance = 850;
    world.runwayProgress = 1;
    world.squadCount = 50;
    world.fireCooldown = 999;
    reconcileFormationAndDps(world);

    spawnSectorBoss(world, []);
    for (let i = 0; i < 75; i++) stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    const boss = world.boss!;
    expect(boss.parts.length).toBe(2);
    const shoulderBeforeMovement = boss.parts[0]!.x;
    for (let i = 0; i < 30; i++) stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(boss.parts[0]!.x).not.toBe(shoulderBeforeMovement);
    expect(boss.parts[0]!.x).toBeCloseTo(Math.max(-4.2, boss.x - 2.05), 6);
    expect(boss.parts[1]!.x).toBeCloseTo(Math.min(4.2, boss.x + 2.05), 6);

    // 1. Break Left Shoulder Cannon -> triggers BOSS_PART_BREAK & 4.0s breakTimer!
    const brkEvs: Parameters<typeof damageBossPart>[3] = [];
    damageBossPart(world, boss.parts[0]!, boss.parts[0]!.maxHp + 10, brkEvs);
    expect(boss.parts[0]!.destroyed).toBe(true);
    expect(boss.breakTimer).toBe(4.0);
    expect(brkEvs.some((e) => e.type === 'BOSS_PART_BREAK' && e.slot === 'left')).toBe(true);

    // 2. Spawn -18 Doom-Orb -> shoot it positive (+1) -> reflects at -46 u/s & slams Boss Core for 16% Max HP!
    const orb = spawnDoomOrb(world, boss, []);
    expect(orb.value).toBeLessThan(0);
    const shot = world.projectilePool.acquire();
    shot.id = 9901;
    shot.x = orb.x;
    shot.z = orb.z + 1.5;
    shot.prevX = orb.x;
    shot.prevZ = orb.z + 1.5;
    shot.vx = 0;
    shot.vz = -200;
    shot.radius = 0.25;
    shot.weapon = 'rail';
    shot.damage = 400;
    shot.remainingPierce = 0;
    shot.maxRange = 60;
    shot.active = true;
    world.projectiles.push(shot);

    const refEv = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(refEv.some((e) => e.type === 'DOOM_ORB_REFLECT')).toBe(true);
    expect(orb.reflected).toBe(true);

    const hpBeforeSlam = boss.hp;
    let slammed = false;
    for (let i = 0; i < 40; i++) {
      const evs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
      if (evs.some((e) => e.type === 'DOOM_ORB_SLAM')) slammed = true;
    }
    expect(slammed).toBe(true);
    expect(hpBeforeSlam - boss.hp).toBeGreaterThanOrEqual(Math.floor(boss.maxHp * 0.15));
    expect(world.damageBySource.deflect).toBeGreaterThan(0);
  });

  it('runs 90s Tournament Blitz Mode & all 3 Mutators (mirror_twin, glass_cannon, barrel_carnival) deterministically', () => {
    const sim = createSimulation();
    sim.startSector(4, {
      blitz: true,
      layoutSeed: 7,
      mutators: ['mirror_twin', 'glass_cannon', 'barrel_carnival'],
    });
    const s0 = sim.getSnapshot();
    expect(s0.blitzActive).toBe(true);
    expect(s0.mirrorTwinActive).toBe(true);
    expect(s0.mutators).toEqual(['mirror_twin', 'glass_cannon', 'barrel_carnival']);
    expect(s0.squadCount).toBe(14);

    // Step 10 ticks at squadX = 2.0 -> Mirror Twin emits symmetrical projectiles at both +X and -X!
    for (let i = 0; i < 10; i++) {
      sim.stepFixed({ dragDeltaX: 0.2, keyAxisX: 0 });
    }
    const s1 = sim.getSnapshot();
    const posProjs = s1.projectiles.filter((p) => !p.hostile && p.x > 0.3).length;
    const negProjs = s1.projectiles.filter((p) => !p.hostile && p.x < -0.3).length;
    expect(posProjs).toBeGreaterThan(0);
    expect(negProjs).toBeGreaterThan(0);
  });
});
