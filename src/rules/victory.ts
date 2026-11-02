import { CIVICS } from '../data/civics';
import { ERAS } from '../data/eras';
import { TECH_BY_ID, TECHS } from '../data/techs';
import type { GameState, VictoryType, Winner } from '../state/types';
import { hasAllTechs } from './cities';

/**
 * Condições de vitória e pontuação.
 *  - Dominação: controlar a capital original de todas as civilizações (≥ 2 na partida).
 *  - Científica: concluir o projeto Expedição Celeste (exige todas as tecnologias).
 *  - Cultural: todas as cívicas e cultura acumulada ≥ 3000 e ≥ 1,5× a de cada rival ativo.
 *  - Religiosa: sua religião é seguida pela maioria das cidades de cada civilização (≥ 2)
 *    e por mais da metade de todas as cidades do mundo.
 *  - Pontuação: no turno final, a maior pontuação vence.
 */

export const CULTURE_VICTORY_MIN = 3000;
export const CULTURE_VICTORY_RATIO = 1.5;

export const VICTORY_LABELS: Record<VictoryType, string> = {
  domination: 'Dominação',
  science: 'Científica',
  culture: 'Cultural',
  religion: 'Religiosa',
  score: 'Pontuação',
};

function majors(state: GameState) {
  return state.players.filter((p) => !p.isBarbarian && !p.isCityState);
}

function activeMajors(state: GameState) {
  return majors(state).filter((p) => !p.eliminated);
}

export interface ScoreParts {
  cities: number;
  population: number;
  techs: number;
  civics: number;
  wonders: number;
  districts: number;
  greatPeople: number;
  religion: number;
  total: number;
}

export function scoreOf(state: GameState, id: number): ScoreParts {
  const p = state.players[id];
  const mine = state.cities.filter((c) => c.owner === id);
  const cities = mine.length * 5;
  const population = mine.reduce((s, c) => s + c.population, 0);
  const techs = p.techs.length * 3;
  const civics = p.civics.length * 3;
  const wonders = mine.reduce((s, c) => s + c.wonders.length, 0) * 15;
  const districts = mine.reduce((s, c) => s + c.districts.length, 0) * 2;
  const greatPeople = state.units.filter((u) => u.owner === id && u.name).length * 5;
  const rel = state.religions.find((r) => r.founder === id);
  const religion = rel ? 10 + state.cities.filter((c) => c.religion === rel.id).length * 2 : 0;
  const total = cities + population + techs + civics + wonders + districts + greatPeople + religion;
  return { cities, population, techs, civics, wonders, districts, greatPeople, religion, total };
}

// ------------------------------------------------------------------ progresso por tipo

export function originalCapitals(state: GameState) {
  const ids = new Set(majors(state).map((p) => p.id));
  return state.cities.filter((c) => c.originalCapitalOf !== undefined && ids.has(c.originalCapitalOf));
}

export function dominationProgress(state: GameState, id: number): { held: number; total: number } {
  const caps = originalCapitals(state);
  return { held: caps.filter((c) => c.owner === id).length, total: caps.length };
}

export function religionProgress(state: GameState, id: number): { majority: number; total: number } {
  const rel = state.religions.find((r) => r.founder === id);
  const civs = activeMajors(state).filter((p) => state.cities.some((c) => c.owner === p.id));
  if (!rel) return { majority: 0, total: civs.length };
  let majority = 0;
  for (const p of civs) {
    const cs = state.cities.filter((c) => c.owner === p.id);
    if (cs.filter((c) => c.religion === rel.id).length * 2 > cs.length) majority++;
  }
  return { majority, total: civs.length };
}

/** Fração de todas as cidades do mundo (inclui cidades-estado) que segue a religião do jogador. */
export function worldReligionShare(state: GameState, id: number): number {
  const rel = state.religions.find((r) => r.founder === id);
  if (!rel || !state.cities.length) return 0;
  return state.cities.filter((c) => c.religion === rel.id).length / state.cities.length;
}

export function cultureProgress(state: GameState, id: number): { civics: number; totalCivics: number; culture: number; bestRival: number } {
  const p = state.players[id];
  const rivals = activeMajors(state).filter((x) => x.id !== id);
  return {
    civics: p.civics.length,
    totalCivics: CIVICS.length,
    culture: Math.floor(p.lifetimeCulture),
    bestRival: Math.floor(Math.max(0, ...rivals.map((r) => r.lifetimeCulture))),
  };
}

export function scienceProgress(state: GameState, id: number): { techs: number; totalTechs: number } {
  return { techs: state.players[id].techs.length, totalTechs: TECHS.length };
}

// ------------------------------------------------------------------ verificação

/** Verifica vitórias no fim do turno (muta `state.winner`). */
export function checkVictory(state: GameState): Winner | null {
  if (state.winner) return null;
  const act = activeMajors(state);
  const multi = majors(state).length >= 2;
  for (const p of act) {
    // dominação
    const dom = dominationProgress(state, p.id);
    if (multi && dom.total >= 2 && dom.held === dom.total) return (state.winner = { player: p.id, type: 'domination', turn: state.turn });
    // cultura
    const cul = cultureProgress(state, p.id);
    if (cul.civics === cul.totalCivics && cul.culture >= CULTURE_VICTORY_MIN && cul.culture >= cul.bestRival * CULTURE_VICTORY_RATIO) {
      return (state.winner = { player: p.id, type: 'culture', turn: state.turn });
    }
    // religião
    const rel = religionProgress(state, p.id);
    if (multi && rel.total >= 2 && rel.majority === rel.total && worldReligionShare(state, p.id) > 0.5) {
      return (state.winner = { player: p.id, type: 'religion', turn: state.turn });
    }
  }
  // pontuação no turno final
  const limit = state.settings.turnLimit;
  if (limit && state.turn >= limit && act.length) {
    const best = act.reduce((a, b) => (scoreOf(state, b.id).total > scoreOf(state, a.id).total ? b : a));
    return (state.winner = { player: best.id, type: 'score', turn: state.turn });
  }
  return null;
}

// ------------------------------------------------------------------ eras

export function playerEra(state: GameState, id: number): { id: string; name: string; index: number } {
  const maxCost = Math.max(0, ...state.players[id].techs.map((t) => TECH_BY_ID[t]?.cost ?? 0));
  let idx = 0;
  ERAS.forEach((e, k) => {
    if (maxCost >= e.minTechCost) idx = k;
  });
  return { ...ERAS[idx], index: idx };
}

export { hasAllTechs };
