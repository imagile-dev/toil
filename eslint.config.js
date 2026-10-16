import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'site/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Spawning is allowed only for the OS credential stores (CLAUDE.md, Secrets).
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'child_process', message: 'No spawning: toil runs no executables (CLAUDE.md, No Executables).' },
          { name: 'node:child_process', message: 'No spawning: toil runs no executables (CLAUDE.md, No Executables).' },
        ],
      }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'test/**/*.ts', '*.config.ts', '*.config.js'],
    rules: { 'no-restricted-imports': 'off' },
    languageOptions: { globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly' } },
  },
);
