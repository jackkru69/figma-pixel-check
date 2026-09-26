// End-to-end checks of the CI gates on a copy of examples/basic: node --test (needs Playwright's Chromium).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { PNG } from 'pngjs';

const SCRIPTS = resolve('skills/figma-pixel-check/scripts');
let dir;

const run = (script, ...args) => {
  const result = spawnSync('node', [join(SCRIPTS, script), ...args], { cwd: dir, encoding: 'utf8' });
  return { code: result.status, out: result.stdout + result.stderr };
};
const readJson = (file) => JSON.parse(readFileSync(join(dir, file), 'utf8'));
const writeJson = (file, value) => writeFileSync(join(dir, file), JSON.stringify(value, null, 2));
/** Runs fn with extra markup in the example page and extra CSS in its own stylesheet, then restores both. */
const withSite = (edit, css, fn) => {
  const page = join(dir, 'site/profile.html');
  const sheet = join(dir, 'site/styles.css');
  const [html, styles] = [readFileSync(page, 'utf8'), readFileSync(sheet, 'utf8')];
  writeFileSync(page, edit(html));
  writeFileSync(sheet, `${styles}\n${css}`);
  try {
    return fn();
  } finally {
    writeFileSync(page, html);
    writeFileSync(sheet, styles);
  }
};
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

  test('a neighbouring fill colour, invisible to the mismatch, fails --max-color and names the colours', () => {
    withPage((html) => html, '.action button { background: #fbd5d5 !important; }', () => {
      const { code, out } = run('pixel-diff.mjs', '--max-color=2');
      assert.equal(code, 1, out);
      assert.match(out, /profile\/action: \d+\.\d+% #FDE8E8 → #FBD5D5 \(limit 2%\)/);
      assert.doesNotMatch(out, /profile\/(nav|hero|stats|settings):/);
      const action = readJson('design/diff/results.json')[0].sections[4];
      assert.ok(action.mismatch < 0.01, `mismatch ${action.mismatch} would have hidden it`);
      assert.ok(action.color > 0.3, `colour ${action.color}`);
    });
    // The section's own limit wins, as for the other limits.
    const sections = structuredClone(original);
    Object.assign(sections.sections[4], { maxColor: 60, reason: 'new button tint pending design review' });
    writeJson(sectionsFile, sections);
    withPage((html) => html, '.action button { background: #fbd5d5 !important; }', () => {
      assert.equal(run('pixel-diff.mjs', '--max-color=2').code, 0);
    });
    writeJson(sectionsFile, original);
  });

  test('images are left out of the colour check; a box of the same colour is not', () => {
    const png = new PNG({ width: 48, height: 48 });
    for (let i = 0; i < png.data.length; i += 4) png.data.set([90, 91, 214, 255], i);
    writeFileSync(join(dir, 'site/avatar.png'), PNG.sync.write(png));
    const hero = () => readJson('design/diff/results.json')[0].sections[1];
    withSite((html) => html.replace('<p class="hero__name">', '<img class="pic" src="avatar.png" alt="Avatar" width="48" height="48">\n        <p class="hero__name">'), '.pic { position: absolute; left: 20px; top: 70px; }', () => {
      run('pixel-diff.mjs');
      assert.ok(hero().color < 0.001, `colour ${hero().color}`); // counted, the image would be about 3.6 %
    });
    withSite((html) => html.replace('<p class="hero__name">', '<div class="pic"></div>\n        <p class="hero__name">'), '.pic { position: absolute; left: 20px; top: 70px; width: 48px; height: 48px; background: #5a5bd6; }', () => {
      run('pixel-diff.mjs');
      assert.ok(hero().color > 0.03, `colour ${hero().color}`);
    });
  });

  test('a section running past the bottom of the frame is compared only where the reference has rows', () => {
    const sections = structuredClone(original);
    sections.sections.push({ name: 'tail', top: 700, height: 200 });
    writeJson(sectionsFile, sections);
    withSite((html) => html.replace('</main>', '</main>\n    <div class="tail" data-section="tail"></div>'), '.tail { position: absolute; left: 0; right: 0; top: 700px; height: 200px; }', () => {
      assert.equal(run('pixel-diff.mjs', '--max-section=10').code, 0);
      const tail = readJson('design/diff/results.json')[0].sections[5];
      assert.deepEqual([tail.belowCapture, tail.mismatch < 0.01], [0, true]);
    });
    writeJson(sectionsFile, original);
  });

  test("a screen's cleanup leaves another screen's crops alone", () => {
    // "profile-375-2-dark" even looks like a crop of "profile" (base, a number, a name).
    writeJson('design/sections/profile-375-2-dark.json', { ...original, url: '/profile.html' });
    try {
      run('pixel-diff.mjs', 'profile-375-2-dark');
      run('pixel-diff.mjs', 'profile');
      const crops = readdirSync(join(dir, 'design/diff')).filter((file) => file.startsWith('profile-375-2-dark-375-'));
      assert.equal(crops.length, 2 + 3 * original.sections.length, crops.join(' '));
    } finally {
      rmSync(join(dir, 'design/sections/profile-375-2-dark.json'));
    }
  });

  test('a section that starts below the frame is an error, not a crash', () => {
    writeJson(sectionsFile, { ...original, sections: [...original.sections, { name: 'ghost', top: 812, height: 40 }] });
    try {
      assert.match(run('pixel-diff.mjs').out, /section "ghost" starts at 812, below the 812 px frame/);
    } finally {
      writeJson(sectionsFile, original);
    }
  });

  test('a raster texture under the whole page does not hide colour changes', () => {
    const png = new PNG({ width: 4, height: 4 });
    for (let i = 0; i < png.data.length; i += 4) png.data.set([244, 245, 249, 255], i);
    writeFileSync(join(dir, 'site/grain.png'), PNG.sync.write(png));
    withSite((html) => html, 'body { background-image: url(grain.png); } .action button { background: #fbd5d5 !important; }', () => {
      run('pixel-diff.mjs');
      assert.ok(readJson('design/diff/results.json')[0].sections[4].color > 0.3);
    });
  });

  test('a chromiumArgs that is not a list is a config error', () => {
    writeJson('figma-pixel.config.json', { ...readJson('figma-pixel.config.json'), chromiumArgs: '--no-sandbox' });
    try {
      assert.match(run('pixel-diff.mjs').out, /chromiumArgs must be a list of strings/);
    } finally {
      cpSync('examples/basic/figma-pixel.config.json', join(dir, 'figma-pixel.config.json'));
    }
  });

  test('rows below the captured frame are called out', () => {
    withPage((html) => html, '.hero { padding-bottom: 400px !important; }', () => {
      run('pixel-diff.mjs');
      const report = readFileSync(join(dir, 'design/diff/report.md'), 'utf8');
      assert.match(report, /Below the captured frame \(812 px\)[^\n]*\n- settings: 48 px\n- action: 96 px/);
      const [, , , settings, action] = readJson('design/diff/results.json')[0].sections;
      // Rows that were never captured count as mismatched, not as a white page that happens to match.
      assert.equal(action.mismatch, 1);
      assert.ok(settings.mismatch >= 48 / 168, `settings ${settings.mismatch}`);
      assert.equal(action.color, 0);
    });
  });

  test("the style check compares Figma's values with the computed styles", () => {
    const text = (id, characters, y, extra) => ({
      id, name: characters, type: 'TEXT', x: 20, y, width: 120, height: 20, characters,
      fills: [{ type: 'SOLID', color: '#16181D', opacity: 1 }], fontSize: 15, fontWeight: 400,
      lineHeight: { unit: 'PIXELS', value: 20 }, letterSpacing: { unit: 'PIXELS', value: 0 }, textCase: 'ORIGINAL', ...extra,
    });
    mkdirSync(join(dir, 'design/styles'), { recursive: true });
    writeJson('design/styles/profile.json', {
      frame: '1:2',
      nodes: [
        { id: '9:1', name: 'nav', type: 'FRAME', x: 0, y: 0, width: 375, height: 56, layoutMode: 'HORIZONTAL', layoutWrap: 'NO_WRAP', primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'CENTER', itemSpacing: 12, padding: [0, 20, 0, 20] },
        text('9:2', 'Profile', 18, { fontSize: 17, fontWeight: 600 }),
        { id: '9:7', name: 'hero', type: 'FRAME', x: 0, y: 56, width: 375, height: 180, layoutMode: 'VERTICAL', primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'CENTER', itemSpacing: 0, padding: [16, 20, 24, 20] },
        text('9:3', 'Alex Kim', 150, { fontSize: 20, fontWeight: 600, lineHeight: { unit: 'PIXELS', value: 24 } }),
        text('9:4', '@alexkim', 178, { fills: [{ type: 'SOLID', color: '#6B7080', opacity: 1 }] }),
        { id: '9:5', name: 'button', type: 'FRAME', x: 20, y: 516, width: 335, height: 48, radius: 14, fills: [{ type: 'SOLID', color: '#FDE8E8', opacity: 1 }], layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER', itemSpacing: 0, padding: [0, 0, 0, 0] },
        text('9:6', 'Sign out', 530, { fontWeight: 600, fills: [{ type: 'SOLID', color: '#C9302C', opacity: 1 }] }),
      ],
    });
    const ids = (html) => html.replace('<header class="nav"', '<header data-node-id="9:1" class="nav"').replace('<button type="button">', '<button data-node-id="9:5" type="button">');
    const report = () => readFileSync(join(dir, 'design/diff/report.md'), 'utf8');
    try {
      withSite(ids, '', () => {
        assert.equal(run('pixel-diff.mjs', '--max-style=0').code, 0, report());
        assert.match(report(), /\| Styles \|/);
        assert.doesNotMatch(report(), /Values that differ from Figma/);
      });
      const mistakes = '.hero__name { font-weight: 500; } .hero__handle { color: #475467; } .action button { border-radius: 8px; } .nav { gap: 16px; }';
      withSite(ids, mistakes, () => {
        const { code, out } = run('pixel-diff.mjs', '--max-style=0');
        assert.equal(code, 1, out);
        const details = report();
        assert.match(details, /- hero: «Alex Kim» font-weight 600 → 500/);
        assert.match(details, /- hero: «@alexkim» color #6B7080 → #475467/);
        assert.match(details, /- action: button 9:5 radius 14 → 8/);
        assert.match(details, /- nav: nav 9:1 gap 12 → 16/);
      });
      withSite((html) => ids(html).replace('Alex Kim', 'Alex K.'), '', () => {
        run('pixel-diff.mjs');
        assert.match(report(), /Figma text not found in its section[^\n]*\n- hero: «Alex Kim»/);
      });
    } finally {
      rmSync(join(dir, 'design/styles'), { recursive: true, force: true });
    }
  });

  test('a region is compared in its own columns and placed across too', () => {
    const sections = structuredClone(original);
    sections.sections.splice(2, 0, { name: 'left-col', top: 56, height: 180, left: 0, width: 187 }, { name: 'right-col', top: 56, height: 180, left: 187, width: 188 });
    writeJson(sectionsFile, sections);
    const markup = (html) => html.replace('</main>', '</main>\n    <div class="col a" data-section="left-col"></div><div class="col b" data-section="right-col"></div>');
    try {
      withSite(markup, '.col { position: absolute; top: 56px; height: 180px; } .a { left: 10px; width: 177px; } .b { left: 187px; width: 188px; }', () => {
        const { code, out } = run('pixel-diff.mjs', '--max-geometry=0');
        assert.equal(code, 1, out);
        assert.match(out, /profile\/left-col: top 0, height 0, left \+10, width -10 px/);
        assert.doesNotMatch(out, /profile\/right-col:/);
        const report = readFileSync(join(dir, 'design/diff/report.md'), 'utf8');
        assert.match(report, /\| left-col \| 56\/180 @ 0\/187 \| 56\/180 @ 10\/177 \| 0 · left \+10 ← \| 0 · width -10 ← \|/);
      });
    } finally {
      writeJson(sectionsFile, original);
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
      '.ghost { visibility: hidden; width: 10px; white-space: nowrap; overflow: hidden; }',
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
        // A known file written before the label was part of the name still holds (the sideways scroll is a
        // newer check, and a real finding here).
        writeJson(known, { profile: ['off-screen: [hero] button', 'wider than its box: [hero] button', 'page scrolls sideways: page'] });
        const { code, out } = run('responsive-audit.mjs', '--fail');
        assert.equal(code, 0, out);
        rmSync(join(dir, known));
      },
    );
  });

  test('clipped text and icons, text taller than its box, a floating button and sideways scroll are found', () => {
    rmSync(join(dir, known), { force: true });
    configure('');
    const markup = (html) =>
      html
        .replace('<p class="hero__name">', '<div class="card"><p class="caption">A caption far too long for its card</p></div>\n        <p class="hero__name">')
        .replace('<li>Privacy</li>', '<li class="row">Privacy <svg class="chev" viewBox="0 0 20 20" width="20" height="20"><path d="M7 5l5 5-5 5"/></svg></li>')
        .replace('<button type="button">', '<p class="fixed-label">Sign out of every device you use</p>\n        <button type="button">')
        .replace('</main>', '</main>\n    <a class="fab" href="#new">New</a>\n    <div class="wide"></div>');
    const css = [
      '.card { width: 120px; overflow: hidden; }',
      '.caption { white-space: nowrap; width: max-content; }',
      '.row { display: flex; overflow: clip; width: 40px; white-space: nowrap; }',
      '.chev { flex: none; }',
      '.fixed-label { width: 90px; height: 20px; line-height: 20px; }',
      '.fab { position: fixed; right: 20px; bottom: 16px; width: 56px; height: 56px; border-radius: 28px; background: #7f56d9; color: #fff; }',
      '.action { padding-bottom: 0 !important; }',
      '.wide { width: 500px; height: 1px; }',
    ].join('\n');
    withPage(markup, css, () => {
      const { code, out } = run('responsive-audit.mjs', '--fail');
      assert.equal(code, 1, out);
      assert.match(out, /clipped: \[hero\] p «A caption far too long for its card»/);
      assert.doesNotMatch(out, /text overflow: \[hero\] p «A caption/); // its own box fits the text
      assert.match(out, /clipped: \[settings\] svg/);
      assert.match(out, /text taller than its box: \[action\] p «Sign out of every device you use»/);
      assert.match(out, /covered: \[action\] button «Sign out» under a «New»/);
      assert.match(out, /page scrolls sideways: page/);
    });
  });

  test('common real-world patterns are not findings', () => {
    rmSync(join(dir, known), { force: true });
    configure('');
    const png = new PNG({ width: 48, height: 48 });
    for (let i = 0; i < png.data.length; i += 4) png.data.set([90, 91, 214, 255], i);
    writeFileSync(join(dir, 'site/avatar.png'), PNG.sync.write(png));
    const markup = (html) =>
      html.replace(
        '<section class="stats"',
        `<section class="patterns" data-section="patterns">
          <h2 class="tight">Ship faster</h2>
          <nav class="tabs"><a class="on" href="#a">Overview</a><a href="#b">Activity</a></nav>
          <textarea rows="2">A prefilled note that is longer than the two rows this box shows at any size</textarea>
          <div class="terms">Terms. A scrolling box with far more text than its height shows, on purpose, as in every app.</div>
          <div class="carousel"><div class="track"><article class="slide"><h3>Slide one</h3></article><article class="slide"><h3>Slide two</h3></article></div></div>
          <div class="ticker"><div class="belt">Free shipping · 30-day returns · Carbon neutral delivery · Free shipping</div></div>
          <div class="accordion"><div class="panel"><p>Collapsed answer paragraph that is hidden until opened.</p></div></div>
          <div class="grid-fold"><div class="inner"><p>Folded with grid rows at zero fr.</p></div></div>
          <p class="truncate"><span>A nested span with a very long customer name that ends in an ellipsis</span></p>
          <p class="clamp"><span>A clamped description that runs to three lines and more, cut after two lines on purpose.</span></p>
          <div class="fade">A fading preview of a long review that is cut by a mask at the bottom on purpose.</div>
          <div class="crop"><img src="avatar.png" alt="Zoomed avatar" width="48" height="48"></div>
          <div class="promo"><img class="sparkle" src="avatar.png" alt="" width="24" height="24"><span>Promo</span></div>
          <button class="toggle" type="button"><svg class="plus" viewBox="0 0 24 24" width="24" height="24"><path d="M12 5v14M5 12h14"/></svg></button>
          <p class="price">Price: $20 <a class="skip" href="#main">Skip to main content</a></p>
        </section>
        <div class="blob" aria-hidden="true"></div>
        <div class="toast" role="status">Item added to your cart</div>
        <div class="cookie" role="region" aria-label="Cookies">We use cookies</div>
        <section class="stats"`,
      );
    const css = `
      html, body { overflow-x: hidden; }
      .blob { position: absolute; top: 0; right: -120px; width: 240px; height: 120px; }
      .patterns { padding: 12px 20px; display: grid; gap: 8px; }
      .tight { font-size: 48px; line-height: 1; }
      .tabs a { position: relative; margin-right: 12px; }
      .tabs a.on::after { content: ''; position: absolute; left: 0; right: 0; bottom: -6px; height: 2px; background: #5b5bd6; }
      .terms { height: 40px; overflow-y: auto; }
      .carousel { overflow: hidden; }
      .track { display: flex; transform: translate3d(0, 0, 0); }
      .slide { flex: 0 0 100%; }
      .ticker { overflow: hidden; }
      .belt { width: max-content; white-space: nowrap; animation: belt 20s linear infinite; }
      @keyframes belt { to { transform: translateX(-50%); } }
      .accordion .panel { max-height: 0; overflow: hidden; }
      .grid-fold { display: grid; grid-template-rows: 0fr; }
      .grid-fold .inner { overflow: hidden; }
      .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 120px; }
      .clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; width: 160px; }
      .fade { max-height: 40px; overflow: hidden; mask-image: linear-gradient(black, transparent); }
      .crop { width: 40px; height: 40px; border-radius: 50%; overflow: hidden; }
      .crop img { margin: -4px; }
      .promo { position: relative; width: 120px; overflow: hidden; }
      .sparkle { margin-left: -12px; }
      .toggle { width: 24px; height: 24px; padding: 0; overflow: hidden; }
      .plus { transform: rotate(45deg) scale(1.2); }
      .skip { position: absolute; left: -9999px; }
      .price { overflow: hidden; }
      .toast { position: fixed; left: 16px; right: 16px; bottom: 120px; padding: 12px; background: #333; color: #fff; }
      .cookie { position: fixed; left: 12px; right: 12px; bottom: 12px; padding: 12px; background: #fff; }
    `;
    withSite(markup, css, () => {
      // An ellipsis is reported as what it is, an intended cut, as before; nothing else may show up.
      const { out } = run('responsive-audit.mjs', '--fail');
      const fresh = out.split('\n').filter((line) => /^\s+profile \(/.test(line));
      assert.deepEqual(fresh.filter((line) => !line.includes('text cut by an ellipsis')), [], out);
    });
  });

  test('more real-world patterns are not findings', () => {
    rmSync(join(dir, known), { force: true });
    configure('');
    const markup = (html) =>
      html.replace(
        '<section class="stats"',
        `<section class="more" data-section="more">
          <p class="showmore">A long review that is collapsed behind a show more link, with far more text than the eighty pixels it shows before the fade.</p>
          <p class="panel">A collapsed answer held directly by its panel, hidden until opened.</p>
          <div class="peek"><div class="peek-track"><article class="card">Card one</article><article class="card">Card two</article><article class="card">Card three</article></div></div>
          <button class="share" type="button">Share<span class="tip">Copy a link to this page to share it</span></button>
          <button class="inbox" type="button">Inbox<span class="badge">3</span></button>
          <a class="logo" href="#home">Example Company Limited</a>
          <pre class="code">const a = 'a line of code that is much wider than the phone screen it sits on';</pre>
        </section>
        <div class="blob2"></div>
        <section class="stats"`,
      ).replace('<button type="button">Sign out', '<div class="wallet"><h3 class="day">Yesterday</h3><p>Refund 1</p><p>Refund 2</p><p>Refund 3</p><p>Refund 4</p><p>Refund 5</p></div>\n        <button type="button">Sign out');
    const css = `
      body { overflow-x: clip; }
      .more { padding: 12px 20px; display: grid; gap: 8px; }
      .showmore { max-height: 40px; overflow: hidden; position: relative; }
      .panel { max-height: 0; overflow: hidden; margin: 0; }
      .peek { overflow: hidden; }
      .peek-track { display: flex; gap: 8px; }
      .card { flex: 0 0 85%; }
      .share, .inbox { position: relative; }
      .tip { position: absolute; left: 0; top: 100%; white-space: nowrap; visibility: hidden; }
      .badge { position: absolute; right: -6px; top: -6px; }
      .logo { display: block; width: 80px; overflow: hidden; text-indent: -9999px; white-space: nowrap; }
      .code { overflow-x: auto; }
      .wallet { max-height: 80px; overflow-y: auto; }
      .day { position: sticky; top: 0; margin: 0; background: #fff; }
      .blob2 { position: absolute; top: 0; right: -80px; width: 200px; height: 200px; opacity: 0.6; z-index: -1; }
    `;
    withSite(markup, css, () => {
      const { out } = run('responsive-audit.mjs', '--fail');
      const fresh = out.split('\n').filter((line) => /^\s+profile \(/.test(line));
      assert.deepEqual(fresh, [], out);
    });
  });

  test('cuts hidden behind a finished fade-in, an identity transform or an aria-hidden icon are still found', () => {
    rmSync(join(dir, known), { force: true });
    configure('');
    const markup = (html) =>
      html
        .replace(
          '<section class="stats"',
          `<section class="reveal" data-section="reveal">
            <div class="clipbox"><div class="fade"><div class="row"><b>Balance</b><b>Income</b><b>Spent</b><b>Saved</b><b>Goal</b></div></div></div>
            <a class="setting" href="#lang">Language and region <svg class="chev" aria-hidden="true" viewBox="0 0 20 20" width="20" height="20"><path d="M7 5l5 5-5 5"/></svg></a>
          </section>
          <section class="stats"`,
        )
        .replace('</main>', '</main>\n    <div role="dialog" aria-modal="true" class="sheet"><p class="opt">Last option</p><button class="apply" type="button">Show 120 results</button></div>');
    const css = `
      .reveal { padding: 12px 20px; }
      .fade { animation: fade 1ms both; transform: translate3d(0, 0, 0); }
      @keyframes fade { from { opacity: 0; } }
      .clipbox { overflow-x: clip; }
      .row { display: flex; gap: 12px; }
      .row b { flex: 0 0 110px; }
      .setting { display: flex; overflow: hidden; width: 150px; white-space: nowrap; }
      .chev { flex: none; }
      .sheet { position: fixed; inset: 0; background: #fff; overflow: auto; }
      .opt { position: absolute; left: 20px; right: 20px; bottom: 30px; margin: 0; }
      .apply { position: fixed; left: 16px; right: 16px; bottom: 16px; height: 48px; }
    `;
    withSite(markup, css, () => {
      const { out } = run('responsive-audit.mjs', '--fail');
      assert.match(out, /clipped: \[reveal\] (b|div)/, out);
      assert.match(out, /clipped: \[reveal\] svg/, out);
      assert.match(out, /covered: p «Last option» under button «Show 120 results»/, out);
    });
  });

  test('a short line beside a floating corner button is not covered', () => {
    rmSync(join(dir, known), { force: true });
    configure('');
    const markup = (html) =>
      html
        .replace('</main>', '</main>\n    <footer class="foot"><p>© 2026 Example Inc.</p></footer>\n    <button class="chat" type="button">Chat</button>')
        .replace('<main class="screen">', '<main class="screen short">');
    const css = '.short { min-height: 0; } .foot { padding: 8px 20px 24px; } .chat { position: fixed; right: 16px; bottom: 16px; width: 56px; height: 56px; }';
    withSite(markup, css, () => {
      const { out } = run('responsive-audit.mjs', '--fail');
      assert.doesNotMatch(out, /covered: [^\n]*«© 2026/, out);
    });
  });

  test('a page whose body is the scroller still reports sideways scroll', () => {
    configure('');
    withSite((html) => html.replace('</main>', '</main>\n    <div class="wide"></div>'), 'html { overflow: hidden; height: 100%; } body { height: 100%; overflow: auto; } .wide { width: 520px; height: 4px; }', () => {
      assert.match(run('responsive-audit.mjs', '--fail').out, /page scrolls sideways: page/);
    });
  });

  test('a closed dialog kept in the DOM does not switch the covered check off', () => {
    configure('');
    const markup = (html) =>
      html.replace('</main>', '</main>\n    <div role="dialog" aria-modal="true" hidden>Closed</div>\n    <nav class="tabbar">Tabs</nav>');
    const css = '.tabbar { position: fixed; left: 0; right: 0; bottom: 0; height: 300px; background: #fff; }';
    withSite(markup, css, () => assert.match(run('responsive-audit.mjs', '--fail').out, /covered: \[action\] button «Sign out» under nav «Tabs»/));
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
