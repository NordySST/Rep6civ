import { CIV_BY_ID } from '../data/civs';
import { FEATURE_REMOVAL, IMPROVEMENTS } from '../data/improvements';
import { RESOURCE_BY_ID, RESOURCE_KIND_LABEL } from '../data/resources';
import { UNITS } from '../data/units';
import { WONDER_BY_ID } from '../data/wonders';
import { YIELD_KEYS, YIELD_LABELS } from '../data/yields';
import { clampCamera, clampZoom, type Camera, zoomAt } from '../render/camera';
import { Renderer, tileAtWorld, tileCenter, worldSize, type Overlay } from '../render/renderer';
import { applyAction, unitsNeedingOrders, type Action, type ActionResult } from '../rules/actions';
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
import { cityAmenities, improvedLuxuries, maintenanceOf } from '../rules/economy';
import { gpCost, gpPerTurn } from '../rules/greatPeople';
import {
  availableFollowerBeliefs,
  availablePantheons,
  availableReligionNames,
  canBuyMissionary,
  cannotFoundReligion,
  religionOf,
} from '../rules/religion';
import { routesOf, routeYields, tradeCapacity, tradeDestinations } from '../rules/trade';
import { distance } from '../rules/hex';
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
import { screenToWorld } from '../render/camera';
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
  private anims: {
    unitId: number;
    from: { x: number; y: number };
    to: { x: number; y: number };
    start: number;
    dur: number;
    /** 'move' desliza; 'lunge' avança e volta (ataque corpo a corpo). */
    kind?: 'move' | 'lunge';
  }[] = [];
  private projectiles: { from: { x: number; y: number }; to: { x: number; y: number }; start: number; dur: number }[] = [];
  private floaters: { x: number; y: number; text: string; color: string; start: number }[] = [];

  private el = {
    canvas: h('canvas', { id: 'map', 'aria-label': 'Mapa do jogo' }),
    topbar: h('header', { class: 'topbar' }),
    zoom: h('div', { class: 'zoom-ctrl' }),
    panel: h('section', { class: 'panel', 'aria-live': 'polite' }),
    endTurn: h('button', { class: 'btn primary end-turn' }, T.nextTurn),
    toast: h('div', { class: 'toast', role: 'status' }),
    tip: h('div', { class: 'tip', hidden: true, role: 'note' }),
    modal: h('div', { class: 'modal', hidden: true }),
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
    root.append(this.el.canvas, this.el.topbar, this.el.zoom, bottom, this.el.toast, this.el.modal, this.el.tip);
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
    // gancho de depuração/testes automatizados (somente leitura)
    (window as unknown as { __rep6civ?: unknown }).__rep6civ = { camera: () => ({ ...this.cam }), turn: () => this.state?.turn };
  }

  // ------------------------------------------------------------------ ciclo

  start(): void {
    const auto = readSlotInfo(AUTOSAVE_SLOT);
    this.showMainMenu(!!auto);
  }

  private loop = () => {
    const now = performance.now();
    this.anims = this.anims.filter((a) => now - a.start < a.dur);
    this.floaters = this.floaters.filter((f) => now - f.start < 1100);
    this.projectiles = this.projectiles.filter((p) => now - p.start < p.dur);
    if (this.anims.length || this.floaters.length || this.projectiles.length) this.dirty = true;
    if (this.dirty && this.state) {
      this.dirty = false;
      const unitPositions = new Map<number, { x: number; y: number }>();
      for (const a of this.anims) {
        const t = Math.min(1, (now - a.start) / a.dur);
        const e = a.kind === 'lunge' ? 0.45 * Math.sin(Math.PI * t) : t * (2 - t);
        unitPositions.set(a.unitId, { x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e });
      }
      const projectiles = this.projectiles.map((p) => {
        const t = Math.min(1, (now - p.start) / p.dur);
        return { x: p.from.x + (p.to.x - p.from.x) * t, y: p.from.y + (p.to.y - p.from.y) * t - Math.sin(Math.PI * t) * 18 };
      });
      const floaters = this.floaters.filter((f) => now >= f.start).map((f) => {
        const t = (now - f.start) / 1100;
        return { x: f.x, y: f.y - 24 * t, text: f.text, color: f.color, alpha: 1 - t * t };
      });
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
        unitPositions: unitPositions.size ? unitPositions : undefined,
        floaters,
        projectiles,
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
    const before = new Map(this.state.units.filter((u) => u.owner === this.state!.currentPlayer).map((u) => [u.id, u.pos]));
    // o fim de turno passa pela IA (rivais e cidades-estado jogam antes da rodada terminar)
    const result = action.type === 'endTurn' ? playEndTurn(this.state) : applyAction(this.state, action);
    const ok = this.applyResult(result);
    if (ok) this.animateResult(before, result.events, action.type === 'endTurn');
    return ok;
  }

  private animateResult(before: Map<number, number>, events: ActionResult['events'], endTurn: boolean): void {
    const s = this.state!;
    const now = performance.now();
    if (this.prefs.animations && !endTurn) {
      for (const u of s.units) {
        const from = before.get(u.id);
        if (from === undefined || from === u.pos) continue;
        const d = distance(s.map, from, u.pos);
        this.anims.push({ unitId: u.id, from: tileCenter(s, from), to: tileCenter(s, u.pos), start: now, dur: Math.min(450, 120 + d * 90) });
      }
    }
    let sfx: Sfx | null = endTurn ? 'endTurn' : null;
    for (const ev of events) {
      if (ev.type === 'combat') {
        if (this.revealAll || this.vis[ev.pos]) {
          const c = tileCenter(s, ev.pos);
          if (this.prefs.animations) {
            const ranged = ev.attackerType === 'city' || !!UNITS[ev.attackerType]?.rangedStrength;
            const from = tileCenter(s, ev.from);
            // impacto aparece depois do golpe/projétil
            const delay = ranged ? 260 : 160;
            this.floaters.push({ x: c.x, y: c.y - 8, text: `−${ev.damageToTarget}`, color: '#ff6b5b', start: now + delay });
            if (ranged) this.projectiles.push({ from, to: c, start: now, dur: 260 });
            else {
              const atk = s.units.find((u) => u.owner === ev.attackerOwner && (u.pos === ev.from || u.pos === ev.pos) && u.type === ev.attackerType);
              if (atk && atk.pos === ev.from) this.anims.push({ unitId: atk.id, from, to: c, start: now, dur: 320, kind: 'lunge' });
            }
          }
        }
        if (ev.attackerOwner === s.currentPlayer || ev.defenderOwner === s.currentPlayer) sfx = 'combat';
      } else if (ev.type === 'cityFounded') sfx = 'city';
      else if (ev.type === 'firstContact' || ev.type === 'warDeclared' || ev.type === 'eraChanged' || ev.type === 'greatPerson') sfx = sfx ?? 'notify';
      else if (ev.type === 'victory') sfx = 'victory';
    }
    if (sfx) play(sfx);
    this.invalidate();
  }

  private applyResult({ state, events }: ActionResult): boolean {
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
      const msgs = events.map((ev) => this.eventMessage(ev, state)).filter((m): m is string => !!m);
      if (msgs.length) this.toast(msgs.slice(0, 3).join('\n') + (msgs.length > 3 ? `\n(+${msgs.length - 3})` : ''));
    }
    return ok;
  }

  private eventMessage(ev: ReturnType<typeof applyAction>['events'][number], s: GameState): string | null {
    const cname = (id: number) => s.cities.find((c) => c.id === id)?.name ?? '';
    const mineCity = (id: number) => s.cities.find((c) => c.id === id)?.owner === s.currentPlayer;
    switch (ev.type) {
      case 'cityFounded': {
        const owner = s.cities.find((c) => c.id === ev.cityId)?.owner;
        if (owner === s.currentPlayer) return T.cityFounded(ev.name);
        return owner !== undefined && hasMet(s, s.currentPlayer, owner) && !s.players[owner].isCityState
          ? T.cityFoundedBy(playerName(s, owner), ev.name)
          : null;
      }
      case 'produced': {
        const owner = s.cities.find((c) => c.id === ev.cityId)?.owner;
        if (ev.item.kind === 'wonder') return T.wonderBuilt(itemName(ev.item), owner === undefined ? '?' : playerName(s, owner));
        return owner === s.currentPlayer ? T.produced(cname(ev.cityId), itemName(ev.item)) : null;
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
        const mine = ev.attackerOwner === s.currentPlayer;
        const theirs = ev.defenderOwner === s.currentPlayer;
        if (!mine && !theirs) return null;
        let m = T.combatMsg(atk, ev.targetName, ev.damageToTarget, ev.damageToAttacker, !mine);
        if (ev.targetKilled) m += ' ' + T.killed(ev.targetName);
        if (ev.attackerKilled) m += ' ' + T.killed(atk);
        return m;
      }
      case 'captured':
        if (ev.by === s.currentPlayer) return T.capturedMsg(UNITS[ev.unitType]?.name ?? ev.unitType);
        return ev.from === s.currentPlayer ? T.lostCivilian(UNITS[ev.unitType]?.name ?? ev.unitType) : null;
      case 'cityCaptured':
        return ev.by === s.currentPlayer || hasMet(s, s.currentPlayer, ev.by) ? T.cityCapturedMsg(ev.name) : null;
      case 'campCleared':
        return ev.by === s.currentPlayer ? T.campCleared(ev.gold) : null;
      case 'unitLost':
        return ev.owner === s.currentPlayer ? T.lostCivilian(UNITS[ev.unitType]?.name ?? ev.unitType) : null;
      case 'firstContact': {
        const me = s.currentPlayer;
        if (ev.a !== me && ev.b !== me) return null;
        this.tip('contact');
        return T.firstContact(playerName(s, ev.a === me ? ev.b : ev.a));
      }
      case 'warDeclared':
        if (ev.on === s.currentPlayer) return T.warOnUs(playerName(s, ev.by));
        if (ev.by === s.currentPlayer) return T.weDeclared(playerName(s, ev.on));
        return hasMet(s, s.currentPlayer, ev.by) ? T.warBetween(playerName(s, ev.by), playerName(s, ev.on)) : null;
      case 'peaceMade': {
        const me = s.currentPlayer;
        if (ev.a === me || ev.b === me) return T.peaceWith(playerName(s, ev.a === me ? ev.b : ev.a));
        return null;
      }
      case 'agreement': {
        const me = s.currentPlayer;
        if (ev.a !== me && ev.b !== me) return null;
        return T.agreementMsg(ev.item, playerName(s, ev.a === me ? ev.b : ev.a));
      }
      case 'dealRejected':
        return T.dealRejected(playerName(s, ev.by), ev.reason);
      case 'suzerainChanged':
        return hasMet(s, s.currentPlayer, ev.cityState)
          ? T.suzerainMsg(playerName(s, ev.cityState), ev.suzerain === null ? null : playerName(s, ev.suzerain))
          : null;
      case 'eliminated':
        return hasMet(s, s.currentPlayer, ev.player) ? T.eliminatedMsg(playerName(s, ev.player)) : null;
      case 'envoyGained':
        return ev.player === s.currentPlayer ? T.envoyGained : null;
      case 'disbanded':
        return ev.player === s.currentPlayer ? T.disbandedMsg(UNITS[ev.unitType]?.name ?? ev.unitType) : null;
      case 'routeCreated':
        return ev.owner === s.currentPlayer ? T.routeCreated(cname(ev.from), cname(ev.to)) : null;
      case 'routeLost':
        return ev.owner === s.currentPlayer ? T.routeLost(cname(ev.from), cname(ev.to)) : null;
      case 'pantheon':
        return ev.player === s.currentPlayer ? T.pantheonMsg(PANTHEON_BY_ID[ev.belief]?.name ?? ev.belief) : null;
      case 'religionFounded':
        return T.religionFoundedMsg(playerName(s, ev.player), religionLabel(ev.religion));
      case 'cityConverted': {
        const c = s.cities.find((x) => x.id === ev.cityId);
        return c && c.owner === s.currentPlayer ? T.convertedMsg(c.name, religionLabel(ev.religion)) : null;
      }
      case 'greatPerson': {
        const def = GREAT_PERSON_TYPES[ev.gpType];
        return ev.player === s.currentPlayer ? T.gpRecruited(ev.name, def.name) : hasMet(s, s.currentPlayer, ev.player) ? T.gpOther(playerName(s, ev.player), ev.name) : null;
      }
      case 'eraChanged':
        return ev.player === s.currentPlayer ? T.eraMsg(ev.era) : null;
      case 'victory':
        return null;
      case 'techDone':
        return ev.playerId === s.currentPlayer ? T.techDone(TECH_BY_ID[ev.id]?.name ?? ev.id) : null;
      case 'civicDone':
        if (ev.playerId === s.currentPlayer && s.players[s.currentPlayer].government) this.tip('policies');
        return ev.playerId === s.currentPlayer ? `${T.civicDone(CIVIC_BY_ID[ev.id]?.name ?? ev.id)} ${T.policyWindow}` : null;
      case 'boost':
        return ev.playerId === s.currentPlayer
          ? T.boosted(ev.kind, (ev.kind === 'tech' ? TECH_BY_ID : CIVIC_BY_ID)[ev.id]?.name ?? ev.id)
          : null;
      case 'governmentUnlocked':
        return ev.playerId === s.currentPlayer ? T.govUnlocked(GOVERNMENT_BY_ID[ev.id]?.name ?? ev.id) : null;
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
  ): void {
    const s = newGame({ seed, mapSize, civId, rivals, cityStates, turnLimit });
    this.selectedUnitId = undefined;
    this.selectedTile = undefined;
    this.pendingPath = undefined;
    this.setState(s);
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
    if (!this.dispatch({ type: 'endTurn' }) || !this.state) return;
    this.autosave();
    this.selectedCityId = undefined;
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
    if (def.spreads && u.religion) {
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
    if (c.districts.length || c.wonders.length) {
      const ds = c.districts.map((d) => `${DISTRICTS[d.type as DistrictId]?.icon ?? ''} ${DISTRICTS[d.type as DistrictId]?.name ?? d.type}`);
      const ws = c.wonders.map((w) => `★ ${WORLD_WONDER_BY_ID[w]?.name ?? w}`);
      lines.splice(4, 0, h('small', {}, [...ds, ...ws].join(' · ')));
    }
    const actions: HTMLElement[] = [
      ...(this.pendingAttack !== undefined ? [h('button', { class: 'btn danger', onclick: () => this.confirmAttack() }, '🏹 ' + T.attack)] : []),
      h('button', { class: `btn ${item ? '' : 'primary'}`, onclick: () => this.showProduction() }, '⚒ ' + T.production),
      ...(c.religion && religionOf(s, c.owner)
        ? [
            h(
              'button',
              {
                class: 'btn',
                disabled: !!canBuyMissionary(s, c),
                title: canBuyMissionary(s, c) ?? '',
                onclick: () => this.dispatch({ type: 'buyWithFaith', cityId: c.id, unit: 'missionary' }) && this.renderHud(),
              },
              `☦ ${T.buyMissionary(UNITS.missionary.faithCost ?? 80)}`,
            ),
          ]
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
    const lux = improvedLuxuries(s, me);
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
    const toggle = (label: string, key: 'sound' | 'tips' | 'animations' | 'largeText') =>
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
            this.renderer.resize();
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
        toggle(T.prefLargeText, 'largeText'),
        h('small', { class: 'muted' }, T.keyboardHelp),
      ),
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
      this.startNewGame(c.seed, c.mapSize, c.civId, c.rivals, c.cityStates, c.turnLimit);
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
      this.victoryShown = !!s.winner;
      if (!this.selectNextUnit()) this.centerOnSelection();
      this.toast(T.loaded);
      if (this.state?.proposals.some((p) => p.to === this.state!.currentPlayer)) this.showProposals();
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    }
  }
}
