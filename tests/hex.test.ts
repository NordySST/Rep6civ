import { describe, expect, it } from 'vitest';
import {
  axialToOffset,
  directionTo,
  distance,
  hexLine,
  hexToPixel,
  idxOf,
  neighbor,
  neighbors,
  offsetToAxial,
  pixelToOffset,
  tilesInRadius,
} from '../src/rules/hex';

const dims = { width: 10, height: 8 };

describe('hex', () => {
  it('converte offset <-> axial ida e volta', () => {
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 10; col++) {
        const a = offsetToAxial(col, row);
        expect(axialToOffset(a.q, a.r)).toEqual({ col, row });
      }
  });

  it('vizinhos são mútuos e à distância 1', () => {
    const c = idxOf(dims, 4, 3);
    const ns = neighbors(dims, c);
    expect(ns.every((n) => n >= 0)).toBe(true);
    ns.forEach((n, d) => {
      expect(distance(dims, c, n)).toBe(1);
      expect(neighbor(dims, n, (d + 3) % 6)).toBe(c);
      expect(directionTo(dims, c, n)).toBe(d);
    });
  });

  it('vizinhos de linha par e ímpar seguem o odd-r', () => {
    // linha par: E=(+1,0), SE=(0,+1)
    expect(neighbor(dims, idxOf(dims, 4, 2), 1)).toBe(idxOf(dims, 4, 3));
    // linha ímpar: SE=(+1,+1)
    expect(neighbor(dims, idxOf(dims, 4, 3), 1)).toBe(idxOf(dims, 5, 4));
  });

  it('fora do mapa retorna -1', () => {
    expect(neighbor(dims, idxOf(dims, 0, 0), 3)).toBe(-1);
    expect(neighbor(dims, idxOf(dims, 0, 0), 4)).toBe(-1);
  });

  it('raio 1 tem 7 hexágonos e raio 2 tem 19 (longe das bordas)', () => {
    const c = idxOf(dims, 5, 4);
    expect(tilesInRadius(dims, c, 1)).toHaveLength(7);
    expect(tilesInRadius(dims, c, 2)).toHaveLength(19);
    expect(tilesInRadius(dims, c, 2).every((i) => distance(dims, c, i) <= 2)).toBe(true);
  });

  it('linha entre hexágonos é contínua', () => {
    const a = idxOf(dims, 1, 1);
    const b = idxOf(dims, 8, 6);
    const line = hexLine(dims, a, b);
    expect(line[0]).toBe(a);
    expect(line[line.length - 1]).toBe(b);
    for (let k = 1; k < line.length; k++) expect(distance(dims, line[k - 1], line[k])).toBe(1);
  });

  it('pixel -> hexágono é o inverso de hexágono -> pixel', () => {
    for (const [col, row] of [
      [0, 0],
      [3, 2],
      [7, 5],
      [2, 7],
    ]) {
      const p = hexToPixel(col, row, 30);
      expect(pixelToOffset(p.x + 3, p.y - 4, 30)).toEqual({ col, row });
    }
  });
});
