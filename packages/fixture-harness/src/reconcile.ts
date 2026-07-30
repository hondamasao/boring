import { rate, type BillLine, type ItemizedBill } from '@boring/rating-engine';
import { DEFAULT_TOLERANCES, type ExpectedLine } from './fixture-schema.js';
import type { LoadedFixture } from './loader.js';

/**
 * Reconciles an engine bill against a hand-transcribed one.
 *
 * CLAUDE.md invariant #2 is the definition of correct: total within 0.5%, every
 * line item within $1. This module's job is to make a failure READABLE — a bare
 * "expected 412.33, got 419.07" sends you back to the paper bill with nothing to
 * go on, whereas a line-by-line diff usually names the wrong rate outright.
 *
 * A line present on one side and not the other is a failure, not a skip. The one
 * exception is an engine line at exactly $0.00 that the paper bill omits: the
 * engine deliberately emits zero-quantity demand lines (a demand charge is a
 * standing feature of the schedule and its zero is informative), and a real bill
 * usually just leaves them out. Those are reported separately and do not fail,
 * because they cannot move the total or misstate a charge.
 */

export type MatchedBy = 'sourceId' | 'description' | 'chargeType';

export interface LineComparison {
  description: string;
  sourceId: string | null;
  expectedAmount: number;
  actualAmount: number;
  /** actual - expected. */
  deltaDollars: number;
  withinTolerance: boolean;
  matchedBy: MatchedBy;
  /** Quantity and rate comparison, when the bill printed them. */
  expectedQuantity: number | null;
  actualQuantity: number;
  expectedRate: number | null;
  actualRate: number;
}

export interface DemandComparison {
  chargeId: string;
  expectedKw: number;
  actualKw: number;
  deltaKw: number;
}

export interface ReconciliationResult {
  fixtureId: string;
  label: string;
  synthetic: boolean;
  tolerances: { totalPercent: number; lineDollars: number };

  expectedTotal: number;
  actualTotal: number;
  totalDeltaDollars: number;
  totalDeltaPercent: number;
  totalWithinTolerance: boolean;

  comparisons: LineComparison[];
  /** On the paper bill, not produced by the engine. */
  missingLines: ExpectedLine[];
  /** Produced by the engine with a non-zero amount, absent from the paper bill. */
  extraLines: BillLine[];
  /** Produced at exactly $0.00 and absent from the paper bill. Not a failure. */
  ignoredZeroLines: BillLine[];

  demandComparisons: DemandComparison[];
  kwhDelta: { expected: number; actual: number; delta: number } | null;

  bill: ItemizedBill;
  ok: boolean;
  /** Human-readable diff, printed when a test fails. */
  report: string;
}

/** Case- and punctuation-insensitive, for matching a bill's wording to a label. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function reconcile(loaded: LoadedFixture): ReconciliationResult {
  const { fixture } = loaded;
  const bill = rate(loaded.loadProfile, loaded.tariff, loaded.billingPeriod, loaded.context);
  const tolerances = fixture.tolerances ?? DEFAULT_TOLERANCES;

  const unmatched = new Set(bill.lines.keys());
  const comparisons: LineComparison[] = [];
  const missingLines: ExpectedLine[] = [];

  /** Claims an engine line, so no two expected lines match the same one. */
  const claim = (index: number, expected: ExpectedLine, matchedBy: MatchedBy): void => {
    const actual = bill.lines[index] as BillLine;
    unmatched.delete(index);
    const deltaDollars = actual.amount - expected.amount;
    comparisons.push({
      description: expected.description,
      sourceId: actual.sourceId,
      expectedAmount: expected.amount,
      actualAmount: actual.amount,
      deltaDollars,
      withinTolerance: Math.abs(deltaDollars) <= tolerances.lineDollars,
      matchedBy,
      expectedQuantity: expected.quantity,
      actualQuantity: actual.quantity,
      expectedRate: expected.rate,
      actualRate: actual.rate,
    });
  };

  for (const expected of fixture.expected.lines) {
    // Strongest signal first: the fixture names the tariff node it expects.
    if (expected.sourceId !== null) {
      const bySourceId = [...unmatched].find((i) => bill.lines[i]?.sourceId === expected.sourceId);
      if (bySourceId !== undefined) {
        claim(bySourceId, expected, 'sourceId');
        continue;
      }
    }

    const target = normalize(expected.description);
    const byDescription = [...unmatched].find((i) => normalize(bill.lines[i]?.description ?? '') === target);
    if (byDescription !== undefined) {
      claim(byDescription, expected, 'description');
      continue;
    }

    // Last resort, and only when it is unambiguous: exactly one remaining engine
    // line of the right charge type. Guessing among several would fabricate a
    // match and hide the real discrepancy.
    if (expected.chargeType !== null) {
      const byType = [...unmatched].filter((i) => bill.lines[i]?.chargeType === expected.chargeType);
      if (byType.length === 1) {
        claim(byType[0] as number, expected, 'chargeType');
        continue;
      }
    }

    missingLines.push(expected);
  }

  const leftover = [...unmatched].map((i) => bill.lines[i] as BillLine);
  const extraLines = leftover.filter((line) => line.amount !== 0);
  const ignoredZeroLines = leftover.filter((line) => line.amount === 0);

  const expectedTotal = fixture.expected.total;
  const actualTotal = bill.total;
  const totalDeltaDollars = actualTotal - expectedTotal;
  const totalDeltaPercent =
    expectedTotal === 0 ? (actualTotal === 0 ? 0 : Infinity) : Math.abs(totalDeltaDollars / expectedTotal) * 100;

  const demandComparisons: DemandComparison[] = [];
  for (const [chargeId, expectedKw] of Object.entries(fixture.expected.reportedDemandsKw ?? {})) {
    const actualKw = bill.diagnostics.demandDeterminations
      .filter((d) => d.chargeId === chargeId)
      .reduce((max, d) => Math.max(max, d.billedKw), 0);
    demandComparisons.push({ chargeId, expectedKw, actualKw, deltaKw: actualKw - expectedKw });
  }

  const kwhDelta =
    fixture.expected.totalKwh === undefined
      ? null
      : {
          expected: fixture.expected.totalKwh,
          actual: bill.diagnostics.totalKwh,
          delta: bill.diagnostics.totalKwh - fixture.expected.totalKwh,
        };

  const totalWithinTolerance = totalDeltaPercent <= tolerances.totalPercent;
  const ok =
    totalWithinTolerance &&
    missingLines.length === 0 &&
    extraLines.length === 0 &&
    comparisons.every((c) => c.withinTolerance);

  const result: ReconciliationResult = {
    fixtureId: fixture.id,
    label: fixture.label,
    synthetic: fixture.synthetic,
    tolerances: { ...tolerances },
    expectedTotal,
    actualTotal,
    totalDeltaDollars,
    totalDeltaPercent,
    totalWithinTolerance,
    comparisons,
    missingLines,
    extraLines,
    ignoredZeroLines,
    demandComparisons,
    kwhDelta,
    bill,
    ok: false,
    report: '',
  };
  result.ok = ok;
  result.report = formatReport(result);
  return result;
}

const money = (value: number): string => value.toFixed(2).padStart(11);

function formatReport(result: ReconciliationResult): string {
  const lines: string[] = [];
  const flag = result.synthetic ? ' [SYNTHETIC]' : '';
  lines.push(`fixture "${result.fixtureId}"${flag} — ${result.label}`);
  lines.push(
    `  total: expected ${money(result.expectedTotal)}  actual ${money(result.actualTotal)}  delta ${money(result.totalDeltaDollars)}  (${result.totalDeltaPercent.toFixed(4)}%, tolerance ${result.tolerances.totalPercent}%)${result.totalWithinTolerance ? '' : '  <-- OVER TOLERANCE'}`,
  );

  if (result.comparisons.length > 0) {
    lines.push('  lines:');
    for (const c of result.comparisons) {
      const mark = c.withinTolerance ? ' ' : '!';
      const quantityNote =
        c.expectedQuantity !== null && Math.abs(c.expectedQuantity - c.actualQuantity) > 1e-6
          ? `   qty expected ${c.expectedQuantity} actual ${c.actualQuantity}`
          : '';
      const rateNote =
        c.expectedRate !== null && Math.abs(c.expectedRate - c.actualRate) > 1e-9
          ? `   rate expected ${c.expectedRate} actual ${c.actualRate}`
          : '';
      lines.push(
        `   ${mark} ${c.description.slice(0, 44).padEnd(44)} expected ${money(c.expectedAmount)}  actual ${money(c.actualAmount)}  delta ${money(c.deltaDollars)}  [${c.matchedBy}]${quantityNote}${rateNote}`,
      );
    }
  }

  for (const missing of result.missingLines) {
    lines.push(
      `   - MISSING from engine output: "${missing.description}" (${missing.amount.toFixed(2)})`,
    );
  }
  for (const extra of result.extraLines) {
    lines.push(
      `   + EXTRA in engine output: "${extra.description}" (${extra.amount.toFixed(2)}, sourceId ${String(extra.sourceId)})`,
    );
  }
  if (result.ignoredZeroLines.length > 0) {
    lines.push(
      `   . ${result.ignoredZeroLines.length} zero-amount engine line(s) absent from the bill, ignored: ${result.ignoredZeroLines.map((l) => l.sourceId ?? l.chargeType).join(', ')}`,
    );
  }

  for (const d of result.demandComparisons) {
    const mark = Math.abs(d.deltaKw) > 0.05 ? '!' : ' ';
    lines.push(`   ${mark} demand ${d.chargeId}: expected ${d.expectedKw} kW  actual ${d.actualKw} kW`);
  }
  if (result.kwhDelta !== null) {
    const mark = Math.abs(result.kwhDelta.delta) > 0.5 ? '!' : ' ';
    lines.push(
      `   ${mark} total kWh: expected ${result.kwhDelta.expected}  actual ${result.kwhDelta.actual}`,
    );
  }

  for (const warning of result.bill.warnings) lines.push(`   ! engine warning: ${warning}`);

  return lines.join('\n');
}

/** Counts for a suite summary, so a green run cannot be mistaken for validation. */
export function summarize(results: readonly ReconciliationResult[]): string {
  const real = results.filter((r) => !r.synthetic);
  const synthetic = results.filter((r) => r.synthetic);
  const failing = results.filter((r) => !r.ok);
  return [
    `${results.length} fixture(s): ${real.length} real, ${synthetic.length} synthetic`,
    real.length === 0
      ? 'NO REAL BILLS YET — a green run here proves the engine is self-consistent, not that it reproduces an SCE bill.'
      : `${real.length} real bill(s) reconciled.`,
    failing.length === 0 ? 'all within tolerance.' : `${failing.length} over tolerance.`,
  ].join('\n');
}
