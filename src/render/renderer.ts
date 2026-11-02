import { CIV_BY_ID } from '../data/civs';
import type { ImprovementId } from '../data/improvements';
import { RESOURCE_BY_ID } from '../data/resources';
import { TERRAINS } from '../data/terrains';
import { DISTRICTS, type DistrictId } from '../data/districts';
import { PROMOTION_XP } from '../data/promotions';
import { WORLD_WONDER_BY_ID } from '../data/worldWonders';
import { UNITS } from '../data/units';
import { WONDER_BY_ID } from '../data/wonders';
import type { GameState, Tile } from '../state/types';
import { tileYields, visibleResource } from '../rules/tiles';
import { colRow, hexCorner, hexToPixel, neighbor, pixelToOffset, SQRT3 } from '../rules/hex';
import { type Camera, screenToWorld, worldToScreen } from './camera';
import type { MapView } from './view';

/** Raio do hexágono em unidades de mundo. */
export const HEX_SIZE = 32;

export interface Overlay {
  selectedUnitId?: number;
  selectedTile?: number;
  reachable?: Set<number>;
  path?: number[];
  pathTurns?: number;
  /** Mostra tudo sem névoa (depuração). */
  revealAll?: boolean;
  /** Visão de gestão de cidade. */
  cityView?: {
    cityId: number;
    worked: Set<number>;
    locked: Set<number>;
    workable: number[];
    buyable: Map<number, number>;
  };
  /** Posições animadas de unidades (coordenadas de mundo). */
  unitPositions?: Map<number, { x: number; y: number }>;
  /** Projéteis de ataques à distância (posição atual em coordenadas de mundo). */
  projectiles?: { x: number; y: number; angle: number; heavy: boolean; tail: { x: number; y: number } }[];
  /** Textos flutuantes (dano etc.). */
  floaters?: { x: number; y: number; text: string; color: string; alpha: number; size?: number }[];
  /** Unidades destruídas sumindo. */
  ghosts?: { type: string; owner: number; x: number; y: number; alpha: number }[];
  /** Anéis (cidade fundada, acampamento destruído…) e impactos; `t` em [0,1]. */
  bursts?: { x: number; y: number; color: string; kind: 'ring' | 'impact'; t: number }[];
  /** Fase [0,1) do pulso da unidade selecionada (sem valor = destaque fixo). */
  pulse?: number;
  /** Modo de posicionamento de distrito/maravilha: hexágono → rótulo (ex.: "+2"). */
  placement?: { sites: Map<number, string>; chosen?: number };
  /** Hexágonos atacáveis pela seleção atual. */
  attackTargets?: Set<number>;
  /** Alvo com ataque pendente de confirmação. */
  pendingAttack?: number;
  /** Informação de cidades para os estandartes (crescimento/produção). */
  cityInfo?: Map<number, { growTurns: number; prodName?: string; prodTurns?: number; prodFrac: number }>;
}

/** Período horizontal do mundo (mapas com volta leste-oeste). */
export function worldPeriod(state: GameState): number {
  return HEX_SIZE * SQRT3 * state.map.width;
}

/** Centro de `idx` deslocado para a cópia mais próxima do ponto `near` (emenda do mapa). */
export function nearCenter(state: GameState, idx: number, near: { x: number; y: number }): { x: number; y: number } {
  const c = tileCenter(state, idx);
  if (!state.map.wrap) return c;
  const P = worldPeriod(state);
  let x = c.x;
  while (x - near.x > P / 2) x -= P;
  while (near.x - x > P / 2) x += P;
  return { x, y: c.y };
}

export function worldSize(state: GameState) {
  return {
    w: state.map.wrap ? worldPeriod(state) : HEX_SIZE * SQRT3 * (state.map.width + 0.5),
    h: HEX_SIZE * 1.5 * (state.map.height - 1) + HEX_SIZE * 2,
  };
}

export function tileCenter(state: GameState, idx: number) {
  const { col, row } = colRow(state.map, idx);
  const p = hexToPixel(col, row, HEX_SIZE);
  return { x: p.x + (HEX_SIZE * SQRT3) / 2, y: p.y + HEX_SIZE };
}

export function tileAtWorld(state: GameState, wx: number, wy: number): number {
  const off = pixelToOffset(wx - (HEX_SIZE * SQRT3) / 2, wy - HEX_SIZE, HEX_SIZE);
  const row = off.row;
  const col = state.map.wrap ? ((off.col % state.map.width) + state.map.width) % state.map.width : off.col;
  if (col < 0 || row < 0 || col >= state.map.width || row >= state.map.height) return -1;
  return row * state.map.width + col;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

/** Pequeno PRNG determinístico por hexágono, para variação visual estável. */
function tileRand(idx: number, k: number): number {
  let h = Math.imul(idx ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const c = hexCorner(cx, cy, size, i);
    if (i === 0) ctx.moveTo(c.x, c.y);
    else ctx.lineTo(c.x, c.y);
  }
  ctx.closePath();
}

export class Renderer implements MapView {
  readonly kind = '2d';
  readonly ctx: CanvasRenderingContext2D;
  dpr = 1;
  vw = 0;
  vh = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponível');
    this.ctx = ctx;
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const r = this.canvas.getBoundingClientRect();
    this.vw = r.width;
    this.vh = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  /** Fase do pulso da seleção no quadro atual (ver `Overlay.pulse`). */
  private pulse?: number;

  draw(state: GameState, cam: Camera, vis: Uint8Array, overlay: Overlay): void {
    const { ctx } = this;
    this.pulse = overlay.pulse;
    const playerId = state.currentPlayer;
    const explored = state.players[playerId].explored;
    const techs = state.players[playerId].techs;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, this.vw, this.vh);
    if (!state.map.wrap) {
      this.drawWorld(state, cam, vis, overlay, explored, techs, playerId);
    } else {
      // mapa cilíndrico: desenha as cópias vizinhas que aparecem na tela
      const P = worldPeriod(state);
      const half = this.vw / 2 / cam.zoom;
      for (const sh of [-P, 0, P]) {
        const cx = cam.x - sh;
        if (cx + half < -HEX_SIZE * 2 || cx - half > P + HEX_SIZE * 2) continue;
        this.drawWorld(state, { ...cam, x: cx }, vis, overlay, explored, techs, playerId);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawWorld(
    state: GameState,
    cam: Camera,
    vis: Uint8Array,
    overlay: Overlay,
    explored: number[],
    techs: readonly string[],
    playerId: number,
  ): void {
    const { ctx } = this;
    // transforma para coordenadas de mundo
    ctx.setTransform(
      this.dpr * cam.zoom,
      0,
      0,
      this.dpr * cam.zoom,
      this.dpr * (this.vw / 2 - cam.x * cam.zoom),
      this.dpr * (this.vh / 2 - cam.y * cam.zoom),
    );

    // faixa de hexágonos visíveis na tela
    const tl = screenToWorld(cam, this.vw, this.vh, 0, 0);
    const br = screenToWorld(cam, this.vw, this.vh, this.vw, this.vh);
    const rowH = HEX_SIZE * 1.5;
    const colW = HEX_SIZE * SQRT3;
    const r0 = Math.max(0, Math.floor(tl.y / rowH) - 1);
    const r1 = Math.min(state.map.height - 1, Math.ceil(br.y / rowH) + 1);
    const c0 = Math.max(0, Math.floor(tl.x / colW) - 1);
    const c1 = Math.min(state.map.width - 1, Math.ceil(br.x / colW) + 1);

    const detail = cam.zoom >= 0.55;
    const isKnown = (i: number) => overlay.revealAll || explored[i] === 1;
    const isVisible = (i: number) => overlay.revealAll || vis[i] === 1;
    const visibleIdx: number[] = [];

    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const i = row * state.map.width + col;
        if (!isKnown(i)) continue;
        visibleIdx.push(i);
        const { x, y } = tileCenter(state, i);
        this.drawTile(state.map.tiles[i], i, x, y, detail);
      }
    }

    // rios
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#4aa3df';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    for (const i of visibleIdx) {
      const t = state.map.tiles[i];
      if (!t.rivers) continue;
      const { x, y } = tileCenter(state, i);
      for (let d = 0; d < 6; d++) {
        if (!(t.rivers & (1 << d))) continue;
        // desenha cada aresta uma vez (pelo hexágono de menor índice)
        const nb = neighbor(state.map, i, d);
        if (nb >= 0 && nb < i && isKnown(nb)) continue;
        const a = hexCorner(x, y, HEX_SIZE, d);
        const b = hexCorner(x, y, HEX_SIZE, d + 1);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();

    // estradas (centros de cidade contam como estrada)
    this.drawRoads(state, visibleIdx, isKnown);

    // melhorias
    if (detail) this.drawImprovements(state, visibleIdx);

    // recursos e maravilhas
    if (detail) {
      for (const i of visibleIdx) this.drawTileIcons(state.map.tiles[i], tileCenter(state, i), cam.zoom, overlay.revealAll ? undefined : techs);
    }

    // névoa: explorado mas não visível
    ctx.fillStyle = 'rgba(8, 12, 18, 0.5)';
    for (const i of visibleIdx) {
      if (isVisible(i)) continue;
      const { x, y } = tileCenter(state, i);
      hexPath(ctx, x, y, HEX_SIZE + 0.5);
      ctx.fill();
    }

    // área alcançável
    this.drawReachable(state, overlay, isKnown);

    // distritos e maravilhas construídos
    for (const i of visibleIdx) {
      const t = state.map.tiles[i];
      if (t.district) this.drawDistrict(t.district, tileCenter(state, i));
      if (t.builtWonder) this.drawBuiltWonder(t.builtWonder, tileCenter(state, i), cam.zoom);
    }

    // acampamentos bárbaros conhecidos
    for (const c of state.camps) {
      if (!isKnown(c.pos)) continue;
      this.drawCamp(tileCenter(state, c.pos));
    }

    // locais válidos para distrito/maravilha
    this.drawPlacement(state, overlay);

    // alvos de ataque
    this.drawAttackTargets(state, overlay);

    // fronteiras (acima da névoa e do destaque de alcance)
    this.drawBorders(state, visibleIdx);

    // grade sutil em zoom alto
    if (cam.zoom >= 0.9) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      for (const i of visibleIdx) {
        const { x, y } = tileCenter(state, i);
        hexPath(ctx, x, y, HEX_SIZE);
        ctx.stroke();
      }
    }

    // visão da cidade: rendimentos, cidadãos e hexágonos à venda
    if (overlay.cityView) this.drawCityView(state, overlay.cityView);

    // cidades
    for (const c of state.cities) {
      if (!isKnown(c.pos)) continue;
      this.drawCity(state, c.pos, c.name, c.population, c.owner, c.isCapital, overlay.cityInfo?.get(c.id));
      if (c.hp < 200 + (c.buildings.includes('walls') ? 100 : 0)) {
        const { x, y } = tileCenter(state, c.pos);
        this.drawHpBar(x, y + 18, 34, c.hp / (200 + (c.buildings.includes('walls') ? 100 : 0)));
      }
    }

    // unidades (de outros jogadores só se visíveis)
    const byTile = new Map<number, typeof state.units>();
    const animated: typeof state.units = [];
    for (const u of state.units) {
      if (u.owner !== playerId && !isVisible(u.pos)) continue;
      if (overlay.unitPositions?.has(u.id)) {
        animated.push(u);
        continue;
      }
      const arr = byTile.get(u.pos) ?? [];
      arr.push(u);
      byTile.set(u.pos, arr);
    }
    for (const [pos, units] of byTile) {
      const { x, y } = tileCenter(state, pos);
      units.sort((a, b) => (UNITS[a.type].class === 'civilian' ? -1 : 1) - (UNITS[b.type].class === 'civilian' ? -1 : 1));
      units.forEach((u, k) => {
        const off = units.length > 1 ? (k === 0 ? -9 : 9) : 0;
        const ux = x + off;
        const uy = y + (units.length > 1 ? 4 : 2);
        this.drawUnit(state, u.type, u.owner, ux, uy, u.id === overlay.selectedUnitId, u.movesLeft > 0, !!u.fortified);
        if (u.hp < 100) this.drawHpBar(ux, uy + 16, 22, u.hp / 100);
        if (u.owner === playerId && UNITS[u.type].combat && u.promotions.length < PROMOTION_XP.length && u.xp >= PROMOTION_XP[u.promotions.length]) {
          ctx.fillStyle = '#ffd23f';
          ctx.font = '700 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('★', ux - 11, uy - 10);
        }
      });
    }

    for (const u of animated) {
      const p = overlay.unitPositions!.get(u.id)!;
      this.drawUnit(state, u.type, u.owner, p.x, p.y + 2, u.id === overlay.selectedUnitId, u.movesLeft > 0, !!u.fortified);
      if (u.hp < 100) this.drawHpBar(p.x, p.y + 18, 22, u.hp / 100);
    }

    // unidades destruídas sumindo
    for (const g of overlay.ghosts ?? []) {
      if (!state.players[g.owner]) continue;
      ctx.globalAlpha = Math.max(0, g.alpha);
      this.drawUnit(state, g.type, g.owner, g.x, g.y + 2, false, false, false);
      ctx.globalAlpha = 1;
    }

    // anéis e impactos
    for (const b of overlay.bursts ?? []) this.drawBurst(b);

    // projéteis
    for (const pr of overlay.projectiles ?? []) this.drawProjectile(pr);

    // textos flutuantes
    for (const f of overlay.floaters ?? []) this.drawFloater(f);

    // caminho planejado
    this.drawPlannedPath(state, overlay);

    // hexágono selecionado
    this.drawSelectedTile(state, overlay);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ------------------------------------------------------------------ camadas reaproveitadas pela visão 3D

  private drawImprovements(state: GameState, idxs: number[]): void {
    const { ctx } = this;
    for (const i of idxs) {
      const t = state.map.tiles[i];
      if (!t.improvement) continue;
      const c = tileCenter(state, i);
      this.drawImprovement(t.improvement as ImprovementId, c);
      if (t.pillaged) {
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(c.x - 10, c.y);
        ctx.lineTo(c.x + 10, c.y + 18);
        ctx.moveTo(c.x + 10, c.y);
        ctx.lineTo(c.x - 10, c.y + 18);
        ctx.stroke();
      }
    }
  }

  private drawReachable(state: GameState, overlay: Overlay, isKnown: (i: number) => boolean): void {
    if (!overlay.reachable?.size) return;
    const { ctx } = this;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    for (const i of overlay.reachable) {
      if (!isKnown(i)) continue;
      const { x, y } = tileCenter(state, i);
      hexPath(ctx, x, y, HEX_SIZE - 3);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawPlacement(state: GameState, overlay: Overlay): void {
    if (!overlay.placement) return;
    const { ctx } = this;
    for (const [i, label] of overlay.placement.sites) {
      const { x, y } = tileCenter(state, i);
      const chosen = overlay.placement.chosen === i;
      ctx.fillStyle = chosen ? 'rgba(80, 220, 255, 0.35)' : 'rgba(80, 220, 255, 0.15)';
      ctx.strokeStyle = chosen ? '#5ff' : 'rgba(80, 220, 255, 0.9)';
      ctx.lineWidth = chosen ? 4 : 2.5;
      hexPath(ctx, x, y, HEX_SIZE - 3);
      ctx.fill();
      ctx.stroke();
      if (label) {
        ctx.font = '700 12px system-ui, sans-serif';
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(5, 30, 40, 0.9)';
        roundRect(ctx, x - tw / 2, y - 22, tw, 15, 6);
        ctx.fill();
        ctx.fillStyle = '#9ff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y - 14.5);
      }
    }
  }

  private drawAttackTargets(state: GameState, overlay: Overlay): void {
    if (!overlay.attackTargets?.size) return;
    const { ctx } = this;
    for (const i of overlay.attackTargets) {
      const { x, y } = tileCenter(state, i);
      ctx.strokeStyle = i === overlay.pendingAttack ? '#ff3b30' : 'rgba(255, 80, 60, 0.85)';
      ctx.lineWidth = i === overlay.pendingAttack ? 4 : 2.5;
      ctx.fillStyle = 'rgba(255, 60, 40, 0.16)';
      hexPath(ctx, x, y, HEX_SIZE - 3);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawSelectedTile(state: GameState, overlay: Overlay): void {
    if (overlay.selectedTile === undefined || overlay.selectedTile < 0) return;
    const { ctx } = this;
    const { x, y } = tileCenter(state, overlay.selectedTile);
    ctx.strokeStyle = '#ffe680';
    ctx.lineWidth = 3;
    hexPath(ctx, x, y, HEX_SIZE - 2);
    ctx.stroke();
  }

  private drawPlannedPath(state: GameState, overlay: Overlay): void {
    if (!overlay.path?.length || overlay.selectedUnitId === undefined) return;
    const unit = state.units.find((u) => u.id === overlay.selectedUnitId);
    if (unit) this.drawPath(state, unit.pos, overlay.path, overlay.pathTurns ?? 1);
  }

  private drawFloater(f: { x: number; y: number; text: string; color: string; alpha: number; size?: number }): void {
    const { ctx } = this;
    ctx.globalAlpha = Math.max(0, f.alpha);
    ctx.font = `800 ${Math.round(f.size ?? 14)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }

  /**
   * Visão 3D — camada do chão: desenha num canvas de textura, em coordenadas de mundo da
   * região `r` (x, y, largura, altura em unidades de mundo; `scale` pixels por unidade), o
   * que fica "pintado" no terreno: estradas, melhorias, alcance, alvos, fronteiras, visão da
   * cidade, caminho e seleção. Nos mapas com volta, desenha também as cópias vizinhas.
   */
  drawDecal(state: GameState, vis: Uint8Array, overlay: Overlay, r: { x: number; y: number; w: number; h: number; scale: number }): void {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const explored = state.players[state.currentPlayer].explored;
    const isKnown = (i: number) => overlay.revealAll || explored[i] === 1;
    const P = worldPeriod(state);
    const shifts = state.map.wrap ? [-P, 0, P] : [0];
    const rowH = HEX_SIZE * 1.5;
    const colW = HEX_SIZE * SQRT3;
    for (const sh of shifts) {
      const x0 = r.x - sh;
      const x1 = r.x + r.w - sh;
      if (state.map.wrap && (x1 < -colW || x0 > P + colW)) continue;
      ctx.setTransform(r.scale, 0, 0, r.scale, (sh - r.x) * r.scale, -r.y * r.scale);
      const r0 = Math.max(0, Math.floor(r.y / rowH) - 1);
      const r1 = Math.min(state.map.height - 1, Math.ceil((r.y + r.h) / rowH) + 1);
      const c0 = Math.max(0, Math.floor(x0 / colW) - 1);
      const c1 = Math.min(state.map.width - 1, Math.ceil(x1 / colW) + 1);
      const idxs: number[] = [];
      for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
        const i = row * state.map.width + col;
        if (isKnown(i)) idxs.push(i);
      }
      this.drawRoads(state, idxs, isKnown);
      this.drawImprovements(state, idxs);
      this.drawReachable(state, overlay, isKnown);
      this.drawPlacement(state, overlay);
      this.drawAttackTargets(state, overlay);
      this.drawBorders(state, idxs);
      if (overlay.cityView) this.drawCityView(state, overlay.cityView);
      this.drawPlannedPath(state, overlay);
      this.drawSelectedTile(state, overlay);
    }
    void vis;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /**
   * Visão 3D — figuras "em pé" sobre o relevo (ícones, estandartes, unidades, efeitos),
   * desenhadas com a mesma arte do 2D. `place(x, y)` posiciona o contexto para que
   * desenhar em (x, y) de mundo caia no ponto projetado; devolve false fora da tela.
   */
  drawSprites(
    state: GameState,
    vis: Uint8Array,
    overlay: Overlay,
    tiles: number[],
    place: (wx: number, wy: number) => boolean,
    zoom: number,
  ): void {
    const { ctx } = this;
    const playerId = state.currentPlayer;
    const explored = state.players[playerId].explored;
    const techs = state.players[playerId].techs;
    const isKnown = (i: number) => overlay.revealAll || explored[i] === 1;
    const isVisible = (i: number) => overlay.revealAll || vis[i] === 1;
    this.pulse = overlay.pulse;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const shadow = (x: number, y: number, w: number) => {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(x, y, w, w * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
    };

    // ícones de recursos/maravilhas naturais, distritos, maravilhas e acampamentos
    if (zoom >= 0.45) {
      for (const i of tiles) {
        const t = state.map.tiles[i];
        if (!isKnown(i)) continue;
        const c = tileCenter(state, i);
        if (!place(c.x, c.y)) continue;
        if (t.district) this.drawDistrict(t.district, { x: c.x, y: c.y - 10 });
        if (t.builtWonder) this.drawBuiltWonder(t.builtWonder, { x: c.x, y: c.y - 12 }, zoom);
        if (t.wonder || t.resource) this.drawTileIcons(t, { x: c.x, y: c.y - 8 }, zoom, overlay.revealAll ? undefined : techs);
      }
    }
    for (const c of state.camps) {
      if (!isKnown(c.pos)) continue;
      const p = tileCenter(state, c.pos);
      if (place(p.x, p.y)) this.drawCamp({ x: p.x, y: p.y - 8 });
    }

    // estandartes das cidades (as casas são 3D)
    for (const c of state.cities) {
      if (!isKnown(c.pos)) continue;
      const p = tileCenter(state, c.pos);
      if (!place(p.x, p.y)) continue;
      this.drawCity(state, c.pos, c.name, c.population, c.owner, c.isCapital, overlay.cityInfo?.get(c.id), false);
      const max = 200 + (c.buildings.includes('walls') ? 100 : 0);
      if (c.hp < max) this.drawHpBar(p.x, p.y - HEX_SIZE - 10, 34, c.hp / max);
    }

    // unidades em pé (mais distantes primeiro)
    const byTile = new Map<number, typeof state.units>();
    const animated: typeof state.units = [];
    for (const u of state.units) {
      if (u.owner !== playerId && !isVisible(u.pos)) continue;
      if (overlay.unitPositions?.has(u.id)) animated.push(u);
      else byTile.set(u.pos, [...(byTile.get(u.pos) ?? []), u]);
    }
    const lift = 13;
    const stacks = [...byTile].sort((a, b) => a[0] - b[0]);
    for (const [pos, units] of stacks) {
      const { x, y } = tileCenter(state, pos);
      units.sort((a, b) => (UNITS[a.type].class === 'civilian' ? -1 : 1) - (UNITS[b.type].class === 'civilian' ? -1 : 1));
      units.forEach((u, k) => {
        const ux = x + (units.length > 1 ? (k === 0 ? -10 : 10) : 0);
        if (!place(ux, y)) return;
        shadow(ux, y + 2, 10);
        const uy = y - lift;
        this.drawUnit(state, u.type, u.owner, ux, uy, u.id === overlay.selectedUnitId, u.movesLeft > 0, !!u.fortified);
        if (u.hp < 100) this.drawHpBar(ux, uy + 16, 22, u.hp / 100);
        if (u.owner === playerId && UNITS[u.type].combat && u.promotions.length < PROMOTION_XP.length && u.xp >= PROMOTION_XP[u.promotions.length]) {
          ctx.fillStyle = '#ffd23f';
          ctx.font = '700 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('★', ux - 11, uy - 10);
        }
      });
    }
    for (const u of animated) {
      const p = overlay.unitPositions!.get(u.id)!;
      if (!place(p.x, p.y)) continue;
      shadow(p.x, p.y + 2, 10);
      this.drawUnit(state, u.type, u.owner, p.x, p.y - lift, u.id === overlay.selectedUnitId, u.movesLeft > 0, !!u.fortified);
      if (u.hp < 100) this.drawHpBar(p.x, p.y - lift + 16, 22, u.hp / 100);
    }
    for (const g of overlay.ghosts ?? []) {
      if (!state.players[g.owner] || !place(g.x, g.y)) continue;
      ctx.globalAlpha = Math.max(0, g.alpha);
      this.drawUnit(state, g.type, g.owner, g.x, g.y - lift, false, false, false);
      ctx.globalAlpha = 1;
    }
    for (const b of overlay.bursts ?? []) if (place(b.x, b.y)) this.drawBurst({ ...b, y: b.y - 8 });
    for (const pr of overlay.projectiles ?? []) {
      if (place(pr.x, pr.y)) this.drawProjectile({ ...pr, y: pr.y - lift, tail: { x: pr.tail.x, y: pr.tail.y - lift } });
    }
    for (const f of overlay.floaters ?? []) if (place(f.x, f.y)) this.drawFloater({ ...f, y: f.y - lift - 8 });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawTile(t: Tile, i: number, x: number, y: number, detail: boolean): void {
    const { ctx } = this;
    const def = TERRAINS[t.terrain];
    const v = (tileRand(i, 1) - 0.5) * 0.06;
    ctx.fillStyle = shade(def.color, v + (t.hills ? -0.03 : 0));
    hexPath(ctx, x, y, HEX_SIZE + 0.6);
    ctx.fill();

    if (t.terrain === 'mountain') {
      this.drawMountains(x, y, i);
      return;
    }
    if (!detail && !t.feature && !t.hills) return;

    if (t.hills) {
      ctx.strokeStyle = 'rgba(60, 40, 20, 0.45)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(x - 9, y + 14, 10, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 6, y + 10, 12, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }

    if (t.feature === 'forest') this.drawTrees(x, y, i, t.terrain === 'tundra' ? '#2e5a3c' : '#2f6b2a', false);
    else if (t.feature === 'jungle') this.drawTrees(x, y, i, '#1d5a24', true);
    else if (t.feature === 'marsh') {
      ctx.strokeStyle = 'rgba(40, 90, 130, 0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const yy = y - 8 + k * 9;
        ctx.moveTo(x - 14 + k * 2, yy);
        ctx.lineTo(x + 10 - k * 2, yy);
      }
      ctx.stroke();
      ctx.strokeStyle = '#3d6b2a';
      ctx.beginPath();
      ctx.moveTo(x + 12, y + 8);
      ctx.lineTo(x + 10, y - 6);
      ctx.moveTo(x + 15, y + 8);
      ctx.lineTo(x + 16, y - 3);
      ctx.stroke();
    } else if (t.terrain === 'desert' && detail) {
      ctx.strokeStyle = 'rgba(160, 120, 60, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x - 4, y + 10, 10, Math.PI * 1.2, Math.PI * 1.8);
      ctx.stroke();
    } else if ((t.terrain === 'ocean' || t.terrain === 'coast') && detail) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1.5;
      const dx = (tileRand(i, 2) - 0.5) * 16;
      ctx.beginPath();
      ctx.moveTo(x - 8 + dx, y);
      ctx.quadraticCurveTo(x - 4 + dx, y - 4, x + dx, y);
      ctx.quadraticCurveTo(x + 4 + dx, y + 4, x + 8 + dx, y);
      ctx.stroke();
    }
  }

  private drawMountains(x: number, y: number, i: number): void {
    const { ctx } = this;
    const peaks = [
      { dx: -10, h: 22, w: 13 },
      { dx: 8, h: 26, w: 15 },
    ];
    if (tileRand(i, 3) > 0.5) peaks.push({ dx: -1, h: 16, w: 10 });
    for (const p of peaks) {
      const bx = x + p.dx;
      const by = y + 14;
      ctx.fillStyle = '#5a524b';
      ctx.beginPath();
      ctx.moveTo(bx - p.w, by);
      ctx.lineTo(bx, by - p.h);
      ctx.lineTo(bx + p.w, by);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f2f4f5';
      ctx.beginPath();
      ctx.moveTo(bx - p.w * 0.3, by - p.h * 0.7);
      ctx.lineTo(bx, by - p.h);
      ctx.lineTo(bx + p.w * 0.3, by - p.h * 0.7);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawTrees(x: number, y: number, i: number, color: string, round: boolean): void {
    const { ctx } = this;
    const spots = [
      [-11, -4],
      [3, -10],
      [12, 2],
      [-3, 7],
      [-14, 10],
    ];
    for (let k = 0; k < spots.length; k++) {
      if (tileRand(i, 10 + k) < 0.2) continue;
      const tx = x + spots[k][0];
      const ty = y + spots[k][1];
      ctx.fillStyle = '#4a3320';
      ctx.fillRect(tx - 1, ty + 4, 2, 4);
      ctx.fillStyle = color;
      ctx.beginPath();
      if (round) {
        ctx.arc(tx, ty + 1, 6, 0, Math.PI * 2);
      } else {
        ctx.moveTo(tx - 6, ty + 5);
        ctx.lineTo(tx, ty - 8);
        ctx.lineTo(tx + 6, ty + 5);
        ctx.closePath();
      }
      ctx.fill();
    }
  }

  private drawTileIcons(t: Tile, c: { x: number; y: number }, zoom: number, techs?: readonly string[]): void {
    const { ctx } = this;
    if (t.wonder) {
      const w = WONDER_BY_ID[t.wonder];
      ctx.fillStyle = 'rgba(255, 210, 80, 0.95)';
      ctx.strokeStyle = '#6b4b00';
      ctx.lineWidth = 1.5;
      star(ctx, c.x, c.y - 4, 11, 5);
      ctx.fill();
      ctx.stroke();
      if (zoom >= 0.8 && w) {
        ctx.font = '600 8px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = w.name;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(30, 20, 0, 0.75)';
        ctx.fillRect(c.x - tw / 2 - 3, c.y + 10, tw + 6, 11);
        ctx.fillStyle = '#ffe9a8';
        ctx.fillText(label, c.x, c.y + 15.5);
      }
      return;
    }
    const res = visibleResource(t, techs);
    if (res) {
      const r = RESOURCE_BY_ID[res];
      if (!r) return;
      const bx = c.x + 12;
      const by = c.y - 12;
      ctx.fillStyle =
        r.kind === 'luxury' ? 'rgba(170, 80, 200, 0.92)' : r.kind === 'strategic' ? 'rgba(200, 70, 50, 0.92)' : 'rgba(250, 250, 240, 0.9)';
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '10px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#222';
      ctx.fillText(r.icon, bx, by + 0.5);
    }
  }

  private drawBorders(state: GameState, idxs: number[]): void {
    const { ctx } = this;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const i of idxs) {
      const t = state.map.tiles[i];
      if (t.owner === undefined) continue;
      const civ = CIV_BY_ID[state.players[t.owner]?.civId];
      ctx.strokeStyle = civ?.color ?? '#fff';
      const { x, y } = tileCenter(state, i);
      ctx.beginPath();
      for (let d = 0; d < 6; d++) {
        const nb = neighbor(state.map, i, d);
        if (nb >= 0 && state.map.tiles[nb].owner === t.owner) continue;
        const a = hexCorner(x, y, HEX_SIZE - 2.5, d);
        const b = hexCorner(x, y, HEX_SIZE - 2.5, d + 1);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
  }

  private drawDistrict(id: string, c: { x: number; y: number }): void {
    const { ctx } = this;
    const def = DISTRICTS[id as DistrictId];
    if (!def) return;
    ctx.fillStyle = 'rgba(20, 24, 30, 0.85)';
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 3;
    hexPath(ctx, c.x, c.y, HEX_SIZE * 0.62);
    ctx.fill();
    ctx.stroke();
    ctx.font = '16px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = def.color;
    ctx.fillText(def.icon, c.x, c.y + 1);
  }

  private drawBuiltWonder(id: string, c: { x: number; y: number }, zoom: number): void {
    const { ctx } = this;
    // monumento dourado estilizado
    ctx.fillStyle = '#e0b44a';
    ctx.strokeStyle = '#6b4b00';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c.x - 14, c.y + 12);
    ctx.lineTo(c.x - 9, c.y - 4);
    ctx.lineTo(c.x, c.y - 16);
    ctx.lineTo(c.x + 9, c.y - 4);
    ctx.lineTo(c.x + 14, c.y + 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff3c4';
    ctx.fillRect(c.x - 3, c.y - 2, 6, 14);
    const w = WORLD_WONDER_BY_ID[id];
    if (w && zoom >= 0.8) {
      ctx.font = '600 8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(w.name).width;
      ctx.fillStyle = 'rgba(30, 20, 0, 0.8)';
      ctx.fillRect(c.x - tw / 2 - 3, c.y + 14, tw + 6, 11);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(w.name, c.x, c.y + 19.5);
    }
  }

  private drawHpBar(x: number, y: number, w: number, frac: number): void {
    const { ctx } = this;
    const f = Math.max(0, Math.min(1, frac));
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
    ctx.fillStyle = f > 0.6 ? '#4cd964' : f > 0.3 ? '#ffcc00' : '#ff3b30';
    ctx.fillRect(x - w / 2, y, w * f, 3);
  }

  private drawCamp(c: { x: number; y: number }): void {
    const { ctx } = this;
    ctx.fillStyle = '#6b4a2b';
    ctx.strokeStyle = '#2b1a0c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c.x - 14, c.y + 12);
    ctx.lineTo(c.x - 2, c.y - 8);
    ctx.lineTo(c.x + 10, c.y + 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#2b1a0c';
    ctx.beginPath();
    ctx.moveTo(c.x + 12, c.y + 12);
    ctx.lineTo(c.x + 12, c.y - 14);
    ctx.stroke();
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.moveTo(c.x + 12, c.y - 14);
    ctx.lineTo(c.x + 22, c.y - 10);
    ctx.lineTo(c.x + 12, c.y - 6);
    ctx.closePath();
    ctx.fill();
  }

  private drawRoads(state: GameState, idxs: number[], isKnown: (i: number) => boolean): void {
    const { ctx } = this;
    const cityAt = new Set(state.cities.map((c) => c.pos));
    const road = (i: number) => !!state.map.tiles[i].road || cityAt.has(i);
    ctx.strokeStyle = 'rgba(120, 82, 45, 0.9)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const i of idxs) {
      if (!road(i)) continue;
      const a = tileCenter(state, i);
      let linked = false;
      for (let d = 0; d < 6; d++) {
        const n = neighbor(state.map, i, d);
        if (n < 0 || !road(n) || !isKnown(n)) continue;
        linked = true;
        if (n < i && idxs.includes(n)) continue;
        const b = nearCenter(state, n, a);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      if (!linked && !cityAt.has(i)) {
        ctx.moveTo(a.x - 8, a.y + 6);
        ctx.lineTo(a.x + 8, a.y - 6);
      }
    }
    ctx.stroke();
  }

  private drawImprovement(id: ImprovementId, c: { x: number; y: number }): void {
    const { ctx } = this;
    const x = c.x;
    const y = c.y;
    ctx.lineWidth = 1.6;
    switch (id) {
      case 'farm': {
        ctx.fillStyle = 'rgba(214, 190, 90, 0.85)';
        ctx.strokeStyle = 'rgba(120, 95, 30, 0.9)';
        ctx.beginPath();
        ctx.rect(x - 14, y + 2, 28, 14);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        for (let k = 1; k < 4; k++) {
          ctx.moveTo(x - 14 + k * 7, y + 2);
          ctx.lineTo(x - 14 + k * 7, y + 16);
        }
        ctx.stroke();
        break;
      }
      case 'mine':
      case 'quarry': {
        ctx.fillStyle = id === 'mine' ? '#3b3b3b' : '#b9b3a6';
        ctx.beginPath();
        ctx.arc(x - 8, y + 10, 6, Math.PI, 0);
        ctx.fill();
        ctx.strokeStyle = '#5b3a1a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 2, y + 16);
        ctx.lineTo(x + 12, y + 2);
        ctx.moveTo(x + 6, y + 1);
        ctx.quadraticCurveTo(x + 13, y - 1, x + 17, y + 6);
        ctx.stroke();
        break;
      }
      case 'pasture': {
        ctx.strokeStyle = '#7a5530';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          ctx.moveTo(x - 14 + k * 9, y + 4);
          ctx.lineTo(x - 14 + k * 9, y + 16);
        }
        ctx.moveTo(x - 15, y + 8);
        ctx.lineTo(x + 14, y + 8);
        ctx.moveTo(x - 15, y + 13);
        ctx.lineTo(x + 14, y + 13);
        ctx.stroke();
        break;
      }
      case 'plantation': {
        ctx.fillStyle = '#2f7d32';
        for (let k = 0; k < 3; k++) {
          for (let j = 0; j < 2; j++) {
            ctx.beginPath();
            ctx.arc(x - 10 + k * 10, y + 5 + j * 8, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
      case 'fishing-boats': {
        ctx.fillStyle = '#8b5a2b';
        ctx.beginPath();
        ctx.moveTo(x - 12, y + 8);
        ctx.lineTo(x + 12, y + 8);
        ctx.lineTo(x + 7, y + 14);
        ctx.lineTo(x - 7, y + 14);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f5f0e1';
        ctx.beginPath();
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x, y + 7);
        ctx.lineTo(x + 9, y + 7);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'camp': {
        ctx.fillStyle = '#c9a26b';
        ctx.strokeStyle = '#5b3a1a';
        ctx.beginPath();
        ctx.moveTo(x - 10, y + 16);
        ctx.lineTo(x - 2, y + 2);
        ctx.lineTo(x + 6, y + 16);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
    }
  }

  private drawCityView(state: GameState, v: NonNullable<Overlay['cityView']>): void {
    const { ctx } = this;
    for (const i of v.workable) {
      const { x, y } = tileCenter(state, i);
      if (v.worked.has(i)) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        hexPath(ctx, x, y, HEX_SIZE - 2);
        ctx.fill();
      }
      this.drawYieldPips(tileYields(state.map.tiles[i], state.players[state.currentPlayer].techs), x, y);
      if (v.worked.has(i)) {
        ctx.fillStyle = v.locked.has(i) ? '#ffd23f' : '#ffffff';
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y - 16, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    for (const [i, cost] of v.buyable) {
      const { x, y } = tileCenter(state, i);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      hexPath(ctx, x, y, HEX_SIZE - 2);
      ctx.fill();
      this.drawYieldPips(tileYields(state.map.tiles[i], state.players[state.currentPlayer].techs), x, y);
      ctx.fillStyle = 'rgba(40, 30, 5, 0.9)';
      roundRect(ctx, x - 15, y - 22, 30, 13, 5);
      ctx.fill();
      ctx.fillStyle = '#ffd76a';
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${cost}🪙`, x, y - 15);
    }
  }

  private drawYieldPips(y: { food: number; production: number; gold: number; science: number; culture: number; faith: number }, x: number, cy: number): void {
    const { ctx } = this;
    const items: [number, string][] = [
      [y.food, '#7cc94a'],
      [y.production, '#d9822b'],
      [y.gold, '#f2c230'],
      [y.science + y.culture + y.faith, '#7fb7ff'],
    ];
    const shown = items.filter(([n]) => n > 0);
    const w = shown.length * 13;
    let px = x - w / 2 + 6.5;
    ctx.font = '700 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [n, color] of shown) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, cy + 4, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.fillText(String(n), px, cy + 4.5);
      px += 13;
    }
  }

  private drawCity(
    state: GameState,
    pos: number,
    name: string,
    pop: number,
    owner: number,
    capital: boolean,
    info?: { growTurns: number; prodName?: string; prodTurns?: number; prodFrac: number },
    houses = true,
  ): void {
    const { x, y } = tileCenter(state, pos);
    const civ = CIV_BY_ID[state.players[owner]?.civId];
    // casinhas
    if (houses) this.drawHouses(x, y);
    // estandarte com nome
    this.drawBanner(x, y, name, pop, capital, civ, info);
  }

  private drawHouses(x: number, y: number): void {
    const { ctx } = this;
    ctx.fillStyle = '#d9c7a3';
    ctx.strokeStyle = '#4a3a22';
    ctx.lineWidth = 1.2;
    const houses = [
      [-10, 2],
      [2, -4],
      [10, 5],
      [-2, 9],
    ];
    for (const [dx, dy] of houses) {
      ctx.beginPath();
      ctx.rect(x + dx - 5, y + dy - 3, 10, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#9a3d2a';
      ctx.beginPath();
      ctx.moveTo(x + dx - 6, y + dy - 3);
      ctx.lineTo(x + dx, y + dy - 9);
      ctx.lineTo(x + dx + 6, y + dy - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#d9c7a3';
    }
  }

  private drawBanner(
    x: number,
    y: number,
    name: string,
    pop: number,
    capital: boolean,
    civ: { color: string } | undefined,
    info?: { growTurns: number; prodName?: string; prodTurns?: number; prodFrac: number },
  ): void {
    const { ctx } = this;
    ctx.font = '700 11px system-ui, sans-serif';
    const label = `${capital ? '★ ' : ''}${name}`;
    const tw = ctx.measureText(label).width;
    const bw = tw + 26;
    const bx = x - bw / 2;
    const by = y - HEX_SIZE - 4;
    ctx.fillStyle = civ?.color ?? '#555';
    roundRect(ctx, bx, by, bw, 16, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(pop), bx + 5, by + 8.5);
    ctx.fillText(label, bx + 18, by + 8.5);
    if (info) {
      // barra de produção
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx + 2, by + 16, bw - 4, 4);
      ctx.fillStyle = info.prodName ? '#f0a442' : '#e74c3c';
      ctx.fillRect(bx + 2, by + 16, (bw - 4) * (info.prodName ? Math.min(1, info.prodFrac) : 1), 4);
      ctx.font = '600 8px system-ui, sans-serif';
      const sub = info.prodName ? `${info.prodName} (${info.prodTurns})` : 'Escolher produção';
      const sw = ctx.measureText(sub).width + 8;
      ctx.fillStyle = 'rgba(15, 18, 24, 0.85)';
      roundRect(ctx, x - sw / 2, by + 21, sw, 11, 4);
      ctx.fill();
      ctx.fillStyle = info.prodName ? '#f6d9a8' : '#ff9a8a';
      ctx.textAlign = 'center';
      ctx.fillText(sub, x, by + 26.5);
    }
  }

  private drawBurst(b: { x: number; y: number; color: string; kind: 'ring' | 'impact'; t: number }): void {
    const { ctx } = this;
    const t = Math.min(1, Math.max(0, b.t));
    ctx.save();
    if (b.kind === 'ring') {
      // dois anéis que se expandem
      for (const k of [0, 0.25]) {
        const tt = Math.max(0, (t - k) / (1 - k));
        if (tt <= 0) continue;
        ctx.globalAlpha = (1 - tt) * 0.9;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 3 * (1 - tt) + 1;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 8 + tt * HEX_SIZE * 1.3, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      // clarão e faíscas
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 6 + t * 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let k = 0; k < 8; k++) {
        const a = (Math.PI * 2 * k) / 8 + 0.4;
        const r0 = 6 + t * 12;
        const r1 = r0 + 6 * (1 - t) + 2;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(a) * r0, b.y + Math.sin(a) * r0);
        ctx.lineTo(b.x + Math.cos(a) * r1, b.y + Math.sin(a) * r1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawProjectile(p: { x: number; y: number; angle: number; heavy: boolean; tail: { x: number; y: number } }): void {
    const { ctx } = this;
    ctx.save();
    // rastro
    const grad = ctx.createLinearGradient(p.tail.x, p.tail.y, p.x, p.y);
    grad.addColorStop(0, 'rgba(255, 240, 200, 0)');
    grad.addColorStop(1, 'rgba(255, 240, 200, 0.7)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = p.heavy ? 4 : 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.tail.x, p.tail.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (p.heavy) {
      ctx.fillStyle = '#6b6259';
      ctx.strokeStyle = '#2b2620';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // flecha
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.strokeStyle = '#3b2a14';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(2, 0);
      ctx.stroke();
      ctx.fillStyle = '#d9d9d9';
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(0, -2.6);
      ctx.lineTo(0, 2.6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#f2e6c9';
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(-11, -2.5);
      ctx.moveTo(-9, 0);
      ctx.lineTo(-11, 2.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawUnit(state: GameState, type: string, owner: number, x: number, y: number, selected: boolean, hasMoves: boolean, fortified: boolean): void {
    const { ctx } = this;
    const civ = CIV_BY_ID[state.players[owner]?.civId];
    const def = UNITS[type];
    const r = 11;
    if (selected) {
      const ph = this.pulse === undefined ? 0 : Math.sin(this.pulse * Math.PI * 2);
      ctx.fillStyle = `rgba(255, 230, 128, ${0.4 + 0.12 * ph})`;
      ctx.beginPath();
      ctx.arc(x, y, r + 5 + 1.5 * ph, 0, Math.PI * 2);
      ctx.fill();
      if (this.pulse !== undefined) {
        // onda que se afasta
        ctx.strokeStyle = `rgba(255, 230, 128, ${0.7 * (1 - this.pulse)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 5 + this.pulse * 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = civ?.color ?? '#888';
    ctx.strokeStyle = civ?.secondaryColor ?? '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (def.class === 'military') {
      // escudo
      ctx.moveTo(x - r, y - r + 2);
      ctx.lineTo(x + r, y - r + 2);
      ctx.lineTo(x + r, y + 1);
      ctx.quadraticCurveTo(x + r, y + r, x, y + r + 3);
      ctx.quadraticCurveTo(x - r, y + r, x - r, y + 1);
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = civ?.secondaryColor ?? '#fff';
    ctx.font = '700 13px system-ui, "Segoe UI Symbol", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.glyph, x, y + 1);
    // indicador de movimento
    ctx.fillStyle = hasMoves ? '#7CFC8A' : '#777';
    ctx.beginPath();
    ctx.arc(x + r - 1, y - r + 2, 3.2, 0, Math.PI * 2);
    ctx.fill();
    if (fortified) {
      ctx.strokeStyle = '#cfd8dc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
  }

  private drawPath(state: GameState, from: number, path: number[], turns: number): void {
    const { ctx } = this;
    const pts: { x: number; y: number }[] = [];
    for (const i of [from, ...path]) pts.push(pts.length ? nearCenter(state, i, pts[pts.length - 1]) : tileCenter(state, i));
    ctx.strokeStyle = 'rgba(255, 240, 160, 0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    const end = pts[pts.length - 1];
    ctx.fillStyle = 'rgba(30, 30, 30, 0.85)';
    ctx.beginPath();
    ctx.arc(end.x, end.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe680';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(turns), end.x, end.y + 0.5);
  }

  /** Ponto do mundo sob o ponto de tela (toque). */
  pick(cam: Camera, sx: number, sy: number): { x: number; y: number } {
    return screenToWorld(cam, this.vw, this.vh, sx, sy);
  }

  /** Unidades de mundo por pixel arrastado. */
  panScale(cam: Camera): { x: number; y: number } {
    return { x: 1 / cam.zoom, y: 1 / cam.zoom };
  }

  /** Centro de um hexágono em coordenadas de tela (para posicionar UI). */
  tileToScreen(state: GameState, cam: Camera, idx: number) {
    const c = tileCenter(state, idx);
    return worldToScreen(cam, this.vw, this.vh, c.x, c.y);
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, n: number) {
  ctx.beginPath();
  for (let k = 0; k < n * 2; k++) {
    const rr = k % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI * k) / n - Math.PI / 2;
    const px = x + rr * Math.cos(a);
    const py = y + rr * Math.sin(a);
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
