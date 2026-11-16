import type { NonNullDefeatReason, RewardId, SectorId, SimSnapshot, WeaponId } from '../types/game';
import { BOSS_META, CORE_GLYPH, SECTOR_CHALLENGES, DEFEAT_META, GAME_TITLE_CN, GAME_TITLE_EN, REWARD_META, SECTOR_META, UPGRADES, type UpgradeId } from '../app/meta';
import type { SaveData } from '../app/save';

export interface UICallbacks {
  onStart(sector: SectorId): void;
  onPause(): void;
  onResume(): void;
  onRetry(): void;
  onHome(): void;
  onNext(): void;
  onToggleMute(): void;
  onBuy(id: UpgradeId): void;
}

export interface ResultData {
  victory: boolean;
  sector: SectorId;
  stars: number;
  score: number;
  best: number;
  newBest: boolean;
  reason: NonNullDefeatReason | null;
  stats: { kills: number; gatesImproved: number; vaultsCracked: number; maxChain: number; peakSquad: number; finalSquad: number; time: number };
  hasNext: boolean;
  progress: number;
  /** remaining boss HP fraction when the run ended during the boss fight */
  bossHpFrac: number | null;
  maxCombo: number;
  challenges: Array<{ text: string; reward: number; done: boolean; isNew: boolean }>;
  cores: { total: number; lines: Array<[string, number]>; balance: number; affordable: boolean };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const FLOAT_POOL = 28;

export class UI {
  readonly root: HTMLElement;
  private title!: HTMLElement;
  private hud!: HTMLElement;
  private pauseEl!: HTMLElement;
  private resultEl!: HTMLElement;
  private helpEl!: HTMLElement;
  private workshopEl!: HTMLElement;
  private lastSave: SaveData | null = null;
  private banner!: HTMLElement;
  private toastEl!: HTMLElement;
  private flash!: HTMLElement;
  private vignette!: HTMLElement;
  private squadBadge!: HTMLElement;
  private squadNum!: HTMLElement;
  private progressFill!: HTMLElement;
  private progressWrap!: HTMLElement;
  private bossBar!: HTMLElement;
  private bossFill!: HTMLElement;
  private bossName!: HTMLElement;
  private bossPhase!: HTMLElement;
  private weaponChip!: HTMLElement;
  private bladesChip!: HTMLElement;
  private scoreEl!: HTMLElement;
  private resoFill!: HTMLElement;
  private resoWrap!: HTMLElement;
  private resoLabel!: HTMLElement;
  private resoReady = false;
  onOverdrive: (() => void) | null = null;
  private comboEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private muteBtns: HTMLElement[] = [];
  private floats: Array<{ el: HTMLElement; t: number; dur: number; x: number; y: number; vy: number; alive: boolean }> = [];
  private selected: SectorId = 1;
  private lastSquad = -1;
  private lastWeaponKey = '';
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
    this.title.innerHTML = `
      <div class="title-top">
        <button class="icon-btn mute-btn" data-testid="mute-btn-title" aria-label="静音">🔊</button>
        <button class="icon-btn help-btn" data-testid="help-btn" aria-label="玩法">?</button>
      </div>
      <div class="logo">
        <div class="logo-prism"><span></span><span></span><span></span></div>
        <h1>${GAME_TITLE_CN}</h1>
        <div class="logo-en">${GAME_TITLE_EN}</div>
        <div class="tagline">拖动蜂群 · 穿过数字门 · 火力进化 · 击溃首领</div>
      </div>
      <div class="sector-list" data-testid="sector-list"></div>
      <div class="title-row">
        <div class="core-count" data-testid="core-count"><i>${CORE_GLYPH}</i><b>0</b></div>
        <button class="mid-btn workshop-btn" data-testid="workshop-btn">强化工坊<i class="dot"></i></button>
      </div>
      <button class="big-btn start-btn" data-testid="start-btn"><span>出击</span></button>
      <div class="title-foot">触屏/鼠标拖动 · 键盘 ← → 或 A D · P 暂停</div>`;
    this.root.appendChild(this.title);
    this.title.querySelector('.start-btn')!.addEventListener('click', () => this.cb.onStart(this.selected));
    this.title.querySelector('.help-btn')!.addEventListener('click', () => this.showHelp(true));
    this.title.querySelector('.workshop-btn')!.addEventListener('click', () => this.showWorkshop(true));
    const m = this.title.querySelector<HTMLElement>('.mute-btn')!;
    m.addEventListener('click', () => this.cb.onToggleMute());
    this.muteBtns.push(m);
  }

  private buildHud(): void {
    this.hud = el('div', 'hud');
    this.hud.dataset.testid = 'hud';
    this.hud.innerHTML = `
      <div class="hud-top" data-ui-block="1">
        <button class="icon-btn pause-btn" data-testid="pause-btn" aria-label="暂停">❚❚</button>
        <div class="progress" data-testid="progress">
          <div class="progress-track"><div class="progress-fill"></div></div>
          <div class="progress-boss">☠</div>
        </div>
        <button class="icon-btn mute-btn" data-testid="mute-btn" aria-label="静音">🔊</button>
      </div>
      <div class="boss-bar" data-testid="boss-bar">
        <div class="boss-label"><span class="boss-name"></span><span class="boss-phase"></span></div>
        <div class="boss-track"><div class="boss-fill"></div></div>
      </div>
      <div class="hud-row">
        <div class="chips">
          <div class="chip weapon-chip" data-testid="weapon-chip"></div>
          <div class="chip blades-chip" data-testid="blades-chip"></div>
        </div>
        <div class="score" data-testid="score">0</div>
      </div>
      <div class="squad-badge" data-testid="squad-count"><span class="sq-icon">◆</span><span class="sq-num">1</span></div>
      <div class="reso" data-testid="resonance" data-ui-block="1"><div class="reso-fill"></div><span>共鸣</span></div>
      <div class="combo"></div>
      <div class="hint" data-testid="drag-hint"><div class="hand">👆</div><div>左右拖动控制蜂群</div></div>`;
    this.root.appendChild(this.hud);
    this.progressWrap = this.hud.querySelector('.progress')!;
    this.progressFill = this.hud.querySelector('.progress-fill')!;
    this.bossBar = this.hud.querySelector('.boss-bar')!;
    this.bossFill = this.hud.querySelector('.boss-fill')!;
    this.bossName = this.hud.querySelector('.boss-name')!;
    this.bossPhase = this.hud.querySelector('.boss-phase')!;
    this.weaponChip = this.hud.querySelector('.weapon-chip')!;
    this.bladesChip = this.hud.querySelector('.blades-chip')!;
    this.scoreEl = this.hud.querySelector('.score')!;
    this.squadBadge = this.hud.querySelector('.squad-badge')!;
    this.squadNum = this.hud.querySelector('.sq-num')!;
    this.resoFill = this.hud.querySelector('.reso-fill')!;
    this.resoWrap = this.hud.querySelector('.reso')!;
    this.resoLabel = this.resoWrap.querySelector('span')!;
    this.resoWrap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onOverdrive?.();
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
    this.vignette = el('div', 'vignette');
    this.root.append(this.vignette, this.flash, this.banner, this.toastEl);

    this.pauseEl = el('div', 'screen modal pause-screen');
    this.pauseEl.dataset.testid = 'pause-screen';
    this.pauseEl.dataset.uiBlock = '1';
    this.pauseEl.innerHTML = `
      <div class="panel">
        <h2>已暂停</h2>
        <div class="pause-info"></div>
        <button class="big-btn" data-testid="resume-btn">继续</button>
        <button class="mid-btn" data-testid="restart-btn">重新开始</button>
        <button class="mid-btn ghost" data-testid="home-btn">返回主页</button>
      </div>`;
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
    this.helpEl.innerHTML = `
      <div class="panel help-panel">
        <h2>作战手册</h2>
        <ul class="help-list">
          <li><i class="hi move">⇆</i><div><b>左右拖动</b>移动蜂群，射击全自动</div></li>
          <li><i class="hi pos">+</i><div><b>绿门</b>增加战士；<b class="neg">红门</b>减少——人数归零即失败</div></li>
          <li><i class="hi gold">▣</i><div><b>金框门</b>可以被射击：提前瞄准，把 -5 打成 +6！带锁的 ÷ 门破锁后变 ×2</div></li>
          <li><i class="hi vault">⬢</i><div><b>能量舱</b>击破获得新武器：散射 / 穿透 / 爆破 / 冰冻 / 环轨刃，重复获得会升级</div></li>
          <li><i class="hi barrel">◉</i><div><b>电容桶</b>射爆后范围爆炸，可连锁，还会提升附近金框门数值</div></li>
          <li><i class="hi lens">✦</i><div><b>棱镜</b>子弹穿过会一分为二并增伤，站在棱镜后方输出翻倍</div></li>
          <li><i class="hi reso">⚡</i><div><b>共鸣槽</b>改善门、破舱、连锁会充能，满后点击共鸣槽或按空格，进入 6 秒超载：射速 ×1.5 + 穿透</div></li>
          <li><i class="hi boss">☠</i><div><b>首领</b>：地面红区填满时会轰击，移到安全车道；蜂群越大、武器越强，击杀越快；拖太久首领会狂暴，持续吞噬蜂群</div></li>
        </ul>
        <button class="big-btn" data-testid="help-close">明白了</button>
      </div>`;
    this.root.appendChild(this.helpEl);
    this.helpEl.querySelector('[data-testid=help-close]')!.addEventListener('click', () => this.showHelp(false));

    this.workshopEl = el('div', 'screen modal workshop-screen');
    this.workshopEl.dataset.uiBlock = '1';
    this.workshopEl.dataset.testid = 'workshop-screen';
    this.workshopEl.innerHTML = `
      <div class="panel ws-panel">
        <h2>强化工坊</h2>
        <div class="ws-cores"><i>${CORE_GLYPH}</i><b>0</b><span>晶核</span></div>
        <div class="ws-list"></div>
        <div class="ws-note">每局结算都会获得晶核——失败也算数。强化永久生效。</div>
        <button class="big-btn" data-testid="workshop-close">返回</button>
      </div>`;
    this.root.appendChild(this.workshopEl);
    this.workshopEl.querySelector('[data-testid=workshop-close]')!.addEventListener('click', () => this.showWorkshop(false));
  }

  showWorkshop(v: boolean): void {
    this.workshopEl.classList.toggle('show', v);
    if (v && this.lastSave) this.renderWorkshop(this.lastSave);
  }

  /** Re-renders workshop rows + title currency badge from save data. */
  renderWorkshop(save: SaveData, boughtId?: UpgradeId): void {
    this.lastSave = save;
    const coresTxt = save.cores.toLocaleString('en-US');
    this.title.querySelector('.core-count b')!.textContent = coresTxt;
    this.workshopEl.querySelector('.ws-cores b')!.textContent = coresTxt;
    const affordable = UPGRADES.some((u) => save.upgrades[u.id] < u.max && save.cores >= u.costs[save.upgrades[u.id]]!);
    this.title.querySelector('.workshop-btn')!.classList.toggle('can', affordable);
    const list = this.workshopEl.querySelector('.ws-list')!;
    list.innerHTML = '';
    for (const u of UPGRADES) {
      const lv = save.upgrades[u.id];
      const maxed = lv >= u.max;
      const cost = maxed ? 0 : u.costs[lv]!;
      const can = !maxed && save.cores >= cost;
      const row = el('div', `ws-row${boughtId === u.id ? ' bought' : ''}`);
      row.style.setProperty('--uc', u.color);
      row.innerHTML = `
        <div class="ws-glyph">${u.glyph}</div>
        <div class="ws-body">
          <div class="ws-name">${u.name} <small>Lv${lv}</small></div>
          <div class="ws-eff">${lv > 0 ? u.effect(lv) : '未强化'}${maxed ? '' : ` <em>→ ${u.effect(lv + 1)}</em>`}</div>
          <div class="ws-pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div>
        </div>
        <button class="ws-buy${can ? '' : ' off'}" data-testid="buy-${u.id}" ${maxed ? 'disabled' : ''}>${maxed ? '已满级' : `${CORE_GLYPH} ${cost}`}</button>`;
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
  }

  // ------------------------------------------------------------------ screens
  showTitle(save: SaveData): void {
    this.title.classList.add('show');
    this.hud.classList.remove('show');
    this.pauseEl.classList.remove('show');
    this.resultEl.classList.remove('show');
    this.renderWorkshop(save);
    this.selected = Math.min(save.unlocked, this.selected) as SectorId;
    if (this.selected < 1) this.selected = 1;
    this.renderSectorList(save);
    this.hideBanner();
  }

  private renderSectorList(save: SaveData): void {
    const list = this.title.querySelector('.sector-list')!;
    list.innerHTML = '';
    for (const id of [1, 2, 3, 4] as SectorId[]) {
      const meta = SECTOR_META[id];
      const rec = save.records[id];
      const locked = id > save.unlocked;
      const card = el('button', `sector-card s${id}${locked ? ' locked' : ''}${this.selected === id ? ' sel' : ''}`);
      card.dataset.testid = `sector-${id}`;
      card.innerHTML = `
        <div class="sc-num">0${id}</div>
        <div class="sc-body">
          <div class="sc-name">${meta.name}</div>
          <div class="sc-boss">首领 · ${meta.bossTitle}</div>
          ${!locked && this.selected === id ? `<div class="sc-ch">${SECTOR_CHALLENGES[id].map((c) => `<span class="${save.challenges.includes(c.id) ? 'ok' : ''}">${save.challenges.includes(c.id) ? '✓' : '○'} ${c.text}</span>`).join('')}</div>` : ''}
        </div>
        <div class="sc-stars">${locked ? '🔒' : [0, 1, 2].map((i) => `<span class="${i < rec.stars ? 'on' : ''}">★</span>`).join('')}</div>`;
      if (!locked) {
        card.addEventListener('click', () => {
          this.selected = id;
          this.renderSectorList(save);
        });
      }
      list.appendChild(card);
    }
  }

  hideTitle(): void {
    this.title.classList.remove('show');
  }

  showHelp(v: boolean): void {
    this.helpEl.classList.toggle('show', v);
  }

  showHud(sector: SectorId): void {
    this.hud.classList.add('show');
    this.hud.dataset.sector = String(sector);
    this.bossBar.classList.remove('show');
    this.progressWrap.classList.remove('hide');
    this.lastSquad = -1;
    this.lastWeaponKey = '';
    this.lastScore = -1;
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
      this.pauseEl.querySelector('.pause-info')!.innerHTML = `
        <div><span>蜂群</span><b>${snap.squadCount}</b></div>
        <div><span>武器</span><b style="color:${w.color}">${w.name} Lv${snap.weaponLevel}</b></div>
        <div><span>进度</span><b>${Math.round(snap.runwayProgress * 100)}%</b></div>`;
    }
  }

  setMuted(m: boolean): void {
    for (const b of this.muteBtns) {
      b.textContent = m ? '🔇' : '🔊';
      b.classList.toggle('off', m);
    }
  }

  // ------------------------------------------------------------------ HUD update
  updateHud(snap: SimSnapshot, score: number, badgePos: { x: number; y: number }): void {
    // squad badge follows the swarm
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

    const wkey = `${snap.weapon}${snap.weaponLevel}`;
    if (wkey !== this.lastWeaponKey) {
      this.lastWeaponKey = wkey;
      const w = REWARD_META[snap.weapon];
      this.weaponChip.innerHTML = `<span class="g" style="color:${w.color}">${w.glyph}</span><span class="n">${w.name}</span><span class="lv">${[1, 2, 3].map((i) => `<i class="${i <= snap.weaponLevel ? 'on' : ''}"></i>`).join('')}</span>`;
      this.weaponChip.style.setProperty('--wc', w.color);
      this.weaponChip.classList.remove('pop');
      void this.weaponChip.offsetWidth;
      this.weaponChip.classList.add('pop');
    }
    if (snap.bladesCount > 0) {
      this.bladesChip.classList.add('show');
      this.bladesChip.innerHTML = `<span class="g">✦</span>环轨刃 ×${snap.bladesCount}`;
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
    if (ready !== this.resoReady) {
      this.resoReady = ready;
      this.resoWrap.classList.toggle('ready', ready);
      this.resoLabel.textContent = ready ? '点击 / 空格 超载' : '共鸣';
    }
    this.root.classList.toggle('overdrive', od);

    const b = snap.boss;
    if (b && b.active) {
      this.bossBar.classList.add('show');
      this.progressWrap.classList.add('hide');
      const meta = BOSS_META[b.id];
      const enraged = (b.enrage ?? 1) > 1;
      this.bossName.textContent = `${meta.name}《${meta.title}》${enraged ? ' · 狂暴' : ''}`;
      this.bossBar.classList.toggle('enraged', enraged);
      this.bossPhase.innerHTML = Array.from({ length: b.maxPhases }, (_, i) => `<i class="${i < b.phase ? 'on' : ''}"></i>`).join('');
      this.bossFill.style.width = `${Math.max(0, (b.hp / b.maxHp) * 100).toFixed(2)}%`;
      this.bossBar.classList.toggle('shielded', b.shielded && !b.secondaryCore);
    } else if (!b) {
      this.bossBar.classList.remove('show');
      this.progressWrap.classList.remove('hide');
    }
  }

  // ------------------------------------------------------------------ feedback
  floatText(x: number, y: number, text: string, cls: string, dur = 0.9): void {
    // Deduplicate identical callouts fired on the exact same beat
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

  showBanner(html: string, cls: string, ms = 1600): void {
    this.banner.className = `banner ${cls}`;
    this.banner.innerHTML = html;
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

  rewardBanner(reward: RewardId, level: number): void {
    const m = REWARD_META[reward];
    const lvl = reward === 'blades' ? `×${level}` : `Lv${level}`;
    this.showBanner(
      `<div class="b-kicker">${reward === 'blades' ? '护卫展开' : level > 1 ? '武器升级' : '获得武器'}</div>
       <div class="b-title" style="color:${m.color}">${m.glyph} ${m.name} ${lvl}</div>
       <div class="b-sub">${m.desc}</div>`,
      'reward',
      1700,
    );
  }

  bossWarning(name: string, title: string): void {
    this.showBanner(
      `<div class="b-warn">⚠ WARNING ⚠</div><div class="b-title">${title}</div><div class="b-sub">${name} 正在接近</div>`,
      'boss',
      2300,
    );
  }

  toast(text: string, ms = 2600): void {
    this.toastEl.innerHTML = text;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  combo(n: number): void {
    this.comboEl.innerHTML = `<b>${n}</b> 连杀`;
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
    const finale = r.victory && r.sector === 3;
    this.resultEl.innerHTML = `
      <div class="panel result-panel ${r.victory ? 'win' : 'lose'}">
        <div class="r-kicker">${meta.subtitle}</div>
        <h2 class="r-title">${r.victory ? (finale ? '奇点终结 · 全线通关' : '区域突破') : '蜂群信号丢失'}</h2>
        ${r.victory ? `<div class="stars">${[0, 1, 2].map((i) => `<span class="star" data-i="${i}">★</span>`).join('')}</div>` : `
          <div class="defeat-box" data-testid="defeat-reason">
            <div class="d-title">${reason?.title ?? ''}</div>
            <div class="d-tip">💡 ${reason?.tip ?? ''}</div>
            ${r.bossHpFrac !== null ? `<div class="d-prog boss"><div style="width:${Math.round(r.bossHpFrac * 100)}%"></div><span>首领剩余血量 ${Math.max(1, Math.round(r.bossHpFrac * 100))}%${r.bossHpFrac < 0.35 ? ' · 差一点！' : ''}</span></div>` : `<div class="d-prog"><div style="width:${Math.round(r.progress * 100)}%"></div><span>推进 ${Math.round(r.progress * 100)}%</span></div>`}
          </div>`}
        <div class="r-score"><span>得分</span><b data-testid="result-score">0</b>${r.newBest ? '<em>新纪录!</em>' : `<small>最佳 ${r.best.toLocaleString('en-US')}</small>`}</div>
        <div class="r-stats">
          <div><span>剩余蜂群</span><b data-testid="result-squad">${r.stats.finalSquad}</b></div>
          <div><span>峰值蜂群</span><b>${r.stats.peakSquad}</b></div>
          <div><span>击杀</span><b>${r.stats.kills}</b></div>
          <div><span>改善数字门</span><b>${r.stats.gatesImproved}</b></div>
          <div><span>击破能量舱</span><b>${r.stats.vaultsCracked}</b></div>
          <div><span>爆炸连锁</span><b>${r.stats.maxChain}</b></div>
          <div><span>最高连杀</span><b>${r.maxCombo}</b></div>
          <div><span>用时</span><b>${mm}:${ss}</b></div>
        </div>
        <div class="r-ch" data-testid="result-challenges">${r.challenges.map((c) => `<div class="${c.done ? 'ok' : ''}${c.isNew ? ' new' : ''}"><i>${c.done ? '✓' : '○'}</i>${c.text}<b>${c.isNew ? `+${c.reward}` : c.done ? '已完成' : `${CORE_GLYPH}${c.reward}`}</b></div>`).join('')}</div>
        <div class="r-cores" data-testid="result-cores">
          <div class="rc-main"><i>${CORE_GLYPH}</i> +<b>${r.cores.total}</b> 晶核 <small>（共 ${r.cores.balance.toLocaleString('en-US')}）</small></div>
          <div class="rc-lines">${r.cores.lines.filter(([k]) => !k.startsWith('挑战·')).map(([k, v]) => `<span>${k} +${v}</span>`).join('')}${r.challenges.some((c) => c.isNew) ? '<span>挑战奖励（见上）</span>' : ''}</div>
          ${r.cores.affordable ? '<div class="rc-tip">可在主页「强化工坊」升级蜂群！</div>' : ''}
        </div>
        ${r.victory ? `<div class="r-goal">★★ 剩余 ≥ ${meta.starSquad[0]}　★★★ 剩余 ≥ ${meta.starSquad[1]}</div>` : ''}
        <div class="r-btns">
          ${r.hasNext ? '<button class="big-btn" data-testid="next-btn">下一关 ▶</button>' : ''}
          <button class="${r.hasNext ? 'mid-btn' : 'big-btn'}" data-testid="retry-btn">${r.victory ? (r.sector === 4 ? '新布局再战' : '再战一次') : '重新挑战'}</button>
          <button class="mid-btn ghost" data-testid="result-home-btn">返回主页</button>
        </div>
      </div>`;
    this.resultEl.classList.add('show');
    this.resultEl.querySelector('[data-testid=next-btn]')?.addEventListener('click', () => this.cb.onNext());
    this.resultEl.querySelector('[data-testid=retry-btn]')!.addEventListener('click', () => this.cb.onRetry());
    this.resultEl.querySelector('[data-testid=result-home-btn]')!.addEventListener('click', () => this.cb.onHome());

    // count-up score & stars
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
