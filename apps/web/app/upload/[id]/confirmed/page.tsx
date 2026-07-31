import { notFound } from 'next/navigation';
import { isValidUploadId } from '../../../../lib/storage';
import { readConfirmation } from '../../../../lib/extraction-storage';

export default async function ConfirmedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUploadId(id)) notFound();
  const confirmation = await readConfirmation(id);
  if (confirmation === null) notFound();

  return (
    <main>
      <h1>Thanks — values confirmed</h1>
      <p>
        You confirmed {confirmation.bills.length} bill{confirmation.bills.length === 1 ? '' : 's'} at{' '}
        {new Date(confirmation.confirmedAt).toLocaleString()}.
      </p>
      <p style={{ color: '#666' }}>
        Next: estimating your usage pattern and generating your rate comparison report — not built yet.
      </p>
    </main>
  );
}
