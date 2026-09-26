// report.html for pixel-diff.mjs: the same results as report.md and results.json, with the crops side by side
// and a slider over Figma and the build. One static file next to the crops: open it from disk or from a CI
// artifact, no server and nothing loaded from the network.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const signed = (value) => (value > 0 ? `+${value}` : `${value}`);
const LABEL = { pass: 'pass', warn: 'marked', fail: 'fail', 'n/a': '—' };

function badge(status, text = LABEL[status]) {
  return `<span class="badge ${esc(status.replace('/', ''))}">${esc(text)}</span>`;
}

function checkCell(check, text) {
  if (!check || check.status === 'n/a') return '<td class="muted">—</td>';
  return `<td>${badge(check.status, text)}</td>`;
}

function sectionCard(section) {
  if (section.missing) {
    return `<article class="section fail"><header><h3>${esc(section.name)}</h3>${badge('fail', 'missing')}</header>
      <p>${esc(section.checks.section.detail)}.</p></article>`;
  }
  const c = section.checks;
  const worst = Object.values(c).some((x) => x.status === 'fail') ? 'fail' : Object.values(c).some((x) => x.status === 'warn') ? 'warn' : 'pass';
  const g = c.geometry;
  const rows = [
    ['Geometry', `Δ top ${signed(g.top)}, Δ height ${signed(g.height)}${'left' in g ? `, Δ left ${signed(g.left)}, Δ width ${signed(g.width)}` : ''} px`, g.status],
    ['Pixels', `${c.pixels.value} % mismatch${c.pixels.limit != null ? ` (limit ${c.pixels.limit} %)` : ''}`, c.pixels.status],
    ['Colour', `${c.colour.value} %${c.colour.pair && c.colour.value > 0 ? ` · ${c.colour.pair}` : ''}`, c.colour.status],
    ...(c.styles.status !== 'n/a' ? [['Styles', `${c.styles.value} of ${section.styles.checked + section.styles.missingText} differ`, c.styles.status]] : []),
  ];
  const styles = section.styles?.off ?? [];
  const f = section.files;
  const img = (file, alt) => (file ? `<figure><img src="${esc(file)}" alt="${esc(alt)}" loading="lazy"><figcaption>${esc(alt)}</figcaption></figure>` : '');
  return `<article class="section ${worst}">
    <header><h3>${esc(section.name)}</h3>${badge(worst)}</header>
    <table class="numbers">${rows.map(([name, text, status]) => `<tr><th>${name}</th><td>${esc(text)}</td><td>${badge(status)}</td></tr>`).join('')}</table>
    ${styles.length ? `<details open><summary>Values that differ from Figma (${styles.length})</summary><ul>${styles
      .map((off) => `<li><b>${esc(off.label)}</b> ${esc(off.property)} <code>${esc(off.figma)}</code> → <code>${esc(off.dom)}</code></li>`)
      .join('')}</ul></details>` : ''}
    ${section.hotspots?.length ? `<details${worst !== 'pass' ? ' open' : ''}><summary>Hotspots (${section.hotspots.length})</summary><ol>${section.hotspots
      .map((h) => `<li>x=${h.x} y=${h.y} w=${h.width} h=${h.height} — ${(h.mismatch * 100).toFixed(1)} % of the box, ${Math.round(h.share * 100)} % of the mismatch</li>`)
      .join('')}</ol></details>` : ''}
    <div class="views">
      <div class="grid">${img(f.expected, 'Figma')}${img(f.actual, 'Build')}${img(f.diff, 'Diff')}${img(f.hotspots, 'Hotspots')}</div>
      <div class="slider" data-slider><div class="stack"><img src="${esc(f.expected)}" alt="Figma"><img class="top" src="${esc(f.actual)}" alt="Build"></div>
        <label>Figma <input type="range" min="0" max="100" value="50" aria-label="Figma to build"> Build</label></div>
    </div>
  </article>`;
}

function screenBlock(r) {
  const sections = r.sections.filter((s) => !s.missing);
  const summary = ['geometry', 'pixels', 'colour', 'styles'].map((name) => {
    const statuses = sections.map((s) => s.checks[name]?.status).filter((s) => s && s !== 'n/a');
    if (r.sections.some((s) => s.missing) && name === 'geometry') statuses.push('fail');
    return statuses.length === 0 ? { status: 'n/a' } : { status: statuses.includes('fail') ? 'fail' : statuses.includes('warn') ? 'warn' : 'pass' };
  });
  return `<section class="screen" id="${esc(r.id)}">
    <header><h2>${esc(r.id)}</h2>${badge(r.verdict)}${r.state ? `<span class="muted">state ${esc(r.state)} of ${esc(r.screen)}</span>` : ''}</header>
    <p class="muted">${r.width}×${r.height} · sections ${(r.mean * 100).toFixed(2)} % mean · ${esc(r.url ?? '')}</p>
    <table class="checks"><tr><th>Geometry</th><th>Pixels</th><th>Colour</th><th>Styles</th></tr><tr>${summary.map((s) => checkCell(s)).join('')}</tr></table>
    ${r.problems.length ? `<p class="fail-text">Console errors: ${r.problems.map(esc).join(' · ')}</p>` : ''}
    ${r.missingText?.length ? `<p>Figma text not found: ${r.missingText.map((m) => `${esc(m.section)} «${esc(m.text.trim().slice(0, 60))}»`).join(', ')}</p>` : ''}
    ${r.sections.map(sectionCard).join('\n')}
  </section>`;
}

export function writeHtmlReport(results, outDir, { threshold }) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pixel check report</title>
<style>
:root { --bg: #f6f7f9; --card: #fff; --ink: #16181d; --muted: #667085; --line: #e4e7ec; --pass: #067647; --pass-bg: #dcfae6; --warn: #b54708; --warn-bg: #fef0c7; --fail: #b42318; --fail-bg: #fee4e2; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f1115; --card: #181b21; --ink: #eceef2; --muted: #98a2b3; --line: #2a2f38; --pass: #75e0a7; --pass-bg: #0b3a24; --warn: #fdb022; --warn-bg: #4a2b06; --fail: #fda29b; --fail-bg: #55160c; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1280px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 0; } h3 { font-size: 15px; margin: 0; }
.muted { color: var(--muted); } code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; }
.badge.pass { color: var(--pass); background: var(--pass-bg); } .badge.warn { color: var(--warn); background: var(--warn-bg); } .badge.fail { color: var(--fail); background: var(--fail-bg); }
.badge.na { color: var(--muted); }
.fail-text { color: var(--fail); }
nav.index { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 24px; }
nav.index a { color: inherit; text-decoration: none; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; display: inline-flex; gap: 8px; align-items: center; }
.screen { margin: 0 0 40px; } .screen > header, .section > header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
table { border-collapse: collapse; } th, td { text-align: left; padding: 4px 12px 4px 0; vertical-align: top; }
.checks { margin: 8px 0 16px; } .checks th { font-weight: 500; color: var(--muted); }
.section { background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--line); border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
.section.fail { border-left-color: var(--fail); } .section.warn { border-left-color: var(--warn); } .section.pass { border-left-color: var(--pass); }
.numbers th { font-weight: 500; color: var(--muted); width: 90px; }
details { margin: 8px 0; } summary { cursor: pointer; font-weight: 500; } ul, ol { margin: 6px 0; padding-left: 20px; }
.views { margin-top: 10px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
figure { margin: 0; } figure img, .stack img { display: block; max-width: 100%; height: auto; border: 1px solid var(--line); image-rendering: pixelated; background: #fff; }
figcaption { font-size: 12px; color: var(--muted); margin-top: 3px; }
.slider { margin-top: 10px; } .stack { position: relative; display: inline-block; max-width: 100%; }
.stack .top { position: absolute; inset: 0; clip-path: inset(0 0 0 50%); }
.slider label { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--muted); max-width: 420px; } .slider input { flex: 1; }
@media (max-width: 600px) { .numbers th { width: auto; } }
</style></head><body><main>
<h1>Pixel check report</h1>
<p class="muted">Generated ${esc(new Date().toISOString())} · pixelmatch threshold ${esc(threshold)} · DPR 1. Figma is the reference; every section is compared from its own top.</p>
<nav class="index">${results.map((r) => `<a href="#${esc(r.id)}">${esc(r.id)} ${badge(r.verdict)}</a>`).join('')}</nav>
${results.map(screenBlock).join('\n')}
</main>
<script>
for (const slider of document.querySelectorAll('[data-slider]')) {
  const top = slider.querySelector('.top');
  const input = slider.querySelector('input');
  const set = () => { top.style.clipPath = 'inset(0 0 0 ' + input.value + '%)'; };
  input.addEventListener('input', set);
  set();
}
</script>
</body></html>
`;
  writeFileSync(join(outDir, 'report.html'), html);
}
