import { describe, expect, it } from 'vitest';
import { applyAction, endTurn } from '../src/rules/actions';
import { availableImprovements } from '../src/rules/builders';
import { cityTileYields, cityYields, cannotProduce, processCity, tilePurchaseCost, expansionCandidates } from '../src/rules/cities';
import { foundCity } from '../src/rules/city';
import { governmentSlots } from '../src/rules/effects';
import { neighbor } from '../src/rules/hex';
import { maxMoves } from '../src/rules/movement';
import { availableItems, checkBoosts, processResearch, treeCost } from '../src/rules/research';
import { tileYields } from '../src/rules/tiles';
import { flatGame } from './helpers';

function setup() {
  const s = flatGame(16, 12);
  s.units.push({ id: 500, type: 'settler', owner: 0, pos: 5 * 16 + 6, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
  const city = foundCity(s, s.units[0]);
  return { s, city, p: s.players[0] };
}

describe('pesquisa', () => {
  it('começa só com tecnologias sem pré-requisitos disponíveis', () => {
    const { p } = setup();
    expect(availableItems(p, 'tech')).toEqual(['pottery', 'animal-husbandry', 'mining', 'sailing', 'astrology']);
    expect(availableItems(p, 'civic')).toEqual(['code-of-laws']);
  });

  it('ciência flui para a pesquisa e o excedente vai para o estoque', () => {
    const { s, p } = setup();
    const r = applyAction(s, { type: 'setResearch', kind: 'tech', id: 'pottery' });
    const q = r.state.players[0];
    q.science = 30;
    const ev = processResearch(r.state, 0);
    expect(ev).toContainEqual({ type: 'techDone', playerId: 0, id: 'pottery' });
    expect(q.techs).toEqual(['pottery']);
    expect(q.researching).toBeNull();
    expect(q.science).toBe(10);
    expect(availableItems(q, 'tech')).toContain('writing');
    void p;
  });

  it('sem pré-requisitos, a escolha vira destino e começa pelo caminho', () => {
    const { s } = setup();
    const r = applyAction(s, { type: 'setResearch', kind: 'tech', id: 'writing' });
    expect(r.events.some((e) => e.type === 'error')).toBe(false);
    const p = r.state.players[0];
    expect(p.researchTarget).toBe('writing');
    expect(p.researching).not.toBe('writing');
    // tecnologia já conhecida continua recusada
    p.techs.push('pottery');
    expect(applyAction(r.state, { type: 'setResearch', kind: 'tech', id: 'pottery' }).events[0].type).toBe('error');
  });

  it('fim de turno acumula ciência do palácio na pesquisa', () => {
    const { s, city } = setup();
    city.queue.push({ kind: 'building', id: 'monument' });
    s.players[0].researching = 'mining';
    endTurn(s);
    expect(s.players[0].techProgress.mining).toBe(cityYields(s, city).science);
  });
});

describe('eurecas e inspirações', () => {
  it('cidade costeira dá eureca de Navegação à Vela (−40%)', () => {
    const { s, city, p } = setup();
    expect(treeCost(p, 'tech', 'sailing')).toBe(50);
    s.map.tiles[neighbor(s.map, city.pos, 0)].terrain = 'coast';
    const ev = checkBoosts(s, 0);
    expect(ev).toContainEqual({ type: 'boost', playerId: 0, kind: 'tech', id: 'sailing' });
    expect(treeCost(p, 'tech', 'sailing')).toBe(30);
  });

  it('construir fazendas via ação dispara eureca de Irrigação', () => {
    const { s, city } = setup();
    const a = neighbor(s.map, city.pos, 0);
    const b = neighbor(s.map, city.pos, 3);
    s.map.tiles[a].improvement = 'farm';
    s.units.push({ id: 600, type: 'builder', owner: 0, pos: b, movesLeft: 2, charges: 3, hp: 100, xp: 0, promotions: [] });
    const { events, state } = applyAction(s, { type: 'buildImprovement', unitId: 600, improvement: 'farm' });
    expect(events).toContainEqual({ type: 'boost', playerId: 0, kind: 'tech', id: 'irrigation' });
    expect(state.players[0].boosts).toContain('irrigation');
  });
});

describe('desbloqueios por tecnologia', () => {
  it('edifícios exigem tecnologia', () => {
    const { s, city, p } = setup();
    expect(cannotProduce(s, city, { kind: 'building', id: 'granary' })).toMatch(/Cerâmica/);
    expect(cannotProduce(s, city, { kind: 'building', id: 'monument' })).toBeNull();
    p.techs.push('pottery');
    expect(cannotProduce(s, city, { kind: 'building', id: 'granary' })).toBeNull();
  });

  it('melhorias exigem tecnologia (mina com Mineração)', () => {
    const { s, city, p } = setup();
    const t = neighbor(s.map, city.pos, 0);
    s.map.tiles[t].hills = true;
    s.units.push({ id: 600, type: 'builder', owner: 0, pos: t, movesLeft: 2, charges: 3, hp: 100, xp: 0, promotions: [] });
    const b = s.units.find((u) => u.id === 600)!;
    expect(availableImprovements(s, b)).toEqual(['farm']);
    p.techs.push('mining');
    expect(availableImprovements(s, b)).toEqual(['farm', 'mine']);
  });

  it('recursos estratégicos ficam ocultos até a tecnologia', () => {
    const { s, city, p } = setup();
    const t = neighbor(s.map, city.pos, 0);
    s.map.tiles[t].resource = 'horses';
    const tile = s.map.tiles[t];
    expect(tileYields(tile).production).toBe(1); // sem filtro: visível
    expect(cityTileYields(s, city, tile).production).toBe(0);
    p.techs.push('animal-husbandry');
    expect(cityTileYields(s, city, tile).production).toBe(1);
  });
});

describe('cívicas, governo e políticas', () => {
  function withChiefdom() {
    const ctx = setup();
    ctx.p.researchingCivic = 'code-of-laws';
    ctx.p.culture = 20;
    const ev = processResearch(ctx.s, 0);
    return { ...ctx, ev };
  }

  it('Código de Leis adota Chefia com 1 espaço militar e 1 econômico', () => {
    const { p, ev } = withChiefdom();
    expect(ev).toContainEqual({ type: 'governmentUnlocked', playerId: 0, id: 'chiefdom' });
    expect(p.government).toBe('chiefdom');
    expect(governmentSlots('chiefdom')).toEqual(['military', 'economic']);
    expect(p.policies).toEqual([null, null]);
    expect(p.policyChangeAvailable).toBe(true);
  });

  it('política econômica aumenta produção; não cabe em espaço militar', () => {
    const { s, city } = withChiefdom();
    const before = cityYields(s, city).production;
    const bad = applyAction(s, { type: 'setPolicy', slot: 0, policy: 'urban-planning' });
    expect(bad.events[0].type).toBe('error');
    const { state } = applyAction(s, { type: 'setPolicy', slot: 1, policy: 'urban-planning' });
    expect(cityYields(state, state.cities[0]).production).toBe(before + 1);
  });

  it('Recrutamento acelera unidades militares', () => {
    const { s, city } = withChiefdom();
    const { state } = applyAction(s, { type: 'setPolicy', slot: 0, policy: 'recruitment' });
    const c = state.cities[0];
    c.queue.push({ kind: 'unit', id: 'warrior' });
    const prod = cityYields(state, c).production;
    processCity(state, c);
    expect(c.progress['unit:warrior']).toBe(prod * 1.5);
    void city;
  });

  it('mudanças só no turno de conclusão de uma cívica', () => {
    const { s } = withChiefdom();
    endTurn(s);
    const r = applyAction(s, { type: 'setPolicy', slot: 1, policy: 'god-king' });
    expect(r.events[0].type).toBe('error');
  });

  it('Agrimensores reduzem custo de hexágonos e Desbravadores dão +1 movimento', () => {
    const { s, city, p } = withChiefdom();
    const tile = expansionCandidates(s, city)[0];
    const full = tilePurchaseCost(s, city, tile);
    p.civics.push('early-empire', 'military-tradition');
    p.policies = ['pathfinders', 'land-surveyors'];
    expect(tilePurchaseCost(s, city, tile)).toBe(Math.round(full / 2));
    s.units.push({ id: 700, type: 'scout', owner: 0, pos: 0, movesLeft: 0, hp: 100, xp: 0, promotions: [] });
    expect(maxMoves(s, s.units.find((u) => u.id === 700)!)).toBe(4);
  });

  it('Filosofia Política libera governos com mais espaços', () => {
    const { s, p } = withChiefdom();
    p.civics.push('political-philosophy');
    p.policies = ['recruitment', 'urban-planning'];
    const { state } = applyAction(s, { type: 'setGovernment', id: 'classical-republic' });
    const q = state.players[0];
    expect(q.government).toBe('classical-republic');
    // república não tem espaço militar: Recrutamento vai para o coringa
    expect(q.policies).toEqual(['urban-planning', null, 'recruitment', null]);
  });
});
