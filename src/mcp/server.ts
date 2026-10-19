import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { fileURLToPath } from 'node:url';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  RootsListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { areaOf, commandName, servedOverMcp, takesAllowWrite, toolName, usesConnection, type AnyCommand } from '../core/command.js';
import { anyWrites, hasConfig, type ResolvedConfig } from '../core/config.js';
import type { Context } from '../core/context.js';
import { ToilError } from '../core/errors.js';
import { shownToPeople, type ProgressEvent } from '../core/progress.js';
import { SELECT_DESCRIPTION, SELECT_FIELD } from '../core/query/select.js';
import { runCommand } from '../core/run.js';
import { waitable } from '../core/wait.js';
import { listResources, listTemplates, readResource, ResourceError, type ResourceHost } from './resources.js';

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
 * config, area-local such as `jira issue schema`), or one marked `connectionOptional`,
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
  // A command with no connection (version, connections list, jira issue schema), or
  // one that answers for an unconfigured area itself, needs no area set up.
  const inScope = (def: AnyCommand) => (areas ? areas.includes(areaOf(def)) : !usesConnection(def) || def.connectionOptional === true || hasConfig(config, areaOf(def)));
  const tools = commands.filter((def) => !def.dispatches && servedOverMcp(def) && inScope(def) && (!def.writes || anyWrites(config, areaOf(def))));
  // `wait` repeats one of these tools, so it's served whenever one of them is a read it can repeat, --areas or not.
  const canWait = tools.some((def) => waitable(def) && !def.writes);
  return [...tools, ...(canWait ? commands.filter((def) => def.dispatches && servedOverMcp(def)) : [])];
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
  /** `progress`, when the client asked for progress, hears the call's progress events, to send as notifications. */
  context: (def?: AnyCommand, signal?: AbortSignal, roots?: readonly string[], progress?: (event: ProgressEvent) => void) => Context;
  areas?: string[] | undefined;
}): Server {
  const startup = options.context();
  const selected = selectCommands(options.commands, options.areas, startup.config);
  const byName = new Map(selected.map((def) => [toolName(def), def]));
  const server = new Server({ name: 'toil', version: startup.version }, { capabilities: { tools: {}, resources: {} } });

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
      annotations: { readOnlyHint: !takesAllowWrite(def), openWorldHint: true },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const def = byName.get(request.params.name);
    if (!def) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    const shared = await clientRoots();
    // A client that sent a progress token hears after every attempt of a wait,
    // which keeps a short tool-call timeout from ending it, and of every page
    // read and 429 retried (src/core/progress.ts), the same events the CLI writes
    // to stderr. `progress` only ever goes up, as the protocol requires.
    const token = request.params._meta?.progressToken;
    let sent = 0;
    const notify = (message: string) => {
      sent++;
      void extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token!, progress: sent, message } }).catch(() => {});
    };
    const progress = token === undefined ? undefined : (p: { attempt: number; message: string }) => notify(p.message);
    const events = token === undefined ? undefined : (event: ProgressEvent) => (shownToPeople(event) ? notify(event.message) : undefined);
    const envelope = await runCommand(def, request.params.arguments ?? {}, (d) => options.context(d, extra.signal, shared, events), startup.version, 'mcp', {
      targets: selected,
      ...(progress ? { progress } : {}),
    });
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
      structuredContent: envelope as unknown as Record<string, unknown>,
      isError: !envelope.ok,
    };
  });
  // Resources describe toil's own context (src/mcp/resources.ts): read-only, scoped like the tools, never a secret.
  const host = async (): Promise<ResourceHost> => {
    const shared = await clientRoots();
    return { selected, areas: options.areas, context: (def) => options.context(def, undefined, shared), version: startup.version };
  };
  const asMcpError = (err: unknown): never => {
    if (err instanceof ResourceError) throw new McpError(err.notFound ? ErrorCode.InvalidParams : ErrorCode.InternalError, err.message);
    if (err instanceof ToilError) throw new McpError(ErrorCode.InternalError, `${err.message}${err.fix ? ` ${err.fix}` : ''}`);
    throw err;
  };
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: await listResources(await host()).catch(asMcpError) }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: listTemplates(await host()) }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({ contents: [await readResource(await host(), request.params.uri).catch(asMcpError)] }));
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
