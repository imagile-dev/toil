import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AnyCommand } from '../../src/core/command.js';
import type { Context } from '../../src/core/context.js';
import type { Envelope } from '../../src/core/envelope.js';
import { createMcpServer } from '../../src/mcp/server.js';

export interface McpSession {
  client: Client;
  /** Calls a tool and returns the envelope it carried as structured content. */
  call: (name: string, args: Record<string, unknown>) => Promise<{ envelope: Envelope; text: string; isError: boolean }>;
  close: () => Promise<void>;
}

/** Connects a real MCP client to toil's MCP server over an in-memory transport. */
export async function connectMcp(options: { commands: AnyCommand[]; context: Context; areas?: string[] }): Promise<McpSession> {
  // A fresh context per call, as the shipped server does, carrying the call's signal.
  const server = createMcpServer({ ...options, context: (signal) => ({ ...options.context, ...(signal ? { signal } : {}) }) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'toil-tests', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    call: async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as Array<{ type: string; text?: string }>;
      return {
        envelope: result.structuredContent as unknown as Envelope,
        text: content[0]?.text ?? '',
        isError: result.isError === true,
      };
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
