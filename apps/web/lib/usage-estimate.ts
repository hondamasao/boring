import { DateTime } from 'luxon';
import type { ExtractedBill } from '@boring/extraction';
import type { LoadShapeEstimateInput } from '@boring/load-shape-estimator';

/** SCE domain fact (CLAUDE.md): all TOU logic is local clock time in this zone. */
const SCE_ZONE = 'America/Los_Angeles';

export type EstimatorInputResult = { ok: true; input: LoadShapeEstimateInput } | { ok: false; reason: string };

/**
 * Converts an extracted bill's own totals into the estimator's input shape.
 * Fails loudly (returns `ok: false`, never a guessed value) when a field the
 * estimate depends on wasn't extracted — per CLAUDE.md invariant #6, a
 * missing field must stay missing, not get silently defaulted.
 */
export function billToEstimatorInput(bill: ExtractedBill): EstimatorInputResult {
  const startValue = bill.billingPeriod.start.value;
  const endValue = bill.billingPeriod.end.value;
  const kwhValue = bill.totalKwh.value;

  if (startValue === null || endValue === null) {
    return { ok: false, reason: 'Billing period start/end date was not extracted from this bill.' };
  }
  if (kwhValue === null || !(kwhValue > 0)) {
    return { ok: false, reason: 'Total kWh was not extracted from this bill (or was not a positive number).' };
  }

  const startDt = DateTime.fromISO(startValue, { zone: SCE_ZONE });
  const endDtInclusive = DateTime.fromISO(endValue, { zone: SCE_ZONE });
  if (!startDt.isValid || !endDtInclusive.isValid) {
    return { ok: false, reason: `Billing period dates could not be parsed ("${startValue}" to "${endValue}").` };
  }

  // A printed "Billing Period: 06/01/26 - 06/30/26" is inclusive of both
  // ends; the estimator uses the same half-open [start, end) convention as
  // the rest of this repo's BillingPeriod, so the exclusive end is one day
  // past the bill's printed last day.
  const endExclusive = endDtInclusive.plus({ days: 1 });

  return {
    ok: true,
    input: {
      billingPeriod: {
        start: startDt.toISODate() as string,
        end: endExclusive.toISODate() as string,
        timezone: SCE_ZONE,
      },
      totalKwh: kwhValue,
      totalDemandKw: bill.totalDemandKw.value,
    },
  };
}
