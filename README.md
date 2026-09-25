# figma-pixel-check

[![example](https://github.com/jackkru69/figma-pixel-check/actions/workflows/example.yml/badge.svg)](https://github.com/jackkru69/figma-pixel-check/actions/workflows/example.yml)

A [Claude Code](https://claude.com/claude-code) skill for building web screens from Figma frames and
**proving** they match. It uses a per-section pixel diff and a spacing audit against reference PNGs
exported from Figma, and never judges by eye.

Most "pixel-perfect" checks compare whole screenshots. Then one block that is 8 px too tall turns
everything below it red, and the number no longer tells you what is wrong. Here each screen is split into
horizontal sections (`nav`, `hero`, `list`…), and **every section is compared from its own top**. The
report shows which section is off, whether its position, its height or its pixels differ, and by how much.

```
| # | Section  | Figma top/h | DOM top/h | Mismatch |
| 0 | nav      | 0/56        | 0/56      | 0.00%    |
| 1 | hero     | 56/180      | 56/172    | 0.00%    |  ← 8 px shorter: the geometry says so, not the pixels
| 2 | stats    | 236/88      | 228/88    | 2.16%    |  ← a real difference inside the section
| 3 | settings | 324/168     | 316/168   | 0.00%    |  ← shifted by 8 px but identical, and reported as such
```

The spacing audit then measures every section in both images:

```
| Section | Left          | Right         | Top padding | Bottom padding  | Height           | Gaps in a row |
| hero    | 137 / 137 (0) | 139 / 139 (0) | 16 / 16 (0) | 33 / 25 (-8) ←  | 180 / 172 (-8) ← | — → —         |
| stats   | 25 / 24 (-1)  | 24 / 23 (-1)  | 0 / 0 (0)   | 24 / 24 (0)     | 88 / 88 (0)      | 16, 16 → 8, 8 |
```

It was extracted from a production mobile web app (React + Capacitor). There, every section of every
checked screen ended up matching Figma to the pixel in position and height, and the remaining differences
were explained one by one.

## What the skill does

1. Checks the Figma MCP seat and budget: calls are rate-limited, and everything fetched is cached in the repo.
2. Reads the frame (`get_metadata`, `get_design_context`) and saves a 1x reference PNG (`get_screenshot`).
3. Writes the sections file from the frame's boxes (`figma-boxes.py --sections` gives a skeleton).
4. Lays out the screen with the project's own components and tokens, and marks the sections with `data-section`.
5. Runs `pixel-diff` and `spacing-audit`, then fixes geometry first, spacing second, pixels last.
6. Records the result in `PIXEL-SPEC.md` under **Fixed**, **Kept on purpose** and **Open**, without
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
```

[`examples/basic`](examples/basic) is a static page with a CSP, a reference PNG and a sections file. The
reference was rendered from a variant of the page with a taller header and wider gaps between the stat
cards, so the report shows each kind of finding: a height change, a shifted but identical section, and a
real pixel difference.

## Scripts

| Script                           | What it does                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pixel-diff.mjs [ids] [--skip-build] [--max-section=N]` | builds, serves, captures and compares; writes `diff/report.md`, `results.json` and crops |
| `spacing-audit.mjs`              | margins, paddings, heights and gaps of every section, reference versus build                     |
| `figma-boxes.py <node> [--sections]` | boxes of a frame's nodes from saved `get_metadata` XML, or a sections-file skeleton           |
| `serve-dist.mjs`                 | static server with an SPA fallback, used by `pixel-diff`                                         |

Settings (`figma-pixel.config.json`), file formats, preview routes, CI, how to read the numbers and a table
of typical mismatch causes: [`references/method.md`](skills/figma-pixel-check/references/method.md).

## Limits

Web only (Chromium through Playwright), device scale factor 1, one viewport per sections file, static
states. Each of these is spelled out in the method reference.

---

## По-русски

Скилл для Claude Code: вёрстка экрана по фрейму Figma и доказательство совпадения. Страница сравнивается
с эталонным PNG из Figma **по секциям**, каждая от собственного top. Поэтому сдвиг одного блока не
окрашивает всё, что ниже, а отчёт показывает, какая именно секция отличается: положением, высотой или
пикселями. Аудит отступов меряет поля, отступы и зазоры каждой секции в эталоне и в сборке. Итог
записывается в `PIXEL-SPEC.md` тремя разделами: «Исправлено», «Оставлено осознанно», «Не закрыто».
Ничего, чего нет в макете, не придумывается.

Установка: `/plugin marketplace add jackkru69/figma-pixel-check`, затем
`/plugin install figma-pixel-check@figma-pixel-check`. Или `npx skills add jackkru69/figma-pixel-check`. Или скопируйте `skills/figma-pixel-check` в
`.claude/skills/` проекта.

## License

[MIT](LICENSE)
