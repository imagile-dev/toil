/**
 * Where a toil project's architecture diagram lives, and the only place that
 * reads or writes one: `~/.toil/diagrams/<toil-project>.json`, in your own
 * storage, never in a repository and never in the workspace. It keeps the
 * manners of the scheme catalog (src/core/classify/catalog.ts): the folder and
 * every file are resolved through realpath so a link can't lead out of
 * `~/.toil`, a write is validated, written beside the old file and renamed into
 * place, and toil replaces or deletes only a file that is already a valid
 * diagram (docs/bounds.md, `diagrams.write` and `diagrams.replace`).
 *
 * A stored diagram is a C4 model (src/areas/util/c4/model.ts) plus when it was
 * saved and by which toil. It is also a document that gets handed around, so
 * what may go into one is narrower than what `util c4 render` will draw: no
 * string in it may hold a URL, a host with a port or anything shaped like a
 * credential, since a diagram says what a fact was read from (a file and line,
 * a command), never where a service is reached. A bare host name with no port
 * is allowed: it can't be told from a product (`Next.js`, `Node.js`), and a
 * diagram legitimately names those. The pure checks are `checkStorable` and `loadStorable`,
 * which `projects diagram check` runs before a person is asked to save. The
 * file is signed with a revision number, which is as close to a change
 * advisory board as a JSON file gets.
 */
import { mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { loadModelValue, unwrapEnvelope, viewTitle, type C4Model } from '../areas/util/c4/model.js';
import { CONNECTION_NAME } from './config.js';
import type { Warning } from './envelope.js';
import { ToilError } from './errors.js';
import { forwardSlashes, isSystemPath } from './files.js';
import { findSecrets } from './secret-shapes.js';
import { JsonSyntaxError, parseStrictJson } from './strict-json.js';
import { inside, readCapped } from './toil-project.js';

/** The newest file format this toil reads and the one it writes. A newer file is refused with an upgrade fix, not half-read. */
export const DIAGRAM_SCHEMA_VERSION = 1;
/** The largest diagram file toil reads or writes: the c4 commands' own cap on a model. */
export const MAX_DIAGRAM_BYTES = 4 * 1024 * 1024;
/** The most paths `notMapped` may list, and the longest one. It says what was left out, not why at length. */
export const NOT_MAPPED_LIMITS = { entries: 200, length: 300 } as const;

export interface StoredDiagram {
  schemaVersion: number;
  toilProject: string;
  revision: number;
  savedAt: string;
  toilVersion: string;
  model: C4Model;
  /** Paths the mapping deliberately left out (`dist/`), so a reader knows the gap is a choice. */
  notMapped?: string[] | undefined;
}

/** A diagram as read, with where it was read from (absolute, forward slashes). */
export interface FoundDiagram {
  diagram: StoredDiagram;
  file: string;
}

export interface DiagramProblem {
  path: string;
  message: string;
}

/** `<scheme>://`, the shape of any address; a diagram holds none. */
const URL_SHAPE = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,31}:\/\//i;

/** `user:pass@host`, a credential in an address, whatever the host. */
const USERINFO_SHAPE = /(?<![\w.-])[^\s:@/]+:[^\s@/]+@[a-z0-9][a-z0-9.-]*[a-z]/i;

/**
 * `name:5432`, `db.imagile.dev:5432` or `10.0.0.5:5432`: where a service is reached. A name
 * starts with a letter, so `12:30` is a time; a path before it (`src/db.ts:42`) makes it a file.
 */
const HOST_PORT_SHAPE = /(?<![\w.\\/-])((?:[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*)|\d{1,3}(?:\.\d{1,3}){3}):\d{2,5}(?!\w)/gi;

/** A file and line (`db.ts:42`) is the citation a diagram is meant to hold, and looks like a host and port, so these endings mark a file. */
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|cs|rb|php|c|h|cpp|hpp|sql|json|ya?ml|md|xml|toml|sh|ps1|tf|bicep|cfg|ini|properties|gradle|proto|vue|swift|scala|lock|txt|log|csv)$/i;

/** The usual build files have no ending at all (`Dockerfile:12`, `Jenkinsfile:40`), and are among the likeliest places an architecture fact comes from. */
const BUILD_FILE = /^(?:Docker|Container|Jenkins|Make|Proc|Gem|Rake|Vagrant|Just|Brew|Tilt)file$/i;

const holdsHostPort = (text: string) => [...text.matchAll(HOST_PORT_SHAPE)].some((m) => !SOURCE_FILE.test(m[1]!) && !BUILD_FILE.test(m[1]!));

const FIX = 'Cite the file and line or the command a fact came from, not an address: a diagram holds no URL, no host with a port and nothing shaped like a credential.';

/** Every string in a value with its path, in order. */
function* strings(value: unknown, path: string): Generator<[string, string]> {
  if (typeof value === 'string') yield [path, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* strings(v, `${path}[${i}]`);
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* strings(v, path === '' ? k : `${path}.${k}`);
}

/**
 * What stops a model from being stored, every problem by path and never
 * quoting the value: a URL, a `user:password@host` or a host with a port anywhere, a token-shaped value anywhere (the same
 * rules the audit log redacts with), and a `notMapped` that is not a short
 * list of short paths. The model's own checks (ids, references, views) are
 * `loadModelValue`'s; {@link loadStorable} runs both.
 */
export function checkStorable(model: C4Model, notMapped?: readonly string[]): DiagramProblem[] {
  const problems: DiagramProblem[] = [];
  const look = (path: string, text: string) => {
    if (URL_SHAPE.test(text)) problems.push({ path, message: 'holds a URL, and a diagram holds no address' });
    if (USERINFO_SHAPE.test(text)) problems.push({ path, message: 'holds a user and password in front of a host, which is a credential' });
    else if (holdsHostPort(text)) problems.push({ path, message: 'holds a host with a port, and a diagram holds no address' });
    const secret = findSecrets(text)[0];
    if (secret) problems.push({ path, message: `holds something shaped like a secret (${secret.rule})` });
  };
  for (const [path, text] of strings(model, '')) look(path, text);
  if (notMapped !== undefined) {
    if (notMapped.length > NOT_MAPPED_LIMITS.entries) problems.push({ path: 'notMapped', message: `lists ${notMapped.length} paths, and a diagram lists at most ${NOT_MAPPED_LIMITS.entries}` });
    notMapped.forEach((entry, i) => {
      const path = `notMapped[${i}]`;
      if (entry.trim() === '') problems.push({ path, message: 'is empty' });
      else if (entry.length > NOT_MAPPED_LIMITS.length) problems.push({ path, message: `is longer than ${NOT_MAPPED_LIMITS.length} characters` });
      else look(path, entry);
    });
  }
  return problems;
}

/** A model from JSON text, checked in full as `save` will check it: the C4 checks, then {@link checkStorable}. Every problem is named by path. */
export function loadStorable(text: string, where: string, notMapped?: readonly string[]): C4Model {
  let value: unknown;
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (err) {
    throw new ToilError('INVALID_INPUT', `${where} is not valid JSON: ${(err as Error).message}`, { fix: 'Pass one JSON object, the C4 model.' });
  }
  const model = loadModelValue(unwrapEnvelope(value, where), where);
  const problems = checkStorable(model, notMapped);
  if (problems.length > 0) {
    const shown = problems.slice(0, 20).map((p) => `${p.path} ${p.message}`);
    const more = problems.length > 20 ? `; and ${problems.length - 20} more` : '';
    throw new ToilError('INVALID_INPUT', `${where} can't be stored as a diagram: ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}: ${shown.join('; ')}${more}.`, { fix: FIX, details: problems });
  }
  return model;
}

/** The views a model draws, each by key, type and title as drawn. */
export const viewsOf = (model: C4Model) => model.views.map((v) => ({ key: v.key, type: v.type, title: viewTitle(model, v) }));

/**
 * What a model holds. `observed`, `inferred` and `unmarked` count every
 * element and every relationship once, by whether it says how it is known.
 */
export function countsOf(model: C4Model) {
  let elements = 0;
  let observed = 0;
  let inferred = 0;
  let unmarked = 0;
  const tally = (x: { how?: 'observed' | 'inferred' | undefined }) => {
    if (x.how === 'observed') observed++;
    else if (x.how === 'inferred') inferred++;
    else unmarked++;
  };
  const element = (x: { how?: 'observed' | 'inferred' | undefined }) => {
    elements++;
    tally(x);
  };
  for (const p of model.people ?? []) element(p);
  for (const s of model.systems) {
    element(s);
    for (const c of s.containers ?? []) {
      element(c);
      for (const k of c.components ?? []) element(k);
    }
  }
  for (const r of model.relationships ?? []) tally(r);
  return { elements, relationships: (model.relationships ?? []).length, observed, inferred, unmarked };
}

/** The file's text: two-space JSON and a final newline, so a person's diff of it reads. */
export function diagramContent(d: StoredDiagram): string {
  return `${JSON.stringify({ schemaVersion: d.schemaVersion, toilProject: d.toilProject, revision: d.revision, savedAt: d.savedAt, toilVersion: d.toilVersion, model: d.model, ...(d.notMapped === undefined ? {} : { notMapped: d.notMapped }) }, null, 2)}\n`;
}

export interface DiagramCatalogOptions {
  home: string;
  /** toil's own files beyond `~/.toil` (the --config file); a diagram never lands on one. */
  protect: readonly string[];
}

export interface DiagramCatalog {
  /** `~/.toil/diagrams`. */
  folder(): string;
  /** Where the diagram for the toil project `name` lives. */
  fileFor(name: string): string;
  /** The diagram for `name`, or undefined when there is none; CONFIG_INVALID when the file is there and isn't a valid diagram. */
  read(name: string): FoundDiagram | undefined;
  /** Every valid diagram, by name; a file that can't be read is a warning. */
  list(): { diagrams: FoundDiagram[]; warnings: Warning[] };
  /** Writes the diagram: `create` refuses one that is there, `replace` replaces only a valid diagram and counts the revision up. Returns what was written. */
  save(name: string, input: { model: C4Model; notMapped?: readonly string[] | undefined; toilVersion: string; mode: 'create' | 'replace'; now?: Date }): FoundDiagram;
  /** Deletes the diagram for `name`, only if the file is a valid diagram in the folder. Returns the file. */
  remove(name: string): string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function createDiagramCatalog(o: DiagramCatalogOptions): DiagramCatalog {
  const own = join(o.home, '.toil');
  const folder = join(own, 'diagrams');

  /** A path's canonical form whether or not it exists yet: the nearest part that does, real-pathed, with the rest added back. */
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

  const nameChecked = (name: string) => {
    if (!CONNECTION_NAME.test(name)) {
      throw new ToilError('INVALID_INPUT', `"${name}" isn't a toil project name.`, { fix: 'A name is lowercase letters, digits and single hyphens, starting with a letter, e.g. payments.' });
    }
    return name;
  };

  /**
   * The folder and the file as they really are, refused when either leads out
   * of `~/.toil/diagrams` (a link) or onto toil's own files or a system path.
   */
  const placed = (name: string): string => {
    const file = join(folder, `${nameChecked(name)}.json`);
    const target = real(file);
    const root = real(folder);
    const trusted = inside(root, real(own)) && inside(target, root) && !isSystemPath(target) && !o.protect.some((p) => resolve(p) !== resolve(own) && inside(target, real(p)));
    if (!trusted) {
      throw new ToilError('INVALID_INPUT', `toil won't use ${forwardSlashes(file)}: it's a link to somewhere outside ${forwardSlashes(folder)}.`, {
        fix: `Replace the link with a plain folder or file, or move it aside.`,
      });
    }
    return target;
  };

  /** Reads one file already judged to be in bounds, as the diagram it must be. */
  const readAt = (path: string, expectName?: string): FoundDiagram => {
    const file = forwardSlashes(path);
    const invalid = (why: string, fix = `Fix it in ${file}, or move it aside and save the diagram again.`) => new ToilError('CONFIG_INVALID', `Diagram ${file} can't be used: ${why}.`, { fix });
    let text: string | undefined;
    try {
      text = readCapped(path, MAX_DIAGRAM_BYTES);
    } catch (err) {
      throw new ToilError('CONFIG_INVALID', `Diagram ${file} can't be read: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}.`, { fix: `Check that ${file} is readable.` });
    }
    if (text === undefined) throw invalid(`it is larger than ${MAX_DIAGRAM_BYTES / 1024 / 1024} MiB, the most a diagram file may be`, 'A diagram holds one C4 model; move anything else out of it.');
    let value: unknown;
    try {
      value = parseStrictJson(text).value;
    } catch (err) {
      // Where, never what: the content stays in the file.
      throw invalid(`it isn't valid JSON: ${err instanceof JsonSyntaxError ? err.message : 'unreadable'}`);
    }
    if (!isRecord(value)) throw invalid('it is not a JSON object');
    const version = value.schemaVersion;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw invalid('"schemaVersion" must be a whole number, 1 or more');
    if (version > DIAGRAM_SCHEMA_VERSION) {
      throw new ToilError('CONFIG_INVALID', `Diagram ${file} is schema version ${version}, and this toil reads up to ${DIAGRAM_SCHEMA_VERSION}.`, { fix: 'Upgrade toil (npm install -g @imagile-dev/toil), then read it again.' });
    }
    const project = value.toilProject;
    if (typeof project !== 'string' || !CONNECTION_NAME.test(project)) throw invalid('"toilProject" must be a toil project name');
    if (expectName !== undefined && project !== expectName) throw invalid(`it is for toil project "${project}", and a diagram is kept in <toil-project>.json`);
    if (typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 1) throw invalid('"revision" must be a whole number, 1 or more');
    if (typeof value.savedAt !== 'string' || Number.isNaN(Date.parse(value.savedAt))) throw invalid('"savedAt" must be a date and time');
    if (typeof value.toilVersion !== 'string') throw invalid('"toilVersion" must be text');
    const notMapped = value.notMapped;
    if (notMapped !== undefined && !(Array.isArray(notMapped) && notMapped.every((n) => typeof n === 'string'))) throw invalid('"notMapped" must be a list of paths');
    let model: C4Model;
    try {
      model = loadModelValue(value.model, `${file} (model)`);
    } catch (err) {
      if (err instanceof ToilError) throw new ToilError('CONFIG_INVALID', err.message, { fix: `Fix the model in ${file}.`, ...(err.details === undefined ? {} : { details: err.details }) });
      throw err;
    }
    return {
      file,
      diagram: { schemaVersion: version, toilProject: project, revision: value.revision, savedAt: value.savedAt, toilVersion: value.toilVersion, model, ...(notMapped === undefined ? {} : { notMapped: notMapped as string[] }) },
    };
  };

  const isFile = (path: string) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  };

  const read: DiagramCatalog['read'] = (name) => {
    const target = placed(name);
    return isFile(target) ? readAt(target, name) : undefined;
  };

  const list: DiagramCatalog['list'] = () => {
    const diagrams: FoundDiagram[] = [];
    const warnings: Warning[] = [];
    let names: string[];
    try {
      names = readdirSync(folder).filter((n) => n.toLowerCase().endsWith('.json')).sort();
    } catch {
      return { diagrams, warnings };
    }
    for (const n of names) {
      const name = n.replace(/\.json$/i, '');
      try {
        const found = read(name);
        if (found) diagrams.push(found);
      } catch (err) {
        if (!(err instanceof ToilError)) throw err;
        warnings.push({ code: 'DIAGRAM_SKIPPED', message: `${forwardSlashes(join(folder, n))} was skipped: ${err.message}` });
      }
    }
    return { diagrams, warnings };
  };

  const save: DiagramCatalog['save'] = (name, input) => {
    const target = placed(name);
    const refuse = (why: string, fix: string) => new ToilError('INVALID_INPUT', `toil won't write a diagram to ${forwardSlashes(target)}: ${why}`, { fix });
    let revision = 1;
    if (isFile(target)) {
      if (input.mode === 'create') throw refuse(`toil project "${name}" already has a diagram.`, 'Pass --replace to replace it; the revision goes up by one.');
      let before: FoundDiagram;
      try {
        before = readAt(target, name);
      } catch {
        throw refuse("the file there isn't a valid diagram, and toil only ever replaces a diagram.", 'Move that file aside, then save again.');
      }
      revision = before.diagram.revision + 1;
    }
    const diagram: StoredDiagram = {
      schemaVersion: DIAGRAM_SCHEMA_VERSION,
      toilProject: name,
      revision,
      savedAt: (input.now ?? new Date()).toISOString(),
      toilVersion: input.toilVersion,
      model: input.model,
      ...(input.notMapped === undefined || input.notMapped.length === 0 ? {} : { notMapped: [...input.notMapped] }),
    };
    const content = diagramContent(diagram);
    if (Buffer.byteLength(content, 'utf8') > MAX_DIAGRAM_BYTES) {
      throw new ToilError('INVALID_INPUT', `The diagram is larger than ${MAX_DIAGRAM_BYTES / 1024 / 1024} MiB, the most a diagram file may be.`, { fix: 'Split the model, or drop elements and relationships that add nothing.' });
    }
    // Your own folder is yours alone, as the config is.
    mkdirSync(resolve(target, '..'), { recursive: true, mode: 0o700 });
    // Written alongside and renamed into place, so a crash halfway leaves the old file, not half a new one.
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, content, { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, target);
    return { diagram, file: forwardSlashes(target) };
  };

  const remove: DiagramCatalog['remove'] = (name) => {
    const target = placed(name);
    if (!isFile(target)) throw new ToilError('NOT_FOUND', `There's no diagram for toil project "${name}" in ${forwardSlashes(folder)}.`, { fix: 'Run toil projects diagram list to see the diagrams that are kept.' });
    try {
      readAt(target, name);
    } catch {
      throw new ToilError('INVALID_INPUT', `toil won't delete ${forwardSlashes(target)}: it isn't a valid diagram, and toil only ever deletes a diagram.`, { fix: 'Delete or move that file yourself.' });
    }
    rmSync(target);
    return forwardSlashes(target);
  };

  return { folder: () => forwardSlashes(folder), fileFor: (name) => forwardSlashes(join(folder, `${nameChecked(name)}.json`)), read, list, save, remove };
}
