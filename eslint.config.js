import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/cdk.out/**',
      '**/dist/**',
      '**/coverage/**',
      'refs/**',
      'tools/diagram/**',
      '**/*.js',
      '**/*.mjs',
    ],
  },
  ...tseslint.configs.recommended,
);
