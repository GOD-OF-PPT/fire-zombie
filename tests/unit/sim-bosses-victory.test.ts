import { describe, expect, it } from 'vitest';
import { BARREL_BLAST_DAMAGE, PLAYER_Z } from '../../src/config/constants';
import type { SectorId, SimEvent } from '../../src/types/game';
import { damageBarrel, spawnBarrel } from '../../src/sim/barrels';
import {
  applyBarrelBlastToBoss,
  damageBossCore,
  damageBossPylon,
  spawnSectorBoss,
} from '../../src/sim/bosses';
import { spawnEnemy } from '../../src/sim/enemies';
import { spawnGateRow } from '../../src/sim/gates';
import {
  buildSimSnapshot,
  createSimWorld,
  reconcileFormationAndDps,
  resetSimWorldForSector,
  stepWorldFixed,
} from '../../src/sim/world';

function createBossArenaWorld(sector: SectorId) {
  const world = createSimWorld();
  resetSimWorldForSector(world, sector);
  world.gateRowPool.releaseAll(world.gateRows);
  world.gatePool.releaseAll(world.gates);
  world.vaultPool.releaseAll(world.vaults);
  world.enemyPool.releaseAll(world.enemies);
  world.barrelPool.releaseAll(world.barrels);
  world.lensPool.releaseAll(world.lenses);
  world.projectilePool.releaseAll(world.projectiles);
  world.scrollDistance = 2000;
  world.currentScrollSpeed = 0;
  world.runwayProgress = 1.0;
  world.fireCooldown = 999;
  world.squadCount = 40;
  reconcileFormationAndDps(world);

  const introEvents: SimEvent[] = [];
  spawnSectorBoss(world, introEvents);
  // Complete 1.2s arrival intro (75 ticks)
  for (let i = 0; i < 75; i++) {
    stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
  }
  return { world, introEvents };
}

describe('Multi-Phase Boss State Machines (Warden-01, Hydra-02, Omega-Zero) & Step 7 Victory Priority', () => {
  it('verifies Warden-01 >=0.85s telegraphs with safe lane, Prism Lens spawn, and Phase 2 sliding Emergency Shootable Gate', () => {
    const { world, introEvents } = createBossArenaWorld(1);
    const boss = world.boss!;
    expect(introEvents.some((e) => e.type === 'BOSS_INTRO' && e.bossId === 'warden_01')).toBe(true);
    expect(boss.introProgress).toBe(1.0);
    expect(boss.phase).toBe(1);

    // Advance Phase 1 long enough to observe hazard telegraph (>=0.95s) and Prism Lens spawn
    let sawWarning = false;
    let sawSafeLane = false;
    for (let i = 0; i < 180; i++) {
      // Park squad on safe lane if hazards appear
      if (boss.hazardZones.length > 0) {
        sawWarning = true;
        for (const z of boss.hazardZones) {
          expect(z.warningDuration).toBeGreaterThanOrEqual(0.85);
        }
        const candidates = [-3.35, 0, 3.35];
        const safe = candidates.find((cx) =>
          boss.hazardZones.every((hz) => Math.abs(cx - hz.x) > hz.halfWidth + 1.0),
        );
        if (safe !== undefined) {
          sawSafeLane = true;
          world.squadX = safe;
        }
      }
      stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    }
    expect(sawWarning).toBe(true);
    expect(sawSafeLane).toBe(true);
    expect(world.lenses.length).toBeGreaterThanOrEqual(1);

    // Drop HP <= 50% -> triggers BOSS_PHASE_BREAK (phase: 2) and spawns standalone shootable gate (-2 -> +8)
    const breakEvents: SimEvent[] = [];
    damageBossCore(world, false, Math.ceil(boss.maxHp * 0.5) + 200, breakEvents);
    expect(boss.phase).toBe(2);
    expect(breakEvents.some((e) => e.type === 'BOSS_PHASE_BREAK' && e.phase === 2)).toBe(true);
    expect(world.gates.length).toBe(1);
    expect(world.gates[0]!.mutable).toBe(true);
    expect(world.gates[0]!.value).toBe(-2);
    expect(world.gates[0]!.maxValue).toBe(8);
  });

  it('verifies Hydra-02 Phase 2 twin core split, 3.6s alternating shields, and 1.5x exposed weakpoint multiplier', () => {
    const { world } = createBossArenaWorld(2);
    const boss = world.boss!;
    expect(boss.id).toBe('hydra_02');
    expect(boss.secondaryCore).toBeNull();

    // Push into Phase 2 (<= 50% HP)
    const phaseEvents: SimEvent[] = [];
    damageBossCore(world, false, Math.ceil(boss.maxHp * 0.5) + 500, phaseEvents);
    expect(boss.phase).toBe(2);
    expect(phaseEvents.some((e) => e.type === 'BOSS_PHASE_BREAK' && e.phase === 2)).toBe(true);
    expect(boss.secondaryCore).not.toBeNull();
    expect(boss.shielded).toBe(false);
    expect(boss.secondaryCore!.shielded).toBe(true);

    // Shielded secondary core blocks 100% of damage; exposed primary core takes 1.5x weakpoint damage!
    const hpBefore = boss.hp;
    damageBossCore(world, true, 200, []);
    expect(boss.hp).toBe(hpBefore);

    damageBossCore(world, false, 200, []);
    expect(boss.hp).toBe(hpBefore - 300); // 200 * 1.5 = 300!

    // Advance > 3.6s (220 ticks) while keeping squad safe -> shields alternate!
    for (let i = 0; i < 220; i++) {
      world.squadCount = 40;
      stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    }
    expect(boss.shielded).toBe(true);
    expect(boss.secondaryCore!.shielded).toBe(false);

    // Now primary blocks 100% and secondary takes 1.5x weakpoint damage!
    const hpAfterSwap = boss.hp;
    damageBossCore(world, false, 200, []);
    expect(boss.hp).toBe(hpAfterSwap);
    damageBossCore(world, true, 200, []);
    expect(boss.hp).toBe(hpAfterSwap - 300);
  });

  it('verifies Omega-Zero Phase 1 Pylon shield break + stun damage + weapon upgrade, Phase 2 Dashers/Lens, and Phase 3 Arena Surge Barrels', () => {
    const { world } = createBossArenaWorld(3);
    const boss = world.boss!;
    expect(boss.id).toBe('omega_zero');
    expect(boss.phase).toBe(1);
    expect(boss.shielded).toBe(true);
    expect(boss.pylons.length).toBe(2);

    // Direct core shot while shielded deals 0 damage
    damageBossCore(world, false, 1000, []);
    expect(boss.hp).toBe(boss.maxHp);

    // Break Pylon 1 -> deals 18% stun chunk, upgrades weapon level & mastery, still Phase 1 until Pylon 2 breaks
    const p1Events: SimEvent[] = [];
    damageBossPylon(world, boss.pylons[0]!, 4000, p1Events);
    expect(boss.pylons[0]!.destroyed).toBe(true);
    expect(boss.hp).toBe(boss.maxHp - Math.ceil(boss.maxHp * 0.18));
    expect(world.weaponLevel).toBe(2);
    expect(world.masteryCount).toBe(1);
    expect(boss.phase).toBe(1);

    // Break Pylon 2 -> second 18% stun chunk, unshields Omega-Zero, transitions to Phase 2!
    const p2Events: SimEvent[] = [];
    damageBossPylon(world, boss.pylons[1]!, 4000, p2Events);
    expect(boss.pylons[1]!.destroyed).toBe(true);
    expect(boss.shielded).toBe(false);
    expect(boss.phase).toBe(2);
    expect(p2Events.some((e) => e.type === 'BOSS_PHASE_BREAK' && e.phase === 2)).toBe(true);

    const snapP2 = buildSimSnapshot(world);
    expect(snapP2.boss!.pylons.every((p) => p.destroyed)).toBe(true);

    // Advance Phase 2 for 2.6s (160 ticks) to observe Vector Dasher arena escorts and Prism Lens
    for (let i = 0; i < 160; i++) {
      world.squadCount = 40;
      stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    }
    expect(world.enemies.some((e) => e.kind === 'dasher')).toBe(true);
    expect(world.lenses.length).toBeGreaterThanOrEqual(1);

    // Drop HP <= 30% (<= 9300) -> enters Phase 3 and spawns 3 connected Arena Surge Barrels!
    const toRemove = boss.hp - 9000;
    const p3Events: SimEvent[] = [];
    damageBossCore(world, false, toRemove, p3Events);
    expect(boss.phase).toBe(3);
    expect(p3Events.some((e) => e.type === 'BOSS_PHASE_BREAK' && e.phase === 3)).toBe(true);

    for (let i = 0; i < 40; i++) {
      world.squadCount = 40;
      stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    }
    expect(world.barrels.length).toBe(3);

    // Detonate front arena barrel and let chain run -> all 3 barrels blast Omega-Zero for 3 * 130 = 390 damage!
    const hpBeforeBarrels = boss.hp;
    damageBarrel(world, world.barrels[0]!, 30, [], applyBarrelBlastToBoss);
    for (let i = 0; i < 20; i++) {
      world.squadCount = 40;
      stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    }
    expect(hpBeforeBarrels - boss.hp).toBe(3 * BARREL_BLAST_DAMAGE);
  });

  it('prioritizes Step 7 Boss VICTORY over simultaneous Step 8/9 lethal hazards, hostile orbs, and negative gates', () => {
    const { world } = createBossArenaWorld(1);
    const boss = world.boss!;
    boss.hp = 5;
    boss.x = 0;
    boss.z = -18.0;

    // 1-drone squad standing directly inside a firing lethal BossHazardZone + crossing -99 Gate + incoming hostile orb
    world.squadCount = 1;
    world.squadX = 0;
    reconcileFormationAndDps(world);

    boss.hazardZones.push({
      id: 9901,
      x: 0,
      z: -6.0,
      halfWidth: 4.0,
      depth: 28.0,
      warningDuration: 0.9,
      fireDuration: 0.4,
      elapsed: 0.95,
      warningProgress: 1.0,
      firing: true,
      strikeLoss: 99,
      damageApplied: false,
    });

    spawnGateRow(world, {
      layout: 'standalone',
      z: PLAYER_Z - 0.05,
      vz: 12.0,
      single: { x: 0, halfWidth: 3.0, op: 'sub', value: 99, mutable: false },
    });

    spawnEnemy(world, 'crawler', 0, PLAYER_Z - 0.05, { hp: 50 });

    const hostileOrb = world.projectilePool.acquire();
    hostileOrb.id = 9902;
    hostileOrb.x = 0;
    hostileOrb.z = PLAYER_Z - 0.1;
    hostileOrb.prevX = 0;
    hostileOrb.prevZ = PLAYER_Z - 0.1;
    hostileOrb.vx = 0;
    hostileOrb.vz = 20.0;
    hostileOrb.radius = 0.35;
    hostileOrb.weapon = 'plasma';
    hostileOrb.hostile = true;
    hostileOrb.hostileLoss = 10;
    hostileOrb.maxRange = 50;
    hostileOrb.active = true;
    world.projectiles.push(hostileOrb);

    // Friendly lethal bolt hits Boss in Step 5 on this exact tick!
    const killShot = world.projectilePool.acquire();
    killShot.id = 9903;
    killShot.x = 0;
    killShot.z = -16.5;
    killShot.prevX = 0;
    killShot.prevZ = -16.5;
    killShot.vx = 0;
    killShot.vz = -180.0;
    killShot.radius = 0.2;
    killShot.weapon = 'pulse';
    killShot.damage = 50;
    killShot.remainingPierce = 0;
    killShot.maxRange = 60;
    killShot.active = true;
    world.projectiles.push(killShot);

    const events = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    expect(world.phase).toBe('VICTORY');
    expect(world.defeatReason).toBeNull();
    expect(world.squadCount).toBe(1);
    expect(events.some((e) => e.type === 'BOSS_DEFEAT')).toBe(true);
    expect(events.some((e) => e.type === 'RUN_VICTORY' && e.finalSquad === 1)).toBe(true);
    expect(events.some((e) => e.type === 'SQUAD_LOSS')).toBe(false);
    expect(events.some((e) => e.type === 'RUN_DEFEAT')).toBe(false);
    // Remaining hostile orbs and enemies are purged on victory
    expect(world.projectiles.some((p) => p.hostile)).toBe(false);
    expect(world.enemies.length).toBe(0);
  });

  it('enrages once the fight overruns its threshold: timers speed up and the core pulses for unavoidable losses', () => {
    const lossOver = (startAt: number) => {
      const { world } = createBossArenaWorld(1);
      const boss = world.boss!;
      boss.fightElapsed = startAt;
      world.squadCount = 100;
      reconcileFormationAndDps(world);
      let lost = 0;
      for (let i = 0; i < 300; i++) {
        boss.hazardTimer = boss.summonTimer = boss.orbTimer = 999;
        for (const e of stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 })) {
          if (e.type === 'SQUAD_LOSS' && e.reason === 'BOSS_ATTACK') lost += e.lost;
        }
      }
      return { lost, enrage: boss.enrage };
    };
    const threshold = 11; // SECTORS[1].boss.enrageAfterSec
    const calm = lossOver(0);
    expect(calm.enrage).toBe(1);
    expect(calm.lost).toBe(0);
    const raged = lossOver(threshold + 4);
    expect(raged.enrage).toBeGreaterThan(1);
    expect(raged.enrage).toBeLessThanOrEqual(2);
    expect(raged.lost).toBeGreaterThan(0);
  });
});
