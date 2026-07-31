import type {
  AnyDemandCharge,
  DemandHistory,
  DemandRatchet,
  Tariff,
} from '@boring/tariff-schema';
import type { Calendar } from './calendar.js';
import { peakOf, type DemandWindow } from './intervals.js';
import { precedingMonths } from './months.js';
import type { DemandDetermination } from './types.js';

/**
 * Demand determination: for each charge, over which windows, and what floors it.
 *
 * The two families differ in exactly one place — which windows are eligible — and
 * that difference is read off the charge's TYPE rather than a flag:
 *   facilities   every window in the span, regardless of period;
 *   time-related only windows whose local time falls in the charge's TOU period,
 *                further restricted to weekdays when `weekdaysOnly` is set.
 */

const WEEKDAY_TYPES = new Set(['mon', 'tue', 'wed', 'thu', 'fri']);

/** A span of windows to search, and how to describe it on the bill. */
interface Span {
  seasonId: string | null;
  label: string | null;
  windows: DemandWindow[];
}

/** Spans for a charge: one for the whole period, or one per season segment. */
function spansFor(charge: AnyDemandCharge, calendar: Calendar, windows: readonly DemandWindow[]): Span[] {
  const inSeason = (window: DemandWindow): boolean =>
    charge.seasonId === null || window.placement.seasonId === charge.seasonId;

  if (charge.measuredOver === 'billing-period') {
    return [
      {
        seasonId: charge.seasonId,
        label: null,
        windows: windows.filter(inSeason),
      },
    ];
  }

  const spans: Span[] = [];
  for (const segment of calendar.segments) {
    if (charge.seasonId !== null && segment.seasonId !== charge.seasonId) continue;
    spans.push({
      seasonId: segment.seasonId,
      label: `${segment.seasonId} ${segment.startDate}..${segment.endDate}`,
      windows: windows.filter(
        (w) =>
          w.placement.seasonId === segment.seasonId &&
          w.placement.date >= segment.startDate &&
          w.placement.date <= segment.endDate,
      ),
    });
  }
  return spans;
}

/** Windows eligible for a charge, under one reading of `weekdaysOnly`. Facilities
 * charges ignore the flag entirely — it only exists on time-related charges. */
function eligibleWindows(
  charge: AnyDemandCharge,
  windows: readonly DemandWindow[],
  weekdaysOnly: boolean,
): DemandWindow[] {
  if (charge.kind === 'facilities') return [...windows];
  let result = windows.filter((w) => w.placement.periodId === charge.periodId);
  if (weekdaysOnly) result = result.filter((w) => WEEKDAY_TYPES.has(w.placement.dayType));
  return result;
}

export interface DemandResult {
  determinations: DemandDetermination[];
  warnings: string[];
}

/**
 * Produces a determination per (charge, span), with any ratchet floor applied.
 *
 * A charge whose span contains no qualifying windows still gets a determination
 * at 0 kW. Omitting it would leave a hole in the itemization exactly where a
 * reader is most likely to be checking — "why is there no on-peak demand charge
 * on my winter bill" has an answer, and the answer is a zero line.
 */
export function determineDemand(
  tariff: Tariff,
  calendar: Calendar,
  windows: readonly DemandWindow[],
  history: DemandHistory,
  currentMonth: string,
): DemandResult {
  const determinations: DemandDetermination[] = [];
  const warnings: string[] = [];

  if (tariff.ratchets.length > 0 && history.entries.length === 0) {
    warnings.push(
      `tariff "${tariff.id}" declares ${tariff.ratchets.length} demand ratchet(s) but no demand history was supplied, so no floor could be applied`,
    );
  }

  const charges: AnyDemandCharge[] = [
    ...tariff.demandCharges.facilities,
    ...tariff.demandCharges.timeRelated,
  ];

  for (const charge of charges) {
    const chosenWeekdaysOnly = charge.kind === 'time-related' && charge.weekdaysOnly;
    const eligible = eligibleWindows(charge, windows, chosenWeekdaysOnly);
    const spans = spansFor(charge, calendar, eligible);

    // Only time-related charges carry the ambiguity at all — compute what the
    // OTHER reading of weekdaysOnly would have measured, span-for-span, so a
    // disagreement can be reported per determination rather than assumed away.
    const otherSpans =
      charge.kind === 'time-related'
        ? spansFor(charge, calendar, eligibleWindows(charge, windows, !chosenWeekdaysOnly))
        : null;

    for (const [index, span] of spans.entries()) {
      const { kw: measuredPeakKw, at } = peakOf(span.windows);
      const determination: DemandDetermination = {
        chargeId: charge.id,
        kind: charge.kind,
        seasonId: span.seasonId,
        periodId: charge.kind === 'time-related' ? charge.periodId : null,
        segmentLabel: span.label,
        measuredPeakKw,
        peakWindowStartLocal: at,
        billedKw: measuredPeakKw,
        ratchetApplied: null,
        weekdayAmbiguity: null,
      };

      if (otherSpans !== null && charge.kind === 'time-related') {
        const otherSpan = otherSpans[index];
        const otherPeakKw = otherSpan === undefined ? 0 : peakOf(otherSpan.windows).kw;
        if (otherPeakKw !== measuredPeakKw) {
          determination.weekdayAmbiguity = {
            chosenWeekdaysOnly: charge.weekdaysOnly,
            chosenPeakKw: measuredPeakKw,
            otherPeakKw,
          };
        }
      }

      for (const ratchet of tariff.ratchets) {
        if (ratchet.appliesTo.kind !== charge.kind) continue;
        if (ratchet.appliesTo.chargeId !== charge.id) continue;

        const floor = computeFloor(ratchet, charge, determination, history, currentMonth, warnings);
        if (floor !== null && floor.floorKw > determination.billedKw) {
          determination.billedKw = floor.floorKw;
          determination.ratchetApplied = { ratchetId: ratchet.id, ...floor };
        }
      }

      // SCE Schedule TOU-GS-2, Special Condition 6: "The Billing Demand shall be
      // the kW of Maximum Demand, determined to the nearest kW." Rounded once,
      // here, as the final step after any ratchet floor — this is the quantity
      // the dollar amount is computed FROM, not a rounding of the resulting
      // amount. `measuredPeakKw` above is left unrounded: Special Condition 5
      // defines "Maximum Demand" (the raw meter reading) with no rounding, so the
      // audit trail keeps the true peak visible even though only the rounded
      // figure is billed.
      determination.billedKw = roundToNearestKw(determination.billedKw);

      if (determination.weekdayAmbiguity !== null) {
        const a = determination.weekdayAmbiguity;
        warnings.push(
          `demand charge "${charge.id}" (${charge.label}) has a genuinely ambiguous weekday restriction (see the charge's citation): billed using weekdaysOnly=${a.chosenWeekdaysOnly} (peak ${round4(a.chosenPeakKw)} kW), but the other reading would have measured ${round4(a.otherPeakKw)} kW this period. Verify against SCE directly before treating this bill as final.`,
        );
      }

      determinations.push(determination);
    }
  }

  return { determinations, warnings };
}

/** The highest qualifying prior peak, scaled, or null when nothing qualifies. */
function computeFloor(
  ratchet: DemandRatchet,
  charge: AnyDemandCharge,
  determination: DemandDetermination,
  history: DemandHistory,
  currentMonth: string,
  warnings: string[],
): { sourceMonth: string; priorPeakKw: number; floorKw: number } | null {
  const window = new Set(precedingMonths(currentMonth, ratchet.lookbackMonths));

  let best: { sourceMonth: string; priorPeakKw: number } | null = null;

  for (const entry of history.entries) {
    if (!window.has(entry.month)) continue;

    if (ratchet.seasonScope === 'same-season-only') {
      if (entry.seasonId === null) {
        warnings.push(
          `demand history entry ${entry.month} records no season, so it cannot be matched against the same-season-only ratchet "${ratchet.id}" and was skipped`,
        );
        continue;
      }
      if (entry.seasonId !== determination.seasonId) continue;
    }

    const priorPeakKw =
      charge.kind === 'facilities'
        ? entry.facilitiesPeakKw
        : entry.timeRelatedPeaksKw[charge.id];

    if (priorPeakKw === undefined) continue;
    if (best === null || priorPeakKw > best.priorPeakKw) {
      best = { sourceMonth: entry.month, priorPeakKw };
    }
  }

  if (best === null) return null;
  return { ...best, floorKw: best.priorPeakKw * ratchet.percentOfPriorPeak };
}

/** Rounds to the nearest whole kW, half away from zero — symmetric the same way
 * `roundToCents` is, so a rounding convention doesn't quietly differ between
 * money and demand quantities. */
function roundToNearestKw(kw: number): number {
  const sign = kw < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(kw));
}

/** Four decimals, for warning text. Never used for money. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
