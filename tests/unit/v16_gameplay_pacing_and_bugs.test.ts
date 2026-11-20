import { describe, expect, it } from 'vitest';
import { createSimWorld, reconcileFormationAndDps, resetSimWorldForSector } from '../../src/sim/world';
import { damageEnemy, spawnEnemy, stepOrbitalBlades } from '../../src/sim/enemies';
import { computeAuthoritativeEffectiveDps, damageVault, spawnVault } from '../../src/sim/weapons';
import { spawnSectorBoss, stepBossAI } from '../../src/sim/bosses';
import { damageBossPart } from '../../src/sim/competition';
import { spawnGateRow, resolveGateRowCrossings } from '../../src/sim/gates';
import { computeDamageBreakdown } from '../../src/app/meta';
import type { SimEvent } from '../../src/types/game';

describe('V16 Bug Fixes, Staged Build Choice, Boss Climax & Reserve Systems', () => {
  it('fixes Bug #1: at 60 Rampage stacks, CHAIN_ARC triggers strictly once every 3 kills instead of every kill', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { damageMult: 1.2 });
    world.enemyPool.releaseAll(world.enemies);
    world.squadCount = 40;
    world.rampageStacks = 60;
    world.rampageKillCounter = 60;
    world.rampageTimer = 2.5;

    let arcTriggers = 0;
    for (let k = 0; k < 9; k++) {
      const victim = spawnEnemy(world, 'crawler', 0, -10, { hp: 5 });
      const neighbor = spawnEnemy(world, 'crawler', 0.8, -10.5, { hp: 500 });
      const events: SimEvent[] = [];
      damageEnemy(world, victim, 50, 0, events);
      if (events.some((e) => e.type === 'CHAIN_ARC')) {
        arcTriggers += 1;
      }
      neighbor.active = false;
      neighbor.consumed = true;
    }
    expect(world.rampageStacks).toBe(60);
    expect(arcTriggers).toBe(3); // Kills 3, 6, 9 ONLY (not all 9!)
  });

  it('fixes Bug #2: authoritative effectiveSquadDps matches Mirror-Twin 1.16x & Overclock auxiliary formula', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { mutators: ['mirror_twin'] });
    world.squadCount = 50;
    const v1 = spawnVault(world, 0, -10, 0, 10, 'scatter');
    damageVault(world, v1, 20, []);
    world.overclockStacks = 3;
    reconcileFormationAndDps(world);

    // Centered (|squadX| <= 0.45): mirror_twin inactive -> 1.0x
    world.squadX = 0;
    const centerDps = computeAuthoritativeEffectiveDps(world, false);
    // Offset (|squadX| > 0.45): mirror_twin active -> exact 1.16x!
    world.squadX = 2.0;
    const twinDps = computeAuthoritativeEffectiveDps(world, false);
    expect(twinDps / centerDps).toBeCloseTo(1.16, 4);
  });

  it('fixes Bug #3: records orbital blades damage and aggregates 5+ sources into 其他协同伤害 summing to 100%', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1);
    world.enemyPool.releaseAll(world.enemies);
    world.squadCount = 20;
    world.bladesCount = 3;
    spawnEnemy(world, 'bastion', world.squadX + 2.6, 6.0, { hp: 200 });
    const events: SimEvent[] = [];
    stepOrbitalBlades(world, events);
    expect(world.damageBySource.blades).toBeGreaterThan(0);

    const rows = computeDamageBreakdown({
      pulse: 4000,
      scatter: 3000,
      plasma: 2000,
      fusions: 1500,
      blades: 800,
      deflect: 500,
      explosives: 200,
      rail: 0,
      cryo: 0,
    });
    expect(rows.length).toBe(5);
    expect(rows[4]!.key).toBe('other');
    expect(rows[4]!.label).toBe('其他协同伤害');
    expect(rows[4]!.damage).toBe(1500);
    const totalPct = rows.reduce((s, r) => s + r.pct, 0);
    expect(totalPct).toBe(100);
  });

  it('enforces 2-Main-Weapon + 1-Core-Fusion build identity, off-spec salvage, and 2-pickup build pivot', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1);
    const events: SimEvent[] = [];
    for (const rw of ['plasma', 'cryo', 'plasma'] as const) {
      const v = spawnVault(world, 0, -10, 0, 10, rw);
      damageVault(world, v, 25, events);
    }
    expect(world.activeLoadout).toEqual(['plasma', 'cryo']);
    expect(world.activeFusions).toEqual(['cryo_singularity']);

    // 1st off-spec scatter pickup salvages into active build upgrade + Reserve without diluting loadout!
    const off1 = spawnVault(world, 0, -10, 0, 10, 'scatter');
    events.length = 0;
    damageVault(world, off1, 25, events);
    expect(events.some((e) => e.type === 'VAULT_SALVAGE')).toBe(true);
    expect(world.activeLoadout).toEqual(['plasma', 'cryo']);
    expect(world.learnedWeaponLevels.cryo).toBe(2);

    // Deliberate 2nd consecutive scatter pickup + rail pivots build to Prism Ricochet Web!
    const off2 = spawnVault(world, 0, -10, 0, 10, 'scatter');
    damageVault(world, off2, 25, events);
    const off3 = spawnVault(world, 0, -10, 0, 10, 'rail');
    damageVault(world, off3, 25, events);
    expect(world.activeLoadout).toEqual(['scatter', 'rail']);
    expect(world.activeFusions).toEqual(['prism_ricochet_web']);
  });

  it('banks overflow above 999 into Reserve Troops and auto-deploys them after squad loss', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 1);
    world.gateRowPool.releaseAll(world.gateRows);
    world.gatePool.releaseAll(world.gates);
    world.squadCount = 980;
    const row = spawnGateRow(world, {
      layout: 'standalone',
      z: 5.8,
      vz: 10,
      single: { x: 0, halfWidth: 3.0, op: 'add', value: 60, mutable: false },
    });
    row.prevZ = 5.5;
    row.z = 6.2;
    const events: SimEvent[] = [];
    resolveGateRowCrossings(world, events);
    expect(world.squadCount).toBe(999);
    expect(world.reserveTroops).toBeGreaterThanOrEqual(41);

    // Now hit a -40 negative gate -> Reserve Troops immediately deploy back to frontline!
    const negRow = spawnGateRow(world, {
      layout: 'standalone',
      z: 5.8,
      vz: 10,
      single: { x: 0, halfWidth: 3.0, op: 'sub', value: 40, mutable: false },
    });
    negRow.prevZ = 5.5;
    negRow.z = 6.2;
    events.length = 0;
    resolveGateRowCrossings(world, events);
    expect(events.some((e) => e.type === 'RESERVE_DEPLOY')).toBe(true);
    expect(world.squadCount).toBeGreaterThan(959);
  });

  it('spawns Boss Doom-Orb within ~2.3s and visibly cuts gunfire/summons when Left/Right shoulders break', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 4, { blitz: true });
    world.simTime = 55;
    world.scrollDistance = 745;
    world.squadCount = 120;
    const events: SimEvent[] = [];
    const boss = spawnSectorBoss(world, events);

    // Step 2.5s (1.2s intro + 1.3s combat) -> early Doom-Orb must already be spawned!
    for (let i = 0; i < 150; i++) {
      stepBossAI(world, events);
    }
    expect(world.doomOrbs.length).toBeGreaterThanOrEqual(1);

    // Break Left Shoulder -> immediately purges hostile airborne orbs!
    for (let i = 0; i < 60; i++) stepBossAI(world, events);
    damageBossPart(world, boss.parts[0]!, boss.parts[0]!.hp + 10, events);
    expect(boss.parts[0]!.destroyed).toBe(true);
    expect(world.projectiles.filter((p) => p.active && p.hostile).length).toBe(0);

    // Break Right Shoulder -> cuts summon cadence even with meta power!
    resetSimWorldForSector(world, 1, { damageMult: 1.3, bonusSquad: 10 });
    world.simTime = 60;
    world.scrollDistance = 600;
    world.squadCount = 120;
    const metaBoss = spawnSectorBoss(world, []);
    metaBoss.introProgress = 1;
    metaBoss.parts[1]!.destroyed = true;
    const beforeSummonTimer = metaBoss.summonTimer;
    stepBossAI(world, []);
    const dtDropBroken = beforeSummonTimer - metaBoss.summonTimer;
    expect(dtDropBroken).toBeLessThan((1 / 60) * 0.5);
  });
});
