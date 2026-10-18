import type { Warning } from '../../../core/envelope.js';
import { ToilError } from '../../../core/errors.js';
import type { UtilInput } from '../kit/input.js';
import { XmlSyntaxError, XmlTokenizer, localName, type XmlEvent } from '../kit/xml.js';

/**
 * What every report reader shares: the output shapes, the skipped-element
 * tally, the XML pass, and the stack-trace helpers. Each format's reader is
 * its own module and returns one of the three summaries below; the
 * dispatcher (`summarise.ts`) adds the format, the tally and `verified`.
 * Five formats, one cover sheet, which is the usual ratio.
 */

export type { ReportFormat } from '../report.js';

/** The longest message kept, and the longest single stack line. */
export const MAX_MESSAGE = 1000;
const MAX_STACK_LINE = 500;
/** How many lines of a stack trace a failure keeps. */
export const STACK_LINES = 15;
/** The most failure text collected while streaming; the trimmed stack needs far less. */
export const MAX_CAPTURE = 64 * 1024;

export interface TestTotals {
  tests: number;
  passed: number;
  failures: number;
  errors: number;
  skipped: number;
  /** Passed after a rerun that first failed (Surefire's flakyFailure / flakyError). Counted in `passed` too. */
  flaky: number;
  /** TRX outcomes that are none of the above (Inconclusive, Warning, PassedButRunAborted…). Always 0 for JUnit. */
  other: number;
}

export interface TestFailure {
  /** The enclosing test suite's name; for TRX, the test's class. */
  suite: string | null;
  name: string;
  className: string | null;
  kind: 'failure' | 'error';
  /** The exception or assertion type, where the report gives one. */
  type: string | null;
  message: string | null;
  file: string | null;
  line: number | null;
  /** Where `file` and `line` came from: the report's own attributes, the first matching stack frame, or nowhere. */
  location: 'report' | 'stack' | null;
  /** The first lines of the stack trace, trimmed. */
  stack: string | null;
  /** How many lines the whole trace had, so a trimmed one says so. */
  stackLines: number;
}

export interface TestsSummary {
  suites: number;
  totals: TestTotals;
  failures: TestFailure[];
}

export interface Finding {
  tool: string | null;
  rule: string | null;
  level: string;
  /** SARIF's `kind`: `fail` unless the result says otherwise. */
  kind: string;
  file: string | null;
  line: number | null;
  message: string | null;
  suppressed: boolean;
}

export interface FindingsSummary {
  runs: Array<{ tool: string | null; version: string | null; results: number }>;
  total: number;
  byLevel: Record<string, number>;
  results: Finding[];
}

export interface Ratio {
  covered: number;
  total: number;
  /** covered / total as a percentage, rounded to two places; null when there is nothing to cover. */
  percent: number | null;
}

export interface FileCoverage {
  file: string;
  lines: Ratio;
  /** Null when the report states no branch data for the file. */
  branches: Ratio | null;
}

export interface CoverageSummary {
  /** Cobertura's `<source>` folders, which its file names are relative to. Empty for lcov. */
  sources: string[];
  totals: { lines: Ratio; branches: Ratio | null };
  files: FileCoverage[];
  /** The files with the lowest line coverage, lowest first (files with no lines left out). */
  lowest: FileCoverage[];
}

export interface SkippedElement {
  element: string;
  count: number;
  reason: string;
}

/** Elements (or lcov records) a reader met and didn't read, counted by name and reason. */
export class Skips {
  private readonly tally = new Map<string, SkippedElement>();

  add(element: string, reason: string): void {
    const key = `${element}\u0000${reason}`;
    const found = this.tally.get(key);
    if (found) found.count++;
    else this.tally.set(key, { element, count: 1, reason });
  }

  get count(): number {
    let n = 0;
    for (const s of this.tally.values()) n += s.count;
    return n;
  }

  list(): SkippedElement[] {
    return [...this.tally.values()];
  }
}

export interface ReaderContext {
  warn: (warning: Warning) => void;
}

/** A label (`the file "x"`) at the start of a sentence. */
export const capital = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export const ratio = (covered: number, total: number): Ratio => ({ covered, total, percent: total === 0 ? null : Math.round((covered / total) * 10000) / 100 });

/** An attribute as a whole number, or undefined when it's absent or isn't one. */
export function intAttr(value: string | undefined): number | undefined {
  if (value === undefined || !/^\s*\d+\s*$/.test(value)) return undefined;
  return Number(value);
}

/**
 * Runs `input` through the kit's streaming XML reader, one chunk at a time.
 * Malformed XML is INVALID_INPUT with the line and column. A read stopped at
 * the size cap isn't ended, so a cut-off document yields what came before
 * the cut rather than a syntax error; the reader has already warned
 * INPUT_TRUNCATED, and `input.complete` fails.
 */
export async function streamXml(input: UtilInput, format: string, onEvent: (event: XmlEvent) => void): Promise<void> {
  const decoder = new TextDecoder('utf-8');
  const tokenizer = new XmlTokenizer(onEvent);
  try {
    for await (const chunk of input.chunks()) tokenizer.write(decoder.decode(chunk, { stream: true }));
    tokenizer.write(decoder.decode());
    if (!input.truncated) tokenizer.end();
  } catch (err) {
    if (err instanceof XmlSyntaxError) {
      throw new ToilError('INVALID_INPUT', `${capital(input.label)} is not a well-formed ${format} report: ${err.message}.`, { fix: 'Pass the report as the tool wrote it, whole. A file cut off mid-write is the usual cause.' });
    }
    throw err;
  }
}

/** Throws unless the document's root element is one `format` has. */
export function expectRoot(name: string, roots: readonly string[], format: string, label: string): void {
  if (roots.includes(localName(name))) return;
  throw new ToilError('INVALID_INPUT', `${capital(label)} starts with <${name}>, which is not a ${format} report (expected ${roots.map((r) => `<${r}>`).join(' or ')}).`, {
    fix: 'Check which report this is, and pass --format (format over MCP) with the right one, or leave it out to detect it from the content.',
  });
}

/** Line endings as LF, the whole thing cut to `max` characters. */
function tidy(text: string, max: number): string {
  const one = text.replace(/\r\n?/g, '\n');
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/** A failure's message: the stated one, else the first line of its text. Null when there is neither. */
export function messageOf(stated: string | undefined, text: string): string | null {
  const own = stated?.trim();
  if (own) return tidy(own, MAX_MESSAGE);
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '');
  return first === undefined ? null : tidy(first.trim(), MAX_MESSAGE);
}

/** The first {@link STACK_LINES} non-empty lines of a trace, each cut to 500 characters, and how many there were. */
export function trimStack(text: string): { stack: string | null; stackLines: number } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { stack: null, stackLines: 0 };
  const kept = lines.slice(0, STACK_LINES).map((l) => (l.length > MAX_STACK_LINE ? `${l.slice(0, MAX_STACK_LINE)}…` : l));
  return { stack: kept.join('\n'), stackLines: lines.length };
}

/** Frames from a test framework, an assertion library or a runtime, which say where the failure surfaced but not where the test is. */
const FRAMEWORK = /node_modules|[\\/]internal[\\/]|\bnode:|\b(?:org\.junit|junit\.framework|org\.opentest4j|org\.assertj|org\.hamcrest|java\.base|java\.lang|jdk\.internal|sun\.|Xunit\.|NUnit\.|Microsoft\.VisualStudio\.TestTools|System\.Runtime|System\.Reflection)\b/;

/** File and line in the common stack shapes: .NET, Java, Python, JavaScript and Go (`file.go:88`). */
const FRAME_PATTERNS: RegExp[] = [
  / in (.+?):line (\d+)/,
  /\bat [\w$.<>/]+\(([^():]+\.\w+):(\d+)\)/,
  /File "([^"]+)", line (\d+)/,
  /((?:[A-Za-z]:)?[^\s():"']+\.[A-Za-z]{1,5}):(\d+)(?::\d+)?/,
];

/**
 * Where a failure happened, read from its stack trace: the first frame that
 * names the test's class or method, else the first that isn't a framework
 * or runtime frame, else the first frame at all. An approximation, and the
 * failure says so (`location: "stack"`).
 */
export function locationFromStack(text: string, hints: Array<string | null | undefined>): { file: string; line: number } | null {
  const frames: Array<{ text: string; file: string; line: number }> = [];
  for (const raw of text.split(/\r?\n/)) {
    for (const pattern of FRAME_PATTERNS) {
      const m = pattern.exec(raw);
      if (m) {
        frames.push({ text: raw, file: m[1]!, line: Number(m[2]) });
        break;
      }
    }
  }
  if (frames.length === 0) return null;
  const words = hints.flatMap((h) => (h ? [h, h.split(/[.:/\\]/).at(-1)!] : [])).filter((w) => w.length > 2);
  const pick = frames.find((f) => words.some((w) => f.text.includes(w))) ?? frames.find((f) => !FRAMEWORK.test(f.text)) ?? frames[0]!;
  return { file: pick.file, line: pick.line };
}
