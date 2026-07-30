/**
 * Eligibility — history-dependent, and product-critical.
 *
 * Recommending a schedule the customer is then transferred off of is worse than
 * making no recommendation, so every rule that fires names the schedule the
 * customer would be moved TO. Rules that cannot be evaluated are reported as
 * unevaluated, never treated as satisfied.
 *
 * The engine WARNS; it does not throw. A customer on the wrong schedule still has
 * a real bill, and refusing to produce it would hide the finding.
 */
import { describe, expect, it } from 'vitest';
import { rate } from '@boring/rating-engine';
import type { DemandHistory, Tariff } from '@boring/tariff-schema';
import { makeSyntheticTariff, syntheticTouGs2EligibilityRules } from '@boring/tariff-schema/testing';
import { buildProfile, emptyContext, flat, period } from './helpers/profile.js';

const START = '2026-07-06';
const END = '2026-07-11';
// Flat 1 kWh per quarter-hour gives a 4 kW account maximum for the month billed.
const profile = buildProfile({ start: START, end: END, kwh: flat(1) });

const gs2Tariff = (): Tariff =>
  makeSyntheticTariff({
    scheduleCode: 'TOU-GS-2',
    eligibility: {
      voltageLevels: ['secondary'],
      customerClasses: ['general-service'],
      demandRules: syntheticTouGs2EligibilityRules(),
    },
  });

function monthsBack(count: number, peakKw: number, from = '2026-06'): DemandHistory['entries'] {
  const entries: DemandHistory['entries'] = [];
  let [year, month] = from.split('-').map(Number) as [number, number];
  for (let i = 0; i < count; i += 1) {
    entries.push({
      month: `${year}-${String(month).padStart(2, '0')}`,
      seasonId: month >= 6 && month <= 9 ? 'summer' : 'winter',
      facilitiesPeakKw: peakKw,
      timeRelatedPeaksKw: {},
    });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return entries;
}

function billWith(entries: DemandHistory['entries'], serviceAttributes = {}) {
  return rate(
    profile,
    gs2Tariff(),
    period(START, END),
    emptyContext({ demandHistory: { entries }, serviceAttributes }),
  );
}

describe('reaching the upper threshold in enough months', () => {
  it('names TOU-GS-3 when three of the preceding twelve months hit 200 kW', () => {
    const result = billWith([
      ...monthsBack(3, 250, '2026-06'),
      ...monthsBack(3, 50, '2026-03'),
    ]);

    const finding = result.diagnostics.eligibility.findings.find(
      (f) => f.ruleId === 'above-200-kw-three-of-twelve',
    );
    expect(finding).toBeDefined();
    expect(finding?.transferTo).toBe('TOU-GS-3');
    expect(finding?.detail).toContain('3');
    expect(result.warnings.some((w) => w.includes('TOU-GS-3'))).toBe(true);
  });

  it('does not fire on two qualifying months', () => {
    const result = billWith([...monthsBack(2, 250, '2026-06'), ...monthsBack(4, 50, '2026-04')]);
    expect(
      result.diagnostics.eligibility.findings.some((f) => f.ruleId === 'above-200-kw-three-of-twelve'),
    ).toBe(false);
  });

  it('counts the month being billed when the rule says to', () => {
    // Two prior months at 250 kW plus a current month over the threshold makes
    // three. This is the customer a recommendation is actually about.
    const highProfile = buildProfile({ start: START, end: END, kwh: flat(60) });
    const result = rate(
      highProfile,
      gs2Tariff(),
      period(START, END),
      emptyContext({ demandHistory: { entries: monthsBack(2, 250, '2026-06') } }),
    );

    expect(result.diagnostics.accountMaxDemandKw).toBeCloseTo(240, 9);
    expect(
      result.diagnostics.eligibility.findings.some((f) => f.ruleId === 'above-200-kw-three-of-twelve'),
    ).toBe(true);
  });

  it('ignores a qualifying month outside the window', () => {
    // 2025-06 is thirteen months before 2026-07, outside a twelve-month window
    // that includes the current month.
    const result = billWith([
      ...monthsBack(2, 250, '2026-06'),
      { month: '2025-06', seasonId: 'summer', facilitiesPeakKw: 250, timeRelatedPeaksKw: {} },
    ]);
    expect(
      result.diagnostics.eligibility.findings.some((f) => f.ruleId === 'above-200-kw-three-of-twelve'),
    ).toBe(false);
  });
});

describe('falling below the lower threshold for long enough', () => {
  it('names TOU-GS-1 after twelve consecutive months at or below 20 kW', () => {
    // Eleven prior months at 10 kW plus the current month at 4 kW is twelve.
    const result = billWith(monthsBack(11, 10, '2026-06'));

    const finding = result.diagnostics.eligibility.findings.find(
      (f) => f.ruleId === 'at-or-below-20-kw-twelve-consecutive',
    );
    expect(finding).toBeDefined();
    expect(finding?.transferTo).toBe('TOU-GS-1');
    expect(result.warnings.some((w) => w.includes('TOU-GS-1'))).toBe(true);
  });

  it('does not fire when one month in the run is above the threshold', () => {
    const entries = monthsBack(11, 10, '2026-06');
    entries[5] = { ...entries[5]!, facilitiesPeakKw: 45 };
    const result = billWith(entries);
    expect(
      result.diagnostics.eligibility.findings.some((f) => f.ruleId === 'at-or-below-20-kw-twelve-consecutive'),
    ).toBe(false);
  });

  it('reports a gap in the run as unevaluated rather than satisfied', () => {
    // A missing month must never read as a quiet pass — that is how a customer
    // gets moved to a schedule they were never actually eligible for.
    const entries = monthsBack(11, 10, '2026-06').filter((e) => e.month !== '2025-12');
    const result = billWith(entries);

    expect(
      result.diagnostics.eligibility.findings.some((f) => f.ruleId === 'at-or-below-20-kw-twelve-consecutive'),
    ).toBe(false);
    const unevaluated = result.diagnostics.eligibility.unevaluatedRules.find(
      (r) => r.ruleId === 'at-or-below-20-kw-twelve-consecutive',
    );
    expect(unevaluated).toBeDefined();
    expect(unevaluated?.reason).toContain('2025-12');
  });

  it('reports too little history as unevaluated', () => {
    const result = billWith(monthsBack(3, 10, '2026-06'));
    expect(
      result.diagnostics.eligibility.unevaluatedRules.some(
        (r) => r.ruleId === 'at-or-below-20-kw-twelve-consecutive',
      ),
    ).toBe(true);
  });
});

describe('the forward-looking rule', () => {
  it('fires on a declared expectation', () => {
    const result = billWith([], { expectedMaxDemandKw: 250 });
    const finding = result.diagnostics.eligibility.findings.find(
      (f) => f.ruleId === 'expected-to-reach-200-kw',
    );
    expect(finding?.transferTo).toBe('TOU-GS-3');
  });

  it('does not fire on an expectation below the threshold', () => {
    const result = billWith([], { expectedMaxDemandKw: 150 });
    expect(
      result.diagnostics.eligibility.findings.some((f) => f.ruleId === 'expected-to-reach-200-kw'),
    ).toBe(false);
  });

  it('is unevaluated with no declared expectation, since meter data cannot supply it', () => {
    const result = billWith([]);
    expect(
      result.diagnostics.eligibility.unevaluatedRules.some((r) => r.ruleId === 'expected-to-reach-200-kw'),
    ).toBe(true);
  });
});

describe('static service attributes', () => {
  it('warns when the voltage level is not one the schedule serves', () => {
    const result = billWith([], { voltageLevel: 'transmission' });
    expect(result.warnings.some((w) => w.includes('transmission') && w.includes('voltage'))).toBe(true);
  });

  it('warns when the customer class is not one the schedule serves', () => {
    const result = billWith([], { customerClass: 'agricultural' });
    expect(result.warnings.some((w) => w.includes('agricultural'))).toBe(true);
  });

  it('says nothing when the attributes match', () => {
    const result = billWith([], { voltageLevel: 'secondary', customerClass: 'general-service' });
    expect(result.warnings.some((w) => w.includes('voltage'))).toBe(false);
  });
});

describe('the ambiguous zone: contested readings of "preceding" get a warning, not a flat verdict', () => {
  // The synthetic TOU-GS-2 eligibility rules (packages/tariff-schema/src/testing)
  // set windowIncludesCurrentMonth: true for both history-dependent rules. These
  // tests sit a customer exactly on the boundary where the OTHER reading
  // (excluding the current month) would answer differently, and confirm the
  // engine says so explicitly rather than picking one answer silently.

  it('flags the 200 kW rule when 2 prior qualifying months plus a qualifying current month disagree with the other reading', () => {
    // Chosen reading (windowIncludesCurrentMonth: true): 2 prior + this month's
    // 240 kW = 3 qualifying months -> FIRES.
    // Other reading (false, "preceding" excludes this month): only the 2 prior
    // months qualify -> does NOT fire. That disagreement is the ambiguous zone.
    const highProfile = buildProfile({ start: START, end: END, kwh: flat(60) });
    const result = rate(
      highProfile,
      gs2Tariff(),
      period(START, END),
      emptyContext({ demandHistory: { entries: monthsBack(2, 250, '2026-06') } }),
    );

    expect(
      result.diagnostics.eligibility.findings.some((f) => f.ruleId === 'above-200-kw-three-of-twelve'),
    ).toBe(true);
    expect(
      result.warnings.some(
        (w) => w.includes('AMBIGUOUS ZONE') && w.includes('Reached 200 kW in any three months'),
      ),
    ).toBe(true);
    expect(result.warnings.some((w) => w.includes('windowIncludesCurrentMonth=true'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('the other reading would does not fire'))).toBe(true);
  });

  it('does NOT flag the 200 kW rule when both readings agree', () => {
    // Current month is low (4 kW), so it never qualifies under either reading —
    // both see exactly the same 2 qualifying prior months, both don't fire.
    const result = billWith(monthsBack(2, 250, '2026-06'));
    expect(
      result.warnings.some((w) => w.includes('AMBIGUOUS ZONE') && w.includes('Reached 200 kW')),
    ).toBe(false);
  });

  it('flags the 20 kW rule when the current month alone decides which reading fires', () => {
    // 12 consecutive PRIOR months (2026-06 back through 2025-07) all at 10 kW.
    // Chosen reading (true): window is 11 prior + current. Current is 24 kW, so
    // NOT all <=20 -> does not fire.
    // Other reading (false): window is the 12 STRICTLY PRECEDING months, which
    // this history covers completely and which are all <=20 -> FIRES. The two
    // readings disagree on whether this customer should be moved to TOU-GS-1.
    const currentAbove20 = buildProfile({ start: START, end: END, kwh: flat(6) }); // 24 kW
    const result = rate(
      currentAbove20,
      gs2Tariff(),
      period(START, END),
      emptyContext({ demandHistory: { entries: monthsBack(12, 10, '2026-06') } }),
    );

    expect(
      result.diagnostics.eligibility.findings.some(
        (f) => f.ruleId === 'at-or-below-20-kw-twelve-consecutive',
      ),
    ).toBe(false);
    expect(
      result.warnings.some(
        (w) => w.includes('AMBIGUOUS ZONE') && w.includes('At or below 20 kW for twelve consecutive months'),
      ),
    ).toBe(true);
    expect(result.warnings.some((w) => w.includes('windowIncludesCurrentMonth=true'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('the other reading would FIRES (transfer to TOU-GS-1)'))).toBe(true);
  });

  it('does NOT flag the 20 kW rule when the alternate reading has incomplete data', () => {
    // Only 11 prior months of history, so the "exclude current month" reading
    // (which needs 12 STRICTLY preceding months) can't be evaluated at all —
    // an unevaluable alternate reading can't confirm a disagreement, so no
    // ambiguous-zone warning is emitted, only the normal finding.
    const result = billWith(monthsBack(11, 10, '2026-06'));
    expect(
      result.warnings.some(
        (w) => w.includes('AMBIGUOUS ZONE') && w.includes('At or below 20 kW'),
      ),
    ).toBe(false);
  });

  it('says explicitly to verify against SCE directly', () => {
    const highProfile = buildProfile({ start: START, end: END, kwh: flat(60) });
    const result = rate(
      highProfile,
      gs2Tariff(),
      period(START, END),
      emptyContext({ demandHistory: { entries: monthsBack(2, 250, '2026-06') } }),
    );
    const warning = result.warnings.find((w) => w.includes('AMBIGUOUS ZONE'));
    expect(warning).toBeDefined();
    expect(warning).toContain('Verify against SCE directly before acting');
  });
});

describe('eligibility never blocks a bill', () => {
  it('still returns a full itemization for an ineligible customer', () => {
    const result = billWith(monthsBack(6, 400, '2026-06'));
    expect(result.diagnostics.eligibility.findings.length).toBeGreaterThan(0);
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
  });

  it('reports nothing when a schedule declares no demand rules', () => {
    const result = rate(profile, makeSyntheticTariff(), period(START, END), emptyContext());
    expect(result.diagnostics.eligibility.findings).toEqual([]);
    expect(result.diagnostics.eligibility.unevaluatedRules).toEqual([]);
  });
});
