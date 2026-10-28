/**
 * What every importer in this folder hands back, and the few helpers they share.
 * An importer is a pure function from a tool's file text to candidate `db`
 * connections, so each one is tested with no files, no terminal and no config.
 *
 * Secrets are never part of a candidate: there is no field to put one in. An
 * importer that meets a password in a file drops it and says so in `warnings`,
 * which is the one thing it is allowed to do with it. The file's author went to
 * the trouble of encrypting it; we decline to be the one who undoes that.
 */

/** The `db` connection settings an import can fill in. Never a password or a token. */
export interface DbSettings {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  ssl?: boolean;
  auth?: 'sql' | 'windows' | 'nosasl';
  domain?: string;
  /** SQLite: an absolute path. */
  path?: string;
}

/** One connection a tool had, mapped as far as toil's `db` schema allows. */
export interface Candidate {
  /** The name as the tool shows it. */
  label: string;
  /** The folders or server groups it sat in, outermost first. */
  group: string[];
  engine: string;
  settings: DbSettings;
  /** Things worth knowing about this connection: a dropped password, a setting toil can't hold. */
  warnings: string[];
}

/** A connection the importer found and could not map, and why. Never silent (principle 4). */
export interface Skip {
  label: string;
  reason: string;
  /** The folders or server groups it sat in, outermost first. */
  group?: string[];
}

export interface Parsed {
  candidates: Candidate[];
  skipped: Skip[];
  /** About the file as a whole. */
  warnings: string[];
}

/** The file isn't what the format says it is. The command turns this into an INVALID_INPUT with a fix. */
export class ImportFormatError extends Error {}

/** Most connections one import will consider; a file with more is cut off with a warning, not read to the end of time. */
export const MAX_CONNECTIONS = 1000;

export class Collector {
  readonly candidates: Candidate[] = [];
  readonly skipped: Skip[] = [];
  readonly warnings: string[] = [];

  add(candidate: Candidate): void {
    if (this.candidates.length + this.skipped.length >= MAX_CONNECTIONS) {
      if (!this.warnings.some((w) => w.startsWith('The file has more than'))) this.warnings.push(`The file has more than ${MAX_CONNECTIONS} connections; the rest were not read.`);
      return;
    }
    this.candidates.push(candidate);
  }

  skip(label: string, reason: string, group: string[] = []): void {
    if (this.candidates.length + this.skipped.length >= MAX_CONNECTIONS) return;
    this.skipped.push({ label, reason, ...(group.length > 0 ? { group } : {}) });
  }

  result(): Parsed {
    return { candidates: this.candidates, skipped: this.skipped, warnings: this.warnings };
  }
}

/** The text as a trimmed string, or undefined for anything else or an empty string. */
export function str(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** A TCP port from a number or numeric text; undefined for anything outside 1 to 65535. */
export function port(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d{1,5}\s*$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : undefined;
}

/** Truthiness as tools write it: true, "true", "yes", "1", "on". */
export function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return typeof value === 'string' && /^(true|yes|1|on|y)$/i.test(value.trim());
}

/** Which toil engine a driver, provider or scheme name stands for, or undefined when toil has none. */
export function engineFor(hint: string | undefined): string | undefined {
  const h = (hint ?? '').toLowerCase();
  if (/redshift|greenplum|cockroach/.test(h)) return undefined;
  if (/postgres|pgsql/.test(h)) return 'postgres';
  if (/mariadb|mysql/.test(h)) return 'mysql';
  if (/sqlserver|sql[\s_-]?server|mssql|microsoft|jtds/.test(h)) return 'sqlserver';
  if (/oracle/.test(h)) return 'oracle';
  if (/sqlite/.test(h)) return 'sqlite';
  if (/teradata/.test(h)) return 'teradata';
  if (/impala/.test(h)) return 'impala';
  if (/hive/.test(h)) return 'hive';
  return undefined;
}

export const passwordDropped = (where: string): string => `${where} held a password. toil never imports one: enter it yourself with toil connections login.`;

export const TERADATA_REASON = "is Teradata, which toil reaches through the Query Service (a base URL and a system alias), settings a desktop tool's JDBC connection doesn't hold";

/** Own-property read, so a key named `__proto__` in hostile JSON is just a key. */
export function own(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null && Object.hasOwn(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;
}

/** A plain object's own entries, or none for anything else. */
export function entries(obj: unknown): Array<[string, unknown]> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj) ? Object.entries(obj) : [];
}
