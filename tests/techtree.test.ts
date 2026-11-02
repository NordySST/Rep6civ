import { describe, expect, it } from 'vitest';
import { CIVICS } from '../src/data/civics';
import { TECHS, TECH_BY_ID } from '../src/data/techs';
import { endTurn } from '../src/rules/actions';
import { applyAction } from '../src/rules/actions';
import { pathTo, processResearch, setResearch, targetOf } from '../src/rules/research';
import { unlocksOf } from '../src/rules/unlocks';
import { flatGame } from './helpers';

describe('árvore: destino de pesquisa e liberações', () => {
  it('pathTo inclui todos os pré-requisitos em ordem válida', () => {
    const s = flatGame();
    const p = s.players[0];
    const deep = TECHS.reduce((a, b) => (b.cost > a.cost ? b : a));
    const path = pathTo(p, 'tech', deep.id);
    expect(path[path.length - 1]).toBe(deep.id);
    const seen = new Set(p.techs);
    for (const id of path) {
      expect(TECH_BY_ID[id].prereqs.every((r) => seen.has(r)), id).toBe(true);
      seen.add(id);
    }
  });

  it('escolher uma tecnologia futura pesquisa o caminho sozinho até ela', () => {
    const s = flatGame();
    const p = s.players[0];
    const target = TECHS.find((t) => t.prereqs.length && TECH_BY_ID[t.prereqs[0]].prereqs.length)!;
    expect(setResearch(p, 'tech', target.id)).toBeNull();
    expect(p.researchTarget).toBe(target.id);
    const path = pathTo(p, 'tech', target.id);
    expect(p.researching).toBe(path[0]);
    // ciência suficiente a cada turno: percorre o caminho e termina no destino
    for (let k = 0; k < path.length; k++) {
      p.science = 10000;
      processResearch(s, 0);
    }
    expect(p.techs).toContain(target.id);
    expect(p.researchTarget).toBeUndefined();
    expect(targetOf(p, 'tech').path).toEqual([]);
  });

  it('a ação setResearch aceita destino futuro (também cívicas)', () => {
    const s = flatGame();
    const civic = CIVICS.find((c) => c.prereqs.length)!;
    const { state, events } = applyAction(s, { type: 'setResearch', kind: 'civic', id: civic.id });
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(state.players[0].civicTarget).toBe(civic.id);
    expect(state.players[0].researchingCivic).not.toBe(civic.id);
    void endTurn;
  });

  it('cada tecnologia lista o que libera', () => {
    const all = TECHS.flatMap((t) => unlocksOf('tech', t.id));
    expect(all.some((u) => u.kind === 'unit')).toBe(true);
    expect(all.some((u) => u.kind === 'building')).toBe(true);
    expect(all.some((u) => u.kind === 'improvement')).toBe(true);
    expect(CIVICS.flatMap((c) => unlocksOf('civic', c.id)).some((u) => u.kind === 'government')).toBe(true);
  });
});
