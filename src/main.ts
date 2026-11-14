import './styles/main.css';
import { Game } from './app/Game';

function boot(): void {
  const stage = document.querySelector<HTMLElement>('[data-testid="game-stage"]');
  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
  const uiRoot = document.querySelector<HTMLElement>('#ui-root');
  if (!stage || !canvas || !uiRoot) throw new Error('Missing game DOM shell');
  const game = new Game(stage, canvas, uiRoot);
  game.start();
  (window as unknown as { __prism: Game }).__prism = game;
}

boot();
