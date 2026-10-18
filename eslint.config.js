import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { SPAWNERS } from './scripts/spawners.mjs';

export default tseslint.config(
  { ignores: ['dist/', 'site/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Spawning is allowed only for the reviewed modules in scripts/spawners.mjs (CLAUDE.md, No Executables).
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
    // Commands reach the network only through ctx.fetch, which core instruments
    // for --verbose. A bare fetch would leave the request out of the log.
    // And they read settings only from ctx.connection: importing config would
    // let one area read another's credentials.
    files: ['src/areas/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'child_process', message: 'No spawning: toil runs no executables (CLAUDE.md, No Executables).' },
          { name: 'node:child_process', message: 'No spawning: toil runs no executables (CLAUDE.md, No Executables).' },
        ],
        patterns: [
          { group: ['**/core/config', '**/core/config.js'], message: 'Areas read settings from ctx.connection, never from config.' },
          {
            group: ['**/core/keychain', '**/core/keychain.js', '**/core/prompt', '**/core/prompt.js'],
            message: 'Areas get secrets already resolved on ctx.connection, never from the credential store.',
          },
        ],
      }],
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Use ctx.fetch: core records it for --verbose.' }],
      'no-restricted-properties': ['error',
        { object: 'globalThis', property: 'fetch', message: 'Use ctx.fetch: core records it for --verbose.' },
        // Env carries every connection's token and every CI token on the runner.
        { object: 'process', property: 'env', message: 'Areas read settings from ctx.connection, never from env.' },
      ],
    },
  },
  {
    // The reviewed modules allowed to spawn (scripts/spawners.mjs; CLAUDE.md, No Executables).
    files: SPAWNERS,
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Repo tooling and tests may run git (CLAUDE.md, Principles); none of it ships.
    files: ['scripts/**/*.mjs', 'test/**/*.ts', 'src/core/**/*.test.ts', '*.config.ts', '*.config.js'],
    rules: { 'no-restricted-imports': 'off' },
    languageOptions: { globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly' } },
  },
);
