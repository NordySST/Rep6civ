import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/rules/actions';
import { distance, hexLine, idxOf, neighbor, neighbors, tilesInRadius } from '../src/rules/hex';
import { generateMap } from '../src/rules/mapgen';
import { findPath } from '../src/rules/movement';
import { isLand, isWater } from '../src/rules/tiles';
import { flatGame } from './helpers';

const dims = { width: 12, height: 8, wrap: true };

describe('geometria com volta leste-oeste', () => {
  it('vizinhos atravessam a emenda', () => {
    expect(neighbor(dims, idxOf(dims, 11, 2), 0)).toBe(idxOf(dims, 0, 2));
    expect(neighbor(dims, idxOf(dims, 0, 2), 3)).toBe(idxOf(dims, 11, 2));
    expect(neighbors(dims, idxOf(dims, 0, 3)).every((n) => n >= 0)).toBe(true);
    // polos continuam sendo borda
    expect(neighbor(dims, idxOf(dims, 5, 0), 4)).toBe(-1);
  });

  it('distância usa o caminho mais curto pela emenda', () => {
    expect(distance(dims, idxOf(dims, 0, 4), idxOf(dims, 11, 4))).toBe(1);
    expect(distance(dims, idxOf(dims, 1, 4), idxOf(dims, 10, 4))).toBe(3);
    expect(distance({ ...dims, wrap: false }, idxOf(dims, 1, 4), idxOf(dims, 10, 4))).toBe(9);
  });

  it('raio e linha de visão atravessam a emenda', () => {
    const r = tilesInRadius(dims, idxOf(dims, 0, 4), 2);
    expect(r).toHaveLength(19);
    expect(r).toContain(idxOf(dims, 10, 4));
    const line = hexLine(dims, idxOf(dims, 10, 4), idxOf(dims, 1, 4));
    expect(line).toHaveLength(4);
    for (let k = 1; k < line.length; k++) expect(distance(dims, line[k - 1], line[k])).toBe(1);
  });
});

describe('gerador com volta', () => {
  it('novos mapas dão a volta; só os polos são oceano forçado', () => {
    let landOnSeam = 0;
    for (const seed of ['w1', 'w2', 'w3', 'w4', 'w5']) {
      const { map } = generateMap({ seed, size: 'small' });
      expect(map.wrap).toBe(true);
      for (let c = 0; c < map.width; c++) {
        expect(isWater(map.tiles[c])).toBe(true);
        expect(isWater(map.tiles[(map.height - 1) * map.width + c])).toBe(true);
      }
      for (let r = 0; r < map.height; r++) {
        if (isLand(map.tiles[r * map.width]) || isLand(map.tiles[r * map.width + map.width - 1])) landOnSeam++;
      }
    }
    expect(landOnSeam).toBeGreaterThan(0);
  });

  it('mapa sem volta continua disponível (saves antigos)', () => {
    const { map } = generateMap({ seed: 'nw', size: 'small', wrap: false });
    expect(map.wrap).toBe(false);
    for (let r = 0; r < map.height; r++) expect(isWater(map.tiles[r * map.width])).toBe(true);
  });
});

describe('movimento pela emenda', () => {
  it('unidade cruza da última coluna para a primeira', () => {
    const s = flatGame(12, 8);
    s.map.wrap = true;
    s.units.push({ id: 1, type: 'warrior', owner: 0, pos: idxOf(s.map, 11, 4), movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    const res = findPath(s, s.units[0], idxOf(s.map, 1, 4))!;
    expect(res.path).toEqual([idxOf(s.map, 0, 4), idxOf(s.map, 1, 4)]);
    const { state } = applyAction(s, { type: 'move', unitId: 1, target: idxOf(s.map, 1, 4) });
    expect(state.units[0].pos).toBe(idxOf(s.map, 1, 4));
  });
});
