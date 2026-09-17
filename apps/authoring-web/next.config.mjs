/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // One image per deployable, no server bundled at runtime beyond Next's own
  // (architecture.md §12.1).
  output: 'standalone',
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
