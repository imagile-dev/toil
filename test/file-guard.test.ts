import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createNodeContext } from '../src/node-context.js';
import { areas, commands } from '../src/registry.js';
import { runCli } from './harness/cli.js';
import { fakeFetch } from './harness/fake-fetch.js';
import { fakeStore } from './harness/fake-store.js';
import { connectMcp } from './harness/mcp.js';

/**
 * The credential leak this guards against, end to end through both front
 * doors with the real node context: a read-only command handed the path of
 * toil's own config (by an agent, or by a prompt hidden in an issue) must
 * refuse before any request, so no other connection's token leaves the
 * machine. The only safe copy of the keys is the one never photocopied.
 */
const root = mkdtempSync(join(tmpdir(), 'toil-leak-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const home = join(root, 'home');
const cwd = join(root, 'work');
mkdirSync(join(home, '.toil'), { recursive: true });
mkdirSync(cwd, { recursive: true });
const configPath = join(home, '.toil', 'config.json');
// A config file holds keychain: references, never a secret (a plaintext one is CONFIG_INVALID).
// The secrets sit in a fake store, so a leak of what they resolve to would still show.
writeFileSync(configPath, JSON.stringify({ jira: { baseUrl: 'https://jira.imagile.dev', apiToken: 'keychain:jira.apiToken' }, github: { token: 'keychain:github.token' } }));
const custom = join(root, 'custom-config.json');
writeFileSync(custom, JSON.stringify({ jira: { baseUrl: 'https://jira.imagile.dev', apiToken: 'keychain:custom.apiToken' } }));
const secrets = fakeStore({ entries: { 'jira.apiToken': 'jira-token', 'github.token': 'OTHER-CONNECTION-SECRET', 'custom.apiToken': 'CUSTOM-SECRET' } });

function context(stdin: boolean, configFlag?: string) {
  const http = fakeFetch([{ method: 'POST', url: /search/, respond: { json: { issues: [], total: 0 } } }]);
  const ctx = createNodeContext({
    globals: configFlag ? { config: configFlag } : {},
    signal: new AbortController().signal,
    env: {},
    cwd,
    home,
    areas: areas.map((a) => ({ name: a.name, fallbacks: a.fallbacks })),
    version: '0.0.0-test',
    stderr: () => {},
    stdin,
    secrets,
  });
  return { http, context: { ...ctx, fetch: http.fetch } };
}

describe("toil's own config is not an input file", () => {
  it('jira_issue_search { jqlFile: <config path> } over MCP refuses, sends no request, and echoes no secret', async () => {
    const { http, context: ctx } = context(false);
    const session = await connectMcp({ commands, context: ctx, areas: ['jira'] });
    const result = await session.call('jira_issue_search', { jqlFile: configPath });
    await session.close();
    expect(result.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining("toil's own configuration") });
    expect(result.text).not.toMatch(/SECRET|jira-token|keychain:/);
    expect(http.calls).toHaveLength(0);
  });

  it('jira issue search --jql-file on the CLI refuses the --config file, and a .. path to the default one', async () => {
    const viaConfig = context(true, custom);
    const run1 = await runCli(['--config', custom, 'jira', 'issue', 'search', '--jql-file', custom], { commands, context: viaConfig.context });
    expect(run1.envelope?.error?.code).toBe('INVALID_INPUT');
    expect(run1.stdout).not.toMatch(/CUSTOM-SECRET|keychain:/);
    expect(viaConfig.http.calls).toHaveLength(0);

    const plain = context(true);
    const run2 = await runCli(['jira', 'issue', 'search', '--jql-file', join('..', 'home', '.toil', 'config.json')], { commands, context: plain.context });
    expect(run2.envelope?.error?.code).toBe('INVALID_INPUT');
    expect(plain.http.calls).toHaveLength(0);
  });

  it('a file outside toil config still works', async () => {
    writeFileSync(join(cwd, 'q.jql'), 'project = PROJ\n');
    const { http, context: ctx } = context(true);
    const run = await runCli(['jira', 'issue', 'search', '--jql-file', 'q.jql', '--max-results', '1'], { commands, context: ctx });
    expect(run.envelope?.ok).toBe(true);
    expect(JSON.parse(http.calls[0]!.body!).jql).toBe('project = PROJ');
  });
});
