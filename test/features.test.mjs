// End-to-end checks of states, hotspots, text matching, icon styles and the reports, on a copy of
// examples/basic: node --test (needs Playwright's Chromium).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const sectionsFile = 'design/sections/profile.json';
/** Runs fn with the page, its stylesheet and the sections file edited, then restores all three. */
const withSite = ({ html = (h) => h, css = '', sections, files = {} }, fn) => {
  const page = join(dir, 'site/profile.html');
  const sheet = join(dir, 'site/styles.css');
  const saved = [readFileSync(page, 'utf8'), readFileSync(sheet, 'utf8'), readFileSync(join(dir, sectionsFile), 'utf8')];
  writeFileSync(page, html(saved[0]));
  writeFileSync(sheet, `${saved[1]}\n${css}`);
  if (sections) writeJson(sectionsFile, sections(JSON.parse(saved[2])));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, 'site', name), content);
  try {
    return fn();
  } finally {
    writeFileSync(page, saved[0]);
    writeFileSync(sheet, saved[1]);
    writeFileSync(join(dir, sectionsFile), saved[2]);
    for (const name of Object.keys(files)) rmSync(join(dir, 'site', name), { force: true });
  }
};
const results = () => readJson('design/diff/results.json');
const section = (screen, name) => screen.sections.find((s) => s.name === name);

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'figma-pixel-features-'));
  cpSync('examples/basic', dir, { recursive: true });
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('states', () => {
  const states = (list) => (sections) => ({ ...sections, states: list });
  const css = '.action button:hover { background: #fbd5d5; } .action button:focus-visible { outline: 3px solid #5b5bd6; outline-offset: 2px; }';

  test('each state is its own screen, reached by its actions, with its own artifacts', () => {
    const list = [
      { name: 'default' },
      { name: 'hover', reference: 'profile-375.png', actions: [{ hover: '.action button' }] },
      { name: 'focus', reference: 'profile-375.png', actions: [{ press: 'Tab' }] },
    ];
    withSite({ css, sections: states(list) }, () => {
      const { code, out } = run('pixel-diff.mjs');
      assert.equal(code, 0, out);
      const [plain, hover, focus] = results();
      assert.deepEqual(results().map((r) => [r.id, r.screen, r.state]), [
        ['profile--default', 'profile', 'default'],
        ['profile--hover', 'profile', 'hover'],
        ['profile--focus', 'profile', 'focus'],
      ]);
      assert.ok(section(plain, 'action').color < 0.001, `default ${section(plain, 'action').color}`);
      assert.ok(section(hover, 'action').color > 0.3, `hover ${section(hover, 'action').color}`);
      assert.ok(section(focus, 'action').mismatch > section(plain, 'action').mismatch + 0.01, 'the focus ring is captured');
      assert.ok(existsSync(join(dir, 'design/diff/profile--hover-375-4-action-diff.png')));
      assert.match(readFileSync(join(dir, 'design/diff/report.md'), 'utf8'), /State `hover` of profile\./);
      // One state alone, by its id; the screen's id runs them all.
      run('pixel-diff.mjs', '--skip-build', 'profile--hover');
      assert.deepEqual(results().map((r) => r.id), ['profile--hover']);
    });
  });

  test('a sections file without states works as before', () => {
    run('pixel-diff.mjs');
    assert.deepEqual(results().map((r) => [r.id, r.state]), [['profile', null]]);
    assert.ok(existsSync(join(dir, 'design/diff/profile-375-4-action-diff.png')));
  });

  test('mistakes in states and actions are errors, not a silent default state', () => {
    const attempt = (list) => withSite({ css, sections: states(list) }, () => run('pixel-diff.mjs'));
    assert.match(attempt([{ name: 'open', actions: [{ click: 'button' }] }]).out, /state "open" needs its own "reference"/);
    assert.match(attempt([{ name: 'x', reference: 'profile-375.png', actions: [{ tap: 'button' }] }]).out, /action \{"tap":"button"\}: expected one of hover, click/);
    assert.match(attempt([{ name: 'x', reference: 'profile-375.png', actions: [{ hover: 'li' }] }]).out, /profile--x: action \{"hover":"li"\}: "li" matches 3 elements/);
    assert.match(attempt([{ name: 'x', reference: 'profile-375.png', actions: [{ wait: 'soon' }] }]).out, /milliseconds up to 10000/);
    assert.match(attempt([{ name: 'default' }, { name: 'default' }]).out, /state "default" is listed twice/);
  });
});

describe('hotspots end to end', () => {
  test('a region reports its hotspots in its own columns and in the frame', () => {
    const sections = (s) => ({ ...s, sections: [...s.sections, { name: 'right', top: 236, height: 88, left: 187, width: 188 }] });
    const html = (h) => h.replace('</main>', '</main>\n    <div class="right" data-section="right"></div>');
    const css = '.right { position: absolute; top: 236px; left: 187px; width: 188px; height: 88px; pointer-events: none; } .stat:nth-child(3) b { color: #d92d20; }';
    withSite({ html, css, sections }, () => {
      run('pixel-diff.mjs');
      const right = section(results()[0], 'right');
      const spot = right.hotspots.find((h) => h.colour > 0);
      assert.ok(spot, JSON.stringify(right.hotspots));
      assert.equal(spot.frame.x, spot.x + 187);
      assert.equal(spot.frame.y, spot.y + 236);
      assert.ok(spot.frame.x > 247 && spot.frame.x + spot.width < 352, `the third stat: ${JSON.stringify(spot)}`);
      assert.ok(existsSync(join(dir, 'design/diff', right.files.hotspots)));
    });
  });
});

describe('text matching', () => {
  const text = (id, characters, x, y, extra) => ({
    id, name: characters, type: 'TEXT', x, y, width: 60, height: 18, characters, fills: [{ type: 'SOLID', color: '#6B7080', opacity: 1 }], ...extra,
  });
  const frame = (id, name, y, height) => ({ id, name, type: 'FRAME', x: 0, y, width: 375, height, layoutMode: 'VERTICAL', primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'CENTER', itemSpacing: 0, padding: [0, 0, 0, 0] });
  const styles = (nodes) => {
    mkdirSync(join(dir, 'design/styles'), { recursive: true });
    writeJson('design/styles/profile.json', { frame: '1:2', nodes });
  };
  after(() => rmSync(join(dir, 'design/styles'), { recursive: true, force: true }));
  const styled = (name) => section(results()[0], name).styles;

  test('equal texts pair up by where they are drawn, not by DOM order', () => {
    // Three "Posts" labels; the design's right one is red. The build reverses the row, so its first child is drawn on the right.
    styles([
      frame('9:20', 'stats', 236, 88),
      text('9:21', 'Posts', 53, 275),
      text('9:22', 'Posts', 165, 275),
      text('9:23', 'Posts', 277, 275, { fills: [{ type: 'SOLID', color: '#D92D20', opacity: 1 }] }),
    ]);
    const html = (h) => h.replace('<span>Followers</span>', '<span>Posts</span>').replace('<span>Following</span>', '<span>Posts</span>');
    withSite({ html, css: '.stats { flex-direction: row-reverse; } .stat:first-child span { color: #d92d20; }' }, () => {
      run('pixel-diff.mjs');
      const stats = styled('stats');
      assert.deepEqual(stats.off, []);
      assert.equal(stats.byText, 3);
    });
    // And a difference names the one Figma node it belongs to.
    withSite({ html, css: '.stats { flex-direction: row-reverse; }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(styled('stats').off.map((off) => `${off.label} ${off.property}`), ['«Posts» 9:23 color']);
    });
  });

  test('text split into inline elements, by the build or by Figma, is still found; a part never matches the whole', () => {
    const name = (id, characters, x, extra) => text(id, characters, x, 150, { fills: [{ type: 'SOLID', color: '#16181D', opacity: 1 }], ...extra });
    styles([frame('9:7', 'hero', 56, 180), name('9:3', 'Alex Kim', 150, { fontWeight: 600 })]);
    for (const markup of ['Alex <strong>Kim</strong>', '<span>Alex</span> <span>Kim</span>']) {
      withSite({ html: (h) => h.replace('>Alex Kim<', `>${markup}<`) }, () => {
        run('pixel-diff.mjs');
        assert.equal(styled('hero').missingText, 0, markup);
        assert.deepEqual(styled('hero').off, [], markup);
      });
    }
    // Figma's own split: "Alex" and "Kim" as two text nodes.
    styles([frame('9:7', 'hero', 56, 180), name('9:30', 'Alex', 150, { fontWeight: 600 }), name('9:31', 'Kim', 190, { fontWeight: 600 })]);
    withSite({ html: (h) => h.replace('>Alex Kim<', '>Alex <em>Kim</em><') }, () => {
      run('pixel-diff.mjs');
      assert.equal(styled('hero').missingText, 0);
      assert.deepEqual(styled('hero').off, []);
    });
    // "Alex" alone is not found in "Alex Kim": a part of a text is not a match.
    withSite({}, () => {
      run('pixel-diff.mjs');
      assert.equal(styled('hero').missingText, 2);
    });
  });

  test('data-node-id wins over the text, so a translated text is still checked; a hidden copy does not win', () => {
    styles([frame('9:7', 'hero', 56, 180), text('9:3', 'Alex Kim', 150, 150, { fontWeight: 600, fills: [{ type: 'SOLID', color: '#16181D', opacity: 1 }] })]);
    withSite({ html: (h) => h.replace('<p class="hero__name">Alex Kim', '<p class="hero__name" data-node-id="9:3">Алекс Ким') }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual([styled('hero').missingText, styled('hero').byId, styled('hero').off.length], [0, 1, 0]);
    });
    withSite({ html: (h) => h.replace('<p class="hero__name">', '<p class="hero__name" hidden>Alex Kim</p>\n        <p class="hero__name">') }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(styled('hero').off, []);
    });
  });
});

describe('values found without ids, in the notations builds use', () => {
  const frame = (id, name, y, height) => ({ id, name, type: 'FRAME', x: 0, y, width: 375, height, layoutMode: 'VERTICAL', primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'CENTER', itemSpacing: 0, padding: [0, 0, 0, 0] });
  const handle = (extra) => ({ id: '9:4', name: '@alexkim', type: 'TEXT', x: 150, y: 178, width: 75, height: 20, characters: '@alexkim', fills: [{ type: 'SOLID', color: '#6B7080', opacity: 1 }], ...extra });
  const button = { id: '9:5', name: 'button', type: 'FRAME', x: 20, y: 516, width: 335, height: 48, radius: 14, fills: [{ type: 'SOLID', color: '#FDE8E8', opacity: 1 }] };
  const styles = (nodes) => {
    mkdirSync(join(dir, 'design/styles'), { recursive: true });
    writeJson('design/styles/profile.json', { frame: '1:2', nodes });
  };
  after(() => rmSync(join(dir, 'design/styles'), { recursive: true, force: true }));
  const offs = (name) => section(results()[0], name).styles.off.map((off) => `${off.label} ${off.property} ${off.figma} → ${off.dom}`);
  const styled = (name) => section(results()[0], name).styles;

  test('colours written as oklab() or color-mix() read like rgb()', () => {
    styles([frame('9:7', 'hero', 56, 180), handle()]);
    withSite({ css: '.hero__handle { color: color-mix(in oklab, #6b7080 100%, transparent); }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('hero'), []);
    });
    withSite({ css: '.hero__handle { color: color-mix(in oklab, #475467 100%, transparent); }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('hero'), ['«@alexkim» color #6B7080 → #475467']);
    });
  });

  test("a field's placeholder or value is its text, styled by ::placeholder", () => {
    styles([frame('9:7', 'hero', 56, 180), handle()]);
    const html = (h) => h.replace('<p class="hero__handle">@alexkim</p>', '<input class="hero__handle" placeholder="@alexkim" aria-label="Handle">');
    const css = '.hero__handle { border: 0; background: none; font: inherit; width: 75px; } .hero__handle::placeholder { color: #6b7080; }';
    withSite({ html, css }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual([styled('hero').missingText, offs('hero')], [0, []]);
    });
    withSite({ html, css: css.replace('#6b7080; }', '#98a2b3; }') }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('hero'), ['«@alexkim» color #6B7080 → #98A2B3']);
    });
    withSite({ html: (h) => h.replace('<p class="hero__handle">@alexkim</p>', '<input class="hero__handle" value="@alexkim" aria-label="Handle">'), css }, () => {
      run('pixel-diff.mjs');
      assert.equal(styled('hero').missingText, 0);
    });
  });

  test('a text Figma draws under an opaque layer is not expected in the build', () => {
    const hidden = { id: '9:40', name: 'hidden', type: 'TEXT', x: 40, y: 100, width: 80, height: 20, characters: 'Old label', fills: [{ type: 'SOLID', color: '#000000', opacity: 1 }] };
    const cover = { id: '9:41', name: 'cover', type: 'RECTANGLE', x: 20, y: 90, width: 200, height: 60, fills: [{ type: 'SOLID', color: '#F4F5F9', opacity: 1 }] };
    styles([frame('9:7', 'hero', 56, 180), hidden, cover]);
    run('pixel-diff.mjs');
    assert.equal(styled('hero').missingText, 0);
    // Under a half-transparent layer it shows, so it is looked for.
    styles([frame('9:7', 'hero', 56, 180), hidden, { ...cover, fills: [{ type: 'SOLID', color: '#F4F5F9', opacity: 0.5 }] }]);
    run('pixel-diff.mjs');
    assert.equal(styled('hero').missingText, 1);
  });

  test('a painted frame without an id is found by its box, unless the box is ambiguous', () => {
    styles([button]);
    withSite({ css: '.action button { border-radius: 8px; }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('action'), ['button 9:5 radius 14 → 8']);
      assert.equal(styled('action').unmatched, 0);
    });
    // Two painted Figma nodes on the same box: neither is matched, nothing is guessed.
    styles([button, { ...button, id: '9:6', name: 'background', type: 'RECTANGLE', fills: [{ type: 'SOLID', color: '#FFFFFF', opacity: 1 }] }]);
    withSite({ css: '.action button { border-radius: 8px; }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual([offs('action'), styled('action').unmatched], [[], 2]);
    });
  });

  test('placeholder shadows, a side drawn as an inset shadow over a 0 px border reset, and a line drawn as a box pass', () => {
    const row = { id: '9:50', name: 'row', type: 'FRAME', x: 20, y: 400, width: 335, height: 40, strokes: [{ type: 'SOLID', color: '#EAECF0', opacity: 1 }], strokeAlign: 'INSIDE', strokeWeights: [0, 0, 1, 0] };
    const line = { id: '9:51', name: 'Line', type: 'LINE', x: 20, y: 460, width: 335, height: 0, strokes: [{ type: 'SOLID', color: '#EAECF0', opacity: 1 }], strokeAlign: 'CENTER', strokeWeights: [1, 1, 1, 1] };
    styles([button, row, line]);
    const html = (h) => h.replace('<li>Notifications</li>', '<li>Notifications</li>\n        <li class="probe-row"></li><li class="probe-line"></li>');
    const css = [
      '.action button { box-shadow: 0 0 #0000, 0 0 0 0 transparent; }',
      // Placed from the section's top (400 and 460 in the frame, 324 its top), as the build moves it.
      '.list { position: relative; }',
      '.list li.probe-row { position: absolute; left: 0; top: 76px; width: 335px; height: 40px; padding: 0; border: 0 solid; box-shadow: inset 0 -1px 0 0 #eaecf0; }',
      '.list li.probe-line { position: absolute; left: 0; top: 136px; width: 335px; height: 1px; padding: 0; box-shadow: none; background: #eaecf0; }',
    ].join(' ');
    withSite({ html, css }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual([offs('action'), offs('settings')], [[], []]);
      assert.equal(styled('settings').unmatched, 0);
    });
    withSite({ html, css: css.replace('inset 0 -1px 0 0 #eaecf0', 'inset 0 -1px 0 0 #d0d5dd').replace('background: #eaecf0', 'background: #d0d5dd') }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('settings'), ['row 9:50 stroke bottom #EAECF0 → #D0D5DD', 'Line 9:51 line #EAECF0 → #D0D5DD']);
    });
  });
});

describe('icon styles', () => {
  const nodes = [
    { id: '9:1', name: 'nav', type: 'FRAME', x: 0, y: 0, width: 375, height: 56, layoutMode: 'HORIZONTAL', layoutWrap: 'NO_WRAP', primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'CENTER', itemSpacing: 12, padding: [0, 20, 0, 20] },
    { id: '9:40', name: 'icon', type: 'FRAME', x: 20, y: 16, width: 24, height: 24 },
    { id: '9:41', name: 'chevron', type: 'VECTOR', x: 27, y: 22, width: 8, height: 12, strokes: [{ type: 'SOLID', color: '#667085', opacity: 1 }], strokeAlign: 'CENTER', strokeWeights: [2, 2, 2, 2] },
  ];
  before(() => {
    mkdirSync(join(dir, 'design/styles'), { recursive: true });
    writeJson('design/styles/profile.json', { frame: '1:2', nodes });
  });
  after(() => rmSync(join(dir, 'design/styles'), { recursive: true, force: true }));
  const icon = (markup) => (h) => h.replace('<span class="nav__back" aria-hidden="true"></span>', markup);
  const offs = () => section(results()[0], 'nav').styles.off.map((off) => `${off.property} ${off.figma} → ${off.dom}`);
  const PATH = '<path class="line" d="M15 6l-6 6 6 6"/>';

  test('an SVG file: classes in its own <style>, groups and a scaled viewBox resolve as drawn, under the page CSP', () => {
    const file = (stroke) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><style>.line { stroke: ${stroke}; stroke-width: 4px; }</style><g fill="none" transform="scale(2)">${PATH}</g></svg>`;
    const markup = icon('<img data-node-id="9:40" class="ic" src="chevron.svg" width="24" height="24" alt="">');
    withSite({ html: markup, files: { 'chevron.svg': file('#667085') } }, () => {
      const { code, out } = run('pixel-diff.mjs', '--max-style=0');
      assert.doesNotMatch(out, /CSP violation/);
      assert.deepEqual(offs(), []);
      assert.equal(code, 0, out);
    });
    withSite({ html: markup, files: { 'chevron.svg': file('#98A2B3') } }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs(), ['icon stroke 2 px #667085 → 2 px #98A2B3']);
    });
  });

  test('an inline SVG with currentColor, in a wrapper, takes the colour of the page', () => {
    const markup = icon(`<span data-node-id="9:40" class="ic"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">${PATH}</svg></span>`);
    withSite({ html: markup, css: '.ic { display: block; width: 24px; height: 24px; color: #667085; } .ic svg { display: block; }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs(), []);
    });
    withSite({ html: markup, css: '.ic { display: block; width: 24px; height: 24px; color: #98a2b3; } .ic svg { display: block; }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs(), ['icon stroke 2 px #667085 → 2 px #98A2B3']);
    });
  });
});

describe('reports', () => {
  test('report.html is written next to the crops and links them; results.json carries the verdict', () => {
    const { code, out } = run('pixel-diff.mjs', '--max-geometry=1');
    assert.equal(code, 1);
    const html = readFileSync(join(dir, 'design/diff/report.html'), 'utf8');
    assert.match(html, /<title>Pixel check report<\/title>/);
    assert.match(html, /src="profile-375-1-hero-expected\.png"/);
    assert.match(html, /data-slider/);
    assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1)/, 'nothing loaded from the network');
    const [screen] = results();
    assert.equal(screen.verdict, 'fail');
    assert.deepEqual(section(screen, 'nav').checks.geometry.status, 'pass');
    // A short CI log: a block per failing section, not every section.
    assert.ok(out.split('\n').length < 20, out);
  });

  test('drift compares two runs of the build, apart from the verdict against Figma', () => {
    run('pixel-diff.mjs');
    assert.equal(run('drift.mjs', '--save', 'baseline.json').code, 0);
    const snapshot = readJson('baseline.json');
    assert.equal(snapshot.version, 1);
    assert.deepEqual(Object.keys(snapshot.screens.profile.sections), ['nav', 'hero', 'stats', 'settings', 'action']);
    withSite({ css: '.action button { background: #fbd5d5; } .stats { gap: 24px; }' }, () => {
      run('pixel-diff.mjs');
      const { code, out } = run('drift.mjs', '--against', 'baseline.json');
      assert.equal(code, 0, 'drift never fails a run');
      assert.match(out, /Regression:\n[^]*profile \/ action: colour % 0 → \d+\.\d+ \(\+\d/);
      assert.doesNotMatch(out, /profile \/ (nav|hero|settings):/);
      assert.match(readFileSync(join(dir, 'design/diff/drift.md'), 'utf8'), /## Regression \(\d\)/);
    });
    run('pixel-diff.mjs');
    const back = run('drift.mjs', '--against', 'baseline.json');
    assert.match(back.out, /Regression: none/);
    assert.match(run('drift.mjs', '--against', 'nothing-yet.json').out, /No snapshot at nothing-yet\.json yet/);
  });

  test('review-context.json lists what the checks found, with the files to look at', () => {
    run('pixel-diff.mjs', '--max-geometry=1');
    run('spacing-audit.mjs');
    assert.equal(run('review-context.mjs').code, 0);
    const context = readJson('design/diff/review-context.json');
    assert.match(context.task, /problems the checks did not report/);
    const [screen] = context.screens;
    assert.equal(screen.verdict, 'fail');
    assert.equal(screen.reference, '../reference/profile-375.png');
    const hero = screen.sections.find((s) => s.name === 'hero');
    assert.deepEqual(hero.geometry, { top: 0, height: -8 });
    assert.equal(hero.checks.geometry, 'fail');
    assert.ok(existsSync(join(dir, 'design/diff', hero.files.diff)));
    assert.ok(Array.isArray(hero.spacingFlags));
  });
});
