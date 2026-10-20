import { z } from 'zod';
import { allowWriteField } from '../../core/run.js';
import { saucelabsArea } from './area.js';
import { countOf, id, intText, listField, parseChoice, parseIntOption, parseUnixTime, passedFlag, requireBody, sauce, splitList, userPath } from './client.js';

/**
 * Jobs on Sauce's virtual devices and desktop browsers (VDC), under
 * `/rest/v1/<username>/jobs`. A delete answers 204, so the command reports
 * what it did itself; silence from the server is not, on its own, a receipt.
 */

const JOB_VISIBILITY = ['public', 'public restricted', 'share', 'team', 'private'] as const;

const jobId = z.string().describe('Job ID');
const jobArg = [{ name: 'job-id', field: 'jobId', description: 'Job ID', required: true }];

export const jobListCommand = saucelabsArea.command({
  path: ['saucelabs', 'job', 'list'],
  description: 'List your recent jobs',
  input: z.object({
    limit: intText.optional().describe('Maximum number of jobs to return'),
    offset: intText.optional().describe('Number of jobs to skip'),
    from: intText.optional().describe('Only jobs created after this time (Unix seconds or ISO 8601)'),
    to: intText.optional().describe('Only jobs created before this time (Unix seconds or ISO 8601)'),
  }),
  writes: false,
  options: [
    { flags: '--limit <n>', field: 'limit', description: 'Maximum number of jobs to return' },
    { flags: '--offset <n>', field: 'offset', description: 'Number of jobs to skip' },
    { flags: '--from <time>', field: 'from', description: 'Only jobs created after this time (Unix seconds or ISO 8601)' },
    { flags: '--to <time>', field: 'to', description: 'Only jobs created before this time (Unix seconds or ISO 8601)' },
  ],
  examples: [{}, { limit: '5', offset: '10', from: '2026-09-01T00:00:00Z', to: '1790000000' }],
  run: async (input, ctx) => {
    const query = {
      limit: parseIntOption(input.limit, '--limit'),
      skip: parseIntOption(input.offset, '--offset'),
      from: parseUnixTime(input.from, '--from'),
      to: parseUnixTime(input.to, '--to'),
    };
    const data = await sauce<unknown>(ctx, `${userPath(ctx)}/jobs`, { query });
    return { count: countOf(data), jobs: data };
  },
});

export const jobGetCommand = saucelabsArea.command({
  path: ['saucelabs', 'job', 'get'],
  description: 'Get one job: status, platform, timings, and log/video URLs',
  input: z.object({ jobId }),
  writes: false,
  args: jobArg,
  examples: [{ jobId: 'abc12345' }],
  run: async (input, ctx) => sauce(ctx, `${userPath(ctx)}/jobs/${id(input.jobId)}`),
});

export const jobUpdateCommand = saucelabsArea.command({
  path: ['saucelabs', 'job', 'update'],
  description: "Update a job's name, build, tags, result, or visibility",
  input: z.object({
    jobId,
    name: z.string().optional().describe('Job name'),
    build: z.string().optional().describe('Build name to group the job under'),
    tags: listField('Comma-separated tags; replaces the existing tags'),
    passed: z.boolean().optional().describe('Mark the job as passed'),
    failed: z.boolean().optional().describe('Mark the job as failed'),
    public: z.string().optional().describe('Visibility: public, public restricted, share, team, private'),
    ...allowWriteField,
  }),
  writes: true,
  args: jobArg,
  options: [
    { flags: '--name <name>', field: 'name', description: 'Job name' },
    { flags: '--build <build>', field: 'build', description: 'Build name to group the job under' },
    { flags: '--tags <tags>', field: 'tags', description: 'Comma-separated tags; replaces the existing tags' },
    { flags: '--passed', field: 'passed', description: 'Mark the job as passed' },
    { flags: '--failed', field: 'failed', description: 'Mark the job as failed' },
    { flags: '--public <visibility>', field: 'public', description: 'Visibility: public, public restricted, share, team, private' },
  ],
  examples: [
    { jobId: 'abc12345', failed: true, tags: ['smoke,email'], public: 'TEAM', allowWrite: true },
    { jobId: 'abc12345', name: 'Checkout flow', build: 'release-1.2', passed: true, allowWrite: true },
  ],
  run: async (input, ctx) => {
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.build !== undefined) body.build = input.build;
    if (input.tags !== undefined) body.tags = splitList(input.tags);
    const passed = passedFlag(input);
    if (passed !== undefined) body.passed = passed;
    const visibility = parseChoice(input.public, JOB_VISIBILITY, '--public');
    if (visibility !== undefined) body.public = visibility;
    return sauce(ctx, `${userPath(ctx)}/jobs/${id(input.jobId)}`, {
      method: 'PUT',
      body: requireBody(body, 'Pass at least one of --name, --build, --tags, --passed/--failed, --public.'),
    });
  },
});

export const jobStopCommand = saucelabsArea.command({
  path: ['saucelabs', 'job', 'stop'],
  description: 'Stop a running job',
  input: z.object({ jobId, ...allowWriteField }),
  writes: true,
  args: jobArg,
  examples: [{ jobId: 'abc12345', allowWrite: true }],
  run: async (input, ctx) => sauce(ctx, `${userPath(ctx)}/jobs/${id(input.jobId)}/stop`, { method: 'PUT' }),
});

export const jobDeleteCommand = saucelabsArea.command({
  path: ['saucelabs', 'job', 'delete'],
  description: 'Delete a job and all of its assets',
  input: z.object({ jobId, ...allowWriteField }),
  writes: true,
  // Deletes are never served over MCP.
  mcp: false,
  args: jobArg,
  examples: [{ jobId: 'abc12345', allowWrite: true }],
  run: async (input, ctx) => {
    await sauce(ctx, `${userPath(ctx)}/jobs/${id(input.jobId)}`, { method: 'DELETE' });
    return { jobId: input.jobId, deleted: true };
  },
});

export const jobAssetsCommand = saucelabsArea.command({
  path: ['saucelabs', 'job', 'assets'],
  description: 'List the asset files a job produced (logs, video, screenshots) — names only, no download',
  input: z.object({ jobId }),
  writes: false,
  args: jobArg,
  examples: [{ jobId: 'abc12345' }],
  run: async (input, ctx) => {
    const data = await sauce<unknown>(ctx, `${userPath(ctx)}/jobs/${id(input.jobId)}/assets`);
    return { jobId: input.jobId, assets: data };
  },
});

export const jobCommands = [jobListCommand, jobGetCommand, jobUpdateCommand, jobStopCommand, jobDeleteCommand, jobAssetsCommand];
