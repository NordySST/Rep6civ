/**
 * Geometria hexagonal: hexágonos "pointy-top" em coordenadas offset "odd-r"
 * (linhas ímpares deslocadas meia célula para a direita).
 *
 * Direções / arestas (sentido horário, y para baixo):
 *   0 = Leste, 1 = Sudeste, 2 = Sudoeste, 3 = Oeste, 4 = Noroeste, 5 = Nordeste
 * A aresta i fica entre os cantos i e i+1; o canto i está no ângulo 60·i − 30°.
 * A aresta i de A é a aresta (i+3)%6 do vizinho na direção i.
 */

export const SQRT3 = Math.sqrt(3);

export interface Axial {
  q: number;
  r: number;
}

export const AXIAL_DIRS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

export const DIR_NAMES = ['Leste', 'Sudeste', 'Sudoeste', 'Oeste', 'Noroeste', 'Nordeste'];

export function offsetToAxial(col: number, row: number): Axial {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

export function axialToOffset(q: number, r: number): { col: number; row: number } {
  return { col: q + (r - (r & 1)) / 2 + 0, row: r + 0 };
}

export interface MapDims {
  width: number;
  height: number;
}

export function idxOf(dims: MapDims, col: number, row: number): number {
  return row * dims.width + col;
}

export function colRow(dims: MapDims, idx: number): { col: number; row: number } {
  return { col: idx % dims.width, row: Math.floor(idx / dims.width) };
}

export function inBounds(dims: MapDims, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < dims.width && row < dims.height;
}

/** Vizinho na direção `dir` ou -1 se fora do mapa. */
export function neighbor(dims: MapDims, idx: number, dir: number): number {
  const { col, row } = colRow(dims, idx);
  const a = offsetToAxial(col, row);
  const d = AXIAL_DIRS[((dir % 6) + 6) % 6];
  const o = axialToOffset(a.q + d.q, a.r + d.r);
  return inBounds(dims, o.col, o.row) ? idxOf(dims, o.col, o.row) : -1;
}

/** Os 6 vizinhos (−1 para fora do mapa), na ordem das direções. */
export function neighbors(dims: MapDims, idx: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < 6; d++) out.push(neighbor(dims, idx, d));
  return out;
}

/** Direção de `a` para o vizinho `b`, ou -1 se não forem adjacentes. */
export function directionTo(dims: MapDims, a: number, b: number): number {
  for (let d = 0; d < 6; d++) if (neighbor(dims, a, d) === b) return d;
  return -1;
}

export function distance(dims: MapDims, a: number, b: number): number {
  const pa = colRow(dims, a);
  const pb = colRow(dims, b);
  const A = offsetToAxial(pa.col, pa.row);
  const B = offsetToAxial(pb.col, pb.row);
  const dq = A.q - B.q;
  const dr = A.r - B.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Todos os índices a até `radius` de `center` (inclui o centro). */
export function tilesInRadius(dims: MapDims, center: number, radius: number): number[] {
  const { col, row } = colRow(dims, center);
  const c = offsetToAxial(col, row);
  const out: number[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const r1 = Math.max(-radius, -dq - radius);
    const r2 = Math.min(radius, -dq + radius);
    for (let dr = r1; dr <= r2; dr++) {
      const o = axialToOffset(c.q + dq, c.r + dr);
      if (inBounds(dims, o.col, o.row)) out.push(idxOf(dims, o.col, o.row));
    }
  }
  return out;
}

function cubeRound(q: number, r: number): Axial {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/** Linha de hexágonos entre a e b (inclusive), para linha de visão. */
export function hexLine(dims: MapDims, a: number, b: number): number[] {
  const n = distance(dims, a, b);
  const pa = colRow(dims, a);
  const pb = colRow(dims, b);
  const A = offsetToAxial(pa.col, pa.row);
  const B = offsetToAxial(pb.col, pb.row);
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    // pequeno deslocamento evita empates exatos nas arestas
    const q = A.q + (B.q - A.q) * t + 1e-6;
    const r = A.r + (B.r - A.r) * t + 1e-6;
    const h = cubeRound(q, r);
    const o = axialToOffset(h.q, h.r);
    out.push(idxOf(dims, o.col, o.row));
  }
  return out;
}

// ---------- Pixels (coordenadas de mundo) ----------

export function hexToPixel(col: number, row: number, size: number): { x: number; y: number } {
  return { x: size * SQRT3 * (col + 0.5 * (row & 1)), y: size * 1.5 * row };
}

export function pixelToOffset(x: number, y: number, size: number): { col: number; row: number } {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  const h = cubeRound(q, r);
  return axialToOffset(h.q, h.r);
}

/** Canto i do hexágono centrado em (cx, cy). */
export function hexCorner(cx: number, cy: number, size: number, i: number): { x: number; y: number } {
  const ang = (Math.PI / 180) * (60 * i - 30);
  return { x: cx + size * Math.cos(ang), y: cy + size * Math.sin(ang) };
}
