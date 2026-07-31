import { notFound } from 'next/navigation';
import { extractBill, ExtractionError, type ExtractedBill, type ExtractedField } from '@boring/extraction';
import { Progress } from '../../../../components/Progress';
import { isValidUploadId, readBillFile, readManifest } from '../../../../lib/storage';
import { readCachedExtraction, writeCachedExtraction } from '../../../../lib/extraction-storage';
import { confirmExtraction } from './actions';

type BillResult =
  | { filename: string; status: 'ok'; data: ExtractedBill }
  | { filename: string; status: 'error'; message: string };

async function getOrExtract(uploadId: string, filename: string): Promise<BillResult> {
  const cached = await readCachedExtraction(uploadId, filename);
  if (cached !== null) return { filename, status: 'ok', data: cached };

  try {
    const bytes = await readBillFile(uploadId, filename);
    if (bytes === null) throw new Error('Bill file not found in storage.');
    const data = await extractBill(bytes);
    await writeCachedExtraction(uploadId, filename, data);
    return { filename, status: 'ok', data };
  } catch (err) {
    const message = err instanceof ExtractionError || err instanceof Error ? err.message : String(err);
    return { filename, status: 'error', message };
  }
}

function confidenceStamp(confidence: number): { label: string; className: string } {
  if (confidence >= 0.8) return { label: `${Math.round(confidence * 100)}%`, className: 'stamp-ok' };
  if (confidence >= 0.4) return { label: `${Math.round(confidence * 100)}%`, className: 'stamp-warn' };
  return { label: `${Math.round(confidence * 100)}%`, className: 'stamp-bad' };
}

function FieldRow({ label, field }: { label: string; field: ExtractedField<string | number> }) {
  const display = field.value === null ? 'Not found' : String(field.value);
  const conf = confidenceStamp(field.confidence);
  return (
    <tr>
      <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{label}</td>
      <td className={field.value === null ? 'muted' : 'num'}>{display}</td>
      <td>
        <span className={`stamp ${conf.className}`}>{conf.label}</span>
      </td>
      <td className="quote small">{field.evidence ? `“${field.evidence}”` : '—'}</td>
    </tr>
  );
}

function FieldCard({ label, field }: { label: string; field: ExtractedField<string | number> }) {
  const display = field.value === null ? 'Not found' : String(field.value);
  const conf = confidenceStamp(field.confidence);
  return (
    <div className="field-card">
      <div className="field-card-head">
        <span className="field-card-label">{label}</span>
        <span className={`stamp ${conf.className}`}>{conf.label}</span>
      </div>
      <p className={`field-card-value ${field.value === null ? 'muted' : 'num'}`}>{display}</p>
      {field.evidence ? <p className="quote small" style={{ margin: 0 }}>“{field.evidence}”</p> : null}
    </div>
  );
}

function BillSection({ result }: { result: BillResult }) {
  const displayName = result.filename.replace(/^\d+-/, '');

  if (result.status === 'error') {
    return (
      <div className="card card-bad">
        <div className="card-header">
          <h3 style={{ marginBottom: 0 }}>{displayName}</h3>
          <span className="stamp stamp-bad">Extraction failed</span>
        </div>
        <p className="small" style={{ fontFamily: 'var(--font-mono)' }}>
          {result.message}
        </p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          This bill couldn&apos;t be read automatically. Try re-uploading a clearer scan, or leave
          it out for now — the rest of your bills will still work.
        </p>
      </div>
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
    <div className="card">
      <div className="card-header">
        <h3 style={{ marginBottom: 0 }}>{displayName}</h3>
        {lowConfidenceCount > 0 ? (
          <span className="stamp stamp-warn">
            {lowConfidenceCount} field{lowConfidenceCount === 1 ? '' : 's'} need review
          </span>
        ) : (
          <span className="stamp stamp-ok">Looks clean</span>
        )}
      </div>
      <div className="field-cards">
        <FieldCard label="Billing period start" field={data.billingPeriod.start} />
        <FieldCard label="Billing period end" field={data.billingPeriod.end} />
        <FieldCard label="Rate schedule" field={data.rateSchedule} />
        <FieldCard label="Total kWh" field={data.totalKwh} />
        <FieldCard label="Total demand (kW)" field={data.totalDemandKw} />
        <FieldCard label="Total amount ($)" field={data.totalAmount} />
      </div>
      <div className="field-table-wrap table-scroll">
        <table className="data-table">
          <thead>
            <tr>
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
      </div>
      {data.extractionNotes ? (
        <p className="small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
          <strong>Note:</strong> {data.extractionNotes}
        </p>
      ) : null}
    </div>
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
    <main className="shell-main">
      <Progress current={2} />
      <h1>Review extracted values</h1>
      <p className="muted">
        An AI model read these values off your bills — nobody has typed or checked them yet.
        Compare every field against the actual PDF before confirming, especially anything flagged
        below 50% confidence.
      </p>

      {results.map((result) => (
        <BillSection key={result.filename} result={result} />
      ))}

      {okFilenames.length > 0 ? (
        <form action={confirmAction} style={{ marginTop: '0.5rem' }}>
          <button type="submit" className="btn">
            Confirm these values are correct →
          </button>
          {hasFailures ? (
            <p className="small" style={{ color: 'var(--bad)', marginTop: '0.75rem' }}>
              Only the {okFilenames.length} bill{okFilenames.length === 1 ? '' : 's'} that
              extracted successfully will be confirmed. The failed bill(s) above need attention
              separately.
            </p>
          ) : null}
        </form>
      ) : (
        <div className="notice notice-bad">
          <p style={{ marginBottom: 0 }}>
            <strong>Every bill failed to extract.</strong>{' '}Nothing to confirm yet.
          </p>
        </div>
      )}
    </main>
  );
}
