import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { extractBill, ExtractionError, type ExtractedBill, type ExtractedField } from '@boring/extraction';
import { isValidUploadId, readManifest, uploadDir } from '../../../../lib/storage';
import { readCachedExtraction, writeCachedExtraction } from '../../../../lib/extraction-storage';
import { confirmExtraction } from './actions';

type BillResult =
  | { filename: string; status: 'ok'; data: ExtractedBill }
  | { filename: string; status: 'error'; message: string };

async function getOrExtract(uploadId: string, filename: string): Promise<BillResult> {
  const cached = await readCachedExtraction(uploadId, filename);
  if (cached !== null) return { filename, status: 'ok', data: cached };

  try {
    const bytes = await readFile(path.join(uploadDir(uploadId), 'bills', filename));
    const data = await extractBill(bytes);
    await writeCachedExtraction(uploadId, filename, data);
    return { filename, status: 'ok', data };
  } catch (err) {
    const message = err instanceof ExtractionError || err instanceof Error ? err.message : String(err);
    return { filename, status: 'error', message };
  }
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return '#1a7f37';
  if (confidence >= 0.4) return '#9a6700';
  return '#b00020';
}

function FieldRow({ label, field }: { label: string; field: ExtractedField<string | number> }) {
  const display = field.value === null ? 'Not found' : String(field.value);
  return (
    <tr>
      <td style={{ padding: '0.25rem 0.75rem 0.25rem 0', fontWeight: 'bold', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
        {label}
      </td>
      <td style={{ padding: '0.25rem 0.75rem', verticalAlign: 'top' }}>{display}</td>
      <td style={{ padding: '0.25rem 0.75rem', color: confidenceColor(field.confidence), verticalAlign: 'top' }}>
        {Math.round(field.confidence * 100)}%
      </td>
      <td style={{ padding: '0.25rem 0', color: '#666', fontStyle: 'italic', verticalAlign: 'top' }}>
        {field.evidence ? `“${field.evidence}”` : '—'}
      </td>
    </tr>
  );
}

function BillSection({ result }: { result: BillResult }) {
  const displayName = result.filename.replace(/^\d+-/, '');

  if (result.status === 'error') {
    return (
      <section style={{ border: '1px solid #b00020', borderRadius: 4, padding: '1rem', marginBottom: '1.5rem' }}>
        <h2>{displayName}</h2>
        <p style={{ color: '#b00020' }}>Extraction failed: {result.message}</p>
      </section>
    );
  }

  const { data } = result;
  const fields = [
    data.billingPeriod.start,
    data.billingPeriod.end,
    data.rateSchedule,
    data.totalKwh,
    data.totalDemandKw,
    data.totalAmount,
  ];
  const lowConfidenceCount = fields.filter((f) => f.value === null || f.confidence < 0.5).length;

  return (
    <section style={{ border: '1px solid #ccc', borderRadius: 4, padding: '1rem', marginBottom: '1.5rem' }}>
      <h2>{displayName}</h2>
      {lowConfidenceCount > 0 ? (
        <p style={{ color: '#9a6700' }}>
          {lowConfidenceCount} field{lowConfidenceCount === 1 ? '' : 's'} below 50% confidence or not found —
          check these against the PDF closely.
        </p>
      ) : null}
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#666' }}>
            <th>Field</th>
            <th>Value</th>
            <th>Confidence</th>
            <th>Evidence quoted from the bill</th>
          </tr>
        </thead>
        <tbody>
          <FieldRow label="Billing period start" field={data.billingPeriod.start} />
          <FieldRow label="Billing period end" field={data.billingPeriod.end} />
          <FieldRow label="Rate schedule" field={data.rateSchedule} />
          <FieldRow label="Total kWh" field={data.totalKwh} />
          <FieldRow label="Total demand (kW)" field={data.totalDemandKw} />
          <FieldRow label="Total amount ($)" field={data.totalAmount} />
        </tbody>
      </table>
      {data.extractionNotes ? (
        <p>
          <strong>Note:</strong> {data.extractionNotes}
        </p>
      ) : null}
    </section>
  );
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUploadId(id)) notFound();
  const manifest = await readManifest(id);
  if (manifest === null || manifest.bills.length === 0) notFound();

  const results = await Promise.all(manifest.bills.map((filename) => getOrExtract(id, filename)));
  const okFilenames = results.filter((r): r is Extract<BillResult, { status: 'ok' }> => r.status === 'ok').map((r) => r.filename);
  const hasFailures = results.some((r) => r.status === 'error');
  const confirmAction = confirmExtraction.bind(null, id, okFilenames);

  return (
    <main>
      <h1>Review extracted values</h1>
      <p>
        An AI model read these values off your bills — nobody has typed or checked them yet. Compare every field
        against the actual PDF before confirming, especially anything flagged below 50% confidence.
      </p>

      {results.map((result) => (
        <BillSection key={result.filename} result={result} />
      ))}

      {okFilenames.length > 0 ? (
        <form action={confirmAction} style={{ marginTop: '1rem' }}>
          <button type="submit">Confirm these values are correct →</button>
          {hasFailures ? (
            <p style={{ color: '#b00020' }}>
              Only the {okFilenames.length} bill{okFilenames.length === 1 ? '' : 's'} that extracted successfully
              will be confirmed. The failed bill(s) above need attention separately.
            </p>
          ) : null}
        </form>
      ) : (
        <p style={{ color: '#b00020', fontWeight: 'bold' }}>Every bill failed to extract. Nothing to confirm yet.</p>
      )}
    </main>
  );
}
