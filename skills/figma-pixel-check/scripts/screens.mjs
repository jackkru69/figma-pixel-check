// Screens and their states, from <dir>/sections/<id>.json, for pixel-diff.mjs.
//
// A sections file without "states" is one screen named after the file, as before. With "states", each
// state is a screen of its own named <id>--<state> (checkout--default, checkout--menu-open), with its
// artifacts under that name. A state takes the file's reference, size, sections and url unless it sets its
// own; every state but "default" must name its own reference, exported from its own Figma frame or variant:
//
//   "states": [
//     { "name": "default" },
//     { "name": "menu-open", "reference": "checkout-menu-open-375.png", "actions": [{ "click": "#menu" }] },
//     { "name": "email-focus", "reference": "checkout-email-focus-375.png", "actions": [{ "focus": "#email" }] },
//     { "name": "disabled", "reference": "checkout-disabled-375.png", "url": "/preview/checkout?disabled=1" }
//   ]
//
// Actions run in order after the page has loaded, with animations and transitions already frozen, so a
// state is reached at once and captured the same way every time. They are not a test framework: each
// one brings the page into the state its Figma frame draws. A selector must match exactly one element.
//   {"hover": sel}  {"click": sel}  {"focus": sel}  {"check": sel}  {"uncheck": sel}
//   {"fill": sel, "value": "text"}  {"select": sel, "value": "option"}
//   {"press": "Tab"} (the focused element)  {"press": "Enter", "on": sel}
//   {"mouse": [x, y]} (move the pointer, e.g. away after a click)  {"wait": ms}  {"waitFor": sel}
// A state that no action can reach (disabled, loading, an error from the API) comes from its preview
// route: give the state its own "url".
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const VERBS = ['hover', 'click', 'focus', 'check', 'uncheck', 'fill', 'select', 'press', 'mouse', 'wait', 'waitFor'];
const OPTIONS = { fill: ['value'], select: ['value'], press: ['on'] };
const STATE_NAME = /^[a-z0-9][a-z0-9-]*$/i;

/** Whole-pixel top and height of a box with fractional edges: each edge is rounded, not the size. */
export function snap(top, height) {
  const snappedTop = Math.round(top);
  return { top: snappedTop, height: Math.round(top + height) - snappedTop };
}

/** snap() of a horizontal extent, as {left, width}. */
export function toX({ top, height }) {
  return { left: top, width: height };
}

/** Every screen of the sections folder, states expanded: [[id, screen]] in file order. */
export function loadScreens(sectionsDir) {
  return readdirSync(sectionsDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .flatMap((file) => {
      const id = file.slice(0, -'.json'.length);
      const raw = JSON.parse(readFileSync(join(sectionsDir, file), 'utf8'));
      const where = join(sectionsDir, file);
      if (!('states' in raw)) return [[id, { ...readScreen(raw, where), base: id, state: null, actions: [] }]];
      if (!Array.isArray(raw.states) || raw.states.length === 0) throw new Error(`${where}: "states" must be a non-empty list`);
      const names = new Set();
      return raw.states.map((state) => {
        const name = state?.name;
        if (typeof name !== 'string' || !STATE_NAME.test(name)) {
          throw new Error(`${where}: a state needs a "name" of letters, digits and dashes, got ${JSON.stringify(name)}`);
        }
        if (names.has(name)) throw new Error(`${where}: state "${name}" is listed twice`);
        names.add(name);
        if (name !== 'default' && !state.reference) {
          throw new Error(`${where}: state "${name}" needs its own "reference", the PNG of its Figma frame`);
        }
        const { states: _, ...shared } = raw;
        const { name: __, actions = [], ...own } = state;
        const screen = readScreen({ ...shared, ...own }, `${where} (state "${name}")`);
        return [`${id}--${name}`, { ...screen, base: id, state: name, actions: readActions(actions, `${where}: state "${name}"`) }];
      });
    });
}

function readScreen(screen, where) {
  const sizes = [screen.width, screen.height].every((value) => Number.isInteger(value) && value > 0);
  const sections =
    Array.isArray(screen.sections) &&
    screen.sections.length > 0 &&
    screen.sections.every((s) => typeof s.name === 'string' && Number.isFinite(s.top) && Number.isFinite(s.height));
  if (typeof screen.reference !== 'string' || !sizes || !sections) {
    throw new Error(`${where}: expected {reference, width, height, sections: [{name, top, height}, ...]} with integer sizes`);
  }
  for (const section of screen.sections) {
    // A region: left and width (both or neither) cut a column out of the band, e.g. a sidebar.
    if (('left' in section || 'width' in section) && !(Number.isFinite(section.left) && Number.isFinite(section.width) && section.width > 0)) {
      throw new Error(`${where}: section "${section.name}": a region needs a left and a width > 0`);
    }
    for (const key of ['maxGeometry', 'maxMismatch', 'maxColor', 'maxStyle']) {
      if (key in section && !(Number.isFinite(section[key]) && section[key] >= 0)) {
        throw new Error(`${where}: section "${section.name}": ${key} must be a number ≥ 0`);
      }
    }
  }
  // Fractional boxes (hand-copied from figma-boxes.py) are snapped by their edges, as Chromium paints them.
  const snapped = screen.sections.map((section) => {
    const box = { ...section, ...snap(section.top, section.height) };
    if ('left' in section) Object.assign(box, toX(snap(section.left, section.width)));
    return box;
  });
  const empty = snapped.find((section) => section.height <= 0);
  if (empty) throw new Error(`${where}: section "${empty.name}" has no height`);
  const outside = snapped.find((section) => section.top >= screen.height);
  if (outside) throw new Error(`${where}: section "${outside.name}" starts at ${outside.top}, below the ${screen.height} px frame`);
  return { ...screen, sections: snapped };
}

/** Validates a state's actions: one verb each, with only its own options. */
export function readActions(actions, where) {
  if (!Array.isArray(actions)) throw new Error(`${where}: "actions" must be a list`);
  return actions.map((action) => {
    const keys = Object.keys(action ?? {});
    const verbs = keys.filter((key) => VERBS.includes(key));
    const verb = verbs[0];
    const extra = keys.filter((key) => key !== verb && !(OPTIONS[verb] ?? []).includes(key));
    if (verbs.length !== 1 || extra.length) {
      throw new Error(`${where}: action ${JSON.stringify(action)}: expected one of ${VERBS.join(', ')}${verb && OPTIONS[verb] ? ` (with ${OPTIONS[verb].join(', ')})` : ''}`);
    }
    const value = action[verb];
    const ok =
      verb === 'wait'
        ? Number.isFinite(value) && value >= 0 && value <= 10_000
        : verb === 'mouse'
          ? Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
          : typeof value === 'string' && value.trim() !== '';
    if (!ok || (['fill', 'select'].includes(verb) && typeof action.value !== 'string')) {
      throw new Error(`${where}: action ${JSON.stringify(action)}: ${verb === 'wait' ? 'milliseconds up to 10000' : verb === 'mouse' ? '[x, y]' : 'a selector or key'}${['fill', 'select'].includes(verb) ? ' and a "value"' : ''} expected`);
    }
    return action;
  });
}

/** Brings the page into a state. A selector that matches no element or several is an error. */
export async function applyActions(page, actions) {
  // A selector must name one element: with several, which one the state means would be a guess.
  const one = (selector) => {
    const locator = page.locator(selector);
    return {
      async act(method, ...args) {
        const count = await locator.count();
        if (count > 1) throw new Error(`"${selector}" matches ${count} elements; the selector must match one`);
        return locator[method](...args);
      },
    };
  };
  const options = { timeout: 5000 };
  for (const action of actions) {
    try {
      if ('hover' in action) await one(action.hover).act('hover', options);
      else if ('click' in action) await one(action.click).act('click', options);
      else if ('focus' in action) await one(action.focus).act('focus', options);
      else if ('check' in action) await one(action.check).act('check', options);
      else if ('uncheck' in action) await one(action.uncheck).act('uncheck', options);
      else if ('fill' in action) await one(action.fill).act('fill', action.value, options);
      else if ('select' in action) await one(action.select).act('selectOption', action.value, options);
      else if ('press' in action) await (action.on ? one(action.on).act('press', action.press, options) : page.keyboard.press(action.press));
      else if ('mouse' in action) await page.mouse.move(...action.mouse);
      else if ('wait' in action) await page.waitForTimeout(action.wait);
      else if ('waitFor' in action) await one(action.waitFor).act('waitFor', { state: 'visible', ...options });
    } catch (error) {
      throw new Error(`action ${JSON.stringify(action)}: ${error.message.split('\n')[0]}`);
    }
  }
  // Whatever the page does in reply (a framework re-rendering, a menu mounting) lands before the capture.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}
