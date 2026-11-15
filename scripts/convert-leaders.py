#!/usr/bin/env python3
"""
Converte personagens da Quaternius (CC0, OpenUSD texto) em malhas COM ESQUELETO para os
líderes: public/leaders/leaders.bin + leaders.json. Diferente de convert-usda.py (que grava
triângulos já posados), aqui a malha é indexada e guarda até 4 articulações/pesos por
vértice; as poses e animações são feitas em tempo real (three.js SkinnedMesh).

Uso: python3 scripts/convert-leaders.py <pasta-dos-modelos-quaternius> scripts/leaders.json

Vértice (18 bytes): int16 x, y, z (quantizados na caixa) + uint8 r, g, b (sRGB) + uint8
flag (1 = cor da civilização, 2 = tingido, 3 = cor secundária) + uint8 j0..j3 + uint8 w0..w3
(pesos/255). Índices: uint16 (ou uint32 se `index32`). Articulações: nome, pai e matriz de
repouso local (16 números, coluna principal) + inversa da matriz de ligação.
"""
import importlib.util
import json
import re
import struct
import sys
from pathlib import Path

spec_ = importlib.util.spec_from_file_location('cu', Path(__file__).with_name('convert-usda.py'))
cu = importlib.util.module_from_spec(spec_)
spec_.loader.exec_module(cu)


def col_major(m):
    return [m[r][c] for c in range(4) for r in range(4)]


def convert(path, team, tint, second, recolor, hide=()):
    text = Path(path).read_text()
    prims = cu.parse_prims(text)
    materials = {}
    for p in prims:
        if p.kind == 'Material':
            body = text[p.s:p.e]
            c = re.search(r'inputs:diffuseColor\s*=\s*\((' + cu.NUM + r'),\s*(' + cu.NUM + r'),\s*(' + cu.NUM + r')\)', body)
            materials[p.path()] = (p.name, tuple(float(x) for x in c.groups()) if c else (0.6, 0.6, 0.6))
    sk = next(q for q in prims if q.kind == 'Skeleton')
    sb = cu.own_text(text, sk)
    joints = re.findall(r'"([^"]+)"', cu.attr_array(sb, 'uniform token[] joints') or '')
    bind = cu.matrices(cu.attr_array(sb, 'uniform matrix4d[] bindTransforms') or '')
    rest = cu.matrices(cu.attr_array(sb, 'uniform matrix4d[] restTransforms') or '')

    def world(p):
        m = cu.ident()
        chain = []
        q = p
        while q:
            chain.append(q)
            q = q.parent
        for q in reversed(chain):
            m = cu.mat_mul(m, cu.local_xform(cu.own_text(text, q)))
        return m

    skw = world(sk)
    skw_inv = cu.inverse(skw)
    body_j = next((i for i, j in enumerate(joints) if j.endswith('Body')), 0)
    verts = []  # (pos, rgb, flag, joints4, weights4)
    keys = {}
    index = []
    for mi, p in enumerate(prims):
        if p.kind != 'Mesh':
            continue
        body = cu.own_text(text, p)
        pts = cu.tuples(cu.attr_array(body, 'point3f[] points') or '', 3)
        counts = cu.ints(cu.attr_array(body, 'int[] faceVertexCounts') or '')
        idx = cu.ints(cu.attr_array(body, 'int[] faceVertexIndices') or '')
        if not pts or not counts:
            continue
        ji = cu.attr_array(body, 'int[] primvars:skel:jointIndices')
        if ji:
            jidx = cu.ints(ji)
            jw = [float(v) for v in re.findall(cu.NUM, cu.attr_array(body, 'float[] primvars:skel:jointWeights') or '')]
            es = len(jidx) // len(pts)
            gb = re.search(r'matrix4d primvars:skel:geomBindTransform\s*=\s*(\([^\n]*\))', body)
            g = cu.matrices(gb.group(1))[0] if gb else cu.ident()
            # índices locais da malha → índices do esqueleto (skel:joints da malha, se houver)
            mj = re.search(r'uniform token\[\] skel:joints\s*=\s*\[([^\]]*)\]', body)
            remap = [joints.index(j) for j in re.findall(r'"([^"]+)"', mj.group(1))] if mj else None
            P = [cu.apply(g, q) for q in pts]
            infl = []
            for vi in range(len(pts)):
                pairs = [(jw[vi * es + k], jidx[vi * es + k]) for k in range(es)]
                pairs = sorted([x for x in pairs if x[0] > 0], reverse=True)[:4]
                s = sum(w for w, _ in pairs) or 1
                pairs = [(w / s, remap[j] if remap else j) for w, j in pairs]
                infl.append(pairs)
        else:
            m = cu.mat_mul(skw_inv, world(p))
            P = [cu.apply(m, q) for q in pts]
            infl = [[(1.0, body_j)]] * len(pts)
        face_mat = [None] * len(counts)
        mb = re.search(r'rel material:binding\s*=\s*<([^>]+)>', body)
        default = mb.group(1) if mb else None
        for c in p.children:
            if c.kind != 'GeomSubset':
                continue
            cb = text[c.s:c.e]
            r = re.search(r'rel material:binding\s*=\s*<([^>]+)>', cb)
            for f in cu.ints(cu.attr_array(cb, 'int[] indices') or ''):
                if 0 <= f < len(face_mat) and r:
                    face_mat[f] = r.group(1)
        k = 0
        for f, n in enumerate(counts):
            vs = idx[k:k + n]
            k += n
            name, col = materials.get(face_mat[f] or default, ('?', (0.6, 0.6, 0.6)))
            if name in hide:
                continue
            if name in recolor:
                col = recolor[name]
            flag = 1 if name in team else 3 if name in second else 2 if name in tint else 0
            rgb = tuple(round(cu.to_srgb(c) * 255) for c in col)
            ids = []
            for v in vs:
                key = (mi, v, rgb, flag)
                if key not in keys:
                    keys[key] = len(verts)
                    verts.append((P[v], rgb, flag, infl[v]))
                ids.append(keys[key])
            for t in range(1, n - 1):
                index += [ids[0], ids[t], ids[t + 1]]
    names = [j.split('/')[-1] for j in joints]
    parents = [joints.index(j.rsplit('/', 1)[0]) if '/' in j else -1 for j in joints]
    return verts, index, {
        'joints': names,
        'parents': parents,
        'rest': [[round(x, 6) for x in col_major(m)] for m in rest],
        'inverseBind': [[round(x, 6) for x in col_major(cu.inverse(m))] for m in bind],
        'root': [round(x, 6) for x in col_major(skw)],
        'upZ': re.search(r'upAxis\s*=\s*"Z"', text) is not None,
    }


def main():
    src = Path(sys.argv[1])
    spec = json.loads(Path(sys.argv[2]).read_text())
    out = Path('public/leaders')
    out.mkdir(parents=True, exist_ok=True)
    blob = bytearray()
    manifest = {}
    for name, m in spec.items():
        if name.startswith('_'):
            continue
        verts, index, skel = convert(src / m['file'], set(m.get('team', [])), set(m.get('tint', [])),
                                     set(m.get('second', [])), {k: tuple(v) for k, v in m.get('recolor', {}).items()},
                                     set(m.get('hide', [])))
        lo = [min(v[0][i] for v in verts) for i in range(3)]
        hi = [max(v[0][i] for v in verts) for i in range(3)]
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        for (p, rgb, flag, infl) in verts:
            q = [round((p[i] - lo[i]) / ((hi[i] - lo[i]) or 1) * 65534 - 32767) for i in range(3)]
            js = [j for _, j in infl] + [0] * (4 - len(infl))
            ws = [round(w * 255) for w, _ in infl] + [0] * (4 - len(infl))
            ws[0] += 255 - sum(ws)
            blob += struct.pack('<3h3B1B4B4B', *q, *rgb, flag, *js, *ws)
        while len(blob) % 4:
            blob.append(0)
        ioff = len(blob)
        i32 = len(verts) > 65535
        blob += struct.pack(('<%dI' if i32 else '<%dH') % len(index), *index)
        manifest[name] = {'offset': off, 'count': len(verts), 'indexOffset': ioff, 'indexCount': len(index),
                          'index32': i32, 'min': lo, 'max': hi, **skel}
        print(f'{name}: {len(verts)} vértices, {len(index) // 3} triângulos')
    (out / 'leaders.bin').write_bytes(bytes(blob))
    (out / 'leaders.json').write_text(json.dumps({'stride': 18, 'models': manifest}, separators=(',', ':')))
    print(f'leaders.bin: {len(blob) / 1e6:.2f} MB, {len(manifest)} modelos')


if __name__ == '__main__':
    main()
