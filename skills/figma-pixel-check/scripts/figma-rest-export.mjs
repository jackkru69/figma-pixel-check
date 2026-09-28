#!/usr/bin/env node
// Figma's values and reference PNGs through the REST API, for when the plugin MCP (use_figma with
// figma-styles.js) is not at hand or a frame is too big for it: one request per frame, no 20 KB parts.
// Read-only. Writes the same files as the plugin route:
//   <dir>/styles/<name>.json          every node's values, as figma-styles.js exports them
//   <dir>/reference/<name>-<w>.png    the frame at 1x (with --png)
//   <dir>/sections/<name>.json        a sections skeleton from the frame's top-level layers (with --sections,
//                                     never over an existing file)
//
//   FIGMA_TOKEN=… node figma-rest-export.mjs <file-key> <node-id>[=<name>] [<node-id>[=<name>] …] [--dir design/figma] [--png] [--sections] [--skip-existing]
//   FIGMA_TOKEN=… node figma-rest-export.mjs <file-key> --ids-file frames.txt …     one <node-id>[=<name>] per line
//
// The token is a Figma personal access token with read access to the file (file_content:read). It is read
// from the environment only and never written anywhere.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.figma.com/v1';
const round = (value) => (typeof value === 'number' ? Math.round(value * 100) / 100 : value);
const SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');
const clean = (text) => (typeof text === 'string' ? text.replace(SEPARATORS, '\n') : text);
const hex = ({ r, g, b }) => `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

function paints(list) {
  if (!Array.isArray(list)) return null;
  return list
    .filter((paint) => paint.visible !== false)
    .map((paint) =>
      paint.type === 'SOLID'
        ? { type: 'SOLID', color: hex(paint.color), opacity: round((paint.opacity ?? 1) * (paint.color.a ?? 1)) }
        : paint.type.startsWith('GRADIENT_')
          ? {
              type: paint.type,
              opacity: round(paint.opacity ?? 1),
              stops: paint.gradientStops.map((stop) => ({ color: hex(stop.color), alpha: round(stop.color.a), position: round(stop.position) })),
            }
          : { type: paint.type },
    );
}

function lineHeight(style) {
  if (!style.lineHeightUnit || style.lineHeightUnit === 'INTRINSIC_%') return { unit: 'AUTO' };
  if (style.lineHeightUnit === 'PIXELS') return { unit: 'PIXELS', value: round(style.lineHeightPx) };
  return { unit: 'PERCENT', value: round(style.lineHeightPercentFontSize) };
}

/** The frame's nodes, from the REST document of the frame, in the format of figma-styles.js. */
export function nodesFromRest(frame) {
  const box = frame.absoluteBoundingBox;
  const nodes = [];
  const walk = (node, parentOpacity, parent) => {
    if (node.visible === false) return;
    const b = node.absoluteBoundingBox;
    const opacity = node.opacity ?? 1;
    const entry = {
      id: node.id,
      name: clean(node.name),
      type: node.type,
      x: b ? round(b.x - box.x) : null,
      y: b ? round(b.y - box.y) : null,
      width: b ? round(b.width) : null,
      height: b ? round(b.height) : null,
      opacity: round(opacity),
      effectiveOpacity: round(parentOpacity * opacity),
      fills: 'fills' in node ? paints(node.fills) : null,
      // The layer holding it (none at the frame's top level): which frames clip it.
      parent: parent ?? null,
    };
    const sizing = [node.layoutSizingHorizontal, node.layoutSizingVertical];
    if (sizing[0] && !(sizing[0] === 'FIXED' && sizing[1] === 'FIXED')) entry.sizing = sizing;
    if (node.layoutPositioning === 'ABSOLUTE') entry.layoutPositioning = 'ABSOLUTE';
    if (node.isMask) entry.isMask = true;
    if (node.type === 'TEXT') {
      const s = node.style ?? {};
      Object.assign(entry, {
        characters: clean(node.characters),
        fontFamily: s.fontFamily ?? null,
        fontStyle: s.fontStyle ?? null,
        fontWeight: s.fontWeight ?? null,
        fontSize: s.fontSize ?? null,
        lineHeight: lineHeight(s),
        // REST gives letter spacing in pixels.
        letterSpacing: { unit: 'PIXELS', value: round(s.letterSpacing ?? 0) },
        textCase: s.textCase ?? 'ORIGINAL',
      });
      if (s.textAlignHorizontal && s.textAlignHorizontal !== 'LEFT') entry.textAlign = s.textAlignHorizontal;
      if (s.textDecoration && s.textDecoration !== 'NONE') entry.textDecoration = s.textDecoration;
      entry.textAutoResize = s.textAutoResize ?? 'NONE';
      if (s.textTruncation === 'ENDING') entry.truncate = s.maxLines ?? true;
    } else {
      if ('cornerRadius' in node || 'rectangleCornerRadii' in node || ['FRAME', 'RECTANGLE', 'INSTANCE', 'COMPONENT'].includes(node.type)) {
        entry.radius = node.rectangleCornerRadii ?? node.cornerRadius ?? 0;
        if (node.cornerSmoothing) entry.cornerSmoothing = round(node.cornerSmoothing);
      }
      if ((node.strokes ?? []).some((paint) => paint.visible !== false)) {
        const w = node.individualStrokeWeights;
        entry.strokes = paints(node.strokes);
        entry.strokeAlign = node.strokeAlign;
        entry.strokeWeights = w ? [w.top, w.right, w.bottom, w.left] : [0, 1, 2, 3].map(() => node.strokeWeight ?? 1);
        if (node.strokeDashes?.length) entry.dashPattern = node.strokeDashes;
      }
      if ((node.effects ?? []).some((effect) => effect.visible !== false)) {
        entry.effects = node.effects
          .filter((effect) => effect.visible !== false)
          .map((effect) =>
            effect.type.endsWith('SHADOW')
              ? { type: effect.type, x: effect.offset.x, y: effect.offset.y, radius: effect.radius, spread: effect.spread ?? 0, color: hex(effect.color), alpha: round(effect.color.a) }
              : { type: effect.type, radius: effect.radius },
          );
      }
      if (node.layoutMode && node.layoutMode !== 'NONE') {
        Object.assign(entry, {
          layoutMode: node.layoutMode,
          primaryAxisAlignItems: node.primaryAxisAlignItems ?? 'MIN',
          counterAxisAlignItems: node.counterAxisAlignItems ?? 'MIN',
          itemSpacing: node.itemSpacing ?? 0,
          padding: [node.paddingTop ?? 0, node.paddingRight ?? 0, node.paddingBottom ?? 0, node.paddingLeft ?? 0],
        });
        if (node.layoutWrap === 'WRAP') entry.layoutWrap = 'WRAP';
        if (node.strokesIncludedInLayout) entry.strokesIncludedInLayout = true;
      }
      if (node.clipsContent) entry.clips = true;
    }
    for (const [key, value] of Object.entries(entry)) {
      if (value === null || (['opacity', 'effectiveOpacity'].includes(key) && value === 1) || (Array.isArray(value) && !value.length)) delete entry[key];
    }
    nodes.push(entry);
    for (const child of node.children ?? []) walk(child, parentOpacity * opacity, node.id);
  };
  for (const child of frame.children ?? []) walk(child, 1, null);
  return { frame: frame.id, name: clean(frame.name), width: round(box.width), height: round(box.height), total: nodes.length, next: null, nodes };
}

/** Horizontal bands from the frame's top-level layers: overlapping layers merge, gaps split at their middle. */
export function sectionsSkeleton(frame) {
  const box = frame.absoluteBoundingBox;
  const TOUCH = 2; // boxes that overlap by this much or less still count as side by side
  const slug = (name, i) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `section-${i + 1}`;
  const used = new Set();
  const named = (name, i) => {
    let unique = slug(name, i);
    while (used.has(unique)) unique += '-2';
    used.add(unique);
    return unique;
  };
  const merge = (list, from, to) => {
    const groups = [];
    for (const span of [...list].sort((a, b) => a[from] - b[from])) {
      const last = groups.at(-1);
      if (last && span[from] < last[to] - TOUCH) {
        last[to] = Math.max(last[to], span[to]);
        last.spans.push(span);
      } else groups.push({ name: span.name, [from]: span[from], [to]: span[to], spans: [span] });
    }
    return groups;
  };
  // Cut lines halfway between neighbours; the first and the last reach the area's edges.
  const cut = (groups, i, from, to, start, end) => ({
    start: i === 0 ? start : Math.round((groups[i - 1][to] + groups[i][from]) / 2),
    end: i === groups.length - 1 ? end : Math.round((groups[i][to] + groups[i + 1][from]) / 2),
  });
  const layout = (children, area, depth) => {
    const spans = (children ?? [])
      .filter((child) => child.visible !== false && child.absoluteBoundingBox && child.absoluteBoundingBox.height > 0)
      .map((child) => {
        const b = child.absoluteBoundingBox;
        return {
          name: child.name,
          node: child,
          left: Math.max(area.left, b.x - box.x),
          right: Math.min(area.right, b.x - box.x + b.width),
          top: Math.max(area.top, b.y - box.y),
          bottom: Math.min(area.bottom, b.y - box.y + b.height),
        };
      })
      .filter((span) => span.bottom > span.top && span.right > span.left);
    // A full-width bar (a header, a footer) that overlaps a panel's edge ends the panel there, so the overlap
    // does not hold the panel's row and the bar's together: when the bar is drawn above the panel (a later
    // sibling) it hides that part; when it is drawn below, only a small overlap (under half the bar) is cut.
    spans.forEach((span, i) => {
      spans.forEach((bar, j) => {
        if (bar === span || bar.left > area.left + TOUCH || bar.right < area.right - TOUCH) return;
        const bottomOverlap = span.bottom - bar.top;
        const topOverlap = bar.bottom - span.top;
        const allowed = (overlap) => j > i || overlap < (bar.bottom - bar.top) / 2;
        if (bar.top > span.top && bar.top < span.bottom && bar.bottom >= span.bottom - TOUCH && allowed(bottomOverlap)) span.bottom = bar.top;
        else if (bar.bottom < span.bottom && bar.bottom > span.top && bar.top <= span.top + TOUCH && allowed(topOverlap)) span.top = bar.bottom;
      });
    });
    const rows = merge(spans, 'top', 'bottom');
    return rows.flatMap((row, i) => {
      const { start: top, end: bottom } = cut(rows, i, 'top', 'bottom', area.top, area.bottom);
      const whole = [{ name: row.name, top, height: bottom - top }];
      // One container across most of the height that wraps panels side by side (an app's body under its
      // header): its own children are the layout. A landing page's section stays whole.
      if (row.spans.length === 1 && depth < 3 && bottom - top >= (area.bottom - area.top) / 2 && (row.spans[0].node.children?.length ?? 0) > 1) {
        const inner = layout(row.spans[0].node.children, { ...area, top, bottom }, depth + 1);
        if (inner.some((section) => 'left' in section)) return inner;
      }
      // A row of panels side by side (an app's sidebar, content and chat) becomes one region per column.
      const columns = row.spans.length > 1 ? merge(row.spans, 'left', 'right') : [];
      if (columns.length < 2) return whole;
      return columns.map((column, j) => {
        const { start: left, end: right } = cut(columns, j, 'left', 'right', area.left, area.right);
        return { name: column.name, top, height: bottom - top, left, width: right - left };
      });
    });
  };
  const sections = layout(frame.children, { top: 0, bottom: Math.round(box.height), left: 0, right: Math.round(box.width) }, 0);
  return sections.map((section, i) => ({ ...section, name: named(section.name, i) }));
}

// Rate limits (429) and Figma's occasional 5xx are retried with a growing pause; other errors stop the export.
async function get(path, token, tries = 5) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${API}${path}`, { headers: { 'X-Figma-Token': token } });
    if (response.ok) return response.json();
    const text = (await response.text()).slice(0, 200);
    if (attempt >= tries || !(response.status === 429 || response.status >= 500)) throw new Error(`Figma API ${response.status}: ${text}`);
    const wait = Number(response.headers.get('retry-after')) * 1000 || 5000 * attempt;
    console.error(`Figma API ${response.status}, retrying in ${Math.round(wait / 1000)} s`);
    await new Promise((done) => setTimeout(done, wait));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const token = process.env.FIGMA_TOKEN;
  const option = (flag) => args.includes(flag);
  const value = (flag) => (args.indexOf(flag) >= 0 ? args[args.indexOf(flag) + 1] : null);
  const dir = value('--dir') ?? 'design/figma';
  const valued = new Set(['--dir', '--ids-file'].map((flag) => args.indexOf(flag) + 1).filter((i) => i > 0));
  const positional = args.filter((arg, i) => !arg.startsWith('--') && !valued.has(i));
  const [fileKey, ...listed] = positional;
  const fromFile = value('--ids-file') ? readFileSync(value('--ids-file'), 'utf8').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')) : [];
  const targets = [...listed, ...fromFile];
  if (!token || !fileKey || !targets.length) {
    console.error('Usage: FIGMA_TOKEN=… node figma-rest-export.mjs <file-key> <node-id>[=<name>] … [--dir design/figma] [--png] [--sections]');
    process.exit(2);
  }
  // --skip-existing: frames whose styles file is already there are left out (to finish an interrupted export).
  const frames = targets.map((target) => {
    const [id, name] = target.split('=');
    const nodeId = id.replace('-', ':');
    return { nodeId, name: name ?? nodeId.replace(':', '-') };
  });
  for (const sub of ['styles', 'reference', 'sections']) mkdirSync(join(dir, sub), { recursive: true });
  if (option('--skip-existing')) frames.splice(0, frames.length, ...frames.filter((f) => !existsSync(join(dir, 'styles', `${f.name}.json`))));
  // A few frames per request: a whole page in one response can run to hundreds of megabytes.
  const BATCH = 4;
  for (let start = 0; start < frames.length; start += BATCH) {
    const batch = frames.slice(start, start + BATCH);
    const ids = encodeURIComponent(batch.map((f) => f.nodeId).join(','));
    const data = await get(`/files/${fileKey}/nodes?ids=${ids}`, token);
    const images = option('--png') ? (await get(`/images/${fileKey}?ids=${ids}&format=png&scale=1`, token)).images : {};
    await exportBatch(batch, data, images, dir, option);
  }
}

async function exportBatch(frames, data, images, dir, option) {
  for (const { nodeId, name } of frames) {
    const frame = data.nodes[nodeId]?.document;
    if (!frame) {
      console.error(`${nodeId}: not found`);
      continue;
    }
    const styles = nodesFromRest(frame);
    writeFileSync(join(dir, 'styles', `${name}.json`), `${JSON.stringify(styles, null, 1)}\n`);
    const width = Math.round(styles.width);
    let line = `${name}: ${styles.total} nodes`;
    if (images[nodeId]) {
      const png = Buffer.from(await (await fetch(images[nodeId])).arrayBuffer());
      writeFileSync(join(dir, 'reference', `${name}-${width}.png`), png);
      line += `, reference ${name}-${width}.png`;
    }
    const sectionsFile = join(dir, 'sections', `${name}.json`);
    if (option('--sections') && !existsSync(sectionsFile)) {
      const sections = sectionsSkeleton(frame);
      writeFileSync(sectionsFile, `${JSON.stringify({ node: nodeId, reference: `${name}-${width}.png`, width, height: Math.round(styles.height), sections }, null, 1)}\n`);
      line += `, ${sections.length} sections`;
    }
    console.log(line);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
