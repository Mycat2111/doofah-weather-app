import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Google's BigQuery client is loaded by Node as it is, not bundled (only /api/weathernext uses it).
  serverExternalPackages: ["@google-cloud/bigquery"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // The service worker must never be served from a cache, or updates would not reach users.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; connect-src 'self' https://*.tile.openstreetmap.org https://tile.openstreetmap.org; script-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
