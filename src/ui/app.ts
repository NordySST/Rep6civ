import { CIV_BY_ID } from '../data/civs';
import { RESOURCE_BY_ID, RESOURCE_KIND_LABEL } from '../data/resources';
import { UNITS } from '../data/units';
import { WONDER_BY_ID } from '../data/wonders';
import { YIELD_KEYS, YIELD_LABELS } from '../data/yields';
import { clampCamera, clampZoom, type Camera, zoomAt } from '../render/camera';
import { Renderer, tileAtWorld, tileCenter, worldSize, type Overlay } from '../render/renderer';
import { applyAction, unitsNeedingOrders, type Action } from '../rules/actions';
import { canFoundCity } from '../rules/city';
import { newGame, turnYear } from '../rules/game';
import { findPath, reachableThisTurn } from '../rules/movement';
import { describeTile, isPassableLand, tileYields } from '../rules/tiles';
import { computeVisibility } from '../rules/visibility';
import { screenToWorld } from '../render/camera';
import { AUTOSAVE_SLOT, loadFromSlot, readSlotInfo, saveToSlot, SaveError } from '../state/save';
import type { GameState, Unit } from '../state/types';
import { clear, h } from './dom';
import { attachInput } from './input';
import { closeModal, newGameForm, openModal, slotList } from './menus';
import { T } from './strings';

/**
 * Controlador da interface: guarda o estado atual do jogo, a câmera e a seleção,
 * despacha ações para as regras puras e redesenha sob demanda.
 */
export class App {
  private state: GameState | null = null;
  private cam: Camera = { x: 0, y: 0, zoom: 1 };
  private renderer: Renderer;
  private vis: Uint8Array = new Uint8Array(0);
  private selectedUnitId: number | undefined;
  private selectedTile: number | undefined;
  private pendingPath: { target: number; path: number[]; turns: number } | undefined;
  private reachable: Set<number> | undefined;
  private revealAll = false;
  private dirty = true;
  private toastTimer = 0;

  private el = {
    canvas: h('canvas', { id: 'map', 'aria-label': 'Mapa do jogo' }),
    topbar: h('header', { class: 'topbar' }),
    zoom: h('div', { class: 'zoom-ctrl' }),
    panel: h('section', { class: 'panel', 'aria-live': 'polite' }),
    endTurn: h('button', { class: 'btn primary end-turn' }, T.nextTurn),
    toast: h('div', { class: 'toast', role: 'status' }),
    modal: h('div', { class: 'modal', hidden: true }),
  };

  constructor(root: HTMLElement) {
    const bottom = h('div', { class: 'bottombar' }, this.el.panel, this.el.endTurn);
    root.append(this.el.canvas, this.el.topbar, this.el.zoom, bottom, this.el.toast, this.el.modal);
    this.renderer = new Renderer(this.el.canvas);

    this.el.zoom.append(
      h('button', { class: 'btn icon', 'aria-label': T.zoomIn, onclick: () => this.zoomBy(1.25) }, '+'),
      h('button', { class: 'btn icon', 'aria-label': T.zoomOut, onclick: () => this.zoomBy(0.8) }, '−'),
      h('button', { class: 'btn icon', 'aria-label': T.centerUnit, onclick: () => this.centerOnSelection() }, '◎'),
    );
    this.el.endTurn.addEventListener('click', () => this.onEndTurnButton());

    attachInput(this.el.canvas, {
      onPan: (dx, dy) => {
        this.cam = this.clampCam({ ...this.cam, x: this.cam.x - dx / this.cam.zoom, y: this.cam.y - dy / this.cam.zoom });
        this.invalidate();
      },
      onZoom: (f, sx, sy) => {
        this.cam = this.clampCam(zoomAt(this.cam, this.renderer.vw, this.renderer.vh, sx, sy, this.cam.zoom * f));
        this.invalidate();
      },
      onTap: (sx, sy) => this.onTap(sx, sy),
    });

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.resize();
    this.loop();
  }

  // ------------------------------------------------------------------ ciclo

  start(): void {
    const auto = readSlotInfo(AUTOSAVE_SLOT);
    this.showMainMenu(!!auto);
  }

  private loop = () => {
    if (this.dirty && this.state) {
      this.dirty = false;
      const overlay: Overlay = {
        selectedUnitId: this.selectedUnitId,
        selectedTile: this.selectedTile,
        reachable: this.reachable,
        path: this.pendingPath?.path ?? this.selectedUnit()?.path,
        pathTurns: this.pendingPath?.turns ?? this.pathTurnsForSelected(),
        revealAll: this.revealAll,
      };
      this.renderer.draw(this.state, this.cam, this.vis, overlay);
    }
    requestAnimationFrame(this.loop);
  };

  private invalidate(): void {
    this.dirty = true;
  }

  private resize(): void {
    this.renderer.resize();
    if (this.state) this.cam = this.clampCam(this.cam);
    this.invalidate();
  }

  private clampCam(c: Camera): Camera {
    if (!this.state) return c;
    const ws = worldSize(this.state);
    return clampCamera({ ...c, zoom: clampZoom(c.zoom) }, ws.w, ws.h);
  }

  // ------------------------------------------------------------------ jogo

  private setState(s: GameState): void {
    this.state = s;
    this.vis = computeVisibility(s, s.currentPlayer);
    this.refreshSelectionDerived();
    this.renderHud();
    this.invalidate();
  }

  private dispatch(action: Action): boolean {
    if (!this.state) return false;
    const { state, events } = applyAction(this.state, action);
    let ok = true;
    for (const ev of events) {
      if (ev.type === 'error') {
        this.toast(ev.message);
        ok = false;
      } else if (ev.type === 'cityFounded') this.toast(T.cityFounded(ev.name));
    }
    if (ok) this.setState(state);
    return ok;
  }

  private startNewGame(seed: string, mapSize: GameState['settings']['mapSize'], civId: string): void {
    const s = newGame({ seed, mapSize, civId });
    this.selectedUnitId = undefined;
    this.selectedTile = undefined;
    this.pendingPath = undefined;
    this.setState(s);
    this.cam.zoom = 1.1;
    const first = s.units.find((u) => u.owner === s.currentPlayer && u.type === 'settler') ?? s.units[0];
    if (first) this.selectUnit(first.id, true);
    this.autosave();
  }

  private autosave(): void {
    if (!this.state) return;
    try {
      saveToSlot(this.state, AUTOSAVE_SLOT);
    } catch (e) {
      if (e instanceof SaveError) this.toast(e.message);
    }
  }

  private selectedUnit(): Unit | undefined {
    return this.state?.units.find((u) => u.id === this.selectedUnitId);
  }

  private pathTurnsForSelected(): number | undefined {
    const u = this.selectedUnit();
    if (!u?.path?.length || !this.state) return undefined;
    const res = findPath(this.state, u, u.path[u.path.length - 1]);
    return res?.turns;
  }

  private refreshSelectionDerived(): void {
    const u = this.selectedUnit();
    if (!u) {
      this.selectedUnitId = undefined;
      this.reachable = undefined;
      return;
    }
    this.reachable = this.state ? reachableThisTurn(this.state, u) : undefined;
  }

  private selectUnit(id: number | undefined, center = false): void {
    this.selectedUnitId = id;
    this.pendingPath = undefined;
    const u = this.selectedUnit();
    this.selectedTile = u?.pos;
    this.refreshSelectionDerived();
    if (center && u) this.centerOn(u.pos);
    this.renderHud();
    this.invalidate();
  }

  private selectNextUnit(): boolean {
    if (!this.state) return false;
    const waiting = unitsNeedingOrders(this.state, this.state.currentPlayer);
    if (!waiting.length) {
      this.selectUnit(undefined);
      return false;
    }
    const curIdx = waiting.findIndex((u) => u.id === this.selectedUnitId);
    const next = waiting[(curIdx + 1) % waiting.length];
    this.selectUnit(next.id, true);
    return true;
  }

  private onEndTurnButton(): void {
    if (!this.state) return;
    const waiting = unitsNeedingOrders(this.state, this.state.currentPlayer);
    if (waiting.length === 0) return this.endTurn();
    const selId = this.selectedUnitId;
    if (selId !== undefined && waiting.some((u) => u.id === selId)) {
      if (waiting.length === 1) return this.endTurn();
      // "Próxima unidade": a unidade atual fica para depois neste turno
      this.dispatch({ type: 'skipUnit', unitId: selId });
    }
    this.selectNextUnit();
  }

  private endTurn(): void {
    if (!this.dispatch({ type: 'endTurn' }) || !this.state) return;
    this.toast(`${T.turn} ${this.state.turn} · ${turnYear(this.state.turn)}`);
    this.autosave();
    if (!this.selectNextUnit()) this.selectUnit(undefined);
  }

  // ------------------------------------------------------------------ entrada

  private onTap(sx: number, sy: number): void {
    if (!this.state) return;
    const w = screenToWorld(this.cam, this.renderer.vw, this.renderer.vh, sx, sy);
    const idx = tileAtWorld(this.state, w.x, w.y);
    if (idx < 0) return;
    const s = this.state;
    const me = s.currentPlayer;
    const sel = this.selectedUnit();

    // confirmação de movimento: segundo toque no mesmo destino
    if (sel && this.pendingPath && this.pendingPath.target === idx) {
      this.pendingPath = undefined;
      if (this.dispatch({ type: 'move', unitId: sel.id, target: idx })) {
        const after = this.selectedUnit();
        if (after) this.selectedTile = after.pos;
        if (after && after.movesLeft <= 0) this.selectNextUnit();
        else this.renderHud();
      }
      this.invalidate();
      return;
    }

    const mine = s.units.filter((u) => u.pos === idx && u.owner === me);
    if (mine.length) {
      // alterna entre unidades empilhadas no mesmo hexágono
      const cur = mine.findIndex((u) => u.id === this.selectedUnitId);
      const next = mine[(cur + 1) % mine.length];
      this.selectUnit(next.id);
      return;
    }

    if (sel && idx !== sel.pos && s.players[me].explored[idx]) {
      const res = findPath(s, sel, idx);
      if (res) {
        this.pendingPath = { target: idx, path: res.path, turns: res.turns };
        this.selectedTile = idx;
        this.renderHud();
        this.invalidate();
        return;
      }
    }

    // apenas inspeciona o hexágono
    this.pendingPath = undefined;
    this.selectedUnitId = undefined;
    this.reachable = undefined;
    this.selectedTile = idx;
    this.renderHud();
    this.invalidate();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.state || !this.el.modal.hidden) return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Enter') this.onEndTurnButton();
    else if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
    else if (e.key === '-') this.zoomBy(0.8);
    else if (e.key === 'b' || e.key === 'B') this.foundCity();
    else if (e.key === ' ') this.skipSelected();
    else if (e.key === 'Escape') this.selectUnit(undefined);
  }

  private zoomBy(f: number): void {
    this.cam = this.clampCam(zoomAt(this.cam, this.renderer.vw, this.renderer.vh, this.renderer.vw / 2, this.renderer.vh / 2, this.cam.zoom * f));
    this.invalidate();
  }

  private centerOn(idx: number): void {
    if (!this.state) return;
    const c = tileCenter(this.state, idx);
    this.cam = this.clampCam({ ...this.cam, x: c.x, y: c.y });
    this.invalidate();
  }

  private centerOnSelection(): void {
    if (!this.state) return;
    const u = this.selectedUnit();
    if (u) return this.centerOn(u.pos);
    if (this.selectedTile !== undefined) return this.centerOn(this.selectedTile);
    const any = this.state.units.find((x) => x.owner === this.state!.currentPlayer);
    const city = this.state.cities.find((c) => c.owner === this.state!.currentPlayer);
    const pos = city?.pos ?? any?.pos;
    if (pos !== undefined) this.centerOn(pos);
  }

  private foundCity(): void {
    const u = this.selectedUnit();
    if (!u) return;
    if (this.dispatch({ type: 'foundCity', unitId: u.id })) {
      this.autosave();
      this.selectedTile = u.pos;
      if (!this.selectNextUnit()) this.renderHud();
    }
  }

  private skipSelected(): void {
    const u = this.selectedUnit();
    if (!u) return;
    if (this.dispatch({ type: 'skipUnit', unitId: u.id }) && !this.selectNextUnit()) this.renderHud();
  }

  // ------------------------------------------------------------------ HUD

  private renderHud(): void {
    const s = this.state;
    clear(this.el.topbar);
    clear(this.el.panel);
    if (!s) return;
    const player = s.players[s.currentPlayer];
    const civ = CIV_BY_ID[player.civId];
    this.el.topbar.append(
      h(
        'div',
        { class: 'civ-badge', style: `--civ:${civ?.color};--civ2:${civ?.secondaryColor}` },
        h('span', { class: 'civ-swatch' }),
        h('span', { class: 'civ-name' }, civ?.name ?? ''),
      ),
      h('div', { class: 'turn-info' }, h('strong', {}, `${T.turn} ${s.turn}`), h('small', {}, turnYear(s.turn))),
      h('button', { class: 'btn icon', 'aria-label': T.menu, onclick: () => this.showGameMenu() }, '☰'),
    );

    const waiting = unitsNeedingOrders(s, s.currentPlayer);
    const showNextUnit = waiting.length > 1 || (waiting.length === 1 && waiting[0].id !== this.selectedUnitId);
    this.el.endTurn.textContent = showNextUnit ? T.nextUnit : T.nextTurn;
    this.el.endTurn.classList.toggle('attention', showNextUnit);

    const u = this.selectedUnit();
    if (u) this.el.panel.append(this.unitPanel(u));
    else if (this.selectedTile !== undefined) this.el.panel.append(this.tilePanel(this.selectedTile));
    else if (waiting.length) this.el.panel.append(h('p', { class: 'muted' }, T.unitsWaiting(waiting.length)));
  }

  private unitPanel(u: Unit): HTMLElement {
    const s = this.state!;
    const def = UNITS[u.type];
    const actions: HTMLElement[] = [];
    if (def.canFoundCity) {
      const check = canFoundCity(s, u);
      actions.push(
        h(
          'button',
          {
            class: 'btn primary',
            disabled: !check.ok,
            title: check.ok ? '' : check.reason,
            onclick: () => this.foundCity(),
          },
          '🏛 ' + T.foundCity,
        ),
      );
    }
    if (def.class === 'military' && !u.fortified) {
      actions.push(h('button', { class: 'btn', onclick: () => this.dispatch({ type: 'fortify', unitId: u.id }) && this.selectNextUnit() }, '🛡 ' + T.fortify));
    }
    if (u.path?.length) {
      actions.push(h('button', { class: 'btn', onclick: () => this.dispatch({ type: 'cancelPath', unitId: u.id }) && this.renderHud() }, '✋ ' + T.cancelMove));
    }
    actions.push(h('button', { class: 'btn', onclick: () => this.skipSelected() }, '⏭ ' + T.skip));

    const info: (HTMLElement | string)[] = [
      h('strong', {}, `${def.glyph} ${def.name}`),
      h('small', {}, `${T.moves}: ${u.movesLeft}/${def.moves}${u.fortified ? ' · Fortificado' : ''}`),
    ];
    if (this.pendingPath) info.push(h('small', { class: 'hint' }, `${T.turnsTo(this.pendingPath.turns)} — ${T.confirmMove}`));
    else if (def.canFoundCity) {
      const check = canFoundCity(s, u);
      if (!check.ok) info.push(h('small', { class: 'muted' }, check.reason));
    }
    info.push(h('small', { class: 'muted' }, describeTile(s.map.tiles[u.pos])));
    return h('div', { class: 'panel-inner' }, h('div', { class: 'panel-info' }, ...info), h('div', { class: 'actions' }, ...actions));
  }

  private tilePanel(idx: number): HTMLElement {
    const s = this.state!;
    const explored = this.revealAll || s.players[s.currentPlayer].explored[idx] === 1;
    if (!explored) return h('div', { class: 'panel-inner' }, h('p', { class: 'muted' }, T.unexplored));
    const t = s.map.tiles[idx];
    const lines: HTMLElement[] = [h('strong', {}, describeTile(t))];
    if (t.wonder) {
      const w = WONDER_BY_ID[t.wonder];
      lines.push(h('small', { class: 'wonder' }, `★ ${w.name}`), h('small', { class: 'muted' }, w.description));
    }
    if (t.resource) {
      const r = RESOURCE_BY_ID[t.resource];
      lines.push(h('small', {}, `${r.icon} ${r.name} (${RESOURCE_KIND_LABEL[r.kind]})`));
    }
    const y = tileYields(t);
    const ys = YIELD_KEYS.filter((k) => y[k] > 0)
      .map((k) => `${YIELD_LABELS[k].icon} ${y[k]}`)
      .join('  ');
    lines.push(h('small', {}, `${T.yields}: ${ys || '—'}`));
    if (!isPassableLand(t) && t.terrain !== 'coast' && t.terrain !== 'ocean') lines.push(h('small', { class: 'muted' }, T.impassable));
    const city = s.cities.find((c) => c.pos === idx);
    if (city) lines.unshift(h('strong', {}, `${city.isCapital ? '★ ' : ''}${city.name} — ${T.population} ${city.population}`));
    if (t.owner !== undefined) {
      const civ = CIV_BY_ID[s.players[t.owner].civId];
      lines.push(h('small', { class: 'muted' }, `${T.owner}: ${civ?.name}`));
    }
    return h('div', { class: 'panel-inner' }, h('div', { class: 'panel-info' }, ...lines));
  }

  toast(msg: string): void {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.el.toast.classList.remove('show'), 2600);
  }

  // ------------------------------------------------------------------ menus

  private modalHost() {
    return { root: this.el.modal };
  }

  private showMainMenu(hasAutosave: boolean): void {
    const host = this.modalHost();
    const body = h(
      'div',
      { class: 'menu-list' },
      h('p', { class: 'muted' }, T.tagline),
      hasAutosave ? h('button', { class: 'btn primary wide', onclick: () => this.loadSlot(AUTOSAVE_SLOT) }, '▶ ' + T.continue) : null,
      h('button', { class: `btn wide${hasAutosave ? '' : ' primary'}`, onclick: () => this.showNewGame(false) }, '✦ ' + T.newGame),
      h('button', { class: 'btn wide', onclick: () => this.showLoad(false) }, '📂 ' + T.load),
    );
    openModal(host, T.appName, body, { closable: false });
  }

  private showGameMenu(): void {
    const host = this.modalHost();
    const body = h(
      'div',
      { class: 'menu-list' },
      h('button', { class: 'btn wide', onclick: () => this.showSave() }, '💾 ' + T.save),
      h('button', { class: 'btn wide', onclick: () => this.showLoad(true) }, '📂 ' + T.load),
      h('button', { class: 'btn wide', onclick: () => this.showNewGame(true) }, '✦ ' + T.newGame),
      h(
        'button',
        {
          class: 'btn wide',
          onclick: () => {
            this.revealAll = !this.revealAll;
            closeModal(host);
            this.invalidate();
          },
        },
        '👁 ' + T.revealMap,
      ),
      h('small', { class: 'muted' }, this.state ? `${T.seed}: ${this.state.settings.seed}` : ''),
    );
    openModal(host, T.menu, body);
  }

  private showNewGame(closable: boolean): void {
    const host = this.modalHost();
    const form = newGameForm((c) => {
      if (closable && this.state && !confirm(T.confirmNewGame)) return;
      closeModal(host);
      this.startNewGame(c.seed, c.mapSize, c.civId);
    }, this.state ? { mapSize: this.state.settings.mapSize, civId: this.state.players[0].civId } : undefined);
    if (!closable) {
      form.prepend(h('button', { class: 'btn', onclick: () => this.showMainMenu(!!readSlotInfo(AUTOSAVE_SLOT)) }, '← Voltar'));
    }
    openModal(host, T.newGame, form, { closable });
  }

  private showSave(): void {
    const host = this.modalHost();
    openModal(
      host,
      T.save,
      slotList('save', (slot) => {
        if (!this.state) return;
        try {
          saveToSlot(this.state, slot);
          this.toast(T.saved);
          closeModal(host);
        } catch (e) {
          this.toast(e instanceof Error ? e.message : String(e));
        }
      }),
    );
  }

  private showLoad(closable: boolean): void {
    const host = this.modalHost();
    const list = slotList('load', (slot) => this.loadSlot(slot));
    if (!closable) list.prepend(h('button', { class: 'btn', onclick: () => this.showMainMenu(!!readSlotInfo(AUTOSAVE_SLOT)) }, '← Voltar'));
    openModal(host, T.load, list, { closable });
  }

  private loadSlot(slot: string): void {
    try {
      const s = loadFromSlot(slot);
      if (!s) return this.toast(T.emptySlot);
      closeModal(this.modalHost());
      this.selectedUnitId = undefined;
      this.selectedTile = undefined;
      this.pendingPath = undefined;
      this.setState(s);
      if (!this.selectNextUnit()) this.centerOnSelection();
      this.toast(T.loaded);
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    }
  }
}
