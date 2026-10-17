import { z } from 'zod';
import { allowWriteField } from '../../core/run.js';
import { saucelabsArea } from './area.js';
import { countOf, id, sauce, userPath } from './client.js';

/**
 * Sauce Connect tunnels, under `/rest/v1/<username>/tunnels`. Suspected bug
 * (#71 item 2): get, jobs and stop always file the request under your own
 * username, so a tunnel a teammate shared with you is addressed to the wrong
 * desk. Kept until a live run says where it lands.
 */

const tunnelId = z.string().describe('Tunnel ID');
const tunnelArg = [{ name: 'tunnel-id', field: 'tunnelId', description: 'Tunnel ID', required: true }];

export const tunnelListCommand = saucelabsArea.command({
  path: ['saucelabs', 'tunnel', 'list'],
  description: 'List your tunnels with full details',
  input: z.object({ all: z.boolean().optional().describe('Include tunnels shared with you') }),
  writes: false,
  options: [{ flags: '--all', field: 'all', description: 'Include tunnels shared with you' }],
  examples: [{}, { all: true }],
  run: async (input, ctx) => {
    const data = await sauce<unknown>(ctx, `${userPath(ctx)}/tunnels`, { query: { full: true, all: input.all ? true : undefined } });
    // Suspected bug (#71 item 1): with --all Sauce answers with an object keyed by owner, so count drops out and tunnels changes type.
    return { count: countOf(data), tunnels: data };
  },
});

export const tunnelGetCommand = saucelabsArea.command({
  path: ['saucelabs', 'tunnel', 'get'],
  description: 'Get one tunnel',
  input: z.object({ tunnelId }),
  writes: false,
  args: tunnelArg,
  examples: [{ tunnelId: 'abc12345' }],
  run: async (input, ctx) => sauce(ctx, `${userPath(ctx)}/tunnels/${id(input.tunnelId)}`),
});

export const tunnelJobsCommand = saucelabsArea.command({
  path: ['saucelabs', 'tunnel', 'jobs'],
  description: 'Number of jobs currently running through a tunnel',
  input: z.object({ tunnelId }),
  writes: false,
  args: tunnelArg,
  examples: [{ tunnelId: 'abc12345' }],
  run: async (input, ctx) => sauce(ctx, `${userPath(ctx)}/tunnels/${id(input.tunnelId)}/num_jobs`),
});

export const tunnelStopCommand = saucelabsArea.command({
  path: ['saucelabs', 'tunnel', 'stop'],
  description: 'Shut down a tunnel',
  input: z.object({ tunnelId, ...allowWriteField }),
  writes: true,
  // A DELETE on the tunnel: kept off MCP with the other deletes.
  mcp: false,
  args: tunnelArg,
  examples: [{ tunnelId: 'abc12345', allowWrite: true }],
  run: async (input, ctx) => sauce(ctx, `${userPath(ctx)}/tunnels/${id(input.tunnelId)}`, { method: 'DELETE' }),
});

export const tunnelCommands = [tunnelListCommand, tunnelGetCommand, tunnelJobsCommand, tunnelStopCommand];
