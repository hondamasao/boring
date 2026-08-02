import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { LoadShapeEstimate } from '@boring/load-shape-estimator';
import { Progress } from '../../../../components/Progress';
import { isValidUploadId, readManifest } from '../../../../lib/storage';
import { readConfirmation } from '../../../../lib/extraction-storage';
import { getOrEstimateBill, type BillEstimate } from '../../../../lib/bill-usage';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Estimated Usage',
  robots: { index: false, follow: false },
};

function methodLabel(method: LoadShapeEstimate['method']): string {
  return method === 'fit-energy-and-peak' ? 'fit to both total energy and peak demand' : 'fit to total energy only';
}

function BillCard({ result }: { result: BillEstimate }) {
  const displayName = result.filename.replace(/^\d+-/, '');

  if (result.status === 'error') {
    return (
      <Card style={{ borderColor: 'var(--bad-line)', background: 'var(--bad-bg)' }}>
        <CardContent>
          <div className="card-header">
            <h2 className="subhead" style={{ marginBottom: 0 }}>{displayName}</h2>
            <span className="stamp stamp-bad">Could not estimate</span>
          </div>
          <p style={{ marginBottom: 0 }}>{result.message}</p>
        </CardContent>
      </Card>
    );
  }

  const { estimate } = result;
  const totalKwh = estimate.profile.readings.reduce((sum, r) => sum + r.kwh, 0);

  return (
    <Card>
      <CardContent>
        <div className="card-header">
          <h2 className="subhead" style={{ marginBottom: 0 }}>{displayName}</h2>
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
      </CardContent>
    </Card>
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
      <Progress current={3} />
      <h1>Estimated usage</h1>

      {manifest.greenButton.length > 0 ? (
        <div className="notice notice-warn">
          <p style={{ marginBottom: 0 }}>
            You attached {manifest.greenButton.length} Green Button file{manifest.greenButton.length === 1 ? '' : 's'},
            but the parser for it (<code>packages/greenbutton</code>) isn&apos;t built yet. We used the estimated
            load shape below instead. Your Green Button file wasn&apos;t used.
          </p>
        </div>
      ) : null}

      <div className="notice notice-beta">
        <p style={{ marginBottom: 0 }}>
          <strong>This usage profile is ESTIMATED, not measured.</strong>{' '}
          No interval data went into it. Check &quot;Assumptions used&quot; on each bill below to
          see exactly how we built the numbers, and treat any demand-charge finding as a rough
          approximation, not a precise figure.
        </p>
      </div>

      {results.map((result) => (
        <BillCard key={result.filename} result={result} />
      ))}

      {anyOk ? (
        <p>
          <Button asChild>
            <Link href={`/upload/${id}/report`}>See your rate comparison report →</Link>
          </Button>
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
