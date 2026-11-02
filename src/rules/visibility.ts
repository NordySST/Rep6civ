import { FEATURES } from '../data/features';
import { HILLS } from '../data/terrains';
import { UNITS } from '../data/units';
import type { GameMap, GameState } from '../state/types';
import { promotionSight } from './combat';
import { distance, hexLine, tilesInRadius } from './hex';

/** Raio de visão das cidades. */
export const CITY_SIGHT = 3;

function blocksSight(map: GameMap, idx: number): boolean {
  const t = map.tiles[idx];
  if (t.terrain === 'mountain') return true;
  if (t.feature && FEATURES[t.feature].blocksSight) return true;
  if (t.hills) return true;
  return false;
}

/**
 * Hexágonos visíveis a partir de `from` com raio `radius`.
 * Hexágonos adjacentes são sempre visíveis; além disso, um hexágono intermediário
 * com montanha, colina, floresta ou selva bloqueia a visão — exceto se o observador
 * estiver em colinas, quando apenas montanhas bloqueiam.
 */
export function visibleFrom(map: GameMap, from: number, radius: number): number[] {
  const elevated = map.tiles[from].hills;
  const out: number[] = [];
  for (const idx of tilesInRadius(map, from, radius)) {
    if (distance(map, from, idx) <= 1) {
      out.push(idx);
      continue;
    }
    const line = hexLine(map, from, idx);
    let blocked = false;
    for (let k = 1; k < line.length - 1; k++) {
      const m = line[k];
      if (elevated ? map.tiles[m].terrain === 'mountain' : blocksSight(map, m)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) out.push(idx);
  }
  return out;
}

/** Máscara de visibilidade atual do jogador (derivada, não é salva). */
export function computeVisibility(state: GameState, playerId: number): Uint8Array {
  const { map } = state;
  const vis = new Uint8Array(map.tiles.length);
  for (const u of state.units) {
    if (u.owner !== playerId) continue;
    const def = UNITS[u.type];
    const radius = def.sight + (map.tiles[u.pos].hills ? HILLS.sightBonus : 0) + promotionSight(u);
    for (const i of visibleFrom(map, u.pos, radius)) vis[i] = 1;
  }
  for (const c of state.cities) {
    if (c.owner !== playerId) continue;
    for (const i of visibleFrom(map, c.pos, CITY_SIGHT)) vis[i] = 1;
  }
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i].owner === playerId) vis[i] = 1;
  }
  return vis;
}

/** Marca como explorado tudo que está visível (muta `state`). */
export function revealForPlayer(state: GameState, playerId: number): void {
  const p = state.players[playerId];
  const vis = computeVisibility(state, playerId);
  for (let i = 0; i < vis.length; i++) if (vis[i]) p.explored[i] = 1;
}
