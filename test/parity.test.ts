import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONNECTION_FIELD } from '../src/core/area.js';
import { aliasInput, aliasPaths, areaOf, commandName, isCliOnly, servedOverMcp, toolName, type AnyCommand } from '../src/core/command.js';
import type { Settings } from '../src/core/config.js';
import type { Envelope } from '../src/core/envelope.js';
import { ToilError } from '../src/core/errors.js';
import { argvFor } from '../src/program.js';
import { commands } from '../src/registry.js';
import { demoCommands } from './fixtures/demo-commands.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';
import type { Route } from './harness/fake-fetch.js';
import { loadFixtures, setUp, tearDown, writeOperations, type LoadedFixture } from './harness/fixtures.js';
import { connectMcp, type McpSession } from './harness/mcp.js';
import { recordOperations } from './harness/operations.js';

/**
 * The CLI and MCP are two front doors onto one core, and this suite is what
 * keeps them 1:1. It walks every registered command, one suite per area
 * fixture (test/fixtures/<area>.fixture.ts) plus one for commands outside any
 * area, so a new command is covered the moment it is registered and its area
 * has a fixture, with no test to remember to write.
 *
 * Areas that don't speak HTTP (db) are compared through the operations log
 * instead: their fixture traces the object that does the work, and both doors
 * must make the same calls with the same arguments.
 *
 * The one exclusion: commands that are never MCP tools, the `cli-only` kind
 * (they prompt on a terminal or change connections) and area commands marked
 * `mcp: false` (deletes). They're found by their definition, so no integration
 * edits a list here; a test proves MCP doesn't serve them, and the area ones still
 * run their examples and hold the write gate on the CLI. Aliases are
 * CLI paths onto a command, so each one is run against that command's MCP tool.
 */
const bothDoors = servedOverMcp;

const fixtures = await loadFixtures();
beforeAll(() => setUp(fixtures));
afterAll(() => tearDown(fixtures));
type Files = Record<string, string | Uint8Array>;
// Config, files and routes are read from the fixture when each test runs, after setup.
const outside: LoadedFixture = { area: '', routes: [], config: {}, files: {}, commands: [], trace: [] };
const suites: Array<{ name: string; commands: AnyCommand[]; fixture: LoadedFixture }> = [
  { name: 'commands outside an area', commands: commands.filter((def) => !def.area && bothDoors(def)), fixture: outside },
  ...fixtures.map((f) => ({ name: `${f.area} area`, commands: f.commands.filter(bothDoors), fixture: f })),
];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const sessions: McpSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

async function mcpFor(list: AnyCommand[], cfg: Record<string, Settings>, routes: Route[], files: Files = {}) {
  const { context, http } = testContext({ config: cfg, routes, files });
  const session = await connectMcp({ commands: list, context });
  sessions.push(session);
  return { session, http };
}

/** Timing is the only field allowed to differ between two runs of the same call. */
function comparable(envelope: Envelope | undefined): unknown {
  if (!envelope) return envelope;
  return { ...envelope, meta: { ...envelope.meta, durationMs: 0 } };
}

/** The config with writes switched off for one area, credentials untouched. */
function withoutWrites(cfg: Record<string, Settings>, area: string): Record<string, Settings> {
  const rest = { ...(cfg[area] ?? {}) };
  delete rest.writes;
  return { ...cfg, [area]: rest };
}

describe('coverage', () => {
  it('every registered area that needs config has a fixture', () => {
    const covered = new Set(fixtures.map((f) => f.area));
    const missing = [...new Set(commands.filter((def) => def.area).map(areaOf))].filter((a) => !covered.has(a));
    expect(missing, 'add test/fixtures/<area>.fixture.ts').toEqual([]);
  });

  it('excludes every command MCP must not serve, found by its definition, and MCP never serves them', async () => {
    const cliOnly = [...commands, ...demoCommands].filter((def) => !servedOverMcp(def));
    // Core's own connection setup is cli-only, and the demo delete is mcp: false; if none were found, the check would prove nothing.
    expect(cliOnly.map(commandName)).toContain('connections add');
    expect(cliOnly.map(commandName)).toContain('demo delete-thing');
    // Every area named and writes on: the widest MCP ever gets, and still none of them.
    const { context } = testContext({ config: { demo: { token: 't', writes: true } } });
    const session = await connectMcp({ commands: [...commands, ...demoCommands], context, areas: [...new Set(commands.map(areaOf))] });
    sessions.push(session);
    const tools = (await session.client.listTools()).tools.map((t) => t.name);
    for (const def of cliOnly) expect(tools, commandName(def)).not.toContain(toolName(def));
    expect(tools).toContain('connections_list');
  });
});

for (const suite of suites) {
  describe(suite.name, () => {
    it('has unique paths and tool names, a description and at least one example per command', () => {
      expect(new Set(suite.commands.map(commandName)).size).toBe(suite.commands.length);
      expect(new Set(suite.commands.map(toolName)).size).toBe(suite.commands.length);
      for (const def of suite.commands) {
        expect(def.description, commandName(def)).not.toBe('');
        expect(def.examples.length, `${commandName(def)} needs an example`).toBeGreaterThan(0);
      }
    });

    it('maps every CLI argument and flag onto an input field, and every input field onto the CLI', () => {
      for (const def of suite.commands) {
        const fields = Object.keys(def.input.shape).filter((f) => f !== 'allowWrite');
        const mapped = [...(def.args ?? []), ...(def.options ?? [])].map((x) => x.field);
        expect(new Set(mapped), `${commandName(def)}: CLI fields`).toEqual(new Set(fields));
        if (def.writes) expect(def.input.shape, `${commandName(def)} must accept allowWrite`).toHaveProperty('allowWrite');
      }
    });

    it('exposes one MCP tool per command, with the same input schema', async () => {
      const { session } = await mcpFor(suite.commands, suite.fixture.config, suite.fixture.routes, suite.fixture.files);
      const { tools } = await session.client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(suite.commands.map(toolName).sort());
      for (const def of suite.commands) {
        const tool = tools.find((t) => t.name === toolName(def))!;
        const expected = z.toJSONSchema(def.input, { target: 'draft-7' }) as { properties?: object; required?: string[] };
        expect(tool.inputSchema.properties ?? {}, toolName(def)).toEqual(expected.properties ?? {});
        expect([...(tool.inputSchema.required ?? [])].sort(), toolName(def)).toEqual([...(expected.required ?? [])].sort());
        expect(tool.inputSchema.additionalProperties, `${toolName(def)} advertises that unknown fields are refused`).toBe(false);
        expect(tool.annotations?.readOnlyHint, toolName(def)).toBe(!def.writes);
      }
    });

    it('uses every input field in at least one example, so parity covers every flag', () => {
      for (const def of suite.commands) {
        const used = new Set(def.examples.flatMap((e) => Object.keys(e as object)));
        // `connection` is added by core to every area command; the connection suite below covers it.
        const unused = Object.keys(def.input.shape).filter((f) => !used.has(f) && f !== CONNECTION_FIELD);
        expect(unused, `${commandName(def)}: fields no example sets`).toEqual([]);
      }
    });

    for (const def of suite.commands) {
      def.examples.forEach((example, i) => {
        it(`${commandName(def)} example ${i + 1}: CLI and MCP send the same requests and return the same envelope`, async () => {
          const cli = testContext({ config: suite.fixture.config, routes: suite.fixture.routes, files: suite.fixture.files });
          const { result: viaCli, operations: cliOps } = await recordOperations(() => runCli(argvFor(def, example), { commands: suite.commands, context: cli.context }));

          const { session, http } = await mcpFor(suite.commands, suite.fixture.config, suite.fixture.routes, suite.fixture.files);
          const { result: viaMcp, operations: mcpOps } = await recordOperations(() => session.call(toolName(def), example));

          expect(viaCli.envelope?.ok, viaCli.stdout + viaCli.stderr).toBe(true);
          expect(comparable(viaMcp.envelope)).toEqual(comparable(viaCli.envelope));
          expect(JSON.parse(viaMcp.text), 'MCP text and structured content agree').toEqual(viaMcp.envelope);
          expect(viaMcp.isError).toBe(false);
          expect(http.calls, 'same HTTP requests').toEqual(cli.http.calls);
          expect(mcpOps, 'same operations').toEqual(cliOps);
          if (suite.fixture.trace.length > 0) expect(cliOps.length, `${commandName(def)}: the fixture traces this area, so its examples should log operations`).toBeGreaterThan(0);
          expect(viaCli.exitCode).toBe(0);
          if (!def.writes) {
            const allowed = def.queryByPost ? new Set([...READ_METHODS, 'POST']) : READ_METHODS;
            const methods = cli.http.calls.map((c) => c.method).filter((m) => !allowed.has(m));
            expect(methods, `${commandName(def)} is read-only but sent`).toEqual([]);
            const writing = writeOperations(suite.fixture);
            expect(cliOps.map((o) => o.op).filter((op) => writing.has(op)), `${commandName(def)} is read-only but called`).toEqual([]);
          }
        });
      });

      for (const path of aliasPaths(def)) {
        it(`${commandName(def)}: the alias toil ${path.join(' ')} gives the same envelope and requests as the MCP tool`, async () => {
          for (const example of def.examples as Array<Record<string, unknown>>) {
            const cli = testContext({ config: suite.fixture.config, routes: suite.fixture.routes, files: suite.fixture.files });
            const { result: viaAlias, operations: aliasOps } = await recordOperations(() => runCli(argvFor(def, example, path), { commands: suite.commands, context: cli.context }));
            const { session, http } = await mcpFor(suite.commands, suite.fixture.config, suite.fixture.routes, suite.fixture.files);
            // A preset alias (`jenkins instance list`) is the tool with those fields set.
            const { result: viaMcp, operations: mcpOps } = await recordOperations(() => session.call(toolName(def), { ...example, ...aliasInput(def, path) }));

            expect(viaAlias.envelope?.ok, viaAlias.stdout + viaAlias.stderr).toBe(true);
            expect(viaAlias.envelope?.meta.command, 'meta.command names the command, not the alias').toBe(commandName(def));
            expect(comparable(viaMcp.envelope)).toEqual(comparable(viaAlias.envelope));
            expect(http.calls).toEqual(cli.http.calls);
            expect(mcpOps).toEqual(aliasOps);
          }
        });
      }

      it(`${commandName(def)}: an unknown field is INVALID_INPUT through both doors, before any request`, async () => {
        const example = def.examples[0] as Record<string, unknown>;
        const cli = testContext({ config: suite.fixture.config, routes: suite.fixture.routes, files: suite.fixture.files });
        const { result: viaCli, operations: cliOps } = await recordOperations(() => runCli([...argvFor(def, example), '--not-a-real-flag'], { commands: suite.commands, context: cli.context }));
        const { session, http } = await mcpFor(suite.commands, suite.fixture.config, suite.fixture.routes, suite.fixture.files);
        const { result: viaMcp, operations: mcpOps } = await recordOperations(() => session.call(toolName(def), { ...example, notARealField: true }));

        expect(viaCli.envelope?.error?.code).toBe('INVALID_INPUT');
        expect(viaMcp.envelope?.error?.code).toBe('INVALID_INPUT');
        expect(viaMcp.envelope.meta.command).toBe(viaCli.envelope?.meta.command);
        expect(viaMcp.isError).toBe(true);
        expect([...cli.http.calls, ...http.calls]).toHaveLength(0);
        expect([...cliOps, ...mcpOps]).toHaveLength(0);
      });

      it(`${commandName(def)}: a config error while building the context is the same envelope through both doors`, async () => {
        const broken = () => {
          throw new ToilError('CONFIG_INVALID', '/home/test/.toil/config.json is not valid JSON.', { fix: 'Fix the JSON.' });
        };
        const example = def.examples[0] as Record<string, unknown>;
        const { context } = testContext({ config: suite.fixture.config, routes: suite.fixture.routes, files: suite.fixture.files });
        const viaCli = await runCli(argvFor(def, example), { commands: suite.commands, context, createContext: broken });
        const session = await connectMcp({ commands: suite.commands, context, perCall: broken });
        sessions.push(session);
        const viaMcp = await session.call(toolName(def), example);

        expect(viaCli.envelope?.error?.code).toBe('CONFIG_INVALID');
        expect(comparable(viaMcp.envelope)).toEqual(comparable(viaCli.envelope));
        expect(viaMcp.isError).toBe(true);
      });

      if (def.writes) {
        const area = areaOf(def);
        const example = def.examples[0] as Record<string, unknown>;
        const withoutFlag = { ...example };
        delete withoutFlag.allowWrite;

        it(`${commandName(def)}: hidden from MCP when writes are off for ${area}`, async () => {
          const { session } = await mcpFor(suite.commands, withoutWrites(suite.fixture.config, area), suite.fixture.routes, suite.fixture.files);
          expect((await session.client.listTools()).tools.map((t) => t.name)).not.toContain(toolName(def));
        });

        it(`${commandName(def)}: WRITE_DISABLED on the CLI when writes are off, before any request`, async () => {
          const { context, http } = testContext({ config: withoutWrites(suite.fixture.config, area), routes: suite.fixture.routes, files: suite.fixture.files });
          const { result: run, operations } = await recordOperations(() => runCli(argvFor(def, example), { commands: suite.commands, context }));
          expect(run.envelope?.error?.code).toBe('WRITE_DISABLED');
          expect(run.exitCode).toBe(1);
          expect(http.calls).toHaveLength(0);
          expect(operations).toHaveLength(0);
        });

        it(`${commandName(def)}: refused without allowWrite through both doors, even with writes on`, async () => {
          const cli = testContext({ config: suite.fixture.config, routes: suite.fixture.routes, files: suite.fixture.files });
          const { result: viaCli, operations: cliOps } = await recordOperations(() => runCli(argvFor(def, withoutFlag), { commands: suite.commands, context: cli.context }));
          const { session, http } = await mcpFor(suite.commands, suite.fixture.config, suite.fixture.routes, suite.fixture.files);
          const { result: viaMcp, operations: mcpOps } = await recordOperations(() => session.call(toolName(def), withoutFlag));

          expect(viaCli.envelope?.error?.code).toBe('WRITE_DISABLED');
          expect(comparable(viaMcp.envelope)).toEqual(comparable(viaCli.envelope));
          expect(viaMcp.isError).toBe(true);
          expect([...cli.http.calls, ...http.calls]).toHaveLength(0);
          expect([...cliOps, ...mcpOps]).toHaveLength(0);
        });
      }
    }
  });
}

describe('area commands kept off MCP, on the CLI', () => {
  for (const f of fixtures) {
    for (const def of f.commands.filter((d) => isCliOnly(d) === false && !servedOverMcp(d))) {
      it(`${commandName(def)}: every example succeeds on the CLI`, async () => {
        for (const example of def.examples as Array<Record<string, unknown>>) {
          const { context } = testContext({ config: f.config, routes: f.routes, files: f.files });
          const run = await runCli(argvFor(def, example), { commands: f.commands, context });
          expect(run.envelope?.ok, run.stdout + run.stderr).toBe(true);
          expect(run.exitCode).toBe(0);
        }
      });
      if (def.writes) {
        it(`${commandName(def)}: WRITE_DISABLED on the CLI without writes on or without --allow-write, before any request`, async () => {
          const example = def.examples[0] as Record<string, unknown>;
          const withoutFlag = { ...example };
          delete withoutFlag.allowWrite;
          for (const [config, input] of [[withoutWrites(f.config, f.area), example], [f.config, withoutFlag]] as const) {
            const { context, http } = testContext({ config, routes: f.routes, files: f.files });
            const run = await runCli(argvFor(def, input), { commands: f.commands, context });
            expect(run.envelope?.error?.code).toBe('WRITE_DISABLED');
            expect(http.calls).toHaveLength(0);
          }
        });
      }
    }
  }
});

describe('choosing a connection, through both front doors', () => {
  for (const f of fixtures) {
    const served = f.commands.filter(servedOverMcp);
    const def = served.find((d) => !d.writes) ?? served[0]!;
    const example = def.examples[0] as Record<string, unknown>;

    it(`${f.area}: --connection <name> gives the same envelope and requests as MCP's connection field`, async () => {
      const cli = testContext({ config: f.config, routes: f.routes, files: f.files });
      const { result: viaCli, operations: cliOps } = await recordOperations(() => runCli([...argvFor(def, example), '--connection', f.area], { commands: f.commands, context: cli.context }));
      const { session, http } = await mcpFor(f.commands, f.config, f.routes, f.files);
      const { result: viaMcp, operations: mcpOps } = await recordOperations(() => session.call(toolName(def), { ...example, connection: f.area }));

      expect(viaCli.envelope?.ok, viaCli.stdout).toBe(true);
      expect(comparable(viaMcp.envelope)).toEqual(comparable(viaCli.envelope));
      expect(http.calls).toEqual(cli.http.calls);
      expect(mcpOps).toEqual(cliOps);
    });

    it(`${f.area}: an unknown connection is INVALID_INPUT on both sides, before any request`, async () => {
      const cli = testContext({ config: f.config, routes: f.routes, files: f.files });
      const { result: viaCli, operations: cliOps } = await recordOperations(() => runCli([...argvFor(def, example), '--connection', 'no-such-connection'], { commands: f.commands, context: cli.context }));
      const { session, http } = await mcpFor(f.commands, f.config, f.routes, f.files);
      const { result: viaMcp, operations: mcpOps } = await recordOperations(() => session.call(toolName(def), { ...example, connection: 'no-such-connection' }));

      expect(viaCli.envelope?.error?.code).toBe('INVALID_INPUT');
      expect(comparable(viaMcp.envelope)).toEqual(comparable(viaCli.envelope));
      expect([...cli.http.calls, ...http.calls]).toHaveLength(0);
      expect([...cliOps, ...mcpOps]).toHaveLength(0);
    });
  }
});

describe('which tools MCP serves', () => {
  it('without --areas: configured areas plus commands that need no connection, never an unconfigured service', async () => {
    const all = [...commands, ...demoCommands];
    const bare = testContext();
    const s1 = await connectMcp({ commands: all, context: bare.context });
    sessions.push(s1);
    const names = (await s1.client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('version');
    expect(names, 'an area-local command needs no connection, so it is served unconfigured').toContain('jira_schema');
    expect(names).not.toContain('jira_get_issue');
    expect(names).not.toContain('demo_get_thing');

    const configured = testContext({ config: { demo: { token: 't' } } });
    const s2 = await connectMcp({ commands: all, context: configured.context });
    sessions.push(s2);
    expect((await s2.client.listTools()).tools.map((t) => t.name)).toContain('demo_get_thing');
  });

  it('with --areas: exactly the named areas, configured or not', async () => {
    const { context } = testContext();
    const session = await connectMcp({ commands: [...commands, ...demoCommands], context, areas: ['demo'] });
    sessions.push(session);
    expect((await session.client.listTools()).tools.map((t) => t.name)).toEqual(['demo_get_thing', 'demo_status']);
  });
});
