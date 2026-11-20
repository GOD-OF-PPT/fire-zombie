import { describe, expect, it } from 'vitest';
import { chooseHeuristicTargetX } from '../../src/app/autopilot';
import { buildSimSnapshot, createSimWorld, resetSimWorldForSector, stepWorldFixed } from '../../src/sim/world';
import type { SimEvent } from '../../src/types/game';

/** Use the actual track, projectile collisions and player movement for both mirrored layouts. */
function playDrill(seed: number, route: 'cutback' | 'vault-only' | 'supply-only') {
  const world = createSimWorld();
  resetSimWorldForSector(world, 4, { blitz: true, layoutSeed: seed, manualOverdrive: true });
  const events: SimEvent[] = [];
  const cues = new Set<string>();
  let sentryId: number | undefined;
  for (let tick = 0; tick < 27 * 60; tick++) {
    const snap = buildSimSnapshot(world);
    const cue = snap.drillCue;
    if (cue) cues.add(cue.action);
    let target = chooseHeuristicTargetX(snap);
    if (world.cutback && world.scrollDistance > 240) {
      if (route === 'vault-only') target = world.cutback.vaultX;
      if (route === 'supply-only') target = -world.cutback.vaultX;
    }
    sentryId ??= world.enemies.find(e => e.anchoredGuard)?.id;
    events.push(...stepWorldFixed(world, {
      dragDeltaX: Math.max(-0.32, Math.min(0.32, target - snap.squadX)), keyAxisX: 0, overdrive: true,
    }));
  }
  return { world, events, sentryId, cues };
}

describe('linked Blitz encounters', () => {
  it.each([3, 4])('rewards the reflected shield break, cross-lane pickup and real landing hits (seed %i)', seed => {
    const { world, events, sentryId, cues } = playDrill(seed, 'cutback');
    expect([...cues]).toEqual(['mirror', 'vault', 'switch', 'pad']);
    expect(events.some(e => e.type === 'SHIELD_BREAK' && e.enemyId === sentryId && e.reflected)).toBe(true);
    expect(events.filter(e => e.type === 'CUTBACK_COMPLETE')).toHaveLength(1);
    expect(events.some(e => e.type === 'JUMP_SLAM' && e.hits >= 3)).toBe(true);
    expect(world.cutback).toBeUndefined();
    expect(world.landingAmbushX).toBeUndefined();
  });

  it.each(['vault-only', 'supply-only'] as const)('does not award both for staying on the %s route', route => {
    const { events } = playDrill(3, route);
    expect(events.some(e => e.type === 'CUTBACK_COMPLETE')).toBe(false);
    if (route === 'supply-only') expect(events.some(e => e.type === 'GATE_PASS' && e.delta === 16)).toBe(true);
  });
});
