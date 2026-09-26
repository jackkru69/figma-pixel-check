# PIXEL-SPEC: layout versus Figma

Pass 1, 2026-09-26. Chromium 141.0.7390.37 (Playwright 1.56.1), DPR 1, pixelmatch threshold 0.25. Per-section details:
`diff/report.md` after `pixel-diff.mjs`; spacing: [`SPACING-AUDIT.md`](SPACING-AUDIT.md).

## Summary

**Sections** is the metric (every section compared from its own top). **Whole page** is a diagnostic only.

| Screen | Node | Width | Sections | Whole page | Comment |
| ------ | ---- | ----- | -------- | ---------- | ------- |
| dense  | 4:2  | 375   | 2.49 %   | 2.51 %     | title 3.47, table-head 1.22, table-body 2.40, total 2.86: text rasterisation only |

Geometry: DOM tops and heights of all four sections match Figma (Δ top 0, Δ height 0); passes
`--max-section=5 --max-geometry=1`. Spacing audit: 0 flagged values. Responsive audit: no findings on the six
default devices (360–440 px). Console errors and CSP violations: none.

The 1 px row dividers (13 rows at y = 105, 141, …, 537) and the header fill were checked by sampling, because
the pixel diff does not count colour differences this small: 0 of 4,875 divider pixels differ, header fill
#F9FAFB in both.

## Fixed

| Pass | What | Why | Node |
| ---- | ---- | --- | ---- |
| 1 | Sections file: the skeleton's `table` band (74/464) split into `table-head` (74/32) and `table-body` (106/432) | the header is a band of its own (`<thead>`), so its geometry is reported apart from the 12 rows | 4:6, 4:7 |
| 1 | Built as a semantic `<table>`, fixed date (20 + 64 px) and amount (96 + 20 px) columns, the description column takes the rest | Figma's fixed 175 px description column overflows the 320 px content box at 360 px | 4:7–4:58 |
| 1 | Row dividers as `border-bottom` inside a border-box row of 36 px (head 32 px), not an inset shadow | the stroke is included in the row's layout: the text sits at y = 8.5 in the 36 px row (35 px content + 1 px stroke) | 4:11 |

## Kept on purpose

1. **Text rasterisation, 1.2–3.5 % per section.** The capture runs on a Linux host whose fontconfig enables
   slight hinting and RGB subpixel antialiasing (`10-hinting-slight.conf`, `10-sub-pixel-rgb.conf`): the
   build's glyphs have colour fringes that Figma's greyscale render does not. The same build measures 1.98 %
   with `rgba=none` and 0.73 % with `--disable-lcd-text --font-render-hinting=none`, so the layout is not the cause.
2. **Regular text 2 % wider in the capture.** At DPR 1 with hinting on, Chromium on Linux rounds every glyph advance
   to a whole pixel: "24 operations · 2 pending" is 161 px (Figma text box 158, 157.67 with fractional advances),
   "Balance change" 117 px (Figma 114, 114.5). Phones use fractional advances, so no box was widened for it.
3. **Row and header text 0.5 px lower.** Text boxes sit at y = 8.5 (rows) and 7.5 (header) because the 1 px stroke
   takes layout space; Figma antialiases the half pixel, Chromium snaps the glyphs down (vertical ink centroid
   +0.51 px on every row). The spacing audit shows it as +1 top padding in `table-head` and `table-body`. It cannot
   be matched in CSS without a half-pixel hack.
4. **Title heading 2 px narrower** (188.9 px vs Figma 191): Semi Bold width of Figma's Inter against the Google build.

## Open

None.

## Questions for design

1. The subtitle says "24 operations · 2 pending" while the table lists 12 operations and marks none as pending (4:5).
