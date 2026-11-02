import { FEATURES } from '../data/features';
import { IMPROVEMENTS, type ImprovementId } from '../data/improvements';
import { RESOURCE_BY_ID } from '../data/resources';
import { HILLS, RIVER, TERRAINS } from '../data/terrains';
import { WONDER_BY_ID } from '../data/wonders';
import { addYields, emptyYields, type Yields } from '../data/yields';
import type { GameMap, Tile } from '../state/types';
import { neighbor } from './hex';

export function isWater(t: Tile): boolean {
  return TERRAINS[t.terrain].isWater;
}

export function isLand(t: Tile): boolean {
  return !isWater(t);
}

/** Pode ser ocupado por unidades terrestres? */
export function isPassableLand(t: Tile): boolean {
  if (isWater(t)) return false;
  if (TERRAINS[t.terrain].impassable) return false;
  if (t.wonder && WONDER_BY_ID[t.wonder]?.impassable) return false;
  return true;
}

export function hasRiver(t: Tile): boolean {
  return t.rivers !== 0;
}

/** Existe rio na aresta entre `a` e seu vizinho na direção `dir`? */
export function riverOnEdge(t: Tile, dir: number): boolean {
  return (t.rivers & (1 << dir)) !== 0;
}

export function setRiverEdge(map: GameMap, idx: number, dir: number): void {
  const n = neighbor(map, idx, dir);
  map.tiles[idx].rivers |= 1 << dir;
  if (n >= 0) map.tiles[n].rivers |= 1 << ((dir + 3) % 6);
}

export function isCoastalLand(map: GameMap, idx: number): boolean {
  if (!isLand(map.tiles[idx])) return false;
  for (let d = 0; d < 6; d++) {
    const n = neighbor(map, idx, d);
    if (n >= 0 && isWater(map.tiles[n])) return true;
  }
  return false;
}

/**
 * Recurso visível para quem conhece `techs`. Recursos com `revealedBy` ficam
 * ocultos (sem rendimento, sem melhoria) até a tecnologia. `techs` indefinido = tudo visível.
 */
export function visibleResource(t: Tile, techs?: readonly string[]): string | undefined {
  if (!t.resource) return undefined;
  const r = RESOURCE_BY_ID[t.resource];
  if (techs && r?.revealedBy && !techs.includes(r.revealedBy)) return undefined;
  return t.resource;
}

export function tileYields(t: Tile, techs?: readonly string[]): Yields {
  const y = emptyYields();
  addYields(y, TERRAINS[t.terrain].yields);
  if (t.hills) addYields(y, HILLS.yields);
  if (t.feature) addYields(y, FEATURES[t.feature].yields);
  if (t.rivers) addYields(y, RIVER.yields);
  const res = visibleResource(t, techs);
  if (res) addYields(y, RESOURCE_BY_ID[res]?.yields);
  if (t.wonder) addYields(y, WONDER_BY_ID[t.wonder]?.yields);
  if (t.improvement && !t.pillaged) addYields(y, IMPROVEMENTS[t.improvement as ImprovementId]?.yields);
  return y;
}

/** Custo (em pontos de movimento) para entrar no hexágono, sem considerar rios. */
export function enterCost(t: Tile): number {
  if (!isPassableLand(t)) return Infinity;
  let c = TERRAINS[t.terrain].moveCost;
  if (t.hills) c += HILLS.extraMoveCost;
  if (t.feature) c += FEATURES[t.feature].extraMoveCost;
  return c;
}

/** Descrição textual em pt-BR do hexágono (terreno + modificadores). */
export function describeTile(t: Tile): string {
  const parts = [TERRAINS[t.terrain].name];
  if (t.hills) parts.push(HILLS.name);
  if (t.feature) parts.push(FEATURES[t.feature].name);
  if (t.rivers) parts.push(RIVER.name);
  if (t.improvement) parts.push((IMPROVEMENTS[t.improvement as ImprovementId]?.name ?? t.improvement) + (t.pillaged ? ' (saqueada)' : ''));
  if (t.road) parts.push('Estrada');
  return parts.join(' · ');
}
