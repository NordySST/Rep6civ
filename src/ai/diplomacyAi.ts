import { CITY_STATE_BY_ID, CITY_STATE_TYPES } from '../data/cityStates';
import { CIV_BY_ID } from '../data/civs';
import type { ActionResult, GameEvent } from '../rules/actions';
import { nextRandom } from '../rules/combat';
import {
  activePlayers,
  applyDeal,
  areFriends,
  cannotApplyDeal,
  cannotDeclareWar,
  declareWar,
  envoysOf,
  hasMet,
  hasOpenBorders,
  makePeace,
  majorCivs,
  militaryPower,
  MIN_WAR_TURNS_FOR_PEACE,
  opinion,
  peekRelation,
  sendEnvoy,
  suzerainOf,
} from '../rules/diplomacy';
import { effectiveLuxuries, tradeableLuxuries } from '../rules/economy';
import { distance } from '../rules/hex';
import type { DealItem, GameState } from '../state/types';
import { unitStrength } from './common';

/**
 * Decisões diplomáticas da IA: avaliar acordos, declarar guerra, buscar paz,
 * propor amizade/fronteiras abertas e distribuir emissários.
 */

export function power(state: GameState, id: number): number {
  return militaryPower(state, id, unitStrength);
}

export function opinionOf(state: GameState, holder: number, target: number): number {
  return opinion(state, holder, target, unitStrength);
}

/** A IA quer paz com `other`? */
export function wantsPeace(state: GameState, ai: number, other: number): boolean {
  const r = peekRelation(state, ai, other);
  if (!r?.war) return false;
  const turns = state.turn - r.since;
  if (turns < MIN_WAR_TURNS_FOR_PEACE) return false;
  const ratio = power(state, ai) / Math.max(1, power(state, other));
  return ratio < 1.1 || turns > 30;
}

export interface DealVerdict {
  accept: boolean;
  reason: string;
}

/** Avalia um acordo proposto por `from` à IA `ai`. */
export function evaluateDeal(state: GameState, ai: number, from: number, items: DealItem[]): DealVerdict {
  const why = cannotApplyDeal(state, from, ai, items);
  if (why) return { accept: false, reason: why };
  const op = opinionOf(state, ai, from);
  let value = 0;
  for (const it of items) {
    switch (it.type) {
      case 'peace':
        value += wantsPeace(state, ai, from) ? 60 : -40;
        break;
      case 'openBorders':
        value += op >= 0 ? 15 : -25;
        break;
      case 'friendship':
        value += op >= 20 ? 30 : -60;
        break;
      case 'gold':
        value += it.from === from ? it.amount / 2 : -it.amount;
        break;
      case 'luxury': {
        if (it.from === from) value += effectiveLuxuries(state, ai).includes(it.resource) ? 5 : 25;
        else value -= op >= 20 ? 10 : 20;
        break;
      }
      case 'researchAgreement':
        value += 30;
        break;
    }
  }
  if (!items.some((i) => i.type === 'peace') && op <= -40) return { accept: false, reason: 'Não confiamos em vocês.' };
  if (value > 0) return { accept: true, reason: 'Aceitamos.' };
  return { accept: false, reason: 'Isso não nos interessa.' };
}

/** Proposta do jogador humano a uma IA (aplica se aceita). Não muta `prev`. */
export function proposeDeal(prev: GameState, to: number, items: DealItem[]): ActionResult {
  const state = structuredClone(prev);
  const from = state.currentPlayer;
  const target = state.players[to];
  if (!target || target.isHuman || target.isBarbarian || target.eliminated) {
    return { state: prev, events: [{ type: 'error', message: 'Destinatário inválido.' }] };
  }
  const v = evaluateDeal(state, to, from, items);
  if (!v.accept) return { state: prev, events: [{ type: 'dealRejected', by: to, reason: v.reason }] };
  const events: GameEvent[] = applyDeal(state, from, to, items);
  return { state, events };
}

function propose(state: GameState, from: number, to: number, items: DealItem[], events: GameEvent[]): void {
  if (state.proposals.some((p) => p.from === from && p.to === to)) return;
  const id = state.nextId++;
  state.proposals.push({ id, from, to, items, turn: state.turn });
  events.push({ type: 'proposalReceived', from, id });
}

/** Turno diplomático da IA `ai` (muta). */
export function runDiplomacy(state: GameState, ai: number, events: GameEvent[]): void {
  const me = state.players[ai];
  const civ = CIV_BY_ID[me.civId];
  const aggression = civ?.aggression ?? 0.3;
  const others = activePlayers(state).filter((p) => p.id !== ai && hasMet(state, ai, p.id));

  for (const o of others) {
    const r = peekRelation(state, ai, o.id)!;
    const op = opinionOf(state, ai, o.id);
    if (r.war) {
      if (wantsPeace(state, ai, o.id)) {
        if (o.isHuman) {
          if ((state.turn - r.since) % 5 === 0) propose(state, ai, o.id, [{ type: 'peace' }], events);
        } else if (o.isCityState || wantsPeace(state, o.id, ai) || power(state, o.id) < power(state, ai)) {
          events.push(...makePeace(state, ai, o.id));
        }
      }
      continue;
    }
    if (me.isCityState || o.isCityState) continue;
    // guerra: hostil, mais forte, vizinho e sem outra guerra em andamento
    const atWarAlready = majorCivs(state).some((x) => x.id !== ai && peekRelation(state, ai, x.id)?.war);
    const near = state.cities.some(
      (a) => a.owner === ai && state.cities.some((b) => b.owner === o.id && distance(state.map, a.pos, b.pos) <= 14),
    );
    if (
      !atWarAlready &&
      near &&
      state.turn >= 40 &&
      op <= -20 &&
      power(state, ai) >= 1.4 * power(state, o.id) &&
      !cannotDeclareWar(state, ai, o.id) &&
      nextRandom(state) < aggression * 0.25
    ) {
      const res = declareWar(state, ai, o.id);
      if (typeof res !== 'string') events.push(...res);
      continue;
    }
    // aproximação
    if (op >= 25 && !areFriends(state, ai, o.id) && state.turn % 10 === ai % 10) {
      if (o.isHuman) propose(state, ai, o.id, [{ type: 'friendship' }], events);
      else if (opinionOf(state, o.id, ai) >= 20) events.push(...applyDeal(state, ai, o.id, [{ type: 'friendship' }]));
    } else if (op >= 5 && !hasOpenBorders(state, ai, o.id) && state.turn % 10 === (ai + 5) % 10) {
      if (o.isHuman) propose(state, ai, o.id, [{ type: 'openBorders' }], events);
      else if (opinionOf(state, o.id, ai) >= 0) events.push(...applyDeal(state, ai, o.id, [{ type: 'openBorders' }]));
    } else if (op >= 0 && state.turn % 12 === ai % 12) {
      // troca de luxos: cada um cede um que o outro não tem
      const mine = tradeableLuxuries(state, ai).filter((r) => !effectiveLuxuries(state, o.id).includes(r));
      const theirs = tradeableLuxuries(state, o.id).filter((r) => !effectiveLuxuries(state, ai).includes(r));
      if (mine.length && theirs.length) {
        const items: DealItem[] = [
          { type: 'luxury', from: ai, resource: mine[0] },
          { type: 'luxury', from: o.id, resource: theirs[0] },
        ];
        if (o.isHuman) propose(state, ai, o.id, items, events);
        else if (!cannotApplyDeal(state, ai, o.id, items)) events.push(...applyDeal(state, ai, o.id, items));
      }
    } else if (
      areFriends(state, ai, o.id) &&
      state.turn % 15 === ai % 15 &&
      !cannotApplyDeal(state, ai, o.id, [{ type: 'researchAgreement' }])
    ) {
      if (o.isHuman) propose(state, ai, o.id, [{ type: 'researchAgreement' }], events);
      else events.push(...applyDeal(state, ai, o.id, [{ type: 'researchAgreement' }]));
    }
  }

  // emissários
  while (me.envoyTokens > 0 && !me.isCityState) {
    const cs = activePlayers(state).filter((p) => p.isCityState && hasMet(state, ai, p.id) && !peekRelation(state, ai, p.id)?.war);
    if (!cs.length) break;
    const pref = civ?.agenda?.id;
    const score = (id: number) => {
      const def = CITY_STATE_BY_ID[state.players[id].civId];
      let s = envoysOf(state, id, ai) * 2;
      const sz = suzerainOf(state, id);
      if (sz !== null && sz !== ai) s -= 3;
      const key = def ? CITY_STATE_TYPES[def.type].yieldKey : '';
      if ((pref === 'scholar' && key === 'science') || (pref === 'merchant' && key === 'gold') || (pref === 'warmonger' && key === 'production'))
        s += 3;
      return s - id * 0.001;
    };
    const best = cs.reduce((a, b) => (score(b.id) > score(a.id) ? b : a));
    const res = sendEnvoy(state, ai, best.id);
    if (typeof res === 'string') break;
    events.push(...res);
  }
}
