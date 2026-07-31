import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HolidayCalendar, NO_HOLIDAYS, Tariff } from '@boring/tariff-schema';

/** apps/web always runs with its own directory as cwd (matches lib/storage.ts's
 * `.data` path), so two levels up is the repo root. tariff-library ships no
 * compiled package (data only, per its package.json) — reading its JSON
 * straight off disk is the same thing the tariff-library test suite does. */
const REPO_ROOT = path.join(/*turbopackIgnore: true*/ process.cwd(), '..', '..');

function readJson(relPath: string): unknown {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relPath), 'utf8'));
}

export interface TouGs2Options {
  optionD: Tariff;
  optionE: Tariff;
}

let cachedOptions: TouGs2Options | null = null;

/** The two TOU-GS-2 records this beta compares. Loaded once per server
 * process — the files never change while the process is running. */
export function loadTouGs2Options(): TouGs2Options {
  if (cachedOptions === null) {
    cachedOptions = {
      optionD: Tariff.parse(readJson('packages/tariff-library/tariffs/sce/tou-gs-2/option-d/2026-06-01.json')),
      optionE: Tariff.parse(readJson('packages/tariff-library/tariffs/sce/tou-gs-2/option-e/2026-06-01.json')),
    };
  }
  return cachedOptions;
}

let cached2026Holidays: HolidayCalendar | null = null;

function sce2026Holidays(): HolidayCalendar {
  if (cached2026Holidays === null) {
    cached2026Holidays = HolidayCalendar.parse(readJson('fixtures/holidays/sce-2026.json'));
  }
  return cached2026Holidays;
}

/**
 * The only real (non-synthetic) holiday calendar this repo has is for 2026.
 * A billing period outside 2026 gets the empty sentinel instead of a guessed
 * calendar — every day rates on its plain calendar day type, which is a
 * known, disclosed gap rather than a fabricated one. See the report page for
 * where this shows up in `assumptions`.
 */
export function holidayCalendarFor(periodStartIsoDate: string): HolidayCalendar {
  return periodStartIsoDate.startsWith('2026') ? sce2026Holidays() : NO_HOLIDAYS;
}
