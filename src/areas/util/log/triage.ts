import type { Warning } from '../../../core/envelope.js';
import { ToilError } from '../../../core/errors.js';
// Types only from the input reader: it imports zod, and a module loaded through import() must not
// (docs/util.md, Lazy loading). log.ts opens the input and hands it here.
import type { UtilInput } from '../kit/input.js';
import { Verifier, type Verified } from '../kit/verify.js';

/**
 * The work behind `util log`, loaded only when it runs. One streaming pass
 * classifies every line, groups the error and warning lines by a normalised
 * signature and joins stack traces to the line they belong to; a second pass
 * re-reads every line number it is about to report, which is both the
 * self-check and where the trace and context text comes from. Memory is
 * bounded by the number of groups kept, never by the size of the log: a log
 * is mostly the same complaint, repeated with a different number in it.
 */

export type Level = 'error' | 'warning';
export type TraceKind = 'java' | 'dotnet' | 'node' | 'python' | 'unknown';

export interface LogOptions {
  since?: string | undefined;
  level?: Level | undefined;
  grep?: string | undefined;
  maxGroups?: number | undefined;
  context?: number | undefined;
}

export interface ReportedLine {
  line: number;
  text: string;
}

export interface Trace {
  kind: TraceKind;
  firstLine: number;
  lastLine: number;
  /** Lines in the trace, header and frames. */
  frames: number;
  /** The trace's text, at most {@link MAX_TRACE_LINES} lines. */
  lines: string[];
  /** Set when the trace had more lines than `lines` holds. */
  cut?: true;
}

export interface Group {
  level: Level;
  signature: string;
  count: number;
  firstLine: number;
  lastLine: number;
  /** The first line of the group, as the log has it. */
  sample: string;
  trace?: Trace;
  context?: { before: ReportedLine[]; after: ReportedLine[] };
}

export interface LogTriage {
  lines: { total: number; error: number; warning: number; other: number; stack: number; unclassified: number };
  /** Error and warning lines that passed the filters, every one of them in a group or in `ungrouped`. */
  matched: number;
  /** Error and warning lines left out by `--since`, `--level` or `--grep`. */
  filtered: number;
  /** Distinct groups found. */
  groupsTotal: number;
  /** Whether `groups` holds fewer than `groupsTotal` (`--max-groups`). */
  truncated: boolean;
  /** Matched lines whose signature came after the first {@link MAX_TRACKED} distinct ones: counted, not grouped. */
  ungrouped: number;
  /** Stack-frame lines with no error or warning line to join. */
  unjoinedFrames: number;
  groups: Group[];
  verified: Verified;
}

/** The longest line kept whole for grouping: longer ones are grouped by their start. */
export const MAX_LINE = 4096;
/** Distinct signatures held at once; the cap that keeps memory constant on any log. */
export const MAX_TRACKED = 2000;
export const DEFAULT_GROUPS = 50;
export const MAX_GROUPS = 1000;
export const MAX_TRACE_LINES = 50;
/** Lines with no level that may sit between an error and its trace (vstest prints the message first). */
const MAX_GAP = 8;

// ---------------------------------------------------------------------------
// Lines

const TS = String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?`;
const TIME = String.raw`\d{2}:\d{2}:\d{2}(?:[.,]\d+)?`;
/** A timestamp prefix: bracketed (Jenkins' timestamper) or bare (CI runners, log4j, Serilog). */
const PREFIX = new RegExp(String.raw`^(?:\[(${TS}|${TIME})\] ?|(${TS}|${TIME})\s+)`);
const DATE = /^\d{4}-\d{2}-\d{2}/;

/** Milliseconds since the epoch, and whether the text named no zone (read as UTC). */
export function parseTimestamp(text: string): { ms: number; naive: boolean } | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?)(?:[.,](\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (!m) return undefined;
  const [, day, time = '00:00:00', fraction = '', zone] = m;
  const iso = `${day}T${time.length === 5 ? `${time}:00` : time}${fraction ? `.${fraction.slice(0, 3).padEnd(3, '0')}` : ''}${zone === undefined ? 'Z' : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone}`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : { ms, naive: zone === undefined };
}

/** The line without its timestamp prefix, and the prefix's date when it has one. */
export function stripTimestamp(text: string): { rest: string; stamp?: string } {
  const m = PREFIX.exec(text);
  if (!m) return { rest: text };
  const stamp = m[1] ?? m[2]!;
  return DATE.test(stamp) ? { rest: text.slice(m[0].length), stamp } : { rest: text.slice(m[0].length) };
}

const LEVEL_WORD = /\b(ERROR|FATAL|SEVERE|CRITICAL|WARN|WARNING|INFO|DEBUG|TRACE|NOTICE|VERBOSE|FINE|FINER|FINEST)\b/;
const TOOL_LEVEL = /^(?:npm (ERR!|error|WARN|warn|notice|info|http|verb|timing|sill)|\d+ (error|warn|notice|info|http|verbose|timing|silly)) /;
const EXCEPTION = /^(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:Exception|Error)(?::\s.*)?$/;
const ERROR_SHAPES = [
  EXCEPTION,
  /\bBUILD FAIL(?:URE|ED)\b/,
  /\bFAIL(?:URE|ED)?\b/,
  /^Build FAILED\./,
  /^Unhandled exception\./,
  /^Exception in thread /,
  /^\s*Failed\s+\S+\s+\[\d[\d.,]*\s*m?s\]/,
  /^Failed!\s+-/,
  /(?:^|\s)error(?:\[[^\]]*\])?:\s/,
  /\berror [A-Z]+\d+:/,
  /^\s*\d+:\d+\s+error\s{2,}/,
];
const WARNING_SHAPES = [/(?:^|\s)[Ww]arning(?:\[[^\]]*\])?:\s/, /\bwarning [A-Z]+\d+:/, /^\s*\d+:\d+\s+warning\s{2,}/];
const WORD_LEVEL: Record<string, Level | 'other'> = { ERROR: 'error', FATAL: 'error', SEVERE: 'error', CRITICAL: 'error', WARN: 'warning', WARNING: 'warning' };
const TOOL_WORD: Record<string, Level | 'other'> = { 'ERR!': 'error', error: 'error', WARN: 'warning', warn: 'warning' };

/** Whether a line is only a level tag and punctuation, such as `[ERROR] `. */
const isBare = (rest: string) => rest.replace(/[[\]():!\s-]|\b(?:ERROR|FATAL|SEVERE|CRITICAL|WARN|WARNING|INFO|DEBUG|TRACE|npm|ERR|error|warn)\b/g, '') === '';

/**
 * `error`, `warning`, `other` (a level below warning, or a level tag with
 * nothing after it), or undefined: no level at all. The first level word
 * decides; a line tagged INFO or with no tag can still be an error by its
 * shape (`[INFO] BUILD FAILURE`, `error CS0246:`, `TypeError: …`).
 */
export function classify(rest: string): Level | 'other' | undefined {
  const tool = TOOL_LEVEL.exec(rest);
  const tag = tool ? (tool[1] ?? tool[2]!) : LEVEL_WORD.exec(rest)?.[1];
  const word = tag === undefined ? undefined : ((tool ? TOOL_WORD[tag] : WORD_LEVEL[tag]) ?? 'other');
  if (word === 'error' || word === 'warning') return isBare(rest) ? 'other' : word;
  if (ERROR_SHAPES.some((r) => r.test(rest))) return 'error';
  if (WARNING_SHAPES.some((r) => r.test(rest))) return 'warning';
  return word;
}

const JAVA_FRAME = /^\s+at [\w$./<>-]+ ?\((?:[^()]*\.(?:java|kt|scala|groovy|clj):\d+|Native Method|Unknown Source)\)(?: ~?\[.*\])?\s*$/;
const JAVA_MORE = /^\s*(?:\.\.\. \d+ (?:more|common frames omitted)|(?:Caused by|Suppressed): \S.*)$/;
const NODE_FRAME = /^\s+at (?:async )?(?:.*\()?[^()]*:\d+:\d+\)?\s*$/;
const DOTNET_FRAME = /^\s+at [^\s(]+\(.*\)(?: in .+:line \d+)?\s*$/;
const DOTNET_MORE = /^\s*(?:---> \S|--- End of (?:inner exception )?stack trace)/;
const ANY_FRAME = /^\s+at \S/;

/** The kind of stack frame `rest` is, or undefined for a line that isn't one. */
export function frameKind(rest: string): Exclude<TraceKind, 'python'> | undefined {
  if (JAVA_FRAME.test(rest) || JAVA_MORE.test(rest)) return 'java';
  if (NODE_FRAME.test(rest)) return 'node';
  if (DOTNET_FRAME.test(rest) || DOTNET_MORE.test(rest)) return 'dotnet';
  if (ANY_FRAME.test(rest)) return 'unknown';
  return undefined;
}

const PY_START = /^Traceback \(most recent call last\):\s*$/;

/** Whether a re-read line still reads as part of a trace of `kind`: the self-check on reported traces. */
function isTraceLine(rest: string, kind: TraceKind): boolean {
  if (kind === 'python') return PY_START.test(rest) || /^\s+\S/.test(rest);
  return frameKind(rest) !== undefined || EXCEPTION.test(rest);
}

/**
 * The signature lines are grouped by: the line without its timestamp, with
 * dates and times, UUIDs, hex and every number replaced, and runs of space
 * collapsed. Codes such as CS0246 or TS2322 keep their digits, since the
 * code is what tells two errors apart.
 */
export function signature(rest: string): string {
  return rest
    .replace(new RegExp(TS, 'g'), '<ts>')
    // npm's log file names: 2026-10-14T11_02_44_118Z.
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}(?:_\d+)?Z?/g, '<ts>')
    .replace(new RegExp(String.raw`\b${TIME}\b`, 'g'), '<ts>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\b\d+(?:[.,_]\d+)*\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// The streaming pass

interface Tracked extends Omit<Group, 'trace' | 'context'> {
  trace?: { kind: TraceKind; firstLine: number; lastLine: number; frames: number };
}

interface Anchor {
  /** The group this occurrence belongs to, or null for a line that was filtered out or not grouped. */
  group: Tracked | null;
  /** The anchor line's level. An exception line joins only an error's trace; after a warning it is an error of its own. */
  level: Level;
  /** Whether this is the group's first occurrence, the one whose trace is reported. */
  record: boolean;
  gap: number;
  inTrace: boolean;
  /** Set when `--since` or `--level` dropped the line, so a grep hit in its trace isn't grep's miss. */
  dropped?: true;
}

/** What the streaming pass found, before the re-read. Exported so a test can break it and watch the check catch it. */
export interface Scan {
  lines: LogTriage['lines'];
  matched: number;
  filtered: number;
  ungrouped: number;
  unjoinedFrames: number;
  cutLines: number;
  undated: number;
  /** Stack lines `--grep` matches, to say so when it matched no error or warning line. */
  grepStackHits: number;
  groups: Tracked[];
}

export interface Filters {
  level: Level;
  since?: { ms: number; naive: boolean };
  grep?: RegExp;
}

export function parseFilters(options: LogOptions): Filters {
  const filters: Filters = { level: options.level ?? 'warning' };
  if (options.since !== undefined) {
    const since = parseTimestamp(options.since.trim());
    if (!since) {
      throw new ToilError('INVALID_INPUT', `--since "${options.since}" isn't a timestamp this command reads.`, {
        fix: 'Pass an ISO 8601 date or time, such as 2026-10-14, 2026-10-14T09:12:00Z or "2026-10-14 09:12:00". Without a zone it is read as UTC.',
      });
    }
    filters.since = since;
  }
  if (options.grep !== undefined) {
    try {
      filters.grep = new RegExp(options.grep);
    } catch (err) {
      throw new ToilError('INVALID_INPUT', `--grep isn't a valid regular expression: ${(err as Error).message}`, { fix: 'Pass a JavaScript regular expression, without slashes or flags.' });
    }
  }
  return filters;
}

/** One pass over the input: every line classified, error and warning lines grouped, traces joined. */
export async function scan(input: UtilInput, filters: Filters, v: Verifier): Promise<Scan> {
  const lines = { total: 0, error: 0, warning: 0, other: 0, stack: 0, unclassified: 0 };
  const groups = new Map<string, Tracked>();
  const out = { matched: 0, filtered: 0, ungrouped: 0, unjoinedFrames: 0, cutLines: 0, undated: 0, grepStackHits: 0 };
  let lastDate: { ms: number; naive: boolean } | undefined;
  let naiveCompared = false;
  let anchor: Anchor | undefined;
  let py: { start: number; end: number } | undefined;
  /**
   * An error line `--grep` didn't match, waiting one line: when the exception
   * line that heads its trace matches, the error is kept, since that's where
   * an exception's name usually is. Otherwise it's filtered out.
   */
  let pending: { number: number; text: string; rest: string } | undefined;

  const match = (number: number, text: string, rest: string, level: Level, pyTrace?: { start: number; end: number }) => {
    lines[level]++;
    anchor = undefined;
    const { since, grep } = filters;
    let keep = filters.level === 'warning' || level === 'error';
    if (keep && since) {
      if (lastDate === undefined) out.undated++;
      else {
        if (lastDate.naive || since.naive) naiveCompared = true;
        keep = lastDate.ms >= since.ms;
      }
    }
    const dropped = !keep;
    if (keep && grep && !grep.test(text)) {
      keep = false;
      if (level === 'error' && !pyTrace) pending = { number, text, rest };
    }
    if (!keep) {
      if (!pending) out.filtered++;
      anchor = { group: null, level, record: false, gap: 0, inTrace: false, ...(dropped ? { dropped: true as const } : {}) };
      return;
    }
    admit(number, text, rest, level, pyTrace);
  };

  /** Groups a line that passed the filters. */
  const admit = (number: number, text: string, rest: string, level: Level, pyTrace?: { start: number; end: number }) => {
    out.matched++;
    const sig = signature(rest);
    const key = `${level}\u0000${sig}`;
    let group = groups.get(key);
    let record = false;
    if (!group) {
      if (groups.size >= MAX_TRACKED) {
        out.ungrouped++;
        anchor = { group: null, level, record: false, gap: 0, inTrace: false };
        return;
      }
      group = { level, signature: sig, count: 0, firstLine: number, lastLine: number, sample: text };
      groups.set(key, group);
      record = true;
      if (pyTrace) group.trace = { kind: 'python', firstLine: pyTrace.start, lastLine: pyTrace.end, frames: pyTrace.end - pyTrace.start + 1 };
    }
    group.count++;
    group.lastLine = number;
    if (!pyTrace) anchor = { group, level, record, gap: 0, inTrace: false };
  };

  for await (const line of input.lines()) {
    lines.total++;
    if (line.cut) out.cutLines++;
    const { rest, stamp } = stripTimestamp(line.text);
    if (stamp !== undefined) lastDate = parseTimestamp(stamp) ?? lastDate;

    const grepHit = filters.grep?.test(line.text) ?? false;

    // An error held for --grep: kept if this line heads its trace and matches, else filtered out.
    if (pending) {
      const held = pending;
      pending = undefined;
      if (grepHit && anchor?.gap === 0 && frameKind(rest) === undefined && EXCEPTION.test(rest)) admit(held.number, held.text, held.rest, 'error');
      else out.filtered++;
    }

    // Python prints the trace first and the exception after it.
    if (py) {
      if (/^\s+\S/.test(rest)) {
        if (grepHit) out.grepStackHits++;
        lines.stack++;
        py.end = line.number;
        continue;
      }
      const block = py;
      py = undefined;
      if (rest.trim() !== '') {
        match(line.number, line.text, rest, 'error', block);
        continue;
      }
      // A blank line before any exception: the block's lines stay counted as stack, with nothing to join.
      out.unjoinedFrames += block.end - block.start + 1;
    }
    if (PY_START.test(rest)) {
      if (grepHit) out.grepStackHits++;
      lines.stack++;
      py = { start: line.number, end: line.number };
      anchor = undefined;
      continue;
    }

    const kind = frameKind(rest);
    const header = kind === undefined && anchor?.level === 'error' && (anchor.inTrace || anchor.gap === 0) && EXCEPTION.test(rest);
    if (kind !== undefined || header) {
      // A trace under a line --since or --level dropped isn't grep's miss, so it isn't counted for LOG_GREP_STACK_ONLY.
      if (grepHit && !anchor?.dropped) out.grepStackHits++;
      lines.stack++;
      if (!anchor) {
        out.unjoinedFrames++;
        continue;
      }
      anchor.gap = 0;
      anchor.inTrace = true;
      const { group } = anchor;
      if (anchor.record && group) {
        const known = kind === undefined || kind === 'unknown' ? undefined : kind;
        if (!group.trace) group.trace = { kind: known ?? 'unknown', firstLine: line.number, lastLine: line.number, frames: 1 };
        else {
          group.trace.lastLine = line.number;
          group.trace.frames++;
          if (group.trace.kind === 'unknown' && known) group.trace.kind = known;
        }
      }
      continue;
    }

    const level = classify(rest);
    if (anchor && (anchor.inTrace || level !== undefined || rest.trim() === '' || ++anchor.gap > MAX_GAP)) anchor = undefined;
    if (level === undefined) lines.unclassified++;
    else if (level === 'other') lines.other++;
    else match(line.number, line.text, rest, level);
  }
  if (pending) out.filtered++;
  // A log that ends inside a Python traceback: its lines are counted as stack, with no exception to join.
  if (py) out.unjoinedFrames += py.end - py.start + 1;

  v.inputComplete(input);
  if (filters.since && naiveCompared) v.approximated('since', 'timestamps without a time zone were read as UTC');
  return { lines, ...out, groups: [...groups.values()] };
}

// ---------------------------------------------------------------------------
// The re-read and the report

const byReport = (a: Tracked, b: Tracked) => (a.level === b.level ? a.firstLine - b.firstLine : a.level === 'error' ? -1 : 1);

/**
 * Picks the groups to report, re-reads every line number in them (sample,
 * last line, trace, context) in one more pass, checks each against what the
 * scan recorded, and checks the counts add up.
 */
export async function finish(found: Scan, input: UtilInput, options: LogOptions, v: Verifier, warn: (w: Warning) => void): Promise<LogTriage> {
  const maxGroups = options.maxGroups ?? DEFAULT_GROUPS;
  const context = options.context ?? 0;
  const chosen = [...found.groups].sort(byReport).slice(0, maxGroups);
  const { lines } = found;

  const wanted = new Set<number>();
  for (const g of chosen) {
    wanted.add(g.firstLine);
    wanted.add(g.lastLine);
    if (g.trace) for (let n = g.trace.firstLine; n <= Math.min(g.trace.lastLine, g.trace.firstLine + MAX_TRACE_LINES - 1); n++) wanted.add(n);
    for (let n = Math.max(1, g.firstLine - context); n <= Math.min(lines.total, g.firstLine + context); n++) wanted.add(n);
  }
  const reread = await input.linesAt(wanted);

  const groups: Group[] = chosen.map((g) => {
    const first = reread.get(g.firstLine);
    v.expect('lines.reread', first === g.sample, { at: `line ${g.firstLine}`, expected: g.sample, actual: first }, { code: 'LOG_LINE_MISMATCH' });
    const last = reread.get(g.lastLine);
    const lastSig = last === undefined ? undefined : signature(stripTimestamp(last).rest);
    v.expect('lines.reread', lastSig === g.signature, { at: `line ${g.lastLine}`, expected: g.signature, actual: lastSig }, { code: 'LOG_LINE_MISMATCH' });

    const { trace: t, ...rest } = g;
    const group: Group = { ...rest };
    if (t) {
      const shown = Math.min(t.frames, MAX_TRACE_LINES);
      const text: string[] = [];
      for (let n = t.firstLine; n < t.firstLine + shown; n++) {
        const at = reread.get(n);
        v.expect('trace.reread', at !== undefined && isTraceLine(stripTimestamp(at).rest, t.kind), { at: `line ${n}`, expected: `a ${t.kind} stack trace line`, actual: at }, { code: 'LOG_LINE_MISMATCH' });
        text.push(at ?? '');
      }
      group.trace = { ...t, lines: text, ...(t.frames > shown ? { cut: true as const } : {}) };
    }
    if (context > 0) {
      const around = (from: number, to: number) => {
        const out: ReportedLine[] = [];
        for (let n = from; n <= to; n++) {
          const text = reread.get(n);
          if (text !== undefined) out.push({ line: n, text });
        }
        return out;
      };
      group.context = { before: around(Math.max(1, g.firstLine - context), g.firstLine - 1), after: around(g.firstLine + 1, g.firstLine + context) };
    }
    return group;
  });

  const grouped = found.groups.reduce((sum, g) => sum + g.count, 0);
  v.equal('groups.sum', found.matched, grouped + found.ungrouped, { code: 'LOG_COUNT_MISMATCH', message: `The groups hold ${grouped + found.ungrouped} lines, but ${found.matched} error and warning lines matched.` });
  v.equal('lines.sum', lines.total, lines.error + lines.warning + lines.other + lines.stack + lines.unclassified, {
    code: 'LOG_COUNT_MISMATCH',
    message: `The line classes add up to ${lines.error + lines.warning + lines.other + lines.stack + lines.unclassified}, but the log has ${lines.total} lines.`,
  });
  v.equal('filter.sum', lines.error + lines.warning, found.matched + found.filtered, {
    code: 'LOG_COUNT_MISMATCH',
    message: `${lines.error + lines.warning} error and warning lines were read, but ${found.matched} matched and ${found.filtered} were filtered out.`,
  });
  if (found.cutLines > 0) v.approximated('signatures', `${found.cutLines} lines longer than ${MAX_LINE} characters were grouped by their first ${MAX_LINE}`);

  if (lines.unclassified > 0) {
    warn({ code: 'LOG_UNCLASSIFIED', message: `${lines.unclassified} of ${lines.total} lines carry no level and are in no group. Ask for context (--context, or context over MCP) to see the lines around each group.` });
  }
  if (found.ungrouped > 0) {
    warn({ code: 'LOG_UNGROUPED', message: `${found.ungrouped} matching lines had signatures beyond the first ${MAX_TRACKED} distinct ones, so they were counted but not grouped. Narrow the log with grep, level or since.` });
  }
  if (found.unjoinedFrames > 0) warn({ code: 'LOG_TRACE_UNJOINED', message: `${found.unjoinedFrames} stack trace lines had no error or warning line to join, so they are counted as stack but not reported.` });
  if (found.matched === 0 && found.grepStackHits > 0) {
    warn({ code: 'LOG_GREP_STACK_ONLY', message: `grep matched no error or warning line, but it matches ${found.grepStackHits} stack trace lines. It searches error and warning lines and the exception line that heads an error's trace, not the frames.` });
  }
  if (found.undated > 0) warn({ code: 'LOG_SINCE_UNDATED', message: `${found.undated} error and warning lines had no dated line at or before them, so since couldn't apply and they were kept.` });
  if (chosen.length < found.groups.length) warn({ code: 'LOG_GROUPS_TRUNCATED', message: `Showing ${chosen.length} of ${found.groups.length} groups. Raise --max-groups (maxGroups over MCP, up to ${MAX_GROUPS}) to see more.` });

  return {
    lines,
    matched: found.matched,
    filtered: found.filtered,
    groupsTotal: found.groups.length,
    truncated: chosen.length < found.groups.length,
    ungrouped: found.ungrouped,
    unjoinedFrames: found.unjoinedFrames,
    groups,
    verified: v.done(),
  };
}

/** `util log` on an opened input, start to finish. */
export async function triageLog(input: UtilInput, filters: Filters, options: LogOptions, warn: (w: Warning) => void): Promise<LogTriage> {
  const v = new Verifier(warn);
  const found = await scan(input, filters, v);
  return finish(found, input, options, v, warn);
}
