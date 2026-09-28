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
  test('a painted frame is found through its own texts, so a wrong size, padding or radius is still reported', () => {
    // The Sign out button without an id; its label is found by its text, the button around it by that label.
    const label = { id: '9:6', name: 'Sign out', type: 'TEXT', x: 158, y: 530, width: 60, height: 20, characters: 'Sign out', fills: [{ type: 'SOLID', color: '#C9302C', opacity: 1 }] };
    styles([button, label]);
    withSite({ css: '.action button { padding-top: 14px; height: 62px; border-radius: 8px; }' }, () => {
      run('pixel-diff.mjs');
      const lines = offs('action');
      assert.ok(lines.includes('button 9:5 radius 14 → 8'), lines.join('\n'));
      assert.equal(section(results()[0], 'action').styles.unmatched, 0);
    });
  });

  test('a painted frame is found through most of its texts when the build writes one of them differently', () => {
    // The first stat card: «128» and «Posts» are found, a third Figma text is not in the build.
    const card = { id: '9:20', name: 'stat', type: 'FRAME', x: 20, y: 236, width: 104, height: 64, radius: 12, fills: [{ type: 'SOLID', color: '#FFFFFF', opacity: 1 }] };
    const texts = [['9:21', '128', 250], ['9:22', 'Posts', 272], ['9:23', 'this month', 286]].map(([id, characters, y]) => ({ id, name: characters, type: 'TEXT', x: 40, y, width: 60, height: 12, characters, fills: [{ type: 'SOLID', color: '#1F2230', opacity: 1 }] }));
    styles([card, ...texts]);
    run('pixel-diff.mjs');
    assert.ok(offs('stats').includes('stat 9:20 radius 12 → 16'), offs('stats').join('\n'));
  });

  test('a text hidden inside a paragraph is not part of what the paragraph shows', () => {
    styles([frame('9:7', 'hero', 56, 180), handle({ characters: '@alexkim online' })]);
    withSite({ html: (h) => h.replace('<p class="hero__handle">@alexkim</p>', '<p class="hero__handle">@alexkim <span class="state">online</span></p>') }, () => {
      run('pixel-diff.mjs');
      assert.equal(styled('hero').missingText, 0);
    });
    withSite({ html: (h) => h.replace('<p class="hero__handle">@alexkim</p>', '<p class="hero__handle">@alexkim <span class="state">online</span></p>'), css: '.state { display: none; }' }, () => {
      run('pixel-diff.mjs');
      assert.equal(styled('hero').missingText, 1);
    });
  });

  test('a colour filter the design does not have is reported; fills under an opaque one are not compared', () => {
    styles([button]);
    withSite({ css: '.action button { filter: brightness(0.9); }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('action'), ['button 9:5 filter none → brightness(0.9)']);
    });
    // Figma: a solid colour under an opaque gradient; the build draws the gradient alone.
    styles([{ ...button, fills: [{ type: 'SOLID', color: '#0A2239', opacity: 1 }, { type: 'GRADIENT_LINEAR', opacity: 1, stops: [{ color: '#FDE8E8', alpha: 1, position: 0 }, { color: '#FBD5D5', alpha: 1, position: 1 }] }] }]);
    withSite({ css: '.action button { background: linear-gradient(90deg, #fde8e8, #fbd5d5); }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('action'), []);
    });
    // Two solid fills blend: white under 10 % red is drawn as one colour.
    styles([{ ...button, fills: [{ type: 'SOLID', color: '#FFFFFF', opacity: 1 }, { type: 'SOLID', color: '#C9302C', opacity: 0.1 }] }]);
    withSite({ css: '.action button { background: #faeaea; }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('action'), []);
    });
  });
  test('a drop shadow drawn as filter: drop-shadow() takes half the blur; a caret and stacked copies are not texts to find', () => {
    const shadow = { type: 'DROP_SHADOW', x: 4, y: 4, radius: 16, spread: 0, color: '#000000', alpha: 0.2 };
    styles([{ ...button, effects: [shadow] }]);
    withSite({ css: '.action button { filter: drop-shadow(4px 4px 8px rgba(0, 0, 0, 0.2)); }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('action'), []);
    });
    withSite({ css: '.action button { filter: drop-shadow(4px 4px 16px rgba(0, 0, 0, 0.2)); }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('action'), ['button 9:5 shadow 4 4 16 0 #000000 20 % → 4 4 32 0 #000000 20 %']);
    });
    // A focused field drawn with its caret, a lone caret, and the same label stacked twice.
    styles([
      frame('9:7', 'hero', 56, 180),
      handle({ characters: '@alexkim|' }),
      { ...handle(), id: '9:9', characters: '|', x: 230, width: 2 },
      { ...handle(), id: '9:10', characters: 'Alex Kim', x: 150, y: 150 },
      { ...handle(), id: '9:11', characters: 'Alex Kim', x: 150, y: 150 },
    ]);
    withSite({ html: (h) => h.replace('<p class="hero__handle">@alexkim</p>', '<input class="hero__handle" value="@alexkim" aria-label="Handle">'), css: '.hero__handle { border: 0; background: none; font: inherit; color: #6b7080; width: 75px; }' }, () => {
      run('pixel-diff.mjs');
      assert.equal(styled('hero').missingText, 0);
    });
  });

  test('half a pixel is no geometry difference; more is', () => {
    rmSync(join(dir, 'design/styles'), { recursive: true, force: true });
    withSite({ css: '.nav { height: 56.5px; }' }, () => {
      run('pixel-diff.mjs');
      assert.equal(section(results()[0], 'nav').dHeight, 0);
    });
    withSite({ css: '.nav { height: 56.6px; }' }, () => {
      run('pixel-diff.mjs');
      assert.equal(section(results()[0], 'nav').dHeight, 1);
    });
  });
  test('two texts of the design in one element are both found there', () => {
    styles([frame('9:7', 'hero', 56, 180), handle({ characters: '@alex', width: 40 }), handle({ id: '9:9', name: 'kim', characters: 'kim', x: 190, width: 35 })]);
    withSite({ html: (h) => h.replace('<p class="hero__handle">@alexkim</p>', '<p class="hero__handle">@alex<wbr />kim</p>') }, () => {
      run('pixel-diff.mjs');
      assert.equal(styled('hero').missingText, 0);
      assert.deepEqual(offs('hero'), []);
    });
  });

  test('a text the design draws inside a picture is not missing from the build', () => {
    const initials = { id: '9:10', name: 'AK', type: 'TEXT', x: 173, y: 96, width: 28, height: 24, characters: 'AK', fills: [{ type: 'SOLID', color: '#FFFFFF', opacity: 1 }] };
    styles([frame('9:7', 'hero', 56, 180), initials]);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><circle cx="36" cy="36" r="36" fill="#5b5bd6"/></svg>';
    withSite({ html: (h) => h.replace('<div class="avatar" aria-hidden="true">AK</div>', '<img class="avatar" src="avatar.svg" alt="" />'), files: { 'avatar.svg': svg } }, () => {
      run('pixel-diff.mjs');
      // Unmatched: the hero frame (no id, nothing painted) and the initials.
      assert.equal(styled('hero').missingText, 0);
      assert.equal(styled('hero').unmatched, 2);
    });
    withSite({ html: (h) => h.replace('<div class="avatar" aria-hidden="true">AK</div>', '<div class="avatar" aria-hidden="true"></div>') }, () => {
      run('pixel-diff.mjs');
      assert.equal(styled('hero').missingText, 1);
    });
  });

  test('padding is measured through a wrapper of the same size', () => {
    const hero = { ...frame('9:7', 'hero', 56, 172), padding: [16, 20, 24, 20] };
    const paddings = () => offs('hero').filter((line) => / padding| centring/.test(line));
    styles([hero]);
    const id = (h) => h.replace('<section class="hero" data-section="hero">', '<section class="hero" data-section="hero" data-node-id="9:7">');
    withSite({ html: id }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(paddings(), []);
    });
    const wrap = (h) => id(h).replace('data-node-id="9:7">', 'data-node-id="9:7"><div class="hero__in">').replace('<p class="hero__handle">@alexkim</p>\n      </section>', '<p class="hero__handle">@alexkim</p></div></section>');
    const css = '.hero { display: block; padding: 0; } .hero__in { display: flex; flex-direction: column; align-items: center; padding: 16px 20px 24px; }';
    withSite({ html: wrap, css }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(paddings(), []);
    });
    withSite({ html: wrap, css: `${css} .hero__in { padding-left: 40px; }` }, () => {
      run('pixel-diff.mjs');
      assert.equal(paddings().length, 1, offs('hero').join('\n'));
    });
  });

  test('a tint drawn as a flat gradient over a colour is the colour Figma blends', () => {
    // Figma: white under 10 % red. The build: white with a one-colour gradient layer of 10 % red over it.
    styles([{ ...button, fills: [{ type: 'SOLID', color: '#FFFFFF', opacity: 1 }, { type: 'SOLID', color: '#C9302C', opacity: 0.1 }] }]);
    withSite({ css: '.action button { background: #fff linear-gradient(rgba(201, 48, 44, 0.1), rgba(201, 48, 44, 0.1)); }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('action'), []);
    });
    withSite({ css: '.action button { background: #fff linear-gradient(rgba(201, 48, 44, 0.3), rgba(201, 48, 44, 0.3)); }' }, () => {
      run('pixel-diff.mjs');
      assert.equal(offs('action').filter((line) => line.includes('background')).length, 1);
    });
  });

  test('a stroke drawn by a layer over the box counts as the box stroke', () => {
    styles([{ ...button, strokes: [{ type: 'SOLID', color: '#C9302C', opacity: 1 }], strokeAlign: 'INSIDE', strokeWeights: [1, 1, 1, 1] }]);
    const html = (h) => h.replace('<button type="button">Sign out</button>', '<button type="button">Sign out<span class="ring"></span></button>');
    const css = '.action button { position: relative; } .ring { position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px #c9302c; }';
    withSite({ html, css }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('action'), []);
    });
    withSite({ html, css: `${css} .ring { box-shadow: none; }` }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('action'), ['button 9:5 stroke 1 px #C9302C → none']);
    });
  });

  test('a lone caret is not matched to an empty field', () => {
    const caret = { id: '9:12', name: '|', type: 'TEXT', x: 30, y: 530, width: 4, height: 20, characters: '|', fills: [{ type: 'SOLID', color: '#5B5BD6', opacity: 1 }] };
    styles([caret]);
    withSite({ html: (h) => h.replace('<button type="button">Sign out</button>', '<button type="button">Sign out</button><input class="code" />'), css: '.code { position: absolute; left: 20px; width: 40px; }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('action'), []);
      assert.equal(styled('action').missingText, 0);
    });
  });

  test('a frame inside a wrapper of its own size belongs to the wrapper, and their paddings add up', () => {
    // Figma: hero (no padding) > a plain wrapper of the same box > an Auto Layout frame with the padding.
    const hero = { ...frame('9:7', 'hero', 56, 172), padding: [0, 0, 0, 0], primaryAxisAlignItems: 'MIN' };
    const wrapper = { id: '9:13', name: 'wrapper', type: 'FRAME', x: 0, y: 56, width: 375, height: 172 };
    const inner = { ...frame('9:14', 'content', 56, 172), padding: [16, 20, 24, 20] };
    styles([hero, wrapper, inner]);
    withSite({ html: (h) => h.replace('<section class="hero" data-section="hero">', '<section class="hero" data-section="hero" data-node-id="9:7">') }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('hero').filter((line) => line.startsWith('hero 9:7')), []);
    });
  });

  test('a font is checked as drawn: a variable font by its family, a declared font that is not loaded is reported', () => {
    styles([frame('9:7', 'hero', 56, 180), handle({ fontFamily: 'Inter' })]);
    const face = '@font-face { font-family: "Inter Variable"; src: url(inter.woff2) format("woff2"); font-weight: 100 900; }';
    withSite({ css: `${face} .hero__handle { font-family: "Inter Variable", sans-serif; }`, files: { 'inter.woff2': readFileSync('corpus/fonts/Inter-var.woff2') } }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('hero').filter((line) => line.includes('font-family')), []);
    });
    // A family served one file per weight: only the weight the page uses is loaded, and that is the one drawn.
    styles([frame('9:7', 'hero', 56, 180), handle({ fontFamily: 'Inter', fontWeight: 600 })]);
    const semibold = '@font-face { font-family: "Inter"; src: url(inter.woff2) format("woff2"); font-weight: 600; }';
    withSite({ css: `${semibold} .hero__handle { font-family: "Inter", sans-serif; font-weight: 600; }`, files: { 'inter.woff2': readFileSync('corpus/fonts/Inter-var.woff2') } }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('hero').filter((line) => line.includes('font-family')), []);
    });
    styles([frame('9:7', 'hero', 56, 180), handle({ fontFamily: 'Nowhere Sans' })]);
    withSite({ css: '.hero__handle { font-family: "Nowhere Sans", monospace; }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('hero').filter((line) => line.includes('font-family')), ['«@alexkim» font-family Nowhere Sans → Nowhere Sans (not loaded: monospace)']);
    });
  });

  test('a see-through fill is compared as it shows over what lies behind the element', () => {
    // Figma: 10 % red; the build writes the colour it makes over white.
    styles([{ ...button, fills: [{ type: 'SOLID', color: '#C9302C', opacity: 0.1 }] }]);
    withSite({ css: '.action { background: #fff; } .action button { background: #faeaea; }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('action'), []);
    });
    withSite({ css: '.action { background: #000; } .action button { background: #faeaea; }' }, () => {
      run('pixel-diff.mjs');
      assert.equal(offs('action').filter((line) => line.includes('background')).length, 1);
    });
  });

  test('what a closed <details> does not draw is not a child', () => {
    // A question frame hugging its one line; the answer of the closed <details> is laid out below it, unseen.
    // The answer is also a Figma text (drawn open elsewhere). Chromium lays a closed answer out only once
    // something measures it (a page script did on the build this came from; this fixture runs none), so the
    // test guards the rule rather than reproducing the old measurement.
    const item = { id: '9:17', name: 'question', type: 'FRAME', x: 20, y: 184, width: 335, height: 20, sizing: ['HUG', 'HUG'], layoutMode: 'VERTICAL', primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'MIN', itemSpacing: 0, padding: [0, 0, 0, 0] };
    const answer = { id: '9:18', name: 'answer', type: 'TEXT', x: 20, y: 400, width: 80, height: 20, characters: 'An answer', fills: [{ type: 'SOLID', color: '#6B7080', opacity: 1 }] };
    styles([item, answer]);
    const html = (h) => h.replace('<p class="hero__handle">@alexkim</p>', '<details class="hero__handle" data-node-id="9:17"><summary>@alexkim</summary><p>An answer</p></details>');
    const css = '.hero__handle { align-self: stretch; } .hero__handle summary { list-style: none; } .hero__handle p { margin: 0; }';
    withSite({ html, css }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('hero').filter((line) => line.includes('padding')), []);
    });
  });

  test("a vector's corners are its path: no radius is compared, and it holds no text", () => {
    // A badge drawn by a vector over the avatar, with the initials above it.
    const badge = { id: '9:15', name: 'badge', type: 'VECTOR', x: 171.5, y: 90, width: 32, height: 37, radius: 0, fills: [{ type: 'SOLID', color: '#5B5BD6', opacity: 1 }] };
    const initials = { id: '9:16', name: 'AK', type: 'TEXT', x: 175, y: 96, width: 26, height: 24, characters: 'AK', fills: [{ type: 'SOLID', color: '#FFFFFF', opacity: 1 }] };
    styles([badge, initials]);
    run('pixel-diff.mjs');
    // Not found through its text: the avatar around «AK» is not the vector.
    assert.deepEqual(offs('hero').filter((line) => line.startsWith('badge')), []);
    // Found by its id, the element's rounding is not compared with the vector's corner radius.
    withSite({ html: (h) => h.replace('<div class="avatar" aria-hidden="true">AK</div>', '<div class="avatar" aria-hidden="true" data-node-id="9:15">AK</div>'), css: '.avatar { width: 32px; height: 37px; margin-top: 18px; margin-bottom: 29px; }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('hero').filter((line) => line.includes('radius')), []);
    });
  });

  test('padding is measured through a container that spans the element across, whatever else draws nothing', () => {
    const hero = { ...frame('9:7', 'hero', 56, 172), padding: [16, 20, 24, 20], counterAxisAlignItems: 'MIN' };
    const paddings = () => offs('hero').filter((line) => / padding| centring/.test(line));
    styles([hero]);
    // The section holds the vertical padding, a full-width container the side one, and a JSON-LD script sits next to it.
    const html = (h) =>
      h
        .replace('<section class="hero" data-section="hero">', '<section class="hero" data-section="hero" data-node-id="9:7"><div class="hero__in">')
        .replace('<p class="hero__handle">@alexkim</p>\n      </section>', '<p class="hero__handle">@alexkim</p></div><script type="application/ld+json">{}</script></section>');
    const css = '.hero { display: block; padding: 16px 0 24px; } .hero__in { display: flex; flex-direction: column; align-items: flex-start; padding: 0 20px; }';
    withSite({ html, css }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(paddings(), []);
    });
    withSite({ html, css: `${css} .hero__in { padding-left: 32px; }` }, () => {
      run('pixel-diff.mjs');
      assert.equal(paddings().length, 1, offs('hero').join('\n'));
    });
  });

  test('line-height normal is compared by the line it draws', () => {
    // A one-line text with Figma's AUTO line: the build's normal line is right when it draws the same height.
    const auto = (height) => handle({ height, lineHeight: { unit: 'AUTO' }, fontSize: 15 });
    styles([frame('9:7', 'hero', 56, 180), auto(10)]);
    withSite({ css: '.hero__handle { line-height: normal; }' }, () => {
      run('pixel-diff.mjs');
      const line = offs('hero').find((l) => l.includes('line-height'));
      const drawn = Number(/normal \(([\d.]+)\)/.exec(line)?.[1]);
      assert.ok(drawn > 10, line);
      styles([frame('9:7', 'hero', 56, 180), auto(drawn)]);
      run('pixel-diff.mjs');
      assert.deepEqual(offs('hero').filter((l) => l.includes('line-height')), []);
    });
  });

  test('a declared font that is not drawn is reported even when the export has no family', () => {
    styles([frame('9:7', 'hero', 56, 180), handle()]);
    withSite({ css: '.hero__handle { font-family: "Nowhere Sans", monospace; }' }, () => {
      run('pixel-diff.mjs');
      assert.deepEqual(offs('hero').filter((l) => l.includes('font-family')), ['«@alexkim» font-family as declared → Nowhere Sans (not loaded: monospace)']);
    });
  });

  test("a bare label in a button is placed by its glyphs, not by the button's box", () => {
    // Figma's hugging label centred in the 335×48 button (not in Auto Layout, so its position is checked).
    const label = { id: '9:6', name: 'Sign out', type: 'TEXT', x: 157.5, y: 530, width: 60, height: 20, characters: 'Sign out', textAutoResize: 'WIDTH_AND_HEIGHT', fills: [{ type: 'SOLID', color: '#C9302C', opacity: 1 }] };
    styles([label]);
    run('pixel-diff.mjs');
    assert.deepEqual(offs('action').filter((line) => line.includes('position')), []);
    withSite({ css: '.action button { text-align: left; padding-left: 16px; }' }, () => {
      run('pixel-diff.mjs');
      assert.equal(offs('action').filter((line) => line.includes('position')).length, 1);
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

describe('clipped by a frame', () => {
  test('a layer is hidden only by what its clipping frames let an opaque layer cover', async () => {
    const { readFigmaStyles } = await import('../skills/figma-pixel-check/scripts/style-check.mjs');
    // A call card clips a huge avatar background (a component scaled far past the card); the message below the
    // card is drawn later than nothing that covers it, so the design shows it.
    const nodes = [
      { id: '9:1', name: 'Message', type: 'TEXT', x: 20, y: 400, width: 200, height: 40, characters: 'Hello there', textAutoResize: 'HEIGHT', fills: [{ type: 'SOLID', color: '#FFFFFF', opacity: 1 }] },
      { id: '9:2', name: 'Call card', type: 'FRAME', x: 0, y: 0, width: 440, height: 280, clips: true, fills: [{ type: 'SOLID', color: '#22313E', opacity: 1 }] },
      { id: '9:3', name: 'Avatar', type: 'RECTANGLE', x: -240, y: -200, width: 930, height: 930, parent: '9:2', fills: [{ type: 'SOLID', color: '#F19154', opacity: 1 }] },
    ];
    const hidden = (list) => {
      const temp = mkdtempSync(join(tmpdir(), 'figma-pixel-clip-'));
      mkdirSync(join(temp, 'styles'));
      writeFileSync(join(temp, 'styles', 'screen.json'), JSON.stringify({ frame: '1:1', width: 440, height: 600, nodes: list }));
      const found = readFigmaStyles(temp, 'screen', [{ name: 'chat', top: 0, height: 600 }]);
      rmSync(temp, { recursive: true, force: true });
      return found.find((node) => node.id === '9:1')?.hiddenInFigma ?? 'left out';
    };
    assert.equal(hidden(nodes), false);
    // Without the clipping frame the avatar would cover the message.
    assert.equal(hidden(nodes.map((node) => (node.id === '9:2' ? { ...node, clips: false } : node))), 'left out');
  });
});

describe('clipped by the frame', () => {
  test("a box running past the frame's edge is compared by the part the frame shows", async () => {
    const { readFigmaStyles, compareStyles } = await import('../skills/figma-pixel-check/scripts/style-check.mjs');
    // A 62 px bottom bar at y 887 of a 940 px frame: Figma shows 53 px of it, and so does the build.
    const bar = { id: '9:1', name: 'Bar', type: 'RECTANGLE', x: 0, y: 887, width: 1440, height: 62, fills: [{ type: 'SOLID', color: '#0D1E2B', opacity: 1 }] };
    const temp = mkdtempSync(join(tmpdir(), 'figma-pixel-clip-'));
    mkdirSync(join(temp, 'styles'));
    writeFileSync(join(temp, 'styles', 'screen.json'), JSON.stringify({ frame: '1:1', width: 1440, height: 940, nodes: [bar] }));
    const [node] = readFigmaStyles(temp, 'screen', [{ name: 'footer', top: 862, height: 78 }]);
    rmSync(temp, { recursive: true, force: true });
    const style = { backgroundColor: 'rgb(13, 30, 43)', backgroundImage: 'none', boxShadow: 'none', filter: 'none', opacity: '1', borderTopLeftRadius: '0px', borderTopRightRadius: '0px', borderBottomRightRadius: '0px', borderBottomLeftRadius: '0px' };
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) Object.assign(style, { [`border${side}Style`]: 'none', [`border${side}Width`]: '0px' });
    const dom = (height) => ({ matchedBy: 'box', opacity: 1, children: [], childSides: [], style, box: { left: 0, right: 1440, top: 887, bottom: 887 + height } });
    const sizes = (height) => [...compareStyles([node], [dom(height)]).sections.values()].flatMap((entry) => entry.off).filter((off) => off.property === 'size');
    assert.deepEqual(sizes(53), []);
    // Drawn whole past the viewport, it is the same bar; a bar of another height is still reported.
    assert.deepEqual(sizes(62), []);
    assert.equal(sizes(40).length, 1);
  });
});

describe('text width', () => {
  test('one-line texts drawn narrower than in Figma are summed up over the screen', async () => {
    const { compareStyles } = await import('../skills/figma-pixel-check/scripts/style-check.mjs');
    // Eight hugging one-line texts; the build draws each 3 % narrower, with the same font, size and weight.
    const nodes = Array.from({ length: 8 }, (_, i) => ({
      id: `9:${i}`, name: `t${i}`, type: 'TEXT', characters: `Label ${i}`, x: 20, y: 20 + i * 30, width: 100, height: 20,
      textAutoResize: 'WIDTH_AND_HEIGHT', fontFamily: 'Inter', fontSize: 15, fontWeight: 400, lineHeight: { unit: 'PIXELS', value: 20 },
      fills: [{ type: 'SOLID', color: '#000000', opacity: 1 }], place: { index: 0 }, flow: true,
    }));
    const style = {
      fontFamily: 'Inter', fontSize: '15px', fontWeight: '400', lineHeight: '20px', letterSpacing: 'normal', textTransform: 'none',
      color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', boxShadow: 'none', filter: 'none', opacity: '1',
    };
    const doms = nodes.map((node) => ({
      matchedBy: 'text', text: node.characters, opacity: 1, drawnFamily: 'Inter', children: [], childSides: [], style,
      box: { left: 20, right: 117, top: node.y, bottom: node.y + 20 }, textBox: { left: 20, right: 117, top: node.y, bottom: node.y + 20 },
    }));
    const { textWidth } = compareStyles(nodes, doms);
    assert.equal(textWidth.count, 8);
    assert.ok(Math.abs(textWidth.median - 0.97) < 1e-9, String(textWidth.median));
    // A text whose size differs says nothing about the font files.
    doms[0] = { ...doms[0], style: { ...style, fontSize: '14px' } };
    assert.equal(compareStyles(nodes, doms).textWidth.count, 7);
  });
});

describe('REST export', () => {
  test("a REST document becomes the plugin export's nodes and a sections skeleton", async () => {
    const { nodesFromRest, sectionsSkeleton } = await import('../skills/figma-pixel-check/scripts/figma-rest-export.mjs');
    const frame = {
      id: '1:1', name: 'Screen', absoluteBoundingBox: { x: 100, y: 200, width: 375, height: 300 },
      children: [
        { id: '1:2', name: 'Header', type: 'FRAME', absoluteBoundingBox: { x: 100, y: 200, width: 375, height: 60 }, fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
          layoutMode: 'HORIZONTAL', itemSpacing: 8, paddingLeft: 20, paddingRight: 20, counterAxisAlignItems: 'CENTER', cornerRadius: 12,
          individualStrokeWeights: { top: 0, right: 0, bottom: 1, left: 0 }, strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 0.1 }], strokeAlign: 'INSIDE',
          children: [{ id: '1:3', name: 'Title', type: 'TEXT', characters: 'Hello', absoluteBoundingBox: { x: 120, y: 218, width: 50, height: 24 },
            fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }], layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG',
            style: { fontFamily: 'Inter', fontWeight: 600, fontSize: 17, lineHeightPx: 24, lineHeightUnit: 'PIXELS', letterSpacing: -0.2, textAutoResize: 'WIDTH_AND_HEIGHT' } }] },
        { id: '1:4', name: 'Hidden', type: 'RECTANGLE', visible: false, absoluteBoundingBox: { x: 100, y: 300, width: 10, height: 10 } },
        { id: '1:5', name: 'Card list', type: 'FRAME', absoluteBoundingBox: { x: 100, y: 280, width: 375, height: 200 }, opacity: 0.5,
          children: [{ id: '1:6', name: 'Body', type: 'TEXT', characters: 'x', absoluteBoundingBox: { x: 120, y: 290, width: 10, height: 20 }, style: { fontSize: 14 } }] },
      ],
    };
    const { nodes, width, height, total } = nodesFromRest(frame);
    assert.deepEqual([width, height, total], [375, 300, 4]);
    const [header, title, list, body] = nodes;
    assert.deepEqual({ x: header.x, y: header.y, radius: header.radius, padding: header.padding, counter: header.counterAxisAlignItems, weights: header.strokeWeights, stroke: header.strokes[0] },
      { x: 0, y: 0, radius: 12, padding: [0, 20, 0, 20], counter: 'CENTER', weights: [0, 0, 1, 0], stroke: { type: 'SOLID', color: '#000000', opacity: 0.1 } });
    assert.deepEqual({ lh: title.lineHeight, ls: title.letterSpacing, sizing: title.sizing, fill: title.fills[0].color, x: title.x },
      { lh: { unit: 'PIXELS', value: 24 }, ls: { unit: 'PIXELS', value: -0.2 }, sizing: ['HUG', 'HUG'], fill: '#000000', x: 20 });
    assert.equal(body.effectiveOpacity, 0.5);
    assert.deepEqual([header.parent, title.parent, body.parent], [undefined, '1:2', '1:5']);
    assert.deepEqual(body.lineHeight, { unit: 'AUTO' });
    assert.equal(list.opacity, 0.5);
    assert.deepEqual(sectionsSkeleton(frame), [{ name: 'header', top: 0, height: 70 }, { name: 'card-list', top: 70, height: 230 }]);
  });

  test('an app shell of panels side by side becomes one region per column, under a footer drawn above them', async () => {
    const { sectionsSkeleton } = await import('../skills/figma-pixel-check/scripts/figma-rest-export.mjs');
    const box = (name, x, y, width, height) => ({ name, absoluteBoundingBox: { x, y, width, height } });
    const frame = { absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 800 }, children: [
      box('Top bar', 0, 0, 1200, 60), box('Sidebar', 0, 59, 300, 760), box('Chat', 900, 60, 300, 740), box('Feed', 310, 300, 580, 600), box('Bottom bar', 0, 720, 1200, 80),
    ] };
    assert.deepEqual(sectionsSkeleton(frame), [
      { name: 'top-bar', top: 0, height: 60 },
      { name: 'sidebar', top: 60, height: 660, left: 0, width: 305 },
      { name: 'feed', top: 60, height: 660, left: 305, width: 590 },
      { name: 'chat', top: 60, height: 660, left: 895, width: 305 },
      { name: 'bottom-bar', top: 720, height: 80 },
    ]);
  });

  test('a wrapper around the panels is looked into, a landing section is not', async () => {
    const { sectionsSkeleton } = await import('../skills/figma-pixel-check/scripts/figma-rest-export.mjs');
    const box = (name, x, y, width, height, children) => ({ name, absoluteBoundingBox: { x, y, width, height }, ...(children ? { children } : {}) });
    const app = { absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 800 }, children: [
      box('Top bar', 0, 0, 1200, 60),
      box('Body', 0, 60, 1200, 740, [box('Sidebar', 0, 60, 300, 680), box('Feed', 310, 60, 580, 680), box('Chat', 900, 60, 300, 680), box('Bottom bar', 0, 740, 1200, 60)]),
    ] };
    assert.deepEqual(sectionsSkeleton(app), [
      { name: 'top-bar', top: 0, height: 60 },
      { name: 'sidebar', top: 60, height: 680, left: 0, width: 305 },
      { name: 'feed', top: 60, height: 680, left: 305, width: 590 },
      { name: 'chat', top: 60, height: 680, left: 895, width: 305 },
      { name: 'bottom-bar', top: 740, height: 60 },
    ]);
    const landing = { absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 1000 }, children: [
      box('Nav', 0, 0, 1200, 80), box('Hero', 0, 80, 1200, 600, [box('Title', 100, 120, 600, 80), box('Buttons', 100, 240, 400, 50)]), box('Footer', 0, 680, 1200, 320),
    ] };
    assert.deepEqual(sectionsSkeleton(landing).map((section) => section.name), ['nav', 'hero', 'footer']);
  });

  test('a panel drawn over the top of the footer still ends where the footer starts', async () => {
    const { sectionsSkeleton } = await import('../skills/figma-pixel-check/scripts/figma-rest-export.mjs');
    const box = (name, x, y, width, height) => ({ name, absoluteBoundingBox: { x, y, width, height } });
    const frame = { absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 800 }, children: [
      box('Chat', 900, 60, 300, 740), box('Sidebar', 0, 59, 300, 760), box('Top bar', 0, 0, 1200, 60), box('Bottom bar', 0, 720, 1200, 80), box('Feed', 310, 100, 580, 644),
    ] };
    assert.deepEqual(sectionsSkeleton(frame).map((s) => [s.name, s.top, s.height, s.left ?? null]), [
      ['top-bar', 0, 60, null], ['sidebar', 60, 660, 0], ['feed', 60, 660, 305], ['chat', 60, 660, 895], ['bottom-bar', 720, 80, null],
    ]);
  });
});
