import { FEATURE_REMOVAL, IMPROVEMENTS, type ImprovementId } from '../data/improvements';
import { RESOURCE_BY_ID } from '../data/resources';
import { UNITS } from '../data/units';
import type { GameState, Tile, Unit } from '../state/types';
import { assignCitizens } from './cities';
import { TECH_BY_ID } from '../data/techs';
import { atWar } from './combat';
import { neighbors } from './hex';
import { isPassableLand, isWater, visibleResource } from './tiles';

/**
 * Construtores: melhorias, estradas e remoção de características.
 * Melhorias e remoções gastam 1 carga; estradas não gastam carga.
 * Toda ação de construção consome o movimento restante da unidade.
 */

/** A melhoria pode existir neste hexágono (ignorando dono/unidade)? */
export function improvementFits(t: Tile, id: ImprovementId, techs?: readonly string[]): boolean {
  const def = IMPROVEMENTS[id];
  if (def.water) {
    // melhorias aquáticas: só sobre o recurso marinho correspondente
    if (!isWater(t) || t.wonder || t.district) return false;
    const r = visibleResource(t, techs);
    return !!r && RESOURCE_BY_ID[r]?.improvement === id;
  }
  if (!isPassableLand(t) || t.wonder) return false;
  const res = visibleResource(t, techs);
  if (res) {
    const r = RESOURCE_BY_ID[res];
    if (r?.improvement) {
      if (r.improvement !== id) return false;
      return !t.feature || !!def.features?.includes(t.feature);
    }
  }
  if (def.terrains.length === 0 || !def.terrains.includes(t.terrain)) return false;
  if (def.hills !== undefined && def.hills !== t.hills) return false;
  if (t.feature && !def.features?.includes(t.feature)) return false;
  return true;
}

function isBuilder(u: Unit): boolean {
  return (UNITS[u.type]?.charges ?? 0) > 0;
}

export type BuildCheck = { ok: true } | { ok: false; reason: string };

function baseCheck(state: GameState, u: Unit): BuildCheck {
  if (!isBuilder(u)) return { ok: false, reason: 'Apenas construtores.' };
  if (u.movesLeft <= 0) return { ok: false, reason: 'Sem movimentos restantes neste turno.' };
  const t = state.map.tiles[u.pos];
  if (t.owner !== u.owner) return { ok: false, reason: 'Só é possível construir no seu território.' };
  if (state.cities.some((c) => c.pos === u.pos)) return { ok: false, reason: 'Não é possível construir no centro da cidade.' };
  return { ok: true };
}

/** Hexágonos de água adjacentes onde o construtor pode erguer a melhoria aquática. */
export function waterTargets(state: GameState, u: Unit, id: ImprovementId): number[] {
  if (!IMPROVEMENTS[id].water) return [];
  const techs = state.players[u.owner]?.techs ?? [];
  return neighbors(state.map, u.pos).filter((n) => {
    if (n < 0) return false;
    const t = state.map.tiles[n];
    return t.owner === u.owner && t.improvement !== id && improvementFits(t, id, techs);
  });
}

export function canBuildImprovement(state: GameState, u: Unit, id: ImprovementId, target?: number): BuildCheck {
  if (IMPROVEMENTS[id].water) {
    if (!isBuilder(u)) return { ok: false, reason: 'Apenas construtores.' };
    if (u.movesLeft <= 0) return { ok: false, reason: 'Sem movimentos restantes neste turno.' };
    if ((u.charges ?? 0) <= 0) return { ok: false, reason: 'Sem cargas.' };
    const req = IMPROVEMENTS[id].requiresTech;
    const techs = state.players[u.owner]?.techs ?? [];
    if (req && !techs.includes(req)) return { ok: false, reason: `Exige ${TECH_BY_ID[req]?.name ?? req}.` };
    const targets = waterTargets(state, u, id);
    if (!targets.length || (target !== undefined && !targets.includes(target))) {
      return { ok: false, reason: 'Precisa estar ao lado de um recurso marinho do seu território.' };
    }
    return { ok: true };
  }
  const b = baseCheck(state, u);
  if (!b.ok) return b;
  if ((u.charges ?? 0) <= 0) return { ok: false, reason: 'Sem cargas.' };
  const t = state.map.tiles[u.pos];
  if (t.improvement === id) return { ok: false, reason: 'Já existe esta melhoria.' };
  const techs = state.players[u.owner]?.techs ?? [];
  if (!improvementFits(t, id, techs)) return { ok: false, reason: 'Melhoria inválida para este hexágono.' };
  const req = IMPROVEMENTS[id].requiresTech;
  if (req && !techs.includes(req)) return { ok: false, reason: `Exige ${TECH_BY_ID[req]?.name ?? req}.` };
  return { ok: true };
}

/** Melhorias possíveis no hexágono atual do construtor. */
export function availableImprovements(state: GameState, u: Unit): ImprovementId[] {
  return (Object.keys(IMPROVEMENTS) as ImprovementId[]).filter((id) => canBuildImprovement(state, u, id).ok);
}

function consume(state: GameState, u: Unit, charge: boolean): void {
  u.movesLeft = 0;
  delete u.path;
  if (charge) {
    u.charges = (u.charges ?? 1) - 1;
    if (u.charges <= 0) state.units = state.units.filter((x) => x.id !== u.id);
  }
}

function refreshOwnerCity(state: GameState, tile: Tile): void {
  const city = state.cities.find((c) => c.id === tile.cityId);
  if (city) assignCitizens(state, city);
}

export function buildImprovement(state: GameState, u: Unit, id: ImprovementId, target?: number): BuildCheck {
  const check = canBuildImprovement(state, u, id, target);
  if (!check.ok) return check;
  const tileIdx = IMPROVEMENTS[id].water ? (target ?? waterTargets(state, u, id)[0]) : u.pos;
  const t = state.map.tiles[tileIdx];
  t.improvement = id;
  delete t.pillaged;
  consume(state, u, true);
  refreshOwnerCity(state, t);
  return { ok: true };
}

// ------------------------------------------------------------------ saque e reparo

export function canRepair(state: GameState, u: Unit): BuildCheck {
  const b = baseCheck(state, u);
  if (!b.ok) return b;
  if (!state.map.tiles[u.pos].pillaged) return { ok: false, reason: 'Nada a reparar.' };
  return { ok: true };
}

/** Reparo de melhoria saqueada: não gasta carga, consome o movimento. */
export function repairImprovement(state: GameState, u: Unit): BuildCheck {
  const check = canRepair(state, u);
  if (!check.ok) return check;
  const t = state.map.tiles[u.pos];
  delete t.pillaged;
  consume(state, u, false);
  refreshOwnerCity(state, t);
  return { ok: true };
}

export const PILLAGE_GOLD = 15;

/** Unidade militar saqueia a melhoria do hexágono em que está (território inimigo). */
export function canPillage(state: GameState, u: Unit): BuildCheck {
  if (UNITS[u.type]?.class !== 'military') return { ok: false, reason: 'Apenas unidades militares saqueiam.' };
  if (u.movesLeft <= 0) return { ok: false, reason: 'Sem movimentos restantes.' };
  const t = state.map.tiles[u.pos];
  if (!t.improvement || t.pillaged) return { ok: false, reason: 'Nada a saquear.' };
  if (t.owner === undefined || t.owner === u.owner) return { ok: false, reason: 'Só em território inimigo.' };
  if (!atWar(state, u.owner, t.owner)) return { ok: false, reason: 'Só contra quem está em guerra com você.' };
  return { ok: true };
}

export function pillage(state: GameState, u: Unit): BuildCheck {
  const check = canPillage(state, u);
  if (!check.ok) return check;
  const t = state.map.tiles[u.pos];
  t.pillaged = true;
  if (!state.players[u.owner].isBarbarian) state.players[u.owner].gold += PILLAGE_GOLD;
  u.movesLeft = 0;
  u.acted = true;
  delete u.path;
  refreshOwnerCity(state, t);
  return { ok: true };
}

export function canBuildRoad(state: GameState, u: Unit): BuildCheck {
  const b = baseCheck(state, u);
  if (!b.ok) return b;
  if (state.map.tiles[u.pos].road) return { ok: false, reason: 'Já existe estrada aqui.' };
  return { ok: true };
}

export function buildRoad(state: GameState, u: Unit): BuildCheck {
  const check = canBuildRoad(state, u);
  if (!check.ok) return check;
  state.map.tiles[u.pos].road = true;
  consume(state, u, false);
  return { ok: true };
}

export function canRemoveFeature(state: GameState, u: Unit): BuildCheck {
  const b = baseCheck(state, u);
  if (!b.ok) return b;
  if ((u.charges ?? 0) <= 0) return { ok: false, reason: 'Sem cargas.' };
  const t = state.map.tiles[u.pos];
  if (!t.feature || !FEATURE_REMOVAL[t.feature]) return { ok: false, reason: 'Nada a remover.' };
  return { ok: true };
}

/** Remove a característica; produção vai para o item atual da cidade dona. */
export function removeFeature(state: GameState, u: Unit): BuildCheck & { production?: number } {
  const check = canRemoveFeature(state, u);
  if (!check.ok) return check;
  const t = state.map.tiles[u.pos];
  const rem = FEATURE_REMOVAL[t.feature!]!;
  delete t.feature;
  // melhorias que dependiam da característica deixam de ser válidas
  if (t.improvement && !improvementFits(t, t.improvement as ImprovementId, state.players[u.owner]?.techs)) delete t.improvement;
  const city = state.cities.find((c) => c.id === t.cityId);
  if (city && rem.production > 0) {
    const item = city.queue[0];
    if (item) {
      const key = `${item.kind}:${item.id}`;
      city.progress[key] = (city.progress[key] ?? 0) + rem.production;
    }
  }
  consume(state, u, true);
  refreshOwnerCity(state, t);
  return { ok: true, production: city ? rem.production : 0 };
}
