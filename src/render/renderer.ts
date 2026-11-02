import { CIV_BY_ID } from '../data/civs';
import type { ImprovementId } from '../data/improvements';
import { RESOURCE_BY_ID } from '../data/resources';
import { TERRAINS } from '../data/terrains';
import { UNITS } from '../data/units';
import { WONDER_BY_ID } from '../data/wonders';
import type { GameState, Tile } from '../state/types';
import { tileYields, visibleResource } from '../rules/tiles';
import { colRow, hexCorner, hexToPixel, neighbor, pixelToOffset, SQRT3 } from '../rules/hex';
import { type Camera, screenToWorld, worldToScreen } from './camera';

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
  /** Informação de cidades para os estandartes (crescimento/produção). */
  cityInfo?: Map<number, { growTurns: number; prodName?: string; prodTurns?: number; prodFrac: number }>;
}

export function worldSize(state: GameState) {
  return {
    w: HEX_SIZE * SQRT3 * (state.map.width + 0.5),
    h: HEX_SIZE * 1.5 * (state.map.height - 1) + HEX_SIZE * 2,
  };
}

export function tileCenter(state: GameState, idx: number) {
  const { col, row } = colRow(state.map, idx);
  const p = hexToPixel(col, row, HEX_SIZE);
  return { x: p.x + (HEX_SIZE * SQRT3) / 2, y: p.y + HEX_SIZE };
}

export function tileAtWorld(state: GameState, wx: number, wy: number): number {
  const { col, row } = pixelToOffset(wx - (HEX_SIZE * SQRT3) / 2, wy - HEX_SIZE, HEX_SIZE);
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

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
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

  draw(state: GameState, cam: Camera, vis: Uint8Array, overlay: Overlay): void {
    const { ctx } = this;
    const playerId = state.currentPlayer;
    const explored = state.players[playerId].explored;
    const techs = state.players[playerId].techs;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, this.vw, this.vh);

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
    if (detail) {
      for (const i of visibleIdx) {
        const t = state.map.tiles[i];
        if (t.improvement) this.drawImprovement(t.improvement as ImprovementId, tileCenter(state, i));
      }
    }


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
    if (overlay.reachable?.size) {
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
    }

    // unidades (de outros jogadores só se visíveis)
    const byTile = new Map<number, typeof state.units>();
    for (const u of state.units) {
      if (u.owner !== playerId && !isVisible(u.pos)) continue;
      const arr = byTile.get(u.pos) ?? [];
      arr.push(u);
      byTile.set(u.pos, arr);
    }
    for (const [pos, units] of byTile) {
      const { x, y } = tileCenter(state, pos);
      units.sort((a, b) => (UNITS[a.type].class === 'civilian' ? -1 : 1) - (UNITS[b.type].class === 'civilian' ? -1 : 1));
      units.forEach((u, k) => {
        const off = units.length > 1 ? (k === 0 ? -9 : 9) : 0;
        this.drawUnit(state, u.type, u.owner, x + off, y + (units.length > 1 ? 4 : 2), u.id === overlay.selectedUnitId, u.movesLeft > 0, !!u.fortified);
      });
    }

    // caminho planejado
    if (overlay.path?.length && overlay.selectedUnitId !== undefined) {
      const unit = state.units.find((u) => u.id === overlay.selectedUnitId);
      if (unit) this.drawPath(state, unit.pos, overlay.path, overlay.pathTurns ?? 1);
    }

    // hexágono selecionado
    if (overlay.selectedTile !== undefined && overlay.selectedTile >= 0) {
      const { x, y } = tileCenter(state, overlay.selectedTile);
      ctx.strokeStyle = '#ffe680';
      ctx.lineWidth = 3;
      hexPath(ctx, x, y, HEX_SIZE - 2);
      ctx.stroke();
    }

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
        const b = tileCenter(state, n);
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
  ): void {
    const { ctx } = this;
    const { x, y } = tileCenter(state, pos);
    const civ = CIV_BY_ID[state.players[owner]?.civId];
    // casinhas
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
    // estandarte com nome
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

  private drawUnit(state: GameState, type: string, owner: number, x: number, y: number, selected: boolean, hasMoves: boolean, fortified: boolean): void {
    const { ctx } = this;
    const civ = CIV_BY_ID[state.players[owner]?.civId];
    const def = UNITS[type];
    const r = 11;
    if (selected) {
      ctx.fillStyle = 'rgba(255, 230, 128, 0.45)';
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, Math.PI * 2);
      ctx.fill();
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
    const pts = [from, ...path].map((i) => tileCenter(state, i));
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
