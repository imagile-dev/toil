import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';

/**
 * The command contract as data, and the diff of a built CLI against it.
 *
 * `docs/command-contract.json` freezes the contract's surface: every command
 * path, its aliases, positional arguments and flags. `docs/command-contract.md`
 * lists the divergences toil is allowed, each with a reason. A difference that
 * isn't listed is a failure, so the find-and-replace migration keeps working.
 *
 * Scope is the areas toil has registered: an area not yet built is a
 * planned gap, not a divergence. Once an area registers, every contract command
 * under it must be there. toil may add commands and flags; only what the
 * contract has and toil lacks (or spells differently) is reported. An
 * exemption exists only if it is written down, which is also how audits work.
 */

export interface ContractOption {
  flags: string;
  description: string;
}

export interface ContractCommand {
  command: string;
  usage: string;
  leaf: boolean;
  options: ContractOption[];
  aliases?: string[];
}

export interface Contract {
  globalOptions: ContractOption[];
  commands: ContractCommand[];
}

const docs = join(import.meta.dirname, '..', '..', 'docs');

export function loadContract(): Contract {
  return JSON.parse(readFileSync(join(docs, 'command-contract.json'), 'utf8')) as Contract;
}

/**
 * Every code span in the first column of the Divergences table: `jira schema`,
 * `--dry-run`, `git credentials`. A difference is allowed when its identifier
 * (a command path, `<path> <flag>`, or a global flag) is one of these.
 */
export function loadDivergences(markdown = readFileSync(join(docs, 'command-contract.md'), 'utf8')): Set<string> {
  const section = markdown.split(/^## Divergences\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const allowed = new Set<string>();
  for (const line of section.split(/\r?\n/)) {
    if (!line.startsWith('|') || /^\|\s*-/.test(line)) continue;
    const first = line.split('|')[1] ?? '';
    for (const match of first.matchAll(/`([^`]+)`/g)) allowed.add(match[1]!.trim());
  }
  return allowed;
}

/** The long form of a flags string: `-v, --version` -> `--version`. */
const longFlag = (flags: string) => flags.split(/[ ,|]+/).find((p) => p.startsWith('--')) ?? flags;

/** Positional arguments from a usage line: `[options] <key> [rest...]` -> ['<key>', '[rest...]']. */
export function usageArguments(usage: string): string[] {
  return usage
    .split(/\s+/)
    .filter((t) => (t.startsWith('<') || t.startsWith('[')) && t !== '[options]' && t !== '[command]');
}

function argumentsOf(cmd: Command): string[] {
  return cmd.registeredArguments.map((a) => {
    const name = `${a.name()}${a.variadic ? '...' : ''}`;
    return a.required ? `<${name}>` : `[${name}]`;
  });
}

function find(program: Command, path: string[]): Command | undefined {
  let at: Command | undefined = program;
  for (const segment of path) {
    at = at?.commands.find((c) => c.name() === segment || c.aliases().includes(segment));
    if (!at) return undefined;
  }
  return at;
}

export interface Divergence {
  /** What to list in command-contract.md to allow it: a path, `<path> <flag>`, or a global flag. */
  id: string;
  problem: string;
}

/** Every unlisted difference between `program` and the contract, for the areas in `areas`. */
export function diffContract(program: Command, contract: Contract, areas: ReadonlySet<string>, allowed: ReadonlySet<string>): Divergence[] {
  const out: Divergence[] = [];
  const report = (id: string, problem: string) => {
    if (!allowed.has(id)) out.push({ id, problem });
  };

  for (const option of contract.globalOptions) {
    const toil = program.options.find((o) => o.flags === option.flags);
    if (!toil) report(longFlag(option.flags), `global flag ${option.flags} is missing`);
  }

  for (const entry of contract.commands) {
    const path = entry.command.split(' ');
    if (!areas.has(path[0]!)) continue;
    const id = entry.command;
    const cmd = find(program, path);
    if (!cmd) {
      report(id, 'command is missing');
      continue;
    }
    for (const alias of entry.aliases ?? []) {
      if (!cmd.aliases().includes(alias)) report(id, `alias ${alias} is missing`);
    }
    const expectedArgs = usageArguments(entry.usage);
    const actualArgs = argumentsOf(cmd);
    if (JSON.stringify(expectedArgs) !== JSON.stringify(actualArgs)) {
      report(id, `positional arguments are ${JSON.stringify(actualArgs)}, contract has ${JSON.stringify(expectedArgs)}`);
    }
    for (const option of entry.options) {
      const exact = cmd.options.find((o) => o.flags === option.flags);
      if (exact) continue;
      const sameLong = cmd.options.find((o) => o.long === longFlag(option.flags));
      report(`${id} ${longFlag(option.flags)}`, sameLong ? `flag is spelled ${sameLong.flags}, contract has ${option.flags}` : `flag ${option.flags} is missing`);
    }
  }
  return out;
}
