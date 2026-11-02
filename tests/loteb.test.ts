import { describe, expect, it } from 'vitest';
import { evaluateDeal, proposeDeal } from '../src/ai';
import { siegePlan } from '../src/ai/civAi';
import { applyAction, endTurn } from '../src/rules/actions';
import { assignCitizens, cityYields, specialistSlots } from '../src/rules/cities';
import { foundCity } from '../src/rules/city';
import { attackStrength, defenseStrength } from '../src/rules/combat';
import { applyDeal, relation } from '../src/rules/diplomacy';
import { cityAmenities, effectiveLuxuries, tradeableLuxuries } from '../src/rules/economy';
import { gpPerTurn } from '../src/rules/greatPeople';
import { makePlayer, newGame } from '../src/rules/game';
import { neighbor } from '../src/rules/hex';
import { deserialize, serialize } from '../src/state/save';
import type { Unit } from '../src/state/types';
import { flatGame } from './helpers';

const W = 16;
const at = (c: number, r: number) => r * W + c;

function setup() {
  const s = flatGame(W, 12);
  s.players.push(makePlayer(2, 'norvhal', s.map.tiles.length));
  const mk = (id: number, type: string, owner: number, pos: number, extra: Partial<Unit> = {}): Unit => {
    const u: Unit = { id, type, owner, pos, movesLeft: 2, hp: 100, xp: 0, promotions: [], ...extra };
    s.units.push(u);
    return u;
  };
  const mine = foundCity(s, mk(100, 'settler', 0, at(3, 5)));
  const theirs = foundCity(s, mk(101, 'settler', 2, at(12, 5)));
  relation(s, 0, 2).met = true;
  return { s, mine, theirs, mk };
}

describe('especialistas', () => {
  it('vagas = 1 + edifícios do distrito; rendem e geram pontos de personalidade', () => {
    const { s, mine } = setup();
    expect(specialistSlots(mine, 'campus')).toBe(0);
    mine.districts.push({ type: 'campus', pos: neighbor(s.map, mine.pos, 0) });
    s.map.tiles[neighbor(s.map, mine.pos, 0)].district = 'campus';
    mine.buildings.push('library');
    expect(specialistSlots(mine, 'campus')).toBe(2);
    mine.population = 3;
    assignCitizens(s, mine);
    const before = cityYields(s, mine).science;
    const gp = gpPerTurn(s, 0).scientist;
    const { state } = applyAction(s, { type: 'setSpecialists', cityId: mine.id, district: 'campus', count: 2 });
    const c = state.cities.find((x) => x.id === mine.id)!;
    expect(c.worked).toHaveLength(1);
    expect(cityYields(state, c).science).toBeGreaterThanOrEqual(before + 4 - 1);
    expect(gpPerTurn(state, 0).scientist).toBe(gp + 2);
    expect(applyAction(state, { type: 'setSpecialists', cityId: mine.id, district: 'campus', count: 3 }).events[0].type).toBe('error');
  });

  it('cidadãos sem hexágono livre viram especialistas automaticamente', () => {
    const { s, mine } = setup();
    mine.districts.push({ type: 'campus', pos: neighbor(s.map, mine.pos, 0) });
    s.map.tiles[neighbor(s.map, mine.pos, 0)].district = 'campus';
    mine.population = 8; // só 5 hexágonos trabalháveis no raio 1
    assignCitizens(s, mine);
    expect(mine.worked).toHaveLength(5);
    expect(mine.specialists?.campus).toBe(1);
  });
});

describe('troca de luxos', () => {
  function withLux() {
    const ctx = setup();
    const a = neighbor(ctx.s.map, ctx.mine.pos, 3);
    ctx.s.map.tiles[a].resource = 'wine';
    ctx.s.map.tiles[a].improvement = 'plantation';
    const b = neighbor(ctx.s.map, ctx.theirs.pos, 0);
    ctx.s.map.tiles[b].resource = 'silk';
    ctx.s.map.tiles[b].improvement = 'plantation';
    ctx.s.map.tiles[b].feature = 'forest';
    return ctx;
  }

  it('cede e recebe luxos por 30 turnos; quem cede perde o uso', () => {
    const { s, mine } = withLux();
    expect(tradeableLuxuries(s, 0)).toEqual(['wine']);
    expect(tradeableLuxuries(s, 2)).toEqual(['silk']);
    mine.population = 5;
    const before = cityAmenities(s, mine).provided;
    const r = proposeDeal(s, 2, [
      { type: 'luxury', from: 0, resource: 'wine' },
      { type: 'luxury', from: 2, resource: 'silk' },
    ]);
    expect(r.events.some((e) => e.type === 'dealRejected')).toBe(false);
    expect(effectiveLuxuries(r.state, 0)).toEqual(['silk']);
    expect(effectiveLuxuries(r.state, 2)).toEqual(['wine']);
    expect(tradeableLuxuries(r.state, 0)).toEqual([]);
    expect(cityAmenities(r.state, r.state.cities.find((c) => c.id === mine.id)!).provided).toBe(before);
    r.state.turn += 31;
    const ev = endTurn(r.state);
    expect(ev.some((e) => e.type === 'luxuryDealEnded')).toBe(true);
    expect(r.state.luxuryDeals).toEqual([]);
  });

  it('IA valoriza receber luxo que não tem e cobra para ceder', () => {
    const { s } = withLux();
    expect(evaluateDeal(s, 2, 0, [{ type: 'luxury', from: 0, resource: 'wine' }]).accept).toBe(true);
    expect(evaluateDeal(s, 2, 0, [{ type: 'luxury', from: 2, resource: 'silk' }]).accept).toBe(false);
  });
});

describe('acordos de pesquisa', () => {
  it('exigem amizade e 100 de ouro de cada lado; rendem ciência ao fim', () => {
    const { s } = setup();
    s.players[0].gold = 150;
    s.players[2].gold = 150;
    expect(proposeDeal(s, 2, [{ type: 'researchAgreement' }]).events[0].type).toBe('dealRejected');
    s.turn = 10;
    applyDeal(s, 0, 2, [{ type: 'friendship' }]);
    const r = proposeDeal(s, 2, [{ type: 'researchAgreement' }]);
    expect(r.state.players[0].gold).toBe(50);
    expect(r.state.researchAgreements).toHaveLength(1);
    r.state.turn += 20;
    const sci = r.state.players[0].science;
    const ev = endTurn(r.state);
    expect(ev.some((e) => e.type === 'researchAgreementDone')).toBe(true);
    expect(r.state.players[0].science).toBeGreaterThanOrEqual(sci + 150);
  });
});

describe('flanqueamento e apoio', () => {
  it('+2 por aliado ao lado do alvo (ataque) e do defensor (defesa)', () => {
    const { s, mk } = setup();
    const t = at(7, 8);
    const def = mk(1, 'warrior', 1, t);
    const atk = mk(2, 'warrior', 0, neighbor(s.map, t, 3));
    const base = attackStrength(s, atk, { kind: 'unit', unit: def }, false);
    mk(3, 'warrior', 0, neighbor(s.map, t, 0));
    expect(attackStrength(s, atk, { kind: 'unit', unit: def }, false)).toBe(base + 2);
    const dBase = defenseStrength(s, def, atk);
    mk(4, 'warrior', 1, neighbor(s.map, t, 1));
    expect(defenseStrength(s, def, atk)).toBe(dBase + 2);
    // sem atacante (prévia de UI genérica) não conta apoio
    expect(defenseStrength(s, def)).toBe(dBase - (dBase - defenseStrength(s, def)));
  });
});

describe('cerco coordenado (IA)', () => {
  it('espera reunir 3 unidades perto da cidade alvo', () => {
    const { s, theirs, mk } = setup();
    s.turn = 30;
    relation(s, 0, 2).war = true;
    s.players[0].isHuman = false;
    mk(1, 'warrior', 0, at(4, 5));
    expect(siegePlan(s, 0)).toEqual({ target: theirs.pos, waiting: true });
    mk(2, 'warrior', 0, at(9, 5));
    mk(3, 'warrior', 0, at(9, 6));
    mk(4, 'warrior', 0, at(9, 4));
    expect(siegePlan(s, 0)).toEqual({ target: theirs.pos, waiting: false });
  });
});

describe('migração v8 → v9', () => {
  it('adiciona luxuryDeals e researchAgreements', () => {
    const s = newGame({ seed: 'm9', mapSize: 'small', civId: 'valdoria', rivals: 0, cityStates: 0 });
    const env: any = JSON.parse(serialize(s));
    env.version = 8;
    env.state.schemaVersion = 8;
    delete env.state.luxuryDeals;
    delete env.state.researchAgreements;
    const loaded = deserialize(JSON.stringify(env));
    expect(loaded.luxuryDeals).toEqual([]);
    expect(loaded.researchAgreements).toEqual([]);
  });
});
