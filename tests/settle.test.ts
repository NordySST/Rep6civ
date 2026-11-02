import { describe, expect, it } from 'vitest';
import { neighbor } from '../src/rules/hex';
import { rankSites, siteInfo, siteSummary, siteWarnings } from '../src/rules/settle';
import { flatGame } from './helpers';

describe('lente do colono (avaliação de locais)', () => {
  it('rio dá moradia +3 e nota maior; costa +1; primeira cidade conta o Palácio', () => {
    const s = flatGame(14, 12);
    const a = 5 * 14 + 4;
    const b = 5 * 14 + 9;
    s.map.tiles[a].rivers = 1;
    const ia = siteInfo(s, 0, a);
    const ib = siteInfo(s, 0, b);
    expect(ia.freshWater).toBe(true);
    expect(ia.housing).toBe(2 + 3 + 1);
    expect(ib.housing).toBe(2 + 1);
    expect(ia.score).toBeGreaterThan(ib.score);
    const c = 5 * 14 + 11;
    s.map.tiles[neighbor(s.map, c, 0)].terrain = 'coast';
    expect(siteInfo(s, 0, c).housing).toBe(2 + 1 + 1);
    expect(siteSummary(ia)).toContain('(rio)');
  });

  it('não vaza informação: ignora cidades e recursos que o jogador não conhece', () => {
    const s = flatGame(14, 12);
    const site = 5 * 14 + 5;
    const hidden = 5 * 14 + 7;
    s.players[0].explored[hidden] = 0;
    s.cities.push({ id: 50, name: 'Oculta', owner: 0, pos: hidden } as never);
    expect(siteInfo(s, 0, site).valid).toBe(true);
    s.players[0].explored[hidden] = 1;
    expect(siteInfo(s, 0, site).valid).toBe(false);
    // recurso estratégico ainda não revelado não conta
    s.cities = [];
    s.map.tiles[site + 1].resource = 'iron';
    expect(siteInfo(s, 0, site).strategics).toBe(0);
    s.players[0].techs.push('bronze-working');
    expect(siteInfo(s, 0, site).strategics).toBe(1);
  });

  it('classifica locais e destaca até 3 melhores afastados entre si', () => {
    const s = flatGame(16, 12);
    const river = 6 * 16 + 8;
    s.map.tiles[river].rivers = 1 << 1;
    s.map.tiles[neighbor(s.map, river, 1)].rivers = 1 << 4;
    const r = rankSites(s, 0, 6 * 16 + 6, 5);
    expect(r.best[0]).toBe(river);
    expect(r.best.length).toBeLessThanOrEqual(3);
    expect(r.tiers.get(river)).toBe(3);
    for (const [, t] of r.tiers) expect([1, 2, 3]).toContain(t);
  });

  it('avisa sobre falta de água doce e local bem melhor por perto', () => {
    const s = flatGame(16, 12);
    const here = 6 * 16 + 6;
    const river = 6 * 16 + 8;
    s.map.tiles[river].rivers = 1 << 1;
    s.map.tiles[neighbor(s.map, river, 1)].rivers = 1 << 4;
    for (let k = -2; k <= 2; k++) s.map.tiles[river + k + 16 * 2].resource = 'wine';
    const w = siteWarnings(s, 0, here);
    expect(w.some((x) => x.includes('Sem água doce'))).toBe(true);
    expect(w.some((x) => x.includes('local bem melhor'))).toBe(true);
    expect(siteWarnings(s, 0, river).some((x) => x.includes('Sem água doce'))).toBe(false);
  });
});
