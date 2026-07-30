# boring

Commercial utility bill audit for small SCE customers. See `CLAUDE.md` for the
project's invariants and domain facts; they are the spec, and this file is only a
map.

**Phase 1 (this repo, currently): the tariff schema and the rating engine.** No web
app, no extraction, no UI — CLAUDE.md says no web work until the engine passes its
golden tests, and it has no real bills to pass yet.

```
packages/tariff-schema     Zod schemas + types for a versioned tariff
packages/rating-engine     rate(loadProfile, tariff, billingPeriod, context) -> ItemizedBill
packages/tariff-library    versioned tariff records as JSON, with provenance
packages/fixture-harness   loader + reconciler for fixtures/
fixtures/                  ground truth — see fixtures/README.md
```

## Commands

```sh
pnpm install
pnpm test          # 228 tests
pnpm typecheck     # tsc -b across the workspace
pnpm check         # both
```

## State of play

The engine is complete and tested against synthetic tariffs: DST transitions,
holidays, season boundaries mid-period, both demand families, ratchets, rider
ordering, and minimum-bill logic. **It cannot yet rate a real SCE bill**, for one
reason: `packages/tariff-library` has no verified TOU-GS-2 record.

That record exists as a draft that **deliberately fails validation**, with every
field that would need a guess left empty. `packages/tariff-library/PENDING.md`
lists what each one needs, and a test asserts the draft still fails and fails only
on accounted-for fields — so it can neither look usable nor rot quietly.

Two findings from building it, both in PENDING.md:

- **TOU-GS-2 is published as several rate options that differ structurally**, not
  just in rates — Option E has facilities-related demand and no time-related
  demand. Each option is its own tariff record, and one has to be chosen.
- **The ratchet question is unresolved.** `sce.com` returns HTTP 403 to automated
  fetches, so the primary source could not be checked. Secondary sources suggest
  no ratchet on TOU-GS-2, which is not good enough to write down. The machinery is
  built and tested either way.

## The one thing to know before changing anything

`packages/rating-engine` is the money path: pure, deterministic, no network, no
LLM, no I/O, no clock, no randomness. A test scans its source for those and its
dependency list is asserted to be exactly `luxon`, `zod`, and the schema package.
Every dollar on a bill carries a JSON pointer back to the tariff field and sheet
revision that produced it.
