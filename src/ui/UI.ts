import type { AccessibilityConfig } from '../app/save';
import { html, render, type Content } from './dom';
import type {
  AbyssalPactId,
  ColorblindMode,
  EndlessUpgradeId,
  KeybindAction,
  KeybindMap,
  MutatorId,
  NirvanaArchetype,
  NonNullDefeatReason,
  OverclockChipId,
  RangeControlCommand,
  RangePresetId,
  RewardId,
  SectorId,
  SimSnapshot,
  SpecializationId,
  SquadSkinId,
  WeaponId,
  WingmanId,
  BossId,
  CustomTrackBlueprint,
  CustomTrackItemKind,
  EnemyKind,
  ExpeditionMapState,
  PhotoFilterKind,
} from '../types/game';
import { EXPEDITION_NODE_META, EXPEDITION_RELICS, NIRVANA_META, resolveNirvanaArchetype } from '../sim/v23Mechanics';
import { BUILTIN_TRACK_PRESETS } from '../sim/trackEditor';
import { ABYSSAL_PACTS, computeAbyssalHeatTier, WINGMAN_FORMATION_LABELS, WINGMAN_META } from '../sim/v22Mechanics';
import { formatKeyLabel } from '../input/InputController';
import { getActiveSynergies, getEndlessThreat, PROTOCOLS, PROTOCOL_SYNERGIES } from '../config/protocols';
import { DUAL_SYNERGIES, FUSIONS, MUTATORS, OVERLIMIT_RESONANCES } from '../config/blitz';
import { getVolleyStreamCount, WEAPON_CONFIGS } from '../config/weapons';
import {
  ACHIEVEMENTS,
  BOSS_META,
  computeMutatorBonusPct,
  CORE_GLYPH,
  DEFEAT_META,
  ENEMY_META,
  GAME_TITLE_CN,
  GAME_TITLE_EN,
  getApexCost,
  getTotalWorkshopSpent,
  isApexUnlocked,
  OVERCLOCK_CHIPS,
  REWARD_META,
  SECTOR_CHALLENGES,
  SECTOR_META,
  SPECIALIZATIONS,
  SQUAD_SKINS,
  STARTER_BLADE_COST,
  STARTER_WEAPON_COST,
  STARTER_WEAPONS,
  UPGRADES,
  type BuildArchetypeSummary,
  type DamageBreakdownRow,
  type UpgradeId,
} from '../app/meta';
import type { SaveData } from '../app/save';

export interface UICallbacks {
  onStart(sector: SectorId): void;
  onEndless(): void;
  onLeaderboard(): void;
  onBlitz(): void;
  onFairTrial(): void;
  onToggleMutator(id: MutatorId): void;
  onProtocol(id: EndlessUpgradeId): void;
  onExtractEndless(): void;
  onPause(): void;
  onResume(): void;
  onRetry(): void;
  onHome(): void;
  onNext(): void;
  onToggleMute(): void;
  onToggleSpeed(): void;
  onBuy(id: UpgradeId): void;
  onBuyApex(): void;
  onRespec(): void;
  onSelectStarter(w: WeaponId): void;
  onToggleStarterBlade(): void;
  onSelectSkin(skin: SquadSkinId): void;
  onBuySpec(id: SpecializationId): void;
  onToggleChip(id: OverclockChipId): void;
  onReplaySeed(): void;
  onWatchReplay(): void;
  onExitReplay(): void;
  onOpenRange(): void;
  onRangeControl(cmd: RangeControlCommand): void;
  onOpenControls(): void;
  onCaptureKeybind(action: KeybindAction, btn: HTMLButtonElement): void;
  onResetKeybinds(): void;
  onTestRumble(): void;
  onToggleVox(enabled: boolean, volume: number): void;
  onTogglePerfHud(show: boolean): void;
  onPantheon(): void;
  onAccessibilityChange(patch: Partial<AccessibilityConfig>): void;
  onCodexPreview(spec: { tab: string; itemId: string } | null): void;
  onCodexRotate(deltaRad: number): void;
  onReplaySpeed(speed: 0.5 | 1 | 2): void;
  onReplayCamera(): string;
  onReplaySeek(frac: number): void;
  onTogglePact(id: AbyssalPactId): void;
  onClearPacts(): void;
  onSelectWingman(id: WingmanId): void;
  onCycleWingman(): void;
  onRunDiagnostic(): string;
  onOpenPhotoMode(): void;
  onExitPhotoMode(): void;
  onPhotoParamsChange(patch: { yaw?: number; pitch?: number; fov?: number; filter?: PhotoFilterKind }): void;
  onCapturePhoto(): void;
  onOpenExpedition(): void;
  onStartExpeditionNode(nodeId: string): void;
  onResetExpedition(): void;
  onTriggerNirvana(): void;
  onToggleLiveTelemetry(): boolean;
  onOpenEditor(): void;
  onPlayCustomTrack(bp: CustomTrackBlueprint): void;
  onExportTrackCode(bp: CustomTrackBlueprint): string;
  onImportTrackCode(code: string): CustomTrackBlueprint | null;
}

export interface ResultData {
  victory: boolean;
  sector: SectorId;
  blitz?: boolean;
  pantheon?: boolean;
  pantheonStageCleared?: number;
  expedition?: boolean;
  expeditionCompleted?: boolean;
  customTrack?: boolean;
  fairTrial?: boolean;
  extracted?: boolean;
  stars: number;
  score: number;
  best: number;
  newBest: boolean;
  reason: NonNullDefeatReason | null;
  stats: { kills: number; gatesImproved: number; vaultsCracked: number; maxChain: number; peakSquad: number; finalSquad: number; time: number };
  hasNext: boolean;
  progress: number;
  bossHpFrac: number | null;
  maxCombo: number;
  archetype?: BuildArchetypeSummary;
  damageBreakdown?: DamageBreakdownRow[];
  highlights?: { partsBroken: number; orbsReflected: number; parries: number; weaponSwaps: number; seed: number };
  canReplaySeed?: boolean;
  replayVerified?: boolean;
  replayTicks?: number;
  hasTacticalReplay?: boolean;
  endless?: {
    wave: number;
    bosses: number;
    distance: number;
    bestWave: number;
    newWaveBest: boolean;
  };
  challenges: Array<{ text: string; reward: number; done: boolean; isNew: boolean }>;
  unlockedMedals?: Array<{ name: string; glyph: string; color: string; reward: number }>;
  cores: { total: number; lines: Array<[string, number]>; balance: number; affordable: boolean };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

const FLOAT_POOL = 36;

export class UI {
  readonly root: HTMLElement;
  private title!: HTMLElement;
  private hud!: HTMLElement;
  private pauseEl!: HTMLElement;
  private resultEl!: HTMLElement;
  private helpEl!: HTMLElement;
  private workshopEl!: HTMLElement;
  private codexEl!: HTMLElement;
  private controlsEl!: HTMLElement;
  private abyssalEl!: HTMLElement;
  private photoHudEl!: HTMLElement;
  private expeditionEl!: HTMLElement;
  private editorEl!: HTMLElement;
  private nemesisBarEl!: HTMLElement;
  private nemesisNameEl!: HTMLElement;
  private nemesisFillEl!: HTMLElement;
  private nirvanaBtn!: HTMLButtonElement;
  private nirvanaFill!: HTMLElement;
  private nirvanaText!: HTMLElement;
  private liveTelToggleBtn!: HTMLButtonElement;
  private liveTelPanel!: HTMLElement;
  private liveTelOpen = false;
  private photoUiHidden = false;
  private editorDraft: CustomTrackBlueprint = JSON.parse(JSON.stringify(BUILTIN_TRACK_PRESETS[0]));
  private editorSelectedTool: CustomTrackItemKind = 'reflector';
  private editorReflectorAngle = 36;
  private editorEnemyKind: EnemyKind = 'phalanx';
  private editorNextId = 100;
  private rangePanel!: HTMLElement;
  private wingmanChip!: HTMLElement;
  private ghostDeltaEl!: HTMLElement;
  private lastWingmanKey = '';
  private letterboxEl!: HTMLElement;
  private voxHudEl!: HTMLElement;
  private perfHudEl!: HTMLElement;
  private perfCanvas!: HTMLCanvasElement;
  private perfLabel!: HTMLElement;
  private replayHudEl!: HTMLElement;
  private voxTimer: number | null = null;
  private letterboxTimer: number | null = null;
  private codexTab: 'arsenal' | 'bestiary' | 'setpieces' | 'medals' = 'arsenal';
  private codexSelectedId = 'arc_prism_storm';
  private flashScale = 1.0;
  private coBossBar!: HTMLElement;
  private coBossFill!: HTMLElement;
  private coBossName!: HTMLElement;
  private protocolEl: HTMLElement | null = null;
  private lastSave: SaveData | null = null;
  private banner!: HTMLElement;
  private toastEl!: HTMLElement;
  private flash!: HTMLElement;
  private nukeScorch!: HTMLElement;
  private nukeScorchTimer: number | null = null;
  private nirvanaKeyLabel = 'G';
  private jumpKeyLabel = 'W';
  private vignette!: HTMLElement;
  private squadBadge!: HTMLElement;
  private squadNum!: HTMLElement;
  private progressFill!: HTMLElement;
  private progressWrap!: HTMLElement;
  private speedBtn!: HTMLButtonElement;
  private bossBar!: HTMLElement;
  private bossFill!: HTMLElement;
  private bossName!: HTMLElement;
  private bossPhase!: HTMLElement;
  private weaponChip!: HTMLElement;
  private dpsChip!: HTMLElement;
  private bladesChip!: HTMLElement;
  private stackRack!: HTMLElement;
  private lastStackKey = '';
  private scoreEl!: HTMLElement;
  private feverBadge!: HTMLElement;
  private resoFill!: HTMLElement;
  private resoWrap!: HTMLElement;
  private resoLabel!: HTMLElement;
  private aegisBtn!: HTMLButtonElement;
  private aegisFill!: HTMLElement;
  private aegisText!: HTMLElement;
  private jumpBtn!: HTMLButtonElement;
  private jumpFill!: HTMLElement;
  private jumpText!: HTMLElement;
  private nukeBtn!: HTMLButtonElement;
  private nukeFill!: HTMLElement;
  private nukeText!: HTMLElement;
  private endlessHud!: HTMLElement;
  private resoReady = false;
  onOverdrive: (() => void) | null = null;
  onAegis: (() => void) | null = null;
  onSkyJump: (() => void) | null = null;
  onNuke: (() => void) | null = null;
  onSwapWeapon: (() => void) | null = null;
  onWingmanCycle: (() => void) | null = null;
  onNirvana: (() => void) | null = null;
  private comboEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private muteBtns: HTMLElement[] = [];
  private floats: Array<{ el: HTMLElement; t: number; dur: number; x: number; y: number; vx: number; vy: number; grav: number; baseScale: number; alive: boolean }> = [];
  private floatFanParity = 0;
  private selected: SectorId = 1;
  private lastSquad = -1;
  private lastWeaponKey = '';
  private lastDps = -1;
  private drillCue!: HTMLElement;
  private drillRewardTime = 0;
  private bannerTimer: number | null = null;
  private toastTimer: number | null = null;
  private comboTimer: number | null = null;
  private lastScore = -1;

  constructor(parent: HTMLElement, private cb: UICallbacks) {
    this.root = parent;
    this.root.classList.add('ui');
    this.buildTitle();
    this.buildHud();
    this.buildOverlays();
    for (let i = 0; i < FLOAT_POOL; i++) {
      const f = el('div', 'float');
      this.root.appendChild(f);
      this.floats.push({ el: f, t: 0, dur: 1, x: 0, y: 0, vx: 0, vy: 0, grav: 0, baseScale: 1, alive: false });
    }
  }

  // ------------------------------------------------------------------ build
  private buildTitle(): void {
    this.title = el('div', 'screen title-screen');
    this.title.dataset.testid = 'title-screen';
    this.title.dataset.uiBlock = '1';
    render(this.title, html`
      <div class="title-top">
        <button class="icon-btn mute-btn" data-testid="mute-btn-title" aria-label="静音">🔊</button>
        <div class="title-ver">NEON PROTOCOL · 棱镜终章</div>
        <button class="icon-btn" data-testid="leaderboard-btn" aria-label="无尽排行榜" title="无尽排行榜">🏆</button>
        <button class="icon-btn help-btn" data-testid="help-btn" aria-label="玩法">?</button>
      </div>
      <div class="logo">
        <div class="logo-prism"><span></span><span></span><span></span></div>
        <h1>${GAME_TITLE_CN}</h1>
        <div class="logo-en">${GAME_TITLE_EN}</div>
        <div class="tagline">移动选路 · 射击金门扩军 · 双主武专精聚变</div>
      </div>
      <div class="sector-list" data-testid="sector-list"></div>
      <div class="special-modes">
        <button class="blitz-card" data-testid="blitz-btn">
          <span class="blitz-icon">🏆</span>
          <span class="blitz-body"><b>极速闪击</b><small>六幕快节奏 · 流派抉择</small></span>
          <span class="blitz-go">▶</span>
        </button>
        <button class="endless-card" data-testid="endless-btn">
          <span class="endless-icon">∞</span>
          <span class="endless-body"><b>无尽协议</b><small>章节挑战 · 赏金撤离</small></span>
          <span class="endless-go">▶</span>
        </button>
        <button class="fair-card" data-testid="fair-trial-btn">
          <span class="fair-icon">⚖</span>
          <span class="fair-body"><b>公平试炼</b><small>固定种子 · 纯技术榜</small></span>
          <span class="fair-go">▶</span>
        </button>
        <button class="pantheon-card" data-testid="pantheon-btn">
          <span class="pantheon-icon">🏛</span>
          <span class="pantheon-body"><b>棱镜万神殿</b><small>四殿连战 · 双神合击</small></span>
          <span class="pantheon-go">▶</span>
        </button>
      </div>
      <div class="mutator-bar" data-testid="mutator-bar"></div>
      <div class="abyss-bar v23-dual-bar">
        <button class="heat-entry-btn" data-testid="heat-btn">
          <span class="hb-left">🔥 深渊协议 · <b data-testid="heat-tier-badge">灾变 0/10 阶</b></span>
          <small data-testid="heat-bonus-badge">灾变契约与变异招式 ▸</small>
        </button>
        <button class="expedition-entry-btn" data-testid="expedition-btn">
          <span class="hb-left">🌌 星区远征 · <b data-testid="expedition-badge">三幕分支星图</b></span>
          <small>跨幕继承 · 猎犬乱入 · 远征遗物 ▸</small>
        </button>
      </div>
      <div class="title-row">
        <div class="core-count" data-testid="core-count"><i>${CORE_GLYPH}</i><b>0</b></div>
        <button class="mid-btn range-entry-btn" data-testid="range-btn">🎯 靶场</button>
        <button class="mid-btn editor-entry-btn" data-testid="editor-btn">🛠 关卡工坊</button>
        <button class="mid-btn codex-btn" data-testid="codex-btn">图鉴 <small class="medal-count">0/12</small></button>
        <button class="mid-btn workshop-btn" data-testid="workshop-btn">强化工坊<i class="dot"></i></button>
        <button class="icon-btn controls-btn" data-testid="controls-btn" title="键位与手柄设置" aria-label="操控设置">🎮</button>
      </div>
      <button class="big-btn start-btn" data-testid="start-btn"><span>出击</span></button>
      <div class="title-foot" data-testid="input-prompt-bar">拖动/A D 移动 · W 跃迁 · 空格 超载 · E 脉冲 · Q 核弹 · G 奥义 · P 拍照</div>`);
    this.root.appendChild(this.title);
    this.title.querySelector('.start-btn')!.addEventListener('click', () => this.cb.onStart(this.selected));
    this.title.querySelector('[data-testid=blitz-btn]')!.addEventListener('click', () => this.cb.onBlitz());
    this.title.querySelector('[data-testid=endless-btn]')!.addEventListener('click', () => this.cb.onEndless());
    this.title.querySelector('[data-testid=leaderboard-btn]')!.addEventListener('click', () => this.cb.onLeaderboard());
    this.title.querySelector('[data-testid=fair-trial-btn]')!.addEventListener('click', () => this.cb.onFairTrial());
    this.title.querySelector('[data-testid=pantheon-btn]')!.addEventListener('click', () => this.cb.onPantheon());
    this.title.querySelector('.help-btn')!.addEventListener('click', () => this.showHelp(true));
    this.title.querySelector('.workshop-btn')!.addEventListener('click', () => this.showWorkshop(true));
    this.title.querySelector('.codex-btn')!.addEventListener('click', () => this.showCodex(true));
    this.title.querySelector('[data-testid=range-btn]')!.addEventListener('click', () => this.cb.onOpenRange());
    this.title.querySelector('[data-testid=controls-btn]')!.addEventListener('click', () => this.cb.onOpenControls());
    this.title.querySelector('[data-testid=heat-btn]')!.addEventListener('click', () => this.showAbyssal(true));
    this.title.querySelector('[data-testid=expedition-btn]')!.addEventListener('click', () => this.cb.onOpenExpedition());
    this.title.querySelector('[data-testid=editor-btn]')!.addEventListener('click', () => this.cb.onOpenEditor());
    const m = this.title.querySelector<HTMLElement>('.mute-btn')!;
    m.addEventListener('click', () => this.cb.onToggleMute());
    this.muteBtns.push(m);
  }

  private buildHud(): void {
    this.hud = el('div', 'hud');
    this.hud.dataset.testid = 'hud';
    render(this.hud, html`
      <div class="hud-top" data-ui-block="1">
        <button class="icon-btn pause-btn" data-testid="pause-btn" aria-label="暂停">❚❚</button>
        <div class="progress" data-testid="progress">
          <div class="progress-track"><div class="progress-fill"></div></div>
          <div class="progress-boss">☠</div>
        </div>
        <button class="icon-btn speed-btn" data-testid="speed-btn" aria-label="倍速">1×</button>
        <button class="icon-btn mute-btn" data-testid="mute-btn" aria-label="静音">🔊</button>
      </div>
      <div class="boss-bar" data-testid="boss-bar">
        <div class="boss-label"><span class="boss-name"></span><span class="boss-phase"></span></div>
        <div class="boss-track"><div class="boss-fill"></div></div>
        <div class="co-boss-bar" data-testid="co-boss-bar">
          <span class="co-boss-name">协同副神</span>
          <div class="co-boss-track"><div class="co-boss-fill"></div></div>
        </div>
      </div>
      <div class="nemesis-bar" data-testid="nemesis-bar">
        <div class="nemesis-label"><span class="nemesis-name">🐺 零号猎犬</span></div>
        <div class="nemesis-track"><div class="nemesis-fill"></div></div>
      </div>
      <div class="hud-row">
        <div class="chips">
          <div class="chip weapon-chip" data-testid="weapon-chip" data-ui-block="1" title="点击或按 Tab 切换领衔主武"></div>
          <div class="chip dps-chip" data-testid="dps-chip">⚡ DPS 2</div>
          <div class="chip wingman-chip" data-testid="wingman-chip" data-ui-block="1" title="点击或按 F / L3 切换全息僚机阵型"></div>
          <div class="chip blades-chip" data-testid="blades-chip"></div>
          <div class="stack-rack" data-testid="stack-rack"></div>
        </div>
        <div class="score-wrap">
          <div class="score-pill"><small>SCORE</small><div class="score" data-testid="score">0</div></div>
          <div class="fever-badge" data-testid="fever-badge">FEVER ×1.2</div>
          <div class="ghost-delta-pill" data-testid="ghost-delta"></div>
          <button class="live-tel-toggle" data-testid="live-telemetry-toggle" data-ui-block="1" title="展开/折叠实时伤害构成与折射效率">📊 战报</button>
        </div>
      </div>
      <div class="drill-cue" data-testid="drill-cue" role="status" hidden></div>
      <div class="endless-hud" data-testid="endless-hud"><b>阶段 1</b><span>首领 0 · 0m</span></div>
      <div class="squad-badge" data-testid="squad-count"><span class="sq-icon">◆</span><span class="sq-num">1</span></div>
      <div class="live-telemetry-panel" data-testid="live-telemetry-panel" data-ui-block="1"></div>
      <div class="bottom-dock" data-ui-block="1">
        <button class="aegis-btn ready" data-testid="aegis-btn" aria-label="相位脉冲">
          <div class="aegis-fill"></div>
          <span class="aegis-txt">🛡 脉冲 [E]</span>
        </button>
        <button class="jump-btn ready" data-testid="jump-btn" aria-label="苍穹跃迁">
          <div class="jump-fill"></div>
          <span class="jump-txt">🚀 跃迁 ×3 [W]</span>
        </button>
        <div class="reso" data-testid="resonance"><div class="reso-fill"></div><span>共鸣</span></div>
        <button class="nirvana-btn" data-testid="nirvana-btn" aria-label="双武终焉奥义">
          <div class="nirvana-fill"></div>
          <span class="nirvana-txt">☀️ 奥义 [G]</span>
        </button>
        <button class="nuke-btn ready" data-testid="nuke-btn" aria-label="战术核弹">
          <div class="nuke-fill"></div>
          <span class="nuke-txt">☢ 核弹 [Q]</span>
        </button>
      </div>
      <div class="tactical-vox" data-testid="tactical-vox">
        <div class="vox-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="vox-copy"><small class="vox-tag">PRISM-COMMS // 战术电台</small><b class="vox-msg">全息链路就绪</b></div>
      </div>
      <div class="perf-hud" data-testid="perf-hud" data-ui-block="1">
        <canvas width="72" height="20"></canvas>
        <span class="perf-txt">60FPS · 16.0ms · DC 0</span>
        <button class="perf-diag-mini" data-testid="hud-diag-btn" title="一键运行全链路确定性与帧耗自检">🧪</button>
      </div>
      <div class="replay-hud" data-testid="replay-hud" data-ui-block="1">
        <div class="rp-top-row">
          <span class="rp-badge">🎬 战术回放 · <b class="rp-prog">0%</b></span>
          <div class="rp-speeds">
            <button class="rp-sp" data-sp="0.5" data-testid="rp-speed-05">0.5×</button>
            <button class="rp-sp" data-sp="1" data-testid="rp-speed-1">1×</button>
            <button class="rp-sp on" data-sp="2" data-testid="rp-speed-2">2×</button>
          </div>
          <button class="rp-cam" data-testid="rp-cam-btn">🎥 追尾视角</button>
          <button class="rg-exit" data-testid="exit-replay-btn">退出 ✕</button>
        </div>
        <div class="rp-scrub-row">
          <input type="range" min="0" max="1000" step="1" value="0" data-testid="rp-timeline" class="rp-timeline" />
          <div class="rp-markers" data-testid="rp-markers"></div>
        </div>
      </div>
      <div class="combo"></div>
      <div class="hint" data-testid="drag-hint"><div class="hand">👆</div><div>左右拖动控制蜂群</div></div>`);
    this.root.appendChild(this.hud);
    this.progressWrap = this.hud.querySelector('.progress')!;
    this.progressFill = this.hud.querySelector('.progress-fill')!;
    this.speedBtn = this.hud.querySelector('.speed-btn')!;
    this.bossBar = this.hud.querySelector('.boss-bar')!;
    this.bossFill = this.hud.querySelector('.boss-fill')!;
    this.bossName = this.hud.querySelector('.boss-name')!;
    this.bossPhase = this.hud.querySelector('.boss-phase')!;
    this.coBossBar = this.hud.querySelector('.co-boss-bar')!;
    this.coBossFill = this.hud.querySelector('.co-boss-fill')!;
    this.coBossName = this.hud.querySelector('.co-boss-name')!;
    this.nemesisBarEl = this.hud.querySelector('[data-testid=nemesis-bar]')!;
    this.nemesisNameEl = this.hud.querySelector('.nemesis-name')!;
    this.nemesisFillEl = this.hud.querySelector('.nemesis-fill')!;
    this.nirvanaBtn = this.hud.querySelector('[data-testid=nirvana-btn]')!;
    this.nirvanaFill = this.hud.querySelector('.nirvana-fill')!;
    this.nirvanaText = this.hud.querySelector('.nirvana-txt')!;
    this.liveTelToggleBtn = this.hud.querySelector('[data-testid=live-telemetry-toggle]')!;
    this.liveTelPanel = this.hud.querySelector('[data-testid=live-telemetry-panel]')!;
    this.drillCue = this.hud.querySelector('.drill-cue')!;
    this.weaponChip = this.hud.querySelector('.weapon-chip')!;
    this.dpsChip = this.hud.querySelector('.dps-chip')!;
    this.wingmanChip = this.hud.querySelector('.wingman-chip')!;
    this.ghostDeltaEl = this.hud.querySelector('[data-testid=ghost-delta]')!;
    this.bladesChip = this.hud.querySelector('.blades-chip')!;
    this.stackRack = this.hud.querySelector('.stack-rack')!;
    this.scoreEl = this.hud.querySelector('.score')!;
    this.feverBadge = this.hud.querySelector('.fever-badge')!;
    this.squadBadge = this.hud.querySelector('.squad-badge')!;
    this.squadNum = this.hud.querySelector('.sq-num')!;
    this.resoFill = this.hud.querySelector('.reso-fill')!;
    this.resoWrap = this.hud.querySelector('.reso')!;
    this.resoLabel = this.resoWrap.querySelector('span')!;
    this.aegisBtn = this.hud.querySelector('.aegis-btn')!;
    this.aegisFill = this.hud.querySelector('.aegis-fill')!;
    this.aegisText = this.hud.querySelector('.aegis-txt')!;
    this.jumpBtn = this.hud.querySelector('[data-testid=jump-btn]')!;
    this.jumpFill = this.hud.querySelector('.jump-fill')!;
    this.jumpText = this.hud.querySelector('.jump-txt')!;
    this.nukeBtn = this.hud.querySelector('.nuke-btn')!;
    this.nukeFill = this.hud.querySelector('.nuke-fill')!;
    this.nukeText = this.hud.querySelector('.nuke-txt')!;
    this.endlessHud = this.hud.querySelector('.endless-hud')!;
    this.resoWrap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onOverdrive?.();
    });
    this.aegisBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onAegis?.();
    });
    this.aegisBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.detail === 0) this.onAegis?.();
    });
    this.jumpBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onSkyJump?.();
    });
    this.jumpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.detail === 0) this.onSkyJump?.();
    });
    this.nukeBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onNuke?.();
    });
    this.nukeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.detail === 0) this.onNuke?.();
    });
    this.nirvanaBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.onNirvana) this.onNirvana();
      else this.cb.onTriggerNirvana();
    });
    this.nirvanaBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.detail === 0) {
        if (this.onNirvana) this.onNirvana();
        else this.cb.onTriggerNirvana();
      }
    });
    this.liveTelToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.liveTelOpen = this.cb.onToggleLiveTelemetry();
      this.liveTelToggleBtn.classList.toggle('on', this.liveTelOpen);
      this.liveTelPanel.classList.toggle('show', this.liveTelOpen);
    });
    this.weaponChip.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onSwapWeapon?.();
    });
    this.wingmanChip.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.onWingmanCycle) this.onWingmanCycle();
      else this.cb.onCycleWingman();
    });
    this.speedBtn.addEventListener('click', () => this.cb.onToggleSpeed());
    this.voxHudEl = this.hud.querySelector('.tactical-vox')!;
    this.perfHudEl = this.hud.querySelector('.perf-hud')!;
    this.perfCanvas = this.perfHudEl.querySelector('canvas')!;
    this.perfLabel = this.perfHudEl.querySelector('.perf-txt')!;
    this.perfHudEl.querySelector('[data-testid=hud-diag-btn]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const msg = this.cb.onRunDiagnostic();
      this.toast(msg, 3200);
    });
    this.replayHudEl = this.hud.querySelector('.replay-hud')!;
    this.replayHudEl.querySelector('[data-testid=exit-replay-btn]')!.addEventListener('click', () => this.cb.onExitReplay());
    this.replayHudEl.querySelectorAll<HTMLButtonElement>('.rp-sp').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sp = Number(btn.dataset.sp) as 0.5 | 1 | 2;
        this.replayHudEl.querySelectorAll('.rp-sp').forEach((b) => b.classList.toggle('on', b === btn));
        this.cb.onReplaySpeed(sp);
      });
    });
    const rpCamBtn = this.replayHudEl.querySelector<HTMLButtonElement>('[data-testid=rp-cam-btn]')!;
    rpCamBtn.addEventListener('click', () => {
      const label = this.cb.onReplayCamera();
      rpCamBtn.textContent = `🎥 ${label}`;
    });
    const rpSlider = this.replayHudEl.querySelector<HTMLInputElement>('[data-testid=rp-timeline]')!;
    rpSlider.addEventListener('input', () => {
      this.cb.onReplaySeek(Number(rpSlider.value) / 1000);
    });
    this.comboEl = this.hud.querySelector('.combo')!;
    this.hintEl = this.hud.querySelector('.hint')!;
    this.hud.querySelector('.pause-btn')!.addEventListener('click', () => this.cb.onPause());
    const m = this.hud.querySelector<HTMLElement>('.mute-btn')!;
    m.addEventListener('click', () => this.cb.onToggleMute());
    this.muteBtns.push(m);
  }

  private buildOverlays(): void {
    this.banner = el('div', 'banner');
    this.toastEl = el('div', 'toast');
    this.toastEl.dataset.testid = 'toast';
    this.flash = el('div', 'flash');
    this.nukeScorch = el('div', 'nuke-scorch');
    this.vignette = el('div', 'vignette');
    this.letterboxEl = el('div', 'cinema-letterbox');
    render(this.letterboxEl, html`<div class="lb-top"></div><div class="lb-bot"></div>`);
    this.letterboxEl.dataset.testid = 'cinema-letterbox';
    this.root.append(this.vignette, this.letterboxEl, this.flash, this.nukeScorch, this.banner, this.toastEl);

    this.pauseEl = el('div', 'screen modal pause-screen');
    this.pauseEl.dataset.testid = 'pause-screen';
    this.pauseEl.dataset.uiBlock = '1';
    render(this.pauseEl, html`
      <div class="panel">
        <h2>战术暂停</h2>
        <div class="pause-info"></div>
        <div class="pause-synergies"></div>
        <button class="big-btn" data-testid="resume-btn">继续作战</button>
        <button class="mid-btn photo-entry-btn" data-testid="photo-mode-btn">📸 全息自由拍照模式 [P]</button>
        <button class="mid-btn" data-testid="pause-controls-btn">🎮 键位与手柄设置</button>
        <button class="mid-btn" data-testid="restart-btn">重新开始</button>
        <button class="mid-btn ghost" data-testid="home-btn">返回主页</button>
      </div>`);
    this.root.appendChild(this.pauseEl);
    this.pauseEl.querySelector('[data-testid=resume-btn]')!.addEventListener('click', () => this.cb.onResume());
    this.pauseEl.querySelector('[data-testid=photo-mode-btn]')!.addEventListener('click', () => this.cb.onOpenPhotoMode());
    this.pauseEl.querySelector('[data-testid=pause-controls-btn]')!.addEventListener('click', () => this.cb.onOpenControls());
    this.pauseEl.querySelector('[data-testid=restart-btn]')!.addEventListener('click', () => this.cb.onRetry());
    this.pauseEl.querySelector('[data-testid=home-btn]')!.addEventListener('click', () => this.cb.onHome());

    this.resultEl = el('div', 'screen modal result-screen');
    this.resultEl.dataset.testid = 'result-screen';
    this.resultEl.dataset.uiBlock = '1';
    this.root.appendChild(this.resultEl);

    this.helpEl = el('div', 'screen modal help-screen');
    this.helpEl.dataset.uiBlock = '1';
    this.helpEl.dataset.testid = 'help-screen';
    render(this.helpEl, html`
      <div class="panel help-panel">
        <h2>战术作战手册</h2>
        <ul class="help-list">
          <li><i class="hi move">⇆</i><div><b>左右拖动 / A D</b> 移动蜂群，全武装自动齐射；<b>X 键</b> 切换 <b>2× 倍速</b></div></li>
          <li><i class="hi vault">🌌</i><div><b>双主武 + 单核聚变</b>：每局专精培养 <b>2 件主武器 + 1 条聚变路线</b>，异系武器自动拆解升阶或二次拾取更换流派！</div></li>
          <li><i class="hi pos">▲</i><div><b>跑道立体机关</b>：踩<b>磁浮跳台</b>飞越致命 ÷ 门并震地清场；射<b>45°折射镜</b>斜角爆桶；闯<b>死斗契约</b>赢悬赏大奖</div></li>
          <li><i class="hi boss">⚡</i><div><b>首领破甲因果</b>：破<b>左肩</b>削减弹幕、破<b>右肩</b>削减召唤并触发 4s <b>2.0× 破防</b>；开场即可集火反弹<b>湮灭棱球</b>！</div></li>
          <li><i class="hi gold">🏆</i><div><b>极速闪击 & 突变词缀</b>：90 秒浓缩全机关与首领对决；勾选「镜像双子 / 玻璃大炮 / 连锁狂欢」赢取最高 +75% 得分与晶核加成！</div></li>
          <li><i class="hi reso">☢</i><div><b>战术核弹 [Q] & 相位脉冲 [E]</b>：召唤<b>缓降战术核弹</b>掀起蘑菇云全屏清场、重创首领！歼敌极速充能</div></li>
        </ul>
        <button class="big-btn" data-testid="help-close">明白了</button>
      </div>`);
    this.root.appendChild(this.helpEl);
    this.helpEl.querySelector('[data-testid=help-close]')!.addEventListener('click', () => this.showHelp(false));

    this.workshopEl = el('div', 'screen modal workshop-screen');
    this.workshopEl.dataset.uiBlock = '1';
    this.workshopEl.dataset.testid = 'workshop-screen';
    render(this.workshopEl, html`
      <div class="panel ws-panel">
        <div class="ws-head">
          <h2>强化工坊</h2>
          <button class="respec-btn" data-testid="respec-btn" title="100% 返还已投入晶核">↺ 免费重置</button>
        </div>
        <div class="ws-cores"><i>${CORE_GLYPH}</i><b>0</b><span>晶核</span></div>
        <div class="ws-list"></div>
        <div class="ws-note">每局结算与解锁勋章均奖励晶核；任意模块满级后解锁「奇点超频 Lv.∞」。</div>
        <button class="big-btn" data-testid="workshop-close">返回</button>
      </div>`);
    this.root.appendChild(this.workshopEl);
    this.workshopEl.querySelector('[data-testid=workshop-close]')!.addEventListener('click', () => this.showWorkshop(false));
    this.workshopEl.querySelector('[data-testid=respec-btn]')!.addEventListener('click', () => this.cb.onRespec());

    this.codexEl = el('div', 'screen modal codex-screen');
    this.codexEl.dataset.uiBlock = '1';
    this.codexEl.dataset.testid = 'codex-screen';
    render(this.codexEl, html`
      <div class="panel codex-panel holo-codex">
        <div class="codex-head-row">
          <h2>🌐 3D 全息战术档案馆</h2>
          <button class="mid-btn codex-rp-btn" data-testid="codex-replay-btn">🎬 回放上局</button>
        </div>
        <div class="codex-turntable" data-testid="codex-turntable">
          <div class="ct-badge" data-testid="codex-holo-label">360° 实时全息展台 · 左右拖动旋转检视</div>
          <div class="ct-spin-btns">
            <button class="ct-rot" data-testid="codex-rot-left">⟲ 左旋</button>
            <button class="ct-rot" data-testid="codex-rot-right">右旋 ⟳</button>
          </div>
        </div>
        <div class="codex-tabs">
          <button class="codex-tab on" data-tab="arsenal" data-testid="codex-tab-arsenal">超限共鸣</button>
          <button class="codex-tab" data-tab="bestiary" data-testid="codex-tab-bestiary">首领解剖</button>
          <button class="codex-tab" data-tab="setpieces" data-testid="codex-tab-setpieces">芯片机关</button>
          <button class="codex-tab" data-tab="medals" data-testid="codex-tab-medals">万神殿勋章</button>
        </div>
        <div class="codex-body"></div>
        <button class="big-btn" data-testid="codex-close">返回主页</button>
      </div>`);
    this.root.appendChild(this.codexEl);
    this.codexEl.querySelector('[data-testid=codex-close]')!.addEventListener('click', () => this.showCodex(false));
    this.codexEl.querySelector('[data-testid=codex-replay-btn]')!.addEventListener('click', () => {
      this.showCodex(false);
      this.cb.onWatchReplay();
    });
    const tt = this.codexEl.querySelector<HTMLElement>('[data-testid=codex-turntable]')!;
    let draggingTT = false;
    let lastTTX = 0;
    tt.addEventListener('pointerdown', (e) => {
      draggingTT = true;
      lastTTX = e.clientX;
    });
    window.addEventListener('pointermove', (e) => {
      if (!draggingTT) return;
      const dx = e.clientX - lastTTX;
      lastTTX = e.clientX;
      this.cb.onCodexRotate(dx * 0.015);
    });
    window.addEventListener('pointerup', () => {
      draggingTT = false;
    });
    this.codexEl.querySelector('[data-testid=codex-rot-left]')!.addEventListener('click', () => this.cb.onCodexRotate(-0.65));
    this.codexEl.querySelector('[data-testid=codex-rot-right]')!.addEventListener('click', () => this.cb.onCodexRotate(0.65));
    this.codexEl.querySelectorAll<HTMLButtonElement>('.codex-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.codexTab = btn.dataset.tab as 'arsenal' | 'bestiary' | 'setpieces' | 'medals';
        this.codexSelectedId =
          this.codexTab === 'bestiary'
            ? 'omega_zero'
            : this.codexTab === 'setpieces'
              ? 'high_spire'
              : 'arc_prism_storm';
        this.codexEl.querySelectorAll('.codex-tab').forEach((b) => b.classList.toggle('on', b === btn));
        if (this.lastSave) this.renderCodex(this.lastSave);
        this.cb.onCodexPreview({ tab: this.codexTab, itemId: this.codexSelectedId });
      });
    });

    // Stage 4: Custom Keybindings & Gamepad Haptics Modal
    this.controlsEl = el('div', 'screen modal controls-screen');
    this.controlsEl.dataset.uiBlock = '1';
    this.controlsEl.dataset.testid = 'controls-screen';
    render(this.controlsEl, html`
      <div class="panel ctrl-panel">
        <h2>🎮 外设手柄与自定义键位</h2>
        <div class="ctrl-gp-box" data-testid="gamepad-status">
          <span class="gp-dot"></span>
          <div class="gp-txt"><b>标准手柄即插即玩</b><small>左摇杆/十字键移动 · A/RT超载 · B/LB脉冲 · X/RB切枪 · Y/LT核弹</small></div>
          <button class="ws-buy" data-testid="test-rumble-btn">震动测试</button>
        </div>
        <div class="ctrl-vox-row" data-testid="vox-settings">
          <button class="mid-btn on" data-testid="toggle-vox-btn">🎙 全息语音 ON</button>
          <input type="range" min="0" max="100" step="5" value="85" data-testid="vox-vol-slider" title="全息战术语音音量" />
          <button class="mid-btn" data-testid="toggle-perf-btn">📊 帧耗时条 OFF</button>
        </div>
        <div class="ctrl-acc-box" data-testid="accessibility-box">
          <div class="acc-row">
            <button class="mid-btn" data-testid="cb-mode-btn">👁 色彩：标准霓虹</button>
            <button class="mid-btn" data-testid="aim-assist-btn">🎯 磁吸辅瞄 OFF</button>
          </div>
          <div class="acc-sliders">
            <label>震屏 <b data-testid="shake-val">100%</b><input type="range" min="0" max="100" step="10" value="100" data-testid="shake-slider" /></label>
            <label>闪光 <b data-testid="flash-val">100%</b><input type="range" min="0" max="100" step="10" value="100" data-testid="flash-slider" /></label>
          </div>
        </div>
        <div class="ctrl-bind-list" data-testid="keybind-list"></div>
        <div class="ctrl-foot">
          <button class="mid-btn" data-testid="reset-binds-btn">↺ 恢复默认键位</button>
          <button class="big-btn" data-testid="controls-close">保存返回</button>
        </div>
      </div>`);
    this.root.appendChild(this.controlsEl);
    this.controlsEl.querySelector('[data-testid=controls-close]')!.addEventListener('click', () => this.showControls(false));
    this.controlsEl.querySelector('[data-testid=reset-binds-btn]')!.addEventListener('click', () => this.cb.onResetKeybinds());
    this.controlsEl.querySelector('[data-testid=test-rumble-btn]')!.addEventListener('click', () => this.cb.onTestRumble());
    const voxBtn = this.controlsEl.querySelector<HTMLButtonElement>('[data-testid=toggle-vox-btn]')!;
    const voxSlider = this.controlsEl.querySelector<HTMLInputElement>('[data-testid=vox-vol-slider]')!;
    const perfBtn = this.controlsEl.querySelector<HTMLButtonElement>('[data-testid=toggle-perf-btn]')!;
    voxBtn.addEventListener('click', () => {
      const next = !voxBtn.classList.contains('on');
      voxBtn.classList.toggle('on', next);
      voxBtn.textContent = next ? '🎙 全息语音 ON' : '🎙 全息语音 OFF';
      this.cb.onToggleVox(next, Number(voxSlider.value) / 100);
    });
    voxSlider.addEventListener('input', () => {
      this.cb.onToggleVox(voxBtn.classList.contains('on'), Number(voxSlider.value) / 100);
    });
    perfBtn.addEventListener('click', () => {
      const next = !perfBtn.classList.contains('on');
      perfBtn.classList.toggle('on', next);
      perfBtn.textContent = next ? '📊 帧耗时条 ON' : '📊 帧耗时条 OFF';
      this.cb.onTogglePerfHud(next);
    });
    const cbBtn = this.controlsEl.querySelector<HTMLButtonElement>('[data-testid=cb-mode-btn]')!;
    const aimBtn = this.controlsEl.querySelector<HTMLButtonElement>('[data-testid=aim-assist-btn]')!;
    const shakeSlider = this.controlsEl.querySelector<HTMLInputElement>('[data-testid=shake-slider]')!;
    const flashSlider = this.controlsEl.querySelector<HTMLInputElement>('[data-testid=flash-slider]')!;
    cbBtn.addEventListener('click', () => {
      const cur = (cbBtn.dataset.mode as ColorblindMode) || 'none';
      const next: ColorblindMode = cur === 'none' ? 'deuteranopia' : cur === 'deuteranopia' ? 'tritanopia' : 'none';
      this.cb.onAccessibilityChange({ colorblindMode: next });
    });
    aimBtn.addEventListener('click', () => {
      const next = !aimBtn.classList.contains('on');
      this.cb.onAccessibilityChange({ aimAssist: next });
    });
    shakeSlider.addEventListener('input', () => {
      const v = Number(shakeSlider.value) / 100;
      this.controlsEl.querySelector('[data-testid=shake-val]')!.textContent = `${Math.round(v * 100)}%`;
      this.cb.onAccessibilityChange({ shakeScale: v });
    });
    flashSlider.addEventListener('input', () => {
      const v = Number(flashSlider.value) / 100;
      this.flashScale = v;
      this.controlsEl.querySelector('[data-testid=flash-val]')!.textContent = `${Math.round(v * 100)}%`;
      this.cb.onAccessibilityChange({ flashScale: v });
    });

    // Stage 5: Holographic Tactical Firing Range Live Control Deck
    this.rangePanel = el('div', 'range-deck');
    this.rangePanel.dataset.uiBlock = '1';
    this.rangePanel.dataset.testid = 'range-panel';
    render(this.rangePanel, html`
      <div class="rg-head">
        <span class="rg-title">🎯 全息战术靶场 · 实时弹道实验室</span>
        <button class="rg-exit" data-testid="range-exit-btn">退出靶场 ✕</button>
      </div>
      <div class="rg-metrics" data-testid="range-metrics">理论DPS <b>0</b> · 实测秒伤 <b>0</b> · 克制 <b>×1.00</b></div>
      <div class="rg-row">
        <label>领衔主武</label>
        <div class="rg-chips" data-role="lead">
          ${(['pulse', 'scatter', 'rail', 'plasma', 'cryo'] as const).map((w) => html`<button data-w="${w}" data-testid="rg-lead-${w}">${REWARD_META[w].glyph}${REWARD_META[w].short}</button>`)}
        </div>
      </div>
      <div class="rg-row">
        <label>协同副武</label>
        <div class="rg-chips" data-role="partner">
          ${(['pulse', 'scatter', 'rail', 'plasma', 'cryo'] as const).map((w) => html`<button data-pw="${w}" data-testid="rg-sub-${w}">${REWARD_META[w].glyph}${REWARD_META[w].short}</button>`)}
        </div>
      </div>
      <div class="rg-row rg-angle-row">
        <label>折镜角度 <b data-testid="range-angle-val">+36°</b></label>
        <input type="range" min="-50" max="50" step="2" value="36" data-testid="range-angle-slider" />
        <button class="rg-ov-btn on" data-testid="range-overlimit-btn">⚡超限共鸣 ON</button>
      </div>
      <div class="rg-row rg-v22-row">
        <label>全息僚机</label>
        <div class="rg-chips" data-role="wingman">
          <button data-rwm="prism_mirror" data-testid="rg-wm-prism">❖浮游折镜</button>
          <button data-rwm="gravity_anchor" data-testid="rg-wm-grav">◉引力锚定</button>
          <button data-rwm="phase_escort" data-testid="rg-wm-escort">🛡相位护卫</button>
          <button class="rg-ov-btn" data-testid="rg-wm-form-btn">⇄ 阵型 [F]</button>
          <button class="rg-ov-btn diag" data-testid="diag-bench-btn">🧪 全链路自检</button>
        </div>
      </div>
      <div class="rg-diag-strip" data-testid="diag-report">待命 · 点击「全链路自检」验证 180 帧确定性回放、DrawCall 与母带限幅器</div>
      <div class="rg-row">
        <label>靶桩编组</label>
        <div class="rg-chips" data-role="preset">
          <button data-pr="armored" class="on" data-testid="rg-pr-armored">重盾/冰巨像</button>
          <button data-pr="mixed" data-testid="rg-pr-mixed">全兵种潮</button>
          <button data-pr="barrel_bank" data-testid="rg-pr-barrel">折镜爆桶</button>
          <button data-pr="boss_dummy" data-testid="rg-pr-boss">首领三部件桩</button>
          <button data-pr="setpieces" data-testid="rg-pr-setpieces">立体三机关</button>
          <button data-pr="verticality" data-testid="rg-pr-verticality">高低差断桥</button>
          <button type="button" data-testid="rg-nirvana-btn">☀️终焉奥义</button>
          <button type="button" data-testid="rg-nemesis-btn">🐺召唤猎犬</button>
        </div>
      </div>`);
    this.root.appendChild(this.rangePanel);
    this.rangePanel.querySelector('[data-testid=range-exit-btn]')!.addEventListener('click', () => this.cb.onHome());
    this.rangePanel.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((btn) => {
      btn.addEventListener('click', () => this.cb.onRangeControl({ leadWeapon: btn.dataset.w as WeaponId }));
    });
    this.rangePanel.querySelectorAll<HTMLButtonElement>('[data-pw]').forEach((btn) => {
      btn.addEventListener('click', () => this.cb.onRangeControl({ partnerWeapon: btn.dataset.pw as WeaponId }));
    });
    const angleSlider = this.rangePanel.querySelector<HTMLInputElement>('[data-testid=range-angle-slider]')!;
    angleSlider.addEventListener('input', () => {
      const deg = Number(angleSlider.value) || 0;
      this.rangePanel.querySelector('[data-testid=range-angle-val]')!.textContent = `${deg >= 0 ? '+' : ''}${deg}°`;
      this.cb.onRangeControl({ reflectorAngle: deg });
    });
    const ovBtn = this.rangePanel.querySelector<HTMLButtonElement>('[data-testid=range-overlimit-btn]')!;
    ovBtn.addEventListener('click', () => {
      const next = !ovBtn.classList.contains('on');
      ovBtn.classList.toggle('on', next);
      ovBtn.textContent = next ? '⚡超限共鸣 ON' : '⚡超限共鸣 OFF';
      this.cb.onRangeControl({ overlimit: next });
    });
    this.rangePanel.querySelectorAll<HTMLButtonElement>('[data-pr]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.rangePanel.querySelectorAll('[data-pr]').forEach((b) => b.classList.toggle('on', b === btn));
        this.cb.onRangeControl({ preset: btn.dataset.pr as RangePresetId });
      });
    });
    this.rangePanel.querySelectorAll<HTMLButtonElement>('[data-rwm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const wId = btn.dataset.rwm as WingmanId;
        this.cb.onRangeControl({ wingman: wId });
      });
    });
    this.rangePanel.querySelector('[data-testid=rg-nirvana-btn]')?.addEventListener('click', () => {
      this.cb.onRangeControl({ triggerNirvana: true });
    });
    this.rangePanel.querySelector('[data-testid=rg-nemesis-btn]')?.addEventListener('click', () => {
      this.cb.onRangeControl({ spawnNemesis: true });
    });
    this.rangePanel.querySelector('[data-testid=rg-wm-form-btn]')?.addEventListener('click', () => {
      this.cb.onCycleWingman();
    });
    this.rangePanel.querySelector('[data-testid=diag-bench-btn]')?.addEventListener('click', () => {
      const rep = this.cb.onRunDiagnostic();
      const strip = this.rangePanel.querySelector('[data-testid=diag-report]');
      if (strip) {
        render(strip, rep);
        strip.classList.add('pass');
      }
    });

    // Stage 2: Abyssal Protocol Heat Ladder (1-10) Contract Matrix Modal
    this.abyssalEl = el('div', 'screen modal abyssal-screen');
    this.abyssalEl.dataset.uiBlock = '1';
    this.abyssalEl.dataset.testid = 'abyssal-screen';
    render(this.abyssalEl, html`
      <div class="panel abyss-panel">
        <div class="ws-head">
          <h2>🔥 深渊协议 · 灾变阶梯</h2>
          <button class="respec-btn" data-testid="abyssal-clear-btn">↺ 清零契约</button>
        </div>
        <div class="abyss-meter-box" data-testid="abyssal-meter"></div>
        <div class="abyss-pact-list" data-testid="abyssal-pact-list"></div>
        <div class="abyss-skin-note" data-testid="abyssal-skin-note"></div>
        <button class="big-btn" data-testid="abyssal-close">确认灾变契约 · 返回</button>
      </div>`);
    this.root.appendChild(this.abyssalEl);
    this.abyssalEl.querySelector('[data-testid=abyssal-close]')!.addEventListener('click', () => this.showAbyssal(false));
    this.abyssalEl.querySelector('[data-testid=abyssal-clear-btn]')!.addEventListener('click', () => this.cb.onClearPacts());
    this.buildV23Modals();
  }

  showWorkshop(v: boolean): void {
    this.workshopEl.classList.toggle('show', v);
    if (v && this.lastSave) this.renderWorkshop(this.lastSave);
  }

  showCodex(v: boolean): void {
    this.codexEl.classList.toggle('show', v);
    if (v && this.lastSave) {
      this.renderCodex(this.lastSave);
      this.cb.onCodexPreview({ tab: this.codexTab, itemId: this.codexSelectedId });
    } else if (!v) {
      this.cb.onCodexPreview(null);
    }
  }

  setFlashScale(scale: number): void {
    this.flashScale = Math.max(0, Math.min(1, scale));
  }

  showControls(v: boolean, keybinds?: KeybindMap, padName = ''): void {
    this.controlsEl.classList.toggle('show', v);
    if (v && keybinds) {
      this.renderControls(keybinds, padName);
    }
  }

  renderControls(
    keybinds: KeybindMap,
    padName = '',
    voxEnabled = true,
    voxVol = 0.85,
    showPerf = false,
    acc?: AccessibilityConfig,
  ): void {
    const voxBtn = this.controlsEl.querySelector<HTMLButtonElement>('[data-testid=toggle-vox-btn]');
    const voxSlider = this.controlsEl.querySelector<HTMLInputElement>('[data-testid=vox-vol-slider]');
    const perfBtn = this.controlsEl.querySelector<HTMLButtonElement>('[data-testid=toggle-perf-btn]');
    if (voxBtn) {
      voxBtn.classList.toggle('on', voxEnabled);
      voxBtn.textContent = voxEnabled ? '🎙 全息语音 ON' : '🎙 全息语音 OFF';
    }
    if (voxSlider) voxSlider.value = String(Math.round(voxVol * 100));
    if (perfBtn) {
      perfBtn.classList.toggle('on', showPerf);
      perfBtn.textContent = showPerf ? '📊 帧耗时条 ON' : '📊 帧耗时条 OFF';
    }
    if (acc) {
      this.flashScale = acc.flashScale ?? 1.0;
      const cbBtn = this.controlsEl.querySelector<HTMLButtonElement>('[data-testid=cb-mode-btn]');
      const aimBtn = this.controlsEl.querySelector<HTMLButtonElement>('[data-testid=aim-assist-btn]');
      const shS = this.controlsEl.querySelector<HTMLInputElement>('[data-testid=shake-slider]');
      const flS = this.controlsEl.querySelector<HTMLInputElement>('[data-testid=flash-slider]');
      if (cbBtn) {
        cbBtn.dataset.mode = acc.colorblindMode;
        cbBtn.classList.toggle('on', acc.colorblindMode !== 'none');
        cbBtn.textContent =
          acc.colorblindMode === 'deuteranopia'
            ? '👁 色彩：红绿高对比 ▲/✖'
            : acc.colorblindMode === 'tritanopia'
              ? '👁 色彩：蓝黄高对比 ▲/✖'
              : '👁 色彩：标准霓虹';
      }
      if (aimBtn) {
        aimBtn.classList.toggle('on', Boolean(acc.aimAssist));
        aimBtn.textContent = acc.aimAssist ? '🎯 磁吸辅瞄 ON' : '🎯 磁吸辅瞄 OFF';
      }
      if (shS) {
        shS.value = String(Math.round((acc.shakeScale ?? 1) * 100));
        this.controlsEl.querySelector('[data-testid=shake-val]')!.textContent = `${shS.value}%`;
      }
      if (flS) {
        flS.value = String(Math.round((acc.flashScale ?? 1) * 100));
        this.controlsEl.querySelector('[data-testid=flash-val]')!.textContent = `${flS.value}%`;
      }
    }
    const gpBox = this.controlsEl.querySelector('.ctrl-gp-box')!;
    gpBox.classList.toggle('connected', Boolean(padName));
    const cleanPad = padName.replace(/\s*\(.*$/, '').trim().slice(0, 26);
    gpBox.querySelector('b')!.textContent = cleanPad ? `🎮 已连接：${cleanPad}` : '🎮 标准手柄即插即玩（等待接入）';
    const rows: Array<[KeybindAction, string]> = [
      ['moveLeft', '向左机动'],
      ['moveRight', '向右机动'],
      ['skyJump', '苍穹跃迁 (可累积三段跳)'],
      ['overdrive', '共鸣超载齐射'],
      ['aegis', '相位力场脉冲'],
      ['nuke', '战术热核打击'],
      ['swapWeapon', '切换领衔主武'],
      ['wingmanMode', '切换全息僚机阵型'],
      ['nirvanaBurst', '释放双武终焉奥义'],
    ];
    const list = this.controlsEl.querySelector('.ctrl-bind-list')!;
    render(list, rows
      .map(
        ([act, label]) => html`<div class="ctrl-row">
          <span>${label}</span>
          <button class="mid-btn bind-btn" data-act="${act}" data-testid="bind-${act}">${formatKeyLabel(keybinds[act])}</button>
        </div>`,
      ));
    list.querySelectorAll<HTMLButtonElement>('.bind-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.textContent = '请按键...';
        btn.classList.add('listening');
        this.cb.onCaptureKeybind(btn.dataset.act as KeybindAction, btn);
      });
    });
  }

  showRangeDeck(v: boolean): void {
    this.rangePanel.classList.toggle('show', v);
  }

  updateRangeDeck(snap: SimSnapshot, drawCalls = 0): void {
    if (!snap.isFiringRange) return;
    const authDps = Math.round(snap.effectiveSquadDps ?? snap.trueSquadDps);
    const realDps = Math.round(snap.rangeRealizedDps ?? 0);
    const counter = snap.rangeCounterMult ?? 1.0;
    const ovMeta = snap.overlimitResonance ? OVERLIMIT_RESONANCES[snap.overlimitResonance] : null;
    const metricsEl = this.rangePanel.querySelector('[data-testid=range-metrics]');
    if (metricsEl) {
      render(metricsEl, html`理论DPS <b>${authDps.toLocaleString('en-US')}</b> · 实测 <b>${realDps.toLocaleString('en-US')}</b> · 克制 <b style="color:${counter > 1.05 ? '#19f5a8' : '#cfe8ff'}">×${counter.toFixed(2)}</b>${ovMeta ? html` · <em style="color:${ovMeta.color}">${ovMeta.short}</em>` : ''} · DC <b>${drawCalls}</b>`);
    }
    const partner = (snap.activeLoadout ?? []).find((w) => w !== snap.weapon) ?? snap.weapon;
    this.rangePanel.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => {
      b.classList.toggle('on', b.dataset.w === snap.weapon);
    });
    this.rangePanel.querySelectorAll<HTMLButtonElement>('[data-pw]').forEach((b) => {
      b.classList.toggle('on', b.dataset.pw === partner);
    });
    const curWm = snap.wingmanState?.id ?? null;
    this.rangePanel.querySelectorAll<HTMLButtonElement>('[data-rwm]').forEach((b) => {
      b.classList.toggle('on', b.dataset.rwm === curWm);
    });
    const formBtn = this.rangePanel.querySelector<HTMLButtonElement>('[data-testid=rg-wm-form-btn]');
    if (formBtn) {
      formBtn.textContent = snap.wingmanState
        ? `⇄ ${WINGMAN_FORMATION_LABELS[snap.wingmanState.formation].short} [F]`
        : '⇄ 阵型 [F]';
    }
  }

  renderCodex(save: SaveData): void {
    this.lastSave = save;
    this.codexEl.querySelectorAll<HTMLButtonElement>('.codex-tab').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === this.codexTab);
    });
    const body = this.codexEl.querySelector('.codex-body')!;
    if (this.codexTab === 'arsenal') {
      const fusionCards = Object.values(FUSIONS)
        .map(
          (f) => html`<div class="cx-card" style="--cc:${f.color}">
            <div class="cx-icon">${f.glyph}</div>
            <div class="cx-main">
              <div class="cx-title"><b>${f.name}</b><span>双武超限聚变</span></div>
              <div class="cx-desc">${f.desc}</div>
              <div class="cx-meta"><em>合成配方：${f.recipeText}</em></div>
            </div>
          </div>`,
        );
      const weaponIds: RewardId[] = ['pulse', 'scatter', 'rail', 'plasma', 'cryo', 'blades'];
      const weaponCards = weaponIds
        .map((id) => {
          const m = REWARD_META[id];
          const statLine =
            id === 'blades'
              ? '近身旋刃防线 · 环绕半径 2.6m · 单次破舱 +6 战士'
              : (() => {
                  const cfg = WEAPON_CONFIGS[id];
                  const l1 = cfg.levels[0];
                  const l3 = cfg.levels[2];
                  return `射速 ${l1.shotsPerSecond}→${l3.shotsPerSecond}/s · 倍率 ×${l1.dpsMult.toFixed(2)}→×${l3.dpsMult.toFixed(2)}`;
                })();
          return html`<div class="cx-card" style="--cc:${m.color}">
            <div class="cx-icon">${m.glyph}</div>
            <div class="cx-main">
              <div class="cx-title"><b>${m.name}</b><span>${m.short}武装</span></div>
              <div class="cx-desc">${m.desc}</div>
              <div class="cx-meta"><em>克制：${m.counters}</em><small>${statLine}</small></div>
            </div>
          </div>`;
        });
      const dualCards = Object.values(DUAL_SYNERGIES)
        .map(
          (ds) => html`<div class="cx-card" style="--cc:${ds.color}">
            <div class="cx-icon">${ds.glyph}</div>
            <div class="cx-main">
              <div class="cx-title"><b>${ds.name}</b><span>双武战术协同</span></div>
              <div class="cx-desc">${ds.desc}</div>
              <div class="cx-meta"><em>配对：${ds.recipeText}</em></div>
            </div>
          </div>`,
        );
      const overlimitCards = Object.values(OVERLIMIT_RESONANCES)
        .map(
          (ov) => html`<div class="cx-card holo-pick${this.codexSelectedId === ov.id ? ' sel' : ''}" data-holo-id="${ov.id}" style="--cc:${ov.color}">
            <div class="cx-icon">${ov.glyph}</div>
            <div class="cx-main">
              <div class="cx-title"><b>${ov.name}</b><span>点击投影 3D 双武共鸣</span></div>
              <div class="cx-desc">${ov.desc}</div>
              <div class="cx-meta"><em>共鸣条件：${ov.recipeText}</em></div>
            </div>
          </div>`,
        );
      render(body, html`<div class="cx-sec">🔥 10/10 双主武超限共鸣矩阵（总等级≥5 或超载激活）</div>${overlimitCards}<div class="cx-sec">⚡ 双武超限聚变（局内自动合成）</div>${fusionCards}<div class="cx-sec">✦ 双武战术协同（全配对零废组合）</div>${dualCards}<div class="cx-sec">基础同屏协同武装</div>${weaponCards}`);
    } else if (this.codexTab === 'bestiary') {
      const enemyCards = (Object.keys(ENEMY_META) as Array<keyof typeof ENEMY_META>)
        .map((k) => {
          const m = ENEMY_META[k];
          const kills = save.bestiaryKills?.[k] ?? 0;
          return html`<div class="cx-card" style="--cc:${m.hex}">
            <div class="cx-icon">${m.glyph}</div>
            <div class="cx-main">
              <div class="cx-title"><b>${m.name}</b><span>${m.role} · 已歼灭 ${kills}</span></div>
              <div class="cx-desc">${m.detail}</div>
              <div class="cx-meta"><em>弱点：${m.weakness}</em></div>
            </div>
          </div>`;
        });
      const bossCards = (Object.keys(BOSS_META) as Array<keyof typeof BOSS_META>)
        .map((k) => {
          const b = BOSS_META[k];
          const kills = save.bestiaryKills?.[k] ?? 0;
          return html`<div class="cx-card boss holo-pick${this.codexSelectedId === k ? ' sel' : ''}" data-holo-id="${k}" style="--cc:${b.color}">
            <div class="cx-icon">☠</div>
            <div class="cx-main">
              <div class="cx-title"><b>${b.title} · ${b.name}</b><span>3D 弱点解剖 · 已讨伐 ${kills}</span></div>
              <div class="cx-desc">${b.mechanic}</div>
              <div class="cx-meta"><em>战术：${b.counterTip}</em></div>
            </div>
          </div>`;
        });
      render(body, html`<div class="cx-sec">首领弱点解剖（点击切换 360° 全息解剖模型）</div>${bossCards}<div class="cx-sec">感染体与战术协同编队档案</div>${enemyCards}`);
    } else if (this.codexTab === 'setpieces') {
      const chipHtml = OVERCLOCK_CHIPS.map(
        (ch) => html`<div class="cx-card holo-pick" data-holo-id="${ch.id}" style="--cc:${ch.color}">
          <div class="cx-icon">${ch.glyph}</div>
          <div class="cx-main">
            <div class="cx-title"><b>${ch.name}</b><span>战术超频芯片</span></div>
            <div class="cx-desc">${ch.desc}</div>
          </div>
        </div>`,
      );
      const setpieceHtml = [
        ['high_spire', '🗼', '#ff4b78', '高台狙击棱塔 · 高低差克制', '海拔 2.85m 高台狙击核心：平射受高地护盾 0.45× 衰减；借助磁浮跳台跃空俯冲或 45° 折镜斜射可 2.6× 贯通碎盾！'],
        ['bridge_gap', '🌉', '#62f4ff', '磁悬浮断桥跃迁 & 侧翼坍缩裂谷', '踩跳台或极性电磁滑轨凌空飞跃断桥可获【凌空跃迁扩编】与共鸣充能；误踏裂谷将损失前锋战士。'],
        ['wingman_prism', '❖', '#5ef6ff', '全息战术僚机编队 · 移动折镜阵', '支持 F / L3 实时切换随行齐射、前出架镜（部署真实 45° 移动折镜自造折射弹幕！）与环轨护卫三阵型！'],
        ['reactor_3tier', '⚛', '#ffdf58', '核心反应堆三阶觉醒 & 深渊灾变阶梯', '三阶觉醒展开神圣能量法阵并环绕推镜；灾变 4 阶起解锁首领交叉折镜激光网、相位分身与磁暴潮汐变异招式！'],
      ]
        .map(
          ([id, g, col, name, desc]) => html`<div class="cx-card holo-pick${this.codexSelectedId === id ? ' sel' : ''}" data-holo-id="${id}" style="--cc:${col}">
          <div class="cx-icon">${g}</div>
          <div class="cx-main"><div class="cx-title"><b>${name}</b><span>立体战场交互</span></div><div class="cx-desc">${desc}</div></div>
        </div>`,
        );
      render(body, html`<div class="cx-sec">⛰ V21 高低差立体地形与反应堆觉醒</div>${setpieceHtml}<div class="cx-sec">🔌 6 枚战术超频芯片图鉴</div>${chipHtml}`);
    } else {
      const pan = save.pantheon ?? { bestScore: 0, clears: 0, bestStage: 0, bestTime: 0 };
      const panBanner = html`<div class="cx-card" style="--cc:#ffdf58">
        <div class="cx-icon">🏛</div>
        <div class="cx-main">
          <div class="cx-title"><b>棱镜万神殿 · 首领连战</b><span>最高第 ${pan.bestStage}/4 殿 · 制霸 ${pan.clears} 次</span></div>
          <div class="cx-desc">最高得分 ${pan.bestScore.toLocaleString('en-US')}${pan.bestTime > 0 ? ` · 最速通关 ${pan.bestTime.toFixed(1)}s` : ''} · 第四终殿迎战双首领同屏合击！</div>
        </div>
      </div>`;
      const unlockedSet = new Set(save.achievements ?? []);
      render(body, [panBanner, ...ACHIEVEMENTS.map((a) => {
        const done = unlockedSet.has(a.id);
        return html`<div class="cx-card medal${done ? ' done' : ''}" style="--cc:${a.color}">
          <div class="cx-icon">${done ? a.glyph : '🔒'}</div>
          <div class="cx-main">
            <div class="cx-title"><b>${a.name}</b><span class="cx-rw">${done ? '✓ 已达成' : `+${CORE_GLYPH}${a.reward}`}</span></div>
            <div class="cx-desc">${a.desc}</div>
          </div>
        </div>`;
      })]);
    }
    const holoLbl = this.codexEl.querySelector('[data-testid=codex-holo-label]');
    if (holoLbl) {
      holoLbl.textContent = `360° 全息投影 · [${this.codexSelectedId.toUpperCase()}] · 拖动旋转`;
    }
    body.querySelectorAll<HTMLElement>('.holo-pick').forEach((card) => {
      card.addEventListener('click', () => {
        const hid = card.dataset.holoId || 'arc_prism_storm';
        this.codexSelectedId = hid;
        body.querySelectorAll('.holo-pick').forEach((c) => c.classList.toggle('sel', c === card));
        if (holoLbl) holoLbl.textContent = `360° 全息投影 · [${hid.toUpperCase()}] · 拖动旋转`;
        this.cb.onCodexPreview({ tab: this.codexTab, itemId: hid });
      });
    });
  }

  renderWorkshop(save: SaveData, boughtId?: UpgradeId | 'apex'): void {
    this.lastSave = save;
    const coresTxt = save.cores.toLocaleString('en-US');
    this.title.querySelector('.core-count b')!.textContent = coresTxt;
    this.workshopEl.querySelector('.ws-cores b')!.textContent = coresTxt;
    const medalCountEl = this.title.querySelector('.medal-count');
    if (medalCountEl) {
      medalCountEl.textContent = `${save.achievements?.length ?? 0}/${ACHIEVEMENTS.length}`;
    }

    const apexUnlocked = isApexUnlocked(save.upgrades);
    const apexLv = save.apexLevel ?? 0;
    const apexCost = getApexCost(apexLv);
    const unlockedChipSet = new Set(save.unlockedChips ?? []);
    const equippedChipList = save.equippedChips ?? [];
    const affordable =
      UPGRADES.some((u) => save.upgrades[u.id] < u.max && save.cores >= u.costs[save.upgrades[u.id]]!) ||
      SPECIALIZATIONS.some((sp) => (save.specializations?.[sp.id] ?? 0) < sp.max && save.cores >= sp.costs[save.specializations?.[sp.id] ?? 0]!) ||
      OVERCLOCK_CHIPS.some((ch) => !unlockedChipSet.has(ch.id) && save.cores >= ch.cost) ||
      (apexUnlocked && save.cores >= apexCost);
    this.title.querySelector('.workshop-btn')!.classList.toggle('can', affordable);

    const respecBtn = this.workshopEl.querySelector<HTMLButtonElement>('[data-testid=respec-btn]')!;
    const totalSpent = getTotalWorkshopSpent(save.upgrades, apexLv, save.specializations, save.unlockedChips, save.unlockedWingmen);
    respecBtn.disabled = totalSpent <= 0;

    const list = this.workshopEl.querySelector('.ws-list')!;
    render(list, '');
    for (const u of UPGRADES) {
      const lv = save.upgrades[u.id] ?? 0;
      const maxed = lv >= u.max;
      const cost = maxed ? 0 : u.costs[lv]!;
      const can = !maxed && save.cores >= cost;
      const row = el('div', `ws-row${boughtId === u.id ? ' bought' : ''}`);
      row.style.setProperty('--uc', u.color);
      render(row, html`
        <div class="ws-glyph">${u.glyph}</div>
        <div class="ws-body">
          <div class="ws-name">${u.name} <small>Lv${lv}</small></div>
          <div class="ws-eff">${lv > 0 ? u.effect(lv) : '未强化'}${maxed ? '' : html` <em>→ ${u.effect(lv + 1)}</em>`}</div>
          <div class="ws-pips">${Array.from({ length: u.max }, (_, i) => html`<i class="${i < lv ? 'on' : ''}"></i>`)}</div>
        </div>
        <button class="ws-buy${can ? '' : ' off'}" data-testid="buy-${u.id}" disabled="${maxed}">${maxed ? '已满级' : `${CORE_GLYPH} ${cost}`}</button>`);
      row.querySelector('button')!.addEventListener('click', () => {
        if (can) this.cb.onBuy(u.id);
        else if (!maxed) {
          row.classList.remove('deny');
          void row.offsetWidth;
          row.classList.add('deny');
        }
      });
      list.appendChild(row);
    }

    const apexCan = apexUnlocked && save.cores >= apexCost;
    const apexRow = el('div', `ws-row apex-row${boughtId === 'apex' ? ' bought' : ''}${apexUnlocked ? '' : ' locked'}`);
    apexRow.style.setProperty('--uc', '#ffd84a');
    render(apexRow, html`
      <div class="ws-glyph">۞</div>
      <div class="ws-body">
        <div class="ws-name">奇点超频 <small>${apexUnlocked ? `Lv.${apexLv} (∞)` : '需任一模块满级'}</small></div>
        <div class="ws-eff">${
          apexUnlocked
            ? html`全伤害 +${apexLv * 4}% · 开局 +${apexLv} 人 <em>→ +${(apexLv + 1) * 4}% / +${apexLv + 1} 人</em>`
            : '任意基础强化升至 Lv5 后解锁无限等级突破'
        }</div>
      </div>
      <button class="ws-buy${apexCan ? '' : ' off'}" data-testid="buy-apex" disabled="${!apexUnlocked}">${
        apexUnlocked ? `${CORE_GLYPH} ${apexCost}` : '🔒 未解锁'
      }</button>`);
    apexRow.querySelector('button')!.addEventListener('click', () => {
      if (apexCan) this.cb.onBuyApex();
      else if (apexUnlocked) {
        apexRow.classList.remove('deny');
        void apexRow.offsetWidth;
        apexRow.classList.add('deny');
      }
    });
    list.appendChild(apexRow);

    // Horizontal Starter Modules & Squadron Neon Skins (zero impact on Fair Trial #202611!)
    const modBox = el('div', 'ws-mods');
    const unlockedSet = new Set(save.unlockedStarters ?? ['pulse']);
    const starterChips = STARTER_WEAPONS.map((w) => {
      const m = REWARD_META[w];
      const unlocked = unlockedSet.has(w);
      const active = (save.starterWeapon ?? 'pulse') === w;
      const canBuy = !unlocked && save.cores >= STARTER_WEAPON_COST;
      const sub = active ? '出战中' : unlocked ? '可切换' : `${CORE_GLYPH}${STARTER_WEAPON_COST}`;
      return html`<button class="ws-mod-chip${active ? ' on' : ''}${!unlocked && !canBuy ? ' off' : ''}" style="--mc:${m.color}" data-starter="${w}" data-testid="starter-${w}"><span>${m.glyph} ${m.short}</span><small>${sub}</small></button>`;
    });

    const bladeUnlocked = Boolean(save.starterBladeUnlocked);
    const bladeOn = bladeUnlocked && Boolean(save.starterBlade);
    const bladeCan = !bladeUnlocked && save.cores >= STARTER_BLADE_COST;
    const bladeSub = !bladeUnlocked ? `解锁 ${CORE_GLYPH}${STARTER_BLADE_COST}` : bladeOn ? '✓ 已挂载' : '点击挂载';

    const maxHeatCleared = save.abyssal?.maxHeatCleared ?? 0;
    const unlockedSkinSet = new Set(save.unlockedAbyssSkins ?? []);
    const skinChips = SQUAD_SKINS.map((sk) => {
      const active = (save.squadSkin ?? 'cyan') === sk.id;
      const locked = Boolean(sk.reqHeat && maxHeatCleared < sk.reqHeat && !unlockedSkinSet.has(sk.id));
      const label = locked ? `🔒 ${sk.name} (灾变${sk.reqHeat}阶)` : sk.name;
      return html`<button class="ws-skin-chip${active ? ' on' : ''}${locked ? ' off' : ''}" style="--mc:${sk.color}" data-skin="${sk.id}" data-locked="${locked ? '1' : '0'}" data-reqheat="${sk.reqHeat ?? 0}" data-testid="skin-${sk.id}"><i></i>${label}</button>`;
    });

    const unlockedWmSet = new Set(save.unlockedWingmen ?? []);
    const equippedWm = save.equippedWingman ?? null;
    const wingmanCards = (Object.keys(WINGMAN_META) as WingmanId[]).map((wId) => {
      const wm = WINGMAN_META[wId];
      const unlocked = unlockedWmSet.has(wId);
      const equipped = equippedWm === wId;
      const canBuy = !unlocked && save.cores >= wm.cost;
      const badge = equipped ? '✓ 出战中' : unlocked ? '点击挂载' : `${CORE_GLYPH}${wm.cost}`;
      return html`<button class="ws-chip-card${equipped ? ' on' : ''}${!unlocked && !canBuy ? ' off' : ''}" style="--uc:${wm.color}" data-wingman="${wId}" data-testid="wingman-${wId}">
        <div class="wsc-top"><span>${wm.glyph} <b>${wm.name}</b></span><em>${badge}</em></div>
        <div class="wsc-desc">${wm.desc}</div>
      </button>`;
    });

    const specRows = SPECIALIZATIONS.map((sp) => {
      const lv = save.specializations?.[sp.id] ?? 0;
      const maxed = lv >= sp.max;
      const cost = maxed ? 0 : sp.costs[lv]!;
      const can = !maxed && save.cores >= cost;
      return html`<div class="ws-spec-card" style="--uc:${sp.color}">
        <div class="ws-spec-top"><span>${sp.glyph} <b>${sp.name}</b> <small>Lv.${lv}/${sp.max}</small></span>
          <button class="ws-buy${can ? '' : ' off'}" data-spec="${sp.id}" data-testid="buy-${sp.id}" disabled="${maxed}">${maxed ? '满级' : `${CORE_GLYPH} ${cost}`}</button>
        </div>
        <div class="ws-spec-eff">${lv > 0 ? sp.effect(lv) : sp.effect(1)}</div>
      </div>`;
    });

    const chipCards = OVERCLOCK_CHIPS.map((ch) => {
      const unlocked = unlockedChipSet.has(ch.id);
      const equipped = equippedChipList.includes(ch.id);
      const canBuy = !unlocked && save.cores >= ch.cost;
      const badge = equipped ? '✓ 已插槽' : unlocked ? '点击挂载' : `${CORE_GLYPH}${ch.cost}`;
      return html`<button class="ws-chip-card${equipped ? ' on' : ''}${!unlocked && !canBuy ? ' off' : ''}" style="--uc:${ch.color}" data-chip="${ch.id}" data-testid="chip-${ch.id}">
        <div class="wsc-top"><span>${ch.glyph} <b>${ch.name}</b></span><em>${badge}</em></div>
        <div class="wsc-desc">${ch.desc}</div>
      </button>`;
    });

    render(modBox, html`
      <div class="ws-mod-title">🛸 全息战术僚机机库 <small>（按 F / L3 实时切换随行齐射 / 前出架镜 / 环轨护卫 · 公平试炼自动禁用）</small></div>
      <div class="ws-chip-grid">${wingmanCards}</div>
      <div class="ws-mod-title">🔌 战术超频芯片槽 <small data-testid="chip-slot-count">（已挂载 ${equippedChipList.length}/3 · 公平试炼自动禁用）</small></div>
      <div class="ws-chip-grid">${chipCards}</div>
      <div class="ws-mod-title">🧬 流派专精科技树 <small>（可免费重置 · 公平试炼自动禁用）</small></div>
      <div class="ws-spec-list">${specRows}</div>
      <div class="ws-mod-title">🎯 横向起手流派模块 <small>（公平试炼自动禁用）</small></div>
      <div class="ws-mod-grid">${starterChips}</div>
      <div class="ws-mod-subrow">
        <button class="ws-blade-btn${bladeOn ? ' on' : ''}${!bladeUnlocked && !bladeCan ? ' off' : ''}" data-testid="toggle-starter-blade">✦ 先锋护航飞刃（开局 +1 环轨刃） · <b>${bladeSub}</b></button>
      </div>
      <div class="ws-mod-title">🎨 蜂群霓虹光环涂装</div>
      <div class="ws-skin-row">${skinChips}</div>`);
    modBox.querySelectorAll<HTMLButtonElement>('[data-chip]').forEach((btn) => {
      btn.addEventListener('click', () => this.cb.onToggleChip(btn.dataset.chip as OverclockChipId));
    });
    modBox.querySelectorAll<HTMLButtonElement>('[data-spec]').forEach((btn) => {
      btn.addEventListener('click', () => this.cb.onBuySpec(btn.dataset.spec as SpecializationId));
    });
    modBox.querySelectorAll<HTMLButtonElement>('[data-starter]').forEach((btn) => {
      btn.addEventListener('click', () => this.cb.onSelectStarter(btn.dataset.starter as WeaponId));
    });
    modBox.querySelector<HTMLButtonElement>('[data-testid=toggle-starter-blade]')!.addEventListener('click', () => {
      this.cb.onToggleStarterBlade();
    });
    modBox.querySelectorAll<HTMLButtonElement>('[data-wingman]').forEach((btn) => {
      btn.addEventListener('click', () => this.cb.onSelectWingman(btn.dataset.wingman as WingmanId));
    });
    modBox.querySelectorAll<HTMLButtonElement>('[data-skin]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.locked === '1') {
          this.toast(html`🔥 通关 <b>深渊协议 · 灾变 ${btn.dataset.reqheat} 阶</b> 即可解锁该流光涂装！`, 2200);
          return;
        }
        this.cb.onSelectSkin(btn.dataset.skin as SquadSkinId);
      });
    });
    list.appendChild(modBox);
  }

  // ------------------------------------------------------------------ screens
  showTitle(save: SaveData): void {
    this.title.classList.add('show');
    this.hud.classList.remove('show');
    this.pauseEl.classList.remove('show');
    this.resultEl.classList.remove('show');
    this.codexEl.classList.remove('show');
    this.controlsEl.classList.remove('show');
    this.abyssalEl?.classList.remove('show');
    this.rangePanel.classList.remove('show');
    this.renderWorkshop(save);
    this.selected = Math.min(save.unlocked, this.selected) as SectorId;
    if (this.selected < 1) this.selected = 1;
    this.renderSectorList(save);
    this.renderBlitz(save);
    this.renderEndless(save);
    this.renderFairTrial(save);
    this.renderPantheon(save);
    this.renderMutators(save);
    this.renderAbyssal(save);
    const startBtn = this.title.querySelector<HTMLButtonElement>('.start-btn')!;
    const isFreshPlayer = !save.records[1].cleared && save.endless.bestWave === 0 && save.blitz.clears === 0;
    startBtn.classList.toggle('recommend-pulse', isFreshPlayer);
    startBtn.querySelector('span')!.textContent = isFreshPlayer
      ? '▶ 推荐开始 · 第 01 区教学战'
      : `出击 · 0${this.selected} ${SECTOR_META[this.selected].name}`;
    this.hideBanner();
  }

  private renderSectorList(save: SaveData): void {
    const list = this.title.querySelector('.sector-list')!;
    render(list, '');
    for (const id of [1, 2, 3, 4] as SectorId[]) {
      const meta = SECTOR_META[id];
      const rec = save.records[id];
      const locked = id > save.unlocked;
      const card = el('button', `sector-card s${id}${locked ? ' locked' : ''}${this.selected === id ? ' sel' : ''}`);
      card.dataset.testid = `sector-${id}`;
      render(card, html`
        <div class="sc-num">0${id}</div>
        <div class="sc-body">
          <div class="sc-name">${meta.name} ${rec.score > 0 ? html`<small class="sc-hi">${rec.score.toLocaleString('en-US')} 分</small>` : ''}</div>
          <div class="sc-boss">首领 · ${meta.bossTitle}</div>
          ${!locked && this.selected === id ? html`<div class="sc-ch">${SECTOR_CHALLENGES[id].map((c) => html`<span class="${save.challenges.includes(c.id) ? 'ok' : ''}">${save.challenges.includes(c.id) ? '✓' : '○'} ${c.text}</span>`)}</div>` : ''}
        </div>
        <div class="sc-stars">${locked ? '🔒' : [0, 1, 2].map((i) => html`<span class="${i < rec.stars ? 'on' : ''}">★</span>`)}</div>`);
      if (!locked) {
        card.addEventListener('click', () => {
          this.selected = id;
          this.renderSectorList(save);
          const sb = this.title.querySelector('.start-btn span');
          if (sb && (save.records[1].cleared || id !== 1)) {
            sb.textContent = `出击 · 0${id} ${SECTOR_META[id].name}`;
          }
        });
      }
      list.appendChild(card);
    }
  }

  private renderBlitz(save: SaveData): void {
    const btn = this.title.querySelector<HTMLButtonElement>('[data-testid=blitz-btn]')!;
    const sub = btn.querySelector('small')!;
    if (save.blitz && save.blitz.bestScore > 0) {
      const sec = save.blitz.bestTime > 0 ? ` · ${Math.round(save.blitz.bestTime)}s` : '';
      sub.textContent = `最佳 ${save.blitz.bestScore.toLocaleString('en-US')}${sec}`;
    } else {
      sub.textContent = '六幕快节奏 · 流派抉择';
    }
  }

  private renderFairTrial(save: SaveData): void {
    const btn = this.title.querySelector<HTMLButtonElement>('[data-testid=fair-trial-btn]');
    if (!btn) return;
    const sub = btn.querySelector('small')!;
    const ft = save.fairTrial;
    if (ft && ft.bestScore > 0) {
      const sec = ft.bestTime > 0 ? ` · ${Math.round(ft.bestTime)}s` : '';
      sub.textContent = `纯技术纪录 ${ft.bestScore.toLocaleString('en-US')}${sec}`;
    } else {
      sub.textContent = '固定种子 #202611 · 零工坊纯技术榜';
    }
  }

  private renderEndless(save: SaveData): void {
    const button = this.title.querySelector<HTMLButtonElement>('[data-testid=endless-btn]')!;
    button.classList.remove('locked');
    button.disabled = false;
    button.querySelector('small')!.textContent =
      save.endless.bestWave > 0
        ? `阶段 ${save.endless.bestWave} · ${save.endless.bestScore.toLocaleString('en-US')} 分`
        : '无限阶段 · 双协议羁绊';
    button.querySelector('.endless-go')!.textContent = '▶';
  }

  renderPantheon(save: SaveData): void {
    const sub = this.title.querySelector('[data-testid=pantheon-btn] small');
    if (!sub) return;
    const p = save.pantheon ?? { bestScore: 0, clears: 0, bestStage: 0, bestTime: 0 };
    sub.textContent =
      p.clears > 0
        ? `制霸 ×${p.clears} · 最佳 ${p.bestScore.toLocaleString('en-US')}`
        : p.bestStage > 0
          ? `最高第 ${p.bestStage}/4 殿 · 双神合击`
          : '四殿连战 · 双神同屏合击';
  }

  renderMutators(save: SaveData): void {
    this.lastSave = save;
    const bar = this.title.querySelector('.mutator-bar')!;
    const active = new Set(save.mutators ?? []);
    const totalPct = computeMutatorBonusPct(save.mutators);
    render(bar, [html`<span class="mut-lbl">突变词缀${totalPct > 0 ? html` <em>+${totalPct}%</em>` : ''}</span>`, ...MUTATORS.map((m) => {
        const on = active.has(m.id);
        return html`<button class="mut-chip${on ? ' on' : ''}" style="--mc:${m.color}" data-mut="${m.id}" data-testid="mutator-${m.id}" title="${m.desc}">${m.glyph} ${m.name} <small>${m.tagLabel}+${m.bonusPct}%</small></button>`;
      })]);
    bar.querySelectorAll<HTMLButtonElement>('[data-mut]').forEach((btn) => {
      btn.addEventListener('click', () => this.cb.onToggleMutator(btn.dataset.mut as MutatorId));
    });
  }

  hideTitle(): void {
    this.title.classList.remove('show');
  }

  showProtocols(snap: SimSnapshot): void {
    const run = snap.endless;
    if (!run?.offers.length) return;
    if (!this.protocolEl) {
      this.protocolEl = el('div', 'screen modal protocol-screen');
      this.protocolEl.dataset.testid = 'protocol-screen';
      this.protocolEl.dataset.uiBlock = '1';
      this.protocolEl.setAttribute('role', 'dialog');
      this.protocolEl.setAttribute('aria-modal', 'true');
      this.protocolEl.setAttribute('aria-label', '选择阶段强化');
      this.root.appendChild(this.protocolEl);
      this.protocolEl.addEventListener('keydown', (e) => {
        const buttons = [...this.protocolEl!.querySelectorAll<HTMLButtonElement>('button[data-protocol]')];
        const index = Number(e.key) - 1;
        if (index >= 0 && index < buttons.length) buttons[index]!.click();
        if (e.key === 'Tab' && buttons.length) {
          e.preventDefault();
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(current + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]!.focus();
        }
      });
    }
    const threat = getEndlessThreat(run.wave);
    const currentSynergies = getActiveSynergies(run.upgrades);
    const installed = Object.entries(run.upgrades)
      .map(([id, level]) => `${PROTOCOLS[id as EndlessUpgradeId].name} ×${level}`)
      .join(' · ');

    render(this.protocolEl, html`<div class="panel protocol-panel">
      <div class="protocol-kicker">STAGE ${run.wave - 1} CLEARED</div>
      <h2>选择你的进化</h2>
      <p class="protocol-lead">首领已击破。安装一项协议，构筑共鸣羁绊。</p>
      <div class="protocol-choices">${run.offers
        .map((id, i) => {
          const p = PROTOCOLS[id];
          const level = (run.upgrades[id] ?? 0) + 1;
          const nextUpgrades = { ...run.upgrades, [id]: level };
          const newlyUnlocked = PROTOCOL_SYNERGIES.filter(
            (s) => s.active(nextUpgrades) && !s.active(run.upgrades),
          );
          const synBadge = newlyUnlocked.length
            ? html`<em class="syn-unlock">✦ 激活羁绊「${newlyUnlocked.map((s) => s.name).join(' / ')}」</em>`
            : '';
          return html`<button class="protocol-choice" style="--pc:${p.color}" data-protocol="${id}" data-testid="protocol-${id}">
            <span class="protocol-glyph">${p.glyph}</span>
            <span class="protocol-copy"><small>${p.tag} · Lv.${level}</small><b>${p.name}</b><span>${p.description}</span>${synBadge}</span>
            <i>${i + 1}</i>
          </button>`;
        })}</div>
      ${
        currentSynergies.length
          ? html`<div class="protocol-synergies">${currentSynergies
              .map((s) => html`<span style="--sc:${s.color}" title="${s.effectText}">${s.glyph} ${s.name}</span>`)}</div>`
          : ''
      }
      <div class="protocol-next"><span>下一战场 / 阶段 ${run.wave}</span><b>${threat.glyph} ${threat.name}</b><small>${threat.description}</small></div>
      ${installed ? html`<div class="protocol-installed">已安装：${installed}</div>` : ''}
      <div class="protocol-extract-row">
        <button class="mid-btn extract-btn" data-testid="extract-endless-btn">🚁 携赏金安全撤离（晶核结算 +35%）</button>
      </div>
      <div class="protocol-note">选择强化继续深潜冒险，或立即安全撤离落袋晶核 · 键盘 1 / 2 / 3</div>
    </div>`);
    this.protocolEl.querySelectorAll<HTMLButtonElement>('[data-protocol]').forEach((b) => {
      b.addEventListener('click', () => this.cb.onProtocol(b.dataset.protocol as EndlessUpgradeId));
    });
    this.protocolEl.querySelector('[data-testid=extract-endless-btn]')?.addEventListener('click', () => {
      this.cb.onExtractEndless();
    });
    this.protocolEl.classList.add('show');
    this.protocolEl.querySelector<HTMLButtonElement>('button[data-protocol]')?.focus({ preventScroll: true });
  }

  hideProtocols(): void {
    this.protocolEl?.classList.remove('show');
  }

  showHelp(v: boolean): void {
    this.helpEl.classList.toggle('show', v);
  }

  showHud(sector: SectorId, endless = false, blitz = false): void {
    this.drillRewardTime = 0;
    this.drillCue.hidden = true;
    this.hud.classList.add('show');
    this.hud.classList.toggle('endless', endless);
    this.hud.classList.toggle('blitz', blitz);
    this.hud.dataset.sector = String(sector);
    this.bossBar.classList.remove('show');
    this.progressWrap.classList.remove('hide');
    this.lastSquad = -1;
    this.lastWeaponKey = '';
    this.lastStackKey = '';
    this.lastWingmanKey = '';
    if (this.ghostDeltaEl) this.ghostDeltaEl.classList.remove('show');
    this.lastDps = -1;
    render(this.stackRack, '');
    this.lastScore = -1;
    this.setSpeed(1);
    this.updateFever(0, 1);
    this.resultEl.classList.remove('show');
    this.pauseEl.classList.remove('show');
    this.comboEl.classList.remove('show');
    for (const f of this.floats) {
      f.alive = false;
      f.el.style.opacity = '0';
    }
  }

  hideHud(): void {
    this.hud.classList.remove('show');
  }

  showDragHint(v: boolean): void {
    this.hintEl.classList.toggle('show', v);
  }

  showPause(v: boolean, snap?: SimSnapshot): void {
    this.pauseEl.classList.toggle('show', v);
    if (v && snap) {
      const loadoutIds = (snap.activeLoadout && snap.activeLoadout.length > 0 ? snap.activeLoadout : [snap.weapon]);
      const mainBuildTxt = loadoutIds
        .map((id) => `${REWARD_META[id].name} Lv.${snap.arsenal?.[id] || snap.weaponLevel}`)
        .join(' + ');
      const authDps = Math.round(snap.effectiveSquadDps ?? snap.trueSquadDps);
      const reserve = snap.reserveTroops ?? 0;
      render(this.pauseEl.querySelector('.pause-info')!, html`
        <div><span>前线蜂群${reserve > 0 ? ' + 储备' : ''}</span><b>${snap.squadCount}${reserve > 0 ? html` <small style="color:#ffd84a">+${reserve}</small>` : ''}</b></div>
        <div><span>主构筑武装</span><b style="color:${REWARD_META[snap.weapon].color}">${mainBuildTxt}</b></div>
        <div><span>实战总 DPS</span><b>${authDps.toLocaleString('en-US')}</b></div>
        <div><span>${snap.endless ? '无尽阶段' : snap.blitzActive ? '闪击推进' : '战区进度'}</span><b>${snap.endless ? `阶段 ${snap.endless.wave} · ${Math.round(snap.endless.distance)}m` : `${Math.round(snap.runwayProgress * 100)}%`} · 尸潮×${(snap.swarmMult ?? 1).toFixed(1)}</b></div>`);
      const synEl = this.pauseEl.querySelector('.pause-synergies')!;
      const syns = getActiveSynergies(snap.endless?.upgrades);
      const fusBadges = (snap.activeFusions ?? []).map((fId) => {
        const f = FUSIONS[fId];
        return html`<span style="--sc:${f.color}">${f.glyph} 核心聚变「${f.name}」：${f.desc}</span>`;
      });
      if (snap.activeDualSynergy) {
        const ds = DUAL_SYNERGIES[snap.activeDualSynergy];
        fusBadges.push(html`<span style="--sc:${ds.color}">${ds.glyph} 双武协同「${ds.name}」：${ds.desc}</span>`);
      }
      const arsenalList = (['pulse', 'scatter', 'rail', 'plasma', 'cryo'] as const)
        .filter((id) => (snap.arsenal?.[id] ?? 0) > 0)
        .map((id) => `${REWARD_META[id].glyph}${REWARD_META[id].name} Lv.${snap.arsenal![id]}`)
        .join(' · ');
      const mutList = (snap.mutators ?? [])
        .map((mId) => MUTATORS.find((x) => x.id === mId)?.name ?? mId)
        .join(' + ');
      const detailLines: Content[] = [];
      if (arsenalList) {
        detailLines.push(html`<span style="--sc:#9fd8ff">🔧 已解锁武器库：${arsenalList}${snap.bladesCount > 0 ? ` · 环轨刃×${snap.bladesCount}` : ''}${(snap.overclockStacks ?? 0) > 0 ? ` · 超限+${snap.overclockStacks}` : ''}</span>`);
      }
      if (mutList) {
        detailLines.push(html`<span style="--sc:#ffc531">🎲 激活词缀：${mutList}</span>`);
      }
      render(synEl, [
        ...fusBadges,
        ...syns.map((s) => html`<span style="--sc:${s.color}">${s.glyph} ${s.name}：${s.effectText}</span>`),
        ...detailLines,
      ]);
    }
  }

  setMuted(m: boolean): void {
    for (const b of this.muteBtns) {
      b.textContent = m ? '🔇' : '🔊';
      b.classList.toggle('off', m);
    }
  }

  setSpeed(mult: 1 | 2): void {
    this.speedBtn.textContent = `${mult}×`;
    this.speedBtn.classList.toggle('fast', mult === 2);
  }

  updateFever(combo: number, mult: number): void {
    if (mult > 1.01 && combo >= 10) {
      this.feverBadge.classList.add('show');
      this.feverBadge.classList.toggle('max', mult >= 2.0);
      this.feverBadge.textContent = `🔥 FEVER ×${mult.toFixed(1)}`;
    } else {
      this.feverBadge.classList.remove('show', 'max');
    }
  }

  // ------------------------------------------------------------------ HUD update
  showDrillReward(simTime: number): void {
    this.drillRewardTime = simTime + 0.95;
    this.drillCue.dataset.action = 'reward';
    this.drillCue.textContent = '双收  +300';
    this.drillCue.hidden = false;
  }

  private updateDrillCue(snap: SimSnapshot): void {
    if (snap.phase === 'PLAYING' && snap.simTime < this.drillRewardTime) return;
    const cue = snap.drillCue;
    if (!cue || snap.phase !== 'PLAYING') {
      this.drillCue.hidden = true;
      return;
    }
    const side = cue.x < 0 ? '左' : '右';
    const opposite = cue.x < 0 ? '右' : '左';
    const text = cue.action === 'vault' ? `${side}侧武器舱 · ${opposite}门 +16` :
      cue.action === 'switch' ? `已破舱 · 切${side}接援军` :
      cue.action === 'pad' ? `${side}侧跳台 · 越过减员门` : `瞄准${side}镜 · 折射破盾`;
    if (this.drillCue.textContent !== text) this.drillCue.textContent = text;
    this.drillCue.dataset.action = cue.action;
    this.drillCue.hidden = false;
  }

  updateHud(snap: SimSnapshot, score: number, badgePos: { x: number; y: number }): void {
    this.hud.classList.toggle('drill-active', snap.inBlitzDrill);
    this.updateDrillCue(snap);
    const rw = this.root.clientWidth || 390;
    const rh = this.root.clientHeight || 780;
    const rawX = Number.isFinite(badgePos.x) && badgePos.x > 1 ? badgePos.x : rw * 0.5;
    const rawY = Number.isFinite(badgePos.y) && badgePos.y > 1 ? badgePos.y : rh * 0.74;
    const bx = Math.max(48, Math.min(rw - 48, rawX));
    const by = Math.max(108, Math.min(rh - 84, rawY));
    this.squadBadge.style.transform = `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px) translate(-50%, -100%)`;
    const reserve = snap.reserveTroops ?? 0;
    const sqComposite = snap.squadCount * 1000 + reserve;
    if (sqComposite !== this.lastSquad) {
      const prevCount = this.lastSquad >= 0 ? Math.floor(this.lastSquad / 1000) : -1;
      if (prevCount >= 0 && snap.squadCount !== prevCount) {
        const up = snap.squadCount > prevCount;
        this.squadBadge.classList.remove('up', 'down');
        void this.squadBadge.offsetWidth;
        this.squadBadge.classList.add(up ? 'up' : 'down');
      }
      this.lastSquad = sqComposite;
      render(this.squadNum, reserve > 0
          ? html`${snap.squadCount}<small class="sq-res">+${reserve}</small>`
          : String(snap.squadCount));
      this.squadBadge.classList.toggle('t2', snap.squadCount >= 25);
      this.squadBadge.classList.toggle('t3', snap.squadCount >= 100);
    }
    this.progressFill.style.width = `${(snap.runwayProgress * 100).toFixed(1)}%`;
    if (snap.endless) {
      const syns = getActiveSynergies(snap.endless.upgrades);
      const synSuffix = syns.length ? ` · 羁绊×${syns.length}` : '';
      this.endlessHud.querySelector('b')!.textContent = `阶段 ${snap.endless.wave} · ${getEndlessThreat(snap.endless.wave).name}`;
      this.endlessHud.querySelector('span')!.textContent = `首领 ${snap.endless.bosses} · ${Math.round(snap.endless.distance)}m${synSuffix}`;
    }

    // Focused 2-Main-Weapon Interactive Build Chip (tap or press [Tab] to toggle Lead Main Weapon!)
    const loadout = snap.activeLoadout && snap.activeLoadout.length > 0 ? snap.activeLoadout : [snap.weapon];
    const canSwap =
      loadout.length >= 2 || (loadout.length === 1 && loadout[0] !== 'pulse' && (snap.arsenal?.pulse ?? 1) > 0);
    const displayPair =
      loadout.length >= 2
        ? [snap.weapon, loadout.find((x) => x !== snap.weapon) ?? loadout[0]!]
        : canSwap
          ? [snap.weapon, snap.weapon === 'pulse' ? loadout[0]! : 'pulse']
          : loadout;
    const wkey = `${snap.weapon}:${displayPair.map((id) => `${id}${snap.arsenal?.[id] || snap.weaponLevel}`).join('+')}`;
    if (wkey !== this.lastWeaponKey) {
      this.lastWeaponKey = wkey;
      const leadMeta = REWARD_META[snap.weapon];
      const partsHtml = displayPair
        .map((id, idx) => {
          const m = REWARD_META[id];
          const lv = snap.arsenal?.[id] || snap.weaponLevel;
          return html`<span class="g" style="color:${m.color}">${m.glyph}</span><span class="n${idx === 0 ? ' lead' : ' sub'}">${m.short}Lv${lv}</span>`;
        })
        .flatMap((part, index) => index ? [html`<span class="w-sep">⇄</span>`, part] : [part]);
      this.weaponChip.classList.toggle('swappable', canSwap);
      render(this.weaponChip, partsHtml);
      this.weaponChip.style.setProperty('--wc', leadMeta.color);
      this.weaponChip.classList.remove('pop');
      void this.weaponChip.offsetWidth;
      this.weaponChip.classList.add('pop');
    }

    // Core Fusion Route Status in dpsChip (full DPS & weapon inventory moved to Pause & Battle Report!)
    const triTimer = snap.triFusionTimer ?? 0;
    const activeFusions = snap.activeFusions ?? [];
    let fusionStatusText = '';
    if (triTimer > 0) {
      fusionStatusText = `👑 三核终极超武 ${triTimer.toFixed(1)}s`;
    } else if (snap.overlimitResonance) {
      const ov = OVERLIMIT_RESONANCES[snap.overlimitResonance];
      fusionStatusText = `${ov.glyph} 超限·${ov.name}`;
    } else if (activeFusions.length > 0) {
      const f = FUSIONS[activeFusions[0]!];
      fusionStatusText = `${f.glyph} ${f.name}`;
    } else if (snap.activeDualSynergy) {
      const ds = DUAL_SYNERGIES[snap.activeDualSynergy];
      fusionStatusText = `${ds.glyph} ${ds.name}`;
    } else if (loadout.length >= 2) {
      const lvSum = (snap.arsenal?.[loadout[0]!] ?? 1) + (snap.arsenal?.[loadout[1]!] ?? 1);
      fusionStatusText = `🔧 主构筑 ${lvSum}/3 升阶聚变`;
    } else {
      fusionStatusText = `🎯 专精槽 ${snap.stats.vaultsCracked > 0 ? '1' : '0'}/2 · 暂停看详情`;
    }
    const statusHash = fusionStatusText.length * 131 + (activeFusions.length * 17) + Math.ceil(triTimer * 10);
    if (statusHash !== this.lastDps) {
      this.lastDps = statusHash;
      this.dpsChip.textContent = fusionStatusText;
    }

    // Minimalist Stack Rack: at most 2 urgent combat-state pills so HUD stays 100% single-glance clean!
    const pills: Content[] = [];
    if ((snap.overclockStacks ?? 0) > 0) {
      pills.push(html`<span class="st-pill oc" style="--sc:#ff5ce0">✦超限+${snap.overclockStacks}</span>`);
    }
    if ((snap.rampageStacks ?? 0) >= 12) {
      pills.push(html`<span class="st-pill hot" style="--sc:#ff9a3c">🔥狂暴×${snap.rampageStacks}</span>`);
    } else if ((snap.swarmMult ?? 1) >= 2.2) {
      pills.push(html`<span class="st-pill swarm" data-testid="swarm-pill" style="--sc:#ff6a3c">👾狂潮×${(snap.swarmMult ?? 1).toFixed(1)}</span>`);
    }
    const stackKey = [snap.overclockStacks, snap.rampageStacks, (snap.swarmMult ?? 1).toFixed(1), snap.pantheonActive].join('|');
    if ((snap.coreReactorTier ?? 0) > 0) {
      const rt = snap.coreReactorTier!;
      const roman = rt === 3 ? 'Ⅲ' : rt === 2 ? 'Ⅱ' : 'Ⅰ';
      pills.push(html`<span class="st-pill" style="--sc:#ffdf58" data-testid="reactor-pill">⚛反应堆${roman}阶</span>`);
    }
    if (snap.pantheonActive) {
      pills.push(html`<span class="st-pill" style="--sc:#ff66c4" data-testid="pantheon-pill">🏛第${snap.pantheonStage ?? 1}/4殿</span>`);
    }
    if ((snap.abyssalHeatTier ?? 0) > 0) {
      pills.push(html`<span class="st-pill" style="--sc:#ff5277" data-testid="abyssal-pill">🔥灾变${snap.abyssalHeatTier}阶</span>`);
    }
    const v21StackKey = `${stackKey}|R${snap.coreReactorTier ?? 0}|P${snap.pantheonStage ?? 0}|H${snap.abyssalHeatTier ?? 0}`;
    if (v21StackKey !== this.lastStackKey) {
      this.lastStackKey = v21StackKey;
      render(this.stackRack, pills);
    }

    if (snap.wingmanState) {
      const wm = snap.wingmanState;
      const meta = WINGMAN_META[wm.id];
      const wmKey = `${wm.id}:${wm.formation}`;
      if (wmKey !== this.lastWingmanKey) {
        this.lastWingmanKey = wmKey;
        this.wingmanChip.classList.add('show');
        this.wingmanChip.style.setProperty('--wc', meta.color);
        render(this.wingmanChip, html`<span class="g">${meta.glyph}</span>${meta.short}·<b>${WINGMAN_FORMATION_LABELS[wm.formation].short}</b><small>[F]</small>`);
      }
    } else if (this.lastWingmanKey !== 'none') {
      this.lastWingmanKey = 'none';
      this.wingmanChip.classList.remove('show');
    }

    if (snap.bladesCount > 0) {
      this.bladesChip.classList.add('show');
      const isSeeker = (snap.activeFusions ?? []).includes('seeker_sword_array');
      render(this.bladesChip, html`<span class="g">${isSeeker ? '⚔' : '✦'}</span>${isSeeker ? '浮游剑阵' : '环轨刃'} ×${snap.bladesCount}`);
    } else {
      this.bladesChip.classList.remove('show');
    }
    if (score !== this.lastScore) {
      this.lastScore = score;
      this.scoreEl.textContent = score.toLocaleString('en-US');
    }

    const od = snap.overdriveTimer > 0;
    this.resoFill.style.width = `${(snap.resonance * 100).toFixed(1)}%`;
    this.resoWrap.classList.toggle('od', od);
    const ready = !od && snap.resonance >= 0.999;
    if (ready !== this.resoReady || od) {
      this.resoReady = ready;
      this.resoWrap.classList.toggle('ready', ready);
      this.resoLabel.textContent = od
        ? `⚡ 超载齐射 ${snap.overdriveTimer.toFixed(1)}s`
        : ready
          ? '点击 / 空格 超载'
          : '共鸣';
    } else if (!od && !ready && this.resoLabel.textContent !== '共鸣') {
      this.resoLabel.textContent = '共鸣';
    }
    this.root.classList.toggle('overdrive', od);

    const aegisTimer = snap.aegisTimer ?? 0;
    const aegisCd = snap.aegisCooldown ?? 0;
    const aegisMax = Math.max(1, snap.aegisMaxCooldown ?? 5.5);
    const aegisReady = aegisCd <= 0.01;
    const aegisActive = aegisTimer > 0 && !aegisReady;
    this.aegisBtn.classList.toggle('active', aegisActive);
    this.aegisBtn.classList.toggle('ready', aegisReady);
    const fillPct = aegisActive ? 100 : aegisReady ? 100 : Math.max(0, (1 - aegisCd / aegisMax) * 100);
    this.aegisFill.style.width = `${fillPct.toFixed(1)}%`;
    this.aegisText.textContent = aegisActive
      ? `🛡 力场 ${aegisTimer.toFixed(1)}s`
      : aegisReady
        ? '🛡 脉冲 [E]'
        : `🛡 ${Math.ceil(aegisCd)}s`;

    const jMax = Math.max(1, snap.jumpMaxStocks ?? 3);
    const jStocks = snap.jumpStocks ?? jMax;
    const jCharge = snap.jumpCharge ?? 1;
    const jAirborne = (snap.jumpTimeLeft ?? 0) > 0.05;
    const jStage = snap.jumpSkillStage ?? 0;
    const jReady = jStocks >= 1 || Boolean(snap.isFiringRange);
    const jChainAir = jReady && jAirborne && jStage < 3;
    this.jumpBtn.classList.toggle('ready', jReady);
    this.jumpBtn.classList.toggle('chain-air', jChainAir);
    this.jumpBtn.classList.toggle('soaring', !jReady && jAirborne);
    const jPct = jReady ? 100 : Math.max(0, Math.min(100, jCharge * 100));
    this.jumpFill.style.width = `${jPct.toFixed(1)}%`;
    const jStockTag = jMax > 1 ? ` ×${Math.max(1, jStocks)}` : '';
    const jNextStageLabel = jStage >= 2 ? '三段!' : '二段!';
    this.jumpText.textContent = jChainAir
      ? `🚀 ${jNextStageLabel}${jStockTag} [${this.jumpKeyLabel}]`
      : jReady
        ? `🚀 跃迁${jStockTag} [${this.jumpKeyLabel}]`
        : jAirborne
          ? `🚀 凌空 ${(snap.squadAirY ?? 0).toFixed(1)}m`
          : `🚀 充能 ${Math.round(jCharge * 100)}%`;

    const nukeDrop = snap.nukeDropTimer ?? 0;
    const nukeBlast = snap.nukeBlastTimer ?? 0;
    const nukeCharge = snap.nukeCharge ?? 1;
    const maxStocks = Math.max(1, snap.nukeMaxStocks ?? 3);
    const stocks = snap.nukeStocks ?? (nukeCharge >= 0.999 ? 1 : 0);
    const activeStrikes = snap.nukeStrikes?.length ?? 0;
    const nukeDropping = nukeDrop > 0;
    const nukeBlasting = !nukeDropping && nukeBlast > 0;
    const salvoActive = activeStrikes > 0 || nukeDropping || nukeBlasting;
    const nukeReady = stocks >= 1 || nukeCharge >= 0.999 || Boolean(snap.isFiringRange);
    const salvoHot = nukeReady && salvoActive;
    this.nukeBtn.classList.toggle('dropping', !nukeReady && salvoActive);
    this.nukeBtn.classList.toggle('ready', nukeReady);
    this.nukeBtn.classList.toggle('salvo-hot', salvoHot);
    const nukePct = nukeReady ? 100 : Math.max(0, Math.min(100, nukeCharge * 100));
    this.nukeFill.style.width = `${nukePct.toFixed(1)}%`;
    const estCdSec = Math.max(1, Math.ceil((1 - nukeCharge) * 7.5));
    const stockBadge = maxStocks > 1 ? ` ×${Math.max(1, stocks)}` : '';
    this.nukeText.textContent = salvoHot
      ? `☢ 连发!${stockBadge} [Q]`
      : nukeReady
        ? `☢ 核弹${stockBadge} [Q]`
        : nukeDropping
          ? `☢ 落弹 ${nukeDrop.toFixed(1)}s`
          : `☢ 充能 ${Math.round(nukeCharge * 100)}% (${estCdSec}s)`;

    const b = snap.boss;
    if (b && b.active) {
      this.bossBar.classList.add('show');
      this.progressWrap.classList.add('hide');
      const meta = BOSS_META[b.id];
      const enraged = (b.enrage ?? 1) > 1;
      const brk = b.breakTimer ?? 0;
      const alivePods = (b.parts ?? []).filter((pt) => !pt.destroyed).length;
      const podTag = (b.parts?.length ?? 0) > 0 ? ` · 肩甲${alivePods}/${b.parts!.length}` : '';
      const titanRank = b.titanRank ?? 1;
      const titanTag = titanRank >= 2 ? ` · 巨骸Lv.${titanRank}` : '';
      const totalBars = Math.max(1, b.hpBars ?? 1);
      const hpFrac = Math.max(0, Math.min(1, b.hp / Math.max(1, b.maxHp)));
      const exactBars = hpFrac * totalBars;
      const remBars = b.hp <= 0 ? 0 : Math.max(1, Math.ceil(exactBars));
      const curFill = totalBars <= 1 ? hpFrac : b.hp <= 0 ? 0 : exactBars - (remBars - 1);
      const mutTag = b.abyssalMutation
        ? ` · 🧬${b.abyssalMutation === 'cross_laser_grid' ? '交叉折镜网' : b.abyssalMutation === 'phantom_clone_salvo' ? '镜像分身' : '磁暴潮汐'}`
        : '';
      const omegaTag = (b.omegaOverdrive ? ' · ☄终焉超载' : '') + mutTag;
      this.bossName.textContent =
        brk > 0
          ? `⚡ 破防 2.0× (${brk.toFixed(1)}s) · ${meta.title}`
          : `${meta.title}${titanTag}${podTag}${omegaTag}${enraged && !b.omegaOverdrive ? ' · 狂暴' : ''}`;
      this.bossBar.classList.toggle('enraged', enraged);
      this.bossBar.classList.toggle('broken', brk > 0);
      this.bossBar.dataset.tier = String(totalBars > 1 ? (remBars - 1) % 5 : 0);
      this.bossBar.classList.toggle('multi-bar', totalBars > 1 && remBars > 1);
      const barsBadge = totalBars > 1 ? html`<b class="boss-x" data-testid="boss-bars">×${remBars}</b>` : '';
      render(this.bossPhase, [barsBadge,
        Array.from({ length: b.maxPhases }, (_, i) => html`<i class="${i < b.phase ? 'on' : ''}"></i>`)]);
      this.bossFill.style.width = `${Math.max(0, curFill * 100).toFixed(2)}%`;
      this.bossBar.classList.toggle('shielded', b.shielded && !b.secondaryCore);
      const co = snap.pantheonCoBoss;
      if (co && co.active) {
        this.coBossBar.classList.add('show');
        const coMeta = BOSS_META[co.id];
        const coPct = Math.max(0, Math.min(100, (co.hp / Math.max(1, co.maxHp)) * 100));
        this.coBossName.textContent = `⚔ 协同双神 · ${coMeta.title}${co.shielded ? ' [护盾]' : ''}`;
        this.coBossFill.style.width = `${coPct.toFixed(1)}%`;
      } else {
        this.coBossBar.classList.remove('show');
      }
    } else if (!b) {
      this.coBossBar?.classList.remove('show');
      this.bossBar.classList.remove('show', 'broken');
      this.progressWrap.classList.remove('hide');
    }

    // V23: Nemesis Pursuer Adaptive Polarized Shield HUD Bar
    const nem = snap.nemesis;
    if (nem && nem.hp > 0) {
      this.nemesisBarEl.classList.add('show');
      this.nemesisBarEl.classList.toggle('broken', nem.shieldBroken);
      const wMeta = REWARD_META[nem.adaptedWeapon];
      render(this.nemesisNameEl, nem.shieldBroken
        ? html`⚡ <b>${nem.name}</b> · 偏振盾碎裂（2.1× 易伤窗口！）`
        : html`🐺 <b>${nem.name}</b> · 偏振抗性：<em style="color:${wMeta.color}">[${wMeta.short}]</em> — 按 Tab 切枪或 45° 折镜破盾！`);
      this.nemesisFillEl.style.width = `${Math.max(0, Math.min(100, (nem.hp / Math.max(1, nem.maxHp)) * 100)).toFixed(1)}%`;
    } else {
      this.nemesisBarEl.classList.remove('show', 'broken');
    }

    // V23: 2nd-Order Overlimit Nirvana Burst Charge & Tri-Prism Lattice Indicator
    const fairDisabled = Boolean(snap.fairTrial);
    const nirCharge = fairDisabled ? 0 : Math.max(0, Math.min(1, snap.nirvanaCharge ?? 0));
    const nirActive = !fairDisabled && (snap.nirvanaActiveTimer ?? 0) > 0;
    const latActive = !fairDisabled && (snap.triPrismLatticeTimer ?? 0) > 0;
    const nirReady = !fairDisabled && (nirCharge >= 0.999 || (Boolean(snap.isFiringRange) && !nirActive));
    const nirBursting = nirActive && !nirReady;
    const partnerW = (snap.activeLoadout ?? []).find((w) => w !== snap.weapon) ?? null;
    const arch = resolveNirvanaArchetype(snap.weapon, partnerW);
    const archMeta = NIRVANA_META[arch];
    this.nirvanaBtn.classList.toggle('ready', nirReady);
    this.nirvanaBtn.classList.toggle('active', nirBursting || latActive);
    this.nirvanaBtn.classList.toggle('disabled', fairDisabled);
    this.nirvanaFill.style.width = `${(nirBursting || nirReady ? 100 : nirCharge * 100).toFixed(1)}%`;
    this.nirvanaText.textContent = fairDisabled
      ? '🔒 试炼禁用'
      : nirBursting
        ? `${archMeta.glyph} 奥义释放!`
        : nirReady
          ? `${archMeta.glyph} ${archMeta.short} [${this.nirvanaKeyLabel}]`
          : latActive
            ? `🔺谐振 ${Math.round(nirCharge * 100)}%`
            : `☀️ 奥义 ${Math.round(nirCharge * 100)}%`;

    // V23 Stage 4: Live Combat Breakdown & Refraction Efficiency Donut Pie + Bars
    if (this.liveTelOpen) {
      this.renderLiveTelemetry(snap);
    }
  }

  // ------------------------------------------------------------------ AAA Parabolic Ballistic Combat Numbers
  floatText(x: number, y: number, text: string, cls: string, dur = 0.9, depthScale = 1.0): void {
    const isNumberPop = cls === 'dmg' || cls === 'crit' || (cls === 'chain' && text.startsWith('-'));
    const stageW = this.root.clientWidth || 460;
    const stageH = this.root.clientHeight || 820;
    const safeX = Number.isFinite(x) && x > 1 ? x : stageW * 0.5;
    const safeY = Number.isFinite(y) && y > 1 ? y : stageH * 0.45;
    const adjX = Math.max(68, Math.min(stageW - 68, safeX));
    let adjY = Math.max(212, Math.min(stageH - 245, safeY));

    // Coalesce rapid `连锁 ×N` chain callouts into a single escalating badge so horizon blasts stay crystal-clean!
    if ((cls === 'chain' && text.startsWith('连锁')) || text.startsWith('歼灭')) {
      const existingChain = this.floats.find(
        (q) => q.alive && q.t < 0.65 && (q.el.textContent?.startsWith('连锁') || q.el.textContent?.startsWith('歼灭')) && Math.abs(q.y - adjY) < 110,
      );
      if (existingChain) {
        existingChain.t = 0;
        existingChain.x = adjX;
        existingChain.y = adjY;
        existingChain.el.textContent = text;
        existingChain.el.style.transform = `translate(${adjX.toFixed(1)}px, ${adjY.toFixed(1)}px) translate(-50%, -50%) scale(1.22)`;
        existingChain.el.style.opacity = '1';
        return;
      }
    }

    if (!isNumberPop) {
      const dup = this.floats.find(
        (q) => q.alive && q.t < 0.22 && q.el.textContent === text && Math.abs(q.x - adjX) < 96,
      );
      if (dup) return;
      for (let pass = 0; pass < 5; pass++) {
        const clash = this.floats.some(
          (q) => q.alive && q.t < q.dur * 0.85 && Math.abs(q.x - adjX) < 150 && Math.abs(q.y - adjY) < 36,
        );
        if (!clash) break;
        adjY = adjY + 34 <= stageH - 245 ? adjY + 34 : Math.max(212, adjY - 34);
      }
    }

    let f = this.floats.find((q) => !q.alive);
    if (!f) f = this.floats.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    f.alive = true;
    f.t = 0;
    f.dur = dur;
    f.x = adjX;
    f.y = adjY;
    this.floatFanParity = (this.floatFanParity + 1) % 6;
    if (isNumberPop) {
      const dir = this.floatFanParity % 2 === 0 ? 1 : -1;
      const spread = 32 + (this.floatFanParity % 3) * 24;
      f.vx = dir * spread;
      f.vy = -(138 + (cls === 'crit' ? 42 : 0));
      f.grav = 340;
    } else {
      f.vx = 0;
      f.vy = -58;
      f.grav = 0;
    }
    f.baseScale = Math.max(0.68, Math.min(1.35, depthScale));
    const initScale = (0.55 * f.baseScale).toFixed(3);
    f.el.className = `float ${cls}`;
    f.el.textContent = text;
    f.el.style.transform = `translate(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px) translate(-50%, -50%) scale(${initScale})`;
    f.el.style.opacity = '1';
  }

  updateFloats(dt: number): void {
    const stageW = this.root.clientWidth || 460;
    for (const f of this.floats) {
      if (!f.alive) continue;
      f.t += dt;
      const p = f.t / f.dur;
      if (p >= 1) {
        f.alive = false;
        f.el.style.opacity = '0';
        continue;
      }
      f.x = Math.max(46, Math.min(stageW - 46, f.x + f.vx * dt));
      f.y += f.vy * dt;
      if (f.grav > 0) {
        f.vy += f.grav * dt;
        f.vx *= Math.exp(-2.2 * dt);
      } else {
        f.vy *= Math.exp(-3 * dt);
      }
      const pop = (p < 0.14 ? 0.55 + (p / 0.14) * 0.72 : 1.27 - Math.min(0.32, (p - 0.14) * 0.55)) * f.baseScale;
      f.el.style.transform = `translate(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
      f.el.style.opacity = String(p > 0.68 ? (1 - p) / 0.32 : 1);
    }
  }

  showBanner(html: Content, cls: string, ms = 1600): void {
    this.banner.className = `banner ${cls}`;
    render(this.banner, html);
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.hideBanner(), ms);
  }

  hideBanner(): void {
    this.banner.classList.remove('show');
    if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
    this.bannerTimer = null;
  }

  rewardBanner(reward: RewardId, level: number, stackedCount = 1): void {
    const m = REWARD_META[reward];
    const sub =
      reward === 'blades'
        ? `环绕飞刃 ×${level} · 额外扩编 +6`
        : level > 3
          ? `超限进化叠层 ×${level - 3} · 全军火力再跃升！`
          : stackedCount >= 2
            ? `已激活 ${stackedCount} 重武装同屏协同齐射 · 克制${m.counters}`
            : `${m.desc} · 克制${m.counters}`;
    const kicker =
      reward === 'blades'
        ? 'ORBITAL DEFENSE'
        : level > 3
          ? 'OVERCLOCK STACKED'
          : stackedCount >= 2
            ? `ARSENAL STACK ×${stackedCount}`
            : 'WEAPON ONLINE';
    const titleTxt =
      reward === 'blades'
        ? `${m.name} ×${level}`
        : level > 3
          ? `${m.name} MAX+${level - 3}`
          : `${m.name} Lv.${level}`;
    this.showBanner(
      html`<div class="b-kicker">${kicker}</div><div class="b-title" style="color:${m.color}">${titleTxt}</div><div class="b-sub">${sub}</div>`,
      'reward',
      1250,
    );
  }

  bossWarning(name: string, title: string): void {
    this.showBanner(
      html`<div class="b-warn">⚠ WARNING ⚠</div><div class="b-title">${title}</div><div class="b-sub">${name} 正在接近</div>`,
      'boss',
      2300,
    );
  }

  toast(text: Content, ms = 2600): void {
    render(this.toastEl, text);
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  combo(n: number): void {
    render(this.comboEl, html`<b>${n}</b> 连杀`);
    this.comboEl.classList.remove('show');
    void this.comboEl.offsetWidth;
    this.comboEl.classList.add('show');
    this.comboEl.classList.toggle('hot', n >= 15);
    if (this.comboTimer !== null) clearTimeout(this.comboTimer);
    this.comboTimer = window.setTimeout(() => this.comboEl.classList.remove('show'), 1100);
  }

  showLetterbox(ms = 1450): void {
    this.letterboxEl.classList.add('show');
    if (this.letterboxTimer !== null) clearTimeout(this.letterboxTimer);
    this.letterboxTimer = window.setTimeout(() => {
      this.letterboxEl.classList.remove('show');
      this.letterboxTimer = null;
    }, ms);
  }

  showTacticalVox(tag: string, message: string, color = '#62f4ff', ms = 2200): void {
    this.voxHudEl.style.setProperty('--vc', color);
    this.voxHudEl.querySelector('.vox-tag')!.textContent = tag;
    this.voxHudEl.querySelector('.vox-msg')!.textContent = message;
    this.voxHudEl.classList.add('show');
    if (this.voxTimer !== null) clearTimeout(this.voxTimer);
    this.voxTimer = window.setTimeout(() => {
      this.voxHudEl.classList.remove('show');
      this.voxTimer = null;
    }, ms);
  }

  updatePerfHud(show: boolean, history: Float32Array, stats: { fps: number; drawCalls: number; instances: number }, avgMs: number): void {
    this.perfHudEl.classList.toggle('show', show);
    if (!show) return;
    this.perfLabel.textContent = `${stats.fps}fps ${avgMs.toFixed(1)}ms · DC${stats.drawCalls}`;
    const ctx = this.perfCanvas.getContext('2d');
    if (!ctx) return;
    const w = this.perfCanvas.width;
    const h = this.perfCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(6, 14, 28, 0.72)';
    ctx.fillRect(0, 0, w, h);
    // 16.6ms (60Hz) & 8.3ms (120Hz) reference lines
    ctx.fillStyle = 'rgba(98, 244, 255, 0.22)';
    ctx.fillRect(0, Math.round(h - (16.67 / 33.3) * h), w, 1);
    const barW = w / history.length;
    for (let i = 0; i < history.length; i++) {
      const ms = history[i] || 16.0;
      const bh = Math.max(2, Math.min(h - 2, (ms / 33.3) * h));
      ctx.fillStyle = ms <= 18.0 ? '#19f5a8' : ms <= 25.0 ? '#ffd84a' : '#ff3b5c';
      ctx.fillRect(i * barW, h - bh, Math.max(1.5, barW - 0.8), bh);
    }
  }

  showReplayHud(
    show: boolean,
    progress = 0,
    markers?: ReadonlyArray<{ tick: number; label: string; kind: string }>,
    totalTicks = 1,
  ): void {
    this.replayHudEl.classList.toggle('show', show);
    if (show) {
      this.replayHudEl.querySelector('.rp-prog')!.textContent = `${Math.round(progress * 100)}%`;
      const slider = this.replayHudEl.querySelector<HTMLInputElement>('[data-testid=rp-timeline]');
      if (slider) slider.value = String(Math.round(progress * 1000));
      if (markers) {
        const mkBox = this.replayHudEl.querySelector<HTMLElement>('[data-testid=rp-markers]');
        if (mkBox) {
          render(mkBox, markers
            .slice(0, 6)
            .map((m) => {
              const frac = Math.max(0, Math.min(1, m.tick / Math.max(1, totalTicks)));
              return html`<button class="rp-mk" data-frac="${frac.toFixed(4)}" title="跳转至：${m.label}">${m.label}</button>`;
            }));
          mkBox.querySelectorAll<HTMLButtonElement>('.rp-mk').forEach((btn) => {
            btn.addEventListener('click', () => this.cb.onReplaySeek(Number(btn.dataset.frac || 0)));
          });
        }
      }
    }
  }

  setKeybindLabels(map: KeybindMap): void {
    this.nirvanaKeyLabel = formatKeyLabel(map.nirvanaBurst || 'g');
    this.jumpKeyLabel = formatKeyLabel(map.skyJump || 'w');
  }

  pulseNirvanaNotReady(): void {
    this.nirvanaBtn.classList.remove('not-ready-shake');
    void this.nirvanaBtn.offsetWidth;
    this.nirvanaBtn.classList.add('not-ready-shake');
  }

  /** Blinding celestial core flash + divine archetype edge halo vignette for 2nd-Order Overlimit Nirvana! */
  doNirvanaFlash(arch: NirvanaArchetype, strength = 1.0): void {
    const scaled = Math.min(1, strength * this.flashScale);
    if (scaled <= 0.01) return;
    if (this.nukeScorchTimer !== null) {
      clearTimeout(this.nukeScorchTimer);
      this.nukeScorchTimer = null;
    }
    this.flash.style.background =
      arch === 'singularity_supernova'
        ? 'radial-gradient(circle at 50% 42%, rgba(255,252,255,0.98) 0%, rgba(226,142,255,0.92) 48%, rgba(255,168,54,0.85) 100%)'
        : arch === 'absolute_zero_storm'
          ? 'radial-gradient(circle at 50% 42%, rgba(252,255,255,0.98) 0%, rgba(132,248,255,0.92) 48%, rgba(42,136,255,0.85) 100%)'
          : 'radial-gradient(circle at 50% 42%, rgba(255,255,248,0.98) 0%, rgba(255,232,118,0.92) 48%, rgba(62,243,255,0.85) 100%)';
    this.flash.style.transition = 'none';
    this.flash.style.opacity = String(Math.min(0.95, scaled * 0.94));
    void this.flash.offsetWidth;
    this.flash.style.transition = 'opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1)';
    this.flash.style.opacity = '0';

    this.nukeScorch.style.background =
      arch === 'singularity_supernova'
        ? 'radial-gradient(circle at 50% 44%, rgba(255,245,255,0.0) 24%, rgba(214,104,255,0.44) 72%, rgba(255,152,38,0.86) 100%)'
        : arch === 'absolute_zero_storm'
          ? 'radial-gradient(circle at 50% 44%, rgba(240,255,255,0.0) 24%, rgba(84,242,255,0.44) 72%, rgba(24,108,255,0.86) 100%)'
          : 'radial-gradient(circle at 50% 44%, rgba(255,252,225,0.0) 24%, rgba(255,216,74,0.46) 72%, rgba(62,243,255,0.86) 100%)';
    this.nukeScorch.style.boxShadow =
      arch === 'singularity_supernova'
        ? 'inset 0 0 140px rgba(218, 108, 255, 0.92)'
        : arch === 'absolute_zero_storm'
          ? 'inset 0 0 140px rgba(84, 242, 255, 0.92)'
          : 'inset 0 0 140px rgba(255, 224, 92, 0.92)';
    this.nukeScorch.style.transition = 'none';
    this.nukeScorch.style.opacity = String(Math.min(0.9, scaled * 0.86));
    void this.nukeScorch.offsetWidth;
    this.nukeScorch.style.transition = 'opacity 2.2s ease-out';
    this.nukeScorch.style.opacity = '0';
  }

  doFlash(color: string, strength = 0.6): void {
    const scaled = strength * this.flashScale;
    if (scaled <= 0.01) return;
    this.flash.style.background = color;
    this.flash.style.transition = 'none';
    this.flash.style.opacity = String(scaled);
    void this.flash.offsetWidth;
    this.flash.style.transition = 'opacity 0.45s ease-out';
    this.flash.style.opacity = '0';
  }

  /** Multi-stage thermonuclear core flash -> multi-spectrum radiation vignette cycling across chain salvos */
  doNukeFlash(strength = 1.0, salvoIndex = 1): void {
    const scaled = Math.min(1, strength * this.flashScale);
    if (scaled <= 0.01) return;
    if (this.nukeScorchTimer !== null) {
      clearTimeout(this.nukeScorchTimer);
      this.nukeScorchTimer = null;
    }
    const pIdx = (Math.max(1, salvoIndex) - 1) % 3;
    // Stage 1: Blinding core flash that clears swiftly (~260ms) so the mushroom cloud, orbital beam & screen quake shine!
    this.flash.style.background =
      pIdx === 1
        ? 'radial-gradient(circle at 50% 42%, rgba(248,255,255,0.98) 0%, rgba(130,248,255,0.94) 48%, rgba(36,120,255,0.86) 100%)'
        : pIdx === 2
          ? 'radial-gradient(circle at 50% 42%, rgba(255,248,255,0.98) 0%, rgba(255,150,255,0.94) 48%, rgba(168,36,255,0.86) 100%)'
          : 'radial-gradient(circle at 50% 42%, rgba(255,255,248,0.98) 0%, rgba(255,238,165,0.94) 48%, rgba(255,126,28,0.86) 100%)';
    this.flash.style.transition = 'none';
    this.flash.style.opacity = String(Math.min(0.96, scaled * 0.96));
    void this.flash.offsetWidth;
    this.flash.style.transition = 'opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1)';
    this.flash.style.opacity = '0';

    // Stage 2: Searing radiation edge vignette matched to the active warhead spectrum!
    this.nukeScorch.style.background =
      pIdx === 1
        ? 'radial-gradient(circle at 50% 42%, rgba(220,255,255,0.0) 18%, rgba(46,232,255,0.48) 68%, rgba(18,78,255,0.88) 100%)'
        : pIdx === 2
          ? 'radial-gradient(circle at 50% 42%, rgba(255,230,255,0.0) 18%, rgba(255,66,245,0.48) 68%, rgba(128,18,235,0.88) 100%)'
          : 'radial-gradient(circle at 50% 42%, rgba(255,248,210,0.0) 18%, rgba(255,148,28,0.48) 68%, rgba(255,42,16,0.88) 100%)';
    this.nukeScorch.style.boxShadow =
      pIdx === 1
        ? 'inset 0 0 135px rgba(56, 228, 255, 0.92)'
        : pIdx === 2
          ? 'inset 0 0 135px rgba(242, 64, 255, 0.92)'
          : 'inset 0 0 135px rgba(255, 118, 24, 0.92)';
    this.nukeScorch.style.transition = 'none';
    this.nukeScorch.style.opacity = String(Math.min(0.92, scaled * 0.88));
    void this.nukeScorch.offsetWidth;
    this.nukeScorch.style.transition = 'opacity 0.24s ease-out';
    this.nukeScorch.style.opacity = String(Math.min(0.68, scaled * 0.64));
    this.nukeScorchTimer = window.setTimeout(() => {
      this.nukeScorchTimer = null;
      // Secondary pulse on shockwave Wave 2 slam, then long organic thermal decay
      this.nukeScorch.style.transition = 'none';
      this.nukeScorch.style.opacity = String(Math.min(0.86, scaled * 0.80));
      void this.nukeScorch.offsetWidth;
      this.nukeScorch.style.transition = 'opacity 1.65s ease-out';
      this.nukeScorch.style.opacity = '0';
    }, 240);
  }

  hurt(): void {
    this.vignette.classList.remove('hit');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('hit');
  }

  // ------------------------------------------------------------------ results
  showResult(r: ResultData, onStar: (i: number) => void): void {
    this.hideBanner();
    this.toastEl.classList.remove('show');
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.nukeScorchTimer !== null) {
      clearTimeout(this.nukeScorchTimer);
      this.nukeScorchTimer = null;
    }
    this.nukeScorch.style.transition = 'none';
    this.nukeScorch.style.opacity = '0';
    for (const f of this.floats) {
      f.alive = false;
      f.el.style.opacity = '0';
    }
    this.pauseEl.classList.remove('show');
    const meta = SECTOR_META[r.sector];
    const mm = Math.floor(r.stats.time / 60);
    const ss = Math.floor(r.stats.time % 60).toString().padStart(2, '0');
    const reason = r.reason ? DEFEAT_META[r.reason] : null;
    const finale = r.victory && r.sector === 3 && !r.blitz;
    const isEndless = r.endless !== undefined;
    const isBlitz = r.blitz === true;
    const medalsHtml =
      r.unlockedMedals && r.unlockedMedals.length
        ? html`<div class="r-medals">${r.unlockedMedals
            .map((m) => html`<span style="--mc:${m.color}">${m.glyph} 勋章「${m.name}」+${CORE_GLYPH}${m.reward}</span>`)}</div>`
        : '';
    const archHtml = r.archetype
      ? html`<div class="r-arch" data-testid="result-archetype" style="--ac:${r.archetype.color}">
          <span class="ra-glyph">${r.archetype.glyph}</span>
          <div class="ra-body"><b>${r.archetype.title}</b><small>${r.archetype.tags}</small></div>
        </div>`
      : '';
    const dmgHtml =
      r.damageBreakdown && r.damageBreakdown.length > 0
        ? html`<div class="r-dmg" data-testid="damage-breakdown">
            <div class="rd-head"><span>伤害构成战报</span><span>输出占比</span></div>
            ${r.damageBreakdown
              .map(
                (row) => html`<div class="rd-row">
                  <span class="rd-lbl" style="color:${row.color}">${row.glyph} ${row.label}</span>
                  <div class="rd-bar"><i style="width:${row.pct}%;background:${row.color}"></i></div>
                  <b class="rd-val">${row.damage.toLocaleString('en-US')} <small>${row.pct}%</small></b>
                </div>`,
              )}
          </div>`
        : '';

    render(this.resultEl, html`
      <div class="panel result-panel ${r.victory ? 'win' : 'lose'}">
        <div class="r-kicker">${r.fairTrial ? 'FAIR TRIAL #202611 · 零工坊纯技术榜' : isBlitz ? 'OVERLIMIT BLITZ · 极速闪击' : isEndless ? 'ENDLESS PROTOCOL · 无尽协议' : meta.subtitle}</div>
        <h2 class="r-title">${r.extracted ? '🚁 赏金安全撤离' : r.fairTrial ? (r.victory ? '⚖ 公平试炼制霸' : '试炼信号中断') : isEndless ? '无尽信号中断' : isBlitz ? (r.victory ? '🏆 极速闪击制霸' : '闪击行动中断') : r.victory ? (finale ? '奇点终结 · 全线通关' : '区域突破') : '蜂群信号丢失'}</h2>
        ${r.victory ? html`<div class="stars">${[0, 1, 2].map((i) => html`<span class="star" data-i="${i}">★</span>`)}</div>` : html`
          <div class="defeat-box" data-testid="defeat-reason">
            <div class="d-title">${reason?.title ?? ''}</div>
            <div class="d-tip">💡 ${reason?.tip ?? ''}</div>
            ${r.bossHpFrac !== null ? html`<div class="d-prog boss"><div style="width:${Math.round(r.bossHpFrac * 100)}%"></div><span>首领剩余血量 ${Math.max(1, Math.round(r.bossHpFrac * 100))}%${r.bossHpFrac < 0.35 ? ' · 差一点！' : ''}</span></div>` : html`<div class="d-prog"><div style="width:${Math.round(r.progress * 100)}%"></div><span>推进 ${Math.round(r.progress * 100)}%</span></div>`}
          </div>`}
        <div class="r-score"><span>得分</span><b data-testid="result-score">0</b>${r.newBest ? html`<em>新纪录!</em>` : html`<small>最佳 ${r.best.toLocaleString('en-US')}</small>`}</div>
        ${archHtml}
        ${
          r.highlights
            ? html`<div class="r-hi-strip" data-testid="result-highlights">
                <span>⚡ 破甲 <b>${r.highlights.partsBroken}</b></span>
                <span>☄ 棱球反击 <b>${r.highlights.orbsReflected}</b></span>
                <span>🛡 弹反 <b>${r.highlights.parries}</b></span>
                <span>#${r.highlights.seed}</span>
              </div>`
            : ''
        }
        ${
          r.replayVerified !== undefined
            ? html`<div class="r-replay-badge ${r.replayVerified ? 'ok' : ''}" data-testid="replay-verify-badge">
                ${r.replayVerified ? `✓ 确定性帧级校验一致 · ${r.replayTicks ?? 0} 帧零偏差` : '⚠ 回放校验待同步'}
              </div>`
            : ''
        }
        ${dmgHtml}
        <div class="r-stats">
          ${r.endless ? html`
            <div class="r-endless-wave"><span>抵达阶段${r.endless.newWaveBest ? ' · 新纪录' : ''}</span><b data-testid="result-wave">${r.endless.wave}</b></div>
            <div><span>击破首领</span><b>${r.endless.bosses}</b></div>
            <div><span>推进距离</span><b>${Math.round(r.endless.distance)}m</b></div>
            <div><span>最佳阶段</span><b>${r.endless.bestWave}</b></div>
            <div><span>击杀</span><b>${r.stats.kills}</b></div>
            <div><span>峰值蜂群</span><b>${r.stats.peakSquad}</b></div>
            <div><span>最高连杀</span><b>${r.maxCombo}</b></div>
            <div><span>存活时间</span><b>${mm}:${ss}</b></div>` : html`
            <div><span>剩余蜂群</span><b data-testid="result-squad">${r.stats.finalSquad}</b></div>
            <div><span>峰值蜂群</span><b>${r.stats.peakSquad}</b></div>
            <div><span>击杀</span><b>${r.stats.kills}</b></div>
            <div><span>改善数字门</span><b>${r.stats.gatesImproved}</b></div>
            <div><span>击破能量舱</span><b>${r.stats.vaultsCracked}</b></div>
            <div><span>爆炸连锁</span><b>${r.stats.maxChain}</b></div>
            <div><span>最高连杀</span><b>${r.maxCombo}</b></div>
            <div><span>用时</span><b>${mm}:${ss}</b></div>`}
        </div>
        ${medalsHtml}
        ${r.challenges.length ? html`<div class="r-ch" data-testid="result-challenges">${r.challenges.map((c) => html`<div class="${c.done ? 'ok' : ''}${c.isNew ? ' new' : ''}"><i>${c.done ? '✓' : '○'}</i>${c.text}<b>${c.isNew ? `+${c.reward}` : c.done ? '已完成' : `${CORE_GLYPH}${c.reward}`}</b></div>`)}</div>` : html`<div class="r-ch" data-testid="result-challenges"></div>`}
        <div class="r-cores" data-testid="result-cores">
          <div class="rc-main"><i>${CORE_GLYPH}</i> +<b>${r.cores.total}</b> 晶核 <small>（共 ${r.cores.balance.toLocaleString('en-US')}）</small></div>
          <div class="rc-lines">${r.cores.lines.filter(([k]) => !k.startsWith('挑战·') && !k.startsWith('勋章·')).map(([k, v]) => html`<span>${k} +${v}</span>`)}${r.challenges.some((c) => c.isNew) ? html`<span>挑战奖励（见上）</span>` : ''}</div>
          ${r.cores.affordable ? html`<div class="rc-tip">可在主页「强化工坊」升级蜂群！</div>` : ''}
        </div>
        ${r.victory && !isEndless ? html`<div class="r-goal">★★ 剩余 ≥ ${isBlitz ? 85 : meta.starSquad[0]}　★★★ 剩余 ≥ ${isBlitz ? 180 : meta.starSquad[1]}</div>` : ''}
        ${isEndless ? html`<div class="result-ranking" data-testid="result-ranking"></div>` : ''}
        <div class="r-btns">
          ${r.expedition && r.victory && !r.expeditionCompleted ? html`<button class="big-btn" data-testid="expedition-next-btn">🌌 返回星图 · 推进下一节点 ▶</button>` : ''}
          ${r.hasNext ? html`<button class="big-btn" data-testid="next-btn">下一关 ▶</button>` : ''}
          <button class="${r.hasNext ? 'mid-btn' : 'big-btn'}" data-testid="retry-btn">${isBlitz ? '再战闪击' : isEndless ? '再战无尽' : r.victory ? (r.sector === 4 ? '新布局再战' : '再战一次') : '重新挑战'}</button>
          ${r.hasTacticalReplay ? html`<button class="mid-btn seed-btn" data-testid="watch-replay-btn">🎬 观看战术回放</button>` : ''}
          ${r.canReplaySeed ? html`<button class="mid-btn seed-btn" data-testid="replay-seed-btn">🔁 同种子复盘</button>` : ''}
          <button class="mid-btn ghost" data-testid="result-home-btn">返回主页</button>
        </div>
      </div>`);
    this.resultEl.classList.add('show');
    this.resultEl.querySelector('[data-testid=expedition-next-btn]')?.addEventListener('click', () => {
      this.hideResult();
      this.cb.onOpenExpedition();
    });
    this.resultEl.querySelector('[data-testid=next-btn]')?.addEventListener('click', () => this.cb.onNext());
    this.resultEl.querySelector('[data-testid=retry-btn]')!.addEventListener('click', () => this.cb.onRetry());
    this.resultEl.querySelector('[data-testid=watch-replay-btn]')?.addEventListener('click', () => this.cb.onWatchReplay());
    this.resultEl.querySelector('[data-testid=replay-seed-btn]')?.addEventListener('click', () => this.cb.onReplaySeed());
    this.resultEl.querySelector('[data-testid=result-home-btn]')!.addEventListener('click', () => this.cb.onHome());

    const scoreEl = this.resultEl.querySelector<HTMLElement>('[data-testid=result-score]')!;
    const start = performance.now();
    const dur = 900;
    const tick = (): void => {
      const p = Math.min(1, (performance.now() - start) / dur);
      scoreEl.textContent = Math.round(r.score * (1 - Math.pow(1 - p, 3))).toLocaleString('en-US');
      if (p < 1 && this.resultEl.classList.contains('show')) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    if (r.victory) {
      const stars = this.resultEl.querySelectorAll<HTMLElement>('.star');
      stars.forEach((s, i) => {
        if (i < r.stars) {
          window.setTimeout(() => {
            s.classList.add('on');
            onStar(i);
          }, 450 + i * 380);
        }
      });
    }
  }

  restoreResult(): void {
    this.resultEl.classList.add('show');
  }

  hideResult(): void {
    this.resultEl.classList.remove('show');
  }

  get weaponName(): (w: WeaponId) => string {
    return (w) => REWARD_META[w].name;
  }

  showAbyssal(v: boolean): void {
    this.abyssalEl.classList.toggle('show', v);
    if (v && this.lastSave) this.renderAbyssal(this.lastSave);
  }

  renderAbyssal(save: SaveData): void {
    this.lastSave = save;
    const pacts = save.abyssal?.activePacts ?? [];
    const activeSet = new Set(pacts);
    const heat = computeAbyssalHeatTier(pacts);
    const bonusPct = heat * 15;
    const maxCleared = save.abyssal?.maxHeatCleared ?? 0;

    const badgeEl = this.title.querySelector('[data-testid=heat-tier-badge]');
    const subEl = this.title.querySelector('[data-testid=heat-bonus-badge]');
    const entryBtn = this.title.querySelector('[data-testid=heat-btn]');
    if (badgeEl) badgeEl.textContent = `灾变 ${heat}/10 阶`;
    if (subEl) {
      subEl.textContent =
        heat > 0
          ? `晶核与得分 +${bonusPct}%${heat >= 4 ? ' · 🧬首领变异已激活' : ''} · 最高制霸 ${maxCleared} 阶`
          : `最高制霸 ${maxCleared}/10 阶 · 点击定制灾变契约 ▸`;
    }
    entryBtn?.classList.toggle('active', heat > 0);

    if (!this.abyssalEl) return;
    const meter = this.abyssalEl.querySelector('[data-testid=abyssal-meter]')!;
    render(meter, html`
      <div class="ab-top">
        <span>当前灾变热度：<b style="color:${heat >= 4 ? '#ff4b78' : '#ffd84a'}">${heat} / 10 阶</b></span>
        <em>收益加成 +${bonusPct}% 晶核 & 得分</em>
      </div>
      <div class="ab-pips">${Array.from({ length: 10 }, (_, i) => html`<i class="${i < heat ? (i >= 3 ? 'apex' : 'on') : ''}"></i>`)}</div>
      <div class="ab-mut-hint">${heat >= 4 ? '🔥 已达 4 阶阈值：首领【灾变变异招式库】（交叉折镜网 / 镜像分身 / 磁暴潮汐）已激活！' : '💡 提示：热度达到 4 阶将解锁三大首领专属【灾变变异招式】与高阶勋章（公平试炼自动隔离）'}</div>`);

    const list = this.abyssalEl.querySelector('[data-testid=abyssal-pact-list]')!;
    render(list, ABYSSAL_PACTS.map((p) => {
      const on = activeSet.has(p.id);
      return html`<button class="abyss-pact-card${on ? ' on' : ''}" style="--pc:${p.color}" data-pact="${p.id}" data-testid="pact-${p.id}">
        <span class="ap-glyph">${p.glyph}</span>
        <span class="ap-body"><b>${p.name}</b><small>${p.desc}</small></span>
        <span class="ap-heat">+${p.heat}🔥</span>
      </button>`;
    }));
    list.querySelectorAll<HTMLButtonElement>('[data-pact]').forEach((btn) => {
      btn.addEventListener('click', () => this.cb.onTogglePact(btn.dataset.pact as AbyssalPactId));
    });

    const skinNote = this.abyssalEl.querySelector('[data-testid=abyssal-skin-note]')!;
    render(skinNote, html`🎨 灾变流光涂装里程碑：<span class="${maxCleared >= 2 ? 'ok' : ''}">2阶·深渊紫电</span> · <span class="${maxCleared >= 5 ? 'ok' : ''}">5阶·耀斑棱金</span> · <span class="${maxCleared >= 8 ? 'ok' : ''}">8阶·虚空极光</span>`);
  }

  updateGhostDelta(show: boolean, deltaSec = 0, label = 'PB幽灵'): void {
    if (!this.ghostDeltaEl) return;
    this.ghostDeltaEl.classList.toggle('show', show);
    if (!show) return;
    const ahead = deltaSec <= 0;
    const sign = deltaSec <= 0 ? '-' : '+';
    this.ghostDeltaEl.classList.toggle('ahead', ahead);
    this.ghostDeltaEl.classList.toggle('behind', !ahead);
    this.ghostDeltaEl.textContent = `👻 ${label} ${ahead ? '领先' : '落后'} ${sign}${Math.abs(deltaSec).toFixed(2)}s`;
  }


  setLiveTelemetryOpen(open: boolean): void {
    this.liveTelOpen = open;
    this.liveTelToggleBtn?.classList.toggle('on', open);
    this.liveTelPanel?.classList.toggle('show', open);
  }

  private renderLiveTelemetry(snap: SimSnapshot): void {
    const src = snap.damageBySource ?? {};
    const leadDmg = Math.max(0, src[snap.weapon] ?? 0);
    let coDmg = 0;
    for (const w of ['pulse', 'scatter', 'rail', 'plasma', 'cryo'] as WeaponId[]) {
      if (w !== snap.weapon) coDmg += Math.max(0, src[w] ?? 0);
    }
    const refBoost = Math.max(0, snap.refractionDmgTotal ?? 0);
    const latFus = Math.max(0, (src.fusions ?? 0) + (src.blades ?? 0) + (snap.latticeDmgTotal ?? 0));
    const nirExp = Math.max(0, (src.explosives ?? 0) + (src.deflect ?? 0) + (snap.nirvanaDmgTotal ?? 0));
    const total = Math.max(1, leadDmg + coDmg + refBoost + latFus + nirExp);
    const rows: Array<[string, number, string]> = [
      ['主炮直击', Math.max(0, leadDmg - refBoost * 0.45), '#3ef3ff'],
      ['副武齐射', coDmg, '#7dff9a'],
      ['折射增幅', refBoost, '#ffe46b'],
      ['谐振/聚变', latFus, '#c98bff'],
      ['奥义/爆破', nirExp, '#ff6b8b'],
    ];
    const sumClean = Math.max(1, rows.reduce((acc, r) => acc + r[1], 0));
    let degAcc = 0;
    const stops = rows
      .map(([, val, col]) => {
        const span = (val / sumClean) * 360;
        const s = `${col} ${degAcc.toFixed(1)}deg ${(degAcc + span).toFixed(1)}deg`;
        degAcc += span;
        return s;
      })
      .join(', ');
    const refEffPct = Math.min(99, Math.round(((refBoost + (snap.latticeDmgTotal ?? 0)) / Math.max(1, total)) * 100));
    render(this.liveTelPanel, html`
      <div class="lt-head">
        <div class="lt-pie"><i></i></div>
        <div class="lt-meta">
          <b>实时伤害构成</b>
          <small>棱镜折射效率 <em>${refEffPct}%</em></small>
        </div>
      </div>
      <div class="lt-bars">
        ${rows
          .map(([lbl, val, col]) => {
            const pct = Math.round((val / sumClean) * 100);
            return html`<div class="lt-row"><span>${lbl}</span><div class="lt-track"><i style="width:${pct}%;background:${col}"></i></div><b>${pct}%</b></div>`;
          })}
      </div>`);
    this.liveTelPanel.querySelector<HTMLElement>('.lt-pie')!.style.backgroundImage = `conic-gradient(${stops})`;
  }

  private buildV23Modals(): void {
    // 1. Stage 1: 3A Holographic Free-Cam Photo Mode Overlay
    this.photoHudEl = el('div', 'photo-hud');
    this.photoHudEl.dataset.testid = 'photo-hud';
    this.photoHudEl.dataset.uiBlock = '1';
    render(this.photoHudEl, html`
      <div class="ph-top-bar">
        <span class="ph-badge">📸 3A HOLOGRAPHIC PHOTO STUDIO · 战局已冻结</span>
        <div class="ph-top-btns">
          <button class="mid-btn" data-testid="photo-hide-ui-btn">👁 隐藏UI [H]</button>
          <button class="mid-btn" data-testid="photo-snap-btn">💾 导出高清截帧</button>
          <button class="mid-btn ghost" data-testid="photo-exit-btn">退出 [P]</button>
        </div>
      </div>
      <div class="ph-reticle" aria-hidden="true"><span></span></div>
      <div class="ph-bottom-bar">
        <div class="ph-sliders">
          <label>环绕 Yaw <input type="range" min="-180" max="180" value="28" data-testid="photo-yaw-slider" /></label>
          <label>俯仰 Pitch <input type="range" min="-18" max="65" value="22" data-testid="photo-pitch-slider" /></label>
          <label>焦距 FOV <input type="range" min="28" max="82" value="52" data-testid="photo-fov-slider" /></label>
        </div>
        <div class="ph-filters">
          <span>赛博滤镜：</span>
          <button class="ph-flt on" data-pfilter="neon_raw" data-testid="pfilter-neon_raw">霓虹原色</button>
          <button class="ph-flt" data-pfilter="noir_gold" data-testid="pfilter-noir_gold">黑金矩阵</button>
          <button class="ph-flt" data-pfilter="glitch_scan" data-testid="pfilter-glitch_scan">故障扫描线</button>
        </div>
      </div>
      <button class="ph-restore-chip" data-testid="photo-restore-ui-btn">👁 显示拍照面板 [H]</button>`);
    this.root.appendChild(this.photoHudEl);

    const yawS = this.photoHudEl.querySelector<HTMLInputElement>('[data-testid=photo-yaw-slider]')!;
    const pitchS = this.photoHudEl.querySelector<HTMLInputElement>('[data-testid=photo-pitch-slider]')!;
    const fovS = this.photoHudEl.querySelector<HTMLInputElement>('[data-testid=photo-fov-slider]')!;
    yawS.addEventListener('input', () => this.cb.onPhotoParamsChange({ yaw: Number(yawS.value) }));
    pitchS.addEventListener('input', () => this.cb.onPhotoParamsChange({ pitch: Number(pitchS.value) }));
    fovS.addEventListener('input', () => this.cb.onPhotoParamsChange({ fov: Number(fovS.value) }));
    this.photoHudEl.querySelectorAll<HTMLButtonElement>('.ph-flt').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.photoHudEl.querySelectorAll('.ph-flt').forEach((b) => b.classList.toggle('on', b === btn));
        this.cb.onPhotoParamsChange({ filter: btn.dataset.pfilter as PhotoFilterKind });
      });
    });
    this.photoHudEl.querySelector('[data-testid=photo-hide-ui-btn]')!.addEventListener('click', () => this.togglePhotoCleanView());
    this.photoHudEl.querySelector('[data-testid=photo-restore-ui-btn]')!.addEventListener('click', () => this.togglePhotoCleanView(false));
    this.photoHudEl.querySelector('[data-testid=photo-snap-btn]')!.addEventListener('click', () => this.cb.onCapturePhoto());
    this.photoHudEl.querySelector('[data-testid=photo-exit-btn]')!.addEventListener('click', () => this.cb.onExitPhotoMode());

    // Drag anywhere on photo reticle area to orbit 360° smoothly!
    let pDrag = false;
    let lastPX = 0;
    let lastPY = 0;
    this.photoHudEl.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, input, label')) return;
      pDrag = true;
      lastPX = e.clientX;
      lastPY = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (!pDrag || !this.photoHudEl.classList.contains('show')) return;
      const dx = e.clientX - lastPX;
      const dy = e.clientY - lastPY;
      lastPX = e.clientX;
      lastPY = e.clientY;
      const nextYaw = (((Number(yawS.value) + dx * 0.45 + 540) % 360) - 180);
      const nextPitch = Math.max(-18, Math.min(65, Number(pitchS.value) + dy * 0.32));
      yawS.value = nextYaw.toFixed(1);
      pitchS.value = nextPitch.toFixed(1);
      this.cb.onPhotoParamsChange({ yaw: nextYaw, pitch: nextPitch });
    });
    window.addEventListener('pointerup', () => { pDrag = false; });

    // 2. Stage 2: 3-Act Branching Sector Expedition Star-Chart Modal
    this.expeditionEl = el('div', 'screen modal expedition-screen');
    this.expeditionEl.dataset.testid = 'expedition-screen';
    this.expeditionEl.dataset.uiBlock = '1';
    render(this.expeditionEl, html`
      <div class="panel exp-panel">
        <div class="ws-head">
          <h2>🌌 星区远征 · 三幕分支星图</h2>
          <button class="respec-btn" data-testid="expedition-reset-btn">↺ 重置新星图</button>
        </div>
        <div class="exp-carry-bar" data-testid="expedition-carry-bar"></div>
        <div class="exp-star-chart" data-testid="expedition-star-chart"></div>
        <div class="exp-relic-rack" data-testid="expedition-relic-rack"></div>
        <button class="big-btn ghost" data-testid="expedition-close">返回主页</button>
      </div>`);
    this.root.appendChild(this.expeditionEl);
    this.expeditionEl.querySelector('[data-testid=expedition-close]')!.addEventListener('click', () => this.showExpedition(false));
    this.expeditionEl.querySelector('[data-testid=expedition-reset-btn]')!.addEventListener('click', () => this.cb.onResetExpedition());

    // 3. Stage 5: Custom Track & Challenge Editor ("全息关卡工坊")
    this.editorEl = el('div', 'screen modal editor-screen');
    this.editorEl.dataset.testid = 'editor-screen';
    this.editorEl.dataset.uiBlock = '1';
    render(this.editorEl, html`
      <div class="panel ed-panel">
        <div class="ws-head">
          <h2 class="editor-panel-title">🛠 全息关卡工坊</h2>
          <div class="ed-presets">
            <button class="respec-btn" data-ed-preset="0" data-testid="editor-preset-0">预设A·折镜迷宫</button>
            <button class="respec-btn" data-ed-preset="1" data-testid="editor-preset-1">预设B·断桥猎场</button>
            <button class="respec-btn" data-testid="editor-clear-items">清空摆件</button>
          </div>
        </div>
        <div class="ed-meta-row">
          <input type="text" class="ed-title-inp" data-testid="editor-title-input" maxlength="24" value="棱镜折跃试炼场" />
          <select class="ed-sel" data-testid="editor-boss-select">
            <option value="warden_01">首领：赤焰魔像王</option>
            <option value="hydra_02">首领：双生魔龙</option>
            <option value="omega_zero">首领：深渊魔王</option>
          </select>
          <label class="ed-chk"><input type="checkbox" data-testid="editor-nemesis-chk" checked /> 🐺零号猎犬乱入</label>
        </div>
        <div class="ed-palette" data-testid="editor-palette">
          <button class="ed-tool on" data-tool="reflector">🪞45°折镜</button>
          <button class="ed-tool" data-tool="lens">🔆黄金透镜</button>
          <button class="ed-tool" data-tool="mag_rail">⚡电磁滑轨</button>
          <button class="ed-tool" data-tool="cap_tower">🔋电容塔</button>
          <button class="ed-tool" data-tool="bridge_gap">🌉磁浮断桥</button>
          <button class="ed-tool" data-tool="high_spire">🗼高台棱塔</button>
          <button class="ed-tool" data-tool="gate_pair">🚪双选数字门</button>
          <button class="ed-tool" data-tool="vault">📦武器能量舱</button>
          <button class="ed-tool" data-tool="enemy_wave">👾精英怪潮</button>
        </div>
        <div class="ed-sub-opts">
          <label>折镜角 <b data-testid="editor-angle-val">+36°</b> <input type="range" min="-55" max="55" value="36" data-testid="editor-angle-slider" /></label>
          <select class="ed-sel" data-testid="editor-enemy-select">
            <option value="phalanx">电磁盾卫尸</option>
            <option value="glacier">霜甲巨像</option>
            <option value="beholder">棱光狙击眼</option>
            <option value="howler">狂怒战嚎尸</option>
            <option value="bomber">爆裂自爆尸</option>
            <option value="necromancer">纳米织网者</option>
          </select>
        </div>
        <div class="ed-canvas-wrap">
          <canvas id="track-editor-canvas" data-testid="track-editor-canvas" width="440" height="210"></canvas>
          <div class="ed-canvas-hint">点击跑道网格放置当前机关/怪潮 · 再次点击已有节点即可移除（横轴=车道X，纵轴=推进距离m）</div>
        </div>
        <div class="ed-share-row">
          <input type="text" class="ed-code-inp" data-testid="editor-code-input" placeholder="粘贴或导出 PZ23-... 挑战分享码" />
          <button class="mid-btn" data-testid="editor-export-btn">📤 生成分享码</button>
          <button class="mid-btn" data-testid="editor-import-btn">📥 导入解析</button>
        </div>
        <div class="ed-foot-btns">
          <button class="big-btn" data-testid="editor-play-btn">▶ 实机试玩验证</button>
          <button class="mid-btn ghost" data-testid="editor-close">返回</button>
        </div>
      </div>`);
    this.root.appendChild(this.editorEl);
    this.wireEditorControls();
  }

  private wireEditorControls(): void {
    const titleInp = this.editorEl.querySelector<HTMLInputElement>('[data-testid=editor-title-input]')!;
    const bossSel = this.editorEl.querySelector<HTMLSelectElement>('[data-testid=editor-boss-select]')!;
    const nemChk = this.editorEl.querySelector<HTMLInputElement>('[data-testid=editor-nemesis-chk]')!;
    const angSlider = this.editorEl.querySelector<HTMLInputElement>('[data-testid=editor-angle-slider]')!;
    const angVal = this.editorEl.querySelector<HTMLElement>('[data-testid=editor-angle-val]')!;
    const enemySel = this.editorEl.querySelector<HTMLSelectElement>('[data-testid=editor-enemy-select]')!;
    const codeInp = this.editorEl.querySelector<HTMLInputElement>('[data-testid=editor-code-input]')!;
    const cvs = this.editorEl.querySelector<HTMLCanvasElement>('[data-testid=track-editor-canvas]')!;

    const syncMeta = (): void => {
      this.editorDraft.title = titleInp.value.trim() || '自定义挑战跑道';
      this.editorDraft.bossId = bossSel.value as BossId;
      this.editorDraft.forceNemesis = nemChk.checked;
      codeInp.value = this.cb.onExportTrackCode(this.editorDraft);
      this.renderEditorCanvas();
    };

    titleInp.addEventListener('input', syncMeta);
    bossSel.addEventListener('change', syncMeta);
    nemChk.addEventListener('change', syncMeta);
    angSlider.addEventListener('input', () => {
      this.editorReflectorAngle = Number(angSlider.value) || 36;
      angVal.textContent = `${this.editorReflectorAngle >= 0 ? '+' : ''}${this.editorReflectorAngle}°`;
    });
    enemySel.addEventListener('change', () => {
      this.editorEnemyKind = enemySel.value as EnemyKind;
    });

    this.editorEl.querySelectorAll<HTMLButtonElement>('.ed-tool').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.editorSelectedTool = btn.dataset.tool as CustomTrackItemKind;
        this.editorEl.querySelectorAll('.ed-tool').forEach((b) => b.classList.toggle('on', b === btn));
      });
    });

    this.editorEl.querySelectorAll<HTMLButtonElement>('[data-ed-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.edPreset) || 0;
        const p = BUILTIN_TRACK_PRESETS[idx] ?? BUILTIN_TRACK_PRESETS[0]!;
        this.loadBlueprintIntoEditor(JSON.parse(JSON.stringify(p)));
      });
    });

    this.editorEl.querySelector('[data-testid=editor-clear-items]')!.addEventListener('click', () => {
      this.editorDraft.items = [];
      syncMeta();
    });

    cvs.addEventListener('click', (e) => {
      const rect = cvs.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / Math.max(1, rect.width);
      const ny = (e.clientY - rect.top) / Math.max(1, rect.height);
      const worldX = Number(((nx * 2 - 1) * 4.4).toFixed(2));
      const dist = Math.round(28 + (1 - ny) * (this.editorDraft.runwayLength - 58));
      // Remove if clicking near existing node
      const hitIdx = this.editorDraft.items.findIndex(
        (it) => Math.abs(it.x - worldX) < 0.75 && Math.abs(it.dist - dist) < 16,
      );
      if (hitIdx >= 0) {
        this.editorDraft.items.splice(hitIdx, 1);
      } else if (this.editorDraft.items.length < 36) {
        this.editorDraft.items.push({
          id: ++this.editorNextId,
          kind: this.editorSelectedTool,
          x: worldX,
          dist,
          angleDeg: this.editorSelectedTool === 'reflector' ? this.editorReflectorAngle : undefined,
          enemyKind: this.editorSelectedTool === 'enemy_wave' ? this.editorEnemyKind : undefined,
        });
      }
      syncMeta();
    });

    this.editorEl.querySelector('[data-testid=editor-export-btn]')!.addEventListener('click', () => {
      const code = this.cb.onExportTrackCode(this.editorDraft);
      codeInp.value = code;
      try {
        void navigator.clipboard?.writeText(code);
      } catch {
        /* ignore */
      }
      this.toast('📤 已生成挑战分享码并同步至文本框！', 2000);
    });

    this.editorEl.querySelector('[data-testid=editor-import-btn]')!.addEventListener('click', () => {
      const parsed = this.cb.onImportTrackCode(codeInp.value);
      if (!parsed) {
        this.toast('⚠ 分享码格式无效，请粘贴以 PZ23- 开头的挑战码！', 2200);
        return;
      }
      this.loadBlueprintIntoEditor(parsed);
      this.toast(html`📥 已成功解析蓝图：<b>${parsed.title}</b>（${parsed.items.length} 处机关）`, 2200);
    });

    this.editorEl.querySelector('[data-testid=editor-play-btn]')!.addEventListener('click', () => {
      syncMeta();
      this.showEditor(false);
      this.cb.onPlayCustomTrack(JSON.parse(JSON.stringify(this.editorDraft)));
    });

    this.editorEl.querySelector('[data-testid=editor-close]')!.addEventListener('click', () => this.showEditor(false));
  }

  loadBlueprintIntoEditor(bp: CustomTrackBlueprint): void {
    this.editorDraft = JSON.parse(JSON.stringify(bp));
    const titleInp = this.editorEl.querySelector<HTMLInputElement>('[data-testid=editor-title-input]');
    const bossSel = this.editorEl.querySelector<HTMLSelectElement>('[data-testid=editor-boss-select]');
    const nemChk = this.editorEl.querySelector<HTMLInputElement>('[data-testid=editor-nemesis-chk]');
    const codeInp = this.editorEl.querySelector<HTMLInputElement>('[data-testid=editor-code-input]');
    if (titleInp) titleInp.value = this.editorDraft.title;
    if (bossSel) bossSel.value = this.editorDraft.bossId;
    if (nemChk) nemChk.checked = Boolean(this.editorDraft.forceNemesis);
    if (codeInp) codeInp.value = this.cb.onExportTrackCode(this.editorDraft);
    this.renderEditorCanvas();
  }

  private renderEditorCanvas(): void {
    const cvs = this.editorEl?.querySelector<HTMLCanvasElement>('[data-testid=track-editor-canvas]');
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const w = cvs.width;
    const h = cvs.height;
    ctx.clearRect(0, 0, w, h);

    // Cyberpunk Highway Top-Down Grid
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#160d38');
    grad.addColorStop(1, '#0b1e42');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(78, 246, 255, 0.22)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const lx = (w * i) / 6;
      ctx.beginPath();
      ctx.moveTo(lx, 0);
      ctx.lineTo(lx, h);
      ctx.stroke();
    }
    for (let j = 1; j < 6; j++) {
      const ly = (h * j) / 6;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(w, ly);
      ctx.stroke();
    }
    // Boss Zone Header & Start Line Footer
    ctx.fillStyle = 'rgba(255, 59, 107, 0.22)';
    ctx.fillRect(0, 0, w, 22);
    ctx.fillStyle = '#ff85a2';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText(`☠ 终点首领战 · ${BOSS_META[this.editorDraft.bossId]?.title ?? this.editorDraft.bossId}`, 10, 15);
    ctx.fillStyle = '#7dffb3';
    ctx.fillText('▲ 起点 START (0m)', 10, h - 7);

    const iconMap: Record<CustomTrackItemKind, [string, string]> = {
      reflector: ['🪞', '#62f4ff'],
      lens: ['🔆', '#ffe46b'],
      mag_rail: ['⚡', '#4ef6ff'],
      cap_tower: ['🔋', '#b98cff'],
      bridge_gap: ['🌉', '#ff5c8a'],
      high_spire: ['🗼', '#ff9a3c'],
      gate_pair: ['🚪', '#19f5a8'],
      vault: ['📦', '#ffd84a'],
      enemy_wave: ['👾', '#ff4b6e'],
    };

    const maxD = Math.max(160, this.editorDraft.runwayLength - 58);
    for (const it of this.editorDraft.items) {
      const px = ((it.x / 4.4 + 1) * 0.5) * (w - 36) + 18;
      const py = (1 - Math.max(0, Math.min(1, (it.dist - 28) / maxD))) * (h - 42) + 24;
      const [glyph, col] = iconMap[it.kind] ?? ['◆', '#62f4ff'];
      ctx.fillStyle = 'rgba(7, 14, 30, 0.88)';
      ctx.beginPath();
      ctx.arc(px, py, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, px, py + 0.5);
      ctx.textAlign = 'start';
    }
  }

  showEditor(v: boolean, savedBp?: CustomTrackBlueprint | null): void {
    this.editorEl.classList.toggle('show', v);
    if (v) {
      if (savedBp) this.loadBlueprintIntoEditor(savedBp);
      else this.loadBlueprintIntoEditor(this.editorDraft);
    }
  }

  showPhotoHud(v: boolean): void {
    this.photoUiHidden = false;
    this.photoHudEl.classList.toggle('show', v);
    this.photoHudEl.classList.remove('clean-shot');
    this.hud.classList.toggle('photo-muted', v);
    if (this.rangePanel) { this.rangePanel.style.visibility = v ? 'hidden' : ''; this.rangePanel.style.pointerEvents = v ? 'none' : ''; }
  }

  togglePhotoCleanView(force?: boolean): void {
    this.photoUiHidden = force !== undefined ? force : !this.photoUiHidden;
    this.photoHudEl.classList.toggle('clean-shot', this.photoUiHidden);
  }

  showExpedition(v: boolean, map?: ExpeditionMapState, nodes?: readonly import('../types/game').ExpeditionNodeDef[]): void {
    this.expeditionEl.classList.toggle('show', v);
    if (v && map && nodes) {
      this.renderExpedition(map, nodes);
    }
  }

  renderExpedition(
    map: ExpeditionMapState,
    nodes: readonly import('../types/game').ExpeditionNodeDef[],
  ): void {
    const carryEl = this.expeditionEl.querySelector('[data-testid=expedition-carry-bar]')!;
    const leadMeta = REWARD_META[map.carryWeapon];
    const partMeta = REWARD_META[map.carryPartner];
    render(carryEl, html`
      <span>🚀 跨幕继承兵力：<b>${map.carrySquad} 人</b></span>
      <span>⚔ 配装：<b style="color:${leadMeta.color}">${leadMeta.glyph}${leadMeta.short}</b> + <b style="color:${partMeta.color}">${partMeta.glyph}${partMeta.short}</b></span>
      <span>种子 <b>#${map.seed}</b>${map.completed ? ' · 🏆已制霸全星图！' : ` · 第 ${map.act}/3 幕`}</span>`);

    const chartEl = this.expeditionEl.querySelector('[data-testid=expedition-star-chart]')!;
    const w = 440;
    const h = 216;
    const curAct = map.act;
    const actNodes = nodes.filter((n) => n.act === curAct);
    const posOf = (localCol: number, lane: number): [number, number] => {
      const x = 68 + localCol * 152;
      const y = lane === 0.5 ? 114 : lane === 0 ? 64 : 164;
      return [x, y];
    };
    const nodePos = new Map<string, [number, number]>();
    for (const n of actNodes) {
      nodePos.set(n.id, posOf(n.col % 3, n.lane));
    }
    const xmlns = 'http://www.w3.org/2000/svg';
    const routes = document.createElementNS(xmlns, 'svg');
    routes.setAttribute('viewBox', `0 0 ${w} ${h}`);
    routes.setAttribute('class', 'exp-svg');
    for (const n of actNodes) {
      const [x1, y1] = nodePos.get(n.id)!;
      for (const nextId of n.nextIds) {
        const destination = nodePos.get(nextId);
        if (!destination) continue;
        const cleared = map.clearedNodeIds.includes(n.id);
        const active = cleared || map.availableNodeIds.includes(n.id);
        const line = document.createElementNS(xmlns, 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(destination[0]));
        line.setAttribute('y2', String(destination[1]));
        line.setAttribute('stroke', active ? '#62f4ff' : 'rgba(130,165,220,0.32)');
        line.setAttribute('stroke-width', active ? '2.6' : '1.6');
        if (!cleared) line.setAttribute('stroke-dasharray', '5 4');
        routes.append(line);
      }
    }
    const actHeader = html`<div class="exp-act-steps">
      <span style="color:${curAct === 1 ? '#ffe46b' : '#7ef8ff'}">${curAct > 1 ? '✓' : '◆'} ACT I · 光学前哨</span>
      <span style="color:${curAct === 2 ? '#ffe46b' : curAct > 2 ? '#7ef8ff' : '#7a95ba'}">${curAct > 2 ? '✓' : '◆'} ACT II · 超频深空</span>
      <span style="color:${curAct === 3 ? '#ffe46b' : '#7a95ba'}">👑 ACT III · 奇点王座</span>
    </div>`;
    const cardsHtml = actNodes
      .map((n) => {
        const [nx, ny] = nodePos.get(n.id)!;
        const meta = EXPEDITION_NODE_META[n.kind];
        const cleared = map.clearedNodeIds.includes(n.id);
        const avail = map.availableNodeIds.includes(n.id) && !map.completed;
        return html`<button class="exp-node${cleared ? ' cleared' : ''}${avail ? ' avail' : ''}" data-exp-node="${n.id}" data-testid="exp-node-${n.id}" disabled="${!avail}" style="left:${((nx / w) * 100).toFixed(1)}%;top:${((ny / h) * 100).toFixed(1)}%;--nc:${meta.color}">
          <span class="en-glyph">${cleared ? '✓' : meta.glyph}</span>
          <b class="en-name">${meta.title}</b>
          <small class="en-sub">${n.nemesisRisk ? '🐺零号猎犬高危' : meta.glyph + ' 战术节点'}</small>
        </button>`;
      });
    render(chartEl, [actHeader, cardsHtml]);
    chartEl.prepend(routes);
    chartEl.querySelectorAll<HTMLButtonElement>('[data-exp-node]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!btn.disabled) this.cb.onStartExpeditionNode(btn.dataset.expNode!);
      });
    });

    const relicEl = this.expeditionEl.querySelector('[data-testid=expedition-relic-rack]')!;
    if (map.relics.length === 0) {
      render(relicEl, html`<div class="exp-relic-empty">💎 远征遗物槽（0/4）：突破远征节点或击溃乱入宿敌「零号猎犬」即可夺取跨幕遗物！</div>`);
    } else {
      render(relicEl, map.relics
        .map((rid) => {
          const r = EXPEDITION_RELICS[rid];
          return html`<div class="exp-relic-pill" style="--rc:${r.color}"><span>${r.glyph}</span><div><b>${r.name}</b><small>${r.desc}</small></div></div>`;
        }));
    }
  }

  setInputPromptMode(mode: 'kb' | 'gamepad'): void {
    const foot = this.title.querySelector('[data-testid=input-prompt-bar]');
    if (!foot) return;
    foot.textContent =
      mode === 'gamepad'
        ? '🎮 左摇杆/十字键 移动 · A/RT 超载 · B/LB 脉冲 · X/RB 切枪 · L3 僚机 · LB+RB 奥义 · Y/LT 核弹'
        : '拖动/A D 移动 · 空格 超载 · E 脉冲 · Tab 切枪 · F 僚机 · G 奥义 · Q 核弹';
  }
}
