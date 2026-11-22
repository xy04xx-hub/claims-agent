import { defineConfig } from "vitest/config";

// Lets `npm test -w backend/processing` run from this package. The root config only matches from the repo root.
export default defineConfig({
  test: { include: ["decision/**/*.test.ts", "evidence-processor/**/*.test.ts", "worker/**/*.test.ts"] },
});
