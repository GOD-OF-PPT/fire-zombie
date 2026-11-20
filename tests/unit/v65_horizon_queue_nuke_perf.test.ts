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

  it('supports rapid-tap multi-warhead Tactical Nuke salvos, fast ~7.5s recharge without lockout, and full-horizon wipe', () => {
    expect(NUKE_COOLDOWN_SEC).toBeLessThanOrEqual(8.0);
    expect(NUKE_BLAST_DURATION).toBeGreaterThanOrEqual(3.0);
    expect(NUKE_KILL_CHARGE).toBeGreaterThanOrEqual(0.006);

    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { bonusSquad: 20, damageMult: 1.5 });
    world.enemyPool.releaseAll(world.enemies);
    const events: SimEvent[] = [];

    // Place monsters all the way out at z = -125 in the distant horizon!
    spawnEnemy(world, 'crawler', -2, -22, { hp: 40, isSwarmFodder: true });
    spawnEnemy(world, 'crawler', 0, -88, { hp: 40, isSwarmFodder: true });
    spawnEnemy(world, 'bastion', 2, -125, { hp: 120, isSwarmFodder: true });

    // Rapid-tap 3 warheads back-to-back without waiting for drop or blast lockout!
    expect(tryTriggerNukeStrike(world, events)).toBe(true);
    expect(tryTriggerNukeStrike(world, events)).toBe(true);
    expect(tryTriggerNukeStrike(world, events)).toBe(true);
    expect(world.nukeStocks).toBe(0);
    expect(world.nukeSalvo.length).toBe(3);

    // Advance 75 ticks (1.25s) through orbital drop into detonation
    for (let t = 0; t < 75; t++) {
      stepNukeStrike(world, events);
    }

    const dets = events.filter((e) => e.type === 'NUKE_DETONATE');
    expect(dets.length).toBe(3);
    if (dets[0] && dets[0].type === 'NUKE_DETONATE') {
      expect(dets[0].kills).toBe(3); // Wiped near (-22), mid (-88), AND far horizon (-125)!
    }

    // Even during the 3.25s mushroom-cloud blast aftermath, passive + kill charge flow immediately without lockout!
    const chargeBeforeKills = world.nukeCharge;
    for (let k = 0; k < 40; k++) {
      addNukeKillCharge(world);
    }
    expect(world.nukeCharge).toBeGreaterThan(chargeBeforeKills + 0.3);

    // Step 8 seconds (480 ticks) of fast passive recharge -> refills warhead stocks!
    for (let t = 0; t < 480; t++) {
      stepNukeStrike(world, events);
    }
    expect(world.nukeStocks).toBeGreaterThanOrEqual(1);
  });
});
