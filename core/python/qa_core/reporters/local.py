"""Default reporter. Writes a self-contained HTML dashboard plus a JSON summary
into reports/, and needs no credentials of any kind.

That last part is deliberate. A reporting layer that only works once someone has
provisioned an API token cannot be demonstrated, reviewed, or tested by anyone
who has just cloned the repository. The local reporter is the one that always
runs; the hosted ones are variations on it.

No CDN links, no external fonts, no build step -- the file opens from disk. The
markup matches node/src/bridge/adapters/local.js so the two stacks produce a
visually identical report.
"""

from __future__ import annotations

import html
from datetime import datetime, timezone
from pathlib import Path

from qa_core import paths
from qa_core.result_queue import write_json_atomic

NAME = "local"

STATUS_CLASS = {"Passed": "pass", "Failed": "fail", "Blocked": "block"}

STYLE = """
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
"""


def _esc(value) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def _rows(records: list[dict]) -> str:
    out = []
    for r in records:
        if r["status"] == "Failed":
            detail = r.get("reason") or ""
        elif r["status"] == "Blocked":
            detail = r.get("note") or ""
        else:
            detail = ""

        out.append(
            "<tr>"
            f'<td class="id">{_esc(r["caseId"])}</td>'
            f'<td>{_esc(r["module"])}</td>'
            f'<td>{_esc(r["title"])}</td>'
            f'<td><span class="badge {STATUS_CLASS.get(r["status"], "other")}">'
            f'{_esc(r["status"])}</span></td>'
            f'<td class="counts">{_esc(r["counts"]["passed"])}/{_esc(r["counts"]["total"])}</td>'
            f'<td class="detail">{_esc(detail)}</td>'
            "</tr>"
        )
    return "\n".join(out)


def render_html(records: list[dict], summary: dict, controls: dict) -> str:
    generated = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    neg, pos = controls["negative"], controls["positive"]

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test run report</title>
<style>{STYLE}</style>
</head>
<body>
  <h1>Test run report</h1>
  <div class="sub">Generated {_esc(generated)} &middot; source of truth is <code>queue/results.jsonl</code></div>

  <div class="cards">
    <div class="card"><div class="n">{summary["total"]}</div><div class="k">Cases</div></div>
    <div class="card"><div class="n" style="color:var(--pass)">{summary["Passed"]}</div><div class="k">Passed</div></div>
    <div class="card"><div class="n" style="color:var(--fail)">{summary["Failed"]}</div><div class="k">Failed</div></div>
    <div class="card"><div class="n" style="color:var(--block)">{summary["Blocked"]}</div><div class="k">Blocked</div></div>
  </div>

  <div class="wrap">
    <table>
      <thead><tr>
        <th>ID</th><th>Module</th><th>Title</th><th>Status</th><th>Assertions</th><th>Reason / Note</th>
      </tr></thead>
      <tbody>
{_rows(records)}
      </tbody>
    </table>
  </div>

  <div class="controls">
    <b>Measurement controls:</b>
    negative {"passed" if neg["ok"] else "FAILED"} (identical input produced {neg["actual"]} differences, expected 0) &middot;
    positive {"passed" if pos["ok"] else "FAILED"} (a planted difference was {"detected" if pos["ok"] else "MISSED"}).
    This report is only published when both controls pass.
  </div>
</body>
</html>
"""


def publish(records: list[dict], summary: dict, controls: dict) -> dict:
    html_path = paths.dashboard_file()
    json_path = paths.summary_file()

    ordered = sorted(records, key=lambda r: int(r["caseId"]))

    write_json_atomic(html_path, render_html(ordered, summary, controls))
    write_json_atomic(
        json_path,
        {
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "summary": summary,
            "controls": controls,
            "cases": [
                {
                    "caseId": r["caseId"],
                    "module": r["module"],
                    "title": r["title"],
                    "status": r["status"],
                    "reason": r.get("reason", ""),
                    "note": r.get("note", ""),
                    "counts": r["counts"],
                    "durationMs": r.get("durationMs"),
                }
                for r in ordered
            ],
        },
    )

    return {"htmlPath": str(html_path), "jsonPath": str(json_path)}
