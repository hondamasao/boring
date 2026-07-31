import { notFound, redirect } from 'next/navigation';
import { estimateLoadProfile, type LoadShapeEstimate } from '@boring/load-shape-estimator';
import { isValidUploadId, readManifest } from '../../../../lib/storage';
import { readCachedExtraction, readConfirmation } from '../../../../lib/extraction-storage';
import { readCachedEstimate, writeCachedEstimate } from '../../../../lib/estimate-storage';
import { billToEstimatorInput } from '../../../../lib/usage-estimate';

type BillEstimate =
  | { filename: string; status: 'ok'; estimate: LoadShapeEstimate }
  | { filename: string; status: 'error'; message: string };

async function getOrEstimate(uploadId: string, filename: string): Promise<BillEstimate> {
  const cached = await readCachedEstimate(uploadId, filename);
  if (cached !== null) return { filename, status: 'ok', estimate: cached };

  const bill = await readCachedExtraction(uploadId, filename);
  if (bill === null) {
    return { filename, status: 'error', message: 'No confirmed extraction found for this bill.' };
  }

  const converted = billToEstimatorInput(bill);
  if (!converted.ok) {
    return { filename, status: 'error', message: converted.reason };
  }

  try {
    const estimate = estimateLoadProfile(converted.input);
    await writeCachedEstimate(uploadId, filename, estimate);
    return { filename, status: 'ok', estimate };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { filename, status: 'error', message };
  }
}

function methodLabel(method: LoadShapeEstimate['method']): string {
  return method === 'fit-energy-and-peak'
    ? 'fit to both total energy and peak demand'
    : 'fit to total energy only';
}

function BillCard({ result }: { result: BillEstimate }) {
  const displayName = result.filename.replace(/^\d+-/, '');

  if (result.status === 'error') {
    return (
      <section style={{ border: '1px solid #b00020', borderRadius: 4, padding: '1rem', marginBottom: '1.5rem' }}>
        <h2>{displayName}</h2>
        <p style={{ color: '#b00020' }}>Could not estimate usage: {result.message}</p>
      </section>
    );
  }

  const { estimate } = result;
  const totalKwh = estimate.profile.readings.reduce((sum, r) => sum + r.kwh, 0);

  return (
    <section style={{ border: '1px solid #ccc', borderRadius: 4, padding: '1rem', marginBottom: '1.5rem' }}>
      <h2>{displayName}</h2>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <td style={{ paddingRight: '1rem', fontWeight: 'bold' }}>Method</td>
            <td>{methodLabel(estimate.method)}</td>
          </tr>
          <tr>
            <td style={{ paddingRight: '1rem', fontWeight: 'bold' }}>Estimated total energy</td>
            <td>{totalKwh.toFixed(1)} kWh</td>
          </tr>
          <tr>
            <td style={{ paddingRight: '1rem', fontWeight: 'bold' }}>Estimated peak demand</td>
            <td>{estimate.impliedPeakKw.toFixed(1)} kW</td>
          </tr>
          <tr>
            <td style={{ paddingRight: '1rem', fontWeight: 'bold' }}>Intervals generated</td>
            <td>{estimate.profile.readings.length} (15-minute)</td>
          </tr>
        </tbody>
      </table>
      <details style={{ marginTop: '0.5rem', color: '#666' }}>
        <summary>Assumptions used for this bill</summary>
        <ul>
          {estimate.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export default async function UsagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUploadId(id)) notFound();

  const [manifest, confirmation] = await Promise.all([readManifest(id), readConfirmation(id)]);
  if (manifest === null) notFound();
  if (confirmation === null) redirect(`/upload/${id}/review`);

  const results = await Promise.all(confirmation.bills.map((filename) => getOrEstimate(id, filename)));
  const anyOk = results.some((r) => r.status === 'ok');

  return (
    <main>
      <h1>Estimated usage</h1>

      {manifest.greenButton.length > 0 ? (
        <p style={{ background: '#fff3cd', padding: '0.75rem', borderRadius: 4 }}>
          You attached {manifest.greenButton.length} Green Button file{manifest.greenButton.length === 1 ? '' : 's'},
          but the parser for it (<code>packages/greenbutton</code>) isn&apos;t built yet. We used the estimated load
          shape below instead — your Green Button file was not used.
        </p>
      ) : null}

      <p
        style={{
          background: '#f5f5f5',
          border: '1px solid #ddd',
          borderRadius: 4,
          padding: '1rem',
          fontWeight: 'bold',
        }}
      >
        This usage profile is ESTIMATED, not measured. No interval data was used to build it — see &quot;Assumptions
        used&quot; on each bill below for exactly how, and treat any demand-charge-related finding built from it as
        a rough approximation rather than a precise number.
      </p>

      {results.map((result) => (
        <BillCard key={result.filename} result={result} />
      ))}

      {anyOk ? (
        <p style={{ color: '#666' }}>Next: generating your rate comparison report — not built yet.</p>
      ) : (
        <p style={{ color: '#b00020', fontWeight: 'bold' }}>No bill could be estimated.</p>
      )}
    </main>
  );
}
