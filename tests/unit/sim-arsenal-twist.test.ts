import { describe, expect, it } from 'vitest';
import {
  BLADES_BONUS_DRONES,
  BLADES_ORBIT_RADIUS,
  DESPAWN_Z,
  MASTERY_DAMAGE_PER_VAULT,
  OVERDRIVE_DURATION,
  PLAYER_Z,
  PRISM_LENS_DAMAGE_MULT,
} from '../../src/config/constants';
import { CRYO_BRITTLE_DAMAGE_MULT, CRYO_SLOW_MOVE_SCALE, getVolleyStreamCount } from '../../src/config/weapons';
import { spawnEnemy } from '../../src/sim/enemies';
import { spawnGateRow } from '../../src/sim/gates';
import { computeTrueSquadDps } from '../../src/sim/math';
import { addResonance } from '../../src/sim/resonance';
import { damageVault, spawnPrismLens, spawnVault } from '../../src/sim/weapons';
import {
  buildSimSnapshot,
  createSimWorld,
  reconcileFormationAndDps,
  resetSimWorldForSector,
  stepWorldFixed,
} from '../../src/sim/world';

function createCleanArsenalWorld() {
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

describe('Overclock Vaults, 5 Tactical Weapons, Orbital Bit-Blades & Signature Twist', () => {
  it('enforces displayHp = Math.ceil(hp), single-grant broken lock under 9-pellet scatter overkill, +12% mastery, persistent learnedWeaponLevels, and harmless bypass', () => {
    const world = createCleanArsenalWorld();
    world.squadCount = 30;
    world.weapon = 'scatter';
    world.weaponLevel = 3;
    world.learnedWeaponLevels.scatter = 3;
    reconcileFormationAndDps(world);

    // 1. Fractional HP -> Math.ceil displayHp
    const fracVault = spawnVault(world, -2.5, -10.0, 0, 20, 'rail');
    const fracEvents: Parameters<typeof damageVault>[3] = [];
    damageVault(world, fracVault, 5.8, fracEvents);
    expect(fracVault.hp).toBeCloseTo(14.2, 9);
    expect(fracVault.displayHp).toBe(15);
    expect(fracVault.broken).toBe(false);
    expect(fracEvents).toEqual([{ type: 'VAULT_HIT', x: -2.5, z: -10.0 }]);

    // 2. 9-pellet scatter volley simultaneously hitting a low-HP vault breaks it ONCE
    const overkillWorld = createCleanArsenalWorld();
    overkillWorld.squadCount = 40;
    overkillWorld.weapon = 'scatter';
    overkillWorld.weaponLevel = 3; // 9 fan pellets!
    overkillWorld.learnedWeaponLevels.scatter = 3;
    overkillWorld.fireCooldown = 0; // Fire immediately on Step 3
    reconcileFormationAndDps(overkillWorld);

    spawnVault(overkillWorld, 0, PLAYER_Z - 1.2, 0, 5, 'plasma');

    const evs = stepWorldFixed(overkillWorld, { dragDeltaX: 0, keyAxisX: 0 });
    const breakEvents = evs.filter((e) => e.type === 'VAULT_BREAK');
    expect(breakEvents.length).toBe(1);
    expect(breakEvents[0]).toMatchObject({ reward: 'plasma', newWeaponLevel: 1 });
    expect(overkillWorld.stats.vaultsCracked).toBe(1);
    expect(overkillWorld.masteryCount).toBe(1);

    // Broken vault remains observable in immediate snapshot with broken: true & displayHp: 0
    const snapAfterBreak = buildSimSnapshot(overkillWorld);
    expect(snapAfterBreak.vaults.length).toBe(1);
    expect(snapAfterBreak.vaults[0]!.broken).toBe(true);
    expect(snapAfterBreak.vaults[0]!.displayHp).toBe(0);

    // 3. Persistent learnedWeaponLevels + cumulative +12% mastery scaling
    const persistWorld = createCleanArsenalWorld();
    persistWorld.squadCount = 10;
    const baseDps = computeTrueSquadDps(10, 'pulse', 1, 0, false);

    const v1 = spawnVault(persistWorld, 0, -5, 0, 10, 'scatter');
    damageVault(persistWorld, v1, 20, []);
    expect(persistWorld.weapon).toBe('scatter');
    expect(persistWorld.weaponLevel).toBe(1);

    const v2 = spawnVault(persistWorld, 0, -5, 0, 10, 'scatter');
    damageVault(persistWorld, v2, 20, []);
    expect(persistWorld.weapon).toBe('scatter');
    expect(persistWorld.weaponLevel).toBe(2);

    // Switch to rail Lv.1
    const v3 = spawnVault(persistWorld, 0, -5, 0, 10, 'rail');
    damageVault(persistWorld, v3, 20, []);
    expect(persistWorld.weapon).toBe('rail');
    expect(persistWorld.weaponLevel).toBe(1);

    // Crack another scatter vault -> remembers Lv.2 and upgrades to Lv.3!
    const v4 = spawnVault(persistWorld, 0, -5, 0, 10, 'scatter');
    damageVault(persistWorld, v4, 20, []);
    expect(persistWorld.weapon).toBe('scatter');
    expect(persistWorld.weaponLevel).toBe(3);
    expect(persistWorld.masteryCount).toBe(4);

    const expectedMasteryMult = 1 + 4 * MASTERY_DAMAGE_PER_VAULT;
    expect(computeTrueSquadDps(10, 'pulse', 1, 4, false) / baseDps).toBeCloseTo(
      expectedMasteryMult,
      10,
    );

    // 4. Harmless non-lethal bypass past PLAYER_Z and DESPAWN_Z
    const bypassWorld = createCleanArsenalWorld();
    bypassWorld.squadCount = 12;
    spawnVault(bypassWorld, 0, PLAYER_Z - 0.5, 20.0, 200, 'cryo');
    for (let i = 0; i < 30; i++) {
      const tickEvs = stepWorldFixed(bypassWorld, { dragDeltaX: 0, keyAxisX: 0 });
      expect(tickEvs.some((e) => e.type === 'SQUAD_LOSS')).toBe(false);
    }
    expect(bypassWorld.phase).toBe('PLAYING');
    expect(bypassWorld.squadCount).toBe(12);
    expect(bypassWorld.vaults.length).toBe(0);
  });

  it('verifies distinct mechanics of pulse, scatter fan, rail pierce, plasma AoE splash, cryo exact 150-tick slow + 1.25x brittle, and Orbital Bit-Blades', () => {
    // 1. Scatter Lv.1/2/3 emits base 5 / 7 / 9 pellets at squad=1 and scales up with squadCount
    for (const [lvl, basePellets] of [
      [1, 5],
      [2, 7],
      [3, 9],
    ] as const) {
      expect(getVolleyStreamCount('scatter', lvl, 1)).toBe(basePellets);
      const w = createCleanArsenalWorld();
      w.squadCount = 20;
      w.weapon = 'scatter';
      w.weaponLevel = lvl;
      w.fireCooldown = 0;
      const scaledPellets = getVolleyStreamCount('scatter', lvl, 20);
      expect(scaledPellets).toBeGreaterThan(basePellets);
      stepWorldFixed(w, { dragDeltaX: 0, keyAxisX: 0 });
      expect(w.projectiles.length).toBe(scaledPellets);
      expect(w.projectiles[0]!.vx).toBeLessThan(0);
      expect(w.projectiles[scaledPellets - 1]!.vx).toBeGreaterThan(0);
    }

    // 2. Rail pierces through frontal Firewall Bastion into Vault AND mutable Gate behind it
    const railWorld = createCleanArsenalWorld();
    const bastion = spawnEnemy(railWorld, 'bastion', 0, 2.0, { hp: 110 });
    const rearVault = spawnVault(railWorld, 0, 0.0, 0, 100, 'cryo');
    spawnGateRow(railWorld, {
      layout: 'standalone',
      z: -2.0,
      vz: 0,
      single: {
        x: 0,
        halfWidth: 2.0,
        op: 'sub',
        value: 4,
        mutable: true,
        damagePerStep: 10,
        stepDelta: 1,
        maxValue: 10,
      },
    });
    const rearGate = railWorld.gates[0]!;

    const railBolt = railWorld.projectilePool.acquire();
    railBolt.id = 7001;
    railBolt.x = 0;
    railBolt.z = 5.0;
    railBolt.prevX = 0;
    railBolt.prevZ = 5.0;
    railBolt.vx = 0;
    railBolt.vz = -540; // Sweeps 5.0 -> -4.0 across Bastion, Vault, and Gate in 1 tick
    railBolt.radius = 0.18;
    railBolt.weapon = 'rail';
    railBolt.damage = 20;
    railBolt.remainingPierce = 3;
    railBolt.maxRange = 80;
    railBolt.active = true;
    railWorld.projectiles.push(railBolt);

    stepWorldFixed(railWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(bastion.hp).toBe(74); // rail deals 1.8x to bastions
    expect(rearVault.hp).toBe(80);
    expect(rearGate.value).toBe(-2);

    // 3. Plasma AoE splash damages adjacent enemies and vaults
    const plasmaWorld = createCleanArsenalWorld();
    const centerEnemy = spawnEnemy(plasmaWorld, 'bastion', 0, 0, { hp: 100 });
    const sideEnemy = spawnEnemy(plasmaWorld, 'crawler', 2.4, 0, { hp: 50 });
    const sideVault = spawnVault(plasmaWorld, -2.4, 0, 0, 50, 'pulse');

    const mortar = plasmaWorld.projectilePool.acquire();
    mortar.id = 7002;
    mortar.x = 0;
    mortar.z = 3.0;
    mortar.prevX = 0;
    mortar.prevZ = 3.0;
    mortar.vx = 0;
    mortar.vz = -300;
    mortar.radius = 0.24;
    mortar.weapon = 'plasma';
    mortar.damage = 40;
    mortar.remainingPierce = 0;
    mortar.splashRadius = 3.0;
    mortar.splashDamageRatio = 0.75; // 30 splash damage
    mortar.maxRange = 60;
    mortar.active = true;
    plasmaWorld.projectiles.push(mortar);

    stepWorldFixed(plasmaWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(centerEnemy.hp).toBe(60);
    expect(sideEnemy.hp).toBe(14); // plasma splash deals 1.2x to crawlers
    expect(sideVault.hp).toBe(20);

    // 4. Cryo exact 150-tick (2.5s) slow expiry ([BUG-SIM-02]) + 45% move slow + 1.25x brittle amp
    const cryoWorld = createCleanArsenalWorld();
    const chilledEnemy = spawnEnemy(cryoWorld, 'bastion', 0, -40.0, { hp: 500 });

    const cryoBolt = cryoWorld.projectilePool.acquire();
    cryoBolt.id = 7003;
    cryoBolt.x = 0;
    cryoBolt.z = -38.0;
    cryoBolt.prevX = 0;
    cryoBolt.prevZ = -38.0;
    cryoBolt.vx = 0;
    cryoBolt.vz = -240;
    cryoBolt.radius = 0.16;
    cryoBolt.weapon = 'cryo';
    cryoBolt.damage = 20;
    cryoBolt.cryoSlowDuration = 2.5;
    cryoBolt.remainingPierce = 0;
    cryoBolt.maxRange = 60;
    cryoBolt.active = true;
    cryoWorld.projectiles.push(cryoBolt);

    // Tick 0 hits enemy in Step 5 and sets slowTimer = 2.5
    stepWorldFixed(cryoWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(chilledEnemy.hp).toBe(480);
    expect(chilledEnemy.slowTimer).toBe(2.5);

    // Verify 45% slow (0.55x arenaSpeed) on next tick AND 1.25x brittle amplification
    const zBefore = chilledEnemy.z;
    const followBolt = cryoWorld.projectilePool.acquire();
    followBolt.id = 7004;
    followBolt.x = 0;
    followBolt.z = chilledEnemy.z + 1.5;
    followBolt.prevX = 0;
    followBolt.prevZ = chilledEnemy.z + 1.5;
    followBolt.vx = 0;
    followBolt.vz = -240;
    followBolt.radius = 0.16;
    followBolt.weapon = 'pulse';
    followBolt.damage = 40; // Should deal 40 * 1.25 = 50 while chilled!
    followBolt.cryoSlowDuration = 0;
    followBolt.remainingPierce = 0;
    followBolt.maxRange = 60;
    followBolt.active = true;
    cryoWorld.projectiles.push(followBolt);

    stepWorldFixed(cryoWorld, { dragDeltaX: 0, keyAxisX: 0 });
    const dzChilled = chilledEnemy.z - zBefore;
    expect(dzChilled).toBeCloseTo(5.5 * CRYO_SLOW_MOVE_SCALE * (1 / 60), 9);
    expect(chilledEnemy.hp).toBeCloseTo(480 - 40 * CRYO_BRITTLE_DAMAGE_MULT, 9);

    // Advance remaining 149 ticks (total 150 ticks of slowTimer decay): slowTimer must snap to exact 0!
    for (let t = 0; t < 148; t++) {
      stepWorldFixed(cryoWorld, { dragDeltaX: 0, keyAxisX: 0 });
      expect(chilledEnemy.slowTimer).toBeGreaterThan(0);
    }
    stepWorldFixed(cryoWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(chilledEnemy.slowTimer).toBe(0);

    // 5. Orbital Bit-Blades grant +6 bonus drones and damage nearby enemies at r = 2.6
    const bladesWorld = createCleanArsenalWorld();
    bladesWorld.squadCount = 10;
    const bv = spawnVault(bladesWorld, 0, -5, 0, 10, 'blades');
    damageVault(bladesWorld, bv, 20, []);
    expect(bladesWorld.bladesCount).toBe(1);
    expect(bladesWorld.squadCount).toBe(10 + BLADES_BONUS_DRONES);

    bladesWorld.bladesAngle = 0; // Blade #0 sits at (squadX + 2.6, PLAYER_Z)
    const flanker = spawnEnemy(bladesWorld, 'bastion', BLADES_ORBIT_RADIUS, PLAYER_Z, { hp: 100 });
    const bladeEvents = stepWorldFixed(bladesWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(flanker.hp).toBeLessThan(100);
    expect(bladeEvents.some((e) => e.type === 'ENEMY_HIT')).toBe(true);
  });

  it('splits shots 1 -> 2 amplified (1.35x) bolts via Golden Prism Lens without re-splitting, passes harmlessly, and runs exact 360-tick Overdrive ([BUG-SIM-02])', () => {
    const lensWorld = createCleanArsenalWorld();
    const lens = spawnPrismLens(lensWorld, 0, 0.0, 0, 0, 0);
    const target = spawnEnemy(lensWorld, 'bastion', 0, -3.0, { hp: 500, radius: 1.8 });

    const bolt = lensWorld.projectilePool.acquire();
    bolt.id = 7100;
    bolt.x = 0;
    bolt.z = 2.0;
    bolt.prevX = 0;
    bolt.prevZ = 2.0;
    bolt.vx = 0;
    bolt.vz = -420; // Sweeps 2.0 -> -5.0 through Lens (z=0) AND Target (z=-3) in the SAME tick!
    bolt.radius = 0.15;
    bolt.weapon = 'pulse';
    bolt.damage = 50;
    bolt.remainingPierce = 2;
    bolt.maxRange = 80;
    bolt.active = true;
    lensWorld.projectiles.push(bolt);

    const events = stepWorldFixed(lensWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(events.filter((e) => e.type === 'LENS_REFRACT').length).toBe(1);
    expect(lensWorld.projectiles.length).toBe(2);
    expect(lensWorld.projectiles.every((p) => p.amplified)).toBe(true);
    expect(lensWorld.projectiles.every((p) => p.hitIds.has(lens.id))).toBe(true);

    // Note: original bolt scans post-lens target on same tick; sibling bolt hits target on next tick or same tick
    stepWorldFixed(lensWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(500 - target.hp).toBeCloseTo(2 * 50 * PRISM_LENS_DAMAGE_MULT, 6);

    // Un-shot lens passes PLAYER_Z and DESPAWN_Z harmlessly
    lens.vz = 30.0;
    lensWorld.squadCount = 15;
    while (lens.z <= DESPAWN_Z + 0.5 && lensWorld.lenses.length > 0) {
      const evs = stepWorldFixed(lensWorld, { dragDeltaX: 0, keyAxisX: 0 });
      expect(evs.some((e) => e.type === 'SQUAD_LOSS')).toBe(false);
    }
    expect(lensWorld.squadCount).toBe(15);

    // V-Wing Resonance Overdrive: exact 360-tick (6.0s) duration & clean 0 expiry ([BUG-SIM-02])
    const odWorld = createCleanArsenalWorld();
    odWorld.squadCount = 25;
    reconcileFormationAndDps(odWorld);
    const normalDps = odWorld.trueSquadDps;

    const odInitEvents: Parameters<typeof addResonance>[2] = [];
    addResonance(odWorld, 1.0, odInitEvents);
    expect(odInitEvents.some((e) => e.type === 'OVERDRIVE_START')).toBe(true);
    expect(odWorld.overdriveTimer).toBe(OVERDRIVE_DURATION);
    expect(odWorld.resonance).toBe(1.0);

    // Note: overdriveJustStarted preserves full 6.0s on the tick Overdrive starts,
    // then decays across exact 360 subsequent fixed ticks!
    stepWorldFixed(odWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(odWorld.overdriveTimer).toBe(OVERDRIVE_DURATION);
    expect(odWorld.trueSquadDps / normalDps).toBeCloseTo(1.5, 9);

    for (let tick = 1; tick <= 359; tick++) {
      stepWorldFixed(odWorld, { dragDeltaX: 0, keyAxisX: 0 });
      expect(odWorld.overdriveTimer).toBeGreaterThan(0);
    }

    // Exact tick 360 of decay -> snaps cleanly to 0 with zero IEEE-754 residual!
    stepWorldFixed(odWorld, { dragDeltaX: 0, keyAxisX: 0 });
    expect(odWorld.overdriveTimer).toBe(0);
    expect(odWorld.resonance).toBe(0);
    expect(odWorld.trueSquadDps).toBeCloseTo(normalDps, 9);
  });
});
