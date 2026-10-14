/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The design system ships as a workspace package. Transpiling it here is
  // what makes its 'use client' directives survive the package boundary, and
  // what stops a stale `dist` from being served silently — the same class of
  // trap the vitest source alias exists to prevent.
  transpilePackages: ['@knowzy/shared-ui'],
  // One image per deployable, no server bundled at runtime beyond Next's own
  // (architecture.md §12.1).
  output: 'standalone',
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // AI Document Studio M3: an upload of up to 8 MB arrives through a server
  // action, whose default body limit is 1 MB. The API checks the file itself.
  experimental: { serverActions: { bodySizeLimit: '9mb' } },
};

export default nextConfig;
