import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand, type AnyCommand } from '../src/core/command.js';
import type { Envelope } from '../src/core/envelope.js';
import { createMcpServer } from '../src/mcp/server.js';
import { createNodeContext, writeOutputFile } from '../src/node-context.js';
import { runProgram, type GlobalOptions } from '../src/program.js';
import { connectMcp } from './harness/mcp.js';

/**
 * The workspace and git, end to end through both front doors with the real
 * node context. No git area exists yet, so two test-only commands stand in:
 * one that runs `git version` through ctx.git, one that reads a file through
 * ctx.files. Neither is ever registered in the shipped CLI. Like a pilot
 * programme, they exist so the real thing can be approved later.
 */
const gitProbe = defineCommand({
  path: ['probe', 'git'],
  description: 'Test only: runs git version',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => (await ctx.git!.run({ subcommand: 'version' })).stdout.trim(),
});
const readProbe = defineCommand({
  path: ['probe', 'read'],
  description: 'Test only: reads a file',
  input: z.object({ file: z.string() }),
  writes: false,
  args: [{ name: 'file', field: 'file', description: 'file' }],
  examples: [{ file: 'a.txt' }],
  run: async (input, ctx) => ({ text: ctx.files.readText(input.file), workspace: ctx.files.workspace }),
});
const probes: AnyCommand[] = [gitProbe, readProbe];

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'toil-ws-e2e-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const home = join(root, 'home');
const cwd = join(root, 'cwd');
const other = join(root, 'other');
for (const d of [home, cwd, other]) mkdirSync(d, { recursive: true });
writeFileSync(join(cwd, 'a.txt'), 'from cwd');
writeFileSync(join(other, 'a.txt'), 'from other');
// A planted git in the working directory: never what runs.
writeFileSync(join(cwd, process.platform === 'win32' ? 'git.exe' : 'git'), 'not git');

function nodeContext(options: { env: NodeJS.ProcessEnv; globals?: GlobalOptions; mcp?: boolean; roots?: readonly string[]; def?: AnyCommand }) {
  return createNodeContext({
    globals: options.globals ?? {},
    def: options.def,
    signal: new AbortController().signal,
    env: options.env,
    cwd,
    home,
    areas: [],
    version: '0.0.0-test',
    stderr: () => {},
    stdin: !options.mcp,
    roots: options.roots,
  });
}

async function cli(argv: string[], env: NodeJS.ProcessEnv): Promise<{ exitCode: number; envelope: Envelope }> {
  let stdout = '';
  const exitCode = await runProgram(
    {
      commands: probes,
      version: '0.0.0-test',
      io: { stdout: (t) => (stdout += t), stderr: () => {}, writeFile: () => {} },
      createContext: (globals, def) => nodeContext({ env, globals, def }),
      startMcp: async () => {},
    },
    argv,
    'user',
  );
  return { exitCode, envelope: JSON.parse(stdout) as Envelope };
}

const noGit = { PATH: ['.', cwd].join(process.platform === 'win32' ? ';' : ':') };

describe('git missing is GIT_NOT_FOUND, on both front doors', () => {
  it('CLI: exit code 1 and the plain message, fast, with PATH holding only the working directory and a relative entry', async () => {
    const started = Date.now();
    const run = await cli(['probe', 'git'], noGit);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(run.exitCode).toBe(1);
    expect(run.envelope.error).toMatchObject({
      code: 'GIT_NOT_FOUND',
      message: "git isn't on PATH, and toil probe git needs it. Only commands that run git need it installed.",
      fix: expect.stringContaining('PATH searched:'),
    });
    const empty = await cli(['probe', 'git'], { PATH: '' });
    expect(empty.exitCode).toBe(1);
    expect(empty.envelope.error?.fix).toContain('PATH searched: (empty).');
  });

  it('MCP: the same envelope as an error result, with the workspace from --workspace', async () => {
    const session = await connectMcp({ commands: probes, context: nodeContext({ env: noGit, globals: { workspace: cwd }, mcp: true, def: gitProbe }) });
    const started = Date.now();
    const result = await session.call('probe_git', {});
    await session.close();
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.isError).toBe(true);
    expect(result.envelope.error?.code).toBe('GIT_NOT_FOUND');
    expect(result.envelope.error?.message).toBe("git isn't on PATH, and toil probe git needs it. Only commands that run git need it installed.");
  });

  it('commands that do not run git are unaffected by a missing git', async () => {
    const run = await cli(['probe', 'read', 'a.txt'], { PATH: '' });
    expect(run.envelope).toMatchObject({ ok: true, data: { text: 'from cwd' } });
  });
});

describe('which folder is the workspace', () => {
  it('CLI: the working directory, then TOIL_WORKSPACE, then --workspace above both', async () => {
    expect((await cli(['probe', 'read', 'a.txt'], {})).envelope.data).toEqual({ text: 'from cwd', workspace: cwd.replace(/\\/g, '/') });
    expect((await cli(['probe', 'read', 'a.txt'], { TOIL_WORKSPACE: other })).envelope.data).toMatchObject({ text: 'from other' });
    expect((await cli(['--workspace', cwd, 'probe', 'read', 'a.txt'], { TOIL_WORKSPACE: other })).envelope.data).toMatchObject({ text: 'from cwd' });
  });

  it('CLI: a path outside it is refused, naming --workspace and the opt-out', async () => {
    const run = await cli(['probe', 'read', join(other, 'a.txt')], {});
    expect(run.exitCode).toBe(1);
    expect(run.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('is outside the workspace'), fix: expect.stringContaining('"bounds": { "files": "unbounded" }') });
  });

  /** A real MCP client that shares `roots`, over the in-memory transport, against the real node context. */
  async function mcpWithRoots(roots: string[] | undefined, env: NodeJS.ProcessEnv = {}, uris?: () => string[]) {
    const server = createMcpServer({ commands: probes, context: (def, _signal, shared) => nodeContext({ env, mcp: true, roots: shared, def }) });
    const client = new Client({ name: 'toil-tests', version: '0' }, roots || uris ? { capabilities: { roots: { listChanged: true } } } : {});
    const list = uris ?? (() => roots!.map((r) => pathToFileURL(r).href));
    if (roots || uris) {
      client.setRequestHandler(ListRootsRequestSchema, () => {
        const current = list();
        if (current.includes('throw:')) throw new Error('client failed');
        return { roots: current.map((uri) => ({ uri, name: 'root' })) };
      });
    }
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    const call = async (args: Record<string, unknown>) => (await client.callTool({ name: 'probe_read', arguments: args })).structuredContent as unknown as Envelope;
    return { call, client, close: async () => { await client.close(); await server.close(); } };
  }

  it("MCP: the client's single root, never the server's working directory", async () => {
    const one = await mcpWithRoots([other]);
    expect((await one.call({ file: 'a.txt' })).data).toMatchObject({ text: 'from other' });
    expect((await one.call({ file: join(cwd, 'a.txt') })).error?.code).toBe('INVALID_INPUT');
    await one.close();
  });

  it('MCP: a root URI Node cannot convert is dropped on its own, and list_changed asks again', async () => {
    // A file URI with an encoded slash, which Node refuses to turn into a path. (The SDK
    // itself rejects roots that aren't file:// URIs, so those never reach the server.)
    let uris = ['file:///x%2Fy', pathToFileURL(other).href];
    const session = await mcpWithRoots(undefined, {}, () => uris);
    expect((await session.call({ file: 'a.txt' })).data).toMatchObject({ text: 'from other' });
    uris = [pathToFileURL(cwd).href];
    // Cached until the client says the roots changed.
    expect((await session.call({ file: 'a.txt' })).data).toMatchObject({ text: 'from other' });
    await session.client.sendRootsListChanged();
    await new Promise((r) => setTimeout(r, 20));
    expect((await session.call({ file: 'a.txt' })).data).toMatchObject({ text: 'from cwd' });
    // A client that fails to answer leaves no workspace, and is asked again next time.
    uris = ['throw:'];
    await session.client.sendRootsListChanged();
    await new Promise((r) => setTimeout(r, 20));
    expect((await session.call({ file: 'a.txt' })).error?.code).toBe('NOT_CONFIGURED');
    uris = [pathToFileURL(other).href];
    expect((await session.call({ file: 'a.txt' })).data).toMatchObject({ text: 'from other' });
    await session.close();
  });

  it('MCP: no roots, or several, refuses file commands with a fix; TOIL_WORKSPACE settles it', async () => {
    const none = await mcpWithRoots(undefined);
    expect((await none.call({ file: 'a.txt' })).error).toMatchObject({ code: 'NOT_CONFIGURED', fix: expect.stringContaining('--workspace <dir>') });
    await none.close();
    const two = await mcpWithRoots([cwd, other]);
    expect((await two.call({ file: 'a.txt' })).error).toMatchObject({ code: 'NOT_CONFIGURED', message: expect.stringContaining('shared 2 roots') });
    await two.close();
    const pinned = await mcpWithRoots([cwd, other], { TOIL_WORKSPACE: other });
    expect((await pinned.call({ file: 'a.txt' })).data).toMatchObject({ text: 'from other' });
    await pinned.close();
  });
});

describe('a refused git include during a listing', () => {
  it('lands in meta.warnings as GIT_INCLUDE_REFUSED', async () => {
    const repo = join(root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(repo, '.git', 'config'), `[include]\n\tpath = ${join(home, '.toil', 'config.json').replace(/\\/g, '/')}\n`);
    writeFileSync(join(repo, 'a.txt'), 'x');
    const lister = defineCommand({
      path: ['probe', 'list'],
      description: 'Test only: lists files',
      input: z.object({}),
      writes: false,
      examples: [{}],
      run: async (_input, ctx) => ctx.files.list(),
    });
    let stdout = '';
    await runProgram(
      {
        commands: [lister],
        version: '0.0.0-test',
        io: { stdout: (t) => (stdout += t), stderr: () => {}, writeFile: () => {} },
        createContext: (globals, def) => nodeContext({ env: {}, globals: { ...globals, workspace: repo }, def }),
        startMcp: async () => {},
      },
      ['probe', 'list'],
      'user',
    );
    const envelope = JSON.parse(stdout) as Envelope;
    expect(envelope.data).toEqual(['a.txt']);
    expect(envelope.meta.warnings).toEqual([expect.objectContaining({ code: 'GIT_INCLUDE_REFUSED', message: expect.stringContaining('.toil/config.json') })]);
  });
});

describe('--output-file', () => {
  const write = (path: string) => writeOutputFile({ path, content: '{}\n', cwd, home, config: join(home, 'custom.json') });

  it('may write outside the workspace, but never over a file, into toil\'s own files, or the --config file', () => {
    const target = join(root, 'elsewhere', 'out.json');
    write(target);
    expect(readFileSync(target, 'utf8')).toBe('{}\n');
    expect(() => write(target)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('already exists') }));
    expect(() => write(join(home, '.toil', 'config.json'))).toThrow(expect.objectContaining({ message: expect.stringContaining("toil's own configuration") }));
    expect(() => write(join(home, 'custom.json'))).toThrow(expect.objectContaining({ message: expect.stringContaining("toil's own configuration") }));
  });

  it('puts the refusal on stdout, exit code 1, when the file cannot be written', async () => {
    let stdout = '';
    const exitCode = await runProgram(
      {
        commands: probes,
        version: '0.0.0-test',
        io: { stdout: (t) => (stdout += t), stderr: () => {}, writeFile: (path) => write(path) },
        createContext: (globals, def) => nodeContext({ env: {}, globals, def }),
        startMcp: async () => {},
      },
      ['--output-file', join(home, '.toil', 'out.json'), 'probe', 'read', 'a.txt'],
      'user',
    );
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining("toil's own configuration") });
  });
});

describe('over MCP, no tool input chooses a config file', () => {
  it('refuses a config field as INVALID_INPUT, so the server keeps the config it was started with', async () => {
    const session = await connectMcp({ commands: probes, context: nodeContext({ env: {}, globals: { workspace: cwd }, mcp: true, def: readProbe }) });
    const result = await session.call('probe_read', { file: 'a.txt', config: join(home, 'unbounded.json') });
    await session.close();
    expect(result.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('config') });
  });
});

describe('relaxing the file bound', () => {
  it('"bounds": { "files": "unbounded" } lets a path outside through and says so in meta.warnings', async () => {
    const config = join(home, 'unbounded.json');
    writeFileSync(config, JSON.stringify({ version: 2, connections: {}, bounds: { files: 'unbounded' } }));
    const env = {};
    let stdout = '';
    const area = defineCommand({ ...readProbe, path: ['probe', 'read-config'] });
    // Standalone commands skip config, so give this one config the way an area command loads it.
    const withConfig = { ...area, standalone: false } as AnyCommand;
    await runProgram(
      {
        commands: [withConfig],
        version: '0.0.0-test',
        io: { stdout: (t) => (stdout += t), stderr: () => {}, writeFile: () => {} },
        createContext: (globals, def) => nodeContext({ env, globals, def }),
        startMcp: async () => {},
      },
      ['--config', config, 'probe', 'read-config', join(other, 'a.txt')],
      'user',
    );
    const envelope = JSON.parse(stdout) as Envelope;
    expect(envelope.data).toMatchObject({ text: 'from other' });
    expect(envelope.meta.warnings).toEqual([expect.objectContaining({ code: 'BOUND_RELAXED' })]);
  });
});
