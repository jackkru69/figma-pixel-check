# PIXEL-SPEC: layout versus Figma

Pass 1, 2026-09-26. Chromium 141 (Playwright 1.56.1), DPR 1, pixelmatch 7.2.0 threshold 0.25. Per-section details:
`diff/report.md` after `pixel-diff.mjs`; spacing: [`SPACING-AUDIT.md`](SPACING-AUDIT.md).

## Summary

**Sections** is the metric (every section compared from its own top). **Whole page** is a diagnostic only.

| Screen  | Node | Width | Sections | Whole page | Comment |
| ------- | ---- | ----- | -------- | ---------- | ------- |
| effects | 2:55 | 375   | 0.52 %   | 0.42 %     | 6 sections (5 bands + nested `glass-card`), all Δ top / Δ height 0; the percentage cannot judge this screen's effects, see Open 1 |

Geometry: DOM tops and heights of all sections match Figma to the pixel (`--max-geometry=0` passes). Console
errors and CSP violations: none. Responsive audit (360–440 px): no findings; `responsive-known.json` is empty.

Per-section mismatch: shadow-sm 0.45 %, shadow-lg 0.70 %, inner 0.56 %, blur 0.00 %, glass 0.39 %,
glass-card 1.01 % (the same text pixels as `glass`, over a 72-row crop).

## Fixed

| Pass | What | Why | Node |
| ---- | ---- | --- | ---- |
| 1 | Layer blur `blur(8px)` / `blur(16px)` → `blur(4px)` / `blur(8px)` | Figma's layer blur value is 2σ: the flattened `row` SVG from `get_design_context` has `feGaussianBlur stdDeviation="4"` / `"8"`, and CSS `blur()` takes σ. Mean summed RGB difference of the band 11.36 → 1.91; pixel-diff showed 0.00 % both times, so this was found by reading the SVG, not by the check | 2:68, 2:69 |
| 1 | `.screen` fixed 375 px → fluid (`max-width: 440px`) | responsive audit: `off-screen: main` by 15 px at 360 px | 2:55 |
| 1 | Nested section `glass-card` (530/72) added | the stage has a fixed 140 px height, so a wrong glass-card height never reaches a band's Δ height; the nested section puts it under the geometry check | 2:73 |

## Kept on purpose

1. **Text rasterisation, 0.4–0.7 % per text band.** Inter Medium / Semi Bold 15 px: the ink positions agree to
   ±1 px along the line (per-40-px chunk best shift −1…+1), line widths 176/234/147/191 px versus Figma's
   177/235/146/192 px boxes. Headless Chromium on Linux places glyphs on whole pixels (every character's
   x is an integer, at DPR 1 and 2), Figma does not.
2. **Circle edges.** Figma fills the extreme rows/columns of the 64 px ellipse fully, Chromium's
   `border-radius: 50%` antialiases them: 22 pixels of the blur band differ by more than 60 (summed RGB),
   not counted by pixelmatch.
3. **Drop, inner and background-blur effects** match numerically (verified by hand, not by the check): shadow
   profiles across the card edges within ±6 summed RGB, glass section outside the text max 64 / mean 1.1.

## Open

1. **The pixel check cannot verify this screen's effects.** With pixelmatch at threshold 0.25, removing both
   drop shadows, the inner shadow and the backdrop blur, doubling the layer blur, dropping the white row fill,
   swapping the gradient, blob and text colours to neighbouring tokens and changing the radii all at once
   gives Sections (mean) 0.47 % against 0.42 % for this build (image: `evidence/all-effects-wrong-vs-reference.png`).
   What guards this screen today is geometry (Δ top / Δ height) and hand measurement; needed from the tool:
   a colour-sensitive measure for non-text pixels (see the torture-run notes).
2. **Glass label weight.** Semi Bold 600 (as designed) scores 0.39 %, Medium 500 scores 0.09 %:
   `evidence/glass-weight-600-vs-500.png`. The weight stays at 600 from the design; do not "fix" it by the number.

## Questions for design

1. The blob (2:72) is placed at y −30 in the stage and relies on the stage clipping it; at wider phones it keeps
   its left offset of 200 px (Figma's default Left constraint) and drifts toward the middle of the stage. Is that
   intended, or should it hug the right edge?
