import { z } from 'zod';
import { saucelabsArea } from './area.js';
import { countOf, id, intText, listField, parseChoice, parseIntOption, parseUnixTime, sauce, splitList } from './client.js';

/**
 * Builds, the groups of jobs on virtual (`vdc`) or real (`rdc`) devices,
 * under `/v2/builds/<source>/`. Django-style routes: every path keeps its
 * trailing slash, and a path without one is returned to sender.
 */

const BUILD_SOURCES = ['vdc', 'rdc'] as const;
const BUILD_STATUSES = ['running', 'error', 'failed', 'complete', 'success'] as const;
const JOB_STATE_FLAGS = ['failed', 'errored', 'passed', 'running', 'queued', 'completed', 'finished', 'faulty'] as const;

const SOURCE_HELP = 'Build source: vdc (virtual devices) or rdc (real devices) (default: "vdc")';
const source = z.string().optional().describe(SOURCE_HELP);
const sourceOption = { flags: '--source <source>', field: 'source', description: SOURCE_HELP };
const sourceOf = (value: string | undefined) => parseChoice(value ?? 'vdc', BUILD_SOURCES, '--source');

export const buildListCommand = saucelabsArea.command({
  path: ['saucelabs', 'build', 'list'],
  description: 'List builds',
  input: z.object({
    source,
    status: listField('Filter by status (repeatable or comma-separated): running, error, failed, complete, success'),
    name: z.string().optional().describe('Filter by build name'),
    start: intText.optional().describe('Only builds started after this time (Unix seconds or ISO 8601)'),
    end: intText.optional().describe('Only builds ended before this time (Unix seconds or ISO 8601)'),
    limit: intText.optional().describe('Maximum number of builds to return'),
    offset: intText.optional().describe('Number of builds to skip'),
    sort: z.string().optional().describe('Sort by creation time: asc or desc'),
  }),
  writes: false,
  options: [
    sourceOption,
    { flags: '--status <status>', field: 'status', description: 'Filter by status (repeatable or comma-separated): running, error, failed, complete, success' },
    { flags: '--name <name>', field: 'name', description: 'Filter by build name' },
    { flags: '--start <time>', field: 'start', description: 'Only builds started after this time (Unix seconds or ISO 8601)' },
    { flags: '--end <time>', field: 'end', description: 'Only builds ended before this time (Unix seconds or ISO 8601)' },
    { flags: '--limit <n>', field: 'limit', description: 'Maximum number of builds to return' },
    { flags: '--offset <n>', field: 'offset', description: 'Number of builds to skip' },
    // Suspected bug (#71 item 3): Sauce documents sort as alphabetical, not by creation time. The help is kept.
    { flags: '--sort <order>', field: 'sort', description: 'Sort by creation time: asc or desc' },
  ],
  examples: [
    {},
    { source: 'rdc', status: ['failed,error', 'running'], name: 'release-1.2', start: '2026-09-01T00:00:00Z', end: '1790000000', limit: '10', offset: '20', sort: 'DESC' },
  ],
  run: async (input, ctx) => {
    const src = sourceOf(input.source);
    const statuses = splitList(input.status)?.map((s) => parseChoice(s, BUILD_STATUSES, '--status') as string);
    const data = await sauce<{ builds?: unknown[] } | undefined>(ctx, `/v2/builds/${src}/`, {
      // The repeated status keys come first, as they did when they were written into the path.
      query: {
        status: statuses,
        name: input.name,
        start: parseUnixTime(input.start, '--start'),
        end: parseUnixTime(input.end, '--end'),
        limit: parseIntOption(input.limit, '--limit'),
        offset: parseIntOption(input.offset, '--offset'),
        sort: parseChoice(input.sort, ['asc', 'desc'] as const, '--sort'),
      },
    });
    return { source: src, count: countOf(data, 'builds'), builds: data?.builds ?? [] };
  },
});

export const buildGetCommand = saucelabsArea.command({
  path: ['saucelabs', 'build', 'get'],
  description: 'Get one build with its job counts',
  input: z.object({ buildId: z.string().describe('Build ID'), source }),
  writes: false,
  args: [{ name: 'build-id', field: 'buildId', description: 'Build ID', required: true }],
  options: [sourceOption],
  examples: [{ buildId: 'abc12345' }, { buildId: 'abc12345', source: 'rdc' }],
  run: async (input, ctx) => sauce(ctx, `/v2/builds/${sourceOf(input.source)}/${id(input.buildId)}/`),
});

export const buildJobsCommand = saucelabsArea.command({
  path: ['saucelabs', 'build', 'jobs'],
  description: 'List the jobs in a build',
  input: z.object({
    buildId: z.string().describe('Build ID'),
    source,
    failed: z.boolean().optional().describe('Only failed jobs'),
    errored: z.boolean().optional().describe('Only errored jobs'),
    passed: z.boolean().optional().describe('Only passed jobs'),
    running: z.boolean().optional().describe('Only running jobs'),
    queued: z.boolean().optional().describe('Only queued jobs'),
    completed: z.boolean().optional().describe('Only completed jobs'),
    finished: z.boolean().optional().describe('Only finished jobs'),
    faulty: z.boolean().optional().describe('Only faulty (failed or errored) jobs'),
    modifiedSince: z.string().optional().describe('Only jobs modified since this ISO 8601 time'),
  }),
  writes: false,
  args: [{ name: 'build-id', field: 'buildId', description: 'Build ID', required: true }],
  options: [
    sourceOption,
    { flags: '--failed', field: 'failed', description: 'Only failed jobs' },
    { flags: '--errored', field: 'errored', description: 'Only errored jobs' },
    { flags: '--passed', field: 'passed', description: 'Only passed jobs' },
    { flags: '--running', field: 'running', description: 'Only running jobs' },
    { flags: '--queued', field: 'queued', description: 'Only queued jobs' },
    { flags: '--completed', field: 'completed', description: 'Only completed jobs' },
    { flags: '--finished', field: 'finished', description: 'Only finished jobs' },
    { flags: '--faulty', field: 'faulty', description: 'Only faulty (failed or errored) jobs' },
    { flags: '--modified-since <time>', field: 'modifiedSince', description: 'Only jobs modified since this ISO 8601 time' },
  ],
  examples: [
    { buildId: 'abc12345' },
    { buildId: 'abc12345', source: 'rdc', failed: true, errored: true, passed: true, running: true, queued: true, completed: true, finished: true, faulty: true, modifiedSince: '2026-09-01T00:00:00Z' },
  ],
  run: async (input, ctx) => {
    const src = sourceOf(input.source);
    // Suspected bug (#71 item 5): sent raw, though the sibling start/end are Unix seconds.
    const query: Record<string, string | boolean | undefined> = { modified_since: input.modifiedSince };
    for (const flag of JOB_STATE_FLAGS) if (input[flag]) query[flag] = true;
    const data = await sauce<{ jobs?: unknown[] } | undefined>(ctx, `/v2/builds/${src}/${id(input.buildId)}/jobs/`, { query });
    return { buildId: input.buildId, source: src, count: countOf(data, 'jobs'), jobs: data?.jobs ?? [] };
  },
});

export const buildForJobCommand = saucelabsArea.command({
  path: ['saucelabs', 'job', 'build'],
  description: 'Get the build a job belongs to',
  input: z.object({ jobId: z.string().describe('Job ID'), source }),
  writes: false,
  args: [{ name: 'job-id', field: 'jobId', description: 'Job ID', required: true }],
  options: [sourceOption],
  examples: [{ jobId: 'abc12345' }, { jobId: 'abc12345', source: 'RDC' }],
  run: async (input, ctx) => sauce(ctx, `/v2/builds/${sourceOf(input.source)}/jobs/${id(input.jobId)}/build/`),
});

export const buildCommands = [buildListCommand, buildGetCommand, buildJobsCommand, buildForJobCommand];
