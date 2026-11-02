import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CIV_BY_ID } from '../data/civs';
import { HEX_SIZE, tileCenter } from '../render/renderer';
import { hexCorner, neighbor } from '../rules/hex';
import type { GameState } from '../state/types';
import { Kit } from './models';
import type { Pack, PackModel } from './pack';
import { linear, rnd, TerrainField, WATER_LEVEL } from './terrain';
import { playerEra } from '../rules/victory';

/** Construção das malhas da visão 3D (terreno em blocos, água, rios, árvores e cidades). */

const S = HEX_SIZE;
const CHUNK = 48;

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Grade de amostragem do relevo (passo ajustado ao tamanho do mapa). */
export function gridFor(field: TerrainField, minStep: number, budget: number) {
  const step = Math.max(minStep, Math.sqrt((field.worldW * field.worldH) / budget));
  const nx = Math.max(2, Math.round(field.worldW / step) + 1);
  const nz = Math.max(2, Math.round(field.worldH / step) + 1);
  return { nx, nz, sx: field.worldW / (nx - 1), sz: field.worldH / (nz - 1) };
}

export function buildTerrain(field: TerrainField, mat: THREE.Material, budget = 200000): THREE.Group {
  const { nx, nz, sx, sz } = gridFor(field, 5, budget);
  const H = new Float32Array(nx * nz);
  const C = new Float32Array(nx * nz * 3);
  const out = new Float32Array(5);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      field.sample(i * sx, j * sz, out);
      const k = j * nx + i;
      H[k] = out[0];
      C[k * 3] = out[1];
      C[k * 3 + 1] = out[2];
      C[k * 3 + 2] = out[3];
    }
  }
  // normais por diferenças finitas na grade inteira (sem costura entre blocos)
  const N = new Float32Array(nx * nz * 3);
  const at = (i: number, j: number) => {
    if (field.wrap) i = i < 0 ? nx - 2 : i > nx - 1 ? 1 : i;
    else i = Math.max(0, Math.min(nx - 1, i));
    j = Math.max(0, Math.min(nz - 1, j));
    return H[j * nx + i];
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * sx);
      const dz = (at(i, j + 1) - at(i, j - 1)) / (2 * sz);
      const l = Math.hypot(dx, 1, dz);
      const k = (j * nx + i) * 3;
      N[k] = -dx / l;
      N[k + 1] = 1 / l;
      N[k + 2] = -dz / l;
      // encostas íngremes ficam mais escuras (rocha)
      const shade = 0.72 + 0.28 * smooth(0.55, 0.92, 1 / l);
      C[k] *= shade;
      C[k + 1] *= shade;
      C[k + 2] *= shade;
    }
  }
  const group = new THREE.Group();
  for (let j0 = 0; j0 < nz - 1; j0 += CHUNK) {
    for (let i0 = 0; i0 < nx - 1; i0 += CHUNK) {
      const cw = Math.min(CHUNK, nx - 1 - i0);
      const ch = Math.min(CHUNK, nz - 1 - j0);
      const vw = cw + 1;
      const pos = new Float32Array(vw * (ch + 1) * 3);
      const nor = new Float32Array(pos.length);
      const col = new Float32Array(pos.length);
      for (let j = 0; j <= ch; j++) {
        for (let i = 0; i <= cw; i++) {
          const g = (j0 + j) * nx + (i0 + i);
          const v = (j * vw + i) * 3;
          pos[v] = (i0 + i) * sx;
          pos[v + 1] = H[g];
          pos[v + 2] = (j0 + j) * sz;
          nor.set(N.subarray(g * 3, g * 3 + 3), v);
          col.set(C.subarray(g * 3, g * 3 + 3), v);
        }
      }
      const idx = new Uint16Array(cw * ch * 6);
      let p = 0;
      for (let j = 0; j < ch; j++) {
        for (let i = 0; i < cw; i++) {
          const a = j * vw + i;
          const b = a + 1;
          const c = a + vw;
          const d = c + 1;
          idx[p++] = a;
          idx[p++] = c;
          idx[p++] = b;
          idx[p++] = b;
          idx[p++] = c;
          idx[p++] = d;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      group.add(new THREE.Mesh(geo, mat));
    }
  }
  return group;
}

export function buildWater(field: TerrainField, mat: THREE.Material): THREE.Group {
  const { nx, nz, sx, sz } = gridFor(field, 9, 60000);
  const D = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) D[j * nx + i] = WATER_LEVEL - field.height(i * sx, j * sz);
  const shallow = linear('#58b1cf');
  const deep = linear('#174a7c');
  const group = new THREE.Group();
  const C2 = 32;
  for (let j0 = 0; j0 < nz - 1; j0 += C2) {
    for (let i0 = 0; i0 < nx - 1; i0 += C2) {
      const cw = Math.min(C2, nx - 1 - i0);
      const ch = Math.min(C2, nz - 1 - j0);
      let wet = false;
      for (let j = 0; j <= ch && !wet; j++) for (let i = 0; i <= cw; i++) if (D[(j0 + j) * nx + i0 + i] > -1.5) wet = true;
      if (!wet) continue;
      const vw = cw + 1;
      const pos = new Float32Array(vw * (ch + 1) * 3);
      const col = new Float32Array(vw * (ch + 1) * 4);
      for (let j = 0; j <= ch; j++) {
        for (let i = 0; i <= cw; i++) {
          const d = D[(j0 + j) * nx + i0 + i];
          const v = j * vw + i;
          pos[v * 3] = (i0 + i) * sx;
          pos[v * 3 + 1] = WATER_LEVEL;
          pos[v * 3 + 2] = (j0 + j) * sz;
          const t = smooth(0, 8, d);
          col[v * 4] = shallow[0] + (deep[0] - shallow[0]) * t;
          col[v * 4 + 1] = shallow[1] + (deep[1] - shallow[1]) * t;
          col[v * 4 + 2] = shallow[2] + (deep[2] - shallow[2]) * t;
          col[v * 4 + 3] = 0.72 + 0.2 * smooth(0, 6, d);
        }
      }
      const idx = new Uint16Array(cw * ch * 6);
      let p = 0;
      for (let j = 0; j < ch; j++) {
        for (let i = 0; i < cw; i++) {
          const a = j * vw + i;
          idx.set([a, a + vw, a + 1, a + 1, a + vw, a + vw + 1], p);
          p += 6;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      group.add(new THREE.Mesh(geo, mat));
    }
  }
  return group;
}

export function buildRivers(field: TerrainField, state: GameState, mat: THREE.Material): THREE.Mesh | null {
  const pos: number[] = [];
  const col: number[] = [];
  const blue = linear('#3f8fc6');
  const SEG = 6;
  const W = 6.5;
  state.map.tiles.forEach((t, i) => {
    if (!t.rivers) return;
    const c = tileCenter(state, i);
    for (let d = 0; d < 6; d++) {
      if (!(t.rivers & (1 << d))) continue;
      const n = neighbor(state.map, i, d);
      if (n >= 0 && n < i) continue;
      const a = hexCorner(c.x, c.y, S, d);
      const b = hexCorner(c.x, c.y, S, d + 1);
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const l = Math.hypot(ex, ey);
      const px = (-ey / l) * (W / 2);
      const py = (ex / l) * (W / 2);
      let prev: number[] | null = null;
      for (let k = 0; k <= SEG; k++) {
        // estende um pouco nas pontas para emendar com o próximo trecho
        const tt = -0.06 + (k / SEG) * 1.12;
        const x = a.x + ex * tt;
        const z = a.y + ey * tt;
        const y = Math.max(field.height(x, z) + 1.1, WATER_LEVEL + 0.15);
        const cur = [x + px, y, z + py, x - px, y, z - py];
        if (prev) {
          pos.push(...prev.slice(0, 3), ...cur.slice(0, 3), ...prev.slice(3, 6));
          pos.push(...prev.slice(3, 6), ...cur.slice(0, 3), ...cur.slice(3, 6));
          for (let v = 0; v < 6; v++) col.push(...blue);
        }
        prev = cur;
      }
    }
  });
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  // a fita é vista de cima: normais para cima evitam lados escuros
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  for (let v = 0; v < nor.count; v++) nor.setXYZ(v, 0, 1, 0);
  geo.computeBoundingSphere();
  return new THREE.Mesh(geo, mat);
}

// ------------------------------------------------------------------ árvores

function colored(geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = linear(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) arr.set(c, v * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

function conifer(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.7, 1, 4, 5).translate(0, 2, 0), '#5a3d22'),
    colored(new THREE.ConeGeometry(4.6, 10, 7).translate(0, 8.5, 0), '#2f6b34'),
    colored(new THREE.ConeGeometry(3.4, 7.5, 7).translate(0, 13, 0), '#3a7d3c'),
  ])!;
}

function broadleaf(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.8, 1.1, 6, 5).translate(0, 3, 0), '#5a3d22'),
    colored(new THREE.IcosahedronGeometry(5.4, 0).scale(1, 0.8, 1).translate(0, 9.5, 0), '#2d6a25'),
    colored(new THREE.IcosahedronGeometry(3.6, 0).translate(2.8, 11.5, 1.5), '#3b7f2c'),
  ])!;
}

export function buildTrees(field: TerrainField, state: GameState, mat: THREE.Material): THREE.Group {
  const cities = new Set(state.cities.map((c) => c.pos));
  const spots: { x: number; y: number; z: number; s: number; r: number; kind: 0 | 1; tint: number }[] = [];
  state.map.tiles.forEach((t, i) => {
    if ((t.feature !== 'forest' && t.feature !== 'jungle') || cities.has(i) || t.district || t.builtWonder) return;
    const c = tileCenter(state, i);
    const n = t.feature === 'forest' ? 12 : 10;
    for (let k = 0; k < n; k++) {
      const ang = rnd(i, 100 + k) * Math.PI * 2;
      const rad = S * 0.82 * Math.sqrt(rnd(i, 200 + k));
      const x = c.x + Math.cos(ang) * rad;
      const z = c.y + Math.sin(ang) * rad;
      const y = field.height(x, z) - 0.6;
      if (y < WATER_LEVEL) continue;
      spots.push({
        x,
        y,
        z,
        s: 0.75 + 0.5 * rnd(i, 300 + k),
        r: rnd(i, 400 + k) * Math.PI * 2,
        kind: t.feature === 'forest' ? 0 : 1,
        tint: t.terrain === 'tundra' || t.terrain === 'snow' ? 0.7 : 0.85 + 0.3 * rnd(i, 500 + k),
      });
    }
  });
  const group = new THREE.Group();
  const geos = [conifer(), broadleaf()];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  for (const kind of [0, 1] as const) {
    const list = spots.filter((p) => p.kind === kind);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geos[kind], mat, list.length);
    list.forEach((p, k) => {
      q.setFromAxisAngle(up, p.r);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s * (0.9 + 0.2 * p.tint), p.s));
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, col.setRGB(p.tint, p.tint * 1.02, p.tint * 0.95));
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

// ------------------------------------------------------------------ cidades

function gable(): THREE.BufferGeometry {
  // prisma de telhado: base 1×1 em y=0, cumeeira ao longo de x em y=1
  const v = [
    // vertentes
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
    // empenas
    0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export function citySignature(state: GameState): string {
  return state.cities
    .map((c) => `${c.id}:${c.pos}:${c.population}:${c.owner}:${c.isCapital ? 1 : 0}:${c.buildings.includes('walls') ? 1 : 0}:${playerEra(state, c.owner).index >= 2 ? 1 : 0}`)
    .join('|');
}

interface Piece {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rot: number;
  color: [number, number, number];
}

export function buildCities(field: TerrainField, state: GameState, mat: THREE.Material): THREE.Group {
  const bodies: Piece[] = [];
  const roofs: Piece[] = [];
  const domes: Piece[] = [];
  const towers: Piece[] = [];
  const WALLS = ['#d8c8a6', '#cbb893', '#e4d7b8', '#bfae8c'].map(linear);
  const TERRACOTTA = linear('#a2472f');
  const STONE = linear('#a39d92');
  const GOLD = linear('#d9a63a');
  for (const city of state.cities) {
    const c = tileCenter(state, city.pos);
    const civ = CIV_BY_ID[state.players[city.owner]?.civId];
    const civC = linear(civ?.color ?? '#888888');
    const g0 = field.height(c.x, c.y);
    const R = (k: number) => rnd(city.id * 7919, k);
    // edifício central: palácio (capital) ou paço
    if (city.isCapital) {
      bodies.push({ x: c.x, y: g0, z: c.y, sx: 12, sy: 7, sz: 10, rot: 0, color: linear('#efe4c8') });
      domes.push({ x: c.x, y: g0 + 7, z: c.y, sx: 4.6, sy: 5, sz: 4.6, rot: 0, color: GOLD });
      roofs.push({ x: c.x - 4.5, y: g0 + 7, z: c.y, sx: 3, sy: 2.5, sz: 10, rot: 0, color: civC });
      roofs.push({ x: c.x + 4.5, y: g0 + 7, z: c.y, sx: 3, sy: 2.5, sz: 10, rot: 0, color: civC });
    } else {
      bodies.push({ x: c.x, y: g0, z: c.y, sx: 8, sy: 6, sz: 7, rot: 0, color: linear('#e8dcc0') });
      roofs.push({ x: c.x, y: g0 + 6, z: c.y, sx: 8.6, sy: 3.5, sz: 7.6, rot: 0, color: civC });
    }
    // casas: mais numerosas e altas conforme a população
    const pop = city.population;
    const count = Math.min(10 + pop * 4, 56);
    const radius = Math.min(S * 0.98, 15 + pop * 2.2);
    const placed: { x: number; z: number }[] = [{ x: c.x, z: c.y }];
    for (let k = 0; k < count * 5 && placed.length <= count; k++) {
      const ang = R(k * 3) * Math.PI * 2;
      const rad = 8 + (radius - 8) * Math.sqrt(R(k * 3 + 1));
      const x = c.x + Math.cos(ang) * rad;
      const z = c.y + Math.sin(ang) * rad;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 5.8)) continue;
      const gy = field.height(x, z);
      if (gy < WATER_LEVEL + 0.4) continue;
      placed.push({ x, z });
      const w = 3.8 + 2.4 * R(k * 3 + 2);
      const d = 3.8 + 2.4 * R(k * 5 + 7);
      const tall = pop >= 6 && R(k * 11) < 0.3 ? 2.6 : 1;
      const h = (3 + 1.8 * R(k * 7 + 3)) * tall;
      const rot = Math.round(R(k * 13) * 6) * (Math.PI / 12);
      const wall = WALLS[Math.floor(R(k * 17) * WALLS.length)];
      const roofC: [number, number, number] =
        R(k * 19) < 0.3 ? [civC[0] * 0.9, civC[1] * 0.9, civC[2] * 0.9] : [TERRACOTTA[0] * (0.85 + 0.3 * R(k)), TERRACOTTA[1], TERRACOTTA[2]];
      bodies.push({ x, y: gy - 0.3, z, sx: w, sy: h, sz: d, rot, color: wall });
      roofs.push({ x, y: gy - 0.3 + h, z, sx: w * 1.12, sy: 2 + 0.6 * w * 0.2, sz: d * 1.12, rot, color: roofC });
    }
    // muralhas: segmentos nas arestas do hexágono e torres nos cantos
    if (city.buildings.includes('walls')) {
      const rr = S * 0.95;
      for (let d = 0; d < 6; d++) {
        const a = hexCorner(c.x, c.y, rr, d);
        const b = hexCorner(c.x, c.y, rr, d + 1);
        const mx = (a.x + b.x) / 2;
        const mz = (a.y + b.y) / 2;
        const rot = -Math.atan2(b.y - a.y, b.x - a.x);
        bodies.push({ x: mx, y: field.height(mx, mz) - 1, z: mz, sx: rr, sy: 5.5, sz: 1.8, rot, color: STONE });
        towers.push({ x: a.x, y: field.height(a.x, a.y) - 1, z: a.y, sx: 2.4, sy: 8.5, sz: 2.4, rot: 0, color: STONE });
      }
    }
  }
  const group = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, list: Piece[]) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    list.forEach((p, k) => {
      q.setFromAxisAngle(up, p.rot);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx, p.sy, p.sz));
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, col.setRGB(p.color[0], p.color[1], p.color[2], THREE.LinearSRGBColorSpace));
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  add(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), bodies);
  add(gable(), roofs);
  add(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), domes);
  add(new THREE.CylinderGeometry(1, 1.1, 1, 8).translate(0, 0.5, 0), towers);
  return group;
}

// ------------------------------------------------------------------ com modelos importados (Quaternius)

/** Material da cor da equipe por dono (preparado para a névoa). */
export type TeamMatFor = (owner: number) => THREE.Material;

/** Junta as geometrias por dono: uma malha neutra e uma malha de equipe por civilização. */
export function meshesFromKits(kits: Map<number, Kit>, neutralMat: THREE.Material, teamMat: TeamMatFor): THREE.Group {
  const g = new THREE.Group();
  const neutral: THREE.BufferGeometry[] = [];
  for (const [owner, k] of kits) {
    const m = k.build();
    if (m.neutral) neutral.push(m.neutral);
    if (m.team) {
      m.team.computeBoundingSphere();
      g.add(new THREE.Mesh(m.team, teamMat(owner)));
    }
  }
  if (neutral.length) {
    const merged = mergeGeometries(neutral);
    if (merged) {
      merged.computeBoundingSphere();
      g.add(new THREE.Mesh(merged, neutralMat));
    }
  }
  return g;
}

export function buildTreesPack(field: TerrainField, state: GameState, mat: THREE.Material, pack: Pack): THREE.Group | null {
  const kinds = [pack.get('pine'), pack.get('tree1'), pack.get('tree2')];
  if (kinds.some((k) => !k?.neutral)) return null;
  const cities = new Set(state.cities.map((c) => c.pos));
  const spots: { x: number; y: number; z: number; s: number; r: number; kind: number; tint: number }[] = [];
  state.map.tiles.forEach((t, i) => {
    if ((t.feature !== 'forest' && t.feature !== 'jungle') || cities.has(i) || t.district || t.builtWonder) return;
    const c = tileCenter(state, i);
    const n = t.feature === 'forest' ? 13 : 11;
    for (let k = 0; k < n; k++) {
      const ang = rnd(i, 100 + k) * Math.PI * 2;
      const rad = S * 0.84 * Math.sqrt(rnd(i, 200 + k));
      const x = c.x + Math.cos(ang) * rad;
      const z = c.y + Math.sin(ang) * rad;
      const y = field.height(x, z) - 0.4;
      if (y < WATER_LEVEL) continue;
      spots.push({
        x,
        y,
        z,
        s: 0.75 + 0.5 * rnd(i, 300 + k),
        r: rnd(i, 400 + k) * Math.PI * 2,
        kind: t.feature === 'forest' ? 0 : 1 + (rnd(i, 600 + k) < 0.5 ? 0 : 1),
        tint: t.terrain === 'tundra' || t.terrain === 'snow' ? 0.75 : 0.88 + 0.24 * rnd(i, 500 + k),
      });
    }
  });
  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  kinds.forEach((model, kind) => {
    const list = spots.filter((p) => p.kind === kind);
    if (!list.length || !model?.neutral) return;
    const height = kind === 0 ? 17 : 15;
    const base = height / (model.max[1] - model.min[1]);
    const mesh = new THREE.InstancedMesh(model.neutral, mat, list.length);
    list.forEach((p, k) => {
      q.setFromAxisAngle(up, p.r);
      const s = base * p.s;
      m.compose(new THREE.Vector3(p.x, p.y - model.min[1] * s, p.z), q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, col.setRGB(p.tint, p.tint, p.tint));
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  return group;
}

export function buildCitiesPack(field: TerrainField, state: GameState, vcMat: THREE.Material, teamMat: TeamMatFor, pack: Pack): THREE.Group | null {
  if (!pack.get('townCenter2')) return null;
  const kits = new Map<number, Kit>();
  for (const city of state.cities) {
    const k = kits.get(city.owner) ?? new Kit();
    kits.set(city.owner, k);
    const c = tileCenter(state, city.pos);
    const R = (n: number) => rnd(city.id * 7919, n);
    const late = playerEra(state, city.owner).index >= 2;
    const pop = city.population;
    const centerName = late ? (pop >= 8 ? 'townCenter5' : 'townCenter4') : pop >= 5 ? 'townCenter3' : 'townCenter2';
    const center = pack.get(centerName);
    const place = (m: PackModel | undefined, x: number, z: number, size: number, ry: number) => {
      if (!m) return;
      const s = size / Math.max(m.max[0] - m.min[0], m.max[2] - m.min[2]);
      const cx = (m.min[0] + m.max[0]) / 2;
      const cz = (m.min[2] + m.max[2]) / 2;
      k.push(x, field.height(x, z) - 0.4, z, ry, s);
      k.model(m, -cx, -m.min[1], -cz);
      k.pop();
    };
    place(center, c.x, c.y, late ? 34 : 30, Math.round(R(1) * 6) * (Math.PI / 3));
    if (city.isCapital) {
      place(pack.get('banner'), c.x + 13, c.y - 9, 7, 0.3);
      place(pack.get('watchTower'), c.x - 15, c.y - 8, 7, 0);
    }
    // casas em volta, mais numerosas com a população
    const houses = late ? ['houseC', 'houseD', 'houseC'] : ['houseA', 'houseB', 'houseA'];
    const count = Math.min(3 + pop * 2, 22);
    const placed: { x: number; z: number }[] = [];
    for (let n = 0; n < count * 6 && placed.length < count; n++) {
      const ang = R(n * 3 + 2) * Math.PI * 2;
      const rad = 18 + (Math.min(S * 1.05, 20 + pop * 2.4) - 18) * Math.sqrt(R(n * 3 + 3));
      const x = c.x + Math.cos(ang) * rad;
      const z = c.y + Math.sin(ang) * rad;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 9)) continue;
      if (field.height(x, z) < WATER_LEVEL + 0.5) continue;
      placed.push({ x, z });
      place(pack.get(houses[Math.floor(R(n * 7) * houses.length)]), x, z, 9 + 3 * R(n * 11), -ang + Math.PI / 2);
    }
    if (city.buildings.includes('walls')) {
      const wall = pack.get(late ? 'wallTowers2' : 'wallTowers1');
      if (wall) {
        const rr = S * 0.98;
        for (let d = 0; d < 6; d++) {
          const a = hexCorner(c.x, c.y, rr, d);
          const b = hexCorner(c.x, c.y, rr, d + 1);
          const mx = (a.x + b.x) / 2;
          const mz = (a.y + b.y) / 2;
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const s = (len * 1.04) / (wall.max[0] - wall.min[0]);
          k.push(mx, field.height(mx, mz) - 0.6, mz, -Math.atan2(b.y - a.y, b.x - a.x), s);
          k.model(wall, -(wall.min[0] + wall.max[0]) / 2, -wall.min[1], -(wall.min[2] + wall.max[2]) / 2);
          k.pop();
        }
      }
    }
  }
  return meshesFromKits(kits, vcMat, teamMat);
}
