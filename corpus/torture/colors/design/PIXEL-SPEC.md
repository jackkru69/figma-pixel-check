# PIXEL-SPEC: layout versus Figma

Pass 2, 2026-09-26. Chromium (Playwright 1.56.1, Linux, headless), DPR 1, pixelmatch 7.2.0 threshold 0.25.
Per-section details: `diff/report.md` after `pixel-diff.mjs`; spacing: [`SPACING-AUDIT.md`](SPACING-AUDIT.md).

## Summary

**Sections** is the metric (every section compared from its own top). **Whole page** is a diagnostic only.

| Screen | Node | Width | Sections | Whole page | Comment |
| ------ | ---- | ----- | -------- | ---------- | ------- |
| colors | 2:75 | 375   | 0.44 %   | 0.53 %     | geometry exact; only text rasterisation left (text-colors 2.47 %, brand 0.20 %) |

| Section         | Figma top/h | Δ top | Δ height | Mismatch |
| --------------- | ----------- | ----- | -------- | -------- |
| grays           | 0/80        | 0     | 0        | 0.00 %   |
| near            | 80/96       | 0     | 0        | 0.00 %   |
| text-colors     | 176/124     | 0     | 0        | 2.47 %   |
| gradient-linear | 300/112     | 0     | 0        | 0.00 %   |
| gradient-radial | 412/112     | 0     | 0        | 0.00 %   |
| brand           | 524/80      | 0     | 0        | 0.20 %   |

Geometry: DOM tops and heights of all six sections match Figma to the pixel (`--max-geometry=0` passes).
Spacing audit: 0 values flagged. Responsive audit (360–440 px): no findings, `--fail` passes, no
`responsive-known.json` needed. Console errors and CSP violations: none.

**What these numbers do not prove.** At threshold 0.25 the pixel diff does not see colour: the button in
brand-500 instead of brand-600, the tertiary text one gray step darker, a 135° CSS gradient instead of
166.57°, 80 % opacity on the swatches and a swatch that paints nothing all score the same 0.00–0.2 % as the
correct build (see `evidence/undetected-colour-mutations.png`). The colours on this screen were checked
separately, by sampling the reference and the capture at the centre of every fill and the full-ink pixel
of every text line: all six swatches, both tiles, the button, the gradient ends and the four text colours
match the reference exactly (±1 level inside the gradients).

## Fixed

| Pass | What | Why | Node |
| ---- | ---- | --- | ---- |
| 2 | Gray swatches: fixed `gap: 9.4px` → `justify-content: space-between` on six 48 px swatches | the row was 335 px wide and stuck 15 px out of the 320 px content box at 360 px (responsive audit: "wider than its box: [grays] span — 15 px"); at 375 the positions are the same 20 / 77.4 / 134.8 … | 2:76 |
| 2 | Near tiles: fixed 160 px → `flex: 1 1 0` with the 15 px gap | same overflow at 360 px ("[near] span — 15 px"); 160 × 64 at 375 | 2:83 |

Pass 1 already landed at 0.44 % with every Δ top / Δ height at 0: the design is a plain stack of
16 px-padded bands, and the style values came from the saved `figma-code/colors.tsx`.

## Kept on purpose

1. **Text rasterisation in text-colors (2.47 %) and the button label (0.20 %).** Figma draws Inter lighter
   than Chromium on Linux. Linux Chromium at DPR 1 also rounds every glyph advance to a whole pixel (all
   four line widths come out as integers: 151 / 180 / 157 / 142 px), so the ink of "Secondary text #475467"
   is 2 px wider and "Brand text #6941C6" 2 px narrower than in Figma (spacing audit: right −2).
   `text-rendering: geometricPrecision` (fractional advances) brings text-colors to 1.89 % and the right
   edge to 0, but it only changes the Linux capture, not a phone, so it is not in the stylesheet.
2. **Radial gradient 1–5 levels lighter in its fading half.** CSS interpolates the semi-transparent stops
   premultiplied, Figma (like the SVG in its code export) does not. Mean summed RGB error on the
   335 × 80 card: 5.3 with `radial-gradient(closest-side, …)`, 1.5 with Figma's SVG data URL; both score
   0.00 %. The CSS gradient stays (token colours, no data URL); it moves the audit's soft-edge margins by
   +2 / +3 px (below the flag).
3. **Swatch edges at fractional x.** Figma anti-aliases the swatches at x = 77.4, 134.8, 192.2, 249.6
   (edge pixel e.g. (242, 243, 245)); Chromium snaps each box to whole pixels. 0.00 % mismatch; the audit
   shows gaps 9, 9, 8, 9 → 10, 9, 10, 9.
4. **The near-duplicate grays stay distinct.** #6B7280 / #9CA3AF (tiles) are not mapped to the gray-500 /
   gray-400 tokens #667085 / #98A2B3 of the swatches: the frame tests exactly that difference. They are
   their own tokens (`--cool-gray-500`, `--cool-gray-400`). Mapping them would score the same 0.00 %.

## Open

1. **No colour check.** The per-section pixel diff at 0.25 is blind to colour-token mistakes of ΔE76 up to
   ~19 on solid fills and text (list above), and the spacing audit treats #F9FAFB as background (grays
   "Left 77" instead of 20). Until the tool has a colour metric, colours on colour-heavy screens have to be
   checked by sampling fills, or with `threshold: 0.1` (text-colors then 4.38 %, the button in the wrong
   token 51.8 %, the missing swatch 7.3 %). Needed from: the figma-pixel-check tool.

## Questions for design

1. The gray row uses a 9.4 px gap (2:76): is it "spread six swatches over the row" (auto spacing, what the
   build does now) or a fixed 9.4 px gap? At 360 px a fixed gap does not fit.
2. #6B7280 / #9CA3AF (2:84, 2:85) sit ΔE76 3–4 from the gray-500 / gray-400 of the swatches: intended as a
   separate gray family, or should they be the same tokens?
