import * as THREE from 'three';

/**
 * Personagens com esqueleto para as telas de líder (gerados por scripts/convert-leaders.py
 * em public/leaders/leaders.{bin,json}). Cada modelo vira um `THREE.SkinnedMesh` com os
 * ossos da Quaternius; as poses são rotações extras (graus, ordem Z·Y·X como no conversor)
 * aplicadas sobre a pose de repouso, interpoladas por esfera (sem encolher braços).
 */

export interface LeaderModelData {
  offset: number;
  count: number;
  indexOffset: number;
  indexCount: number;
  index32: boolean;
  min: [number, number, number];
  max: [number, number, number];
  joints: string[];
  parents: number[];
  rest: number[][];
  inverseBind: number[][];
  root: number[];
  upZ: boolean;
}

export interface LeaderManifest {
  stride: number;
  models: Record<string, LeaderModelData>;
}

export interface LeaderAsset {
  data: LeaderModelData;
  position: Float32Array;
  color: Uint8Array;
  flag: Uint8Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  index: Uint16Array | Uint32Array;
}

export type LeaderPack = Map<string, LeaderAsset>;

/** Pose: rotação extra (graus x, y, z) por articulação. */
export type Pose = Record<string, [number, number, number]>;

const srgb = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

export function decodeLeaders(manifest: LeaderManifest, buf: ArrayBuffer): LeaderPack {
  const out: LeaderPack = new Map();
  const dv = new DataView(buf);
  for (const [name, m] of Object.entries(manifest.models)) {
    const n = m.count;
    const position = new Float32Array(n * 3);
    const color = new Uint8Array(n * 3);
    const flag = new Uint8Array(n);
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      const o = m.offset + v * manifest.stride;
      for (let k = 0; k < 3; k++) {
        position[v * 3 + k] = m.min[k] + ((dv.getInt16(o + k * 2, true) + 32767) / 65534) * (m.max[k] - m.min[k]);
        color[v * 3 + k] = dv.getUint8(o + 6 + k);
      }
      flag[v] = dv.getUint8(o + 9);
      for (let k = 0; k < 4; k++) {
        skinIndex[v * 4 + k] = dv.getUint8(o + 10 + k);
        skinWeight[v * 4 + k] = dv.getUint8(o + 14 + k) / 255;
      }
    }
    const index = m.index32 ? new Uint32Array(m.indexCount) : new Uint16Array(m.indexCount);
    for (let i = 0; i < m.indexCount; i++) index[i] = m.index32 ? dv.getUint32(m.indexOffset + i * 4, true) : dv.getUint16(m.indexOffset + i * 2, true);
    out.set(name, { data: m, position, color, flag, skinIndex, skinWeight, index });
  }
  return out;
}

let loading: Promise<LeaderPack | null> | null = null;

export function loadLeaders(base = './leaders/'): Promise<LeaderPack | null> {
  loading ??= (async () => {
    try {
      const [mr, br] = await Promise.all([fetch(base + 'leaders.json'), fetch(base + 'leaders.bin')]);
      if (!mr.ok || !br.ok) return null;
      return decodeLeaders(await mr.json(), await br.arrayBuffer());
    } catch {
      return null;
    }
  })();
  return loading;
}

export interface Rig {
  /** Objeto a pôr na cena (já com a matriz raiz do esqueleto). */
  object: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  bones: Map<string, THREE.Bone>;
  rest: Map<string, THREE.Quaternion>;
  /** Altura do modelo (unidades do arquivo). */
  height: number;
  /** Posição de uma articulação em coordenadas de mundo. */
  jointWorld(name: string, target?: THREE.Vector3): THREE.Vector3 | null;
}

export interface RigColors {
  /** Cor da civilização (material "Main" ou listado em `team`). */
  team: string;
  /** Cor secundária (materiais em `second`). */
  second: string;
}

/** Monta o personagem com as cores da civilização assadas nos vértices. */
export function buildRig(asset: LeaderAsset, colors: RigColors): Rig {
  const { data } = asset;
  const team = new THREE.Color(colors.team);
  const second = new THREE.Color(colors.second);
  const n = data.count;
  const col = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const f = asset.flag[v];
    for (let k = 0; k < 3; k++) {
      const base = srgb(asset.color[v * 3 + k]);
      const t = k === 0 ? team.r : k === 1 ? team.g : team.b;
      const s = k === 0 ? second.r : k === 1 ? second.g : second.b;
      col[v * 3 + k] = f === 1 ? t : f === 3 ? s : f === 2 ? Math.min(1, base + 0.55) * t : base;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(asset.position, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(asset.skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(asset.skinWeight, 4));
  g.setIndex(new THREE.BufferAttribute(asset.index, 1));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.04 });
  const mesh = new THREE.SkinnedMesh(g, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const bones: THREE.Bone[] = data.joints.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    return b;
  });
  const rest = new Map<string, THREE.Quaternion>();
  const byName = new Map<string, THREE.Bone>();
  data.joints.forEach((name, i) => {
    const m = new THREE.Matrix4().fromArray(data.rest[i]);
    m.decompose(bones[i].position, bones[i].quaternion, bones[i].scale);
    rest.set(name, bones[i].quaternion.clone());
    byName.set(name, bones[i]);
    const p = data.parents[i];
    if (p >= 0) bones[p].add(bones[i]);
    else mesh.add(bones[i]);
  });
  const inverses = data.inverseBind.map((a) => new THREE.Matrix4().fromArray(a));
  mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
  const object = new THREE.Group();
  const root = new THREE.Matrix4().fromArray(data.root);
  if (data.upZ) root.premultiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(root);
  object.add(mesh);
  const box = new THREE.Box3(new THREE.Vector3(...data.min), new THREE.Vector3(...data.max)).applyMatrix4(root);
  const height = box.max.y - box.min.y;
  return {
    object,
    mesh,
    bones: byName,
    rest,
    height,
    jointWorld(name, target = new THREE.Vector3()) {
      const b = byName.get(name);
      if (!b) return null;
      object.updateMatrixWorld(true);
      return b.getWorldPosition(target);
    },
  };
}

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const DEG = Math.PI / 180;

/**
 * Pose descrita no espaço do personagem (x = esquerda dele, y = cima, z = frente):
 * `aim` aponta um osso (até o primeiro filho) numa direção; `rot` gira um osso (graus,
 * ordem Z·Y·X) sobre o que já está. Resolvida uma vez por personagem (`solvePose`).
 */
export interface PoseSpec {
  aim?: Record<string, [number, number, number]>;
  rot?: Record<string, [number, number, number]>;
}

/** Pose resolvida: quaternion local por osso. */
export type SolvedPose = Map<string, THREE.Quaternion>;

/** Resolve a pose (ossos em ordem pai → filho), sem alterar o esqueleto. */
export function solvePose(rig: Rig, spec: PoseSpec): SolvedPose {
  const out: SolvedPose = new Map();
  const saved = new Map<string, THREE.Quaternion>();
  for (const [n, b] of rig.bones) {
    saved.set(n, b.quaternion.clone());
    b.quaternion.copy(rig.rest.get(n)!);
  }
  const obj = rig.object;
  const prevQ = obj.quaternion.clone();
  const prevP = obj.position.clone();
  const prevS = obj.scale.clone();
  const parent = obj.parent;
  parent?.remove(obj);
  obj.position.set(0, 0, 0);
  obj.quaternion.identity();
  obj.scale.set(1, 1, 1);
  obj.updateMatrixWorld(true);
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();
  const want = new THREE.Vector3();
  const wq = new THREE.Quaternion();
  const pq = new THREE.Quaternion();
  for (const [n, b] of rig.bones) {
    const r = spec.rot?.[n];
    const d = spec.aim?.[n];
    if (r) b.quaternion.multiply(tmpQ.setFromEuler(tmpE.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'ZYX')));
    if (d) {
      const child = b.children.find((k) => (k as THREE.Bone).isBone);
      if (child) {
        b.updateMatrixWorld(true);
        b.getWorldPosition(a);
        child.getWorldPosition(c);
        const cur = c.sub(a).normalize();
        want.set(d[0], d[1], d[2]).normalize();
        const delta = new THREE.Quaternion().setFromUnitVectors(cur, want);
        b.getWorldQuaternion(wq);
        wq.premultiply(delta);
        (b.parent as THREE.Object3D).getWorldQuaternion(pq);
        b.quaternion.copy(pq.invert().multiply(wq));
      }
    }
    b.updateMatrixWorld(true);
    out.set(n, b.quaternion.clone());
  }
  for (const [n, b] of rig.bones) b.quaternion.copy(saved.get(n)!);
  obj.position.copy(prevP);
  obj.quaternion.copy(prevQ);
  obj.scale.copy(prevS);
  parent?.add(obj);
  obj.updateMatrixWorld(true);
  return out;
}

/**
 * Pose final = interpolação esférica de `a` até `b` (fração `t`) mais uma camada aditiva
 * pequena (`add`, graus: respiração, olhar…).
 */
export function setPose(rig: Rig, a: SolvedPose, b: SolvedPose, t: number, add?: Record<string, [number, number, number]>): void {
  const q = new THREE.Quaternion();
  for (const [name, bone] of rig.bones) {
    q.copy(a.get(name) ?? rig.rest.get(name)!);
    if (t > 0) q.slerp(b.get(name) ?? rig.rest.get(name)!, Math.min(1, t));
    const r = add?.[name];
    if (r) q.multiply(tmpQ.setFromEuler(tmpE.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'ZYX')));
    bone.quaternion.copy(q);
  }
}
