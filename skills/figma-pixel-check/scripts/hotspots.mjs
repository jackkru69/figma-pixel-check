// Hotspots: where inside a section its mismatch is. A diagnostic on top of the section numbers, never a
// verdict of its own: it reads the same diff that pixel-diff counts (pixelmatch's red and blue, the colour
// check's magenta, the rows below the capture) and groups the marked pixels into boxes.
//
// 1. Marked pixels within GROUP px of each other (a word's glyphs, a card's edge) form one cluster.
// 2. Clusters of fewer than MIN_PIXELS are specks of text rasterisation and are dropped.
// 3. Clusters closer than JOIN px are joined into one box (a line of text, an icon with its label).
// 4. A box is a hotspot when it holds at least SHARE of the section's marked pixels. Figma and Chromium draw
//    text a little differently everywhere; that noise is spread over every line and no box of it stands out,
//    while one wrong element concentrates the mismatch. So a section has at most 1 / SHARE hotspots, and a
//    change spread over the whole section (a font size on every row) has none: the section numbers and the
//    style check report that.
// The thresholds were set on the corpus renders of correct implementations: at most 3 boxes per section.
import { PNG } from 'pngjs';

export const GROUP = 3;
export const MIN_PIXELS = 16;
export const JOIN = 6;
export const SHARE = 0.1;
const LIMIT = 10;

/** Whether a diff pixel is marked: pixelmatch red / blue (diffColorAlt), colour-check magenta. */
const marked = (d, i) =>
  (d[i] === 255 && d[i + 1] === 0 && (d[i + 2] === 0 || d[i + 2] === 255) && d[i + 3] === 255) ||
  (d[i] === 0 && d[i + 1] === 110 && d[i + 2] === 255 && d[i + 3] === 255);

/**
 * Hotspots of a section's diff image, largest first: [{x, y, width, height, pixels, colour, share, mismatch}],
 * in the section's own pixels. colour: how many of the pixels the colour check marked; share: of the section's
 * marked pixels; mismatch: of the box's own area.
 */
export function findHotspots(diff) {
  const { width, height } = diff;
  // 1 marks a pixel, 2 a pixel of the colour check (magenta).
  const mask = new Uint8Array(width * height);
  let total = 0;
  for (let p = 0; p < mask.length; p++) {
    if (marked(diff.data, p * 4)) {
      mask[p] = diff.data[p * 4 + 2] === 255 && diff.data[p * 4] === 255 ? 2 : 1;
      total++;
    }
  }
  if (total === 0) return [];
  // 1. Clusters: a flood fill that jumps gaps of up to GROUP px.
  const seen = new Uint8Array(mask.length);
  const clusters = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    const stack = [start];
    const box = { left: width, top: height, right: -1, bottom: -1, pixels: 0, colour: 0 };
    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = (p - x) / width;
      box.pixels++;
      if (mask[p] === 2) box.colour++;
      box.left = Math.min(box.left, x);
      box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y);
      box.bottom = Math.max(box.bottom, y);
      for (let ny = Math.max(0, y - GROUP); ny <= Math.min(height - 1, y + GROUP); ny++) {
        for (let nx = Math.max(0, x - GROUP); nx <= Math.min(width - 1, x + GROUP); nx++) {
          const q = ny * width + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    // 2. Specks go.
    if (box.pixels >= MIN_PIXELS) clusters.push(box);
  }
  // 3. Near boxes join, until no two are within JOIN px.
  const near = (a, b) =>
    a.left - JOIN <= b.right + 1 && b.left - JOIN <= a.right + 1 && a.top - JOIN <= b.bottom + 1 && b.top - JOIN <= a.bottom + 1;
  let joined = true;
  while (joined) {
    joined = false;
    for (let i = 0; i < clusters.length && !joined; i++) {
      for (let j = i + 1; j < clusters.length && !joined; j++) {
        if (!near(clusters[i], clusters[j])) continue;
        const [a, b] = [clusters[i], clusters[j]];
        clusters[i] = {
          left: Math.min(a.left, b.left),
          top: Math.min(a.top, b.top),
          right: Math.max(a.right, b.right),
          bottom: Math.max(a.bottom, b.bottom),
          pixels: a.pixels + b.pixels,
          colour: a.colour + b.colour,
        };
        clusters.splice(j, 1);
        joined = true;
      }
    }
  }
  // 4. Only what stands out of the section's mismatch.
  return clusters
    .filter((box) => box.pixels >= SHARE * total)
    .sort((a, b) => b.pixels - a.pixels)
    .slice(0, LIMIT)
    .map((box) => {
      const w = box.right - box.left + 1;
      const h = box.bottom - box.top + 1;
      return {
        x: box.left,
        y: box.top,
        width: w,
        height: h,
        pixels: box.pixels,
        colour: box.colour,
        share: box.pixels / total,
        mismatch: box.pixels / (w * h),
      };
    });
}

/** The section's build crop, faded, with each hotspot outlined and numbered by a mark in its corner. */
export function drawHotspots(actual, hotspots, width = actual.width, height = actual.height) {
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (y >= actual.height || x >= actual.width) {
        out.data.set([255, 255, 255, 255], o);
        continue;
      }
      const i = (y * actual.width + x) * 4;
      const alpha = actual.data[i + 3] / 255;
      // Faded to 45 %, so the outlines read on any background.
      for (let c = 0; c < 3; c++) out.data[o + c] = Math.round(255 - 0.45 * (255 - (actual.data[i + c] * alpha + 255 * (1 - alpha))));
      out.data[o + 3] = 255;
    }
  }
  const put = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    out.data.set([...rgb, 255], (y * width + x) * 4);
  };
  hotspots.forEach((spot, index) => {
    const rgb = index === 0 ? [230, 0, 60] : [255, 120, 0];
    // Two px outside the box, so the outline never covers what it points at.
    const [l, t, r, b] = [spot.x - 2, spot.y - 2, spot.x + spot.width + 1, spot.y + spot.height + 1];
    for (let x = l; x <= r; x++) for (const y of [t, t + 1, b - 1, b]) put(x, y, rgb);
    for (let y = t; y <= b; y++) for (const x of [l, l + 1, r - 1, r]) put(x, y, rgb);
    // index + 1 dots in the top-left corner: 1, 2, 3...
    for (let n = 0; n <= index; n++) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) put(l + 3 + n * 5 + dx, t + 3 + dy, rgb);
  });
  return out;
}

/** "x=214 y=16 w=92 h=44 — 18.4 %" */
export const describeHotspot = (spot) =>
  `x=${spot.x} y=${spot.y} w=${spot.width} h=${spot.height} — ${(spot.mismatch * 100).toFixed(1)} % of the box, ${Math.round(spot.share * 100)} % of the section's mismatch`;
