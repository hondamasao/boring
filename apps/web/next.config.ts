import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Bill PDFs can be multi-page scans; keep the server-action body limit
  // generous rather than surprising an uploader with a silent rejection.
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
