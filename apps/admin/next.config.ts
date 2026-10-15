import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  logging: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@stash/shared"],
  async headers() { return [{ source: "/:path*", headers: [
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
  ] }, { source: "/sw.js", headers: [
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; frame-ancestors 'none'" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ] },]; },
  async rewrites() { return [{ source: "/admin-api/:path*", destination: `${process.env.API_URL || "http://127.0.0.1:4000"}/admin-api/:path*` }]; },
};
export default config;
