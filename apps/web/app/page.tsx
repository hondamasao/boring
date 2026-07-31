import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="shell-main">
      <p className="eyebrow">Southern California Edison · commercial accounts</p>
      <h1>Are you on the cheapest SCE rate for your business?</h1>
      <p className="hero-lede">
        Upload 12 months of bills. We&apos;ll check the rate schedule you&apos;re on against the
        alternative and tell you, plainly, whether a cheaper one exists — and by how much.
      </p>
      <p>
        <Link href="/upload" className="btn">
          Upload your bills →
        </Link>
      </p>

      <div className="card" style={{ marginTop: '2.5rem' }}>
        <div className="stack">
          <div className="ledger-row ledger-row-stamped">
            <span className="ledger-label">Tariff rates</span>
            <span className="ledger-fill" aria-hidden="true" />
            <span className="stamp stamp-warn">Pending human review</span>
          </div>
          <div className="ledger-row ledger-row-stamped">
            <span className="ledger-label">What your bill says</span>
            <span className="ledger-fill" aria-hidden="true" />
            <span className="stamp stamp-accent">Read by AI, confirmed by you</span>
          </div>
          <div className="ledger-row ledger-row-stamped">
            <span className="ledger-label">Your usage pattern</span>
            <span className="ledger-fill" aria-hidden="true" />
            <span className="stamp stamp-neutral">Estimated, unless noted</span>
          </div>
          <div className="ledger-row ledger-row-stamped">
            <span className="ledger-label">Every dollar figure</span>
            <span className="ledger-fill" aria-hidden="true" />
            <span className="stamp stamp-ok">Cited to a tariff record</span>
          </div>
        </div>
      </div>

      <p className="section-label">Why free</p>
      <p>
        This tool is free while we&apos;re validating it. The tariff rates it uses come from
        Southern California Edison&apos;s actual TOU-GS-2 sheet, cross-checked several independent
        ways — but they haven&apos;t been reconciled against a real customer bill yet, and that&apos;s
        the actual bar for calling any of this trustworthy. Your bills help us close that gap. Your
        files are stored privately, never public, and used only to generate your report.
      </p>

      <p className="section-label">How it works</p>
      <div className="steps">
        <div>
          <span className="step-num">01</span>
          <p className="step-title">Upload your bills</p>
          <p className="step-desc">One PDF per month, as many as you have — ideally all 12.</p>
        </div>
        <div>
          <span className="step-num">02</span>
          <p className="step-title">Confirm what we read</p>
          <p className="step-desc">
            An AI reads the numbers off each bill. You check every value before anything counts.
          </p>
        </div>
        <div>
          <span className="step-num">03</span>
          <p className="step-title">Get your report</p>
          <p className="step-desc">
            See whether Option D or Option E would cost less, itemized, month by month.
          </p>
        </div>
      </div>

      <p className="section-label">What&apos;s solid, what&apos;s still open</p>
      <div className="trust-grid">
        <div className="trust-col">
          <h3>Already verified</h3>
          <ul className="trust-list">
            <li>The rates come straight from SCE&apos;s actual TOU-GS-2 tariff sheet, not a summary or a guess.</li>
            <li>
              We independently re-transcribed the whole document from scratch and diffed it against
              what&apos;s in the tool — zero discrepancies.
            </li>
            <li>
              A permanent automated check re-reads the source PDF every time our tests run, so the
              numbers can&apos;t silently drift.
            </li>
          </ul>
        </div>
        <div className="trust-col">
          <h3>Still open</h3>
          <ul className="trust-list">
            <li>
              A person hasn&apos;t signed off on the tariff records against the PDF yet — the checks
              above raise our confidence, they don&apos;t replace that.
            </li>
            <li>
              We haven&apos;t reconciled these numbers against a real customer&apos;s real bill. That&apos;s
              exactly what this beta is for.
            </li>
            <li>
              A couple of genuinely ambiguous rules in the tariff sheet are flagged as open questions
              in your report, not silently resolved one way.
            </li>
          </ul>
        </div>
      </div>

      <div className="cta-repeat">
        <p>
          <Link href="/upload" className="btn">
            Upload your bills →
          </Link>
        </p>
      </div>
    </main>
  );
}
