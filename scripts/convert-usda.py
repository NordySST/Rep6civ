#!/usr/bin/env python3
"""
Converte modelos OpenUSD em texto (.usda) da Quaternius (CC0) para o pacote compacto do
jogo: public/models/pack.bin + public/models/pack.json.

Uso: python3 scripts/convert-usda.py <pasta-dos-modelos-quaternius> scripts/models.json

Formato de cada vértice (triângulos sem índice): int16 x, y, z (quantizados na caixa do
modelo) + uint8 r, g, b (sRGB) + uint8 flag (1 = material "Main"/cor da equipe). Malhas com
esqueleto são lidas na pose de ligação (bind pose); opcionalmente um modelo pode pedir uma
pose simples (`pose`) que gira articulações por nome (ex.: braços para baixo).
"""
import json
import math
import re
import struct
import sys
from pathlib import Path

NUM = r'[-+0-9.eE]+'


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def ident():
    return [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]


def rot(axis, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    m = ident()
    if axis == 'x':
        m[1][1], m[1][2], m[2][1], m[2][2] = c, -s, s, c
    elif axis == 'y':
        m[0][0], m[0][2], m[2][0], m[2][2] = c, s, -s, c
    else:
        m[0][0], m[0][1], m[1][0], m[1][1] = c, -s, s, c
    return m


def apply(m, p):
    x, y, z = p
    return (
        m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
        m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
        m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3],
    )


def inverse(m):
    a = [row[:] + [1.0 if i == j else 0.0 for j in range(4)] for i, row in enumerate(m)]
    for c in range(4):
        piv = max(range(c, 4), key=lambda r: abs(a[r][c]))
        a[c], a[piv] = a[piv], a[c]
        d = a[c][c]
        a[c] = [x / d for x in a[c]]
        for r in range(4):
            if r != c:
                f = a[r][c]
                a[r] = [x - f * y for x, y in zip(a[r], a[c])]
    return [row[4:] for row in a]


def matrices(text):
    """Lista de matrizes 4×4 (USD: vetor-linha) convertidas para vetor-coluna."""
    vals = [float(v) for v in re.findall(NUM, text)]
    out = []
    for i in range(0, len(vals) - 15, 16):
        rows = [vals[i + 4 * r:i + 4 * r + 4] for r in range(4)]
        out.append([[rows[j][k] for j in range(4)] for k in range(4)])
    return out


def tuples(text, n):
    vals = [float(v) for v in re.findall(NUM, text)]
    return [tuple(vals[i:i + n]) for i in range(0, len(vals) - n + 1, n)]


def ints(text):
    return [int(v) for v in re.findall(r'-?\d+', text)]


def find_block(text, start, open_ch, close_ch):
    """Índice do fechamento correspondente a text[start] == open_ch."""
    depth = 0
    i = start
    in_str = False
    while i < len(text):
        ch = text[i]
        if ch == '"' and text[i - 1] != '\\':
            in_str = not in_str
        elif not in_str:
            if ch == open_ch:
                depth += 1
            elif ch == close_ch:
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return len(text) - 1


class Prim:
    def __init__(self, kind, name, body_start, body_end, parent):
        self.kind, self.name = kind, name
        self.s, self.e = body_start, body_end
        self.parent = parent
        self.children = []

    def path(self):
        return (self.parent.path() if self.parent else '') + '/' + self.name


def parse_prims(text):
    prims = []
    stack = []
    for m in re.finditer(r'def (\w+) "([^"]+)"', text):
        i = m.end()
        # metadados opcionais "( ... )" antes do corpo "{ ... }"
        j = i
        while j < len(text) and text[j] in ' \t\r\n':
            j += 1
        if j < len(text) and text[j] == '(':
            j = find_block(text, j, '(', ')') + 1
        k = text.index('{', j)
        end = find_block(text, k, '{', '}')
        while stack and stack[-1].e < m.start():
            stack.pop()
        parent = stack[-1] if stack else None
        p = Prim(m.group(1), m.group(2), k, end, parent)
        if parent:
            parent.children.append(p)
        prims.append(p)
        stack.append(p)
    return prims


def own_text(text, p):
    """Texto do corpo do prim sem os corpos dos filhos."""
    parts, cur = [], p.s + 1
    for c in sorted(p.children, key=lambda c: c.s):
        head = text.rfind('def ', cur, c.s)
        parts.append(text[cur:head if head >= 0 else c.s])
        cur = c.e + 1
    parts.append(text[cur:p.e])
    return ''.join(parts)


def attr_array(body, name):
    m = re.search(re.escape(name) + r'\s*=\s*\[', body)
    if not m:
        return None
    a = m.end() - 1
    b = find_block(body, a, '[', ']')
    return body[a + 1:b]


def local_xform(body):
    order = re.search(r'xformOpOrder\s*=\s*\[([^\]]*)\]', body)
    if not order:
        return ident()
    m = ident()
    for op in re.findall(r'"([^"]+)"', order.group(1)):
        if op.startswith('!invert!'):
            continue
        val = re.search(re.escape(op) + r'\s*=\s*(\([^\n]*\))', body)
        if not val:
            continue
        v = val.group(1)
        if op.startswith('xformOp:translate'):
            x, y, z = tuples(v, 3)[0]
            t = ident()
            t[0][3], t[1][3], t[2][3] = x, y, z
            m = mat_mul(m, t)
        elif op.startswith('xformOp:scale'):
            x, y, z = tuples(v, 3)[0]
            s = ident()
            s[0][0], s[1][1], s[2][2] = x, y, z
            m = mat_mul(m, s)
        elif op.startswith('xformOp:rotateXYZ'):
            x, y, z = tuples(v, 3)[0]
            m = mat_mul(m, mat_mul(rot('z', z), mat_mul(rot('y', y), rot('x', x))))
        elif op.startswith('xformOp:orient'):
            w, x, y, z = tuples(v, 4)[0]
            r = ident()
            r[0][0:3] = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)]
            r[1][0:3] = [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)]
            r[2][0:3] = [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]
            m = mat_mul(m, r)
        elif op.startswith('xformOp:transform'):
            rows = tuples(v, 4)
            # USD: linhas com vetor-linha; aqui usamos vetor-coluna (transposta)
            t = [[rows[j][i] for j in range(4)] for i in range(4)]
            m = mat_mul(m, t)
    return m


def to_srgb(c):
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


ATTACH = {}
TINT = set()
RECOLOR = {}
TEAM = set()


def convert(path, pose=None):
    text = Path(path).read_text()
    prims = parse_prims(text)
    up_z = re.search(r'upAxis\s*=\s*"Z"', text) is not None
    materials = {}
    for p in prims:
        if p.kind == 'Material':
            body = text[p.s:p.e]
            c = re.search(r'inputs:diffuseColor\s*=\s*\((' + NUM + r'),\s*(' + NUM + r'),\s*(' + NUM + r')\)', body)
            materials[p.path()] = (p.name, tuple(float(x) for x in c.groups()) if c else (0.6, 0.6, 0.6))

    def world(p):
        m = ident()
        chain = []
        q = p
        while q:
            chain.append(q)
            q = q.parent
        for q in reversed(chain):
            m = mat_mul(m, local_xform(own_text(text, q)))
        return m

    # esqueleto (para posar personagens): matrizes de pele por articulação
    skin = None
    if pose:
        sk = next((q for q in prims if q.kind == 'Skeleton'), None)
        if sk:
            sb = own_text(text, sk)
            joints = re.findall(r'"([^"]+)"', attr_array(sb, 'uniform token[] joints') or '')
            bind = matrices(attr_array(sb, 'uniform matrix4d[] bindTransforms') or '')
            rest = matrices(attr_array(sb, 'uniform matrix4d[] restTransforms') or '')
            posed = {}
            for i, j in enumerate(joints):
                local = rest[i]
                extra = pose.get(j.split('/')[-1])
                if extra:
                    rx, ry, rz = extra
                    local = mat_mul(local, mat_mul(rot('z', rz), mat_mul(rot('y', ry), rot('x', rx))))
                parent = j.rsplit('/', 1)[0] if '/' in j else None
                posed[j] = mat_mul(posed[parent], local) if parent in posed else local
            skin = {'mats': [mat_mul(posed[j], inverse(bind[i])) for i, j in enumerate(joints)], 'world': world(sk)}
            # pontos de encaixe (mãos, cabeça…) na pose final
            ATTACH.clear()
            for j in joints:
                ATTACH[j.split('/')[-1]] = apply(skin['world'], apply(posed[j], (0.0, 0.0, 0.0)))

    tris = []  # (p1, p2, p3, rgb, team)
    for p in prims:
        if p.kind != 'Mesh':
            continue
        body = own_text(text, p)
        pts = tuples(attr_array(body, 'point3f[] points') or '', 3)
        ji = attr_array(body, 'int[] primvars:skel:jointIndices')
        if skin and ji:
            jidx = ints(ji)
            jw = [float(v) for v in re.findall(NUM, attr_array(body, 'float[] primvars:skel:jointWeights') or '')]
            es = int(re.search(r'primvars:skel:jointIndices[^\n]*\n(?:[^\n]*\n)*?\s*elementSize = (\d+)', body[body.index('primvars:skel:jointIndices'):]).group(1)) if 'elementSize' in body else 1
            gb = re.search(r'matrix4d primvars:skel:geomBindTransform\s*=\s*(\([^\n]*\))', body)
            g = matrices(gb.group(1))[0] if gb else ident()
            out = []
            for vi, q in enumerate(pts):
                v = apply(g, q)
                acc = [0.0, 0.0, 0.0]
                for k in range(es):
                    w = jw[vi * es + k]
                    if w <= 0:
                        continue
                    r = apply(skin['mats'][jidx[vi * es + k]], v)
                    acc = [acc[i] + w * r[i] for i in range(3)]
                out.append(apply(skin['world'], tuple(acc)))
            pts = out
            mw = ident()
        else:
            mw = None
        counts = ints(attr_array(body, 'int[] faceVertexCounts') or '')
        idx = ints(attr_array(body, 'int[] faceVertexIndices') or '')
        if not pts or not counts:
            continue
        if mw is None:
            mw = world(p)
        wp = [apply(mw, q) for q in pts]
        face_mat = [None] * len(counts)
        mb = re.search(r'rel material:binding\s*=\s*<([^>]+)>', body)
        default = mb.group(1) if mb else None
        for c in p.children:
            if c.kind != 'GeomSubset':
                continue
            cb = text[c.s:c.e]
            ind = ints(attr_array(cb, 'int[] indices') or '')
            r = re.search(r'rel material:binding\s*=\s*<([^>]+)>', cb)
            for f in ind:
                if 0 <= f < len(face_mat) and r:
                    face_mat[f] = r.group(1)
        k = 0
        for f, n in enumerate(counts):
            vs = idx[k:k + n]
            k += n
            mat = face_mat[f] or default
            name, col = materials.get(mat, ('?', (0.6, 0.6, 0.6)))
            if name in RECOLOR:
                col = RECOLOR[name]
            team = 1 if name in ('Main', 'Main_Light') or name in TEAM else 2 if name in TINT else 0
            for t in range(1, n - 1):
                tris.append((wp[vs[0]], wp[vs[t]], wp[vs[t + 1]], col, team))
    # eixo Z para cima → Y para cima (o "root" da Quaternius já gira -90° em X; respeitamos o arquivo)
    if up_z:
        tris = [(*[(x, z, -y) for (x, y, z) in t[:3]], t[3], t[4]) for t in tris]
    return tris


def main():
    src = Path(sys.argv[1])
    spec = json.loads(Path(sys.argv[2]).read_text())
    out_dir = Path('public/models')
    out_dir.mkdir(parents=True, exist_ok=True)
    blob = bytearray()
    manifest = {}
    for name, info in spec.items():
        ATTACH.clear()
        TINT.clear()
        TINT.update(info.get('tint', []))
        TEAM.clear()
        TEAM.update(info.get('team', []))
        RECOLOR.clear()
        RECOLOR.update({k: tuple(v) for k, v in info.get('recolor', {}).items()})
        tris = convert(src / info['file'], info.get('pose'))
        if info.get('rot'):
            rx, ry, rz = info['rot']
            m = mat_mul(rot('z', rz), mat_mul(rot('y', ry), rot('x', rx)))
            tris = [(apply(m, a), apply(m, b), apply(m, c), col, team) for (a, b, c, col, team) in tris]
        if not tris:
            print('vazio:', name)
            continue
        xs = [v[0] for t in tris for v in t[:3]]
        ys = [v[1] for t in tris for v in t[:3]]
        zs = [v[2] for t in tris for v in t[:3]]
        lo = (min(xs), min(ys), min(zs))
        hi = (max(xs), max(ys), max(zs))
        span = [max(1e-6, hi[i] - lo[i]) for i in range(3)]
        off = len(blob)
        for (a, b, c, col, team) in tris:
            rgb = [int(round(to_srgb(x) * 255)) for x in col]
            for v in (a, b, c):
                q = [int(round((v[i] - lo[i]) / span[i] * 65534 - 32767)) for i in range(3)]
                blob += struct.pack('<hhhBBBB', *q, *rgb, team)
        manifest[name] = {'offset': off, 'count': len(tris) * 3, 'min': lo, 'max': hi}
        if info.get('attach'):
            manifest[name]['points'] = {k: [round(c, 4) for c in ATTACH[k]] for k in info['attach'] if k in ATTACH}
        print(f'{name:28s} {len(tris):6d} triângulos  {hi[0]-lo[0]:.2f}×{hi[1]-lo[1]:.2f}×{hi[2]-lo[2]:.2f}')
    (out_dir / 'pack.bin').write_bytes(bytes(blob))
    (out_dir / 'pack.json').write_text(json.dumps({'stride': 10, 'models': manifest}, indent=0))
    print(f'pack.bin: {len(blob) / 1e6:.2f} MB, {len(manifest)} modelos')


if __name__ == '__main__':
    main()
