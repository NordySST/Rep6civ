import { CITY_STATES } from '../data/cityStates';
import { CIVS } from '../data/civs';
import { MAP_SIZES, type MapSizeId } from '../data/mapSizes';
import { UNITS } from '../data/units';
import type { GameState, Player, Unit } from '../state/types';
import { SCHEMA_VERSION } from '../state/version';
import { maxCamps, spawnCamp } from './barbarians';
import { foundCity } from './city';
import { neighbors } from './hex';
import { findStartPositions, generateMap } from './mapgen';
import { createRng } from './rng';
import { isPassableLand } from './tiles';
import { revealForPlayer } from './visibility';

export interface NewGameOptions {
  seed: string;
  mapSize: MapSizeId;
  civId: string;
  /** Nº de civilizações rivais (padrão do tamanho do mapa). */
  rivals?: number;
  /** Nº de cidades-estado (padrão do tamanho do mapa). */
  cityStates?: number;
}

export function createUnit(state: GameState, type: string, owner: number, pos: number): Unit {
  const u: Unit = { id: state.nextId++, type, owner, pos, movesLeft: UNITS[type].moves, hp: 100, xp: 0, promotions: [] };
  if (UNITS[type].charges) u.charges = UNITS[type].charges;
  state.units.push(u);
  return u;
}

export function makePlayer(id: number, civId: string, tiles: number, extra: Partial<Player> = {}): Player {
  return {
    id,
    civId,
    isHuman: false,
    explored: new Array(tiles).fill(0),
    citiesFounded: 0,
    gold: 10,
    science: 0,
    culture: 0,
    faith: 0,
    techs: [],
    researching: null,
    techProgress: {},
    civics: [],
    researchingCivic: null,
    civicProgress: {},
    boosts: [],
    government: null,
    policies: [],
    policyChangeAvailable: false,
    envoyTokens: 0,
    gpPoints: {},
    ...extra,
  };
}

export function barbarianPlayer(id: number, tiles: number): Player {
  return makePlayer(id, 'barbarian', tiles, { isBarbarian: true, gold: 0 });
}

/**
 * Ordem dos jogadores: 0 = humano, 1 = bárbaros, depois civilizações rivais e,
 * por fim, cidades-estado.
 */
export function newGame(opts: NewGameOptions): GameState {
  const { map } = generateMap({ seed: opts.seed, size: opts.mapSize });
  const size = MAP_SIZES[opts.mapSize];
  const civId = CIVS.some((c) => c.id === opts.civId) ? opts.civId : CIVS[0].id;
  const n = map.tiles.length;
  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    settings: { seed: opts.seed, mapSize: opts.mapSize },
    turn: 1,
    currentPlayer: 0,
    map,
    players: [makePlayer(0, civId, n, { isHuman: true }), barbarianPlayer(1, n)],
    units: [],
    cities: [],
    camps: [],
    diplomacy: {},
    proposals: [],
    tradeRoutes: [],
    religions: [],
    gpRecruited: {},
    nextId: 1,
    rngCounter: 0,
  };
  const rng = createRng(`${opts.seed}|players`);
  const rivalCount = Math.max(0, Math.min(CIVS.length - 1, opts.rivals ?? size.rivals));
  const csCount = Math.max(0, Math.min(CITY_STATES.length, opts.cityStates ?? size.cityStates));
  const rivals = rng.shuffle(CIVS.filter((c) => c.id !== civId)).slice(0, rivalCount);
  const cityStates = rng.shuffle([...CITY_STATES]).slice(0, csCount);
  for (const r of rivals) state.players.push(makePlayer(state.players.length, r.id, n));
  for (const cs of cityStates) state.players.push(makePlayer(state.players.length, cs.id, n, { isCityState: true, envoys: {} }));

  const majors = state.players.filter((p) => !p.isBarbarian && !p.isCityState);
  const starts = findStartPositions(map, majors.length + cityStates.length, opts.seed);
  const all = state.players.filter((p) => !p.isBarbarian);
  all.forEach((p, k) => {
    const start = starts[k] ?? starts[0];
    if (p.isCityState) {
      // cidade-estado já começa com a cidade fundada e um guerreiro
      const settler = createUnit(state, 'settler', p.id, start);
      const city = foundCity(state, settler);
      city.buildings = city.buildings.filter((b) => b !== 'palace');
      city.queue.push({ kind: 'unit', id: 'warrior' });
      createUnit(state, 'warrior', p.id, start);
    } else {
      createUnit(state, 'settler', p.id, start);
      const adj = neighbors(map, start).filter((x) => x >= 0 && isPassableLand(map.tiles[x]));
      createUnit(state, 'warrior', p.id, adj[0] ?? start);
    }
    revealForPlayer(state, p.id);
  });
  // acampamentos bárbaros iniciais, longe de todos
  for (let k = 0; k < Math.max(1, maxCamps(state) - 1); k++) spawnCamp(state, starts);
  return state;
}

/** Ano exibido para o turno (calendário fictício simples). */
export function turnYear(turn: number): string {
  const year = -4000 + (turn - 1) * 40;
  return year < 0 ? `${-year} a.C.` : `${year} d.C.`;
}
