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

export function canBuyMissionary(state: GameState, city: City): string | null {
  const p = state.players[city.owner];
  if (!religionOf(state, city.owner)) return 'Você precisa ter fundado uma religião.';
  if (!city.religion) return 'A cidade não segue nenhuma religião.';
  const cost = UNITS.missionary.faithCost ?? 80;
  if (p.faith < cost) return `Exige ${cost} de fé.`;
  return null;
}

export function cannotSpread(state: GameState, u: Unit, cityId: number): string | null {
  if (!UNITS[u.type]?.spreads || !u.religion) return 'Apenas missionários.';
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
  city.pressure[u.religion!] = (city.pressure[u.religion!] ?? 0) + MISSIONARY_PRESSURE;
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
