import { notFound, redirect } from 'next/navigation';
import type { BillLine } from '@boring/rating-engine';
import { isValidUploadId, readManifest } from '../../../../lib/storage';
import { readConfirmation } from '../../../../lib/extraction-storage';
import { compareBillToOptions, type ExcludedBill, type MonthlyComparison } from '../../../../lib/compare-options';

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function LineTable({ lines }: { lines: BillLine[] }) {
  return (
    <table style={{ borderCollapse: 'collapse', fontSize: '0.9em' }}>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id}>
            <td style={{ paddingRight: '1rem' }}>{l.description}</td>
            <td style={{ textAlign: 'right' }}>{formatUsd(l.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MonthRow({ c }: { c: MonthlyComparison }) {
  const onFileLabel = c.onFileOption
    ? `Option ${c.onFileOption}`
    : c.onFileRaw
      ? `${c.onFileRaw} (couldn't tell D/E)`
      : 'Unknown';

  return (
    <tr>
      <td style={{ paddingRight: '1rem' }}>{c.monthLabel}</td>
      <td style={{ textAlign: 'right', paddingRight: '1rem' }}>{formatUsd(c.billD.total)}</td>
      <td style={{ textAlign: 'right', paddingRight: '1rem' }}>{formatUsd(c.billE.total)}</td>
      <td style={{ paddingRight: '1rem' }}>{c.cheaper === 'tie' ? 'Tie' : `Option ${c.cheaper}`}</td>
      <td style={{ textAlign: 'right', paddingRight: '1rem' }}>{formatUsd(c.deltaAbs)}</td>
      <td style={{ paddingRight: '1rem' }}>{onFileLabel}</td>
      <td style={{ textAlign: 'right' }}>{c.actualBilled !== null ? formatUsd(c.actualBilled) : '—'}</td>
    </tr>
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

  const BETA_NOTICE = (
    <p
      style={{
        background: '#f5f5f5',
        border: '1px solid #ddd',
        borderRadius: 4,
        padding: '1rem',
        fontWeight: 'bold',
      }}
    >
      This is a free beta tool. Estimates are based on your uploaded bill data and may include a load-shape estimate
      rather than your exact usage. We&apos;re actively validating this against real customer bills — your data
      helps us do that.
    </p>
  );

  if (comparisons.length === 0) {
    return (
      <main>
        <h1>Rate comparison report</h1>
        {BETA_NOTICE}
        <p style={{ color: '#b00020', fontWeight: 'bold' }}>None of your confirmed bills could be compared.</p>
        <ul>
          {excludedList.map((e) => (
            <li key={e.filename}>
              {e.filename.replace(/^\d+-/, '')}: {e.reason}
            </li>
          ))}
        </ul>
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

  return (
    <main>
      <h1>Rate comparison report</h1>
      {BETA_NOTICE}

      {excludedList.length > 0 ? (
        <div style={{ background: '#fff3cd', padding: '0.75rem', borderRadius: 4, marginBottom: '1rem' }}>
          <p style={{ margin: 0 }}>
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
          <p style={{ margin: 0 }}>Everything below is based only on the remaining {monthsCount} bill(s).</p>
        </div>
      ) : null}

      <h2>The short version</h2>
      {seasonalSplit ? (
        <p>
          It depends on your usage pattern: Option D was cheaper in {monthsCheaperD} month{monthsCheaperD === 1 ? '' : 's'}
          {' '}and Option E was cheaper in {monthsCheaperE} month{monthsCheaperE === 1 ? '' : 's'} out of the {monthsCount}{' '}
          you uploaded.{' '}
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

      <p>
        Across your {monthsCount} confirmed bill{monthsCount === 1 ? '' : 's'}: Option D totals {formatUsd(totalD)},
        Option E totals {formatUsd(totalE)}.{' '}
        {scaledAnnualDelta !== null ? (
          <>
            If this pattern holds for a full year, that&apos;s roughly {formatUsd(scaledAnnualDelta)}/year — scaled up
            from {monthsCount} month{monthsCount === 1 ? '' : 's'}, not a real annual figure. Upload all 12 bills for
            one.
          </>
        ) : (
          <>That&apos;s a real annual figure, since you uploaded a full 12 months.</>
        )}
      </p>

      {onFileConsistent !== null ? (
        <p>
          Your bills show you&apos;re currently on <strong>Option {onFileConsistent}</strong>.
        </p>
      ) : onFileOptions.size > 1 ? (
        <p>
          Your bills show different options across months ({[...onFileOptions].map((o) => `Option ${o}`).join(', ')})
          — see the &quot;On file&quot; column below for which applies to each.
        </p>
      ) : (
        <p>
          We couldn&apos;t automatically tell which option your bills are currently on from the printed rate schedule
          — see the &quot;On file&quot; column below for the raw text.
        </p>
      )}

      <h2>Month by month</h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#666' }}>
              <th style={{ paddingRight: '1rem' }}>Month</th>
              <th style={{ textAlign: 'right', paddingRight: '1rem' }}>Option D</th>
              <th style={{ textAlign: 'right', paddingRight: '1rem' }}>Option E</th>
              <th style={{ paddingRight: '1rem' }}>Cheaper</th>
              <th style={{ textAlign: 'right', paddingRight: '1rem' }}>Difference</th>
              <th style={{ paddingRight: '1rem' }}>On file</th>
              <th style={{ textAlign: 'right' }}>Actually billed</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((c) => (
              <MonthRow key={c.filename} c={c} />
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: '#666', fontSize: '0.9em' }}>
        &quot;Actually billed&quot; is what your bill says you paid — it&apos;s shown for context, not compared
        directly, since it reflects whatever option you were actually on, not necessarily Option D or E.
      </p>

      <details style={{ marginTop: '1rem' }}>
        <summary>Full itemized breakdown, month by month</summary>
        {comparisons.map((c) => (
          <div key={c.filename} style={{ margin: '1rem 0' }}>
            <h3>{c.monthLabel}</h3>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <div>
                <strong>Option D — {formatUsd(c.billD.total)}</strong>
                <LineTable lines={c.billD.lines} />
              </div>
              <div>
                <strong>Option E — {formatUsd(c.billE.total)}</strong>
                <LineTable lines={c.billE.lines} />
              </div>
            </div>
          </div>
        ))}
      </details>

      {engineWarnings.length > 0 ? (
        <details style={{ marginTop: '1rem' }}>
          <summary>Engine warnings ({engineWarnings.length})</summary>
          <ul>
            {engineWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <p style={{ color: '#666', marginTop: '1.5rem', fontSize: '0.9em' }}>
        Rates: {first.billD.tariffId} and {first.billE.tariffId}, sheet revision {first.billD.tariffProvenance.sheetRevision}
        {' '}/ {first.billE.tariffProvenance.sheetRevision}. Both records are still marked pending human verification
        against the source PDF (see <code>packages/tariff-library/PENDING.md</code>). Usage for these months is
        ESTIMATED, not measured, unless noted otherwise — see the usage page for exactly how each month was built.
      </p>
    </main>
  );
}
