/**
 * The Codex adapter (#251): the Codex SDK (`@openai/codex-sdk`, an optional
 * peer dependency) running the `codex` CLI already on this machine
 * (`codexPathOverride`), so the copy the SDK's own dependency brings is never
 * started. It signs in the way the CLI does (a ChatGPT plan or the CLI's own
 * API key setup); Toil UI passes no key.
 *
 * Codex takes tools only from MCP servers, so Toil UI serves the dossier's
 * read tools for the length of one run on its own loopback server
 * (`api/agent/mcp`, server.ts), behind a bearer token made for the run. The
 * token reaches Codex in its environment (`bearer_token_env_var`), never on
 * its command line, where any process could read it. The `mcp_servers` table
 * is replaced whole, so no MCP server from the user's Codex config comes
 * along; the shell, apps, plugins, sub-agents, browser and web search are
 * switched off, and the sandbox is read-only with approvals never asked.
 * Options checked against the SDK's index.d.ts at 0.160.0; the feature names
 * against `codex features list` from codex-cli 0.156.0.
 */

import type { Runtime } from './runtime.ts';

interface CodexThread {
  runStreamed(input: string, options?: { signal?: AbortSignal }): Promise<{ events: AsyncIterable<Record<string, unknown>> }>;
}
interface CodexSdk {
  Codex: new (options: Record<string, unknown>) => { startThread(options: Record<string, unknown>): CodexThread };
}

/** The variable the run's MCP bearer token is in. */
export const TOKEN_ENV = 'TOIL_UI_MCP_TOKEN';

/** Codex features that could reach past Toil UI's read tools; each is switched off for the run. */
export const CODEX_FEATURES_OFF = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'multi_agent', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation', 'memories'];

/** A TOML basic string. */
const toml = (s: string) => JSON.stringify(s);

/** The `--config` overrides for one run. */
export function codexOverrides(url: string): string[] {
  return [`mcp_servers={ toil_ui = { url = ${toml(url)}, bearer_token_env_var = ${toml(TOKEN_ENV)} } }`, ...CODEX_FEATURES_OFF.map((f) => `features.${f}=false`)];
}

export function codexRuntime(): Runtime {
  return {
    name: 'codex',
    label: 'Codex',
    package: '@openai/codex-sdk',
    command: 'codex',
    cliLabel: 'the Codex CLI',
    async run(module, r) {
      const sdk = module as CodexSdk;
      const served = r.serveTools(r.tools);
      try {
        const env = Object.fromEntries(Object.entries({ ...r.env, [TOKEN_ENV]: served.token }).filter((e): e is [string, string] => typeof e[1] === 'string'));
        const codex = new sdk.Codex({ codexPathOverride: r.cli, env, configOverrides: codexOverrides(served.url) });
        const thread = codex.startThread({
          ...(r.model ? { model: r.model } : {}),
          sandboxMode: 'read-only',
          approvalPolicy: 'never',
          workingDirectory: r.workDir,
          skipGitRepoCheck: true,
          networkAccessEnabled: false,
          webSearchMode: 'disabled',
        });
        // Codex has no separate system prompt in the SDK, so Toil UI's goes first in the turn.
        const { events } = await thread.runStreamed(`${r.system}\n\nQuestion:\n${r.prompt}`, { signal: r.signal });
        let last = '';
        for await (const e of events) {
          if (e.type === 'item.updated' || e.type === 'item.completed') {
            const item = e.item as { type?: string; text?: string };
            if (item.type === 'agent_message' && typeof item.text === 'string') {
              last = item.text;
              r.onText(last);
            }
          } else if (e.type === 'turn.failed') {
            throw new Error(`Codex stopped without an answer: ${(e.error as { message?: string } | undefined)?.message ?? 'no message'}.`);
          } else if (e.type === 'error') {
            throw new Error(`Codex failed: ${String(e.message ?? 'no message')}.`);
          }
        }
        return last;
      } finally {
        served.close();
      }
    },
  };
}
