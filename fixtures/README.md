# fixtures

Ground truth. CLAUDE.md invariant #2: for any real bill in `bills/`, rating the
customer's actual interval data against their actual schedule must reproduce it —
total within 0.5%, every line item within $1.

**Never adjust a fixture to make a test pass.** Fix the engine, or flag the tariff.
A fixture that has been nudged to match the engine has stopped being evidence.

```
bills/            hand-transcribed bills (the assertions)
intervals/        interval data each bill is rated against
tariffs/          tariff records fixtures rate against
holidays/         injected holiday calendars, with OBSERVED dates
tariff-sheets/    source PDFs, so a transcription can be re-checked
```

## Current contents

One fixture, `bills/synthetic-example-001.json`, marked `"synthetic": true`. It
exists so the harness is runnable before real bills arrive, and the harness prints
`NO REAL BILLS YET` on every run until one does. **A green suite today proves the
engine is self-consistent, not that it reproduces an SCE bill.**

Its expected values were computed by hand from the synthetic tariff — the
derivation is in the fixture's own `syntheticNotes`. Generating them from the
engine would have made the test assert only that the engine equals itself.

## Adding a real bill

1. Save the bill PDF under `tariff-sheets/` (or alongside, and set `billPdfRef`).
2. Download the customer's Green Button interval data and convert it to an
   `IntervalFile` under `intervals/`. Timestamps need an **explicit UTC offset** —
   a naive `2026-11-01T01:30:00` names two different instants during the fall-back
   hour, and the loader rejects it rather than pick one.
3. Transcribe the tariff sheet into a record under
   `packages/tariff-library/tariffs/`, with real provenance and a human in
   `verifiedBy`.
4. Build a holiday calendar under `holidays/` for the years the bill covers, using
   **observed** dates — the engine does no holiday shifting of its own.
5. Write the fixture in `bills/`, `"synthetic": false`, transcribing what the paper
   bill says. Set `sourceId` on each line where you can; it is the strongest match
   the reconciler has.
6. Run `pnpm test`. When it fails, the reconciliation report gives a line-by-line
   diff — a wrong rate usually names itself.

Tolerances may be *tightened* per fixture but not loosened; the schema rejects
anything looser than the invariant.
