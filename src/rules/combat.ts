import { FEATURES } from '../data/features';
import { PROMOTION_BY_ID, PROMOTION_XP, PROMOTIONS, type PromotionDef } from '../data/promotions';
import { HILLS } from '../data/terrains';
import { UNITS, type UnitDef } from '../data/units';
import type { City, GameState, Unit } from '../state/types';
import { assignCitizens } from './cities';
import { directionTo, distance, neighbors, tilesInRadius } from './hex';
import { isAtWar } from './diplomacy';
import { modifiersFor } from './effects';
import { createRng } from './rng';
import { canEnterTerrain } from './movement';
import { isWater, riverOnEdge } from './tiles';
import { computeVisibility } from './visibility';

/**
 * Combate (inspirado no modelo de força/dano exponencial):
 *   dano = 30 · e^((F_atacante − F_defensor) / 25) · aleatório(0,8–1,2)
 * Vida: unidades 100, cidades 200 (+100 com muralhas). Unidades feridas perdem
 * 1 de força a cada 10 de vida perdida. Toda aleatoriedade usa `state.rngCounter`.
 */

export const UNIT_MAX_HP = 100;
export const CITY_BASE_HP = 200;
export const WALLS_HP = 100;
export const FORTIFY_BONUS = 6;
export const RIVER_ATTACK_PENALTY = 5;
export const XP_MELEE_ATTACK = 5;
export const XP_RANGED_ATTACK = 3;
export const XP_DEFEND = 3;
export const CAMP_GOLD = 25;
export const EMBARKED_STRENGTH = 10;
export const FLANK_BONUS = 2;
export const SUPPORT_BONUS = 2;

/** Unidades militares de `owner` adjacentes a `pos` (exceto `exclude`). */
export function adjacentMilitary(state: GameState, pos: number, owner: number, exclude?: number): number {
  const ns = new Set(neighbors(state.map, pos));
  return state.units.filter((x) => x.owner === owner && x.id !== exclude && ns.has(x.pos) && UNITS[x.type].class === 'military').length;
}

// ------------------------------------------------------------------ guerra

/** Estão em guerra? Bárbaros guerreiam com todos; entre civilizações vale a diplomacia. */
export function atWar(state: GameState, a: number, b: number): boolean {
  if (a === b) return false;
  if (state.players[a]?.isBarbarian || state.players[b]?.isBarbarian) return true;
  return isAtWar(state, a, b);
}

export function barbarianId(state: GameState): number {
  return state.players.findIndex((p) => p.isBarbarian);
}

// ------------------------------------------------------------------ aleatoriedade

export function nextRandom(state: GameState): number {
  const r = createRng(`${state.settings.seed}|combat|${state.rngCounter}`).next();
  state.rngCounter++;
  return r;
}

// ------------------------------------------------------------------ promoções

export function unitPromotions(u: Unit): PromotionDef[] {
  return u.promotions.map((p) => PROMOTION_BY_ID[p]).filter(Boolean);
}

function promoSum(u: Unit, key: 'attack' | 'defense' | 'vsCity' | 'range' | 'moves' | 'sight' | 'heal'): number {
  return unitPromotions(u).reduce((s, p) => s + (p[key] ?? 0), 0);
}

export function promotionMoves(u: Unit): number {
  return promoSum(u, 'moves');
}

export function promotionSight(u: Unit): number {
  return promoSum(u, 'sight');
}

export function xpForNext(u: Unit): number {
  return PROMOTION_XP[Math.min(u.promotions.length, PROMOTION_XP.length - 1)];
}

export function canPromote(u: Unit): boolean {
  const def = UNITS[u.type];
  return !!def.combat && u.promotions.length < PROMOTION_XP.length && u.xp >= xpForNext(u) && promotionOptions(u).length > 0;
}

export function promotionOptions(u: Unit): PromotionDef[] {
  const c = UNITS[u.type].combat;
  return PROMOTIONS.filter((p) => p.combat === c && !u.promotions.includes(p.id));
}

/** Promove (muta): cura 50 e encerra o turno da unidade. */
export function promote(u: Unit, promotionId: string): string | null {
  if (!canPromote(u)) return 'A unidade não pode ser promovida agora.';
  if (!promotionOptions(u).some((p) => p.id === promotionId)) return 'Promoção inválida.';
  u.promotions.push(promotionId);
  u.hp = Math.min(UNIT_MAX_HP, u.hp + 50);
  u.movesLeft = 0;
  u.acted = true;
  return null;
}

// ------------------------------------------------------------------ forças

export function unitRange(u: Unit): number {
  const def = UNITS[u.type];
  return def.range ? def.range + promoSum(u, 'range') : 0;
}

export function isRanged(u: Unit): boolean {
  return !!UNITS[u.type].rangedStrength;
}

function woundPenalty(hp: number, max: number): number {
  return Math.round(((max - hp) / max) * 10);
}

/** Modificador de terreno para quem defende no hexágono. */
export function terrainDefense(state: GameState, pos: number): number {
  const t = state.map.tiles[pos];
  let d = 0;
  if (t.hills) d += Math.round(HILLS.defense / 8); // +3
  if (t.feature) d += Math.round(FEATURES[t.feature].defense / 8); // floresta/selva +3, pântano −2
  return d;
}

export type Target = { kind: 'unit'; unit: Unit } | { kind: 'city'; city: City };

function targetCombatType(t: Target): 'city' | UnitDef['combat'] {
  return t.kind === 'city' ? 'city' : UNITS[t.unit.type].combat;
}

/** Força de ataque de uma unidade contra o alvo. */
export function attackStrength(state: GameState, u: Unit, target: Target, ranged: boolean): number {
  const def = UNITS[u.type];
  let s = ranged ? (def.rangedStrength ?? 0) : def.strength;
  s += promoSum(u, 'attack');
  const tc = targetCombatType(target);
  if (tc && def.bonusVs?.[tc]) s += def.bonusVs[tc]!;
  if (target.kind === 'city') {
    s += promoSum(u, 'vsCity');
    // unidades à distância comuns são fracas contra cidades; cerco não
    if (ranged && def.combat !== 'siege') s -= 10;
  }
  if (!ranged) {
    const tpos = target.kind === 'unit' ? target.unit.pos : target.city.pos;
    const dir = directionTo(state.map, u.pos, tpos);
    if (dir >= 0 && riverOnEdge(state.map.tiles[u.pos], dir)) s -= RIVER_ATTACK_PENALTY;
    // flanqueamento: outras unidades militares suas ao lado do alvo
    if (target.kind === 'unit') s += FLANK_BONUS * adjacentMilitary(state, tpos, u.owner, u.id);
  }
  s -= woundPenalty(u.hp, UNIT_MAX_HP);
  return Math.max(1, s);
}

/** Força de defesa de uma unidade contra um atacante. */
export function defenseStrength(state: GameState, u: Unit, attacker?: Unit): number {
  const def = UNITS[u.type];
  let s = def.strength + promoSum(u, 'defense');
  // unidade terrestre embarcada é frágil
  if (def.domain !== 'sea' && isWater(state.map.tiles[u.pos])) return Math.max(1, Math.min(s, EMBARKED_STRENGTH) - woundPenalty(u.hp, UNIT_MAX_HP));
  if (attacker) {
    const ac = UNITS[attacker.type].combat;
    if (ac && def.bonusVs?.[ac]) s += def.bonusVs[ac]!;
  }
  s += terrainDefense(state, u.pos);
  if (u.fortified) s += FORTIFY_BONUS;
  // apoio: unidades militares aliadas ao lado do defensor (só em combate real)
  if (attacker) s += SUPPORT_BONUS * adjacentMilitary(state, u.pos, u.owner, u.id);
  s -= woundPenalty(u.hp, UNIT_MAX_HP);
  return Math.max(1, s);
}

export function cityMaxHp(city: City): number {
  return CITY_BASE_HP + (city.buildings.includes('walls') ? WALLS_HP : 0);
}

/** Força da cidade: 15 + 2/pop + muralhas 8 + capital 3 + colinas, menos ferimentos. */
export function cityStrength(state: GameState, city: City): number {
  let s = 15 + 2 * city.population;
  if (city.buildings.includes('walls')) s += 8;
  if (city.isCapital) s += 3;
  if (state.map.tiles[city.pos].hills) s += 3;
  s += modifiersFor(state, city.owner).cityDefense;
  // guarnição: a melhor unidade militar na cidade reforça a defesa
  const garrison = state.units.filter((x) => x.pos === city.pos && x.owner === city.owner && UNITS[x.type].class === 'military');
  if (garrison.length) s += Math.max(...garrison.map((g) => Math.floor(UNITS[g.type].strength / 4)));
  s -= woundPenalty(city.hp, cityMaxHp(city));
  return Math.max(1, s);
}

export function canCityAttack(city: City): boolean {
  return city.buildings.includes('walls') && !city.rangedUsed;
}

export const CITY_RANGE = 2;

// ------------------------------------------------------------------ dano

export function baseDamage(diff: number): number {
  return 30 * Math.exp(diff / 25);
}

function rollDamage(state: GameState, diff: number): number {
  const r = 0.8 + 0.4 * nextRandom(state);
  return Math.max(1, Math.min(UNIT_MAX_HP, Math.round(baseDamage(diff) * r)));
}

/** Previsão (dano médio) para a UI. */
export interface CombatPreview {
  ranged: boolean;
  damageToTarget: number;
  damageToAttacker: number;
  attackStrength: number;
  defenseStrength: number;
}

export function targetAt(state: GameState, attacker: Unit, pos: number): Target | null {
  const city = state.cities.find((c) => c.pos === pos && atWar(state, attacker.owner, c.owner));
  if (city) return { kind: 'city', city };
  const enemies = state.units.filter((x) => x.pos === pos && atWar(state, attacker.owner, x.owner));
  if (!enemies.length) return null;
  const military = enemies.find((x) => UNITS[x.type].class === 'military');
  return { kind: 'unit', unit: military ?? enemies[0] };
}

/** Por que a unidade não pode atacar a posição (ou null se pode). */
export function cannotAttack(state: GameState, u: Unit, pos: number, visCache?: Uint8Array): string | null {
  const def = UNITS[u.type];
  if (def.class !== 'military') return 'Unidades civis não atacam.';
  if (u.movesLeft <= 0) return 'Sem movimentos restantes.';
  const target = targetAt(state, u, pos);
  if (!target) return 'Não há inimigo aí.';
  const vis = visCache ?? computeVisibility(state, u.owner);
  if (!vis[pos]) return 'Alvo fora de vista.';
  const d = distance(state.map, u.pos, pos);
  if (isRanged(u)) {
    if (d > unitRange(u)) return 'Fora de alcance.';
    return null;
  }
  if (d !== 1) return 'O alvo precisa estar adjacente.';
  const naval = def.domain === 'sea';
  if (!naval && isWater(state.map.tiles[u.pos])) return 'Unidades embarcadas não atacam.';
  if (!naval && isWater(state.map.tiles[pos])) return 'Só navios atacam no mar.';
  if (target.kind === 'unit' && UNITS[target.unit.type].class === 'civilian') return null;
  return null;
}

export function previewAttack(state: GameState, u: Unit, pos: number): CombatPreview | null {
  const target = targetAt(state, u, pos);
  if (!target) return null;
  const ranged = isRanged(u);
  const a = attackStrength(state, u, target, ranged);
  if (target.kind === 'unit' && UNITS[target.unit.type].class === 'civilian') {
    return { ranged, damageToTarget: 0, damageToAttacker: 0, attackStrength: a, defenseStrength: 0 };
  }
  const d = target.kind === 'city' ? cityStrength(state, target.city) : defenseStrength(state, target.unit, u);
  return {
    ranged,
    attackStrength: a,
    defenseStrength: d,
    damageToTarget: Math.min(target.kind === 'city' ? target.city.hp : target.unit.hp, Math.round(baseDamage(a - d))),
    damageToAttacker: ranged ? 0 : Math.min(u.hp, Math.round(baseDamage(d - a))),
  };
}

export type CombatEvent =
  | {
      type: 'combat';
      /** Hexágono do atacante no início do ataque (animação). */
      from: number;
      attackerOwner: number;
      attackerType: string;
      defenderOwner: number;
      targetName: string;
      damageToTarget: number;
      damageToAttacker: number;
      targetKilled: boolean;
      attackerKilled: boolean;
      pos: number;
    }
  | { type: 'captured'; by: number; from: number; unitType: string; pos: number }
  | { type: 'cityCaptured'; cityId: number; name: string; by: number }
  | { type: 'campCleared'; by: number; pos: number; gold: number }
  | { type: 'unitLost'; owner: number; unitType: string; pos: number };

function removeUnit(state: GameState, u: Unit): void {
  state.units = state.units.filter((x) => x.id !== u.id);
}

/** Captura de cidade (muta). Bárbaros não capturam cidades. */
export function captureCity(state: GameState, city: City, by: number): void {
  const oldOwner = city.owner;
  city.owner = by;
  city.population = Math.max(1, city.population - 1);
  city.isCapital = false;
  city.buildings = city.buildings.filter((b) => b !== 'palace' && b !== 'walls');
  city.queue = [];
  city.progress = {};
  city.locked = [];
  city.hp = Math.round(cityMaxHp(city) / 2);
  for (const t of state.map.tiles) if (t.cityId === city.id) t.owner = by;
  // unidades civis inimigas restantes no hexágono são capturadas
  for (const u of state.units) if (u.pos === city.pos && u.owner === oldOwner) u.owner = by;
  assignCitizens(state, city);
}

/** Entra num acampamento bárbaro com unidade militar: destrói e dá ouro. */
export function clearCampAt(state: GameState, u: Unit): CombatEvent | null {
  const camp = state.camps.find((c) => c.pos === u.pos);
  if (!camp || UNITS[u.type].class !== 'military' || state.players[u.owner].isBarbarian) return null;
  state.camps = state.camps.filter((c) => c.id !== camp.id);
  state.players[u.owner].gold += CAMP_GOLD;
  u.xp += 5;
  return { type: 'campCleared', by: u.owner, pos: u.pos, gold: CAMP_GOLD };
}

/** Resolve um ataque (muta). Valide antes com `cannotAttack`. */
export function resolveAttack(state: GameState, u: Unit, pos: number): CombatEvent[] {
  const events: CombatEvent[] = [];
  const target = targetAt(state, u, pos)!;
  const ranged = isRanged(u);
  const from = u.pos;
  u.movesLeft = 0;
  u.acted = true;
  u.fortified = false;
  delete u.path;

  // captura de civil indefeso (corpo a corpo)
  if (target.kind === 'unit' && UNITS[target.unit.type].class === 'civilian') {
    if (ranged) {
      // à distância mata o civil
      removeUnit(state, target.unit);
      events.push({ type: 'unitLost', owner: target.unit.owner, unitType: target.unit.type, pos });
      return events;
    }
    const others = state.units.filter((x) => x.pos === pos && x.id !== target.unit.id && atWar(state, u.owner, x.owner));
    if (!others.length) {
      const captured = target.unit;
      const victimOwner = captured.owner;
      if (state.players[u.owner].isBarbarian || captured.type === 'settler') {
        // bárbaros destroem; colono capturado vira construtor
        if (state.players[u.owner].isBarbarian) removeUnit(state, captured);
        else {
          captured.type = 'builder';
          captured.charges = UNITS.builder.charges;
          captured.owner = u.owner;
          captured.movesLeft = 0;
        }
      } else {
        captured.owner = u.owner;
        captured.movesLeft = 0;
        delete captured.path;
      }
      events.push({ type: 'captured', by: u.owner, from: victimOwner, unitType: captured.type, pos });
      if (canEnterTerrain(state, u, pos)) u.pos = pos;
      const camp = clearCampAt(state, u);
      if (camp) events.push(camp);
      return events;
    }
  }

  const a = attackStrength(state, u, target, ranged);
  if (target.kind === 'unit') {
    const t = target.unit;
    const d = defenseStrength(state, t, u);
    const dmgT = Math.min(t.hp, rollDamage(state, a - d));
    const dmgA = ranged ? 0 : Math.min(u.hp, rollDamage(state, d - a));
    t.hp -= dmgT;
    u.hp -= dmgA;
    u.xp += ranged ? XP_RANGED_ATTACK : XP_MELEE_ATTACK;
    if (t.hp > 0) t.xp += XP_DEFEND;
    const targetKilled = t.hp <= 0;
    const attackerKilled = u.hp <= 0;
    events.push({
      type: 'combat',
      from,
      attackerOwner: u.owner,
      attackerType: u.type,
      defenderOwner: t.owner,
      targetName: UNITS[t.type].name,
      damageToTarget: dmgT,
      damageToAttacker: dmgA,
      targetKilled,
      attackerKilled,
      pos,
    });
    if (targetKilled) removeUnit(state, t);
    if (attackerKilled) removeUnit(state, u);
    if (targetKilled && !attackerKilled && !ranged) {
      // avança se o hexágono ficou livre de inimigos militares
      const enemyLeft = state.units.some((x) => x.pos === pos && atWar(state, u.owner, x.owner));
      const city = state.cities.find((c) => c.pos === pos);
      if (!enemyLeft && !city && canEnterTerrain(state, u, pos)) {
        // civis inimigos restantes são capturados
        for (const x of state.units.filter((x) => x.pos === pos && x.owner === t.owner)) {
          if (state.players[u.owner].isBarbarian) removeUnit(state, x);
          else x.owner = u.owner;
        }
        u.pos = pos;
        const camp = clearCampAt(state, u);
        if (camp) events.push(camp);
      }
    }
    return events;
  }

  // alvo: cidade
  const city = target.city;
  const d = cityStrength(state, city);
  const dmgC = Math.min(city.hp, rollDamage(state, a - d));
  const dmgA = ranged ? 0 : Math.min(u.hp, rollDamage(state, d - a));
  city.hp -= dmgC;
  u.hp -= dmgA;
  u.xp += ranged ? XP_RANGED_ATTACK : XP_MELEE_ATTACK;
  const attackerKilled = u.hp <= 0;
  events.push({
    type: 'combat',
    from,
    attackerOwner: u.owner,
    attackerType: u.type,
    defenderOwner: city.owner,
    targetName: city.name,
    damageToTarget: dmgC,
    damageToAttacker: dmgA,
    targetKilled: false,
    attackerKilled,
    pos,
  });
  if (attackerKilled) {
    removeUnit(state, u);
    return events;
  }
  if (city.hp <= 0) {
    city.hp = 0;
    if (!ranged && !state.players[u.owner].isBarbarian) {
      // derrota a guarnição e captura
      for (const g of state.units.filter((x) => x.pos === city.pos && x.owner === city.owner && UNITS[x.type].class === 'military')) {
        removeUnit(state, g);
      }
      captureCity(state, city, u.owner);
      u.pos = city.pos;
      events.push({ type: 'cityCaptured', cityId: city.id, name: city.name, by: u.owner });
    }
  }
  return events;
}

/** Ataque à distância de uma cidade com muralhas (muta). */
export function cityAttack(state: GameState, city: City, pos: number): string | CombatEvent[] {
  if (!canCityAttack(city)) return city.buildings.includes('walls') ? 'A cidade já atacou neste turno.' : 'Exige Muralhas.';
  if (distance(state.map, city.pos, pos) > CITY_RANGE) return 'Fora de alcance.';
  const enemy = state.units.find((x) => x.pos === pos && atWar(state, city.owner, x.owner) && UNITS[x.type].class === 'military');
  if (!enemy) return 'Não há unidade inimiga aí.';
  const a = cityStrength(state, city);
  const d = defenseStrength(state, enemy);
  const dmg = Math.min(enemy.hp, rollDamage(state, a - d));
  enemy.hp -= dmg;
  city.rangedUsed = true;
  const killed = enemy.hp <= 0;
  if (killed) removeUnit(state, enemy);
  return [
    {
      type: 'combat',
      from: city.pos,
      attackerOwner: city.owner,
      attackerType: 'city',
      defenderOwner: enemy.owner,
      targetName: UNITS[enemy.type].name,
      damageToTarget: dmg,
      damageToAttacker: 0,
      targetKilled: killed,
      attackerKilled: false,
      pos,
    },
  ];
}

export function cityAttackTargets(state: GameState, city: City): number[] {
  if (!canCityAttack(city)) return [];
  const vis = computeVisibility(state, city.owner);
  return tilesInRadius(state.map, city.pos, CITY_RANGE).filter(
    (i) => vis[i] && state.units.some((x) => x.pos === i && atWar(state, city.owner, x.owner) && UNITS[x.type].class === 'military'),
  );
}

export function attackTargets(state: GameState, u: Unit): number[] {
  if (UNITS[u.type].class !== 'military' || u.movesLeft <= 0) return [];
  const r = isRanged(u) ? unitRange(u) : 1;
  const cand = tilesInRadius(state.map, u.pos, r).filter((i) => i !== u.pos && targetAt(state, u, i));
  if (!cand.length) return [];
  const vis = computeVisibility(state, u.owner);
  return cand.filter((i) => cannotAttack(state, u, i, vis) === null);
}

// ------------------------------------------------------------------ zona de controle

/** Hexágonos sob ZOC de unidades militares inimigas de `owner`. */
export function enemyZoc(state: GameState, owner: number): Set<number> {
  const z = new Set<number>();
  for (const u of state.units) {
    if (!atWar(state, owner, u.owner) || UNITS[u.type].class !== 'military') continue;
    for (const n of neighbors(state.map, u.pos)) if (n >= 0) z.add(n);
  }
  for (const c of state.cities) {
    if (!atWar(state, owner, c.owner)) continue;
    for (const n of neighbors(state.map, c.pos)) if (n >= 0) z.add(n);
  }
  return z;
}

// ------------------------------------------------------------------ cura

/** Cura no fim do turno para quem não agiu (muta). */
export function healUnits(state: GameState): void {
  for (const u of state.units) {
    if (!u.acted && u.hp < UNIT_MAX_HP) {
      const t = state.map.tiles[u.pos];
      let heal = 10;
      if (state.cities.some((c) => c.pos === u.pos && c.owner === u.owner)) heal = 25;
      else if (t.owner === u.owner) heal = 20;
      else if (t.owner !== undefined && atWar(state, u.owner, t.owner)) heal = 5;
      heal += promoSum(u, 'heal');
      u.hp = Math.min(UNIT_MAX_HP, u.hp + heal);
    }
    u.acted = false;
  }
  for (const c of state.cities) {
    c.hp = Math.min(cityMaxHp(c), c.hp + 20);
    c.rangedUsed = false;
  }
}
