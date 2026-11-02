import { CITY_STATE_BY_ID, CITY_STATE_TYPES, ENVOY_TIERS, SUZERAIN_MIN } from '../data/cityStates';
import { CIV_BY_ID } from '../data/civs';
import type { DealItem, GameState, Player, Relation } from '../state/types';
import { applyEffect, type Modifiers } from './effects';
import { distance, neighbors } from './hex';
import { computeVisibility } from './visibility';

/**
 * Diplomacia: contato, guerra/paz, acordos (fronteiras abertas, amizade),
 * ressentimentos, opinião com agendas, emissários e suseranos de cidades-estado.
 * As decisões da IA (aceitar acordos, declarar guerra) ficam em src/ai.
 */

export const AGREEMENT_TURNS = 30;
export const MIN_WAR_TURNS_FOR_PEACE = 10;
export const PEACE_BEFORE_WAR_TURNS = 5;
export const ENVOY_EVERY_TURNS = 15;

export function relKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Relação entre a e b (cria se não existir). Bárbaros não têm relação. */
export function relation(state: GameState, a: number, b: number): Relation {
  const k = relKey(a, b);
  let r = state.diplomacy[k];
  if (!r) {
    r = { met: false, war: false, since: state.turn, grievances: {} };
    state.diplomacy[k] = r;
  }
  return r;
}

export function peekRelation(state: GameState, a: number, b: number): Relation | undefined {
  return state.diplomacy[relKey(a, b)];
}

export function hasMet(state: GameState, a: number, b: number): boolean {
  return a === b || !!peekRelation(state, a, b)?.met;
}

export function isAtWar(state: GameState, a: number, b: number): boolean {
  return !!peekRelation(state, a, b)?.war;
}

export function hasOpenBorders(state: GameState, a: number, b: number): boolean {
  const r = peekRelation(state, a, b);
  return !!r && (r.openBordersUntil ?? 0) > state.turn;
}

export function areFriends(state: GameState, a: number, b: number): boolean {
  const r = peekRelation(state, a, b);
  return !!r && (r.friendshipUntil ?? 0) > state.turn;
}

/** Jogadores ativos (não eliminados, não bárbaros). */
export function activePlayers(state: GameState): Player[] {
  return state.players.filter((p) => !p.isBarbarian && !p.eliminated);
}

export function majorCivs(state: GameState): Player[] {
  return activePlayers(state).filter((p) => !p.isCityState);
}

export function playerName(state: GameState, id: number): string {
  return CIV_BY_ID[state.players[id]?.civId]?.name ?? `Jogador ${id}`;
}

// ------------------------------------------------------------------ contato

export type DiplomacyEvent =
  | { type: 'firstContact'; a: number; b: number }
  | { type: 'warDeclared'; by: number; on: number }
  | { type: 'peaceMade'; a: number; b: number }
  | { type: 'agreement'; a: number; b: number; item: 'openBorders' | 'friendship' }
  | { type: 'dealRejected'; by: number; reason: string }
  | { type: 'proposalReceived'; from: number; id: number }
  | { type: 'suzerainChanged'; cityState: number; suzerain: number | null }
  | { type: 'eliminated'; player: number }
  | { type: 'envoyGained'; player: number };

/** Marca contato entre jogadores que se veem (unidades, cidades ou território). Muta. */
export function checkContacts(state: GameState): DiplomacyEvent[] {
  const events: DiplomacyEvent[] = [];
  const act = activePlayers(state);
  const presence = new Map<number, Set<number>>(); // tile -> donos presentes
  const add = (i: number, p: number) => {
    let s = presence.get(i);
    if (!s) presence.set(i, (s = new Set()));
    s.add(p);
  };
  for (const u of state.units) add(u.pos, u.owner);
  for (const c of state.cities) add(c.pos, c.owner);
  state.map.tiles.forEach((t, i) => t.owner !== undefined && add(i, t.owner));
  for (const p of act) {
    const vis = computeVisibility(state, p.id);
    for (const [i, owners] of presence) {
      if (!vis[i]) continue;
      for (const o of owners) {
        if (o === p.id || state.players[o]?.isBarbarian || state.players[o]?.eliminated) continue;
        const r = relation(state, p.id, o);
        if (!r.met) {
          r.met = true;
          r.since = state.turn;
          events.push({ type: 'firstContact', a: p.id, b: o });
        }
      }
    }
  }
  return events;
}

// ------------------------------------------------------------------ guerra e paz

export function cannotDeclareWar(state: GameState, by: number, on: number): string | null {
  if (by === on) return 'Alvo inválido.';
  if (state.players[on]?.isBarbarian) return 'Já estamos sempre em guerra com os bárbaros.';
  const r = peekRelation(state, by, on);
  if (!r?.met) return 'Ainda não fizemos contato.';
  if (r.war) return 'Já estamos em guerra.';
  if (areFriends(state, by, on)) return 'Há uma declaração de amizade em vigor.';
  if (state.turn - r.since < PEACE_BEFORE_WAR_TURNS) return `A paz é recente (aguarde ${PEACE_BEFORE_WAR_TURNS} turnos).`;
  return null;
}

/** Declara guerra (muta). Gera ressentimento na vítima e nos que conhecem a vítima. */
export function declareWar(state: GameState, by: number, on: number): string | DiplomacyEvent[] {
  const why = cannotDeclareWar(state, by, on);
  if (why) return why;
  const r = relation(state, by, on);
  r.war = true;
  r.since = state.turn;
  r.openBordersUntil = undefined;
  r.friendshipUntil = undefined;
  addGrievance(state, on, by, 40);
  for (const p of majorCivs(state)) {
    if (p.id !== by && p.id !== on && hasMet(state, p.id, on) && hasMet(state, p.id, by)) addGrievance(state, p.id, by, 10);
  }
  // unidades do agressor dentro do território da vítima continuam lá (agora inimigas)
  return [{ type: 'warDeclared', by, on }];
}

export function makePeace(state: GameState, a: number, b: number): DiplomacyEvent[] {
  const r = relation(state, a, b);
  r.war = false;
  r.since = state.turn;
  expelUnits(state, a, b);
  expelUnits(state, b, a);
  return [{ type: 'peaceMade', a, b }];
}

/** Retira unidades de `who` do território de `from` (para o hexágono livre mais próximo fora dele). */
export function expelUnits(state: GameState, who: number, from: number): void {
  for (const u of state.units) {
    if (u.owner !== who || state.map.tiles[u.pos].owner !== from) continue;
    const seen = new Set([u.pos]);
    let frontier = [u.pos];
    let dest: number | null = null;
    for (let depth = 0; depth < 12 && dest === null; depth++) {
      const next: number[] = [];
      for (const f of frontier) {
        for (const n of neighbors(state.map, f)) {
          if (n < 0 || seen.has(n)) continue;
          seen.add(n);
          const t = state.map.tiles[n];
          if (t.owner !== from && !state.units.some((x) => x.pos === n) && !state.cities.some((c) => c.pos === n)) {
            const def = t.terrain;
            if (def !== 'coast' && def !== 'ocean' && def !== 'mountain') {
              dest = n;
              break;
            }
          }
          next.push(n);
        }
        if (dest !== null) break;
      }
      frontier = next;
    }
    if (dest !== null) {
      u.pos = dest;
      delete u.path;
    }
  }
}

// ------------------------------------------------------------------ ressentimentos e opinião

export function addGrievance(state: GameState, holder: number, target: number, amount: number): void {
  const r = relation(state, holder, target);
  r.grievances[holder] = (r.grievances[holder] ?? 0) + amount;
}

export function grievance(state: GameState, holder: number, target: number): number {
  return peekRelation(state, holder, target)?.grievances[holder] ?? 0;
}

/** Decai ressentimentos (muta). */
export function decayGrievances(state: GameState): void {
  for (const r of Object.values(state.diplomacy)) {
    for (const k of Object.keys(r.grievances)) {
      const v = r.grievances[Number(k)] * 0.97 - 0.2;
      if (v <= 0) delete r.grievances[Number(k)];
      else r.grievances[Number(k)] = Math.round(v * 100) / 100;
    }
  }
}

export interface OpinionPart {
  label: string;
  value: number;
}

/** Poder militar aproximado (força × vida das unidades militares + cidades). */
export function militaryPower(state: GameState, id: number, unitStrength: (type: string) => number): number {
  let p = 0;
  for (const u of state.units) if (u.owner === id) p += unitStrength(u.type) * (u.hp / 100);
  p += state.cities.filter((c) => c.owner === id).length * 10;
  return p;
}

/** Opinião de `holder` (IA) sobre `target`, com explicação. */
export function opinionParts(state: GameState, holder: number, target: number, unitStrength: (type: string) => number): OpinionPart[] {
  const parts: OpinionPart[] = [];
  const civ = CIV_BY_ID[state.players[holder]?.civId];
  const r = peekRelation(state, holder, target);
  if (r?.war) parts.push({ label: 'Estamos em guerra', value: -40 });
  if (areFriends(state, holder, target)) parts.push({ label: 'Declaração de amizade', value: 25 });
  if (hasOpenBorders(state, holder, target)) parts.push({ label: 'Fronteiras abertas', value: 8 });
  const g = grievance(state, holder, target);
  if (g > 1) parts.push({ label: 'Ressentimentos (guerras declaradas)', value: -Math.round(g) });
  // vizinhança tensa: territórios encostados
  const close = state.cities.some(
    (a) => a.owner === holder && state.cities.some((b) => b.owner === target && distance(state.map, a.pos, b.pos) <= 7),
  );
  if (close) parts.push({ label: 'Fronteiras próximas', value: -8 });
  if (civ?.agenda) {
    const v = agendaValue(state, holder, target, civ.agenda.id, unitStrength);
    if (v !== 0) parts.push({ label: `Agenda: ${civ.agenda.name}`, value: v });
  }
  return parts;
}

function agendaValue(
  state: GameState,
  holder: number,
  target: number,
  agenda: string,
  unitStrength: (type: string) => number,
): number {
  const me = state.players[holder];
  const them = state.players[target];
  const cities = (id: number) => state.cities.filter((c) => c.owner === id);
  switch (agenda) {
    case 'builder': {
      const b = (id: number) => cities(id).reduce((s, c) => s + c.buildings.length, 0) / Math.max(1, cities(id).length);
      return b(target) >= b(holder) ? 12 : -10;
    }
    case 'scholar':
      return them.techs.length >= me.techs.length ? 12 : -10;
    case 'warmonger': {
      const pm = militaryPower(state, holder, unitStrength);
      const pt = militaryPower(state, target, unitStrength);
      return pt >= pm * 0.8 ? 10 : -15;
    }
    case 'merchant':
      return them.gold >= me.gold ? 10 : -8;
    case 'expansionist':
      return cities(target).length > cities(holder).length ? -18 : 5;
    default:
      return 0;
  }
}

export function opinion(state: GameState, holder: number, target: number, unitStrength: (type: string) => number): number {
  return opinionParts(state, holder, target, unitStrength).reduce((s, p) => s + p.value, 0);
}

export function attitudeLabel(v: number): string {
  if (v >= 20) return 'Amigável';
  if (v <= -20) return 'Hostil';
  return 'Neutro';
}

// ------------------------------------------------------------------ acordos

export function cannotApplyDeal(state: GameState, a: number, b: number, items: DealItem[]): string | null {
  if (!hasMet(state, a, b)) return 'Ainda não fizemos contato.';
  const r = relation(state, a, b);
  for (const it of items) {
    if (it.type === 'peace') {
      if (!r.war) return 'Não estamos em guerra.';
      if (state.turn - r.since < MIN_WAR_TURNS_FOR_PEACE) return `A guerra começou há pouco (mínimo ${MIN_WAR_TURNS_FOR_PEACE} turnos).`;
    } else if (r.war) return 'Primeiro é preciso fazer a paz.';
    if (it.type === 'gold' && state.players[it.from].gold < it.amount) return 'Ouro insuficiente.';
    if ((it.type === 'openBorders' || it.type === 'friendship') && (state.players[a].isCityState || state.players[b].isCityState)) {
      return 'Cidades-estado não firmam esse acordo.';
    }
  }
  return null;
}

/** Aplica um acordo aceito (muta). */
export function applyDeal(state: GameState, a: number, b: number, items: DealItem[]): DiplomacyEvent[] {
  const events: DiplomacyEvent[] = [];
  const r = relation(state, a, b);
  for (const it of items) {
    if (it.type === 'peace') events.push(...makePeace(state, a, b));
    else if (it.type === 'openBorders') {
      r.openBordersUntil = state.turn + AGREEMENT_TURNS;
      events.push({ type: 'agreement', a, b, item: 'openBorders' });
    } else if (it.type === 'friendship') {
      r.friendshipUntil = state.turn + AGREEMENT_TURNS;
      events.push({ type: 'agreement', a, b, item: 'friendship' });
    } else if (it.type === 'gold') {
      const to = it.from === a ? b : a;
      state.players[it.from].gold -= it.amount;
      state.players[to].gold += it.amount;
    }
  }
  return events;
}

// ------------------------------------------------------------------ território

/** Pode `owner` entrar em território de `tileOwner`? (guerra, fronteiras abertas ou próprio). */
export function canEnterTerritory(state: GameState, owner: number, tileOwner: number | undefined): boolean {
  if (tileOwner === undefined || tileOwner === owner) return true;
  const p = state.players[owner];
  const t = state.players[tileOwner];
  if (!p || !t || p.isBarbarian || t.isBarbarian) return true;
  if (isAtWar(state, owner, tileOwner)) return true;
  if (t.isCityState) return true; // cidades-estado aceitam visitantes
  return hasOpenBorders(state, owner, tileOwner);
}

// ------------------------------------------------------------------ cidades-estado

export function envoysOf(state: GameState, cityStateId: number, player: number): number {
  return state.players[cityStateId]?.envoys?.[player] ?? 0;
}

export function suzerainOf(state: GameState, cityStateId: number): number | null {
  const env = state.players[cityStateId]?.envoys ?? {};
  let best: number | null = null;
  let bestN = 0;
  let tie = false;
  for (const [k, n] of Object.entries(env)) {
    const id = Number(k);
    if (state.players[id]?.eliminated || isAtWar(state, id, cityStateId)) continue;
    if (n > bestN) {
      best = id;
      bestN = n;
      tie = false;
    } else if (n === bestN) tie = true;
  }
  return best !== null && bestN >= SUZERAIN_MIN && !tie ? best : null;
}

export function sendEnvoy(state: GameState, from: number, cityStateId: number): string | DiplomacyEvent[] {
  const p = state.players[from];
  const cs = state.players[cityStateId];
  if (!cs?.isCityState || cs.eliminated) return 'Não é uma cidade-estado.';
  if (!hasMet(state, from, cityStateId)) return 'Ainda não fizemos contato.';
  if (isAtWar(state, from, cityStateId)) return 'Estamos em guerra com ela.';
  if (p.envoyTokens <= 0) return 'Sem emissários disponíveis.';
  const before = suzerainOf(state, cityStateId);
  p.envoyTokens--;
  cs.envoys = cs.envoys ?? {};
  cs.envoys[from] = (cs.envoys[from] ?? 0) + 1;
  const after = suzerainOf(state, cityStateId);
  return before !== after ? [{ type: 'suzerainChanged', cityState: cityStateId, suzerain: after }] : [];
}

/** Bônus de emissários e de suserania aplicados aos modificadores de `playerId`. */
export function applyCityStateBonuses(state: GameState, playerId: number, m: Modifiers): void {
  for (const cs of state.players) {
    if (!cs.isCityState || cs.eliminated) continue;
    const def = CITY_STATE_BY_ID[cs.civId];
    if (!def) continue;
    const key = CITY_STATE_TYPES[def.type].yieldKey;
    const n = envoysOf(state, cs.id, playerId);
    if (n >= ENVOY_TIERS[0]) applyEffect(m, { type: 'capitalYields', yields: { [key]: 2 } });
    if (n >= ENVOY_TIERS[1]) applyEffect(m, { type: 'capitalYields', yields: { [key]: 2 } });
    if (n >= ENVOY_TIERS[2]) applyEffect(m, { type: 'cityYields', yields: { [key]: 1 } });
    if (suzerainOf(state, cs.id) === playerId) {
      if (def.type === 'militaristic') applyEffect(m, { type: 'productionPercent', target: 'military', percent: 25 });
      else applyEffect(m, { type: 'cityYields', yields: { [key]: def.type === 'trade' ? 3 : 2 } });
    }
  }
}

/** Emissários periódicos (+1 a cada 15 turnos) para civilizações. Muta. */
export function grantPeriodicEnvoys(state: GameState): DiplomacyEvent[] {
  if (state.turn % ENVOY_EVERY_TURNS !== 0) return [];
  const ev: DiplomacyEvent[] = [];
  for (const p of majorCivs(state)) {
    p.envoyTokens++;
    ev.push({ type: 'envoyGained', player: p.id });
  }
  return ev;
}

// ------------------------------------------------------------------ eliminação

export function checkEliminations(state: GameState): DiplomacyEvent[] {
  const ev: DiplomacyEvent[] = [];
  for (const p of activePlayers(state)) {
    // eliminado: perdeu todas as cidades (depois de ter tido alguma) ou ficou sem nada
    const hasCity = state.cities.some((c) => c.owner === p.id);
    const hasUnits = state.units.some((u) => u.owner === p.id);
    const hasSettler = state.units.some((u) => u.owner === p.id && u.type === 'settler');
    if (!hasCity && ((p.citiesFounded > 0 && !hasSettler) || !hasUnits) && state.turn > 1) {
      p.eliminated = true;
      state.units = state.units.filter((u) => u.owner !== p.id);
      for (const r of Object.entries(state.diplomacy)) {
        const [a, b] = r[0].split('-').map(Number);
        if (a === p.id || b === p.id) r[1].war = false;
      }
      ev.push({ type: 'eliminated', player: p.id });
    }
  }
  return ev;
}
