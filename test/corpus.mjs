// The corpus as regression fixtures: every corpus/<group>/<screen>/ is a tool project with an expected.json of
// what the tool must report about it. corpus.test.mjs checks them; this file writes them.
//
//   node test/corpus.mjs --update [dirs...]   run the tool on each screen and rewrite its expected.json
//
// expected.json: {sections: {name: {dTop, dHeight, mismatch, color, styles?, missingText?}}, spacingFlags: {section: [property]}}.
// The test wants the geometry exactly, the mismatch no more than MISMATCH_SLACK and the colour share no more
// than COLOR_SLACK percentage points higher, the same style differences (screens with styles/<id>.json), the same spacing flags, pixel-diff without console errors, and
// responsive-audit --fail passing.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');
export const CORPUS = join(ROOT, 'corpus');
export const MISMATCH_SLACK = 0.5;
export const COLOR_SLACK = 0.1;
const SCRIPTS = join(ROOT, 'skills/figma-pixel-check/scripts');

export const corpusScreens = () =>
  readdirSync(CORPUS, { withFileTypes: true })
    .filter((group) => group.isDirectory() && group.name !== 'fonts')
    .flatMap((group) => readdirSync(join(CORPUS, group.name), { withFileTypes: true })
      .filter((screen) => screen.isDirectory() && existsSync(join(CORPUS, group.name, screen.name, 'figma-pixel.config.json')))
      .map((screen) => join(CORPUS, group.name, screen.name)));

export const run = (dir, script, args = []) => {
  const result = spawnSync('node', [join(SCRIPTS, script), ...args], { cwd: dir, encoding: 'utf8' });
  return { code: result.status, out: result.stdout + result.stderr };
};

/** What the tool says about one screen now. */
export function measure(dir) {
  const config = JSON.parse(readFileSync(join(dir, 'figma-pixel.config.json'), 'utf8'));
  const out = join(dir, config.dir, 'diff');
  const diff = run(dir, 'pixel-diff.mjs', ['--skip-build']);
  const [result] = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'));
  const spacing = run(dir, 'spacing-audit.mjs');
  const rows = JSON.parse(readFileSync(join(out, 'spacing.json'), 'utf8'));
  const responsive = run(dir, 'responsive-audit.mjs', ['--skip-build', '--fail']);
  return {
    diff,
    spacing,
    responsive,
    sections: Object.fromEntries(
      result.sections.map((s) => [
        s.name,
        s.missing
          ? { missing: true }
          : {
              dTop: s.dTop,
              dHeight: s.dHeight,
              mismatch: Number((s.mismatch * 100).toFixed(2)),
              color: Number((s.color * 100).toFixed(2)),
              ...(s.styles && { styles: s.styles.off.map((off) => `${off.label} ${off.property} ${off.figma} → ${off.dom}`), missingText: s.styles.missingText }),
            },
      ]),
    ),
    spacingFlags: Object.fromEntries(
      rows
        .map((row) => [row.section, [...['left', 'right', 'top', 'bottom', 'height'].filter((p) => row[p].flagged), ...(row.gaps.flagged ? ['gaps'] : [])]])
        .filter(([, flags]) => flags.length),
    ),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (!args.includes('--update')) throw new Error('Usage: node test/corpus.mjs --update [dirs...]; the check is npm test');
  const dirs = args.filter((arg) => !arg.startsWith('--')).map((dir) => resolve(dir));
  for (const dir of dirs.length ? dirs : corpusScreens()) {
    const now = measure(dir);
    if (now.diff.code !== 0) console.warn(`${relative(ROOT, dir)}: pixel-diff exited ${now.diff.code}\n${now.diff.out}`);
    if (now.responsive.code !== 0) console.warn(`${relative(ROOT, dir)}: responsive-audit --fail exited ${now.responsive.code}`);
    writeFileSync(join(dir, 'expected.json'), `${JSON.stringify({ sections: now.sections, spacingFlags: now.spacingFlags }, null, 2)}\n`);
    console.log(`${relative(ROOT, dir)}: wrote expected.json`);
  }
}
