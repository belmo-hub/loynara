import { defineConfig, devices } from "@playwright/test";

// Desktop runs every spec as before. The phone projects run only *.mobile.spec.ts files, which check layout, touch
// targets and theming on a real mobile engine (WebKit for iPhone, Chrome for Android).
const mobileSpecs = /.*\.mobile\.spec\.ts/;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "var/playwright-results",
  use: {
    baseURL: "http://localhost:3000",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    { name: "desktop-chrome", testIgnore: mobileSpecs, use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "mobile-iphone-14", testMatch: mobileSpecs, use: { ...devices["iPhone 14"] } },
    { name: "mobile-pixel-7", testMatch: mobileSpecs, use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
});
