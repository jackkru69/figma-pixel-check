// Benchmarks on the corpus, reported per corpus group and never added up across groups: corpus/torture is
// the internal corpus, built together with the checks (an upper bound); corpus/external is the unseen one
// (see corpus/external/README.md). Writes corpus/BENCHMARK.md and corpus/bench-results.json.
//
//   node test/bench.mjs                       every corpus/<group>/<screen>/ with a mutations.json or equivalents.json
//   node test/bench.mjs corpus/torture/list   only these screens
//   node test/bench.mjs --report              no runs: the reports again from bench-results.json, with the
//                                             labels of case.json as they are now (after labelling findings)
//
// Detection (mutations.json): every mutation is a realistic mistake, injected through captureCss (and
// "html": [[find, replace]] on the page), then pixel-diff and the spacing audit run again and the result is
// compared with the unmutated run.
//
// False positives (equivalents.json): the same shape, but each entry is a correct implementation written
// differently (grid for flex, margins for gap, an inline SVG for an <img>...). It is valid when the capture
// stays the same (at most EQUIVALENT_PIXELS of it differ); then any signal the checks raise is a false
// positive. An entry whose capture changed is "not equivalent": the entry's fault, not the tool's.
//
// A mutation is detected when its own section shows it: a changed Δ top / Δ height, a new spacing flag, a
// mismatch at least 1 percentage point higher (0.1 pp counts as weak), or a colour share that rises over the
// report's 0.5 % mark (0.05 pp counts as weak), or a value that now differs from Figma's (the style check,
// on screens with a styles/<id>.json). A signal only in other sections is
// misattributed. A mutation that leaves the capture unchanged is invalid: the mutation's fault, not the tool's.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPTS = join(ROOT, 'skills/figma-pixel-check/scripts');
const CORPUS = join(ROOT, 'corpus');
const STRONG = 1;
const WEAK = 0.1;
const COLOR_MARK = 0.5;
const COLOR_WEAK = 0.05;
const CONCURRENCY = 6;
// A share of the capture that may differ for an equivalent implementation to count as the same rendering.
const EQUIVALENT_PIXELS = 0.0005;
const GROUP_TITLES = {
  torture: 'Internal torture corpus (built together with the checks: an upper bound, not a detection rate)',
  external: 'External unseen corpus (added before any checker change for it: the generalisation measure)',
};

const run = (cwd, script, args = []) =>
  new Promise((done) => {
    const child = spawn('node', [join(SCRIPTS, script), ...args], { cwd });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => done({ code, out }));
  });

const REPORT_ONLY = process.argv.includes('--report');
const paths = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const screens = REPORT_ONLY ? [] : (paths.length
  ? paths.map((dir) => resolve(dir))
  : readdirSync(CORPUS, { withFileTypes: true })
      .filter((group) => group.isDirectory() && group.name !== 'fonts')
      .flatMap((group) => readdirSync(join(CORPUS, group.name)).map((name) => join(CORPUS, group.name, name)))
).filter((dir) => ['mutations.json', 'equivalents.json', 'case.json'].some((file) => existsSync(join(dir, file))));
const groupOf = (dir) => relative(CORPUS, dir).split(/[\\/]/)[0];

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
/** Keys of a list of named items: a repeated name gets its occurrence (banner, banner#2), as pixel-diff pairs them. */
const keysOf = (names) => {
  const seen = new Map();
  return names.map((name) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n > 1 ? `${name}#${n}` : name;
  });
};
function signals(base, mutated) {
  const bySection = new Map();
  const add = (name, signal) => bySection.set(name, [...(bySection.get(name) ?? []), signal]);
  const sectionKeys = keysOf(mutated.result.sections.map((section) => section.name));
  mutated.result.sections.forEach((section, i) => {
    const key = sectionKeys[i];
    const before = base.result.sections[i];
    if (before && section.missing && !before.missing) add(key, { type: 'geometry', detail: 'missing in DOM' });
    if (!before || section.missing || before.missing) return;
    if (section.dTop !== before.dTop || section.dHeight !== before.dHeight) {
      add(key, { type: 'geometry', detail: `Δ top ${before.dTop}→${section.dTop}, Δ height ${before.dHeight}→${section.dHeight}` });
    }
    const pp = (section.mismatch - before.mismatch) * 100;
    if (pp >= WEAK) add(key, { type: pp >= STRONG ? 'pixel' : 'pixel-weak', detail: `mismatch +${pp.toFixed(2)} pp` });
    // A value that newly differs from Figma's, or that already differed and changed again (a colour that was a
    // token off and is now another one).
    const was = new Map((before.styles?.off ?? []).map((off) => [`${off.node} ${off.property}`, String(off.dom)]));
    const values = (section.styles?.off ?? []).filter((off) => was.get(`${off.node} ${off.property}`) !== String(off.dom));
    const texts = (section.styles?.missingText ?? 0) - (before.styles?.missingText ?? 0);
    if (values.length || texts > 0) {
      const detail = [...values.map((off) => `${off.label} ${off.property} ${off.figma} → ${off.dom}`), ...(texts > 0 ? [`${texts} text(s) not found`] : [])];
      add(key, { type: 'style', detail: detail.join('; ') });
    }
    const color = ((section.color ?? 0) - (before.color ?? 0)) * 100;
    if (color >= COLOR_WEAK) {
      const marked = section.color * 100 > COLOR_MARK;
      add(key, { type: marked ? 'color' : 'color-weak', detail: `colour +${color.toFixed(2)} pp ${section.colorPair ?? ''}`.trim() });
    }
  });
  const rowKeys = keysOf(mutated.spacing.map((row) => row.section));
  const baseKeys = keysOf(base.spacing.map((row) => row.section));
  mutated.spacing.forEach((row, i) => {
    const key = rowKeys[i];
    const before = base.spacing[baseKeys.indexOf(key)];
    if (!before) return;
    const flags = PROPS.filter((prop) => row[prop].flagged && !before[prop]?.flagged);
    if (row.gaps.flagged && !before.gaps.flagged) flags.push('gaps');
    if (flags.length) add(key, { type: 'spacing', detail: `new flag: ${flags.join(', ')}` });
    const moved = PROPS.filter((prop) => row[prop].delta !== before[prop].delta);
    if (!flags.length && moved.length) add(key, { type: 'spacing-weak', detail: `changed below the flag: ${moved.join(', ')}` });
  });
  return bySection;
}

// A mutation that changes fewer pixels than this draws nothing anyone would see (a radius past a pill's half
// height, a gap in a container with free space): it is left out, like one that changes nothing.
const INVISIBLE_PIXELS = 16;

function verdict(mutation, base, mutated) {
  if (base.png.equals(mutated.png)) return { status: 'invalid', signals: {} };
  const changed = changedPixels(base.png, mutated.png);
  if (changed < INVISIBLE_PIXELS) return { status: 'invalid', changed, signals: {} };
  const bySection = signals(base, mutated);
  // A section nested in the mutated one (a card section inside its band) is part of it. A repeated section is
  // named by its occurrence ("occurrence": 1 is the second banner, keyed banner#2).
  const keys = keysOf(base.result.sections.map((section) => section.name));
  const boxOf = (key) => base.result.sections[keys.indexOf(key)]?.figma;
  const own = mutation.occurrence ? `${mutation.section}#${mutation.occurrence + 1}` : mutation.section;
  const target = boxOf(own);
  const within = (key) => {
    const box = boxOf(key);
    return key === own || (target && box && box.top >= target.top && box.top + box.height <= target.top + target.height);
  };
  const mine = [...bySection.entries()].filter(([name]) => within(name)).flatMap(([, list]) => list);
  const STRONG_TYPES = ['geometry', 'pixel', 'spacing', 'color', 'style'];
  const strong = mine.filter((s) => STRONG_TYPES.includes(s.type));
  const elsewhere = [...bySection.entries()].filter(([name]) => !within(name));
  const status = strong.length
    ? 'detected'
    : mine.length
      ? 'weak'
      : elsewhere.some(([, list]) => list.some((s) => STRONG_TYPES.includes(s.type)))
        ? 'misattributed'
        : 'missed';
  const alsoElsewhere = elsewhere.some(([, list]) => list.some((s) => STRONG_TYPES.includes(s.type)));
  return { status, alsoElsewhere, signals: Object.fromEntries(bySection) };
}

/** Pixels of two captures that differ: pixelmatch at a strict threshold, anti-aliasing left out. */
function capturePixels(a, b) {
  const [x, y] = [PNG.sync.read(a), PNG.sync.read(b)];
  if (x.width !== y.width || x.height !== y.height) return Infinity;
  return pixelmatch(x.data, y.data, null, x.width, x.height, { threshold: 0.1 });
}
/** Pixels of two captures that differ at all, however little (a neighbouring colour token on small text counts). */
function changedPixels(a, b) {
  const [x, y] = [PNG.sync.read(a), PNG.sync.read(b)];
  if (x.width !== y.width || x.height !== y.height) return Infinity;
  let n = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2]) n++;
  }
  return n;
}
/** Share of two captures that differs. */
function captureDifference(a, b) {
  const x = PNG.sync.read(a);
  return capturePixels(a, b) / (x.width * x.height);
}

function equivalentVerdict(base, variant) {
  const difference = captureDifference(base.png, variant.png);
  const bySection = signals(base, variant);
  if (difference > EQUIVALENT_PIXELS) return { status: 'not-equivalent', difference, signals: Object.fromEntries(bySection) };
  const STRONG_TYPES = ['geometry', 'pixel', 'spacing', 'color', 'style'];
  const all = [...bySection.values()].flat();
  const status = all.some((s) => STRONG_TYPES.includes(s.type)) ? 'false-positive' : all.length ? 'weak' : 'pass';
  return { status, difference, signals: Object.fromEntries(bySection) };
}

/** Writes the page with the entry's replacements; returns a function that restores it. */
function editPage(dir, config, entry) {
  if (!entry.html?.length) return () => {};
  const page = join(dir, 'site', 'index.html');
  if (!existsSync(page)) throw new Error(`${dir}: "html" edits need site/index.html`);
  const original = readFileSync(page, 'utf8');
  let edited = original;
  for (const [find, replace] of entry.html) {
    if (!edited.includes(find)) throw new Error(`${dir}: ${entry.kind}: "${find.slice(0, 60)}" is not in the page`);
    edited = edited.replace(find, replace);
  }
  writeFileSync(page, edited);
  return () => writeFileSync(page, original);
}

async function benchScreen(dir) {
  const read = (file) => (existsSync(join(dir, file)) ? JSON.parse(readFileSync(join(dir, file), 'utf8')) : []);
  const mutations = read('mutations.json');
  const equivalents = read('equivalents.json');
  const config = JSON.parse(readFileSync(join(dir, 'figma-pixel.config.json'), 'utf8'));
  const base = await capture(dir);
  const temp = '.bench.config.json';
  const outcomes = [];
  const falsePositives = [];
  const variant = async (entry) => {
    writeFileSync(join(dir, temp), JSON.stringify({ ...config, captureCss: `${config.captureCss ?? ''}\n${entry.css ?? ''}` }));
    const restore = editPage(dir, config, entry);
    try {
      return await capture(dir, temp);
    } finally {
      restore();
    }
  };
  try {
    for (const mutation of mutations) outcomes.push({ ...mutation, ...verdict(mutation, base, await variant(mutation)) });
    for (const entry of equivalents) falsePositives.push({ ...entry, ...equivalentVerdict(base, await variant(entry)) });
  } finally {
    rmSync(join(dir, temp), { force: true });
    await capture(dir); // leave the unmutated artifacts behind
  }
  // What the checks mark on the unmodified build: accepted differences on the internal corpus; on the external
  // one a real fidelity gap (listed in case.json "knownReal") or else a false positive.
  const marked = base.result.sections.flatMap((section) =>
    Object.entries(section.checks ?? {})
      .filter(([, check]) => check.status === 'warn' || check.status === 'fail')
      .map(([check]) => `${section.name}: ${check}`),
  );
  const baseFindings = labelled(dir, { sections: base.result.sections.length, marked });
  return { screen: relative(CORPUS, dir), group: groupOf(dir), outcomes, falsePositives, baseFindings };
}

/** What case.json says of each finding marked on the unmodified build. */
function labelled(dir, { sections, marked }) {
  const labels = existsSync(join(dir, 'case.json')) ? JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8')) : {};
  return {
    sections,
    marked,
    knownReal: marked.filter((m) => (labels.knownReal ?? []).includes(m)),
    knownFalse: marked.filter((m) => (labels.knownFalse ?? []).includes(m)),
  };
}

const results = [];
const queue = [...screens];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const dir = queue.shift();
      const result = await benchScreen(dir);
      results.push(result);
      const counts = [...result.outcomes, ...result.falsePositives].reduce((c, o) => ({ ...c, [o.status]: (c[o.status] ?? 0) + 1 }), {});
      console.log(`${result.screen.padEnd(28)} ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    }
  }),
);
results.sort((a, b) => a.screen.localeCompare(b.screen));

const count = (list, status) => list.filter((o) => o.status === status).length;
const by = (list, type) => list.filter((o) => (o.signals[o.occurrence ? `${o.section}#${o.occurrence + 1}` : o.section] ?? []).some((s) => s.type === type)).length;
const where = (o) =>
  Object.entries(o.signals)
    .map(([name, list]) => `${name}: ${list.map((s) => s.detail).join('; ')}`)
    .join(' · ');
const change = (o) => [o.css?.replace(/\s+/g, ' ').trim(), ...(o.html ?? []).map(([, to]) => `html → ${to.replace(/\s+/g, ' ').slice(0, 80)}`)].filter(Boolean).join(' + ');

// A previous report keeps the groups this run did not cover.
const previous = (existsSync(join(CORPUS, 'bench-results.json')) ? JSON.parse(readFileSync(join(CORPUS, 'bench-results.json'), 'utf8')) : []).map((r) =>
  REPORT_ONLY && r.baseFindings ? { ...r, baseFindings: labelled(join(CORPUS, r.screen), r.baseFindings) } : r,
);
const ran = new Set(results.map((r) => r.screen));
const merged = [...previous.filter((r) => !ran.has(r.screen) && existsSync(join(CORPUS, r.screen))), ...results].sort((a, b) =>
  a.screen.localeCompare(b.screen),
);
const groups = [...new Set([...Object.keys(GROUP_TITLES), ...merged.map((r) => r.group ?? r.screen.split('/')[0])])];

const lines = [
  '# Benchmarks',
  '',
  'Generated by `node test/bench.mjs`. Each corpus group is measured on its own; the numbers of different groups are',
  'never added up. Detection injects a realistic mistake into a finished screen; the false-positive benchmark swaps in',
  'a correct implementation written differently, which must pass.',
  '',
  `**Detected**: its own section shows a changed Δ top / Δ height, a new spacing flag, a mismatch ≥ ${STRONG} pp higher,`,
  `a colour share over the report's ${COLOR_MARK} % mark, or a value that differs from Figma's. **Weak**: only a smaller signal`,
  `there (mismatch ≥ ${WEAK} pp, colour ≥ ${COLOR_WEAK} pp, a spacing value below the flag). **Misattributed**: a signal only in`,
  'other sections. **Missed**: nothing. **Also elsewhere**: detected, and other sections raised a signal too.',
  `Invalid mutations (the capture did not change, or fewer than ${INVISIBLE_PIXELS} pixels of it) are left out.`,
  '',
  `**False positive**: an equivalent implementation whose capture stayed the same (≤ ${EQUIVALENT_PIXELS * 100} % of pixels differ) and still`,
  'raised a signal. **Not equivalent**: its capture changed, so the entry is not a fair test (left out of the rate).',
];
// The report of one group. External cases are often private designs (corpus/external/README.md, rule 6):
// their details go to corpus/external/BENCHMARK.md, which is not committed, and the committed report keeps only
// the counts, with no screen, section, text or selector of a case.
function groupReport(group, screens, detailed) {
  const lines = [];
  const all = screens.flatMap((r) => (r.outcomes ?? []).map((o) => ({ ...o, screen: r.screen })));
  const fps = screens.flatMap((r) => (r.falsePositives ?? []).map((o) => ({ ...o, screen: r.screen })));
  const findings = screens.map((r) => r.baseFindings).filter(Boolean);
  const markedCount = findings.reduce((n, f) => n + f.marked.length, 0);
  const realCount = findings.reduce((n, f) => n + f.knownReal.length, 0);
  const falseCount = findings.reduce((n, f) => n + (f.knownFalse?.length ?? 0), 0);
  lines.push(`${screens.length} screens. Detection: ${count(all, 'detected')} of ${all.filter((o) => o.status !== 'invalid').length} valid mutations. False positives: ${count(fps, 'false-positive')} of ${fps.filter((o) => o.status !== 'not-equivalent').length} valid equivalents.`, '');
  if (group === 'external') {
    lines.push(
      `Marked on the unmodified builds: ${markedCount} checks over ${findings.reduce((n, f) => n + f.sections, 0)} sections: **${realCount} real gaps**, **${falseCount} false positives** (both looked at in the images and listed in case.json), ${markedCount - realCount - falseCount} not reviewed yet.`,
      '',
    );
    if (detailed && falseCount) {
      lines.push('False positives on the unmodified builds:', '', ...screens.flatMap((r) => (r.baseFindings?.knownFalse ?? []).map((m) => `- ${r.screen}: ${m}`)), '');
    }
  } else if (markedCount) {
    lines.push(`Marked on the unmodified builds: ${markedCount} checks, each accepted and explained in the screen's PIXEL-SPEC.md.`, '');
  }
  if (all.length) {
    const kinds = [...new Set(all.map((o) => o.kind))].sort();
    lines.push(
      '### Detection',
      '',
      '| Kind | Valid | Detected | by geometry | by spacing | by pixels | by colour | by values | Weak | Misattributed | Missed | Also elsewhere |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const kind of [...kinds, null]) {
      const list = all.filter((o) => (kind ? o.kind === kind : true) && o.status !== 'invalid');
      lines.push(
        `| ${kind ?? '**all**'} | ${list.length} | ${count(list, 'detected')} | ${by(list, 'geometry')} | ${by(list, 'spacing')} | ${by(list, 'pixel')} | ${by(list, 'color')} | ${by(list, 'style')} | ${count(list, 'weak')} | ${count(list, 'misattributed')} | ${count(list, 'missed')} | ${list.filter((o) => o.status === 'detected' && o.alsoElsewhere).length} |`,
      );
    }
    if (detailed) {
      const notable = all.filter((o) => ['weak', 'misattributed', 'missed', 'invalid'].includes(o.status));
      lines.push('', '#### Not detected', '');
      if (!notable.length) lines.push('None.');
      for (const o of notable) lines.push(`- **${o.status}** ${o.screen} / ${o.section} — ${o.kind}: ${o.note ?? ''} \`${change(o)}\`${where(o) ? ` — ${where(o)}` : ''}`);
    } else {
      lines.push('', `Invalid (the capture did not change): ${count(all, 'invalid')}.`);
    }
    lines.push('');
  }
  if (fps.length) {
    const kinds = [...new Set(fps.map((o) => o.kind))].sort();
    lines.push('### False positives', '', '| Kind | Cases | Pass | Weak signal only | False positive | Not equivalent |', '| --- | --- | --- | --- | --- | --- |');
    for (const kind of [...kinds, null]) {
      const list = fps.filter((o) => (kind ? o.kind === kind : true));
      lines.push(`| ${kind ?? '**all**'} | ${list.length} | ${count(list, 'pass')} | ${count(list, 'weak')} | ${count(list, 'false-positive')} | ${count(list, 'not-equivalent')} |`);
    }
    if (detailed) {
      const flagged = fps.filter((o) => o.status !== 'pass');
      lines.push('', '#### Not passed', '');
      if (!flagged.length) lines.push('None.');
      for (const o of flagged) {
        lines.push(`- **${o.status}** ${o.screen} — ${o.kind}: ${o.note ?? ''} (capture differs in ${(o.difference * 100).toFixed(3)} %) \`${change(o)}\`${where(o) ? ` — ${where(o)}` : ''}`);
      }
    }
    lines.push('');
  }
  return lines;
}

const tidy = (lines) => `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
for (const group of groups) {
  const screens = merged.filter((r) => (r.group ?? r.screen.split('/')[0]) === group);
  lines.push('', `## ${GROUP_TITLES[group] ?? group}`, '');
  if (!screens.length) {
    lines.push(group === 'external' ? 'No cases yet: see [external/README.md](external/README.md) for how one is added.' : 'No cases.');
    continue;
  }
  const local = group === 'external';
  lines.push(...groupReport(group, screens, !local));
  if (local) {
    lines.push('Counts only: the cases are local (rule 6 of [external/README.md](external/README.md)); the details are in `corpus/external/BENCHMARK.md` on the machine that has them.', '');
    writeFileSync(join(CORPUS, 'external', 'BENCHMARK.md'), tidy([`# ${GROUP_TITLES[group]}`, '', 'Local report, not committed.', '', ...groupReport(group, screens, true)]));
  }
}
writeFileSync(join(CORPUS, 'BENCHMARK.md'), tidy(lines));
writeFileSync(join(CORPUS, 'bench-results.json'), `${JSON.stringify(merged, null, 2)}\n`);
for (const group of groups) {
  const screens = merged.filter((r) => (r.group ?? r.screen.split('/')[0]) === group);
  if (!screens.length) continue;
  const all = screens.flatMap((r) => r.outcomes ?? []);
  const fps = screens.flatMap((r) => r.falsePositives ?? []);
  console.log(
    `${group}: ${count(all, 'detected')}/${all.filter((o) => o.status !== 'invalid').length} detected, ${count(fps, 'false-positive')}/${fps.filter((o) => o.status !== 'not-equivalent').length} false positives (${count(fps, 'not-equivalent')} not equivalent)`,
  );
}
console.log('Wrote corpus/BENCHMARK.md');
