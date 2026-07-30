# TOU-GS-2 — status

`tariffs/sce/tou-gs-2/option-d/2026-06-01.json` and `.../option-e/2026-06-01.json`
are now **fully transcribed from the primary source**:
`fixtures/tariff-sheets/ELECTRIC_SCHEDULES_TOU-GS-2.pdf` (21 pages, downloaded by
the user, committed to the repo — no more `sce.com` fetch attempts, ever).

Both records **validate** against the schema and **rate real load profiles
without throwing** (`test/rate-real-records.test.ts`). They are **not yet signed
off by a human**: `provenance.verifiedBy` on both says `PENDING HUMAN REVIEW` —
every numeric field cites its exact sheet and row so a cross-check is fast, but
nobody has done it yet. `test/draft.test.ts` prints which records are in this
state on every run so a green suite can't be mistaken for "ready to bill a real
customer."

## Two things this reading corrected

**1. Option E is not "FRD only."** Its delivery-side time-related demand rate is
$0.00/kW (so no delivery TRD line is billed), but a **nonzero generation-side**
TRD rate still applies for Bundled Service Customers: **$5.65/kW** summer
on-peak, **$2.18/kW** winter mid-peak (Sheet 5 Rates table, UG column). Earlier
framing — mine, from a secondary source, and repeated in the previous version of
this file and in `option-structure.test.ts`'s docstring — said Option E had no
TRD at all. That was wrong. Both are updated.

**2. The ratchet question is now fully verified, not merely corroborated.** I
searched the whole 21-page document case-insensitively for "minimum," "ratchet,"
and "power factor." **None appear** in any billing-relevant context. The one
"prior billing month's Maximum Demand" reference in the document (Sheet 15–16,
Special Condition 14) is unrelated to billing — it is a 5%-of-prior-peak
allowance and a 20%-of-prior-peak compliance threshold for **rotating-outage load
reduction** on sub-transmission customers, a demand-response-adjacent program
out of scope per CLAUDE.md. So: **TOU-GS-2 has no demand ratchet, no minimum
bill, and no power-factor adjustment.** All three are `[]`/`null` on both
records, verified rather than corroborated.

## Verified from the primary source

| Field | Value | Citation |
|---|---|---|
| Seasons | Summer Jun 1 – Sep 30; Winter Oct 1 – May 31 | Sheet 9, Special Condition 1 (continued) |
| TOU table | 8 rules; see records — On-Peak only exists summer weekdays 4-9pm; Mid-Peak is 4-9pm every other day/season; Off-Peak and Super-Off-Peak fill the rest, winter only has a Super-Off-Peak (8am-4pm) | Sheet 8, Special Condition 1 table |
| Holidays | 8 fixed/nth-weekday holidays, Sunday→Monday shift, **no shift for Saturday** | Sheet 8/20; computed for 2026 in `fixtures/holidays/sce-2026.json` |
| Holiday treatment | Holiday takes the weekend schedule (Sat and Sun are identical on this tariff, so which one `mapsToDayType` points at doesn't matter) | Sheet 8 table: one combined "Weekends and Holidays" column |
| Demand window | 15 min, 5 min for intermittent/violent-fluctuation load (account-level, `ServiceAttributes.demandWindowMinutesOverride`) | Sheet 11, Special Condition 5 |
| `measuredOver` | `billing-period` for both FRD and TRD — Special Condition 6 says FRD is measured "for the monthly billing period" and TRD "for each of the TOU Periods," neither mentions per-season-segment splitting | Sheet 11, Special Condition 6 |
| Energy, demand, customer charge rates | Transcribed exactly; see the records | Sheet 4 (Option D), Sheet 5 (Option E) |
| Two riders schedule-wide | Fixed Recovery Charge ($0.00483/kWh, wildfire recovery bonds) and MCAM Charge ($0.00178/kWh) | Sheet 4/5 Rates + Sheet 21 (FRC), footnote 12 (MCAM) |
| No ratchet / no minimum bill / no power factor clause | Confirmed absent, whole-document search | throughout |
| Eligibility thresholds | 20 kW / 200 kW, transfer targets TOU-GS-1 / TOU-GS-3 | Sheet 1, Applicability |
| voltageLevels | Not restricted in Applicability; Rates section prices voltage discounts up to 220 kV, so all four levels are listed rather than assumed secondary-only | Sheet 1 (silent on voltage), Sheet 4/5 (voltage discount rows) |

## Still needs your confirmation — interpretation, not missing data

Both of these are read directly off Sheet 1, but the wording is genuinely
ambiguous and I'm not willing to silently pick one reading given CLAUDE.md's
explicit warning that this is exactly the customer a recommendation is about.

1. **`reached-200-kw-in-three-of-twelve`**: *"...has reached 200 kW for any three
   months during the **preceding** 12 months..."* — I read "preceding" as
   excluding the month being billed (`windowIncludesCurrentMonth: false`).
2. **`at-or-below-20-kw-for-twelve-consecutive`**: *"...has registered 20 kW or
   less for 12 consecutive months..."* — no "preceding" qualifier here, unlike
   rule 1, so I read the just-billed month as the last of the 12
   (`windowIncludesCurrentMonth: true`).

Both citations quote the exact sentence and my reasoning inline on the record
itself (`eligibility.demandRules[].citation`). **Please confirm both readings.**

## New engine/schema gaps found while transcribing (not fixed here — this was a data task)

1. **Billing demand is rounded to the nearest whole kW before the rate is
   applied.** Sheet 11, Special Condition 6: *"The Billing Demand shall be the
   kW of Maximum Demand, determined to the nearest kW."* The engine currently
   rounds only the resulting dollar amount to cents — it does not round
   `billedKw` itself to an integer first. For a demand charge at, say, $23/kW,
   a measured 47.6 kW currently bills as 47.6 × 23 = $1094.80; per the sheet it
   should round to 48 kW first, billing $1104.00. **This is a real discrepancy
   against real bills** and needs an engine change (tests before implementation,
   per CLAUDE.md), not a data fill. Flagging rather than fixing since this task
   was scoped to transcription.
2. **A TRD row label says "Weekdays" even though the underlying TOU period
   applies on all days.** Sheet 4's winter TRD row is titled *"Mid-peak -
   Weekdays (4-9pm)"*, but Sheet 8's TOU table has winter Mid-Peak apply on
   *every* day including weekends and holidays. I modeled winter TRD as applying
   whenever the Mid-Peak period occurs (matching Special Condition 6, "for each
   of the TOU Periods"), treating "(Weekdays)" as describing when those hours
   fall rather than as a further restriction. **Please confirm** — if TRD really
   is weekdays-only despite the broader period, that's a third kind of demand
   scoping (period AND day-type together) the schema doesn't express yet and
   would need a schema change.
3. **Conditional/account-level charges are known but not modeled**, because each
   needs an account attribute or eligibility flag the schema doesn't have yet:
   - TOU Option Meter Charge (RTEM), $40.79/meter/month — needs a "customer
     elected RTEM" flag.
   - California Climate Credit, -$36.00/meter, April & October bills only, for
     "Small Business Customers" (≤20 kW in ≥9 of the preceding 12 months) —
     needs month-conditional riders, which don't exist. Sheet 13 does state its
     position in the stage order precisely though: applied **after** city/county
     utility users' taxes, **before** franchise fees.
   - Single Phase Service credit, -$9.30/month — needs a phase attribute on
     `ServiceAttributes`.
   - Voltage discounts, 2 kV to 220 kV — every tier starts at 2 kV, so a v1
     customer at standard secondary voltage gets $0 here regardless; likely
     irrelevant for the target audience rather than a real gap, but flagged.
   - CARE (32.5%) and Food Bank (20%) discounts — both need an enrollment flag.
   - City/county utility users' tax and franchise fees are **not part of this
     schedule at all** — confirmed absent from the document; they're
     jurisdiction-specific and belong in a separate rider once the customer's
     city is known.

## What's genuinely still open

- **Direct Access / CCA generation modeling.** Sheet 12 confirms Delivery is
  always billed per this schedule; Generation for DA customers comes from
  Schedule DA-CRS, for CCA customers from Schedule CCA-CRS. Neither is
  transcribed. The `generation`-component lines on these records apply to
  Bundled Service Customers only — noted in each record's `notes`.
- **A real bill and real Green Button interval data**, to actually reconcile
  against (CLAUDE.md invariant #2). Nothing above can be upgraded from "rates
  without throwing" to "reproduces a real bill" without one.
- **A human cross-check** of both records against the PDF — `verifiedBy` says so
  explicitly on both, and will keep printing in test output until it's done.

## Options excluded from v1 (unchanged from before, now confirmed present in the sheet)

- **CPP variants** (Option D-CPP, the *default* option per Sheet 1 — note this,
  it means most real customers are NOT on plain Option D) and Option B-CPP —
  need a critical-peak event calendar this repo doesn't have.
- **Options B, B-CPP, R** — "Discontinued TOU Periods," closed to new
  enrollment, kept only for grandfathered solar/NEM customers (Sheet 2). Their
  rates are on Sheet 6-7 if a grandfathered customer's real bill ever needs one;
  not built speculatively.

## `fixtures/holidays/sce-2026.json`

Real (not synthetic) SCE holiday calendar for calendar year 2026, computed from
the Sheet 8 rule. Worth noting: **the synthetic fixture**
(`fixtures/holidays/synthetic-sce-2026.json`) lists July 3 as the observed
Independence Day — that was a plausible-looking placeholder chosen before this
PDF was read, and it's wrong for the real rule: July 4, 2026 is a **Saturday**,
and the sheet is explicit that holidays falling on Saturday are **not** shifted.
The synthetic fixture is explicitly synthetic and this doesn't affect any test's
correctness, but it's worth knowing the placeholder date doesn't match reality.
