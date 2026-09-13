# Queue format

Results are written to an append-only JSONL queue at the moment they are
measured, not collected at the end from a runner's log. The runner's log is
convenience; the queue is the source of truth. Reports and the gate read the
queue; the bug flow reads it too.

## One record per case

Each line is one graded case:

```json
{
  "caseId": "173",
  "module": "05. DB — indexer store",
  "layer": "BE/DB",
  "title": "An OrderPlaced becomes an orders row equal to getOrder",
  "priority": "High",
  "status": "Passed",
  "reason": "",
  "note": "",
  "counts": { "total": 1, "passed": 1, "failed": 0, "unobservable": 0 },
  "assertions": [ { "id": "a1", "description": "...", "outcome": "pass", "detail": "" } ],
  "evidence": { "...": "..." },
  "via": "cucumber",
  "ts": "2026-…"
}
```

- `status` is the graded verdict: `Passed` · `Failed` · `Blocked`.
- `reason` is required for `Failed` ("expected X, observed Y"); `note` is
  required for `Blocked` (what would unblock it).
- `assertions` is the full list the grade was computed from; `evidence` is
  whatever the tier chose to stamp for a human reader.
- `via` records which stack wrote the line (`cucumber` or `pytest-bdd`).

## Latest-by-timestamp

Re-running a case appends a new line; readers take the **latest** line per
`caseId`. Nothing is mutated or deleted, so a run's history stays intact and a
re-run of a single case simply supersedes it.

## Who reads it

- `qa-report` (`bridge/`) folds the queue into a summary and a per-case report.
- `qa-verify` (`verify-expectations.js`) compares the summary's shape against
  `fixtures/expected-results.json` — the CI gate.
- `qa-bugflow` (`bugflow/`) turns Failed/Blocked cases into issues keyed by a
  content signature, idempotently.

Queues live under `<stack>/queue/` and are gitignored — they are run output,
not source.
