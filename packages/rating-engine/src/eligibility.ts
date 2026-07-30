import type { DemandHistory, ServiceAttributes, Tariff } from '@boring/tariff-schema';
import { monthWindow } from './months.js';
import type { EligibilityFinding, UnevaluatedRule } from './types.js';

/**
 * Evaluates eligibility rules against demand history.
 *
 * Three principles:
 *  - a rule that FIRES names the schedule the customer would be transferred TO,
 *    because recommending a schedule they get moved off of is worse than making no
 *    recommendation;
 *  - a rule that cannot be evaluated is reported as unevaluated, never as passing.
 *    A gap in the history reading as a quiet pass is how a customer ends up on a
 *    schedule they were never eligible for;
 *  - a rule whose wording is genuinely ambiguous (does "preceding 12 months"
 *    include the month being billed?) gets evaluated under ONE interpretation
 *    (`rule.windowIncludesCurrentMonth`, a documented, citable choice — see
 *    packages/tariff-library/PENDING.md), but if the OTHER interpretation would
 *    have produced a different fire/no-fire answer, that disagreement is surfaced
 *    as an explicit warning rather than silently absorbed into a single verdict.
 *    A flat pass/fail on contested wording is a confidently wrong answer wearing
 *    a certain one's clothes.
 *
 * Demand means maximum demand at any time in the month — the facilities-related
 * sense — so the current month contributes the account maximum the engine computed
 * whether or not the schedule has a facilities charge.
 */
export interface EligibilityResult {
  findings: EligibilityFinding[];
  unevaluatedRules: UnevaluatedRule[];
  warnings: string[];
}

/** Result of testing one history-dependent rule under one reading of
 * "windowIncludesCurrentMonth". */
interface RuleOutcome {
  /** False when the data needed to answer under THIS reading isn't available. */
  evaluable: boolean;
  fires: boolean;
}

function evaluateAboveThresholdInNMonths(
  rule: Extract<Tariff['eligibility']['demandRules'][number], { kind: 'demand-at-or-above-threshold-in-n-months' }>,
  peaks: ReadonlyMap<string, number>,
  currentMonth: string,
  windowIncludesCurrentMonth: boolean,
): RuleOutcome & { qualifying: string[] } {
  const months = monthWindow(currentMonth, rule.windowMonths, windowIncludesCurrentMonth);
  const qualifying = months.filter((month) => {
    const peak = peaks.get(month);
    return peak !== undefined && peak >= rule.thresholdKw;
  });
  // Every month in the window contributes to the count as "not qualifying" when
  // absent — that's the natural reading of "at or above" over a window with
  // partial data, unlike the "at or below FOR EVERY month" rule below, where a
  // gap makes the whole run unevaluable. So this reading is always evaluable.
  return { evaluable: true, fires: qualifying.length >= rule.monthCount, qualifying };
}

function evaluateAtOrBelowForNConsecutiveMonths(
  rule: Extract<
    Tariff['eligibility']['demandRules'][number],
    { kind: 'demand-at-or-below-threshold-for-n-consecutive-months' }
  >,
  peaks: ReadonlyMap<string, number>,
  currentMonth: string,
  windowIncludesCurrentMonth: boolean,
): RuleOutcome & { missing: string[] } {
  const months = monthWindow(currentMonth, rule.monthCount, windowIncludesCurrentMonth);
  const missing = months.filter((month) => !peaks.has(month));
  if (missing.length > 0) return { evaluable: false, fires: false, missing };
  const fires = months.every((month) => (peaks.get(month) as number) <= rule.thresholdKw);
  return { evaluable: true, fires, missing };
}

export function evaluateEligibility(
  tariff: Tariff,
  history: DemandHistory,
  serviceAttributes: ServiceAttributes,
  currentMonth: string,
  currentMonthMaxKw: number,
): EligibilityResult {
  const findings: EligibilityFinding[] = [];
  const unevaluatedRules: UnevaluatedRule[] = [];
  const warnings: string[] = [];

  // Static attributes first — cheap, and independent of history.
  const { voltageLevel, customerClass } = serviceAttributes;
  if (voltageLevel !== undefined && !tariff.eligibility.voltageLevels.includes(voltageLevel)) {
    warnings.push(
      `service voltage level "${voltageLevel}" is not served by ${tariff.scheduleCode}, which serves ${tariff.eligibility.voltageLevels.join(', ')}`,
    );
  }
  if (customerClass !== undefined && !tariff.eligibility.customerClasses.includes(customerClass)) {
    warnings.push(
      `customer class "${customerClass}" is not served by ${tariff.scheduleCode}, which serves ${tariff.eligibility.customerClasses.join(', ')}`,
    );
  }

  const peaks = new Map<string, number>();
  for (const entry of history.entries) peaks.set(entry.month, entry.facilitiesPeakKw);
  // The month being billed is the most recent data point there is.
  peaks.set(currentMonth, currentMonthMaxKw);

  for (const rule of tariff.eligibility.demandRules) {
    switch (rule.kind) {
      case 'demand-at-or-above-threshold-in-n-months': {
        const chosen = evaluateAboveThresholdInNMonths(rule, peaks, currentMonth, rule.windowIncludesCurrentMonth);
        if (chosen.fires) {
          findings.push({
            ruleId: rule.id,
            label: rule.label,
            transferTo: rule.transferTo,
            detail: `reached ${rule.thresholdKw} kW in ${chosen.qualifying.length} of the ${rule.windowMonths} months ending ${currentMonth} (${chosen.qualifying.join(', ')}), meeting the threshold of ${rule.monthCount}`,
            citation: rule.citation,
          });
        }

        const other = evaluateAboveThresholdInNMonths(rule, peaks, currentMonth, !rule.windowIncludesCurrentMonth);
        if (other.fires !== chosen.fires) {
          warnings.push(
            ambiguousZoneWarning(tariff, rule.label, currentMonth, rule.windowIncludesCurrentMonth, chosen.fires, other.fires, rule.transferTo),
          );
        }
        break;
      }

      case 'demand-at-or-below-threshold-for-n-consecutive-months': {
        const chosen = evaluateAtOrBelowForNConsecutiveMonths(
          rule,
          peaks,
          currentMonth,
          rule.windowIncludesCurrentMonth,
        );
        if (!chosen.evaluable) {
          unevaluatedRules.push({
            ruleId: rule.id,
            reason: `needs demand for all ${rule.monthCount} months ending ${currentMonth}; missing ${chosen.missing.sort().join(', ')}`,
          });
          break;
        }
        if (chosen.fires) {
          findings.push({
            ruleId: rule.id,
            label: rule.label,
            transferTo: rule.transferTo,
            detail: `at or below ${rule.thresholdKw} kW for all ${rule.monthCount} months ending ${currentMonth}`,
            citation: rule.citation,
          });
        }

        // Only compare against the other reading when it too has complete data —
        // an unevaluable alternate reading can't confirm or deny a disagreement.
        const other = evaluateAtOrBelowForNConsecutiveMonths(
          rule,
          peaks,
          currentMonth,
          !rule.windowIncludesCurrentMonth,
        );
        if (other.evaluable && other.fires !== chosen.fires) {
          warnings.push(
            ambiguousZoneWarning(tariff, rule.label, currentMonth, rule.windowIncludesCurrentMonth, chosen.fires, other.fires, rule.transferTo),
          );
        }
        break;
      }

      case 'expected-demand-at-or-above-threshold': {
        const expected = serviceAttributes.expectedMaxDemandKw;
        if (expected === undefined) {
          unevaluatedRules.push({
            ruleId: rule.id,
            reason:
              'needs serviceAttributes.expectedMaxDemandKw; a forward-looking expectation cannot be derived from meter data',
          });
          break;
        }
        if (expected >= rule.thresholdKw) {
          findings.push({
            ruleId: rule.id,
            label: rule.label,
            transferTo: rule.transferTo,
            detail: `declared expected maximum demand of ${expected} kW is at or above ${rule.thresholdKw} kW`,
            citation: rule.citation,
          });
        }
        break;
      }
    }
  }

  for (const finding of findings) {
    warnings.push(
      `${tariff.scheduleCode} eligibility: ${finding.label} — ${finding.detail}. The customer would be transferred to ${finding.transferTo}.`,
    );
  }

  return { findings, unevaluatedRules, warnings };
}

/** Describes an outcome as a human-readable verdict, for the ambiguous-zone message. */
function describeVerdict(fires: boolean, transferTo: string): string {
  return fires ? `FIRES (transfer to ${transferTo})` : 'does not fire';
}

function ambiguousZoneWarning(
  tariff: Tariff,
  ruleLabel: string,
  currentMonth: string,
  windowIncludesCurrentMonth: boolean,
  chosenFires: boolean,
  otherFires: boolean,
  transferTo: string,
): string {
  return (
    `${tariff.scheduleCode} eligibility rule "${ruleLabel}": customer is in the AMBIGUOUS ZONE for month ${currentMonth} — ` +
    `whether this rule fires depends on whether the window is read to include the month being billed. ` +
    `Interpretation used: windowIncludesCurrentMonth=${windowIncludesCurrentMonth} → ${describeVerdict(chosenFires, transferTo)}; ` +
    `the other reading would ${describeVerdict(otherFires, transferTo)}. Verify against SCE directly before acting on this.`
  );
}
