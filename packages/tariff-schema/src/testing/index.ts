/**
 * SYNTHETIC tariff builders for tests.
 *
 * ⚠️  Nothing in this file is transcribed from a real SCE tariff sheet. The rates
 * are round numbers chosen so expected bills can be computed by hand. They exist
 * to exercise engine mechanics — DST bucketing, the two demand families,
 * ratchets, rider ordering — NOT to produce correct SCE bills.
 *
 * Real tariffs live in `packages/tariff-library`, carry provenance pointing at a
 * PDF, and are verified by a human. Never copy a rate out of this file into one.
 *
 * These builders live in the schema package (behind the `/testing` subpath) so
 * that the engine and the fixture harness test against documents the schema
 * itself certifies as valid, rather than each package keeping a drifting copy.
 */
import { TARIFF_SCHEMA_VERSION, type Tariff } from '../tariff.js';
import type { Season } from '../seasons.js';
import type { TouPeriodDef, TouRule } from '../tou.js';
import type { HolidayCalendar } from '../inputs.js';
import { DEFAULT_ROUNDING } from '../rounding.js';

const SYNTHETIC = 'SYNTHETIC — not from any tariff sheet';

/** Summer June 1 - September 30; winter October 1 - May 31 (wraps the year). */
export function syntheticSeasons(): Season[] {
  return [
    {
      id: 'summer',
      label: 'Summer',
      start: { month: 6, day: 1 },
      end: { month: 9, day: 30 },
      citation: SYNTHETIC,
    },
    {
      id: 'winter',
      label: 'Winter',
      start: { month: 10, day: 1 },
      end: { month: 5, day: 31 },
      citation: SYNTHETIC,
    },
  ];
}

export function syntheticTouPeriods(): TouPeriodDef[] {
  return [
    { id: 'on-peak', label: 'On-Peak', rank: 0 },
    { id: 'mid-peak', label: 'Mid-Peak', rank: 1 },
    { id: 'off-peak', label: 'Off-Peak', rank: 2 },
  ];
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
const WEEKENDS = ['sat', 'sun'] as const;

/**
 * An exhaustive, non-overlapping TOU table shaped like a modern SCE schedule:
 * a 4 pm - 9 pm peak window, weekends softer than weekdays, and no summer peak
 * on weekends.
 *
 *   summer weekday   00-16 off-peak, 16-21 ON-peak,  21-24 off-peak
 *   summer weekend   00-16 off-peak, 16-21 mid-peak, 21-24 off-peak
 *   winter weekday   00-16 off-peak, 16-21 mid-peak, 21-24 off-peak
 *   winter weekend   00-24 off-peak
 */
export function syntheticTouRules(): TouRule[] {
  return [
    { seasonId: 'summer', dayTypes: [...WEEKDAYS], hours: { startHour: 0, endHour: 16 }, periodId: 'off-peak' },
    { seasonId: 'summer', dayTypes: [...WEEKDAYS], hours: { startHour: 16, endHour: 21 }, periodId: 'on-peak' },
    { seasonId: 'summer', dayTypes: [...WEEKDAYS], hours: { startHour: 21, endHour: 24 }, periodId: 'off-peak' },

    { seasonId: 'summer', dayTypes: [...WEEKENDS], hours: { startHour: 0, endHour: 16 }, periodId: 'off-peak' },
    { seasonId: 'summer', dayTypes: [...WEEKENDS], hours: { startHour: 16, endHour: 21 }, periodId: 'mid-peak' },
    { seasonId: 'summer', dayTypes: [...WEEKENDS], hours: { startHour: 21, endHour: 24 }, periodId: 'off-peak' },

    { seasonId: 'winter', dayTypes: [...WEEKDAYS], hours: { startHour: 0, endHour: 16 }, periodId: 'off-peak' },
    { seasonId: 'winter', dayTypes: [...WEEKDAYS], hours: { startHour: 16, endHour: 21 }, periodId: 'mid-peak' },
    { seasonId: 'winter', dayTypes: [...WEEKDAYS], hours: { startHour: 21, endHour: 24 }, periodId: 'off-peak' },

    { seasonId: 'winter', dayTypes: [...WEEKENDS], hours: { startHour: 0, endHour: 24 }, periodId: 'off-peak' },
  ];
}

/**
 * Baseline synthetic tariff.
 *
 * Rates are deliberately round:
 *   energy   summer on-peak 0.30, summer mid-peak 0.20, summer off-peak 0.10
 *            winter mid-peak 0.15, winter off-peak 0.08   ($/kWh)
 *   demand   facilities 20.00 $/kW (all hours, all seasons)
 *            summer on-peak time-related 12.00 $/kW
 *   fixed    customer charge 100.00 $/month
 *
 * Holidays are rated on the SUNDAY schedule, which in summer means a holiday
 * that would have been on-peak becomes mid-peak. The "holiday is off-peak"
 * reading is a one-field change (`holidayTreatment.mapsToDayType`), and both are
 * exercised by the tests.
 */
export function makeSyntheticTariff(overrides: Partial<Tariff> = {}): Tariff {
  const base: Tariff = {
    schemaVersion: TARIFF_SCHEMA_VERSION,
    id: 'synthetic-baseline',
    utility: 'SCE',
    scheduleCode: 'SYNTHETIC-TOU',
    optionCode: null,
    title: 'Synthetic TOU schedule (test fixture — not a real tariff)',
    timezone: 'America/Los_Angeles',

    provenance: {
      sourceUrl: 'https://example.invalid/synthetic-tariff',
      sheetRevision: 'SYNTHETIC-000',
      effectiveDate: '2026-01-01',
      supersededDate: null,
      verifiedAt: '2026-01-01T00:00:00Z',
      verifiedBy: 'test fixture',
      transcriptionNotes: SYNTHETIC,
    },

    eligibility: {
      voltageLevels: ['secondary'],
      customerClasses: ['general-service'],
      demandRules: [],
    },

    demandMeasurement: { windowMinutes: 15, citation: SYNTHETIC },

    seasons: syntheticSeasons(),
    touPeriods: syntheticTouPeriods(),
    touRules: syntheticTouRules(),
    holidayTreatment: { mapsToDayType: 'sun', citation: SYNTHETIC },

    energyCharges: [
      {
        id: 'energy-summer-on-peak',
        label: 'Summer On-Peak Energy',
        seasonId: 'summer',
        periodId: 'on-peak',
        component: 'delivery',
        pricing: { kind: 'flat', ratePerKwh: 0.3 },
        citation: SYNTHETIC,
      },
      {
        id: 'energy-summer-mid-peak',
        label: 'Summer Mid-Peak Energy',
        seasonId: 'summer',
        periodId: 'mid-peak',
        component: 'delivery',
        pricing: { kind: 'flat', ratePerKwh: 0.2 },
        citation: SYNTHETIC,
      },
      {
        id: 'energy-summer-off-peak',
        label: 'Summer Off-Peak Energy',
        seasonId: 'summer',
        periodId: 'off-peak',
        component: 'delivery',
        pricing: { kind: 'flat', ratePerKwh: 0.1 },
        citation: SYNTHETIC,
      },
      {
        id: 'energy-winter-mid-peak',
        label: 'Winter Mid-Peak Energy',
        seasonId: 'winter',
        periodId: 'mid-peak',
        component: 'delivery',
        pricing: { kind: 'flat', ratePerKwh: 0.15 },
        citation: SYNTHETIC,
      },
      {
        id: 'energy-winter-off-peak',
        label: 'Winter Off-Peak Energy',
        seasonId: 'winter',
        periodId: 'off-peak',
        component: 'delivery',
        pricing: { kind: 'flat', ratePerKwh: 0.08 },
        citation: SYNTHETIC,
      },
    ],

    demandCharges: {
      facilities: [
        {
          kind: 'facilities',
          id: 'frd',
          label: 'Facilities-Related Demand',
          seasonId: null,
          component: 'delivery',
          ratePerKw: 20,
          measuredOver: 'billing-period',
          citation: SYNTHETIC,
        },
      ],
      timeRelated: [
        {
          kind: 'time-related',
          id: 'trd-summer-on-peak',
          label: 'Summer On-Peak Time-Related Demand',
          seasonId: 'summer',
          periodId: 'on-peak',
          component: 'delivery',
          ratePerKw: 12,
          measuredOver: 'billing-period',
          citation: SYNTHETIC,
        },
      ],
    },

    ratchets: [],
    powerFactorAdjustment: null,

    fixedCharges: {
      customerCharge: {
        id: 'customer-charge',
        label: 'Customer Charge',
        basis: 'per-month',
        amount: 100,
        component: 'delivery',
        citation: SYNTHETIC,
      },
      meterCharge: null,
      dailyMinimumCharge: null,
    },

    riders: [],
    minimumBill: null,
    rounding: DEFAULT_ROUNDING,
    notes: SYNTHETIC,
  };

  return { ...base, ...overrides };
}

/**
 * Eligibility rules shaped like TOU-GS-2's applicability paragraph, for testing
 * the history-dependent evaluator.
 *
 * ⚠️  The THRESHOLDS (20 kW / 200 kW) and the transfer targets are real; the
 * exact wording, the three-months-of-twelve counting and the twelve-consecutive-
 * months counting are as described in the task, NOT read off the sheet by this
 * code. Verify against the sheet before shipping these in a real tariff record.
 */
export function syntheticTouGs2EligibilityRules(): Tariff['eligibility']['demandRules'] {
  return [
    {
      kind: 'demand-at-or-above-threshold-in-n-months',
      id: 'above-200-kw-three-of-twelve',
      label: 'Reached 200 kW in any three months of the preceding twelve',
      thresholdKw: 200,
      monthCount: 3,
      windowMonths: 12,
      windowIncludesCurrentMonth: true,
      transferTo: 'TOU-GS-3',
      citation: `${SYNTHETIC} (thresholds per task description; verify against sheet)`,
    },
    {
      kind: 'demand-at-or-below-threshold-for-n-consecutive-months',
      id: 'at-or-below-20-kw-twelve-consecutive',
      label: 'At or below 20 kW for twelve consecutive months',
      thresholdKw: 20,
      monthCount: 12,
      windowIncludesCurrentMonth: true,
      transferTo: 'TOU-GS-1',
      citation: `${SYNTHETIC} (thresholds per task description; verify against sheet)`,
    },
    {
      kind: 'expected-demand-at-or-above-threshold',
      id: 'expected-to-reach-200-kw',
      label: 'Expected to reach 200 kW',
      thresholdKw: 200,
      transferTo: 'TOU-GS-3',
      citation: `${SYNTHETIC} (thresholds per task description; verify against sheet)`,
    },
  ];
}

/**
 * A holiday calendar for tests. `observedDates` are already observed-shifted, as
 * the engine requires — July 4 2026 falls on a Saturday, so the observed holiday
 * is Friday July 3.
 */
export function syntheticHolidayCalendar(observedDates: string[] = []): HolidayCalendar {
  return {
    utility: 'SYNTHETIC',
    source: SYNTHETIC,
    observedDates,
  };
}
