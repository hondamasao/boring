/**
 * Order of operations for assembling a bill.
 *
 * Every bill line carries its stage, and `ItemizedBill.subtotals.byStage`
 * exposes each boundary. That is what makes the base of a percent-of-subtotal
 * rider auditable instead of inferred: a rider names the stages it taxes, and
 * the reader can add up the lines and check.
 *
 * Rules that keep percentages deterministic:
 *  - riders at the SAME stage all compute against the same base, so they never
 *    compound with each other;
 *  - a rider at a LATER stage does see an earlier stage's rider amounts;
 *  - a rider's `base.includeStages` must contain only stages strictly less than
 *    its own (enforced by schema validation, not convention).
 */
export const STAGE = {
  /** Energy, facilities demand, time-related demand, power factor adjustment. */
  ENERGY_AND_DEMAND: 0,
  /** Customer charge, meter charge, additive daily charges. */
  FIXED_CHARGES: 1,
  /** Riders on a metered quantity: per-kWh and per-kW. */
  USAGE_RIDERS: 2,
  /** Riders that are a flat amount per month / day / meter. */
  FLAT_RIDERS: 3,
  /** Minimum-bill test. Emits a make-up line; never rewrites earlier lines. */
  MINIMUM_BILL: 4,
  /** First pass of percent-of-subtotal riders. */
  PERCENT_RIDERS_1: 5,
  /** Second pass — sees stage 5's amounts. For a tax on top of a tax. */
  PERCENT_RIDERS_2: 6,
} as const;

export type Stage = (typeof STAGE)[keyof typeof STAGE];

/** Stages at which a percent-of-subtotal rider may run. */
export const PERCENT_RIDER_STAGES = [STAGE.PERCENT_RIDERS_1, STAGE.PERCENT_RIDERS_2] as const;

/** All stages, ascending. */
export const ALL_STAGES: readonly number[] = Object.values(STAGE).sort((a, b) => a - b);

export const MAX_STAGE = STAGE.PERCENT_RIDERS_2;
