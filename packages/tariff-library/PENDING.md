# TOU-GS-2 — fields still needed from the tariff sheet

`tariffs/sce/tou-gs-2/DRAFT-unverified.json` **does not validate**, on purpose. It
is a skeleton with every field I could fill from structure alone, and `null` where
a value would have to be guessed. `test/draft.test.ts` asserts that it still fails
and that its errors are exactly the ones listed here — so filling a field in makes
that test fail with "PENDING is stale", and adding a *new* kind of error also
fails. It cannot rot quietly in either direction.

Nothing in the draft is a placeholder rate. There are no invented numbers to
forget to remove.

## Blocking — the engine cannot rate TOU-GS-2 until these are read off the sheet

| # | Field | What I need |
|---|---|---|
| 1 | `seasons[].start/end` | Confirm summer is June 1 – September 30 and winter October 1 – May 31 for this schedule and revision. |
| 2 | `touRules` | The full TOU table: hour boundaries per season and day type. I have "4 p.m. – 9 p.m. summer weekdays excluding holidays" from SCE's rate summary, but not the winter table, not the weekend treatment, and not whether there is a winter super-off-peak. |
| 3 | `holidayTreatment.mapsToDayType` | Does a holiday take the **Sunday schedule** (still mid-peak in summer) or become **off-peak around the clock**? Both are implemented; the field decides. Also: the tariff's holiday **list** — SCE's excludes some federal holidays — goes into a calendar file under `fixtures/holidays/`, not here. |
| 4 | `energyCharges[].pricing.ratePerKwh` | Rates per season × period × component. |
| 5 | `demandCharges.facilities[].ratePerKw` | The facilities-related rate. |
| 6 | `demandCharges.facilities[].measuredOver` | For a billing period straddling June 1: **one** maximum for the period, or a **separate** maximum per season segment at each season's rate? Both implemented. |
| 7 | `demandCharges.timeRelated` | Does the option you are targeting have time-related demand at all? Per SCE's rate summary, Option E has facilities-related demand and **no** time-related demand — see the note on options below. If it does, one entry per season × period with its rate. |
| 8 | `fixedCharges.customerCharge` | Amount and basis — per month, or per day, or per meter per day. |
| 9 | `minimumBill` | Which of the three forms: a per-day floor, a per-month floor, or "the customer charge plus the facilities-related demand charge" (`charge-floor`)? And is the comparison made **before or after** taxes and per-kWh riders (`comparisonScope.includeStages`)? |
| 10 | `riders` | Which riders appear, each with its basis. For the percent-of-subtotal ones I need the **base**: which stages it taxes, and whether it includes generation (it must not, for a CCA customer) and the minimum-bill make-up amount. |
| 11 | `eligibility.demandRules[].windowIncludesCurrentMonth` | Does "any three months of the preceding twelve" **count the month being billed**? The two readings disagree for exactly the customer a recommendation is about — one who has just crossed 200 kW. |
| 12 | `provenance` | Sheet number, effective date, and the direct PDF URL. Put the PDF in `fixtures/tariff-sheets/`. |

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

## Two things I found while building this

### TOU-GS-2 is published as several rate options, and they differ structurally

Per [SCE's summary of available rates][rates], **Option E carries
facilities-related demand charges and no time-related demand charges**. That means
"TOU-GS-2" is not one tariff record — each option is its own record, because they
do not merely differ in rates, they differ in which charge families exist.

The schema therefore has `optionCode` alongside `scheduleCode`, and the draft
leaves it `null` pending a decision on **which option to target first**. Rating a
customer on Option A's structure when they are on Option E would invent a demand
charge they do not pay, or drop one they do.

**I need to know which option.** If it is several, that is several records.

### The ratchet question — I could not verify it from the primary source

You asked me to verify whether TOU-GS-2 actually has a demand ratchet before
assuming it does. **I could not confirm this from the tariff sheet.** `sce.com`
returns HTTP 403 to my fetcher, so I could not retrieve
`ELECTRIC_SCHEDULES_TOU-GS-2.pdf` or the `-RTP` variant.

What I have is secondary: SCE's own rate-options summary describes the
facilities-related charge as applying to "the highest recorded demand during each
monthly billing period, regardless of season, day of the week, or time of day",
with no ratchet language. That is consistent with **no ratchet**, and consistent
with your expectation that ratchets are more common on TOU-8, standby and
transmission-level schedules.

That is not good enough to write down. Per CLAUDE.md the authoritative source is
the published sheet PDF, so:

- the draft carries `"ratchets": []`, which in this schema is a **claim about the
  sheet**, not an unimplemented feature;
- the ratchet machinery is fully built and tested against a synthetic tariff
  (`packages/rating-engine/test/ratchet.test.ts` — 19 cases covering the lookback
  edge, current-month exclusion, both season scopes, and ratchets on both demand
  families), so whichever way this lands, no engine work is needed;
- **please confirm from the sheet you have.** If there is a ratchet, it needs a
  percentage, a lookback length, and whether a summer peak can floor a winter
  month.

### One more, smaller

`fixedCharges.dailyMinimumCharge` is for a sheet that lists an **additive**
per-day amount. If TOU-GS-2's daily minimum is a **floor** on the bill instead, it
belongs in `minimumBill` as `kind: "per-day"`. The two produce different bills for
a low-usage month, so I left the slot `null` rather than pick.

Also: only one power-factor method is modelled
(`per-kvar-below-threshold`). That form is generic, not transcribed from SCE, so
`powerFactorAdjustment` is `null`. `LoadProfile` already carries optional
`kvarh`/`kva`, so if the sheet words its clause differently it is a new union
member, not a breaking change.

[rates]: https://www.sce.com/sites/default/files/custom-files/PDF_Files/2025_Summary_of_Available_Residential_and_Nonresidential_Rates.pdf
