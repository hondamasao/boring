import { describe, expect, it } from 'vitest';
import {
  MONTH_DAY_SLOTS,
  checkSeasonTiling,
  monthDayOrdinal,
  ordinalToMonthDay,
  seasonIdForMonthDay,
  seasonOrdinals,
  type Season,
} from '@boring/tariff-schema';
import { syntheticSeasons } from '@boring/tariff-schema/testing';

const cite = 'test';

function season(id: string, start: [number, number], end: [number, number]): Season {
  return {
    id,
    label: id,
    start: { month: start[0], day: start[1] },
    end: { month: end[0], day: end[1] },
    citation: cite,
  };
}

describe('month-day ordinals', () => {
  it('round-trips every slot in the leap-year layout', () => {
    for (let ordinal = 0; ordinal < MONTH_DAY_SLOTS; ordinal += 1) {
      expect(monthDayOrdinal(ordinalToMonthDay(ordinal))).toBe(ordinal);
    }
  });

  it('places known boundaries', () => {
    expect(monthDayOrdinal({ month: 1, day: 1 })).toBe(0);
    expect(monthDayOrdinal({ month: 2, day: 29 })).toBe(31 + 28);
    // June 1 is the SCE summer boundary: 31+29+31+30+31 = 152 days precede it.
    expect(monthDayOrdinal({ month: 6, day: 1 })).toBe(152);
    expect(monthDayOrdinal({ month: 12, day: 31 })).toBe(MONTH_DAY_SLOTS - 1);
  });
});

describe('wrapping seasons', () => {
  it('covers October 1 through May 31 across the year boundary', () => {
    const winter = season('winter', [10, 1], [5, 31]);
    const ordinals = seasonOrdinals(winter);

    // Oct 1 - Dec 31 is 92 days; Jan 1 - May 31 in the leap layout is 152 days.
    expect(ordinals).toHaveLength(92 + 152);
    expect(ordinals).toContain(monthDayOrdinal({ month: 12, day: 31 }));
    expect(ordinals).toContain(monthDayOrdinal({ month: 1, day: 1 }));
    expect(ordinals).not.toContain(monthDayOrdinal({ month: 6, day: 1 }));
  });

  it('resolves a January date to the wrapping winter season', () => {
    expect(seasonIdForMonthDay(syntheticSeasons(), { month: 1, day: 15 })).toBe('winter');
    expect(seasonIdForMonthDay(syntheticSeasons(), { month: 7, day: 15 })).toBe('summer');
    // Both edges of the summer window belong to summer, inclusively.
    expect(seasonIdForMonthDay(syntheticSeasons(), { month: 6, day: 1 })).toBe('summer');
    expect(seasonIdForMonthDay(syntheticSeasons(), { month: 9, day: 30 })).toBe('summer');
    expect(seasonIdForMonthDay(syntheticSeasons(), { month: 10, day: 1 })).toBe('winter');
    expect(seasonIdForMonthDay(syntheticSeasons(), { month: 5, day: 31 })).toBe('winter');
  });
});

describe('checkSeasonTiling', () => {
  it('accepts a sound two-season tiling', () => {
    expect(checkSeasonTiling(syntheticSeasons())).toEqual([]);
  });

  it('rejects a gap', () => {
    // Summer ends Sep 30, winter starts Oct 2 — October 1 belongs to nothing.
    const problems = checkSeasonTiling([
      season('summer', [6, 1], [9, 30]),
      season('winter', [10, 2], [5, 31]),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no season covers');
    expect(problems[0]).toContain('10-01');
  });

  it('rejects an overlap', () => {
    // Both seasons claim September 30.
    const problems = checkSeasonTiling([
      season('summer', [6, 1], [9, 30]),
      season('winter', [9, 30], [5, 31]),
    ]);
    expect(problems.some((p) => p.includes('09-30') && p.includes('both'))).toBe(true);
  });

  it('rejects a single season that does not span the year', () => {
    const problems = checkSeasonTiling([season('only', [1, 1], [6, 30])]);
    expect(problems.some((p) => p.includes('no season covers'))).toBe(true);
  });

  it('accepts a single season spanning the whole year', () => {
    expect(checkSeasonTiling([season('all-year', [1, 1], [12, 31])])).toEqual([]);
  });

  it('reports a count rather than one issue per missing day', () => {
    const problems = checkSeasonTiling([season('half', [1, 1], [6, 30])]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/\(\d+ total\)/);
  });
});
