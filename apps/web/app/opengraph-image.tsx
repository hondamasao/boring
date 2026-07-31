import { ImageResponse } from 'next/og';

export const alt = 'Boring — SCE commercial electricity rate comparison, free beta';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Generated at build/request time rather than a static asset, so it never
// drifts from the site's own copy. Uses the system sans-serif rather than
// the site's actual fonts (Source Serif 4 / Public Sans) — @vercel/og needs
// font files fetched as raw bytes to render anything but the default, which
// is more setup than an og:image warrants right now. Worth revisiting if
// the brand mismatch bothers anyone looking at a shared link.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          backgroundColor: '#0e5c64',
          color: '#f3f6f6',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 28,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: '#bfe0da',
          }}
        >
          SCE Bill Audit · Free Beta
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 980 }}>
          <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, lineHeight: 1.15 }}>
            Are you on the cheapest SCE rate for your business?
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#bfe0da' }}>boring</div>
      </div>
    ),
    { ...size },
  );
}
