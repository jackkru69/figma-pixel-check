---
name: figma-pixel-check
description: Build a web screen from a Figma frame and prove it matches, section by section, with a pixel diff and a spacing audit against reference PNGs exported from Figma. Use when implementing or fixing a screen or state from a Figma URL or node id (like 123:4567), when asked for a pixel-perfect layout or to check that a page "matches the design", to compare a built page with Figma, to add a screen to the pixel check, or to set the check up in a web project (React, Vue, Svelte, plain HTML; mobile web, Capacitor, PWA).
---

# Figma frame → layout → per-section pixel check

The layout is never judged by eye. Each screen has a reference PNG exported from Figma at 1x and a list of
its horizontal sections. The built page is captured in Chromium at the frame size, and **each section is
compared from its own top**, so one section that is 8 px too tall does not turn everything below it red.
A spacing audit then measures margins, paddings and gaps of every section in both images.

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
2. Install the dev dependencies with the project's package manager: `pixelmatch`, `pngjs`, `@playwright/test`,
   then `npx playwright install chromium` (skip when a Chromium for that Playwright version is present).
3. Add scripts to `package.json`: `"pixel:diff": "node scripts/figma-pixel/pixel-diff.mjs"` and
   `"spacing": "node scripts/figma-pixel/spacing-audit.mjs"`.
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
3. **Reference PNG.** `get_screenshot(fileKey, nodeId, maxDimension ≥ the frame's longer side)` and download
   it at once, because the link expires:
   `curl -L -o design/figma/reference/<id>-<width>.png "<url>"`.
   The PNG must be exactly the frame size (`original_width` × `original_height`); otherwise re-export it.
   The screenshot inside `get_design_context` is capped at 1024 px and cannot serve as a reference for taller frames.
4. **Sections file** `design/figma/sections/<id>.json`: `{node, reference, width, height, sections}`, each
   section `{name, top, height}` relative to the frame, top to bottom. Start from
   `python3 scripts/figma-pixel/figma-boxes.py <node-id> --sections`, then split and rename to bands you can
   mark in the markup: nav, header, card, form, list, footer, typically 3–8 per screen, whole lists as one band.
5. **Layout.** Use the project's components and tokens (map Figma variables to existing tokens, do not
   hard-code near-duplicates). Figma strokes on frames and shapes are usually inside: use an inset
   `box-shadow`/ring, not `border`, which adds to the size. A status bar drawn in the frame is a safe-area
   inset in the app; emulate it during capture with `captureCss`. Put `data-section="<name>"` on the element
   of each band; names match the sections file.
6. **Check.** `npm run pixel:diff -- <id>` (add `--skip-build` when the build is fresh), then
   `npm run spacing`. Read `design/figma/diff/report.md` and fix in this order:
   1. sections missing in the DOM, then any section whose DOM top or height differs from Figma;
   2. flagged values in `SPACING-AUDIT.md` (margins, paddings, gaps);
   3. the worst percentages: open that section's `-diff.png` next to `-expected.png` and `-actual.png`.

   Repeat until tops and heights match and the numbers stop falling. After a correct layout a screen
   usually lands at 1–4 %, and text-heavy sections at up to ~7 %, from font rasterisation (see
   [references/method.md](references/method.md#reading-the-numbers)). Do not distort the layout to chase that last part.
7. **Record.** Update `PIXEL-SPEC.md`: the summary row with both numbers, then **Fixed**, **Kept on purpose**
   (with the reason) and **Open** (with what is needed and from whom). Mark the screen as done in the
   project's screen index if it has one.
8. **Done** when the project's own checks and build pass, pixel-diff reports no console errors or CSP
   violations, and every remaining mismatch is explained in `PIXEL-SPEC.md`. In CI,
   `pixel-diff.mjs --max-section=<percent>` fails the job when a section regresses past the limit.
