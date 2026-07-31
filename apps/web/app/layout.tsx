import type { ReactNode } from 'react';
import Link from 'next/link';
import { IBM_Plex_Mono, Public_Sans, Source_Serif_4 } from 'next/font/google';
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

export const metadata = {
  title: 'Boring — SCE bill audit (beta)',
  description: 'A free beta tool that checks whether your SCE commercial rate schedule is the cheapest one you qualify for.',
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
      </body>
    </html>
  );
}
