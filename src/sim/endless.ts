import { generateEndlessStage } from '../config/endless';
import type { SimWorld } from './entities';
import { grantSquadWithReserve } from './competition';
import { getProtocolOffers, hasSynergy } from '../config/protocols';
import type { EndlessUpgradeId } from '../types/game';
import { BLADES_MAX_COUNT } from '../config/constants';

export interface EndlessStageTransition {
  wave: number;
  bosses: number;
  bonus: number;
}

/** Starts the next loop while preserving everything the player earned during the run. */
export function advanceEndlessStage(world: SimWorld): EndlessStageTransition {
  const state = world.endless;
  if (!state) throw new Error('Cannot advance a non-endless run');

  state.completedDistance += world.script.runwayLength;
  state.bossesDefeated += 1;
  state.wave += 1;

  const completedWave = state.wave - 1;
  const synBonus = hasSynergy(state.upgrades, 'immortal_legion') ? 10 : 0;
  const bonus = Math.min(40, 10 + completedWave * 2) + (state.upgrades.supply ?? 0) * 12 + synBonus;
  grantSquadWithReserve(world, bonus);
  world.stats.peakSquad = Math.max(world.stats.peakSquad, world.squadCount);
  world.resonance = 1;
  world.overdriveTimer = 0;
  world.overdriveJustStarted = false;
  world.aegisCooldown = 0;

  world.gateRowPool.releaseAll(world.gateRows);
  world.gatePool.releaseAll(world.gates);
  world.vaultPool.releaseAll(world.vaults);
  world.enemyPool.releaseAll(world.enemies);
  world.barrelPool.releaseAll(world.barrels);
  world.lensPool.releaseAll(world.lenses);
  world.projectilePool.releaseAll(world.projectiles);
  world.singularities.length = 0;
  world.jumpPads.length = 0;
  world.reflectors.length = 0;
  world.contractWalls.length = 0;
  world.doomOrbs.length = 0;
  world.jumpTimer = 0;
  world.landingAmbushX = undefined;
  world.cutback = undefined;
  world.squadAirY = 0;

  world.script = generateEndlessStage(world.mods.layoutSeed ?? 1, state.wave);
  world.scrollDistance = 0;
  world.currentScrollSpeed = world.script.scrollSpeed;
  world.runwayProgress = 0;
  world.spawnCursor = 0;
  world.mirrorFlags = [];
  world.bossSpawned = false;
  world.boss = null;
  if (world.mods.manualEndlessDraft) {
    state.offers = getProtocolOffers(world.mods.layoutSeed ?? 1, state.wave);
    world.phase = 'PAUSED';
  }

  return { wave: state.wave, bosses: state.bossesDefeated, bonus };
}

export function chooseEndlessUpgrade(world: SimWorld, id: EndlessUpgradeId): boolean {
  const state = world.endless;
  if (!state || world.phase !== 'PAUSED' || !state.offers.includes(id)) return false;
  state.upgrades[id] = (state.upgrades[id] ?? 0) + 1;
  switch (id) {
    case 'power': world.mods.damageMult *= 1.18; break;
    case 'recruits': grantSquadWithReserve(world, 40); break;
    case 'resonance': world.mods.resonanceMult *= 1.3; break;
    case 'weapon':
      world.stats.vaultsCracked = Math.max(1, world.stats.vaultsCracked);
      if (world.weaponLevel < 3) {
        world.weaponLevel = (world.weaponLevel + 1) as 2 | 3;
        world.learnedWeaponLevels[world.weapon] = world.weaponLevel;
      } else {
        world.overclockStacks += 1;
        world.masteryCount += 3;
      }
      break;
    case 'blades':
      if (world.bladesCount >= BLADES_MAX_COUNT) world.mods.damageMult *= 1.12;
      else world.bladesCount = Math.min(BLADES_MAX_COUNT, world.bladesCount + 2);
      break;
    case 'supply': break;
  }
  world.stats.peakSquad = Math.max(world.stats.peakSquad, world.squadCount);
  state.offers = [];
  world.phase = 'PLAYING';
  return true;
}
