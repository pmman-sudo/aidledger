import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/local/:path*', destination: 'http://127.0.0.1:8787/api/:path*' }];
  },
};

export default nextConfig;
