import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>SCE commercial bill audit — free beta</h1>
      <p>
        Upload 12 months of Southern California Edison bills. We&apos;ll check the rate
        schedule you&apos;re on against the alternatives and tell you if a cheaper one
        exists.
      </p>
      <p>
        <Link href="/upload">Upload bills →</Link>
      </p>
    </main>
  );
}
