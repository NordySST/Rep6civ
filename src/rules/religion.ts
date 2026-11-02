import { FOLLOWER_BELIEFS, FOLLOWER_BY_ID, FOUNDER_GOLD_PER_CITY, PANTHEON_COST, PANTHEONS, RELIGION_NAMES } from '../data/religion';
import { UNITS } from '../data/units';
import { addYields, emptyYields, type Yields } from '../data/yields';
import type { City, GameState, Unit } from '../state/types';
import { distance } from './hex';

/**
 * Religião: panteão (fé), fundação por Grande Profeta numa cidade com Lugar
 * Sagrado, pressão religiosa entre cidades próximas, missionários (comprados com fé)
 * e efeitos (crença de seguidor nas cidades seguidoras, ouro para o fundador).
 */

export const PRESSURE_RANGE = 10;
export const MISSIONARY_PRESSURE = 100;
export const CONVERT_MIN = 40;
export const PRESSURE_DECAY = 0.95;

export type ReligionEvent =
  | { type: 'pantheon'; player: number; belief: string }
  | { type: 'religionFounded'; player: number; religion: string }
  | { type: 'cityConverted'; cityId: number; religion: string };

export function takenPantheons(state: GameState): Set<string> {
  return new Set(state.players.map((p) => p.pantheon).filter((x): x is string => !!x));
}

export function availablePantheons(state: GameState): string[] {
  const taken = takenPantheons(state);
  return PANTHEONS.filter((b) => !taken.has(b.id)).map((b) => b.id);
}

export function choosePantheon(state: GameState, playerId: number, belief: string): string | null {
  const p = state.players[playerId];
  if (p.pantheon) return 'Você já tem um panteão.';
  if (p.faith < PANTHEON_COST) return `Exige ${PANTHEON_COST} de fé.`;
  if (!availablePantheons(state).includes(belief)) return 'Crença indisponível.';
  p.faith -= PANTHEON_COST;
  p.pantheon = belief;
  return null;
}

export function religionOf(state: GameState, playerId: number) {
  return state.religions.find((r) => r.founder === playerId);
}

export function availableReligionNames(state: GameState): string[] {
  const taken = new Set(state.religions.map((r) => r.id));
  return RELIGION_NAMES.filter((r) => !taken.has(r.id)).map((r) => r.id);
}

export function availableFollowerBeliefs(state: GameState): string[] {
  const taken = new Set(state.religions.map((r) => r.follower));
  return FOLLOWER_BELIEFS.filter((b) => !taken.has(b.id)).map((b) => b.id);
}

export function cannotFoundReligion(state: GameState, u: Unit): string | null {
  if (UNITS[u.type]?.greatPerson !== 'prophet') return 'Exige um Grande Profeta.';
  if (religionOf(state, u.owner)) return 'Você já fundou uma religião.';
  const city = state.cities.find((c) => c.pos === u.pos && c.owner === u.owner);
  if (!city) return 'O profeta precisa estar numa cidade sua.';
  if (!city.districts.some((d) => d.type === 'holy-site')) return 'A cidade precisa de um Lugar Sagrado.';
  if (!availableReligionNames(state).length) return 'Não há mais religiões para fundar.';
  return null;
}

export function foundReligion(state: GameState, u: Unit, religionId: string, follower: string): string | ReligionEvent[] {
  const why = cannotFoundReligion(state, u);
  if (why) return why;
  if (!availableReligionNames(state).includes(religionId)) return 'Nome indisponível.';
  if (!availableFollowerBeliefs(state).includes(follower)) return 'Crença indisponível.';
  const city = state.cities.find((c) => c.pos === u.pos && c.owner === u.owner)!;
  state.religions.push({ id: religionId, founder: u.owner, holyCityId: city.id, follower });
  city.pressure[religionId] = (city.pressure[religionId] ?? 0) + MISSIONARY_PRESSURE;
  city.religion = religionId;
  state.units = state.units.filter((x) => x.id !== u.id);
  return [
    { type: 'religionFounded', player: u.owner, religion: religionId },
    { type: 'cityConverted', cityId: city.id, religion: religionId },
  ];
}

function updateReligion(city: City): string | null {
  let best: string | undefined = city.religion;
  let bestP = best ? city.pressure[best] ?? 0 : 0;
  for (const [r, p] of Object.entries(city.pressure)) {
    if (p > bestP && p >= CONVERT_MIN) {
      best = r;
      bestP = p;
    }
  }
  if (best && best !== city.religion) {
    city.religion = best;
    return best;
  }
  return null;
}

/** Pressão religiosa do turno (muta): cidades seguidoras influenciam vizinhas. */
export function spreadPressure(state: GameState): ReligionEvent[] {
  const events: ReligionEvent[] = [];
  // a pressão decai 5% por turno: difundir exige proximidade contínua ou missionários
  for (const c of state.cities) {
    for (const r of Object.keys(c.pressure)) c.pressure[r] = Math.round(c.pressure[r] * PRESSURE_DECAY * 100) / 100;
  }
  const sources = state.cities.filter((c) => c.religion);
  for (const target of state.cities) {
    for (const src of sources) {
      if (src.id === target.id) continue;
      if (distance(state.map, src.pos, target.pos) > PRESSURE_RANGE) continue;
      const holy = state.religions.some((r) => r.id === src.religion && r.holyCityId === src.id);
      let p = holy ? 3 : 1;
      // resistência: cidades de quem fundou outra religião recebem metade da pressão estrangeira
      const ownerRel = religionOf(state, target.owner);
      if (ownerRel && ownerRel.id !== src.religion) p /= 2;
      target.pressure[src.religion!] = (target.pressure[src.religion!] ?? 0) + p;
    }
    const conv = updateReligion(target);
    if (conv) events.push({ type: 'cityConverted', cityId: target.id, religion: conv });
  }
  return events;
}

/** Pode comprar a unidade religiosa (missionário, apóstolo, inquisidor) com fé nesta cidade? */
export function canBuyMissionary(state: GameState, city: City, unitId = 'missionary'): string | null {
  const p = state.players[city.owner];
  const def = UNITS[unitId];
  if (!def?.faithCost) return 'Esta unidade não é comprada com fé.';
  if (!religionOf(state, city.owner)) return 'Você precisa ter fundado uma religião.';
  if (!city.religion) return 'A cidade não segue nenhuma religião.';
  if (def.inquisitor && city.religion !== religionOf(state, city.owner)!.id) return 'A cidade precisa seguir a sua religião.';
  if (p.faith < def.faithCost) return `Exige ${def.faithCost} de fé.`;
  return null;
}

// ------------------------------------------------------------------ disputa religiosa

export const THEOLOGY_LOSS = 0.25;
export const THEOLOGY_RADIUS = 6;

export function isReligiousUnit(u: Unit): boolean {
  return !!UNITS[u.type]?.religiousStrength;
}

/** Força religiosa: base + 5 se estiver em território cuja cidade segue a sua religião. */
export function religiousStrength(state: GameState, u: Unit): number {
  let s = UNITS[u.type]?.religiousStrength ?? 0;
  const t = state.map.tiles[u.pos];
  const city = state.cities.find((c) => c.id === t.cityId);
  if (city && city.religion === u.religion) s += 5;
  return Math.max(1, s - Math.round((100 - u.hp) / 10));
}

export function cannotTheology(state: GameState, u: Unit, targetPos: number): string | null {
  if (!isReligiousUnit(u) || !u.religion) return 'Apenas unidades religiosas.';
  if (UNITS[u.type].id !== 'apostle' && !UNITS[u.type].inquisitor) return 'Só apóstolos e inquisidores travam combate teológico.';
  if (u.movesLeft <= 0) return 'Sem movimentos restantes.';
  if (distance(state.map, u.pos, targetPos) !== 1) return 'O alvo precisa estar adjacente.';
  const t = state.units.find((x) => x.pos === targetPos && isReligiousUnit(x) && x.religion && x.religion !== u.religion);
  if (!t) return 'Não há unidade de outra religião aí.';
  return null;
}

export type TheologyEvent = { type: 'theology'; attacker: number; defender: number; winnerReligion: string; loserReligion: string; pos: number };

/** Combate teológico (muta): dano como no combate comum; o perdedor some e sua religião perde pressão por perto. */
export function theologicalCombat(state: GameState, u: Unit, targetPos: number, roll: () => number): string | TheologyEvent[] {
  const why = cannotTheology(state, u, targetPos);
  if (why) return why;
  const t = state.units.find((x) => x.pos === targetPos && isReligiousUnit(x) && x.religion && x.religion !== u.religion)!;
  const a = religiousStrength(state, u);
  const d = religiousStrength(state, t);
  const dmg = (diff: number) => Math.max(1, Math.round(30 * Math.exp(diff / 25) * (0.8 + 0.4 * roll())));
  t.hp -= dmg(a - d);
  u.hp -= dmg(d - a);
  u.movesLeft = 0;
  const events: TheologyEvent[] = [];
  const settle = (loser: Unit, winner: Unit) => {
    state.units = state.units.filter((x) => x.id !== loser.id);
    for (const c of state.cities) {
      if (distance(state.map, c.pos, loser.pos) > THEOLOGY_RADIUS) continue;
      if (c.pressure[loser.religion!]) c.pressure[loser.religion!] *= 1 - THEOLOGY_LOSS;
      c.pressure[winner.religion!] = (c.pressure[winner.religion!] ?? 0) + 25;
    }
    events.push({ type: 'theology', attacker: u.owner, defender: t.owner, winnerReligion: winner.religion!, loserReligion: loser.religion!, pos: targetPos });
  };
  if (t.hp <= 0) settle(t, u);
  if (u.hp <= 0) settle(u, t);
  return events;
}

/** Inquisidor remove a pressão de outras religiões de uma cidade sua (adjacente ou nela). */
export function cannotPurge(state: GameState, u: Unit, cityId: number): string | null {
  if (!UNITS[u.type]?.inquisitor) return 'Apenas inquisidores.';
  if ((u.charges ?? 0) <= 0) return 'Sem usos restantes.';
  const city = state.cities.find((c) => c.id === cityId);
  if (!city || city.owner !== u.owner) return 'Só nas suas cidades.';
  if (distance(state.map, u.pos, city.pos) > 1) return 'O inquisidor precisa estar na cidade ou ao lado dela.';
  if (!Object.keys(city.pressure).some((r) => r !== u.religion && city.pressure[r] > 0)) return 'Não há outras religiões aqui.';
  return null;
}

export function purgeHeresy(state: GameState, u: Unit, cityId: number): string | ReligionEvent[] {
  const why = cannotPurge(state, u, cityId);
  if (why) return why;
  const city = state.cities.find((c) => c.id === cityId)!;
  for (const r of Object.keys(city.pressure)) if (r !== u.religion) delete city.pressure[r];
  city.pressure[u.religion!] = Math.max(city.pressure[u.religion!] ?? 0, CONVERT_MIN);
  u.charges = (u.charges ?? 1) - 1;
  u.movesLeft = 0;
  if (u.charges <= 0) state.units = state.units.filter((x) => x.id !== u.id);
  const before = city.religion;
  city.religion = u.religion;
  return before !== u.religion ? [{ type: 'cityConverted', cityId, religion: u.religion! }] : [];
}

export function cannotSpread(state: GameState, u: Unit, cityId: number): string | null {
  if (!UNITS[u.type]?.spreads || UNITS[u.type]?.inquisitor || !u.religion) return 'Apenas missionários e apóstolos.';
  if ((u.charges ?? 0) <= 0) return 'Sem usos restantes.';
  const city = state.cities.find((c) => c.id === cityId);
  if (!city) return 'Cidade inválida.';
  if (distance(state.map, u.pos, city.pos) > 1) return 'O missionário precisa estar na cidade ou ao lado dela.';
  if (city.religion === u.religion) return 'A cidade já segue esta religião.';
  return null;
}

export function spreadReligion(state: GameState, u: Unit, cityId: number): string | ReligionEvent[] {
  const why = cannotSpread(state, u, cityId);
  if (why) return why;
  const city = state.cities.find((c) => c.id === cityId)!;
  city.pressure[u.religion!] = (city.pressure[u.religion!] ?? 0) + (UNITS[u.type].spreadPressure ?? MISSIONARY_PRESSURE);
  u.charges = (u.charges ?? 1) - 1;
  u.movesLeft = 0;
  if (u.charges <= 0) state.units = state.units.filter((x) => x.id !== u.id);
  const conv = updateReligion(city);
  return conv ? [{ type: 'cityConverted', cityId, religion: conv }] : [];
}

/** Rendimento religioso da cidade: crença de seguidor + ouro do fundador na capital. */
export function religionCityYields(state: GameState, city: City): Yields {
  const y = emptyYields();
  if (city.religion) {
    const rel = state.religions.find((r) => r.id === city.religion);
    if (rel) addYields(y, FOLLOWER_BY_ID[rel.follower]?.cityYields);
  }
  if (city.isCapital) {
    const mine = religionOf(state, city.owner);
    if (mine) y.gold += FOUNDER_GOLD_PER_CITY * state.cities.filter((c) => c.religion === mine.id).length;
  }
  return y;
}
