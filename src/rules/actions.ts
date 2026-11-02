import type { ImprovementId } from '../data/improvements';
import { UNITS } from '../data/units';
import type { CityFocus, GameState, ProductionItem, Unit, VictoryType } from '../state/types';
import { buildImprovement, buildRoad, pillage, PILLAGE_GOLD, removeFeature, repairImprovement } from './builders';
import { districtCost } from './districts';
import {
  assignCitizens,
  cannotProduce,
  itemKey,
  processCity,
  purchaseItem,
  purchaseTile,
  setSpecialists,
  toggleWorkedTile,
  type CityEvent,
} from './cities';
import { canFoundCity, foundCity } from './city';
import { runBarbarianTurn } from './barbarians';
import { checkVictory, playerEra } from './victory';
import { maintenanceOf } from './economy';
import { activateGreatPerson, processGreatPeople, type GreatPersonEvent } from './greatPeople';
import { neighbors } from './hex';
import {
  canBuyMissionary,
  choosePantheon,
  foundReligion,
  purgeHeresy,
  spreadPressure,
  spreadReligion,
  theologicalCombat,
  type ReligionEvent,
  type TheologyEvent,
} from './religion';
import { isPassableLand } from './tiles';
import { cleanRoutes, establishRoute } from './trade';
import { cannotAttack, cityAttack, clearCampAt, healUnits, nextRandom, promote, resolveAttack, type CombatEvent } from './combat';
import {
  applyDeal,
  cannotApplyDeal,
  checkContacts,
  checkEliminations,
  declareWar,
  decayGrievances,
  grantPeriodicEnvoys,
  processAgreements,
  sendEnvoy,
  type DiplomacyEvent,
} from './diplomacy';
import { setGovernment, setPolicy, unlockPolicies } from './effects';
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
  | { type: 'buildImprovement'; unitId: number; improvement: ImprovementId; tile?: number }
  | { type: 'pillage'; unitId: number }
  | { type: 'repair'; unitId: number }
  | { type: 'unlockPolicies' }
  | { type: 'setSpecialists'; cityId: number; district: string; count: number }
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
  | { type: 'declareWar'; target: number }
  | { type: 'sendEnvoy'; cityState: number }
  | { type: 'respondProposal'; id: number; accept: boolean }
  | { type: 'establishRoute'; unitId: number; cityId: number }
  | { type: 'choosePantheon'; belief: string }
  | { type: 'foundReligion'; unitId: number; religion: string; follower: string }
  | { type: 'buyWithFaith'; cityId: number; unit: string }
  | { type: 'spreadReligion'; unitId: number; cityId: number }
  | { type: 'activateGreatPerson'; unitId: number }
  | { type: 'theology'; unitId: number; target: number }
  | { type: 'passTurn' }
  | { type: 'purgeHeresy'; unitId: number; cityId: number }
  | { type: 'endTurn' };

export type GameEvent =
  | { type: 'error'; message: string }
  | { type: 'cityFounded'; cityId: number; name: string }
  | { type: 'unitMoved'; unitId: number; from: number; to: number }
  | { type: 'turnStarted'; turn: number }
  | { type: 'info'; message: string }
  | CityEvent
  | ResearchEvent
  | CombatEvent
  | DiplomacyEvent
  | ReligionEvent
  | GreatPersonEvent
  | TheologyEvent
  | { type: 'routeCreated'; owner: number; from: number; to: number }
  | { type: 'routeLost'; owner: number; from: number; to: number }
  | { type: 'disbanded'; player: number; unitType: string }
  | { type: 'victory'; player: number; victory: VictoryType }
  | { type: 'eraChanged'; player: number; era: string };

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

/** Aplica sem clonar (usado pela IA). Retorna mensagem de erro ou null. Em erro, o estado pode ter sido parcialmente alterado só se a ação já validou tudo antes de mutar. */
export function reduceAction(state: GameState, action: Action, events: GameEvent[]): string | null {
  const fail = (message: string): string => message;

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
          ? buildImprovement(state, u, action.improvement, action.tile)
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
      if ((action.item.kind === 'district' || action.item.kind === 'wonder') && action.item.tile === undefined) {
        return fail('Escolha o hexágono no mapa.');
      }
      if (action.item.kind === 'district') action.item = { ...action.item, cost: districtCost(state, c.owner) };
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
    case 'pillage':
    case 'repair': {
      const u = findUnit(state, action.unitId);
      if (!u || u.owner !== state.currentPlayer) return fail('Unidade inválida.');
      const r = action.type === 'pillage' ? pillage(state, u) : repairImprovement(state, u);
      if (!r.ok) return fail(r.reason);
      if (action.type === 'pillage') events.push({ type: 'info', message: `Melhoria saqueada: +${PILLAGE_GOLD} 🪙.` });
      break;
    }
    case 'setSpecialists': {
      const c = state.cities.find((x) => x.id === action.cityId);
      if (!c || c.owner !== state.currentPlayer) return fail('Cidade inválida.');
      const why = setSpecialists(state, c, action.district, action.count);
      if (why) return fail(why);
      break;
    }
    case 'unlockPolicies': {
      const why = unlockPolicies(state.players[state.currentPlayer]);
      if (why) return fail(why);
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
    case 'declareWar': {
      const r = declareWar(state, state.currentPlayer, action.target);
      if (typeof r === 'string') return fail(r);
      events.push(...r);
      break;
    }
    case 'sendEnvoy': {
      const r = sendEnvoy(state, state.currentPlayer, action.cityState);
      if (typeof r === 'string') return fail(r);
      events.push(...r);
      break;
    }
    case 'respondProposal': {
      const k = state.proposals.findIndex((p) => p.id === action.id && p.to === state.currentPlayer);
      if (k < 0) return fail('Proposta não encontrada.');
      const prop = state.proposals[k];
      state.proposals.splice(k, 1);
      if (action.accept) {
        const why = cannotApplyDeal(state, prop.from, prop.to, prop.items);
        if (why) return fail(why);
        events.push(...applyDeal(state, prop.from, prop.to, prop.items));
      }
      break;
    }
    case 'establishRoute': {
      const u = findUnit(state, action.unitId);
      if (!u || u.owner !== state.currentPlayer) return fail('Unidade inválida.');
      const r = establishRoute(state, u, action.cityId);
      if (typeof r === 'string') return fail(r);
      events.push({ type: 'routeCreated', owner: r.owner, from: r.from, to: r.to });
      break;
    }
    case 'choosePantheon': {
      const why = choosePantheon(state, state.currentPlayer, action.belief);
      if (why) return fail(why);
      events.push({ type: 'pantheon', player: state.currentPlayer, belief: action.belief });
      break;
    }
    case 'foundReligion': {
      const u = findUnit(state, action.unitId);
      if (!u || u.owner !== state.currentPlayer) return fail('Unidade inválida.');
      const r = foundReligion(state, u, action.religion, action.follower);
      if (typeof r === 'string') return fail(r);
      events.push(...r);
      break;
    }
    case 'buyWithFaith': {
      const c = state.cities.find((x) => x.id === action.cityId);
      if (!c || c.owner !== state.currentPlayer) return fail('Cidade inválida.');
      const def = UNITS[action.unit];
      if (!def?.faithCost) return fail('Esta unidade não é comprada com fé.');
      const why = canBuyMissionary(state, c, action.unit);
      if (why) return fail(why);
      const pos = [c.pos, ...neighbors(state.map, c.pos)].find(
        (i) => i >= 0 && isPassableLand(state.map.tiles[i]) && !state.units.some((x) => x.pos === i && UNITS[x.type].class === 'civilian'),
      );
      if (pos === undefined) return fail('Sem espaço para a unidade.');
      state.players[c.owner].faith -= def.faithCost;
      state.units.push({
        id: state.nextId++,
        type: def.id,
        owner: c.owner,
        pos,
        movesLeft: 0,
        hp: 100,
        xp: 0,
        promotions: [],
        charges: def.spreads,
        religion: c.religion,
      });
      break;
    }
    case 'spreadReligion': {
      const u = findUnit(state, action.unitId);
      if (!u || u.owner !== state.currentPlayer) return fail('Unidade inválida.');
      const r = spreadReligion(state, u, action.cityId);
      if (typeof r === 'string') return fail(r);
      events.push(...r);
      break;
    }
    case 'passTurn': {
      const next = nextHuman(state);
      if (next === null) return fail('Não há outro jogador humano nesta rodada.');
      state.currentPlayer = next;
      events.push(...checkContacts(state));
      break;
    }
    case 'theology': {
      const u = findUnit(state, action.unitId);
      if (!u || u.owner !== state.currentPlayer) return fail('Unidade inválida.');
      const r = theologicalCombat(state, u, action.target, () => nextRandom(state));
      if (typeof r === 'string') return fail(r);
      events.push(...r);
      break;
    }
    case 'purgeHeresy': {
      const u = findUnit(state, action.unitId);
      if (!u || u.owner !== state.currentPlayer) return fail('Unidade inválida.');
      const r = purgeHeresy(state, u, action.cityId);
      if (typeof r === 'string') return fail(r);
      events.push(...r);
      break;
    }
    case 'activateGreatPerson': {
      const u = findUnit(state, action.unitId);
      if (!u || u.owner !== state.currentPlayer) return fail('Unidade inválida.');
      const r = activateGreatPerson(state, u);
      if (!r.startsWith('OK:')) return fail(r);
      events.push({ type: 'info', message: r.slice(3) });
      break;
    }
    case 'endTurn': {
      events.push(...endTurn(state));
      events.push({ type: 'turnStarted', turn: state.turn });
      break;
    }
  }
  // eurecas/inspirações e contatos obtidos pela ação
  if (action.type !== 'endTurn') {
    events.push(...checkBoosts(state, state.currentPlayer));
    // contato é verificado a cada ação humana; a IA verifica ao fim do próprio turno
    if (state.players[state.currentPlayer]?.isHuman) events.push(...checkContacts(state));
  }
  return null;
}

export function applyAction(prev: GameState, action: Action): ActionResult {
  const state = structuredClone(prev);
  const events: GameEvent[] = [];
  const err = reduceAction(state, action, events);
  if (err) return { state: prev, events: [{ type: 'error', message: err }] };
  return { state, events };
}

/** Fim de turno (muta). Processa cidades, depois renova unidades. */
export function endTurn(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  const erasBefore = state.players.map((p) => playerEra(state, p.id).index);
  const hadWinner = !!state.winner;
  for (const p of state.players) p.policyChangeAvailable = false;
  // turno dos bárbaros (depois dos jogadores)
  events.push(...runBarbarianTurn(state));
  for (const c of [...state.cities]) events.push(...processCity(state, c));
  const civs = state.players.filter((p) => !p.isBarbarian && !p.eliminated);
  for (const p of civs) {
    events.push(...checkBoosts(state, p.id));
    const rev = processResearch(state, p.id);
    // cada cívica concluída concede 1 emissário
    for (const e of rev) if (e.type === 'civicDone' && !p.isCityState) p.envoyTokens++;
    events.push(...rev);
  }
  decayGrievances(state);
  events.push(...payMaintenance(state));
  events.push(...spreadPressure(state));
  events.push(...processGreatPeople(state));
  for (const r of cleanRoutes(state)) events.push({ type: 'routeLost', owner: r.owner, from: r.from, to: r.to });
  // propostas antigas expiram
  state.proposals = state.proposals.filter((p) => state.turn - p.turn < 3);
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
  events.push(...grantPeriodicEnvoys(state));
  events.push(...processAgreements(state));
  events.push(...checkContacts(state));
  events.push(...checkEliminations(state));
  for (const p of state.players) {
    if (p.isBarbarian || p.isCityState) continue;
    const e = playerEra(state, p.id);
    if (e.index > erasBefore[p.id]) events.push({ type: 'eraChanged', player: p.id, era: e.name });
  }
  checkVictory(state);
  if (state.winner && !hadWinner) events.push({ type: 'victory', player: state.winner.player, victory: state.winner.type });
  return events;
}

/** Cobra manutenção; se o ouro ficar negativo, dispensa unidades militares (muta). */
export function payMaintenance(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  for (const p of state.players) {
    if (p.isBarbarian || p.eliminated || p.isCityState) continue; // cidades-estado não pagam manutenção
    p.gold -= maintenanceOf(state, p.id).total;
    while (p.gold < 0) {
      const mil = state.units
        .filter((u) => u.owner === p.id && UNITS[u.type].class === 'military')
        .sort((a, b) => UNITS[a.type].strength - UNITS[b.type].strength || a.id - b.id);
      if (!mil.length) {
        p.gold = 0;
        break;
      }
      const victim = mil[0];
      state.units = state.units.filter((u) => u.id !== victim.id);
      p.gold += 1 + Math.floor(UNITS[victim.type].cost / 4);
      events.push({ type: 'disbanded', player: p.id, unitType: victim.type });
    }
  }
  return events;
}

/** Jogadores humanos ativos, na ordem da rodada. */
export function activeHumans(state: GameState): number[] {
  return state.players.filter((p) => p.isHuman && !p.eliminated).map((p) => p.id);
}

/** Próximo humano depois do atual nesta rodada (null se o atual é o último). */
export function nextHuman(state: GameState): number | null {
  const hs = activeHumans(state);
  const k = hs.indexOf(state.currentPlayer);
  return k >= 0 && k < hs.length - 1 ? hs[k + 1] : null;
}

/** Unidades do jogador que ainda esperam ordens neste turno. */
export function unitsNeedingOrders(state: GameState, playerId: number): Unit[] {
  return state.units.filter(
    (u) => u.owner === playerId && u.movesLeft > 0 && !u.fortified && !u.skipped && !(u.path && u.path.length),
  );
}
