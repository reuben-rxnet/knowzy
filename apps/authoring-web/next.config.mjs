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
  // DEV SERVER ONLY (`next dev`; a production build ignores it). By default
  // the dev server keeps five inactive pages compiled for about a minute and
  // recompiles the rest on the next visit. With the Studio's three routes the
  // browser suite recompiled /publish, /review and /administration/providers
  // over and over -- 10 to 34 seconds each under load -- and a page load ran
  // past the 90-second test budget (2026-10-14). Keep compiled pages resident.
  onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 100 },
};

export default nextConfig;
