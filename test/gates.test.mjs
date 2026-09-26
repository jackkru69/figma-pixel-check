// End-to-end checks of the CI gates on a copy of examples/basic: node --test (needs Playwright's Chromium).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

const SCRIPTS = resolve('skills/figma-pixel-check/scripts');
let dir;

const run = (script, ...args) => {
  const result = spawnSync('node', [join(SCRIPTS, script), ...args], { cwd: dir, encoding: 'utf8' });
  return { code: result.status, out: result.stdout + result.stderr };
};
const readJson = (file) => JSON.parse(readFileSync(join(dir, file), 'utf8'));
const writeJson = (file, value) => writeFileSync(join(dir, file), JSON.stringify(value, null, 2));
/** Runs fn with extra markup in the example page and extra capture CSS, then restores both. */
const withPage = (edit, captureCss, fn) => {
  const page = join(dir, 'site/profile.html');
  const html = readFileSync(page, 'utf8');
  writeFileSync(page, edit(html));
  writeJson('figma-pixel.config.json', { ...readJson('figma-pixel.config.json'), captureCss });
  try {
    return fn();
  } finally {
    writeFileSync(page, html);
    cpSync('examples/basic/figma-pixel.config.json', join(dir, 'figma-pixel.config.json'));
  }
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'figma-pixel-'));
  cpSync('examples/basic', dir, { recursive: true });
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('pixel-diff --max-geometry', () => {
  const sectionsFile = 'design/sections/profile.json';
  let original;
  before(() => (original = readJson(sectionsFile)));
  after(() => writeJson(sectionsFile, original));

  test('blames the taller section, not the ones it pushes down', () => {
    const { code, out } = run('pixel-diff.mjs', '--max-geometry=1');
    assert.equal(code, 1, out);
    assert.match(out, /profile\/hero: top 0, height -8 px \(limit 1 px\)/);
    assert.doesNotMatch(out, /profile\/(nav|stats|settings|action):/);
    const [screen] = readJson('design/diff/results.json');
    const geometry = Object.fromEntries(screen.sections.map((s) => [s.name, [s.dTop, s.dHeight]]));
    assert.deepEqual(geometry, { nav: [0, 0], hero: [0, -8], stats: [0, 0], settings: [0, 0], action: [0, 0] });
  });

  test('passes within the limit', () => {
    const { code, out } = run('pixel-diff.mjs', '--skip-build', '--max-geometry=8');
    assert.equal(code, 0, out);
  });

  test('a section limit overrides the flag and its reason reaches the report', () => {
    const sections = structuredClone(original);
    Object.assign(sections.sections[1], { maxGeometry: 8, reason: 'taller header in the reference' });
    writeJson(sectionsFile, sections);
    const { code, out } = run('pixel-diff.mjs', '--max-geometry=1');
    assert.equal(code, 0, out);
    assert.match(readFileSync(join(dir, 'design/diff/report.md'), 'utf8'), /- hero: 8 px — taller header/);
  });

  test('a pinned bar is not blamed for a shorter section above it', () => {
    // The action bar pinned to the frame bottom stays at 716 while the hero above is 8 px shorter.
    const sections = structuredClone(original);
    sections.sections[4] = { name: 'action', top: 716, height: 96 };
    writeJson(sectionsFile, sections);
    writeFileSync(
      join(dir, 'figma-pixel.config.json'),
      JSON.stringify({ ...readJson('figma-pixel.config.json'), captureCss: '.action { position: fixed; bottom: 0; left: 0; right: 0; }' }),
    );
    try {
      const { out } = run('pixel-diff.mjs', '--max-geometry=1');
      assert.doesNotMatch(out, /profile\/action:/);
      const action = readJson('design/diff/results.json')[0].sections[4];
      assert.deepEqual([action.dTop, action.dHeight], [0, 0]);
    } finally {
      cpSync('examples/basic/figma-pixel.config.json', join(dir, 'figma-pixel.config.json'));
    }
  });

  test('fractional boxes are snapped by their edges; a hidden duplicate section is skipped', () => {
    const sections = structuredClone(original);
    Object.assign(sections.sections[1], { top: 56.4, height: 179.8 }); // edges 56.4 and 236.2 → 56/180
    writeJson(sectionsFile, sections);
    withPage(
      (html) => html.replace('<section class="hero"', '<div data-section="hero" hidden></div>\n      <section class="hero"'),
      '',
      () => {
        const { code, out } = run('pixel-diff.mjs', '--max-geometry=1');
        assert.equal(code, 1, out);
        assert.match(out, /profile\/hero: top 0, height -8 px/);
        const hero = readJson('design/diff/results.json')[0].sections[1];
        assert.deepEqual([hero.figma.top, hero.figma.height, hero.dom.top, hero.dom.height], [56, 180, 56, 172]);
        assert.doesNotMatch(readFileSync(join(dir, 'design/diff/report.md'), 'utf8'), /not in the sections file/);
      },
    );
    writeJson(sectionsFile, original);
    // A 56.6 px nav: its bottom edge, and the hero's top, are painted from row 57.
    withPage((html) => html, '.nav { height: 56.6px; }', () => {
      run('pixel-diff.mjs');
      const [nav, hero] = readJson('design/diff/results.json')[0].sections;
      assert.deepEqual([nav.dom.height, nav.dHeight, hero.dom.top, hero.dTop], [57, 1, 57, 0]);
    });
  });

  test('Δ top is measured from the closest section above, not from a nested one listed after it', () => {
    const sections = structuredClone(original);
    Object.assign(sections.sections[1], { maxGeometry: 8, reason: 'taller header in the reference' });
    sections.sections.splice(2, 0, { name: 'avatar', top: 72, height: 72 });
    writeJson(sectionsFile, sections);
    withPage(
      (html) => html.replace('<div class="avatar" aria-hidden="true">', '<div class="avatar" aria-hidden="true" data-section="avatar">'),
      '',
      () => {
        const { code, out } = run('pixel-diff.mjs', '--max-geometry=1');
        assert.equal(code, 0, out);
      },
    );
    writeJson(sectionsFile, original);
  });

  test('a missing page of a multi-page site is a 404, not the home page', () => {
    writeJson('design/sections/ghost.json', { ...original, url: '/ghost.html' });
    writeFileSync(join(dir, 'site/index.html'), '<!doctype html><main data-section="nav">Home</main>');
    try {
      const { code, out } = run('pixel-diff.mjs', 'ghost');
      assert.equal(code, 1);
      assert.match(out, /no rendered \[data-section\] elements/);
    } finally {
      rmSync(join(dir, 'design/sections/ghost.json'));
      rmSync(join(dir, 'site/index.html'));
    }
  });

  test('a malformed limit or a mistyped flag is an error, not a disabled gate', () => {
    const malformed = run('pixel-diff.mjs', '--max-section=10%');
    assert.equal(malformed.code, 1);
    assert.match(malformed.out, /--max-section=10%: expected a number/);
    const typo = run('pixel-diff.mjs', '--max-geomtery=1');
    assert.equal(typo.code, 1);
    assert.match(typo.out, /Unknown option '--max-geomtery'/);
    assert.match(run('responsive-audit.mjs', '--fial').out, /Unknown option '--fial'/);
    assert.match(run('pixel-diff.mjs', '--config', 'other.json').out, /Config not found: .*other\.json/);
  });
});

describe('responsive-audit known findings', () => {
  // Two devices; the name overflows its 60 px box on "Narrow" only (130 px wide text, so the size is stable).
  const narrow = (width) => `.hero__name { width: ${width}px; white-space: nowrap; }`;
  const configure = (narrowCss, wideCss = '') =>
    writeJson('figma-pixel.config.json', {
      ...JSON.parse(readFileSync('examples/basic/figma-pixel.config.json', 'utf8')),
      devices: [
        { name: 'Narrow', width: 360, height: 640, captureCss: narrowCss },
        { name: 'Wide', width: 440, height: 956, captureCss: wideCss },
      ],
    });
  const known = 'design/responsive-known.json';
  after(() => {
    cpSync('examples/basic/figma-pixel.config.json', join(dir, 'figma-pixel.config.json'));
    rmSync(join(dir, known), { force: true });
  });

  test('--update-known pins the device and the size', () => {
    configure(narrow(60));
    assert.equal(run('responsive-audit.mjs', '--fail').code, 1);
    assert.equal(run('responsive-audit.mjs', '--update-known').code, 0);
    const [entry] = readJson(known).profile;
    assert.match(entry.finding, /^text overflow: \[hero\] p «Alex Kim»$/);
    const [measured] = readJson('design/diff/responsive/results.json')[0].devices[0].findings;
    assert.deepEqual(entry.maxPx, { Narrow: measured.px + 2 }); // 2 px of slack for another OS's fonts
    assert.equal(run('responsive-audit.mjs', '--fail').code, 0);
  });

  test('the same finding grown past its size is new', () => {
    configure(narrow(30));
    const { code, out } = run('responsive-audit.mjs', '--fail');
    assert.equal(code, 1);
    assert.match(out, /\(Narrow 360×640\): text overflow: .* \(known up to \d+ px\)/);
  });

  test('the same finding on another device is new', () => {
    configure(narrow(60), narrow(60));
    const { code, out } = run('responsive-audit.mjs', '--fail');
    assert.equal(code, 1);
    assert.match(out, /\(Wide 440×956\): text overflow: .* \(known on Narrow only\)/);
    assert.doesNotMatch(out, /\(Narrow 360×640\)/);
  });

  test('--update-known keeps the reason; a bare string still holds anywhere', () => {
    configure(narrow(60));
    const [entry] = readJson(known).profile;
    writeJson(known, { profile: [{ ...entry, reason: 'masked in the design' }] });
    run('responsive-audit.mjs', '--update-known');
    assert.equal(readJson(known).profile[0].reason, 'masked in the design');

    configure(narrow(10), narrow(10));
    writeJson(known, { profile: [entry.finding] });
    assert.equal(run('responsive-audit.mjs', '--fail').code, 0);
  });

  test('a known entry that no longer occurs is reported', () => {
    configure('');
    writeJson(known, { profile: [{ finding: 'off-screen: [hero] div', maxPx: 3 }] });
    assert.equal(run('responsive-audit.mjs', '--fail').code, 0);
    const report = readFileSync(join(dir, 'design/diff/responsive/report.md'), 'utf8');
    assert.match(report, /Known but not found any more .*off-screen: \[hero\] div/);
  });

  test('a device renamed in the config: the entry no longer holds, --update-known repairs it', () => {
    configure(narrow(60));
    writeJson(known, { profile: [{ finding: 'text overflow: [hero] p «Alex Kim»', maxPx: { Tablet: 99 } }] });
    const renamed = run('responsive-audit.mjs', '--fail');
    assert.equal(renamed.code, 1);
    assert.match(renamed.out, /\(known on Tablet only\)/);
    run('responsive-audit.mjs', '--update-known');
    assert.equal(run('responsive-audit.mjs', '--fail').code, 0);
  });

  test('what cannot be seen and an intended bleed are not findings; a textless element is named by its label', () => {
    rmSync(join(dir, known), { force: true });
    configure('');
    const markup = (html) =>
      html
        .replace('<p class="hero__name">', '<span class="sr-only">Open the profile photo</span>\n        <p class="hero__name">')
        .replace('<p class="hero__handle">', '<p class="ghost">A hidden hint that is far too long</p>\n        <p class="hero__handle">')
        .replace('<button type="button">', '<div class="bleed"></div>\n        <button type="button">')
        .replace('<p class="hero__handle">', '<div class="skip"><a href="#main"><span>Skip to the content</span></a></div>\n        <p class="hero__handle">');
    const css = [
      '.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; white-space: nowrap; clip: rect(0, 0, 0, 0); }',
      '.ghost { visibility: hidden; width: 10px; white-space: nowrap; }',
      '.bleed { margin: 0 -20px; height: 4px; background: #000; }',
      '.skip { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }',
    ].join('\n');
    withPage(markup, css, () => {
      const { code, out } = run('responsive-audit.mjs', '--fail');
      assert.equal(code, 0, out);
    });
    withPage(
      (html) => html.replace('<p class="hero__name">', '<button class="edit" aria-label="Edit profile"></button>\n        <p class="hero__name">'),
      '.edit { display: block; width: 400px; height: 8px; border: 0; }',
      () => {
        assert.match(run('responsive-audit.mjs', '--fail').out, /\[hero\] button «Edit profile»/);
        // A known file written before the label was part of the name still holds.
        writeJson(known, { profile: ['off-screen: [hero] button', 'wider than its box: [hero] button'] });
        const { code, out } = run('responsive-audit.mjs', '--fail');
        assert.equal(code, 0, out);
        rmSync(join(dir, known));
      },
    );
  });

  test('devices without a name are keyed by their size', () => {
    writeJson('figma-pixel.config.json', {
      ...JSON.parse(readFileSync('examples/basic/figma-pixel.config.json', 'utf8')),
      devices: [
        { width: 360, height: 640, captureCss: narrow(60) },
        { width: 440, height: 956 },
      ],
    });
    assert.equal(run('responsive-audit.mjs', '--update-known').code, 0);
    assert.deepEqual(Object.keys(readJson(known).profile[0].maxPx), ['360×640']);
    assert.equal(run('responsive-audit.mjs', '--fail').code, 0);
  });

  test('a malformed known entry is an error', () => {
    writeJson(known, { profile: [{ finding: 'off-screen: [hero] div', maxPx: { Narrow: '3' } }] });
    const { code, out } = run('responsive-audit.mjs');
    assert.equal(code, 1);
    assert.match(out, /expected \{"finding"/);
  });
});
