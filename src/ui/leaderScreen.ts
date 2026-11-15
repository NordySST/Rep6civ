import { CIV_BY_ID } from '../data/civs';
import type { LeaderGesture, LeaderMood, LeaderStage } from '../render3d/leaderScene';
import { clear, h } from './dom';
import { openModal, type ModalHost } from './menus';
import { portrait } from './portrait';

/**
 * Tela do líder em tela cheia: cena 3D (carregada sob demanda, um só contexto WebGL
 * reaproveitado) com o líder, placa com nome/atitude, fala e as ações da diplomacia.
 * Sem WebGL2 (ou enquanto carrega) mostra o retrato pré-renderizado.
 */

export interface LeaderScreenOpts {
  civId: string;
  /** Linha abaixo do nome (ex.: atitude e situação). */
  subtitle: string;
  mood: LeaderMood;
  gesture: LeaderGesture | null;
  line: string;
  actions: HTMLElement[];
  /** Linhas extras (ressentimentos, agenda…). */
  details?: HTMLElement[];
}

export interface LeaderScreenHandle {
  say(line: string, gesture?: LeaderGesture | null, mood?: LeaderMood): void;
  setActions(actions: HTMLElement[], subtitle?: string): void;
}

let stagePromise: Promise<LeaderStage | null> | null = null;

/** Palco 3D compartilhado (import dinâmico: three.js fica no pedaço da visão 3D). */
export function getLeaderStage(): Promise<LeaderStage | null> {
  stagePromise ??= import('../render3d/leaderScene').then((m) => m.leaderStage()).catch(() => null);
  return stagePromise;
}

function isLandscape(): boolean {
  return window.innerWidth > window.innerHeight * 1.05;
}

export function openLeaderScreen(host: ModalHost, title: string, opts: LeaderScreenOpts): LeaderScreenHandle {
  const civ = CIV_BY_ID[opts.civId];
  const stageBox = h('div', { class: 'leader-stage' }, portrait(opts.civId, 'lg'));
  const sub = h('small', { class: 'leader-sub' }, opts.subtitle);
  const plate = h(
    'div',
    { class: 'leader-plate', style: `--civ:${civ?.color};--civ2:${civ?.secondaryColor}` },
    h('span', { class: 'civ-swatch' }),
    h('div', {}, h('strong', {}, `${civ?.leaderTitle ?? ''} ${civ?.leader ?? ''}`), h('small', {}, civ?.name ?? ''), sub),
  );
  const bubble = h('p', { class: 'leader-say', 'aria-live': 'polite' }, `“${opts.line}”`);
  const actions = h('div', { class: 'actions leader-actions' }, ...opts.actions);
  const panel = h('div', { class: 'leader-panel' }, plate, bubble, ...(opts.details ?? []), actions);
  const body = h('div', { class: 'leader-wrap' }, stageBox, panel);
  openModal(host, title, body, { size: 'leader' });

  let stage: LeaderStage | null = null;
  let pending: { gesture: LeaderGesture | null; mood: LeaderMood } | null = null;
  const frame = () => {
    if (!stage) return;
    if (isLandscape()) stage.frame(0.3, 0.5);
    else stage.frame(0.5, 0.33);
  };
  const onResize = () => (stageBox.isConnected ? frame() : window.removeEventListener('resize', onResize));
  window.addEventListener('resize', onResize);
  getLeaderStage().then(async (st) => {
    if (!st || !stageBox.isConnected) return;
    stage = st;
    frame();
    const ok = await st.show(opts.civId, pending?.mood ?? opts.mood, pending ? pending.gesture : opts.gesture);
    if (!ok || !stageBox.isConnected) return;
    stageBox.prepend(st.canvas);
    stageBox.classList.add('live');
    frame();
  });

  return {
    say(line, gesture = null, mood) {
      bubble.textContent = `“${line}”`;
      bubble.classList.remove('pop');
      void bubble.offsetWidth;
      bubble.classList.add('pop');
      if (stage) {
        if (mood) stage.setMood(mood);
        if (gesture) stage.play(gesture);
      } else pending = { gesture, mood: mood ?? opts.mood };
    },
    setActions(list, subtitle) {
      clear(actions);
      actions.append(...list);
      if (subtitle !== undefined) sub.textContent = subtitle;
    },
  };
}
