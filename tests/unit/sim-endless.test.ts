import { describe, expect, it } from 'vitest';
import { generateEndlessStage, getEndlessEnemyHpMult } from '../../src/config/endless';
import { checkBossVictory, spawnSectorBoss } from '../../src/sim/bosses';
import { createSimWorld, resetSimWorldForSector } from '../../src/sim/world';
import { createSimulation } from '../../src/sim/index';
import { chooseHeuristicTargetX } from '../../src/app/autopilot';
import { advanceEndlessStage, chooseEndlessUpgrade } from '../../src/sim/endless';
import { getProtocolOffers } from '../../src/config/protocols';

describe('Endless Protocol', () => {
  it('generates deterministic, increasingly difficult stages with rotating bosses', () => {
    expect(generateEndlessStage(7, 1)).toEqual(generateEndlessStage(7, 1));
    const bosses = new Set<string>();
    const hpByBoss = new Map<string, number>();
    for (let wave = 1; wave <= 12; wave++) {
      const cfg = generateEndlessStage(7, wave);
      bosses.add(cfg.boss.id);
      expect(cfg.subtitle).toContain(String(wave));
      expect(cfg.encounters.length).toBeGreaterThanOrEqual(35);
      let previous = -Infinity;
      for (const enc of cfg.encounters) {
        expect(enc.crossDist).toBeGreaterThanOrEqual(previous);
        expect(enc.crossDist).toBeLessThan(cfg.runwayLength - 20);
        previous = enc.crossDist;
      }
      if (wave > 1) {
        const previousHp = hpByBoss.get(cfg.boss.id);
        if (previousHp !== undefined) expect(cfg.boss.maxHp).toBeGreaterThan(previousHp);
        expect(cfg.scrollSpeed).toBeGreaterThanOrEqual(generateEndlessStage(7, wave - 1).scrollSpeed);
      }
      hpByBoss.set(cfg.boss.id, cfg.boss.maxHp);
    }
    expect(bosses.size).toBe(3);
    expect(getEndlessEnemyHpMult(8)).toBeGreaterThan(getEndlessEnemyHpMult(2));
  });

  it('advances after a boss kill without victory and preserves run progression', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 4, { endless: true, layoutSeed: 11 });
    world.squadCount = 77;
    world.weapon = 'rail';
    world.weaponLevel = 3;
    world.masteryCount = 4;
    world.stats.kills = 99;
    const firstLength = world.script.runwayLength;
    spawnSectorBoss(world, []);
    world.boss!.hp = 0;

    const events = checkBossVictory(world, []);
    expect(events).toBe(true);
    expect(world.phase).toBe('PLAYING');
    expect(world.endless).toMatchObject({ wave: 2, bossesDefeated: 1, completedDistance: firstLength });
    expect(world.squadCount).toBe(89); // 77 + stage-clear supply 12
    expect(world.weapon).toBe('rail');
    expect(world.weaponLevel).toBe(3);
    expect(world.masteryCount).toBe(4);
    expect(world.stats.kills).toBe(99);
    expect(world.resonance).toBe(1);
    expect(world.boss).toBeNull();
    expect(world.runwayProgress).toBe(0);
    expect(world.spawnCursor).toBe(0);
  });

  it('emits stage transitions instead of RUN_VICTORY and exposes cumulative telemetry', () => {
    const sim = createSimulation();
    sim.startSector(4, { endless: true, layoutSeed: 3 });
    const world = createSimWorld();
    resetSimWorldForSector(world, 4, { endless: true, layoutSeed: 3 });
    const events: Parameters<typeof checkBossVictory>[1] = [];
    spawnSectorBoss(world, events);
    world.boss!.hp = 0;
    checkBossVictory(world, events);
    expect(events.some((e) => e.type === 'ENDLESS_STAGE_START' && e.wave === 2)).toBe(true);
    expect(events.some((e) => e.type === 'RUN_VICTORY')).toBe(false);
    expect(sim.getSnapshot().endless).toMatchObject({ wave: 1, bosses: 0, distance: 0 });
  });

  it('offers a deterministic, varied draft with no duplicates', () => {
    expect(getProtocolOffers(5, 2)).toEqual(getProtocolOffers(5, 2));
    const seen = new Set<string>();
    for (let wave = 2; wave <= 20; wave++) {
      const offers = getProtocolOffers(5, wave);
      expect(offers).toHaveLength(3);
      expect(new Set(offers).size).toBe(3);
      offers.forEach((id) => seen.add(id));
    }
    expect(seen.size).toBe(6);
  });

  it('pauses at the refit stop, accepts exactly one offered protocol and resets on retry', () => {
    const sim = createSimulation();
    sim.startSector(4, { endless: true, manualEndlessDraft: true, manualOverdrive: true, layoutSeed: 5 });
    for (let i = 0; i < 12000 && sim.getSnapshot().phase === 'PLAYING'; i++) {
      const snap = sim.getSnapshot();
      sim.stepFixed({ dragDeltaX: Math.max(-0.32, Math.min(0.32, chooseHeuristicTargetX(snap) - snap.squadX)), keyAxisX: 0, overdrive: true });
    }
    const stop = sim.getSnapshot();
    expect(stop.phase).toBe('PAUSED');
    expect(stop.endless?.wave).toBe(2);
    const time = stop.simTime;
    sim.tickFrame(1, { dragDeltaX: 4, keyAxisX: 1 });
    sim.resume(); // a normal resume cannot skip the draft
    expect(sim.getSnapshot().phase).toBe('PAUSED');
    expect(sim.getSnapshot().simTime).toBe(time);
    const offered = stop.endless!.offers[0]!;
    expect(sim.chooseEndlessUpgrade('recruits')).toBe(false); // not in seed 5's draft
    expect(sim.chooseEndlessUpgrade(offered)).toBe(true);
    expect(sim.chooseEndlessUpgrade(offered)).toBe(false);
    expect(sim.getSnapshot().endless?.upgrades[offered]).toBe(1);
    expect(stop.endless?.upgrades).toEqual({}); // older snapshots remain immutable
    expect(sim.getSnapshot().phase).toBe('PLAYING');
    sim.retry();
    const retry = sim.getSnapshot();
    expect(retry.endless).toMatchObject({ wave: 1, bosses: 0, distance: 0, upgrades: {}, offers: [] });
    expect(retry.squadCount).toBe(8);
    expect(retry.weaponLevel).toBe(1);
  });

  it('keeps protocol blades bounded, remembers weapon upgrades and applies future supply', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 4, { endless: true, layoutSeed: 5 });
    const pick = (id: Parameters<typeof chooseEndlessUpgrade>[1]): void => {
      world.phase = 'PAUSED'; world.endless!.offers = [id];
      expect(chooseEndlessUpgrade(world, id)).toBe(true);
    };
    for (let i = 0; i < 5; i++) pick('blades');
    expect(world.bladesCount).toBe(4);
    expect(world.mods.damageMult).toBeGreaterThan(1);
    world.weapon = 'rail'; world.weaponLevel = 1;
    pick('weapon');
    expect(world.learnedWeaponLevels.rail).toBe(2);
    pick('weapon'); pick('weapon');
    expect(world.weaponLevel).toBe(3);
    expect(world.masteryCount).toBe(3);
    pick('supply'); pick('supply');
    world.overdriveTimer = 4;
    advanceEndlessStage(world);
    expect(world.resonance).toBe(1);
    expect(world.overdriveTimer).toBe(0);
    expect(world.squadCount).toBe(44); // 8 + 12 base + 24 logistics
  });

  it('lets the standard-strength autopilot clear the first boss across varied seeds', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = createSimulation();
      sim.startSector(4, { endless: true, layoutSeed: seed });
      let steps = 0;
      while (sim.getSnapshot().phase === 'PLAYING' && (sim.getSnapshot().endless?.wave ?? 1) === 1 && steps < 12000) {
        const snap = sim.getSnapshot();
        const drag = Math.max(-0.32, Math.min(0.32, chooseHeuristicTargetX(snap) - snap.squadX));
        sim.stepFixed({ dragDeltaX: drag, keyAxisX: 0, overdrive: true });
        steps++;
      }
      const snap = sim.getSnapshot();
      expect(snap.endless?.wave, `seed ${seed}: ${snap.phase}, squad ${snap.squadCount}`).toBeGreaterThanOrEqual(2);
      expect(snap.endless?.bosses).toBe(1);
      expect(snap.squadCount).toBeGreaterThan(0);
    }
  });

  it('can play through multiple real generated stages with the normal fixed-step pipeline', () => {
    const sim = createSimulation();
    sim.startSector(4, {
      endless: true,
      layoutSeed: 5,
      bonusSquad: 240,
      damageMult: 8,
      resonanceMult: 2,
    });
    let steps = 0;
    let transitions = 0;
    while (sim.getSnapshot().phase === 'PLAYING' && transitions < 2 && steps < 30000) {
      const snap = sim.getSnapshot();
      const drag = Math.max(-0.32, Math.min(0.32, chooseHeuristicTargetX(snap) - snap.squadX));
      const events = sim.stepFixed({ dragDeltaX: drag, keyAxisX: 0, overdrive: true });
      transitions += events.filter((e) => e.type === 'ENDLESS_STAGE_START').length;
      steps++;
    }
    const snap = sim.getSnapshot();
    expect(snap.phase).toBe('PLAYING');
    expect(transitions).toBe(2);
    expect(snap.endless?.wave).toBe(3);
    expect(snap.endless?.bosses).toBe(2);
    expect(snap.endless?.distance).toBeGreaterThan(1900);
    expect(snap.stats.kills).toBeGreaterThan(50);
  });
});
