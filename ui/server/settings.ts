/**
 * The server's settings (#206: settings, not constants). The bind address,
 * port, base path and data folder each come from a flag, else an env var,
 * else the default, and each is checked before anything listens. v1 is local
 * only, so a bind address that isn't loopback is refused with a fix rather
 * than quietly accepted: the setting exists so server mode (#207) is a
 * decision later, not a search-and-replace. A form with one permitted answer,
 * printed anyway for the audit trail.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as nodePath from 'node:path';

/** The path functions the data folder is resolved with: node:path, or path.win32 / path.posix in the tests. */
export type PathApi = Pick<typeof nodePath, 'isAbsolute' | 'join' | 'resolve'>;

export interface Settings {
  host: string;
  /** 0 asks the OS for a free port. */
  port: number;
  /** Where the app is served, with a slash at each end: `/`, `/toil/`. */
  basePath: string;
  /** Toil UI's own folder (`~/.toil-ui/`), apart from toil's `~/.toil/`. The cache (`cache/`, #250) and the agent's settings (`agent.json`, #251) live here. */
  dataDir: string;
  /** Days the cache keeps what a sync stored after it was last synced (#250). */
  retentionDays: number;
  /** Serve the preview's sample data and scripted Agent instead of toil. */
  sample: boolean;
}

export const DEFAULT_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 3650;

/** v1 binds loopback only (#206, Local first). */
export const LOOPBACK = new Set(['127.0.0.1', '::1']);

export class SettingsError extends Error {
  constructor(message: string, readonly fix: string) {
    super(message);
  }
}

export interface Parsed {
  /** `serve` starts the server; `wipe` deletes the cache and exits. */
  command: 'serve' | 'wipe';
  settings: Settings;
  help: boolean;
  version: boolean;
}

export const USAGE = `Usage: toil-ui [options]
       toil-ui wipe [--data-dir <dir>]

Starts Toil UI on this machine and prints the one URL that opens it.
Alpha, local only: it binds loopback and reads through toil, read-only.
A sync stores what the dashboards show in a cache in the data folder.

Commands:
  wipe                 Delete the cache (everything a sync stored) and exit.

Options:
  --host <address>     Loopback address to bind: 127.0.0.1 (default) or ::1.   Env: TOIL_UI_HOST
  --port <n>           Port; 0 (default) lets the OS pick a free one.          Env: TOIL_UI_PORT
  --base-path <path>   Path the app is served under (default /).                Env: TOIL_UI_BASE_PATH
  --data-dir <dir>     Toil UI's own folder (default ~/.toil-ui).               Env: TOIL_UI_DATA_DIR
  --retention-days <n> Days the cache keeps synced data (default ${DEFAULT_RETENTION_DAYS}).        Env: TOIL_UI_RETENTION_DAYS
  --sample             Serve sample data and the scripted agent, not toil.
  --version            Print the version.
  --help               Print this help.
`;

const FLAGS = new Set(['--host', '--port', '--base-path', '--data-dir', '--retention-days']);

/** Flags first, then env, then the default; anything wrong is a SettingsError with a fix. */
export function parseSettings(argv: readonly string[], env: Record<string, string | undefined>, home: string = homedir(), path: PathApi = nodePath): Parsed {
  const flags: Record<string, string> = {};
  let sample = false;
  let help = false;
  let version = false;
  let command: Parsed['command'] = 'serve';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (i === 0 && arg === 'wipe') {
      command = 'wipe';
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    if (arg === '--sample') sample = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--version') version = true;
    else if (FLAGS.has(name)) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined) throw new SettingsError(`${name} needs a value.`, `Pass it as ${name} <value>; see toil-ui --help.`);
      flags[name] = value;
    } else throw new SettingsError(`toil-ui has no option ${JSON.stringify(arg)}.`, 'See toil-ui --help for the options it takes.');
  }

  const pick = (flag: string, envName: string) => flags[flag] ?? (env[envName] || undefined);

  const host = pick('--host', 'TOIL_UI_HOST') ?? '127.0.0.1';
  if (!LOOPBACK.has(host)) {
    throw new SettingsError(
      `Toil UI binds loopback only in this release, so it won't listen on ${JSON.stringify(host)}.`,
      'Use --host 127.0.0.1 (the default) or ::1, and unset TOIL_UI_HOST if it names another address. Serving other machines is a later release.',
    );
  }

  const portText = pick('--port', 'TOIL_UI_PORT') ?? '0';
  const port = /^\d{1,5}$/.test(portText) ? Number(portText) : NaN;
  if (!(port >= 0 && port <= 65535)) throw new SettingsError(`The port must be a number from 0 to 65535, not ${JSON.stringify(portText)}.`, 'Pass --port 0 to let the OS pick a free one.');

  const rawBase = pick('--base-path', 'TOIL_UI_BASE_PATH') ?? '/';
  const trimmed = rawBase.replace(/^\/+|\/+$/g, '');
  if (trimmed && !/^[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(trimmed)) {
    throw new SettingsError(`The base path must be plain path segments, such as /toil/, not ${JSON.stringify(rawBase)}.`, 'Use letters, digits, ".", "_", "~" and "-" between the slashes.');
  }
  if (trimmed.split('/').some((s) => s === '.' || s === '..')) throw new SettingsError(`The base path can't hold "." or ".." segments: ${JSON.stringify(rawBase)}.`, 'Name the path plainly, such as /toil/.');
  const basePath = trimmed ? `/${trimmed}/` : '/';

  const rawData = pick('--data-dir', 'TOIL_UI_DATA_DIR');
  // An env var isn't expanded by a shell, so `~` (alone, or before / or \) means the home folder here too.
  const tilde = rawData && /^~(?=$|[\\/])/.test(rawData) ? path.join(home, rawData.slice(1)) : rawData;
  const dataDir = tilde ? (path.isAbsolute(tilde) ? tilde : path.resolve(tilde)) : path.join(home, '.toil-ui');

  const retentionText = pick('--retention-days', 'TOIL_UI_RETENTION_DAYS') ?? String(DEFAULT_RETENTION_DAYS);
  const retentionDays = /^\d{1,4}$/.test(retentionText) ? Number(retentionText) : NaN;
  if (!(retentionDays >= 1 && retentionDays <= MAX_RETENTION_DAYS)) {
    throw new SettingsError(`The retention must be a whole number of days from 1 to ${MAX_RETENTION_DAYS}, not ${JSON.stringify(retentionText)}.`, `Pass --retention-days ${DEFAULT_RETENTION_DAYS} (the default), or run toil-ui wipe to delete the cache now.`);
  }
  if (command === 'wipe' && (sample || flags['--host'] || flags['--port'] || flags['--base-path'])) {
    throw new SettingsError('toil-ui wipe takes only --data-dir.', 'Run toil-ui wipe, or toil-ui wipe --data-dir <dir> for another data folder.');
  }

  return { command, settings: { host, port, basePath, dataDir, retentionDays, sample }, help, version };
}

/**
 * Themes from the user's own folder were removed (#283): only the built-in
 * themes exist. A `themes/` folder left in the data folder by an earlier
 * alpha is never read; this is the plain notice the bin prints once per
 * start while it's there, and the folder is left for the person to delete.
 */
export function themesNotice(dataDir: string, exists: (path: string) => boolean = existsSync, path: Pick<typeof nodePath, 'join'> = nodePath): string | null {
  const dir = path.join(dataDir, 'themes');
  if (!exists(dir)) return null;
  return `Note: Toil UI no longer reads themes from ${dir}; only its built-in themes are offered. The folder is left as it is, and you can delete it. To ask for a new theme, send a feature request from the Feedback button or with toil feedback feature.`;
}
