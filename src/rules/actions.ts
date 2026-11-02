import type { ImprovementId } from '../data/improvements';
import { UNITS } from '../data/units';
import type { CityFocus, GameState, ProductionItem, Unit } from '../state/types';
import { buildImprovement, buildRoad, removeFeature } from './builders';
import {
  assignCitizens,
  cannotProduce,
  itemKey,
  processCity,
  purchaseItem,
  purchaseTile,
  toggleWorkedTile,
  type CityEvent,
} from './cities';
import { canFoundCity, foundCity } from './city';
import { runBarbarianTurn } from './barbarians';
import { cannotAttack, cityAttack, clearCampAt, healUnits, promote, resolveAttack, type CombatEvent } from './combat';
import { setGovernment, setPolicy } from './effects';
import { findPath, maxMoves, moveOneStep } from './movement';
import { checkBoosts, processResearch, setResearch, type ResearchEvent, type TreeKind } from './research';
import { revealForPlayer } from './visibility';

/**
 * Ações do jogador. `applyAction` é puro: recebe o estado, devolve um NOVO
 * estado (clonado) e eventos para a UI. Nunca muta o estado recebido.
 */
export type Action =
  | { type: 'move'; unitId: number; target: number }
  | { type: 'foundCity'; unitId: number }
  | { type: 'skipUnit'; unitId: number }
  | { type: 'fortify'; unitId: number }
  | { type: 'cancelPath'; unitId: number }
  | { type: 'buildImprovement'; unitId: number; improvement: ImprovementId }
  | { type: 'buildRoad'; unitId: number }
  | { type: 'removeFeature'; unitId: number }
  | { type: 'setProduction'; cityId: number; item: ProductionItem }
  | { type: 'enqueue'; cityId: number; item: ProductionItem }
  | { type: 'dequeue'; cityId: number; index: number }
  | { type: 'purchaseItem'; cityId: number; item: ProductionItem }
  | { type: 'purchaseTile'; cityId: number; tile: number }
  | { type: 'toggleTile'; cityId: number; tile: number }
  | { type: 'setFocus'; cityId: number; focus: CityFocus }
  | { type: 'setResearch'; kind: TreeKind; id: string }
  | { type: 'setGovernment'; id: string }
  | { type: 'setPolicy'; slot: number; policy: string | null }
  | { type: 'attack'; unitId: number; target: number }
  | { type: 'cityAttack'; cityId: number; target: number }
  | { type: 'promote'; unitId: number; promotion: string }
  | { type: 'endTurn' };

export type GameEvent =
  | { type: 'error'; message: string }
  | { type: 'cityFounded'; cityId: number; name: string }
  | { type: 'unitMoved'; unitId: number; from: number; to: number }
  | { type: 'turnStarted'; turn: number }
  | { type: 'info'; message: string }
  | CityEvent
  | ResearchEvent
  | CombatEvent;

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

function findUnit(state: GameState, id: number): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

/** Avança a unidade pelo caminho guardado enquanto houver movimento. Muta. */
export function advanceAlongPath(state: GameState, unit: Unit, events?: GameEvent[]): boolean {
  let moved = false;
  while (unit.path && unit.path.length && unit.movesLeft > 0) {
    const next = unit.path[0];
    if (!moveOneStep(state, unit, next)) {
      // caminho bloqueado: recalcula até o destino
      const target = unit.path[unit.path.length - 1];
      const re = findPath(state, unit, target);
      if (!re || re.path[0] === next) {
        delete unit.path;
        break;
      }
      unit.path = re.path;
      continue;
    }
    moved = true;
    unit.acted = true;
    unit.path.shift();
    revealForPlayer(state, unit.owner);
    const camp = clearCampAt(state, unit);
    if (camp) {
      events?.push(camp);
      delete unit.path;
    }
  }
  if (unit.path && unit.path.length === 0) delete unit.path;
  return moved;
}

export function applyAction(prev: GameState, action: Action): ActionResult {
  const state = structuredClone(prev);
  const events: GameEvent[] = [];
  const fail = (message: string): ActionResult => ({ state: prev, events: [{ type: 'error', message }] });

  switch (action.type) {
    case 'move': {
      const u = findUnit(state, action.unitId);
      if (!u || u.owner !== state.currentPlayer) return fail('Unidade inválida.');
      const res = findPath(state, u, action.target);
      if (!res) return fail('Não há caminho até esse destino.');
      const from = u.pos;
      u.path = res.path;
      u.skipped = false;
      advanceAlongPath(state, u, events);
      events.push({ type: 'unitMoved', unitId: u.id, from, to: u.pos });
      break;
    }
    case 'foundCity': {
      const u = findUnit(state, action.unitId);
      if (!u || u.owner !== state.currentPlayer) return fail('Unidade inválida.');
      const check = canFoundCity(state, u);
      if (!check.ok) return fail(check.reason);
      const owner = u.owner;
      const city = foundCity(state, u);
      revealForPlayer(state, owner);
      events.push({ type: 'cityFounded', cityId: city.id, name: city.name });
      break;
    }
    case 'skipUnit': {
      const u = findUnit(state, action.unitId);
      if (!u) return fail('Unidade inválida.');
      u.skipped = true;
      break;
    }
    case 'fortify': {
      const u = findUnit(state, action.unitId);
      if (!u) return fail('Unidade inválida.');
      if (UNITS[u.type].class !== 'military') return fail('Apenas unidades militares podem se fortificar.');
      u.fortified = true;
      delete u.path;
      break;
    }
    case 'cancelPath': {
      const u = findUnit(state, action.unitId);
      if (u) delete u.path;
      break;
    }
    case 'buildImprovement':
    case 'buildRoad':
    case 'removeFeature': {
      const u = findUnit(state, action.unitId);
      if (!u || u.owner !== state.currentPlayer) return fail('Unidade inválida.');
      const r =
        action.type === 'buildImprovement'
          ? buildImprovement(state, u, action.improvement)
          : action.type === 'buildRoad'
            ? buildRoad(state, u)
            : removeFeature(state, u);
      if (!r.ok) return fail(r.reason);
      if (state.units.includes(u)) u.acted = true;
      if ('production' in r && r.production) events.push({ type: 'info', message: `+${r.production} de produção para a cidade.` });
      break;
    }
    case 'setProduction':
    case 'enqueue': {
      const c = state.cities.find((x) => x.id === action.cityId);
      if (!c || c.owner !== state.currentPlayer) return fail('Cidade inválida.');
      const why = cannotProduce(state, c, action.item);
      if (why) return fail(why);
      if (c.queue.some((q) => itemKey(q) === itemKey(action.item)) && action.item.kind === 'building') {
        if (action.type === 'setProduction') {
          c.queue = [action.item, ...c.queue.filter((q) => itemKey(q) !== itemKey(action.item))];
        } else return fail('Já está na fila.');
      } else if (action.type === 'setProduction') {
        if (c.queue.length) c.queue[0] = action.item;
        else c.queue.push(action.item);
      } else c.queue.push(action.item);
      break;
    }
    case 'dequeue': {
      const c = state.cities.find((x) => x.id === action.cityId);
      if (!c || c.owner !== state.currentPlayer) return fail('Cidade inválida.');
      c.queue.splice(action.index, 1);
      break;
    }
    case 'purchaseItem':
    case 'purchaseTile':
    case 'toggleTile': {
      const c = state.cities.find((x) => x.id === action.cityId);
      if (!c || c.owner !== state.currentPlayer) return fail('Cidade inválida.');
      const why =
        action.type === 'purchaseItem'
          ? purchaseItem(state, c, action.item)
          : action.type === 'purchaseTile'
            ? purchaseTile(state, c, action.tile)
            : toggleWorkedTile(state, c, action.tile);
      if (why) return fail(why);
      if (action.type === 'purchaseTile') revealForPlayer(state, c.owner);
      break;
    }
    case 'setFocus': {
      const c = state.cities.find((x) => x.id === action.cityId);
      if (!c || c.owner !== state.currentPlayer) return fail('Cidade inválida.');
      c.focus = action.focus;
      assignCitizens(state, c);
      break;
    }
    case 'setResearch': {
      const why = setResearch(state.players[state.currentPlayer], action.kind, action.id);
      if (why) return fail(why);
      break;
    }
    case 'setGovernment':
    case 'setPolicy': {
      const p = state.players[state.currentPlayer];
      const why = action.type === 'setGovernment' ? setGovernment(p, action.id) : setPolicy(p, action.slot, action.policy);
      if (why) return fail(why);
      for (const c of state.cities) if (c.owner === p.id) assignCitizens(state, c);
      break;
    }
    case 'attack': {
      const u = findUnit(state, action.unitId);
      if (!u || u.owner !== state.currentPlayer) return fail('Unidade inválida.');
      const why = cannotAttack(state, u, action.target);
      if (why) return fail(why);
      events.push(...resolveAttack(state, u, action.target));
      revealForPlayer(state, state.currentPlayer);
      break;
    }
    case 'cityAttack': {
      const c = state.cities.find((x) => x.id === action.cityId);
      if (!c || c.owner !== state.currentPlayer) return fail('Cidade inválida.');
      const r = cityAttack(state, c, action.target);
      if (typeof r === 'string') return fail(r);
      events.push(...r);
      break;
    }
    case 'promote': {
      const u = findUnit(state, action.unitId);
      if (!u || u.owner !== state.currentPlayer) return fail('Unidade inválida.');
      const why = promote(u, action.promotion);
      if (why) return fail(why);
      break;
    }
    case 'endTurn': {
      events.push(...endTurn(state));
      events.push({ type: 'turnStarted', turn: state.turn });
      break;
    }
  }
  // eurecas/inspirações obtidas pela ação
  if (action.type !== 'endTurn') events.push(...checkBoosts(state, state.currentPlayer));
  return { state, events };
}

/** Fim de turno (muta). Processa cidades, depois renova unidades. */
export function endTurn(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  for (const p of state.players) p.policyChangeAvailable = false;
  // turno dos bárbaros (depois do jogador)
  events.push(...runBarbarianTurn(state));
  for (const c of [...state.cities]) events.push(...processCity(state, c));
  const civs = state.players.filter((p) => !p.isBarbarian);
  for (const p of civs) {
    events.push(...checkBoosts(state, p.id));
    events.push(...processResearch(state, p.id));
  }
  healUnits(state);
  state.turn++;
  for (const u of state.units) {
    u.movesLeft = maxMoves(state, u);
    u.skipped = false;
  }
  for (const u of state.units) {
    if (u.path?.length) advanceAlongPath(state, u, events);
  }
  // movimento automático não conta como ação para a cura do próximo turno
  for (const u of state.units) u.acted = false;
  for (const p of civs) {
    revealForPlayer(state, p.id);
    events.push(...checkBoosts(state, p.id));
  }
  return events;
}

/** Unidades do jogador que ainda esperam ordens neste turno. */
export function unitsNeedingOrders(state: GameState, playerId: number): Unit[] {
  return state.units.filter(
    (u) => u.owner === playerId && u.movesLeft > 0 && !u.fortified && !u.skipped && !(u.path && u.path.length),
  );
}
