import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { AnyArea } from '../core/area.js';
import { defineConfigCommand, type AnyCommand } from '../core/command.js';
import { CONNECTION_NAME, readConfigForEdit, writeConfigFile } from '../core/config.js';
import type { CommandContext, ConfigAccess } from '../core/context.js';
import { ToilError } from '../core/errors.js';
import { forwardSlashes, isSystemPath, protectedPath, systemPath } from '../core/files.js';
import { assertLocalPath } from '../core/local-path.js';
import { Collector, ImportFormatError, type DbSettings, type Parsed } from './import/common.js';
import { FORMATS, FROM_VALUES, formatFor, type Where } from './import/index.js';
import { planImport, slugName, type ExistingConnection } from './import/plan.js';
import { parseConnectionString } from './import/strings.js';

/**
 * `toil connections import`: brings the database connections a person already
 * has in another tool (DBeaver, SSMS, pgAdmin, DataGrip, ...) into toil as `db`
 * connections. A preview unless `--save` says otherwise; it never overwrites a
 * connection, never imports a secret, and never turns writes on.
 *
 * The file it reads is the other tool's own, on this machine, at its default
 * location or at the path the person typed: outside the file workspace, which
 * is the `connections.import` exception in docs/bounds.md. It still refuses
 * toil's own config, `/proc`, `/sys`, and any network or device path, and it
 * reads no file larger than 4 MB. A connection list that size has either seen
 * things or is not a connection list.
 */
const MAX_BYTES = 4 * 1024 * 1024;

export function importCommand(areas: readonly AnyArea[]): AnyCommand {
  return defineConfigCommand({
    path: ['connections', 'import'],
    description: "Bring database connections saved in another tool (DBeaver, SSMS, pgAdmin, ...) into toil as db connections: a preview, until --save",
    input: z.object({
      from: z.enum(FROM_VALUES).optional().describe(`Which tool's file to read: ${FROM_VALUES.join(', ')} (url is one connection string, given with --url)`),
      file: z.string().min(1).optional().describe("The tool's file; left out, toil looks where the tool keeps it on this OS and says which file it read"),
      url: z.string().min(1).optional().describe('One connection string instead of a file: postgres://, mysql://, jdbc:..., an ADO.NET string or an absolute SQLite path. Any password in it is dropped'),
      name: z.string().min(1).optional().describe('With --url: the connection name to create (lowercase letters, digits, single hyphens)'),
      prefix: z.string().min(1).optional().describe('Put this in front of every name created, e.g. --prefix corp'),
      user: z.string().min(1).optional().describe('A user for every connection the file gives none (DBeaver and tnsnames.ora keep logins elsewhere)'),
      save: z.boolean().optional().describe('Create the connections. Without it, nothing is written and the result says what would be'),
    }),
    writes: false,
    writesLocal: true,
    kind: 'cli-only',
    args: [{ name: 'file', field: 'file', description: "The tool's file (left out: its default location on this OS)", required: false }],
    options: [
      { flags: '--from <format>', field: 'from', description: `The tool: ${FROM_VALUES.join(', ')}` },
      { flags: '--url <connection-string>', field: 'url', description: 'One connection string instead of a file (any password in it is dropped)' },
      { flags: '--name <name>', field: 'name', description: 'With --url: the name of the connection to create' },
      { flags: '--prefix <text>', field: 'prefix', description: 'Put this in front of every name created' },
      { flags: '--user <name>', field: 'user', description: 'A user for every connection the file gives none' },
      { flags: '--save', field: 'save', description: 'Create the connections (default: preview only). Secrets are never imported; enter each password with toil connections login' },
    ],
    examples: [{ from: 'dbeaver' }, { from: 'pgadmin', file: 'servers.json', prefix: 'corp', save: true }, { from: 'url', url: 'postgres://you@db.imagile.dev:5432/app', name: 'app-db' }],
    run: async (input, ctx) => runImport(ctx, areas, input),
  });
}

interface ImportInput {
  from?: string | undefined;
  file?: string | undefined;
  url?: string | undefined;
  name?: string | undefined;
  prefix?: string | undefined;
  user?: string | undefined;
  save?: boolean | undefined;
}

async function runImport(ctx: CommandContext<unknown>, areas: readonly AnyArea[], input: ImportInput) {
  if (!ctx.manage) throw new Error('connections import ran without ctx.manage; define it with defineConfigCommand.');
  const manage = ctx.manage;
  const db = areas.find((a) => a.name === 'db');
  if (!db) throw new ToilError('INVALID_INPUT', 'This toil has no db area, so there is nothing to import connections into.');

  const from = input.from ?? (input.url !== undefined ? 'url' : undefined);
  if (!from) {
    throw new ToilError('INVALID_INPUT', '--from says which tool to import from, and it was left out.', { fix: `Use --from <${FROM_VALUES.join('|')}>, or --url <connection-string> for one connection.` });
  }
  if (from === 'url') {
    if (!input.url) throw new ToilError('INVALID_INPUT', '--from url takes the connection string in --url, and it was left out.', { fix: 'Run toil connections import --url "postgres://you@db.imagile.dev/app" --name app-db.' });
    if (input.file !== undefined) throw new ToilError('INVALID_INPUT', 'A file and --url are two different sources; give one.', { fix: 'Drop the file argument, or drop --url.' });
  } else {
    if (input.url !== undefined) throw new ToilError('INVALID_INPUT', `--url is one connection string, and --from ${from} reads a file.`, { fix: 'Use --from url with --url, or drop --url.' });
    if (input.name !== undefined) throw new ToilError('INVALID_INPUT', '--name names the one connection of a --url import; a file\'s connections are named from the tool.', { fix: 'Drop --name, or use --prefix to put a word in front of every name.' });
  }
  if (input.name !== undefined && !CONNECTION_NAME.test(input.name)) {
    throw new ToilError('INVALID_INPUT', `"${input.name}" isn't a valid connection name.`, { fix: 'Use lowercase letters, digits and single hyphens, starting with a letter, e.g. app-db.' });
  }
  if (input.prefix !== undefined && !/[a-z0-9]/i.test(input.prefix)) {
    throw new ToilError('INVALID_INPUT', `--prefix "${input.prefix}" has no letters or digits to name a connection with.`, { fix: 'Use a word, e.g. --prefix corp.' });
  }

  const configPath = manage.config.files.global;
  let source: { file: string | null; fileSource: 'argument' | 'default' | 'url' };
  let parsed: Parsed;
  let urlLabel: string | undefined;
  if (from === 'url') {
    parsed = fromUrl(input.url!, input.name);
    urlLabel = parsed.candidates[0]?.label;
    source = { file: null, fileSource: 'url' };
  } else {
    const format = formatFor(from)!;
    const found = locate(manage, format, input.file);
    const text = readText(found.path);
    try {
      parsed = format.parse(text);
    } catch (err) {
      if (err instanceof ImportFormatError) throw new ToilError('INVALID_INPUT', `${forwardSlashes(found.path)}: ${err.message}`, { fix: format.howTo });
      throw err;
    }
    source = { file: forwardSlashes(found.path), fileSource: found.source };
  }

  const existing = existingConnections(manage);
  const plan = planImport({
    parsed,
    prefix: input.prefix,
    user: input.user,
    name: from === 'url' ? (input.name ?? slugName(urlLabel ?? 'db')) : undefined,
    existing,
    validate: (engine, settings) => validate(db, engine, settings),
  });

  let saved = false;
  const created = [...plan.create];
  if (input.save === true && created.length > 0) {
    // Read again at the last moment: the preview may be a while old, and a name taken in between is not ours to overwrite.
    const file = readConfigForEdit(configPath);
    const kept = [];
    for (const c of created) {
      if (file.connections[c.name]) {
        plan.exists.push({ name: c.name, source: c.source, reason: `There is already a connection named "${c.name}", so it was left as it is.` });
        continue;
      }
      file.connections[c.name] = { area: 'db', engine: c.engine, ...c.settings };
      kept.push(c);
    }
    if (kept.length > 0) {
      writeConfigFile(configPath, file);
      saved = true;
    }
    plan.create.length = 0;
    plan.create.push(...kept);
  }

  for (const warning of parsed.warnings) ctx.warn({ code: 'IMPORT_FILE_WARNING', message: warning });
  const dropped = plan.create.filter((c) => c.warnings.some((w) => /held a password/.test(w))).length;
  if (dropped > 0) {
    ctx.warn({ code: 'SECRET_NOT_IMPORTED', message: `${dropped} connection${dropped === 1 ? '' : 's'} had a password in the file. toil never imports one: it was dropped, and each connection's nextSteps says how a person enters it.` });
  }

  return {
    from,
    file: source.file,
    fileSource: source.fileSource,
    saved,
    configFile: forwardSlashes(configPath),
    counts: { connections: plan.create.length, exists: plan.exists.length, skipped: plan.skipped.length },
    connections: plan.create,
    exists: plan.exists,
    skipped: plan.skipped,
    ...(saved || plan.create.length === 0 ? {} : { saveWith: saveCommand(from, input) }),
  };
}

/** The command that saves what a preview showed, with the same choices. */
function saveCommand(from: string, input: ImportInput): string {
  const quote = (v: string) => (/[\s"']/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v);
  const parts = ['toil', 'connections', 'import', ...(from === 'url' ? ['--url', quote(input.url ?? '<connection-string>')] : [`--from`, from, ...(input.file ? [quote(input.file)] : [])])];
  if (input.name) parts.push('--name', input.name);
  if (input.prefix) parts.push('--prefix', quote(input.prefix));
  if (input.user) parts.push('--user', quote(input.user));
  parts.push('--save');
  return parts.join(' ');
}

/** One connection string as a one-connection parse result, so `--url` goes through the same plan as a file. */
function fromUrl(url: string, name: string | undefined): Parsed {
  const out = new Collector();
  const mapped = parseConnectionString(url);
  const label = name ?? 'connection';
  if ('skip' in mapped) {
    out.skip(label, `The connection string ${mapped.skip}.`);
  } else {
    const guess = mapped.settings.database ?? mapped.settings.host ?? 'db';
    out.add({ label: name ?? guess, group: [], engine: mapped.engine, settings: mapped.settings, warnings: mapped.warnings });
  }
  return out.result();
}

function validate(db: AnyArea, engine: string, settings: DbSettings): string | undefined {
  const parsed = (db.connection as z.ZodObject).safeParse({ ...(db.defaults ?? {}), engine, ...settings });
  if (parsed.success) return undefined;
  const messages = [...new Set(parsed.error.issues.map((i) => i.message))];
  return `can't be a db connection: ${messages.join(' ')}`;
}

/** The connections that already exist, from the file and from env vars alike, with the settings a duplicate check compares. */
function existingConnections(manage: ConfigAccess): ExistingConnection[] {
  return Object.entries(manage.config.connections).map(([name, conn]) => {
    if (conn.area !== 'db') return { name };
    const s = conn as Record<string, unknown>;
    return {
      name,
      db: {
        ...(typeof s.engine === 'string' ? { engine: s.engine } : {}),
        ...(typeof s.host === 'string' ? { host: s.host } : {}),
        ...(typeof s.port === 'number' ? { port: s.port } : {}),
        ...(typeof s.database === 'string' ? { database: s.database } : {}),
        ...(typeof s.path === 'string' ? { path: s.path } : {}),
      },
    };
  });
}

/** Where this machine is, for the tool's default file locations. */
function whereAmI(manage: ConfigAccess): Where {
  const env = manage.env;
  const home = (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir();
  return {
    platform: process.platform,
    home,
    env,
    cwd: process.cwd(),
    list: (dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    },
  };
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** The file to read: the one named, or the first the tool's default locations hold. Either way it passes the same checks. */
function locate(manage: ConfigAccess, format: (typeof FORMATS)[number], named: string | undefined): { path: string; source: 'argument' | 'default' } {
  const where = whereAmI(manage);
  if (named !== undefined) {
    const path = resolve(where.cwd, named);
    assertLocalPath(path, undefined, 'The file');
    refuseOwn(path, manage, where.home);
    if (!existsSync(path)) {
      throw new ToilError('NOT_FOUND', `There is no file at ${forwardSlashes(path)}.`, { fix: format.howTo });
    }
    if (!isFile(path)) throw new ToilError('INVALID_INPUT', `${forwardSlashes(path)} is not a file.`, { fix: format.howTo });
    return { path, source: 'argument' };
  }
  const searched = format.locations(where);
  for (const path of searched) {
    assertLocalPath(path, undefined, 'The default location');
    if (isFile(path)) {
      refuseOwn(path, manage, where.home);
      return { path, source: 'default' };
    }
  }
  const looked = searched.length > 0 ? ` Looked in: ${searched.map(forwardSlashes).join(', ')}.` : ' It keeps no file in a fixed place on this OS.';
  throw new ToilError('NOT_FOUND', `toil found no ${format.label} file to import from.${looked}`, { fix: `${format.howTo} Then run toil connections import --from ${format.id} <file>.` });
}

/** Refuses toil's own config and credentials, `/proc` and `/sys`, compared after realpath so a link can't get around it. */
function refuseOwn(path: string, manage: ConfigAccess, home: string): void {
  const real = realish(path);
  if (isSystemPath(real)) throw systemPath(path);
  const compare = (p: string) => (process.platform === 'win32' ? forwardSlashes(p).toLowerCase() : forwardSlashes(p));
  const target = compare(real);
  for (const own of [join(home, '.toil'), manage.config.files.global]) {
    const guarded = compare(realish(own));
    if (target === guarded || target.startsWith(`${guarded.replace(/\/+$/, '')}/`)) throw protectedPath(path);
  }
}

function realish(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** The file as text: capped at 4 MB, with a UTF-16 byte-order mark honoured (SSMS and friends are from Windows, where it happens). */
function readText(path: string): string {
  const size = statSync(path).size;
  if (size > MAX_BYTES) {
    throw new ToilError('INVALID_INPUT', `${forwardSlashes(path)} is ${(size / 1024 / 1024).toFixed(1)} MB, and toil reads connection lists of at most 4 MB.`, { fix: 'Export only the connections you want, or pass a smaller file.' });
  }
  const bytes = readFileSync(path);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString('utf16le').replace(/^\uFEFF/, '');
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}
