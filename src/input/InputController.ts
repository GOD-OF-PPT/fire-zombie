/**
 * Unified console/PC + mobile input controller:
 *  - Touch / mouse 1:1 drag + mobile upward-flick [Aegis] & double-tap [Overdrive]
 *  - Rebindable Keyboard controls (`KeybindMap`)
 *  - Plug-and-play Standard Gamepad (`navigator.getGamepads()`) with analog deadzone, D-Pad & shoulder buttons
 *  - Dual-Motor Haptic Rumble (`vibrationActuator.playEffect('dual-rumble', ...)`)
 */
import { DEFAULT_KEYBINDS, type KeybindAction, type KeybindMap } from '../types/game';
export { DEFAULT_KEYBINDS, type KeybindAction, type KeybindMap };

export function formatKeyLabel(key: string): string {
  if (key === ' ' || key === 'Spacebar') return '空格';
  if (key === 'Tab') return 'Tab';
  if (key === 'Shift') return 'Shift';
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowRight') return '→';
  return key.length === 1 ? key.toUpperCase() : key;
}

export class InputController {
  private dragAccum = 0;
  private activePointer: number | null = null;
  private lastX = 0;
  private downX = 0;
  private downY = 0;
  private downTime = 0;
  private maxTravel = 0;
  private flickFired = false;
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private keys = new Set<string>();
  private overdriveRequested = false;
  private aegisRequested = false;
  private nukeRequested = false;
  private swapWeaponRequested = false;
  private wingmanCycleRequested = false;
  private nirvanaRequested = false;
  private keybinds: KeybindMap = { ...DEFAULT_KEYBINDS };
  private captureCallback: ((key: string) => void) | null = null;

  // Gamepad state & haptics telemetry
  private prevPadButtons: boolean[] = [];
  private gamepadAxisX = 0;
  private connectedPadName = '';
  public lastRumble: { strong: number; weak: number; durationMs: number } | null = null;

  /** world units per CSS pixel; updated on resize */
  private unitsPerPx = 0.03;
  private listeners: Array<() => void> = [];
  onFirstInput: (() => void) | null = null;
  onPauseKey: (() => void) | null = null;
  onPhotoModeKey: (() => void) | null = null;
  onSpeedKey: (() => void) | null = null;
  onGamepadChange: ((connected: boolean, id: string) => void) | null = null;
  enabled = true;

  constructor(private readonly surface: HTMLElement) {
    const down = (e: PointerEvent): void => {
      if (!this.enabled) return;
      if ((e.target as HTMLElement | null)?.closest('[data-ui-block]')) return;
      this.activePointer = e.pointerId;
      this.lastX = e.clientX;
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.downTime = performance.now();
      this.maxTravel = 0;
      this.flickFired = false;
      try {
        surface.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.fireFirst();
    };
    const move = (e: PointerEvent): void => {
      if (this.activePointer !== e.pointerId) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      if (this.enabled) {
        this.dragAccum += dx * this.unitsPerPx;
        if (Math.abs(dx) > 0) this.fireFirst();

        const totalDx = e.clientX - this.downX;
        const totalDy = e.clientY - this.downY;
        const dist = Math.hypot(totalDx, totalDy);
        if (dist > this.maxTravel) this.maxTravel = dist;

        const elapsed = performance.now() - this.downTime;
        if (!this.flickFired && elapsed <= 240 && totalDy <= -42 && Math.abs(totalDy) > Math.abs(totalDx) * 1.35) {
          this.flickFired = true;
          this.aegisRequested = true;
        }
      }
    };
    const up = (e: PointerEvent): void => {
      if (this.activePointer === e.pointerId) {
        const now = performance.now();
        const tapDur = now - this.downTime;
        if (this.enabled && !this.flickFired && tapDur <= 240 && this.maxTravel <= 24) {
          if (
            now - this.lastTapTime <= 280 &&
            Math.hypot(e.clientX - this.lastTapX, e.clientY - this.lastTapY) <= 38
          ) {
            this.overdriveRequested = true;
            this.lastTapTime = 0;
          } else {
            this.lastTapTime = now;
            this.lastTapX = e.clientX;
            this.lastTapY = e.clientY;
          }
        }
        this.activePointer = null;
      }
    };

    const matchesBind = (e: KeyboardEvent, bindKey: string): boolean => {
      if (!bindKey) return false;
      const pressedKey = e.key;
      if (bindKey === ' ') return pressedKey === ' ' || e.code === 'Space';
      if (pressedKey.toLowerCase() === bindKey.toLowerCase()) return true;
      if (
        (pressedKey === 'Process' || pressedKey === 'Unidentified' || e.isComposing) &&
        bindKey.length === 1 &&
        /^[a-z]$/i.test(bindKey) &&
        e.code === `Key${bindKey.toUpperCase()}`
      ) {
        return true;
      }
      return false;
    };

    const matchesChar = (e: KeyboardEvent, ch: string): boolean =>
      e.key.toLowerCase() === ch ||
      ((e.key === 'Process' || e.key === 'Unidentified' || e.isComposing) && e.code === `Key${ch.toUpperCase()}`);

    const keydown = (e: KeyboardEvent): void => {
      if (this.captureCallback) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key !== 'Escape') {
          const cb = this.captureCallback;
          this.captureCallback = null;
          cb(e.key.length === 1 && e.key !== ' ' ? e.key.toLowerCase() : e.key);
        } else {
          this.captureCallback = null;
        }
        return;
      }

      if (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input, textarea, select'))) return;
      const k = e.key;
      const isLeft = k === 'ArrowLeft' || matchesBind(e, this.keybinds.moveLeft);
      const isRight = k === 'ArrowRight' || matchesBind(e, this.keybinds.moveRight);

      if (isLeft || isRight) {
        this.keys.add(isLeft ? '__left' : '__right');
        e.preventDefault();
        if (this.enabled) this.fireFirst();
      } else if (matchesBind(e, this.keybinds.overdrive)) {
        if (this.enabled) {
          this.overdriveRequested = true;
          e.preventDefault();
          this.fireFirst();
        }
      } else if (matchesBind(e, this.keybinds.aegis) || k === 'Shift') {
        if (this.enabled && !e.repeat) {
          this.aegisRequested = true;
          this.fireFirst();
        }
      } else if (matchesBind(e, this.keybinds.nuke) || matchesChar(e, 'r')) {
        if (this.enabled && !e.repeat) {
          this.nukeRequested = true;
          this.fireFirst();
        }
      } else if ((matchesBind(e, this.keybinds.swapWeapon) || matchesChar(e, 'c')) && !e.repeat) {
        if (this.enabled) {
          e.preventDefault();
          this.swapWeaponRequested = true;
          this.fireFirst();
        }
      } else if (matchesBind(e, this.keybinds.wingmanMode) && !e.repeat) {
        if (this.enabled) {
          e.preventDefault();
          this.wingmanCycleRequested = true;
          this.fireFirst();
        }
      } else if (matchesBind(e, this.keybinds.nirvanaBurst) && !e.repeat) {
        if (this.enabled) {
          e.preventDefault();
          this.nirvanaRequested = true;
          this.fireFirst();
        }
      } else if (matchesChar(e, 'p') && !e.repeat) {
        e.preventDefault();
        if (this.onPhotoModeKey) this.onPhotoModeKey();
        else this.onPauseKey?.();
      } else if (matchesChar(e, 'x') && !e.repeat) {
        this.onSpeedKey?.();
      } else if (k === 'Escape') {
        this.onPauseKey?.();
      }
    };

    const keyup = (e: KeyboardEvent): void => {
      const k = e.key;
      if (k === 'ArrowLeft' || matchesBind(e, this.keybinds.moveLeft)) this.keys.delete('__left');
      if (k === 'ArrowRight' || matchesBind(e, this.keybinds.moveRight)) this.keys.delete('__right');
    };
    const blur = (): void => {
      this.keys.clear();
      this.activePointer = null;
      this.gamepadAxisX = 0;
    };
    const onGpConnect = (e: GamepadEvent): void => {
      this.connectedPadName = e.gamepad?.id || 'Standard Gamepad';
      this.onGamepadChange?.(true, this.connectedPadName);
    };
    const onGpDisconnect = (): void => {
      this.connectedPadName = '';
      this.gamepadAxisX = 0;
      this.onGamepadChange?.(false, '');
    };

    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', up);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    window.addEventListener('gamepadconnected', onGpConnect);
    window.addEventListener('gamepaddisconnected', onGpDisconnect);
    this.listeners.push(
      () => surface.removeEventListener('pointerdown', down),
      () => surface.removeEventListener('pointermove', move),
      () => surface.removeEventListener('pointerup', up),
      () => surface.removeEventListener('pointercancel', up),
      () => window.removeEventListener('keydown', keydown),
      () => window.removeEventListener('keyup', keyup),
      () => window.removeEventListener('blur', blur),
      () => window.removeEventListener('gamepadconnected', onGpConnect),
      () => window.removeEventListener('gamepaddisconnected', onGpDisconnect),
    );
  }

  private fireFirst(): void {
    if (this.onFirstInput) {
      const cb = this.onFirstInput;
      this.onFirstInput = null;
      cb();
    }
  }

  setKeybinds(map: Partial<KeybindMap>): void {
    this.keybinds = { ...DEFAULT_KEYBINDS, ...map };
  }

  getKeybinds(): KeybindMap {
    return { ...this.keybinds };
  }

  beginCaptureKey(cb: (key: string) => void): void {
    this.captureCallback = cb;
  }

  cancelCaptureKey(): void {
    this.captureCallback = null;
  }

  private getActiveGamepad(): Gamepad | null {
    try {
      if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
      const pads = navigator.getGamepads();
      if (!pads) return null;
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p && p.connected) return p;
      }
    } catch {
      /* ignore sandbox restrictions */
    }
    return null;
  }

  hasConnectedGamepad(): boolean {
    return Boolean(this.getActiveGamepad() || this.connectedPadName);
  }

  getConnectedGamepadName(): string {
    const p = this.getActiveGamepad();
    return p?.id || this.connectedPadName || '';
  }

  /** Polls W3C Standard Gamepad axes & buttons once per frame for 0-latency plug-and-play control */
  pollGamepad(): void {
    const pad = this.getActiveGamepad();
    if (!pad) {
      this.gamepadAxisX = 0;
      return;
    }
    if (!this.connectedPadName && pad.id) {
      this.connectedPadName = pad.id;
      this.onGamepadChange?.(true, pad.id);
    }

    // Left analog stick X (deadzone 0.14 with cubic-smooth precision curve) + D-Pad Left(14) / Right(15)
    const rawLx = pad.axes[0] ?? 0;
    const dLeft = Boolean(pad.buttons[14]?.pressed);
    const dRight = Boolean(pad.buttons[15]?.pressed);
    let ax = 0;
    if (Math.abs(rawLx) > 0.14) {
      const sign = rawLx < 0 ? -1 : 1;
      const norm = (Math.abs(rawLx) - 0.14) / 0.86;
      ax = sign * Math.min(1, norm * (0.65 + 0.35 * norm));
    }
    if (dLeft) ax -= 1;
    if (dRight) ax += 1;
    this.gamepadAxisX = Math.max(-1, Math.min(1, ax));
    if (Math.abs(this.gamepadAxisX) > 0.05 && this.enabled) {
      this.fireFirst();
    }

    const pressed = (idx: number): boolean => {
      const b = pad.buttons[idx];
      if (!b) return false;
      return b.pressed || b.value > 0.55;
    };
    const justPressed = (idx: number): boolean => {
      const cur = pressed(idx);
      const prev = this.prevPadButtons[idx] === true;
      return cur && !prev;
    };

    if (this.enabled) {
      // A (0) or RT (7) -> Overdrive
      if (justPressed(0) || justPressed(7)) {
        this.overdriveRequested = true;
        this.fireFirst();
      }
      // B (1) or LB (4) -> Phase Aegis Pulse
      if (justPressed(1) || justPressed(4)) {
        this.aegisRequested = true;
        this.fireFirst();
      }
      // Y (3) or LT (6) -> Tactical Nuke
      if (justPressed(3) || justPressed(6)) {
        this.nukeRequested = true;
        this.fireFirst();
      }
      // X (2) or RB (5) -> Swap Lead Dual-Weapon
      if (justPressed(2) || justPressed(5)) {
        this.swapWeaponRequested = true;
        this.fireFirst();
      }
      // LB (4) + RB (5) simultaneous chord OR R3 (11) -> 2nd-Order Overlimit Nirvana Burst
      if ((pressed(4) && pressed(5) && (justPressed(4) || justPressed(5))) || justPressed(11)) {
        this.nirvanaRequested = true;
        this.fireFirst();
      }
      // L3 (10) -> Cycle Tactical Drone Wingman Formation
      if (justPressed(10)) {
        this.wingmanCycleRequested = true;
        this.fireFirst();
      }
    }
    // Back/Select (8) -> Speed toggle; Start (9) -> Pause/Resume
    if (justPressed(8)) this.onSpeedKey?.();
    if (justPressed(9)) this.onPauseKey?.();

    for (let i = 0; i < pad.buttons.length; i++) {
      this.prevPadButtons[i] = pressed(i);
    }
  }

  /** Fires dual-motor controller vibration (`dual-rumble`) when supported */
  rumble(strongMagnitude: number, weakMagnitude: number, durationMs = 120): void {
    const strong = Math.max(0, Math.min(1, strongMagnitude));
    const weak = Math.max(0, Math.min(1, weakMagnitude));
    const dur = Math.max(16, Math.min(1200, Math.round(durationMs)));
    this.lastRumble = { strong, weak, durationMs: dur };
    const pad = this.getActiveGamepad() as (Gamepad & {
      vibrationActuator?: {
        playEffect?: (
          type: string,
          params: { startDelay?: number; duration: number; weakMagnitude: number; strongMagnitude: number },
        ) => Promise<unknown>;
      };
    }) | null;
    try {
      const act = pad?.vibrationActuator;
      if (act && typeof act.playEffect === 'function') {
        void act.playEffect('dual-rumble', {
          startDelay: 0,
          duration: dur,
          weakMagnitude: weak,
          strongMagnitude: strong,
        });
      }
    } catch {
      /* ignore unsupported actuator */
    }
  }

  setScale(surfaceWidthPx: number, visibleWorldWidth: number): void {
    this.unitsPerPx = (visibleWorldWidth / Math.max(1, surfaceWidthPx)) * 1.25;
  }

  get keyAxis(): number {
    let a = this.gamepadAxisX;
    if (this.keys.has('__left')) a -= 1;
    if (this.keys.has('__right')) a += 1;
    return Math.max(-1, Math.min(1, a));
  }

  requestOverdrive(): void {
    if (this.enabled) this.overdriveRequested = true;
  }

  consumeOverdrive(): boolean {
    const requested = this.overdriveRequested;
    this.overdriveRequested = false;
    return requested;
  }

  requestAegis(): void {
    if (this.enabled) {
      this.aegisRequested = true;
      this.fireFirst();
    }
  }

  consumeAegis(): boolean {
    const requested = this.aegisRequested;
    this.aegisRequested = false;
    return requested;
  }

  requestNuke(): void {
    if (this.enabled) {
      this.nukeRequested = true;
      this.fireFirst();
    }
  }

  consumeNuke(): boolean {
    const requested = this.nukeRequested;
    this.nukeRequested = false;
    return requested;
  }

  requestWeaponSwap(): void {
    if (this.enabled) {
      this.swapWeaponRequested = true;
      this.fireFirst();
    }
  }

  consumeWeaponSwap(): boolean {
    const requested = this.swapWeaponRequested;
    this.swapWeaponRequested = false;
    return requested;
  }

  requestWingmanCycle(): void {
    if (this.enabled) {
      this.wingmanCycleRequested = true;
      this.fireFirst();
    }
  }

  consumeWingmanCycle(): boolean {
    const requested = this.wingmanCycleRequested;
    this.wingmanCycleRequested = false;
    return requested;
  }

  requestNirvanaBurst(): void {
    if (this.enabled) {
      this.nirvanaRequested = true;
      this.fireFirst();
    }
  }

  consumeNirvanaBurst(): boolean {
    const requested = this.nirvanaRequested;
    this.nirvanaRequested = false;
    return requested;
  }

  consumeDrag(): number {
    const d = this.dragAccum;
    this.dragAccum = 0;
    return d;
  }

  reset(): void {
    this.dragAccum = 0;
    this.keys.clear();
    this.overdriveRequested = false;
    this.aegisRequested = false;
    this.nukeRequested = false;
    this.swapWeaponRequested = false;
    this.wingmanCycleRequested = false;
    this.nirvanaRequested = false;
    this.activePointer = null;
    this.flickFired = false;
    this.gamepadAxisX = 0;
  }

  destroy(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
  }
}
