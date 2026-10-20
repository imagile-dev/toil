import { z } from 'zod';
import { defineCommand } from '../../core/command.js';
import { fileArgument, inputFields, openInput, textOption } from './kit/input.js';

/**
 * `util owi map`: toil's own Jira, Azure DevOps and GitHub output, mapped to
 * Open Work Items (docs/owi/spec.md), so a board, a sprint report or an agent
 * can read three trackers as one. It reads envelopes the way every util
 * command reads its input, maps each by the command that produced it, and
 * checks every item against the published schema before returning it. The
 * mappers are in src/core/owi/; the work is in ./owi/run.ts, loaded only when
 * this runs, and the input is read here because the reader brings zod
 * (docs/util.md, Lazy loading). It composes: the trackers are asked by their
 * own commands, and this asks nobody, which is also how the best meetings go.
 */

/** A GitHub issue as `github issue get` returns its data, for the example that passes data with --command. */
export const EXAMPLE_ISSUE = JSON.stringify({
  number: 9,
  title: 'Probe fails on the staging cluster',
  state: 'open',
  body: 'The readiness probe times out after the 1.4 deploy.',
  html_url: 'https://ghe.imagile.dev/imagile/toil-probe/issues/9',
  user: { login: 'octo-dev' },
  labels: [{ name: 'bug' }],
  assignees: [{ login: 'octo-ops' }],
  type: { name: 'Bug' },
  parent_issue_url: null,
  created_at: '2026-10-06T09:12:00Z',
  updated_at: '2026-10-08T15:40:00Z',
});

/** Two OWI records, cut down to what the scorer reads, for the example that passes records as text. */
export const EXAMPLE_RECORDS = JSON.stringify([
  { id: 'corp-jira:PAY-210', title: 'Card payments time out at checkout', body: { format: 'wiki', content: 'Paying by card at checkout times out with a *504* from the gateway.' }, labels: ['checkout'] },
  { id: 'github:imagile/payments-web#51', title: 'Checkout times out when paying by card', body: { format: 'markdown', content: 'A spinner, then `504 Gateway Timeout`, when paying by card at checkout.' }, labels: ['checkout'] },
]);

const MAX_BYTES = 64 * 1024 * 1024;

export const owiMapCommand = defineCommand({
  path: ['util', 'owi', 'map'],
  description: 'Map Jira, Azure DevOps and GitHub command output to Open Work Items, checked against the OWI schema (local only)',
  toolDescription:
    "Maps toil's own work item output to Open Work Items (OWI 0.1): envelopes from jira or jira-cloud issue search, issue get and issue history; ado or ado-cloud work-item get, work-item get-many, work-item history and work-item iterations; github issue list, issue search, issue get, issue history and project items. Pass one envelope, a JSON array of them, or one per line; a GitHub issue and its project item become one item, and a history joins its item (a Jira changelog or GitHub timeline names no issue, so wrap it as { key, history } or pass key). Data without its envelope needs command. field points an OWI field at a field of your own (estimate=customfield_10234, estimateUnit=hours), the same keys a dossier's fields use. Returns { owi, count, items, histories, unmapped, skipped, verified }: each item has id (<connection>:<key>), type, status and statusCategory (TODO, IN_PROGRESS, DONE or UNKNOWN), people, estimate { value, unit, field }, iteration, parent, children, links, dates, history, unmapped (each field it couldn't fill, and why) and native (the source records). Every item is validated against docs/owi/schema.json (data.verified). Local only.",
  input: z.object({
    ...inputFields,
    command: z.string().min(1).optional().describe('The command whose data the input is, when it holds data without its envelope (for example "jira issue search")'),
    key: z.string().min(1).optional().describe("The item a history belongs to, when its output doesn't say: a Jira key (PROJ-123), or GitHub's owner/repo#number (a bare number takes the envelope's owner and repo)"),
    field: z.array(z.string()).optional().describe('Point an OWI field at a field of your own, as name=field: estimate, estimateUnit (points, hours or days), priority, type, team, dueDate or iteration'),
  }),
  writes: false,
  args: [fileArgument],
  options: [
    textOption,
    { flags: '--command <name>', field: 'command', description: 'The command whose data the input is, when it holds data without its envelope ("jira issue search")' },
    { flags: '--key <key>', field: 'key', description: "The item a history belongs to, when its output doesn't say (PROJ-123, owner/repo#9)" },
    { flags: '--field <name=field>', field: 'field', description: 'Point an OWI field at a field of your own (repeatable): estimate=customfield_10234, estimateUnit=hours' },
  ],
  examples: [
    { file: 'owi/sprint-42.jsonl' },
    { file: 'owi/jira-changelog.json', key: 'PAY-104' },
    { file: 'owi/ado-get-batch.json', field: ['estimate=Custom.TeamPoints', 'estimateUnit=points'] },
    { text: EXAMPLE_ISSUE, command: 'github issue get' },
  ],
  run: async (input, ctx) => {
    const source = await openInput(ctx, input, { maxBytes: MAX_BYTES });
    const text = await source.text();
    const { mapOwiInput } = await import('./owi/run.js');
    return mapOwiInput(ctx, { text, source, command: input.command, key: input.key, field: input.field });
  },
});

/**
 * `util owi similar`: likely duplicates among OWI records, by lexical scoring
 * alone (src/core/owi/similar.ts). The definition stays here, small; the input
 * is read here too, because the reader brings zod, and the bytes go to
 * ./owi/similar-run.ts, loaded only when this runs, which hands them to the
 * bounded worker. Looking for an existing ticket before filing a new one is
 * the one piece of process everyone agrees with and nobody does.
 */
export const owiSimilarCommand = defineCommand({
  path: ['util', 'owi', 'similar'],
  description: 'Find likely duplicate work items among OWI records: rank them against some text or one of them, or list likely duplicate pairs (local only, deterministic)',
  toolDescription:
    "Finds likely duplicate work items among Open Work Item records (what util owi map returns: pass its envelope, its data, a JSON array of records, or one record a line, as file or text). Ask exactly one question: query ranks every item against some text (run it before filing or proposing a new item), item ranks the set against one of its items by OWI id (<connection>:<key>), and pairs lists likely duplicate pairs across the whole set, so items from Jira, Azure DevOps and GitHub are compared with each other. Scoring is lexical and deterministic, with no model and no network: BM25 over titles and bodies, title character trigrams (catching typos), and small boosts for shared labels, the same parent and a direct link. It finds shared words, not shared meaning. Returns { mode, method, fields, threshold, limit, query, item, items, count, matches, pairs, search, titleOnly, skipped, verified }: each match is { id, title, source, url, score, why } and each pair { score, a, b, why }, with why naming the title terms, body terms, trigram similarity, labels, parent and link that drove the score, and parts, what each added. Results score at least threshold (default 0.35), best first, at most limit (default 10). fields picks what is compared (title,body,labels,parent,links; default all). An item with no body is scored on its title alone, with a warning. Local only.",
  input: z.object({
    ...inputFields,
    query: z.string().min(1).optional().describe('Rank every item against this text, such as the title of an item about to be filed'),
    item: z.string().min(1).optional().describe('Rank the set against the item with this OWI id (<connection>:<key>, such as corp-jira:PAY-101)'),
    pairs: z.boolean().optional().describe('List likely duplicate pairs across the whole set'),
    limit: z.number().int().min(1).max(1000).optional().describe('The most matches or pairs to return (default 10, up to 1000)'),
    threshold: z.number().min(0).max(1).optional().describe('The lowest score returned, 0 to 1 (default 0.35)'),
    fields: z.string().min(1).optional().describe('What to compare, separated by commas: title, body, labels, parent and links (default all)'),
  }),
  writes: false,
  args: [fileArgument],
  options: [
    textOption,
    { flags: '--input-file <path>', field: 'file', description: 'The OWI records to compare: a file inside the workspace (the same as the [file] argument)' },
    { flags: '--query <text>', field: 'query', description: 'Rank every item against this text' },
    { flags: '--item <id>', field: 'item', description: 'Rank the set against the item with this OWI id (corp-jira:PAY-101)' },
    { flags: '--pairs', field: 'pairs', description: 'List likely duplicate pairs across the whole set' },
    { flags: '--limit <n>', field: 'limit', description: 'The most matches or pairs to return (default 10, up to 1000)' },
    { flags: '--threshold <score>', field: 'threshold', description: 'The lowest score returned, 0 to 1 (default 0.35)' },
    { flags: '--fields <list>', field: 'fields', description: 'What to compare: title, body, labels, parent and links, separated by commas (default all)' },
  ],
  examples: [
    { file: 'owi/triage.owi.json', query: 'Card payments time out at checkout' },
    { file: 'owi/triage.owi.json', item: 'corp-jira:PAY-210', limit: 5 },
    { file: 'owi/triage.owi.json', pairs: true, threshold: 0.5, fields: 'title,body,labels' },
    { text: EXAMPLE_RECORDS, pairs: true },
  ],
  run: async (input, ctx) => {
    const source = await openInput(ctx, input, { maxBytes: MAX_BYTES });
    const bytes = await source.bytes();
    const { similarOwi } = await import('./owi/similar-run.js');
    return similarOwi(ctx, { bytes, source, query: input.query, item: input.item, pairs: input.pairs, limit: input.limit, threshold: input.threshold, fields: input.fields });
  },
});

export const owiCommands = [owiMapCommand, owiSimilarCommand];
