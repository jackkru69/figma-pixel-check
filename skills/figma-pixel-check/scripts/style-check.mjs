/* global CSS, document, getComputedStyle, Node, SVGElement -- used inside page.evaluate callbacks that run in the browser */
// Style check for pixel-diff.mjs: Figma's own values (styles/<id>.json, exported with figma-styles.js through
// use_figma) against the computed styles of the page. Pixels cannot see a wrong font weight, a 12 → 8 radius
// or a neighbouring text colour; the values can.
//
// Figma text nodes are found by their text inside their section (the n-th equal text for the n-th node);
// any other node through data-node-id="<id>" on its element, as get_design_context writes it (one element may
// list several ids, space-separated). Auto Layout gap and padding are compared with where the children
// actually are, so margins, gap or padding all count as long as the result is the same.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Differences smaller than these are rounding, not a mistake.
const PX = 0.5;
const SIZE = 1;
const SPACING = 0.75;
const LETTER = 0.1;
const COLOR = 2; // CIELAB ΔE76
const ALPHA = 0.02;

/** The Figma nodes of a screen, each in the smallest section that holds its box (or its centre). */
export function readFigmaStyles(dir, id, sections) {
  const file = join(dir, 'styles', `${id}.json`);
  if (!existsSync(file)) return null;
  const { nodes } = JSON.parse(readFileSync(file, 'utf8'));
  const area = (section) => section.height * (section.width ?? 1e6);
  const smallest = (list) => list.sort((a, b) => area(a.section) - area(b.section))[0] ?? null;
  const indexed = sections.map((section, index) => ({ section, index }));
  // A region holds only what lies in its columns too.
  const across = (section, from, to) => !('left' in section) || (from >= section.left - 0.5 && to <= section.left + section.width + 0.5);
  const placeOf = (node) =>
    smallest(
      indexed.filter(
        ({ section }) =>
          node.y >= section.top - 0.5 && node.y + node.height <= section.top + section.height + 0.5 && across(section, node.x, node.x + node.width),
      ),
    ) ??
    smallest(
      indexed.filter(({ section }) => {
        const [x, y] = [node.x + node.width / 2, node.y + node.height / 2];
        return y >= section.top && y < section.top + section.height && across(section, x, x);
      }),
    );
  return nodes
    .map((node) => ({ ...node, place: placeOf(node) }))
    .filter((node) => node.place && (node.type === 'TEXT' ? node.characters?.trim() : true));
}

/** What to look up for each Figma node: text by its text, anything else by its id. */
export function requestsFor(nodes, sectionNames) {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    text: node.characters ?? null,
    section: sectionNames[node.place.index],
    occurrence: sectionNames.slice(0, node.place.index).filter((name) => name === sectionNames[node.place.index]).length,
    layout: Boolean(node.layoutMode),
  }));
}

/** Runs in the page: finds the element of every Figma node and reads what the check compares. */
export function readDom(requests) {
  const squash = (text) => text.replace(/\s+/g, '').toLowerCase();
  const sectionsByName = new Map();
  for (const element of document.querySelectorAll('[data-section]')) {
    if (element.getClientRects().length === 0) continue;
    const name = element.getAttribute('data-section');
    sectionsByName.set(name, [...(sectionsByName.get(name) ?? []), element]);
  }
  // One element per Figma text; a frame found by its id may also be the element of its own text (a button).
  const taken = new Set();
  const ownText = (element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  const find = (request) => {
    if (request.id) {
      const explicit = document.querySelector(`[data-node-id~="${CSS.escape(request.id)}"]`);
      if (explicit || request.type !== 'TEXT') return explicit;
    }
    const section = sectionsByName.get(request.section)?.[request.occurrence];
    if (!section) return null;
    const want = squash(request.text);
    // The deepest element that holds exactly this text and some of it itself (not a wrapper around it).
    const candidates = [section, ...section.querySelectorAll('*')].filter(
      (element) => !taken.has(element) && squash(element.textContent ?? '') === want && ownText(element),
    );
    return candidates.find((element) => !candidates.some((other) => other !== element && element.contains(other))) ?? null;
  };
  const box = (rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  const opacityOf = (element) => {
    let opacity = 1;
    for (let node = element; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
      opacity *= parseFloat(getComputedStyle(node).opacity);
    }
    return opacity;
  };
  const transformText = (text, transform) =>
    transform === 'uppercase'
      ? text.toUpperCase()
      : transform === 'lowercase'
        ? text.toLowerCase()
        : transform === 'capitalize'
          ? text.replace(/(^|\s)(\S)/g, (_, space, letter) => space + letter.toUpperCase())
          : text;
  const SKIP = ['none', 'contents', 'table-column', 'table-column-group'];
  const children = (element, style) => {
    const list = [];
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
        // A text node's box is its glyph area; widen it to the line, as Figma's text box is.
        const range = document.createRange();
        range.selectNodeContents(child);
        const rect = range.getBoundingClientRect();
        const line = parseFloat(style.lineHeight) || rect.height;
        const half = Math.max(0, (line - rect.height) / 2);
        list.push({ left: rect.left, right: rect.right, top: rect.top - half, bottom: rect.bottom + half });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const s = getComputedStyle(child);
      const rect = child.getBoundingClientRect();
      if (SKIP.includes(s.display) || ['absolute', 'fixed'].includes(s.position) || (rect.width === 0 && rect.height === 0)) continue;
      let item = box(rect);
      // A rotated or scaled child takes its layout box, around the same centre (a chevron at 45°).
      if (s.transform !== 'none' && 'offsetWidth' in child) {
        const x = (rect.left + rect.right) / 2;
        const y = (rect.top + rect.bottom) / 2;
        item = { left: x - child.offsetWidth / 2, right: x + child.offsetWidth / 2, top: y - child.offsetHeight / 2, bottom: y + child.offsetHeight / 2 };
      }
      // A child that is only a Figma text (a table cell, a padded label) counts by its content, as Figma's text
      // box; a child that is a Figma frame of its own (a button, a chip) by its box.
      if (texts.has(child) && !frames.has(child)) {
        const edge = (side) => parseFloat(s[`padding${side}`]) + parseFloat(s[`border${side}Width`]);
        item = { left: item.left + edge('Left'), right: item.right - edge('Right'), top: item.top + edge('Top'), bottom: item.bottom - edge('Bottom') };
      }
      list.push(item);
    }
    // A side drawn on every child instead (a row's divider on its table cells) is the element's own.
    list.sides = ['Top', 'Right', 'Bottom', 'Left'].map((side) => {
      const kids = [...element.children].filter((child) => !SKIP.includes(getComputedStyle(child).display));
      if (!kids.length) return null;
      const first = getComputedStyle(kids[0]);
      const same = kids.every((child) => {
        const s = getComputedStyle(child);
        return s[`border${side}Width`] === first[`border${side}Width`] && s[`border${side}Color`] === first[`border${side}Color`] && s[`border${side}Style`] !== 'none';
      });
      return same ? { width: parseFloat(first[`border${side}Width`]), color: first[`border${side}Color`], style: first[`border${side}Style`] } : null;
    });
    return list;
  };
  const KEYS = [
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'color', 'backgroundColor',
    'backgroundImage', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopColor', 'borderRightColor',
    'borderBottomColor', 'borderLeftColor', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'outlineWidth', 'outlineStyle', 'outlineColor', 'boxShadow', 'filter', 'backdropFilter', 'clipPath',
  ];
  const elements = requests.map((request) => {
    const element = find(request);
    if (element && request.type === 'TEXT') taken.add(element);
    return element;
  });
  const texts = new Set(elements.filter((element, i) => element && requests[i].type === 'TEXT'));
  const frames = new Set(elements.filter((element, i) => element && requests[i].type !== 'TEXT'));
  return requests.map((request, i) => {
    const element = elements[i];
    if (!element) return null;
    const style = getComputedStyle(element);
    const kids = request.layout || request.type !== 'TEXT' ? children(element, style) : [];
    return {
      tag: element.tagName.toLowerCase(),
      svg: element instanceof SVGElement,
      text: transformText((element.textContent ?? '').trim().replace(/\s+/g, ' '), style.textTransform),
      box: box(element.getBoundingClientRect()),
      opacity: opacityOf(element),
      children: request.layout ? [...kids] : [],
      childSides: kids.sides ?? [],
      style: Object.fromEntries(KEYS.map((key) => [key, style[key]])),
    };
  });
}

const LINEAR = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const labF = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
function lab([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map(LINEAR);
  const fx = labF((0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047);
  const fy = labF(0.2126 * lr + 0.7152 * lg + 0.0722 * lb);
  const fz = labF((0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const COLOR_FN = /rgba?\([^)]*\)/g;
/** rgb()/rgba() from getComputedStyle, as {rgb, alpha}; anything else as null. */
function parseColor(value) {
  const match = /^rgba?\(([^)]+)\)$/.exec((value ?? '').trim());
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
  return { rgb: parts.slice(0, 3), alpha: parts[3] ?? 1 };
}
const sameColor = (hex, alpha, dom) => {
  if (!dom) return false;
  const [l1, a1, b1] = lab(fromHex(hex));
  const [l2, a2, b2] = lab(dom.rgb);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) <= COLOR && Math.abs(alpha - dom.alpha) <= ALPHA;
};
const showColor = (hex, alpha = 1) => (alpha <= 0.001 ? 'transparent' : alpha < 1 ? `${hex} ${Math.round(alpha * 100)} %` : hex);
const showDom = (color) => (color ? showColor(toHex(color.rgb), color.alpha) : 'none');
const round = (value) => Math.round(value * 100) / 100;
const px = (value) => (value === 'normal' ? 0 : parseFloat(value));
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
/** Computed box-shadow as a list of {color, x, y, blur, spread, inset}. */
function parseShadows(value) {
  if (!value || value === 'none') return [];
  return value.split(/,(?![^(]*\))/).map((part) => {
    const color = parseColor(part.match(COLOR_FN)?.[0]);
    const lengths = part.replace(COLOR_FN, '').match(/-?[\d.]+px/g)?.map(parseFloat) ?? [];
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    return { color, x, y, blur, spread, inset: /\binset\b/.test(part) };
  });
}
const SIDES = ['Top', 'Right', 'Bottom', 'Left'];

/** The style differences of one Figma node and its element: [{property, figma, dom}]. */
function differences(node, dom) {
  const off = [];
  const add = (property, figma, actual) => off.push({ property, figma, dom: actual });
  const s = dom.style;
  const fills = node.fills ?? [];
  const solid = fills.find((fill) => fill.type === 'SOLID');
  const opacity = node.effectiveOpacity ?? node.opacity ?? 1;

  if (node.type === 'TEXT') {
    if (node.fontFamily) {
      const family = s.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (family.toLowerCase() !== node.fontFamily.toLowerCase()) add('font-family', node.fontFamily, family);
    }
    if (node.fontSize != null && !near(parseFloat(s.fontSize), node.fontSize, PX)) add('font-size', node.fontSize, round(parseFloat(s.fontSize)));
    if (node.fontWeight != null && Number(s.fontWeight) !== node.fontWeight) add('font-weight', node.fontWeight, Number(s.fontWeight));
    const lh = node.lineHeight;
    if (lh && node.fontSize != null) {
      // AUTO is the font's own line: the height of a one-line Figma text box.
      const single = node.height < node.fontSize * 1.8;
      const want = lh.unit === 'PIXELS' ? lh.value : lh.unit === 'PERCENT' ? (node.fontSize * lh.value) / 100 : single ? node.height : null;
      const label = lh.unit === 'AUTO' ? `AUTO (${round(want)})` : round(want);
      if (want != null && s.lineHeight === 'normal') add('line-height', label, 'normal');
      else if (want != null && !near(parseFloat(s.lineHeight), want, PX)) add('line-height', label, round(parseFloat(s.lineHeight)));
    }
    const ls = node.letterSpacing;
    if (ls && node.fontSize != null) {
      const want = ls.unit === 'PIXELS' ? ls.value : (node.fontSize * ls.value) / 100;
      if (!near(px(s.letterSpacing), want, LETTER)) add('letter-spacing', round(want), round(px(s.letterSpacing)));
    }
    // The case as displayed: Figma's text case against the element's text-transform.
    const shown = { UPPER: (t) => t.toUpperCase(), LOWER: (t) => t.toLowerCase() }[node.textCase] ?? ((t) => t);
    const want = shown(node.characters.trim().replace(/\s+/g, ' '));
    const bare = (t) => t.replace(/\s/g, '');
    if (bare(want) !== bare(dom.text) && bare(want).toLowerCase() === bare(dom.text).toLowerCase()) {
      add('text case', want.slice(0, 24), dom.text.slice(0, 24));
    }
    if (solid) {
      // The fill's opacity and every layer's opacity together, however the build splits them.
      const color = parseColor(s.color);
      const got = color ? { ...color, alpha: color.alpha * dom.opacity } : null;
      if (!sameColor(solid.color, solid.opacity * opacity, got)) add('color', showColor(solid.color, solid.opacity * opacity), showDom(got));
    }
    return off;
  }

  const width = dom.box.right - dom.box.left;
  const height = dom.box.bottom - dom.box.top;
  // The box first, on the axes Figma fixes (a hugging or filling size follows its text and its siblings): when
  // it differs, its padding and gap would only repeat it.
  const [sizingX, sizingY] = node.sizing ?? ['FIXED', 'FIXED'];
  const sized = (sizingX !== 'FIXED' || near(width, node.width, SIZE)) && (sizingY !== 'FIXED' || near(height, node.height, SIZE));
  if (!sized) add('size', `${round(node.width)}×${round(node.height)}`, `${round(width)}×${round(height)}`);
  if (!near(dom.opacity, opacity, ALPHA)) add('opacity', opacity, round(dom.opacity));
  if (dom.svg) return off; // an SVG's own shapes are drawn with fill and stroke, not the box properties below

  if (solid) {
    const background = parseColor(s.backgroundColor);
    if (!sameColor(solid.color, solid.opacity, background)) add('background', showColor(solid.color, solid.opacity), showDom(background));
  }
  const gradient = fills.find((fill) => fill.type.startsWith('GRADIENT_'));
  if (gradient?.stops) {
    const stops = (s.backgroundImage.match(COLOR_FN) ?? []).map(parseColor);
    const want = gradient.stops.map((stop) => showColor(stop.color, stop.alpha)).join(' → ');
    if (!/gradient\(/.test(s.backgroundImage)) add('background', `gradient ${want}`, s.backgroundImage === 'none' ? showDom(parseColor(s.backgroundColor)) : 'image');
    else if (
      [0, gradient.stops.length - 1].some((i, end) => {
        const stop = gradient.stops[i];
        return !sameColor(stop.color, stop.alpha, stops[end ? stops.length - 1 : 0]) && !(stop.alpha === 0 && stops[end ? stops.length - 1 : 0]?.alpha === 0);
      })
    ) {
      add('gradient', want, stops.map(showDom).join(' → '));
    }
  }

  // Radii as drawn: never more than half the shorter side (a pill of 999 is a pill of 9999px). A smoothed
  // corner is a clip-path in CSS, and an ellipse any radius of half its sides or more.
  const domRadii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'].map((key) =>
    s[key].endsWith('%') ? (parseFloat(s[key]) / 100) * width : parseFloat(s[key]),
  );
  const cap = (r, w, h) => Math.min(r, w / 2, h / 2);
  if (node.type === 'ELLIPSE') {
    if (domRadii.some((r) => cap(r, width, height) < Math.min(width, height) / 2 - PX) && s.clipPath === 'none') {
      add('radius', 'ellipse', domRadii.map((r) => round(cap(r, width, height))).join(' '));
    }
  } else if (node.radius != null && !(node.cornerSmoothing > 0 && s.clipPath !== 'none')) {
    const figmaRadii = Array.isArray(node.radius) ? node.radius : [node.radius, node.radius, node.radius, node.radius];
    const want = figmaRadii.map((r) => round(cap(r, node.width, node.height)));
    const got = domRadii.map((r) => round(cap(r, width, height)));
    if (want.some((r, i) => !near(r, got[i], PX))) {
      const show = (radii) => (radii.every((r) => r === radii[0]) ? radii[0] : radii.join(' '));
      add('radius', show(want), show(got));
    }
  }

  // Strokes: a border, an outline or a ring of box-shadow (inset, outer, or both for a centred one) of the
  // same colour and weight all draw what Figma draws.
  const stroke = (node.strokes ?? []).find((paint) => paint.type === 'SOLID');
  const weights = node.strokeWeights ?? (node.strokeWeight != null ? [0, 1, 2, 3].map(() => node.strokeWeight) : null);
  const shadows = parseShadows(s.boxShadow);
  const rings = shadows.filter((shadow) => shadow.x === 0 && shadow.y === 0 && shadow.blur === 0 && shadow.spread > 0);
  if (stroke && weights && weights.some((w) => w > 0)) {
    const border = SIDES.map((side) => ({
      width: parseFloat(s[`border${side}Width`]),
      color: parseColor(s[`border${side}Color`]),
      style: s[`border${side}Style`],
    }));
    const alpha = stroke.opacity;
    const dashed = Boolean(node.dashPattern?.length);
    if (weights.every((w) => w === weights[0])) {
      const w = weights[0];
      const options = [
        border.every((b) => b.style !== 'none' && near(b.width, w, PX)) && { color: border[0].color, style: border[0].style },
        s.outlineStyle !== 'none' && near(parseFloat(s.outlineWidth), w, PX) && { color: parseColor(s.outlineColor), style: s.outlineStyle },
        ...rings.filter((ring) => near(ring.spread, w, PX)).map((ring) => ({ color: ring.color, style: 'solid' })),
        ...rings.flatMap((a, i) =>
          rings.slice(i + 1).filter((b) => a.inset !== b.inset && near(a.spread + b.spread, w, PX)).map(() => ({ color: a.color, style: 'solid' })),
        ),
      ].filter(Boolean);
      const found = options.find((option) => sameColor(stroke.color, alpha, option.color)) ?? options[0] ?? null;
      if (!found) add('stroke', `${w} px ${showColor(stroke.color, alpha)}`, 'none');
      else if (!sameColor(stroke.color, alpha, found.color)) add('stroke', `${w} px ${showColor(stroke.color, alpha)}`, `${w} px ${showDom(found.color)}`);
      else if (dashed && !['dashed', 'dotted'].includes(found.style)) add('stroke style', 'dashed', found.style);
    } else {
      weights.forEach((w, i) => {
        if (!w) return;
        const own = border[i];
        const drawn = dom.childSides?.[i];
        const b = own.style === 'none' && drawn ? { ...drawn, color: parseColor(drawn.color) } : own;
        const side = SIDES[i].toLowerCase();
        if (b.style === 'none' || !near(b.width, w, PX)) add(`stroke ${side}`, `${w} px ${showColor(stroke.color, alpha)}`, b.style === 'none' ? 'none' : `${b.width} px`);
        else if (!sameColor(stroke.color, alpha, b.color)) add(`stroke ${side}`, showColor(stroke.color, alpha), showDom(b.color));
      });
    }
  }

  // Shadows and blurs: Figma's blur radius is 2σ, CSS blur() takes σ.
  const soft = shadows.filter((shadow) => !rings.includes(shadow));
  for (const effect of node.effects ?? []) {
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      const inset = effect.type === 'INNER_SHADOW';
      const match = soft.find(
        (shadow) =>
          shadow.inset === inset &&
          near(shadow.x, effect.x, PX) &&
          near(shadow.y, effect.y, PX) &&
          near(shadow.blur, effect.radius, PX) &&
          near(shadow.spread, effect.spread, PX) &&
          sameColor(effect.color, effect.alpha, shadow.color),
      );
      if (!match) {
        const want = `${inset ? 'inset ' : ''}${effect.x} ${effect.y} ${effect.radius} ${effect.spread} ${showColor(effect.color, effect.alpha)}`;
        const got = soft.filter((shadow) => shadow.inset === inset).map((sh) => `${sh.x} ${sh.y} ${sh.blur} ${sh.spread} ${showDom(sh.color)}`);
        add('shadow', want, got.join(', ') || 'none');
      }
    } else if (effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR') {
      const property = effect.type === 'LAYER_BLUR' ? 'filter' : 'backdropFilter';
      const got = parseFloat(/blur\(([\d.]+)px\)/.exec(s[property])?.[1] ?? '0');
      if (!near(got, effect.radius / 2, PX)) add(effect.type === 'LAYER_BLUR' ? 'blur' : 'backdrop blur', effect.radius / 2, got);
    }
  }

  // Auto Layout. A side counts where Figma fixes it: the start when aligned to it, the end when aligned to it,
  // both when the frame hugs its content (or spaces its children between); centred content sits as far from
  // both padded sides. An INSIDE stroke included in the layout adds to its side's padding. A border the build draws
  // where Figma has no stroke is a child (a divider line), not padding.
  if (node.layoutMode && sized && dom.children.length) {
    const vertical = node.layoutMode === 'VERTICAL';
    const included = node.strokesIncludedInLayout ?? true;
    const strokeInset = (i) =>
      !included || !weights || node.strokeAlign !== 'INSIDE' ? 0 : (weights[i] ?? 0);
    const items = [...dom.children];
    SIDES.forEach((side, i) => {
      const w = parseFloat(s[`border${side}Width`]);
      if (w < 0.5 || (weights && weights[i] > 0)) return;
      const { left, top, right, bottom } = dom.box;
      items.push(
        [
          { left, right, top, bottom: top + w },
          { left: right - w, right, top, bottom },
          { left, right, top: bottom - w, bottom },
          { left, right: left + w, top, bottom },
        ][i],
      );
    });
    items.sort((a, b) => (vertical ? a.top - b.top : a.left - b.left));
    const spaced = node.primaryAxisAlignItems === 'SPACE_BETWEEN';
    if ((!node.layoutWrap || node.layoutWrap === 'NO_WRAP') && node.primaryAxisAlignItems && !spaced && items.length > 1) {
      const gaps = items.slice(1).map((item, i) => (vertical ? item.top - items[i].bottom : item.left - items[i].right));
      const wrong = gaps.find((gap) => !near(gap, node.itemSpacing, SPACING));
      if (wrong !== undefined) add('gap', node.itemSpacing, round(wrong));
    }
    const axes = [
      { main: true, align: node.primaryAxisAlignItems, hug: (vertical ? sizingY : sizingX) === 'HUG', sides: vertical ? [0, 2] : [3, 1] },
      { main: false, align: node.counterAxisAlignItems, hug: (vertical ? sizingX : sizingY) === 'HUG', sides: vertical ? [3, 1] : [0, 2] },
    ];
    const edges = [
      Math.min(...items.map((item) => item.top)) - dom.box.top,
      dom.box.right - Math.max(...items.map((item) => item.right)),
      dom.box.bottom - Math.max(...items.map((item) => item.bottom)),
      Math.min(...items.map((item) => item.left)) - dom.box.left,
    ];
    const NAMES = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'];
    for (const { align, hug, sides, main } of axes) {
      if (!align) continue;
      const [start, end] = sides;
      const want = (i) => node.padding[i] + strokeInset(i);
      const check = (i) => {
        if (!near(edges[i], want(i), SPACING)) add(NAMES[i], want(i), round(edges[i]));
      };
      if (hug || align === 'MIN' || (main && spaced)) check(start);
      if (hug || align === 'MAX' || (main && spaced)) check(end);
      if (!hug && align === 'CENTER' && !near(edges[start] - want(start), edges[end] - want(end), SPACING * 2)) {
        add(`centring ${main ? 'main' : 'cross'}`, 'centred', `${round(edges[start])} / ${round(edges[end])}`);
      }
    }
  }
  return off;
}

/**
 * Per section: how many nodes were checked, what differs, and how many Figma nodes have no element
 * (texts not found are listed: a changed or missing text; other nodes just lack a data-node-id).
 */
export function compareStyles(nodes, doms) {
  const sections = new Map();
  const missingText = [];
  nodes.forEach((node, i) => {
    const entry = sections.get(node.place.index) ?? { checked: 0, off: [], unmatched: 0 };
    sections.set(node.place.index, entry);
    const dom = doms[i];
    if (!dom) {
      if (node.type === 'TEXT') missingText.push({ section: node.place.index, node: node.id, text: node.characters });
      else entry.unmatched++;
      return;
    }
    entry.checked++;
    const label = node.type === 'TEXT' ? `«${node.characters.trim().replace(/\s+/g, ' ').slice(0, 40)}»` : `${node.name} ${node.id}`;
    for (const difference of differences(node, dom)) entry.off.push({ node: node.id, label, ...difference });
  });
  return { sections, missingText };
}
