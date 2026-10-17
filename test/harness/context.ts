import type { ResolvedConfig, Settings } from '../../src/core/config.js';
import type { Context } from '../../src/core/context.js';
import { fakeFetch, type FakeFetch, type Route } from './fake-fetch.js';
import { memoryFiles } from './files.js';

export const TEST_VERSION = '0.0.0-test';

/**
 * A config as if loaded from a version 1 file: one connection per area, named
 * after it and set as its default, every value attributed to the global file.
 */
export function testConfig(areas: Record<string, Settings> = {}): ResolvedConfig {
  const config: ResolvedConfig = { connections: {}, defaults: {}, sources: {}, files: { global: '/home/test/.toil/config.json' }, warnings: [] };
  for (const [area, settings] of Object.entries(areas)) {
    config.connections[area] = { ...settings, area };
    config.defaults[area] = { connection: area };
    for (const key of Object.keys(settings)) config.sources[`${area}.${key}`] = 'global';
  }
  return config;
}

/** A Context wired to a fake fetch and in-memory files. Returns the fakes so tests can read `calls` and `files.written`. */
export function testContext(
  options: { config?: Record<string, Settings>; routes?: Route[]; verbose?: boolean; files?: Record<string, string | Uint8Array>; stdin?: string } = {},
): { context: Context; http: FakeFetch; files: ReturnType<typeof memoryFiles> } {
  const http = fakeFetch(options.routes);
  const files = memoryFiles(options.files, options.stdin === undefined ? {} : { stdin: options.stdin });
  const context: Context = {
    config: testConfig(options.config),
    fetch: http.fetch,
    files,
    env: {},
    version: TEST_VERSION,
    verbose: options.verbose ?? false,
    debug: () => {},
  };
  return { context, http, files };
}
