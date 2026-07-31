import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/site';

// Only the two pages with no private data: the marketing homepage and the
// empty upload form. Nothing under /upload/[id] belongs here — see
// robots.ts and each of those pages' own `robots: { index: false }`.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: SITE_URL, lastModified, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/upload`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
  ];
}
