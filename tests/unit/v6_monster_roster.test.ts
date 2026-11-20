import { describe, expect, it } from 'vitest';
import { ENEMY_META } from '../../src/app/meta';
import { loadSave } from '../../src/app/save';
import { ENEMY_CONFIGS } from '../../src/config/enemies';
import { getWeaponCounterMult } from '../../src/config/weapons';
import { damageEnemy, spawnEnemy, stepEnemiesAI } from '../../src/sim/enemies';
import { spawnGateRow } from '../../src/sim/gates';
import { createSimWorld } from '../../src/sim/world';
import type { EnemyKind, SimEvent } from '../../src/types/game';

describe('V6 Expanded 10-Archetype Monster Roster & Tactical Mechanics', () => {
  it('registers all 10 EnemyKinds across ENEMY_CONFIGS, ENEMY_META, and save bestiaryKills', () => {
    const allKinds: EnemyKind[] = [
      'crawler',
      'dasher',
      'bastion',
      'mitosis',
      'siphon',
      'bomber',
      'phalanx',
      'stalker',
      'brood',
      'howler',
      'glacier',
      'beholder',
      'burrower',
      'necromancer',
    ];
    const save = loadSave();
    for (const k of allKinds) {
      expect(ENEMY_CONFIGS[k]).toBeDefined();
      expect(ENEMY_META[k]).toBeDefined();
      expect(ENEMY_META[k].glyph.length).toBeGreaterThan(0);
      expect(save.bestiaryKills[k]).toBe(0);
    }
    expect(getWeaponCounterMult('rail', 'phalanx')).toBe(2.0);
    expect(getWeaponCounterMult('cryo', 'stalker')).toBe(1.75);
    expect(getWeaponCounterMult('plasma', 'brood')).toBe(1.75);
    expect(getWeaponCounterMult('pulse', 'bomber')).toBe(1.5);
  });

  it('Volatile Bomber detonates on combat kill, blasting nearby monsters and boosting mutable gates +2', () => {
    const world = createSimWorld();
    const events: SimEvent[] = [];
    const bomber = spawnEnemy(world, 'bomber', 0, -14);
    const victimA = spawnEnemy(world, 'crawler', -1.2, -14.5, { hp: 30 });
    const victimB = spawnEnemy(world, 'crawler', 1.4, -13.8, { hp: 20 });
    const row = spawnGateRow(world, {
      layout: 'standalone',
      z: -15.5,
      vz: 0,
      single: { x: 0, halfWidth: 2.0, op: 'sub', value: 4, mutable: true, damagePerStep: 12, stepDelta: 1, maxValue: 20 },
    });
    const gate = world.gates.find((g) => g.id === row.singleGateId)!;
    expect(gate.value).toBe(-4);

    const killed = damageEnemy(world, bomber, 50, 0, events);
    expect(killed).toBe(true);
    expect(victimA.hp).toBe(0);
    expect(victimB.hp).toBe(0);
    expect(gate.value).toBe(-2);
    expect(events.some((e) => e.type === 'BOMBER_BLAST')).toBe(true);
  });

  it('Aegis Phalanx frontal energy shield absorbs non-piercing hits, breaks with SHIELD_BREAK, and is bypassed by Rail/Plasma', () => {
    const world = createSimWorld();
    const events: SimEvent[] = [];
    const p1 = spawnEnemy(world, 'phalanx', -1.5, -16);
    expect(p1.shieldHp).toBeGreaterThan(30);

    // Non-piercing hit gets partially absorbed by shield
    damageEnemy(world, p1, 20, 0, events, { bypassShield: false });
    expect(p1.hp).toBeCloseTo(60, 1); // only 40% (8 dmg) leaked through active shield
    expect(p1.shieldHp).toBeGreaterThan(0);

    // Bypassing hit (Rail / Plasma splash / Amplified) deals full HP damage AND crushes shield
    const p2 = spawnEnemy(world, 'phalanx', 1.5, -16);
    damageEnemy(world, p2, 30, 0, events, { bypassShield: true });
    expect(p2.hp).toBeCloseTo(38, 1);
    expect(p2.shieldHp).toBe(0);
    expect(events.some((e) => e.type === 'SHIELD_BREAK')).toBe(true);
  });

  it('Phase Stalker blinks laterally every 1.75s unless locked by Cryo slow', () => {
    const world = createSimWorld();
    world.currentScrollSpeed = 12;
    const events: SimEvent[] = [];
    const stalker = spawnEnemy(world, 'stalker', -1.2, -32);
    const startX = stalker.x;

    // Advance 1.8s (108 ticks) without Cryo -> should trigger PHASE_BLINK
    for (let i = 0; i < 110; i++) {
      stepEnemiesAI(world, events);
    }
    expect(events.some((e) => e.type === 'PHASE_BLINK')).toBe(true);
    expect(Math.abs(stalker.x - startX)).toBeGreaterThan(1.5);

    // Cryo-chilled Stalker cannot phase-blink while slowTimer > 0
    const chilled = spawnEnemy(world, 'stalker', 0.8, -32);
    chilled.slowTimer = 3.0;
    const chillEvents: SimEvent[] = [];
    for (let i = 0; i < 115; i++) {
      stepEnemiesAI(world, chillEvents);
    }
    expect(chillEvents.filter((e) => e.type === 'PHASE_BLINK' && e.fromX === 0.8)).toHaveLength(0);
    expect(chilled.x).toBeCloseTo(0.8, 3);
  });

  it('Brood Carrier hatches swarmlings while marching and Frenzy Howler buffs pack speed then chills on death', () => {
    const world = createSimWorld();
    world.currentScrollSpeed = 10;
    const events: SimEvent[] = [];

    const brood = spawnEnemy(world, 'brood', 0, -38);
    for (let i = 0; i < 175; i++) {
      stepEnemiesAI(world, events);
    }
    expect(events.some((e) => e.type === 'BROOD_SPAWN')).toBe(true);
    expect(world.enemies.length).toBeGreaterThanOrEqual(3);

    // Howler aura boosts nearby crawler speed, and killing Howler chills nearby pack
    const w2 = createSimWorld();
    w2.currentScrollSpeed = 10;
    const e2: SimEvent[] = [];
    const solo = spawnEnemy(w2, 'crawler', -3.5, -25);
    const buffed = spawnEnemy(w2, 'crawler', 2.0, -25);
    const howler = spawnEnemy(w2, 'howler', 2.2, -25.5);
    stepEnemiesAI(w2, e2);
    expect(buffed.frenzyBuffed).toBe(true);
    expect(solo.frenzyBuffed).toBe(false);
    expect(buffed.z - -25).toBeGreaterThan(solo.z - -25);

    damageEnemy(w2, howler, 200, 0, e2);
    expect(e2.some((ev) => ev.type === 'HOWLER_PURGE')).toBe(true);
    expect(buffed.slowTimer).toBeGreaterThanOrEqual(1.5);
  });
});
