import { defineFixture } from '../harness/fixtures.js';
import { demoCommands, demoRoutes } from './demo-commands.js';

/** The test-only demo area, so the parity suite exercises HTTP and writes before any real area exists. */
export const fixture = defineFixture({
  area: 'demo',
  commands: demoCommands,
  routes: demoRoutes,
  config: { demo: { token: 'test-token', writes: true } },
});
