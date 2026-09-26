# PIXEL-SPEC: layout versus Figma

Pass 1, 2026-09-26. Chromium (Playwright 1.56.1, headless shell, Linux), DPR 1, pixelmatch threshold 0.25.
Per-section details: `diff/report.md` after `pixel-diff.mjs`; spacing: [`SPACING-AUDIT.md`](SPACING-AUDIT.md).

## Summary

**Sections** is the metric (every section compared from its own top). **Whole page** is a diagnostic only.

| Screen | Node | Width | Sections | Whole page | Comment |
| ------ | ---- | ----- | -------- | ---------- | ------- |
| type   | 2:18 | 375   | 2.94 %   | 2.91 %     | 12 text styles, one per band; worst section headline 4.93 % (line width) |

Geometry: all 12 sections match Figma (Δ top 0, Δ height 0); `--max-geometry=0 --max-section=7` passes.
Console errors and CSP violations: none. Responsive audit (360–440 px, six devices): no findings, so no
`responsive-known.json`.

## Fixed

| Pass | What | Why | Node |
| ---- | ---- | --- | ---- |
| 1 | auto-lh: `line-height: normal` → `21px` | Chromium's `normal` for Inter at 17 px is 20 px, Figma AUTO is a 21 px box; the band was 44 instead of 45 px (Δ height −1) and everything below moved up 1 px | 2:38 |
| 1 | `.screen { width: 375px }` removed; the bands are a flex column that fills the viewport | a fixed design width does not belong in a responsive page | 2:18 |
| 1 | bands built as Figma's auto layout: `display: flex; flex-direction: column; align-items: flex-start; padding: 12px 20px` | the draft used plain block sections; values from `figma-code/type.tsx` | 2:19–2:41 |
| 1 | colour values moved to tokens (`--text-primary` #101828, `--text-secondary` #475467, `--text-tertiary` #667085) | three colours reused across nine styles | — |
| 1 | Figma's `whitespace-nowrap` and the frames' `overflow-clip` not copied | on a 280–300 px screen (Galaxy Fold cover) they cut "Headline 22 / 28 semibol" and the footnote at the screen edge; the lines now wrap | 2:24, 2:32 |

## Kept on purpose

1. **Text 1 px higher in overline, auto-lh, percent-lh and tight.** Ink centroid −0.97, −0.96, −1.03, −0.97 px
   against the reference; the boxes are exact. Blink puts the baseline at `round(ascent) + floor(half-leading)`
   with `half-leading = (line-height − round(ascent) − round(descent)) / 2`, Figma at the exact
   `(line-height − (ascent + descent)) / 2 + ascent`. Where Figma's value rounds up, Chromium is 1 px higher:
   11/13 (Figma 10.50, Chromium 10), 17/21 (16.68, 16), 15/22.5 (16.71, 16), 24/30 (23.73, 23). The other
   eight styles land on the same pixel. `line-height: 23px` instead of 150 % would put percent-lh on
   Figma's pixel (3.30 → 1.94 %) but is not the design's value and only works at 15 px; per-band padding
   nudges were not made either. The reason is on each section in `sections/type.json`.
2. **Line widths differ by −4 … +3.4 px (title 3.49 %, headline 4.93 %, callout 4.59 %).** The capture's
   Chromium hints glyph advances to whole pixels (text widths 179, 230, 219, 183 px without letter
   spacing), Figma does not: title 230 vs 235, headline 273.5 vs 271, callout 217.0 vs 221, caption
   243.8 vs 248, tight 214.4 vs 211. With `--font-render-hinting=none` the same page measures title 232.9,
   headline 270.5, callout 217.9, caption 246.4, tight 213.2 (display 180.1 against Figma's 180). The spacing audit's three **Right** flags (headline −4, caption +5,
   tight −5) are these widths, not margins: the CSS sizes, weights and letter spacing equal
   `figma-code/type.tsx`.
3. **Chromium's glyphs are heavier than Figma's** (ink 1.04–1.12× the reference for Regular and Medium),
   which is most of the remaining per-section mismatch. Not changed: a lighter weight or colour would lower
   the number and be wrong.

## Open

1. None. The line-height question below does not block the layout.

## Questions for design

1. percent-lh (2:40): the design says 150 % (22.5 px), the saved metadata says the text box is 23 px and
   the band 47 px. Is 22.5 px intended, or should the style use a whole-pixel line height (23 px)?
