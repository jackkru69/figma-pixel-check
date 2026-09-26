/* global document, window -- used inside page.evaluate callbacks that run in the browser */
// Per-section pixel diff of the built app against reference PNGs exported from Figma.
//
//   node scripts/figma-pixel/pixel-diff.mjs                   build + compare every screen
//   node scripts/figma-pixel/pixel-diff.mjs --skip-build      compare the existing build
//   node scripts/figma-pixel/pixel-diff.mjs welcome card      only these screens
//   node scripts/figma-pixel/pixel-diff.mjs --max-section=15  exit 1 when a section differs by more than 15 %
//   node scripts/figma-pixel/pixel-diff.mjs --max-geometry=1  exit 1 when a section's top or height is off by more than 1 px
//   node scripts/figma-pixel/pixel-diff.mjs --config=<file>   settings file other than figma-pixel.config.json
//
// Every section is cropped from its OWN top in both images and only the overlap is compared, so a height
// change in one section cannot inflate the numbers of every section below it. Figma sections are matched to
// [data-section] elements by name. Settings and their defaults: config.mjs.
//
// Geometry follows the same rule: Δ top is the section's own displacement, the smaller of its shift against
// the frame and its shift against the bottom of the section above. A section pushed down by a taller section
// above is not blamed, and neither is a bar pinned to the screen edge. A section may override both limits
// with "maxGeometry" (px) and "maxMismatch" (%) in the sections file, with a "reason" shown in the report.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { loadConfig } from './config.mjs';
import { serveDist } from './serve-dist.mjs';

const config = loadConfig();
const REF_DIR = join(config.dir, 'reference');
const SECTIONS_DIR = join(config.dir, 'sections');
const OUT_DIR = join(config.dir, 'diff');
// Freezes anything that moves; the project's own capture CSS (safe areas and the like) goes after it.
const CAPTURE_CSS = `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
${config.captureCss}`;
// Served from the page's own origin, so a CSP with style-src 'self' stays enforced during capture.
const CAPTURE_PATH = '/__figma-pixel-capture.css';

// Strict: a mistyped limit must fail the run, not switch the CI check off.
const { values: flags, positionals: only } = parseArgs({
  allowPositionals: true,
  options: {
    'skip-build': { type: 'boolean' },
    'max-section': { type: 'string' },
    'max-geometry': { type: 'string' },
    config: { type: 'string' },
  },
});
const skipBuild = flags['skip-build'] ?? false;
const limitFlag = (name) => {
  if (flags[name] === undefined) return NaN;
  const limit = Number(flags[name]);
  if (flags[name].trim() === '' || !Number.isFinite(limit) || limit < 0) {
    throw new Error(`--${name}=${flags[name]}: expected a number ≥ 0`);
  }
  return limit;
};
const maxSection = limitFlag('max-section');
const maxGeometry = limitFlag('max-geometry');

if (!existsSync(SECTIONS_DIR)) {
  throw new Error(`No ${SECTIONS_DIR}: add one sections/<id>.json per screen (see references/method.md).`);
}
// sections/<id>.json: reference PNG, frame size and the sections {name, top, height} of one screen.
const screens = readdirSync(SECTIONS_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => [file.slice(0, -'.json'.length), readScreen(join(SECTIONS_DIR, file))])
  .filter(([id]) => only.length === 0 || only.includes(id));
const unknown = only.filter((id) => !screens.some(([screenId]) => screenId === id));
if (unknown.length > 0) throw new Error(`Unknown screen id: ${unknown.join(', ')} (see ${SECTIONS_DIR})`);

function readScreen(file) {
  const screen = JSON.parse(readFileSync(file, 'utf8'));
  const sizes = [screen.width, screen.height].every((value) => Number.isInteger(value) && value > 0);
  const sections =
    Array.isArray(screen.sections) &&
    screen.sections.length > 0 &&
    screen.sections.every(
      (s) => typeof s.name === 'string' && Number.isFinite(s.top) && Number.isFinite(s.height),
    );
  if (typeof screen.reference !== 'string' || !sizes || !sections) {
    throw new Error(
      `${file}: expected {reference, width, height, sections: [{name, top, height}, ...]} with integer sizes`,
    );
  }
  for (const section of screen.sections) {
    for (const key of ['maxGeometry', 'maxMismatch']) {
      if (key in section && !(Number.isFinite(section[key]) && section[key] >= 0)) {
        throw new Error(`${file}: section "${section.name}": ${key} must be a number ≥ 0`);
      }
    }
  }
  // Fractional boxes (hand-copied from figma-boxes.py) are snapped by their edges, as Chromium paints them.
  const sectionsSnapped = screen.sections.map((section) => ({ ...section, ...snap(section.top, section.height) }));
  const empty = sectionsSnapped.find((section) => section.height <= 0);
  if (empty) throw new Error(`${file}: section "${empty.name}" has no height`);
  return { ...screen, sections: sectionsSnapped };
}

/** Whole-pixel top and height of a box with fractional edges: each edge is rounded, not the size. */
function snap(top, height) {
  const snappedTop = Math.round(top);
  return { top: snappedTop, height: Math.round(top + height) - snappedTop };
}

function crop(png, top, height) {
  const out = new PNG({ width: png.width, height });
  for (let y = 0; y < height; y++) {
    const srcY = top + y;
    if (srcY < 0 || srcY >= png.height) continue;
    png.data.copy(out.data, y * png.width * 4, srcY * png.width * 4, (srcY + 1) * png.width * 4);
  }
  return out;
}

function compare(expected, actual) {
  const width = Math.min(expected.width, actual.width);
  const height = Math.min(expected.height, actual.height);
  const a = crop(expected, 0, height);
  const b = crop(actual, 0, height);
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: config.threshold,
    // A transparent pixel in the Figma export is compared as white, as the browser paints an empty page.
    checkerboard: false,
    // Red: the build is lighter than Figma there (ink missing); blue: the build is darker (extra ink).
    diffColorAlt: [0, 110, 255],
  });
  return { mismatched, total: width * height, diff };
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

// A repeated name matches its n-th occurrence, so two "row" sections pair up in order.
function matchSections(figmaSections, domSections) {
  const used = new Set();
  const matched = figmaSections.map((figma) => {
    const index = domSections.findIndex((dom, i) => !used.has(i) && dom.name === figma.name);
    if (index === -1) return { figma, dom: null };
    used.add(index);
    return { figma, dom: domSections[index] };
  });
  const extra = domSections.filter((_, i) => !used.has(i)).map((dom) => dom.name);
  return { matched, extra };
}

/** The section in the DOM whose Figma bottom is the closest one above this top: nested sections are skipped. */
function closestAbove(figma, boxes) {
  const bottom = (box) => box.figma.top + box.figma.height;
  return boxes
    .filter((box) => box.dom && box.figma !== figma && bottom(box) <= figma.top)
    .reduce((best, box) => (best && bottom(best) >= bottom(box) ? best : box), null);
}

// Δ top is the smaller of the shift against the frame and the shift against the bottom of the closest
// section above that is in the DOM: flow content follows the section above, a pinned bar follows the frame.
// Both boxes are whole pixels (snapped by their edges), so the deltas are what the report shows.
function geometry(figma, dom, above) {
  const shift = dom.top - figma.top;
  const flow = above
    ? dom.top - (above.dom.top + above.dom.height) - (figma.top - (above.figma.top + above.figma.height))
    : shift;
  return {
    dTop: (Math.abs(flow) < Math.abs(shift) ? flow : shift) || 0, // no -0 in the report
    dHeight: dom.height - figma.height || 0,
  };
}

// Per-section overrides from the sections file win over the command-line limits.
const geometryLimit = (section) => section.figma.maxGeometry ?? maxGeometry;
const mismatchLimit = (section) => section.figma.maxMismatch ?? maxSection;
// Without a limit, any difference is marked: the layout is meant to match Figma to the pixel.
const overGeometry = (section, value) => {
  const limit = geometryLimit(section);
  return Math.abs(value) > (Number.isFinite(limit) ? limit : 0);
};
const offGeometry = (section) => overGeometry(section, section.dTop) || overGeometry(section, section.dHeight);
const offMismatch = (section) => Number.isFinite(mismatchLimit(section)) && section.mismatch * 100 > mismatchLimit(section);

const pct = (value) => `${(value * 100).toFixed(2)}%`;
const signed = (value) => (value > 0 ? `+${value}` : `${value}`);
const fileName = (name) => name.replace(/[^\p{L}\p{N}_-]+/gu, '-');
const write = (png, file) => writeFileSync(join(OUT_DIR, file), PNG.sync.write(png));

if (!skipBuild && config.build && !config.baseUrl) execSync(config.build, { stdio: 'inherit' });
mkdirSync(OUT_DIR, { recursive: true });
// Port 0: the OS picks a free port, so parallel runs (several worktrees) never collide.
const server = config.baseUrl ? null : await serveDist({ root: config.dist, port: 0 });
const baseUrl = config.baseUrl ?? `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const results = [];

try {
  for (const [id, screen] of screens) {
    const referenceFile = join(REF_DIR, screen.reference);
    if (!existsSync(referenceFile)) throw new Error(`${id}: no reference PNG at ${referenceFile}`);
    const expected = PNG.sync.read(readFileSync(referenceFile));
    if (expected.width !== screen.width || expected.height !== screen.height) {
      throw new Error(
        `${id}: ${screen.reference} is ${expected.width}×${expected.height}, the frame is ` +
          `${screen.width}×${screen.height}. Re-export it at 1x (get_screenshot with maxDimension ≥ the longer side).`,
      );
    }

    const url = new URL((screen.url ?? config.url).replaceAll('{id}', id), baseUrl);
    const context = await browser.newContext({
      viewport: { width: screen.width, height: screen.height },
      deviceScaleFactor: 1,
    });
    const captureUrl = new URL(CAPTURE_PATH, url).href;
    await context.route(captureUrl, (route) =>
      route.fulfill({ contentType: 'text/css; charset=utf-8', body: CAPTURE_CSS }),
    );
    // CSP violations also reach the console in Chromium; the listener makes sure none slips through.
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        console.error(`CSP violation: ${event.violatedDirective} (${event.blockedURI || 'inline'})`);
      });
    });
    const page = await context.newPage();
    const problems = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));

    await page.goto(url.href, { waitUntil: 'networkidle' });
    await page.addStyleTag({ url: captureUrl });
    const pending = await page.evaluate(waitForAssets);
    if (pending.length) console.warn(`${id}: images still loading after 5 s: ${pending.join(', ')}`);

    const actual = PNG.sync.read(await page.screenshot());
    // An element that is not rendered (display: none, or a display: contents wrapper) has no box to compare.
    const domSections = await page.$$eval('[data-section]', (elements) =>
      elements
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            name: element.getAttribute('data-section'),
            top: rect.top + window.scrollY,
            height: rect.height,
          };
        }),
    );
    await context.close();
    if (domSections.length === 0) {
      throw new Error(
        `${id}: no rendered [data-section] elements at ${url.href}. Does the route render the screen, is the build fresh?`,
      );
    }

    const base = `${id}-${screen.width}`;
    write(actual, `${base}-actual.png`);
    const whole = compare(expected, actual);
    write(whole.diff, `${base}-diff.png`);

    const { matched, extra } = matchSections(screen.sections, domSections);
    const boxes = matched.map(({ figma, dom }) => ({ figma, dom: dom && snap(dom.top, dom.height) }));
    const sections = boxes.map(({ figma, dom }, index) => {
      if (!dom) return { name: figma.name, missing: true, figma };
      const { dTop, dHeight } = geometry(figma, dom, closestAbove(figma, boxes));
      // Rendered but collapsed to nothing: all of it differs, and there is nothing to crop.
      if (dom.height <= 0) return { name: figma.name, figma, dom, dTop, dHeight, mismatch: 1, empty: true };
      const { top, height } = dom;
      const expectedCrop = crop(expected, figma.top, figma.height);
      const actualCrop = crop(actual, top, height);
      const result = compare(expectedCrop, actualCrop);
      const name = `${base}-${index}-${fileName(figma.name)}`;
      write(expectedCrop, `${name}-expected.png`);
      write(actualCrop, `${name}-actual.png`);
      write(result.diff, `${name}-diff.png`);
      return {
        name: figma.name,
        figma,
        dom,
        dTop,
        dHeight,
        mismatch: result.mismatched / result.total,
      };
    });
    // A section that is missing from the DOM counts as a full mismatch, never as 0 %.
    const mean =
      sections.reduce((sum, section) => sum + (section.missing ? 1 : section.mismatch), 0) /
      sections.length;
    results.push({
      id,
      node: screen.node ?? null,
      width: screen.width,
      mean,
      page: whole.mismatched / whole.total,
      sections,
      extraDom: extra,
      problems,
    });
  }
} finally {
  await browser.close();
  server?.close();
}

const lines = [
  '# Pixel diff report',
  '',
  `Generated ${new Date().toISOString()}; pixelmatch threshold ${config.threshold}; DPR 1.`,
  '',
  '**Sections** is the metric: every section is compared from its own top. **Whole page** is a diagnostic only:',
  'one shifted section inflates everything below it.',
  '',
  "**Δ top** is the section's own displacement (build − Figma): the smaller of its shift against the frame and",
  'against the bottom of the section above, so a taller section above does not move the blame down.',
  `\`←\` marks a value over its limit: geometry ${Number.isFinite(maxGeometry) ? `> ${maxGeometry} px` : '≠ 0'}${
    Number.isFinite(maxSection) ? `, mismatch > ${maxSection}%` : ''
  }, or the section's own limits listed under its table.`,
  '',
  '| Screen | Node | Sections (mean) | Whole page (shift-sensitive) |',
  '| --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.id} | ${r.node ?? '—'} | ${pct(r.mean)} | ${pct(r.page)} |`),
  '',
];
for (const r of results) {
  lines.push(
    `## ${r.id}${r.node ? ` (${r.node})` : ''}`,
    '',
    '| # | Section | Figma top/h | DOM top/h | Δ top | Δ height | Mismatch |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  r.sections.forEach((s, index) => {
    const figma = `${s.figma.top}/${s.figma.height}`;
    if (s.missing) {
      lines.push(`| ${index} | ${s.name} | ${figma} | — | — | — | missing in DOM |`);
      return;
    }
    const mark = (value) => `${signed(value)}${overGeometry(s, value) ? ' ←' : ''}`;
    const mismatch = s.empty ? 'empty in DOM (0 px)' : `${pct(s.mismatch)}${offMismatch(s) ? ' ←' : ''}`;
    lines.push(
      `| ${index} | ${s.name} | ${figma} | ${s.dom.top}/${s.dom.height} | ${mark(s.dTop)} | ${mark(s.dHeight)} | ${mismatch} |`,
    );
  });
  const overrides = r.sections.filter((s) => ['maxGeometry', 'maxMismatch', 'reason'].some((key) => key in s.figma));
  if (overrides.length) {
    lines.push('', 'Section limits:');
    for (const { name, figma } of overrides) {
      const limits = [
        'maxGeometry' in figma ? `${figma.maxGeometry} px` : '',
        'maxMismatch' in figma ? `${figma.maxMismatch}%` : '',
      ].filter(Boolean);
      lines.push(`- ${name}: ${limits.join(', ') || 'default limits'}${figma.reason ? ` — ${figma.reason}` : ''}`);
    }
  }
  if (r.extraDom.length) lines.push('', `[data-section] not in the sections file: ${r.extraDom.join(', ')}`);
  if (r.problems.length) lines.push('', 'Console errors:', ...r.problems.map((p) => `- ${p}`));
  lines.push('');
}
writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'));
writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));

console.log('\nScreen                 sections   whole page (shift-sensitive)');
for (const r of results) {
  const moved = r.sections.filter((s) => !s.missing && offGeometry(s)).map((s) => s.name);
  const notes = [
    r.sections.some((s) => s.missing) ? 'missing sections' : '',
    moved.length ? `top/height off: ${moved.join(', ')}` : '',
    r.problems.length ? `${r.problems.length} console errors` : '',
  ].filter(Boolean);
  console.log(
    `${r.id.padEnd(22)} ${pct(r.mean).padStart(8)}   ${pct(r.page).padStart(8)}${notes.length ? `   ⚠ ${notes.join(', ')}` : ''}`,
  );
}
console.log(`\nReport: ${join(OUT_DIR, 'report.md')}`);

// Console errors and CSP violations fail every run: a blocked style or script changes the page silently.
const broken = results.filter((r) => r.problems.length > 0).map((r) => `${r.id}: ${r.problems.join(' | ')}`);
if (broken.length > 0) {
  console.error(`\nConsole errors or CSP violations:\n  ${broken.join('\n  ')}`);
  process.exitCode = 1;
}

if (Number.isFinite(maxSection)) {
  const failing = results.flatMap((r) =>
    r.sections
      .filter((section) => section.missing || offMismatch(section))
      .map(
        (section) =>
          `${r.id}/${section.name}: ${section.missing ? 'missing' : `${pct(section.mismatch)} (limit ${mismatchLimit(section)}%)`}`,
      ),
  );
  if (failing.length > 0) {
    console.error(`\nFailed (> ${maxSection}% per section):\n  ${failing.join('\n  ')}`);
    process.exitCode = 1;
  }
}

if (Number.isFinite(maxGeometry)) {
  const failing = results.flatMap((r) =>
    r.sections
      .filter((section) => section.missing || offGeometry(section))
      .map(
        (section) =>
          `${r.id}/${section.name}: ${
            section.missing
              ? 'missing'
              : `top ${signed(section.dTop)}, height ${signed(section.dHeight)} px (limit ${geometryLimit(section)} px)`
          }`,
      ),
  );
  if (failing.length > 0) {
    console.error(`\nFailed (top or height off by > ${maxGeometry} px):\n  ${failing.join('\n  ')}`);
    process.exitCode = 1;
  }
}
