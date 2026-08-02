import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Page Not Found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="error-page">
      <span className="stamp stamp-bad">404</span>
      <h1>We can&apos;t find that page</h1>
      <p>The link might be mistyped, or the upload it points to doesn&apos;t exist.</p>
      <Button asChild>
        <Link href="/upload">Start a new upload →</Link>
      </Button>
    </main>
  );
}
