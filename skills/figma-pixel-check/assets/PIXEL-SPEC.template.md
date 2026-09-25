# PIXEL-SPEC: layout versus Figma

Pass 1, <date>. Chromium (Playwright <version>), DPR 1, pixelmatch threshold 0.25. Per-section details:
`diff/report.md` after `npm run pixel:diff`; spacing: [`SPACING-AUDIT.md`](SPACING-AUDIT.md).

## Summary

**Sections** is the metric (every section compared from its own top). **Whole page** is a diagnostic only.

| Screen | Node | Width | Sections | Whole page | Comment |
| ------ | ---- | ----- | -------- | ---------- | ------- |
|        |      |       |          |            |         |

Geometry: <do DOM tops and heights of all sections match Figma? list the exceptions>. Console errors and
CSP violations: none.

## Fixed

| Pass | What | Why | Node |
| ---- | ---- | --- | ---- |
|      |      |     |      |

## Kept on purpose

1. **<difference>.** <measurement and the reason it stays, e.g. platform text rendering>.

## Open

1. **<difference>.** <what is needed to close it, and from whom>.

## Questions for design

1. <inconsistency in the frames, with node ids>
