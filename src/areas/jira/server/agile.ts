import { z } from 'zod';
import { ToilError } from '../../../core/errors.js';
import { allowWriteField } from '../../../core/run.js';
import { jiraArea } from '../area.js';
import * as client from './client.js';
import { asInt } from './input.js';
import { pagingFields, pagingOptions } from '../paging.js';

/**
 * Boards and sprints, which live behind the Agile API rather than the issue
 * API. A sprint is not a custom field and is never set through --field: it is
 * set here, after the issue exists, the way the planning meeting intended.
 */

export const listBoards = jiraArea.command({
  path: ['jira', 'board', 'list'],
  description: 'List Agile boards for a project',
  toolDescription:
    'Returns the Agile boards (id, name, type scrum or kanban) for a Jira project. Board ids feed jira_sprint_list. Without limit it returns every board; with limit, pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({ project: z.string().describe('Project key'), ...pagingFields('boards') }),
  writes: false,
  options: [{ flags: '--project <key>', field: 'project', description: 'Project key' }, ...pagingOptions('boards')],
  examples: [{ project: 'PROJ' }, { project: 'PROJ', limit: 1 }, { project: 'PROJ', limit: 1, cursor: '1' }],
  run: (input, ctx) => client.listBoards(ctx, input.project, input),
});

export const listSprints = jiraArea.command({
  path: ['jira', 'sprint', 'list'],
  description: 'List sprints for a board or project, including start/end dates',
  toolDescription:
    "Returns sprints (id, name, state, startDate, endDate, goal) for one board, or across every scrum board of a project, each sprint once. state filters to active, future and/or closed. With board, limit and cursor page through them: pass meta.page.nextCursor as cursor for the next page.",
  input: z.object({
    board: z.union([z.number(), z.string()]).optional().describe('Board id'),
    project: z.string().optional().describe("Project key: resolves to that project's scrum boards"),
    state: z.string().optional().describe('Comma-separated states to filter: active, future, closed'),
    ...pagingFields('sprints (with board)'),
  }),
  writes: false,
  options: [
    { flags: '--board <id>', field: 'board', description: 'Board ID' },
    { flags: '--project <key>', field: 'project', description: "Project key — resolves to that project's board(s)" },
    { flags: '--state <states>', field: 'state', description: 'Comma-separated states to filter (active,future,closed)' },
    ...pagingOptions('sprints (with --board)'),
  ],
  examples: [{ board: 3, state: 'active,future' }, { project: 'PROJ' }, { board: 1, limit: 1 }, { board: 1, limit: 1, cursor: '1' }],
  run: async (input, ctx) => {
    const board = input.board === undefined ? '' : String(input.board);
    if (!board && !input.project) {
      throw new ToilError('INVALID_INPUT', 'Either --board or --project is required', { fix: 'Pass --board <id> (from toil jira board list), or --project <key>.' });
    }
    // Passed through unchecked, empty entries and unknown states included.
    const states = input.state ? input.state.split(',').map((s) => s.trim()) : undefined;
    if (!board && (input.limit !== undefined || input.cursor !== undefined)) {
      throw new ToilError('INVALID_INPUT', "--limit and --cursor page one board's sprints, so they need --board", {
        fix: 'Pass --board <id> (from toil jira board list) with --limit, or leave --limit and --cursor out to list every sprint of the project.',
      });
    }
    return board ? client.listSprintsForBoard(ctx, asInt(board), states, input) : client.listSprintsForProject(ctx, input.project!, states);
  },
});

export const setSprint = jiraArea.command({
  path: ['jira', 'issue', 'set-sprint'],
  description: 'Move a Jira issue into a sprint',
  toolDescription: 'Moves a Jira issue into a sprint by sprint id (from jira_sprint_list). Returns { updated, sprint }.',
  input: z.object({
    key: z.string().describe('Issue key, e.g. PROJ-123'),
    sprint: z.union([z.number(), z.string()]).describe('Sprint id, from sprint list'),
    ...allowWriteField,
  }),
  writes: true,
  args: [{ name: 'key', field: 'key', description: 'Issue key' }],
  options: [
    { flags: '--sprint <id>', field: 'sprint', description: 'Sprint ID (from sprint list)' },
  ],
  examples: [{ key: 'PROJ-123', sprint: 42, allowWrite: true }],
  run: async (input, ctx) => {
    await client.setSprint(ctx, asInt(input.sprint), [input.key]);
    // A string, as it always was: scripts compare it to what they passed.
    return { updated: input.key, sprint: String(input.sprint) };
  },
});

export const agileCommands = [listBoards, listSprints, setSprint];
