import { describe, expect, it } from 'vitest';
import { applyAction, endTurn, unitsNeedingOrders } from '../src/rules/actions';
import { canFoundCity, MIN_CITY_DISTANCE } from '../src/rules/city';
import { newGame, turnYear } from '../src/rules/game';
import { distance, neighbor } from '../src/rules/hex';
import { canOccupy, findPath, stepCost } from '../src/rules/movement';
import { isPassableLand } from '../src/rules/tiles';
import { computeVisibility, revealForPlayer, visibleFrom } from '../src/rules/visibility';
import { flatGame } from './helpers';

function game(seed = 'teste') {
  return newGame({ seed, mapSize: 'small', civId: 'tamaru' });
}


describe('novo jogo', () => {
  it('começa com colono e guerreiro do jogador em terra', () => {
    const s = game();
    expect(s.turn).toBe(1);
    const types = s.units.map((u) => u.type).sort();
    expect(types).toEqual(['settler', 'warrior']);
    for (const u of s.units) expect(isPassableLand(s.map.tiles[u.pos])).toBe(true);
    expect(s.players[0].civId).toBe('tamaru');
  });

  it('revela os arredores iniciais e mantém o resto inexplorado', () => {
    const s = game();
    const explored = s.players[0].explored.filter((x) => x === 1).length;
    expect(explored).toBeGreaterThan(5);
    expect(explored).toBeLessThan(s.map.tiles.length / 4);
  });

  it('o ano avança com os turnos', () => {
    expect(turnYear(1)).toBe('4000 a.C.');
    expect(turnYear(2)).toBe('3960 a.C.');
  });
});

describe('fundar cidade', () => {
  it('colono funda cidade, é consumido e cria território', () => {
    const s = game();
    const settler = s.units.find((u) => u.type === 'settler')!;
    const { state, events } = applyAction(s, { type: 'foundCity', unitId: settler.id });
    expect(events[0].type).toBe('cityFounded');
    expect(state.cities).toHaveLength(1);
    expect(state.cities[0].isCapital).toBe(true);
    expect(state.cities[0].name).toBe('Tamaru');
    expect(state.units.find((u) => u.id === settler.id)).toBeUndefined();
    expect(state.map.tiles.filter((t) => t.owner === 0).length).toBeGreaterThanOrEqual(4);
    // não muta o estado anterior
    expect(s.cities).toHaveLength(0);
  });

  it('guerreiro não funda cidades', () => {
    const s = game();
    const w = s.units.find((u) => u.type === 'warrior')!;
    const { state, events } = applyAction(s, { type: 'foundCity', unitId: w.id });
    expect(events[0].type).toBe('error');
    expect(state).toBe(s);
  });

  it('respeita distância mínima entre cidades', () => {
    const s = flatGame();
    s.units.push({ id: 900, type: 'settler', owner: 0, pos: 5 * 12 + 5, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    s.units.push({ id: 901, type: 'settler', owner: 0, pos: 5 * 12 + 7, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    const r1 = applyAction(s, { type: 'foundCity', unitId: 900 });
    expect(r1.state.cities).toHaveLength(1);
    const u2 = r1.state.units.find((u) => u.id === 901)!;
    expect(distance(r1.state.map, u2.pos, r1.state.cities[0].pos)).toBeLessThan(MIN_CITY_DISTANCE);
    expect(canFoundCity(r1.state, u2).ok).toBe(false);
  });

  it('não funda na água nem em montanha', () => {
    const s = flatGame();
    s.map.tiles[30].terrain = 'mountain';
    s.units.push({ id: 900, type: 'settler', owner: 0, pos: 30, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    expect(canFoundCity(s, s.units[0]).ok).toBe(false);
  });
});

describe('movimento', () => {
  it('custos: colinas e floresta +1, rio consome tudo, montanha intransitável', () => {
    const s = flatGame();
    const a = 3 * 12 + 3;
    const e = neighbor(s.map, a, 0);
    expect(stepCost(s, a, e)).toBe(1);
    s.map.tiles[e].hills = true;
    expect(stepCost(s, a, e)).toBe(2);
    s.map.tiles[e].feature = 'forest';
    expect(stepCost(s, a, e)).toBe(3);
    s.map.tiles[e].terrain = 'mountain';
    expect(stepCost(s, a, e)).toBe(Infinity);
    const se = neighbor(s.map, a, 1);
    s.map.tiles[a].rivers |= 1 << 1;
    expect(stepCost(s, a, se)).toBeGreaterThanOrEqual(99);
  });

  it('move ao longo do caminho e guarda o restante para o próximo turno', () => {
    const s = flatGame();
    s.units.push({ id: 900, type: 'warrior', owner: 0, pos: 2 * 12 + 1, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    const target = 2 * 12 + 7; // 6 hexágonos a leste
    const { state } = applyAction(s, { type: 'move', unitId: 900, target });
    const u = state.units[0];
    expect(u.pos).toBe(2 * 12 + 3);
    expect(u.movesLeft).toBe(0);
    expect(u.path?.length).toBe(4);
    endTurn(state);
    expect(state.units[0].pos).toBe(2 * 12 + 5);
    endTurn(state);
    expect(state.units[0].pos).toBe(target);
    expect(state.units[0].path).toBeUndefined();
  });

  it('desvia de montanhas e não entra em água', () => {
    const s = flatGame();
    for (let r = 0; r < 9; r++) s.map.tiles[r * 12 + 5].terrain = 'mountain';
    s.map.tiles[0 * 12 + 5].terrain = 'mountain';
    s.units.push({ id: 900, type: 'warrior', owner: 0, pos: 4 * 12 + 2, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    const res = findPath(s, s.units[0], 4 * 12 + 8)!;
    expect(res).not.toBeNull();
    for (const p of res.path) expect(isPassableLand(s.map.tiles[p])).toBe(true);
    s.map.tiles[9 * 12 + 5].terrain = 'ocean';
    expect(findPath(s, s.units[0], 4 * 12 + 8)).toBeNull();
  });

  it('empilhamento: 1 militar + 1 civil por hexágono', () => {
    const s = flatGame();
    s.units.push({ id: 1, type: 'warrior', owner: 0, pos: 20, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    s.units.push({ id: 2, type: 'warrior', owner: 0, pos: 21, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    s.units.push({ id: 3, type: 'settler', owner: 0, pos: 22, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    expect(canOccupy(s, s.units[1], 20)).toBe(false);
    expect(canOccupy(s, s.units[2], 20)).toBe(true);
  });

  it('fim de turno restaura movimentos e incrementa o turno', () => {
    const s = flatGame();
    s.units.push({ id: 1, type: 'warrior', owner: 0, pos: 20, movesLeft: 0, skipped: true, hp: 100, xp: 0, promotions: [] });
    const { state } = applyAction(s, { type: 'endTurn' });
    expect(state.turn).toBe(s.turn + 1);
    expect(state.units[0].movesLeft).toBe(2);
    expect(unitsNeedingOrders(state, 0)).toHaveLength(1);
  });
});

describe('névoa de guerra', () => {
  it('visibilidade cobre o raio de visão e explora ao mover', () => {
    const s = flatGame(20, 14);
    s.players[0].explored = new Array(s.map.tiles.length).fill(0);
    s.units.push({ id: 1, type: 'warrior', owner: 0, pos: 7 * 20 + 3, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    const vis = computeVisibility(s, 0);
    expect(vis.reduce((a, b) => a + b, 0)).toBe(19);
    revealForPlayer(s, 0);
    const { state } = applyAction(s, { type: 'move', unitId: 1, target: 7 * 20 + 5 });
    const explored = state.players[0].explored.reduce((a, b) => a + b, 0);
    expect(explored).toBeGreaterThan(19);
    // o que ficou para trás continua explorado mas pode não estar visível
    const vis2 = computeVisibility(state, 0);
    expect(state.players[0].explored[7 * 20 + 1]).toBe(1);
    expect(vis2[7 * 20 + 1]).toBe(0);
  });

  it('montanhas bloqueiam a linha de visão; colinas ampliam a visão', () => {
    const s = flatGame(20, 14);
    const from = 7 * 20 + 5;
    const block = 7 * 20 + 6;
    const behind = 7 * 20 + 7;
    expect(visibleFrom(s.map, from, 2)).toContain(behind);
    s.map.tiles[block].terrain = 'mountain';
    expect(visibleFrom(s.map, from, 2)).not.toContain(behind);
    expect(visibleFrom(s.map, from, 2)).toContain(block);
    s.map.tiles[block].terrain = 'grassland';
    s.map.tiles[block].feature = 'forest';
    s.map.tiles[from].hills = true;
    expect(visibleFrom(s.map, from, 2)).toContain(behind);
    s.units.push({ id: 1, type: 'warrior', owner: 0, pos: from, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    expect(computeVisibility(s, 0).reduce((a, b) => a + b, 0)).toBe(37);
  });
});
