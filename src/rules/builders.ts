import { FEATURE_REMOVAL, IMPROVEMENTS, type ImprovementId } from '../data/improvements';
import { RESOURCE_BY_ID } from '../data/resources';
import { UNITS } from '../data/units';
import type { GameState, Tile, Unit } from '../state/types';
import { assignCitizens } from './cities';
import { isPassableLand } from './tiles';

/**
 * Construtores: melhorias, estradas e remoção de características.
 * Melhorias e remoções gastam 1 carga; estradas não gastam carga.
 * Toda ação de construção consome o movimento restante da unidade.
 */

/** A melhoria pode existir neste hexágono (ignorando dono/unidade)? */
export function improvementFits(t: Tile, id: ImprovementId): boolean {
  const def = IMPROVEMENTS[id];
  if (!isPassableLand(t) || t.wonder) return false;
  if (t.resource) {
    const r = RESOURCE_BY_ID[t.resource];
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

export function canBuildImprovement(state: GameState, u: Unit, id: ImprovementId): BuildCheck {
  const b = baseCheck(state, u);
  if (!b.ok) return b;
  if ((u.charges ?? 0) <= 0) return { ok: false, reason: 'Sem cargas.' };
  const t = state.map.tiles[u.pos];
  if (t.improvement === id) return { ok: false, reason: 'Já existe esta melhoria.' };
  if (!improvementFits(t, id)) return { ok: false, reason: 'Melhoria inválida para este hexágono.' };
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

export function buildImprovement(state: GameState, u: Unit, id: ImprovementId): BuildCheck {
  const check = canBuildImprovement(state, u, id);
  if (!check.ok) return check;
  const t = state.map.tiles[u.pos];
  t.improvement = id;
  consume(state, u, true);
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
  if (t.improvement && !improvementFits(t, t.improvement as ImprovementId)) delete t.improvement;
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
