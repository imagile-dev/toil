import { ToilError } from '../../../core/errors.js';
import { forwardSlashes } from '../../../core/files.js';
import { redactText } from '../../../core/secret-shapes.js';
import { BINARY_SNIFF, binaryAt, openInput, type InputContext, type UtilInput } from '../kit/input.js';
import { Verifier, type Verified } from '../kit/verify.js';
import type { SymbolKind } from './code.js';
import type { CodeLanguage } from './lexer.js';

/**
 * The work behind `util size`, loaded only when the command runs: counts and
 * a token estimate for a file or every file in a folder, a structural
 * outline for one file, and the checks that hold both to the input. Every
 * outlined symbol's start line is re-read from the input and must name the
 * symbol; a folder's totals are summed two ways and must agree. The figures
 * are only as good as the arithmetic, which is why the arithmetic is done
 * twice, as any expense report can confirm.
 *
 * This module reads the input, so it imports zod through kit/input.ts and is
 * imported statically (docs/util.md, Lazy loading: a lazy module must not
 * reach zod). The outliners, which hold no zod and are the bulk of the code,
 * load through import() when a file is outlined.
 */

export const LANGUAGES = ['typescript', 'javascript', 'python', 'csharp', 'java', 'go', 'markdown', 'json', 'yaml'] as const;
export type Language = (typeof LANGUAGES)[number];

const EXTENSIONS: Record<string, Language> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyi: 'python',
  cs: 'csharp',
  java: 'java',
  go: 'go',
  md: 'markdown', markdown: 'markdown',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
};

/** How tokens are estimated, said in every result. */
export const TOKEN_METHOD = "ceil(characters / 4) per file, counting characters as Unicode code points. An estimate, not any model's tokenizer: real counts vary by model and by content";

/** The largest file outlined. A bigger one is counted, and its outline is skipped with reason too-large. */
export const OUTLINE_MAX_BYTES = 8 * 1024 * 1024;
/** Files have no input cap for counting, which streams: only stdin, held in memory, keeps the reader's. */
const COUNT_MAX_BYTES = Number.MAX_SAFE_INTEGER;
export const DEFAULT_TOP = 10;
export const DEFAULT_DEPTH = 3;

export interface SizeInput {
  file?: string | undefined;
  text?: string | undefined;
  language?: Language | undefined;
  top?: number | undefined;
  depth?: number | undefined;
}

export type NotOutlinedReason = 'binary' | 'unsupported-language' | 'parse-error' | 'too-large';

export interface OutlineSymbol {
  name: string;
  kind: SymbolKind | 'heading' | 'key';
  startLine: number;
  endLine: number;
  container: string | null;
  level?: number;
}

export interface FileSize {
  kind: 'file';
  /** Relative to the workspace, forward slashes; null for stdin and text. */
  path: string | null;
  language: Language | null;
  bytes: number;
  /** Null for a binary file. */
  lines: number | null;
  tokens: number | null;
  tokenMethod: string;
  outline: { precision: 'syntactic' | 'parsed'; method: string; symbols: OutlineSymbol[] } | null;
  notOutlined: { reason: NotOutlinedReason; detail: string } | null;
  verified: Verified;
}

export interface Totals {
  files: number;
  bytes: number;
  /** Lines and tokens of the text files; binary files count in files and bytes only. */
  lines: number;
  tokens: number;
  binaryFiles: number;
}

export interface FolderNode extends Totals {
  path: string;
  /** Subfolders, largest first. Empty below the depth shown, with `foldersHidden` saying how many there are. */
  folders: FolderNode[];
  foldersHidden: number;
}

export interface FileEntry {
  path: string;
  /** The folder node the file sits in directly. */
  folder: string;
  bytes: number;
  lines: number | null;
  tokens: number | null;
  binary: boolean;
  language: Language | null;
}

export interface Skipped {
  path: string;
  reason: 'unreadable' | 'not-a-file' | 'nested-repository';
  detail: string;
}

export interface FolderSize {
  kind: 'folder';
  path: string;
  tokenMethod: string;
  totals: Totals;
  tree: FolderNode;
  largest: Omit<FileEntry, 'folder'>[];
  skipped: Skipped[];
  verified: Verified;
}

/** The language a path's extension names, or undefined. */
export function languageOf(path: string): Language | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? EXTENSIONS[name.slice(dot + 1).toLowerCase()] : undefined;
}

const codePoints = (text: string) => {
  let low = 0;
  for (let k = 0; k < text.length; k++) {
    const c = text.charCodeAt(k);
    if (c >= 0xdc00 && c <= 0xdfff) low++;
  }
  return text.length - low;
};

/** Lines as the input reader counts them: one per line ending, plus a last line with none. */
export const lineCount = (text: string) => {
  if (text === '') return 0;
  let n = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) n++;
  return text.endsWith('\n') ? n : n + 1;
};

interface Counts {
  bytes: number;
  lines: number;
  tokens: number;
  binary: boolean;
}

/** One pass over the input: bytes, lines, code points for the token estimate, and whether its start holds a NUL byte. */
async function count(input: UtilInput): Promise<Counts> {
  const decoder = new TextDecoder('utf-8');
  let head = new Uint8Array(0);
  let binary = false;
  let newlines = 0;
  let last = -1;
  let chars = 0;
  for await (const chunk of input.chunks()) {
    if (head.length < BINARY_SNIFF) {
      const more = chunk.subarray(0, BINARY_SNIFF - head.length);
      const joined = new Uint8Array(head.length + more.length);
      joined.set(head);
      joined.set(more, head.length);
      head = joined;
      if (binaryAt(head) !== -1) binary = true;
    }
    for (let at = chunk.indexOf(10); at !== -1; at = chunk.indexOf(10, at + 1)) newlines++;
    last = chunk[chunk.length - 1] ?? last;
    if (!binary) chars += codePoints(decoder.decode(chunk, { stream: true }));
  }
  if (!binary) chars += codePoints(decoder.decode());
  const bytes = input.bytesRead;
  return { bytes, lines: bytes === 0 ? 0 : newlines + (last === 10 ? 0 : 1), tokens: Math.ceil(chars / 4), binary };
}

/** `size` on whatever the input names: a folder's totals, or one file's counts and outline. */
export async function measure(input: SizeInput, ctx: InputContext): Promise<FileSize | FolderSize> {
  const named = input.text === undefined && input.file !== undefined && input.file !== '-' ? input.file : undefined;
  if (named !== undefined && ctx.files.stat(named).type === 'directory') {
    if (input.language !== undefined) {
      throw new ToilError('INVALID_INPUT', 'language applies to one file, and this is a folder.', { fix: 'Leave out language: each file in a folder is told by its extension.' });
    }
    return measureFolder(named, input, ctx);
  }
  for (const field of ['top', 'depth'] as const) {
    if (input[field] !== undefined) throw new ToilError('INVALID_INPUT', `${field} applies to a folder, and this is one file.`, { fix: `Leave out ${field}, or pass a folder.` });
  }
  return measureFile(input, ctx);
}

/** A path as the output shows it: forward slashes, no `./` and no trailing slash. */
const clean = (path: string) => forwardSlashes(path).replace(/^(\.\/)+/, '').replace(/\/+$/, '') || '.';

async function measureFile(input: SizeInput, ctx: InputContext): Promise<FileSize> {
  const v = new Verifier(ctx.warn);
  const isFile = input.text === undefined && input.file !== undefined && input.file !== '-';
  const opened = await openInput(ctx, input, { binary: 'allow', ...(isFile ? { maxBytes: COUNT_MAX_BYTES } : {}) });
  const counts = await count(opened);
  v.inputComplete(opened);
  const path = opened.source.kind === 'file' ? clean(opened.source.path) : null;
  const language = input.language ?? (path === null ? undefined : languageOf(path)) ?? null;
  let outline: FileSize['outline'] = null;
  let notOutlined: FileSize['notOutlined'] = null;

  if (counts.binary) notOutlined = { reason: 'binary', detail: `It has a NUL byte in its first ${BINARY_SNIFF} bytes, so it was counted in bytes only.` };
  else if (language === null) {
    notOutlined = {
      reason: 'unsupported-language',
      detail:
        path === null
          ? `stdin and text have no file name to tell the language from: pass language (one of ${LANGUAGES.join(', ')}) for an outline.`
          : `No outline for this file type; outlines cover ${LANGUAGES.join(', ')}. It was counted only.`,
    };
  } else if (counts.bytes > OUTLINE_MAX_BYTES) {
    notOutlined = { reason: 'too-large', detail: `It is ${counts.bytes} bytes; files over ${OUTLINE_MAX_BYTES} bytes are counted, not outlined.` };
  } else {
    const text = await opened.text();
    v.equal('counts.reread', { bytes: counts.bytes, lines: counts.lines }, { bytes: opened.bytesRead, lines: lineCount(text) }, { code: 'SIZE_COUNTS_MISMATCH' });
    const { OutlineError } = await import('./lexer.js');
    try {
      outline = await outlineOf(language, text, v);
    } catch (err) {
      if (!(err instanceof OutlineError) && !(err instanceof ToilError)) throw err;
      notOutlined = { reason: 'parse-error', detail: err.message };
      ctx.warn({ code: 'SIZE_PARSE_ERROR', message: `No outline for ${opened.label}: ${err.message}. Its counts are still given.` });
    }
    if (outline) {
      if (outline.precision === 'syntactic') v.approximated('outline.symbols', `found by a syntactic scan, not a compiler or parser; outline.method says what it covers`);
      await verifyOutline(outline.symbols as (OutlineSymbol & { parent?: number })[], opened, counts.lines, v);
      outline.symbols = outline.symbols.map(({ parent: _parent, ...s }: OutlineSymbol & { parent?: number }) => s);
    }
  }
  v.approximated('tokens', TOKEN_METHOD);
  return {
    kind: 'file',
    path,
    language,
    bytes: counts.bytes,
    lines: counts.binary ? null : counts.lines,
    tokens: counts.binary ? null : counts.tokens,
    tokenMethod: TOKEN_METHOD,
    outline,
    notOutlined,
    verified: v.done(),
  };
}

/** JSON.parse's complaint as a line and column, never the text it quotes. */
function jsonError(err: Error, text: string, OutlineError: new (message: string) => Error): Error {
  const at = /position (\d+)/.exec(err.message);
  if (!at) return new OutlineError("it isn't valid JSON");
  const before = text.slice(0, Number(at[1]));
  const line = lineCount(before) || 1;
  const column = before.length - before.lastIndexOf('\n');
  return new OutlineError(`it isn't valid JSON at line ${line}, column ${column}`);
}

async function outlineOf(language: Language, text: string, v: Verifier): Promise<NonNullable<FileSize['outline']>> {
  if (language === 'markdown') {
    const { outlineMarkdown } = await import('./data.js');
    return { precision: 'syntactic', method: 'ATX (#) and setext (underlined) headings, outside fenced code blocks and front matter. Each runs to the line before the next heading of the same or a higher level', symbols: outlineMarkdown(text) };
  }
  if (language === 'json' || language === 'yaml') {
    let parsed: unknown;
    if (language === 'json') {
      try {
        parsed = JSON.parse(text.replace(/^\ufeff/, ''));
      } catch (err) {
        const { OutlineError } = await import('./lexer.js');
        throw jsonError(err as Error, text, OutlineError);
      }
    } else {
      const { parseYaml } = await import('../kit/yaml.js');
      parsed = parseYaml(text, 'it');
    }
    const { keySymbols, scanJsonKeys, scanYamlKeys } = await import('./data.js');
    const keys = language === 'json' ? scanJsonKeys(text) : scanYamlKeys(text);
    checkKeys(parsed, keys.map((k) => k.name), v);
    return {
      precision: 'parsed',
      method: `Top-level keys, found by scanning the text and held against the keys ${language === 'json' ? 'JSON.parse' : 'the YAML parser'} returns. A document whose top level isn't a mapping has none`,
      symbols: keySymbols(keys),
    };
  }
  const { CODE_METHOD, outlineCode } = await import('./code.js');
  return { precision: 'syntactic', method: CODE_METHOD[language as CodeLanguage], symbols: outlineCode(text, language as CodeLanguage) };
}

/** The scanned keys are the parser's keys: the same set, each found at least once. */
export function checkKeys(parsed: unknown, scanned: string[], v: Verifier): void {
  const isMapping = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  const expected = isMapping ? [...new Set(Object.keys(parsed as object))].sort() : [];
  const actual = [...new Set(scanned)].sort();
  v.equal('outline.keys', expected, actual, { code: 'SIZE_OUTLINE_MISMATCH', at: 'the top-level keys' });
}

const IDENTIFIER = /^[\w$]+$/;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether a line names `name`: as a whole word for an identifier, as written otherwise. */
function names(line: string, name: string): boolean {
  if (name === '') return true;
  if (IDENTIFIER.test(name)) return new RegExp(`(^|[^\\w$])${escapeRegex(name)}($|[^\\w$])`).test(line);
  return line.includes(name) || line.includes(JSON.stringify(name).slice(1, -1));
}

/**
 * Each symbol's line range is inside the file and in order, a nested one
 * sits inside its container, and its start line, re-read from the input,
 * names it. A failure shows the line it found, with anything shaped like a
 * secret redacted.
 */
export async function verifyOutline(symbols: (OutlineSymbol & { parent?: number })[], input: Pick<UtilInput, 'linesAt'>, lines: number, v: Verifier): Promise<void> {
  const reread = await input.linesAt(symbols.map((s) => s.startLine));
  const code = { code: 'SIZE_OUTLINE_MISMATCH' };
  for (const s of symbols) {
    const label = `${s.kind} ${s.container ? `${s.container}.` : ''}${s.name}`;
    v.expect('outline.range', s.startLine >= 1 && s.startLine <= s.endLine && s.endLine <= lines, { at: label, expected: `1 <= start <= end <= ${lines}`, actual: `${s.startLine}-${s.endLine}` }, code);
    const found = reread.get(s.startLine);
    v.expect('outline.start', found !== undefined && names(found, s.name), { at: `line ${s.startLine}`, expected: label, actual: found === undefined ? 'no such line' : redactText(found.trim()).slice(0, 120) }, code);
    if (s.parent !== undefined) {
      const p = symbols[s.parent];
      v.expect('outline.nesting', p !== undefined && p.startLine <= s.startLine && s.endLine <= p.endLine, { at: label, expected: p ? `inside ${p.startLine}-${p.endLine}` : 'a container', actual: `${s.startLine}-${s.endLine}` }, code);
    }
  }
}

/** Reads up to the first BINARY_SNIFF bytes, so a binary file is told apart without reading it all. */
async function looksBinary(ctx: InputContext, path: string): Promise<boolean> {
  const parts: Uint8Array[] = [];
  let got = 0;
  for await (const chunk of ctx.files.readStream(path, ctx.signal ? { signal: ctx.signal } : {})) {
    parts.push(chunk);
    got += chunk.length;
    if (got >= BINARY_SNIFF) break;
  }
  const head = new Uint8Array(got);
  let at = 0;
  for (const p of parts) {
    head.set(p, at);
    at += p.length;
  }
  return binaryAt(head) !== -1;
}

const zero = (): Totals => ({ files: 0, bytes: 0, lines: 0, tokens: 0, binaryFiles: 0 });
const add = (into: Totals, file: Pick<FileEntry, 'bytes' | 'lines' | 'tokens' | 'binary'>) => {
  into.files++;
  into.bytes += file.bytes;
  into.lines += file.lines ?? 0;
  into.tokens += file.tokens ?? 0;
  if (file.binary) into.binaryFiles++;
};
const totalsOf = (t: Totals): Totals => ({ files: t.files, bytes: t.bytes, lines: t.lines, tokens: t.tokens, binaryFiles: t.binaryFiles });
const bySize = <T extends { bytes: number; path: string }>(a: T, b: T) => b.bytes - a.bytes || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The folder tree for `files`, each folder's totals added up from every file under it. */
export function buildTree(root: string, files: FileEntry[]): FolderNode {
  const nodes = new Map<string, FolderNode>();
  const node = (path: string): FolderNode => {
    let found = nodes.get(path);
    if (!found) {
      found = { path, ...zero(), folders: [], foldersHidden: 0 };
      nodes.set(path, found);
      if (path !== root) node(parentOf(root, path)).folders.push(found);
    }
    return found;
  };
  node(root);
  for (const file of files) {
    for (let at = node(file.folder); ; at = node(parentOf(root, at.path))) {
      add(at, file);
      if (at.path === root) break;
    }
  }
  for (const n of nodes.values()) n.folders.sort(bySize);
  return nodes.get(root)!;
}

const parentOf = (root: string, path: string) => {
  const cut = path.lastIndexOf('/');
  const up = cut === -1 ? '' : path.slice(0, cut);
  return up === '' || (root !== '.' && up.length < root.length) ? root : up;
};

/**
 * Two sums that must agree: the root's totals against every file added up,
 * and each folder's totals against the files directly in it plus its
 * subfolders' totals. Every file's folder must be in the tree.
 */
export function verifyTree(tree: FolderNode, files: FileEntry[], v: Verifier): void {
  const all = zero();
  const own = new Map<string, Totals>();
  for (const file of files) {
    add(all, file);
    let t = own.get(file.folder);
    if (!t) own.set(file.folder, (t = zero()));
    add(t, file);
  }
  v.equal('totals.sum', all, totalsOf(tree), { code: 'SIZE_TOTALS_MISMATCH', at: `the totals of ${tree.path}` });
  const seen = new Set<string>();
  const walk = (n: FolderNode) => {
    seen.add(n.path);
    const expected = totalsOf(own.get(n.path) ?? zero());
    for (const child of n.folders) {
      walk(child);
      expected.files += child.files;
      expected.bytes += child.bytes;
      expected.lines += child.lines;
      expected.tokens += child.tokens;
      expected.binaryFiles += child.binaryFiles;
    }
    v.equal('tree.sum', expected, totalsOf(n), { code: 'SIZE_TOTALS_MISMATCH', at: `the folder ${n.path}` });
  };
  walk(tree);
  for (const folder of own.keys()) if (!seen.has(folder)) v.fail('tree.sum', { at: `the folder ${folder}`, expected: 'a folder in the tree', actual: 'missing' }, { code: 'SIZE_TOTALS_MISMATCH' });
}

/** Folders below `depth` levels are left out, each counted in its parent's `foldersHidden`. */
function prune(n: FolderNode, depth: number): FolderNode {
  if (depth <= 0) return { ...n, folders: [], foldersHidden: n.folders.length };
  return { ...n, folders: n.folders.map((f) => prune(f, depth - 1)), foldersHidden: 0 };
}

async function measureFolder(dir: string, input: SizeInput, ctx: InputContext): Promise<FolderSize> {
  const v = new Verifier(ctx.warn);
  const root = clean(dir);
  const join = (rel: string) => (root === '.' ? rel : `${root}/${rel}`);
  const files: FileEntry[] = [];
  const skipped: Skipped[] = [];
  for (const rel of ctx.files.list(dir, { warn: ctx.warn })) {
    ctx.signal?.throwIfAborted();
    const path = join(rel.replace(/\/$/, ''));
    if (rel.endsWith('/')) {
      skipped.push({ path, reason: 'nested-repository', detail: 'Another git repository, which the listing shows as one entry and does not walk into.' });
      continue;
    }
    const cut = path.lastIndexOf('/');
    const folder = cut === -1 || (root !== '.' && cut < root.length) ? root : path.slice(0, cut);
    try {
      const stat = ctx.files.stat(path);
      if (stat.type !== 'file') {
        skipped.push({ path, reason: 'not-a-file', detail: `It is a ${stat.type === 'directory' ? 'folder (a link to one, say)' : 'special file'}, not a file.` });
        continue;
      }
      if (await looksBinary(ctx, path)) {
        files.push({ path, folder, bytes: stat.size, lines: null, tokens: null, binary: true, language: null });
        continue;
      }
      const opened = await openInput(ctx, { file: path }, { binary: 'allow', maxBytes: COUNT_MAX_BYTES });
      const counts = await count(opened);
      v.inputComplete(opened);
      files.push({ path, folder, bytes: counts.bytes, lines: counts.lines, tokens: counts.tokens, binary: counts.binary, language: languageOf(path) ?? null });
    } catch (err) {
      if (!(err instanceof ToilError)) throw err;
      skipped.push({ path, reason: 'unreadable', detail: err.message });
    }
  }
  if (skipped.some((s) => s.reason === 'unreadable')) {
    ctx.warn({ code: 'SIZE_FILES_SKIPPED', message: `${skipped.filter((s) => s.reason === 'unreadable').length} file(s) couldn't be read and aren't in the totals; skipped lists each with the reason.` });
  }
  const tree = buildTree(root, files);
  verifyTree(tree, files, v);
  v.approximated('tokens', TOKEN_METHOD);
  return {
    kind: 'folder',
    path: root,
    tokenMethod: TOKEN_METHOD,
    totals: totalsOf(tree),
    tree: prune(tree, input.depth ?? DEFAULT_DEPTH),
    largest: [...files].sort(bySize).slice(0, input.top ?? DEFAULT_TOP).map(({ folder: _folder, ...f }) => f),
    skipped,
    verified: v.done(),
  };
}
