import type { GameState } from '../state/types';

/**
 * IA das civilizações rivais — implementada na etapa 5.
 * Contrato: recebe o estado e o id do jogador e devolve as ações a aplicar
 * (via rules/actions.applyAction), sem acessar render/ui.
 */
export function planAiTurn(_state: GameState, _playerId: number): never[] {
  return [];
}
