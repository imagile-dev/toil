import { defineFixture } from '../harness/fixtures.js';
import { demoContextCommands, demoContextRoutes } from './demo-context-commands.js';

/**
 * The test-only area for context inputs, shared settings and aliases. Its
 * token comes from the `demo` connection, so both are configured; its
 * `env` setting is what `--env staging` selects it by.
 */
export const fixture = defineFixture({
  area: 'demo-context',
  commands: demoContextCommands,
  routes: demoContextRoutes,
  config: { 'demo-context': { project: 'PRJ', env: 'staging' }, demo: { token: 'shared-token' } },
});
