import { FIXED_DT, PLAYER_Z } from '../config/constants';
import type { SimEvent } from '../types/game';
import { detonateBarrel } from './barrels';
import { checkBossPhaseTransitions, damageBossCore, damageBossPylon } from './bosses';
import { damageBossPart, recordDamage } from './competition';
import { allocEntityId, type SimNukeStrike, type SimWorld } from './entities';
import { applyFlatDeltaToGate, findGateById } from './gates';
import { clamp } from './math';
import { damageNemesis } from './v23Mechanics';

export const NUKE_MAX_STOCKS = 3;
export const NUKE_DROP_DURATION = 1.15;
export const NUKE_BLAST_DURATION = 3.25;
export const NUKE_TARGET_Z = -19.5;
/** Fast ~7.5s orbital fabrication cooldown per warhead + rapid combat kill recharge for multi-salvo carpet bombing! */
export const NUKE_COOLDOWN_SEC = 7.5;
export const NUKE_PASSIVE_CHARGE_PER_SEC = 1 / NUKE_COOLDOWN_SEC;
/** High-tempo combat charge: slaughtering monsters rapidly refills multi-warhead stocks */
export const NUKE_KILL_CHARGE = 0.0085;
export const NUKE_MAX_CONCURRENT_SALVO = 6;

const SIPHON_KILL_GATE_BONUS = 6;

function snapZero(v: number): number {
  return v <= 1e-9 ? 0 : v;
}

export function syncLegacyNukeFields(world: SimWorld): void {
  let activeDrop = 0;
  let maxBlast = 0;
  let tx = world.nukeTargetX;
  let tz = world.nukeTargetZ;
  for (let i = 0; i < world.nukeSalvo.length; i++) {
    const s = world.nukeSalvo[i]!;
    if (s.dropTimer > activeDrop) {
      activeDrop = s.dropTimer;
      tx = s.x;
      tz = s.z;
    }
    if (s.blastTimer > maxBlast) {
      if (activeDrop <= 0) {
        tx = s.x;
        tz = s.z;
      }
      maxBlast = s.blastTimer;
    }
  }
  world.nukeDropTimer = activeDrop;
  world.nukeBlastTimer = maxBlast;
  world.nukeTargetX = tx;
  world.nukeTargetZ = tz;
}

export function grantNukeCharge(world: SimWorld, amount: number): void {
  if (amount <= 0 || world.isNukeDetonating) return;
  const maxStocks = Math.max(1, world.nukeMaxStocks || 1);
  if (world.nukeStocks >= maxStocks && world.nukeCharge >= 1) {
    world.nukeCharge = 1;
    return;
  }
  let next = world.nukeCharge + amount;
  while (next >= 1 - 1e-9 && world.nukeStocks < maxStocks) {
    world.nukeStocks += 1;
    if (world.nukeStocks >= maxStocks) {
      next = 1;
      break;
    }
    next = Math.max(0, next - 1);
  }
  world.nukeCharge = clamp(next, 0, 1);
}

export function addNukeKillCharge(world: SimWorld, amount = NUKE_KILL_CHARGE): void {
  grantNukeCharge(world, amount);
}

function computeSalvoTarget(world: SimWorld, salvoIndex: number): { x: number; z: number } {
  const bossActive = Boolean(world.boss && world.boss.active);
  const slot = (salvoIndex - 1) % 4;
  if (slot === 0) {
    return {
      x: clamp(world.squadX * 0.4, -2.0, 2.0),
      z: bossActive ? -16.0 : NUKE_TARGET_Z,
    };
  }
  if (slot === 1) {
    return {
      x: clamp(world.squadX * 0.32 - 2.35, -3.5, 3.5),
      z: bossActive ? -14.0 : -29.0,
    };
  }
  if (slot === 2) {
    return {
      x: clamp(world.squadX * 0.32 + 2.35, -3.5, 3.5),
      z: bossActive ? -18.2 : -39.5,
    };
  }
  return {
    x: clamp(-world.squadX * 0.45, -2.6, 2.6),
    z: bossActive ? -15.5 : -50.0,
  };
}

/**
 * Launches a Tactical Thermonuclear Warhead immediately on tap — supports rapid multi-tap
 * chain salvos (`连点核弹`) with staggered orbital lock-on coordinates and thruster acceleration!
 */
export function tryTriggerNukeStrike(world: SimWorld, events: SimEvent[]): boolean {
  if (world.squadCount <= 0) return false;

  const maxStocks = Math.max(1, world.nukeMaxStocks || 1);
  const hasStock = world.nukeStocks >= 1 || world.nukeCharge >= 0.999 || world.isFiringRange;

  if (!hasStock) {
    // Impatient rapid-tapping while warheads are mid-flight fires Orbital Thruster Overdrive!
    let boosted = false;
    for (let i = 0; i < world.nukeSalvo.length; i++) {
      const s = world.nukeSalvo[i]!;
      if (s.dropTimer > 0.1) {
        s.dropTimer = Math.max(0.04, s.dropTimer - 0.36);
        boosted = true;
      }
    }
    if (boosted) syncLegacyNukeFields(world);
    return false;
  }

  // Keep active salvo bounded cleanly so extreme rapid-tapping stays 60fps smooth
  if (world.nukeSalvo.length >= NUKE_MAX_CONCURRENT_SALVO) {
    const finishedIdx = world.nukeSalvo.findIndex((s) => s.dropTimer <= 0 && s.blastTimer < 1.8);
    if (finishedIdx >= 0) {
      world.nukeSalvo.splice(finishedIdx, 1);
    } else {
      const oldestDrop = world.nukeSalvo.find((s) => s.dropTimer > 0);
      if (oldestDrop) {
        detonateTacticalNuke(world, oldestDrop, events);
      } else {
        world.nukeSalvo.shift();
      }
    }
  }

  if (world.isFiringRange) {
    world.nukeStocks = maxStocks;
    world.nukeCharge = 1;
  } else if (world.nukeStocks >= maxStocks) {
    world.nukeStocks = maxStocks - 1;
    world.nukeCharge = 0;
  } else if (world.nukeStocks >= 1) {
    world.nukeStocks -= 1;
  } else {
    world.nukeCharge = 0;
  }

  world.nukeSalvoChain = world.nukeChainWindowTimer > 0 ? world.nukeSalvoChain + 1 : 1;
  world.nukeChainWindowTimer = 4.6;
  const salvoIndex = world.nukeSalvoChain;
  const target = computeSalvoTarget(world, salvoIndex);

  const strike: SimNukeStrike = {
    id: allocEntityId(world),
    x: target.x,
    z: target.z,
    dropTimer: NUKE_DROP_DURATION,
    dropDuration: NUKE_DROP_DURATION,
    blastTimer: 0,
    salvoIndex,
  };
  world.nukeSalvo.push(strike);
  syncLegacyNukeFields(world);

  events.push({
    type: 'NUKE_LAUNCH',
    x: strike.x,
    z: strike.z,
    duration: NUKE_DROP_DURATION,
    salvoIndex,
    remainingStocks: world.nukeStocks,
  });
  return true;
}

/**
 * Advances continuous multi-stock Nuke recharge, concurrent orbital warhead descents,
 * and staggered full-horizon thermonuclear detonations.
 */
export function stepNukeStrike(world: SimWorld, events: SimEvent[]): void {
  if (world.nukeChainWindowTimer > 0) {
    world.nukeChainWindowTimer = snapZero(world.nukeChainWindowTimer - FIXED_DT);
    if (world.nukeChainWindowTimer <= 0 && world.nukeSalvo.length === 0) {
      world.nukeSalvoChain = 0;
    }
  }

  // Continuous zero-lockout passive recharge whenever warhead magazine is below max capacity!
  const maxStocks = Math.max(1, world.nukeMaxStocks || 1);
  if (world.nukeStocks < maxStocks || world.nukeCharge < 1) {
    const resonanceBoost =
      (1 + Math.max(0, world.mods.resonanceMult - 1) * 0.35) * (world.overdriveTimer > 0 ? 1.4 : 1.0);
    grantNukeCharge(world, NUKE_PASSIVE_CHARGE_PER_SEC * resonanceBoost * FIXED_DT);
  }

  // Fallback compatibility if a test mutated scalar nukeDropTimer/nukeBlastTimer directly without nukeSalvo
  if (world.nukeSalvo.length === 0) {
    if (world.nukeBlastTimer > 0) {
      world.nukeBlastTimer = snapZero(world.nukeBlastTimer - FIXED_DT);
    }
    if (world.nukeDropTimer > 0) {
      world.nukeDropTimer = snapZero(world.nukeDropTimer - FIXED_DT);
    }
    return;
  }

  const anyDropping = world.nukeSalvo.some((s) => s.dropTimer > 0);
  if (anyDropping) {
    // Monsters across the highway shudder & slow under orbital laser lock-on!
    for (let i = 0; i < world.enemies.length; i++) {
      const e = world.enemies[i];
      if (!e || !e.active || e.consumed || e.hp <= 0) continue;
      if (e.z >= -145 && e.z <= PLAYER_Z + 1) {
        e.slowTimer = Math.max(e.slowTimer, 0.25);
      }
    }
  }

  for (let i = world.nukeSalvo.length - 1; i >= 0; i--) {
    const s = world.nukeSalvo[i]!;
    if (s.dropTimer > 0) {
      s.dropTimer = snapZero(s.dropTimer - FIXED_DT);
      if (s.dropTimer <= 0) {
        detonateTacticalNuke(world, s, events);
      }
    } else if (s.blastTimer > 0) {
      s.blastTimer = snapZero(s.blastTimer - FIXED_DT);
      if (s.blastTimer <= 0) {
        world.nukeSalvo.splice(i, 1);
      }
    } else {
      world.nukeSalvo.splice(i, 1);
    }
  }

  if (world.nukeSalvo.length === 0 && world.nukeChainWindowTimer <= 0) {
    world.nukeSalvoChain = 0;
  }
  syncLegacyNukeFields(world);
}

function detonateTacticalNuke(world: SimWorld, strike: SimNukeStrike, events: SimEvent[]): void {
  strike.dropTimer = 0;
  strike.blastTimer = NUKE_BLAST_DURATION;
  world.isNukeDetonating = true;

  // Extended thermal force-shield so nothing cheap-shots the squad during blinding nuclear shockwave
  world.aegisTimer = Math.max(world.aegisTimer, 1.65);

  const blastX = strike.x;
  const blastZ = strike.z;
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

  world.rampageTimer = 4.2;
  world.rampageStacks = Math.min(60, world.rampageStacks + Math.min(40, Math.max(8, kills)));

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

  // 4. Heavy strike on Nemesis Pursuer if active!
  if (world.nemesis && world.nemesis.active && world.nemesis.hp > 0) {
    damageNemesis(world, Math.max(520, Math.round(world.nemesis.maxHp * 0.34)), 'plasma', true, events);
  }

  // 5. Deal colossal thermonuclear armor-shredding strike to Boss parts, pylons & core!
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
      const rawNukeBoss = Math.round(boss.maxHp * 0.22 + 680 * world.mods.damageMult);
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
  syncLegacyNukeFields(world);

  events.push({
    type: 'NUKE_DETONATE',
    x: blastX,
    z: blastZ,
    kills,
    bossDamage,
    salvoIndex: strike.salvoIndex,
  });
}
