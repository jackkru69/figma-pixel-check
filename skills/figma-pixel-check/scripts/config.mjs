// Settings shared by pixel-diff.mjs, spacing-audit.mjs and responsive-audit.mjs: figma-pixel.config.json in the working directory
// (or --config=<file>, --config <file>). Every key is optional; DEFAULTS documents them.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DEFAULTS = {
  // Holds sections/<id>.json and reference/*.png; diff/ and SPACING-AUDIT.md are written here.
  dir: 'design/figma',
  // Command that builds the app with the preview routes; null means there is nothing to build.
  build: 'npm run build',
  // Static build output, served with an SPA fallback. Ignored when baseUrl is set.
  dist: 'dist',
  // An already running server (e.g. "http://127.0.0.1:4173") to capture instead of serving dist.
  baseUrl: null,
  // Route of one screen; {id} is the name of sections/<id>.json. A screen can override it with "url".
  url: '/preview/{id}',
  // pixelmatch threshold: Figma and Chromium antialias text differently, 0.1 lights up every glyph.
  threshold: 0.25,
  // Extra CSS applied during capture, e.g. the iOS status bar drawn in the frames: ":root { --safe-top: 53px; }".
  captureCss: '',
  // The spacing audit flags differences of at least this many pixels.
  spacingFlag: 4,
  // Viewports of the responsive audit (CSS pixels). Each may add its own captureCss, e.g. its safe areas.
  devices: [
    { name: 'Small Android', width: 360, height: 640 },
    { name: 'Android', width: 360, height: 780 },
    { name: 'iPhone 13 mini', width: 375, height: 812 },
    { name: 'iPhone 16', width: 393, height: 852 },
    { name: 'Large Android', width: 412, height: 915 },
    { name: 'iPhone 16 Pro Max', width: 440, height: 956 },
  ],
  // The element whose edges are the screen's edges for the responsive audit: clipping inside it is intended.
  screenRoot: 'body',
};

export function loadConfig(args = process.argv.slice(2)) {
  const index = args.findIndex((arg) => arg === '--config' || arg.startsWith('--config='));
  const option = index === -1 ? undefined : args[index] === '--config' ? args[index + 1] : args[index].slice(9);
  if (index !== -1 && !option) throw new Error('--config: expected a file name');
  const file = resolve(option ?? 'figma-pixel.config.json');
  if (option && !existsSync(file)) throw new Error(`Config not found: ${file}`);
  const user = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const unknown = Object.keys(user).filter((key) => !(key in DEFAULTS) && !key.startsWith('//'));
  if (unknown.length > 0) {
    throw new Error(`Unknown keys in ${file}: ${unknown.join(', ')}. Known: ${Object.keys(DEFAULTS).join(', ')}`);
  }
  return { ...DEFAULTS, ...user };
}
