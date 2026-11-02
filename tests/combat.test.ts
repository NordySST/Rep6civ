import { describe, expect, it } from 'vitest';
import { applyAction, endTurn } from '../src/rules/actions';
import { campSites, runBarbarianTurn, spawnCamp } from '../src/rules/barbarians';
import { cannotProduce, ownsResource } from '../src/rules/cities';
import { foundCity } from '../src/rules/city';
import {
  attackStrength,
  baseDamage,
  canPromote,
  cityMaxHp,
  cityStrength,
  defenseStrength,
  enemyZoc,
  healUnits,
  previewAttack,
  resolveAttack,
  unitRange,
} from '../src/rules/combat';
import { newGame } from '../src/rules/game';
import { neighbor } from '../src/rules/hex';
import { maxMoves, stepCost } from '../src/rules/movement';
import { deserialize, serialize } from '../src/state/save';
import type { GameState, Unit } from '../src/state/types';
import { flatGame } from './helpers';

const W = 16;
const at = (col: number, row: number) => row * W + col;

function mk(s: GameState, id: number, type: string, owner: number, pos: number, extra: Partial<Unit> = {}): Unit {
  const u: Unit = { id, type, owner, pos, movesLeft: 2, hp: 100, xp: 0, promotions: [], ...extra };
  s.units.push(u);
  return u;
}

function setup() {
  const s = flatGame(W, 12);
  // revela tudo para o jogador e os bárbaros
  for (const p of s.players) p.explored = new Array(s.map.tiles.length).fill(1);
  return s;
}
const BARB = 1;

describe('fórmula de dano', () => {
  it('30 de dano entre forças iguais e cresce com a diferença', () => {
    expect(baseDamage(0)).toBe(30);
    expect(baseDamage(10)).toBeGreaterThan(40);
    expect(baseDamage(-10)).toBeLessThan(25);
  });
});

describe('forças e modificadores', () => {
  it('terreno, fortificação e ferimentos alteram a defesa', () => {
    const s = setup();
    const d = mk(s, 2, 'warrior', BARB, at(6, 5));
    expect(defenseStrength(s, d)).toBe(20);
    s.map.tiles[d.pos].hills = true;
    expect(defenseStrength(s, d)).toBe(23);
    s.map.tiles[d.pos].feature = 'forest';
    expect(defenseStrength(s, d)).toBe(26);
    d.fortified = true;
    expect(defenseStrength(s, d)).toBe(32);
    d.hp = 50;
    expect(defenseStrength(s, d)).toBe(27);
  });

  it('atacar através de rio dá −5; lanceiro tem +10 contra cavalaria', () => {
    const s = setup();
    const a = mk(s, 1, 'warrior', 0, at(5, 5));
    const d = mk(s, 2, 'horseman', BARB, neighbor(s.map, at(5, 5), 0));
    expect(attackStrength(s, a, { kind: 'unit', unit: d }, false)).toBe(20);
    s.map.tiles[a.pos].rivers |= 1;
    expect(attackStrength(s, a, { kind: 'unit', unit: d }, false)).toBe(15);
    const sp = mk(s, 3, 'spearman', 0, at(2, 2));
    expect(defenseStrength(s, sp, d)).toBe(35);
  });
});

describe('ataques', () => {
  it('corpo a corpo: ambos sofrem dano; resultado é determinístico', () => {
    const s = setup();
    mk(s, 1, 'warrior', 0, at(5, 5));
    mk(s, 2, 'barbarian-raider', BARB, neighbor(s.map, at(5, 5), 0));
    const r1 = applyAction(s, { type: 'attack', unitId: 1, target: neighbor(s.map, at(5, 5), 0) });
    const r2 = applyAction(s, { type: 'attack', unitId: 1, target: neighbor(s.map, at(5, 5), 0) });
    expect(JSON.stringify(r1.state.units)).toBe(JSON.stringify(r2.state.units));
    const a = r1.state.units.find((u) => u.id === 1)!;
    const d = r1.state.units.find((u) => u.id === 2)!;
    expect(a.hp).toBeLessThan(100);
    expect(d.hp).toBeLessThan(100);
    expect(a.movesLeft).toBe(0);
    expect(a.xp).toBe(5);
    expect(r1.events.some((e) => e.type === 'combat')).toBe(true);
  });

  it('à distância: atacante não sofre dano e respeita o alcance', () => {
    const s = setup();
    s.players[0].techs.push('archery');
    const a = mk(s, 1, 'archer', 0, at(4, 5));
    mk(s, 2, 'barbarian-raider', BARB, at(6, 5));
    expect(unitRange(a)).toBe(2);
    const { state } = applyAction(s, { type: 'attack', unitId: 1, target: at(6, 5) });
    expect(state.units.find((u) => u.id === 1)!.hp).toBe(100);
    expect(state.units.find((u) => u.id === 2)!.hp).toBeLessThan(100);
    const far = applyAction(s, { type: 'attack', unitId: 1, target: at(9, 5) });
    expect(far.events[0].type).toBe('error');
  });

  it('matar em corpo a corpo avança para o hexágono', () => {
    const s = setup();
    const a = mk(s, 1, 'swordsman', 0, at(5, 5));
    const t = neighbor(s.map, at(5, 5), 0);
    mk(s, 2, 'barbarian-raider', BARB, t, { hp: 5 });
    resolveAttack(s, a, t);
    expect(s.units.find((u) => u.id === 2)).toBeUndefined();
    expect(a.pos).toBe(t);
  });

  it('captura civis inimigos sem combate; bárbaros destroem civis', () => {
    const s = setup();
    const a = mk(s, 1, 'warrior', BARB, at(5, 5));
    const t = neighbor(s.map, at(5, 5), 0);
    mk(s, 2, 'builder', 0, t, { charges: 3 });
    const ev = resolveAttack(s, a, t);
    expect(ev[0].type).toBe('captured');
    expect(s.units.find((u) => u.id === 2)).toBeUndefined();
    expect(a.pos).toBe(t);
  });

  it('previsão de ataque coerente com as forças', () => {
    const s = setup();
    const a = mk(s, 1, 'warrior', 0, at(5, 5));
    mk(s, 2, 'barbarian-raider', BARB, neighbor(s.map, at(5, 5), 0));
    const p = previewAttack(s, a, neighbor(s.map, at(5, 5), 0))!;
    expect(p.attackStrength).toBe(20);
    expect(p.defenseStrength).toBe(18);
    expect(p.damageToTarget).toBeGreaterThan(p.damageToAttacker);
  });
});

describe('zona de controle', () => {
  it('mover entre dois hexágonos sob ZOC inimiga consome tudo', () => {
    const s = setup();
    mk(s, 2, 'warrior', BARB, at(6, 5));
    const zoc = enemyZoc(s, 0);
    const a = neighbor(s.map, at(6, 5), 4);
    const b = neighbor(s.map, at(6, 5), 5);
    expect(zoc.has(a) && zoc.has(b)).toBe(true);
    expect(stepCost(s, a, b, zoc)).toBeGreaterThanOrEqual(99);
    expect(stepCost(s, a, b)).toBe(1);
  });
});

describe('cidades em combate', () => {
  function withCity() {
    const s = setup();
    const settler = mk(s, 50, 'settler', 0, at(6, 6));
    const city = foundCity(s, settler);
    return { s, city };
  }

  it('força e vida: muralhas dão +8 e +100 de vida', () => {
    const { s, city } = withCity();
    const base = cityStrength(s, city);
    expect(cityMaxHp(city)).toBe(200);
    city.buildings.push('walls');
    city.hp = cityMaxHp(city);
    expect(cityStrength(s, city)).toBe(base + 8);
    expect(cityMaxHp(city)).toBe(300);
  });

  it('cidade com muralhas ataca à distância uma vez por turno', () => {
    const { s, city } = withCity();
    mk(s, 2, 'barbarian-raider', BARB, at(8, 6));
    const no = applyAction(s, { type: 'cityAttack', cityId: city.id, target: at(8, 6) });
    expect(no.events[0].type).toBe('error');
    city.buildings.push('walls');
    const r = applyAction(s, { type: 'cityAttack', cityId: city.id, target: at(8, 6) });
    expect(r.state.units.find((u) => u.id === 2)!.hp).toBeLessThan(100);
    const again = applyAction(r.state, { type: 'cityAttack', cityId: city.id, target: at(8, 6) });
    expect(again.events[0].type).toBe('error');
  });

  it('cidade com vida 0 é capturada por corpo a corpo de outra civilização', () => {
    const { s, city } = withCity();
    // simula outra civilização em guerra usando o jogador bárbaro como dono da cidade
    city.owner = BARB;
    for (const t of s.map.tiles) if (t.cityId === city.id) t.owner = BARB;
    city.hp = 1;
    const a = mk(s, 1, 'swordsman', 0, neighbor(s.map, city.pos, 0));
    const ev = resolveAttack(s, a, city.pos);
    expect(ev.some((e) => e.type === 'cityCaptured')).toBe(true);
    expect(city.owner).toBe(0);
    expect(a.pos).toBe(city.pos);
    expect(city.buildings).not.toContain('palace');
  });

  it('bárbaros não capturam cidades', () => {
    const { s, city } = withCity();
    city.hp = 1;
    const a = mk(s, 1, 'barbarian-raider', BARB, neighbor(s.map, city.pos, 0));
    resolveAttack(s, a, city.pos);
    expect(city.owner).toBe(0);
  });
});

describe('cura e promoções', () => {
  it('unidades que não agiram se curam; no próprio território curam mais', () => {
    const s = setup();
    const u = mk(s, 1, 'warrior', 0, at(3, 3), { hp: 50 });
    const v = mk(s, 2, 'warrior', 0, at(9, 9), { hp: 50, acted: true });
    healUnits(s);
    expect(u.hp).toBe(60);
    expect(v.hp).toBe(50);
  });

  it('promoção exige XP, dá bônus e cura', () => {
    const s = setup();
    const u = mk(s, 1, 'scout', 0, at(3, 3), { hp: 40, xp: 14 });
    expect(canPromote(u)).toBe(false);
    u.xp = 15;
    expect(canPromote(u)).toBe(true);
    const { state } = applyAction(s, { type: 'promote', unitId: 1, promotion: 'swift' });
    const p = state.units[0];
    expect(p.promotions).toEqual(['swift']);
    expect(p.hp).toBe(90);
    expect(maxMoves(state, p)).toBe(4);
    const bad = applyAction(state, { type: 'promote', unitId: 1, promotion: 'charge' });
    expect(bad.events[0].type).toBe('error');
  });
});

describe('produção militar', () => {
  it('unidades exigem tecnologia e recurso estratégico', () => {
    const s = setup();
    const settler = mk(s, 50, 'settler', 0, at(6, 6));
    const city = foundCity(s, settler);
    expect(cannotProduce(s, city, { kind: 'unit', id: 'archer' })).toMatch(/Arquearia/);
    s.players[0].techs.push('horseback-riding', 'animal-husbandry');
    expect(cannotProduce(s, city, { kind: 'unit', id: 'horseman' })).toMatch(/Cavalos/);
    s.map.tiles[neighbor(s.map, city.pos, 0)].resource = 'horses';
    expect(ownsResource(s, 0, 'horses')).toBe(true);
    expect(cannotProduce(s, city, { kind: 'unit', id: 'horseman' })).toBeNull();
    expect(cannotProduce(s, city, { kind: 'unit', id: 'barbarian-raider' })).not.toBeNull();
  });
});

describe('bárbaros', () => {
  it('novo jogo tem jogador bárbaro e acampamentos fora da vista', () => {
    const s = newGame({ seed: 'barb', mapSize: 'small', civId: 'valdoria' });
    expect(s.players[1].isBarbarian).toBe(true);
    expect(s.camps.length).toBeGreaterThanOrEqual(1);
    for (const c of s.camps) expect(s.players[0].explored[c.pos]).toBe(0);
  });

  it('acampamento gera unidade e ela ataca alvos próximos', () => {
    const s = setup();
    s.turn = 5;
    s.camps.push({ id: 900, pos: at(10, 6), spawnTimer: 1 });
    runBarbarianTurn(s);
    const raider = s.units.find((u) => u.owner === BARB)!;
    expect(raider).toBeDefined();
    expect(raider.campId).toBe(900);
    mk(s, 1, 'warrior', 0, neighbor(s.map, raider.pos, 3));
    const ev = runBarbarianTurn(s);
    expect(ev.some((e) => e.type === 'combat')).toBe(true);
  });

  it('entrar em acampamento vazio o destrói e dá ouro', () => {
    const s = setup();
    s.camps.push({ id: 900, pos: at(7, 5), spawnTimer: 9 });
    mk(s, 1, 'warrior', 0, at(6, 5));
    const gold = s.players[0].gold;
    const { state, events } = applyAction(s, { type: 'move', unitId: 1, target: at(7, 5) });
    expect(state.camps).toHaveLength(0);
    expect(state.players[0].gold).toBe(gold + 25);
    expect(events.some((e) => e.type === 'campCleared')).toBe(true);
  });

  it('não cria acampamento à vista do jogador', () => {
    const s = setup();
    mk(s, 1, 'scout', 0, at(8, 6));
    for (const i of campSites(s)) expect(Math.abs((i % W) - 8) + Math.abs(Math.floor(i / W) - 6)).toBeGreaterThan(1);
    expect(spawnCamp(s)).not.toBeNull();
  });

  it('fim de turno roda bárbaros sem erros e é determinístico', () => {
    const a = newGame({ seed: 'det', mapSize: 'small', civId: 'valdoria' });
    const b = structuredClone(a);
    for (let i = 0; i < 25; i++) {
      endTurn(a);
      endTurn(b);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.units.some((u) => u.owner === 1)).toBe(true);
  });
});

describe('migração v3 → v4', () => {
  it('adiciona vida, XP, jogador bárbaro e acampamentos', () => {
    const s = newGame({ seed: 'mig', mapSize: 'small', civId: 'valdoria' });
    const v3: any = JSON.parse(serialize(s));
    v3.version = 3;
    v3.state.schemaVersion = 3;
    v3.state.players = v3.state.players.filter((p: any) => !p.isBarbarian);
    delete v3.state.camps;
    delete v3.state.rngCounter;
    for (const u of v3.state.units) {
      delete u.hp;
      delete u.xp;
      delete u.promotions;
    }
    const loaded = deserialize(JSON.stringify(v3));
    expect(loaded.players.some((p) => p.isBarbarian)).toBe(true);
    expect(loaded.units.every((u) => u.hp === 100 && u.xp === 0)).toBe(true);
    expect(loaded.camps).toEqual([]);
    expect(loaded.rngCounter).toBe(0);
  });
});
