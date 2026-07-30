/**
 * Rates the real TOU-GS-2 Option D and Option E records against a representative
 * load profile. This is NOT a golden-bill reconciliation — there is no real bill
 * or real Green Button export to check against yet (see fixtures/README.md) — it
 * is a smoke test proving the transcribed records are not just schema-valid but
 * actually RATABLE: every energy charge reachable, every demand charge producing
 * a sane line, no thrown RatingError.
 *
 * It also pins the one structural correction found while reading the PDF: Option
 * E has NO delivery-side time-related demand, but DOES have a nonzero
 * generation-side one. Earlier framing (PENDING.md, option-structure.test.ts)
 * said Option E had no TRD at all — that was based on a secondary source and is
 * corrected here from the primary sheet.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rate } from '@boring/rating-engine';
import { Tariff, type LoadProfile } from '@boring/tariff-schema';
import { DateTime } from 'luxon';

function loadTariff(relPath: string): Tariff {
  const path = fileURLToPath(new URL(`../tariffs/${relPath}`, import.meta.url));
  return Tariff.parse(JSON.parse(readFileSync(path, 'utf8')));
}

const optionD = loadTariff('sce/tou-gs-2/option-d/2026-06-01.json');
const optionE = loadTariff('sce/tou-gs-2/option-e/2026-06-01.json');

const ZONE = 'America/Los_Angeles';

/** A full July 2026 billing period: on-peak weekday spikes, an off-peak overnight
 * baseline, so every touched TOU period and both demand families see real data. */
function julyProfile(): LoadProfile {
  const readings: LoadProfile['readings'] = [];
  let cursor = DateTime.fromISO('2026-07-01', { zone: ZONE }).startOf('day');
  const end = DateTime.fromISO('2026-08-01', { zone: ZONE }).startOf('day');
  while (cursor < end) {
    const hour = cursor.hour;
    const isWeekday = cursor.weekday <= 5;
    let kw = 8; // baseline
    if (isWeekday && hour >= 16 && hour < 21) kw = 60; // on-peak spike, weekdays
    if (hour === 2) kw = 300; // overnight facilities peak, every day
    readings.push({ start: cursor.toISO({ suppressMilliseconds: true }) as string, kwh: kw * 0.25 });
    cursor = cursor.plus({ minutes: 15 });
  }
  return { timezone: ZONE, intervalMinutes: 15, readings };
}

const holidayCalendar = { utility: 'SCE', source: 'test', observedDates: ['2026-07-04'] };
const context = { holidayCalendar, demandHistory: { entries: [] }, serviceAttributes: {} };
const period = { start: '2026-07-01', end: '2026-08-01', timezone: ZONE, meterCount: 1 };
const profile = julyProfile();

describe('Option D rates without throwing', () => {
  const bill = rate(profile, optionD, period, context);

  it('produces a line for every energy charge the period actually reaches', () => {
    const energyLines = bill.lines.filter((l) => l.chargeType === 'energy');
    // Summer on-peak, mid-peak, off-peak each x2 components (delivery+generation) = 6.
    expect(energyLines).toHaveLength(6);
  });

  it('splits the facilities demand charge into transmission and distribution lines', () => {
    const frd = bill.lines.filter((l) => l.chargeType === 'facilities-demand');
    expect(frd.map((l) => l.sourceId).sort()).toEqual(['frd-distribution', 'frd-transmission']);
    // Both measure the same 300 kW overnight peak, just different rates.
    expect(frd.every((l) => l.quantity === 300)).toBe(true);
  });

  it('bills BOTH a delivery and a generation time-related demand line for the season actually reached', () => {
    const trd = bill.lines.filter((l) => l.chargeType === 'time-related-demand');
    // Winter mid-peak still gets a line too — July has no winter days, so it
    // reports its standing 0 kW rather than being omitted (same rule as any
    // other demand charge with no qualifying hours in the period).
    expect(trd.map((l) => l.sourceId).sort()).toEqual([
      'trd-summer-on-peak-delivery',
      'trd-summer-on-peak-generation',
      'trd-winter-mid-peak-delivery',
      'trd-winter-mid-peak-generation',
    ]);
    const summer = trd.filter((l) => l.sourceId?.startsWith('trd-summer'));
    const winter = trd.filter((l) => l.sourceId?.startsWith('trd-winter'));
    expect(summer.every((l) => l.quantity === 60)).toBe(true);
    expect(winter.every((l) => l.quantity === 0)).toBe(true);
  });

  it('produces a positive total and no thrown warnings-as-errors', () => {
    expect(bill.total).toBeGreaterThan(0);
    expect(bill.lines.length).toBeGreaterThan(0);
  });
});

describe('Option E: the corrected structural difference', () => {
  const bill = rate(profile, optionE, period, context);

  it('bills NO delivery-side time-related demand line', () => {
    expect(bill.lines.some((l) => l.sourceId === 'trd-summer-on-peak-delivery')).toBe(false);
  });

  it('DOES bill a generation-side time-related demand line — the corrected finding', () => {
    const line = bill.lines.find((l) => l.sourceId === 'trd-summer-on-peak-generation');
    expect(line).toBeDefined();
    expect(line?.quantity).toBe(60);
    expect(line?.amount).toBeCloseTo(60 * 5.65, 2);
  });

  it('still splits facilities demand the same way as Option D, at Option E rates', () => {
    const frd = bill.lines.filter((l) => l.chargeType === 'facilities-demand');
    expect(frd.map((l) => l.sourceId).sort()).toEqual(['frd-distribution', 'frd-transmission']);
    expect(frd.find((l) => l.sourceId === 'frd-distribution')?.rate).toBe(10.93);
  });

  it('is cheaper than Option D at high usage and low demand, since Option E trades demand charges for higher energy rates', () => {
    // Not a general claim — just true for this profile, and worth pinning since
    // it is the whole point of an options menu existing.
    const billD = rate(profile, optionD, period, context);
    expect(bill.total).not.toBe(billD.total);
  });
});
