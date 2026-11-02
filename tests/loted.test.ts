import { describe, expect, it } from 'vitest';
import { playEndTurn, proposeDeal } from '../src/ai';
import { activeHumans, applyAction, nextHuman } from '../src/rules/actions';
import { foundCity } from '../src/rules/city';
import { relation } from '../src/rules/diplomacy';
import { makePlayer, newGame } from '../src/rules/game';
import { neighbor } from '../src/rules/hex';
import { canOccupy } from '../src/rules/movement';
import { canBuyMissionary, cannotTheology, religiousStrength } from '../src/rules/religion';
import type { Unit } from '../src/state/types';
import { flatGame } from './helpers';

const W = 16;
const at = (c: number, r: number) => r * W + c;

function religiousSetup() {
  const s = flatGame(W, 12);
  s.players.push(makePlayer(2, 'norvhal', s.map.tiles.length));
  const mk = (id: number, type: string, owner: number, pos: number, extra: Partial<Unit> = {}): Unit => {
    const u: Unit = { id, type, owner, pos, movesLeft: 3, hp: 100, xp: 0, promotions: [], ...extra };
    s.units.push(u);
    return u;
  };
  const mine = foundCity(s, mk(100, 'settler', 0, at(3, 5)));
  const theirs = foundCity(s, mk(101, 'settler', 2, at(12, 5)));
  s.religions.push({ id: 'aurorism', founder: 0, holyCityId: mine.id, follower: 'monasteries' });
  s.religions.push({ id: 'tide-faith', founder: 2, holyCityId: theirs.id, follower: 'choral-music' });
  mine.religion = 'aurorism';
  theirs.religion = 'tide-faith';
  return { s, mine, theirs, mk };
}

describe('disputa religiosa', () => {
  it('apóstolo e inquisidor são comprados com fé', () => {
    const { s, mine } = religiousSetup();
    s.players[0].faith = 300;
    expect(canBuyMissionary(s, mine, 'apostle')).toBeNull();
    const r = applyAction(s, { type: 'buyWithFaith', cityId: mine.id, unit: 'apostle' });
    const ap = r.state.units.find((u) => u.type === 'apostle')!;
    expect(ap.religion).toBe('aurorism');
    expect(r.state.players[0].faith).toBe(160);
  });

  it('combate teológico: o perdedor some e sua religião perde pressão por perto', () => {
    const { s, theirs, mk } = religiousSetup();
    const near = neighbor(s.map, theirs.pos, 3);
    const ap = mk(1, 'apostle', 0, near, { religion: 'aurorism' });
    const foe = mk(2, 'missionary', 2, neighbor(s.map, near, 3), { religion: 'tide-faith', charges: 3 });
    theirs.pressure['tide-faith'] = 100;
    expect(cannotTheology(s, ap, foe.pos)).toBeNull();
    expect(religiousStrength(s, ap)).toBe(30);
    let state = s;
    for (let k = 0; k < 6 && state.units.some((u) => u.id === 2); k++) {
      const r = applyAction(state, { type: 'theology', unitId: 1, target: foe.pos });
      state = r.state;
      const a = state.units.find((u) => u.id === 1);
      if (a) a.movesLeft = 3;
    }
    expect(state.units.some((u) => u.id === 2)).toBe(false);
    const c = state.cities.find((x) => x.id === theirs.id)!;
    expect(c.pressure['tide-faith']).toBeLessThan(100);
    expect(c.pressure.aurorism).toBeGreaterThan(0);
  });

  it('inquisidor remove outras religiões das suas cidades', () => {
    const { s, mine, mk } = religiousSetup();
    mine.pressure = { aurorism: 30, 'tide-faith': 90 };
    mine.religion = 'tide-faith';
    mk(3, 'inquisitor', 0, mine.pos, { religion: 'aurorism', charges: 3 });
    const { state, events } = applyAction(s, { type: 'purgeHeresy', unitId: 3, cityId: mine.id });
    const c = state.cities.find((x) => x.id === mine.id)!;
    expect(c.religion).toBe('aurorism');
    expect(c.pressure['tide-faith']).toBeUndefined();
    expect(events.some((e) => e.type === 'cityConverted')).toBe(true);
  });

  it('unidades religiosas atravessam fronteiras fechadas', () => {
    const { s, theirs, mk } = religiousSetup();
    relation(s, 0, 2).met = true;
    const inside = neighbor(s.map, theirs.pos, 3);
    const w = mk(4, 'warrior', 0, neighbor(s.map, inside, 3));
    const m = mk(5, 'missionary', 0, neighbor(s.map, inside, 3), { religion: 'aurorism', charges: 3 });
    expect(canOccupy(s, w, inside)).toBe(false);
    expect(canOccupy(s, m, inside)).toBe(true);
  });
});

describe('multijogador local', () => {
  it('cria humanos extras com civilizações distintas e passa a vez em ordem', () => {
    const s = newGame({ seed: 'hot', mapSize: 'small', civId: 'valdoria', extraHumans: ['tamaru', 'valdoria'], rivals: 1, cityStates: 0 });
    const humans = s.players.filter((p) => p.isHuman);
    expect(humans.map((p) => p.civId).slice(0, 2)).toEqual(['valdoria', 'tamaru']);
    expect(new Set(s.players.map((p) => p.civId)).size).toBe(s.players.length);
    expect(activeHumans(s)).toHaveLength(3);
    expect(s.units.filter((u) => u.owner === humans[1].id).map((u) => u.type).sort()).toEqual(['settler', 'warrior']);
    const r = applyAction(s, { type: 'passTurn' });
    expect(r.state.currentPlayer).toBe(humans[1].id);
    expect(r.state.turn).toBe(1);
    const r2 = applyAction(r.state, { type: 'passTurn' });
    expect(r2.state.currentPlayer).toBe(humans[2].id);
    expect(nextHuman(r2.state)).toBeNull();
    const r3 = playEndTurn(r2.state);
    expect(r3.state.turn).toBe(2);
    expect(r3.state.currentPlayer).toBe(humans[0].id);
  });

  it('proposta entre humanos vira pendente para o outro responder', () => {
    const s = newGame({ seed: 'hot2', mapSize: 'small', civId: 'valdoria', extraHumans: ['tamaru'], rivals: 0, cityStates: 0 });
    const other = s.players.find((p) => p.isHuman && p.id !== 0)!.id;
    relation(s, 0, other).met = true;
    const r = proposeDeal(s, other, [{ type: 'openBorders' }]);
    expect(r.state.proposals).toHaveLength(1);
    const passed = applyAction(r.state, { type: 'passTurn' }).state;
    const id = passed.proposals[0].id;
    const acc = applyAction(passed, { type: 'respondProposal', id, accept: true });
    expect(acc.events.some((e) => e.type === 'agreement')).toBe(true);
  });
});
