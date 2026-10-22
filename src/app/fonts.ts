import localFont from "next/font/local";

// Self-hosted brand fonts (SIL OFL, licences next to the files). No request leaves the app origin.
export const manrope = localFont({
  src: "./fonts/manrope-latin.woff2",
  weight: "200 800",
  variable: "--font-manrope",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

