/* global CSS, DOMParser, document, getComputedStyle, Node, NodeFilter, SVGElement, window -- used inside page.evaluate callbacks that run in the browser */
// Style check for pixel-diff.mjs: Figma's own values (styles/<id>.json, exported with figma-styles.js through
// use_figma) against the computed styles of the page. Pixels cannot see a wrong font weight, a 12 → 8 radius
// or a neighbouring text colour; the values can.
//
// Every node is found through data-node-id="<id>" on its element first, as get_design_context writes it (one
// element may list several ids, space-separated), texts too. A text without one is found by its text inside
// its section: the whole text, compared without spaces and case, never a part of it. Equal texts in one
// section (three "Edit" buttons) pair up with the elements by where they are, not by DOM order; a text the
// build splits into inline elements ("Hello <b>John</b>") is found on the element that holds all of it, and
// Figma's own split ("Hello" + "John") on the element holding each part. Visible elements win over hidden
// ones (a desktop copy kept in the DOM). Auto Layout gap and padding are compared with where the children
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
// A text's drawn glyphs against Figma's text box: fonts put the glyphs a pixel or two off the line box's centre.
const TEXT_CENTRE = 2;

/** The Figma nodes of a screen, each in the smallest section that holds its box (or its centre). */
export function readFigmaStyles(dir, id, sections) {
  const file = join(dir, 'styles', `${id}.json`);
  if (!existsSync(file)) return null;
  const { nodes, width: frameWidth, height: frameHeight } = JSON.parse(readFileSync(file, 'utf8'));
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
  // The parent is the smallest other node whose box holds this one; its Auto Layout places this node (flow),
  // unless Figma says the node is positioned absolutely.
  const holds = (outer, inner) =>
    outer !== inner &&
    outer.type !== 'TEXT' &&
    inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
  // Hidden in Figma itself: a layer painted later (after it in the file's order, so above it) with an opaque
  // fill covers the whole of it. The design does not show it, so the build need not have it.
  const opaque = (node) =>
    !node.isMask &&
    node.type !== 'TEXT' &&
    (node.effectiveOpacity ?? node.opacity ?? 1) >= 0.999 &&
    (node.fills ?? []).some(
      (fill) =>
        (fill.opacity ?? 1) >= 0.999 &&
        (fill.type === 'SOLID' || (fill.type?.startsWith('GRADIENT_') && (fill.stops ?? []).every((stop) => (stop.alpha ?? 1) >= 0.999))),
    );
  const covers = (outer, inner) =>
    inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
  // What the frame shows of a node: its box cut by the frame's edges (the frame clips what lies beyond them).
  const shownPart = (node) => {
    if (!frameWidth || !frameHeight) return node;
    const x = Math.max(0, node.x);
    const y = Math.max(0, node.y);
    return { x, y, width: Math.min(frameWidth, node.x + node.width) - x, height: Math.min(frameHeight, node.y + node.height) - y };
  };
  // What a layer can cover: its box cut by every ancestor that clips its content (exports with a node's parent
  // say which those are; a component scaled far past its small clipping card covers only the card).
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const clippedBox = (node) => {
    let box = { x: node.x, y: node.y, width: node.width, height: node.height };
    for (let parent = byId.get(node.parent); parent; parent = byId.get(parent.parent)) {
      if (!parent.clips) continue;
      const x = Math.max(box.x, parent.x);
      const y = Math.max(box.y, parent.y);
      box = { x, y, width: Math.min(box.x + box.width, parent.x + parent.width) - x, height: Math.min(box.y + box.height, parent.y + parent.height) - y };
    }
    return box;
  };
  const clipped = nodes.map(clippedBox);
  const occluded = (node, index) => {
    const part = shownPart(node);
    // Wholly outside the frame (a line has no height and is still inside), or under an opaque layer painted later.
    if (part.width < 0 || part.height < 0 || (frameWidth && (node.x >= frameWidth || node.y >= frameHeight))) return true;
    return nodes.some((other, i) => i > index && opaque(other) && covers(clipped[i], part) && !covers(node, other));
  };
  // What the design shows: not under an opaque layer, not beyond the frame, not at 0 % (a layer hidden this way
  // is no one's parent or child), and not a stacked copy of a text.
  const hidden = nodes.map((node, index) => occluded(node, index) || (node.effectiveOpacity ?? node.opacity ?? 1) <= 0.01);
  const parents = nodes.map((node, index) =>
    // Of two holders of one size (a frame and its inner frame), the later one in the file is inside the other.
    hidden[index] ? null : nodes.filter((other, i) => i < index && !hidden[i] && holds(other, node)).sort((a, b) => a.width * a.height - b.width * b.height).reduce((best, other) => (best && other.width * other.height > best.width * best.height ? best : other), null),
  );
  // How far a child's stroke reaches past its box: half a centred stroke, all of an outside one (a zero-height
  // divider line draws half its weight on each side). Spacing measured to the children may be off by that much.
  const overhang = (node) => {
    const w = Math.max(0, ...(node.strokeWeights ?? []).map((v) => v ?? 0));
    return node.strokes?.length ? (node.strokeAlign === 'OUTSIDE' ? w : node.strokeAlign === 'CENTER' || node.type === 'LINE' ? w / 2 : 0) : 0;
  };
  // A node deeper inside, on the edge of the frame's content (a ring icon in wrappers a build may not draw), is
  // where the build's nearest child may be measured.
  const indexOf = new Map(nodes.map((node, i) => [node, i]));
  const inside = (index, node) => {
    for (let parent = parents[index]; parent; parent = parents[indexOf.get(parent)]) if (parent === node) return true;
    return false;
  };
  const onEdge = (node, other) => {
    const [top, right, bottom, left] = node.padding ?? [0, 0, 0, 0];
    return (
      Math.abs(other.x - node.x - left) <= 1 ||
      Math.abs(other.y - node.y - top) <= 1 ||
      Math.abs(node.x + node.width - right - other.x - other.width) <= 1 ||
      Math.abs(node.y + node.height - bottom - other.y - other.height) <= 1
    );
  };
  // Stacked copies of one text (the same text at the same place) draw as one; the build has one element for them.
  const duplicate = (node, index) =>
    node.type === 'TEXT' &&
    nodes.some(
      (other, i) =>
        i < index && other.type === 'TEXT' && other.characters === node.characters &&
        ['x', 'y', 'width', 'height'].every((key) => Math.abs(other[key] - node[key]) <= 1),
    );
  return nodes
    .map((node, index) => ({
      ...node,
      place: placeOf(node),
      flow: node.layoutPositioning !== 'ABSOLUTE' && Boolean(parents[index]?.layoutMode),
      // Hidden in the design: under an opaque layer, beyond the frame, or fully transparent (a layer at 0 %).
      hiddenInFigma: hidden[index],
      // What the frame shows of it, when the frame's edge cuts it (a bar running past the bottom).
      shown: (() => {
        const part = shownPart(node);
        return part.width < node.width - 0.5 || part.height < node.height - 0.5 ? { width: part.width, height: part.height } : null;
      })(),
      childCount: parents.filter((parent, i) => parent === node && !duplicate(nodes[i], i)).length,
      childOverhang: Math.max(0, ...nodes.filter((other, i) => parents[i] === node || (other.strokes?.length && onEdge(node, other) && inside(i, node))).map(overhang)),
      // A frame whose only child is an Auto Layout frame: a build may draw both as one element, with both paddings.
      // A wrapper of the same box without Auto Layout between them (a component's inner frame) changes nothing.
      innerPadding: (() => {
        let kids = nodes.filter((_, i) => parents[i] === node);
        while (kids.length === 1 && !kids[0].layoutMode && ['x', 'y', 'width', 'height'].every((key) => Math.abs(kids[0][key] - node[key]) <= 1)) {
          const [only] = kids;
          kids = nodes.filter((_, i) => parents[i] === only);
        }
        return kids.length === 1 && kids[0].layoutMode && kids[0].padding ? kids[0].padding : null;
      })(),
      duplicate: duplicate(node, index),
    }))
    .filter((node) => node.place && !node.hiddenInFigma && !node.duplicate && (node.type === 'TEXT' ? node.characters?.trim() : true));
}

/** What to look up for each Figma node: its id, and a text also by its text and where it is in its section. */
export function requestsFor(nodes, sectionNames) {
  // A node that paints something (a fill, a stroke, a shadow) can be found by its box when it has no id; two such
  // nodes on the same box (a frame and its background rectangle) cannot tell which element is theirs.
  const paints = (node) =>
    node.type !== 'TEXT' &&
    ((node.fills ?? []).some((fill) => fill.type === 'SOLID' || fill.type?.startsWith('GRADIENT_')) ||
      (node.strokes ?? []).length > 0 ||
      (node.effects ?? []).some((effect) => effect.type.endsWith('SHADOW')));
  const same = (a, b) => ['x', 'y', 'width', 'height'].every((key) => Math.abs(a[key] - b[key]) <= 1);
  const inside = (outer, inner) =>
    inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
  // The texts a painted node holds itself: those whose innermost painted node it is (a button's label, a card's
  // title), not those of a smaller painted node inside it (the card's button).
  // A shape (a vector, a star, a line) is drawn under a text, never around it: only a frame or a rectangle can
  // be the box a build draws around its text.
  const SHAPES = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE', 'ELLIPSE'];
  const painter = new Map();
  nodes.forEach((text, i) => {
    if (text.type !== 'TEXT') return;
    const holder = nodes
      .filter((node, j) => j < i && paints(node) && !SHAPES.includes(node.type) && inside(node, text))
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    if (holder) painter.set(holder, [...(painter.get(holder) ?? []), text.id]);
  });
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    text: node.characters ?? null,
    section: sectionNames[node.place.index],
    occurrence: sectionNames.slice(0, node.place.index).filter((name) => name === sectionNames[node.place.index]).length,
    layout: Boolean(node.layoutMode),
    // Across in the frame's pixels, down from the section's top.
    at: { x: node.x, y: node.y - node.place.section.top },
    size: { width: node.width, height: node.height },
    box: paints(node) && !nodes.some((other) => other !== node && paints(other) && same(other, node))
      ? { x: node.x, y: node.y - node.place.section.top, width: node.width, height: node.height }
      : null,
    texts: paints(node) ? painter.get(node) ?? [] : [],
  }));
}

/** Runs in the page: finds the element of every Figma node and reads what the check compares. */
export async function readDom(requests) {
  // Spaces, soft hyphens and zero-width characters do not count, nor does case (text-transform is checked apart).
  const squash = (text) => text.replace(/[\s\u00AD\u200B-\u200D\u2060\uFEFF]+/g, '').toLowerCase();
  const sectionsByName = new Map();
  for (const element of document.querySelectorAll('[data-section]')) {
    if (element.getClientRects().length === 0) continue;
    const name = element.getAttribute('data-section');
    sectionsByName.set(name, [...(sectionsByName.get(name) ?? []), element]);
  }
  const shown = (element) => element.getClientRects().length > 0;
  // The text a reader sees: the text nodes of the element that are rendered (a link hidden with display: none
  // inside a paragraph is not part of what the paragraph shows).
  const renderedText = new Map();
  const rendered = (element) => {
    if (renderedText.has(element)) return renderedText.get(element);
    let text = '';
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent && parent.getClientRects().length > 0 && parent.checkVisibility?.({ visibilityProperty: true }) !== false) text += node.textContent;
    }
    renderedText.set(element, text);
    return text;
  };
  const ownText = (element) =>
    [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('');
  // The deepest of a list: no other element of the list inside it.
  const deepest = (list) => list.filter((element) => !list.some((other) => other !== element && element.contains(other)));
  // 1. Every node with a data-node-id, texts included.
  const elements = requests.map((request) => (request.id ? document.querySelector(`[data-node-id~="${CSS.escape(request.id)}"]`) : null));
  const matchedBy = elements.map((element) => (element ? 'id' : null));
  // One element per Figma text; a frame found by its id may also be the element of its own text (a button).
  const taken = new Set(elements.filter((element, i) => element && requests[i].type === 'TEXT'));
  // 2. The other texts by their text, equal texts of a section together.
  const groups = new Map();
  requests.forEach((request, i) => {
    if (request.type !== 'TEXT' || elements[i] || !request.text) return;
    const key = `${request.section}\u0000${request.occurrence}\u0000${squash(request.text)}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  for (const indexes of groups.values()) {
    const request = requests[indexes[0]];
    const section = sectionsByName.get(request.section)?.[request.occurrence];
    if (!section) continue;
    const want = squash(request.text);
    const all = [section, ...section.querySelectorAll('*')].filter((element) => !taken.has(element) && !element.closest('svg, script, style, template'));
    const whole = all.filter((element) => squash(rendered(element)) === want);
    // A form field shows its value, or its placeholder while it is empty.
    const fieldText = (element) => (['INPUT', 'TEXTAREA'].includes(element.tagName) ? element.value || element.placeholder || '' : null);
    // The whole text with some of it in the element itself; the element whose own text is Figma's part of a
    // text split in Figma; the element wrapping inline pieces that together are the text; a form field.
    const tiers = [
      ['text', deepest(whole.filter((element) => squash(ownText(element)) !== ''))],
      // Figma's part may be all of the element's own text or one of its text nodes (two texts in one cell).
      ['split', all.filter((element) => element.children.length > 0 && !whole.includes(element) && (squash(ownText(element)) === want || [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && squash(node.textContent) === want)))],
      ['wrapper', deepest(whole)],
      // A caret Figma draws as a "|" after a field's text is not part of the text.
      // A lone caret is no field's text: an empty field is not where Figma draws it.
      ['field', all.filter((element) => fieldText(element) !== null && [want, want.replace(/\|$/, '')].filter(Boolean).includes(squash(fieldText(element))))],
    ];
    const [how, found] = tiers.find(([, list]) => list.length) ?? [null, []];
    if (!found.length) continue;
    const candidates = found.some(shown) ? found.filter(shown) : found;
    const top = section.getBoundingClientRect().top;
    const place = (element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + window.scrollX, y: rect.top - top };
    };
    // Nearest pairs first: the n-th "Edit" of the design with the element where it is drawn.
    const pairs = indexes
      .flatMap((i) => candidates.map((element) => {
        const at = place(element);
        return { i, element, distance: Math.hypot(at.x - requests[i].at.x, at.y - requests[i].at.y) };
      }))
      .sort((a, b) => a.distance - b.distance);
    // An element holding several Figma texts in its own text nodes is shared by them; any other is taken.
    const used = new Set();
    for (const { i, element } of pairs) {
      if (elements[i] || taken.has(element) || used.has(element)) continue;
      elements[i] = element;
      matchedBy[i] = how === 'field' ? (element.value ? 'value' : 'placeholder') : indexes.length > 1 || candidates.length > 1 ? `${how} by position` : how;
      used.add(element);
      if (how !== 'split') taken.add(element);
    }
  }
  // 3. A node that paints, without an id, by its box: the one painted element of its section at the same place
  // and size (within 1 px). Two painted candidates, or none, leave it unmatched.
  const painted = (element) => {
    const s = getComputedStyle(element);
    return (
      !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(s.backgroundColor) ||
      s.backgroundImage !== 'none' ||
      ['Top', 'Right', 'Bottom', 'Left'].some((side) => s[`border${side}Style`] !== 'none' && parseFloat(s[`border${side}Width`]) > 0) ||
      s.boxShadow !== 'none' ||
      (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0)
    );
  };
  // Elements of other frames are taken; the element of a text may also be its frame's (a button's label).
  const claimed = new Set(elements.filter((element, i) => element && requests[i].type !== 'TEXT'));
  requests.forEach((request, i) => {
    if (elements[i] || !request.box) return;
    const section = sectionsByName.get(request.section)?.[request.occurrence];
    if (!section) return;
    const top = section.getBoundingClientRect().top;
    const fits = [section, ...section.querySelectorAll('*')].filter((element) => {
      if (claimed.has(element) || element.closest('svg') !== null && element.tagName.toLowerCase() !== 'svg') return false;
      const rect = element.getBoundingClientRect();
      return (
        Math.abs(rect.left + window.scrollX - request.box.x) <= 1 &&
        Math.abs(rect.top - top - request.box.y) <= 1 &&
        Math.abs(rect.width - request.box.width) <= 1 &&
        Math.abs(rect.height - request.box.height) <= 1 &&
        painted(element)
      );
    });
    // A layer of the element's own box laid over it (a selection ring at inset 0) is part of the element.
    const own = fits.filter((element) => !(fits.includes(element.parentElement) && ['absolute', 'fixed'].includes(getComputedStyle(element).position)));
    if (own.length !== 1) return;
    elements[i] = own[0];
    matchedBy[i] = 'box';
    claimed.add(own[0]);
  });
  // 4. A painted node that holds texts of its own, by those texts: the nearest painted element around all of
  // their elements (a button around its label, a card around its title). It does not depend on the box, so a
  // button grown by a wrong padding or a card with a wrong radius is still found. The texts must agree.
  const byId = new Map(requests.map((request, i) => [request.id, i]));
  const paintedAround = (element, section) => {
    for (let node = element; node && section.contains(node); node = node.parentElement) {
      if (painted(node)) return node;
    }
    return null;
  };
  requests.forEach((request, i) => {
    if (elements[i] || !request.texts?.length) return;
    const section = sectionsByName.get(request.section)?.[request.occurrence];
    if (!section) return;
    // Most of them found is enough (a footnote the build splits in two paragraphs is not found as one text).
    const found = request.texts.map((id) => elements[byId.get(id)]).filter(Boolean);
    if (!found.length || found.length * 2 < request.texts.length) return;
    const around = new Set(found.map((element) => paintedAround(element, section)));
    const [only] = around;
    if (around.size !== 1 || !only || claimed.has(only)) return;
    elements[i] = only;
    matchedBy[i] = 'structure';
    claimed.add(only);
  });
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
  const children = (outer, outerStyle) => {
    // A wrapper around the children that spans the element across or down (a div around a list, a centred
    // container that holds the side padding) is not a level of its own: its one element child that is no Figma
    // node of its own holds them, and the insets of both add up, as a Figma frame's padding does.
    let element = outer;
    let style = outerStyle;
    // Elements that draw nothing (a <script> of JSON-LD, a display: none one) are not children here.
    const drawnChildren = (node) => [...node.children].filter((child) => !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(child.tagName) && getComputedStyle(child).display !== 'none');
    while (drawnChildren(element).length === 1 && !ownText(element).trim()) {
      const [only] = drawnChildren(element);
      const a = element.getBoundingClientRect();
      const b = only.getBoundingClientRect();
      const spans = (start, size) => Math.abs(a[start] - b[start]) <= 1 && Math.abs(a[size] - b[size]) <= 1;
      if (frames.has(only) || texts.has(only) || !(spans('left', 'width') || spans('top', 'height'))) break;
      element = only;
      style = getComputedStyle(only);
    }
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
      // Content the page does not draw: the answer of a closed <details>, a content-visibility: hidden part.
      if (child.checkVisibility?.({ visibilityProperty: true }) === false) continue;
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
      return same ? { width: parseFloat(first[`border${side}Width`]), color: plain(first[`border${side}Color`]), style: first[`border${side}Style`] } : null;
    });
    return list;
  };
  const KEYS = [
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'color', 'backgroundColor',
    'backgroundImage', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopColor', 'borderRightColor',
    'borderBottomColor', 'borderLeftColor', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'outlineWidth', 'outlineStyle', 'outlineColor', 'outlineOffset', 'boxShadow', 'filter', 'backdropFilter', 'clipPath',
    'width', 'height', 'opacity',
  ];
  // Colours as rgb()/rgba(), whatever the build writes: oklab() from Tailwind's opacity modifiers, oklch(),
  // color(), lab()... converted by the browser itself (a 1 px canvas), so the check reads every notation alike.
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const toRgb = (value) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = 'rgba(0, 0, 0, 0)';
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
  };
  const MODERN = /(?:oklab|oklch|lab|lch|color|hwb|hsla?)\([^()]*\)/g;
  const plain = (value) => (typeof value === 'string' && /(?:oklab|oklch|lab|lch|color|hwb|hsla?)\(/.test(value) ? value.replace(MODERN, toRgb) : value);
  const read = (style) => Object.fromEntries(KEYS.map((key) => [key, plain(style[key])]));
  // A node drawn by a pseudo-element: data-node-id-before / data-node-id-after on its element.
  const pseudoOf = (id) => {
    for (const which of ['before', 'after']) {
      const element = document.querySelector(`[data-node-id-${which}~="${CSS.escape(id)}"]`);
      if (element) return { element, which };
    }
    return null;
  };
  // The shapes of an icon: their stroke, stroke width (in rendered px) and fill, as the browser computes them
  // (svgShapes). An inline <svg> is computed here, in the page; an SVG file shown with <img> is only located
  // here and computed by resolveIcons() in a blank page, where the page's CSP cannot block the file's own
  // <style>. An icon is an <img> of an SVG, an inline <svg>, or the only one of either inside a textless
  // wrapper (<span class="icon"><svg>…</svg></span>).
  const iconOf = (element) => {
    const inner = element.tagName === 'IMG' || element.tagName.toLowerCase() === 'svg'
      ? [element]
      : element.textContent.trim()
        ? []
        : [...element.querySelectorAll('img, svg')].filter((e) => !e.parentElement.closest('svg'));
    if (inner.length !== 1) return null;
    const [icon] = inner;
    const rendered = icon.getBoundingClientRect().width;
    if (icon.tagName !== 'IMG') return { shapes: svgShapes(icon, rendered) };
    const src = icon.currentSrc || icon.src;
    return /\.svg(\?|#|$)|^data:image\/svg/i.test(src) ? { svgFile: { url: src, rendered } } : null;
  };
  // A stroke drawn over the element by a layer of its own box (an absolute child or a ::before/::after at
  // inset 0 with a border or a ring), as builds draw a selection ring that must not move the content.
  const overlayOf = (element) => {
    const rect = element.getBoundingClientRect();
    const drawsLine = (s) =>
      s.boxShadow !== 'none' || ['Top', 'Right', 'Bottom', 'Left'].some((side) => s[`border${side}Style`] !== 'none' && parseFloat(s[`border${side}Width`]) > 0);
    for (const which of ['before', 'after']) {
      const s = getComputedStyle(element, `::${which}`);
      if (s.content === 'none' || !['absolute', 'fixed'].includes(s.position) || !drawsLine(s)) continue;
      if (Math.abs(parseFloat(s.width) - rect.width) <= 1 && Math.abs(parseFloat(s.height) - rect.height) <= 1) return read(s);
    }
    for (const child of element.children) {
      const s = getComputedStyle(child);
      if (!['absolute', 'fixed'].includes(s.position) || !drawsLine(s)) continue;
      const r = child.getBoundingClientRect();
      if (['left', 'top', 'width', 'height'].every((key) => Math.abs(r[key] - rect[key]) <= 1)) return read(s);
    }
    return null;
  };
  // The family the text is drawn with: the first of its font-family list the browser can draw. A family that
  // is declared but neither loaded nor installed (a @font-face under another name, a file that failed) falls
  // through to the next one, as it does on screen. Measured against two fallbacks, so a family that happens
  // to have one fallback's widths is still seen. Measured in the text's own weight and style: a family served
  // as one file per weight has only the weights the page uses loaded.
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong|-apple-system|BlinkMacSystemFont)$/i;
  const drawn = new Map();
  const drawnFamily = (style) => {
    const stack = style.fontFamily;
    const face = `${style.fontStyle} ${style.fontWeight}`;
    const key = `${face} ${stack}`;
    if (drawn.has(key)) return drawn.get(key);
    const probe = 'AaBbGgQqWw ЖжШщЯя 0123456789 @&';
    const width = (font) => {
      context.font = font;
      return context.measureText(probe).width;
    };
    const families = stack.split(',').map((family) => family.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    const found =
      families.find((family) => GENERIC.test(family) || ['monospace', 'serif'].some((base) => width(`${face} 64px "${family}", ${base}`) !== width(`${face} 64px ${base}`))) ??
      null;
    drawn.set(key, found);
    return found;
  };
  // What the element is drawn over: the background colour of the nearest ancestor that paints one.
  const backdropOf = (element) => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      const color = plain(getComputedStyle(node).backgroundColor);
      if (!/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(color)) return color;
    }
    return 'rgb(255, 255, 255)';
  };
  const texts = new Set(elements.filter((element, i) => element && requests[i].type === 'TEXT'));
  const frames = new Set(elements.filter((element, i) => element && requests[i].type !== 'TEXT'));
  return requests.map((request, i) => {
    const element = elements[i];
    const sectionElement = sectionsByName.get(request.section)?.[request.occurrence];
    const sectionBox = sectionElement ? box(sectionElement.getBoundingClientRect()) : null;
    if (!element) {
      // A text the design draws inside a picture (a card logo, a badge) is part of the picture in the build.
      if (request.type === 'TEXT' && sectionElement && request.size) {
        const top = sectionElement.getBoundingClientRect().top;
        const media = [sectionElement, ...sectionElement.querySelectorAll('img, svg, canvas, picture, video')].filter((element) => element.matches('img, svg, canvas, picture, video'));
        const inImage = media.some((media) => {
          const rect = media.getBoundingClientRect();
          const x = rect.left + window.scrollX;
          const y = rect.top - top;
          return rect.width > 0 && request.at.x >= x - 1 && request.at.y >= y - 1 && request.at.x + request.size.width <= x + rect.width + 1 && request.at.y + request.size.height <= y + rect.height + 1;
        });
        if (inImage) return { inImage: true };
      }
      const pseudo = request.type !== 'TEXT' ? pseudoOf(request.id) : null;
      if (!pseudo) return null;
      const style = getComputedStyle(pseudo.element, `::${pseudo.which}`);
      return { pseudo: pseudo.which, opacity: opacityOf(pseudo.element) * parseFloat(style.opacity), children: [], style: read(style) };
    }
    // Found but not shown (display: none, visibility: hidden): the design shows it.
    if (element.getClientRects().length === 0 || element.checkVisibility?.({ visibilityProperty: true }) === false) {
      return { hidden: true, children: [], style: {} };
    }
    // A placeholder is drawn with the field's ::placeholder style.
    const field = ['value', 'placeholder'].includes(matchedBy[i]);
    const style = getComputedStyle(element, matchedBy[i] === 'placeholder' ? '::placeholder' : null);
    const kids = request.layout || request.type !== 'TEXT' ? children(element, style) : [];
    const shownText = field ? element.value || element.placeholder : rendered(element);
    // An inline element cannot make its line shorter than its block's: the line it draws is the taller of the two.
    let lineHeight = null;
    if (request.type === 'TEXT' && style.display.startsWith('inline') && style.display !== 'inline-block') {
      for (let node = element.parentElement; node; node = node.parentElement) {
        const outer = getComputedStyle(node);
        if (!outer.display.startsWith('inline')) {
          const own = parseFloat(style.lineHeight);
          const block = parseFloat(outer.lineHeight);
          if (Number.isFinite(own) && Number.isFinite(block) && block > own) lineHeight = `${block}px`;
          break;
        }
      }
    }
    // Where the text itself is drawn (its element may be a whole button around it).
    let textBox = null;
    if (request.type === 'TEXT' && !field) {
      const range = document.createRange();
      range.selectNodeContents(element);
      textBox = box(range.getBoundingClientRect());
    }
    return {
      field,
      textBox,
      lineHeight,
      drawnFamily: request.type === 'TEXT' ? drawnFamily(style) : null,
      sectionBox,
      ...(request.type !== 'TEXT' ? iconOf(element) : null),
      matchedBy: matchedBy[i],
      tag: element.tagName.toLowerCase(),
      svg: element instanceof SVGElement,
      text: transformText(shownText.trim().replace(/\s+/g, ' '), style.textTransform),
      box: box(element.getBoundingClientRect()),
      opacity: opacityOf(element),
      children: request.layout ? [...kids] : [],
      childSides: kids.sides ?? [],
      overlay: request.type !== 'TEXT' ? overlayOf(element) : null,
      backdrop: request.type !== 'TEXT' ? backdropOf(element) : null,
      style: read(style),
    };
  });
}

/**
 * Runs in the browser: the drawn shapes of an SVG element and their computed stroke, stroke width (scaled from
 * the viewBox to the rendered width) and fill. Presentation attributes, inline styles, <style> rules and
 * classes, inheritance from <g> and currentColor resolve as when drawn; shapes in <defs>, masks and clip paths
 * and hidden ones are left out. Not resolved: shapes behind <use>, and transforms that scale a stroke.
 */
export function svgShapes(svg, rendered) {
  // Colours in any notation as rgb(), converted by the browser (see readDom).
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const rgb = (value) => {
    if (!/^(?:oklab|oklch|lab|lch|color|hwb|hsla?)\(/.test(value)) return value;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
  };
  const viewBox = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(parseFloat);
  const scale = rendered / (viewBox[2] || parseFloat(svg.getAttribute('width')) || rendered || 1);
  return [...svg.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse')]
    .filter((shape) => !shape.closest('defs, clipPath, mask, symbol, pattern, marker'))
    .map((shape) => getComputedStyle(shape))
    .filter((cs) => cs.display !== 'none' && cs.visibility !== 'hidden')
    .map((cs) => ({ stroke: rgb(cs.stroke), strokeWidth: parseFloat(cs.strokeWidth) * scale, fill: rgb(cs.fill) }));
}

/** The text of an SVG file: fetched without the page (and its CSP), or decoded from a data: URL. */
async function svgText(context, url) {
  if (url.startsWith('data:')) {
    const [head, body] = [url.slice(0, url.indexOf(',')), url.slice(url.indexOf(',') + 1)];
    return head.endsWith(';base64') ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body);
  }
  const response = await context.request.get(url);
  return response.ok() ? response.text() : null;
}

/**
 * The shapes of the SVG files readDom() located, computed in a blank page of the same browser: the file is
 * parsed there, stripped of scripts and event handlers, and computed in a closed shadow root, with the
 * black currentColor of an <img>.
 */
export async function resolveIcons(context, doms) {
  const files = doms.filter((dom) => dom?.svgFile);
  if (!files.length) return doms;
  const page = await context.newPage();
  try {
    for (const dom of files) {
      const text = await svgText(context, dom.svgFile.url).catch(() => null);
      dom.shapes = text
        ? await page.evaluate(`(() => {
            const svgShapes = ${svgShapes};
            const svg = new DOMParser().parseFromString(${JSON.stringify(text)}, 'image/svg+xml').documentElement;
            if (svg.nodeName !== 'svg') return null;
            for (const element of svg.querySelectorAll('script, foreignObject')) element.remove();
            for (const element of [svg, ...svg.querySelectorAll('*')]) {
              for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
            }
            const host = document.createElement('div');
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'all:initial;color:#000';
            host.attachShadow({ mode: 'closed' }).append(wrapper);
            wrapper.append(document.importNode(svg, true));
            document.body.append(host);
            const shapes = svgShapes(wrapper.firstElementChild, ${Number(dom.svgFile.rendered)});
            host.remove();
            return shapes;
          })()`)
        : null;
    }
  } finally {
    await page.close();
  }
  return doms;
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
/**
 * The colour a background draws when its image layers are all flat (a gradient of one colour, the way a build
 * stacks a tint over a colour: `bg-white bg-[linear-gradient(accent/10,accent/10)]`): the layers blended over
 * background-color, as {rgb, alpha}. Anything else in the image (a real gradient, a url()) gives null.
 */
function flatBackground(color, image) {
  const under = parseColor(color);
  if (!image || image === 'none') return under;
  const layers = image.match(/(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)|url\([^)]*\)/g) ?? [];
  const flat = layers.map((layer) => {
    const stops = (layer.match(COLOR_FN) ?? []).map(parseColor);
    return stops.length && stops.every((stop) => stop.alpha === stops[0].alpha && stop.rgb.every((v, k) => v === stops[0].rgb[k])) ? stops[0] : null;
  });
  if (!flat.length || flat.includes(null)) return null;
  // The first layer is on top.
  return flat.reverse().reduce((below, over) => {
    const a = over.alpha;
    const b = below?.alpha ?? 0;
    const alpha = a + b * (1 - a);
    const rgb = over.rgb.map((v, k) => (v * a + (below?.rgb[k] ?? 0) * b * (1 - a)) / (alpha || 1));
    return { rgb, alpha };
  }, under);
}
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
  })
    // Shadows that draw nothing: transparent, or no offset, blur or spread (Tailwind lists such placeholders
    // for its rings and shadows on every element).
    .filter((shadow) => shadow.color?.alpha > 0 && (shadow.x || shadow.y || shadow.blur || shadow.spread));
}
const SIDES = ['Top', 'Right', 'Bottom', 'Left'];

/**
 * Where a node sits, for what Figma places by hand (outside Auto Layout: a floating button, a caption on a
 * photo); a child in Auto Layout is placed by its gap and padding, checked on its parent. Down from its
 * section's top, so a section that moved as a whole is not counted again; across from the frame's edge (a
 * region's own edge), as the element of a band may be narrower than the band.
 */
function position(node, dom, add) {
  // A form field's text sits where its padding puts it: the field is the box, not the text.
  if (!dom.sectionBox || !node.place || node.flow || dom.field) return;
  const region = 'left' in node.place.section;
  const across = (left) => left - (region ? dom.sectionBox.left : 0) - (node.x - (region ? node.place.section.left : 0));
  if (node.type === 'TEXT' && dom.textBox && node.textAutoResize) {
    // A text by what it draws, not by its element (a whole button may be around a bare label): across by the
    // edge its alignment keeps (the centre when the box hugs the text), down by the centre when the text sets
    // the box's height; the glyphs sit inside the line box, a pixel or two off its edges.
    const t = dom.textBox;
    const hug = node.textAutoResize === 'WIDTH_AND_HEIGHT';
    const align = hug ? 'CENTER' : node.textAlign ?? 'LEFT';
    const x =
      align === 'CENTER'
        ? across((t.left + t.right) / 2) - node.width / 2
        : align === 'RIGHT'
          ? across(t.right) - node.width
          : across(t.left);
    const tall = hug || node.textAutoResize === 'HEIGHT';
    const y = tall ? (t.top + t.bottom) / 2 - dom.sectionBox.top - (node.y + node.height / 2 - node.place.section.top) : 0;
    if (!near(x, 0, TEXT_CENTRE) || !near(y, 0, TEXT_CENTRE)) add('position', `${round(node.x)}, ${round(node.y)}`, `${round(node.x + x)}, ${round(node.y + y)}`);
    return;
  }
  // A box that hugs its content on an axis may be anchored by its start, its centre or its end: its size follows
  // text that renders a little wider or narrower, so any one of them in place will do, within what text drifts
  // (a hugging chip after another one moves by how much narrower the first one's text is drawn).
  const [sizingX, sizingY] = node.sizing ?? ['FIXED', 'FIXED'];
  const width = dom.box.right - dom.box.left;
  const height = dom.box.bottom - dom.box.top;
  const nearest = (start, grown, hug) => (hug ? [start, start + grown / 2, start + grown].sort((a, b) => Math.abs(a) - Math.abs(b))[0] : start);
  const x = nearest(across(dom.box.left), width - node.width, sizingX === 'HUG');
  const y = nearest(dom.box.top - dom.sectionBox.top - (node.y - node.place.section.top), height - node.height, sizingY === 'HUG');
  const tolerance = (hug) => (hug ? TEXT_CENTRE : SIZE);
  if (!near(x, 0, tolerance(sizingX === 'HUG')) || !near(y, 0, tolerance(sizingY === 'HUG'))) add('position', `${round(node.x)}, ${round(node.y)}`, `${round(node.x + x)}, ${round(node.y + y)}`);
}

/** The style differences of one Figma node and its element: [{property, figma, dom}]. */
function differences(node, dom) {
  const off = [];
  const add = (property, figma, actual) => off.push({ property, figma, dom: actual });
  const s = dom.style;
  // Fills stack bottom to top: what lies under the topmost opaque fill cannot be seen, and solid fills above it
  // blend into one colour, however the build writes it.
  const allFills = node.fills ?? [];
  const opaqueFill = (fill) =>
    (fill.opacity ?? 1) >= 0.999 &&
    (fill.type === 'SOLID' || (fill.type?.startsWith('GRADIENT_') && (fill.stops ?? []).every((stop) => (stop.alpha ?? 1) >= 0.999)));
  const base = allFills.map(opaqueFill).lastIndexOf(true);
  const fills = base > 0 ? allFills.slice(base) : allFills;
  const solids = fills.filter((fill) => fill.type === 'SOLID');
  const solid =
    solids.length > 1 && !fills.some((fill) => fill.type !== 'SOLID')
      ? solids.reduce((under, over) => {
          const a = over.opacity ?? 1;
          const [u, o] = [fromHex(under.color), fromHex(over.color)];
          const alpha = a + (under.opacity ?? 1) * (1 - a);
          const mix = u.map((v, k) => (o[k] * a + v * (under.opacity ?? 1) * (1 - a)) / (alpha || 1));
          return { type: 'SOLID', color: toHex(mix), opacity: alpha };
        })
      : solids[0];
  // Figma has no colour filters: brightness, contrast, invert... on an element change what the design draws.
  const colourFilter = (dom.style?.filter ?? '').match(/(?:brightness|contrast|saturate|grayscale|sepia|hue-rotate|invert|opacity)\([^)]*\)/g);
  const filterDifference = () => {
    if (colourFilter && !['img', 'svg', 'picture', 'video'].includes(dom.tag)) off.push({ property: 'filter', figma: 'none', dom: colourFilter.join(' ') });
  };
  const opacity = node.effectiveOpacity ?? node.opacity ?? 1;
  if (dom.hidden) {
    add('shown', 'yes', 'hidden');
    return off;
  }
  if (dom.pseudo) {
    // Drawn by ::before or ::after: its size, fill, radius and opacity as computed (no box to place).
    const w = parseFloat(s.width);
    const h = parseFloat(s.height);
    if (Number.isFinite(w) && Number.isFinite(h) && !(near(w, node.width, SIZE) && near(h, node.height, SIZE))) {
      add('size', `${round(node.width)}×${round(node.height)}`, `${round(w)}×${round(h)}`);
    }
    if (solid && !sameColor(solid.color, solid.opacity, parseColor(s.backgroundColor))) {
      add('background', showColor(solid.color, solid.opacity), showDom(parseColor(s.backgroundColor)));
    }
    if (!near(dom.opacity, opacity, ALPHA)) add('opacity', opacity, round(dom.opacity));
    return off;
  }

  if (node.type === 'TEXT') {
    // A declared family that is not drawn is a difference even when the export has no family (mixed styles).
    if (!node.fontFamily && dom.drawnFamily !== undefined) {
      const declared = s.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (dom.drawnFamily !== declared) add('font-family', 'as declared', `${declared} (not loaded: ${dom.drawnFamily ?? 'a fallback'})`);
    }
    if (node.fontFamily) {
      // The family drawn, not only the one declared; fontsource names its variable fonts "<Family> Variable".
      const declared = s.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      const drawnAs = dom.drawnFamily === undefined ? declared : dom.drawnFamily;
      const name = (family) => (family ?? '').toLowerCase().replace(/\s+variable$/, '');
      if (name(drawnAs) !== name(node.fontFamily)) {
        add('font-family', node.fontFamily, name(drawnAs) === name(declared) ? declared : `${declared} (not loaded: ${drawnAs ?? 'a fallback'})`);
      }
    }
    if (node.fontSize != null && !near(parseFloat(s.fontSize), node.fontSize, PX)) add('font-size', node.fontSize, round(parseFloat(s.fontSize)));
    if (node.fontWeight != null && Number(s.fontWeight) !== node.fontWeight) add('font-weight', node.fontWeight, Number(s.fontWeight));
    const lh = node.lineHeight;
    // A one-line input places its text by its height and padding; its line-height draws nothing.
    if (lh && node.fontSize != null && !(dom.field && dom.tag === 'input')) {
      // AUTO is the font's own line: the height of a one-line Figma text box.
      const single = node.height < node.fontSize * 1.8;
      const want = lh.unit === 'PIXELS' ? lh.value : lh.unit === 'PERCENT' ? (node.fontSize * lh.value) / 100 : single ? node.height : null;
      const label = lh.unit === 'AUTO' ? `AUTO (${round(want)})` : round(want);
      const drawn = dom.lineHeight ?? s.lineHeight;
      // normal is the font's own line: what it draws, measured on a one-line text, is what counts.
      const normal = drawn === 'normal' && single && dom.textBox ? dom.textBox.bottom - dom.textBox.top : null;
      if (want != null && drawn === 'normal') {
        // Chromium rounds the font's ascent and descent apart: its normal line can be up to 1.5 px taller.
        if (normal == null || !near(normal, want, 1.5)) add('line-height', label, normal == null ? 'normal' : `normal (${round(normal)})`);
      }
      else if (want != null && !near(parseFloat(drawn), want, PX)) add('line-height', label, round(parseFloat(drawn)));
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
    filterDifference();
    position(node, dom, add);
    return off;
  }

  if (node.type === 'LINE') {
    // A line is its stroke: a border, or a thin box filled with its colour.
    const stroke = (node.strokes ?? []).find((paint) => paint.type === 'SOLID');
    if (stroke) {
      const drawn = [parseColor(s.backgroundColor), ...SIDES.filter((side) => s[`border${side}Style`] !== 'none').map((side) => parseColor(s[`border${side}Color`]))];
      if (!drawn.some((color) => sameColor(stroke.color, stroke.opacity, color))) {
        add('line', showColor(stroke.color, stroke.opacity), drawn.filter((c) => c && c.alpha > 0).map(showDom).join(', ') || 'none');
      }
    }
    return off;
  }
  const width = dom.box.right - dom.box.left;
  const height = dom.box.bottom - dom.box.top;
  // The box first, on the axes Figma fixes (a hugging or filling size follows its text and its siblings): when
  // it differs, its padding and gap would only repeat it.
  const [sizingX, sizingY] = node.sizing ?? ['FIXED', 'FIXED'];
  // A box the frame's edge cuts may be built as the part Figma shows (it ends at the viewport) or whole.
  const fits = (dom, figma, shown) => near(dom, figma, SIZE) || (shown !== undefined && near(dom, shown, SIZE));
  const sized = (sizingX !== 'FIXED' || fits(width, node.width, node.shown?.width)) && (sizingY !== 'FIXED' || fits(height, node.height, node.shown?.height));
  if (!sized) add('size', `${round(node.width)}×${round(node.height)}`, `${round(width)}×${round(height)}`);
  if (!near(dom.opacity, opacity, ALPHA)) add('opacity', opacity, round(dom.opacity));
  filterDifference();
  position(node, dom, add);
  if (dom.svg) return off; // an SVG's own shapes are drawn with fill and stroke, not the box properties below

  if (solid) {
    const background = flatBackground(s.backgroundColor, s.backgroundImage) ?? parseColor(s.backgroundColor);
    // A see-through fill is what it shows over what lies behind it: 10 % of a tint over white may be written
    // as the one opaque colour it makes.
    const shown = (() => {
      const behind = parseColor(dom.backdrop);
      if ((solid.opacity ?? 1) >= 0.999 || !background || background.alpha < 0.999 || !behind || behind.alpha < 0.999) return null;
      const a = solid.opacity;
      return toHex(fromHex(solid.color).map((v, k) => v * a + behind.rgb[k] * (1 - a)));
    })();
    if (!sameColor(solid.color, solid.opacity, background) && !(shown && sameColor(shown, 1, background))) {
      add('background', showColor(solid.color, solid.opacity), showDom(background));
    }
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
  } else if (node.cornerSmoothing > 0 && s.clipPath === 'none') {
    add('corner smoothing', `${Math.round(node.cornerSmoothing * 100)} %`, 'none');
  } else if (node.radius != null && !(node.cornerSmoothing > 0) && !['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE'].includes(node.type)) {
    // A vector's corners are in its path, not in a corner radius: the element drawing it may round its box.
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
  const sideRings = new Set();
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
      // Where each drawing sits against the box: a border inside it (outside when the box grew by it), an inset
      // ring inside, an outer ring outside, an outline by its offset, an inset and an outer ring together centred.
      // The element's own drawing, or else a layer of its box drawn over it (dom.overlay).
      const drawings = (st, own) => {
        const lines = own ? border : SIDES.map((side) => ({ width: parseFloat(st[`border${side}Width`]), color: parseColor(st[`border${side}Color`]), style: st[`border${side}Style`] }));
        const ringsOf = own ? rings : parseShadows(st.boxShadow).filter((shadow) => shadow.x === 0 && shadow.y === 0 && shadow.blur === 0 && shadow.spread > 0);
        const offset = parseFloat(st.outlineOffset) || 0;
        const grown = own && near(width, node.width + 2 * w, SIZE) && near(height, node.height + 2 * w, SIZE);
        return [
          lines.every((b) => b.style !== 'none' && near(b.width, w, PX)) && { color: lines[0].color, style: lines[0].style, align: grown ? 'OUTSIDE' : 'INSIDE' },
          st.outlineStyle !== 'none' &&
            near(parseFloat(st.outlineWidth), w, PX) && {
              color: parseColor(st.outlineColor),
              style: st.outlineStyle,
              align: near(offset, -w, PX) ? 'INSIDE' : near(offset, -w / 2, PX) ? 'CENTER' : offset > -PX ? 'OUTSIDE' : 'INSIDE',
            },
          ...ringsOf.filter((ring) => near(ring.spread, w, PX)).map((ring) => ({ color: ring.color, style: 'solid', align: ring.inset ? 'INSIDE' : 'OUTSIDE' })),
          ...ringsOf.flatMap((a, i) =>
            ringsOf
              .slice(i + 1)
              .filter((b) => a.inset !== b.inset && near(a.spread + b.spread, w, PX))
              .map(() => ({ color: a.color, style: 'solid', align: 'CENTER' })),
          ),
        ].filter(Boolean);
      };
      const ownOptions = drawings(s, true);
      const options = ownOptions.length || !dom.overlay ? ownOptions : drawings(dom.overlay, false);
      const found =
        options.find((option) => sameColor(stroke.color, alpha, option.color) && option.align === node.strokeAlign) ??
        options.find((option) => sameColor(stroke.color, alpha, option.color)) ??
        options[0] ??
        null;
      if (!found) add('stroke', `${w} px ${showColor(stroke.color, alpha)}`, 'none');
      else if (!sameColor(stroke.color, alpha, found.color)) add('stroke', `${w} px ${showColor(stroke.color, alpha)}`, `${w} px ${showDom(found.color)}`);
      else if (dashed && !['dashed', 'dotted'].includes(found.style)) add('stroke style', 'dashed', found.style);
      else if (node.strokeAlign && found.align !== node.strokeAlign) add('stroke align', node.strokeAlign.toLowerCase(), found.align.toLowerCase());
    } else {
      // A side may also be an inset shadow moved by the weight towards the inside (inset 0 -1px 0 0 draws a
      // 1 px bottom line).
      const sideShadow = (i, w) =>
        shadows.find(
          (shadow) =>
            shadow.inset &&
            shadow.blur === 0 &&
            shadow.spread === 0 &&
            [
              [0, w],
              [-w, 0],
              [0, -w],
              [w, 0],
            ][i].every((v, k) => near([shadow.x, shadow.y][k], v, PX)),
        );
      // No border on a side: none, or 0 px wide (a reset such as Tailwind's border: 0 solid).
      const absent = (b) => !b || b.style === 'none' || !(b.width >= 0.5);
      weights.forEach((w, i) => {
        if (!w) return;
        const own = border[i];
        const drawn = dom.childSides?.[i];
        const inset = absent(own) ? sideShadow(i, w) : null;
        if (inset) sideRings.add(inset);
        const b = inset
          ? { width: w, color: inset.color, style: 'solid' }
          : absent(own) && !absent(drawn)
            ? { ...drawn, color: parseColor(drawn.color) }
            : own;
        const side = SIDES[i].toLowerCase();
        if (absent(b) || !near(b.width, w, PX)) add(`stroke ${side}`, `${w} px ${showColor(stroke.color, alpha)}`, absent(b) ? 'none' : `${b.width} px`);
        else if (!sameColor(stroke.color, alpha, b.color)) add(`stroke ${side}`, showColor(stroke.color, alpha), showDom(b.color));
      });
    }
  }

  // Shadows and blurs: Figma's blur radius is 2σ, CSS blur() takes σ.
  // A drop shadow may be a filter: drop-shadow() takes the Gaussian's σ, half of box-shadow's blur radius.
  const dropShadows = [...(s.filter ?? '').matchAll(/drop-shadow\(([^()]*(?:\([^)]*\))?[^()]*)\)/g)].map(([, inner]) => {
    const color = parseColor(inner.match(COLOR_FN)?.[0]);
    const [x = 0, y = 0, blur = 0] = inner.replace(COLOR_FN, '').match(/-?[\d.]+px/g)?.map(parseFloat) ?? [];
    return { color, x, y, blur: blur * 2, spread: 0, inset: false };
  });
  const soft = [...shadows.filter((shadow) => !rings.includes(shadow) && !sideRings.has(shadow)), ...dropShadows.filter((shadow) => shadow.color?.alpha > 0)];
  if (soft.length && !(node.effects ?? []).some((effect) => effect.type.endsWith('SHADOW'))) {
    add('shadow', 'none', soft.map((sh) => `${sh.inset ? 'inset ' : ''}${sh.x} ${sh.y} ${sh.blur} ${sh.spread} ${showDom(sh.color)}`).join(', '));
  }
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
    // Found by its box, the element's children need not be Figma's (a build may skip a wrapper frame): the gap
    // is compared only when there are as many, the padding (content against the box) always.
    // A gap exists between two children or more: a frame with one child has an itemSpacing that draws nothing.
    const sameItems =
      (node.childCount === undefined || node.childCount >= 2) &&
      (dom.matchedBy !== 'box' || node.childCount === undefined || node.childCount === dom.children.length);
    const slack = SPACING + (node.childOverhang ?? 0);
    // Figma's default: strokes are not part of the layout (exports leave the default out).
    const included = node.strokesIncludedInLayout ?? false;
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
    if (sameItems && (!node.layoutWrap || node.layoutWrap === 'NO_WRAP') && node.primaryAxisAlignItems && !spaced && items.length > 1) {
      const gaps = items.slice(1).map((item, i) => (vertical ? item.top - items[i].bottom : item.left - items[i].right));
      const wrong = gaps.find((gap) => !near(gap, node.itemSpacing, slack));
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
      // The padding of a frame and of its only Auto Layout child add up when the build draws them as one element.
      const check = (i) => {
        const merged = node.innerPadding ? want(i) + node.innerPadding[i] : null;
        if (!near(edges[i], want(i), slack) && !(merged !== null && near(edges[i], merged, slack))) add(NAMES[i], want(i), round(edges[i]));
      };
      if (hug || align === 'MIN' || (main && spaced)) check(start);
      if (hug || align === 'MAX' || (main && spaced)) check(end);
      if (!hug && align === 'CENTER' && !near(edges[start] - want(start), edges[end] - want(end), slack * 2)) {
        add(`centring ${main ? 'main' : 'cross'}`, 'centred', `${round(edges[start])} / ${round(edges[end])}`);
      }
    }
  }
  return off;
}

/** A colour as an SVG file writes it (#abc, #aabbcc, rgb()), as {rgb, alpha}; none, currentColor and names as null. */
function svgColor(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((value ?? '').trim())?.[1];
  if (hex) return { rgb: fromHex(`#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`), alpha: 1 };
  return parseColor(value);
}

/** A vector's stroke and fill against the shapes of the SVG file its frame is drawn from. */
function iconDifferences(node, shapes) {
  const off = [];
  const stroke = (node.strokes ?? []).find((paint) => paint.type === 'SOLID');
  const weight = node.strokeWeights?.[0];
  if (stroke && weight) {
    const drawn = shapes.filter((shape) => svgColor(shape.stroke));
    if (!drawn.some((shape) => sameColor(stroke.color, stroke.opacity, svgColor(shape.stroke)) && near(shape.strokeWidth, weight, 0.3))) {
      const got = [...new Set(drawn.map((shape) => `${round(shape.strokeWidth)} px ${showDom(svgColor(shape.stroke))}`))];
      off.push({ property: 'icon stroke', figma: `${weight} px ${showColor(stroke.color, stroke.opacity)}`, dom: got.join(', ') || 'none' });
    }
  }
  const fill = (node.fills ?? []).find((paint) => paint.type === 'SOLID');
  if (fill && !shapes.some((shape) => sameColor(fill.color, fill.opacity, svgColor(shape.fill)))) {
    const got = [...new Set(shapes.map((shape) => svgColor(shape.fill)).filter(Boolean).map(showDom))];
    off.push({ property: 'icon fill', figma: showColor(fill.color, fill.opacity), dom: got.join(', ') || 'none' });
  }
  return off;
}

/**
 * Per section: how many nodes were checked (byId through data-node-id, byText by their text), what differs,
 * and how many Figma nodes have no element (texts not found are listed: a changed or missing text; other
 * nodes just lack a data-node-id).
 */
export function compareStyles(nodes, doms) {
  const sections = new Map();
  const missingText = [];
  // Vectors inside an SVG shown with <img>: compared with the file's shapes, through the frame that holds them.
  const icons = nodes.map((node, i) => ({ node, dom: doms[i] })).filter(({ node, dom }) => dom?.shapes?.length && node.type !== 'TEXT');
  const holds = (outer, inner) =>
    inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
  const iconOf = (node) =>
    icons.filter(({ node: frame }) => frame !== node && holds(frame, node)).sort((a, b) => a.node.width * a.node.height - b.node.width * b.node.height)[0];
  // A text repeated in its section is labelled with its node id too, so a difference points at one of them.
  const repeated = new Set(
    nodes
      .filter((node) => node.type === 'TEXT')
      .map((node) => `${node.place.index} ${node.characters.trim()}`)
      .filter((key, i, all) => all.indexOf(key) !== i),
  );
  const widths = [];
  nodes.forEach((node, i) => {
    const entry = sections.get(node.place.index) ?? { checked: 0, off: [], unmatched: 0, byId: 0, byText: 0 };
    sections.set(node.place.index, entry);
    const dom = doms[i];
    if (dom?.inImage) {
      entry.unmatched++;
      return;
    }
    const icon = !dom && node.type !== 'TEXT' ? iconOf(node) : null;
    if (icon) {
      entry.checked++;
      const label = `${node.name} ${node.id} in ${icon.node.name}`;
      for (const difference of iconDifferences(node, icon.dom.shapes)) entry.off.push({ node: node.id, label, ...difference });
      return;
    }
    if (!dom) {
      // A lone "|" is a caret or a divider glyph drawn as text: the build draws it natively or not as text.
      if (node.type === 'TEXT' && node.characters.trim() !== '|') missingText.push({ section: node.place.index, node: node.id, text: node.characters });
      else entry.unmatched++;
      return;
    }
    entry.checked++;
    if (dom.matchedBy === 'id') entry.byId++;
    else if (dom.matchedBy) entry.byText++;
    const text = `«${node.characters?.trim().replace(/\s+/g, ' ').slice(0, 40)}»`;
    const label = node.type !== 'TEXT' ? `${node.name} ${node.id}` : repeated.has(`${node.place.index} ${node.characters.trim()}`) ? `${text} ${node.id}` : text;
    const found = differences(node, dom);
    for (const difference of found) entry.off.push({ node: node.id, label, ...difference });
    const width = textWidth(node, dom, found);
    if (width) widths.push(width);
  });
  const sorted = [...widths].sort((a, b) => a - b);
  return { sections, missingText, textWidth: { count: sorted.length, median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null } };
}

/**
 * How wide a one-line hugging text is drawn against Figma's width for it (build / Figma), when nothing else
 * about its type differs: the same family, size, weight and letter spacing. Over a screen, a median away from
 * 1 says the font files are not the ones Figma draws with (another version of the family), which moves line
 * breaks and centred lines by that much.
 */
function textWidth(node, dom, found) {
  if (node.type !== 'TEXT' || node.textAutoResize !== 'WIDTH_AND_HEIGHT' || !dom.textBox || dom.field || !node.width) return null;
  const line = node.lineHeight?.value;
  if (!line || Math.abs(node.height - line) > 1 || dom.textBox.bottom - dom.textBox.top > line * 1.5) return null;
  if (found.some((difference) => ['font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-transform'].includes(difference.property))) return null;
  const squash = (text) => (text ?? '').replace(/\s+/g, '').toLowerCase();
  if (squash(dom.text) !== squash(node.characters)) return null;
  return (dom.textBox.right - dom.textBox.left) / node.width;
}
