# PIXEL-SPEC: layout versus Figma

Pass 1, 2026-09-26. Chromium (Playwright 1.56.1, headless, Linux), DPR 1, pixelmatch 7.2.0 threshold 0.25.
Per-section details: `diff/report.md` after `pixel-diff.mjs`; spacing: [`SPACING-AUDIT.md`](SPACING-AUDIT.md);
other sizes: `diff/responsive/report.md`.

## Summary

**Sections** is the metric (every section compared from its own top). **Whole page** is a diagnostic only.

| Screen | Node  | Width | Sections | Whole page | Comment                                                                                   |
| ------ | ----- | ----- | -------- | ---------- | ----------------------------------------------------------------------------------------- |
| list   | 2:160 | 375   | 0.91 %   | 1.00 %     | header 0.30, rows 1.09, chips 1.05, full-divider 1.21; font rasterisation only, see below |

Geometry: DOM tops and heights of all four sections match Figma exactly (Δ top 0, Δ height 0 everywhere).
Spacing audit: 0 values off by ≥ 4 px. Responsive audit (360–440 px, six devices): no findings, nothing
accepted, so there is no `responsive-known.json`. Console errors and CSP violations: none.
`pixel-diff.mjs --max-section=2 --max-geometry=1` and `responsive-audit.mjs --fail` pass.

| Section      | Figma top/h | Implementation                                                                                          |
| ------------ | ----------- | ------------------------------------------------------------------------------------------------------- |
| header       | 0/48        | `h2`, padding 24/20/8, 12/16 semibold, `letter-spacing: 0.04em`, `text-transform: uppercase`, #667085   |
| rows         | 48/227      | `ul` of 4 × 56 px flex rows (gap 12, padding 0 16 0 20); dividers are `li + li::before` 1 px, margin-left 56 |
| chips        | 275/64      | `nav` scroller: flex, gap 8, padding 14 20, `overflow-x: auto`, `scrollbar-width: none`; track scrolls to 555 px as in Figma |
| full-divider | 339/57      | `footer` with `border-top: 1px` (an in-flow 1 px line in Figma, not a stroke), padding 16 20 20, 14/20 #667085 |

## Fixed

| Pass | What | Why | Node |
| ---- | ---- | --- | ---- |
| 1    | nothing to fix: the first capture matched every top and height | the layout follows the auto-layout values of `figma-code/list.tsx` | 2:160 |

## Kept on purpose

1. **Text rasterisation, 0.3–1.2 % per section.** Headless Chromium on this Linux host rounds every glyph
   advance to a whole CSS pixel (hinting "slight"), so lines differ from Figma's fractional widths by up to
   ±2 px: "Privacy and security" 154 px vs 156.08 px of font advances, "Payment methods" 137 vs 138.35,
   "All" 18 vs 16.98. It also draws LCD sub-pixel (coloured) antialiasing, which Figma never does. Nothing
   in CSS is wrong; `text-rendering: geometricPrecision` restores fractional advances but raises the mean
   to 1.29 % (chips 2.08 %, note 2.40 %), so it is not used.
2. **The "All" chip is 46 px wide instead of 45, "Transfers" 91 instead of 92.** Hug-width chips follow the
   text width above (18 vs 17 px, 63 vs 64 px). The two errors cancel: "Card payments" starts at x 173 as in
   Figma, and the chip gaps measure 8, 8, 8 in both images.

## Open

1. **Link targets.** Rows and chips are anchors (`#notifications`, `#all`, …): the frame has no
   destinations. Needed from product: the routes, and whether a chip is a filter (button) or a link.
2. **States.** Only the static frame is compared: pressed rows, the active-chip change and the scrolled
   track have no reference. Needed from design: frames for these states if they must be checked.

## Questions for design

1. The chip track `2:198` is 555 px wide inside a 375 px frame with clipping on, and the generated code
   says `overflow-clip`. It was built as a horizontal scroller (the brief says so); please confirm that the
   track scrolls and that the 20 px end padding should stay visible after the last chip.
2. "ACCOUNT" `2:162` is typed in capitals in Figma. It is built as "Account" with `text-transform:
   uppercase`; tell us if the content should really be upper case (screen readers read it differently).
