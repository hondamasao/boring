import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HolidayCalendar,
  Tariff,
  type BillingPeriod,
  type DemandHistory,
  type LoadProfile,
  type RatingContext,
} from '@boring/tariff-schema';
import { BillFixture, IntervalFile } from './fixture-schema.js';

/**
 * Loads fixtures from disk.
 *
 * All I/O lives here, deliberately: the engine does none, so the harness is where
 * files are read and where a bad path must produce a readable error rather than a
 * confusing one three layers down.
 */

/** Repo-root `fixtures/` directory. */
export function defaultFixturesRoot(): string {
  return resolve(fileURLToPath(new URL('../../../fixtures', import.meta.url)));
}

function readJson(path: string, label: string): unknown {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`${label} is not valid JSON: ${path}\n  ${String(cause)}`);
  }
}

/** Parses with a schema, prefixing issues with the file that caused them. */
function parseFile<T>(
  schema: { safeParse: (value: unknown) => { success: boolean } },
  value: unknown,
  path: string,
  label: string,
): T {
  const result = schema.safeParse(value) as
    | { success: true; data: T }
    | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } };
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`invalid ${label} at ${path}:\n${detail}`);
}

export interface LoadedFixture {
  fixture: BillFixture;
  /** Path the fixture was read from, for error messages. */
  fixturePath: string;
  tariff: Tariff;
  loadProfile: LoadProfile;
  billingPeriod: BillingPeriod;
  context: RatingContext;
}

/** Fixture JSON files under `fixtures/bills/`, sorted for deterministic order. */
export function listFixturePaths(root = defaultFixturesRoot()): string[] {
  const billsDir = join(root, 'bills');
  if (!existsSync(billsDir)) return [];
  return readdirSync(billsDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(billsDir, name));
}

/**
 * Loads one fixture and everything it references.
 *
 * The fixture's `tariffId` is checked against the loaded tariff's own id, so a
 * fixture cannot silently start reconciling against a different record — which is
 * exactly what would happen the first time a tariff is superseded and the path is
 * repointed.
 */
export function loadFixture(fixturePath: string, root = defaultFixturesRoot()): LoadedFixture {
  const fixture = parseFile<BillFixture>(
    BillFixture,
    readJson(fixturePath, 'fixture'),
    fixturePath,
    'bill fixture',
  );

  const tariffPath = join(root, fixture.tariffRef);
  const tariff = parseFile<Tariff>(Tariff, readJson(tariffPath, 'tariff'), tariffPath, 'tariff');
  if (tariff.id !== fixture.tariffId) {
    throw new Error(
      `fixture "${fixture.id}" expects tariff id "${fixture.tariffId}" but ${tariffPath} contains "${tariff.id}"`,
    );
  }

  const intervalsPath = join(root, fixture.intervalsRef);
  const intervalFile = parseFile<IntervalFile>(
    IntervalFile,
    readJson(intervalsPath, 'interval data'),
    intervalsPath,
    'interval data',
  );

  const holidayPath = join(root, fixture.holidayCalendarRef);
  const holidayCalendar = parseFile<HolidayCalendar>(
    HolidayCalendar,
    readJson(holidayPath, 'holiday calendar'),
    holidayPath,
    'holiday calendar',
  );

  const loadProfile: LoadProfile = {
    timezone: intervalFile.timezone,
    intervalMinutes: intervalFile.intervalMinutes,
    readings: intervalFile.readings,
    ...(intervalFile.meterId !== undefined ? { meterId: intervalFile.meterId } : {}),
  };

  const demandHistory: DemandHistory = fixture.demandHistory ?? { entries: [] };

  return {
    fixture,
    fixturePath,
    tariff,
    loadProfile,
    billingPeriod: fixture.billingPeriod,
    context: {
      holidayCalendar,
      demandHistory,
      serviceAttributes: fixture.serviceAttributes ?? {},
    },
  };
}

/** Loads every fixture under `fixtures/bills/`. */
export function loadAllFixtures(root = defaultFixturesRoot()): LoadedFixture[] {
  return listFixturePaths(root).map((path) => loadFixture(path, root));
}
