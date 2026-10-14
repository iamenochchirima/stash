import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  logging: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@stash/shared"],
  async headers() {
    return [
      {
        source: "/oauth/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL || "http://127.0.0.1:4000"}/api/:path*`,
      },
    ];
  },
};
export default config;
