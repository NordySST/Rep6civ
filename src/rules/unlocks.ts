import { BUILDINGS } from '../data/buildings';
import { DISTRICTS } from '../data/districts';
import { GOVERNMENTS, POLICIES } from '../data/governments';
import { IMPROVEMENTS } from '../data/improvements';
import { PROJECTS } from '../data/projects';
import { RESOURCES } from '../data/resources';
import { UNITS } from '../data/units';
import { WORLD_WONDERS } from '../data/worldWonders';
import type { TreeKind } from './research';

/** O que uma tecnologia/cívica libera (para os cartões da árvore). Puro, derivado dos dados. */
export type UnlockKind = 'unit' | 'building' | 'district' | 'improvement' | 'resource' | 'wonder' | 'project' | 'government' | 'policy';

export interface Unlock {
  kind: UnlockKind;
  id: string;
  name: string;
}

let cache: Map<string, Unlock[]> | null = null;

function build(): Map<string, Unlock[]> {
  const m = new Map<string, Unlock[]>();
  const add = (kind: TreeKind, key: string | undefined, u: Unlock) => {
    if (!key) return;
    const k = `${kind}:${key}`;
    m.set(k, [...(m.get(k) ?? []), u]);
  };
  for (const u of Object.values(UNITS)) {
    if (u.barbarianOnly || u.greatPerson) continue;
    add('tech', u.requiresTech, { kind: 'unit', id: u.id, name: u.name });
    add('civic', u.requiresCivic, { kind: 'unit', id: u.id, name: u.name });
  }
  for (const d of Object.values(DISTRICTS)) {
    add('tech', d.requiresTech, { kind: 'district', id: d.id, name: d.name });
    add('civic', d.requiresCivic, { kind: 'district', id: d.id, name: d.name });
  }
  for (const b of Object.values(BUILDINGS)) {
    if (b.auto) continue;
    add('tech', b.requiresTech, { kind: 'building', id: b.id, name: b.name });
    add('civic', b.requiresCivic, { kind: 'building', id: b.id, name: b.name });
  }
  for (const i of Object.values(IMPROVEMENTS)) add('tech', i.requiresTech, { kind: 'improvement', id: i.id, name: i.name });
  for (const r of RESOURCES) add('tech', r.revealedBy, { kind: 'resource', id: r.id, name: r.name });
  for (const w of WORLD_WONDERS) {
    add('tech', w.requiresTech, { kind: 'wonder', id: w.id, name: w.name });
    add('civic', w.requiresCivic, { kind: 'wonder', id: w.id, name: w.name });
  }
  for (const p of Object.values(PROJECTS)) add('tech', p.requiresTech, { kind: 'project', id: p.id, name: p.name });
  for (const g of GOVERNMENTS) add('civic', g.civic, { kind: 'government', id: g.id, name: g.name });
  for (const p of POLICIES) add('civic', p.civic, { kind: 'policy', id: p.id, name: p.name });
  return m;
}

export function unlocksOf(kind: TreeKind, id: string): Unlock[] {
  cache ??= build();
  return cache.get(`${kind}:${id}`) ?? [];
}
