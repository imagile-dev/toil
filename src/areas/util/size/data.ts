import { OutlineError } from './lexer.js';

/**
 * Outlines for documents rather than code: Markdown headings, and the
 * top-level keys of a JSON or YAML document, each with the lines it spans.
 * JSON and YAML keys are found by scanning the text, which is what gives
 * them line numbers, and then held against what the real parser says the
 * document's keys are, so a scan that misread the text fails a check rather
 * than passing unnoticed. Headings have no parser to be held against; their
 * re-read is the command's start-line check. The table of contents is the
 * one part of any document everyone reads.
 */

export interface DataSymbol {
  name: string;
  kind: 'heading' | 'key';
  startLine: number;
  endLine: number;
  /** For a heading: the enclosing heading's text. Null at the top. */
  container: string | null;
  /** For a heading: 1 to 6. */
  level?: number;
  parent?: number;
}

/** The last line of `lines` at or before `end` (1-based) that holds something other than blanks and, for YAML, comments. */
function trimBack(lines: string[], from: number, end: number, comments: boolean): number {
  let at = end;
  while (at > from) {
    const text = lines[at - 1]!.trim();
    if (text !== '' && !(comments && text.startsWith('#'))) break;
    at--;
  }
  return at;
}

const splitLines = (text: string) => {
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines.length > 0 && lines[lines.length - 1] === '' && text.endsWith('\n')) lines.pop();
  return lines;
};

/**
 * Markdown headings: ATX (`# Title`, up to three spaces in) and setext
 * (a line underlined with `===` or `---`), outside fenced code blocks and
 * front matter. Each runs to the line before the next heading of the same
 * or a higher level.
 */
export function outlineMarkdown(text: string): DataSymbol[] {
  const lines = splitLines(text);
  const found: { name: string; level: number; line: number }[] = [];
  let fence: { char: string; length: number } | null = null;
  let start = 0;
  // YAML front matter: a first line of ---, closed by --- or ...
  if (lines[0] === '---') {
    const close = lines.findIndex((l, n) => n > 0 && (l === '---' || l === '...'));
    if (close > 0) start = close + 1;
  }
  for (let n = start; n < lines.length; n++) {
    const line = lines[n]!;
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1]![0] === fence.char && fenceMatch[1]!.length >= fence.length && line.trim() === fenceMatch[1]) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1]![0]!, length: fenceMatch[1]!.length };
      continue;
    }
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (atx) {
      const title = (atx[2] ?? '').replace(/(?:^|[ \t]+)#+$/, '').trim();
      found.push({ name: title, level: atx[1]!.length, line: n + 1 });
      continue;
    }
    const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
    const previous = lines[n - 1];
    if (setext && n > start && previous !== undefined && paragraphLine(previous)) {
      // The line above can't be the fence that just closed.
      if (!/^ {0,3}(`{3,}|~{3,})/.test(previous)) found.push({ name: previous.trim(), level: setext[1]![0] === '=' ? 1 : 2, line: n });
    }
  }
  if (fence) throw new OutlineError(`a fenced code block opened with ${fence.char.repeat(fence.length)} is never closed`);
  const out: DataSymbol[] = [];
  const stack: number[] = [];
  found.forEach((h, k) => {
    const next = found.slice(k + 1).find((o) => o.level <= h.level);
    const end = next ? next.line - 1 : lines.length;
    while (stack.length && out[stack[stack.length - 1]!]!.level! >= h.level) stack.pop();
    const parent = stack[stack.length - 1];
    out.push({ name: h.name, kind: 'heading', level: h.level, startLine: h.line, endLine: Math.max(h.line, trimBack(lines, h.line, end, false)), container: parent === undefined ? null : out[parent]!.name, ...(parent === undefined ? {} : { parent }) });
    stack.push(out.length - 1);
  });
  return out;
}

/** A line that can be the text of a setext heading: not blank, and not a list item, quote, table row, heading or HTML block. */
function paragraphLine(line: string): boolean {
  if (line.trim() === '') return false;
  if (/^ {4,}/.test(line)) return false;
  return !/^ {0,3}([-*+]\s|\d+[.)]\s|>|\||#{1,6}(\s|$)|<|(=+|-+)\s*$)/.test(line);
}

/** What a scan found: each top-level key as written (decoded), its line, and the line its value ends on. */
interface ScannedKey {
  name: string;
  startLine: number;
  endLine: number;
}

/**
 * The top-level keys of a JSON object, with the lines they span. The text
 * has already been parsed with JSON.parse, so it is valid JSON; this scan
 * only finds where each key sits. Not an object: no keys.
 */
export function scanJsonKeys(text: string): ScannedKey[] {
  let i = 0;
  let line = 1;
  const ws = () => {
    while (i < text.length && /[ \t\r\n\ufeff]/.test(text[i]!)) {
      if (text[i] === '\n') line++;
      i++;
    }
  };
  const string = (): string => {
    const start = i;
    i++;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  /** Skips one value, counting the lines it spans. */
  const value = () => {
    let depth = 0;
    do {
      ws();
      const c = text[i]!;
      if (c === '"') string();
      else if (c === '{' || c === '[') {
        depth++;
        i++;
      } else if (c === '}' || c === ']') {
        depth--;
        i++;
      } else if (c === ',' || c === ':') i++;
      else while (i < text.length && !/[\s,\]}:]/.test(text[i]!)) i++;
    } while (depth > 0 && i < text.length);
  };
  ws();
  if (text[i] !== '{') return [];
  i++;
  const keys: ScannedKey[] = [];
  for (;;) {
    ws();
    if (text[i] === '}' || i >= text.length) return keys;
    if (text[i] === ',') {
      i++;
      continue;
    }
    const startLine = line;
    const name = string();
    ws();
    i++; // the colon
    value();
    keys.push({ name, startLine, endLine: line });
  }
}

/**
 * The top-level keys of a YAML mapping as written: lines at column 0 that
 * are a key (plain, or quoted) followed by a colon. Each spans to the line
 * before the next, less trailing blanks and comments. A merge key (`<<`) is
 * listed as written.
 */
export function scanYamlKeys(text: string): ScannedKey[] {
  const lines = splitLines(text);
  const found: { name: string; line: number }[] = [];
  let documentStarted = false;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!;
    if (line === '' || /^[ \t]/.test(line) || line.startsWith('#') || line.startsWith('%')) continue;
    if (/^---(\s|$)/.test(line)) {
      if (documentStarted || found.length) break;
      documentStarted = true;
      continue;
    }
    if (/^\.\.\.(\s|$)/.test(line)) break;
    const quoted = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*:(\s|$)/.exec(line);
    if (quoted) {
      const raw = quoted[1]!;
      found.push({ name: raw.startsWith('"') ? (JSON.parse(raw) as string) : raw.slice(1, -1).replace(/''/g, "'"), line: n + 1 });
      continue;
    }
    const plain = /^([^\s#:\-?[\]{},&*!|>'"%@`][^#]*?|[-?:][^\s#][^#]*?)\s*:(\s|$)/.exec(line);
    if (plain) found.push({ name: plain[1]!, line: n + 1 });
  }
  return found.map((k, idx) => {
    const end = idx + 1 < found.length ? found[idx + 1]!.line - 1 : lines.length;
    return { name: k.name, startLine: k.line, endLine: Math.max(k.line, trimBack(lines, k.line, end, true)) };
  });
}

/** Scanned keys as outline symbols. */
export const keySymbols = (keys: ScannedKey[]): DataSymbol[] => keys.map((k) => ({ name: k.name, kind: 'key', startLine: k.startLine, endLine: k.endLine, container: null }));
