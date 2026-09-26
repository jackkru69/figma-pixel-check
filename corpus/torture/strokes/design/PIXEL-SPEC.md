# PIXEL-SPEC: layout versus Figma

Pass 2, 2026-09-26. Chromium (Playwright 1.56.1), DPR 1, pixelmatch 7.2.0 at threshold 0.25. Per-section details:
`diff/report.md` after `pixel-diff.mjs`; spacing: [`SPACING-AUDIT.md`](SPACING-AUDIT.md).

## Summary

**Sections** is the metric (every section compared from its own top). **Whole page** is a diagnostic only.

| Screen  | Node | Width | Sections | Whole page | Comment |
| ------- | ---- | ----- | -------- | ---------- | ------- |
| strokes | 2:2  | 375   | 0.52 %   | 0.52 %     | inside 0.18 %, center 0.33 %, outside 0.43 %, dashed 0.58 %, thick 1.07 % |

Geometry: all five bands have DOM top/height equal to Figma (Δ top 0, Δ height 0). Spacing audit: 0 flags.
`--max-section=2 --max-geometry=0` passes. Responsive audit: no findings at the six default sizes, so
`responsive-known.json` has no entries. Console errors and CSP violations: none.

How each Figma stroke is built (all on a 335×64 card, `box-sizing: border-box`):

| Band    | Figma stroke            | CSS                                                     | Stroke ink vs Figma |
| ------- | ----------------------- | ------------------------------------------------------- | ------------------- |
| inside  | inside 1 px #D0D5DD     | `box-shadow: inset 0 0 0 1px`, padding 20 + 1           | identical (max 23 ΣRGB) |
| center  | center 2 px #D0D5DD     | `outline: 2px solid; outline-offset: -1px`               | identical (max 19 ΣRGB) |
| outside | outside 2 px #D0D5DD    | `box-shadow: 0 0 0 2px`                                  | identical (max 27 ΣRGB) |
| dashed  | inside 1 px dashed 4/4  | `border: 1px dashed` (inside the box with border-box)    | rhythm differs, see Kept 1 |
| thick   | inside 2 px #7F56D9, r16 | `box-shadow: inset 0 0 0 2px`, padding 20 + 2           | 11 corner px ≤ 59 ΣRGB |

"ΣRGB" is the summed per-channel difference of a pixel, measured on the section crops outside the text box.

## Fixed

| Pass | What | Why | Node |
| ---- | ---- | --- | ---- |
| 2 | Labels of the inside-stroke cards were 1 px (inside) and 2 px (thick) left of Figma | Figma's auto layout adds an inside stroke to the padding (metadata: text x = 21 for 1 px, 22 for 2 px; 20 for center and outside strokes); an inset shadow does not move the content. Padding is now `calc(20px + var(--stroke-inside))`. inside 1.03 → 0.18 %, thick 1.14 → 1.07 % | 2:4/2:5, 2:16/2:17 |

## Kept on purpose

1. **Dash rhythm of the dashed card.** Figma draws 4 on / 4 off along the path, through the corners.
   Chromium's 1 px `dashed` border draws 3–4 px dashes with 1–2 px gaps, fitted per side, and CSS cannot set
   the dash length. 473 pixels of the ring differ (stroke colour against white). The ring stays inside the
   box, and the label is at x = 21 as in Figma. An SVG `stroke-dasharray="4 4"` background was measured: the
   rhythm is right, but Figma's phase at the corners is not (523 pixels differ). It would also copy the
   colour and radius into a data URI, so it was not adopted. The pixel diff counts none of these pixels,
   because #D0D5DD on white is under the threshold: judge the ring from the crops, not the percentage.
2. **Label widths.** Inter Medium 15 px sets 0–2 px wider in Chromium than in Figma. The label ends 2 px
   later in center, 1 px later in outside, dashed and thick, and at the same x in inside. The start x and
   the baseline match. This is the rest of the text mismatch in every band, and most of thick's 1.07 %.
3. **Thick card inner corners.** With inset 2 px at radius 16, 11 anti-aliased pixels on the inner curve
   differ by at most 59 ΣRGB.

## Open

1. **Exact 4/4 dashes.** If design needs the exact rhythm, the dashed card needs an SVG dash background
   (see Kept 1) instead of `border-style: dashed`. This is a decision for design or the front-end lead.
2. **Rounded outline support.** The center stroke uses `outline` with `border-radius`, which needs
   Chromium 94+ and Safari 16.4+. If older WebKit has to be supported, use
   `box-shadow: 0 0 0 1px, inset 0 0 0 1px`. It was measured at 5 corner pixels different, 0.33 % in both
   cases.

## Questions for design

None. The frame is consistent: every inside stroke moves the label in by its width, and center and
outside strokes do not.
