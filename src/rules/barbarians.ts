import { MAP_SIZES } from '../data/mapSizes';
import { UNITS } from '../data/units';
import type { GameState, Unit } from '../state/types';
import { canPillage, pillage } from './builders';
import { attackTargets, barbarianId, nextRandom, resolveAttack, type CombatEvent } from './combat';
import { distance, neighbors, tilesInRadius } from './hex';
import { canOccupy, findPath, maxMoves, moveOneStep } from './movement';
import { isPassableLand } from './tiles';
import { computeVisibility } from './visibility';

/**
 * Bárbaros: acampamentos que geram unidades e um comportamento simples e
 * determinístico (parte das regras, não da IA de civilizações em src/ai).
 */

export const CAMP_MIN_DIST_FROM_CITY = 7;
export const CAMP_MAX_UNITS = 3;
export const CAMP_SPAWN_TURNS = [7, 11] as const;
export const NEW_CAMP_EVERY = 20;
export const BARBARIAN_AGGRO_RADIUS = 6;

export function maxCamps(state: GameState): number {
  const size = MAP_SIZES[state.settings.mapSize];
  return size ? size.continents + 1 : 3;
}

function randInt(state: GameState, lo: number, hi: number): number {
  return lo + Math.floor(nextRandom(state) * (hi - lo + 1));
}

/** Hexágonos válidos para um acampamento novo (fora da vista dos jogadores). */
export function campSites(state: GameState, avoid: number[] = []): number[] {
  const seen = new Uint8Array(state.map.tiles.length);
  for (const p of state.players) {
    if (p.isBarbarian) continue;
    const v = computeVisibility(state, p.id);
    for (let i = 0; i < v.length; i++) if (v[i]) seen[i] = 1;
  }
  const out: number[] = [];
  for (let i = 0; i < state.map.tiles.length; i++) {
    const t = state.map.tiles[i];
    if (!isPassableLand(t) || t.wonder || t.owner !== undefined || seen[i]) continue;
    if (state.units.some((u) => u.pos === i)) continue;
    if (state.cities.some((c) => distance(state.map, c.pos, i) < CAMP_MIN_DIST_FROM_CITY)) continue;
    if (avoid.some((a) => distance(state.map, a, i) < CAMP_MIN_DIST_FROM_CITY)) continue;
    if (state.camps.some((c) => distance(state.map, c.pos, i) < 6)) continue;
    out.push(i);
  }
  return out;
}

export function spawnCamp(state: GameState, avoid: number[] = []): number | null {
  const sites = campSites(state, avoid);
  if (!sites.length) return null;
  const pos = sites[Math.floor(nextRandom(state) * sites.length)];
  state.camps.push({ id: state.nextId++, pos, spawnTimer: randInt(state, 2, 5) });
  return pos;
}

/** Tipo de unidade gerada conforme a era (turno). */
function spawnType(state: GameState): string {
  if (state.turn >= 60) return nextRandom(state) < 0.5 ? 'swordsman' : 'horseman';
  if (state.turn >= 30) return nextRandom(state) < 0.5 ? 'archer' : 'spearman';
  return nextRandom(state) < 0.25 ? 'slinger' : 'barbarian-raider';
}

function spawnUnits(state: GameState, bid: number): void {
  for (const camp of state.camps) {
    camp.spawnTimer--;
    if (camp.spawnTimer > 0) continue;
    camp.spawnTimer = randInt(state, CAMP_SPAWN_TURNS[0], CAMP_SPAWN_TURNS[1]);
    if (state.units.filter((u) => u.campId === camp.id).length >= CAMP_MAX_UNITS) continue;
    const type = spawnType(state);
    const spots = [camp.pos, ...neighbors(state.map, camp.pos)].filter(
      (i) => i >= 0 && isPassableLand(state.map.tiles[i]) && !state.units.some((u) => u.pos === i) && !state.cities.some((c) => c.pos === i),
    );
    if (!spots.length) continue;
    state.units.push({
      id: state.nextId++,
      type,
      owner: bid,
      pos: spots[0],
      movesLeft: 0,
      hp: 100,
      xp: 0,
      promotions: [],
      campId: camp.id,
    });
  }
}

/** Alvos de interesse: unidades e cidades de jogadores. */
function nearestTarget(state: GameState, u: Unit): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const x of state.units) {
    if (x.owner === u.owner) continue;
    const d = distance(state.map, u.pos, x.pos);
    if (d < bestD && d <= BARBARIAN_AGGRO_RADIUS) {
      bestD = d;
      best = x.pos;
    }
  }
  for (const c of state.cities) {
    const d = distance(state.map, u.pos, c.pos);
    if (d < bestD && d <= BARBARIAN_AGGRO_RADIUS + 2) {
      bestD = d;
      best = c.pos;
    }
  }
  return best;
}

function tryAttack(state: GameState, u: Unit, events: CombatEvent[]): boolean {
  const targets = attackTargets(state, u);
  if (!targets.length) return false;
  // prefere civis (captura) e depois o alvo mais ferido
  const score = (i: number) => {
    const xs = state.units.filter((x) => x.pos === i && x.owner !== u.owner);
    if (xs.length && xs.every((x) => UNITS[x.type].class === 'civilian')) return -1000;
    const city = state.cities.find((c) => c.pos === i);
    if (city) return 500 + city.hp;
    return Math.min(...xs.map((x) => x.hp));
  };
  const target = targets.reduce((a, b) => (score(b) < score(a) ? b : a));
  events.push(...resolveAttack(state, u, target));
  return true;
}

function unitTurn(state: GameState, u: Unit, events: CombatEvent[]): void {
  u.movesLeft = maxMoves(state, u);
  if (UNITS[u.type].class !== 'military') return;
  if (tryAttack(state, u, events)) return;
  // sem alvo ao alcance: saqueia a melhoria em que está
  if (canPillage(state, u).ok) {
    pillage(state, u);
    return;
  }
  const target = nearestTarget(state, u);
  if (target !== null) {
    // aproxima-se até ficar em alcance/adjacente
    const ranged = !!UNITS[u.type].rangedStrength;
    const goal = ranged ? target : target;
    const res = findPath(state, u, goal, { ignoreFog: true, allowEnemyGoal: true });
    if (res) {
      for (const step of res.path) {
        if (u.movesLeft <= 0) break;
        if (step === target) break;
        if (ranged && distance(state.map, u.pos, target) <= (UNITS[u.type].range ?? 1)) break;
        if (!moveOneStep(state, u, step)) break;
        u.acted = true;
      }
    }
    if (u.movesLeft > 0 && state.units.includes(u) && !tryAttack(state, u, events) && canPillage(state, u).ok) pillage(state, u);
    return;
  }
  // saqueia a melhoria em que está
  if (canPillage(state, u).ok) {
    pillage(state, u);
    return;
  }
  // vagueia perto do acampamento
  const camp = state.camps.find((c) => c.id === u.campId);
  const home = camp?.pos ?? u.pos;
  const options = tilesInRadius(state.map, u.pos, 1).filter(
    (i) => i !== u.pos && distance(state.map, home, i) <= 3 && canOccupy(state, u, i),
  );
  if (options.length && nextRandom(state) < 0.6) {
    const step = options[Math.floor(nextRandom(state) * options.length)];
    if (moveOneStep(state, u, step)) u.acted = true;
  }
}

/** Turno dos bárbaros (muta). */
export function runBarbarianTurn(state: GameState): CombatEvent[] {
  const bid = barbarianId(state);
  if (bid < 0) return [];
  const events: CombatEvent[] = [];
  for (const u of state.units.filter((x) => x.owner === bid)) {
    if (!state.units.includes(u)) continue; // morreu nesta rodada
    unitTurn(state, u, events);
  }
  spawnUnits(state, bid);
  if (state.turn % NEW_CAMP_EVERY === 0 && state.camps.length < maxCamps(state)) spawnCamp(state);
  return events;
}
