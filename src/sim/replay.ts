import type { EndlessUpgradeId, GamePhase, InputSample, RunModifiers, SectorId, SimEvent } from '../types/game';
import { chooseEndlessUpgrade } from './endless';
import type { SimWorld } from './entities';
import { createSimWorld, reconcileFormationAndDps, resetSimWorldForSector, stepWorldFixed } from './world';

export interface ReplayKeyframe {
  /** Tick index (0-based 60Hz fixed step) */
  t: number;
  /** Exact per-step dragDeltaX (omitted if 0) */
  dx?: number;
  /** Continuous keyboard/gamepad axis in [-1, 1] */
  kx?: number;
  /** Bitmask: 1=overdrive, 2=aegisPulse, 4=nukeStrike, 8=swapWeapon */
  flags?: number;
  /** Optional Endless draft upgrade chosen before tick `t` */
  protocol?: EndlessUpgradeId;
}

export type ReplayMarkerKind =
  | 'part_break'
  | 'parry'
  | 'execution'
  | 'boss_spawn'
  | 'pantheon_stage'
  | 'reactor_wall';

export interface ReplayHighlightMarker {
  tick: number;
  kind: ReplayMarkerKind;
  label: string;
}

export interface DeterministicReplayLog {
  version: 1;
  sector: SectorId;
  seed: number;
  totalTicks: number;
  modifiers: Partial<RunModifiers>;
  keyframes: ReplayKeyframe[];
  markers: ReplayHighlightMarker[];
  expectedPhase: GamePhase;
  expectedFinalSquad: number;
  expectedKills: number;
}

export class ReplayRecorder {
  private sector: SectorId = 1;
  private seed = 1;
  private modifiers: Partial<RunModifiers> = {};
  private keyframes: ReplayKeyframe[] = [];
  private markers: ReplayHighlightMarker[] = [];
  private tick = 0;
  private lastKx = 0;

  start(sector: SectorId, seed: number, modifiers: Partial<RunModifiers>): void {
    this.sector = sector;
    this.seed = seed;
    this.modifiers = {
      ...modifiers,
      mutators: modifiers.mutators ? [...modifiers.mutators] : undefined,
      equippedChips: modifiers.equippedChips ? [...modifiers.equippedChips] : undefined,
    };
    this.keyframes = [];
    this.markers = [];
    this.tick = 0;
    this.lastKx = 0;
  }

  recordProtocol(id: EndlessUpgradeId): void {
    this.keyframes.push({ t: this.tick, protocol: id });
  }

  recordStep(input: InputSample): void {
    const dx = Number.isFinite(input.dragDeltaX) ? input.dragDeltaX : 0;
    const kx = Number.isFinite(input.keyAxisX) ? Math.max(-1, Math.min(1, input.keyAxisX)) : 0;
    const flags =
      (input.overdrive ? 1 : 0) |
      (input.aegisPulse ? 2 : 0) |
      (input.nukeStrike ? 4 : 0) |
      (input.swapWeapon ? 8 : 0) |
      (input.cycleWingman ? 16 : 0) |
      (input.nirvanaBurst ? 32 : 0) |
      (input.skyJump ? 64 : 0);

    if (dx !== 0 || flags !== 0 || kx !== this.lastKx) {
      const kf: ReplayKeyframe = { t: this.tick };
      if (dx !== 0) kf.dx = dx;
      if (kx !== this.lastKx || kx !== 0) kf.kx = kx;
      if (flags !== 0) kf.flags = flags;
      this.keyframes.push(kf);
      this.lastKx = kx;
    }
    this.tick += 1;
  }

  recordEvents(events: readonly SimEvent[]): void {
    const curTick = Math.max(0, this.tick - 1);
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      if (this.markers.length >= 24) break;
      if (ev.type === 'BOSS_PART_BREAK') {
        this.markers.push({ tick: curTick, kind: 'part_break', label: `⚡破核·${ev.label}` });
      } else if (ev.type === 'AEGIS_PARRY' || ev.type === 'DOOM_ORB_REFLECT') {
        this.markers.push({ tick: curTick, kind: 'parry', label: '🛡完美弹反' });
      } else if (ev.type === 'OMEGA_EXECUTION') {
        this.markers.push({ tick: curTick, kind: 'execution', label: '👑终焉处决' });
      } else if (ev.type === 'BOSS_INTRO') {
        this.markers.push({ tick: curTick, kind: 'boss_spawn', label: '☠首领降临' });
      } else if (ev.type === 'PANTHEON_STAGE_START' || ev.type === 'PANTHEON_DUAL_BOSS') {
        this.markers.push({
          tick: curTick,
          kind: 'pantheon_stage',
          label: ev.type === 'PANTHEON_DUAL_BOSS' ? '⚔双神合击' : `🏛第${ev.stage}殿`,
        });
      } else if (ev.type === 'OVERLIMIT_NIRVANA_BURST') {
        this.markers.push({ tick: curTick, kind: 'execution', label: '☀️终极奥义' });
      } else if (ev.type === 'NEMESIS_DEFEAT') {
        this.markers.push({ tick: curTick, kind: 'part_break', label: '🐺击退猎犬' });
      } else if (ev.type === 'REACTOR_PULSE_WALL') {
        this.markers.push({ tick: curTick, kind: 'reactor_wall', label: '⚛脉冲清场' });
      }
    }
  }

  finalize(phase: GamePhase, finalSquad: number, kills: number): DeterministicReplayLog {
    return {
      version: 1,
      sector: this.sector,
      seed: this.seed,
      totalTicks: this.tick,
      modifiers: {
        ...this.modifiers,
        mutators: this.modifiers.mutators ? [...this.modifiers.mutators] : undefined,
        equippedChips: this.modifiers.equippedChips ? [...this.modifiers.equippedChips] : undefined,
      },
      keyframes: this.keyframes.slice(),
      markers: this.markers.slice(),
      expectedPhase: phase,
      expectedFinalSquad: finalSquad,
      expectedKills: kills,
    };
  }
}

export class ReplayPlayer {
  readonly log: DeterministicReplayLog;
  private tick = 0;
  private cursor = 0;
  private curKx = 0;

  constructor(log: DeterministicReplayLog) {
    this.log = log;
  }

  get currentTick(): number {
    return this.tick;
  }

  get progress(): number {
    return this.log.totalTicks > 0 ? Math.min(1, this.tick / this.log.totalTicks) : 1;
  }

  get isFinished(): boolean {
    return this.tick >= this.log.totalTicks;
  }

  resetCursor(): void {
    this.tick = 0;
    this.cursor = 0;
    this.curKx = 0;
  }

  consumePendingProtocols(): EndlessUpgradeId[] {
    const out: EndlessUpgradeId[] = [];
    while (
      this.cursor < this.log.keyframes.length &&
      this.log.keyframes[this.cursor]!.t === this.tick &&
      this.log.keyframes[this.cursor]!.protocol !== undefined
    ) {
      out.push(this.log.keyframes[this.cursor]!.protocol!);
      this.cursor += 1;
    }
    return out;
  }

  nextInput(): InputSample {
    let dx = 0;
    let flags = 0;
    while (
      this.cursor < this.log.keyframes.length &&
      this.log.keyframes[this.cursor]!.t === this.tick &&
      this.log.keyframes[this.cursor]!.protocol === undefined
    ) {
      const kf = this.log.keyframes[this.cursor]!;
      dx = kf.dx ?? 0;
      if (kf.kx !== undefined) {
        this.curKx = kf.kx;
      }
      flags = kf.flags ?? 0;
      this.cursor += 1;
    }
    this.tick += 1;
    return {
      dragDeltaX: dx,
      keyAxisX: this.curKx,
      overdrive: (flags & 1) !== 0,
      aegisPulse: (flags & 2) !== 0,
      nukeStrike: (flags & 4) !== 0,
      swapWeapon: (flags & 8) !== 0,
      cycleWingman: (flags & 16) !== 0,
      nirvanaBurst: (flags & 32) !== 0,
      skyJump: (flags & 64) !== 0,
    };
  }

  /** Deterministically seeks a live SimWorld to `targetTick` (`0..totalTicks`) in milliseconds */
  seekToWorldTick(world: SimWorld, targetTick: number): void {
    const clampedTarget = Math.max(0, Math.min(this.log.totalTicks, Math.floor(targetTick)));
    resetSimWorldForSector(world, this.log.sector, {
      ...this.log.modifiers,
      layoutSeed: this.log.seed,
    });
    this.resetCursor();
    while (this.tick < clampedTarget && !this.isFinished) {
      const prots = this.consumePendingProtocols();
      for (const pid of prots) {
        if (chooseEndlessUpgrade(world, pid)) {
          reconcileFormationAndDps(world);
        }
      }
      if (world.phase !== 'PLAYING') break;
      stepWorldFixed(world, this.nextInput());
    }
    reconcileFormationAndDps(world);
  }
}

export interface ReplayVerifyResult {
  matched: boolean;
  simulatedTicks: number;
  actualPhase: GamePhase;
  actualFinalSquad: number;
  actualKills: number;
}

export function verifyDeterministicReplay(log: DeterministicReplayLog): ReplayVerifyResult {
  const world = createSimWorld();
  resetSimWorldForSector(world, log.sector, {
    ...log.modifiers,
    layoutSeed: log.seed,
  });
  const player = new ReplayPlayer(log);
  let simulatedTicks = 0;
  while (!player.isFinished) {
    const prots = player.consumePendingProtocols();
    for (const pid of prots) {
      if (chooseEndlessUpgrade(world, pid)) {
        reconcileFormationAndDps(world);
      }
    }
    if (world.phase !== 'PLAYING') break;
    const inp = player.nextInput();
    stepWorldFixed(world, inp);
    simulatedTicks += 1;
  }
  const matched =
    world.phase === log.expectedPhase &&
    world.squadCount === log.expectedFinalSquad &&
    world.stats.kills === log.expectedKills;
  return {
    matched,
    simulatedTicks,
    actualPhase: world.phase,
    actualFinalSquad: world.squadCount,
    actualKills: world.stats.kills,
  };
}
