import { UNITS } from '../data/units';
import { emptyYields, type Yields } from '../data/yields';
import type { City, GameState, TradeRoute, Unit } from '../state/types';
import { hasMet, isAtWar } from './diplomacy';
import { modifiersFor } from './effects';
import { distance, neighbors } from './hex';
import { isPassableLand } from './tiles';

/**
 * Rotas comerciais: o Comerciante, numa cidade sua, cria uma rota permanente até
 * outra cidade (sua ou de alguém em paz, até 15 hexágonos). Rotas internas rendem
 * comida/produção; internacionais rendem ouro (mais para destinos com distritos).
 * A rota constrói estradas no caminho por terra. Guerra ou perda de cidade a cancela.
 */

export const TRADE_RANGE = 15;

export function tradeCapacity(state: GameState, playerId: number): number {
  let n = 1;
  for (const c of state.cities) {
    if (c.owner !== playerId) continue;
    n += c.districts.filter((d) => d.type === 'commercial' || d.type === 'harbor').length;
  }
  return n;
}

export function routesOf(state: GameState, playerId: number): TradeRoute[] {
  return state.tradeRoutes.filter((r) => r.owner === playerId);
}

function cityById(state: GameState, id: number): City | undefined {
  return state.cities.find((c) => c.id === id);
}

export function isInternational(state: GameState, r: TradeRoute): boolean {
  const to = cityById(state, r.to);
  return !!to && to.owner !== r.owner;
}

/** Rendimentos que a rota dá à cidade de origem e à de destino. */
export function routeYields(state: GameState, r: TradeRoute): { origin: Yields; dest: Yields } {
  const origin = emptyYields();
  const dest = emptyYields();
  const to = cityById(state, r.to);
  if (!to) return { origin, dest };
  if (isInternational(state, r)) {
    origin.gold += 3 + to.districts.length + (to.districts.some((d) => d.type === 'commercial') ? 1 : 0);
    dest.gold += 1;
  } else {
    origin.food += 1;
    origin.production += 1;
  }
  origin.gold += modifiersFor(state, r.owner).tradeRouteGold;
  return { origin, dest };
}

export function tradeYieldsForCity(state: GameState, city: City): Yields {
  const y = emptyYields();
  for (const r of state.tradeRoutes) {
    if (r.from !== city.id && r.to !== city.id) continue;
    const ry = routeYields(state, r);
    const part = r.from === city.id ? ry.origin : ry.dest;
    for (const k of Object.keys(y) as (keyof Yields)[]) y[k] += part[k];
  }
  return y;
}

/** Destinos válidos para um comerciante parado numa cidade sua. */
export function tradeDestinations(state: GameState, u: Unit): City[] {
  if (!UNITS[u.type]?.trader) return [];
  const origin = state.cities.find((c) => c.pos === u.pos && c.owner === u.owner);
  if (!origin) return [];
  return state.cities.filter((c) => {
    if (c.id === origin.id) return false;
    if (distance(state.map, origin.pos, c.pos) > TRADE_RANGE) return false;
    const owner = state.players[c.owner];
    if (owner.isBarbarian) return false;
    if (c.owner !== u.owner && (!hasMet(state, u.owner, c.owner) || isAtWar(state, u.owner, c.owner))) return false;
    if (state.tradeRoutes.some((r) => r.from === origin.id && r.to === c.id)) return false;
    return true;
  });
}

export function cannotTrade(state: GameState, u: Unit, destCityId: number): string | null {
  if (!UNITS[u.type]?.trader) return 'Apenas comerciantes.';
  if (!state.cities.some((c) => c.pos === u.pos && c.owner === u.owner)) return 'O comerciante precisa estar numa cidade sua.';
  if (routesOf(state, u.owner).length >= tradeCapacity(state, u.owner)) {
    return 'Capacidade de rotas esgotada (construa Centro Comercial ou Porto).';
  }
  if (!tradeDestinations(state, u).some((c) => c.id === destCityId)) return 'Destino inválido.';
  return null;
}

/** Caminho por terra (BFS) para construir estradas; ignora unidades e fronteiras. */
function landPath(state: GameState, from: number, to: number): number[] {
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const n of neighbors(state.map, cur)) {
      if (n < 0 || prev.has(n)) continue;
      if (n !== to && !isPassableLand(state.map.tiles[n])) continue;
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!prev.has(to)) return [];
  const path: number[] = [];
  for (let c = to; c !== -1; c = prev.get(c)!) path.push(c);
  return path.reverse();
}

export function establishRoute(state: GameState, u: Unit, destCityId: number): string | TradeRoute {
  const why = cannotTrade(state, u, destCityId);
  if (why) return why;
  const origin = state.cities.find((c) => c.pos === u.pos && c.owner === u.owner)!;
  const dest = cityById(state, destCityId)!;
  const route: TradeRoute = { id: state.nextId++, owner: u.owner, from: origin.id, to: dest.id };
  state.tradeRoutes.push(route);
  for (const i of landPath(state, origin.pos, dest.pos)) {
    if (isPassableLand(state.map.tiles[i])) state.map.tiles[i].road = true;
  }
  state.units = state.units.filter((x) => x.id !== u.id);
  return route;
}

/** Remove rotas inválidas (cidade perdida, dono trocado, guerra). Muta. Retorna quantas caíram. */
export function cleanRoutes(state: GameState): TradeRoute[] {
  const removed: TradeRoute[] = [];
  state.tradeRoutes = state.tradeRoutes.filter((r) => {
    const a = cityById(state, r.from);
    const b = cityById(state, r.to);
    const ok = !!a && !!b && a.owner === r.owner && (b.owner === r.owner || !isAtWar(state, r.owner, b.owner));
    if (!ok) removed.push(r);
    return ok;
  });
  return removed;
}
