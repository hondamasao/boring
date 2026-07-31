import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { LoadShapeEstimate } from '@boring/load-shape-estimator';
import { isValidUploadId, readManifest } from '../../../../lib/storage';
import { readConfirmation } from '../../../../lib/extraction-storage';
import { getOrEstimateBill, type BillEstimate } from '../../../../lib/bill-usage';

function methodLabel(method: LoadShapeEstimate['method']): string {
  return method === 'fit-energy-and-peak' ? 'fit to both total energy and peak demand' : 'fit to total energy only';
}

function BillCard({ result }: { result: BillEstimate }) {
  const displayName = result.filename.replace(/^\d+-/, '');

  if (result.status === 'error') {
    return (
      <div className="card card-bad">
        <div className="card-header">
          <h3 style={{ marginBottom: 0 }}>{displayName}</h3>
          <span className="stamp stamp-bad">Could not estimate</span>
        </div>
        <p style={{ marginBottom: 0 }}>{result.message}</p>
      </div>
    );
  }

  const { estimate } = result;
  const totalKwh = estimate.profile.readings.reduce((sum, r) => sum + r.kwh, 0);

  return (
    <div className="card">
      <div className="card-header">
        <h3 style={{ marginBottom: 0 }}>{displayName}</h3>
        <span className="stamp stamp-accent">Estimated</span>
      </div>
      <div className="stack">
        <div className="ledger-row">
          <span className="ledger-label">Method</span>
          <span className="ledger-fill" aria-hidden="true" />
          <span className="ledger-value">{methodLabel(estimate.method)}</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">Estimated total energy</span>
          <span className="ledger-fill" aria-hidden="true" />
          <span className="ledger-value">{totalKwh.toFixed(1)} kWh</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">Estimated peak demand</span>
          <span className="ledger-fill" aria-hidden="true" />
          <span className="ledger-value">{estimate.impliedPeakKw.toFixed(1)} kW</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">Intervals generated</span>
          <span className="ledger-fill" aria-hidden="true" />
          <span className="ledger-value">{estimate.profile.readings.length} · 15-minute</span>
        </div>
      </div>
      <details style={{ marginTop: '0.75rem' }}>
        <summary>Assumptions used for this bill</summary>
        <ul className="small muted" style={{ marginTop: '0.5rem' }}>
          {estimate.assumptions.map((a) => (
            <li key={a} style={{ marginBottom: '0.4rem' }}>
              {a}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export default async function UsagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUploadId(id)) notFound();

  const [manifest, confirmation] = await Promise.all([readManifest(id), readConfirmation(id)]);
  if (manifest === null) notFound();
  if (confirmation === null) redirect(`/upload/${id}/review`);

  const results = await Promise.all(confirmation.bills.map((filename) => getOrEstimateBill(id, filename)));
  const anyOk = results.some((r) => r.status === 'ok');

  return (
    <main className="shell-main">
      <p className="eyebrow">Step 3 of 4 · Usage</p>
      <h1>Estimated usage</h1>

      {manifest.greenButton.length > 0 ? (
        <div className="notice notice-warn">
          <p style={{ marginBottom: 0 }}>
            You attached {manifest.greenButton.length} Green Button file{manifest.greenButton.length === 1 ? '' : 's'},
            but the parser for it (<code>packages/greenbutton</code>) isn&apos;t built yet. We used the estimated
            load shape below instead — your Green Button file was not used.
          </p>
        </div>
      ) : null}

      <div className="notice notice-beta">
        <p style={{ marginBottom: 0 }}>
          <strong>This usage profile is ESTIMATED, not measured.</strong>{' '}
          No interval data was used to build it — see &quot;Assumptions used&quot; on each bill
          below for exactly how, and treat any demand-charge-related finding built from it as a
          rough approximation rather than a precise number.
        </p>
      </div>

      {results.map((result) => (
        <BillCard key={result.filename} result={result} />
      ))}

      {anyOk ? (
        <p>
          <Link href={`/upload/${id}/report`} className="btn">
            See your rate comparison report →
          </Link>
        </p>
      ) : (
        <div className="notice notice-bad">
          <p style={{ marginBottom: 0 }}>
            <strong>No bill could be estimated.</strong>
          </p>
        </div>
      )}
    </main>
  );
}
