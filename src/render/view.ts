import type { GameState } from '../state/types';
import type { Camera } from './camera';
import type { Overlay } from './renderer';

/**
 * O que o controlador (ui/app.ts) precisa de uma visão do mapa. Há duas: `Renderer`
 * (canvas 2D, render/renderer.ts) e `Renderer3D` (WebGL, render3d/, carregada sob demanda).
 * Ambas usam a mesma câmera lógica (x, y = ponto do mundo no centro; zoom) e só leem o estado.
 */
export interface MapView {
  readonly kind: '2d' | '3d';
  vw: number;
  vh: number;
  resize(): void;
  draw(state: GameState, cam: Camera, vis: Uint8Array, overlay: Overlay): void;
  /** Ponto do mundo (coordenadas 2D do mapa) sob o ponto de tela. */
  pick(cam: Camera, sx: number, sy: number): { x: number; y: number };
  /** Unidades de mundo por pixel arrastado (x e y). */
  panScale(cam: Camera): { x: number; y: number };
  tileToScreen(state: GameState, cam: Camera, idx: number): { x: number; y: number };
  dispose?(): void;
  /** Visões com animação contínua (água, nuvens) pedem quadros extras. */
  wantsFrame?(now: number): boolean;
}
