import { z } from 'zod';
import { allowWriteField } from '../../core/run.js';
import { saucelabsArea } from './area.js';
import { id, intText, listField, parseIntOption, passedFlag, requireBody, sauce, splitList } from './client.js';

/**
 * Jobs that ran on real devices, under `/v1/rdc/jobs`. Unlike their virtual
 * cousins they aren't filed under a username; the device is the paperwork.
 */

const jobId = z.string().describe('Job ID');
const jobArg = [{ name: 'job-id', field: 'jobId', description: 'Job ID', required: true }];

export const rdcJobListCommand = saucelabsArea.command({
  path: ['saucelabs', 'rdc-job', 'list'],
  description: 'List real-device jobs',
  input: z.object({
    limit: intText.optional().describe('Maximum number of jobs to return'),
    offset: intText.optional().describe('Number of jobs to skip'),
    live: z.boolean().optional().describe('Only manual (live) tests'),
  }),
  writes: false,
  options: [
    { flags: '--limit <n>', field: 'limit', description: 'Maximum number of jobs to return' },
    // Suspected bug (#71 item 6): Sauce documents offset as defaulting to 1, so it may be 1-based.
    { flags: '--offset <n>', field: 'offset', description: 'Number of jobs to skip' },
    { flags: '--live', field: 'live', description: 'Only manual (live) tests' },
  ],
  examples: [{}, { limit: '3', offset: '0', live: true }],
  run: async (input, ctx) =>
    sauce(ctx, '/v1/rdc/jobs', {
      query: {
        limit: parseIntOption(input.limit, '--limit'),
        offset: parseIntOption(input.offset, '--offset'),
        type: input.live ? 'LIVE' : undefined,
      },
    }),
});

export const rdcJobGetCommand = saucelabsArea.command({
  path: ['saucelabs', 'rdc-job', 'get'],
  description: 'Get one real-device job: device, result, timings, and log URLs',
  input: z.object({ jobId }),
  writes: false,
  args: jobArg,
  examples: [{ jobId: 'abc12345' }],
  run: async (input, ctx) => sauce(ctx, `/v1/rdc/jobs/${id(input.jobId)}`),
});

export const rdcJobUpdateCommand = saucelabsArea.command({
  path: ['saucelabs', 'rdc-job', 'update'],
  description: "Update a real-device job's name, build, tags, or result",
  input: z.object({
    jobId,
    name: z.string().optional().describe('Job name'),
    build: z.string().optional().describe('Build name'),
    tags: listField('Comma-separated tags; replaces the existing tags'),
    passed: z.boolean().optional().describe('Mark the job as passed'),
    failed: z.boolean().optional().describe('Mark the job as failed'),
    ...allowWriteField,
  }),
  writes: true,
  args: jobArg,
  options: [
    { flags: '--name <name>', field: 'name', description: 'Job name' },
    { flags: '--build <build>', field: 'build', description: 'Build name' },
    { flags: '--tags <tags>', field: 'tags', description: 'Comma-separated tags; replaces the existing tags' },
    { flags: '--passed', field: 'passed', description: 'Mark the job as passed' },
    { flags: '--failed', field: 'failed', description: 'Mark the job as failed' },
  ],
  examples: [
    { jobId: 'abc12345', name: 'Login on device', build: 'release-1.2', tags: ['smoke', 'android'], passed: true, allowWrite: true },
    { jobId: 'abc12345', failed: true, allowWrite: true },
  ],
  run: async (input, ctx) => {
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.build !== undefined) body.build = input.build;
    if (input.tags !== undefined) body.tags = splitList(input.tags);
    const passed = passedFlag(input);
    if (passed !== undefined) body.passed = passed;
    return sauce(ctx, `/v1/rdc/jobs/${id(input.jobId)}`, {
      method: 'PUT',
      body: requireBody(body, 'Pass at least one of --name, --build, --tags, --passed/--failed.'),
    });
  },
});

export const rdcJobStopCommand = saucelabsArea.command({
  path: ['saucelabs', 'rdc-job', 'stop'],
  description: 'Stop a running real-device job',
  input: z.object({ jobId, ...allowWriteField }),
  writes: true,
  args: jobArg,
  examples: [{ jobId: 'abc12345', allowWrite: true }],
  run: async (input, ctx) => {
    await sauce(ctx, `/v1/rdc/jobs/${id(input.jobId)}/stop`, { method: 'PUT' });
    return { jobId: input.jobId, stopped: true };
  },
});

export const rdcJobDeleteCommand = saucelabsArea.command({
  path: ['saucelabs', 'rdc-job', 'delete'],
  description: 'Delete a real-device job (owner, team admin, or org admin only)',
  input: z.object({ jobId, ...allowWriteField }),
  writes: true,
  // Deletes are never served over MCP.
  mcp: false,
  args: jobArg,
  examples: [{ jobId: 'abc12345', allowWrite: true }],
  run: async (input, ctx) => {
    await sauce(ctx, `/v1/rdc/jobs/${id(input.jobId)}`, { method: 'DELETE' });
    return { jobId: input.jobId, deleted: true };
  },
});

export const rdcJobCommands = [rdcJobListCommand, rdcJobGetCommand, rdcJobUpdateCommand, rdcJobStopCommand, rdcJobDeleteCommand];
