import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { jiraCloudArea } from './area.js';
import * as client from './client.js';
import { pagingFields, pagingOptions } from '../jira/paging.js';

/**
 * Boards and sprints, behind the Agile REST API 1.0 rather than the issue API
 * (https://developer.atlassian.com/cloud/jira/software/rest/). Same commands
 * and flags as `jira`, since the operations are the same; the sprint ceremony
 * itself remains out of scope.
 */

const SPRINT_STATES = ['active', 'future', 'closed'];

export const listBoards = jiraCloudArea.command({
  path: ['jira-cloud', 'board', 'list'],
  description: 'List Agile boards for a project',
  toolDescription:
    'Returns the Agile boards (id, name, type scrum or kanban) for a Jira Cloud project. Board ids feed jira_cloud_sprint_list. Without limit it returns every board; with limit, pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({ project: z.string().min(1).describe('Project key or id'), ...pagingFields('boards') }),
  writes: false,
  options: [{ flags: '--project <key>', field: 'project', description: 'Project key' }, ...pagingOptions('boards')],
  examples: [{ project: 'PROJ' }, { project: 'PROJ', limit: 1 }, { project: 'PROJ', limit: 1, cursor: '1' }],
  run: (input, ctx) => client.listBoards(ctx, input.project, input),
});

export const listSprints = jiraCloudArea.command({
  path: ['jira-cloud', 'sprint', 'list'],
  description: 'List sprints for a board or project, including start/end dates',
  toolDescription:
    'Returns sprints (id, name, state, startDate, endDate, goal) for one board, or across every scrum board of a project, each sprint once. state filters to active, future and/or closed. With board, limit and cursor page through them: pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({
    board: z.number().int().positive().optional().describe('Board id'),
    project: z.string().min(1).optional().describe("Project key: resolves to that project's scrum boards"),
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
    if (input.board === undefined && !input.project) {
      throw new ToilError('INVALID_INPUT', 'Either --board or --project is required', { fix: 'Pass --board <id> (from toil jira-cloud board list), or --project <key>.' });
    }
    const states = input.state === undefined ? undefined : input.state.split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = (states ?? []).filter((s) => !SPRINT_STATES.includes(s));
    if (unknown.length > 0) throw new ToilError('INVALID_INPUT', `Unknown sprint state: ${unknown.join(', ')}`, { fix: 'Use active, future and/or closed, comma-separated.' });
    if (input.board === undefined && (input.limit !== undefined || input.cursor !== undefined)) {
      throw new ToilError('INVALID_INPUT', "--limit and --cursor page one board's sprints, so they need --board", {
        fix: 'Pass --board <id> (from toil jira-cloud board list) with --limit, or leave --limit and --cursor out to list every sprint of the project.',
      });
    }
    return input.board !== undefined ? client.listSprintsForBoard(ctx, input.board, states, input) : client.listSprintsForProject(ctx, input.project!, states);
  },
});

export const setSprint = jiraCloudArea.command({
  path: ['jira-cloud', 'issue', 'set-sprint'],
  description: 'Move a Jira Cloud issue into a sprint',
  toolDescription: 'Moves a Jira Cloud issue into a sprint by sprint id (from jira_cloud_sprint_list). Returns { updated, sprint }.',
  input: z.object({
    key: z.string().min(1).describe('Issue key, e.g. PROJ-123'),
    sprint: z.number().int().positive().describe('Sprint id, from sprint list'),
    ...allowWriteField,
  }),
  writes: true,
  args: [{ name: 'key', field: 'key', description: 'Issue key' }],
  options: [
    { flags: '--sprint <id>', field: 'sprint', description: 'Sprint ID (from sprint list)' },
  ],
  examples: [{ key: 'PROJ-123', sprint: 42, allowWrite: true }],
  run: async (input, ctx) => {
    await client.setSprint(ctx, input.sprint, [input.key]);
    // A string, as jira's issue set-sprint returns it, so a script works against either.
    return { updated: input.key, sprint: String(input.sprint) };
  },
});

export const agileCommands = [listBoards, listSprints, setSprint];
