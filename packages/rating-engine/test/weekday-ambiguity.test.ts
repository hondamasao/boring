/**
 * `weekdaysOnly` on a time-related demand charge, and the ambiguity-detection
 * mechanism that goes with it.
 *
 * Found reading the real TOU-GS-2 PDF: Special Condition 1's TOU table defines
 * winter Mid-Peak as applying every day, including weekends — but the rate
 * table's TRD row for that exact period is labeled "Mid-peak - Weekdays
 * (4-9pm)". The document does not say which section governs. Rather than pick
 * silently, the schema records a chosen interpretation (`weekdaysOnly`,
 * required, no default — same discipline as
 * `EligibilityRule.windowIncludesCurrentMonth`), and the engine additionally
 * computes what the OTHER reading would have measured, warning whenever the
 * two disagree.
 */
import { describe, expect, it } from 'vitest';
import { rate } from '@boring/rating-engine';
import { buildProfile, emptyContext, flatWithSpikes, period, tariffWithWinterWeekendPeak } from './helpers/profile.js';
import { demandLine, describeBill, determination } from './helpers/lines.js';

// A January week: Mon Jan 5 - Sun Jan 11, 2026 (winter). tariffWithWinterWeekendPeak
// gives winter Mid-Peak (4-9pm) on every day of this week, weekday or weekend.
const START = '2026-01-05';
const END = '2026-01-12';

function tariffWithWeekdaysOnlyWinterTrd(weekdaysOnly: boolean) {
  const base = tariffWithWinterWeekendPeak();
  return {
    ...base,
    demandCharges: {
      ...base.demandCharges,
      timeRelated: [
        ...base.demandCharges.timeRelated,
        {
          kind: 'time-related' as const,
          id: 'trd-winter-mid-peak-test',
          label: 'Winter Mid-Peak Time-Related Demand (test)',
          seasonId: 'winter',
          periodId: 'mid-peak',
          component: 'delivery' as const,
          ratePerKw: 10,
          measuredOver: 'billing-period' as const,
          weekdaysOnly,
          citation: 'test',
        },
      ],
    },
  };
}

// The weekend spike (Sat Jan 10, mid-peak window) is bigger than the weekday
// spike (Wed Jan 7, mid-peak window) — 60 kW vs 40 kW — so which one wins
// depends entirely on whether weekends are excluded.
const WEEKDAY_SPIKE_AT = '2026-01-07T17:00:00-08:00'; // Wednesday, 5pm
const WEEKEND_SPIKE_AT = '2026-01-10T17:00:00-08:00'; // Saturday, 5pm
const profile = buildProfile({
  start: START,
  end: END,
  kwh: flatWithSpikes(1, { [WEEKDAY_SPIKE_AT]: 10, [WEEKEND_SPIKE_AT]: 15 }), // 40 kW / 60 kW
});

describe('weekdaysOnly=true excludes weekend windows from the search', () => {
  const bill = rate(profile, tariffWithWeekdaysOnlyWinterTrd(true), period(START, END), emptyContext());
  const line = demandLine(bill, 'trd-winter-mid-peak-test');
  const d = determination(bill, 'trd-winter-mid-peak-test');

  it('bills off the weekday peak, not the larger weekend one', () => {
    expect(line.quantity).toBe(40);
    expect(line.amount).toBe(400);
  });

  it('reports the ambiguity: the other reading would have measured the weekend peak', () => {
    expect(d.weekdayAmbiguity).toEqual({ chosenWeekdaysOnly: true, chosenPeakKw: 40, otherPeakKw: 60 });
  });

  it('adds an AMBIGUOUS note on the line itself', () => {
    expect(line.notes?.some((n) => n.startsWith('AMBIGUOUS:'))).toBe(true);
    expect(line.notes?.join(' ')).toContain('40');
    expect(line.notes?.join(' ')).toContain('60');
  });

  it('emits a bill-level warning telling the reader to verify against SCE', () => {
    expect(bill.warnings.some((w) => w.includes('trd-winter-mid-peak-test') && w.includes('Verify against SCE'))).toBe(true);
  });
});

describe('weekdaysOnly=false includes the weekend window', () => {
  const bill = rate(profile, tariffWithWeekdaysOnlyWinterTrd(false), period(START, END), emptyContext());
  const line = demandLine(bill, 'trd-winter-mid-peak-test');
  const d = determination(bill, 'trd-winter-mid-peak-test');

  it('bills off the larger weekend peak', () => {
    expect(line.quantity).toBe(60);
    expect(line.amount).toBe(600);
  });

  it('still reports the ambiguity — the other reading is now the SMALLER weekday-only peak', () => {
    expect(d.weekdayAmbiguity).toEqual({ chosenWeekdaysOnly: false, chosenPeakKw: 60, otherPeakKw: 40 });
  });
});

describe('no ambiguity when both readings agree', () => {
  it('reports no ambiguity when the weekday peak already dominates', () => {
    // Only a weekday spike this time — restricting to weekdays changes nothing.
    const weekdayOnlyProfile = buildProfile({
      start: START,
      end: END,
      kwh: flatWithSpikes(1, { [WEEKDAY_SPIKE_AT]: 10 }),
    });
    const bill = rate(weekdayOnlyProfile, tariffWithWeekdaysOnlyWinterTrd(true), period(START, END), emptyContext());
    const d = determination(bill, 'trd-winter-mid-peak-test');
    expect(d.weekdayAmbiguity).toBeNull();
    expect(bill.warnings.some((w) => w.includes('trd-winter-mid-peak-test'))).toBe(false);
  });

  it("facilities charges never carry the field — the flag doesn't exist for them", () => {
    const bill = rate(profile, tariffWithWeekdaysOnlyWinterTrd(true), period(START, END), emptyContext());
    expect(determination(bill, 'frd').weekdayAmbiguity).toBeNull();
  });

  it('the default synthetic on-peak charge (weekdaysOnly=false, already weekday-only by its own period) reports no ambiguity', () => {
    // trd-summer-on-peak's period is only ever assigned on weekdays in the
    // first place, so restricting further can never change anything.
    const bill = rate(profile, tariffWithWeekdaysOnlyWinterTrd(true), period(START, END), emptyContext());
    expect(determination(bill, 'trd-summer-on-peak').weekdayAmbiguity).toBeNull();
  });
});

describe('sums correctly either way', () => {
  it('does not break the itemization invariant', () => {
    const bill = rate(profile, tariffWithWeekdaysOnlyWinterTrd(true), period(START, END), emptyContext());
    const cents = bill.lines.reduce((sum, l) => sum + Math.round(l.amount * 100), 0);
    expect(cents / 100, describeBill(bill)).toBeCloseTo(bill.total, 9);
  });
});
