import { clampSquadX, applyGateOperation } from '../sim/math';
import type { GateSnapshot, SimSnapshot } from '../types/game';

/** Heuristic autopilot (shared with balance tests) used for the title-screen attract mode and ?autoplay=1 verification. */
export function chooseHeuristicTargetX(snap: SimSnapshot): number {
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

