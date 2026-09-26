# Corpus

Real Figma frames with builds of them, kept as regression fixtures for the tool and as benchmarks of what its
checks detect and what they wrongly flag. Two groups, measured apart and never added up:

- `torture/`: frames drawn to be hard for the check, implemented through the skill's own loop. Built together
  with the checks, so its detection rate is an upper bound.
- `external/`: designs and builds the checker was not developed against, the measure of how it generalises.
  Rules for adding a case: [external/README.md](external/README.md).

Design and reasoning of the torture corpus:
[docs/superpowers/specs/2026-09-26-real-figma-corpus-design.md](../docs/superpowers/specs/2026-09-26-real-figma-corpus-design.md).

```bash
npm test          # every screen still reports what its expected.json says (part of CI)
npm run bench     # mutations.json (detection) and equivalents.json (false positives) → BENCHMARK.md
npm run corpus    # rewrite every expected.json after a reviewed change of the tool
```

## Screens

Each `<group>/<screen>/` is a tool project of its own (`figma-pixel.config.json`), so screens run in
parallel without sharing a `diff/` folder. The server root is this folder: every page loads
`/fonts/inter.css`.

| Path | What it is |
| --- | --- |
| `design/sections/<id>.json`, `design/reference/<id>-375.png` | sections file and the 1x `get_screenshot` reference |
| `design/figma-code/<id>.tsx` | the saved `get_design_context` output |
| `design/PIXEL-SPEC.md` | numbers, what was fixed, what is kept on purpose and why |
| `design/responsive-known.json` | responsive findings the design itself draws, with reasons |
| `site/` | the static implementation |
| `mutations.json` | realistic mistakes for the benchmark: `[{kind, section, css, html?, note}]`; `html` is `[[find, replace]]` on the page |
| `equivalents.json` | correct implementations written differently, which must pass: `[{kind, css?, html?, note}]` |
| `case.json` | external cases only: source, licence, date, stack, patterns, and the findings on the untouched build that are real (`knownReal`) |
| `expected.json` | what the tool reports about the screen (`npm run corpus` writes it); an external case also keeps its exit codes, failures included, as its baseline |

## Sources and licences

- `torture/`: frames made for this corpus in the Figma file "figma-pixel-check · torture corpus", one hard
  feature each. Same licence as the repository (MIT). `torture/figma-metadata.xml` is the saved
  `get_metadata` of the whole page.
- `fonts/`: Inter, the Google Fonts variable build, SIL Open Font License 1.1 (`fonts/OFL.txt`).

## Adding a screen

1. Duplicate the frame's file into a team whose Figma MCP limits allow it, then save `get_metadata`,
   the 1x `get_screenshot` and `get_design_context` into a new `<group>/<screen>/` as above.
2. Implement `site/` following the skill until Δ top and Δ height are 0 or explained in `PIXEL-SPEC.md`.
3. Write `mutations.json` and `equivalents.json`, run `npm run corpus -- corpus/<group>/<screen>` and
   `npm run bench`, and review both diffs. An equivalent is valid only when the capture stays the same
   (at most 0.05 % of its pixels differ); one that changes the rendering is reported as "not equivalent",
   the entry's fault, and needs fixing, not the tool.
4. For `external/`, follow its rules: the case and its baseline come before any checker change.
