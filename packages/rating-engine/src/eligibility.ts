import type { DemandHistory, ServiceAttributes, Tariff } from '@boring/tariff-schema';
import { monthWindow } from './months.js';
import type { EligibilityFinding, UnevaluatedRule } from './types.js';

/**
 * Evaluates eligibility rules against demand history.
 *
 * Two principles:
 *  - a rule that FIRES names the schedule the customer would be transferred TO,
 *    because recommending a schedule they get moved off of is worse than making no
 *    recommendation;
 *  - a rule that cannot be evaluated is reported as unevaluated, never as passing.
 *    A gap in the history reading as a quiet pass is how a customer ends up on a
 *    schedule they were never eligible for.
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
        const months = monthWindow(currentMonth, rule.windowMonths, rule.windowIncludesCurrentMonth);
        const qualifying = months.filter((month) => {
          const peak = peaks.get(month);
          return peak !== undefined && peak >= rule.thresholdKw;
        });
        if (qualifying.length >= rule.monthCount) {
          findings.push({
            ruleId: rule.id,
            label: rule.label,
            transferTo: rule.transferTo,
            detail: `reached ${rule.thresholdKw} kW in ${qualifying.length} of the ${rule.windowMonths} months ending ${currentMonth} (${qualifying.join(', ')}), meeting the threshold of ${rule.monthCount}`,
            citation: rule.citation,
          });
        }
        break;
      }

      case 'demand-at-or-below-threshold-for-n-consecutive-months': {
        const months = monthWindow(currentMonth, rule.monthCount, rule.windowIncludesCurrentMonth);
        const missing = months.filter((month) => !peaks.has(month));
        if (missing.length > 0) {
          unevaluatedRules.push({
            ruleId: rule.id,
            reason: `needs demand for all ${rule.monthCount} months ending ${currentMonth}; missing ${missing.sort().join(', ')}`,
          });
          break;
        }
        const allBelow = months.every((month) => (peaks.get(month) as number) <= rule.thresholdKw);
        if (allBelow) {
          findings.push({
            ruleId: rule.id,
            label: rule.label,
            transferTo: rule.transferTo,
            detail: `at or below ${rule.thresholdKw} kW for all ${rule.monthCount} months ending ${currentMonth}`,
            citation: rule.citation,
          });
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
