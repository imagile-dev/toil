import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { sleep } from '../../core/rest.js';
import { allowWriteField } from '../../core/run.js';
import { jenkinsArea } from './area.js';
import { getBuild, getConsoleLog, getJob, getQueueItem, listBuilds, listJobs, triggerBuild, type Build, type JenkinsContext } from './client.js';

/**
 * The six pipeline commands: jobs, builds, a build's console log, and
 * triggering a build, optionally waiting for it. Numbers are read with
 * parseInt, as the contract specifies, so `12abc` is build 12 (#80 item
 * 5). Waiting is two phases, each with its own budget: the queue, then the
 * build. Nobody likes a queue, but at least this one reports its position.
 */

const NAME_DESCRIPTION = 'Job name (use folder/job for folder-scoped jobs)';
const name = z.string().describe(NAME_DESCRIPTION);
const nameOption = { flags: '--name <job>', field: 'name', description: NAME_DESCRIPTION };

/** A number read with parseInt, per the command contract: text stays text until then. */
const intText = z.union([z.number(), z.string()]);
const parseIntText = (value: number | string | undefined, fallback: string) => parseInt(String(value ?? fallback), 10);
const shown = (value: number | string | undefined, fallback: string) => String(value ?? fallback);

const TIMEOUT_DESCRIPTION = 'Max wait time in seconds per phase (queue-wait and build-wait each get this budget; default 600) (default: "600")';
const POLL_DESCRIPTION = 'Poll interval in seconds (default 10) (default: "10")';
const TOP_DESCRIPTION = 'Maximum number of builds to return (default 25) (default: "25")';

/**
 * Two default 600 s phases plus a minute of polling slack. A longer --timeout
 * still stops here, unless TOIL_TIMEOUT_MS says otherwise.
 */
const RUN_TIME_LIMIT_MS = 1_260_000;

function buildNumberOf(value: number | string): number {
  const buildNumber = parseInt(String(value), 10);
  if (isNaN(buildNumber)) {
    throw new ToilError('INVALID_INPUT', `Invalid --number "${String(value)}". Expected an integer.`, { fix: 'Pass the build number, e.g. --number 42.' });
  }
  return buildNumber;
}

export const pipelineListCommand = jenkinsArea.command({
  path: ['jenkins', 'pipeline', 'list'],
  description: 'List all jobs on the Jenkins instance (or within a folder)',
  input: z.object({
    folder: z.string().optional().describe('Folder name to enumerate (supports nested folders: parentFolder/childFolder)'),
  }),
  writes: false,
  options: [{ flags: '--folder <name>', field: 'folder', description: 'Folder name to enumerate (supports nested folders: parentFolder/childFolder)' }],
  examples: [{}, { folder: 'platform/services' }, { instance: 'jenkins' }],
  run: async (input, ctx) => listJobs(ctx, input.folder),
});

export const pipelineGetCommand = jenkinsArea.command({
  path: ['jenkins', 'pipeline', 'get'],
  description: 'Get details for a specific job',
  input: z.object({ name }),
  writes: false,
  options: [nameOption],
  examples: [{ name: 'platform/api-build', instance: 'jenkins' }],
  run: async (input, ctx) => getJob(ctx, input.name),
});

export const pipelineRunCommand = jenkinsArea.command({
  path: ['jenkins', 'pipeline', 'run'],
  description: 'Trigger a build',
  input: z.object({
    name,
    parameter: z.array(z.string()).optional().describe('Build parameter as key=value (repeatable)'),
    wait: z.boolean().optional().describe('Wait for the build to complete before returning'),
    timeout: intText.optional().describe(TIMEOUT_DESCRIPTION),
    poll: intText.optional().describe(POLL_DESCRIPTION),
    ...allowWriteField,
  }),
  writes: true,
  timeLimitMs: RUN_TIME_LIMIT_MS,
  options: [
    nameOption,
    { flags: '--parameter <k=v>', field: 'parameter', description: 'Build parameter (repeatable) (default: [])' },
    { flags: '--wait', field: 'wait', description: 'Wait for the build to complete before returning' },
    { flags: '--timeout <s>', field: 'timeout', description: TIMEOUT_DESCRIPTION },
    { flags: '--poll <s>', field: 'poll', description: POLL_DESCRIPTION },
  ],
  examples: [
    { name: 'api-build', instance: 'jenkins', allowWrite: true },
    { name: 'platform/api-build', parameter: ['BRANCH=main', 'DEPLOY=false'], allowWrite: true },
    { name: 'api-build', wait: true, timeout: '60', poll: '1', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const raw = input.parameter ?? [];
    for (const p of raw) {
      if (!p.includes('=')) throw new ToilError('INVALID_INPUT', `Invalid --parameter "${p}". Expected format: key=value`, { fix: 'Pass each parameter as key=value, e.g. --parameter BRANCH=main.' });
    }
    const params = raw.length > 0 ? Object.fromEntries(raw.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)])) : undefined;

    const { queueItemId } = await triggerBuild(ctx, input.name, params);
    ctx.debug(`Queued build (queue item #${queueItemId})`);
    if (!input.wait) return { queueItemId };

    // Suspected bug (#80 item 2): checked only after the build was triggered.
    const timeoutSec = parseIntText(input.timeout, '600');
    const pollSec = parseIntText(input.poll, '10');
    const queued = `Build was queued as queue item #${queueItemId} and may still run. Check it with toil jenkins pipeline list-runs --name ${input.name} before triggering it again.`;
    if (isNaN(timeoutSec) || timeoutSec <= 0) {
      throw new ToilError('INVALID_INPUT', `Invalid --timeout "${shown(input.timeout, '600')}". Expected a positive number of seconds.`, { fix: queued });
    }
    if (isNaN(pollSec) || pollSec <= 0) {
      throw new ToilError('INVALID_INPUT', `Invalid --poll "${shown(input.poll, '10')}". Expected a positive number of seconds.`, { fix: queued });
    }

    ctx.debug(`Waiting for build to start (timeout ${timeoutSec}s)...`);
    const buildNumber = await waitForQueue(ctx, queueItemId, pollSec * 1000, timeoutSec * 1000, queued);
    ctx.debug(`Build #${buildNumber} started — waiting for completion...`);
    const build = await waitForBuild(ctx, input.name, buildNumber, pollSec * 1000, timeoutSec * 1000);
    // As the contract specifies: the build as a success, and exit code 1. The warning is additive.
    if (build.result !== null && build.result !== 'SUCCESS') {
      ctx.setExitCode(1);
      ctx.warn({ code: 'JENKINS_BUILD_NOT_SUCCESSFUL', message: `Build #${buildNumber} of ${input.name} finished with result ${String(build.result)}.` });
    }
    return build;
  },
});

/** Polls the queue item until it names a build number, as the contract specifies: check, then wait the full interval. */
async function waitForQueue(ctx: JenkinsContext, queueItemId: number, pollMs: number, timeoutMs: number, queued: string): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = await getQueueItem(ctx, queueItemId);
    if (item.executable?.number !== undefined) return item.executable.number;
    if (item.why === null && !item.blocked && !item.buildable) {
      throw new ToilError('HTTP', 'Build was cancelled while in queue', { fix: `Queue item #${queueItemId} was cancelled in Jenkins. Trigger the build again if it's still wanted.` });
    }
    await sleep(pollMs, ctx.signal);
  }
  throw new ToilError('TIMEOUT', `Timed out waiting for build to leave queue after ${timeoutMs / 1000}s`, { fix: `${queued} Pass a longer --timeout to wait longer.` });
}

async function waitForBuild(ctx: JenkinsContext, name: string, buildNumber: number, pollMs: number, timeoutMs: number): Promise<Build> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const build = await getBuild(ctx, name, buildNumber);
    if (!build.building) return build;
    await sleep(pollMs, ctx.signal);
  }
  throw new ToilError('TIMEOUT', `Timed out waiting for build #${buildNumber} to complete after ${timeoutMs / 1000}s`, {
    fix: `The build is still running in Jenkins. Check it later with toil jenkins pipeline get-run --name ${name} --number ${buildNumber}.`,
  });
}

export const pipelineListRunsCommand = jenkinsArea.command({
  path: ['jenkins', 'pipeline', 'list-runs'],
  description: 'List recent builds for a job',
  input: z.object({ name, top: intText.optional().describe(TOP_DESCRIPTION) }),
  writes: false,
  options: [nameOption, { flags: '--top <n>', field: 'top', description: TOP_DESCRIPTION }],
  examples: [{ name: 'api-build' }, { name: 'platform/api-build', top: '5', instance: 'jenkins' }],
  run: async (input, ctx) => {
    const top = parseIntText(input.top, '25');
    if (isNaN(top) || top <= 0) {
      throw new ToilError('INVALID_INPUT', `Invalid --top "${shown(input.top, '25')}". Expected a positive integer.`, { fix: 'Pass a whole number above zero, e.g. --top 10.' });
    }
    return listBuilds(ctx, input.name, top);
  },
});

export const pipelineGetRunCommand = jenkinsArea.command({
  path: ['jenkins', 'pipeline', 'get-run'],
  description: 'Get details for a specific build',
  input: z.object({ name, number: intText.describe('Build number') }),
  writes: false,
  options: [nameOption, { flags: '--number <n>', field: 'number', description: 'Build number' }],
  examples: [{ name: 'api-build', number: '42', instance: 'jenkins' }],
  run: async (input, ctx) => getBuild(ctx, input.name, buildNumberOf(input.number)),
});

export const pipelineLogsCommand = jenkinsArea.command({
  path: ['jenkins', 'pipeline', 'logs'],
  description: 'Fetch console log for a build (consider --output-file for large logs)',
  input: z.object({ name, number: intText.describe('Build number') }),
  writes: false,
  options: [nameOption, { flags: '--number <n>', field: 'number', description: 'Build number' }],
  examples: [{ name: 'platform/api-build', number: '42', instance: 'jenkins' }],
  run: async (input, ctx) => ({ log: await getConsoleLog(ctx, input.name, buildNumberOf(input.number)) }),
});

export const pipelineCommands = [pipelineListCommand, pipelineGetCommand, pipelineRunCommand, pipelineListRunsCommand, pipelineGetRunCommand, pipelineLogsCommand];
