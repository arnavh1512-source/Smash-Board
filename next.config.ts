import type { NextConfig } from "next";

/**
 * Headers every page carries.
 *
 * `frame-ancestors 'none'` (and `X-Frame-Options` for older browsers) stops
 * another site framing the organiser console and clickjacking a PIN or a
 * delete. The CSP deliberately stops short of a script policy: the layout ships
 * an inline theme script and JSON-LD, and a nonce-based policy would force
 * every page dynamic without closing any finding.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Vercel sends HSTS on its own domains; this keeps it on any other host too.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
