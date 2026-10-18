import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { repeatedFlag } from '../../core/schema.js';
import { githubArea } from './area.js';
import { exampleCursor, github, githubAll, githubList, isoSeconds, target, type GitHubContext } from './client.js';
import { intText, pageFields, pageOptions, parseDateOption, parseIntText, updatedSinceField, updatedSinceOption } from './input.js';

/**
 * Issues as work items: list, search, get (one or many, with issue type and
 * sub-issues) and each issue's timeline, which is where its history lives.
 * `data` is GitHub's issue as it came, apart from the PRs the issues
 * endpoint mixes in (dropped) and `sub_issues` (added on request). Every
 * pull request is an issue to GitHub, in the way every meeting is a workshop.
 *
 * Docs, checked 2026-10-18:
 * https://docs.github.com/en/rest/issues/issues (list, get; `since`, `type`, the `pull_request` key),
 * https://docs.github.com/en/rest/issues/sub-issues, https://docs.github.com/en/rest/search/search
 * (`/search/issues`, 1,000 results at most) and https://docs.github.com/en/rest/issues/timeline.
 */

/** GitHub serves the first 1,000 results of a search and refuses the page past them. */
const SEARCH_MAX = 1000;
/** Issue numbers one get-issue call takes, and how many it fetches at once. */
const MAX_NUMBERS = 100;
const CONCURRENCY = 4;

interface Issue {
  number: number;
  pull_request?: unknown;
  [key: string]: unknown;
}

const since = (value: string | undefined) => (value === undefined ? undefined : isoSeconds(parseDateOption('--updated-since', value)));

export const listIssuesCommand = githubArea.command({
  path: ['github', 'list-issues'],
  description: 'List issues in a repository (pull requests left out)',
  toolDescription:
    'Lists the issues in a repository as GitHub returns them, with issue type (type), sub-issue counts (sub_issues_summary) and parent (parent_issue_url) where the server has them. Pull requests, which the endpoint mixes in, are left out. updatedSince is GitHub\'s since parameter, for incremental reads. With limit, pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({
    state: z.enum(['open', 'closed', 'all']).optional().describe('Issue state (choices: "open", "closed", "all", default: "open")'),
    label: repeatedFlag('Only issues with this label (repeatable; all must match)'),
    assignee: z.string().optional().describe('Only issues assigned to this login (none for unassigned, * for any)'),
    type: z.string().optional().describe('Only issues of this issue type (none for no type, * for any)'),
    sort: z.enum(['created', 'updated', 'comments']).optional().describe('Sort by (choices: "created", "updated", "comments", default: "created")'),
    direction: z.enum(['asc', 'desc']).optional().describe('Sort direction (choices: "asc", "desc", default: "desc")'),
    updatedSince: updatedSinceField,
    ...pageFields('issues'),
  }),
  writes: false,
  options: [
    { flags: '--state <state>', field: 'state', description: 'Issue state (choices: "open", "closed", "all", default: "open")' },
    { flags: '--label <label>', field: 'label', description: 'Only issues with this label (repeatable; all must match)' },
    { flags: '--assignee <login>', field: 'assignee', description: 'Only issues assigned to this login (none for unassigned, * for any)' },
    { flags: '--type <type>', field: 'type', description: 'Only issues of this issue type (none for no type, * for any)' },
    { flags: '--sort <field>', field: 'sort', description: 'Sort by (choices: "created", "updated", "comments", default: "created")' },
    { flags: '--direction <dir>', field: 'direction', description: 'Sort direction (choices: "asc", "desc", default: "desc")' },
    updatedSinceOption,
    ...pageOptions('issues'),
  ],
  examples: [
    { owner: 'imagile', repo: 'toil-probe' },
    { owner: 'imagile', repo: 'toil-probe', state: 'all', label: ['bug', 'area/api'], assignee: 'octo-dev', type: 'Bug', sort: 'updated', direction: 'asc', updatedSince: '2025-01-01T00:00:00Z' },
    { owner: 'imagile', repo: 'toil-probe', limit: 1, cursor: exampleCursor() },
  ],
  run: async (input, ctx) => {
    const updated = since(input.updatedSince);
    const { owner, repo } = target(ctx);
    return githubList<Issue>(
      ctx,
      `/repos/${owner}/${repo}/issues`,
      `GitHub issues in ${owner}/${repo}`,
      {
        state: input.state ?? 'open',
        ...(input.label?.length ? { labels: input.label.join(',') } : {}),
        ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.sort ? { sort: input.sort } : {}),
        ...(input.direction ? { direction: input.direction } : {}),
        ...(updated ? { since: updated } : {}),
      },
      // GitHub marks a pull request with a pull_request key; list-prs is where those live.
      { limit: input.limit, cursor: input.cursor, keep: (item) => item.pull_request === undefined },
    );
  },
});

export const searchIssuesCommand = githubArea.command({
  path: ['github', 'search-issues'],
  description: 'Search issues with GitHub search syntax (is:issue is added)',
  toolDescription:
    'Searches issues across everything the token can see, with GitHub search syntax (repo:imagile/toil-probe label:bug state:open). toil adds is:issue, and updated:>=<updatedSince> when updatedSince is given; --owner and --repo are not added, so scope the query yourself. GitHub serves the first 1,000 results only, and toil warns when there were more. With limit, pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({
    query: z.string().min(1).describe('GitHub search query, e.g. "repo:imagile/toil-probe label:bug"'),
    sort: z.enum(['comments', 'reactions', 'interactions', 'created', 'updated']).optional().describe('Sort by (choices: "comments", "reactions", "interactions", "created", "updated", default: best match)'),
    order: z.enum(['asc', 'desc']).optional().describe('Sort order, with --sort (choices: "asc", "desc", default: "desc")'),
    updatedSince: updatedSinceField,
    ...pageFields('issues'),
  }),
  writes: false,
  options: [
    { flags: '--query <q>', field: 'query', description: 'GitHub search query, e.g. "repo:imagile/toil-probe label:bug"' },
    { flags: '--sort <field>', field: 'sort', description: 'Sort by (choices: "comments", "reactions", "interactions", "created", "updated", default: best match)' },
    { flags: '--order <order>', field: 'order', description: 'Sort order, with --sort (choices: "asc", "desc", default: "desc")' },
    updatedSinceOption,
    ...pageOptions('issues'),
  ],
  examples: [
    { query: 'repo:imagile/toil-probe label:bug' },
    { query: 'org:imagile is:issue state:open', sort: 'updated', order: 'asc', updatedSince: '2025-01-31', limit: 1 },
    // --owner and --repo are accepted, as on every github command, and never added to the query.
    { owner: 'imagile', repo: 'unused', query: 'label:bug', limit: 1, cursor: exampleCursor() },
  ],
  run: async (input, ctx) => {
    const updated = since(input.updatedSince);
    // The query names its own scope, so a remote or default repo is never used or reported.
    delete ctx.resolved.inputs?.owner;
    delete ctx.resolved.inputs?.repo;
    const q = [input.query, ...(/(^|\s)is:issue(\s|$)/i.test(input.query) ? [] : ['is:issue']), ...(updated ? [`updated:>=${updated}`] : [])].join(' ');
    let total: number | undefined;
    let incomplete = false;
    const items = await githubList<Issue>(
      ctx,
      '/search/issues',
      `GitHub issues matching "${q}"`,
      { q, ...(input.sort ? { sort: input.sort } : {}), ...(input.order ? { order: input.order } : {}) },
      {
        limit: input.limit,
        cursor: input.cursor,
        items: (body) => {
          const page = (body ?? {}) as { total_count?: unknown; incomplete_results?: unknown; items?: unknown };
          if (typeof page.total_count === 'number') total = page.total_count;
          if (page.incomplete_results === true) incomplete = true;
          return Array.isArray(page.items) ? (page.items as Issue[]) : [];
        },
        // Past the 1,000th result GitHub answers 422, so the page after it is an empty one, with a warning.
        before: (page) => (page > SEARCH_MAX / 100 ? { items: [] } : undefined),
      },
    );
    if (total !== undefined && total > SEARCH_MAX) {
      ctx.warn({ code: 'GITHUB_SEARCH_CAPPED', message: `GitHub found ${total} issues but serves only the first ${SEARCH_MAX} of a search; narrow the query (by repo, label or --updated-since) to read the rest.` });
    }
    if (incomplete) ctx.warn({ code: 'GITHUB_SEARCH_INCOMPLETE', message: 'GitHub timed out part of this search (incomplete_results), so some matching issues may be missing; run it again or narrow the query.' });
    return items;
  },
});

/** One issue, with its sub-issues when asked. A 404 on sub_issues for an issue that exists means the server has no sub-issues API. */
async function getIssue(ctx: GitHubContext, owner: string, repo: string, number: number, subIssues: boolean): Promise<Issue> {
  const issue = await github<Issue>(ctx, `/repos/${owner}/${repo}/issues/${number}`);
  if (!subIssues) return issue;
  try {
    return { ...issue, sub_issues: await githubAll(ctx, `/repos/${owner}/${repo}/issues/${number}/sub_issues`, `sub-issues of GitHub issue #${number}`) };
  } catch (err) {
    if (err instanceof ToilError && err.code === 'NOT_FOUND') {
      throw new ToilError('UNSUPPORTED', `This GitHub server has no sub-issues API: GET /repos/${owner}/${repo}/issues/${number}/sub_issues answered 404 for an issue that exists.`, {
        fix: 'Leave out --sub-issues, or use a GitHub Enterprise Server release that has sub-issues. sub_issues_summary and parent_issue_url, where the server sends them, are on the issue already.',
      });
    }
    throw err;
  }
}

export const getIssueCommand = githubArea.command({
  path: ['github', 'get-issue'],
  description: 'Get one or more issues by number (repeat --number), with issue type and, on request, sub-issues',
  toolDescription:
    'Gets issues by number as GitHub returns them: type is the issue type, sub_issues_summary the sub-issue counts and parent_issue_url the parent, where the server has them. subIssues adds sub_issues, the full list. One number returns the issue itself; several (up to 100) return { issues, errors }, fetched four at a time, where a number GitHub can\'t find goes into errors instead of failing the call.',
  input: z.object({
    number: z.array(intText).min(1).describe('Issue number (repeatable, up to 100)'),
    subIssues: z.boolean().optional().describe('Add sub_issues, the list of each issue\'s sub-issues (one more request per issue)'),
  }),
  writes: false,
  options: [
    { flags: '--number <n>', field: 'number', description: 'Issue number (repeatable, up to 100)' },
    { flags: '--sub-issues', field: 'subIssues', description: 'Add sub_issues, the list of each issue\'s sub-issues (one more request per issue)' },
  ],
  examples: [
    { owner: 'imagile', repo: 'toil-probe', number: ['9'] },
    { owner: 'imagile', repo: 'toil-probe', number: ['9', '10'], subIssues: true },
  ],
  run: async (input, ctx) => {
    if (input.number.length > MAX_NUMBERS) {
      throw new ToilError('INVALID_INPUT', `get-issue takes up to ${MAX_NUMBERS} issue numbers in one call, not ${input.number.length}.`, { fix: `Split the numbers into calls of ${MAX_NUMBERS} or fewer.` });
    }
    const { owner, repo } = target(ctx);
    const numbers = input.number.map(parseIntText);
    const subIssues = input.subIssues === true;
    if (numbers.length === 1) return getIssue(ctx, owner, repo, numbers[0]!, subIssues);

    const results: Array<{ issue: Issue } | { error: { number: number; code: string; message: string } }> = new Array(numbers.length);
    let next = 0;
    const worker = async () => {
      while (next < numbers.length) {
        const i = next++;
        const number = numbers[i]!;
        try {
          results[i] = { issue: await getIssue(ctx, owner, repo, number, subIssues) };
        } catch (err) {
          // An issue that isn't there, or is gone (410), is that item's problem; anything else
          // (the token, the network, a timeout, no sub-issues API) is the whole call's.
          if (err instanceof ToilError && (err.code === 'NOT_FOUND' || err.code === 'HTTP')) results[i] = { error: { number, code: err.code, message: err.message } };
          else throw err;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, numbers.length) }, worker));
    const issues = results.flatMap((r) => ('issue' in r ? [r.issue] : []));
    const errors = results.flatMap((r) => ('error' in r ? [r.error] : []));
    if (errors.length > 0) ctx.warn({ code: 'GITHUB_ISSUES_FAILED', message: `${errors.length} of ${numbers.length} issues couldn't be read; see data.errors.` });
    return { issues, errors };
  },
});

export const issueEventsCommand = githubArea.command({
  path: ['github', 'issue-events'],
  description: "List an issue's timeline: state changes, labels, assignments, issue types, sub-issues, cross-references and comments",
  toolDescription:
    "Lists an issue's timeline events oldest first, as GitHub returns them, each with event, actor and created_at: closed and reopened (with state_reason), labeled, assigned, issue_type_added/changed, sub_issue_added, cross-referenced (the PRs that mention it), commented and more. With limit, pass meta.page.nextCursor as cursor for the next page.",
  input: z.object({ number: intText.describe('Issue number'), ...pageFields('events') }),
  writes: false,
  options: [{ flags: '--number <n>', field: 'number', description: 'Issue number' }, ...pageOptions('events')],
  examples: [
    { owner: 'imagile', repo: 'toil-probe', number: '9' },
    { owner: 'imagile', repo: 'toil-probe', number: '9', limit: 1, cursor: exampleCursor() },
  ],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const number = parseIntText(input.number);
    return githubList(ctx, `/repos/${owner}/${repo}/issues/${number}/timeline`, `timeline of GitHub issue #${number}`, {}, { limit: input.limit, cursor: input.cursor });
  },
});

export const workItemCommands = [listIssuesCommand, searchIssuesCommand, getIssueCommand, issueEventsCommand];
