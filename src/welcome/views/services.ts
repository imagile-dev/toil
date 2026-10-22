import { connectionsOf } from '../../core/config.js';
import { healthWord, ok, type AreaSummary, type CommandSummary, type WelcomeData } from '../screens.js';
import { PALETTE, paint } from '../term.js';
import { commandLine, type Action, type Caps, type Item, type Run, type View, type ViewProps } from '../view.js';

/**
 * The Services module: every area's commands as the tree the CLI already is,
 * `<service> <resource> <action>`, so finding a command in the menu teaches
 * you how to type it. Choosing one asks for its arguments, then any flags,
 * shows the line it will run, and runs that line as-is. A write asks first and
 * still needs writes on for the connection, which only the Connections module
 * changes; the menu can file the request but not approve it.
 */

const areaOf = (data: WelcomeData, name: string | undefined): AreaSummary | undefined => data.areas.find((a) => a.name === name);
const commandsOf = (area: AreaSummary | undefined): CommandSummary[] => area?.commands ?? [];
const findCommand = (data: WelcomeData, cmd: string | undefined): CommandSummary | undefined =>
  cmd === undefined ? undefined : commandsOf(areaOf(data, cmd.split(' ')[0])).find((c) => c.path.join(' ') === cmd);

/** The connections set up for an area, by name. */
function connectionsFor(data: WelcomeData, area: string): string[] {
  return 'error' in data.config ? [] : connectionsOf(data.config, area).sort();
}

/** The resources under an area: each second word, with the actions beneath it; a two-word command stands alone. */
export function resourcesOf(area: AreaSummary): Array<{ resource: string; commands: CommandSummary[] }> {
  const groups = new Map<string, CommandSummary[]>();
  for (const c of commandsOf(area)) {
    const key = c.path[1] ?? '';
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups].map(([resource, commands]) => ({ resource, commands }));
}

/** `jira issue get <key...> [--flags]`: the usage line, as --help would print it. */
export function usage(c: CommandSummary): string {
  const args = c.args.map((a) => {
    const name = `${a.name}${a.variadic ? '...' : ''}`;
    return a.required ? `<${name}>` : `[${name}]`;
  });
  const required = c.flags.filter((f) => f.required).map((f) => f.flags);
  const more = c.flags.some((f) => !f.required) ? ['[flags]'] : [];
  return ['toil', ...c.path, ...args, ...required, ...more].join(' ');
}

/**
 * Splits what was typed into argv the way a shell would for plain words and
 * quotes: `--body "two words"` is two arguments. No expansion, no escapes
 * beyond the quotes; anything cleverer belongs in a real shell.
 */
export function splitArgs(text: string): string[] | { error: string } {
  const out: string[] = [];
  let current = '';
  let quote: string | undefined;
  let started = false;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) out.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (quote) return { error: `A ${quote} quote isn't closed.` };
  if (started) out.push(current);
  return out;
}

function runOf(data: WelcomeData, c: CommandSummary, argv: string[]): Action {
  const run: Run = { title: commandLine(data, argv), steps: [{ args: argv }], showData: true, next: () => ({ go: 'service-command', params: { cmd: c.path.join(' ') }, root: 'service-command' }) };
  return c.writes ? { go: 'service-confirm', params: { cmd: c.path.join(' '), argv: JSON.stringify(argv) } } : { run };
}

function commandItem(c: CommandSummary, label = c.path.slice(2).join(' ') || c.path[1]!): Item {
  return { label, hint: `${c.description}${c.writes ? ' (writes)' : c.mayWrite ? ' (some calls write)' : ''}`, action: { go: 'service-command', params: { cmd: c.path.join(' ') } } };
}

/** Commands whose path or description holds every word typed. */
export function matching(data: WelcomeData, query: string): CommandSummary[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return data.areas.flatMap(commandsOf).filter((c) => {
    const text = `${c.path.join(' ')} ${c.description}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

export const servicesView: View = {
  title: () => 'Services',
  body: (caps) => [paint(caps, PALETTE.muted, 'Every command is toil <service> <resource> <action>. Pick a service, then what to act on.')],
  items: (p) => {
    const areas = p.data.areas.filter((a) => commandsOf(a).length > 0);
    const connected = areas.filter((a) => connectionsFor(p.data, a.name).length > 0);
    const rest = areas.filter((a) => !connected.includes(a));
    return [
      { label: 'Find a command', hint: 'Search every service by name or description', action: { go: 'service-find' } },
      ...[...connected, ...rest].map((a): Item => {
        const names = connectionsFor(p.data, a.name);
        // A connection named after its area says nothing the label doesn't; "connected" does.
        const who = names.length === 1 && names[0] === a.name ? 'connected' : names.join(', ');
        return { label: a.name, hint: names.length ? `${who} · ${a.description}` : a.description, action: { go: 'service', params: { area: a.name } } };
      }),
    ];
  },
};

export const serviceView: View = {
  title: (p) => p.frame.params.area ?? '',
  body: (caps, p) => {
    const area = areaOf(p.data, p.frame.params.area);
    if (!area) return [ok(caps, false, `toil has no ${p.frame.params.area} area.`)];
    const names = connectionsFor(p.data, area.name);
    const connections = names.length
      ? names.map((n) => `${n} ${healthWord(caps, p.session.health[n])}`).join(', ')
      : area.configurable
        ? ok(caps, false, 'none yet; commands that talk to it need one')
        : 'none needed';
    return [paint(caps, PALETTE.highlight, area.description), '', `${paint(caps, PALETTE.muted, 'Connections ')} ${connections}`];
  },
  items: (p) => {
    const area = areaOf(p.data, p.frame.params.area);
    if (!area) return [];
    const add: Item[] =
      area.configurable && connectionsFor(p.data, area.name).length === 0 ? [{ label: 'Add a connection', hint: `Set up ${area.name} first`, action: { go: 'add-name', params: { area: area.name } } }] : [];
    return [
      ...add,
      ...resourcesOf(area).map(({ resource, commands }): Item =>
        commands.length === 1 && commands[0]!.path.length === 2
          ? commandItem(commands[0]!)
          : { label: resource, hint: commands.map((c) => c.path.slice(2).join(' ')).join(', '), action: { go: 'service-resource', params: { area: area.name, resource } } },
      ),
    ];
  },
};

export const resourceView: View = {
  title: (p) => p.frame.params.resource ?? '',
  items: (p) => {
    const area = areaOf(p.data, p.frame.params.area);
    const found = area ? resourcesOf(area).find((r) => r.resource === p.frame.params.resource) : undefined;
    // Reads first: looking costs nothing, and it's usually what someone came for.
    const commands = [...(found?.commands ?? [])].sort((a, b) => Number(a.writes) - Number(b.writes));
    return commands.map((c) => commandItem(c));
  },
};

function commandBody(caps: Caps, c: CommandSummary): string[] {
  const lines = [paint(caps, PALETTE.highlight, c.description), '', paint(caps, PALETTE.ink, usage(c))];
  if (c.writes) lines.push('', ok(caps, false, 'Writes: needs writes on for the connection, and asks you before it runs.'));
  // A passthrough's method decides; the menu runs the line as typed, and toil's own gate says if it needs --allow-write.
  if (c.mayWrite) lines.push('', paint(caps, PALETTE.muted, 'Some calls write (a POST, say): add --allow-write to the flags for those; writes must be on for the connection.'));
  if (c.args.length) {
    lines.push('', paint(caps, PALETTE.muted, 'Arguments'));
    for (const a of c.args) lines.push(`  ${`<${a.name}>`.padEnd(28)} ${paint(caps, PALETTE.muted, a.description)}`);
  }
  if (c.flags.length) {
    lines.push('', paint(caps, PALETTE.muted, 'Flags'));
    for (const f of c.flags) lines.push(`  ${f.flags.padEnd(28)} ${paint(caps, PALETTE.muted, `${f.description}${f.required ? ' (required)' : ''}`)}`);
  }
  return lines;
}

export const commandView: View = {
  title: (p) => p.frame.params.cmd?.split(' ').slice(2).join(' ') || (p.frame.params.cmd?.split(' ')[1] ?? ''),
  body: (caps, p) => {
    const c = findCommand(p.data, p.frame.params.cmd);
    return c ? commandBody(caps, c) : [ok(caps, false, `There's no command ${p.frame.params.cmd}.`)];
  },
  items: (p) => {
    const c = findCommand(p.data, p.frame.params.cmd);
    if (!c) return [];
    const first: Action = c.args.length ? { go: 'service-arg', params: { cmd: p.frame.params.cmd!, i: '0', values: '[]' } } : { go: 'service-flags', params: { cmd: p.frame.params.cmd!, values: '[]' } };
    return [{ label: 'Run it', hint: c.args.length ? `Asks for ${c.args.map((a) => `<${a.name}>`).join(', ')}, then flags` : 'Asks for any flags, then runs', action: first }];
  },
};

/** One positional argument per screen; a variadic one takes several, split like a shell would. */
export const argView: View = {
  title: (p) => {
    const c = findCommand(p.data, p.frame.params.cmd);
    return c ? `<${c.args[Number(p.frame.params.i)]?.name ?? ''}>` : '';
  },
  body: (caps, p) => {
    const c = findCommand(p.data, p.frame.params.cmd);
    const a = c?.args[Number(p.frame.params.i)];
    return a ? [paint(caps, PALETTE.ink, usage(c!)), '', a.description, ...(a.variadic ? [paint(caps, PALETTE.muted, 'Separate several with spaces.')] : [])] : [];
  },
  input: {
    label: (p) => findCommand(p.data, p.frame.params.cmd)?.args[Number(p.frame.params.i)]?.name ?? '',
    submit: (text, p): Action | { error: string } => {
      const c = findCommand(p.data, p.frame.params.cmd);
      const i = Number(p.frame.params.i);
      const a = c?.args[i];
      if (!c || !a) return { back: true };
      const split = a.variadic ? splitArgs(text) : text.trim() ? [text.trim()] : [];
      if (!Array.isArray(split)) return split;
      if (a.required && split.length === 0) return { error: `<${a.name}> is required.` };
      // A leading - would be read as a flag; the menu won't guess which was meant.
      if (split.some((v) => v.startsWith('-'))) return { error: `<${a.name}> can't start with -: run that one from a shell, after --.` };
      const values = [...(JSON.parse(p.frame.params.values ?? '[]') as string[]), ...split];
      const params = { cmd: p.frame.params.cmd!, values: JSON.stringify(values) };
      // An optional argument left empty ends the list, so a later one can't slide into its place.
      return i + 1 < c.args.length && split.length > 0 ? { go: 'service-arg', params: { ...params, i: String(i + 1) } } : { go: 'service-flags', params };
    },
  },
};

/** With more than one connection to the service, the flag that picks one, and the names to pick from. */
function connectionHint(caps: Caps, data: WelcomeData, c: CommandSummary): string[] {
  const names = connectionsFor(data, c.path[0]!);
  return names.length > 1 ? [`  ${'--connection <name>'.padEnd(28)} ${paint(caps, PALETTE.muted, `One of ${names.join(', ')}; the default when left out`)}`] : [];
}

/** Flags as you'd type them after the command; the required ones are filled in to edit. */
export const flagsView: View = {
  title: () => 'Flags',
  body: (caps, p) => {
    const c = findCommand(p.data, p.frame.params.cmd);
    if (!c) return [];
    const values = JSON.parse(p.frame.params.values ?? '[]') as string[];
    return [
      paint(caps, PALETTE.faint, `$ ${commandLine(p.data, [...c.path, ...values])} …`),
      '',
      ...c.flags.map((f) => `  ${f.flags.padEnd(28)} ${paint(caps, PALETTE.muted, `${f.description}${f.required ? ' (required)' : ''}`)}`),
      ...(c.flags.length ? [] : [paint(caps, PALETTE.muted, 'It has no flags of its own; press enter to run it.')]),
      ...connectionHint(caps, p.data, c),
    ];
  },
  input: {
    label: () => 'Flags (optional)',
    initial: (p) =>
      (findCommand(p.data, p.frame.params.cmd)?.flags ?? [])
        .filter((f) => f.required)
        .map((f) => f.flags.split(/[ ,]+/).find((part) => part.startsWith('--'))! + ' ')
        .join(''),
    submit: (text, p): Action | { error: string } => {
      const c = findCommand(p.data, p.frame.params.cmd);
      if (!c) return { back: true };
      const flags = splitArgs(text);
      if (!Array.isArray(flags)) return flags;
      return runOf(p.data, c, [...c.path, ...(JSON.parse(p.frame.params.values ?? '[]') as string[]), ...flags]);
    },
  },
};

/** A write runs only after this, with --allow-write added; the connection's own writes setting still decides. */
export const confirmView: View = {
  title: () => 'Confirm',
  body: (caps, p) => {
    const argv = JSON.parse(p.frame.params.argv ?? '[]') as string[];
    return [
      ok(caps, false, 'This changes something on the service.'),
      '',
      paint(caps, PALETTE.ink, `$ ${commandLine(p.data, [...argv, '--allow-write'])}`),
      '',
      paint(caps, PALETTE.muted, "It runs only if writes are on for the connection; if they're off, it says so and changes nothing."),
    ];
  },
  items: (p: ViewProps) => {
    const c = findCommand(p.data, p.frame.params.cmd);
    const argv = [...(JSON.parse(p.frame.params.argv ?? '[]') as string[]), '--allow-write'];
    const run: Run = { title: commandLine(p.data, argv), steps: [{ args: argv }], showData: true, next: () => ({ go: 'service-command', params: { cmd: c?.path.join(' ') ?? '' }, root: 'service-command' }) };
    // Cancel first, so a stray enter sends nothing.
    return [
      { label: 'Cancel', hint: 'Nothing is sent', action: { go: 'service-command', params: { cmd: c?.path.join(' ') ?? '' }, root: 'service-command' } },
      { label: 'Run it', hint: 'With --allow-write', action: { run } },
    ];
  },
};

export const findView: View = {
  title: () => 'Find',
  body: (caps) => [paint(caps, PALETTE.muted, 'Words to look for in a command or what it does, such as "pr comment" or "sprint".')],
  input: {
    label: () => 'Find',
    submit: (text): Action | { error: string } => (text.trim() ? { go: 'service-matches', params: { q: text.trim() } } : { error: 'Type a word or two to look for.' }),
  },
};

export const matchesView: View = {
  title: (p) => `"${p.frame.params.q ?? ''}"`,
  body: (caps, p) => (matching(p.data, p.frame.params.q ?? '').length ? [] : [ok(caps, false, 'No command matches every word. Try fewer.')]),
  items: (p) => matching(p.data, p.frame.params.q ?? '').map((c) => commandItem(c, c.path.join(' '))),
};
