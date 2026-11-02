import { FEATURES } from '../data/features';
import { MAP_SIZES, type MapSizeId } from '../data/mapSizes';
import { RESOURCES, type ResourceDef } from '../data/resources';
import type { TerrainId } from '../data/terrains';
import { NATURAL_WONDERS, type NaturalWonderDef } from '../data/wonders';
import type { GameMap, Tile } from '../state/types';
import { colRow, distance, neighbor, neighbors, tilesInRadius } from './hex';
import { createNoise2D } from './noise';
import { createRng, hashSeed, type Rng } from './rng';
import { isLand, isPassableLand, isWater, setRiverEdge, tileYields } from './tiles';

/**
 * Gerador procedural de mapas. Totalmente determinístico: a mesma semente e o
 * mesmo tamanho sempre geram o mesmo mapa.
 */

export interface MapGenOptions {
  seed: string;
  size: MapSizeId;
  /** Fração aproximada de terra (0..1). */
  landRatio?: number;
}

export interface GeneratedMap {
  map: GameMap;
  /** Elevação normalizada por hexágono (auxiliar, não é salva). */
  elevation: Float32Array;
}

export function generateMap(opts: MapGenOptions): GeneratedMap {
  const size = MAP_SIZES[opts.size];
  const { width, height } = size;
  const n = width * height;
  const baseSeed = hashSeed(`${opts.seed}|${opts.size}`);
  const rng = createRng(baseSeed);
  const elevNoise = createNoise2D(baseSeed ^ 0x9e3779b9);
  const moistNoise = createNoise2D(baseSeed ^ 0x85ebca6b);
  const tempNoise = createNoise2D(baseSeed ^ 0xc2b2ae35);
  const hillNoise = createNoise2D(baseSeed ^ 0x27d4eb2f);
  const landRatio = opts.landRatio ?? 0.4;

  // posição "física" de cada hexágono (para o ruído não ficar distorcido)
  const px = (i: number) => {
    const { col, row } = colRow({ width, height }, i);
    return { x: col + 0.5 * (row & 1), y: row * 0.866 };
  };

  // --- 1. Elevação: fBm + núcleos continentais + borda oceânica ---
  const centers = Array.from({ length: size.continents }, () => ({
    x: rng.range(width * 0.15, width * 0.85),
    y: rng.range(height * 0.2, height * 0.8) * 0.866,
    r: rng.range(0.18, 0.3) * Math.min(width, height * 1.4),
  }));
  const elevation = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const { x, y } = px(i);
    const f = elevNoise.fbm(x / 9, y / 9, 5);
    let blob = 0;
    for (const c of centers) {
      const d = Math.hypot(x - c.x, y - c.y) / c.r;
      blob = Math.max(blob, 1 - d);
    }
    let e = 0.55 * f + 0.45 * Math.max(0, blob);
    const { col, row } = colRow({ width, height }, i);
    const edge = Math.min(col, width - 1 - col, row, height - 1 - row);
    const margin = 3;
    if (edge < margin) e -= (1 - edge / margin) * 0.6;
    elevation[i] = e;
  }

  // --- 2. Nível do mar por percentil ---
  const sorted = Array.from(elevation).sort((a, b) => a - b);
  const seaLevel = sorted[Math.floor(n * (1 - landRatio))];

  const tiles: Tile[] = new Array(n);
  const landIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    const land = elevation[i] > seaLevel;
    tiles[i] = { terrain: land ? 'grassland' : 'ocean', hills: false, rivers: 0 };
    if (land) landIdx.push(i);
  }
  const map: GameMap = { width, height, tiles };

  // remove ilhotas de 1 hexágono (ficam estranhas) e lagos de 1 hexágono
  for (let i = 0; i < n; i++) {
    const ns = neighbors(map, i).filter((x) => x >= 0);
    const sameKind = ns.filter((x) => isLand(tiles[x]) === isLand(tiles[i])).length;
    if (sameKind === 0 && ns.length === 6) {
      tiles[i].terrain = isLand(tiles[i]) ? 'ocean' : 'grassland';
    }
  }
  landIdx.length = 0;
  for (let i = 0; i < n; i++) if (isLand(tiles[i])) landIdx.push(i);

  // ranks de elevação entre terras (0..1)
  const elevRank = rankOf(landIdx, (i) => elevation[i] + 0.25 * hillNoise.fbm(px(i).x / 4, px(i).y / 4, 3));
  const moistRank = rankOf(landIdx, (i) => moistNoise.fbm(px(i).x / 7, px(i).y / 7, 4));

  // --- 3. Relevo: montanhas e colinas ---
  for (const i of landIdx) {
    const er = elevRank.get(i)!;
    if (er > 0.93) tiles[i].terrain = 'mountain';
    else if (er > 0.72 || (er > 0.45 && rng.chance(0.12))) tiles[i].hills = true;
  }

  // --- 4. Clima: temperatura (latitude) e umidade ---
  const temperature = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const { row } = colRow(map, i);
    const lat = Math.abs(row - (height - 1) / 2) / ((height - 1) / 2);
    const { x, y } = px(i);
    temperature[i] = 1 - lat + (tempNoise.fbm(x / 6, y / 6, 3) - 0.5) * 0.3 - (tiles[i].hills ? 0.04 : 0);
  }
  for (const i of landIdx) {
    const t = tiles[i];
    if (t.terrain === 'mountain') continue;
    const temp = temperature[i];
    const m = moistRank.get(i)!;
    let terrain: TerrainId;
    if (temp < 0.14) terrain = 'snow';
    else if (temp < 0.3) terrain = 'tundra';
    else if (m < 0.17 && temp > 0.45) terrain = 'desert';
    else if (m < 0.5) terrain = 'plains';
    else terrain = 'grassland';
    t.terrain = terrain;
  }

  // --- 5. Água: costa x oceano ---
  for (let i = 0; i < n; i++) {
    if (!isWater(tiles[i])) continue;
    const nearLand = neighbors(map, i).some((x) => x >= 0 && isLand(tiles[x]));
    tiles[i].terrain = nearLand ? 'coast' : 'ocean';
  }

  // --- 6. Características: pântano, selva, floresta ---
  for (const i of landIdx) {
    const t = tiles[i];
    if (t.terrain === 'mountain') continue;
    const m = moistRank.get(i)!;
    const er = elevRank.get(i)!;
    const temp = temperature[i];
    if (!t.hills && t.terrain === 'grassland' && m > 0.8 && er < 0.3 && rng.chance(0.55)) {
      t.feature = 'marsh';
    } else if (temp > 0.68 && m > 0.58 && (t.terrain === 'grassland' || t.terrain === 'plains') && rng.chance(0.7)) {
      // selva tropical fica sobre planície (como floresta úmida)
      t.terrain = 'plains';
      t.feature = 'jungle';
    } else if (m > 0.42 && FEATURES.forest.allowedTerrains.includes(t.terrain) && rng.chance(t.terrain === 'tundra' ? 0.55 : 0.42)) {
      t.feature = 'forest';
    }
  }

  // --- 7. Rios (nas arestas entre hexágonos) ---
  generateRivers(map, elevation, rng, size.rivers);

  // --- 8. Maravilhas naturais ---
  placeWonders(map, temperature, rng, size.wonders);

  // --- 9. Recursos ---
  placeResources(map, rng);

  return { map, elevation };
}

function rankOf(indices: number[], value: (i: number) => number): Map<number, number> {
  const arr = indices.map((i) => ({ i, v: value(i) })).sort((a, b) => a.v - b.v);
  const out = new Map<number, number>();
  const den = Math.max(1, arr.length - 1);
  arr.forEach((e, k) => out.set(e.i, k / den));
  return out;
}

// ---------------- Rios ----------------

/**
 * Um vértice é identificado por (hexágono, canto). O canto c de A é
 * compartilhado por A, viz(A, c−1) e viz(A, c). As três arestas que saem dele:
 *   - aresta c−1 de A  → leva ao canto c−1 de A
 *   - aresta c de A    → leva ao canto c+1 de A
 *   - aresta entre N1=viz(A,c−1) e N2=viz(A,c), que é a aresta c+1 de N1;
 *     no N1 nosso vértice é o canto c+2 e o outro extremo é o canto c+1.
 */
interface Vertex {
  tile: number;
  corner: number;
}

function vertexTiles(map: GameMap, v: Vertex): number[] {
  return [v.tile, neighbor(map, v.tile, v.corner + 5), neighbor(map, v.tile, v.corner)];
}

function vertexKey(map: GameMap, v: Vertex): string {
  return vertexTiles(map, v)
    .slice()
    .sort((a, b) => a - b)
    .join(',');
}

interface RiverStep {
  next: Vertex;
  edgeTile: number;
  edgeDir: number;
}

function vertexSteps(map: GameMap, v: Vertex): RiverStep[] {
  const A = v.tile;
  const c = v.corner;
  const steps: RiverStep[] = [
    { next: { tile: A, corner: (c + 5) % 6 }, edgeTile: A, edgeDir: (c + 5) % 6 },
    { next: { tile: A, corner: (c + 1) % 6 }, edgeTile: A, edgeDir: c },
  ];
  const n1 = neighbor(map, A, c + 5);
  const n2 = neighbor(map, A, c);
  if (n1 >= 0 && n2 >= 0) {
    steps.push({ next: { tile: n1, corner: (c + 1) % 6 }, edgeTile: n1, edgeDir: (c + 1) % 6 });
  }
  return steps;
}

function generateRivers(map: GameMap, elevation: Float32Array, rng: Rng, count: number): void {
  const { tiles } = map;
  const candidates: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if ((t.hills || t.terrain === 'mountain') && t.terrain !== 'snow') candidates.push(i);
  }
  rng.shuffle(candidates);
  const sources: number[] = [];
  for (const c of candidates) {
    if (sources.length >= count) break;
    if (sources.some((s) => distance(map, s, c) < 6)) continue;
    sources.push(c);
  }

  const vElev = (v: Vertex) => {
    const ts = vertexTiles(map, v);
    if (ts.some((t) => t < 0)) return -Infinity;
    return ts.reduce((s, t) => s + elevation[t], 0) / 3;
  };
  const touchesWater = (v: Vertex) => vertexTiles(map, v).some((t) => t < 0 || isWater(tiles[t]));

  for (const src of sources) {
    let v: Vertex = { tile: src, corner: rng.int(6) };
    const visited = new Set<string>([vertexKey(map, v)]);
    const edges: { tile: number; dir: number }[] = [];
    let reachedWater = false;
    for (let step = 0; step < 40; step++) {
      if (touchesWater(v)) {
        reachedWater = true;
        break;
      }
      const opts = vertexSteps(map, v).filter((s) => !visited.has(vertexKey(map, s.next)));
      if (opts.length === 0) break;
      // desce o relevo com um pouco de aleatoriedade
      opts.sort((a, b) => vElev(a.next) + rng.next() * 0.04 - (vElev(b.next) + rng.next() * 0.04));
      const s = opts[0];
      edges.push({ tile: s.edgeTile, dir: s.edgeDir });
      v = s.next;
      visited.add(vertexKey(map, v));
    }
    // só mantém rios que chegam ao mar e têm tamanho razoável
    if (reachedWater && edges.length >= 3) {
      for (const e of edges) setRiverEdge(map, e.tile, e.dir);
    }
  }
}

// ---------------- Maravilhas naturais ----------------

function wonderFits(map: GameMap, i: number, w: NaturalWonderDef, temperature: Float32Array): boolean {
  const t = map.tiles[i];
  if (t.wonder || !w.terrains.includes(t.terrain)) return false;
  if (w.hills !== undefined && w.hills !== t.hills) return false;
  if (w.climate === 'polar' && temperature[i] > 0.3) return false;
  if (w.climate === 'tropical' && temperature[i] < 0.6) return false;
  if (w.needsCoastAdjacent && !neighbors(map, i).some((x) => x >= 0 && isWater(map.tiles[x]))) return false;
  // maravilhas de água precisam estar perto de terra; de terra não na borda do mapa
  const { col, row } = colRow(map, i);
  if (col < 2 || row < 2 || col > map.width - 3 || row > map.height - 3) return false;
  return true;
}

function placeWonders(map: GameMap, temperature: Float32Array, rng: Rng, count: number): void {
  const pool = rng.shuffle([...NATURAL_WONDERS]);
  const placed: number[] = [];
  const all = Array.from({ length: map.tiles.length }, (_, i) => i);
  for (const w of pool) {
    if (placed.length >= count) break;
    const options = rng
      .shuffle(all.slice())
      .filter((i) => wonderFits(map, i, w, temperature) && placed.every((p) => distance(map, p, i) >= 7));
    if (options.length === 0) continue;
    const i = options[0];
    const t = map.tiles[i];
    t.wonder = w.id;
    delete t.feature;
    if (w.id === 'ilwen-grove') t.feature = 'forest';
    placed.push(i);
  }
}

// ---------------- Recursos ----------------

export function resourceFits(t: Tile, r: ResourceDef): boolean {
  if (t.wonder || t.terrain === 'mountain') return false;
  if (!r.terrains.includes(t.terrain)) return false;
  if (r.hills !== undefined && r.hills !== t.hills) return false;
  if (r.features) {
    const f = t.feature ?? 'none';
    if (!r.features.includes(f)) return false;
  }
  return true;
}

function placeResources(map: GameMap, rng: Rng): void {
  const { tiles } = map;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.terrain === 'ocean' && rng.chance(0.6)) continue; // oceano aberto é mais pobre
    // evita aglomerar: nenhum recurso adjacente com chance maior
    const crowded = neighbors(map, i).some((x) => x >= 0 && tiles[x].resource);
    const p = isWater(t) ? 0.1 : 0.16;
    if (!rng.chance(crowded ? p * 0.35 : p)) continue;
    const r = rng.weighted(
      RESOURCES.filter((r) => resourceFits(t, r)),
      (r) => r.weight,
    );
    if (r) t.resource = r.id;
  }
}

// ---------------- Posições iniciais ----------------

/** Pontua um hexágono como local de fundação de cidade. */
export function scoreStart(map: GameMap, i: number): number {
  const t = map.tiles[i];
  if (!isPassableLand(t)) return -Infinity;
  if (t.terrain === 'snow' || t.terrain === 'desert' || t.terrain === 'tundra') return -Infinity;
  if (t.feature === 'marsh') return -Infinity;
  let score = 0;
  for (const j of tilesInRadius(map, i, 2)) {
    if (j === i) continue;
    const y = tileYields(map.tiles[j]);
    const w = distance(map, i, j) === 1 ? 1 : 0.6;
    score += w * (y.food * 1.2 + y.production + y.gold * 0.5 + y.science + y.culture + y.faith);
    if (map.tiles[j].resource) score += w * 0.8;
    if (map.tiles[j].terrain === 'mountain') score -= 0.5;
    if (map.tiles[j].terrain === 'ocean') score -= 0.4;
  }
  if (t.rivers) score += 4;
  if (neighbors(map, i).some((x) => x >= 0 && isWater(map.tiles[x]))) score += 2.5;
  if (t.hills) score += 1.5;
  return score;
}

/** Tamanho da massa de terra transitável que contém `start`. */
export function landmassSize(map: GameMap, start: number, limit = 400): number {
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length && seen.size < limit) {
    const c = queue.shift()!;
    for (const nb of neighbors(map, c)) {
      if (nb >= 0 && !seen.has(nb) && isPassableLand(map.tiles[nb])) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return seen.size;
}

export function findStartPositions(map: GameMap, count: number, seed: string, minDist = 9): number[] {
  const rng = createRng(hashSeed(`${seed}|start`));
  const scored: { i: number; s: number }[] = [];
  for (let i = 0; i < map.tiles.length; i++) {
    const { col, row } = colRow(map, i);
    if (col < 3 || row < 3 || col > map.width - 4 || row > map.height - 4) continue;
    const s = scoreStart(map, i);
    if (s > -Infinity) scored.push({ i, s: s + rng.next() * 2 });
  }
  scored.sort((a, b) => b.s - a.s);
  let out: number[] = [];
  // relaxa a distância mínima até caberem todos
  for (let md = minDist; md >= 4 && out.length < count; md--) {
    out = [];
    for (const c of scored) {
      if (out.length >= count) break;
      if (out.some((o) => distance(map, o, c.i) < md)) continue;
      if (landmassSize(map, c.i, 30) < 30) continue;
      out.push(c.i);
    }
  }
  // fallback: qualquer terra transitável
  if (out.length < count) {
    for (let i = 0; i < map.tiles.length && out.length < count; i++) {
      if (isPassableLand(map.tiles[i]) && !out.includes(i)) out.push(i);
    }
  }
  return out;
}
