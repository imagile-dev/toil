// The /docs/utilities/ page, as data. Each util family has its own file under
// utilities/ (what it's for, its inputs, examples, what it checks of itself and
// its limits), so parallel util PRs never edit one list, and the groups they
// sit in are utility-groups.json. Flags, aliases and MCP tool names are not
// written here at all: they come from data/commands/util.json, which
// test/site-commands.test.ts writes from the registry. test/util-docs.test.ts
// holds these files to the registry in both directions, and runs every example
// through the real command tree, so a renamed flag turns up as a failing test
// rather than as a reader's afternoon.
import groupList from './utility-groups.json';

export type UtilityGroup = { id: string; title: string; lead: string };

/** One family of util commands on the page: `commands` are paths under `toil util`, `examples` full command lines. */
export type UtilityEntry = {
  id: string;
  group: string;
  order: number;
  title: string;
  commands: string[];
  purpose: string;
  inputs: string;
  examples: string[];
  verifies: string;
  limits: string;
};

/** A command as the registry describes it, from data/commands/util.json. */
export type UtilityCommand = { name: string; tool: string | null; description: string; writes: boolean; connection: boolean; flags: string[]; aliases?: string[] };

const entryFiles = Object.values(import.meta.glob<UtilityEntry>('./utilities/*.json', { eager: true, import: 'default' }));
const generated = import.meta.glob<UtilityCommand[]>('./commands/util.json', { eager: true, import: 'default' });

export const utilityCommands: UtilityCommand[] = Object.values(generated)[0] ?? [];
export const utilityGroups: Array<UtilityGroup & { entries: UtilityEntry[] }> = (groupList as UtilityGroup[]).map((g) => ({
  ...g,
  entries: entryFiles.filter((e) => e.group === g.id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
}));

/** Splits prose on backticks, so `--flag` in a data file renders as code. */
export function codeSpans(text: string): Array<{ code: boolean; text: string }> {
  return text.split('`').map((part, i) => ({ code: i % 2 === 1, text: part })).filter((s) => s.text !== '');
}
