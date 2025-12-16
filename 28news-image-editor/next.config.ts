import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '28news-api.mated.dev',
        port: '',
        pathname: '/processed/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3000',
        pathname: '/processed/**',
      },
    ],
  },
  // Increase body size limit for file uploads
  serverExternalPackages: [],
};

export default nextConfig;
