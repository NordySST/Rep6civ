import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/rules/actions';
import { runBarbarianTurn } from '../src/rules/barbarians';
import { availableImprovements, canPillage, waterTargets } from '../src/rules/builders';
import { cityYields, itemCost, productionOptions } from '../src/rules/cities';
import { foundCity } from '../src/rules/city';
import { relation } from '../src/rules/diplomacy';
import { policyUnlockCost } from '../src/rules/effects';
import { makePlayer } from '../src/rules/game';
import { neighbor } from '../src/rules/hex';
import { processResearch } from '../src/rules/research';
import { tileYields } from '../src/rules/tiles';
import type { Unit } from '../src/state/types';
import { flatGame } from './helpers';

const W = 16;
const at = (c: number, r: number) => r * W + c;

function setup() {
  const s = flatGame(W, 12);
  const mk = (id: number, type: string, owner: number, pos: number, extra: Partial<Unit> = {}): Unit => {
    const u: Unit = { id, type, owner, pos, movesLeft: 2, hp: 100, xp: 0, promotions: [], ...extra };
    s.units.push(u);
    return u;
  };
  const city = foundCity(s, mk(100, 'settler', 0, at(5, 5)));
  return { s, city, mk };
}

describe('barcos de pesca', () => {
  it('construtor em terra melhora o recurso marinho vizinho (exige Navegação à Vela)', () => {
    const { s, city, mk } = setup();
    const sea = neighbor(s.map, city.pos, 0);
    s.map.tiles[sea].terrain = 'coast';
    s.map.tiles[sea].resource = 'fish';
    const land = neighbor(s.map, city.pos, 5);
    const b = mk(1, 'builder', 0, land, { charges: 3 });
    expect(waterTargets(s, b, 'fishing-boats')).toEqual([sea]);
    expect(availableImprovements(s, b)).not.toContain('fishing-boats');
    s.players[0].techs.push('sailing');
    expect(availableImprovements(s, b)).toContain('fishing-boats');
    const before = tileYields(s.map.tiles[sea]).food;
    const { state } = applyAction(s, { type: 'buildImprovement', unitId: 1, improvement: 'fishing-boats', tile: sea });
    expect(state.map.tiles[sea].improvement).toBe('fishing-boats');
    expect(tileYields(state.map.tiles[sea]).food).toBe(before + 1);
  });
});

describe('saque e reparo', () => {
  function war() {
    const ctx = setup();
    ctx.s.players.push(makePlayer(2, 'norvhal', ctx.s.map.tiles.length));
    const r = relation(ctx.s, 0, 2);
    r.met = true;
    r.war = true;
    const farm = neighbor(ctx.s.map, ctx.city.pos, 0);
    ctx.s.map.tiles[farm].improvement = 'farm';
    return { ...ctx, farm };
  }

  it('inimigo em guerra saqueia: melhoria para de render e ele ganha ouro', () => {
    const { s, city, mk, farm } = war();
    mk(2, 'warrior', 2, farm);
    expect(canPillage(s, s.units.find((u) => u.id === 2)!).ok).toBe(true);
    const food = tileYields(s.map.tiles[farm]).food;
    s.currentPlayer = 2;
    const { state } = applyAction(s, { type: 'pillage', unitId: 2 });
    expect(state.map.tiles[farm].pillaged).toBe(true);
    expect(tileYields(state.map.tiles[farm]).food).toBe(food - 1);
    expect(state.players[2].gold).toBe(s.players[2].gold + 15);
    void city;
  });

  it('não saqueia em paz nem o próprio território; construtor repara sem gastar carga', () => {
    const { s, mk, farm } = war();
    const own = mk(3, 'warrior', 0, farm);
    expect(canPillage(s, own).ok).toBe(false);
    s.map.tiles[farm].pillaged = true;
    mk(4, 'builder', 0, farm, { charges: 2 });
    const { state } = applyAction(s, { type: 'repair', unitId: 4 });
    expect(state.map.tiles[farm].pillaged).toBeUndefined();
    expect(state.units.find((u) => u.id === 4)!.charges).toBe(2);
  });

  it('bárbaros saqueiam melhorias por onde passam', () => {
    const { s } = war();
    const far = at(12, 9);
    s.map.tiles[far].owner = 0;
    s.map.tiles[far].improvement = 'farm';
    s.units.push({ id: 9, type: 'barbarian-raider', owner: 1, pos: far, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    runBarbarianTurn(s);
    expect(s.map.tiles[far].pillaged).toBe(true);
  });
});

describe('custo de distrito', () => {
  it('encarece com as tecnologias e o custo fica fixado na fila', () => {
    const { s, city } = setup();
    s.players[0].techs.push('writing');
    const opt = productionOptions(s, city).find((o) => o.kind === 'district' && o.id === 'campus')!;
    expect(itemCost(opt)).toBe(64);
    s.players[0].techs.push('pottery', 'mining', 'astrology');
    const { state } = applyAction(s, { type: 'setProduction', cityId: city.id, item: { kind: 'district', id: 'campus', tile: neighbor(s.map, city.pos, 0) } });
    expect(itemCost(state.cities[0].queue[0])).toBe(76);
    state.players[0].techs.push('currency');
    expect(itemCost(state.cities[0].queue[0])).toBe(76);
  });
});

describe('troca de políticas com ouro', () => {
  it('paga para liberar trocas fora do turno de cívica', () => {
    const { s } = setup();
    const p = s.players[0];
    p.researchingCivic = 'code-of-laws';
    p.culture = 20;
    processResearch(s, 0);
    p.policyChangeAvailable = false;
    expect(applyAction(s, { type: 'setPolicy', slot: 1, policy: 'urban-planning' }).events[0].type).toBe('error');
    const cost = policyUnlockCost(p);
    p.gold = cost;
    const r = applyAction(s, { type: 'unlockPolicies' });
    expect(r.state.players[0].gold).toBe(0);
    const r2 = applyAction(r.state, { type: 'setPolicy', slot: 1, policy: 'urban-planning' });
    expect(r2.events.filter((e) => e.type === 'error')).toEqual([]);
    expect(cityYields(r2.state, r2.state.cities[0]).production).toBeGreaterThan(cityYields(s, s.cities[0]).production);
  });
});
