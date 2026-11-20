import { describe, expect, it } from 'vitest';
import { spawnEnemy, stepEnemiesAI } from '../../src/sim/enemies';
import {
  addNukeKillCharge,
  NUKE_BLAST_DURATION,
  NUKE_COOLDOWN_SEC,
  NUKE_KILL_CHARGE,
  stepNukeStrike,
  tryTriggerNukeStrike,
} from '../../src/sim/nuke';
import { computeDynamicSwarmProfile } from '../../src/sim/spawner';
import { createSimWorld, resetSimWorldForSector, stepWorldFixed } from '../../src/sim/world';
import type { SimEvent } from '../../src/types/game';

describe('V6.5 Horizon Runway Horde Queueing & Strategic Long-Cooldown Nuke', () => {
  it('queues massive hordes along the runway toward the distant horizon instead of clumping in one small zone', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { bonusSquad: 55, damageMult: 2.0, critChance: 0.2 });
    world.gateRowPool.releaseAll(world.gateRows);
    world.gatePool.releaseAll(world.gates);
    world.vaultPool.releaseAll(world.vaults);
    world.enemyPool.releaseAll(world.enemies);

    world.squadCount = 135;
    world.learnedWeaponLevels = { pulse: 3, scatter: 3, rail: 2, plasma: 2, cryo: 2 };
    world.activeFusions = ['cryo_singularity'];
    world.overclockStacks = 3;
    world.playerHasSteered = true;
    world.scrollDistance = 110;
    world.spawnCursor = 999;

    // Pause squad firing briefly to inspect pure spatial formation of 150+ queued horde monsters
    world.fireCooldown = 999;
    world.auxCooldowns = { pulse: 999, scatter: 999, rail: 999, plasma: 999, cryo: 999 };

    const profile = computeDynamicSwarmProfile(world);
    expect(profile.swarmTier).toBeGreaterThanOrEqual(5);

    for (let i = 0; i < 120; i++) {
      stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    }

    const active = world.enemies.filter((e) => e.active && !e.consumed && e.hp > 0);
    expect(active.length).toBeGreaterThanOrEqual(90);

    let minZ = Infinity;
    let maxZ = -Infinity;
    const bandCounts = new Map<number, number>();
    for (const e of active) {
      if (e.z < minZ) minZ = e.z;
      if (e.z > maxZ) maxZ = e.z;
      const band = Math.floor(e.z / 4.0);
      bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1);
    }

    // Column must span >= 55 world units longitudinally and stretch deep toward the horizon (<= -70)!
    expect(maxZ - minZ).toBeGreaterThanOrEqual(55);
    expect(minZ).toBeLessThanOrEqual(-70);

    // Zero pancake clumping: no 4-meter longitudinal slice should pile up > 24 monsters!
    const peakSliceDensity = Math.max(...bandCounts.values());
    expect(peakSliceDensity).toBeLessThanOrEqual(24);
  });

  it('prevents same-lane swarm fodder pileups via enforceRunwayQueueSpacing', () => {
    const world = createSimWorld();
    world.currentScrollSpeed = 12;
    const events: SimEvent[] = [];
    // Spawn 10 fodder crawlers stacked at the exact same (x=0, z=-25) coordinate
    for (let i = 0; i < 10; i++) {
      spawnEnemy(world, 'crawler', 0, -25, { hp: 30, isSwarmFodder: true });
    }
    stepEnemiesAI(world, events);

    const zs = world.enemies.map((e) => e.z).sort((a, b) => b - a);
    // Front-to-tail span of 10 queued crawlers in one lane must stretch > 16 world units!
    expect(zs[0]! - zs[zs.length - 1]!).toBeGreaterThan(16);
    for (let i = 1; i < zs.length; i++) {
      expect(zs[i - 1]! - zs[i]!).toBeGreaterThanOrEqual(1.8);
    }
  });

  it('enforces a long ~46s strategic Tactical Nuke cooldown with post-blast lockout and full-horizon wipe', () => {
    expect(NUKE_COOLDOWN_SEC).toBeGreaterThanOrEqual(44);
    expect(NUKE_BLAST_DURATION).toBeGreaterThanOrEqual(3.0);
    expect(NUKE_KILL_CHARGE).toBeLessThanOrEqual(0.001);

    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { bonusSquad: 20, damageMult: 1.5 });
    world.enemyPool.releaseAll(world.enemies);
    const events: SimEvent[] = [];

    // Place monsters all the way out at z = -125 in the distant horizon!
    spawnEnemy(world, 'crawler', -2, -22, { hp: 40, isSwarmFodder: true });
    spawnEnemy(world, 'crawler', 0, -88, { hp: 40, isSwarmFodder: true });
    spawnEnemy(world, 'bastion', 2, -125, { hp: 120, isSwarmFodder: true });

    expect(tryTriggerNukeStrike(world, events)).toBe(true);
    // Advance 112 ticks (1.87s) through orbital drop into detonation
    for (let t = 0; t < 112; t++) {
      stepNukeStrike(world, events);
    }

    const det = events.find((e) => e.type === 'NUKE_DETONATE');
    expect(det).toBeDefined();
    if (det && det.type === 'NUKE_DETONATE') {
      expect(det.kills).toBe(3); // Wiped near (-22), mid (-88), AND far horizon (-125)!
    }

    // During the 3.25s mushroom-cloud blast aftermath, both passive and kill charge stay locked at 0!
    addNukeKillCharge(world);
    stepNukeStrike(world, events);
    expect(world.nukeCharge).toBe(0);

    // Clear blast timer, then step 20 seconds (1200 ticks) of passive recharge + 100 kills:
    // Must still be well below 100% ready (no 8-second spam!)
    world.nukeBlastTimer = 0;
    for (let t = 0; t < 1200; t++) {
      stepNukeStrike(world, events);
    }
    for (let k = 0; k < 100; k++) {
      addNukeKillCharge(world);
    }
    expect(world.nukeCharge).toBeGreaterThan(0.42);
    expect(world.nukeCharge).toBeLessThan(0.62);
  });
});
