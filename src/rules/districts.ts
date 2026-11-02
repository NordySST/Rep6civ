import { CIV_BY_ID } from '../data/civs';
import { DISTRICTS, DISTRICT_BASE_COST, type DistrictId } from '../data/districts';
import { TECH_BY_ID } from '../data/techs';
import { CIVIC_BY_ID } from '../data/civics';
import { WORLD_WONDER_BY_ID, type WorldWonderDef } from '../data/worldWonders';
import { RESOURCE_BY_ID } from '../data/resources';
import { addYields, emptyYields, type Yields } from '../data/yields';
import type { City, GameState, Tile } from '../state/types';
import { neighbors, tilesInRadius } from './hex';
import { isPassableLand, isWater } from './tiles';

/**
 * Distritos (adjacência, limite por população, posicionamento) e maravilhas
 * mundiais (posicionamento, exclusividade). Também as habilidades únicas das
 * civilizações que alteram rendimentos de hexágonos.
 */

export const DISTRICT_RADIUS = 3;

/** Custo de distrito: 60 + 4 por tecnologia conhecida do dono (encarece ao longo do jogo). */
export function districtCost(state?: GameState, owner?: number): number {
  if (!state || owner === undefined) return DISTRICT_BASE_COST;
  return DISTRICT_BASE_COST + 4 * (state.players[owner]?.techs.length ?? 0);
}

/** Distritos especializados permitidos: 1 + 1 a cada 3 de população além da 1ª. */
export function districtLimit(city: City): number {
  return 1 + Math.floor((city.population - 1) / 3);
}

function queuedTiles(state: GameState): Set<number> {
  const s = new Set<number>();
  for (const c of state.cities) for (const q of c.queue) if (q.tile !== undefined) s.add(q.tile);
  return s;
}

function knows(state: GameState, owner: number, tech?: string, civic?: string): string | null {
  const p = state.players[owner];
  if (tech && !p.techs.includes(tech)) return `Exige ${TECH_BY_ID[tech]?.name ?? tech}.`;
  if (civic && !p.civics.includes(civic)) return `Exige ${CIVIC_BY_ID[civic]?.name ?? civic}.`;
  return null;
}

function basicSiteProblem(state: GameState, city: City, tile: number, water: boolean): string | null {
  const t = state.map.tiles[tile];
  if (!t) return 'Hexágono inválido.';
  if (t.cityId !== city.id) return 'O hexágono precisa ser território desta cidade.';
  if (tile === city.pos || state.cities.some((c) => c.pos === tile)) return 'Não pode ser o centro da cidade.';
  if (t.district || t.builtWonder || t.wonder) return 'Hexágono já ocupado.';
  if (queuedTiles(state).has(tile)) return 'Hexágono reservado para outra construção.';
  if (water) {
    if (t.terrain !== 'coast') return 'Precisa ser costa.';
    if (!neighbors(state.map, tile).some((n) => n >= 0 && !isWater(state.map.tiles[n]))) return 'Precisa estar junto à terra.';
  } else if (!isPassableLand(t)) return 'Terreno inválido.';
  if (t.resource && RESOURCE_BY_ID[t.resource]?.kind !== 'bonus') return 'Não pode ocupar recurso de luxo ou estratégico.';
  return null;
}

// ------------------------------------------------------------------ distritos

export function cannotBuildDistrict(state: GameState, city: City, id: string): string | null {
  const def = DISTRICTS[id as DistrictId];
  if (!def) return 'Distrito desconhecido.';
  const k = knows(state, city.owner, def.requiresTech, def.requiresCivic);
  if (k) return k;
  if (city.districts.some((d) => d.type === id) || city.queue.some((q) => q.kind === 'district' && q.id === id)) {
    return 'A cidade já tem este distrito.';
  }
  const pending = city.queue.filter((q) => q.kind === 'district').length;
  if (city.districts.length + pending >= districtLimit(city)) return `Limite de distritos (${districtLimit(city)}): cresça a população.`;
  return null;
}

export function cannotPlaceDistrict(state: GameState, city: City, id: string, tile: number): string | null {
  const why = cannotBuildDistrict(state, city, id);
  if (why) return why;
  return basicSiteProblem(state, city, tile, !!DISTRICTS[id as DistrictId].onWater);
}

export function districtSites(state: GameState, city: City, id: string): number[] {
  if (cannotBuildDistrict(state, city, id)) return [];
  const water = !!DISTRICTS[id as DistrictId].onWater;
  return tilesInRadius(state.map, city.pos, DISTRICT_RADIUS).filter((i) => !basicSiteProblem(state, city, i, water));
}

/** Bônus de adjacência de um distrito `id` no hexágono `pos` (arredondado para baixo). */
export function adjacencyBonus(state: GameState, pos: number, id: string): number {
  const def = DISTRICTS[id as DistrictId];
  if (!def) return 0;
  const t = state.map.tiles[pos];
  let total = 0;
  const ns = neighbors(state.map, pos)
    .filter((n) => n >= 0)
    .map((n) => ({ n, t: state.map.tiles[n] }));
  for (const rule of def.adjacency) {
    let count = 0;
    switch (rule.source) {
      case 'mountain':
        count = ns.filter((x) => x.t.terrain === 'mountain').length;
        break;
      case 'jungle':
        count = ns.filter((x) => x.t.feature === 'jungle').length;
        break;
      case 'forest':
        count = ns.filter((x) => x.t.feature === 'forest').length;
        break;
      case 'naturalWonder':
        count = ns.filter((x) => x.t.wonder).length;
        break;
      case 'worldWonder':
        count = ns.filter((x) => x.t.builtWonder).length;
        break;
      case 'district':
        count = ns.filter((x) => x.t.district || state.cities.some((c) => c.pos === x.n)).length;
        break;
      case 'river':
        count = t.rivers ? 1 : 0;
        break;
      case 'mine':
        count = ns.filter((x) => x.t.improvement === 'mine').length;
        break;
      case 'quarry':
        count = ns.filter((x) => x.t.improvement === 'quarry').length;
        break;
      case 'cityCenter':
        count = ns.filter((x) => state.cities.some((c) => c.pos === x.n)).length;
        break;
      case 'seaResource':
        count = ns.filter((x) => x.t.resource && isWater(x.t)).length;
        break;
    }
    total += count * rule.amount;
  }
  return Math.floor(total);
}

/** Rendimento de todos os distritos da cidade (adjacência). */
export function districtYields(state: GameState, city: City): Yields {
  const y = emptyYields();
  for (const d of city.districts) {
    const def = DISTRICTS[d.type as DistrictId];
    if (def?.yieldKey) y[def.yieldKey] += adjacencyBonus(state, d.pos, d.type);
  }
  return y;
}

export function hasDistrict(city: City, id: string): boolean {
  return city.districts.some((d) => d.type === id);
}

/** Conclui o distrito (muta): ocupa o hexágono, remove melhoria/característica. */
export function completeDistrict(state: GameState, city: City, id: string, tile: number): void {
  const t = state.map.tiles[tile];
  t.district = id;
  delete t.improvement;
  if (t.feature) delete t.feature;
  city.districts.push({ type: id, pos: tile });
}

// ------------------------------------------------------------------ maravilhas mundiais

export function wonderOwner(state: GameState, id: string): City | undefined {
  return state.cities.find((c) => c.wonders.includes(id));
}

function placementProblem(state: GameState, w: WorldWonderDef, tile: number): string | null {
  const t = state.map.tiles[tile];
  const p = w.placement;
  if (p.terrains && !p.terrains.includes(t.terrain)) return 'Terreno inadequado.';
  if (p.hills !== undefined && p.hills !== t.hills) return p.hills ? 'Precisa de colinas.' : 'Precisa de terreno plano.';
  if (p.river && !t.rivers) return 'Precisa de rio.';
  const ns = neighbors(state.map, tile).filter((n) => n >= 0);
  if (p.coastal && !ns.some((n) => isWater(state.map.tiles[n]))) return 'Precisa estar na costa.';
  if (p.nearMountain && !ns.some((n) => state.map.tiles[n].terrain === 'mountain')) return 'Precisa estar junto a uma montanha.';
  if (p.nearDistrict && !ns.some((n) => state.map.tiles[n].district === p.nearDistrict)) return 'Precisa estar junto ao distrito exigido.';
  return null;
}

export function cannotBuildWonder(state: GameState, city: City, id: string): string | null {
  const w = WORLD_WONDER_BY_ID[id];
  if (!w) return 'Maravilha desconhecida.';
  const k = knows(state, city.owner, w.requiresTech, w.requiresCivic);
  if (k) return k;
  const owner = wonderOwner(state, id);
  if (owner) return `Já construída em ${owner.name}.`;
  if (state.cities.some((c) => c.owner === city.owner && c.id !== city.id && c.queue.some((q) => q.kind === 'wonder' && q.id === id))) {
    return 'Outra cidade sua já está construindo.';
  }
  return null;
}

export function cannotPlaceWonder(state: GameState, city: City, id: string, tile: number): string | null {
  const why = cannotBuildWonder(state, city, id);
  if (why) return why;
  const base = basicSiteProblem(state, city, tile, false);
  if (base) return base;
  return placementProblem(state, WORLD_WONDER_BY_ID[id], tile);
}

export function wonderSites(state: GameState, city: City, id: string): number[] {
  if (cannotBuildWonder(state, city, id)) return [];
  const w = WORLD_WONDER_BY_ID[id];
  return tilesInRadius(state.map, city.pos, DISTRICT_RADIUS).filter(
    (i) => !basicSiteProblem(state, city, i, false) && !placementProblem(state, w, i),
  );
}

export function wonderCityYields(city: City): Yields {
  const y = emptyYields();
  for (const w of city.wonders) addYields(y, WORLD_WONDER_BY_ID[w]?.cityYields);
  return y;
}

/** Conclui a maravilha (muta). Outras cidades que a construíam perdem o item. */
export function completeWonder(state: GameState, city: City, id: string, tile: number): void {
  const t = state.map.tiles[tile];
  t.builtWonder = id;
  delete t.improvement;
  if (t.feature) delete t.feature;
  city.wonders.push(id);
  for (const c of state.cities) {
    if (c.id === city.id) continue;
    c.queue = c.queue.filter((q) => !(q.kind === 'wonder' && q.id === id));
  }
}

// ------------------------------------------------------------------ habilidades únicas

/** Bônus de hexágono da habilidade da civilização dona. */
export function abilityTileBonus(civId: string | undefined, t: Tile): Yields | null {
  switch (civId) {
    case 'tamaru':
      return t.rivers ? { ...emptyYields(), science: 1 } : null;
    case 'norvhal':
      return t.terrain === 'tundra' || t.terrain === 'snow' ? { ...emptyYields(), production: 1 } : null;
    case 'qasmira':
      return t.terrain === 'desert' ? { ...emptyYields(), gold: 1, faith: 1 } : null;
    case 'ilhavar':
      return t.terrain === 'coast' || t.terrain === 'ocean' ? { ...emptyYields(), gold: 1 } : null;
    case 'kaluun':
      return t.terrain === 'plains' ? { ...emptyYields(), production: 1 } : null;
    case 'tzeltani':
      return t.hills ? { ...emptyYields(), food: 1 } : null;
    case 'oskari':
      return t.feature === 'forest' ? { ...emptyYields(), science: 1 } : null;
    default:
      return null;
  }
}

/** Cidade ligada à capital por estradas (hexágonos com estrada/cidades do dono). */
export function connectedToCapital(state: GameState, city: City): boolean {
  if (city.isCapital) return false;
  const cap = state.cities.find((c) => c.owner === city.owner && c.isCapital);
  if (!cap) return false;
  const ok = (i: number) => {
    const t = state.map.tiles[i];
    return (t.road || state.cities.some((c) => c.pos === i && c.owner === city.owner)) && (t.owner === undefined || t.owner === city.owner);
  };
  const seen = new Set([city.pos]);
  const queue = [city.pos];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === cap.pos) return true;
    for (const n of neighbors(state.map, cur)) {
      if (n >= 0 && !seen.has(n) && ok(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return false;
}

/** Rendimento extra da cidade pela habilidade (Valdória: +2 ouro se ligada à capital). */
export function abilityCityBonus(state: GameState, city: City): Yields {
  const y = emptyYields();
  if (CIV_BY_ID[state.players[city.owner]?.civId]?.id === 'valdoria' && connectedToCapital(state, city)) y.gold += 2;
  return y;
}
