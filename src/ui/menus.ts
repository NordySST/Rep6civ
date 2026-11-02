import { CIVS } from '../data/civs';
import { MAP_SIZES, type MapSizeId } from '../data/mapSizes';
import { randomSeedString } from '../rules/rng';
import { AUTOSAVE_SLOT, MANUAL_SLOTS, readSlotInfo, type SlotInfo } from '../state/save';
import { CIV_BY_ID } from '../data/civs';
import { clear, h } from './dom';
import { T } from './strings';

export interface ModalHost {
  root: HTMLElement;
}

export function closeModal(host: ModalHost): void {
  host.root.hidden = true;
  clear(host.root);
}

export function openModal(host: ModalHost, title: string, body: Node, opts: { closable?: boolean } = {}): void {
  clear(host.root);
  const closable = opts.closable ?? true;
  const card = h(
    'div',
    { class: 'modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(
      'div',
      { class: 'modal-head' },
      h('h2', {}, title),
      closable ? h('button', { class: 'btn icon', 'aria-label': T.close, onclick: () => closeModal(host) }, '✕') : null,
    ),
    body,
  );
  host.root.append(card);
  host.root.hidden = false;
}

export interface NewGameChoice {
  seed: string;
  mapSize: MapSizeId;
  civId: string;
}

export function newGameForm(onStart: (c: NewGameChoice) => void, defaults?: Partial<NewGameChoice>): HTMLElement {
  let size: MapSizeId = defaults?.mapSize ?? 'small';
  let civId = defaults?.civId ?? CIVS[0].id;
  const seedInput = h('input', {
    type: 'text',
    value: defaults?.seed ?? randomSeedString(),
    maxlength: 32,
    'aria-label': T.seed,
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;

  const sizeRow = h('div', { class: 'seg' });
  const renderSizes = () => {
    clear(sizeRow);
    for (const s of Object.values(MAP_SIZES)) {
      sizeRow.append(
        h(
          'button',
          {
            class: `btn seg-btn${s.id === size ? ' active' : ''}`,
            'aria-pressed': String(s.id === size),
            onclick: () => {
              size = s.id;
              renderSizes();
            },
          },
          h('span', {}, s.name),
          h('small', {}, `${s.width}×${s.height}`),
        ),
      );
    }
  };
  renderSizes();

  const civList = h('div', { class: 'civ-list' });
  const renderCivs = () => {
    clear(civList);
    for (const c of CIVS) {
      civList.append(
        h(
          'button',
          {
            class: `civ-card${c.id === civId ? ' active' : ''}`,
            'aria-pressed': String(c.id === civId),
            style: `--civ:${c.color};--civ2:${c.secondaryColor}`,
            onclick: () => {
              civId = c.id;
              renderCivs();
            },
          },
          h('span', { class: 'civ-swatch' }),
          h(
            'span',
            { class: 'civ-text' },
            h('strong', {}, c.name),
            h('small', {}, `${c.leaderTitle} ${c.leader}`),
            h('small', { class: 'muted' }, `${c.ability.name}: ${c.ability.description}`),
          ),
        ),
      );
    }
  };
  renderCivs();

  return h(
    'div',
    { class: 'form' },
    h('label', { class: 'field-label' }, T.mapSize),
    sizeRow,
    h('label', { class: 'field-label' }, T.seed),
    h(
      'div',
      { class: 'row' },
      seedInput,
      h('button', { class: 'btn', onclick: () => (seedInput.value = randomSeedString()) }, '🎲 ' + T.randomSeed),
    ),
    h('label', { class: 'field-label' }, T.civilization),
    civList,
    h(
      'button',
      {
        class: 'btn primary wide',
        onclick: () => onStart({ seed: seedInput.value.trim() || randomSeedString(), mapSize: size, civId }),
      },
      T.start,
    ),
  );
}

function slotLabel(slot: string): string {
  if (slot === AUTOSAVE_SLOT) return T.autosave;
  const n = MANUAL_SLOTS.indexOf(slot as (typeof MANUAL_SLOTS)[number]) + 1;
  return T.slot(n);
}

function slotDetails(info: SlotInfo | null): string {
  if (!info) return T.emptySlot;
  const civ = CIV_BY_ID[info.meta.civId]?.name ?? info.meta.civId;
  const date = new Date(info.savedAt);
  const when = isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const size = MAP_SIZES[info.meta.mapSize as MapSizeId]?.name ?? info.meta.mapSize;
  return `${civ} · ${T.turn} ${info.meta.turn} · ${size} · ${when}`;
}

export function slotList(mode: 'save' | 'load', onPick: (slot: string) => void): HTMLElement {
  const slots = mode === 'save' ? [...MANUAL_SLOTS] : [AUTOSAVE_SLOT, ...MANUAL_SLOTS];
  return h(
    'div',
    { class: 'slot-list' },
    ...slots.map((slot) => {
      const info = readSlotInfo(slot);
      const disabled = mode === 'load' && !info;
      return h(
        'button',
        { class: 'slot', disabled, onclick: () => onPick(slot) },
        h('strong', {}, slotLabel(slot)),
        h('small', {}, slotDetails(info)),
      );
    }),
  );
}
