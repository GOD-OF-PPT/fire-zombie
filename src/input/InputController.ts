/**
 * Unified lateral input: touch / mouse drag (relative, 1:1 finger follow) + keyboard axis.
 * Drag deltas are accumulated in world units and consumed once per rendered frame.
 */
export class InputController {
  private dragAccum = 0;
  private activePointer: number | null = null;
  private lastX = 0;
  private keys = new Set<string>();
  private overdriveRequested = false;
  /** world units per CSS pixel; updated on resize */
  private unitsPerPx = 0.03;
  private listeners: Array<() => void> = [];
  onFirstInput: (() => void) | null = null;
  onPauseKey: (() => void) | null = null;
  enabled = true;

  constructor(private readonly surface: HTMLElement) {
    const down = (e: PointerEvent): void => {
      if (!this.enabled) return;
      if ((e.target as HTMLElement | null)?.closest('[data-ui-block]')) return;
      this.activePointer = e.pointerId;
      this.lastX = e.clientX;
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
      }
    };
    const up = (e: PointerEvent): void => {
      if (this.activePointer === e.pointerId) {
        this.activePointer = null;
      }
    };
    const keydown = (e: KeyboardEvent): void => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'a' || k === 'd' || k === 'A' || k === 'D') {
        this.keys.add(k.toLowerCase());
        e.preventDefault();
        if (this.enabled) this.fireFirst();
      } else if (k === ' ') {
        if (this.enabled) {
          this.overdriveRequested = true;
          e.preventDefault();
        }
      } else if (k === 'Escape' || k === 'p' || k === 'P') {
        this.onPauseKey?.();
      }
    };
    const keyup = (e: KeyboardEvent): void => {
      this.keys.delete(e.key.toLowerCase());
    };
    const blur = (): void => {
      this.keys.clear();
      this.activePointer = null;
    };

    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', up);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    this.listeners.push(
      () => surface.removeEventListener('pointerdown', down),
      () => surface.removeEventListener('pointermove', move),
      () => surface.removeEventListener('pointerup', up),
      () => surface.removeEventListener('pointercancel', up),
      () => window.removeEventListener('keydown', keydown),
      () => window.removeEventListener('keyup', keyup),
      () => window.removeEventListener('blur', blur),
    );
  }

  private fireFirst(): void {
    if (this.onFirstInput) {
      const cb = this.onFirstInput;
      this.onFirstInput = null;
      cb();
    }
  }

  setScale(surfaceWidthPx: number, visibleWorldWidth: number): void {
    // Slightly > 1:1 so a thumb sweep across ~70% of the screen crosses the whole track.
    this.unitsPerPx = (visibleWorldWidth / Math.max(1, surfaceWidthPx)) * 1.25;
  }

  get keyAxis(): number {
    let a = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) a -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) a += 1;
    return a;
  }

  requestOverdrive(): void {
    if (this.enabled) this.overdriveRequested = true;
  }

  consumeOverdrive(): boolean {
    const requested = this.overdriveRequested;
    this.overdriveRequested = false;
    return requested;
  }

  consumeDrag(): number {
    const d = this.dragAccum;
    this.dragAccum = 0;
    return d;
  }

  reset(): void {
    this.dragAccum = 0;
    this.overdriveRequested = false;
    this.keys.clear();
  }

  dispose(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
  }
}
