import { TERRAINS } from '../data/terrains';
import { HEX_SIZE, tileAtWorld, tileCenter, worldPeriod, worldSize } from '../render/renderer';
import { hexCorner, neighbor } from '../rules/hex';
import { createNoise2D } from '../rules/noise';
import { hashSeed } from '../rules/rng';
import type { GameState } from '../state/types';

/**
 * Relevo contínuo da visão 3D, derivado dos hexágonos (só leitura do estado).
 * Unidades de mundo = as do mapa 2D (HEX_SIZE = 32); a altura usa a mesma escala.
 * Cada ponto mistura os hexágonos vizinhos com pesos suaves (litorais e encostas sem
 * degraus) e soma colinas, cordilheiras (picos que se juntam entre montanhas vizinhas),
 * ruído de detalhe e o leito escavado dos rios.
 */

export const WATER_LEVEL = -1.6;
const S = HEX_SIZE;

/** Altura-base por terreno. */
function baseHeight(terrain: string): number {
  if (terrain === 'ocean') return -10;
  if (terrain === 'coast') return -4.5;
  if (terrain === 'mountain') return 3;
  return 1.2;
}

/** sRGB (#rrggbb) → RGB linear (o que o WebGL espera nos atributos de cor). */
export function linear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const ROCK = linear('#6f665e');
const SNOW = linear('#f1f4f6');
const SAND = linear('#c9b98b');
const DEEP = linear('#1d3a55');

/** Hash determinístico por hexágono (variação visual estável). */
export function rnd(i: number, k: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export class TerrainField {
  readonly W: number;
  readonly H: number;
  readonly wrap: boolean;
  readonly P: number;
  readonly worldW: number;
  readonly worldH: number;
  private base: Float32Array;
  private mtn: Float32Array;
  private hill: Uint8Array;
  private col: Float32Array;
  private cx: Float32Array;
  private cy: Float32Array;
  private nb: Int32Array;
  /** Segmentos de rio por hexágono: [ax, ay, bx, by] relativos ao centro. */
  private rivers: Map<number, number[]>;
  private fbm: (x: number, y: number, o?: number) => number;

  constructor(private state: GameState) {
    const { map } = state;
    this.W = map.width;
    this.H = map.height;
    this.wrap = !!map.wrap;
    this.P = worldPeriod(state);
    const ws = worldSize(state);
    this.worldW = ws.w;
    this.worldH = ws.h;
    const N = map.tiles.length;
    this.base = new Float32Array(N);
    this.mtn = new Float32Array(N);
    this.hill = new Uint8Array(N);
    this.col = new Float32Array(N * 3);
    this.cx = new Float32Array(N);
    this.cy = new Float32Array(N);
    this.nb = new Int32Array(N * 6);
    this.rivers = new Map();
    const noise = createNoise2D(hashSeed(`${state.settings.seed}|3d`));
    this.fbm = (x, y, o = 3) => noise.fbm(x, y, o);
    for (let i = 0; i < N; i++) {
      const t = map.tiles[i];
      const c = tileCenter(state, i);
      this.cx[i] = c.x;
      this.cy[i] = c.y;
      for (let d = 0; d < 6; d++) this.nb[i * 6 + d] = neighbor(map, i, d);
      this.base[i] = baseHeight(t.terrain);
      this.mtn[i] = t.terrain === 'mountain' ? 0.85 + 0.3 * rnd(i, 7) : 0;
      this.hill[i] = t.hills ? 1 : 0;
      let rgb = linear(TERRAINS[t.terrain].color);
      if (t.terrain === 'coast') rgb = SAND;
      else if (t.terrain === 'ocean') rgb = DEEP;
      else if (t.terrain === 'mountain') rgb = mix(ROCK, linear('#8a8172'), rnd(i, 3));
      if (t.feature === 'forest') rgb = mix(rgb, linear(t.terrain === 'tundra' ? '#3e5a44' : '#3d6a2a'), 0.45);
      else if (t.feature === 'jungle') rgb = mix(rgb, linear('#2c5a26'), 0.55);
      else if (t.feature === 'marsh') rgb = mix(rgb, linear('#4f7466'), 0.55);
      const v = 0.94 + 0.12 * rnd(i, 1) - (t.hills ? 0.05 : 0);
      this.col[i * 3] = rgb[0] * v;
      this.col[i * 3 + 1] = rgb[1] * v;
      this.col[i * 3 + 2] = rgb[2] * v;
      if (t.rivers) {
        const segs: number[] = [];
        for (let d = 0; d < 6; d++) {
          if (!(t.rivers & (1 << d))) continue;
          const a = hexCorner(0, 0, S, d);
          const b = hexCorner(0, 0, S, d + 1);
          segs.push(a.x, a.y, b.x, b.y);
        }
        this.rivers.set(i, segs);
      }
    }
  }

  /** Ruído periódico na volta leste-oeste (sem costura). */
  private n(x: number, y: number, scale: number, o = 3): number {
    if (!this.wrap) return this.fbm(x / scale, y / scale, o);
    const P = this.P;
    const xm = ((x % P) + P) % P;
    const a = this.fbm(xm / scale, y / scale, o);
    const b = this.fbm((xm - P) / scale, y / scale, o);
    return a + (b - a) * (xm / P);
  }

  private tileAt(x: number, y: number): number {
    return tileAtWorld(this.state, x, y);
  }

  /** Centro do hexágono `i` na cópia mais próxima de x. */
  private nearX(i: number, x: number): number {
    let cx = this.cx[i];
    if (this.wrap) {
      const P = this.P;
      while (cx - x > P / 2) cx -= P;
      while (x - cx > P / 2) cx += P;
    }
    return cx;
  }

  /** Altura e cor (RGB linear) no ponto (x, y) do mapa. `out` = [h, r, g, b, rio]. */
  sample(x: number, y: number, out: Float32Array): Float32Array {
    const t0 = this.tileAt(x, y);
    if (t0 < 0) {
      out[0] = -10;
      out[1] = DEEP[0];
      out[2] = DEEP[1];
      out[3] = DEEP[2];
      out[4] = 0;
      return out;
    }
    let sw = 0;
    let sh = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let mtn = 0;
    let hill = 0;
    let carve = 0;
    for (let k = -1; k < 6; k++) {
      const c = k < 0 ? t0 : this.nb[t0 * 6 + k];
      if (c < 0) continue;
      const dx = x - this.nearX(c, x);
      const dy = y - this.cy[c];
      const d = Math.sqrt(dx * dx + dy * dy);
      const f = Math.max(0, 1 - d / (1.2 * S));
      const w = f * f;
      sw += w;
      sh += w * this.base[c];
      sr += w * this.col[c * 3];
      sg += w * this.col[c * 3 + 1];
      sb += w * this.col[c * 3 + 2];
      if (this.mtn[c]) mtn += this.mtn[c] * Math.pow(Math.max(0, 1 - d / (1.08 * S)), 1.25);
      if (this.hill[c]) hill += Math.pow(Math.max(0, 1 - d / (1.15 * S)), 1.6);
      const segs = this.rivers.get(c);
      if (segs) {
        for (let s = 0; s < segs.length; s += 4) {
          const ax = segs[s] - dx;
          const ay = segs[s + 1] - dy;
          const bx = segs[s + 2] - dx;
          const by = segs[s + 3] - dy;
          // distância do ponto (origem) ao segmento a-b
          const ex = bx - ax;
          const ey = by - ay;
          const tt = Math.max(0, Math.min(1, -(ax * ex + ay * ey) / (ex * ex + ey * ey)));
          const px = ax + ex * tt;
          const py = ay + ey * tt;
          const ds = Math.sqrt(px * px + py * py);
          const cv = Math.max(0, 1 - ds / 9);
          if (cv > carve) carve = cv;
        }
      }
    }
    let h = sh / sw;
    let r = sr / sw;
    let g = sg / sw;
    let b = sb / sw;
    const n1 = this.n(x, y, 70, 3);
    const n2 = this.n(x + 913, y - 377, 23, 2);
    const land = Math.max(0, Math.min(1, (h + 2) / 3));
    h += land * (n1 - 0.5) * 2.6;
    if (hill > 0) h += hill * (8 + 5 * n2);
    if (mtn > 0) {
      const ridged = 1 - Math.abs(2 * this.n(x - 271, y + 133, 11, 3) - 1);
      h += mtn * (24 + 30 * ridged * ridged);
      const rock = Math.min(1, mtn * 2.2);
      [r, g, b] = mix([r, g, b], ROCK, rock);
      const snow = Math.max(0, Math.min(1, (h - 27) / 9));
      [r, g, b] = mix([r, g, b], SNOW, snow);
    }
    if (carve > 0 && land > 0.3) {
      const c2 = carve * carve;
      h -= 3.4 * c2;
      r *= 1 - 0.18 * carve;
      g *= 1 - 0.1 * carve;
      b *= 1 - 0.18 * carve;
    }
    const n3 = this.n(x - 57, y + 211, 7, 2);
    const v = 0.86 + 0.16 * n2 + 0.12 * n3;
    out[0] = h;
    out[1] = r * v;
    out[2] = g * v;
    out[3] = b * v;
    out[4] = carve;
    return out;
  }

  private tmp = new Float32Array(5);

  height(x: number, y: number): number {
    return this.sample(x, y, this.tmp)[0];
  }

  /** Assinatura do que muda o relevo (terreno, colinas, características, rios). */
  static signature(state: GameState): number {
    let h = 2166136261;
    const T = state.map.tiles;
    for (let i = 0; i < T.length; i++) {
      const t = T[i];
      const k = (t.terrain.charCodeAt(0) * 31 + t.terrain.length) ^ (t.hills ? 512 : 0) ^ ((t.feature?.charCodeAt(0) ?? 0) << 10) ^ (t.rivers << 18);
      h = Math.imul(h ^ k, 16777619);
    }
    return (h >>> 0) ^ (state.map.width << 1) ^ (state.map.height << 12);
  }
}
