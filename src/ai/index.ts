import { endTurn, type ActionResult, type GameEvent } from '../rules/actions';
import { checkContacts } from '../rules/diplomacy';
import type { GameState } from '../state/types';
import { runAiPlayer } from './civAi';
import { runDiplomacy } from './diplomacyAi';

export { evaluateDeal, opinionOf, power, proposeDeal, wantsPeace } from './diplomacyAi';

/**
 * Fim do turno do jogador humano: cada IA (civilizações e cidades-estado) joga
 * na ordem dos jogadores, depois as regras processam bárbaros e o fim da rodada.
 * Não muta `prev`.
 */
export function playEndTurn(prev: GameState): ActionResult {
  const state = structuredClone(prev);
  const events: GameEvent[] = [];
  const human = state.currentPlayer;
  for (const p of state.players) {
    if (p.isHuman || p.isBarbarian || p.eliminated) continue;
    runDiplomacy(state, p.id, events);
    runAiPlayer(state, p.id, events);
    events.push(...checkContacts(state));
  }
  state.currentPlayer = human;
  events.push(...endTurn(state));
  events.push({ type: 'turnStarted', turn: state.turn });
  return { state, events };
}
