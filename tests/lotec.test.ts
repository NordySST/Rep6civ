import { describe, expect, it } from 'vitest';
import { CIVICS } from '../src/data/civics';
import { CIVS } from '../src/data/civs';
import { ERAS } from '../src/data/eras';
import { GOVERNMENTS, POLICIES } from '../src/data/governments';
import { RESOURCES } from '../src/data/resources';
import { TECH_BY_ID, TECHS } from '../src/data/techs';
import { UNITS } from '../src/data/units';
import { BUILDINGS } from '../src/data/buildings';
import { cannotProduce, cityTileYields } from '../src/rules/cities';
import { foundCity } from '../src/rules/city';
import { playerEra } from '../src/rules/victory';
import { treeDepth } from '../src/rules/research';
import type { Unit } from '../src/state/types';
import { flatGame } from './helpers';

describe('árvores das eras novas', () => {
  it('pré-requisitos existem e não há ciclos', () => {
    for (const t of TECHS) for (const r of t.prereqs) expect(TECH_BY_ID[r]).toBeDefined();
    for (const t of TECHS) expect(treeDepth('tech', t.id)).toBeLessThan(20);
    const civicIds = new Set(CIVICS.map((c) => c.id));
    for (const c of CIVICS) for (const r of c.prereqs) expect(civicIds.has(r)).toBe(true);
  });

  it('todo recurso estratégico é revelado por uma tecnologia existente', () => {
    for (const r of RESOURCES) if (r.revealedBy) expect(TECH_BY_ID[r.revealedBy], r.id).toBeDefined();
  });

  it('tudo que exige tecnologia/cívica/edifício aponta para algo existente', () => {
    const civicIds = new Set(CIVICS.map((c) => c.id));
    for (const u of Object.values(UNITS)) if (u.requiresTech) expect(TECH_BY_ID[u.requiresTech], u.id).toBeDefined();
    for (const b of Object.values(BUILDINGS)) {
      if (b.requiresTech) expect(TECH_BY_ID[b.requiresTech], b.id).toBeDefined();
      if (b.requiresCivic) expect(civicIds.has(b.requiresCivic), b.id).toBe(true);
      if (b.requiresBuilding) expect(BUILDINGS[b.requiresBuilding], b.id).toBeDefined();
    }
    for (const g of GOVERNMENTS) expect(civicIds.has(g.civic)).toBe(true);
    for (const p of POLICIES) expect(civicIds.has(p.civic)).toBe(true);
  });

  it('eras vão da Antiga à Moderna', () => {
    const s = flatGame(16, 12);
    expect(ERAS.map((e) => e.name)).toEqual([
      'Era Antiga',
      'Era Clássica',
      'Era Medieval',
      'Era Renascentista',
      'Era Industrial',
      'Era Moderna',
    ]);
    s.players[0].techs.push('banking');
    expect(playerEra(s, 0).name).toBe('Era Renascentista');
    s.players[0].techs.push('nuclear-fission');
    expect(playerEra(s, 0).name).toBe('Era Moderna');
  });

  it('unidades modernas exigem recurso revelado (Tanque → Petróleo com Refino)', () => {
    const s = flatGame(16, 12);
    const u: Unit = { id: 1, type: 'settler', owner: 0, pos: 5 * 16 + 5, movesLeft: 2, hp: 100, xp: 0, promotions: [] };
    s.units.push(u);
    const city = foundCity(s, u);
    s.players[0].techs.push('combustion');
    s.map.tiles[city.pos + 1].resource = 'oil';
    expect(cannotProduce(s, city, { kind: 'unit', id: 'tank' })).toMatch(/Petróleo/);
    s.players[0].techs.push('refining');
    expect(cannotProduce(s, city, { kind: 'unit', id: 'tank' })).toBeNull();
  });
});

describe('civilizações novas', () => {
  it('há 9 civilizações com nomes e cores únicos', () => {
    expect(CIVS).toHaveLength(9);
    expect(new Set(CIVS.map((c) => c.id)).size).toBe(9);
    expect(new Set(CIVS.map((c) => c.color)).size).toBe(9);
    for (const c of CIVS) expect(c.cityNames.length).toBeGreaterThanOrEqual(10);
  });

  it('habilidades: Ilhavar (costa +1 ouro), Kaluun (planície +1 produção), Tzeltani (colinas +1 comida), Oskari (floresta +1 ciência)', () => {
    const cases: [string, Parameters<typeof cityTileYields>[2], 'gold' | 'production' | 'food' | 'science'][] = [
      ['ilhavar', { terrain: 'coast', hills: false, rivers: 0 }, 'gold'],
      ['kaluun', { terrain: 'plains', hills: false, rivers: 0 }, 'production'],
      ['tzeltani', { terrain: 'grassland', hills: true, rivers: 0 }, 'food'],
      ['oskari', { terrain: 'grassland', hills: false, rivers: 0, feature: 'forest' }, 'science'],
    ];
    for (const [civ, tile, key] of cases) {
      const s = flatGame(16, 12);
      const u: Unit = { id: 1, type: 'settler', owner: 0, pos: 5 * 16 + 5, movesLeft: 2, hp: 100, xp: 0, promotions: [] };
      s.units.push(u);
      const city = foundCity(s, u);
      s.players[0].civId = 'valdoria';
      const base = cityTileYields(s, city, tile)[key];
      s.players[0].civId = civ;
      expect(cityTileYields(s, city, tile)[key], civ).toBe(base + 1);
    }
  });
});
