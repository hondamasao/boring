import { expect } from 'vitest';
import type { BillLine, DemandDetermination, ItemizedBill } from '@boring/rating-engine';

/** The single line matching a predicate. Fails loudly on zero or many, because a
 * test that silently picked the first of two lines would assert nothing. */
export function only(lines: readonly BillLine[], predicate: (line: BillLine) => boolean): BillLine {
  const matches = lines.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly 1 matching line, found ${matches.length}:\n${lines
        .map((l) => `  ${l.stage} ${l.chargeType} ${l.id} ${l.quantity}${l.unit} @ ${l.rate} = ${l.amount}`)
        .join('\n')}`,
    );
  }
  return matches[0] as BillLine;
}

export function energyLine(bill: ItemizedBill, seasonId: string, periodId: string, component = 'delivery'): BillLine {
  return only(
    bill.lines,
    (l) => l.chargeType === 'energy' && l.seasonId === seasonId && l.periodId === periodId && l.component === component,
  );
}

export function energyKwh(bill: ItemizedBill, seasonId: string, periodId: string): number {
  return bill.diagnostics.kwhBySeasonPeriod[`${seasonId}|${periodId}`] ?? 0;
}

export function demandLine(bill: ItemizedBill, chargeId: string): BillLine {
  return only(bill.lines, (l) => l.sourceId === chargeId);
}

export function determination(bill: ItemizedBill, chargeId: string): DemandDetermination {
  const matches = bill.diagnostics.demandDeterminations.filter((d) => d.chargeId === chargeId);
  expect(matches).toHaveLength(1);
  return matches[0] as DemandDetermination;
}

export function riderLine(bill: ItemizedBill, riderId: string): BillLine {
  return only(bill.lines, (l) => l.sourceId === riderId);
}

/** A compact dump, printed by tests that fail so the diff is readable. */
export function describeBill(bill: ItemizedBill): string {
  const rows = bill.lines.map(
    (l) => `  [s${l.stage}] ${l.description.padEnd(38)} ${String(l.quantity).padStart(10)} ${l.unit.padEnd(6)} @ ${String(l.rate).padStart(9)} = ${l.amount.toFixed(2).padStart(11)}  (${l.component})`,
  );
  return [`total ${bill.total.toFixed(2)}`, ...rows, ...bill.warnings.map((w) => `  ! ${w}`)].join('\n');
}

/** Asserts the itemization adds up — the invariant that makes the total trustworthy. */
export function expectLinesSumToTotal(bill: ItemizedBill): void {
  const cents = bill.lines.reduce((sum, l) => sum + Math.round(l.amount * 100), 0);
  expect(cents / 100).toBeCloseTo(bill.total, 10);
}
