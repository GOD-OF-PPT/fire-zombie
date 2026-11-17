import './styles/main.css';
import { Game } from './app/Game';

const stage = document.querySelector<HTMLElement>('[data-testid=game-stage]')!;
const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
const uiRoot = document.querySelector<HTMLElement>('#ui-root')!;
const game = new Game(stage, canvas, uiRoot, { standaloneCanvas: true });
(window as unknown as { __prism: Game }).__prism = game;
game.start();
