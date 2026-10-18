import { CONNECTION_NAME, connectionWrites, type ResolvedConfig } from '../../core/config.js';
import { AGENT_NAMES, AGENTS, DEFAULT_AGENT, type AgentName } from '../../skills/folders.js';
import { nameFromRepo, repoNameFromUrl } from '../../skills/marketplace.js';
import { connectionNames, envOnly, ok, type WelcomeData } from '../screens.js';
import { PALETTE, paint } from '../term.js';
import type { Action, Caps, Item, Run, StepResult, View, ViewProps } from '../view.js';

/**
 * The Skills and Plugins modules: add, list and remove skills marketplaces,
 * install a plugin for the agent and place you pick, and switch installed
 * plugins on and off. Every action is a real `toil skills …` (or `toil
 * connections writes`) command, shown as it runs, so the menu writes exactly
 * what the command would. A checkbox is only ever a request; the command is
 * the one that files it.
 *
 * What a screen lists from disk (a marketplace's plugins, what's installed)
 * comes from the command that reads it: the run's result screen shows the
 * command, and its envelope is handed to the next screen as a parameter.
 */

const AREA = 'skills';
const config = (data: WelcomeData): ResolvedConfig | undefined => ('error' in data.config ? undefined : data.config);

/** Marketplace connections in the loaded config, sorted. */
export function marketplaceNames(data: WelcomeData): string[] {
  const cfg = config(data);
  return cfg ? connectionNames(data).filter((name) => cfg.connections[name]!.area === AREA) : [];
}

const writesOn = (data: WelcomeData, name: string) => connectionWrites(config(data)?.connections[name]);

/** Where an agent's skills go, for a hint: `~/.claude/skills`, or `.claude/skills` in the project. */
function folderHint(agent: AgentName | 'all', scope: string): string {
  if (agent === 'all') return scope === 'project' ? 'every agent, in this repository' : 'every agent, in your home folder';
  return scope === 'project' ? AGENTS[agent].project : `~/${AGENTS[agent].user}`;
}

const agentLabel: Record<AgentName, string> = { codex: 'Codex', 'github-copilot': 'GitHub Copilot', 'claude-code': 'Claude Code' };

const agentArgs = (agent: string): string[] => (agent === 'all' ? ['--all-agents'] : ['--agent', agent]);

// ─── Skills: marketplaces ──────────────────────────────────────────────────

export const skillsView: View = {
  title: () => 'Skills',
  body: (caps, p) => {
    const names = marketplaceNames(p.data);
    if (names.length === 0) {
      return [paint(caps, PALETTE.muted, 'No skills marketplace yet. A marketplace is a git repository of agent plugins; add one to install its skills for Codex, GitHub Copilot or Claude Code.')];
    }
    return [paint(caps, PALETTE.amber, 'Marketplaces'), ...names.map((name) => `  ${name}  ${writesOn(p.data, name) ? ok(caps, true, 'writes on') : paint(caps, PALETTE.faint, 'writes off')}`)];
  },
  items: (p) => [
    ...marketplaceNames(p.data).map((name): Item => ({ label: name, hint: String(config(p.data)!.connections[name]!.repoUrl ?? ''), action: { go: 'marketplace', params: { name } } })),
    { label: 'Add a marketplace', hint: 'Its git URL, and a token if it is private', action: { go: 'skills-add-url' } },
    { label: "What's installed", hint: 'Every skill in every agent folder', action: { run: { title: 'Installed skills', steps: [{ args: ['skills', 'status'] }] } } },
  ],
};

export const marketplaceView: View = {
  title: (p) => p.frame.params.name ?? '',
  body: (caps, p) => {
    const name = p.frame.params.name!;
    const conn = config(p.data)?.connections[name];
    if (!conn) return [ok(caps, false, `There's no marketplace named ${name} any more.`)];
    const writes = connectionWrites(conn);
    const lines = [
      paint(caps, PALETTE.amber, name),
      '',
      `${paint(caps, PALETTE.muted, 'Clone URL ')} ${String(conn.repoUrl ?? '')}`,
      `${paint(caps, PALETTE.muted, 'Writes    ')} ${writes ? ok(caps, true, 'on') : 'off'}`,
    ];
    if (!writes) lines.push('', paint(caps, PALETTE.muted, 'Writes are off, so nothing can be installed from it yet. Turning them on lets toil (and an agent you allow) install and switch its plugins.'));
    return lines;
  },
  items: (p) => {
    const name = p.frame.params.name!;
    const cfg = config(p.data);
    if (!cfg?.connections[name]) return [];
    const plugins: Run = {
      title: `Plugins in ${name}`,
      steps: [{ args: ['skills', 'marketplace', 'plugins', name] }],
      next: (r) => (r[0]?.envelope.ok ? { go: 'skills-plugin', params: { name, plugins: JSON.stringify(pluginNames(r[0])) } } : undefined),
    };
    const items: Item[] = [];
    const writes = writesOn(p.data, name);
    if (!writes && !envOnly(cfg, name)) {
      items.push({
        label: 'Turn writes on',
        hint: 'Needed to install; asks you to type the name to confirm',
        attention: true,
        action: { run: { title: `Writes on for ${name}`, steps: [{ args: ['connections', 'writes', name, 'on'], label: 'Confirm by typing the marketplace name' }] } },
      });
    }
    items.push(
      { label: 'Install a plugin', hint: 'Pick a plugin, an agent and where', action: { run: plugins } },
      { label: 'Update installed plugins', hint: 'Pull it and refresh what is installed', action: { go: 'skills-agent', params: { mode: 'sync', name } } },
    );
    if (writes && !envOnly(cfg, name)) {
      items.push({ label: 'Turn writes off', hint: 'Nothing more installs from it', action: { run: { title: `Writes off for ${name}`, steps: [{ args: ['connections', 'writes', name, 'off'] }] } } });
    }
    if (!envOnly(cfg, name)) items.push({ label: 'Remove', hint: 'Asks you to type the name; installed skills stay', action: { go: 'skills-remove', params: { name } } });
    return items;
  },
};

/** The plugin names a `skills marketplace plugins` envelope lists. */
export function pluginNames(result: StepResult): Array<{ name: string; description: string }> {
  const d = result.envelope.ok ? (result.envelope.data as { plugins?: Array<{ name?: unknown; description?: unknown }> }) : undefined;
  return (d?.plugins ?? []).filter((x) => typeof x.name === 'string').map((x) => ({ name: String(x.name), description: typeof x.description === 'string' ? x.description : '' }));
}

const parse = <T>(text: string | undefined, fallback: T): T => {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const pluginView: View = {
  title: () => 'Install',
  body: (caps) => [paint(caps, PALETTE.amber, 'Which plugin?')],
  items: (p) => {
    const name = p.frame.params.name!;
    const plugins = parse<Array<{ name: string; description: string }>>(p.frame.params.plugins, []);
    return [
      ...plugins.map((x): Item => ({ label: x.name, hint: x.description, action: { go: 'skills-agent', params: { mode: 'install', name, plugin: x.name } } })),
      ...(plugins.length > 1 ? [{ label: 'All plugins', hint: `Everything in ${name}`, action: { go: 'skills-agent', params: { mode: 'install', name, plugin: 'all' } } } as Item] : []),
    ];
  },
};

/**
 * Which agent: the default (Codex's `.agents/skills`, which GitHub Copilot
 * reads too) is first, so enter takes it.
 */
export const agentView: View = {
  title: (p) => (p.frame.params.mode === 'toggle' ? 'Agent' : (p.frame.params.plugin ?? 'Agent')),
  body: (caps) => [paint(caps, PALETTE.amber, 'For which agent?')],
  items: (p) => {
    const agents = [DEFAULT_AGENT, ...AGENT_NAMES.filter((a) => a !== DEFAULT_AGENT)];
    const rows = agents.map((agent): Item => ({
      label: agentLabel[agent],
      hint: `${agent === DEFAULT_AGENT ? 'the default; ' : ''}${AGENTS[agent].user === AGENTS[agent].project ? AGENTS[agent].project : `${AGENTS[agent].project} or ~/${AGENTS[agent].user}`}${agent === 'codex' ? ' (Copilot reads it too)' : ''}`,
      action: { go: 'skills-scope', params: { ...p.frame.params, agent } },
    }));
    if (p.frame.params.mode !== 'toggle') rows.push({ label: 'Every agent', hint: 'All three folders', action: { go: 'skills-scope', params: { ...p.frame.params, agent: 'all' } } });
    return rows;
  },
};

/** The commands a choice of marketplace, plugin, agent and place comes to. */
export function installRun(params: Record<string, string>): Run {
  const { name, plugin, agent, scope, mode } = params as Record<string, string>;
  const args = ['skills', 'marketplace', 'sync', ...(mode === 'install' && plugin ? [plugin] : []), '--marketplace', name!, ...agentArgs(agent!), '--scope', scope!, '--allow-write'];
  return {
    title: mode === 'install' ? `Install ${plugin === 'all' ? 'every plugin' : plugin} from ${name}` : `Update ${name}`,
    steps: [{ args }],
    next: (r) => (r[0]?.envelope.ok ? { go: 'marketplace', params: { name: name! }, root: 'marketplace' } : undefined),
  };
}

/** `skills status` for one folder; its result opens the checkbox screen. */
export function statusRun(agent: string, scope: string): Run {
  return {
    title: `Plugins for ${agentLabel[agent as AgentName] ?? agent}`,
    steps: [{ args: ['skills', 'status', '--agent', agent, '--scope', scope] }],
    // Back to the place picker first, so saving and looking again doesn't stack screens.
    next: (r) => (r[0]?.envelope.ok ? { go: 'plugins-toggle', params: { agent, scope, plugins: JSON.stringify(pluginStates(r[0])) }, root: 'skills-scope' } : undefined),
  };
}

/** Where: the user's own folder first (the usual place), or this repository. */
export const scopeView: View = {
  title: (p) => (p.frame.params.agent === 'all' ? 'Every agent' : (agentLabel[p.frame.params.agent as AgentName] ?? '')),
  body: (caps, p) => [
    paint(caps, PALETTE.amber, 'Where?'),
    '',
    paint(caps, PALETTE.muted, `Your user folder works in every repository; this repository's folder only here${p.data.folder.repo ? ` (${p.data.folder.repo.root})` : ` (${p.data.folder.cwd})`}.`),
  ],
  items: (p) => {
    const agent = p.frame.params.agent as AgentName | 'all';
    const pick = (scope: string): Action => (p.frame.params.mode === 'toggle' ? { run: statusRun(agent, scope) } : { run: installRun({ ...p.frame.params, scope }) });
    return [
      { label: 'For you, in every repository', hint: `${folderHint(agent, 'user')} (the default)`, action: pick('user') },
      { label: 'In this repository', hint: folderHint(agent, 'project'), action: pick('project') },
    ];
  },
};

// ─── Adding and removing a marketplace ─────────────────────────────────────

/** An https clone URL or a local path; ssh isn't, because toil would have to run ssh. */
export function checkUrl(text: string): string | undefined {
  if (text === '') return 'Enter the https clone URL (or a local path).';
  if (/^(git@|ssh:\/\/)/i.test(text)) return 'toil clones over https only: use the repository\'s https clone URL.';
  if (/^http:\/\//i.test(text)) return 'Use https, so the token (if any) is never sent in the clear.';
  if (/^https:\/\/[^/]*@/i.test(text)) return 'Leave the user name and token out of the URL; you are asked for the token next.';
  return undefined;
}

export const addUrlView: View = {
  title: () => 'Add',
  body: (caps) => [
    paint(caps, PALETTE.amber, 'Step 1 of 3: where it is'),
    '',
    'The marketplace\'s git clone URL, https://<host>/<path>.git, or a local path. If it is private, toil asks for a token in step 3 and keeps it in your OS credential store, never in a file.',
  ],
  input: {
    label: () => 'Clone URL',
    submit: (text): Action | { error: string } => {
      const error = checkUrl(text);
      return error ? { error } : { go: 'skills-add-name', params: { url: text } };
    },
  },
};

export const addNameView: View = {
  title: () => 'Name',
  body: (caps) => [paint(caps, PALETTE.amber, 'Step 2 of 3: name'), '', 'What should it be called? You pick it with --marketplace when you have more than one.'],
  input: {
    label: () => 'Marketplace name',
    initial: (p) => {
      const base = nameFromRepo(repoNameFromUrl(p.frame.params.url ?? ''));
      const taken = new Set(connectionNames(p.data));
      if (!taken.has(base)) return base;
      for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
    },
    submit: (text, p): Action | { error: string } => {
      if (!CONNECTION_NAME.test(text)) return { error: 'Use lowercase letters, digits and single hyphens, starting with a letter.' };
      if (connectionNames(p.data).includes(text)) return { error: `There's already a connection named ${text}.` };
      return {
        run: {
          title: `Add ${text}`,
          steps: [{ args: ['skills', 'marketplace', 'add', p.frame.params.url!, '--name', text, '--allow-write'], label: 'Step 3 of 3: an access token (leave it empty for a public repository), then the clone' }],
          next: (r) => (r[0]?.envelope.ok ? { go: 'marketplace', params: { name: text }, root: 'skills' } : undefined),
        },
      };
    },
  },
};

export const removeMarketplaceView: View = {
  title: () => 'Remove',
  body: (caps, p) => [
    paint(caps, PALETTE.accent, `Remove ${p.frame.params.name}?`),
    '',
    'This takes it out of your config and its token out of the OS credential store. Its clone and the skills already installed from it stay where they are.',
  ],
  input: {
    label: (p) => `Type ${p.frame.params.name} to remove it`,
    submit: (text, p): Action | { error: string } => {
      const name = p.frame.params.name!;
      if (text !== name) return { error: `That isn't "${name}", so nothing was removed.` };
      return { run: { title: `Remove ${name}`, steps: [{ args: ['skills', 'marketplace', 'remove', name] }], next: (r) => (r[0]?.envelope.ok ? { go: 'skills', root: 'skills' } : undefined) } };
    },
  },
};

// ─── Plugins: switching them on and off ────────────────────────────────────

/** One installed plugin in one folder, as the checkbox screen shows it. */
export interface PluginState {
  marketplace: string;
  plugin: string;
  on: number;
  off: number;
}

/** Installed plugins, from a `skills status` envelope: marketplace skills grouped by plugin. */
export function pluginStates(result: StepResult): PluginState[] {
  const d = result.envelope.ok ? (result.envelope.data as { skills?: Array<{ source?: string; plugin?: string | null; marketplace?: string | null; enabled?: boolean }> }) : undefined;
  const by = new Map<string, PluginState>();
  for (const s of d?.skills ?? []) {
    if (s.source !== 'marketplace' || !s.plugin || !s.marketplace) continue;
    const key = pluginId(s.marketplace, s.plugin);
    const state = by.get(key) ?? { marketplace: s.marketplace, plugin: s.plugin, on: 0, off: 0 };
    if (s.enabled) state.on++;
    else state.off++;
    by.set(key, state);
  }
  return [...by.values()].sort((a, b) => a.marketplace.localeCompare(b.marketplace) || a.plugin.localeCompare(b.plugin));
}

const pluginId = (marketplace: string, plugin: string) => `${marketplace}/${plugin}`;

/** On when any of its skills is: switching it off then stashes the rest. */
const isOn = (s: PluginState) => s.on > 0;

export const pluginsView: View = {
  title: () => 'Plugins',
  body: (caps) => [
    paint(caps, PALETTE.amber, 'Switch installed plugins on and off'),
    '',
    paint(caps, PALETTE.muted, 'Switched off, a plugin\'s skills move to a hidden folder the agent doesn\'t read; nothing is deleted. Pick the agent and place first.'),
  ],
  items: () => [{ label: 'Choose agent and place', hint: 'Then tick what should be on', action: { go: 'skills-agent', params: { mode: 'toggle' } } }],
};

export const toggleView: View = {
  title: (p) => (p.frame.params.scope === 'project' ? 'This repository' : 'Your folder'),
  body: (caps, p) => {
    const states = parse<PluginState[]>(p.frame.params.plugins, []);
    if (states.length === 0) return [paint(caps, PALETTE.muted, 'No plugins installed here from a marketplace. Install one from Skills first.')];
    return [paint(caps, PALETTE.muted, 'Space switches a plugin, enter shows what will change before anything is written.')];
  },
  checklist: {
    options: (p) =>
      parse<PluginState[]>(p.frame.params.plugins, []).map((s) => ({
        id: pluginId(s.marketplace, s.plugin),
        label: s.plugin,
        hint: `${s.marketplace}, ${s.on + s.off} skill${s.on + s.off === 1 ? '' : 's'}${s.on && s.off ? ` (${s.off} off)` : ''}`,
      })),
    initial: (p) => parse<PluginState[]>(p.frame.params.plugins, []).filter(isOn).map((s) => pluginId(s.marketplace, s.plugin)),
    confirm: (checked, p): Action => {
      const states = parse<PluginState[]>(p.frame.params.plugins, []);
      const changes = toggleChanges(states, checked);
      // Nothing ticked differently: nothing to write, so back to the start of the module.
      if (changes.length === 0) return { go: 'plugins', root: 'plugins' };
      return { go: 'plugins-review', params: { agent: p.frame.params.agent!, scope: p.frame.params.scope!, changes: JSON.stringify(changes) } };
    },
  },
};

export interface ToggleChange {
  marketplace: string;
  plugin: string;
  on: boolean;
}

/** What the ticks change: a plugin ticked that was off goes on, and one unticked that was on goes off. Nothing else. */
export function toggleChanges(states: readonly PluginState[], checked: readonly string[]): ToggleChange[] {
  const want = new Set(checked);
  const out: ToggleChange[] = [];
  for (const s of states) {
    const id = pluginId(s.marketplace, s.plugin);
    if (want.has(id) && s.off > 0) out.push({ marketplace: s.marketplace, plugin: s.plugin, on: true });
    else if (!want.has(id) && s.on > 0) out.push({ marketplace: s.marketplace, plugin: s.plugin, on: false });
  }
  return out;
}

/** The commands a set of changes comes to, one per plugin, exactly as you'd type them. */
export function toggleSteps(changes: readonly ToggleChange[], agent: string, scope: string): Run['steps'] {
  return changes.map((c) => ({ args: ['skills', 'marketplace', c.on ? 'enable' : 'disable', c.plugin, '--marketplace', c.marketplace, '--agent', agent, '--scope', scope, '--allow-write'] }));
}

export const reviewView: View = {
  title: () => 'Review',
  body: (caps: Caps, p: ViewProps) => {
    const changes = parse<ToggleChange[]>(p.frame.params.changes, []);
    const lines = [paint(caps, PALETTE.amber, 'This will change:'), ''];
    for (const c of changes) lines.push(`  ${c.on ? ok(caps, true, 'on ') : ok(caps, false, 'off')}  ${c.plugin}  ${paint(caps, PALETTE.faint, c.marketplace)}`);
    const off = [...new Set(changes.map((c) => c.marketplace))].filter((m) => !writesOn(p.data, m));
    if (off.length) lines.push('', ok(caps, false, `Writes are off for ${off.join(', ')}, so those changes will be refused. Turn them on from Skills first.`));
    lines.push('', paint(caps, PALETTE.muted, 'Each line runs one command; nothing else in the folder or its index changes.'));
    return lines;
  },
  items: (p) => {
    const changes = parse<ToggleChange[]>(p.frame.params.changes, []);
    const { agent, scope } = p.frame.params as Record<string, string>;
    return [
      { label: 'Save', hint: `${changes.length} command${changes.length === 1 ? '' : 's'}`, action: { run: { title: 'Switch plugins', keepGoing: true, steps: toggleSteps(changes, agent!, scope!), next: () => ({ run: statusRun(agent!, scope!) }) } } },
      { label: 'Back', hint: 'Change the ticks', action: { back: true } },
    ];
  },
};

/** The result line for a `skills` command, from its envelope. */
export function skillsOutcome(result: StepResult): string {
  const d = (result.envelope.data ?? {}) as Record<string, unknown>;
  const [, sub, verb] = result.args;
  const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join(', ') : 'nothing');
  if (sub === 'status') return `${String(d.total)} skill${d.total === 1 ? '' : 's'}: ${String(d.enabled)} on, ${String(d.disabled)} off, ${String(d.untracked)} not installed by toil.`;
  if (verb === 'add') return `Added ${String(d.name)} with writes ${d.writes ? 'on' : 'off'}; ${String(d.total)} plugin${d.total === 1 ? '' : 's'} in it. ${String(d.next ?? '')}`.trim();
  if (verb === 'plugins') return `${String(d.total)} plugin${d.total === 1 ? '' : 's'} in ${String(d.marketplace)}.`;
  if (verb === 'remove') return `Removed ${String((d.removed as { name?: unknown } | undefined)?.name ?? '')}; its clone and installed skills stay.`;
  if (verb === 'enable') return `${String(d.plugin ?? '')}: switched on ${list(d.enabled)}.`;
  if (verb === 'disable') return `${String(d.plugin ?? '')}: switched off ${list(d.disabled)}${Array.isArray(d.alreadyDisabled) && d.alreadyDisabled.length ? ` (already off: ${d.alreadyDisabled.join(', ')})` : ''}.`;
  if (verb === 'sync') {
    if (d.skipped) return String(d.message ?? 'Nothing to update.');
    if (Array.isArray(d.installed)) return `Installed ${list(d.installed)} into ${String(d.target)}.`;
    return `Installed ${String(d.total)} skill${d.total === 1 ? '' : 's'}${d.target ? ` into ${String(d.target)}` : ''}.`;
  }
  return 'Done.';
}
