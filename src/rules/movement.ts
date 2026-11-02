import { ROAD_MOVE_COST } from '../data/improvements';
import { UNITS } from '../data/units';
import type { GameState, Unit } from '../state/types';
import { enemyZoc, promotionMoves } from './combat';
import { canEnterTerritory } from './diplomacy';
import { modifiersFor } from './effects';
import { directionTo, distance, neighbor, neighbors } from './hex';
import { enterCost, isPassableLand, isWater, riverOnEdge } from './tiles';

/**
 * Regras de movimento:
 *  - custo base do terreno (+1 colinas, +1 floresta/selva/pântano);
 *  - cruzar um rio consome todo o movimento restante;
 *  - uma unidade pode sempre entrar num hexágono se tiver algum movimento restante;
 *  - no máximo 1 unidade militar e 1 civil por hexágono (do mesmo dono);
 *  - unidades não entram em hexágonos ocupados por outros jogadores.
 */

/**
 * Custo de entrar em `to` vindo de `from`. Com `zoc` (zona de controle inimiga),
 * mover-se de um hexágono sob ZOC para outro sob ZOC consome todo o movimento.
 */
export function stepCost(state: GameState, from: number, to: number, zoc?: Set<number>, unit?: Unit): number {
  const { map } = state;
  const t = map.tiles[to];
  if (unit && (isNaval(unit) || isWater(t) || isWater(map.tiles[from]))) {
    // navios e unidades embarcadas
    if (!canEnterTerrain(state, unit, to)) return Infinity;
    if (directionTo(map, from, to) < 0) return Infinity;
    const zocStop = !!zoc && zoc.has(from) && zoc.has(to);
    if (isNaval(unit)) return zocStop ? RIVER_CROSSING_COST : 1;
    // embarcar ou desembarcar consome todo o movimento
    const landFrom = !isWater(map.tiles[from]);
    const landTo = !isWater(t);
    if (landFrom !== landTo || zocStop) return RIVER_CROSSING_COST;
    return 1;
  }
  const base = enterCost(t);
  if (!isFinite(base)) return Infinity;
  const dir = directionTo(map, from, to);
  if (dir < 0) return Infinity;
  // estradas (centros de cidade contam como estrada) ignoram terreno e rios
  const zocStop = !!zoc && zoc.has(from) && zoc.has(to);
  if (hasRoad(state, from) && hasRoad(state, to) && !zocStop) return ROAD_MOVE_COST;
  if (riverOnEdge(map.tiles[from], dir) || zocStop) return Math.max(base, RIVER_CROSSING_COST);
  return base;
}

/** Movimento máximo da unidade (definição + bônus de políticas). */
export function maxMoves(state: GameState, unit: Unit): number {
  // Yrkaan (Estepe sem Fim): +1 de movimento para unidades terrestres que estão em planície
  const steppe = state.players[unit.owner]?.civId === 'yrkaan' && state.map.tiles[unit.pos]?.terrain === 'plains' ? 1 : 0;
  return UNITS[unit.type].moves + (modifiersFor(state, unit.owner).extraMoves[unit.type] ?? 0) + promotionMoves(unit) + steppe;
}

export function hasRoad(state: GameState, idx: number): boolean {
  return !!state.map.tiles[idx].road || state.cities.some((c) => c.pos === idx);
}

/** Marcador: cruzar rio custa "tudo" (limitado ao movimento restante na prática). */
export const RIVER_CROSSING_COST = 99;

export function isNaval(unit: Unit): boolean {
  return UNITS[unit.type]?.domain === 'sea';
}

/**
 * A unidade pode estar neste hexágono pelo terreno? Navios: costa (oceano com
 * Navegação Celeste) e as próprias cidades costeiras. Unidades terrestres: terra
 * transitável; embarcam na costa com Navegação à Vela e no oceano com Navegação Celeste.
 */
export function canEnterTerrain(state: GameState, unit: Unit, idx: number): boolean {
  const t = state.map.tiles[idx];
  if (!t) return false;
  const techs = state.players[unit.owner]?.techs ?? [];
  const oceanOk = techs.includes('celestial-navigation');
  if (isNaval(unit)) {
    if (t.terrain === 'coast') return true;
    if (t.terrain === 'ocean') return oceanOk;
    return state.cities.some(
      (c) => c.pos === idx && c.owner === unit.owner && neighbors(state.map, idx).some((n) => n >= 0 && isWater(state.map.tiles[n])),
    );
  }
  if (isPassableLand(t)) return true;
  if (t.terrain === 'coast') return techs.includes('sailing');
  if (t.terrain === 'ocean') return oceanOk;
  return false;
}

export function canOccupy(state: GameState, unit: Unit, to: number): boolean {
  if (!canEnterTerrain(state, unit, to)) return false;
  if (!canEnterTerritory(state, unit.owner, state.map.tiles[to].owner)) return false;
  const cls = UNITS[unit.type].class;
  for (const o of state.units) {
    if (o.pos !== to || o.id === unit.id) continue;
    if (o.owner !== unit.owner) return false;
    if (UNITS[o.type].class === cls) return false;
  }
  const city = state.cities.find((c) => c.pos === to);
  if (city && city.owner !== unit.owner) return false;
  return true;
}

/** Tenta mover a unidade um passo. Muta `state`. Retorna true se moveu. */
export function moveOneStep(state: GameState, unit: Unit, to: number): boolean {
  if (unit.movesLeft <= 0) return false;
  if (distance(state.map, unit.pos, to) !== 1) return false;
  if (!canOccupy(state, unit, to)) return false;
  const cost = stepCost(state, unit.pos, to, enemyZoc(state, unit.owner), unit);
  if (!isFinite(cost)) return false;
  unit.pos = to;
  unit.movesLeft = Math.max(0, unit.movesLeft - cost);
  unit.fortified = false;
  return true;
}

// ---------------- Pathfinding (A*) ----------------

class MinHeap {
  private a: { k: number; v: number }[] = [];
  get size() {
    return this.a.length;
  }
  push(v: number, k: number) {
    const a = this.a;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0].v;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export interface PathResult {
  /** Hexágonos do caminho, sem incluir a origem. */
  path: number[];
  /** Turnos estimados para chegar (1 = chega neste turno). */
  turns: number;
}

/**
 * Simula o gasto de movimento ao longo do caminho, respeitando a regra de que
 * se pode entrar com qualquer movimento restante. Retorna o nº de turnos.
 */
export function simulateTurns(state: GameState, unit: Unit, path: number[]): number {
  const max = maxMoves(state, unit);
  const zoc = enemyZoc(state, unit.owner);
  let left = unit.movesLeft;
  let turns = 1;
  let pos = unit.pos;
  for (const step of path) {
    if (left <= 0) {
      turns++;
      left = max;
    }
    left = Math.max(0, left - stepCost(state, pos, step, zoc, unit));
    pos = step;
  }
  return turns;
}

/**
 * Caminho de menor custo. Hexágonos inexplorados pelo dono são tratados como
 * transitáveis com custo 1 (o jogador não conhece o terreno).
 */
export interface PathOptions {
  /** Conhece todo o terreno (bárbaros/IA). */
  ignoreFog?: boolean;
  /** O destino pode estar ocupado por inimigo (para aproximar e atacar). */
  allowEnemyGoal?: boolean;
}

export function findPath(state: GameState, unit: Unit, target: number, opts: PathOptions = {}): PathResult | null {
  const { map } = state;
  if (target === unit.pos) return null;
  const explored = opts.ignoreFog ? undefined : state.players[unit.owner]?.explored;
  const known = (i: number) => !explored || explored[i] === 1;
  if (known(target) && !canOccupy(state, unit, target)) {
    const enemyThere =
      state.units.some((o) => o.pos === target && o.owner !== unit.owner) ||
      state.cities.some((c) => c.pos === target && c.owner !== unit.owner);
    if (!(opts.allowEnemyGoal && enemyThere)) return null;
  }
  const max = maxMoves(state, unit);
  const zoc = enemyZoc(state, unit.owner);

  const g = new Map<number, number>([[unit.pos, 0]]);
  const prev = new Map<number, number>();
  const open = new MinHeap();
  open.push(unit.pos, 0);
  const closed = new Set<number>();
  let expansions = 0;
  while (open.size) {
    const cur = open.pop();
    if (cur === target) break;
    if (closed.has(cur)) continue;
    closed.add(cur);
    if (++expansions > 6000) return null;
    for (let d = 0; d < 6; d++) {
      const nb = neighbor(map, cur, d);
      if (nb < 0 || closed.has(nb)) continue;
      let cost: number;
      if (!known(nb)) cost = 1;
      else {
        if (!canEnterTerrain(state, unit, nb) && !(nb === target && opts.allowEnemyGoal)) continue;
        if (!canEnterTerritory(state, unit.owner, map.tiles[nb].owner)) continue;
        // unidades bloqueiam apenas como destino final ou se forem de outro dono
        if (nb !== target) {
          const enemy = state.units.some((o) => o.pos === nb && o.owner !== unit.owner);
          if (enemy) continue;
        }
        cost = canEnterTerrain(state, unit, nb) ? Math.min(stepCost(state, cur, nb, zoc, unit), max) : 1;
      }
      const ng = g.get(cur)! + cost;
      if (ng < (g.get(nb) ?? Infinity)) {
        g.set(nb, ng);
        prev.set(nb, cur);
        open.push(nb, ng + distance(map, nb, target));
      }
    }
  }
  if (!prev.has(target)) return null;
  const path: number[] = [];
  for (let c = target; c !== unit.pos; c = prev.get(c)!) path.push(c);
  path.reverse();
  return { path, turns: simulateTurns(state, unit, path) };
}

/** Hexágonos alcançáveis ainda neste turno (para destacar no mapa). */
export function reachableThisTurn(state: GameState, unit: Unit): Set<number> {
  const out = new Set<number>();
  if (unit.movesLeft <= 0) return out;
  const { map } = state;
  const zoc = enemyZoc(state, unit.owner);
  const best = new Map<number, number>([[unit.pos, unit.movesLeft]]);
  const queue = [unit.pos];
  while (queue.length) {
    const cur = queue.shift()!;
    const left = best.get(cur)!;
    if (left <= 0) continue;
    for (let d = 0; d < 6; d++) {
      const nb = neighbor(map, cur, d);
      if (nb < 0) continue;
      if (state.units.some((o) => o.pos === nb && o.owner !== unit.owner)) continue;
      if (state.cities.some((c) => c.pos === nb && c.owner !== unit.owner)) continue;
      if (!canEnterTerrain(state, unit, nb)) continue;
      if (!canEnterTerritory(state, unit.owner, map.tiles[nb].owner)) continue;
      const rest = Math.max(0, left - stepCost(state, cur, nb, zoc, unit));
      if (rest > (best.get(nb) ?? -1)) {
        best.set(nb, rest);
        queue.push(nb);
      }
    }
  }
  for (const k of best.keys()) if (k !== unit.pos && canOccupy(state, unit, k)) out.add(k);
  return out;
}
