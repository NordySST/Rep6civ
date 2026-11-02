import { BUILDINGS } from '../data/buildings';
import { GP_BASE_COST, GP_COST_STEP, GREAT_PERSON_TYPES, type GreatPersonType } from '../data/greatPeople';
import { UNITS } from '../data/units';
import type { GameState, Unit } from '../state/types';
import { itemKey } from './cities';
import { distance, neighbors } from './hex';
import { treeCost } from './research';
import { isPassableLand } from './tiles';

/**
 * Grandes personalidades: distritos geram pontos (+1 por distrito, +1 por edifício
 * do distrito). O primeiro a atingir o custo recruta; o próximo do tipo fica mais caro.
 */

export type GreatPersonEvent = { type: 'greatPerson'; player: number; gpType: GreatPersonType; name: string; unitId: number };

export function gpCost(state: GameState, t: GreatPersonType): number {
  return GP_BASE_COST + GP_COST_STEP * (state.gpRecruited[t] ?? 0);
}

export function gpPerTurn(state: GameState, playerId: number): Record<GreatPersonType, number> {
  const out = Object.fromEntries(Object.keys(GREAT_PERSON_TYPES).map((k) => [k, 0])) as Record<GreatPersonType, number>;
  for (const c of state.cities) {
    if (c.owner !== playerId) continue;
    for (const def of Object.values(GREAT_PERSON_TYPES)) {
      if (!c.districts.some((d) => d.type === def.district)) continue;
      out[def.id] += 1 + c.buildings.filter((b) => BUILDINGS[b]?.district === def.district).length;
    }
  }
  return out;
}

/** Acumula pontos e recruta (muta). */
export function processGreatPeople(state: GameState): GreatPersonEvent[] {
  const events: GreatPersonEvent[] = [];
  for (const p of state.players) {
    if (p.isBarbarian || p.isCityState || p.eliminated) continue;
    const per = gpPerTurn(state, p.id);
    for (const def of Object.values(GREAT_PERSON_TYPES)) {
      if (!per[def.id]) continue;
      p.gpPoints[def.id] = (p.gpPoints[def.id] ?? 0) + per[def.id];
      const cost = gpCost(state, def.id);
      if (p.gpPoints[def.id] < cost) continue;
      const city = state.cities.find((c) => c.owner === p.id && c.districts.some((d) => d.type === def.district));
      if (!city) continue;
      const pos = [city.pos, ...neighbors(state.map, city.pos)].find(
        (i) => i >= 0 && isPassableLand(state.map.tiles[i]) && !state.units.some((u) => u.pos === i && UNITS[u.type].class === 'civilian'),
      );
      if (pos === undefined) continue;
      p.gpPoints[def.id] -= cost;
      const n = state.gpRecruited[def.id] ?? 0;
      state.gpRecruited[def.id] = n + 1;
      const name = def.names[n % def.names.length] + (n >= def.names.length ? ` ${Math.floor(n / def.names.length) + 1}` : '');
      const u: Unit = { id: state.nextId++, type: def.unit, owner: p.id, pos, movesLeft: 0, hp: 100, xp: 0, promotions: [], name };
      state.units.push(u);
      events.push({ type: 'greatPerson', player: p.id, gpType: def.id, name, unitId: u.id });
    }
  }
  return events;
}

/** Ativa uma grande personalidade (exceto profeta, que usa foundReligion). Muta. */
export function activateGreatPerson(state: GameState, u: Unit): string {
  const t = UNITS[u.type]?.greatPerson as GreatPersonType | undefined;
  if (!t) return 'Não é uma grande personalidade.';
  const p = state.players[u.owner];
  let msg = '';
  switch (t) {
    case 'scientist': {
      const amount = p.researching ? Math.round(treeCost(p, 'tech', p.researching) * 0.5) : 40;
      p.science += amount;
      msg = `+${amount} de ciência.`;
      break;
    }
    case 'writer': {
      const amount = p.researchingCivic ? Math.round(treeCost(p, 'civic', p.researchingCivic) * 0.5) : 40;
      p.culture += amount;
      msg = `+${amount} de cultura.`;
      break;
    }
    case 'merchant':
      p.gold += 200;
      msg = '+200 de ouro.';
      break;
    case 'engineer': {
      const city = state.cities.find((c) => c.pos === u.pos && c.owner === u.owner);
      if (!city) return 'O engenheiro precisa estar numa cidade sua.';
      const item = city.queue[0];
      if (!item) return 'A cidade não está produzindo nada.';
      const key = itemKey(item);
      city.progress[key] = (city.progress[key] ?? 0) + 150;
      msg = `+150 de produção em ${city.name}.`;
      break;
    }
    case 'general': {
      let n = 0;
      for (const x of state.units) {
        if (x.owner === u.owner && UNITS[x.type].class === 'military' && distance(state.map, x.pos, u.pos) <= 2) {
          x.xp += 30;
          n++;
        }
      }
      if (!n) return 'Nenhuma unidade militar por perto.';
      msg = `+30 de XP para ${n} unidade(s).`;
      break;
    }
    case 'prophet':
      return 'Use "Fundar religião".';
  }
  state.units = state.units.filter((x) => x.id !== u.id);
  return 'OK:' + msg;
}
