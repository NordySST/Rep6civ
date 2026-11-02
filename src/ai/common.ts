import { UNITS } from '../data/units';
import { reduceAction, type Action, type GameEvent } from '../rules/actions';
import type { GameState } from '../state/types';

/** Força usada para estimar poder militar. */
export function unitStrength(type: string): number {
  const d = UNITS[type];
  if (!d || d.class !== 'military') return 0;
  return Math.max(d.strength, d.rangedStrength ?? 0);
}

/** Aplica uma ação em nome de `player` (muta). Retorna true se deu certo. */
export function act(state: GameState, player: number, action: Action, events: GameEvent[]): boolean {
  const prev = state.currentPlayer;
  state.currentPlayer = player;
  const err = reduceAction(state, action, events);
  state.currentPlayer = prev;
  return err === null;
}
