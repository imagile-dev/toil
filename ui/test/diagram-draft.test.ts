// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as zod from 'zod';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execute, registry } from '../../src/api.ts';
import { noAgent } from '../server/agent.ts';
import { NO_DRAFT, finish, partial, partsOf, writeCommands } from '../server/agents/answer.ts';
import { claudeRuntime } from '../server/agents/claude.ts';
import { AgentHost, type AgentHostOptions } from '../server/agents/host.ts';
import type { Importer } from '../server/agents/runtime.ts';
import { agentSettingsFile } from '../server/agents/settings.ts';
import { jobQuestion } from '../server/agents/jobs.ts';
import { Ledger, draftOf, liveTools, type AgentData } from '../server/agents/tools.ts';
import type { RequestContext } from '../server/context.ts';
import { SAMPLE_DIAGRAMS } from '../src/fixtures/diagrams.ts';
import { FIXTURE_NOW } from '../src/fixtures/execute.ts';
import { jobPrompt } from '../src/model/jobs.ts';
import type { Execute } from '../src/toil.ts';

/**
 * The Diagram job's end (#582): the draft diagram is the input of the last
 * `projects diagram check` that passed, taken from the tool the agent called
 * and not from anything it wrote; an answer whose run passed none says so and
 * offers nothing; a fenced block in a job's answer is one folded part, never
 * paragraphs of run-together text; and the prompt no longer asks for Mermaid.
 * The registry and `execute()` are toil's own, from source, so the check the
 * agent calls is the check a Save runs.
 */

const folder = mkdtempSync(join(tmpdir(), 'toil-ui-draft-'));
const model = JSON.stringify(SAMPLE_DIAGRAMS['card-payments']!.model);
const ctx = (): RequestContext => ({ viewer: { id: 'local', name: 'you', via: 'loopback' }, signal: new AbortController().signal });

// Every test runs toil's own execute() in a home of its own: never the one this machine's person keeps their config and audit log in.
beforeEach(() => {
  vi.stubEnv('HOME', folder);
  vi.stubEnv('USERPROFILE', folder);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => rmSync(folder, { recursive: true, force: true, maxRetries: 3 }));

/** toil's own execute(), as the agent's live tools call it, with every call recorded. */
function real() {
  const calls: Array<{ command: string; input: Record<string, unknown> }> = [];
  const run: Execute = (command, input = {}, options = {}) => {
    calls.push({ command, input });
    return execute(command, input, options);
  };
  return { run, calls };
}

const checkTool = (ledger: Ledger, run: Execute = real().run) => liveTools('card-payments', registry.commands, run, () => [], ledger).find((t) => t.name === 'projects_diagram_check')!;

describe('the check the agent calls', () => {
  it('is a read tool the agent has, which cannot name a file on this machine', () => {
    const tool = checkTool(new Ledger());
    expect(tool.command).toBe('projects diagram check');
    expect(Object.keys(tool.inputSchema.properties)).toEqual(expect.arrayContaining(['text', 'notMapped']));
    for (const k of ['file', 'cwd', 'toilProject', 'connection']) expect(tool.inputSchema.properties).not.toHaveProperty(k);
  });

  it('keeps, as the draft, exactly the model text of the last check that passed, with what toil counted', async () => {
    const ledger = new Ledger();
    const tool = checkTool(ledger);
    expect(ledger.diagram).toBeNull();
    await tool.run({ text: model, notMapped: ['dist/', 'node_modules/'] });
    expect(ledger.diagram).toMatchObject({ text: model, notMapped: ['dist/', 'node_modules/'], title: 'Card payments', counts: { elements: 10, relationships: 8 } });
    expect(ledger.diagram!.views.map((v) => v.key)).toEqual(['context', 'containers']);
    expect(ledger.diagram!.counts.observed + ledger.diagram!.counts.inferred + ledger.diagram!.counts.unmarked).toBe(18);
  });

  it('keeps nothing from a check that failed, and leaves the one before it, which did pass', async () => {
    const ledger = new Ledger();
    const tool = checkTool(ledger);
    const bad = await tool.run({ text: '{"systems": []}' });
    expect(JSON.stringify(bad)).toContain('error');
    expect(ledger.diagram).toBeNull();
    await tool.run({ text: model });
    const secondText = JSON.stringify({ ...JSON.parse(model), title: 'Changed' });
    // A model with a URL in it is refused by toil's own storage checks, and is never kept.
    await tool.run({ text: secondText.replace('Card payments', 'https://host.imagile.dev/x') });
    expect(ledger.diagram!.text).toBe(model);
    await tool.run({ text: secondText });
    expect(ledger.diagram!.text).toBe(secondText);
  });

  it('draws a draft only from text, so a call that named no text keeps nothing', () => {
    expect(draftOf({}, { views: [], counts: {} })).toBeNull();
    expect(draftOf({ text: 'x' }, null)).toBeNull();
  });
});

describe('the answer to the Diagram job', () => {
  const writes = writeCommands(registry.commands);
  const f = (ledger: Ledger, over: object = {}) => ({ toilProject: 'card-payments', prompt: 'Diagram', by: 'Claude', ledger, writes, drafts: true, fold: true, ...over });

  it('carries the draft from the ledger, and no warning, when a check passed', async () => {
    const ledger = new Ledger();
    await checkTool(ledger).run({ text: model });
    const a = finish('I drew four containers. Three questions for you.', f(ledger));
    expect(a.diagram?.text).toBe(model);
    expect(a.warnings).toEqual([]);
  });

  it('says plainly there is nothing to save when no check passed, and offers no draft', () => {
    const a = finish('I drew a picture in words.', f(new Ledger()));
    expect(a.diagram).toBeNull();
    expect(a.warnings).toContain(NO_DRAFT);
    expect(NO_DRAFT).toBe("The agent did not finish a model that passes toil's checks, so there is nothing to save.");
  });

  it('is not a Diagram answer for any other job or question: no draft key at all', async () => {
    const ledger = new Ledger();
    await checkTool(ledger).run({ text: model });
    expect('diagram' in finish('A review.', f(ledger, { drafts: false }))).toBe(false);
  });
});

describe('a fenced block in a job answer', () => {
  const mermaid = ['Here it is.', '', '```mermaid', 'C4Container', '', '  title X', '  Rel(a, b, "uses")', '```', '', 'Three questions.'].join('\n');

  it('is one folded part, with its language, blank lines and all, between the prose around it', () => {
    expect(partsOf(mermaid, true)).toEqual([{ text: 'Here it is.' }, { text: 'C4Container\n\n  title X\n  Rel(a, b, "uses")', fence: 'mermaid' }, { text: 'Three questions.' }]);
  });

  it('is left as it was for an answer that is not a job’s', () => {
    expect(partsOf(mermaid).every((p) => p.fence === undefined)).toBe(true);
  });

  it('is still one part while it streams unclosed, and ends when it ends', () => {
    const open = 'Drawing.\n\n```mermaid\nC4Container\n  title Half';
    expect(partial(open, { prompt: 'p', by: 'b' }, true).parts).toEqual([{ text: 'Drawing.' }, { text: 'C4Container\n  title Half', fence: 'mermaid' }]);
  });

  it('is never read for citations or the checks on them', () => {
    const a = finish('See [[corp-jira:PAY-1]].\n\n```text\n[[corp-jira:PAY-404]] corp-jira:PAY-405\n```', { toilProject: 'd', prompt: 'p', by: 'b', ledger: Object.assign(new Ledger(), {}), writes: writeCommands(registry.commands), fold: true });
    expect(a.parts.filter((p) => p.fence !== undefined)).toHaveLength(1);
    expect(a.unverified).toEqual(['corp-jira:PAY-1']);
  });
});

describe('the prompt for the Diagram job', () => {
  const q = jobQuestion('card-payments', jobPrompt('map-codebase', ''), () => 0, { changes: new Set(), repositories: new Set() })!;

  it('asks for a model that passes projects_diagram_check, and for prose, never Mermaid, JSON or a code fence', () => {
    expect(q.job).toBe('map-codebase');
    expect(q.text).toContain('projects_diagram_check');
    expect(q.text).toMatch(/put no Mermaid, JSON or code fence in your answer/);
    expect(q.text).toContain('how: "observed"');
    expect(q.text).toContain('how: "inferred"');
    // `how` says a thing is inferred, so the description never opens with "(inferred)".
    expect(q.text).toMatch(/never write "\(inferred\)" or "inferred" in a description/);
    expect(q.text).toMatch(/Never put a URL/);
    expect(q.text).toMatch(/Save diagram button/);
    expect(q.text).not.toMatch(/putting the Mermaid text in your answer|draw it with util_c4_mermaid/);
  });
});

describe('a Diagram run end to end, on a stubbed Claude', () => {
  /** The Claude Agent SDK, stubbed as in agents.test.ts: the scripted tool calls run through the real tools, then the text streams. */
  function claudeStub(calls: Array<{ name: string; input: Record<string, unknown> }>, chunks: string[]) {
    return {
      tool: (name: string, description: string, shape: unknown, handler: (a: Record<string, unknown>) => Promise<unknown>) => ({ name, description, shape, handler }),
      createSdkMcpServer: (o: { name: string; tools: unknown[] }) => ({ type: 'sdk', name: o.name, tools: o.tools }),
      query: ({ options }: { options: Record<string, unknown> }) => {
        const server = (options.mcpServers as Record<string, { tools: Array<{ name: string; handler: (a: Record<string, unknown>) => Promise<unknown> }> }>).toil_ui!;
        return (async function* () {
          for (const c of calls) await server.tools.find((t) => t.name === c.name)?.handler(c.input);
          yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start' } };
          for (const text of chunks) yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } };
          yield { type: 'result', subtype: 'success', result: chunks.join('') };
        })();
      },
    };
  }

  const none: AgentData = { items: () => [], transitions: () => [], changes: () => [], syncedAt: () => FIXTURE_NOW };
  function host(sdk: unknown, over: Partial<AgentHostOptions> = {}) {
    const dataDir = mkdtempSync(join(folder, 'host-'));
    writeFileSync(agentSettingsFile(dataDir), JSON.stringify({ adapter: 'claude', model: 'test-model', cliPath: null, endpoint: 'bedrock' }));
    const importer: Importer = async (spec) => {
      if (spec === 'zod') return zod;
      if (spec.startsWith('@anthropic-ai/')) return sdk;
      throw Object.assign(new Error(`Cannot find package '${spec}'`), { code: 'ERR_MODULE_NOT_FOUND' });
    };
    return new AgentHost({
      dataDir, version: 't', data: () => none, registry: registry.commands, execute: real().run, mapIds: () => [], serveTools: () => ({ url: '', token: '', close() {} }), fallback: noAgent(),
      env: { PATH: '/usr/bin', HOME: '/home/you' }, cwd: '/work', platform: 'linux', importer, installed: () => true, isFile: (p) => p === '/usr/bin/claude', now: () => FIXTURE_NOW, runtimes: [claudeRuntime('t')], ...over,
    });
  }
  const last = async (h: AgentHost) => {
    let answer;
    for await (const a of h.stream(ctx(), 'card-payments', jobPrompt('map-codebase', ''))) answer = a;
    return answer!;
  };

  it('attaches the checked model, and folds the Mermaid the agent pasted anyway, on the finished answer only', async () => {
    const stub = claudeStub([{ name: 'projects_diagram_check', input: { text: model, notMapped: ['dist/'] } }], ['Four containers, ', 'two inferred.\n\n```mermaid\nC4Container\n```\n\nQuestions.']);
    const seen: Array<{ diagram?: unknown }> = [];
    let final;
    for await (const a of host(stub).stream(ctx(), 'card-payments', jobPrompt('map-codebase', ''))) {
      seen.push(a);
      final = a;
    }
    expect(final!.diagram?.text).toBe(model);
    expect(final!.diagram?.notMapped).toEqual(['dist/']);
    expect(final!.parts.map((p) => p.fence)).toEqual([undefined, 'mermaid', undefined]);
    // The model never rides on a partial answer: it is large, and it isn't final until the run is.
    expect(seen.slice(0, -1).every((a) => !('diagram' in a))).toBe(true);
  });

  it('says it needs a newer toil, rather than blaming the agent, when toil has no check command to call', async () => {
    const older = registry.commands.filter((c) => c.name !== 'projects diagram check');
    const h = host(claudeStub([], ['never said']), { registry: older });
    const refused = await last(h).catch((e: unknown) => e as { message: string; fix: string });
    expect(refused).toMatchObject({ message: expect.stringContaining('has no projects diagram check command'), fix: expect.stringContaining('needs a newer toil') });
  });

  it('says there is nothing to save when the run passed no check', async () => {
    const stub = claudeStub([{ name: 'projects_diagram_check', input: { text: '{"systems":[]}' } }], ['I could not make a model that passes.']);
    const final = await last(host(stub));
    expect(final.diagram).toBeNull();
    expect(final.warnings).toContain(NO_DRAFT);
  });
});
