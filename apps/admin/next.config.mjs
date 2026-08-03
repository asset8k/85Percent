/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverComponentsExternalPackages: ['@xenova/transformers', 'onnxruntime-node', 'sharp'],
  },
}

export default nextConfig
