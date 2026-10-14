import type { NextConfig } from "next";

const deviceTestDistDir = process.env.LOOPLOCAL_NEXT_DIST_DIR;
if (deviceTestDistDir && deviceTestDistDir !== ".next-device-test") {
  throw new Error("Unsupported Next build directory");
}

const isDevelopment = process.env.NODE_ENV === "development";
const walletDownloadPath = "api/wallet/apple/download";

// Next injects inline bootstrap scripts, and a nonce policy would force every page to render dynamically, so scripts and
// styles allow 'unsafe-inline'. Everything else is locked to this origin: the app loads no third-party script, font,
// image or API. blob:/data: cover the camera preview, QR codes and merchant logos stored with the programme.
// upgrade-insecure-requests is deliberately left out: local and device-test runs use plain http, and production already
// redirects http to https at the edge and sends HSTS.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDevelopment ? " ws: wss:" : ""}`,
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  ...(deviceTestDistDir ? { distDir: deviceTestDistDir } : {}),
  // In development Next logs full request paths by default, including bearer
  // card URLs and scan-code query strings. Keep application diagnostics in
  // respondError/worker logs, which never print request URLs or credentials.
  logging: { incomingRequests: false, browserToTerminal: false, serverFunctions: false, fetches: { fullUrl: false } },
  headers() {
    return [
      // The Apple wallet download route renders its own failure page with a stricter, nonce-based CSP. A config header
      // would replace it, so that one path is left out here and keeps the policy it sets itself.
      { source: `/((?!${walletDownloadPath}/).*)`, headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy }] },
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          // One year, this host and its subdomains. No preload: that listing cannot be undone quickly.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      { source: "/card/:token", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/invite/:token", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/tap/:ref", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
