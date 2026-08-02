import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { BillLine } from '@boring/rating-engine';
import { Progress } from '../../../../components/Progress';
import { isValidUploadId, readManifest } from '../../../../lib/storage';
import { readConfirmation } from '../../../../lib/extraction-storage';
import { compareBillToOptions, type ExcludedBill, type MonthlyComparison } from '../../../../lib/compare-options';
import { ensureReportRecord } from '../../../../lib/report-storage';
import { readFeedback } from '../../../../lib/feedback-storage';
import { submitFeedback } from './actions';

// The whole reason this field exists: a report holds one customer's real
// bill totals, rate schedule, and dollar figures behind an unguessable
// link. It must never be crawled, cached, or listed by a search engine.
export const metadata: Metadata = {
  title: 'Rate Comparison Report',
  robots: { index: false, follow: false },
};

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function LineLedger({ lines }: { lines: BillLine[] }) {
  return (
    <div className="stack" style={{ marginTop: '0.5rem' }}>
      {lines.map((l) => (
        <div className="ledger-row" key={l.id}>
          <span className="ledger-label">{l.description}</span>
          <span className="ledger-fill" aria-hidden="true" />
          <span className="ledger-value">{formatUsd(l.amount)}</span>
        </div>
      ))}
    </div>
  );
}

function onFileLabelFor(c: MonthlyComparison): string {
  return c.onFileOption ? `Option ${c.onFileOption}` : c.onFileRaw ? `${c.onFileRaw} (unclear)` : 'Unknown';
}

function CheaperStamp({ cheaper }: { cheaper: MonthlyComparison['cheaper'] }) {
  return (
    <span className={`stamp ${cheaper === 'tie' ? 'stamp-neutral' : 'stamp-ok'}`}>
      {cheaper === 'tie' ? 'Tie' : `Option ${cheaper}`}
    </span>
  );
}

function MonthRow({ c }: { c: MonthlyComparison }) {
  return (
    <tr>
      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{c.monthLabel}</td>
      <td className="num">{formatUsd(c.billD.total)}</td>
      <td className="num">{formatUsd(c.billE.total)}</td>
      <td>
        <CheaperStamp cheaper={c.cheaper} />
      </td>
      <td className="num">{formatUsd(c.deltaAbs)}</td>
      <td className="small muted">{onFileLabelFor(c)}</td>
      <td className="num">{c.actualBilled !== null ? formatUsd(c.actualBilled) : '—'}</td>
    </tr>
  );
}

function MonthCard({ c }: { c: MonthlyComparison }) {
  return (
    <div className="month-card">
      <div className="month-card-header">
        <h3>{c.monthLabel}</h3>
        <CheaperStamp cheaper={c.cheaper} />
      </div>
      <div className="stack">
        <div className="ledger-row">
          <span className="ledger-label">Option D</span>
          <span className="ledger-fill" aria-hidden="true" />
          <span className="ledger-value">{formatUsd(c.billD.total)}</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">Option E</span>
          <span className="ledger-fill" aria-hidden="true" />
          <span className="ledger-value">{formatUsd(c.billE.total)}</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">Difference</span>
          <span className="ledger-fill" aria-hidden="true" />
          <span className="ledger-value">{formatUsd(c.deltaAbs)}</span>
        </div>
        <div className="ledger-row ledger-row-stamped">
          <span className="ledger-label">On file</span>
          <span className="ledger-fill" aria-hidden="true" />
          <span className="small muted">{onFileLabelFor(c)}</span>
        </div>
        <div className="ledger-row">
          <span className="ledger-label">Actually billed</span>
          <span className="ledger-fill" aria-hidden="true" />
          <span className="ledger-value">{c.actualBilled !== null ? formatUsd(c.actualBilled) : '—'}</span>
        </div>
      </div>
    </div>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUploadId(id)) notFound();

  const [manifest, confirmation] = await Promise.all([readManifest(id), readConfirmation(id)]);
  if (manifest === null) notFound();
  if (confirmation === null) redirect(`/upload/${id}/review`);

  const results = await Promise.all(confirmation.bills.map((filename) => compareBillToOptions(id, filename)));
  const comparisons = results
    .filter((r): r is { status: 'ok'; comparison: MonthlyComparison } => r.status === 'ok')
    .map((r) => r.comparison);
  const excludedList = results
    .filter((r): r is { status: 'excluded'; excluded: ExcludedBill } => r.status === 'excluded')
    .map((r) => r.excluded);

  const betaNotice = (
    <div className="notice notice-beta">
      <p style={{ marginBottom: 0 }}>
        <strong>This is a free beta tool.</strong>{' '}
        Estimates are based on your uploaded bill data and may include a load-shape estimate
        instead of your exact usage. We&apos;re actively validating this against real customer
        bills, and your data helps us do that.
      </p>
    </div>
  );

  if (comparisons.length === 0) {
    return (
      <main className="shell-main wide">
        <Progress current={4} />
        <h1>Rate comparison report</h1>
        {betaNotice}
        <div className="notice notice-bad">
          <p>
            <strong>None of your confirmed bills could be compared.</strong>
          </p>
          <ul style={{ marginBottom: 0 }}>
            {excludedList.map((e) => (
              <li key={e.filename}>
                {e.filename.replace(/^\d+-/, '')}: {e.reason}
              </li>
            ))}
          </ul>
        </div>
      </main>
    );
  }

  const totalD = comparisons.reduce((sum, c) => sum + c.billD.total, 0);
  const totalE = comparisons.reduce((sum, c) => sum + c.billE.total, 0);
  const overallCheaper: 'D' | 'E' | 'tie' = totalD < totalE ? 'D' : totalE < totalD ? 'E' : 'tie';
  const overallDelta = Math.abs(totalD - totalE);
  const monthsCount = comparisons.length;
  const monthsCheaperD = comparisons.filter((c) => c.cheaper === 'D').length;
  const monthsCheaperE = comparisons.filter((c) => c.cheaper === 'E').length;
  const seasonalSplit = monthsCheaperD > 0 && monthsCheaperE > 0;
  const scaledAnnualDelta = monthsCount !== 12 ? overallDelta * (12 / monthsCount) : null;

  const onFileOptions = new Set(comparisons.map((c) => c.onFileOption).filter((o): o is 'D' | 'E' => o !== null));
  const onFileConsistent = onFileOptions.size === 1 ? [...onFileOptions][0]! : null;

  const engineWarnings = [...new Set(comparisons.flatMap((c) => [...c.billD.warnings, ...c.billE.warnings]))];

  const first = comparisons[0]!;

  await ensureReportRecord(id, comparisons, {
    totalD,
    totalE,
    overallCheaper,
    annualDelta: scaledAnnualDelta ?? overallDelta,
    annualDeltaIsScaled: scaledAnnualDelta !== null,
    onFileOption: onFileConsistent,
  });
  const feedback = await readFeedback(id);
  const feedbackAction = submitFeedback.bind(null, id);

  return (
    <main className="shell-main wide">
      <Progress current={4} />
      <h1>Rate comparison report</h1>
      {betaNotice}

      {excludedList.length > 0 ? (
        <div className="notice notice-warn">
          <p>
            {excludedList.length} of your {confirmation.bills.length} confirmed bill
            {confirmation.bills.length === 1 ? '' : 's'} could not be compared:
          </p>
          <ul>
            {excludedList.map((e) => (
              <li key={e.filename}>
                {e.filename.replace(/^\d+-/, '')}: {e.reason}
              </li>
            ))}
          </ul>
          <p style={{ marginBottom: 0 }}>Everything below is based only on the remaining {monthsCount} bill(s).</p>
        </div>
      ) : null}

      <h2>The short version</h2>
      {seasonalSplit ? (
        <p>
          It depends on your usage pattern: Option D was cheaper in {monthsCheaperD} month{monthsCheaperD === 1 ? '' : 's'}
          {' '}and Option E was cheaper in {monthsCheaperE} month{monthsCheaperE === 1 ? '' : 's'} out of the{' '}
          {monthsCount} you uploaded.{' '}
          {overallCheaper === 'tie'
            ? 'Added up across all of them, the two options come out essentially even.'
            : `Added up across all of them, Option ${overallCheaper} comes out ahead overall by ${formatUsd(overallDelta)}.`}
        </p>
      ) : (
        <p>
          {overallCheaper === 'tie'
            ? 'Option D and Option E come out essentially even across your uploaded bills.'
            : `Option ${overallCheaper} was cheaper in every one of your ${monthsCount} uploaded bill${monthsCount === 1 ? '' : 's'}, by a combined ${formatUsd(overallDelta)}.`}
        </p>
      )}

      <div className="card" style={{ background: 'var(--surface-sunk)', borderStyle: 'dashed' }}>
        <div className="stack">
          <div className="ledger-row">
            <span className="ledger-label">Option D, across your {monthsCount} bill{monthsCount === 1 ? '' : 's'}</span>
            <span className="ledger-fill" aria-hidden="true" />
            <span className="ledger-value">{formatUsd(totalD)}</span>
          </div>
          <div className="ledger-row">
            <span className="ledger-label">Option E, across your {monthsCount} bill{monthsCount === 1 ? '' : 's'}</span>
            <span className="ledger-fill" aria-hidden="true" />
            <span className="ledger-value">{formatUsd(totalE)}</span>
          </div>
          <div className="ledger-row ledger-total">
            <span className="ledger-label">
              {scaledAnnualDelta !== null ? 'Scaled to a full year' : 'Real annual difference'}
            </span>
            <span className="ledger-fill" aria-hidden="true" />
            <span className="ledger-value">
              {formatUsd(scaledAnnualDelta ?? overallDelta)}
              {scaledAnnualDelta !== null ? '/yr*' : '/yr'}
            </span>
          </div>
        </div>
        {scaledAnnualDelta !== null ? (
          <p className="small muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            * Scaled up from {monthsCount} month{monthsCount === 1 ? '' : 's'} of confirmed bills, not a real annual
            figure. Upload all 12 bills for one.
          </p>
        ) : (
          <p className="small muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            A real annual figure, since you uploaded a full 12 months.
          </p>
        )}
      </div>

      {onFileConsistent !== null ? (
        <p>
          Your bills show you&apos;re currently on <strong>Option {onFileConsistent}</strong>.
        </p>
      ) : onFileOptions.size > 1 ? (
        <p>
          Your bills show different options across months ({[...onFileOptions].map((o) => `Option ${o}`).join(', ')}).
          See the &quot;On file&quot; column below for which applies to each.
        </p>
      ) : (
        <p>
          We couldn&apos;t automatically tell which option your bills are currently on from the printed rate
          schedule. See the &quot;On file&quot; column below for the raw text.
        </p>
      )}

      <h2>Month by month</h2>
      <div className="month-cards">
        {comparisons.map((c) => (
          <MonthCard key={c.filename} c={c} />
        ))}
      </div>
      <div className="month-table-wrap table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Option D</th>
              <th className="num">Option E</th>
              <th>Cheaper</th>
              <th className="num">Difference</th>
              <th>On file</th>
              <th className="num">Actually billed</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((c) => (
              <MonthRow key={c.filename} c={c} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        &quot;Actually billed&quot; is what your bill says you paid. It&apos;s here for context. Your actual
        option on file might be Option D, Option E, or something else the report doesn&apos;t compare directly.
      </p>

      <details style={{ marginTop: '1.5rem' }}>
        <summary>Full itemized breakdown, month by month</summary>
        {comparisons.map((c) => (
          <div key={c.filename} className="card" style={{ marginTop: '1rem' }}>
            <h3>{c.monthLabel}</h3>
            <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
                <div className="ledger-row ledger-total">
                  <span className="ledger-label">Option D</span>
                  <span className="ledger-fill" aria-hidden="true" />
                  <span className="ledger-value">{formatUsd(c.billD.total)}</span>
                </div>
                <LineLedger lines={c.billD.lines} />
              </div>
              <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
                <div className="ledger-row ledger-total">
                  <span className="ledger-label">Option E</span>
                  <span className="ledger-fill" aria-hidden="true" />
                  <span className="ledger-value">{formatUsd(c.billE.total)}</span>
                </div>
                <LineLedger lines={c.billE.lines} />
              </div>
            </div>
          </div>
        ))}
      </details>

      {engineWarnings.length > 0 ? (
        <details style={{ marginTop: '1rem' }}>
          <summary>Engine warnings ({engineWarnings.length})</summary>
          <ul className="small muted">
            {engineWarnings.map((w) => (
              <li key={w} style={{ marginBottom: '0.5rem' }}>
                {w}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <hr className="hr" />

      <p className="small muted">
        Rates: {first.billD.tariffId} and {first.billE.tariffId}, sheet revision{' '}
        {first.billD.tariffProvenance.sheetRevision} / {first.billE.tariffProvenance.sheetRevision}. Both records are
        still marked pending human verification against the source PDF (see{' '}
        <code>packages/tariff-library/PENDING.md</code>). Usage for these months is ESTIMATED, not measured, unless
        noted otherwise. See the usage page for exactly how each month was built.
      </p>

      <div className="card" style={{ marginTop: '2rem' }}>
        {feedback ? (
          <p style={{ marginBottom: 0 }}>
            <strong>Thanks, that&apos;s recorded.</strong> You said this{' '}
            {feedback.answer === 'yes' ? 'matches' : feedback.answer === 'no' ? "doesn't match" : 'might match'} what
            you&apos;re actually being charged.
          </p>
        ) : (
          <form action={feedbackAction}>
            <p style={{ fontWeight: 600, marginBottom: '0.75rem' }}>
              Does this match what you&apos;re actually being charged?
            </p>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
              <button type="submit" name="answer" value="yes" className="btn btn-secondary">
                Yes, close
              </button>
              <button type="submit" name="answer" value="no" className="btn btn-secondary">
                No, way off
              </button>
              <button type="submit" name="answer" value="not_sure" className="btn btn-secondary">
                Not sure
              </button>
            </div>
            <label htmlFor="feedback-note" className="field-hint" style={{ display: 'block', marginBottom: '0.4rem' }}>
              Anything else you want to tell us? Optional.
            </label>
            <textarea id="feedback-note" name="note" rows={3} className="feedback-note" />
          </form>
        )}
      </div>
    </main>
  );
}
