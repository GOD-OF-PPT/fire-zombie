import { describe, expect, it } from 'vitest';
import { spawnEnemy, stepEnemiesAI } from '../../src/sim/enemies';
import { sampleUniformSwarmX } from '../../src/sim/spawner';
import { resolveFriendlyProjectileCollisions } from '../../src/sim/combat';
import { createSimWorld, resetSimWorldForSector, stepWorldFixed } from '../../src/sim/world';
import type { SimEvent } from '../../src/types/game';

describe('V7 Uniform 2D Blue-Noise Swarm Distribution & Ballistic Hit Tagging', () => {
  it('distributes sampleUniformSwarmX evenly across Left, Center, and Right thirds with zero grid clustering', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1);

    let left = 0;
    let center = 0;
    let right = 0;
    const xs: number[] = [];

    for (let i = 0; i < 120; i++) {
      const { x } = sampleUniformSwarmX(world);
      xs.push(x);
      if (x < -1.44) left++;
      else if (x <= 1.44) center++;
      else right++;
    }

    // 120 samples across 6 coprime stratified sub-bands = exact 40 / 40 / 40 balance across thirds!
    expect(left).toBeGreaterThanOrEqual(38);
    expect(left).toBeLessThanOrEqual(42);
    expect(center).toBeGreaterThanOrEqual(38);
    expect(center).toBeLessThanOrEqual(42);
    expect(right).toBeGreaterThanOrEqual(38);
    expect(right).toBeLessThanOrEqual(42);

    // Non-grid organic diversity: 120 samples must produce > 100 distinct X coordinates (not 6 or 8 fixed columns!)
    const roundedUnique = new Set(xs.map((v) => v.toFixed(3)));
    expect(roundedUnique.size).toBeGreaterThanOrEqual(105);
  });

  it('streams continuous early/mid-runway monsters evenly across lanes for active steered runs without dead gaps', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { bonusSquad: 8, damageMult: 1.15 });
    world.gateRowPool.releaseAll(world.gateRows);
    world.gatePool.releaseAll(world.gates);
    world.vaultPool.releaseAll(world.vaults);
    world.enemyPool.releaseAll(world.enemies);

    // Pause firing to inspect pure continuous early-runway stream starting from d = 32
    world.playerHasSteered = true;
    world.scrollDistance = 32;
    world.spawnCursor = 999;
    world.fireCooldown = 999;
    world.auxCooldowns = { pulse: 999, scatter: 999, rail: 999, plasma: 999, cryo: 999 };

    for (let t = 0; t < 90; t++) {
      stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    }

    const active = world.enemies.filter((e) => e.active && !e.consumed && e.hp > 0);
    expect(active.length).toBeGreaterThanOrEqual(14);

    const leftCount = active.filter((e) => e.x < -1.4).length;
    const centerCount = active.filter((e) => e.x >= -1.4 && e.x <= 1.4).length;
    const rightCount = active.filter((e) => e.x > 1.4).length;

    expect(leftCount).toBeGreaterThanOrEqual(3);
    expect(centerCount).toBeGreaterThanOrEqual(3);
    expect(rightCount).toBeGreaterThanOrEqual(3);
  });

  it('applies smooth 2D lateral soft-separation when swarm fodder monsters spawn slightly overlapping', () => {
    const world = createSimWorld();
    world.currentScrollSpeed = 12;
    const events: SimEvent[] = [];

    // Spawn 8 fodder crawlers clustered tightly near x = -0.3..+0.3, z = -28..-28.4
    for (let i = 0; i < 8; i++) {
      const ox = (i - 3.5) * 0.08;
      const oz = -28 - (i % 2) * 0.25;
      spawnEnemy(world, 'crawler', ox, oz, { hp: 30, isSwarmFodder: true });
    }

    for (let t = 0; t < 20; t++) {
      stepEnemiesAI(world, events);
    }

    const xs = world.enemies.map((e) => e.x);
    const spanX = Math.max(...xs) - Math.min(...xs);
    // Initial lateral span was 0.56u; 2D soft-repulsion expands lateral spread organically (> 1.1u)
    expect(spanX).toBeGreaterThan(1.1);
  });

  it('tags ENEMY_HIT events with the exact impacting weapon caliber for material-accurate audio & VFX', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1);
    world.enemyPool.releaseAll(world.enemies);
    world.projectilePool.releaseAll(world.projectiles);

    const target = spawnEnemy(world, 'bastion', 0, -10, { hp: 200 });
    const proj = world.projectilePool.acquire();
    proj.id = 9901;
    proj.weapon = 'rail';
    proj.prevX = 0;
    proj.prevZ = -8.5;
    proj.x = 0;
    proj.z = -11.5;
    proj.vx = 0;
    proj.vz = -60;
    proj.damage = 45;
    proj.remainingPierce = 2;
    proj.radius = 0.22;
    proj.maxRange = 60;
    proj.active = true;
    world.projectiles.push(proj);

    const events: SimEvent[] = [];
    resolveFriendlyProjectileCollisions(world, events);

    const hitEv = events.find((e) => e.type === 'ENEMY_HIT');
    expect(hitEv).toBeDefined();
    if (hitEv && hitEv.type === 'ENEMY_HIT') {
      expect(hitEv.kind).toBe(target.kind);
      expect(hitEv.weapon).toBe('rail');
      expect(hitEv.fatal).toBe(false);
    }
  });
});
