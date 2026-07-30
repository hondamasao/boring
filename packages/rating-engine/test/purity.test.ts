/**
 * Purity and determinism — CLAUDE.md invariant #1.
 *
 * The money path is pure TypeScript: no network, no LLM, no file system, no
 * clock, no randomness. These tests assert that structurally, not by inspection,
 * because the invariant is the thing the whole product rests on.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rate, roundToCents, toCents } from '@boring/rating-engine';
import { makeSyntheticTariff, syntheticHolidayCalendar } from '@boring/tariff-schema/testing';
import { buildProfile, emptyContext, flatWithSpikes, period } from './helpers/profile.js';
import { expectLinesSumToTotal } from './helpers/lines.js';

const START = '2026-07-06';
const END = '2026-07-11';

const profile = buildProfile({
  start: START,
  end: END,
  kwh: flatWithSpikes(1, { '2026-07-07T02:00:00-07:00': 125, '2026-07-08T17:00:00-07:00': 75 }),
});

/** Recursively freezes an object graph so any mutation attempt throws. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

describe('determinism', () => {
  it('produces byte-identical output for identical inputs', () => {
    const args = () =>
      [
        buildProfile({ start: START, end: END, kwh: flatWithSpikes(1, { '2026-07-08T17:00:00-07:00': 75 }) }),
        makeSyntheticTariff(),
        period(START, END),
        emptyContext({ holidayCalendar: syntheticHolidayCalendar(['2026-07-07']) }),
      ] as const;

    const first = JSON.stringify(rate(...args()));
    const second = JSON.stringify(rate(...args()));
    expect(second).toBe(first);
  });

  it('does not mutate its inputs', () => {
    // Frozen in strict mode, so a write throws rather than silently failing.
    const frozenProfile = deepFreeze(structuredClone(profile));
    const frozenTariff = deepFreeze(makeSyntheticTariff());
    const frozenPeriod = deepFreeze(period(START, END));
    const frozenContext = deepFreeze(emptyContext());

    expect(() => rate(frozenProfile, frozenTariff, frozenPeriod, frozenContext)).not.toThrow();

    // And the same object rates identically the second time.
    const a = JSON.stringify(rate(frozenProfile, frozenTariff, frozenPeriod, frozenContext));
    const b = JSON.stringify(rate(frozenProfile, frozenTariff, frozenPeriod, frozenContext));
    expect(a).toBe(b);
  });

  it('does not depend on the ambient time zone', () => {
    // TOU bucketing uses the tariff's zone explicitly, never the host's.
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const utc = JSON.stringify(rate(profile, makeSyntheticTariff(), period(START, END), emptyContext()));
      process.env.TZ = 'Asia/Tokyo';
      const tokyo = JSON.stringify(rate(profile, makeSyntheticTariff(), period(START, END), emptyContext()));
      expect(tokyo).toBe(utc);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe('the itemization adds up', () => {
  it('sums every line to the total exactly', () => {
    const bill = rate(profile, makeSyntheticTariff(), period(START, END), emptyContext());
    expectLinesSumToTotal(bill);
    // Exact, not approximate: the sum happens in integer cents.
    const cents = bill.lines.reduce((sum, l) => sum + toCents(l.amount), 0);
    expect(cents).toBe(toCents(bill.total));
  });

  it('gives every line a citation back to a specific sheet revision', () => {
    const bill = rate(profile, makeSyntheticTariff(), period(START, END), emptyContext());
    for (const line of bill.lines) {
      expect(line.tariffRef.tariffId).toBe(bill.tariffId);
      expect(line.tariffRef.sheetRevision).toBe(bill.tariffProvenance.sheetRevision);
      expect(line.tariffRef.path.startsWith('/')).toBe(true);
    }
  });

  it('gives every line a unique id', () => {
    const bill = rate(profile, makeSyntheticTariff(), period(START, END), emptyContext());
    const ids = bill.lines.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('rounding', () => {
  it('rounds half away from zero, symmetrically for credits', () => {
    expect(roundToCents(1.005)).toBe(1.01);
    expect(roundToCents(-1.005)).toBe(-1.01);
    expect(roundToCents(2.675)).toBe(2.68);
    expect(roundToCents(0.125)).toBe(0.13);
    expect(roundToCents(-0.125)).toBe(-0.13);
  });

  it('is stable under repeated application', () => {
    expect(roundToCents(roundToCents(1.005))).toBe(1.01);
  });
});

describe('the engine imports nothing that could reach the outside world', () => {
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.name.endsWith('.ts') ? [path] : [];
    });
  }

  const files = sourceFiles(srcDir);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each([
    ['node:fs', /from\s+['"]node:fs['"]|require\(['"]fs['"]\)/],
    ['node:http', /from\s+['"]node:https?['"]/],
    ['node:child_process', /child_process/],
    ['fetch', /\bfetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['Date.now', /Date\.now\s*\(/],
    ['new Date() with no argument', /new Date\s*\(\s*\)/],
    ['DateTime.now', /DateTime\.now\s*\(/],
    ['DateTime.local', /DateTime\.local\s*\(/],
    ['Math.random', /Math\.random\s*\(/],
    ['process.env', /process\.env/],
  ])('never references %s', (_label, pattern) => {
    const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8')));
    expect(offenders.map((f) => f.slice(srcDir.length + 1))).toEqual([]);
  });

  it('declares only a timezone library and the schema as runtime dependencies', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies: Record<string, string> };

    // luxon is the timezone-aware date library; zod validates at the boundary and
    // does no I/O of its own.
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['@boring/tariff-schema', 'luxon', 'zod']);
  });
});
