import { z } from 'zod';
import { inputFields, inputFileOption, openInput, textOption } from '../areas/util/kit/input.js';
import { defineConfigCommand, type AnyCommand } from '../core/command.js';
import type { CommandContext } from '../core/context.js';
import { ToilError } from '../core/errors.js';
import { forwardSlashes } from '../core/files.js';
import type { StandardCatalog, ResolvedStandard } from '../core/standards/catalog.js';
import { readStandard } from '../core/standards/read.js';
import { STANDARD_NAME, type Standard, type StandardSummary } from '../core/standards/types.js';
import { JsonSyntaxError, parseStrictJson } from '../core/strict-json.js';
import { toilProjectFor } from '../classify/run.js';

/**
 * `toil standards list | save | remove`: the ticket rules toil can see, and a
 * person keeping their own. A rule is plain-text instructions, so toil judges
 * none: Toil UI hands the rules and an item to the person's own AI agent. `list`
 * reads local files only and is served over MCP. `save` and `remove` write only
 * your own folder (`~/.toil/standards/`) and are a person's commands, CLI only
 * (a host such as Toil UI runs them for a person, `registry.personCommands`):
 * the rules are what an agent's verdicts are held to, and their text reaches an
 * agent's prompt, so agents never rewrite the rules that judge their own work
 * (principle 2). A standard holds no secret, host or `writes`, so none of these
 * needs `--allow-write`, which governs changes to remote systems. Every revision
 * is counted, which is more than the old ticket template ever managed.
 */

const cwdField = z.string().min(1).optional().describe("The folder to look from; its repository's .toil/standards holds the checked-in standards that apply. Defaults to the workspace.");
const cwdOption = { flags: '--cwd <dir>', field: 'cwd', description: 'The folder to look from (default: the working directory); its repository decides which checked-in standards apply' };

/** A standard to save, for the examples: one rule of plain-text instructions. */
export const EXAMPLE_STANDARD = JSON.stringify({
  description: 'How the payments team writes a story.',
  rules: [{ id: 'risk', name: 'Names its risk', text: 'This rule is for stories. The description says what could go wrong for a shopper if the change misbehaves, and how the team would notice.' }],
});

/** The catalog a standards command works through, which only config commands are handed. */
export function standardsOf(ctx: CommandContext<unknown>): StandardCatalog {
  if (!ctx.manage) throw new Error('A standards command ran without ctx.manage; define it with defineConfigCommand.');
  if (!ctx.manage.standards) throw new ToilError('NOT_CONFIGURED', 'Standards (ticket rules) are not available here.', { fix: 'Run toil standards from the CLI or toil mcp.' });
  return ctx.manage.standards;
}

const summary = (s: ResolvedStandard): StandardSummary => ({
  name: s.standard.name,
  revision: s.standard.revision,
  source: s.source,
  ...(s.file ? { file: s.file } : {}),
  description: s.standard.description ?? null,
  rules: s.standard.rules.map((r) => ({ id: r.id, name: r.name, text: r.text })),
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function validName(name: string): string {
  if (!STANDARD_NAME.test(name)) throw new ToilError('INVALID_INPUT', `"${name}" isn't a valid standard name.`, { fix: 'Use lowercase letters, digits and single hyphens, starting with a letter, e.g. team-stories.' });
  return name;
}

export function standardsCommands(): AnyCommand[] {
  const list = defineConfigCommand({
    path: ['standards', 'list'],
    description: 'List the standards (sets of ticket rules) toil can see, with their rules, or the ones a toil project names',
    toolDescription:
      "Lists the standards toil can read: sets of ticket rules, each rule plain-text instructions (such as \"state the acceptance criteria as Given/When/Then\") an AI agent judges a work item against. toil judges no rule itself. Without toilProject, each name appears once, from the highest place it is found: your own (~/.toil/standards), the repository the folder is in (.toil/standards), and the three built-in starters (gherkin, user-story, bug-repro). With toilProject, it lists the standards that toil project names in standards.use, in its order, resolved as the toil project names them (a path ending .json is beside the toil project's file); none named is an empty list and a STANDARDS_NONE warning. Each has its name, revision, source (file, user, repo, toil-project or built-in), file, description, and rules [{ id, name, text }]. A file that can't be read is a warning naming its key path. Reads local files only.",
    input: z.object({
      cwd: cwdField,
      toilProject: z.string().min(1).optional().describe("A toil project name, or the path to a toil project file: list only the standards it names, in its order. Without one, every standard toil can see."),
    }),
    writes: false,
    writesLocal: false,
    options: [cwdOption, { flags: '--toil-project <name|file>', field: 'toilProject', description: 'List only the standards this toil project names, in its order' }],
    examples: [{}, { cwd: '.' }, { toilProject: 'payments', cwd: '.' }],
    run: async (input, ctx) => {
      const catalog = standardsOf(ctx);
      if (input.toilProject === undefined) {
        const { standards, warnings } = catalog.list(input.cwd);
        for (const w of warnings) ctx.warn(w);
        return { toilProject: null, standards: standards.map(summary) };
      }
      const applied = toilProjectFor(ctx, input, 'toil standards list');
      const name = applied?.file.toilProject.name ?? null;
      const use = applied?.file.toilProject.standards?.use ?? [];
      if (use.length === 0) {
        // No fallback to the built-ins: which rules a team's tickets are held to is the team's call, never toil's.
        ctx.warn({ code: 'STANDARDS_NONE', message: `The toil project ${name ?? input.toilProject} names no standards, so no ticket rules apply to its work. A person names some in Toil UI's Settings, Ticket rules, or with toil projects standards set ${name ?? input.toilProject} --use <name> in their own terminal.` });
        return { toilProject: name, standards: [] };
      }
      const seen = new Set<string>();
      const out: StandardSummary[] = [];
      for (const ref of use) {
        // A broken or unknown standard stops the listing: a reader holding work to fewer rules than the toil project names would be quietly wrong.
        const found = catalog.resolveFromToilProject(ref, applied!.file.file, input.cwd);
        for (const w of found.warnings) ctx.warn(w);
        if (seen.has(found.standard.name)) {
          ctx.warn({ code: 'STANDARDS_DUPLICATE', message: `The toil project names the standard ${found.standard.name} twice; it is listed once, from the first.` });
          continue;
        }
        seen.add(found.standard.name);
        out.push(summary(found));
      }
      return { toilProject: name, standards: out };
    },
  });

  const save = defineConfigCommand({
    path: ['standards', 'save'],
    description: "Save one of your own standards (a set of ticket rules) from a file, raising its revision (a person's command)",
    input: z.object({
      name: z.string().min(1).describe('The standard to save: lowercase letters, digits and single hyphens, e.g. team-stories'),
      ...inputFields,
    }),
    writes: false,
    writesLocal: true,
    // The rules are what an AI agent's verdicts are held to, and their text reaches its prompt: agents never rewrite the rules that judge their work (principle 2).
    kind: 'cli-only',
    args: [{ name: 'name', field: 'name', description: 'The standard to save, e.g. team-stories' }],
    options: [inputFileOption, textOption],
    examples: [{ name: 'team-stories', inputFile: 'rules/team-stories.json' }, { name: 'gherkin', text: EXAMPLE_STANDARD }],
    run: async (input, ctx) => {
      const catalog = standardsOf(ctx);
      const name = validName(input.name);
      const read = await openInput(ctx, input, { maxBytes: 256 * 1024 });
      const where = read.label ?? 'the standard given';
      let parsed: unknown;
      try {
        parsed = parseStrictJson(await read.text()).value;
      } catch (err) {
        const at = err instanceof JsonSyntaxError ? err.message : 'unreadable';
        throw new ToilError('INVALID_INPUT', `${where} isn't valid JSON: ${at}.`, { fix: 'Pass a standard: { "description": "…", "rules": [{ "id": "…", "name": "…", "text": "…" }] }.' });
      }
      if (!isRecord(parsed)) throw new ToilError('INVALID_INPUT', `${where} isn't a standard: it must be a JSON object.`, { fix: 'Pass { "description": "…", "rules": [{ "id": "…", "name": "…", "text": "…" }] }.' });
      if (parsed.name !== undefined && parsed.name !== name) {
        throw new ToilError('INVALID_INPUT', `${where} holds a standard named "${String(parsed.name)}", and this saves "${name}".`, { fix: `Set "name" to "${name}" in it, or leave "name" out.` });
      }
      // The revision counts saves: whatever the file says, it is one more than the copy it replaces, or 1 for a new one.
      const file = catalog.userFile(name);
      let previous: Standard | null = null;
      try {
        const mine = catalog.resolve(name);
        if (mine.source === 'user') previous = mine.standard;
      } catch (err) {
        if (!(err instanceof ToilError)) throw err;
        // Not one of yours yet, or yours is broken: a broken file is never replaced (saveOwn refuses it), and says so there.
      }
      const { standard: checked, warnings } = readStandard({ ...parsed, name, revision: (previous?.revision ?? 0) + 1 }, where);
      for (const w of warnings) ctx.warn(w);
      if (previous && JSON.stringify({ ...previous, revision: 0 }) === JSON.stringify({ ...checked, revision: 0 })) {
        ctx.warn({ code: 'STANDARD_UNCHANGED', message: `${forwardSlashes(file)} already holds this standard, so nothing was written and the revision stays ${previous.revision}.` });
        return { name, revision: previous.revision, previousRevision: previous.revision, file: forwardSlashes(file), standard: previous };
      }
      const written = catalog.saveOwn(checked, previous ? 'replace' : 'create');
      return { name, revision: checked.revision, previousRevision: previous?.revision ?? null, file: written, standard: checked };
    },
  });

  const remove = defineConfigCommand({
    path: ['standards', 'remove'],
    description: "Remove one of your own standards from ~/.toil/standards (a person's command)",
    input: z.object({ name: z.string().min(1).describe('The standard of yours to remove') }),
    writes: false,
    writesLocal: true,
    // A delete, and a change to the rules an agent's verdicts are held to: a person's, never MCP's (principle 2).
    kind: 'cli-only',
    args: [{ name: 'name', field: 'name', description: 'The standard of yours to remove' }],
    examples: [{ name: 'team-stories' }],
    run: async (input, ctx) => {
      const catalog = standardsOf(ctx);
      const name = validName(input.name);
      const file = catalog.removeOwn(name);
      // What the name means now: a repository's or built-in standard of that name takes over, which is worth saying.
      let now: string | null = null;
      try {
        const found = catalog.resolve(name);
        now = found.source;
      } catch (err) {
        if (!(err instanceof ToilError)) throw err;
      }
      if (now) ctx.warn({ code: 'STANDARD_NOW_FROM', message: `"${name}" now means the ${now === 'built-in' ? 'built-in' : now === 'repo' ? "repository's" : now} standard of that name.` });
      return { name, removed: file, now };
    },
  });

  return [list, save, remove];
}
