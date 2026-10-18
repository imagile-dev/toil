import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { SPAWNERS } from './scripts/spawners.mjs';

// Heavy modules a util command loads only when it runs (docs/util.md, Lazy
// loading): never a static import, so they cost nothing at startup. A dynamic
// import() is what the rule allows; a type-only import is erased and allowed.
// The regex catches the wrappers in src/areas/util/kit/ however the path is spelt.
const LAZY_ONLY = {
  regex: '^(js-yaml|@cfworker/json-schema)$|(^|/)(yaml|json-schema|bounded)(\\.js)?$',
  allowTypeImports: true,
  message: 'Load it with await import() inside run(), so it costs nothing at startup (docs/util.md, Lazy loading).',
};
const NO_SPAWN = [
  { name: 'child_process', message: 'No spawning: toil runs no executables (CLAUDE.md, No Executables).' },
  { name: 'node:child_process', message: 'No spawning: toil runs no executables (CLAUDE.md, No Executables).' },
];
const AREA_PATTERNS = [
  { group: ['**/core/config', '**/core/config.js'], message: 'Areas read settings from ctx.connection, never from config.' },
  {
    group: ['**/core/keychain', '**/core/keychain.js', '**/core/prompt', '**/core/prompt.js'],
    message: 'Areas get secrets already resolved on ctx.connection, never from the credential store.',
  },
];

export default tseslint.config(
  // site/ and ui/ are their own packages, each linted by its own config; the
  // feedback function's build output is compiled code, linted as its source.
  { ignores: ['dist/', 'site/', 'ui/', 'node_modules/', 'coverage/', 'functions/feedback/dist/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Spawning is allowed only for the reviewed modules in scripts/spawners.mjs (CLAUDE.md, No Executables).
      'no-restricted-imports': ['error', { paths: NO_SPAWN, patterns: [LAZY_ONLY] }],
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
      'no-restricted-imports': ['error', { paths: NO_SPAWN, patterns: [...AREA_PATTERNS, LAZY_ONLY] }],
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Use ctx.fetch: core records it for --verbose.' }],
      'no-restricted-properties': ['error',
        { object: 'globalThis', property: 'fetch', message: 'Use ctx.fetch: core records it for --verbose.' },
        // Env carries every connection's token and every CI token on the runner.
        { object: 'process', property: 'env', message: 'Areas read settings from ctx.connection, never from env.' },
      ],
    },
  },
  {
    // The lazy modules' own wrappers, and tests, which never ship, may import them statically.
    // bounded-task.ts is the worker's own entry, bundled into a string by scripts/gen-worker.mjs and never into the CLI.
    files: ['src/areas/util/kit/yaml.ts', 'src/areas/util/kit/json-schema.ts', 'src/areas/util/kit/bounded.ts', 'src/areas/util/kit/bounded-task.ts', 'src/areas/**/*.test.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: NO_SPAWN, patterns: AREA_PATTERNS }] },
  },
  {
    // oracledb runs in Thin mode, pure JavaScript. initOracleClient is the only
    // way into Thick mode, which loads the driver's native addon and Oracle's
    // client libraries (CLAUDE.md, No Executables), so no source may name it.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: "MemberExpression[property.name='initOracleClient']", message: 'oracledb runs in Thin mode only: Thick mode loads a native addon.' },
        { selector: "ImportSpecifier[imported.name='initOracleClient']", message: 'oracledb runs in Thin mode only: Thick mode loads a native addon.' },
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
    files: ['scripts/**/*.mjs', 'functions/feedback/scripts/**/*.mjs', 'test/**/*.ts', 'src/core/**/*.test.ts', '*.config.ts', '*.config.js'],
    rules: { 'no-restricted-imports': 'off' },
    languageOptions: { globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly', fetch: 'readonly', Buffer: 'readonly' } },
  },
);
