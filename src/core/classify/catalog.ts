/**
 * Where classification schemes live, and the only place that reads or writes
 * them. It is the toil project catalog's sibling and keeps its manners: a path
 * a call names is judged from its text before anything stats it, resolved
 * through realpath so a link can't lead out, kept off toil's own files, and a
 * write is validated, written beside the old file and renamed into place,
 * never over anything that isn't already a scheme (docs/bounds.md,
 * `classify.write` and `classify.replace`). Schemes are looked up in a fixed
 * order, highest first: a file the call named, your own folder
 * (`~/.toil/classify/`), the repository's `.toil/classify/`, a path beside the
 * toil project that names it, and the built-in two. The ledger a later slice
 * keeps in your own folder is found through `places().user`, so the folder's
 * path is spelled once. Each file is signed for by exactly one name, which is
 * more than can be said for most spreadsheets of record.
 */
import { mkdirSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { assertLocalPath } from '../local-path.js';
import type { Warning } from '../envelope.js';
import { ToilError } from '../errors.js';
import { forwardSlashes, isSystemPath } from '../files.js';
import { findGitRepo } from '../git-repo.js';
import { JsonSyntaxError, parseStrictJson } from '../strict-json.js';
import { inside, readCapped, samePath, type CatalogOptions } from '../toil-project.js';
import { BUILTIN_NAMES, builtinScheme, defaultScheme } from './builtin.js';
import { readScheme, schemeContent } from './scheme.js';
import { SCHEME_NAME, type FoundScheme, type Scheme, type SchemeSource } from './types.js';

/** The largest scheme file toil reads: a scheme is a few categories and rules, and every classify call reads one. */
export const MAX_SCHEME_BYTES = 256 * 1024;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export type SchemeCatalogOptions = Omit<CatalogOptions, 'areas'> & { areas?: CatalogOptions['areas'] };

/** A scheme as resolved, with what was worth saying about reading it. */
export type ResolvedScheme = FoundScheme & { warnings: Warning[] };

export interface SchemeCatalog {
  /**
   * The scheme a call uses. `scheme` is the call's `--scheme`: a value ending in
   * `.json` or holding a path separator is a file, anything else a name (yours,
   * the repository's, built in). Without it the toil project's `classify.scheme`
   * applies (`./x.json` is beside the toil project's own `file`), and without that
   * the built-in `ktlo-feature`. `cwd` picks the repository, as it does for toil projects.
   */
  resolve(ref: { scheme?: string | undefined; toilProject?: { scheme?: string | undefined; file?: string | undefined } | undefined; cwd?: string | undefined }): ResolvedScheme;
  /** Every scheme visible by name (yours, the repository's, built in), each name once from its highest source. A file that can't be read is a warning. */
  list(cwd?: string): { schemes: ResolvedScheme[]; warnings: Warning[] };
  /** Your own folder, `~/.toil/classify`, and the repository's `.toil/classify` when `cwd` is in one. */
  places(cwd?: string): { user: string; repo?: string };
  /** Where your own scheme named `name` lives. */
  userFile(name: string): string;
  /** `.toil/classify/` in the repository whose root is `dir`; INVALID_INPUT when `dir` isn't a repository's root. */
  repoFolder(dir: string): string;
  /** A path a call gave, absolute: relative to the CLI's working directory, or under MCP the workspace. */
  pathFor(value: string, what: string): string;
  /** Reads one scheme file a call named, inside the bounds, whatever it is called. For `import` and `set --from`; a file with no `name` takes `defaultName`. */
  readFile(path: string, cwd?: string, defaultName?: string): ResolvedScheme;
  /**
   * Writes a scheme, validated, to `path`: `create` refuses a file that is there,
   * `replace` replaces only a valid scheme. The path must be a `.json` file in
   * `~/.toil/classify/`, a repository's `.toil/classify/` (named for the scheme), or
   * the workspace, or, with `beside`, in the folder of that toil project file.
   * Never toil's own files, /proc or /sys. Returns the absolute path written.
   */
  save(path: string, scheme: Scheme, mode: 'create' | 'replace', beside?: string): string;
}

export function createSchemeCatalog(o: SchemeCatalogOptions): SchemeCatalog {
  const own = join(o.home, '.toil');
  const user = join(own, 'classify');
  const guard = { home: o.home, env: o.env, protect: o.protect };
  const unbounded = o.config.bounds?.files === 'unbounded';

  /** A folder's canonical form whether or not it exists yet: the nearest folder that does, real-pathed, with the rest added back. */
  const real = (path: string) => {
    let existing = resolve(path);
    const rest: string[] = [];
    for (;;) {
      try {
        return join(realpathSync.native(existing), ...rest);
      } catch {
        const parent = resolve(existing, '..');
        if (parent === existing) return resolve(path);
        rest.unshift(basename(existing));
        existing = parent;
      }
    }
  };

  const fromBase = (value: string, what: string): string => {
    assertLocalPath(value, o.workspace.dir, what);
    const path = isAbsolute(value) ? resolve(value) : o.base === undefined ? undefined : resolve(o.base, value);
    if (path !== undefined) {
      assertLocalPath(path, o.workspace.dir, what);
      return path;
    }
    throw new ToilError('INVALID_INPUT', `${what} "${value}" is relative, and there's no folder to resolve it against.`, {
      fix: 'Pass an absolute path, or give the MCP server a workspace with --workspace <dir> or TOIL_WORKSPACE.',
    });
  };

  const folderOf = (cwd?: string): string | undefined => {
    if (cwd === undefined) return o.workspace.dir;
    const path = fromBase(cwd, 'The folder');
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      // said below
    }
    if (!isDir) throw new ToilError('INVALID_INPUT', `The folder ${forwardSlashes(path)} (from cwd) doesn't exist where toil is running.`, { fix: 'Pass a folder on this machine.' });
    return path;
  };

  const places = (cwd?: string) => {
    const dir = folderOf(cwd);
    const root = dir ? findGitRepo(dir, guard)?.root : undefined;
    const repo = root ? join(root, '.toil', 'classify') : undefined;
    // A home folder that is itself a repository has one scheme folder, not two.
    return { user, ...(repo && !samePath(real(repo), real(user)) ? { repo } : {}) };
  };

  /**
   * toil's own files, the --config file, /proc and /sys: never read or written as a
   * scheme. Your scheme folder is the part of `~/.toil` a scheme may name, and
   * `also` is a folder the caller vetted (the one beside a toil project).
   */
  const forbidden = (realPath: string, also: readonly string[] = []) => {
    if (isSystemPath(realPath)) return true;
    if (o.protect.some((p) => !samePath(p, own) && inside(realPath, real(p)))) return true;
    return [own, ...o.protect].some((p) => inside(realPath, real(p))) && ![user, ...also].some((d) => inside(realPath, real(d)));
  };

  const inWorkspace = (realPath: string) => o.workspace.dir !== undefined && inside(realPath, real(o.workspace.dir));

  const missing = (path: string) =>
    new ToilError('INVALID_INPUT', `${forwardSlashes(path)} doesn't exist where toil is running.`, {
      fix: "Check the path. If toil runs somewhere else (a container, WSL, another host), its paths aren't yours: pass the scheme by name instead.",
    });

  /** Reads and validates one file already judged to be in bounds. */
  const readAt = (path: string, source: SchemeSource, defaultName?: string): ResolvedScheme => {
    const file = forwardSlashes(path);
    let text: string | undefined;
    try {
      text = readCapped(path, MAX_SCHEME_BYTES);
    } catch (err) {
      throw new ToilError('CONFIG_INVALID', `Scheme ${file} can't be read: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}.`, { fix: `Check that ${file} is readable.` });
    }
    if (text === undefined) {
      throw new ToilError('CONFIG_INVALID', `Scheme ${file} is larger than ${MAX_SCHEME_BYTES / 1024} KiB, the most a scheme file may be, so it wasn't read.`, { fix: 'A scheme holds categories, guidance and rules; move anything else out of it.' });
    }
    let parsed: ReturnType<typeof parseStrictJson>;
    try {
      parsed = parseStrictJson(text);
    } catch (err) {
      // Where, never what: the content stays in the file.
      const where = err instanceof JsonSyntaxError ? err.message : 'unreadable';
      throw new ToilError('CONFIG_INVALID', `Scheme ${file} can't be used: it isn't valid JSON: ${where}.`, { fix: `Fix it in ${file}.` });
    }
    const value = defaultName !== undefined && isRecord(parsed.value) && parsed.value.name === undefined ? { ...parsed.value, name: defaultName } : parsed.value;
    const { scheme, warnings } = readScheme(value, file);
    for (const path of parsed.duplicates) warnings.push({ code: 'SCHEME_DUPLICATE_KEY', message: `${file} (${path}): "${path}" is set twice; the last one is used.` });
    return { scheme, source, file, warnings };
  };

  /** A path a call names, in bounds and read: a `.json` file in the workspace or a scheme place, never toil's config or /proc and /sys. */
  const readBounded = (path: string, source: SchemeSource, cwd: string | undefined, also: readonly string[], what: string, defaultName?: string): ResolvedScheme => {
    const refuse = (why: string, fix: string) => new ToilError('INVALID_INPUT', `${forwardSlashes(path)} can't be read as a scheme: ${why}`, { fix });
    if (!path.toLowerCase().endsWith('.json')) throw refuse(`${what} ends in .json.`, 'Pass a scheme file, or a scheme by name.');
    // Decided before anything is looked at, so a path outside can't be probed for whether it exists.
    const target = real(path);
    if (forbidden(target, also)) throw refuse("that's one of toil's own files, or a system path.", 'Pass a scheme file, or a scheme by name.');
    const where = places(cwd);
    const allowed = inWorkspace(target) || [where.user, ...(where.repo ? [where.repo] : []), ...also].some((d) => inside(target, real(d)));
    if (!allowed && !unbounded) {
      throw refuse(
        `it's outside the workspace${o.workspace.dir ? ` (${forwardSlashes(o.workspace.dir)})` : ''} and outside every scheme folder.`,
        'Move it into the workspace, copy it in with toil classify scheme import, or pass the scheme by name.',
      );
    }
    let realPath: string;
    try {
      realPath = realpathSync.native(path);
      if (!statSync(realPath).isFile()) throw new Error('not a file');
    } catch {
      throw missing(path);
    }
    return readAt(realPath, source, defaultName);
  };

  /** `<dir>/<name>.json` as the scheme called `name`, or undefined when no such file; a link out of `dir` is a warning and no scheme. */
  const named = (dir: string | undefined, name: string, source: SchemeSource, warnings: Warning[]): ResolvedScheme | undefined => {
    if (!dir) return undefined;
    const file = join(dir, `${name}.json`);
    try {
      if (!statSync(file).isFile()) return undefined;
    } catch {
      return undefined;
    }
    const target = real(file);
    if (!inside(target, real(dir)) || forbidden(target, [dir])) {
      warnings.push({ code: 'SCHEME_PATH_INVALID', message: `${forwardSlashes(file)} was skipped: it's a link to a file outside ${forwardSlashes(dir)}.` });
      return undefined;
    }
    const found = readAt(target, source);
    if (found.scheme.name !== name) {
      throw new ToilError('CONFIG_INVALID', `Scheme ${forwardSlashes(file)} is named "${found.scheme.name}", and a scheme's name must be its file name ("${name}").`, {
        fix: `Set "name" to "${name}" in the file, or rename the file to ${found.scheme.name}.json.`,
      });
    }
    return { ...found, warnings: [...found.warnings, ...warnings] };
  };

  const isFileRef = (value: string) => value.toLowerCase().endsWith('.json') || /[\\/]/.test(value);
  const isRelativeRef = (value: string) => /^\.\.?[\\/]/.test(value) || value.toLowerCase().endsWith('.json');

  const listNames = (cwd?: string): string[] => {
    try {
      return list(cwd).schemes.map((s) => s.scheme.name);
    } catch {
      return [...BUILTIN_NAMES];
    }
  };

  const byName = (name: string, cwd: string | undefined): ResolvedScheme => {
    if (!SCHEME_NAME.test(name)) {
      throw new ToilError('INVALID_INPUT', `"${name}" isn't a scheme name or a scheme file.`, {
        fix: 'A name is lowercase letters, digits and single hyphens, e.g. ktlo-feature; a file ends in .json.',
      });
    }
    const where = places(cwd);
    const warnings: Warning[] = [];
    const found = named(where.user, name, 'user', warnings) ?? named(where.repo, name, 'repo', warnings);
    if (found) return found;
    const built = builtinScheme(name);
    if (built) return { scheme: built, source: 'built-in', warnings };
    throw new ToilError('NOT_FOUND', `There's no scheme named "${name}" here.`, {
      fix: `Use one of: ${listNames(cwd).join(', ')}; or pass a path to a scheme file. toil classify scheme init ${name} creates one.`,
    });
  };

  const resolveRef: SchemeCatalog['resolve'] = (ref) => {
    const cwd = ref.cwd;
    if (ref.scheme !== undefined) {
      if (isFileRef(ref.scheme)) return readBounded(fromBase(ref.scheme, 'The scheme file'), 'file', cwd, [], 'a scheme file');
      return byName(ref.scheme, cwd);
    }
    const wanted = ref.toilProject?.scheme;
    if (wanted === undefined) return { scheme: defaultScheme(), source: 'built-in', warnings: [] };
    if (!isRelativeRef(wanted)) return byName(wanted, cwd);
    const beside = ref.toilProject?.file;
    if (!beside) {
      throw new ToilError('INVALID_INPUT', `The toil project's scheme "${wanted}" is a path, and the toil project has no file to take it from.`, { fix: 'Name the scheme instead, or pass --scheme <file>.' });
    }
    const folder = dirname(beside);
    const path = resolve(folder, wanted);
    assertLocalPath(path, o.workspace.dir, 'The scheme file');
    return readBounded(path, 'toil-project', cwd, [folder], 'a scheme file');
  };

  const list: SchemeCatalog['list'] = (cwd) => {
    const where = places(cwd);
    const schemes: ResolvedScheme[] = [];
    const warnings: Warning[] = [];
    const taken = new Set<string>();
    for (const [dir, source] of [[where.user, 'user'], [where.repo, 'repo']] as const) {
      if (!dir) continue;
      let names: string[];
      try {
        names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.json')).sort();
      } catch {
        continue;
      }
      for (const n of names) {
        const name = n.replace(/\.json$/i, '');
        if (taken.has(name)) continue;
        // A broken file still holds its name, as it does for a call: the next source down doesn't speak for it.
        taken.add(name);
        try {
          if (!SCHEME_NAME.test(name)) {
            warnings.push({ code: 'SCHEME_PATH_INVALID', message: `${forwardSlashes(join(dir, n))} was skipped: "${name}" isn't a valid scheme name.` });
            continue;
          }
          const local: Warning[] = [];
          const found = named(dir, name, source, local);
          if (found) {
            warnings.push(...found.warnings);
            schemes.push({ ...found, warnings: [] });
          } else warnings.push(...local);
        } catch (err) {
          if (!(err instanceof ToilError)) throw err;
          warnings.push({ code: 'SCHEME_INVALID', message: err.message });
        }
      }
    }
    for (const name of BUILTIN_NAMES) if (!taken.has(name)) schemes.push({ scheme: builtinScheme(name)!, source: 'built-in', warnings: [] });
    return { schemes, warnings };
  };

  const repoFolder = (dir: string): string => {
    const path = fromBase(dir, 'The repository');
    const repo = findGitRepo(path, guard);
    if (!repo || !samePath(repo.root, path)) {
      throw new ToilError('INVALID_INPUT', `${forwardSlashes(path)} isn't the root of a git repository${repo ? ` (its root is ${repo.root})` : ''}.`, {
        fix: repo ? `Pass ${repo.root}.` : 'Pass the top folder of a working tree, the one that holds .git.',
      });
    }
    return join(path, '.toil', 'classify');
  };

  const save: SchemeCatalog['save'] = (path, scheme, mode, beside) => {
    assertLocalPath(path, o.workspace.dir, 'The scheme file');
    const target = resolve(path);
    assertLocalPath(target, o.workspace.dir, 'The scheme file');
    const refuse = (why: string, fix: string) => new ToilError('INVALID_INPUT', `toil won't write a scheme to ${forwardSlashes(target)}: ${why}`, { fix });
    if (!target.toLowerCase().endsWith('.json')) throw refuse('a scheme file ends in .json.', 'Name a .json file.');
    // Judged where it would really land, through any link in the folders above it.
    const realTarget = real(target);
    const next = beside ? [dirname(beside)] : [];
    if (forbidden(realTarget, next)) throw refuse("that's one of toil's own files, or a system path.", 'Write it to your scheme folder, a repository, or the workspace.');
    const folder = resolve(realTarget, '..');
    const root = resolve(folder, '..', '..');
    const inRepoFolder = basename(folder) === 'classify' && basename(resolve(folder, '..')) === '.toil' && samePath(findGitRepo(root, guard)?.root ?? '', root);
    const yours = inside(realTarget, real(user));
    const besideToilProject = next.some((d) => samePath(real(d), folder));
    if (!yours && !inRepoFolder && !besideToilProject && !inWorkspace(realTarget) && !unbounded) {
      throw refuse(`it's outside the workspace${o.workspace.dir ? ` (${forwardSlashes(o.workspace.dir)})` : ''} and outside every scheme folder.`, 'Write it inside the workspace (--workspace <dir> chooses another), or to a repository with --repo.');
    }
    // In a scheme folder the file name is how a name finds the scheme, so the two must agree.
    if ((yours || inRepoFolder) && basename(realTarget).toLowerCase() !== `${scheme.name}.json`) {
      throw refuse(`a scheme in a scheme folder is kept in <name>.json, and this one is named "${scheme.name}".`, `Write it to ${scheme.name}.json.`);
    }
    let exists = false;
    try {
      exists = statSync(realTarget).isFile();
    } catch {
      // nothing there yet
    }
    if (exists && mode === 'create') throw refuse('a file is already there.', 'Pass --replace to replace a scheme, or choose another name.');
    if (exists) {
      let valid = true;
      try {
        readAt(realTarget, 'file');
      } catch {
        valid = false;
      }
      if (!valid) throw refuse("the file there isn't a valid scheme, and toil only ever replaces a scheme.", 'Choose another path, or move that file aside.');
    }
    // Checked with the reader that will load it, so toil never writes a scheme it would refuse.
    const checked = readScheme(JSON.parse(schemeContent(scheme)) as unknown, scheme.name).scheme;
    // Your own folder is yours alone, as the config is; a repository's files take the repository's.
    mkdirSync(folder, { recursive: true, ...(yours ? { mode: 0o700 } : {}) });
    // Written alongside and renamed into place, so a crash halfway leaves the old file, not half a new one.
    const temp = `${realTarget}.${process.pid}.tmp`;
    writeFileSync(temp, schemeContent(checked), { encoding: 'utf8', ...(yours ? { mode: 0o600 } : {}) });
    renameSync(temp, realTarget);
    return forwardSlashes(realTarget);
  };

  return {
    resolve: resolveRef,
    list,
    places,
    userFile: (name) => join(user, `${name}.json`),
    repoFolder,
    pathFor: fromBase,
    readFile: (path, cwd, defaultName) => readBounded(fromBase(path, 'The scheme file'), 'file', cwd, [], 'a scheme file', defaultName),
    save,
  };
}

