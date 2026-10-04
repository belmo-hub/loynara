import type { NextConfig } from "next";

const deviceTestDistDir = process.env.LOOPLOCAL_NEXT_DIST_DIR;
if (deviceTestDistDir && deviceTestDistDir !== ".next-device-test") {
  throw new Error("Unsupported Next build directory");
}

const nextConfig: NextConfig = {
  ...(deviceTestDistDir ? { distDir: deviceTestDistDir } : {}),
  // In development Next logs full request paths by default, including bearer
  // card URLs and scan-code query strings. Keep application diagnostics in
  // respondError/worker logs, which never print request URLs or credentials.
  logging: { incomingRequests: false, browserToTerminal: false, serverFunctions: false, fetches: { fullUrl: false } },
  headers() {
    return [
      { source: "/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/card/:token", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/invite/:token", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/tap/:ref", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
