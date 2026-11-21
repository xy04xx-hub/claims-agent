import { defineConfig } from "vitest/config";

// Lets `npm test -w backend/domain` run from this package. The root config only matches from the repo root.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
