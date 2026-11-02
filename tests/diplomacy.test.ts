import { describe, expect, it } from 'vitest';
import { evaluateDeal, playEndTurn, proposeDeal } from '../src/ai';
import { applyAction, endTurn } from '../src/rules/actions';
import { cityYields } from '../src/rules/cities';
import { foundCity } from '../src/rules/city';
import { atWar } from '../src/rules/combat';
import {
  applyDeal,
  canEnterTerritory,
  checkContacts,
  checkEliminations,
  declareWar,
  grievance,
  hasMet,
  isAtWar,
  relation,
  sendEnvoy,
  suzerainOf,
} from '../src/rules/diplomacy';
import { makePlayer, newGame } from '../src/rules/game';
import { canOccupy } from '../src/rules/movement';
import { deserialize, serialize } from '../src/state/save';
import type { GameState, Unit } from '../src/state/types';
import { flatGame } from './helpers';

const W = 16;
const at = (c: number, r: number) => r * W + c;

/** Mapa plano com humano (0), bárbaros (1), rival (2) e cidade-estado (3). */
function setup() {
  const s = flatGame(W, 12);
  const n = s.map.tiles.length;
  s.players.push(makePlayer(2, 'norvhal', n), makePlayer(3, 'cs-elarion', n, { isCityState: true, envoys: {} }));
  const mk = (id: number, type: string, owner: number, pos: number): Unit => {
    const u: Unit = { id, type, owner, pos, movesLeft: 2, hp: 100, xp: 0, promotions: [] };
    s.units.push(u);
    return u;
  };
  const myCity = foundCity(s, mk(100, 'settler', 0, at(3, 5)));
  const rivalCity = foundCity(s, mk(101, 'settler', 2, at(11, 5)));
  const csCity = foundCity(s, mk(102, 'settler', 3, at(7, 10)));
  csCity.buildings = [];
  return { s, myCity, rivalCity, csCity, mk };
}

function meet(s: GameState, a: number, b: number) {
  relation(s, a, b).met = true;
}

describe('contato e guerra', () => {
  it('primeiro contato quando um vê o outro', () => {
    const { s, mk } = setup();
    expect(hasMet(s, 0, 2)).toBe(false);
    mk(1, 'scout', 0, at(9, 5));
    const ev = checkContacts(s);
    expect(ev).toContainEqual({ type: 'firstContact', a: 0, b: 2 });
    expect(hasMet(s, 0, 2)).toBe(true);
  });

  it('declarar guerra exige contato, gera ressentimento e libera combate', () => {
    const { s } = setup();
    expect(typeof declareWar(s, 0, 2)).toBe('string');
    meet(s, 0, 2);
    s.turn = 20;
    const r = applyAction(s, { type: 'declareWar', target: 2 });
    expect(r.events[0]).toEqual({ type: 'warDeclared', by: 0, on: 2 });
    expect(isAtWar(r.state, 0, 2)).toBe(true);
    expect(atWar(r.state, 0, 2)).toBe(true);
    expect(grievance(r.state, 2, 0)).toBe(40);
  });

  it('fronteiras fechadas em paz; abertas com acordo ou guerra', () => {
    const { s, mk, rivalCity } = setup();
    meet(s, 0, 2);
    const u = mk(1, 'warrior', 0, at(9, 5));
    const inside = at(10, 5);
    expect(s.map.tiles[inside].owner).toBe(2);
    expect(canOccupy(s, u, inside)).toBe(false);
    applyDeal(s, 0, 2, [{ type: 'openBorders' }]);
    expect(canOccupy(s, u, inside)).toBe(true);
    expect(canEnterTerritory(s, 0, 3)).toBe(true); // cidades-estado recebem visitantes
    void rivalCity;
  });

  it('amizade impede declarar guerra', () => {
    const { s } = setup();
    meet(s, 0, 2);
    s.turn = 20;
    applyDeal(s, 0, 2, [{ type: 'friendship' }]);
    expect(declareWar(s, 0, 2)).toMatch(/amizade/);
  });

  it('paz só após 10 turnos de guerra e expulsa unidades do território', () => {
    const { s, mk } = setup();
    meet(s, 0, 2);
    s.turn = 20;
    declareWar(s, 0, 2);
    const u = mk(1, 'warrior', 0, at(10, 5));
    expect(evaluateDeal(s, 2, 0, [{ type: 'peace' }]).accept).toBe(false);
    s.turn = 40;
    // rival bem mais fraco que o humano aceita a paz
    for (let k = 0; k < 5; k++) mk(10 + k, 'swordsman', 0, at(1, k));
    const res = proposeDeal(s, 2, [{ type: 'peace' }]);
    expect(res.events.some((e) => e.type === 'peaceMade')).toBe(true);
    expect(isAtWar(res.state, 0, 2)).toBe(false);
    const moved = res.state.units.find((x) => x.id === u.id)!;
    expect(res.state.map.tiles[moved.pos].owner).not.toBe(2);
  });
});

describe('avaliação de acordos pela IA', () => {
  it('ouro compra fronteiras abertas; hostilidade recusa', () => {
    const { s } = setup();
    meet(s, 0, 2);
    s.players[0].gold = 100;
    expect(evaluateDeal(s, 2, 0, [{ type: 'openBorders' }, { type: 'gold', from: 0, amount: 60 }]).accept).toBe(true);
    relation(s, 0, 2).grievances[2] = 80;
    expect(evaluateDeal(s, 2, 0, [{ type: 'openBorders' }, { type: 'gold', from: 0, amount: 60 }]).accept).toBe(false);
  });

  it('proposta recusada não altera o estado', () => {
    const { s } = setup();
    meet(s, 0, 2);
    const r = proposeDeal(s, 2, [{ type: 'friendship' }]);
    expect(r.state).toBe(s);
    expect(r.events[0].type).toBe('dealRejected');
  });
});

describe('cidades-estado', () => {
  it('emissários dão rendimento na capital e suserania com 3+', () => {
    const { s, myCity } = setup();
    meet(s, 0, 3);
    s.players[0].envoyTokens = 3;
    const base = cityYields(s, myCity).science;
    sendEnvoy(s, 0, 3);
    expect(cityYields(s, myCity).science).toBe(base + 2);
    sendEnvoy(s, 0, 3);
    sendEnvoy(s, 0, 3);
    expect(suzerainOf(s, 3)).toBe(0);
    // 3 emissários: +2 +2 na capital, suserano científico: +2 em todas as cidades
    expect(cityYields(s, myCity).science).toBe(base + 6);
    expect(typeof sendEnvoy(s, 0, 3)).toBe('string'); // sem emissários
  });

  it('empate não gera suserano', () => {
    const { s } = setup();
    s.players[3].envoys = { 0: 3, 2: 3 };
    expect(suzerainOf(s, 3)).toBeNull();
  });

  it('cívica concluída dá emissário', () => {
    const { s } = setup();
    s.players[0].researchingCivic = 'code-of-laws';
    s.players[0].culture = 30;
    endTurn(s);
    expect(s.players[0].envoyTokens).toBe(1);
  });
});

describe('eliminação e IA', () => {
  it('jogador sem cidades (após ter fundado) é eliminado', () => {
    const { s, rivalCity } = setup();
    s.cities = s.cities.filter((c) => c.id !== rivalCity.id);
    s.turn = 5;
    const ev = checkEliminations(s);
    expect(ev).toContainEqual({ type: 'eliminated', player: 2 });
    expect(s.players[2].eliminated).toBe(true);
  });

  it('IA joga 40 turnos: funda cidades, pesquisa e é determinística', () => {
    let a = newGame({ seed: 'ia', mapSize: 'small', civId: 'valdoria' });
    let b = structuredClone(a);
    for (let t = 0; t < 40; t++) {
      a = playEndTurn(a).state;
      b = playEndTurn(b).state;
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const p of a.players.filter((x) => !x.isHuman && !x.isBarbarian && !x.isCityState)) {
      expect(a.cities.filter((c) => c.owner === p.id).length).toBeGreaterThanOrEqual(1);
      expect(p.techs.length).toBeGreaterThan(0);
    }
  }, 60000);
});

describe('migração v4 → v5', () => {
  it('adiciona diplomacia, propostas e emissários', () => {
    const s = newGame({ seed: 'm5', mapSize: 'small', civId: 'valdoria', rivals: 0, cityStates: 0 });
    const env: any = JSON.parse(serialize(s));
    env.version = 4;
    env.state.schemaVersion = 4;
    delete env.state.diplomacy;
    delete env.state.proposals;
    for (const p of env.state.players) delete p.envoyTokens;
    const loaded = deserialize(JSON.stringify(env));
    expect(loaded.diplomacy).toEqual({});
    expect(loaded.proposals).toEqual([]);
    expect(loaded.players[0].envoyTokens).toBe(0);
  });
});
