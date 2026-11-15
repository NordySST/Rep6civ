import * as THREE from 'three';
import { CIV_BY_ID } from '../data/civs';
import { LEADER_BY_CIV, type LeaderDef, type LeaderTheme } from '../data/leaders';
import { buildRig, loadLeaders, setPose, solvePose, type PoseSpec, type Rig, type SolvedPose } from './leaders';
import { loadPack, type Pack } from './pack';

/**
 * Tela do líder (diplomacia): cena 3D própria com o líder em pé diante de um cenário da
 * sua civilização, luz dramática e gestos conforme a atitude. Um único `LeaderStage`
 * (um contexto WebGL) é reaproveitado: o canvas muda de diálogo e o laço de animação para
 * sozinho quando ele sai da página. Também gera os retratos (`portrait`).
 */

export type LeaderMood = 'neutral' | 'friendly' | 'hostile';
export type LeaderGesture = 'greet' | 'happy' | 'angry' | 'war' | 'nod';

const H = 1.75; // altura do líder em metros

// ——— poses (espaço do personagem: x = esquerda dele, y = cima, z = frente) ———
const mirror = (v: [number, number, number]): [number, number, number] => [-v[0], v[1], v[2]];
function arms(r: [number, number, number], rl: [number, number, number], l?: [number, number, number], ll?: [number, number, number]) {
  return { UpperArm_R: r, LowerArm_R: rl, UpperArm_L: l ?? mirror(r), LowerArm_L: ll ?? mirror(rl) };
}
const DOWN = arms([-0.25, -1, 0.12], [-0.1, -1, 0.35]);
const POSES: Record<string, PoseSpec> = {
  base: { aim: DOWN },
  clasp: { aim: arms([-0.3, -0.8, 0.45], [0.75, -0.05, 0.6]) },
  crossed: { aim: arms([-0.3, -0.4, 0.8], [0.7, 0.1, 0.6]), rot: { Head: [-6, 0, 0] } },
  wave: { aim: { ...DOWN, UpperArm_R: [-0.7, 0.7, 0.2], LowerArm_R: [-0.15, 1, 0.15] }, rot: { Head: [0, 0, -6] } },
  wave2: { aim: { ...DOWN, UpperArm_R: [-0.75, 0.6, 0.25], LowerArm_R: [-0.55, 0.85, 0.2] }, rot: { Head: [0, 0, -6] } },
  open: { aim: arms([-0.8, -0.25, 0.5], [-0.6, 0.2, 0.8]), rot: { Head: [-8, 0, 0] } },
  fist: { aim: { ...DOWN, UpperArm_R: [-0.4, -0.15, 0.9], LowerArm_R: [-0.1, 0.9, 0.45], UpperArm_L: [0.6, -0.75, -0.1], LowerArm_L: [0.5, -0.4, 0.3] } },
  point: { aim: { ...DOWN, UpperArm_R: [-0.3, 0.45, 0.85], LowerArm_R: [-0.2, 0.55, 0.85] }, rot: { Torso: [6, 0, 0] } },
  raise: { aim: arms([-0.45, 0.85, 0.2], [-0.1, 1, 0.1]), rot: { Head: [-10, 0, 0] } },
};

const IDLE: Record<LeaderMood, string> = { neutral: 'base', friendly: 'clasp', hostile: 'crossed' };
const GESTURES: Record<LeaderGesture, [string, number][]> = {
  greet: [['wave', 0.45], ['wave2', 0.35], ['wave', 0.35], ['wave2', 0.35]],
  happy: [['open', 1.4]],
  angry: [['fist', 1.5]],
  war: [['point', 1.1], ['raise', 1.3]],
  nod: [['base', 0.9]],
};

// ——— materiais e primitivas ———
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, rough = 0.8, metal = 0, emissive?: string, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial {
  const k = `${color}|${rough}|${metal}|${emissive}|${side}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side });
    if (emissive) {
      m.emissive = new THREE.Color(emissive);
      m.emissiveIntensity = 1.6;
    }
    matCache.set(k, m);
  }
  return m;
}
function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, cast = true): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = cast;
  o.receiveShadow = true;
  return o;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, s = 16) => new THREE.CylinderGeometry(rt, rb, h, s);

function gradientTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  for (const [t, col] of stops) gr.addColorStop(t, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Piso quadriculado/tábuas desenhado em canvas. */
function floorTexture(a: string, b: string, kind: 'tiles' | 'planks' | 'stone' | 'rug'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = a;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = b;
  if (kind === 'tiles') {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) g.fillRect(x * 64, y * 64, 64, 64);
  } else if (kind === 'planks') {
    for (let y = 0; y < 8; y++) {
      g.fillRect(0, y * 32, 256, 2);
      g.fillRect(((y * 97) % 256) | 0, y * 32, 2, 32);
    }
  } else if (kind === 'stone') {
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) g.strokeRect(x * 43 + (y % 2) * 20, y * 43, 43, 43);
    g.strokeStyle = b;
  } else {
    g.fillRect(24, 24, 208, 208);
    g.fillStyle = a;
    g.fillRect(40, 40, 176, 176);
    g.strokeStyle = b;
    g.lineWidth = 6;
    for (let i = 0; i < 4; i++) g.strokeRect(60 + i * 18, 60 + i * 18, 136 - i * 36, 136 - i * 36);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

interface SetInfo {
  group: THREE.Group;
  sky: [number, string][];
  fog: string;
  hemi: [string, string, number];
  key: [string, number];
  rim: string;
  /** Luzes de fogo que tremulam. */
  flames: THREE.PointLight[];
  /** Objetos que balançam devagar (velas, bandeiras, água). */
  sway: THREE.Object3D[];
}

function floor(g: THREE.Group, tex: THREE.Texture, size: number, repeat: number): void {
  tex.repeat.set(repeat, repeat);
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 });
  const f = mesh(new THREE.PlaneGeometry(size, size), m, 0, 0, 0, false);
  f.rotation.x = -Math.PI / 2;
  g.add(f);
}

function column(g: THREE.Group, x: number, z: number, h: number, color: string, r = 0.22): void {
  const m = mat(color, 0.5);
  g.add(mesh(cyl(r, r * 1.08, h, 20), m, x, h / 2, z));
  g.add(mesh(box(r * 2.8, 0.14, r * 2.8), m, x, 0.07, z));
  g.add(mesh(box(r * 2.8, 0.16, r * 2.8), m, x, h - 0.08, z));
}

function banner(g: THREE.Group, x: number, y: number, z: number, w: number, h: number, color: string, trim: string, sway: THREE.Object3D[]): void {
  const piv = new THREE.Group();
  piv.position.set(x, y, z);
  const cloth = mesh(new THREE.PlaneGeometry(w, h, 1, 6), mat(color, 0.9, 0, undefined, THREE.DoubleSide), 0, -h / 2, 0);
  // ponta em V
  const pos = cloth.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -h / 2 + 0.01 && Math.abs(pos.getX(i)) < 0.01) pos.setY(i, pos.getY(i) + 0.2);
  piv.add(cloth);
  piv.add(mesh(cyl(0.03, 0.03, w + 0.2, 8), mat(trim, 0.4, 0.6), 0, 0, 0).rotateZ(Math.PI / 2));
  piv.add(mesh(new THREE.PlaneGeometry(w * 0.4, w * 0.4), mat(trim, 0.4, 0.5, undefined, THREE.DoubleSide), 0, -h * 0.4, 0.01));
  g.add(piv);
  sway.push(piv);
}

function torch(g: THREE.Group, x: number, y: number, z: number, flames: THREE.PointLight[], color = '#ff9a3c'): void {
  g.add(mesh(cyl(0.05, 0.035, 0.5, 8), mat('#3b2a1a'), x, y - 0.25, z));
  g.add(mesh(cyl(0.11, 0.06, 0.12, 10), mat('#5a4630', 0.5, 0.5), x, y + 0.02, z));
  const f = mesh(new THREE.ConeGeometry(0.08, 0.28, 8), new THREE.MeshBasicMaterial({ color: '#ffd27a' }), x, y + 0.2, z, false);
  g.add(f);
  const l = new THREE.PointLight(color, 3, 6, 1.6);
  l.position.set(x, y + 0.3, z);
  g.add(l);
  flames.push(l);
}

function tree(g: THREE.Group, pack: Pack | null, name: string, x: number, z: number, s: number, ry = 0): void {
  const m = pack?.get(name);
  if (m?.neutral) {
    const o = new THREE.Mesh(m.neutral, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    const k = s / (m.max[1] - m.min[1]);
    o.scale.setScalar(k);
    o.position.set(x, -m.min[1] * k, z);
    o.rotation.y = ry;
    o.castShadow = true;
    g.add(o);
  } else {
    g.add(mesh(cyl(0.08 * s, 0.12 * s, s * 0.5, 8), mat('#5b3a22'), x, s * 0.25, z));
    g.add(mesh(new THREE.ConeGeometry(0.4 * s, s * 0.8, 10), mat('#2f5e2b'), x, s * 0.75, z));
  }
}

function packModel(g: THREE.Group, pack: Pack | null, name: string, x: number, y: number, z: number, h: number, ry = 0, team?: string): THREE.Object3D | null {
  const m = pack?.get(name);
  if (!m) return null;
  const o = new THREE.Group();
  if (m.neutral) o.add(new THREE.Mesh(m.neutral, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })));
  if (m.team) o.add(new THREE.Mesh(m.team, new THREE.MeshStandardMaterial({ vertexColors: true, color: team ?? '#ffffff', roughness: 0.7 })));
  const k = h / (m.max[1] - m.min[1]);
  o.scale.setScalar(k);
  o.position.set(x, y - m.min[1] * k, z);
  o.rotation.y = ry;
  o.traverse((c) => ((c as THREE.Mesh).castShadow = (c as THREE.Mesh).receiveShadow = true));
  g.add(o);
  return o;
}

/** Monta o cenário do tema (atrás do líder, que fica na origem olhando para +z). */
function buildSet(theme: LeaderTheme, c1: string, c2: string, pack: Pack | null): SetInfo {
  const g = new THREE.Group();
  const flames: THREE.PointLight[] = [];
  const sway: THREE.Object3D[] = [];
  const info = (sky: [number, string][], fog: string, hemi: [string, string, number], key: [string, number], rim: string): SetInfo => ({ group: g, sky, fog, hemi, key, rim, flames, sway });
  switch (theme) {
    case 'throne': {
      floor(g, floorTexture('#e8e2d6', '#b9ad98', 'tiles'), 30, 10);
      const wall = mesh(box(14, 7, 0.4), mat('#d9d0c0', 0.7), 0, 3.5, -4.2);
      g.add(wall);
      for (const x of [-3.3, -1.6, 1.6, 3.3]) column(g, x, -3.4, 4.6, '#efe9dc');
      for (const x of [-2.45, 2.45]) banner(g, x, 4.1, -3.95, 1.1, 2.8, c1, c2, sway);
      // trono
      const gold = mat('#c9a13b', 0.35, 0.8);
      g.add(mesh(box(1.5, 0.3, 1.2), mat('#8e7d63'), 0, 0.15, -2.3));
      g.add(mesh(box(1.1, 0.5, 0.9), mat(c1, 0.8), 0, 0.55, -2.3));
      g.add(mesh(box(1.2, 2.2, 0.2), mat(c1, 0.8), 0, 1.4, -2.75));
      g.add(mesh(box(1.4, 0.2, 0.3), gold, 0, 2.55, -2.75));
      for (const x of [-0.62, 0.62]) g.add(mesh(box(0.15, 1.1, 0.9), gold, x, 0.75, -2.3));
      g.add(mesh(new THREE.PlaneGeometry(2.2, 9), mat(c1, 0.9), 0, 0.005, 1.2, false).rotateX(-Math.PI / 2));
      return info([[0, '#f3e6c8'], [1, '#c8b28a']], '#e9dcc0', ['#fff3dd', '#8a7558', 1.1], ['#ffe2b0', 3.2], c2);
    }
    case 'garden': {
      floor(g, floorTexture('#8a6b48', '#6f5538', 'planks'), 6, 3);
      const water = mesh(new THREE.PlaneGeometry(40, 30), mat('#3d7f8f', 0.15, 0.2), 0, -0.25, -16, false);
      water.rotation.x = -Math.PI / 2;
      g.add(water);
      const grass = mesh(new THREE.PlaneGeometry(40, 8), mat('#5c8a3a'), 0, -0.2, -2, false);
      grass.rotation.x = -Math.PI / 2;
      g.add(grass);
      const wood = mat('#6b3e22', 0.6);
      for (const x of [-2.2, 2.2]) g.add(mesh(cyl(0.12, 0.12, 3.6, 10), wood, x, 1.8, -1.6));
      g.add(mesh(box(5.4, 0.25, 0.3), wood, 0, 3.55, -1.6));
      g.add(mesh(box(6, 0.15, 0.5), mat(c1, 0.7), 0, 3.8, -1.6));
      for (const x of [-1.4, 1.4]) {
        g.add(mesh(cyl(0.02, 0.02, 0.5, 6), wood, x, 3.2, -1.6));
        g.add(mesh(new THREE.SphereGeometry(0.2, 12, 10), mat('#ffcf7a', 0.5, 0, '#ff9f40'), x, 2.85, -1.6, false));
      }
      for (let i = 0; i < 12; i++) {
        const x = -8 + i * 1.45 + Math.sin(i * 3.1) * 0.5;
        if (Math.abs(x) < 3) continue;
        g.add(mesh(cyl(0.06, 0.08, 4 + (i % 3), 6), mat('#6f8f3a'), x, 2, -4.5 - (i % 2)));
      }
      tree(g, pack, 'tree1', -5, -7, 4.5, 0.4);
      tree(g, pack, 'tree2', 5.5, -8, 5.2, 2);
      return info([[0, '#9cc9e6'], [0.65, '#e6eed8'], [1, '#c9d9b0']], '#cfe0d4', ['#e8f4ff', '#5d6b40', 1.3], ['#fff4d8', 2.8], c2);
    }
    case 'hall': {
      floor(g, floorTexture('#4a3220', '#2f1f13', 'planks'), 30, 8);
      g.add(mesh(box(14, 7, 0.4), mat('#3a2817', 0.9), 0, 3.5, -4.5));
      for (const x of [-3, 3]) for (const z of [-3.6, -1.2]) g.add(mesh(cyl(0.28, 0.32, 6, 10), mat('#5a3b22', 0.9), x, 3, z));
      g.add(mesh(box(8, 0.35, 0.35), mat('#4b311c'), 0, 4.2, -3.6));
      for (const [x, col] of [[-2, c1], [0, c2], [2, c1]] as [number, string][]) {
        const sh = mesh(cyl(0.55, 0.55, 0.1, 20), mat(col, 0.6), x, 2.6, -4.25);
        sh.rotation.x = Math.PI / 2;
        g.add(sh);
        g.add(mesh(new THREE.SphereGeometry(0.14, 10, 8), mat('#9a9a9a', 0.3, 0.9), x, 2.6, -4.18));
      }
      for (const x of [-1.9, 1.9]) {
        g.add(mesh(cyl(0.35, 0.2, 0.5, 10), mat('#3c3c3c', 0.4, 0.8), x, 1.05, -1.8));
        g.add(mesh(cyl(0.05, 0.08, 0.8, 6), mat('#2c2c2c'), x, 0.4, -1.8));
        torch(g, x, 1.3, -1.8, flames, '#ff7a2a');
      }
      // pele no chão
      const rug = mesh(new THREE.CircleGeometry(1.4, 9), mat('#cfc4b4', 1), 0, 0.01, 0.2, false);
      rug.rotation.x = -Math.PI / 2;
      g.add(rug);
      return info([[0, '#20140c'], [1, '#3a2414']], '#1d130c', ['#9fb4d0', '#3a2414', 0.55], ['#ffd2a0', 2.4], '#ff8a3c');
    }
    case 'tent': {
      floor(g, floorTexture('#7a2e1e', '#d6a24a', 'rug'), 8, 2);
      const sand = mesh(new THREE.PlaneGeometry(60, 40), mat('#d9b77a'), 0, -0.02, -10, false);
      sand.rotation.x = -Math.PI / 2;
      g.add(sand);
      for (let i = 0; i < 5; i++) {
        const d = mesh(new THREE.SphereGeometry(4 + i, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#e0bd80'), -12 + i * 6, -1.5, -18 - (i % 2) * 4, false);
        d.scale.y = 0.35;
        g.add(d);
      }
      const silk = mat(c1, 0.8, 0, undefined, THREE.DoubleSide);
      const silk2 = mat(c2, 0.8, 0, undefined, THREE.DoubleSide);
      const roof = mesh(new THREE.ConeGeometry(4.5, 2.2, 24, 1, true, Math.PI * 0.55, Math.PI * 0.9), silk, 0, 4.2, 0.5, false);
      g.add(roof);
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue;
        const drape = mesh(new THREE.PlaneGeometry(1.3, 4.4, 1, 8), k % 2 ? silk : silk2, k * 1.25, 2.2, -2.6 + Math.abs(k) * 0.3);
        drape.rotation.y = -k * 0.15;
        g.add(drape);
        sway.push(drape);
      }
      for (const x of [-2.5, 2.5]) g.add(mesh(cyl(0.06, 0.06, 4.2, 8), mat('#c9a13b', 0.35, 0.8), x, 2.1, -2.2));
      for (const x of [-1.6, 1.6]) {
        g.add(mesh(new THREE.SphereGeometry(0.18, 10, 8), mat('#c9a13b', 0.3, 0.9, '#ffb547'), x, 2.6, -1.6, false));
        torch(g, x, 2.4, -1.6, flames, '#ffb04a');
      }
      for (const [x, col] of [[-1.3, c2], [1.4, c1]] as [number, string][]) g.add(mesh(box(0.9, 0.35, 0.6), mat(col, 0.9), x, 0.18, -1.2));
      return info([[0, '#f2a65a'], [0.6, '#f7d7a0'], [1, '#e8c48c']], '#f0c58c', ['#ffe4c0', '#8a5030', 1.0], ['#ffd59a', 2.8], '#ff9f4a');
    }
    case 'yurt': {
      floor(g, floorTexture('#8a3b24', '#e2c27a', 'rug'), 8, 2);
      const felt = mat('#d8ccb4', 0.95, 0, undefined, THREE.BackSide);
      g.add(mesh(new THREE.CylinderGeometry(4.2, 4.2, 2.6, 28, 1, true), felt, 0, 1.3, 0, false));
      g.add(mesh(new THREE.ConeGeometry(4.3, 2.2, 28, 1, true), mat('#cbbd9f', 0.95, 0, undefined, THREE.BackSide), 0, 3.7, 0, false));
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const rib = mesh(cyl(0.025, 0.025, 4.6, 5), mat('#b5452a', 0.7), Math.sin(a) * 2.15, 3.72, Math.cos(a) * 2.15, false);
        rib.lookAt(0, 4.8, 0);
        rib.rotateX(Math.PI / 2);
        g.add(rib);
      }
      for (let i = -4; i <= 4; i++) {
        const a = Math.PI + i * 0.2;
        const p = mesh(new THREE.PlaneGeometry(0.75, 2.3), mat(i % 2 ? c1 : c2, 0.9, 0, undefined, THREE.DoubleSide), Math.sin(a) * 4.05, 1.3, Math.cos(a) * 4.05, false);
        p.lookAt(0, 1.3, 0);
        g.add(p);
      }
      g.add(mesh(cyl(0.6, 0.7, 0.25, 12), mat('#4a4a4a', 0.6, 0.3), 0, 0.12, -2.4));
      torch(g, 0, 0.35, -2.4, flames, '#ff8a3a');
      return info([[0, '#1d1510'], [1, '#3a281a']], '#2a1d14', ['#ffe0c0', '#3c2614', 0.6], ['#ffd0a0', 2.2], '#ff9050');
    }
    case 'harbor': {
      floor(g, floorTexture('#d8d0c2', '#a49a88', 'stone'), 10, 3);
      const sea = mesh(new THREE.PlaneGeometry(200, 120), mat('#2f7aa0', 0.18, 0.3), 0, -2, -60, false);
      sea.rotation.x = -Math.PI / 2;
      g.add(sea);
      const stone = mat('#e6dfd0', 0.6);
      g.add(mesh(box(9, 0.18, 0.4), stone, 0, 1.05, -2.2));
      for (let i = -10; i <= 10; i++) g.add(mesh(cyl(0.07, 0.1, 0.9, 8), stone, i * 0.42, 0.5, -2.2));
      for (const x of [-3.6, 3.6]) {
        column(g, x, -2.2, 4.4, '#efe8da', 0.26);
        banner(g, x * 0.72, 3.9, -2.3, 0.8, 1.9, c1, c2, sway);
      }
      g.add(mesh(box(9, 0.5, 0.6), stone, 0, 4.6, -2.2));
      const ships: [number, number, number, number][] = [[-9, -16, 3.5, 0.4], [7, -24, 3, -0.6], [-2, -36, 2.4, 1.2]];
      for (const [x, z, h, r] of ships) {
        const o = packModel(g, pack, 'sailShip', x, -2.2, z, h, r, c1);
        if (o) sway.push(o);
      }
      return info([[0, '#5fa6d9'], [0.7, '#cfe6f2'], [1, '#e8f1f2']], '#cfe2ec', ['#eaf6ff', '#6d8c9c', 1.3], ['#fff1d6', 3], c2);
    }
    case 'savanna': {
      floor(g, floorTexture('#b88a52', '#9c7140', 'stone'), 8, 2);
      const plain = mesh(new THREE.PlaneGeometry(120, 60), mat('#c9a35a'), 0, -0.05, -30, false);
      plain.rotation.x = -Math.PI / 2;
      g.add(plain);
      const wood = mat('#4b2e1a', 0.8);
      for (const x of [-2.6, 2.6]) g.add(mesh(cyl(0.14, 0.18, 3.6, 8), wood, x, 1.8, -1.4));
      const roof = mesh(new THREE.ConeGeometry(4, 1.6, 12, 1, true), mat('#c9a35a', 1, 0, undefined, THREE.DoubleSide), 0, 4.3, -0.4, false);
      g.add(roof);
      g.add(mesh(box(5.6, 0.18, 0.18), mat(c1, 0.7), 0, 3.55, -1.4));
      const acacia = (x: number, z: number, s: number) => {
        g.add(mesh(cyl(0.08 * s, 0.14 * s, 2 * s, 6), mat('#3a2616'), x, s, z));
        const top = mesh(new THREE.SphereGeometry(1.3 * s, 12, 6), mat('#4f6a2a', 0.9), x, 2.1 * s, z);
        top.scale.y = 0.28;
        g.add(top);
      };
      acacia(-7, -12, 2);
      acacia(9, -18, 2.4);
      acacia(-14, -26, 2.2);
      for (const [x, z] of [[-1.5, -1.2], [1.6, -1.1]]) g.add(mesh(cyl(0.22, 0.16, 0.7, 10), mat(c2, 0.6), x, 0.35, z));
      return info([[0, '#d95f2e'], [0.45, '#f2a65a'], [0.75, '#f6d38c'], [1, '#e2b56a']], '#efb875', ['#ffd9a8', '#7a4a24', 1.05], ['#ffc27a', 3.2], '#ff7a3a');
    }
    case 'temple': {
      floor(g, floorTexture('#8f8a76', '#6f6a58', 'stone'), 10, 3);
      const stone = mat('#9c9682', 0.85);
      for (let i = 0; i < 5; i++) g.add(mesh(box(11 - i * 1.8, 1.1, 6 - i * 0.9), stone, 0, 0.55 + i * 1.1, -8 - i * 0.2));
      g.add(mesh(box(2.8, 2, 2), mat('#7d7766', 0.85), 0, 6.5, -9));
      g.add(mesh(box(1, 1.3, 0.1), mat('#1a1410'), 0, 6.1, -7.95));
      g.add(mesh(box(2.2, 6, 0.1), mat(c1, 0.8), 0, 3, -4.95));
      for (const x of [-2.4, 2.4]) {
        g.add(mesh(box(0.7, 2.6, 0.7), stone, x, 1.3, -2.2));
        torch(g, x, 2.9, -2.2, flames);
      }
      for (let i = 0; i < 10; i++) {
        const x = (i - 4.5) * 3 + Math.sin(i) * 1;
        if (Math.abs(x) < 6) continue;
        tree(g, pack, i % 2 ? 'tree1' : 'tree2', x, -10 - (i % 3) * 3, 4 + (i % 3), i);
      }
      return info([[0, '#6aa0b8'], [0.6, '#d8e2c6'], [1, '#a9b48c']], '#b6c4a6', ['#e8f0ff', '#4c5a34', 1.0], ['#fff0c8', 3], '#ffb060');
    }
    case 'lodge':
    default: {
      floor(g, floorTexture('#6b4a2e', '#4e341f', 'planks'), 20, 6);
      const wood = mat('#6e4a2b', 0.85);
      g.add(mesh(box(4.2, 7, 0.3), wood, -4.1, 3.5, -3.4));
      g.add(mesh(box(4.2, 7, 0.3), wood, 4.1, 3.5, -3.4));
      g.add(mesh(box(4, 1.2, 0.3), wood, 0, 0.6, -3.4));
      g.add(mesh(box(4, 2.6, 0.3), wood, 0, 5.7, -3.4));
      for (const x of [-0.7, 0.7]) g.add(mesh(box(0.12, 3.2, 0.14), mat('#4a3018'), x, 2.8, -3.35));
      g.add(mesh(box(4, 0.12, 0.14), mat('#4a3018'), 0, 2.8, -3.35));
      const snow = mesh(new THREE.PlaneGeometry(80, 40), mat('#e6eef4'), 0, 0.4, -24, false);
      snow.rotation.x = -Math.PI / 2;
      g.add(snow);
      for (let i = 0; i < 12; i++) tree(g, pack, 'pine', -9 + i * 1.7 + Math.sin(i * 2.3), -8 - (i % 3) * 3, 3 + (i % 4) * 0.6, i);
      // estantes
      for (const x of [-3.4, 3.4]) {
        g.add(mesh(box(1.4, 3, 0.5), mat('#4e341f'), x, 1.5, -3));
        for (let s = 0; s < 4; s++)
          for (let b = 0; b < 5; b++) g.add(mesh(box(0.18, 0.5, 0.36), mat([c1, c2, '#7a3b2a', '#2e4a3a', '#c9a13b'][(b + s) % 5], 0.8), x - 0.5 + b * 0.25, 0.45 + s * 0.72, -2.85));
      }
      torch(g, -2.3, 1.6, -2.4, flames, '#ff9a4a');
      banner(g, 2.2, 4.4, -3.2, 0.9, 2, c1, c2, sway);
      return info([[0, '#9bb6cc'], [0.7, '#e3ecf2'], [1, '#c6d3dc']], '#cdd8e0', ['#e6f0ff', '#4e3a28', 0.9], ['#ffe6c4', 2.8], c2);
    }
  }
}

// ——— acessórios ———
/** Grupo preso a um osso cujas coordenadas locais são metros alinhados ao mundo (na pose de repouso). */
function worldFrame(rig: Rig, bone: string): THREE.Group | null {
  const b = rig.bones.get(bone);
  if (!b) return null;
  rig.object.updateMatrixWorld(true);
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  b.matrixWorld.decompose(p, q, s);
  const g = new THREE.Group();
  g.quaternion.copy(q.invert());
  g.scale.set(1 / s.x, 1 / s.y, 1 / s.z);
  b.add(g);
  return g;
}

/**
 * Crânio dos personagens (todos usam a mesma cabeça-base): esfera estimada pelo osso da
 * cabeça (L = comprimento Head → Head_end), sem contar cabelo, barba ou chapéu.
 */
function headSphere(rig: Rig): { center: THREE.Vector3; radius: number } {
  const head = rig.jointWorld('Head')!.clone();
  const end = rig.jointWorld('Head_end')!.clone();
  const L = head.distanceTo(end);
  return { center: new THREE.Vector3(head.x, head.y + 0.7 * L, head.z + 0.08 * L), radius: 0.85 * L };
}

function addAccessories(rig: Rig, def: LeaderDef, c1: string, c2: string): THREE.Object3D[] {
  const gold = mat('#d4af37', 0.3, 0.85);
  const head = rig.jointWorld('Head')!.clone();
  const { center: hc, radius: hr } = headSphere(rig);
  const topY = hc.y + hr * 0.95;
  const hh = hr;
  const hfb = worldFrame(rig, 'Head');
  const hf = hfb ? new THREE.Group() : null;
  if (hfb && hf) {
    hf.position.set(hc.x - head.x, 0, hc.z - head.z);
    hfb.add(hf);
  }
  const r = hr * 1.05;
  const props: THREE.Object3D[] = [];
  if (hf) {
    const cy = topY - head.y - hh * 0.3;
    switch (def.headwear) {
      case 'crown': {
        const cy2 = cy + hh * 0.15;
        hf.add(mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.72, hh * 0.22, 20, 1, true), mat('#d4af37', 0.3, 0.85, undefined, THREE.DoubleSide), 0, cy2, 0));
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          hf.add(mesh(new THREE.ConeGeometry(r * 0.1, hh * 0.22, 6), gold, Math.sin(a) * r * 0.76, cy2 + hh * 0.2, Math.cos(a) * r * 0.76));
        }
        hf.add(mesh(new THREE.SphereGeometry(r * 0.08, 8, 6), mat(c1, 0.2, 0.3), 0, cy2, r * 0.8));
        break;
      }
      case 'circlet':
      case 'tiara': {
        const t = mesh(new THREE.TorusGeometry(r * 0.8, r * 0.035, 6, 32), gold, 0, cy - hh * 0.1, 0);
        t.rotation.x = Math.PI / 2;
        hf.add(t);
        hf.add(mesh(new THREE.OctahedronGeometry(r * 0.12), mat(def.headwear === 'tiara' ? c2 : c1, 0.15, 0.4), 0, cy, r * 0.8));
        if (def.headwear === 'tiara') hf.add(mesh(new THREE.ConeGeometry(r * 0.1, hh * 0.25, 4), gold, 0, cy + hh * 0.08, r * 0.78));
        break;
      }
      case 'fur': {
        const hat = mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.92, hh * 0.38, 18), mat('#5a4030', 1), 0, cy + hh * 0.05, 0);
        hf.add(hat);
        hf.add(mesh(new THREE.SphereGeometry(r * 0.65, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(c1, 0.8), 0, cy + hh * 0.2, 0));
        break;
      }
      case 'tricorn': {
        hf.add(mesh(new THREE.CylinderGeometry(r * 1.25, r * 1.25, hh * 0.05, 3), mat(c1, 0.8), 0, cy + hh * 0.06, 0).rotateY(Math.PI));
        hf.add(mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.75, hh * 0.3, 16), mat(c1, 0.8), 0, cy + hh * 0.2, 0));
        hf.add(mesh(new THREE.TorusGeometry(r * 0.75, r * 0.03, 6, 24), gold, 0, cy + hh * 0.08, 0).rotateX(Math.PI / 2));
        break;
      }
      case 'gele': {
        for (let i = 0; i < 4; i++) {
          const t = mesh(new THREE.TorusGeometry(r * (0.82 - i * 0.12), r * 0.2, 8, 20), mat(i % 2 ? c2 : c1, 0.75), 0, cy + i * hh * 0.13, -i * r * 0.08);
          t.rotation.x = Math.PI / 2 + 0.25;
          hf.add(t);
        }
        hf.add(mesh(new THREE.OctahedronGeometry(r * 0.12), gold, 0, cy, r * 0.9));
        break;
      }
      case 'feathers': {
        hf.add(mesh(new THREE.TorusGeometry(r * 0.82, r * 0.08, 6, 24), gold, 0, cy - hh * 0.05, 0).rotateX(Math.PI / 2));
        const cols = [c2, c1, '#2e9e6a', '#e0c341'];
        for (let i = -5; i <= 5; i++) {
          const f = mesh(new THREE.PlaneGeometry(r * 0.22, hh * 0.9), mat(cols[(i + 5) % 4], 0.7, 0, undefined, THREE.DoubleSide), 0, 0, 0, false);
          const piv = new THREE.Group();
          piv.position.set(0, cy, -r * 0.35);
          f.position.y = hh * 0.45;
          piv.rotation.z = i * 0.2;
          piv.rotation.x = -0.25;
          piv.add(f);
          hf.add(piv);
        }
        break;
      }
    }
  }
  if (def.cape) {
    const tf = worldFrame(rig, 'Torso');
    const neck = rig.jointWorld('Neck')!.clone();
    const torso = rig.jointWorld('Torso')!.clone();
    if (tf) {
      const h = neck.y - 0.12;
      const geo = new THREE.CylinderGeometry(0.2, 0.42, h, 18, 6, true, Math.PI * 0.6, Math.PI * 0.8);
      const cape = mesh(geo, mat(c1, 0.85, 0, undefined, THREE.DoubleSide), 0, neck.y - torso.y - h / 2 + 0.02, -0.03);
      tf.add(cape);
      const col = mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 20, Math.PI), mat(c2, 0.6), 0, neck.y - torso.y, -0.02);
      col.rotation.x = Math.PI / 2;
      col.rotation.z = Math.PI;
      tf.add(col);
    }
  }
  if (def.prop !== 'none') {
    const p = new THREE.Group();
    const wood = mat('#5b3a22', 0.7);
    switch (def.prop) {
      case 'scepter':
        p.add(mesh(cyl(0.018, 0.018, 0.6, 8), gold, 0, 0.12, 0));
        p.add(mesh(new THREE.SphereGeometry(0.05, 12, 10), mat(c1, 0.2, 0.4), 0, 0.44, 0));
        break;
      case 'staff':
        p.add(mesh(cyl(0.025, 0.03, 1.7, 8), wood, 0, 0.05, 0));
        p.add(mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 16), gold, 0, 0.95, 0));
        break;
      case 'axe':
        p.add(mesh(cyl(0.022, 0.022, 0.9, 8), wood, 0, 0.2, 0));
        p.add(mesh(box(0.03, 0.18, 0.2), mat('#b8bcc2', 0.3, 0.9), 0, 0.58, 0.08));
        break;
      case 'spear':
        p.add(mesh(cyl(0.02, 0.02, 1.9, 8), wood, 0, 0.15, 0));
        p.add(mesh(new THREE.ConeGeometry(0.045, 0.22, 8), mat('#c8ccd2', 0.3, 0.9), 0, 1.2, 0));
        p.add(mesh(new THREE.PlaneGeometry(0.1, 0.18), mat(c1, 0.8, 0, undefined, THREE.DoubleSide), 0.05, 0.98, 0));
        break;
      case 'fan': {
        const f = mesh(new THREE.CircleGeometry(0.2, 12, 0, Math.PI), mat(c2, 0.7, 0, undefined, THREE.DoubleSide), 0, 0.08, 0);
        p.add(f);
        p.add(mesh(cyl(0.012, 0.012, 0.2, 6), gold, 0, 0, 0));
        break;
      }
      case 'spyglass':
        p.add(mesh(cyl(0.03, 0.04, 0.42, 12), gold, 0, 0.1, 0));
        break;
    }
    p.userData.hand = 'Fist_R';
    props.push(p);
  }
  return props;
}

// ——— palco ———
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

interface Actor {
  rig: Rig | null;
  poses: Map<string, SolvedPose>;
  props: THREE.Object3D[];
  root: THREE.Object3D;
  /** Altura do centro da cabeça (enquadramento do retrato). */
  headY: number;
  mixer?: THREE.AnimationMixer;
  clips?: Map<string, THREE.AnimationAction>;
}

export class LeaderStage {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 400);
  private hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  private key = new THREE.DirectionalLight('#ffffff', 3);
  private rim = new THREE.DirectionalLight('#ffffff', 2.5);
  private fill = new THREE.DirectionalLight('#9fb8ff', 0.6);
  private set: SetInfo | null = null;
  private actor: Actor | null = null;
  private civId = '';
  private mood: LeaderMood = 'neutral';
  private queue: [string, number][] = [];
  private from: SolvedPose = new Map();
  private target = 'base';
  private tStart = 0;
  private stepEnd = 0;
  private gesture: LeaderGesture | null = null;
  private gestureStart = 0;
  private shown = 0;
  private raf = 0;
  private frameX = 0.5;
  private frameY = 0.5;
  private bust = false;
  private war = 0;
  private packs: Promise<[Awaited<ReturnType<typeof loadLeaders>>, Pack | null]>;

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas');
    this.canvas.className = 'leader-gl';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -3;
    sc.right = sc.top = 3;
    sc.near = 0.5;
    sc.far = 20;
    this.key.shadow.bias = -0.0008;
    this.key.position.set(-2.2, 4.2, 4.5);
    this.rim.position.set(2.5, 3, -3.5);
    this.fill.position.set(3, 1.5, 3);
    this.scene.add(this.hemi, this.key, this.key.target, this.rim, this.fill);
    this.packs = Promise.all([loadLeaders(), loadPack()]);
  }

  /** Mostra o líder da civilização; resolve quando a cena está pronta. */
  async show(civId: string, mood: LeaderMood, gesture: LeaderGesture | null = 'greet'): Promise<boolean> {
    const [leaders, pack] = await this.packs;
    const def = LEADER_BY_CIV[civId];
    const civ = CIV_BY_ID[civId];
    if (!def || !civ) return false;
    if (civId !== this.civId || !this.actor) {
      this.clearScene();
      this.civId = civId;
      this.set = buildSet(def.theme, civ.color, civ.secondaryColor, pack);
      this.scene.add(this.set.group);
      const tex = gradientTexture(this.set.sky);
      this.scene.background = tex;
      this.scene.fog = new THREE.Fog(this.set.fog, 9, 60);
      this.hemi.color.set(this.set.hemi[0]);
      this.hemi.groundColor.set(this.set.hemi[1]);
      this.hemi.intensity = this.set.hemi[2];
      this.key.color.set(this.set.key[0]);
      this.key.intensity = this.set.key[1];
      this.rim.color.set(this.set.rim);
      this.actor = (def.glb ? await this.loadGlb(def, civ.color) : null) ?? this.buildActor(leaders, def, civ.color, civ.secondaryColor);
      if (!this.actor) return false;
      this.scene.add(this.actor.root);
    }
    this.mood = mood;
    this.shown = performance.now();
    this.war = 0;
    this.from = this.currentPose();
    this.target = IDLE[mood];
    this.tStart = performance.now();
    this.queue = [];
    if (gesture) this.play(gesture);
    this.start();
    return true;
  }

  setMood(mood: LeaderMood): void {
    this.mood = mood;
    if (!this.queue.length) this.goTo(IDLE[mood]);
  }

  play(gesture: LeaderGesture): void {
    this.gesture = gesture;
    this.gestureStart = performance.now();
    if (gesture === 'war') this.war = 1;
    const a = this.actor;
    if (a?.clips) {
      const name = { greet: 'saudacao', happy: 'feliz', angry: 'raiva', war: 'guerra', nod: 'saudacao' }[gesture];
      const act = a.clips.get(name);
      if (act) {
        act.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.25).play();
        act.clampWhenFinished = false;
      }
      return;
    }
    this.queue = [...GESTURES[gesture]];
    this.next(performance.now());
  }

  /** Posição da figura na tela (frações), para deixar espaço ao diálogo. */
  frame(x: number, y: number, bust = false): void {
    this.frameX = x;
    this.frameY = y;
    this.bust = bust;
  }

  /** Para o laço (o canvas pode continuar na página, congelado). */
  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Retrato (busto) num quadrado `size`, como data URL. */
  async portrait(civId: string, size = 256, type = 'image/webp'): Promise<string | null> {
    if (!(await this.show(civId, 'friendly', null))) return null;
    this.stop();
    this.frame(0.5, 0.5, true);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    const now = performance.now() + 10000;
    this.update(now);
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL(type, 0.9);
  }

  dispose(): void {
    this.stop();
    this.clearScene();
    this.renderer.dispose();
  }

  private buildActor(leaders: Awaited<ReturnType<typeof loadLeaders>>, def: LeaderDef, c1: string, c2: string): Actor | null {
    const asset = leaders?.get(def.civId);
    if (!asset) return null;
    const rig = buildRig(asset, { team: c1, second: c2 });
    rig.object.scale.setScalar(H / rig.height);
    rig.object.updateMatrixWorld(true);
    const poses = new Map<string, SolvedPose>();
    const amp = 0.6 + def.temper * 0.5;
    for (const [k, spec] of Object.entries(POSES)) {
      // gestos mais contidos para líderes calmos: braços menos abertos
      const s: PoseSpec = { rot: spec.rot, aim: {} };
      for (const [b, d] of Object.entries(spec.aim ?? {})) {
        const base = (DOWN as Record<string, [number, number, number]>)[b] ?? d;
        s.aim![b] = k === 'base' ? d : [base[0] + (d[0] - base[0]) * amp, base[1] + (d[1] - base[1]) * amp, base[2] + (d[2] - base[2]) * amp];
      }
      poses.set(k, solvePose(rig, s));
    }
    const props = addAccessories(rig, def, c1, c2);
    const root = new THREE.Group();
    root.add(rig.object);
    for (const p of props) root.add(p);
    return { rig, poses, props, root, headY: headSphere(rig).center.y };
  }

  private async loadGlb(def: LeaderDef, color: string): Promise<Actor | null> {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(def.glb!);
      const root = new THREE.Group();
      const obj = gltf.scene;
      const bb = new THREE.Box3().setFromObject(obj);
      const k = H / Math.max(0.01, bb.max.y - bb.min.y);
      obj.scale.setScalar(k);
      obj.position.y = -bb.min.y * k;
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = m.receiveShadow = true;
        const ms = Array.isArray(m.material) ? m.material : [m.material];
        for (const x of ms) if (x.name === 'Main' && 'color' in x) (x as THREE.MeshStandardMaterial).color.set(color);
      });
      root.add(obj);
      const mixer = new THREE.AnimationMixer(obj);
      const clips = new Map<string, THREE.AnimationAction>();
      for (const c of gltf.animations) clips.set(c.name.toLowerCase(), mixer.clipAction(c));
      clips.get('idle')?.play();
      return { rig: null, poses: new Map(), props: [], root, headY: H * 0.8, mixer, clips };
    } catch {
      return null;
    }
  }

  private clearScene(): void {
    if (this.set) this.scene.remove(this.set.group);
    if (this.actor) this.scene.remove(this.actor.root);
    const dispose = (o: THREE.Object3D) =>
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.geometry && !(m as THREE.SkinnedMesh).isSkinnedMesh) m.geometry.dispose();
      });
    if (this.set) dispose(this.set.group);
    this.set = null;
    this.actor = null;
    this.civId = '';
  }

  private currentPose(): SolvedPose {
    const out: SolvedPose = new Map();
    for (const [n, b] of this.actor?.rig?.bones ?? []) out.set(n, b.quaternion.clone());
    return out;
  }

  private goTo(pose: string): void {
    this.from = this.currentPose();
    this.target = pose;
    this.tStart = performance.now();
  }

  private next(now: number): void {
    const step = this.queue.shift();
    if (!step) {
      this.gesture = null;
      this.goTo(IDLE[this.mood]);
      this.stepEnd = Infinity;
      return;
    }
    this.goTo(step[0]);
    this.stepEnd = now + step[1] * 1000;
  }

  private start(): void {
    if (this.raf) return;
    const loop = () => {
      if (!this.canvas.isConnected) {
        this.raf = 0;
        return;
      }
      this.resize();
      this.update(performance.now());
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const pr = this.renderer.getPixelRatio();
    if (this.canvas.width !== Math.floor(w * pr) || this.canvas.height !== Math.floor(h * pr)) this.renderer.setSize(w, h, false);
  }

  private last = 0;

  private update(now: number): void {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0.016;
    this.last = now;
    const a = this.actor;
    const t = (now - this.shown) / 1000;
    if (a?.rig) {
      if (this.queue.length || this.gesture) if (now >= this.stepEnd) this.next(now);
      const k = ease((now - this.tStart) / 380);
      const g = this.gesture;
      const gt = (now - this.gestureStart) / 1000;
      const breath = Math.sin(t * 1.7);
      const add: Record<string, [number, number, number]> = {
        Torso: [breath * 1.4, Math.sin(t * 0.37) * 2, 0],
        Head: [Math.sin(t * 0.61) * 2.5, Math.sin(t * 0.43) * 6, Math.sin(t * 0.29) * 2],
      };
      if (g === 'angry') add.Head[1] += Math.sin(gt * 22) * 9 * Math.max(0, 1 - gt / 1.2);
      if (g === 'nod' || g === 'happy') add.Head[0] += Math.sin(gt * 9) * 7 * Math.max(0, 1 - gt / 0.9);
      setPose(a.rig, this.from, a.poses.get(this.target) ?? this.from, k, add);
      a.root.position.y = (g === 'happy' ? Math.abs(Math.sin(gt * 7)) * 0.03 * Math.max(0, 1 - gt / 1.2) : 0) + breath * 0.004;
      a.rig.object.updateMatrixWorld(true);
      for (const p of a.props) {
        p.visible = !this.bust;
        const hand = a.rig.jointWorld(p.userData.hand as string);
        const elbow = a.rig.jointWorld('LowerArm_R');
        if (hand && elbow) {
          p.position.copy(hand);
          p.position.x -= 0.07; // um pouco para fora, sem cobrir o rosto
          const dir = hand.clone().sub(elbow).normalize();
          // segura na vertical, inclinando um pouco com o antebraço
          p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dir.x * 0.35, 1, dir.z * 0.35 + 0.1).normalize());
        }
      }
    }
    a?.mixer?.update(dt);
    // luzes do fogo
    for (const [i, l] of (this.set?.flames ?? []).entries()) l.intensity = 2.6 + Math.sin(now / 90 + i * 2) * 0.4 + Math.sin(now / 37 + i) * 0.3;
    for (const [i, o] of (this.set?.sway ?? []).entries()) o.rotation.z = Math.sin(now / 1400 + i) * 0.03;
    // guerra: luz de contorno avermelhada e tremor
    this.war = Math.max(0, this.war - dt * 0.25);
    const civ = CIV_BY_ID[this.civId];
    this.rim.color.set(this.set?.rim ?? '#ffffff').lerp(new THREE.Color('#ff2a1a'), Math.min(1, this.war * 1.5));
    this.rim.intensity = 2.5 + this.war * 4;
    this.fill.intensity = 0.6 * (1 - this.war * 0.6);
    void civ;
    this.placeCamera(t, now);
  }

  private placeCamera(t: number, now: number): void {
    const w = this.canvas.width || 1;
    const h = this.canvas.height || 1;
    const cam = this.camera;
    cam.aspect = w / h;
    // enquadramento: corpo inteiro até a cintura (diálogo) ou busto (retrato)
    const look = this.bust ? (this.actor?.headY ?? 1.35) - 0.05 : 1.08;
    const span = this.bust ? 1.05 : 1.9 * Math.max(1, 0.75 / Math.min(1, cam.aspect));
    let dist = span / (2 * Math.tan((cam.fov * Math.PI) / 360));
    if (!this.bust) dist *= 1.05 - 0.05 * ease(t / 6);
    const shake = this.war > 0.5 ? (this.war - 0.5) * 0.04 : 0;
    cam.position.set(this.bust ? 0.25 : Math.sin(t * 0.13) * 0.08 + Math.sin(now / 23) * shake, look + (this.bust ? 0.05 : 0.18), dist);
    cam.lookAt(0, look, 0);
    cam.setViewOffset(w, h, (0.5 - this.frameX) * w, (0.5 - this.frameY) * h, w, h);
    cam.updateProjectionMatrix();
    this.key.target.position.set(0, 1, 0);
  }
}

let stage: LeaderStage | null = null;

/** Palco compartilhado (um só contexto WebGL). Sem WebGL2 → null. */
export function leaderStage(): LeaderStage | null {
  if (stage) return stage;
  try {
    const c = document.createElement('canvas');
    if (!c.getContext('webgl2')) return null;
    stage = new LeaderStage();
    return stage;
  } catch {
    return null;
  }
}
