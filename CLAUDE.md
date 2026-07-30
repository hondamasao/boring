# Project: Commercial Utility Bill Audit

Self-serve tool for small commercial electricity customers. Upload 12 months of bills plus Green Button interval data; get back (a) billing errors and (b) the cheapest eligible rate schedule with a dollar delta. First and only utility: Southern California Edison (SCE). Electricity only. Non-solar accounts only.

Solo developer. Everything must be maintainable by one person.

## Hard invariants — do not violate these without asking

1. **No LLM and no network calls in the money path.** `packages/rating-engine` is pure, deterministic, dependency-light TypeScript. Same inputs always produce the same outputs. LLMs appear in exactly one package (`packages/extraction`, bill PDF → schema) and in report prose generation. Never in arithmetic, tariff interpretation, eligibility, or savings calculation.

2. **The engine must reproduce known bills.** For any real bill in `fixtures/bills/`, rating the customer's actual interval data against their actual schedule must match the real bill: total within 0.5%, every line item within $1. This is the definition of correct. Never adjust a fixture to make a test pass — fix the engine or flag the tariff.

3. **Itemized output always.** The engine returns a line-by-line breakdown, not a total. Line-level output is what makes the golden test and the billing-error detector possible.

4. **Tariffs are versioned and immutable.** Rates change. Records are superseded, never edited in place, so a 2025 bill is always rated with 2025 rates. Every tariff record carries `sourceUrl`, `sheetRevision`, `effectiveDate`, `verifiedAt`.

5. **Never assert a savings number without a citation.** Every dollar figure traces to a specific tariff record and version.

6. **Extraction is never trusted silently.** Per-field confidence, mandatory human confirmation before anything reaches the engine. A model that declines to guess is better than one that guesses wrong.

## Domain facts (verified — do not re-derive from training data)

- SCE non-residential schedules by max demand: **TOU-GS-1** (<20 kW), **TOU-GS-2** (20–200 kW), **TOU-GS-3** (200–500 kW), **TOU-8** (>500 kW).
- SCE commercial customers can self-download 15-minute interval data via **Green Button "Download My Data"** (CSV or XML, up to 36 months). SCE also supports **Green Button Connect (OAuth 2.0)** — v2, not now.
- Tariff seed data: NREL/OpenEI **Utility Rate Database (URDB)**. The API domain is **`developer.nlr.gov`** — the old `developer.nrel.gov` was retired 29 May 2026. Do not generate the old domain.
- URDB refreshes roughly annually and its demand-charge modeling is uneven. It is a scaffold only. **Authoritative source is SCE's published tariff sheet PDF.**
- Two distinct demand charge families must be modeled separately: **facilities-related** (max kW at any time) and **time-related** (max kW within a specific TOU period).
- All TOU logic is in local clock time: **`America/Los_Angeles`**, DST-aware. SCE treats certain holidays as off-peak; a per-utility historical holiday calendar is required.
- Much of SCE territory is served by a Community Choice Aggregator, so bills split generation from delivery. Handle it in extraction; be explicit in the report about which component a recommendation affects.

## Out of scope for v1

Solar/NEM (detect and decline), gas, water, multi-meter aggregation, demand response modeling, battery dispatch, any utility besides SCE, automated filing of rate changes.

## Repo layout

```
apps/web                     Next.js app — build LAST
packages/tariff-schema       Zod schemas + types
packages/rating-engine       pure, deterministic, zero-dep
packages/tariff-library      versioned JSON + provenance
packages/greenbutton         Green Button CSV + ESPI XML parsers
packages/extraction          vision -> schema (only LLM package)
fixtures/bills               hand-transcribed golden bills (ground truth)
fixtures/intervals           real Green Button exports
fixtures/tariff-sheets       source PDFs
```

## Working style

- Tests before implementation on anything numeric.
- DST-transition months (March, November) and holiday-adjacent days get explicit test cases, written before the happy path.
- If tariff semantics are ambiguous, **stop and ask**. Do not infer how a utility charges something. A plausible guess is worse than a question, because it will pass tests and be wrong in production.
- Small commits, one concept each.
- No web app work until the rating engine passes its golden tests.
