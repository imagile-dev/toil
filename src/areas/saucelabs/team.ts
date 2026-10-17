import { z } from 'zod';
import { saucelabsArea } from './area.js';
import { id, sauce, TEAM_MGMT } from './client.js';

/**
 * Teams in your organization, from the Team Management API. Its routes are
 * Django-style and keep their trailing slash; the org chart, as ever, is
 * read-only from here.
 */

const teamArg = [{ name: 'team-id', field: 'teamId', description: 'Team ID', required: true }];

export const teamListCommand = saucelabsArea.command({
  path: ['saucelabs', 'team', 'list'],
  description: 'List teams',
  input: z.object({ name: z.string().optional().describe('Team name prefix') }),
  writes: false,
  options: [{ flags: '--name <prefix>', field: 'name', description: 'Team name prefix' }],
  examples: [{}, { name: 'imagile' }],
  run: async (input, ctx) => sauce(ctx, `${TEAM_MGMT}/teams/`, { query: { name: input.name } }),
});

export const teamGetCommand = saucelabsArea.command({
  path: ['saucelabs', 'team', 'get'],
  description: 'Get one team and its settings',
  input: z.object({ teamId: z.string().describe('Team ID') }),
  writes: false,
  args: teamArg,
  examples: [{ teamId: 'abc12345' }],
  run: async (input, ctx) => sauce(ctx, `${TEAM_MGMT}/teams/${id(input.teamId)}/`),
});

export const teamMembersCommand = saucelabsArea.command({
  path: ['saucelabs', 'team', 'members'],
  description: "List a team's members",
  input: z.object({ teamId: z.string().describe('Team ID') }),
  writes: false,
  args: teamArg,
  examples: [{ teamId: 'abc12345' }],
  run: async (input, ctx) => sauce(ctx, `${TEAM_MGMT}/teams/${id(input.teamId)}/members/`),
});

export const teamCommands = [teamListCommand, teamGetCommand, teamMembersCommand];
