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
// Screens are the sections/<id>.json files. Known findings: <dir>/responsive-known.json, {screen: [finding]}.
// Output: <dir>/diff/responsive/<id>.png, report.md and results.json.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const fail = args.includes('--fail');
const updateKnown = args.includes('--update-known');
const fullPage = args.includes('--full-page');
const only = args.filter((arg) => !arg.startsWith('--'));

if (!existsSync(SECTIONS_DIR)) throw new Error(`No ${SECTIONS_DIR}: the audit takes its screens from there.`);
const screens = readdirSync(SECTIONS_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => [file.slice(0, -'.json'.length), JSON.parse(readFileSync(join(SECTIONS_DIR, file), 'utf8'))])
  .filter(([id]) => only.length === 0 || only.includes(id));
const unknown = only.filter((id) => !screens.some(([screenId]) => screenId === id));
if (unknown.length > 0) throw new Error(`Unknown screen id: ${unknown.join(', ')} (see ${SECTIONS_DIR})`);
const known = existsSync(KNOWN_FILE) ? JSON.parse(readFileSync(KNOWN_FILE, 'utf8')) : {};

/** Runs in the page: what is cut by the screen edge, sticks out of its box, or has text wider than its box. */
function inspectWidths(rootSelector) {
  const root = document.querySelector(rootSelector) ?? document.body;
  const edge = root.getBoundingClientRect();
  const inside = (set, element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) if (set.has(parent)) return true;
    return false;
  };
  const describe = (element) => {
    const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const section = element.closest('[data-section]')?.getAttribute('data-section');
    return `${section ? `[${section}] ` : ''}${element.tagName.toLowerCase()}${text ? ` «${text}»` : ''}`;
  };
  const findings = [];
  const elements = [...root.querySelectorAll('*')].filter((element) => !element.closest('[aria-hidden="true"]'));

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
    if (!inside(offScreen, element)) findings.push({ kind: 'off-screen', what: describe(element), px: over });
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
    const inset = (side) =>
      style.position === 'absolute'
        ? 0
        : parseFloat(parentStyle[`padding${side}`]) + parseFloat(parentStyle[`border${side}Width`]);
    const over = Math.max(rect.right - (box.right - inset('Right')), box.left + inset('Left') - rect.left);
    if (over <= 1) continue;
    bursting.add(element);
    if (!inside(bursting, element)) findings.push({ kind: 'wider than its box', what: describe(element), px: over });
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
      findings.push({ kind, what: describe(element), px: extra });
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
  const describe = (element) => {
    const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
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
      findings.push({ kind: 'covered', what: `${describe(target)} under ${describe(pin)}`, px: bottom - top });
      break;
    }
  }
  return findings;
}

const keyOf = (finding) => `${finding.kind}: ${finding.what}`;

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
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.images].map((img) =>
            img.complete ? null : new Promise((done) => (img.onload = img.onerror = done)),
          ),
        );
      });
      const widths = await page.evaluate(inspectWidths, config.screenRoot);
      const png = await page.screenshot({ fullPage });
      const covered = await page.evaluate(inspectCovered);
      await context.close();

      shots.push({ device, png: png.toString('base64') });
      const findings = [...widths, ...covered].map((finding) => ({
        ...finding,
        px: Math.round(finding.px),
        known: (known[id] ?? []).includes(keyOf(finding)),
      }));
      devices.push({ device: `${device.name} ${device.width}×${device.height}`, findings, errors });
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
    for (const f of d.findings.filter((f) => !f.known)) lines.push(`  - ${keyOf(f)} — ${f.px} px`);
    for (const e of d.errors) lines.push(`  - console error: ${e}`);
  }
  const accepted = [...new Set(devices.flatMap((d) => d.findings.filter((f) => f.known).map(keyOf)))];
  if (accepted.length) lines.push('', `Known: ${accepted.map((k) => `\`${k}\``).join('; ')}`);
  lines.push('');
}
writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'));
writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(report, null, 2));
console.log(`\nReport: ${join(OUT_DIR, 'report.md')}`);

if (updateKnown) {
  const next = { ...known };
  for (const { id, devices } of report) {
    const keys = [...new Set(devices.flatMap((d) => d.findings.map(keyOf)))].sort();
    if (keys.length) next[id] = keys;
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
    devices.flatMap((d) => d.findings.filter((f) => !f.known).map((f) => `${id} (${d.device}): ${keyOf(f)}`)),
  );
  if (fresh.length > 0) {
    console.error(`\nNew findings:\n  ${fresh.join('\n  ')}`);
    process.exitCode = 1;
  }
}
