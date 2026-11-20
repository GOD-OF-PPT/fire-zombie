import { damageNemesis, registerTriPrismRefraction } from './v23Mechanics';
import { ENEMY_CONFIGS } from '../config/enemies';
import { getWeaponCounterMult } from '../config/weapons';
import {
  chargeCapacitorTower,
  hasChip,
  registerOmegaReflectorHitOnBoss,
  spawnCoreShard,
  triggerV20OverlimitHitEvolution,
} from './v20Mechanics';
import {
  damageHighSpire,
  damagePantheonCoBoss,
  damageRunawayCart,
} from './v21Mechanics';
import { hasSynergy } from '../config/protocols';
import { rollDeterministicCrit } from './aegis';
import type { SimEvent } from '../types/game';
import { applyBarrelBlastToBoss, damageBossCore, damageBossPylon } from './bosses';
import { damageBarrel } from './barrels';
import { intersectSweptSegmentAABB } from './ccd';
import { damageEnemy } from './enemies';
import type { SimProjectile, SimWorld } from './entities';
import { applyProjectileHitToGate } from './gates';
import {
  bounceProjectileAtReflector,
  damageBossPart,
  damageSkyCargo,
  hasFusion,
  hitDoomOrbWithDamage,
  recordDamage,
  spawnOrRefreshSingularity,
  triggerRicochetWeb,
} from './competition';
import { damageVault, refractProjectileAtLens } from './weapons';

type CandidateTargetKind =
  | 'lens'
  | 'reflector'
  | 'cap_tower'
  | 'high_spire'
  | 'runaway_cart'
  | 'pantheon_coboss'
  | 'doom_orb'
  | 'sky_cargo'
  | 'enemy'
  | 'gate'
  | 'vault'
  | 'barrel'
  | 'boss_part'
  | 'boss_pylon'
  | 'boss_core'
  | 'boss_secondary'
  | 'nemesis';

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
  if (proj.weapon === 'plasma' && hasFusion(world, 'cryo_singularity')) {
    spawnOrRefreshSingularity(world, hitX, hitZ, events);
  }
  if (proj.weapon === 'plasma' && world.activeDualSynergy === 'cluster_shrapnel') {
    let shrapHits = 0;
    const shrapDmg = splashDamage * 0.62;
    for (let i = 0; i < world.enemies.length && shrapHits < 4; i++) {
      const e = world.enemies[i];
      if (!e || !e.active || e.consumed || e.bypassed || e.hp <= 0 || e.id === directTargetId) continue;
      const d = Math.hypot(e.x - hitX, e.z - hitZ);
      if (d > splashR * 0.5 && d <= splashR * 1.75 + e.radius) {
        shrapHits += 1;
        events.push({
          type: 'CHAIN_ARC',
          fromX: hitX,
          fromZ: hitZ,
          toX: e.x,
          toZ: e.z,
          damage: Math.max(1, Math.round(shrapDmg)),
          webColor: 0xffae42,
        });
        recordDamage(world, 'fusions', Math.min(e.hp, shrapDmg));
        damageEnemy(world, e, shrapDmg, 0, events, { bypassShield: true });
      }
    }
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
      const sDmg = splashDamage * getWeaponCounterMult(proj.weapon, enemy.kind);
      recordDamage(world, proj.weapon, Math.min(enemy.hp, sDmg));
      damageEnemy(world, enemy, sDmg, proj.cryoSlowDuration, events, { bypassShield: true, weapon: proj.weapon });
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
          recordDamage(world, proj.weapon, Math.min(pylon.hp, splashDamage));
          damageBossPylon(world, pylon, splashDamage, events);
        }
      }
    }
    if (boss.hp > 0 && !boss.shielded && boss.entityId !== directTargetId) {
      if (Math.hypot(boss.x - hitX, boss.z - hitZ) <= splashR + boss.halfWidth) {
        recordDamage(world, proj.weapon, Math.min(boss.hp, splashDamage));
        registerOmegaReflectorHitOnBoss(world, proj, events);
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
        recordDamage(world, proj.weapon, Math.min(boss.hp, splashDamage * 1.5));
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

  // 1b. 45° Angled Holographic Reflector Mirrors
  for (let i = 0; i < world.reflectors.length; i++) {
    const ref = world.reflectors[i];
    if (!ref || !ref.active || proj.hitIds.has(ref.id)) continue;
    const hit = intersectSweptSegmentAABB(
      proj.prevX,
      proj.prevZ,
      proj.x,
      proj.z,
      proj.radius,
      interpStart(ref.prevX, ref.x, startFrac),
      interpStart(ref.prevZ, ref.z, startFrac),
      ref.x,
      ref.z,
      ref.halfWidth,
      ref.halfDepth,
    );
    if (hit !== null) {
      candidates.push({
        kind: 'reflector',
        targetId: ref.id,
        index: i,
        tEnter: hit.tEnter,
        hitX: hit.hitX,
        hitZ: hit.hitZ,
      });
    }
  }

  // 1a2. Elevated Prism Sniper Spires (`HighSpire`) & Runaway Core Carts & Pantheon Co-Boss
  for (let i = 0; i < world.highSpires.length; i++) {
    const sp = world.highSpires[i];
    if (!sp || !sp.active || sp.destroyed || proj.hitIds.has(sp.id)) continue;
    const hit = intersectSweptSegmentAABB(
      proj.prevX, proj.prevZ, proj.x, proj.z, proj.radius,
      interpStart(sp.prevX, sp.x, startFrac), interpStart(sp.prevZ, sp.z, startFrac),
      sp.x, sp.z, sp.radius, sp.radius,
    );
    if (hit !== null) {
      candidates.push({ kind: 'high_spire', targetId: sp.id, index: i, tEnter: hit.tEnter, hitX: hit.hitX, hitZ: hit.hitZ });
    }
  }
  for (let i = 0; i < world.tacticalEvents.length; i++) {
    const tev = world.tacticalEvents[i];
    if (!tev || !tev.active || tev.completed || tev.kind !== 'runaway_cart' || proj.hitIds.has(tev.id)) continue;
    const hit = intersectSweptSegmentAABB(
      proj.prevX, proj.prevZ, proj.x, proj.z, proj.radius,
      interpStart(tev.prevX, tev.x, startFrac), interpStart(tev.prevZ, tev.z, startFrac),
      tev.x, tev.z, tev.radius, tev.radius,
    );
    if (hit !== null) {
      candidates.push({ kind: 'runaway_cart', targetId: tev.id, index: i, tEnter: hit.tEnter, hitX: hit.hitX, hitZ: hit.hitZ });
    }
  }
  if (world.pantheonCoBoss && world.pantheonCoBoss.active && world.pantheonCoBoss.hp > 0 && !proj.hitIds.has(world.pantheonCoBoss.entityId)) {
    const co = world.pantheonCoBoss;
    const hit = intersectSweptSegmentAABB(
      proj.prevX, proj.prevZ, proj.x, proj.z, proj.radius,
      interpStart(co.prevX, co.x, startFrac), interpStart(co.prevZ, co.z, startFrac),
      co.x, co.z, co.halfWidth, co.halfDepth,
    );
    if (hit !== null) {
      candidates.push({ kind: 'pantheon_coboss', targetId: co.entityId, index: 0, tEnter: hit.tEnter, hitX: hit.hitX, hitZ: hit.hitZ });
    }
  }

  // 1b1. Shootable Overload Capacitor Towers
  for (let i = 0; i < world.capTowers.length; i++) {
    const cap = world.capTowers[i];
    if (!cap || !cap.active || cap.discharged || proj.hitIds.has(cap.id)) continue;
    const hit = intersectSweptSegmentAABB(
      proj.prevX,
      proj.prevZ,
      proj.x,
      proj.z,
      proj.radius,
      interpStart(cap.prevX, cap.x, startFrac),
      interpStart(cap.prevZ, cap.z, startFrac),
      cap.x,
      cap.z,
      cap.radius,
      cap.radius,
    );
    if (hit !== null) {
      candidates.push({
        kind: 'cap_tower',
        targetId: cap.id,
        index: i,
        tEnter: hit.tEnter,
        hitX: hit.hitX,
        hitZ: hit.hitZ,
      });
    }
  }

  // 1b2. Shootable Overhead Sky-Drop Plasma Cargo Clamps
  for (let i = 0; i < world.skyCargos.length; i++) {
    const cargo = world.skyCargos[i];
    if (!cargo || !cargo.active || cargo.state !== 'hanging' || proj.hitIds.has(cargo.id)) continue;
    const hit = intersectSweptSegmentAABB(
      proj.prevX,
      proj.prevZ,
      proj.x,
      proj.z,
      proj.radius,
      interpStart(cargo.prevX, cargo.x, startFrac),
      interpStart(cargo.prevZ, cargo.z, startFrac),
      cargo.x,
      cargo.z,
      cargo.halfWidth,
      cargo.halfDepth,
    );
    if (hit !== null) {
      candidates.push({
        kind: 'sky_cargo',
        targetId: cargo.id,
        index: i,
        tEnter: hit.tEnter,
        hitX: hit.hitX,
        hitZ: hit.hitZ,
      });
    }
  }

  // 1c. Polarity-Flip Deflectable Doom-Orbs
  for (let i = 0; i < world.doomOrbs.length; i++) {
    const orb = world.doomOrbs[i];
    if (!orb || !orb.active || orb.reflected || proj.hitIds.has(orb.id)) continue;
    const hit = intersectSweptSegmentAABB(
      proj.prevX,
      proj.prevZ,
      proj.x,
      proj.z,
      proj.radius,
      interpStart(orb.prevX, orb.x, startFrac),
      interpStart(orb.prevZ, orb.z, startFrac),
      orb.x,
      orb.z,
      orb.radius,
      orb.radius,
    );
    if (hit !== null) {
      candidates.push({
        kind: 'doom_orb',
        targetId: orb.id,
        index: i,
        tEnter: hit.tEnter,
        hitX: hit.hitX,
        hitZ: hit.hitZ,
      });
    }
  }

  // 2. Malware Enemies — scalar swept-AABB broadphase rejects 98%+ of horizon-queued enemies in 2 comparisons!
  const pRad = proj.radius;
  const pMinZ = (proj.prevZ < proj.z ? proj.prevZ : proj.z) - pRad;
  const pMaxZ = (proj.prevZ > proj.z ? proj.prevZ : proj.z) + pRad;
  const pMinX = (proj.prevX < proj.x ? proj.prevX : proj.x) - pRad;
  const pMaxX = (proj.prevX > proj.x ? proj.prevX : proj.x) + pRad;

  for (let i = 0; i < world.enemies.length; i++) {
    const enemy = world.enemies[i];
    if (!enemy || !enemy.active || enemy.consumed || enemy.bypassed || enemy.hp <= 0) {
      continue;
    }
    const er = enemy.radius;
    const eMinZ = (enemy.prevZ < enemy.z ? enemy.prevZ : enemy.z) - er;
    if (pMaxZ < eMinZ) continue;
    const eMaxZ = (enemy.prevZ > enemy.z ? enemy.prevZ : enemy.z) + er;
    if (pMinZ > eMaxZ) continue;
    const eMinX = (enemy.prevX < enemy.x ? enemy.prevX : enemy.x) - er;
    if (pMaxX < eMinX) continue;
    const eMaxX = (enemy.prevX > enemy.x ? enemy.prevX : enemy.x) + er;
    if (pMinX > eMaxX) continue;
    if (proj.hitIds.has(enemy.id)) continue;

    const hit = intersectSweptSegmentAABB(
      proj.prevX,
      proj.prevZ,
      proj.x,
      proj.z,
      pRad,
      interpStart(enemy.prevX, enemy.x, startFrac),
      interpStart(enemy.prevZ, enemy.z, startFrac),
      enemy.x,
      enemy.z,
      er,
      er,
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

  // 6. Boss Destructible Shoulder Parts, Shield Pylons & Core(s)
  const boss = world.boss;
  if (boss && boss.active && boss.hp > 0) {
    if (boss.introProgress >= 1) {
      for (let i = 0; i < boss.parts.length; i++) {
        const pt = boss.parts[i];
        if (!pt || pt.destroyed || pt.hp <= 0 || proj.hitIds.has(pt.id)) continue;
        const hit = intersectSweptSegmentAABB(
          proj.prevX,
          proj.prevZ,
          proj.x,
          proj.z,
          proj.radius,
          interpStart(pt.prevX, pt.x, startFrac),
          interpStart(pt.prevZ, pt.z, startFrac),
          pt.x,
          pt.z,
          pt.halfWidth,
          pt.halfDepth,
        );
        if (hit !== null) {
          candidates.push({
            kind: 'boss_part',
            targetId: pt.id,
            index: i,
            tEnter: hit.tEnter,
            hitX: hit.hitX,
            hitZ: hit.hitZ,
          });
        }
      }
    }
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

  const nem = world.nemesis;
  if (nem && nem.active && nem.hp > 0 && !proj.hitIds.has(nem.id)) {
    const hit = intersectSweptSegmentAABB(
      proj.prevX,
      proj.prevZ,
      proj.x,
      proj.z,
      proj.radius,
      nem.x,
      nem.z,
      nem.x,
      nem.z,
      1.35,
      1.35,
    );
    if (hit !== null) {
      candidates.push({
        kind: 'nemesis',
        targetId: nem.id,
        index: 0,
        tEnter: hit.tEnter,
        hitX: hit.hitX,
        hitZ: hit.hitZ,
      });
    }
  }

  candidates.sort((a, b) => (a.tEnter !== b.tEnter ? a.tEnter - b.tEnter : a.targetId - b.targetId));
}

/**
 * Step 5: Resolves relative-velocity swept collisions for all friendly projectiles,
 * ordered strictly by earliest tEnter in [0, 1].
 */
export function resolveFriendlyProjectileCollisions(world: SimWorld, events: SimEvent[]): void {
  world.ricochetsThisTick = 0;
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

        if (cand.kind === 'reflector') {
          const ref = world.reflectors[cand.index];
          if (!ref || !ref.active) continue;
          bounceProjectileAtReflector(world, proj, ref, cand.hitX, cand.hitZ, events);
      if (ref.isWingmanMirror) {
        world.wingmanMirrorBounces = (world.wingmanMirrorBounces ?? 0) + 1;
        proj.damage *= 1.18;
        proj.hitWingmanMirror = true;
        registerTriPrismRefraction(world, true, events);
      } else {
        proj.hitFixedMirror = true;
        registerTriPrismRefraction(world, false, events);
      }
      if (proj.hitWingmanMirror && proj.hitFixedMirror) {
        proj.damage *= 1.25;
      }
          refractedThisPass = true;
          break;
        }

        let solidHitApplied = false;
        let preservePierceOnOverkill = false;

        if (cand.kind === 'high_spire') {
          const sp = world.highSpires[cand.index];
          if (sp && sp.active && !sp.destroyed) {
            proj.hitIds.add(cand.targetId);
            const highStrike = proj.amplified || proj.weapon === 'plasma' || world.squadAirY > 0.55;
            damageHighSpire(world, sp, proj.damage, highStrike, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'runaway_cart') {
          const tev = world.tacticalEvents[cand.index];
          if (tev && tev.active && !tev.completed) {
            proj.hitIds.add(cand.targetId);
            damageRunawayCart(world, tev, proj.damage, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'pantheon_coboss') {
          const co = world.pantheonCoBoss;
          if (co && co.active && co.hp > 0) {
            proj.hitIds.add(cand.targetId);
            const isCrit = rollDeterministicCrit(world);
            const cDmg = proj.damage * (isCrit ? 1.75 : 1.0);
            recordDamage(world, proj.weapon, Math.min(co.hp, cDmg));
            damagePantheonCoBoss(world, cDmg, events);
            if (proj.splashRadius > 0) {
              applyPlasmaSplash(world, proj, co.entityId, cand.hitX, cand.hitZ, events);
            }
            solidHitApplied = true;
          }
        } else if (cand.kind === 'cap_tower') {
          const cap = world.capTowers[cand.index];
          if (cap && cap.active && !cap.discharged) {
            proj.hitIds.add(cand.targetId);
            chargeCapacitorTower(world, cap, proj.damage, proj.amplified, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'sky_cargo') {
          const cargo = world.skyCargos[cand.index];
          if (cargo && cargo.active && cargo.state === 'hanging') {
            proj.hitIds.add(cand.targetId);
            damageSkyCargo(world, cargo, proj.damage, events);
            // Overhead gantry clamp sits above ground lanes, so shots keep flying into enemies/gates behind!
            preservePierceOnOverkill = true;
            solidHitApplied = true;
          }
        } else if (cand.kind === 'doom_orb') {
          const orb = world.doomOrbs[cand.index];
          if (orb && orb.active && !orb.reflected) {
            proj.hitIds.add(cand.targetId);
            hitDoomOrbWithDamage(world, orb, proj.damage, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'boss_part') {
          const boss = world.boss;
          const pt = boss?.parts[cand.index];
          if (boss && boss.active && boss.hp > 0 && pt && !pt.destroyed && pt.hp > 0) {
            proj.hitIds.add(cand.targetId);
            const isCrit = rollDeterministicCrit(world);
            const shatterSpec =
              (1 + Math.max(0, world.mods.specShatter ?? 0) * 0.14) *
              (hasChip(world, 'chip_exec_protocol') ? 1.25 : 1.0) *
              (world.overlimitResonance === 'glacial_rail_skewer' ? 1.65 : 1.0);
            const pDmg = proj.damage * (isCrit ? 1.75 : 1.0) * shatterSpec;
            registerOmegaReflectorHitOnBoss(world, proj, events);
            if (isCrit) events.push({ type: 'CRIT_HIT', x: cand.hitX, z: cand.hitZ, damage: Math.max(1, Math.round(pDmg)) });
            recordDamage(world, proj.weapon, Math.min(pt.hp, pDmg));
            if (proj.amplified) { world.v23RefractedDmg = (world.v23RefractedDmg ?? 0) + pDmg; }
            damageBossPart(world, pt, pDmg, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'enemy') {
          const enemy = world.enemies[cand.index];
          if (enemy && enemy.active && !enemy.consumed && !enemy.bypassed && enemy.hp > 0) {
            proj.hitIds.add(cand.targetId);
            const preHp = enemy.hp;
            const isFodder = enemy.isSwarmFodder;
            const isCrit = rollDeterministicCrit(world);
            const eliteShatterBonus =
              (enemy.maxShieldHp > 0 || enemy.slowTimer > 0 || enemy.armorBroken)
                ? 1 + Math.max(0, world.mods.specShatter ?? 0) * 0.14
                : 1.0;
            const dmg = proj.damage * getWeaponCounterMult(proj.weapon, enemy.kind) * (isCrit ? 1.75 : 1.0) * eliteShatterBonus;
            if (isCrit) events.push({ type: 'CRIT_HIT', x: cand.hitX, z: cand.hitZ, damage: Math.max(1, Math.round(dmg)) });
            recordDamage(world, proj.weapon, Math.min(preHp, dmg));
            const bypassShield = proj.weapon === 'rail' || proj.amplified || proj.remainingPierce >= 2;
            const wasChilledOrCracked = enemy.slowTimer > 0 || enemy.armorBroken;
            if (proj.amplified) { world.v23RefractedDmg = (world.v23RefractedDmg ?? 0) + Math.min(preHp, dmg); }
            const killed = damageEnemy(world, enemy, dmg, proj.cryoSlowDuration, events, { bypassShield, weapon: proj.weapon, reflected: proj.hitFixedMirror === true, impactX: cand.hitX });
            if (killed && ENEMY_CONFIGS[enemy.kind].tier >= 3) {
              spawnCoreShard(world, cand.hitX, cand.hitZ, ENEMY_CONFIGS[enemy.kind].tier === 4 ? 2 : 1);
            }
            triggerV20OverlimitHitEvolution(
              world,
              proj,
              enemy,
              dmg,
              killed,
              wasChilledOrCracked,
              cand.hitX,
              cand.hitZ,
              events,
            );
            if (world.overlimitResonance === 'cryo_thermo_shatter' && (wasChilledOrCracked || proj.weapon === 'cryo') && world.ricochetsThisTick < 4) {
              world.ricochetsThisTick += 1;
              const shatterBlast = dmg * 0.55;
              for (let k = 0; k < world.enemies.length; k++) {
                const nb = world.enemies[k];
                if (!nb || !nb.active || nb.consumed || nb.bypassed || nb.hp <= 0 || nb.id === cand.targetId) continue;
                if (Math.hypot(nb.x - cand.hitX, nb.z - cand.hitZ) <= 2.6 + nb.radius) {
                  if (nb.shieldHp > 0) nb.shieldHp = Math.max(0, nb.shieldHp - nb.maxShieldHp * 0.35);
                  recordDamage(world, 'fusions', Math.min(nb.hp, shatterBlast));
                  damageEnemy(world, nb, shatterBlast, 1.1, events, { bypassShield: true });
                }
              }
            } else if (world.overlimitResonance === 'gravity_lens_well') {
              world.overlimitTickCounter = (world.overlimitTickCounter + 1) % 8;
              if (world.overlimitTickCounter === 0) {
                spawnOrRefreshSingularity(world, cand.hitX, cand.hitZ, events, 3.2, 1.6);
              }
            }
            if (isFodder) {
              const objectiveBehind =
                world.gates.some((g) => g.active && g.mutable && !g.triggered && !g.dimmed && g.z < enemy.z + 2 && Math.abs(g.x - enemy.x) <= 2.2) ||
                world.vaults.some((v) => v.active && !v.broken && v.z < enemy.z + 2 && Math.abs(v.x - enemy.x) <= 1.8) ||
                world.enemies.some((s) => s.active && s.kind === 'siphon' && Math.abs(s.x - enemy.x) <= 1.8);
              const maxPunches = objectiveBehind ? 5 : (killed && dmg >= preHp * 1.15 ? 1 : 0);
              if (proj.fodderPunches < maxPunches) {
                proj.fodderPunches += 1;
                preservePierceOnOverkill = true;
              }
            }
            if (
              (proj.weapon === 'scatter' || proj.weapon === 'rail') &&
              hasFusion(world, 'prism_ricochet_web')
            ) {
              triggerRicochetWeb(world, enemy, dmg, events);
            } else if (world.activeDualSynergy && world.ricochetsThisTick < 5) {
              const syn = world.activeDualSynergy;
              if (syn === 'frost_shatter_lance' && (enemy.slowTimer > 0 || proj.weapon === 'cryo')) {
                world.ricochetsThisTick += 1;
                const lanceDmg = dmg * 0.42;
                for (let k = 0; k < world.enemies.length; k++) {
                  const nb = world.enemies[k];
                  if (!nb || !nb.active || nb.consumed || nb.bypassed || nb.hp <= 0) continue;
                  if (Math.hypot(nb.x - cand.hitX, nb.z - cand.hitZ) <= 2.3 + nb.radius) {
                    recordDamage(world, 'fusions', Math.min(nb.hp, lanceDmg));
                    damageEnemy(world, nb, lanceDmg, 1.2, events, { bypassShield: true });
                  }
                }
              } else if (syn === 'thermo_rail_lance' && proj.weapon === 'rail') {
                world.ricochetsThisTick += 1;
                const burnDmg = dmg * 0.36;
                for (let k = 0; k < world.enemies.length; k++) {
                  const nb = world.enemies[k];
                  if (!nb || !nb.active || nb.consumed || nb.bypassed || nb.hp <= 0 || nb.id === cand.targetId) continue;
                  if (Math.hypot(nb.x - cand.hitX, nb.z - cand.hitZ) <= 2.2 + nb.radius) {
                    recordDamage(world, 'fusions', Math.min(nb.hp, burnDmg));
                    damageEnemy(world, nb, burnDmg, 0, events, { bypassShield: true });
                  }
                }
              } else if (syn === 'overcharge_rail_grid' && proj.weapon === 'rail') {
                world.ricochetsThisTick += 1;
                const arcDmg = dmg * 0.48;
                for (let k = 0; k < world.enemies.length; k++) {
                  const nb = world.enemies[k];
                  if (!nb || !nb.active || nb.consumed || nb.bypassed || nb.hp <= 0 || nb.id === cand.targetId) continue;
                  if (Math.hypot(nb.x - cand.hitX, nb.z - cand.hitZ) <= 3.8 + nb.radius) {
                    events.push({
                      type: 'CHAIN_ARC',
                      fromX: cand.hitX,
                      fromZ: cand.hitZ,
                      toX: nb.x,
                      toZ: nb.z,
                      damage: Math.max(1, Math.round(arcDmg)),
                      webColor: 0xc69cff,
                    });
                    recordDamage(world, 'fusions', Math.min(nb.hp, arcDmg));
                    damageEnemy(world, nb, arcDmg, 0, events, { bypassShield: true });
                    break;
                  }
                }
              }
            }
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
            const offLaneScatterGraze = !proj.amplified && Math.abs(proj.vx) > 3.2 && Math.abs(vault.x - world.squadX) > 2.45 ? 0.32 : 1.0;
            damageVault(world, vault, proj.damage * offLaneScatterGraze, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'barrel') {
          const barrel = world.barrels[cand.index];
          if (barrel && barrel.active && !barrel.detonated && barrel.hp > 0) {
            proj.hitIds.add(cand.targetId);
            if (proj.amplified) { world.v23RefractedDmg = (world.v23RefractedDmg ?? 0) + proj.damage * 1.8; }
            damageBarrel(world, barrel, proj.damage, events, applyBarrelBlastToBoss, proj.amplified);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'boss_pylon') {
          const boss = world.boss;
          const pylon = boss?.pylons[cand.index];
          if (boss && boss.active && boss.hp > 0 && pylon && !pylon.destroyed && pylon.hp > 0) {
            proj.hitIds.add(cand.targetId);
            const isCrit = rollDeterministicCrit(world);
            const bossMult = (isCrit ? 1.75 : 1.0) * (hasSynergy(world.endless?.upgrades, 'hyper_annihilation') ? 1.2 : 1.0);
            if (isCrit) events.push({ type: 'CRIT_HIT', x: cand.hitX, z: cand.hitZ, damage: Math.max(1, Math.round(proj.damage * bossMult)) });
            const pDmg = proj.damage * bossMult * (1 + Math.max(0, world.mods.specShatter ?? 0) * 0.14);
            recordDamage(world, proj.weapon, Math.min(pylon.hp, pDmg));
            events.push({ type: 'BOSS_HIT', x: cand.hitX, z: cand.hitZ, damage: Math.max(1, Math.round(pDmg)), weapon: proj.weapon });
            damageBossPylon(world, pylon, pDmg, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'boss_core') {
          const boss = world.boss;
          if (boss && boss.active && boss.hp > 0) {
            proj.hitIds.add(cand.targetId);
            const isCrit = rollDeterministicCrit(world);
            const bossMult = (isCrit ? 1.75 : 1.0) * (hasSynergy(world.endless?.upgrades, 'hyper_annihilation') ? 1.2 : 1.0);
            if (isCrit) events.push({ type: 'CRIT_HIT', x: cand.hitX, z: cand.hitZ, damage: Math.max(1, Math.round(proj.damage * bossMult)) });
            const cDmg = proj.damage * bossMult;
            if (!boss.shielded) {
              recordDamage(world, proj.weapon, Math.min(boss.hp, cDmg));
              events.push({ type: 'BOSS_HIT', x: cand.hitX, z: cand.hitZ, damage: Math.max(1, Math.round(cDmg)), weapon: proj.weapon });
            }
            const effCoreDmg =
        world.bossHarmonicShield && world.boss?.parts?.some((p) => !p.destroyed)
          ? proj.amplified
            ? cDmg * 1.85
            : cDmg * 0.32
          : cDmg;
      if (proj.amplified) { world.v23RefractedDmg = (world.v23RefractedDmg ?? 0) + effCoreDmg; }
      damageBossCore(world, false, effCoreDmg, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'boss_secondary') {
          const boss = world.boss;
          if (boss && boss.active && boss.hp > 0 && boss.secondaryCore) {
            proj.hitIds.add(cand.targetId);
            const isCrit = rollDeterministicCrit(world);
            const bossMult = (isCrit ? 1.75 : 1.0) * (hasSynergy(world.endless?.upgrades, 'hyper_annihilation') ? 1.2 : 1.0);
            if (isCrit) events.push({ type: 'CRIT_HIT', x: cand.hitX, z: cand.hitZ, damage: Math.max(1, Math.round(proj.damage * bossMult)) });
            const sDmg = proj.damage * bossMult;
            if (!boss.secondaryCore.shielded) {
              recordDamage(world, proj.weapon, Math.min(boss.hp, sDmg * 1.5));
              events.push({ type: 'BOSS_HIT', x: cand.hitX, z: cand.hitZ, damage: Math.max(1, Math.round(sDmg * 1.5)) });
            }
            damageBossCore(world, true, sDmg, events);
            solidHitApplied = true;
          }
        } else if (cand.kind === 'nemesis') {
          const nem = world.nemesis;
          if (nem && nem.active && nem.hp > 0) {
            proj.hitIds.add(cand.targetId);
            const isCrit = rollDeterministicCrit(world);
            const nDmg = proj.damage * (isCrit ? 1.65 : 1.0);
            if (proj.amplified) {
              world.v23RefractedDmg = (world.v23RefractedDmg ?? 0) + nDmg;
            }
            recordDamage(world, proj.weapon, Math.min(nem.hp, nDmg));
            damageNemesis(world, nDmg, proj.weapon, proj.amplified, events);
            solidHitApplied = true;
          }
        }

        if (solidHitApplied) {
          if (proj.splashRadius > 0) {
            applyPlasmaSplash(world, proj, cand.targetId, cand.hitX, cand.hitZ, events);
          }
          if (!preservePierceOnOverkill) {
            proj.remainingPierce -= 1;
          }
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
