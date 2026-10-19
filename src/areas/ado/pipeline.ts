import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { sleep } from '../../core/rest.js';
import { allowWriteField } from '../../core/run.js';
import { adoArea } from './area.js';
import { API, ado, adoAll, adoText, cursorField, exampleCursor, limitField, pageOf, pageOptions, projectPath, toInt, where, type AdoContext, type PageRequest, type Where } from './client.js';
import { listBuilds } from './repo.js';
import { AT, intText } from './work.js';

/**
 * Pipelines, which this API still calls build definitions: list and read
 * them, queue a run and optionally wait for it, list, read and cancel runs,
 * and read their logs. A cancelled build is marked "cancelling", the
 * present continuous of every decision taken by committee.
 */

const W = { ...AT, allowWrite: true };
const idArg = (description: string) => ({ name: 'id', field: 'id', description });

/** The default 600 s wait plus a minute of slack; a longer --timeout still stops here unless TOIL_TIMEOUT_MS says otherwise. */
const RUN_TIME_LIMIT_MS = 660_000;

interface Build {
  id: number;
  buildNumber?: string;
  status: string;
  result?: string;
  [key: string]: unknown;
}

const buildPath = (w: Where, id: number) => `${projectPath(w)}/_apis/build/builds/${id}?api-version=${API}`;
const getBuild = (ctx: AdoContext, w: Where, id: number) => ado<Build>(ctx, buildPath(w, id));
const listDefinitions = (ctx: AdoContext, w: Where, page: PageRequest = {}) =>
  adoAll<{ id: number; name: string }>(ctx, `${projectPath(w)}/_apis/build/definitions`, { 'api-version': API }, `Azure DevOps pipelines in ${w.project}`, page);

export const pipelineListCommand = adoArea.command({
  path: ['ado', 'pipeline', 'list'],
  description: 'List pipeline definitions',
  toolDescription: 'Lists every pipeline (build definition) in the project, following continuation tokens to the end. With limit, returns at most that many; pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({ limit: limitField('pipelines'), cursor: cursorField }),
  writes: false,
  options: pageOptions('pipelines'),
  examples: [AT, { ...AT, limit: 1 }, { ...AT, limit: 1, cursor: exampleCursor('abc12345') }],
  run: async (input, ctx) => {
    const page = pageOf(input);
    return listDefinitions(ctx, where(ctx), page);
  },
});

export const pipelineGetCommand = adoArea.command({
  path: ['ado', 'pipeline', 'get'],
  description: 'Get a pipeline definition by ID',
  toolDescription: 'Returns one pipeline (build definition) by id.',
  input: z.object({ id: intText.describe('Pipeline definition ID') }),
  writes: false,
  args: [idArg('Pipeline definition ID')],
  examples: [{ ...AT, id: '5' }],
  run: async (input, ctx) => {
    const w = where(ctx);
    return ado(ctx, `${projectPath(w)}/_apis/build/definitions/${toInt(input.id)}?api-version=${API}`);
  },
});

const TIMEOUT = 'Max wait time in seconds (default 600) (default: "600")';
const POLL = 'Poll interval in seconds (default 10) (default: "10")';

export const pipelineRunCommand = adoArea.command({
  path: ['ado', 'pipeline', 'run'],
  description: 'Queue a pipeline run',
  toolDescription:
    'Queues a run of a pipeline (definition id), on a branch (a short name gets refs/heads/) with parameters as key=value, and returns the build. With wait, polls until it completes; a result other than succeeded still returns the build, with an ADO_BUILD_NOT_SUCCEEDED warning (the CLI exits 1).',
  input: z.object({
    id: intText.describe('Pipeline definition ID'),
    branch: z.string().optional().describe('Source branch (e.g. refs/heads/main or main)'),
    parameter: z.array(z.string()).optional().describe('Build parameter as k=v (repeatable)'),
    wait: z.boolean().optional().describe('Wait for the run to complete before returning'),
    timeout: intText.optional().describe(TIMEOUT),
    poll: intText.optional().describe(POLL),
    ...allowWriteField,
  }),
  writes: true,
  timeLimitMs: RUN_TIME_LIMIT_MS,
  args: [idArg('Pipeline definition ID')],
  options: [
    { flags: '--branch <ref>', field: 'branch', description: 'Source branch (e.g. refs/heads/main or main)' },
    { flags: '--parameter <k=v>', field: 'parameter', description: 'Build parameter (repeatable) (default: [])' },
    { flags: '--wait', field: 'wait', description: 'Wait for the run to complete before returning' },
    { flags: '--timeout <s>', field: 'timeout', description: TIMEOUT },
    { flags: '--poll <s>', field: 'poll', description: POLL },
  ],
  examples: [
    { ...W, id: '5' },
    { ...W, id: '5', branch: 'main', parameter: ['env=staging', 'debug=true'] },
    { ...W, id: '6', branch: 'refs/heads/release', wait: true, timeout: '60', poll: '1' },
  ],
  run: async (input, ctx) => {
    const w = where(ctx);
    const sourceBranch = input.branch ? (input.branch.startsWith('refs/') ? input.branch : `refs/heads/${input.branch}`) : undefined;
    const raw = input.parameter ?? [];
    for (const p of raw) {
      if (!p.includes('=')) throw new ToilError('INVALID_INPUT', `Invalid --parameter "${p}". Expected format: key=value`, { fix: 'Pass each parameter as key=value, e.g. --parameter env=staging.' });
    }
    const parameters = raw.length > 0 ? JSON.stringify(Object.fromEntries(raw.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]))) : undefined;
    const body = { definition: { id: toInt(input.id) }, ...(sourceBranch ? { sourceBranch } : {}), ...(parameters ? { parameters } : {}) };
    let build = await ado<Build>(ctx, `${projectPath(w)}/_apis/build/builds?api-version=${API}`, { method: 'POST', json: body });
    ctx.debug(`Queued build #${build.id} (${String(build.buildNumber)}) — status: ${build.status}`);
    if (!input.wait) return build;

    // Checked after the build was queued, as specified, so the fix says it may be running.
    const timeoutSec = toInt(input.timeout, '600');
    const pollSec = toInt(input.poll, '10');
    const queued = `Build #${build.id} was queued and may still run. Check it with toil ado run get ${build.id} before queueing it again.`;
    if (isNaN(timeoutSec) || timeoutSec <= 0) throw new ToilError('INVALID_INPUT', `Invalid --timeout "${String(input.timeout ?? '600')}". Expected a positive number of seconds.`, { fix: queued });
    if (isNaN(pollSec) || pollSec <= 0) throw new ToilError('INVALID_INPUT', `Invalid --poll "${String(input.poll ?? '10')}". Expected a positive number of seconds.`, { fix: queued });

    ctx.debug(`Waiting for build #${build.id} to complete (timeout ${timeoutSec}s, poll ${pollSec}s)...`);
    const deadline = Date.now() + timeoutSec * 1000;
    const id = build.id;
    build = await getBuild(ctx, w, id);
    while (build.status !== 'completed') {
      if (Date.now() >= deadline) {
        throw new ToilError('TIMEOUT', `Timed out waiting for completion after ${timeoutSec}s`, { fix: `Build #${id} is still running. Check it later with toil ado run get ${id}.` });
      }
      ctx.debug(`Waiting ${pollSec}s...`);
      await sleep(pollSec * 1000, ctx.signal);
      build = await getBuild(ctx, w, id);
    }
    // As the contract specifies: the build as a success, and exit code 1. The warning is additive.
    if (build.result && build.result !== 'succeeded') {
      ctx.setExitCode(1);
      ctx.warn({ code: 'ADO_BUILD_NOT_SUCCEEDED', message: `Build #${id} finished with result ${build.result}.` });
    }
    return build;
  },
});

const TOP = 'Maximum results (default: "50")';

export const pipelineListRunsCommand = adoArea.command({
  path: ['ado', 'run', 'list'],
  description: 'List pipeline runs',
  toolDescription:
    "Lists the project's builds (runs), newest first as the server orders them, optionally for one pipeline (definition id, or name looked up in the pipeline list), a branch name as given, and a status. top caps the count (50 by default); top 0 lists every run. limit instead pages: at most that many, with meta.page.nextCursor to pass as cursor for the next page (not with top).",
  input: z.object({
    definition: z.string().optional().describe('Filter by definition ID'),
    name: z.string().optional().describe('Filter by pipeline name (resolved to definition ID; use pipeline list to see names)'),
    branch: z.string().optional().describe('Filter by branch name'),
    status: z.string().optional().describe('Filter by status (inProgress|completed|cancelling|...)'),
    top: intText.optional().describe(TOP),
    limit: limitField('runs'),
    cursor: cursorField,
  }),
  writes: false,
  options: [
    { flags: '--definition <id>', field: 'definition', description: 'Filter by definition ID' },
    { flags: '--name <name>', field: 'name', description: 'Filter by pipeline name (resolved to definition ID; use pipeline list to see names)' },
    { flags: '--branch <ref>', field: 'branch', description: 'Filter by branch name' },
    { flags: '--status <filter>', field: 'status', description: 'Filter by status (inProgress|completed|cancelling|...)' },
    { flags: '--top <n>', field: 'top', description: TOP },
    ...pageOptions('runs'),
  ],
  examples: [
    AT,
    { ...AT, definition: '5', branch: 'refs/heads/main', status: 'completed', top: '10' },
    { ...AT, name: 'imagile-api-ci' },
    { ...AT, definition: '5', top: '0' },
    { ...AT, definition: '5', limit: 1 },
    { ...AT, limit: 1, cursor: exampleCursor('abc12345') },
  ],
  run: async (input, ctx) => {
    const page = pageOf(input);
    if (page.cap !== undefined && input.top !== undefined) {
      throw new ToilError('INVALID_INPUT', 'Cannot specify both --top and --limit. Use one or the other.', { fix: 'Pass --limit (with --cursor for later pages) to page through runs, or --top for one request of at most that many.' });
    }
    const w = where(ctx);
    if (input.definition && input.name) throw new ToilError('INVALID_INPUT', 'Cannot specify both --definition and --name. Use one or the other.', { fix: 'Pass --definition <id> or --name <pipeline>, not both.' });
    let definitionId: number | undefined;
    if (input.definition) {
      definitionId = parseInt(input.definition, 10);
      if (isNaN(definitionId)) {
        throw new ToilError('INVALID_INPUT', `--definition must be a numeric ID. Got "${input.definition}". Use --name to filter by pipeline name instead.`, { fix: 'Pass the definition id from toil ado pipeline list, or --name.' });
      }
    } else if (input.name) {
      const wanted = input.name.toLowerCase();
      const match = (await listDefinitions(ctx, w)).find((d) => d.name.toLowerCase() === wanted);
      if (!match) {
        throw new ToilError('INVALID_INPUT', `Pipeline "${input.name}" not found. Run 'toil ado pipeline list' to see available pipelines.`, { fix: 'Check the name against toil ado pipeline list; it is matched ignoring case.' });
      }
      definitionId = match.id;
    }
    // Suspected bugs (#69 items 12 and 28): the branch isn't normalised, and --top 0 lists every run.
    const filters = { definitionIds: definitionId !== undefined ? [definitionId] : undefined, branchName: input.branch, statusFilter: input.status };
    // With --limit, continuation tokens page the runs; --top's one request (default 50) is otherwise unchanged.
    return listBuilds(ctx, w, page.cap !== undefined ? { ...filters, page } : { ...filters, top: toInt(input.top, '50') });
  },
});

export const pipelineGetRunCommand = adoArea.command({
  path: ['ado', 'run', 'get'],
  description: 'Get a pipeline run by build ID',
  toolDescription: 'Returns one build (run) by id: status, result, branch, definition, times.',
  input: z.object({ id: intText.describe('Build ID') }),
  writes: false,
  args: [idArg('Build ID')],
  examples: [{ ...AT, id: '101' }],
  run: async (input, ctx) => getBuild(ctx, where(ctx), toInt(input.id)),
});

export const pipelineCancelRunCommand = adoArea.command({
  path: ['ado', 'run', 'cancel'],
  description: 'Cancel a running pipeline build',
  toolDescription: 'Asks the server to cancel a build (status cancelling) and returns it.',
  input: z.object({ id: intText.describe('Build ID'), ...allowWriteField }),
  writes: true,
  args: [idArg('Build ID')],
  examples: [{ ...W, id: '101' }],
  run: async (input, ctx) => {
    const w = where(ctx);
    return ado(ctx, buildPath(w, toInt(input.id)), { method: 'PATCH', json: { status: 'cancelling' } });
  },
});

export const pipelineLogsCommand = adoArea.command({
  path: ['ado', 'run', 'logs'],
  description: 'List or retrieve build logs (consider --output-file for large logs)',
  toolDescription: "Without logId, lists a build's logs (id, type, line count). With logId, returns that log's text as { log }. id is the run id from ado_run_list.",
  input: z.object({
    id: intText.describe('Build (run) ID — from run list or run get'),
    logId: intText.optional().describe('Specific log ID (omit to list all logs)'),
  }),
  writes: false,
  args: [{ name: 'id', field: 'id', description: 'Build (run) ID — from run list or run get' }],
  options: [{ flags: '--log-id <n>', field: 'logId', description: 'Specific log ID (omit to list all logs)' }],
  examples: [
    { ...AT, id: '101' },
    { ...AT, id: '101', logId: '3' },
  ],
  run: async (input, ctx) => {
    const raw = input.id;
    if (raw === '') throw new ToilError('INVALID_INPUT', 'The run <id> is required (build run ID from run list or run get)', { fix: 'Pass the run id: toil ado run logs <id>; toil ado run list lists them.' });
    const w = where(ctx);
    const buildId = toInt(raw);
    const logs = `${projectPath(w)}/_apis/build/builds/${buildId}/logs`;
    if (input.logId !== undefined && input.logId !== '') return { log: await adoText(ctx, `${logs}/${toInt(input.logId)}?api-version=${API}`) };
    const result = await ado<{ value?: unknown[] }>(ctx, `${logs}?api-version=${API}`);
    return result.value ?? [];
  },
});

export const pipelineCommands = [pipelineListCommand, pipelineGetCommand, pipelineRunCommand, pipelineListRunsCommand, pipelineGetRunCommand, pipelineCancelRunCommand, pipelineLogsCommand];
