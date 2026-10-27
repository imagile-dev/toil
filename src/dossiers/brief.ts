import { z } from 'zod';
import { inputFields, openInput, textOption } from '../areas/util/kit/input.js';
import { brief, standardSettings } from '../core/brief/brief.js';
import { readBriefRecords } from '../core/brief/read.js';
import { defineConfigCommand, type AnyCommand } from '../core/command.js';
import { ToilError } from '../core/errors.js';
import { forwardSlashes } from '../core/files.js';
import { chosen } from './commands.js';

/**
 * `toil dossiers brief` (#494): the briefing by code for one dossier, from
 * the work items and pull requests the caller read and mapped. It reads the
 * dossier for its settings (the WIP limit now, its Analyze settings next) and
 * asks no service: the trackers and code hosts are each read by their own
 * command, and composed through `util owi map` (principle 3). The rules are
 * in src/core/brief/, where Toil UI reads them too. The status meeting,
 * minus the meeting.
 */

const MAX_BYTES = 64 * 1024 * 1024;

/** Three items in a chain and the pull request whose checks fail on the first, for the examples. */
export const EXAMPLE_BRIEF_RECORDS = JSON.stringify({
  items: [
    { id: 'corp-jira:PAY-101', source: { area: 'jira', connection: 'corp-jira', key: 'PAY-101', command: 'jira issue search' }, url: 'https://jira.imagile.dev/browse/PAY-101', title: 'Tokenise card numbers at the edge', status: 'In Progress', statusCategory: 'IN_PROGRESS', assignee: { id: 'jsmith', name: 'J. Smith', email: null }, estimate: { value: 5, unit: 'points', field: 'Story Points' }, links: [{ type: 'blocks', direction: 'outward', target: 'corp-jira:PAY-102', name: 'blocks' }], updated: '2026-10-12T16:10:00.000Z' },
    { id: 'corp-jira:PAY-102', source: { area: 'jira', connection: 'corp-jira', key: 'PAY-102', command: 'jira issue search' }, url: 'https://jira.imagile.dev/browse/PAY-102', title: 'Store tokens in the vault', status: 'To Do', statusCategory: 'TODO', assignee: null, estimate: { value: 3, unit: 'points', field: 'Story Points' }, links: [{ type: 'blocks', direction: 'inward', target: 'corp-jira:PAY-101', name: 'is blocked by' }], updated: '2026-10-05T09:10:00.000Z' },
    { id: 'corp-jira:PAY-105', source: { area: 'jira', connection: 'corp-jira', key: 'PAY-105', command: 'jira issue search' }, url: 'https://jira.imagile.dev/browse/PAY-105', title: 'Show the last four digits on receipts', status: 'Done', statusCategory: 'DONE', assignee: null, estimate: { value: 3, unit: 'points', field: 'Story Points' }, links: [], updated: '2026-10-09T15:30:00.000Z' },
  ],
  changes: [
    { id: 'corp-bitbucket:PAY/payments-core#311', repo: 'PAY/payments-core', title: 'Tokenise PANs in the edge proxy', url: 'https://bitbucket.imagile.dev/projects/PAY/repos/payments-core/pull-requests/311', state: 'OPEN', checks: 'FAILING', checksAt: '2026-10-12T15:40:00.000Z', workItems: ['corp-jira:PAY-101'], created: '2026-10-12T15:30:00.000Z', firstReviewAt: '2026-10-12T17:00:00.000Z' },
  ],
});

export function dossierBriefCommands(): AnyCommand[] {
  const command = defineConfigCommand({
    path: ['dossiers', 'brief'],
    description: "Brief one dossier by code: what needs a person, under one reason each, and what to do first, from OWI records you pass (local only)",
    toolDescription:
      "Briefs one dossier from Open Work Item records you pass (what util owi map printed for the dossier's work items and pull requests, as file or text; several envelopes, one per line, are fine). Asks no service: read each tracker and code host with its own command first. Applies the dossier's lenses in order (failing checks, blocked, waiting on review, sprint at risk, stale, over the WIP limit, ticket and pull request disagree) and puts each item that needs a person under the first lens that flags it. Returns { dossier, asOf, by, recommendation { text, items }, reasons [{ lens, label, severity, line, text, items [{ id, key, title, url, status, statusCategory, assignee, points, why, evidence, holds { items, points }, changes [{ id, title, url, state, checks }] }] }], onTrack { open, done }, sprint, lenses [{ id, label, on, threshold, unit, test, checked, note }], skipped }. Sentences cite items and pull requests as [[<owi id>]]; each item's url opens it in its tracker. A lens it can't check says why in lenses[].note. Use it as the starting point for an analysis, then weigh what it found.",
    input: z.object({
      dossier: z.string().min(1).optional().describe('A dossier name, or the path to a dossier file. Defaults to the dossier that applies to the folder.'),
      cwd: z.string().min(1).optional().describe('The folder to look from; its repository decides which checked-in dossiers apply. Defaults to the workspace.'),
      ...inputFields,
      asOf: z.string().datetime({ offset: true }).optional().describe('The moment to brief as of, as an ISO 8601 time (default: now). Ages and the sprint are counted to it.'),
    }),
    writes: false,
    writesLocal: false,
    args: [{ name: 'dossier', field: 'dossier', description: 'A dossier name or file (default: the one the folder matches)', required: false }],
    options: [
      { flags: '--input-file <path>', field: 'file', description: 'The OWI records: a file inside the workspace, or - for stdin (the default when no --text is given)' },
      textOption,
      { flags: '--as-of <time>', field: 'asOf', description: 'Brief as of this ISO 8601 time (default: now)' },
      { flags: '--cwd <dir>', field: 'cwd', description: 'The folder to look from (default: the working directory)' },
    ],
    examples: [
      { dossier: 'payments', text: EXAMPLE_BRIEF_RECORDS, asOf: '2026-10-13T08:00:00Z' },
      { dossier: 'payments', cwd: '.', file: 'owi/brief.owi.json', asOf: '2026-10-16T08:00:00Z' },
    ],
    run: async (input, ctx) => {
      const applied = chosen(ctx.manage!.dossiers!, input, ctx);
      const { dossier, source, file } = applied.file;
      const read = await openInput(ctx, input, { maxBytes: MAX_BYTES });
      const records = readBriefRecords(await read.text());
      if (!records.items.length) {
        throw new ToilError('INVALID_INPUT', `The input holds no work items${records.skipped.length ? ` (${records.skipped.length} records skipped: ${records.skipped[0]!.at}, ${records.skipped[0]!.reason})` : ''}.`, {
          fix: "Pass the dossier's work items as OWI records: toil jira issue search … | toil util owi map, then this command.",
        });
      }
      if (records.skipped.length) ctx.warn({ code: 'BRIEF_SKIPPED', message: `${records.skipped.length} record${records.skipped.length > 1 ? 's were' : ' was'} skipped: ${records.skipped[0]!.at}, ${records.skipped[0]!.reason}. data.skipped lists each.` });
      if (records.duplicates.length) ctx.warn({ code: 'BRIEF_DUPLICATE_ID', message: `${records.duplicates.length} id${records.duplicates.length > 1 ? 's appear' : ' appears'} more than once (${records.duplicates.slice(0, 3).join(', ')}); the first of each was used.` });
      if (!records.changes.length) ctx.warn({ code: 'BRIEF_NO_CHANGES', message: 'The input holds no pull requests, so failing checks, waiting on review and drift found nothing. Map the code hosts\' pr list output too.' });
      const result = brief({ items: records.items, changes: records.changes, asOf: input.asOf ?? new Date().toISOString(), settings: standardSettings(dossier.wipLimit ?? null) });
      return { dossier: { name: dossier.name, file: forwardSlashes(file), source, adopted: source === 'user' }, ...result, skipped: records.skipped };
    },
  });
  return [command];
}
