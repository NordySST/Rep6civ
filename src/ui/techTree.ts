import { CIVICS, CIVIC_BY_ID } from '../data/civics';
import { ERAS } from '../data/eras';
import { TECHS, TECH_BY_ID } from '../data/techs';
import { availableItems, pathTo, progressOf, treeCost, treeDepth, turnsFor, type TreeKind } from '../rules/research';
import { unlocksOf } from '../rules/unlocks';
import type { Player } from '../state/types';
import { h } from './dom';
import { icon, iconSvg } from './icons';
import { T } from './strings';

/**
 * Árvore de tecnologias/cívicas em grafo: colunas por profundidade (nível), faixas de era,
 * cartões com o que cada item libera e linhas até os pré-requisitos. Tocar num cartão
 * mostra os detalhes; o botão pesquisa o item ou o define como destino (o caminho até ele
 * é pesquisado em sequência). Só lê o estado; a escolha vai por `onPick`.
 */

const W = 230;
const H = 86;
const GX = 54;
const GY = 16;
const PAD = 16;
const HEAD = 34;

interface Opts {
  kind: TreeKind;
  player: Player;
  perTurn: number;
  selected?: string;
  onPick: (id: string) => void;
}

function eraOf(cost: number): string {
  let name = ERAS[0].name;
  for (const e of ERAS) if (cost >= e.minTechCost) name = e.name;
  return name;
}

export function buildTree(o: Opts): HTMLElement {
  const { kind, player: p } = o;
  const list = kind === 'tech' ? TECHS : CIVICS;
  const byId: Record<string, { id: string; name: string; cost: number; prereqs: string[]; description: string; boost?: { description: string } }> =
    kind === 'tech' ? TECH_BY_ID : CIVIC_BY_ID;
  const known = new Set(kind === 'tech' ? p.techs : p.civics);
  const current = kind === 'tech' ? p.researching : p.researchingCivic;
  const target = kind === 'tech' ? p.researchTarget : p.civicTarget;
  const route = target ? pathTo(p, kind, target) : current ? [current] : [];
  const onRoute = new Map(route.map((id, k) => [id, k + 1]));
  const avail = new Set(availableItems(p, kind));

  // colunas por profundidade; dentro da coluna, ordem pelo baricentro dos pré-requisitos
  const memo = new Map<string, number>();
  const cols: string[][] = [];
  for (const d of list) {
    const k = treeDepth(kind, d.id, memo);
    (cols[k] ??= []).push(d.id);
  }
  const row = new Map<string, number>();
  cols[0]?.sort((a, b) => byId[a].cost - byId[b].cost || byId[a].name.localeCompare(byId[b].name));
  cols[0]?.forEach((id, i) => row.set(id, i));
  for (let c = 1; c < cols.length; c++) {
    const col = cols[c] ?? [];
    const bary = (id: string) => {
      const ps = byId[id].prereqs.map((r) => row.get(r) ?? 0);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
    };
    col.sort((a, b) => bary(a) - bary(b) || byId[a].cost - byId[b].cost);
    // linha mais próxima do baricentro, sem sobrepor
    let next = 0;
    for (const id of col) {
      const r = Math.max(next, Math.round(bary(id) - (col.length - 1) / 4));
      row.set(id, r);
      next = r + 1;
    }
  }
  const maxRow = Math.max(0, ...row.values());
  const x = (id: string) => PAD + treeDepth(kind, id, memo) * (W + GX);
  const y = (id: string) => PAD + HEAD + (row.get(id) ?? 0) * (H + GY);
  const width = PAD * 2 + cols.length * (W + GX) - GX;
  const height = PAD * 2 + HEAD + (maxRow + 1) * (H + GY) - GY;

  // faixas de era (tecnologias) ou de nível (cívicas)
  const heads: HTMLElement[] = [];
  let start = 0;
  const label = (c: number) => {
    const col = cols[c] ?? [];
    if (kind === 'civic') return T.tier(c);
    return eraOf(Math.min(...col.map((id) => byId[id].cost)));
  };
  for (let c = 1; c <= cols.length; c++) {
    if (c === cols.length || label(c) !== label(start) || kind === 'civic') {
      heads.push(
        h(
          'div',
          { class: 'tt-era', style: `left:${PAD + start * (W + GX)}px;width:${(c - start) * (W + GX) - GX}px` },
          label(start),
        ),
      );
      start = c;
    }
  }

  // ligações
  const paths: string[] = [];
  for (const d of list) {
    for (const r of d.prereqs) {
      const x1 = x(r) + W;
      const y1 = y(r) + H / 2;
      const x2 = x(d.id);
      const y2 = y(d.id) + H / 2;
      const mid = x2 - GX / 2;
      const cls = known.has(d.id) && known.has(r) ? 'done' : onRoute.has(d.id) && (onRoute.has(r) || known.has(r)) ? 'route' : known.has(r) ? 'open' : '';
      const rr = Math.min(8, Math.abs(y2 - y1) / 2);
      const dy = y2 > y1 ? 1 : -1;
      const dpath =
        Math.abs(y2 - y1) < 1
          ? `M${x1},${y1} H${x2}`
          : `M${x1},${y1} H${mid - rr} Q${mid},${y1} ${mid},${y1 + dy * rr} V${y2 - dy * rr} Q${mid},${y2} ${mid + rr},${y2} H${x2}`;
      paths.push(`<path class="${cls}" d="${dpath}"/>`);
    }
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tt-links');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.innerHTML = paths.join('');

  // detalhes do selecionado
  let selected = o.selected ?? target ?? current ?? undefined;
  const detail = h('div', { class: 'tt-detail' });
  const cards = new Map<string, HTMLElement>();
  const renderDetail = () => {
    detail.replaceChildren();
    if (!selected || !byId[selected]) {
      detail.append(h('small', { class: 'muted' }, T.treeHint));
      return;
    }
    const d = byId[selected];
    const done = known.has(d.id);
    const steps = done ? [] : pathTo(p, kind, d.id);
    const turns = steps.reduce((sum, id) => sum + (isFinite(turnsFor(p, kind, id, o.perTurn)) ? turnsFor(p, kind, id, o.perTurn) : 0), 0);
    const ul = unlocksOf(kind, d.id);
    const isTarget = target === d.id || (current === d.id && !target);
    const action = done
      ? null
      : isTarget
        ? h('button', { class: 'btn', disabled: true }, current === d.id ? `✓ ${T.researching}` : `✓ ${T.currentTarget}`)
        : h(
          'button',
          { class: 'btn primary', onclick: () => o.onPick(d.id) },
          avail.has(d.id) ? kind === 'tech' ? T.researchVerb : T.adoptVerb : T.setTarget(steps.length),
        );
    detail.append(
      h(
        'div',
        { class: 'tt-detail-main' },
        h('strong', { class: 'tt-detail-title' }, d.name),
        h(
          'small',
          {},
          done ? T.researched : `${treeCost(p, kind, d.id)} ${kind === 'tech' ? '🔬' : '🎭'} · ${T.turnsTotal(turns)}${steps.length > 1 ? ` · ${T.stepsLabel(steps.length)}` : ''}`,
        ),
        h('small', { class: 'muted' }, d.description),
        d.prereqs.length ? h('small', { class: 'muted' }, `${T.requires}: ${d.prereqs.map((r) => byId[r]?.name ?? r).join(', ')}`) : null,
        d.boost && !done
          ? h('small', { class: p.boosts.includes(d.id) ? 'boost ok' : 'boost' }, `⚡ ${kind === 'tech' ? T.eureka : T.inspiration}: ${d.boost.description}${p.boosts.includes(d.id) ? ` — ${T.boostDone}` : ''}`)
          : null,
        ul.length ? h('small', { class: 'tt-unlock-names' }, `${T.unlocks}: ${ul.map((u) => u.name).join(', ')}`) : null,
      ),
    );
    if (action) detail.append(action);
  };
  const select = (id: string) => {
    if (selected) cards.get(selected)?.classList.remove('sel');
    selected = id;
    cards.get(id)?.classList.add('sel');
    renderDetail();
  };

  // cartões
  const nodes = list.map((d) => {
    const done = known.has(d.id);
    const isCur = current === d.id;
    const step = onRoute.get(d.id);
    const cost = treeCost(p, kind, d.id);
    const prog = progressOf(p, kind, d.id) + (isCur ? (kind === 'tech' ? p.science : p.culture) : 0);
    const t = turnsFor(p, kind, d.id, o.perTurn);
    const status = done ? T.researched : isCur ? T.turns(t) : avail.has(d.id) ? `${T.available} · ${isFinite(t) ? T.turns(t) : '∞'}` : `${cost}`;
    const cls = ['tt-card', done ? 'done' : isCur ? 'current' : avail.has(d.id) ? 'avail' : 'locked', step ? 'route' : '', selected === d.id ? 'sel' : '']
      .filter(Boolean)
      .join(' ');
    const chips = h('span', { class: 'tt-chips' });
    for (const u of unlocksOf(kind, d.id).slice(0, 6)) {
      const c = h('span', { class: `tt-chip k-${u.kind}`, title: u.name });
      c.innerHTML = iconSvg(u.kind);
      chips.append(c);
    }
    if (d.boost) {
      const b = h('span', { class: `tt-chip boost${p.boosts.includes(d.id) ? ' ok' : ''}`, title: d.boost.description });
      b.innerHTML = iconSvg('boost');
      chips.append(b);
    }
    const disc = icon(done ? 'check' : kind, 'tt-disc');
    const card = h(
      'button',
      { class: cls, style: `left:${x(d.id)}px;top:${y(d.id)}px;width:${W}px;height:${H}px`, onclick: () => select(d.id) },
      disc,
      h(
        'span',
        { class: 'tt-body' },
        h('span', { class: 'tt-name' }, d.name),
        h('span', { class: 'tt-status' }, status),
        chips,
      ),
      step && !done ? h('span', { class: 'tt-step' }, String(step)) : null,
      !done && prog > 0 ? h('span', { class: 'tt-bar' }, h('span', { style: `width:${Math.min(100, (prog / cost) * 100)}%` })) : null,
    );
    cards.set(d.id, card);
    return card;
  });

  const canvas = h('div', { class: 'tt-canvas', style: `width:${width}px;height:${height}px` }, ...heads);
  canvas.prepend(svg);
  canvas.append(...nodes);
  const scroller = h('div', { class: 'tt-scroll' }, canvas);
  renderDetail();
  // começa mostrando o item atual
  const focus = selected ?? current;
  if (focus && byId[focus]) {
    requestAnimationFrame(() => {
      scroller.scrollLeft = Math.max(0, x(focus) - scroller.clientWidth / 2 + W / 2);
      scroller.scrollTop = Math.max(0, y(focus) - scroller.clientHeight / 2 + H / 2);
    });
  }
  return h('div', { class: `tt ${kind}` }, scroller, detail);
}
