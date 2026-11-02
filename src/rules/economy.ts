import { BUILDINGS } from '../data/buildings';
import { RESOURCE_BY_ID } from '../data/resources';
import { FOLLOWER_BY_ID } from '../data/religion';
import { UNITS } from '../data/units';
import type { City, GameState } from '../state/types';
import { modifiersFor } from './effects';
import { tilesInRadius } from './hex';

/**
 * Economia: manutenção em ouro (edifícios, distritos, unidades) e comodidades
 * (recursos de luxo melhorados, edifícios, efeitos, religião) com o humor das cidades.
 */

export const LUXURY_CITIES = 4;

export function buildingMaintenance(id: string): number {
  const b = BUILDINGS[id];
  if (!b || b.auto) return 0;
  return b.maintenance ?? 1;
}

export interface Maintenance {
  buildings: number;
  districts: number;
  units: number;
  total: number;
}

/** Manutenção por turno: edifícios + 1 por distrito + 1 por unidade militar além das gratuitas (cidades + 1). */
export function maintenanceOf(state: GameState, playerId: number): Maintenance {
  let buildings = 0;
  let districts = 0;
  let cities = 0;
  for (const c of state.cities) {
    if (c.owner !== playerId) continue;
    cities++;
    for (const b of c.buildings) buildings += buildingMaintenance(b);
    districts += c.districts.length;
  }
  const military = state.units.filter((u) => u.owner === playerId && UNITS[u.type]?.class === 'military').length;
  const units = Math.max(0, military - (cities + 1));
  return { buildings, districts, units, total: buildings + districts + units };
}

// ------------------------------------------------------------------ comodidades

/** Comodidades exigidas: 1 a cada 2 de população a partir da 3ª. */
export function amenitiesNeeded(city: City): number {
  return Math.max(0, Math.ceil((city.population - 2) / 2));
}

/** Tipos de luxo do jogador com a melhoria correspondente no território. */
export function improvedLuxuries(state: GameState, playerId: number): string[] {
  const techs = state.players[playerId]?.techs ?? [];
  const found = new Set<string>();
  for (const c of state.cities) {
    if (c.owner !== playerId) continue;
    for (const i of tilesInRadius(state.map, c.pos, 3)) {
      const t = state.map.tiles[i];
      if (t.owner !== playerId || !t.resource) continue;
      const r = RESOURCE_BY_ID[t.resource];
      if (r?.kind !== 'luxury') continue;
      if (r.revealedBy && !techs.includes(r.revealedBy)) continue;
      if (r.improvement && t.improvement === r.improvement && !t.pillaged) found.add(r.id);
    }
  }
  return [...found].sort();
}

/** Comodidades de luxo por cidade: cada tipo atende até 4 cidades (maiores primeiro). */
export function luxuryAmenities(state: GameState, playerId: number): Map<number, number> {
  const out = new Map<number, number>();
  const cities = state.cities
    .filter((c) => c.owner === playerId)
    .sort((a, b) => b.population - a.population || a.id - b.id);
  const lux = improvedLuxuries(state, playerId).length;
  for (const c of cities) out.set(c.id, 0);
  for (let k = 0; k < lux; k++) {
    // distribui cada tipo para as 4 cidades com menos comodidades de luxo até agora
    const order = [...cities].sort((a, b) => (out.get(a.id)! - out.get(b.id)!) || b.population - a.population || a.id - b.id);
    for (const c of order.slice(0, LUXURY_CITIES)) out.set(c.id, out.get(c.id)! + 1);
  }
  return out;
}

export interface AmenityInfo {
  provided: number;
  needed: number;
  balance: number;
  status: 'ecstatic' | 'content' | 'displeased' | 'unrest';
  label: string;
  /** Percentual aplicado aos rendimentos (exceto comida) e ao crescimento. */
  yieldPct: number;
  growthPct: number;
}

export function amenityStatus(balance: number): Pick<AmenityInfo, 'status' | 'label' | 'yieldPct' | 'growthPct'> {
  if (balance >= 3) return { status: 'ecstatic', label: 'Eufórica', yieldPct: 10, growthPct: 10 };
  if (balance >= 0) return { status: 'content', label: 'Satisfeita', yieldPct: 0, growthPct: 0 };
  if (balance >= -2) return { status: 'displeased', label: 'Descontente', yieldPct: -10, growthPct: -25 };
  return { status: 'unrest', label: 'Em revolta', yieldPct: -30, growthPct: -100 };
}

export function cityAmenities(state: GameState, city: City): AmenityInfo {
  let provided = luxuryAmenities(state, city.owner).get(city.id) ?? 0;
  for (const b of city.buildings) provided += BUILDINGS[b]?.amenities ?? 0;
  provided += modifiersFor(state, city.owner).amenities;
  if (city.religion) {
    const rel = state.religions.find((r) => r.id === city.religion);
    if (rel) provided += FOLLOWER_BY_ID[rel.follower]?.amenities ?? 0;
  }
  const needed = amenitiesNeeded(city);
  const balance = provided - needed;
  return { provided, needed, balance, ...amenityStatus(balance) };
}
