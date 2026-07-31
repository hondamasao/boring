import type { ReactNode } from 'react';

export const metadata = {
  title: 'Boring — SCE bill audit (beta)',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          maxWidth: '40rem',
          margin: '2rem auto',
          padding: '0 1rem',
          lineHeight: 1.5,
        }}
      >
        {children}
      </body>
    </html>
  );
}
