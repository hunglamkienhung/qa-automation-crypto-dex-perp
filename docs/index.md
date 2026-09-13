# qa-automation-crypto-dex-perp — docs

QA automation for a crypto-perpetuals domain: **301 cases**, one shared grading
core, and two stacks (Node + Python) that read one Gherkin set and return the
**same verdict for every case**.

→ **[The repository](https://github.com/hunglamkienhung/qa-automation-crypto-dex-perp)** ·
[README](https://github.com/hunglamkienhung/qa-automation-crypto-dex-perp#readme)

## Contents

- **[Architecture](ARCHITECTURE.md)** — one core, two stacks, and why the domain
  pairs a live read-only protocol (GMX) with a self-written PerpDEX + mini-api
  that has a real database.
- **[Grading](GRADING.md)** — Failed > Blocked > Passed, why an outage is never
  a failure, and a gate that fails in both directions.
- **[Gherkin conventions](GHERKIN.md)** — one feature set bound in two stacks.
- **[Queue format](QUEUE-FORMAT.md)** — the append-only source of truth.
- **[Demo script](DEMO.md)** — a five-minute walkthrough, least-dependent first.

## At a glance

| Layer | Target | Cases |
|---|---|---|
| Contract | PerpDEX on anvil + GMX v1/v2 on Arbitrum | 146 |
| DB | mini-api SQLite, opened directly | 26 |
| API | mini-api REST + GMX public API | 83 |
| Bot | risk gate (pure) + operations on PerpDEX | 35 |
| FE | the GMX trading screen (Playwright) | 11 |
| | **Total** | **301** |
