import { notFound } from 'next/navigation';
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
    <main>
      <h1>Files received</h1>
      <p>
        We received {manifest.bills.length} bill PDF{manifest.bills.length === 1 ? '' : 's'}
        {manifest.greenButton.length > 0
          ? ` and ${manifest.greenButton.length} Green Button file${manifest.greenButton.length === 1 ? '' : 's'}`
          : ''}
        .
      </p>

      <h2>Bills</h2>
      <ul>
        {manifest.bills.map((name) => (
          <li key={name}>{name.replace(/^\d+-/, '')}</li>
        ))}
      </ul>

      {manifest.greenButton.length > 0 ? (
        <>
          <h2>Green Button data</h2>
          <ul>
            {manifest.greenButton.map((name) => (
              <li key={name}>{name.replace(/^\d+-/, '')}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>No Green Button data attached — we&apos;ll estimate your usage pattern instead.</p>
      )}

      <p style={{ marginTop: '2rem', color: '#666' }}>
        Upload ID: <code>{manifest.id}</code>
      </p>
      <p style={{ color: '#666' }}>
        Next: reading the rate schedule, usage, and totals off each bill — not built yet.
      </p>
    </main>
  );
}
