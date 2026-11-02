import * as THREE from 'three';

/**
 * Modelos 3D importados (Quaternius, CC0) — gerados por scripts/convert-usda.py em
 * public/models/pack.{bin,json}. Cada modelo vira duas geometrias com cores por vértice:
 * `neutral` e `team` (partes pintadas com a cor da civilização pelo material: "Main" em
 * branco puro; partes "tingidas", como a armadura, com a cor original como multiplicador).
 */

export interface PackModel {
  neutral: THREE.BufferGeometry | null;
  team: THREE.BufferGeometry | null;
  min: [number, number, number];
  max: [number, number, number];
  /** Pontos de encaixe (mãos, cabeça…) em coordenadas do modelo. */
  points: Record<string, [number, number, number]>;
}

export type Pack = Map<string, PackModel>;

interface Manifest {
  stride: number;
  models: Record<string, { offset: number; count: number; min: [number, number, number]; max: [number, number, number]; points?: Record<string, [number, number, number]> }>;
}

const srgb = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

export function decodePack(manifest: Manifest, buf: ArrayBuffer): Pack {
  const pack: Pack = new Map();
  const dv = new DataView(buf);
  for (const [name, m] of Object.entries(manifest.models)) {
    const n = [[], []] as number[][];
    const c = [[], []] as number[][];
    for (let v = 0; v < m.count; v++) {
      const o = m.offset + v * manifest.stride;
      const flag = dv.getUint8(o + 9);
      const bucket = flag ? 1 : 0;
      for (let k = 0; k < 3; k++) n[bucket].push(m.min[k] + ((dv.getInt16(o + k * 2, true) + 32767) / 65534) * (m.max[k] - m.min[k]));
      if (flag === 1) c[1].push(1, 1, 1);
      else {
        // tingido: clareia para a cor da civilização aparecer
        const lift = flag === 2 ? 0.55 : 0;
        for (let k = 0; k < 3; k++) {
          const x = srgb(dv.getUint8(o + 6 + k));
          c[bucket].push(lift ? Math.min(1, x + lift) : x);
        }
      }
    }
    const geo = (pos: number[], col: number[]) => {
      if (!pos.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      return g;
    };
    pack.set(name, { neutral: geo(n[0], c[0]), team: geo(n[1], c[1]), min: m.min, max: m.max, points: m.points ?? {} });
  }
  return pack;
}

let loading: Promise<Pack | null> | null = null;

/** Baixa o pacote uma vez (fica no cache do service worker para jogar offline). */
export function loadPack(base = './models/'): Promise<Pack | null> {
  loading ??= (async () => {
    try {
      const [mr, br] = await Promise.all([fetch(base + 'pack.json'), fetch(base + 'pack.bin')]);
      if (!mr.ok || !br.ok) return null;
      return decodePack(await mr.json(), await br.arrayBuffer());
    } catch {
      return null;
    }
  })();
  return loading;
}
