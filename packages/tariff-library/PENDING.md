# TOU-GS-2 — status

`tariffs/sce/tou-gs-2/option-d/2026-06-01.json` and `.../option-e/2026-06-01.json`
are **fully transcribed from the primary source**:
`fixtures/tariff-sheets/ELECTRIC_SCHEDULES_TOU-GS-2.pdf` (21 pages, downloaded by
the user, committed to the repo — no `sce.com` fetch attempts, ever; the proxy
confirms that host is blocked at the organization's egress policy level, not
merely bot-protected, so this isn't revisited).

Both records **validate**, **rate real load profiles without throwing**
(`test/rate-real-records.test.ts`), and have now been through a **verification
pass** (below) instead of a human PDF review. They are **still not signed off by
a human**: `provenance.verifiedBy` on both says `PENDING HUMAN REVIEW` — nothing
below substitutes for that, it just means the numbers have survived more scrutiny
than a single read-through before a human looks.

## Verification pass — cross-checking instead of a human PDF review

Four independent checks, run because a human wasn't available to check the PDF
directly:

**1. Independent re-transcription.** Re-read the PDF from scratch (fresh
`pdftotext -layout` extraction, re-tabulated by hand into a new scratch file
without consulting the committed JSON or memory of the first pass), then diffed
programmatically against both records: every energy rate (12 per option), FRD
(transmission + distribution, both options), TRD (delivery + generation where
present, both periods, both options), the customer charge, both riders, the
season boundaries, all 8 TOU rules, the holiday treatment, the demand
measurement window, and every eligibility threshold. **Zero discrepancies.**
The only two differences found were the two Option-E zero-rate TRD entries that
are correctly *omitted* rather than committed as `$0.00` lines — expected, not a
bug.

**2. Cross-check against secondary sources.** SCE's own TOU-GS-2 fact sheet and
Nectar Climate are both unreachable — confirmed via the proxy's status endpoint
that these are organization-level policy blocks (`gateway answered 403 to
CONNECT`), not site-side bot protection, so not retried. Indexed search snippets
of SCE's own "Summary of Available Rate Options" repeatedly say Option E has "no
time-related demand (TRD) charges," full stop — which appears to contradict this
record's generation-side TRD entries. **Investigated, not dismissed as someone
else's outdated document**: the summary is consistent with the *Delivery*-side
figures (genuinely $0.00, matching the summary) and with a Direct
Access/CCA customer's experience (their Generation isn't billed via this
schedule at all, so they'd never see that line regardless). It is silent about
Bundled Service Customers specifically, for whom the primary rate table shows a
real, nonzero **$5.65/kW** (summer) / **$2.18/kW** (winter) generation-side TRD —
re-confirmed against the raw (non-layout) token stream, independent of any
column-alignment risk in the `-layout` reconstruction. Conclusion: the summary
document is a simplification accurate for its likely intended audience, not an
error this record needs to match.

**3. The winter TRD weekday question — resolved as a schema-level ambiguity
flag, not a silent pick.** Re-read Special Condition 1 (TOU period table) against
the Sheet 4/5 rate-table row labels side by side. They say different things —
see "Genuinely ambiguous" below. `TimeRelatedDemandCharge.weekdaysOnly` (required
boolean, no default — same discipline as
`EligibilityRule.windowIncludesCurrentMonth`) now records a citable interpretation,
and the engine independently computes what the *other* reading would have
measured, warning whenever they'd disagree (`weekday-ambiguity.test.ts`, 10
cases; confirmed firing on the real Option D record against a real load profile
in `rate-real-records.test.ts`).

**4. A permanent self-check**, not a one-time verification.
`test/pdf-self-check.test.ts` shells out to `pdftotext -layout` **at test-run
time** against the committed PDF and re-derives 6 headline numbers (Summer
On-Peak energy — delivery and generation, FRD — transmission and distribution,
Summer On-Peak TRD — delivery and generation, for **both** options), comparing
them against the live-loaded JSON. Verified it actually catches drift: injected a
wrong FRD rate, confirmed the test failed with a clear diff, reverted. Skips
(doesn't fail) if `poppler-utils` isn't installed, so it never blocks the rest of
the suite on a machine that lacks it — a bonus check, not a hard requirement.

## Two things the original reading corrected (unchanged, now re-confirmed above)

**1. Option E is not "FRD only."** Delivery-side TRD is $0.00/kW (no line billed);
generation-side TRD is real and nonzero — $5.65/kW summer on-peak, $2.18/kW
winter mid-peak, Bundled Service Customers only. Re-confirmed by both the
independent re-transcription and the raw-token-stream check above.

**2. The ratchet question is fully verified, not merely corroborated.** No
"ratchet," "minimum," or "power factor" language appears anywhere in the
document in a billing context. `ratchets: []`, `minimumBill: null`,
`powerFactorAdjustment: null` on both records.

## Genuinely ambiguous — implemented as a flag, not silently resolved

**The winter TRD weekday question.** Sheet 8's TOU table defines winter Mid-Peak
as 4-9pm on *every* day, weekday or weekend/holiday (the table shows "4 p.m. -
9 p.m." under both the Weekday-Winter and Weekend/Holiday-Winter cells). But
Sheet 4 and Sheet 5 both label the winter TRD rate row itself **"Mid-peak -
Weekdays (4-9pm)"** — and the matching voltage-discount row **"Winter Weekday
Mid-Peak"** — on both options, appearing nowhere else (summer On-Peak's TRD row
carries no such label, because its period is already weekday-only, so the label
would be redundant there — its selective presence on winter Mid-Peak reads as
deliberate). Special Condition 6 doesn't resolve it: it says TRD is measured
"during ... each of the TOU Periods," no weekday carve-out of its own.

`weekdaysOnly: true` is the interpretation recorded on both records' winter
Mid-Peak TRD charges (favoring the specific, twice-repeated rate-table label over
the general period table) — **a chosen reading, not a resolved fact.** The engine
computes both readings on every bill and warns explicitly whenever they'd have
measured a different peak, naming both numbers and pointing at the charge's
citation. **Please confirm which section governs** — Special Condition 1's
period table, or the rate table's narrower label.

## Still needs your confirmation — interpretation, not missing data

Both read directly off Sheet 1; the wording is genuinely ambiguous.

1. **`reached-200-kw-in-three-of-twelve`**: *"...has reached 200 kW for any three
   months during the **preceding** 12 months..."* — read as excluding the month
   being billed (`windowIncludesCurrentMonth: false`).
2. **`at-or-below-20-kw-for-twelve-consecutive`**: *"...has registered 20 kW or
   less for 12 consecutive months..."* — no "preceding" qualifier, unlike rule 1,
   so read as including the just-billed month
   (`windowIncludesCurrentMonth: true`).

Both citations quote the exact sentence and the reasoning inline on the record
(`eligibility.demandRules[].citation`). The engine already warns when a customer
sits in the disputed zone between these two readings
(`packages/rating-engine/test/eligibility.test.ts`, "the ambiguous zone" describe
block) — same mechanism as the TRD weekday flag above. **Please confirm both
readings.**

## Fixed, not just flagged

**Billing demand now rounds to the nearest whole kW before the rate is applied**
(Sheet 11, Special Condition 6: *"The Billing Demand shall be the kW of Maximum
Demand, determined to the nearest kW."*) — implemented in
`packages/rating-engine/src/demand.ts`, applied once as the final step after any
ratchet floor, leaving the raw meter reading (`measuredPeakKw`) unrounded for
audit purposes. `packages/rating-engine/test/demand-rounding.test.ts` (8 cases)
pins a 47.6 kW peak billing as 48 kW x rate, not 47.6 x rate rounded to cents.
This was flagged as a gap in the original transcription and is now closed.

## Conditional/account-level charges — known but not modeled

Each needs an account attribute or eligibility flag the schema doesn't have yet:

- TOU Option Meter Charge (RTEM), $40.79/meter/month — needs a "customer elected
  RTEM" flag.
- California Climate Credit, -$36.00/meter, April & October bills only, for
  "Small Business Customers" (≤20 kW in ≥9 of the preceding 12 months) — needs
  month-conditional riders, which don't exist. Sheet 13 states its position in
  the stage order precisely: applied **after** city/county utility users' taxes,
  **before** franchise fees.
- Single Phase Service credit, -$9.30/month — needs a phase attribute on
  `ServiceAttributes`.
- Voltage discounts, 2 kV to 220 kV — every tier starts at 2 kV, so a v1 customer
  at standard secondary voltage gets $0 here regardless; likely irrelevant for
  the target audience rather than a real gap, but flagged.
- CARE (32.5%) and Food Bank (20%) discounts — both need an enrollment flag.
- City/county utility users' tax and franchise fees are **not part of this
  schedule at all** — confirmed absent from the document; jurisdiction-specific,
  belongs in a separate rider once the customer's city is known.

## What's genuinely still open

- **Direct Access / CCA generation modeling.** Delivery is always billed per this
  schedule (Sheet 12); Generation for DA customers comes from Schedule DA-CRS,
  for CCA customers from Schedule CCA-CRS. Neither is transcribed. The
  `generation`-component lines on these records apply to Bundled Service
  Customers only — noted in each record's `notes`.
- **A real bill and real Green Button interval data**, to actually reconcile
  against (CLAUDE.md invariant #2). Nothing above can be upgraded from "rates
  without throwing, survives cross-checking" to "reproduces a real bill" without
  one.
- **A human cross-check** of both records against the PDF — `verifiedBy` says so
  explicitly on both, and keeps printing in test output until it's done. The
  verification pass above raises confidence; it is not a substitute.

## Options excluded from v1

- **CPP variants** (Option D-CPP, the *default* option per Sheet 1 — most real
  customers are NOT on plain Option D) and Option B-CPP — need a critical-peak
  event calendar this repo doesn't have.
- **Options B, B-CPP, R** — "Discontinued TOU Periods," closed to new enrollment,
  kept only for grandfathered solar/NEM customers (Sheet 2). Rates are on
  Sheet 6-7 if a grandfathered customer's real bill ever needs one; not built
  speculatively.

## `fixtures/holidays/sce-2026.json`

Real (not synthetic) SCE holiday calendar for 2026, computed from the Sheet 8
rule. The **synthetic** fixture (`fixtures/holidays/synthetic-sce-2026.json`)
lists July 3 as the observed Independence Day — a plausible-looking placeholder
chosen before this PDF was read, and wrong for the real rule: July 4, 2026 is a
**Saturday**, and the sheet says Saturday holidays are never shifted. Doesn't
affect any test's correctness since that fixture is explicitly synthetic.
