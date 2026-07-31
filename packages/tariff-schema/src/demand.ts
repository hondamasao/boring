import { z } from 'zod';
import { Citation, Component, Identifier, Rate, dividesAnHour } from './primitives.js';

/**
 * How maximum demand is metered.
 *
 * SCE's tariff defines maximum demand as the maximum average kW during any
 * 15-minute metered interval, with a 5-minute interval where the load is
 * intermittent or subject to violent fluctuation. The 15-minute figure is a
 * property of the sheet and lives here.
 *
 * The 5-minute case is an ACCOUNT-level determination made by the utility, not
 * a property of the schedule — a restaurant with compressor cycling on
 * TOU-GS-2 is on the same sheet as everyone else. Putting it here would force a
 * duplicate tariff record per customer and break the "one record per sheet
 * revision" invariant, so the override lives on `ServiceAttributes` instead.
 */
export const DemandMeasurement = z
  .object({
    /** Default metered interval for maximum demand, in minutes. Must divide an
     * hour so windows align to the local clock across DST transitions. */
    windowMinutes: z.number().int().positive().default(15),
    citation: Citation,
  })
  .strict()
  .superRefine((m, ctx) => {
    if (!dividesAnHour(m.windowMinutes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `windowMinutes must divide 60 (1,2,3,4,5,6,10,12,15,20,30,60), got ${m.windowMinutes}`,
        path: ['windowMinutes'],
      });
    }
  });
export type DemandMeasurement = z.infer<typeof DemandMeasurement>;

/**
 * The span over which a single maximum is searched.
 *  - `billing-period`: one maximum for the whole period, one bill line.
 *  - `season-segment`: a separate maximum per season segment, one line each, so
 *    a May-June cycle can bill a May peak at winter rates and a June peak at
 *    summer rates.
 *
 * Both branches are implemented and tested. Which one a given SCE schedule uses
 * is read off the sheet, not inferred.
 */
export const MeasuredOver = z.enum(['billing-period', 'season-segment']);
export type MeasuredOver = z.infer<typeof MeasuredOver>;

/**
 * FACILITIES-RELATED demand: the maximum kW at ANY time in the span, regardless
 * of season, day of week or hour. Recovers the cost of transmission and
 * distribution facilities built to serve the customer's peak.
 *
 * This type has NO `periodId`, and `.strict()` means a stray one is a hard
 * parse error rather than a silently ignored field. Together with
 * `TimeRelatedDemandCharge` requiring `periodId`, "max at any time" and "max
 * within a period" are distinguished at the type level: neither can be
 * expressed as the other, and there is no shared boolean to get backwards.
 */
export const FacilitiesDemandCharge = z
  .object({
    kind: z.literal('facilities'),
    id: Identifier,
    label: z.string().min(1),
    /** Null means the charge applies in every season at one rate. */
    seasonId: Identifier.nullable(),
    component: Component,
    ratePerKw: Rate,
    measuredOver: MeasuredOver,
    citation: Citation,
  })
  .strict();
export type FacilitiesDemandCharge = z.infer<typeof FacilitiesDemandCharge>;

/**
 * TIME-RELATED demand: the maximum kW recorded WITHIN a specific TOU period.
 * A 500 kW spike at 2 a.m. does not touch an on-peak time-related charge.
 *
 * `seasonId` and `periodId` are both required — a time-related charge that does
 * not name its period is meaningless.
 *
 * `weekdaysOnly` exists because a real sheet can say two different things about
 * the same charge: SCE's TOU-GS-2 defines its winter Mid-Peak TOU PERIOD as
 * applying on every day including weekends and holidays (Special Condition 1's
 * table), but the RATE TABLE row pricing that period's time-related demand is
 * labeled "Mid-peak - Weekdays (4-9pm)" — a narrower restriction than the period
 * itself, appearing consistently on both Option D and Option E and on the
 * corresponding voltage-discount row, but absent from every other TRD row
 * (including summer On-Peak, whose period is already weekday-only by definition,
 * so the label would be redundant there). That pattern reads as deliberate, not
 * a typo, but Special Condition 6 — which defines "Billing Demand" — says only
 * that TRD is "for the kW of Maximum Demand recorded during ... each of the TOU
 * Periods," with no weekday carve-out. The document does not resolve which
 * section controls.
 *
 * Required, no default, same discipline as
 * `EligibilityRule.windowIncludesCurrentMonth`: a citable, chosen interpretation
 * is recorded, and the engine separately computes what the OTHER reading would
 * have measured, surfacing a warning whenever the two disagree rather than
 * silently committing to one.
 *
 * `false` means: use the period's own day-type membership, no further
 * restriction. `true` means: additionally restrict the search to weekday
 * windows (calendar mon-fri, or a holiday's mapped day type if it resolves to a
 * weekday — a holiday rated as a weekend day is excluded either way, consistent
 * with treating it as weekend throughout).
 */
export const TimeRelatedDemandCharge = z
  .object({
    kind: z.literal('time-related'),
    id: Identifier,
    label: z.string().min(1),
    seasonId: Identifier,
    /** The TOU period whose hours bound the search for the maximum. */
    periodId: Identifier,
    component: Component,
    ratePerKw: Rate,
    measuredOver: MeasuredOver,
    weekdaysOnly: z.boolean(),
    citation: Citation,
  })
  .strict();
export type TimeRelatedDemandCharge = z.infer<typeof TimeRelatedDemandCharge>;

/**
 * The two families, in separate arrays.
 *
 * Not one array of a union type: keeping them apart means code that handles
 * facilities charges cannot accidentally receive a time-related one, and a
 * schedule with facilities-only demand (SCE TOU-GS-2 Option E, per SCE's rate
 * summary) is expressed by leaving `timeRelated` empty rather than by a flag.
 */
export const DemandCharges = z
  .object({
    facilities: z.array(FacilitiesDemandCharge),
    timeRelated: z.array(TimeRelatedDemandCharge),
  })
  .strict();
export type DemandCharges = z.infer<typeof DemandCharges>;

/** Either family, for reporting paths that legitimately handle both. */
export type AnyDemandCharge = FacilitiesDemandCharge | TimeRelatedDemandCharge;

/** True when determinations for this charge carry a season, which a
 * `same-season-only` ratchet requires. */
export function chargeDeterminationsCarrySeason(charge: AnyDemandCharge): boolean {
  return charge.seasonId !== null || charge.measuredOver === 'season-segment';
}
