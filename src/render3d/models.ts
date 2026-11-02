import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { UNITS } from '../data/units';
import type { Pack, PackModel } from './pack';
import { linear } from './terrain';

/**
 * Modelos 3D procedurais (low-poly) montados com primitivas do three.js.
 * Cada modelo tem duas geometrias: `neutral` (com cores por vértice) e `team` (pintada com a
 * cor da civilização pelo material). Frente do modelo = +z (voltado para a câmera).
 */

export interface Model {
  neutral: THREE.BufferGeometry | null;
  team: THREE.BufferGeometry | null;
}

type Color = string | 'team';

/** Acumulador de peças: cada peça é uma geometria já transformada. */
export class Kit {
  private neutral: THREE.BufferGeometry[] = [];
  private team: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private stack: THREE.Matrix4[] = [];

  /** Aplica uma transformação às próximas peças (até `pop`). */
  push(x = 0, y = 0, z = 0, rotY = 0, s = 1): this {
    const t = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(s, s, s),
    );
    this.stack.push(this.m.clone());
    this.m.multiply(t);
    return this;
  }

  pop(): this {
    this.m = this.stack.pop() ?? new THREE.Matrix4();
    return this;
  }

  add(geo: THREE.BufferGeometry, color: Color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(1, 1, 1),
    );
    g = g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(this.m, local));
    if (color === 'team') {
      // branco: o material da equipe dá a cor
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
      this.team.push(g);
    }
    else {
      const c = linear(color);
      const arr = new Float32Array(g.attributes.position.count * 3);
      for (let v = 0; v < arr.length; v += 3) arr.set(c, v);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      this.neutral.push(g);
    }
    return this;
  }

  box(w: number, h: number, d: number, color: Color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, rx, ry, rz);
  }

  cyl(rt: number, rb: number, h: number, color: Color, x = 0, y = 0, z = 0, seg = 6, rx = 0, rz = 0): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y + h / 2, z, rx, 0, rz);
  }

  cone(r: number, h: number, color: Color, x = 0, y = 0, z = 0, seg = 6, rx = 0, rz = 0): this {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, x, y + h / 2, z, rx, 0, rz);
  }

  ball(r: number, color: Color, x = 0, y = 0, z = 0, detail = 0): this {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, x, y, z);
  }

  /** Modelo importado (pacote Quaternius) com transformação local; `rx`/`rz` inclinam. */
  model(m: PackModel | undefined, x = 0, y = 0, z = 0, ry = 0, s = 1, rx = 0, rz = 0): this {
    if (!m) return this;
    const t = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(s, s, s),
    );
    const mat = new THREE.Matrix4().multiplyMatrices(this.m, t);
    if (m.neutral) this.neutral.push(m.neutral.clone().applyMatrix4(mat));
    if (m.team) this.team.push(m.team.clone().applyMatrix4(mat));
    return this;
  }

  build(): Model {
    return {
      neutral: this.neutral.length ? mergeGeometries(this.neutral) : null,
      team: this.team.length ? (mergeGeometries(this.team) ?? null) : null,
    };
  }
}

const SKIN = '#e2b48c';
const DARK = '#3a3128';
const WOOD = '#7a5532';
const METAL = '#b8bec4';
const CLOTH = '#efe6cf';

type Weapon = 'club' | 'spear' | 'sword' | 'bow' | 'sling' | 'musket' | 'staff' | 'hammer' | 'none';

/** Uma figura humana (~9 de altura) com arma. */
function figure(k: Kit, x: number, z: number, weapon: Weapon, opts: { robe?: boolean; helmet?: string; shield?: boolean; s?: number } = {}): void {
  k.push(x, 0, z, 0, opts.s ?? 1);
  if (opts.robe) {
    k.cone(2.1, 6.4, 'team', 0, 0, 0, 7);
  } else {
    k.box(0.75, 3, 0.9, DARK, -0.55, 0, 0);
    k.box(0.75, 3, 0.9, DARK, 0.55, 0, 0);
    k.box(2.3, 3.2, 1.4, 'team', 0, 3, 0);
    k.box(0.6, 2.6, 0.6, 'team', -1.45, 3.4, 0);
    k.box(0.6, 2.6, 0.6, 'team', 1.45, 3.4, 0);
  }
  k.ball(1.05, SKIN, 0, 7.2, 0, 1);
  if (opts.helmet) k.cone(1.15, 1.2, opts.helmet, 0, 7.6, 0, 7);
  switch (weapon) {
    case 'spear':
      k.cyl(0.18, 0.18, 11, WOOD, 1.8, 0.6, 0.4, 4);
      k.cone(0.45, 1.4, METAL, 1.8, 11.6, 0.4, 4);
      break;
    case 'sword':
      k.box(0.35, 4, 0.2, METAL, 1.75, 4.2, 0.9, 0, 0.5);
      break;
    case 'club':
      k.cyl(0.55, 0.3, 3.4, WOOD, 1.75, 3.6, 0.8, 5, 0.4);
      break;
    case 'bow':
      k.add(new THREE.TorusGeometry(2.2, 0.16, 4, 10, Math.PI), WOOD, 1.8, 5.2, 0.5, 0, Math.PI / 2, Math.PI / 2);
      break;
    case 'sling':
      k.ball(0.45, '#8a8a8a', 1.8, 6.4, 0.6);
      break;
    case 'musket':
      k.cyl(0.16, 0.16, 7.5, DARK, 1.7, 2.6, 0.5, 4, 0.15);
      break;
    case 'staff':
      k.cyl(0.16, 0.16, 8.5, WOOD, 1.7, 0.3, 0.4, 4);
      k.ball(0.55, '#ffd23f', 1.7, 9, 0.4);
      break;
    case 'hammer':
      k.cyl(0.14, 0.14, 3.5, WOOD, 1.7, 3, 0.6, 4, 0.5);
      k.box(1.1, 0.7, 0.7, METAL, 1.7, 5.6, 1.6);
      break;
  }
  if (opts.shield) k.cyl(1.5, 1.5, 0.3, 'team', -1.75, 4.4, 0.6, 8, Math.PI / 2, Math.PI / 2);
  k.pop();
}

function squad(k: Kit, weapon: Weapon, opts: Parameters<typeof figure>[4] = {}): void {
  figure(k, -3.6, -1.6, weapon, opts);
  figure(k, 3.6, -1.6, weapon, opts);
  figure(k, 0, 2.6, weapon, opts);
}

function horse(k: Kit, x: number, z: number, rider: Weapon, armor = false): void {
  k.push(x, 0, z);
  const coat = armor ? '#5b4a3a' : '#7b5232';
  k.box(2.4, 2.6, 6, coat, 0, 4, 0);
  for (const [lx, lz] of [
    [-0.8, -2.2],
    [0.8, -2.2],
    [-0.8, 2.2],
    [0.8, 2.2],
  ])
    k.box(0.6, 4, 0.6, coat, lx, 0, lz);
  k.box(1.4, 3.2, 1.6, coat, 0, 5.8, 3.4, 0, -0.5);
  k.box(1.2, 1.2, 2.4, coat, 0, 8, 4.6);
  k.box(0.4, 2.2, 1.6, DARK, 0, 6.4, -3.3);
  k.box(2.6, 0.8, 2.6, 'team', 0, 6.6, -0.3);
  k.push(0, 4.6, -0.3, 0, 0.85);
  k.box(2.1, 3, 1.3, 'team', 0, 3, 0);
  k.ball(1.0, SKIN, 0, 7, 0, 1);
  k.cone(1.1, 1.2, METAL, 0, 7.4, 0, 7);
  if (rider === 'spear') {
    k.cyl(0.16, 0.16, 11, WOOD, 1.6, 1, 1.6, 4, 0.9);
  } else k.box(0.3, 3.8, 0.2, METAL, 1.6, 3.2, 0.8, 0, 0.6);
  k.pop();
  k.pop();
}

function hull(k: Kit, len: number, wid: number, color: string, deck = WOOD): void {
  k.box(wid, 2.4, len, color, 0, -1, 0);
  k.add(new THREE.ConeGeometry(wid / 2, 4, 4), color, 0, 0.2, len / 2 + 1.8, Math.PI / 2, Math.PI / 4, 0);
  k.box(wid * 0.85, 0.4, len * 0.95, deck, 0, 1.4, 0);
}

function sail(k: Kit, z: number, h: number, w: number, color: Color): void {
  k.cyl(0.25, 0.3, h + 2, WOOD, 0, 1.4, z, 5);
  k.box(w, h * 0.7, 0.3, color, 0, h * 0.35 + 2, z);
}

/** Barco genérico das unidades terrestres embarcadas. */
function transport(k: Kit): void {
  hull(k, 11, 4.4, WOOD);
  sail(k, 0, 8, 6, 'team');
}

function wagon(k: Kit, x: number, z: number, canvas: string): void {
  k.push(x, 0, z);
  k.box(4, 2, 6, WOOD, 0, 1.6, 0);
  for (const [wx, wz] of [
    [-2.2, -2],
    [2.2, -2],
    [-2.2, 2],
    [2.2, 2],
  ])
    k.cyl(1.1, 1.1, 0.4, DARK, wx, 1.1, wz, 8, 0, Math.PI / 2);
  k.add(new THREE.CylinderGeometry(2.3, 2.3, 5.6, 8, 1, false, 0, Math.PI), canvas, 0, 3.6, 0, Math.PI / 2, 0, Math.PI / 2);
  k.pop();
}

// ------------------------------------------------------------------ com modelos importados

type Gear = { weapon?: string; ws?: number; helmet?: string; shield?: string; wrz?: number };

/** Coloca `part` com o ponto de pegada (25% da altura) no encaixe `at` do boneco. */
function grip(k: Kit, part: PackModel | undefined, at: [number, number, number] | undefined, s: number, rz = 0): void {
  if (!part || !at) return;
  const cx = (part.min[0] + part.max[0]) / 2;
  const cz = (part.min[2] + part.max[2]) / 2;
  const gy = part.min[1] + 0.25 * (part.max[1] - part.min[1]);
  k.push(at[0], at[1], at[2], 0, 1);
  k.model(part, -cx * s, -gy * s, -cz * s, 0, s, 0, rz);
  k.pop();
}

/** Um soldado importado (≈9 de altura) com equipamento. */
function soldier(k: Kit, pack: Pack, x: number, z: number, g: Gear, ry = 0, rider = false): void {
  const body = pack.get(rider ? 'rider' : 'knight');
  if (!body) return;
  const S = 9 / (body.max[1] - body.min[1]);
  k.push(x, -body.min[1] * S, z, ry, S);
  k.model(body);
  const pts = body.points;
  if (g.weapon) grip(k, pack.get(g.weapon), pts.Palm_R, g.ws ?? 0.45, g.wrz ?? 0);
  if (g.shield) {
    const sh = pack.get(g.shield);
    const p = pts.Palm_L;
    if (sh && p) {
      const cy = (sh.min[1] + sh.max[1]) / 2;
      k.model(sh, p[0] + 0.25, p[1] - cy * 0.75, p[2] + 0.35, Math.PI / 2, 0.75);
    }
  }
  if (g.helmet) {
    const hm = pack.get(g.helmet);
    const p = pts.Head;
    if (hm && p) k.model(hm, p[0] - ((hm.min[0] + hm.max[0]) / 2) * 1.05, p[1] - 0.15 - hm.min[1] * 1.05, p[2] - ((hm.min[2] + hm.max[2]) / 2) * 1.05, 0, 1.05);
  }
  k.pop();
}

function squad3(k: Kit, pack: Pack, g: Gear): void {
  soldier(k, pack, -3.8, -1.8, g);
  soldier(k, pack, 3.8, -1.8, g);
  soldier(k, pack, 0, 2.8, g);
}

/** Escala para o maior lado do modelo medir `size`. */
function fit(m: PackModel | undefined, size: number, axis: 0 | 1 | 2 = 2): number {
  return m ? size / Math.max(1e-6, m.max[axis] - m.min[axis]) : 1;
}

function base(m: PackModel | undefined, s: number): number {
  return m ? -m.min[1] * s : 0;
}

function packUnit(type: string, embarked: boolean, pack: Pack): Model | null {
  const k = new Kit();
  const ship = (name: string, len: number, ry = 0) => {
    const m = pack.get(name);
    if (!m) return false;
    const s = fit(m, len);
    k.model(m, -((m.min[0] + m.max[0]) / 2) * s, -1.2 - m.min[1] * s * 0.0, -((m.min[2] + m.max[2]) / 2) * s, ry, s);
    return true;
  };
  if (embarked) {
    if (!ship('boatSail', 13)) return null;
    soldier(k, pack, 0, -1, {}, 0);
    return k.build();
  }
  switch (type) {
    case 'warrior':
      squad3(k, pack, { weapon: 'club', ws: 1, shield: 'shieldRound' });
      break;
    case 'barbarian-raider':
      squad3(k, pack, { weapon: 'axe', ws: 0.45 });
      break;
    case 'slinger':
      squad3(k, pack, {});
      break;
    case 'archer':
      squad3(k, pack, { weapon: 'bow', ws: 0.55, helmet: 'helmet1' });
      break;
    case 'spearman':
      squad3(k, pack, { weapon: 'spear', ws: 0.8, helmet: 'helmet1', shield: 'shieldRound' });
      break;
    case 'swordsman':
      squad3(k, pack, { weapon: 'sword', ws: 0.45, helmet: 'helmet2', shield: 'shieldHeater' });
      break;
    case 'musketeer':
    case 'line-infantry':
      squad3(k, pack, { weapon: 'rifle', ws: 1.25, wrz: Math.PI / 2, helmet: type === 'musketeer' ? 'helmet3' : undefined });
      if (type === 'line-infantry') soldier(k, pack, -7, 2.6, { weapon: 'rifle', ws: 1.25, wrz: Math.PI / 2 });
      break;
    case 'scout':
      soldier(k, pack, 0, 0, { weapon: 'spear', ws: 0.8 });
      break;
    case 'builder':
      soldier(k, pack, -2, 1, { weapon: 'hammer', ws: 0.5 });
      k.box(4, 1.2, 2.2, '#7a5532', 3, 0, -1);
      k.box(3.6, 1.2, 2.2, '#7a5532', 3, 1.2, -1, 0.4);
      break;
    case 'horseman': {
      const horse = pack.get('horse');
      if (!horse) return null;
      const hs = fit(horse, 11, 1) * 0.95;
      for (const [hx, hz] of [
        [-4, 0.5],
        [4, -1.5],
      ]) {
        k.push(hx, 0, hz);
        k.model(horse, -((horse.min[0] + horse.max[0]) / 2) * hs, base(horse, hs), -((horse.min[2] + horse.max[2]) / 2) * hs, 0, hs);
        soldier(k, pack, 0, -0.6, { weapon: hz < 0 ? 'spear' : 'sword', ws: hz < 0 ? 0.8 : 0.45, helmet: 'helmet2' }, 0, true);
        k.pop();
      }
      // o cavaleiro montado fica sobre a sela
      break;
    }
    case 'tank': {
      const m = pack.get('tank');
      if (!m) return null;
      const s = fit(m, 15, 0);
      k.model(m, 0, base(m, s), 0, Math.PI / 2, s);
      break;
    }
    case 'settler':
    case 'trader': {
      const cart = pack.get('cart');
      if (!cart) return null;
      const s = fit(cart, 10);
      k.model(cart, 3 - ((cart.min[0] + cart.max[0]) / 2) * s, base(cart, s), -((cart.min[2] + cart.max[2]) / 2) * s, 0, s);
      soldier(k, pack, -3.5, 1, type === 'settler' ? { weapon: 'spear', ws: 0.6 } : {});
      break;
    }
    case 'galley':
      if (!ship('vikingBoat', 15)) return null;
      break;
    case 'quadrireme':
      if (!ship('vikingBoat', 19)) return null;
      break;
    case 'caravel':
      if (!ship('sailShip', 18)) return null;
      break;
    default:
      return null;
  }
  return k.build();
}

export function unitModel(type: string, embarked = false, pack?: Pack | null): Model {
  if (pack) {
    const m = packUnit(type, embarked, pack);
    if (m) return m;
  }
  const k = new Kit();
  const def = UNITS[type];
  if (embarked) {
    transport(k);
    figure(k, 0, -2.5, 'none', { s: 0.75 });
    return k.build();
  }
  switch (type) {
    case 'warrior':
    case 'barbarian-raider':
      squad(k, 'club', { shield: type === 'warrior' });
      break;
    case 'slinger':
      squad(k, 'sling');
      break;
    case 'archer':
      squad(k, 'bow', { helmet: '#7a5532' });
      break;
    case 'spearman':
      squad(k, 'spear', { helmet: METAL, shield: true });
      break;
    case 'swordsman':
      squad(k, 'sword', { helmet: METAL, shield: true });
      break;
    case 'musketeer':
      squad(k, 'musket', { helmet: DARK });
      break;
    case 'line-infantry':
      squad(k, 'musket', { helmet: '#2b2b2b' });
      figure(k, -6.5, 2.4, 'musket', { helmet: '#2b2b2b' });
      break;
    case 'horseman':
      horse(k, -3.2, 0, 'sword');
      horse(k, 3.4, -1.5, 'spear');
      break;
    case 'catapult':
      k.box(6, 1.2, 8, WOOD, 0, 1.2, 0);
      for (const [wx, wz] of [
        [-3.2, -2.6],
        [3.2, -2.6],
        [-3.2, 2.6],
        [3.2, 2.6],
      ])
        k.cyl(1.3, 1.3, 0.5, DARK, wx, 1.1, wz, 8, 0, Math.PI / 2);
      k.box(0.8, 5, 0.8, WOOD, -2, 2.4, 0.5);
      k.box(0.8, 5, 0.8, WOOD, 2, 2.4, 0.5);
      k.box(0.7, 0.7, 10, WOOD, 0, 6, -1, 0, 0.7);
      k.ball(1.2, '#8a8a8a', 0, 9.6, -4.4);
      figure(k, -5, 3, 'none', { s: 0.8 });
      break;
    case 'tank':
      k.box(8, 3, 11, '#5a6040', 0, 1, 0);
      k.box(9, 1.6, 12, DARK, 0, 0, 0);
      k.box(5, 2.4, 5.5, 'team', 0, 4, -0.5);
      k.cyl(0.5, 0.5, 8, '#4a4f36', 0, 5.2, 3.5, 6, Math.PI / 2);
      break;
    case 'settler':
      wagon(k, 2.5, 0, CLOTH);
      figure(k, -3.5, 1, 'staff');
      break;
    case 'builder':
      figure(k, -2, 1, 'hammer');
      k.box(4, 1.2, 2.2, WOOD, 3, 0, -1);
      k.box(3.6, 1.2, 2.2, WOOD, 3, 1.2, -1, 0.4);
      break;
    case 'scout':
      figure(k, 0, 0, 'spear', { s: 1.05 });
      k.ball(1.4, '#9a7b55', 2.6, 1.2, -2.2);
      break;
    case 'trader':
      wagon(k, 2.5, 0, '#d9a54a');
      figure(k, -3.5, 1, 'none');
      break;
    case 'missionary':
      figure(k, 0, 0, 'staff', { robe: true });
      break;
    case 'apostle':
      figure(k, 0, 0, 'staff', { robe: true, s: 1.15 });
      k.cyl(2.6, 2.6, 0.2, '#ffd23f', 0, 0.1, 0, 10);
      break;
    case 'inquisitor':
      figure(k, 0, 0, 'staff', { robe: true, helmet: '#2b2b2b' });
      break;
    case 'galley':
      hull(k, 13, 4.6, WOOD);
      for (const z of [-3, 0, 3]) {
        k.box(9, 0.25, 0.3, WOOD, 0, 0.6, z);
      }
      sail(k, 0, 8, 6.5, 'team');
      break;
    case 'quadrireme':
      hull(k, 17, 5.4, '#6a4a2c');
      for (const z of [-5, -2, 1, 4]) k.box(10.5, 0.25, 0.3, WOOD, 0, 0.6, z);
      sail(k, -1, 10, 7.5, 'team');
      k.box(2, 1.6, 2, METAL, 0, 1.5, 6);
      break;
    case 'caravel':
      hull(k, 16, 5.6, '#6b4a2b');
      k.box(5, 2.2, 4, '#6b4a2b', 0, 1.4, -5);
      sail(k, -2, 12, 8, CLOTH);
      sail(k, 4, 9, 6, CLOTH);
      k.box(1.2, 3, 0.35, 'team', 0, 7, -1.8);
      break;
    case 'ironclad':
      hull(k, 18, 6, '#55595e', '#6d7278');
      k.cyl(1.1, 1.1, 6, DARK, 0, 1.6, -1, 8);
      k.cyl(2.2, 2.2, 1.8, 'team', 0, 1.6, 4.5, 8);
      k.cyl(0.35, 0.35, 5, DARK, 0, 2.5, 7, 5, Math.PI / 2);
      break;
    default:
      if (def?.greatPerson) {
        figure(k, 0, 0, 'staff', { robe: true, s: 1.25 });
        k.cyl(3.2, 3.2, 0.25, '#ffd23f', 0, 0.1, 0, 12);
      } else if (def?.domain === 'sea') {
        transport(k);
      } else if (def?.class === 'civilian') {
        figure(k, 0, 0, 'none');
      } else {
        squad(k, 'sword', { shield: true });
      }
  }
  return k.build();
}
