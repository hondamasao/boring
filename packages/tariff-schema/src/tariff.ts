import { z } from 'zod';
import {
  Citation,
  Identifier,
  IanaTimeZone,
  ChargeType,
} from './primitives.js';
import { Provenance } from './provenance.js';
import { Season, checkSeasonTiling } from './seasons.js';
import { HolidayTreatment, TouPeriodDef, TouRule, checkTouCoverage } from './tou.js';
import { EnergyCharge } from './energy.js';
import { DemandCharges, DemandMeasurement, chargeDeterminationsCarrySeason } from './demand.js';
import { DemandRatchet } from './ratchet.js';
import { FixedCharges, presentFixedCharges } from './fixed.js';
import { PowerFactorAdjustment } from './power-factor.js';
import { Rider } from './riders.js';
import { MinimumBill } from './minimum-bill.js';
import { Eligibility } from './eligibility.js';
import { RoundingPolicy } from './rounding.js';

/** Version of THIS schema, not of the tariff. A tariff's own version is its
 * `provenance.sheetRevision` plus `effectiveDate`. */
export const TARIFF_SCHEMA_VERSION = '1.0.0';

const TariffShape = z
  .object({
    schemaVersion: z.literal(TARIFF_SCHEMA_VERSION),

    /** Stable record id, e.g. `sce-tou-gs-2-e-2026-06-01`. */
    id: Identifier,

    /** First and only utility in v1. */
    utility: z.literal('SCE'),

    /** e.g. `TOU-GS-2`. */
    scheduleCode: z.string().min(1),

    /**
     * Rate option within the schedule, e.g. `E`. SCE's TOU-GS-2 is published
     * with several options whose charge STRUCTURE differs — per SCE's rate
     * summary, Option E carries facilities-related demand charges and no
     * time-related ones. Each option is therefore its own tariff record, and
     * conflating them would silently rate a customer on charges they do not pay.
     */
    optionCode: z.string().min(1).nullable(),

    title: z.string().min(1),

    /** All TOU logic happens in this zone's local clock. */
    timezone: IanaTimeZone,

    provenance: Provenance,
    eligibility: Eligibility,
    demandMeasurement: DemandMeasurement,

    seasons: z.array(Season).min(1),
    touPeriods: z.array(TouPeriodDef).min(1),
    touRules: z.array(TouRule).min(1),
    holidayTreatment: HolidayTreatment,

    energyCharges: z.array(EnergyCharge),
    demandCharges: DemandCharges,
    ratchets: z.array(DemandRatchet),
    powerFactorAdjustment: PowerFactorAdjustment.nullable(),

    fixedCharges: FixedCharges,
    riders: z.array(Rider),
    minimumBill: MinimumBill.nullable(),

    rounding: RoundingPolicy,

    /** Anything a reader of this record needs that the fields cannot carry. */
    notes: z.string().optional(),
  })
  .strict();

/** Collects duplicate values, for id-uniqueness messages. */
function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

/**
 * A fully validated tariff.
 *
 * The refinements below are the point of this package. Each rejects a document
 * that would otherwise rate successfully and wrongly: a season gap has no rate,
 * an overlapping TOU rule makes the answer depend on array order, a ratchet
 * pointing at a missing charge silently does nothing. All of them fail loudly at
 * parse time instead.
 */
export const Tariff = TariffShape.superRefine((tariff, ctx) => {
  const problem = (message: string, path: (string | number)[] = []): void => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
  };

  // --- Seasons -------------------------------------------------------------
  for (const dupe of duplicates(tariff.seasons.map((s) => s.id))) {
    problem(`duplicate season id "${dupe}"`, ['seasons']);
  }
  for (const message of checkSeasonTiling(tariff.seasons)) {
    problem(message, ['seasons']);
  }
  const seasonIds = new Set(tariff.seasons.map((s) => s.id));

  // --- TOU periods and rules ----------------------------------------------
  for (const dupe of duplicates(tariff.touPeriods.map((p) => p.id))) {
    problem(`duplicate TOU period id "${dupe}"`, ['touPeriods']);
  }
  const periodIds = new Set(tariff.touPeriods.map((p) => p.id));

  let touRefsValid = true;
  for (const [index, rule] of tariff.touRules.entries()) {
    if (!seasonIds.has(rule.seasonId)) {
      problem(`unknown seasonId "${rule.seasonId}"`, ['touRules', index, 'seasonId']);
      touRefsValid = false;
    }
    if (!periodIds.has(rule.periodId)) {
      problem(`unknown periodId "${rule.periodId}"`, ['touRules', index, 'periodId']);
      touRefsValid = false;
    }
  }
  // Coverage over unresolvable references would report every hour as a gap and
  // bury the one real error.
  if (touRefsValid) {
    for (const message of checkTouCoverage(tariff.seasons, tariff.touRules, tariff.holidayTreatment)) {
      problem(message, ['touRules']);
    }
  }

  // --- Energy charges ------------------------------------------------------
  const energyKeys = new Set<string>();
  for (const [index, charge] of tariff.energyCharges.entries()) {
    if (!seasonIds.has(charge.seasonId)) {
      problem(`unknown seasonId "${charge.seasonId}"`, ['energyCharges', index, 'seasonId']);
    }
    if (!periodIds.has(charge.periodId)) {
      problem(`unknown periodId "${charge.periodId}"`, ['energyCharges', index, 'periodId']);
    }
    const key = `${charge.seasonId}|${charge.periodId}|${charge.component}`;
    if (energyKeys.has(key)) {
      problem(
        `duplicate energy charge for season "${charge.seasonId}", period "${charge.periodId}", component "${charge.component}" — the engine would bill both`,
        ['energyCharges', index],
      );
    }
    energyKeys.add(key);
  }

  // --- Every reachable (season, period) must be priced, and vice versa ------
  // An unpriced combination bills that energy at zero: free electricity, no
  // error, wrong bill. A priced combination the TOU table can never produce is a
  // transcription mistake worth surfacing rather than silently ignoring.
  if (touRefsValid) {
    const reachable = new Set(tariff.touRules.map((r) => `${r.seasonId}|${r.periodId}`));
    const priced = new Set(tariff.energyCharges.map((c) => `${c.seasonId}|${c.periodId}`));

    for (const pair of [...reachable].sort()) {
      if (!priced.has(pair)) {
        const [seasonId, periodId] = pair.split('|');
        problem(
          `no energy charge for season "${seasonId}" period "${periodId}", which the TOU table can produce; that energy would be billed at zero`,
          ['energyCharges'],
        );
      }
    }
    for (const [index, charge] of tariff.energyCharges.entries()) {
      if (!reachable.has(`${charge.seasonId}|${charge.periodId}`)) {
        problem(
          `season "${charge.seasonId}" never contains period "${charge.periodId}" in the TOU table, so this charge can never apply`,
          ['energyCharges', index],
        );
      }
    }
    for (const [index, charge] of tariff.demandCharges.timeRelated.entries()) {
      if (!reachable.has(`${charge.seasonId}|${charge.periodId}`)) {
        problem(
          `season "${charge.seasonId}" never contains period "${charge.periodId}" in the TOU table, so this demand charge can never apply`,
          ['demandCharges', 'timeRelated', index],
        );
      }
    }
  }

  // --- Demand charges ------------------------------------------------------
  for (const [index, charge] of tariff.demandCharges.facilities.entries()) {
    if (charge.seasonId !== null && !seasonIds.has(charge.seasonId)) {
      problem(`unknown seasonId "${charge.seasonId}"`, [
        'demandCharges',
        'facilities',
        index,
        'seasonId',
      ]);
    }
  }
  for (const [index, charge] of tariff.demandCharges.timeRelated.entries()) {
    if (!seasonIds.has(charge.seasonId)) {
      problem(`unknown seasonId "${charge.seasonId}"`, [
        'demandCharges',
        'timeRelated',
        index,
        'seasonId',
      ]);
    }
    if (!periodIds.has(charge.periodId)) {
      problem(`unknown periodId "${charge.periodId}"`, [
        'demandCharges',
        'timeRelated',
        index,
        'periodId',
      ]);
    }
  }

  // --- One id namespace for everything a ratchet, rider or minimum can cite -
  const facilitiesById = new Map(tariff.demandCharges.facilities.map((c) => [c.id, c]));
  const timeRelatedById = new Map(tariff.demandCharges.timeRelated.map((c) => [c.id, c]));
  const fixedById = new Map(presentFixedCharges(tariff.fixedCharges).map(({ charge }) => [charge.id, charge]));

  const allIds = [
    ...tariff.energyCharges.map((c) => c.id),
    ...tariff.demandCharges.facilities.map((c) => c.id),
    ...tariff.demandCharges.timeRelated.map((c) => c.id),
    ...[...fixedById.keys()],
    ...tariff.riders.map((r) => r.id),
    ...tariff.ratchets.map((r) => r.id),
    ...tariff.eligibility.demandRules.map((r) => r.id),
    ...(tariff.powerFactorAdjustment ? [tariff.powerFactorAdjustment.id] : []),
  ];
  for (const dupe of duplicates(allIds)) {
    problem(
      `id "${dupe}" is used more than once; charge, rider, ratchet and eligibility ids share one namespace because ratchets, rider scopes and minimum-bill floors resolve against it`,
    );
  }

  // --- Ratchets ------------------------------------------------------------
  for (const [index, ratchet] of tariff.ratchets.entries()) {
    const target =
      ratchet.appliesTo.kind === 'facilities'
        ? facilitiesById.get(ratchet.appliesTo.chargeId)
        : timeRelatedById.get(ratchet.appliesTo.chargeId);

    if (target === undefined) {
      problem(
        `no ${ratchet.appliesTo.kind} demand charge with id "${ratchet.appliesTo.chargeId}"`,
        ['ratchets', index, 'appliesTo', 'chargeId'],
      );
      continue;
    }
    if (ratchet.seasonScope === 'same-season-only' && !chargeDeterminationsCarrySeason(target)) {
      problem(
        `seasonScope "same-season-only" needs the target charge to be season-bound: give "${target.id}" a seasonId, or set measuredOver to "season-segment"`,
        ['ratchets', index, 'seasonScope'],
      );
    }
  }

  // --- Riders --------------------------------------------------------------
  for (const [index, rider] of tariff.riders.entries()) {
    if (rider.basis === 'per-kwh') {
      for (const id of rider.scope.seasonIds ?? []) {
        if (!seasonIds.has(id)) {
          problem(`unknown seasonId "${id}"`, ['riders', index, 'scope', 'seasonIds']);
        }
      }
      for (const id of rider.scope.periodIds ?? []) {
        if (!periodIds.has(id)) {
          problem(`unknown periodId "${id}"`, ['riders', index, 'scope', 'periodIds']);
        }
      }
    }
    if (rider.basis === 'per-kw') {
      for (const id of rider.scope.chargeIds ?? []) {
        if (!facilitiesById.has(id) && !timeRelatedById.has(id)) {
          problem(`no demand charge with id "${id}"`, ['riders', index, 'scope', 'chargeIds']);
        }
      }
    }
  }

  // --- Minimum bill --------------------------------------------------------
  if (tariff.minimumBill !== null && tariff.minimumBill.kind === 'charge-floor') {
    for (const [index, id] of tariff.minimumBill.floorChargeIds.entries()) {
      if (!fixedById.has(id) && !facilitiesById.has(id) && !timeRelatedById.has(id)) {
        problem(
          `floorChargeIds references "${id}", which is not a fixed charge or a demand charge`,
          ['minimumBill', 'floorChargeIds', index],
        );
      }
    }
  }

  // --- Real-time pricing is out of scope for v1 ----------------------------
  if (/-RTP\b/i.test(tariff.scheduleCode) || /^RTP$/i.test(tariff.optionCode ?? '')) {
    problem(
      `real-time pricing schedules are out of scope for v1: rating "${tariff.scheduleCode}" needs hourly market prices, which this schema does not carry and the engine cannot fetch`,
      ['scheduleCode'],
    );
  }

  // --- Power factor needs reactive data to be usable -----------------------
  if (tariff.powerFactorAdjustment !== null && tariff.demandCharges.facilities.length === 0 && tariff.demandCharges.timeRelated.length === 0) {
    problem(
      'powerFactorAdjustment is set but the schedule has no demand charges, so there is no demand for it to adjust',
      ['powerFactorAdjustment'],
    );
  }
});

export type Tariff = z.infer<typeof Tariff>;

/** Charge types a percent rider base may name. Re-exported for JSON authors. */
export const PERCENT_BASE_CHARGE_TYPES = ChargeType.options;

/** A citation-bearing node, for the report layer. */
export type Cited = { citation: z.infer<typeof Citation> };
