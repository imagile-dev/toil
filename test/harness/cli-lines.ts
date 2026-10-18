import type { Command, Option } from 'commander';
import { buildProgram } from '../../src/program.js';
import { commands, routedAliases } from '../../src/registry.js';

// The command lines docs show, read the way a shell would and walked down the
// real command tree. Shared by the skill test and the utilities page test, so
// both hold an example to the same definition of "a real flag".

/**
 * The CLI as a person types it, built from the registry exactly as `toil` builds
 * it, so a command or flag the skill names can be looked up rather than
 * guessed at. A reference that names a flag nobody registered is a form with a
 * field nobody reads.
 */
export const { program } = buildProgram({
  commands,
  routed: routedAliases,
  version: '0.0.0-test',
  io: { stdout: () => {}, stderr: () => {}, writeFile: () => {} },
  createContext: () => {
    throw new Error('cli-lines only reads the command tree');
  },
  startMcp: async () => {},
});

/** Every long and short flag `cmd` accepts, its own and its ancestors' (group and global flags), plus --help. */
export function flagsOf(cmd: Command): Map<string, Option | undefined> {
  const out = new Map<string, Option | undefined>([['--help', undefined], ['-h', undefined]]);
  for (let at: Command | null = cmd; at; at = at.parent) {
    for (const opt of at.options) for (const name of [opt.long, opt.short]) if (name) out.set(name, opt);
  }
  return out;
}

export const subcommand = (cmd: Command, name: string) => cmd.commands.find((c) => c.name() === name || c.aliases().includes(name));

/** Splits a command line into words, keeping quoted strings whole. */
export function words(line: string): string[] {
  return [...line.matchAll(/(?:'[^']*'|"[^"]*"|<[^>]*>|[^\s'"<])+/g)].map((m) => m[0]);
}

/** A word that stands for a value the reader fills in, past which nothing can be checked. */
export const PLACEHOLDER = /^[<[{…]|^\.\.\.|^\$/;

/**
 * Walks `toil <words>` down the command tree. Returns the first word that
 * isn't a command, an argument or a flag of the command it lands on, or
 * undefined when the whole line checks out.
 */
export function checkInvocation(args: string[]): string | undefined {
  let cmd: Command = program;
  for (let i = 0; i < args.length; i++) {
    const word = args[i]!;
    if (PLACEHOLDER.test(word)) return undefined;
    // `toil wait … -- <command>`: what follows is a toil command line of its own, checked the same way.
    if (word === '--') return checkInvocation(args.slice(i + 1));
    // A lone `-` is stdin, and `-1` a negative number, as commander reads them: arguments rather than flags.
    if (word.startsWith('-') && word !== '-' && !/^-\d/.test(word)) {
      const name = word.split('=')[0]!;
      const flags = flagsOf(cmd);
      if (!flags.has(name)) return `${name} (not a flag of toil ${commandPath(cmd)})`;
      const opt = flags.get(name);
      if (opt?.variadic) while (args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) i++;
      else if (opt && (opt.required || opt.optional) && !word.includes('=')) i++;
      continue;
    }
    const sub = subcommand(cmd, word);
    if (sub) {
      cmd = sub;
      continue;
    }
    if (cmd.commands.length) return `${word} (not a command under toil ${commandPath(cmd)})`;
    if (!cmd.registeredArguments.length) return `${word} (toil ${commandPath(cmd)} takes no arguments)`;
  }
  return undefined;
}

export const commandPath = (cmd: Command): string => {
  const names: string[] = [];
  for (let at: Command | null = cmd; at?.parent; at = at.parent) names.unshift(at.name());
  return names.join(' ') || '(root)';
};

/** Words that start a toil invocation: `toil`, `node <clone>/dist/toil.js`, `npx -y @imagile-dev/toil`. */
export const isToil = (word: string, before: string | undefined) =>
  (word === 'toil' && (before === undefined || ['--', '&&', '||', '|', ';', '$'].includes(before))) ||
  (word.endsWith('toil.js') && before === 'node') ||
  (word === '@imagile-dev/toil' && (before === '-y' || before === 'npx'));

/** Every toil invocation in a reference file: inline code spans, and lines of shell code blocks. */
export function invocations(text: string): string[][] {
  const lines: string[] = [];
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const opens = /^```(\w*)/.exec(line);
    if (opens) {
      fence = fence === undefined ? opens[1] : undefined;
      continue;
    }
    if (fence !== undefined) {
      if (['bash', 'sh', 'shell', 'powershell', 'ps1', ''].includes(fence)) lines.push(line);
    } else {
      for (const m of line.matchAll(/`([^`]+)`/g)) lines.push(m[1]!);
    }
  }
  const out: string[][] = [];
  for (const line of lines) {
    const all = words(line);
    for (let i = 0; i < all.length; i++) {
      if (!isToil(all[i]!, all[i - 1])) continue;
      const rest: string[] = [];
      for (const word of all.slice(i + 1)) {
        if (['&&', '||', '|', ';', '>', '>>', '2>'].includes(word) || word.startsWith('#')) break;
        // A line continuation, in bash or PowerShell.
        if (word === '\\' || word === '`') continue;
        rest.push(word);
      }
      out.push(rest);
    }
  }
  return out;
}
