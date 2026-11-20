import { DESPAWN_Z, FIXED_DT, PLAYER_Z, TRACK_HALF_WIDTH } from '../config/constants';
import type {
  OverclockChipId,
  PhaseGateAttune,
  SimEvent,
  WeatherKind,
  WeaponId,
} from '../types/game';
import { applyBarrelBlastToBoss } from './bosses';
import { damageBarrel } from './barrels';
import {
  grantSquadWithReserve,
  recordDamage,
  spawnOrRefreshSingularity,
  spawnReflector,
} from './competition';
import { damageEnemy } from './enemies';
import type {
  SimBossState,
  SimCapacitorTower,
  SimCoreShard,
  SimEnemy,
  SimMagRail,
  SimPhaseGate,
  SimProjectile,
  SimWorld,
} from './entities';
import { applyFlatDeltaToGate, applyProjectileHitToGate } from './gates';
import { clamp, normalizeZero } from './math';
import { addResonance } from './resonance';

function allocV20Id(world: SimWorld): number {
  world.spectacleIdSeq = (world.spectacleIdSeq ?? 0) + 1;
  return 900000 + world.spectacleIdSeq;
}

export function hasChip(world: SimWorld, id: OverclockChipId): boolean {
  if (world.mods.fairTrial) return false;
  const chips = world.mods.equippedChips;
  return Boolean(chips && chips.includes(id));
}

export function isWeaponAttuned(weapon: WeaponId, attune: PhaseGateAttune): boolean {
  if (attune === 'kinetic') {
    return weapon === 'pulse' || weapon === 'scatter' || weapon === 'rail';
  }
  return weapon === 'plasma' || weapon === 'cryo';
}

// ===========================================================================
// Stage 1: Boss Phase-3 Omega Overdrive, Dynamic Weather & Omega Execution
// ===========================================================================
export function resolveWeatherForBoss(world: SimWorld, boss: SimBossState): WeatherKind {
  if (boss.id === 'warden_01') return 'solar_emp';
  if (boss.id === 'hydra_02') return 'prism_tide';
  void world;
  return 'cryo_blizzard';
}

export function checkAndStepBossOmegaOverdrive(world: SimWorld, events: SimEvent[]): void {
  const boss = world.boss;
  if (!boss || !boss.active || boss.hp <= 0 || boss.introProgress < 1) {
    if (world.weatherState !== 'none' && !world.isFiringRange) {
      world.weatherState = 'none';
    }
    return;
  }

  const allThreePartsBroken =
    boss.parts.length >= 3 && boss.parts.every((pt) => pt.destroyed);
  const lowHpThreshold = boss.phase >= 2 && boss.hp <= boss.maxHp * 0.30;

  if (!boss.omegaOverdrive && (lowHpThreshold || allThreePartsBroken)) {
    boss.omegaOverdrive = true;
    boss.omegaBeamState = 'idle';
    boss.omegaBeamTimer = 1.65;
    boss.omegaBeamX = world.squadX;
    boss.omegaLeftFocus = 0;
    boss.omegaRightFocus = 0;
    boss.omegaFocusHits = 0;
    const weather = resolveWeatherForBoss(world, boss);
    world.weatherState = weather;

    // Ensure Twin Converging 45° Reflector Array is deployed for Cross-Focus Execution!
    if (world.reflectors.length < 2) {
      world.reflectors.length = 0;
      const rL = spawnReflector(world, -2.85, -9.8, 0, 1);
      rL.angleDeg = 39;
      const rR = spawnReflector(world, 2.85, -9.8, 0, -1);
      rR.angleDeg = -39;
    } else {
      for (const rf of world.reflectors) {
        rf.angleDeg = rf.lean * 39;
      }
    }

    events.push({
      type: 'BOSS_OMEGA_OVERDRIVE',
      bossId: boss.id,
      weather,
      x: boss.x,
      z: boss.z,
    });
  }

  if (!boss.omegaOverdrive) return;

  // Decay mirror cross-focus timers
  if ((boss.omegaLeftFocus ?? 0) > 0) {
    boss.omegaLeftFocus = Math.max(0, (boss.omegaLeftFocus ?? 0) - FIXED_DT);
  }
  if ((boss.omegaRightFocus ?? 0) > 0) {
    boss.omegaRightFocus = Math.max(0, (boss.omegaRightFocus ?? 0) - FIXED_DT);
  }

  // Dynamic Weather Arena Physics: Sector 2 `prism_tide` harmonic lateral gravity tide on fodder & hostile orbs
  if (world.weatherState === 'prism_tide') {
    const tide = Math.sin(world.simTime * 2.1) * 1.15 * FIXED_DT;
    for (let i = 0; i < world.enemies.length; i++) {
      const e = world.enemies[i];
      if (e && e.active && e.isSwarmFodder && !e.consumed && e.hp > 0) {
        e.x = normalizeZero(clamp(e.x + tide, -TRACK_HALF_WIDTH + e.radius, TRACK_HALF_WIDTH - e.radius));
      }
    }
  }

  // Step Boss Ultimate Annihilation Beam (`idle -> charging (1.45s) -> firing (0.36s)`)
  if (boss.omegaExecuted || world.isFiringRange) {
    // In Firing Range boss_dummy preset, cycle charging gently without dealing lethal damage so player can practice parrying!
    if (world.isFiringRange && !boss.omegaExecuted) {
      boss.omegaBeamTimer = (boss.omegaBeamTimer ?? 1.2) - FIXED_DT;
      if (boss.omegaBeamState === 'idle' && (boss.omegaBeamTimer ?? 0) <= 0) {
        boss.omegaBeamState = 'charging';
        boss.omegaBeamTimer = 1.45;
        boss.omegaBeamX = world.squadX;
        events.push({ type: 'OMEGA_BEAM_CHARGE', x: boss.omegaBeamX, z: boss.z });
      } else if (boss.omegaBeamState === 'charging' && (boss.omegaBeamTimer ?? 0) <= 0) {
        boss.omegaBeamState = 'idle';
        boss.omegaBeamTimer = 1.8;
      }
    }
    return;
  }

  boss.omegaBeamTimer = (boss.omegaBeamTimer ?? 2.0) - FIXED_DT;
  if (boss.omegaBeamState === 'idle') {
    if (boss.omegaBeamTimer <= 0) {
      boss.omegaBeamState = 'charging';
      boss.omegaBeamTimer = 1.45;
      boss.omegaBeamX = clamp(world.squadX, -3.2, 3.2);
      events.push({ type: 'OMEGA_BEAM_CHARGE', x: boss.omegaBeamX, z: boss.z });
    }
  } else if (boss.omegaBeamState === 'charging') {
    // Gently track 25% toward squad during first half of charge, then lock lane so dodge/parry is 100% readable!
    if (boss.omegaBeamTimer > 0.65) {
      boss.omegaBeamX = normalizeZero(
        clamp((boss.omegaBeamX ?? 0) + (world.squadX - (boss.omegaBeamX ?? 0)) * 1.8 * FIXED_DT, -3.4, 3.4),
      );
    }
    if (boss.omegaBeamTimer <= 0) {
      boss.omegaBeamState = 'firing';
      boss.omegaBeamTimer = 0.36;
      boss.omegaBeamHitApplied = false;
    }
  } else if (boss.omegaBeamState === 'firing') {
    if (!boss.omegaBeamHitApplied) {
      boss.omegaBeamHitApplied = true;
      const beamX = boss.omegaBeamX ?? 0;
      if (Math.abs(world.squadX - beamX) <= 1.25 + world.formationRadius * 0.35 && world.squadAirY <= 0.6) {
        if (world.aegisTimer > 0) {
          triggerOmegaExecution(world, boss, 'aegis_parry', events);
          return;
        }
        // Graze attrition if neither dodged nor parried (capped so active runs can recover via Reserve)
        if (world.squadCount > 8) {
          const beamLoss = Math.min(12, Math.max(3, Math.floor(world.squadCount * 0.09)));
          world.squadCount = Math.max(1, world.squadCount - beamLoss);
          events.push({ type: 'SQUAD_LOSS', x: beamX, z: PLAYER_Z, lost: beamLoss, reason: 'BOSS_ATTACK' });
        }
      }
    }
    if (boss.omegaBeamTimer <= 0) {
      boss.omegaBeamState = 'idle';
      boss.omegaBeamTimer = 3.8;
    }
  }
}

export function registerOmegaReflectorHitOnBoss(
  world: SimWorld,
  proj: SimProjectile,
  events: SimEvent[],
): void {
  const boss = world.boss;
  if (!boss || !boss.active || !boss.omegaOverdrive || boss.omegaExecuted || !proj.amplified) return;

  // Determine whether bolt bounced from Left (`vx > 0`) or Right (`vx < 0`) 45° Reflector
  if (proj.vx > 1.5) {
    boss.omegaLeftFocus = 2.8;
  } else if (proj.vx < -1.5) {
    boss.omegaRightFocus = 2.8;
  }
  const inc = hasChip(world, 'chip_exec_protocol') ? 1.35 : 1.0;
  boss.omegaFocusHits = (boss.omegaFocusHits ?? 0) + inc;

  const crossFocused = (boss.omegaLeftFocus ?? 0) > 0 && (boss.omegaRightFocus ?? 0) > 0;
  const focusThreshold = hasChip(world, 'chip_exec_protocol') ? 4 : 5;
  if (crossFocused || (boss.omegaFocusHits ?? 0) >= focusThreshold) {
    triggerOmegaExecution(world, boss, 'mirror_focus', events);
  }
}

export function tryParryBossOmegaBeam(world: SimWorld, events: SimEvent[]): boolean {
  const boss = world.boss;
  if (!boss || !boss.active || !boss.omegaOverdrive || boss.omegaExecuted) return false;

  const inParryWindow =
    (boss.omegaBeamState === 'charging' && (boss.omegaBeamTimer ?? 9) <= 0.85) ||
    boss.omegaBeamState === 'firing';
  if (!inParryWindow) return false;

  const beamX = boss.omegaBeamX ?? 0;
  if (Math.abs(world.squadX - beamX) > 2.45 + world.formationRadius * 0.5) return false;

  triggerOmegaExecution(world, boss, 'aegis_parry', events);
  return true;
}

export function triggerOmegaExecution(
  world: SimWorld,
  boss: SimBossState,
  trigger: 'mirror_focus' | 'aegis_parry',
  events: SimEvent[],
): void {
  if (boss.omegaExecuted && !world.isFiringRange) return;
  boss.omegaExecuted = !world.isFiringRange;
  boss.omegaBeamState = 'idle';
  boss.omegaBeamTimer = 4.6;
  boss.shielded = false;
  if (boss.secondaryCore) boss.secondaryCore.shielded = false;
  boss.breakTimer = Math.max(boss.breakTimer, 5.5);

  const execChunk = Math.max(
    Math.ceil(boss.maxHp * 0.24),
    Math.round(world.trueSquadDps * 3.2),
  );
  const dealt = Math.min(boss.hp, execChunk);
  recordDamage(world, 'deflect', dealt);
  boss.hp = Math.max(0, boss.hp - dealt);
  boss.hitPulse = 1.0;

  // Screen-clear all hostile projectiles, hazard zones & active swarm minions!
  boss.hazardZones.length = 0;
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    if (p && p.active && p.hostile) {
      p.active = false;
      world.projectilePool.release(p);
      world.projectiles.splice(i, 1);
    }
  }
  let purged = 0;
  const snapLen = world.enemies.length;
  for (let i = 0; i < snapLen; i++) {
    const e = world.enemies[i];
    if (e && e.active && !e.consumed && !e.bypassed && e.hp > 0) {
      const killDmg = e.hp + 50;
      recordDamage(world, 'deflect', e.hp);
      if (damageEnemy(world, e, killDmg, 0, events, { bypassShield: true })) {
        purged += 1;
      }
    }
  }
  addResonance(world, 1.0, events);
  spawnCoreShard(world, boss.x - 1.2, boss.z + 3.0, 3);
  spawnCoreShard(world, boss.x + 1.2, boss.z + 3.0, 3);

  events.push({
    type: 'OMEGA_EXECUTION',
    bossId: boss.id,
    trigger,
    damage: dealt,
    kills: purged,
    x: boss.x,
    z: boss.z,
  });
}

// ===========================================================================
// Stage 2: Remaining 7/10 Overlimit Dual-Weapon Resonance Evolutions
// ===========================================================================
export function triggerV20OverlimitHitEvolution(
  world: SimWorld,
  proj: SimProjectile,
  enemy: SimEnemy,
  dealtDmg: number,
  killed: boolean,
  wasChilled: boolean,
  hitX: number,
  hitZ: number,
  events: SimEvent[],
): void {
  const ov = world.overlimitResonance;
  if (!ov || world.ricochetsThisTick >= 5) return;

  switch (ov) {
    case 'photon_prism_fan': {
      // Pulse + Scatter: every 5th hit fires twin converging photon-fan needles & charges nearby Capacitor Towers!
      world.overlimitTickCounter = (world.overlimitTickCounter + 1) % 5;
      if (world.overlimitTickCounter === 0) {
        world.ricochetsThisTick += 1;
        const fanDmg = dealtDmg * 0.52;
        for (let i = 0; i < world.enemies.length; i++) {
          const nb = world.enemies[i];
          if (!nb || !nb.active || nb.consumed || nb.bypassed || nb.hp <= 0 || nb.id === enemy.id) continue;
          if (Math.abs(nb.z - hitZ) <= 3.6 && Math.abs(nb.x - hitX) <= 3.8) {
            events.push({
              type: 'CHAIN_ARC',
              fromX: hitX,
              fromZ: hitZ,
              toX: nb.x,
              toZ: nb.z,
              damage: Math.max(1, Math.round(fanDmg)),
              webColor: 0x6dffb8,
            });
            recordDamage(world, 'fusions', Math.min(nb.hp, fanDmg));
            damageEnemy(world, nb, fanDmg, 0, events);
            break;
          }
        }
        for (const cap of world.capTowers) {
          if (cap.active && !cap.discharged && Math.hypot(cap.x - hitX, cap.z - hitZ) <= 8.5) {
            chargeCapacitorTower(world, cap, fanDmg, true, events);
          }
        }
      }
      break;
    }

    case 'plasma_overcharge_mortar': {
      // Pulse + Plasma: magnetized plasma bursts arc to nearby enemies & overcharge Capacitor Towers
      world.overlimitTickCounter = (world.overlimitTickCounter + 1) % 4;
      if (world.overlimitTickCounter === 0 || proj.weapon === 'plasma') {
        world.ricochetsThisTick += 1;
        const empDmg = dealtDmg * 0.48;
        for (let i = 0; i < world.enemies.length; i++) {
          const nb = world.enemies[i];
          if (!nb || !nb.active || nb.consumed || nb.bypassed || nb.hp <= 0 || nb.id === enemy.id) continue;
          if (Math.hypot(nb.x - hitX, nb.z - hitZ) <= 3.1 + nb.radius) {
            recordDamage(world, 'fusions', Math.min(nb.hp, empDmg));
            damageEnemy(world, nb, empDmg, 0, events, { bypassShield: true });
          }
        }
        for (const cap of world.capTowers) {
          if (cap.active && !cap.discharged && Math.hypot(cap.x - hitX, cap.z - hitZ) <= 7.5) {
            chargeCapacitorTower(world, cap, empDmg * 1.4, true, events);
          }
        }
      }
      break;
    }

    case 'zero_kelvin_needle': {
      // Pulse + Cryo: killing or hitting chilled enemies bursts 3 forward zero-kelvin ice lances!
      if ((killed || wasChilled) && world.ricochetsThisTick < 3) {
        world.ricochetsThisTick += 1;
        const iceDmg = dealtDmg * 0.62;
        let hits = 0;
        for (let i = 0; i < world.enemies.length && hits < 3; i++) {
          const nb = world.enemies[i];
          if (!nb || !nb.active || nb.consumed || nb.bypassed || nb.hp <= 0 || nb.id === enemy.id) continue;
          if (nb.z <= hitZ + 1.0 && nb.z >= hitZ - 9.5 && Math.abs(nb.x - hitX) <= 2.8) {
            hits += 1;
            events.push({
              type: 'CHAIN_ARC',
              fromX: hitX,
              fromZ: hitZ,
              toX: nb.x,
              toZ: nb.z,
              damage: Math.max(1, Math.round(iceDmg)),
              webColor: 0x8fdcff,
            });
            recordDamage(world, 'fusions', Math.min(nb.hp, iceDmg));
            damageEnemy(world, nb, iceDmg, 1.8, events);
          }
        }
      }
      break;
    }

    case 'hyper_rail_flechette': {
      // Scatter + Rail: links horizontal magnetic rail-wire across same-row enemies
      world.ricochetsThisTick += 1;
      const wireDmg = dealtDmg * 0.56;
      for (let i = 0; i < world.enemies.length; i++) {
        const nb = world.enemies[i];
        if (!nb || !nb.active || nb.consumed || nb.bypassed || nb.hp <= 0 || nb.id === enemy.id) continue;
        if (Math.abs(nb.z - hitZ) <= 2.4 && Math.abs(nb.x - hitX) <= 4.6) {
          events.push({
            type: 'CHAIN_ARC',
            fromX: hitX,
            fromZ: hitZ,
            toX: nb.x,
            toZ: nb.z,
            damage: Math.max(1, Math.round(wireDmg)),
            webColor: 0xc69cff,
          });
          recordDamage(world, 'fusions', Math.min(nb.hp, wireDmg));
          damageEnemy(world, nb, wireDmg, 0, events, { bypassShield: true });
          break;
        }
      }
      break;
    }

    case 'hailstorm_mirror_shatter': {
      // Scatter + Cryo: radial frost-shrapnel burst chilling & shredding swarm cluster
      world.overlimitTickCounter = (world.overlimitTickCounter + 1) % 4;
      if (world.overlimitTickCounter === 0 || wasChilled) {
        world.ricochetsThisTick += 1;
        const hailDmg = dealtDmg * 0.50;
        for (let i = 0; i < world.enemies.length; i++) {
          const nb = world.enemies[i];
          if (!nb || !nb.active || nb.consumed || nb.bypassed || nb.hp <= 0 || nb.id === enemy.id) continue;
          if (Math.hypot(nb.x - hitX, nb.z - hitZ) <= 3.0 + nb.radius) {
            recordDamage(world, 'fusions', Math.min(nb.hp, hailDmg));
            damageEnemy(world, nb, hailDmg, 1.5, events);
          }
        }
      }
      break;
    }

    case 'magma_lance_cataclysm': {
      // Rail + Plasma: molten slag line erupts along Z axis & ignites nearby Surge Barrels!
      world.ricochetsThisTick += 1;
      const slagDmg = dealtDmg * 0.54;
      for (let i = 0; i < world.enemies.length; i++) {
        const nb = world.enemies[i];
        if (!nb || !nb.active || nb.consumed || nb.bypassed || nb.hp <= 0 || nb.id === enemy.id) continue;
        if (Math.abs(nb.x - hitX) <= 1.85 && Math.abs(nb.z - hitZ) <= 5.2) {
          recordDamage(world, 'fusions', Math.min(nb.hp, slagDmg));
          damageEnemy(world, nb, slagDmg, 0, events, { bypassShield: true });
        }
      }
      for (let bIdx = 0; bIdx < world.barrels.length; bIdx++) {
        const b = world.barrels[bIdx];
        if (b && b.active && !b.detonated && Math.hypot(b.x - hitX, b.z - hitZ) <= 4.5) {
          damageBarrel(world, b, slagDmg, events, applyBarrelBlastToBoss, true);
          break;
        }
      }
      break;
    }

    case 'glacial_rail_skewer': {
      // Rail + Cryo: deep freeze + +65% armor-rending bonus vs Shields/Elites
      world.ricochetsThisTick += 1;
      enemy.slowTimer = Math.max(enemy.slowTimer, 2.2);
      if (!killed && enemy.hp > 0 && (enemy.maxShieldHp > 0 || enemy.radius >= 0.85)) {
        const rend = dealtDmg * 0.65;
        recordDamage(world, 'fusions', Math.min(enemy.hp, rend));
        damageEnemy(world, enemy, rend, 2.2, events, { bypassShield: true });
      }
      break;
    }

    default:
      break;
  }
}

// ===========================================================================
// Stage 3: Stereoscopic Runway Tactical Set-Pieces (MagRail, CapacitorTower, PhaseGate)
// ===========================================================================
export function spawnMagRail(
  world: SimWorld,
  x: number,
  z: number,
  length = 14.0,
  polarity: 1 | -1 = 1,
): SimMagRail {
  const rail: SimMagRail = {
    id: allocV20Id(world),
    x: normalizeZero(clamp(x, -TRACK_HALF_WIDTH + 1.25, TRACK_HALF_WIDTH - 1.25)),
    z,
    length,
    halfWidth: 1.22,
    polarity,
    boostEmitted: false,
    active: true,
  };
  world.magRails.push(rail);
  return rail;
}

export function spawnCapacitorTower(
  world: SimWorld,
  x: number,
  z: number,
  vz = 0,
): SimCapacitorTower {
  const cap: SimCapacitorTower = {
    id: allocV20Id(world),
    prevX: normalizeZero(x),
    prevZ: z,
    x: normalizeZero(clamp(x, -TRACK_HALF_WIDTH + 1.1, TRACK_HALF_WIDTH - 1.1)),
    z,
    vz,
    radius: 1.02,
    charge: 0,
    maxCharge: 100,
    hitPulse: 0,
    discharged: false,
    active: true,
  };
  world.capTowers.push(cap);
  return cap;
}

export function chargeCapacitorTower(
  world: SimWorld,
  cap: SimCapacitorTower,
  rawDamage: number,
  amplifiedSource: boolean,
  events: SimEvent[],
): void {
  if (!cap.active || cap.discharged || rawDamage <= 0) return;

  // Reflector bank-shots, Chain-Arcs & Barrel blasts charge Capacitor Towers ~4.5x faster than raw bullets!
  const gainScale = amplifiedSource ? 0.48 : 0.11;
  const normalizedRef = Math.max(24, world.trueSquadDps * 0.22);
  const deltaCharge = clamp((rawDamage / normalizedRef) * 28 * gainScale * (amplifiedSource ? 4.2 : 1.0), 2.5, amplifiedSource ? 55 : 14);
  cap.charge = Math.min(cap.maxCharge, cap.charge + deltaCharge);
  cap.hitPulse = 1.0;

  if (cap.charge >= cap.maxCharge) {
    cap.charge = cap.maxCharge;
    cap.discharged = true;
    cap.active = false;

    const stormRadius = 18.0 * (hasChip(world, 'chip_volatile_core') ? 1.25 : 1.0);
    const stormDmg = Math.round(Math.max(220, world.trueSquadDps * 1.9) * world.mods.damageMult);
    let kills = 0;
    const snapLen = world.enemies.length;
    for (let i = 0; i < snapLen; i++) {
      const e = world.enemies[i];
      if (!e || !e.active || e.consumed || e.bypassed || e.hp <= 0) continue;
      if (Math.hypot(e.x - cap.x, e.z - cap.z) <= stormRadius + e.radius) {
        if (e.shieldHp > 0) e.shieldHp = 0;
        events.push({
          type: 'CHAIN_ARC',
          fromX: cap.x,
          fromZ: cap.z,
          toX: e.x,
          toZ: e.z,
          damage: stormDmg,
          webColor: 0x3ef3ff,
        });
        recordDamage(world, 'explosives', Math.min(e.hp, stormDmg));
        if (damageEnemy(world, e, stormDmg, 1.6, events, { bypassShield: true })) {
          kills += 1;
        }
      }
    }

    // Supercharge nearby Gold Gates (+6)!
    for (let i = 0; i < world.gates.length; i++) {
      const g = world.gates[i];
      if (g && g.active && g.mutable && !g.triggered && !g.dimmed && Math.abs(g.z - cap.z) <= 14.0) {
        if (g.isLockFlip) {
          applyProjectileHitToGate(world, g, stormDmg, events);
        } else {
          applyFlatDeltaToGate(world, g, 6, true, events);
        }
      }
    }

    // Also deal massive EMP shock to Boss if active nearby!
    if (world.boss && world.boss.active && world.boss.hp > 0 && !world.boss.shielded) {
      const bossEmp = Math.min(world.boss.hp, Math.round(stormDmg * 0.85));
      recordDamage(world, 'explosives', bossEmp);
      world.boss.hp = Math.max(0, world.boss.hp - bossEmp);
      world.boss.hitPulse = 1.0;
    }

    addResonance(world, 0.35, events);
    spawnCoreShard(world, cap.x - 0.6, cap.z, 2);
    spawnCoreShard(world, cap.x + 0.6, cap.z, 2);
    events.push({
      type: 'CAPACITOR_DISCHARGE',
      x: cap.x,
      z: cap.z,
      kills,
      damage: stormDmg,
    });
  }
}

export function spawnPhaseGate(
  world: SimWorld,
  x: number,
  z: number,
  attune: PhaseGateAttune,
  halfWidth = 2.25,
): SimPhaseGate {
  const pg: SimPhaseGate = {
    id: allocV20Id(world),
    prevZ: z,
    x: normalizeZero(clamp(x, -TRACK_HALF_WIDTH + halfWidth, TRACK_HALF_WIDTH - halfWidth)),
    z,
    halfWidth,
    attune,
    triggered: false,
    active: true,
  };
  world.phaseGates.push(pg);
  return pg;
}

export function stepV20SetPieces(world: SimWorld, events: SimEvent[]): void {
  if (world.magBoostTimer > 0) {
    world.magBoostTimer = Math.max(0, world.magBoostTimer - FIXED_DT);
  }
  if (world.phaseSyncTimer > 0) {
    world.phaseSyncTimer = Math.max(0, world.phaseSyncTimer - FIXED_DT);
  }

  // Schedule Tactical Set-Pieces during active runway advance ONLY when player has steered (zero AFK interference!)
  if (!world.boss && !world.isFiringRange && world.currentScrollSpeed > 1 && world.playerHasSteered) {
    const isLooped = Boolean(world.endless || world.mods.blitz);
    const tacStage = isLooped
      ? Math.floor((world.simTime + 6.0) / 14.0)
      : world.runwayProgress >= 0.78
        ? 3
        : world.runwayProgress >= 0.50
          ? 2
          : world.runwayProgress >= 0.22
            ? 1
            : 0;
    if (tacStage > world.lastTacStage) {
      world.lastTacStage = tacStage;
      const sideSign: 1 | -1 = (tacStage + world.sector) % 2 === 0 ? 1 : -1;
      if (tacStage % 3 === 1) {
        spawnMagRail(world, sideSign * 2.55, PLAYER_Z - 36.0, 14.0, sideSign);
      } else if (tacStage % 3 === 2) {
        const cap = spawnCapacitorTower(world, sideSign * 1.95, PLAYER_Z - 38.0, 0);
        // Pair Capacitor Tower with an angled 45° Reflector so player can bank-shot charge it!
        const rf = spawnReflector(world, -sideSign * 1.85, PLAYER_Z - 31.5, 0, sideSign);
        rf.angleDeg = sideSign * 38;
        void cap;
      } else {
        const attune: PhaseGateAttune = world.weapon === 'pulse' ? 'energy' : 'kinetic';
        spawnPhaseGate(world, sideSign * 2.1, PLAYER_Z - 34.0, attune, 2.2);
      }
    }
  }

  const scrollDz = world.currentScrollSpeed * FIXED_DT;

  // 1. Step Electromagnetic Slide Rails
  world.onMagRail = false;
  for (let i = world.magRails.length - 1; i >= 0; i--) {
    const r = world.magRails[i]!;
    if (!r.active) {
      world.magRails.splice(i, 1);
      continue;
    }
    r.z += scrollDz;
    const zFront = r.z + r.length * 0.5;
    const zBack = r.z - r.length * 0.5;
    if (zBack <= PLAYER_Z && zFront >= PLAYER_Z && Math.abs(world.squadX - r.x) <= r.halfWidth + world.formationRadius * 0.45) {
      world.onMagRail = true;
      world.magBoostTimer = 1.85;
      if (!r.boostEmitted) {
        r.boostEmitted = true;
        if (hasChip(world, 'chip_phase_blink')) {
          world.phaseSyncTimer = Math.max(world.phaseSyncTimer, 1.8);
        }
        events.push({ type: 'MAG_RAIL_BOOST', x: world.squadX, z: PLAYER_Z, polarity: r.polarity });
      }
    }
    if (zBack > DESPAWN_Z) {
      r.active = false;
      world.magRails.splice(i, 1);
    }
  }

  // 2. Step Overload Capacitor Towers
  for (let i = world.capTowers.length - 1; i >= 0; i--) {
    const c = world.capTowers[i]!;
    if (!c.active || c.discharged) {
      if (c.hitPulse <= 0 || c.z > DESPAWN_Z) {
        world.capTowers.splice(i, 1);
      } else {
        c.hitPulse = Math.max(0, c.hitPulse - FIXED_DT * 4);
      }
      continue;
    }
    c.prevX = c.x;
    c.prevZ = c.z;
    c.z += (world.isFiringRange ? 0 : scrollDz);
    if (c.hitPulse > 0) c.hitPulse = Math.max(0, c.hitPulse - FIXED_DT * 5);
    if (c.z > DESPAWN_Z) {
      c.active = false;
      world.capTowers.splice(i, 1);
    }
  }

  // 3. Step Dual-Color Phase Barrier Gates
  for (let i = world.phaseGates.length - 1; i >= 0; i--) {
    const pg = world.phaseGates[i]!;
    if (!pg.active) {
      world.phaseGates.splice(i, 1);
      continue;
    }
    pg.prevZ = pg.z;
    pg.z += (world.isFiringRange ? 0 : scrollDz);
    if (!pg.triggered && pg.prevZ <= PLAYER_Z && pg.z >= PLAYER_Z && world.squadAirY <= 0.65) {
      if (Math.abs(world.squadX - pg.x) <= pg.halfWidth + world.formationRadius * 0.35) {
        pg.triggered = true;
        pg.active = false;
        const synced = world.aegisTimer > 0 || isWeaponAttuned(world.weapon, pg.attune);
        if (synced) {
          grantSquadWithReserve(world, 10, events);
          addResonance(world, 0.35, events);
          world.phaseSyncTimer = 2.6;
          events.push({ type: 'PHASE_GATE_SYNC', x: pg.x, z: PLAYER_Z, attune: pg.attune, synced: true });
        } else {
          world.resonance = Math.max(0, world.resonance - 0.20);
          if (world.squadCount > 5) {
            const graze = Math.min(3, Math.max(1, Math.floor(world.squadCount * 0.04)));
            world.squadCount = Math.max(1, world.squadCount - graze);
          }
          events.push({ type: 'PHASE_GATE_SYNC', x: pg.x, z: PLAYER_Z, attune: pg.attune, synced: false });
        }
      }
    }
    if (pg.z > DESPAWN_Z || !pg.active) {
      world.phaseGates.splice(i, 1);
    }
  }
}

// ===========================================================================
// Stage 5: 3D Magnetized Core Shard Drops (InstancedMesh Zero-GC Pickups)
// ===========================================================================
export function spawnCoreShard(world: SimWorld, x: number, z: number, value = 1): void {
  if (world.coreShards.length >= 140) return;
  const spreadX = ((world.spectacleIdSeq % 5) - 2) * 0.28;
  world.coreShards.push({
    id: allocV20Id(world),
    x: normalizeZero(clamp(x + spreadX, -TRACK_HALF_WIDTH + 0.4, TRACK_HALF_WIDTH - 0.4)),
    z,
    vx: spreadX * 2.2,
    vz: -2.4,
    value: Math.max(1, Math.round(value)),
    age: 0,
    active: true,
  });
}

export function stepCoreShards(world: SimWorld, events: SimEvent[]): void {
  const magnetR = hasChip(world, 'chip_magnet_harvester') ? 6.4 : 3.2;
  const pullSpeed = hasChip(world, 'chip_magnet_harvester') ? 26.0 : 18.0;
  for (let i = world.coreShards.length - 1; i >= 0; i--) {
    const s = world.coreShards[i]!;
    if (!s.active) {
      world.coreShards.splice(i, 1);
      continue;
    }
    s.age += FIXED_DT;
    s.vx *= 0.90;
    s.vz = s.vz * 0.90 + world.currentScrollSpeed * 0.10;
    s.x = normalizeZero(clamp(s.x + s.vx * FIXED_DT, -TRACK_HALF_WIDTH + 0.35, TRACK_HALF_WIDTH - 0.35));
    s.z += s.vz * FIXED_DT;

    const dx = world.squadX - s.x;
    const dz = PLAYER_Z - s.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= magnetR && dist > 0.01) {
      const step = Math.min(dist, pullSpeed * FIXED_DT);
      s.x = normalizeZero(s.x + (dx / dist) * step);
      s.z += (dz / dist) * step;
    }

    if (Math.hypot(world.squadX - s.x, PLAYER_Z - s.z) <= 1.25 + world.formationRadius * 0.45) {
      s.active = false;
      world.collectedShards += s.value;
      if (hasChip(world, 'chip_magnet_harvester') && world.collectedShards % 5 === 0) {
        grantSquadWithReserve(world, 2, events);
      }
      events.push({ type: 'SHARD_COLLECT', x: s.x, z: s.z, value: s.value, total: world.collectedShards });
      world.coreShards.splice(i, 1);
      continue;
    }

    if (s.z > DESPAWN_Z || s.age > 9.5) {
      s.active = false;
      world.coreShards.splice(i, 1);
    }
  }
}
