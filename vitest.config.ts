import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __TOIL_VERSION__: JSON.stringify('0.0.0-test') },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // test/live/ touches the real OS credential store; only `npm run
    // test:keychain-live` (vitest.live.config.ts) runs it.
    exclude: ['test/live/**', '**/node_modules/**'],
    // Builds src/areas.generated.ts before any test imports the registry.
    globalSetup: ['scripts/gen-areas.mjs'],
    environment: 'node',
    // A test that reaches the real network is a bug; fakeFetch makes that loud.
    unstubGlobals: true,
  },
});
