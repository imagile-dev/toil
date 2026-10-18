import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyCommand } from './command.js';
import type { Envelope, Warning } from './envelope.js';
import { ToilError } from './errors.js';
import type { RequestLog } from './http.js';
import type { FrontDoor } from './run.js';
import { redactText, secretField } from './secret-shapes.js';

// The rules live in secret-shapes.ts, shared with anything that finds secrets; the log still answers for redactText.
export { redactText };

/**
 * The audit log: one JSON line per command toil runs, appended to
 * `~/.toil/audit/<yyyy-mm>.jsonl` by execute(), so no area and no front door
 * can leave a call out. It's the evidence that the defaults held, and it never
 * leaves the machine (principle 9).
 *
 * What it never holds: a secret, a header, a body, a row. Input values go
 * through the same name rule `--verbose` uses for query parameters, every URL
 * in them through `redactUrl`, and every string through a shape check for
 * tokens (src/core/secret-shapes.ts, toil's one definition of a secret), so a
 * credential pasted into the wrong field is still caught.
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
  /** The front door: `cli`, `mcp`, or `api` for a program calling `execute()` from `@imagile-dev/toil/api`. */
  via: FrontDoor;
  /** Who called through the API, as it named itself (`toil-ui`). Present only when it gave a name. */
  caller?: string;
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

/**
 * What a caller label may be: a short name of lowercase letters, digits, `.`,
 * `_` and `-`, starting with a letter or digit (`toil-ui`, `nightly-sync`).
 * Narrow on purpose: it's a name for a person reading the log, never a place to
 * put a value, so nothing shaped like a token or a path fits.
 */
export const CALLER_LABEL = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const MONTH_FILE = /^(\d{4})-(\d{2})\.jsonl$/;
const MAX_STRING = 500;
const MAX_ITEMS = 50;
const MAX_DEPTH = 6;
const MAX_REQUESTS = 100;
/** Small enough to go to disk in one write, which is what keeps two writers' lines apart. */
const MAX_LINE = 64 * 1024;

/** A name's value is replaced only when it could hold a secret: text, or something holding text. A flag such as `private: true` stays. */
const hidesValue = (name: string, value: unknown) => secretField(name) && (typeof value === 'string' ? value !== '' : value !== null && typeof value === 'object');

/** How much of a string redaction looks at: only there to bound the time, far past what is kept. */
const REDACT_BOUND = 64 * 1024;
/**
 * A string as the log keeps it: bounded to REDACT_BOUND, redacted, and only
 * then cut to MAX_STRING, so a token crossing the cut is recognised whole
 * before any of it is kept. Every pattern is linear, so the bound is cheap.
 */
const clip = (text: string) => cut(redactText(text.length > REDACT_BOUND ? text.slice(0, REDACT_BOUND) : text));
const cut = (text: string) => (text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text);

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return clip(value);
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
export function auditEntry(o: { def: AnyCommand; input: unknown; via: FrontDoor; caller?: string; writes: boolean; requests: readonly RequestLog[]; envelope: Envelope; now?: Date }): AuditEntry {
  const now = o.now ?? new Date();
  const { envelope } = o;
  const requests = o.requests.slice(0, MAX_REQUESTS).map((r) => ({ method: r.method, url: clip(r.url), status: r.status }));
  const raw = o.input !== null && typeof o.input === 'object' ? (o.input as Record<string, unknown>) : {};
  return {
    time: new Date(now.getTime() - envelope.meta.durationMs).toISOString(),
    via: o.via,
    // Checked against CALLER_LABEL by the API before the call ran; clipped anyway, as everything else here is.
    ...(o.caller ? { caller: clip(o.caller) } : {}),
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
