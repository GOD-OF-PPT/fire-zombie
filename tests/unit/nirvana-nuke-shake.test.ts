// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InputController } from '../../src/input/InputController';
import { createSimulation, verifyDeterministicReplay } from '../../src/sim/index';
import { spawnEnemy } from '../../src/sim/enemies';
import { createSimWorld, resetSimWorldForSector, stepWorldFixed } from '../../src/sim/world';

describe('Nirvana Ultimate Release Fix & Combat Charge Flow', () => {
  it('preserves nirvanaBurst and wingmanCycle inputs after consumeWeaponSwap (keyboard, IME & HUD trigger)', () => {
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    const input = new InputController(stage);

    try {
      // 1. Direct HUD button request must survive consumeWeaponSwap()
      input.requestNirvanaBurst();
      expect(input.consumeWeaponSwap()).toBe(false);
      expect(input.consumeNirvanaBurst()).toBe(true);
      expect(input.consumeNirvanaBurst()).toBe(false);

      // 2. Wingman cycle request must also survive consumeWeaponSwap()
      input.requestWingmanCycle();
      expect(input.consumeWeaponSwap()).toBe(false);
      expect(input.consumeWingmanCycle()).toBe(true);

      // 3. Pressing [G] key triggers Nirvana burst even after consumeWeaponSwap()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG' }));
      expect(input.consumeWeaponSwap()).toBe(false);
      expect(input.consumeNirvanaBurst()).toBe(true);

      // 4. Chinese IME composition keypress (key='Process', code='KeyG') still triggers Nirvana burst
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code: 'KeyG' }));
      expect(input.consumeWeaponSwap()).toBe(false);
      expect(input.consumeNirvanaBurst()).toBe(true);

      // 5. reset() clears pending Nirvana and Wingman flags
      input.requestNirvanaBurst();
      input.requestWingmanCycle();
      input.reset();
      expect(input.consumeNirvanaBurst()).toBe(false);
      expect(input.consumeWingmanCycle()).toBe(false);
    } finally {
      input.destroy();
      stage.remove();
    }
  });

  it('keeps .nirvana-btn clickable inside pointer-events: none .bottom-dock', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/main.css'), 'utf8');
    const blockMatch = css.match(/\.nirvana-btn\s*\{[^}]*\}/);
    expect(blockMatch).not.toBeNull();
    expect(blockMatch![0]).toMatch(/pointer-events:\s*auto/);
  });

  it('charges Nirvana reliably in a standard Sector 1 run, fires cleanly without self-refund, and preserves 0-drift replay', () => {
    const sim = createSimulation();
    sim.startSector(1, { layoutSeed: 202611, bonusSquad: 18, damageMult: 1.5 });

    let fired = false;
    let killsOnBurst = 0;
    let postBurstCharge = -1;

    for (let i = 0; i < 2400; i++) {
      const s = sim.getSnapshot();
      if (s.phase !== 'PLAYING') break;
      const ready = (s.nirvanaCharge ?? 0) >= 0.999 && !fired;
      const evs = sim.stepFixed({
        dragDeltaX: 0,
        keyAxisX: 0,
        overdrive: s.resonance >= 0.99,
        nirvanaBurst: ready,
      });
      for (const ev of evs) {
        if (ev.type === 'OVERLIMIT_NIRVANA_BURST') {
          fired = true;
          killsOnBurst = ev.kills;
          postBurstCharge = sim.getSnapshot().nirvanaCharge ?? -1;
        }
      }
      if (fired) break;
    }

    expect(fired).toBe(true);
    // Nirvana kills must never immediately self-refund the gauge while nirvanaActiveTimer > 0
    expect(postBurstCharge).toBe(0);
    expect(killsOnBurst).toBeGreaterThanOrEqual(0);
    expect((sim.getSnapshot().nirvanaActiveTimer ?? 0)).toBeGreaterThan(2.5);

    // Step through the full 2.8s Nirvana cataclysm window and verify follow-up orbital judgment waves!
    const pulseWaves: number[] = [];
    for (let k = 0; k < 180; k++) {
      if (sim.getSnapshot().phase !== 'PLAYING') break;
      const wEvs = sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0 });
      for (const e of wEvs) {
        if (e.type === 'NIRVANA_WAVE_PULSE') pulseWaves.push(e.wave);
      }
      if ((sim.getSnapshot().nirvanaActiveTimer ?? 0) <= 0) break;
    }
    expect(pulseWaves).toEqual([1, 2]);

    const verify = verifyDeterministicReplay(sim.exportReplayLog());
    expect(verify.matched).toBe(true);
  });

  it('keeps Nirvana disabled in Fair Trial mode and exposes fairTrial on snapshot', () => {
    const world = createSimWorld();
    resetSimWorldForSector(world, 4, { blitz: true, fairTrial: true, layoutSeed: 202611 });
    for (let i = 0; i < 15; i++) {
      spawnEnemy(world, 'crawler', (i % 5) - 2, -16 - i * 1.5, { hp: 5 });
    }
    for (let t = 0; t < 180; t++) {
      stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
    }
    expect(world.nirvanaCharge).toBe(0);
    const evs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0, nirvanaBurst: true });
    expect(evs.some((e) => e.type === 'OVERLIMIT_NIRVANA_BURST')).toBe(false);

    const sim = createSimulation();
    sim.startSector(4, { blitz: true, fairTrial: true, layoutSeed: 202611 });
    expect(sim.getSnapshot().fairTrial).toBe(true);
    expect(sim.getSnapshot().nukeMaxStocks).toBe(1);
  });

  it('queues rapid multi-tap Nuke inputs without dropping taps, fires staggered multi-salvo warheads, shortens skill CDs, and keeps 0-drift replay', () => {
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    const input = new InputController(stage);
    try {
      // Rapid 3x click/tap before the next frame consumes one per tick cleanly instead of collapsing to 1!
      input.requestNuke();
      input.requestNuke();
      input.requestNuke();
      expect(input.consumeNuke()).toBe(true);
      expect(input.consumeNuke()).toBe(true);
      expect(input.consumeNuke()).toBe(true);
      expect(input.consumeNuke()).toBe(false);
    } finally {
      input.destroy();
      stage.remove();
    }

    const sim = createSimulation();
    sim.startSector(1, { layoutSeed: 202611, bonusSquad: 20, damageMult: 1.5, manualOverdrive: true });
    expect(sim.getSnapshot().aegisMaxCooldown).toBeLessThanOrEqual(5.5);
    expect(sim.getSnapshot().nukeStocks).toBe(3);

    // Buffer 3 rapid nuke requests in a single frame and step 4 fixed ticks -> 3 concurrent staggered warheads!
    const launchEvs = [
      ...sim.tickFrame(1 / 60, { dragDeltaX: 0, keyAxisX: 0, nukeStrike: true }),
      ...sim.tickFrame(1 / 60, { dragDeltaX: 0, keyAxisX: 0, nukeStrike: true }),
      ...sim.tickFrame(1 / 60, { dragDeltaX: 0, keyAxisX: 0, nukeStrike: true }),
    ].filter((e) => e.type === 'NUKE_LAUNCH');

    expect(launchEvs.length).toBe(3);
    expect(launchEvs.map((e) => e.salvoIndex)).toEqual([1, 2, 3]);
    // Staggered carpet-bombing coordinates across the highway
    const uniqueZ = new Set(launchEvs.map((e) => e.z));
    expect(uniqueZ.size).toBe(3);

    const midSnap = sim.getSnapshot();
    expect(midSnap.nukeStrikes?.length).toBe(3);
    expect(midSnap.nukeStocks).toBe(0);

    // Tapping a 4th time at 0 stocks triggers Orbital Thruster Overdrive (accelerates descent!)
    const preBoostDrop = midSnap.nukeDropTimer ?? 0;
    sim.tickFrame(1 / 60, { dragDeltaX: 0, keyAxisX: 0, nukeStrike: true });
    expect(sim.getSnapshot().nukeDropTimer ?? 0).toBeLessThan(preBoostDrop - 0.3);

    // Step through detonation and verify Aegis [E] can still fire immediately despite Nuke's thermal shield
    for (let i = 0; i < 60; i++) {
      sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0 });
    }
    const aegisEvs = sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0, aegisPulse: true });
    expect(aegisEvs.some((e) => e.type === 'AEGIS_PULSE')).toBe(true);
    expect(sim.getSnapshot().aegisCooldown).toBeLessThanOrEqual(5.5);

    const verify = verifyDeterministicReplay(sim.exportReplayLog());
    expect(verify.matched).toBe(true);
  });

  it('populates abundant Mag-Lev Jump Pads across Sectors 1-4 & Blitz and triggers Meteor Sky-Slam shockwave + barrel ignition on touchdown', async () => {
    const { SECTORS, getSectorScript } = await import('../../src/config/sectors');
    const { generateBlitzScript } = await import('../../src/config/blitz');
    const { spawnBarrel } = await import('../../src/sim/barrels');
    const { spawnJumpPad } = await import('../../src/sim/competition');

    expect(SECTORS[1].encounters.filter((e) => e.type === 'jump_pad').length).toBeGreaterThanOrEqual(5);
    expect(SECTORS[2].encounters.filter((e) => e.type === 'jump_pad').length).toBeGreaterThanOrEqual(5);
    expect(SECTORS[3].encounters.filter((e) => e.type === 'jump_pad').length).toBeGreaterThanOrEqual(6);
    expect(getSectorScript(4, 42).encounters.filter((e) => e.type === 'jump_pad').length).toBeGreaterThanOrEqual(4);
    expect(generateBlitzScript(3).encounters.filter((e) => e.type === 'jump_pad').length).toBeGreaterThanOrEqual(3);

    const world = createSimWorld();
    resetSimWorldForSector(world, 1, { bonusSquad: 12, damageMult: 1.5, manualOverdrive: true });
    world.enemyPool.releaseAll(world.enemies);

    const { PLAYER_Z } = await import('../../src/config/constants');
    // Place a Jump Pad right ahead of PLAYER_Z
    spawnJumpPad(world, 0, PLAYER_Z - 1.5, 14);
    let launched = false;
    for (let i = 0; i < 15; i++) {
      const evs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
      if (evs.some((e) => e.type === 'JUMP_LAUNCH')) {
        launched = true;
        break;
      }
    }
    expect(launched).toBe(true);

    // Mid-flight: place monsters + a Surge Barrel at the touchdown zone and step to JUMP_SLAM!
    let peakAirY = 0;
    let slamHits = -1;
    let barrelBoom = false;
    let planted = false;
    for (let i = 0; i < 95; i++) {
      if (world.squadAirY > peakAirY) peakAirY = world.squadAirY;
      if (!planted && world.jumpTimer > 0 && world.jumpTimer <= 0.05) {
        planted = true;
        for (let k = 0; k < 4; k++) {
          spawnEnemy(world, 'crawler', (k - 1.5) * 1.1, PLAYER_Z - 0.8, { hp: 80 });
        }
        spawnBarrel(world, 1.8, PLAYER_Z - 0.6, 0);
      }
      const evs = stepWorldFixed(world, { dragDeltaX: 0, keyAxisX: 0 });
      if (evs.some((e) => e.type === 'BARREL_EXPLODE')) barrelBoom = true;
      const slam = evs.find((e) => e.type === 'JUMP_SLAM');
      if (slam && slam.type === 'JUMP_SLAM') {
        slamHits = slam.hits;
        break;
      }
    }
    expect(peakAirY).toBeGreaterThan(3.0);
    expect(slamHits).toBeGreaterThanOrEqual(4);
    expect(barrelBoom).toBe(true);
    expect(world.aegisTimer).toBeGreaterThan(0.2);
  });

  it('supports stackable 3-stock Sky-Vault Jump Skill ([W]/↑) with mid-air double/triple boosts, 7.6m-12.8m altitude, >65m leap distance, and 0-drift replay', async () => {
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    const input = new InputController(stage);
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp' }));
      expect(input.consumeSkyJump()).toBe(true);
      expect(input.consumeSkyJump()).toBe(true);
      expect(input.consumeSkyJump()).toBe(false);
    } finally {
      input.destroy();
      stage.remove();
    }

    const { SECTORS } = await import('../../src/config/sectors');
    const sim = createSimulation();
    sim.startSector(4, { endless: true, layoutSeed: 202611, bonusSquad: 16, damageMult: 1.5, manualOverdrive: true });
    expect(sim.getSnapshot().jumpStocks).toBe(3);
    expect(sim.getSnapshot().jumpMaxStocks).toBe(3);

    const startDist = sim.getSnapshot().endless?.distance ?? 0;

    // Stage 1 Sky-Vault launch!
    const ev1 = sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0, skyJump: true });
    const launch1 = ev1.find((e) => e.type === 'JUMP_LAUNCH');
    expect(launch1 && launch1.type === 'JUMP_LAUNCH' ? launch1.skillStage : 0).toBe(1);
    expect(sim.getSnapshot().jumpStocks).toBe(2);

    let peakStage1Y = 0;
    for (let i = 0; i < 36; i++) {
      sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0 });
      peakStage1Y = Math.max(peakStage1Y, sim.getSnapshot().squadAirY ?? 0);
    }
    expect(peakStage1Y).toBeGreaterThan(6.2);

    // Mid-air Stage 2 booster chain!
    const ev2 = sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0, skyJump: true });
    const launch2 = ev2.find((e) => e.type === 'JUMP_LAUNCH');
    expect(launch2 && launch2.type === 'JUMP_LAUNCH' ? launch2.skillStage : 0).toBe(2);
    expect(sim.getSnapshot().jumpStocks).toBe(1);

    // Mid-air Stage 3 apex stratospheric chain!
    for (let i = 0; i < 18; i++) sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0 });
    const ev3 = sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0, skyJump: true });
    const launch3 = ev3.find((e) => e.type === 'JUMP_LAUNCH');
    expect(launch3 && launch3.type === 'JUMP_LAUNCH' ? launch3.skillStage : 0).toBe(3);
    expect(sim.getSnapshot().jumpStocks).toBe(0);

    let peakStage3Y = 0;
    let slamSkillStage = 0;
    let slamRadius = 0;
    for (let i = 0; i < 160; i++) {
      const evs = sim.stepFixed({ dragDeltaX: 0, keyAxisX: 0 });
      peakStage3Y = Math.max(peakStage3Y, sim.getSnapshot().squadAirY ?? 0);
      const sl = evs.find((e) => e.type === 'JUMP_SLAM');
      if (sl && sl.type === 'JUMP_SLAM') {
        slamSkillStage = sl.skillStage ?? 0;
        slamRadius = sl.radius ?? 0;
        break;
      }
    }

    const endDist = sim.getSnapshot().endless?.distance ?? 0;
    expect(peakStage3Y).toBeGreaterThan(12.2);
    expect(endDist - startDist).toBeGreaterThan(75);
    expect(slamSkillStage).toBe(3);
    expect(slamRadius).toBeGreaterThanOrEqual(19);
    // Passive recharge already refilled some stock/charge during the multi-stage flight!
    expect((sim.getSnapshot().jumpStocks ?? 0) + (sim.getSnapshot().jumpCharge ?? 0)).toBeGreaterThan(0.4);
    void SECTORS;

    const verify = verifyDeterministicReplay(sim.exportReplayLog());
    expect(verify.matched).toBe(true);
  });
});
