# External unseen corpus

The torture corpus next to this folder was built together with the checks, so its 168 of 168 is an upper bound:
it says that no known blind spot is left, not how the tool does on a project nobody tuned it for. This folder
measures that: designs and builds the checker was not developed against. Its numbers are reported on their
own in [../BENCHMARK.md](../BENCHMARK.md) and are never added to the internal ones.

Cases come from real projects' screens or CC BY community kits, with builds made independently of this
repository's checks. The ones measured so far are private designs, kept on the machine that has them (rule 6):
only their counts are in the committed report.

## Rules

1. **A case is added before any checker change made for it.** Its first run is recorded as its baseline
   (`npm run corpus -- corpus/external/<case>`), failures included: `expected.json` records what the tool
   reported, and the exit codes (`exits`); a drift snapshot (`drift.mjs --save baseline-<version>.json`) and a
   copy of the bench report keep it readable. Only then may the checker change, and the change is measured
   against that baseline before the baseline is renewed (in separate commits when the case is committed).
2. **The checker never learns a case.** No selector, class name, text or value of a case appears in the tool's
   code; a fix must be a rule that holds for any project. If a fix only helps one case, it is not a fix.
3. **The build is not edited to please the checker.** A case's `site/` is a correct implementation as its
   author made it (or as close as they could): fixing the tool is the point, not the site. A real mistake in
   the build stays and is listed as a real gap (below).
4. **Findings on the unmodified build are labelled after looking at the images.** `case.json` lists real
   fidelity gaps under `knownReal` and false positives under `knownFalse` (`"<section>: <check>"`, as the
   benchmark prints them), with a line of evidence each under `notes`. What nobody has looked at yet is
   reported as not reviewed, never silently as either.
5. **Variety over volume.** Prefer a case that adds a pattern the corpus lacks: React, Vue, Svelte and plain
   HTML builds; CSS modules, Tailwind, CSS-in-JS and plain CSS; desktop and mobile frames; grids, nested Auto
   Layout, cards, tables, overlays and dialogs, sticky and fixed bars, complex typography, SVG icons,
   gradients and effects.
6. **Licences stay with the case.** Record the source and its licence in `case.json`; material without an open
   licence stays out of git (keep it in a local, ignored folder and report only its numbers).

## Mutations

`node test/mutate.mjs corpus/external/<case>` writes `mutations.json` from the build alone: for every section,
its largest text element, largest painted box and largest laid-out container each get one typical mistake
(font weight, text colour, font size, letter spacing, radius, padding, fill, gap, a missing item, an inset),
the kind rotating by section. A kind that changes too few pixels of the page to count (a gap in a row spaced
between with room to spare) gives way to the next. The choice depends on the DOM and the rendered page, not on
what the checker reports, and the file is written once, before the first bench run.

## Local reports

`npm run bench` writes the external group's details (screens, sections, selectors, texts) to
`corpus/external/BENCHMARK.md`, which is not committed; the committed `corpus/BENCHMARK.md` keeps its counts
only. After labelling findings in `case.json`, `node test/bench.mjs --report` writes both reports again from
`corpus/bench-results.json` without running anything. `npm run external` compares every case with its
recorded baseline (it runs every case, so it takes a while).

## A case

Same layout as a torture screen (a tool project of its own), plus `case.json`:

```
corpus/external/<case>/
  case.json                 source, licence, date, stack, patterns, known real gaps
  figma-pixel.config.json   dist ../.. or the case's own build; url of its page
  design/sections/<id>.json, design/reference/<id>-<width>.png, design/styles/<id>.json
  site/                     the build as its author made it (or a static export of it)
  expected.json             the baseline, written by npm run corpus
  mutations.json            optional: realistic mistakes, written before the first bench run
  equivalents.json          optional: correct variants that must pass
```

```json
{
  "source": "https://www.figma.com/community/file/… (duplicated into a draft)",
  "licence": "CC BY 4.0",
  "added": "2026-10-01",
  "toolVersion": "0.6.0",
  "stack": "react + tailwind",
  "viewport": "desktop 1440",
  "patterns": ["grid", "sticky header", "table", "svg icons"],
  "knownReal": ["pricing: colour"],
  "knownFalse": ["search: styles"],
  "notes": { "pricing: colour": "the build uses brand-600 for brand-500", "search: styles": "..." }
}
```

## What the report counts

- **Detection** on `mutations.json`: detected, weak, misattributed, missed, and detections that also raised
  signals in other sections.
- **False positives** on `equivalents.json`: correct variants whose capture stayed the same but raised a
  signal.
- **Marked on the unmodified build**: every check the untouched build does not pass, minus the labelled real
  gaps: the false positives a user of the tool would meet on that project.
