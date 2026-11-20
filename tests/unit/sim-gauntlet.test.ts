import { describe, expect, it } from 'vitest';
import { BARREL_CHAIN_TRIGGER_RADIUS, TRACK_HALF_WIDTH } from '../../src/config/constants';
import { generateGauntlet } from '../../src/config/gauntlet';
import { SECTORS, getSectorScript, type GateSpecConfig } from '../../src/config/sectors';
import { chooseHeuristicTargetX } from '../../src/app/autopilot';
import { computeGatePolarity, createSimulation } from '../../src/sim/index';

function laneOk(spec: GateSpecConfig | undefined): boolean {
  if (!spec) return false;
  return spec.mutable || computeGatePolarity(spec.op, spec.value) === 'positive';
}

function runSector4(seed: number, policy: 'auto' | 'afk') {
  const sim = createSimulation();
  sim.startSector(4, { layoutSeed: seed });
  let steps = 0;
  while (sim.getSnapshot().phase === 'PLAYING' && steps < 14000) {
    const snap = sim.getSnapshot();
    const drag = policy === 'auto' ? Math.max(-0.32, Math.min(0.32, chooseHeuristicTargetX(snap) - snap.squadX)) : 0;
    sim.stepFixed({ dragDeltaX: drag, keyAxisX: 0 });
    steps++;
  }
  return sim.getSnapshot();
}

describe('Sector 4 Random Corridor generator', () => {
  it('is deterministic per seed and varies layouts and bosses across seeds', () => {
    expect(generateGauntlet(7)).toEqual(generateGauntlet(7));
    const layouts = new Set<string>();
    const bosses = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const g = generateGauntlet(seed);
      layouts.add(JSON.stringify(g.encounters));
      bosses.add(g.boss.id);
    }
    expect(layouts.size).toBe(12);
    expect(bosses.size).toBe(3);
  });

  it('keeps sectors 1-3 authored and caches sector 4 by seed', () => {
    expect(getSectorScript(2, 99)).toBe(SECTORS[2]);
    expect(getSectorScript(4, 0)).toBe(SECTORS[4]);
    const a = getSectorScript(4, 1234);
    expect(getSectorScript(4, 1234)).toBe(a);
    expect(a.encounters).toEqual(generateGauntlet(1234).encounters);
  });

  it('generates structurally valid runways for many seeds', () => {
    for (let seed = 0; seed < 60; seed++) {
      const cfg = getSectorScript(4, seed);
      expect(cfg.encounters.length).toBeGreaterThanOrEqual(28);
      let prev = -Infinity;
      let rows = 0;
      for (const enc of cfg.encounters) {
        expect(enc.crossDist).toBeGreaterThanOrEqual(prev);
        expect(enc.crossDist).toBeLessThan(cfg.runwayLength - 20);
        prev = enc.crossDist;
        if (enc.type === 'gate_row') {
          rows++;
          if (enc.layout === 'paired') {
            expect(laneOk(enc.left) || laneOk(enc.right)).toBe(true);
          } else {
            const hw = enc.single!.halfWidth ?? 2.3;
            const open = Math.max(enc.single!.x - hw + TRACK_HALF_WIDTH, TRACK_HALF_WIDTH - (enc.single!.x + hw));
            expect(open).toBeGreaterThanOrEqual(4.5);
          }
        }
        if (enc.type === 'barrels') {
          for (let i = 0; i < enc.placements.length; i++) {
            const p = enc.placements[i]!;
            let best = Infinity;
            enc.placements.forEach((q, j) => {
              if (j !== i) best = Math.min(best, Math.hypot(p.x - q.x, (p.dz ?? 0) - (q.dz ?? 0)));
            });
            expect(best).toBeLessThanOrEqual(BARREL_CHAIN_TRIGGER_RADIUS);
          }
        }
      }
      expect(rows).toBeGreaterThanOrEqual(14);
    }
  });

  it.each([1, 2, 3, 4, 5, 6])('allows a steered win and an idle defeat on seed %i', (seed) => {
    const win = runSector4(seed, 'auto');
    expect(win.phase).toBe('VICTORY');
    expect(win.simTime).toBeLessThanOrEqual(150);
    expect(runSector4(seed, 'afk').phase).toBe('DEFEAT');
  });
});
