import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyCommand } from './command.js';
import type { Envelope, Warning } from './envelope.js';
import { ToilError } from './errors.js';
import { isSecretParam, redactUrl, type RequestLog } from './http.js';
import type { FrontDoor } from './run.js';

/**
 * The audit log: one JSON line per command toil runs, appended to
 * `~/.toil/audit/<yyyy-mm>.jsonl` by execute(), so no area and no front door
 * can leave a call out. It's the evidence that the defaults held, and it never
 * leaves the machine (principle 9).
 *
 * What it never holds: a secret, a header, a body, a row. Input values go
 * through the same name rule `--verbose` uses for query parameters, every URL
 * in them through `redactUrl`, and every string through a shape check for
 * tokens, so a credential pasted into the wrong field is still caught.
 * A command marks fields it can't afford to keep (`auditInput`): `drop`
 * leaves the field out, `hash` keeps only its SHA-256, which is how `db`
 * records which SQL ran without recording the SQL.
 *
 * Retention is by month, and the switch to turn it off lives only in the
 * user's own `~/.toil/config.json`: no flag, no env var, no MCP field, and not
 * a `--config` file, since an agent can name one of those. The log is kept
 * whether or not anyone reads it, in keeping with records-management policy.
 */

/** How the audit log is set up, from `"audit"` in `~/.toil/config.json`. */
export interface AuditSettings {
  enabled: boolean;
  /** Whole months kept, this one included. Older files are deleted as new lines are written. */
  keepMonths: number;
}

export const DEFAULT_AUDIT: AuditSettings = { enabled: true, keepMonths: 6 };

/** One line of the log. */
export interface AuditEntry {
  /** When the command started, ISO 8601 in UTC. */
  time: string;
  via: FrontDoor;
  command: string;
  /** The area the command belongs to; null for core commands (`connections list`). */
  area: string | null;
  /** The connection the call resolved, as far as resolution got; null when none. */
  connection: string | null;
  /** Whether this call writes: every call of a write command, or the ones its input makes write. */
  writes: boolean;
  allowWrite: boolean;
  /** `ok`, or the error code. */
  outcome: string;
  durationMs: number;
  /** The input as the caller sent it, redacted; null when it was too large to record. */
  input: unknown;
  /** Every request the command made: method, redacted URL, status. Never a header or body. */
  requests: Array<{ method: string; url: string; status: number | null }>;
  /** Present when there were more requests than a line keeps. */
  requestsOmitted?: number;
  /** Present when the line was too long for one write, so input and requests were left out to fit. */
  truncated?: true;
}

/** Where the log lives and how it's set; the one view of it commands get, through `ctx.manage.audit`. */
export interface AuditLog {
  /** The folder of monthly files. */
  dir: string;
  settings: AuditSettings;
  /** The config file the settings are read from (`~/.toil/config.json`). */
  configFile: string;
  /** Appends one line. Throws when it can't; execute() turns that into a warning. A no-op while the log is off. */
  append(entry: AuditEntry): void;
  /** Every line from `since`'s month on, oldest first, plus how many lines couldn't be read. */
  read(since?: Date): { entries: AuditEntry[]; unreadable: number };
}

const MONTH_FILE = /^(\d{4})-(\d{2})\.jsonl$/;
const MAX_STRING = 500;
const MAX_ITEMS = 50;
const MAX_DEPTH = 6;
const MAX_REQUESTS = 100;
/** Small enough to go to disk in one write, which is what keeps two writers' lines apart. */
const MAX_LINE = 64 * 1024;

/**
 * Tokens recognisable by their shape, wherever they appear. Each match is
 * replaced; the scheme word of an Authorization-style value is kept.
 */
const TOKEN_SHAPES: RegExp[] = [
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bsq[uap]_[A-Za-z0-9]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bATATT[A-Za-z0-9_=-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];
const AUTH_VALUE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/**
 * Anything else long and random-looking: 24 or more letters, digits, `_`,
 * `+` or `=` in a row, with both a letter and a digit. `/`, `-` and `.` end a
 * run, so URL paths and hyphenated ids stay readable; a base64 token split by
 * a `/` still loses every long piece. A hex run of exactly 40 or 64 is a
 * commit or a digest and stays; every other hex run goes, since some tokens
 * are hex too.
 */
const LONG_RUN = /[A-Za-z0-9_+=]{24,}/g;
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

/** A string with every URL redacted as `--verbose` redacts one, and every token-shaped run replaced. */
export function redactText(text: string): string {
  let out = text.replace(URL_IN_TEXT, (url) => redactUrl(url));
  for (const shape of TOKEN_SHAPES) out = out.replace(shape, '[redacted]');
  out = out.replace(AUTH_VALUE, (_, scheme: string) => `${scheme} [redacted]`);
  out = out.replace(PAIR, (whole, quote: string, name: string, sep: string, value: string) => {
    if (!secretField(name) || /^["']?\[redacted/.test(value)) return whole;
    const q = value[0] === '"' || value[0] === "'" ? value[0] : '';
    return `${quote}${name}${quote}${sep}${q}[redacted]${q}`;
  });
  out = out.replace(USER_FLAG, (_, flag: string, user: string) => `${flag}${user}:[redacted]`);
  return out.replace(LONG_RUN, (run) => {
    if (!/[A-Za-z]/.test(run) || !/\d/.test(run)) return run;
    if (/^[0-9a-f]+$/i.test(run) && (run.length === 40 || run.length === 64)) return run;
    return '[redacted]';
  });
}

/**
 * Names the audit log treats as sensitive beyond `--verbose`'s rule, compared
 * lowercased with `-`, `_` and `.` removed: anything with authorization,
 * passphrase, cookie, session, credential or private in it, and `auth` or
 * `pat` alone or at the end (`basicAuth`, `gitlabPat`). `author` stays.
 */
const SENSITIVE_PART = /authorization|passphrase|cookie|session|credential|private/;
const SENSITIVE_END = /(?:auth|pat)$/;

/**
 * Whether a name says its value is a secret: `--verbose`'s rule for query
 * parameters plus the names above, except a bare `key`, which in toil's
 * inputs is an issue, space or project key. A real key passed there is still
 * caught by its shape.
 */
function secretField(name: string): boolean {
  const n = name.toLowerCase().replace(/[-_.\s]/g, '');
  if (n === 'key') return false;
  return isSecretParam(name) || SENSITIVE_PART.test(n) || SENSITIVE_END.test(n);
}

/** A name's value is replaced only when it could hold a secret: text, or something holding text. A flag such as `private: true` stays. */
const hidesValue = (name: string, value: unknown) => secretField(name) && (typeof value === 'string' ? value !== '' : value !== null && typeof value === 'object');

/**
 * `password=hunter2`, `Password: "x"`, `Authorization: Bearer abc`, and JSON
 * pasted as text (`{"password":"hunter2"}`, `{'token': 'abc'}`): the name
 * and its quotes stay, the value goes, keeping a quoted value quoted.
 */
const PAIR = /(["']?)([A-Za-z_][\w.-]*)\1(\s*[=:]\s*)((?:(?:Bearer|Basic|Token)\s+)?(?:"[^"]*"|'[^']*'|[^\s;&,"'}\]]+))/g;
/** `curl -u admin:hunter2`, `-uadmin:hunter2`, `--user admin:hunter2`, `--user=admin:hunter2`. */
const USER_FLAG = /((?:^|\s)(?:-u\s*|--user[=\s]+))([^\s:]+):\S+/g;
const cut = (text: string) => (text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text);

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return cut(redactText(value));
  }
  if (value === null || typeof value !== 'object') return typeof value === 'bigint' ? String(value) : value;
  if (depth >= MAX_DEPTH) return '[nested too deep]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => redactValue(v, depth + 1));
    if (value.length > MAX_ITEMS) items.push(`[${value.length - MAX_ITEMS} more]`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(value)) out[name] = hidesValue(name, v) ? '[redacted]' : redactValue(v, depth + 1);
  return out;
}

/** The input as the log keeps it: the command's `auditInput` applied, then every value redacted. */
export function auditInput(def: AnyCommand, input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return redactValue(input, 0);
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input)) {
    const rule = def.auditInput?.[name];
    if (rule === 'drop') continue;
    if (rule === 'hash' && value !== undefined) {
      out[name] = `sha256:${createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')}`;
      continue;
    }
    out[name] = hidesValue(name, value) ? '[redacted]' : redactValue(value, 1);
  }
  return out;
}

/** The line execute() writes for one finished command. */
export function auditEntry(o: { def: AnyCommand; input: unknown; via: FrontDoor; writes: boolean; requests: readonly RequestLog[]; envelope: Envelope; now?: Date }): AuditEntry {
  const now = o.now ?? new Date();
  const { envelope } = o;
  const requests = o.requests.slice(0, MAX_REQUESTS).map((r) => ({ method: r.method, url: cut(redactText(r.url)), status: r.status }));
  const raw = o.input !== null && typeof o.input === 'object' ? (o.input as Record<string, unknown>) : {};
  return {
    time: new Date(now.getTime() - envelope.meta.durationMs).toISOString(),
    via: o.via,
    command: envelope.meta.command,
    area: o.def.area?.name ?? null,
    connection: envelope.meta.context?.connection?.value ?? null,
    writes: o.writes,
    allowWrite: raw.allowWrite === true,
    outcome: envelope.ok ? 'ok' : envelope.error.code,
    durationMs: envelope.meta.durationMs,
    input: auditInput(o.def, o.input),
    requests,
    ...(o.requests.length > MAX_REQUESTS ? { requestsOmitted: o.requests.length - MAX_REQUESTS } : {}),
  };
}

/** One entry as one line, newline included, never longer than a single write keeps whole. */
export function auditLine(entry: AuditEntry): string {
  const line = `${JSON.stringify(entry)}\n`;
  if (Buffer.byteLength(line) <= MAX_LINE) return line;
  // Too long for one write: keep who, what and how it ended, and say what was left out.
  const omitted = entry.requests.length + (entry.requestsOmitted ?? 0);
  const trimmed: AuditEntry = { ...entry, command: cut(entry.command), connection: entry.connection && cut(entry.connection), outcome: cut(entry.outcome), input: null, requests: [], truncated: true };
  if (omitted > 0) trimmed.requestsOmitted = omitted;
  else delete trimmed.requestsOmitted;
  return `${JSON.stringify(trimmed)}\n`;
}

/** Parses one line back, or undefined for a line that isn't an entry (a crash halfway through a write). */
export function parseAuditLine(line: string): AuditEntry | undefined {
  try {
    const entry = JSON.parse(line) as unknown;
    return entry !== null && typeof entry === 'object' && typeof (entry as AuditEntry).time === 'string' && typeof (entry as AuditEntry).command === 'string' ? (entry as AuditEntry) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `"audit"` in a config file: `{ "enabled": false }` turns the log off,
 * `"keepMonths"` sets how many months it keeps. Anything else is refused,
 * so a typo can't read as having switched it off.
 */
export function parseAuditSettings(raw: unknown, path: string): AuditSettings {
  const fix = `Make it look like "audit": { "enabled": true, "keepMonths": ${DEFAULT_AUDIT.keepMonths} }, or remove "audit" from ${path}.`;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ToilError('CONFIG_INVALID', `"audit" in ${path} must be an object.`, { fix });
  const settings = { ...DEFAULT_AUDIT };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'enabled') {
      if (typeof value !== 'boolean') throw new ToilError('CONFIG_INVALID', `"audit.enabled" in ${path} must be true or false, found ${JSON.stringify(value)}.`, { fix });
      settings.enabled = value;
    } else if (key === 'keepMonths') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 120) {
        throw new ToilError('CONFIG_INVALID', `"audit.keepMonths" in ${path} must be a whole number of months from 1 to 120, found ${JSON.stringify(value)}.`, { fix });
      }
      settings.keepMonths = value;
    } else {
      throw new ToilError('CONFIG_INVALID', `"audit.${key}" in ${path} isn't an audit setting.`, { fix });
    }
  }
  return settings;
}

/**
 * The settings from `~/.toil/config.json` alone. A missing file, or one that
 * can't be read, leaves the log on with the defaults: whatever is wrong with
 * the file, the command that reads it properly says so, and failing toward
 * recording is the safe direction.
 */
export function readAuditSettings(configFile: string): AuditSettings {
  try {
    if (!existsSync(configFile)) return { ...DEFAULT_AUDIT };
    const raw = JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;
    return raw && typeof raw === 'object' && raw.audit !== undefined ? parseAuditSettings(raw.audit, configFile) : { ...DEFAULT_AUDIT };
  } catch {
    return { ...DEFAULT_AUDIT };
  }
}

const monthOf = (date: Date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
const fileFor = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}.jsonl`;
const monthOfFile = (name: string) => {
  const m = MONTH_FILE.exec(name);
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : undefined;
};

/** The monthly files in `dir`, oldest first, with each one's month number. */
function monthFiles(dir: string): Array<{ name: string; month: number }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((name) => {
      const month = monthOfFile(name);
      return month === undefined ? [] : [{ name, month }];
    })
    .sort((a, b) => a.month - b.month);
}

/**
 * The log on disk, under `<home>/.toil/audit/`. Each line goes in with one
 * write to a file opened for append, which every platform turns into an
 * atomic append to the end (O_APPEND on macOS and Linux, append-only access
 * on Windows), so a CLI call and `toil mcp` writing at once never interleave.
 * Files and folder are readable by the user only where the platform has
 * POSIX modes, as the config file is.
 */
export function fileAuditLog(o: { home: string; now?: () => Date }): AuditLog {
  const configFile = join(o.home, '.toil', 'config.json');
  const dir = join(o.home, '.toil', 'audit');
  const settings = readAuditSettings(configFile);
  const now = o.now ?? (() => new Date());
  return {
    dir,
    settings,
    configFile,
    append(entry) {
      if (!settings.enabled) return;
      const at = now();
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const bytes = Buffer.from(auditLine(entry));
      const fd = openSync(join(dir, fileFor(at)), 'a', 0o600);
      try {
        const written = writeSync(fd, bytes);
        if (written !== bytes.length) throw new Error(`only ${written} of ${bytes.length} bytes were written`);
      } finally {
        closeSync(fd);
      }
      // Retention, applied as the log grows: everything older than keepMonths goes.
      const oldest = monthOf(at) - settings.keepMonths + 1;
      for (const file of monthFiles(dir)) {
        if (file.month >= oldest) continue;
        try {
          unlinkSync(join(dir, file.name));
        } catch (err) {
          // Another toil pruned it first.
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
      }
    },
    read(since) {
      const entries: AuditEntry[] = [];
      let unreadable = 0;
      const from = since ? monthOf(since) : -Infinity;
      for (const file of monthFiles(dir)) {
        if (file.month < from) continue;
        let text: string;
        try {
          text = readFileSync(join(dir, file.name), 'utf8');
        } catch (err) {
          // Pruned between listing and reading.
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw err;
        }
        for (const line of text.split(/\r?\n/)) {
          if (line.trim() === '') continue;
          const entry = parseAuditLine(line);
          if (entry) entries.push(entry);
          else unreadable++;
        }
      }
      return { entries, unreadable };
    },
  };
}

/**
 * Writes the call's line, called once by execute() for every command it
 * runs. A log that can't be written never fails the command (principle 4):
 * the envelope gets an `AUDIT_WRITE_FAILED` warning saying so instead.
 */
export function recordAudit(log: AuditLog | undefined, o: Omit<Parameters<typeof auditEntry>[0], 'now'>): Envelope {
  if (!log) return o.envelope;
  try {
    log.append(auditEntry(o));
  } catch (err) {
    const warning: Warning = {
      code: 'AUDIT_WRITE_FAILED',
      message: `toil couldn't add this call to its audit log in ${log.dir.replace(/\\/g, '/')}: ${(err as Error).message}. The command itself ran as reported. Check that the folder is writable.`,
    };
    o.envelope.meta.warnings = [...(o.envelope.meta.warnings ?? []), warning];
  }
  return o.envelope;
}
