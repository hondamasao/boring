import type { ChargeType, Component, DayType } from '@boring/tariff-schema';

/**
 * Where a dollar figure came from: which record, which revision of the sheet,
 * and which field of that record.
 *
 * CLAUDE.md #5 — never assert a number without a citation. `path` is a JSON
 * pointer into the tariff document, so a disputed line traces to a specific
 * field of a specific revision.
 */
export interface TariffRef {
  tariffId: string;
  sheetRevision: string;
  /** JSON pointer, e.g. `/demandCharges/timeRelated/0`. */
  path: string;
}

/** How a line's amount is derived from its quantity and rate. */
export type LineBasis =
  | 'per-kwh'
  | 'per-kw'
  | 'per-kvar'
  | 'per-day'
  | 'per-month'
  | 'per-meter-day'
  | 'per-meter-month'
  | 'flat'
  | 'percent';

/**
 * One line of the bill. `amount` is already rounded to cents, so these are the
 * numbers a human compares against paper.
 *
 * `amount === quantity * rate` up to rounding for every basis except `flat`
 * (where quantity is 1) and `percent` (where quantity is the base subtotal).
 */
export interface BillLine {
  /** Unique within the bill. */
  id: string;
  chargeType: ChargeType;
  description: string;
  basis: LineBasis;
  quantity: number;
  /** Unit of `quantity`, for display: `kWh`, `kW`, `days`, `months`, `USD`. */
  unit: string;
  rate: number;
  /** Rounded to cents. */
  amount: number;
  component: Component;
  stage: number;
  /** Id of the tariff node that produced this line, for floors and rider scopes. */
  sourceId: string | null;
  seasonId?: string;
  periodId?: string;
  tariffRef: TariffRef;
  /** Anything a reader needs that the numbers do not carry — a ratchet's source
   * month, the segment a demand maximum came from, a rider's breakdown. */
  notes?: string[];
}

/**
 * How one demand charge's billed kW was arrived at. This is the audit trail for
 * the single most disputed number on a commercial bill.
 */
export interface DemandDetermination {
  chargeId: string;
  kind: 'facilities' | 'time-related';
  /** Null for an all-season facilities charge measured over the whole period. */
  seasonId: string | null;
  /** Null for facilities charges, which are not period-bound. */
  periodId: string | null;
  /** The span searched, for a `season-segment` charge. */
  segmentLabel: string | null;
  /** Highest metered window average in the span. */
  measuredPeakKw: number;
  /** Local start of the window that produced the maximum. Null when no data. */
  peakWindowStartLocal: string | null;
  /** What was billed: `max(measuredPeakKw, ratchet floor)`. */
  billedKw: number;
  ratchetApplied: null | {
    ratchetId: string;
    sourceMonth: string;
    priorPeakKw: number;
    floorKw: number;
  };
}

/** A run of consecutive local days in one season. */
export interface SeasonSegment {
  seasonId: string;
  /** Inclusive first local date. */
  startDate: string;
  /** Inclusive last local date. */
  endDate: string;
  days: number;
}

/** An eligibility rule that fired. */
export interface EligibilityFinding {
  ruleId: string;
  label: string;
  /** The schedule the customer would be moved to. */
  transferTo: string;
  detail: string;
  citation: string;
}

/** A rule that could not be evaluated, and why. Never silently treated as passing. */
export interface UnevaluatedRule {
  ruleId: string;
  reason: string;
}

/** One local day's calendar classification, for diagnostics. */
export interface DayClassification {
  date: string;
  seasonId: string;
  dayType: DayType;
  isHoliday: boolean;
  /** Elapsed hours in this local day: 23 on spring-forward, 25 on fall-back. */
  hours: number;
}

/**
 * A line-by-line bill.
 *
 * CLAUDE.md #3 — the engine returns an itemization, never a total. The
 * line-level output is what makes the golden fixture test and the billing-error
 * detector possible; a total alone is unfalsifiable.
 */
export interface ItemizedBill {
  tariffId: string;
  tariffProvenance: {
    sheetRevision: string;
    effectiveDate: string;
    sourceUrl: string;
  };
  billingPeriod: {
    start: string;
    /** Exclusive. */
    end: string;
    /** Local calendar days in `[start, end)`. */
    days: number;
    /** Elapsed hours — differs from `days * 24` across a DST transition. */
    hours: number;
    timezone: string;
  };
  lines: BillLine[];
  subtotals: {
    /** Sum of lines AT each stage, keyed by stage number as a string. */
    byStage: Record<string, number>;
    /** Running sum through and including each stage. */
    cumulativeThroughStage: Record<string, number>;
    byComponent: Record<string, number>;
  };
  /** Sum of every line's rounded amount. */
  total: number;
  warnings: string[];
  diagnostics: {
    /** kWh keyed `seasonId|periodId`. */
    kwhBySeasonPeriod: Record<string, number>;
    totalKwh: number;
    /** Maximum demand at any time in the period, computed whether or not the
     * schedule has a facilities charge — eligibility rules need it. */
    accountMaxDemandKw: number;
    accountMaxDemandAtLocal: string | null;
    /** The window length actually used, after any account-level override. */
    demandWindowMinutes: number;
    demandDeterminations: DemandDetermination[];
    seasonSegments: SeasonSegment[];
    days: DayClassification[];
    holidaysInPeriod: string[];
    eligibility: {
      findings: EligibilityFinding[];
      unevaluatedRules: UnevaluatedRule[];
    };
  };
}
