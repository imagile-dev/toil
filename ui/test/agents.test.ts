// @vitest-environment node
import { mapOwi, registry } from '@imagile-dev/toil/api';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import * as zod from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { noAgent } from '../server/agent.ts';
import { finish, named, partial, writeCommands } from '../server/agents/answer.ts';
import { claudeEnv, claudeRuntime, claudeToolName, zodShape } from '../server/agents/claude.ts';
import { AgentError, findCli } from '../server/agents/cli.ts';
import { CODEX_FEATURES_OFF, codexOverrides, codexRuntime, prepareCodexHome, TOIL_CODEX_CONFIG, toilCodexHome, TOKEN_ENV, userCodexHome } from '../server/agents/codex.ts';
import { copilotRuntime } from '../server/agents/copilot.ts';
import { agentEnv } from '../server/agents/env.ts';
import { AgentHost, type AgentHostOptions } from '../server/agents/host.ts';
import { answerMcp, McpGrants } from '../server/agents/mcp.ts';
import { STARTERS, STYLE_RULE, systemPrompt } from '../server/agents/prompts.ts';
import { THEME_VOICES } from '../server/agents/voices.ts';
import { Latest, loadSdk, type Importer, type Runtime } from '../server/agents/runtime.ts';
import { agentSettingsFile, checkAgentSettings, loadAgentSettings } from '../server/agents/settings.ts';
import { cacheData, cacheTools, Ledger, LIVE_COMMANDS, liveTools, neverWrites, proposalTool, type AgentData, type ToolSpec } from '../server/agents/tools.ts';
import { Cache } from '../server/cache.ts';
import type { RequestContext } from '../server/context.ts';
import { SyncService } from '../server/sync.ts';
import { commandLine } from '../src/proposal.ts';
import type { Envelope, Execute } from '../src/toil.ts';
import { FIXTURE_NOW } from '../src/fixtures/execute.ts';
import { stubToil } from './toil-stub.ts';

/**
 * The agent adapters (#251), each against a stubbed SDK module: no test
 * starts a CLI or calls a model. The cache is the sample dossiers, synced
 * through the stubbed toil into a throwaway folder. Covered: the tools
 * reading the cache, the citation check, the tool list holding no write tool,
 * proposals coming back as cards and never run, the SDK missing, the CLI not
 * found, streaming, the settings file, and the Codex MCP endpoint.
 */

const ctx = (signal = new AbortController().signal): RequestContext => ({ viewer: { id: 'local', name: 'you', via: 'launch-token' }, signal });
const folder = mkdtempSync(join(tmpdir(), 'toil-ui-agents-'));
let cache: Cache;
let data: AgentData;

beforeAll(async () => {
  cache = await Cache.open(join(folder, 'data'), { retentionDays: 30, now: () => new Date(FIXTURE_NOW) });
  const toil = stubToil();
  await new SyncService({ cache, execute: toil.execute, mapOwi, now: () => new Date(FIXTURE_NOW) }).run(ctx());
  data = cacheData(cache, 'card-payments')!;
});
afterAll(() => {
  cache.close();
  rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
});

/** An execute() that records every call and answers each one ok with an empty list. */
function recordingExecute() {
  const calls: Array<{ command: string; input: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const execute: Execute = async (command, input = {}, options = {}) => {
    calls.push({ command, input, options: options as Record<string, unknown> });
    return { ok: true, data: { issues: [] }, error: null, meta: { command, durationMs: 0, version: '0', contractVersion: 1 } } as unknown as Envelope;
  };
  return { execute, calls };
}

const tool = (tools: ToolSpec[], name: string) => tools.find((t) => t.name === name)!;

describe('the cache tools', () => {
  it('owi_query lists the dossier\'s items from the cache, filtered, and the ledger records each id', async () => {
    const ledger = new Ledger();
    const tools = cacheTools('card-payments', data, ledger);
    const all = (await tool(tools, 'owi_query').run({})) as { total: number; items: Array<{ id: string }> };
    expect(all.total).toBe(data.items().length);
    expect(all.items.every((i) => i.id.startsWith('corp-jira:PAY-'))).toBe(true);
    for (const i of all.items) expect(ledger.ids.has(i.id)).toBe(true);
    // And every id those items name, such as a link's target, since the result holds it too.
    expect([...ledger.ids].every((id) => JSON.stringify(all).includes(JSON.stringify(id)))).toBe(true);

    const progress = (await tool(tools, 'owi_query').run({ statusCategory: 'IN_PROGRESS' })) as { items: Array<{ id: string; statusCategory: string }> };
    expect(progress.items.length).toBeGreaterThan(0);
    expect(progress.items.every((i) => i.statusCategory === 'IN_PROGRESS')).toBe(true);
    // No native payload: the records are OWI, bounded.
    expect(JSON.stringify(all)).not.toContain('"native"');
  });

  it('owi_query is bounded and says when there are more', async () => {
    const r = (await tool(cacheTools('card-payments', data, new Ledger()), 'owi_query').run({ limit: 1 })) as { returned: number; more?: string };
    expect(r.returned).toBe(1);
    expect(r.more).toMatch(/more match/);
  });

  it('owi_get returns the item with its linked changes; owi_history its transitions', async () => {
    const ledger = new Ledger();
    const tools = cacheTools('card-payments', data, ledger);
    const got = (await tool(tools, 'owi_get').run({ id: 'corp-jira:PAY-101' })) as { item: { id: string }; changes: Array<{ kind: string }> };
    expect(got.item.id).toBe('corp-jira:PAY-101');
    expect(got.changes.some((c) => c.kind === 'pull-request')).toBe(true);
    const history = (await tool(tools, 'owi_history').run({ id: 'corp-jira:PAY-106' })) as { transitions: Array<{ to: string }> };
    expect(history.transitions.length).toBeGreaterThan(0);
    // The items, what PAY-101 names (PAY-102, which it blocks), and its pull requests and builds; nothing the results don't hold.
    for (const id of ['corp-jira:PAY-101', 'corp-jira:PAY-102', 'corp-jira:PAY-106', ...got.changes.map((c) => (c as { id?: string }).id!)]) expect(ledger.ids.has(id), id).toBe(true);
    const results = JSON.stringify([got, history]);
    for (const id of ledger.ids) expect(results, id).toContain(JSON.stringify(id));
  });

  it('an id the cache lacks is an error the model reads, and vouches for nothing', async () => {
    const ledger = new Ledger();
    const r = (await tool(cacheTools('card-payments', data, ledger), 'owi_get').run({ id: 'corp-jira:PAY-999' })) as { error: string };
    expect(r.error).toMatch(/no item/);
    expect(ledger.ids.size).toBe(0);
  });

  it('cacheData is null for a dossier that never synced', () => {
    expect(cacheData(cache, 'never-synced')).toBeNull();
  });
});

describe('the tool list', () => {
  const host = (over: Partial<AgentHostOptions> = {}) =>
    new AgentHost({ dataDir: join(folder, 'host-list'), version: 't', data: () => data, registry: registry.commands, execute: recordingExecute().execute, mapIds: () => [], serveTools: () => ({ url: '', token: '', close() {} }), fallback: noAgent(), ...over });

  it('is the three cache tools and toil mcp\'s read tools, and none of them writes', () => {
    const names = host().tools('card-payments', data, new Ledger()).map((t) => t.name);
    const live = LIVE_COMMANDS.map((c) => registry.commands.find((r) => r.name === c)!);
    expect(names).toEqual(['owi_query', 'owi_get', 'owi_history', 'proposal_fields', ...live.map((c) => c.tool)]);
    for (const c of live) expect(neverWrites(c), c.name).toBe(true);
    const writers = new Set(registry.commands.filter((c) => !neverWrites(c)).map((c) => c.tool));
    expect(names.filter((n) => writers.has(n))).toEqual([]);
    expect(names.some((n) => /create|update|transition|delete|merge|comment|write/.test(n))).toBe(false);
  });

  it('leaves out a live command the registry says writes, even if it is on the list', () => {
    const lying = registry.commands.map((c) => (c.name === 'jira issue search' ? { ...c, writes: true } : c));
    const names = liveTools('card-payments', lying, recordingExecute().execute, () => [], new Ledger()).map((t) => t.name);
    expect(names).not.toContain('jira_issue_search');
  });

  it('hides the dossier, files and folders from a live tool, and fixes the dossier and readOnly on every call', async () => {
    const rec = recordingExecute();
    const ledger = new Ledger();
    const tools = liveTools('card-payments', registry.commands, rec.execute, () => ['corp-jira:PAY-101'], ledger);
    const search = tool(tools, 'jira_issue_search');
    expect(Object.keys(search.inputSchema.properties)).not.toEqual(expect.arrayContaining(['dossier']));
    for (const k of ['dossier', 'cwd', 'jqlFile', 'connection', 'select']) expect(search.inputSchema.properties).not.toHaveProperty(k);
    await search.run({ jql: 'project = PAY', dossier: 'someone-else', cwd: '/', jqlFile: '/etc/passwd' });
    expect(rec.calls).toEqual([{ command: 'jira issue search', input: { jql: 'project = PAY', dossier: 'card-payments' }, options: { readOnly: true, caller: 'toil-ui' } }]);
    expect([...ledger.ids]).toEqual(['corp-jira:PAY-101']);
  });
});

describe('the citation check', () => {
  const writes = writeCommands(registry.commands);
  const ledgerOf = (...ids: string[]) => {
    const l = new Ledger();
    for (const id of ids) l.add(id);
    return l;
  };
  const f = (ledger: Ledger) => ({ dossier: 'card-payments', prompt: 'q', by: 'Claude', ledger, writes });

  it('passes an answer whose every cited id came from a tool', () => {
    const a = finish('[[corp-jira:PAY-101]] blocks [[corp-jira:PAY-102]].', f(ledgerOf('corp-jira:PAY-101', 'corp-jira:PAY-102')));
    expect(a.citations).toEqual(['corp-jira:PAY-101', 'corp-jira:PAY-102']);
    expect(a.unverified).toEqual([]);
    expect(a.warnings).toEqual([]);
  });

  it('flags a cited id no tool returned', () => {
    const a = finish('[[corp-jira:PAY-101]] and [[corp-jira:PAY-999]] are late.', f(ledgerOf('corp-jira:PAY-101')));
    expect(a.unverified).toEqual(['corp-jira:PAY-999']);
    expect(a.warnings![0]).toMatch(/never returned: corp-jira:PAY-999/);
  });

  it('flags a bare OWI id and a bare tracker key the tools never returned, but not UTF-8', () => {
    const a = finish('See [[corp-jira:PAY-101]], corp-jira:PAY-404 and PAY-777, encoded in UTF-8.', f(ledgerOf('corp-jira:PAY-101')));
    expect(a.unverified).toEqual(['corp-jira:PAY-404', 'PAY-777']);
  });

  it('accepts a bare key the tools did return', () => {
    expect(finish('PAY-101 is fine, see [[corp-jira:PAY-101]].', f(ledgerOf('corp-jira:PAY-101'))).unverified).toEqual([]);
  });

  it('warns when an answer that read items cites none of them', () => {
    expect(finish('The sprint looks fine.', f(ledgerOf('corp-jira:PAY-101'))).warnings).toEqual([expect.stringMatching(/cites none/)]);
  });

  it('named() finds cited, bare and key mentions', () => {
    expect(named('[[a:B-1]] a:C-2 x:D-3 EF-4', new Set(['a']))).toEqual({ cited: ['a:B-1'], bare: ['a:C-2'], keys: ['EF-4'] });
  });

  it('holds back a half-written citation and a half-written proposal while streaming', () => {
    const p = partial('First [[corp-jira:PAY-101]].\n\nThen [[corp-jira:PA', { prompt: 'q', by: 'x' });
    expect(p.parts.map((x) => x.text)).toEqual(['First [[corp-jira:PAY-101]].', 'Then']);
    expect(partial('Text\n```proposal\n{"item":', { prompt: 'q', by: 'x' }).parts).toEqual([{ text: 'Text' }]);
  });
});

describe('proposals', () => {
  const writes = writeCommands(registry.commands);
  const ledger = new Ledger();
  ledger.add('corp-jira:PAY-107');
  const f = { dossier: 'card-payments', prompt: 'q', by: 'Claude', ledger, writes };
  const block = (o: unknown) => `\n\n\`\`\`proposal\n${JSON.stringify(o)}\n\`\`\`\n`;

  it('become cards with a safe command line, the dossier forced and allowWrite never taken from the model', () => {
    const a = finish(
      `Estimate [[corp-jira:PAY-107]].${block({ item: 'corp-jira:PAY-107', title: 'Estimate PAY-107', reason: 'No estimate on [[corp-jira:PAY-107]].', command: 'jira issue update', input: { key: 'PAY-107', field: ['Story Points=3'], dossier: 'elsewhere', allowWrite: true }, note: null })}`,
      f,
    );
    expect(a.parts.map((p) => p.text)).toEqual(['Estimate [[corp-jira:PAY-107]].']);
    expect(a.proposals).toHaveLength(1);
    const p = a.proposals[0]!;
    expect(p).toMatchObject({ from: 'agent', item: 'corp-jira:PAY-107', command: 'jira issue update', input: { dossier: 'card-payments', key: 'PAY-107', field: ['Story Points=3'] } });
    expect(p.input).not.toHaveProperty('allowWrite');
    expect(commandLine(p, 'posix').line).toBe("toil jira issue update 'PAY-107' --dossier 'card-payments' --field 'Story Points=3' --allow-write");
  });

  it("name a command toil doesn't have as having none, rather than inventing one", () => {
    const a = finish(block({ item: 'corp-jira:PAY-107', title: 'Delete it', reason: '', command: 'jira delete-everything', input: {} }), f);
    expect(a.proposals[0]).toMatchObject({ command: null, input: null });
    expect(a.proposals[0]!.note).toMatch(/no write command "jira delete-everything"/);
  });

  it("show no command line when the input doesn't fit the command's fields, and say why", () => {
    const a = finish(block({ item: 'corp-jira:PAY-107', title: 'Parent it', reason: '', command: 'jira issue update', input: { key: 'PAY-107', fields: { parent: 'PAY-100' } } }), f);
    expect(a.proposals[0]).toMatchObject({ command: null, input: null });
    expect(a.proposals[0]!.note).toMatch(/doesn't fit toil jira issue update, which has no --fields/);
    const missing = finish(block({ item: 'corp-jira:PAY-107', title: 'x', reason: '', command: 'jira issue update', input: { summary: 'y' } }), f);
    expect(missing.proposals[0]!.note).toMatch(/needs <key>/);
  });

  it('proposal_fields reads a write command\'s fields from the registry and runs nothing', async () => {
    const t = proposalTool(registry.commands);
    const r = (await t.run({ command: 'jira issue update' })) as { fields: Record<string, unknown>; required: string[] };
    expect(Object.keys(r.fields)).toEqual(expect.arrayContaining(['key', 'field', 'summary']));
    expect(r.fields).not.toHaveProperty('allowWrite');
    expect(r.required).toEqual(['key']);
    expect(((await t.run({ command: 'jira issue search' })) as { error: string }).error).toMatch(/no write command/);
  });

  it('flag a proposal for an item no tool returned, and drop one that is not JSON', () => {
    const a = finish(`${block({ item: 'corp-jira:PAY-1', title: 'Move it', reason: '', command: null, input: null })}\n\`\`\`proposal\nnot json\n\`\`\``, f);
    expect(a.unverified).toContain('corp-jira:PAY-1');
    expect(a.warnings!.some((w) => /wasn't JSON/.test(w))).toBe(true);
  });
});

// ---------------------------------------------------------------- stubbed SDKs

interface Script {
  /** Tool calls the "model" makes, in order. */
  calls: Array<{ name: string; input: Record<string, unknown> }>;
  /** The answer, streamed in these chunks. */
  chunks: string[];
}

/** The Claude Agent SDK, stubbed: it records the options, runs the scripted tool calls through the MCP server's handlers, and streams. */
function claudeStub(script: Script) {
  const seen: { options?: Record<string, unknown>; tools: string[]; results: unknown[] } = { tools: [], results: [] };
  const module = {
    tool: (name: string, description: string, shape: unknown, handler: (a: Record<string, unknown>) => Promise<unknown>) => ({ name, description, shape, handler }),
    createSdkMcpServer: (o: { name: string; tools: Array<{ name: string; handler: (a: Record<string, unknown>) => Promise<unknown> }> }) => ({ type: 'sdk', name: o.name, tools: o.tools }),
    query: ({ options }: { prompt: string; options: Record<string, unknown> }) => {
      seen.options = options;
      const server = (options.mcpServers as Record<string, { tools: Array<{ name: string; handler: (a: Record<string, unknown>) => Promise<unknown> }> }>).toil_ui!;
      seen.tools = server.tools.map((t) => t.name);
      return (async function* () {
        for (const c of script.calls) {
          const t = server.tools.find((x) => x.name === c.name);
          // A tool the server doesn't have is one the model can't call.
          seen.results.push(t ? await t.handler(c.input) : { refused: c.name });
        }
        yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start' } };
        for (const text of script.chunks) yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } };
        yield { type: 'result', subtype: 'success', result: script.chunks.join('') };
      })();
    },
  };
  return { module, seen };
}

function copilotStub(script: Script) {
  const seen: { client?: Record<string, unknown>; session?: Record<string, unknown>; stopped: boolean } = { stopped: false };
  class CopilotClient {
    constructor(o: Record<string, unknown>) {
      seen.client = o;
    }
    async start() {}
    async stop() {
      seen.stopped = true;
      return [];
    }
    async createSession(config: Record<string, unknown>) {
      seen.session = config;
      const handlers = new Map<string, Array<(e: { data: Record<string, unknown> }) => void>>();
      const emit = (name: string, data: Record<string, unknown>) => (handlers.get(name) ?? []).forEach((h) => h({ data }));
      return {
        on: (name: string, h: (e: { data: Record<string, unknown> }) => void) => (handlers.set(name, [...(handlers.get(name) ?? []), h]), () => {}),
        async sendAndWait() {
          const tools = config.tools as Array<{ name: string; handler: (a: Record<string, unknown>) => Promise<unknown> }>;
          for (const c of script.calls) await tools.find((t) => t.name === c.name)?.handler(c.input);
          emit('assistant.message_start', {});
          for (const deltaContent of script.chunks) {
            emit('assistant.message_delta', { deltaContent });
            await new Promise((r) => setTimeout(r, 0));
          }
          return { data: { content: script.chunks.join('') } };
        },
        abort: async () => {},
        disconnect: async () => {},
      };
    }
  }
  return {
    module: { CopilotClient, RuntimeConnection: { forStdio: (o: { path: string }) => ({ kind: 'stdio', ...o }) }, defineTool: (name: string, c: Record<string, unknown>) => ({ name, ...c }) },
    seen,
  };
}

/** The Codex SDK, stubbed: it calls the served MCP tools over the real loopback grant, through answerMcp, with the token from its env. */
function codexStub(script: Script, grants: McpGrants) {
  const seen: { options?: Record<string, unknown>; thread?: Record<string, unknown>; listed: string[]; input?: string } = { listed: [] };
  class Codex {
    constructor(o: Record<string, unknown>) {
      seen.options = o;
    }
    startThread(t: Record<string, unknown>) {
      seen.thread = t;
      return {
        runStreamed: async (input: string) => ((seen.input = input), {
          events: (async function* () {
            const env = seen.options!.env as Record<string, string>;
            const tools = grants.tools(`Bearer ${env[TOKEN_ENV]}`)!;
            const list = (await answerMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, tools, 't')) as { result: { tools: Array<{ name: string }> } };
            seen.listed = list.result.tools.map((x) => x.name);
            for (const [i, c] of script.calls.entries()) await answerMcp({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: { name: c.name, arguments: c.input } }, tools, 't');
            let text = '';
            for (const chunk of script.chunks) {
              text += chunk;
              yield { type: 'item.updated', item: { type: 'agent_message', text } };
            }
            yield { type: 'item.completed', item: { type: 'agent_message', text } };
            yield { type: 'turn.completed', usage: {} };
          })(),
        }),
      };
    }
  }
  return { module: { Codex }, seen };
}

const SCRIPT: Script = {
  calls: [
    { name: 'owi_get', input: { id: 'corp-jira:PAY-107' } },
    { name: 'jira_issue_update', input: { key: 'PAY-107', field: ['Story Points=3'] } },
    { name: 'jira_issue_search', input: { jql: 'project = PAY' } },
  ],
  chunks: [
    '[[corp-jira:PAY-107]] has no estimate',
    ', and [[corp-jira:PAY-999]] is invented.',
    '\n\n```proposal\n{"item":"corp-jira:PAY-107","title":"Estimate PAY-107","reason":"Unestimated.","command":"jira issue update","input":{"key":"PAY-107","field":["Story Points=3"]},"note":null}\n```',
  ],
};

const FAKE_CLI: Record<string, string> = { claude: '/usr/bin/claude', copilot: '/usr/bin/copilot', codex: '/usr/bin/codex' };

/** A Codex home of the user's own, signed in with a file, in the throwaway folder. */
function userCodex(): string {
  const home = mkdtempSync(join(folder, 'user-codex-'));
  writeFileSync(join(home, 'auth.json'), '{"auth_mode":"chatgpt"}\n');
  return home;
}

function hostFor(adapter: 'claude' | 'copilot' | 'codex', module: unknown, over: Partial<AgentHostOptions> = {}) {
  const dataDir = mkdtempSync(join(folder, `host-${adapter}-`));
  writeFileSync(agentSettingsFile(dataDir), JSON.stringify({ adapter, model: 'test-model', cliPath: null, endpoint: adapter === 'claude' ? 'bedrock' : null }));
  const rec = recordingExecute();
  const grants = new McpGrants(() => 'http://127.0.0.1:1/api/agent/mcp');
  const hostEnv: Record<string, string> = { PATH: '/usr/bin', HOME: '/home/you', TOIL_JIRA_TOKEN: 'toil-secret', GITHUB_TOKEN: 'gh-secret', SYSTEM_ACCESSTOKEN: 'ci-secret', ANTHROPIC_API_KEY: 'claude-own', OPENAI_API_KEY: 'codex-own', COPILOT_GITHUB_TOKEN: 'copilot-own', HTTPS_PROXY: 'http://proxy.imagile.dev:8080', CODEX_HOME: userCodex() };
  const importer: Importer = async (spec) => {
    if (spec === 'zod') return zod;
    if (spec.startsWith(`@${adapter === 'claude' ? 'anthropic-ai' : adapter === 'copilot' ? 'github' : 'openai'}/`)) return module;
    throw Object.assign(new Error(`Cannot find package '${spec}'`), { code: 'ERR_MODULE_NOT_FOUND' });
  };
  const host = new AgentHost({
    dataDir,
    version: 't',
    data: (d) => (d === 'card-payments' ? data : null),
    registry: registry.commands,
    execute: rec.execute,
    mapIds: () => [],
    serveTools: (tools) => grants.serve(tools),
    fallback: noAgent(),
    env: hostEnv,
    cwd: '/work',
    platform: 'linux',
    importer,
    installed: () => true,
    isFile: (p) => Object.values(FAKE_CLI).includes(p),
    now: () => FIXTURE_NOW,
    // Codex's home is the throwaway one above, never this machine's own.
    runtimes: [claudeRuntime('t'), copilotRuntime(), codexRuntime()],
    ...over,
  });
  return { host, rec, grants, dataDir, env: hostEnv };
}

async function streamed(host: AgentHost, prompt = 'hygiene') {
  const versions = [];
  for await (const a of host.stream(ctx(), 'card-payments', prompt)) versions.push(a);
  return versions;
}

/** What every adapter must do with the same script: stream, read the cache, refuse the write tool, flag the invented id, and propose (never run) the write. */
function expectTheRules(versions: Awaited<ReturnType<typeof streamed>>, rec: ReturnType<typeof recordingExecute>) {
  expect(versions.length).toBeGreaterThan(2);
  const last = versions.at(-1)!;
  // Streaming: the early versions grow, carry no proposals, and the last is the checked answer.
  expect(versions[0]!.parts[0]!.text).toBe('[[corp-jira:PAY-107]] has no estimate');
  expect(versions.slice(0, -1).every((v) => v.proposals.length === 0)).toBe(true);
  expect(last.prompt).toBe('Backlog hygiene');
  expect(last.unverified).toEqual(['corp-jira:PAY-999']);
  expect(last.proposals.map((p) => p.command)).toEqual(['jira issue update']);
  // Nothing wrote: the one toil call was the live read, read-only; the proposal's command never ran.
  expect(rec.calls.map((c) => c.command)).toEqual(['jira issue search']);
  expect(rec.calls.every((c) => c.options.readOnly === true)).toBe(true);
}

describe('the Claude adapter, on a stubbed SDK', () => {
  it('runs the CLI it found, with no built-in tools, only the read tools, and the chosen endpoint', async () => {
    const stub = claudeStub(SCRIPT);
    const { host, rec } = hostFor('claude', stub.module);
    const versions = await streamed(host);
    expectTheRules(versions, rec);
    const o = stub.seen.options!;
    expect(o.pathToClaudeCodeExecutable).toBe('/usr/bin/claude');
    expect(o.model).toBe('test-model');
    expect(o.tools).toEqual([]);
    expect(o.settingSources).toEqual([]);
    expect(o.strictMcpConfig).toBe(true);
    expect(o.permissionMode).toBe('dontAsk');
    expect(o.persistSession).toBe(false);
    expect(stub.seen.tools).not.toContain('jira_issue_update');
    expect(o.allowedTools).toEqual(stub.seen.tools.map(claudeToolName));
    expect((o.env as Record<string, string>).CLAUDE_CODE_USE_BEDROCK).toBe('1');
    expect(stub.seen.results[1]).toEqual({ refused: 'jira_issue_update' });
    expect(o).not.toHaveProperty('canUseTool');
    expect(versions.at(-1)!.by).toBe('Claude (test-model)');
  });

  it('treats a result marked is_error (a failed sign-in) as a failure, not an answer', async () => {
    const module = {
      ...claudeStub(SCRIPT).module,
      query: () =>
        (async function* () {
          yield { type: 'result', subtype: 'success', is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed' };
        })(),
    };
    const { host } = hostFor('claude', module);
    await expect(host.ask(ctx(), 'card-payments', 'q')).rejects.toThrow('Claude failed: Claude Code answered with an error: Failed to authenticate: OAuth session expired and could not be refreshed');
  });

  it('turns each endpoint into Claude Code\'s own switch, and the Anthropic API into none', () => {
    expect(claudeEnv({ CLAUDE_CODE_USE_VERTEX: '1' }, 'foundry', 'v')).toMatchObject({ CLAUDE_CODE_USE_FOUNDRY: '1', CLAUDE_AGENT_SDK_CLIENT_APP: 'toil-ui/v' });
    expect(claudeEnv({ CLAUDE_CODE_USE_VERTEX: '1' }, 'foundry', 'v')).not.toHaveProperty('CLAUDE_CODE_USE_VERTEX');
    const api = claudeEnv({}, 'anthropic', 'v');
    expect(Object.keys(api).filter((k) => k.startsWith('CLAUDE_CODE_USE_'))).toEqual([]);
  });

  it('builds zod shapes the SDK takes from the tools\' JSON Schemas', () => {
    const search = liveTools('d', registry.commands, recordingExecute().execute, () => [], new Ledger()).find((t) => t.name === 'jira_issue_search')!;
    const shape = zodShape(zod as never, search.inputSchema) as unknown as Record<string, zod.ZodType>;
    const object = zod.object(shape);
    expect(object.safeParse({ jql: 'project = PAY', limit: 5 }).success).toBe(true);
    expect(object.safeParse({ limit: 'five' }).success).toBe(true);
    expect(object.safeParse({ limit: true }).success).toBe(false);
    expect(object.safeParse({ jql: 5 }).success).toBe(false);
    const query = cacheTools('d', data, new Ledger())[0]!;
    expect(zod.object(zodShape(zod as never, query.inputSchema) as never).safeParse({ statusCategory: 'NOPE' }).success).toBe(false);
  });
});

describe('the Copilot adapter, on a stubbed SDK', () => {
  it('starts the CLI it found over stdio, with only the read tools available and every permission request rejected', async () => {
    const stub = copilotStub(SCRIPT);
    const { host, rec } = hostFor('copilot', stub.module);
    expectTheRules(await streamed(host), rec);
    expect(stub.seen.client!.connection).toMatchObject({ kind: 'stdio', path: '/usr/bin/copilot' });
    expect(stub.seen.client).not.toHaveProperty('env');
    const s = stub.seen.session!;
    const names = (s.tools as Array<{ name: string; skipPermission: boolean }>).map((t) => t.name);
    expect(names).not.toContain('jira_issue_update');
    expect(s.availableTools).toEqual(names.map((n) => `custom:${n}`));
    expect((s.systemMessage as { mode: string }).mode).toBe('replace');
    expect((s.onPermissionRequest as () => { kind: string })().kind).toBe('reject');
    expect(stub.seen.stopped).toBe(true);
  });
});

describe('the Codex adapter, on a stubbed SDK', () => {
  it('serves the read tools over MCP for the run only, with the token in its env, and switches the rest of Codex off', async () => {
    const holder = new McpGrants(() => 'http://127.0.0.1:1/api/agent/mcp');
    const stub = codexStub(SCRIPT, holder);
    const { host, rec } = hostFor('codex', stub.module, { serveTools: (tools) => holder.serve(tools) });
    expectTheRules(await streamed(host), rec);
    const o = stub.seen.options!;
    expect(o.codexPathOverride).toBe('/usr/bin/codex');
    expect(o.configOverrides).toEqual(codexOverrides('http://127.0.0.1:1/api/agent/mcp'));
    expect((o.configOverrides as string[])[0]).toBe('mcp_servers={ toil_ui = { url = "http://127.0.0.1:1/api/agent/mcp", bearer_token_env_var = "TOIL_UI_MCP_TOKEN" } }');
    expect(CODEX_FEATURES_OFF).toEqual(expect.arrayContaining(['shell_tool', 'unified_exec', 'apps', 'plugins']));
    expect(JSON.stringify(o.configOverrides)).not.toContain((o.env as Record<string, string>)[TOKEN_ENV]);
    expect(stub.seen.thread).toMatchObject({ sandboxMode: 'read-only', approvalPolicy: 'never', webSearchMode: 'disabled', model: 'test-model' });
    expect(stub.seen.listed).not.toContain('jira_issue_update');
    // The grant ended with the run.
    expect(holder.size).toBe(0);
  });
});

describe('the composed prompt, on every adapter (#283)', () => {
  const style = { theme: 'crate', voice: true };
  const saved = { instructions: 'Answer in British English.', voice: null };
  const expected = systemPrompt('card-payments', FIXTURE_NOW, { voice: THEME_VOICES.get('crate')!.voice!, instructions: 'Answer in British English.' });

  async function systemOf(adapter: 'claude' | 'copilot' | 'codex', withStyle: typeof style | null): Promise<string> {
    const holder = new McpGrants(() => 'http://127.0.0.1:1/api/agent/mcp');
    const stub = adapter === 'claude' ? claudeStub(SCRIPT) : adapter === 'copilot' ? copilotStub(SCRIPT) : codexStub(SCRIPT, holder);
    const { host, dataDir } = hostFor(adapter, stub.module, adapter === 'codex' ? { serveTools: (tools) => holder.serve(tools) } : {});
    host.save({ ...host.status().settings, ...saved });
    expect(JSON.parse(readFileSync(agentSettingsFile(dataDir), 'utf8'))).toMatchObject(saved);
    for await (const _ of host.stream(ctx(), 'card-payments', 'hygiene', withStyle)) void _;
    if (adapter === 'claude') return (stub as ReturnType<typeof claudeStub>).seen.options!.systemPrompt as string;
    if (adapter === 'copilot') return ((stub as ReturnType<typeof copilotStub>).seen.session!.systemMessage as { content: string }).content;
    // Codex takes no separate system prompt, so Toil UI's goes first in the turn.
    const input = (stub as ReturnType<typeof codexStub>).seen.input!;
    expect(input.endsWith(`\n\nQuestion:\n${STARTERS.find((q) => q.id === 'hygiene')!.prompt('card-payments')}`)).toBe(true);
    return input.slice(0, input.indexOf('\n\nQuestion:\n'));
  }

  it.each(['claude', 'copilot', 'codex'] as const)('%s is sent the rules, then Crate\'s voice, then the instructions', async (adapter) => {
    const sent = await systemOf(adapter, style);
    expect(sent).toBe(expected);
    expect(sent).toBe(host0().systemPrompt('card-payments', style));
    expect(sent).toContain(STYLE_RULE);
  });

  it.each(['claude', 'copilot', 'codex'] as const)('%s is sent the rules and the instructions alone with the voice off', async (adapter) => {
    expect(await systemOf(adapter, { theme: 'crate', voice: false })).toBe(systemPrompt('card-payments', FIXTURE_NOW, { voice: null, instructions: 'Answer in British English.' }));
  });

  /** A host with the same saved words, for the prompt Settings shows. */
  function host0() {
    const { host } = hostFor('claude', claudeStub(SCRIPT).module);
    host.save({ ...host.status().settings, ...saved });
    return host;
  }
});

describe('the MCP endpoint\'s protocol', () => {
  it('initializes, lists, calls, and refuses a tool it lacks', async () => {
    const tools = cacheTools('card-payments', data, new Ledger());
    const init = (await answerMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, tools, 'v')) as { result: { protocolVersion: string; capabilities: object } };
    expect(init.result.protocolVersion).toBe('2025-06-18');
    expect(await answerMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, tools, 'v')).toBeNull();
    const call = (await answerMcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'owi_get', arguments: { id: 'corp-jira:PAY-101' } } }, tools, 'v')) as { result: { content: Array<{ text: string }> } };
    expect(call.result.content[0]!.text).toContain('corp-jira:PAY-101');
    const refused = (await answerMcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'jira_issue_update', arguments: {} } }, tools, 'v')) as { error: { message: string } };
    expect(refused.error.message).toMatch(/only its read tools/);
  });

  it('knows a grant only by its exact bearer token, and forgets it on close', () => {
    const grants = new McpGrants(() => 'u');
    const served = grants.serve([]);
    expect(grants.tools(`Bearer ${served.token}`)).toEqual([]);
    expect(grants.tools(`Bearer ${served.token}x`)).toBeUndefined();
    expect(grants.tools(served.token)).toBeUndefined();
    served.close();
    expect(grants.tools(`Bearer ${served.token}`)).toBeUndefined();
  });
});

describe('when an adapter cannot run', () => {
  it('names the package when the SDK is not installed', async () => {
    const { host } = hostFor('claude', null, { importer: async (s) => Promise.reject(Object.assign(new Error(`Cannot find package '${s}'`), { code: 'ERR_MODULE_NOT_FOUND' })) });
    await expect(host.ask(ctx(), 'card-payments', 'hygiene')).rejects.toThrow(/needs @anthropic-ai\/claude-agent-sdk, which isn't installed/);
    await expect(loadSdk({ label: 'Codex', package: '@openai/codex-sdk' }, async () => Promise.reject(Object.assign(new Error('x'), { code: 'ERR_MODULE_NOT_FOUND' })))).rejects.toBeInstanceOf(AgentError);
  });

  it('says plainly when the CLI is not on PATH, and never downloads one', async () => {
    const { host } = hostFor('codex', codexStub(SCRIPT, new McpGrants(() => '')).module, { isFile: () => false });
    const e = await host.ask(ctx(), 'card-payments', 'hygiene').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AgentError);
    expect((e as AgentError).message).toBe('Toil UI found no codex on PATH, so it can\'t start the Codex CLI. It never downloads one.');
    expect((e as AgentError).fix).toMatch(/set its path in Settings/);
  });

  it('says so when the dossier never synced', async () => {
    const { host } = hostFor('claude', claudeStub(SCRIPT).module);
    await expect(host.ask(ctx(), 'never-synced', 'q')).rejects.toThrow(/hasn't synced never-synced/);
  });

  it('with no adapter chosen, names the three and offers no starters', async () => {
    const dataDir = mkdtempSync(join(folder, 'host-none-'));
    const host = new AgentHost({ dataDir, version: 't', data: () => data, registry: registry.commands, execute: recordingExecute().execute, mapIds: () => [], serveTools: () => ({ url: '', token: '', close() {} }), fallback: noAgent(), installed: () => false, isFile: () => false, env: {}, platform: 'linux' });
    expect(host.kind).toBe('none');
    expect(await host.starters(ctx(), 'card-payments')).toEqual([]);
    const e = (await host.ask(ctx(), 'card-payments', 'q').catch((x: unknown) => x)) as AgentError;
    for (const p of ['@anthropic-ai/claude-agent-sdk', '@github/copilot-sdk', '@openai/codex-sdk']) expect(e.message).toContain(p);
    const status = host.status();
    expect(status.adapters.map((a) => [a.name, a.installed, a.cli.path])).toEqual([
      ['claude', false, null],
      ['copilot', false, null],
      ['codex', false, null],
    ]);
  });

  it('offers the five starters, each scoped to the dossier, once an adapter is chosen', async () => {
    const { host } = hostFor('claude', claudeStub(SCRIPT).module);
    expect((await host.starters(ctx(), 'card-payments')).map((s) => s.label)).toEqual(['Stand-up digest', 'Why is this sprint at risk?', 'Backlog hygiene', 'Dependency risk', 'Release notes']);
    for (const s of STARTERS) expect(s.prompt('card-payments')).toContain('"card-payments"');
  });
});

describe('finding the CLI', () => {
  const look = (over: Partial<Parameters<typeof findCli>[0]>) => findCli({ label: 'Claude Code', command: 'claude', env: {}, platform: 'linux', isFile: () => false, cwd: '/work', path: posix, ...over });

  it('skips relative PATH entries and the working directory, as git does, but not a home inside it', () => {
    const planted = (p: string) => p.endsWith('/claude');
    expect(look({ env: { PATH: '.:bin:/work:/work/node_modules/.bin:/usr/bin' }, isFile: planted })).toBe('/usr/bin/claude');
    expect(() => look({ env: { PATH: '.:bin:/work/tools' }, isFile: planted })).toThrow(/found no claude on PATH/);
    // A home inside the working directory stays searchable, as git's rule has it; the working directory itself never is.
    expect(look({ cwd: '/home', home: '/home/you', env: { PATH: '/home:/home/you/.local/bin' }, isFile: planted })).toBe('/home/you/.local/bin/claude');
    const exe = win32.join('C:\\tools', 'claude.exe');
    expect(look({ platform: 'win32', path: win32, cwd: 'C:\\repo', env: { Path: '.;C:\\repo;C:\\REPO\\bin;C:\\tools' }, isFile: (p) => p.toLowerCase().endsWith('claude.exe') })).toBe(exe);
  });

  it('takes the configured path first, and refuses one that is missing or relative', () => {
    expect(look({ configured: '/opt/claude/bin/claude', isFile: (p) => p === '/opt/claude/bin/claude', env: { PATH: '/usr/bin' } })).toBe('/opt/claude/bin/claude');
    expect(() => look({ configured: '/opt/nope/claude' })).toThrow("Claude Code isn't at /opt/nope/claude, the path set in Settings.");
    expect(() => look({ configured: 'claude' })).toThrow(/isn't an absolute path/);
  });

  it('searches PATH in order on POSIX', () => {
    expect(look({ env: { PATH: '/a:/b' }, isFile: (p) => p === posix.join('/b', 'claude'), path: posix })).toBe('/b/claude');
  });

  it('prefers a .exe on Windows, and calls a .cmd shim a shim, with the fix', () => {
    const exe = win32.join('C:\\tools', 'claude.exe');
    expect(look({ platform: 'win32', env: { Path: 'C:\\shims;C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' }, isFile: (p) => p === exe || p === win32.join('C:\\shims', 'claude.cmd'), path: win32 })).toBe(exe);
    expect(() => look({ platform: 'win32', env: { Path: 'C:\\shims' }, isFile: (p) => p === win32.join('C:\\shims', 'claude.cmd'), path: win32 })).toThrow(/Windows command shim the SDK can't start/);
    expect(() => look({ platform: 'win32', env: { Path: 'C:\\shims' }, isFile: (p) => p === win32.join('C:\\shims', 'claude.cmd'), path: win32 })).toThrow(expect.objectContaining({ fix: 'Set the CLI path in Settings to the claude executable itself (claude.exe).' }));
  });
});

describe('the agent settings', () => {
  it('are saved in the data folder, never toil\'s, and hold no secret', () => {
    const { host, dataDir } = hostFor('claude', claudeStub(SCRIPT).module);
    host.save({ adapter: 'codex', model: 'gpt-5', cliPath: null, endpoint: null });
    expect(agentSettingsFile(dataDir)).toBe(join(dataDir, 'agent.json'));
    expect(JSON.parse(readFileSync(agentSettingsFile(dataDir), 'utf8'))).toEqual({ adapter: 'codex', model: 'gpt-5', cliPath: null, endpoint: null, instructions: null, voice: null });
    expect(loadAgentSettings(dataDir).adapter).toBe('codex');
    expect(host.kind).toBe('codex');
  });

  it('refuse a key, an endpoint for anything but Claude, a relative CLI path and an unknown adapter', () => {
    expect(() => checkAgentSettings({ adapter: 'claude', apiKey: 'sk-x' })).toThrow(/have no "apiKey"/);
    expect(() => checkAgentSettings({ adapter: 'codex', endpoint: 'bedrock' })).toThrow(/Only the Claude adapter takes an endpoint/);
    expect(() => checkAgentSettings({ adapter: 'claude', cliPath: 'bin/claude' }, posix.isAbsolute)).toThrow(/absolute path/);
    expect(() => checkAgentSettings({ adapter: 'gemini' })).toThrow(/no adapter "gemini"/);
    expect(checkAgentSettings({ adapter: 'claude', model: ' ', endpoint: '' })).toEqual({ adapter: 'claude', model: null, cliPath: null, endpoint: null, instructions: null, voice: null });
  });

  it("keep the person's instructions and custom voice as plain text, up to 4,000 characters each (#283)", () => {
    expect(checkAgentSettings({ adapter: 'none', instructions: '  Answer in British English.\r\nLead with risks.  ', voice: '' })).toMatchObject({ instructions: 'Answer in British English.\nLead with risks.', voice: null });
    expect(checkAgentSettings({ voice: 'x'.repeat(4000) }).voice).toHaveLength(4000);
    expect(() => checkAgentSettings({ instructions: 'x'.repeat(4001) })).toThrow(/at most 4000 characters, and is 4001/);
    expect(() => checkAgentSettings({ voice: 42 })).toThrow(/custom voice must be text/);
    expect(() => checkAgentSettings({ instructions: 'hidden\u0000text' })).toThrow(/control or invisible character/);
    expect(() => checkAgentSettings({ voice: 'quiet\u202Ereversed' })).toThrow(/invisible/);
    expect(() => checkAgentSettings({ voice: 'zero\u200Bwidth' })).toThrow(/invisible/);
    expect(checkAgentSettings({ instructions: 'tabs\tand\nlines, and é' }).instructions).toBe('tabs\tand\nlines, and é');
    // An agent.json from before #283 has neither, and loads with both empty.
    const dataDir = mkdtempSync(join(folder, 'old-'));
    writeFileSync(agentSettingsFile(dataDir), JSON.stringify({ adapter: 'codex', model: null, cliPath: null, endpoint: null }));
    expect(loadAgentSettings(dataDir)).toMatchObject({ adapter: 'codex', instructions: null, voice: null });
  });

  it('a broken file leaves the agent unset and says which file and why', () => {
    const dataDir = mkdtempSync(join(folder, 'broken-'));
    writeFileSync(agentSettingsFile(dataDir), '{ nope');
    const host = new AgentHost({ dataDir, version: 't', data: () => data, registry: registry.commands, execute: recordingExecute().execute, mapIds: () => [], serveTools: () => ({ url: '', token: '', close() {} }), fallback: noAgent() });
    expect(host.kind).toBe('none');
    expect(host.status().problem).toMatch(/agent\.json can't be used/);
  });
});

describe("the agent CLI's environment", () => {
  const leaked = (env: Record<string, unknown>) => ['TOIL_JIRA_TOKEN', 'GITHUB_TOKEN', 'SYSTEM_ACCESSTOKEN'].filter((k) => k in env);

  it('is an allowlist per adapter: toil and CI tokens never reach any CLI, each CLI keeps its own sign-in', async () => {
    const claude = claudeStub(SCRIPT);
    await streamed(hostFor('claude', claude.module).host);
    const c = claude.seen.options!.env as Record<string, string>;
    expect(leaked(c)).toEqual([]);
    expect(c).toMatchObject({ PATH: '/usr/bin', HOME: '/home/you', ANTHROPIC_API_KEY: 'claude-own', HTTPS_PROXY: 'http://proxy.imagile.dev:8080' });
    expect(c).not.toHaveProperty('OPENAI_API_KEY');

    const copilot = copilotStub(SCRIPT);
    await streamed(hostFor('copilot', copilot.module).host);
    const p = (copilot.seen.client!.connection as { env: Record<string, string> }).env;
    expect(leaked(p)).toEqual([]);
    expect(p).toEqual({ PATH: '/usr/bin', HOME: '/home/you', COPILOT_GITHUB_TOKEN: 'copilot-own', HTTPS_PROXY: 'http://proxy.imagile.dev:8080' });

    const holder = new McpGrants(() => 'http://127.0.0.1:1/api/agent/mcp');
    const codex = codexStub(SCRIPT, holder);
    await streamed(hostFor('codex', codex.module, { serveTools: (t) => holder.serve(t) }).host);
    const x = codex.seen.options!.env as Record<string, string>;
    expect(leaked(x)).toEqual([]);
    expect(Object.keys(x).sort()).toEqual(['CODEX_HOME', 'HOME', 'HTTPS_PROXY', 'OPENAI_API_KEY', 'PATH', TOKEN_ENV].sort());
  });

  it('agentEnv drops everything off the list', () => {
    expect(agentEnv({ PATH: '/bin', TOIL_CONFIG: '/x', GH_TOKEN: 'g', NPM_TOKEN: 'n', CODEX_HOME: '/c', ANTHROPIC_API_KEY: 'a' }, 'codex')).toEqual({ PATH: '/bin', CODEX_HOME: '/c' });
  });
});

describe('the run count', () => {
  it('is taken before the SDK loads and given back whatever fails, so a third question waits and a failed load frees its place', async () => {
    let release: (e: unknown) => void = () => {};
    const blocked = new Promise<never>((_, reject) => (release = reject));
    const { host } = hostFor('claude', null, { importer: () => blocked });
    const first = host.ask(ctx(), 'card-payments', 'q').catch((e: unknown) => e);
    const second = host.ask(ctx(), 'card-payments', 'q').catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 0));
    expect(host.active).toBe(2);
    await expect(host.ask(ctx(), 'card-payments', 'q')).rejects.toThrow('2 questions are already running.');
    release(Object.assign(new Error("Cannot find package '@anthropic-ai/claude-agent-sdk'"), { code: 'ERR_MODULE_NOT_FOUND' }));
    expect(await first).toBeInstanceOf(AgentError);
    expect(await second).toBeInstanceOf(AgentError);
    expect(host.active).toBe(0);
  });

  it('is given back after a CLI search fails, and after an answer', async () => {
    const missing = hostFor('codex', codexStub(SCRIPT, new McpGrants(() => '')).module, { isFile: () => false }).host;
    await missing.ask(ctx(), 'card-payments', 'q').catch(() => undefined);
    expect(missing.active).toBe(0);
    const { host } = hostFor('claude', claudeStub(SCRIPT).module);
    await host.ask(ctx(), 'card-payments', 'q');
    expect(host.active).toBe(0);
  });
});

describe('a CLI path in Settings', () => {
  it("must name the adapter's own CLI", () => {
    expect(checkAgentSettings({ adapter: 'claude', cliPath: '/opt/bin/claude' }, posix.isAbsolute, 'linux').cliPath).toBe('/opt/bin/claude');
    expect(() => checkAgentSettings({ adapter: 'claude', cliPath: '/bin/sh' }, posix.isAbsolute, 'linux')).toThrow('The CLI path must end in claude, the claude adapter\'s own CLI, not "sh".');
    expect(() => checkAgentSettings({ adapter: 'codex', cliPath: '/opt/bin/claude' }, posix.isAbsolute, 'linux')).toThrow(/must end in codex/);
    expect(() => checkAgentSettings({ adapter: 'claude', cliPath: '/opt/bin/claude.exe' }, posix.isAbsolute, 'linux')).toThrow(/must end in claude,/);
    expect(() => checkAgentSettings({ adapter: 'none', cliPath: '/opt/bin/claude' }, posix.isAbsolute, 'linux')).toThrow(/needs an adapter/);
  });

  it('takes .exe on Windows, in any case, but not a .cmd shim the SDKs cannot start', () => {
    for (const p of ['C:\\Tools\\codex.exe', 'C:\\Tools\\CODEX.EXE', 'C:\\Tools\\codex']) expect(checkAgentSettings({ adapter: 'codex', cliPath: p }, win32.isAbsolute, 'win32').cliPath).toBe(p);
    for (const p of ['C:\\Windows\\System32\\cmd.exe', 'C:\\Tools\\codex.cmd']) expect(() => checkAgentSettings({ adapter: 'codex', cliPath: p }, win32.isAbsolute, 'win32')).toThrow(/must end in codex or codex.exe,/);
  });
});

describe('Latest', () => {
  it('yields the newest value, then ends or throws', async () => {
    const l = new Latest<number>();
    l.push(1);
    l.push(2);
    l.end();
    const seen = [];
    for await (const v of l) seen.push(v);
    expect(seen).toEqual([2]);
    const bad = new Latest<number>();
    bad.end(new Error('boom'));
    await expect((async () => {
      for await (const _ of bad) void _;
    })()).rejects.toThrow('boom');
  });
});

// Unused runtimes are still constructed, so their names stay in step with the settings.
it('the three runtimes are the three adapters the settings name', () => {
  const runtimes: Runtime[] = [claudeRuntime('t'), copilotRuntime(), codexRuntime()];
  expect(runtimes.map((r) => [r.name, r.package, r.command])).toEqual([
    ['claude', '@anthropic-ai/claude-agent-sdk', 'claude'],
    ['copilot', '@github/copilot-sdk', 'copilot'],
    ['codex', '@openai/codex-sdk', 'codex'],
  ]);
});

describe('the assignee a tool reports', () => {
  it('is the person\'s login when the tracker gives no name, as GitHub does, and filters on it', async () => {
    const github = cacheData(cache, 'checkout-web')!;
    const assigned = github.items().filter((i) => i.assignee);
    expect(assigned.length).toBeGreaterThan(0);
    const tools = cacheTools('checkout-web', github, new Ledger());
    const all = (await tool(tools, 'owi_query').run({ limit: 50 })) as { items: Array<{ id: string; assignee: string | null }> };
    for (const item of assigned) {
      const expected = item.assignee!.name ?? item.assignee!.id;
      expect(all.items.find((i) => i.id === item.id)?.assignee).toBe(expected);
    }
    const one = assigned[0]!;
    const login = one.assignee!.name ?? one.assignee!.id;
    const filtered = (await tool(tools, 'owi_query').run({ assignee: login, limit: 50 })) as { items: Array<{ id: string }> };
    expect(filtered.items.map((i) => i.id)).toContain(one.id);
  });
});

describe("Toil UI's own Codex home (#300)", () => {
  const sameFile = (a: string, b: string) => statSync(a, { bigint: true }).ino === statSync(b, { bigint: true }).ino;

  it("is where Codex runs: its own config.toml, and auth.json linked to the user's, not copied", async () => {
    const holder = new McpGrants(() => 'http://127.0.0.1:1/api/agent/mcp');
    const stub = codexStub(SCRIPT, holder);
    const { host, dataDir, env: given } = hostFor('codex', stub.module, { serveTools: (tools) => holder.serve(tools) });
    await streamed(host);
    const env = stub.seen.options!.env as Record<string, string>;
    const home = toilCodexHome(dataDir);
    expect(env.CODEX_HOME).toBe(home);
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe(TOIL_CODEX_CONFIG);
    const theirs = join(given.CODEX_HOME!, 'auth.json');
    expect(sameFile(theirs, join(home, 'auth.json'))).toBe(true);
    // One file under two names: a token Codex refreshes in Toil UI's home is the user's token too.
    writeFileSync(join(home, 'auth.json'), '{"auth_mode":"chatgpt","refreshed":true}\n');
    expect(readFileSync(theirs, 'utf8')).toContain('refreshed');
    // Only toil_ui and the features: nothing from any user config is named, because none is read.
    expect(stub.seen.options!.configOverrides).toEqual(codexOverrides('http://127.0.0.1:1/api/agent/mcp'));
  });

  it('rewrites its config.toml and replaces a copied auth.json with the link', () => {
    const theirs = userCodex();
    const home = toilCodexHome(mkdtempSync(join(folder, 'data-')));
    prepareCodexHome(home, { CODEX_HOME: theirs }, 'linux');
    writeFileSync(join(home, 'config.toml'), '[mcp_servers.left_behind]\ncommand = "x"\n');
    rmSync(join(home, 'auth.json'));
    writeFileSync(join(home, 'auth.json'), '{"stale":true}\n');
    prepareCodexHome(home, { CODEX_HOME: theirs }, 'linux');
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe(TOIL_CODEX_CONFIG);
    expect(sameFile(join(theirs, 'auth.json'), join(home, 'auth.json'))).toBe(true);
  });

  it('drops the link once the user signs out, and then refuses unless CODEX_API_KEY signs in', () => {
    const theirs = userCodex();
    const home = toilCodexHome(mkdtempSync(join(folder, 'data-')));
    prepareCodexHome(home, { CODEX_HOME: theirs }, 'linux');
    rmSync(join(theirs, 'auth.json'));
    expect(() => prepareCodexHome(home, { CODEX_HOME: theirs }, 'linux')).toThrow(AgentError);
    expect(existsSync(join(home, 'auth.json'))).toBe(false);
    try {
      prepareCodexHome(home, { CODEX_HOME: theirs }, 'linux');
    } catch (e) {
      expect((e as AgentError).message).toBe(`Toil UI runs Codex in a Codex home of its own and signs in with your Codex's auth.json, but there is none at ${join(theirs, 'auth.json')}.`);
      expect((e as AgentError).fix).toMatch(/codex login.*CODEX_API_KEY.*another adapter/);
    }
    expect(() => prepareCodexHome(home, { CODEX_HOME: theirs, CODEX_API_KEY: 'sk-own' }, 'linux')).not.toThrow();
    expect(existsSync(join(home, 'auth.json'))).toBe(false);
  });

  it("finds the user's Codex home from CODEX_HOME, else .codex in the home folder", () => {
    expect(userCodexHome({ CODEX_HOME: '/opt/codex', HOME: '/home/you' }, 'linux')).toBe('/opt/codex');
    expect(userCodexHome({ HOME: '/home/you' }, 'linux')).toBe(join('/home/you', '.codex'));
    expect(userCodexHome({ USERPROFILE: 'C:\\Users\\you', HOME: '/c/Users/you' }, 'win32')).toBe(join('C:\\Users\\you', '.codex'));
  });

  it("serves toil_ui as the only MCP server and switches Codex's own reach off", () => {
    const overrides = codexOverrides('http://127.0.0.1:1/api/agent/mcp');
    expect(overrides.filter((o) => o.startsWith('mcp_servers'))).toEqual(['mcp_servers={ toil_ui = { url = "http://127.0.0.1:1/api/agent/mcp", bearer_token_env_var = "TOIL_UI_MCP_TOKEN" } }']);
    expect(overrides.slice(1)).toEqual(CODEX_FEATURES_OFF.map((f) => `features.${f}=false`));
  });
});
