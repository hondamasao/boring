/**
 * CATEGORY F — riders and the order of operations.
 *
 * The stage pipeline is the answer to "what is a percentage rider a percentage
 * OF". These tests pin the exact base at each stage, so a later change to
 * evaluation order cannot pass silently.
 */
import { describe, expect, it } from 'vitest';
import { rate } from '@boring/rating-engine';
import { STAGE, type EnergyCharge, type Rider, type Tariff } from '@boring/tariff-schema';
import { makeSyntheticTariff } from '@boring/tariff-schema/testing';
import { buildProfile, emptyContext, flat, period } from './helpers/profile.js';
import { describeBill, expectLinesSumToTotal, riderLine } from './helpers/lines.js';

// Five summer weekdays, flat 1 kWh per quarter-hour: 480 kWh, on-peak 100,
// off-peak 380, measured demand 4 kW.
const START = '2026-07-06';
const END = '2026-07-11';
const profile = buildProfile({ start: START, end: END, kwh: flat(1) });

const cite = 'synthetic';

/** Generation-component energy, so component filters have something to exclude. */
const generationEnergy: EnergyCharge[] = [
  {
    id: 'energy-summer-on-peak-generation',
    label: 'Summer On-Peak Energy (Generation)',
    seasonId: 'summer',
    periodId: 'on-peak',
    component: 'generation',
    pricing: { kind: 'flat', ratePerKwh: 0.1 },
    citation: cite,
  },
  {
    id: 'energy-summer-off-peak-generation',
    label: 'Summer Off-Peak Energy (Generation)',
    seasonId: 'summer',
    periodId: 'off-peak',
    component: 'generation',
    pricing: { kind: 'flat', ratePerKwh: 0.05 },
    citation: cite,
  },
];

const perKwhRider: Rider = {
  basis: 'per-kwh',
  id: 'ppp',
  label: 'Public Purpose Programs Charge',
  component: 'public-purpose',
  ratePerKwh: 0.01,
  scope: { seasonIds: null, periodIds: null },
  citation: cite,
};

const flatRider: Rider = {
  basis: 'flat',
  id: 'meter-fee',
  label: 'Metering Fee',
  component: 'delivery',
  amount: 5,
  per: 'month',
  citation: cite,
};

/** 10% of everything through stage 4 except generation. */
const utilityUsersTax: Rider = {
  basis: 'percent-of-subtotal',
  id: 'uut',
  label: 'Utility Users Tax',
  component: 'taxes-and-fees',
  percent: 0.1,
  stage: 5,
  base: {
    includeStages: [0, 1, 2, 3, 4],
    chargeTypes: null,
    components: null,
    excludeComponents: ['generation'],
  },
  citation: cite,
};

/** 1% of everything through stage 5 — a fee on top of the tax. */
const franchiseFee: Rider = {
  basis: 'percent-of-subtotal',
  id: 'franchise-fee',
  label: 'Franchise Fee Surcharge',
  component: 'taxes-and-fees',
  percent: 0.01,
  stage: 6,
  base: {
    includeStages: [0, 1, 2, 3, 4, 5],
    chargeTypes: null,
    components: null,
    excludeComponents: null,
  },
  citation: cite,
};

function tariffWith(riders: Rider[], withGeneration = true): Tariff {
  const base = makeSyntheticTariff();
  return makeSyntheticTariff({
    energyCharges: withGeneration ? [...base.energyCharges, ...generationEnergy] : base.energyCharges,
    riders,
  });
}

function bill(riders: Rider[], withGeneration = true) {
  return rate(profile, tariffWith(riders, withGeneration), period(START, END), emptyContext());
}

describe('F19: usage riders take their quantity from the metered total', () => {
  it('bills a per-kWh rider on all kWh in scope', () => {
    const line = riderLine(bill([perKwhRider]), 'ppp');
    expect(line.stage).toBe(STAGE.USAGE_RIDERS);
    expect(line.quantity).toBeCloseTo(480, 9);
    expect(line.unit).toBe('kWh');
    expect(line.amount).toBe(4.8);
  });

  it('honours a scoped per-kWh rider', () => {
    const scoped: Rider = { ...perKwhRider, scope: { seasonIds: null, periodIds: ['on-peak'] } };
    expect(riderLine(bill([scoped]), 'ppp').quantity).toBeCloseTo(100, 9);
    expect(riderLine(bill([scoped]), 'ppp').amount).toBe(1);
  });

  it('bills a per-kW rider on billed demand, summing the charges it names', () => {
    const scoped: Rider = {
      basis: 'per-kw',
      id: 'demand-rider',
      label: 'Demand Rider',
      component: 'delivery',
      ratePerKw: 1,
      scope: { chargeIds: ['frd'] },
      citation: cite,
    };
    expect(riderLine(bill([scoped]), 'demand-rider').quantity).toBeCloseTo(4, 9);

    const unscoped: Rider = { ...scoped, scope: { chargeIds: null } };
    // Both demand charges bill 4 kW, so an unscoped rider sees 8 kW.
    expect(riderLine(bill([unscoped]), 'demand-rider').quantity).toBeCloseTo(8, 9);
  });

  it('scales a flat rider by its `per` unit', () => {
    expect(riderLine(bill([flatRider]), 'meter-fee').amount).toBe(5);
    expect(riderLine(bill([{ ...flatRider, per: 'day' }]), 'meter-fee').amount).toBe(25);

    const threeMeters = rate(
      profile,
      tariffWith([{ ...flatRider, per: 'meter-day' }]),
      period(START, END, 3),
      emptyContext(),
    );
    expect(riderLine(threeMeters, 'meter-fee').amount).toBe(75);
  });
});

describe('F21: the base of a percentage rider is pinned', () => {
  // stage 0  energy delivery      30.00 + 38.00
  //          energy generation    10.00 + 19.00
  //          facilities demand    80.00
  //          on-peak demand       48.00   = 225.00
  // stage 1  customer charge     100.00
  // stage 2  per-kWh rider         4.80
  // stage 3  flat rider            5.00
  // stage 4  (no minimum bill)     0.00
  const result = bill([perKwhRider, flatRider, utilityUsersTax, franchiseFee]);

  it('reports each stage subtotal', () => {
    expect(result.subtotals.byStage['0']).toBe(225);
    expect(result.subtotals.byStage['1']).toBe(100);
    expect(result.subtotals.byStage['2']).toBe(4.8);
    expect(result.subtotals.byStage['3']).toBe(5);
    expect(result.subtotals.byStage['4']).toBe(0);
    expect(result.subtotals.cumulativeThroughStage['4']).toBe(334.8);
  });

  it('excludes generation from the tax base: 305.80, not 334.80', () => {
    const line = riderLine(result, 'uut');
    expect(line.basis).toBe('percent');
    expect(line.quantity).toBe(305.8);
    expect(line.rate).toBe(0.1);
    expect(line.amount).toBe(30.58);
  });

  it('is unchanged by adding $29 of generation charges', () => {
    // The clearest statement of what the exclusion means for a CCA customer.
    const withoutGeneration = bill([perKwhRider, flatRider, utilityUsersTax], false);
    expect(riderLine(withoutGeneration, 'uut').quantity).toBe(305.8);
    expect(riderLine(withoutGeneration, 'uut').amount).toBe(30.58);
  });

  it('lets a stage-6 rider see the stage-5 amount', () => {
    const line = riderLine(result, 'franchise-fee');
    expect(line.quantity).toBe(365.38);
    expect(line.amount).toBe(3.65);
  });

  it('totals 369.03', () => {
    expect(result.total, describeBill(result)).toBe(369.03);
    expectLinesSumToTotal(result);
  });
});

describe('F22: same stage does not compound, different stages do', () => {
  it('gives two stage-5 riders the same base', () => {
    const second: Rider = { ...utilityUsersTax, id: 'county-tax', label: 'County Tax' };
    const result = bill([perKwhRider, flatRider, utilityUsersTax, second]);

    expect(riderLine(result, 'uut').quantity).toBe(305.8);
    expect(riderLine(result, 'county-tax').quantity).toBe(305.8);
    expect(result.total, describeBill(result)).toBe(334.8 + 30.58 + 30.58);
  });

  it('gives a stage-6 rider a larger base than the stage-5 rider it follows', () => {
    const second: Rider = {
      ...utilityUsersTax,
      id: 'county-tax',
      label: 'County Tax',
      stage: 6,
      base: { ...utilityUsersTax.base, includeStages: [0, 1, 2, 3, 4, 5] },
    };
    const result = bill([perKwhRider, flatRider, utilityUsersTax, second]);

    expect(riderLine(result, 'uut').quantity).toBe(305.8);
    // 305.80 + the stage-5 tax of 30.58.
    expect(riderLine(result, 'county-tax').quantity).toBe(336.38);
    expect(result.total, describeBill(result)).toBe(334.8 + 30.58 + 33.64);
  });
});

describe('F: base selectors', () => {
  it('narrows a base by charge type', () => {
    const demandOnlyTax: Rider = {
      ...utilityUsersTax,
      id: 'demand-tax',
      base: {
        includeStages: [0],
        chargeTypes: ['facilities-demand', 'time-related-demand'],
        components: null,
        excludeComponents: null,
      },
    };
    const result = bill([demandOnlyTax]);
    // 80.00 facilities + 48.00 time-related.
    expect(riderLine(result, 'demand-tax').quantity).toBe(128);
    expect(riderLine(result, 'demand-tax').amount).toBe(12.8);
  });

  it('narrows a base to named components', () => {
    const generationOnlyTax: Rider = {
      ...utilityUsersTax,
      id: 'generation-tax',
      base: {
        includeStages: [0],
        chargeTypes: null,
        components: ['generation'],
        excludeComponents: null,
      },
    };
    expect(riderLine(bill([generationOnlyTax]), 'generation-tax').quantity).toBe(29);
  });
});
