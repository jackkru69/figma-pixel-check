// Detection benchmark on the corpus: every screen's mutations.json lists realistic mistakes; each one is
// injected through captureCss, pixel-diff and the spacing audit run again, and the result is compared with
// the unmutated run. Writes corpus/BENCHMARK.md and corpus/bench-results.json.
//
//   node test/bench.mjs                    every corpus/<group>/<screen>/ with a mutations.json
//   node test/bench.mjs corpus/torture/list   only these screens
//
// A mutation is detected when its own section shows it: a changed Δ top / Δ height, a new spacing flag, a
// mismatch at least 1 percentage point higher (0.1 pp counts as weak), or a colour share that rises over the
// report's 0.5 % mark (0.05 pp counts as weak), or a value that now differs from Figma's (the style check,
// on screens with a styles/<id>.json). A signal only in other sections is
// misattributed. A mutation that leaves the capture unchanged is invalid: the mutation's fault, not the tool's.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPTS = join(ROOT, 'skills/figma-pixel-check/scripts');
const CORPUS = join(ROOT, 'corpus');
const STRONG = 1;
const WEAK = 0.1;
const COLOR_MARK = 0.5;
const COLOR_WEAK = 0.05;
const CONCURRENCY = 6;

const run = (cwd, script, args = []) =>
  new Promise((done) => {
    const child = spawn('node', [join(SCRIPTS, script), ...args], { cwd });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => done({ code, out }));
  });

const screens = (process.argv.slice(2).length
  ? process.argv.slice(2).map((dir) => resolve(dir))
  : readdirSync(CORPUS, { withFileTypes: true })
      .filter((group) => group.isDirectory() && group.name !== 'fonts')
      .flatMap((group) => readdirSync(join(CORPUS, group.name)).map((name) => join(CORPUS, group.name, name)))
).filter((dir) => existsSync(join(dir, 'mutations.json')));

/** One capture of a screen: section geometry and mismatch, spacing rows, and the full capture bytes. */
async function capture(dir, configFile) {
  const args = configFile ? [`--config=${configFile}`] : [];
  const diff = await run(dir, 'pixel-diff.mjs', ['--skip-build', ...args]);
  const config = JSON.parse(readFileSync(join(dir, configFile ?? 'figma-pixel.config.json'), 'utf8'));
  const out = join(dir, config.dir ?? 'design/figma', 'diff');
  if (!existsSync(join(out, 'results.json'))) throw new Error(`${dir}: pixel-diff failed\n${diff.out}`);
  const [result] = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'));
  await run(dir, 'spacing-audit.mjs', args);
  const spacing = JSON.parse(readFileSync(join(out, 'spacing.json'), 'utf8'));
  const png = readFileSync(join(out, `${result.id}-${result.width}-actual.png`));
  return { result, spacing, png };
}

const PROPS = ['left', 'right', 'top', 'bottom', 'height'];
function signals(base, mutated) {
  const bySection = new Map();
  const add = (name, signal) => bySection.set(name, [...(bySection.get(name) ?? []), signal]);
  mutated.result.sections.forEach((section, i) => {
    const before = base.result.sections[i];
    if (before && section.missing && !before.missing) add(section.name, { type: 'geometry', detail: 'missing in DOM' });
    if (!before || section.missing || before.missing) return;
    if (section.dTop !== before.dTop || section.dHeight !== before.dHeight) {
      add(section.name, { type: 'geometry', detail: `Δ top ${before.dTop}→${section.dTop}, Δ height ${before.dHeight}→${section.dHeight}` });
    }
    const pp = (section.mismatch - before.mismatch) * 100;
    if (pp >= WEAK) add(section.name, { type: pp >= STRONG ? 'pixel' : 'pixel-weak', detail: `mismatch +${pp.toFixed(2)} pp` });
    const was = new Set((before.styles?.off ?? []).map((off) => `${off.node} ${off.property}`));
    const values = (section.styles?.off ?? []).filter((off) => !was.has(`${off.node} ${off.property}`));
    const texts = (section.styles?.missingText ?? 0) - (before.styles?.missingText ?? 0);
    if (values.length || texts > 0) {
      const detail = [...values.map((off) => `${off.label} ${off.property} ${off.figma} → ${off.dom}`), ...(texts > 0 ? [`${texts} text(s) not found`] : [])];
      add(section.name, { type: 'style', detail: detail.join('; ') });
    }
    const color = ((section.color ?? 0) - (before.color ?? 0)) * 100;
    if (color >= COLOR_WEAK) {
      const marked = section.color * 100 > COLOR_MARK;
      add(section.name, { type: marked ? 'color' : 'color-weak', detail: `colour +${color.toFixed(2)} pp ${section.colorPair ?? ''}`.trim() });
    }
  });
  for (const row of mutated.spacing) {
    const before = base.spacing.find((candidate) => candidate.section === row.section);
    if (!before) continue;
    const flags = PROPS.filter((prop) => row[prop].flagged && !before[prop]?.flagged);
    if (row.gaps.flagged && !before.gaps.flagged) flags.push('gaps');
    if (flags.length) add(row.section, { type: 'spacing', detail: `new flag: ${flags.join(', ')}` });
    const moved = PROPS.filter((prop) => row[prop].delta !== before[prop].delta);
    if (!flags.length && moved.length) add(row.section, { type: 'spacing-weak', detail: `changed below the flag: ${moved.join(', ')}` });
  }
  return bySection;
}

function verdict(mutation, base, mutated) {
  if (base.png.equals(mutated.png)) return { status: 'invalid', signals: {} };
  const bySection = signals(base, mutated);
  // A section nested in the mutated one (a card section inside its band) is part of it.
  const boxOf = (name) => base.result.sections.find((section) => section.name === name)?.figma;
  const target = boxOf(mutation.section);
  const within = (name) => {
    const box = boxOf(name);
    return name === mutation.section || (target && box && box.top >= target.top && box.top + box.height <= target.top + target.height);
  };
  const own = [...bySection.entries()].filter(([name]) => within(name)).flatMap(([, list]) => list);
  const STRONG_TYPES = ['geometry', 'pixel', 'spacing', 'color', 'style'];
  const strong = own.filter((s) => STRONG_TYPES.includes(s.type));
  const elsewhere = [...bySection.entries()].filter(([name]) => !within(name));
  const status = strong.length
    ? 'detected'
    : own.length
      ? 'weak'
      : elsewhere.some(([, list]) => list.some((s) => STRONG_TYPES.includes(s.type)))
        ? 'misattributed'
        : 'missed';
  return { status, signals: Object.fromEntries(bySection) };
}

async function benchScreen(dir) {
  const mutations = JSON.parse(readFileSync(join(dir, 'mutations.json'), 'utf8'));
  const config = JSON.parse(readFileSync(join(dir, 'figma-pixel.config.json'), 'utf8'));
  const base = await capture(dir);
  const temp = '.bench.config.json';
  const outcomes = [];
  try {
    for (const mutation of mutations) {
      writeFileSync(join(dir, temp), JSON.stringify({ ...config, captureCss: `${config.captureCss ?? ''}\n${mutation.css}` }));
      const mutated = await capture(dir, temp);
      outcomes.push({ ...mutation, ...verdict(mutation, base, mutated) });
    }
  } finally {
    rmSync(join(dir, temp), { force: true });
    await capture(dir); // leave the unmutated artifacts behind
  }
  return { screen: relative(CORPUS, dir), outcomes };
}

const results = [];
const queue = [...screens];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const dir = queue.shift();
      const result = await benchScreen(dir);
      results.push(result);
      const counts = result.outcomes.reduce((c, o) => ({ ...c, [o.status]: (c[o.status] ?? 0) + 1 }), {});
      console.log(`${result.screen.padEnd(28)} ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    }
  }),
);
results.sort((a, b) => a.screen.localeCompare(b.screen));

const all = results.flatMap((r) => r.outcomes.map((o) => ({ ...o, screen: r.screen })));
const kinds = [...new Set(all.map((o) => o.kind))].sort();
const count = (list, status) => list.filter((o) => o.status === status).length;
const by = (list, type) => list.filter((o) => (o.signals[o.section] ?? []).some((s) => s.type === type)).length;
const lines = [
  '# Detection benchmark',
  '',
  'Generated by `node test/bench.mjs`. Each mutation is a realistic mistake injected into a finished corpus screen.',
  `**Detected**: its own section shows a changed Δ top / Δ height, a new spacing flag, a mismatch ≥ ${STRONG} pp higher,`,
  `a colour share over the report's ${COLOR_MARK} % mark, or a value that differs from Figma's. **Weak**: only a smaller`,
  `signal there (mismatch ≥ ${WEAK} pp,`,
  `colour ≥ ${COLOR_WEAK} pp, a spacing value below the flag). **Misattributed**: a`,
  'signal only in other sections. **Missed**: nothing. Invalid mutations (the capture did not change) are left out.',
  '',
  '| Kind | Valid | Detected | by geometry | by spacing | by pixels | by colour | by values | Weak | Misattributed | Missed |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
for (const kind of [...kinds, null]) {
  const list = all.filter((o) => (kind ? o.kind === kind : true) && o.status !== 'invalid');
  lines.push(
    `| ${kind ?? '**all**'} | ${list.length} | ${count(list, 'detected')} | ${by(list, 'geometry')} | ${by(list, 'spacing')} | ${by(list, 'pixel')} | ${by(list, 'color')} | ${by(list, 'style')} | ${count(list, 'weak')} | ${count(list, 'misattributed')} | ${count(list, 'missed')} |`,
  );
}
const notable = all.filter((o) => ['weak', 'misattributed', 'missed', 'invalid'].includes(o.status));
lines.push('', '## Not detected', '');
for (const o of notable) {
  const where = Object.entries(o.signals)
    .map(([name, list]) => `${name}: ${list.map((s) => s.detail).join('; ')}`)
    .join(' · ');
  lines.push(`- **${o.status}** ${o.screen} / ${o.section} — ${o.kind}: ${o.note ?? ''} \`${o.css.replace(/\s+/g, ' ').trim()}\`${where ? ` — ${where}` : ''}`);
}
writeFileSync(join(CORPUS, 'BENCHMARK.md'), `${lines.join('\n')}\n`);
writeFileSync(join(CORPUS, 'bench-results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(`\n${count(all, 'detected')}/${all.filter((o) => o.status !== 'invalid').length} detected. Wrote corpus/BENCHMARK.md`);
