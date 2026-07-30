import type { ZodType, z } from 'zod';
import {
  ALL_STAGES,
  BillingPeriod,
  LoadProfile,
  PERCENT_RIDER_STAGES,
  RatingContext,
  STAGE,
  Tariff,
  allowedKvarAt,
  monthDayOrdinal,
  presentFixedCharges,
  seasonOrdinals,
  type Component,
  type EnergyCharge,
  type MinimumBill,
  type PercentRiderBase,
  type RatingContextInput,
  type TariffInput,
  type Tier,
} from '@boring/tariff-schema';
import { buildCalendar, type Calendar } from './calendar.js';
import { determineDemand } from './demand.js';
import { evaluateEligibility } from './eligibility.js';
import { RatingError } from './errors.js';
import { normalizeIntervals, peakKvar, peakOf, type DemandWindow } from './intervals.js';
import { makeLine, type LineContext } from './lines.js';
import { sumAmounts } from './money.js';
import type { BillLine, DemandDetermination, ItemizedBill } from './types.js';

/**
 * Rate a load profile against a tariff for one billing period.
 *
 * Pure and deterministic (CLAUDE.md #1): no network, no LLM, no file system, no
 * clock, no randomness. Every input is an argument — including the holiday
 * calendar and the prior-month demand history — so the same inputs always produce
 * the same itemization.
 *
 * All TOU bucketing happens in the tariff's local clock time and is DST-aware:
 * the spring-forward day has 23 hours, the fall-back day has 25, and a 4 pm - 9 pm
 * window is five clock-hours on both.
 *
 * Returns an itemization, never a bare total (CLAUDE.md #3). Anything the engine
 * can rate, it rates, recording its doubts in `warnings`; anything it cannot rate
 * it refuses with a `RatingError` rather than guessing.
 */
export function rate(
  loadProfile: LoadProfile,
  tariff: TariffInput,
  billingPeriod: BillingPeriod,
  context: RatingContextInput,
): ItemizedBill {
  // Validate at the boundary. Zod is pure — no I/O — and a malformed tariff must
  // fail here rather than three stages downstream with a plausible number.
  return rateValidated(
    parseOr(LoadProfile, loadProfile, 'load profile'),
    parseOr(Tariff, tariff, 'tariff'),
    parseOr(BillingPeriod, billingPeriod, 'billing period'),
    parseOr(RatingContext, context, 'rating context'),
  );
}

function parseOr<S extends ZodType>(schema: S, value: unknown, label: string): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data as z.output<S>;
  const detail = result.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new RatingError(`invalid ${label}:\n${detail}`, result.error.issues);
}

function rateValidated(
  profile: LoadProfile,
  tariff: Tariff,
  period: BillingPeriod,
  context: RatingContext,
): ItemizedBill {
  const warnings: string[] = [];

  if (tariff.timezone !== period.timezone || profile.timezone !== period.timezone) {
    throw new RatingError(
      `time zones must agree: tariff "${tariff.timezone}", billing period "${period.timezone}", load profile "${profile.timezone}"`,
    );
  }

  // CLAUDE.md #4 — a 2025 bill is rated with 2025 rates. Using a record outside
  // its effective window is the single easiest way to produce a confidently wrong
  // number, so say so loudly.
  if (period.start < tariff.provenance.effectiveDate) {
    warnings.push(
      `billing period starts ${period.start}, before tariff "${tariff.id}" takes effect on ${tariff.provenance.effectiveDate}; the rates applied are not the rates in force`,
    );
  }
  if (tariff.provenance.supersededDate !== null && period.end > tariff.provenance.supersededDate) {
    warnings.push(
      `billing period ends ${period.end}, after tariff "${tariff.id}" was superseded on ${tariff.provenance.supersededDate}; the rates applied are not the rates in force`,
    );
  }

  const calendar = buildCalendar(tariff, period, context.holidayCalendar);
  const lineContext: LineContext = {
    tariffId: tariff.id,
    sheetRevision: tariff.provenance.sheetRevision,
  };

  const windowMinutes =
    context.serviceAttributes.demandWindowMinutesOverride ?? tariff.demandMeasurement.windowMinutes;
  const intervals = normalizeIntervals(profile, calendar, windowMinutes);
  warnings.push(...intervals.warnings);

  if (intervals.readings.length === 0) {
    warnings.push('no interval readings fall inside the billing period; all metered quantities are zero');
  }

  // --- Metered quantities --------------------------------------------------
  const kwhBySeasonPeriod: Record<string, number> = {};
  let totalKwh = 0;
  for (const reading of intervals.readings) {
    const key = `${reading.placement.seasonId}|${reading.placement.periodId}`;
    kwhBySeasonPeriod[key] = (kwhBySeasonPeriod[key] ?? 0) + reading.kwh;
    totalKwh += reading.kwh;
  }

  const accountPeak = peakOf(intervals.windows);
  const days = calendar.days.length;
  const lines: BillLine[] = [];
  let lineCounter = 0;
  const nextId = (label: string): string => {
    lineCounter += 1;
    return `${String(lineCounter).padStart(3, '0')}-${label}`;
  };

  // --- STAGE 0: energy -----------------------------------------------------
  const seasonsInPeriod = new Set(calendar.segments.map((s) => s.seasonId));
  const sharedTierConsumption = { kwh: 0 };

  for (const charge of orderedEnergyCharges(tariff)) {
    // A charge for a season the period never touches did not apply at all, so it
    // gets no line — unlike a demand charge, which is a standing feature of the
    // schedule and reports its zero.
    if (!seasonsInPeriod.has(charge.seasonId)) continue;

    const index = tariff.energyCharges.indexOf(charge);
    const path = `/energyCharges/${index}`;
    const kwh = kwhBySeasonPeriod[`${charge.seasonId}|${charge.periodId}`] ?? 0;

    if (charge.pricing.kind === 'flat') {
      lines.push(
        makeLine(lineContext, {
          id: nextId(charge.id),
          chargeType: 'energy',
          description: charge.label,
          basis: 'per-kwh',
          quantity: kwh,
          unit: 'kWh',
          rate: charge.pricing.ratePerKwh,
          amount: kwh * charge.pricing.ratePerKwh,
          component: charge.component,
          stage: STAGE.ENERGY_AND_DEMAND,
          sourceId: charge.id,
          path,
          seasonId: charge.seasonId,
          periodId: charge.periodId,
        }),
      );
      continue;
    }

    const consumedBefore = charge.pricing.tierBasis === 'billing-period-total' ? sharedTierConsumption.kwh : 0;
    for (const block of splitIntoTiers(kwh, charge.pricing.tiers, consumedBefore)) {
      lines.push(
        makeLine(lineContext, {
          id: nextId(`${charge.id}-tier${block.tierIndex + 1}`),
          chargeType: 'energy',
          description: `${charge.label} — tier ${block.tierIndex + 1}${block.upperBound === null ? ' (over ' + String(block.lowerBound) + ' kWh)' : ' (to ' + String(block.upperBound) + ' kWh)'}`,
          basis: 'per-kwh',
          quantity: block.kwh,
          unit: 'kWh',
          rate: block.ratePerKwh,
          amount: block.kwh * block.ratePerKwh,
          component: charge.component,
          stage: STAGE.ENERGY_AND_DEMAND,
          sourceId: charge.id,
          path: `${path}/pricing/tiers/${block.tierIndex}`,
          seasonId: charge.seasonId,
          periodId: charge.periodId,
        }),
      );
    }
    if (charge.pricing.tierBasis === 'billing-period-total') sharedTierConsumption.kwh += kwh;
  }

  // --- STAGE 0: demand -----------------------------------------------------
  const currentMonth = billedMonth(calendar);
  const demand = determineDemand(tariff, calendar, intervals.windows, context.demandHistory, currentMonth);
  warnings.push(...demand.warnings);

  const facilitiesPath = new Map(tariff.demandCharges.facilities.map((c, i) => [c.id, `/demandCharges/facilities/${i}`]));
  const timeRelatedPath = new Map(tariff.demandCharges.timeRelated.map((c, i) => [c.id, `/demandCharges/timeRelated/${i}`]));
  const rateByChargeId = new Map<string, number>([
    ...tariff.demandCharges.facilities.map((c) => [c.id, c.ratePerKw] as const),
    ...tariff.demandCharges.timeRelated.map((c) => [c.id, c.ratePerKw] as const),
  ]);
  const componentByChargeId = new Map<string, Component>([
    ...tariff.demandCharges.facilities.map((c) => [c.id, c.component] as const),
    ...tariff.demandCharges.timeRelated.map((c) => [c.id, c.component] as const),
  ]);
  const labelByChargeId = new Map<string, string>([
    ...tariff.demandCharges.facilities.map((c) => [c.id, c.label] as const),
    ...tariff.demandCharges.timeRelated.map((c) => [c.id, c.label] as const),
  ]);

  for (const determination of demand.determinations) {
    const ratePerKw = rateByChargeId.get(determination.chargeId);
    const component = componentByChargeId.get(determination.chargeId);
    const label = labelByChargeId.get(determination.chargeId);
    if (ratePerKw === undefined || component === undefined || label === undefined) {
      throw new RatingError(`demand determination references unknown charge "${determination.chargeId}"`);
    }

    const notes: string[] = [];
    if (determination.segmentLabel !== null) notes.push(`measured over ${determination.segmentLabel}`);
    if (determination.peakWindowStartLocal !== null) {
      notes.push(`peak ${round4(determination.measuredPeakKw)} kW at ${determination.peakWindowStartLocal} over ${windowMinutes} minutes`);
    } else {
      notes.push('no metered intervals qualified for this charge in this period');
    }
    if (determination.ratchetApplied !== null) {
      const r = determination.ratchetApplied;
      notes.push(
        `ratchet "${r.ratchetId}" set the billed demand: ${round4(r.floorKw)} kW floor from ${round4(r.priorPeakKw)} kW in ${r.sourceMonth}, above this period's measured ${round4(determination.measuredPeakKw)} kW`,
      );
    }

    const draft = {
      id: nextId(determination.chargeId),
      description: determination.segmentLabel === null ? label : `${label} (${determination.segmentLabel})`,
      basis: 'per-kw' as const,
      quantity: determination.billedKw,
      unit: 'kW',
      rate: ratePerKw,
      amount: determination.billedKw * ratePerKw,
      component,
      stage: STAGE.ENERGY_AND_DEMAND,
      sourceId: determination.chargeId,
      notes,
    };

    if (determination.kind === 'facilities') {
      const path = facilitiesPath.get(determination.chargeId);
      lines.push(
        makeLine(lineContext, {
          ...draft,
          chargeType: 'facilities-demand',
          path: path ?? '/demandCharges/facilities',
          ...(determination.seasonId !== null ? { seasonId: determination.seasonId } : {}),
        }),
      );
    } else {
      const path = timeRelatedPath.get(determination.chargeId);
      lines.push(
        makeLine(lineContext, {
          ...draft,
          chargeType: 'time-related-demand',
          path: path ?? '/demandCharges/timeRelated',
          ...(determination.seasonId !== null ? { seasonId: determination.seasonId } : {}),
          ...(determination.periodId !== null ? { periodId: determination.periodId } : {}),
        }),
      );
    }
  }

  // --- STAGE 0: power factor ----------------------------------------------
  const pf = tariff.powerFactorAdjustment;
  if (pf !== null) {
    if (!intervals.hasReactiveData) {
      warnings.push(
        `tariff "${tariff.id}" has a power factor adjustment but the load profile carries no kvarh readings; the adjustment was billed at zero`,
      );
    }
    const observedKvar = peakKvar(intervals.windows);
    const allowedKvar = allowedKvarAt(accountPeak.kw, pf.thresholdPowerFactor);
    const billableKvar = Math.max(0, observedKvar - allowedKvar);
    lines.push(
      makeLine(lineContext, {
        id: nextId(pf.id),
        chargeType: 'power-factor-adjustment',
        description: pf.label,
        basis: 'per-kvar',
        quantity: billableKvar,
        unit: 'kVAR',
        rate: pf.ratePerKvar,
        amount: billableKvar * pf.ratePerKvar,
        component: pf.component,
        stage: STAGE.ENERGY_AND_DEMAND,
        sourceId: pf.id,
        path: '/powerFactorAdjustment',
        notes: [
          `peak reactive ${round4(observedKvar)} kVAR against an allowance of ${round4(allowedKvar)} kVAR at power factor ${pf.thresholdPowerFactor} on ${round4(accountPeak.kw)} kW`,
        ],
      }),
    );
  }

  // --- STAGE 1: fixed charges ---------------------------------------------
  for (const { slot, charge } of presentFixedCharges(tariff.fixedCharges)) {
    const { quantity, unit, basis } = fixedQuantity(charge.basis, days, period.meterCount);
    lines.push(
      makeLine(lineContext, {
        id: nextId(charge.id),
        chargeType: slot === 'meterCharge' ? 'meter-charge' : slot === 'dailyMinimumCharge' ? 'daily-minimum-charge' : 'customer-charge',
        description: charge.label,
        basis,
        quantity,
        unit,
        rate: charge.amount,
        amount: quantity * charge.amount,
        component: charge.component,
        stage: STAGE.FIXED_CHARGES,
        sourceId: charge.id,
        path: `/fixedCharges/${slot}`,
      }),
    );
  }

  // --- STAGE 2: usage riders ----------------------------------------------
  const billedKwByChargeId = new Map<string, number>();
  for (const determination of demand.determinations) {
    billedKwByChargeId.set(
      determination.chargeId,
      (billedKwByChargeId.get(determination.chargeId) ?? 0) + determination.billedKw,
    );
  }

  for (const [index, rider] of tariff.riders.entries()) {
    const path = `/riders/${index}`;
    if (rider.basis === 'per-kwh') {
      const kwh = scopedKwh(kwhBySeasonPeriod, rider.scope);
      lines.push(
        makeLine(lineContext, {
          id: nextId(rider.id),
          chargeType: 'rider',
          description: rider.label,
          basis: 'per-kwh',
          quantity: kwh,
          unit: 'kWh',
          rate: rider.ratePerKwh,
          amount: kwh * rider.ratePerKwh,
          component: rider.component,
          stage: STAGE.USAGE_RIDERS,
          sourceId: rider.id,
          path,
        }),
      );
    } else if (rider.basis === 'per-kw') {
      const ids = rider.scope.chargeIds ?? [...billedKwByChargeId.keys()];
      const kw = ids.reduce((sum, id) => sum + (billedKwByChargeId.get(id) ?? 0), 0);
      lines.push(
        makeLine(lineContext, {
          id: nextId(rider.id),
          chargeType: 'rider',
          description: rider.label,
          basis: 'per-kw',
          quantity: kw,
          unit: 'kW',
          rate: rider.ratePerKw,
          amount: kw * rider.ratePerKw,
          component: rider.component,
          stage: STAGE.USAGE_RIDERS,
          sourceId: rider.id,
          path,
          notes: [`billed demand from: ${ids.join(', ')}`],
        }),
      );
    }
  }

  // --- STAGE 3: flat riders -----------------------------------------------
  for (const [index, rider] of tariff.riders.entries()) {
    if (rider.basis !== 'flat') continue;
    const { quantity, unit, basis } = flatRiderQuantity(rider.per, days, period.meterCount);
    lines.push(
      makeLine(lineContext, {
        id: nextId(rider.id),
        chargeType: 'rider',
        description: rider.label,
        basis,
        quantity,
        unit,
        rate: rider.amount,
        amount: quantity * rider.amount,
        component: rider.component,
        stage: STAGE.FLAT_RIDERS,
        sourceId: rider.id,
        path: `/riders/${index}`,
      }),
    );
  }

  // --- STAGE 4: minimum bill ----------------------------------------------
  if (tariff.minimumBill !== null) {
    const floor = minimumFloor(tariff.minimumBill, lines, days, period.meterCount);
    const comparison = selectAmount(lines, {
      includeStages: tariff.minimumBill.comparisonScope.includeStages,
      chargeTypes: null,
      components: tariff.minimumBill.comparisonScope.components,
      excludeComponents: tariff.minimumBill.comparisonScope.excludeComponents,
    });
    const shortfall = floor - comparison;
    if (shortfall > 0) {
      lines.push(
        makeLine(lineContext, {
          id: nextId('minimum-bill-adjustment'),
          chargeType: 'minimum-bill-adjustment',
          description: 'Minimum Bill Adjustment',
          basis: 'flat',
          quantity: 1,
          unit: 'USD',
          rate: shortfall,
          amount: shortfall,
          component: tariff.minimumBill.component,
          stage: STAGE.MINIMUM_BILL,
          sourceId: 'minimum-bill',
          path: '/minimumBill',
          notes: [
            `minimum of ${floor.toFixed(2)} against ${comparison.toFixed(2)} of qualifying charges (stages ${tariff.minimumBill.comparisonScope.includeStages.join(', ')}); earlier lines are unchanged`,
          ],
        }),
      );
    }
  }

  // --- STAGES 5 and 6: percent-of-subtotal riders --------------------------
  for (const stage of PERCENT_RIDER_STAGES) {
    // Snapshot before this stage, so riders sharing a stage share a base and
    // never compound with each other.
    const snapshot = [...lines];
    for (const [index, rider] of tariff.riders.entries()) {
      if (rider.basis !== 'percent-of-subtotal') continue;
      if (rider.stage !== stage) continue;
      const base = selectAmount(snapshot, rider.base);
      lines.push(
        makeLine(lineContext, {
          id: nextId(rider.id),
          chargeType: 'rider',
          description: rider.label,
          basis: 'percent',
          quantity: base,
          unit: 'USD',
          rate: rider.percent,
          amount: base * rider.percent,
          component: rider.component,
          stage,
          sourceId: rider.id,
          path: `/riders/${index}`,
          notes: [`${(rider.percent * 100).toFixed(4).replace(/\.?0+$/, '')}% of stages ${rider.base.includeStages.join(', ')}`],
        }),
      );
    }
  }

  // --- Totals --------------------------------------------------------------
  const byStage: Record<string, number> = {};
  const cumulativeThroughStage: Record<string, number> = {};
  let running = 0;
  for (const stage of ALL_STAGES) {
    const stageTotal = sumAmounts(lines.filter((l) => l.stage === stage).map((l) => l.amount));
    byStage[String(stage)] = stageTotal;
    running = sumAmounts([running, stageTotal]);
    cumulativeThroughStage[String(stage)] = running;
  }

  const byComponent: Record<string, number> = {};
  for (const line of lines) {
    byComponent[line.component] = sumAmounts([byComponent[line.component] ?? 0, line.amount]);
  }

  const eligibility = evaluateEligibility(
    tariff,
    context.demandHistory,
    context.serviceAttributes,
    currentMonth,
    accountPeak.kw,
  );
  warnings.push(...eligibility.warnings);

  return {
    tariffId: tariff.id,
    tariffProvenance: {
      sheetRevision: tariff.provenance.sheetRevision,
      effectiveDate: tariff.provenance.effectiveDate,
      sourceUrl: tariff.provenance.sourceUrl,
    },
    billingPeriod: {
      start: period.start,
      end: period.end,
      days,
      hours: calendar.hours,
      timezone: period.timezone,
    },
    lines,
    subtotals: { byStage, cumulativeThroughStage, byComponent },
    total: sumAmounts(lines.map((l) => l.amount)),
    warnings,
    diagnostics: {
      kwhBySeasonPeriod,
      totalKwh,
      accountMaxDemandKw: accountPeak.kw,
      accountMaxDemandAtLocal: accountPeak.at,
      demandWindowMinutes: windowMinutes,
      demandDeterminations: demand.determinations,
      seasonSegments: calendar.segments,
      days: calendar.days,
      holidaysInPeriod: calendar.holidaysInPeriod,
      eligibility: {
        findings: eligibility.findings,
        unevaluatedRules: eligibility.unevaluatedRules,
      },
    },
  };
}

/**
 * The month a bill belongs to: the month of its LAST local day.
 *
 * `end` is exclusive, so a July 6 - August 1 period is a July bill. Reading the
 * month off the exclusive end would make it an August bill and shift every
 * ratchet lookback and eligibility window by one.
 */
function billedMonth(calendar: Calendar): string {
  const last = calendar.days[calendar.days.length - 1];
  if (last === undefined) {
    const fallback = calendar.periodStart.toISODate();
    if (fallback === null) throw new RatingError('billing period has no days');
    return fallback.slice(0, 7);
  }
  return last.date.slice(0, 7);
}

/**
 * Energy charges in a deterministic order: season by calendar start, then TOU
 * period rank, then component. Line order — and, for shared tier bases, which
 * charge consumes the first block — must be a property of the tariff rather than
 * of how the JSON happened to be written.
 */
function orderedEnergyCharges(tariff: Tariff): EnergyCharge[] {
  const seasonStart = new Map(
    tariff.seasons.map((season) => [season.id, monthDayOrdinal(season.start)] as const),
  );
  const seasonSpan = new Map(tariff.seasons.map((season) => [season.id, seasonOrdinals(season).length] as const));
  const periodRank = new Map(tariff.touPeriods.map((period) => [period.id, period.rank] as const));

  return [...tariff.energyCharges].sort((a, b) => {
    // A wrapping season starts late in the calendar but is the "first" season of
    // a year in no meaningful sense; ordering by start ordinal is arbitrary but
    // stable, which is all that is required.
    const seasonDiff = (seasonStart.get(a.seasonId) ?? 0) - (seasonStart.get(b.seasonId) ?? 0);
    if (seasonDiff !== 0) return seasonDiff;
    const spanDiff = (seasonSpan.get(a.seasonId) ?? 0) - (seasonSpan.get(b.seasonId) ?? 0);
    if (spanDiff !== 0) return spanDiff;
    const periodDiff = (periodRank.get(a.periodId) ?? 0) - (periodRank.get(b.periodId) ?? 0);
    if (periodDiff !== 0) return periodDiff;
    if (a.component !== b.component) return a.component < b.component ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

interface TierBlock {
  tierIndex: number;
  kwh: number;
  ratePerKwh: number;
  lowerBound: number;
  upperBound: number | null;
}

/** Splits `kwh` across tier blocks, starting from `consumedBefore` kWh already used. */
function splitIntoTiers(kwh: number, tiers: readonly Tier[], consumedBefore: number): TierBlock[] {
  const blocks: TierBlock[] = [];
  let cursor = consumedBefore;
  let remaining = kwh;
  let lowerBound = 0;

  for (const [tierIndex, tier] of tiers.entries()) {
    const upper = tier.upToKwh;
    const capacity = upper === null ? Number.POSITIVE_INFINITY : Math.max(0, upper - Math.max(cursor, lowerBound));
    if (remaining <= 0) break;
    if (upper !== null && cursor >= upper) {
      lowerBound = upper;
      continue;
    }
    const take = Math.min(remaining, capacity);
    if (take > 0) {
      blocks.push({ tierIndex, kwh: take, ratePerKwh: tier.ratePerKwh, lowerBound, upperBound: upper });
      remaining -= take;
      cursor += take;
    }
    if (upper !== null) lowerBound = upper;
  }

  // A tiered charge with no usage still reports its first block, so the reader can
  // see the tier structure rather than an absence.
  if (blocks.length === 0) {
    const first = tiers[0];
    if (first !== undefined) {
      blocks.push({ tierIndex: 0, kwh: 0, ratePerKwh: first.ratePerKwh, lowerBound: 0, upperBound: first.upToKwh });
    }
  }
  return blocks;
}

function fixedQuantity(
  basis: 'per-month' | 'per-day' | 'per-meter-per-month' | 'per-meter-per-day',
  days: number,
  meterCount: number,
): { quantity: number; unit: string; basis: 'per-day' | 'per-month' | 'per-meter-day' | 'per-meter-month' } {
  switch (basis) {
    case 'per-month':
      return { quantity: 1, unit: 'month', basis: 'per-month' };
    case 'per-day':
      return { quantity: days, unit: 'days', basis: 'per-day' };
    case 'per-meter-per-month':
      return { quantity: meterCount, unit: 'meter-months', basis: 'per-meter-month' };
    case 'per-meter-per-day':
      return { quantity: days * meterCount, unit: 'meter-days', basis: 'per-meter-day' };
  }
}

function flatRiderQuantity(
  per: 'month' | 'day' | 'meter-month' | 'meter-day',
  days: number,
  meterCount: number,
): { quantity: number; unit: string; basis: 'per-day' | 'per-month' | 'per-meter-day' | 'per-meter-month' } {
  switch (per) {
    case 'month':
      return { quantity: 1, unit: 'month', basis: 'per-month' };
    case 'day':
      return { quantity: days, unit: 'days', basis: 'per-day' };
    case 'meter-month':
      return { quantity: meterCount, unit: 'meter-months', basis: 'per-meter-month' };
    case 'meter-day':
      return { quantity: days * meterCount, unit: 'meter-days', basis: 'per-meter-day' };
  }
}

function scopedKwh(
  kwhBySeasonPeriod: Record<string, number>,
  scope: { seasonIds: string[] | null; periodIds: string[] | null },
): number {
  let total = 0;
  for (const [key, kwh] of Object.entries(kwhBySeasonPeriod)) {
    const [seasonId, periodId] = key.split('|') as [string, string];
    if (scope.seasonIds !== null && !scope.seasonIds.includes(seasonId)) continue;
    if (scope.periodIds !== null && !scope.periodIds.includes(periodId)) continue;
    total += kwh;
  }
  return total;
}

/** Sums the lines a base selector picks out. The one place a percentage's base is decided. */
function selectAmount(lines: readonly BillLine[], base: PercentRiderBase): number {
  const stages = new Set(base.includeStages);
  const matching = lines.filter(
    (line) =>
      stages.has(line.stage) &&
      (base.chargeTypes === null || base.chargeTypes.includes(line.chargeType)) &&
      (base.components === null || base.components.includes(line.component)) &&
      (base.excludeComponents === null || !base.excludeComponents.includes(line.component)),
  );
  return sumAmounts(matching.map((line) => line.amount));
}

function minimumFloor(
  minimumBill: MinimumBill,
  lines: readonly BillLine[],
  days: number,
  meterCount: number,
): number {
  switch (minimumBill.kind) {
    case 'per-day':
      return minimumBill.amountPerDay * days * (minimumBill.perMeter ? meterCount : 1);
    case 'per-month':
      return minimumBill.amountPerMonth * (minimumBill.perMeter ? meterCount : 1);
    case 'charge-floor': {
      const ids = new Set(minimumBill.floorChargeIds);
      return sumAmounts(
        lines.filter((line) => line.sourceId !== null && ids.has(line.sourceId)).map((line) => line.amount),
      );
    }
  }
}

/** Four decimals, for note text. Never used for money. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export type { DemandDetermination, DemandWindow };
