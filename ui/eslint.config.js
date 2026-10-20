import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // The package's own checks (check:package, smoke) are plain Node scripts.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', fetch: 'readonly', Buffer: 'readonly' },
    },
  },
);
