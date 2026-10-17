import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { areaOf, commandName, toolName, type AnyCommand } from '../core/command.js';
import { hasConfig, writesEnabled, type ResolvedConfig } from '../core/config.js';
import type { Context } from '../core/context.js';
import { ToilError } from '../core/errors.js';
import { runCommand } from '../core/run.js';

/**
 * Which commands become tools. With --areas, exactly the named areas. Without
 * it, the areas the user has configured plus commands that need no
 * configuration, so an agent never sees tools for services nobody set up. In
 * every case, write commands drop out unless their area has writes enabled: a
 * write tool that isn't registered can't be discovered, let alone called.
 */
export function selectCommands(commands: AnyCommand[], areas: string[] | undefined, config: ResolvedConfig): AnyCommand[] {
  if (areas) {
    const known = new Set(commands.map(areaOf));
    const unknown = areas.filter((a) => !known.has(a));
    if (unknown.length > 0) {
      throw new ToilError('INVALID_INPUT', `Unknown area${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`, {
        fix: `Use any of: ${[...known].sort().join(', ')}.`,
      });
    }
  }
  const inScope = (def: AnyCommand) => (areas ? areas.includes(areaOf(def)) : def.standalone === true || hasConfig(config, areaOf(def)));
  return commands.filter((def) => inScope(def) && (!def.writes || writesEnabled(config, areaOf(def))));
}

/**
 * Builds the MCP server. Each tool runs exactly the code its CLI command runs.
 *
 * This uses the SDK's low-level Server rather than McpServer.registerTool on
 * purpose. registerTool validates arguments itself before our handler runs: it
 * silently drops unknown fields, and answers a missing one with a line of text
 * instead of an envelope. The CLI does neither. So we advertise the schema and
 * let execute() be the only validator, which keeps the two front doors 1:1 on
 * bad input as well as good.
 *
 * `context` is a factory, called once with no command to decide which tools
 * to list, and once per tool call with the command (so standalone ones skip
 * config, as on the CLI) and that call's cancellation signal. One context per call is
 * what a shared transport (the planned gateway) needs, and it lets a client's
 * cancel stop the request it belongs to.
 */
export function createMcpServer(options: {
  commands: AnyCommand[];
  context: (def?: AnyCommand, signal?: AbortSignal) => Context;
  areas?: string[] | undefined;
}): Server {
  const startup = options.context();
  const selected = selectCommands(options.commands, options.areas, startup.config);
  const byName = new Map(selected.map((def) => [toolName(def), def]));
  const server = new Server({ name: 'toil', version: startup.version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: selected.map((def) => ({
      name: toolName(def),
      title: `toil ${commandName(def)}`,
      description: def.toolDescription ?? def.description,
      inputSchema: inputSchemaFor(def),
      annotations: { readOnlyHint: !def.writes, openWorldHint: true },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const def = byName.get(request.params.name);
    if (!def) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    const envelope = await runCommand(def, request.params.arguments ?? {}, () => options.context(def, extra.signal), startup.version);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
      structuredContent: envelope as unknown as Record<string, unknown>,
      isError: !envelope.ok,
    };
  });
  return server;
}

/** The JSON Schema an MCP client sees: the command's input, strict, as execute() parses it. */
export function inputSchemaFor(def: AnyCommand): { type: 'object'; [key: string]: unknown } {
  const schema = z.toJSONSchema(def.input.strict(), { target: 'draft-7' }) as Record<string, unknown>;
  delete schema.$schema;
  return { ...schema, type: 'object' };
}
