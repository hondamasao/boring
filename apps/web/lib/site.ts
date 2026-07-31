/**
 * The one place the site's public URL is defined. Used by metadataBase,
 * robots.ts, sitemap.ts, and Open Graph tags — anywhere an absolute URL is
 * required rather than a path relative to the current request.
 *
 * Set NEXT_PUBLIC_SITE_URL in the hosting platform once a real domain
 * exists. Until then this falls back to a placeholder, which means OG tags
 * and the sitemap will point at the wrong host — a deliberately loud
 * placeholder rather than a guessed real-looking one, so it's obvious if
 * the env var was never set.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://set-NEXT_PUBLIC_SITE_URL.example';
