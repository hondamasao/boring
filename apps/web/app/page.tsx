import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

// The root layout's title template ("%s | Boring") only applies to nested
// segments, not to the page co-located with the layout that defines it —
// so the homepage sets its own full, brand-first title explicitly rather
// than relying on that template silently not firing.
const TITLE = 'Boring | SCE Commercial Electricity Rate Comparison';
const OG_TITLE = 'SCE Commercial Electricity Rate Comparison';
const DESCRIPTION =
  "Upload 12 months of SCE bills and find out if a cheaper commercial rate schedule exists, itemized and explained. Free while we're in beta.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: { title: OG_TITLE, description: DESCRIPTION, url: '/' },
};

export default function HomePage() {
  return (
    <main className="shell-main">
      <p className="eyebrow">Southern California Edison · commercial accounts</p>
      <h1>Are you on the cheapest SCE rate for your business?</h1>
      <p className="hero-lede">
        Upload 12 months of bills. We&apos;ll check the rate schedule you&apos;re on against the
        alternative and tell you, plainly, whether a cheaper one exists, and by how much.
      </p>
      <p>
        <Button asChild size="lg">
          <Link href="/upload">Upload your bills →</Link>
        </Button>
      </p>

      <Card style={{ marginTop: '2.5rem' }}>
        <CardContent>
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
        </CardContent>
      </Card>

      <h2 className="section-label">Why free</h2>
      <p>
        This tool is free while we&apos;re validating it. The tariff rates come from Southern
        California Edison&apos;s actual TOU-GS-2 sheet, cross-checked several independent ways. They
        still haven&apos;t been reconciled against a real customer&apos;s bill, and that&apos;s the
        actual bar for calling any of this trustworthy. Your bills help us close that gap. Files are
        stored privately, never public, and used only to generate your report.
      </p>

      <h2 className="section-label">How it works</h2>
      <div className="steps">
        <div>
          <span className="step-num">01</span>
          <p className="step-title">Upload your bills</p>
          <p className="step-desc">One PDF per month. As many as you have, ideally all 12.</p>
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

      <h2 className="section-label">What&apos;s solid, what&apos;s still open</h2>
      <div className="trust-grid">
        <div className="trust-col">
          <h3>Already verified</h3>
          <ul className="trust-list">
            <li>The rates come straight from SCE&apos;s actual TOU-GS-2 tariff sheet, not a summary or a guess.</li>
            <li>
              We independently re-transcribed the whole document from scratch and diffed it against
              what&apos;s in the tool. Zero discrepancies.
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
              A person hasn&apos;t signed off on the tariff records against the PDF yet. The checks
              above raise our confidence, but they don&apos;t replace that.
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
          <Button asChild size="lg">
            <Link href="/upload">Upload your bills →</Link>
          </Button>
        </p>
      </div>
    </main>
  );
}
