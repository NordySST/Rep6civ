import { describe, expect, it } from 'vitest';
import { applyAction, endTurn } from '../src/rules/actions';
import {
  assignCitizens,
  borderThreshold,
  cityHousing,
  cityYields,
  expansionCandidates,
  growthThreshold,
  housingGrowthModifier,
  normalizeState,
  processCity,
  purchaseCost,
  tilePurchaseCost,
  workableTiles,
} from '../src/rules/cities';
import { foundCity } from '../src/rules/city';
import { distance, neighbor } from '../src/rules/hex';
import { deserialize } from '../src/state/save';
import { SCHEMA_VERSION } from '../src/state/version';
import type { GameState } from '../src/state/types';
import { flatGame } from './helpers';

function withCity(s = flatGame(16, 12), pos = 5 * 16 + 6) {
  s.units.push({ id: 500, type: 'settler', owner: 0, pos, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
  const city = foundCity(s, s.units[0]);
  return { s, city };
}

describe('fórmulas', () => {
  it('limiar de crescimento cresce com a população', () => {
    expect(growthThreshold(1)).toBe(15);
    expect(growthThreshold(2)).toBe(24);
    expect(growthThreshold(5)).toBeGreaterThan(growthThreshold(4));
  });
  it('moradia reduz o crescimento perto do limite', () => {
    expect(housingGrowthModifier(1, 5)).toBe(1);
    expect(housingGrowthModifier(4, 5)).toBe(0.5);
    expect(housingGrowthModifier(5, 5)).toBe(0.25);
    expect(housingGrowthModifier(9, 5)).toBe(0);
  });
  it('limiar de fronteira cresce com hexágonos já obtidos', () => {
    expect(borderThreshold(0)).toBe(10);
    expect(borderThreshold(3)).toBeGreaterThan(borderThreshold(1));
  });
});

describe('cidade fundada', () => {
  it('tem centro com mínimo 2 comida / 1 produção, palácio e 1 cidadão trabalhando', () => {
    const { s, city } = withCity();
    expect(city.buildings).toContain('palace');
    expect(city.worked).toHaveLength(1);
    const y = cityYields(s, city);
    // centro (2/1) + pradaria (2/0) + palácio (0/2/3 ouro…)
    expect(y.food).toBe(4);
    expect(y.production).toBe(3);
    expect(y.gold).toBe(3);
    expect(workableTiles(s, city)).toHaveLength(6);
  });

  it('moradia: base 2, rio +3, costa +1, palácio +1', () => {
    const { s, city } = withCity();
    expect(cityHousing(s, city)).toBe(3);
    s.map.tiles[city.pos].rivers = 1;
    expect(cityHousing(s, city)).toBe(6);
  });
});

describe('crescimento e produção', () => {
  it('cresce ao acumular comida suficiente', () => {
    const { s, city } = withCity();
    city.queue.push({ kind: 'unit', id: 'warrior' });
    let turns = 0;
    while (city.population === 1 && turns < 20) {
      processCity(s, city);
      turns++;
    }
    expect(city.population).toBe(2);
    expect(turns).toBe(8); // +2 por turno, limiar 15
    expect(city.worked).toHaveLength(2);
  });

  it('conclui unidade, leva excedente adiante e a nova unidade aparece na cidade', () => {
    const { s, city } = withCity();
    city.queue.push({ kind: 'unit', id: 'scout' }, { kind: 'building', id: 'monument' });
    city.progress['unit:scout'] = 29;
    const ev = processCity(s, city); // produção 3 → conclui batedor com 2 de sobra
    expect(ev.some((e) => e.type === 'produced')).toBe(true);
    const scout = s.units.find((u) => u.type === 'scout')!;
    expect(scout.pos).toBe(city.pos);
    expect(city.queue).toEqual([{ kind: 'building', id: 'monument' }]);
    expect(city.progress['building:monument']).toBe(2);
  });

  it('edifício concluído soma rendimentos', () => {
    const { s, city } = withCity();
    city.queue.push({ kind: 'building', id: 'monument' });
    city.progress['building:monument'] = 59;
    const before = cityYields(s, city).culture;
    processCity(s, city);
    expect(city.buildings).toContain('monument');
    expect(cityYields(s, city).culture).toBe(before + 2);
  });

  it('colono exige população 2 e a consome', () => {
    const { s, city } = withCity();
    const r1 = applyAction(s, { type: 'setProduction', cityId: city.id, item: { kind: 'unit', id: 'settler' } });
    expect(r1.events[0].type).toBe('error');
    city.population = 2;
    assignCitizens(s, city);
    city.queue.push({ kind: 'unit', id: 'settler' });
    city.progress['unit:settler'] = 79;
    processCity(s, city);
    expect(city.population).toBe(1);
    expect(s.units.some((u) => u.type === 'settler')).toBe(true);
  });

  it('cidade sem produção gera aviso e o fim de turno acumula ouro', () => {
    const { s, city } = withCity();
    const gold = s.players[0].gold;
    const events = endTurn(s);
    expect(events.some((e) => e.type === 'needsProduction' && e.cityId === city.id)).toBe(true);
    expect(s.players[0].gold).toBe(gold + 3);
    expect(s.players[0].science).toBe(2);
  });

  it('fome reduz população', () => {
    const { s, city } = withCity();
    city.population = 4;
    city.foodStored = 0;
    for (const t of s.map.tiles) t.terrain = 'desert';
    s.map.tiles[city.pos].terrain = 'desert';
    assignCitizens(s, city);
    processCity(s, city);
    expect(city.population).toBe(3);
  });
});

describe('cidadãos', () => {
  it('fixar um hexágono o mantém trabalhado', () => {
    const { s, city } = withCity();
    const target = workableTiles(s, city).find((i) => !city.worked.includes(i))!;
    const { state } = applyAction(s, { type: 'toggleTile', cityId: city.id, tile: target });
    const c = state.cities[0];
    expect(c.worked).toEqual([target]);
    expect(c.locked).toEqual([target]);
    const r2 = applyAction(state, { type: 'toggleTile', cityId: city.id, tile: target });
    expect(r2.state.cities[0].locked).toEqual([]);
  });

  it('prioriza recursos valiosos e o foco muda a escolha', () => {
    const { s, city } = withCity();
    const n = neighbor(s.map, city.pos, 0);
    s.map.tiles[n].hills = true; // 2 comida 1 produção
    const m = neighbor(s.map, city.pos, 3);
    s.map.tiles[m].resource = 'cotton'; // 2 comida + 3 ouro
    assignCitizens(s, city);
    expect(city.worked).toEqual([m]);
    city.focus = 'production';
    assignCitizens(s, city);
    expect(city.worked).toEqual([n]);
  });
});

describe('fronteiras', () => {
  it('cultura expande o território para um hexágono adjacente', () => {
    const { s, city } = withCity();
    const owned = () => s.map.tiles.filter((t) => t.cityId === city.id).length;
    const before = owned();
    city.cultureStored = 9; // palácio dá +1
    city.queue.push({ kind: 'building', id: 'monument' });
    const ev = processCity(s, city);
    expect(ev.some((e) => e.type === 'borderGrew')).toBe(true);
    expect(owned()).toBe(before + 1);
    expect(city.cultureTiles).toBe(1);
  });

  it('compra de hexágono custa ouro e só vale para vizinhos do território', () => {
    const { s, city } = withCity();
    const cand = expansionCandidates(s, city);
    expect(cand.length).toBe(12);
    expect(cand.every((i) => distance(s.map, city.pos, i) === 2)).toBe(true);
    const tile = cand[0];
    const cost = tilePurchaseCost(s, city, tile);
    s.players[0].gold = cost - 1;
    expect(applyAction(s, { type: 'purchaseTile', cityId: city.id, tile }).events[0].type).toBe('error');
    s.players[0].gold = cost + 5;
    const { state } = applyAction(s, { type: 'purchaseTile', cityId: city.id, tile });
    expect(state.map.tiles[tile].cityId).toBe(city.id);
    expect(state.players[0].gold).toBe(5);
    const far = 0;
    expect(applyAction(s, { type: 'purchaseTile', cityId: city.id, tile: far }).events[0].type).toBe('error');
  });

  it('compra de unidade com ouro', () => {
    const { s, city } = withCity();
    const item = { kind: 'unit' as const, id: 'warrior' };
    s.players[0].gold = purchaseCost(city, item);
    const { state, events } = applyAction(s, { type: 'purchaseItem', cityId: city.id, item });
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(state.players[0].gold).toBe(0);
    expect(state.units.some((u) => u.type === 'warrior' && u.pos === city.pos)).toBe(true);
  });
});

describe('migração v1 → atual', () => {
  it('converte save da etapa 1 com cidade e normaliza cidadãos', () => {
    const { s } = withCity();
    // simula o formato v1
    const v1: any = structuredClone(s);
    v1.schemaVersion = 1;
    for (const p of v1.players) for (const k of ['gold', 'science', 'culture', 'faith']) delete p[k];
    for (const c of v1.cities)
      for (const k of ['foodStored', 'queue', 'progress', 'worked', 'locked', 'focus', 'buildings', 'cultureStored', 'cultureTiles'])
        delete c[k];
    const env = { format: 'rep6civ-save', version: 1, savedAt: '', meta: {}, state: v1 };
    const loaded: GameState = normalizeState(deserialize(JSON.stringify(env)));
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded.players[0].techs).toEqual([]);
    expect(loaded.players[0].government).toBeNull();
    expect(loaded.players[0].gold).toBe(10);
    expect(loaded.cities[0].buildings).toEqual(['palace']);
    expect(loaded.cities[0].worked).toHaveLength(1);
    expect(loaded.cities[0].queue).toEqual([]);
  });
});
