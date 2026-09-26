# PIXEL-SPEC: layout versus Figma

Pass 1, 2026-09-26. Chromium 141.0.7390.37 (Playwright 1.56.1), DPR 1, pixelmatch 7.2.0 threshold 0.25.
Per-section details: `diff/report.md` after `pixel-diff.mjs`; spacing: [`SPACING-AUDIT.md`](SPACING-AUDIT.md).

## Summary

**Sections** is the metric (every section compared from its own top). **Whole page** is a diagnostic only.

| Screen      | Node  | Width | Sections | Whole page | Comment                                                        |
| ----------- | ----- | ----- | -------- | ---------- | -------------------------------------------------------------- |
| transparent | 2:144 | 375   | 0.91 %   | 0.86 %     | overlay 0.46 %, opacity 0.58 %, text-alpha 1.71 %; text only |

Geometry: DOM tops and heights of all three sections match Figma exactly (Δ top 0, Δ height 0 everywhere).
Console errors and CSP violations: none. Responsive audit (six phones, 360–440 px): no findings, so there is
no `responsive-known.json`.

Implementation: `site/index.html` + `site/styles.css`, static, Inter from `/fonts/inter.css`. Bands:
`overlay` (padding 20, a 160 px photo: CSS gradient #1570EF → #53B1FD, radius 16, clipped; the black 40 %
shade covers its lower 80 px; the caption, Semi Bold 17/22 white, sits 16 px from the left and 14 px
from the bottom), `opacity` (flex row, gap 12, padding 20; chips padding 8/14, radius 16, #12B76A,
Semi Bold 14/20, layer `opacity` 1 / 0.6 / 0.3), `text-alpha` (flex column, gap 4, padding 20, Medium
16/24 in rgba(0,0,0,.87 / .6 / .38)). `get_design_context` returned no assets (the "photo" is a gradient
fill), so `site/assets/` stays empty.

## Fixed

| Pass | What | Why | Node |
| ---- | ---- | --- | ---- |
| 1 | Removed `-webkit-font-smoothing: antialiased` from `body` | it only works on macOS; it did nothing here and suggested the grey text AA was being controlled | 2:144 |

The first build already had every section at Δ top 0 / Δ height 0; no layout change was needed.

## Kept on purpose

1. **No page background: the build is white where the reference is #E5E5E5.** The frame `t-transparent`
   has no fill, so the screen draws none and shows the app's page background (white here). The grey is the
   Figma canvas composited by `get_screenshot`, not part of the design. Consequence: every semi-transparent
   element is composited onto white in the build and onto grey in the reference (chip 60 %: build
   (113,212,166) vs Figma (103,202,156); chip 30 %: (184,233,210) vs (166,216,193); 38 % text core ~158 vs
   ~142). Pixelmatch at 0.25 does not count any of these (a grey step of up to ~66 levels is below its
   threshold), so the numbers are the same as with `body { background: #E5E5E5 }` injected (text-alpha
   1.66 % vs 1.71 %, the other sections ±0.01 pp). `captureCss` is therefore left empty.
2. **The frame's corner radius 24 is not implemented.** It clips nothing visible (all content is inset by
   20 px) and a full screen in the app has no rounded corners of its own; the device does that.
3. **Chips 1–2 px wider, spacing flag `opacity` Right 138 / 133 (−5).** Chromium sets the Semi Bold
   labels at 42 / 36 / 36 px against Figma's 41 / 34 / 34 (caption 169 vs 167), so the chips are 70 / 64 /
   64 against 69 / 62 / 62 and the row ends 5 px further right. Gaps are 12, 12 in both images. Setting the
   chips to Bold (700) makes both tools happier (opacity 0.58 % → 0.24 %, the flag disappears) because
   Chromium's whole-pixel advances at DPR 1 happen to set 700 at 41 / 35 / 35; it is the wrong weight, so
   it is not done. No fixed widths on the chips either: they hug their labels as in Figma.
4. **Text rasterisation.** The capture uses LCD (RGB subpixel) antialiasing from this host's fontconfig
   (`/etc/fonts/conf.d/10-sub-pixel-rgb.conf`): 1785 colour-fringed pixels in the text-alpha lines against
   0 in Figma. With grey AA (`--disable-lcd-text` or `rgba=none`) the sections would read 0.30 / 0.48 /
   1.54 %. Nothing in CSS changes it on Linux; recorded, not chased.

## Open

1. **The app's real page background.** The frame has no fill, so the screen inherits whatever the app
   shell paints. White is assumed; if the app uses a tinted background (e.g. a grey surface token), the
   50–60 % and 30–40 % alpha elements will look different from both this build and the reference. Needed
   from design: the intended surface under this screen.

## Questions for design

1. `t-transparent` (2:144) has corner radius 24 and clip content but no fill: is it a device mock-up
   radius (then ignore) or a sheet/card that should draw its own surface with that radius?
2. The chips' faded states are done with layer opacity (2:152 at 0.6, 2:154 at 0.3), so their white labels
   fade too. If these are disabled states, a fill token with the label kept at full contrast would be more
   legible; confirm opacity is intended.
