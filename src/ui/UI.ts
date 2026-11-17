import type {
  EndlessUpgradeId,
  MutatorId,
  NonNullDefeatReason,
  RewardId,
  SectorId,
  SimSnapshot,
  WeaponId,
} from '../types/game';
import { getActiveSynergies, getEndlessThreat, PROTOCOLS, PROTOCOL_SYNERGIES } from '../config/protocols';
import { FUSIONS, MUTATORS } from '../config/blitz';
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
  REWARD_META,
  SECTOR_CHALLENGES,
  SECTOR_META,
  UPGRADES,
  type BuildArchetypeSummary,
  type DamageBreakdownRow,
  type UpgradeId,
} from '../app/meta';
import type { SaveData } from '../app/save';
import { html, render, type Content } from './dom';

export interface UICallbacks {
  onStart(sector: SectorId): void;
  onEndless(): void;
  onLeaderboard(): void;
  onBlitz(): void;
  onToggleMutator(id: MutatorId): void;
  onProtocol(id: EndlessUpgradeId): void;
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
}

export interface ResultData {
  victory: boolean;
  sector: SectorId;
  blitz?: boolean;
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
  private codexTab: 'arsenal' | 'bestiary' | 'medals' = 'arsenal';
  private protocolEl: HTMLElement | null = null;
  private lastSave: SaveData | null = null;
  private banner!: HTMLElement;
  private toastEl!: HTMLElement;
  private flash!: HTMLElement;
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
  private endlessHud!: HTMLElement;
  private resoReady = false;
  onOverdrive: (() => void) | null = null;
  onAegis: (() => void) | null = null;
  private comboEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private muteBtns: HTMLElement[] = [];
  private floats: Array<{ el: HTMLElement; t: number; dur: number; x: number; y: number; vy: number; alive: boolean }> = [];
  private selected: SectorId = 1;
  private lastSquad = -1;
  private lastWeaponKey = '';
  private lastDps = -1;
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
      this.floats.push({ el: f, t: 0, dur: 1, x: 0, y: 0, vy: 0, alive: false });
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
        <div class="title-ver">NEON PROTOCOL · V5 参赛版</div>
        <button class="icon-btn" data-testid="leaderboard-btn" aria-label="无尽排行榜" title="无尽排行榜">🏆</button>
        <button class="icon-btn help-btn" data-testid="help-btn" aria-label="玩法">?</button>
      </div>
      <div class="logo">
        <div class="logo-prism"><span></span><span></span><span></span></div>
        <h1>${GAME_TITLE_CN}</h1>
        <div class="logo-en">${GAME_TITLE_EN}</div>
        <div class="tagline">双武超限聚变 · 跳台折射机关 · 首领破甲反击</div>
      </div>
      <div class="sector-list" data-testid="sector-list"></div>
      <div class="special-modes">
        <button class="blitz-card" data-testid="blitz-btn">
          <span class="blitz-icon">🏆</span>
          <span class="blitz-body"><b>锦标赛闪击</b><small>90s 极速高潮 · 超武聚变</small></span>
          <span class="blitz-go">▶</span>
        </button>
        <button class="endless-card" data-testid="endless-btn">
          <span class="endless-icon">∞</span>
          <span class="endless-body"><b>无尽协议</b><small>无限阶段 · 双协议羁绊</small></span>
          <span class="endless-go">▶</span>
        </button>
      </div>
      <div class="mutator-bar" data-testid="mutator-bar"></div>
      <div class="title-row">
        <div class="core-count" data-testid="core-count"><i>${CORE_GLYPH}</i><b>0</b></div>
        <button class="mid-btn codex-btn" data-testid="codex-btn">图鉴勋章 <small class="medal-count">0/12</small></button>
        <button class="mid-btn workshop-btn" data-testid="workshop-btn">强化工坊<i class="dot"></i></button>
      </div>
      <button class="big-btn start-btn" data-testid="start-btn"><span>出击</span></button>
      <div class="title-foot">拖动 / A D 移动 · 空格 超载 · E 相位脉冲 · X 倍速 · P 暂停</div>`);
    this.root.appendChild(this.title);
    this.title.querySelector('.start-btn')!.addEventListener('click', () => this.cb.onStart(this.selected));
    this.title.querySelector('[data-testid=blitz-btn]')!.addEventListener('click', () => this.cb.onBlitz());
    this.title.querySelector('[data-testid=endless-btn]')!.addEventListener('click', () => this.cb.onEndless());
    this.title.querySelector('[data-testid=leaderboard-btn]')!.addEventListener('click', () => this.cb.onLeaderboard());
    this.title.querySelector('.help-btn')!.addEventListener('click', () => this.showHelp(true));
    this.title.querySelector('.workshop-btn')!.addEventListener('click', () => this.showWorkshop(true));
    this.title.querySelector('.codex-btn')!.addEventListener('click', () => this.showCodex(true));
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
      </div>
      <div class="hud-row">
        <div class="chips">
          <div class="chip weapon-chip" data-testid="weapon-chip"></div>
          <div class="chip dps-chip" data-testid="dps-chip">⚡ DPS 2</div>
          <div class="chip blades-chip" data-testid="blades-chip"></div>
          <div class="stack-rack" data-testid="stack-rack"></div>
        </div>
        <div class="score-wrap">
          <div class="score" data-testid="score">0</div>
          <div class="fever-badge" data-testid="fever-badge">FEVER ×1.2</div>
        </div>
      </div>
      <div class="endless-hud" data-testid="endless-hud"><b>阶段 1</b><span>首领 0 · 0m</span></div>
      <div class="squad-badge" data-testid="squad-count"><span class="sq-icon">◆</span><span class="sq-num">1</span></div>
      <div class="bottom-dock" data-ui-block="1">
        <button class="aegis-btn ready" data-testid="aegis-btn" aria-label="相位脉冲">
          <div class="aegis-fill"></div>
          <span class="aegis-txt">🛡 脉冲 [E]</span>
        </button>
        <div class="reso" data-testid="resonance"><div class="reso-fill"></div><span>共鸣</span></div>
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
    this.weaponChip = this.hud.querySelector('.weapon-chip')!;
    this.dpsChip = this.hud.querySelector('.dps-chip')!;
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
    this.endlessHud = this.hud.querySelector('.endless-hud')!;
    this.resoWrap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onOverdrive?.();
    });
    this.aegisBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onAegis?.();
    });
    this.speedBtn.addEventListener('click', () => this.cb.onToggleSpeed());
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
    this.vignette = el('div', 'vignette');
    this.root.append(this.vignette, this.flash, this.banner, this.toastEl);

    this.pauseEl = el('div', 'screen modal pause-screen');
    this.pauseEl.dataset.testid = 'pause-screen';
    this.pauseEl.dataset.uiBlock = '1';
    render(this.pauseEl, html`
      <div class="panel">
        <h2>战术暂停</h2>
        <div class="pause-info"></div>
        <div class="pause-synergies"></div>
        <button class="big-btn" data-testid="resume-btn">继续作战</button>
        <button class="mid-btn" data-testid="restart-btn">重新开始</button>
        <button class="mid-btn ghost" data-testid="home-btn">返回主页</button>
      </div>`);
    this.root.appendChild(this.pauseEl);
    this.pauseEl.querySelector('[data-testid=resume-btn]')!.addEventListener('click', () => this.cb.onResume());
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
        <h2>参赛决胜手册</h2>
        <ul class="help-list">
          <li><i class="hi move">⇆</i><div><b>左右拖动 / A D</b> 移动蜂群，全武装自动齐射；<b>X 键</b> 切换 <b>2× 倍速</b></div></li>
          <li><i class="hi vault">🌌</i><div><b>双武超限聚变</b>：迫击+冰冻=<b>极寒黑洞炮</b>；散弹+轨炮=<b>折射电网</b>；环轨刃+脉冲Lv2=<b>浮游剑阵</b></div></li>
          <li><i class="hi pos">▲</i><div><b>跑道立体机关</b>：踩<b>磁浮跳台</b>飞越致命 ÷ 门并震地清场；射<b>45°折射镜</b>斜角爆桶；闯<b>死斗契约</b>赢悬赏大奖</div></li>
          <li><i class="hi boss">⚡</i><div><b>首领破甲 & 棱球反击</b>：击碎首领<b>左右肩部件</b>触发 4 秒 <b>2.0× 破防</b>；集火将负值<b>湮灭棱球</b>打正即可反击轰核！</div></li>
          <li><i class="hi gold">🏆</i><div><b>锦标赛闪击 & 突变词缀</b>：90 秒浓缩全部高潮机制；勾选「镜像双子 / 玻璃大炮 / 连锁狂欢」赢取最高 +75% 得分与晶核加成！</div></li>
          <li><i class="hi reso">🛡</i><div><b>相位脉冲 [E] & 共鸣超载 [空格]</b>：主动震碎弹幕开盾减伤 + 满共鸣开启 V 翼超载倾泻火力</div></li>
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
      <div class="panel codex-panel">
        <h2>战术档案 · 勋章</h2>
        <div class="codex-tabs">
          <button class="codex-tab on" data-tab="arsenal">超武武装</button>
          <button class="codex-tab" data-tab="bestiary">异种首领</button>
          <button class="codex-tab" data-tab="medals">荣耀勋章</button>
        </div>
        <div class="codex-body"></div>
        <button class="big-btn" data-testid="codex-close">返回</button>
      </div>`);
    this.root.appendChild(this.codexEl);
    this.codexEl.querySelector('[data-testid=codex-close]')!.addEventListener('click', () => this.showCodex(false));
    this.codexEl.querySelectorAll<HTMLButtonElement>('.codex-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.codexTab = btn.dataset.tab as 'arsenal' | 'bestiary' | 'medals';
        this.codexEl.querySelectorAll('.codex-tab').forEach((b) => b.classList.toggle('on', b === btn));
        if (this.lastSave) this.renderCodex(this.lastSave);
      });
    });
  }

  showWorkshop(v: boolean): void {
    this.workshopEl.classList.toggle('show', v);
    if (v && this.lastSave) this.renderWorkshop(this.lastSave);
  }

  showCodex(v: boolean): void {
    this.codexEl.classList.toggle('show', v);
    if (v && this.lastSave) this.renderCodex(this.lastSave);
  }

  renderCodex(save: SaveData): void {
    this.lastSave = save;
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
      render(body, html`<div class="cx-sec">⚡ 双武超限聚变（局内自动合成）</div>${fusionCards}<div class="cx-sec">基础同屏协同武装</div>${weaponCards}`);
    } else if (this.codexTab === 'bestiary') {
      const enemyCards = (Object.keys(ENEMY_META) as Array<keyof typeof ENEMY_META>)
        .map((k) => {
          const m = ENEMY_META[k];
          const kills = save.bestiaryKills?.[k] ?? 0;
          return html`<div class="cx-card" style="--cc:${m.hex}">
            <div class="cx-icon">👾</div>
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
          return html`<div class="cx-card boss" style="--cc:${b.color}">
            <div class="cx-icon">☠</div>
            <div class="cx-main">
              <div class="cx-title"><b>${b.title} · ${b.name}</b><span>${b.phases} 阶段首领 · 已讨伐 ${kills}</span></div>
              <div class="cx-desc">${b.mechanic}</div>
              <div class="cx-meta"><em>战术：${b.counterTip}</em></div>
            </div>
          </div>`;
        });
      render(body, html`<div class="cx-sec">首领档案（部位破坏 + 棱球反击）</div>${bossCards}<div class="cx-sec">感染体档案</div>${enemyCards}`);
    } else {
      const unlockedSet = new Set(save.achievements ?? []);
      render(body, ACHIEVEMENTS.map((a) => {
        const done = unlockedSet.has(a.id);
        return html`<div class="cx-card medal${done ? ' done' : ''}" style="--cc:${a.color}">
          <div class="cx-icon">${done ? a.glyph : '🔒'}</div>
          <div class="cx-main">
            <div class="cx-title"><b>${a.name}</b><span class="cx-rw">${done ? '✓ 已达成' : `+${CORE_GLYPH}${a.reward}`}</span></div>
            <div class="cx-desc">${a.desc}</div>
          </div>
        </div>`;
      }));
    }
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
    const affordable =
      UPGRADES.some((u) => save.upgrades[u.id] < u.max && save.cores >= u.costs[save.upgrades[u.id]]!) ||
      (apexUnlocked && save.cores >= apexCost);
    this.title.querySelector('.workshop-btn')!.classList.toggle('can', affordable);

    const respecBtn = this.workshopEl.querySelector<HTMLButtonElement>('[data-testid=respec-btn]')!;
    const totalSpent = getTotalWorkshopSpent(save.upgrades, apexLv);
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
  }

  // ------------------------------------------------------------------ screens
  showTitle(save: SaveData): void {
    this.title.classList.add('show');
    this.hud.classList.remove('show');
    this.pauseEl.classList.remove('show');
    this.resultEl.classList.remove('show');
    this.codexEl.classList.remove('show');
    this.renderWorkshop(save);
    this.selected = Math.min(save.unlocked, this.selected) as SectorId;
    if (this.selected < 1) this.selected = 1;
    this.renderSectorList(save);
    this.renderBlitz(save);
    this.renderEndless(save);
    this.renderMutators(save);
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
      sub.textContent = '90s 极速高潮 · 超武全开';
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

  renderMutators(save: SaveData): void {
    this.lastSave = save;
    const bar = this.title.querySelector('.mutator-bar')!;
    const active = new Set(save.mutators ?? []);
    const totalPct = computeMutatorBonusPct(save.mutators);
    render(bar, [html`<span class="mut-lbl">突变词缀${totalPct > 0 ? html` <em>+${totalPct}%</em>` : ''}</span>`,
      MUTATORS.map((m) => {
        const on = active.has(m.id);
        return html`<button class="mut-chip${on ? ' on' : ''}" style="--mc:${m.color}" data-mut="${m.id}" data-testid="mutator-${m.id}" title="${m.desc}">${m.glyph} ${m.name} <small>+${m.bonusPct}%</small></button>`;
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
      <div class="protocol-note">选择后继续 · 强化仅本局有效 · 键盘 1 / 2 / 3</div>
    </div>`);
    this.protocolEl.querySelectorAll<HTMLButtonElement>('[data-protocol]').forEach((b) => {
      b.addEventListener('click', () => this.cb.onProtocol(b.dataset.protocol as EndlessUpgradeId));
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
    this.hud.classList.add('show');
    this.hud.classList.toggle('endless', endless);
    this.hud.classList.toggle('blitz', blitz);
    this.hud.dataset.sector = String(sector);
    this.bossBar.classList.remove('show');
    this.progressWrap.classList.remove('hide');
    this.lastSquad = -1;
    this.lastWeaponKey = '';
    this.lastStackKey = '';
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
      const w = REWARD_META[snap.weapon];
      render(this.pauseEl.querySelector('.pause-info')!, html`
        <div><span>蜂群</span><b>${snap.squadCount}</b></div>
        <div><span>武器</span><b style="color:${w.color}">${w.name} Lv${snap.weaponLevel}</b></div>
        <div><span>实时DPS</span><b>${Math.round(snap.trueSquadDps)}</b></div>
        <div><span>${snap.endless ? '无尽阶段' : snap.blitzActive ? '闪击推进' : '进度'}</span><b>${snap.endless ? `${snap.endless.wave} · ${Math.round(snap.endless.distance)}m` : `${Math.round(snap.runwayProgress * 100)}%`}</b></div>`);
      const synEl = this.pauseEl.querySelector('.pause-synergies')!;
      const syns = getActiveSynergies(snap.endless?.upgrades);
      const fusBadges = (snap.activeFusions ?? []).map((fId) => {
        const f = FUSIONS[fId];
        return html`<span style="--sc:${f.color}">${f.glyph} 超武「${f.name}」：${f.desc}</span>`;
      });
      render(synEl, [
        ...fusBadges,
        ...syns.map((s) => html`<span style="--sc:${s.color}">${s.glyph} ${s.name}：${s.effectText}</span>`),
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
  updateHud(snap: SimSnapshot, score: number, badgePos: { x: number; y: number }): void {
    this.squadBadge.style.transform = `translate(${badgePos.x}px, ${badgePos.y}px) translate(-50%, -100%)`;
    if (snap.squadCount !== this.lastSquad) {
      if (this.lastSquad >= 0) {
        const up = snap.squadCount > this.lastSquad;
        this.squadBadge.classList.remove('up', 'down');
        void this.squadBadge.offsetWidth;
        this.squadBadge.classList.add(up ? 'up' : 'down');
      }
      this.lastSquad = snap.squadCount;
      this.squadNum.textContent = String(snap.squadCount);
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

    const wkey = `${snap.weapon}${snap.weaponLevel}`;
    if (wkey !== this.lastWeaponKey) {
      this.lastWeaponKey = wkey;
      const w = REWARD_META[snap.weapon];
      render(this.weaponChip, html`<span class="g" style="color:${w.color}">${w.glyph}</span><span class="n">${w.name}</span><span class="lv">${[1, 2, 3].map((i) => html`<i class="${i <= snap.weaponLevel ? 'on' : ''}"></i>`)}</span>`);
      this.weaponChip.style.setProperty('--wc', w.color);
      this.weaponChip.classList.remove('pop');
      void this.weaponChip.offsetWidth;
      this.weaponChip.classList.add('pop');
    }

    const rampageBoost =
      (snap.rampageStacks ?? 0) >= 6
        ? 1 + Math.min(0.36, Math.floor((snap.rampageStacks ?? 0) / 6) * 0.045)
        : 1;
    let auxMult = 1;
    let auxStreamTotal = 0;
    const pills: Content[] = [];

    for (const fId of snap.activeFusions ?? []) {
      const f = FUSIONS[fId];
      pills.push(html`<span class="st-pill fusion" style="--sc:${f.color}">${f.glyph}${f.short}</span>`);
    }
    for (const mId of snap.mutators ?? []) {
      const m = MUTATORS.find((x) => x.id === mId);
      if (m) pills.push(html`<span class="st-pill" style="--sc:${m.color}">${m.glyph}${m.name}</span>`);
    }
    if (snap.arsenal && snap.stats.vaultsCracked > 0) {
      for (const wId of ['pulse', 'scatter', 'rail', 'plasma', 'cryo'] as const) {
        const lv = snap.arsenal[wId] ?? 0;
        if (lv === 0) continue;
        const m = REWARD_META[wId];
        if (wId !== snap.weapon) {
          auxMult += (0.28 + lv * 0.07) * (0.38 + lv * 0.1);
          const fullS = getVolleyStreamCount(wId, lv, snap.squadCount);
          auxStreamTotal += Math.min(6, Math.max(2, Math.ceil(fullS * 0.42)));
        }
        const isLead = wId === snap.weapon;
        pills.push(
          html`<span class="st-pill ${isLead ? 'lead' : ''}" style="--sc:${m.color}">${m.glyph}${m.short}${lv}</span>`,
        );
      }
    }
    if ((snap.overclockStacks ?? 0) > 0) {
      pills.push(html`<span class="st-pill oc" style="--sc:#ff5ce0">✦超限+${snap.overclockStacks}</span>`);
    }
    if ((snap.rampageStacks ?? 0) >= 5) {
      const pct = Math.round((rampageBoost - 1) * 100);
      pills.push(
        html`<span class="st-pill hot" style="--sc:#ff9a3c">🔥狂暴×${snap.rampageStacks}${pct > 0 ? ` +${pct}%速` : '·电弧'}</span>`,
      );
    }
    if ((snap.gateStreak ?? 0) >= 2) {
      pills.push(html`<span class="st-pill streak" style="--sc:#19f5a8">🚪连门×${snap.gateStreak}</span>`);
    }
    const stackKey = [snap.weapon, ...Object.values(snap.arsenal ?? {}), snap.overclockStacks, snap.rampageStacks, snap.gateStreak, snap.stats.vaultsCracked > 0, ...(snap.activeFusions ?? []), ...(snap.mutators ?? [])].join('|');
    if (stackKey !== this.lastStackKey) {
      this.lastStackKey = stackKey;
      render(this.stackRack, pills);
    }

    const twinMult = snap.mirrorTwinActive ? 1.55 : 1;
    const effectiveDps = Math.round(snap.trueSquadDps * auxMult * rampageBoost * twinMult);
    const baseStreams = getVolleyStreamCount(snap.weapon, snap.weaponLevel, snap.squadCount) + auxStreamTotal;
    const totalStreams = snap.mirrorTwinActive ? Math.round(baseStreams * 1.65) : baseStreams;
    const dpsKey = effectiveDps * 100 + totalStreams;
    if (dpsKey !== this.lastDps) {
      this.lastDps = dpsKey;
      this.dpsChip.textContent = `⚡ ${totalStreams}弹道 · DPS ${effectiveDps.toLocaleString('en-US')}`;
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
    const aegisMax = Math.max(1, snap.aegisMaxCooldown ?? 14);
    const aegisActive = aegisTimer > 0;
    const aegisReady = !aegisActive && aegisCd <= 0.01;
    this.aegisBtn.classList.toggle('active', aegisActive);
    this.aegisBtn.classList.toggle('ready', aegisReady);
    const fillPct = aegisActive ? 100 : aegisReady ? 100 : Math.max(0, (1 - aegisCd / aegisMax) * 100);
    this.aegisFill.style.width = `${fillPct.toFixed(1)}%`;
    this.aegisText.textContent = aegisActive
      ? `🛡 力场 ${aegisTimer.toFixed(1)}s`
      : aegisReady
        ? '🛡 脉冲 [E]'
        : `🛡 ${Math.ceil(aegisCd)}s`;

    const b = snap.boss;
    if (b && b.active) {
      this.bossBar.classList.add('show');
      this.progressWrap.classList.add('hide');
      const meta = BOSS_META[b.id];
      const enraged = (b.enrage ?? 1) > 1;
      const brk = b.breakTimer ?? 0;
      const alivePods = (b.parts ?? []).filter((pt) => !pt.destroyed).length;
      const podTag = (b.parts?.length ?? 0) > 0 ? ` · 肩甲${alivePods}/${b.parts!.length}` : '';
      this.bossName.textContent =
        brk > 0
          ? `⚡ 破防 2.0× (${brk.toFixed(1)}s) · ${meta.title}`
          : `${meta.name}《${meta.title}》${podTag}${enraged ? ' · 狂暴' : ''}`;
      this.bossBar.classList.toggle('enraged', enraged);
      this.bossBar.classList.toggle('broken', brk > 0);
      render(this.bossPhase, Array.from({ length: b.maxPhases }, (_, i) => html`<i class="${i < b.phase ? 'on' : ''}"></i>`));
      this.bossFill.style.width = `${Math.max(0, (b.hp / b.maxHp) * 100).toFixed(2)}%`;
      this.bossBar.classList.toggle('shielded', b.shielded && !b.secondaryCore);
    } else if (!b) {
      this.bossBar.classList.remove('show', 'broken');
      this.progressWrap.classList.remove('hide');
    }
  }

  // ------------------------------------------------------------------ feedback
  floatText(x: number, y: number, text: string, cls: string, dur = 0.9): void {
    const dup = this.floats.find(
      (q) => q.alive && q.t < 0.18 && q.el.textContent === text && Math.abs(q.x - x) < 90,
    );
    if (dup) return;

    let adjY = y;
    for (let pass = 0; pass < 4; pass++) {
      const clash = this.floats.some(
        (q) => q.alive && q.t < 0.5 && Math.abs(q.x - x) < 76 && Math.abs(q.y - adjY) < 26,
      );
      if (!clash) break;
      adjY = Math.max(88, adjY - 27);
    }

    let f = this.floats.find((q) => !q.alive);
    if (!f) f = this.floats.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    f.alive = true;
    f.t = 0;
    f.dur = dur;
    f.x = x;
    f.y = adjY;
    f.vy = -60;
    f.el.className = `float ${cls}`;
    f.el.textContent = text;
    f.el.style.opacity = '1';
  }

  updateFloats(dt: number): void {
    for (const f of this.floats) {
      if (!f.alive) continue;
      f.t += dt;
      const p = f.t / f.dur;
      if (p >= 1) {
        f.alive = false;
        f.el.style.opacity = '0';
        continue;
      }
      f.y += f.vy * dt;
      f.vy *= Math.exp(-3 * dt);
      const pop = p < 0.15 ? 0.6 + (p / 0.15) * 0.6 : 1.2 - Math.min(0.2, (p - 0.15) * 0.5);
      f.el.style.transform = `translate(${f.x}px, ${f.y}px) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
      f.el.style.opacity = String(p > 0.7 ? (1 - p) / 0.3 : 1);
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

  doFlash(color: string, strength = 0.6): void {
    this.flash.style.background = color;
    this.flash.style.transition = 'none';
    this.flash.style.opacity = String(strength);
    void this.flash.offsetWidth;
    this.flash.style.transition = 'opacity 0.45s ease-out';
    this.flash.style.opacity = '0';
  }

  hurt(): void {
    this.vignette.classList.remove('hit');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('hit');
  }

  // ------------------------------------------------------------------ results
  showResult(r: ResultData, onStar: (i: number) => void): void {
    this.hideBanner();
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
        <div class="r-kicker">${isBlitz ? 'TOURNAMENT BLITZ · 锦标赛闪击' : isEndless ? 'ENDLESS PROTOCOL · 无尽协议' : meta.subtitle}</div>
        <h2 class="r-title">${isEndless ? '无尽信号中断' : isBlitz ? (r.victory ? '🏆 闪击锦标夺冠' : '闪击挑战中断') : r.victory ? (finale ? '奇点终结 · 全线通关' : '区域突破') : '蜂群信号丢失'}</h2>
        ${r.victory ? html`<div class="stars">${[0, 1, 2].map((i) => html`<span class="star" data-i="${i}">★</span>`)}</div>` : html`
          <div class="defeat-box" data-testid="defeat-reason">
            <div class="d-title">${reason?.title ?? ''}</div>
            <div class="d-tip">💡 ${reason?.tip ?? ''}</div>
            ${r.bossHpFrac !== null ? html`<div class="d-prog boss"><div style="width:${Math.round(r.bossHpFrac * 100)}%"></div><span>首领剩余血量 ${Math.max(1, Math.round(r.bossHpFrac * 100))}%${r.bossHpFrac < 0.35 ? ' · 差一点！' : ''}</span></div>` : html`<div class="d-prog"><div style="width:${Math.round(r.progress * 100)}%"></div><span>推进 ${Math.round(r.progress * 100)}%</span></div>`}
          </div>`}
        <div class="r-score"><span>得分</span><b data-testid="result-score">0</b>${r.newBest ? html`<em>新纪录!</em>` : html`<small>最佳 ${r.best.toLocaleString('en-US')}</small>`}</div>
        ${archHtml}
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
          ${r.hasNext ? html`<button class="big-btn" data-testid="next-btn">下一关 ▶</button>` : ''}
          <button class="${r.hasNext ? 'mid-btn' : 'big-btn'}" data-testid="retry-btn">${isBlitz ? '再战闪击' : isEndless ? '再战无尽' : r.victory ? (r.sector === 4 ? '新布局再战' : '再战一次') : '重新挑战'}</button>
          <button class="mid-btn ghost" data-testid="result-home-btn">返回主页</button>
        </div>
      </div>`);
    this.resultEl.classList.add('show');
    this.resultEl.querySelector('[data-testid=next-btn]')?.addEventListener('click', () => this.cb.onNext());
    this.resultEl.querySelector('[data-testid=retry-btn]')!.addEventListener('click', () => this.cb.onRetry());
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

  hideResult(): void {
    this.resultEl.classList.remove('show');
  }

  get weaponName(): (w: WeaponId) => string {
    return (w) => REWARD_META[w].name;
  }
}
