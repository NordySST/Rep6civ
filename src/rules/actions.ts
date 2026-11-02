import { UNITS } from '../data/units';
import type { GameState, Unit } from '../state/types';
import { canFoundCity, foundCity } from './city';
import { findPath, moveOneStep } from './movement';
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
  | { type: 'endTurn' };

export type GameEvent =
  | { type: 'error'; message: string }
  | { type: 'cityFounded'; cityId: number; name: string }
  | { type: 'unitMoved'; unitId: number; from: number; to: number }
  | { type: 'turnStarted'; turn: number };

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

function findUnit(state: GameState, id: number): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

/** Avança a unidade pelo caminho guardado enquanto houver movimento. Muta. */
export function advanceAlongPath(state: GameState, unit: Unit): boolean {
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
    unit.path.shift();
    revealForPlayer(state, unit.owner);
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
      advanceAlongPath(state, u);
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
    case 'endTurn': {
      endTurn(state);
      events.push({ type: 'turnStarted', turn: state.turn });
      break;
    }
  }
  return { state, events };
}

/** Fim de turno (muta). Na etapa 1 há só o jogador humano. */
export function endTurn(state: GameState): void {
  state.turn++;
  for (const u of state.units) {
    u.movesLeft = UNITS[u.type].moves;
    u.skipped = false;
  }
  for (const u of state.units) {
    if (u.path?.length) advanceAlongPath(state, u);
  }
  for (const p of state.players) revealForPlayer(state, p.id);
}

/** Unidades do jogador que ainda esperam ordens neste turno. */
export function unitsNeedingOrders(state: GameState, playerId: number): Unit[] {
  return state.units.filter(
    (u) => u.owner === playerId && u.movesLeft > 0 && !u.fortified && !u.skipped && !(u.path && u.path.length),
  );
}
