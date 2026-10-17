import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { jiraArea } from './area.js';
import * as client from './client.js';
import { asInt } from './input.js';

/**
 * Boards and sprints, which live behind the Agile API rather than the issue
 * API. A sprint is not a custom field and is never set through --field: it is
 * set here, after the issue exists, the way the planning meeting intended.
 */

export const listBoards = jiraArea.command({
  path: ['jira', 'list-boards'],
  description: 'List Agile boards for a project',
  toolDescription: 'Returns the Agile boards (id, name, type scrum or kanban) for a Jira project. Board ids feed jira_list_sprints.',
  input: z.object({ project: z.string().describe('Project key') }),
  writes: false,
  options: [{ flags: '--project <key>', field: 'project', description: 'Project key' }],
  examples: [{ project: 'PROJ' }],
  run: (input, ctx) => client.listBoards(ctx, input.project),
});

export const listSprints = jiraArea.command({
  path: ['jira', 'list-sprints'],
  description: 'List sprints for a board or project, including start/end dates',
  toolDescription:
    "Returns sprints (id, name, state, startDate, endDate, goal) for one board, or across every scrum board of a project, each sprint once. state filters to active, future and/or closed.",
  input: z.object({
    board: z.union([z.number(), z.string()]).optional().describe('Board id'),
    project: z.string().optional().describe("Project key: resolves to that project's scrum boards"),
    state: z.string().optional().describe('Comma-separated states to filter: active, future, closed'),
  }),
  writes: false,
  options: [
    { flags: '--board <id>', field: 'board', description: 'Board ID' },
    { flags: '--project <key>', field: 'project', description: "Project key — resolves to that project's board(s)" },
    { flags: '--state <states>', field: 'state', description: 'Comma-separated states to filter (active,future,closed)' },
  ],
  examples: [{ board: 3, state: 'active,future' }, { project: 'PROJ' }],
  run: async (input, ctx) => {
    const board = input.board === undefined ? '' : String(input.board);
    if (!board && !input.project) {
      throw new ToilError('INVALID_INPUT', 'Either --board or --project is required', { fix: 'Pass --board <id> (from toil jira list-boards), or --project <key>.' });
    }
    // Passed through unchecked, empty entries and unknown states included, as before.
    const states = input.state ? input.state.split(',').map((s) => s.trim()) : undefined;
    return board ? client.listSprintsForBoard(ctx, asInt(board), states) : client.listSprintsForProject(ctx, input.project!, states);
  },
});

export const setSprint = jiraArea.command({
  path: ['jira', 'set-sprint'],
  description: 'Move a Jira issue into a sprint',
  toolDescription: 'Moves a Jira issue into a sprint by sprint id (from jira_list_sprints). Returns { updated, sprint }.',
  input: z.object({
    key: z.string().describe('Issue key, e.g. PROJ-123'),
    sprint: z.union([z.number(), z.string()]).describe('Sprint id, from list-sprints'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    { flags: '--key <issue-key>', field: 'key', description: 'Issue key' },
    { flags: '--sprint <id>', field: 'sprint', description: 'Sprint ID (from list-sprints)' },
  ],
  examples: [{ key: 'PROJ-123', sprint: 42, allowWrite: true }],
  run: async (input, ctx) => {
    await client.setSprint(ctx, asInt(input.sprint), [input.key]);
    // A string, as it always was: scripts compare it to what they passed.
    return { updated: input.key, sprint: String(input.sprint) };
  },
});

export const agileCommands = [listBoards, listSprints, setSprint];
