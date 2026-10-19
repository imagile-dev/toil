/**
 * The agent's settings (#251): which adapter, the model, the CLI's path and,
 * for Claude, the endpoint. They live in Toil UI's own data folder
 * (`~/.toil-ui/agent.json`), never in toil's config, and hold no secret: each
 * SDK signs in the way its CLI already does (Claude Code's login or cloud
 * credentials, the Copilot seat, Codex's sign-in). A field this file doesn't
 * know is refused rather than stored, so a key can't end up here by
 * accident. A settings card with no space for a password.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { AgentError } from './cli.ts';
import type { AdapterName, Endpoint } from './runtime.ts';

export interface AgentSettings {
  adapter: AdapterName | 'none';
  /** The model name the SDK takes, or null for the CLI's default. */
  model: string | null;
  /** The CLI's absolute path, or null to find it on PATH. */
  cliPath: string | null;
  /** Claude only: which endpoint Claude Code uses. Null is the CLI's own default. */
  endpoint: Endpoint | null;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { adapter: 'none', model: null, cliPath: null, endpoint: null };
export const ADAPTERS: readonly AgentSettings['adapter'][] = ['none', 'claude', 'copilot', 'codex'];
export const ENDPOINTS: readonly Endpoint[] = ['anthropic', 'bedrock', 'foundry', 'vertex'];
const FIELDS = new Set(['adapter', 'model', 'cliPath', 'endpoint']);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,127}$/;

export const agentSettingsFile = (dataDir: string, path: Pick<typeof nodePath, 'join'> = nodePath) => path.join(dataDir, 'agent.json');

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim());

/** Checks a settings object (from the page or the file); throws an AgentError with a fix. */
/** The command each adapter starts: a CLI path set in Settings must name it. */
export const COMMANDS: Record<AdapterName, string> = { claude: 'claude', copilot: 'copilot', codex: 'codex' };

export function checkAgentSettings(input: unknown, isAbsolute: (p: string) => boolean = nodePath.isAbsolute, platform: NodeJS.Platform = process.platform): AgentSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new AgentError('The agent settings must be an object.', 'Send { "adapter", "model", "cliPath", "endpoint" }.');
  const o = input as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !FIELDS.has(k));
  if (extra.length) {
    throw new AgentError(
      `Toil UI's agent settings have no ${extra.map((k) => JSON.stringify(k)).join(', ')}.`,
      'They hold the adapter, model, CLI path and endpoint only. Keys and tokens never go here: each SDK signs in the way its own CLI does.',
    );
  }
  const adapter = o.adapter ?? 'none';
  if (!ADAPTERS.includes(adapter as AgentSettings['adapter'])) throw new AgentError(`There is no adapter ${JSON.stringify(adapter)}.`, `Choose one of ${ADAPTERS.join(', ')}.`);
  const model = blank(o.model) ? null : String(o.model).trim();
  if (model !== null && !MODEL.test(model)) throw new AgentError(`${JSON.stringify(model)} isn't a model name.`, 'Use the name the SDK takes, such as sonnet or gpt-5, or leave it empty for the CLI\'s default.');
  const cliPath = blank(o.cliPath) ? null : String(o.cliPath).trim();
  if (cliPath !== null && (!isAbsolute(cliPath) || /[\0\r\n]/.test(cliPath))) throw new AgentError(`The CLI path must be an absolute path, not ${JSON.stringify(cliPath)}.`, 'Set the full path to the CLI, or leave it empty to use the one on PATH.');
  if (cliPath !== null) {
    // The path must name the adapter's own CLI, so Settings can't point the agent's arguments at some other program.
    if (adapter === 'none') throw new AgentError('A CLI path needs an adapter to belong to.', 'Choose Claude, Copilot or Codex, or clear the CLI path.');
    const command = COMMANDS[adapter as AdapterName];
    const path = platform === 'win32' ? nodePath.win32 : nodePath.posix;
    const base = path.basename(cliPath);
    const names = platform === 'win32' ? [command, `${command}.exe`, `${command}.cmd`] : [command];
    if (!names.includes(platform === 'win32' ? base.toLowerCase() : base)) {
      throw new AgentError(`The CLI path must end in ${names.join(' or ')}, the ${adapter} adapter's own CLI, not ${JSON.stringify(base)}.`, `Point it at the ${command} executable, or clear it to use the one on PATH.`);
    }
  }
  const endpoint = blank(o.endpoint) ? null : (o.endpoint as Endpoint);
  if (endpoint !== null && !ENDPOINTS.includes(endpoint)) throw new AgentError(`There is no endpoint ${JSON.stringify(endpoint)}.`, `Choose one of ${ENDPOINTS.join(', ')}, or none for Claude Code's default.`);
  if (endpoint !== null && adapter !== 'claude') throw new AgentError('Only the Claude adapter takes an endpoint.', "Copilot and Codex use their CLI's own endpoint; clear the endpoint.");
  return { adapter: adapter as AgentSettings['adapter'], model, cliPath, endpoint };
}

/** The saved settings, or the defaults when there are none. A broken file is an AgentError naming it. */
export function loadAgentSettings(dataDir: string): AgentSettings {
  const file = agentSettingsFile(dataDir);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_AGENT_SETTINGS };
    throw new AgentError(`Toil UI couldn't read ${file}: ${(e as Error).message}`, 'Check the file\'s permissions, or delete it to start over.');
  }
  try {
    return checkAgentSettings(JSON.parse(text));
  } catch (e) {
    const why = e instanceof AgentError ? e.message : "it isn't JSON";
    throw new AgentError(`${file} can't be used: ${why}`, 'Choose the agent again in Settings, which rewrites it, or delete the file.');
  }
}

/** Writes the settings, owner-only, through a temporary file so a crash never leaves half of one. */
export function saveAgentSettings(dataDir: string, settings: AgentSettings) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = agentSettingsFile(dataDir);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}
