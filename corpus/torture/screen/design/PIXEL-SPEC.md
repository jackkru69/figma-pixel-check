# PIXEL-SPEC: layout versus Figma

Pass 2, 2026-09-26. Chromium (Playwright 1.56.1), DPR 1, pixelmatch threshold 0.25. Per-section details:
`diff/report.md` after `pixel-diff.mjs`; spacing: [`SPACING-AUDIT.md`](SPACING-AUDIT.md).

## Summary

**Sections** is the metric (every section compared from its own top). **Whole page** is a diagnostic only.

| Screen | Node | Width | Sections | Whole page | Comment |
| ------ | ---- | ----- | -------- | ---------- | ------- |
| screen (t-screen) | 3:2 | 375 | 0.86 % | 1.02 % | nav 1.53, balance 1.70, recent 1.07, fab 0.00, tabbar 0.02; all text rasterisation |

Geometry: every section matches Figma to the pixel (Δ top 0, Δ height 0 for nav, balance, recent, fab, tabbar;
`--max-geometry=0` passes). Spacing audit: 0 values off by ≥ 4 px. Responsive audit: no findings on the six
default devices (360×640 to 440×956), nothing accepted in `responsive-known.json`. Console errors and CSP
violations: none.

Build: `site/index.html` + `site/styles.css`, static, no JS. Sticky top bar (safe-area inset + 44 px nav),
scrolling content, tab bar `position: fixed` at the bottom, floating button `position: fixed` 16 px above
the tab bar. Content ends with `padding-bottom: tab bar + 88 px`, so the last row scrolls clear of both.

## Fixed

| Pass | What | Why | Node |
| ---- | ---- | --- | ---- |
| 1 → 2 | Removed the `status` band from the sections file | The iOS status bar is drawn by the OS; the app only reserves it (`--safe-top: 44px` in `captureCss`). The band counted as "missing in DOM" = 100 % and put the mean at 29.49 % | 3:3 |
| 1 → 2 | Removed the `home-indicator` band; the indicator is emulated in `captureCss` (`html::after`, 134×5, 8 px from the bottom) | Drawn by the OS over the tab bar. Without it the tab bar band read 2.13 % and the spacing audit showed its bottom padding as 8 → 37 px | 3:66 |

## Kept on purpose

1. **Status bar not built (3:3).** It is the device's safe-area inset: `padding-top: var(--safe-top)` on the
   sticky top bar, `--safe-top: 44px` during capture. The band 0–44 is not compared.
2. **Bottom inset 25 px.** `--safe-bottom: 25px` during capture reproduces the frame: hairline 1 + padding 8 +
   tab items 49 + 25 = 83 px. A real iPhone reports 34 px there (see Questions).
3. **Tab bar hairline is a real `border-top`, not an inset shadow.** In Figma the stroke is included in the
   layout: the tab items sit at y = 9 (padding 8 + stroke 1) and the frame is 83 px. An inset shadow puts the
   tabs 1 px higher and the bar 1 px shorter (measured: Δ top +1, Δ height −1, tab bar 0.02 → 1.75 %).
4. **Text rasterisation, 1.07–1.70 % in the text sections.** Figma draws greyscale antialiased text; headless
   Chromium on Linux draws LCD subpixel text (62–70 % of the build's ink pixels have a channel spread > 30,
   none in the reference). With `--disable-lcd-text` the same build measures nav 1.27, balance 1.63,
   recent 0.73 %. The rest is glyph advance: the small `•••• 4821` drifts ~1 px right across the line.
5. **"Recent" heading 1.03 px higher** (ink centroid 13.83 vs 14.87 px in its 28 px line box): Blink's rounding
   of the half-leading of 18/28. Every other text line is within 0.07 px of Figma.
6. **Semi Bold widths.** `$12,480.20` sets 188 px wide against Figma's 190 px with the design's −0.72 px
   tracking; "Wallet" is 2 px narrower. Different Inter builds, not a layout error.
7. **Avatars as CSS circles** (`#F4EBFF`, 40 px) instead of the exported ellipse SVG: identical pixels
   (244,235,255 in both), and they are placeholders for category icons.

## Open

1. **Accessible names** "Back", "More" and "New transaction" are placeholders: the frame has no labels for the
   three icon buttons. Needed from design/copy.
2. **Tab and button targets** link to `#`: the routes of Cards, Stats, Profile, the back action and the FAB
   action are not in the design.
3. **Background blur of the tab bar** (`backdrop-filter: blur(10px)`, from the Figma code) cannot be checked:
   nothing is under the bar in the frame. Figma's blur radius may map to a different CSS radius.

## Questions for design

1. The tab bar leaves 25 px under the 49 px tab items (3:49); the iPhone home-indicator inset is 34 px, so on a
   device the bar will be 92 px tall. Is 83 px meant to include the inset?
2. The floating button (3:67, top 657) overlaps the last row (3:43, bottom 668) at rest. The build lets the list
   scroll clear of it at the end; confirm that the overlap at rest is intended.
