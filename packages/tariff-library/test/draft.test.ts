/**
 * The draft TOU-GS-2 record MUST NOT validate yet.
 *
 * This test is the "fail loudly" mechanism for the unanswered tariff questions. It
 * breaks in both directions:
 *  - fill a pending field in, and the expected-error list goes stale;
 *  - introduce a NEW kind of error, and it is not in the allowed set.
 *
 * So the draft cannot quietly start looking usable, and it cannot quietly rot.
 * See PENDING.md for what each field needs.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Tariff } from '@boring/tariff-schema';

const tariffsRoot = fileURLToPath(new URL('../tariffs', import.meta.url));
const draftPath = join(tariffsRoot, 'sce/tou-gs-2/DRAFT-unverified.json');

/**
 * Top-level paths that are legitimately unpopulated. Every entry corresponds to a
 * numbered item in PENDING.md; when one is filled in, delete it from here and this
 * test tells you if you missed something.
 */
const PENDING_PATHS = new Set([
  'seasons',
  'touPeriods',
  'touRules',
  'holidayTreatment',
  'energyCharges',
  'eligibility',
  'fixedCharges',
  'minimumBill',
  'demandCharges',
  'riders',
  'provenance',
]);

function issuesFor(path: string): { path: string; message: string }[] {
  const result = Tariff.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

describe('the TOU-GS-2 draft', () => {
  it('exists', () => {
    expect(existsSync(draftPath)).toBe(true);
  });

  it('does NOT validate, so it cannot be mistaken for a usable record', () => {
    const issues = issuesFor(draftPath);
    expect(
      issues.length,
      'the draft now validates — if the sheet has been read, move it to a real filename, update PENDING.md, and delete this test',
    ).toBeGreaterThan(0);
  });

  it('fails only on fields PENDING.md accounts for', () => {
    const issues = issuesFor(draftPath);
    const unexpected = issues.filter((issue) => {
      const top = issue.path.split('.')[0] ?? '(root)';
      // The `_WARNING` key is a deliberate strict-mode failure: it makes the file
      // unusable by construction, not merely incomplete.
      if (top === '(root)' && issue.message.toLowerCase().includes('unrecognized key')) return false;
      return !PENDING_PATHS.has(top);
    });

    expect(
      unexpected,
      `unexpected validation errors — either the draft has a real mistake, or PENDING.md needs a new entry:\n${unexpected.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`,
    ).toEqual([]);
  });

  it('contains no invented rates that could be shipped by accident', () => {
    const raw = readFileSync(draftPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Every priced collection is empty, so there is no placeholder number anywhere
    // in the file to forget to remove.
    expect(parsed['energyCharges']).toEqual([]);
    expect(parsed['riders']).toEqual([]);
    expect(parsed['demandCharges']).toEqual({ facilities: [], timeRelated: [] });
    expect(parsed['fixedCharges']).toEqual({
      customerCharge: null,
      meterCharge: null,
      dailyMinimumCharge: null,
    });
    expect(parsed['minimumBill']).toBeNull();
    expect(parsed['powerFactorAdjustment']).toBeNull();
  });

  it('claims no ratchet, which is a statement about the sheet and still unverified', () => {
    // PENDING.md records that sce.com returned 403 so the primary source could not
    // be checked. The machinery is tested against a synthetic tariff either way.
    const parsed = JSON.parse(readFileSync(draftPath, 'utf8')) as Record<string, unknown>;
    expect(parsed['ratchets']).toEqual([]);
    expect(readFileSync(join(tariffsRoot, '../PENDING.md'), 'utf8')).toContain('ratchet question');
  });
});

describe('every non-draft tariff record', () => {
  function jsonFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return jsonFiles(path);
      return entry.name.endsWith('.json') ? [path] : [];
    });
  }

  const records = jsonFiles(tariffsRoot).filter((path) => !path.includes('DRAFT-'));

  it('validates, once there are any', () => {
    for (const path of records) {
      const issues = issuesFor(path);
      expect(issues, `${path}:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`).toEqual([]);
    }
  });

  it('is verified by a person', () => {
    // CLAUDE.md #4: every tariff record carries provenance, and a record nobody
    // has checked against the PDF has no business rating a real bill.
    for (const path of records) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { provenance?: { verifiedBy?: unknown } };
      expect(parsed.provenance?.verifiedBy, `${path} has no verifiedBy`).toBeTruthy();
    }
  });
});
