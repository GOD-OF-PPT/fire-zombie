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
    expect((sim.getSnapshot().nirvanaActiveTimer ?? 0)).toBeGreaterThan(2.0);

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
  });
});
