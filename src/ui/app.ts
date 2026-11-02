import { CIV_BY_ID } from '../data/civs';
import { FEATURE_REMOVAL, IMPROVEMENTS } from '../data/improvements';
import { RESOURCE_BY_ID, RESOURCE_KIND_LABEL } from '../data/resources';
import { UNITS } from '../data/units';
import { WONDER_BY_ID } from '../data/wonders';
import { YIELD_KEYS, YIELD_LABELS } from '../data/yields';
import { clampCamera, clampZoom, type Camera, zoomAt } from '../render/camera';
import { nearCenter, Renderer, tileAtWorld, tileCenter, worldSize, type Overlay } from '../render/renderer';
import type { MapView } from '../render/view';
import { activeHumans, applyAction, nextHuman, unitsNeedingOrders, type Action, type ActionResult } from '../rules/actions';
import { playEndTurn, proposeDeal } from '../ai';
import { unitStrength } from '../ai/common';
import {
  areFriends,
  attitudeLabel,
  cannotDeclareWar,
  envoysOf,
  hasMet,
  hasOpenBorders,
  isAtWar,
  opinionParts,
  peekRelation,
  playerName,
  suzerainOf,
} from '../rules/diplomacy';
import { CITY_STATE_BY_ID, CITY_STATE_TYPES } from '../data/cityStates';
import type { DealItem } from '../state/types';
import { availableImprovements, canBuildRoad, canPillage, canRemoveFeature, canRepair } from '../rules/builders';
import {
  borderThreshold,
  cannotProduce,
  cityHousing,
  cityYields,
  citiesNeedingProduction,
  expansionCandidates,
  FOCUS_LABELS,
  foodSurplus,
  growthThreshold,
  itemCost,
  specialistSlots,
  itemKey,
  itemDescription,
  itemName,
  normalizeState,
  playerIncome,
  productionOptions,
  purchaseCost,
  tilePurchaseCost,
  turnsToGrow,
  turnsToProduce,
  workableTiles,
} from '../rules/cities';
import { canFoundCity } from '../rules/city';
import { rankSites, siteInfo, siteSummary, siteWarnings, type SiteRanking } from '../rules/settle';
import {
  cultureProgress,
  dominationProgress,
  playerEra,
  religionProgress,
  scienceProgress,
  scoreOf,
  VICTORY_LABELS,
} from '../rules/victory';
import { loadPrefs, savePrefs, applyPrefs, type Prefs } from './prefs';
import { play, setSoundEnabled, unlockAudio, type Sfx } from './audio';
import { TIPS } from './tutorial';
import { cityAmenities, effectiveLuxuries, maintenanceOf, tradeableLuxuries } from '../rules/economy';
import { gpCost, gpPerTurn } from '../rules/greatPeople';
import {
  availableFollowerBeliefs,
  availablePantheons,
  availableReligionNames,
  canBuyMissionary,
  cannotFoundReligion,
  cannotPurge,
  cannotTheology,
  religiousStrength,
  religionOf,
} from '../rules/religion';
import { routesOf, routeYields, tradeCapacity, tradeDestinations } from '../rules/trade';
import { distance, hexLine, neighbors } from '../rules/hex';
import { Fx, moveDuration } from './fx';

/** Ponto para onde a câmera vai durante a reprodução das jogadas dos rivais. */
type CamKey = { at: number; x: number; y: number };

/** Posição, tipo e dono das unidades antes de uma ação (para animar o que mudou). */
type UnitSnap = Map<number, { pos: number; type: string; owner: number }>;
import { FOLLOWER_BY_ID, PANTHEON_BY_ID, PANTHEON_COST, RELIGION_NAME_BY_ID } from '../data/religion';
import { GREAT_PERSON_TYPES } from '../data/greatPeople';
import { adjacencyBonus, districtLimit, districtSites, wonderSites } from '../rules/districts';
import { DISTRICTS, type DistrictId } from '../data/districts';
import { WORLD_WONDER_BY_ID } from '../data/worldWonders';
import {
  attackTargets,
  canPromote,
  cityAttackTargets,
  cityMaxHp,
  cityStrength,
  previewAttack,
  promotionOptions,
  unitRange,
  xpForNext,
} from '../rules/combat';
import { PROMOTION_BY_ID } from '../data/promotions';
import { newGame, turnYear } from '../rules/game';
import { findPath, reachableThisTurn } from '../rules/movement';
import { describeTile, isPassableLand, tileYields, visibleResource } from '../rules/tiles';
import { governmentSlots, availableGovernments, availablePolicies, canSlotPolicy, policyUnlockCost } from '../rules/effects';
import { availableItems, needsResearchChoice, progressOf, treeCost, treeDepth, turnsFor, type TreeKind } from '../rules/research';
import { improvementFits } from '../rules/builders';
import { TECHS, TECH_BY_ID } from '../data/techs';
import { CIVICS, CIVIC_BY_ID } from '../data/civics';
import { GOVERNMENTS, GOVERNMENT_BY_ID, POLICY_BY_ID, SLOT_LABELS } from '../data/governments';
import type { ImprovementId } from '../data/improvements';
import { computeVisibility } from '../rules/visibility';
import { AUTOSAVE_SLOT, loadFromSlot, readSlotInfo, saveToSlot, SaveError } from '../state/save';
import type { City, CityFocus, GameState, ProductionItem, Unit } from '../state/types';
import { clear, h } from './dom';
import { attachInput } from './input';
import { closeModal, newGameForm, openModal, slotList } from './menus';
import { T } from './strings';

const religionLabel = (id: string) => `${RELIGION_NAME_BY_ID[id]?.icon ?? ''} ${RELIGION_NAME_BY_ID[id]?.name ?? id}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Controlador da interface: guarda o estado atual do jogo, a câmera e a seleção,
 * despacha ações para as regras puras e redesenha sob demanda.
 */
export class App {
  private state: GameState | null = null;
  private cam: Camera = { x: 0, y: 0, zoom: 1 };
  private renderer: Renderer;
  /** Visão ativa do mapa: o próprio `renderer` (2D) ou a 3D carregada sob demanda. */
  private view: MapView;
  private glCanvas?: HTMLCanvasElement;
  private vis: Uint8Array = new Uint8Array(0);
  private selectedUnitId: number | undefined;
  private selectedTile: number | undefined;
  private selectedCityId: number | undefined;
  private pendingBuyTile: number | undefined;
  /** Alvo de ataque aguardando confirmação (unidade ou cidade selecionada). */
  private pendingAttack: number | undefined;
  /** Escolha de hexágono para distrito/maravilha. */
  private placement: { cityId: number; item: ProductionItem; mode: 'set' | 'enqueue'; sites: number[]; chosen?: number } | undefined;
  /** Turno em que o jogador já viu o aviso de políticas (só UI). */
  private policyPromptSeenTurn = -1;
  private pendingPath: { target: number; path: number[]; turns: number } | undefined;
  private reachable: Set<number> | undefined;
  private revealAll = false;
  private dirty = true;
  private toastTimer = 0;
  private prefs: Prefs = loadPrefs();
  private victoryShown = false;
  /** Efeitos visuais temporários (movimento, combate, anéis, textos). */
  private fx = new Fx();
  /** Transição suave da câmera (centralizar, zoom pelos botões). */
  private camTween?: { from: Camera; to: Camera; start: number; dur: number };
  private lastPulse = 0;

  private el = {
    canvas: h('canvas', { id: 'map', 'aria-label': 'Mapa do jogo' }),
    topbar: h('header', { class: 'topbar' }),
    zoom: h('div', { class: 'zoom-ctrl' }),
    panel: h('section', { class: 'panel', 'aria-live': 'polite' }),
    endTurn: h('button', { class: 'btn primary end-turn' }, T.nextTurn),
    toast: h('div', { class: 'toast', role: 'status' }),
    tip: h('div', { class: 'tip', hidden: true, role: 'note' }),
    modal: h('div', { class: 'modal', hidden: true }),
    banner: h('div', { class: 'turn-banner', 'aria-hidden': 'true' }),
    playback: h('button', { class: 'playback-hint', hidden: true }, T.playbackHint),
  };

  constructor(root: HTMLElement) {
    const bottom = h('div', { class: 'bottombar' }, this.el.panel, this.el.endTurn);
    applyPrefs(this.prefs);
    setSoundEnabled(this.prefs.sound);
    // áudio só pode começar após um gesto; cliques em botões fazem um "tique"
    root.addEventListener('pointerdown', () => unlockAudio(), { capture: true });
    root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest?.('button')) play('click');
    });
    this.el.playback.addEventListener('click', () => this.skipPlayback());
    root.append(this.el.canvas, this.el.banner, this.el.playback, this.el.topbar, this.el.zoom, bottom, this.el.toast, this.el.modal, this.el.tip);
    this.renderer = new Renderer(this.el.canvas);
    this.view = this.renderer;

    this.el.zoom.append(
      h('button', { class: 'btn icon', 'aria-label': T.zoomIn, onclick: () => this.zoomBy(1.25) }, '+'),
      h('button', { class: 'btn icon', 'aria-label': T.zoomOut, onclick: () => this.zoomBy(0.8) }, '−'),
      h('button', { class: 'btn icon', 'aria-label': T.centerUnit, onclick: () => this.centerOnSelection() }, '◎'),
    );
    this.el.endTurn.addEventListener('click', () => this.onEndTurnButton());

    attachInput(this.el.canvas, {
      onPan: (dx, dy) => {
        this.camTween = undefined;
        if (this.playback) this.playback.plan = [];
        const k = this.view.panScale(this.cam);
        this.cam = this.clampCam({ ...this.cam, x: this.cam.x - dx * k.x, y: this.cam.y - dy * k.y });
        this.invalidate();
      },
      onZoom: (f, sx, sy) => {
        this.camTween = undefined;
        this.cam = this.clampCam(zoomAt(this.cam, this.view.vw, this.view.vh, sx, sy, this.cam.zoom * f));
        this.invalidate();
      },
      onTap: (sx, sy) => this.onTap(sx, sy),
    });

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.resize();
    void this.applyViewPref();
    this.loop();
    // gancho de depuração/testes automatizados (somente leitura)
    (window as unknown as { __rep6civ?: unknown }).__rep6civ = {
      camera: () => ({ ...this.cam }),
      turn: () => this.state?.turn,
      view: () => this.view.kind,
      tileToScreen: (idx: number) => (this.state ? this.view.tileToScreen(this.state, this.cam, idx) : null),
    };
  }

  // ------------------------------------------------------------------ ciclo

  start(): void {
    const auto = readSlotInfo(AUTOSAVE_SLOT);
    this.showMainMenu(!!auto);
  }

  private loop = () => {
    const now = performance.now();
    if (this.fx.active(now)) this.dirty = true;
    this.stepPlayback(now);
    if (this.camTween) {
      const { from, to, start, dur } = this.camTween;
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      this.cam = this.clampCam({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, zoom: from.zoom + (to.zoom - from.zoom) * e });
      if (t >= 1) this.camTween = undefined;
      this.dirty = true;
    }
    // pulso da unidade selecionada (~20 quadros/s para poupar bateria)
    // água e nuvens do 3D (alta qualidade) pedem quadros extras, nunca com o mapa coberto
    if (this.prefs.animations && this.el.modal.hidden && this.view.wantsFrame?.(now)) this.dirty = true;
    const pulsing = this.prefs.animations && this.selectedUnitId !== undefined && this.el.modal.hidden;
    if (pulsing && now - this.lastPulse > 50) {
      this.lastPulse = now;
      this.dirty = true;
    }
    if (this.dirty && this.state) {
      this.dirty = false;
      const { unitPositions, projectiles, floaters, ghosts, bursts } = this.fx.frame(now);
      const overlay: Overlay = {
        selectedUnitId: this.selectedUnitId,
        selectedTile: this.selectedTile,
        reachable: this.reachable,
        path: this.pendingPath?.path ?? this.selectedUnit()?.path,
        pathTurns: this.pendingPath?.turns ?? this.pathTurnsForSelected(),
        revealAll: this.revealAll,
        cityView: this.placement ? undefined : this.cityViewOverlay(),
        attackTargets: this.placement ? undefined : this.currentAttackTargets(),
        placement: this.placementOverlay(),
        pendingAttack: this.pendingAttack,
        cityInfo: this.cityInfo(),
        settle: this.placement ? undefined : this.settleOverlay(),
        unitPositions: unitPositions.size ? unitPositions : undefined,
        floaters,
        projectiles,
        ghosts,
        bursts,
        pulse: pulsing ? (now % 1400) / 1400 : undefined,
      };
      this.view.draw(this.state, this.cam, this.vis, overlay);
    }
    requestAnimationFrame(this.loop);
  };

  /** Liga/desliga o mapa 3D conforme a preferência (o módulo 3D só é baixado quando usado). */
  private async applyViewPref(rebuild = false): Promise<void> {
    const want3d = this.prefs.view3d;
    if (want3d === (this.view.kind === '3d') && !(rebuild && want3d)) return;
    if (!want3d || rebuild) {
      this.view.dispose?.();
      this.glCanvas?.remove();
      this.glCanvas = undefined;
      this.view = this.renderer;
      document.body.classList.remove('map-3d');
      this.resize();
      if (!want3d) return;
    }
    try {
      const mod = await import('../render3d/renderer3d');
      if (!this.prefs.view3d || this.view.kind === '3d') return;
      if (!mod.webglAvailable()) throw new Error('sem WebGL2');
      const gl = h('canvas', { class: 'map-gl', 'aria-hidden': 'true' }) as HTMLCanvasElement;
      this.el.canvas.before(gl);
      this.glCanvas = gl;
      const quality = this.prefs.hq3d === undefined ? mod.defaultQuality() : this.prefs.hq3d ? 'high' : 'low';
      this.view = new mod.Renderer3D(gl, this.renderer, (c) => new Renderer(c), quality);
      document.body.classList.add('map-3d');
      this.resize();
    } catch (e) {
      console.warn('3D indisponível', e);
      this.glCanvas?.remove();
      this.glCanvas = undefined;
      this.view = this.renderer;
      this.prefs.view3d = false;
      savePrefs(this.prefs);
      this.toast(T.view3dUnavailable);
    }
  }

  private invalidate(): void {
    this.dirty = true;
  }

  private resize(): void {
    this.view.resize();
    if (this.state) this.cam = this.clampCam(this.cam);
    this.invalidate();
  }

  private clampCam(c: Camera): Camera {
    if (!this.state) return c;
    const ws = worldSize(this.state);
    if (this.state.map.wrap) {
      // volta leste-oeste: x circula, só y é limitado
      const P = ws.w;
      const cl = clampCamera({ ...c, zoom: clampZoom(c.zoom) }, P, ws.h);
      return { ...cl, x: ((c.x % P) + P) % P };
    }
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
    const before: UnitSnap = new Map(this.state.units.map((u) => [u.id, { pos: u.pos, type: u.type, owner: u.owner }]));
    const beforeVis = this.vis;
    const viewer = this.state.currentPlayer;
    // o fim de turno passa pela IA (rivais e cidades-estado jogam antes da rodada terminar)
    const result = action.type === 'endTurn' ? playEndTurn(this.state) : applyAction(this.state, action);
    const ok = this.applyResult(result, action.type === 'endTurn' || action.type === 'passTurn');
    if (ok) this.animateResult(before, beforeVis, viewer, result.events, action.type === 'endTurn');
    return ok;
  }

  private animateResult(before: UnitSnap, beforeVis: Uint8Array, viewer: number, events: ActionResult['events'], endTurn: boolean): void {
    const s = this.state!;
    // no multijogador local, quem assume a vez não deve ver o que aconteceu na vez do outro
    if (this.prefs.animations && viewer === s.currentPlayer) {
      const sequential = endTurn && !!this.prefs.watchAi;
      const { end, plan } = this.queueEffects(before, beforeVis, events, sequential);
      if (sequential && end > performance.now() + 50) {
        this.playback = { until: end + 250, plan };
        this.el.playback.hidden = false;
      }
    }
    let sfx: Sfx | null = endTurn ? 'endTurn' : null;
    for (const ev of events) {
      if (ev.type === 'combat') {
        if (ev.attackerOwner === s.currentPlayer || ev.defenderOwner === s.currentPlayer) sfx = 'combat';
      } else if (ev.type === 'cityFounded') sfx = 'city';
      else if (ev.type === 'firstContact' || ev.type === 'warDeclared' || ev.type === 'eraChanged' || ev.type === 'greatPerson') sfx = sfx ?? 'notify';
      else if (ev.type === 'victory') sfx = 'victory';
    }
    if (sfx) play(sfx);
    this.invalidate();
  }

  /**
   * Monta a linha do tempo visual de uma ação ou de uma rodada inteira: cada unidade segue
   * o próprio cursor de tempo (anda → ataca → avança), então movimentos e ataques da IA
   * aparecem na ordem em que aconteceram. Outros jogadores só animam onde você vê.
   */
  private queueEffects(before: UnitSnap, beforeVis: Uint8Array, events: ActionResult['events'], sequential = false): { end: number; plan: CamKey[] } {
    const s = this.state!;
    const now = performance.now();
    const viewer = s.currentPlayer;
    // passo a passo: um cursor global encadeia as jogadas e a câmera vai até cada uma
    let seq = now;
    const plan: CamKey[] = [];
    const vc = { x: this.cam.x, y: this.cam.y };
    const reach = (Math.min(this.view.vw, this.view.vh) * 0.3) / this.cam.zoom;
    const focus = (p: { x: number; y: number }, t: number): number => {
      if (!sequential) return t;
      const dx = this.wrapDx(p.x - vc.x);
      if (Math.hypot(dx, p.y - vc.y) <= reach) return t;
      plan.push({ at: t, x: p.x, y: p.y });
      vc.x = p.x;
      vc.y = p.y;
      return t + 520;
    };
    const seen = (i: number) => this.revealAll || !!this.vis[i] || !!beforeVis[i];
    const cursor = new Map<number, number>();
    const lastPos = new Map<number, number>();
    const ghosted = new Set<number>();
    const after = new Map(s.units.map((u) => [u.id, u]));
    const posOf = (id: number) => lastPos.get(id) ?? before.get(id)?.pos;
    const at = (id: number) => Math.max(cursor.get(id) ?? now, sequential ? seq : now);
    const chain = (route: number[]) => {
      const pts: { x: number; y: number }[] = [];
      for (const i of route) pts.push(pts.length ? nearCenter(s, i, pts[pts.length - 1]) : tileCenter(s, i));
      return pts;
    };
    /** Agenda o deslocamento de `id` pela rota; devolve quando termina. */
    const walk = (id: number, route: number[]): number => {
      const t0 = at(id);
      if (route.length < 2) return t0;
      lastPos.set(id, route[route.length - 1]);
      const owner = after.get(id)?.owner ?? before.get(id)?.owner;
      let r = route;
      if (owner !== viewer) {
        const k = r.findIndex(seen);
        r = k < 0 ? [] : r.slice(k);
      }
      if (r.length < 2) return t0;
      const dur = moveDuration(r.length - 1);
      const pts = chain(r);
      const t1 = focus(pts[0], t0);
      this.fx.move(id, pts, t1, dur);
      cursor.set(id, t1 + dur);
      if (sequential) seq = t1 + dur + 90;
      return t1 + dur;
    };
    /** Caminho aproximado (sem evento detalhado, ex.: bárbaros); longe demais = salto. */
    const line = (a: number, b: number) => (a === b ? [a] : distance(s.map, a, b) <= 6 ? hexLine(s.map, a, b) : [a]);
    const sync = (id: number, pos: number) => {
      const p = posOf(id);
      if (p !== undefined && p !== pos) walk(id, line(p, pos));
      if (p === undefined || line(p, pos).length < 2) lastPos.set(id, pos);
    };
    const findAttacker = (ev: Extract<ActionResult['events'][number], { type: 'combat' }>) => {
      let best: number | undefined;
      let bestD = Infinity;
      for (const [id, b] of before) {
        if (b.owner !== ev.attackerOwner || b.type !== ev.attackerType) continue;
        const u = after.get(id);
        const d = u ? (u.pos === ev.from || u.pos === ev.pos ? -1 : distance(s.map, u.pos, ev.from)) : distance(s.map, posOf(id)!, ev.from);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      return bestD <= 6 ? best : undefined;
    };

    for (const ev of events) {
      if (ev.type === 'unitMoved') {
        sync(ev.unitId, ev.from);
        walk(ev.unitId, [ev.from, ...(ev.trail?.length ? ev.trail : line(ev.from, ev.to).slice(1))]);
      } else if (ev.type === 'combat') {
        const atkId = ev.attackerType === 'city' ? undefined : findAttacker(ev);
        if (atkId !== undefined) sync(atkId, ev.from);
        if (!seen(ev.pos) && !seen(ev.from)) continue;
        const c = tileCenter(s, ev.pos);
        const t0 = focus(c, atkId !== undefined ? at(atkId) : sequential ? seq : now);
        const from = nearCenter(s, ev.from, c);
        const ranged = ev.attackerType === 'city' || !!UNITS[ev.attackerType]?.rangedStrength;
        const heavy = ev.attackerType === 'city' || UNITS[ev.attackerType]?.combat === 'siege';
        let impact: number;
        if (ranged) {
          this.fx.projectile(from, c, t0, heavy, heavy ? 380 : 300);
          impact = t0 + (heavy ? 380 : 300);
        } else {
          if (atkId !== undefined) this.fx.lunge(atkId, from, c, t0, 340);
          impact = t0 + 210;
        }
        this.fx.burst(c, ranged ? '#ffd38a' : '#ff9a6b', 'impact', impact);
        this.fx.floater(c.x, c.y - 10, `−${ev.damageToTarget}`, '#ff6b5b', impact, ev.damageToTarget >= 40 ? 17 : 14);
        if (ev.damageToAttacker > 0) this.fx.floater(from.x, from.y - 10, `−${ev.damageToAttacker}`, '#ffb36b', impact + 80, 12);
        // defensor sobrevivente estremece; mortos somem depois do golpe
        const defender = s.units.find((u) => u.pos === ev.pos && u.owner === ev.defenderOwner && UNITS[u.type].class === 'military');
        if (defender && !ev.targetKilled) this.fx.shake(defender.id, c, impact);
        if (ev.targetKilled) {
          for (const [id, b] of before) {
            if (!after.has(id) && b.owner === ev.defenderOwner && posOf(id) === ev.pos && !ghosted.has(id)) {
              ghosted.add(id);
              this.fx.ghost(b.type, b.owner, c, now, impact);
            }
          }
        }
        if (ev.attackerKilled && atkId !== undefined && !ghosted.has(atkId)) {
          ghosted.add(atkId);
          const b = before.get(atkId)!;
          this.fx.ghost(b.type, b.owner, from, now, impact + 120);
        }
        if (sequential) seq = impact + 450;
        if (atkId !== undefined) {
          cursor.set(atkId, t0 + (ranged ? 300 : 340));
          // corpo a corpo que venceu avança para o hexágono
          if (!ranged && after.get(atkId)?.pos === ev.pos) walk(atkId, [ev.from, ev.pos]);
        }
      } else if (ev.type === 'cityFounded' || ev.type === 'cityCaptured') {
        const city = s.cities.find((c) => c.id === ev.cityId);
        if (city && seen(city.pos)) this.fx.burst(tileCenter(s, city.pos), ev.type === 'cityFounded' ? '#ffd23f' : '#ff5b5b', 'ring', now);
      } else if (ev.type === 'campCleared' && seen(ev.pos)) {
        const c = tileCenter(s, ev.pos);
        this.fx.burst(c, '#ffd23f', 'ring', now);
        if (ev.by === viewer) this.fx.floater(c.x, c.y - 14, `+${ev.gold} 🪙`, '#ffd23f', now + 150, 14, 1500);
      }
    }
    // movimentos sem evento (bárbaros, expulsões, avanço após captura de civil)
    for (const u of s.units) {
      const p = posOf(u.id);
      if (p !== undefined && p !== u.pos) walk(u.id, line(p, u.pos));
    }
    return { end: seq, plan };
  }

  // ------------------------------------------------------------------ jogadas dos rivais passo a passo

  private playback?: { until: number; plan: CamKey[] };
  private afterPlayback?: () => void;

  private stepPlayback(now: number): void {
    const pb = this.playback;
    if (!pb) return;
    while (pb.plan.length && pb.plan[0].at <= now) {
      const k = pb.plan.shift()!;
      this.moveCamera({ ...this.cam, x: k.x, y: k.y }, 450);
    }
    if (now >= pb.until) this.finishPlayback();
  }

  private finishPlayback(): void {
    if (!this.playback) return;
    this.playback = undefined;
    this.el.playback.hidden = true;
    const f = this.afterPlayback;
    this.afterPlayback = undefined;
    f?.();
    this.invalidate();
  }

  /** Toque durante a reprodução: pula para o fim. */
  private skipPlayback(): void {
    this.fx.clear();
    this.finishPlayback();
  }

  /** Novo jogo, carregar ou passar a vez: descarta efeitos e reprodução pendentes. */
  private resetFx(): void {
    this.fx.clear();
    this.playback = undefined;
    this.afterPlayback = undefined;
    this.el.playback.hidden = true;
  }

  /** Mostra "Turno N · ano" por um instante no centro da tela. */
  private showTurnBanner(): void {
    if (!this.state || !this.prefs.animations) return;
    const b = this.el.banner;
    b.replaceChildren(h('strong', {}, `${T.turn} ${this.state.turn}`), h('span', {}, turnYear(this.state.turn)));
    b.classList.remove('show');
    void b.offsetWidth; // reinicia a animação CSS
    b.classList.add('show');
  }

  /**
   * Aplica o resultado e distribui os avisos. No multijogador local, cada humano recebe os
   * avisos do ponto de vista dele: quem está jogando vê na hora; os demais (ou todos, ao
   * passar a vez/fechar a rodada) recebem na caixa de entrada, mostrada no início da vez.
   */
  private applyResult({ state, events }: ActionResult, deferAll = false): boolean {
    if (!this.state) return false;
    let ok = true;
    for (const ev of events) {
      if (ev.type === 'error') {
        this.toast(ev.message);
        play('error');
        ok = false;
      }
    }
    if (ok) {
      this.setState(state);
      const humans = activeHumans(state);
      this.deferMessages = deferAll;
      if (humans.length > 1) {
        for (const h of humans) {
          const msgs = events.map((ev) => this.eventMessage(ev, state, h)).filter((m): m is string => !!m);
          if (!msgs.length) continue;
          if (!deferAll && h === state.currentPlayer) this.showMessages(msgs);
          else (this.inbox[h] ??= []).push(...msgs);
        }
        this.saveInbox();
      } else {
        this.showMessages(events.map((ev) => this.eventMessage(ev, state)).filter((m): m is string => !!m));
      }
      this.deferMessages = false;
    }
    return ok;
  }

  private showMessages(msgs: string[]): void {
    if (msgs.length) this.toast(msgs.slice(0, 3).join('\n') + (msgs.length > 3 ? `\n(+${msgs.length - 3})` : ''));
  }

  /** Caixa de entrada do multijogador local, guardada no aparelho junto com a partida. */
  private inbox: Record<number, string[]> = {};
  /** Avisos sendo guardados para depois (passagem de vez): sem dicas na tela. */
  private deferMessages = false;
  private inboxKey(): string {
    return `rep6civ.inbox.${this.state?.settings.seed ?? ''}`;
  }
  private saveInbox(): void {
    try {
      localStorage.setItem(this.inboxKey(), JSON.stringify(this.inbox));
    } catch {
      /* sem armazenamento: a caixa fica só na memória */
    }
  }
  private loadInbox(): void {
    try {
      this.inbox = JSON.parse(localStorage.getItem(this.inboxKey()) ?? '{}') ?? {};
    } catch {
      this.inbox = {};
    }
  }

  /** Mostra (e esvazia) os avisos guardados para o jogador atual. */
  private showInbox(): void {
    const s = this.state;
    if (!s) return;
    const msgs = this.inbox[s.currentPlayer] ?? [];
    if (!msgs.length) return;
    delete this.inbox[s.currentPlayer];
    this.saveInbox();
    const host = this.modalHost();
    openModal(
      host,
      T.inboxTitle,
      h(
        'div',
        { class: 'form' },
        ...msgs.map((m) => h('div', { class: 'dip-card' }, h('small', {}, m))),
        h(
          'button',
          {
            class: 'btn primary wide',
            onclick: () => {
              closeModal(host);
              if (s.proposals.some((x) => x.to === s.currentPlayer)) this.showProposals();
            },
          },
          T.gotIt,
        ),
      ),
    );
  }

  private eventMessage(ev: ReturnType<typeof applyAction>['events'][number], s: GameState, viewer = s.currentPlayer): string | null {
    const cname = (id: number) => s.cities.find((c) => c.id === id)?.name ?? '';
    const mineCity = (id: number) => s.cities.find((c) => c.id === id)?.owner === viewer;
    switch (ev.type) {
      case 'cityFounded': {
        const owner = s.cities.find((c) => c.id === ev.cityId)?.owner;
        if (owner === viewer) return T.cityFounded(ev.name);
        return owner !== undefined && hasMet(s, viewer, owner) && !s.players[owner].isCityState
          ? T.cityFoundedBy(playerName(s, owner), ev.name)
          : null;
      }
      case 'produced': {
        const owner = s.cities.find((c) => c.id === ev.cityId)?.owner;
        if (ev.item.kind === 'wonder') return T.wonderBuilt(itemName(ev.item), owner === undefined ? '?' : playerName(s, owner));
        return owner === viewer ? T.produced(cname(ev.cityId), itemName(ev.item)) : null;
      }
      case 'grew':
        return mineCity(ev.cityId) ? T.grew(cname(ev.cityId), ev.population) : null;
      case 'starved':
        return mineCity(ev.cityId) ? T.starved(cname(ev.cityId), ev.population) : null;
      case 'borderGrew':
        return mineCity(ev.cityId) ? T.borderGrew(cname(ev.cityId)) : null;
      case 'info':
        return ev.message;
      case 'combat': {
        const atk = ev.attackerType === 'city' ? T.cityWord : UNITS[ev.attackerType]?.name ?? ev.attackerType;
        const mine = ev.attackerOwner === viewer;
        const theirs = ev.defenderOwner === viewer;
        if (!mine && !theirs) return null;
        let m = T.combatMsg(atk, ev.targetName, ev.damageToTarget, ev.damageToAttacker, !mine);
        if (ev.targetKilled) m += ' ' + T.killed(ev.targetName);
        if (ev.attackerKilled) m += ' ' + T.killed(atk);
        return m;
      }
      case 'captured':
        if (ev.by === viewer) return T.capturedMsg(UNITS[ev.unitType]?.name ?? ev.unitType);
        return ev.from === viewer ? T.lostCivilian(UNITS[ev.unitType]?.name ?? ev.unitType) : null;
      case 'cityCaptured':
        return ev.by === viewer || hasMet(s, viewer, ev.by) ? T.cityCapturedMsg(ev.name) : null;
      case 'campCleared':
        return ev.by === viewer ? T.campCleared(ev.gold) : null;
      case 'unitLost':
        return ev.owner === viewer ? T.lostCivilian(UNITS[ev.unitType]?.name ?? ev.unitType) : null;
      case 'firstContact': {
        const me = viewer;
        if (ev.a !== me && ev.b !== me) return null;
        if (viewer === s.currentPlayer && !this.deferMessages) this.tip('contact');
        return T.firstContact(playerName(s, ev.a === me ? ev.b : ev.a));
      }
      case 'warDeclared':
        if (ev.on === viewer) return T.warOnUs(playerName(s, ev.by));
        if (ev.by === viewer) return T.weDeclared(playerName(s, ev.on));
        return hasMet(s, viewer, ev.by) ? T.warBetween(playerName(s, ev.by), playerName(s, ev.on)) : null;
      case 'peaceMade': {
        const me = viewer;
        if (ev.a === me || ev.b === me) return T.peaceWith(playerName(s, ev.a === me ? ev.b : ev.a));
        return null;
      }
      case 'agreement': {
        const me = viewer;
        if (ev.a !== me && ev.b !== me) return null;
        return T.agreementMsg(ev.item, playerName(s, ev.a === me ? ev.b : ev.a));
      }
      case 'dealRejected':
        return T.dealRejected(playerName(s, ev.by), ev.reason);
      case 'suzerainChanged':
        return hasMet(s, viewer, ev.cityState)
          ? T.suzerainMsg(playerName(s, ev.cityState), ev.suzerain === null ? null : playerName(s, ev.suzerain))
          : null;
      case 'eliminated':
        return hasMet(s, viewer, ev.player) ? T.eliminatedMsg(playerName(s, ev.player)) : null;
      case 'envoyGained':
        return ev.player === viewer ? T.envoyGained : null;
      case 'theology':
        if (ev.attacker !== viewer && ev.defender !== viewer) return null;
        return T.theologyMsg(religionLabel(ev.winnerReligion), religionLabel(ev.loserReligion));
      case 'disbanded':
        return ev.player === viewer ? T.disbandedMsg(UNITS[ev.unitType]?.name ?? ev.unitType) : null;
      case 'routeCreated':
        return ev.owner === viewer ? T.routeCreated(cname(ev.from), cname(ev.to)) : null;
      case 'routeLost':
        return ev.owner === viewer ? T.routeLost(cname(ev.from), cname(ev.to)) : null;
      case 'pantheon':
        return ev.player === viewer ? T.pantheonMsg(PANTHEON_BY_ID[ev.belief]?.name ?? ev.belief) : null;
      case 'religionFounded':
        return T.religionFoundedMsg(playerName(s, ev.player), religionLabel(ev.religion));
      case 'cityConverted': {
        const c = s.cities.find((x) => x.id === ev.cityId);
        return c && c.owner === viewer ? T.convertedMsg(c.name, religionLabel(ev.religion)) : null;
      }
      case 'greatPerson': {
        const def = GREAT_PERSON_TYPES[ev.gpType];
        return ev.player === viewer ? T.gpRecruited(ev.name, def.name) : hasMet(s, viewer, ev.player) ? T.gpOther(playerName(s, ev.player), ev.name) : null;
      }
      case 'researchAgreementDone':
        return ev.a === viewer || ev.b === viewer ? T.researchDone(ev.science) : null;
      case 'luxuryDealEnded':
        return ev.from === viewer || ev.to === viewer ? T.luxuryEnded(RESOURCE_BY_ID[ev.resource]?.name ?? ev.resource) : null;
      case 'eraChanged':
        return ev.player === viewer ? T.eraMsg(ev.era) : null;
      case 'victory':
        return null;
      case 'techDone':
        return ev.playerId === viewer ? T.techDone(TECH_BY_ID[ev.id]?.name ?? ev.id) : null;
      case 'civicDone':
        if (ev.playerId === viewer && viewer === s.currentPlayer && !this.deferMessages && s.players[viewer].government) this.tip('policies');
        return ev.playerId === viewer ? `${T.civicDone(CIVIC_BY_ID[ev.id]?.name ?? ev.id)} ${T.policyWindow}` : null;
      case 'boost':
        return ev.playerId === viewer
          ? T.boosted(ev.kind, (ev.kind === 'tech' ? TECH_BY_ID : CIVIC_BY_ID)[ev.id]?.name ?? ev.id)
          : null;
      case 'governmentUnlocked':
        return ev.playerId === viewer ? T.govUnlocked(GOVERNMENT_BY_ID[ev.id]?.name ?? ev.id) : null;
      default:
        return null;
    }
  }

  private selectedCity(): City | undefined {
    return this.state?.cities.find((c) => c.id === this.selectedCityId);
  }

  private cityViewOverlay(): Overlay['cityView'] {
    const s = this.state;
    const c = this.selectedCity();
    if (!s || !c) return undefined;
    const buyable = new Map<number, number>();
    const explored = s.players[s.currentPlayer].explored;
    for (const i of expansionCandidates(s, c)) if (this.revealAll || explored[i]) buyable.set(i, tilePurchaseCost(s, c, i));
    return { cityId: c.id, worked: new Set(c.worked), locked: new Set(c.locked), workable: workableTiles(s, c), buyable };
  }

  private cityInfo(): Overlay['cityInfo'] {
    const s = this.state;
    if (!s) return undefined;
    const m: NonNullable<Overlay['cityInfo']> = new Map();
    for (const c of s.cities) {
      if (c.owner !== s.currentPlayer) continue;
      const item = c.queue[0];
      m.set(c.id, {
        growTurns: turnsToGrow(s, c),
        prodName: item ? itemName(item) : undefined,
        prodTurns: item ? turnsToProduce(s, c, item) : undefined,
        prodFrac: item ? (c.progress[itemKey(item)] ?? 0) / Math.max(1, itemCost(item)) : 0,
      });
    }
    return m;
  }

  private startPlacement(c: City, item: ProductionItem, mode: 'set' | 'enqueue'): void {
    const s = this.state!;
    const sites = item.kind === 'district' ? districtSites(s, c, item.id) : wonderSites(s, c, item.id);
    if (!sites.length) return this.toast(T.noSites);
    this.placement = { cityId: c.id, item: { kind: item.kind, id: item.id }, mode, sites };
    this.selectedCityId = c.id;
    this.centerOn(c.pos);
    this.renderHud();
    this.invalidate();
  }

  private placementOverlay(): Overlay['placement'] {
    const s = this.state;
    const pl = this.placement;
    if (!s || !pl) return undefined;
    const sites = new Map<number, string>();
    for (const i of pl.sites) {
      if (pl.item.kind === 'district') {
        const def = DISTRICTS[pl.item.id as DistrictId];
        sites.set(i, def?.yieldKey ? `+${adjacencyBonus(s, i, pl.item.id)} ${def.icon}` : def?.icon ?? '');
      } else sites.set(i, '★');
    }
    return { sites, chosen: pl.chosen };
  }

  private confirmPlacement(): void {
    const pl = this.placement;
    if (!pl || pl.chosen === undefined) return;
    const item: ProductionItem = { ...pl.item, tile: pl.chosen };
    const ok = this.dispatch({ type: pl.mode === 'set' ? 'setProduction' : 'enqueue', cityId: pl.cityId, item });
    if (ok) {
      this.placement = undefined;
      this.renderHud();
      this.invalidate();
    }
  }

  private cancelPlacement(): void {
    this.placement = undefined;
    this.renderHud();
    this.invalidate();
  }

  private placementPanel(): HTMLElement {
    const s = this.state!;
    const pl = this.placement!;
    const c = s.cities.find((x) => x.id === pl.cityId)!;
    const lines: HTMLElement[] = [
      h('strong', {}, T.placeTitle(itemName(pl.item), c.name)),
      h('small', { class: 'muted' }, itemDescription(pl.item)),
      h('small', { class: 'hint' }, pl.chosen === undefined ? T.placeHint : T.placeConfirm(describeTile(s.map.tiles[pl.chosen]))),
    ];
    const actions = [
      h('button', { class: 'btn primary', disabled: pl.chosen === undefined, onclick: () => this.confirmPlacement() }, '✔ ' + T.confirm),
      h('button', { class: 'btn', onclick: () => this.cancelPlacement() }, '✕ ' + T.cancel),
    ];
    return h('div', { class: 'panel-inner' }, h('div', { class: 'panel-info' }, ...lines), h('div', { class: 'actions' }, ...actions));
  }

  private currentAttackTargets(): Set<number> | undefined {
    const s = this.state;
    if (!s) return undefined;
    const u = this.selectedUnit();
    if (u) {
      const t = attackTargets(s, u);
      if (t.length) this.tip('combat');
      return t.length ? new Set(t) : undefined;
    }
    const c = this.selectedCity();
    if (c && c.owner === s.currentPlayer) {
      const t = cityAttackTargets(s, c);
      return t.length ? new Set(t) : undefined;
    }
    return undefined;
  }

  private confirmAttack(): void {
    const s = this.state;
    const target = this.pendingAttack;
    if (!s || target === undefined) return;
    this.pendingAttack = undefined;
    const u = this.selectedUnit();
    const c = this.selectedCity();
    if (u) {
      if (this.dispatch({ type: 'attack', unitId: u.id, target })) {
        const after = this.selectedUnit();
        if (!after || after.movesLeft <= 0) {
          if (!this.selectNextUnit()) this.selectUnit(undefined);
        } else this.renderHud();
      }
    } else if (c) {
      if (this.dispatch({ type: 'cityAttack', cityId: c.id, target })) this.renderHud();
    }
    this.invalidate();
  }

  private attackPreviewLines(): HTMLElement[] {
    const s = this.state!;
    const target = this.pendingAttack;
    if (target === undefined) return [];
    const u = this.selectedUnit();
    const c = this.selectedCity();
    const tname = (() => {
      const city = s.cities.find((x) => x.pos === target);
      if (city) return city.name;
      const en = s.units.find((x) => x.pos === target && x.owner !== s.currentPlayer);
      return en ? `${UNITS[en.type].name} (${en.hp}❤)` : '?';
    })();
    if (u) {
      const p = previewAttack(s, u, target);
      if (!p) return [];
      if (p.defenseStrength === 0) return [h('small', { class: 'hint' }, T.capturePreview(tname))];
      return [
        h('small', { class: 'hint' }, T.attackPreview(tname, p.attackStrength, p.defenseStrength)),
        h('small', { class: 'hint' }, T.damagePreview(p.damageToTarget, p.damageToAttacker)),
        h('small', { class: 'muted' }, T.confirmAttack),
      ];
    }
    if (c) return [h('small', { class: 'hint' }, T.cityAttackPreview(tname, cityStrength(s, c))), h('small', { class: 'muted' }, T.confirmAttack)];
    return [];
  }

  private selectCity(id: number | undefined, center = false): void {
    this.pendingAttack = undefined;
    this.selectedCityId = id;
    if (id !== undefined) this.tip('city');
    this.pendingBuyTile = undefined;
    if (id !== undefined) {
      this.selectedUnitId = undefined;
      this.pendingPath = undefined;
      this.reachable = undefined;
      const c = this.selectedCity();
      this.selectedTile = c?.pos;
      if (center && c) this.centerOn(c.pos);
    }
    this.renderHud();
    this.invalidate();
  }

  private startNewGame(
    seed: string,
    mapSize: GameState['settings']['mapSize'],
    civId: string,
    rivals?: number,
    cityStates?: number,
    turnLimit?: number,
    extraHumans?: string[],
  ): void {
    const s = newGame({ seed, mapSize, civId, rivals, cityStates, turnLimit, extraHumans });
    this.selectedUnitId = undefined;
    this.selectedTile = undefined;
    this.pendingPath = undefined;
    this.setState(s);
    this.inbox = {};
    this.resetFx();
    this.saveInbox();
    this.cam.zoom = 1.1;
    this.victoryShown = false;
    this.tip('welcome');
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
    this.pendingAttack = undefined;
    this.selectedUnitId = id;
    if (id !== undefined) {
      this.selectedCityId = undefined;
      this.pendingBuyTile = undefined;
    }
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
    if (this.playback) return this.skipPlayback();
    const needProd = citiesNeedingProduction(this.state, this.state.currentPlayer);
    if (needProd.length) {
      this.tip('production');
      this.selectCity(needProd[0].id, true);
      this.showProduction();
      return;
    }
    const choice = needsResearchChoice(this.state.players[this.state.currentPlayer]);
    if (choice && this.state.cities.some((c) => c.owner === this.state!.currentPlayer)) {
      this.tip('research');
      this.showTree(choice);
      return;
    }
    if (this.shouldPromptPolicies()) {
      this.policyPromptSeenTurn = this.state.turn;
      this.showGovernment();
      this.renderHud();
      return;
    }
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
    if (!this.state) return;
    // multijogador local: passa a vez ao próximo humano antes de fechar a rodada
    if (nextHuman(this.state) !== null) {
      if (!this.dispatch({ type: 'passTurn' })) return;
      this.autosave();
      this.showHandoff();
      return;
    }
    if (!this.dispatch({ type: 'endTurn' }) || !this.state) return;
    this.autosave();
    if (activeHumans(this.state).length === 0) return this.showGameOver();
    if (activeHumans(this.state).length > 1) {
      this.showHandoff();
      return;
    }
    this.selectedCityId = undefined;
    this.showTurnBanner();
    const finish = () => {
      if (!this.state) return;
      if (!this.selectNextUnit()) this.selectUnit(undefined);
      const me = this.state.players[this.state.currentPlayer];
      if (me.eliminated) return this.showGameOver();
      const w = this.state.winner;
      if (w && !this.victoryShown) {
        this.victoryShown = true;
        return this.showVictory();
      }
      if (this.state.turn >= 8) this.tip('victory');
      if (this.state.proposals.some((p) => p.to === me.id)) this.showProposals();
    };
    // passo a passo: a seleção e os diálogos esperam as jogadas dos rivais terminarem
    if (this.playback) {
      this.selectUnit(undefined);
      this.afterPlayback = finish;
    } else finish();
  }

  // ------------------------------------------------------------------ entrada

  private onTap(sx: number, sy: number): void {
    if (!this.state) return;
    if (this.playback) return this.skipPlayback();
    const w = this.view.pick(this.cam, sx, sy);
    const idx = tileAtWorld(this.state, w.x, w.y);
    if (idx < 0) return;
    const s = this.state;
    const me = s.currentPlayer;
    const sel = this.selectedUnit();

    // posicionamento de distrito/maravilha
    if (this.placement) {
      if (this.placement.sites.includes(idx)) {
        if (this.placement.chosen === idx) this.confirmPlacement();
        else {
          this.placement.chosen = idx;
          this.renderHud();
          this.invalidate();
        }
      }
      return;
    }

    // ataque: primeiro toque mostra a previsão, segundo confirma
    const targets = this.currentAttackTargets();
    if (targets?.has(idx)) {
      if (this.pendingAttack === idx) {
        this.confirmAttack();
      } else {
        this.pendingAttack = idx;
        this.pendingPath = undefined;
        this.renderHud();
        this.invalidate();
      }
      return;
    }
    this.pendingAttack = undefined;

    // visão da cidade: fixar cidadãos / comprar hexágonos
    const city = this.selectedCity();
    if (city && idx !== city.pos) {
      if (workableTiles(s, city).includes(idx)) {
        this.dispatch({ type: 'toggleTile', cityId: city.id, tile: idx });
        this.pendingBuyTile = undefined;
        this.renderHud();
        return;
      }
      if (expansionCandidates(s, city).includes(idx) && s.players[me].explored[idx]) {
        this.pendingBuyTile = idx;
        this.selectedTile = idx;
        this.renderHud();
        this.invalidate();
        return;
      }
    }

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
    const myCity = s.cities.find((c) => c.pos === idx && c.owner === me);
    if (mine.length || myCity) {
      // alterna entre unidades empilhadas e a cidade no mesmo hexágono
      const cycle: ({ unit: number } | { city: number })[] = [
        ...mine.map((u) => ({ unit: u.id })),
        ...(myCity ? [{ city: myCity.id }] : []),
      ];
      const cur = cycle.findIndex((c) =>
        'unit' in c ? c.unit === this.selectedUnitId : c.city === this.selectedCityId,
      );
      // tocar na cidade abre a cidade primeiro se nada estiver selecionado ali
      const next = cur < 0 && myCity && !sel ? { city: myCity.id } : cycle[(cur + 1) % cycle.length];
      if ('unit' in next) this.selectUnit(next.unit);
      else this.selectCity(next.city);
      return;
    }

    if (sel && idx !== sel.pos && s.players[me].explored[idx]) {
      const res = findPath(s, sel, idx);
      if (res) {
        this.tip('move');
        this.pendingPath = { target: idx, path: res.path, turns: res.turns };
        this.selectedTile = idx;
        this.renderHud();
        this.invalidate();
        return;
      }
    }

    // apenas inspeciona o hexágono
    this.pendingPath = undefined;
    this.selectedCityId = undefined;
    this.pendingBuyTile = undefined;
    this.selectedUnitId = undefined;
    this.reachable = undefined;
    this.selectedTile = idx;
    this.renderHud();
    this.invalidate();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.el.modal.hidden) {
      if (e.key === 'Escape' && this.el.modal.dataset.closable === '1') closeModal(this.modalHost());
      return;
    }
    if (!this.state) return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Enter') this.onEndTurnButton();
    else if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
    else if (e.key === '-') this.zoomBy(0.8);
    else if (e.key === 'b' || e.key === 'B') this.foundCity();
    else if (e.key === ' ') this.skipSelected();
    else if (e.key === 'Escape' && this.placement) this.cancelPlacement();
    else if (e.key === 'Escape') {
      this.selectUnit(undefined);
      this.selectCity(undefined);
    }
  }

  private zoomBy(f: number): void {
    const base = this.camTween?.to ?? this.cam;
    this.moveCamera(this.clampCam(zoomAt(base, this.view.vw, this.view.vh, this.view.vw / 2, this.view.vh / 2, base.zoom * f)), 220);
  }

  private centerOn(idx: number): void {
    if (!this.state) return;
    const c = tileCenter(this.state, idx);
    const dist = Math.hypot(this.wrapDx(c.x - this.cam.x), c.y - this.cam.y) * this.cam.zoom;
    this.moveCamera({ ...this.cam, x: c.x, y: c.y }, Math.min(550, 220 + dist / 4));
  }

  /** Diferença horizontal pelo lado mais curto (mapa com volta). */
  private wrapDx(dx: number): number {
    if (!this.state?.map.wrap) return dx;
    const P = worldSize(this.state).w;
    return ((((dx + P / 2) % P) + P) % P) - P / 2;
  }

  /** Leva a câmera até `to`; desliza se as animações estiverem ligadas e o salto não for enorme. */
  private moveCamera(to: Camera, dur: number): void {
    const from = this.cam;
    const target = { ...to, x: from.x + this.wrapDx(to.x - from.x) };
    const far = Math.hypot(target.x - from.x, target.y - from.y) * from.zoom > Math.max(this.view.vw, this.view.vh) * 2.5;
    if (!this.prefs.animations || far) {
      this.camTween = undefined;
      this.cam = this.clampCam(target);
    } else this.camTween = { from, to: target, start: performance.now(), dur };
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

  /** Lente do colono (memorizada por estado e posição do colono selecionado). */
  private settleCache?: { state: GameState; pos: number; rank: SiteRanking };
  private settleRanking(): SiteRanking | undefined {
    const s = this.state;
    const u = this.selectedUnit();
    if (!s || !u || u.owner !== s.currentPlayer || !UNITS[u.type].canFoundCity) return undefined;
    if (this.settleCache?.state !== s || this.settleCache.pos !== u.pos) {
      this.settleCache = { state: s, pos: u.pos, rank: rankSites(s, s.currentPlayer, u.pos, 6) };
    }
    return this.settleCache.rank;
  }

  private settleOverlay(): Overlay['settle'] {
    const r = this.settleRanking();
    return r ? { tiers: r.tiers, best: r.best } : undefined;
  }

  /** Linha "Ótimo local — 🏠 6 (rio) · …" para o painel do colono. */
  private siteLine(label: string, idx: number): HTMLElement {
    const s = this.state!;
    const info = siteInfo(s, s.currentPlayer, idx);
    if (!info.valid) return h('small', { class: 'muted' }, `${label}: ${info.reason}`);
    const tier = this.settleRanking()?.tiers.get(idx) ?? 2;
    return h('small', { class: 'hint' }, `${label}: ${T.siteTier(tier)} — ${siteSummary(info)}`);
  }

  private foundCity(confirmed = false): void {
    const u = this.selectedUnit();
    if (!u || !this.state) return;
    const warnings = confirmed ? [] : siteWarnings(this.state, this.state.currentPlayer, u.pos);
    if (warnings.length) {
      const host = this.modalHost();
      openModal(
        host,
        T.foundWarnTitle,
        h(
          'div',
          { class: 'menu-list' },
          ...warnings.map((w) => h('p', {}, '⚠ ' + w)),
          h('button', { class: 'btn primary wide', onclick: () => (closeModal(host), this.foundCity(true)) }, T.foundAnyway),
          h('button', { class: 'btn wide', onclick: () => closeModal(host) }, T.cancel),
        ),
      );
      return;
    }
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
      this.resourceBar(s),
      h(
        'button',
        { class: 'turn-info', 'aria-label': T.scoreboard, onclick: () => this.showScore() },
        h('strong', {}, `${T.turn} ${s.turn}`),
        h('small', {}, turnYear(s.turn)),
      ),
      h('button', { class: 'btn icon', 'aria-label': T.diplomacy, onclick: () => this.showDiplomacy() }, '🤝'),
      h('button', { class: 'btn icon', 'aria-label': T.menu, onclick: () => this.showGameMenu() }, '☰'),
    );

    const waiting = unitsNeedingOrders(s, s.currentPlayer);
    const needProd = citiesNeedingProduction(s, s.currentPlayer).length > 0;
    const showNextUnit = waiting.length > 1 || (waiting.length === 1 && waiting[0].id !== this.selectedUnitId);
    const hasCity = s.cities.some((c) => c.owner === s.currentPlayer);
    const choice = hasCity ? needsResearchChoice(s.players[s.currentPlayer]) : null;
    this.el.endTurn.textContent = needProd
      ? T.chooseProduction
      : choice === 'tech'
        ? T.chooseResearch
        : choice === 'civic'
          ? T.chooseCivic
          : this.shouldPromptPolicies()
            ? T.setPolicies
            : showNextUnit
              ? T.nextUnit
              : T.nextTurn;
    this.el.endTurn.classList.toggle('attention', showNextUnit || needProd || !!choice || this.shouldPromptPolicies());

    const u = this.selectedUnit();
    const city = this.selectedCity();
    if (this.placement) this.el.panel.append(this.placementPanel());
    else if (city) this.el.panel.append(this.cityPanel(city));
    else if (u) this.el.panel.append(this.unitPanel(u));
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
    const extraInfo: HTMLElement[] = [];
    if (def.trader) {
      const dests = tradeDestinations(s, u);
      actions.unshift(
        h('button', { class: 'btn primary', disabled: !dests.length, onclick: () => this.showTradeRoutes(u) }, '🐪 ' + T.createRoute),
      );
      if (!s.cities.some((c) => c.pos === u.pos && c.owner === u.owner)) extraInfo.push(h('small', { class: 'muted' }, T.traderHint));
    }
    if (def.inquisitor && u.religion) {
      for (const c of s.cities.filter((c) => distance(s.map, u.pos, c.pos) <= 1 && !cannotPurge(s, u, c.id))) {
        actions.unshift(
          h('button', { class: 'btn primary', onclick: () => this.unitAction({ type: 'purgeHeresy', unitId: u.id, cityId: c.id }) }, `⚖ ${T.purgeIn(c.name)}`),
        );
      }
    }
    if (u.religion && def.religiousStrength) {
      for (const n of neighbors(s.map, u.pos)) {
        if (n < 0 || cannotTheology(s, u, n)) continue;
        const foe = s.units.find((x) => x.pos === n && x.religion && x.religion !== u.religion)!;
        actions.unshift(
          h(
            'button',
            { class: 'btn danger', onclick: () => this.unitAction({ type: 'theology', unitId: u.id, target: n }) },
            `📖 ${T.theologyVs(UNITS[foe.type].name, religiousStrength(s, u), religiousStrength(s, foe))}`,
          ),
        );
      }
      extraInfo.push(h('small', {}, `📖 ${T.religiousStrengthLabel}: ${religiousStrength(s, u)} · ❤ ${u.hp}`));
    }
    if (def.spreads && !def.inquisitor && u.religion) {
      for (const c of s.cities.filter((c) => distance(s.map, u.pos, c.pos) <= 1 && c.religion !== u.religion)) {
        actions.unshift(
          h('button', { class: 'btn primary', onclick: () => this.unitAction({ type: 'spreadReligion', unitId: u.id, cityId: c.id }) }, `☦ ${T.spreadIn(c.name)}`),
        );
      }
      extraInfo.push(h('small', {}, `${religionLabel(u.religion)} · ${T.uses}: ${u.charges ?? 0}`));
    }
    if (def.greatPerson) {
      if (u.name) extraInfo.push(h('small', { class: 'wonder' }, u.name));
      if (def.greatPerson === 'prophet') {
        const why = cannotFoundReligion(s, u);
        actions.unshift(h('button', { class: 'btn primary', disabled: !!why, title: why ?? '', onclick: () => this.showFoundReligion(u) }, '🕯 ' + T.foundReligion));
        if (why) extraInfo.push(h('small', { class: 'muted' }, why));
      } else {
        actions.unshift(h('button', { class: 'btn primary', onclick: () => this.unitAction({ type: 'activateGreatPerson', unitId: u.id }) }, '✦ ' + T.activate));
      }
    }
    if (def.charges) {
      for (const id of availableImprovements(s, u)) {
        const imp = IMPROVEMENTS[id];
        actions.push(
          h('button', { class: 'btn primary', onclick: () => this.unitAction({ type: 'buildImprovement', unitId: u.id, improvement: id }) }, `${imp.icon} ${imp.name}`),
        );
      }
      const t = s.map.tiles[u.pos];
      const techs = s.players[u.owner].techs;
      const avail = new Set(availableImprovements(s, u));
      if (t.owner === u.owner && u.movesLeft > 0 && !s.cities.some((c) => c.pos === u.pos)) {
        for (const id of Object.keys(IMPROVEMENTS) as ImprovementId[]) {
          const imp = IMPROVEMENTS[id];
          if (avail.has(id) || t.improvement === id || !imp.requiresTech || techs.includes(imp.requiresTech)) continue;
          if (!improvementFits(t, id, techs)) continue;
          actions.push(h('button', { class: 'btn', disabled: true }, `${imp.icon} ${imp.name} (${T.requires} ${TECH_BY_ID[imp.requiresTech]?.name})`));
        }
      }
      if (canRemoveFeature(s, u).ok && t.feature) {
        const rem = FEATURE_REMOVAL[t.feature]!;
        actions.push(
          h('button', { class: 'btn', onclick: () => this.unitAction({ type: 'removeFeature', unitId: u.id }) }, `🪓 ${rem.name}${rem.production ? ` (+${rem.production} ⚒)` : ''}`),
        );
      }
      if (canBuildRoad(s, u).ok) {
        actions.push(h('button', { class: 'btn', onclick: () => this.unitAction({ type: 'buildRoad', unitId: u.id }) }, '🛤 ' + T.road));
      }
    }
    if (canPromote(u)) {
      actions.unshift(h('button', { class: 'btn primary', onclick: () => this.showPromotions(u) }, '★ ' + T.promote));
    }
    if (this.pendingAttack !== undefined) {
      actions.unshift(h('button', { class: 'btn danger', onclick: () => this.confirmAttack() }, '⚔ ' + T.attack));
    }
    if (canPillage(s, u).ok) {
      actions.unshift(h('button', { class: 'btn danger', onclick: () => this.unitAction({ type: 'pillage', unitId: u.id }) }, '🔥 ' + T.pillage));
    }
    if (canRepair(s, u).ok) {
      actions.unshift(h('button', { class: 'btn primary', onclick: () => this.unitAction({ type: 'repair', unitId: u.id }) }, '🔧 ' + T.repair));
    }
    actions.push(h('button', { class: 'btn', onclick: () => this.skipSelected() }, '⏭ ' + T.skip));

    const info: (HTMLElement | string)[] = [
      h('strong', {}, `${def.glyph} ${def.name}`),
      h('small', {}, `${T.moves}: ${fmt(u.movesLeft)}/${def.moves}${u.fortified ? ' · Fortificado' : ''}${def.charges ? ` · ${T.charges}: ${u.charges ?? 0}` : ''}`),
    ];
    info.push(...extraInfo);
    if (def.class === 'military') {
      const ranged = def.rangedStrength ? ` · 🏹 ${def.rangedStrength} (${T.range} ${unitRange(u)})` : '';
      const promos = u.promotions.length ? ` · ${u.promotions.map((p) => PROMOTION_BY_ID[p]?.name).join(', ')}` : '';
      info.push(h('small', {}, `❤ ${u.hp}/100 · ⚔ ${def.strength}${ranged} · XP ${u.xp}/${xpForNext(u)}${promos}`));
    } else if (u.hp < 100) info.push(h('small', {}, `❤ ${u.hp}/100`));
    info.push(...this.attackPreviewLines());
    if (def.charges && u.movesLeft > 0) {
      const b = availableImprovements(s, u);
      if (!b.length && !canBuildRoad(s, u).ok && s.map.tiles[u.pos].owner !== u.owner) info.push(h('small', { class: 'muted' }, 'Mova o construtor para o seu território.'));
    }
    if (def.canFoundCity && u.owner === s.currentPlayer) {
      info.push(this.siteLine(T.siteHere, u.pos));
      const dest = this.pendingPath?.path[this.pendingPath.path.length - 1];
      if (dest !== undefined) info.push(this.siteLine(T.siteDest, dest));
      else info.push(h('small', { class: 'muted' }, T.settleLensHint));
    }
    if (this.pendingPath) info.push(h('small', { class: 'hint' }, `${T.turnsTo(this.pendingPath.turns)} — ${T.confirmMove}`));
    else if (def.canFoundCity) {
      const check = canFoundCity(s, u);
      if (!check.ok) info.push(h('small', { class: 'muted' }, check.reason));
    }
    info.push(h('small', { class: 'muted' }, describeTile(s.map.tiles[u.pos])));
    return h('div', { class: 'panel-inner' }, h('div', { class: 'panel-info' }, ...info), h('div', { class: 'actions' }, ...actions));
  }

  private unitAction(a: Action): void {
    if (this.dispatch(a)) {
      const u = this.selectedUnit();
      if (!u || u.movesLeft <= 0) {
        if (!this.selectNextUnit()) this.renderHud();
      } else this.renderHud();
    }
  }

  private resourceBar(s: GameState): HTMLElement {
    const p = s.players[s.currentPlayer];
    const inc = playerIncome(s, s.currentPlayer);
    const item = (icon: string, main: string, per: number, label: string, onclick?: () => void) =>
      h(
        onclick ? 'button' : 'span',
        { class: `res${onclick ? ' res-btn' : ''}`, title: `${label} (+${per} ${T.perTurn})`, 'aria-label': label, onclick },
        `${icon} ${main}`,
        h('small', {}, ` +${per}`),
      );
    const cur = (kind: TreeKind) => {
      const id = kind === 'tech' ? p.researching : p.researchingCivic;
      if (!id) return '—';
      const t = turnsFor(p, kind, id, kind === 'tech' ? inc.science : inc.culture);
      return isFinite(t) ? `${t}` : '∞';
    };
    return h(
      'div',
      { class: 'resbar' },
      item('🪙', String(Math.floor(p.gold)), inc.gold - maintenanceOf(s, s.currentPlayer).total, 'Ouro', () => this.showEconomy()),
      item('🔬', cur('tech'), inc.science, T.techTree, () => this.showTree('tech')),
      item('🎭', cur('civic'), inc.culture, T.civicTree, () => this.showTree('civic')),
      item('✨', String(Math.floor(p.faith)), inc.faith, 'Fé', () => this.showReligion()),
    );
  }

  private cityPanel(c: City): HTMLElement {
    const s = this.state!;
    const y = cityYields(s, c);
    const surplus = foodSurplus(s, c, y);
    const housing = cityHousing(s, c);
    const item = c.queue[0];
    const ys = YIELD_KEYS.map((k) => `${YIELD_LABELS[k].icon}${y[k]}`).join(' ');
    const lines: HTMLElement[] = [
      h('strong', {}, `${c.isCapital ? '★ ' : ''}${c.name} — ${T.population} ${c.population}`),
      h('small', {}, ys),
      h(
        'small',
        {},
        `🌾 ${Math.floor(c.foodStored)}/${growthThreshold(c.population)} (${surplus >= 0 ? '+' : ''}${surplus}) · ${T.growsIn(turnsToGrow(s, c))} · ${T.housing} ${c.population}/${housing}`,
      ),
      h(
        'small',
        {},
        item
          ? `⚒ ${itemName(item)}: ${Math.floor(c.progress[itemKey(item)] ?? 0)}/${itemCost(item)} · ${T.turns(turnsToProduce(s, c, item))}`
          : `⚒ ${T.noProduction}`,
      ),
      h('small', { class: 'muted' }, `🎭 ${T.border}: ${Math.floor(c.cultureStored)}/${borderThreshold(c.cultureTiles)} · ${T.cityHint}`),
      (() => {
        const a = cityAmenities(s, c);
        return h('small', { class: a.balance < 0 ? 'danger-text' : a.balance >= 3 ? 'good' : '' }, T.amenityLine(a.provided, a.needed, a.label));
      })(),
      h(
        'small',
        {},
        `${c.religion ? religionLabel(c.religion) : T.noReligion}${(() => {
          const n = s.tradeRoutes.filter((r) => r.from === c.id || r.to === c.id).length;
          return n ? ` · 🐪 ${T.routesCount(n)}` : '';
        })()}`,
      ),
      h(
        'small',
        {},
        `❤ ${c.hp}/${cityMaxHp(c)} · 🛡 ${cityStrength(s, c)}${c.buildings.includes('walls') ? ` · ${c.rangedUsed ? T.cityAttacked : T.cityCanAttack}` : ''}`,
      ),
      ...this.attackPreviewLines(),
    ];
    // especialistas: cidadãos trabalhando nos distritos
    const specRows = c.districts
      .filter((d) => specialistSlots(c, d.type) > 0)
      .map((d) => {
        const def = DISTRICTS[d.type as DistrictId];
        const n = c.specialists?.[d.type] ?? 0;
        const slots = specialistSlots(c, d.type);
        const yieldsTxt = (Object.entries(def.specialist) as [keyof typeof YIELD_LABELS, number][])
          .map(([k, v]) => `+${v}${YIELD_LABELS[k].icon}`)
          .join(' ');
        return h(
          'div',
          { class: 'spec-row' },
          h('span', {}, `${def.icon} ${def.name}: ${n}/${slots} (${yieldsTxt} ${T.each})`),
          h('button', { class: 'btn icon', 'aria-label': `${def.name} −`, disabled: n <= 0, onclick: () => this.dispatch({ type: 'setSpecialists', cityId: c.id, district: d.type, count: n - 1 }) && this.renderHud() }, '−'),
          h('button', { class: 'btn icon', 'aria-label': `${def.name} +`, disabled: n >= slots, onclick: () => this.dispatch({ type: 'setSpecialists', cityId: c.id, district: d.type, count: n + 1 }) && this.renderHud() }, '+'),
        );
      });
    if (specRows.length) lines.push(h('small', { class: 'field-label' }, T.specialists), ...specRows);
    if (c.districts.length || c.wonders.length) {
      const ds = c.districts.map((d) => `${DISTRICTS[d.type as DistrictId]?.icon ?? ''} ${DISTRICTS[d.type as DistrictId]?.name ?? d.type}`);
      const ws = c.wonders.map((w) => `★ ${WORLD_WONDER_BY_ID[w]?.name ?? w}`);
      lines.splice(4, 0, h('small', {}, [...ds, ...ws].join(' · ')));
    }
    const actions: HTMLElement[] = [
      ...(this.pendingAttack !== undefined ? [h('button', { class: 'btn danger', onclick: () => this.confirmAttack() }, '🏹 ' + T.attack)] : []),
      h('button', { class: `btn ${item ? '' : 'primary'}`, onclick: () => this.showProduction() }, '⚒ ' + T.production),
      ...(c.religion && religionOf(s, c.owner)
        ? ['missionary', 'apostle', 'inquisitor'].map((uid) =>
            h(
              'button',
              {
                class: 'btn',
                disabled: !!canBuyMissionary(s, c, uid),
                title: canBuyMissionary(s, c, uid) ?? '',
                onclick: () => this.dispatch({ type: 'buyWithFaith', cityId: c.id, unit: uid }) && this.renderHud(),
              },
              `${UNITS[uid].glyph} ${T.buyFaithUnit(UNITS[uid].name, UNITS[uid].faithCost ?? 0)}`,
            ),
          )
        : []),
      h(
        'button',
        { class: 'btn', onclick: () => this.cycleFocus(c) },
        `🎯 ${T.focus}: ${FOCUS_LABELS[c.focus]}`,
      ),
    ];
    if (this.pendingBuyTile !== undefined) {
      const cost = tilePurchaseCost(s, c, this.pendingBuyTile);
      const tile = this.pendingBuyTile;
      actions.unshift(
        h(
          'button',
          {
            class: 'btn primary',
            disabled: s.players[c.owner].gold < cost,
            onclick: () => {
              if (this.dispatch({ type: 'purchaseTile', cityId: c.id, tile })) {
                this.pendingBuyTile = undefined;
                this.renderHud();
              }
            },
          },
          T.buyTile(cost),
        ),
      );
      lines.push(h('small', { class: 'hint' }, describeTile(s.map.tiles[tile])));
    }
    actions.push(h('button', { class: 'btn', onclick: () => this.selectCity(undefined) }, '✕ ' + T.close));
    return h('div', { class: 'panel-inner' }, h('div', { class: 'panel-info' }, ...lines), h('div', { class: 'actions' }, ...actions));
  }

  private cycleFocus(c: City): void {
    const order: CityFocus[] = ['balanced', 'food', 'production', 'gold'];
    const next = order[(order.indexOf(c.focus) + 1) % order.length];
    if (this.dispatch({ type: 'setFocus', cityId: c.id, focus: next })) this.renderHud();
  }

  private showProduction(): void {
    const s = this.state;
    const c = this.selectedCity();
    if (!s || !c) return;
    const host = this.modalHost();
    const gold = s.players[c.owner].gold;
    const reopen = () => {
      this.renderHud();
      this.showProduction();
    };
    const row = (item: ProductionItem) => {
      const why = cannotProduce(s, c, item);
      const placed = item.kind === 'district' || item.kind === 'wonder';
      const icon =
        item.kind === 'unit'
          ? UNITS[item.id].glyph
          : item.kind === 'district'
            ? DISTRICTS[item.id as DistrictId]?.icon ?? '▣'
            : item.kind === 'wonder'
              ? '★'
              : '🏛';
      const price = purchaseCost(c, item);
      const isCurrent = c.queue[0] && itemKey(c.queue[0]) === itemKey(item);
      return h(
        'div',
        { class: `prod-row${isCurrent ? ' current' : ''}` },
        h(
          'button',
          {
            class: 'prod-main',
            disabled: !!why,
            onclick: () => {
              if (placed) {
                closeModal(host);
                this.startPlacement(c, item, 'set');
                return;
              }
              if (this.dispatch({ type: 'setProduction', cityId: c.id, item })) {
                closeModal(host);
                this.renderHud();
              }
            },
          },
          h('strong', {}, `${icon} ${itemName(item)}`),
          h('small', {}, why ?? `${itemCost(item)} ⚒ · ${T.turns(turnsToProduce(s, c, item))}${placed ? ` · ${T.choosesTile}` : ''}`),
          h('small', { class: 'muted' }, itemDescription(item)),
        ),
        h(
          'div',
          { class: 'prod-side' },
          h(
            'button',
            {
              class: 'btn',
              disabled: !!why,
              onclick: () => {
                if (placed) {
                  closeModal(host);
                  this.startPlacement(c, item, 'enqueue');
                } else if (this.dispatch({ type: 'enqueue', cityId: c.id, item })) reopen();
              },
            },
            T.addToQueue,
          ),
          placed
            ? null
            : h(
                'button',
                {
                  class: 'btn',
                  disabled: !!why || gold < price,
                  onclick: () => this.dispatch({ type: 'purchaseItem', cityId: c.id, item }) && reopen(),
                },
                `${price} 🪙`,
              ),
        ),
      );
    };
    const options = productionOptions(s, c);
    const queue = c.queue.length
      ? h(
          'div',
          { class: 'queue' },
          h('label', { class: 'field-label' }, T.queue),
          ...c.queue.map((q, k) =>
            h(
              'div',
              { class: 'queue-item' },
              h('span', {}, `${k + 1}. ${itemName(q)} · ${Math.floor(c.progress[itemKey(q)] ?? 0)}/${itemCost(q)}`),
              h('button', { class: 'btn icon', 'aria-label': 'Remover', onclick: () => this.dispatch({ type: 'dequeue', cityId: c.id, index: k }) && reopen() }, '✕'),
            ),
          ),
        )
      : null;
    const body = h(
      'div',
      { class: 'form' },
      h('small', { class: 'muted' }, `🪙 ${Math.floor(gold)} · ⚒ ${cityYields(s, c).production} ${T.perTurn}`),
      queue,
      h('label', { class: 'field-label' }, T.units),
      ...options.filter((o) => o.kind === 'unit').map(row),
      h('label', { class: 'field-label' }, T.buildings),
      ...options.filter((o) => o.kind === 'building').map(row),
      h('label', { class: 'field-label' }, `${T.districtsLabel} (${c.districts.length}/${districtLimit(c)})`),
      ...options.filter((o) => o.kind === 'district').map(row),
      h('label', { class: 'field-label' }, T.wondersLabel),
      ...options.filter((o) => o.kind === 'wonder').map(row),
    );
    openModal(host, `${T.production} — ${c.name}`, body);
  }

  /** Há espaço de política vazio e troca permitida neste turno (aviso uma vez por turno). */
  private shouldPromptPolicies(): boolean {
    const s = this.state;
    if (!s || this.policyPromptSeenTurn === s.turn) return false;
    const p = s.players[s.currentPlayer];
    if (!p.policyChangeAvailable) return false;
    const slots = governmentSlots(p.government);
    const pols = availablePolicies(p).filter((id) => !p.policies.includes(id));
    return slots.some((sl, i) => !p.policies[i] && pols.some((id) => canSlotPolicy(sl, id)));
  }

  private proposal(to: number, items: DealItem[]): void {
    if (!this.state) return;
    if (this.applyResult(proposeDeal(this.state, to, items))) {
      this.renderHud();
      this.showDiplomacy();
    }
  }

  private showDiplomacy(): void {
    const s = this.state;
    if (!s) return;
    const me = s.currentPlayer;
    const host = this.modalHost();
    const reopen = () => {
      this.renderHud();
      this.showDiplomacy();
    };
    const others = s.players.filter((p) => p.id !== me && !p.isBarbarian && hasMet(s, me, p.id));
    const civCard = (pid: number) => {
      const p = s.players[pid];
      const civ = CIV_BY_ID[p.civId];
      const r = peekRelation(s, me, pid)!;
      const parts = opinionParts(s, pid, me, unitStrength);
      const total = parts.reduce((a, b) => a + b.value, 0);
      const status = p.eliminated ? T.eliminatedTag : r.war ? `⚔ ${T.atWar} (${s.turn - r.since} t)` : `🕊 ${T.atPeace}`;
      const agreements = [
        hasOpenBorders(s, me, pid) ? `${T.openBorders} (${(r.openBordersUntil ?? 0) - s.turn} t)` : null,
        areFriends(s, me, pid) ? `${T.friendship} (${(r.friendshipUntil ?? 0) - s.turn} t)` : null,
      ].filter(Boolean);
      const gold = s.players[me].gold;
      const buttons: HTMLElement[] = [];
      if (!p.eliminated) {
        if (r.war) buttons.push(h('button', { class: 'btn', onclick: () => this.proposal(pid, [{ type: 'peace' }]) }, '🕊 ' + T.proposePeace));
        else {
          if (!hasOpenBorders(s, me, pid))
            buttons.push(h('button', { class: 'btn', onclick: () => this.proposal(pid, [{ type: 'openBorders' }]) }, '🚪 ' + T.proposeOpenBorders));
          if (!areFriends(s, me, pid))
            buttons.push(h('button', { class: 'btn', onclick: () => this.proposal(pid, [{ type: 'friendship' }]) }, '🤝 ' + T.proposeFriendship));
          buttons.push(h('button', { class: 'btn primary', onclick: () => this.showNegotiation(pid) }, '📜 ' + T.negotiate));
          buttons.push(
            h(
              'button',
              { class: 'btn', disabled: gold < 50, onclick: () => this.proposal(pid, [{ type: 'gold', from: me, amount: 50 }]) },
              T.giftGold(50),
            ),
          );
          const why = cannotDeclareWar(s, me, pid);
          buttons.push(
            h(
              'button',
              {
                class: 'btn danger',
                disabled: !!why,
                title: why ?? '',
                onclick: () => {
                  if (confirm(T.confirmWar(civ?.name ?? ''))) {
                    if (this.dispatch({ type: 'declareWar', target: pid })) reopen();
                  }
                },
              },
              '⚔ ' + T.declareWar,
            ),
          );
        }
      }
      return h(
        'div',
        { class: 'dip-card', style: `--civ:${civ?.color};--civ2:${civ?.secondaryColor}` },
        h('div', { class: 'dip-head' }, h('span', { class: 'civ-swatch' }), h('div', {}, h('strong', {}, civ?.name ?? ''), h('small', {}, `${civ?.leaderTitle} ${civ?.leader}`))),
        h('small', {}, `${status}${agreements.length ? ' · ' + agreements.join(' · ') : ''}`),
        civ?.agenda ? h('small', { class: 'muted' }, `${T.agenda}: ${civ.agenda.name} — ${civ.agenda.description}`) : null,
        h('small', { class: total >= 20 ? 'good' : total <= -20 ? 'danger-text' : '' }, `${T.attitude}: ${attitudeLabel(total)} (${total >= 0 ? '+' : ''}${total})`),
        ...parts.map((pt) => h('small', { class: 'muted' }, `  ${pt.value >= 0 ? '+' : ''}${pt.value} ${pt.label}`)),
        h('div', { class: 'actions' }, ...buttons),
      );
    };
    const csCard = (pid: number) => {
      const p = s.players[pid];
      const def = CITY_STATE_BY_ID[p.civId];
      const type = def ? CITY_STATE_TYPES[def.type] : null;
      const mine = envoysOf(s, pid, me);
      const sz = suzerainOf(s, pid);
      const war = isAtWar(s, me, pid);
      const why = cannotDeclareWar(s, me, pid);
      return h(
        'div',
        { class: 'dip-card', style: `--civ:#2c3e50;--civ2:${type?.color ?? '#fff'}` },
        h('div', { class: 'dip-head' }, h('span', { class: 'civ-swatch' }), h('div', {}, h('strong', {}, `${type?.icon ?? ''} ${def?.name ?? p.civId}`), h('small', {}, `${T.cityState} ${type?.name ?? ''}`))),
        h('small', {}, `${T.envoys}: ${mine} · ${T.suzerain}: ${sz === null ? '—' : playerName(s, sz)}${war ? ` · ⚔ ${T.atWar}` : ''}`),
        h('small', { class: 'muted' }, T.envoyTiers(type?.name ?? '', def?.suzerainBonus ?? '')),
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            { class: 'btn primary', disabled: s.players[me].envoyTokens <= 0 || war || p.eliminated, onclick: () => this.dispatch({ type: 'sendEnvoy', cityState: pid }) && reopen() },
            `✉ ${T.sendEnvoy}`,
          ),
          war
            ? null
            : h(
                'button',
                {
                  class: 'btn danger',
                  disabled: !!why || p.eliminated,
                  title: why ?? '',
                  onclick: () => confirm(T.confirmWar(def?.name ?? '')) && this.dispatch({ type: 'declareWar', target: pid }) && reopen(),
                },
                '⚔ ' + T.declareWar,
              ),
        ),
      );
    };
    const civs = others.filter((p) => !p.isCityState);
    const css = others.filter((p) => p.isCityState);
    const body = h(
      'div',
      { class: 'form' },
      h('small', { class: 'muted' }, `✉ ${T.envoysAvailable}: ${s.players[me].envoyTokens} · 🪙 ${Math.floor(s.players[me].gold)}`),
      others.length ? null : h('p', { class: 'muted' }, T.noContacts),
      civs.length ? h('label', { class: 'field-label' }, T.civilizations) : null,
      ...civs.map((p) => civCard(p.id)),
      css.length ? h('label', { class: 'field-label' }, T.cityStatesLabel) : null,
      ...css.map((p) => csCard(p.id)),
    );
    openModal(host, T.diplomacy, body);
  }

  /** Negociação com uma civilização: luxos, ouro e acordo de pesquisa. */
  private showNegotiation(pid: number): void {
    const s = this.state!;
    const me = s.currentPlayer;
    const host = this.modalHost();
    const give = new Set<string>();
    const ask = new Set<string>();
    let goldGive = 0;
    let research = false;
    const myLux = tradeableLuxuries(s, me);
    const theirLux = tradeableLuxuries(s, pid);
    const render = () => {
      const lux = (list: string[], set: Set<string>, mine: boolean) =>
        list.length
          ? h(
              'div',
              { class: 'tree-grid' },
              ...list.map((r) =>
                h(
                  'button',
                  {
                    class: `tree-card available${set.has(r) ? ' current' : ''}`,
                    'aria-pressed': String(set.has(r)),
                    onclick: () => {
                      if (set.has(r)) set.delete(r);
                      else set.add(r);
                      render();
                    },
                  },
                  h('strong', {}, `${RESOURCE_BY_ID[r]?.icon} ${RESOURCE_BY_ID[r]?.name}`),
                  h('small', {}, mine ? T.youGive : T.youGet),
                ),
              ),
            )
          : h('small', { class: 'muted' }, T.noTradeableLux);
      const items: DealItem[] = [
        ...[...give].map((r) => ({ type: 'luxury' as const, from: me, resource: r })),
        ...[...ask].map((r) => ({ type: 'luxury' as const, from: pid, resource: r })),
        ...(goldGive ? [{ type: 'gold' as const, from: me, amount: goldGive }] : []),
        ...(research ? [{ type: 'researchAgreement' as const }] : []),
      ];
      const body = h(
        'div',
        { class: 'form' },
        h('label', { class: 'field-label' }, T.yourLuxuries),
        lux(myLux, give, true),
        h('label', { class: 'field-label' }, T.theirLuxuries(playerName(s, pid))),
        lux(theirLux, ask, false),
        h('label', { class: 'field-label' }, T.goldOffer),
        h(
          'div',
          { class: 'seg' },
          ...[0, 50, 100].map((g) =>
            h(
              'button',
              { class: `btn seg-btn${goldGive === g ? ' active' : ''}`, disabled: s.players[me].gold < g, onclick: () => ((goldGive = g), render()) },
              `${g} 🪙`,
            ),
          ),
        ),
        h(
          'button',
          {
            class: `btn wide toggle${research ? ' on' : ''}`,
            'aria-pressed': String(research),
            disabled: !areFriends(s, me, pid),
            title: areFriends(s, me, pid) ? '' : T.researchNeedsFriend,
            onclick: () => ((research = !research), render()),
          },
          `${research ? '✔' : '✕'} ${T.itemResearch}`,
        ),
        h(
          'button',
          {
            class: 'btn primary wide',
            disabled: !items.length,
            onclick: () => {
              if (this.applyResult(proposeDeal(s, pid, items))) {
                closeModal(host);
                this.renderHud();
              }
            },
          },
          '📜 ' + T.propose,
        ),
      );
      openModal(host, `${T.negotiate} — ${playerName(s, pid)}`, body);
    };
    render();
  }

  private showProposals(): void {
    const s = this.state;
    if (!s) return;
    const me = s.currentPlayer;
    const list = s.proposals.filter((p) => p.to === me);
    if (!list.length) return;
    const host = this.modalHost();
    const desc = (it: DealItem) =>
      it.type === 'peace'
        ? T.itemPeace
        : it.type === 'openBorders'
          ? T.itemOpenBorders
          : it.type === 'friendship'
            ? T.itemFriendship
            : it.type === 'luxury'
              ? T.itemLuxury(RESOURCE_BY_ID[it.resource]?.name ?? it.resource, playerName(s, it.from))
              : it.type === 'researchAgreement'
                ? T.itemResearch
                : T.itemGold(it.amount, playerName(s, it.from));
    const body = h(
      'div',
      { class: 'form' },
      ...list.map((p) =>
        h(
          'div',
          { class: 'dip-card' },
          h('strong', {}, T.proposalFrom(playerName(s, p.from))),
          ...p.items.map((it) => h('small', {}, '• ' + desc(it))),
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn primary', onclick: () => this.dispatch({ type: 'respondProposal', id: p.id, accept: true }) && this.afterProposal() }, T.accept),
            h('button', { class: 'btn', onclick: () => this.dispatch({ type: 'respondProposal', id: p.id, accept: false }) && this.afterProposal() }, T.reject),
          ),
        ),
      ),
    );
    openModal(host, T.proposals, body);
  }

  private afterProposal(): void {
    this.renderHud();
    if (this.state?.proposals.some((p) => p.to === this.state!.currentPlayer)) this.showProposals();
    else closeModal(this.modalHost());
  }

  private showGameOver(): void {
    const host = this.modalHost();
    openModal(
      host,
      T.defeat,
      h(
        'div',
        { class: 'menu-list' },
        h('p', {}, T.defeatText),
        h('button', { class: 'btn primary wide', onclick: () => this.showNewGame(false) }, '✦ ' + T.newGame),
      ),
      { closable: false },
    );
  }

  private showTradeRoutes(u: Unit): void {
    const s = this.state!;
    const host = this.modalHost();
    const origin = s.cities.find((c) => c.pos === u.pos)!;
    const body = h(
      'div',
      { class: 'form' },
      h('small', { class: 'muted' }, T.routeCapacity(routesOf(s, u.owner).length, tradeCapacity(s, u.owner))),
      ...tradeDestinations(s, u).map((c) => {
        const ry = routeYields(s, { id: 0, owner: u.owner, from: origin.id, to: c.id });
        const parts = (Object.keys(ry.origin) as (keyof typeof ry.origin)[])
          .filter((k) => ry.origin[k])
          .map((k) => `${YIELD_LABELS[k].icon}+${ry.origin[k]}`)
          .join(' ');
        return h(
          'button',
          {
            class: 'tree-card available',
            onclick: () => {
              if (this.dispatch({ type: 'establishRoute', unitId: u.id, cityId: c.id })) {
                closeModal(host);
                if (!this.selectNextUnit()) this.renderHud();
              }
            },
          },
          h('strong', {}, `${c.name}${c.owner !== u.owner ? ` (${playerName(s, c.owner)})` : ''}`),
          h('small', {}, `${parts} · ${distance(s.map, origin.pos, c.pos)} ${T.hexes}`),
        );
      }),
    );
    openModal(host, T.createRoute, body);
  }

  private showFoundReligion(u: Unit): void {
    const s = this.state!;
    const host = this.modalHost();
    let name = availableReligionNames(s)[0];
    let follower = availableFollowerBeliefs(s)[0];
    const nameSel = h(
      'select',
      { class: 'policy-select', onchange: (e: Event) => (name = (e.target as HTMLSelectElement).value) },
      ...availableReligionNames(s).map((id) => h('option', { value: id }, religionLabel(id))),
    );
    const belSel = h(
      'select',
      { class: 'policy-select', onchange: (e: Event) => (follower = (e.target as HTMLSelectElement).value) },
      ...availableFollowerBeliefs(s).map((id) => h('option', { value: id }, `${FOLLOWER_BY_ID[id].name} — ${FOLLOWER_BY_ID[id].description}`)),
    );
    const body = h(
      'div',
      { class: 'form' },
      h('small', { class: 'muted' }, T.foundReligionHint),
      h('label', { class: 'field-label' }, T.religionName),
      nameSel,
      h('label', { class: 'field-label' }, T.followerBelief),
      belSel,
      h(
        'button',
        {
          class: 'btn primary wide',
          onclick: () => {
            if (this.dispatch({ type: 'foundReligion', unitId: u.id, religion: name, follower })) {
              closeModal(host);
              if (!this.selectNextUnit()) this.renderHud();
            }
          },
        },
        '🕯 ' + T.foundReligion,
      ),
    );
    openModal(host, T.foundReligion, body);
  }

  private showReligion(): void {
    const s = this.state;
    if (!s) return;
    const p = s.players[s.currentPlayer];
    const host = this.modalHost();
    const reopen = () => {
      this.renderHud();
      this.showReligion();
    };
    const pantheon = p.pantheon
      ? h('div', { class: 'dip-card' }, h('strong', {}, `${T.pantheon}: ${PANTHEON_BY_ID[p.pantheon]?.name}`), h('small', {}, PANTHEON_BY_ID[p.pantheon]?.description ?? ''))
      : h(
          'div',
          { class: 'form' },
          h('small', { class: p.faith >= PANTHEON_COST ? 'hint' : 'muted' }, T.pantheonHint(PANTHEON_COST, Math.floor(p.faith))),
          h(
            'div',
            { class: 'tree-grid' },
            ...availablePantheons(s).map((id) =>
              h(
                'button',
                {
                  class: 'tree-card available',
                  disabled: p.faith < PANTHEON_COST,
                  onclick: () => this.dispatch({ type: 'choosePantheon', belief: id }) && reopen(),
                },
                h('strong', {}, PANTHEON_BY_ID[id].name),
                h('small', {}, PANTHEON_BY_ID[id].description),
              ),
            ),
          ),
        );
    const religions = s.religions.map((r) => {
      const followers = s.cities.filter((c) => c.religion === r.id).length;
      return h(
        'div',
        { class: 'dip-card' },
        h('strong', {}, religionLabel(r.id)),
        h('small', {}, `${T.founder}: ${playerName(s, r.founder)} · ${T.followers}: ${followers}`),
        h('small', { class: 'muted' }, `${FOLLOWER_BY_ID[r.follower]?.name}: ${FOLLOWER_BY_ID[r.follower]?.description}`),
      );
    });
    const body = h(
      'div',
      { class: 'form' },
      h('small', { class: 'muted' }, `✨ ${Math.floor(p.faith)} · ${T.religionHint}`),
      h('label', { class: 'field-label' }, T.pantheon),
      pantheon,
      h('label', { class: 'field-label' }, T.religionsLabel),
      religions.length ? null : h('p', { class: 'muted' }, T.noReligionsYet),
      ...religions,
    );
    openModal(host, T.religionTitle, body);
  }

  private showGreatPeople(): void {
    const s = this.state;
    if (!s) return;
    const p = s.players[s.currentPlayer];
    const per = gpPerTurn(s, s.currentPlayer);
    const body = h(
      'div',
      { class: 'form' },
      h('small', { class: 'muted' }, T.gpHint),
      ...Object.values(GREAT_PERSON_TYPES).map((d) => {
        const pts = Math.floor(p.gpPoints[d.id] ?? 0);
        const cost = gpCost(s, d.id);
        return h(
          'div',
          { class: 'dip-card' },
          h('strong', {}, `${d.icon} ${d.name}`),
          h('small', {}, `${pts}/${cost} · +${per[d.id]} ${T.perTurn} · ${T.from} ${DISTRICTS[d.district as DistrictId]?.name}`),
          h('span', { class: 'bar' }, h('span', { style: `width:${Math.min(100, (pts / cost) * 100)}%` })),
        );
      }),
    );
    openModal(this.modalHost(), T.greatPeople, body);
  }

  private showEconomy(): void {
    const s = this.state;
    if (!s) return;
    const me = s.currentPlayer;
    const inc = playerIncome(s, me);
    const m = maintenanceOf(s, me);
    const lux = effectiveLuxuries(s, me);
    const routes = routesOf(s, me);
    const cityName = (id: number) => s.cities.find((c) => c.id === id)?.name ?? '?';
    const body = h(
      'div',
      { class: 'form' },
      h(
        'div',
        { class: 'dip-card' },
        h('strong', {}, T.goldBalance(inc.gold - m.total)),
        h('small', {}, `${T.income}: +${inc.gold}`),
        h('small', {}, `${T.maintenance}: −${m.total} (${T.maintBuildings} ${m.buildings} · ${T.districtsLabel} ${m.districts} · ${T.units} ${m.units})`),
        h('small', { class: 'muted' }, T.maintHint),
      ),
      h(
        'div',
        { class: 'dip-card' },
        h('strong', {}, `${T.luxuries}: ${lux.length}`),
        h('small', {}, lux.length ? lux.map((id) => `${RESOURCE_BY_ID[id].icon} ${RESOURCE_BY_ID[id].name}`).join(' · ') : T.noLuxuries),
        h('small', { class: 'muted' }, T.luxuryHint),
      ),
      h(
        'div',
        { class: 'dip-card' },
        h('strong', {}, T.routeCapacity(routes.length, tradeCapacity(s, me))),
        ...routes.map((r) => h('small', {}, `🐪 ${cityName(r.from)} → ${cityName(r.to)}`)),
      ),
    );
    openModal(this.modalHost(), T.economy, body);
  }

  /** Mostra uma dica do tutorial (uma vez por aparelho). */
  private tip(id: string): void {
    const t = TIPS[id];
    if (!t || !this.prefs.tips || this.prefs.seenTips.includes(id) || !this.el.tip.hidden) return;
    this.prefs.seenTips.push(id);
    savePrefs(this.prefs);
    clear(this.el.tip);
    this.el.tip.append(
      h('strong', {}, `💡 ${t.title}`),
      h('p', {}, t.text),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => (this.el.tip.hidden = true) }, T.gotIt),
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              this.prefs.tips = false;
              savePrefs(this.prefs);
              this.el.tip.hidden = true;
            },
          },
          T.disableTips,
        ),
      ),
    );
    this.el.tip.hidden = false;
  }

  private showVictory(): void {
    const s = this.state!;
    const w = s.winner!;
    const mine = w.player === s.currentPlayer;
    const host = this.modalHost();
    play(mine ? 'victory' : 'error');
    openModal(
      host,
      mine ? T.victoryTitle : T.defeat,
      h(
        'div',
        { class: 'menu-list' },
        h('p', {}, mine ? T.victoryText(VICTORY_LABELS[w.type]) : T.lostText(playerName(s, w.player), VICTORY_LABELS[w.type])),
        h('p', { class: 'muted' }, T.finalScore(scoreOf(s, s.currentPlayer).total)),
        h('button', { class: 'btn primary wide', onclick: () => closeModal(host) }, '▶ ' + T.keepPlaying),
        h('button', { class: 'btn wide', onclick: () => this.showScore() }, '🏆 ' + T.scoreboard),
        h('button', { class: 'btn wide', onclick: () => this.showNewGame(true) }, '✦ ' + T.newGame),
      ),
      { closable: false },
    );
  }

  private showScore(): void {
    const s = this.state;
    if (!s) return;
    const me = s.currentPlayer;
    const known = s.players.filter((p) => !p.isBarbarian && !p.isCityState && (p.id === me || hasMet(s, me, p.id)));
    const unknownCount = s.players.filter((p) => !p.isBarbarian && !p.isCityState && p.id !== me && !hasMet(s, me, p.id)).length;
    const row = (pid: number) => {
      const civ = CIV_BY_ID[s.players[pid].civId];
      const sc = scoreOf(s, pid);
      const dom = dominationProgress(s, pid);
      const sci = scienceProgress(s, pid);
      const cul = cultureProgress(s, pid);
      const rel = religionProgress(s, pid);
      return h(
        'div',
        { class: 'dip-card', style: `--civ:${civ?.color};--civ2:${civ?.secondaryColor}` },
        h(
          'div',
          { class: 'dip-head' },
          h('span', { class: 'civ-swatch' }),
          h('div', {}, h('strong', {}, `${civ?.name}${pid === me ? ` (${T.you})` : ''}`), h('small', {}, `${playerEra(s, pid).name} · ${T.points}: ${sc.total}`)),
        ),
        h('small', {}, `⚔ ${VICTORY_LABELS.domination}: ${dom.held}/${dom.total} ${T.capitals}`),
        h('small', {}, `🔬 ${VICTORY_LABELS.science}: ${sci.techs}/${sci.totalTechs} ${T.techsWord} → ${T.starProject}`),
        h('small', {}, `🎭 ${VICTORY_LABELS.culture}: ${cul.civics}/${cul.totalCivics} ${T.civicsWord} · ${cul.culture} (${T.rivalBest} ${cul.bestRival})`),
        h('small', {}, `✨ ${VICTORY_LABELS.religion}: ${rel.majority}/${rel.total} ${T.civsWord}`),
      );
    };
    const body = h(
      'div',
      { class: 'form' },
      h('small', { class: 'muted' }, T.victoryHelp(s.settings.turnLimit ?? 250)),
      s.winner ? h('p', { class: 'hint' }, T.winnerLine(playerName(s, s.winner.player), VICTORY_LABELS[s.winner.type], s.winner.turn)) : null,
      ...known.sort((a, b) => scoreOf(s, b.id).total - scoreOf(s, a.id).total).map((p) => row(p.id)),
      unknownCount ? h('small', { class: 'muted' }, T.unknownCivs(unknownCount)) : null,
    );
    openModal(this.modalHost(), T.scoreboard, body);
  }

  private showSettings(): void {
    const host = this.modalHost();
    if (this.prefs.hq3d === undefined) this.prefs.hq3d = this.view.kind === '3d' ? (this.view as { quality?: string }).quality === 'high' : true;
    const toggle = (label: string, key: 'sound' | 'tips' | 'animations' | 'largeText' | 'view3d' | 'hq3d' | 'watchAi') =>
      h(
        'button',
        {
          class: `btn wide toggle${this.prefs[key] ? ' on' : ''}`,
          'aria-pressed': String(this.prefs[key]),
          onclick: () => {
            this.prefs[key] = !this.prefs[key];
            if (key === 'tips' && this.prefs.tips) this.prefs.seenTips = [];
            savePrefs(this.prefs);
            applyPrefs(this.prefs);
            setSoundEnabled(this.prefs.sound);
            this.showSettings();
            if (key === 'view3d') void this.applyViewPref();
            if (key === 'hq3d') void this.applyViewPref(true);
            this.view.resize();
            this.invalidate();
          },
        },
        `${this.prefs[key] ? '✔' : '✕'} ${label}`,
      );
    openModal(
      host,
      T.settings,
      h(
        'div',
        { class: 'menu-list' },
        toggle(T.prefSound, 'sound'),
        toggle(T.prefTips, 'tips'),
        toggle(T.prefAnimations, 'animations'),
        toggle(T.prefWatchAi, 'watchAi'),
        h('small', { class: 'muted' }, T.watchAiHint),
        toggle(T.prefLargeText, 'largeText'),
        toggle(T.prefView3d, 'view3d'),
        ...(this.prefs.view3d ? [toggle(T.prefHq3d, 'hq3d')] : []),
        h('small', { class: 'muted' }, T.view3dHint),
        h('small', { class: 'muted' }, T.keyboardHelp),
      ),
    );
  }

  /** Tela de passagem de vez (esconde o mapa até o próximo jogador tocar). */
  private showHandoff(): void {
    const s = this.state!;
    const p = s.players[s.currentPlayer];
    const civ = CIV_BY_ID[p.civId];
    this.selectedUnitId = undefined;
    this.selectedCityId = undefined;
    this.selectedTile = undefined;
    this.pendingPath = undefined;
    this.pendingAttack = undefined;
    this.placement = undefined;
    const host = this.modalHost();
    this.el.modal.classList.add('handoff');
    openModal(
      host,
      T.handoffTitle,
      h(
        'div',
        { class: 'menu-list' },
        h('div', { class: 'dip-head', style: `--civ:${civ?.color};--civ2:${civ?.secondaryColor}` }, h('span', { class: 'civ-swatch' }), h('strong', {}, `${civ?.name} — ${civ?.leaderTitle} ${civ?.leader}`)),
        h('p', {}, T.handoffText(s.turn)),
        h(
          'button',
          {
            class: 'btn primary wide',
            onclick: () => {
              this.el.modal.classList.remove('handoff');
              closeModal(host);
              this.setState(s);
              this.resetFx();
              if (!this.selectNextUnit()) this.centerOnSelection();
              this.showTurnBanner();
              const w = s.winner;
              if (w && !this.victoryShown) {
                this.victoryShown = true;
                this.showVictory();
              } else if (this.inbox[s.currentPlayer]?.length) this.showInbox();
              else if (s.proposals.some((x) => x.to === s.currentPlayer)) this.showProposals();
            },
          },
          '▶ ' + T.startTurn,
        ),
      ),
      { closable: false },
    );
  }

  private showPromotions(u: Unit): void {
    const host = this.modalHost();
    const body = h(
      'div',
      { class: 'form' },
      h('small', { class: 'muted' }, T.promoteHint),
      ...promotionOptions(u).map((p) =>
        h(
          'button',
          {
            class: 'tree-card available',
            onclick: () => {
              if (this.dispatch({ type: 'promote', unitId: u.id, promotion: p.id })) {
                closeModal(host);
                if (!this.selectNextUnit()) this.renderHud();
              }
            },
          },
          h('strong', {}, `★ ${p.name}`),
          h('small', {}, p.description),
        ),
      ),
    );
    openModal(host, `${T.promote} — ${UNITS[u.type].name}`, body);
  }

  private showTree(kind: TreeKind): void {
    const s = this.state;
    if (!s) return;
    const p = s.players[s.currentPlayer];
    const host = this.modalHost();
    const list = kind === 'tech' ? TECHS : CIVICS;
    const byId = kind === 'tech' ? TECH_BY_ID : CIVIC_BY_ID;
    const inc = playerIncome(s, s.currentPlayer);
    const per = kind === 'tech' ? inc.science : inc.culture;
    const knownIds = kind === 'tech' ? p.techs : p.civics;
    const current = kind === 'tech' ? p.researching : p.researchingCivic;
    const avail = new Set(availableItems(p, kind));
    const memo = new Map<string, number>();
    const tiers = new Map<number, typeof list>();
    for (const d of list) {
      const t = treeDepth(kind, d.id, memo);
      tiers.set(t, [...(tiers.get(t) ?? []), d]);
    }
    const card = (d: (typeof list)[number]) => {
      const done = knownIds.includes(d.id);
      const isCur = current === d.id;
      const cost = treeCost(p, kind, d.id);
      const prog = progressOf(p, kind, d.id);
      const state = done ? T.researched : isCur ? T.researching : avail.has(d.id) ? T.available : T.locked;
      const turns = done ? '' : ` · ${isFinite(turnsFor(p, kind, d.id, per)) ? T.turns(turnsFor(p, kind, d.id, per)) : '∞'}`;
      const boostLabel = kind === 'tech' ? T.eureka : T.inspiration;
      return h(
        'button',
        {
          class: `tree-card${done ? ' done' : ''}${isCur ? ' current' : ''}${avail.has(d.id) ? ' available' : ''}`,
          disabled: !avail.has(d.id) || done,
          onclick: () => {
            if (this.dispatch({ type: 'setResearch', kind, id: d.id })) {
              closeModal(host);
              this.renderHud();
            }
          },
        },
        h('strong', {}, `${done ? '✓ ' : ''}${d.name}`),
        h('small', {}, `${state} · ${Math.floor(prog)}/${cost}${turns}`),
        h('small', { class: 'muted' }, d.description),
        d.prereqs.length && !done ? h('small', { class: 'muted' }, `${T.requires}: ${d.prereqs.map((r) => byId[r]?.name ?? r).join(', ')}`) : null,
        d.boost && !done
          ? h(
              'small',
              { class: p.boosts.includes(d.id) ? 'boost ok' : 'boost' },
              `💡 ${boostLabel}: ${d.boost.description}${p.boosts.includes(d.id) ? ` — ${T.boostDone}` : ''}`,
            )
          : null,
        isCur ? h('span', { class: 'bar' }, h('span', { style: `width:${Math.min(100, (prog / cost) * 100)}%` })) : null,
      );
    };
    const body = h(
      'div',
      { class: 'form' },
      h('small', { class: 'muted' }, `${kind === 'tech' ? '🔬' : '🎭'} +${per} ${T.perTurn}`),
      kind === 'civic' ? h('button', { class: 'btn', onclick: () => this.showGovernment() }, '🏛 ' + T.government) : null,
      ...[...tiers.keys()]
        .sort((a, b) => a - b)
        .flatMap((t) => [h('label', { class: 'field-label' }, T.tier(t)), h('div', { class: 'tree-grid' }, ...tiers.get(t)!.map(card))]),
    );
    openModal(host, kind === 'tech' ? T.techTree : T.civicTree, body);
  }

  private showGovernment(): void {
    const s = this.state;
    if (!s) return;
    const p = s.players[s.currentPlayer];
    const host = this.modalHost();
    const reopen = () => {
      this.renderHud();
      this.showGovernment();
    };
    const govs = new Set(availableGovernments(p));
    const govCards = GOVERNMENTS.filter((g) => govs.has(g.id)).map((g) =>
      h(
        'button',
        {
          class: `tree-card available${p.government === g.id ? ' current' : ''}`,
          disabled: p.government === g.id || !p.policyChangeAvailable,
          onclick: () => this.dispatch({ type: 'setGovernment', id: g.id }) && reopen(),
        },
        h('strong', {}, `${p.government === g.id ? '✓ ' : ''}${g.name}`),
        h('small', {}, `${SLOT_LABELS.military} ${g.slots.military} · ${SLOT_LABELS.economic} ${g.slots.economic} · ${SLOT_LABELS.wildcard} ${g.slots.wildcard}`),
        h('small', { class: 'muted' }, g.description),
      ),
    );
    const pols = availablePolicies(p);
    const slots = governmentSlots(p.government).map((slot, i) => {
      const sel = h(
        'select',
        {
          class: 'policy-select',
          disabled: !p.policyChangeAvailable,
          'aria-label': `${SLOT_LABELS[slot]} ${i + 1}`,
          onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            if (!this.dispatch({ type: 'setPolicy', slot: i, policy: v || null })) reopen();
            else reopen();
          },
        },
        h('option', { value: '' }, T.emptySlotPolicy),
        ...pols
          .filter((id) => canSlotPolicy(slot, id))
          .map((id) => h('option', { value: id, selected: p.policies[i] === id }, `${POLICY_BY_ID[id].name} — ${POLICY_BY_ID[id].description}`)),
      );
      return h('div', { class: 'slot-row' }, h('span', { class: `slot-tag ${slot}` }, SLOT_LABELS[slot]), sel);
    });
    const body = h(
      'div',
      { class: 'form' },
      h('small', { class: p.policyChangeAvailable ? 'hint' : 'muted' }, p.policyChangeAvailable ? T.policyWindow : T.policyLocked),
      !p.policyChangeAvailable && p.government
        ? h(
            'button',
            {
              class: 'btn',
              disabled: p.gold < policyUnlockCost(p),
              onclick: () => this.dispatch({ type: 'unlockPolicies' }) && reopen(),
            },
            `🔓 ${T.unlockPolicies(policyUnlockCost(p))}`,
          )
        : null,
      p.government ? null : h('p', { class: 'muted' }, T.noGovernment),
      govCards.length ? h('label', { class: 'field-label' }, 'Governos') : null,
      govCards.length ? h('div', { class: 'tree-grid' }, ...govCards) : null,
      slots.length ? h('label', { class: 'field-label' }, 'Políticas') : null,
      ...slots,
    );
    openModal(host, T.government, body);
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
    const techs = this.revealAll ? undefined : s.players[s.currentPlayer].techs;
    const res = visibleResource(t, techs);
    if (res) {
      const r = RESOURCE_BY_ID[res];
      lines.push(h('small', {}, `${r.icon} ${r.name} (${RESOURCE_KIND_LABEL[r.kind]})`));
    }
    const y = tileYields(t, techs);
    const ys = YIELD_KEYS.filter((k) => y[k] > 0)
      .map((k) => `${YIELD_LABELS[k].icon} ${y[k]}`)
      .join('  ');
    lines.push(h('small', {}, `${T.yields}: ${ys || '—'}`));
    if (!isPassableLand(t) && t.terrain !== 'coast' && t.terrain !== 'ocean') lines.push(h('small', { class: 'muted' }, T.impassable));
    if (s.camps.some((c) => c.pos === idx)) lines.push(h('small', { class: 'danger-text' }, '⛺ ' + T.barbarianCamp));
    const vis = this.revealAll || this.vis[idx] === 1;
    for (const en of s.units.filter((x) => x.pos === idx && x.owner !== s.currentPlayer)) {
      if (!vis) break;
      const d = UNITS[en.type];
      const civ = CIV_BY_ID[s.players[en.owner].civId];
      lines.push(h('small', { class: 'danger-text' }, `${d.glyph} ${d.name} (${civ?.name}) · ❤ ${en.hp} · ⚔ ${d.strength}${d.rangedStrength ? ` · 🏹 ${d.rangedStrength}` : ''}`));
    }
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
      h('button', { class: 'btn wide', onclick: () => this.showTree('tech') }, '🔬 ' + T.techTree),
      h('button', { class: 'btn wide', onclick: () => this.showTree('civic') }, '🎭 ' + T.civicTree),
      h('button', { class: 'btn wide', onclick: () => this.showGovernment() }, '🏛 ' + T.government),
      h('button', { class: 'btn wide', onclick: () => this.showDiplomacy() }, '🤝 ' + T.diplomacy),
      h('button', { class: 'btn wide', onclick: () => this.showEconomy() }, '🪙 ' + T.economy),
      h('button', { class: 'btn wide', onclick: () => this.showReligion() }, '✨ ' + T.religionTitle),
      h('button', { class: 'btn wide', onclick: () => this.showGreatPeople() }, '✦ ' + T.greatPeople),
      h('button', { class: 'btn wide', onclick: () => this.showScore() }, '🏆 ' + T.scoreboard),
      h('button', { class: 'btn wide', onclick: () => this.showSettings() }, '⚙ ' + T.settings),
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
      this.startNewGame(c.seed, c.mapSize, c.civId, c.rivals, c.cityStates, c.turnLimit, c.extraHumans);
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
      this.selectedCityId = undefined;
      this.setState(normalizeState(s));
      this.loadInbox();
      this.resetFx();
      this.victoryShown = !!s.winner;
      if (!this.selectNextUnit()) this.centerOnSelection();
      this.toast(T.loaded);
      if (this.state?.proposals.some((p) => p.to === this.state!.currentPlayer)) this.showProposals();
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    }
  }
}
