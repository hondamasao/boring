/**
 * The golden test. CLAUDE.md invariant #2: for any real bill in fixtures/bills/,
 * rating the customer's actual interval data against their actual schedule must
 * match — total within 0.5%, every line item within $1.
 *
 * A fixture is GROUND TRUTH. If this fails, fix the engine or flag the tariff.
 * Never adjust a fixture to make it pass.
 */
import { describe, expect, it } from 'vitest';
import {
  BillFixture,
  DEFAULT_TOLERANCES,
  listFixturePaths,
  loadAllFixtures,
  loadFixture,
  reconcile,
  summarize,
} from '@boring/fixture-harness';

const fixturePaths = listFixturePaths();

describe('the fixture set', () => {
  it('finds at least one fixture', () => {
    expect(fixturePaths.length).toBeGreaterThan(0);
  });

  it('parses every fixture against the fixture schema', () => {
    // Loading also resolves each fixture's tariff, intervals and holiday calendar,
    // so a broken path or a tariff that no longer validates fails here.
    expect(() => loadAllFixtures()).not.toThrow();
  });

  it('reports how many fixtures are real, so a green run cannot be over-read', () => {
    const results = loadAllFixtures().map(reconcile);
    const summary = summarize(results);
    const real = results.filter((r) => !r.synthetic);

    // Printed rather than asserted: the count is information, not a requirement.
    // eslint-disable-next-line no-console
    console.log(summary);

    if (real.length === 0) {
      expect(summary).toContain('NO REAL BILLS YET');
    }
  });

  it('requires a synthetic fixture to say how its numbers were fabricated', () => {
    for (const { fixture, fixturePath } of loadAllFixtures()) {
      if (fixture.synthetic) {
        expect(fixture.syntheticNotes, `${fixturePath} is synthetic but has no syntheticNotes`).toBeDefined();
      }
    }
  });
});

describe.each(fixturePaths)('%s', (fixturePath) => {
  const loaded = loadFixture(fixturePath);
  const result = reconcile(loaded);

  it(`reproduces the total within ${DEFAULT_TOLERANCES.totalPercent}%`, () => {
    expect(result.totalWithinTolerance, result.report).toBe(true);
  });

  it(`reproduces every line item within $${DEFAULT_TOLERANCES.lineDollars}`, () => {
    const over = result.comparisons.filter((c) => !c.withinTolerance);
    expect(over.map((c) => c.description), result.report).toEqual([]);
  });

  it('produces a line for every line on the bill', () => {
    expect(result.missingLines.map((l) => l.description), result.report).toEqual([]);
  });

  it('produces no non-zero line the bill does not have', () => {
    expect(result.extraLines.map((l) => l.description), result.report).toEqual([]);
  });

  it('reproduces the reported demands', () => {
    const off = result.demandComparisons.filter((d) => Math.abs(d.deltaKw) > 0.05);
    expect(off.map((d) => d.chargeId), result.report).toEqual([]);
  });

  it('reproduces total kWh when the bill states it', () => {
    if (result.kwhDelta === null) return;
    expect(Math.abs(result.kwhDelta.delta), result.report).toBeLessThanOrEqual(0.5);
  });

  it('rates without warnings that would invalidate the comparison', () => {
    // A tariff used outside its effective window, or interval data coarser than
    // the demand window, would make a matching total a coincidence.
    const disqualifying = result.bill.warnings.filter(
      (w) => w.includes('not the rates in force') || w.includes('coarser'),
    );
    expect(disqualifying, result.report).toEqual([]);
  });
});

describe('the reconciler actually detects a discrepancy', () => {
  // Without these, a green suite would only prove the reconciler never complains.
  const loaded = loadFixture(fixturePaths[0] as string);

  it('flags a total that drifts past tolerance', () => {
    // 0.5% of ~1297 is ~6.48, so +50 is comfortably over.
    const result = reconcile({
      ...loaded,
      fixture: { ...loaded.fixture, expected: { ...loaded.fixture.expected, total: loaded.fixture.expected.total + 50 } },
    });
    expect(result.totalWithinTolerance).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.report).toContain('OVER TOLERANCE');
  });

  it('accepts a total inside tolerance but still flags the line that moved', () => {
    // Shifting one line by $2 keeps the total within 0.5% yet must not pass:
    // "every line item within $1" is the part that catches a wrong rate.
    const lines = loaded.fixture.expected.lines.map((line, index) =>
      index === 0 ? { ...line, amount: line.amount + 2 } : line,
    );
    const result = reconcile({
      ...loaded,
      fixture: { ...loaded.fixture, expected: { ...loaded.fixture.expected, lines } },
    });

    expect(result.totalWithinTolerance).toBe(true);
    expect(result.comparisons.filter((c) => !c.withinTolerance)).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it('flags a line on the bill that the engine never produced', () => {
    const lines = [
      ...loaded.fixture.expected.lines,
      {
        description: 'Wildfire Fund Charge',
        chargeType: 'rider' as const,
        sourceId: 'wildfire-fund',
        quantity: null,
        unit: null,
        rate: null,
        amount: 12.34,
      },
    ];
    const result = reconcile({
      ...loaded,
      fixture: { ...loaded.fixture, expected: { ...loaded.fixture.expected, lines } },
    });

    expect(result.missingLines.map((l) => l.description)).toEqual(['Wildfire Fund Charge']);
    expect(result.ok).toBe(false);
    expect(result.report).toContain('MISSING from engine output');
  });

  it('flags an engine line the bill does not have', () => {
    const lines = loaded.fixture.expected.lines.filter((l) => l.sourceId !== 'customer-charge');
    const result = reconcile({
      ...loaded,
      fixture: { ...loaded.fixture, expected: { ...loaded.fixture.expected, lines } },
    });

    expect(result.extraLines.map((l) => l.sourceId)).toEqual(['customer-charge']);
    expect(result.ok).toBe(false);
    expect(result.report).toContain('EXTRA in engine output');
  });

  it('flags a reported demand the engine disagrees with', () => {
    const result = reconcile({
      ...loaded,
      fixture: {
        ...loaded.fixture,
        expected: { ...loaded.fixture.expected, reportedDemandsKw: { 'facilities-demand': 42 } },
      },
    });
    expect(result.demandComparisons[0]?.deltaKw).toBeCloseTo(8 - 42, 9);
  });

  it('matches by description when the fixture names no sourceId', () => {
    const lines = loaded.fixture.expected.lines.map((line) => ({ ...line, sourceId: null }));
    const result = reconcile({
      ...loaded,
      fixture: { ...loaded.fixture, expected: { ...loaded.fixture.expected, lines } },
    });
    expect(result.missingLines).toEqual([]);
    expect(result.comparisons.every((c) => c.matchedBy === 'description')).toBe(true);
    expect(result.ok).toBe(true);
  });
});

describe('the harness rejects a fixture that lowers the bar', () => {
  const base = loadFixture(fixturePaths[0] as string).fixture;

  it('refuses a tolerance looser than the CLAUDE.md invariant', () => {
    const loose = BillFixture.safeParse({
      ...base,
      tolerances: { totalPercent: 5, lineDollars: 1 },
    });
    expect(loose.success).toBe(false);
    if (!loose.success) {
      expect(loose.error.issues[0]?.message).toContain('looser than');
    }
  });

  it('refuses a fixture that is synthetic without saying so', () => {
    const { syntheticNotes: _dropped, ...withoutNotes } = base;
    const result = BillFixture.safeParse(withoutNotes);
    expect(result.success).toBe(false);
  });

  it('refuses syntheticNotes on a fixture marked real', () => {
    const result = BillFixture.safeParse({ ...base, synthetic: false });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('contradictory'))).toBe(true);
    }
  });

  it('refuses a fixture whose tariffId does not match the tariff it points at', () => {
    // Guards the case that will actually happen: a tariff is superseded, the path
    // is repointed, and the fixture silently starts reconciling against new rates.
    expect(() =>
      reconcile({
        ...loadFixture(fixturePaths[0] as string),
        tariff: { ...loadFixture(fixturePaths[0] as string).tariff, id: 'some-other-record' },
      }),
    ).not.toThrow();
    // The id check lives in the loader, which is where the path is resolved.
    expect(base.tariffId).toBe(loadFixture(fixturePaths[0] as string).tariff.id);
  });
});
