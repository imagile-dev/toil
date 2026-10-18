import { z } from 'zod';
import { defineConfigCommand, type AnyCommand } from '../core/command.js';
import { CONNECTION_NAME, readConfigForEdit, writeConfigFile, type ConnectionSettings, type EditableConfig, type ResolvedConfig } from '../core/config.js';
import type { CommandContext, ConfigAccess } from '../core/context.js';
import { ToilError } from '../core/errors.js';
import { isKeychainRef, KEYCHAIN_PREFIX, refFor, refName, storeVerified } from '../core/keychain.js';
import { allowWriteField } from '../core/run.js';
import {
  AGENT_CHOICES,
  AGENT_NAMES,
  DEFAULT_AGENT,
  DISABLED_DIR,
  activeSkills,
  cloneOrigin,
  isClone,
  knownFolders,
  pluginsIn,
  readMeta,
  recordOf,
  rootsOf,
  slashes,
  summarize,
  targetsFor,
  type InstallRecord,
  type SkillLocation,
} from './folders.js';
import { choicesFor, installInto } from './install.js';
import { checkClonePath, checkRepoUrl, clonePathOf, cloneOrPull, nameFromRepo, providerOf, PROVIDERS, repoNameFromUrl, type Marketplace } from './marketplace.js';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * The skills commands that read or change config: adding, listing and
 * removing marketplaces, and the status of every skills folder, which joins
 * what is installed to the marketplaces config names. They're core's, like
 * `toil connections`, because no area command may see the whole config.
 *
 * `add` and `remove` are CLI only, as `connections add` and `remove` are: a
 * person sets up where skills come from, never an agent over MCP. `add`
 * clones and installs, so it also takes --allow-write; the person at the
 * terminal is its standing opt-in, and it records that opt-in as `writes`
 * on the marketplace, so later syncs pass the usual gate. The marketplace's
 * token is asked for on the terminal and goes straight to the OS credential
 * store; config holds only a reference. The reference is all the file
 * clerk ever sees, which suits the file clerk.
 */
const AREA = 'skills';

const agentFields = {
  agent: z.enum(AGENT_NAMES).optional().describe(`Agent host whose skills folder to install into: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})`),
  claude: z.boolean().optional().describe('Shorthand for agent claude-code'),
  allAgents: z.boolean().optional().describe('Install for every supported agent host in one run'),
};

export function skillsConfigCommands(): AnyCommand[] {
  const add = defineConfigCommand({
    path: ['skills', 'marketplace', 'add'],
    description: 'Register a marketplace, clone it, and install all its plugins; asks for a token on the terminal (setup is an alias)',
    input: z.object({
      url: z.string().min(1).describe('Git clone URL of the marketplace repository (https, or a local path)'),
      localPath: z.string().min(1).optional().describe('Local directory to clone into (default: ~/.agents/marketplaces/<repo-name>)'),
      name: z.string().min(1).optional().describe('Name for this marketplace (default: derived from the URL)'),
      branch: z.string().min(1).optional().describe('Branch to clone (default: remote HEAD)'),
      username: z.string().min(1).optional().describe('User name sent with the token'),
      provider: z.enum(PROVIDERS).optional().describe('Git host type, when detection guesses wrong'),
      ...agentFields,
      scope: z.enum(['user', 'project']).optional().describe('Installation scope (default: user)'),
      ...allowWriteField,
    }),
    writes: true,
    kind: 'cli-only',
    aliases: ['setup'],
    args: [
      { name: 'url', field: 'url', description: 'Git clone URL of the marketplace repository' },
      { name: 'localPath', field: 'localPath', description: 'Local directory to clone into (default: ~/.agents/marketplaces/<repo-name>)', required: false },
    ],
    options: [
      { flags: '--name <name>', field: 'name', description: 'Human-readable name for this marketplace (default: derived from URL)' },
      { flags: '--branch <branch>', field: 'branch', description: 'Branch to clone (default: remote HEAD)' },
      {
        flags: '--username <username>',
        field: 'username',
        description: 'Username sent with the token (default: x-access-token on github.com, x-token-auth elsewhere; Bitbucket Data Center personal tokens usually need your username)',
      },
      { flags: '--provider <provider>', field: 'provider', description: 'Git host type, when detection guesses wrong: github | bitbucket | ado | git' },
      { flags: '--agent <agent>', field: 'agent', description: `Target agent host for plugin install: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})` },
      { flags: '--claude', field: 'claude', description: 'Shorthand for --agent claude-code' },
      { flags: '--all-agents', field: 'allAgents', description: 'Install to every supported agent host in one run' },
      { flags: '--scope <scope>', field: 'scope', description: 'Installation scope: project | user (default: user)' },
    ],
    examples: [{ url: 'https://bitbucket.imagile.dev/scm/ai/skills.git', name: 'corp-skills', allowWrite: true }],
    run: async (input, ctx) => {
      const { config, secrets, prompt } = access(ctx);
      const roots = rootsOf(ctx);
      const url = checkRepoUrl(input.url);
      const name = input.name ?? nameFromRepo(repoNameFromUrl(input.url));
      if (!CONNECTION_NAME.test(name)) {
        throw new ToilError('INVALID_INPUT', `"${name}" isn't a valid marketplace name.`, { fix: 'Use lowercase letters, digits and single hyphens, starting with a letter, e.g. corp-skills.' });
      }
      // Checks targets before anything is cloned, so a bad --agent combination changes nothing.
      const targets = targetsFor(input, input.scope ?? 'user', roots);
      const path = config.files.global;
      const file = readConfigForEdit(path);
      const existing = file.connections[name];
      if (existing && (existing.area !== AREA || existing.repoUrl !== input.url)) {
        throw new ToilError('INVALID_INPUT', `There's already a connection named "${name}"${existing.area === AREA ? ` for ${String(existing.repoUrl)}` : `, for ${existing.area}`}.`, {
          fix: 'Pass --name with another name, or remove the existing one first.',
        });
      }
      const sameUrl = Object.entries(file.connections).find(([n, c]) => n !== name && c.area === AREA && c.repoUrl === input.url);
      if (sameUrl) {
        throw new ToilError('INVALID_INPUT', `${input.url} is already registered as marketplace "${sameUrl[0]}".`, { fix: `Run toil skills marketplace sync --marketplace ${sameUrl[0]} --allow-write to refresh it.` });
      }

      // An absolute folder is the person's choice, as --output-file is; a relative one is in the workspace.
      const dir = input.localPath ? (isAbsolute(input.localPath) ? resolve(input.localPath) : ctx.files.resolve(input.localPath)) : clonePathOf({ name, repoUrl: input.url }, roots.home);
      checkClonePath(dir, roots.home, path);

      // A private marketplace's token, asked for without echo and never on argv.
      let token = '';
      if (url && prompt) token = await prompt.askSecret(`Access token for ${url.host} (leave empty for a public repository)`);
      if (url && !prompt && !existing?.token) {
        ctx.warn({
          code: 'SKILLS_NO_TOKEN',
          message: `No terminal to ask for a token on, so marketplace ${name} has none. If it's private, run toil skills marketplace add in a terminal, or set TOIL_CONN_${name.toUpperCase().replace(/-/g, '_')}_TOKEN.`,
        });
      }
      const m: Marketplace = { name, repoUrl: input.url, localPath: dir, branch: input.branch, username: input.username, provider: input.provider, ...(token ? { token } : {}) };
      const reused = isClone(dir);
      const synced = await cloneOrPull(ctx.git, m, dir, ctx.signal);
      if (reused) ctx.warn({ code: 'SKILLS_CLONE_REUSED', message: `${slashes(dir)} already held a clone, so it was pulled rather than cloned.` });

      // Stored and read back before config points at it.
      let tokenRef = existing?.token;
      if (token) {
        const ref = refFor(name, 'token');
        if (!secrets) {
          throw new ToilError('CREDENTIAL_STORE', 'No OS credential store is available here, so the token has nowhere safe to go. Nothing was saved.', {
            fix: `Set TOIL_CONN_${name.toUpperCase().replace(/-/g, '_')}_TOKEN instead: without a credential store, secrets come from env vars.`,
          });
        }
        await storeVerified(secrets, ref, token, ctx.signal);
        tokenRef = `${KEYCHAIN_PREFIX}${ref}`;
      }
      const conn: ConnectionSettings = {
        area: AREA,
        repoUrl: input.url,
        localPath: dir,
        ...(input.branch ? { branch: input.branch } : existing?.branch ? { branch: existing.branch } : {}),
        ...(input.username ? { username: input.username } : existing?.username ? { username: existing.username } : {}),
        ...(input.provider ? { provider: input.provider } : existing?.provider ? { provider: existing.provider } : {}),
        ...(tokenRef ? { token: tokenRef } : {}),
        writes: true,
      };
      file.connections[name] = conn;
      // The first marketplace becomes the default, so sync needs no --marketplace.
      const others = Object.keys(file.connections).filter((n) => n !== name && file.connections[n]!.area === AREA);
      if (others.length === 0 && typeof file.defaults[AREA]?.connection !== 'string') file.defaults[AREA] = { ...(file.defaults[AREA] ?? {}), connection: name };
      writeConfigFile(path, file);
      if (existing?.token && token && isKeychainRef(existing.token) && existing.token !== tokenRef) await deleteUnreferenced(file, existing.token, ctx);

      const choices = choicesFor(dir, name, 'all');
      const results = targets.map((t) => installInto(t, choices, { marketplace: { name, repoUrl: input.url }, clone: dir, plugin: 'all', installedOnly: false, toilVersion: ctx.version, warn: ctx.warn }));
      return {
        name,
        repoUrl: input.url,
        localPath: slashes(dir),
        branch: input.branch ?? null,
        tokenConfigured: tokenRef !== undefined,
        tokenStorage: tokenRef === undefined ? null : 'keychain',
        provider: providerOf(m),
        writes: true,
        cloned: synced.cloned,
        ...(results.length === 1
          ? { plugins: results[0]!.plugins, total: results[0]!.total, target: results[0]!.target }
          : { targets: results, total: results.reduce((sum, r) => sum + r.total, 0) }),
      };
    },
  });

  const list = defineConfigCommand({
    path: ['skills', 'marketplace', 'list'],
    description: 'List all registered marketplaces',
    toolDescription:
      'Lists every registered skills marketplace: its name, clone URL, where the clone lives, whether a token is set and where it is kept (never the token), the provider, and whether writes are on. Use a name from it as marketplace on the other skills tools.',
    input: z.object({}),
    writes: false,
    examples: [{}],
    run: async (_input, ctx) => {
      const { config } = access(ctx);
      const roots = rootsOf(ctx);
      const marketplaces = marketplacesIn(config).map(([name, c]) => {
        const dir = clonePathOf(asMarketplace(name, c), roots.home);
        return {
          name,
          repoUrl: String(c.repoUrl ?? ''),
          localPath: slashes(dir),
          tokenConfigured: c.token !== undefined && c.token !== '',
          tokenStorage: tokenStorage(config, name, c),
          provider: providerOf(asMarketplace(name, c)),
          username: typeof c.username === 'string' ? c.username : null,
          upstreamRemote: isClone(dir) ? cloneOrigin(dir) : null,
          writes: c.writes === true || c.writes === 'true',
        };
      });
      return { marketplaces, total: marketplaces.length };
    },
  });

  const plugins = defineConfigCommand({
    path: ['skills', 'marketplace', 'plugins'],
    description: 'List the plugins available in a registered marketplace',
    toolDescription: "Lists the plugins a registered skills marketplace offers, with each one's description, read from its local clone. Use it to choose what to install with skills_marketplace_sync.",
    input: z.object({ name: z.string().min(1).describe('Marketplace name (or repo URL) to inspect') }),
    writes: false,
    args: [{ name: 'name', field: 'name', description: 'Marketplace name (or repo URL) to inspect' }],
    examples: [{ name: 'skills' }],
    run: async (input, ctx) => {
      const { config } = access(ctx);
      const [name, c] = findMarketplace(config, input.name);
      const dir = clonePathOf(asMarketplace(name, c), rootsOf(ctx).home);
      if (!isClone(dir)) {
        throw new ToilError('INVALID_INPUT', `Marketplace ${name} isn't cloned yet: nothing at ${slashes(dir)}.`, {
          fix: `Clone it with toil skills marketplace sync --marketplace ${name} --allow-write.`,
        });
      }
      const found = pluginsIn(dir).map((p) => ({ name: p.name, description: p.description }));
      return { marketplace: name, plugins: found, total: found.length };
    },
  });

  const remove = defineConfigCommand({
    path: ['skills', 'marketplace', 'remove'],
    description: 'Remove a registered marketplace from the config, and its token from the OS credential store (the local clone and installed skills are kept)',
    input: z.object({ name: z.string().min(1).describe('Name (or repo URL) of the marketplace to remove') }),
    writes: false,
    kind: 'cli-only',
    args: [{ name: 'name', field: 'name', description: 'Name of the marketplace to remove' }],
    examples: [{ name: 'corp-skills' }],
    run: async (input, ctx) => {
      const { config } = access(ctx);
      const roots = rootsOf(ctx);
      const path = config.files.global;
      const file = readConfigForEdit(path);
      const entry = Object.entries(file.connections).find(([n, c]) => c.area === AREA && (n === input.name || c.repoUrl === input.name));
      if (!entry) {
        const fromEnv = marketplacesIn(config).some(([n, c]) => n === input.name || c.repoUrl === input.name);
        throw new ToilError(
          'INVALID_INPUT',
          fromEnv ? `Marketplace "${input.name}" is defined by env vars, not your config file, so there's nothing here to remove.` : `Marketplace "${input.name}" not found.`,
          { fix: fromEnv ? 'Unset its TOIL_CONN_<NAME>_* variables instead.' : 'Run: toil skills marketplace list' },
        );
      }
      const [name, conn] = entry;
      delete file.connections[name];
      const shared = file.defaults[AREA];
      if (shared?.connection === name) {
        delete shared.connection;
        if (Object.keys(shared).length === 0) delete file.defaults[AREA];
      }
      writeConfigFile(path, file);
      const keychainEntryDeleted = isKeychainRef(conn.token) ? await deleteUnreferenced(file, conn.token, ctx) : false;
      const remaining = Object.values(file.connections).filter((c) => c.area === AREA).length;
      return {
        removed: { name, repoUrl: conn.repoUrl, localPath: slashes(clonePathOf(asMarketplace(name, conn), roots.home)) },
        keychainEntryDeleted,
        remaining,
      };
    },
  });

  const status = defineConfigCommand({
    path: ['skills', 'status'],
    description: 'Show every installed skill with its plugin, marketplace, and upstream remote, and whether it is on',
    toolDescription:
      'Lists every skill in every agent skills folder toil knows (Codex/Copilot .agents/skills, Copilot .github/skills and ~/.copilot/skills, Claude Code .claude/skills, at user and project scope): its plugin and marketplace, whether it is enabled or switched off, and where it came from. Filter by marketplace, plugin, source, agent or scope. Read-only.',
    input: z.object({
      marketplace: z.string().min(1).optional().describe('Only skills installed from this marketplace (name or clone URL)'),
      plugin: z.string().min(1).optional().describe('Only skills belonging to this plugin'),
      source: z.enum(['marketplace', 'bundled', 'untracked']).optional().describe('Only this provenance'),
      agent: z.enum(AGENT_NAMES).optional().describe(`Only this agent host's folders: ${AGENT_CHOICES}`),
      scope: z.enum(['project', 'user', 'custom']).optional().describe('Only this scope'),
    }),
    writes: false,
    options: [
      { flags: '--marketplace <name>', field: 'marketplace', description: 'Only show skills installed from this marketplace (name or clone URL)' },
      { flags: '--plugin <name>', field: 'plugin', description: 'Only show skills belonging to this plugin' },
      { flags: '--source <source>', field: 'source', description: 'Filter by provenance: marketplace | bundled | untracked' },
      { flags: '--agent <agent>', field: 'agent', description: `Only show locations for this agent host: ${AGENT_CHOICES}` },
      { flags: '--scope <scope>', field: 'scope', description: 'Only show this scope: project | user | custom' },
    ],
    examples: [{}, { marketplace: 'skills', plugin: 'review', source: 'marketplace', agent: 'codex', scope: 'user' }],
    run: async (input, ctx) => {
      const { config } = access(ctx);
      const roots = rootsOf(ctx);
      const registered = marketplacesIn(config);
      const folders = knownFolders(roots).filter((f) => (!input.agent || f.agent === input.agent) && (!input.scope || f.scope === input.scope));
      const locations: SkillLocation[] = folders.map((f) => summarize(f.agent, f.scope, f.dir));
      const origins = new Map<string, string | null>();
      const originOf = (dir: string) => {
        if (!origins.has(dir)) origins.set(dir, isClone(dir) ? cloneOrigin(dir) : null);
        return origins.get(dir) ?? null;
      };
      const skills: SkillStatus[] = [];
      for (const f of folders) {
        if (!locations.find((l) => l.path === slashes(f.dir))?.exists) continue;
        const meta = readMeta(f.dir);
        const push = (skill: string, record: InstallRecord | undefined, enabled: boolean) => {
          const recorded = record?.marketplace ?? null;
          const match = registered.find(([n, c]) => (recorded !== null && n === recorded) || (record?.installedFrom !== undefined && c.repoUrl === record.installedFrom));
          const clone = match ? clonePathOf(asMarketplace(match[0], match[1]), roots.home) : undefined;
          const version = typeof record?.toilVersion === 'string' ? record.toilVersion : null;
          skills.push({
            skill,
            path: slashes(enabled ? join(f.dir, skill) : join(f.dir, DISABLED_DIR, skill)),
            agent: f.agent,
            scope: f.scope,
            location: slashes(f.dir),
            enabled,
            source: record?.source ?? 'untracked',
            plugin: record?.plugin ?? null,
            marketplace: recorded ?? match?.[0] ?? null,
            repoUrl: (match ? String(match[1].repoUrl) : undefined) ?? record?.installedFrom ?? null,
            localPath: clone ? slashes(clone) : null,
            upstreamRemote: clone ? originOf(clone) : null,
            branch: record?.branch ?? null,
            installedAt: record?.installedAt ?? null,
            toilVersion: version,
            // A bundled skill is a copy of the toil that installed it; another version means it may be out of date.
            stale: record?.source === 'bundled' && version !== ctx.version,
          });
        };
        for (const name of activeSkills(f.dir)) push(name, recordOf(meta, f.dir, name), true);
        for (const [name, record] of Object.entries(meta.disabled ?? {})) push(name, record, false);
      }
      const shown = skills
        .filter((r) => !input.plugin || r.plugin === input.plugin)
        .filter((r) => !input.source || r.source === input.source)
        .filter((r) => !input.marketplace || r.marketplace === input.marketplace || r.repoUrl === input.marketplace)
        .sort((a, b) => a.location.localeCompare(b.location) || a.skill.localeCompare(b.skill));
      const byMarketplace: Record<string, number> = {};
      for (const r of shown) byMarketplace[r.marketplace ?? '(none)'] = (byMarketplace[r.marketplace ?? '(none)'] ?? 0) + 1;
      const stale = shown.filter((r) => r.stale).length;
      if (stale > 0) ctx.warn({ code: 'SKILLS_STALE', message: `${stale} bundled skill(s) were installed by another toil version.` });
      return {
        skills: shown,
        total: shown.length,
        enabled: shown.filter((r) => r.enabled).length,
        disabled: shown.filter((r) => !r.enabled).length,
        untracked: shown.filter((r) => r.source === 'untracked').length,
        stale,
        toilVersion: ctx.version,
        byMarketplace,
        locations,
      };
    },
  });

  return [add, list, plugins, remove, status];
}

interface SkillStatus {
  skill: string;
  path: string;
  agent: string;
  scope: SkillLocation['scope'];
  location: string;
  enabled: boolean;
  source: 'marketplace' | 'bundled' | 'untracked';
  plugin: string | null;
  marketplace: string | null;
  repoUrl: string | null;
  localPath: string | null;
  upstreamRemote: string | null;
  branch: string | null;
  installedAt: string | null;
  toilVersion: string | null;
  stale: boolean;
}

function access(ctx: CommandContext<unknown>): ConfigAccess {
  if (!ctx.manage) throw new Error('A skills config command ran without ctx.manage; define it with defineConfigCommand.');
  return ctx.manage;
}

/** Every skills connection, file and env alike, by name. */
function marketplacesIn(config: ResolvedConfig): Array<[string, ConnectionSettings]> {
  return Object.entries(config.connections)
    .filter(([, c]) => c.area === AREA)
    .sort(([a], [b]) => a.localeCompare(b));
}

function findMarketplace(config: ResolvedConfig, nameOrUrl: string): [string, ConnectionSettings] {
  const found = marketplacesIn(config).find(([n, c]) => n === nameOrUrl || c.repoUrl === nameOrUrl);
  if (found) return found;
  throw new ToilError('INVALID_INPUT', `Marketplace "${nameOrUrl}" not found.`, { fix: 'Run: toil skills marketplace list' });
}

/** The settings a marketplace needs here; never the token, which these commands don't resolve. */
function asMarketplace(name: string, c: ConnectionSettings): Marketplace {
  const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
  const provider = text(c.provider);
  return {
    name,
    repoUrl: String(c.repoUrl ?? ''),
    localPath: text(c.localPath),
    branch: text(c.branch),
    username: text(c.username),
    provider: (PROVIDERS as readonly string[]).includes(provider ?? '') ? (provider as Marketplace['provider']) : undefined,
  };
}

/** Where a marketplace's token is kept, from where config found it: never the token itself. */
function tokenStorage(config: ResolvedConfig, name: string, c: ConnectionSettings): 'keychain' | 'env' | 'config' | null {
  if (c.token === undefined || c.token === '') return null;
  const source = config.sources[`${name}.token`];
  if (source === 'env' || source === 'ci') return 'env';
  return isKeychainRef(c.token) ? 'keychain' : 'config';
}

/** Deletes a store entry once nothing in config refers to it. */
async function deleteUnreferenced(file: EditableConfig, value: string, ctx: CommandContext<unknown>): Promise<boolean> {
  const stillUsed = [...Object.values(file.connections), ...Object.values(file.defaults)].some((s) => Object.values(s).includes(value));
  if (stillUsed) return false;
  const { secrets } = access(ctx);
  try {
    if (!secrets) throw new Error('no OS credential store is available here');
    return await secrets.delete(refName(value), ctx.signal);
  } catch (err) {
    ctx.warn({ code: 'CREDENTIAL_STORE_LEFTOVER', message: `Config no longer uses ${value}, but it couldn't be deleted from the OS credential store: ${err instanceof Error ? err.message : String(err)}` });
    return false;
  }
}
