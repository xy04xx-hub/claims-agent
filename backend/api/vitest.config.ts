import { defineConfig } from "vitest/config";
// Lets `npm test -w backend/api` run from this package. The root config only matches from the repo root.
export default defineConfig({
  test: {
    include: [
      "api-customer/**/*.test.ts",
      "api-adjuster/**/*.test.ts",
      "middleware/**/*.test.ts",
      "test/**/*.test.ts",
      "*.test.ts",
    ],
  },
});
