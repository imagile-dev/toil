/**
 * The agent's settings (#251): which adapter, the model, the CLI's path and,
 * for Claude, the endpoint. They live in Toil UI's own data folder
 * (`~/.toil-ui/agent.json`), never in toil's config, and hold no secret: each
 * SDK signs in the way its CLI already does (Claude Code's login or cloud
 * credentials, the Copilot seat, Codex's sign-in). A field this file doesn't
 * know is refused rather than stored, so a key can't end up here by
 * accident. A settings card with no space for a password.
 *
 * Two of them are the person's own words (#283): general instructions, and a
 * custom voice that replaces the theme's while "Themed agent voice" is on.
 * Each is plain text up to MAX_INSTRUCTIONS characters, added to the prompt
 * after the rules, which say they win (prompts.ts). They can't widen what the
 * agent may do: its tools are read-only whatever the prompt says.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { AgentError } from './cli.ts';
import { MAX_INSTRUCTIONS } from './prompts.ts';
import type { AdapterName, Endpoint } from './runtime.ts';

export interface AgentSettings {
  adapter: AdapterName | 'none';
  /** The model name the SDK takes, or null for the CLI's default. */
  model: string | null;
  /** The CLI's absolute path, or null to find it on PATH. */
  cliPath: string | null;
  /** Claude only: which endpoint Claude Code uses. Null is the CLI's own default. */
  endpoint: Endpoint | null;
  /** The person's general instructions for every answer, or null. */
  instructions: string | null;
  /** A voice of the person's own, used instead of the theme's while the voice is on, or null. */
  voice: string | null;
  /**
   * Each adapter's own model and CLI path (#344), for a chat switched to it or
   * an assignment run on it. `model` and `cliPath` above are the chosen
   * adapter's, kept in step with its entry here; a file from before has only those.
   */
  models: Partial<Record<AdapterName, string>>;
  cliPaths: Partial<Record<AdapterName, string>>;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { adapter: 'none', model: null, cliPath: null, endpoint: null, instructions: null, voice: null, models: {}, cliPaths: {} };
export const ADAPTERS: readonly AgentSettings['adapter'][] = ['none', 'claude', 'copilot', 'codex'];
export const ENDPOINTS: readonly Endpoint[] = ['anthropic', 'bedrock', 'foundry', 'vertex'];
const FIELDS = new Set(['adapter', 'model', 'cliPath', 'endpoint', 'instructions', 'voice', 'models', 'cliPaths']);
const NAMES: readonly AdapterName[] = ['claude', 'copilot', 'codex'];
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
      'They hold the adapter, model, CLI path, endpoint, instructions, voice, and each adapter\'s model and CLI path only. Keys and tokens never go here: each SDK signs in the way its own CLI does.',
    );
  }
  const adapter = o.adapter ?? 'none';
  if (!ADAPTERS.includes(adapter as AgentSettings['adapter'])) throw new AgentError(`There is no adapter ${JSON.stringify(adapter)}.`, `Choose one of ${ADAPTERS.join(', ')}.`);
  const model = checkModel(o.model);
  const cliPath = checkCliPath(o.cliPath, adapter as AgentSettings['adapter'], isAbsolute, platform);
  const models = perAdapter(o.models, 'models', (v) => checkModel(v));
  const cliPaths = perAdapter(o.cliPaths, 'cliPaths', (v, name) => checkCliPath(v, name, isAbsolute, platform));
  // The chosen adapter's model and path are its entries too: what the page sends for it wins.
  if (adapter !== 'none') {
    const name = adapter as AdapterName;
    if (model === null) delete models[name];
    else models[name] = model;
    if (cliPath === null) delete cliPaths[name];
    else cliPaths[name] = cliPath;
  }
  const endpoint = blank(o.endpoint) ? null : (o.endpoint as Endpoint);
  if (endpoint !== null && !ENDPOINTS.includes(endpoint)) throw new AgentError(`There is no endpoint ${JSON.stringify(endpoint)}.`, `Choose one of ${ENDPOINTS.join(', ')}, or none for Claude Code's default.`);
  if (endpoint !== null && adapter !== 'claude') throw new AgentError('Only the Claude adapter takes an endpoint.', "Copilot and Codex use their CLI's own endpoint; clear the endpoint.");
  return { adapter: adapter as AgentSettings['adapter'], model, cliPath, endpoint, instructions: words(o.instructions, 'instructions'), voice: words(o.voice, 'voice'), models, cliPaths };
}

/** The model an adapter runs with (#344): its own from Settings, or null for its CLI's default. */
export const modelOf = (s: Pick<AgentSettings, 'adapter' | 'model' | 'models'>, name: AdapterName): string | null => (s.adapter === name ? s.model : (s.models[name] ?? null));
/** The CLI path an adapter starts (#344): its own from Settings, or null to search PATH. */
export const cliPathOf = (s: Pick<AgentSettings, 'adapter' | 'cliPath' | 'cliPaths'>, name: AdapterName): string | null => (s.adapter === name ? s.cliPath : (s.cliPaths[name] ?? null));

function checkModel(value: unknown): string | null {
  const model = blank(value) ? null : String(value).trim();
  if (model !== null && !MODEL.test(model)) throw new AgentError(`${JSON.stringify(model)} isn't a model name.`, 'Use the name the SDK takes, such as sonnet or gpt-5, or leave it empty for the CLI\'s default.');
  return model;
}

/** One adapter's CLI path: absolute, on a local drive on Windows, and naming that adapter's own CLI. */
function checkCliPath(value: unknown, adapter: AgentSettings['adapter'], isAbsolute: (p: string) => boolean, platform: NodeJS.Platform): string | null {
  const cliPath = blank(value) ? null : String(value).trim();
  if (cliPath === null) return null;
  if (!isAbsolute(cliPath) || /[\0\r\n]/.test(cliPath)) throw new AgentError(`The CLI path must be an absolute path, not ${JSON.stringify(cliPath)}.`, 'Set the full path to the CLI, or leave it empty to use the one on PATH.');
  // On Windows a path that starts with two slashes is a share on another
  // machine, or a device path, and only looking for the file there makes
  // Windows connect to that host. The CLI must be on a local drive.
  if (platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(cliPath)) {
    throw new AgentError(
      `The CLI path must be on a local drive, such as C:\\Users\\you\\bin\\claude.exe, not ${JSON.stringify(cliPath)}.`,
      'Set the full path to the CLI on this machine, or leave it empty to use the one on PATH. Network paths (\\\\host\\share) and device paths (\\\\?\\) are not accepted.',
    );
  }
  // The path must name the adapter's own CLI, so Settings can't point the agent's arguments at some other program.
  if (adapter === 'none') throw new AgentError('A CLI path needs an adapter to belong to.', 'Choose Claude, Copilot or Codex, or clear the CLI path.');
  const command = COMMANDS[adapter];
  const path = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  const base = path.basename(cliPath);
  const names = platform === 'win32' ? [command, `${command}.exe`] : [command];
  if (!names.includes(platform === 'win32' ? base.toLowerCase() : base)) {
    throw new AgentError(`The CLI path must end in ${names.join(' or ')}, the ${adapter} adapter's own CLI, not ${JSON.stringify(base)}.`, `Point it at the ${command} executable, or clear it to use the one on PATH.`);
  }
  return cliPath;
}

/** A per-adapter map (`models`, `cliPaths`, #344): adapter names only, each value checked, blanks dropped. */
function perAdapter(value: unknown, field: 'models' | 'cliPaths', check: (v: unknown, name: AdapterName) => string | null): Partial<Record<AdapterName, string>> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new AgentError(`${field} must be an object of adapter to value.`, `Send { "claude": …, "copilot": …, "codex": … }, or leave ${field} out.`);
  const out: Partial<Record<AdapterName, string>> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!NAMES.includes(k as AdapterName)) throw new AgentError(`${field} has no adapter ${JSON.stringify(k)}.`, `Its keys are ${NAMES.join(', ')}.`);
    const checked = check(v, k as AdapterName);
    if (checked !== null) out[k as AdapterName] = checked;
  }
  return out;
}

/**
 * Control and invisible format characters (zero-width spaces, bidi overrides),
 * other than a tab or a line break. In a prompt they could hide text from the
 * person reading it back under Show the full prompt.
 */
const HIDDEN = /(?![\t\n])[\p{Cc}\p{Cf}]/u;

/** The person's own text: null when blank, else plain text of at most MAX_INSTRUCTIONS characters. */
function words(value: unknown, field: 'instructions' | 'voice'): string | null {
  if (blank(value)) return null;
  const what = field === 'instructions' ? 'The general instructions' : 'The custom voice';
  if (typeof value !== 'string') throw new AgentError(`${what} must be text.`, 'Type it in Settings, Agent, or leave the box empty.');
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (text.length > MAX_INSTRUCTIONS) throw new AgentError(`${what} must be at most ${MAX_INSTRUCTIONS} characters, and is ${text.length}.`, `Shorten it to ${MAX_INSTRUCTIONS} characters or fewer.`);
  if (HIDDEN.test(text)) throw new AgentError(`${what} must be plain text, and holds a control or invisible character.`, 'Use letters, punctuation, line breaks and tabs, and retype any text pasted from elsewhere.');
  return text;
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
