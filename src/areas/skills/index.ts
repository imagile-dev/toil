import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';
import { allowWriteField } from '../../core/run.js';
import { AGENT_CHOICES, AGENT_NAMES, DEFAULT_AGENT, disablePlugin, DISABLED_DIR, enablePlugin, rootsOf, skillsDir, slashes, targetsFor, agentOf } from '../../skills/folders.js';
import { choicesFor, installInto, syncResult } from '../../skills/install.js';
import { checkClonePath, clonePathOf, cloneOrPull, PROVIDERS } from '../../skills/marketplace.js';

/**
 * Skills marketplaces: git repositories of agent plugins, each plugin a set
 * of skills that an agent host (Codex and Copilot through `.agents/skills`,
 * Copilot's own folders, Claude Code's `.claude/skills`) reads from disk.
 *
 * Each marketplace is a connection of this area, so its token lives where
 * every token does (the OS credential store or an env var), and `writes` on
 * it is the standing opt-in for installing from it. The commands here use
 * only that connection. Adding, listing and removing marketplaces read or
 * change config, so they're core's (`src/skills/commands.ts`), as `toil
 * connections` is. The org chart has the area reporting to core, dotted line.
 */
export const area = defineArea({
  name: 'skills',
  description: 'Agent skills from git-hosted marketplaces: install, sync, and switch plugins on and off for Codex, GitHub Copilot and Claude Code',
  connection: z.object({
    repoUrl: z.string().min(1).describe('Git clone URL of the marketplace: https, or a local path'),
    localPath: z.string().min(1).optional().describe('Where its clone lives (default: ~/.agents/marketplaces/<repo-name>)'),
    branch: z.string().min(1).optional().describe('Branch to clone (default: the remote HEAD)'),
    username: z.string().min(1).optional().describe('User name sent with the token (default: x-access-token on GitHub, x-token-auth elsewhere)'),
    provider: z.enum(PROVIDERS).optional().describe('Git host type, when the URL does not say: github | bitbucket | ado | git'),
    token: z.string().min(1).optional().describe('HTTP access token for a private marketplace'),
  }),
  secrets: ['token'],
  examples: { repoUrl: 'https://bitbucket.imagile.dev/scm/ai/skills.git' },
  context: {
    marketplace: {
      description: 'The marketplace, by name or clone URL',
      flags: '--marketplace <name>',
      scope: 'command',
      setting: 'repoUrl',
      selectsConnection: true,
    },
  },
  notConfigured: {
    message: 'No skills marketplace is set up.',
    fix: 'Add one in a terminal with toil skills marketplace add <git-url> --allow-write, or define one with TOIL_CONN_<NAME>_AREA=skills and TOIL_CONN_<NAME>_REPO_URL.',
  },
});

export const supported: SupportedVersion = {
  product: 'git',
  minimum: '2.24',
  note: 'A private marketplace needs git 2.31 or later, which takes its token from the environment rather than the command line.',
};

const agentFields = {
  agent: z.enum(AGENT_NAMES).optional().describe(`Agent host whose skills folder to use: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})`),
  claude: z.boolean().optional().describe('Shorthand for agent claude-code'),
};
const agentOptions = [
  { flags: '--agent <agent>', field: 'agent', description: `Target agent host: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})` },
  { flags: '--claude', field: 'claude', description: 'Shorthand for --agent claude-code' },
];
const scopeField = { scope: z.enum(['user', 'project']).optional().describe('user (default: the home folder) or project (the repository root)') };
const scopeOption = { flags: '--scope <scope>', field: 'scope', description: 'Installation scope: project | user (default: user)' };

/** A marketplace connection as these commands use it. */
const marketplaceOf = (c: { name: string; repoUrl: string }) => ({ name: c.name, repoUrl: c.repoUrl });

const sync = area.command({
  path: ['skills', 'marketplace', 'sync'],
  description: 'Clone or pull a marketplace and install its plugins into an agent skills folder: one plugin, "all", or with none the ones already installed',
  toolDescription:
    'Clones (first time) or pulls a skills marketplace, then copies plugin skills into an agent host\'s skills folder. Pass plugin to install one, "all" for every plugin, or leave it out to refresh the plugins already installed. Changes files on this machine, so it needs allowWrite. Use skills_marketplace_plugins first to see what a marketplace offers, and skills_status to see what is installed.',
  input: z.object({
    plugin: z.string().min(1).optional().describe('Plugin to install, or "all" for every plugin (default: refresh the plugins already installed)'),
    ...agentFields,
    allAgents: z.boolean().optional().describe('Install for every supported agent host in one run'),
    ...scopeField,
    installedOnly: z.boolean().optional().describe('With "all", only the plugins already installed; skip ones new to the marketplace'),
    ...allowWriteField,
  }),
  writes: true,
  context: { marketplace: 'optional' },
  // A first clone of a large marketplace over a slow link is the slow case.
  timeLimitMs: 10 * 60_000,
  args: [{ name: 'plugin', field: 'plugin', description: 'Plugin name to install, or "all" to install every plugin', required: false }],
  options: [
    ...agentOptions,
    { flags: '--all-agents', field: 'allAgents', description: 'Install to every supported agent host in one run' },
    scopeOption,
    { flags: '--installed-only', field: 'installedOnly', description: 'Only sync plugins that are already installed — skip plugins newly added to the marketplace' },
  ],
  examples: [
    { plugin: 'review', allowWrite: true },
    { plugin: 'all', agent: 'github-copilot', scope: 'user', marketplace: 'skills', allowWrite: true },
    { plugin: 'all', claude: true, installedOnly: true, allowWrite: true },
    { allAgents: true, allowWrite: true },
  ],
  run: async (input, ctx) => {
    const m = ctx.connection;
    const roots = rootsOf(ctx);
    const targets = targetsFor(input, input.scope ?? 'user', roots);
    const clone = clonePathOf(m, roots.home);
    checkClonePath(clone, roots.home, join(roots.home, '.toil', 'config.json'));
    const { updated } = await cloneOrPull(ctx.git, m, clone, ctx.signal);
    // No plugin means "refresh what is installed", the common case after a pull.
    const plugin = input.plugin ?? 'all';
    const installedOnly = input.plugin === undefined || input.installedOnly === true;
    const choices = choicesFor(clone, m.name, plugin);
    const results = targets.map((t) => installInto(t, choices, { marketplace: marketplaceOf(m), clone, plugin, installedOnly, toilVersion: ctx.version, warn: ctx.warn }));
    return syncResult(m.name, updated, plugin, results, installedOnly);
  },
});

const disable = area.command({
  path: ['skills', 'marketplace', 'disable'],
  description: "Switch a plugin's skills off without deleting them: they move to a hidden stash (switch back on with marketplace enable)",
  toolDescription:
    "Switches a marketplace plugin off in one agent skills folder: its skills move into the folder's hidden .toil-disabled stash and their record moves to \"disabled\" in .toil-installed.json, so the agent host stops loading them. Nothing is deleted; skills_marketplace_enable reverses it. Needs allowWrite.",
  input: z.object({
    plugin: z.string().min(1).describe('Plugin to switch off'),
    ...agentFields,
    ...scopeField,
    ...allowWriteField,
  }),
  writes: true,
  context: { marketplace: 'optional' },
  args: [{ name: 'plugin', field: 'plugin', description: 'Plugin name to disable' }],
  options: [...agentOptions, scopeOption],
  examples: [
    { plugin: 'review', allowWrite: true },
    { plugin: 'review', agent: 'codex', scope: 'user', marketplace: 'skills', allowWrite: true },
    { plugin: 'docs', claude: true, allowWrite: true },
  ],
  run: async (input, ctx) => {
    const dir = skillsDir(agentOf(input), input.scope ?? 'user', rootsOf(ctx));
    const target = slashes(dir);
    if (!existsSync(dir)) return { disabled: [], total: 0, target, message: 'No skills directory found.' };
    const result = disablePlugin(dir, input.plugin, marketplaceOf(ctx.connection));
    return {
      disabled: result.disabled,
      alreadyDisabled: result.alreadyDisabled,
      skipped: result.skipped.length,
      total: result.disabled.length,
      target,
      plugin: input.plugin,
      stash: slashes(join(dir, DISABLED_DIR)),
      marketplace: ctx.connection.name,
    };
  },
});

const enable = area.command({
  path: ['skills', 'marketplace', 'enable'],
  description: "Switch a disabled plugin's skills back on",
  toolDescription:
    'Switches a marketplace plugin back on in one agent skills folder, moving its skills out of the hidden .toil-disabled stash. A skill whose stashed copy has gone is reported in stashMissing; skills_marketplace_sync with that plugin restores it. Needs allowWrite.',
  input: z.object({
    plugin: z.string().min(1).describe('Plugin to switch on'),
    ...agentFields,
    ...scopeField,
    ...allowWriteField,
  }),
  writes: true,
  context: { marketplace: 'optional' },
  args: [{ name: 'plugin', field: 'plugin', description: 'Plugin name to enable' }],
  options: [...agentOptions, scopeOption],
  examples: [
    { plugin: 'docs', allowWrite: true },
    { plugin: 'docs', agent: 'codex', scope: 'user', marketplace: 'skills', allowWrite: true },
    { plugin: 'review', claude: true, allowWrite: true },
  ],
  run: async (input, ctx) => {
    const dir = skillsDir(agentOf(input), input.scope ?? 'user', rootsOf(ctx));
    const target = slashes(dir);
    if (!existsSync(dir)) return { enabled: [], total: 0, target, message: 'No skills directory found.' };
    const result = enablePlugin(dir, input.plugin, marketplaceOf(ctx.connection));
    if (!result.hadDisabled) return { enabled: [], total: 0, target, plugin: input.plugin, message: `No disabled skills found for plugin "${input.plugin}".` };
    return {
      enabled: result.enabled,
      skipped: result.skipped.length,
      total: result.enabled.length,
      target,
      plugin: input.plugin,
      marketplace: ctx.connection.name,
      ...(result.stashMissing.length > 0
        ? {
            stashMissing: result.stashMissing,
            warning: `Skills marked disabled but missing from the stash were left as-is. Re-install the plugin (toil skills marketplace sync ${input.plugin} --marketplace ${ctx.connection.name} --allow-write) to restore them.`,
          }
        : {}),
    };
  },
});

export const commands = [sync, enable, disable];
