# Changelog

## 0.5.0 — 2026-09-26

- Style check: positions of nodes outside the flow, stroke alignment, SVG icon shapes and colours,
  pseudo-elements (`data-node-id-before` / `-after`), hidden nodes.
- The corpus benchmark detects all 168 mutations.
- README, skill and plugin descriptions cover every check; the README shows how to run the scripts
  without an agent.

## 0.4.0 — 2026-09-26

- Style check: Figma's own values (`figma-styles.js` through `use_figma`) compared with the computed
  styles: fonts, text colour and case, fills and gradients, radii and corner smoothing, strokes, shadows and
  blurs, opacity chains, fixed sizes, gap and padding. `--max-style` and per-section `maxStyle`.
- Regions: sections with `left` and `width`, checked for Δ left and Δ width.

## 0.3.0 — 2026-09-26

- `--max-geometry`: fails a section whose own Δ top or Δ height exceeds the limit (a section pushed by the
  one above shows 0); per-section `maxGeometry` / `maxMismatch` / `reason`.
- Accepted responsive findings are pinned to their devices and size.
- Corpus of 12 frames drawn in Figma to be hard for the check, run in CI, and a mutation benchmark.
- Colour check of flat areas (CIELAB ΔE > 3) naming the colour pair; `--max-color` and `maxColor`.
- Text rendered as in Figma on Linux (`chromiumArgs`); responsive checks for sideways scroll, clipped text,
  text taller than its box and floating buttons.

## 0.2.0 — 2026-09-25

- Responsive audit at six phone sizes: a screenshot strip, elements cut by the screen edge, wider than their
  box, overflowing text, content under a bottom-pinned bar; `--fail` and `--update-known`.

## 0.1.0 — 2026-09-25

- Per-section pixel diff from each section's own top, spacing audit, `figma-boxes.py`, the example.
