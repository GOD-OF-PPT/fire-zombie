import { describe, expect, it } from 'vitest';
import { loadSave } from '../../src/app/save';
import { createSimulation, ReplayPlayer, verifyDeterministicReplay } from '../../src/sim/index';
import { damageEnemy, spawnEnemy } from '../../src/sim/enemies';
import { applyFiringRangeCommand } from '../../src/sim/firingRange';
import {
  damageHighSpire,
  damagePantheonCoBoss,
  damageRunawayCart,
  spawnCollapseRift,
  spawnHighSpire,
  spawnTacticalEvent,
  spawnTacticalFormation,
  syncCoreReactorAwakening,
  triggerCoreReactorDomainPulse,
} from '../../src/sim/v21Mechanics';
import { buildSimSnapshot, createSimWorld, resetSimWorldForSector, stepWorldFixed } from '../../src/sim/world';
import type { SimEvent } from '../../src/types/game';

describe('V21 Five-Stage Ultimate AAA Sci-Fi Bullet-Hell Overhaul', () => {
  it('Stage 1: Verticality & Collapse — Airborne leap clears Bridge Gap for bonus, and High-Spire shatters 2.6x faster from airborne/refracted fire', () => {
    const w = createSimWorld();
    resetSimWorldForSector(w, 1, { layoutSeed: 202631 });
    w.gatePool.releaseAll(w.gates);
    w.enemyPool.releaseAll(w.enemies);
    w.spawnCursor = 999999;

    // 1) Airborne leap over Bridge Gap awards RIFT_LEAP_BONUS
    spawnCollapseRift(w, 0, 5.8, 5.0, 'bridge_gap');
    w.squadAirY = 1.6;
    const sqBefore = w.squadCount;
    const evsLeap = stepWorldFixed(w, { dragDeltaX: 0, keyAxisX: 0 });
    expect(evsLeap.some((e) => e.type === 'RIFT_LEAP_BONUS')).toBe(true);
    expect(w.squadCount).toBeGreaterThan(sqBefore);

    // 2) Elevated Prism Sniper Spire resists ground un-amplified grazes (0.45x) vs airborne/refracted 2.6x shatter!
    w.squadAirY = 0;
    const spGround = spawnHighSpire(w, -2.5, -14, 500);
    damageHighSpire(w, spGround, 100, false, []);
    const spAir = spawnHighSpire(w, 2.5, -14, 500);
    w.squadAirY = 1.4;
    damageHighSpire(w, spAir, 100, false, []);
    expect(spAir.hp).toBeLessThan(spGround.hp);

    const shatterEvs: SimEvent[] = [];
    const killed = damageHighSpire(w, spAir, 400, true, shatterEvs);
    expect(killed).toBe(true);
    expect(shatterEvs.some((e) => e.type === 'SPIRE_SHATTER' && e.elevated === true)).toBe(true);

    // Firing Range `verticality` preset spawns rifts, spires, formation, and runaway cart
    const rw = createSimWorld();
    resetSimWorldForSector(rw, 1, { firingRange: true, layoutSeed: 202619 });
    applyFiringRangeCommand(rw, { preset: 'verticality' });
    expect(rw.collapseRifts.length).toBeGreaterThanOrEqual(2);
    expect(rw.highSpires.length).toBeGreaterThanOrEqual(2);
  });

  it('Stage 2: Tactical Squad Formations trigger Command Node Backlash & Boss Rush Pantheon runs 4 stages with Simultaneous Dual-Boss Finale', () => {
    const w = createSimWorld();
    resetSimWorldForSector(w, 2, { layoutSeed: 202632 });
    w.gatePool.releaseAll(w.gates);
    w.enemyPool.releaseAll(w.enemies);
    w.spawnCursor = 999999;

    const fid = spawnTacticalFormation(w, 'aegis_refract', 0, -18);
    const members = w.enemies.filter((e) => e.formationId === fid);
    expect(members.length).toBe(3);
    const leader = members.find((e) => e.isFormationLeader)!;
    const escorts = members.filter((e) => !e.isFormationLeader);
    expect(leader).toBeDefined();
    expect(escorts[0]!.shieldHp).toBeGreaterThan(0);

    // Sniping the Command Node collapses escort shields and deals 45% maxHp overload backlash!
    const evs: SimEvent[] = [];
    damageEnemy(w, leader, leader.hp + 999, 0, evs, { bypassShield: true });
    expect(evs.some((e) => e.type === 'FORMATION_BACKLASH' && e.stunned === 2)).toBe(true);
    expect(escorts[0]!.shieldHp).toBe(0);
    expect(escorts[0]!.hp).toBeLessThan(escorts[0]!.maxHp);

    // Boss Rush Pantheon (`pantheon: true`) advances Stages 1 -> 2 -> 3 -> 4 (with Dual-Boss Co-Boss!) -> VICTORY
    const pw = createSimWorld();
    resetSimWorldForSector(pw, 4, { pantheon: true, layoutSeed: 202633 });
    expect(pw.mods.pantheon).toBe(true);
    expect(pw.pantheonStage).toBe(1);

    for (const expectedNext of [2, 3, 4] as const) {
      // Fast-forward runway until Boss spawns
      for (let t = 0; t < 800 && !pw.boss; t++) {
        stepWorldFixed(pw, { dragDeltaX: 0, keyAxisX: 0 });
      }
      expect(pw.boss).not.toBeNull();
      pw.boss!.shielded = false;
      pw.boss!.hp = 0;
      const pEvs = stepWorldFixed(pw, { dragDeltaX: 0, keyAxisX: 0 });
      expect(pEvs.some((e) => e.type === 'PANTHEON_STAGE_START' && e.stage === expectedNext)).toBe(true);
      expect(pw.pantheonStage).toBe(expectedNext);
      expect(pw.phase).toBe('PLAYING');
    }

    // Stage 4 Finale spawns BOTH Primary Boss (Omega-Zero) AND Co-Boss (Warden-01) simultaneously!
    for (let t = 0; t < 800 && !pw.pantheonCoBoss; t++) {
      stepWorldFixed(pw, { dragDeltaX: 0, keyAxisX: 0 });
    }
    expect(pw.boss).not.toBeNull();
    expect(pw.pantheonCoBoss).not.toBeNull();
    expect(pw.pantheonCoBoss!.active).toBe(true);

    // Killing Primary Boss alone while Co-Boss lives does NOT prematurely end Stage 4!
    pw.boss!.shielded = false;
    pw.boss!.hp = 0;
    stepWorldFixed(pw, { dragDeltaX: 0, keyAxisX: 0 });
    expect(pw.phase).toBe('PLAYING');

    // Defeating Co-Boss completes Stage 4 and locks RUN_VICTORY!
    damagePantheonCoBoss(pw, pw.pantheonCoBoss!.hp + 500, []);
    const winEvs = stepWorldFixed(pw, { dragDeltaX: 0, keyAxisX: 0 });
    expect(pw.phase).toBe('VICTORY');
    expect(winEvs.some((e) => e.type === 'RUN_VICTORY')).toBe(true);
  });

  it('Stage 3: Core Reactor 3-Tier Awakening unleashes Sweeping Pulse Wall & Tactical Drop Events grant Legendary Overclock', () => {
    const w = createSimWorld();
    resetSimWorldForSector(w, 1, { layoutSeed: 202634 });
    w.gatePool.releaseAll(w.gates);
    w.enemyPool.releaseAll(w.enemies);
    w.spawnCursor = 999999;

    // Crack/destroy a Runaway Core Cart -> elevates overclockStacks & Core Reactor Tier!
    w.activeFusions = ['prism_ricochet_web'];
    w.overlimitResonance = 'hyper_rail_flechette';
    syncCoreReactorAwakening(w);
    expect(w.coreReactorTier).toBe(2);

    const cart = spawnTacticalEvent(w, 'runaway_cart', 0, -14);
    const dropEvs: SimEvent[] = [];
    const claimed = damageRunawayCart(w, cart, cart.hp + 100, dropEvs);
    expect(claimed).toBe(true);
    expect(dropEvs.some((e) => e.type === 'TACTICAL_DROP_CLAIM' && e.newReactorTier === 3)).toBe(true);
    expect(w.coreReactorTier).toBe(3);

    // Trigger Tier-3 Reactor Pulse Wall -> clears hostile orbs, strips enemy shields & emits REACTOR_PULSE_WALL!
    const phalanx = spawnEnemy(w, 'phalanx', 0, -18, { hp: 900 });
    expect(phalanx.shieldHp).toBeGreaterThan(0);
    const wallEvs: SimEvent[] = [];
    triggerCoreReactorDomainPulse(w, 'overdrive', wallEvs);
    expect(wallEvs.some((e) => e.type === 'REACTOR_PULSE_WALL')).toBe(true);
    expect(phalanx.shieldHp).toBe(0);
    expect(phalanx.hp).toBeLessThan(900);
    expect(buildSimSnapshot(w).coreReactorTier).toBe(3);
  });

  it('Stage 4 & 5: Accessibility Save Normalization, Highlight Marker Indexing & Sub-Millisecond Replay Timeline Seeking', () => {
    const prevLS = (globalThis as Record<string, unknown>).localStorage;
    const mockStorage = {
      data: new Map<string, string>([
        [
          'prism-swarm-save-v1',
          JSON.stringify({
            version: 1,
            pantheon: { bestScore: 42000, bestStage: 4, clears: 2, bestTime: 95.4 },
            accessibility: { colorblindMode: 'deuteranopia', shakeScale: 0.4, flashScale: 0.5, aimAssist: true },
          }),
        ],
      ]),
      getItem(k: string) {
        return this.data.get(k) ?? null;
      },
      setItem(k: string, v: string) {
        this.data.set(k, v);
      },
    };
    try {
      (globalThis as Record<string, unknown>).localStorage = mockStorage;
      const s = loadSave();
      expect(s.pantheon.clears).toBe(2);
      expect(s.pantheon.bestStage).toBe(4);
      expect(s.accessibility.colorblindMode).toBe('deuteranopia');
      expect(s.accessibility.shakeScale).toBe(0.4);
      expect(s.accessibility.aimAssist).toBe(true);
    } finally {
      (globalThis as Record<string, unknown>).localStorage = prevLS;
    }

    // Fair Trial must strictly disable Aim Assist!
    const fw = createSimWorld();
    resetSimWorldForSector(fw, 4, { blitz: true, fairTrial: true, aimAssist: true, layoutSeed: 202611 });
    expect(fw.mods.aimAssist).toBe(false);

    // Replay Timeline Seeking (`seekReplayTick`) & Highlight Marker Recording
    const sim = createSimulation();
    sim.startSector(4, { pantheon: true, layoutSeed: 202635 });
    let snapMidSquad = 0;
    for (let t = 0; t < 420; t++) {
      sim.stepFixed({ dragDeltaX: Math.sin(t * 0.05) * 0.14, keyAxisX: 0, aegisPulse: t === 150 });
      if (t === 199) {
        snapMidSquad = sim.getSnapshot().squadCount;
      }
    }
    const log = sim.exportReplayLog();
    expect(log.markers.length).toBeGreaterThanOrEqual(1); // BOSS_INTRO indexed automatically!
    expect(verifyDeterministicReplay(log).matched).toBe(true);

    // Seek backwards to tick 200 -> exact same squadCount as original tick 200!
    const player = sim.seekReplayTick(log, 200);
    expect(player.currentTick).toBe(200);
    expect(sim.getSnapshot().squadCount).toBe(snapMidSquad);

    // Continue stepping from tick 200 to 420 -> exact final state!
    const wTest = createSimWorld();
    const p2 = new ReplayPlayer(log);
    p2.seekToWorldTick(wTest, 420);
    expect(wTest.squadCount).toBe(log.expectedFinalSquad);
    expect(wTest.stats.kills).toBe(log.expectedKills);
  });
});
