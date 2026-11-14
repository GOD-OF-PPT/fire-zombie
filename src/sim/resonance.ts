import type { SimEvent } from '../types/game';
import { OVERDRIVE_DURATION, PLAYER_Z } from '../config/constants';
import type { SimWorld } from './entities';

export function addResonance(world: SimWorld, gain: number, events: SimEvent[]): void {
  if (gain <= 0 || world.overdriveTimer > 0) {
    return;
  }
  world.resonance = Math.min(1.0, world.resonance + gain * world.mods.resonanceMult);
  if (world.resonance >= 1.0 - 1e-9) {
    world.resonance = 1.0;
    world.overdriveTimer = OVERDRIVE_DURATION;
    world.overdriveJustStarted = true;
    events.push({
      type: 'OVERDRIVE_START',
      x: world.squadX,
      z: PLAYER_Z,
    });
  }
}
