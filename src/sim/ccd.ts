export interface SweepHitResult {
  tEnter: number;
  hitX: number;
  hitZ: number;
}

const PARALLEL_EPS = 1e-12;

/**
 * Relative-velocity Liang-Barsky continuous collision detection of a moving
 * circle B (radius r) from (bPrevX, bPrevZ) -> (bX, bZ) against a moving
 * axis-aligned bounding box T (halfW x halfD) from (tPrevX, tPrevZ) -> (tX, tZ).
 */
export function intersectSweptSegmentAABB(
  bPrevX: number,
  bPrevZ: number,
  bX: number,
  bZ: number,
  r: number,
  tPrevX: number,
  tPrevZ: number,
  tX: number,
  tZ: number,
  halfW: number,
  halfD: number,
): SweepHitResult | null {
  const x0 = bPrevX - tPrevX;
  const z0 = bPrevZ - tPrevZ;
  const dx = bX - tX - x0;
  const dz = bZ - tZ - z0;

  const ex = Math.max(0, halfW) + Math.max(0, r);
  const ez = Math.max(0, halfD) + Math.max(0, r);

  let tEnter = 0;
  let tExit = 1;

  for (let i = 0; i < 4; i++) {
    const p = i === 0 ? -dx : i === 1 ? dx : i === 2 ? -dz : dz;
    const q = i === 0 ? x0 + ex : i === 1 ? ex - x0 : i === 2 ? z0 + ez : ez - z0;

    if (Math.abs(p) <= PARALLEL_EPS) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > tExit) return null;
        if (t > tEnter) tEnter = t;
      } else {
        if (t < tEnter) return null;
        if (t < tExit) tExit = t;
      }
    }
  }

  if (tEnter > tExit) return null;
  const clampedT = tEnter <= 0 ? 0 : tEnter > 1 ? 1 : tEnter;
  return {
    tEnter: clampedT,
    hitX: bPrevX + clampedT * (bX - bPrevX),
    hitZ: bPrevZ + clampedT * (bZ - bPrevZ),
  };
}

export const sweepCircleVsMovingAABB = intersectSweptSegmentAABB;
