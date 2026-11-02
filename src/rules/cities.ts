import { BUILDINGS, type BuildingDef } from '../data/buildings';
import { TECH_BY_ID } from '../data/techs';
import { UNITS, type UnitDef } from '../data/units';
import { addYields, emptyYields, type Yields } from '../data/yields';
import type { City, CityFocus, GameState, ProductionItem, Unit } from '../state/types';
import { distance, neighbors, tilesInRadius } from './hex';
import { modifiersFor } from './effects';
import { isPassableLand, isWater, tileYields as rawTileYields, visibleResource } from './tiles';
import type { Tile } from '../state/types';

/**
 * Gestão de cidades: rendimentos, cidadãos, crescimento, moradia, produção,
 * cultura/fronteiras e compra de hexágonos. Funções que mutam recebem um
 * estado já clonado (ver rules/actions.ts).
 */

/** Raio máximo de hexágonos trabalháveis / do território de uma cidade. */
export const CITY_WORK_RADIUS = 3;
/** Comida consumida por cidadão. */
export const FOOD_PER_POP = 2;
/** Multiplicador ouro/produção ao comprar unidades e edifícios. */
export const PURCHASE_GOLD_PER_PRODUCTION = 3;

export const FOCUS_LABELS: Record<CityFocus, string> = {
  balanced: 'Equilibrado',
  food: 'Comida',
  production: 'Produção',
  gold: 'Ouro',
};

// ------------------------------------------------------------------ rendimentos

/** Tecnologias do dono da cidade (para recursos revelados). */
function ownerTechs(state: GameState, city: City): readonly string[] {
  return state.players[city.owner]?.techs ?? [];
}

/** Rendimento de um hexágono do ponto de vista do dono da cidade. */
export function cityTileYields(state: GameState, city: City, t: Tile): Yields {
  return rawTileYields(t, ownerTechs(state, city));
}

function visibleResourceFor(state: GameState, city: City, t: Tile): string | undefined {
  return visibleResource(t, ownerTechs(state, city));
}

/** Rendimento do centro da cidade: mínimo de 2 comida e 1 produção. */
export function cityCenterYields(state: GameState, city: City): Yields {
  const t = state.map.tiles[city.pos];
  const y = rawTileYields({ ...t, feature: undefined, improvement: undefined }, ownerTechs(state, city));
  y.food = Math.max(y.food, 2);
  y.production = Math.max(y.production, 1);
  return y;
}

export function buildingYields(city: City): Yields {
  const y = emptyYields();
  for (const b of city.buildings) addYields(y, BUILDINGS[b]?.yields);
  return y;
}

/** Ciência e cultura geradas pelos cidadãos: +1 ciência a cada 2 e +1 cultura a cada 3. */
export function citizenYields(city: City): Yields {
  const y = emptyYields();
  y.science = Math.floor(city.population / 2);
  y.culture = Math.floor(city.population / 3);
  return y;
}

/**
 * Rendimento por turno: centro + hexágonos trabalhados + edifícios + cidadãos +
 * governo/políticas (bônus fixos, depois percentuais arredondados para baixo).
 */
export function cityYields(state: GameState, city: City): Yields {
  const y = cityCenterYields(state, city);
  for (const i of city.worked) addYields(y, cityTileYields(state, city, state.map.tiles[i]));
  addYields(y, buildingYields(city));
  addYields(y, citizenYields(city));
  const m = modifiersFor(state, city.owner);
  addYields(y, m.cityYields);
  if (city.isCapital) addYields(y, m.capitalYields);
  for (const k of Object.keys(y) as (keyof Yields)[]) {
    if (m.yieldPercent[k]) y[k] = Math.floor(y[k] * (1 + m.yieldPercent[k] / 100));
  }
  return y;
}

export function foodSurplus(state: GameState, city: City, yields = cityYields(state, city)): number {
  return yields.food - city.population * FOOD_PER_POP;
}

// ------------------------------------------------------------------ moradia e crescimento

export function hasFreshWater(state: GameState, city: City): boolean {
  return state.map.tiles[city.pos].rivers !== 0;
}

export function isCoastalCity(state: GameState, city: City): boolean {
  return neighbors(state.map, city.pos).some((n) => n >= 0 && isWater(state.map.tiles[n]));
}

export function cityHousing(state: GameState, city: City): number {
  let h = 2;
  if (hasFreshWater(state, city)) h += 3;
  else if (isCoastalCity(state, city)) h += 1;
  for (const b of city.buildings) h += BUILDINGS[b]?.housing ?? 0;
  return h;
}

/** Comida necessária para crescer de `pop` para `pop + 1`. */
export function growthThreshold(pop: number): number {
  const n = pop - 1;
  return Math.floor(15 + 8 * n + Math.pow(n, 1.5));
}

/** Multiplicador de crescimento pela moradia. */
export function housingGrowthModifier(pop: number, housing: number): number {
  if (pop >= housing + 4) return 0;
  if (pop >= housing) return 0.25;
  if (pop >= housing - 1) return 0.5;
  return 1;
}

/** Turnos até crescer (Infinity se não cresce). */
export function turnsToGrow(state: GameState, city: City): number {
  const surplus = foodSurplus(state, city) * housingGrowthModifier(city.population, cityHousing(state, city));
  if (surplus <= 0) return Infinity;
  return Math.max(1, Math.ceil((growthThreshold(city.population) - city.foodStored) / surplus));
}

// ------------------------------------------------------------------ cidadãos

/** Hexágonos que a cidade pode trabalhar (próprios, no raio, não centro de cidade). */
export function workableTiles(state: GameState, city: City): number[] {
  return tilesInRadius(state.map, city.pos, CITY_WORK_RADIUS).filter((i) => {
    const t = state.map.tiles[i];
    if (i === city.pos || t.cityId !== city.id) return false;
    if (state.cities.some((c) => c.pos === i)) return false;
    return true;
  });
}

function tileScore(y: Yields, focus: CityFocus, surplus: number): number {
  let food = surplus <= 0 ? 3 : surplus < 2 ? 1.6 : 1;
  let prod = 1;
  let gold = 0.5;
  if (focus === 'food') food += 1.5;
  if (focus === 'production') prod += 1.5;
  if (focus === 'gold') gold += 1.5;
  return y.food * food + y.production * prod + y.gold * gold + (y.science + y.culture + y.faith) * 0.6;
}

/**
 * Distribui os cidadãos: primeiro os hexágonos fixados, depois escolha gulosa
 * conforme o foco, priorizando comida enquanto o saldo for baixo. Muta `city`.
 */
export function assignCitizens(state: GameState, city: City): void {
  const workable = new Set(workableTiles(state, city));
  city.locked = city.locked.filter((i) => workable.has(i)).slice(0, city.population);
  const worked: number[] = [...city.locked];
  const base = cityCenterYields(state, city);
  addYields(base, buildingYields(city));
  let food = base.food;
  const ty = (i: number) => cityTileYields(state, city, state.map.tiles[i]);
  for (const i of worked) food += ty(i).food;
  const free = [...workable].filter((i) => !worked.includes(i));
  while (worked.length < city.population && free.length) {
    const surplus = food - city.population * FOOD_PER_POP;
    let best = 0;
    let bestScore = -Infinity;
    free.forEach((i, k) => {
      const s = tileScore(ty(i), city.focus, surplus) - i * 1e-9;
      if (s > bestScore) {
        bestScore = s;
        best = k;
      }
    });
    const [pick] = free.splice(best, 1);
    worked.push(pick);
    food += ty(pick).food;
  }
  city.worked = worked;
}

/** Alterna um hexágono entre trabalhado/fixado e livre. Retorna mensagem de erro, se houver. */
export function toggleWorkedTile(state: GameState, city: City, idx: number): string | null {
  if (!workableTiles(state, city).includes(idx)) return 'Este hexágono não pertence à cidade.';
  if (city.locked.includes(idx)) {
    city.locked = city.locked.filter((i) => i !== idx);
    assignCitizens(state, city);
    return null;
  }
  if (city.population === 0) return 'Sem cidadãos disponíveis.';
  // fixa o hexágono; se exceder, libera o fixado mais antigo
  city.locked.push(idx);
  if (city.locked.length > city.population) city.locked.shift();
  assignCitizens(state, city);
  return null;
}

// ------------------------------------------------------------------ produção

export function itemKey(item: ProductionItem): string {
  return `${item.kind}:${item.id}`;
}

export function itemDef(item: ProductionItem): UnitDef | BuildingDef | undefined {
  return item.kind === 'unit' ? UNITS[item.id] : BUILDINGS[item.id];
}

export function itemCost(item: ProductionItem): number {
  return itemDef(item)?.cost ?? 0;
}

export function itemName(item: ProductionItem): string {
  return itemDef(item)?.name ?? item.id;
}

/** Por que a cidade não pode produzir o item (ou null se pode). */
export function cannotProduce(state: GameState, city: City, item: ProductionItem): string | null {
  if (item.kind === 'unit') {
    const def = UNITS[item.id];
    if (!def) return 'Unidade desconhecida.';
    if (def.popCost && city.population <= def.popCost) return `Exige população ${def.popCost + 1}.`;
    return null;
  }
  const def = BUILDINGS[item.id];
  if (!def || def.auto) return 'Indisponível.';
  if (def.requiresTech && !ownerTechs(state, city).includes(def.requiresTech)) {
    return `Exige ${TECH_BY_ID[def.requiresTech]?.name ?? def.requiresTech}.`;
  }
  if (city.buildings.includes(item.id)) return 'Já construído.';
  if (def.needsRiver && !hasFreshWater(state, city)) return 'Exige rio no centro da cidade.';
  if (def.needsCoast && !isCoastalCity(state, city)) return 'Exige cidade costeira.';
  return null;
}

/** Itens listados no menu de produção (inclui bloqueados por população, para mostrar o motivo). */
export function productionOptions(state: GameState, city: City): ProductionItem[] {
  const units: ProductionItem[] = Object.keys(UNITS).map((id) => ({ kind: 'unit', id }));
  const buildings: ProductionItem[] = Object.values(BUILDINGS)
    .filter((b) => !b.auto && !city.buildings.includes(b.id))
    .filter((b) => (!b.needsRiver || hasFreshWater(state, city)) && (!b.needsCoast || isCoastalCity(state, city)))
    .map((b) => ({ kind: 'building', id: b.id }));
  return [...units, ...buildings];
}

/** Bônus percentual de produção (políticas/governo) para o item. */
export function productionBonus(state: GameState, city: City, item: ProductionItem): number {
  const m = modifiersFor(state, city.owner).productionPercent;
  let pct = m.all;
  if (item.kind === 'building') pct += m.building;
  else {
    const def = UNITS[item.id];
    if (def?.class === 'military') pct += m.military;
    if (item.id === 'settler') pct += m.settler;
    if (item.id === 'builder') pct += m.builder;
  }
  return pct;
}

export function effectiveProduction(state: GameState, city: City, item: ProductionItem, base?: number): number {
  const b = base ?? cityYields(state, city).production;
  return b * (1 + productionBonus(state, city, item) / 100);
}

export function turnsToProduce(state: GameState, city: City, item: ProductionItem): number {
  const prod = Math.max(1, effectiveProduction(state, city, item));
  const remaining = itemCost(item) - (city.progress[itemKey(item)] ?? 0);
  return Math.max(1, Math.ceil(remaining / prod));
}

export function purchaseCost(city: City, item: ProductionItem): number {
  const remaining = Math.max(0, itemCost(item) - (city.progress[itemKey(item)] ?? 0));
  return Math.ceil(remaining * PURCHASE_GOLD_PER_PRODUCTION);
}

/** Hexágono onde uma unidade nova aparece (centro ou vizinho livre). */
function spawnTile(state: GameState, city: City, def: UnitDef): number | null {
  const free = (i: number) =>
    isPassableLand(state.map.tiles[i]) &&
    !state.units.some((u) => u.pos === i && (u.owner !== city.owner || UNITS[u.type].class === def.class));
  if (free(city.pos)) return city.pos;
  for (const i of tilesInRadius(state.map, city.pos, 1)) if (free(i)) return i;
  for (const i of tilesInRadius(state.map, city.pos, 2)) if (free(i)) return i;
  return null;
}

export type CityEvent =
  | { type: 'produced'; cityId: number; item: ProductionItem; unitId?: number }
  | { type: 'grew'; cityId: number; population: number }
  | { type: 'starved'; cityId: number; population: number }
  | { type: 'borderGrew'; cityId: number; tile: number }
  | { type: 'needsProduction'; cityId: number };

/** Conclui um item (produção ou compra). Muta. Retorna o evento ou null se não foi possível. */
export function completeItem(state: GameState, city: City, item: ProductionItem): CityEvent | null {
  if (item.kind === 'unit') {
    const def = UNITS[item.id];
    const pos = spawnTile(state, city, def);
    if (pos === null) return null;
    const u: Unit = { id: state.nextId++, type: def.id, owner: city.owner, pos, movesLeft: 0 };
    if (def.charges) u.charges = def.charges + modifiersFor(state, city.owner).builderCharges;
    state.units.push(u);
    if (def.popCost) {
      city.population = Math.max(1, city.population - def.popCost);
      city.foodStored = 0;
      assignCitizens(state, city);
    }
    return { type: 'produced', cityId: city.id, item, unitId: u.id };
  }
  city.buildings.push(item.id);
  assignCitizens(state, city);
  return { type: 'produced', cityId: city.id, item };
}

export function purchaseItem(state: GameState, city: City, item: ProductionItem): string | null {
  const why = cannotProduce(state, city, item);
  if (why) return why;
  const player = state.players[city.owner];
  const cost = purchaseCost(city, item);
  if (player.gold < cost) return `Ouro insuficiente (precisa de ${cost}).`;
  const ev = completeItem(state, city, item);
  if (!ev) return 'Não há espaço para a nova unidade.';
  player.gold -= cost;
  delete city.progress[itemKey(item)];
  const k = city.queue.findIndex((q) => itemKey(q) === itemKey(item));
  if (k >= 0) city.queue.splice(k, 1);
  return null;
}

// ------------------------------------------------------------------ cultura e fronteiras

/** Cultura necessária para o próximo hexágono. */
export function borderThreshold(cultureTiles: number): number {
  return Math.floor(10 + Math.pow(6 * cultureTiles, 1.3));
}

/** Hexágonos livres adjacentes ao território da cidade, dentro do raio. */
export function expansionCandidates(state: GameState, city: City): number[] {
  const out: number[] = [];
  for (const i of tilesInRadius(state.map, city.pos, CITY_WORK_RADIUS)) {
    const t = state.map.tiles[i];
    if (t.owner !== undefined) continue;
    const adj = neighbors(state.map, i).some((n) => n >= 0 && state.map.tiles[n].cityId === city.id);
    if (adj) out.push(i);
  }
  return out;
}

export function claimTile(state: GameState, city: City, idx: number): void {
  const t = state.map.tiles[idx];
  t.owner = city.owner;
  t.cityId = city.id;
}

function expansionScore(state: GameState, city: City, i: number): number {
  const t = state.map.tiles[i];
  const y = cityTileYields(state, city, t);
  let s = y.food * 1.2 + y.production + y.gold * 0.6 + y.science + y.culture + y.faith;
  if (visibleResourceFor(state, city, t)) s += 2.5;
  if (t.wonder) s += 3;
  if (isWater(t)) s -= 0.5;
  s -= distance(state.map, city.pos, i) * 0.8;
  return s - i * 1e-9; // desempate determinístico
}

export function pickExpansionTile(state: GameState, city: City): number | null {
  const c = expansionCandidates(state, city);
  if (!c.length) return null;
  return c.reduce((best, i) => (expansionScore(state, city, i) > expansionScore(state, city, best) ? i : best));
}

export function tilePurchaseCost(state: GameState, city: City, idx: number): number {
  const d = distance(state.map, city.pos, idx);
  const owned = state.map.tiles.filter((t) => t.cityId === city.id).length;
  const t = state.map.tiles[idx];
  const base = 15 + 10 * (d - 1) + 2 * owned + (visibleResourceFor(state, city, t) ? 10 : 0) + (t.wonder ? 20 : 0);
  const discount = modifiersFor(state, city.owner).tilePurchaseDiscount;
  return Math.round(base * (1 - discount / 100));
}

export function purchaseTile(state: GameState, city: City, idx: number): string | null {
  if (!expansionCandidates(state, city).includes(idx)) return 'Este hexágono não pode ser comprado por esta cidade.';
  const cost = tilePurchaseCost(state, city, idx);
  const p = state.players[city.owner];
  if (p.gold < cost) return `Ouro insuficiente (precisa de ${cost}).`;
  p.gold -= cost;
  claimTile(state, city, idx);
  assignCitizens(state, city);
  return null;
}

// ------------------------------------------------------------------ turno da cidade

/** Processa o turno de uma cidade (muta). */
export function processCity(state: GameState, city: City): CityEvent[] {
  const events: CityEvent[] = [];
  const player = state.players[city.owner];
  if (city.worked.length !== Math.min(city.population, workableTiles(state, city).length)) assignCitizens(state, city);
  const y = cityYields(state, city);

  // comida e crescimento
  const surplus = foodSurplus(state, city, y);
  const growthPct = modifiersFor(state, city.owner).growthPercent;
  const mod = surplus > 0 ? housingGrowthModifier(city.population, cityHousing(state, city)) * (1 + growthPct / 100) : 1;
  city.foodStored += surplus * mod;
  const need = growthThreshold(city.population);
  if (city.foodStored >= need) {
    city.foodStored -= need;
    city.population++;
    assignCitizens(state, city);
    events.push({ type: 'grew', cityId: city.id, population: city.population });
  } else if (city.foodStored < 0) {
    if (city.population > 1) {
      city.population--;
      city.foodStored = growthThreshold(city.population) / 2;
      assignCitizens(state, city);
      events.push({ type: 'starved', cityId: city.id, population: city.population });
    } else city.foodStored = 0;
  }
  city.foodStored = Math.round(city.foodStored * 100) / 100;

  // produção (com excedente passando ao próximo item)
  let prod = y.production;
  while (prod > 0 && city.queue.length) {
    const item = city.queue[0];
    if (cannotProduce(state, city, item)) {
      city.queue.shift();
      continue;
    }
    const key = itemKey(item);
    const cost = itemCost(item);
    const mult = 1 + productionBonus(state, city, item) / 100;
    const have = (city.progress[key] ?? 0) + prod * mult;
    if (have >= cost) {
      const ev = completeItem(state, city, item);
      if (!ev) {
        city.progress[key] = cost; // espera espaço livre
        prod = 0;
        break;
      }
      events.push(ev);
      delete city.progress[key];
      city.queue.shift();
      prod = (have - cost) / mult;
    } else {
      city.progress[key] = have;
      prod = 0;
    }
  }
  if (!city.queue.length) events.push({ type: 'needsProduction', cityId: city.id });

  // cultura e fronteiras
  city.cultureStored += y.culture;
  const th = borderThreshold(city.cultureTiles);
  if (city.cultureStored >= th) {
    const tile = pickExpansionTile(state, city);
    if (tile !== null) {
      city.cultureStored -= th;
      city.cultureTiles++;
      claimTile(state, city, tile);
      assignCitizens(state, city);
      events.push({ type: 'borderGrew', cityId: city.id, tile });
    }
  }

  // estoques do jogador
  player.gold += y.gold;
  player.science += y.science;
  player.culture += y.culture;
  player.faith += y.faith;
  return events;
}

/** Rendimentos totais por turno do jogador (para a barra superior). */
export function playerIncome(state: GameState, playerId: number): Yields {
  const total = emptyYields();
  for (const c of state.cities) if (c.owner === playerId) addYields(total, cityYields(state, c));
  return total;
}

export function citiesNeedingProduction(state: GameState, playerId: number): City[] {
  return state.cities.filter((c) => c.owner === playerId && c.queue.length === 0);
}

/** Garante invariantes após carregar um save (ex.: cidadãos distribuídos). Muta. */
export function normalizeState(state: GameState): GameState {
  for (const c of state.cities) {
    if (c.worked.length !== Math.min(c.population, workableTiles(state, c).length)) assignCitizens(state, c);
  }
  return state;
}
