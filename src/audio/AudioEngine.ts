import type { EnemyKind, SectorId } from '../types/game';

type Wave = OscillatorType;

export type RadioCommsTopic = 'cargo' | 'maglev' | 'boss' | 'overdrive';
export type TacticalVoxTopic =
  | 'overlimit'
  | 'reactor_exposed'
  | 'omega_overdrive'
  | 'omega_execution'
  | 'afk_lock'
  | 'capacitor';

export interface HitAudioOptions {
  weapon?: string;
  kind?: EnemyKind;
  x?: number;
  /** World Z coordinate (+6 near squad, -85 far horizon) — drives 3D air-absorption LP & canyon reverb send! */
  z?: number;
  damage?: number;
  /** Number of hits landing in the same simulation frame — drives subtle stereo volley width */
  simultaneousHits?: number;
  /** Remaining HP ratio (0..1) — drives Apex/Overwatch-style armor/chitin cracking pitch progression! */
  hpRatio?: number;
}

export type VocalCryFamily = 'swarmChitter' | 'feralSnarl' | 'wraithWail' | 'titanRoar';

type FoleyFamily =
  | 'carbineSnap'
  | 'shotgunPunch'
  | 'hitThock'
  | 'armorPing'
  | 'crystalTick'
  | 'killPop'
  | 'heavyBoom'
  | VocalCryFamily;

/**
 * V14 AAA Z-Depth 3D Spatial Acoustics, 4-Stem Vertical Synthwave & Tactical Radio Comms Engine.
 *
 * Key Upgrades over V12/V13:
 *  1) Physical Z-Depth Air-Absorption & Canyon Reverb Send (`routeSpatial(panX, worldZ, dest)`):
 *     Close hits (`z > -8m`) hit with 100% dry `8.4kHz` chest punch; mid-to-horizon events (`z = -12..-85m`)
 *     progressively roll off HF via atmospheric low-pass (`8200 -> 1640 Hz`) while feeding distance-scaled wet
 *     early reflections into `reverbSend`, creating unmistakable 3D depth down the neon highway!
 *  2) 4-Stem Adaptive Vertical Music Mixing (`stemDrums`, `stemBass`, `stemArp`, `stemPadBrass`):
 *     Independent sub-stem gain buses smoothly cross-modulate across Title (`intensity=0`), Combat Swarm Tiers
 *     (`threatTier 1..6`), Fever Overdrive (`feverHot`), and Boss Showdowns (`intensity=2` + analog brass stabs).
 *  3) Supersonic Maglev Doppler Pass (`maglevPass`) & Walkie-Talkie Bandpass Radio Comms (`radioComms`).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  public impactBus: GainNode | null = null;
  public vocalBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private music: GainNode | null = null;
  private musicDuckFilter: BiquadFilterNode | null = null;
  private overlimitActive = false;
  public stemDrums: GainNode | null = null;
  public stemBass: GainNode | null = null;
  public stemArp: GainNode | null = null;
  public stemPadBrass: GainNode | null = null;
  public stemLead: GainNode | null = null;
  public masterLimiterActive = false;
  public totalShardTicks = 0;
  private abyssalHeatTier = 0;
  private baseMusicGain = 0.24;

  private noiseBuf: AudioBuffer | null = null;
  private warmNoiseBuf: AudioBuffer | null = null;

  /** Primary bank lookup + 4-variant round-robin multi-sample pools */
  public foleyBanks: Record<string, AudioBuffer> = {};
  private rrCounters: Record<string, number> = {};

  /** Diagnostic telemetry for E2E spatial, comms & harmonized death-cry verification */
  public lastSpatialCutoffHz = 8400;
  public lastSpatialDist = 0;
  public lastCommsTopic: RadioCommsTopic | null = null;
  public hasConvolverImpulse = false;
  public totalDopplerPasses = 0;
  public lastVoxTopic: TacticalVoxTopic | null = null;
  public totalVoxPlayed = 0;
  public voxEnabled = true;
  public voxVolume = 0.85;
  public lastCryFamily: VocalCryFamily | null = null;
  public lastCryRate = 1.0;
  public totalCriesPlayed = 0;
  private activeCryEnds: number[] = [];
  private cryStepCounter = 0;

  private muted = false;
  private lastPlay = new Map<string, number>();
  private killVariant = 0;
  private hitVariant = 0;
  private shootVariant = 0;
  private recentKillTimes: number[] = [];
  private rapidVoiceTimes: number[] = [];

  private seqTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private tempo = 122;
  private musicSector: SectorId = 1;
  private intensity: 0 | 1 | 2 = 0;
  private threatTier = 1;
  private feverHot = false;
  private bossPhaseState = 0;
  private bossBrokenState = false;

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.92, this.ctx.currentTime, 0.03);
    }
  }

  setFever(hot: boolean): void {
    if (this.feverHot === hot) return;
    this.feverHot = hot;
    this.syncMusicStems();
  }

  setOverlimit(active: boolean): void {
    if (this.overlimitActive === active) return;
    this.overlimitActive = active;
    this.syncMusicStems();
  }

  setThreatTier(tier: number): void {
    const clamped = Math.max(1, Math.min(6, Math.round(tier || 1)));
    if (this.threatTier === clamped) return;
    this.threatTier = clamped;
    this.syncMusicStems();
  }

  private bossOmegaActive = false;
  private pantheonDualActive = false;
  public hrtfActive = false;
  public lastSpatial3D: { x: number; y: number; z: number } = { x: 0, y: 0, z: -10 };

  setBossPhaseState(phase: number, broken: boolean, omegaOverdrive = false, pantheonDual = false): void {
    const p = Math.max(0, Math.min(3, Math.floor(phase || 0)));
    if (
      this.bossPhaseState === p &&
      this.bossBrokenState === broken &&
      this.bossOmegaActive === omegaOverdrive &&
      this.pantheonDualActive === pantheonDual
    ) {
      return;
    }
    this.bossPhaseState = p;
    this.bossBrokenState = broken;
    this.bossOmegaActive = omegaOverdrive;
    this.pantheonDualActive = pantheonDual;
    this.syncMusicStems();
  }

  private syncMusicStems(): void {
    const ctx = this.ctx;
    if (!ctx || !this.stemDrums || !this.stemBass || !this.stemArp || !this.stemPadBrass) return;
    const now = ctx.currentTime;
    const tau = 0.18;
    if (this.intensity === 0) {
      this.stemDrums.gain.setTargetAtTime(0.0001, now, tau);
      this.stemBass.gain.setTargetAtTime(0.76, now, tau);
      this.stemArp.gain.setTargetAtTime(0.72, now, tau);
      this.stemPadBrass.gain.setTargetAtTime(1.06, now, tau);
      this.stemLead?.gain.setTargetAtTime(0.0001, now, tau);
    } else if (this.intensity === 2) {
      const pBoost = Math.max(0, this.bossPhaseState - 1) + (this.bossOmegaActive ? 0.65 : 0) + (this.pantheonDualActive ? 0.95 : 0);
      const drums = 1.06 + pBoost * 0.08 + (this.bossBrokenState ? 0.06 : 0);
      const bass = 1.04 + pBoost * 0.07;
      const arp = 1.02 + pBoost * 0.09 + (this.bossBrokenState ? 0.22 : 0);
      const brass = 1.20 + pBoost * 0.10 + (this.bossBrokenState ? 0.12 : 0);
      this.stemDrums.gain.setTargetAtTime(drums, now, tau);
      this.stemBass.gain.setTargetAtTime(bass, now, tau);
      this.stemArp.gain.setTargetAtTime(arp, now, tau);
      this.stemPadBrass.gain.setTargetAtTime(brass, now, tau);
      this.stemLead?.gain.setTargetAtTime(0.85 + Math.min(0.45, this.abyssalHeatTier * 0.05), now, tau);
    } else {
      const tierBoost = Math.max(0, this.threatTier - 1);
      const drums = 0.78 + Math.min(0.28, tierBoost * 0.065) + (this.feverHot ? 0.08 : 0);
      const bass = 0.88 + Math.min(0.14, tierBoost * 0.03) + (this.feverHot ? 0.12 : 0);
      const arp = 0.76 + Math.min(0.24, tierBoost * 0.05) + (this.feverHot ? 0.22 : 0);
      const padBrass = 0.84 + Math.min(0.3, Math.max(0, tierBoost - 1) * 0.08) + (this.feverHot ? 0.16 : 0);
      this.stemDrums.gain.setTargetAtTime(drums, now, tau);
      this.stemBass.gain.setTargetAtTime(bass, now, tau);
      this.stemArp.gain.setTargetAtTime(arp, now, tau);
      this.stemPadBrass.gain.setTargetAtTime(padBrass, now, tau);
      const leadGain = this.feverHot || this.abyssalHeatTier >= 4 ? 0.82 + Math.min(0.35, this.abyssalHeatTier * 0.04) : 0.15;
      this.stemLead?.gain.setTargetAtTime(leadGain, now, tau);
    }
  }

  unlock(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const sr = this.ctx.sampleRate;

      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.92;

      // Studio bus glue compressor (preserves 9ms transient snap while preventing bus overs)
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -9.5;
      comp.knee.value = 12;
      comp.ratio.value = 3.4;
      comp.attack.value = 0.009;
      comp.release.value = 0.13;
      // V22 Stage 4: Mastering Soft-Clip WaveShaper + Brickwall Peak Limiter (-0.6dBFS ceiling, zero clipping under 100-mob explosions!)
      const brickLimiter = this.ctx.createDynamicsCompressor();
      brickLimiter.threshold.value = -1.2;
      brickLimiter.knee.value = 0;
      brickLimiter.ratio.value = 20;
      brickLimiter.attack.value = 0.001;
      brickLimiter.release.value = 0.055;
      if (typeof this.ctx.createWaveShaper === 'function') {
        const masterClip = this.ctx.createWaveShaper();
        const mcCurve = new Float32Array(512);
        for (let i = 0; i < 512; i++) {
          const x = (i * 2) / 511 - 1;
          mcCurve[i] = Math.tanh(x * 1.12) / Math.tanh(1.12);
        }
        masterClip.curve = mcCurve;
        masterClip.oversample = '2x';
        this.master.connect(comp).connect(masterClip).connect(brickLimiter).connect(this.ctx.destination);
      } else {
        this.master.connect(comp).connect(brickLimiter).connect(this.ctx.destination);
      }
      this.masterLimiterActive = true;

      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.88;

      this.impactBus = this.ctx.createGain();
      this.impactBus.gain.value = 1.06;

      let busIn: AudioNode = this.master;
      let busOut: AudioNode = this.master;
      if (typeof this.ctx.createBiquadFilter === 'function') {
        const punchShelf = this.ctx.createBiquadFilter();
        punchShelf.type = 'lowshelf';
        punchShelf.frequency.value = 96;
        punchShelf.gain.value = 3.6;

        const mudTrim = this.ctx.createBiquadFilter();
        mudTrim.type = 'peaking';
        mudTrim.frequency.value = 450;
        mudTrim.Q.value = 1.35;
        mudTrim.gain.value = -2.4;

        const presenceLift = this.ctx.createBiquadFilter();
        presenceLift.type = 'peaking';
        presenceLift.frequency.value = 2350;
        presenceLift.Q.value = 1.1;
        presenceLift.gain.value = 1.6;

        const silkTop = this.ctx.createBiquadFilter();
        silkTop.type = 'lowpass';
        silkTop.frequency.value = 8400;
        silkTop.Q.value = 0.55;

        punchShelf.connect(mudTrim).connect(presenceLift).connect(silkTop);
        busIn = punchShelf;
        busOut = silkTop;
      }

      if (typeof this.ctx.createWaveShaper === 'function') {
        const shaper = this.ctx.createWaveShaper();
        const curve = new Float32Array(1024);
        const drive = 1.2;
        const norm = Math.tanh(drive);
        for (let i = 0; i < 1024; i++) {
          const x = (i * 2) / 1023 - 1;
          curve[i] = Math.tanh(x * drive) / norm;
        }
        shaper.curve = curve;
        shaper.oversample = '2x';
        if (busIn !== this.master) {
          this.sfx.connect(busIn);
          this.impactBus.connect(busIn);
          busOut.connect(shaper).connect(this.master);
        } else {
          this.sfx.connect(shaper).connect(this.master);
          this.impactBus.connect(shaper);
        }
      } else if (busIn !== this.master) {
        this.sfx.connect(busIn);
        this.impactBus.connect(busIn);
        busOut.connect(this.master);
      } else {
        this.sfx.connect(this.master);
        this.impactBus.connect(this.master);
      }

      // V20 Stage 4: 0.78s True-Stereo Multi-Tap Cyber-Canyon Impulse Response Convolver
      if (typeof this.ctx.createConvolver === 'function') {
        try {
          const irDur = 0.78;
          const irLen = Math.max(1, Math.floor(sr * irDur));
          const irBuf = this.ctx.createBuffer(2, irLen, sr);
          const taps = [0.009, 0.019, 0.034, 0.055, 0.088, 0.138, 0.21, 0.32];
          for (let ch = 0; ch < 2; ch++) {
            const d = irBuf.getChannelData(ch);
            let lp1 = 0;
            let lp2 = 0;
            for (let i = 0; i < irLen; i++) {
              const t = i / sr;
              const w = Math.random() * 2 - 1;
              const damp = Math.max(0.56, 0.84 - t * 0.26);
              lp1 = lp1 * damp + w * (1 - damp);
              lp2 = lp2 * 0.74 + lp1 * 0.26;
              const env = Math.pow(1 - t / irDur, 2.35) * Math.exp(-t * 5.1);
              d[i] = lp2 * env * 0.42;
            }
            for (let k = 0; k < taps.length; k++) {
              const idx = Math.min(irLen - 1, Math.floor((taps[k]! + ch * 0.0034) * sr));
              d[idx] = (d[idx] ?? 0) + (k % 2 === ch ? 0.22 : -0.17) * Math.pow(0.84, k);
            }
          }
          this.convolver = this.ctx.createConvolver();
          this.convolver.buffer = irBuf;
          this.hasConvolverImpulse = true;
          this.reverbSend = this.ctx.createGain();
          this.reverbSend.gain.value = 0.17;
          this.sfx.connect(this.reverbSend);
          this.impactBus.connect(this.reverbSend);
          this.reverbSend.connect(this.convolver).connect(this.master);
        } catch {
          this.convolver = null;
          this.reverbSend = null;
          this.hasConvolverImpulse = false;
        }
      }

      // Harmonized Creature Vocal Bus (sits warmly in 140–2900 Hz pocket: zero sub-mud, zero 3kHz ear-fatigue!)
      this.vocalBus = this.ctx.createGain();
      this.vocalBus.gain.value = 0.88;
      if (typeof this.ctx.createBiquadFilter === 'function') {
        const vHp = this.ctx.createBiquadFilter();
        vHp.type = 'highpass';
        vHp.frequency.value = 132;
        vHp.Q.value = 0.7;

        const vBody = this.ctx.createBiquadFilter();
        vBody.type = 'peaking';
        vBody.frequency.value = 640;
        vBody.Q.value = 1.05;
        vBody.gain.value = 2.2;

        const vDeHarsh = this.ctx.createBiquadFilter();
        vDeHarsh.type = 'peaking';
        vDeHarsh.frequency.value = 2750;
        vDeHarsh.Q.value = 1.35;
        vDeHarsh.gain.value = -3.6;

        const vSilk = this.ctx.createBiquadFilter();
        vSilk.type = 'lowpass';
        vSilk.frequency.value = 3050;
        vSilk.Q.value = 0.62;

        this.vocalBus.connect(vHp).connect(vBody).connect(vDeHarsh).connect(vSilk).connect(busIn);
        if (this.convolver) {
          const vocalWet = this.ctx.createGain();
          vocalWet.gain.value = 0.24;
          vSilk.connect(vocalWet).connect(this.convolver);
        }
      } else {
        this.vocalBus.connect(busIn);
      }

      // 4-Stem Vertical Synthwave Music Bus + Dynamic Climax Sidechain Low-Pass Filter
      this.music = this.ctx.createGain();
      this.music.gain.value = this.baseMusicGain;
      if (typeof this.ctx.createBiquadFilter === 'function') {
        this.musicDuckFilter = this.ctx.createBiquadFilter();
        this.musicDuckFilter.type = 'lowpass';
        this.musicDuckFilter.frequency.value = 11500;
        this.musicDuckFilter.Q.value = 0.85;
        this.music.connect(this.musicDuckFilter).connect(this.master);
      } else {
        this.music.connect(this.master);
      }

      this.stemDrums = this.ctx.createGain();
      this.stemBass = this.ctx.createGain();
      this.stemArp = this.ctx.createGain();
      this.stemPadBrass = this.ctx.createGain();
      this.stemDrums.connect(this.music);
      this.stemLead = this.ctx.createGain();
      this.stemLead.gain.value = 0.0001;
      this.stemLead.connect(this.music);
      this.stemBass.connect(this.music);
      this.stemArp.connect(this.music);
      this.stemPadBrass.connect(this.music);
      this.syncMusicStems();

      // Paul Kellet pink-noise + warm brown-noise buffers
      this.noiseBuf = this.ctx.createBuffer(1, sr, sr);
      this.warmNoiseBuf = this.ctx.createBuffer(1, sr, sr);
      const nData = this.noiseBuf.getChannelData(0);
      const wData = this.warmNoiseBuf.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let brown = 0;
      for (let i = 0; i < sr; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        const pink = (b0 + b1 + b2 + white * 0.1848) * 0.22;
        nData[i] = Math.max(-1, Math.min(1, pink));
        brown = (brown + 0.042 * white) / 1.042;
        wData[i] = Math.max(-1, Math.min(1, brown * 3.2));
      }

      this.bakeStudioFoleyBanks(sr);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /**
   * Bakes multi-sample round-robin stereo foley banks (17 distinct stereo buffers across 7 families)
   * so consecutive shots, hits, and pops have organic acoustic variation with zero robotic repetition!
   */
  private bakeStudioFoleyBanks(sr: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    let seed = 0x51a7d39b;
    const rnd = (): number => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
      return (seed / 4294967296) * 2 - 1;
    };

    // 1. carbineSnap (4 Round-Robin Variations, 0.045s Stereo)
    for (let v = 0; v < 4; v++) {
      const len = Math.max(1, Math.floor(sr * (0.043 + v * 0.002)));
      const buf = ctx.createBuffer(2, len, sr);
      const bodyStartF = 126 + v * 9;
      const boltTime = 0.0125 + v * 0.0014;
      const boltFreq = 1820 + v * 135;
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let ph = 0;
        let lp1 = 0;
        let lp2 = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const w = rnd();
          lp1 = lp1 * (0.56 + v * 0.02) + w * (0.44 - v * 0.02);
          lp2 = lp2 * 0.54 + lp1 * 0.46;
          const midSnap = (lp1 - lp2 * 0.62) * Math.exp(-t * (142 + v * 8)) * 1.08;

          const f = 46 + (bodyStartF - 46) * Math.exp(-t * (92 + v * 6));
          ph += (2 * Math.PI * f) / sr;
          const body = (Math.sin(ph) * 0.74 + Math.sin(ph * 2.0) * 0.16 * Math.exp(-t * 120)) * Math.exp(-t * 76);

          const bt = t - (boltTime + ch * 0.0007);
          const bolt = bt >= 0 && bt < 0.008 ? Math.sin(2 * Math.PI * boltFreq * bt) * Math.exp(-bt * 430) * 0.24 : 0;

          d[i] = Math.tanh((body + midSnap + bolt) * 1.48) * 0.9;
        }
      }
      this.foleyBanks[`carbineSnap_${v}`] = buf;
      if (v === 0) this.foleyBanks.carbineSnap = buf;
    }

    // 2. shotgunPunch (2 Round-Robin Variations, 0.14s Stereo)
    for (let v = 0; v < 2; v++) {
      const len = Math.max(1, Math.floor(sr * 0.14));
      const buf = ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let ph = 0;
        let lp1 = 0;
        let lp2 = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const w = rnd();
          lp1 = lp1 * 0.72 + w * 0.28;
          lp2 = lp2 * 0.68 + lp1 * 0.32;
          const f = 38 + (94 + v * 10) * Math.exp(-t * 48);
          ph += (2 * Math.PI * f) / sr;
          const punch = (Math.sin(ph) * 0.85 + Math.sin(ph * 1.95) * 0.28 * Math.exp(-t * 35)) * Math.exp(-t * 28);
          const warmBlast = lp2 * 1.62 * Math.exp(-t * (33 + v * 3));
          d[i] = Math.tanh((punch + warmBlast) * 1.55) * 0.92;
        }
      }
      this.foleyBanks[`shotgunPunch_${v}`] = buf;
      if (v === 0) this.foleyBanks.shotgunPunch = buf;
    }

    // 3. hitThock (4 Round-Robin Variations, 0.042s Stereo)
    for (let v = 0; v < 4; v++) {
      const len = Math.max(1, Math.floor(sr * 0.042));
      const buf = ctx.createBuffer(2, len, sr);
      const tap1Hz = 1720 + v * 115;
      const tap2Hz = 2520 + v * 140;
      const tap2Delay = 0.0058 + v * 0.0009;
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let phBody = 0;
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const w = rnd();
          lp = lp * 0.65 + w * 0.35;

          const fb = 50 + (72 + v * 6) * Math.exp(-t * 108);
          phBody += (2 * Math.PI * fb) / sr;
          const thud = Math.sin(phBody) * Math.exp(-t * 86) * 0.8;

          const tap1 =
            (Math.sin(2 * Math.PI * (tap1Hz + ch * 65) * t) * 0.46 + lp * 0.52) * Math.exp(-t * 265);
          const t2 = t - (tap2Delay + ch * 0.0006);
          const tap2 =
            t2 >= 0
              ? (Math.sin(2 * Math.PI * (tap2Hz - ch * 75) * t2) * 0.38 + lp * 0.4) * Math.exp(-t2 * 315)
              : 0;

          d[i] = Math.tanh((thud + tap1 + tap2) * 1.62) * 0.92;
        }
      }
      this.foleyBanks[`hitThock_${v}`] = buf;
      if (v === 0) this.foleyBanks.hitThock = buf;
    }

    // 4. armorPing (2 Variations, 0.095s Stereo)
    for (let v = 0; v < 2; v++) {
      const len = Math.max(1, Math.floor(sr * 0.095));
      const buf = ctx.createBuffer(2, len, sr);
      const modes = v === 0 ? [1160, 1870, 2710, 3820] : [1230, 1960, 2840, 3980];
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let phSub = 0;
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          lp = lp * 0.66 + rnd() * 0.34;
          const fSub = 54 + 68 * Math.exp(-t * 95);
          phSub += (2 * Math.PI * fSub) / sr;
          let sig = Math.sin(phSub) * Math.exp(-t * 72) * 0.64 + lp * Math.exp(-t * 280) * 0.42;
          for (let m = 0; m < modes.length; m++) {
            const mf = modes[m]! * (1 + ch * 0.008 * (m % 2 === 0 ? 1 : -1));
            sig += Math.sin(2 * Math.PI * mf * t + m * 0.7) * Math.exp(-t * (44 + m * 14)) * (0.24 - m * 0.035);
          }
          d[i] = Math.tanh(sig * 1.5) * 0.9;
        }
      }
      this.foleyBanks[`armorPing_${v}`] = buf;
      if (v === 0) this.foleyBanks.armorPing = buf;
    }

    // 5. crystalTick (2 Variations, 0.085s Stereo)
    for (let v = 0; v < 2; v++) {
      const len = Math.max(1, Math.floor(sr * 0.085));
      const buf = ctx.createBuffer(2, len, sr);
      const partials = v === 0 ? [2080, 3140, 4420, 5540] : [2210, 3310, 4640, 5760];
      const cracks = [0, 0.0075 + v * 0.0015, 0.018 + v * 0.002];
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          let sig = Math.sin(2 * Math.PI * (96 + 56 * Math.exp(-t * 80)) * t) * Math.exp(-t * 70) * 0.48;
          for (let c = 0; c < cracks.length; c++) {
            const dt = t - (cracks[c]! + ch * 0.0009);
            if (dt >= 0) {
              const pFreq = partials[(c + ch) % partials.length]!;
              sig += Math.sin(2 * Math.PI * pFreq * dt) * Math.exp(-dt * (58 + c * 18)) * (0.34 - c * 0.07);
            }
          }
          d[i] = Math.tanh(sig * 1.48) * 0.88;
        }
      }
      this.foleyBanks[`crystalTick_${v}`] = buf;
      if (v === 0) this.foleyBanks.crystalTick = buf;
    }

    // 6. killPop (4 Round-Robin Variations, 0.11s Stereo)
    for (let v = 0; v < 4; v++) {
      const len = Math.max(1, Math.floor(sr * 0.11));
      const buf = ctx.createBuffer(2, len, sr);
      const popStart = 320 + v * 28;
      const popSpan = 270 + v * 25;
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let phDrop = 0;
        let phPop = 0;
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          lp = lp * 0.71 + rnd() * 0.29;
          const fd = 39 + (82 + v * 5) * Math.exp(-t * 52);
          phDrop += (2 * Math.PI * fd) / sr;
          const drop = Math.sin(phDrop) * Math.exp(-t * 34) * 0.84;

          const fp = popStart + popSpan * Math.min(1, t / 0.011);
          phPop += (2 * Math.PI * fp) / sr;
          const pop = Math.sin(phPop) * Math.exp(-t * (112 + v * 6)) * 0.44;

          const ct = t - (0.0048 + v * 0.0006 + ch * 0.0007);
          const crunch = ct >= 0 ? lp * Math.exp(-ct * 155) * 0.46 : 0;

          d[i] = Math.tanh((drop + pop + crunch) * 1.56) * 0.92;
        }
      }
      this.foleyBanks[`killPop_${v}`] = buf;
      if (v === 0) this.foleyBanks.killPop = buf;
    }

    // 7. heavyBoom (0.44s Stereo): Warm cinema concussion shockwave
    {
      const len = Math.max(1, Math.floor(sr * 0.44));
      const buf = ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let ph = 0;
        let brown = 0;
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const w = rnd();
          brown = (brown + 0.045 * w) / 1.045;
          lp = lp * 0.78 + w * 0.22;
          const f = 26 + 84 * Math.exp(-t * 16);
          ph += (2 * Math.PI * f) / sr;
          const subWave = (Math.sin(ph) * 0.88 + Math.sin(ph * 1.9) * 0.32 * Math.exp(-t * 14)) * Math.exp(-t * 8.2);
          const punchCrack = lp * Math.exp(-t * 65) * 0.7;
          const rumble = brown * 2.9 * Math.exp(-t * 6.8) * 0.72;
          d[i] = Math.tanh((subWave + punchCrack + rumble) * 1.6) * 0.95;
        }
      }
      this.foleyBanks.heavyBoom = buf;
      this.foleyBanks.heavyBoom_0 = buf;
    }

    // Helper to normalize a stereo buffer cleanly to targetPeak without harsh clipping
    const normalizeStereo = (buf: AudioBuffer, targetPeak = 0.88): void => {
      let peak = 1e-5;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) {
          const a = Math.abs(d[i]!);
          if (a > peak) peak = a;
        }
      }
      const scale = targetPeak / peak;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) d[i] = d[i]! * scale;
      }
    };

    // 8. swarmChitter (4 Variations, 0.17s Stereo — Tier-1/2 Agile Swarm: crawler/runner/stalker/mitosis)
    //    Source-filter bio-vocal gasp (`e/a -> u` throat closure, F0 240 -> 122 Hz, silky <2.6kHz)
    for (let v = 0; v < 4; v++) {
      const dur = 0.165 + v * 0.008;
      const len = Math.max(1, Math.floor(sr * dur));
      const buf = ctx.createBuffer(2, len, sr);
      const pitchMul = [1.0, 1.05, 0.94, 1.09][v]!;
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let ph = ch * 0.35;
        let low1 = 0, band1 = 0;
        let low2 = 0, band2 = 0;
        let pinkLp = 0;
        let silkLp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const p = t / dur;
          const w = rnd();
          pinkLp = pinkLp * 0.72 + w * 0.28;

          // Startled brief vocal catch followed by natural agonized pitch drop
          const f0 =
            220 *
            pitchMul *
            (0.54 + 0.56 * Math.exp(-t * 13.5)) *
            (1 + 0.042 * Math.sin(2 * Math.PI * (23 + v * 3) * t));
          ph += (2 * Math.PI * f0) / sr;

          const glottal =
            Math.sin(ph) * 0.58 +
            Math.sin(ph * 2 + 0.3) * 0.34 +
            Math.sin(ph * 3) * 0.17 +
            Math.sin(ph * 0.5) * 0.22;
          const breath = pinkLp * (0.35 + 0.65 * Math.max(0, Math.sin(ph))) * 0.45;
          const src = glottal + breath;

          // Moving 2-formant vocal tract (`eh` -> `uh` closure)
          const fc1 = (740 - 370 * p) * (ch === 0 ? 0.985 : 1.015);
          const fc2 = (1620 - 740 * p) * (ch === 0 ? 1.02 : 0.98);
          const f1 = 2 * Math.sin(Math.PI * Math.min(0.36, fc1 / sr));
          const f2 = 2 * Math.sin(Math.PI * Math.min(0.36, fc2 / sr));
          low1 += f1 * band1;
          const high1 = src - low1 - 0.24 * band1;
          band1 += f1 * high1;
          low2 += f2 * band2;
          const high2 = src - low2 - 0.21 * band2;
          band2 += f2 * high2;

          const env = (1 - Math.exp(-t / 0.009)) * Math.pow(1 - p, 1.55) * Math.exp(-t * 4.2);
          const raw = (band1 * 0.62 + band2 * 0.34 + glottal * 0.22) * env;
          silkLp = silkLp * 0.42 + Math.tanh(raw * 1.35) * 0.58;
          d[i] = silkLp;
        }
      }
      normalizeStereo(buf, 0.86);
      this.foleyBanks[`swarmChitter_${v}`] = buf;
      if (v === 0) this.foleyBanks.swarmChitter = buf;
    }

    // 9. feralSnarl (3 Variations, 0.29s Stereo — Beast & Berserker Mutants: dasher/bomber/burrower/howler)
    //    Guttural predator snarl-groan with 0.5x sub-harmonic vocal-fry growl & moving throat formants
    for (let v = 0; v < 3; v++) {
      const dur = 0.28 + v * 0.015;
      const len = Math.max(1, Math.floor(sr * dur));
      const buf = ctx.createBuffer(2, len, sr);
      const pitchMul = [1.0, 0.93, 1.07][v]!;
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let ph = ch * 0.4;
        let low1 = 0, band1 = 0;
        let low2 = 0, band2 = 0;
        let raspLp = 0;
        let silkLp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const p = t / dur;
          raspLp = raspLp * 0.78 + rnd() * 0.22;

          const swell = t < 0.048 ? 0.9 + 0.24 * (t / 0.048) : 1.14 * Math.exp(-(t - 0.048) * 3.1);
          const f0 = Math.max(68, 165 * pitchMul * swell * (1 + 0.03 * Math.sin(2 * Math.PI * 19 * t)));
          ph += (2 * Math.PI * f0) / sr;

          // Sub-octave 0.5x vocal-fold growl creates authentic visceral creature texture without harshness!
          const glottal =
            Math.sin(ph) * 0.52 +
            Math.sin(ph * 0.5) * 0.46 +
            Math.sin(ph * 1.5) * 0.22 +
            Math.sin(ph * 2.0 + 0.4) * 0.3 +
            Math.sin(ph * 3.0) * 0.14;
          const rasp = raspLp * (0.3 + 0.7 * Math.max(0, Math.sin(ph))) * 0.52;
          const src = glottal + rasp;

          const fc1 = (660 - 340 * p) * (ch === 0 ? 0.98 : 1.02);
          const fc2 = (1360 - 670 * p) * (ch === 0 ? 1.02 : 0.98);
          const f1 = 2 * Math.sin(Math.PI * Math.min(0.35, fc1 / sr));
          const f2 = 2 * Math.sin(Math.PI * Math.min(0.35, fc2 / sr));
          low1 += f1 * band1;
          band1 += f1 * (src - low1 - 0.25 * band1);
          low2 += f2 * band2;
          band2 += f2 * (src - low2 - 0.22 * band2);

          const env = (1 - Math.exp(-t / 0.014)) * Math.pow(1 - p, 1.45) * Math.exp(-t * 2.6);
          const raw = (band1 * 0.64 + band2 * 0.32 + glottal * 0.28) * env;
          silkLp = silkLp * 0.46 + Math.tanh(raw * 1.45) * 0.54;
          d[i] = silkLp;
        }
      }
      normalizeStereo(buf, 0.89);
      this.foleyBanks[`feralSnarl_${v}`] = buf;
      if (v === 0) this.foleyBanks.feralSnarl = buf;
    }

    // 10. wraithWail (3 Variations, 0.37s Stereo — Spectral / Psionic Elites: siphon/beholder/necromancer)
    //     Haunting stereo-detuned spectral lament gliding E4 -> A3 (330 -> 220 Hz) through hollow choir formants
    for (let v = 0; v < 3; v++) {
      const dur = 0.36 + v * 0.018;
      const len = Math.max(1, Math.floor(sr * dur));
      const buf = ctx.createBuffer(2, len, sr);
      const pitchMul = [1.0, 0.94, 1.06][v]!;
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let phA = 0;
        let phB = 0.8;
        let low1 = 0, band1 = 0;
        let low2 = 0, band2 = 0;
        let airLp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const p = t / dur;
          airLp = airLp * 0.74 + rnd() * 0.26;

          const vibrato = 1 + 0.016 * Math.sin(2 * Math.PI * (5.8 + v * 0.5) * t);
          const glide = 0.66 + 0.34 * Math.pow(1 - p, 1.25); // 330 Hz -> 218 Hz musical fifth descent!
          const fBase = 330 * pitchMul * glide * vibrato;
          const detune = ch === 0 ? 0.995 : 1.005;
          phA += (2 * Math.PI * fBase * detune) / sr;
          phB += (2 * Math.PI * fBase * 0.5 * (2 - detune)) / sr;

          const choirSrc =
            Math.sin(phA) * 0.54 +
            Math.sin(phA * 2 + 0.5) * 0.24 +
            Math.sin(phB) * 0.32 +
            airLp * 0.34;

          const fc1 = 540 - 245 * p;
          const fc2 = (1220 - 560 * p) * (ch === 0 ? 0.97 : 1.03);
          const f1 = 2 * Math.sin(Math.PI * Math.min(0.35, fc1 / sr));
          const f2 = 2 * Math.sin(Math.PI * Math.min(0.35, fc2 / sr));
          low1 += f1 * band1;
          band1 += f1 * (choirSrc - low1 - 0.18 * band1);
          low2 += f2 * band2;
          band2 += f2 * (choirSrc - low2 - 0.17 * band2);

          const env = (1 - Math.exp(-t / 0.024)) * Math.pow(1 - p, 1.35) * Math.exp(-t * 1.9);
          d[i] = Math.tanh((band1 * 0.58 + band2 * 0.36 + Math.sin(phA) * 0.2) * env * 1.3);
        }
      }
      normalizeStereo(buf, 0.86);
      this.foleyBanks[`wraithWail_${v}`] = buf;
      if (v === 0) this.foleyBanks.wraithWail = buf;
    }

    // 11. titanRoar (3 Variations, 0.48s Stereo — Tier-3/4 Juggernauts & Bosses: phalanx/brood/glacier/bastion)
    //     Cavernous sub-vocal colossus death bellow (118 -> 48 Hz + 0.5x chest growl + giant throat formants)
    for (let v = 0; v < 3; v++) {
      const dur = 0.46 + v * 0.025;
      const len = Math.max(1, Math.floor(sr * dur));
      const buf = ctx.createBuffer(2, len, sr);
      const pitchMul = [1.0, 0.92, 1.06][v]!;
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let ph = ch * 0.5;
        let low1 = 0, band1 = 0;
        let low2 = 0, band2 = 0;
        let brown = 0;
        let silkLp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const p = t / dur;
          const w = rnd();
          brown = (brown + 0.05 * w) / 1.05;

          const arc = t < 0.065 ? 0.94 + 0.18 * (t / 0.065) : 1.12 * Math.exp(-(t - 0.065) * 2.15);
          const f0 = Math.max(44, 110 * pitchMul * arc * (1 + 0.025 * Math.sin(2 * Math.PI * 14 * t)));
          ph += (2 * Math.PI * f0) / sr;

          const chestVoice =
            Math.sin(ph) * 0.56 +
            Math.sin(ph * 0.5) * 0.52 +
            Math.sin(ph * 1.5) * 0.28 +
            Math.sin(ph * 2.0 + 0.3) * 0.28 +
            Math.sin(ph * 3.0) * 0.16;
          const roarBreath = brown * 2.4 * (0.35 + 0.65 * Math.max(0, Math.sin(ph))) * 0.48;
          const src = chestVoice + roarBreath;

          const fc1 = (470 - 255 * p) * (ch === 0 ? 0.98 : 1.02);
          const fc2 = (960 - 500 * p) * (ch === 0 ? 1.025 : 0.975);
          const f1 = 2 * Math.sin(Math.PI * Math.min(0.32, fc1 / sr));
          const f2 = 2 * Math.sin(Math.PI * Math.min(0.32, fc2 / sr));
          low1 += f1 * band1;
          band1 += f1 * (src - low1 - 0.26 * band1);
          low2 += f2 * band2;
          band2 += f2 * (src - low2 - 0.24 * band2);

          const env = (1 - Math.exp(-t / 0.02)) * Math.pow(1 - p, 1.32) * Math.exp(-t * 1.85);
          const raw = (band1 * 0.62 + band2 * 0.32 + chestVoice * 0.34) * env;
          silkLp = silkLp * 0.5 + Math.tanh(raw * 1.5) * 0.5;
          d[i] = silkLp;
        }
      }
      normalizeStereo(buf, 0.91);
      this.foleyBanks[`titanRoar_${v}`] = buf;
      if (v === 0) this.foleyBanks.titanRoar = buf;
    }
  }

  private pickFoleyBuffer(family: FoleyFamily): AudioBuffer | undefined {
    const counts: Record<FoleyFamily, number> = {
      carbineSnap: 4,
      shotgunPunch: 2,
      hitThock: 4,
      armorPing: 2,
      crystalTick: 2,
      killPop: 4,
      heavyBoom: 1,
      swarmChitter: 4,
      feralSnarl: 3,
      wraithWail: 3,
      titanRoar: 3,
    };
    const n = counts[family];
    if (n <= 1) return this.foleyBanks[family];
    const next = ((this.rrCounters[family] ?? -1) + 1) % n;
    this.rrCounters[family] = next;
    return this.foleyBanks[`${family}_${next}`] ?? this.foleyBanks[family];
  }

  private throttle(key: string, minGap: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(key) ?? -1;
    if (now - last < minGap) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private acquireRapidSlot(when: number, maxConcurrent = 26): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    while (this.rapidVoiceTimes.length > 0 && now - this.rapidVoiceTimes[0]! > 0.095) {
      this.rapidVoiceTimes.shift();
    }
    if (this.rapidVoiceTimes.length >= maxConcurrent) return false;
    this.rapidVoiceTimes.push(Math.max(now, when));
    return true;
  }

  /** Glitch-free sidechain music ducking using cancelAndHoldAtTime (zero BGM volume jumps!) */
  /** Sweeps music low-pass filter down to 620Hz and blooms back for console-grade ultimate/parry climax ducking! */
  public triggerUltimateDuck(holdSec = 0.36): void {
    this.duckMusic(0.58, holdSec, 0.35);
    const ctx = this.ctx;
    const flt = this.musicDuckFilter;
    if (!ctx || !flt || this.muted) return;
    const now = ctx.currentTime;
    try {
      flt.frequency.cancelScheduledValues(now);
      flt.frequency.setValueAtTime(Math.max(400, flt.frequency.value || 11500), now);
      flt.frequency.exponentialRampToValueAtTime(620, now + 0.035);
      flt.frequency.setValueAtTime(620, now + 0.035 + holdSec);
      flt.frequency.exponentialRampToValueAtTime(11500, now + 0.035 + holdSec + 0.55);
    } catch {
      /* ignore */
    }
  }

  private duckMusic(depth = 0.36, holdSec = 0.04, releaseSec = 0.16): void {
    const ctx = this.ctx;
    if (!ctx || !this.music || this.muted) return;
    const now = ctx.currentTime;
    const targetGain = Math.max(0.075, this.baseMusicGain * (1 - depth));
    const param = this.music.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
    try {
      if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(now);
      } else {
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value || this.baseMusicGain, now);
      }
      param.setTargetAtTime(targetGain, now, 0.008);
      param.setTargetAtTime(this.baseMusicGain, now + 0.015 + holdSec, Math.max(0.035, releaseSec * 0.42));
    } catch {
      // Ignore scheduling edge cases on suspended contexts
    }
  }

  /**
   * 3D Z-Depth Spatial Acoustic Router:
   * - Stereo panner narrows subtly with distance along the highway perspective cone.
   * - Near combat (`z > -8m`, `dist < 0.16`): Pure 8.4kHz crisp dry punch!
   * - Mid/Far combat (`z <= -8m`, `dist >= 0.16`): Air-absorption low-pass (`8200 * 0.20^dist` -> `~1640 Hz` at horizon)
   *   plus distance-proportional wet canyon reflection tap (`dist * 0.30`) into `this.convolver`!
   */
  public routeSpatial(panX: number | undefined, worldZ: number | undefined, dest: AudioNode, worldY = 0.9): AudioNode {
    const ctx = this.ctx;
    if (!ctx) return dest;

    const dist = worldZ === undefined ? 0 : Math.max(0, Math.min(1, (6.0 - worldZ) / 88));
    this.lastSpatialDist = dist;
    this.lastSpatial3D = { x: panX ?? 0, y: worldY, z: worldZ ?? -8 };

    let sink: AudioNode = dest;
    if ((panX !== undefined || worldZ !== undefined) && typeof ctx.createPanner === 'function') {
      try {
        const listener = ctx.listener as AudioListener & {
          positionX?: AudioParam;
          positionY?: AudioParam;
          positionZ?: AudioParam;
        };
        if (listener && listener.positionX) {
          listener.positionX.value = 0;
          listener.positionY!.value = 1.35;
          listener.positionZ!.value = 4.8;
        }
        const panner3d = ctx.createPanner();
        panner3d.panningModel = 'HRTF';
        panner3d.distanceModel = 'inverse';
        panner3d.refDistance = 9.5;
        panner3d.maxDistance = 96;
        panner3d.rolloffFactor = 0.65;
        const rx = Math.max(-14, Math.min(14, (panX ?? 0) * 1.22));
        const ry = Math.max(-3, Math.min(12, worldY));
        const rz = Math.max(-85, Math.min(10, worldZ ?? -6));
        if (panner3d.positionX) {
          panner3d.positionX.value = rx;
          panner3d.positionY.value = ry;
          panner3d.positionZ.value = rz;
        } else {
          panner3d.setPosition(rx, ry, rz);
        }
        this.hrtfActive = true;
        panner3d.connect(dest);
        sink = panner3d;
      } catch {
        if (panX !== undefined && Math.abs(panX) >= 0.04 && typeof ctx.createStereoPanner === 'function') {
          const panner = ctx.createStereoPanner();
          panner.pan.value = Math.max(-0.82, Math.min(0.82, panX / (5.0 + dist * 2.4)));
          panner.connect(dest);
          sink = panner;
        }
      }
    } else if (panX !== undefined && Math.abs(panX) >= 0.04 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      const spreadDiv = 5.0 + dist * 2.4;
      panner.pan.value = Math.max(-0.82, Math.min(0.82, panX / spreadDiv));
      panner.connect(dest);
      sink = panner;
    }

    if (dist < 0.16 || typeof ctx.createBiquadFilter !== 'function') {
      this.lastSpatialCutoffHz = 8400;
      return sink;
    }

    const cutoff = Math.max(1380, Math.round(8200 * Math.pow(0.2, dist)));
    this.lastSpatialCutoffHz = cutoff;

    const airLp = ctx.createBiquadFilter();
    airLp.type = 'lowpass';
    airLp.frequency.value = cutoff;
    airLp.Q.value = 0.62;

    const dryGain = ctx.createGain();
    dryGain.gain.value = 1 - dist * 0.26;
    airLp.connect(dryGain).connect(sink);

    if (this.convolver) {
      const wetTap = ctx.createGain();
      wetTap.gain.value = dist * 0.30;
      airLp.connect(wetTap).connect(this.convolver);
    }

    return airLp;
  }

  /** V21 3D Binaural Threat & Tactical Event Cue (Elevated High-Spire, Formation Backlash, Co-Boss, Reactor Wall) */
  spatialThreatCue(
    kind: 'spire_charge' | 'spire_shatter' | 'formation_break' | 'reactor_wall' | 'tactical_drop' | 'pantheon_dual',
    x = 0,
    y = 1.0,
    z = -18,
  ): void {
    const ctx = this.ctx;
    const destBus = this.sfx ?? this.master;
    if (!ctx || !destBus || this.muted) return;
    const t = ctx.currentTime;
    const out = this.routeSpatial(x, z, destBus, y);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    if (kind === 'spire_charge') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(620, t);
      osc.frequency.exponentialRampToValueAtTime(1480, t + 0.22);
      g.gain.setValueAtTime(0.085, t);
    } else if (kind === 'spire_shatter') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1320, t);
      osc.frequency.exponentialRampToValueAtTime(240, t + 0.28);
      g.gain.setValueAtTime(0.15, t);
    } else if (kind === 'formation_break') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(540, t);
      osc.frequency.exponentialRampToValueAtTime(165, t + 0.26);
      g.gain.setValueAtTime(0.13, t);
    } else if (kind === 'reactor_wall') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.34);
      g.gain.setValueAtTime(0.16, t);
    } else if (kind === 'pantheon_dual') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.linearRampToValueAtTime(220, t + 0.42);
      g.gain.setValueAtTime(0.17, t);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(1040, t + 0.24);
      g.gain.setValueAtTime(0.12, t);
    }
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + 0.38);
  }

  private playFoley(
    family: FoleyFamily,
    opts: {
      vol?: number;
      rate?: number;
      when?: number;
      panX?: number;
      worldZ?: number;
      dur?: number;
      dest?: AudioNode;
      priority?: boolean;
    } = {},
  ): void {
    const ctx = this.ctx;
    const buf = this.pickFoleyBuffer(family);
    const destBus = opts.dest ?? this.impactBus ?? this.sfx;
    if (!ctx || !buf || !destBus || this.muted) return;

    const t0 = Math.max(ctx.currentTime, opts.when ?? ctx.currentTime);
    if (!opts.priority && !this.acquireRapidSlot(t0, 26)) return;

    const rate = Math.max(0.55, Math.min(1.9, opts.rate ?? 1.0));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(rate, t0);

    const g = ctx.createGain();
    const vol = Math.max(0.0005, opts.vol ?? 0.28);
    g.gain.setValueAtTime(vol, t0);
    const playDur = opts.dur ?? buf.duration / rate;
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + playDur);

    const target = this.routeSpatial(opts.panX, opts.worldZ, destBus);
    src.connect(g).connect(target);
    src.start(t0);
    src.stop(t0 + playDur + 0.015);
  }

  private fmBell(
    freq: number,
    dur: number,
    opts: {
      ratio?: number;
      modIndex?: number;
      vol?: number;
      attack?: number;
      slideTo?: number;
      when?: number;
      panX?: number;
      worldZ?: number;
      dest?: AudioNode;
      priority?: boolean;
    } = {},
  ): void {
    const ctx = this.ctx;
    const destBus = opts.dest ?? this.sfx;
    if (!ctx || !destBus || this.muted) return;

    const t0 = Math.max(ctx.currentTime, opts.when ?? ctx.currentTime);
    if (opts.priority === false && !this.acquireRapidSlot(t0, 28)) return;

    const maxF = ctx.sampleRate * 0.42;
    const f0 = Math.min(maxF, Math.max(28, freq));
    const ratio = opts.ratio ?? 2.0;
    const modHz = Math.min(maxF, f0 * ratio);
    const modPeak = f0 * (opts.modIndex ?? 1.32);

    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const modGain = ctx.createGain();
    const outGain = ctx.createGain();

    carrier.type = 'sine';
    modulator.type = 'sine';
    carrier.frequency.setValueAtTime(f0, t0);
    modulator.frequency.setValueAtTime(modHz, t0);
    if (opts.slideTo) {
      const fEnd = Math.min(maxF, Math.max(28, opts.slideTo));
      carrier.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);
      modulator.frequency.exponentialRampToValueAtTime(Math.min(maxF, fEnd * ratio), t0 + dur);
    }

    modGain.gain.setValueAtTime(Math.max(1, modPeak), t0);
    modGain.gain.exponentialRampToValueAtTime(0.4, t0 + dur * 0.65);

    const vol = Math.max(0.0003, opts.vol ?? 0.12);
    const atk = Math.min(dur * 0.35, opts.attack ?? 0.0025);
    outGain.gain.setValueAtTime(0.0001, t0);
    outGain.gain.exponentialRampToValueAtTime(vol, t0 + atk);
    outGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    const target = this.routeSpatial(opts.panX, opts.worldZ, destBus);
    modulator.connect(modGain).connect(carrier.frequency);
    carrier.connect(outGain).connect(target);

    modulator.start(t0);
    carrier.start(t0);
    modulator.stop(t0 + dur + 0.02);
    carrier.stop(t0 + dur + 0.02);
  }

  private subPunch(
    freq: number,
    slideTo: number,
    dur: number,
    vol: number,
    when?: number,
    panX?: number,
    worldZ?: number,
  ): void {
    const startF = Math.min(155, Math.max(68, freq));
    const endF = Math.min(48, Math.max(28, slideTo));
    this.tone(startF, dur, {
      type: 'sine',
      vol,
      slideTo: endF,
      attack: 0.0012,
      when,
      panX,
      worldZ,
      dest: this.impactBus ?? this.sfx ?? undefined,
    });
  }

  private tone(
    freq: number,
    dur: number,
    opts: {
      type?: Wave;
      vol?: number;
      slideTo?: number;
      attack?: number;
      when?: number;
      panX?: number;
      worldZ?: number;
      detune?: number;
      lpFreq?: number;
      lpEndFreq?: number;
      dest?: AudioNode;
    } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || this.muted) return;
    const t0 = Math.max(ctx.currentTime, opts.when ?? ctx.currentTime);
    const maxF = ctx.sampleRate * 0.44;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'triangle';
    osc.frequency.setValueAtTime(Math.min(maxF, Math.max(22, freq)), t0);
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, t0);
    if (opts.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.min(maxF, Math.max(22, opts.slideTo)), t0 + dur);
    }
    const vol = Math.max(0.0002, opts.vol ?? 0.14);
    const atk = Math.min(dur * 0.4, opts.attack ?? 0.003);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    const target = this.routeSpatial(opts.panX, opts.worldZ, opts.dest ?? this.sfx);
    if (opts.lpFreq && typeof ctx.createBiquadFilter === 'function') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.85;
      lp.frequency.setValueAtTime(opts.lpFreq, t0);
      if (opts.lpEndFreq) {
        lp.frequency.exponentialRampToValueAtTime(Math.max(40, opts.lpEndFreq), t0 + dur);
      }
      osc.connect(lp).connect(g).connect(target);
    } else {
      osc.connect(g).connect(target);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(
    dur: number,
    opts: {
      vol?: number;
      freq?: number;
      q?: number;
      type?: BiquadFilterType;
      when?: number;
      slideTo?: number;
      attack?: number;
      panX?: number;
      worldZ?: number;
      warm?: boolean;
      dest?: AudioNode;
    } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || this.muted) return;
    const buf = opts.warm ? this.warmNoiseBuf ?? this.noiseBuf : this.noiseBuf;
    if (!buf) return;

    const t0 = Math.max(ctx.currentTime, opts.when ?? ctx.currentTime);
    const maxF = ctx.sampleRate * 0.42;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'lowpass';
    f.frequency.setValueAtTime(Math.min(maxF, Math.max(40, opts.freq ?? 1400)), t0);
    if (opts.slideTo) {
      f.frequency.exponentialRampToValueAtTime(Math.min(maxF, Math.max(40, opts.slideTo)), t0 + dur);
    }
    f.Q.value = Math.min(1.4, opts.q ?? 0.7);

    const g = ctx.createGain();
    const vol = Math.max(0.0002, opts.vol ?? 0.18);
    if (opts.attack && opts.attack > 0.001) {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(dur * 0.4, opts.attack));
    } else {
      g.gain.setValueAtTime(vol, t0);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    const target = this.routeSpatial(opts.panX, opts.worldZ, opts.dest ?? this.sfx);
    src.connect(f).connect(g).connect(target);
    src.start(t0, Math.random() * Math.max(0, buf.duration - 0.12));
    src.stop(t0 + dur + 0.02);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // ---------------------------------------------------------------- Round-Robin Silky Auto-Fire (Squad Near Z=+6)
  shoot(weapon: string, squadCount = 1, panX = 0): void {
    const gap = weapon === 'pulse' || weapon === 'cryo' ? 0.072 : 0.088;
    if (!this.throttle('shoot', gap)) return;
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const weight = Math.min(1.22, 1 + Math.log2(Math.max(1, squadCount)) * 0.04);
    this.shootVariant = (this.shootVariant + 1) % 5;
    const rrPitch = [0.96, 1.02, 0.985, 1.04, 0.945][this.shootVariant]!;

    switch (weapon) {
      case 'scatter': {
        this.playFoley('shotgunPunch', { vol: 0.23 * weight, rate: 0.98 * rrPitch, when: t, panX, dest: this.sfx! });
        this.playFoley('carbineSnap', { vol: 0.09 * weight, rate: 1.32 * rrPitch, when: t + 0.006, panX, dest: this.sfx! });
        break;
      }
      case 'rail': {
        this.playFoley('shotgunPunch', { vol: 0.19 * weight, rate: 1.24 * rrPitch, when: t, panX, dur: 0.095, dest: this.sfx! });
        this.subPunch(112, 38, 0.068, 0.14 * weight, t, panX);
        this.fmBell(880 * rrPitch, 0.082, { ratio: 1.414, modIndex: 1.7, vol: 0.075 * weight, slideTo: 440, when: t, panX, priority: false });
        break;
      }
      case 'plasma': {
        this.playFoley('shotgunPunch', { vol: 0.24 * weight, rate: 0.82 * rrPitch, when: t, panX, dest: this.sfx! });
        this.subPunch(96, 32, 0.085, 0.16 * weight, t, panX);
        break;
      }
      case 'cryo': {
        this.playFoley('carbineSnap', { vol: 0.125 * weight, rate: 1.15 * rrPitch, when: t, panX, dest: this.sfx! });
        this.fmBell(1760 * rrPitch, 0.05, { ratio: 2.5, modIndex: 0.85, vol: 0.038, slideTo: 1320, when: t, panX, priority: false });
        break;
      }
      default: {
        this.playFoley('carbineSnap', { vol: 0.138 * weight, rate: rrPitch, when: t, panX, dest: this.sfx! });
        break;
      }
    }
  }

  shootAux(weapon: string, panX = 0): void {
    if (weapon === 'pulse' || !this.throttle(`aux_${weapon}`, 0.17)) return;
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    // Offset secondary companion salvo slightly in stereo so Lead & Partner calibers never mask each other!
    panX = Math.max(-4.2, Math.min(4.2, panX + (this.shootVariant % 2 === 0 ? 1.15 : -1.15)));
    if (weapon === 'rail') {
      this.fmBell(980, 0.068, { ratio: 1.414, modIndex: 1.35, vol: 0.05, slideTo: 520, when: t, panX, priority: false });
    } else if (weapon === 'plasma') {
      this.playFoley('shotgunPunch', { vol: 0.14, rate: 0.85, when: t, panX, dur: 0.1, dest: this.sfx! });
    } else if (weapon === 'scatter') {
      this.playFoley('shotgunPunch', { vol: 0.14, rate: 1.08, when: t, panX, dur: 0.09, dest: this.sfx! });
    } else if (weapon === 'cryo') {
      this.playFoley('crystalTick', { vol: 0.1, rate: 1.3, when: t, panX, dur: 0.06, dest: this.sfx! });
    }
  }

  // ---------------------------------------------------------------- Round-Robin Tactile Hitmarkers + Z-Depth Air Absorption!
  hit(combo = 0, opts: HitAudioOptions = {}): void {
    const simHits = opts.simultaneousHits ?? 1;
    const minGap = simHits >= 4 ? 0.028 : 0.035;
    if (!this.throttle('hit', minGap)) return;
    const ctx = this.ctx;
    if (!ctx || !this.sfx || this.muted) return;

    const t = ctx.currentTime;
    this.hitVariant = (this.hitVariant + 1) % 7;
    const rates = [0.94, 1.02, 0.97, 1.05, 0.92, 1.0, 1.08];
    const hpRatio = opts.hpRatio ?? 1.0;
    const crackLift = hpRatio < 0.42 ? (0.42 - hpRatio) * 0.34 : 0;
    const baseRate = rates[this.hitVariant]! + Math.min(0.1, combo * 0.0018) + crackLift;
    const panX = opts.x ?? 0;
    const worldZ = opts.z;
    const weapon = opts.weapon ?? 'pulse';
    const kind = opts.kind;
    const dmg = opts.damage ?? 10;
    const heavyCaliber = weapon === 'rail' || weapon === 'plasma' || weapon === 'scatter' || dmg >= 28;

    const triggerHitVoice = (when: number, vPan: number, vGain: number, vPitch: number): void => {
      const r = baseRate * vPitch;
      if (kind === 'bastion' || kind === 'phalanx' || kind === 'burrower') {
        this.playFoley('armorPing', { vol: 0.27 * vGain, rate: (kind === 'bastion' ? 0.88 : 1.04) * r, when, panX: vPan, worldZ });
        this.playFoley('hitThock', { vol: 0.22 * vGain, rate: 0.92 * r, when, panX: vPan, worldZ });
      } else if (kind === 'glacier' || kind === 'beholder' || kind === 'siphon') {
        this.playFoley('crystalTick', { vol: 0.27 * vGain, rate: (kind === 'glacier' ? 0.88 : 1.08) * r, when, panX: vPan, worldZ });
        this.playFoley('hitThock', { vol: 0.2 * vGain, rate: 1.02 * r, when, panX: vPan, worldZ });
      } else {
        this.playFoley('hitThock', {
          vol: (heavyCaliber ? 0.38 : 0.31) * vGain,
          rate: r,
          when,
          panX: vPan,
          worldZ,
        });
      }
    };

    triggerHitVoice(t, panX, 1.0, 1.0);

    if (hpRatio > 0 && hpRatio < 0.25 && kind && kind !== 'crawler' && this.throttle('hit_crack', 0.085)) {
      this.fmBell(1396.91 + (0.25 - hpRatio) * 1400, 0.055, {
        ratio: 2.5,
        modIndex: 1.1,
        vol: 0.052,
        when: t + 0.005,
        panX,
        worldZ,
        priority: false,
      });
    }

    if (simHits >= 4 && this.throttle('hit_cluster', 0.055)) {
      const altPan = Math.max(-4.0, Math.min(4.0, -panX * 0.6 + (this.hitVariant % 2 === 0 ? 1.4 : -1.4)));
      triggerHitVoice(t + 0.016, altPan, 0.6, 1.06);
    }

    if (weapon === 'plasma' && this.throttle('hit_plasma', 0.095)) {
      this.subPunch(108, 38, 0.075, 0.18, t, panX, worldZ);
    }
  }

  chainArc(panX = 0, worldZ?: number): void {
    if (!this.throttle('arc', 0.085)) return;
    this.fmBell(1318.5, 0.085, { ratio: 1.73, modIndex: 2.1, vol: 0.085, slideTo: 659.25, panX, worldZ });
    this.playFoley('hitThock', { vol: 0.18, rate: 1.25, panX, worldZ });
  }

  crit(panX = 0, worldZ?: number): void {
    if (!this.throttle('crit', 0.075)) return;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.playFoley('hitThock', { vol: 0.34, rate: 1.12, when: t, panX, worldZ, priority: true });
    this.fmBell(1174.66, 0.095, { ratio: 2.0, modIndex: 1.45, vol: 0.11, slideTo: 1760, when: t, panX, worldZ, priority: true });
  }

  /**
   * Computes a BGM-harmonized playback rate locked to the active Sector + 8-bar progression root
   * and minor pentatonic intervals (`0, -2, +3, 0, -5` semitones folded gently to ±4.5 semitones),
   * ensuring creature death cries blend musically with the synthwave soundtrack rather than clashing!
   */
  /**
   * 0.00-Cent Exact Integer-Semitone BGM Chord-Locking:
   * All 4 bio-vocal banks are baked on exact harmonics of A (110 / 165 / 220 / 330 Hz = Sector 1 root 55 Hz).
   * We transpose by exact integer semitones `(sectorTranspose + barChordRoot + archetypeDegree + pentatonicVoice)`
   * folded cleanly by octaves (±12) into [-5, +5] semitones — NEVER hard-clamped off-pitch!
   */
  private computeHarmonicCryRate(archetypeSemiOffset: number, intervalStep: number, lockRootOnly = false): number {
    const secSemis: Record<SectorId, number> = { 1: 0, 2: -2, 3: -3, 4: -1 };
    const roots: Record<SectorId, number[]> = {
      1: [0, 0, -4, -2, 0, -5, -4, -2],
      2: [0, -2, -4, -5, 3, 0, -2, -5],
      3: [0, 1, -2, -4, 0, 1, 3, -2],
      4: [0, -5, -2, -7, 0, -4, 3, -2],
    };
    const sec: SectorId = roots[this.musicSector] ? this.musicSector : 1;
    const bar = Math.floor(this.step / 16) % 8;
    const chordSemi = (secSemis[sec] ?? 0) + (roots[sec][bar] ?? 0);
    const voiceOffsets = lockRootOnly ? [0, 0, -5, 0] : [0, 3, -2, 0, -5];
    let totalSemi = chordSemi + archetypeSemiOffset + voiceOffsets[Math.abs(intervalStep) % voiceOffsets.length]!;
    while (totalSemi > 5) totalSemi -= 12;
    while (totalSemi < -6) totalSemi += 12;
    return Math.pow(2, totalSemi / 12);
  }

  /**
   * Plays an archetype-matched, BGM-key-harmonized creature death vocalization with:
   *  - Strict concurrent cry cap (max 2 for fodder/T2, max 3 including Tier-3/4 Elites) so swarms NEVER sound messy!
   *  - 18ms post-impact onset offset so weapon hit/crack transients punch cleanly before the vocal blooms!
   *  - Full 3D Z-depth air-absorption & canyon reverb integration via `this.vocalBus`!
   */
  public triggerDeathCry(
    kind: EnemyKind,
    opts: {
      when?: number;
      panX?: number;
      worldZ?: number;
      density?: number;
      forceChorus?: boolean;
      intervalHint?: number;
    } = {},
  ): boolean {
    const ctx = this.ctx;
    const dest = this.vocalBus ?? this.sfx;
    if (!ctx || !dest || this.muted) return false;

    const now = ctx.currentTime;
    while (this.activeCryEnds.length > 0 && this.activeCryEnds[0]! <= now) {
      this.activeCryEnds.shift();
    }

    const isTier4 = kind === 'bastion' || kind === 'glacier' || kind === 'brood';
    const isTier3 = kind === 'phalanx' || kind === 'howler' || kind === 'beholder' || kind === 'necromancer' || kind === 'siphon';
    const isFodder = kind === 'crawler';
    const density = opts.density ?? 1;

    // Anti-cacophony coordination: cap simultaneous cries & gently pace fodder gasps during dense waves!
    const maxVoices = isTier4 || isTier3 || opts.forceChorus ? 3 : 2;
    if (this.activeCryEnds.length >= maxVoices) return false;

    if (!opts.forceChorus) {
      if (isFodder) {
        const fodderGap = density >= 5 ? 0.22 : density >= 3 ? 0.16 : 0.115;
        if (!this.throttle('cry_fodder', fodderGap)) return false;
      } else if (!isTier4 && !isTier3) {
        if (!this.throttle('cry_mid', 0.11)) return false;
      } else {
        if (!this.throttle(`cry_elite_${kind}`, 0.095)) return false;
      }
    }

    let family: VocalCryFamily = 'swarmChitter';
    let semiOffset = 0;
    let lockRoot = false;
    let baseVol = 0.26;

    // Exact consonant semitone offsets (0 = root/5th, -3 = minor 3rd, -5 = perfect 4th, +3 = minor 3rd up)
    switch (kind) {
      case 'bastion':
        family = 'titanRoar';
        semiOffset = -3;
        lockRoot = true;
        baseVol = 0.42;
        break;
      case 'glacier':
        family = 'titanRoar';
        semiOffset = -2;
        lockRoot = true;
        baseVol = 0.38;
        break;
      case 'brood':
        family = 'titanRoar';
        semiOffset = 0;
        lockRoot = true;
        baseVol = 0.4;
        break;
      case 'phalanx':
        family = 'titanRoar';
        semiOffset = 2;
        lockRoot = true;
        baseVol = 0.32;
        break;
      case 'siphon':
        family = 'wraithWail';
        semiOffset = 0; // Glides 5th -> exact active BGM chord root!
        lockRoot = true;
        baseVol = 0.31;
        break;
      case 'beholder':
        family = 'wraithWail';
        semiOffset = -2;
        lockRoot = true;
        baseVol = 0.32;
        break;
      case 'necromancer':
        family = 'wraithWail';
        semiOffset = -5;
        lockRoot = true;
        baseVol = 0.34;
        break;
      case 'howler':
        family = 'feralSnarl';
        semiOffset = 3; // Haunting minor-3rd dire-wolf howl!
        baseVol = 0.34;
        break;
      case 'dasher':
        family = 'feralSnarl';
        semiOffset = 0;
        baseVol = 0.28;
        break;
      case 'bomber':
        family = 'feralSnarl';
        semiOffset = -2;
        baseVol = 0.27;
        break;
      case 'burrower':
        family = 'feralSnarl';
        semiOffset = -3;
        baseVol = 0.28;
        break;
      case 'stalker':
        family = 'swarmChitter';
        semiOffset = -2;
        baseVol = 0.25;
        break;
      case 'mitosis':
        family = 'swarmChitter';
        semiOffset = 3;
        baseVol = 0.25;
        break;
      default:
        family = 'swarmChitter';
        semiOffset = 0;
        baseVol = 0.22;
        break;
    }

    this.cryStepCounter = (this.cryStepCounter + 1) % 12;
    const rate = this.computeHarmonicCryRate(semiOffset, opts.intervalHint ?? this.cryStepCounter, lockRoot);
    const densityTrim = 1 / (1 + Math.max(0, density - 1) * 0.14);
    const tStart = Math.max(now, opts.when ?? now) + 0.018;
    const buf = this.foleyBanks[family];
    const estDur = (buf ? buf.duration : 0.24) / rate;

    this.activeCryEnds.push(tStart + estDur * 0.82);
    this.activeCryEnds.sort((a, b) => a - b);
    this.lastCryFamily = family;
    this.lastCryRate = rate;
    this.totalCriesPlayed++;

    this.playFoley(family, {
      vol: baseVol * densityTrim,
      rate,
      when: tStart,
      panX: opts.panX,
      worldZ: opts.worldZ,
      dest,
      priority: true,
    });
    return true;
  }

  /**
   * Coordinated Stereo Death Chorus for AoE Set-Pieces (SkyCargo Slam, Maglev Sweep, Jump Slam, Bomber Blast):
   * Instead of chaotic simultaneous screams, weaves 2–3 staggered minor-chord creature cries across stereo & depth!
   */
  public hordeDeathChorus(kills: number, panX = 0, worldZ?: number): void {
    if (kills < 2 || !this.throttle('horde_chorus', 0.26)) return;
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const voices: Array<{ kind: EnemyKind; dt: number; dx: number; step: number }> =
      kills >= 6
        ? [
            { kind: 'dasher', dt: 0.015, dx: -1.6, step: 0 },
            { kind: 'siphon', dt: 0.075, dx: 1.6, step: 1 },
            { kind: 'phalanx', dt: 0.14, dx: 0, step: 4 },
          ]
        : [
            { kind: 'crawler', dt: 0.015, dx: -1.3, step: 0 },
            { kind: 'dasher', dt: 0.075, dx: 1.3, step: 1 },
          ];
    for (const v of voices) {
      this.triggerDeathCry(v.kind, {
        when: t + v.dt,
        panX: Math.max(-4.2, Math.min(4.2, panX + v.dx)),
        worldZ,
        density: 2,
        forceChorus: true,
        intervalHint: v.step,
      });
    }
  }

  // ---------------------------------------------------------------- 4-Tier Priority-Protected Monster Kill Confirmations + Harmonized Death Cries
  killEnemy(kind: EnemyKind, combo = 0, delaySec = 0, panX = 0, worldZ?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || this.muted) return;

    const isTier4 = kind === 'bastion' || kind === 'glacier' || kind === 'brood';
    const isTier3 = kind === 'phalanx' || kind === 'howler' || kind === 'beholder' || kind === 'necromancer' || kind === 'siphon';
    const minGap = isTier4 ? 0.042 : isTier3 ? 0.034 : 0.028;
    if (delaySec <= 0 && !this.throttle(`ke_${kind}`, minGap)) return;

    const now = ctx.currentTime;
    while (this.recentKillTimes.length > 0 && now - this.recentKillTimes[0]! > 0.24) {
      this.recentKillTimes.shift();
    }
    this.recentKillTimes.push(now);
    const density = this.recentKillTimes.length;
    const gainDuck = 1 / (1 + Math.max(0, density - 1) * 0.15);
    const zDuckScale = worldZ !== undefined && worldZ < -42 ? 0.62 : 1.0;

    this.killVariant = (this.killVariant + 1) % 5;
    const pentaSemis = [0, 3, 5, 7, 10];
    const semi = pentaSemis[(combo + this.killVariant) % 5]! + Math.min(12, Math.floor(combo / 10) * 2);
    const noteFreq = 523.25 * Math.pow(2, semi / 12);
    const rateJitter = 0.94 + this.killVariant * 0.03;
    const t0 = now + (delaySec > 0 ? delaySec : density > 1 ? Math.random() * 0.012 : 0);

    if (isTier4) {
      this.duckMusic(0.44 * zDuckScale, 0.05, 0.18);
      this.playFoley('heavyBoom', { vol: 0.48 * gainDuck, rate: 0.92, when: t0, panX, worldZ, dur: 0.34, priority: true });
      if (kind === 'glacier') {
        this.playFoley('crystalTick', { vol: 0.42 * gainDuck, rate: 0.78, when: t0, panX, worldZ, priority: true });
      } else {
        this.playFoley('armorPing', { vol: 0.38 * gainDuck, rate: 0.76, when: t0, panX, worldZ, priority: true });
      }
      this.fmBell(392, 0.26, { ratio: 1.5, modIndex: 1.55, vol: 0.11 * gainDuck, when: t0 + 0.015, panX, worldZ, priority: true });
      this.fmBell(587.33, 0.28, { ratio: 2.0, modIndex: 1.2, vol: 0.095 * gainDuck, when: t0 + 0.035, panX, worldZ, priority: true });
    } else if (isTier3) {
      this.duckMusic(0.26 * zDuckScale, 0.035, 0.12);
      this.playFoley('killPop', { vol: 0.42 * gainDuck, rate: 0.84 * rateJitter, when: t0, panX, worldZ, priority: true });
      this.playFoley(kind === 'phalanx' ? 'armorPing' : 'crystalTick', {
        vol: 0.3 * gainDuck,
        rate: 0.95 * rateJitter,
        when: t0,
        panX,
        worldZ,
        priority: true,
      });
      this.fmBell(noteFreq * 0.75, 0.16, { ratio: 2.0, modIndex: 1.2, vol: 0.08 * gainDuck, when: t0 + 0.01, panX, worldZ, priority: true });
    } else if (kind === 'bomber') {
      this.playFoley('heavyBoom', { vol: 0.38 * gainDuck, rate: 1.15 * rateJitter, when: t0, panX, worldZ, dur: 0.24, priority: true });
      this.playFoley('killPop', { vol: 0.36 * gainDuck, rate: 0.9 * rateJitter, when: t0, panX, worldZ, priority: true });
    } else {
      const isT2 = kind !== 'crawler';
      this.playFoley('killPop', {
        vol: (isT2 ? 0.4 : 0.33) * gainDuck,
        rate: (isT2 ? 0.9 : 1.04) * rateJitter,
        when: t0,
        panX,
        worldZ,
        priority: isT2,
      });
      if (density <= 4) {
        this.fmBell(noteFreq, isT2 ? 0.095 : 0.065, {
          ratio: 2.0,
          modIndex: 0.85,
          vol: (isT2 ? 0.062 : 0.042) * gainDuck,
          when: t0 + 0.006,
          panX,
          worldZ,
          priority: isT2,
        });
      }
    }

    // Layer harmonized, density-gated creature death cry 18ms behind the impact transient!
    this.triggerDeathCry(kind, {
      when: t0,
      panX,
      worldZ,
      density,
      intervalHint: combo + this.killVariant,
    });
  }

  kill(big: boolean, combo = 0): void {
    this.killEnemy(big ? 'bastion' : 'crawler', combo);
  }

  // ---------------------------------------------------------------- Priority-Protected Combat Abilities & AAA Set-Pieces
  explosion(chain: number, panX = 0, worldZ?: number): void {
    if (!this.throttle('boom', 0.05)) return;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const pitch = 0.88 + Math.min(chain, 6) * 0.05;
    const duckScale = worldZ !== undefined && worldZ < -45 ? 0.68 : 1.0;
    this.duckMusic(0.5 * duckScale, 0.06, 0.2);
    this.playFoley('heavyBoom', { vol: 0.58, rate: pitch, when: t, panX, worldZ, priority: true });
    this.subPunch(112 * pitch, 30, 0.38, 0.38, t, panX, worldZ);
  }

  shieldBreak(panX = 0, worldZ?: number): void {
    if (!this.throttle('shieldbreak', 0.07)) return;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckMusic(0.34, 0.04, 0.12);
    this.playFoley('crystalTick', { vol: 0.42, rate: 0.92, when: t, panX, worldZ, priority: true });
    this.playFoley('armorPing', { vol: 0.32, rate: 1.15, when: t + 0.008, panX, worldZ, priority: true });
    this.fmBell(1567.98, 0.14, { ratio: 1.414, modIndex: 1.8, vol: 0.1, slideTo: 783.99, when: t, panX, worldZ, priority: true });
  }

  armorBreak(panX = 0, worldZ?: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.triggerUltimateDuck(0.22);
    this.subPunch(124, 26, 0.42, 0.44, t, panX, worldZ);
    this.playFoley('heavyBoom', { vol: 0.52, rate: 0.92, when: t, panX, worldZ, priority: true });
    this.playFoley('armorPing', { vol: 0.44, rate: 0.76, when: t, panX, worldZ, priority: true });
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this.fmBell(f, 0.24, { ratio: 2.0, modIndex: 1.3, vol: 0.095, when: t + i * 0.038, panX, worldZ, priority: true }),
    );
  }

  glacierNova(panX = 0, worldZ?: number): void {
    if (!this.throttle('glaciernova', 0.1)) return;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckMusic(0.4, 0.05, 0.16);
    this.playFoley('crystalTick', { vol: 0.46, rate: 0.78, when: t, panX, worldZ, priority: true });
    this.playFoley('heavyBoom', { vol: 0.34, rate: 1.15, when: t, panX, worldZ, dur: 0.26, priority: true });
    this.fmBell(1046.5, 0.22, { ratio: 2.5, modIndex: 1.4, vol: 0.09, slideTo: 2093, when: t + 0.01, panX, worldZ, priority: true });
  }

  /**
   * Supersonic Maglev Express Lateral Sweep:
   * Full stereo Doppler pan (-dir -> +dir) + twin-fifth Doppler pitch-drop horn + rail thunder!
   */
  maglevPass(dir: 1 | -1, worldZ = -18): void {
    if (!this.throttle('maglev_pass', 0.38)) return;
    const ctx = this.ctx;
    if (!ctx || !this.sfx || this.muted) return;

    const t = ctx.currentTime;
    this.duckMusic(0.46, 0.12, 0.24);
    this.subPunch(122, 28, 0.52, 0.38, t, 0, worldZ);

    const depthOut = this.routeSpatial(0, worldZ, this.impactBus ?? this.sfx);
    let sweepBus: AudioNode = depthOut;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(-dir * 0.9, t);
      panner.pan.linearRampToValueAtTime(dir * 0.9, t + 0.56);
      panner.connect(depthOut);
      sweepBus = panner;
    }

    // 1. Twin-Fifth Doppler Maglev Horn (rises on approach 0..0.20s, drops sharply as train passes 0.20..0.60s!)
    const hornNotes = [369.99, 554.37];
    for (let i = 0; i < hornNotes.length; i++) {
      const fBase = hornNotes[i]!;
      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(fBase * 0.96, t);
      osc.frequency.exponentialRampToValueAtTime(fBase * 1.15, t + 0.19);
      osc.frequency.exponentialRampToValueAtTime(fBase * 0.71, t + 0.6);

      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(920, t);
      lp.frequency.exponentialRampToValueAtTime(2400, t + 0.2);
      lp.frequency.exponentialRampToValueAtTime(640, t + 0.6);

      g.gain.setValueAtTime(0.0002, t);
      g.gain.exponentialRampToValueAtTime(i === 0 ? 0.14 : 0.105, t + 0.18);
      g.gain.exponentialRampToValueAtTime(0.0002, t + 0.62);

      osc.connect(lp).connect(g).connect(sweepBus);
      osc.start(t);
      osc.stop(t + 0.64);
    }

    // 2. Electromagnetic Slipstream Jet Whoosh
    if (this.noiseBuf) {
      const nSrc = ctx.createBufferSource();
      nSrc.buffer = this.noiseBuf;
      nSrc.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.15;
      bp.frequency.setValueAtTime(380, t);
      bp.frequency.exponentialRampToValueAtTime(2550, t + 0.21);
      bp.frequency.exponentialRampToValueAtTime(310, t + 0.58);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0002, t);
      ng.gain.exponentialRampToValueAtTime(0.28, t + 0.2);
      ng.gain.exponentialRampToValueAtTime(0.0002, t + 0.6);
      nSrc.connect(bp).connect(ng).connect(sweepBus);
      nSrc.start(t);
      nSrc.stop(t + 0.62);
    }
  }

  /**
   * Tactical Helmet Radio Comms (`480–2650 Hz` walkie-talkie bandpass + Quindar PTT beep + dual-formant voice cadence):
   * Delivers crisp, non-fatiguing cyberpunk command dispatch cues on key battlefield events!
   */
  radioComms(topic: RadioCommsTopic): void {
    if (!this.throttle('radio_comms', 1.1)) return;
    const ctx = this.ctx;
    if (!ctx || !this.sfx || this.muted) return;
    this.lastCommsTopic = topic;

    const t = ctx.currentTime;
    // Walkie-talkie radio filter chain: HP 480Hz -> mild saturation -> LP 2650Hz
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 480;
    hp.Q.value = 0.85;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2650;
    lp.Q.value = 1.05;

    const radioGain = ctx.createGain();
    radioGain.gain.value = 0.86;

    if (typeof ctx.createWaveShaper === 'function') {
      const radioShaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i * 2) / 255 - 1;
        curve[i] = Math.tanh(x * 2.15) * 0.88;
      }
      radioShaper.curve = curve;
      hp.connect(radioShaper).connect(lp).connect(radioGain).connect(this.sfx);
    } else {
      hp.connect(lp).connect(radioGain).connect(this.sfx);
    }

    // 1. Opening PTT Squelch Click + NASA/Tactical Quindar Intro Tone (2475 Hz, 34ms)
    this.noise(0.022, { vol: 0.14, freq: 1950, type: 'bandpass', q: 1.2, when: t, dest: hp });
    const qIn = ctx.createOscillator();
    const qInG = ctx.createGain();
    qIn.type = 'sine';
    qIn.frequency.setValueAtTime(2475, t + 0.012);
    qInG.gain.setValueAtTime(0.055, t + 0.012);
    qInG.gain.exponentialRampToValueAtTime(0.0003, t + 0.048);
    qIn.connect(qInG).connect(hp);
    qIn.start(t + 0.012);
    qIn.stop(t + 0.052);

    // 2. Articulated Dual-Formant Comms Cadence (Topic-Distinct Tactical Telemetry)
    const cadences: Record<RadioCommsTopic, Array<{ dt: number; dur: number; f0: number; f1: number; f2: number }>> = {
      cargo: [
        { dt: 0.062, dur: 0.068, f0: 158, f1: 680, f2: 1460 },
        { dt: 0.142, dur: 0.062, f0: 182, f1: 560, f2: 1890 },
        { dt: 0.218, dur: 0.088, f0: 172, f1: 730, f2: 1620 },
      ],
      maglev: [
        { dt: 0.058, dur: 0.055, f0: 188, f1: 760, f2: 1960 },
        { dt: 0.125, dur: 0.055, f0: 204, f1: 620, f2: 1720 },
        { dt: 0.192, dur: 0.058, f0: 180, f1: 810, f2: 2140 },
        { dt: 0.262, dur: 0.082, f0: 214, f1: 690, f2: 1860 },
      ],
      boss: [
        { dt: 0.062, dur: 0.078, f0: 134, f1: 610, f2: 1280 },
        { dt: 0.152, dur: 0.068, f0: 148, f1: 540, f2: 1520 },
        { dt: 0.234, dur: 0.095, f0: 126, f1: 670, f2: 1380 },
      ],
      overdrive: [
        { dt: 0.058, dur: 0.06, f0: 170, f1: 640, f2: 1680 },
        { dt: 0.13, dur: 0.064, f0: 196, f1: 720, f2: 1980 },
        { dt: 0.206, dur: 0.086, f0: 224, f1: 790, f2: 2220 },
      ],
    };

    const seq = cadences[topic];
    let endT = t + 0.32;
    for (let i = 0; i < seq.length; i++) {
      const syl = seq[i]!;
      const st = t + syl.dt;
      endT = Math.max(endT, st + syl.dur);

      const glottal = ctx.createOscillator();
      glottal.type = 'sawtooth';
      glottal.frequency.setValueAtTime(syl.f0, st);
      glottal.frequency.linearRampToValueAtTime(syl.f0 * (i === seq.length - 1 ? 0.94 : 1.05), st + syl.dur);

      const form1 = ctx.createBiquadFilter();
      form1.type = 'bandpass';
      form1.frequency.setValueAtTime(syl.f1, st);
      form1.Q.value = 4.2;

      const form2 = ctx.createBiquadFilter();
      form2.type = 'bandpass';
      form2.frequency.setValueAtTime(syl.f2, st);
      form2.Q.value = 5.0;

      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0003, st);
      sg.gain.exponentialRampToValueAtTime(0.115, st + 0.012);
      sg.gain.exponentialRampToValueAtTime(0.0004, st + syl.dur);

      glottal.connect(form1).connect(sg);
      glottal.connect(form2).connect(sg);
      sg.connect(hp);
      glottal.start(st);
      glottal.stop(st + syl.dur + 0.01);
    }

    // 3. Closing PTT Release Squelch + Quindar Out-Beep (2525 Hz -> 2375 Hz)
    const qOut = ctx.createOscillator();
    const qOutG = ctx.createGain();
    qOut.type = 'sine';
    qOut.frequency.setValueAtTime(2375, endT + 0.008);
    qOutG.gain.setValueAtTime(0.048, endT + 0.008);
    qOutG.gain.exponentialRampToValueAtTime(0.0003, endT + 0.042);
    qOut.connect(qOutG).connect(hp);
    qOut.start(endT + 0.008);
    qOut.stop(endT + 0.046);
    this.noise(0.028, { vol: 0.12, freq: 1820, type: 'bandpass', q: 1.1, when: endT + 0.02, dest: hp });
  }

  howlerPurge(panX = 0, worldZ?: number): void {
    if (!this.throttle('howlerpurge', 0.12)) return;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.subPunch(118, 36, 0.22, 0.24, t, panX, worldZ);
    this.fmBell(587.33, 0.22, { ratio: 2.0, modIndex: 1.2, vol: 0.1, slideTo: 1174.66, when: t, panX, worldZ, priority: true });
  }

  phaseBlink(panX = 0, worldZ?: number): void {
    if (!this.throttle('phaseblink', 0.14)) return;
    this.fmBell(1480, 0.075, { ratio: 1.5, modIndex: 1.2, vol: 0.055, slideTo: 480, panX, worldZ });
  }

  watcherShot(panX = 0, worldZ?: number): void {
    if (!this.throttle('watchershot', 0.14)) return;
    this.fmBell(960, 0.11, { ratio: 1.414, modIndex: 1.8, vol: 0.075, slideTo: 340, panX, worldZ });
  }

  burrowErupt(panX = 0, worldZ?: number): void {
    if (!this.throttle('burrowerupt', 0.14)) return;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.playFoley('shotgunPunch', { vol: 0.28, rate: 0.76, when: t, panX, worldZ, priority: true });
    this.playFoley('armorPing', { vol: 0.18, rate: 0.82, when: t + 0.012, panX, worldZ, priority: true });
  }

  necroHeal(panX = 0, worldZ?: number): void {
    if (!this.throttle('necroheal', 0.22)) return;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.fmBell(523.25, 0.16, { ratio: 2.0, modIndex: 0.8, vol: 0.06, when: t, panX, worldZ });
    this.fmBell(783.99, 0.18, { ratio: 2.0, modIndex: 0.8, vol: 0.055, when: t + 0.035, panX, worldZ });
  }

  fusionUnlock(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckMusic(0.5, 0.08, 0.25);
    this.subPunch(120, 32, 0.45, 0.34, t);
    [440, 554.37, 659.25, 880, 1108.73, 1318.5].forEach((f, i) =>
      this.fmBell(f, 0.36, { ratio: 2.0, modIndex: 1.25, vol: 0.105, when: t + i * 0.048, panX: (i - 2.5) * 0.8, priority: true }),
    );
  }

  singularity(panX = 0, worldZ?: number): void {
    if (!this.throttle('singularity', 0.25)) return;
    this.subPunch(96, 30, 0.38, 0.26, undefined, panX, worldZ);
    this.fmBell(880, 0.24, { ratio: 1.5, modIndex: 1.4, vol: 0.07, slideTo: 330, panX, worldZ });
  }

  jumpLaunch(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.subPunch(95, 44, 0.16, 0.22, t);
    this.fmBell(330, 0.28, { ratio: 2.0, modIndex: 1.1, vol: 0.12, slideTo: 990, when: t, priority: true });
  }

  cutbackChime(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.fmBell(880, 0.08, { ratio: 2, modIndex: 0.7, vol: 0.11, when: t });
    this.fmBell(1320, 0.16, { ratio: 2, modIndex: 0.6, vol: 0.10, when: t + 0.065 });
  }

  jumpSlam(hits = 3): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (hits < 3) {
      this.playFoley('heavyBoom', { vol: hits ? 0.18 : 0.065, rate: hits ? 1.2 : 1.7, when: t });
      return;
    }
    this.duckMusic(0.48, 0.06, 0.2);
    this.playFoley('heavyBoom', { vol: 0.54, rate: 0.92, when: t, priority: true });
    this.subPunch(125, 28, 0.4, 0.38, t);
  }

  reflectorBounce(panX = 0): void {
    if (!this.throttle('refbounce', 0.065)) return;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.playFoley('crystalTick', { vol: 0.22, rate: 1.42, when: t, panX });
    this.fmBell(1760, 0.095, { ratio: 2.0, modIndex: 1.25, vol: 0.075, slideTo: 2637, when: t, panX });
    this.fmBell(2637, 0.11, { ratio: 1.5, modIndex: 0.95, vol: 0.052, slideTo: 3520, when: t + 0.014, panX });
  }

  orbReflect(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckMusic(0.4, 0.04, 0.15);
    this.subPunch(118, 36, 0.25, 0.28, t);
    [523.25, 783.99, 1046.5, 1567.98].forEach((f, i) =>
      this.fmBell(f, 0.24, { ratio: 2.0, modIndex: 1.3, vol: 0.11, when: t + i * 0.035, priority: true }),
    );
  }

  aegisPulse(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckMusic(0.42, 0.05, 0.16);
    this.playFoley('heavyBoom', { vol: 0.36, rate: 1.18, when: t, dur: 0.28, priority: true });
    [392, 587.33, 783.99, 1174.66].forEach((f, i) =>
      this.fmBell(f, 0.24, { ratio: 2.0, modIndex: 1.1, vol: 0.09, when: t + i * 0.03, priority: true }),
    );
  }

  nukeChainShatter(kills: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || this.muted) return;
    const bursts = Math.min(5, Math.max(2, Math.ceil(kills / 8)));
    const palette: EnemyKind[] = ['bastion', 'glacier', 'phalanx', 'brood', 'crawler'];
    for (let i = 0; i < bursts; i++) {
      const pan = (i % 2 === 0 ? -1 : 1) * (1.2 + i * 0.6);
      this.killEnemy(palette[i % palette.length]!, i * 4, 0.06 + i * 0.06, pan, -14 - i * 11);
    }
  }

  nukeSiren(duration = 1.8): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t = ctx.currentTime;
    this.duckMusic(0.46, 0.8, 0.4);
    for (let i = 0; i < 2; i++) {
      const s0 = t + i * 0.74;
      this.tone(330, 0.62, { type: 'sawtooth', vol: 0.11, slideTo: 620, attack: 0.06, lpFreq: 1350, when: s0 });
      this.tone(415.3, 0.62, { type: 'sawtooth', vol: 0.085, slideTo: 784, attack: 0.06, lpFreq: 1350, when: s0 });
    }
    const lockTimes = [0.15, 0.55, 0.88, 1.15, 1.36, 1.54, 1.68];
    for (let k = 0; k < lockTimes.length; k++) {
      const wt = lockTimes[k]!;
      if (wt < duration) {
        this.fmBell(1046.5 + k * 110, 0.065, { ratio: 2.0, modIndex: 1.0, vol: 0.075, when: t + wt, priority: true });
      }
    }
  }

  nukeDetonate(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t = ctx.currentTime;
    this.duckMusic(0.86, 1.85, 0.9);
    // Instant vacuum breath-in implosion right before the thermonuclear crack
    this.subPunch(56, 175, 0.042, 0.28, t);
    const b = t + 0.036;
    // Wave 1: Ground-zero blinding thermonuclear detonation
    this.playFoley('heavyBoom', { vol: 0.92, rate: 0.56, when: b, priority: true });
    this.playFoley('heavyBoom', { vol: 0.72, rate: 0.84, when: b + 0.04, panX: -2.4, worldZ: -28, priority: true });
    this.playFoley('heavyBoom', { vol: 0.72, rate: 0.78, when: b + 0.06, panX: 2.4, worldZ: -46, priority: true });
    this.subPunch(165, 20, 2.25, 0.68, b);
    this.noise(2.15, { warm: true, vol: 0.48, freq: 720, slideTo: 42, when: b + 0.03 });
    // Wave 2: Hypersonic shockwave arrival slam synced with screen quake Wave 2 (+0.26s)
    const w2 = b + 0.26;
    this.playFoley('heavyBoom', { vol: 0.85, rate: 0.48, when: w2, priority: true });
    this.subPunch(110, 18, 1.45, 0.54, w2);
    this.noise(1.1, { warm: true, vol: 0.36, freq: 980, slideTo: 65, when: w2 });
    // Wave 3: Rolling tectonic earthquake aftershock rumble (+0.78s)
    const w3 = b + 0.78;
    this.subPunch(68, 22, 1.35, 0.36, w3);
    this.noise(1.55, { warm: true, vol: 0.26, freq: 240, slideTo: 36, when: w3 });
  }

  // ---------------------------------------------------------------- Musical FM Gates, Vaults & UI Rewards
  gateTick(value: number): void {
    if (!this.throttle('gatetick', 0.05)) return;
    const scale = [0, 2, 4, 7, 9];
    const idx = Math.max(0, Math.min(24, value + 10));
    const semis = Math.floor(idx / 5) * 12 + (scale[idx % 5] ?? 0);
    const f = 349.23 * Math.pow(2, semis / 12);
    this.fmBell(f, 0.085, { ratio: 3.0, modIndex: 0.95, vol: 0.095, priority: true });
  }

  gateFlip(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.subPunch(108, 42, 0.2, 0.22, t);
    [523.25, 659.25, 783.99, 987.77, 1174.66].forEach((f, i) =>
      this.fmBell(f, 0.26, { ratio: 2.0, modIndex: 1.15, vol: 0.115, when: t + i * 0.046, priority: true }),
    );
  }

  gatePass(good: boolean, magnitude: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (good) {
      this.subPunch(104, 44, 0.18, 0.22, t);
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      const count = Math.min(5, 2 + Math.floor(magnitude / 7));
      for (let i = 0; i < count; i++) {
        this.fmBell(notes[i]!, 0.22, { ratio: 2.0, modIndex: 1.1, vol: 0.095, when: t + i * 0.04, priority: true });
      }
    } else {
      this.subPunch(116, 32, 0.3, 0.28, t);
      this.tone(196, 0.32, { type: 'sawtooth', vol: 0.12, slideTo: 82, lpFreq: 680, when: t });
      this.tone(207.65, 0.32, { type: 'sawtooth', vol: 0.09, slideTo: 87, lpFreq: 680, when: t });
    }
  }

  vaultHit(panX = 0): void {
    if (!this.throttle('vaulthit', 0.058)) return;
    this.playFoley('armorPing', { vol: 0.19, rate: 1.28 + Math.random() * 0.1, panX, dur: 0.07 });
  }

  powerUp(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.subPunch(114, 38, 0.26, 0.24, t);
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this.fmBell(f, 0.28, { ratio: 2.0, modIndex: 1.2, vol: 0.1, when: t + i * 0.045, priority: true }),
    );
  }

  achievement(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      this.fmBell(f, 0.32, { ratio: 2.0, modIndex: 1.15, vol: 0.105, when: t + i * 0.058, priority: true }),
    );
  }

  lens(panX = 0): void {
    if (!this.throttle('lens', 0.16)) return;
    this.fmBell(1567.98, 0.09, { ratio: 2.5, modIndex: 0.8, vol: 0.055, slideTo: 2349.32, panX });
  }

  overdrive(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckMusic(0.45, 0.06, 0.2);
    this.playFoley('heavyBoom', { vol: 0.42, rate: 1.05, when: t, dur: 0.34, priority: true });
    [261.63, 392, 523.25, 783.99, 1046.5].forEach((f, i) =>
      this.fmBell(f, 0.35, { ratio: 1.5, modIndex: 1.5, vol: 0.1, when: t + i * 0.035, priority: true }),
    );
  }

  loss(amount: number): void {
    if (!this.throttle('loss', 0.085)) return;
    this.playFoley('hitThock', { vol: Math.min(0.38, 0.22 + amount * 0.015), rate: 0.78, priority: true });
    this.subPunch(108, 34, 0.22, 0.26);
  }

  bossWarning(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckMusic(0.55, 0.85, 0.4);
    for (let i = 0; i < 3; i++) {
      this.tone(220, 0.34, { type: 'sawtooth', vol: 0.13, slideTo: 164.81, lpFreq: 980, when: t + i * 0.42 });
      this.subPunch(110, 32, 0.32, 0.28, t + i * 0.42);
    }
  }

  hazardCharge(): void {
    if (!this.throttle('hazard', 0.4)) return;
    this.fmBell(330, 0.38, { ratio: 1.5, modIndex: 1.2, vol: 0.06, slideTo: 660, priority: true });
  }

  bossPhase(): void {
    if (!this.ctx) return;
    this.explosion(2, 0, -20);
  }

  bossDefeat(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const vDest = this.vocalBus ?? this.sfx ?? undefined;
    this.duckMusic(0.68, 1.0, 0.5);
    // Monumental 2-stage Abyssal Boss Death Roar (deep Titan bellow + spectral soul release!)
    this.playFoley('titanRoar', { vol: 0.52, rate: 0.74, when: t + 0.03, panX: -0.8, worldZ: -16, dest: vDest, priority: true });
    this.playFoley('titanRoar', { vol: 0.46, rate: 0.68, when: t + 0.24, panX: 0.8, worldZ: -18, dest: vDest, priority: true });
    this.playFoley('wraithWail', { vol: 0.36, rate: 0.82, when: t + 0.18, panX: 0, worldZ: -16, dest: vDest, priority: true });
    for (let i = 0; i < 5; i++) {
      this.playFoley('heavyBoom', {
        vol: 0.54,
        rate: 0.96 - i * 0.06,
        when: t + i * 0.17,
        panX: i % 2 === 0 ? -2.2 : 2.2,
        worldZ: -18,
        priority: true,
      });
    }
  }

  victory(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.08;
    const seq = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
    seq.forEach((f, i) =>
      this.fmBell(f, i === seq.length - 1 ? 0.85 : 0.22, {
        ratio: 2.0,
        modIndex: 1.2,
        vol: 0.105,
        when: t + i * 0.105,
        priority: true,
      }),
    );
    [261.63, 329.63, 392].forEach((f) =>
      this.tone(f, 1.1, { type: 'triangle', vol: 0.075, attack: 0.03, lpFreq: 1400, when: t + 0.64 }),
    );
  }

  defeat(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [392, 349.23, 311.13, 261.63].forEach((f, i) =>
      this.fmBell(f, 0.42, { ratio: 1.0, modIndex: 0.8, vol: 0.1, slideTo: f * 0.97, when: t + i * 0.22, priority: true }),
    );
  }

  star(i: number): void {
    const f = 659.25 * Math.pow(2, (i * 4) / 12);
    this.fmBell(f, 0.34, { ratio: 2.0, modIndex: 1.25, vol: 0.105, priority: true });
  }

  click(): void {
    this.fmBell(880, 0.032, { ratio: 2.0, modIndex: 0.68, vol: 0.055, slideTo: 580, priority: true });
  }

  // ---------------------------------------------------------------- 4-Stem Vertical Adaptive Synthwave Soundtrack
  setMusic(sector: SectorId, intensity: 0 | 1 | 2): void {
    const validSector: SectorId = sector === 1 || sector === 2 || sector === 3 || sector === 4 ? sector : 1;
    this.musicSector = validSector;
    this.intensity = intensity;
    if (intensity === 0) this.threatTier = 1;
    this.tempo = intensity === 2 ? 138 : intensity === 0 ? 104 : [0, 118, 124, 130, 126][validSector] ?? 122;
    this.syncMusicStems();
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
    const spb = 60 / this.tempo / 4;
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextNoteTime, spb);
      this.nextNoteTime += spb;
      this.step = (this.step + 1) % 128;
    }
  }

  private playStep(step: number, t = 0, spb = 0.125): void {
    if (!this.ctx || !this.music) return;
    const when = Math.max(this.ctx.currentTime, t);
    const dDrums = this.stemDrums ?? this.music;
    const dBass = this.stemBass ?? this.music;
    const dArp = this.stemArp ?? this.music;
    const dPadBrass = this.stemPadBrass ?? this.music;

    const roots: Record<SectorId, number[]> = {
      1: [0, 0, -4, -2, 0, -5, -4, -2],
      2: [0, -2, -4, -5, 3, 0, -2, -5],
      3: [0, 1, -2, -4, 0, 1, 3, -2],
      4: [0, -5, -2, -7, 0, -4, 3, -2],
    };
    const sec: SectorId = roots[this.musicSector] ? this.musicSector : 1;
    const baseFreq = [0, 55, 49, 46.25, 51.9][sec] ?? 55;
    const bar = Math.floor(step / 16) % 8;
    const root = roots[sec][bar] ?? 0;
    const s = step % 16;
    const f = (semi: number): number => baseFreq * Math.pow(2, (root + semi) / 12);

    // Stem 1: Drums (Kick + Brushed Hi-Hat + Gated Snare)
    if (this.intensity > 0 && s % 4 === 0) {
      this.tone(104, 0.15, { type: 'sine', vol: 0.42, slideTo: 36, attack: 0.002, when, dest: dDrums });
    }
    if (this.intensity > 0 && (s % 2 === 1 || ((this.feverHot || this.threatTier >= 4) && s % 2 === 0))) {
      const accent = s % 4 === 2;
      this.noise(accent ? 0.046 : 0.026, {
        vol: this.intensity === 2 ? 0.064 : 0.042,
        freq: accent ? 5400 : 6600,
        type: 'bandpass',
        q: 1.1,
        when,
        dest: dDrums,
      });
    }
    if (this.intensity > 0 && s % 8 === 4) {
      this.tone(186, 0.085, { type: 'triangle', vol: 0.16, slideTo: 90, attack: 0.0015, when, dest: dDrums });
      this.noise(0.11, {
        vol: this.intensity === 2 ? 0.145 : 0.095,
        freq: 1920,
        slideTo: 660,
        type: 'bandpass',
        q: 0.9,
        when,
        dest: dDrums,
      });
    }

    // Stem 2: Bass (Sub-Sine Anchor + Envelope-Plucked Analog Sawtooth Bassline)
    if (this.intensity === 0 ? s % 8 === 0 : s % 2 === 0 || this.intensity === 2) {
      const octUp = this.intensity > 0 && s % 4 === 2 ? 12 : 0;
      const bassNote = f(octUp);
      const dur = this.intensity === 0 ? spb * 5.5 : spb * 1.25;
      this.tone(bassNote, dur, {
        type: 'sawtooth',
        vol: this.intensity === 0 ? 0.075 : s % 4 === 0 ? 0.105 : 0.13,
        lpFreq: this.intensity === 0 ? 580 : this.feverHot ? 1420 : 1080,
        lpEndFreq: 195,
        when,
        dest: dBass,
      });
      if (s % 4 === 0) {
        this.tone(f(0), dur, { type: 'sine', vol: this.intensity === 0 ? 0.1 : 0.13, attack: 0.008, when, dest: dBass });
      }
    }

    // Stem 3: Shimmering Stereo FM Neon Pluck Arpeggio + Fever High Counter-Lead
    const arpPatterns: Record<SectorId, number[]> = {
      1: [12, 19, 24, 27, 24, 19, 15, 19],
      2: [12, 15, 19, 22, 27, 22, 19, 15],
      3: [12, 13, 19, 24, 25, 24, 19, 13],
      4: [12, 19, 22, 26, 31, 26, 22, 19],
    };
    if (this.intensity === 0 ? s % 4 === 2 : s % 2 === 0 || this.feverHot) {
      const arp = arpPatterns[sec];
      const semi = arp[s % 8] ?? 12;
      this.fmBell(f(semi) * 2, this.intensity === 0 ? spb * 2.8 : spb * 1.18, {
        ratio: 2.0,
        modIndex: this.intensity === 2 ? 1.15 : this.intensity === 0 ? 0.58 : 0.78,
        vol: this.intensity === 2 ? 0.048 : this.intensity === 0 ? 0.032 : 0.038,
        panX: s % 4 === 0 ? -1.8 : 1.8,
        when,
        dest: dArp,
        priority: true,
      });
    }
    if (this.intensity > 0 && (this.feverHot || this.overlimitActive) && (s === 0 || s === 6 || s === 12 || (this.overlimitActive && s === 10))) {
      const leadSemis = [24, 27, 31];
      const ls = leadSemis[(bar + Math.floor(s / 6)) % leadSemis.length]!;
      this.fmBell(f(ls) * 2, spb * 2.4, {
        ratio: 1.5,
        modIndex: 0.95,
        vol: 0.034,
        panX: s === 6 ? 1.4 : -1.4,
        when,
        dest: dArp,
        priority: true,
      });
    }

    // Stem 5 (V22): Procedural Cyber Synth Lead Solo (evolves dynamically with Combo Fever & Abyssal Heat Tier!)
    if (this.intensity > 0 && this.stemLead && (this.feverHot || this.abyssalHeatTier >= 4 || this.intensity === 2)) {
      const leadScale = sec === 3 || this.abyssalHeatTier >= 6 ? [24, 25, 28, 31, 34, 36, 31, 28] : [24, 27, 29, 31, 34, 36, 34, 31];
      if (s % 2 === 0 || (this.abyssalHeatTier >= 6 && s === 11) || (this.feverHot && s === 15)) {
        const semi = leadScale[(s + bar * 3) % leadScale.length]!;
        const lf = f(semi) * 2;
        this.tone(lf, spb * 1.45, {
          type: 'sawtooth',
          detune: s % 4 === 0 ? 5 : -5,
          vol: 0.026,
          attack: 0.008,
          lpFreq: 2650 + this.abyssalHeatTier * 140,
          lpEndFreq: 860,
          panX: Math.sin(step * 0.45) * 1.6,
          when,
          dest: this.stemLead,
        });
      }
    }

    // Stem 4: Lush Stereo-Detuned Analog Pad + High-Threat / Boss Cyber-Brass Stabs!
    if (s === 0) {
      [12, 15, 19, 22].forEach((semi, idx) => {
        const pf = f(semi) * 2;
        this.tone(pf, spb * 15.6, {
          type: 'sawtooth',
          detune: -6,
          vol: 0.019,
          attack: 0.28,
          lpFreq: 940,
          lpEndFreq: 620,
          panX: -1.6 + idx * 0.4,
          when,
          dest: dPadBrass,
        });
        this.tone(pf, spb * 15.6, {
          type: 'sawtooth',
          detune: 6,
          vol: 0.019,
          attack: 0.28,
          lpFreq: 940,
          lpEndFreq: 620,
          panX: 1.6 - idx * 0.4,
          when,
          dest: dPadBrass,
        });
      });
    }
    if ((this.intensity === 2 || (this.intensity === 1 && this.threatTier >= 4)) && (s === 0 || s === 6 || s === 14)) {
      const stabChord = s === 6 ? [12, 19] : [12, 15, 19];
      for (let i = 0; i < stabChord.length; i++) {
        const bf = f(stabChord[i]!) * 2;
        this.tone(bf, spb * (s === 14 ? 1.8 : 2.6), {
          type: 'sawtooth',
          detune: i % 2 === 0 ? -8 : 8,
          vol: this.intensity === 2 ? 0.028 : 0.02,
          attack: 0.014,
          lpFreq: 2250,
          lpEndFreq: 520,
          panX: (i - 1) * 1.3,
          when,
          dest: dPadBrass,
        });
      }
    }
  }

  // ------------------------------------------------------------------ V20 Stage 4: Doppler, Boss Subsystem Rending & Tactical Vox
  setVoxConfig(enabled: boolean, volume: number): void {
    this.voxEnabled = enabled;
    this.voxVolume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.85));
  }

  /** Supersonic Doppler pitch-glide + stereo sweep for Mag-Rail dashes & close-range beam flybys */
  dopplerPass(panFrom = -2.4, panTo = 2.4, pitchMult = 1.0): void {
    this.totalDopplerPasses += 1;
    if (!this.ctx || !this.sfx || this.muted || !this.throttle('doppler', 0.14)) return;
    const now = this.ctx.currentTime;
    const dur = 0.28;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520 * pitchMult, now);
    osc.frequency.exponentialRampToValueAtTime(195 * pitchMult, now + dur);

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1650 * pitchMult, now);
    bp.frequency.exponentialRampToValueAtTime(480, now + dur);
    bp.Q.value = 1.8;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.11, now + 0.055);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    if (typeof this.ctx.createStereoPanner === 'function') {
      const pan = this.ctx.createStereoPanner();
      pan.pan.setValueAtTime(Math.max(-0.95, Math.min(0.95, panFrom / 3.5)), now);
      pan.pan.linearRampToValueAtTime(Math.max(-0.95, Math.min(0.95, panTo / 3.5)), now + dur);
      osc.connect(bp).connect(g).connect(pan).connect(this.sfx);
    } else {
      osc.connect(bp).connect(g).connect(this.sfx);
    }
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /** Bespoke 3-stage metallic rending + arc snap + 122->24Hz sub-collapse for Boss Subsystem Breaks */
  bossPartShatter(slot: 'left' | 'right' | 'reactor', x = 0, z = -16): void {
    this.armorBreak(x, z);
    if (!this.ctx || !this.impactBus || this.muted) return;
    const now = this.ctx.currentTime;
    const baseF = slot === 'reactor' ? 880 : slot === 'left' ? 680 : 760;
    this.fmBell(baseF, 0.34, {
      ratio: 2.73,
      modIndex: 3.4,
      vol: 0.16,
      panX: x,
      worldZ: z,
      dest: this.impactBus ?? undefined,
      priority: true,
    });
    this.tone(122, 0.44, {
      type: 'sine',
      slideTo: 24,
      vol: 0.28,
      attack: 0.003,
      panX: x,
      dest: this.impactBus ?? undefined,
      when: now + 0.03,
    });
  }

  /** Phase-3 Omega Overdrive siren + atmospheric storm swell */
  omegaOverdriveSiren(): void {
    if (!this.ctx || !this.impactBus || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerUltimateDuck(0.45);
    for (let i = 0; i < 2; i++) {
      const t0 = now + i * 0.24;
      this.tone(330, 0.22, {
        type: 'sawtooth',
        slideTo: 660,
        vol: 0.12,
        lpFreq: 2400,
        lpEndFreq: 950,
        panX: i === 0 ? -1.8 : 1.8,
        when: t0,
        dest: this.impactBus ?? undefined,
      });
    }
    this.tone(92, 0.52, { type: 'sine', slideTo: 30, vol: 0.24, when: now, dest: this.impactBus });
  }

  /** Cinematic Omega Execution time-dilation sub-collapse + crystalline triumph chord */
  omegaExecutionBoom(): void {
    if (!this.ctx || !this.impactBus || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerUltimateDuck(0.75);
    this.tone(136, 0.68, { type: 'sine', slideTo: 22, vol: 0.34, attack: 0.003, when: now, dest: this.impactBus });
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
      this.fmBell(freq, 0.58, {
        ratio: 2.0,
        modIndex: 1.8,
        vol: 0.11,
        panX: (idx - 1.5) * 1.2,
        when: now + 0.05 + idx * 0.035,
        dest: this.impactBus ?? undefined,
        priority: true,
      });
    });
  }

  /** Cyber-synth Formant Holographic Tactical Vox cadence (independent toggle + volume) */
  playTacticalVox(topic: TacticalVoxTopic): void {
    this.lastVoxTopic = topic;
    this.totalVoxPlayed += 1;
    if (!this.voxEnabled || this.voxVolume <= 0.01) return;
    if (!this.ctx || !this.sfx || this.muted || !this.throttle(`vox_${topic}`, 1.2)) return;
    const now = this.ctx.currentTime;
    const patterns: Record<TacticalVoxTopic, number[]> = {
      overlimit: [520, 660, 880, 1040],
      reactor_exposed: [620, 540, 740, 920],
      omega_overdrive: [440, 587, 440, 698],
      omega_execution: [587, 784, 987, 1174],
      afk_lock: [720, 480, 720],
      capacitor: [480, 640, 960],
    };
    const notes = patterns[topic] ?? [520, 680, 840];
    const vGain = 0.085 * this.voxVolume;
    notes.forEach((f0, idx) => {
      const t0 = now + idx * 0.068;
      const osc = this.ctx!.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0 * 0.5, t0);
      osc.frequency.linearRampToValueAtTime(f0 * 0.54, t0 + 0.055);

      const formant = this.ctx!.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.setValueAtTime(920 + (idx % 3) * 440, t0);
      formant.Q.value = 4.2;

      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vGain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.062);

      osc.connect(formant).connect(g).connect(this.sfx!);
      osc.start(t0);
      osc.stop(t0 + 0.066);
    });
  }

  /** Sets Abyssal Protocol Heat Tier (0..10) to modulate Synth Lead & filter brilliance */
  setAbyssalHeat(tier: number): void {
    const next = Math.max(0, Math.min(10, Math.round(tier || 0)));
    if (this.abyssalHeatTier === next) return;
    this.abyssalHeatTier = next;
    this.syncMusicStems();
  }

  /** Stage 4 Micro-Foley: Crystalline-metallic shard floor bounce ping routed through 3D spatial field */
  shardBounceTick(x = 0, z = -6, energy = 0.6): void {
    this.totalShardTicks += 1;
    if (!this.ctx || !this.sfx || this.muted || !this.throttle('shard_tick', 0.048)) return;
    const base = 2350 + ((this.totalShardTicks * 173) % 1350);
    this.fmBell(base, 0.065, {
      ratio: 2.41,
      modIndex: 1.15,
      vol: 0.028 * Math.max(0.3, Math.min(1, energy)),
      panX: x,
      worldZ: z,
      dest: this.sfx ?? undefined,
    });
  }

  /** Stage 4 Micro-Foley: Cyber-servo harmonic shift cue when cycling Tactical Wingman formation */
  wingmanShiftCue(formation: string): void {
    if (!this.ctx || !this.sfx || this.muted) return;
    const now = this.ctx.currentTime;
    const chord =
      formation === 'forward_mirror'
        ? [587.33, 880, 1174.66]
        : formation === 'orbit_guard'
          ? [523.25, 659.25, 987.77]
          : [440, 659.25, 880];
    chord.forEach((freq, i) => {
      this.fmBell(freq, 0.16, {
        ratio: 1.5,
        modIndex: 1.1,
        vol: 0.055,
        panX: (i - 1) * 1.1,
        when: now + i * 0.028,
        dest: this.sfx ?? undefined,
        priority: true,
      });
    });
  }

  /** Stage 4 Micro-Foley: Deep Abyssal Contract lock-in resonance scaling with Heat Tier */
  public vocoderPlays = 0;
  public ambientSlowActive = false;
  private ambientDroneOscA: OscillatorNode | null = null;
  private ambientDroneOscB: OscillatorNode | null = null;
  private ambientDroneGain: GainNode | null = null;

  /** V23 Stage 4: Procedural 5-Band Formant Cyber Vocoder Boss & Nirvana Choir Pad */
  playVocoderChoir(theme: 'pantheon' | 'nemesis' | 'nirvana'): void {
    this.vocoderPlays += 1;
    if (!this.ctx || !this.sfx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const roots =
      theme === 'nirvana'
        ? [146.83, 220.0, 293.66, 440.0]
        : theme === 'nemesis'
          ? [110.0, 155.56, 220.0, 311.13]
          : [98.0, 146.83, 196.0, 293.66];
    const formants =
      theme === 'nirvana'
        ? [520, 1180, 2450, 3300, 4200]
        : [380, 860, 1920, 2780, 3650];
    const dur = theme === 'nirvana' ? 1.35 : 1.05;

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(theme === 'nirvana' ? 0.085 : 0.068, now + 0.08);
    bus.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    bus.connect(this.convolver ?? this.sfx);
    bus.connect(this.sfx);

    const formantSum = ctx.createGain();
    formantSum.gain.value = 0.34;
    formants.forEach((fHz, idx) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(fHz, now);
      bp.frequency.linearRampToValueAtTime(fHz * (idx % 2 === 0 ? 1.16 : 0.88), now + dur * 0.85);
      bp.Q.value = 6.5;
      formantSum.connect(bp).connect(bus);
    });

    roots.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime(freq, now);
      osc.detune.setValueAtTime((i - 1.5) * 9, now);
      osc.connect(formantSum);
      osc.start(now);
      osc.stop(now + dur + 0.03);
    });
  }

  /** V23 Stage 4: Deep-Space Binaural Ambient Sub-Drone during 3A Photo Mode or Nirvana Slow-Mo */
  setAmbientSlowScape(active: boolean): void {
    this.ambientSlowActive = active;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    if (active && !this.muted) {
      if (ctx.state === 'suspended') {
        try { void ctx.resume(); } catch { /* ignore */ }
      }
      if (!this.ambientDroneGain) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 340;
        const oscA = ctx.createOscillator();
        const oscB = ctx.createOscillator();
        oscA.type = 'sine';
        oscB.type = 'triangle';
        oscA.frequency.value = 55.0;
        oscB.frequency.value = 82.41;
        oscA.connect(lp);
        oscB.connect(lp);
        lp.connect(g).connect(this.master);
        oscA.start(now);
        oscB.start(now);
        this.ambientDroneOscA = oscA;
        this.ambientDroneOscB = oscB;
        this.ambientDroneGain = g;
      }
      this.ambientDroneGain.gain.cancelScheduledValues(now);
      this.ambientDroneGain.gain.setTargetAtTime(0.065, now, 0.12);
      if (this.musicDuckFilter) {
        this.musicDuckFilter.frequency.setTargetAtTime(540, now, 0.12);
      }
    } else if (this.ambientDroneGain) {
      this.ambientDroneGain.gain.cancelScheduledValues(now);
      this.ambientDroneGain.gain.setTargetAtTime(0.0001, now, 0.14);
      if (this.musicDuckFilter) {
        this.musicDuckFilter.frequency.setTargetAtTime(11500, now, 0.18);
      }
    }
  }

  abyssalPactCue(heatTier: number): void {
    if (!this.ctx || !this.sfx || this.muted) return;
    const base = 196 * Math.pow(2, Math.min(10, Math.max(0, heatTier)) / 18);
    this.tone(base, 0.22, { type: 'sawtooth', slideTo: base * 1.25, vol: 0.075, lpFreq: 1850, lpEndFreq: 480, dest: this.sfx });
    this.fmBell(base * 3, 0.2, { ratio: 2.0, modIndex: 1.4, vol: 0.05, dest: this.sfx ?? undefined, priority: true });
  }
}
