import { CIV_BY_ID } from '../data/civs';
import { UNITS } from '../data/units';
import type { City, GameState, Unit } from '../state/types';
import { distance, tilesInRadius } from './hex';
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
  };
  p.citiesFounded++;
  state.cities.push(city);
  for (const i of tilesInRadius(state.map, unit.pos, INITIAL_TERRITORY_RADIUS)) {
    const t = state.map.tiles[i];
    if (t.owner === undefined) {
      t.owner = unit.owner;
      t.cityId = city.id;
    }
  }
  // remove recursos de "feature" sob o centro? (Civ remove florestas/pântanos)
  const center = state.map.tiles[unit.pos];
  if (center.feature === 'marsh' || center.feature === 'jungle' || center.feature === 'forest') {
    delete center.feature;
  }
  state.units = state.units.filter((u) => u.id !== unit.id);
  return city;
}
