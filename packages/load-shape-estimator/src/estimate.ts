import { DateTime } from 'luxon';
import { dayType, shapeMultiplier } from './shape.js';
import { LoadShapeEstimate } from './schema.js';

/**
 * A half-open [start, end) local-date billing period, matching
 * `@boring/tariff-schema`'s `BillingPeriod` convention — callers converting
 * from a bill's printed (inclusive) date range must add one day to the end
 * themselves, same as everywhere else in this codebase.
 */
export interface LoadShapeEstimateInput {
  billingPeriod: { start: string; end: string; timezone: string };
  totalKwh: number;
  /** Null when the bill shows no demand charge — most small commercial bills. */
  totalDemandKw: number | null;
}

const INTERVAL_MINUTES = 15;
const INTERVAL_HOURS = INTERVAL_MINUTES / 60;

const DISCLAIMER =
  'This usage profile is ESTIMATED, not measured. No Green Button interval data was available, so we built a ' +
  'generic small-commercial hour-of-day shape (low overnight, a business-hours plateau, lower weekends) and ' +
  "scaled it to match the totals on your bill. It is only as good as those totals — it does NOT reflect how " +
  'your business actually uses power hour to hour. A restaurant with a dinner rush, a 24-hour operation, or ' +
  'anything refrigeration-heavy will look nothing like this shape in its details. Energy-charge findings built ' +
  'from this profile are relatively reliable, since total energy is exactly what the shape is scaled to match; ' +
  'demand-charge findings are a rough approximation at best, since a demand charge depends on WHEN your true ' +
  'peak happened, which this profile is guessing at, not observing.';

function buildIntervalStarts(start: string, end: string, timezone: string): DateTime[] {
  const startDt = DateTime.fromISO(start, { zone: timezone }).startOf('day');
  const endDt = DateTime.fromISO(end, { zone: timezone }).startOf('day');
  if (!startDt.isValid || !endDt.isValid) {
    throw new RangeError(`unparseable billing period [${start}, ${end}) in zone ${timezone}`);
  }
  const starts: DateTime[] = [];
  let cursor = startDt;
  while (cursor < endDt) {
    starts.push(cursor);
    cursor = cursor.plus({ minutes: INTERVAL_MINUTES });
  }
  return starts;
}

/**
 * Fits a two-parameter load curve — a flat baseline `b` plus a diurnal swing
 * `s` scaling the generic shape — to whichever of the bill's totals are
 * available:
 *
 * - kWh and kW both present: solves the pair of equations (total energy
 *   integrates to `totalKwh`; the shape's single peak interval equals
 *   `totalDemandKw`) for `b` and `s`. If that solution would require a
 *   negative baseline — the two bill totals are inconsistent with a shape
 *   this generic — falls back to energy-only and says so in `assumptions`,
 *   rather than emit a fit that looks precise but isn't.
 * - kWh only: `b = 0`; `s` is chosen so total energy matches `totalKwh`.
 *
 * Never silently drops a bill total that COULD have been used — either it's
 * used, or `assumptions` explains why it wasn't.
 */
export function estimateLoadProfile(input: LoadShapeEstimateInput): LoadShapeEstimate {
  const { billingPeriod, totalKwh, totalDemandKw } = input;
  if (!(totalKwh > 0)) {
    throw new RangeError(`totalKwh must be a positive number, got ${totalKwh}`);
  }

  const starts = buildIntervalStarts(billingPeriod.start, billingPeriod.end, billingPeriod.timezone);
  if (starts.length === 0) {
    throw new RangeError(`billing period [${billingPeriod.start}, ${billingPeriod.end}) contains no intervals`);
  }

  const multipliers = starts.map((dt) => shapeMultiplier(dt.hour, dayType(dt.weekday)));
  const shapeSum = multipliers.reduce((a, b) => a + b, 0);
  const shapePeak = Math.max(...multipliers);
  const n = starts.length;

  const assumptions: string[] = [
    'Generic small-commercial hour-of-day shape: low overnight, ramping through the morning, a business-hours ' +
      'plateau (~8am-6pm), ramping down in the evening; weekends scaled down and shortened. Not specific to any ' +
      'business type.',
    'Every day is treated as either "weekday" (Mon-Fri) or "weekend" (Sat-Sun) — no holiday calendar is applied, ' +
      'since a fallback estimate has no source for which days this business actually observed as holidays.',
    `${n} fifteen-minute intervals from ${billingPeriod.start} to ${billingPeriod.end} (exclusive), zone ${billingPeriod.timezone}.`,
  ];

  let base: number;
  let swing: number;
  let method: LoadShapeEstimate['method'];

  const canFitPeak = totalDemandKw !== null && totalDemandKw > 0;
  let fitPeak = false;

  if (canFitPeak) {
    const denom = (shapeSum - shapePeak * n) * INTERVAL_HOURS;
    const s = denom !== 0 ? (totalKwh - totalDemandKw * n * INTERVAL_HOURS) / denom : NaN;
    const b = totalDemandKw - s * shapePeak;

    if (Number.isFinite(s) && Number.isFinite(b) && b >= 0 && s >= 0) {
      base = b;
      swing = s;
      fitPeak = true;
      assumptions.push(`Fit to both totals on the bill: ${totalKwh} kWh total energy and ${totalDemandKw} kW peak demand.`);
    } else {
      base = 0;
      swing = totalKwh / (shapeSum * INTERVAL_HOURS);
      assumptions.push(
        `Bill states ${totalKwh} kWh and ${totalDemandKw} kW peak demand, but those two numbers are inconsistent ` +
          'with the generic shape (fitting both would require a negative baseline load) — fit to total energy ' +
          'only instead. Treat the demand-charge portion of any downstream estimate for this bill as unreliable.',
      );
    }
  } else {
    base = 0;
    swing = totalKwh / (shapeSum * INTERVAL_HOURS);
    assumptions.push(
      totalDemandKw === null
        ? 'Bill did not report a demand figure — fit to total energy only, assuming no separate round-the-clock baseline load.'
        : `Bill reported a demand of ${totalDemandKw} kW, which isn't a usable positive value — fit to total energy only.`,
    );
  }

  method = fitPeak ? 'fit-energy-and-peak' : 'fit-energy-only';

  const readings = starts.map((dt, index) => ({
    start: dt.toISO({ suppressMilliseconds: true }) as string,
    kwh: (base + swing * multipliers[index]!) * INTERVAL_HOURS,
  }));

  const impliedPeakKw = base + swing * shapePeak;

  return LoadShapeEstimate.parse({
    profile: { timezone: billingPeriod.timezone, intervalMinutes: INTERVAL_MINUTES, readings },
    method,
    impliedPeakKw,
    assumptions,
    disclaimer: DISCLAIMER,
  });
}
