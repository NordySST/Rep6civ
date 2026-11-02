import { CIV_BY_ID } from '../data/civs';
import { UNITS } from '../data/units';
import type { City, GameState, Unit } from '../state/types';
import { distance, tilesInRadius } from './hex';
import { assignCitizens } from './cities';
import { isPassableLand } from './tiles';

/** Distância mínima entre centros de cidades (em hexágonos). */
export const MIN_CITY_DISTANCE = 4;
/** Raio do território inicial de uma cidade. */
export const INITIAL_TERRITORY_RADIUS = 1;

export type FoundCityCheck = { ok: true } | { ok: false; reason: string };

export function canFoundCity(state: GameState, unit: Unit): FoundCityCheck {
  if (!UNITS[unit.type]?.canFoundCity) return { ok: false, reason: 'Esta unidade não pode fundar cidades.' };
  if (unit.movesLeft <= 0) return { ok: false, reason: 'Sem movimentos restantes neste turno.' };
  const t = state.map.tiles[unit.pos];
  if (!isPassableLand(t)) return { ok: false, reason: 'Terreno inválido para uma cidade.' };
  if (t.owner !== undefined && t.owner !== unit.owner) {
    return { ok: false, reason: 'Território de outra civilização.' };
  }
  for (const c of state.cities) {
    if (distance(state.map, c.pos, unit.pos) < MIN_CITY_DISTANCE) {
      return { ok: false, reason: `Muito perto de ${c.name} (mínimo ${MIN_CITY_DISTANCE} hexágonos).` };
    }
  }
  return { ok: true };
}

export function nextCityName(state: GameState, playerId: number): string {
  const p = state.players[playerId];
  const civ = CIV_BY_ID[p.civId];
  const names = civ?.cityNames ?? ['Cidade'];
  const n = p.citiesFounded;
  if (n < names.length) return names[n];
  return `${names[n % names.length]} ${Math.floor(n / names.length) + 1}`;
}

/** Funda a cidade (muta `state`) consumindo o colono. */
export function foundCity(state: GameState, unit: Unit): City {
  const p = state.players[unit.owner];
  const city: City = {
    id: state.nextId++,
    name: nextCityName(state, unit.owner),
    owner: unit.owner,
    pos: unit.pos,
    population: 1,
    foundedTurn: state.turn,
    isCapital: !state.cities.some((c) => c.owner === unit.owner),
    foodStored: 0,
    queue: [],
    progress: {},
    worked: [],
    locked: [],
    focus: 'balanced',
    buildings: [],
    cultureStored: 0,
    cultureTiles: 0,
    hp: 200,
    districts: [],
    wonders: [],
    pressure: {},
  };
  if (city.isCapital) {
    city.buildings.push('palace');
    if (!state.players[unit.owner].isCityState && p.citiesFounded <= 1) city.originalCapitalOf = unit.owner;
  }
  p.citiesFounded++;
  state.cities.push(city);
  for (const i of tilesInRadius(state.map, unit.pos, INITIAL_TERRITORY_RADIUS)) {
    const t = state.map.tiles[i];
    if (t.owner === undefined) {
      t.owner = unit.owner;
      t.cityId = city.id;
    }
  }
  // o centro da cidade perde floresta/selva/pântano e melhorias
  const center = state.map.tiles[unit.pos];
  delete center.feature;
  delete center.improvement;
  center.owner = unit.owner;
  center.cityId = city.id;
  state.units = state.units.filter((u) => u.id !== unit.id);
  assignCitizens(state, city);
  return city;
}
