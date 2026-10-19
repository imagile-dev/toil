/**
 * The Copilot adapter (#251): the GitHub Copilot SDK (`@github/copilot-sdk`,
 * an optional peer dependency) driving the Copilot CLI already on this
 * machine over stdio (`RuntimeConnection.forStdio({ path })`), so the SDK's
 * bundled runtime is never started. It signs in the way the CLI does (the
 * user's Copilot seat); Toil UI passes no token and stores none.
 *
 * Locked down: the session's tools are Toil UI's read tools and nothing else
 * (`availableTools` names only them, as `custom:<name>`), each marked
 * `skipPermission` because it only reads, and every other permission request
 * is rejected. The system message is replaced with Toil UI's. Options checked
 * against the SDK's types.d.ts at 1.0.16.
 */

import type { Runtime } from './runtime.ts';

interface CopilotSession {
  on(event: string, handler: (e: { data?: Record<string, unknown> }) => void): () => void;
  sendAndWait(options: { prompt: string }, timeout?: number): Promise<{ data?: { content?: string } } | undefined>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}
interface CopilotClient {
  start(): Promise<void>;
  stop(): Promise<Error[]>;
  createSession(config: Record<string, unknown>): Promise<CopilotSession>;
}
interface CopilotSdk {
  CopilotClient: new (options: Record<string, unknown>) => CopilotClient;
  RuntimeConnection: { forStdio(options: { path: string }): unknown };
  defineTool(name: string, config: Record<string, unknown>): unknown;
}

/** How long one question may take before the adapter gives up waiting (Bounds). */
export const COPILOT_TIMEOUT_MS = 10 * 60_000;

export function copilotRuntime(): Runtime {
  return {
    name: 'copilot',
    label: 'GitHub Copilot',
    package: '@github/copilot-sdk',
    command: 'copilot',
    cliLabel: 'the Copilot CLI',
    async run(module, r) {
      const sdk = module as CopilotSdk;
      const client = new sdk.CopilotClient({ connection: sdk.RuntimeConnection.forStdio({ path: r.cli }), workingDirectory: r.workDir, logLevel: 'error' });
      await client.start();
      try {
        const session = await client.createSession({
          ...(r.model ? { model: r.model } : {}),
          systemMessage: { mode: 'replace', content: r.system },
          tools: r.tools.map((t) =>
            sdk.defineTool(t.name, { description: t.description, parameters: t.inputSchema, skipPermission: true, handler: async (args: Record<string, unknown>) => JSON.stringify(await t.run(args ?? {}, r.signal)) }),
          ),
          availableTools: r.tools.map((t) => `custom:${t.name}`),
          streaming: true,
          onPermissionRequest: () => ({ kind: 'reject', feedback: 'Toil UI allows only its own read tools.' }),
        });
        let current = '';
        session.on('assistant.message_start', () => {
          current = '';
        });
        session.on('assistant.message_delta', (e) => {
          current += String(e.data?.deltaContent ?? '');
          r.onText(current);
        });
        const abort = () => void session.abort();
        r.signal.addEventListener('abort', abort, { once: true });
        try {
          const reply = await session.sendAndWait({ prompt: r.prompt }, COPILOT_TIMEOUT_MS);
          return reply?.data?.content ?? current;
        } finally {
          r.signal.removeEventListener('abort', abort);
          await session.disconnect().catch(() => undefined);
        }
      } finally {
        await client.stop().catch(() => undefined);
      }
    },
  };
}
