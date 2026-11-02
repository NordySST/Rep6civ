import * as THREE from 'three';
import { DISTRICTS, type DistrictId } from '../data/districts';
import { HEX_SIZE, tileCenter } from '../render/renderer';
import type { GameState } from '../state/types';
import { Kit } from './models';
import { rnd, TerrainField, WATER_LEVEL } from './terrain';

/**
 * Construções estáticas da visão 3D: melhorias (exceto fazenda, que fica pintada no chão),
 * distritos, maravilhas mundiais e acampamentos bárbaros. Tudo numa única malha com cores
 * por vértice; refeita quando a assinatura muda.
 */

const S = HEX_SIZE;
const STONE = '#c9c1b0';
const WOOD = '#7a5532';
const GOLD = '#e0b44a';

export function structureSignature(state: GameState): string {
  const parts: string[] = [];
  state.map.tiles.forEach((t, i) => {
    if (t.improvement || t.district || t.builtWonder) parts.push(`${i}:${t.improvement ?? ''}:${t.pillaged ? 1 : 0}:${t.district ?? ''}:${t.builtWonder ?? ''}`);
  });
  for (const c of state.camps) parts.push(`c${c.pos}`);
  return parts.join('|');
}

function flag(k: Kit, x: number, z: number, color: string, h = 12): void {
  k.cyl(0.25, 0.25, h, WOOD, x, 0, z, 4);
  k.box(3.6, 2.2, 0.25, color, x + 1.9, h - 2.6, z);
}

function mine(k: Kit, i: number): void {
  k.ball(5.5, '#8d8478', -2, 2, -1, 0);
  k.ball(3.6, '#7a7266', 3, 1.5, -3, 0);
  k.box(2.6, 3, 1, '#1d1a17', -1, 0, 3.6);
  k.box(3.6, 0.6, 1.2, WOOD, -1, 3, 3.6);
  k.box(2.2, 1.4, 1.6, '#555', 4, 0.4, 3, rnd(i, 3));
}

function quarry(k: Kit, i: number): void {
  for (let n = 0; n < 5; n++) k.box(2.6, 1.8, 2.2, n % 2 ? '#d6d0c4' : '#bdb6a8', -4 + n * 2, (n % 3) * 0.2, -1 + rnd(i, n) * 3, rnd(i, n + 9));
  k.box(3, 1.8, 2.4, '#d6d0c4', -1, 1.8, 0, 0.3);
}

function pasture(k: Kit, i: number): void {
  const r = 9;
  for (let s = 0; s < 4; s++) {
    const a = (s * Math.PI) / 2;
    k.box(r * 2, 1.2, 0.35, WOOD, Math.cos(a) * r, 0.8, Math.sin(a) * r, a + Math.PI / 2);
  }
  for (let n = 0; n < 3; n++) {
    const x = -4 + n * 4;
    const z = -2 + rnd(i, n) * 4;
    const coat = rnd(i, n + 5) < 0.5 ? '#f2efe6' : '#8a6a4a';
    k.box(3, 1.8, 1.8, coat, x, 1, z, rnd(i, n + 9) * 3);
    k.box(1, 1, 1, '#3a3128', x + 1.8, 2.2, z, rnd(i, n + 9) * 3);
  }
}

function plantation(k: Kit, i: number): void {
  for (let row = 0; row < 3; row++)
    for (let n = 0; n < 4; n++) {
      const x = -7 + n * 4.6;
      const z = -5 + row * 5;
      k.ball(1.9, rnd(i, row * 4 + n) < 0.5 ? '#3f7d2c' : '#4f8a34', x, 1.9, z, 0);
      k.ball(0.55, '#e05a6a', x + 0.8, 3, z + 1);
    }
}

function camp(k: Kit): void {
  k.cone(3.6, 6, '#a07a4f', -3, 0, -1, 6);
  k.box(5, 0.4, 0.4, WOOD, 4, 4, 0);
  k.cyl(0.25, 0.25, 4.4, WOOD, 1.8, 0, 0, 4);
  k.cyl(0.25, 0.25, 4.4, WOOD, 6.2, 0, 0, 4);
  k.box(1.6, 2.4, 0.2, '#9a6a3a', 4, 1.6, 0);
}

function fishingBoat(k: Kit): void {
  k.box(3, 1.4, 7, WOOD, 0, -0.6, 0);
  k.cyl(0.18, 0.2, 6, WOOD, 0, 0.6, 0, 4);
  k.box(0.2, 3.6, 3.2, '#efe6cf', 0, 2.4, 0.4);
}

function district(k: Kit, id: string, i: number, onWater: boolean): void {
  const def = DISTRICTS[id as DistrictId];
  const col = def?.color ?? '#999999';
  if (!onWater) k.cyl(S * 0.62, S * 0.66, 0.8, '#b8b0a0', 0, -0.4, 0, 6);
  switch (id) {
    case 'campus':
      k.box(13, 6.5, 9, '#e8e2d6', -2, 0, -1);
      k.box(13.6, 1, 9.6, col, -2, 6.5, -1);
      k.cyl(3.4, 3.4, 4, '#dfe3e6', 6, 0, 3, 10);
      k.add(new THREE.SphereGeometry(3.6, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#9aa4ad', 6, 4, 3);
      break;
    case 'holy-site':
      k.box(14, 1.4, 10, STONE, 0, 0, 0);
      for (let n = 0; n < 4; n++) {
        k.cyl(0.6, 0.6, 7, '#f4f1ea', -5 + n * 3.3, 1.4, 4, 6);
        k.cyl(0.6, 0.6, 7, '#f4f1ea', -5 + n * 3.3, 1.4, -4, 6);
      }
      k.box(13, 1, 10, '#f4f1ea', 0, 8.4, 0);
      k.cone(7.5, 4, col, 0, 9.4, 0, 4);
      break;
    case 'theater':
      k.add(new THREE.CylinderGeometry(10, 11, 4, 14, 1, true, Math.PI * 0.5, Math.PI), '#d8cbb0', 0, 2, -1);
      k.add(new THREE.CylinderGeometry(7, 8, 2.5, 14, 1, true, Math.PI * 0.5, Math.PI), '#cbbd9f', 0, 1.25, -1);
      k.box(9, 1.4, 4, col, 0, 0, 4);
      k.box(9, 6, 0.8, '#efe6cf', 0, 0, 6.2);
      break;
    case 'commercial':
      for (let n = 0; n < 4; n++) {
        const x = -7 + (n % 2) * 9;
        const z = -5 + Math.floor(n / 2) * 9;
        k.box(6, 3.6, 4.6, '#e3d6b6', x, 0, z);
        k.cone(4.6, 3, n % 2 ? col : '#c0392b', x, 3.6, z, 4);
      }
      k.box(2, 2, 2, WOOD, 3, 0, 1);
      k.box(1.6, 1.6, 1.6, WOOD, 4.6, 0, -0.4);
      break;
    case 'industrial':
      k.box(15, 7, 10, '#8d8478', -1, 0, 0);
      k.box(15.4, 1, 10.4, col, -1, 7, 0);
      k.cyl(1.2, 1.5, 14, '#6d5f52', 5, 0, -3, 8);
      k.cyl(1.2, 1.5, 11, '#6d5f52', 2, 0, -3, 8);
      k.ball(2.2, '#b5b5b5', 5.6, 16.5, -3.6, 1);
      k.ball(1.6, '#c8c8c8', 6.6, 18.5, -4.6, 1);
      break;
    case 'encampment':
      for (let s = 0; s < 6; s++) {
        const a = (s * Math.PI) / 3;
        k.box(S * 0.95, 4, 0.8, WOOD, Math.cos(a) * S * 0.55, 0, Math.sin(a) * S * 0.55, -a + Math.PI / 2);
      }
      for (const [x, z] of [
        [-5, -3],
        [4, -4],
        [0, 4],
      ])
        k.cone(3.4, 5.5, '#d8cfb8', x, 0, z, 6);
      flag(k, 7, 4, col);
      break;
    case 'harbor':
      k.box(18, 1, 5, WOOD, 0, 0.2, 0);
      k.box(5, 1, 14, WOOD, -6, 0.2, 4);
      for (let n = 0; n < 4; n++) k.cyl(0.4, 0.4, 4, WOOD, -8 + n * 5, -3, -2.3, 5);
      k.box(1.2, 14, 1.2, '#c0392b', 6, 1, -1);
      k.box(10, 1, 1, '#c0392b', 3, 14, -1);
      k.box(4, 3, 3, '#7a7266', 7, 1, 2);
      break;
  }
  if (id !== 'encampment') flag(k, 8.5 + (onWater ? 2 : 0), -7, col, 13);
  void i;
}

function wonder(k: Kit, id: string, i: number): void {
  const shape = Math.floor(rnd(id.length * 131 + id.charCodeAt(0) * 7, 1) * 5);
  k.cyl(S * 0.7, S * 0.74, 1.2, '#d9cfb8', 0, -0.4, 0, 6);
  switch (shape) {
    case 0: // pirâmide em degraus
      for (let n = 0; n < 5; n++) k.box(24 - n * 4.6, 3.4, 24 - n * 4.6, n === 4 ? GOLD : '#d8c79c', 0, n * 3.4, 0);
      break;
    case 1: // torre
      k.cyl(4.5, 5.5, 22, '#efe6cf', 0, 0, 0, 10);
      k.cyl(5.5, 5.5, 2, GOLD, 0, 22, 0, 10);
      k.cone(4.5, 8, GOLD, 0, 24, 0, 10);
      break;
    case 2: // estátua colossal
      k.box(8, 4, 8, STONE, 0, 0, 0);
      k.box(1.8, 9, 2, GOLD, -1.4, 4, 0);
      k.box(1.8, 9, 2, GOLD, 1.4, 4, 0);
      k.box(5.6, 8, 3, GOLD, 0, 13, 0);
      k.box(1.4, 9, 1.4, GOLD, 3.8, 17, 0, 0, 0, 0.3);
      k.ball(2.2, GOLD, 0, 23.4, 0, 1);
      k.cone(1.2, 3.6, '#ffef9a', 5.6, 25, 0, 6);
      break;
    case 3: // grande cúpula
      k.box(20, 8, 16, '#efe6cf', 0, 0, 0);
      k.add(new THREE.SphereGeometry(8, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), GOLD, 0, 8, 0);
      for (const x of [-9, 9]) k.cyl(1.4, 1.6, 15, '#efe6cf', x, 0, -7, 8);
      break;
    default: // círculo de obeliscos
      for (let n = 0; n < 7; n++) {
        const a = (n / 7) * Math.PI * 2;
        k.box(2.2, 13, 2.2, n === 0 ? GOLD : '#bfb6a6', Math.cos(a) * 11, 0, Math.sin(a) * 11, a);
        k.cone(1.6, 2.4, GOLD, Math.cos(a) * 11, 13, Math.sin(a) * 11, 4);
      }
      k.ball(3, GOLD, 0, 3, 0, 1);
  }
  void i;
}

function barbarianCamp(k: Kit): void {
  for (const [x, z, r] of [
    [-6, -3, 4],
    [5, -5, 3.6],
    [-1, 6, 3.8],
  ])
    k.cone(r, r * 1.6, '#6b4a2b', x, 0, z, 6);
  k.cone(1.4, 2.6, '#ff8a2a', 1, 0.3, 0, 5);
  k.ball(0.9, '#ffd23f', 1, 1.2, 0);
  k.cyl(0.25, 0.25, 12, '#2b1a0c', 8, 0, 3, 4);
  k.box(4, 2.4, 0.25, '#c0392b', 10, 9, 3);
}

export function buildStructures(field: TerrainField, state: GameState, mat: THREE.Material): THREE.Mesh | null {
  const k = new Kit();
  state.map.tiles.forEach((t, i) => {
    const c = tileCenter(state, i);
    const water = t.terrain === 'ocean' || t.terrain === 'coast';
    const at = (dx: number, dz: number, rot = 0) => {
      const x = c.x + dx;
      const z = c.y + dz;
      k.push(x, water ? WATER_LEVEL : field.height(x, z) - 0.3, z, rot);
    };
    if (t.builtWonder) {
      at(0, 0);
      wonder(k, t.builtWonder, i);
      k.pop();
    } else if (t.district) {
      at(0, 0, Math.round(rnd(i, 21) * 3) * (Math.PI / 6));
      district(k, t.district, i, water);
      k.pop();
    } else if (t.improvement && t.improvement !== 'farm') {
      at(-4, 3, rnd(i, 22) * Math.PI);
      if (t.pillaged) k.push(0, -1, 0, 0.6, 0.7);
      switch (t.improvement) {
        case 'mine':
          mine(k, i);
          break;
        case 'quarry':
          quarry(k, i);
          break;
        case 'pasture':
          pasture(k, i);
          break;
        case 'plantation':
          plantation(k, i);
          break;
        case 'camp':
          camp(k);
          break;
        case 'fishing-boats':
          fishingBoat(k);
          break;
      }
      if (t.pillaged) k.pop();
      k.pop();
    }
  });
  for (const cp of state.camps) {
    const c = tileCenter(state, cp.pos);
    k.push(c.x, field.height(c.x, c.y) - 0.3, c.y, rnd(cp.pos, 5) * Math.PI);
    barbarianCamp(k);
    k.pop();
  }
  const m = k.build();
  if (!m.neutral) return null;
  m.neutral.computeBoundingSphere();
  return new THREE.Mesh(m.neutral, mat);
}
