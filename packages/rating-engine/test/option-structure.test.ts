/**
 * The core product mechanic: two options of the SAME schedule, rating the SAME
 * load profile, must produce DIFFERENT bills because they carry different demand
 * charge families.
 *
 * This mirrors the real SCE TOU-GS-2 split: Option D carries both
 * facilities-related demand (FRD) and time-related demand (TRD); Option E carries
 * FRD only. A customer whose big draw happens at 3 a.m. — off-peak, so it never
 * touches TRD — still pays for it through FRD on both options, but only Option D
 * also charges for their (much smaller) 4-9pm weekday demand. If this distinction
 * is not tested, the schema's two-demand-family split has no product-level proof
 * it does what it's for.
 *
 * The synthetic tariff here is shaped like Option D / Option E structurally (FRD
 * everywhere, TRD only on Option D, same energy charges and fixed charges
 * otherwise) — it is not a transcription of the real records, which are still
 * pending real rates (see packages/tariff-library/PENDING.md).
 */
import { describe, expect, it } from 'vitest';
import { rate } from '@boring/rating-engine';
import { makeSyntheticTariff } from '@boring/tariff-schema/testing';
import { buildProfile, emptyContext, flatWithSpikes, period } from './helpers/profile.js';
import { demandLine, describeBill, expectLinesSumToTotal } from './helpers/lines.js';

const START = '2026-07-06'; // Monday
const END = '2026-07-11'; // five summer weekdays

// A flat 4 kW baseline (1 kWh per 15-minute interval) all week, except a single
// 3 a.m. interval that spikes to 1200 kW (300 kWh in 15 minutes). 3 a.m. is
// off-peak under the synthetic TOU table, so it drives the account's annual
// maximum demand without ever touching the 4pm-9pm on-peak window, which stays
// at the flat 4 kW baseline throughout.
const ANNUAL_MAX_AT = '2026-07-07T03:00:00-07:00';
const profile = buildProfile({
  start: START,
  end: END,
  kwh: flatWithSpikes(1, { [ANNUAL_MAX_AT]: 300 }),
});

function optionDLike() {
  // makeSyntheticTariff()'s default shape already has both a facilities charge
  // ('frd') and a summer on-peak time-related charge ('trd-summer-on-peak') —
  // structurally an Option D.
  return makeSyntheticTariff();
}

function optionELike() {
  const base = makeSyntheticTariff();
  return makeSyntheticTariff({
    demandCharges: { facilities: base.demandCharges.facilities, timeRelated: [] },
  });
}

describe('Option D vs Option E: same profile, different bills', () => {
  const billD = rate(profile, optionDLike(), period(START, END), emptyContext());
  const billE = rate(profile, optionELike(), period(START, END), emptyContext());

  it('bills the same facilities-related demand on both — FRD does not care which option you are on', () => {
    const frdD = demandLine(billD, 'frd');
    const frdE = demandLine(billE, 'frd');
    expect(frdD.quantity).toBeCloseTo(1200, 6);
    expect(frdE.quantity).toBeCloseTo(1200, 6);
    expect(frdD.amount).toBe(frdE.amount);
    expect(frdD.amount).toBe(24000);
  });

  it('bills a real, non-trivial time-related demand charge on Option D, off the much smaller on-peak peak', () => {
    const trd = demandLine(billD, 'trd-summer-on-peak');
    expect(trd.quantity).toBeCloseTo(4, 6);
    expect(trd.amount).toBe(48);
    // Not a rounding artifact of the facilities peak — genuinely a different,
    // far smaller number, because it only ever looks inside the on-peak window.
    expect(trd.quantity).toBeLessThan(demandLine(billD, 'frd').quantity / 100);
  });

  it('bills NO time-related demand charge at all on Option E — not a zero line, an absent one', () => {
    expect(billE.lines.filter((l) => l.chargeType === 'time-related-demand')).toHaveLength(0);
    expect(() => demandLine(billE, 'trd-summer-on-peak')).toThrow();
  });

  it('reports the same account-wide maximum demand on both, independent of which charges exist', () => {
    // The 3am spike is a fact about the meter, not about the tariff option — both
    // bills must agree on it even though only one of them prices a TRD charge.
    expect(billD.diagnostics.accountMaxDemandKw).toBeCloseTo(1200, 6);
    expect(billE.diagnostics.accountMaxDemandKw).toBeCloseTo(1200, 6);
  });

  it('differs in total by exactly the Option D time-related demand line', () => {
    expect(billD.total - billE.total, `D:\n${describeBill(billD)}\n\nE:\n${describeBill(billE)}`).toBe(48);
  });

  it('agrees on every energy line — the split is only in demand charges', () => {
    const energyD = billD.lines.filter((l) => l.chargeType === 'energy');
    const energyE = billE.lines.filter((l) => l.chargeType === 'energy');
    expect(energyD.map((l) => [l.sourceId, l.amount])).toEqual(energyE.map((l) => [l.sourceId, l.amount]));
  });

  it('sums correctly on both', () => {
    expectLinesSumToTotal(billD);
    expectLinesSumToTotal(billE);
  });
});
