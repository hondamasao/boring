import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="error-page">
      <span className="stamp stamp-bad">404</span>
      <h1>We can&apos;t find that page</h1>
      <p>The link might be mistyped, or the upload it points to doesn&apos;t exist.</p>
      <Link href="/upload" className="btn">
        Start a new upload →
      </Link>
    </main>
  );
}
