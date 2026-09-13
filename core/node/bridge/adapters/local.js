'use strict';

const { writeAtomic, writeJson } = require('../../lib/fsx');
const paths = require('../../paths');

/**
 * Default reporter. Writes a self-contained HTML dashboard plus a JSON summary
 * into reports/, and needs no credentials of any kind.
 *
 * That last part is deliberate. A reporting layer that only works once someone
 * has provisioned an API token cannot be demonstrated, reviewed, or tested by
 * anyone who has just cloned the repository. The local adapter is the one that
 * always runs; the hosted ones are variations on it.
 *
 * No CDN links, no external fonts, no build step -- the file opens from disk.
 */

const name = 'local';

function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusClass(status) {
  if (status === 'Passed') return 'pass';
  if (status === 'Failed') return 'fail';
  if (status === 'Blocked') return 'block';
  return 'other';
}

function renderRows(records) {
  return records.map((r) => {
    const detail = r.status === 'Failed' ? r.reason : (r.status === 'Blocked' ? r.note : '');
    return [
      '<tr>',
      '<td class="id">' + escapeHtml(r.caseId) + '</td>',
      '<td>' + escapeHtml(r.module) + '</td>',
      '<td>' + escapeHtml(r.title) + '</td>',
      '<td><span class="badge ' + statusClass(r.status) + '">' + escapeHtml(r.status) + '</span></td>',
      '<td class="counts">' + escapeHtml(r.counts.passed) + '/' + escapeHtml(r.counts.total) + '</td>',
      '<td class="detail">' + escapeHtml(detail) + '</td>',
      '</tr>',
    ].join('');
  }).join('\n');
}

function renderHtml(records, summary, controls) {
  const generated = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test run report</title>
<style>
  :root {
    --bg: #ffffff; --fg: #16181d; --muted: #5b6170; --line: #e3e6ec;
    --pass: #1a7f4b; --fail: #c0392b; --block: #b06f00; --card: #f7f8fa;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14161a; --fg: #e8eaee; --muted: #98a0ad; --line: #2a2e36;
      --pass: #4ade80; --fail: #f87171; --block: #fbbf24; --card: #1c1f25;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: var(--bg); color: var(--fg);
         font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  .cards { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
          padding: 14px 18px; min-width: 108px; }
  .card .n { font-size: 24px; font-weight: 600; }
  .card .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  .wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; min-width: 760px; }
  th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .05em;
       color: var(--muted); padding: 10px 12px; border-bottom: 1px solid var(--line); font-weight: 600; }
  td { padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  .id { font-variant-numeric: tabular-nums; color: var(--muted); }
  .counts { font-variant-numeric: tabular-nums; color: var(--muted); }
  .detail { color: var(--muted); font-size: 13px; max-width: 46ch; }
  .badge { display: inline-block; padding: 2px 9px; border-radius: 999px;
           font-size: 12px; font-weight: 600; border: 1px solid currentColor; }
  .badge.pass { color: var(--pass); } .badge.fail { color: var(--fail); } .badge.block { color: var(--block); }
  .controls { margin-top: 24px; font-size: 13px; color: var(--muted); }
  .controls b { color: var(--fg); }
  code { background: var(--card); padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
  <h1>Test run report</h1>
  <div class="sub">Generated ${escapeHtml(generated)} &middot; source of truth is <code>queue/results.jsonl</code></div>

  <div class="cards">
    <div class="card"><div class="n">${summary.total}</div><div class="k">Cases</div></div>
    <div class="card"><div class="n" style="color:var(--pass)">${summary.Passed}</div><div class="k">Passed</div></div>
    <div class="card"><div class="n" style="color:var(--fail)">${summary.Failed}</div><div class="k">Failed</div></div>
    <div class="card"><div class="n" style="color:var(--block)">${summary.Blocked}</div><div class="k">Blocked</div></div>
  </div>

  <div class="wrap">
    <table>
      <thead><tr>
        <th>ID</th><th>Module</th><th>Title</th><th>Status</th><th>Assertions</th><th>Reason / Note</th>
      </tr></thead>
      <tbody>
${renderRows(records)}
      </tbody>
    </table>
  </div>

  <div class="controls">
    <b>Measurement controls:</b>
    negative ${controls.negative.ok ? 'passed' : 'FAILED'} (identical input produced ${controls.negative.actual} differences, expected 0) &middot;
    positive ${controls.positive.ok ? 'passed' : 'FAILED'} (a planted difference was ${controls.positive.ok ? 'detected' : 'MISSED'}).
    This report is only published when both controls pass.
  </div>
</body>
</html>
`;
}

async function publish(records, summary, controls) {
  const htmlPath = paths.dashboardFile();
  const jsonPath = paths.summaryFile();

  const ordered = [...records].sort((a, b) => Number(a.caseId) - Number(b.caseId));

  writeAtomic(htmlPath, renderHtml(ordered, summary, controls));
  writeJson(jsonPath, {
    generatedAt: new Date().toISOString(),
    summary,
    controls,
    cases: ordered.map((r) => ({
      caseId: r.caseId, module: r.module, title: r.title, status: r.status,
      reason: r.reason, note: r.note, counts: r.counts, durationMs: r.durationMs,
    })),
  });

  return { htmlPath, jsonPath };
}

module.exports = { name, publish };
