import { describe, expect, it } from 'vitest';
import { BARREL_CHAIN_TRIGGER_RADIUS, TRACK_HALF_WIDTH } from '../../src/config/constants';
import { SECTORS, type GateSpecConfig } from '../../src/config/sectors';
import {
  applyGateOperation,
  clampSquadX,
  computeGatePolarity,
  createSimulation,
  type GateSnapshot,
  type SectorId,
  type SimSnapshot,
} from '../../src/sim/index';

function isLanePositiveOrMutable(spec: GateSpecConfig | undefined): boolean {
  if (!spec) return false;
  if (spec.mutable) return true;
  return computeGatePolarity(spec.op, spec.value) === 'positive';
}

function chooseHeuristicTargetX(snap: SimSnapshot): number {
  const playerZ = snap.playerZ;
  const r = snap.formationRadius;

  // 1. Boss Arena Tactical Controller (uses ONLY public SimSnapshot telemetry!)
  if (snap.boss && snap.boss.active) {
    const boss = snap.boss;
    const candidates = [
      -3.35, -3.1, -2.6, -2.0, -1.3, -0.6, 0.0, 0.6, 1.3, 2.0, 2.6, 3.1, 3.35,
    ].map((cx) => clampSquadX(cx, r));

    let bestX = snap.squadX;
    let bestScore = -Infinity;

    for (const cx of candidates) {
      let score = 0;

      // Dodge active or telegraphing BossHazardZones
      for (const hz of boss.hazardZones) {
        if (hz.firing || hz.warningProgress >= 0.35) {
          const dangerSpan = hz.halfWidth + 0.45 * r + 0.28;
          if (Math.abs(cx - hz.x) <= dangerSpan) {
            score -= hz.firing ? 10_000 : 4_000 * hz.warningProgress;
          }
        }
      }

      // Dodge close hostile orbs
      for (const p of snap.projectiles) {
        if (p.hostile && p.z > playerZ - 8.5 && p.z < playerZ + 0.6) {
          if (Math.abs(cx - p.x) <= r + 0.58) {
            score -= 2_500;
          }
        }
      }

      // Dodge close arena enemies when possible
      for (const e of snap.enemies) {
        if (e.z > playerZ - 5.5 && e.z < playerZ + 0.4) {
          if (Math.abs(cx - e.x) <= r + e.radius + 0.2) {
            score -= 1_200;
          }
        }
      }

      // Handle Warden-01 Phase 2 standalone Emergency Gate
      for (const g of snap.gates) {
        if (!g.triggered && !g.dimmed) {
          if (g.z > playerZ - 4.0) {
            const overlaps = Math.abs(cx - g.x) <= g.halfWidth + 0.35 * r;
            if (g.polarity === 'positive' && overlaps) score += 900;
            if (g.polarity === 'negative' && overlaps) score -= 3_000;
          } else if (g.mutable && g.value < 8) {
            score -= Math.abs(cx - g.x) * 35;
          }
        }
      }

      // Priority 1 offense: detonate Phase 3 Arena Surge Barrels!
      const liveBarrel = snap.barrels.find((b) => !b.detonated && b.z < playerZ - 1.5);
      const alivePylons = boss.pylons.filter((p) => !p.destroyed);

      if (liveBarrel) {
        score -= Math.abs(cx - liveBarrel.x) * 80;
      } else if (alivePylons.length > 0) {
        // Priority 2 offense: break Omega-Zero Phase 1 Shield Pylons
        const targetPylon = alivePylons[0]!;
        score -= Math.abs(cx - targetPylon.x) * 75;
      } else if (boss.secondaryCore) {
        // Priority 3 offense: target whichever Hydra-02 core is unshielded (1.5x weakpoint!)
        const aimX = !boss.shielded ? boss.x : boss.secondaryCore.x;
        score -= Math.abs(cx - aimX) * 65;
      } else {
        // Aim through Prism Lens if well-aligned with Boss core, else directly at Boss core
        const lens = snap.lenses[0];
        const aimX =
          lens && Math.abs(lens.x - boss.x) <= 1.8 ? (lens.x + boss.x) * 0.5 : boss.x;
        score -= Math.abs(cx - aimX) * 60;
      }

      // Slight stability preference to avoid jitter
      score -= Math.abs(cx - snap.squadX) * 4;

      if (score > bestScore) {
        bestScore = score;
        bestX = cx;
      }
    }

    return bestX;
  }

  // 2. Runway Tactical Controller
  // Group active untriggered gates by rowId, sorted by closest Z to playerZ
  const rowMap = new Map<number, GateSnapshot[]>();
  for (const g of snap.gates) {
    if (!g.triggered && !g.dimmed && g.z <= playerZ + 0.2) {
      const list = rowMap.get(g.rowId) ?? [];
      list.push(g);
      rowMap.set(g.rowId, list);
    }
  }
  const upcomingRows = [...rowMap.values()].sort((a, b) => b[0]!.z - a[0]!.z);

  // Immediate gate-crossing commitment when within 5.0 units of PLAYER_Z
  const imminentRow = upcomingRows.find((rg) => rg[0]!.z >= playerZ - 5.0);
  if (imminentRow) {
    if (imminentRow.length === 2) {
      const left = imminentRow.find((g) => g.x < 0)!;
      const right = imminentRow.find((g) => g.x >= 0)!;
      const afterLeft = applyGateOperation(snap.squadCount, left.op, left.value).after;
      const afterRight = applyGateOperation(snap.squadCount, right.op, right.value).after;
      return afterLeft >= afterRight ? -2.3 : 2.3;
    } else {
      const single = imminentRow[0]!;
      if (single.polarity === 'positive') {
        return single.x;
      }
      return single.x >= 0 ? -2.3 : 2.3;
    }
  }

  // Mid-range aiming: prioritize Siphons, Surge Barrels, Mutable Gates needing flip, and Overclock Vaults
  const siphon = snap.enemies.find(
    (e) => e.kind === 'siphon' && e.z > playerZ - 48 && e.z < playerZ - 3,
  );
  if (siphon) {
    return siphon.x;
  }

  const barrel = snap.barrels.find(
    (b) => !b.detonated && b.z > playerZ - 42 && b.z < playerZ - 4,
  );
  if (barrel) {
    return barrel.x;
  }

  // Check if next gate row has a mutable gate worth shooting (especially negative/lock-flip)
  const nextRow = upcomingRows[0];
  if (nextRow && nextRow[0]!.z > playerZ - 38) {
    const urgentMutable = nextRow.find((g) => g.mutable && (g.polarity !== 'positive' || g.lockHp > 0));
    if (urgentMutable) {
      return urgentMutable.x;
    }
  }

  // Crack reachable Overclock Vaults
  const vault = snap.vaults.find((v) => !v.broken && v.z > playerZ - 44 && v.z < playerZ - 4);
  if (vault) {
    return vault.x;
  }

  if (nextRow) {
    const anyMutable = nextRow.find((g) => g.mutable);
    if (anyMutable) return anyMutable.x;
    if (nextRow.length === 2) {
      const left = nextRow.find((g) => g.x < 0)!;
      const right = nextRow.find((g) => g.x >= 0)!;
      const afterLeft = applyGateOperation(snap.squadCount, left.op, left.value).after;
      const afterRight = applyGateOperation(snap.squadCount, right.op, right.value).after;
      return afterLeft >= afterRight ? -2.2 : 2.2;
    }
  }

  return 0;
}

function chooseRecklessTargetX(snap: SimSnapshot): number {
  const playerZ = snap.playerZ;
  const badGate = snap.gates
    .filter((g) => !g.triggered && !g.dimmed && g.polarity === 'negative' && g.z <= playerZ)
    .sort((a, b) => b.z - a.z)[0];
  if (badGate) return badGate.x;

  const enemy = snap.enemies.filter((e) => e.z <= playerZ).sort((a, b) => b.z - a.z)[0];
  if (enemy) return enemy.x;

  return 2.4;
}

describe('3 Handcrafted Sectors Structural Audit & Full Campaign Balance Proof', () => {
  it('audits SECTORS[1..3] for distinct parameters, ascending crossDist, non-uniform pacing, survivable gate rows, standalone gates, and barrel connectivity', () => {
    const s1 = SECTORS[1];
    const s2 = SECTORS[2];
    const s3 = SECTORS[3];

    // Distinct speeds, lengths, starting squads, and Boss IDs
    expect(s1.scrollSpeed).toBeLessThan(s2.scrollSpeed);
    expect(s2.scrollSpeed).toBeLessThan(s3.scrollSpeed);
    expect(s1.runwayLength).toBeLessThan(s2.runwayLength);
    expect(s2.runwayLength).toBeLessThan(s3.runwayLength);
    expect(new Set([s1.boss.id, s2.boss.id, s3.boss.id]).size).toBe(3);

    for (const sectorId of [1, 2, 3] as const) {
      const cfg = SECTORS[sectorId];
      expect(cfg.encounters.length).toBeGreaterThanOrEqual(28);

      let prevDist = -Infinity;
      const gateDists: number[] = [];
      let standaloneCount = 0;

      for (const enc of cfg.encounters) {
        expect(enc.crossDist).toBeGreaterThanOrEqual(prevDist);
        expect(enc.crossDist).toBeLessThan(cfg.runwayLength - 20);
        prevDist = enc.crossDist;

        if (enc.type === 'gate_row') {
          gateDists.push(enc.crossDist);
          if (enc.layout === 'paired') {
            // Every paired row must have >= 1 positive or shootable-to-positive lane (zero dead ends)
            expect(
              isLanePositiveOrMutable(enc.left) || isLanePositiveOrMutable(enc.right),
            ).toBe(true);
          } else {
            standaloneCount += 1;
            expect(enc.single).toBeDefined();
            const hw = enc.single!.halfWidth ?? 2.3;
            const leftOpen = enc.single!.x - hw - -TRACK_HALF_WIDTH;
            const rightOpen = TRACK_HALF_WIDTH - (enc.single!.x + hw);
            // Must leave a wide >= 4.5u dodgeable bypass corridor on at least one side
            expect(Math.max(leftOpen, rightOpen)).toBeGreaterThanOrEqual(4.5);
          }
        }

        if (enc.type === 'barrels' && enc.placements.length > 1) {
          // Every barrel in a multi-barrel cluster must connect within BARREL_CHAIN_TRIGGER_RADIUS (5.2u)
          for (let i = 0; i < enc.placements.length; i++) {
            const p = enc.placements[i]!;
            let minNeighborDist = Infinity;
            for (let j = 0; j < enc.placements.length; j++) {
              if (i === j) continue;
              const q = enc.placements[j]!;
              const d = Math.hypot(p.x - q.x, (p.dz ?? 0) - (q.dz ?? 0));
              if (d < minNeighborDist) minNeighborDist = d;
            }
            expect(minNeighborDist).toBeLessThanOrEqual(BARREL_CHAIN_TRIGGER_RADIUS);
          }
        }
      }

      // Every sector runway includes at least one dodgeable standalone gate
      expect(standaloneCount).toBeGreaterThanOrEqual(1);

      // Non-uniform authored gate spacing (REQ-018: >= 75% distinct intervals)
      const intervals: number[] = [];
      for (let i = 1; i < gateDists.length; i++) {
        intervals.push(gateDists[i]! - gateDists[i - 1]!);
      }
      expect(new Set(intervals).size / intervals.length).toBeGreaterThanOrEqual(0.75);
    }
  });

  it.each([1, 2, 3] as const)('checks boss phases, victory and idle/reckless defeats in sector %i', (sector) => {
    // 1. Heuristic Bot -> VICTORY traversing 100% of Boss phases
    const winSim = createSimulation();
    winSim.startSector(sector);
    let maxBossPhase = 0;
    let steps = 0;

    while (winSim.getSnapshot().phase === 'PLAYING' && steps < 9000) {
      const snap = winSim.getSnapshot();
      if (snap.boss && snap.boss.active && snap.boss.phase > maxBossPhase) {
        maxBossPhase = snap.boss.phase;
      }
      const targetX = chooseHeuristicTargetX(snap);
      const drag = Math.max(-0.32, Math.min(0.32, targetX - snap.squadX));
      winSim.stepFixed({ dragDeltaX: drag, keyAxisX: 0 });
      steps += 1;
    }

    const winSnap = winSim.getSnapshot();
    expect(winSnap.phase).toBe('VICTORY');
    expect(winSnap.defeatReason).toBeNull();
    expect(winSnap.squadCount).toBeGreaterThan(0);
    expect(maxBossPhase).toBe(SECTORS[sector].boss.maxPhases);
    expect(winSnap.simTime).toBeGreaterThanOrEqual(65);
    expect(winSnap.simTime).toBeLessThanOrEqual(115);
    expect(winSnap.stats.vaultsCracked).toBeGreaterThanOrEqual(2);
    expect(winSnap.stats.gatesImproved).toBeGreaterThanOrEqual(1);
    expect(winSnap.stats.kills).toBeGreaterThanOrEqual(10);

    // 2. Pure AFK Bot (x = 0, zero input) -> DEFEAT
    const afkSim = createSimulation();
    afkSim.startSector(sector);
    let afkSteps = 0;
    while (afkSim.getSnapshot().phase === 'PLAYING' && afkSteps < 9000) {
      afkSim.stepFixed({ dragDeltaX: 0, keyAxisX: 0 });
      afkSteps += 1;
    }
    const afkSnap = afkSim.getSnapshot();
    expect(afkSnap.phase).toBe('DEFEAT');
    expect(afkSnap.squadCount).toBe(0);
    expect(afkSnap.defeatReason).toBe('NEGATIVE_GATE');

    // Sector 1 onboarding check ([POLISH-S1-ONBOARD]): AFK center auto-fire kills lead crawler at t~4s and survives to Act 2's d=228 gate
    if (sector === 1) {
      expect(afkSnap.stats.kills).toBeGreaterThanOrEqual(1);
      expect(afkSnap.simTime).toBeGreaterThan(12.0);
    }

    // 3. Reckless Negative-Gate Bot -> DEFEAT
    const recklessSim = createSimulation();
    recklessSim.startSector(sector);
    let recklessSteps = 0;
    while (recklessSim.getSnapshot().phase === 'PLAYING' && recklessSteps < 9000) {
      const snap = recklessSim.getSnapshot();
      const targetX = chooseRecklessTargetX(snap);
      const drag = Math.max(-0.35, Math.min(0.35, targetX - snap.squadX));
      recklessSim.stepFixed({ dragDeltaX: drag, keyAxisX: 0 });
      recklessSteps += 1;
    }
    const recklessSnap = recklessSim.getSnapshot();
    expect(recklessSnap.phase).toBe('DEFEAT');
    expect(recklessSnap.squadCount).toBe(0);
    expect(recklessSnap.defeatReason).not.toBeNull();
  });
});
