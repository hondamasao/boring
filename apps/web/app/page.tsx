import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="shell-main">
      <p className="eyebrow">Southern California Edison · commercial accounts</p>
      <h1>Are you on the cheapest SCE rate for your business?</h1>
      <p style={{ fontSize: '1.1rem', color: 'var(--ink-soft)', maxWidth: '34rem' }}>
        Upload 12 months of bills. We&apos;ll check the rate schedule you&apos;re on against the
        alternative and tell you, plainly, whether a cheaper one exists — and by how much.
      </p>
      <p>
        <Link href="/upload" className="btn">
          Upload your bills →
        </Link>
      </p>
    </main>
  );
}
