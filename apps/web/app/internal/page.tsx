import type { Metadata } from 'next';
import Link from 'next/link';
import { listReportedUploadIds, readReportRecord, type ReportRecord } from '../../lib/report-storage';
import { readFeedback, type FeedbackRecord } from '../../lib/feedback-storage';

// Aggregates every customer's report in one place — this is the one page in
// the app that isn't safe behind "the link is unguessable" alone, hence the
// real password gate in middleware.ts. Never let a search engine near it.
export const metadata: Metadata = {
  title: 'Internal — Reports',
  robots: { index: false, follow: false },
};

// No dynamic route segment here to force per-request rendering the way
// /upload/[id] gets it for free, so it's explicit: this list must never be
// frozen at build time, or a new report would never show up without a
// redeploy.
export const dynamic = 'force-dynamic';

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

const FEEDBACK_LABEL: Record<FeedbackRecord['answer'], string> = {
  yes: 'Yes, close',
  no: 'No, way off',
  not_sure: 'Not sure',
};

export default async function InternalReportsPage() {
  const ids = await listReportedUploadIds();
  const rows = (
    await Promise.all(
      ids.map(async (id) => {
        const [report, feedback] = await Promise.all([readReportRecord(id), readFeedback(id)]);
        return report ? { report, feedback } : null;
      }),
    )
  )
    .filter((r): r is { report: ReportRecord; feedback: FeedbackRecord | null } => r !== null)
    .sort((a, b) => b.report.generatedAt.localeCompare(a.report.generatedAt));

  return (
    <main className="shell-main wide">
      <h1>Reports</h1>
      <p className="muted">Every completed report, most recent first. {rows.length} total.</p>

      {rows.length === 0 ? (
        <p>No completed reports yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Generated</th>
                <th>Upload ID</th>
                <th>Recommended</th>
                <th className="num">Annual delta</th>
                <th>Feedback</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ report, feedback }) => (
                <tr key={report.uploadId}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(report.generatedAt).toLocaleString('en-US')}</td>
                  <td>
                    <Link href={`/upload/${report.uploadId}/report`} className="num small">
                      {report.uploadId}
                    </Link>
                  </td>
                  <td>
                    {report.recommendedOption === 'tie' ? 'Tie' : `Option ${report.recommendedOption}`}{' '}
                    <span className="small muted">
                      ({report.monthsCount} mo{report.monthsCount === 1 ? '' : 's'})
                    </span>
                  </td>
                  <td className="num">
                    {formatUsd(report.annualDelta)}
                    {report.annualDeltaIsScaled ? '*' : ''}
                  </td>
                  <td>{feedback ? FEEDBACK_LABEL[feedback.answer] : '—'}</td>
                  <td className="small muted">{feedback?.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ marginTop: '1rem' }}>
        * Annual delta scaled up from fewer than 12 confirmed months, not a real annual figure.
      </p>
    </main>
  );
}
