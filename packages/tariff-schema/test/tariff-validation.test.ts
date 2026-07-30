/**
 * Every case here is a document that would otherwise rate SUCCESSFULLY and
 * WRONGLY. That is the bar for a refinement earning its place: silent, plausible,
 * expensive. A schema that only rejects obvious nonsense is not pulling its
 * weight.
 */
import { describe, expect, it } from 'vitest';
import { Tariff, type FacilitiesDemandCharge, type Rider } from '@boring/tariff-schema';
import { makeSyntheticTariff, syntheticTouRules } from '@boring/tariff-schema/testing';

/** Parses and returns the flattened issue messages, asserting failure. */
function issues(candidate: unknown): string[] {
  const result = Tariff.safeParse(candidate);
  expect(result.success).toBe(false);
  if (result.success) return [];
  return result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

function expectValid(candidate: unknown): void {
  const result = Tariff.safeParse(candidate);
  if (!result.success) {
    throw new Error(`expected a valid tariff, got:\n${result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
}

const cite = 'test';

describe('the baseline synthetic tariff', () => {
  it('is valid, so every rejection below is caused by the mutation under test', () => {
    expectValid(makeSyntheticTariff());
  });

  it('round-trips through JSON unchanged', () => {
    const tariff = makeSyntheticTariff();
    const reparsed = Tariff.parse(JSON.parse(JSON.stringify(tariff)));
    expect(reparsed).toEqual(tariff);
  });
});

describe('seasons', () => {
  it('rejects a season set with a one-day gap', () => {
    const tariff = makeSyntheticTariff();
    const [summer, winter] = tariff.seasons;
    const messages = issues({
      ...tariff,
      seasons: [summer, { ...winter!, start: { month: 10, day: 2 } }],
    });
    expect(messages.some((m) => m.includes('no season covers') && m.includes('10-01'))).toBe(true);
  });

  it('rejects overlapping seasons', () => {
    const tariff = makeSyntheticTariff();
    const [summer, winter] = tariff.seasons;
    const messages = issues({
      ...tariff,
      seasons: [summer, { ...winter!, start: { month: 9, day: 30 } }],
    });
    expect(messages.some((m) => m.includes('09-30') && m.includes('both'))).toBe(true);
  });

  it('rejects duplicate season ids', () => {
    const tariff = makeSyntheticTariff();
    const [summer] = tariff.seasons;
    const messages = issues({ ...tariff, seasons: [summer, { ...summer!, start: { month: 10, day: 1 }, end: { month: 5, day: 31 } }] });
    expect(messages.some((m) => m.includes('duplicate season id'))).toBe(true);
  });

  it('rejects February 30', () => {
    const tariff = makeSyntheticTariff();
    const [summer, winter] = tariff.seasons;
    const messages = issues({ ...tariff, seasons: [{ ...summer!, start: { month: 2, day: 30 } }, winter] });
    expect(messages.some((m) => m.includes('at most 29 days'))).toBe(true);
  });
});

describe('TOU rules', () => {
  it('rejects an unresolvable seasonId without also drowning in coverage gaps', () => {
    const tariff = makeSyntheticTariff();
    const rules = syntheticTouRules();
    const messages = issues({
      ...tariff,
      touRules: [{ ...rules[0]!, seasonId: 'autumn' }, ...rules.slice(1)],
    });
    expect(messages.some((m) => m.includes('unknown seasonId "autumn"'))).toBe(true);
    // Coverage is not evaluated over broken references, so the real error stands out.
    expect(messages.some((m) => m.includes('no TOU rule covers'))).toBe(false);
  });

  it('rejects an unresolvable periodId', () => {
    const tariff = makeSyntheticTariff();
    const rules = syntheticTouRules();
    const messages = issues({
      ...tariff,
      touRules: [{ ...rules[0]!, periodId: 'super-off-peak' }, ...rules.slice(1)],
    });
    expect(messages.some((m) => m.includes('unknown periodId "super-off-peak"'))).toBe(true);
  });

  it('rejects a gap left by a deleted row', () => {
    const tariff = makeSyntheticTariff();
    const messages = issues({ ...tariff, touRules: syntheticTouRules().slice(1) });
    expect(messages.some((m) => m.includes('no TOU rule covers') && m.includes('00:00-16:00'))).toBe(true);
  });

  it('rejects an overlap, because otherwise the bill depends on array order', () => {
    const tariff = makeSyntheticTariff();
    const messages = issues({
      ...tariff,
      touRules: [
        ...syntheticTouRules(),
        { seasonId: 'winter', dayTypes: ['sat'], hours: { startHour: 8, endHour: 12 }, periodId: 'mid-peak' },
      ],
    });
    expect(messages.some((m) => m.includes('covered by both'))).toBe(true);
  });
});

describe('energy coverage', () => {
  it('rejects a reachable season/period with no energy charge — that energy would be free', () => {
    const tariff = makeSyntheticTariff();
    const messages = issues({
      ...tariff,
      energyCharges: tariff.energyCharges.filter((c) => c.id !== 'energy-winter-mid-peak'),
    });
    expect(
      messages.some(
        (m) =>
          m.includes('no energy charge for season "winter" period "mid-peak"') &&
          m.includes('billed at zero'),
      ),
    ).toBe(true);
  });

  it('rejects an energy charge for a combination the TOU table cannot produce', () => {
    const tariff = makeSyntheticTariff();
    const messages = issues({
      ...tariff,
      energyCharges: [
        ...tariff.energyCharges,
        {
          id: 'energy-winter-on-peak',
          label: 'Winter On-Peak Energy',
          seasonId: 'winter',
          periodId: 'on-peak',
          component: 'delivery',
          pricing: { kind: 'flat', ratePerKwh: 0.4 },
          citation: cite,
        },
      ],
    });
    expect(messages.some((m) => m.includes('never contains period "on-peak"'))).toBe(true);
  });

  it('rejects two energy charges for the same season/period/component', () => {
    const tariff = makeSyntheticTariff();
    const first = tariff.energyCharges[0]!;
    const messages = issues({
      ...tariff,
      energyCharges: [...tariff.energyCharges, { ...first, id: 'energy-duplicate' }],
    });
    expect(messages.some((m) => m.includes('duplicate energy charge') && m.includes('would bill both'))).toBe(true);
  });

  it('allows the same season/period split across components, which is how CCA bills read', () => {
    const tariff = makeSyntheticTariff();
    const first = tariff.energyCharges[0]!;
    expectValid({
      ...tariff,
      energyCharges: [
        ...tariff.energyCharges,
        { ...first, id: 'energy-summer-on-peak-generation', component: 'generation' },
      ],
    });
  });
});

describe('the two demand families are distinguished at the type level', () => {
  it('rejects a facilities charge carrying a periodId', () => {
    const tariff = makeSyntheticTariff();
    const facilities = tariff.demandCharges.facilities[0]!;
    const messages = issues({
      ...tariff,
      demandCharges: {
        ...tariff.demandCharges,
        facilities: [{ ...facilities, periodId: 'on-peak' } as FacilitiesDemandCharge],
      },
    });
    expect(messages.some((m) => m.toLowerCase().includes('unrecognized key'))).toBe(true);
  });

  it('rejects a time-related charge with no periodId', () => {
    const tariff = makeSyntheticTariff();
    const timeRelated = tariff.demandCharges.timeRelated[0]!;
    const { periodId: _dropped, ...withoutPeriod } = timeRelated;
    const messages = issues({
      ...tariff,
      demandCharges: { ...tariff.demandCharges, timeRelated: [withoutPeriod] },
    });
    expect(messages.some((m) => m.includes('periodId'))).toBe(true);
  });

  it('rejects a time-related charge whose season never contains its period', () => {
    const tariff = makeSyntheticTariff();
    const timeRelated = tariff.demandCharges.timeRelated[0]!;
    const messages = issues({
      ...tariff,
      demandCharges: {
        ...tariff.demandCharges,
        timeRelated: [{ ...timeRelated, seasonId: 'winter' }],
      },
    });
    expect(messages.some((m) => m.includes('never contains period "on-peak"'))).toBe(true);
  });

  it('accepts a facilities-only schedule, which is how an option with no TRD is expressed', () => {
    const tariff = makeSyntheticTariff();
    expectValid({
      ...tariff,
      demandCharges: { facilities: tariff.demandCharges.facilities, timeRelated: [] },
    });
  });
});

describe('ratchets', () => {
  const ratchet = {
    id: 'frd-ratchet',
    label: '50% of the highest peak in the preceding eleven months',
    appliesTo: { kind: 'facilities' as const, chargeId: 'frd' },
    lookbackMonths: 11,
    percentOfPriorPeak: 0.5,
    seasonScope: 'any-season' as const,
    citation: cite,
  };

  it('accepts a ratchet pointing at an existing facilities charge', () => {
    expectValid({ ...makeSyntheticTariff(), ratchets: [ratchet] });
  });

  it('rejects a ratchet pointing at a charge that does not exist', () => {
    const messages = issues({
      ...makeSyntheticTariff(),
      ratchets: [{ ...ratchet, appliesTo: { kind: 'facilities', chargeId: 'nonexistent' } }],
    });
    expect(messages.some((m) => m.includes('no facilities demand charge with id "nonexistent"'))).toBe(true);
  });

  it('rejects a ratchet whose kind does not match the charge it names', () => {
    // `trd-summer-on-peak` is a time-related charge; claiming it is facilities
    // would otherwise resolve to nothing and silently never apply.
    const messages = issues({
      ...makeSyntheticTariff(),
      ratchets: [{ ...ratchet, appliesTo: { kind: 'facilities', chargeId: 'trd-summer-on-peak' } }],
    });
    expect(messages.some((m) => m.includes('no facilities demand charge with id "trd-summer-on-peak"'))).toBe(true);
  });

  it('rejects same-season-only against a charge whose determinations carry no season', () => {
    // `frd` has seasonId null and measuredOver billing-period, so there is no
    // season to match against.
    const messages = issues({
      ...makeSyntheticTariff(),
      ratchets: [{ ...ratchet, seasonScope: 'same-season-only' }],
    });
    expect(messages.some((m) => m.includes('same-season-only') && m.includes('season-bound'))).toBe(true);
  });

  it('accepts same-season-only once the charge is measured per season segment', () => {
    const tariff = makeSyntheticTariff();
    const facilities = tariff.demandCharges.facilities[0]!;
    expectValid({
      ...tariff,
      demandCharges: {
        ...tariff.demandCharges,
        facilities: [{ ...facilities, measuredOver: 'season-segment' }],
      },
      ratchets: [{ ...ratchet, seasonScope: 'same-season-only' }],
    });
  });
});

describe('riders and the order of operations', () => {
  const percentRider = {
    basis: 'percent-of-subtotal' as const,
    id: 'uut',
    label: 'Utility Users Tax',
    component: 'taxes-and-fees' as const,
    percent: 0.1,
    stage: 5 as const,
    base: {
      includeStages: [0, 1, 2, 3, 4],
      chargeTypes: null,
      components: null,
      excludeComponents: ['generation' as const],
    },
    citation: cite,
  };

  it('accepts a percent rider whose base is entirely earlier stages', () => {
    expectValid({ ...makeSyntheticTariff(), riders: [percentRider] });
  });

  it('rejects a percent rider that taxes its own stage', () => {
    const messages = issues({
      ...makeSyntheticTariff(),
      riders: [{ ...percentRider, base: { ...percentRider.base, includeStages: [0, 5] } }],
    });
    expect(messages.some((m) => m.includes('cannot include stage 5'))).toBe(true);
  });

  it('rejects a stage-5 rider that taxes stage 6', () => {
    const messages = issues({
      ...makeSyntheticTariff(),
      riders: [{ ...percentRider, base: { ...percentRider.base, includeStages: [6] } }],
    });
    expect(messages.some((m) => m.includes('cannot include stage 6'))).toBe(true);
  });

  it('accepts a stage-6 rider taxing stage 5, which is a tax on a tax', () => {
    expectValid({
      ...makeSyntheticTariff(),
      riders: [
        percentRider,
        { ...percentRider, id: 'franchise-fee', stage: 6 as const, base: { ...percentRider.base, includeStages: [0, 1, 2, 3, 4, 5] } },
      ],
    });
  });

  it('rejects a per-kW rider scoped to a demand charge that does not exist', () => {
    const rider: Rider = {
      basis: 'per-kw',
      id: 'demand-rider',
      label: 'Demand Rider',
      component: 'delivery',
      ratePerKw: 1,
      scope: { chargeIds: ['not-a-charge'] },
      citation: cite,
    };
    const messages = issues({ ...makeSyntheticTariff(), riders: [rider] });
    expect(messages.some((m) => m.includes('no demand charge with id "not-a-charge"'))).toBe(true);
  });

  it('rejects a per-kWh rider scoped to an unknown period', () => {
    const rider: Rider = {
      basis: 'per-kwh',
      id: 'ppp',
      label: 'Public Purpose Programs',
      component: 'public-purpose',
      ratePerKwh: 0.01,
      scope: { seasonIds: null, periodIds: ['super-off-peak'] },
      citation: cite,
    };
    const messages = issues({ ...makeSyntheticTariff(), riders: [rider] });
    expect(messages.some((m) => m.includes('unknown periodId "super-off-peak"'))).toBe(true);
  });

  it('reads percent as a fraction, rejecting 10 for ten percent', () => {
    const messages = issues({ ...makeSyntheticTariff(), riders: [{ ...percentRider, percent: 10 }] });
    expect(messages.length).toBeGreaterThan(0);
  });
});

describe('minimum bill', () => {
  it('accepts a charge-floor naming real charges', () => {
    expectValid({
      ...makeSyntheticTariff(),
      minimumBill: {
        kind: 'charge-floor',
        floorChargeIds: ['customer-charge', 'frd'],
        component: 'delivery',
        comparisonScope: { includeStages: [0, 1, 2, 3], components: null, excludeComponents: null },
        citation: cite,
      },
    });
  });

  it('rejects a charge-floor naming a charge that does not exist', () => {
    const messages = issues({
      ...makeSyntheticTariff(),
      minimumBill: {
        kind: 'charge-floor',
        floorChargeIds: ['customer-charge', 'meter-charge'],
        component: 'delivery',
        comparisonScope: { includeStages: [0, 1], components: null, excludeComponents: null },
        citation: cite,
      },
    });
    expect(messages.some((m) => m.includes('"meter-charge"') && m.includes('not a fixed charge'))).toBe(true);
  });

  it('rejects a comparison scope reaching its own stage or later', () => {
    const messages = issues({
      ...makeSyntheticTariff(),
      minimumBill: {
        kind: 'per-day',
        amountPerDay: 0.35,
        perMeter: true,
        component: 'delivery',
        comparisonScope: { includeStages: [0, 5], components: null, excludeComponents: null },
        citation: cite,
      },
    });
    expect(messages.some((m) => m.includes('cannot compare against stage 5'))).toBe(true);
  });
});

describe('provenance', () => {
  it('rejects a superseded date that precedes the effective date', () => {
    const tariff = makeSyntheticTariff();
    const messages = issues({
      ...tariff,
      provenance: { ...tariff.provenance, effectiveDate: '2026-06-01', supersededDate: '2026-01-01' },
    });
    expect(messages.some((m) => m.includes('must be after effectiveDate'))).toBe(true);
  });

  it('rejects a sourceUrl that is not a URL', () => {
    const tariff = makeSyntheticTariff();
    const messages = issues({ ...tariff, provenance: { ...tariff.provenance, sourceUrl: 'see the binder' } });
    expect(messages.some((m) => m.includes('sourceUrl'))).toBe(true);
  });

  it('rejects a verifiedAt with no offset, since it would be ambiguous', () => {
    const tariff = makeSyntheticTariff();
    const messages = issues({ ...tariff, provenance: { ...tariff.provenance, verifiedAt: '2026-01-01T00:00:00' } });
    expect(messages.some((m) => m.includes('verifiedAt'))).toBe(true);
  });
});

describe('scope guards', () => {
  it('rejects a real-time-pricing schedule, which needs market data the engine cannot fetch', () => {
    const messages = issues({ ...makeSyntheticTariff(), scheduleCode: 'TOU-GS-2-RTP' });
    expect(messages.some((m) => m.includes('real-time pricing') && m.includes('out of scope'))).toBe(true);
  });

  it('rejects RTP named as an option code', () => {
    const messages = issues({ ...makeSyntheticTariff(), scheduleCode: 'TOU-GS-2', optionCode: 'RTP' });
    expect(messages.some((m) => m.includes('real-time pricing'))).toBe(true);
  });

  it('rejects an unknown top-level key rather than ignoring it', () => {
    const messages = issues({ ...makeSyntheticTariff(), demandRatchets: [] });
    expect(messages.some((m) => m.toLowerCase().includes('unrecognized key'))).toBe(true);
  });

  it('rejects a power factor adjustment on a schedule with no demand charges', () => {
    const messages = issues({
      ...makeSyntheticTariff(),
      demandCharges: { facilities: [], timeRelated: [] },
      powerFactorAdjustment: {
        id: 'pf',
        label: 'Power Factor Adjustment',
        component: 'delivery',
        method: 'per-kvar-below-threshold',
        thresholdPowerFactor: 0.85,
        ratePerKvar: 0.5,
        citation: cite,
      },
    });
    expect(messages.some((m) => m.includes('no demand charges'))).toBe(true);
  });
});

describe('the shared id namespace', () => {
  it('rejects a rider reusing a charge id, since ratchets and floors resolve by id', () => {
    const tariff = makeSyntheticTariff();
    const rider: Rider = {
      basis: 'flat',
      id: 'frd',
      label: 'Colliding Rider',
      component: 'delivery',
      amount: 1,
      per: 'month',
      citation: cite,
    };
    const messages = issues({ ...tariff, riders: [rider] });
    expect(messages.some((m) => m.includes('id "frd" is used more than once'))).toBe(true);
  });
});

describe('tiered energy', () => {
  const tiered = {
    id: 'energy-winter-off-peak',
    label: 'Winter Off-Peak Energy',
    seasonId: 'winter',
    periodId: 'off-peak',
    component: 'delivery' as const,
    citation: cite,
  };

  function withPricing(pricing: unknown): unknown {
    const tariff = makeSyntheticTariff();
    return {
      ...tariff,
      energyCharges: [
        ...tariff.energyCharges.filter((c) => c.id !== 'energy-winter-off-peak'),
        { ...tiered, pricing },
      ],
    };
  }

  it('accepts increasing blocks ending unbounded', () => {
    expectValid(
      withPricing({
        kind: 'tiered',
        tierBasis: 'this-charge',
        tiers: [
          { upToKwh: 1000, ratePerKwh: 0.08 },
          { upToKwh: 5000, ratePerKwh: 0.1 },
          { upToKwh: null, ratePerKwh: 0.12 },
        ],
      }),
    );
  });

  it('rejects a bounded final tier, which would leave high usage unpriced', () => {
    const messages = issues(
      withPricing({
        kind: 'tiered',
        tierBasis: 'this-charge',
        tiers: [
          { upToKwh: 1000, ratePerKwh: 0.08 },
          { upToKwh: 5000, ratePerKwh: 0.1 },
        ],
      }),
    );
    expect(messages.some((m) => m.includes('must be unbounded'))).toBe(true);
  });

  it('rejects non-increasing tier bounds', () => {
    const messages = issues(
      withPricing({
        kind: 'tiered',
        tierBasis: 'this-charge',
        tiers: [
          { upToKwh: 5000, ratePerKwh: 0.08 },
          { upToKwh: 1000, ratePerKwh: 0.1 },
          { upToKwh: null, ratePerKwh: 0.12 },
        ],
      }),
    );
    expect(messages.some((m) => m.includes('strictly increase'))).toBe(true);
  });

  it('rejects a flat rate alongside tiers, so there is no question which wins', () => {
    const messages = issues(
      withPricing({ kind: 'flat', ratePerKwh: 0.08, tiers: [{ upToKwh: null, ratePerKwh: 0.1 }] }),
    );
    expect(messages.length).toBeGreaterThan(0);
  });
});
