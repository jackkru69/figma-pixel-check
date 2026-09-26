# PIXEL-SPEC: layout versus Figma

Pass 1, 2026-09-26. Chromium 141.0.7390.37 (Playwright 1.56.1, headless, Linux), DPR 1, pixelmatch threshold 0.25.
Per-section details: `diff/report.md` after `pixel-diff.mjs`; spacing: [`SPACING-AUDIT.md`](SPACING-AUDIT.md);
other sizes: `diff/responsive/report.md`.

## Summary

**Sections** is the metric (every section compared from its own top). **Whole page** is a diagnostic only.

| Screen | Node | Width | Sections | Whole page | Comment |
| ------ | ---- | ----- | -------- | ---------- | ------- |
| wrap   | 2:43 | 375   | 3.08 %   | 3.39 %     | tight-title 2.79, button-label 0.43, paragraph 5.97, columns 3.12 |

Geometry: all four sections have Δ top 0 and Δ height 0 (`--max-geometry=1 --max-section=8` pass). Spacing audit:
one flag, `columns` gap 28 → 15, which is the break point of the long word, not the gap (see Kept on purpose 2).
Responsive audit (six devices, 360–440 px): no findings, so there is no `responsive-known.json`. Console errors and
CSP violations: none.

## Fixed

| Pass | What | Why | Node |
| ---- | ---- | --- | ---- |
| 1 | `tight-title` Δ height +20: the subtitle wrapped ("minutes" on a second line) | The first build copied Figma's `w-[229px]`, `w-[305px]`, `w-[218px]`. These text boxes are exactly as wide as their text in Figma. Chromium sets the subtitle at 307 px (hinted whole-pixel advances; 305.19 px unhinted), so it wrapped in a 305 px box. The title (227 px in 229) and the button label (217 px in 218) just fitted. All three now hug their text (no width), which is what a box equal to its text means. | 2:45, 2:46, 2:49 |

## Kept on purpose

1. **Button 249 px wide instead of 250.** Its label hugs its text: Chromium sets "Continue with bank account" (Inter
   Semi Bold 16) at 217 px, Figma's box is 218 px. This is the known Semi Bold width difference between Figma's Inter
   and the Google build. A fixed 218 px label would be exact here, but it wraps as soon as a browser sets the text
   wider, and the UA `text-align: center` of `<button>` then put it half a pixel off (1.48 % vs 0.43 %).
2. **"Internationalizatio|n settings" instead of Figma's "Internationalizat|ion settings"** (columns, 3.12 %). Both
   columns are 120 px with `overflow-wrap: anywhere` (Figma's `word-break: break-word`). CSS breaks an overlong word
   at the last letter that fits: "Internationalizatio" is 119.8 px. Figma broke two letters earlier, at 107.8 px, and
   its "Internationalizat" ink is 107 px wide, so this is not a font-metric difference. Only a hand-placed `<wbr>`
   reproduces Figma's break (checked: the gap flag then goes away and columns drops to 2.30 %). That would hard-code
   a Figma layout accident into the content, so it is not done. The spacing audit reports this as "gap 28 → 15"; the
   CSS gap is 16 px in both.
3. **Text drift inside lines** (paragraph 5.97 %, tight-title 2.79 %). The line breaks of all four paragraph lines
   match Figma. Words drift 1–2 px along the lines because the capture Chromium rounds every glyph advance to a whole
   pixel: lines come out at 310/320/327/312 px against 308.9/318.0/328.8/312.3 unhinted. With
   `text-rendering: geometricPrecision` the paragraph drops to 5.07 % but the title and columns get worse (3.32 %,
   3.86 %), so nothing is changed.

## Open

1. None for this screen. For the tool, see the notes in the run log: colour-token changes are invisible at threshold
   0.25; vertical clipping is not checked by the responsive audit; the spacing audit's gap/right margin are ink
   extents and report wrap differences as spacing.

## Questions for design

1. Text boxes 2:45, 2:46 and 2:49 are fixed-width at exactly their text width (229, 305, 218). Should they hug
   (single line, grow with the text) or wrap at that width? The build assumes hug.
2. Columns 2:53 and 2:54: is breaking "Internationalization" mid-word intended, or should the column grow or the word
   hyphenate? The build breaks it where CSS does (one line later than Figma).
