import { describe, expect, it } from 'vitest';
import { UNITS } from '../src/data/units';
import { tileCenter } from '../src/render/renderer';
import { unitModel } from '../src/render3d/models';
import { TerrainField, WATER_LEVEL } from '../src/render3d/terrain';
import { newGame } from '../src/rules/game';

describe('visão 3D (sem WebGL)', () => {
  const s = newGame({ seed: 'relevo', mapSize: 'small', civId: 'tamaru' });
  const field = new TerrainField(s);
  const out = new Float32Array(5);

  it('relevo: oceano abaixo da água, montanhas bem acima da planície', () => {
    const tiles = s.map.tiles;
    const h = (i: number) => {
      const c = tileCenter(s, i);
      return field.sample(c.x, c.y, out)[0];
    };
    const ocean = tiles.findIndex((t) => t.terrain === 'ocean');
    const mountain = tiles.findIndex((t) => t.terrain === 'mountain');
    const flat = tiles.findIndex((t) => t.terrain === 'grassland' && !t.hills && !t.rivers);
    expect(h(ocean)).toBeLessThan(WATER_LEVEL);
    expect(h(flat)).toBeGreaterThan(WATER_LEVEL);
    expect(h(mountain)).toBeGreaterThan(h(flat) + 15);
  });

  it('relevo é determinístico e sem costura na volta leste-oeste', () => {
    const again = new TerrainField(s);
    expect(again.height(300, 200)).toBe(field.height(300, 200));
    expect(s.map.wrap).toBe(true);
    for (const y of [100, 400, 700]) expect(field.height(0, y)).toBeCloseTo(field.height(field.P, y), 4);
  });

  it('assinatura muda quando uma característica é removida', () => {
    const before = TerrainField.signature(s);
    const i = s.map.tiles.findIndex((t) => t.feature === 'forest');
    const copy = structuredClone(s);
    delete copy.map.tiles[i].feature;
    expect(TerrainField.signature(copy)).not.toBe(before);
  });

  it('todas as unidades (e o barco de embarque) têm modelo', () => {
    for (const type of Object.keys(UNITS)) {
      const m = unitModel(type);
      const verts = (m.neutral?.attributes.position.count ?? 0) + (m.team?.attributes.position.count ?? 0);
      expect(verts, type).toBeGreaterThan(0);
    }
    const boat = unitModel('warrior', true);
    expect(boat.team?.attributes.position.count).toBeGreaterThan(0);
  });
});
