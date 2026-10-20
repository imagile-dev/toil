import type { ErrorCode } from '../core/errors.js';

/**
 * `toil audit stats`' arithmetic (#309): the audit log's lines, grouped by
 * the fields a line already holds, counted. Pure functions of the lines and
 * the registry, so the command, the tests and Toil UI's panel all see one
 * set of sums.
 *
 * It reports only what a line holds, and never groups by an input's value,
 * so a hashed SQL statement stays a hash and nothing a call was given turns
 * into a heading. The figures never leave the machine (principle 9); a
 * quarterly utilisation review was proposed and is still awaiting a cost
 * centre.
 */

/**
 * The fields of an audit line (`AuditLine` in src/core/audit.ts) a summary
 * reads. Spelt out here rather than imported, so Toil UI can use this file
 * without type-checking the whole of core.
 */
export interface AuditLine {
  time: string;
  via: string;
  caller?: string;
  command: string;
  area: string | null;
  connection: string | null;
  writes: boolean;
  outcome: string;
  durationMs: number;
}

/** The fields a summary can group by: each is a field of the audit line, except `day`, the UTC date of `time`. */
export const DIMENSIONS = ['command', 'area', 'connection', 'caller', 'via', 'outcome', 'day'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** One error code's share of a group's failures, with what usually fixes it. */
export interface ErrorCount {
  code: string;
  count: number;
  /** The code's general fix. The log keeps the code only, never the call's own message or fix; null for a code toil has no general fix for. */
  fix: string | null;
}

/** The figures for one group of calls, or for all of them. */
export interface UsageFigures {
  calls: number;
  ok: number;
  failed: number;
  /** The most frequent error codes among the failures, most first: at most three. */
  errors: ErrorCount[];
  /** Nearest-rank median and 95th percentile, in milliseconds. */
  durationMs: { median: number; p95: number };
  /** Calls that wrote, and their share of all calls (0 to 1, to three places). */
  writes: number;
  writeShare: number;
  firstSeen: string;
  lastSeen: string;
}

/** One group: its value for each dimension asked for (null where the line has none), then its figures. */
export type UsageGroup = Partial<Record<Dimension, string | null>> & UsageFigures;

/** A registered command with no call in the window. */
export interface UnusedCommand {
  command: string;
  area: string | null;
  /** Whether MCP serves it. A command MCP never serves can only be run on the CLI. */
  mcp: boolean;
}

/** What `--outcome` takes besides an exact code: any failure. */
export const FAILED = 'failed';

/** The filters, as `toil audit stats` and `toil audit list` apply them. `since` inclusive, `until` exclusive. */
export interface UsageFilter {
  since?: Date;
  until?: Date;
  area?: string;
  /** A command, or an area or group to match every command under it. */
  command?: string;
  connection?: string;
  caller?: string;
  /** `ok`, `failed` for any failure, or one error code. */
  outcome?: string;
  writesOnly?: boolean;
}

/** Whether a command name is `name`, or under it (`jira` covers `jira issue get`). */
export const commandMatches = (command: string, name: string) => command === name || command.startsWith(`${name} `);

export function matchesFilter(e: AuditLine, f: UsageFilter): boolean {
  const time = Date.parse(e.time);
  return (
    (f.since === undefined || time >= f.since.getTime()) &&
    (f.until === undefined || time < f.until.getTime()) &&
    (f.area === undefined || e.area === f.area) &&
    (f.command === undefined || commandMatches(e.command, f.command)) &&
    (f.connection === undefined || e.connection === f.connection) &&
    (f.caller === undefined || e.caller === f.caller) &&
    (f.outcome === undefined || (f.outcome === FAILED ? e.outcome !== 'ok' : e.outcome === f.outcome)) &&
    (f.writesOnly !== true || e.writes === true)
  );
}

/**
 * Each error code's general fix. A line keeps the code and nothing the error
 * said, since a message can quote a server's response; so the fix shown is
 * the one that usually applies to the code, never the call's own.
 */
const FIXES: Record<ErrorCode, string> = {
  INVALID_INPUT: 'Check the arguments against toil <command> --help; the call was refused before anything ran.',
  NOT_CONFIGURED: 'Add the connection or setting the command needs (toil connections add), or set its env var.',
  CONFIG_INVALID: 'Fix the config file the error named; toil connections list shows which file is read.',
  AUTH: "Replace the connection's credential with toil connections login <name>, then check it with toil connections test <name>.",
  NOT_FOUND: 'Check the id, key or path the call named, and that the connection can see it.',
  HTTP: "The service refused the request. Run the call again to read the service's own message.",
  NETWORK: "Check the host is reachable from this machine and the proxy settings, with toil connections test <name>.",
  WRITE_DISABLED: 'A write needs writes: true on the connection, set by a person, and --allow-write on the call.',
  TIMEOUT: 'Narrow the call (a smaller page, a tighter filter), or raise TOIL_TIMEOUT_MS.',
  CANCELLED: 'The call was cancelled by the person or the client; nothing to fix unless that was unintended.',
  DATABASE: "The database refused the statement. Run it again to read the database's own message.",
  CREDENTIAL_STORE: "Check the OS credential store is available, or set the secret's env var instead.",
  UNSUPPORTED_NODE: 'Install Node 24.14 or later.',
  GIT_NOT_FOUND: 'Install git 2.24 or later and put it on PATH.',
  UNSUPPORTED: "The server's release doesn't have the API the command needs; check the area's supported versions.",
  INTERNAL: 'This is a bug in toil. Report it with toil feedback bug, naming the command.',
};

export const fixFor = (code: string): string | null => (Object.hasOwn(FIXES, code) ? FIXES[code as ErrorCode] : null);

/** The value of one dimension on one line. */
export function valueOf(e: AuditLine, d: Dimension): string | null {
  if (d === 'day') return e.time.slice(0, 10);
  const v = e[d];
  return v === undefined || v === null ? null : String(v);
}

/** Nearest-rank percentile of an ascending list. */
const rank = (sorted: number[], q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0;

class Tally {
  calls = 0;
  ok = 0;
  writes = 0;
  first = '';
  last = '';
  readonly durations: number[] = [];
  readonly codes = new Map<string, number>();

  add(e: AuditLine) {
    this.calls++;
    if (e.outcome === 'ok') this.ok++;
    else this.codes.set(e.outcome, (this.codes.get(e.outcome) ?? 0) + 1);
    if (e.writes === true) this.writes++;
    this.durations.push(typeof e.durationMs === 'number' ? e.durationMs : 0);
    if (this.first === '' || e.time < this.first) this.first = e.time;
    if (e.time > this.last) this.last = e.time;
  }

  figures(): UsageFigures {
    const sorted = this.durations.sort((a, b) => a - b);
    const errors = [...this.codes]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 3)
      .map(([code, count]) => ({ code, count, fix: fixFor(code) }));
    return {
      calls: this.calls,
      ok: this.ok,
      failed: this.calls - this.ok,
      errors,
      durationMs: { median: rank(sorted, 0.5), p95: rank(sorted, 0.95) },
      writes: this.writes,
      writeShare: this.calls === 0 ? 0 : Math.round((this.writes / this.calls) * 1000) / 1000,
      firstSeen: this.first,
      lastSeen: this.last,
    };
  }
}

/** Empty figures, for a window with no calls. */
export const emptyFigures = (): UsageFigures => new Tally().figures();

/**
 * Totals, and one group per combination of the dimensions' values that has a
 * call. Groups come most calls first, ties in key order; with `day` first,
 * they come in date order instead, oldest first, so a series reads left to
 * right.
 */
export function summarize(entries: Iterable<AuditLine>, by: readonly Dimension[]): { totals: UsageFigures; groups: UsageGroup[] } {
  const total = new Tally();
  const groups = new Map<string, { key: Array<string | null>; tally: Tally }>();
  for (const e of entries) {
    total.add(e);
    if (by.length === 0) continue;
    const key = by.map((d) => valueOf(e, d));
    const id = JSON.stringify(key);
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { key, tally: new Tally() }));
    g.tally.add(e);
  }
  const keyText = (k: Array<string | null>) => k.map((v) => v ?? '').join('\u0000');
  const rows = [...groups.values()].sort((a, b) =>
    by[0] === 'day' ? (keyText(a.key) < keyText(b.key) ? -1 : 1) : b.tally.calls - a.tally.calls || (keyText(a.key) < keyText(b.key) ? -1 : 1),
  );
  return {
    totals: total.figures(),
    groups: rows.map(({ key, tally }) => ({ ...Object.fromEntries(by.map((d, i) => [d, key[i]])), ...tally.figures() })),
  };
}

/** The registered commands, among those the filter names, that no matching line calls. */
export function unusedCommands(registered: ReadonlyArray<UnusedCommand>, used: ReadonlySet<string>, f: Pick<UsageFilter, 'area' | 'command'>): UnusedCommand[] {
  return registered
    .filter((c) => (f.area === undefined || c.area === f.area) && (f.command === undefined || commandMatches(c.command, f.command)) && !used.has(c.command))
    .sort((a, b) => (a.command < b.command ? -1 : 1));
}
