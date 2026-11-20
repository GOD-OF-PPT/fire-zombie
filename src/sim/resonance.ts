import type { SimEvent } from '../types/game';
import { OVERDRIVE_DURATION, PLAYER_Z } from '../config/constants';
import { hasSynergy } from '../config/protocols';
import { allocEntityId, type SimWorld } from './entities';
import { normalizeZero } from './math';
import { triggerCoreReactorDomainPulse } from './v21Mechanics';
import { addNirvanaCharge } from './v23Mechanics';

const FULL_EPS = 1e-9;

export function getEffectiveOverdriveDuration(world: SimWorld): number {
  return OVERDRIVE_DURATION + (hasSynergy(world.endless?.upgrades, 'tempest_blades') ? 1.5 : 0);
}

export function addResonance(world: SimWorld, gain: number, events: SimEvent[]): void {
  if (gain <= 0 || world.overdriveTimer > 0) {
    return;
  }
  world.resonance = Math.min(1.0, world.resonance + gain * world.mods.resonanceMult);
  if (world.resonance >= 1.0 - FULL_EPS) {
    world.resonance = 1.0;
    // Manual runs hold a full gauge until the player fires it, so timing the burst is a choice.
    if (!world.mods.manualOverdrive) {
      startOverdrive(world, events);
    }
  }
}

/** Fires a fully charged gauge on request; returns false when it is not ready. */
export function tryStartManualOverdrive(world: SimWorld, events: SimEvent[]): boolean {
  if (world.overdriveTimer > 0 || world.resonance < 1.0 - FULL_EPS) {
    return false;
  }
  startOverdrive(world, events);
  return true;
}

function startOverdrive(world: SimWorld, events: SimEvent[]): void {
  world.resonance = 1.0;
  const breakSync = Boolean(world.boss && world.boss.active && world.boss.breakTimer > 0);
  const vortexBonus = breakSync ? Math.max(0, world.mods.specVortex ?? 0) * 0.4 : 0;
  world.overdriveTimer = getEffectiveOverdriveDuration(world) + (breakSync ? 1.4 + vortexBonus : 0);
  if (breakSync && world.boss) {
    world.boss.breakTimer = Math.min(7.2, world.boss.breakTimer + 1.0 + vortexBonus * 0.5);
  }
  world.overdriveJustStarted = true;
  // Mirror Circuit Protocol: projects a 3.8s Squad-Tracking Golden Prism Lens right ahead of the squad!
  if ((world.endless?.upgrades.resonance ?? 0) >= 1) {
    const hasTrackingLens = world.lenses.some((l) => l.active && l.driftFreq === -999);
    if (!hasTrackingLens) {
      const lens = world.lensPool.acquire();
      lens.id = allocEntityId(world);
      lens.baseX = normalizeZero(world.squadX);
      lens.prevX = lens.baseX;
      lens.prevZ = PLAYER_Z - 4.2;
      lens.x = lens.baseX;
      lens.z = PLAYER_Z - 4.2;
      lens.vz = 0;
      lens.driftAmp = 0;
      lens.driftFreq = -999; // Sentinel: Squad-Tracking Virtual Overdrive Lens
      lens.age = 0;
      lens.halfWidth = 2.05;
      lens.halfDepth = 0.55;
      lens.pulse = 1.0;
      lens.active = true;
      world.lenses.push(lens);
    }
  }
  events.push({
    type: 'OVERDRIVE_START',
    x: world.squadX,
    z: PLAYER_Z,
    ...(breakSync ? { overdriveBreakSync: true } : {}),
  });
  addNirvanaCharge(world, 0.16);
  triggerCoreReactorDomainPulse(world, 'overdrive', events);
}
