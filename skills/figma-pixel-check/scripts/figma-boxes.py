"""Boxes of the nodes inside a Figma frame, relative to the frame, from saved get_metadata XML.

Usage:
  python3 figma-boxes.py <node-id> [max-depth] [--xml FILE]   tree of boxes (default depth 4)
  python3 figma-boxes.py <node-id> --sections [--xml FILE]    sections/<id>.json skeleton from the direct children

FILE defaults to design/figma/figma-metadata.xml. Child x/y in the XML are relative to the parent, so the
boxes printed here are summed up to the requested frame, which is what sections/<id>.json needs.
"""
import json
import math
import re
import signal
import sys
import xml.etree.ElementTree as ET


def main(argv):
    if hasattr(signal, 'SIGPIPE'):
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)  # quiet exit when piped into head
    args = list(argv)
    xml_file = 'design/figma/figma-metadata.xml'
    if '--xml' in args:
        i = args.index('--xml')
        xml_file = args[i + 1]
        del args[i:i + 2]
    sections = '--sections' in args
    args = [a for a in args if a != '--sections']
    if not args:
        sys.exit(__doc__)
    target = args[0].replace('-', ':')
    depth = int(args[1]) if len(args) > 1 else 4

    root = ET.fromstring(open(xml_file, encoding='utf-8').read())
    node = next((n for n in root.iter() if n.attrib.get('id') == target), None)
    if node is None:
        sys.exit(f'Node {target} not found in {xml_file}')

    if sections:
        print(json.dumps(skeleton(node), ensure_ascii=False, indent=2))
        return
    for child in node:
        walk(child, 0, 0, 1, depth)


def box(n, ox=0.0, oy=0.0):
    a = n.attrib
    return (ox + float(a.get('x', 0)), oy + float(a.get('y', 0)),
            float(a.get('width', 0)), float(a.get('height', 0)))


def walk(n, ox, oy, d, depth):
    x, y, w, h = box(n, ox, oy)
    print(f"{'  ' * (d - 1)}{n.tag[:4]} {n.attrib.get('id', ''):<22} {n.attrib.get('name', '')[:40]:<40} "
          f"x={x:7.1f} y={y:7.1f} w={w:6.1f} h={h:6.1f}")
    if d < depth:
        for c in n:
            walk(c, x, y, d + 1, depth)


def snap(start, size):
    """Whole-pixel start and size of a box with fractional edges: each edge is rounded half up, as in Chromium."""
    first = math.floor(start + 0.5)
    return first, math.floor(start + size + 0.5) - first


def slug(text, fallback):
    s = re.sub(r'[^\w]+', '-', text.strip().lower()).strip('-_')
    return s or fallback


def skeleton(frame):
    """Direct children as horizontal bands, top to bottom. Rename and merge them to match the markup."""
    _, _, width, height = box(frame)
    children = sorted((box(c) + (c.attrib.get('name', ''),) for c in frame), key=lambda b: b[1])
    names = {}
    sections = []
    for i, (_, y, _, h, name) in enumerate(children):
        base = slug(name, f'section-{i}')
        names[base] = names.get(base, 0) + 1
        top, height_px = snap(y, h)
        sections.append({
            'name': base if names[base] == 1 else f'{base}-{names[base]}',
            'top': top,
            'height': height_px,
        })
    width_px = math.floor(width + 0.5)
    return {
        'node': frame.attrib.get('id'),
        'reference': f"{slug(frame.attrib.get('name', ''), 'screen')}-{width_px}.png",
        'width': width_px,
        'height': math.floor(height + 0.5),
        'sections': sections,
    }


if __name__ == '__main__':
    main(sys.argv[1:])
