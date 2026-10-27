import { z } from 'zod';
import type { AnyArea } from '../core/area.js';
import { defineConfigCommand, type AnyCommand } from '../core/command.js';
import { connectionWrites, defaultConnectionName, type ResolvedConfig } from '../core/config.js';
import type { CommandContext } from '../core/context.js';
import { dossierContent, selectorHost, stripUserinfo, type Applied, type Dossier, type DossierCatalog, type DossierFile, type DossierProblem, type Selection } from '../core/dossier.js';
import { ToilError, toToilError } from '../core/errors.js';
import { forwardSlashes } from '../core/files.js';

/**
 * `toil dossiers list | show | check | context`: reading the dossiers toil can
 * see, and what a folder resolves to. All of them are reads of local files:
 * none contacts a service, and none prints anything from a connection beyond
 * its name and whether writes are on. They're served over MCP, so an agent can
 * see where a call's context will come from before it makes one.
 *
 * Each returns plain data a menu can lay out (#56): every list is sorted,
 * every path absolute with forward slashes, and every problem carries the
 * key path it's about. The filing system has been audited and found to
 * contain files.
 */
export function dossiersCommands(areas: readonly AnyArea[]): AnyCommand[] {
  const cwdOption = { flags: '--cwd <dir>', field: 'cwd', description: 'The folder to look from (default: the working directory)' };
  const cwdField = z.string().min(1).optional().describe('The folder to look from; its repository decides which checked-in dossiers apply. Defaults to the workspace.');
  const nameField = z.string().min(1).optional().describe('A dossier name, or the path to a dossier file. Defaults to the dossier that applies to the folder.');

  const list = defineConfigCommand({
    path: ['dossiers', 'list'],
    description: 'List every dossier toil can see, where each lives, and any that are broken',
    toolDescription:
      'Lists every dossier toil can read: your own (~/.toil/dossiers), the folders listed in dossierPaths or TOIL_DOSSIER_PATHS, and the ones checked into the repository the folder is in. Each has its name, description, source (user, listed or repo), file, and the file that takes precedence when two share a name. Broken files are listed with what is wrong. Reads local files only.',
    input: z.object({ cwd: cwdField }),
    writes: false,
    writesLocal: false,
    options: [cwdOption],
    examples: [{}, { cwd: '.' }],
    run: async (input, ctx) => {
      const catalog = dossiersOf(ctx);
      const { files, folder, warnings } = catalog.scan(input.cwd);
      for (const w of warnings) ctx.warn(w);
      const places = catalog.places(input.cwd);
      const first = new Map<string, string>();
      for (const f of files) if (f.dossier && !first.has(f.dossier.name)) first.set(f.dossier.name, f.file);
      return {
        folder: folder.path ? { path: forwardSlashes(folder.path), from: folder.from } : null,
        places: { user: forwardSlashes(places.user), listed: places.listed.map(forwardSlashes), repo: places.repo ? forwardSlashes(places.repo) : null },
        dossiers: files
          .filter((f): f is DossierFile & { dossier: Dossier } => f.dossier !== undefined)
          .map((f) => ({
            name: f.dossier.name,
            description: f.dossier.description ?? null,
            source: f.source,
            file: forwardSlashes(f.file),
            shadowedBy: first.get(f.dossier.name) === f.file ? null : forwardSlashes(first.get(f.dossier.name)!),
            problems: f.problems.length,
          })),
        broken: files.filter((f) => !f.dossier).map((f) => ({ source: f.source, file: forwardSlashes(f.file), problems: f.problems.filter((p) => p.level === 'error').map(problemOut) })),
      };
    },
  });

  const show = defineConfigCommand({
    path: ['dossiers', 'show'],
    description: 'Print a dossier, and the connection, environment and inputs it gives each area',
    toolDescription:
      "Prints one dossier (by name or file, or the one that applies to the folder) with, for each area it covers, the connection a call would use and why (the dossier's connection or host selector, or your default), whether writes are on for that connection, the environment, and the context inputs the dossier supplies. Use it before running area commands to see where their context will come from. Never prints a secret.",
    input: z.object({ dossier: nameField, cwd: cwdField }),
    writes: false,
    writesLocal: false,
    args: [{ name: 'dossier', field: 'dossier', description: 'A dossier name or file (default: the one the folder matches)', required: false }],
    options: [cwdOption],
    examples: [{ dossier: 'payments' }, { dossier: 'payments', cwd: '.' }],
    run: async (input, ctx) => {
      const catalog = dossiersOf(ctx);
      const applied = chosen(catalog, input, ctx);
      const { dossier, source, file } = applied.file;
      return {
        name: dossier.name,
        source,
        file: forwardSlashes(file),
        by: applied.by,
        match: applied.match ?? null,
        repo: applied.repo ?? null,
        // Your own dossier's bindings are yours; anyone else's need `toil dossiers import` before a write follows them.
        adopted: source === 'user',
        areas: resolvedAreas(catalog, ctx.manage!.config, areas, applied),
        dossier: dossierContent(dossier),
        problems: applied.file.problems.map(problemOut),
      };
    },
  });

  const check = defineConfigCommand({
    path: ['dossiers', 'check'],
    description: 'Check a dossier locally: its schema, its connections and hosts, its remotes. Contacts no service.',
    toolDescription:
      'Checks one dossier without contacting any service: the schema, key paths given twice, unknown sections, that every "connection" exists and every "host" selects exactly one of your connections, that no remote carries a credential, and which bindings land on a connection with writes on. Returns ok and every problem with its level, code and key path; the CLI exits 1 when there is an error.',
    input: z.object({ dossier: nameField, cwd: cwdField }),
    writes: false,
    writesLocal: false,
    args: [{ name: 'dossier', field: 'dossier', description: 'A dossier name or file (default: the one the folder matches)', required: false }],
    options: [cwdOption],
    examples: [{ dossier: 'payments' }, { dossier: 'payments', cwd: '.' }],
    run: async (input, ctx) => {
      const catalog = dossiersOf(ctx);
      let target: DossierFile;
      try {
        target = chosen(catalog, input, ctx).file;
      } catch (err) {
        // A broken dossier is what check is for: report it, rather than fail on it.
        const broken = toToilError(err);
        const details = broken.details as Array<{ path: string; message: string }> | undefined;
        if (broken.code !== 'CONFIG_INVALID' || !details) throw err;
        ctx.setExitCode(1);
        return { name: input.dossier ?? null, file: null, source: null, ok: false, problems: details.map((d) => ({ level: 'error', code: 'DOSSIER_INVALID', path: d.path, message: d.message })), message: broken.message };
      }
      const { ok, problems } = checkDossier(catalog, ctx.manage!.config, areas, target as DossierFile & { dossier: Dossier }, input.cwd);
      if (!ok) ctx.setExitCode(1);
      return { name: target.dossier!.name, file: forwardSlashes(target.file), source: target.source, ok, problems };
    },
  });

  const context = defineConfigCommand({
    path: ['dossiers', 'context'],
    description: 'Show which dossier a folder resolves to, and why',
    toolDescription:
      "Shows what a folder resolves to: its repository (root and origin remote, credentials stripped), the dossier that applies and why (TOIL_DOSSIER, a repo's path, a repo's remote, or a dossier checked into the repository), and every candidate when more than one matches, in which case area commands need dossier set explicitly. Reads local files only.",
    input: z.object({ cwd: cwdField }),
    writes: false,
    writesLocal: false,
    options: [cwdOption],
    examples: [{}, { cwd: '.' }],
    run: async (input, ctx) => {
      const selection = dossiersOf(ctx).select({ cwd: input.cwd });
      for (const w of selection.warnings) ctx.warn(w);
      return contextOut(selection);
    },
  });

  return [list, show, check, context];
}

/**
 * What `dossiers check` finds in one dossier, against `config`: the file's own
 * problems (a credential in a remote is an error here), every binding checked
 * against your connections, and the same name in another place. Exported for
 * `dossiers onboard`, which ends with it after setting connections up.
 */
export function checkDossier(catalog: DossierCatalog, config: ResolvedConfig, areas: readonly AnyArea[], target: DossierFile & { dossier: Dossier }, cwd: string | undefined) {
  const problems = [...target.problems.map((p) => (p.code === 'DOSSIER_REMOTE_USERINFO' ? { ...p, level: 'error' as const } : p)), ...bindingProblems(catalog, config, areas, target)];
  const others = catalog.scan(cwd).files.filter((f) => f.dossier?.name === target.dossier.name && f.file !== target.file);
  for (const other of others) {
    problems.push({ level: 'warning', code: 'DOSSIER_DUPLICATE_NAME', path: 'name', message: `A dossier with the same name is also in ${forwardSlashes(other.file)} (${other.source}).` });
  }
  return { ok: !problems.some((p) => p.level === 'error'), problems: problems.map(problemOut) };
}

function dossiersOf(ctx: CommandContext<unknown>): DossierCatalog {
  if (!ctx.manage) throw new Error('A dossiers command ran without ctx.manage; define it with defineConfigCommand.');
  if (!ctx.manage.dossiers) throw new ToilError('NOT_CONFIGURED', 'Dossiers are not available here.', { fix: 'Run toil dossiers from the CLI or toil mcp.' });
  return ctx.manage.dossiers;
}

/** The dossier a show or check is about: the one named, or the one the folder resolves to. */
export function chosen(catalog: DossierCatalog, input: { dossier?: string | undefined; cwd?: string | undefined }, ctx: CommandContext<unknown>): Applied {
  const selection = catalog.select({ dossier: input.dossier, cwd: input.cwd });
  for (const w of selection.warnings) ctx.warn(w);
  if (selection.applied) return selection.applied;
  const where = selection.folder.path ? forwardSlashes(selection.folder.path) : 'here';
  if (selection.candidates.length > 1) {
    throw new ToilError('INVALID_INPUT', `${selection.candidates.length} dossiers apply to ${where}: ${selection.candidates.map((c) => c.file.dossier.name).join(', ')}.`, {
      fix: `Name one: toil dossiers show <name>.`,
    });
  }
  throw new ToilError('INVALID_INPUT', `No dossier applies to ${where}.`, { fix: 'Name one (toil dossiers list shows them), or pass --cwd for a folder in one of its repositories.' });
}

function problemOut(p: DossierProblem) {
  return { level: p.level, code: p.code, path: p.path, message: p.message };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Per area the dossier covers: the connection a call would use (the dossier's
 * binding, else your default) and whether writes are on for it, the
 * environment, and the context inputs the dossier supplies for the folder's
 * repo. A host that selects none or several is that area's `error`, not the
 * whole command's.
 */
function resolvedAreas(catalog: DossierCatalog, config: ResolvedConfig, areas: readonly AnyArea[], applied: Applied) {
  const dossier = applied.file.dossier;
  const covered = new Set([...Object.keys(dossier.sections), ...Object.values(dossier.environments).flatMap((e) => Object.keys(e))]);
  const out: Record<string, unknown> = {};
  for (const area of areas.filter((a) => covered.has(a.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    // As a call with no --env sees it: the dossier's environment section first, then its own section.
    const envSection = dossier.env === undefined ? undefined : dossier.environments[dossier.env]?.[area.name];
    const env = 'env' in area.context && envSection ? dossier.env : undefined;
    const sections = [envSection, dossier.sections[area.name]].filter(isRecord);
    const inputs: Record<string, string> = {};
    for (const name of Object.keys(area.context)) {
      if (name === 'env') continue;
      for (const section of sections) {
        const value = section[name];
        const picked = typeof value === 'string' ? value : isRecord(value) && applied.repo !== undefined && typeof value[applied.repo] === 'string' ? (value[applied.repo] as string) : undefined;
        if (picked !== undefined) {
          inputs[name] = picked;
          break;
        }
      }
    }
    try {
      const bound = catalog.binding(dossier, area.name, dossier.env);
      const name = bound.connection ?? defaultConnectionName(config, area.name);
      // For an area with deployments, which one the connection is, as the call would resolve it (the connection, then defaults.<area>, then the area's own).
      const deployment = name === undefined || area.variants === undefined ? undefined : String({ ...area.defaults, ...config.defaults[area.name], ...config.connections[name] }[area.variants.by as string] ?? '');
      const connection = name === undefined ? null : { value: name, source: bound.connection ? 'dossier' : 'default', ...(bound.host ? { host: bound.host } : {}), ...(deployment ? { deployment } : {}) };
      out[area.name] = { connection, writes: name === undefined ? null : connectionWrites(config.connections[name]), env: env ?? null, inputs };
    } catch (err) {
      const e = toToilError(err);
      out[area.name] = { connection: null, writes: null, env: env ?? null, inputs, error: { code: e.code, message: e.message, ...(e.fix ? { fix: e.fix } : {}) } };
    }
  }
  return out;
}

/** Bindings checked against your connections: each exists, each host picks exactly one, and which land on writes. */
function bindingProblems(catalog: DossierCatalog, config: ResolvedConfig, areas: readonly AnyArea[], file: DossierFile & { dossier: Dossier }): DossierProblem[] {
  const dossier = file.dossier;
  const byName = new Map(areas.map((a) => [a.name, a]));
  const problems: DossierProblem[] = [];
  const sections: Array<[string, string, string | undefined]> = [
    ...Object.keys(dossier.sections).map((area) => [area, area, undefined] as [string, string, undefined]),
    ...Object.entries(dossier.environments).flatMap(([env, byArea]) => Object.keys(byArea).map((area) => [area, `environments.${env}.${area}`, env] as [string, string, string])),
  ];
  for (const [area, path, env] of sections) {
    if (!byName.has(area)) continue;
    const section = env === undefined ? dossier.sections[area]! : dossier.environments[env]![area]!;
    let name: string | undefined;
    if (typeof section.connection === 'string') {
      const conn = config.connections[section.connection];
      // A dossier others read selects by host: a teammate's connection on the same host has a name of its own.
      if (file.source !== 'user' && conn?.area === area) {
        const host = selectorHost(conn, byName.get(area)!.siteApis);
        problems.push({
          level: 'warning',
          code: 'DOSSIER_CONNECTION_SHARED',
          path: `${path}.connection`,
          message: `This shared dossier selects connection "${section.connection}" by name, which works only for readers who named theirs the same. Select it by host instead: ${host ? `"host": "${host}"` : `"host" set to the connection's host`} (toil dossiers ${env ? `env ${dossier.name} ${env}` : `link ${dossier.name}`} ${area} --host ${host ?? '<host>'} --replace).`,
        });
      }
      if (!conn || conn.area !== area) {
        problems.push({ level: 'error', code: 'DOSSIER_UNKNOWN_CONNECTION', path: `${path}.connection`, message: `You have no ${area} connection named "${section.connection}".` });
        continue;
      }
      name = section.connection;
    } else if (typeof section.host === 'string') {
      try {
        name = catalog.binding({ ...dossier, sections: { [area]: section }, environments: {} }, area, undefined, config).connection;
      } catch (err) {
        const e = toToilError(err);
        problems.push({ level: 'error', code: e.code === 'NOT_CONFIGURED' ? 'DOSSIER_HOST_UNMATCHED' : 'DOSSIER_HOST_AMBIGUOUS', path: `${path}.host`, message: e.message });
        continue;
      }
    }
    if (name !== undefined && file.source !== 'user' && connectionWrites(config.connections[name])) {
      problems.push({
        level: 'warning',
        code: 'DOSSIER_WRITES_BINDING',
        path,
        message: `This selects connection ${name}, which has writes on. Reads follow it; a write through it is refused until you adopt this dossier with toil dossiers import, or pass --connection.`,
      });
    }
  }
  return problems;
}

function contextOut(selection: Selection) {
  const entry = (a: Applied) => ({ name: a.file.dossier.name, source: a.file.source, file: forwardSlashes(a.file.file), by: a.by, match: a.match ?? null, repo: a.repo ?? null });
  return {
    folder: selection.folder.path ? { path: forwardSlashes(selection.folder.path), from: selection.folder.from } : null,
    repo: selection.repo ? { root: selection.repo.root, origin: selection.repo.origin ? stripUserinfo(selection.repo.origin) : null } : null,
    dossier: selection.applied ? entry(selection.applied) : null,
    candidates: selection.candidates.map(entry),
  };
}
