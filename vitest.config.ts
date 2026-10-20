import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { setupFiles: ["./vitest.setup.ts", "./src/test/setup.ts"], environment: "node", testTimeout: 20000, fileParallelism: false, include: ["src/**/*.test.ts", "scripts/**/*.test.ts"] },
});
