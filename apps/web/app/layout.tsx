import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Analytics } from '@vercel/analytics/next';
import { IBM_Plex_Mono, Public_Sans, Source_Serif_4 } from 'next/font/google';
import { SITE_URL } from '../lib/site';
import './globals.css';

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-source-serif',
  display: 'swap',
});

const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-public-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

// The whole palette is light-only, but nothing said so explicitly. On a
// browser/OS in dark mode, the initial unstyled paint (before the external
// stylesheet arrives) defaults to a dark canvas, then the real light
// background paints over it once CSS loads — a visible flash on a real
// network round-trip, invisible locally where CSS is served instantly.
// This meta tag ships in the first HTML byte, ahead of any CSS fetch.
export const viewport: Viewport = {
  colorScheme: 'light',
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Boring | SCE Commercial Electricity Rate Comparison',
    template: '%s | Boring',
  },
  description:
    "A free beta tool that checks whether your SCE commercial account is on the cheapest available rate schedule.",
  openGraph: {
    siteName: 'Boring',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sourceSerif.variable} ${publicSans.variable} ${plexMono.variable}`}>
      <body>
        <header className="shell-header">
          <div className="shell-header-inner">
            <Link href="/" className="wordmark">
              <span className="wordmark-mark">boring</span>
              <span className="wordmark-sub">SCE bill audit</span>
            </Link>
            <span className="stamp stamp-accent">Free beta</span>
          </div>
        </header>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
