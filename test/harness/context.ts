import type { ResolvedConfig, Settings } from '../../src/core/config.js';
import type { Context } from '../../src/core/context.js';
import { fakeFetch, type FakeFetch, type Route } from './fake-fetch.js';

export const TEST_VERSION = '0.0.0-test';

/** A config as if loaded from disk, with every value attributed to the global file. */
export function testConfig(areas: Record<string, Settings> = {}): ResolvedConfig {
  const sources: ResolvedConfig['sources'] = {};
  for (const [area, settings] of Object.entries(areas)) for (const key of Object.keys(settings)) sources[`${area}.${key}`] = 'global';
  return { areas, sources, files: { global: '/home/test/.toil/config.json' } };
}

/** A Context wired to a fake fetch. Returns the fake so tests can read `calls`. */
export function testContext(options: { config?: Record<string, Settings>; routes?: Route[]; dryRun?: boolean; verbose?: boolean } = {}): { context: Context; http: FakeFetch } {
  const http = fakeFetch(options.routes);
  const context: Context = {
    config: testConfig(options.config),
    fetch: http.fetch,
    env: {},
    version: TEST_VERSION,
    dryRun: options.dryRun ?? false,
    verbose: options.verbose ?? false,
    debug: () => {},
  };
  return { context, http };
}
