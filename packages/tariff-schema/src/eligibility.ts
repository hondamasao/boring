import { z } from 'zod';
import {
  Citation,
  CustomerClass,
  Identifier,
  NonNegativeRate,
  VoltageLevel,
} from './primitives.js';

/**
 * Eligibility rules evaluated against demand HISTORY, not static min/max scalars.
 *
 * SCE's thresholds are history-dependent, and a pair of scalars cannot express
 * them. TOU-GS-2's sheet turns on a customer that "has reached 200 kW in any
 * three months of the preceding twelve" and on one at or below 20 kW "for twelve
 * consecutive months" — a customer sitting at 210 kW for one month is not the
 * same as one that hit it three times.
 *
 * This matters commercially, not just formally: recommending a schedule the
 * customer is then transferred off of is worse than making no recommendation, so
 * every rule names the schedule the customer would be moved TO.
 *
 * Demand here means maximum demand at any time in the month — the
 * facilities-related sense — which the engine computes for every billing period
 * whether or not the schedule has a facilities charge.
 */
export const EligibilityRule = z.discriminatedUnion('kind', [
  /** "has reached <threshold> kW in any <monthCount> months of the preceding
   * <windowMonths>" — fires when the count of qualifying months is reached. */
  z
    .object({
      kind: z.literal('demand-at-or-above-threshold-in-n-months'),
      id: Identifier,
      label: z.string().min(1),
      thresholdKw: NonNegativeRate,
      monthCount: z.number().int().positive(),
      windowMonths: z.number().int().positive().max(120),
      /**
       * Whether the month being billed counts toward the window.
       *
       * "the preceding twelve months" can be read either way, and the two
       * readings disagree for a customer who has just crossed the threshold —
       * exactly the customer a schedule recommendation is about. Required, with
       * no default, so the answer comes off the sheet rather than from here.
       */
      windowIncludesCurrentMonth: z.boolean(),
      transferTo: z.string().min(1),
      citation: Citation,
    })
    .strict(),

  /** "at or below <threshold> kW for <monthCount> consecutive months", counted
   * back from the anchor month. Every month in the run must have data; a gap
   * leaves the rule unevaluated rather than quietly satisfied. */
  z
    .object({
      kind: z.literal('demand-at-or-below-threshold-for-n-consecutive-months'),
      id: Identifier,
      label: z.string().min(1),
      thresholdKw: NonNegativeRate,
      monthCount: z.number().int().positive().max(120),
      /** See the note on the rule above. */
      windowIncludesCurrentMonth: z.boolean(),
      transferTo: z.string().min(1),
      citation: Citation,
    })
    .strict(),

  /** "expected to reach <threshold> kW" — evaluated against a declared
   * expectation on `ServiceAttributes`, since it is forward-looking and cannot
   * come from meter data. */
  z
    .object({
      kind: z.literal('expected-demand-at-or-above-threshold'),
      id: Identifier,
      label: z.string().min(1),
      thresholdKw: NonNegativeRate,
      transferTo: z.string().min(1),
      citation: Citation,
    })
    .strict(),
]);
export type EligibilityRule = z.infer<typeof EligibilityRule>;

/**
 * Eligibility has two halves: static service attributes, and history-dependent
 * demand rules.
 *
 * The engine WARNS rather than throws. A customer at 210 kW on a 20-200 kW
 * schedule still has a real bill worth showing; refusing to produce it would
 * hide the very fact that they are on the wrong schedule.
 */
export const Eligibility = z
  .object({
    voltageLevels: z.array(VoltageLevel).min(1),
    customerClasses: z.array(CustomerClass).min(1),
    demandRules: z.array(EligibilityRule),
    notes: z.string().optional(),
  })
  .strict();
export type Eligibility = z.infer<typeof Eligibility>;
