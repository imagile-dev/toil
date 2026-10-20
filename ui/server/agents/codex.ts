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
 * its command line, where any process could read it. Codex merges a
 * `--config` table into the user's own rather than replacing it, so every MCP
 * server the user's Codex config names (`$CODEX_HOME/config.toml`, else
 * `~/.codex/config.toml`) is switched off by name for the run (#287: on a real
 * machine the user's own servers were started beside Toil UI's). A config
 * whose servers can't be read by name is refused, never guessed at; profiles
 * and plugin servers are #300. The shell, apps, plugins, sub-agents, browser
 * and web search are switched off, and the sandbox is read-only with
 * approvals never asked.
 * Options checked against the SDK's index.d.ts at 0.160.0; the feature names
 * against `codex features list` from codex-cli 0.156.0.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AgentError } from './cli.ts';
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

/** A TOML key: bare when it can be, quoted otherwise. */
const tomlKey = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : toml(k));

/** The `--config` overrides for one run: Toil UI's server, every server of the user's switched off, and the features off. */
export function codexOverrides(url: string, userServers: string[] = []): string[] {
  return [
    `mcp_servers={ toil_ui = { url = ${toml(url)}, bearer_token_env_var = ${toml(TOKEN_ENV)} } }`,
    ...userServers.filter((n) => n !== 'toil_ui').map((n) => `mcp_servers.${tomlKey(n)}.enabled=false`),
    ...CODEX_FEATURES_OFF.map((f) => `features.${f}=false`),
  ];
}

/** Where Codex keeps its config: `CODEX_HOME`, else `.codex` in the home folder. */
export function codexConfigPath(env: Record<string, string | undefined>, platform: NodeJS.Platform = process.platform): string {
  const home = (platform === 'win32' ? (env.USERPROFILE ?? env.HOME) : env.HOME) ?? homedir();
  return join(env.CODEX_HOME ?? join(home, '.codex'), 'config.toml');
}

/** A TOML key that names a server: bare, "basic" or 'literal'. */
const KEY = /^([A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')/;
const unquote = (k: string) => (k.startsWith('"') ? (JSON.parse(k) as string) : k.startsWith("'") ? k.slice(1, -1) : k);

/** The server named right after `mcp_servers.` at the start of `path`, or null. */
function serverIn(path: string): string | null {
  const rest = /^mcp_servers\s*\.\s*(.*)$/.exec(path)?.[1];
  const key = rest === undefined ? null : KEY.exec(rest);
  return key ? unquote(key[1]!) : null;
}

/**
 * The MCP servers a Codex config.toml defines at its top level, by name:
 * `[mcp_servers.<name>]` tables and `mcp_servers.<name>.… =` dotted keys. A
 * form this can't name servers from (`mcp_servers = { … }`) throws, since a
 * server left unnamed would stay on.
 */
export function codexUserServers(text: string, path: string): string[] {
  const names = new Set<string>();
  let table = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[\[?\s*([^\]]*?)\s*\]\]?/.exec(line);
    if (header) {
      table = header[1]!;
      const name = serverIn(table);
      if (name !== null) names.add(name);
      continue;
    }
    // A key line counts only at the top level, or directly under [mcp_servers].
    const key = table === '' ? line : /^mcp_servers$/.test(table) ? `mcp_servers.${line}` : null;
    if (key === null) continue;
    const name = serverIn(key);
    if (name !== null) names.add(name);
    else if (/^mcp_servers\s*=/.test(key)) {
      throw new AgentError(
        `Toil UI can't tell which MCP servers ${path} adds, because it sets mcp_servers as one inline table, so it won't start Codex with them possibly on.`,
        'Write each server in that file as its own [mcp_servers.<name>] table, then ask again; or choose another adapter in Settings.',
      );
    }
  }
  return [...names];
}

/** Reads Codex's config, or null when there is none. */
function readCodexConfig(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new AgentError(`Toil UI couldn't read ${path} to switch off the MCP servers it names: ${(e as Error).message}.`, 'Make the file readable by your account, then ask again; or choose another adapter in Settings.');
  }
}

export interface CodexOptions {
  /** Reads Codex's config.toml: the file on disk, or a stub in the tests. */
  readConfig?: (path: string) => string | null;
  platform?: NodeJS.Platform;
}

export function codexRuntime(o: CodexOptions = {}): Runtime {
  const read = o.readConfig ?? readCodexConfig;
  return {
    name: 'codex',
    label: 'Codex',
    package: '@openai/codex-sdk',
    command: 'codex',
    cliLabel: 'the Codex CLI',
    async run(module, r) {
      const sdk = module as CodexSdk;
      const configPath = codexConfigPath(r.env, o.platform);
      const config = read(configPath);
      const userServers = config === null ? [] : codexUserServers(config, configPath);
      const served = r.serveTools(r.tools);
      try {
        const env = Object.fromEntries(Object.entries({ ...r.env, [TOKEN_ENV]: served.token }).filter((e): e is [string, string] => typeof e[1] === 'string'));
        const codex = new sdk.Codex({ codexPathOverride: r.cli, env, configOverrides: codexOverrides(served.url, userServers) });
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
