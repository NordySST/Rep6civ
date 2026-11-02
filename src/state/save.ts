import type { GameState } from './types';
import { SCHEMA_VERSION } from './version';

/**
 * Salvamento em localStorage com envelope versionado e migrações encadeadas.
 *
 * Para mudar o formato do estado:
 *  1. incremente SCHEMA_VERSION em state/version.ts;
 *  2. adicione em MIGRATIONS uma função `de N para N+1`;
 *  3. cubra a migração com um teste em tests/save.test.ts.
 */

export const SAVE_FORMAT = 'rep6civ-save';
export const STORAGE_PREFIX = 'rep6civ.save.';
export const AUTOSAVE_SLOT = 'auto';
export const MANUAL_SLOTS = ['slot1', 'slot2', 'slot3'] as const;

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  /** Versão do esquema de `state`. */
  version: number;
  savedAt: string;
  /** Metadados para listar sem desserializar tudo. */
  meta: { turn: number; civId: string; mapSize: string; seed: string };
  state: unknown;
}

/** Migração de `version` para `version + 1`. Recebe e devolve JSON cru. */
export type Migration = (state: any) => any;
export type MigrationTable = Record<number, Migration>;

/**
 * Tabela de migrações: a chave é a versão de origem.
 * Ex.: `1: (s) => ({ ...s, novoCampo: 0, schemaVersion: 2 })`.
 */
export const MIGRATIONS: MigrationTable = {
  // Versão 0 = protótipo sem `schemaVersion` e sem `citiesFounded` nos jogadores.
  0: (s) => ({
    ...s,
    schemaVersion: 1,
    players: (s.players ?? []).map((p: any) => ({ citiesFounded: 0, ...p })),
  }),
  // v1 → v2 (etapa 2): estoques do jogador e gestão de cidades.
  // Cidadãos ficam sem hexágonos; rules/cityState.normalizeState os distribui ao carregar.
  1: (s) => ({
    ...s,
    players: s.players.map((p: any) => ({ gold: 10, science: 0, culture: 0, faith: 0, ...p })),
    cities: s.cities.map((c: any) => ({
      foodStored: 0,
      queue: [],
      progress: {},
      worked: [],
      locked: [],
      focus: 'balanced',
      buildings: c.isCapital ? ['palace'] : [],
      cultureStored: 0,
      cultureTiles: 0,
      ...c,
    })),
    units: s.units.map((u: any) => (u.type === 'builder' && u.charges === undefined ? { ...u, charges: 3 } : u)),
  }),
  // v2 → v3 (etapa 3): pesquisa, cívicas, governo e políticas.
  2: (s) => ({
    ...s,
    players: s.players.map((p: any) => ({
      techs: [],
      researching: null,
      techProgress: {},
      civics: [],
      researchingCivic: null,
      civicProgress: {},
      boosts: [],
      government: null,
      policies: [],
      policyChangeAvailable: false,
      ...p,
    })),
  }),
  // v3 → v4 (etapa 4): vida/experiência, vida das cidades, bárbaros.
  3: (s) => {
    const players = [...s.players];
    if (!players.some((p: any) => p.isBarbarian)) {
      players.push({
        id: players.length,
        civId: 'barbarian',
        isHuman: false,
        isBarbarian: true,
        explored: new Array(s.map.tiles.length).fill(0),
        citiesFounded: 0,
        gold: 0,
        science: 0,
        culture: 0,
        faith: 0,
        techs: [],
        researching: null,
        techProgress: {},
        civics: [],
        researchingCivic: null,
        civicProgress: {},
        boosts: [],
        government: null,
        policies: [],
        policyChangeAvailable: false,
      });
    }
    return {
      ...s,
      players,
      units: s.units.map((u: any) => ({ hp: 100, xp: 0, promotions: [], ...u })),
      cities: s.cities.map((c: any) => ({ hp: 200, ...c })),
      camps: s.camps ?? [],
      rngCounter: s.rngCounter ?? 0,
    };
  },
};

export class SaveError extends Error {}

export function migrate(
  state: any,
  fromVersion: number,
  migrations: MigrationTable = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): any {
  if (fromVersion > target) {
    throw new SaveError(
      `Este save foi criado por uma versão mais nova do jogo (v${fromVersion}). Atualize o jogo.`,
    );
  }
  let s = state;
  for (let v = fromVersion; v < target; v++) {
    const m = migrations[v];
    if (!m) throw new SaveError(`Não há migração do formato v${v} para v${v + 1}.`);
    s = m(structuredClone(s));
    s.schemaVersion = v + 1;
  }
  return s;
}

export function validateState(s: any): asserts s is GameState {
  const ok =
    s &&
    typeof s === 'object' &&
    typeof s.turn === 'number' &&
    s.map &&
    Array.isArray(s.map.tiles) &&
    s.map.tiles.length === s.map.width * s.map.height &&
    Array.isArray(s.players) &&
    Array.isArray(s.units) &&
    Array.isArray(s.cities);
  if (!ok) throw new SaveError('Save corrompido ou inválido.');
}

export function serialize(state: GameState, now = new Date()): string {
  const env: SaveEnvelope = {
    format: SAVE_FORMAT,
    version: SCHEMA_VERSION,
    savedAt: now.toISOString(),
    meta: {
      turn: state.turn,
      civId: state.players[0]?.civId ?? '',
      mapSize: state.settings.mapSize,
      seed: state.settings.seed,
    },
    state,
  };
  return JSON.stringify(env);
}

export function deserialize(json: string, migrations: MigrationTable = MIGRATIONS): GameState {
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SaveError('Save corrompido (JSON inválido).');
  }
  let state: any;
  let version: number;
  if (raw && raw.format === SAVE_FORMAT) {
    state = raw.state;
    version = typeof raw.version === 'number' ? raw.version : 0;
  } else if (raw && raw.map && raw.players) {
    // Save legado sem envelope.
    state = raw;
    version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  } else {
    throw new SaveError('Arquivo não reconhecido como save do jogo.');
  }
  const migrated = migrate(state, version, migrations);
  validateState(migrated);
  return migrated;
}

/** Armazenamento mínimo (compatível com localStorage) para facilitar testes. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveToSlot(state: GameState, slot: string, storage = defaultStorage()): void {
  if (!storage) throw new SaveError('Armazenamento local indisponível.');
  try {
    storage.setItem(STORAGE_PREFIX + slot, serialize(state));
  } catch (e) {
    throw new SaveError('Não foi possível salvar (espaço insuficiente?).');
  }
}

export function loadFromSlot(slot: string, storage = defaultStorage()): GameState | null {
  if (!storage) return null;
  const json = storage.getItem(STORAGE_PREFIX + slot);
  if (!json) return null;
  return deserialize(json);
}

export function deleteSlot(slot: string, storage = defaultStorage()): void {
  storage?.removeItem(STORAGE_PREFIX + slot);
}

export interface SlotInfo {
  slot: string;
  savedAt: string;
  meta: SaveEnvelope['meta'];
  version: number;
}

export function readSlotInfo(slot: string, storage = defaultStorage()): SlotInfo | null {
  const json = storage?.getItem(STORAGE_PREFIX + slot);
  if (!json) return null;
  try {
    const raw = JSON.parse(json);
    if (raw?.format !== SAVE_FORMAT) return null;
    return { slot, savedAt: raw.savedAt, meta: raw.meta, version: raw.version };
  } catch {
    return null;
  }
}
