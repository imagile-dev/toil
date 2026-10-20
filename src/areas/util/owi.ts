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

export const owiCommands = [owiMapCommand];
