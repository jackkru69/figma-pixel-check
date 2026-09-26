# Real-Figma corpus: design

Goal: find the tool's weak spots on real Figma renders, fix them, and keep the screens as CI regression
fixtures and as a benchmark of what the checks detect. Scope agreed with the owner: the torture file only.

## Sources

- **Torture file** (ours, created through the Figma MCP in the owner's Petabox Pro drafts,
  `4bY3mT5LutycwuJdVGXGK5`): 12 frames, one hard feature each — strokes, type metrics, text wrap, effects,
  colours, fractional geometry, radii and masks, transparency, a settings list, a full 375×812 screen with
  pinned bars, icons, a dense table. Committed in full.
- Figma Community kits were considered (a vetted list of CC BY 4.0 files with OFL fonts exists: many popular
  "CC BY" files carry a stricter licence page inside) and left out for now: the torture file is enough.

## Layout

```
corpus/
  fonts/                   Inter (OFL), the Google Fonts variable build, opsz fixed at 14 (inter.css)
  torture/figma-metadata.xml
  torture/<id>/            one tool project per screen (isolated diff/ output, parallel-safe)
    figma-pixel.config.json   {dir: design, build: null, dist: ../.., url: /torture/{id}/site/index.html}
    design/sections/<id>.json, design/reference/<id>-375.png, design/figma-code/<id>.tsx
    design/PIXEL-SPEC.md, design/responsive-known.json (if any)
    site/index.html, site/styles.css, site/assets/*
    mutations.json         defects to inject for the benchmark
    expected.json          what the tool must report (written by test/corpus.mjs --update, reviewed)
```

The server root is `corpus/`, so every screen loads `/fonts/inter.css`.

## Per screen (one agent each, the skill's real loop)

`get_design_context` once (saved), implement static HTML/CSS, then pixel-diff → spacing → fix, until geometry
is 0 or explained, then the responsive audit, then `PIXEL-SPEC.md`. Every place where the tool misled, stayed
silent, was noisy, crashed or where the skill's instructions were missing is logged as a structured issue.
The agent does not edit the tool.

## Benchmark

`mutations.json`: `[{kind, section, css, note}]`, one per applicable kind from a fixed catalogue (height,
gap, margin, font size, line height, letter spacing, weight, text colour, fill colour, radius, border instead
of an inset ring, shadow, icon size, wrap, missing element, 2 px shift, opacity). `test/bench.mjs` injects
each one through `captureCss`, re-runs pixel-diff and the spacing audit, and compares with the unmutated run:
detected by geometry, by spacing flags, by the section's mismatch (strong ≥ 1 pp, weak ≥ 0.1 pp), attributed to
the right section or not. A mutation that does not change the capture is invalid. Output: `corpus/BENCHMARK.md`.

## Triage and fixes

Issues from all agents and benchmark misses are deduplicated, each is verified by an independent agent that
tries to refute it, and confirmed tool bugs are fixed with tests. Platform differences (fonts, engine
rounding) go to the method reference instead.

## CI

`test/corpus.test.mjs` runs every corpus project: pixel-diff geometry must equal `expected.json` exactly,
mismatch may not exceed it by more than 0.5 pp, spacing flags must match, and the responsive audit must pass
`--fail`. `npm run corpus -- --update` rewrites `expected.json` after a reviewed change.

## Results (first wave, 12 frames, 110 issues logged, 167 mutations)

Every frame converged to Δ top = Δ height = 0. Benchmark: 84 → 110 of 167 mistakes detected.

Fixed in the tool:

- **Colour blind spot** (logged by all 12 agents): pixelmatch at 0.25 counts 0 % for neighbouring tokens,
  light strokes, shadows and opacity. New colour check on flat pixels (CIELAB ΔE > 3), a Colour column with
  the reference → build pair, magenta in the diff, `--max-color` / `maxColor`. Fill colour 1 → 13 of 15,
  shadow 2 → 4 of 6, opacity 0 → 5 of 10; 0.00 % on correct sections.
- **Text rendered unlike Figma** (9 agents): headless Chromium on Linux hinted glyph advances to whole pixels
  and used the host's LCD antialiasing. `chromiumArgs` default `--font-render-hinting=none
  --disable-lcd-text`: the corpus mean mismatch fell from 1.32 % to 0.59 % with no geometry change, and the
  capture no longer depends on the machine's font settings.
- **Rows below the capture**: they were compared as a white page after `checkerboard: false`; now counted as
  mismatched, listed under the table, and left out of the colour check.
- **Responsive audit**: `page scrolls sideways`; `clipped` text and icons under `overflow: hidden | clip`
  ancestors (Figma's code clips every auto-layout frame); text taller than its box; content covered by any
  element pinned in the lower half (floating buttons).
- **Spacing audit**: `diff/spacing.json`; an unpaired gap of 12 px or more is flagged (item missing from a row).
- Stale crops of a screen are removed on every run.

Adversarial review of these fixes (two agents: code, and ~50 screens of common real-world patterns) found
that the first version of the new responsive checks flooded real pages: line-height 1 headings, `::after`
underlines, textareas, transform carousels, marquees, collapsed accordions, truncation wrappers, avatar
crops, `body { overflow-x: hidden }`, toasts and cookie cards. They were made conservative (see method.md) and
each of those patterns is now a regression test ("common real-world patterns are not findings"). The colour
check held up (font smoothing, subpixel shifts, equivalent gradients and shadows all 0.00 %) except for WebP
and JPEG at quality 75: raster images are now left out of it.

Documented (method.md "From Figma to CSS"): stroke alignments and the INSIDE stroke that moves auto-layout
content, blur = 2σ, `get_screenshot` on Figma canvas grey `#E5E5E5` for fill-less frames, Inter at opsz 14 and
the `font` shorthand that resets it, AUTO line height, mid-word breaks, corner smoothing, OS chrome bands,
text percentages that reward a wrong weight.

Left open (not seen by any check): the colour of small text (9 of 11 missed), radius changes of a few px
(6 of 12), font weight (5 of 12), 2 px shifts of small elements (weak signal only). All of these need Figma's
own values: comparing computed styles with the saved `get_design_context` code is the next step.

## Second release: the style check

The benchmark showed where pixels stop (font weight 3/12, radius 1/12, text colour 0/11). `figma-styles.js`
exports every node's values through `use_figma`; `style-check.mjs` finds the elements (texts by their text in
their section, other nodes by `data-node-id`) and compares fonts, colours, opacity, size, radii, strokes,
shadows, blurs, gradients, and Auto Layout gap and padding as laid out. Four agents tagged the 12 screens and
tried to break it; seven kinds of false positive (parent opacity, table cells, colgroup, borders drawn as a
child's divider, one-sided strokes, CENTER strokes, hugging sizes) were fixed. 334 nodes are compared with no
difference on the corpus, and detection went from 110 to 157 of 167: text colour 11/11, font weight 11/12,
radius 12/12, opacity 10/10. Two real structure differences were found and fixed in the corpus (a section
without its own padding, a table header fill on the cells). Sections also gained regions (`left`, `width`).

Third pass: positions of what Figma places by hand, hidden elements, stroke alignment, shadows the design
does not have, corner smoothing, icon strokes and fills inside `<img>` SVGs (read from the file), and
pseudo-elements (`data-node-id-before/after`). 371 nodes compared on the corpus with no difference; the
benchmark detects 168 of 168. That is an upper bound on a corpus built with the tool; the next level of
trust is designs and builds the tool has never seen.
