import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/upload'],
      // Trailing slash matches only paths WITH something after it
      // (/upload/<id>, /upload/<id>/report, ...), so the bare /upload
      // form above stays allowed. Everything under it holds one
      // customer's private bill data behind an unguessable link.
      // /internal aggregates every customer's data and is password-gated
      // by middleware.ts — it belongs here too, not just relying on that.
      disallow: ['/upload/', '/internal'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
