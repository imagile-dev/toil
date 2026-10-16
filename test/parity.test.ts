import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { commandName, toolName, type AnyCommand } from '../src/core/command.js';
import type { Envelope } from '../src/core/envelope.js';
import { argvFor } from '../src/program.js';
import { commands } from '../src/registry.js';
import { demoCommands, demoRoutes } from './fixtures/demo-commands.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';
import { connectMcp, type McpSession } from './harness/mcp.js';

/**
 * The CLI and MCP are two front doors onto one core, and this suite is what
 * keeps them 1:1. It walks every registered command (and the demo fixtures,
 * which exercise HTTP and writes), so a new command is covered the moment it is
 * registered, with no test to remember to write.
 */
const suites: Array<{ name: string; commands: AnyCommand[] }> = [
  { name: 'shipped commands', commands },
  { name: 'demo fixture commands', commands: demoCommands },
];

// Writes on and credentials set, so every example can run to completion.
const config = { demo: { token: 'test-token', writes: true } };

const sessions: McpSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

async function mcpFor(list: AnyCommand[], cfg: typeof config | Record<string, never> = config) {
  const { context, http } = testContext({ config: cfg, routes: demoRoutes });
  const session = await connectMcp({ commands: list, context });
  sessions.push(session);
  return { session, http };
}

/** Timing is the only field allowed to differ between two runs of the same call. */
function comparable(envelope: Envelope | undefined): unknown {
  if (!envelope) return envelope;
  return { ...envelope, meta: { ...envelope.meta, durationMs: 0 } };
}

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
      const { session } = await mcpFor(suite.commands);
      const { tools } = await session.client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(suite.commands.map(toolName).sort());
      for (const def of suite.commands) {
        const tool = tools.find((t) => t.name === toolName(def))!;
        const expected = z.toJSONSchema(def.input, { target: 'draft-7' }) as { properties?: object; required?: string[] };
        expect(tool.inputSchema.properties ?? {}, toolName(def)).toEqual(expected.properties ?? {});
        expect([...(tool.inputSchema.required ?? [])].sort(), toolName(def)).toEqual([...(expected.required ?? [])].sort());
        expect(tool.annotations?.readOnlyHint, toolName(def)).toBe(!def.writes);
      }
    });

    for (const def of suite.commands) {
      def.examples.forEach((example, i) => {
        it(`${commandName(def)} example ${i + 1}: CLI and MCP send the same requests and return the same envelope`, async () => {
          const cli = testContext({ config, routes: demoRoutes });
          const viaCli = await runCli(argvFor(def, example), { commands: suite.commands, context: cli.context });

          const { session, http } = await mcpFor(suite.commands);
          const viaMcp = await session.call(toolName(def), example);

          expect(viaCli.envelope?.ok, viaCli.stdout + viaCli.stderr).toBe(true);
          expect(comparable(viaMcp.envelope)).toEqual(comparable(viaCli.envelope));
          expect(JSON.parse(viaMcp.text), 'MCP text and structured content agree').toEqual(viaMcp.envelope);
          expect(viaMcp.isError).toBe(false);
          expect(http.calls, 'same HTTP requests').toEqual(cli.http.calls);
          expect(viaCli.exitCode).toBe(0);
        });
      });
    }
  });
}

describe('write gate, through both front doors', () => {
  const write = demoCommands.find((d) => d.writes)!;
  const example = write.examples[0] as Record<string, unknown>;

  it('hides write tools from MCP when writes are off for the area', async () => {
    const { session } = await mcpFor(demoCommands, { demo: { token: 'test-token' } } as never);
    const { tools } = await session.client.listTools();
    expect(tools.map((t) => t.name)).not.toContain(toolName(write));
  });

  it('refuses a write with WRITE_DISABLED on the CLI when writes are off', async () => {
    const { context, http } = testContext({ config: { demo: { token: 'test-token' } }, routes: demoRoutes });
    const run = await runCli(argvFor(write, example), { commands: demoCommands, context });
    expect(run.envelope?.error?.code).toBe('WRITE_DISABLED');
    expect(run.exitCode).toBe(1);
    expect(http.calls).toHaveLength(0);
  });

  it('refuses a write without allowWrite on both sides, even with writes on', async () => {
    const withoutFlag = { ...example, allowWrite: undefined };
    const cli = testContext({ config, routes: demoRoutes });
    const viaCli = await runCli(argvFor(write, withoutFlag), { commands: demoCommands, context: cli.context });
    const { session, http } = await mcpFor(demoCommands);
    const viaMcp = await session.call(toolName(write), { id: example.id, name: example.name });

    expect(viaCli.envelope?.error?.code).toBe('WRITE_DISABLED');
    expect(comparable(viaMcp.envelope)).toEqual(comparable(viaCli.envelope));
    expect(viaMcp.isError).toBe(true);
    expect([...cli.http.calls, ...http.calls]).toHaveLength(0);
  });
});
