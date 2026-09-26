/* global document, window, getComputedStyle, NodeFilter, Node -- used inside page.evaluate callbacks that run in the browser */
// Every screen at common phone sizes: a strip of screenshots per screen and automatic layout checks.
// A design is usually drawn at one width; this catches what breaks at the others, where there is no reference.
//
//   node scripts/figma-pixel/responsive-audit.mjs                  build + audit every screen
//   node scripts/figma-pixel/responsive-audit.mjs --skip-build     use the existing build
//   node scripts/figma-pixel/responsive-audit.mjs welcome card     only these screens
//   node scripts/figma-pixel/responsive-audit.mjs --fail           exit 1 on findings not in the known file
//   node scripts/figma-pixel/responsive-audit.mjs --update-known   accept the current findings as known
//   node scripts/figma-pixel/responsive-audit.mjs --full-page      screenshot the whole page, not the viewport
//
// Checks, per screen and device:
// - page scrolls sideways: the page is wider than the screen;
// - off-screen: an element is cut by the screen edge (the screenRoot's box); clipping inside it is intended;
// - wider than its box: an element sticks out of the element it sits in;
// - text overflow: text is wider than its own box; text taller than its box: a line wrapped past a fixed height;
// - clipped: part of a text, or of an icon-sized image or SVG, is cut by an ancestor that hides its overflow
//   (hidden or clip, not a scroller): Figma's code puts overflow-clip on every auto-layout frame;
// - covered: at the end of scrolling, content is hidden under an element pinned to the bottom, or a floating
//   one in the lower half (fixed or sticky: a tab bar, a bottom button, a floating action button).
// Decoration under aria-hidden="true" is skipped. Console errors and CSP violations always fail the run.
//
// Screens are the sections/<id>.json files. Output: <dir>/diff/responsive/<id>.png, report.md and results.json.
//
// Known findings: <dir>/responsive-known.json, {screen: [entry]}, where an entry is
//   {"finding": "<kind>: <what>", "maxPx": {"<device name>": <px>, ...}, "reason": "..."}
// and holds only on the listed devices and up to the listed size: the same finding on another device, or
// grown past its size, is new. "maxPx": <px> holds on every device; a bare "<kind>: <what>" string (the
// old format) holds anywhere at any size. --update-known rewrites the audited screens in the first form,
// with the sizes measured now plus 2 px, and keeps each entry's reason. A device without a name, or
// with a name another device shares, is keyed by its size ("360×640", "Android 360×780").
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { loadConfig } from './config.mjs';
import { serveDist } from './serve-dist.mjs';

const config = loadConfig();
const SECTIONS_DIR = join(config.dir, 'sections');
const OUT_DIR = join(config.dir, 'diff', 'responsive');
const KNOWN_FILE = join(config.dir, 'responsive-known.json');
const FREEZE_CSS = `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }`;
const CAPTURE_PATH = '/__figma-pixel-responsive.css';
const SCALE = 0.5;
// --update-known allows this much on top of the measured size: text sets a pixel or two wider on another OS.
const KNOWN_SLACK = 2;

// Strict: a mistyped --fail must not pass CI silently.
const { values: flags, positionals: only } = parseArgs({
  allowPositionals: true,
  options: {
    'skip-build': { type: 'boolean' },
    fail: { type: 'boolean' },
    'update-known': { type: 'boolean' },
    'full-page': { type: 'boolean' },
    config: { type: 'string' },
  },
});
const skipBuild = flags['skip-build'] ?? false;
const fail = flags.fail ?? false;
const updateKnown = flags['update-known'] ?? false;
const fullPage = flags['full-page'] ?? false;

if (!existsSync(SECTIONS_DIR)) throw new Error(`No ${SECTIONS_DIR}: the audit takes its screens from there.`);
const screens = readdirSync(SECTIONS_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => [file.slice(0, -'.json'.length), JSON.parse(readFileSync(join(SECTIONS_DIR, file), 'utf8'))])
  .filter(([id]) => only.length === 0 || only.includes(id));
const unknown = only.filter((id) => !screens.some(([screenId]) => screenId === id));
if (unknown.length > 0) throw new Error(`Unknown screen id: ${unknown.join(', ')} (see ${SECTIONS_DIR})`);
// How responsive-known.json names a device: its name, or its size when it has none or shares it.
const labels = config.devices.map((device) => device.name ?? `${device.width}×${device.height}`);
const deviceKeys = new Map(
  config.devices.map((device, i) => [
    device,
    labels.indexOf(labels[i]) === labels.lastIndexOf(labels[i]) ? labels[i] : `${labels[i]} ${device.width}×${device.height}`,
  ]),
);
const deviceNames = [...deviceKeys.values()];
const knownFile = existsSync(KNOWN_FILE) ? JSON.parse(readFileSync(KNOWN_FILE, 'utf8')) : {};
const known = readKnown(knownFile);

/** {screen: [entry]} with every entry as {finding, maxPx: null | number | {device: px}, reason?}. */
function readKnown(raw) {
  const entries = {};
  for (const [id, list] of Object.entries(raw)) {
    if (id.startsWith('//')) continue;
    if (!Array.isArray(list)) throw new Error(`${KNOWN_FILE}: "${id}" must be a list of findings`);
    entries[id] = list.map((entry) => {
      if (typeof entry === 'string') return { finding: entry, maxPx: null };
      const { finding, maxPx } = entry ?? {};
      const size = (px) => Number.isFinite(px) && px >= 0;
      const sizes =
        size(maxPx) ||
        (maxPx !== null &&
          typeof maxPx === 'object' &&
          Object.keys(maxPx).length > 0 &&
          Object.values(maxPx).every(size));
      // A device name that is not in the config does not match, and the report says which devices it names.
      if (typeof finding !== 'string' || !sizes) {
        throw new Error(
          `${KNOWN_FILE}: ${JSON.stringify(entry)}: expected {"finding": "<kind>: <what>", ` +
            `"maxPx": {"<device name>": <px>} or <px>}; devices: ${deviceNames.join(', ')}`,
        );
      }
      return entry;
    });
  }
  return entries;
}

/** Whether a finding on a device is covered by the known file, and if not, why it is still worth a look. */
function acceptance(id, device, finding) {
  const entries = known[id] ?? [];
  const entry =
    entries.find((candidate) => candidate.finding === keyOf(finding)) ??
    entries.find((candidate) => candidate.maxPx === null && candidate.finding === aliasOf(finding));
  if (!entry) return { known: false };
  const limit = entry.maxPx === null || typeof entry.maxPx === 'number' ? entry.maxPx : entry.maxPx[deviceKeys.get(device)];
  if (entry.maxPx !== null && limit === undefined) {
    return { known: false, note: `known on ${Object.keys(entry.maxPx).join(', ')} only` };
  }
  if (limit !== null && finding.px > limit) return { known: false, note: `known up to ${limit} px` };
  return { known: true };
}

/** Runs in the page: fonts, then images, at most 5 s for the images. Returns the ones still loading. */
async function waitForAssets() {
  await document.fonts.ready;
  const loading = () => [...document.images].filter((img) => !img.complete);
  const loaded = (img) =>
    new Promise((done) => {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  await Promise.race([Promise.all(loading().map(loaded)), new Promise((done) => setTimeout(done, 5000))]);
  return loading().map((img) => img.currentSrc || img.src);
}

/** Runs in the page: what is cut by the screen edge or an ancestor, sticks out of its box, or overflows. */
function inspectWidths(rootSelector) {
  const root = document.querySelector(rootSelector) ?? document.body;
  const edge = root.getBoundingClientRect();
  const findings = [];
  const style = (element) => getComputedStyle(element);
  const hides = (overflow) => overflow === 'hidden' || overflow === 'clip';
  const scrolls = (overflow) => overflow === 'auto' || overflow === 'scroll';
  const outOfFlow = (s) => s.position === 'absolute' || s.position === 'fixed';
  const inside = (set, element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) if (set.has(parent)) return true;
    return false;
  };
  // Without text, the accessible name tells two images or icon buttons of one section apart. The name
  // without it (withLabel false) is how the older known files spelled the same element.
  const describe = (element, withLabel = true) => {
    const label = ['aria-label', 'alt', 'title'].map((name) => element.getAttribute(name)?.trim()).find(Boolean);
    const text = ((element.textContent ?? '').trim().replace(/\s+/g, ' ') || (withLabel && label) || '').slice(0, 40);
    const section = element.closest('[data-section]')?.getAttribute('data-section');
    return `${section ? `[${section}] ` : ''}${element.tagName.toLowerCase()}${text ? ` «${text}»` : ''}`;
  };
  const push = (kind, element, px) => findings.push({ kind, what: describe(element), alias: describe(element, false), px });

  // Content that moves on purpose: an animation that was running when the capture froze it (a marquee, a
  // slider), or a transform other than the identity (a carousel track at its second slide; a section that a
  // scroll-reveal library left at translate3d(0, 0, 0) is not moving).
  const animated = window.__figmaPixelAnimated ?? new Set();
  const IDENTITY = /^(none|matrix\(1, 0, 0, 1, 0, 0\)|matrix3d\(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1\))$/;
  const moves = (element) => animated.has(element) || !IDENTITY.test(style(element).transform);
  // A carousel track: two or more items of one width side by side, each most of the visible width.
  const track = (element) => {
    const items = [...element.children].map((child) => child.getBoundingClientRect()).filter((r) => r.width > 0);
    if (items.length < 2) return false;
    const visible = Math.min(element.getBoundingClientRect().width, element.parentElement?.getBoundingClientRect().width ?? Infinity);
    const sideBySide = items.every((r, i) => i === 0 || r.left >= items[i - 1].right - 1);
    const sameWidth = items.every((r) => Math.abs(r.width - items[0].width) <= 1);
    return sideBySide && sameWidth && items[0].width >= 0.6 * visible;
  };
  const truncates = (s) =>
    s.textOverflow === 'ellipsis' ||
    (s.webkitLineClamp && s.webkitLineClamp !== 'none') ||
    [s.maskImage, s.webkitMaskImage].some((mask) => mask && mask !== 'none');
  // Collapsed on purpose: nothing of its height shows, or a max-height cuts it (a "show more" block).
  const collapses = (element, s) =>
    hides(s.overflowY) && (element.getBoundingClientRect().height < 1 || s.maxHeight !== 'none');
  // A decorative shape: positioned, and nothing in it to read or press.
  const CONTENT = 'img, svg, video, canvas, picture, a, button, input, select, textarea';
  const decoration = (element, s) =>
    outOfFlow(s) && !element.textContent.trim() && !element.matches(CONTENT) && !element.querySelector(CONTENT);
  // The line boxes of the text a block lays out itself: its own text and that of its inline children, not of
  // nested blocks, and not of positioned or hidden parts (a dropdown, a tooltip, a badge).
  const textLines = (element) => {
    const lines = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      let own = true;
      for (let parent = node.parentElement; parent && parent !== element; parent = parent.parentElement) {
        const s = style(parent);
        if (s.display !== 'inline' || outOfFlow(s) || s.visibility === 'hidden') {
          own = false;
          break;
        }
      }
      if (!own) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      lines.push(...[...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0));
    }
    return lines;
  };

  // The page scrolls sideways unless the viewport hides its overflow: html's value, or body's when html's is
  // visible (body { overflow-x: hidden | clip } is the usual guard against decoration past the edge). With
  // html hidden and body a scroller, body is what scrolls.
  const htmlStyle = style(document.documentElement);
  const bodyStyle = style(document.body);
  const viewport = htmlStyle.overflowX !== 'visible' ? htmlStyle.overflowX : bodyStyle.overflowX;
  const scroller = document.scrollingElement ?? document.documentElement;
  const sideways = !hides(viewport)
    ? scroller.scrollWidth - scroller.clientWidth
    : htmlStyle.overflowX !== 'visible' && scrolls(bodyStyle.overflowX)
      ? document.body.scrollWidth - document.body.clientWidth
      : 0;
  if (sideways > 1) findings.push({ kind: 'page scrolls sideways', what: 'page', px: sideways });

  // What cannot be seen is skipped: hidden by visibility or opacity, and screen-reader-only boxes of 1×1 px.
  const invisible = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 1 && rect.height <= 1) return true;
    return element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false;
  };
  const unseen = new Set();
  const elements = [...root.querySelectorAll('*')].filter((element) => {
    if (element.closest('[aria-hidden="true"]') || inside(unseen, element) || invisible(element)) {
      unseen.add(element);
      return false;
    }
    return true;
  });

  // Only the outermost offender of each kind is reported: its children stick out with it.
  const offScreen = new Set();
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || decoration(element, style(element))) continue;
    let left = rect.left;
    let right = rect.right;
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (style(parent).overflowX === 'visible') continue;
      const box = parent.getBoundingClientRect();
      left = Math.max(left, box.left);
      right = Math.min(right, box.right);
    }
    const over = Math.max(right - edge.right, edge.left - left);
    if (over <= 1 || right <= left) continue;
    offScreen.add(element);
    if (!inside(offScreen, element)) push('off-screen', element, over);
  }

  const bursting = new Set();
  for (const element of elements) {
    const parent = element.parentElement;
    if (!parent || parent === root) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const s = style(element);
    if (s.position === 'fixed' || decoration(element, s)) continue;
    // A badge or a dot placed past its parent's corner on purpose (right: -6px) overhangs by design.
    if (s.position === 'absolute' && ['top', 'right', 'bottom', 'left'].some((side) => parseFloat(s[side]) < 0)) continue;
    const parentStyle = style(parent);
    // A parent that clips or scrolls (image crops, carousels) shows only what it means to, and so does a
    // track that moves or lines up its items (a carousel, a marquee).
    if (parentStyle.overflowX !== 'visible' || moves(parent) || track(parent)) continue;
    const box = parent.getBoundingClientRect();
    // Flow content is measured against the parent's content box, positioned content against its border box.
    // A negative margin is an intended bleed (a full-width scroller inside a padded column): it is allowed.
    const inset = (side) =>
      (s.position === 'absolute' ? 0 : parseFloat(parentStyle[`padding${side}`]) + parseFloat(parentStyle[`border${side}Width`])) -
      Math.max(0, -parseFloat(s[`margin${side}`]) || 0);
    const over = Math.max(rect.right - (box.right - inset('Right')), box.left + inset('Left') - rect.left);
    if (over <= 1) continue;
    bursting.add(element);
    if (!inside(bursting, element)) push('wider than its box', element, over);
  }

  // Text that does not fit its own box: wider (or cut by an ellipsis), or taller, a line that wrapped inside
  // a fixed height. Measured by the text's own lines, so a tight line height (the glyphs are taller than the
  // line), pseudo-elements and hidden dropdowns do not count; scrollers, form controls, intended truncation
  // and collapsed blocks neither.
  const overflowing = new Set();
  const lineHeight = (s) => parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
  for (const element of elements) {
    const s = style(element);
    if (s.display === 'inline' || element.closest('select, textarea')) continue;
    const lines = textLines(element);
    if (!lines.length) continue;
    const box = element.getBoundingClientRect();
    const edgeOf = (side) => parseFloat(s[`padding${side}`]) + parseFloat(s[`border${side}Width`]);
    const minLeft = Math.min(...lines.map((line) => line.left));
    const maxRight = Math.max(...lines.map((line) => line.right));
    // Text entirely outside a box that hides it is an image replacement (text-indent: -9999px).
    const replaced = hides(s.overflowX) && (maxRight <= box.left || minLeft >= box.right);
    const extra = Math.max(maxRight - (box.right - edgeOf('Right')), box.left + edgeOf('Left') - minLeft);
    if (!replaced && !scrolls(s.overflowX) && extra > 1) {
      push(s.textOverflow === 'ellipsis' ? 'text cut by an ellipsis' : 'text overflow', element, extra);
      overflowing.add(element);
    }
    if (scrolls(s.overflowY) || truncates(s) || collapses(element, s)) continue;
    const extraY = Math.max(...lines.map((line) => line.bottom)) - (box.bottom - parseFloat(s.borderBottomWidth));
    if (extraY > lineHeight(s) / 2) {
      push('text taller than its box', element, extraY);
      overflowing.add(element);
    }
  }

  // Clipped: text or an icon cut by an ancestor that hides its overflow, e.g. a chevron pushed out of a row
  // that grew too narrow. Only what sits in the normal flow between the two counts. A carousel track or a
  // marquee, a collapsed block, an intended truncation or fade and a rounded crop of an image are hidden on
  // purpose, and so is decoration, except an icon inside a control (a hidden chevron in a row link).
  const CONTROL = 'a, button, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"]';
  const icons = [...root.querySelectorAll('img, svg')].filter((element) => {
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1 || box.width > 48 || box.height > 48 || element.parentElement?.closest('svg')) return false;
    if (element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) return false;
    const decorative =
      element.closest('[aria-hidden="true"]') ||
      (element.tagName === 'IMG' && element.getAttribute('alt') === '') ||
      ['presentation', 'none'].includes(element.getAttribute('role'));
    return !decorative || element.closest(CONTROL);
  });
  const texts = elements.filter((element) => {
    const s = style(element);
    return !overflowing.has(element) && !hides(s.overflowX) && !hides(s.overflowY) && textLines(element).length > 0;
  });
  const clipped = new Set();
  for (const element of [...icons, ...texts]) {
    const s = style(element);
    if (outOfFlow(s) || moves(element)) continue;
    const icon = icons.includes(element);
    const box = element.getBoundingClientRect();
    let rect = box;
    let vertical = true;
    if (!icon) {
      // Text by its own glyphs horizontally and by its lines less the half-leading vertically.
      const lines = textLines(element);
      const leading = Math.max(0, (lineHeight(s) - parseFloat(s.fontSize)) / 2);
      rect = {
        left: Math.min(...lines.map((line) => line.left)),
        right: Math.max(...lines.map((line) => line.right)),
        top: box.top + leading,
        bottom: box.bottom - leading,
      };
      vertical = s.display !== 'inline';
    }
    if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) continue;
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
      const parentStyle = style(parent);
      const x = hides(parentStyle.overflowX);
      const y = hides(parentStyle.overflowY);
      if (moves(parent) || truncates(parentStyle) || track(parent)) break;
      if (!x && !y) {
        // An ancestor taken out of the flow may escape the clipping boxes further up.
        if (outOfFlow(parentStyle)) break;
        continue;
      }
      const outer = parent.getBoundingClientRect();
      if (collapses(parent, parentStyle) || (x && outer.width < 1)) break;
      if (icon && parseFloat(parentStyle.borderTopLeftRadius) + parseFloat(parentStyle.borderBottomRightRadius) > 0) break;
      const margin = [parentStyle.overflowX, parentStyle.overflowY].includes('clip') ? parseFloat(parentStyle.overflowClipMargin) || 0 : 0;
      const border = (side) => parseFloat(parentStyle[`border${side}Width`]);
      const cutX = x ? Math.max(rect.right - (outer.right - border('Right') + margin), outer.left + border('Left') - margin - rect.left) : 0;
      const cutY = y && vertical ? Math.max(rect.bottom - (outer.bottom - border('Bottom') + margin), outer.top + border('Top') - margin - rect.top) : 0;
      if (Math.max(cutX, cutY) <= 1) continue;
      clipped.add(element);
      if (!inside(clipped, element)) push('clipped', element, Math.max(cutX, cutY));
      break;
    }
  }
  return findings;
}

/** Runs in the page: scrolls everything to the end and finds content hidden under pinned elements. */
function inspectCovered() {
  const all = [...document.querySelectorAll('*')];
  for (const element of all) {
    const { overflowY } = getComputedStyle(element);
    if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) {
      element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
    }
  }
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  const height = window.innerHeight;
  // Without text, the accessible name tells two images or icon buttons of one section apart. The name
  // without it (withLabel false) is how the older known files spelled the same element.
  const describe = (element, withLabel = true) => {
    const label = ['aria-label', 'alt', 'title'].map((name) => element.getAttribute(name)?.trim()).find(Boolean);
    const text = ((element.textContent ?? '').trim().replace(/\s+/g, ' ') || (withLabel && label) || '').slice(0, 40);
    const section = element.closest('[data-section]')?.getAttribute('data-section');
    return `${section ? `[${section}] ` : ''}${element.tagName.toLowerCase()}${text ? ` «${text}»` : ''}`;
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.opacity !== '0' && !element.closest('[aria-hidden="true"]');
  };
  // Pinned in the lower half: a bar on the bottom edge, or a floating button above it. Toasts, cookie cards and
  // other announcements (live regions, a region or dialog that is itself the floating card) float over the
  // content by design; a button inside a dialog does not. A sticky element counts only when the page is what
  // it sticks to, not an inner scroller (a group header in a scrolling card).
  const announcement = (element) =>
    element.closest('[role="status"], [role="alert"], [role="log"], [aria-live]:not([aria-live="off"])') ||
    ['region', 'dialog', 'alertdialog'].includes(element.getAttribute('role'));
  const innerScroller = (element) => {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const { overflowY } = getComputedStyle(parent);
      if (overflowY !== 'visible' && overflowY !== 'clip') return true;
    }
    return false;
  };
  const pinned = all.filter((element) => {
    const { position } = getComputedStyle(element);
    if (position !== 'fixed' && position !== 'sticky') return false;
    if (position === 'sticky' && innerScroller(element)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.top <= height / 2 || rect.top >= height || !visible(element)) return false;
    return rect.bottom >= height - 1 || !announcement(element);
  });
  if (pinned.length === 0) return [];
  // With a dialog open, the page behind it is meant to be covered: only the dialog's own content counts.
  const dialog = [...document.querySelectorAll('[aria-modal="true"], [role="dialog"], dialog[open]')].find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    const shown = candidate.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false;
    return shown && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < window.innerWidth;
  });
  const targets = all.filter((element) => {
    if (dialog && !dialog.contains(element)) return false;
    if (pinned.some((pin) => pin.contains(element)) || !visible(element)) return false;
    const interactive = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName);
    const hasText = [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '',
    );
    return interactive || hasText;
  });
  // A control by its box; text by its own lines, so a short line beside a floating corner button is not under it.
  const areas = (target) => {
    if (['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return [target.getBoundingClientRect()];
    return [...target.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '')
      .flatMap((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return [...range.getClientRects()];
      });
  };
  const findings = [];
  for (const target of targets) {
    const rects = areas(target).filter((rect) => rect.width > 0 && rect.height > 0);
    const hit = pinned
      .flatMap((pin) => rects.map((rect) => ({ pin, rect, box: pin.getBoundingClientRect() })))
      .map(({ pin, rect, box }) => {
        const top = Math.max(rect.top, box.top);
        const bottom = Math.min(rect.bottom, box.bottom);
        const left = Math.max(rect.left, box.left);
        const right = Math.min(rect.right, box.right);
        if (bottom - top <= 1 || right - left <= 1) return null;
        // Only when the pinned element really is on top at that spot.
        const onTop = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        return onTop && pin.contains(onTop) ? { pin, px: bottom - top } : null;
      })
      .find(Boolean);
    if (!hit) continue;
    findings.push({
      kind: 'covered',
      what: `${describe(target)} under ${describe(hit.pin)}`,
      alias: `${describe(target, false)} under ${describe(hit.pin, false)}`,
      px: hit.px,
    });
  }
  return findings;
}

const keyOf = (finding) => `${finding.kind}: ${finding.what}`;
const aliasOf = (finding) => `${finding.kind}: ${finding.alias ?? finding.what}`;

if (!skipBuild && config.build && !config.baseUrl) execSync(config.build, { stdio: 'inherit' });
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
const server = config.baseUrl ? null : await serveDist({ root: config.dist, port: 0 });
const baseUrl = config.baseUrl ?? `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: config.chromiumArgs });
const report = [];

try {
  for (const [id, screen] of screens) {
    const url = new URL((screen.url ?? config.url).replaceAll('{id}', id), baseUrl);
    const shots = [];
    const devices = [];
    for (const device of config.devices) {
      const context = await browser.newContext({
        viewport: { width: device.width, height: device.height },
        deviceScaleFactor: 1,
      });
      // Served from the page's own origin, so a CSP with style-src 'self' stays enforced.
      const captureUrl = new URL(CAPTURE_PATH, url).href;
      const css = [FREEZE_CSS, config.captureCss, device.captureCss ?? ''].join('\n');
      await context.route(captureUrl, (route) => route.fulfill({ contentType: 'text/css; charset=utf-8', body: css }));
      await context.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.error(`CSP violation: ${event.violatedDirective} (${event.blockedURI || 'inline'})`);
        });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url.href, { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        // Only what is still moving: a finished entrance animation that holds its end state is not a track.
        window.__figmaPixelAnimated = new Set(
          document
            .getAnimations()
            .filter((animation) => animation.playState === 'running')
            .map((animation) => animation.effect?.target)
            .filter(Boolean),
        );
      });
      await page.addStyleTag({ url: captureUrl });
      const pending = await page.evaluate(waitForAssets);
      if (pending.length) {
        console.warn(`${id} (${deviceKeys.get(device)}): images still loading after 5 s: ${pending.join(', ')}`);
      }
      const widths = await page.evaluate(inspectWidths, config.screenRoot);
      const png = await page.screenshot({ fullPage });
      const covered = await page.evaluate(inspectCovered);
      await context.close();

      shots.push({ device, png: png.toString('base64') });
      const findings = [...widths, ...covered].map((finding) => {
        const measured = { ...finding, px: Math.round(finding.px) };
        return { ...measured, ...acceptance(id, device, measured) };
      });
      const name = deviceKeys.get(device);
      devices.push({ name, device: `${device.name ?? 'Device'} ${device.width}×${device.height}`, findings, errors });
    }

    // One strip per screen: every size at the same scale, labelled.
    const sheet = await browser.newPage({ viewport: { width: 1600, height: 800 } });
    await sheet.setContent(`<body style="margin:0;background:#2b3440;font:13px system-ui;color:#fff">
      <div id="strip" style="display:inline-flex;gap:16px;padding:16px;align-items:flex-start">
      ${shots
        .map(
          ({ device, png }) => `<figure style="margin:0">
            <figcaption style="margin-bottom:6px">${device.name} · ${device.width}×${device.height}</figcaption>
            <img src="data:image/png;base64,${png}" style="width:${device.width * SCALE}px;display:block;outline:1px solid #556">
          </figure>`,
        )
        .join('')}
      </div></body>`);
    await sheet.locator('#strip').screenshot({ path: join(OUT_DIR, `${id}.png`) });
    await sheet.close();

    report.push({ id, devices });
    const fresh = devices.reduce((sum, d) => sum + d.findings.filter((f) => !f.known).length, 0);
    const accepted = devices.reduce((sum, d) => sum + d.findings.filter((f) => f.known).length, 0);
    const errors = devices.reduce((sum, d) => sum + d.errors.length, 0);
    const notes = [
      fresh ? `${fresh} new` : '',
      accepted ? `${accepted} known` : '',
      errors ? `${errors} console errors` : '',
    ].filter(Boolean);
    console.log(`${id.padEnd(28)} ${notes.length ? notes.join(', ') : 'ok'}`);
  }
} finally {
  await browser.close();
  server?.close();
}

const lines = [
  '# Responsive audit',
  '',
  `Devices: ${config.devices.map((d) => `${d.name} ${d.width}×${d.height}`).join(', ')}.`,
  'Screenshots of every size side by side: `<screen>.png` in this folder. Known findings',
  `(\`${KNOWN_FILE}\`) are listed separately and do not fail \`--fail\`.`,
  '',
];
for (const { id, devices } of report) {
  lines.push(`## ${id}`, '');
  const fresh = devices.filter((d) => d.errors.length || d.findings.some((f) => !f.known));
  if (fresh.length === 0) lines.push('No new findings.');
  for (const d of fresh) {
    lines.push(`- **${d.device}**`);
    for (const f of d.findings.filter((f) => !f.known)) {
      lines.push(`  - ${keyOf(f)} — ${f.px} px${f.note ? ` (${f.note})` : ''}`);
    }
    for (const e of d.errors) lines.push(`  - console error: ${e}`);
  }
  const accepted = [...new Set(devices.flatMap((d) => d.findings.filter((f) => f.known).map(keyOf)))];
  if (accepted.length) lines.push('', `Known: ${accepted.map((k) => `\`${k}\``).join('; ')}`);
  const seen = new Set(devices.flatMap((d) => d.findings.flatMap((f) => [keyOf(f), aliasOf(f)])));
  const gone = (known[id] ?? []).filter((entry) => !seen.has(entry.finding)).map((entry) => entry.finding);
  if (gone.length) {
    lines.push('', `Known but not found any more (drop with --update-known): ${gone.map((k) => `\`${k}\``).join('; ')}`);
  }
  lines.push('');
}
writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'));
writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(report, null, 2));
console.log(`\nReport: ${join(OUT_DIR, 'report.md')}`);

if (updateKnown) {
  // Screens that were not audited keep their entries as written.
  const next = { ...knownFile };
  for (const { id, devices } of report) {
    const entries = new Map();
    for (const d of devices) {
      for (const f of d.findings) {
        const entry = entries.get(keyOf(f)) ?? { finding: keyOf(f), maxPx: {} };
        entry.maxPx[d.name] = Math.max(entry.maxPx[d.name] ?? 0, f.px + KNOWN_SLACK);
        entries.set(entry.finding, entry);
      }
    }
    const reasons = new Map((known[id] ?? []).filter((entry) => entry.reason).map((e) => [e.finding, e.reason]));
    const list = [...entries.values()]
      .sort((a, b) => a.finding.localeCompare(b.finding))
      .map((entry) => (reasons.has(entry.finding) ? { ...entry, reason: reasons.get(entry.finding) } : entry));
    if (list.length) next[id] = list;
    else delete next[id];
  }
  writeFileSync(KNOWN_FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Wrote ${KNOWN_FILE}`);
}

const broken = report.flatMap(({ id, devices }) => devices.flatMap((d) => d.errors.map((e) => `${id} (${d.device}): ${e}`)));
if (broken.length > 0) {
  console.error(`\nConsole errors or CSP violations:\n  ${broken.join('\n  ')}`);
  process.exitCode = 1;
}
if (fail && !updateKnown) {
  const fresh = report.flatMap(({ id, devices }) =>
    devices.flatMap((d) =>
      d.findings
        .filter((f) => !f.known)
        .map((f) => `${id} (${d.device}): ${keyOf(f)} — ${f.px} px${f.note ? ` (${f.note})` : ''}`),
    ),
  );
  if (fresh.length > 0) {
    console.error(`\nNew findings:\n  ${fresh.join('\n  ')}`);
    process.exitCode = 1;
  }
}
