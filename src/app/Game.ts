import { createSimulation } from '../sim/index';
import type { EndlessUpgradeId, NonNullDefeatReason, SectorId, SimEvent, SimSnapshot, SimulationController } from '../types/game';
import { getEndlessThreat, PROTOCOLS } from '../config/protocols';
import { PLAYER_Z } from '../config/constants';
import { getSectorScript } from '../config/sectors';
import { Renderer, WEAPON_COLOR } from '../render/Renderer';
import { UI, type ResultData } from '../ui/UI';
import { InputController } from '../input/InputController';
import { AudioEngine } from '../audio/AudioEngine';
import { chooseHeuristicTargetX } from './autopilot';
import { BOSS_META, computeCoreReward, SECTOR_CHALLENGES, ENEMY_META, REWARD_META, runModsFromUpgrades, SCORE, SECTOR_META, UPGRADES, type UpgradeId } from './meta';
import { loadSave, writeSave, type SaveData } from './save';

type AppState = 'title' | 'ready' | 'playing' | 'paused' | 'draft' | 'outro' | 'result';

const HINTS: Record<string, string> = {
  mutable: '<b>金框门</b>可以被射击！对准它，把数字打上去',
  lock: '带锁的 ÷ 门：打破锁就会翻转成 <b>×2</b>',
  vault: '击破<b>能量舱</b>获得新武器，重复获得会升级',
  barrel: '射爆<b>电容桶</b>：范围爆炸、可连锁，还能抬高附近金框门',
  lens: '子弹穿过<b>金色棱镜</b>会一分为二并增伤',
  siphon: '<b>噬能骷髅灵</b>正在偷取门的数值，先击毁它！',
  dasher: '红色锁定线：<b>烈焰迅龙</b>即将冲锋，快闪开',
  hazard: '地面红区填满就会轰击，<b>移到安全车道</b>',
  bastion: '<b>重甲巨魔</b>血厚攻高：绕开它，或引爆旁边的电容桶',
};

function autopilotDrag(snap: SimSnapshot): number {
  const tx = chooseHeuristicTargetX(snap);
  return Math.max(-0.32, Math.min(0.32, tx - snap.squadX));
}

export class Game {
  readonly sim: SimulationController = createSimulation();
  readonly renderer: Renderer;
  readonly ui: UI;
  readonly input: InputController;
  readonly audio = new AudioEngine();
  save: SaveData = loadSave();

  state: AppState = 'title';
  sector: SectorId = 1;
  endless = false;
  score = 0;
  private last = 0;
  private readyTimer = 0;
  private outroTimer = 0;
  private pendingResult: ResultData | null = null;
  private fixedLayoutSeed: number | null = null;
  private combo = 0;
  private maxCombo = 0;
  private bossLoss = 0;
  private comboClock = 0;
  private bossWarned = false;
  private hazardSeen = new Set<number>();
  private hintsThisRun = new Set<string>();
  private runTime = 0;
  private autoplay: boolean;
  private raf = 0;
  private lastSnap: SimSnapshot;

  constructor(private readonly stage: HTMLElement, canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    const params = new URLSearchParams(location.search);
    this.autoplay = params.get('autoplay') === '1';
    if (params.get('unlock') === '1') this.save.unlocked = 4;
    const seedParam = params.get('seed');
    if (seedParam !== null) this.fixedLayoutSeed = Math.max(0, Math.floor(Number(seedParam) || 0));

    this.renderer = new Renderer(canvas);
    this.input = new InputController(stage);
    this.ui = new UI(uiRoot, {
      onStart: (s) => this.startRun(s),
      onEndless: () => this.startRun(4, true),
      onProtocol: (id) => this.chooseProtocol(id),
      onPause: () => this.pause(),
      onResume: () => this.resume(),
      onRetry: () => this.startRun(this.sector, this.endless),
      onHome: () => this.toTitle(),
      onNext: () => this.startRun(Math.min(4, this.sector + 1) as SectorId),
      onToggleMute: () => this.toggleMute(),
      onBuy: (id) => this.buyUpgrade(id),
    });
    this.audio.setMuted(this.save.muted);
    this.ui.setMuted(this.save.muted);
    void this.renderer.assetsReady.then(() => {
      if (this.renderer.modelSource === 'procedural') this.ui.toast('模型加载失败，已切换为<b>简化模型</b>', 5000);
    });
    this.ui.onOverdrive = () => this.input.requestOverdrive();
    this.input.onPauseKey = () => {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    };

    const unlock = (): void => {
      this.audio.unlock();
      if (this.state === 'title') this.audio.setMusic(1, 0);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    stage.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.audio.click();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing' || this.state === 'ready') this.pause();
        this.audio.suspend();
      } else if (this.state !== 'paused') {
        this.audio.resume();
      }
    });

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(stage);
    this.resize();

    this.sim.startSector(1);
    this.lastSnap = this.sim.getSnapshot();
    this.toTitle();

    const startSector = Number(params.get('sector'));
    if (params.get('play') === '1' || this.autoplay) {
      if (params.get('mode') === 'endless' || params.get('endless') === '1') this.startRun(4, true);
      else this.startRun((startSector >= 2 && startSector <= 4 ? startSector : 1) as SectorId);
    }
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number): void => {
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private resize(): void {
    const r = this.stage.getBoundingClientRect();
    this.renderer.resize(r.width, r.height);
    this.input.setScale(r.width, this.renderer.visibleWidthAtPlayer());
  }

  // ------------------------------------------------------------------ flow
  toTitle(): void {
    this.state = 'title';
    this.endless = false;
    this.ui.hideProtocols();
    this.ui.hideHud();
    this.ui.showDragHint(false);
    this.ui.showTitle(this.save);
    this.renderer.resetRun();
    this.renderer.setSector(1);
    this.sim.startSector(1); // attract-mode demo run behind the title
    this.audio.setMusic(1, 0);
  }

  startRun(sector: SectorId, endless = false): void {
    if (!endless && sector > this.save.unlocked) return;
    this.audio.unlock();
    this.sector = sector;
    this.endless = endless;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.bossLoss = 0;
    this.comboClock = 0;
    this.bossWarned = false;
    this.hazardSeen.clear();
    this.hintsThisRun.clear();
    this.runTime = 0;
    this.pendingResult = null;
    this.renderer.resetRun();
    if (endless) this.renderer.setEndlessWave(1);
    else this.renderer.setSector(sector);
    this.sim.setSpeedMultiplier(1);
    const layoutSeed = this.fixedLayoutSeed ?? 1 + Math.floor(Math.random() * 0x7ffffffe);
    this.sim.startSector(sector, {
      ...runModsFromUpgrades(this.save.upgrades),
      manualOverdrive: true,
      layoutSeed,
      endless,
      manualEndlessDraft: endless,
    });
    this.lastSnap = this.sim.getSnapshot();
    this.input.reset();
    this.ui.hideTitle();
    this.ui.showHelp(false);
    this.ui.hideResult();
    this.ui.showPause(false);
    this.ui.hideProtocols();
    this.ui.showHud(sector, endless);
    this.state = 'ready';
    this.readyTimer = 0;
    this.ui.showDragHint(true);
    const meta = SECTOR_META[sector];
    const bossLine = endless
      ? `阶段无限 · 首领轮回 · 布局 #${layoutSeed}`
      : sector === 4
        ? `首领 · ${BOSS_META[getSectorScript(sector, layoutSeed).boss.id].title} · 布局 #${layoutSeed}`
        : `首领 · ${meta.bossTitle}`;
    const runTitle = endless ? '无尽协议' : meta.name;
    const runKicker = endless ? 'ENDLESS PROTOCOL · 阶段 1' : meta.subtitle;
    this.ui.showBanner(`<div class="b-kicker">${runKicker}</div><div class="b-title">${runTitle}</div><div class="b-sub">${bossLine}</div>`, 'intro', 1800);
    this.input.onFirstInput = () => this.beginPlay();
    this.audio.setMusic(sector, 1);
  }

  private beginPlay(): void {
    if (this.state !== 'ready') return;
    this.state = 'playing';
    this.ui.showDragHint(false);
    this.input.onFirstInput = null;
  }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'ready') return;
    if (this.state === 'ready') this.beginPlay();
    this.sim.pause();
    this.state = 'paused';
    this.input.reset();
    this.ui.showPause(true, this.sim.getSnapshot());
    this.audio.suspend();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.sim.resume();
    this.input.reset();
    this.state = 'playing';
    this.ui.showPause(false);
    this.audio.resume();
    this.last = performance.now();
  }

  chooseProtocol(id: EndlessUpgradeId): void {
    if (this.state !== 'draft' || !this.sim.chooseEndlessUpgrade(id)) return;
    this.ui.hideProtocols();
    this.input.reset();
    this.state = 'playing';
    this.audio.resume();
    this.audio.powerUp();
    const snap = this.sim.getSnapshot();
    this.lastSnap = snap;
    const threat = getEndlessThreat(snap.endless!.wave);
    this.ui.showBanner(`<div class="b-kicker">PROTOCOL INSTALLED · ${threat.name}</div><div class="b-title">${PROTOCOLS[id].name}</div><div class="b-sub">${threat.description}</div>`, 'od', 1500);
    this.last = performance.now();
  }

  buyUpgrade(id: UpgradeId): void {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return;
    const lv = this.save.upgrades[id];
    const cost = def.costs[lv];
    if (lv >= def.max || cost === undefined || this.save.cores < cost) return;
    this.save.cores -= cost;
    this.save.upgrades[id] = lv + 1;
    writeSave(this.save);
    this.audio.powerUp();
    this.ui.renderWorkshop(this.save, id);
  }

  toggleMute(): void {
    this.save.muted = !this.save.muted;
    this.audio.setMuted(this.save.muted);
    this.ui.setMuted(this.save.muted);
    writeSave(this.save);
  }

  // ------------------------------------------------------------------ per frame
  private frame(dt: number): void {
    let snap = this.lastSnap;
    switch (this.state) {
      case 'title': {
        const s = this.sim.getSnapshot();
        if (s.phase !== 'PLAYING') {
          this.renderer.resetRun();
          this.sim.startSector(1);
        }
        const events = this.sim.tickFrame(dt, { dragDeltaX: autopilotDrag(this.sim.getSnapshot()), keyAxisX: 0 });
        snap = this.sim.getSnapshot();
        this.handleEvents(events, snap, false);
        break;
      }
      case 'ready': {
        this.readyTimer += dt;
        if (this.readyTimer > 2.4) this.beginPlay();
        snap = this.sim.getSnapshot();
        break;
      }
      case 'playing': {
        this.runTime += dt;
        const pre = this.sim.getSnapshot();
        const drag = this.autoplay ? autopilotDrag(pre) : this.input.consumeDrag();
        const axis = this.autoplay ? 0 : this.input.keyAxis;
        const overdrive = this.input.consumeOverdrive() || this.autoplay;
        const events = this.sim.tickFrame(dt, { dragDeltaX: drag, keyAxisX: axis, overdrive });
        snap = this.sim.getSnapshot();
        this.handleEvents(events, snap, true);
        this.liveChecks(snap, dt);
        break;
      }
      case 'draft':
      case 'paused':
        snap = this.sim.getSnapshot();
        dt = 0;
        break;
      case 'outro': {
        snap = this.sim.getSnapshot();
        this.outroTimer -= dt;
        if (this.outroTimer <= 0 && this.pendingResult) {
          this.showResult(this.pendingResult);
        }
        break;
      }
      case 'result':
        snap = this.sim.getSnapshot();
        break;
    }
    this.lastSnap = snap;
    this.renderer.render(snap, dt, this.state === 'outro' || this.state === 'result');
    if (this.state !== 'title') {
      // 55+ fields a vanguard assault mech at the formation's front edge; float the badge above its head
      const badgeY = snap.squadCount >= 55 ? 2.95 : snap.squadCount >= 14 ? 1.86 : 1.68;
      const p = this.renderer.project(snap.squadX, badgeY, PLAYER_Z - snap.formationRadius - 0.25);
      this.ui.updateHud(snap, this.score, p);
    }
    this.ui.updateFloats(dt);
    this.stage.dataset.state = this.state;
  }

  private worldToScreen(x: number, y: number, z: number): { x: number; y: number } {
    const p = this.renderer.project(x, y, z);
    return { x: p.x, y: p.y };
  }

  private liveChecks(snap: SimSnapshot, dt: number): void {
    // kill-streak combo window
    if (this.comboClock > 0) {
      this.comboClock -= dt;
      if (this.comboClock <= 0) this.combo = 0;
    }
    // pre-boss warning (the "wind-up" before the boss arrives)
    if (!this.bossWarned && snap.runwayProgress > 0.955 && !snap.boss) {
      this.bossWarned = true;
      const meta = SECTOR_META[snap.sector];
      this.ui.bossWarning(
        this.endless ? '轮回首领' : meta.bossName,
        this.endless ? `无尽阶段 ${snap.endless?.wave ?? 1}` : meta.bossTitle,
      );
      this.audio.bossWarning();
      this.ui.doFlash('rgba(255,30,60,0.6)', 0.35);
    }
    // hazard charge cue
    if (snap.boss) {
      for (const hz of snap.boss.hazardZones) {
        if (!this.hazardSeen.has(hz.id)) {
          this.hazardSeen.add(hz.id);
          this.audio.hazardCharge();
          this.hint('hazard');
        }
      }
    }
    // contextual one-time tutorial hints
    const near = (z: number): boolean => z > -55;
    for (const g of snap.gates) {
      if (near(g.z) && !g.triggered && !g.dimmed) {
        if (g.lockHp > 0) this.hint('lock');
        else if (g.mutable) this.hint('mutable');
      }
    }
    if (snap.vaults.some((v) => near(v.z) && !v.broken)) this.hint('vault');
    if (snap.barrels.some((b) => near(b.z) && !b.detonated)) this.hint('barrel');
    if (snap.lenses.some((l) => near(l.z))) this.hint('lens');
    for (const e of snap.enemies) {
      if (e.kind === 'siphon' && near(e.z)) this.hint('siphon');
      else if (e.kind === 'dasher' && e.telegraphTimer > 0) this.hint('dasher');
      else if (e.kind === 'bastion' && near(e.z) && !snap.boss) this.hint('bastion');
    }
  }

  private hint(key: string): void {
    if (this.hintsThisRun.has(key) || this.save.seenHints.includes(key)) return;
    this.hintsThisRun.add(key);
    this.save.seenHints.push(key);
    writeSave(this.save);
    const html = HINTS[key];
    if (html) this.ui.toast(html, 3000);
  }

  // ------------------------------------------------------------------ events → feedback
  private handleEvents(events: readonly SimEvent[], snap: SimSnapshot, live: boolean): void {
    const fx = this.renderer.effects;
    const a = this.audio;
    for (const ev of events) {
      switch (ev.type) {
        case 'SHOOT':
          this.renderer.flashMuzzle();
          if (live) a.shoot(ev.weapon);
          break;
        case 'ENEMY_HIT': {
          const meta = ENEMY_META[ev.kind];
          if (ev.fatal) {
            const big = ev.kind === 'bastion' || ev.kind === 'mitosis' || ev.kind === 'siphon';
            fx.burst(ev.x, 0.7, ev.z, meta.color, big ? 46 : 16, { speed: big ? 9 : 6, size: big ? 0.5 : 0.35, life: 0.55 });
            fx.burst(ev.x, 0.7, ev.z, 0xffffff, big ? 12 : 4, { speed: 4, size: 0.3, life: 0.25 });
            if (big) {
              fx.ring(ev.x, ev.z, meta.color, 2.6, 0.35);
              this.renderer.shake(0.12);
            }
            if (live) {
              a.kill(big);
              this.score += meta.score;
              this.combo += 1;
              if (this.combo > this.maxCombo) this.maxCombo = this.combo;
              this.comboClock = 1.3;
              if (this.combo >= 5 && (this.combo % 5 === 0 || this.combo > 20)) this.ui.combo(this.combo);
              if (ev.kind === 'siphon') {
                const p = this.worldToScreen(ev.x, 1.5, ev.z);
                this.ui.floatText(p.x, p.y, '门数值 +6', 'gold', 1);
              }
            }
          } else {
            fx.burst(ev.x, 0.7, ev.z, meta.color, 2, { speed: 3, size: 0.22, life: 0.18, gravity: 0 });
            if (live) a.hit();
          }
          break;
        }
        case 'GATE_HIT':
          fx.burst(ev.x + (Math.random() - 0.5) * 2, 1.5, ev.z + 0.2, 0xffc531, 3, { speed: 3, size: 0.25, life: 0.25, gravity: 0 });
          if (ev.flippedPositive) {
            fx.burst(ev.x, 1.6, ev.z, 0xffc531, 70, { speed: 9, size: 0.5, life: 0.7 });
            fx.burst(ev.x, 1.6, ev.z, 0x19f5a8, 40, { speed: 7, size: 0.45, life: 0.6 });
            fx.ring(ev.x, ev.z, 0x19f5a8, 4, 0.5);
            if (live) {
              const p = this.worldToScreen(ev.x, 3.4, ev.z);
              this.ui.floatText(p.x, p.y, '负转正！', 'flip', 1.1);
              a.gateFlip();
              this.score += SCORE.gateImproved;
            }
          } else if (live) {
            a.gateTick(ev.newValue);
          }
          break;
        case 'GATE_PASS': {
          const p = this.worldToScreen(snap.squadX, 1.6, PLAYER_Z - 1);
          if (ev.delta > 0) {
            fx.burst(snap.squadX, 0.8, PLAYER_Z, 0x19f5a8, 50, { speed: 8, size: 0.45, life: 0.6, up: 1 });
            fx.ring(snap.squadX, PLAYER_Z, 0x19f5a8, 3.5, 0.45);
            if (live) {
              this.ui.floatText(p.x + 78, p.y - 6, `+${ev.delta}`, 'gain', 1.1);
              a.gatePass(true, ev.delta);
              this.score += ev.delta * SCORE.gateGainPerUnit;
              this.ui.doFlash('rgba(25,245,168,0.5)', 0.18);
            }
          } else if (ev.delta === 0 && live) {
            this.ui.floatText(p.x + 70, p.y - 6, '±0', 'small', 0.9);
          } else if (live) {
            a.gatePass(false, -ev.delta);
          }
          break;
        }
        case 'VAULT_HIT':
          if (live) a.vaultHit();
          break;
        case 'VAULT_BREAK': {
          const meta = REWARD_META[ev.reward];
          fx.burst(ev.x, 1, ev.z, meta.color, 90, { speed: 11, size: 0.55, life: 0.8, up: 1 });
          fx.burst(ev.x, 1, ev.z, 0xffffff, 30, { speed: 6, size: 0.4, life: 0.4 });
          fx.ring(ev.x, ev.z, meta.color, 4.5, 0.5);
          // upgrade "beam" into the swarm
          fx.burst(snap.squadX, 0.8, PLAYER_Z, meta.color, 40, { speed: 5, size: 0.45, life: 0.7, up: 1.6, gravity: -2 });
          this.renderer.shake(0.18);
          if (live) {
            this.ui.rewardBanner(ev.reward, ev.newWeaponLevel);
            a.powerUp();
            this.ui.doFlash(meta.color, 0.22);
            this.score += SCORE.vault;
            if (ev.reward === 'blades') {
              const p = this.worldToScreen(snap.squadX, 1.6, PLAYER_Z - 1);
              this.ui.floatText(p.x + 78, p.y - 6, '+6', 'gain', 1.1);
            }
          }
          break;
        }
        case 'BARREL_EXPLODE':
          fx.burst(ev.x, 0.8, ev.z, 0xff9a1a, 70, { speed: 13, size: 0.6, life: 0.6, up: 0.9 });
          fx.burst(ev.x, 0.8, ev.z, 0xfff2a0, 30, { speed: 7, size: 0.5, life: 0.35 });
          fx.ring(ev.x, ev.z, 0xff9a1a, ev.radius, 0.35);
          this.renderer.shake(0.3 + Math.min(0.3, ev.chainIndex * 0.08));
          if (live) {
            a.explosion(ev.chainIndex);
            this.score += SCORE.barrelBase * (ev.chainIndex + 1);
            if (ev.chainIndex >= 1) {
              const p = this.worldToScreen(ev.x, 2, ev.z);
              this.ui.floatText(p.x, p.y, `连锁 ×${ev.chainIndex + 1}`, 'chain', 1);
            }
          }
          break;
        case 'LENS_REFRACT':
          if (Math.random() < 0.3) fx.burst(ev.x, 0.6, ev.z, 0xffd84a, 2, { speed: 2, size: 0.3, life: 0.2, gravity: 0 });
          if (live) a.lens();
          break;
        case 'OVERDRIVE_START':
          fx.ring(snap.squadX, PLAYER_Z, 0xfff36b, 6, 0.6);
          fx.burst(snap.squadX, 0.8, PLAYER_Z, 0xfff36b, 80, { speed: 10, size: 0.5, life: 0.7, up: 1.2 });
          if (live) {
            this.ui.showBanner('<div class="b-kicker">RESONANCE OVERDRIVE</div><div class="b-title">共鸣超载！</div><div class="b-sub">射速 ×1.5 · 穿透 +1 · 6 秒</div>', 'od', 1300);
            a.overdrive();
            this.ui.doFlash('rgba(255,243,107,0.6)', 0.3);
          }
          break;
        case 'SQUAD_LOSS': {
          fx.burst(ev.x, 0.7, ev.z, 0xff3b5c, Math.min(60, 10 + ev.lost * 4), { speed: 7, size: 0.4, life: 0.5 });
          fx.burst(ev.x, 0.7, ev.z, 0x3ef3ff, Math.min(30, ev.lost * 3), { speed: 5, size: 0.3, life: 0.5 });
          if (live) {
            if (snap.boss) this.bossLoss += ev.lost;
            const p = this.worldToScreen(snap.squadX, 1.6, PLAYER_Z - 1);
            this.ui.floatText(p.x - 78 + (Math.random() - 0.5) * 24, p.y - 6, `-${ev.lost}`, 'loss', 1);
            this.ui.hurt();
            this.renderer.shake(Math.min(0.5, 0.12 + ev.lost * 0.02));
            a.loss(ev.lost);
          }
          break;
        }
        case 'BOSS_INTRO':
          this.renderer.beginBoss();
          this.renderer.shake(0.4);
          fx.ring(0, -20, 0xff3b5c, 10, 1);
          if (live) {
            const m = BOSS_META[ev.bossId];
            this.ui.showBanner(`<div class="b-warn">BOSS</div><div class="b-title">${m.title}</div><div class="b-sub">${m.name} · 击毁核心！</div>`, 'boss', 1600);
            a.setMusic(this.sector, 2);
            a.bossPhase();
          }
          break;
        case 'BOSS_PHASE_BREAK':
          fx.burst(ev.x, 2.4, ev.z, 0xffffff, 120, { speed: 14, size: 0.7, life: 0.8 });
          fx.ring(ev.x, ev.z, 0xff3b5c, 9, 0.7);
          this.renderer.shake(0.6);
          if (live) {
            this.ui.showBanner(`<div class="b-warn">PHASE ${ev.phase}</div><div class="b-title">首领狂暴化</div><div class="b-sub">${ev.phase === 2 ? '攻势加快，注意红区' : '最终形态！'}</div>`, 'boss', 1400);
            this.ui.doFlash('rgba(255,255,255,0.8)', 0.4);
            a.bossPhase();
          }
          break;
        case 'BOSS_DEFEAT': {
          const color = ev.bossId === 'warden_01' ? 0xff2a4a : ev.bossId === 'hydra_02' ? 0xff3fd2 : 0xffc531;
          this.renderer.startBossDeath(ev.x, ev.z, color);
          if (live) {
            a.bossDefeat();
            const completedWave = Math.max(1, (snap.endless?.wave ?? this.sector) - (this.endless ? 1 : 0));
            this.score += SCORE.bossBase * (this.endless ? completedWave * 2 : this.sector);
            fx.after(1.25, () => this.ui.doFlash('rgba(255,255,255,1)', 0.85));
            this.ui.showBanner('<div class="b-kicker">TARGET DESTROYED</div><div class="b-title">首领击破！</div>', 'reward', this.endless ? 900 : 2000);
          }
          break;
        }
        case 'ENDLESS_STAGE_START': {
          this.bossWarned = false;
          this.hazardSeen.clear();
          this.renderer.setEndlessWave(ev.wave);
          if (live) {
            this.score += ev.wave * 500;
            this.ui.showBanner(
              `<div class="b-kicker">ENDLESS · STAGE ${ev.wave}</div><div class="b-title">阶段 ${ev.wave} · 威胁升级</div><div class="b-sub">补员 +${ev.bonus} · 共鸣充满 · 敌潮与首领强化</div>`,
              'od',
              1500,
            );
            const p = this.worldToScreen(snap.squadX, 1.6, PLAYER_Z - 1);
            this.ui.floatText(p.x + 78, p.y - 6, `补员 +${ev.bonus}`, 'gain', 1.1);
            a.setMusic((((ev.wave - 1) % 4) + 1) as SectorId, 1);
            if (snap.endless?.offers.length) {
              this.state = 'draft';
              this.input.reset();
              this.ui.hideBanner();
              this.ui.showProtocols(snap);
              this.audio.suspend();
              if (this.autoplay) this.chooseProtocol(snap.endless.offers[0]!);
            }
          }
          break;
        }
        case 'RUN_VICTORY':
          if (live) this.finishRun(true, snap, null);
          break;
        case 'RUN_DEFEAT':
          fx.burst(snap.squadX, 0.8, PLAYER_Z, 0x3ef3ff, 80, { speed: 9, size: 0.5, life: 0.9 });
          if (live) {
            this.ui.doFlash('rgba(255,30,60,0.8)', 0.5);
            this.renderer.shake(0.6);
            this.finishRun(false, snap, ev.reason);
          }
          break;
      }
    }
  }

  private finishRun(victory: boolean, snap: SimSnapshot, reason: NonNullDefeatReason | null): void {
    const meta = SECTOR_META[this.sector];
    if (victory) this.score += snap.squadCount * SCORE.finalSquadPerUnit;
    const stars = !this.endless && victory ? 1 + (snap.squadCount >= meta.starSquad[0] ? 1 : 0) + (snap.squadCount >= meta.starSquad[1] ? 1 : 0) : 0;
    const rec = this.save.records[this.sector];
    const newBest = this.endless ? this.score > this.save.endless.bestScore : this.score > rec.score;
    const newWaveBest = this.endless && (snap.endless?.wave ?? 1) > this.save.endless.bestWave;
    const reward = computeCoreReward({
      victory,
      stars,
      score: this.score,
      progress: snap.runwayProgress,
      firstClear: !this.endless && victory && !rec.cleared,
      sector: this.sector,
    });
    const chInput = { victory, finalSquad: snap.squadCount, bossLoss: this.bossLoss, maxCombo: this.maxCombo, stats: snap.stats };
    const challenges = (this.endless ? [] : SECTOR_CHALLENGES[this.sector]).map((c) => {
      const already = this.save.challenges.includes(c.id);
      const done = already || c.check(chInput);
      const isNew = done && !already;
      if (isNew) {
        this.save.challenges.push(c.id);
        reward.lines.push([`挑战·${c.text}`, c.reward]);
        reward.total += c.reward;
      }
      return { text: c.text, reward: c.reward, done, isNew };
    });
    this.save.cores += reward.total;
    if (!this.endless && victory) {
      rec.cleared = true;
      rec.stars = Math.max(rec.stars, stars);
      if (this.sector < 4) this.save.unlocked = Math.max(this.save.unlocked, this.sector + 1) as SectorId;
    }
    if (this.endless) {
      const er = this.save.endless;
      er.bestScore = Math.max(er.bestScore, this.score);
      er.bestWave = Math.max(er.bestWave, snap.endless?.wave ?? 1);
      er.bestTime = Math.max(er.bestTime, this.runTime);
      er.bestDistance = Math.max(er.bestDistance, Math.round(snap.endless?.distance ?? 0));
      er.bosses = Math.max(er.bosses, snap.endless?.bosses ?? 0);
    } else {
      rec.score = Math.max(rec.score, this.score);
    }
    writeSave(this.save);
    this.pendingResult = {
      victory,
      sector: this.sector,
      stars,
      score: this.score,
      best: this.endless ? this.save.endless.bestScore : rec.score,
      newBest: newBest && this.score > 0,
      reason,
      hasNext: !this.endless && victory && this.sector < 4,
      ...(this.endless
        ? {
            endless: {
              wave: snap.endless?.wave ?? 1,
              bosses: snap.endless?.bosses ?? 0,
              distance: snap.endless?.distance ?? 0,
              bestWave: this.save.endless.bestWave,
              newWaveBest,
            },
          }
        : {}),
      progress: snap.runwayProgress,
      bossHpFrac: !victory && snap.boss ? Math.max(0, Math.min(1, snap.boss.hp / snap.boss.maxHp)) : null,
      maxCombo: this.maxCombo,
      challenges,
      cores: {
        ...reward,
        balance: this.save.cores,
        affordable: UPGRADES.some((u) => this.save.upgrades[u.id] < u.max && this.save.cores >= u.costs[this.save.upgrades[u.id]]!),
      },
      stats: {
        kills: snap.stats.kills,
        gatesImproved: snap.stats.gatesImproved,
        vaultsCracked: snap.stats.vaultsCracked,
        maxChain: snap.stats.maxChain,
        peakSquad: snap.stats.peakSquad,
        finalSquad: snap.squadCount,
        time: this.runTime,
      },
    };
    this.state = 'outro';
    this.outroTimer = victory ? 2.9 : 1.5;
    this.ui.showDragHint(false);
    if (!victory) this.audio.defeat();
  }

  private showResult(r: ResultData): void {
    this.state = 'result';
    this.pendingResult = null;
    if (r.victory) this.audio.victory();
    this.audio.setMusic(this.sector, 0);
    this.ui.showResult(r, (i) => this.audio.star(i));
  }

  // ------------------------------------------------------------------ debug / verification hooks
  /** Deterministically advances the live run with the autopilot (used by automated verification). */
  fastForward(seconds: number, useAutopilot = true): void {
    if (this.state === 'ready') this.beginPlay();
    if (this.state !== 'playing') return;
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      const s = this.sim.getSnapshot();
      if (s.phase !== 'PLAYING') break;
      const events = this.sim.stepFixed({ dragDeltaX: useAutopilot ? autopilotDrag(s) : 0, keyAxisX: 0, overdrive: useAutopilot });
      this.runTime += 1 / 60;
      this.handleEvents(events, this.sim.getSnapshot(), true);
      this.ui.updateFloats(1 / 60);
      this.renderer.effects.update(1 / 60);
      if (this.state !== 'playing') break;
    }
  }

  get weaponColor(): number {
    return WEAPON_COLOR[this.lastSnap.weapon];
  }
}
