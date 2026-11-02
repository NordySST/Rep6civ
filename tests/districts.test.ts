import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/rules/actions';
import { cannotProduce, cityTileYields, cityYields, processCity, workableTiles } from '../src/rules/cities';
import { foundCity } from '../src/rules/city';
import { cityStrength } from '../src/rules/combat';
import {
  adjacencyBonus,
  connectedToCapital,
  districtLimit,
  districtSites,
  wonderOwner,
  wonderSites,
} from '../src/rules/districts';
import { modifiersFor } from '../src/rules/effects';
import { neighbor } from '../src/rules/hex';
import { makePlayer, newGame } from '../src/rules/game';
import { maxMoves } from '../src/rules/movement';
import { deserialize, serialize } from '../src/state/save';
import type { GameState, Unit } from '../src/state/types';
import { flatGame } from './helpers';

const W = 16;
const at = (c: number, r: number) => r * W + c;

function setup(civ = 'tamaru') {
  const s = flatGame(W, 12);
  s.players[0].civId = civ;
  const mk = (id: number, type: string, owner: number, pos: number): Unit => {
    const u: Unit = { id, type, owner, pos, movesLeft: 2, hp: 100, xp: 0, promotions: [] };
    s.units.push(u);
    return u;
  };
  const city = foundCity(s, mk(100, 'settler', 0, at(6, 5)));
  return { s, city, p: s.players[0], mk };
}

/** Coloca e conclui um item com hexágono escolhido. */
function build(s: GameState, cityId: number, kind: 'district' | 'wonder', id: string, tile: number) {
  const r = applyAction(s, { type: 'setProduction', cityId, item: { kind, id, tile } });
  const errs = r.events.filter((e) => e.type === 'error');
  if (errs.length) return { state: s, error: (errs[0] as { message: string }).message };
  const c = r.state.cities.find((x) => x.id === cityId)!;
  c.progress[`${kind}:${id}`] = 10000;
  processCity(r.state, c);
  return { state: r.state, error: null };
}

describe('distritos', () => {
  it('exigem tecnologia e respeitam o limite por população', () => {
    const { s, city, p } = setup();
    const tile = neighbor(s.map, city.pos, 0);
    expect(build(s, city.id, 'district', 'campus', tile).error).toMatch(/Escrita/);
    p.techs.push('writing', 'currency');
    expect(districtLimit(city)).toBe(1);
    const { state, error } = build(s, city.id, 'district', 'campus', tile);
    expect(error).toBeNull();
    const c = state.cities[0];
    expect(c.districts).toEqual([{ type: 'campus', pos: tile }]);
    expect(state.map.tiles[tile].district).toBe('campus');
    expect(workableTiles(state, c)).not.toContain(tile);
    const other = neighbor(s.map, city.pos, 3);
    expect(build(state, city.id, 'district', 'commercial', other).error).toMatch(/Limite/);
    c.population = 4;
    expect(build(state, city.id, 'district', 'commercial', other).error).toBeNull();
  });

  it('adjacência: campus ganha +1 por montanha e +½ por distrito/cidade', () => {
    const { s, city } = setup();
    const tile = neighbor(s.map, city.pos, 0);
    expect(adjacencyBonus(s, tile, 'campus')).toBe(0); // só a cidade: ½ → 0
    s.map.tiles[neighbor(s.map, tile, 0)].terrain = 'mountain';
    s.map.tiles[neighbor(s.map, tile, 1)].terrain = 'mountain';
    expect(adjacencyBonus(s, tile, 'campus')).toBe(2);
    s.map.tiles[neighbor(s.map, tile, 5)].feature = 'jungle';
    expect(adjacencyBonus(s, tile, 'campus')).toBe(3); // 2 + ½ + ½
  });

  it('rendimento do distrito entra na cidade', () => {
    const { s, city, p } = setup();
    p.techs.push('writing');
    const tile = neighbor(s.map, city.pos, 0);
    s.map.tiles[neighbor(s.map, tile, 0)].terrain = 'mountain';
    s.map.tiles[neighbor(s.map, tile, 1)].terrain = 'mountain';
    const before = cityYields(s, city).science;
    const { state } = build(s, city.id, 'district', 'campus', tile);
    expect(cityYields(state, state.cities[0]).science).toBe(before + 2);
  });

  it('edifícios de distrito exigem o distrito (Biblioteca → Campus)', () => {
    const { s, city, p } = setup();
    p.techs.push('writing');
    expect(cannotProduce(s, city, { kind: 'building', id: 'library' })).toMatch(/Campus/);
    const { state } = build(s, city.id, 'district', 'campus', neighbor(s.map, city.pos, 0));
    expect(cannotProduce(state, state.cities[0], { kind: 'building', id: 'library' })).toBeNull();
    state.players[0].techs.push('mathematics');
    const c = state.cities[0];
    expect(cannotProduce(state, c, { kind: 'building', id: 'university' })).toMatch(/Biblioteca/);
  });

  it('porto só na costa junto à terra; não sobre recurso de luxo', () => {
    const { s, city, p } = setup();
    p.techs.push('sailing');
    expect(districtSites(s, city, 'harbor')).toEqual([]);
    const c = neighbor(s.map, city.pos, 3);
    s.map.tiles[c].terrain = 'coast';
    expect(districtSites(s, city, 'harbor')).toEqual([c]);
    s.map.tiles[c].resource = 'pearls';
    expect(districtSites(s, city, 'harbor')).toEqual([]);
  });

  it('acampamento militar acelera unidades militares e dá XP', () => {
    const { s, city, p } = setup();
    p.techs.push('bronze-working');
    const { state } = build(s, city.id, 'district', 'encampment', neighbor(s.map, city.pos, 0));
    const c = state.cities[0];
    c.queue = [{ kind: 'unit', id: 'warrior' }];
    c.progress['unit:warrior'] = 39;
    processCity(state, c);
    const w = state.units.find((u) => u.type === 'warrior')!;
    expect(w.xp).toBe(10);
  });

  it('distritos e maravilhas não podem ser comprados', () => {
    const { s, city, p } = setup();
    p.techs.push('writing');
    p.gold = 9999;
    const r = applyAction(s, { type: 'purchaseItem', cityId: city.id, item: { kind: 'district', id: 'campus', tile: neighbor(s.map, city.pos, 0) } });
    expect(r.events[0].type).toBe('error');
  });
});

describe('maravilhas mundiais', () => {
  it('posicionamento, efeito e exclusividade', () => {
    const { s, city, p } = setup();
    p.techs.push('masonry');
    // Pirâmides exigem deserto plano
    expect(wonderSites(s, city, 'sahrun-pyramids')).toEqual([]);
    const t = neighbor(s.map, city.pos, 0);
    s.map.tiles[t].terrain = 'desert';
    expect(wonderSites(s, city, 'sahrun-pyramids')).toEqual([t]);
    const { state, error } = build(s, city.id, 'wonder', 'sahrun-pyramids', t);
    expect(error).toBeNull();
    expect(wonderOwner(state, 'sahrun-pyramids')?.id).toBe(city.id);
    expect(state.map.tiles[t].builtWonder).toBe('sahrun-pyramids');
    expect(modifiersFor(state, 0).builderCharges).toBe(1);
    // outra cidade não pode mais construir
    const s2 = state;
    s2.units.push({ id: 200, type: 'settler', owner: 0, pos: at(12, 5), movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    const c2 = foundCity(s2, s2.units.find((u) => u.id === 200)!);
    expect(cannotProduce(s2, c2, { kind: 'wonder', id: 'sahrun-pyramids' })).toMatch(/Já construída/);
  });

  it('quem conclui primeiro tira a maravilha da fila dos outros', () => {
    const { s, city, p } = setup();
    const n = s.map.tiles.length;
    s.players.push(makePlayer(2, 'norvhal', n));
    s.units.push({ id: 201, type: 'settler', owner: 2, pos: at(12, 8), movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    const rival = foundCity(s, s.units.find((u) => u.id === 201)!);
    p.techs.push('masonry');
    s.players[2].techs.push('masonry');
    s.map.tiles[neighbor(s.map, city.pos, 0)].terrain = 'desert';
    s.map.tiles[neighbor(s.map, rival.pos, 0)].terrain = 'desert';
    rival.queue = [{ kind: 'wonder', id: 'sahrun-pyramids', tile: neighbor(s.map, rival.pos, 0) }];
    const { state } = build(s, city.id, 'wonder', 'sahrun-pyramids', neighbor(s.map, city.pos, 0));
    expect(state.cities.find((c) => c.id === rival.id)!.queue).toEqual([]);
  });

  it('Muralha Eterna dá defesa às cidades', () => {
    const { s, city, p } = setup();
    p.techs.push('construction');
    const t = neighbor(s.map, city.pos, 0);
    s.map.tiles[t].hills = true;
    const before = cityStrength(s, city);
    const { state } = build(s, city.id, 'wonder', 'eternal-wall', t);
    expect(cityStrength(state, state.cities[0])).toBe(before + 5);
  });
});

describe('habilidades únicas', () => {
  it('Tamaru: rio dá +1 ciência; Norvhal: tundra +1 produção; Qasmira: deserto +1 ouro e fé', () => {
    const t = { terrain: 'grassland', hills: false, rivers: 1 } as const;
    const a = setup('tamaru');
    expect(cityTileYields(a.s, a.city, { ...t }).science).toBe(1);
    const b = setup('norvhal');
    expect(cityTileYields(b.s, b.city, { terrain: 'tundra', hills: false, rivers: 0 }).production).toBe(1);
    const c = setup('qasmira');
    const y = cityTileYields(c.s, c.city, { terrain: 'desert', hills: false, rivers: 0 });
    expect([y.gold, y.faith]).toEqual([1, 1]);
  });

  it('Valdória: cidade ligada à capital por estrada ganha +2 ouro', () => {
    const { s, city, mk } = setup('valdoria');
    const second = foundCity(s, mk(101, 'settler', 0, at(10, 5)));
    expect(connectedToCapital(s, second)).toBe(false);
    const before = cityYields(s, second).gold;
    for (const c of [7, 8, 9]) s.map.tiles[at(c, 5)].road = true;
    expect(connectedToCapital(s, second)).toBe(true);
    expect(cityYields(s, second).gold).toBe(before + 2);
    void city;
  });

  it('Yrkaan: +1 movimento para quem está em planície', () => {
    const { s, mk } = setup('yrkaan');
    const u = mk(1, 'warrior', 0, at(2, 2));
    expect(maxMoves(s, u)).toBe(2);
    s.map.tiles[u.pos].terrain = 'plains';
    expect(maxMoves(s, u)).toBe(3);
  });
});

describe('migração v5 → v6', () => {
  it('adiciona distritos e maravilhas às cidades', () => {
    const s = newGame({ seed: 'm6', mapSize: 'small', civId: 'valdoria' });
    const env: any = JSON.parse(serialize(s));
    env.version = 5;
    env.state.schemaVersion = 5;
    for (const c of env.state.cities) {
      delete c.districts;
      delete c.wonders;
    }
    const loaded = deserialize(JSON.stringify(env));
    expect(loaded.cities.every((c) => Array.isArray(c.districts) && Array.isArray(c.wonders))).toBe(true);
  });
});
