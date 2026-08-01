'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="error-page">
      <span className="stamp stamp-bad">Error</span>
      <h1>Something went wrong</h1>
      <p>That wasn&apos;t supposed to happen. Try again, and if it keeps failing, come back later.</p>
      <button type="button" onClick={() => reset()} className="btn">
        Try again
      </button>
    </main>
  );
}
