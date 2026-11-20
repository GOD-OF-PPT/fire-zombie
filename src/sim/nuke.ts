import { FIXED_DT, PLAYER_Z } from '../config/constants';
import type { SimEvent } from '../types/game';
import { detonateBarrel } from './barrels';
import { checkBossPhaseTransitions, damageBossCore, damageBossPylon } from './bosses';
import { damageBossPart, recordDamage } from './competition';
import type { SimWorld } from './entities';
import { applyFlatDeltaToGate, findGateById } from './gates';
import { clamp } from './math';

export const NUKE_DROP_DURATION = 1.75;
export const NUKE_BLAST_DURATION = 3.25;
export const NUKE_TARGET_Z = -19.5;
/** ~46s base passive cooldown (+ 5.05s drop & blast thermal lockout = ~45-50s strategic ultimate!) */
export const NUKE_COOLDOWN_SEC = 46.0;
export const NUKE_PASSIVE_CHARGE_PER_SEC = 1 / NUKE_COOLDOWN_SEC;
/** Modest combat assist: mowing down 150 monsters shaves ~4.5s off the 46s cooldown instead of instant-refilling */
export const NUKE_KILL_CHARGE = 0.00065;

const SIPHON_KILL_GATE_BONUS = 6;

function snapZero(v: number): number {
  return v <= 1e-9 ? 0 : v;
}

export function addNukeKillCharge(world: SimWorld, amount = NUKE_KILL_CHARGE): void {
  // Complete thermal recharge lockout during orbital drop AND entire mushroom-cloud aftermath!
  if (world.nukeDropTimer > 0 || world.isNukeDetonating || world.nukeBlastTimer > 0) return;
  world.nukeCharge = clamp(world.nukeCharge + amount, 0, 1);
}

/**
 * Launches a slowly descending Tactical Thermonuclear Warhead when `nukeCharge >= 1`.
 */
export function tryTriggerNukeStrike(world: SimWorld, events: SimEvent[]): boolean {
  if (world.squadCount <= 0) return false;
  if (world.nukeDropTimer > 1e-9 || world.nukeBlastTimer > 0.25 || world.nukeCharge < 0.999) {
    return false;
  }

  world.nukeCharge = 0;
  world.nukeDropTimer = NUKE_DROP_DURATION;
  world.nukeTargetX = clamp(world.squadX * 0.35, -1.8, 1.8);
  world.nukeTargetZ = world.boss && world.boss.active ? -16.0 : NUKE_TARGET_Z;

  events.push({
    type: 'NUKE_LAUNCH',
    x: world.nukeTargetX,
    z: world.nukeTargetZ,
    duration: NUKE_DROP_DURATION,
  });
  return true;
}

/**
 * Advances passive Nuke recharge (after post-blast thermal lockout), the 1.80s orbital lock-on descent,
 * and full-horizon thermonuclear detonation.
 */
export function stepNukeStrike(world: SimWorld, events: SimEvent[]): void {
  if (world.nukeBlastTimer > 0) {
    world.nukeBlastTimer = snapZero(world.nukeBlastTimer - FIXED_DT);
  }

  if (world.nukeDropTimer <= 0) {
    // Thermal cooldown lockout: reactor cannot begin recharging until the 3.25s nuclear fireball subsides
    if (world.nukeBlastTimer <= 0 && world.nukeCharge < 1) {
      const resonanceBoost = 1 + Math.max(0, world.mods.resonanceMult - 1) * 0.22;
      world.nukeCharge = clamp(
        world.nukeCharge + NUKE_PASSIVE_CHARGE_PER_SEC * resonanceBoost * FIXED_DT,
        0,
        1,
      );
    }
    return;
  }

  // While the giant warhead descends under orbital laser lock-on, monsters across the highway shudder & slow!
  for (let i = 0; i < world.enemies.length; i++) {
    const e = world.enemies[i];
    if (!e || !e.active || e.consumed || e.hp <= 0) continue;
    if (e.z >= -145 && e.z <= PLAYER_Z + 1) {
      e.slowTimer = Math.max(e.slowTimer, 0.25);
    }
  }

  world.nukeDropTimer = snapZero(world.nukeDropTimer - FIXED_DT);
  if (world.nukeDropTimer <= 0) {
    detonateTacticalNuke(world, events);
  }
}

function detonateTacticalNuke(world: SimWorld, events: SimEvent[]): void {
  world.nukeDropTimer = 0;
  world.nukeBlastTimer = NUKE_BLAST_DURATION;
  world.isNukeDetonating = true;

  // Extended thermal force-shield so nothing cheap-shots the squad during blinding nuclear shockwave
  world.aegisTimer = Math.max(world.aegisTimer, 1.65);

  const blastX = world.nukeTargetX;
  const blastZ = world.nukeTargetZ;
  let kills = 0;

  // 1. Hypersonic shockwave sweeps the ENTIRE 150u runway column to the horizon!
  const enemyLen = world.enemies.length;
  for (let i = 0; i < enemyLen; i++) {
    const enemy = world.enemies[i];
    if (!enemy || !enemy.active || enemy.consumed || enemy.hp <= 0) {
      continue;
    }
    if (enemy.z < -170 || enemy.z > PLAYER_Z + 6.0) {
      continue;
    }
    enemy.bypassed = false;

    const nukeDmg = Math.max(15, Math.ceil(enemy.hp * 1.25));
    enemy.hp = 0;
    enemy.shieldHp = 0;
    enemy.hitPulse = 1.0;
    enemy.consumed = true;
    enemy.active = false;
    world.stats.kills += 1;
    kills += 1;

    world.damageBySource.explosives += nukeDmg;

    if (enemy.kind === 'siphon' && enemy.linkedGateId !== null) {
      const linkedGate = findGateById(world, enemy.linkedGateId);
      if (linkedGate && !linkedGate.triggered && !linkedGate.dimmed && linkedGate.z < PLAYER_Z) {
        applyFlatDeltaToGate(world, linkedGate, SIPHON_KILL_GATE_BONUS, true, events);
      }
      enemy.linkedGateId = null;
    }

    events.push({
      type: 'ENEMY_HIT',
      x: enemy.x,
      z: enemy.z,
      fatal: true,
      kind: enemy.kind,
      damage: nukeDmg,
    });
  }

  world.rampageTimer = 3.8;
  world.rampageStacks = Math.min(60, world.rampageStacks + Math.min(40, kills));

  // 2. Incinerate all hostile projectiles & reflect any active Boss Doom-Orbs!
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    if (p && p.active && p.hostile) {
      world.projectilePool.release(p);
      world.projectiles.splice(i, 1);
    }
  }
  for (let i = 0; i < world.doomOrbs.length; i++) {
    const orb = world.doomOrbs[i];
    if (orb && orb.active && !orb.reflected) {
      orb.value = Math.max(10, Math.abs(orb.value));
      orb.reflected = true;
      orb.vz = -30;
      events.push({ type: 'DOOM_ORB_REFLECT', x: orb.x, z: orb.z });
    }
  }

  // 3. Detonate visible Surge Barrels & flip/supercharge Mutable Gates (+8, flipping negative gates positive!)
  for (let i = 0; i < world.barrels.length; i++) {
    const b = world.barrels[i];
    if (b && b.active && !b.detonated && b.z >= -95 && b.z <= PLAYER_Z) {
      detonateBarrel(world, b, 0, events, () => {});
    }
  }
  for (let i = 0; i < world.gates.length; i++) {
    const g = world.gates[i];
    if (
      g &&
      g.active &&
      g.mutable &&
      !g.isLockFlip &&
      !g.triggered &&
      !g.dimmed &&
      g.z >= -85 &&
      g.z < PLAYER_Z - 0.8
    ) {
      const boost = g.value < 0 ? Math.abs(g.value) + 6 : 8;
      applyFlatDeltaToGate(world, g, boost, true, events);
    }
  }

  // 4. Deal colossal thermonuclear armor-shredding strike to Boss parts, pylons & core!
  let bossDamage = 0;
  const boss = world.boss;
  if (boss && boss.active && boss.hp > 0) {
    for (let i = 0; i < boss.parts.length; i++) {
      const pt = boss.parts[i];
      if (pt && !pt.destroyed && pt.hp > 0) {
        const pDmg = Math.ceil(pt.maxHp * 0.65);
        recordDamage(world, 'explosives', Math.min(pt.hp, pDmg));
        damageBossPart(world, pt, pDmg, events);
      }
    }
    for (let i = 0; i < boss.pylons.length; i++) {
      const py = boss.pylons[i];
      if (py && !py.destroyed && py.hp > 0) {
        const pyDmg = Math.ceil(py.maxHp * 0.65);
        recordDamage(world, 'explosives', Math.min(py.hp, pyDmg));
        damageBossPylon(world, py, pyDmg, events);
      }
    }
    if (boss.hp > 0) {
      const rawNukeBoss = Math.round(boss.maxHp * 0.25 + 680 * world.mods.damageMult);
      const preHp = boss.hp;
      if (!boss.shielded) {
        damageBossCore(world, false, rawNukeBoss, events);
      } else if (boss.secondaryCore && !boss.secondaryCore.shielded) {
        damageBossCore(world, true, rawNukeBoss, events);
      } else {
        // Penetrating gamma-thermal radiation scorches 12% maxHp even through active shields!
        const scorch = Math.max(1, Math.round(boss.maxHp * 0.12));
        boss.hitPulse = 1.0;
        boss.hp = Math.max(0, boss.hp - scorch);
        events.push({ type: 'BOSS_HIT', x: boss.x, z: boss.z, damage: scorch });
        checkBossPhaseTransitions(world, events);
      }
      bossDamage = Math.max(0, Math.round(preHp - boss.hp));
      world.damageBySource.explosives += bossDamage;
    }
  }

  world.isNukeDetonating = false;

  events.push({
    type: 'NUKE_DETONATE',
    x: blastX,
    z: blastZ,
    kills,
    bossDamage,
  });
}
