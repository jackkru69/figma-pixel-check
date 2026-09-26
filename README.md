# figma-pixel-check

[![example](https://github.com/jackkru69/figma-pixel-check/actions/workflows/example.yml/badge.svg)](https://github.com/jackkru69/figma-pixel-check/actions/workflows/example.yml)

A [Claude Code](https://claude.com/claude-code) skill for building web screens from Figma frames and
**proving** they match. It uses a per-section pixel diff, a colour check, a check of Figma's own values
against the computed styles and a spacing audit, and never judges by eye.

Most "pixel-perfect" checks compare whole screenshots. Then one block that is 8 px too tall turns
everything below it red, and the number no longer tells you what is wrong. Here each screen is split into
horizontal sections (`nav`, `hero`, `list`…), and **every section is compared from its own top**. The
report shows which section is off, whether its position, its height or its pixels differ, and by how much.

```
| # | Section  | Figma top/h | DOM top/h | Δ top | Δ height | Mismatch | Colour                     |
| 0 | nav      | 0/56        | 0/56      | 0     | 0        | 0.00%    | 0.00%                      |
| 1 | hero     | 56/180      | 56/172    | 0     | -8 ←     | 0.00%    | 0.00%                      |  ← 8 px shorter: the geometry says so, not the pixels
| 2 | stats    | 236/88      | 228/88    | 0     | 0        | 2.16%    | 1.06% ← #F4F5F9 → #FFFFFF |  ← a real difference inside the section
| 3 | settings | 324/168     | 316/168   | 0     | 0        | 0.00%    | 0.00%                      |  ← shifted by 8 px but identical, and reported as such
```

Geometry is blamed the same way: **Δ top** is a section's own displacement, so the sections that the
shorter hero pulls up show 0, and in CI `--max-geometry=1` fails on the hero alone. The pixel diff is tuned
to ignore text rasterisation, which also makes it blind to a neighbouring colour token or a lost opacity;
the **Colour** column compares the flat areas separately and names the colours that differ. And because
pixels cannot tell a font weight of 500 from 600 or a radius of 8 from 12, the **Styles** column compares
Figma's own values (exported once per screen through the Figma MCP) with the computed styles:

```
- hero: «Alex Kim» font-weight 600 → 500
- action: button 9:5 radius 14 → 8
- nav: nav 9:1 gap 12 → 16
```

The spacing audit then measures every section in both images:

```
| Section | Left          | Right         | Top padding | Bottom padding  | Height           | Gaps in a row |
| hero    | 137 / 137 (0) | 139 / 139 (0) | 16 / 16 (0) | 33 / 25 (-8) ←  | 180 / 172 (-8) ← | — → —         |
| stats   | 25 / 24 (-1)  | 24 / 23 (-1)  | 0 / 0 (0)   | 24 / 24 (0)     | 88 / 88 (0)      | 16, 16 → 8, 8 ← |
```

And because the design is drawn at one width, a responsive audit opens every screen at six phone sizes
(360 to 440 px). It puts the screenshots side by side and reports elements cut by the screen edge,
elements wider than their box, text that does not fit, and content hidden under a bottom-pinned bar.

It was extracted from a production mobile web app (React + Capacitor). There, every section of every
checked screen ended up matching Figma to the pixel in position and height, and the remaining differences
were explained one by one.

## What the skill does

1. Checks the Figma MCP seat and budget: calls are rate-limited, and everything fetched is cached in the repo.
2. Reads the frame (`get_metadata`, `get_design_context`) and saves a 1x reference PNG (`get_screenshot`).
3. Writes the sections file from the frame's boxes (`figma-boxes.py --sections` gives a skeleton).
4. Lays out the screen with the project's own components and tokens, and marks the sections with `data-section`.
5. Runs `pixel-diff` and `spacing-audit`, then fixes geometry first, spacing second, pixels last.
6. Runs `responsive-audit` to check the other phone sizes without breaking the design width.
7. Records the result in `PIXEL-SPEC.md` under **Fixed**, **Kept on purpose** and **Open**, without
   inventing anything that is not in the design.

The scripts are plain Node and Playwright, and they also run without Claude, for example in CI.

## Install

As a plugin:

```
/plugin marketplace add jackkru69/figma-pixel-check
/plugin install figma-pixel-check@figma-pixel-check
```

Or with the [skills](https://skills.sh) CLI (Claude Code, Cursor, Codex and other agents):

```bash
npx skills add jackkru69/figma-pixel-check
```

Or copy [`skills/figma-pixel-check`](skills/figma-pixel-check) into your project's `.claude/skills/`.

To fetch frames, connect the [Figma MCP server](https://developers.figma.com/docs/figma-mcp-server/). The
check itself only needs the reference PNGs once they are in the repo.

Then just ask, for example: *"Lay out this screen: https://figma.com/design/…?node-id=123-456"*, or
*"check the settings screen against Figma"*. On first use the skill copies its scripts into the project,
adds `figma-pixel.config.json` and walks through the preview route it needs.

## Try the example

```bash
npm ci
npx playwright install chromium
npm run example
npm test
```

[`examples/basic`](examples/basic) is a static page with a CSP, a reference PNG and a sections file. The
reference was rendered from a variant of the page with a taller header and wider gaps between the stat
cards, so the report shows each kind of finding: a height change, a shifted but identical section, and a
real pixel difference. `npm test` runs the CI limits against a copy of it.

## Scripts

| Script                           | What it does                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pixel-diff.mjs [ids] [--skip-build] [--max-section=N] [--max-geometry=PX] [--max-color=N] [--max-style=N]` | builds, serves, captures and compares geometry, pixels, colours and Figma's values; writes `diff/report.md`, `results.json` and crops; the limits fail CI |
| `spacing-audit.mjs`              | margins, paddings, heights and gaps of every section, reference versus build (`SPACING-AUDIT.md`, `diff/spacing.json`) |
| `responsive-audit.mjs [ids] [--fail] [--update-known]` | every screen at six phone sizes: a screenshot strip, and sideways scroll, elements off-screen or clipped, wider than their box, overflowing text, content under pinned bars and floating buttons; accepted findings are pinned to their devices and sizes |
| `figma-styles.js`                | read-only script for the Figma MCP `use_figma`: every node's values, for the style check (`style-check.mjs`) |
| `figma-boxes.py <node> [--sections]` | boxes of a frame's nodes from saved `get_metadata` XML, or a sections-file skeleton           |
| `serve-dist.mjs`                 | static server with an SPA fallback, used by `pixel-diff`                                         |

Settings (`figma-pixel.config.json`), file formats, preview routes, CI, how to read the numbers and a table
of typical mismatch causes: [`references/method.md`](skills/figma-pixel-check/references/method.md).

## Tested on real Figma renders

[`corpus/`](corpus) holds 12 frames drawn in Figma to be hard for this check (strokes of every alignment, type
metrics, text at the wrapping point, shadows and blurs, neighbouring colours, fractional geometry, radii and
masks, transparency, a list, a full screen with pinned bars, icons, a dense table), each built through the
skill's own loop. They run in CI as regression fixtures, and `npm run bench` injects 167 realistic mistakes
into them to measure what the checks catch ([`corpus/BENCHMARK.md`](corpus/BENCHMARK.md)). Building them
found the colour blind spot, text rendered unlike Figma on Linux, and responsive checks that missed clipped
text and floating buttons, and showed where pixels stop: font weight, text colour and radius. With the fixes
and the style check, detection went from 84 of 167 to all 168. The corpus was built together with the
checks, so that says no known blind spot is left, not what share of mistakes other designs would show.

## Limits

Web only (Chromium through Playwright), device scale factor 1, one reference viewport per sections file,
static states. Without the exported styles, the colour of small text, small radius changes and font weight
are not seen. Each of these is spelled out in the method reference.

---

## По-русски

Скилл для Claude Code: вёрстка экрана по фрейму Figma и доказательство совпадения. Страница сравнивается
с эталонным PNG из Figma **по секциям**, каждая от собственного top, отдельно по геометрии, пикселям и
цвету (соседний токен цвета или потерянная opacity пиксельному сравнению не видны, проверка цвета их
находит и называет оба цвета). Поэтому сдвиг одного блока не
окрашивает всё, что ниже, а отчёт показывает, какая именно секция отличается: положением, высотой или
пикселями. Аудит отступов меряет поля, отступы и зазоры каждой секции в эталоне и в сборке. Проверка размеров
открывает каждый экран на шести телефонах от 360 до 440 px и ищет то, что вылезает за экран или за свой
блок, текст, который не помещается, и контент под закреплённой панелью. В CI `--max-geometry=1` валит
сборку, если у секции поехали top или высота (сдвиг от секции выше не считается), а принятые находки
responsive-аудита привязаны к устройствам и допустимому размеру. Итог
записывается в `PIXEL-SPEC.md` тремя разделами: «Исправлено», «Оставлено осознанно», «Не закрыто».
Ничего, чего нет в макете, не придумывается.

Установка: `/plugin marketplace add jackkru69/figma-pixel-check`, затем
`/plugin install figma-pixel-check@figma-pixel-check`. Или `npx skills add jackkru69/figma-pixel-check`. Или скопируйте `skills/figma-pixel-check` в
`.claude/skills/` проекта.

## License

[MIT](LICENSE)
