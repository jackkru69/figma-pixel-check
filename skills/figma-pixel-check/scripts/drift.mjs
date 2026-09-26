// Drift between two runs: did the build get better or worse than last time? Figma stays the reference of
// every number here; this only compares two builds' distances from it. It never fails a run: the gates
// against Figma do that.
//
//   node scripts/figma-pixel/drift.mjs --save <file>      snapshot this run (pixel-diff, and responsive if run)
//   node scripts/figma-pixel/drift.mjs --against <file>   compare this run with a snapshot; writes diff/drift.md
//
// Both flags together compare, then save. The snapshot is small JSON: keep it as a CI artifact of the main
// branch, or commit it. Changes below the noise of a re-run (0.5 percentage points of mismatch, 0.1 of
// colour) are not reported.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.mjs';

const MISMATCH_NOISE = 0.5;
const COLOR_NOISE = 0.1;

const { values: flags } = parseArgs({ options: { save: { type: 'string' }, against: { type: 'string' }, config: { type: 'string' } } });
if (!flags.save && !flags.against) throw new Error('Usage: drift.mjs --save <file> and/or --against <file>');
const config = loadConfig();
const OUT_DIR = join(config.dir, 'diff');
const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

/** This run as {version, generated, screens: {id: {sections: {name: {...}}, responsive}}}. */
function snapshot() {
  const results = read(join(OUT_DIR, 'results.json'));
  if (!results) throw new Error(`No ${join(OUT_DIR, 'results.json')}: run pixel-diff.mjs first.`);
  const responsive = read(join(OUT_DIR, 'responsive', 'results.json')) ?? [];
  const screens = {};
  for (const r of results) {
    screens[r.id] = {
      verdict: r.verdict ?? null,
      sections: Object.fromEntries(
        r.sections.map((s) => [
          s.name,
          s.missing
            ? { missing: true }
            : {
                top: s.dTop,
                height: s.dHeight,
                mismatch: Number((s.mismatch * 100).toFixed(2)),
                colour: Number((s.color * 100).toFixed(2)),
                styles: s.styles ? s.styles.off.length + s.styles.missingText : null,
              },
        ]),
      ),
    };
  }
  for (const entry of responsive) {
    const findings = entry.devices.flatMap((d) => d.findings.filter((f) => !f.known).map((f) => `${d.name}: ${f.kind}: ${f.what}`));
    for (const id of Object.keys(screens).filter((key) => key === entry.id || key.startsWith(`${entry.id}--`))) screens[id].responsive = findings;
  }
  return { version: 1, generated: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? null, screens };
}

/** What changed from before to now: [{screen, section, what, before, now, worse}]. */
function compare(before, now) {
  const changes = [];
  const add = (screen, section, what, was, is, worse) => changes.push({ screen, section, what, before: was, now: is, worse });
  for (const [id, screen] of Object.entries(now.screens)) {
    const old = before.screens[id];
    if (!old) {
      add(id, null, 'new screen', null, screen.verdict, false);
      continue;
    }
    for (const [name, s] of Object.entries(screen.sections)) {
      const o = old.sections[name];
      if (!o) {
        add(id, name, 'new section', null, null, false);
        continue;
      }
      if (s.missing || o.missing) {
        if (Boolean(s.missing) !== Boolean(o.missing)) add(id, name, 'missing in DOM', Boolean(o.missing), Boolean(s.missing), Boolean(s.missing));
        continue;
      }
      for (const key of ['top', 'height']) {
        if (s[key] !== o[key]) add(id, name, `Δ ${key}`, o[key], s[key], Math.abs(s[key]) > Math.abs(o[key]));
      }
      if (Math.abs(s.mismatch - o.mismatch) >= MISMATCH_NOISE) add(id, name, 'mismatch %', o.mismatch, s.mismatch, s.mismatch > o.mismatch);
      if (Math.abs(s.colour - o.colour) >= COLOR_NOISE) add(id, name, 'colour %', o.colour, s.colour, s.colour > o.colour);
      if (s.styles != null && o.styles != null && s.styles !== o.styles) add(id, name, 'style differences', o.styles, s.styles, s.styles > o.styles);
    }
    for (const name of Object.keys(old.sections).filter((key) => !(key in screen.sections))) add(id, name, 'section removed', null, null, false);
    if (screen.responsive && old.responsive) {
      const was = new Set(old.responsive);
      const is = new Set(screen.responsive);
      const added = [...is].filter((f) => !was.has(f));
      const gone = [...was].filter((f) => !is.has(f));
      if (added.length) add(id, null, `new responsive finding${added.length === 1 ? '' : 's'}`, null, added, true);
      if (gone.length) add(id, null, `responsive finding${gone.length === 1 ? '' : 's'} gone`, gone, null, false);
    }
  }
  for (const id of Object.keys(before.screens).filter((key) => !(key in now.screens))) add(id, null, 'screen not in this run', null, null, false);
  return changes;
}

const show = (value) => (Array.isArray(value) ? value.join('; ') : value === null ? '—' : String(value));
const delta = (c) =>
  typeof c.before === 'number' && typeof c.now === 'number'
    ? ` (${c.now - c.before > 0 ? '+' : ''}${Number((c.now - c.before).toFixed(2))}${c.what.endsWith('%') ? ' pp' : ''})`
    : '';
const line = (c) => `${c.screen}${c.section ? ` / ${c.section}` : ''}: ${c.what} ${show(c.before)} → ${show(c.now)}${delta(c)}`;

const now = snapshot();
if (flags.against) {
  const before = read(flags.against);
  if (!before) {
    console.log(`No snapshot at ${flags.against} yet: nothing to compare with.`);
  } else {
    const changes = compare(before, now);
    const worse = changes.filter((c) => c.worse);
    const better = changes.filter((c) => !c.worse && typeof c.now === 'number' && typeof c.before === 'number');
    const other = changes.filter((c) => !worse.includes(c) && !better.includes(c));
    const lines = [
      '# Drift since the previous run',
      '',
      `Previous: ${before.generated}${before.commit ? ` (${before.commit.slice(0, 7)})` : ''}. Now: ${now.generated}. Figma stays the reference: these are`,
      "changes of the build's distance from it, not a verdict.",
      '',
      `## Regression (${worse.length})`,
      '',
      ...(worse.length ? worse.map((c) => `- ${line(c)}`) : ['None.']),
      '',
      `## Improvement (${better.length})`,
      '',
      ...(better.length ? better.map((c) => `- ${line(c)}`) : ['None.']),
      ...(other.length ? ['', '## Other changes', '', ...other.map((c) => `- ${line(c)}`)] : []),
      '',
    ];
    writeFileSync(join(OUT_DIR, 'drift.md'), lines.join('\n'));
    writeFileSync(join(OUT_DIR, 'drift.json'), `${JSON.stringify({ before: before.generated, now: now.generated, changes }, null, 2)}\n`);
    console.log(worse.length ? `Regression:\n${worse.map((c) => `  ${line(c)}`).join('\n')}` : 'Regression: none');
    if (better.length) console.log(`Improvement:\n${better.map((c) => `  ${line(c)}`).join('\n')}`);
    if (other.length) console.log(`Other:\n${other.map((c) => `  ${line(c)}`).join('\n')}`);
    console.log(`\nDrift: ${join(OUT_DIR, 'drift.md')}`);
  }
}
if (flags.save) {
  writeFileSync(flags.save, `${JSON.stringify(now, null, 2)}\n`);
  console.log(`Saved ${flags.save}`);
}
