import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Progress } from '../../../../components/Progress';
import { isValidUploadId } from '../../../../lib/storage';
import { readConfirmation } from '../../../../lib/extraction-storage';

export default async function ConfirmedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUploadId(id)) notFound();
  const confirmation = await readConfirmation(id);
  if (confirmation === null) notFound();

  return (
    <main className="shell-main">
      <Progress current={2} />
      <h1>Values confirmed</h1>
      <p className="muted">
        You confirmed {confirmation.bills.length} bill{confirmation.bills.length === 1 ? '' : 's'} at{' '}
        <span className="num">{new Date(confirmation.confirmedAt).toLocaleString()}</span>.
      </p>
      <p>
        <Link href={`/upload/${id}/usage`} className="btn">
          Estimate your usage pattern →
        </Link>
      </p>
    </main>
  );
}
