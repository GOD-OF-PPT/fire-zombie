import type { SimEvent } from '../types/game';
import { OVERDRIVE_DURATION, PLAYER_Z } from '../config/constants';
import type { SimWorld } from './entities';

const FULL_EPS = 1e-9;

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
  world.overdriveTimer = OVERDRIVE_DURATION;
  world.overdriveJustStarted = true;
  events.push({
    type: 'OVERDRIVE_START',
    x: world.squadX,
    z: PLAYER_Z,
  });
}
