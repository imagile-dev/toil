import type { Command, Option } from 'commander';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modules } from '../src/areas.generated.js';
import { commandName } from '../src/core/command.js';
import { envName } from '../src/core/config.js';
import { supportedText, type SupportedVersion } from '../src/core/supported.js';
import { buildProgram } from '../src/program.js';
import { areas, commands, routedAliases } from '../src/registry.js';

/**
 * The skill shipped to users (skills/toil/) is how an agent learns an area
 * exists and how to configure it. SKILL.md is generic on purpose: it names the
 * rule (`<area>.md`, beside it), and each area's file carries its own
 * frontmatter, so twenty integrations never edit one index table. A registered area
 * with no reference file is an area nobody's agent will find. Undocumented
 * capability is, for audit purposes, indistinguishable from no capability.
 */
const dir = join(import.meta.dirname, '..', 'skills', 'toil');
/** The files in the skill that belong to no area: the index, installing toil, and the MCP server. */
const GENERAL = ['SKILL.md', 'install.md', 'mcp.md'];
const integrations = join(import.meta.dirname, '..', 'site', 'src', 'data', 'integrations');

/** The `key: value` lines between a file's opening `---` fences. */
export function frontmatter(text: string): Record<string, string> | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) return undefined;
  const out: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const at = line.indexOf(': ');
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 2).trim();
  }
  return out;
}

/** Groups of standalone commands, `util` for `toil util jwt decode`; a lone standalone command (`version`) has none. */
const standaloneGroups = [...new Set(commands.filter((d) => d.kind === 'standalone' && d.path.length > 1).map((d) => d.path[0]))];

const supportedOf = new Map(modules.flatMap((m) => (m.area ? [[m.area.name, m.supported] as const] : [])));

describe('shipped skill', () => {
  const index = readFileSync(join(dir, 'SKILL.md'), 'utf8');

  it('SKILL.md names no area list to keep current, only the <area>.md rule', () => {
    expect(index).not.toMatch(/^\| Area \|/m);
    expect(index).toContain('named after it');
  });

  it('every reference file belongs to a registered area or group of standalone commands', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.md') && !GENERAL.includes(f));
    expect(files.filter((f) => ![...areas.map((a) => a.name), ...standaloneGroups].some((name) => `${name}.md` === f))).toEqual([]);
  });

  // A group of standalone commands (`toil util ...`) has no connection, so no
  // keys or supported versions to document, but agents still need its file.
  for (const group of standaloneGroups) {
    it(`${group}: has skills/toil/${group}.md with frontmatter, naming every command`, () => {
      expect(existsSync(join(dir, `${group}.md`)), `add skills/toil/${group}.md`).toBe(true);
      const doc = readFileSync(join(dir, `${group}.md`), 'utf8');
      const meta = frontmatter(doc);
      expect(meta?.area, `start skills/toil/${group}.md with ---\\narea: ${group}\\ndescription: ...\\n---`).toBe(group);
      expect(meta?.description ?? '').not.toBe('');
      expect(meta?.description ?? '', 'no ": " inside the description').not.toContain(': ');
      for (const def of commands.filter((d) => d.kind === 'standalone' && d.path[0] === group)) {
        expect(doc.includes(`\`toil ${def.path.join(' ')}`), `${commandName(def)} is not named in skills/toil/${group}.md`).toBe(true);
      }
    });
  }

  for (const area of areas) {
    it(`${area.name}: has skills/toil/${area.name}.md with frontmatter naming the area and what it covers`, () => {
      expect(existsSync(join(dir, `${area.name}.md`)), `add skills/toil/${area.name}.md`).toBe(true);
      const meta = frontmatter(readFileSync(join(dir, `${area.name}.md`), 'utf8'));
      expect(meta?.area, `start skills/toil/${area.name}.md with ---\\narea: ${area.name}\\ndescription: ...\\n---`).toBe(area.name);
      expect(meta?.description ?? '', 'a one-line description of what the area covers').not.toBe('');
      // A colon and a space would make the line a YAML mapping, not a sentence.
      expect(meta?.description ?? '', 'no ": " inside the description').not.toContain(': ');
    });

    it(`${area.name}: its reference names every command and every connection key's env var`, () => {
      const doc = readFileSync(join(dir, `${area.name}.md`), 'utf8');
      for (const def of commands.filter((d) => d.path[0] === area.name)) {
        // In code, either bare (`get-issue`) or in full (`toil jira get-issue`).
        const name = def.path.slice(1).join(' ');
        const named = doc.includes(`\`${name}`) || doc.includes(`\`toil ${def.path.join(' ')}`);
        expect(named, `${commandName(def)} is not named in skills/toil/${area.name}.md`).toBe(true);
      }
      for (const key of Object.keys(area.connection.shape)) {
        expect(doc, `${area.name}.${key}`).toContain(envName(area.name, key));
      }
    });

    it(`${area.name}: its reference names every CI fallback variable it declares`, () => {
      const doc = readFileSync(join(dir, `${area.name}.md`), 'utf8');
      const fallbacks = Object.entries((area.fallbacks ?? {}) as Record<string, string[] | undefined>);
      for (const [key, names] of fallbacks) {
        for (const name of names ?? []) expect(doc, `${area.name}.${key} falls back to ${name}; say so in skills/toil/${area.name}.md`).toContain(name);
      }
    });

    it(`${area.name}: declares its supported versions once, and its skill file and site data say the same`, () => {
      const supported = supportedOf.get(area.name);
      expect(supported, `export const supported: SupportedVersion from src/areas/${area.name}/index.ts`).toBeDefined();
      const doc = readFileSync(join(dir, `${area.name}.md`), 'utf8');
      expect(doc, `skills/toil/${area.name}.md needs a "**Supported versions:**" line`).toContain(`**Supported versions:** ${supportedText(supported!)}`);
      const site = join(integrations, `${area.name}.json`);
      if (existsSync(site)) {
        const data = JSON.parse(readFileSync(site, 'utf8')) as { supported?: SupportedVersion };
        expect(data.supported, `site/src/data/integrations/${area.name}.json "supported"`).toEqual(supported);
      }
    });
  }
});

/**
 * The CLI as a person types it, built from the registry exactly as `toil` builds
 * it, so a command or flag the skill names can be looked up rather than
 * guessed at. A reference that names a flag nobody registered is a form with a
 * field nobody reads.
 */
const { program } = buildProgram({
  commands,
  routed: routedAliases,
  version: '0.0.0-test',
  io: { stdout: () => {}, stderr: () => {}, writeFile: () => {} },
  createContext: () => {
    throw new Error('skills.test only reads the command tree');
  },
  startMcp: async () => {},
});

/** Every long and short flag `cmd` accepts, its own and its ancestors' (group and global flags), plus --help. */
function flagsOf(cmd: Command): Map<string, Option | undefined> {
  const out = new Map<string, Option | undefined>([['--help', undefined], ['-h', undefined]]);
  for (let at: Command | null = cmd; at; at = at.parent) {
    for (const opt of at.options) for (const name of [opt.long, opt.short]) if (name) out.set(name, opt);
  }
  return out;
}

const subcommand = (cmd: Command, name: string) => cmd.commands.find((c) => c.name() === name || c.aliases().includes(name));

/** Splits a command line into words, keeping quoted strings whole. */
function words(line: string): string[] {
  return [...line.matchAll(/(?:'[^']*'|"[^"]*"|<[^>]*>|[^\s'"<])+/g)].map((m) => m[0]);
}

/** A word that stands for a value the reader fills in, past which nothing can be checked. */
const PLACEHOLDER = /^[<[{…]|^\.\.\.|^\$/;

/**
 * Walks `toil <words>` down the command tree. Returns the first word that
 * isn't a command, an argument or a flag of the command it lands on, or
 * undefined when the whole line checks out.
 */
function checkInvocation(args: string[]): string | undefined {
  let cmd: Command = program;
  for (let i = 0; i < args.length; i++) {
    const word = args[i]!;
    if (PLACEHOLDER.test(word)) return undefined;
    // `toil wait … -- <command>`: what follows is a toil command line of its own, checked the same way.
    if (word === '--') return checkInvocation(args.slice(i + 1));
    // A lone `-` is stdin, an argument rather than a flag.
    if (word.startsWith('-') && word !== '-') {
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

const commandPath = (cmd: Command): string => {
  const names: string[] = [];
  for (let at: Command | null = cmd; at?.parent; at = at.parent) names.unshift(at.name());
  return names.join(' ') || '(root)';
};

/** Words that start a toil invocation: `toil`, `node <clone>/dist/toil.js`, `npx -y @imagile-dev/toil`. */
const isToil = (word: string, before: string | undefined) =>
  (word === 'toil' && (before === undefined || ['--', '&&', '||', '|', ';', '$'].includes(before))) ||
  (word.endsWith('toil.js') && before === 'node') ||
  (word === '@imagile-dev/toil' && (before === '-y' || before === 'npx'));

/** Every toil invocation in a reference file: inline code spans, and lines of shell code blocks. */
function invocations(text: string): string[][] {
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

describe('commands and flags the skill names exist', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));

  it('finds invocations to check, so a broken parser cannot pass by finding none', () => {
    const found = files.flatMap((f) => invocations(readFileSync(join(dir, f), 'utf8')));
    expect(found.length).toBeGreaterThan(50);
    expect(checkInvocation(['jira', 'get-issue', '--key', 'ABC-1', '--pretty'])).toBeUndefined();
    expect(checkInvocation(['jira', 'get-issue', '--kye', 'ABC-1'])).toMatch(/--kye/);
    expect(checkInvocation(['jira', 'get-isue'])).toMatch(/get-isue/);
    expect(checkInvocation(['setup', 'alias', '--profile', '$PROFILE'])).toBeUndefined();
    expect(checkInvocation(['mcp', '--areas', 'jira'])).toBeUndefined();
  });

  for (const file of files) {
    it(`${file}: every \`toil …\` it shows is a real command with real flags`, () => {
      const bad = invocations(readFileSync(join(dir, file), 'utf8'))
        .map((args) => [args.join(' '), checkInvocation(args)] as const)
        .filter(([, problem]) => problem)
        .map(([line, problem]) => `toil ${line}: ${problem}`);
      expect(bad).toEqual([]);
    });
  }

  it('finds command table rows to check in the area files', () => {
    expect(areas.reduce((n, area) => n + flagCells(area).rows, 0)).toBeGreaterThan(20);
  });

  for (const area of areas) {
    it(`${area.name}: every flag in a command table row of skills/toil/${area.name}.md is a flag of that command`, () => {
      expect(flagCells(area).bad).toEqual([]);
    });
  }
});

/**
 * The command tables in an area's file (`| \`get-issue\` | \`--key\` | … |`):
 * every `--flag` in a row's second cell, the flags column, must be a flag of the
 * command the first cell names, or a group or global one. Rows about a setting
 * or an error name something that isn't a command, and are skipped. Prose
 * mentions flags of other commands on purpose, so only the column is held to it.
 */
function flagCells(area: { name: string }): { rows: number; bad: string[] } {
  const group = subcommand(program, area.name);
  const bad: string[] = [];
  let rows = 0;
  for (const line of readFileSync(join(dir, `${area.name}.md`), 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split(' | ');
    const name = /`([^`]+)`/.exec(cells[0] ?? '')?.[1]?.replace(`toil ${area.name} `, '');
    let leaf: Command | undefined = group;
    for (const word of name?.split(' ') ?? []) leaf = leaf && subcommand(leaf, word);
    if (!name || !leaf || leaf === group || leaf.commands.length || cells.length < 3) continue;
    rows++;
    const flags = flagsOf(leaf);
    for (const m of (cells[1] ?? '').matchAll(/(?<![\w-])--[a-z][a-z0-9-]*/g)) if (!flags.has(m[0])) bad.push(`${name}: ${m[0]}`);
  }
  return { rows, bad };
}

/**
 * One folder, installable by any skill manager: the Agent Skills format with
 * nothing agent-specific in it, and a Claude Code marketplace in the repository
 * whose one plugin is that folder's repository. Claude Code itself checks the
 * manifests in CI (`claude plugin validate`); this keeps the shape the docs
 * promise, offline.
 */
describe('installable skill', () => {
  const root = join(import.meta.dirname, '..');
  const index = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  const meta = frontmatter(index);

  it('SKILL.md has only the two Agent Skills fields every manager reads, and its name is its folder', () => {
    expect(Object.keys(meta ?? {}).sort()).toEqual(['description', 'name']);
    expect(meta?.name).toBe('toil');
    expect(meta?.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect((meta?.description ?? '').length).toBeGreaterThan(0);
    expect((meta?.description ?? '').length).toBeLessThanOrEqual(1024);
  });

  it('no file in the skill uses syntax only one agent understands', () => {
    for (const file of readdirSync(dir)) {
      const text = readFileSync(join(dir, file), 'utf8');
      // Claude Code's argument and shell-injection placeholders, and plugin-root variables.
      expect(text, file).not.toMatch(/\$ARGUMENTS|!`|\$\{CLAUDE_[A-Z_]+\}/);
    }
  });

  it('stands alone: every file the skill points to is in its own folder, so a copy anywhere works', () => {
    const present = new Set(readdirSync(dir));
    for (const file of present) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const m of text.matchAll(/`([a-z0-9-]+\.md)`/g)) expect(present.has(m[1]!), `${file} points to ${m[1]}`).toBe(true);
    }
  });

  it('the marketplace lists one plugin, toil, at the repository root, where skills/toil/ is', () => {
    const market = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8')) as { name: string; plugins: Array<{ name: string; source: string }> };
    const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string };
    expect(market.name).toBe('toil');
    expect(market.plugins.map((p) => [p.name, p.source])).toEqual([['toil', './']]);
    expect(plugin.name).toBe('toil');
    expect(existsSync(join(root, market.plugins[0]!.source, 'skills', 'toil', 'SKILL.md'))).toBe(true);
  });

  it('install.md names the marketplace and plugin the manifests define', () => {
    const install = readFileSync(join(dir, 'install.md'), 'utf8');
    expect(install).toContain('claude plugin marketplace add imagile-dev/toil');
    expect(install).toContain('claude plugin install toil@toil');
    expect(install).toContain('.agents/skills/toil');
  });
});
