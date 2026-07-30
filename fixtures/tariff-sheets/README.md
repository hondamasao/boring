# tariff-sheets

Source PDFs for tariff records in `packages/tariff-library`. This directory is the
**only** source treated as primary (CLAUDE.md: "Authoritative source is SCE's
published tariff sheet PDF").

`sce.com` returns HTTP 403 to automated fetches — bot protection, and it will not
resolve. Do not retry it. PDFs are downloaded in a browser and committed here by
hand.

A tariff record's field is never marked verified from a web search result, a rate
summary page, a factsheet, or URDB. Those are useful for shaping which fields are
worth drafting first (see `packages/tariff-library/PENDING.md`'s "corroborated vs.
verified" distinction), but they do not move a field to "verified."

Naming: `<schedule>-<option-or-variant>-<sheet-revision-or-date>.pdf`, e.g.
`tou-gs-2-option-e-2026-01.pdf`. A tariff record's `provenance.sourceUrl` should
point at the page this PDF was downloaded from, and `provenance.sheetRevision`
should quote the sheet's own "Cal. PUC Sheet No." line.

## Current contents

- `ELECTRIC_SCHEDULES_TOU-GS-2.pdf` — 21 pages, transcribed into
  `packages/tariff-library/tariffs/sce/tou-gs-2/option-d/2026-06-01.json` and
  `.../option-e/2026-06-01.json`. Every field in those records cites its exact
  sheet number and row from this PDF; see
  `packages/tariff-library/PENDING.md` for what's verified, what needs your
  confirmation on ambiguous wording, and what's still genuinely open.
- `ELECTRIC_SCHEDULES_GS-2.pdf`, `ELECTRIC_SCHEDULES_TOU-GS-3.pdf` — uploaded
  alongside TOU-GS-2 but not yet transcribed; kept here for when a real bill
  turns out to need one of them (TOU-GS-3 is the schedule a TOU-GS-2 customer
  who crosses 200 kW is transferred to).
