/* global document, window, getComputedStyle, Node -- used inside page.evaluate callbacks that run in the browser */
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
// - off-screen: an element is cut by the screen edge (the screenRoot's box); clipping inside it is intended;
// - wider than its box: an element sticks out of the element it sits in;
// - text overflow: text is wider than its own box;
// - covered: at the end of scrolling, content is hidden under an element pinned to the bottom (fixed or sticky).
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
const FREEZE_CSS = `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }`;
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

/** Runs in the page: what is cut by the screen edge, sticks out of its box, or has text wider than its box. */
function inspectWidths(rootSelector) {
  const root = document.querySelector(rootSelector) ?? document.body;
  const edge = root.getBoundingClientRect();
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
  // What cannot be seen is skipped: hidden by visibility or opacity, and screen-reader-only boxes of 1×1 px.
  const invisible = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 1 && rect.height <= 1) return true;
    return element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false;
  };
  const findings = [];
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
    if (rect.width === 0 || rect.height === 0) continue;
    let left = rect.left;
    let right = rect.right;
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowX === 'visible') continue;
      const box = parent.getBoundingClientRect();
      left = Math.max(left, box.left);
      right = Math.min(right, box.right);
    }
    const over = Math.max(right - edge.right, edge.left - left);
    if (over <= 1 || right <= left) continue;
    offScreen.add(element);
    if (!inside(offScreen, element)) {
      findings.push({ kind: 'off-screen', what: describe(element), alias: describe(element, false), px: over });
    }
  }

  const bursting = new Set();
  for (const element of elements) {
    const parent = element.parentElement;
    if (!parent || parent === root) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const style = getComputedStyle(element);
    if (style.position === 'fixed') continue;
    const parentStyle = getComputedStyle(parent);
    // A parent that clips or scrolls (image crops, carousels) shows only what it means to.
    if (parentStyle.overflowX !== 'visible') continue;
    const box = parent.getBoundingClientRect();
    // Flow content is measured against the parent's content box, positioned content against its border box.
    // A negative margin is an intended bleed (a full-width scroller inside a padded column): it is allowed.
    const inset = (side) =>
      (style.position === 'absolute'
        ? 0
        : parseFloat(parentStyle[`padding${side}`]) + parseFloat(parentStyle[`border${side}Width`])) -
      Math.max(0, -parseFloat(style[`margin${side}`]) || 0);
    const over = Math.max(rect.right - (box.right - inset('Right')), box.left + inset('Left') - rect.left);
    if (over <= 1) continue;
    bursting.add(element);
    if (!inside(bursting, element)) {
      findings.push({ kind: 'wider than its box', what: describe(element), alias: describe(element, false), px: over });
    }
  }

  for (const element of elements) {
    const hasText = [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '',
    );
    if (!hasText) continue;
    const style = getComputedStyle(element);
    if (style.display === 'inline') continue;
    const extra = element.scrollWidth - element.clientWidth;
    if (extra > 1) {
      const kind = style.textOverflow === 'ellipsis' ? 'text cut by an ellipsis' : 'text overflow';
      findings.push({ kind, what: describe(element), alias: describe(element, false), px: extra });
    }
  }
  return findings;
}

/** Runs in the page: scrolls everything to the end and finds content hidden under bottom-pinned elements. */
function inspectCovered() {
  const all = [...document.querySelectorAll('*')];
  for (const element of all) {
    const { overflowY } = getComputedStyle(element);
    if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) {
      element.scrollTop = element.scrollHeight;
    }
  }
  window.scrollTo(0, document.documentElement.scrollHeight);
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
  const pinned = all.filter((element) => {
    const { position } = getComputedStyle(element);
    if (position !== 'fixed' && position !== 'sticky') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom >= height - 1 && rect.top > height / 2 && visible(element);
  });
  if (pinned.length === 0) return [];
  // With a dialog open, the page behind it is meant to be covered: only the dialog's own content counts.
  const dialog = document.querySelector('[aria-modal="true"], [role="dialog"], dialog[open]');
  const targets = all.filter((element) => {
    if (dialog && !dialog.contains(element)) return false;
    if (pinned.some((pin) => pin.contains(element)) || !visible(element)) return false;
    const interactive = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName);
    const hasText = [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '',
    );
    return interactive || hasText;
  });
  const findings = [];
  for (const target of targets) {
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    for (const pin of pinned) {
      const box = pin.getBoundingClientRect();
      const top = Math.max(rect.top, box.top);
      const bottom = Math.min(rect.bottom, box.bottom);
      const left = Math.max(rect.left, box.left);
      const right = Math.min(rect.right, box.right);
      if (bottom - top <= 1 || right - left <= 1) continue;
      // Only when the pinned element really is on top at that spot.
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      if (!hit || !pin.contains(hit)) continue;
      findings.push({
        kind: 'covered',
        what: `${describe(target)} under ${describe(pin)}`,
        alias: `${describe(target, false)} under ${describe(pin, false)}`,
        px: bottom - top,
      });
      break;
    }
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
const browser = await chromium.launch();
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
