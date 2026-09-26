# figma-pixel-check

[![example](https://github.com/jackkru69/figma-pixel-check/actions/workflows/example.yml/badge.svg)](https://github.com/jackkru69/figma-pixel-check/actions/workflows/example.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Visual QA for Figma to web. It compares a built page with its Figma frame **section by section**:
position and height, pixels, flat colours and Figma's own values (fonts, radii, strokes, shadows, gap,
padding). Then it opens the page at six phone sizes and looks for what breaks there. It is plain Node and
Playwright with limits for CI. It also ships as a [Claude Code](https://claude.com/claude-code) skill that
runs the whole loop: read the frame, lay out the screen, check it, fix it, record what is left.

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

## What it checks

| Check | What it reports | Why it is separate |
| --- | --- | --- |
| **Geometry** | Δ top and Δ height of every section (Δ left and Δ width for regions) | a section's own displacement: the ones a taller block pushes down show 0, so `--max-geometry=1` fails on the culprit alone |
| **Pixels** | the mismatch of each section, with expected / actual / diff crops | tuned to ignore text rasterisation, so the numbers stay low on a correct layout |
| **Colour** | the share of flat areas whose colour differs, and the pair (`#F2F4F7 → #F9FAFB`) | a neighbouring colour token or a lost opacity is invisible to the tuned pixel diff |
| **Styles** | Figma's values against the computed styles: `hero: «Alex Kim» font-weight 600 → 500`, `action: button 9:5 radius 14 → 8`, `nav: gap 12 → 16` | pixels cannot tell a weight of 500 from 600, or a radius of 8 from 12 |
| **Spacing** | margins, paddings, heights and gaps of each section, measured in both images | says which gap moved when a section's height is off |
| **Responsive** | at 360–440 px: sideways scroll, elements cut by the screen edge or clipped, wider than their box, text that does not fit, content under pinned bars | the design is drawn at one width; accepted findings are pinned to their devices and size |

## Use it without an agent

The scripts need Node 20+, `@playwright/test`, `pixelmatch@7` and `pngjs@7`.

```bash
mkdir -p scripts/figma-pixel && cp path/to/figma-pixel-check/skills/figma-pixel-check/scripts/* scripts/figma-pixel/
npm i -D @playwright/test pixelmatch@7 pngjs@7
npx playwright install chromium
```

For each screen:

1. Export the frame from Figma as a PNG at 1x to `design/figma/reference/<id>-<width>.png` (the Figma MCP
   `get_screenshot` gives the same render).
2. Write `design/figma/sections/<id>.json`: the frame size and its horizontal bands
   (`{ "name": "hero", "top": 56, "height": 180 }`). `figma-boxes.py` makes a skeleton from saved
   `get_metadata` output.
3. Render the screen alone at a preview route (`/preview/<id>` by default) and mark each band with
   `data-section="<name>"`.
4. Optionally export Figma's values with [`figma-styles.js`](skills/figma-pixel-check/scripts/figma-styles.js)
   (a read-only script for the Figma MCP `use_figma`) to `design/figma/styles/<id>.json`. Without it the
   style check is skipped.

Then:

```bash
node scripts/figma-pixel/pixel-diff.mjs          # design/figma/diff/report.md
node scripts/figma-pixel/spacing-audit.mjs       # design/figma/SPACING-AUDIT.md
node scripts/figma-pixel/responsive-audit.mjs    # design/figma/diff/responsive/
```

The build command, output folder, route, capture CSS and devices go in `figma-pixel.config.json`. Every
setting and file format, and how to read the numbers:
[`references/method.md`](skills/figma-pixel-check/references/method.md).

### CI

Commit the reference PNGs, the sections files and the styles, then fail the job on a regression:

```bash
npx playwright install --with-deps chromium
node scripts/figma-pixel/pixel-diff.mjs --max-section=10 --max-geometry=1 --max-color=0.5 --max-style=0
node scripts/figma-pixel/responsive-audit.mjs --skip-build --fail
```

A difference kept on purpose gets its own `maxGeometry` / `maxMismatch` / `maxColor` / `maxStyle` and a
`reason` on its section, so the tight limits hold everywhere else. A malformed limit or an unknown flag is
an error, not a disabled check.

## Use it with Claude Code

Install the plugin:

```
/plugin marketplace add jackkru69/figma-pixel-check
/plugin install figma-pixel-check@figma-pixel-check
```

Or with the [skills](https://skills.sh) CLI (Claude Code, Cursor, Codex and other agents):
`npx skills add jackkru69/figma-pixel-check`. Or copy [`skills/figma-pixel-check`](skills/figma-pixel-check)
into your project's `.claude/skills/`. Connect the [Figma MCP server](https://developers.figma.com/docs/figma-mcp-server/)
to fetch frames; the check itself only needs what is committed.

Then ask, for example: *"Lay out this screen: https://figma.com/design/…?node-id=123-456"*, or *"check the
settings screen against Figma"*. The skill:

1. checks the Figma MCP seat and budget (calls are rate-limited; everything fetched is cached in the repo);
2. saves the frame's metadata, code, values and a 1x reference PNG, and writes the sections file;
3. lays out the screen with the project's own components and tokens;
4. runs the checks and fixes geometry first, then spacing, colours and values, pixels last;
5. runs the responsive audit without breaking the design width;
6. records the result in `PIXEL-SPEC.md` under **Fixed**, **Kept on purpose** and **Open**, without
   inventing anything that is not in the design.

On first use it copies the scripts into the project, adds `figma-pixel.config.json` and walks through the
preview route it needs.

## Try the example

```bash
npm ci
npx playwright install chromium
npm run example
npm test
```

[`examples/basic`](examples/basic) is a static page with a reference PNG and a sections file. The reference
was rendered from a variant of the page with a taller header and wider gaps between the stat cards, so the
report shows each kind of finding: a height change, a shifted but identical section, and a real pixel
difference. `npm test` runs the CI limits against a copy of it and the corpus below.

## Scripts

| Script | What it does |
| --- | --- |
| `pixel-diff.mjs [ids] [--skip-build] [--max-section=N] [--max-geometry=PX] [--max-color=N] [--max-style=N]` | builds, serves, captures and compares geometry, pixels, colours and Figma's values; writes `diff/report.md`, `results.json` and crops |
| `spacing-audit.mjs` | margins, paddings, heights and gaps of every section, reference versus build (`SPACING-AUDIT.md`, `diff/spacing.json`) |
| `responsive-audit.mjs [ids] [--fail] [--update-known]` | every screen at six phone sizes: a screenshot strip and the findings; accepted ones are pinned to their devices and size |
| `figma-styles.js` | read-only script for the Figma MCP `use_figma`: every node's values, for the style check |
| `figma-boxes.py <node> [--sections]` | boxes of a frame's nodes from saved `get_metadata` XML, or a sections-file skeleton |
| `serve-dist.mjs` | static server with an SPA fallback, used by `pixel-diff` |

## Tested on real Figma renders

[`corpus/`](corpus) holds 12 frames drawn in Figma to be hard for this check: strokes of every alignment,
type metrics, text at the wrapping point, shadows and blurs, neighbouring colours, fractional geometry, radii
and masks, transparency, a list, a full screen with pinned bars, icons and a dense table. Each was built
through the skill's own loop. They run in CI as regression fixtures, and `npm run bench` injects 168
realistic mistakes into them to measure what the checks catch ([`corpus/BENCHMARK.md`](corpus/BENCHMARK.md)).

Building them found the colour blind spot, text rendered unlike Figma on Linux, and responsive checks that
missed clipped text and floating buttons. It also showed where pixels stop: font weight, text colour and
radius. With the fixes and the style check, detection went from 84 of 167 to all 168. The corpus was built
together with the checks, so that means no known blind spot is left, not a detection rate on other designs.

The tool itself was extracted from a production mobile web app (React + Capacitor), where every section of
every checked screen ended up matching Figma in position and height.

## Limits

Web only (Chromium through Playwright), device scale factor 1, one reference viewport per sections file,
static states (hover, focus and open menus need their own preview route). Fonts must match the design's.
Without the exported styles, the colour of small text, small radius changes and font weight are not seen.
Each of these is spelled out in the [method reference](skills/figma-pixel-check/references/method.md#limits).

---

## По-русски

Визуальная проверка вёрстки по Figma. Страница сравнивается с фреймом **по секциям**, каждая от
собственного top: положение и высота, пиксели, плоские цвета (соседний токен или потерянная opacity
пиксельному сравнению не видны, проверка цвета называет оба цвета) и собственные значения Figma: шрифты,
радиусы, обводки, тени, gap и padding (вес 500 и 600 пикселями не различить). Поэтому сдвиг одного блока
не окрашивает всё, что ниже, а отчёт показывает, какая секция отличается и чем. Аудит отступов меряет поля
и зазоры каждой секции, responsive-аудит открывает экран на шести телефонах от 360 до 440 px и ищет то,
что вылезает за экран или за свой блок, текст, который не помещается, и контент под закреплённой панелью.

Работает без агента: обычные скрипты на Node и Playwright с лимитами для CI (`--max-geometry=1`,
`--max-color`, `--max-style`, `responsive-audit --fail`; принятые находки привязаны к устройствам и
допустимому размеру). Как скилл Claude Code ведёт весь цикл: читает фрейм, верстает, проверяет, исправляет
и записывает итог в `PIXEL-SPEC.md` («Исправлено», «Оставлено осознанно», «Не закрыто»), ничего не
придумывая сверх макета.

Установка скилла: `/plugin marketplace add jackkru69/figma-pixel-check`, затем
`/plugin install figma-pixel-check@figma-pixel-check`, или `npx skills add jackkru69/figma-pixel-check`.

## License

[MIT](LICENSE). The corpus fonts are Inter under the SIL Open Font License 1.1 ([`corpus/fonts/OFL.txt`](corpus/fonts/OFL.txt)).
