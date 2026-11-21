import { defineConfig } from 'vitest/config';

// Root test run: `npx vitest run` finds tests in infra, backend/* and scripts.
export default defineConfig({
  test: {
    include: [
      'infra/test/**/*.test.ts',
      'infra/lib/**/*.test.ts',
      'backend/*/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/cdk.out/**', '**/dist/**'],
  },
});
