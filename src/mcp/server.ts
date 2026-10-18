import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { fileURLToPath } from 'node:url';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { areaOf, commandName, servedOverMcp, toolName, usesConnection, type AnyCommand } from '../core/command.js';
import { anyWrites, hasConfig, type ResolvedConfig } from '../core/config.js';
import type { Context } from '../core/context.js';
import { ToilError } from '../core/errors.js';
import { SELECT_DESCRIPTION, SELECT_FIELD } from '../core/query/select.js';
import { runCommand } from '../core/run.js';

/**
 * Which commands become tools. With --areas, exactly the named areas. Without
 * it, the areas the user has configured plus commands that need no
 * configuration, so an agent never sees tools for services nobody set up. In
 * every case, write commands drop out unless at least one of their area's
 * connections has writes enabled: a write tool that isn't registered can't be
 * discovered, let alone called. Listing grants nothing; each call is still
 * gated against the one connection it resolves.
 *
 * A `cli-only` command is never a tool, whatever the flags: it prompts on a
 * terminal, which under MCP is the protocol, or it changes connections, which
 * an agent never does. Nor is an area command marked `mcp: false` (a delete).
 * A command that needs no connection (standalone,
 * config, area-local such as `jira schema`), or one marked `connectionOptional`,
 * is served without --areas whether or not its area is set up. Aliases stay on the CLI: one tool per command.
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
  // A command with no connection (version, connections list, jira schema), or
  // one that answers for an unconfigured area itself, needs no area set up.
  const inScope = (def: AnyCommand) => (areas ? areas.includes(areaOf(def)) : !usesConnection(def) || def.connectionOptional === true || hasConfig(config, areaOf(def)));
  return commands.filter((def) => servedOverMcp(def) && inScope(def) && (!def.writes || anyWrites(config, areaOf(def))));
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
 * to list, and once per tool call with the command (so standalone and
 * area-local ones skip config, as on the CLI) and that call's cancellation signal. One context per call is
 * what a shared transport (the planned gateway) needs, and it lets a client's
 * cancel stop the request it belongs to.
 *
 * The factory also gets the client's roots, as local paths, when the client
 * shares any: with exactly one, that folder is the workspace unless
 * `--workspace` or TOIL_WORKSPACE names another (docs/bounds.md). They're
 * asked for once and asked again only when the client says they changed.
 */
export function createMcpServer(options: {
  commands: AnyCommand[];
  context: (def?: AnyCommand, signal?: AbortSignal, roots?: readonly string[]) => Context;
  areas?: string[] | undefined;
}): Server {
  const startup = options.context();
  const selected = selectCommands(options.commands, options.areas, startup.config);
  const byName = new Map(selected.map((def) => [toolName(def), def]));
  const server = new Server({ name: 'toil', version: startup.version }, { capabilities: { tools: {} } });

  let roots: Promise<string[] | undefined> | undefined;
  server.setNotificationHandler(RootsListChangedNotificationSchema, () => {
    roots = undefined;
  });
  const clientRoots = (): Promise<string[] | undefined> => {
    if (!server.getClientCapabilities()?.roots) return Promise.resolve(undefined);
    roots ??= server
      .listRoots(undefined, { timeout: 5000 })
      .then((r) =>
        // Each root on its own: one URI Node can't turn into a path drops that root, not the rest.
        r.roots.flatMap((root) => {
          if (!root.uri.startsWith('file:')) return [];
          try {
            return [fileURLToPath(root.uri)];
          } catch {
            return [];
          }
        }),
      )
      .catch(() => {
        // Ask again next call; a client that can't answer leaves no workspace, not a stale one.
        roots = undefined;
        return undefined;
      });
    return roots;
  };

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
    const shared = await clientRoots();
    const envelope = await runCommand(def, request.params.arguments ?? {}, () => options.context(def, extra.signal, shared), startup.version, 'mcp');
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
      structuredContent: envelope as unknown as Record<string, unknown>,
      isError: !envelope.ok,
    };
  });
  return server;
}

/**
 * The JSON Schema an MCP client sees: the command's input, strict, as
 * execute() parses it, plus core's `select`, which execute() takes off first.
 */
export function inputSchemaFor(def: AnyCommand): { type: 'object'; [key: string]: unknown } {
  const schema = z.toJSONSchema(def.input.strict(), { target: 'draft-7' }) as Record<string, unknown>;
  delete schema.$schema;
  const properties = { ...(schema.properties as Record<string, unknown> | undefined), [SELECT_FIELD]: { type: 'string', minLength: 1, description: SELECT_DESCRIPTION } };
  return { ...schema, type: 'object', properties };
}
