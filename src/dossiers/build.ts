import { rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { AnyArea, ContextInput } from '../core/area.js';
import { defineConfigCommand, type AnyCommand } from '../core/command.js';
import { dossierConnection } from '../core/call-context.js';
import { CONNECTION_NAME, connectionWrites, defaultConnectionName, type ResolvedConfig } from '../core/config.js';
import type { CommandContext, ConfigAccess } from '../core/context.js';
import { dossierContent, hasSecretUserinfo, normalizeRemote, samePath, stripUserinfo, type Dossier, type DossierCatalog, type DossierFile, type Section } from '../core/dossier.js';
import { ToilError, toToilError } from '../core/errors.js';
import { forwardSlashes } from '../core/files.js';

/**
 * `toil dossiers init | add-repo | link | env | field | export | import |
 * remove`: building a dossier, and sharing one through a repository.
 *
 * Writing a dossier is a local write, so none of these needs --allow-write,
 * which governs changes to remote systems; an agent may build one over MCP.
 * What an agent may not do is make a dossier point a write somewhere new:
 * over MCP, any change that would make a section select a connection with
 * writes on, when it didn't before, is refused, and so is importing or
 * exporting a dossier with such a binding (docs/dossiers.md, Agents and the
 * write gate). A person does that on the CLI.
 *
 * Every edit refuses to add what's already there, naming the entry, unless
 * --replace says to change it: a dossier is never quietly given a second
 * copy of anything. The file is checked with the reader that will load it
 * before it's written, so toil never writes a dossier it would refuse. Each
 * amendment is countersigned by the same clerk who will later read it.
 */
export function dossierBuildCommands(areas: readonly AnyArea[]): AnyCommand[] {
  const areaNamed = (name: string): AnyArea => {
    const area = areas.find((a) => a.name === name);
    if (area) return area;
    throw new ToilError('INVALID_INPUT', `toil has no area named "${name}".`, { fix: `Use one of: ${areas.map((a) => a.name).join(', ')}.` });
  };
  const dossierArg = { name: 'dossier', field: 'dossier', description: 'The dossier: a name, or the path to a dossier file' };
  const dossierField = z.string().min(1).describe('The dossier to change: a name, or the path to a dossier file');
  const replaceOption = { flags: '--replace', field: 'replace', description: 'Change a value that is already set, rather than refuse' };
  const replaceField = z.boolean().optional().describe('Change a value that is already set. Without it, a value already there is refused, naming it.');

  const init = defineConfigCommand({
    path: ['dossiers', 'init'],
    description: 'Create a dossier in your own folder (~/.toil/dossiers)',
    toolDescription:
      'Creates an empty dossier, ~/.toil/dossiers/<name>.json, for one body of work. Build it up with dossiers_add_repo, dossiers_link, dossiers_env and dossiers_field. A local write: it needs no allowWrite. Refuses a name already in your folder.',
    input: z.object({
      name: z.string().min(1).describe('The dossier name: lowercase letters, digits and single hyphens, e.g. payments'),
      description: z.string().min(1).optional().describe('One line saying what the body of work is'),
    }),
    writes: false,
    args: [{ name: 'name', field: 'name', description: 'The dossier name, e.g. payments' }],
    options: [{ flags: '--description <text>', field: 'description', description: 'One line saying what it covers' }],
    examples: [{ name: 'billing' }, { name: 'billing', description: 'Billing platform' }],
    run: async (input, ctx) => {
      const { catalog } = access(ctx);
      if (!CONNECTION_NAME.test(input.name)) {
        throw new ToilError('INVALID_INPUT', `"${input.name}" isn't a valid dossier name.`, { fix: 'Use lowercase letters, digits and single hyphens, starting with a letter, e.g. payments.' });
      }
      const elsewhere = catalog.scan().files.filter((f) => f.dossier?.name === input.name);
      const mine = elsewhere.find((f) => f.source === 'user');
      if (mine) throw new ToilError('INVALID_INPUT', `You already have a dossier named "${input.name}" (${forwardSlashes(mine.file)}).`, { fix: `Change it with toil dossiers link ${input.name} ..., or choose another name.` });
      for (const other of elsewhere) ctx.warn({ code: 'DOSSIER_DUPLICATE_NAME', message: `A dossier named "${input.name}" is also in ${forwardSlashes(other.file)} (${other.source}); yours takes precedence.` });
      const dossier: Dossier = { name: input.name, ...(input.description ? { description: input.description } : {}), repos: [], sections: {}, environments: {} };
      const file = catalog.save(catalog.userFile(input.name), dossier, 'create');
      return { name: input.name, file, source: 'user', dossier: dossierContent(dossier) };
    },
  });

  const addRepo = defineConfigCommand({
    path: ['dossiers', 'add-repo'],
    description: 'Add a repository to a dossier, by its folder or its remote URL',
    toolDescription:
      "Adds a repository to a dossier. Give a local folder (its git root becomes the repo's path and its origin remote, without any credential, is recorded too) or a remote URL. The repo is named after the folder or the remote unless name is set. Refuses a repo name, path or remote the dossier already has. A local write: no allowWrite.",
    input: z.object({
      dossier: dossierField,
      location: z.string().min(1).describe('A local folder in the repository, or its remote URL (https://..., ssh://..., or git@host:path)'),
      name: z.string().min(1).optional().describe("The repo's name in the dossier; defaults to the folder's or remote's last part"),
      replace: replaceField,
    }),
    writes: false,
    args: [dossierArg, { name: 'location', field: 'location', description: 'A folder in the repository, or its remote URL' }],
    options: [{ flags: '--name <name>', field: 'name', description: "The repo's name in the dossier" }, replaceOption],
    examples: [
      { dossier: 'payments', location: 'git@git.imagile.dev:pay/fees-svc.git' },
      { dossier: 'payments', location: 'https://git.imagile.dev/pay/payments-api.git', name: 'payments-api', replace: true },
    ],
    run: async (input, ctx) => {
      const { catalog } = access(ctx);
      const file = catalog.find(input.dossier);
      const dossier = structuredClone(file.dossier);
      const isRemote = /^[a-z][a-z0-9+.-]*:\/\//i.test(input.location) || /^[^@/\\\s]+@[^:/\\\s]+:/.test(input.location);
      let entry: Dossier['repos'][number];
      if (isRemote) {
        if (hasSecretUserinfo(input.location)) ctx.warn({ code: 'DOSSIER_REMOTE_USERINFO', message: 'The remote had a credential in it; it was left out of the dossier.' });
        const remote = stripUserinfo(input.location);
        entry = { name: input.name ?? lastPart(remote), remotes: [remote] };
      } else {
        const { path, repo } = catalog.inspect(input.location);
        const root = repo?.root ?? forwardSlashes(path);
        entry = { name: input.name ?? basename(root), path: root, remotes: repo?.origin ? [stripUserinfo(repo.origin)] : [] };
        if (!repo) ctx.warn({ code: 'DOSSIER_NOT_A_REPO', message: `${forwardSlashes(path)} isn't in a git repository, so only its path was recorded.` });
      }
      const others = dossier.repos.filter((r) => r.name !== entry.name);
      for (const other of others) {
        const remote = entry.remotes.find((x) => other.remotes.some((y) => normalizeRemote(x) === normalizeRemote(y)));
        if (remote) throw new ToilError('INVALID_INPUT', `Dossier ${dossier.name} already has ${remote} as repo "${other.name}".`, { fix: `Leave it as it is, or remove it from "${other.name}" first.` });
        if (entry.path && other.path && samePath(entry.path, other.path)) throw new ToilError('INVALID_INPUT', `Dossier ${dossier.name} already has ${entry.path} as repo "${other.name}".`, { fix: `Leave it as it is, or remove it from "${other.name}" first.` });
      }
      const existing = dossier.repos.find((r) => r.name === entry.name);
      // Already there: the same path (or none given) and remotes it already lists. Nothing to add, so no --replace needed.
      const already =
        existing !== undefined &&
        (entry.path === undefined || (existing.path !== undefined && samePath(existing.path, entry.path))) &&
        entry.remotes.every((r) => existing.remotes.some((x) => normalizeRemote(x) === normalizeRemote(r)));
      if (existing && !already && !input.replace) {
        throw new ToilError('INVALID_INPUT', `Dossier ${dossier.name} already has a repo named "${entry.name}".`, { fix: `Pass --replace to replace it, or --name to add this one under another name.` });
      }
      if (already && !input.replace) return saved(ctx, catalog, file, dossier, false, { repo: existing });
      dossier.repos = existing ? dossier.repos.map((r) => (r.name === entry.name ? entry : r)) : [...dossier.repos, entry];
      return saved(ctx, catalog, file, dossier, existing === undefined || JSON.stringify(existing) !== JSON.stringify(entry), { repo: entry });
    },
  });

  const bindingOptions = [
    { flags: '--connection <name>', field: 'connection', description: 'Select this connection of yours (for a dossier only you use)' },
    { flags: '--host <host>', field: 'host', description: "Select your connection on this host (for a shared dossier); compared, never contacted" },
    { flags: '--unbind', field: 'unbind', description: 'Remove the connection or host, so calls use your default connection' },
    { flags: '--set <key=value>', field: 'set', description: "Set a value: one of the area's context inputs (project, owner, ...) or reference data; repeatable" },
    { flags: '--add <key=value>', field: 'add', description: 'Add a value to a list of reference data (projects, boards, ...); repeatable' },
    { flags: '--for-repo <name>', field: 'forRepo', description: "Set the --set values for this one of the dossier's repos only" },
    replaceOption,
  ];
  const bindingFields = {
    connection: z.string().min(1).optional().describe('Select this connection of yours by name. For a dossier only you use.'),
    host: z.string().min(1).optional().describe("Select the reader's connection on this host (host or host:port). For a shared dossier. Compared, never contacted."),
    unbind: z.boolean().optional().describe('Remove the connection or host selector, so calls use the default connection.'),
    set: z.array(z.string().min(1)).optional().describe("Values to set, each key=value: the area's context inputs (project, owner, namespace, ...) are applied to calls; any other key is kept as reference data."),
    add: z.array(z.string().min(1)).optional().describe('Values to add to reference-data lists, each key=value (projects=PAY).'),
    forRepo: z.string().min(1).optional().describe("Set the `set` values for this one of the dossier's repos only, as an object of repo name to value."),
    replace: replaceField,
  };

  const link = defineConfigCommand({
    path: ['dossiers', 'link'],
    description: "Attach an area to a dossier: which connection it uses, and its keys",
    toolDescription:
      "Attaches an area to a dossier, or changes its section: the connection it selects (connection for a private dossier, host for a shared one, or neither for the default), the area's context inputs it supplies (set project=PAY, per repo with forRepo), and reference data (add projects=PAY). Over MCP, a change that would make the section select a connection with writes on is refused: a person does that on the CLI. A local write: no allowWrite.",
    input: z.object({ dossier: dossierField, area: z.string().min(1).describe('The area, e.g. jira'), ...bindingFields }),
    writes: false,
    args: [dossierArg, { name: 'area', field: 'area', description: 'The area, e.g. jira' }],
    options: bindingOptions,
    examples: [
      { dossier: 'payments', area: 'jira', host: 'jira.imagile.dev', set: ['project=PAY'], add: ['projects=FEES', 'projects=OPS'] },
      { dossier: 'payments', area: 'jira', unbind: true, set: ['project=LEDG'], forRepo: 'ledger-svc', replace: true },
      { dossier: 'payments', area: 'jira', connection: 'jira' },
    ],
    run: async (input, ctx) => {
      const area = areaNamed(input.area);
      return changeSection(access(ctx), ctx, area, undefined, input, false);
    },
  });

  const env = defineConfigCommand({
    path: ['dossiers', 'env'],
    description: "Add an environment's resources for an area to a dossier",
    toolDescription:
      "Sets an area's section for one environment of a dossier (environments.<env>.<area>): its connection or host, the context inputs it supplies there (set namespace=payments-prod), and reference data (add deployments=payments-api). Calls use it when the environment is the call's --env, or the dossier's default environment (default: true makes it that). Over MCP, a change that would make it select a connection with writes on is refused. A local write: no allowWrite.",
    input: z.object({
      dossier: dossierField,
      env: z.string().min(1).describe('The environment, e.g. prod'),
      area: z.string().min(1).describe('The area, e.g. openshift'),
      default: z.boolean().optional().describe("Make this the dossier's default environment"),
      ...bindingFields,
    }),
    writes: false,
    args: [dossierArg, { name: 'env', field: 'env', description: 'The environment, e.g. prod' }, { name: 'area', field: 'area', description: 'The area, e.g. openshift' }],
    options: [{ flags: '--default', field: 'default', description: "Make this the dossier's default environment" }, ...bindingOptions],
    examples: [
      { dossier: 'payments', env: 'prod', area: 'openshift', host: 'api.ocp.imagile.dev:6443', set: ['namespace=payments-prod'], add: ['deployments=payments-api'] },
      { dossier: 'payments', env: 'test', area: 'openshift', default: true, set: ['namespace=payments-test'], connection: 'openshift', unbind: false, forRepo: 'payments-api', replace: false },
    ],
    run: async (input, ctx) => {
      const area = areaNamed(input.area);
      return changeSection(access(ctx), ctx, area, input.env, input, input.default === true);
    },
  });

  const field = defineConfigCommand({
    path: ['dossiers', 'field'],
    description: "Name one of an area's fields in a dossier, so prompts use the name",
    toolDescription:
      "Adds a field alias to a dossier's area section (fields.<alias> = <field id>), e.g. storyPoints for customfield_10002, so the friendly name can be used instead of the id. The alias is a camelCase identifier. Refuses an alias or a field id already there unless replace is set. A local write: no allowWrite.",
    input: z.object({
      dossier: dossierField,
      area: z.string().min(1).describe('The area, e.g. jira'),
      alias: z.string().min(1).describe('The friendly name, a camelCase identifier, e.g. storyPoints'),
      id: z.string().min(1).describe("The service's field id, e.g. customfield_10002"),
      replace: replaceField,
    }),
    writes: false,
    args: [dossierArg, { name: 'area', field: 'area', description: 'The area' }, { name: 'alias', field: 'alias', description: 'The friendly name' }, { name: 'field-id', field: 'id', description: "The service's field id" }],
    options: [replaceOption],
    examples: [{ dossier: 'payments', area: 'jira', alias: 'storyPoints', id: 'customfield_10002' }, { dossier: 'payments', area: 'jira', alias: 'acceptanceCriteria', id: 'customfield_10234', replace: true }],
    run: async (input, ctx) => {
      const { catalog } = access(ctx);
      areaNamed(input.area);
      const file = catalog.find(input.dossier);
      const dossier = structuredClone(file.dossier);
      const section: Section = { ...(dossier.sections[input.area] ?? {}) };
      const fields = { ...((section.fields as Record<string, string> | undefined) ?? {}) };
      const current = fields[input.alias];
      const sameId = Object.entries(fields).find(([alias, id]) => id === input.id && alias !== input.alias);
      if (sameId && !input.replace) throw new ToilError('INVALID_INPUT', `${input.id} already has the alias "${sameId[0]}" in dossier ${dossier.name}.`, { fix: `Use "${sameId[0]}", or pass --replace to give it a second alias.` });
      if (current !== undefined && current !== input.id && !input.replace) {
        throw new ToilError('INVALID_INPUT', `"${input.alias}" already names ${current} in dossier ${dossier.name}.`, { fix: 'Pass --replace to point it at the new field id.' });
      }
      fields[input.alias] = input.id;
      section.fields = fields;
      dossier.sections[input.area] = section;
      return saved(ctx, catalog, file, dossier, current !== input.id, { area: input.area, fields });
    },
  });

  const exportCommand = defineConfigCommand({
    path: ['dossiers', 'export'],
    description: "Write a dossier for sharing: into a repository's .toil/dossiers, or to one file",
    toolDescription:
      "Writes a dossier for others to use: each connection name becomes a host selector taken from that connection's base URL (teammates name connections differently), and local repo paths are dropped. With repo, it writes <repo>/.toil/dossiers/<name>.json, where repo must be a working tree's root; with file, it writes that .json file. It never stages or commits. Refuses to overwrite anything but a dossier, and a dossier without replace. Over MCP, a dossier whose bindings select a connection with writes on is refused.",
    input: z.object({
      dossier: dossierField,
      repo: z.string().min(1).optional().describe('The root of a working tree to write .toil/dossiers/<name>.json into'),
      file: z.string().min(1).optional().describe('A .json file to write instead'),
      replace: replaceField,
    }),
    writes: false,
    args: [dossierArg],
    options: [
      { flags: '--repo <dir>', field: 'repo', description: "A working tree's root; writes .toil/dossiers/<name>.json there" },
      { flags: '--file <path>', field: 'file', description: 'Write one .json file instead' },
      replaceOption,
    ],
    examples: [{ dossier: 'payments', file: 'shared/payments.json' }, { dossier: 'payments', repo: '.', replace: true }],
    run: async (input, ctx) => {
      const { catalog, config, via } = access(ctx);
      if ((input.repo === undefined) === (input.file === undefined)) throw new ToilError('INVALID_INPUT', 'Pass exactly one of --repo and --file.', { fix: 'toil dossiers export <name> --repo <dir>, or --file <path>.' });
      const source = catalog.find(input.dossier);
      if (via === 'mcp') refuseWritesBindings(catalog, config, areas, source.dossier, 'export');
      const { dossier, hosts, droppedPaths } = forSharing(source.dossier, config);
      const target = input.repo !== undefined ? join(catalog.repoFolder(input.repo), `${dossier.name}.json`) : catalog.pathFor(input.file!, 'The export file');
      const file = catalog.save(target, dossier, input.replace ? 'replace' : 'create');
      return { name: dossier.name, file, hosts, droppedPaths, dossier: dossierContent(dossier) };
    },
  });

  const importCommand = defineConfigCommand({
    path: ['dossiers', 'import'],
    description: 'Copy a dossier into your own folder, adopting its bindings',
    toolDescription:
      "Copies a dossier file, or every dossier in a folder, into ~/.toil/dossiers so it's yours: you can adapt it, and writes may follow its bindings. It never creates a connection; each connection or host it names that you don't have is listed under toSetUp. A file that isn't a valid dossier is reported by key path only, never by content. Over MCP, a dossier with a binding that selects a connection with writes on is refused: a person adopts that on the CLI.",
    input: z.object({
      source: z.string().min(1).describe('A dossier file, or a folder of them (a repository\'s .toil/dossiers)'),
      name: z.string().min(1).optional().describe('A new name for it (a single file only)'),
      replace: replaceField,
    }),
    writes: false,
    args: [{ name: 'source', field: 'source', description: 'A dossier file, or a folder of them' }],
    options: [{ flags: '--name <name>', field: 'name', description: 'A new name for it (a single file only)' }, replaceOption],
    examples: [{ source: '.toil/dossiers/team.json' }, { source: '.toil/dossiers', name: undefined, replace: true }, { source: '.toil/dossiers/team.json', name: 'team-mine', replace: true }],
    run: async (input, ctx) => {
      const { catalog, config, via } = access(ctx);
      // Bounded before it's looked at, so over MCP a folder outside them can't be probed (docs/bounds.md, dossiers.read).
      const { folder: isDir, files } = catalog.importFiles(input.source);
      if (isDir && input.name !== undefined) throw new ToilError('INVALID_INPUT', '--name renames one dossier, and a folder may hold several.', { fix: 'Import the one file with --name, or the folder without it.' });
      const found: Array<DossierFile & { dossier: Dossier }> = [];
      const failed: Array<{ file: string; problems: Array<{ path: string; message: string }> }> = [];
      for (const f of files) {
        try {
          found.push(catalog.find(f));
        } catch (err) {
          const e = toToilError(err);
          // Schema problems by key path, never the file's content (docs/dossiers.md, What import reveals).
          if (!isDir || e.code !== 'CONFIG_INVALID') throw err;
          failed.push({ file: forwardSlashes(f), problems: (e.details as Array<{ path: string; message: string }> | undefined) ?? [{ path: '', message: e.message }] });
        }
      }
      const plan = found.map((f) => {
        if (f.source === 'user') throw new ToilError('INVALID_INPUT', `${forwardSlashes(f.file)} is already in your own folder.`, { fix: 'It is yours already; change it with toil dossiers link.' });
        const dossier = { ...structuredClone(f.dossier), ...(input.name !== undefined ? { name: input.name } : {}) };
        if (!CONNECTION_NAME.test(dossier.name)) throw new ToilError('INVALID_INPUT', `"${dossier.name}" isn't a valid dossier name.`, { fix: 'Use lowercase letters, digits and single hyphens, starting with a letter.' });
        if (via === 'mcp') refuseWritesBindings(catalog, config, areas, dossier, 'import');
        return { from: f.file, dossier, target: catalog.userFile(dossier.name) };
      });
      // Everything is checked before anything is written, so a refusal leaves your folder as it was.
      const mine = new Map(catalog.scan().files.filter((f) => f.source === 'user' && f.dossier).map((f) => [f.dossier!.name, f.file]));
      for (const p of plan) {
        if (mine.has(p.dossier.name) && !input.replace) {
          throw new ToilError('INVALID_INPUT', `You already have a dossier named "${p.dossier.name}" (${forwardSlashes(mine.get(p.dossier.name)!)}). Nothing was imported.`, { fix: 'Pass --replace to replace yours, or --name to import it under another name.' });
        }
      }
      const imported = plan.map((p) => ({ name: p.dossier.name, from: forwardSlashes(p.from), file: catalog.save(mine.get(p.dossier.name) ?? p.target, p.dossier, mine.has(p.dossier.name) ? 'replace' : 'create') }));
      const toSetUp = plan.flatMap((p) => unresolved(catalog, config, p.dossier));
      if (failed.length > 0) ctx.setExitCode(1);
      return { imported, toSetUp, failed };
    },
  });

  const unlink = defineConfigCommand({
    path: ['dossiers', 'unlink'],
    description: "Remove an area's section from a dossier, or one environment's",
    input: z.object({
      dossier: dossierField,
      area: z.string().min(1).describe('The section to remove, e.g. jira; one toil has no area for is accepted too'),
      env: z.string().min(1).optional().describe("Remove environments.<env>.<area> instead of the area's own section"),
    }),
    writes: false,
    // Taking a section out is a delete, and a delete is never an MCP tool (CLAUDE.md, Writes).
    kind: 'cli-only',
    args: [dossierArg],
    options: [
      { flags: '--area <area>', field: 'area', description: 'The section to remove, e.g. jira' },
      { flags: '--env <env>', field: 'env', description: "Remove that environment's section for the area instead" },
    ],
    examples: [{ dossier: 'payments', area: 'jira' }, { dossier: 'payments', area: 'openshift', env: 'prod' }],
    run: async (input, ctx) => {
      const { catalog } = access(ctx);
      const file = catalog.find(input.dossier);
      const dossier = structuredClone(file.dossier);
      const where = input.env === undefined ? input.area : `environments.${input.env}.${input.area}`;
      const holder = input.env === undefined ? dossier.sections : dossier.environments[input.env];
      const section = holder?.[input.area];
      if (!holder || section === undefined) {
        const have = [...Object.keys(dossier.sections), ...Object.entries(dossier.environments).flatMap(([env, byArea]) => Object.keys(byArea).map((area) => `${area} --env ${env}`))];
        throw new ToilError('INVALID_INPUT', `Dossier ${dossier.name} has no ${where} section.`, { fix: have.length ? `It has: ${have.join(', ')}.` : 'It has no sections yet.' });
      }
      delete holder[input.area];
      // An environment left with no areas goes too, and stops being the default.
      if (input.env !== undefined && Object.keys(holder).length === 0) {
        delete dossier.environments[input.env];
        if (dossier.env === input.env) delete dossier.env;
      }
      return saved(ctx, catalog, file, dossier, true, { area: input.area, env: input.env ?? null, removed: section });
    },
  });

  const remove = defineConfigCommand({
    path: ['dossiers', 'remove'],
    description: 'Delete one of your own dossiers',
    input: z.object({ name: z.string().min(1).describe('The name of a dossier in your own folder') }),
    writes: false,
    // A delete is never an MCP tool (CLAUDE.md, Writes); a person removes a dossier.
    kind: 'cli-only',
    args: [{ name: 'name', field: 'name', description: 'The name of a dossier in your own folder' }],
    examples: [{ name: 'payments' }],
    run: async (input, ctx) => {
      const { catalog } = access(ctx);
      const mine = catalog.scan().files.find((f) => f.source === 'user' && (f.dossier?.name === input.name || (!f.dossier && basename(f.file).replace(/\.json$/i, '') === input.name)));
      if (!mine) throw new ToilError('INVALID_INPUT', `You have no dossier named "${input.name}" in ${forwardSlashes(catalog.places().user)}.`, { fix: 'Run toil dossiers list to see the names. Only your own dossiers can be removed here.' });
      rmSync(mine.file);
      return { name: input.name, file: forwardSlashes(mine.file), deleted: true };
    },
  });

  return [init, addRepo, link, env, field, exportCommand, importCommand, unlink, remove];

  /** link and env: one section's binding, context inputs and reference data. */
  async function changeSection(
    { catalog, config, via }: Access,
    ctx: CommandContext<unknown>,
    area: AnyArea,
    envName: string | undefined,
    input: { dossier: string; connection?: string | undefined; host?: string | undefined; unbind?: boolean | undefined; set?: string[] | undefined; add?: string[] | undefined; forRepo?: string | undefined; replace?: boolean | undefined },
    makeDefault: boolean,
  ) {
    const file = catalog.find(input.dossier);
    const before = file.dossier;
    const dossier = structuredClone(before);
    const where = envName === undefined ? area.name : `environments.${envName}.${area.name}`;
    const section: Section = structuredClone((envName === undefined ? dossier.sections[area.name] : dossier.environments[envName]?.[area.name]) ?? {});
    const refuse = (message: string, fix: string) => new ToilError('INVALID_INPUT', `${message} (dossier ${dossier.name}, ${where}).`, { fix });
    const replace = input.replace === true;

    const bindings = [input.connection !== undefined, input.host !== undefined, input.unbind === true].filter(Boolean).length;
    if (bindings > 1) throw refuse('Give one of --connection, --host and --unbind', 'Each decides the connection on its own.');
    if (input.connection !== undefined) {
      const conn = config.connections[input.connection];
      if (!conn || conn.area !== area.name) throw refuse(`You have no ${area.name} connection named "${input.connection}"`, `Run toil connections list --area ${area.name} to see yours.`);
    }
    const bound = typeof section.connection === 'string' ? `connection ${section.connection}` : typeof section.host === 'string' ? `host ${section.host}` : undefined;
    const wanted = input.connection !== undefined ? `connection ${input.connection}` : input.host !== undefined ? `host ${input.host.toLowerCase()}` : undefined;
    if (wanted && bound && wanted !== bound && !replace) throw refuse(`It already selects ${bound}`, 'Pass --replace to select the new one instead.');
    if (input.connection !== undefined || input.host !== undefined || input.unbind) {
      delete section.connection;
      delete section.host;
      if (input.connection !== undefined) section.connection = input.connection;
      if (input.host !== undefined) section.host = input.host.toLowerCase();
    }

    if (input.forRepo !== undefined && !dossier.repos.some((r) => r.name === input.forRepo)) {
      throw refuse(`It has no repo named "${input.forRepo}"`, `Add it with toil dossiers add-repo ${dossier.name} <folder|remote> --name ${input.forRepo}, or use one of: ${dossier.repos.map((r) => r.name).join(', ') || '(no repos yet)'}.`);
    }
    const context = area.context as Record<string, ContextInput>;
    for (const pair of input.set ?? []) {
      const [key, value] = keyValue(pair, '--set');
      if (['connection', 'host', 'fields'].includes(key)) throw refuse(`"${key}" isn't set with --set`, key === 'fields' ? 'Use toil dossiers field.' : `Use --${key}.`);
      // A section's own env would never be read: the environment is the dossier's, or the call's --env.
      if (key === 'env' && 'env' in context) throw refuse('The environment isn\'t set with --set', `Use toil dossiers env ${dossier.name} <env> ${area.name} --default to make it the dossier's environment.`);
      const spec = context[key];
      const parsed = spec?.schema?.safeParse(value);
      if (parsed && !parsed.success) throw refuse(`"${value}" isn't a valid ${key}: ${parsed.error.issues.map((i) => i.message).join('; ')}`, 'Correct the value.');
      const current = section[key];
      if (input.forRepo !== undefined) {
        if (typeof current === 'string' && !replace) throw refuse(`${key} is already "${current}" for every repo`, 'Pass --replace to make it per repo.');
        const map: Record<string, unknown> = typeof current === 'object' && current !== null && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
        if (map[input.forRepo] !== undefined && map[input.forRepo] !== value && !replace) throw refuse(`${key} is already "${String(map[input.forRepo])}" for ${input.forRepo}`, 'Pass --replace to change it.');
        map[input.forRepo] = value;
        section[key] = map;
      } else {
        if (current !== undefined && current !== value && !replace) throw refuse(`${key} is already ${JSON.stringify(current)}`, 'Pass --replace to change it.');
        section[key] = value;
      }
      if (!spec) ctx.warn({ code: 'DOSSIER_REFERENCE_KEY', message: `"${key}" isn't one of ${area.name}'s context inputs (${Object.keys(context).join(', ') || 'it has none'}), so it's kept as reference data and not applied to calls.` });
    }
    for (const pair of input.add ?? []) {
      const [key, value] = keyValue(pair, '--add');
      if (key in context || ['connection', 'host', 'fields'].includes(key)) throw refuse(`"${key}" holds one value, not a list`, 'Use --set.');
      const current = section[key];
      if (current !== undefined && !Array.isArray(current)) throw refuse(`${key} is ${JSON.stringify(current)}, not a list`, 'Use --set to change it.');
      const list = [...((current as unknown[] | undefined) ?? [])];
      if (list.map(String).includes(value)) throw refuse(`${key} already lists ${value}`, 'Leave it as it is.');
      section[key] = [...list, value];
    }

    if (envName === undefined) dossier.sections[area.name] = section;
    else dossier.environments[envName] = { ...(dossier.environments[envName] ?? {}), [area.name]: section };
    if (makeDefault) dossier.env = envName;
    if (via === 'mcp') refuseNewWritesTarget(catalog, config, areas, before, dossier);
    for (const w of hostWarnings(catalog, dossier, area.name, envName)) ctx.warn(w);
    return saved(ctx, catalog, file, dossier, JSON.stringify(dossierContent(before)) !== JSON.stringify(dossierContent(dossier)), { area: area.name, env: envName ?? null, section });
  }
}

interface Access {
  catalog: DossierCatalog;
  config: ResolvedConfig;
  via: ConfigAccess['via'];
}

function access(ctx: CommandContext<unknown>): Access {
  if (!ctx.manage) throw new Error('A dossiers command ran without ctx.manage; define it with defineConfigCommand.');
  if (!ctx.manage.dossiers) throw new ToilError('NOT_CONFIGURED', 'Dossiers are not available here.', { fix: 'Run toil dossiers from the CLI or toil mcp.' });
  return { catalog: ctx.manage.dossiers, config: ctx.manage.config, via: ctx.manage.via };
}

/**
 * Writes an edit back where it was read from; an edit that changes nothing
 * writes nothing, unless the file holds a credential in a stored remote.
 * Remotes are read with it stripped, so any write takes every credential out
 * of the file, and an edit that reaches here always does: that's said, in a
 * warning and in `credentialsRemoved`, and counts as a change.
 */
function saved(ctx: CommandContext<unknown>, catalog: DossierCatalog, file: DossierFile & { dossier: Dossier }, dossier: Dossier, changed: boolean, extra: Record<string, unknown>) {
  const removed = credentialPaths(file);
  const write = changed || removed.length > 0;
  const written = write ? catalog.save(file.file, dossier, 'edit') : forwardSlashes(file.file);
  if (removed.length) ctx.warn({ code: 'DOSSIER_REMOTE_USERINFO', message: `Removed the credential from ${removed.join(', ')}; the file's remotes now carry none.` });
  return { name: dossier.name, file: written, source: file.source, changed: write, ...extra, ...(removed.length ? { credentialsRemoved: removed } : {}) };
}

/** Key paths of stored remotes that carry a credential, e.g. `repos[0].remotes[1]`. */
function credentialPaths(file: DossierFile): string[] {
  return file.problems.filter((p) => p.code === 'DOSSIER_REMOTE_USERINFO').map((p) => p.path);
}

function keyValue(pair: string, flag: string): [string, string] {
  const at = pair.indexOf('=');
  if (at <= 0 || at === pair.length - 1) throw new ToilError('INVALID_INPUT', `${flag} takes key=value, and "${pair}" isn't.`, { fix: `For example ${flag} project=PAY.` });
  return [pair.slice(0, at), pair.slice(at + 1)];
}

function lastPart(remote: string): string {
  return normalizeRemote(remote).split('/').filter(Boolean).pop() ?? remote;
}

/**
 * The connection a call to `area` with no input of its own would use under
 * `dossier`, from each of the folders the dossier knows (no repo, and each
 * repo, since a value may be per repo): the call's own resolver decides
 * (`dossierConnection`), through the dossier's `connection` or host and every
 * input that selects a connection (`env` included). Undefined from the
 * dossier means the area's default. One that can't resolve selects nothing.
 */
function choices(catalog: DossierCatalog, config: ResolvedConfig, area: AnyArea, dossier: Dossier): Array<{ repo: string | undefined; chosen: string | undefined; byDossier: boolean }> {
  return [undefined, ...dossier.repos.map((r) => r.name)].map((repo) => {
    try {
      const found = dossierConnection(config, area, catalog.lookupOf(dossier, repo));
      return { repo, chosen: found?.value ?? defaultConnectionName(config, area.name), byDossier: found !== undefined };
    } catch {
      return { repo, chosen: undefined, byDossier: false };
    }
  });
}

/**
 * Every area a dossier, or an edit of it, could choose a connection for: the
 * ones it names, in its sections or an environment's. That's every area it
 * can retarget: an area it doesn't name gets no `connection` or `host` from
 * it, and its environment fills `--env` only for the areas that environment
 * lists.
 */
function areasOf(areas: readonly AnyArea[], ...dossiers: Dossier[]): AnyArea[] {
  const named = new Set(dossiers.flatMap((d) => [...Object.keys(d.sections), ...Object.values(d.environments).flatMap((e) => Object.keys(e))]));
  return areas.filter((a) => named.has(a.name));
}

/**
 * Over MCP, a change may not make a call select a connection with writes on
 * that it didn't select before: that's how a dossier would silently point a
 * write somewhere new (docs/dossiers.md). Judged by the call's own resolver,
 * so a `--default` environment that selects a connection is caught as surely
 * as a `connection`.
 */
function refuseNewWritesTarget(catalog: DossierCatalog, config: ResolvedConfig, areas: readonly AnyArea[], before: Dossier, after: Dossier): void {
  for (const area of areasOf(areas, before, after)) {
    const was = choices(catalog, config, area, before);
    for (const [i, now] of choices(catalog, config, area, after).entries()) {
      if (now.chosen === undefined || !connectionWrites(config.connections[now.chosen]) || now.chosen === was[i]?.chosen) continue;
      throw new ToilError('WRITE_DISABLED', `Over MCP, a dossier can't be made to select connection ${now.chosen}, which has writes on: that binding is a person's decision, made on the CLI.`, {
        fix: `Ask the user to make this change with toil dossiers on the command line, or select a connection with writes off.`,
      });
    }
  }
}

/** Over MCP, import and export refuse a dossier that chooses a connection with writes on, by any binding or selecting input. */
function refuseWritesBindings(catalog: DossierCatalog, config: ResolvedConfig, areas: readonly AnyArea[], dossier: Dossier, what: 'import' | 'export'): void {
  for (const area of areasOf(areas, dossier)) {
    const hit = choices(catalog, config, area, dossier).find((c) => c.byDossier && c.chosen !== undefined && connectionWrites(config.connections[c.chosen]));
    if (hit) {
      throw new ToilError('WRITE_DISABLED', `Over MCP, toil won't ${what} dossier ${dossier.name}: it makes ${area.name} calls use connection ${hit.chosen}, which has writes on. That's a person's decision, made on the CLI.`, {
        fix: `Ask the user to run toil dossiers ${what} on the command line.`,
      });
    }
  }
}

/** A host that selects none or several of your connections is worth saying when it's set, not only when a call trips on it. */
function hostWarnings(catalog: DossierCatalog, dossier: Dossier, area: string, env: string | undefined) {
  try {
    catalog.binding(dossier, area, env);
    return [];
  } catch (err) {
    const e = toToilError(err);
    return [{ code: e.code === 'NOT_CONFIGURED' ? 'DOSSIER_HOST_UNMATCHED' : 'DOSSIER_HOST_AMBIGUOUS', message: e.message }];
  }
}

/**
 * The dossier as others should get it: each connection name becomes a host
 * selector from that connection's base URL, since teammates name connections
 * differently, and local repo paths, which are machine-specific, go.
 */
export function forSharing(source: Dossier, config: ResolvedConfig): { dossier: Dossier; hosts: Array<{ area: string; env: string | null; connection: string; host: string }>; droppedPaths: number } {
  const dossier = structuredClone(source);
  const hosts: Array<{ area: string; env: string | null; connection: string; host: string }> = [];
  const share = (area: string, env: string | undefined, section: Section) => {
    if (typeof section.connection !== 'string') return;
    const name = section.connection;
    const host = hostOf(config.connections[name]);
    if (!host) {
      throw new ToilError('INVALID_INPUT', `Dossier ${dossier.name}'s ${env ? `${env} ` : ''}${area} section selects connection ${name}, ${config.connections[name] ? 'which has no host to share' : "which isn't one of yours"}.`, {
        fix: `Select it by host instead (toil dossiers link ${dossier.name} ${area} --host <host> --replace), or remove the binding.`,
      });
    }
    delete section.connection;
    section.host = host;
    hosts.push({ area, env: env ?? null, connection: name, host });
  };
  for (const [area, section] of Object.entries(dossier.sections)) share(area, undefined, section);
  for (const [env, byArea] of Object.entries(dossier.environments)) for (const [area, section] of Object.entries(byArea)) share(area, env, section);
  let droppedPaths = 0;
  dossier.repos = dossier.repos.map((r) => {
    if (r.path === undefined) return r;
    droppedPaths++;
    return { name: r.name, remotes: r.remotes };
  });
  return { dossier, hosts, droppedPaths };
}

/** A connection's host as a selector: its base URL's host (with a port that isn't the scheme's default), or its `host` setting. */
function hostOf(settings: Record<string, unknown> | undefined): string | undefined {
  if (!settings) return undefined;
  if (typeof settings.baseUrl === 'string') {
    try {
      return new URL(settings.baseUrl).host.toLowerCase();
    } catch {
      return undefined;
    }
  }
  if (typeof settings.host === 'string') return settings.host.toLowerCase() + (settings.port !== undefined ? `:${String(settings.port)}` : '');
  return undefined;
}

/** What an imported dossier names that you don't have: connections and hosts to set up. toil creates none. */
function unresolved(catalog: DossierCatalog, config: ResolvedConfig, dossier: Dossier) {
  const out: Array<{ dossier: string; area: string; env: string | null; connection?: string; host?: string; problem: string }> = [];
  const look = (area: string, env: string | undefined, section: Section) => {
    if (typeof section.connection === 'string' && config.connections[section.connection]?.area !== area) {
      out.push({ dossier: dossier.name, area, env: env ?? null, connection: section.connection, problem: `You have no ${area} connection named ${section.connection}: add one with toil connections add ${section.connection} --area ${area}.` });
    }
    if (typeof section.host === 'string') {
      try {
        catalog.binding({ ...dossier, sections: { [area]: section }, environments: {} }, area, undefined);
      } catch (err) {
        out.push({ dossier: dossier.name, area, env: env ?? null, host: section.host, problem: toToilError(err).message });
      }
    }
  };
  for (const [area, section] of Object.entries(dossier.sections)) look(area, undefined, section);
  for (const [env, byArea] of Object.entries(dossier.environments)) for (const [area, section] of Object.entries(byArea)) look(area, env, section);
  return out;
}
