import type { ExtractedBill } from '@boring/extraction';
import type { LoadShapeEstimateMethod } from '@boring/load-shape-estimator';
import { readCachedExtraction } from './extraction-storage';
import { getOrEstimateBill } from './bill-usage';
import { uploadDir } from './storage';
import { storageBackend } from './storage-backend';
import type { MonthlyComparison } from './compare-options';

/**
 * A permanent snapshot of a completed report: the confirmed bill values, the
 * usage estimate used, and the recommendation shown, written once so it
 * survives independent of whether comparison logic changes later. Read back
 * by the internal reports listing (app/internal/reports) — see
 * report.json's key layout below and reports/index.json, the small rollup
 * that page reads to find every upload id with a report at all (the
 * StorageBackend.list() contract only returns a prefix's direct children, so
 * it can't itself enumerate every uploads/<id> subdirectory).
 */

export interface ReportBillRecord {
  filename: string;
  monthLabel: string;
  confirmedValues: ExtractedBill;
  usageEstimateMethod: LoadShapeEstimateMethod;
  billDTotal: number;
  billETotal: number;
  cheaper: 'D' | 'E' | 'tie';
  onFileOption: 'D' | 'E' | null;
  actualBilled: number | null;
}

export interface ReportRecord {
  uploadId: string;
  generatedAt: string;
  monthsCount: number;
  totalD: number;
  totalE: number;
  recommendedOption: 'D' | 'E' | 'tie';
  annualDelta: number;
  annualDeltaIsScaled: boolean;
  onFileOption: 'D' | 'E' | null;
  bills: ReportBillRecord[];
}

export interface ReportOverallStats {
  totalD: number;
  totalE: number;
  overallCheaper: 'D' | 'E' | 'tie';
  annualDelta: number;
  annualDeltaIsScaled: boolean;
  onFileOption: 'D' | 'E' | null;
}

function reportKey(uploadId: string): string {
  return `${uploadDir(uploadId)}/report.json`;
}

const INDEX_KEY = 'reports/index.json';

async function readIndex(): Promise<string[]> {
  const raw = await storageBackend().read(INDEX_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

async function addToIndex(uploadId: string): Promise<void> {
  const ids = await readIndex();
  if (ids.includes(uploadId)) return;
  // Low-traffic beta tool, one operator — a concurrent double-add here would
  // at worst write the same id twice in a row, which listReportedUploadIds
  // still reads fine (readReportRecord is keyed by id, not index position).
  // Not worth a lock for this scale.
  ids.push(uploadId);
  await storageBackend().write(INDEX_KEY, Buffer.from(JSON.stringify(ids, null, 2)));
}

export async function readReportRecord(uploadId: string): Promise<ReportRecord | null> {
  const raw = await storageBackend().read(reportKey(uploadId));
  if (raw === null) return null;
  try {
    return JSON.parse(raw.toString('utf8')) as ReportRecord;
  } catch {
    return null;
  }
}

export async function listReportedUploadIds(): Promise<string[]> {
  return readIndex();
}

/**
 * Writes the permanent report snapshot the first time a report is
 * successfully generated for this upload. A later view of the same report
 * leaves the existing record alone — the point is a durable record of what
 * was actually shown, not a live-recomputed mirror of the report page.
 */
export async function ensureReportRecord(
  uploadId: string,
  comparisons: MonthlyComparison[],
  overall: ReportOverallStats,
): Promise<void> {
  const existing = await readReportRecord(uploadId);
  if (existing !== null) return;

  const bills = await Promise.all(
    comparisons.map(async (c): Promise<ReportBillRecord | null> => {
      const [confirmedValues, estimateResult] = await Promise.all([
        readCachedExtraction(uploadId, c.filename),
        getOrEstimateBill(uploadId, c.filename),
      ]);
      if (confirmedValues === null || estimateResult.status !== 'ok') return null;
      return {
        filename: c.filename,
        monthLabel: c.monthLabel,
        confirmedValues,
        usageEstimateMethod: estimateResult.estimate.method,
        billDTotal: c.billD.total,
        billETotal: c.billE.total,
        cheaper: c.cheaper,
        onFileOption: c.onFileOption,
        actualBilled: c.actualBilled,
      };
    }),
  );

  const record: ReportRecord = {
    uploadId,
    generatedAt: new Date().toISOString(),
    monthsCount: comparisons.length,
    totalD: overall.totalD,
    totalE: overall.totalE,
    recommendedOption: overall.overallCheaper,
    annualDelta: overall.annualDelta,
    annualDeltaIsScaled: overall.annualDeltaIsScaled,
    onFileOption: overall.onFileOption,
    bills: bills.filter((b): b is ReportBillRecord => b !== null),
  };

  await storageBackend().write(reportKey(uploadId), Buffer.from(JSON.stringify(record, null, 2)));
  await addToIndex(uploadId);
}
