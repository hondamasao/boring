import { rate, RatingError, type ItemizedBill } from '@boring/rating-engine';
import { readCachedExtraction } from './extraction-storage';
import { getOrEstimateBill } from './bill-usage';
import { billToEstimatorInput } from './usage-estimate';
import { loadTouGs2Options, holidayCalendarFor } from './tariffs';

/**
 * Deterministic string matching on what the bill printed — NOT a model
 * guess. CLAUDE.md's LLM boundary is extraction only; this just looks for
 * "D"/"E" markers in text the model already transcribed verbatim (it was
 * explicitly told not to normalize or invent an option letter). A bill that
 * doesn't clearly say one way or the other returns null rather than a guess.
 */
export function detectCurrentOption(rawRateSchedule: string): 'D' | 'E' | null {
  const upper = rawRateSchedule.toUpperCase();
  const hasD = /-D\b/.test(upper) || /\bOPTION\s*D\b/.test(upper);
  const hasE = /-E\b/.test(upper) || /\bOPTION\s*E\b/.test(upper);
  if (hasD && !hasE) return 'D';
  if (hasE && !hasD) return 'E';
  return null;
}

export interface MonthlyComparison {
  filename: string;
  monthLabel: string;
  billD: ItemizedBill;
  billE: ItemizedBill;
  cheaper: 'D' | 'E' | 'tie';
  deltaAbs: number;
  actualBilled: number | null;
  onFileOption: 'D' | 'E' | null;
  onFileRaw: string | null;
}

export interface ExcludedBill {
  filename: string;
  reason: string;
}

export type BillComparisonResult = { status: 'ok'; comparison: MonthlyComparison } | { status: 'excluded'; excluded: ExcludedBill };

export async function compareBillToOptions(uploadId: string, filename: string): Promise<BillComparisonResult> {
  const excluded = (reason: string): BillComparisonResult => ({ status: 'excluded', excluded: { filename, reason } });

  const bill = await readCachedExtraction(uploadId, filename);
  if (bill === null) return excluded('No confirmed extraction found for this bill.');

  const converted = billToEstimatorInput(bill);
  if (!converted.ok) return excluded(converted.reason);

  const estimateResult = await getOrEstimateBill(uploadId, filename);
  if (estimateResult.status === 'error') return excluded(estimateResult.message);

  const { optionD, optionE } = loadTouGs2Options();
  const period = { ...converted.input.billingPeriod, meterCount: 1 };

  // The engine will still compute a number for a period before a tariff's
  // effective date — it only warns (CLAUDE.md #4's own reasoning: "the
  // single easiest way to produce a confidently wrong number"), because
  // that policy call belongs to the caller, not the pure engine. Here it
  // does: a bill that predates our only verified TOU-GS-2 record would be
  // rated with 2026 rates against (probably different) 2025 rates, which is
  // exactly the wrong number this report must not present as comparable.
  const effectiveDate = optionD.provenance.effectiveDate;
  if (period.start < effectiveDate || period.start < optionE.provenance.effectiveDate) {
    return excluded(
      `This bill's billing period starts ${period.start}, before our only verified TOU-GS-2 record takes effect ` +
        `on ${effectiveDate}. Comparing it would apply ${effectiveDate.slice(0, 4)} rates to older usage, which ` +
        'is not a real comparison.',
    );
  }

  const context = {
    holidayCalendar: holidayCalendarFor(period.start),
    demandHistory: { entries: [] },
    serviceAttributes: {},
  };

  let billD: ItemizedBill;
  let billE: ItemizedBill;
  try {
    billD = rate(estimateResult.estimate.profile, optionD, period, context);
    billE = rate(estimateResult.estimate.profile, optionE, period, context);
  } catch (err) {
    if (err instanceof RatingError) return excluded(err.message);
    throw err;
  }

  const deltaAbs = Math.abs(billD.total - billE.total);
  const cheaper = billD.total < billE.total ? 'D' : billE.total < billD.total ? 'E' : 'tie';
  const monthLabel = new Date(`${period.start}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return {
    status: 'ok',
    comparison: {
      filename,
      monthLabel,
      billD,
      billE,
      cheaper,
      deltaAbs,
      actualBilled: bill.totalAmount.value,
      onFileOption: detectCurrentOption(bill.rateSchedule.value ?? ''),
      onFileRaw: bill.rateSchedule.value,
    },
  };
}
