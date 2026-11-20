import { describe, expect, it } from 'vitest';
import { getWeaponCounterMult } from '../../src/config/weapons';
import { damageEnemy, spawnEnemy, stepEnemiesAI } from '../../src/sim/enemies';
import { spawnGateRow } from '../../src/sim/gates';
import { createSimWorld, resetSimWorldForSector, stepWorldFixed } from '../../src/sim/world';
import type { EnemyKind, SimEvent } from '../../src/types/game';

describe('V8 2D Cell-Balanced Uniform Spawner & 14-Archetype Diverse Roster', () => {
  it('eliminates 6.4m gate dead-zones and maintains uniform 2D slice & lateral distribution', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { bonusSquad: 14, damageMult: 1.25 });
    world.enemyPool.releaseAll(world.enemies);
    world.gateRowPool.releaseAll(world.gateRows);
    world.gatePool.releaseAll(world.gates);

    // Place a non-mutable paired gate row right across z = -42 to verify zero full-width dead-zone pileup!
    spawnGateRow(world, {
      layout: 'paired',
      z: -42,
      vz: 0,
      left: { op: 'add', value: 6, mutable: false },
      right: { op: 'add', value: 4, mutable: false },
    });

    world.playerHasSteered = true;
    world.scrollDistance = 165;
    world.spawnCursor = 999;
    world.fireCooldown = 999;
    world.auxCooldowns = { pulse: 999, scatter: 999, rail: 999, plasma: 999, cryo: 999 };

    for (let t = 0; t < 180; t++) {
      stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    }

    const active = world.enemies.filter((e) => e.active && !e.consumed && e.hp > 0);
    expect(active.length).toBeGreaterThanOrEqual(24);

    // Balanced across Left / Center / Right thirds
    const left = active.filter((e) => e.x < -1.44).length;
    const center = active.filter((e) => e.x >= -1.44 && e.x <= 1.44).length;
    const right = active.filter((e) => e.x > 1.44).length;
    expect(left).toBeGreaterThanOrEqual(5);
    expect(center).toBeGreaterThanOrEqual(5);
    expect(right).toBeGreaterThanOrEqual(5);

    // Verify no single 5m longitudinal slice exceeds MAX_SLICE_5M_DENSITY + soft-queue margin
    const sliceMap = new Map<number, number>();
    for (const e of active) {
      const s = Math.floor(e.z / 5.0);
      sliceMap.set(s, (sliceMap.get(s) ?? 0) + 1);
    }
    for (const [, count] of sliceMap) {
      expect(count).toBeLessThanOrEqual(16);
    }

    // Multi-species diversity: dynamic stream alone spawns >= 7 distinct monster archetypes!
    const distinctKinds = new Set<EnemyKind>(active.map((e) => e.kind));
    expect(distinctKinds.size).toBeGreaterThanOrEqual(7);
  });

  it('validates Cryo-Colossus (glacier) permafrost armor resist, Cryo slow immunity, and Frost Nova shatter', () => {
    const world = createSimWorld();
    const events: SimEvent[] = [];
    const g = spawnEnemy(world, 'glacier', 0, -18, { hp: 80 });
    const bystander = spawnEnemy(world, 'crawler', 1.4, -18.5, { hp: 40 });

    // Light pulse hit is reduced by permafrost armor (0.72x) AND cannot Cryo-slow glacier
    damageEnemy(world, g, 20, 2.0, events, { weapon: 'pulse' });
    expect(g.slowTimer).toBe(0);
    expect(g.hp).toBeCloseTo(80 - 20 * 0.72, 2);

    // Plasma counter bypasses permafrost resist and shatters glacier into GLACIER_NOVA
    expect(getWeaponCounterMult('plasma', 'glacier')).toBe(1.85);
    const killed = damageEnemy(world, g, 90, 0, events, { weapon: 'plasma' });
    expect(killed).toBe(true);
    expect(events.some((ev) => ev.type === 'GLACIER_NOVA')).toBe(true);
    expect(bystander.slowTimer).toBeGreaterThanOrEqual(2.0);
  });

  it('validates Prism Watcher (beholder) optic lock telegraph + hostile plasma shot, Tunnel Ripper (burrower) breach surge, and Nano-Weaver (necromancer) ally mend + overload refund', () => {
    const world = createSimWorld();
    world.currentScrollSpeed = 8;
    world.playerHasSteered = true;
    world.squadCount = 20;
    const events: SimEvent[] = [];

    const watcher = spawnEnemy(world, 'beholder', -1.8, -36);
    const burrower = spawnEnemy(world, 'burrower', 2.0, -32);
    const weaver = spawnEnemy(world, 'necromancer', 0.2, -30);
    const wounded = spawnEnemy(world, 'bastion', 1.1, -30.5, { hp: 100 });
    wounded.hp = 50;

    let sawTelegraph = false;
    for (let i = 0; i < 190; i++) {
      stepEnemiesAI(world, events);
      if (watcher.telegraphTimer > 0) sawTelegraph = true;
    }

    expect(sawTelegraph).toBe(true);
    expect(events.some((e) => e.type === 'WATCHER_SHOT')).toBe(true);
    expect(world.projectiles.some((p) => p.active && p.hostile)).toBe(true);

    expect(events.some((e) => e.type === 'BURROW_ERUPT')).toBe(true);
    expect(burrower.specialCount).toBe(1);

    expect(events.some((e) => e.type === 'NECRO_HEAL')).toBe(true);
    expect(wounded.hp).toBeGreaterThan(50);

    const resBefore = world.resonance;
    world.nukeCharge = 0.5;
    damageEnemy(world, weaver, 200, 0, events, { weapon: 'rail' });
    expect(world.resonance).toBeGreaterThan(resBefore);
    expect(world.nukeCharge).toBeGreaterThan(0.5);
  });
});
