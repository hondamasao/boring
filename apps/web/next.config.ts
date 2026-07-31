import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Two directories up from apps/web is the monorepo root — set explicitly
// rather than left to Vercel's auto-detection, so the include globs below
// have an unambiguous base regardless of how that detection behaves.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const nextConfig: NextConfig = {
  // Bill PDFs can be multi-page scans; keep the server-action body limit
  // generous rather than surprising an uploader with a silent rejection.
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
  outputFileTracingRoot: REPO_ROOT,
  // lib/tariffs.ts reads these two JSON sources with a computed fs path,
  // which Next's automatic dependency tracing can't see statically. Without
  // this, a Vercel deploy could build and run locally-equivalent code that
  // 404s at runtime because the tariff/holiday JSON never shipped with the
  // function bundle.
  outputFileTracingIncludes: {
    '/upload/**': ['packages/tariff-library/tariffs/**/*.json', 'fixtures/holidays/*.json'],
  },
};

export default nextConfig;
