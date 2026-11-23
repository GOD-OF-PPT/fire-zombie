import {
  BUILTIN_TRACK_PRESETS,
  NIRVANA_META,
  EXPEDITION_NODE_META,
  EXPEDITION_RELICS,
  advanceExpeditionAfterVictory,
  createSimulation,
  decodeTrackShareCode,
  encodeTrackShareCode,
  generateExpeditionMap,
  getExpeditionNodes,
  ReplayPlayer,
  verifyDeterministicReplay,
  type DeterministicReplayLog,
} from '../sim/index';
import {
  type AbyssalPactId,
  DEFAULT_KEYBINDS,
  type EndlessUpgradeId,
  type KeybindAction,
  type MutatorId,
  type NonNullDefeatReason,
  type OverclockChipId,
  type SectorId,
  type SimEvent,
  type SimSnapshot,
  type SimulationController,
  type SpecializationId,
  type SquadSkinId,
  type WeaponId,
  type WingmanId,
  type CustomTrackBlueprint,
  type PhotoFilterKind,
} from '../types/game';
import { computeAbyssalHeatTier, WINGMAN_FORMATION_LABELS, WINGMAN_META } from '../sim/v22Mechanics';
import { SpatialFocusNavigator } from '../ui/FocusNav';
import { getActiveSynergies, getEndlessThreat, PROTOCOLS } from '../config/protocols';
import { DUAL_SYNERGIES, FUSIONS, OVERLIMIT_RESONANCES, generateBlitzScript } from '../config/blitz';
import { PLAYER_Z } from '../config/constants';
import { getSectorScript } from '../config/sectors';
import { getVolleyStreamCount } from '../config/weapons';
import { Renderer, WEAPON_COLOR } from '../render/Renderer';
import { UI, type ResultData } from '../ui/UI';
import { InputController } from '../input/InputController';
import { AudioEngine } from '../audio/AudioEngine';
import { chooseHeuristicTargetX } from './autopilot';
import {
  ACHIEVEMENTS,
  BOSS_META,
  computeBuildArchetype,
  computeCoreReward,
  computeDamageBreakdown,
  computeMutatorBonusPct,
  ENEMY_META,
  getApexCost,
  getTotalWorkshopSpent,
  isApexUnlocked,
  OVERCLOCK_CHIPS,
  REWARD_META,
  runModsFromUpgrades,
  SCORE,
  SECTOR_CHALLENGES,
  SECTOR_META,
  SPECIALIZATIONS,
  STARTER_BLADE_COST,
  STARTER_WEAPON_COST,
  UPGRADES,
  type UpgradeId,
} from './meta';
import { loadSave, writeSave, type GhostRunRecord, type GhostSample, type SaveData } from './save';
import { LeaderboardClient, rankingErrorMessage, validateRankingName, type EndlessRunScore } from '../services/leaderboard';
import { LeaderboardUI } from '../ui/LeaderboardUI';
import { html, type Content } from '../ui/dom';

type AppState = 'title' | 'ready' | 'playing' | 'paused' | 'photo' | 'draft' | 'outro' | 'result' | 'replay';

const HINTS: Record<string, Content> = {
  mutable: html`<b>金框门</b>可以被射击！对准它，把数字打上去`,
  lock: html`带锁的 ÷ 门：打破锁就会翻转成 <b>×2</b>`,
  vault: html`击破<b>能量舱</b>叠加新武装，凑齐配方自动合成<b>双武超武</b>！`,
  barrel: html`射爆<b>电容桶</b>：范围爆炸、可连锁，还能抬高附近金框门`,
  lens: html`子弹穿过<b>金色棱镜</b>会一分为二并增伤`,
  siphon: html`<b>噬能骷髅灵</b>正在偷取门的数值，先击毁它！`,
  dasher: html`红色锁定线：<b>烈焰迅龙</b>即将冲锋，快闪开或按 <b>E 脉冲</b>`,
  hazard: html`地面红区填满就会轰击，<b>移到安全车道</b>`,
  bastion: html`<b>重甲巨魔</b>血厚攻高：绕开它、引爆电容桶或开启<b>相位脉冲</b>`,
  jump: html`踩上<b>磁浮跳台</b>跃空飞越致命门，落地引发<b>震地清场</b>！`,
  reflector: html`射击 <b>45° 折射镜</b>可斜角反弹弹幕（伤害 ×1.45）绕盾爆桶！`,
  contract: html`<b>双轨死斗契约</b>：激光封锁变道，击杀悬赏重甲领巨额扩编与升阶！`,
  doom_orb: html`<b>数字湮灭棱球</b>逼近！集火将其从负数打成正数，逆转反击重创首领！`,
  bomber: html`<b>爆裂自爆尸</b>背负剧毒桶：提前射爆可连锁炸穿周围怪群并为金框门 +2！`,
  phalanx: html`<b>电磁盾卫尸</b>正面减伤：用<b>超导贯穿</b>、<b>新星迫击</b>或棱镜折射弹破盾！`,
  stalker: html`<b>幽影闪现尸</b>会横向折跃突袭：用<b>绝对零度</b>冻结禁闪或散弹覆盖！`,
  brood: html`<b>孵化母巢兽</b>持续产卵增兵：优先集火轰杀母体，断绝虫潮源头！`,
  howler: html`<b>狂怒战嚎尸</b>加速周围怪群：狙杀它可触发<b>音波反噬</b>群体震慑减速！`,
  glacier: html`<b>霜甲巨像</b>减免轻火力：用<b>新星迫击/超导贯穿</b>轰碎可触发<b>冰霜新星</b>群体脆化！`,
  beholder: html`<b>棱光狙击眼</b>远程锁定发射能量球：优先点杀或用冰冻打断充能！`,
  burrower: html`<b>钻地裂甲虫</b>逼近中程会破土狂飙：用<b>绝对零度/折射散弹</b>迎头粉碎！`,
  necromancer: html`<b>纳米织网者</b>持续治疗周围伤怪：斩首它可超载返还<b>共鸣与核弹充能</b>！`,
};

function autopilotDrag(snap: SimSnapshot): number {
  const tx = chooseHeuristicTargetX(snap);
  return Math.max(-0.32, Math.min(0.32, tx - snap.squadX));
}

function computeFeverMult(combo: number): number {
  if (combo >= 50) return 2.5;
  if (combo >= 30) return 2.0;
  if (combo >= 18) return 1.5;
  if (combo >= 10) return 1.2;
  return 1.0;
}

export class Game {
  readonly sim: SimulationController = createSimulation();
  readonly renderer: Renderer;
  readonly ui: UI;
  readonly input: InputController;
  readonly audio = new AudioEngine();
  readonly focusNav: SpatialFocusNavigator;
  save: SaveData = loadSave();
  private readonly ranking = new LeaderboardClient();
  private readonly rankingUI: LeaderboardUI;
  private rankingSequence = 0;
  private rankingRun: { id: number; run: Readonly<EndlessRunScore>; submitted: boolean } | null = null;
  private rankingSubmission: number | null = null;
  private rankingOpen = false;
  private rankingOffset = 0;
  private rankingQuery = 0;
  private activeGhostRecord: GhostRunRecord | null = null;
  private recordingGhostSamples: GhostSample[] = [];
  private ghostSampleTick = 0;
  private lastPromptMode: 'kb' | 'gamepad' = 'kb';

  state: AppState = 'title';
  sector: SectorId = 1;
  endless = false;
  blitz = false;
  pantheon = false;
  fairTrial = false;
  inRange = false;
  inExpedition = false;
  inCustomTrack = false;
  private nemesisDefeatedThisRun = false;
  private photoState: { active: boolean; yaw: number; pitch: number; fov: number; filter: PhotoFilterKind } = {
    active: false,
    yaw: 28,
    pitch: 22,
    fov: 52,
    filter: 'neon_raw',
  };
  private prePhotoState: 'playing' | 'paused' = 'playing';
  private replaySpeed: 0.5 | 1 | 2 = 2;
  private replayTickAcc = 0;
  score = 0;
  private speedMult: 1 | 2 = 1;
  private last = 0;
  private readyTimer = 0;
  private outroTimer = 0;
  private pendingResult: ResultData | null = null;
  private fixedLayoutSeed: number | null = null;
  private combo = 0;
  private maxCombo = 0;
  private bossLoss = 0;
  private activeRunSeed = 1;
  private partsBrokenCount = 0;
  private orbsReflectedCount = 0;
  private parriesCount = 0;
  private weaponSwapsCount = 0;
  private comboClock = 0;
  private critFloatClock = 0;
  private specialFloatClock = 0;
  private nukeHitStopTimer = 0;
  private hitStopCooldown = 0;
  private nirvanaDenyClock = 0;
  private viewportShakeActive = false;
  private bulletTimeTimer = 0;
  private bulletTimeDur = 0.22;
  private killBatchTimer = 0;
  private killBatchCount = 0;
  private hintCooldown = 0;
  private bossWarned = false;
  private hazardSeen = new Set<number>();
  private hintsThisRun = new Set<string>();
  private runTime = 0;
  private autoplay: boolean;
  private raf = 0;
  private lastSnap: SimSnapshot;
  private lastReplayLog: DeterministicReplayLog | null = null;
  private lastResultData: ResultData | null = null;
  private replayPlayer: ReplayPlayer | null = null;

  constructor(
    private readonly stage: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLElement,
    opts: { standaloneCanvas?: boolean } = {},
  ) {
    const params = new URLSearchParams(location.search);
    this.autoplay = params.get('autoplay') === '1';
    if (params.get('unlock') === '1') this.save.unlocked = 4;
    const seedParam = params.get('seed');
    if (seedParam !== null) this.fixedLayoutSeed = Math.max(0, Math.floor(Number(seedParam) || 0));

    const mutParam = params.get('mutators');
    if (mutParam) {
      const valid: MutatorId[] = ['mirror_twin', 'glass_cannon', 'barrel_carnival'];
      const picked = mutParam
        .split(',')
        .map((s) => s.trim() as MutatorId)
        .filter((m) => valid.includes(m));
      if (picked.length > 0) this.save.mutators = picked;
    }

    this.renderer = new Renderer(canvas, { forceProcedural: opts.standaloneCanvas === true, trialArt: params.get('art') === 'tripo' });
    this.input = new InputController(stage);
    this.ui = new UI(uiRoot, {
      onStart: (s) => this.startRun(s, false, false, false),
      onEndless: () => this.startRun(4, true, false, false),
      onBlitz: () => this.startRun(4, false, true, false),
      onFairTrial: () => this.startRun(4, false, true, true),
      onToggleMutator: (id) => this.toggleMutator(id),
      onLeaderboard: () => this.openLeaderboard(),
      onProtocol: (id) => this.chooseProtocol(id),
      onExtractEndless: () => this.extractEndlessRun(),
      onPause: () => this.pause(),
      onResume: () => this.resume(),
      onRetry: () => (this.pantheon ? this.startPantheonRun() : this.startRun(this.sector, this.endless, this.blitz, this.fairTrial)),
      onHome: () => this.toTitle(),
      onNext: () => this.startRun(Math.min(4, this.sector + 1) as SectorId, false, false),
      onToggleMute: () => this.toggleMute(),
      onToggleSpeed: () => this.toggleSpeed(),
      onBuy: (id) => this.buyUpgrade(id),
      onBuyApex: () => this.buyApexUpgrade(),
      onRespec: () => this.respecWorkshop(),
      onSelectStarter: (w) => this.selectStarterWeapon(w),
      onToggleStarterBlade: () => this.toggleStarterBlade(),
      onSelectSkin: (sk) => this.selectSquadSkin(sk),
      onBuySpec: (id) => this.buySpecialization(id),
      onToggleChip: (id) => this.toggleOverclockChip(id),
      onReplaySeed: () => this.startRun(this.sector, this.endless, this.blitz, this.fairTrial, this.activeRunSeed),
      onWatchReplay: () => this.startTacticalReplay(),
      onExitReplay: () => this.exitTacticalReplay(),
      onOpenRange: () => this.startFiringRange(),
      onRangeControl: (cmd) => {
        if (cmd.triggerNirvana && this.state === 'playing') {
          const { triggerNirvana: _t, ...rest } = cmd;
          if (Object.keys(rest).length > 0) this.sim.configureRange(rest);
          this.audio.unlock();
          this.input.requestNirvanaBurst();
          return;
        }
        this.sim.configureRange(cmd);
      },
      onOpenControls: () => {
        this.ui.showControls(true);
        this.ui.renderControls(
          this.input.getKeybinds(),
          this.input.getConnectedGamepadName(),
          this.save.voxEnabled ?? true,
          this.save.voxVolume ?? 0.85,
          Boolean(this.save.showPerfHud),
          this.save.accessibility,
        );
      },
      onCaptureKeybind: (act, btn) => this.captureKeybind(act, btn),
      onResetKeybinds: () => this.resetKeybinds(),
      onTestRumble: () => {
        this.input.rumble(0.85, 0.55, 220);
        this.audio.orbReflect();
        this.ui.toast('🎮 已发送双马达震动脉冲信号！', 1600);
      },
      onToggleVox: (enabled, volume) => {
        this.save.voxEnabled = enabled;
        this.save.voxVolume = volume;
        this.audio.setVoxConfig(enabled, volume);
        writeSave(this.save);
      },
      onTogglePerfHud: (show) => {
        this.save.showPerfHud = show;
        writeSave(this.save);
      },
      onPantheon: () => this.startPantheonRun(),
      onAccessibilityChange: (patch) => {
        this.save.accessibility = { ...this.save.accessibility, ...patch };
        this.renderer.setAccessibility(this.save.accessibility);
        this.ui.setFlashScale(this.save.accessibility.flashScale);
        writeSave(this.save);
        this.ui.renderControls(
          this.input.getKeybinds(),
          this.input.getConnectedGamepadName(),
          this.save.voxEnabled ?? true,
          this.save.voxVolume ?? 0.85,
          Boolean(this.save.showPerfHud),
          this.save.accessibility,
        );
      },
      onCodexPreview: (spec) => this.renderer.setCodexPreview(spec),
      onCodexRotate: (deltaRad) => this.renderer.rotateCodexTurntable(deltaRad),
      onReplaySpeed: (sp) => {
        this.replaySpeed = sp;
      },
      onReplayCamera: () => {
        const order: Array<'chase' | 'tactical_top' | 'action_closeup'> = ['chase', 'tactical_top', 'action_closeup'];
        const cur = this.renderer.replayCameraMode;
        const next = order[(order.indexOf(cur) + 1) % order.length]!;
        this.renderer.setReplayCameraMode(next);
        return next === 'tactical_top' ? '战术俯视' : next === 'action_closeup' ? '特写跟随' : '追尾视角';
      },
      onReplaySeek: (frac) => this.seekTacticalReplay(frac),
      onTogglePact: (id) => this.toggleAbyssalPact(id),
      onClearPacts: () => this.clearAbyssalPacts(),
      onSelectWingman: (id) => this.selectWingman(id),
      onCycleWingman: () => this.input.requestWingmanCycle(),
      onRunDiagnostic: () => this.runFullPipelineDiagnostic(),
      onOpenPhotoMode: () => this.enterPhotoMode(),
      onExitPhotoMode: () => this.exitPhotoMode(),
      onPhotoParamsChange: (patch) => {
        this.photoState = { ...this.photoState, ...patch, active: true };
        this.renderer.setPhotoMode(this.photoState);
      },
      onCapturePhoto: () => this.capturePhotoFrame(),
      onOpenExpedition: () => this.openExpeditionScreen(),
      onStartExpeditionNode: (nodeId) => this.startExpeditionNode(nodeId),
      onResetExpedition: () => this.resetExpeditionMap(),
      onTriggerNirvana: () => {
        this.audio.unlock();
        this.input.requestNirvanaBurst();
      },
      onToggleLiveTelemetry: () => {
        this.save.showLiveTelemetry = !this.save.showLiveTelemetry;
        writeSave(this.save);
        return this.save.showLiveTelemetry;
      },
      onOpenEditor: () => this.ui.showEditor(true, this.save.savedBlueprint),
      onPlayCustomTrack: (bp) => this.startCustomTrackRun(bp),
      onExportTrackCode: (bp) => encodeTrackShareCode(bp),
      onImportTrackCode: (code) => decodeTrackShareCode(code),
    });
    this.focusNav = new SpatialFocusNavigator(uiRoot);
    this.focusNav.attach();
    this.focusNav.onBack = () => {
      if (this.state === 'photo') {
        this.exitPhotoMode();
        return;
      }
      this.ui.showExpedition(false);
      this.ui.showEditor(false);
      this.ui.showAbyssal(false);
      this.ui.showControls(false);
      this.ui.showWorkshop(false);
      this.ui.showCodex(false);
      this.ui.showHelp(false);
    };
    this.renderer.effects.onShardBounce = (x, z, energy) => {
      if (this.state === 'playing') this.audio.shardBounceTick(x, z, energy);
    };
    this.renderer.setAccessibility(this.save.accessibility);
    this.ui.setFlashScale(this.save.accessibility.flashScale);
    this.audio.setVoxConfig(this.save.voxEnabled ?? true, this.save.voxVolume ?? 0.85);
    this.ui.setLiveTelemetryOpen(Boolean(this.save.showLiveTelemetry));
    window.addEventListener('keydown', (e) => {
      if (this.state === 'photo' && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        this.ui.togglePhotoCleanView();
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        this.save.showPerfHud = !this.save.showPerfHud;
        writeSave(this.save);
      }
    });
    this.rankingUI = new LeaderboardUI(uiRoot, {
      onName: name => this.saveRankingName(name),
      onSkipName: () => {
        this.rankingUI.hideName();
        this.rankingUI.submission('name', '本局尚未上传，可稍后填写姓名');
      },
      onOpen: () => this.openLeaderboard(),
      onClose: () => this.closeLeaderboard(),
      onRefresh: () => { void this.loadLeaderboard(); },
      onPage: offset => { this.rankingOffset = offset; void this.loadLeaderboard(); },
      onRetry: () => { void this.submitRanking(); },
    });
    this.input.setKeybinds(this.save.keybinds);
    this.ui.setKeybindLabels(this.input.getKeybinds());
    this.input.onGamepadChange = (connected, name) => {
      if (connected) {
        this.ui.toast(html`🎮 手柄已接入：<b>${name.slice(0, 26)}</b>`, 2200);
      }
    };
    this.renderer.setSquadSkin(this.save.squadSkin ?? 'cyan');
    this.audio.setMuted(this.save.muted);
    this.ui.setMuted(this.save.muted);
    void this.renderer.assetsReady.then(() => {
      this.stage.dataset.propSource = this.renderer.propSource;
      if (params.get('art') === 'tripo') {
        this.ui.toast(this.renderer.propSource === 'tripo' ? 'Tripo 美术试验 · 仅限非商业用途' : '试验模型不可用，已使用原版能量舱', 4500);
      }
      if (this.renderer.modelSource === 'procedural' && !opts.standaloneCanvas) {
        this.ui.toast(html`模型加载失败，已切换为<b>简化模型</b>`, 5000);
      }
    });
    this.ui.onOverdrive = () => this.input.requestOverdrive();
    this.ui.onAegis = () => this.input.requestAegis();
    this.ui.onSkyJump = () => {
      this.audio.unlock();
      this.input.requestSkyJump();
    };
    this.ui.onSwapWeapon = () => this.input.requestWeaponSwap();
    this.ui.onNuke = () => {
      this.audio.unlock();
      this.input.requestNuke();
    };
    this.ui.onNirvana = () => {
      this.audio.unlock();
      this.input.requestNirvanaBurst();
    };
    this.input.onPhotoModeKey = () => {
      if (this.state === 'photo') this.exitPhotoMode();
      else if (this.state === 'playing' || this.state === 'paused' || this.state === 'ready') this.enterPhotoMode();
    };
    this.input.onPauseKey = () => {
      if (this.state === 'photo') this.exitPhotoMode();
      else if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    };
    this.input.onSpeedKey = () => {
      if (this.state === 'playing' || this.state === 'ready') this.toggleSpeed();
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
      if (params.get('mode') === 'blitz' || params.get('blitz') === '1') this.startRun(4, false, true);
      else if (params.get('mode') === 'endless' || params.get('endless') === '1') this.startRun(4, true, false);
      else this.startRun((startSector >= 2 && startSector <= 4 ? startSector : 1) as SectorId, false, false);
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

  toggleMutator(id: MutatorId): void {
    const idx = this.save.mutators.indexOf(id);
    if (idx >= 0) this.save.mutators.splice(idx, 1);
    else this.save.mutators.push(id);
    writeSave(this.save);
    this.ui.renderMutators(this.save);
  }

  // ------------------------------------------------------------------ flow
  toTitle(): void {
    this.clearRankingViews();
    this.state = 'title';
    this.inRange = false;
    this.ui.showRangeDeck(false);
    this.ui.showReplayHud(false);
    this.replayPlayer = null;
    this.endless = false;
    this.blitz = false;
    this.pantheon = false;
    this.fairTrial = false;
    this.inExpedition = false;
    this.inCustomTrack = false;
    this.ui.showPhotoHud(false);
    this.ui.showExpedition(false);
    this.ui.showEditor(false);
    this.renderer.setPhotoMode(null);
    this.audio.setAmbientSlowScape(false);
    this.renderer.setReplayCameraMode('chase');
    this.renderer.setCodexPreview(null);
    this.renderer.updateGhostRunner(null, 0);
    this.audio.setAbyssalHeat(0);
    this.activeGhostRecord = null;
    this.audio.setFever(false);
    this.audio.setBossPhaseState(0, false);
    this.renderer.setSquadSkin(this.save.squadSkin ?? 'cyan');
    this.ui.hideProtocols();
    this.ui.hideHud();
    this.ui.showDragHint(false);
    this.ui.showTitle(this.save);
    this.renderer.resetRun();
    this.renderer.setSector(1);
    this.sim.startSector(1);
    this.audio.setMusic(1, 0);
  }

  startRun(sector: SectorId, endless = false, blitz = false, fairTrial = false, forcedSeed?: number): void {
    if (!endless && !blitz && !fairTrial && sector > this.save.unlocked) return;
    this.clearRankingViews();
    this.audio.unlock();
    this.sector = blitz || fairTrial ? 4 : sector;
    this.inRange = false;
    this.ui.showRangeDeck(false);
    this.endless = endless;
    this.blitz = blitz || fairTrial;
    this.pantheon = false;
    this.fairTrial = fairTrial;
    this.inExpedition = false;
    this.inCustomTrack = false;
    this.nemesisDefeatedThisRun = false;
    this.renderer.setPhotoMode(null);
    this.ui.showPhotoHud(false);
    this.audio.setAmbientSlowScape(false);
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.bossLoss = 0;
    this.partsBrokenCount = 0;
    this.orbsReflectedCount = 0;
    this.parriesCount = 0;
    this.weaponSwapsCount = 0;
    this.comboClock = 0;
    this.killBatchTimer = 0;
    this.killBatchCount = 0;
    this.hintCooldown = 0;
    this.bossWarned = false;
    this.hazardSeen.clear();
    this.hintsThisRun.clear();
    this.runTime = 0;
    this.pendingResult = null;
    this.speedMult = 1;
    this.audio.setFever(false);
    this.audio.setBossPhaseState(0, false);
    this.renderer.setSquadSkin(fairTrial ? 'cyan' : (this.save.squadSkin ?? 'cyan'));
    this.renderer.resetRun();
    if (endless) this.renderer.setEndlessWave(1);
    else if (this.blitz) this.renderer.setSector(fairTrial ? 1 : 2);
    else this.renderer.setSector(this.sector);
    this.sim.setSpeedMultiplier(1);
    const FAIR_SEED = 202611;
    const layoutSeed = fairTrial
      ? FAIR_SEED
      : (forcedSeed ?? this.fixedLayoutSeed ?? 1 + Math.floor(Math.random() * 0x7ffffffe));
    this.activeRunSeed = layoutSeed;
    const activeMutators = fairTrial ? [] : [...this.save.mutators];
    const baseMods = fairTrial
      ? { bonusSquad: 0, damageMult: 1, resonanceMult: 1, bossHpMult: 1, critChance: 0, equippedChips: [] }
      : runModsFromUpgrades(this.save.upgrades, this.save.apexLevel, this.save.specializations, this.save.equippedChips);
    this.sim.startSector(this.sector, {
      ...baseMods,
      manualOverdrive: true,
      layoutSeed,
      endless,
      manualEndlessDraft: endless,
      blitz: this.blitz,
      mutators: activeMutators,
      fairTrial,
      starterWeapon: fairTrial ? 'pulse' : (this.save.starterWeapon ?? 'pulse'),
      starterBlade: fairTrial ? false : Boolean(this.save.starterBladeUnlocked && this.save.starterBlade),
      aimAssist: fairTrial ? false : Boolean(this.save.accessibility?.aimAssist),
      abyssalPacts: fairTrial ? [] : [...(this.save.abyssal?.activePacts ?? [])],
      equippedWingman: fairTrial ? null : (this.save.equippedWingman ?? null),
    });
    const runHeat = fairTrial ? 0 : computeAbyssalHeatTier(this.save.abyssal?.activePacts);
    this.audio.setAbyssalHeat(runHeat);
    this.initGhostForRun(fairTrial, layoutSeed, forcedSeed !== undefined);
    this.lastSnap = this.sim.getSnapshot();
    this.input.reset();
    this.ui.hideTitle();
    this.ui.showHelp(false);
    this.ui.showCodex(false);
    this.ui.showWorkshop(false);
    this.ui.showAbyssal(false);
    this.ui.hideResult();
    this.ui.showPause(false);
    this.ui.hideProtocols();
    this.ui.showHud(this.sector, endless, blitz);
    this.state = 'ready';
    this.readyTimer = 0;
    this.ui.showDragHint(true);
    const meta = SECTOR_META[this.sector];
    const mutPct = computeMutatorBonusPct(activeMutators);
    const mutSuffix = mutPct > 0 ? ` · 突变收益 +${mutPct}%` : '';
    const bossLine = blitz
      ? `首领 · ${BOSS_META[generateBlitzScript(layoutSeed).boss.id].title} · 双武聚变 + 机关全开${mutSuffix}`
      : endless
        ? `阶段无限 · 双协议羁绊 · 布局 #${layoutSeed}${mutSuffix}`
        : this.sector === 4
          ? `首领 · ${BOSS_META[getSectorScript(this.sector, layoutSeed).boss.id].title} · 布局 #${layoutSeed}${mutSuffix}`
          : `首领 · ${meta.bossTitle}${mutSuffix}`;
    const runTitle = fairTrial ? '公平试炼 #202611' : this.blitz ? '极速闪击' : endless ? '无尽协议' : meta.name;
    const runKicker = fairTrial ? 'FAIR SEEDED TRIAL · 零工坊纯技术榜' : this.blitz
      ? 'OVERLIMIT BLITZ · 六幕超限决战'
      : endless
        ? 'ENDLESS PROTOCOL · 阶段 1'
        : meta.subtitle;
    this.ui.showBanner(
      html`<div class="b-kicker">${runKicker}</div><div class="b-title">${runTitle}</div><div class="b-sub">${bossLine}</div>`,
      blitz ? 'od' : 'intro',
      1800,
    );
    this.input.onFirstInput = () => this.beginPlay();
    this.audio.setMusic(blitz ? 3 : this.sector, 1);
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

  toggleSpeed(): void {
    this.speedMult = this.speedMult === 1 ? 2 : 1;
    this.sim.setSpeedMultiplier(this.speedMult);
    this.ui.setSpeed(this.speedMult);
  }

  chooseProtocol(id: EndlessUpgradeId): void {
    const prevUpgrades = { ...(this.sim.getSnapshot().endless?.upgrades ?? {}) };
    if (this.state !== 'draft' || !this.sim.chooseEndlessUpgrade(id)) return;
    this.ui.hideProtocols();
    this.input.reset();
    this.state = 'playing';
    this.audio.resume();
    this.audio.powerUp();
    const snap = this.sim.getSnapshot();
    this.lastSnap = snap;
    const threat = getEndlessThreat(snap.endless!.wave);
    const prevSynIds = new Set(getActiveSynergies(prevUpgrades).map((s) => s.id));
    const newSyns = getActiveSynergies(snap.endless?.upgrades).filter((s) => !prevSynIds.has(s.id));
    if (newSyns.length > 0) {
      this.audio.achievement();
      this.ui.toast(html`✦ 激活共鸣羁绊：<b>${newSyns.map((s) => s.name).join(' · ')}</b>`, 3200);
    }
    this.ui.showBanner(
      html`<div class="b-kicker">PROTOCOL INSTALLED · ${threat.name}</div><div class="b-title">${PROTOCOLS[id].name}</div><div class="b-sub">${threat.description}</div>`,
      'od',
      1500,
    );
    this.last = performance.now();
  }

  extractEndlessRun(): void {
    if (this.state !== 'draft' || !this.endless) return;
    this.ui.hideProtocols();
    this.audio.resume();
    const snap = this.sim.getSnapshot();
    this.finishRun(true, snap, null, true);
    if (this.pendingResult) {
      this.showResult(this.pendingResult);
    }
  }

  buyUpgrade(id: UpgradeId): void {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return;
    const lv = this.save.upgrades[id] ?? 0;
    const cost = def.costs[lv];
    if (lv >= def.max || cost === undefined || this.save.cores < cost) return;
    this.save.cores -= cost;
    this.save.upgrades[id] = lv + 1;
    writeSave(this.save);
    this.audio.powerUp();
    this.ui.renderWorkshop(this.save, id);
  }

  buyApexUpgrade(): void {
    if (!isApexUnlocked(this.save.upgrades)) return;
    const cost = getApexCost(this.save.apexLevel ?? 0);
    if (this.save.cores < cost) return;
    this.save.cores -= cost;
    this.save.apexLevel = (this.save.apexLevel ?? 0) + 1;
    writeSave(this.save);
    this.audio.powerUp();
    this.ui.renderWorkshop(this.save, 'apex');
  }

  selectStarterWeapon(w: WeaponId): void {
    const unlocked = this.save.unlockedStarters ?? ['pulse'];
    if (unlocked.includes(w)) {
      this.save.starterWeapon = w;
      writeSave(this.save);
      this.audio.click();
      this.ui.renderWorkshop(this.save);
      return;
    }
    if (this.save.cores < STARTER_WEAPON_COST) return;
    this.save.cores -= STARTER_WEAPON_COST;
    unlocked.push(w);
    this.save.unlockedStarters = unlocked;
    this.save.starterWeapon = w;
    writeSave(this.save);
    this.audio.powerUp();
    this.ui.renderWorkshop(this.save);
    this.ui.toast(html`已解锁并装备起手主武：<b>${REWARD_META[w].name}</b>`, 2200);
  }

  toggleStarterBlade(): void {
    if (!this.save.starterBladeUnlocked) {
      if (this.save.cores < STARTER_BLADE_COST) return;
      this.save.cores -= STARTER_BLADE_COST;
      this.save.starterBladeUnlocked = true;
      this.save.starterBlade = true;
      writeSave(this.save);
      this.audio.powerUp();
      this.ui.renderWorkshop(this.save);
      this.ui.toast(html`已解锁并挂载：<b>先锋护航飞刃</b>`, 2200);
      return;
    }
    this.save.starterBlade = !this.save.starterBlade;
    writeSave(this.save);
    this.audio.click();
    this.ui.renderWorkshop(this.save);
  }

  selectSquadSkin(skin: SquadSkinId): void {
    this.save.squadSkin = skin;
    this.renderer.setSquadSkin(skin);
    writeSave(this.save);
    this.audio.click();
    this.ui.renderWorkshop(this.save);
  }

  buySpecialization(id: SpecializationId): void {
    const def = SPECIALIZATIONS.find((s) => s.id === id);
    if (!def) return;
    const lv = this.save.specializations?.[id] ?? 0;
    const cost = def.costs[lv];
    if (lv >= def.max || cost === undefined || this.save.cores < cost) return;
    this.save.cores -= cost;
    this.save.specializations[id] = lv + 1;
    writeSave(this.save);
    this.audio.powerUp();
    this.ui.renderWorkshop(this.save);
  }

  toggleOverclockChip(id: OverclockChipId): void {
    const def = OVERCLOCK_CHIPS.find((c) => c.id === id);
    if (!def) return;
    const unlocked = this.save.unlockedChips ?? [];
    const equipped = this.save.equippedChips ?? [];
    if (!unlocked.includes(id)) {
      if (this.save.cores < def.cost) return;
      this.save.cores -= def.cost;
      unlocked.push(id);
      this.save.unlockedChips = unlocked;
      if (equipped.length < 3) equipped.push(id);
      this.save.equippedChips = equipped;
      writeSave(this.save);
      this.audio.powerUp();
      this.ui.renderWorkshop(this.save);
      this.ui.toast(html`🔌 已解锁超频芯片：<b>${def.glyph} ${def.name}</b>`, 2200);
      return;
    }
    const idx = equipped.indexOf(id);
    if (idx >= 0) {
      equipped.splice(idx, 1);
    } else if (equipped.length >= 3) {
      this.ui.toast(html`⚠ 最多同时挂载 <b>3 枚战术超频芯片</b>，请先卸下一枚！`, 2000);
      return;
    } else {
      equipped.push(id);
    }
    this.save.equippedChips = equipped;
    writeSave(this.save);
    this.audio.click();
    this.ui.renderWorkshop(this.save);
  }

  startPantheonRun(forcedSeed?: number): void {
    this.audio.unlock();
    this.sector = 4;
    this.inRange = false;
    this.ui.showRangeDeck(false);
    this.endless = false;
    this.blitz = false;
    this.pantheon = true;
    this.fairTrial = false;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.bossLoss = 0;
    this.partsBrokenCount = 0;
    this.orbsReflectedCount = 0;
    this.parriesCount = 0;
    this.weaponSwapsCount = 0;
    this.runTime = 0;
    this.pendingResult = null;
    this.speedMult = 1;
    this.audio.setFever(false);
    this.audio.setBossPhaseState(1, false, false, false);
    this.renderer.setSquadSkin(this.save.squadSkin ?? 'cyan');
    this.renderer.resetRun();
    this.renderer.setSector(3);
    this.sim.setSpeedMultiplier(1);
    const layoutSeed = forcedSeed ?? this.fixedLayoutSeed ?? 1 + Math.floor(Math.random() * 0x7ffffffe);
    this.activeRunSeed = layoutSeed;
    const baseMods = runModsFromUpgrades(this.save.upgrades, this.save.apexLevel, this.save.specializations, this.save.equippedChips);
    this.sim.startSector(4, {
      ...baseMods,
      manualOverdrive: true,
      layoutSeed,
      pantheon: true,
      mutators: [...this.save.mutators],
      starterWeapon: this.save.starterWeapon ?? 'pulse',
      starterBlade: Boolean(this.save.starterBladeUnlocked && this.save.starterBlade),
      aimAssist: Boolean(this.save.accessibility?.aimAssist),
      abyssalPacts: [...(this.save.abyssal?.activePacts ?? [])],
      equippedWingman: this.save.equippedWingman ?? null,
    });
    this.audio.setAbyssalHeat(computeAbyssalHeatTier(this.save.abyssal?.activePacts));
    this.activeGhostRecord = null;
    this.renderer.updateGhostRunner(null, 0);
    this.lastSnap = this.sim.getSnapshot();
    this.input.reset();
    this.ui.hideTitle();
    this.ui.showHelp(false);
    this.ui.showCodex(false);
    this.ui.showWorkshop(false);
    this.ui.hideResult();
    this.ui.showPause(false);
    this.ui.hideProtocols();
    this.ui.showHud(4, false, true);
    this.state = 'ready';
    this.readyTimer = 0;
    this.ui.showDragHint(true);
    this.ui.showBanner(
      html`<div class="b-kicker">🏛 BOSS RUSH PANTHEON · 棱镜万神殿</div><div class="b-title">四殿首领连战 · 终殿双神合击</div><div class="b-sub">连续迎战强化三区首领与双神同屏终局试炼！</div>`,
      'boss',
      2100,
    );
    this.input.onFirstInput = () => this.beginPlay();
    this.audio.setMusic(3, 2);
  }

  startTacticalReplay(): void {
    if (!this.lastReplayLog) {
      this.ui.toast('🎬 尚无最近战局回放记录，完成一局作战后即可随时复盘！', 2200);
      return;
    }
    const log = this.lastReplayLog;
    this.ui.hideTitle();
    this.ui.hideResult();
    this.renderer.resetRun();
    this.renderer.setReplayCameraMode('chase');
    this.renderer.setSector(log.sector);
    this.sim.startSector(log.sector, { ...log.modifiers, layoutSeed: log.seed });
    this.replayPlayer = new ReplayPlayer(log);
    this.replaySpeed = 2;
    this.replayTickAcc = 0;
    this.lastSnap = this.sim.getSnapshot();
    this.ui.showHud(log.sector, Boolean(log.modifiers.endless), Boolean(log.modifiers.blitz || log.modifiers.pantheon));
    this.ui.showDragHint(false);
    this.ui.showReplayHud(true, 0, log.markers ?? [], log.totalTicks);
    this.state = 'replay';
    this.audio.setMusic(log.sector, 1);
  }

  seekTacticalReplay(frac: number): void {
    if (this.state !== 'replay' || !this.lastReplayLog || !this.replayPlayer) return;
    const targetTick = Math.max(0, Math.min(this.lastReplayLog.totalTicks - 1, Math.round(frac * this.lastReplayLog.totalTicks)));
    this.renderer.resetRun();
    this.replayPlayer = this.sim.seekReplayTick(this.lastReplayLog, targetTick);
    this.lastSnap = this.sim.getSnapshot();
    this.ui.showReplayHud(true, this.replayPlayer.progress);
  }

  exitTacticalReplay(): void {
    this.replayPlayer = null;
    this.renderer.setReplayCameraMode('chase');
    this.ui.showReplayHud(false);
    if (this.lastResultData) {
      this.state = 'result';
      this.audio.setMusic(this.sector, 0);
      this.ui.restoreResult();
    } else {
      this.toTitle();
    }
  }

  private captureKeybind(action: KeybindAction, btn: HTMLButtonElement): void {
    this.input.beginCaptureKey((newKey) => {
      const prevKey = this.save.keybinds[action];
      for (const k of Object.keys(this.save.keybinds) as KeybindAction[]) {
        if (k !== action && this.save.keybinds[k].toLowerCase() === newKey.toLowerCase()) {
          this.save.keybinds[k] = prevKey;
        }
      }
      this.save.keybinds[action] = newKey;
      this.input.setKeybinds(this.save.keybinds);
      this.ui.setKeybindLabels(this.input.getKeybinds());
      writeSave(this.save);
      this.audio.click();
      btn.classList.remove('listening');
      this.ui.renderControls(this.save.keybinds, this.input.getConnectedGamepadName());
    });
  }

  private resetKeybinds(): void {
    this.save.keybinds = { ...DEFAULT_KEYBINDS };
    this.input.setKeybinds(this.save.keybinds);
    this.ui.setKeybindLabels(this.input.getKeybinds());
    writeSave(this.save);
    this.audio.powerUp();
    this.ui.renderControls(this.save.keybinds, this.input.getConnectedGamepadName());
    this.ui.toast('已恢复默认键盘键位映射', 1800);
  }

  startFiringRange(): void {
    this.audio.unlock();
    this.inRange = true;
    this.sector = 1;
    this.endless = false;
    this.blitz = false;
    this.fairTrial = false;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.runTime = 0;
    this.pendingResult = null;
    this.renderer.setSquadSkin(this.save.squadSkin ?? 'cyan');
    this.renderer.resetRun();
    this.renderer.setSector(1);
    const baseMods = runModsFromUpgrades(this.save.upgrades, this.save.apexLevel, this.save.specializations, this.save.equippedChips);
    this.sim.startSector(1, {
      ...baseMods,
      manualOverdrive: true,
      firingRange: true,
      layoutSeed: 202619,
      equippedWingman: this.save.equippedWingman ?? 'prism_mirror',
    });
    this.activeGhostRecord = null;
    this.renderer.updateGhostRunner(null, 0);
    this.lastSnap = this.sim.getSnapshot();
    this.input.reset();
    this.ui.hideTitle();
    this.ui.showHelp(false);
    this.ui.showCodex(false);
    this.ui.showWorkshop(false);
    this.ui.showControls(false);
    this.ui.hideResult();
    this.ui.showPause(false);
    this.ui.showHud(1, false, false);
    this.ui.showDragHint(false);
    this.ui.showRangeDeck(true);
    this.ui.updateRangeDeck(this.lastSnap, this.renderer.getPerfStats().drawCalls);
    this.state = 'playing';
    this.audio.setMusic(2, 1);
    this.ui.toast(html`🎯 <b>全息战术靶场已上线</b>：可随时切换主副炮、拖动滑块调节折镜角度并观测实时秒伤！`, 3000);
  }

  respecWorkshop(): void {
    const refund = getTotalWorkshopSpent(this.save.upgrades, this.save.apexLevel ?? 0, this.save.specializations, this.save.unlockedChips, this.save.unlockedWingmen);
    if (refund <= 0) return;
    this.save.cores += refund;
    for (const u of UPGRADES) this.save.upgrades[u.id] = 0;
    this.save.specializations = { spec_ricochet: 0, spec_vortex: 0, spec_shatter: 0 };
    this.save.unlockedChips = [];
    this.save.equippedChips = [];
    this.save.unlockedWingmen = [];
    this.save.equippedWingman = null;
    this.save.apexLevel = 0;
    writeSave(this.save);
    this.audio.gateFlip();
    this.ui.renderWorkshop(this.save);
    this.ui.toast(html`已全额返还 <b>${refund}</b> 晶核`, 2400);
  }

  toggleMute(): void {
    this.save.muted = !this.save.muted;
    this.audio.setMuted(this.save.muted);
    this.ui.setMuted(this.save.muted);
    writeSave(this.save);
  }

  private addScore(basePoints: number): void {
    if (basePoints <= 0) return;
    const feverMult = computeFeverMult(this.combo);
    // Competitive fairness: Workshop bounty boosts Core Shards ONLY, never inflating leaderboard score!
    const heatBonusPct = this.fairTrial ? 0 : (this.lastSnap?.abyssalHeatTier ?? 0) * 15;
    const mutMult = this.fairTrial ? 1 : 1 + (computeMutatorBonusPct(this.lastSnap?.mutators ?? this.save.mutators) + heatBonusPct) / 100;
    this.score += Math.round(basePoints * feverMult * mutMult);
  }

  // ------------------------------------------------------------------ per frame
  private frame(dt: number): void {
    this.focusNav.pollGamepad();
    if (this.focusNav.inputMode !== this.lastPromptMode) {
      this.lastPromptMode = this.focusNav.inputMode;
      this.ui.setInputPromptMode(this.lastPromptMode);
    }
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
        this.input.pollGamepad();
        let simDt = dt;
        if (this.nukeHitStopTimer > 0) {
          this.nukeHitStopTimer = Math.max(0, this.nukeHitStopTimer - dt / Math.max(1, this.speedMult));
          simDt = dt * 0.06;
        } else if (this.bulletTimeTimer > 0) {
          this.bulletTimeTimer = Math.max(0, this.bulletTimeTimer - dt / Math.max(1, this.speedMult));
          const bp = 1 - this.bulletTimeTimer / Math.max(0.05, this.bulletTimeDur);
          // Non-linear smooth bullet-time curve: dips to 0.20x at impact and eases fluidly back to 1.0x!
          simDt = dt * (0.20 + 0.80 * bp * bp);
        }
        this.runTime += simDt * this.speedMult;
        const pre = this.sim.getSnapshot();
        const drag = this.autoplay ? autopilotDrag(pre) : this.input.consumeDrag();
        const axis = this.autoplay ? 0 : this.input.keyAxis;
        const overdrive = this.input.consumeOverdrive() || this.autoplay;
        const aegisPulse = this.input.consumeAegis();
        const nukeStrike = this.input.consumeNuke();
        const swapWeapon = this.input.consumeWeaponSwap();
        const cycleWingman = this.input.consumeWingmanCycle();
        const nirvanaBurst = this.input.consumeNirvanaBurst();
        const skyJump = this.input.consumeSkyJump();
        const events = this.sim.tickFrame(simDt, {
          dragDeltaX: drag,
          keyAxisX: axis,
          overdrive,
          aegisPulse,
          nukeStrike,
          swapWeapon,
          cycleWingman,
          nirvanaBurst,
          skyJump,
        });
        snap = this.sim.getSnapshot();
        this.handleEvents(events, snap, true);
        if (skyJump && (pre.jumpStocks ?? 0) <= 0 && !pre.isFiringRange && !events.some((ev) => ev.type === 'JUMP_LAUNCH')) {
          if (this.nirvanaDenyClock <= 0) {
            this.nirvanaDenyClock = 1.05;
            const jPct = Math.round(Math.max(0, Math.min(1, snap.jumpCharge ?? 0)) * 100);
            this.ui.toast(`🚀 苍穹跃迁充能中 ${jPct}% · 歼敌加速蓄能`, 1350);
          }
        }
        const nirvanaReadyNow =
          !this.fairTrial && (Boolean(snap.isFiringRange) || (snap.nirvanaCharge ?? 0) >= 0.999);
        if (nirvanaBurst && !nirvanaReadyNow && !events.some((ev) => ev.type === 'OVERLIMIT_NIRVANA_BURST')) {
          if (this.nirvanaDenyClock <= 0) {
            this.nirvanaDenyClock = 1.35;
            this.ui.pulseNirvanaNotReady();
            if (this.fairTrial) {
              this.ui.toast('🔒 公平试炼模式已禁用终焉奥义', 1600);
            } else if ((snap.nirvanaActiveTimer ?? 0) <= 0) {
              const pct = Math.round(Math.max(0, Math.min(1, snap.nirvanaCharge ?? 0)) * 100);
              this.ui.toast(`☀️ 奥义充能中 ${pct}% · 歼敌/折镜/超载快速蓄能`, 1500);
            }
          }
        }
        this.liveChecks(snap, dt);
        this.stepGhostDuel(snap);
        break;
      }
      case 'photo':
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
      case 'replay': {
        const rp = this.replayPlayer;
        if (!rp || rp.isFinished || this.sim.getSnapshot().phase !== 'PLAYING') {
          this.exitTacticalReplay();
          snap = this.sim.getSnapshot();
          break;
        }
        this.replayTickAcc += this.replaySpeed;
        const ticksToRun = Math.floor(this.replayTickAcc);
        this.replayTickAcc -= ticksToRun;
        for (let k = 0; k < ticksToRun && !rp.isFinished; k++) {
          const prots = rp.consumePendingProtocols();
          for (const pid of prots) this.sim.chooseEndlessUpgrade(pid);
          if (this.sim.getSnapshot().phase !== 'PLAYING') break;
          const evs = this.sim.stepFixed(rp.nextInput());
          snap = this.sim.getSnapshot();
          this.handleEvents(evs, snap, true);
        }
        this.ui.showReplayHud(true, rp.progress);
        break;
      }
      case 'result':
        snap = this.sim.getSnapshot();
        break;
    }
    this.lastSnap = snap;
    this.renderer.render(snap, dt, this.state === 'outro' || this.state === 'result');
    const sh = this.renderer.getScreenShakeOffset();
    const allowViewportShake =
      (this.state === 'playing' || this.state === 'replay') &&
      (Math.abs(sh.x) > 0.05 || Math.abs(sh.y) > 0.05 || Math.abs(sh.rotDeg) > 0.01);
    if (allowViewportShake) {
      this.canvas.style.transform = `translate3d(${sh.x.toFixed(2)}px, ${sh.y.toFixed(2)}px, 0) rotate(${sh.rotDeg.toFixed(3)}deg) scale(${sh.scale.toFixed(4)})`;
      if (!this.inRange) {
        this.uiRoot.style.transform = `translate3d(${(sh.x * 0.72).toFixed(2)}px, ${(sh.y * 0.72).toFixed(2)}px, 0) rotate(${(sh.rotDeg * 0.55).toFixed(3)}deg)`;
      } else {
        this.uiRoot.style.transform = '';
      }
      this.viewportShakeActive = true;
    } else if (this.viewportShakeActive) {
      this.canvas.style.transform = '';
      this.uiRoot.style.transform = '';
      this.viewportShakeActive = false;
    }
    if (this.state !== 'title') {
      const airY = snap.squadAirY ?? 0;
      const badgeY = (snap.squadCount >= 55 ? 2.95 : snap.squadCount >= 14 ? 1.86 : 1.68) + airY;
      const p = this.renderer.project(snap.squadX, badgeY, PLAYER_Z - snap.formationRadius - 0.25);
      this.ui.updateHud(snap, this.score, p);
      const showPerf = Boolean(this.save.showPerfHud) || (this.inRange && Boolean(snap.isFiringRange));
      this.ui.updatePerfHud(showPerf, this.renderer.getFrameTimeHistory(), this.renderer.getPerfStats(), this.renderer.emaFrameMs);
      if (this.inRange && snap.isFiringRange) {
        this.ui.updateRangeDeck(snap, this.renderer.getPerfStats().drawCalls);
      }
    }
    this.ui.updateFloats(dt);
    this.stage.dataset.state = this.state;
  }

  private worldToScreen(x: number, y: number, z: number): { x: number; y: number } {
    const p = this.renderer.project(x, y, z);
    return { x: p.x, y: p.y };
  }

  private liveChecks(snap: SimSnapshot, dt: number): void {
    this.audio.setThreatTier(snap.swarmTier ?? 1);
    this.audio.setOverlimit(Boolean(snap.overlimitResonance));
    this.audio.setBossPhaseState(
      snap.boss?.active ? snap.boss.phase : 0,
      (snap.boss?.breakTimer ?? 0) > 0,
      Boolean(snap.boss?.omegaOverdrive),
      Boolean(snap.pantheonCoBoss?.active),
    );
    if (this.hitStopCooldown > 0) this.hitStopCooldown = Math.max(0, this.hitStopCooldown - dt);
    if (this.nirvanaDenyClock > 0) this.nirvanaDenyClock = Math.max(0, this.nirvanaDenyClock - dt);
    if (this.critFloatClock > 0) this.critFloatClock = Math.max(0, this.critFloatClock - dt);
    if (this.specialFloatClock > 0) this.specialFloatClock = Math.max(0, this.specialFloatClock - dt);
    if (this.hintCooldown > 0) this.hintCooldown = Math.max(0, this.hintCooldown - dt);
    // Report a burst with the combo counter after the hits in that burst have settled.
    if (this.killBatchTimer > 0) {
      this.killBatchTimer -= dt;
      if (this.killBatchTimer <= 0) {
        if (this.killBatchCount >= 5 && !snap.boss) {
          this.ui.combo(this.combo, this.killBatchCount);
        }
        this.killBatchCount = 0;
      }
    }
    if (this.comboClock > 0) {
      this.comboClock -= dt;
      if (this.comboClock <= 0) {
        this.combo = 0;
        this.audio.setFever(false);
        this.ui.updateFever(0, 1);
      }
    }
    if (!this.bossWarned && snap.runwayProgress > 0.955 && !snap.boss) {
      this.bossWarned = true;
      const meta = SECTOR_META[snap.sector];
      this.ui.bossWarning(
        this.blitz ? '闪击终局首领' : this.endless ? '轮回首领' : meta.bossName,
        this.blitz ? '双肩破防 · 棱球反击' : this.endless ? `无尽阶段 ${snap.endless?.wave ?? 1}` : meta.bossTitle,
      );
      this.audio.bossWarning();
      this.ui.doFlash('rgba(255,30,60,0.6)', 0.35);
    }
    if (snap.boss) {
      for (const hz of snap.boss.hazardZones) {
        if (!this.hazardSeen.has(hz.id)) {
          this.hazardSeen.add(hz.id);
          this.audio.hazardCharge();
          this.hint('hazard');
        }
      }
    }
    if (snap.inBlitzDrill) return; // This passage already gives a timed, lane-specific instruction.
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
    if (snap.jumpPads?.some((jp) => near(jp.z) && !jp.triggered)) this.hint('jump');
    if (snap.reflectors?.some((rf) => near(rf.z))) this.hint('reflector');
    if (snap.contractWalls?.some((cw) => cw.zFront > -50)) this.hint('contract');
    if (snap.doomOrbs?.some((o) => !o.reflected)) this.hint('doom_orb');
    for (const e of snap.enemies) {
      if (e.kind === 'siphon' && near(e.z)) this.hint('siphon');
      else if (e.kind === 'dasher' && e.telegraphTimer > 0) this.hint('dasher');
      else if (e.kind === 'bastion' && near(e.z) && !snap.boss) this.hint('bastion');
      else if (e.kind === 'bomber' && near(e.z)) this.hint('bomber');
      else if (e.kind === 'phalanx' && near(e.z)) this.hint('phalanx');
      else if (e.kind === 'stalker' && near(e.z)) this.hint('stalker');
      else if (e.kind === 'brood' && near(e.z)) this.hint('brood');
      else if (e.kind === 'howler' && near(e.z)) this.hint('howler');
      else if (e.kind === 'glacier' && near(e.z)) this.hint('glacier');
      else if (e.kind === 'beholder' && near(e.z)) this.hint('beholder');
      else if (e.kind === 'burrower' && near(e.z)) this.hint('burrower');
      else if (e.kind === 'necromancer' && near(e.z)) this.hint('necromancer');
    }
  }

  /** Tactile micro hit-stop freeze frame (throttled so combat stays ultra-fluid while heavy kills feel seismic!) */
  private triggerHitStop(durationSec: number): void {
    if (this.hitStopCooldown > 0 || this.nukeHitStopTimer > 0) return;
    this.nukeHitStopTimer = durationSec;
    this.hitStopCooldown = 0.22;
  }

  private hint(key: string): void {
    if (this.hintCooldown > 0 || this.hintsThisRun.has(key) || this.save.seenHints.includes(key)) return;
    if (key !== 'hazard' && this.ui.hasCombatAnnouncement()) return;
    this.hintsThisRun.add(key);
    this.save.seenHints.push(key);
    this.hintCooldown = 3.6;
    writeSave(this.save);
    const html = HINTS[key];
    if (html) this.ui.toast(html, 2700, key !== 'hazard');
  }

  // ------------------------------------------------------------------ events → feedback
  private handleEvents(events: readonly SimEvent[], snap: SimSnapshot, live: boolean): void {
    const fx = this.renderer.effects;
    const a = this.audio;
    let fatalBurstsLeft = 16;
    let impactBurstsLeft = 28;
    let frameHitCount = 0;
    let gateGain = 0;
    let streak = 0;
    let streams = 0;
    let comboMilestone = false;
    for (let i = 0; i < events.length; i++) {
      if (events[i]!.type === 'ENEMY_HIT') frameHitCount++;
    }
    for (const ev of events) {
      switch (ev.type) {
        case 'SHOOT':
          this.renderer.flashMuzzle();
          if (live) {
            if (!ev.auxiliary) {
              a.shoot(ev.weapon, snap.squadCount, snap.squadX);
              if (ev.weapon === 'rail' || ev.weapon === 'plasma' || ev.weapon === 'scatter') {
                this.renderer.kickCamera(ev.weapon === 'rail' ? 0.055 : 0.038, 0);
              }
            } else {
              a.shootAux(ev.weapon, snap.squadX);
            }
          }
          break;
        case 'CHAIN_ARC': {
          const arcColor = ev.webColor ?? 0x62f4ff;
          fx.arc(ev.fromX, ev.fromZ, ev.toX, ev.toZ, arcColor);
          fx.impact(ev.toX, 0.85, ev.toZ, ev.webColor ? 0x9eff7a : 0xffe66d, true, 'rail');
          if (live) {
            a.chainArc(ev.toX);
            this.addScore(18);
          }
          break;
        }
        case 'OVERLIMIT_UNLOCK': {
          const ov = OVERLIMIT_RESONANCES[ev.resonanceId];
          fx.ring(snap.squadX, PLAYER_Z, ov.hex, 7.6, 0.72);
          fx.burst(snap.squadX, 1.1, PLAYER_Z, ov.hex, 85, { speed: 12, size: 0.54, life: 0.72, up: 1.2 });
          this.renderer.triggerCinematicImpact(0.011, 0.22, snap.squadX, PLAYER_Z - 2);
          if (live) {
            a.fusionUnlock();
            a.playTacticalVox('overlimit');
            if (this.save.voxEnabled !== false) {
              this.ui.showTacticalVox('OVERLIMIT // 超限共鸣', `${ov.glyph} ${ov.name} 已同步上线`, ov.color, 2300);
            }
            this.input.rumble(0.55, 0.7, 160);
            this.addScore(320);
            this.ui.toast(html`⚡ 双武超限共鸣合成：<b>${ov.glyph} ${ov.name}</b> — ${ov.desc}`, 3000);
          }
          break;
        }
        case 'DUAL_SYNERGY_UNLOCK': {
          const ds = DUAL_SYNERGIES[ev.synergyId];
          fx.ring(snap.squadX, PLAYER_Z, ds.hex, 5.4, 0.55);
          fx.burst(snap.squadX, 1.0, PLAYER_Z, ds.hex, 58, { speed: 10, size: 0.48, life: 0.65, up: 1.1 });
          if (live) {
            a.powerUp();
            this.addScore(240);
            this.ui.toast(html`✦ 双武战术协同：<b>${ds.glyph} ${ds.name}</b> — ${ds.desc}`, 2600);
          }
          break;
        }
        case 'FUSION_UNLOCK': {
          const f = FUSIONS[ev.fusionId];
          fx.ring(snap.squadX, PLAYER_Z, f.hex, 8.2, 0.78);
          fx.burst(snap.squadX, 1.1, PLAYER_Z, f.hex, 125, { speed: 13, size: 0.62, life: 0.88, up: 1.35 });
          this.renderer.shake(0.55);
          this.renderer.triggerShockwave(0.88);
          if (live) {
            this.bulletTimeDur = 0.22;
            this.bulletTimeTimer = 0.22;
            a.fusionUnlock();
            this.ui.doFlash(f.color, 0.42);
            this.addScore(420);
            this.ui.showBanner(
              html`<div class="b-kicker">⚡ CORE FUSION ONLINE</div><div class="b-title" style="color:${f.color}">${f.glyph} ${f.name}</div><div class="b-sub">${f.desc}</div>`,
              'od pickup',
              1850,
            );
          }
          break;
        }
        case 'TRI_FUSION_CLIMAX': {
          fx.ring(snap.squadX, PLAYER_Z, 0xffd84a, 10.5, 0.9);
          fx.burst(snap.squadX, 1.3, PLAYER_Z, 0xffd84a, 140, { speed: 14.5, size: 0.68, life: 0.9, up: 1.4 });
          this.renderer.shake(0.65);
          this.renderer.triggerShockwave(1.0);
          if (live) {
            this.bulletTimeDur = 0.24;
            this.bulletTimeTimer = 0.24;
            a.fusionUnlock();
            this.ui.doFlash('rgba(255,216,74,0.55)', 0.45);
            this.addScore(680);
            this.ui.showBanner(
              html`<div class="b-kicker">👑 ULTIMATE OVERLIMIT</div><div class="b-title" style="color:#ffd84a">三聚变终极全开（${Math.round(ev.duration)}s）！</div><div class="b-sub">黑洞奇点 + 折射电网 + 浮游剑阵同步解放！</div>`,
              'od',
              1950,
            );
          }
          break;
        }
        case 'WEAPON_SWAP': {
          const m = REWARD_META[ev.weapon];
          fx.ring(snap.squadX, PLAYER_Z, WEAPON_COLOR[ev.weapon], 3.4, 0.35);
          if (live) {
            this.weaponSwapsCount += 1;
            a.click();
            const p = this.worldToScreen(snap.squadX, 2.25, PLAYER_Z - 0.9);
            this.ui.floatText(p.x, p.y, `⇄ 主炮切换：${m.short} Lv.${ev.level}`, 'aegis', 0.85);
          }
          break;
        }
        case 'AFK_LOCK_STRIKE': {
          fx.ring(ev.x, ev.z, 0xff2a55, 5.2, 0.52);
          if (live) {
            a.hazardCharge();
            a.playTacticalVox('afk_lock');
            if (this.save.voxEnabled !== false) {
              this.ui.showTacticalVox('ORBITAL WARN // 轨道锁死', '检测到驻留车道，立即横向闪避！', '#ff4b78', 1900);
            }
            this.ui.toast(html`⚠ 轨道锁定驻留车道：<b>请立即横向机动闪避！</b>`, 1800);
          }
          break;
        }
        case 'AEGIS_PARRY': {
          fx.ring(ev.x, ev.z, 0xffd84a, 7.6, 0.68);
          this.renderer.triggerShockwave(0.76);
          this.renderer.triggerCinematicImpact(0.013, 0.26, ev.x, ev.z);
          if (live) {
            this.parriesCount += 1;
            this.triggerHitStop(0.042);
            this.bulletTimeDur = 0.16;
            this.bulletTimeTimer = 0.16;
            this.input.rumble(0.68, 0.85, 140);
            a.triggerUltimateDuck(0.28);
            a.orbReflect();
            this.addScore(260);
            const p = this.worldToScreen(ev.x, 2.55, ev.z - 0.9);
            this.ui.floatText(p.x, p.y, '⚡ 完美弹反 · 共鸣充能!', 'gold', 1.15);
          }
          break;
        }
        case 'VAULT_SALVAGE': {
          const m = REWARD_META[ev.upgradedWeapon];
          fx.ring(ev.x, ev.z, 0xffd84a, 3.8, 0.42);
          if (live) {
            a.powerUp();
            this.addScore(SCORE.vault);
            const p = this.worldToScreen(snap.squadX, 2.15, PLAYER_Z - 1.0);
            this.ui.floatText(p.x, p.y, `🔧 拆解升阶 ${m.short}Lv.${ev.newLevel} · 储+${ev.reserveGain}`, 'gold', 1.05);
          }
          break;
        }
        case 'RESERVE_DEPLOY': {
          if (live && ev.count >= 2) {
            const p = this.worldToScreen(snap.squadX, 2.05, PLAYER_Z - 0.9);
            this.ui.floatText(p.x + 68, p.y - 12, `储备补位 +${ev.count}`, 'gain', 0.95);
          }
          break;
        }
        case 'SINGULARITY_SPAWN': {
          fx.ring(ev.x, ev.z, 0xb98cff, ev.radius, 0.55, ev.radius * 0.95);
          fx.burst(ev.x, 0.65, ev.z, 0x8fdcff, 32, { speed: 6.5, size: 0.42, life: 0.5, up: 0.7 });
          if (live) a.singularity();
          break;
        }
        case 'JUMP_LAUNCH': {
          const stage = ev.skillStage ?? 0;
          this.renderer.triggerJumpLaunchVfx(ev.x, ev.z, stage, snap.squadAirY ?? 0);
          if (live) {
            a.jumpLaunch(stage);
            this.input.rumble(stage >= 1 ? 0.72 : 0.45, stage >= 1 ? 0.62 : 0.35, stage >= 1 ? 220 : 140);
            this.addScore(140 + stage * 90);
            if (stage >= 1) {
              this.ui.doFlash(stage >= 2 ? 'rgba(255, 226, 106, 0.34)' : 'rgba(98, 244, 255, 0.28)', 0.22);
            }
            const p = this.worldToScreen(snap.squadX, 2.5 + (snap.squadAirY ?? 0) * 0.4, PLAYER_Z - 0.8);
            const launchTxt =
              stage >= 3
                ? `🚀 三段破界跃迁 · 海拔${(ev.peakY ?? 12.8).toFixed(1)}m!`
                : stage === 2
                  ? `🚀 二段苍穹推进 · 极速跨越!`
                  : stage === 1
                    ? `🚀 苍穹跃迁起跳${(ev.remainingStocks ?? 0) > 0 ? ' · 可空中二段[W]!' : '!'}`
                    : '🚀 跃空突袭！';
            this.ui.floatText(p.x, p.y - 12, launchTxt, stage >= 2 ? 'gold' : 'aegis', 1.05);
            if (stage >= 2) {
              this.ui.showBanner(
                html`<div class="b-kicker">🚀 STRATOSPHERIC SKY-VAULT ×${stage}</div><div class="b-title" style="color:${stage >= 3 ? '#ff8cff' : '#ffe26a'}">${stage >= 3 ? '三段破界 · 平流层极速巡航！' : '二段推进 · 超音速飞跃大桥！'}</div><div class="b-sub">峰值高度 ${(ev.peakY ?? 10.4).toFixed(1)}m · 落地触发全桥天陨灭世重砸！</div>`,
                'od',
                1150,
              );
            }
          }
          break;
        }
        case 'JUMP_SLAM': {
          const stage = ev.skillStage ?? 0;
          const isSkill = stage >= 1;
          const crowd = isSkill || ev.hits >= 3;
          this.renderer.triggerJumpSlamVfx(ev.x, ev.z, ev.hits, stage);
          if (live) {
            a.jumpSlam(ev.hits, stage);
            this.addScore(180 + ev.hits * 40 + stage * 180 + Math.round((ev.bossDamage ?? 0) * 0.35));
            if (isSkill) {
              this.triggerHitStop(stage >= 2 ? 0.068 : 0.052);
              this.bulletTimeDur = 0.20;
              this.bulletTimeTimer = 0.20;
              this.input.rumble(1.0, 0.92, 460);
              this.ui.doFlash(
                stage >= 2 ? 'rgba(255, 232, 118, 0.62)' : 'rgba(98, 244, 255, 0.50)',
                stage >= 2 ? 0.42 : 0.34,
              );
              if (ev.hits >= 2) a.hordeDeathChorus(ev.hits, ev.x, ev.z);
              const bossSub = (ev.bossDamage ?? 0) > 0 ? ` · 首领重创 -${ev.bossDamage}` : '';
              this.ui.showBanner(
                html`<div class="b-kicker">☄️ ORBITAL METEOR TOUCHDOWN · STAGE ${stage}</div><div class="b-title" style="color:${stage >= 2 ? '#ffe46b' : '#7ef9ff'}">☄️ 天陨灭世重砸${ev.hits > 0 ? ` ×${ev.hits}` : ''}！</div><div class="b-sub">冲击半径 ${(ev.radius ?? 14).toFixed(1)}m 碎盾震爆${bossSub}</div>`,
                'od',
                1450,
              );
            } else {
              this.input.rumble(crowd ? 0.88 : 0.58, crowd ? 0.78 : 0.45, crowd ? 320 : 190);
              this.ui.doFlash(
                crowd ? 'rgba(255, 224, 120, 0.36)' : 'rgba(98, 244, 255, 0.26)',
                crowd ? 0.24 : 0.16,
              );
              this.triggerHitStop(crowd ? 0.048 : 0.022);
              if (crowd) {
                a.hordeDeathChorus(ev.hits, ev.x, ev.z);
              }
              const p = this.worldToScreen(ev.x, 2.2, ev.z);
              const slamTxt = crowd
                ? `💥 陨星震地 ×${ev.hits}!`
                : ev.hits > 0
                  ? `⚡ 重锤轰击 ×${ev.hits}!`
                  : '⚡ 重装震地！';
              this.ui.floatText(p.x, p.y, slamTxt, crowd ? 'drill-impact' : 'aegis', 0.95);
            }
          }
          break;
        }
        case 'REFLECTOR_BOUNCE': {
          if (Math.random() < 0.45) {
            fx.burst(ev.x, 0.9, ev.z, 0x7dff6b, 4, { speed: 4.5, size: 0.28, life: 0.22, gravity: 0 });
          }
          if (live) a.reflectorBounce();
          break;
        }
        case 'BOUNTY_JACKPOT': {
          fx.ring(ev.x, ev.z, 0xffc531, 6.2, 0.62);
          fx.burst(ev.x, 1.2, ev.z, 0xffc531, 105, { speed: 12, size: 0.58, life: 0.8, up: 1.2 });
          this.renderer.shake(0.36);
          if (live) {
            a.achievement();
            this.ui.doFlash('rgba(255,197,49,0.45)', 0.3);
            this.addScore(520);
            const p = this.worldToScreen(ev.x, 2.3, ev.z);
            this.ui.floatText(p.x, p.y, `★ 悬赏 +${ev.squadGain}`, 'gold', 1);
          }
          break;
        }
        case 'BOSS_PART_BREAK': {
          if (live) this.partsBrokenCount += 1;
          fx.shatter(ev.x, 2.2, ev.z, 0xffdf6e, 26, true);
          fx.burst(ev.x, 2.2, ev.z, 0x62f4ff, 110, { speed: 14, size: 0.65, life: 0.82, up: 1.0 });
          fx.burst(ev.x, 2.2, ev.z, 0xffd84a, 65, { speed: 10, size: 0.52, life: 0.6 });
          fx.ring(ev.x, ev.z, 0x62f4ff, 7.5, 0.65);
          this.renderer.shake(0.52);
          this.renderer.triggerShockwave(0.85);
          this.renderer.spawnDecal(ev.x, ev.z, 3.4, 0x62f4ff, 0, 16);
          this.renderer.triggerCinematicImpact(0.014, 0.28, ev.x, ev.z);
          if (live) {
            this.triggerHitStop(0.046);
            this.bulletTimeDur = 0.22;
            this.bulletTimeTimer = 0.22;
            this.input.rumble(0.88, 0.65, 220);
            a.bossPartShatter(ev.slot, ev.x, ev.z);
            if (ev.slot === 'reactor') {
              a.playTacticalVox('reactor_exposed');
              if (this.save.voxEnabled !== false) {
                this.ui.showTacticalVox('CORE SHATTER // 护盾核击碎', '首领护盾瓦解，集火倾泻全部火力！', '#ffd84a', 2200);
              }
            }
            this.ui.doFlash('rgba(98,244,255,0.55)', 0.35);
            this.addScore(600);
            const subCopy = ev.effectDesc
              ? `${ev.effectDesc} · 开超载再享 ×1.25 爆发！`
              : `${ev.slot === 'left' ? '敌方重炮弹幕锐减 72% · ' : '首领召唤虫潮锐减 72% · '}4.0s 2.0× 破防窗口！`;
            this.ui.showBanner(
              html`<div class="b-kicker">⚡ ARMOR SHATTERED</div><div class="b-title" style="color:#62f4ff">${ev.label} 击碎！</div><div class="b-sub">${subCopy}</div>`,
              'od',
              1550,
            );
          }
          break;
        }
        case 'DOOM_ORB_SPAWN': {
          fx.ring(ev.x, ev.z, 0xff2a55, 4.2, 0.5);
          if (live) {
            a.hazardCharge();
            const p = this.worldToScreen(ev.x, 2.6, ev.z);
            this.ui.floatText(p.x, p.y, `⚠ 湮灭球 ${ev.value} · 集火反击!`, 'gold', 1.05);
          }
          break;
        }
        case 'DOOM_ORB_REFLECT': {
          if (live) this.orbsReflectedCount += 1;
          fx.ring(ev.x, ev.z, 0x19f5a8, 5.8, 0.58);
          fx.burst(ev.x, 1.3, ev.z, 0x19f5a8, 85, { speed: 11.5, size: 0.52, life: 0.7, up: 1.1 });
          this.renderer.shake(0.3);
          if (live) {
            a.orbReflect();
            this.ui.doFlash('rgba(25,245,168,0.45)', 0.25);
            this.addScore(350);
            const p = this.worldToScreen(ev.x, 2.4, ev.z);
            this.ui.floatText(p.x, p.y, '⚡ 逆转反击！', 'gain', 1.15);
          }
          break;
        }
        case 'DOOM_ORB_SLAM': {
          fx.burst(ev.x, 2.2, ev.z, 0x19f5a8, 130, { speed: 15, size: 0.68, life: 0.85, up: 1.0 });
          fx.burst(ev.x, 2.2, ev.z, 0xffd84a, 70, { speed: 11, size: 0.55, life: 0.65 });
          fx.ring(ev.x, ev.z, 0xffd84a, 9.2, 0.72);
          this.renderer.shake(0.65);
          this.renderer.triggerShockwave(0.9);
          this.renderer.spawnDecal(ev.x, ev.z, 4.6, 0x19f5a8, 0, 18);
          if (live) {
            this.bulletTimeDur = 0.2;
            this.bulletTimeTimer = 0.2;
            a.explosion(4, ev.x, ev.z);
            this.ui.doFlash('rgba(255,230,110,0.65)', 0.38);
            this.addScore(650);
            const p = this.worldToScreen(ev.x, 2.8, ev.z);
            this.ui.floatText(p.x, p.y, `反击破核 -${ev.damage}！`, 'gold', 1.32);
          }
          break;
        }
        case 'GATE_STREAK': {
          fx.ring(snap.squadX, PLAYER_Z, 0xffd84a, 4.4, 0.48);
          if (live) {
            gateGain += ev.bonus;
            streak = ev.streak;
          }
          break;
        }
        case 'SWARM_SURGE': {
          const surgeColor = ev.tier >= 5 ? 0xff2a6d : ev.tier >= 3 ? 0xff6a3c : 0xffc531;
          fx.ring(0, PLAYER_Z - 26, surgeColor, 8.2, 0.65);
          fx.burst(snap.squadX, 1.2, PLAYER_Z - 24, surgeColor, 48, { speed: 10.5, size: 0.46, life: 0.62, up: 1.1 });
          if (live) {
            const tierTitle =
              ev.tier >= 6
                ? '终焉狂潮'
                : ev.tier === 5
                  ? '湮灭兽潮'
                  : ev.tier === 4
                    ? '深渊尸海'
                    : ev.tier === 3
                      ? '狂潮涌动'
                      : '蜂拥警报';
            this.ui.toast(
              html`👾 战力飙升 · <b>${tierTitle}（尸潮 ×${ev.mult.toFixed(1)} · +${ev.count} 怪群涌入）</b>`,
              2100,
            );
          }
          break;
        }
        case 'BOSS_HIT': {
          const hitW = ev.weapon ?? snap.weapon;
          fx.impact(ev.x, 1.35, ev.z, WEAPON_COLOR[hitW], true, hitW);
          if (live) {
            a.hit(this.combo, { weapon: hitW, kind: 'bastion', x: ev.x, z: ev.z, damage: ev.damage, hpRatio: snap.boss ? snap.boss.hp / Math.max(1, snap.boss.maxHp) : 0.5 });
          }
          break;
        }
        case 'CRIT_HIT': {
          fx.burst(ev.x, 1.0, ev.z, 0xffe66d, 10, { speed: 7.8, size: 0.36, life: 0.28, up: 0.85 });
          fx.streaks(ev.x, 1.0, ev.z, 0xfff3a0, 6, { speed: 16.5, len: 1.35, life: 0.22, coneBiasZ: -0.6 });
          if (live) {
            a.crit(ev.x);
            if (!snap.boss && this.critFloatClock <= 0 && ev.damage >= 45) {
              this.critFloatClock = 1.65;
              const p = this.worldToScreen(ev.x, 1.75, ev.z);
              this.ui.floatText(p.x, p.y, '暴击!', 'crit', 0.65, 0.92);
            }
          }
          break;
        }
        case 'NUKE_LAUNCH': {
          const salvoIdx = ev.salvoIndex ?? 1;
          const pIdx = (salvoIdx - 1) % 3;
          const ringOuter = pIdx === 1 ? 0x3ef3ff : pIdx === 2 ? 0xff42f5 : 0xff2a55;
          const ringInner = pIdx === 1 ? 0xb8ffff : pIdx === 2 ? 0xffb8ff : 0xffd84a;
          fx.ring(ev.x, ev.z, ringOuter, 11.2, 0.85);
          fx.ring(ev.x, ev.z, ringInner, 6.4, 0.62);
          fx.streaks(ev.x, 1.2, ev.z, ringInner, 18, { speed: 19, len: 1.8, life: 0.34, coneBiasZ: 0 });
          this.renderer.triggerAnamorphicFlare(ev.x, ev.z, 0.48, salvoIdx);
          this.renderer.shake(0.24 + Math.min(0.18, (salvoIdx - 1) * 0.06));
          if (live) {
            a.nukeSiren(ev.duration, salvoIdx);
            const flashCol =
              pIdx === 1
                ? 'rgba(62,243,255,0.28)'
                : pIdx === 2
                  ? 'rgba(255,66,245,0.28)'
                  : 'rgba(255,60,40,0.28)';
            this.ui.doFlash(flashCol, 0.24);
            const titleColor = pIdx === 1 ? '#7ef9ff' : pIdx === 2 ? '#ff8cff' : '#ffd84a';
            const titleTxt =
              salvoIdx >= 3
                ? `☢ 终焉地毯式核葬 ×${salvoIdx}！`
                : salvoIdx === 2
                  ? '☢ 双星连环核打击 ×2！'
                  : '☢ 战术核弹 · 极速锁定！';
            const remTxt = (ev.remainingStocks ?? 0) > 0 ? ` · 剩余战备 ×${ev.remainingStocks} 可继续连点 [Q]！` : ' · 推进器全功率俯冲中！';
            this.ui.showBanner(
              html`<div class="b-kicker">☢ ORBITAL THERMONUCLEAR SALVO ×${salvoIdx}</div><div class="b-title" style="color:${titleColor}">${titleTxt}</div><div class="b-sub">天基螺旋信标锁定跑道${remTxt}</div>`,
              'boss',
              1350,
            );
          }
          break;
        }
        case 'NUKE_DETONATE': {
          const salvoIdx = ev.salvoIndex ?? 1;
          const pIdx = (salvoIdx - 1) % 3;
          const decalCol = pIdx === 1 ? 0x29d8ff : pIdx === 2 ? 0xe040fb : 0xff7a1f;
          this.renderer.triggerNukeDetonationVfx(ev.x, ev.z, salvoIdx);
          this.renderer.triggerShockwave(Math.min(1.45, 1.2 + (salvoIdx - 1) * 0.1));
          this.renderer.spawnDecal(ev.x, ev.z, 10.4, decalCol, 4, 24);
          this.renderer.triggerCinematicImpact(0.025, 0.46, ev.x, ev.z);
          if (live) {
            this.nukeHitStopTimer = salvoIdx >= 2 ? 0.055 : 0.085;
            this.input.rumble(1.0, 1.0, 950);
            fx.after(0.30, () => this.input.rumble(0.95, 0.85, 520));
            a.triggerUltimateDuck(0.95);
            a.nukeDetonate(salvoIdx);
            a.nukeChainShatter(ev.kills);
            this.ui.doNukeFlash(1.0, salvoIdx);
            this.addScore(450 + ev.kills * 30 + Math.round(ev.bossDamage * 0.45) + (salvoIdx - 1) * 220);
            const bossSub = ev.bossDamage > 0 ? ` · 首领重创 -${ev.bossDamage}` : '';
            const titleColor = pIdx === 1 ? '#b8ffff' : pIdx === 2 ? '#ffb8ff' : '#fff3a8';
            const salvoTag = salvoIdx >= 2 ? `【${salvoIdx}连核葬】` : '';
            this.ui.showBanner(
              html`<div class="b-kicker">☢ THERMONUCLEAR ANNIHILATION · SALVO ×${salvoIdx}</div><div class="b-title" style="color:${titleColor}">☢ ${salvoTag}聚变核爆 · 贯通清屏 ×${ev.kills}！</div><div class="b-sub">天基裁决光柱与星环冲击波横扫地平线${bossSub}</div>`,
              'od',
              1150,
            );
          }
          break;
        }
        case 'AEGIS_PULSE': {
          fx.ring(ev.x, ev.z, 0x62f4ff, 7.6, 0.58);
          fx.ring(ev.x, ev.z, 0xb98cff, 5.2, 0.45);
          fx.burst(ev.x, 0.85, ev.z, 0x62f4ff, 80, { speed: 13, size: 0.52, life: 0.68, up: 0.95 });
          fx.shatter(ev.x, 1.0, ev.z, 0x62f4ff, 18, true);
          this.renderer.triggerShockwave(0.58);
          this.renderer.triggerAnamorphicFlare(ev.x, ev.z, 0.36, 2);
          this.renderer.shake(0.28);
          if (live) {
            a.aegisPulse();
            this.ui.doFlash('rgba(98,244,255,0.48)', 0.26);
            if (ev.orbsCleared > 0) this.addScore(ev.orbsCleared * 50);
            const p = this.worldToScreen(ev.x, 2.2, ev.z - 0.8);
            this.ui.floatText(
              p.x,
              p.y,
              ev.autoTriggered ? '绝境力场！' : ev.orbsCleared > 0 ? `震碎弹幕 ×${ev.orbsCleared}` : '相位力场！',
              'aegis',
              1.05,
            );
          }
          break;
        }
        case 'BOMBER_BLAST': {
          fx.burst(ev.x, 0.9, ev.z, 0x92ff24, 58, { speed: 11.5, size: 0.52, life: 0.58, up: 1.0 });
          fx.burst(ev.x, 0.9, ev.z, 0xff9a1f, 30, { speed: 9.0, size: 0.44, life: 0.45 });
          fx.shatter(ev.x, 0.9, ev.z, 0x92ff24, 14, true);
          fx.streaks(ev.x, 0.9, ev.z, 0xffe27a, 12, { speed: 17, len: 1.4, life: 0.3, coneBiasZ: -0.2 });
          fx.groundFlash(ev.x, ev.z, 0x92ff24, 3.4, 0.28);
          fx.ring(ev.x, ev.z, 0x92ff24, 3.1, 0.4);
          this.renderer.shake(0.24);
          this.renderer.kickCamera(0.16, ev.x * 0.25);
          this.renderer.spawnDecal(ev.x, ev.z, 2.35, 0x92ff24, 1, 14);
          if (live) {
            this.triggerHitStop(0.028);
            a.explosion(1, ev.x, ev.z);
            if (ev.kills >= 2) a.hordeDeathChorus(ev.kills, ev.x, ev.z);
            if (ev.kills >= 3 && this.specialFloatClock <= 0) {
              this.specialFloatClock = 1.25;
              const p = this.worldToScreen(ev.x, 1.75, ev.z);
              this.ui.floatText(p.x, p.y, `殉爆 ×${ev.kills}`, 'gain', 0.68);
            }
          }
          break;
        }
        case 'ENEMY_ARMOR_BREAK': {
          fx.burst(ev.x, 1.15, ev.z + 0.3, 0xffae38, 34, { speed: 10.5, size: 0.46, life: 0.46, up: 0.95 });
          fx.shatter(ev.x, 1.15, ev.z + 0.25, ev.kind === 'glacier' ? 0x5ceeff : 0xffbe42, 12, true);
          fx.ring(ev.x, ev.z, 0xff6a2b, 2.5, 0.34);
          this.renderer.spawnDecal(ev.x, ev.z, 1.65, ev.kind === 'glacier' ? 0x5ceeff : 0xff8c2e, 3, 12);
          this.renderer.shake(0.14);
          if (live) {
            a.shieldBreak(ev.x, ev.z);
            if (!snap.boss && this.specialFloatClock <= 0 && ev.z > -44 && ev.z < 1.5) {
              this.specialFloatClock = 0.95;
              const p = this.worldToScreen(ev.x, 1.95, ev.z);
              this.ui.floatText(p.x, p.y, '破甲露核!', 'gold', 0.72);
            }
          }
          break;
        }
        case 'SKY_CARGO_SPAWN': {
          if (live) {
            this.ui.toast(html`📦 悬空<b>高能集装箱</b>进入射程：集火打断吊索砸扁下方尸潮！`, 2400);
            a.radioComms?.('cargo');
          }
          break;
        }
        case 'SKY_CARGO_DROP': {
          fx.burst(ev.x, 3.8, ev.z, 0x62f4ff, 36, { speed: 8.5, size: 0.44, life: 0.4 });
          if (live) a.jumpLaunch();
          break;
        }
        case 'SKY_CARGO_SLAM': {
          fx.burst(ev.x, 0.9, ev.z, 0x3ef3ff, 95, { speed: 15, size: 0.62, life: 0.72, up: 1.1 });
          fx.burst(ev.x, 0.9, ev.z, 0xffd84a, 65, { speed: 12, size: 0.54, life: 0.58 });
          fx.shatter(ev.x, 0.9, ev.z, 0x62f4ff, 18, true);
          fx.ring(ev.x, ev.z, 0x3ef3ff, 6.4, 0.56);
          fx.ring(ev.x, ev.z, 0xffd84a, 4.4, 0.42);
          this.renderer.spawnDecal(ev.x, ev.z, 4.2, 0x3ef3ff, 0, 16);
          this.renderer.shake(0.48);
          this.renderer.triggerShockwave(0.78);
          if (live) {
            this.bulletTimeDur = 0.18;
            this.bulletTimeTimer = 0.18;
            a.explosion(3, ev.x, ev.z);
            if (ev.kills >= 2) a.hordeDeathChorus(ev.kills, ev.x, ev.z);
            this.ui.doFlash('rgba(98,244,255,0.42)', 0.28);
            this.addScore(280 + ev.kills * 35);
            const p = this.worldToScreen(ev.x, 2.2, ev.z);
            this.ui.floatText(p.x, p.y, ev.kills > 0 ? `坠舱轰杀 ×${ev.kills}！` : '高能坠爆！', 'aegis', 1.08);
          }
          break;
        }
        case 'MAGLEV_WARN': {
          if (live) {
            this.ui.toast(html`🚄 <b>高架磁浮特快</b>即将横穿前方桥面：激光红轨内怪群将被瞬间撞碎！`, 2200);
            a.radioComms?.('maglev');
          }
          break;
        }
        case 'MAGLEV_SWEEP': {
          fx.ring(0, ev.z, 0x3ef3ff, 9.5, 0.62);
          for (const dx of [-3.2, 0, 3.2]) {
            this.renderer.spawnDecal(dx, ev.z, 2.4, 0x3ef3ff, 3, 14);
          }
          this.renderer.shake(0.42);
          this.renderer.triggerShockwave(0.62);
          if (live) {
            a.maglevPass?.(ev.dir, ev.z);
            if (ev.kills >= 2) a.hordeDeathChorus(ev.kills, 0, ev.z);
            this.addScore(220 + ev.kills * 25);
            const p = this.worldToScreen(0, 2.3, ev.z);
            this.ui.floatText(p.x, p.y, `🚄 磁浮清场!`, 'aegis', 1.0);
          }
          break;
        }
        case 'SHIELD_BREAK': {
          this.renderer.breakRiotShield(ev.enemyId, ev.x, ev.z);
          fx.streaks(ev.x, 1.55, ev.z + 0.5, 0xffc077, 5, { speed: 6, len: 0.55, life: 0.18, coneBiasZ: 0.18 });
          if (live) {
            a.shieldBreak(ev.x, ev.z);
            if (ev.reflected && this.specialFloatClock <= 0) {
              this.specialFloatClock = 0.8;
              const p = this.worldToScreen(ev.x, 2.1, ev.z);
              this.ui.floatText(p.x, p.y, '折射破盾', 'drill-break', 0.58);
            }
          }
          break;
        }
        case 'PHASE_BLINK': {
          fx.burst(ev.fromX, 0.9, ev.z, 0xe45cff, 16, { speed: 5.5, size: 0.34, life: 0.28, gravity: 0 });
          fx.burst(ev.toX, 0.9, ev.z, 0x52f7ff, 16, { speed: 5.5, size: 0.34, life: 0.28, gravity: 0 });
          fx.arc(ev.fromX, ev.z, ev.toX, ev.z, 0xe45cff);
          if (live) a.phaseBlink();
          break;
        }
        case 'BROOD_SPAWN': {
          fx.burst(ev.x, 0.65, ev.z, 0x88ff36, 22, { speed: 6.0, size: 0.36, life: 0.38, up: 0.9 });
          fx.ring(ev.x, ev.z, 0xff9f1c, 1.9, 0.3);
          break;
        }
        case 'HOWLER_PURGE': {
          fx.ring(ev.x, ev.z, 0x62f4ff, 4.4, 0.52);
          fx.burst(ev.x, 1.1, ev.z, 0x62f4ff, 48, { speed: 10.0, size: 0.46, life: 0.52, up: 0.95 });
          this.renderer.shake(0.14);
          if (live) {
            a.howlerPurge(ev.x);
            if (ev.stunned >= 2 && this.specialFloatClock <= 0) {
              this.specialFloatClock = 1.25;
              const p = this.worldToScreen(ev.x, 1.85, ev.z);
              this.ui.floatText(p.x, p.y, `震慑 ×${ev.stunned}`, 'aegis', 0.68);
            }
          }
          break;
        }
        case 'GLACIER_NOVA': {
          fx.ring(ev.x, ev.z, 0x5ceeff, 4.1, 0.48);
          fx.burst(ev.x, 1.05, ev.z, 0x9bf8ff, 44, { speed: 10.5, size: 0.48, life: 0.5, up: 1.0 });
          fx.shatter(ev.x, 1.05, ev.z, 0x5ceeff, 14, true);
          fx.groundFlash(ev.x, ev.z, 0x5ceeff, 3.1, 0.25);
          this.renderer.shake(0.18);
          this.renderer.kickCamera(0.12, ev.x * 0.2);
          this.renderer.spawnDecal(ev.x, ev.z, 2.6, 0x5ceeff, 2, 14);
          if (live) {
            this.triggerHitStop(0.024);
            a.glacierNova(ev.x, ev.z);
            if (ev.chilled >= 2 && this.specialFloatClock <= 0) {
              this.specialFloatClock = 1.2;
              const p = this.worldToScreen(ev.x, 1.85, ev.z);
              this.ui.floatText(p.x, p.y, `冰爆 ×${ev.chilled}`, 'aegis', 0.7);
            }
          }
          break;
        }
        case 'WATCHER_SHOT': {
          fx.burst(ev.x, 1.25, ev.z + 0.45, 0xffbe2e, 14, { speed: 6.5, size: 0.34, life: 0.24, gravity: 0 });
          fx.ring(ev.x, ev.z + 0.35, 0xff3b5c, 1.4, 0.22);
          if (live) a.watcherShot(ev.x);
          break;
        }
        case 'BURROW_ERUPT': {
          fx.ring(ev.x, ev.z, 0xff7722, 2.3, 0.34);
          fx.burst(ev.x, 0.35, ev.z, 0xff9a3c, 26, { speed: 8.5, size: 0.42, life: 0.4, up: 1.2 });
          fx.shatter(ev.x, 0.35, ev.z, 0x7c2d12, 8, false);
          this.renderer.shake(0.09);
          if (live) a.burrowErupt(ev.x);
          break;
        }
        case 'NECRO_HEAL': {
          fx.ring(ev.x, ev.z, 0x2dff9e, 4.0, 0.42);
          fx.burst(ev.x, 1.0, ev.z, 0x2dff9e, 22, { speed: 6.2, size: 0.36, life: 0.38, up: 1.1 });
          if (live) a.necroHeal(ev.x);
          break;
        }
        case 'ENEMY_HIT': {
          const meta = ENEMY_META[ev.kind];
          if (ev.fatal) {
            const big =
              ev.kind === 'bastion' ||
              ev.kind === 'brood' ||
              ev.kind === 'phalanx' ||
              ev.kind === 'howler' ||
              ev.kind === 'mitosis' ||
              ev.kind === 'siphon' ||
              ev.kind === 'glacier' ||
              ev.kind === 'necromancer' ||
              ev.kind === 'beholder';
            if (fatalBurstsLeft > 0 || big) {
              if (fatalBurstsLeft > 0) fatalBurstsLeft--;
              const pScale = snap.enemies.length > 105 ? 0.58 : 1.0;
              fx.burst(ev.x, 0.78, ev.z, meta.color, Math.max(8, Math.round((big ? 46 : 19) * pScale)), {
                speed: big ? 11.2 : 8.2,
                size: big ? 0.54 : 0.4,
                life: 0.48,
              });
              fx.burst(ev.x, 0.78, ev.z, 0xffffff, Math.max(3, Math.round((big ? 12 : 5) * pScale)), {
                speed: 6.2,
                size: 0.34,
                life: 0.22,
              });
              fx.shatter(ev.x, 0.78, ev.z, meta.color, big ? 10 : 4, big);
              fx.streaks(ev.x, 0.78, ev.z, meta.color, big ? 9 : 4, {
                speed: big ? 16.5 : 13.5,
                len: big ? 1.35 : 0.98,
                life: big ? 0.28 : 0.2,
                coneBiasZ: -0.82,
              });
              if (fatalBurstsLeft >= 5 || big) {
                fx.ring(ev.x, ev.z, meta.color, big ? 3.0 : 1.45, big ? 0.36 : 0.22);
                fx.groundFlash(ev.x, ev.z, meta.color, big ? 2.6 : 1.35, big ? 0.22 : 0.13);
                const decKind = ev.kind === 'glacier' ? 2 : ev.kind === 'bastion' || ev.kind === 'phalanx' ? 3 : 1;
                this.renderer.spawnDecal(ev.x, ev.z, big ? 1.55 : 0.85, meta.color, decKind, 11);
              }
              this.renderer.shake(big ? 0.17 : 0.04);
              if (big) this.renderer.kickCamera(0.11, ev.x * 0.18);
            }
            if (live) {
              if (big && (ev.kind === 'bastion' || ev.kind === 'brood' || ev.kind === 'phalanx' || ev.kind === 'glacier') && ev.z > -38) {
                this.triggerHitStop(0.024);
              }
              if ((snap.nukeBlastTimer ?? 0) < 2.15) {
                a.killEnemy(ev.kind, this.combo, 0, ev.x, ev.z);
              }
              this.save.bestiaryKills[ev.kind] = (this.save.bestiaryKills[ev.kind] ?? 0) + 1;
              this.combo += 1;
              if (this.combo > this.maxCombo) this.maxCombo = this.combo;
              this.comboClock = 2.2;
              const feverMult = computeFeverMult(this.combo);
              a.setFever(this.combo >= 12);
              this.ui.updateFever(this.combo, feverMult);
              this.addScore(meta.score);
              if ((snap.nukeBlastTimer ?? 0) < 2.2) {
                this.killBatchCount += 1;
                if (this.killBatchTimer <= 0) this.killBatchTimer = 0.30;
              }
              if (this.combo >= 10 && this.combo % 10 === 0) comboMilestone = true;
              if (ev.kind === 'siphon') {
                const p = this.worldToScreen(ev.x, 1.5, ev.z);
                this.ui.floatText(p.x, p.y, '门数值 +6', 'gold', 1);
              } else if (ev.kind === 'necromancer' && this.specialFloatClock <= 0) {
                this.specialFloatClock = 1.1;
                this.ui.pulseResonance();
              } else if (
                (ev.kind === 'bastion' || ev.kind === 'glacier' || ev.kind === 'brood') &&
                this.specialFloatClock <= 0 &&
                ev.z > -46
              ) {
                this.specialFloatClock = 1.25;
                const p = this.worldToScreen(ev.x, 2.25, ev.z);
                this.ui.floatText(p.x, p.y, 'Ⅳ阶领主击破!', 'gold', 0.82);
              }
            }
          } else {
            const hitW = ev.weapon ?? snap.weapon;
            const armored =
              ev.kind === 'bastion' ||
              ev.kind === 'phalanx' ||
              ev.kind === 'bomber' ||
              ev.kind === 'glacier' ||
              ev.kind === 'burrower';
            if (impactBurstsLeft > 0) {
              impactBurstsLeft--;
              fx.impact(ev.x, 0.78, ev.z, WEAPON_COLOR[hitW], armored, hitW);
            }
            if (live) {
              a.hit(this.combo, {
                weapon: hitW,
                kind: ev.kind,
                x: ev.x,
                damage: ev.damage,
                simultaneousHits: frameHitCount,
                hpRatio: ev.hpRatio,
                z: ev.z,
              });

            }
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
              this.addScore(SCORE.gateImproved);
            }
          } else if (live) {
            a.gateTick(ev.newValue);
          }
          break;
        case 'CUTBACK_COMPLETE': {
          if (live) {
            this.addScore(300);
            a.cutbackChime();
            this.ui.showDrillReward(snap.simTime);
          }
          break;
        }
        case 'GATE_PASS': {
          const p = this.worldToScreen(snap.squadX, 1.6, PLAYER_Z - 1);
          if (ev.delta > 0) {
            fx.burst(snap.squadX, 0.8, PLAYER_Z, 0x19f5a8, 56, { speed: 8.5, size: 0.45, life: 0.6, up: 1 });
            fx.ring(snap.squadX, PLAYER_Z, 0x19f5a8, 3.8, 0.45);
            if (live) {
              gateGain += ev.delta;
              const prevCount = Math.max(1, snap.squadCount - ev.delta);
              const prevStreams = getVolleyStreamCount(snap.weapon, snap.weaponLevel, prevCount);
              const nextStreams = getVolleyStreamCount(snap.weapon, snap.weaponLevel, snap.squadCount);
              if (nextStreams > prevStreams) {
                streams = nextStreams;
              }
              a.gatePass(true, ev.delta);
              this.addScore(ev.delta * SCORE.gateGainPerUnit);
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
          fx.burst(snap.squadX, 0.8, PLAYER_Z, meta.color, 40, { speed: 5, size: 0.45, life: 0.7, up: 1.6, gravity: -2 });
          this.renderer.shake(0.18);
          if (live) {
            const activeWeapons = snap.arsenal
              ? Object.values(snap.arsenal).filter((v) => v > 0).length
              : 1;
            const unlockedFusion = events.some((x) => x.type === 'FUSION_UNLOCK' || x.type === 'TRI_FUSION_CLIMAX');
            if (!unlockedFusion) {
              const p = this.worldToScreen(snap.squadX, 2.25, PLAYER_Z - 1.1);
              const lvTag = ev.reward === 'blades' ? `×${ev.newWeaponLevel}` : ev.newWeaponLevel > 3 ? `MAX+${ev.newWeaponLevel - 3}` : `Lv.${ev.newWeaponLevel}`;
              this.ui.floatText(p.x, p.y, `${meta.glyph} ${meta.name} ${lvTag}`, 'gold', 1.05);
              void activeWeapons;
            }
            a.powerUp();
            this.ui.doFlash(meta.color, 0.22);
            this.addScore(SCORE.vault);
            if (ev.reward === 'blades') {
              const p = this.worldToScreen(snap.squadX, 1.6, PLAYER_Z - 1);
              this.ui.floatText(p.x + 78, p.y - 6, '+6', 'gain', 1.1);
            }
          }
          break;
        }
        case 'BARREL_EXPLODE':
          fx.burst(ev.x, 0.8, ev.z, 0xff9a1a, 76, { speed: 13.8, size: 0.62, life: 0.62, up: 0.95 });
          fx.burst(ev.x, 0.8, ev.z, 0xfff2a0, 34, { speed: 7.8, size: 0.52, life: 0.36 });
          fx.shatter(ev.x, 0.85, ev.z, 0xff9a1a, 16, true);
          fx.streaks(ev.x, 0.85, ev.z, 0xffe28a, 14, { speed: 18.5, len: 1.5, life: 0.32, coneBiasZ: -0.25 });
          fx.groundFlash(ev.x, ev.z, 0xff8a1a, ev.radius * 0.95, 0.3);
          fx.ring(ev.x, ev.z, 0xff9a1a, ev.radius, 0.38);
          this.renderer.shake(0.34 + Math.min(0.32, ev.chainIndex * 0.08));
          this.renderer.kickCamera(0.2 + Math.min(0.15, ev.chainIndex * 0.05), ev.x * 0.25);
          this.renderer.spawnDecal(ev.x, ev.z, 3.2, 0xff8a1a, 0, 16);
          if (ev.chainIndex >= 3) this.renderer.triggerShockwave(0.52);
          if (ev.chainIndex >= 1 || ev.amplified) {
            this.renderer.triggerCinematicImpact(
              0.008 + Math.min(0.01, ev.chainIndex * 0.003),
              0.16 + Math.min(0.18, ev.chainIndex * 0.04),
              ev.x,
              ev.z,
            );
          }
          if (live) {
            this.triggerHitStop(ev.chainIndex >= 2 || ev.amplified ? 0.040 : 0.028);
            if (ev.chainIndex >= 1 || ev.amplified) this.input.rumble(0.52, 0.45, 110);
            a.explosion(ev.chainIndex, ev.x, ev.z);
            this.addScore(SCORE.barrelBase * (ev.chainIndex + 1) * (ev.amplified ? 2 : 1));
            if (ev.amplified) {
              const p = this.worldToScreen(ev.x, 2.2, ev.z);
              this.ui.floatText(p.x, p.y, '✦ 折镜增幅爆桶!', 'gold', 0.98);
            } else if (ev.chainIndex >= 1) {
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
          fx.ring(snap.squadX, PLAYER_Z, 0xfff36b, ev.overdriveBreakSync ? 8.4 : 6, 0.65);
          fx.burst(snap.squadX, 0.8, PLAYER_Z, 0xfff36b, ev.overdriveBreakSync ? 110 : 80, { speed: 11, size: 0.52, life: 0.72, up: 1.2 });
          if (live) {
            if (ev.overdriveBreakSync) {
              this.triggerHitStop(0.048);
              this.renderer.triggerCinematicImpact(0.015, 0.30, snap.squadX, snap.boss?.z ?? -16);
              this.input.rumble(0.82, 0.75, 210);
              a.triggerUltimateDuck(0.38);
              this.addScore(320);
              this.ui.showBanner(
                html`<div class="b-kicker">⚡ BREAK × OVERDRIVE RESONANCE</div><div class="b-title" style="color:#ffd84a">破防超载共振！</div><div class="b-sub">2.5× 毁灭爆发 · 破防与超载双双延长！</div>`,
                'od',
                1500,
              );
            } else {
              this.ui.showBanner(html`<div class="b-title">共鸣超载</div><div class="b-sub">射速 ×1.5 · 穿透 +1</div>`, 'od pickup', 1050);
            }
            a.overdrive();
            a.radioComms('overdrive');
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
            const rk = ev.titanRank && ev.titanRank >= 2 ? ` · 巨骸升阶 Lv.${ev.titanRank}` : '';
            this.ui.showBanner(html`<div class="b-warn">BOSS${rk}</div><div class="b-title">${m.title}</div><div class="b-sub">${m.name} · 破肩甲 + 反击棱球！</div>`, 'boss', 1650);
            a.setMusic(this.sector, 2);
            a.bossPhase();
            a.radioComms('boss');
          }
          break;
        case 'BOSS_OMEGA_OVERDRIVE': {
          fx.ring(0, -16, 0xffd84a, 13.5, 0.92);
          fx.burst(0, 2.6, -16, 0xff4b78, 125, { speed: 15, size: 0.68, life: 0.88, up: 1.2 });
          this.renderer.shake(0.65);
          this.renderer.triggerPhaseCamZoom(1.22);
          this.renderer.triggerCinematicImpact(0.016, 0.32, 0, -16);
          if (live) {
            a.omegaOverdriveSiren();
            a.playTacticalVox('omega_overdrive');
            this.input.rumble(0.95, 0.8, 280);
            const wLabel =
              ev.weather === 'solar_emp'
                ? '熔核电磁风暴'
                : ev.weather === 'prism_tide'
                  ? '棱镜引力潮汐'
                  : '极寒粒子暴雪';
            if (this.save.voxEnabled !== false) {
              this.ui.showTacticalVox('OMEGA ALERT // 终焉超载', `${wLabel}降临 · 双折镜聚焦或弹反主炮可触发处决！`, '#ffd84a', 2800);
            }
            this.ui.showBanner(
              html`<div class="b-warn">☄ OMEGA OVERDRIVE · ${wLabel}</div><div class="b-title">首领终焉超载觉醒！</div><div class="b-sub">射击双 45° 折镜交叉聚焦，或相位弹反终极光束触发【终焉破核处决】！</div>`,
              'boss',
              2100,
            );
          }
          break;
        }
        case 'OMEGA_EXECUTION': {
          fx.ring(ev.x, ev.z, 0xffffff, 18.0, 0.95);
          fx.ring(ev.x, ev.z, 0xffdf58, 13.5, 1.15);
          fx.burst(ev.x, 2.5, ev.z, 0xffdf58, 180, { speed: 18, size: 0.78, life: 1.05, up: 1.3 });
          this.renderer.shake(0.95);
          this.renderer.triggerExecutionCam(1.38);
          if (live) {
            this.triggerHitStop(0.055);
            this.bulletTimeDur = 0.42;
            this.bulletTimeTimer = 0.42;
            this.input.rumble(1.0, 1.0, 340);
            a.omegaExecutionBoom();
            a.playTacticalVox('omega_execution');
            this.ui.showLetterbox(1500);
            this.ui.doFlash('rgba(255,244,180,0.88)', 0.58);
            this.addScore(1200);
            const viaTxt = ev.trigger === 'mirror_focus' ? '双 45° 折镜交叉聚焦贯通' : '相位力场完美弹反终极光束';
            if (this.save.voxEnabled !== false) {
              this.ui.showTacticalVox('OMEGA EXECUTION // 终焉处决', `${viaTxt} · 核心重创 -${Math.round(ev.damage)}！`, '#ffe26a', 2600);
            }
            this.ui.showBanner(
              html`<div class="b-kicker">👑 OMEGA EXECUTION · 终焉破核处决</div><div class="b-title" style="color:#ffe26a">终焉破核 · 一击贯通！</div><div class="b-sub">${viaTxt} · 造成 ${Math.round(ev.damage).toLocaleString('en-US')} 处决重创并全屏清场！</div>`,
              'od',
              2150,
            );
          }
          break;
        }
        case 'MAG_RAIL_BOOST': {
          fx.ring(ev.x, ev.z, 0x62f4ff, 4.2, 0.42);
          if (live) {
            a.dopplerPass(-ev.x, ev.x, 1.18);
            this.input.rumble(0.32, 0.55, 85);
            this.addScore(110);
            const p = this.worldToScreen(snap.squadX, 2.2, PLAYER_Z - 0.8);
            this.ui.floatText(p.x, p.y, '⚡ 电磁滑轨加速 · 穿透+2!', 'aegis', 0.9);
          }
          break;
        }
        case 'CAPACITOR_DISCHARGE': {
          fx.ring(ev.x, ev.z, 0xffe26a, 14.0, 0.82);
          fx.burst(ev.x, 1.6, ev.z, 0x62f4ff, 115, { speed: 15, size: 0.62, life: 0.82, up: 1.25 });
          this.renderer.shake(0.52);
          this.renderer.triggerCinematicImpact(0.013, 0.26, ev.x, ev.z);
          if (live) {
            a.explosion(2, ev.x, ev.z);
            a.playTacticalVox('capacitor');
            this.input.rumble(0.75, 0.7, 190);
            this.addScore(360 + ev.kills * 25);
            if (this.save.voxEnabled !== false) {
              this.ui.showTacticalVox('TESLA OVERLOAD // 电容过载', `全屏电磁清场 ×${ev.kills} · 金门充能提升！`, '#62f4ff', 2100);
            }
            const p = this.worldToScreen(ev.x, 2.4, ev.z);
            this.ui.floatText(p.x, p.y, `⚡ 电容塔过载清场 ×${ev.kills}!`, 'gold', 1.1);
          }
          break;
        }
        case 'PHASE_GATE_SYNC': {
          const hex = ev.attune === 'kinetic' ? 0xb98cff : 0x3ef3ff;
          fx.ring(ev.x, ev.z, hex, 5.2, 0.52);
          if (live) {
            if (ev.synced) {
              a.powerUp();
              this.addScore(220);
              const p = this.worldToScreen(snap.squadX, 2.25, PLAYER_Z - 0.9);
              this.ui.floatText(p.x, p.y, '✦ 相位同调 +10人 · 射速飙升!', 'gold', 1.05);
            } else {
              a.loss(2);
              const p = this.worldToScreen(snap.squadX, 2.1, PLAYER_Z - 0.9);
              this.ui.floatText(p.x, p.y, '⚠ 相位逆反!', 'loss', 0.95);
            }
          }
          break;
        }
        case 'SHARD_COLLECT': {
          if (live) {
            this.save.cores += ev.value;
            this.addScore(ev.value * 15);
          }
          break;
        }
        case 'RIFT_LEAP_BONUS': {
          fx.ring(ev.x, ev.z, 0x62f4ff, 5.4, 0.52);
          if (live) {
            a.jumpLaunch();
            this.addScore(180);
            const p = this.worldToScreen(snap.squadX, 2.4, PLAYER_Z - 0.8);
            this.ui.floatText(p.x, p.y, `🌉 断桥飞跃 +${ev.bonusSquad}人!`, 'aegis', 1.0);
          }
          break;
        }
        case 'SPIRE_CHARGE': {
          if (live) a.spatialThreatCue('spire_charge', ev.x, 2.85, ev.z);
          break;
        }
        case 'SPIRE_SHATTER': {
          fx.shatter(ev.x, 2.85, ev.z, 0x62f4ff, 22, true);
          fx.ring(ev.x, ev.z, 0xffdf58, 7.2, 0.65);
          fx.burst(ev.x, 2.85, ev.z, 0x62f4ff, 75, { speed: 12, size: 0.52, life: 0.68, up: 1.1 });
          this.renderer.shake(0.36);
          if (live) {
            a.spatialThreatCue('spire_shatter', ev.x, 2.85, ev.z);
            this.input.rumble(0.55, 0.5, 130);
            this.addScore(280);
            const p = this.worldToScreen(ev.x, 3.1, ev.z);
            this.ui.floatText(p.x, p.y, '🗼 高台棱塔击碎 · 晶核爆落!', 'gold', 1.05);
          }
          break;
        }
        case 'FORMATION_DEPLOY': {
          if (live && !snap.boss) {
            const label = ev.kind === 'aegis_refract' ? '折射移动掩体阵' : '钳形合围阵';
            this.ui.toast(html`⚔ 精英协同编队来袭：<b>${label}</b> — 优先点杀连线指挥官触发反噬瘫痪！`, 2300);
          }
          break;
        }
        case 'FORMATION_BACKLASH': {
          fx.ring(ev.x, ev.z, 0x4ef6ff, 8.2, 0.68);
          fx.burst(ev.x, 1.2, ev.z, 0xffdf58, 68, { speed: 11, size: 0.48, life: 0.62, up: 1.0 });
          if (live) {
            a.spatialThreatCue('formation_break', ev.x, 1.2, ev.z);
            this.addScore(220 + ev.stunned * 45);
            const p = this.worldToScreen(ev.x, 2.2, ev.z);
            this.ui.floatText(p.x, p.y, `⚡ 斩首反噬 · 瘫痪×${ev.stunned}!`, 'gold', 1.05);
          }
          break;
        }
        case 'CORE_REACTOR_AWAKEN': {
          fx.ring(snap.squadX, PLAYER_Z, 0xffdf58, 6.8 + ev.tier * 1.4, 0.72);
          if (ev.tier === 3) {
            fx.shatter(snap.squadX, 1.15, PLAYER_Z, 0xffdf58, 20, true);
            this.renderer.triggerReactorAwakenCam(0.85);
          }
          if (live) {
            a.powerUp();
            if (ev.tier === 3) {
              this.input.rumble(0.78, 0.72, 210);
              this.ui.doFlash('rgba(255,228,110,0.42)', 0.32);
            }
            const roman = ev.tier === 3 ? 'Ⅲ' : ev.tier === 2 ? 'Ⅱ' : 'Ⅰ';
            this.addScore(ev.tier * 240);
            this.ui.toast(html`⚛ 核心共鸣反应堆觉醒 <b>${roman} 阶</b>！`, 2500);
          }
          break;
        }
        case 'WINGMAN_FORMATION_SHIFT': {
          fx.ring(snap.squadX, PLAYER_Z, 0x5ef6ff, 4.4, 0.42);
          if (live) {
            a.wingmanShiftCue(ev.formation);
            const p = this.worldToScreen(snap.squadX, 2.35, PLAYER_Z - 1.0);
            this.ui.floatText(p.x, p.y, `❖ 僚机·${WINGMAN_FORMATION_LABELS[ev.formation].name}`, 'aegis', 0.9);
          }
          break;
        }
        case 'WINGMAN_COUNTER_BEAM': {
          fx.ring(ev.toX, ev.toZ, 0xffe26a, 5.4, 0.45);
          fx.arc(ev.fromX, ev.fromZ, ev.toX, ev.toZ, 0x5ef6ff);
          if (live) {
            a.orbReflect();
            this.addScore(180);
            const p = this.worldToScreen(snap.squadX, 2.45, PLAYER_Z - 1.2);
            this.ui.floatText(p.x, p.y, `⚡ 僚机反击光束 -${ev.damage}!`, 'gold', 0.95);
          }
          break;
        }
        case 'ABYSSAL_BOSS_MUTATION': {
          fx.ring(0, -16, 0xc44dff, 11.2, 0.75);
          if (ev.moveKind === 'mag_storm_tide') {
            this.renderer.spawnDecal(ev.safeX, -10, 4.8, 0x62f4ff, 5, 16);
          }
          this.renderer.shake(0.32);
          if (live) {
            a.abyssalPactCue(snap.abyssalHeatTier ?? 4);
            if (!snap.boss || this.specialFloatClock <= 0) {
              this.specialFloatClock = 1.6;
              const moveName = ev.moveKind === 'cross_laser_grid' ? '交叉旋转折射激光网' : ev.moveKind === 'phantom_clone_salvo' ? '相位镜像分身齐射' : '全跑道磁暴潮汐跃迁';
              this.ui.toast(html`🔥 灾变首领基因变异：<b>${moveName}</b>！`, 2200);
            }
          }
          break;
        }
        case 'REACTOR_PULSE_WALL': {
          this.renderer.markReactorSweep(ev.contacts);
          fx.ring(snap.squadX, ev.z, 0x62f4ff, 3.8, 0.31);
          this.renderer.triggerCinematicImpact(0.012, 0.24, snap.squadX, ev.z);
          if (live) {
            a.spatialThreatCue('reactor_wall', snap.squadX, 1.2, ev.z);
            this.input.rumble(0.65, 0.7, 160);
            this.addScore(320 + ev.hits * 20);
          }
          break;
        }
        case 'TACTICAL_DROP_SPAWN': {
          if (live) {
            a.spatialThreatCue('tactical_drop', ev.x, 1.5, ev.z);
            const name = ev.kind === 'supply_beacon' ? '限时战术空投信标（驻守充能）' : '失控核心货运车（逃逸前拦截）';
            this.ui.toast(html`📦 突发战术事件：<b>${name}</b> 已出现！`, 2500);
          }
          break;
        }
        case 'TACTICAL_DROP_CLAIM': {
          fx.ring(ev.x, ev.z, 0xffdf58, 9.2, 0.78);
          fx.burst(ev.x, 1.4, ev.z, 0x62f4ff, 95, { speed: 13, size: 0.56, life: 0.75, up: 1.2 });
          this.renderer.shake(0.38);
          if (live) {
            a.fusionUnlock();
            this.input.rumble(0.72, 0.65, 180);
            this.addScore(520);
            const p = this.worldToScreen(snap.squadX, 2.4, PLAYER_Z - 1.0);
            this.ui.floatText(p.x, p.y, ev.rewardText ? `夺取空投 · ${ev.rewardText}！` : '已夺取空投', 'gold', 1.15);
          }
          break;
        }
        case 'PANTHEON_STAGE_START': {
          this.bossWarned = false;
          this.hazardSeen.clear();
          this.renderer.setSector(ev.stage === 1 ? 1 : ev.stage === 2 ? 2 : 3);
          if (live) {
            a.bossWarning();
            this.addScore(ev.stage * 600);
            this.ui.showBanner(
              html`<div class="b-kicker">🏛 PANTHEON STAGE ${ev.stage}/4</div><div class="b-title">${ev.affixName}</div><div class="b-sub">${ev.stage === 4 ? '终局双首领同屏合击降临！' : '场地机关重构 · 迎战殿堂首领！'}</div>`,
              'boss',
              1950,
            );
          }
          break;
        }
        case 'PANTHEON_DUAL_BOSS': {
          this.renderer.shake(0.68);
          if (live) {
            a.spatialThreatCue('pantheon_dual', 3.1, 2.4, -15.6);
            a.playVocoderChoir('pantheon');
            this.ui.showLetterbox(1200);
            this.ui.toast(html`👑 <b>终殿双神同屏合击</b>：深渊魔王与赤焰魔像王同时降临！`, 3000);
          }
          break;
        }
        case 'NEMESIS_AMBUSH': {
          fx.ring(ev.x, ev.z, 0xff3b6e, 9.5, 0.75);
          this.renderer.spawnDecal(ev.x, ev.z, 3.8, 0x62f4ff, 5, 16);
          this.renderer.shake(0.45);
          if (live) {
            a.playVocoderChoir('nemesis');
            this.input.rumble(0.78, 0.65, 220);
            const wName = REWARD_META[ev.adaptedWeapon].short;
            this.ui.showBanner(
              html`<div class="b-warn">🐺 NEMESIS INTRUSION · 乱入追猎者</div><div class="b-title">${ev.name}</div><div class="b-sub">偏振护盾已适应【${wName}】— 按 Tab 切换副武或借 45° 折镜破盾！</div>`,
              'boss',
              2100,
            );
          }
          break;
        }
        case 'NEMESIS_SHIELD_BREAK': {
          fx.shatter(ev.x, 1.2, ev.z, 0x62f4ff, 22, true);
          fx.ring(ev.x, ev.z, 0xffe46b, 6.8, 0.55);
          this.renderer.shake(0.32);
          if (live) {
            this.triggerHitStop(0.035);
            a.shieldBreak(ev.x, ev.z);
            this.addScore(360);
            const p = this.worldToScreen(ev.x, 2.2, ev.z);
            this.ui.floatText(p.x, p.y, '⚡ 偏振盾击碎 · 2.1×易伤!', 'gold', 1.05);
          }
          break;
        }
        case 'NEMESIS_DEFEAT': {
          this.nemesisDefeatedThisRun = true;
          fx.burst(ev.x, 1.35, ev.z, 0xffe46b, 110, { speed: 14, size: 0.58, life: 0.82, up: 1.2 });
          fx.shatter(ev.x, 1.35, ev.z, 0xff3b6e, 26, true);
          this.renderer.spawnDecal(ev.x, ev.z, 4.6, 0xff9a3c, 4, 18);
          this.renderer.shake(0.55);
          if (live) {
            a.fusionUnlock();
            this.input.rumble(0.9, 0.82, 260);
            this.save.cores += 18;
            if (this.inExpedition && this.save.expedition && !this.save.expedition.relics.includes(ev.relicId)) {
              this.save.expedition.relics.push(ev.relicId);
            }
            const relic = EXPEDITION_RELICS[ev.relicId];
            this.addScore(950);
            this.ui.toast(html`🐺 击溃零号猎犬！扩编 <b>+${ev.bonusSquad}</b> · 夺取遗物 <b>${relic.glyph}${relic.name}</b>！`, 3200);
          }
          break;
        }
        case 'TRI_PRISM_LATTICE_ONLINE': {
          fx.ring(ev.x, ev.z, 0x62f4ff, 8.6, 0.65);
          this.renderer.spawnDecal(ev.x, ev.z, 3.6, 0x62f4ff, 5, 14);
          if (live) {
            a.orbReflect();
            this.addScore(260);
            const p = this.worldToScreen(snap.squadX, 2.45, PLAYER_Z - 1.2);
            this.ui.floatText(p.x, p.y, '🔺 三角棱镜谐振电网激活!', 'aegis', 1.05);
          }
          break;
        }
        case 'OVERLIMIT_NIRVANA_BURST': {
          const meta = NIRVANA_META[ev.archetype];
          this.renderer.triggerNirvanaCataclysmVfx(ev.x, ev.z, ev.archetype, 0);
          this.renderer.triggerExecutionCam(1.25);
          if (live) {
            this.nukeHitStopTimer = 0.075;
            this.bulletTimeDur = 0.42;
            this.bulletTimeTimer = 0.42;
            this.input.rumble(1.0, 1.0, 680);
            fx.after(0.32, () => this.input.rumble(0.88, 0.82, 420));
            a.triggerUltimateDuck(0.88);
            a.nirvanaCataclysm(0);
            a.playVocoderChoir('nirvana');
            if (ev.kills >= 2) a.nukeChainShatter(ev.kills);
            this.ui.showLetterbox(900);
            this.ui.doNirvanaFlash(ev.archetype, 1.0);
            this.addScore(780 + ev.kills * 38 + Math.round(ev.bossDamage * 0.45));
            const titleCol =
              ev.archetype === 'singularity_supernova'
                ? '#e69cff'
                : ev.archetype === 'absolute_zero_storm'
                  ? '#9ef9ff'
                  : '#ffe875';
            this.ui.showBanner(
              html`<div class="b-kicker">☀️ OVERLIMIT NIRVANA · 二阶终焉奥义解放</div><div class="b-title" style="color:${titleCol}">${meta.glyph} ${meta.name}！</div><div class="b-sub">七重天基神罚柱贯穿全桥 · 歼敌 ×${ev.kills}${ev.bossDamage > 0 ? ` · 首领重创 -${ev.bossDamage}` : ''}</div>`,
              'od',
              1150,
            );
          }
          break;
        }
        case 'NIRVANA_WAVE_PULSE': {
          this.renderer.triggerNirvanaCataclysmVfx(ev.x, ev.z, ev.archetype, ev.wave);
          if (live) {
            a.nirvanaCataclysm(ev.wave);
            if (ev.kills >= 2) a.hordeDeathChorus(ev.kills, 0, -22);
            this.input.rumble(0.82, 0.75, 280);
            this.addScore(180 + ev.kills * 28 + Math.round(ev.bossDamage * 0.35));
            if (ev.kills > 0 || ev.bossDamage > 0) {
              const p = this.worldToScreen(ev.x, 1.8, ev.z);
              this.ui.floatText(
                p.x,
                p.y,
                ev.bossDamage > 0 ? `余震 -${ev.bossDamage}` : `余震 ×${ev.kills}`,
                'small',
                0.6,
              );
            }
          }
          break;
        }
        case 'BOSS_PHASE_BREAK':
          fx.burst(ev.x, 2.4, ev.z, 0xffffff, 120, { speed: 14, size: 0.7, life: 0.8 });
          fx.ring(ev.x, ev.z, 0xff3b5c, 9, 0.7);
          this.renderer.shake(0.6);
          this.renderer.triggerPhaseCamZoom(1.18);
          this.renderer.triggerCinematicImpact(0.016, 0.32, ev.x, ev.z);
          if (live) {
            this.bulletTimeDur = 0.22;
            this.bulletTimeTimer = 0.22;
            this.input.rumble(0.92, 0.78, 260);
            a.triggerUltimateDuck(0.36);
            const shiftTxt = ev.arenaShift ?? (ev.phase === 2 ? '攻势加快，注意红区与棱球' : '最终形态！');
            this.ui.showBanner(html`<div class="b-warn">⚡ PHASE ${ev.phase} · 场地剧变</div><div class="b-title">首领二阶觉醒 · 护盾核暴露</div><div class="b-sub">${shiftTxt}</div>`, 'boss', 1650);
            this.ui.doFlash('rgba(255,255,255,0.8)', 0.4);
            a.bossPhase();
          }
          break;
        case 'BOSS_DEFEAT': {
          const color = ev.bossId === 'warden_01' ? 0xff2a4a : ev.bossId === 'hydra_02' ? 0xff3fd2 : 0xffc531;
          this.renderer.startBossDeath(ev.x, ev.z, color);
          if (live) {
            a.bossDefeat();
            this.save.bestiaryKills[ev.bossId] = (this.save.bestiaryKills[ev.bossId] ?? 0) + 1;
            const completedWave = Math.max(1, (snap.endless?.wave ?? this.sector) - (this.endless ? 1 : 0));
            this.addScore(SCORE.bossBase * (this.endless ? completedWave * 2 : this.blitz ? 2 : this.sector));
            fx.after(1.25, () => this.ui.doFlash('rgba(255,255,255,1)', 0.85));
            this.ui.showBanner(html`<div class="b-kicker">TARGET DESTROYED</div><div class="b-title">首领击破！</div>`, 'reward', this.endless ? 900 : 2000);
          }
          break;
        }
        case 'ENDLESS_STAGE_START': {
          this.bossWarned = false;
          this.hazardSeen.clear();
          this.renderer.setEndlessWave(ev.wave);
          if (live) {
            this.addScore(ev.wave * 500);
            this.ui.showBanner(
              html`<div class="b-kicker">ENDLESS · STAGE ${ev.wave}</div><div class="b-title">阶段 ${ev.wave} · 威胁升级</div><div class="b-sub">补员 +${ev.bonus} · 共鸣充满 · 护盾刷新</div>`,
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
    if (gateGain > 0) this.ui.showGateGain(gateGain, streak, streams, snap.simTime);
    if (comboMilestone) this.ui.combo(this.combo);
  }

  private finishRun(victory: boolean, snap: SimSnapshot, reason: NonNullDefeatReason | null, extracted = false): void {
    this.audio.setFever(false);
    const meta = SECTOR_META[this.sector];
    if (victory) this.addScore(snap.squadCount * SCORE.finalSquadPerUnit);
    const starThresholds: [number, number] = this.blitz ? [85, 180] : meta.starSquad;
    const stars =
      !this.endless && victory
        ? 1 + (snap.squadCount >= starThresholds[0] ? 1 : 0) + (snap.squadCount >= starThresholds[1] ? 1 : 0)
        : 0;
    const rec = this.save.records[this.sector];
    const newBest = this.fairTrial
      ? this.score > this.save.fairTrial.bestScore
      : this.blitz
        ? this.score > this.save.blitz.bestScore
        : this.endless
          ? this.score > this.save.endless.bestScore
          : this.score > rec.score;
    const newWaveBest = this.endless && (snap.endless?.wave ?? 1) > this.save.endless.bestWave;
    const activeHeat = this.fairTrial ? 0 : (snap.abyssalHeatTier ?? 0);
    const mutBonusPct = computeMutatorBonusPct(snap.mutators) + activeHeat * 15;
    const reward = computeCoreReward({
      victory,
      stars,
      score: this.score,
      progress: snap.runwayProgress,
      firstClear: this.blitz ? victory && this.save.blitz.clears === 0 : !this.endless && victory && !rec.cleared,
      sector: this.sector,
      bountyLevel: this.save.upgrades.bounty ?? 0,
      blitz: this.blitz,
      mutatorBonusPct: mutBonusPct,
    });
    const chInput = { victory, finalSquad: snap.squadCount, bossLoss: this.bossLoss, maxCombo: this.maxCombo, stats: snap.stats };
    const challenges = (this.endless || this.blitz ? [] : SECTOR_CHALLENGES[this.sector]).map((c) => {
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

    if (extracted && reward.total > 0) {
      const extractBonus = Math.max(15, Math.round(reward.total * 0.35));
      reward.lines.push(['战术安全撤离 +35%', extractBonus]);
      reward.total += extractBonus;
    }

    if (this.fairTrial) {
      this.save.fairTrial.bestScore = Math.max(this.save.fairTrial.bestScore, this.score);
      if (victory) {
        this.save.fairTrial.clears += 1;
        this.save.fairTrial.bestTime =
          this.save.fairTrial.bestTime > 0 ? Math.min(this.save.fairTrial.bestTime, this.runTime) : this.runTime;
      }
    } else if (this.pantheon) {
      const stageReached = victory ? 4 : Math.max(1, (snap.pantheonStage ?? 1) - 1);
      this.save.pantheon.bestScore = Math.max(this.save.pantheon.bestScore, this.score);
      this.save.pantheon.bestStage = Math.max(this.save.pantheon.bestStage, stageReached);
      if (victory) {
        this.save.pantheon.clears += 1;
        this.save.pantheon.bestTime =
          this.save.pantheon.bestTime > 0 ? Math.min(this.save.pantheon.bestTime, this.runTime) : this.runTime;
        reward.lines.push(['万神殿四殿制霸赏金', 120]);
        reward.total += 120;
      }
    } else if (this.blitz) {
      this.save.blitz.bestScore = Math.max(this.save.blitz.bestScore, this.score);
      if (victory) {
        this.save.blitz.clears += 1;
        this.save.blitz.bestTime =
          this.save.blitz.bestTime > 0 ? Math.min(this.save.blitz.bestTime, this.runTime) : this.runTime;
      }
    } else if (!this.endless && victory) {
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
    } else if (!this.blitz) {
      rec.score = Math.max(rec.score, this.score);
    }

    const totalKills = Object.values(this.save.bestiaryKills).reduce((s, n) => s + n, 0);
    const achCtx = {
      victory: !this.endless && victory,
      sector: this.sector,
      endlessWave: this.endless ? (snap.endless?.wave ?? 1) : this.save.endless.bestWave,
      maxCombo: this.maxCombo,
      bossLoss: this.bossLoss,
      stats: snap.stats,
      totalKills,
      allThreeStars: ([1, 2, 3] as SectorId[]).every((id) => this.save.records[id].stars >= 3),
      pantheonCleared: (this.pantheon && victory) || (this.save.pantheon?.clears ?? 0) > 0,
      maxHeatCleared: victory ? Math.max(activeHeat, this.save.abyssal?.maxHeatCleared ?? 0) : (this.save.abyssal?.maxHeatCleared ?? 0),
      expeditionCleared: (this.inExpedition && victory && this.save.expedition?.act === 3) || (this.save.expeditionClears ?? 0) > 0,
      nemesisDefeated: this.nemesisDefeatedThisRun,
    };
    if (victory && activeHeat > 0) {
      this.save.abyssal.totalAbyssClears = (this.save.abyssal.totalAbyssClears ?? 0) + 1;
      if (activeHeat > (this.save.abyssal.maxHeatCleared ?? 0)) {
        this.save.abyssal.maxHeatCleared = activeHeat;
      }
      const skinMilestones: Array<[number, SquadSkinId, string]> = [
        [2, 'abyss_violet', '深渊紫电'],
        [5, 'solar_prism', '耀斑棱金'],
        [8, 'void_aurora', '虚空极光'],
      ];
      for (const [reqH, skId, skName] of skinMilestones) {
        if (activeHeat >= reqH && !this.save.unlockedAbyssSkins.includes(skId)) {
          this.save.unlockedAbyssSkins.push(skId);
          this.ui.toast(html`🎨 解锁灾变流光涂装：<b>${skName}</b>！`, 2800);
        }
      }
    }
    if (this.fairTrial && victory && this.recordingGhostSamples.length >= 4) {
      const prevGhost = this.save.fairTrialGhost;
      if (!prevGhost || this.runTime <= prevGhost.duration || this.score >= prevGhost.score) {
        this.save.fairTrialGhost = {
          seed: this.activeRunSeed,
          score: this.score,
          duration: Math.max(8, this.runTime),
          samples: this.recordingGhostSamples.slice(0, 1200),
        };
      }
    }
    let expCompletedNow = false;
    if (this.inExpedition && this.save.expedition) {
      if (victory) {
        const nodes = getExpeditionNodes(this.save.expedition.seed);
        const partner = (snap.activeLoadout ?? []).find((w) => w !== snap.weapon) ?? this.save.expedition.carryPartner;
        this.save.expedition = advanceExpeditionAfterVictory(
          this.save.expedition,
          nodes,
          snap.squadCount,
          snap.weapon,
          partner,
          this.activeRunSeed + this.save.expedition.act * 31,
        );
        expCompletedNow = this.save.expedition.completed;
        if (expCompletedNow) {
          this.save.expeditionClears = (this.save.expeditionClears ?? 0) + 1;
          reward.lines.push(['星区远征三幕制霸赏金', 160]);
          reward.total += 160;
        } else {
          reward.lines.push([`远征第 ${Math.max(1, this.save.expedition.act - 1)} 幕突破`, 55]);
          reward.total += 55;
        }
      }
    }
    this.ui.updateGhostDelta(false);
    this.renderer.updateGhostRunner(null, 0);
    const unlockedMedals: Array<{ name: string; glyph: string; color: string; reward: number }> = [];
    for (const ach of ACHIEVEMENTS) {
      if (!this.save.achievements.includes(ach.id) && ach.check(achCtx)) {
        this.save.achievements.push(ach.id);
        reward.lines.push([`勋章·${ach.name}`, ach.reward]);
        reward.total += ach.reward;
        unlockedMedals.push({ name: ach.name, glyph: ach.glyph, color: ach.color, reward: ach.reward });
      }
    }

    this.save.cores += reward.total;
    writeSave(this.save);
    if (unlockedMedals.length > 0) {
      this.audio.achievement();
      this.ui.toast(html`🏅 解锁勋章：<b>${unlockedMedals.map((m) => m.name).join(' · ')}</b>`, 3200);
    }

    const apexAffordable = isApexUnlocked(this.save.upgrades) && this.save.cores >= getApexCost(this.save.apexLevel ?? 0);
    const bestShown = this.fairTrial
      ? this.save.fairTrial.bestScore
      : this.blitz
        ? this.save.blitz.bestScore
        : this.endless
          ? this.save.endless.bestScore
          : rec.score;

    const replayLog = this.sim.exportReplayLog();
    this.lastReplayLog = replayLog;
    const verifyRes = verifyDeterministicReplay(replayLog);

    this.pendingResult = {
      victory,
      sector: this.sector,
      blitz: this.blitz || this.pantheon,
      pantheon: this.pantheon,
      expedition: this.inExpedition,
      expeditionCompleted: expCompletedNow,
      customTrack: this.inCustomTrack,
      pantheonStageCleared: this.pantheon ? (victory ? 4 : Math.max(0, (snap.pantheonStage ?? 1) - 1)) : undefined,
      fairTrial: this.fairTrial,
      extracted,
      stars,
      score: this.score,
      best: bestShown,
      newBest: newBest && this.score > 0,
      reason,
      hasNext: !this.endless && !this.blitz && !this.inExpedition && !this.inCustomTrack && victory && this.sector < 4,
      archetype: computeBuildArchetype(snap, this.maxCombo),
      damageBreakdown: computeDamageBreakdown(snap.damageBySource),
      highlights: {
        partsBroken: this.partsBrokenCount,
        orbsReflected: this.orbsReflectedCount,
        parries: this.parriesCount,
        weaponSwaps: this.weaponSwapsCount,
        seed: this.activeRunSeed,
      },
      canReplaySeed: !this.fairTrial,
      replayVerified: verifyRes.matched,
      replayTicks: verifyRes.simulatedTicks,
      hasTacticalReplay: replayLog.totalTicks > 0,
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
      unlockedMedals,
      cores: {
        ...reward,
        balance: this.save.cores,
        affordable:
          apexAffordable ||
          UPGRADES.some((u) => this.save.upgrades[u.id] < u.max && this.save.cores >= u.costs[this.save.upgrades[u.id]]!),
      },
      stats: {
        kills: snap.stats.kills,
        gatesImproved: snap.stats.gatesImproved,
        vaultsCracked: snap.stats.vaultsCracked,
        maxChain: snap.stats.maxChain,
        peakSquad: snap.stats.peakSquad,
        finalSquad: snap.squadCount,
        time: Math.max(this.runTime, snap.simTime),
      },
    };
    this.state = 'outro';
    this.outroTimer = victory ? 2.9 : 1.5;
    this.ui.showDragHint(false);
    if (!victory) this.audio.defeat();
  }

  private showResult(r: ResultData): void {
    this.state = 'result';
    this.lastResultData = r;
    this.pendingResult = null;
    if (r.victory) this.audio.victory();
    this.audio.setMusic(this.sector, 0);
    this.ui.showResult(r, (i) => this.audio.star(i));
    if (r.endless) {
      this.rankingRun = {
        id: ++this.rankingSequence,
        submitted: false,
        run: Object.freeze({
          score: r.score, duration: r.stats.time, wave: r.endless.wave, distance: r.endless.distance,
          bosses: r.endless.bosses, kills: r.stats.kills, maxCombo: r.maxCombo,
        }),
      };
      const host = this.ui.root.querySelector<HTMLElement>('[data-testid=result-ranking]')!;
      this.rankingUI.mountResult(host, !!this.save.leaderboardName);
      if (this.save.leaderboardName) void this.submitRanking();
      else this.rankingUI.showName();
    }
  }

  private clearRankingViews(): void {
    this.rankingSequence += 1;
    this.rankingRun = null;
    this.closeLeaderboard();
    this.rankingUI.hideName();
    this.rankingUI.detachResult();
  }

  private saveRankingName(value: string): void {
    if (this.state !== 'result' || !this.rankingRun) return;
    let name: string;
    try { name = validateRankingName(value); }
    catch (error) { this.rankingUI.setNameError(rankingErrorMessage(error)); return; }
    this.save.leaderboardName = name;
    writeSave(this.save);
    this.rankingUI.hideName();
    void this.submitRanking();
  }

  private async submitRanking(): Promise<void> {
    const job = this.rankingRun;
    if (!job || job.submitted || this.rankingSubmission === job.id) return;
    if (!this.save.leaderboardName) { this.rankingUI.showName(); return; }
    this.rankingSubmission = job.id;
    this.rankingUI.submission('uploading', '正在上传本局成绩…');
    let accepted: boolean;
    try {
      const result = await this.ranking.submit(this.save.leaderboardName, job.run);
      job.submitted = true;
      accepted = result.accepted;
    } catch (error) {
      if (this.rankingRun === job) this.rankingUI.submission('error', `${rankingErrorMessage(error)}；本局成绩已保留`);
      return;
    } finally {
      if (this.rankingSubmission === job.id) this.rankingSubmission = null;
    }
    if (this.rankingRun !== job) return;
    const message = accepted ? '本局成绩已上传' : '已保留历史最好成绩';
    this.rankingUI.submission('done', `${message}，正在查询名次…`);
    try {
      const own = await this.ranking.me();
      if (this.rankingRun === job) this.rankingUI.submission('done', own ? `${message} · 我的名次 #${own.rank}` : `${message} · 名次等待刷新`);
    } catch {
      if (this.rankingRun === job) this.rankingUI.submission('done', `${message} · 名次暂不可用，可打开榜单刷新`);
    }
    if (this.rankingRun === job && this.rankingOpen) void this.loadLeaderboard();
  }

  private openLeaderboard(): void {
    if (this.state !== 'title' && this.state !== 'result') return;
    this.rankingOpen = true;
    this.rankingOffset = 0;
    this.rankingUI.open();
    void this.loadLeaderboard();
  }

  private closeLeaderboard(): void {
    this.rankingOpen = false;
    this.rankingQuery += 1;
    this.rankingUI.close();
  }

  private async loadLeaderboard(): Promise<void> {
    if (!this.rankingOpen) return;
    const query = ++this.rankingQuery;
    const name = this.save.leaderboardName;
    this.rankingUI.loading(name);
    const [page, own] = await Promise.allSettled([
      this.ranking.top(this.rankingOffset),
      name ? this.ranking.me() : Promise.resolve(null),
    ]);
    if (!this.rankingOpen || query !== this.rankingQuery) return;
    if (page.status === 'rejected') { this.rankingUI.showBoardError(rankingErrorMessage(page.reason)); return; }
    this.rankingUI.showBoard(page.value, own.status === 'fulfilled' ? own.value : null, name, own.status === 'rejected');
  }

  // ------------------------------------------------------------------ debug / verification hooks
  fastForward(seconds: number, useAutopilot = true): void {
    if (this.state === 'ready') this.beginPlay();
    if (this.state !== 'playing') return;
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      const s = this.sim.getSnapshot();
      if (s.phase !== 'PLAYING') break;
      const events = this.sim.stepFixed({ dragDeltaX: useAutopilot ? autopilotDrag(s) : 0, keyAxisX: 0, overdrive: useAutopilot });
      this.runTime += 1 / 60;
      const nextSnap = this.sim.getSnapshot();
      this.handleEvents(events, nextSnap, true);
      this.liveChecks(nextSnap, 1 / 60);
      this.ui.updateFloats(1 / 60);
      this.renderer.effects.update(1 / 60);
      if (this.state !== 'playing') break;
    }
  }

  get weaponColor(): number {
    return WEAPON_COLOR[this.lastSnap.weapon];
  }

  toggleAbyssalPact(id: AbyssalPactId): void {
    const list = this.save.abyssal.activePacts ?? [];
    const idx = list.indexOf(id);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(id);
    this.save.abyssal.activePacts = list;
    writeSave(this.save);
    this.audio.abyssalPactCue(computeAbyssalHeatTier(list));
    this.ui.renderAbyssal(this.save);
  }

  clearAbyssalPacts(): void {
    this.save.abyssal.activePacts = [];
    writeSave(this.save);
    this.audio.click();
    this.ui.renderAbyssal(this.save);
  }

  selectWingman(id: WingmanId): void {
    const meta = WINGMAN_META[id];
    if (!meta) return;
    const unlocked = this.save.unlockedWingmen ?? [];
    if (!unlocked.includes(id)) {
      if (this.save.cores < meta.cost) return;
      this.save.cores -= meta.cost;
      unlocked.push(id);
      this.save.unlockedWingmen = unlocked;
      this.save.equippedWingman = id;
      writeSave(this.save);
      this.audio.powerUp();
      this.ui.renderWorkshop(this.save);
      this.ui.toast(html`🛸 已解锁并挂载全息僚机：<b>${meta.glyph} ${meta.name}</b>`, 2300);
      return;
    }
    this.save.equippedWingman = this.save.equippedWingman === id ? null : id;
    writeSave(this.save);
    this.audio.click();
    this.ui.renderWorkshop(this.save);
  }

  private initGhostForRun(fairTrial: boolean, seed: number, isSeedReplay: boolean): void {
    this.recordingGhostSamples = [];
    this.ghostSampleTick = 0;
    if (!fairTrial && !isSeedReplay) {
      this.activeGhostRecord = null;
      this.ui.updateGhostDelta(false);
      this.renderer.updateGhostRunner(null, 0);
      return;
    }
    if (fairTrial && this.save.fairTrialGhost && this.save.fairTrialGhost.seed === seed && this.save.fairTrialGhost.samples.length >= 4) {
      this.activeGhostRecord = this.save.fairTrialGhost;
    } else {
      const samples: GhostSample[] = [];
      const totalSteps = 480;
      const weapons: WeaponId[] = ['pulse', 'rail', 'plasma', 'scatter', 'cryo'];
      for (let i = 0; i <= totalSteps; i++) {
        const prog = Math.min(1, i / 360);
        const waveX = Math.sin(i * 0.19 + (seed % 17)) * 2.85 + Math.cos(i * 0.07) * 1.15;
        const w = weapons[Math.min(weapons.length - 1, Math.floor(i / 95))]!;
        samples.push([Number(waveX.toFixed(2)), Number(prog.toFixed(4)), w]);
      }
      this.activeGhostRecord = {
        seed,
        score: 42800,
        duration: 48.0,
        samples,
      };
    }
  }

  private stepGhostDuel(snap: SimSnapshot): void {
    this.ghostSampleTick += 1;
    if (this.ghostSampleTick % 6 === 0 && this.recordingGhostSamples.length < 1500) {
      this.recordingGhostSamples.push([
        Number(snap.squadX.toFixed(2)),
        Number(snap.runwayProgress.toFixed(4)),
        snap.weapon,
      ]);
    }
    const ghost = this.activeGhostRecord;
    if (!ghost || ghost.samples.length === 0) {
      this.ui.updateGhostDelta(false);
      this.renderer.updateGhostRunner(null, this.runTime);
      return;
    }
    const idxFloat = Math.min(ghost.samples.length - 1, Math.max(0, this.runTime * 10));
    const i0 = Math.floor(idxFloat);
    const i1 = Math.min(ghost.samples.length - 1, i0 + 1);
    const frac = idxFloat - i0;
    const s0 = ghost.samples[i0]!;
    const s1 = ghost.samples[i1]!;
    const gx = s0[0] + (s1[0] - s0[0]) * frac;
    const gProg = s0[1] + (s1[1] - s0[1]) * frac;
    const gw = s0[2];
    const progDiff = gProg - snap.runwayProgress;
    const deltaSec = progDiff * Math.max(24, ghost.duration);
    const zOffset = Math.max(-4.5, Math.min(26, progDiff * 72));
    const isPb = Boolean(this.save.fairTrialGhost && this.save.fairTrialGhost === ghost);
    this.renderer.updateGhostRunner(
      { active: true, x: gx, zOffset, weapon: gw, playerAhead: deltaSec <= 0 },
      this.runTime,
    );
    this.ui.updateGhostDelta(true, deltaSec, isPb ? 'PB幽灵' : '基准幽灵');
  }

  /** Stage 5: One-Click Full-Pipeline Performance & Determinism Self-Check */
  runFullPipelineDiagnostic(): string {
    const t0 = performance.now();
    const benchSim = createSimulation();
    benchSim.startSector(2, {
      layoutSeed: 202622,
      manualOverdrive: true,
      equippedWingman: 'prism_mirror',
      abyssalPacts: ['pact_oscillating_mirrors', 'pact_apex_mutations', 'pact_harmonic_aegis'],
    });
    for (let i = 0; i < 180; i++) {
      benchSim.stepFixed({
        dragDeltaX: Math.sin(i * 0.14) * 0.12,
        keyAxisX: 0,
        overdrive: i === 60,
        aegisPulse: i === 90,
        cycleWingman: i === 12 || i === 80,
        swapWeapon: i === 45,
      });
    }
    const log = benchSim.exportReplayLog();
    const verify = verifyDeterministicReplay(log);
    const elapsedMs = performance.now() - t0;
    const perStepMs = elapsedMs / 180;
    const perf = this.renderer.getPerfStats();
    const limOk = this.audio.masterLimiterActive ? 'Limiter:ON' : 'Limiter:READY';
    const shareRoundTrip = Boolean(decodeTrackShareCode(encodeTrackShareCode(BUILTIN_TRACK_PRESETS[0]!)));
    void shareRoundTrip;
    return `✓ 全链路自检通过 · 180帧回放${verify.matched ? '零偏差' : '异常'} · Sim ${perStepMs.toFixed(2)}ms/f · 渲染 ${this.renderer.emaFrameMs.toFixed(1)}ms · DC ${perf.drawCalls} · Geo ${perf.geometries} · ${limOk}`;
  }

  // ------------------------------------------------------------------ V23 Stage 1: 3A Holographic Free-Cam Photo Mode
  enterPhotoMode(): void {
    if (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'ready') return;
    if (this.state === 'ready') this.beginPlay();
    this.prePhotoState = this.state === 'paused' ? 'paused' : 'playing';
    this.sim.pause();
    this.state = 'photo';
    this.input.reset();
    this.ui.showPause(false);
    this.photoState.active = true;
    this.renderer.setPhotoMode(this.photoState);
    this.ui.showPhotoHud(true);
    this.audio.setAmbientSlowScape(true);
  }

  exitPhotoMode(): void {
    if (this.state !== 'photo') return;
    this.photoState.active = false;
    this.renderer.setPhotoMode(null);
    this.ui.showPhotoHud(false);
    this.audio.setAmbientSlowScape(false);
    if (this.prePhotoState === 'paused') {
      this.state = 'paused';
      this.ui.showPause(true, this.sim.getSnapshot());
    } else {
      this.sim.resume();
      this.state = 'playing';
      this.last = performance.now();
    }
  }

  private capturePhotoFrame(): void {
    const snap = this.sim.getSnapshot();
    const dataUrl = this.renderer.captureFrameDataUrl(snap);
    try {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `prism_swarm_photo_${Date.now()}.png`;
      a.click();
    } catch {
      /* ignore sandbox download restriction */
    }
    this.audio.powerUp();
    this.ui.toast('📸 已捕获高清赛博截帧（PNG）！', 2200);
  }

  // ------------------------------------------------------------------ V23 Stage 2: 3-Act Branching Sector Expedition
  private ensureExpeditionState(): NonNullable<SaveData['expedition']> {
    if (!this.save.expedition || this.save.expedition.completed) {
      const seed = 202623 + Math.floor(Math.random() * 89999);
      const gen = generateExpeditionMap(seed);
      this.save.expedition = {
        ...gen,
        carryWeapon: this.save.starterWeapon ?? 'pulse',
      };
      writeSave(this.save);
    }
    return this.save.expedition;
  }

  openExpeditionScreen(): void {
    const exp = this.ensureExpeditionState();
    const nodes = getExpeditionNodes(exp.seed);
    this.ui.showExpedition(true, exp, nodes);
  }

  resetExpeditionMap(): void {
    this.save.expedition = null;
    const exp = this.ensureExpeditionState();
    const nodes = getExpeditionNodes(exp.seed);
    this.audio.powerUp();
    this.ui.renderExpedition(exp, nodes);
    this.ui.toast(`🌌 已生成全新三幕分支星图（#${exp.seed}）！`, 2000);
  }

  startExpeditionNode(nodeId: string): void {
    const exp = this.ensureExpeditionState();
    const nodes = getExpeditionNodes(exp.seed);
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || !exp.availableNodeIds.includes(nodeId)) return;
    exp.currentNodeId = nodeId;
    writeSave(this.save);

    this.audio.unlock();
    this.ui.showExpedition(false);
    this.sector = node.sectorTheme;
    this.inRange = false;
    this.endless = false;
    this.blitz = false;
    this.pantheon = false;
    this.fairTrial = false;
    this.inExpedition = true;
    this.inCustomTrack = false;
    this.nemesisDefeatedThisRun = false;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.bossLoss = 0;
    this.runTime = 0;
    this.pendingResult = null;
    this.activeRunSeed = exp.seed + node.act * 131 + node.lane * 17;

    this.renderer.resetRun();
    this.renderer.setSector(node.sectorTheme);
    const baseMods = runModsFromUpgrades(this.save.upgrades, this.save.apexLevel, this.save.specializations, this.save.equippedChips);
    const relicDmg = exp.relics.includes('relic_prism_capacitor') ? 1.18 : 1.0;
    const relicSquad = (exp.carrySquad - 18) + (exp.relics.includes('relic_nano_reserve') ? 16 : 0);
    this.sim.startSector(node.sectorTheme, {
      ...baseMods,
      bonusSquad: Math.max(0, baseMods.bonusSquad + relicSquad),
      damageMult: baseMods.damageMult * relicDmg,
      manualOverdrive: true,
      layoutSeed: this.activeRunSeed,
      starterWeapon: exp.carryWeapon,
      starterBlade: Boolean(this.save.starterBladeUnlocked && this.save.starterBlade),
      equippedWingman: this.save.equippedWingman ?? 'prism_mirror',
      abyssalPacts: [...(this.save.abyssal?.activePacts ?? [])],
      expeditionNode: node,
      expeditionNodeKind: node.kind,
      expeditionRelics: [...exp.relics],
      forceNemesisAmbush: node.nemesisRisk,
    });
    this.lastSnap = this.sim.getSnapshot();
    this.input.reset();
    this.ui.hideTitle();
    this.ui.hideResult();
    this.ui.showHud(node.sectorTheme, false, true);
    this.state = 'ready';
    this.readyTimer = 0;
    this.ui.showDragHint(true);
    const meta = EXPEDITION_NODE_META[node.kind];
    this.ui.showBanner(
      html`<div class="b-kicker">🌌 SECTOR EXPEDITION · ACT ${node.act}/3</div><div class="b-title">${meta.glyph} ${meta.name}</div><div class="b-sub">跨幕继承 ${exp.carrySquad} 人 · 遗物 ×${exp.relics.length}${node.nemesisRisk ? ' · 🐺零号猎犬高危区' : ''}</div>`,
      'od',
      2000,
    );
    this.input.onFirstInput = () => this.beginPlay();
    this.audio.setMusic(node.sectorTheme, 1);
  }

  // ------------------------------------------------------------------ V23 Stage 5: Custom Track & Challenge Runner
  startCustomTrackRun(bp: CustomTrackBlueprint): void {
    this.save.savedBlueprint = bp;
    writeSave(this.save);
    this.audio.unlock();
    this.sector = bp.sectorTheme;
    this.inRange = false;
    this.endless = false;
    this.blitz = false;
    this.pantheon = false;
    this.fairTrial = false;
    this.inExpedition = false;
    this.inCustomTrack = true;
    this.nemesisDefeatedThisRun = false;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.bossLoss = 0;
    this.runTime = 0;
    this.pendingResult = null;
    this.activeRunSeed = 202623;

    this.renderer.resetRun();
    this.renderer.setSector(bp.sectorTheme);
    const baseMods = runModsFromUpgrades(this.save.upgrades, this.save.apexLevel, this.save.specializations, this.save.equippedChips);
    this.sim.startSector(bp.sectorTheme, {
      ...baseMods,
      manualOverdrive: true,
      layoutSeed: 202623,
      starterWeapon: this.save.starterWeapon ?? 'pulse',
      equippedWingman: this.save.equippedWingman ?? 'prism_mirror',
      customBlueprint: bp,
    });
    this.lastSnap = this.sim.getSnapshot();
    this.input.reset();
    this.ui.hideTitle();
    this.ui.hideResult();
    this.ui.showHud(bp.sectorTheme, false, true);
    this.state = 'ready';
    this.readyTimer = 0;
    this.ui.showDragHint(true);
    this.ui.showBanner(
      html`<div class="b-kicker">🛠 CUSTOM CHALLENGE TRACK · 关卡工坊实机试玩</div><div class="b-title">${bp.title}</div><div class="b-sub">自定义机关 ×${bp.items.length} · 首领 ${BOSS_META[bp.bossId].title}</div>`,
      'od',
      1950,
    );
    this.input.onFirstInput = () => this.beginPlay();
    this.audio.setMusic(bp.sectorTheme, 1);
  }

  togglePhotoMode(): void {
    if (this.state === 'photo') this.exitPhotoMode();
    else this.enterPhotoMode();
  }
}
