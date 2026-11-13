import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { fixture, GHE } from '../../../test/fixtures/github.fixture.js';
import { execute } from '../../core/run.js';
import { projectAddCommand } from './projects.js';

/**
 * `github project add`: one read of the project and the issue, then one
 * mutation, and nothing at all when the issue is already on the board. The
 * answers are the fixture's, written from the GraphQL reference and not
 * captured from a live project. Putting an issue on a board is a change
 * request that a project admin once had to file by hand.
 */

const BASE = { owner: 'imagile', repo: 'toil-probe' };
const add = { ...BASE, project: '3', number: '9', allowWrite: true };

async function run(input: Record<string, unknown>, routes: Route[] = fixture.routes!) {
  const t = testContext({ config: { github: { ...fixture.config!.github } }, routes, files: fixture.files! });
  const envelope = await execute(projectAddCommand, input, t.context);
  return { envelope, calls: t.http.calls };
}

const sentOf = (calls: Array<{ body?: string | undefined }>) => calls.map((c) => JSON.parse(c.body!) as { query: string; variables: Record<string, unknown> });
const graphql = (...answers: unknown[]): Route[] => {
  let n = 0;
  return [{ method: 'POST', url: /graphql$/, respond: () => ({ json: answers[Math.min(n++, answers.length - 1)] }) }];
};
const board = { id: 'PVT_kwDOabc123453', number: 3, title: 'Roadmap', url: `${GHE}/orgs/imagile/projects/3` };
const lookup = (nodes: unknown[] = [], over: object = {}) => ({
  data: {
    repositoryOwner: { projectV2: board },
    repository: { issueOrPullRequest: { __typename: 'Issue', id: 'I_kwDOabc12345', number: 9, title: 'Fix the probe', url: `${GHE}/imagile/toil-probe/issues/9`, projectItems: { nodes }, ...over } },
  },
});
const onBoard = (number: number, login = 'imagile') => ({ id: 'PVTI_there1234', project: { number, owner: { __typename: 'Organization', login } } });
const added = { data: { addProjectV2ItemById: { item: { id: 'PVTI_new12345' } } } };

describe('github project add', () => {
  it('reads the project and the issue in one request, then sends one mutation with the two node ids', async () => {
    const { envelope, calls } = await run(add);
    expect(envelope.ok).toBe(true);
    expect(calls).toHaveLength(2);
    const [find, set] = sentOf(calls);
    expect(find!.variables).toEqual({ owner: 'imagile', repo: 'toil-probe', number: 9, project: 3 });
    expect(find!.query).toContain('projectV2(number: $project)');
    expect(find!.query).toContain('issueOrPullRequest');
    expect(set!.query).toContain('addProjectV2ItemById');
    expect(set!.variables).toEqual({ project: 'PVT_kwDOabc123453', content: 'I_kwDOabc12345' });
    expect(envelope.data).toEqual({
      item: 'PVTI_new12345',
      content: { type: 'Issue', number: 9, title: 'Fix the probe', url: `${GHE}/imagile/toil-probe/issues/9` },
      project: { number: 3, title: 'Roadmap', owner: 'imagile', url: `${GHE}/orgs/imagile/projects/3` },
      added: true,
    });
  });

  it('sends nothing when the issue is already on that project, and says added: false with the item it has', async () => {
    const { envelope, calls } = await run(add, graphql(lookup([onBoard(8), onBoard(3)])));
    expect(calls).toHaveLength(1);
    expect(envelope.data).toMatchObject({ item: 'PVTI_there1234', added: false, project: { number: 3, owner: 'imagile' } });
  });

  it('is not fooled by a project of the same number under another owner', async () => {
    const { envelope, calls } = await run(add, graphql(lookup([onBoard(3, 'elsewhere')]), added));
    expect(calls).toHaveLength(2);
    expect(envelope.data).toMatchObject({ added: true });
  });

  it('adds a pull request the same way', async () => {
    const { envelope } = await run(add, graphql(lookup([], { __typename: 'PullRequest' }), added));
    expect(envelope.data).toMatchObject({ content: { type: 'PullRequest' }, added: true });
  });

  it('says plainly which of the project and the issue GitHub could not find, and what to check', async () => {
    const noProject = await run(add, graphql({ data: { repositoryOwner: { projectV2: null }, repository: { issueOrPullRequest: { __typename: 'Issue', id: 'I_x', number: 9, projectItems: { nodes: [] } } } } }));
    expect(noProject.envelope.error).toMatchObject({ code: 'NOT_FOUND', message: 'GitHub found no project 3 owned by imagile.', fix: expect.stringContaining('toil github project list --owner imagile') });
    expect(noProject.calls).toHaveLength(1);
    const noIssue = await run(add, graphql({ data: { repositoryOwner: { projectV2: board }, repository: { issueOrPullRequest: null } } }));
    expect(noIssue.envelope.error).toMatchObject({ code: 'NOT_FOUND', message: 'GitHub found no issue or pull request #9 in imagile/toil-probe.', fix: expect.stringContaining('--repo') });
  });

  it('a token without the project scope is AUTH on the mutation, naming what to add, as project status does', async () => {
    const denied = { data: null, errors: [{ type: 'INSUFFICIENT_SCOPES', message: 'Your token has not been granted the required scopes' }] };
    const { envelope } = await run(add, graphql(lookup(), denied));
    expect(envelope.error).toMatchObject({ code: 'AUTH', message: expect.stringContaining("can't change #9 to project 3 owned by imagile"), fix: expect.stringContaining('read:project') });
  });

  it('an answer with no item is said plainly, not as a success', async () => {
    const { envelope } = await run(add, graphql(lookup(), { data: { addProjectV2ItemById: { item: null } } }));
    expect(envelope.error).toMatchObject({ message: expect.stringContaining('returned no project item'), fix: expect.stringContaining('project items 3') });
  });

  it('wants an owner and a repository, and the write gate holds', async () => {
    const t = testContext({ config: { github: { baseUrl: fixture.config!.github!.baseUrl, token: 'ghp_abc12345', writes: true } }, routes: [] });
    expect((await execute(projectAddCommand, { project: '3', number: '9', allowWrite: true }, t.context)).error?.message).toContain('Could not determine');
    const gated = await run({ ...add, allowWrite: false });
    expect(gated.envelope.error?.code).toBe('WRITE_DISABLED');
    expect(gated.calls).toHaveLength(0);
  });
});
