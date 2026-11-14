import type { SimEvent } from '../types/game';
import { applyBarrelBlastToBoss, damageBossCore, damageBossPylon } from './bosses';
import { damageBarrel } from './barrels';
import { intersectSweptSegmentAABB } from './ccd';
import { damageEnemy } from './enemies';
import type { SimProjectile, SimWorld } from './entities';
import { applyProjectileHitToGate } from './gates';
import { damageVault, refractProjectileAtLens } from './weapons';

type CandidateTargetKind =
  | 'lens'
  | 'enemy'
  | 'gate'
  | 'vault'
  | 'barrel'
  | 'boss_pylon'
  | 'boss_core'
  | 'boss_secondary';

interface SweepCandidate {
  kind: CandidateTargetKind;
  targetId: number;
  index: number;
  tEnter: number;
  hitX: number;
  hitZ: number;
}

function interpStart(prev: number, curr: number, startFrac: number): number {
  return startFrac <= 0 ? prev : prev + (curr - prev) * startFrac;
}

function applyPlasmaSplash(
  world: SimWorld,
  proj: SimProjectile,
  directTargetId: number,
  hitX: number,
  hitZ: number,
  events: SimEvent[],
): void {
  const splashR = proj.splashRadius;
  const splashDamage = proj.damage * proj.splashDamageRatio;
  if (splashR <= 0 || splashDamage <= 0) {
    return;
  }

  const enemyCount = world.enemies.length;
  for (let i = 0; i < enemyCount; i++) {
    const enemy = world.enemies[i];
    if (
      !enemy ||
      !enemy.active ||
      enemy.consumed ||
      enemy.bypassed ||
      enemy.hp <= 0 ||
      enemy.id === directTargetId
    ) {
      continue;
    }
    if (Math.hypot(enemy.x - hitX, enemy.z - hitZ) <= splashR + enemy.radius) {
      damageEnemy(world, enemy, splashDamage, proj.cryoSlowDuration, events);
    }
  }

  for (let i = 0; i < world.vaults.length; i++) {
    const vault = world.vaults[i];
    if (!vault || !vault.active || vault.broken || vault.id === directTargetId) {
      continue;
    }
    if (Math.hypot(vault.x - hitX, vault.z - hitZ) <= splashR + vault.halfWidth) {
      damageVault(world, vault, splashDamage, events);
    }
  }

  for (let i = 0; i < world.barrels.length; i++) {
    const barrel = world.barrels[i];
    if (!barrel || !barrel.active || barrel.detonated || barrel.id === directTargetId) {
      continue;
    }
    if (Math.hypot(barrel.x - hitX, barrel.z - hitZ) <= splashR + barrel.radius) {
      damageBarrel(world, barrel, splashDamage, events, applyBarrelBlastToBoss);
    }
  }

  const boss = world.boss;
  if (boss && boss.active && boss.hp > 0) {
    for (let i = 0; i < boss.pylons.length; i++) {
      const pylon = boss.pylons[i];
      if (pylon && !pylon.destroyed && pylon.id !== directTargetId) {
        if (Math.hypot(pylon.x - hitX, pylon.z - hitZ) <= splashR + pylon.halfWidth) {
          damageBossPylon(world, pylon, splashDamage, events);
        }
      }
    }
    if (boss.hp > 0 && !boss.shielded && boss.entityId !== directTargetId) {
      if (Math.hypot(boss.x - hitX, boss.z - hitZ) <= splashR + boss.halfWidth) {
        damageBossCore(world, false, splashDamage, events);
      }
    }
    if (
      boss.hp > 0 &&
      boss.secondaryCore &&
      !boss.secondaryCore.shielded &&
      boss.secondaryEntityId !== directTargetId
    ) {
      const sec = boss.secondaryCore;
      if (Math.hypot(sec.x - hitX, sec.z - hitZ) <= splashR + sec.halfWidth) {
        damageBossCore(world, true, splashDamage, events);
      }
    }
  }
}

function gatherCandidatesForProjectile(
  world: SimWorld,
  proj: SimProjectile,
  candidates: SweepCandidate[],
): void {
  candidates.length = 0;
  const startFrac = proj.sweepStartFraction;

  // 1. Golden Prism Lenses (only un-amplified friendly bolts)
  if (!proj.amplified) {
    for (let i = 0; i < world.lenses.length; i++) {
      const lens = world.lenses[i];
      if (!lens || !lens.active || proj.hitIds.has(lens.id)) continue;
      const hit = intersectSweptSegmentAABB(
        proj.prevX,
        proj.prevZ,
        proj.x,
        proj.z,
        proj.radius,
        interpStart(lens.prevX, lens.x, startFrac),
        interpStart(lens.prevZ, lens.z, startFrac),
        lens.x,
        lens.z,
        lens.halfWidth,
        lens.halfDepth,
      );
      if (hit !== null) {
        candidates.push({
          kind: 'lens',
          targetId: lens.id,
          index: i,
          tEnter: hit.tEnter,
          hitX: hit.hitX,
          hitZ: hit.hitZ,
        });
      }
    }
  }

  // 2. Malware Enemies
  for (let i = 0; i < world.enemies.length; i++) {
    const enemy = world.enemies[i];
    if (
      !enemy ||
      !enemy.active ||
      enemy.consumed ||
      enemy.bypassed ||
      enemy.hp <= 0 ||
      proj.hitIds.has(enemy.id)
    ) {
      continue;
    }
    const hit = intersectSweptSegmentAABB(
      proj.prevX,
      proj.prevZ,
      proj.x,
      proj.z,
      proj.radius,
      interpStart(enemy.prevX, enemy.x, startFrac),
      interpStart(enemy.prevZ, enemy.z, startFrac),
      enemy.x,
      enemy.z,
      enemy.radius,
      enemy.radius,
    );
    if (hit !== null) {
      candidates.push({
        kind: 'enemy',
        targetId: enemy.id,
        index: i,
        tEnter: hit.tEnter,
        hitX: hit.hitX,
        hitZ: hit.hitZ,
      });
    }
  }

  // 3. Shootable Gates ONLY (mutable === false gates let bullets pass straight through!)
  for (let i = 0; i < world.gates.length; i++) {
    const gate = world.gates[i];
    if (
      !gate ||
      !gate.active ||
      !gate.mutable ||
      gate.triggered ||
      gate.dimmed ||
      proj.hitIds.has(gate.id)
    ) {
      continue;
    }
    const hit = intersectSweptSegmentAABB(
      proj.prevX,
      proj.prevZ,
      proj.x,
      proj.z,
      proj.radius,
      interpStart(gate.prevX, gate.x, startFrac),
      interpStart(gate.prevZ, gate.z, startFrac),
      gate.x,
      gate.z,
      gate.halfWidth,
      gate.halfDepth,
    );
    if (hit !== null) {
      candidates.push({
        kind: 'gate',
        targetId: gate.id,
        index: i,
        tEnter: hit.tEnter,
        hitX: hit.hitX,
        hitZ: hit.hitZ,
      });
    }
  }

  // 4. Destructible Overclock Vaults
  for (let i = 0; i < world.vaults.length; i++) {
    const vault = world.vaults[i];
    if (!vault || !vault.active || vault.broken || vault.hp <= 0 || proj.hitIds.has(vault.id)) {
      continue;
    }
    const hit = intersectSweptSegmentAABB(
      proj.prevX,
      proj.prevZ,
      proj.x,
      proj.z,
      proj.radius,
      interpStart(vault.prevX, vault.x, startFrac),
      interpStart(vault.prevZ, vault.z, startFrac),
      vault.x,
      vault.z,
      vault.halfWidth,
      vault.halfDepth,
    );
    if (hit !== null) {
      candidates.push({
        kind: 'vault',
        targetId: vault.id,
        index: i,
        tEnter: hit.tEnter,
        hitX: hit.hitX,
        hitZ: hit.hitZ,
      });
    }
  }

  // 5. Surge Barrels
  for (let i = 0; i < world.barrels.length; i++) {
    const barrel = world.barrels[i];
    if (
      !barrel ||
      !barrel.active ||
      barrel.detonated ||
      barrel.hp <= 0 ||
      proj.hitIds.has(barrel.id)
    ) {
      continue;
    }
    const hit = intersectSweptSegmentAABB(
      proj.prevX,
      proj.prevZ,
      proj.x,
      proj.z,
      proj.radius,
      interpStart(barrel.prevX, barrel.x, startFrac),
      interpStart(barrel.prevZ, barrel.z, startFrac),
      barrel.x,
      barrel.z,
      barrel.radius,
      barrel.radius,
    );
    if (hit !== null) {
      candidates.push({
        kind: 'barrel',
        targetId: barrel.id,
        index: i,
        tEnter: hit.tEnter,
        hitX: hit.hitX,
        hitZ: hit.hitZ,
      });
    }
  }

  // 6. Boss Shield Pylons & Core(s)
  const boss = world.boss;
  if (boss && boss.active && boss.hp > 0) {
    for (let i = 0; i < boss.pylons.length; i++) {
      const pylon = boss.pylons[i];
      if (!pylon || pylon.destroyed || pylon.hp <= 0 || proj.hitIds.has(pylon.id)) {
        continue;
      }
      const hit = intersectSweptSegmentAABB(
        proj.prevX,
        proj.prevZ,
        proj.x,
        proj.z,
        proj.radius,
        interpStart(pylon.prevX, pylon.x, startFrac),
        interpStart(pylon.prevZ, pylon.z, startFrac),
        pylon.x,
        pylon.z,
        pylon.halfWidth,
        pylon.halfDepth,
      );
      if (hit !== null) {
        candidates.push({
          kind: 'boss_pylon',
          targetId: pylon.id,
          index: i,
          tEnter: hit.tEnter,
          hitX: hit.hitX,
          hitZ: hit.hitZ,
        });
      }
    }

    if (!proj.hitIds.has(boss.entityId)) {
      const hit = intersectSweptSegmentAABB(
        proj.prevX,
        proj.prevZ,
        proj.x,
        proj.z,
        proj.radius,
        interpStart(boss.prevX, boss.x, startFrac),
        interpStart(boss.prevZ, boss.z, startFrac),
        boss.x,
        boss.z,
        boss.halfWidth,
        boss.halfDepth,
      );
      if (hit !== null) {
        candidates.push({
          kind: 'boss_core',
          targetId: boss.entityId,
          index: 0,
          tEnter: hit.tEnter,
          hitX: hit.hitX,
          hitZ: hit.hitZ,
        });
      }
    }

    if (boss.secondaryCore && !proj.hitIds.has(boss.secondaryEntityId)) {
      const sec = boss.secondaryCore;
      const hit = intersectSweptSegmentAABB(
        proj.prevX,
        proj.prevZ,
        proj.x,
        proj.z,
        proj.radius,
        interpStart(sec.prevX, sec.x, startFrac),
        interpStart(sec.prevZ, sec.z, startFrac),
        sec.x,
        sec.z,
        sec.halfWidth,
        sec.halfDepth,
      );
      if (hit !== null) {
        candidates.push({
          kind: 'boss_secondary',
          targetId: boss.secondaryEntityId,
          index: 0,
          tEnter: hit.tEnter,
          hitX: hit.hitX,
          hitZ: hit.hitZ,
        });
      }
    }
  }

  candidates.sort((a, b) => (a.tEnter !== b.tEnter ? a.tEnter - b.tEnter : a.targetId - b.targetId));
}

/**
 * Step 5: Resolves relative-velocity swept collisions for all friendly projectiles,
 * ordered strictly by earliest tEnter in [0, 1].
 */
export function resolveFriendlyProjectileCollisions(world: SimWorld, events: SimEvent[]): void {
  const candidates: SweepCandidate[] = [];

  for (let pIdx = 0; pIdx < world.projectiles.length; pIdx++) {
    const proj = world.projectiles[pIdx];
    if (!proj || !proj.active || proj.hostile) {
      continue;
    }

    // Allow at most 1 post-refraction rescan for the deflected primary bolt
    for (let scanPass = 0; scanPass < 2 && proj.active; scanPass++) {
      gatherCandidatesForProjectile(world, proj, candidates);
      let refractedThisPass = false;

      for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
        const cand = candidates[cIdx];
        if (!cand || !proj.active || proj.hitIds.has(cand.targetId)) {
          continue;
        }

        if (cand.kind === 'lens') {
          const lens = world.lenses[cand.index];
          if (!lens || !lens.active || proj.amplified) {
            continue;
          }
          const combinedFrac =
            proj.sweepStartFraction + (1 - proj.sweepStartFraction) * cand.tEnter;
          refractProjectileAtLens(world, proj, lens, cand.hitX, cand.hitZ, combinedFrac, events);
          refractedThisPass = true;
          break;
        }

        let solidHitApplied = false;

        if (cand.kind === 'enemy') {
          const enemy = world.enemies[cand.index];
          if (enemy && enemy.active && !enemy.consumed && !enemy.bypassed && enemy.hp > 0) {
            proj.hitIds.add(cand.targetId);
            damageEnemy(world, enemy, proj.damage, proj.cryoSlowDuration, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'gate') {
          const gate = world.gates[cand.index];
          if (gate && gate.active && gate.mutable && !gate.triggered && !gate.dimmed) {
            proj.hitIds.add(cand.targetId);
            applyProjectileHitToGate(world, gate, proj.damage, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'vault') {
          const vault = world.vaults[cand.index];
          if (vault && vault.active && !vault.broken && vault.hp > 0) {
            proj.hitIds.add(cand.targetId);
            damageVault(world, vault, proj.damage, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'barrel') {
          const barrel = world.barrels[cand.index];
          if (barrel && barrel.active && !barrel.detonated && barrel.hp > 0) {
            proj.hitIds.add(cand.targetId);
            damageBarrel(world, barrel, proj.damage, events, applyBarrelBlastToBoss);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'boss_pylon') {
          const boss = world.boss;
          const pylon = boss?.pylons[cand.index];
          if (boss && boss.active && boss.hp > 0 && pylon && !pylon.destroyed && pylon.hp > 0) {
            proj.hitIds.add(cand.targetId);
            damageBossPylon(world, pylon, proj.damage, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'boss_core') {
          const boss = world.boss;
          if (boss && boss.active && boss.hp > 0) {
            proj.hitIds.add(cand.targetId);
            damageBossCore(world, false, proj.damage, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'boss_secondary') {
          const boss = world.boss;
          if (boss && boss.active && boss.hp > 0 && boss.secondaryCore) {
            proj.hitIds.add(cand.targetId);
            damageBossCore(world, true, proj.damage, events);
            solidHitApplied = true;
          }
        }

        if (solidHitApplied) {
          if (proj.splashRadius > 0) {
            applyPlasmaSplash(world, proj, cand.targetId, cand.hitX, cand.hitZ, events);
          }
          proj.remainingPierce -= 1;
          if (proj.remainingPierce < 0) {
            proj.x = cand.hitX;
            proj.z = cand.hitZ;
            proj.active = false;
            break;
          }
        }
      }

      if (!refractedThisPass) {
        break;
      }
    }
  }
}
