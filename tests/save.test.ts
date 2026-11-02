import { describe, expect, it } from 'vitest';
import { newGame } from '../src/rules/game';
import {
  deserialize,
  loadFromSlot,
  migrate,
  readSlotInfo,
  SAVE_FORMAT,
  SaveError,
  saveToSlot,
  serialize,
  type KeyValueStorage,
} from '../src/state/save';
import { SCHEMA_VERSION } from '../src/state/version';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('salvar/carregar', () => {
  const s = newGame({ seed: 'save', mapSize: 'small', civId: 'norvhal' });

  it('ida e volta preserva o estado', () => {
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('envelope tem formato, versão e metadados', () => {
    const env = JSON.parse(serialize(s));
    expect(env.format).toBe(SAVE_FORMAT);
    expect(env.version).toBe(SCHEMA_VERSION);
    expect(env.meta).toMatchObject({ turn: 1, civId: 'norvhal', mapSize: 'small', seed: 'save' });
  });

  it('salva em slots de um storage', () => {
    const st = memoryStorage();
    saveToSlot(s, 'slot1', st);
    expect(readSlotInfo('slot1', st)?.meta.civId).toBe('norvhal');
    expect(loadFromSlot('slot1', st)).toEqual(s);
    expect(loadFromSlot('slot2', st)).toBeNull();
  });

  it('rejeita JSON inválido e saves de versão futura', () => {
    expect(() => deserialize('{nope')).toThrow(SaveError);
    const future = JSON.stringify({ format: SAVE_FORMAT, version: SCHEMA_VERSION + 5, state: s, meta: {} });
    expect(() => deserialize(future)).toThrow(/mais nova/);
    expect(() => deserialize(JSON.stringify({ foo: 1 }))).toThrow(SaveError);
  });

  it('migra save legado v0 (sem envelope, sem citiesFounded)', () => {
    const legacy: any = structuredClone(s);
    delete legacy.schemaVersion;
    for (const p of legacy.players) delete p.citiesFounded;
    const loaded = deserialize(JSON.stringify(legacy));
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded.players[0].citiesFounded).toBe(0);
  });

  it('aplica migrações encadeadas em ordem', () => {
    const table = {
      1: (x: any) => ({ ...x, a: 1 }),
      2: (x: any) => ({ ...x, b: x.a + 1 }),
    };
    const out = migrate({ schemaVersion: 1 }, 1, table, 3);
    expect(out).toEqual({ schemaVersion: 3, a: 1, b: 2 });
    expect(() => migrate({}, 0, table, 3)).toThrow(/migração/);
  });
});
