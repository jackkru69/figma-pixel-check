# PIXEL-SPEC: layout versus Figma

Pass 1, 2026-09-26. Chromium 141.0.7390.37 (Playwright 1.56.1), DPR 1, pixelmatch threshold 0.25. Per-section details:
`diff/report.md` after `pixel-diff.mjs`; spacing: [`SPACING-AUDIT.md`](SPACING-AUDIT.md).

## Summary

**Sections** is the metric (every section compared from its own top). **Whole page** is a diagnostic only.

| Screen | Node | Width | Sections | Whole page | Comment |
| ------ | ---- | ----- | -------- | ---------- | ------- |
| radii  | 2:124 | 375  | 0.90 %   | 0.74 %     | radius-scale 0.10 %, sheet-top 3.50 % (title rasterisation), smoothing 0.00 %, clip 0.00 % |

Geometry: DOM tops and heights of all four sections match Figma (Δ top 0, Δ height 0; `--max-geometry=0` passes).
Spacing audit: nothing ≥ 4 px. Responsive audit: no findings at 360–440 px, so `responsive-known.json` is not
needed. Console errors and CSP violations: none.

Caveat on the numbers: on this screen a 0.00 % does not prove a match. At threshold 0.25 the pastel and
neighbouring-token fills (#FEF0C7 mask, #F4EBFF pill, #D6BBFB swatches, #D0D5DD handle) are below the colour
threshold, and corner radius / corner smoothing differences stay inside anti-aliased pixels. They were
checked with raw pixel statistics (see Kept on purpose 3) and against the Figma values, not by the report.

## Fixed

| Pass | What | Why | Node |
| ---- | ---- | --- | ---- |
| 1 | Second tile clipped to the figma-squircle path (w 96, h 96, r 24, smoothing 0.6) instead of `border-radius: 24px` | the node has `cornerSmoothing: 0.6` (read with `use_figma`); the Figma code shows both tiles as `rounded-[24px]`. Raw difference against the reference in the tile: 154 → 125 pixels off by > 8 levels, summed |Δ| 4839 → 2635. pixel-diff shows 0.00 % both times | 2:138 |

## Kept on purpose

1. **Sheet title narrower.** "Bottom sheet with top radius 24", Inter Semi Bold 17/22: ink 257 px wide in Chromium,
   262 px in Figma (x 59–315 vs 56–317), centred, so glyphs drift by up to 3 px. This is the whole 3.50 % of
   sheet-top. Font build difference (Figma's Inter vs the Google variable build), not layout. Bold would score
   2.39 %, but it is the wrong weight (13 % more ink); kept at 600.
2. **Pill 1 px wider.** "Pill" at Inter Medium 14 sets 21 px wide in Chromium against Figma's 20 px text box, so the
   pill is 45 px instead of 44 px (spacing audit: right margin 38 vs 39). Same cause; 0.10 % on radius-scale.
3. **Corner smoothing is approximated, and the pixel check cannot confirm it.** CSS `border-radius` has no smoothing.
   `corner-shape: superellipse()` (Chromium 139+ only) is a different curve: the closest tried value
   (`superellipse(1.8)` at 38.4 px) differs more from the reference (summed |Δ| 10112) than plain radius (4839).
   The figma-squircle `clip-path: path()` gets to 2635, close to the Figma-vs-Chromium anti-aliasing floor of a
   plain circle corner (2368). The path is fixed to the 96 px tile; a resizable squircle would need an SVG mask.
4. **Mask built in CSS, not from the exported SVG.** `get_design_context` returned the clipping frame as one flattened
   SVG (`site/assets/mask.svg`). The page builds it as what it is: a 20 px rounded frame with `overflow: hidden`,
   fill #FEF0C7, and three decorative shapes positioned inside it (disc 180 px at −40/20, bar 200×40 at −10 from the
   top and 85 px past the right edge, 48 px gradient dot at 150/60 with a 2 px white outside stroke as an outer
   `box-shadow` ring). The frame is fluid (fills the 20 px gutters) instead of the fixed 335 px, so it does not
   overflow at 360 px; the bar is anchored to the right edge. The group is `aria-hidden="true"`: pure decoration.
5. **Grab handle at x 169.5.** Figma centres the 36 px handle on a half pixel and anti-aliases both edges; Chromium
   paints it at 170–205. Invisible at threshold 0.25 (the handle colour itself is under it).

## Open

1. **Tool blind spots on this screen** (reported to the tool, not a layout problem): fills and radii listed in the
   caveat above are not verified by pixel-diff; the spacing audit cannot measure the sheet's content, because the
   grey scrim spans the band and counts as content (left/right/top always 0). Needs a stricter flat-colour check and
   a per-section background in the tool.

## Questions for design

1. The smoothing is set on a single tile (2:138, `cornerSmoothing` 0.6) and on nothing else in the frame. If the product
   uses iOS-style squircles, is that the intent for every card/sheet radius, and should web ship the approximation
   (fixed-size `clip-path`) or plain radii?
