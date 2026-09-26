# PIXEL-SPEC: layout versus Figma

Pass 2, 2026-09-26. Chromium (Playwright 1.56.1), DPR 1, pixelmatch threshold 0.25. Per-section details:
`diff/report.md` after `pixel-diff.mjs`; spacing: [`SPACING-AUDIT.md`](SPACING-AUDIT.md).

## Summary

**Sections** is the metric (every section compared from its own top). **Whole page** is a diagnostic only.

| Screen | Node | Width | Sections | Whole page | Comment |
| ------ | ---- | ----- | -------- | ---------- | ------- |
| icons  | 3:70 | 375   | 0.00 %   | 0.00 %     | 6 bands, all Δ top / Δ height 0; stroke-16 0.01 % (1 px) |

Geometry: DOM tops and heights of all six sections match Figma exactly (`--max-geometry=0` and
`--max-section=0.1` pass). Spacing audit: 0 flags. Responsive audit: no findings at 360–440 px, so
`responsive-known.json` is not needed. Console errors and CSP violations: none.

**Read the 0.00 % with care.** On this screen the pixel metric cannot see most icon mistakes (details under
Open): a correct build and a build with the wrong button colours, icon opacity or stroke weight all score
0.00–0.08 %. The colours, stroke weights and radii below were checked by hand against the Figma code and
the exported SVG bytes, not by the diff.

## Fixed

| Pass | What | Why | Node |
| ---- | ---- | --- | ---- |
| 1 | Built from `figma-code/icons.tsx`: 6 flex rows, `padding: 16px 20px`, gap 24 (20 in the 32 px row, 16 for buttons), icons as `<img>` of the exported SVGs | first pass, 0.00 % with all geometry at 0 | 3:70 |
| 2 | Dropped the `overflow-clip` that Figma's code puts on every row and button | clipping hides a row that does not fit a narrow phone from the responsive audit (a cut icon was reported as "no findings"); no pixel change at 375 | 3:71–3:130 |

## Kept on purpose

1. **Icons are `<img>` of the exact SVG bytes from `get_design_context`** (`site/assets/`, 30 files, one per
   size: the 16/20 px glyphs have 1.5 px strokes, the 24/32 px ones 2 px, the button glyphs 1.67 px). Scaling one
   file to every size changes the stroke weight (24 → 32 px gives 2.67 px), so each size uses its own file.
   The colours (#344054, #7F56D9, white, #FDB022, #F04438, #12B76A) live in the files, not in CSS tokens.
2. **Outline button stroke as `box-shadow: inset 0 0 0 1px #D0D5DD`.** Figma's stroke is inside; the ring
   matches Figma's anti-aliasing within 12/255 per channel. The dark 40 px circle's edge differs by up to
   45/255 on 73 pixels (Chromium and Figma anti-alias a circle differently; the covered area is the same,
   679.5 vs 681.2 px²), which pixelmatch classes as anti-aliasing and does not count. Under `box-sizing: border-box` with a fixed
   40 px box a `border` renders identically, so this is for consistency with the method, not a pixel fix.
3. **stroke-16 at 0.01 %:** one pixel at the end of the 16 px search handle (Figma and Chromium rasterise the
   1.5 px round cap differently). Ink per icon differs by at most 4 % between Figma and Chromium across
   all 24 stroke icons.

## Open

1. **The check does not cover colour, opacity, stroke weight or shadows on this screen.** Measured by injecting
   each mistake through `captureCss` (see [`../mutations.json`](../mutations.json)):
   solid button #101828 → #344054: 0.00 %; soft button #F4EBFF → #E9D7FE: 0.00 %; 16 px icons at opacity 0.7:
   0.00 %; shadow-md on the solid button: 0.00 %; every 32 px icon from the 24 px file (stroke 2.67 px instead
   of 2): 0.08 %; radius 20 → 12 on all buttons: 0.45 %; a missing 20 px check icon: 0.06 % (the spacing audit
   reports it as "Right +43"). Needed from the tool: a colour check that is not bound to pixelmatch's 0.25
   threshold, anti-aliased pixels counted in bands without text, and a mismatch number that is not diluted by the
   empty 375 px width. Until then these values are reviewed by hand.
2. **Accessible names.** The design has no names for the filled icons (layers are all called "Frame",
   3:124/3:126/3:128) or for the three icon buttons (3:131/3:134/3:137). The build uses stub names
   (`Favourite`, `Liked`, `Online`; `Send`, `Search`, `Confirm`) taken from the glyphs. Needed from design:
   the real labels.

## Questions for design

1. What do the filled star / heart / dot (3:124, 3:126, 3:128) and the three icon buttons (3:131, 3:134,
   3:137) mean? Their accessible names are guessed from the glyph.
2. Every row frame has "Clip content" on (`overflow-clip` in the code). Is clipping intended anywhere, for
   example a row of icons that scrolls sideways on narrow phones? The build lets rows overflow visibly
   instead.
