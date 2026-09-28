// Generates mutations.json for a corpus case from its build alone, so the mistakes are not chosen with the
// checker in mind: for every section, the largest text element, the largest boxed element and the largest
// laid-out container get one typical mistake each, picked by kind in a fixed order; a kind that changes nothing
// on the page (a gap in a row spaced between with room to spare) gives way to the next. Deterministic: the same
// build gives the same mutations. Meant for external cases (corpus/external/README.md), written before the
// first bench run and never edited to help the checker.
//
//   node test/mutate.mjs corpus/external/<case> [...]
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { loadConfig } from '../skills/figma-pixel-check/scripts/config.mjs';
import { loadScreens } from '../skills/figma-pixel-check/scripts/screens.mjs';
import { serveDist } from '../skills/figma-pixel-check/scripts/serve-dist.mjs';

const dirs = process.argv.slice(2).map((dir) => resolve(dir));
if (!dirs.length) throw new Error('Usage: node test/mutate.mjs <case dir> [...]');
// Fewer changed pixels than this and the benchmark counts a mutation invalid (test/bench.mjs INVISIBLE_PIXELS).
const INVISIBLE_PIXELS = 16;
const changedPixels = (a, b) => {
  const [x, y] = [PNG.sync.read(a), PNG.sync.read(b)];
  if (x.width !== y.width || x.height !== y.height) return Infinity;
  let n = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2]) n++;
  }
  return n;
};
let browser;
try {
  for (const dir of dirs) {
    const config = loadConfig([`--config=${join(dir, 'figma-pixel.config.json')}`]);
    browser ??= await chromium.launch({ args: config.chromiumArgs });
    const [[, screen]] = loadScreens(join(dir, config.dir, 'sections'));
    const server = config.baseUrl ? null : await serveDist({ root: resolve(dir, config.dist), port: 0 });
    const base = config.baseUrl ?? `http://127.0.0.1:${server.address().port}/`;
    const page = await browser.newPage({ viewport: { width: screen.width, height: screen.height } });
    await page.goto(new URL((screen.url ?? config.url).replaceAll('{id}', screen.base), base).href, { waitUntil: 'networkidle' });
    const found = await page.evaluate((names) => {
      const path = (element) => {
        const parts = [];
        for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
          parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${[...node.parentElement.children].indexOf(node) + 1})`);
        }
        return `html > ${parts.join(' > ')}`;
      };
      const shown = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 4 && rect.height > 4 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.1;
      };
      const area = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width * rect.height;
      };
      const largest = (list) => list.sort((a, b) => area(b) - area(a))[0] ?? null;
      const used = new Map();
      return names.map((name) => {
        const index = used.get(name) ?? 0;
        used.set(name, index + 1);
        const section = [...document.querySelectorAll(`[data-section="${CSS.escape(name)}"]`)].filter(shown)[index];
        if (!section) return { name, occurrence: index, text: null, box: null, flow: null };
        const all = [section, ...section.querySelectorAll('*')].filter(shown);
        const text = largest(all.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)));
        const box = largest(
          all.filter((e) => {
            const s = getComputedStyle(e);
            return e !== section && (s.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(s.borderTopWidth) > 0) && !['IMG', 'SVG', 'svg'].includes(e.tagName);
          }),
        );
        const flow = largest(
          all.filter((e) => {
            const s = getComputedStyle(e);
            return ['flex', 'grid', 'inline-flex'].includes(s.display) && e.children.length > 1;
          }),
        );
        return {
          name,
          occurrence: index,
          text: text && { selector: path(text), color: getComputedStyle(text).color, weight: Number(getComputedStyle(text).fontWeight) },
          box: box && { selector: path(box), radius: parseFloat(getComputedStyle(box).borderTopLeftRadius) || 0 },
          flow: flow && { selector: path(flow), gap: parseFloat(getComputedStyle(flow).columnGap) || parseFloat(getComputedStyle(flow).rowGap) || 0 },
        };
      });
    }, screen.sections.map((s) => s.name));
    // A mistake per element, rotating through the kinds so every kind appears across a screen. A kind is tried
    // on the page first: one that changes too few pixels to count gives way to the next.
    const mutations = [];
    // The first three channels moved towards a lighter neighbouring shade; the alpha kept.
    const shift = (rgb) => {
      let n = 0;
      return rgb.replace(/\d+(\.\d+)?/g, (v) => (n++ < 3 ? String(Math.min(255, Math.round(Number(v) * 0.85 + 20))) : v));
    };
    const shot = () => page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
    if (config.captureCss) await page.addStyleTag({ content: config.captureCss });
    const before = await shot();
    const visible = async (css) => {
      const tag = await page.addStyleTag({ content: css });
      const after = await shot();
      await tag.evaluate((element) => element.remove());
      return changedPixels(before, after) >= INVISIBLE_PIXELS;
    };
    const choose = async (kinds, i, cssOf) => {
      for (let k = 0; k < kinds.length; k++) {
        const pick = kinds[(i + k) % kinds.length];
        if (await visible(cssOf(pick))) return pick;
      }
      return null;
    };
    const push = (f, pick, css) => mutations.push({ kind: pick.kind, section: f.name, ...(f.occurrence ? { occurrence: f.occurrence } : {}), css, note: pick.note });
    for (const [i, f] of found.entries()) {
      if (f.text) {
        const kinds = [
          { kind: 'font-weight', css: `font-weight: ${f.text.weight >= 600 ? f.text.weight - 200 : f.text.weight + 200} !important;`, note: 'the heaviest-looking text one step lighter or heavier' },
          { kind: 'text-color', css: `color: ${shift(f.text.color)} !important;`, note: 'the text colour a neighbouring shade off' },
          { kind: 'font-size', css: 'font-size: calc(1em + 2px) !important;', note: 'the text 2 px larger' },
          { kind: 'letter-spacing', css: 'letter-spacing: 0.5px !important;', note: 'letter spacing added' },
        ];
        const cssOf = (pick) => `${f.text.selector} { ${pick.css} }`;
        const pick = await choose(kinds, i, cssOf);
        if (pick) push(f, pick, cssOf(pick));
      }
      if (f.box) {
        const kinds = [
          { kind: 'radius', css: `border-radius: ${f.box.radius > 6 ? f.box.radius - 6 : f.box.radius + 8}px !important;`, note: 'the radius of the largest box changed' },
          { kind: 'padding', css: 'padding-top: 14px !important;', note: 'the padding-top of the largest box set to 14 px' },
          { kind: 'fill-color', css: 'filter: brightness(0.94) !important;', note: 'the largest box a shade darker' },
        ];
        const cssOf = (pick) => `${f.box.selector} { ${pick.css} }`;
        const pick = await choose(kinds, i, cssOf);
        if (pick) push(f, pick, cssOf(pick));
      }
      if (f.flow) {
        const kinds = [
          { kind: 'gap', css: `gap: ${f.flow.gap + 8}px !important;`, note: 'the gap of the largest container 8 px wider' },
          { kind: 'missing', css: '> :last-child { display: none !important; }', note: 'the last item of the largest container left out' },
          { kind: 'margin', css: 'padding-left: 8px !important;', note: 'the largest container inset 8 px' },
        ];
        const cssOf = (pick) => (pick.css.startsWith('>') ? `${f.flow.selector} ${pick.css}` : `${f.flow.selector} { ${pick.css} }`);
        const pick = await choose(kinds, i, cssOf);
        if (pick) push(f, pick, cssOf(pick));
      }
    }
    await page.close();
    server?.close();
    const file = join(dir, 'mutations.json');
    if (existsSync(file) && !process.env.FORCE) throw new Error(`${file} exists: mutations are written once, before the first bench run (FORCE=1 to rewrite)`);
    writeFileSync(file, `${JSON.stringify(mutations, null, 2)}\n`);
    console.log(`${dir}: ${mutations.length} mutations`);
  }
} finally {
  await browser?.close();
}
