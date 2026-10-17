import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { isSystemPath } from './files.js';
import { wildmatch } from './wildmatch.js';

/**
 * A pure-JS reader for git's config format, enough to answer what toil asks of
 * a repository (remotes, `insteadOf` rewrites, ignore settings) without
 * running git. It follows `include.path` and `includeIf` the way git does, in
 * place, so a value set by an included file lands where git would put it.
 *
 * Supported `includeIf` conditions: `gitdir:`, `gitdir/i:` and `onbranch:`.
 * `hasconfig:remote.*.url:` is treated as not matching, so its file is
 * skipped. The include chain is a form of delegated authority, and like all
 * delegated authority it stops at ten levels of "see attached".
 */
export interface GitConfigEntry {
  /** `section.key` or `section.subsection.key`; section and key lowercased, subsection as written. */
  key: string;
  /** null for a bare key (`[core] bare`), which git reads as true. */
  value: string | null;
  /** The file it came from, for `./` in an include pattern. */
  file: string;
}

/** What `includeIf` conditions are matched against. */
export interface IncludeContext {
  /** The repository's git directory (for a linked worktree, its private folder), absolute. */
  gitDir?: string;
  /** The current branch's short name, when HEAD is on a branch. */
  branch?: string;
  home: string;
  /** More of toil's own files an include may not name (the --config file); `~/.toil` always counts. */
  protect?: readonly string[];
  /** Told about an include that was skipped. */
  warn?: (warning: { code: string; message: string }) => void;
}

const MAX_INCLUDE_DEPTH = 10;

/** Reads `files` in order, with includes, into one list of entries; later entries win, as in git. */
export function readGitConfigFiles(files: readonly string[], ctx: IncludeContext): GitConfigEntry[] {
  const out: GitConfigEntry[] = [];
  for (const file of files) readInto(file, ctx, out, 0);
  return out;
}

function readInto(file: string, ctx: IncludeContext, out: GitConfigEntry[], depth: number): void {
  if (depth > MAX_INCLUDE_DEPTH || !existsSync(file)) return;
  // The global config is found by name, so it passes the same check an include does.
  if (depth === 0 && refusedGitRead(file, ctx.home, ctx.protect)) {
    ctx.warn?.({ code: 'GIT_INCLUDE_REFUSED', message: `toil doesn't read ${slashes(file)} as git config: it's toil's own file, or under /proc or /sys. It was skipped.` });
    return;
  }
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const entry of parseGitConfig(text, file)) {
    out.push(entry);
    const include = includeTarget(entry, ctx);
    if (!include) continue;
    if (refusedGitRead(include, ctx.home, ctx.protect)) {
      ctx.warn?.({ code: 'GIT_INCLUDE_REFUSED', message: `git config in ${slashes(entry.file)} includes ${slashes(include)}, which toil doesn't read (its own files, /proc or /sys); the include was skipped.` });
      continue;
    }
    readInto(include, ctx, out, depth + 1);
  }
}

/**
 * Every git metadata file read above or beside the workspace (an include, the
 * global config, a `gitdir:` target, a parent `.gitignore`) gets the same
 * refusals as a file a command is handed (docs/bounds.md): toil's own config
 * and `/proc` and `/sys`, judged after realpath. The values would only reach
 * remote and branch parsing, but the refusal is cheaper than the argument.
 */
export function refusedGitRead(path: string, home: string, protect: readonly string[] = []): boolean {
  let real = resolve(path);
  try {
    real = realpathSync.native(real);
  } catch {
    // judged as written
  }
  if (isSystemPath(real)) return true;
  const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const target = fold(real);
  return [join(home, '.toil'), ...protect].some((p) => {
    let g = resolve(p);
    try {
      g = realpathSync.native(g);
    } catch {
      // keep
    }
    g = fold(g);
    return target === g || target.startsWith(g.endsWith(sep) ? g : g + sep);
  });
}

/** The file an `include.path` or matching `includeIf.<cond>.path` entry pulls in, if any. */
function includeTarget(entry: GitConfigEntry, ctx: IncludeContext): string | undefined {
  if (entry.value === null || entry.value === '') return undefined;
  let matches = false;
  if (entry.key === 'include.path') matches = true;
  else if (entry.key.startsWith('includeif.') && entry.key.endsWith('.path')) {
    matches = conditionHolds(entry.key.slice('includeif.'.length, -'.path'.length), entry.file, ctx);
  }
  if (!matches) return undefined;
  const path = expandHome(entry.value, ctx.home);
  return isAbsolute(path) ? path : resolve(dirname(entry.file), path);
}

function conditionHolds(condition: string, file: string, ctx: IncludeContext): boolean {
  const colon = condition.indexOf(':');
  if (colon === -1) return false;
  const kind = condition.slice(0, colon);
  const pattern = condition.slice(colon + 1);
  if (kind === 'gitdir' || kind === 'gitdir/i') {
    if (!ctx.gitDir) return false;
    const regex = wildmatch(gitdirPattern(pattern, file, ctx.home), { pathname: true, caseFold: kind === 'gitdir/i' });
    return regex.test(slashes(ctx.gitDir));
  }
  if (kind === 'onbranch') {
    if (!ctx.branch) return false;
    const full = pattern.endsWith('/') ? `${pattern}**` : pattern;
    return wildmatch(full, { pathname: true }).test(ctx.branch);
  }
  return false;
}

/**
 * git's rules for a `gitdir:` pattern: `~/` is home, `./` is the including
 * file's folder, a relative pattern matches at any depth (git puts `**` and a
 * slash in front of it), and a trailing `/` matches everything below it.
 */
function gitdirPattern(raw: string, file: string, home: string): string {
  let pattern = raw;
  if (pattern.startsWith('~/')) pattern = slashes(join(home, pattern.slice(2)));
  else if (pattern.startsWith('./')) pattern = slashes(join(dirname(file), pattern.slice(2)));
  else pattern = slashes(pattern);
  if (!isAbsolute(pattern) && !pattern.startsWith('/') && !pattern.startsWith('**/')) pattern = `**/${pattern}`;
  if (pattern.endsWith('/')) pattern = `${pattern}**`;
  return pattern;
}

const slashes = (path: string) => path.replace(/\\/g, '/');

/** `~/x` and `~` expand to home, as git does for path-valued settings. */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return path;
}

/**
 * Parses one config file's text. Section and key names are lowercased (git
 * treats them case-insensitively); a quoted subsection keeps its case, a
 * dotted one (`[remote.origin]`, the deprecated form) is lowercased.
 */
export function parseGitConfig(text: string, file = ''): GitConfigEntry[] {
  const out: GitConfigEntry[] = [];
  let section: string | undefined;
  let i = 0;
  const n = text.length;
  const skipLine = () => {
    while (i < n && text[i] !== '\n') i++;
  };
  while (i < n) {
    const c = text[i]!;
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#' || c === ';') {
      skipLine();
      continue;
    }
    if (c === '[') {
      const header = parseHeader(text, i + 1);
      if (!header) {
        section = undefined;
        skipLine();
        continue;
      }
      section = header.section;
      i = header.end;
      continue;
    }
    if (!/[A-Za-z]/.test(c)) {
      skipLine();
      continue;
    }
    let j = i;
    while (j < n && /[A-Za-z0-9-]/.test(text[j]!)) j++;
    const name = text.slice(i, j).toLowerCase();
    while (j < n && (text[j] === ' ' || text[j] === '\t')) j++;
    let value: string | null = null;
    if (text[j] === '=') {
      const parsed = parseValue(text, j + 1);
      value = parsed.value;
      j = parsed.end;
    } else {
      // A bare key, or garbage: either way the rest of the line is not a value.
      while (j < n && text[j] !== '\n') j++;
    }
    if (section !== undefined) out.push({ key: `${section}.${name}`, value, file });
    i = j;
  }
  return out;
}

function parseHeader(text: string, start: number): { section: string; end: number } | undefined {
  let i = start;
  let name = '';
  while (i < text.length && /[A-Za-z0-9.-]/.test(text[i]!)) name += text[i++];
  if (name === '') return undefined;
  name = name.toLowerCase();
  while (text[i] === ' ' || text[i] === '\t') i++;
  if (text[i] === ']') {
    // `[remote.origin]`: the deprecated dotted form; its subsection is lowercased.
    return { section: name, end: i + 1 };
  }
  if (text[i] !== '"') return undefined;
  i++;
  let sub = '';
  while (i < text.length && text[i] !== '"') {
    if (text[i] === '\n') return undefined;
    if (text[i] === '\\' && i + 1 < text.length) i++;
    sub += text[i++];
  }
  if (text[i] !== '"' || text[i + 1] !== ']') return undefined;
  return { section: `${name}.${sub}`, end: i + 2 };
}

/** A value from just after `=` to the end of its (possibly continued) line. */
function parseValue(text: string, start: number): { value: string; end: number } {
  let i = start;
  let out = '';
  let quoted = false;
  // Whitespace outside quotes is kept only between words; leading and trailing goes.
  let pendingSpace = '';
  while (i < text.length) {
    const c = text[i]!;
    if (c === '\n') break;
    if (c === '\r' && text[i + 1] === '\n') {
      i++;
      continue;
    }
    if (!quoted && (c === '#' || c === ';')) {
      while (i < text.length && text[i] !== '\n') i++;
      break;
    }
    if (!quoted && (c === ' ' || c === '\t')) {
      if (out !== '') pendingSpace += c;
      i++;
      continue;
    }
    out += pendingSpace;
    pendingSpace = '';
    if (c === '"') {
      quoted = !quoted;
      i++;
      continue;
    }
    if (c === '\\') {
      const next = text[i + 1];
      if (next === '\n') {
        i += 2;
        continue;
      }
      if (next === '\r' && text[i + 2] === '\n') {
        i += 3;
        continue;
      }
      const map: Record<string, string> = { n: '\n', t: '\t', b: '\b', '"': '"', '\\': '\\' };
      if (next !== undefined && map[next] !== undefined) out += map[next];
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return { value: out, end: i };
}

/** The last value set for `key`, as git's single-valued lookup returns it. */
export function lastValue(entries: readonly GitConfigEntry[], key: string): string | null | undefined {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.key === key) return entries[i]!.value;
  return undefined;
}

/** git's boolean reading: true/yes/on/1 or a bare key are true; false/no/off/0/'' are false. */
export function gitBool(value: string | null | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === null) return true;
  const v = value.toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(v)) return true;
  if (['false', 'no', 'off', '0', ''].includes(v)) return false;
  return undefined;
}
