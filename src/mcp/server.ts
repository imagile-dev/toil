import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { areaOf, commandName, toolName, type AnyCommand } from '../core/command.js';
import { writesEnabled, type ResolvedConfig } from '../core/config.js';
import type { Context } from '../core/context.js';
import { ToilError } from '../core/errors.js';
import { execute } from '../core/run.js';

/**
 * Which commands become tools: those in the requested areas (all areas when
 * none are named), minus write commands whose area hasn't enabled writes. A
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
  return commands.filter((def) => (!areas || areas.includes(areaOf(def))) && (!def.writes || writesEnabled(config, areaOf(def))));
}

/** Builds the MCP server. Each tool runs exactly the code its CLI command runs. */
export function createMcpServer(options: { commands: AnyCommand[]; context: Context; areas?: string[] | undefined }): McpServer {
  const { context } = options;
  const server = new McpServer({ name: 'toil', version: context.version });

  for (const def of selectCommands(options.commands, options.areas, context.config)) {
    server.registerTool(
      toolName(def),
      {
        title: `toil ${commandName(def)}`,
        description: def.toolDescription ?? def.description,
        inputSchema: def.input.shape,
        annotations: { readOnlyHint: !def.writes, openWorldHint: true },
      },
      async (args: Record<string, unknown>) => {
        const envelope = await execute(def, args, context);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
          structuredContent: envelope as unknown as Record<string, unknown>,
          isError: !envelope.ok,
        };
      },
    );
  }
  return server;
}
