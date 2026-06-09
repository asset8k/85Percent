/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared brand package ships TSX with a `'use client'` directive; Next must
  // transpile it from the workspace rather than treating it as a prebuilt dep.
  transpilePackages: ['@85percent/brand'],
  experimental: {
    // The mark/wordmark are the only icons we pull eagerly; tree-shake lucide.
    optimizePackageImports: ['lucide-react'],
  },
}

export default nextConfig
