// Hotspots on synthetic diff images: fast, no browser. The region case runs end to end in gates.test.mjs.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PNG } from 'pngjs';
import { drawHotspots, findHotspots } from '../skills/figma-pixel-check/scripts/hotspots.mjs';

const RED = [255, 0, 0, 255];
const BLUE = [0, 110, 255, 255];
const MAGENTA = [255, 0, 255, 255];

/** A diff image as pixelmatch leaves it: faded grey everywhere, marks where told. */
function diffImage(width, height) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([235, 235, 235, 255], i);
  return png;
}
const fill = (png, x, y, w, h, rgba = RED) => {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) png.data.set(rgba, (yy * png.width + xx) * 4);
};
/** Glyph-edge noise on a text line: a mark every few pixels, like Figma's and Chromium's text drawn apart. */
const textNoise = (png, top, left = 16, right = png.width - 16) => {
  for (let x = left; x < right; x += 3) {
    png.data.set(x % 2 ? RED : BLUE, ((top + (x % 5)) * png.width + x) * 4);
    png.data.set(RED, ((top + 7 - (x % 3)) * png.width + x + 1) * 4);
  }
};

describe('hotspots', () => {
  test('one local error is one box around it', () => {
    const png = diffImage(375, 120);
    fill(png, 214, 16, 92, 44);
    const [spot, ...rest] = findHotspots(png);
    assert.equal(rest.length, 0);
    assert.deepEqual([spot.x, spot.y, spot.width, spot.height], [214, 16, 92, 44]);
    assert.equal(spot.mismatch, 1);
    assert.equal(spot.share, 1);
  });

  test('two independent errors are two boxes, the larger first', () => {
    const png = diffImage(375, 120);
    fill(png, 18, 62, 130, 20);
    fill(png, 250, 10, 40, 30, BLUE);
    const spots = findHotspots(png);
    assert.deepEqual(
      spots.map((s) => [s.x, s.y, s.width, s.height]),
      [[18, 62, 130, 20], [250, 10, 40, 30]],
    );
    assert.ok(spots[0].share > spots[1].share);
  });

  test('text rasterisation noise on every line makes no hotspot, and does not hide a real error', () => {
    const png = diffImage(375, 460);
    for (let line = 0; line < 20; line++) textNoise(png, 10 + line * 19);
    assert.deepEqual(findHotspots(png), []);
    // An icon below the text (a mark inside a line of text is boxed with that line's noise).
    fill(png, 300, 400, 40, 40);
    const spots = findHotspots(png);
    assert.ok(spots.length <= 3, `${spots.length} hotspots`);
    assert.deepEqual([spots[0].x, spots[0].y, spots[0].width, spots[0].height], [300, 400, 40, 40]);
  });

  test('a very small change: 5×5 px is a hotspot, a 3×3 px speck is not', () => {
    const png = diffImage(200, 100);
    fill(png, 100, 40, 5, 5);
    assert.deepEqual(findHotspots(png).map((s) => [s.x, s.y, s.width, s.height]), [[100, 40, 5, 5]]);
    const speck = diffImage(200, 100);
    fill(speck, 100, 40, 3, 3);
    assert.deepEqual(findHotspots(speck), []);
  });

  test('an error at the edge of the section is boxed within it', () => {
    const png = diffImage(375, 80);
    fill(png, 0, 0, 24, 12);
    fill(png, 355, 60, 20, 20);
    const spots = findHotspots(png).map((s) => [s.x, s.y, s.width, s.height]).sort();
    assert.deepEqual(spots, [[0, 0, 24, 12], [355, 60, 20, 20]]);
    // The outline is drawn where it fits, never outside the image.
    const drawn = drawHotspots(diffImage(375, 80), findHotspots(png));
    assert.deepEqual([drawn.width, drawn.height], [375, 80]);
  });

  test('marks close together join into one box; far apart they stay two', () => {
    const png = diffImage(300, 60);
    fill(png, 20, 20, 10, 10);
    fill(png, 34, 20, 10, 10); // 4 px apart: one element with its label
    fill(png, 200, 20, 10, 10);
    assert.deepEqual(findHotspots(png).map((s) => [s.x, s.width]).sort((a, b) => a[0] - b[0]), [[20, 24], [200, 10]]);
  });

  test('pixels of the colour check count, and are told apart', () => {
    const png = diffImage(200, 60);
    fill(png, 10, 10, 30, 30, MAGENTA);
    const [spot] = findHotspots(png);
    assert.equal(spot.colour, 900);
    assert.equal(spot.pixels, 900);
  });

  test('an unmarked diff has no hotspots', () => {
    assert.deepEqual(findHotspots(diffImage(100, 100)), []);
  });
});
