import { defineConfig } from 'vitest/config';

// The live suite only: a real OS credential store. Run by
// .github/workflows/keychain-live.yml, and by hand (`secrets` skill, Verifying).
export default defineConfig({
  define: { __TOIL_VERSION__: JSON.stringify('0.0.0-test') },
  test: {
    include: ['test/live/**/*.test.ts'],
    globalSetup: ['scripts/gen-areas.mjs'],
    environment: 'node',
    unstubGlobals: true,
  },
});
