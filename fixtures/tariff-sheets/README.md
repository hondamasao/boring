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
