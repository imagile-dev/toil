import type { ResolvedConfig, Settings } from '../../src/core/config.js';
import type { Context } from '../../src/core/context.js';
import type { GitRunner } from '../../src/core/git.js';
import type { GitContext } from '../../src/core/git-repo.js';
import type { SecretStore } from '../../src/core/keychain.js';
import type { Prompter } from '../../src/core/prompt.js';
import { fakeFetch, type FakeFetch, type Route } from './fake-fetch.js';
import { memoryFiles } from './files.js';

export const TEST_VERSION = '0.0.0-test';

/**
 * A config as if set by TOIL_<AREA>_* env vars: one connection per area, named
 * after it and set as its default. Values are attributed to env because that's
 * where a plaintext credential may live (a config file holds only `keychain:`
 * references), and it's how CI provides them.
 */
export function testConfig(areas: Record<string, Settings> = {}): ResolvedConfig {
  const config: ResolvedConfig = { connections: {}, defaults: {}, sources: {}, files: { global: '/home/test/.toil/config.json' }, warnings: [] };
  for (const [area, settings] of Object.entries(areas)) {
    config.connections[area] = { ...settings, area };
    config.defaults[area] = { connection: area };
    for (const key of Object.keys(settings)) config.sources[`${area}.${key}`] = 'env';
  }
  return config;
}

export interface TestContextOptions {
  config?: Record<string, Settings>;
  routes?: Route[];
  verbose?: boolean;
  files?: Record<string, string | Uint8Array>;
  /** What `-` reads; `{ terminal: true }` for an interactive terminal, where it refuses. */
  stdin?: string | { terminal: true };
  /** The credential store `keychain:` references resolve against; `fakeStore()` in tests. Absent, a reference resolves to unset. */
  secrets?: SecretStore;
  /** The repository `ctx.repo()` reports; absent, as outside one. */
  repo?: GitContext;
  /** The git `ctx.git` runs; absent, as when none is installed for the test. */
  git?: GitRunner;
  /** A scripted terminal, for the CLI-only commands that ask a person (`scriptedPrompter()`). Absent, as under MCP or in CI. */
  prompt?: Prompter;
}

/**
 * A Context wired to a fake fetch and in-memory files, plus a credential store
 * and a prompter when the test gives them. Returns the fakes so tests can read
 * `calls` and `files.written`.
 */
export function testContext(options: TestContextOptions = {}): { context: Context; http: FakeFetch; files: ReturnType<typeof memoryFiles> } {
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
    ...(options.secrets ? { secrets: options.secrets } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    ...(options.repo ? { repo: () => options.repo } : {}),
    ...(options.git ? { git: options.git } : {}),
  };
  return { context, http, files };
}

/** What a scripted prompter was asked, in order, and whether the answer was read hidden. */
export interface Asked {
  question: string;
  hidden: boolean;
}

/**
 * A terminal that answers from a script: each question gets the answer whose
 * key it starts with (`{ 'Base URL': 'https://jira.imagile.dev' }`), and an
 * unscripted question gets the fallback, or ''. `asked` records every
 * question, so a test can check that a secret was read hidden.
 */
export function scriptedPrompter(answers: Record<string, string> = {}): { prompt: Prompter; asked: Asked[] } {
  const asked: Asked[] = [];
  const answer = (question: string, hidden: boolean) => {
    asked.push({ question, hidden });
    const key = Object.keys(answers).find((k) => question.startsWith(k));
    return key === undefined ? undefined : answers[key];
  };
  return {
    asked,
    prompt: {
      ask: async (question, fallback) => answer(question, false) || fallback || '',
      askSecret: async (question) => answer(question, true) ?? '',
    },
  };
}
