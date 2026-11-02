import { BOOST_FRACTION, type Boost, type BoostCondition } from '../data/boosts';
import { CIVIC_BY_ID, CIVICS } from '../data/civics';
import { GOVERNMENTS } from '../data/governments';
import { TECH_BY_ID, TECHS } from '../data/techs';
import { WONDER_BY_ID } from '../data/wonders';
import type { GameState, Player } from '../state/types';
import { governmentSlots } from './effects';
import { isCoastalCity } from './cities';

/**
 * Pesquisa (tecnologias) e cívicas. A ciência/cultura do turno entra no estoque
 * do jogador (`player.science`/`player.culture`) e flui inteira para o item atual;
 * o excedente volta ao estoque e segue para o próximo item escolhido.
 */

export type TreeKind = 'tech' | 'civic';

export type ResearchEvent =
  | { type: 'techDone'; playerId: number; id: string }
  | { type: 'civicDone'; playerId: number; id: string }
  | { type: 'boost'; playerId: number; kind: TreeKind; id: string }
  | { type: 'governmentUnlocked'; playerId: number; id: string };

function defs(kind: TreeKind) {
  return kind === 'tech' ? TECH_BY_ID : CIVIC_BY_ID;
}

export function known(p: Player, kind: TreeKind): string[] {
  return kind === 'tech' ? p.techs : p.civics;
}

export function treeCost(p: Player, kind: TreeKind, id: string): number {
  const def = defs(kind)[id];
  if (!def) return Infinity;
  return Math.round(def.cost * (p.boosts.includes(id) ? 1 - BOOST_FRACTION : 1));
}

export function progressOf(p: Player, kind: TreeKind, id: string): number {
  return (kind === 'tech' ? p.techProgress : p.civicProgress)[id] ?? 0;
}

export function canResearch(p: Player, kind: TreeKind, id: string): boolean {
  const def = defs(kind)[id];
  if (!def) return false;
  const k = known(p, kind);
  return !k.includes(id) && def.prereqs.every((r) => k.includes(r));
}

export function availableItems(p: Player, kind: TreeKind): string[] {
  const list = kind === 'tech' ? TECHS : CIVICS;
  return list.filter((d) => canResearch(p, kind, d.id)).map((d) => d.id);
}

/**
 * Caminho até `id`: itens ainda não conhecidos (inclui `id`) em ordem válida — cada um
 * depois dos seus pré-requisitos; entre os disponíveis, o mais barato primeiro.
 */
export function pathTo(p: Player, kind: TreeKind, id: string): string[] {
  const d = defs(kind);
  const k = new Set(known(p, kind));
  if (!d[id] || k.has(id)) return [];
  const need = new Set<string>();
  const visit = (x: string) => {
    if (k.has(x) || need.has(x) || !d[x]) return;
    need.add(x);
    d[x].prereqs.forEach(visit);
  };
  visit(id);
  const out: string[] = [];
  const done = new Set(k);
  while (need.size) {
    const ready = [...need].filter((x) => d[x].prereqs.every((r) => done.has(r)));
    if (!ready.length) break;
    ready.sort((a, b) => treeCost(p, kind, a) - treeCost(p, kind, b) || a.localeCompare(b));
    const next = ready[0];
    out.push(next);
    done.add(next);
    need.delete(next);
  }
  return out;
}

/**
 * Escolhe o que pesquisar. Item disponível: pesquisa direto. Item futuro: vira o destino e
 * começa pelo primeiro pré-requisito do caminho (os seguintes entram sozinhos).
 */
export function setResearch(p: Player, kind: TreeKind, id: string): string | null {
  const def = defs(kind)[id];
  if (!def || known(p, kind).includes(id)) return 'Ainda não disponível.';
  const path = canResearch(p, kind, id) ? [id] : pathTo(p, kind, id);
  if (!path.length || !canResearch(p, kind, path[0])) return 'Ainda não disponível.';
  const target = path.length > 1 ? id : undefined;
  if (kind === 'tech') {
    p.researching = path[0];
    p.researchTarget = target;
  } else {
    p.researchingCivic = path[0];
    p.civicTarget = target;
  }
  return null;
}

/** Destino atual (se houver) e o caminho restante até ele. */
export function targetOf(p: Player, kind: TreeKind): { target?: string; path: string[] } {
  const target = kind === 'tech' ? p.researchTarget : p.civicTarget;
  return target ? { target, path: pathTo(p, kind, target) } : { path: [] };
}

/** Profundidade do item na árvore (0 = sem pré-requisitos), para agrupar na UI. */
export function treeDepth(kind: TreeKind, id: string, memo = new Map<string, number>()): number {
  if (memo.has(id)) return memo.get(id)!;
  const def = defs(kind)[id];
  const d = def && def.prereqs.length ? 1 + Math.max(...def.prereqs.map((r) => treeDepth(kind, r, memo))) : 0;
  memo.set(id, d);
  return d;
}

/** Turnos estimados para concluir com a renda dada. */
export function turnsFor(p: Player, kind: TreeKind, id: string, perTurn: number): number {
  const stock = (kind === 'tech' ? p.researching : p.researchingCivic) === id ? (kind === 'tech' ? p.science : p.culture) : 0;
  const remaining = treeCost(p, kind, id) - progressOf(p, kind, id) - stock;
  if (remaining <= 0) return 1;
  if (perTurn <= 0) return Infinity;
  return Math.ceil(remaining / perTurn);
}

// ------------------------------------------------------------------ eurecas e inspirações

export function conditionMet(state: GameState, playerId: number, c: BoostCondition): boolean {
  const p = state.players[playerId];
  const myCities = state.cities.filter((x) => x.owner === playerId);
  const ownedTiles = state.map.tiles.filter((t) => t.owner === playerId);
  switch (c.type) {
    case 'cities':
      return myCities.length >= c.count;
    case 'coastalCity':
      return myCities.some((x) => isCoastalCity(state, x));
    case 'improvements':
      return ownedTiles.filter((t) => t.improvement && (c.improvement === '*' || t.improvement === c.improvement)).length >= c.count;
    case 'buildings':
      return myCities.filter((x) => x.buildings.includes(c.building)).length >= c.count;
    case 'units':
      return state.units.filter((u) => u.owner === playerId && u.type === c.unit).length >= c.count;
    case 'roads':
      return ownedTiles.filter((t) => t.road).length >= c.count;
    case 'population':
      return myCities.some((x) => x.population >= c.count);
    case 'gold':
      return p.gold >= c.count;
    case 'naturalWonderSeen':
      return state.map.tiles.some((t, i) => t.wonder && WONDER_BY_ID[t.wonder] && p.explored[i] === 1);
    case 'explored': {
      const n = p.explored.reduce((a, b) => a + b, 0);
      return (n / p.explored.length) * 100 >= c.percent;
    }
    case 'techs':
      return p.techs.length >= c.count;
    case 'civics':
      return p.civics.length >= c.count;
    case 'territory':
      return ownedTiles.length >= c.count;
  }
}

/** Concede eurecas/inspirações cujas condições já foram cumpridas. Muta. */
export function checkBoosts(state: GameState, playerId: number): ResearchEvent[] {
  const p = state.players[playerId];
  const events: ResearchEvent[] = [];
  const scan = (kind: TreeKind, list: { id: string; boost?: Boost }[]) => {
    for (const d of list) {
      if (!d.boost || p.boosts.includes(d.id) || known(p, kind).includes(d.id)) continue;
      if (conditionMet(state, playerId, d.boost.condition)) {
        p.boosts.push(d.id);
        events.push({ type: 'boost', playerId, kind, id: d.id });
      }
    }
  };
  scan('tech', TECHS);
  scan('civic', CIVICS);
  return events;
}

// ------------------------------------------------------------------ conclusão

function completeCivic(p: Player, id: string, events: ResearchEvent[]): void {
  p.civics.push(id);
  p.policyChangeAvailable = true;
  for (const g of GOVERNMENTS) {
    if (g.civic !== id) continue;
    events.push({ type: 'governmentUnlocked', playerId: p.id, id: g.id });
    if (!p.government) {
      // primeiro governo é adotado automaticamente
      p.government = g.id;
      p.policies = governmentSlots(g.id).map(() => null);
    }
  }
}

/** Aplica o estoque de ciência/cultura aos itens atuais. Muta. */
export function processResearch(state: GameState, playerId: number): ResearchEvent[] {
  const p = state.players[playerId];
  const events: ResearchEvent[] = [];
  const step = (kind: TreeKind) => {
    const cur = kind === 'tech' ? p.researching : p.researchingCivic;
    if (!cur) return;
    const prog = kind === 'tech' ? p.techProgress : p.civicProgress;
    const stockKey = kind === 'tech' ? 'science' : 'culture';
    prog[cur] = (prog[cur] ?? 0) + p[stockKey];
    p[stockKey] = 0;
    const cost = treeCost(p, kind, cur);
    if (prog[cur] >= cost) {
      p[stockKey] = Math.round((prog[cur] - cost) * 100) / 100;
      delete prog[cur];
      if (kind === 'tech') {
        p.techs.push(cur);
        p.researching = null;
        events.push({ type: 'techDone', playerId, id: cur });
      } else {
        p.researchingCivic = null;
        completeCivic(p, cur, events);
        events.push({ type: 'civicDone', playerId, id: cur });
      }
      // segue o caminho até o destino escolhido
      const target = kind === 'tech' ? p.researchTarget : p.civicTarget;
      if (target) {
        const next = pathTo(p, kind, target)[0];
        if (next && canResearch(p, kind, next)) {
          if (kind === 'tech') p.researching = next;
          else p.researchingCivic = next;
        }
        if (!next || next === target) {
          if (kind === 'tech') delete p.researchTarget;
          else delete p.civicTarget;
        }
      }
    }
  };
  step('tech');
  step('civic');
  return events;
}

/** Jogador precisa escolher pesquisa ou cívica? */
export function needsResearchChoice(p: Player): TreeKind | null {
  if (!p.researching && availableItems(p, 'tech').length) return 'tech';
  if (!p.researchingCivic && availableItems(p, 'civic').length) return 'civic';
  return null;
}
