import { CIVS } from '../data/civs';
import type { MapSizeId } from '../data/mapSizes';
import { UNITS } from '../data/units';
import type { GameState, Player, Unit } from '../state/types';
import { SCHEMA_VERSION } from '../state/version';
import { neighbors } from './hex';
import { findStartPositions, generateMap } from './mapgen';
import { isPassableLand } from './tiles';
import { revealForPlayer } from './visibility';

export interface NewGameOptions {
  seed: string;
  mapSize: MapSizeId;
  civId: string;
}

export function createUnit(state: GameState, type: string, owner: number, pos: number): Unit {
  const u: Unit = { id: state.nextId++, type, owner, pos, movesLeft: UNITS[type].moves };
  state.units.push(u);
  return u;
}

export function newGame(opts: NewGameOptions): GameState {
  const { map } = generateMap({ seed: opts.seed, size: opts.mapSize });
  const civId = CIVS.some((c) => c.id === opts.civId) ? opts.civId : CIVS[0].id;
  const human: Player = {
    id: 0,
    civId,
    isHuman: true,
    explored: new Array(map.tiles.length).fill(0),
    citiesFounded: 0,
  };
  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    settings: { seed: opts.seed, mapSize: opts.mapSize },
    turn: 1,
    currentPlayer: 0,
    map,
    players: [human],
    units: [],
    cities: [],
    nextId: 1,
  };
  const [start] = findStartPositions(map, 1, opts.seed);
  createUnit(state, 'settler', 0, start);
  const adj = neighbors(map, start).filter((n) => n >= 0 && isPassableLand(map.tiles[n]));
  createUnit(state, 'warrior', 0, adj[0] ?? start);
  revealForPlayer(state, 0);
  return state;
}

/** Ano exibido para o turno (calendário fictício simples). */
export function turnYear(turn: number): string {
  const year = -4000 + (turn - 1) * 40;
  return year < 0 ? `${-year} a.C.` : `${year} d.C.`;
}
