import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __TOIL_VERSION__: JSON.stringify('0.0.0-test') },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // A test that reaches the real network is a bug; fakeFetch makes that loud.
    unstubGlobals: true,
  },
});
