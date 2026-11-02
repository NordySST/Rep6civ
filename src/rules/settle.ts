import { RESOURCE_BY_ID } from '../data/resources';
import type { GameState } from '../state/types';
import { MIN_CITY_DISTANCE } from './city';
import { distance, neighbors, tilesInRadius } from './hex';
import { isPassableLand, isWater, tileYields, visibleResource } from './tiles';

/**
 * Avaliação de locais para fundar cidades (lente do colono) do ponto de vista de um
 * jogador: só usa hexágonos explorados, recursos já revelados e cidades conhecidas (não
 * vaza informação escondida). Pura; não muda regras — a moradia por água doce/costa é a
 * de `cityHousing`.
 */

export interface SiteInfo {
  idx: number;
  valid: boolean;
  reason?: string;
  score: number;
  freshWater: boolean;
  coastal: boolean;
  hills: boolean;
  /** Moradia inicial (base 2, +3 rio ou +1 costa, +1 Palácio na primeira cidade). */
  housing: number;
  /** Comida/produção somadas dos hexágonos conhecidos a até 2 do centro. */
  food: number;
  production: number;
  luxuries: number;
  strategics: number;
  bonuses: number;
  /** Hexágonos inexplorados a até 2 (avaliação incerta). */
  unknown: number;
}

/** Qualidade relativa: 3 ótimo, 2 bom, 1 fraco. */
export type SiteTier = 1 | 2 | 3;

export function siteInfo(state: GameState, player: number, idx: number): SiteInfo {
  const p = state.players[player];
  const known = (i: number) => p.explored[i] === 1;
  const t = state.map.tiles[idx];
  const info: SiteInfo = {
    idx,
    valid: true,
    score: 0,
    freshWater: t.rivers !== 0,
    coastal: neighbors(state.map, idx).some((n) => n >= 0 && isWater(state.map.tiles[n])),
    hills: t.hills,
    housing: 2,
    food: 0,
    production: 0,
    luxuries: 0,
    strategics: 0,
    bonuses: 0,
    unknown: 0,
  };
  if (!known(idx) || !isPassableLand(t)) return { ...info, valid: false, reason: 'Terreno inválido para uma cidade.', score: -Infinity };
  if (t.owner !== undefined && t.owner !== player) return { ...info, valid: false, reason: 'Território de outra civilização.', score: -Infinity };
  const near = state.cities.find((c) => known(c.pos) && distance(state.map, c.pos, idx) < MIN_CITY_DISTANCE);
  if (near) return { ...info, valid: false, reason: `Muito perto de ${near.name}.`, score: -Infinity };

  info.housing += info.freshWater ? 3 : info.coastal ? 1 : 0;
  if (!state.cities.some((c) => c.owner === player)) info.housing += 1;
  let score = 0;
  for (const j of tilesInRadius(state.map, idx, 2)) {
    if (j === idx) continue;
    const w = distance(state.map, idx, j) === 1 ? 1 : 0.6;
    if (!known(j)) {
      info.unknown++;
      score += w * 1.6;
      continue;
    }
    const tj = state.map.tiles[j];
    const y = tileYields(tj, p.techs);
    info.food += y.food;
    info.production += y.production;
    score += w * (y.food * 1.2 + y.production + y.gold * 0.5 + y.science + y.culture + y.faith);
    const res = visibleResource(tj, p.techs);
    if (res) {
      const kind = RESOURCE_BY_ID[res]?.kind;
      if (kind === 'luxury') {
        info.luxuries++;
        score += w * 2;
      } else if (kind === 'strategic') {
        info.strategics++;
        score += w * 1.5;
      } else {
        info.bonuses++;
        score += w * 0.8;
      }
    }
    if (tj.terrain === 'mountain') score -= 0.5;
    if (tj.terrain === 'ocean') score -= 0.4;
  }
  if (info.freshWater) score += 5;
  else if (info.coastal) score += 2.5;
  if (info.hills) score += 1.5;
  if (t.terrain === 'snow') score -= 6;
  else if (t.terrain === 'tundra' || t.terrain === 'desert') score -= 3;
  info.score = score;
  return info;
}

export interface SiteRanking {
  tiers: Map<number, SiteTier>;
  /** Até 3 melhores locais (do melhor para o pior), afastados entre si. */
  best: number[];
  infos: Map<number, SiteInfo>;
}

/** Classifica os locais válidos a até `radius` de `from`. */
export function rankSites(state: GameState, player: number, from: number, radius = 6): SiteRanking {
  const infos = new Map<number, SiteInfo>();
  for (const i of tilesInRadius(state.map, from, radius)) {
    const s = siteInfo(state, player, i);
    if (s.valid) infos.set(i, s);
  }
  const tiers = new Map<number, SiteTier>();
  const sorted = [...infos.values()].sort((a, b) => b.score - a.score || a.idx - b.idx);
  const top = sorted[0]?.score ?? 0;
  for (const s of sorted) {
    const r = top > 0 ? s.score / top : 0;
    tiers.set(s.idx, r >= 0.85 ? 3 : r >= 0.65 ? 2 : 1);
  }
  const best: number[] = [];
  for (const s of sorted) {
    if (best.length >= 3) break;
    if (best.every((b) => distance(state.map, b, s.idx) >= 2)) best.push(s.idx);
  }
  return { tiers, best, infos };
}

/** Avisos antes de fundar em `idx` (lista vazia = local sem ressalvas). */
export function siteWarnings(state: GameState, player: number, idx: number): string[] {
  const s = siteInfo(state, player, idx);
  if (!s.valid) return [];
  const out: string[] = [];
  if (!s.freshWater) {
    out.push(
      s.coastal
        ? `Sem água doce: moradia ${s.housing} (o crescimento desacelera a partir da população ${s.housing - 1}).`
        : `Sem água doce nem costa: moradia ${s.housing} (o crescimento desacelera a partir da população ${s.housing - 1}).`,
    );
  }
  if (s.food < 8 && s.unknown < 6) out.push(`Pouca comida por perto (${s.food} 🌾 nos hexágonos conhecidos).`);
  const t = state.map.tiles[idx];
  if (t.terrain === 'snow' || t.terrain === 'tundra' || t.terrain === 'desert') out.push('Terreno pobre no centro da cidade.');
  const rank = rankSites(state, player, idx, 3);
  const better = rank.best.find((b) => b !== idx && (rank.infos.get(b)?.score ?? 0) >= s.score * 1.25 + 2);
  if (better !== undefined) out.push(`Há um local bem melhor a ${distance(state.map, idx, better)} hexágono(s) daqui.`);
  return out;
}

/** Resumo curto dos motivos da nota (para o painel). */
export function siteSummary(s: SiteInfo): string {
  const parts: string[] = [];
  parts.push(`🏠 ${s.housing}${s.freshWater ? ' (rio)' : s.coastal ? ' (costa)' : ''}`);
  if (s.hills) parts.push('colina');
  parts.push(`${s.food}🌾 ${s.production}⚒ em volta`);
  const res = s.luxuries + s.strategics + s.bonuses;
  if (res) parts.push(`${res} recurso(s)${s.luxuries ? ` (${s.luxuries} de luxo)` : ''}`);
  if (s.unknown >= 4) parts.push('área pouco explorada');
  return parts.join(' · ');
}
