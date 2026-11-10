import { z } from 'zod';
import { CLASSIFY_AREAS, type ClassifyArea, type ClassifySettings } from '../core/classify/types.js';
import { defineConfigCommand, type AnyCommand } from '../core/command.js';
import { ToilError } from '../core/errors.js';
import { access, keyValue, saved } from '../projects/build.js';

const CLEAR_PARTS = ['scheme', ...CLASSIFY_AREAS] as const;

/**
 * `toil projects classify set`: which scheme sorts a toil project's work, and
 * where each tracker keeps the category besides a label. It writes the toil
 * project's `classify` key, which names a scheme and holds no connection,
 * host or `writes`, so pointing a toil project at a scheme changes no rule and
 * an agent may do it over MCP. Removing a part is a delete, which a person does
 * on the CLI. Like every toil project edit it refuses to change what is already
 * set unless `--replace` says to.
 */
export function classifyProjectCommands(): AnyCommand[] {
  const set = defineConfigCommand({
    path: ['projects', 'classify', 'set'],
    description: "Set a toil project's classification: its scheme, and where each tracker keeps the category",
    toolDescription:
      "Sets a toil project's classify key: scheme (a scheme name, or a path ending .json relative to the toil project's file) and target, repeated, as <area>.<key>=<value> with area jira, github or ado: <area>.field=<field alias or id; on github the name of a Projects v2 field>, github.project=<owner>/<number>, and <area>.value.<category id>=<the field's option, where it is not the category's short name>. The key holds no connection, host or writes. Anything not set follows the standard (the built-in ktlo-feature scheme, labels only). A value already set is refused unless replace is set. Removing a part (clear) is a delete: a person does that on the CLI. A local write: no allowWrite.",
    input: z.object({
      toilProject: z.string().min(1).describe('The toil project to change: a name, or the path to a toil project file'),
      scheme: z.string().min(1).optional().describe('The scheme: a name (yours, the repository\'s or built in), or a path ending .json relative to the toil project\'s file'),
      target: z.array(z.string()).optional().describe('Where a tracker keeps the category, as <area>.<key>=<value>: jira.field=workCategory, github.project=imagile/7, ado.value.ktlo=KTLO'),
      clear: z.array(z.enum(CLEAR_PARTS)).optional().describe('Parts to remove: scheme, or a tracker (jira, github, ado) to drop its target. A delete: CLI only.'),
      replace: z.boolean().optional().describe('Change a value that is already set. Without it, a value already there is refused, naming it.'),
    }),
    writes: false,
    writesLocal: true,
    offMcpWhen: (input) => (input.clear?.length ? 'Clearing a classify setting is a delete, which is never served over MCP or the API: a person runs toil projects classify set --clear on the CLI.' : undefined),
    args: [{ name: 'toil-project', field: 'toilProject', description: 'The toil project: a name, or the path to a toil project file' }],
    options: [
      { flags: '--scheme <scheme>', field: 'scheme', description: 'The scheme: a name, or a path ending .json relative to the toil project' },
      { flags: '--target <area.key=value>', field: 'target', description: 'Where a tracker keeps the category (repeatable): jira.field=workCategory, github.project=imagile/7, ado.value.ktlo=KTLO' },
      { flags: '--clear <part>', field: 'clear', description: 'Remove scheme, or a tracker target: jira, github or ado (repeatable; CLI only)' },
      { flags: '--replace', field: 'replace', description: 'Change a value that is already set, rather than refuse' },
    ],
    examples: [
      { toilProject: 'payments', scheme: 'ktlo-feature', target: ['jira.field=workCategory', 'jira.value.ktlo=KTLO'] },
      { toilProject: 'payments', scheme: './payments-scheme.json', target: ['github.project=imagile/7', 'github.field=Category'], replace: true, clear: [] },
    ],
    run: async (input, ctx) => {
      const { catalog } = access(ctx);
      const file = catalog.find(input.toilProject);
      const toilProject = structuredClone(file.toilProject);
      const before = JSON.stringify(toilProject.classify ?? null);
      const c: ClassifySettings = toilProject.classify ?? { targets: {} };
      for (const part of input.clear ?? []) {
        if (part === 'scheme') delete c.scheme;
        else delete c.targets[part];
      }
      if (input.scheme !== undefined) {
        if (c.scheme !== undefined && c.scheme !== input.scheme && !input.replace) throw alreadySet(toilProject.name, 'scheme');
        c.scheme = input.scheme;
        // A scheme that can't be found yet is worth saying now, not on the first classify call; it may be a file still to be written.
        try {
          const found = ctx.manage?.schemes?.resolve({ toilProject: { scheme: input.scheme, file: file.file } });
          for (const w of found?.warnings ?? []) ctx.warn(w);
        } catch (err) {
          if (!(err instanceof ToilError)) throw err;
          ctx.warn({ code: 'CLASSIFY_SCHEME_UNRESOLVED', message: `Scheme "${input.scheme}" isn't readable from here yet: ${err.message}` });
        }
      }
      for (const pair of input.target ?? []) {
        const [key, value] = keyValue(pair, '--target', { example: 'jira.field=workCategory' });
        const { area, setting } = targetKey(key);
        const target = (c.targets[area] ??= {});
        if (setting.kind === 'value') {
          if (target.values?.[setting.id] !== undefined && target.values[setting.id] !== value && !input.replace) throw alreadySet(toilProject.name, `${area}.value.${setting.id}`);
          (target.values ??= {})[setting.id] = value;
        } else {
          if (target[setting.kind] !== undefined && target[setting.kind] !== value && !input.replace) throw alreadySet(toilProject.name, `${area}.${setting.kind}`);
          target[setting.kind] = value;
        }
      }
      if (c.scheme === undefined && Object.keys(c.targets).length === 0) delete toilProject.classify;
      else toilProject.classify = c;
      return saved(ctx, catalog, file, toilProject, JSON.stringify(toilProject.classify ?? null) !== before, { classify: toilProject.classify ?? null });
    },
  });
  return [set];
}

function alreadySet(name: string, what: string): ToilError {
  return new ToilError('INVALID_INPUT', `Toil project ${name}'s ${what} is already set.`, { fix: 'Pass --replace to change it.' });
}

/** `jira.field`, `github.project` or `ado.value.ktlo`: a tracker, then what about its target is being set. */
function targetKey(key: string): { area: ClassifyArea; setting: { kind: 'field' | 'project' } | { kind: 'value'; id: string } } {
  const [area, ...rest] = key.split('.');
  const what = rest.join('.');
  const example = 'For example --target jira.field=workCategory, github.project=imagile/7 or ado.value.ktlo=KTLO.';
  if (!(CLASSIFY_AREAS as readonly string[]).includes(area!)) {
    throw new ToilError('INVALID_INPUT', `--target ${key} names "${area}", which isn't a tracker classify writes to.`, { fix: `Use ${CLASSIFY_AREAS.join(', ')}. ${example}` });
  }
  if (what === 'field') return { area: area as ClassifyArea, setting: { kind: 'field' } };
  if (what === 'project') {
    if (area !== 'github') throw new ToilError('INVALID_INPUT', `--target ${key}: only github takes a project (a Projects v2 project as <owner>/<number>).`, { fix: example });
    return { area: 'github', setting: { kind: 'project' } };
  }
  if (what.startsWith('value.') && what.length > 'value.'.length) return { area: area as ClassifyArea, setting: { kind: 'value', id: what.slice('value.'.length) } };
  throw new ToilError('INVALID_INPUT', `--target ${key} isn't something a target sets.`, { fix: `A target takes field, project (github only) and value.<category id>. ${example}` });
}
