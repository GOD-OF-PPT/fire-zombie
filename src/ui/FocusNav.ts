/**
 * V22 Stage 4: Console/PC AAA Spatial UI Focus Navigator & Dynamic Input Prompt Switcher
 * Enables 100% seamless Gamepad D-Pad / Left Stick + A/B/LB/RB and Keyboard Arrow / Enter / Escape
 * navigation across Title Screen, Abyssal Pact Drawer, Workshop, Controls, 3D Holo-Codex, Pause & Result screens!
 */

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input[type="range"]:not([disabled]), .holo-pick';

export class SpatialFocusNavigator {
  private focusedEl: HTMLElement | null = null;
  private lastStickMoveAt = 0;
  private prevButtons: boolean[] = [];
  public inputMode: 'kb' | 'gamepad' = 'kb';
  public onModeChange: ((mode: 'kb' | 'gamepad') => void) | null = null;
  public onBack: (() => void) | null = null;

  constructor(private readonly uiRoot: HTMLElement) {
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    window.addEventListener('pointerdown', () => {
      if (this.focusedEl) {
        this.focusedEl.classList.remove('ui-focus-ring');
        this.focusedEl = null;
      }
      this.setMode('kb');
    });
  }

  setMode(mode: 'kb' | 'gamepad'): void {
    if (this.inputMode === mode) return;
    this.inputMode = mode;
    this.uiRoot.dataset.inputMode = mode;
    this.onModeChange?.(mode);
  }

  getFocusedElement(): HTMLElement | null {
    return this.focusedEl;
  }

  private findActiveContainer(): HTMLElement | null {
    // Priority: topmost visible modal -> replay/range deck -> title screen
    const modals = [
      '.ranking-name-screen.show',
      '.ranking-screen.show',
      '.editor-screen.show',
      '.expedition-screen.show',
      '.abyssal-screen.show',
      '.controls-screen.show',
      '.workshop-screen.show',
      '.codex-screen.show',
      '.help-screen.show',
      '.pause-screen.show',
      '.result-screen.show',
      '.protocol-screen.show',
      '.title-screen.show',
    ];
    for (const sel of modals) {
      const el = this.uiRoot.querySelector<HTMLElement>(sel);
      if (el) return el;
    }
    return null;
  }

  private getCandidates(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8 && getComputedStyle(el).visibility !== 'hidden';
    });
  }

  ensureFocus(): HTMLElement | null {
    const container = this.findActiveContainer();
    if (!container) {
      this.clearFocus();
      return null;
    }
    const candidates = this.getCandidates(container);
    if (candidates.length === 0) {
      this.clearFocus();
      return null;
    }
    if (!this.focusedEl || !container.contains(this.focusedEl) || !candidates.includes(this.focusedEl)) {
      const preferred =
        container.querySelector<HTMLElement>('.start-btn, [data-testid="resume-btn"], [data-testid="retry-btn"]') ??
        candidates[0]!;
      this.setFocus(preferred);
    }
    return this.focusedEl;
  }

  setFocus(el: HTMLElement | null): void {
    if (this.focusedEl && this.focusedEl !== el) {
      this.focusedEl.classList.remove('ui-focus-ring');
    }
    this.focusedEl = el;
    if (el) {
      el.classList.add('ui-focus-ring');
      try {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch {
        /* ignore */
      }
    }
  }

  clearFocus(): void {
    if (this.focusedEl) {
      this.focusedEl.classList.remove('ui-focus-ring');
      this.focusedEl = null;
    }
  }

  moveFocus(dirX: -1 | 0 | 1, dirY: -1 | 0 | 1): boolean {
    const container = this.findActiveContainer();
    if (!container) return false;
    const candidates = this.getCandidates(container);
    if (candidates.length === 0) return false;

    const cur = this.ensureFocus();
    if (!cur) return false;

    // Range input horizontal adjustment via Left/Right!
    if (cur instanceof HTMLInputElement && cur.type === 'range' && dirX !== 0 && dirY === 0) {
      const min = Number(cur.min || 0);
      const max = Number(cur.max || 100);
      const step = Number(cur.step || 5) || 5;
      const next = Math.max(min, Math.min(max, Number(cur.value || 0) + dirX * step));
      cur.value = String(next);
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    const cr = cur.getBoundingClientRect();
    const cx = cr.left + cr.width * 0.5;
    const cy = cr.top + cr.height * 0.5;

    let best: HTMLElement | null = null;
    let bestScore = Infinity;

    for (const cand of candidates) {
      if (cand === cur) continue;
      const r = cand.getBoundingClientRect();
      const tx = r.left + r.width * 0.5;
      const ty = r.top + r.height * 0.5;
      const dx = tx - cx;
      const dy = ty - cy;

      if (dirX !== 0 && dx * dirX <= 4) continue;
      if (dirY !== 0 && dy * dirY <= 4) continue;

      const primary = dirX !== 0 ? Math.abs(dx) : Math.abs(dy);
      const ortho = dirX !== 0 ? Math.abs(dy) : Math.abs(dx);
      const score = primary + ortho * 2.65;
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    if (!best) {
      // Fallback linear cycle so no control is ever unreachable
      const idx = candidates.indexOf(cur);
      const step = dirX > 0 || dirY > 0 ? 1 : -1;
      best = candidates[(idx + step + candidates.length) % candidates.length] ?? null;
    }

    if (best) {
      this.setFocus(best);
      return true;
    }
    return false;
  }

  activateFocused(): boolean {
    const cur = this.ensureFocus();
    if (!cur) return false;
    cur.click();
    return true;
  }

  cycleTabs(delta: -1 | 1): boolean {
    const container = this.findActiveContainer();
    if (!container) return false;
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('.codex-tab'));
    if (tabs.length < 2) return false;
    const curIdx = Math.max(0, tabs.findIndex((t) => t.classList.contains('on')));
    const nextTab = tabs[(curIdx + delta + tabs.length) % tabs.length]!;
    nextTab.click();
    this.setFocus(nextTab);
    return true;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input:not([type=range]), textarea, select'))) return;
    const container = this.findActiveContainer();
    if (!container) return;
    if (document.querySelector('.bind-btn.listening')) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.setMode('kb');
      this.moveFocus(0, -1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.setMode('kb');
      this.moveFocus(0, 1);
    } else if (e.key === 'ArrowLeft') {
      if (this.focusedEl || !container.classList.contains('title-screen')) {
        e.preventDefault();
        this.setMode('kb');
        this.moveFocus(-1, 0);
      }
    } else if (e.key === 'ArrowRight') {
      if (this.focusedEl || !container.classList.contains('title-screen')) {
        e.preventDefault();
        this.setMode('kb');
        this.moveFocus(1, 0);
      }
    } else if (e.key === 'Enter' && this.focusedEl) {
      e.preventDefault();
      this.activateFocused();
    } else if (e.key === 'Escape' && !container.classList.contains('title-screen')) {
      this.onBack?.();
    }
  }

  /** Polls Gamepad menu navigation when a modal or Title Screen is open */
  pollGamepadMenu(nowMs: number): void {
    let pad: Gamepad | null = null;
    try {
      const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : null;
      if (pads) {
        for (let i = 0; i < pads.length; i++) {
          if (pads[i]?.connected) {
            pad = pads[i]!;
            break;
          }
        }
      }
    } catch {
      return;
    }
    if (!pad) return;

    const container = this.findActiveContainer();
    const anyPressed = pad.buttons.some((b) => b?.pressed) || Math.abs(pad.axes[0] ?? 0) > 0.35 || Math.abs(pad.axes[1] ?? 0) > 0.35;
    if (anyPressed) this.setMode('gamepad');
    if (!container) {
      this.prevButtons = pad.buttons.map((b) => Boolean(b?.pressed));
      return;
    }

    const justPressed = (idx: number): boolean => Boolean(pad!.buttons[idx]?.pressed) && !this.prevButtons[idx];
    const axX = pad.axes[0] ?? 0;
    const axY = pad.axes[1] ?? 0;

    if (justPressed(12) || (axY < -0.55 && nowMs - this.lastStickMoveAt > 190)) {
      this.lastStickMoveAt = nowMs;
      this.moveFocus(0, -1);
    } else if (justPressed(13) || (axY > 0.55 && nowMs - this.lastStickMoveAt > 190)) {
      this.lastStickMoveAt = nowMs;
      this.moveFocus(0, 1);
    } else if (justPressed(14) || (axX < -0.55 && nowMs - this.lastStickMoveAt > 190)) {
      this.lastStickMoveAt = nowMs;
      this.moveFocus(-1, 0);
    } else if (justPressed(15) || (axX > 0.55 && nowMs - this.lastStickMoveAt > 190)) {
      this.lastStickMoveAt = nowMs;
      this.moveFocus(1, 0);
    } else if (justPressed(0)) {
      this.activateFocused();
    } else if (justPressed(1)) {
      this.onBack?.();
    } else if (justPressed(4)) {
      this.cycleTabs(-1);
    } else if (justPressed(5)) {
      this.cycleTabs(1);
    }

    this.prevButtons = pad.buttons.map((b) => Boolean(b?.pressed));
  }

  pollGamepad(): void {
    this.pollGamepadMenu(performance.now());
  }

  attach(): void {
    // Listeners already bound in constructor; kept for explicit lifecycle parity.
  }
}
