import { newGame } from '../src/rules/game';
import type { GameState, Tile } from '../src/state/types';

/** Mapa artificial todo de pradaria, para testes de regras isolados. */
export function flatGame(width = 12, height = 10): GameState {
  const s = newGame({ seed: 'teste', mapSize: 'small', civId: 'tamaru' });
  const tiles: Tile[] = Array.from({ length: width * height }, () => ({ terrain: 'grassland', hills: false, rivers: 0 }));
  s.map = { width, height, tiles };
  s.players[0].explored = new Array(tiles.length).fill(1);
  for (const p of s.players.slice(1)) p.explored = new Array(tiles.length).fill(0);
  s.units = [];
  s.cities = [];
  s.camps = [];
  return s;
}
