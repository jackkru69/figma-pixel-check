# Changelog

## 0.6.0 — 2026-09-27

- Hotspots: boxes where a section's mismatch is, in section and frame pixels, outlined on
  `-hotspots.png`; text rasterisation spread over every line makes none. Diagnostic only.
- States: a sections file may list `states` (hover, focus, checked, open, disabled...), each reached by
  actions (`hover`, `click`, `focus`, `check`, `fill`, `press`, `wait`...) or its own url, and compared as
  `<id>--<state>`. Files without states work as before.
- Text matching: `data-node-id` first for texts too; equal texts pair by position, not DOM order; text split
  into inline elements by the build or by Figma is found; visible elements win over hidden copies; never a
  partial match.
- Icons: SVG shapes computed by the browser (classes and `<style>`, groups, `currentColor`, viewBox scale),
  in a blank page for SVG files so the page's CSP cannot block them; inline `<svg>` and textless icon
  wrappers are checked too.
- Reports: `report.html` (static, crops side by side with a slider), a `verdict`, per-check statuses and
  `failures` in `results.json`, and a short CI log of the failing sections only.
- `drift.mjs`: this run against a saved snapshot of an earlier one; never fails a job.
- `review-context.mjs`: what the checks found, for an optional independent review.
- Benchmarks: a false-positive benchmark (`equivalents.json`, 1 of 27 flagged), and the external unseen
  corpus with its rules, reported apart from the internal one; its details stay in a local report.
- Found on the external corpus, fixed as general rules: colours in `oklab()` / `color-mix()` notation;
  texts in form fields (value, placeholder); Figma layers hidden under an opaque layer; Tailwind's
  placeholder shadows; 0 px border resets; one-sided strokes drawn as inset shadows; Figma lines drawn as
  thin boxes. Painted frames without `data-node-id` are now found by their box when that is unambiguous.
- The benchmark pairs repeated section names by occurrence (the second of two sections with one name was compared with the first).
- `test/mutate.mjs` writes an external case's mutations from its build alone.
- From the second external round (77 screens, all with Figma's values): painted frames found through their own
  texts, rendered text only, colour filters reported, Figma fill stacks resolved, repeated differences grouped in
  the report; `figma-styles.js` replaces U+2028 (it cut the MCP message), exports text alignment, decoration,
  truncation, masks and clipping, and leaves defaults out; the benchmark counts a changed value of a known
  difference and leaves out mutations that change fewer than 16 pixels.
- From the review of every finding on the untouched external builds: drop shadows written as
  `filter: drop-shadow()`, stroke overhang and one-child gaps allowed for, carets, half-pixel geometry,
  inline line heights, several Figma texts in one element, texts drawn inside a picture, and same-size
  wrappers looked through when measuring padding and gap. Then, from the findings those rules left: tints
  drawn as flat gradient layers, strokes drawn by an overlay layer of the same box, a lone caret matched to an
  empty field, stroke overhang of deeper nodes, hugging frames anchored by any edge, and parents found among
  the nodes the design shows (a hidden copy or a same-size wrapper made a frame look like it had two children).

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
