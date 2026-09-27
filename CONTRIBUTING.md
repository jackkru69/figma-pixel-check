# Contributing

Real-world false positives and missed differences are the most valuable contributions: each one becomes a
regression test and a general rule. A project's own screens, code and Figma files never do.

## Before reporting

Check that the checker is wrong, not the page: compare the section's `-expected.png` and `-actual.png`, the
node's values in `styles/<id>.json` with the element's computed styles, and the [limits](skills/figma-pixel-check/references/method.md#limits).
Look for an existing issue, and try the latest scripts.

## A good report or fix

- **A synthetic reproduction**: a tiny page, a few lines of CSS, a small made-up styles and sections file.
  No project code, no Figma screenshots, file keys, node ids or layer names, no product or company names,
  no URLs, keys or credentials. If it cannot be reproduced without them, describe it without them or not at all.
- **A regression test first**: a feature test on the `examples/basic` fixture (`test/features.test.mjs`), a
  gate test, or an entry in a corpus screen's `equivalents.json` (a correct variant that must pass) or
  `mutations.json` (a mistake that must be found). It fails before the fix and passes after it.
- **A general fix**: a rule that holds for any project. No condition on a class name, text, screen or node
  id; no tolerance widened to hide a problem; no check switched off for a broad class of elements.
- **Numbers before and after**: `npm test` and `npm run bench` (internal mutations, false-positive
  benchmark; the external corpus too if you keep one locally, see [corpus/external/README.md](corpus/external/README.md)).
  Worse numbers are reported, not hidden.

Open an issue when the cause is not proven, the fix is debatable or large, or it changes what a check means;
a pull request when the cause is clear, the fix small and general, and the regression test is in place. The
templates list what each one needs.

An agent using the skill follows the same rules ([references/upstream.md](skills/figma-pixel-check/references/upstream.md))
and publishes nothing without the user's explicit approval.
