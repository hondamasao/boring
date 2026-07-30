# TOU-GS-2 — fields still needed from the tariff sheet

v1 targets **two rate options**, each its own record because they differ in
charge *structure*, not just rates:

```
tariffs/sce/tou-gs-2/option-d/DRAFT-unverified.json   FRD + TRD + energy charges
tariffs/sce/tou-gs-2/option-e/DRAFT-unverified.json   FRD + energy charges, no TRD
```

Both **do not validate**, on purpose. Each is a skeleton with every field fillable
from structure alone, and `null`/empty where a value would have to be guessed.
`test/draft.test.ts` asserts each still fails and fails only on the errors listed
here — so filling a field in makes that test fail with "PENDING is stale", and a
*new* kind of error also fails. Neither draft can rot quietly in either direction.

Nothing in either draft is a placeholder rate. There are no invented numbers to
forget to remove.

**Excluded from v1, not speculatively built:**
- **CPP variants** (D-CPP, B-CPP) — need a critical-peak event calendar this repo
  does not have.
- **Options B and R** — closed to new enrollment. Grandfathered customers still
  exist; a record is added only if a real bill turns out to be on one, not ahead
  of that.

## Primary source: `fixtures/tariff-sheets/` only

`sce.com` returns HTTP 403 to automated fetches — this is bot protection and will
not resolve, so **stop attempting it**. Tariff PDFs are downloaded in a browser and
committed to `fixtures/tariff-sheets/`; that directory is the only source treated
as primary. A field is never marked verified from a web fetch, a summary page, a
factsheet, or URDB — see "corroborated vs. verified" below for what those secondary
sources are good for.

## Blocking — the engine cannot rate either option until these are read off the sheet

| # | Field (both options unless noted) | What I need |
|---|---|---|
| 1 | `seasons[].start/end` | Confirm summer is June 1 – September 30 and winter October 1 – May 31 for this schedule and revision. |
| 2 | `touRules` | The full TOU table: hour boundaries per season and day type. Confirmed so far (secondary source): summer on-peak is 4-9pm on summer weekdays, excluding holidays. Still needed: the winter table, weekend treatment, and whether there is a winter super-off-peak. `touPeriods` (on-peak/mid-peak/off-peak) is filled in already — see "settled" below. |
| 3 | `holidayTreatment.mapsToDayType` | Does a holiday take the **Sunday schedule** (still mid-peak in summer) or become **off-peak around the clock**? Both are implemented; the field decides. The holiday **list** — SCE's excludes some federal holidays — goes into a calendar file under `fixtures/holidays/`, not here. |
| 4 | `energyCharges[].pricing.ratePerKwh` | Rates per season × period × component, for each option. Expect Option E's rates to run higher than Option D's per kWh, since D recovers part of its peak cost through TRD instead — but that is a shape expectation, not a number to fill in from it. |
| 5 | `demandCharges.facilities[].ratePerKw` | The facilities-related rate. Confirmed structurally (secondary source): FRD applies year-round, all hours, all days, on both options. |
| 6 | `demandCharges.facilities[].measuredOver` | For a billing period straddling June 1: **one** maximum for the period, or a **separate** maximum per season segment at each season's rate? Both implemented. |
| 7 | `demandCharges.timeRelated` (Option D only) | Confirmed structurally (secondary source): TRD applies to **summer On-Peak and winter Mid-Peak, weekdays only**, excluding weekends and holidays — so two entries, not one per season, and the winter TRD period is Mid-Peak, not On-Peak. Still needed: both rates. Option E's `timeRelated` stays `[]` permanently — that is settled, not pending, for that record. |
| 8 | `fixedCharges.customerCharge` | Amount and basis — per month, or per day, or per meter per day. Likely shared across options, but confirm per record rather than assume. |
| 9 | `minimumBill` | Which of the three forms: a per-day floor, a per-month floor, or "the customer charge plus the facilities-related demand charge" (`charge-floor`)? And is the comparison made **before or after** taxes and per-kWh riders (`comparisonScope.includeStages`)? |
| 10 | `riders` | Which riders appear, each with its basis. For the percent-of-subtotal ones I need the **base**: which stages it taxes, and whether it includes generation (it must not, for a CCA customer) and the minimum-bill make-up amount. |
| 11 | `eligibility.demandRules[].windowIncludesCurrentMonth` | Does "any three months of the preceding twelve" **count the month being billed**? The two readings disagree for exactly the customer a recommendation is about — one who has just crossed 200 kW. |
| 12 | `provenance` | Sheet number, effective date, and the direct PDF URL, for each option's own sheet page. Put the PDFs in `fixtures/tariff-sheets/`. |

## Verified and settled

- **Demand measurement window.** 15 minutes, per SCE's definition of maximum
  demand as the maximum average kW during any 15-minute metered interval. The
  5-minute case (intermittent load, or load subject to violent fluctuation) is a
  determination about an **account**, not a property of the schedule, so it is
  `ServiceAttributes.demandWindowMinutesOverride` rather than a second tariff
  record per customer.
- **Time zone.** `America/Los_Angeles`, DST-aware, all TOU logic in local clock
  time.
- **Tiers.** Generic block-rate tiers only; expected unused on TOU-GS-2. The
  residential baseline credit is deliberately **not** modelled.
- **Real-time pricing.** Out of scope for v1 and rejected by schema validation:
  `TOU-GS-2-RTP` needs hourly market prices the engine cannot fetch.
- **`touPeriods`.** `on-peak` / `mid-peak` / `off-peak` are filled in on both
  drafts. Naming a period is not the same as pricing it — On-Peak and Mid-Peak are
  named directly in the secondary-source description of the TRD charge, which
  implies Off-Peak by complement — so this is safe to commit ahead of the full TOU
  table.
- **Which options, and which are excluded.** Options D and E for v1, per the
  product decision above; CPP variants and B/R excluded, not built speculatively.

## Corroborated vs. verified — the ratchet question

Requirement was to verify whether TOU-GS-2 has a demand ratchet before assuming it
does. **Two independent secondary sources** now describe the facilities-related
charge as the highest recorded demand in each monthly billing period, "regardless
of season, day of the week, or time of day" — with no ratchet language in either.
That is consistent with **no ratchet**.

This is recorded as **corroborated, not verified**: neither source is the tariff
sheet PDF, which CLAUDE.md treats as authoritative, and a web summary is not a
substitute for it. So:

- both drafts carry `"ratchets": []`, a claim about the sheet corroborated by two
  sources, pending primary confirmation from a PDF in `fixtures/tariff-sheets/`;
- the ratchet machinery is fully built and tested against a synthetic tariff
  (`packages/rating-engine/test/ratchet.test.ts` — 19 cases covering the lookback
  edge, current-month exclusion, both season scopes, and ratchets on both demand
  families), so whichever way this lands, no engine work is needed;
- if the PDF confirms no ratchet, this line moves to "verified and settled" as-is.
  If it turns up one, it needs a percentage, a lookback length, and whether a
  summer peak can floor a winter month.

## One more, smaller

`fixedCharges.dailyMinimumCharge` is for a sheet that lists an **additive**
per-day amount. If TOU-GS-2's daily minimum is a **floor** on the bill instead, it
belongs in `minimumBill` as `kind: "per-day"`. The two produce different bills for
a low-usage month, so I left the slot `null` rather than pick.

Also: only one power-factor method is modelled (`per-kvar-below-threshold`). That
form is generic, not transcribed from SCE, so `powerFactorAdjustment` is `null` on
both drafts. `LoadProfile` already carries optional `kvarh`/`kva`, so if the sheet
words its clause differently it is a new union member, not a breaking change.

## Future phases (not built yet, logged so the guidance isn't lost)

No Phase 5 planning document exists in this repo yet — Phase 1 scope is the schema
and engine only. For when a comparison engine is built: SCE largely assigns the
*schedule* by demand tier and auto-transfers customers across tiers, so the
schedule is mostly not a customer choice — the *option* is. The candidate set for
a given account should be every open option on their currently-eligible schedule,
plus adjacent schedules only where `eligibility.demandRules` would actually permit
a move (i.e. iterate over options within a schedule, not just across schedules).
Say if this should become its own tracked planning document.
