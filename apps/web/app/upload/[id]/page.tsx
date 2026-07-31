import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Progress } from '../../../components/Progress';
import { isValidUploadId, readManifest } from '../../../lib/storage';

export default async function UploadConfirmationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isValidUploadId(id)) notFound();

  const manifest = await readManifest(id);
  if (manifest === null) notFound();

  return (
    <main className="shell-main">
      <Progress current={1} />
      <h1>Files received</h1>
      <p className="muted">
        We received {manifest.bills.length} bill PDF{manifest.bills.length === 1 ? '' : 's'}
        {manifest.greenButton.length > 0
          ? ` and ${manifest.greenButton.length} Green Button file${manifest.greenButton.length === 1 ? '' : 's'}`
          : ''}
        .
      </p>

      <div className="card">
        <h3>Bills</h3>
        <div className="stack">
          {manifest.bills.map((name) => (
            <div key={name} className="ledger-row">
              <span className="ledger-label">{name.replace(/^\d+-/, '')}</span>
              <span className="ledger-fill" aria-hidden="true" />
              <span className="stamp stamp-neutral">PDF</span>
            </div>
          ))}
        </div>

        {manifest.greenButton.length > 0 ? (
          <>
            <h3 style={{ marginTop: '1.5rem' }}>Green Button data</h3>
            <div className="stack">
              {manifest.greenButton.map((name) => (
                <div key={name} className="ledger-row">
                  <span className="ledger-label">{name.replace(/^\d+-/, '')}</span>
                  <span className="ledger-fill" aria-hidden="true" />
                  <span className="stamp stamp-neutral">Interval data</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="small muted" style={{ marginTop: '1rem', marginBottom: 0 }}>
            No Green Button data attached. We&apos;ll estimate your usage pattern instead.
          </p>
        )}
      </div>

      <p className="small muted">
        Upload ID: <code>{manifest.id}</code>
      </p>
      <p>
        <Link href={`/upload/${manifest.id}/review`} className="btn">
          Read the rate schedule, usage, and totals off each bill →
        </Link>
      </p>
    </main>
  );
}
