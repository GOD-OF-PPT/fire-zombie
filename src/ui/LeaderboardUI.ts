import type { RankingEntry, RankingPage } from '../services/leaderboard';
import { html, render } from './dom';
import '../styles/leaderboard.css';

interface Callbacks {
  onName(name: string): void;
  onSkipName(): void;
  onOpen(): void;
  onClose(): void;
  onRefresh(): void;
  onPage(offset: number): void;
  onRetry(): void;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = className;
  n.textContent = text;
  return n;
}

function number(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—';
}

/** Network-independent view. Remote names and fields are inserted as text, never HTML. */
export class LeaderboardUI {
  private readonly nameModal = node('div', 'screen modal ranking-name-screen');
  private readonly boardModal = node('div', 'screen modal ranking-screen');
  private readonly nameInput: HTMLInputElement;
  private readonly nameError: HTMLElement;
  private readonly boardStatus: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly ownRank: HTMLElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private offset = 0;
  private limit = 20;
  private resultHost: HTMLElement | null = null;
  private resultStatus: HTMLElement | null = null;
  private retryButton: HTMLButtonElement | null = null;
  private nameButton: HTMLButtonElement | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor(root: HTMLElement, private readonly callbacks: Callbacks) {
    this.nameModal.dataset.testid = 'ranking-name-screen';
    this.nameModal.dataset.uiBlock = '1';
    this.nameModal.setAttribute('role', 'dialog');
    this.nameModal.setAttribute('aria-modal', 'true');
    this.nameModal.setAttribute('aria-labelledby', 'ranking-name-title');
    render(this.nameModal, html`<form class="panel ranking-name-panel">
      <div class="ranking-kicker">ENDLESS LEADERBOARD</div>
      <h2 id="ranking-name-title">为蜂群留下姓名</h2>
      <p>本局成绩已保留。填写姓名，即可参与无尽排行榜。</p>
      <label for="ranking-name-input">姓名 / 昵称</label>
      <input id="ranking-name-input" data-testid="ranking-name-input" type="text" maxlength="80" autocomplete="nickname" placeholder="输入你的姓名或昵称" />
      <div class="ranking-name-error" data-testid="ranking-name-error" role="alert"></div>
      <small>姓名将在榜单公开展示，并保存在此设备；之后无尽结算会自动上报。</small>
      <button class="big-btn" data-testid="ranking-name-submit" type="submit">保存并上榜</button>
      <button class="mid-btn ghost" data-testid="ranking-name-skip" type="button">稍后填写</button>
    </form>`);
    this.nameInput = this.nameModal.querySelector('input')!;
    this.nameError = this.nameModal.querySelector('.ranking-name-error')!;
    this.nameModal.querySelector('form')!.addEventListener('submit', e => {
      e.preventDefault();
      this.callbacks.onName(this.nameInput.value);
    });
    this.nameModal.querySelector('[data-testid=ranking-name-skip]')!.addEventListener('click', () => this.callbacks.onSkipName());
    this.nameModal.addEventListener('keydown', e => this.modalKeys(e, this.nameModal, () => this.callbacks.onSkipName()));

    this.boardModal.dataset.testid = 'leaderboard-screen';
    this.boardModal.dataset.uiBlock = '1';
    this.boardModal.setAttribute('role', 'dialog');
    this.boardModal.setAttribute('aria-modal', 'true');
    this.boardModal.setAttribute('aria-labelledby', 'leaderboard-title');
    render(this.boardModal, html`<div class="panel ranking-panel">
      <div class="ranking-kicker">ENDLESS PROTOCOL</div>
      <h2 id="leaderboard-title">无尽总分榜</h2>
      <p class="ranking-rules">得分优先，同分依次比较阶段、推进距离 · 保留最好的一局</p>
      <div class="ranking-own" data-testid="ranking-own"></div>
      <div class="ranking-list" role="table" aria-label="无尽排行榜">
        <div class="ranking-row ranking-head" role="row"><span role="columnheader">名次</span><span role="columnheader">玩家</span><span role="columnheader">得分</span></div>
        <div class="ranking-rows" role="rowgroup" data-testid="ranking-rows"></div>
      </div>
      <div class="ranking-status" data-testid="ranking-status" role="status" aria-live="polite"></div>
      <div class="ranking-pagination"><button class="mid-btn ghost" data-testid="ranking-prev">上一页</button><button class="mid-btn ghost" data-testid="ranking-refresh">刷新</button><button class="mid-btn ghost" data-testid="ranking-next">下一页</button></div>
      <button class="big-btn" data-testid="ranking-close">返回游戏</button>
    </div>`);
    this.rows = this.boardModal.querySelector('.ranking-rows')!;
    this.boardStatus = this.boardModal.querySelector('.ranking-status')!;
    this.ownRank = this.boardModal.querySelector('.ranking-own')!;
    this.previous = this.boardModal.querySelector('[data-testid=ranking-prev]')!;
    this.next = this.boardModal.querySelector('[data-testid=ranking-next]')!;
    this.previous.addEventListener('click', () => this.callbacks.onPage(Math.max(0, this.offset - this.limit)));
    this.next.addEventListener('click', () => this.callbacks.onPage(this.offset + this.limit));
    this.boardModal.querySelector('[data-testid=ranking-refresh]')!.addEventListener('click', () => this.callbacks.onRefresh());
    this.boardModal.querySelector('[data-testid=ranking-close]')!.addEventListener('click', () => this.callbacks.onClose());
    this.boardModal.addEventListener('keydown', e => this.modalKeys(e, this.boardModal, () => this.callbacks.onClose()));
    root.append(this.nameModal, this.boardModal);
  }

  private modalKeys(e: KeyboardEvent, modal: HTMLElement, close: () => void): void {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll<HTMLElement>('input, button')].filter(n => !(n as HTMLButtonElement).disabled && !n.hidden);
    if (!focusable.length) return;
    e.preventDefault();
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    focusable[(index + (e.shiftKey ? focusable.length - 1 : 1)) % focusable.length]!.focus();
  }

  showName(value = ''): void {
    this.returnFocus = document.activeElement as HTMLElement;
    this.nameInput.value = value;
    this.nameError.textContent = '';
    this.nameModal.classList.add('show');
    this.nameInput.focus({ preventScroll: true });
  }

  hideName(): void {
    const wasOpen = this.nameModal.classList.contains('show');
    this.nameModal.classList.remove('show');
    if (wasOpen && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
  }

  setNameError(message: string): void {
    this.nameError.textContent = message;
    this.nameInput.focus({ preventScroll: true });
  }

  mountResult(host: HTMLElement, hasName: boolean): void {
    this.resultHost = host;
    host.replaceChildren();
    this.resultStatus = node('div', 'ranking-result-status', hasName ? '正在准备上榜…' : '填写姓名后，即可上传本局成绩');
    this.resultStatus.dataset.testid = 'ranking-result-status';
    this.resultStatus.setAttribute('role', 'status');
    this.resultStatus.setAttribute('aria-live', 'polite');
    const actions = node('div', 'ranking-result-actions');
    const open = node('button', 'mid-btn ghost', '查看排行榜');
    open.dataset.testid = 'result-leaderboard-btn';
    open.addEventListener('click', () => this.callbacks.onOpen());
    this.retryButton = node('button', 'mid-btn ghost', '重试上传');
    this.retryButton.dataset.testid = 'ranking-retry';
    this.retryButton.hidden = true;
    this.retryButton.addEventListener('click', () => this.callbacks.onRetry());
    this.nameButton = node('button', 'mid-btn', '填写姓名并上榜');
    this.nameButton.dataset.testid = 'ranking-enter-name';
    this.nameButton.hidden = hasName;
    this.nameButton.addEventListener('click', () => this.showName());
    actions.append(open, this.nameButton, this.retryButton);
    host.append(this.resultStatus, actions);
  }

  detachResult(): void {
    this.resultHost = this.resultStatus = null;
    this.retryButton = this.nameButton = null;
  }

  submission(state: 'name' | 'uploading' | 'done' | 'error', message: string): void {
    if (!this.resultHost?.isConnected || !this.resultStatus) return;
    this.resultStatus.textContent = message;
    this.resultHost.dataset.rankingState = state;
    if (this.retryButton) this.retryButton.hidden = state !== 'error';
    if (this.nameButton) this.nameButton.hidden = state !== 'name';
  }

  open(): void {
    this.returnFocus = document.activeElement as HTMLElement;
    this.boardModal.classList.add('show');
    this.boardModal.querySelector<HTMLButtonElement>('[data-testid=ranking-close]')!.focus({ preventScroll: true });
  }

  close(): void {
    const wasOpen = this.boardModal.classList.contains('show');
    this.boardModal.classList.remove('show');
    if (wasOpen && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
  }

  loading(username: string): void {
    // Disabling a focused pagination button moves focus to the document body.
    // Keep keyboard focus inside the dialog so Escape and the focus trap still work.
    if (document.activeElement === this.previous || document.activeElement === this.next) {
      this.boardModal.querySelector<HTMLButtonElement>('[data-testid=ranking-refresh]')!.focus({ preventScroll: true });
    }
    this.rows.replaceChildren();
    this.boardStatus.textContent = '正在加载排行榜…';
    this.ownRank.textContent = username ? `${username} · 正在查询我的名次…` : '完成无尽挑战后即可上榜';
    this.previous.disabled = this.next.disabled = true;
  }

  showBoard(page: RankingPage, own: RankingEntry | null, username: string, ownUnavailable = false): void {
    this.offset = page.offset;
    this.limit = page.limit;
    this.rows.replaceChildren();
    for (const entry of page.entries) {
      const row = node('div', `ranking-row${entry.playerId === own?.playerId ? ' is-me' : ''}`);
      row.setAttribute('role', 'row');
      const rank = node('span', 'ranking-position', number(entry.rank));
      rank.setAttribute('role', 'cell');
      const player = node('div', 'ranking-player');
      player.setAttribute('role', 'cell');
      const name = node('b', '', entry.username);
      name.title = entry.username;
      const details = node('small', '', `阶段 ${number(entry.metrics.wave)} · ${number(entry.metrics.distance)}m`);
      player.append(name, details);
      const score = node('b', 'ranking-points', number(entry.metrics.score));
      score.setAttribute('role', 'cell');
      row.append(rank, player, score);
      this.rows.append(row);
    }
    if (!page.entries.length) this.rows.append(node('div', 'ranking-empty', '暂无成绩，来留下第一份战绩吧'));
    this.boardStatus.textContent = page.total ? `显示 ${page.offset + 1}–${page.offset + page.entries.length} 条，共 ${number(page.total)} 位玩家` : '等待第一位玩家';
    this.ownRank.textContent = own ? `我的名次 #${number(own.rank)} · ${own.username} · ${number(own.metrics.score)} 分` :
      ownUnavailable ? `${username} · 我的名次暂不可用，可稍后刷新` : username ? `${username} · 当前还未上榜` : '完成无尽挑战后即可上榜';
    this.previous.disabled = page.offset <= 0;
    this.next.disabled = page.offset + page.limit >= page.total || page.offset + page.limit > 10000;
  }

  showBoardError(message: string): void {
    this.rows.replaceChildren();
    this.boardStatus.textContent = message;
    this.ownRank.textContent = '本地成绩不受影响，可以稍后刷新';
    this.previous.disabled = this.next.disabled = true;
  }
}
