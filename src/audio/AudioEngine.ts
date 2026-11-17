import type { SectorId } from '../types/game';

type Wave = OscillatorType;

/**
 * V2 Multi-Track Procedural Synthwave Audio Engine:
 * - Synthesized tactical SFX (weapons, crits, phase aegis shock-shield, gate pentatonics, achievements)
 * - 8-bar look-ahead step sequencer with sector-specific harmonic progressions, punchy bass,
 *   arpeggiator, Fever percussion ride, and Boss Phase lead melody.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  private lastPlay = new Map<string, number>();

  private seqTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private tempo = 122;
  private musicSector: SectorId = 1;
  private intensity: 0 | 1 | 2 = 0; // 0 calm/title, 1 run, 2 boss
  private feverHot = false;

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
    }
  }

  setFever(hot: boolean): void {
    this.feverHot = hot;
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.82;
      this.sfx.connect(this.master);
      this.music = this.ctx.createGain();
      this.music.gain.value = 0.34;
      this.music.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private throttle(key: string, minGap: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(key) ?? -1;
    if (now - last < minGap) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private tone(
    freq: number,
    dur: number,
    opts: { type?: Wave; vol?: number; slideTo?: number; attack?: number; when?: number; dest?: AudioNode } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t0 = opts.when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + dur);
    const vol = opts.vol ?? 0.2;
    const atk = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(opts.dest ?? this.sfx);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(
    dur: number,
    opts: { vol?: number; freq?: number; q?: number; type?: BiquadFilterType; when?: number; slideTo?: number; dest?: AudioNode } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.noiseBuf) return;
    const t0 = opts.when ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'lowpass';
    f.frequency.setValueAtTime(opts.freq ?? 1200, t0);
    if (opts.slideTo) f.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.vol ?? 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(opts.dest ?? this.sfx);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  // ---------------------------------------------------------------- SFX
  shoot(weapon: string): void {
    if (!this.throttle('shoot', 0.048)) return;
    switch (weapon) {
      case 'scatter':
        this.noise(0.06, { vol: 0.055, freq: 3400, type: 'bandpass', q: 1.2 });
        break;
      case 'rail':
        this.tone(1480, 0.12, { type: 'sawtooth', vol: 0.048, slideTo: 290 });
        break;
      case 'plasma':
        this.tone(230, 0.14, { type: 'triangle', vol: 0.085, slideTo: 85 });
        break;
      case 'cryo':
        this.tone(1950, 0.065, { type: 'sine', vol: 0.045, slideTo: 1220 });
        break;
      default:
        this.tone(900 + Math.random() * 60, 0.045, { type: 'square', vol: 0.026, slideTo: 520 });
    }
  }

  hit(combo = 0): void {
    if (!this.throttle('hit', 0.042)) return;
    const climb = Math.min(180, combo * 4.5);
    // Low-end physical body thump + crisp high transient crunch!
    this.tone(148 + climb * 0.35, 0.052, { type: 'triangle', vol: 0.065, slideTo: 54 });
    this.noise(0.032, { vol: 0.042, freq: 2800 + climb * 6, type: 'bandpass', q: 1.4 });
  }

  chainArc(): void {
    if (!this.throttle('arc', 0.09)) return;
    this.noise(0.09, { vol: 0.09, freq: 4200, slideTo: 1600, type: 'bandpass', q: 2.8 });
    this.tone(1320 + Math.random() * 260, 0.085, { type: 'sawtooth', vol: 0.055, slideTo: 620 });
  }

  crit(): void {
    if (!this.throttle('crit', 0.085)) return;
    this.tone(1568, 0.09, { type: 'triangle', vol: 0.085, slideTo: 2349 });
    this.tone(2093, 0.07, { type: 'sine', vol: 0.06 });
  }

  aegisPulse(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(0.45, { vol: 0.18, freq: 650, slideTo: 5600, type: 'bandpass', q: 2.2 });
    [392, 587.33, 783.99, 1174.66].forEach((f, i) =>
      this.tone(f, 0.24, { type: 'triangle', vol: 0.09, when: t + i * 0.032 }),
    );
    this.tone(110, 0.35, { type: 'sine', vol: 0.22, slideTo: 48 });
  }

  achievement(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5, 1567.98].forEach((f, i) =>
      this.tone(f, 0.28, { type: 'triangle', vol: 0.11, when: t + i * 0.065 }),
    );
  }

  kill(big: boolean, combo = 0): void {
    if (!this.throttle(big ? 'killbig' : 'kill', big ? 0.055 : 0.03)) return;
    const pitchMult = Math.pow(2, Math.min(14, combo * 0.35) / 12);
    if (big) {
      this.noise(0.35, { vol: 0.28, freq: 950, slideTo: 110 });
      this.tone(175, 0.3, { type: 'triangle', vol: 0.22, slideTo: 48 });
      this.tone(523.25 * pitchMult, 0.14, { type: 'triangle', vol: 0.09, slideTo: 784 * pitchMult });
    } else {
      this.tone(125, 0.065, { type: 'sine', vol: 0.085, slideTo: 52 });
      this.tone((587 + Math.random() * 60) * pitchMult, 0.085, {
        type: 'triangle',
        vol: 0.095,
        slideTo: 1174 * pitchMult,
      });
      this.noise(0.055, { vol: 0.065, freq: 3100, type: 'highpass' });
    }
  }

  gateTick(value: number): void {
    if (!this.throttle('gatetick', 0.06)) return;
    const scale = [0, 2, 4, 7, 9];
    const idx = Math.max(0, Math.min(24, value + 10));
    const semis = Math.floor(idx / 5) * 12 + (scale[idx % 5] ?? 0);
    const f = 330 * Math.pow(2, semis / 12);
    this.tone(f, 0.07, { type: 'sine', vol: 0.09 });
  }

  gateFlip(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this.tone(f, 0.22, { type: 'triangle', vol: 0.13, when: t + i * 0.055 }),
    );
  }

  gatePass(good: boolean, magnitude: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (good) {
      const n = Math.min(5, 2 + Math.floor(magnitude / 8));
      for (let i = 0; i < n; i++) this.tone(587 * Math.pow(2, (i * 4) / 12), 0.16, { type: 'square', vol: 0.07, when: t + i * 0.045 });
      this.noise(0.25, { vol: 0.08, freq: 6000, type: 'highpass' });
    } else {
      this.tone(220, 0.35, { type: 'sawtooth', vol: 0.14, slideTo: 80 });
      this.tone(233, 0.35, { type: 'sawtooth', vol: 0.1, slideTo: 85 });
    }
  }

  vaultHit(): void {
    if (!this.throttle('vaulthit', 0.07)) return;
    this.tone(1250 + Math.random() * 300, 0.05, { type: 'sine', vol: 0.05 });
  }

  powerUp(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(0.4, { vol: 0.12, freq: 400, slideTo: 8000, type: 'bandpass', q: 2 });
    [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      this.tone(f, 0.25, { type: 'square', vol: 0.07, when: t + 0.05 + i * 0.05 }),
    );
  }

  explosion(chain: number): void {
    if (!this.throttle('boom', 0.05)) return;
    const pitch = 1 + Math.min(chain, 6) * 0.08;
    this.noise(0.6, { vol: 0.42, freq: 1400 * pitch, slideTo: 90 });
    this.tone(110 * pitch, 0.45, { type: 'sine', vol: 0.35, slideTo: 35 });
  }

  lens(): void {
    if (!this.throttle('lens', 0.18)) return;
    this.tone(1760, 0.1, { type: 'sine', vol: 0.04, slideTo: 2600 });
  }

  overdrive(): void {
    if (!this.ctx) return;
    this.noise(0.8, { vol: 0.15, freq: 300, slideTo: 9000, type: 'bandpass', q: 3 });
    this.tone(220, 0.8, { type: 'sawtooth', vol: 0.09, slideTo: 880 });
  }

  loss(amount: number): void {
    if (!this.throttle('loss', 0.08)) return;
    this.tone(140, 0.22, { type: 'square', vol: Math.min(0.22, 0.08 + amount * 0.01), slideTo: 60 });
    this.noise(0.15, { vol: 0.12, freq: 700 });
  }

  bossWarning(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      this.tone(440, 0.32, { type: 'sawtooth', vol: 0.12, slideTo: 330, when: t + i * 0.42 });
    }
    this.tone(55, 1.6, { type: 'sine', vol: 0.3, attack: 0.3, when: t });
  }

  hazardCharge(): void {
    if (!this.throttle('hazard', 0.4)) return;
    this.tone(300, 0.5, { type: 'sawtooth', vol: 0.05, slideTo: 900 });
  }

  bossPhase(): void {
    if (!this.ctx) return;
    this.explosion(2);
    this.tone(98, 0.9, { type: 'sawtooth', vol: 0.15, slideTo: 49 });
  }

  bossDefeat(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      this.noise(0.7, { vol: 0.35, freq: 1600 - i * 150, slideTo: 80, when: t + i * 0.16 });
      this.tone(120 - i * 8, 0.5, { type: 'sine', vol: 0.3, slideTo: 30, when: t + i * 0.16 });
    }
  }

  victory(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.1;
    const seq = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
    seq.forEach((f, i) => this.tone(f, i === seq.length - 1 ? 0.8 : 0.16, { type: 'square', vol: 0.09, when: t + i * 0.11 }));
    [261.63, 329.63, 392].forEach((f) => this.tone(f, 1.2, { type: 'triangle', vol: 0.08, when: t + 0.66, attack: 0.02 }));
  }

  defeat(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [392, 349.23, 311.13, 261.63].forEach((f, i) =>
      this.tone(f, 0.4, { type: 'triangle', vol: 0.11, when: t + i * 0.22, slideTo: f * 0.97 }),
    );
  }

  star(i: number): void {
    this.tone(880 * Math.pow(2, (i * 4) / 12), 0.3, { type: 'square', vol: 0.08 });
    this.tone(1760 * Math.pow(2, (i * 4) / 12), 0.2, { type: 'sine', vol: 0.05 });
  }

  click(): void {
    this.tone(1200, 0.04, { type: 'square', vol: 0.05, slideTo: 900 });
  }

  // ---------------------------------------------------------------- Music
  setMusic(sector: SectorId, intensity: 0 | 1 | 2): void {
    this.musicSector = sector;
    this.intensity = intensity;
    this.tempo = intensity === 2 ? 144 : [0, 116, 124, 132, 128][sector] ?? 122;
    if (!this.ctx) return;
    if (this.seqTimer === null) {
      this.nextNoteTime = this.ctx.currentTime + 0.05;
      this.step = 0;
      this.seqTimer = window.setInterval(() => this.schedule(), 25);
    }
  }

  stopMusic(): void {
    if (this.seqTimer !== null) {
      clearInterval(this.seqTimer);
      this.seqTimer = null;
    }
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.music || ctx.state !== 'running') return;
    const spb = 60 / this.tempo / 4; // 16th notes
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextNoteTime, spb);
      this.nextNoteTime += spb;
      this.step = (this.step + 1) % 128;
    }
  }

  private playStep(step: number, t: number, spb: number): void {
    const dest = this.music!;
    const roots: Record<SectorId, number[]> = {
      1: [0, 0, -4, -2, 0, -5, -4, -2],
      2: [0, -2, -4, -5, 3, 0, -2, -5],
      3: [0, 1, -2, -4, 0, 1, 3, -2],
      4: [0, -5, -2, -7, 0, -4, 3, -2],
    };
    const baseFreq = [0, 110, 98, 92.5, 103.8][this.musicSector] ?? 110;
    const bar = Math.floor(step / 16) % 8;
    const root = roots[this.musicSector][bar] ?? 0;
    const s = step % 16;
    const f = (semi: number): number => baseFreq * Math.pow(2, (root + semi) / 12);

    // 1. Punchy Four-on-the-Floor Synthwave Kick
    if (this.intensity > 0 && s % 4 === 0) {
      this.tone(155, 0.17, { type: 'sine', vol: 0.48, slideTo: 38, when: t, dest });
    }
    // 2. Crisp Hi-Hats & Fever Ride Shimmer
    if (this.intensity > 0 && (s % 2 === 1 || (this.feverHot && s % 2 === 0))) {
      const accentHat = s % 4 === 2;
      this.noise(accentHat ? 0.055 : 0.032, {
        vol: this.intensity === 2 ? 0.11 : this.feverHot ? 0.085 : 0.065,
        freq: accentHat ? 7200 : 9200,
        type: 'highpass',
        when: t,
        dest,
      });
    }
    // 3. Snare / Clap on 2 and 4 during Run (soft) and Boss (punchy)
    if (this.intensity > 0 && s % 8 === 4) {
      this.noise(this.intensity === 2 ? 0.15 : 0.09, {
        vol: this.intensity === 2 ? 0.22 : 0.1,
        freq: 1850,
        type: 'bandpass',
        q: 0.75,
        when: t,
        dest,
      });
    }
    // 4. Driving 16th-note Synthwave Octave Bass
    if (this.intensity === 0 ? s % 4 === 0 : s % 2 === 0 || this.intensity === 2) {
      const octUp = s % 4 === 2 ? 12 : 0;
      this.tone(f(octUp) / 2, spb * 1.45, {
        type: 'sawtooth',
        vol: this.intensity === 0 ? 0.075 : s % 4 === 0 ? 0.09 : 0.13,
        when: t,
        dest,
      });
    }
    // 5. Shimmering Cyber-Arpeggiator
    const arpPatterns: Record<SectorId, number[]> = {
      1: [0, 7, 12, 15, 12, 7, 3, 7],
      2: [0, 3, 7, 10, 15, 10, 7, 3],
      3: [0, 1, 7, 12, 13, 12, 7, 1],
      4: [0, 7, 10, 14, 19, 14, 10, 7],
    };
    const arp = arpPatterns[this.musicSector];
    if (this.intensity === 0 ? s % 4 === 0 : true) {
      const semi = arp[s % 8] ?? 0;
      this.tone(f(semi) * 2, spb * 0.88, {
        type: 'triangle',
        vol: this.intensity === 2 ? 0.055 : 0.042,
        when: t,
        dest,
      });
    }
    // 6. Boss / Fever Heroic Lead Hook
    if ((this.intensity === 2 || this.feverHot) && (s === 0 || s === 3 || s === 6 || s === 10 || s === 12)) {
      const leadNotes: Record<number, number> = { 0: 12, 3: 15, 6: 19, 10: 17, 12: 15 };
      const semi = leadNotes[s] ?? 12;
      this.tone(f(semi) * 2, spb * 2.4, {
        type: 'sawtooth',
        vol: this.intensity === 2 ? 0.045 : 0.028,
        attack: 0.012,
        when: t,
        dest,
      });
    }
    // 7. Warm lush triad pad on bar start
    if (s === 0) {
      [0, 3, 7, 12].forEach((semi) =>
        this.tone(f(semi) * 2, spb * 15.5, {
          type: 'triangle',
          vol: 0.032,
          attack: 0.22,
          when: t,
          dest,
        }),
      );
    }
  }
}
