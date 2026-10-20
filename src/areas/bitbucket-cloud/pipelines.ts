import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { bitbucketCloudArea } from './area.js';
import { all, bbc, exampleCursor, IN_REPO, list, repoPath, seg, type BitbucketCloudContext } from './client.js';

/**
 * Bitbucket Pipelines, which only Cloud has: list a repository's runs, read
 * one, its steps, and a step's log. Read only; starting a pipeline is a
 * decision, and decisions here go through someone with a calendar.
 */

const at = { workspace: 'imagile', repo: 'toil' };
const PIPELINE = '{abc12345-0000-0000-0000-000000000000}';
const STEP = '{abc12345-0000-0000-0000-000000000001}';

/** Without --limit, the newest 100 runs: a busy repository has thousands. */
export const PIPELINE_LIMIT = 100;

/** A pipeline or step uuid, in braces as Bitbucket writes it, whether or not they were typed. */
export function uuid(value: string, what: string): string {
  const bare = value.trim().replace(/^\{/, '').replace(/\}$/, '');
  if (!/^[0-9a-f-]{36}$/i.test(bare)) {
    throw new ToilError('INVALID_INPUT', `"${value}" isn't a ${what} uuid.`, { fix: `Pass the ${what}'s uuid, with or without braces, as pipeline list or pipeline steps returns it: ${PIPELINE}.` });
  }
  return `{${bare}}`;
}

const pipelinePath = (ctx: BitbucketCloudContext, pipeline: string) => `${repoPath(ctx)}/pipelines/${seg(uuid(pipeline, 'pipeline'))}`;
const pipelineInput = z.string().min(1).describe('Pipeline uuid, with or without braces');
const pipelineArg = { name: 'pipeline', field: 'pipeline', description: 'Pipeline uuid, with or without braces' };

export const listPipelinesCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'pipeline', 'list'],
  description: 'List pipeline runs, newest first',
  toolDescription: `Lists a repository's pipeline runs, newest first (uuid, build_number, state, target, trigger, created_on, completed_on), optionally only those for one branch. Without limit it returns the newest ${PIPELINE_LIMIT}; pass meta.page.nextCursor as cursor for more.`,
  input: z.object({
    branch: z.string().min(1).optional().describe('Only runs for this branch'),
    limit: z.number().int().positive().optional().describe(`Max total runs to return (default: ${PIPELINE_LIMIT})`),
    cursor: z.string().min(1).optional().describe('meta.page.nextCursor from the previous call, to carry on from there'),
  }),
  writes: false,
  context: IN_REPO,
  options: [
    { flags: '--branch <branch>', field: 'branch', description: 'Only runs for this branch' },
    { flags: '--limit <n>', field: 'limit', description: `Max total runs to return (default: ${PIPELINE_LIMIT})` },
    { flags: '--cursor <cursor>', field: 'cursor', description: 'meta.page.nextCursor from the previous call' },
  ],
  examples: [at, { ...at, branch: 'main', limit: 1 }, { ...at, cursor: exampleCursor('/repositories/imagile/toil/pipelines?sort=-created_on&pagelen=100&page=2') }],
  run: async (input, ctx) => {
    const query = { sort: '-created_on', ...(input.branch ? { 'target.branch': input.branch } : {}) };
    return (await list(ctx, `Bitbucket Cloud pipelines in ${ctx.context.workspace}/${ctx.context.repo}`, `${repoPath(ctx)}/pipelines`, query, { cap: input.limit ?? PIPELINE_LIMIT, cursor: input.cursor })).items;
  },
});

export const getPipelineCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'pipeline', 'get'],
  description: 'Get a pipeline run',
  toolDescription: 'Returns one pipeline run: uuid, build_number, state (with its result), target branch and commit, trigger, creator, created_on, completed_on and build_seconds_used.',
  input: z.object({ pipeline: pipelineInput }),
  writes: false,
  context: IN_REPO,
  args: [pipelineArg],
  examples: [{ ...at, pipeline: PIPELINE }],
  run: (input, ctx) => bbc(ctx, pipelinePath(ctx, input.pipeline)),
});

export const listPipelineStepsCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'pipeline', 'steps'],
  description: "List a pipeline run's steps",
  toolDescription: "Lists every step of a pipeline run (uuid, name, state with its result, started_on, completed_on, the image and the script commands). A step's uuid reads its log with bitbucket_cloud_pipeline_logs.",
  input: z.object({ pipeline: pipelineInput }),
  writes: false,
  context: IN_REPO,
  args: [pipelineArg],
  examples: [{ ...at, pipeline: 'abc12345-0000-0000-0000-000000000000' }],
  run: (input, ctx) => all(ctx, `Bitbucket Cloud steps of pipeline ${input.pipeline}`, `${pipelinePath(ctx, input.pipeline)}/steps`),
});

export const getStepLogCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'pipeline', 'logs'],
  description: "Get a pipeline step's log",
  toolDescription: "Returns { log }: the full log of one pipeline step as text. A log can be large; --select or --output-file help with that on the CLI.",
  input: z.object({ pipeline: pipelineInput, step: z.string().min(1).describe('Step uuid, with or without braces') }),
  writes: false,
  context: IN_REPO,
  args: [pipelineArg, { name: 'step', field: 'step', description: 'Step uuid, with or without braces' }],
  examples: [{ ...at, pipeline: PIPELINE, step: STEP }],
  // The log may answer with a redirect to signed storage; toil follows it with every header dropped.
  run: async (input, ctx) => ({ log: await bbc<string>(ctx, `${pipelinePath(ctx, input.pipeline)}/steps/${seg(uuid(input.step, 'step'))}/log`, { as: 'text', redirect: 'follow-without-auth' }) }),
});

export const pipelineCommands = [listPipelinesCommand, getPipelineCommand, listPipelineStepsCommand, getStepLogCommand];
