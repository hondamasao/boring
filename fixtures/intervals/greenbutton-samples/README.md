# Real Green Button / ESPI XML samples

Downloaded from the Green Button Alliance's public sample-data library
(`https://green-button.github.io/samples/` links to
`s3-us-west-2.amazonaws.com/technical.greenbuttonalliance.org/library/sample-data/`
— the `green-button.github.io` pages themselves 403 to automated fetches, same
bot protection pattern as `sce.com`; the underlying GitHub repo
(`github.com/green-button/green-button.github.io`) and the S3 bucket both fetch
fine). These are genuine, publicly published ESPI XML files, not fabricated by
this project.

**None of these are parsed or used by the engine.** `packages/greenbutton`
(CSV + ESPI XML parsers) is deliberately not built yet — see `pnpm-workspace.yaml`
and CLAUDE.md's repo layout. They're kept here as real reference examples of
what the engine will eventually need to ingest, and to prove the shape of a
genuine ESPI feed (Atom wrapper, `UsagePoint`/`MeterReading`/`IntervalBlock`/
`IntervalReading` structure, `ReadingType` unit-of-measure codes) rather than
something inferred from documentation alone.

## What each file actually is

### `cc_customer_11.xml` (27 MB)

Real, de-identified commercial building interval data from EnerNOC's 2012 open
dataset (`<!--Greenbutton data for customer 10 from file anon/csv/10.csv-->`,
`Copyright 2013 EnerNOC`), converted to ESPI XML for Green Button testing.

- **5-minute intervals**, full calendar year: **2012-01-01 to 2013-01-01**
  (105,407 `IntervalReading` elements — the `MeterReading` entry is titled
  "Five Minute Electricity Consumption").
- `ReadingType`: `uom=72` (Wh), `powerOfTenMultiplier=0`, `accumulationBehaviour=4`
  (each value is the energy consumed in that interval, i.e. genuine kWh-per-interval
  data once divided by 1000 — not an instantaneous power reading).
- `LocalTimeParameters.tzOffset = -14400` seconds = **UTC-4, Eastern time**, not
  Pacific. **This is not an SCE-territory building.**
- Observed values ranged roughly 85,700-410,000 Wh per 5-minute interval in a
  20,000-reading sample, i.e. **roughly 1,000-4,900 kW average demand** — a large
  commercial/industrial facility, nowhere near TOU-GS-2's 20-200 kW band. EnerNOC's
  public dataset skews toward the demand-response-eligible C&I portfolio they
  served, which is large buildings, not small restaurants.

**Bottom line: real ESPI structure, real interval values, wrong region, wrong
scale, wrong decade.** Useful for proving a parser can handle a genuine
full-year 5-minute feed; not usable as a stand-in for our target customer.

### `TestGBDataHourlyNineDaysBinnedDaily.xml` (66 KB)

An official NIST/SGIP reference sample (`Author: Ron Pasquarelli, Marty Burns
(Hypertek for NIST)`, `Copyright (c) 2012,2013 EnergyOS.org`, Apache 2.0
licensed), built specifically to demonstrate ESPI's *binning* — the same
underlying data represented at two granularities in one file.

- **216 hourly readings** (9 days x 24 hours, `duration=3600`) plus **9 daily
  readings** (`duration=86400`) binning those same 9 days, plus one summary
  block covering the whole span (`duration=2419200`, 28 days).
- Date range: readings start **2014-01-01**.
- Small and well-documented — good for understanding the binning/rollup
  convention structurally, not representative of a full year.

### `TestGBDataOneYearDailyBinnedMonthly.xml` (126 KB)

Sample data associated with a DOE Green Button data contest.

- **441 daily readings** (`duration=86400`) plus a handful of monthly summary
  blocks (`duration` ~28-31 days), spanning **2013-01-01 to 2014-02-01** —
  slightly over a full year, daily granularity throughout (no sub-daily
  intervals at all, so useless for TOU bucketing, but a good example of the
  coarser end of what a "Green Button" export can mean).

## Why not all of it, and why not cc_customer_12/13 too

The sample library's other two "Commercial Buildings" files
(`cc_customer_12.xml`, `cc_customer_13.xml`) are near-duplicates of
`cc_customer_11.xml` in size and structure (same EnerNOC dataset, same scale,
same era) — kept out to avoid adding another ~27 MB each to the repo for
essentially the same information. They're at the same S3 path
(`.../library/sample-data/cc_customer_12.xml` etc.) if ever needed.
