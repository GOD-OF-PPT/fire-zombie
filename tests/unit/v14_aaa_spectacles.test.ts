import { describe, expect, it } from 'vitest';
import { PLAYER_Z } from '../../src/config/constants';
import { damageSkyCargo, spawnMaglevSweep, spawnSkyCargo } from '../../src/sim/competition';
import { damageEnemy, spawnEnemy } from '../../src/sim/enemies';
import { buildSimSnapshot, createSimWorld, resetSimWorldForSector, stepWorldFixed } from '../../src/sim/world';

describe('V14 AAA Blockbuster Evolution: Sky-Drop Plasma Cargo, Maglev Express Sweep & Elite Half-HP Armor Break', () => {
  it('shoots down an overhead Sky-Drop Plasma Cargo to crush hordes beneath and grant Resonance charge', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1);
    world.enemyPool.releaseAll(world.enemies);
    world.fireCooldown = 999;

    const cargo = spawnSkyCargo(world, 0, PLAYER_Z - 14, 0, [], 30);
    const victim1 = spawnEnemy(world, 'crawler', 0.8, PLAYER_Z - 14, { hp: 80 });
    const victim2 = spawnEnemy(world, 'phalanx', -1.2, PLAYER_Z - 13.5, { hp: 120 });

    const dropEvs: Parameters<typeof damageSkyCargo>[3] = [];
    damageSkyCargo(world, cargo, 35, dropEvs);
    expect(cargo.state).toBe('falling');
    expect(dropEvs.some((e) => e.type === 'SKY_CARGO_DROP')).toBe(true);

    let slamKills = 0;
    for (let i = 0; i < 30; i++) {
      victim1.z = PLAYER_Z - 14;
      victim2.z = PLAYER_Z - 13.5;
      const evs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
      for (const ev of evs) {
        if (ev.type === 'SKY_CARGO_SLAM') slamKills += ev.kills;
      }
    }
    expect(slamKills).toBe(2);
    expect(world.enemies.includes(victim1)).toBe(false);
    expect(world.enemies.includes(victim2)).toBe(false);
    expect(world.resonance).toBeGreaterThanOrEqual(0.25);
  });

  it('telegraphs and sweeps a supersonic Maglev Express train across the bridge, pulverizing corridor enemies', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 2);
    world.enemyPool.releaseAll(world.enemies);
    world.currentScrollSpeed = 0;
    world.fireCooldown = 999;

    const warnEvs: Parameters<typeof spawnMaglevSweep>[3] = [];
    const train = spawnMaglevSweep(world, -18, 1, warnEvs);
    expect(warnEvs.some((e) => e.type === 'MAGLEV_WARN')).toBe(true);
    expect(train.state).toBe('warning');

    const inTrackEnemy = spawnEnemy(world, 'bastion', 0, -18, { hp: 500 });
    const safeFarEnemy = spawnEnemy(world, 'bastion', 0, -35, { hp: 500 });

    let swept = false;
    for (let i = 0; i < 120; i++) {
      if (inTrackEnemy.active) inTrackEnemy.z = -18;
      if (safeFarEnemy.active) safeFarEnemy.z = -35;
      const evs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
      if (evs.some((e) => e.type === 'MAGLEV_SWEEP')) swept = true;
    }
    expect(swept).toBe(true);
    expect(world.enemies.includes(inTrackEnemy)).toBe(false);
    expect(world.enemies.includes(safeFarEnemy)).toBe(true);
  });

  it('triggers ENEMY_ARMOR_BREAK and sets armorBroken=true when Tier-3/4 Elites drop below 50% HP', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1);

    const titan = spawnEnemy(world, 'bastion', 0, -15, { hp: 200 });
    const fodder = spawnEnemy(world, 'crawler', 2, -15, { hp: 40 });
    const evs: Parameters<typeof damageEnemy>[4] = [];

    damageEnemy(world, titan, 110, 0, evs);
    damageEnemy(world, fodder, 25, 0, evs);

    expect(titan.armorBroken).toBe(true);
    expect(fodder.armorBroken).toBe(false);
    expect(evs.some((e) => e.type === 'ENEMY_ARMOR_BREAK' && e.kind === 'bastion')).toBe(true);

    const snap = buildSimSnapshot(world);
    const snapTitan = snap.enemies.find((e) => e.id === titan.id)!;
    expect(snapTitan.armorBroken).toBe(true);
  });
});
