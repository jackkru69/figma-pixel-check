// A compact, machine-readable summary of what the deterministic checks found, for an optional independent
// review: another agent (or a person) looks at the reference, the build and this summary, and searches for
// problems the checks did NOT report. The review never changes a verdict: pass and fail stay with
// pixel-diff and the responsive audit.
//
//   node scripts/figma-pixel/review-context.mjs          after pixel-diff (and, if run, spacing and responsive)
//
// Writes <dir>/diff/review-context.json. Paths in it are relative to that folder.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadConfig } from './config.mjs';

const config = loadConfig();
const OUT_DIR = join(config.dir, 'diff');
const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
const results = read(join(OUT_DIR, 'results.json'));
if (!results) throw new Error(`No ${join(OUT_DIR, 'results.json')}: run pixel-diff.mjs first.`);
const spacing = read(join(OUT_DIR, 'spacing.json')) ?? [];
const responsive = read(join(OUT_DIR, 'responsive', 'results.json')) ?? [];

const TASK = [
  'You are an independent reviewer of a web page built from a Figma frame. The deterministic checks below already',
  'measured geometry, pixels, colours, Figma style values, spacing and other phone sizes; their findings are listed',
  'and are not your job. Open each screen\'s reference (Figma) and build captures, and each section\'s crops, and look',
  'for visible problems the checks did not report: a wrong or missing icon or image, a text that says something else,',
  'a wrong order of items, a state that is not the one drawn, an element that is there but should not be, broken',
  'alignment between sections, anything a designer would reject. Report only what you can point at in the images,',
  'as JSON: [{"screen", "section", "where": {"x", "y", "width", "height"} in frame pixels, "what", "evidence"}].',
  'Do not repeat a listed finding, do not judge the numbers, and say "none" when you find nothing: the checks decide',
  'pass and fail; you look for what they cannot see.',
].join(' ');

const screens = results.map((r) => ({
  id: r.id,
  screen: r.screen ?? r.id,
  state: r.state ?? null,
  verdict: r.verdict ?? null,
  size: { width: r.width, height: r.height },
  url: r.url ?? null,
  reference: r.reference ? relative(OUT_DIR, r.reference) : null,
  build: `${r.id}-${r.width}-actual.png`,
  diff: `${r.id}-${r.width}-diff.png`,
  consoleErrors: r.problems,
  sections: r.sections.map((s) =>
    s.missing
      ? { name: s.name, missing: true, figma: box(s.figma) }
      : {
          name: s.name,
          figma: box(s.figma),
          build: box(s.dom),
          geometry: { top: s.dTop, height: s.dHeight, ...('dLeft' in s && { left: s.dLeft, width: s.dWidth }) },
          mismatch: Number((s.mismatch * 100).toFixed(2)),
          colour: { share: Number((s.color * 100).toFixed(2)), pair: s.color > 0 ? s.colorPair : null },
          styles: s.styles
            ? { checked: s.styles.checked, differences: s.styles.off.map((off) => `${off.label} ${off.property} ${off.figma} → ${off.dom}`), textsNotFound: s.styles.missingText }
            : null,
          spacingFlags: flags(spacing.find((row) => row.section === s.name && (row.screen ?? r.id) === r.id)),
          hotspots: (s.hotspots ?? []).map((h) => ({ ...h.frame, width: h.width, height: h.height, mismatch: Number((h.mismatch * 100).toFixed(1)) })),
          checks: Object.fromEntries(Object.entries(s.checks ?? {}).map(([name, c]) => [name, c.status])),
          files: s.files ?? null,
        },
  ),
  missingText: r.missingText ?? null,
  responsive: (responsive.find((entry) => entry.id === r.screen || entry.id === r.id)?.devices ?? []).flatMap((d) =>
    d.findings.map((f) => ({ device: d.device, finding: `${f.kind}: ${f.what}`, px: f.px, known: f.known })),
  ),
}));

function box(b) {
  return b ? { top: b.top, height: b.height, ...('left' in b && { left: b.left, width: b.width }) } : null;
}
function flags(row) {
  if (!row) return [];
  return [...['left', 'right', 'top', 'bottom', 'height'].filter((p) => row[p]?.flagged), ...(row.gaps?.flagged ? ['gaps'] : [])];
}

const context = { generated: new Date().toISOString(), task: TASK, screens };
writeFileSync(join(OUT_DIR, 'review-context.json'), `${JSON.stringify(context, null, 2)}\n`);
console.log(`Wrote ${join(OUT_DIR, 'review-context.json')} (${screens.length} screen${screens.length === 1 ? '' : 's'})`);
