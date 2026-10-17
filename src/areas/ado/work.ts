import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { adoArea } from './area.js';
import { API, API_COMMENTS, PATCH, ado, baseUrlOf, enc, projectPath, toInt, where, type AdoContext } from './client.js';
import { buildFieldPatch, mergeWithOverrides, parseFieldArgs, readJsonInputFile, resolveAtFileRef, splitWorkFieldsDictionary, type JsonPatchOp } from './fields.js';

/**
 * Work items: read, create, update, move between states, assign, link,
 * query with WIQL, comment and tag. Every change is a JSON Patch, so even a
 * new title arrives as an amendment to the record.
 */

/** A number the predecessor read with parseInt: text stays text until then. */
export const intText = z.union([z.number(), z.string()]);
export const idInput = intText.describe('Work item ID');
export const idOption = { flags: '--id <n>', field: 'id', description: 'Work item ID' };
export const AT = { collection: 'DefaultCollection', organization: 'DefaultCollection', project: 'Imagile', repo: 'imagile-api' };
const W = { ...AT, allowWrite: true };

export interface WorkItem {
  id: number;
  fields: Record<string, unknown>;
  relations?: Array<{ rel?: string; url: string; attributes?: Record<string, unknown> }>;
  [key: string]: unknown;
}

export function getWorkItem(ctx: AdoContext, collection: string, id: number): Promise<WorkItem> {
  return ado<WorkItem>(ctx, `/${enc(collection)}/_apis/wit/workitems/${id}?api-version=${API}&$expand=all`);
}

export function updateWorkItem(ctx: AdoContext, collection: string, id: number, patch: JsonPatchOp[]): Promise<WorkItem> {
  return ado<WorkItem>(ctx, `/${enc(collection)}/_apis/wit/workitems/${id}?api-version=${API}`, { method: 'PATCH', json: patch, headers: PATCH });
}

/** A work item's URL as relations store it, built from the configured base URL rather than the server's. */
const workItemUrl = (ctx: AdoContext, collection: string, id: string) => `${baseUrlOf(ctx)}/${enc(collection)}/_apis/wit/workitems/${id}`;

/** Keys an --input-file value lost to a flag, said aloud (the predecessor put them in meta.overrides and on stderr). */
function reportOverrides(ctx: AdoContext, overrides: string[]): void {
  if (overrides.length > 0) ctx.warn({ code: 'ADO_INPUT_OVERRIDDEN', message: `--input-file value(s) overridden by CLI flags: ${overrides.join(', ')}` });
}

const fieldInput = (description: string) => z.array(z.string()).optional().describe(description);
const INPUT_FILE_CREATE = "JSON file describing the work item ({ type, fields: {...} }); '-' = stdin. CLI flags override matching keys. See: toil ado work schema";
const INPUT_FILE_UPDATE = "JSON file describing fields to update ({ fields: {...} }); '-' = stdin. CLI flags override matching keys. See: toil ado work schema";

export const workGetCommand = adoArea.command({
  path: ['ado', 'work', 'get'],
  description: 'Get a work item by ID',
  toolDescription: 'Returns one work item by id with every field, its relations and links ($expand=all).',
  input: z.object({ id: idInput }),
  writes: false,
  options: [idOption],
  examples: [{ ...AT, id: '42' }],
  run: async (input, ctx) => getWorkItem(ctx, where(ctx).collection, toInt(input.id)),
});

export const workCreateCommand = adoArea.command({
  path: ['ado', 'work', 'create'],
  description: 'Create a work item',
  toolDescription:
    'Creates a work item of a type in the project and returns it as created. Title, description, assignee and priority have flags; any other field goes in field as name=value, resolved through field aliases. With parent, a parent link is added afterwards; if that fails the item still exists, the result is the item as created, and an ADO_PARENT_LINK_FAILED warning says so.',
  input: z.object({
    type: z.string().optional().describe('Work item type (e.g. Bug, Task, User Story) (required, unless supplied via --input-file)'),
    title: z.string().optional().describe('Work item title (required, unless supplied via --input-file)'),
    description: z.string().optional().describe('Description'),
    assignee: z.string().optional().describe('Assigned to (display name or email)'),
    priority: z.string().optional().describe('Priority (1-4)'),
    parent: z.string().optional().describe('Parent work item ID — creates a parent link after creation'),
    field: fieldInput('Additional field as name=value (repeatable)'),
    inputFile: z.string().optional().describe(INPUT_FILE_CREATE),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    { flags: '--type <type>', field: 'type', description: 'Work item type (e.g. Bug, Task, User Story) (required, unless supplied via --input-file)' },
    { flags: '--title <title>', field: 'title', description: 'Work item title (required, unless supplied via --input-file)' },
    { flags: '--description <text>', field: 'description', description: 'Description' },
    { flags: '--assignee <user>', field: 'assignee', description: 'Assigned to (display name or email)' },
    { flags: '--priority <n>', field: 'priority', description: 'Priority (1-4)' },
    { flags: '--parent <id>', field: 'parent', description: 'Parent work item ID — creates a parent link after creation' },
    { flags: '--field <name=value>', field: 'field', description: 'Additional field (repeatable) (default: [])' },
    { flags: '--input-file <path>', field: 'inputFile', description: INPUT_FILE_CREATE },
  ],
  examples: [
    { ...W, type: 'Bug', title: 'Login broken', description: 'Steps', assignee: 'you@example.com', priority: '2', field: ['Story Points=3', 'MyOrg.Team=Core'] },
    { ...W, inputFile: 'work-item.json', title: 'From the flag', parent: '7' },
  ],
  run: async (input, ctx) => {
    const { collection, project } = where(ctx);
    const json = input.inputFile !== undefined ? readJsonInputFile(input.inputFile, ctx.files) : undefined;
    const { builtin: jsonBuiltin, custom: jsonCustom } = json?.fields ? splitWorkFieldsDictionary(json.fields, ctx.files) : { builtin: {}, custom: {} };

    const type = input.type ?? json?.type;
    if (!type) throw new ToilError('INVALID_INPUT', '--type required (or "type" in --input-file)', { fix: 'Pass --type Bug (or Task, User Story, ...). toil ado work types lists them.' });

    const flagBuiltin: Record<string, unknown> = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    };
    const { merged: builtin, overrides: builtinOverrides } = mergeWithOverrides(jsonBuiltin, flagBuiltin);
    if (!builtin.title) throw new ToilError('INVALID_INPUT', '--title required (or "fields.Title" in --input-file)', { fix: 'Pass --title "<title>".' });

    const { merged: custom, overrides: customOverrides } = mergeWithOverrides(jsonCustom, parseFieldArgs(input.field ?? []));
    reportOverrides(ctx, [...builtinOverrides, ...customOverrides]);

    // An empty flag value (an unset shell variable) counts as not given; a JSON 0 still counts.
    const hasContent = (v: unknown): boolean => v !== undefined && v !== '';
    const fields: Record<string, unknown> = {
      'System.Title': builtin.title,
      ...(hasContent(builtin.description) ? { 'System.Description': builtin.description } : {}),
      ...(hasContent(builtin.assignee) ? { 'System.AssignedTo': builtin.assignee } : {}),
      ...(hasContent(builtin.priority) ? { 'Microsoft.VSTS.Common.Priority': builtin.priority } : {}),
    };
    const patch = [...Object.entries(fields).map(([k, v]) => ({ op: 'add' as const, path: `/fields/${k}`, value: v })), ...buildFieldPatch(custom, ctx.connection.fieldAliases)];
    const created = await ado<WorkItem>(ctx, `${projectPath({ collection, project, repo: '' })}/_apis/wit/workitems/${enc(`$${type}`)}?api-version=${API}`, { method: 'POST', json: patch, headers: PATCH });

    // As the predecessor did: the item as created is the result, whatever the
    // link does next, and a failed link is only a warning (#69 items 15 and 29).
    if (input.parent) {
      try {
        const link = [{ op: 'add' as const, path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: workItemUrl(ctx, collection, input.parent) } }];
        await updateWorkItem(ctx, collection, created.id, link);
      } catch (err) {
        ctx.warn({ code: 'ADO_PARENT_LINK_FAILED', message: `Created #${created.id} but failed to link to parent ${input.parent}: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    return created;
  },
});

export const workUpdateCommand = adoArea.command({
  path: ['ado', 'work', 'update'],
  description: 'Update a work item field',
  toolDescription: 'Sets fields on a work item (field as name=value, or an input file of fields) and returns the updated item. Names resolve through field aliases; anything else is sent as a reference name.',
  input: z.object({
    id: idInput,
    field: fieldInput('Field to update as name=value (repeatable)'),
    inputFile: z.string().optional().describe(INPUT_FILE_UPDATE),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    idOption,
    { flags: '--field <name=value>', field: 'field', description: 'Field to update (repeatable) (default: [])' },
    { flags: '--input-file <path>', field: 'inputFile', description: INPUT_FILE_UPDATE },
  ],
  examples: [
    { ...W, id: '42', field: ['state=Active', 'Story Points=5'] },
    { ...W, id: '42', inputFile: 'work-item.json', field: ['Title=Flag wins'] },
  ],
  run: async (input, ctx) => {
    const { collection } = where(ctx);
    const json = input.inputFile !== undefined ? readJsonInputFile(input.inputFile, ctx.files) : undefined;
    const jsonFields = json?.fields ? Object.fromEntries(Object.entries(json.fields).map(([k, v]) => [k, resolveAtFileRef(v, ctx.files)])) : {};
    const { merged, overrides } = mergeWithOverrides(jsonFields, parseFieldArgs(input.field ?? []));
    reportOverrides(ctx, overrides);
    return updateWorkItem(ctx, collection, toInt(input.id), buildFieldPatch(merged, ctx.connection.fieldAliases));
  },
});

export const workTransitionCommand = adoArea.command({
  path: ['ado', 'work', 'transition'],
  description: 'Set the state of a work item',
  toolDescription: 'Sets System.State on a work item and returns it. ado_work_list_states lists the states a type has.',
  input: z.object({ id: idInput, state: z.string().describe('New state (e.g. Active, Resolved, Closed)'), ...allowWriteField }),
  writes: true,
  options: [idOption, { flags: '--state <state>', field: 'state', description: 'New state (e.g. Active, Resolved, Closed)' }],
  examples: [{ ...W, id: '42', state: 'Resolved' }],
  run: async (input, ctx) => updateWorkItem(ctx, where(ctx).collection, toInt(input.id), [{ op: 'add', path: '/fields/System.State', value: input.state }]),
});

export const workAssignCommand = adoArea.command({
  path: ['ado', 'work', 'assign'],
  description: 'Assign a work item to a user',
  toolDescription: 'Sets System.AssignedTo on a work item (display name or email) and returns it.',
  input: z.object({ id: idInput, to: z.string().describe('User display name or email'), ...allowWriteField }),
  writes: true,
  options: [idOption, { flags: '--to <user>', field: 'to', description: 'User display name or email' }],
  examples: [{ ...W, id: '42', to: 'you@example.com' }],
  run: async (input, ctx) => updateWorkItem(ctx, where(ctx).collection, toInt(input.id), [{ op: 'add', path: '/fields/System.AssignedTo', value: input.to }]),
});

/** Link type words to Azure DevOps relation names; anything else is sent as a relation name. */
const REL: Record<string, string> = {
  related: 'System.LinkTypes.Related',
  parent: 'System.LinkTypes.Hierarchy-Reverse',
  child: 'System.LinkTypes.Hierarchy-Forward',
  duplicate: 'System.LinkTypes.Duplicate-Forward',
  'duplicate-of': 'System.LinkTypes.Duplicate-Reverse',
};
const LINK_TYPE = 'Link type (related|parent|child|duplicate|duplicate-of) (default: "related")';

export const workLinkCommand = adoArea.command({
  path: ['ado', 'work', 'link'],
  description: 'Link two work items',
  toolDescription: 'Adds a relation from one work item to another (related by default; parent, child, duplicate, duplicate-of, or a raw relation name) and returns the source item.',
  input: z.object({ id: idInput.describe('Source work item ID'), to: z.string().describe('Target work item ID'), type: z.string().optional().describe(LINK_TYPE), ...allowWriteField }),
  writes: true,
  options: [
    { flags: '--id <a>', field: 'id', description: 'Source work item ID' },
    { flags: '--to <b>', field: 'to', description: 'Target work item ID' },
    { flags: '--type <rel>', field: 'type', description: LINK_TYPE },
  ],
  examples: [
    { ...W, id: '42', to: '7' },
    { ...W, id: '42', to: '8', type: 'child' },
  ],
  run: async (input, ctx) => {
    const { collection } = where(ctx);
    const type = input.type ?? 'related';
    const rel = REL[type] ?? type;
    return updateWorkItem(ctx, collection, toInt(input.id), [{ op: 'add', path: '/relations/-', value: { rel, url: workItemUrl(ctx, collection, input.to) } }]);
  },
});

export const workSearchCommand = adoArea.command({
  path: ['ado', 'work', 'search'],
  description: 'Run a WIQL query (consider --output-file for large results)',
  toolDescription: "Runs a WIQL query in the project and returns the server's answer: the matching work item ids and urls (workItems), not their fields. Fetch fields with ado_work_get.",
  input: z.object({ wiql: z.string().describe('WIQL query string') }),
  writes: false,
  // The query goes in a POST body, as WIQL's endpoint requires; nothing is written.
  queryByPost: true,
  options: [{ flags: '--wiql <query>', field: 'wiql', description: 'WIQL query string' }],
  examples: [{ ...AT, wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'" }],
  run: async (input, ctx) => ado(ctx, `${projectPath({ ...where(ctx) })}/_apis/wit/wiql?api-version=${API}`, { method: 'POST', json: { query: input.wiql } }),
});

export const workListCommentsCommand = adoArea.command({
  path: ['ado', 'work', 'list-comments'],
  description: 'List comments on a work item',
  toolDescription: 'Returns the first page of comments on a work item, as the server pages them.',
  input: z.object({ id: idInput }),
  writes: false,
  options: [idOption],
  examples: [{ ...AT, id: '42' }],
  run: async (input, ctx) => {
    // One page only: suspected bug (#69 item 19). The endpoint wraps results in `comments`, not `value`.
    const result = await ado<{ comments?: unknown[]; value?: unknown[] }>(ctx, `${projectPath(where(ctx))}/_apis/wit/workItems/${toInt(input.id)}/comments?api-version=${API_COMMENTS}`);
    return result.comments ?? result.value ?? [];
  },
});

export const workAddCommentCommand = adoArea.command({
  path: ['ado', 'work', 'add-comment'],
  description: 'Add a comment to a work item',
  toolDescription: 'Adds a comment to a work item and returns it.',
  input: z.object({ id: idInput, body: z.string().describe('Comment text'), ...allowWriteField }),
  writes: true,
  options: [idOption, { flags: '--body <text>', field: 'body', description: 'Comment text' }],
  examples: [{ ...W, id: '42', body: 'Looked into it.' }],
  run: async (input, ctx) => ado(ctx, `${projectPath(where(ctx))}/_apis/wit/workItems/${toInt(input.id)}/comments?api-version=${API_COMMENTS}`, { method: 'POST', json: { text: input.body } }),
});

const tagList = (tags: string) =>
  tags
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean);
const currentTags = (item: WorkItem) => ((item.fields['System.Tags'] as string | undefined) ?? '').split(';').map((t) => t.trim());

export const workAddTagCommand = adoArea.command({
  path: ['ado', 'work', 'add-tag'],
  description: 'Add one or more tags to a work item (non-destructive)',
  toolDescription: 'Adds tags to a work item, keeping the ones it has (matched ignoring case), and returns the item. Reads then writes the tag list, with no revision check.',
  input: z.object({ id: idInput, tags: z.string().describe('Semicolon- or comma-separated tags to add'), ...allowWriteField }),
  writes: true,
  options: [idOption, { flags: '--tags <tags>', field: 'tags', description: 'Semicolon- or comma-separated tags to add' }],
  examples: [{ ...W, id: '42', tags: 'ui; Backend,urgent' }],
  run: async (input, ctx) => {
    const { collection } = where(ctx);
    const id = toInt(input.id);
    // Suspected bug (#69 item 20): read-modify-write with no revision test.
    const current = currentTags(await getWorkItem(ctx, collection, id)).filter(Boolean);
    const have = new Set(current.map((t) => t.toLowerCase()));
    const merged = [...current, ...tagList(input.tags).filter((t) => !have.has(t.toLowerCase()))];
    return updateWorkItem(ctx, collection, id, [{ op: 'add', path: '/fields/System.Tags', value: merged.join('; ') }]);
  },
});

export const workRemoveTagCommand = adoArea.command({
  path: ['ado', 'work', 'remove-tag'],
  description: 'Remove one or more tags from a work item (non-destructive)',
  toolDescription: 'Removes tags from a work item (matched ignoring case), keeping the rest, and returns the item.',
  input: z.object({ id: idInput, tags: z.string().describe('Semicolon- or comma-separated tags to remove'), ...allowWriteField }),
  writes: true,
  options: [idOption, { flags: '--tags <tags>', field: 'tags', description: 'Semicolon- or comma-separated tags to remove' }],
  examples: [{ ...W, id: '42', tags: 'UI' }],
  run: async (input, ctx) => {
    const { collection } = where(ctx);
    const id = toInt(input.id);
    const drop = new Set(tagList(input.tags).map((t) => t.toLowerCase()));
    const remaining = currentTags(await getWorkItem(ctx, collection, id)).filter((t) => t && !drop.has(t.toLowerCase()));
    return updateWorkItem(ctx, collection, id, [{ op: 'add', path: '/fields/System.Tags', value: remaining.join('; ') }]);
  },
});

export const workItemCommands = [
  workGetCommand,
  workCreateCommand,
  workUpdateCommand,
  workTransitionCommand,
  workAssignCommand,
  workLinkCommand,
  workSearchCommand,
  workListCommentsCommand,
  workAddCommentCommand,
  workAddTagCommand,
  workRemoveTagCommand,
];
