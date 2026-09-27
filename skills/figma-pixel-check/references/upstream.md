# When the checker itself is wrong

A rare side path of normal work, never a goal of it. It starts only when there are strong reasons to believe
the problem is in figma-pixel-check, not in the page, and it never publishes anything without the user's
explicit approval of that specific public action.

Real-world failures should make the checker better, but the user's project must never silently become public
material or an upstream fixture.

## 1. When it applies

- **false-positive**: a correct implementation is reported as different from Figma (the same result written
  another valid way: a grid for flex, a ring for a border, a colour in another notation).
- **false-negative**: a real difference from Figma is not reported.
- **crash**: a runtime or parser error on valid input.
- **unsupported-general-pattern**: valid, reasonably common HTML/CSS/SVG the checker cannot handle.
- **documentation-bug**: the method reference says something the tool does not do.
- **benchmark/test bug**: the corpus, a mutation or a test measures the wrong thing.
- **unclear**: something is off and the cause is not known yet.

It does not apply because a result is inconvenient, because a value is hard to reach in CSS, or because the
design itself is inconsistent. Do not mention upstream issues or PRs for ordinary warnings and mismatches, and
do not spend a normal task looking for problems in the tool.

## 2. Verify before blaming the checker

Look at the evidence, not the report alone:

- the reference PNG, the actual render and the crops (`-expected`, `-actual`, `-diff`) of the section;
- Figma's exported values in `styles/<id>.json` for the node, and what the page computes for its element;
- the section bands and the element marked `data-section`; the `data-node-id`s; the element the report
  matched (`matchedBy`);
- the state and its actions, the viewport, `figma-pixel.config.json`, `captureCss`;
- the accepted limits and documented constraints in [method.md](method.md#limits).

When the page really differs from Figma, fix the page and go on with the normal workflow: a user's mistake is
never an upstream issue. When the images and the values say the page matches and the tool is wrong (or the
page differs and the tool is silent), classify it (section 1). When the cause is unclear, collect a
reproduction first and do not present a code fix as established.

## 3. Check upstream

When network access allows it, look at `jackkru69/figma-pixel-check` before preparing anything:

- the latest version and `CHANGELOG.md` (the installed one: `.claude-plugin/plugin.json`, or the
  version of the copied scripts);
- open and closed issues and pull requests about the same behaviour (`gh issue list --repo
  jackkru69/figma-pixel-check --state all --search "<words>"`, or the repository's web pages);
- whether the problem still happens with the latest scripts.

If it is already fixed, tell the user and offer to update the scripts. If it is already reported, point the
user to it instead of preparing a duplicate. Reading upstream publishes nothing.

## 4. Reduce it to a synthetic reproduction

Keep only what proves the behaviour: a tiny HTML page, a few lines of CSS, a small synthetic
`styles/<id>.json` and sections file, a synthetic reference image when one is needed, one failing behaviour.
Rebuild the pattern with neutral names, texts, colours and sizes. Never copy a production screen, not even
trimmed.

## 5. Privacy and IP firewall

Before anything could leave the machine, check the reproduction, the test, the fix, the commit message and
the issue or PR text for:

- the user's source code, class names, routes, internal URLs, private repository URLs;
- Figma screenshots, file keys, node ids, layer names, metadata of a private file;
- product, client, company and user names, real customer data, business copy;
- assets, API keys, tokens, credentials.

If the problem cannot be reproduced without any of these, do not prepare a public issue or PR: describe it to
the user locally and stop. A user's public repository is not permission to publish its code or designs in
another repository.

## 6. General fixes only

A fix must hold for any project. Never:

```
if (className === 'user-card')
if (screen === 'settings')
if (text === 'My Company')
if (nodeId === '123:456')
```

or any condition drawn from one project. A fix looks like "colours in `color()` notation are normalised",
"a stroke drawn by an overlay layer of the element's box counts as its stroke", "equal texts pair by
position". Ask first: would this rule make sense on a project the checker has never seen? If not, it is not
an upstream fix (an unusual component abstraction whose intent cannot be inferred stays a documented limit).
Do not widen a tolerance to hide a problem or switch a check off for a broad class of elements.

## 7. Regression first

Work in a clone of the upstream repository (never in the user's project), and write the test before the fix:

| Kind | Test that shows it | After the fix |
| --- | --- | --- |
| false-positive | the correct implementation fails the check | it passes |
| false-negative | the intentional mistake is not reported | it is reported |
| crash | the minimal valid input crashes the check | the test passes |

Use the existing infrastructure instead of a new one: a feature test on the `examples/basic` fixture with
synthetic Figma values (`test/features.test.mjs`), a gate test (`test/gates.test.mjs`), an entry in a
corpus screen's `equivalents.json` (a correct variant) or `mutations.json` (a realistic mistake). The same
test is where the knowledge stays: an equivalent implementation, a mutation, a feature test, or a limit in
the method reference. A user's real case never goes into the public corpus; a synthetic equivalent does.

## 8. Run the checks

At least `npm test` (features, gates, the internal corpus against its baselines) and `npm run bench` (the
internal mutations and the false-positive benchmark); the external corpus too when it is on the machine.
Report before and after, worse numbers included:

```
New regression test:   false positive → pass
Internal mutations:    168/168 → 168/168
Equivalents:           26/27 → 27/28 pass
External (local):      706/742 → 708/742
```

Do not accept a fix that turns detected mutations into missed ones without an explanation, raises false
positives, or special-cases a fixture.

## 9. Issue or pull request

Prefer an **issue** when the root cause is not proven, the fix is debatable or large, it changes what a check
means, or it needs a maintainer's decision. Prefer a **pull request** when the cause is clear, the
reproduction minimal, the regression test in place, the fix small and general, and the tests and benchmarks
pass without unexplained changes. Both may be prepared locally; neither is published without approval.

## 10. Ask, then publish only what was approved

Ask in the user's language, for example:

> I found what appears to be a general figma-pixel-check bug. I reduced it to a synthetic reproduction,
> added a regression test and prepared a general fix. No private project or Figma data is included. Would
> you like me to open an upstream issue or pull request?

Show what would be published. "Fix it", "go ahead" or "make it work" are not approval to publish: only a
clear yes to the public action is. Without it, do not open an issue, comment upstream, create or push to a
fork, open a pull request, or upload a reproduction, screenshot or snippet.

After approval, an **issue** has: problem, minimal reproduction, expected behaviour, actual behaviour, why
it appears general, environment and checker version, relevant test or benchmark information. A **pull
request** has: problem, root cause, the regression test, the general fix, why it is not project-specific,
before and after, tests run, benchmark impact, known limitations; minimal and scoped, no unrelated refactor.
The repository's templates (`.github/ISSUE_TEMPLATE`, `.github/pull_request_template.md`) list the same.
