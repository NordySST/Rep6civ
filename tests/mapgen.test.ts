import { describe, expect, it } from 'vitest';
import { MAP_SIZES, type MapSizeId } from '../src/data/mapSizes';
import { RESOURCE_BY_ID } from '../src/data/resources';
import { WONDER_BY_ID } from '../src/data/wonders';
import { neighbor } from '../src/rules/hex';
import { findStartPositions, generateMap, resourceFits } from '../src/rules/mapgen';
import { isLand, isPassableLand, isWater } from '../src/rules/tiles';

describe('gerador de mapas', () => {
  it('é determinístico pela semente', () => {
    const a = generateMap({ seed: 'semente-1', size: 'small' }).map;
    const b = generateMap({ seed: 'semente-1', size: 'small' }).map;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = generateMap({ seed: 'semente-2', size: 'small' }).map;
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  for (const size of Object.keys(MAP_SIZES) as MapSizeId[]) {
    it(`gera mapa ${size} com dimensões, terra e água`, () => {
      const { map } = generateMap({ seed: 'tamanhos', size });
      const def = MAP_SIZES[size];
      expect(map.width).toBe(def.width);
      expect(map.height).toBe(def.height);
      expect(map.tiles).toHaveLength(def.width * def.height);
      const land = map.tiles.filter(isLand).length / map.tiles.length;
      expect(land).toBeGreaterThan(0.25);
      expect(land).toBeLessThan(0.55);
    });
  }

  it('bordas do mapa são água', () => {
    const { map } = generateMap({ seed: 'bordas', size: 'medium' });
    for (let col = 0; col < map.width; col++) {
      expect(isWater(map.tiles[col])).toBe(true);
      expect(isWater(map.tiles[(map.height - 1) * map.width + col])).toBe(true);
    }
  });

  it('costa é sempre adjacente a terra e oceano nunca é', () => {
    const { map } = generateMap({ seed: 'costa', size: 'small' });
    map.tiles.forEach((t, i) => {
      if (!isWater(t)) return;
      const nearLand = [0, 1, 2, 3, 4, 5].some((d) => {
        const n = neighbor(map, i, d);
        return n >= 0 && isLand(map.tiles[n]);
      });
      if (t.terrain === 'ocean') expect(nearLand).toBe(false);
      if (t.terrain === 'coast' && !t.wonder) expect(nearLand).toBe(true);
    });
  });

  it('contém relevo, características, rios, recursos e maravilhas', () => {
    const { map } = generateMap({ seed: 'variedade', size: 'large' });
    const t = map.tiles;
    expect(t.some((x) => x.terrain === 'mountain')).toBe(true);
    expect(t.some((x) => x.hills)).toBe(true);
    expect(t.some((x) => x.feature === 'forest')).toBe(true);
    expect(t.some((x) => x.feature === 'jungle' || x.feature === 'marsh')).toBe(true);
    expect(t.some((x) => x.rivers !== 0)).toBe(true);
    const kinds = new Set(t.filter((x) => x.resource).map((x) => RESOURCE_BY_ID[x.resource!].kind));
    expect(kinds).toEqual(new Set(['bonus', 'luxury', 'strategic']));
    expect(t.filter((x) => x.wonder).length).toBeGreaterThanOrEqual(3);
  });

  it('rios são consistentes nos dois lados da aresta', () => {
    const { map } = generateMap({ seed: 'rios', size: 'medium' });
    map.tiles.forEach((t, i) => {
      for (let d = 0; d < 6; d++) {
        if (!(t.rivers & (1 << d))) continue;
        const n = neighbor(map, i, d);
        if (n >= 0) expect(map.tiles[n].rivers & (1 << ((d + 3) % 6))).not.toBe(0);
      }
    });
  });

  it('recursos e maravilhas respeitam as regras de posicionamento', () => {
    const { map } = generateMap({ seed: 'regras', size: 'large' });
    for (const t of map.tiles) {
      if (t.resource) expect(resourceFits(t, RESOURCE_BY_ID[t.resource])).toBe(true);
      if (t.wonder) {
        expect(WONDER_BY_ID[t.wonder].terrains).toContain(t.terrain);
        expect(t.resource).toBeUndefined();
      }
      if (t.feature === 'jungle' || t.feature === 'marsh' || t.feature === 'forest') expect(isLand(t)).toBe(true);
    }
  });

  it('posições iniciais são em terra transitável', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const { map } = generateMap({ seed, size: 'small' });
      const starts = findStartPositions(map, 1, seed);
      expect(starts).toHaveLength(1);
      expect(isPassableLand(map.tiles[starts[0]])).toBe(true);
    }
  });
});
