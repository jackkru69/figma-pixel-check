---
name: figma-pixel-check
description: Build a web screen from a Figma frame, or check one built by anyone, and prove it matches section by section (geometry, pixels, colours, Figma's own style values, spacing, hover/focus/open states), then check it at other phone sizes. Use when implementing or fixing a screen from a Figma URL or node id (like 123:4567), when asked for a pixel-perfect layout or whether a page "matches the design", to add a screen or state to the check, to check narrow and wide phones, or to set the check up in a web project (React, Vue, Svelte, plain HTML, Capacitor, PWA).
---

# Figma frame → layout → per-section pixel check

The layout is never judged by eye. Each screen has a reference PNG exported from Figma at 1x and a list of
its horizontal sections. The built page is captured in Chromium at the frame size, and **each section is
compared from its own top**, so one section that is 8 px too tall does not turn everything below it red:
its position and height, its pixels and its flat colours. Figma's own values (fonts, colours, radii, strokes,
shadows, gap, padding), exported once per screen, are compared with the computed styles, which catches what
pixels cannot tell apart. A spacing audit measures margins, paddings and gaps of every section in both
images, and a responsive audit opens every screen at other phone sizes, where the design has no reference,
to catch what breaks there. The checks are deterministic and independent of whoever wrote the page: this
skill, another agent or a person.

Rules that hold throughout:

- **Nothing is invented.** A screen, state, asset, text or value that is missing from the design (or from
  the API) is not made up: ask, or leave a clearly marked stub and list it under "Open" in `PIXEL-SPEC.md`.
- **The reference PNG outranks the generated code.** Figma's code output can contain layers that are not
  visible in the render; when they disagree, the pixels win.
- **Figma MCP calls are rate-limited** (a small monthly allowance on Starter plans and View/Collab seats,
  daily and per-minute limits on Dev/Full seats). Cache everything fetched in the repo and never re-fetch it.

Method details, file formats, settings and the causes of typical mismatches: [references/method.md](references/method.md).

## One-time setup

Skip this if the project already has `figma-pixel.config.json`.

1. Copy the scripts into the project, where CI can run them without Claude and Node resolves their
   dependencies from the project's `node_modules`:
   `mkdir -p scripts/figma-pixel && cp ${CLAUDE_SKILL_DIR}/scripts/* scripts/figma-pixel/`
2. Install the dev dependencies with the project's package manager: `pixelmatch@7`, `pngjs@7`, `@playwright/test`,
   then `npx playwright install chromium` (skip when a Chromium for that Playwright version is present).
   Keep pixelmatch on 7: the next major changes the colour metric, and every number in the method reference
   was calibrated on 7.
3. Add scripts to `package.json`: `"pixel:diff": "node scripts/figma-pixel/pixel-diff.mjs"` and
   `"spacing": "node scripts/figma-pixel/spacing-audit.mjs"`,
   `"responsive": "node scripts/figma-pixel/responsive-audit.mjs"`.
4. Create `figma-pixel.config.json` from [assets/figma-pixel.config.example.json](assets/figma-pixel.config.example.json):
   the build command, the build output dir and the preview route (or `baseUrl` of a running server).
5. **Preview routes.** The app must render any single screen at the configured `url` (default
   `/preview/{id}`) with the content of the Figma frame (texts, numbers, images from the design, no network)
   and nothing around it. Keep preview routes out of production builds (a build mode or env flag).
6. Create `design/figma/PIXEL-SPEC.md` from [assets/PIXEL-SPEC.template.md](assets/PIXEL-SPEC.template.md),
   add `design/figma/diff/` to `.gitignore`, and commit reference PNGs: CI has no access to Figma.

## Per screen

1. **Access.** Call the Figma MCP `whoami` (it costs nothing) and look at the plan and seat. On a
   low-allowance seat, tell the user how many calls the screen needs before spending them.
2. **Frame context.** Save `get_metadata` of the page or section once to `design/figma/figma-metadata.xml`
   and reuse it; boxes of any frame: `python3 scripts/figma-pixel/figma-boxes.py <node-id>`. Before
   `get_design_context`, load the Figma design-to-code guidance (the Figma plugin's skill, or the MCP
   resource `skill://figma/figma-design-to-code/SKILL.md`). Call it once per screen, never per section,
   and save the returned code to `design/figma/figma-code/<id>.*` as the reference for style values.
3. **Figma's values.** Run [scripts/figma-styles.js](scripts/figma-styles.js) with `use_figma` (read-only; load
   the Figma skill it needs first, set `FRAME` to the frame's node id) and save the JSON it returns as
   `design/figma/styles/<id>.json`. One call per screen (a big frame comes in parts: while the result has a
   `next`, run it again with `FROM` set to it and append the nodes); the style check compares these values
   with the page. For many screens or very large frames, when the user has a Figma personal access token set
   as `FIGMA_TOKEN`, [scripts/figma-rest-export.mjs](scripts/figma-rest-export.mjs) writes the same files through
   the REST API (`--png` the references, `--sections` a sections skeleton to adjust); never print the token.
4. **Reference PNG.** `get_screenshot(fileKey, nodeId, maxDimension ≥ the frame's longer side)` and download
   it at once, because the link expires:
   `curl -L -o design/figma/reference/<id>-<width>.png "<url>"`.
   The PNG must be exactly the frame size (`original_width` × `original_height`); otherwise re-export it.
   The screenshot inside `get_design_context` is capped at 1024 px and cannot serve as a reference for taller frames.
5. **Sections file** `design/figma/sections/<id>.json`: `{node, reference, width, height, sections}`, each
   section `{name, top, height}` relative to the frame, top to bottom. Start from
   `python3 scripts/figma-pixel/figma-boxes.py <node-id> --sections`, then split and rename to bands you can
   mark in the markup: nav, header, card, form, list, footer, typically 3–8 per screen, whole lists as one band.
6. **Layout.** Use the project's components and tokens (map Figma variables to existing tokens, do not
   hard-code near-duplicates). Take every typographic value from the saved code, never `line-height: normal`
   for Figma's AUTO. Strokes, blurs, shadows and fonts translate as in
   [the Figma-to-CSS table](references/method.md#from-figma-to-css): an INSIDE stroke in auto layout also
   moves the content in by its width, `get_design_context` writes `border` for every alignment, and a blur
   value in Figma is twice the CSS one. A status bar drawn in the frame is a safe-area inset in the app;
   emulate it during capture with `captureCss`. Put `data-section="<name>"` on the element of each band;
   names match the sections file, and the element must span the band (a margin outside it moves its box).
   Keep the `data-node-id` attributes of Figma's code on cards, buttons, chips, icons and the frames whose
   padding and gap matter: that is how the style check finds them. Texts are found by their text as a
   fallback; give a text its `data-node-id` too when the same text repeats in a section, when the build's
   text differs from the design's (translated, formatted), or when it is split across elements. The
   attributes only need to exist in the preview build: strip them from production if the project prefers.
7. **Check.** `npm run pixel:diff -- <id>` (add `--skip-build` when the build is fresh), then
   `npm run spacing`. Read `design/figma/diff/report.md` (or open `report.html` next to it: the crops side by
   side with a slider) and fix in this order:
   1. sections missing in the DOM, then any section with a non-zero **Δ top** or **Δ height** (the section
      itself is off; sections that are only pushed by one above show Δ top 0);
   2. flagged values in `SPACING-AUDIT.md` (margins, paddings, gaps);
   3. a marked **Colour**: the pair says which colour the build has instead of Figma's (`#F2F4F7 → #F9FAFB`);
   4. **Styles**: every value listed under "Values that differ from Figma" (a weight, a radius, a gap, a
      text colour) and every Figma text not found;
   5. the worst percentages: the **hotspots** under the table give the boxes where the section's mismatch is
      (outlined in `-hotspots.png`); open them next to `-expected.png` and `-actual.png`. A section whose
      mismatch is spread over every line of text (rasterisation, or a change to all of it) has no hotspot.

   Repeat until tops and heights match, colours are 0.00 %, the styles are all ✓ and the numbers stop falling. After a correct
   layout a screen usually lands at 0.2–2 %, and text-heavy sections at up to ~4 %, from font rasterisation
   (see [references/method.md](references/method.md#reading-the-numbers)). Do not distort the layout to chase
   that last part, and do not pick a font weight or size by the percentage: a wrong one can score lower.
8. **States.** When the design draws a hover, focus, pressed, checked, open or disabled state, add it to the
   screen's sections file as a `state` with its own reference PNG (its Figma frame or variant) and the
   actions that reach it (`hover`, `click`, `focus`, `check`, `press`, `fill`, `wait`…), or its own `url` for
   a state no action can reach (see [States](references/method.md#states)). Each state is compared like a
   screen and named `<id>--<state>`. Never invent a state the design does not draw.
9. **Other sizes.** `npm run responsive -- <id> --skip-build` opens the screen at every size in `devices`
   (360 to 440 px wide by default). Look at the strip `design/figma/diff/responsive/<id>.png` and fix each
   finding in `report.md`: a page that scrolls sideways, an element cut by the screen edge or clipped by an
   ancestor, wider than its box, text that does not fit, or content covered by a pinned bar or floating
   button at the end of scrolling. What the design itself draws that way
   and cannot be seen goes into `design/figma/responsive-known.json` via `--update-known`, which pins each
   finding to the devices and the size seen now; add its `reason` there and in `PIXEL-SPEC.md`. Never
   accept a finding that is visible. Keep 375 px (the design width) unchanged: re-run pixel-diff after these fixes.
10. **Optional independent review.** When the user asks for it, or before calling a big screen done, run
   `node scripts/figma-pixel/review-context.mjs` and give a fresh agent (one that did not build the screen)
   `design/figma/diff/review-context.json`, the reference and the crops, asking it to look only for problems
   the checks did not report. Treat what it finds as leads to verify in the images, never as a verdict: pass
   and fail stay with the measured checks.
11. **Record.** Update `PIXEL-SPEC.md`: the summary row with both numbers, then **Fixed**, **Kept on purpose**
   (with the reason) and **Open** (with what is needed and from whom). Mark the screen as done in the
   project's screen index if it has one.
12. **Done** when the project's own checks and build pass, pixel-diff and the responsive audit report no console
   errors, CSP violations or new findings, and every remaining mismatch is explained in `PIXEL-SPEC.md`. In
   CI, `pixel-diff.mjs --max-section=<percent> --max-geometry=1 --max-color=0.5 --max-style=0` and
   `responsive-audit.mjs --fail` fail the job on a regression; a difference kept on purpose gets its own
   `maxGeometry` / `maxMismatch` / `maxColor` / `maxStyle` and `reason` on its section in the sections file.
   `drift.mjs --against <snapshot>` (optional) says what got better or worse since the previous run; it never
   fails a job, Figma stays the reference.

## Upstream bugs and false positives

Rare, and only when the evidence says the checker itself is wrong: a correct page reported as different, a
real difference missed, a crash on valid input, a general HTML/CSS/SVG pattern or a Figma value handled
wrongly. Never because a result is inconvenient, and never as a hunt during normal work. Details:
[references/upstream.md](references/upstream.md).

If the checker itself appears wrong:

1. Verify the build actually matches Figma (reference, render, crops, Figma's values, matched element); if it
   does not, fix the build and stop here.
2. Classify the issue (false positive, false negative, crash, unsupported general pattern, docs, test, unclear).
3. Check the latest upstream version and issues; do not duplicate a known one.
4. Reduce it to a synthetic, non-private reproduction.
5. Add a regression test, in a clone of the upstream repository, before the fix.
6. Implement only a general fix: no condition on a project's classes, texts, screens or node ids.
7. Run the relevant tests and benchmarks and report before and after.
8. Offer an upstream issue or pull request.
9. Publish nothing without explicit user approval.

Never publish a user's reproduction, source code, Figma data, screenshots, or open an upstream issue/PR
without explicit user approval.
