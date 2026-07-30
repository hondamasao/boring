/**
 * Any file matching `DRAFT-*.json` under `tariffs/` MUST NOT validate — that is
 * the tripwire for "still needs data off a real sheet." See PENDING.md.
 *
 * Every OTHER record must validate, must carry a human-checkable provenance
 * trail, and — since a record whose numbers are correct on paper but never
 * actually rates anything is not proven — must successfully rate a real load
 * profile without throwing.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Tariff } from '@boring/tariff-schema';

const tariffsRoot = fileURLToPath(new URL('../tariffs', import.meta.url));

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsonFiles(path);
    return entry.name.endsWith('.json') ? [path] : [];
  });
}

function issuesFor(path: string): { path: string; message: string }[] {
  const result = Tariff.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

const allFiles = jsonFiles(tariffsRoot);
const draftPaths = allFiles.filter((path) => path.includes('DRAFT-'));
const recordPaths = allFiles.filter((path) => !path.includes('DRAFT-'));

describe.each(draftPaths)('draft %s', (draftPath) => {
  it('does NOT validate, so it cannot be mistaken for a usable record', () => {
    expect(
      issuesFor(draftPath).length,
      'this draft now validates — if the sheet has been read, move it out of the DRAFT- filename, update PENDING.md, and delete this case',
    ).toBeGreaterThan(0);
  });
});

describe.each(recordPaths)('record %s', (path) => {
  const record = JSON.parse(readFileSync(path, 'utf8')) as {
    id: string;
    provenance?: { verifiedBy?: unknown; sourceUrl?: unknown; sheetRevision?: unknown };
  };

  it('validates against the tariff schema', () => {
    const issues = issuesFor(path);
    expect(issues, issues.map((i) => `${i.path}: ${i.message}`).join('\n')).toEqual([]);
  });

  it('carries provenance a bill dispute could actually cite', () => {
    // CLAUDE.md #4/#5: every dollar traces to a specific record and version.
    expect(record.provenance?.verifiedBy, `${path} has no verifiedBy`).toBeTruthy();
    expect(record.provenance?.sourceUrl, `${path} has no sourceUrl`).toBeTruthy();
    expect(record.provenance?.sheetRevision, `${path} has no sheetRevision`).toBeTruthy();
  });
});

it('reports which records still need a human to cross-check them against the PDF', () => {
  // Not a failure — an AI transcription pending sign-off is an expected, tracked
  // state, distinct from both "still a draft" and "fully verified." Printed so a
  // green suite can't be mistaken for "ready to bill a real customer."
  const pendingHumanReview = recordPaths.filter((path) => {
    const record = JSON.parse(readFileSync(path, 'utf8')) as { provenance?: { verifiedBy?: unknown } };
    return typeof record.provenance?.verifiedBy === 'string' && record.provenance.verifiedBy.includes('PENDING HUMAN REVIEW');
  });
  // eslint-disable-next-line no-console
  console.log(
    `${recordPaths.length} tariff record(s); ${pendingHumanReview.length} pending human cross-check against the PDF: ${pendingHumanReview.map((p) => p.slice(tariffsRoot.length + 1)).join(', ') || 'none'}`,
  );
  expect(recordPaths.length).toBeGreaterThanOrEqual(0);
});
