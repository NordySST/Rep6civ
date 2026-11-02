import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/rules/actions';
import { availableImprovements, improvementFits } from '../src/rules/builders';
import { cityYields } from '../src/rules/cities';
import { foundCity } from '../src/rules/city';
import { neighbor } from '../src/rules/hex';
import { stepCost } from '../src/rules/movement';
import { tileYields } from '../src/rules/tiles';
import type { Tile } from '../src/state/types';
import { flatGame } from './helpers';

function setup() {
  const s = flatGame(16, 12);
  s.units.push({ id: 500, type: 'settler', owner: 0, pos: 5 * 16 + 6, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
  const city = foundCity(s, s.units[0]);
  const tile = neighbor(s.map, city.pos, 0);
  s.units.push({ id: 600, type: 'builder', owner: 0, pos: tile, movesLeft: 2, charges: 3, hp: 100, xp: 0, promotions: [] });
  return { s, city, tile };
}

const t = (p: Partial<Tile>): Tile => ({ terrain: 'grassland', hills: false, rivers: 0, ...p });

describe('melhorias', () => {
  it('regras de posicionamento', () => {
    expect(improvementFits(t({}), 'farm')).toBe(true);
    expect(improvementFits(t({ feature: 'forest' }), 'farm')).toBe(false);
    expect(improvementFits(t({ hills: true }), 'mine')).toBe(true);
    expect(improvementFits(t({}), 'mine')).toBe(false);
    expect(improvementFits(t({ resource: 'cattle' }), 'pasture')).toBe(true);
    expect(improvementFits(t({ resource: 'cattle' }), 'farm')).toBe(false);
    expect(improvementFits(t({ resource: 'spices', feature: 'jungle' }), 'plantation')).toBe(true);
    expect(improvementFits(t({ terrain: 'mountain' }), 'mine')).toBe(false);
    expect(improvementFits(t({ terrain: 'coast' }), 'farm')).toBe(false);
  });

  it('construtor faz fazenda, gasta carga e movimento; rendimento aumenta', () => {
    const { s, tile } = setup();
    expect(availableImprovements(s, s.units[0])).toEqual(['farm']);
    const before = tileYields(s.map.tiles[tile]).food;
    const { state } = applyAction(s, { type: 'buildImprovement', unitId: 600, improvement: 'farm' });
    expect(state.map.tiles[tile].improvement).toBe('farm');
    expect(tileYields(state.map.tiles[tile]).food).toBe(before + 1);
    const b = state.units.find((u) => u.id === 600)!;
    expect(b.charges).toBe(2);
    expect(b.movesLeft).toBe(0);
  });

  it('construtor some ao gastar a última carga', () => {
    const { s } = setup();
    s.units[0].charges = 1;
    const { state } = applyAction(s, { type: 'buildImprovement', unitId: 600, improvement: 'farm' });
    expect(state.units.find((u) => u.id === 600)).toBeUndefined();
  });

  it('não constrói fora do território', () => {
    const { s } = setup();
    s.units[0].pos = 0;
    const r = applyAction(s, { type: 'buildImprovement', unitId: 600, improvement: 'farm' });
    expect(r.events[0].type).toBe('error');
  });

  it('derrubar floresta dá produção à cidade', () => {
    const { s, city, tile } = setup();
    s.map.tiles[tile].feature = 'forest';
    city.queue.push({ kind: 'building', id: 'monument' });
    const { state } = applyAction(s, { type: 'removeFeature', unitId: 600 });
    expect(state.map.tiles[tile].feature).toBeUndefined();
    expect(state.cities[0].progress['building:monument']).toBe(20);
  });

  it('cidade usa o hexágono melhorado', () => {
    const { s, city, tile } = setup();
    const { state } = applyAction(s, { type: 'buildImprovement', unitId: 600, improvement: 'farm' });
    expect(state.cities[0].worked).toContain(tile);
    expect(cityYields(state, state.cities[0]).food).toBe(cityYields(s, city).food + 1);
  });
});

describe('estradas', () => {
  it('estrada não gasta carga e reduz o custo entre hexágonos com estrada', () => {
    const { s, city, tile } = setup();
    s.map.tiles[tile].hills = true;
    s.map.tiles[tile].feature = 'forest';
    expect(stepCost(s, city.pos, tile)).toBe(3);
    const { state } = applyAction(s, { type: 'buildRoad', unitId: 600 });
    expect(state.map.tiles[tile].road).toBe(true);
    expect(state.units[0].charges).toBe(3);
    expect(stepCost(state, city.pos, tile)).toBe(0.5);
  });
});
