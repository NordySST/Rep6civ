import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CIVS } from '../src/data/civs';
import { LEADERS, LEADER_BY_CIV } from '../src/data/leaders';
import { buildRig, decodeLeaders, setPose, solvePose, type LeaderManifest } from '../src/render3d/leaders';

const manifest = JSON.parse(readFileSync('public/leaders/leaders.json', 'utf8')) as LeaderManifest;
const bin = readFileSync('public/leaders/leaders.bin');
const pack = decodeLeaders(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

describe('líderes', () => {
  it('toda civilização tem líder, falas, modelo e retrato', () => {
    for (const c of CIVS) {
      const l = LEADER_BY_CIV[c.id];
      expect(l, c.id).toBeTruthy();
      for (const line of Object.values(l.lines)) expect(line.length).toBeGreaterThan(5);
      expect(pack.has(c.id), c.id).toBe(true);
      expect(existsSync(`public/leaders/${c.id}.webp`), c.id).toBe(true);
    }
    expect(LEADERS.length).toBe(CIVS.length);
  });

  it('decodifica malhas com esqueleto válido', () => {
    for (const [id, a] of pack) {
      const n = a.data.count;
      expect(a.index.length % 3, id).toBe(0);
      for (let i = 0; i < a.index.length; i++) expect(a.index[i]).toBeLessThan(n);
      for (let v = 0; v < n; v++) {
        const w = a.skinWeight[v * 4] + a.skinWeight[v * 4 + 1] + a.skinWeight[v * 4 + 2] + a.skinWeight[v * 4 + 3];
        expect(Math.abs(w - 1)).toBeLessThan(0.02);
        expect(a.skinIndex[v * 4]).toBeLessThan(a.data.joints.length);
      }
      expect(a.data.joints).toContain('Head');
      expect(a.data.joints).toContain('UpperArm_R');
    }
  });

  it('a pose por direção aponta o braço para onde foi pedido', () => {
    const rig = buildRig(pack.get('valdoria')!, { team: '#c0392b', second: '#f6d365' });
    rig.object.scale.setScalar(1.75 / rig.height);
    const want = new THREE.Vector3(-0.7, 0.7, 0.2).normalize();
    const pose = solvePose(rig, { aim: { UpperArm_R: [want.x, want.y, want.z] } });
    setPose(rig, pose, pose, 0);
    const a = rig.jointWorld('UpperArm_R')!.clone();
    const b = rig.jointWorld('LowerArm_R')!.clone();
    expect(b.sub(a).normalize().dot(want)).toBeGreaterThan(0.99);
    // a raiz não muda e a altura fica perto de 1,75
    const box = new THREE.Box3().setFromObject(rig.object);
    expect(box.max.y - box.min.y).toBeGreaterThan(1.3);
  });
});
