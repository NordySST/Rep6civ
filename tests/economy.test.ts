import { describe, expect, it } from 'vitest';
import { applyAction, endTurn, payMaintenance } from '../src/rules/actions';
import { cannotProduce, cityYields, processCity } from '../src/rules/cities';
import { foundCity } from '../src/rules/city';
import { cannotAttack, defenseStrength } from '../src/rules/combat';
import { relation } from '../src/rules/diplomacy';
import { amenitiesNeeded, amenityStatus, cityAmenities, improvedLuxuries, maintenanceOf } from '../src/rules/economy';
import { gpCost, gpPerTurn, processGreatPeople } from '../src/rules/greatPeople';
import { makePlayer, newGame } from '../src/rules/game';
import { neighbor } from '../src/rules/hex';
import { canEnterTerrain, canOccupy, findPath, stepCost } from '../src/rules/movement';
import { availablePantheons, spreadPressure } from '../src/rules/religion';
import { tradeCapacity, tradeDestinations } from '../src/rules/trade';
import { deserialize, serialize } from '../src/state/save';
import type { GameState, Unit } from '../src/state/types';
import { flatGame } from './helpers';

const W = 16;
const at = (c: number, r: number) => r * W + c;

function setup() {
  const s = flatGame(W, 12);
  const mk = (id: number, type: string, owner: number, pos: number, extra: Partial<Unit> = {}): Unit => {
    const u: Unit = { id, type, owner, pos, movesLeft: 2, hp: 100, xp: 0, promotions: [], ...extra };
    s.units.push(u);
    return u;
  };
  const city = foundCity(s, mk(100, 'settler', 0, at(5, 5)));
  return { s, city, p: s.players[0], mk };
}

describe('manutenção', () => {
  it('edifícios, distritos e unidades além das gratuitas custam ouro', () => {
    const { s, city, mk } = setup();
    city.buildings.push('granary', 'monument', 'university');
    city.districts.push({ type: 'campus', pos: neighbor(s.map, city.pos, 0) });
    mk(1, 'warrior', 0, at(1, 1));
    mk(2, 'warrior', 0, at(1, 2));
    mk(3, 'warrior', 0, at(1, 3));
    // granary 1 + monument 0 + university 2 = 3; 1 distrito; 3 militares − 2 grátis = 1
    expect(maintenanceOf(s, 0)).toEqual({ buildings: 3, districts: 1, units: 1, total: 5 });
  });

  it('ouro negativo dispensa unidades militares', () => {
    const { s, mk } = setup();
    for (let k = 0; k < 6; k++) mk(10 + k, 'warrior', 0, at(1, k));
    s.players[0].gold = 0;
    const ev = payMaintenance(s);
    expect(ev.some((e) => e.type === 'disbanded')).toBe(true);
    expect(s.players[0].gold).toBeGreaterThanOrEqual(0);
    expect(s.units.filter((u) => u.type === 'warrior').length).toBeLessThan(6);
  });
});

describe('comodidades', () => {
  it('necessidade cresce com a população e luxo melhorado atende', () => {
    const { s, city } = setup();
    expect(amenitiesNeeded(city)).toBe(0);
    city.population = 5;
    expect(amenitiesNeeded(city)).toBe(2);
    expect(cityAmenities(s, city).status).toBe('displeased');
    const t = neighbor(s.map, city.pos, 0);
    s.map.tiles[t].resource = 'wine';
    expect(improvedLuxuries(s, 0)).toEqual([]);
    s.map.tiles[t].improvement = 'plantation';
    expect(improvedLuxuries(s, 0)).toEqual(['wine']);
    expect(cityAmenities(s, city).balance).toBe(-1);
  });

  it('humor altera rendimentos', () => {
    expect(amenityStatus(3).yieldPct).toBe(10);
    expect(amenityStatus(-1).yieldPct).toBe(-10);
    expect(amenityStatus(-3).status).toBe('unrest');
    const { s, city } = setup();
    city.buildings.push('library', 'market');
    const content = cityYields(s, city).gold;
    city.population = 8; // precisa de 3, tem 0 → revolta (−30%)
    expect(cityYields(s, city).gold).toBeLessThan(content + 1);
  });
});

describe('rotas comerciais', () => {
  it('comerciante cria rota doméstica (+comida/produção) e constrói estrada', () => {
    const { s, city, p, mk } = setup();
    const other = foundCity(s, mk(101, 'settler', 0, at(11, 5)));
    p.civics.push('foreign-trade');
    expect(cannotProduce(s, city, { kind: 'unit', id: 'trader' })).toBeNull();
    mk(5, 'trader', 0, city.pos);
    expect(tradeCapacity(s, 0)).toBe(1);
    expect(tradeDestinations(s, s.units.find((u) => u.id === 5)!).map((c) => c.id)).toEqual([other.id]);
    const before = cityYields(s, city);
    const { state, events } = applyAction(s, { type: 'establishRoute', unitId: 5, cityId: other.id });
    expect(events.some((e) => e.type === 'routeCreated')).toBe(true);
    expect(state.units.some((u) => u.id === 5)).toBe(false);
    const after = cityYields(state, state.cities[0]);
    expect(after.food).toBe(before.food + 1);
    expect(after.production).toBe(before.production + 1);
    expect(state.map.tiles[at(8, 5)].road).toBe(true);
    // capacidade esgotada
    state.units.push({ id: 6, type: 'trader', owner: 0, pos: city.pos, movesLeft: 2, hp: 100, xp: 0, promotions: [] });
    const r2 = applyAction(state, { type: 'establishRoute', unitId: 6, cityId: other.id });
    expect(r2.events[0].type).toBe('error');
  });

  it('rota internacional rende ouro e cai com a guerra', () => {
    const { s, city, mk } = setup();
    s.players.push(makePlayer(2, 'norvhal', s.map.tiles.length));
    const foreign = foundCity(s, mk(102, 'settler', 2, at(12, 8)));
    relation(s, 0, 2).met = true;
    mk(5, 'trader', 0, city.pos);
    const g0 = cityYields(s, city).gold;
    const { state } = applyAction(s, { type: 'establishRoute', unitId: 5, cityId: foreign.id });
    expect(cityYields(state, state.cities[0]).gold).toBe(g0 + 3);
    state.turn = 30;
    applyAction(state, { type: 'declareWar', target: 2 });
    const r = relation(state, 0, 2);
    r.war = true;
    const ev = endTurn(state);
    expect(ev.some((e) => e.type === 'routeLost')).toBe(true);
    expect(state.tradeRoutes).toEqual([]);
  });
});

describe('religião', () => {
  it('panteão custa fé e é exclusivo', () => {
    const { s, p } = setup();
    expect(applyAction(s, { type: 'choosePantheon', belief: 'oracles' }).events[0].type).toBe('error');
    p.faith = 30;
    const { state } = applyAction(s, { type: 'choosePantheon', belief: 'oracles' });
    expect(state.players[0].pantheon).toBe('oracles');
    expect(state.players[0].faith).toBe(5);
    expect(availablePantheons(state)).not.toContain('oracles');
  });

  it('profeta funda religião numa cidade com Lugar Sagrado; pressão converte vizinhas', () => {
    const { s, city, mk } = setup();
    const other = foundCity(s, mk(101, 'settler', 0, at(10, 5)));
    mk(7, 'great-prophet', 0, city.pos);
    const no = applyAction(s, { type: 'foundReligion', unitId: 7, religion: 'aurorism', follower: 'monasteries' });
    expect(no.events[0].type).toBe('error');
    city.districts.push({ type: 'holy-site', pos: neighbor(s.map, city.pos, 3) });
    const { state, events } = applyAction(s, { type: 'foundReligion', unitId: 7, religion: 'aurorism', follower: 'monasteries' });
    expect(events.some((e) => e.type === 'religionFounded')).toBe(true);
    const holy = state.cities[0];
    expect(holy.religion).toBe('aurorism');
    const sci = cityYields(state, holy).science;
    expect(sci).toBeGreaterThanOrEqual(2);
    // cidade sagrada exerce +3 por turno (com decaimento de 5%): ~22 turnos chegam a 40
    for (let k = 0; k < 15; k++) spreadPressure(state);
    expect(state.cities.find((c) => c.id === other.id)!.religion).toBeUndefined();
    for (let k = 0; k < 15; k++) spreadPressure(state);
    expect(state.cities.find((c) => c.id === other.id)!.religion).toBe('aurorism');
  });

  it('missionário comprado com fé difunde a religião', () => {
    const { s, city, mk } = setup();
    const target = foundCity(s, mk(101, 'settler', 0, at(12, 9)));
    s.religions.push({ id: 'aurorism', founder: 0, holyCityId: city.id, follower: 'choral-music' });
    city.religion = 'aurorism';
    s.players[0].faith = 100;
    const r = applyAction(s, { type: 'buyWithFaith', cityId: city.id, unit: 'missionary' });
    const m = r.state.units.find((u) => u.type === 'missionary')!;
    expect(m.religion).toBe('aurorism');
    expect(m.charges).toBe(3);
    expect(r.state.players[0].faith).toBe(20);
    m.pos = target.pos;
    const r2 = applyAction(r.state, { type: 'spreadReligion', unitId: m.id, cityId: target.id });
    expect(r2.state.cities.find((c) => c.id === target.id)!.religion).toBe('aurorism');
  });
});

describe('grandes personalidades', () => {
  it('distritos geram pontos; recrutamento cria a unidade e encarece o próximo', () => {
    const { s, city } = setup();
    city.districts.push({ type: 'campus', pos: neighbor(s.map, city.pos, 0) });
    city.buildings.push('library');
    expect(gpPerTurn(s, 0).scientist).toBe(2);
    s.players[0].gpPoints.scientist = 59;
    const ev = processGreatPeople(s);
    expect(ev[0]).toMatchObject({ type: 'greatPerson', gpType: 'scientist', name: 'Ilsa Moravec' });
    expect(gpCost(s, 'scientist')).toBe(100);
    const gp = s.units.find((u) => u.type === 'great-scientist')!;
    s.players[0].researching = 'writing';
    const { state } = applyAction(s, { type: 'activateGreatPerson', unitId: gp.id });
    expect(state.players[0].science).toBe(25);
    expect(state.units.some((u) => u.id === gp.id)).toBe(false);
  });

  it('grande engenheiro acelera a produção atual', () => {
    const { s, city, mk } = setup();
    city.queue.push({ kind: 'building', id: 'monument' });
    const e = mk(9, 'great-engineer', 0, city.pos);
    const { state } = applyAction(s, { type: 'activateGreatPerson', unitId: e.id });
    expect(state.cities[0].progress['building:monument']).toBe(150);
    processCity(state, state.cities[0]);
    expect(state.cities[0].buildings).toContain('monument');
  });
});

describe('unidades navais e embarque', () => {
  function coastal() {
    const ctx = setup();
    // faixa de costa na coluna 7, oceano na 8
    for (let r = 0; r < 12; r++) {
      ctx.s.map.tiles[at(7, r)].terrain = 'coast';
      ctx.s.map.tiles[at(8, r)].terrain = 'ocean';
    }
    return ctx;
  }

  it('navios só na água (oceano com Navegação Celeste); galé exige cidade costeira', () => {
    const { s, city, p, mk } = coastal();
    p.techs.push('sailing');
    const g = mk(1, 'galley', 0, at(7, 3));
    expect(canEnterTerrain(s, g, at(7, 4))).toBe(true);
    expect(canEnterTerrain(s, g, at(8, 4))).toBe(false);
    expect(canEnterTerrain(s, g, at(6, 4))).toBe(false);
    p.techs.push('celestial-navigation');
    expect(canEnterTerrain(s, g, at(8, 4))).toBe(true);
    expect(cannotProduce(s, city, { kind: 'unit', id: 'galley' })).toMatch(/costeira/);
  });

  it('unidade terrestre embarca com Navegação à Vela; embarcar gasta tudo e defende mal', () => {
    const { s, p, mk } = coastal();
    const w = mk(1, 'warrior', 0, at(6, 4));
    expect(canOccupy(s, w, at(7, 4))).toBe(false);
    p.techs.push('sailing');
    expect(canOccupy(s, w, at(7, 4))).toBe(true);
    expect(stepCost(s, at(6, 4), at(7, 4), undefined, w)).toBeGreaterThanOrEqual(99);
    w.pos = at(7, 4);
    expect(defenseStrength(s, w)).toBe(10);
    expect(findPath(s, w, at(7, 9))).not.toBeNull();
  });

  it('terrestre não ataca no mar; navio ataca a costa', () => {
    const { s, p, mk } = coastal();
    p.techs.push('sailing');
    s.players[1].techs = [];
    const w = mk(1, 'warrior', 0, at(6, 4));
    mk(2, 'galley', 1, at(7, 4));
    expect(cannotAttack(s, w, at(7, 4))).toMatch(/navios/);
    const g = mk(3, 'galley', 0, at(7, 6));
    mk(4, 'barbarian-raider', 1, at(6, 6));
    expect(cannotAttack(s, g, at(6, 6))).toBeNull();
  });
});

describe('migração v6 → v7', () => {
  it('adiciona rotas, religiões, pontos de personalidades e pressão', () => {
    const s: GameState = newGame({ seed: 'm7', mapSize: 'small', civId: 'valdoria' });
    const env: any = JSON.parse(serialize(s));
    env.version = 6;
    env.state.schemaVersion = 6;
    delete env.state.tradeRoutes;
    delete env.state.religions;
    delete env.state.gpRecruited;
    for (const p of env.state.players) delete p.gpPoints;
    for (const c of env.state.cities) delete c.pressure;
    const loaded = deserialize(JSON.stringify(env));
    expect(loaded.tradeRoutes).toEqual([]);
    expect(loaded.religions).toEqual([]);
    expect(loaded.players[0].gpPoints).toEqual({});
    expect(loaded.cities.every((c) => c.pressure && typeof c.pressure === 'object')).toBe(true);
  });
});
