import { describe, expect, it } from 'vitest';
import { CIVICS } from '../src/data/civics';
import { TECHS } from '../src/data/techs';
import { endTurn } from '../src/rules/actions';
import { cannotProduce, processCity } from '../src/rules/cities';
import { foundCity } from '../src/rules/city';
import { makePlayer, newGame } from '../src/rules/game';
import {
  checkVictory,
  cultureProgress,
  dominationProgress,
  playerEra,
  religionProgress,
  scoreOf,
} from '../src/rules/victory';
import { deserialize, serialize } from '../src/state/save';
import type { GameState, Unit } from '../src/state/types';
import { flatGame } from './helpers';

const W = 16;
const at = (c: number, r: number) => r * W + c;

/** Humano (0), bárbaros (1) e rival (2), cada um com a capital. */
function setup() {
  const s = flatGame(W, 12);
  s.players.push(makePlayer(2, 'norvhal', s.map.tiles.length));
  const mk = (id: number, type: string, owner: number, pos: number): Unit => {
    const u: Unit = { id, type, owner, pos, movesLeft: 2, hp: 100, xp: 0, promotions: [] };
    s.units.push(u);
    return u;
  };
  const mine = foundCity(s, mk(100, 'settler', 0, at(3, 5)));
  const theirs = foundCity(s, mk(101, 'settler', 2, at(12, 5)));
  return { s, mine, theirs, mk };
}

describe('pontuação e eras', () => {
  it('pontuação soma cidades, população, tecnologias, maravilhas…', () => {
    const { s, mine } = setup();
    const base = scoreOf(s, 0).total;
    s.players[0].techs.push('pottery');
    mine.wonders.push('sahrun-pyramids');
    expect(scoreOf(s, 0).total).toBe(base + 3 + 15);
  });

  it('era avança com tecnologias mais caras', () => {
    const { s } = setup();
    expect(playerEra(s, 0).name).toBe('Era Antiga');
    s.players[0].techs.push('currency');
    expect(playerEra(s, 0).name).toBe('Era Clássica');
    s.players[0].techs.push('engineering');
    expect(playerEra(s, 0).name).toBe('Era Medieval');
  });
});

describe('vitórias', () => {
  it('dominação: controlar todas as capitais originais', () => {
    const { s, theirs } = setup();
    expect(dominationProgress(s, 0)).toEqual({ held: 1, total: 2 });
    expect(checkVictory(s)).toBeNull();
    theirs.owner = 0;
    expect(checkVictory(s)).toMatchObject({ player: 0, type: 'domination' });
  });

  it('científica: Expedição Celeste exige todas as tecnologias', () => {
    const { s, mine } = setup();
    expect(cannotProduce(s, mine, { kind: 'project', id: 'star-expedition' })).toMatch(/todas/);
    s.players[0].techs = TECHS.map((t) => t.id);
    expect(cannotProduce(s, mine, { kind: 'project', id: 'star-expedition' })).toBeNull();
    mine.queue = [{ kind: 'project', id: 'star-expedition' }];
    mine.progress['project:star-expedition'] = 9999;
    processCity(s, mine);
    expect(s.winner).toMatchObject({ player: 0, type: 'science' });
  });

  it('cultural: todas as cívicas e o dobro da cultura dos rivais', () => {
    const { s } = setup();
    s.players[0].civics = CIVICS.map((c) => c.id);
    s.players[0].lifetimeCulture = 1200;
    s.players[2].lifetimeCulture = 700;
    expect(checkVictory(s)).toBeNull();
    s.players[2].lifetimeCulture = 500;
    expect(cultureProgress(s, 0).culture).toBe(1200);
    expect(checkVictory(s)).toMatchObject({ player: 0, type: 'culture' });
  });

  it('religiosa: maioria das cidades de cada civilização', () => {
    const { s, mine, theirs } = setup();
    s.religions.push({ id: 'aurorism', founder: 0, holyCityId: mine.id, follower: 'monasteries' });
    mine.religion = 'aurorism';
    expect(religionProgress(s, 0)).toEqual({ majority: 1, total: 2 });
    expect(checkVictory(s)).toBeNull();
    theirs.religion = 'aurorism';
    expect(checkVictory(s)).toMatchObject({ player: 0, type: 'religion' });
  });

  it('pontuação no turno final, com evento de vitória', () => {
    const { s } = setup();
    s.settings.turnLimit = 5;
    s.turn = 4;
    s.players[2].techs.push('pottery', 'mining');
    const ev = endTurn(s);
    expect(s.winner).toMatchObject({ player: 2, type: 'score' });
    expect(ev.some((e) => e.type === 'victory')).toBe(true);
  });

  it('sem rivais não há vitória por dominação', () => {
    const s: GameState = flatGame(W, 12);
    const u: Unit = { id: 1, type: 'settler', owner: 0, pos: at(5, 5), movesLeft: 2, hp: 100, xp: 0, promotions: [] };
    s.units.push(u);
    foundCity(s, u);
    expect(checkVictory(s)).toBeNull();
  });
});

describe('projetos', () => {
  it('festival dá ouro e cultura e é repetível', () => {
    const { s, mine } = setup();
    const g = s.players[0].gold;
    mine.queue = [{ kind: 'project', id: 'festival' }];
    mine.progress['project:festival'] = 9999;
    processCity(s, mine);
    expect(s.players[0].gold).toBeGreaterThanOrEqual(g + 60);
    expect(s.players[0].lifetimeCulture).toBeGreaterThanOrEqual(30);
    expect(cannotProduce(s, mine, { kind: 'project', id: 'festival' })).toBeNull();
  });
});

describe('migração v7 → v8', () => {
  it('adiciona limite de turnos, cultura acumulada e capitais originais', () => {
    const s = newGame({ seed: 'm8', mapSize: 'small', civId: 'valdoria', rivals: 0, cityStates: 0 });
    const u = s.units.find((x) => x.type === 'settler')!;
    foundCity(s, u);
    const env: any = JSON.parse(serialize(s));
    env.version = 7;
    env.state.schemaVersion = 7;
    delete env.state.settings.turnLimit;
    for (const p of env.state.players) delete p.lifetimeCulture;
    for (const c of env.state.cities) delete c.originalCapitalOf;
    const loaded = deserialize(JSON.stringify(env));
    expect(loaded.settings.turnLimit).toBe(250);
    expect(loaded.players[0].lifetimeCulture).toBe(0);
    expect(loaded.cities[0].originalCapitalOf).toBe(0);
  });
});
