#!/usr/bin/env python3
"""Read-only GLB fleet audit. Python standard library only.

Usage: python model_audit.py --assets-root PATH --output-dir PATH
"""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import struct
from collections import Counter


COMPONENT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2),
             5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
SHAPE = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4,
         'MAT2': 4, 'MAT3': 9, 'MAT4': 16}


def load_glb(path):
    with path.open('rb') as f:
        head = f.read(12)
        if len(head) != 12 or head[:4] != b'glTF':
            raise ValueError('Not a binary glTF file')
        magic, version, length = struct.unpack('<4sII', head)
        if version != 2 or length != path.stat().st_size:
            raise ValueError('Invalid GLB header/version/length')
        chunks = []
        while f.tell() < length:
            h = f.read(8)
            if len(h) != 8:
                raise ValueError('Truncated chunk header')
            size, kind = struct.unpack('<I4s', h)
            data = f.read(size)
            if len(data) != size:
                raise ValueError('Truncated chunk')
            chunks.append((kind, data))
    js = next((d for t, d in chunks if t == b'JSON'), None)
    if js is None:
        raise ValueError('GLB JSON chunk missing')
    return json.loads(js), next((d for t, d in chunks if t == b'BIN\x00'), b'')


def accessor_values(doc, binary, accessor_id):
    a = doc['accessors'][accessor_id]
    if 'sparse' in a:
        raise ValueError('Sparse accessors unsupported in connectivity audit')
    if 'bufferView' not in a:
        raise ValueError('Accessor without bufferView unsupported')
    view = doc['bufferViews'][a['bufferView']]
    if view.get('buffer', 0) != 0:
        raise ValueError('External GLB buffer unsupported')
    code, byte_size = COMPONENT[a['componentType']]
    width = SHAPE[a['type']]
    stride = view.get('byteStride', width * byte_size)
    if stride < width * byte_size:
        raise ValueError('Invalid accessor stride')
    start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    fmt = '<' + code * width
    result = []
    for i in range(a['count']):
        offset = start + stride * i
        if offset + width * byte_size > len(binary):
            raise ValueError('Accessor exceeds binary buffer')
        result.append(struct.unpack_from(fmt, binary, offset))
    return result


class DSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.size = [1] * n

    def root(self, i):
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def union(self, a, b):
        x, y = self.root(a), self.root(b)
        if x != y:
            if self.size[x] < self.size[y]:
                x, y = y, x
            self.parent[y] = x
            self.size[x] += self.size[y]


def inspect_primitive(doc, binary, primitive):
    position_id = primitive.get('attributes', {}).get('POSITION')
    if position_id is None:
        return {'status': 'no_positions', 'triangles': 0}
    pos_accessor = doc['accessors'][position_id]
    count = pos_accessor['count']
    mode = primitive.get('mode', 4)
    if mode != 4:
        return {'status': 'unsupported_primitive_mode', 'mode': mode,
                'vertices': count, 'triangles': 0}
    positions = accessor_values(doc, binary, position_id)
    indices = ([v[0] for v in accessor_values(doc, binary, primitive['indices'])]
               if 'indices' in primitive else list(range(count)))
    if len(indices) % 3:
        raise ValueError('Triangle index count not divisible by three')
    dsu = DSU(count)
    used = set()
    for i in range(0, len(indices), 3):
        a, b, c = indices[i:i + 3]
        if min(a, b, c) < 0 or max(a, b, c) >= count:
            raise ValueError('Triangle index out of range')
        dsu.union(a, b)
        dsu.union(b, c)
        used.update((a, b, c))
    groups = Counter(dsu.root(i) for i in used)
    mins = [min(p[i] for p in positions) for i in range(3)] if positions else [0] * 3
    maxs = [max(p[i] for p in positions) for i in range(3)] if positions else [0] * 3
    return {'status': 'analyzed', 'vertices': count, 'triangles': len(indices) // 3,
            'islands': len(groups), 'largest_island_vertices': max(groups.values(), default=0),
            'unreferenced_vertices': count - len(used), 'local_bounds': {'min': mins, 'max': maxs},
            'material': primitive.get('material')}


def inspect(path, root):
    with path.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    info = {'path': path.relative_to(root).as_posix(), 'bytes': path.stat().st_size,
            'sha256': digest}
    try:
        doc, binary = load_glb(path)
        info.update({'nodes': len(doc.get('nodes', [])), 'meshes': len(doc.get('meshes', [])),
                     'materials': len(doc.get('materials', [])),
                     'textures': len(doc.get('textures', []))})
        primitives = []
        for mi, mesh in enumerate(doc.get('meshes', [])):
            for pi, primitive in enumerate(mesh.get('primitives', [])):
                try:
                    metrics = inspect_primitive(doc, binary, primitive)
                except (ValueError, KeyError, IndexError, struct.error) as exc:
                    metrics = {'status': 'unsupported', 'reason': str(exc)}
                primitives.append({'mesh': mi, 'primitive': pi, **metrics})
        info['primitives'] = primitives
        info['triangles'] = sum(p.get('triangles', 0) for p in primitives)
        info['analyzed_islands'] = sum(p.get('islands', 0) for p in primitives)
        info['analysis_complete'] = all(p['status'] == 'analyzed' for p in primitives)
        info['classification'] = ('D' if not info['analysis_complete'] or not primitives else
                                  'A_candidate' if info['analyzed_islands'] > 1 else 'C_candidate')
        info['caveats'] = ['Islands are per primitive (material seams can split physical objects).',
                           'Connectivity uses shared indices, not coincident welded coordinates.',
                           'Local bounds do not include node transforms or skinning.',
                           'A/C are topology triage, not verified semantic separability.']
    except (OSError, ValueError, KeyError, json.JSONDecodeError, struct.error) as exc:
        info.update({'classification': 'D', 'error': str(exc)})
    return info


def build_report(root):
    files = sorted(p for folder in ('source/ships', 'models/ships')
                   for p in (root / folder).rglob('*.glb'))
    models = [inspect(p, root) for p in files]
    by_stem = {}
    for m in models:
        stem = pathlib.Path(m['path']).stem.lower()
        for suffix in ('-optimized25k', '-optimized', '_optimized', '-lod0', '-lod1'):
            if stem.endswith(suffix):
                stem = stem[:-len(suffix)]
                break
        by_stem.setdefault(stem, []).append(m['path'])
    return {'schemaVersion': '0.1.0', 'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
            'assetsRoot': str(root), 'modelCount': len(models), 'models': models,
            'candidatePairs': {k: v for k, v in by_stem.items() if len(v) > 1},
            'warnings': ['Pairing is filename heuristic only; no provenance assertion.',
                         'No semantic segmentation, symmetry detection, AI inference or mesh cuts performed.',
                         'Candidate classes require human visual confirmation.']}


def markdown(report):
    lines = ['# Imperatus model audit', '', f"Generated: {report['generatedAt']}",
             f"Models scanned: {report['modelCount']}", '',
             '| Model | Nodes | Meshes | Triangles | Islands* | Triage |',
             '| --- | ---: | ---: | ---: | ---: | --- |']
    for m in report['models']:
        lines.append(f"| {m['path']} | {m.get('nodes', '-')} | {m.get('meshes', '-')} | "
                     f"{m.get('triangles', '-')} | {m.get('analyzed_islands', '-')} | "
                     f"{m['classification']} |")
    lines += ['', '*Islands are counted separately inside each GLB primitive, so material splits may inflate counts.',
              '', '## Candidate source/derivative name matches', '']
    for key, paths in report['candidatePairs'].items():
        lines.append(f"- {key}: {', '.join(paths)}")
    if not report['candidatePairs']:
        lines.append('- None detected by filename heuristic.')
    lines += ['', '## Limitations', ''] + [f'- {w}' for w in report['warnings']]
    lines += ['', 'Next: visually review representative A/C/D cases, compare original vs optimized topology,',
              'then benchmark guided and AI-assisted segmentation against those cases.', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets-root', type=pathlib.Path, required=True)
    parser.add_argument('--output-dir', type=pathlib.Path, required=True)
    args = parser.parse_args()
    root = args.assets_root.resolve(strict=True)
    out = args.output_dir.resolve()
    report = build_report(root)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'model-audit.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    (out / 'model-audit.md').write_text(markdown(report), encoding='utf-8')
    print(f"Audited {report['modelCount']} GLBs; reports: {out}")


if __name__ == '__main__':
    main()
