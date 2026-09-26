# PIXEL-SPEC: layout versus Figma

Pass 1, 2026-09-26. Chromium 141.0.7390.37 (Playwright 1.56.1, headless shell, Linux), DPR 1, pixelmatch threshold 0.25.
Per-section details: `diff/report.md` after `pixel-diff.mjs`; spacing: [`SPACING-AUDIT.md`](SPACING-AUDIT.md).

## Summary

**Sections** is the metric (every section compared from its own top). **Whole page** is a diagnostic only.

| Screen     | Node | Width | Sections | Whole page | Comment                                                                 |
| ---------- | ---- | ----- | -------- | ---------- | ----------------------------------------------------------------------- |
| fractional | 2:98 | 375   | 2.21 %   | 2.21 %     | geometry exact; text drift from hinted glyph advances, 0.5 px rule at DPR 1 |

| Section         | Figma top/h | DOM top/h | Δ top | Δ height | Mismatch |
| --------------- | ----------- | --------- | ----- | -------- | -------- |
| half-band       | 0/49        | 0/49      | 0     | 0        | 1.45 %   |
| half-box        | 49/61       | 49/61     | 0     | 0        | 0.00 %   |
| hairline        | 110/56      | 110/56    | 0     | 0        | 2.33 %   |
| odd-line-height | 166/67      | 166/67    | 0     | 0        | 8.41 %   |
| icon-strokes    | 233/56      | 233/56    | 0     | 0        | 0.00 %   |
| half-grid       | 289/112     | 289/112   | 0     | 0        | 1.09 %   |

Geometry: DOM tops and heights of all six sections match Figma (unsnapped DOM boxes: 48.5, 61, 56.5, 67, 56, 112,
exactly the Figma frames). `pixel-diff.mjs --max-section=4 --max-geometry=1` passes with the one section override
below. Spacing audit: 0 values flagged. Responsive audit: no findings at 360–440 px, `responsive-known.json` not
needed. Console errors and CSP violations: none.

## Fixed

| Pass | What | Why | Node |
| ---- | ---- | --- | ---- |
| 1 | Card stroke: inset ring → `border: 1px solid #eaecf0` | half-grid Δ height −2 (110 vs 112). The card is 80 px = 14 + 18 + 4 + 28 + 14 + 2 and its text starts at x 17 = 1 + 16, so Figma includes this stroke in the auto layout; the design-to-code output also has `border` on the card itself. The SKILL's "inset ring, not border" rule was wrong for this frame. | 2:118, 2:121 |

## Kept on purpose

1. **Text sets wider than Figma: odd-line-height 8.41 % (section limit 10 % in the sections file), half-band 1.45 %,
   half-grid 1.09 %.** Tops of the ink lines are identical (rows 182–197 and 204–219 in both images). Horizontally,
   the headless Chromium rounds each glyph advance to a whole pixel (`i` at 15 px is 3.63 px in the font and 4 px in
   the DOM; every DOM text width is an integer). The drift adds up along a line: the second paragraph line has an ink
   width of 293 px against Figma's 287 px, and "Band of 48.5 px" 114 against 111. With `text-rendering:
   geometricPrecision` (or Chromium launched with `--font-render-hinting=none`) the widths match Figma (113.09 px
   against the 113 px Figma box) and the section drops to 2.86 % (mean 0.91 %). It is not in the stylesheet:
   phones do not hint advances like this, so this is a capture artefact and not something to build for.
2. **0.5 px hairline (2:104): 2.33 %.** Figma paints the rule at y 121.5–122 as a 50 % row at y 121 (`#CBD0D9`).
   Chromium snaps the 0.5 px box to a full row at y 122 in `#98A2B3` (at emulated DPR 2 and 3 it is still one full
   CSS pixel). No plain CSS gives a half-covered row at y 121: `border-top: 0.5px` becomes 1 px and grows the section,
   and `transform: scaleY(.5)` paints a 50 % row at y 122. `height: 0.5px` stays, as in the design.
3. **Half-pixel edges of the swatch and the cards.** The swatch at x 20.5, 100.5 × 40.5, and the 161.5 px cards have
   half-covered edge columns and rows in Figma. Chromium snaps each edge (20.5 → 21, 99.5 → 100, 181.5 → 182, 193.5 →
   194), so card 1 paints 162 px and card 2 161 px. pixelmatch counts none of it (half-box 0.00 %). The spacing audit
   shows it as ±1 px (half-box left 20 / 21, card gap 11 → 12), below its flag.
4. **Semi Bold amounts 3 px narrower** ($4,280.50: 99 vs 102 px). This is the known Figma-vs-Google Inter difference.
   About 2.4 px of it goes away without hinting (101.6 px).

## Open

1. None for the layout. The text drift in item 1 above is a capture issue, and the tool should fix it (launch flag
   or capture CSS), not this page.

## Questions for design

1. The frame is built to test fractional values (48.5 band, 20.5 / 100.5 / 40.5 swatch, 0.5 px rule, 21.5 px line
   height, 161.5 px cards). In a product, these would round to the nearest whole-pixel or 4 px token.
