# Gherkin conventions

One feature set, in `features/*.feature`, read by both stacks. The conventions
exist so the same file binds cleanly in Cucumber and pytest-bdd and so the
catalogue can be generated from the features.

## Tags

- `@case:N` on every scenario. On a `Scenario Outline`, one `@case:N` per
  `Examples` block, so each parameterised row is its own catalogued ID. IDs are
  immutable; an `@case` with no catalogue entry is an error.
- `@module:NN-name`, and a tier tag: `@be`/`@fe` with `@db`/`@api`/`@contract`,
  plus a target tag (`@perpdex`, `@gmx`, `@bot`). The two
  stacks select the same set — `cucumber-js --tags "@be and @db"` and
  `pytest -m "be and db"` — because the Python markers mirror the Cucumber tags.
- `@priority:high|medium|low`.

## Writing steps that bind in both stacks

- Prefer plain, quoted arguments. Cucumber Expressions treat `/` as
  **alternation** — "mint/burn" silently becomes "mint" or "burn"; avoid `/` in
  step text. pytest-bdd's `parse` will not match an empty `{string}`; give the
  empty case its own step ("... with no token") rather than passing `""`.
- Keep one definition per phrasing. In Cucumber, Given/When/Then share one
  registry, so the same text defined twice is an ambiguous-step error, not an
  override.
- A step that reads a live source routes its named unreachable error into
  Blocked (see [GRADING.md](GRADING.md)); it never lets an outage become a
  Failed assertion.

## "This cannot be observed"

When something genuinely cannot be checked from where the test stands, say so in
Gherkin rather than asserting it anyway or deleting the line:

```gherkin
But "the oracle equals the median of its feeds" cannot be verified because
    "the Vault exposes only the aggregated price"
```

That records the gap as Blocked with a reason, which is honest, instead of a
false Passed that nothing tracks.

## The catalogue is generated

`testcases/generate.js` renders `fixtures/testcases.json` (plus `.md`/`.xlsx`
tables) from the data modules (`perpdex.cases.js`, `miniapi.cases.js`,
`bot.cases.js`), so the catalogue cannot drift from what runs — run with
`--check` in CI.
