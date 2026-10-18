import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Every network call in a test goes through a fake; a real one is a bug.
    unstubGlobals: true,
  },
});
