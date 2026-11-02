import { BUILDINGS } from '../data/buildings';
import { CIV_BY_ID } from '../data/civs';
import { IMPROVEMENTS, type ImprovementId } from '../data/improvements';
import { MAP_SIZES } from '../data/mapSizes';
import { UNITS } from '../data/units';
import type { GameEvent } from '../rules/actions';
import { improvementFits } from '../rules/builders';
import { cannotProduce, cityYields, productionOptions, purchaseCost } from '../rules/cities';
import { canFoundCity, MIN_CITY_DISTANCE } from '../rules/city';
import { atWar, attackTargets, isRanged, nextRandom, previewAttack, unitRange } from '../rules/combat';
import { adjacencyBonus, districtSites, wonderSites } from '../rules/districts';
import { DISTRICT_LIST } from '../data/districts';
import { WORLD_WONDERS } from '../data/worldWonders';
import { availableGovernments, availablePolicies, canSlotPolicy, governmentSlots } from '../rules/effects';
import { distance, neighbors, tilesInRadius } from '../rules/hex';
import { scoreStart } from '../rules/mapgen';
import { canOccupy, findPath } from '../rules/movement';
import { availableItems, treeCost } from '../rules/research';
import { isPassableLand } from '../rules/tiles';
import { canEnterTerrain } from '../rules/movement';
import { availableFollowerBeliefs, availablePantheons, availableReligionNames, cannotFoundReligion, religionOf } from '../rules/religion';
import { routesOf, tradeCapacity, tradeDestinations } from '../rules/trade';
import { PANTHEON_COST } from '../data/religion';
import type { City, GameState, ProductionItem, Unit } from '../state/types';
import { act } from './common';

/**
 * IA de civilizações e cidades-estado: heurísticas simples, determinísticas e
 * baratas. Cada função recebe o estado já clonado e o altera via `act`.
 */

// ------------------------------------------------------------------ pesquisa e governo

const TECH_PREFS: Record<string, string[]> = {
  scholar: ['writing', 'pottery', 'currency', 'mathematics'],
  warmonger: ['bronze-working', 'archery', 'horseback-riding', 'mining'],
  builder: ['mining', 'masonry', 'pottery', 'wheel', 'engineering'],
  merchant: ['pottery', 'writing', 'currency', 'sailing'],
  expansionist: ['pottery', 'animal-husbandry', 'irrigation', 'mining'],
};

export function aiResearch(state: GameState, id: number, events: GameEvent[]): void {
  const p = state.players[id];
  const agenda = CIV_BY_ID[p.civId]?.agenda?.id ?? '';
  if (!p.researching) {
    const opts = availableItems(p, 'tech');
    if (opts.length) {
      const pref = TECH_PREFS[agenda] ?? [];
      const pick = [...opts].sort(
        (a, b) => treeCost(p, 'tech', a) - (pref.includes(a) ? 30 : 0) - (treeCost(p, 'tech', b) - (pref.includes(b) ? 30 : 0)),
      )[0];
      act(state, id, { type: 'setResearch', kind: 'tech', id: pick }, events);
    }
  }
  if (!p.researchingCivic) {
    const opts = availableItems(p, 'civic');
    if (opts.length) {
      const pick = [...opts].sort((a, b) => treeCost(p, 'civic', a) - treeCost(p, 'civic', b))[0];
      act(state, id, { type: 'setResearch', kind: 'civic', id: pick }, events);
    }
  }
  if (p.policyChangeAvailable) {
    const govs = availableGovernments(p);
    const want = agenda === 'warmonger' ? 'oligarchy' : agenda === 'scholar' || agenda === 'builder' ? 'classical-republic' : 'autocracy';
    if (govs.includes(want) && p.government !== want) act(state, id, { type: 'setGovernment', id: want }, events);
    const slots = governmentSlots(p.government);
    const pols = availablePolicies(p);
    slots.forEach((slot, i) => {
      if (p.policies[i]) return;
      const pick = pols.find((x) => canSlotPolicy(slot, x) && !p.policies.includes(x));
      if (pick) act(state, id, { type: 'setPolicy', slot: i, policy: pick }, events);
    });
  }
}

// ------------------------------------------------------------------ produção

function count(state: GameState, id: number, f: (u: Unit) => boolean): number {
  return state.units.filter((u) => u.owner === id && f(u)).length;
}

function bestMilitary(state: GameState, city: City): ProductionItem | null {
  const opts = productionOptions(state, city).filter(
    (o) => o.kind === 'unit' && UNITS[o.id].class === 'military' && UNITS[o.id].combat !== 'recon' && !cannotProduce(state, city, o),
  );
  if (!opts.length) return null;
  return opts.reduce((a, b) => (UNITS[b.id].strength + (UNITS[b.id].rangedStrength ?? 0) > UNITS[a.id].strength + (UNITS[a.id].rangedStrength ?? 0) ? b : a));
}

const BUILD_ORDER = [
  'monument',
  'granary',
  'walls',
  'library',
  'shrine',
  'watermill',
  'market',
  'workshop',
  'lighthouse',
  'barracks',
  'university',
  'temple',
  'amphitheater',
];

const DISTRICT_PREF: Record<string, string[]> = {
  scholar: ['campus'],
  warmonger: ['encampment', 'industrial'],
  builder: ['industrial', 'theater'],
  merchant: ['commercial', 'harbor'],
  expansionist: ['commercial', 'campus'],
};

function bestDistrict(state: GameState, city: City): ProductionItem | null {
  const agenda = CIV_BY_ID[state.players[city.owner].civId]?.agenda?.id ?? '';
  let best: ProductionItem | null = null;
  let bestScore = 0;
  for (const d of DISTRICT_LIST) {
    for (const tile of districtSites(state, city, d.id)) {
      const wantsFaith = d.id === 'holy-site' && !religionOf(state, city.owner) && availableReligionNames(state).length > 0;
      const sc =
        adjacencyBonus(state, tile, d.id) +
        (DISTRICT_PREF[agenda]?.includes(d.id) ? 2 : 0) +
        (d.id === 'campus' ? 1 : 0) +
        (wantsFaith ? 1.5 : 0) -
        tile * 1e-6;
      if (sc > bestScore) {
        bestScore = sc;
        best = { kind: 'district', id: d.id, tile };
      }
    }
  }
  return best;
}

function pickWonder(state: GameState, city: City): ProductionItem | null {
  const agenda = CIV_BY_ID[state.players[city.owner].civId]?.agenda?.id ?? '';
  if (agenda !== 'builder' && nextRandom(state) > 0.3) return null;
  for (const w of WORLD_WONDERS) {
    const sites = wonderSites(state, city, w.id);
    if (sites.length) return { kind: 'wonder', id: w.id, tile: sites[0] };
  }
  return null;
}

export function chooseProduction(state: GameState, city: City): ProductionItem | null {
  const id = city.owner;
  const p = state.players[id];
  const myCities = state.cities.filter((c) => c.owner === id).length;
  const military = count(state, id, (u) => UNITS[u.type].class === 'military');
  const atWarNow = state.players.some((o) => o.id !== id && !o.isBarbarian && atWar(state, id, o.id));
  const can = (item: ProductionItem) => !cannotProduce(state, city, item);
  const building = (b: string): ProductionItem => ({ kind: 'building', id: b });

  // projeto de vitória científica tem prioridade máxima
  const star: ProductionItem = { kind: 'project', id: 'star-expedition' };
  if (!p.isCityState && can(star)) return star;
  const festival: ProductionItem = { kind: 'project', id: 'festival' };
  if (p.isCityState) {
    if (military < 2 || (atWarNow && military < 4)) return bestMilitary(state, city);
    for (const b of ['walls', 'monument', 'granary', 'library', 'market', 'shrine', 'workshop', 'watermill', 'lighthouse'])
      if (can(building(b))) return building(b);
    return military < 6 ? bestMilitary(state, city) : festival;
  }

  if (military < myCities || (atWarNow && military < myCities * 2 + 1)) {
    const m = bestMilitary(state, city);
    if (m) return m;
  }
  const targetCities = (MAP_SIZES[state.settings.mapSize]?.continents ?? 3) + 2;
  const settlers = count(state, id, (u) => u.type === 'settler');
  const settlerItem: ProductionItem = { kind: 'unit', id: 'settler' };
  if (!atWarNow && myCities + settlers < targetCities && settlers === 0 && can(settlerItem)) return settlerItem;
  const builders = count(state, id, (u) => u.type === 'builder');
  if (builders < Math.ceil(myCities / 2) && can({ kind: 'unit', id: 'builder' })) return { kind: 'unit', id: 'builder' };
  if (count(state, id, (u) => u.type === 'scout') === 0 && state.turn < 30 && can({ kind: 'unit', id: 'scout' })) return { kind: 'unit', id: 'scout' };
  // rotas comerciais livres
  const traders = count(state, id, (u) => u.type === 'trader');
  if (routesOf(state, id).length + traders < tradeCapacity(state, id) && can({ kind: 'unit', id: 'trader' })) {
    return { kind: 'unit', id: 'trader' };
  }
  // um navio explorador por civilização
  if (count(state, id, (u) => UNITS[u.type].domain === 'sea') === 0 && can({ kind: 'unit', id: 'galley' })) {
    return { kind: 'unit', id: 'galley' };
  }
  // distritos: o de maior adjacência (com preferência da agenda)
  const district = bestDistrict(state, city);
  if (district) return district;
  // cidades produtivas tentam maravilhas antes dos edifícios tardios
  if (city.buildings.length >= 3 && cityYields(state, city).production >= 6) {
    const w = pickWonder(state, city);
    if (w) return w;
  }
  for (const b of BUILD_ORDER) {
    if (b === 'walls' && !atWarNow && city.population < 4) continue;
    if (BUILDINGS[b] && can(building(b))) return building(b);
  }
  const wonder = pickWonder(state, city);
  if (wonder) return wonder;
  if (military >= myCities * 2) return festival;
  return bestMilitary(state, city) ?? festival;
}

export function aiCities(state: GameState, id: number, events: GameEvent[]): void {
  const p = state.players[id];
  for (const c of state.cities.filter((x) => x.owner === id)) {
    if (!c.queue.length) {
      const item = chooseProduction(state, c);
      if (item) act(state, id, { type: 'setProduction', cityId: c.id, item }, events);
    }
    // usa ouro acumulado para acelerar a produção atual
    const cur = c.queue[0];
    if (cur && p.gold > 150 && purchaseCost(c, cur) <= p.gold - 60) {
      act(state, id, { type: 'purchaseItem', cityId: c.id, item: cur }, events);
    }
  }
}

// ------------------------------------------------------------------ unidades

function moveToward(state: GameState, id: number, u: Unit, target: number, events: GameEvent[], stopAdjacent = false): void {
  const res = findPath(state, u, target, { ignoreFog: true, allowEnemyGoal: true });
  if (!res) return;
  let path = res.path;
  if (stopAdjacent && path.length) path = path.slice(0, -1);
  if (!path.length) return;
  act(state, id, { type: 'move', unitId: u.id, target: path[path.length - 1] }, events);
}

function citySite(state: GameState, u: Unit): number | null {
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const i of tilesInRadius(state.map, u.pos, 8)) {
    const t = state.map.tiles[i];
    if (!isPassableLand(t) || (t.owner !== undefined && t.owner !== u.owner)) continue;
    if (state.cities.some((c) => distance(state.map, c.pos, i) < MIN_CITY_DISTANCE)) continue;
    if (state.camps.some((c) => distance(state.map, c.pos, i) < 3)) continue;
    if (state.units.some((x) => x.pos === i && x.owner !== u.owner)) continue;
    const s = scoreStart(state.map, i) - distance(state.map, u.pos, i) * 1.2;
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

function runSettler(state: GameState, id: number, u: Unit, events: GameEvent[]): void {
  const here = canFoundCity(state, u);
  const site = citySite(state, u);
  if (here.ok && (site === null || site === u.pos || scoreStart(state.map, u.pos) >= scoreStart(state.map, site) - 2)) {
    act(state, id, { type: 'foundCity', unitId: u.id }, events);
    return;
  }
  if (site !== null) moveToward(state, id, u, site, events);
  const again = state.units.find((x) => x.id === u.id);
  if (again && again.pos === site && again.movesLeft > 0 && canFoundCity(state, again).ok) {
    act(state, id, { type: 'foundCity', unitId: u.id }, events);
  }
}

function improvementFor(state: GameState, id: number, tile: number): ImprovementId | null {
  const t = state.map.tiles[tile];
  if (t.improvement || state.cities.some((c) => c.pos === tile)) return null;
  const techs = state.players[id].techs;
  for (const imp of Object.keys(IMPROVEMENTS) as ImprovementId[]) {
    const req = IMPROVEMENTS[imp].requiresTech;
    if (req && !techs.includes(req)) continue;
    if (improvementFits(t, imp, techs)) return imp;
  }
  return null;
}

function runBuilder(state: GameState, id: number, u: Unit, events: GameEvent[]): void {
  const here = state.map.tiles[u.pos].owner === id ? improvementFor(state, id, u.pos) : null;
  if (here) {
    act(state, id, { type: 'buildImprovement', unitId: u.id, improvement: here }, events);
    return;
  }
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const i of tilesInRadius(state.map, u.pos, 6)) {
    if (state.map.tiles[i].owner !== id) continue;
    if (state.units.some((x) => x.pos === i && x.id !== u.id && UNITS[x.type].class === 'civilian')) continue;
    if (!improvementFor(state, id, i)) continue;
    const worked = state.cities.some((c) => c.worked.includes(i));
    const s = (state.map.tiles[i].resource ? 3 : 0) + (worked ? 2 : 0) - distance(state.map, u.pos, i);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  if (best !== null) moveToward(state, id, u, best, events);
  else act(state, id, { type: 'skipUnit', unitId: u.id }, events);
}

/** Alvos hostis relevantes: unidades/cidades inimigas e acampamentos perto de nós. */
function hostileTarget(state: GameState, id: number, u: Unit): number | null {
  const mine = state.cities.filter((c) => c.owner === id);
  const nearHome = (i: number, r: number) => mine.some((c) => distance(state.map, c.pos, i) <= r);
  let best: number | null = null;
  let bestD = Infinity;
  const consider = (pos: number, d: number) => {
    if (d < bestD) {
      bestD = d;
      best = pos;
    }
  };
  for (const x of state.units) {
    if (!atWar(state, id, x.owner)) continue;
    const d = distance(state.map, u.pos, x.pos);
    const barb = state.players[x.owner].isBarbarian;
    if ((barb && nearHome(x.pos, 6)) || (!barb && d <= 10)) consider(x.pos, d);
  }
  for (const c of state.cities) {
    if (!atWar(state, id, c.owner)) continue;
    consider(c.pos, distance(state.map, u.pos, c.pos) + 2);
  }
  for (const camp of state.camps) {
    if (nearHome(camp.pos, 8)) consider(camp.pos, distance(state.map, u.pos, camp.pos) + 1);
  }
  return best;
}

function tryAttackBest(state: GameState, id: number, u: Unit, events: GameEvent[]): boolean {
  const targets = attackTargets(state, u);
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const t of targets) {
    const p = previewAttack(state, u, t);
    if (!p) continue;
    if (!p.ranged && p.damageToAttacker >= u.hp - 5) continue; // evita suicídio
    const s = p.damageToTarget - p.damageToAttacker * 0.7 + (p.defenseStrength === 0 ? 50 : 0);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  if (best === null || bestScore < 0) return false;
  return act(state, id, { type: 'attack', unitId: u.id, target: best }, events);
}

function exploreTarget(state: GameState, id: number, u: Unit): number | null {
  const ex = state.players[id].explored;
  let best: number | null = null;
  let bestD = Infinity;
  for (const i of tilesInRadius(state.map, u.pos, 10)) {
    if (ex[i] || !canEnterTerrain(state, u, i)) continue;
    // fronteira: inexplorado vizinho de explorado
    if (!neighbors(state.map, i).some((n) => n >= 0 && ex[n])) continue;
    const d = distance(state.map, u.pos, i);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function runMilitary(state: GameState, id: number, u: Unit, events: GameEvent[]): void {
  const def = UNITS[u.type];
  const home = state.cities.filter((c) => c.owner === id);
  // ferido: recua para a cidade mais próxima
  if (u.hp < 40 && home.length) {
    const near = home.reduce((a, b) => (distance(state.map, u.pos, b.pos) < distance(state.map, u.pos, a.pos) ? b : a));
    if (near.pos !== u.pos) moveToward(state, id, u, near.pos, events);
    else act(state, id, { type: 'fortify', unitId: u.id }, events);
    return;
  }
  if (tryAttackBest(state, id, u, events)) return;
  const target = hostileTarget(state, id, u);
  if (target !== null && def.combat !== 'recon') {
    const ranged = isRanged(u);
    if (!ranged || distance(state.map, u.pos, target) > unitRange(u)) moveToward(state, id, u, target, events, true);
    const again = state.units.find((x) => x.id === u.id);
    if (again && again.movesLeft > 0) tryAttackBest(state, id, again, events);
    return;
  }
  if (def.combat === 'recon') {
    const t = exploreTarget(state, id, u);
    if (t !== null) {
      moveToward(state, id, u, t, events);
      return;
    }
  }
  // guarnição: cidades sem unidade militar
  const empty = home.filter((c) => !state.units.some((x) => x.pos === c.pos && x.owner === id && UNITS[x.type].class === 'military'));
  if (empty.length && !home.some((c) => c.pos === u.pos)) {
    const c = empty.reduce((a, b) => (distance(state.map, u.pos, b.pos) < distance(state.map, u.pos, a.pos) ? b : a));
    if (canOccupy(state, u, c.pos)) {
      moveToward(state, id, u, c.pos, events);
      return;
    }
  }
  if (!u.fortified) act(state, id, { type: 'fortify', unitId: u.id }, events);
}

export function aiUnits(state: GameState, id: number, events: GameEvent[]): void {
  const ids = state.units.filter((u) => u.owner === id).map((u) => u.id);
  for (const uid of ids) {
    const u = state.units.find((x) => x.id === uid);
    if (!u || u.movesLeft <= 0) continue;
    if (u.path?.length) continue; // rota em andamento
    const def = UNITS[u.type];
    if (def.canFoundCity) runSettler(state, id, u, events);
    else if (def.charges) runBuilder(state, id, u, events);
    else if (def.trader) runTrader(state, id, u, events);
    else if (def.spreads) runMissionary(state, id, u, events);
    else if (def.greatPerson) runGreatPerson(state, id, u, events);
    else if (def.domain === 'sea') runNaval(state, id, u, events);
    else if (def.class === 'military') runMilitary(state, id, u, events);
  }
}

function nearestOwnCity(state: GameState, id: number, u: Unit, f: (c: City) => boolean = () => true): City | undefined {
  const cs = state.cities.filter((c) => c.owner === id && f(c));
  if (!cs.length) return undefined;
  return cs.reduce((a, b) => (distance(state.map, u.pos, b.pos) < distance(state.map, u.pos, a.pos) ? b : a));
}

function runTrader(state: GameState, id: number, u: Unit, events: GameEvent[]): void {
  const dests = tradeDestinations(state, u);
  if (dests.length) {
    const origin = state.cities.find((c) => c.pos === u.pos)!;
    const score = (c: City) => (c.owner !== id ? 10 + c.districts.length : 3) - distance(state.map, origin.pos, c.pos) * 0.1;
    const best = dests.reduce((a, b) => (score(b) > score(a) ? b : a));
    if (act(state, id, { type: 'establishRoute', unitId: u.id, cityId: best.id }, events)) return;
  }
  const home = nearestOwnCity(state, id, u, (c) => c.pos !== u.pos);
  if (home) moveToward(state, id, u, home.pos, events);
}

function runMissionary(state: GameState, id: number, u: Unit, events: GameEvent[]): void {
  const targets = state.cities.filter((c) => c.religion !== u.religion && distance(state.map, u.pos, c.pos) <= 12);
  if (!targets.length) return;
  const t = targets.reduce((a, b) => (distance(state.map, u.pos, b.pos) < distance(state.map, u.pos, a.pos) ? b : a));
  if (distance(state.map, u.pos, t.pos) <= 1) {
    act(state, id, { type: 'spreadReligion', unitId: u.id, cityId: t.id }, events);
    return;
  }
  moveToward(state, id, u, t.pos, events, true);
  const again = state.units.find((x) => x.id === u.id);
  if (again && again.movesLeft > 0 && distance(state.map, again.pos, t.pos) <= 1) {
    act(state, id, { type: 'spreadReligion', unitId: u.id, cityId: t.id }, events);
  }
}

function runGreatPerson(state: GameState, id: number, u: Unit, events: GameEvent[]): void {
  const t = UNITS[u.type].greatPerson;
  if (t === 'prophet') {
    if (!cannotFoundReligion(state, u)) {
      const name = availableReligionNames(state)[0];
      const follower = availableFollowerBeliefs(state)[0];
      if (name && follower) act(state, id, { type: 'foundReligion', unitId: u.id, religion: name, follower }, events);
      return;
    }
    const holy = nearestOwnCity(state, id, u, (c) => c.districts.some((d) => d.type === 'holy-site'));
    if (holy && holy.pos !== u.pos) moveToward(state, id, u, holy.pos, events);
    return;
  }
  if (t === 'engineer') {
    const here = state.cities.find((c) => c.pos === u.pos && c.owner === id && c.queue.length);
    if (here) {
      act(state, id, { type: 'activateGreatPerson', unitId: u.id }, events);
      return;
    }
    const cap = nearestOwnCity(state, id, u, (c) => c.queue.length > 0);
    if (cap) moveToward(state, id, u, cap.pos, events);
    return;
  }
  act(state, id, { type: 'activateGreatPerson', unitId: u.id }, events);
}

function runNaval(state: GameState, id: number, u: Unit, events: GameEvent[]): void {
  if (tryAttackBest(state, id, u, events)) return;
  const t = exploreTarget(state, id, u);
  if (t !== null) moveToward(state, id, u, t, events);
  else if (!u.fortified) act(state, id, { type: 'fortify', unitId: u.id }, events);
}

/** Fé: panteão e missionários. */
export function aiFaith(state: GameState, id: number, events: GameEvent[]): void {
  const p = state.players[id];
  if (p.isCityState) return;
  if (!p.pantheon && p.faith >= PANTHEON_COST) {
    const opts = availablePantheons(state);
    if (opts.length) act(state, id, { type: 'choosePantheon', belief: opts[0] }, events);
  }
  const rel = religionOf(state, id);
  const missionaries = count(state, id, (u) => u.type === 'missionary');
  if (rel && missionaries < 2 && p.faith >= (UNITS.missionary.faithCost ?? 80) + 20) {
    const city = state.cities.find((c) => c.owner === id && c.religion === rel.id);
    if (city) act(state, id, { type: 'buyWithFaith', cityId: city.id, unit: 'missionary' }, events);
  }
}

/** Turno completo de uma IA (civilização ou cidade-estado). */
export function runAiPlayer(state: GameState, id: number, events: GameEvent[]): void {
  aiResearch(state, id, events);
  aiFaith(state, id, events);
  aiUnits(state, id, events);
  aiCities(state, id, events);
}
