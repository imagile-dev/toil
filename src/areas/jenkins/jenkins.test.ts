import { describe, expect, it } from 'vitest';
import { runCli } from '../../../test/harness/cli.js';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { build, buildsTree, config as fixtureConfig, CONSOLE, JENKINS, JOB_DETAIL_TREE, JOB_TREE, jobDetail, jobs, queued, queueItem } from '../../../test/fixtures/jenkins.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { jobPath } from './client.js';
import { instanceAddCommand, instanceListCommand, instanceRemoveCommand } from './instance.js';
import { pipelineGetCommand, pipelineGetRunCommand, pipelineListCommand, pipelineListRunsCommand, pipelineLogsCommand, pipelineRunCommand } from './pipeline.js';

/**
 * The exact requests toil sends Jenkins and what it makes of the answers,
 * command by command. The parity suite proves both front doors agree; this
 * proves what they agree on is what the canonical implementation sent.
 * Suspected bugs (#80) are pinned here, not fixed, and each says so.
 */

type Settings = Record<string, unknown> & { area: string };

const basic = (user: string, token: string) => `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
const HEADERS = { authorization: basic('ci-bot', 'test-token'), 'content-type': 'application/json', accept: 'application/json', connection: 'close' };

/** Two connections, as the old `jenkins` plus one `jenkinsInstances` entry. */
const twoInstances = (): Record<string, Settings> => ({
  jenkins: { area: 'jenkins', baseUrl: JENKINS, username: 'ci-bot', apiToken: 'test-token', writes: true },
  ephemeral: { area: 'jenkins', baseUrl: 'https://jenkins-tmp.imagile.dev', username: 'tmp-user', apiToken: 'tmp-token', instance: 'Ephemeral Box' },
});

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], connections?: Record<string, Settings>) {
  const t = testContext({ config: fixtureConfig, routes });
  if (connections) {
    t.context.config.connections = connections;
    t.context.config.defaults = { jenkins: { connection: 'jenkins' } };
    t.context.config.sources = Object.fromEntries(Object.entries(connections).flatMap(([n, c]) => Object.keys(c).map((k) => [`${n}.${k}`, 'env'])));
  }
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

const json = (body: unknown): Route => ({ url: /.*/, respond: { json: body } });

describe('jobPath', () => {
  it('turns folder/job into folder/job/job, encoding each segment', () => {
    expect(jobPath('simple-job')).toBe('simple-job');
    expect(jobPath('A/B/C')).toBe('A/job/B/job/C');
    expect(jobPath('my folder/a#b')).toBe('my%20folder/job/a%23b');
  });
});

describe('pipeline list', () => {
  it('GETs /api/json with the jobs tree and Basic auth, and returns jobs', async () => {
    const { envelope, calls } = await run(pipelineListCommand, {}, [json({ jobs })]);
    expect(calls).toEqual([{ method: 'GET', url: `${JENKINS}/api/json?tree=${encodeURIComponent(JOB_TREE).replace(/%2C/g, ',')}`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual(jobs);
  });

  it('enumerates a nested folder', async () => {
    const { calls } = await run(pipelineListCommand, { folder: 'parent/child' }, [json({ jobs: [] })]);
    expect(new URL(calls[0]!.url).pathname).toBe('/job/parent/job/child/api/json');
  });

  it('keeps a base URL context path', async () => {
    const { calls } = await run(pipelineListCommand, {}, [json({ jobs: [] })], { jenkins: { ...twoInstances().jenkins!, baseUrl: `${JENKINS}/ci` } });
    expect(new URL(calls[0]!.url).pathname).toBe('/ci/api/json');
  });
});

describe('--instance', () => {
  it('uses the default connection without it', async () => {
    const { calls, envelope } = await run(pipelineListCommand, {}, [json({ jobs: [] })], twoInstances());
    expect(calls[0]!.url.startsWith(JENKINS)).toBe(true);
    expect(envelope.meta.context?.connection).toMatchObject({ value: 'jenkins', source: 'default' });
  });

  it('selects a connection by name, with its own credentials', async () => {
    const { calls, envelope } = await run(pipelineListCommand, { instance: 'ephemeral' }, [json({ jobs: [] })], twoInstances());
    expect(calls[0]!.url.startsWith('https://jenkins-tmp.imagile.dev/')).toBe(true);
    expect(calls[0]!.headers.authorization).toBe(basic('tmp-user', 'tmp-token'));
    expect(envelope.meta.context?.connection).toMatchObject({ value: 'ephemeral', source: 'input', via: 'instance' });
  });

  it('selects a connection by its instance setting, for an old name that is no connection name', async () => {
    const { calls } = await run(pipelineListCommand, { instance: 'Ephemeral Box' }, [json({ jobs: [] })], twoInstances());
    expect(calls[0]!.url.startsWith('https://jenkins-tmp.imagile.dev/')).toBe(true);
  });

  it('refuses an unknown instance loudly, before any request', async () => {
    const { calls, envelope } = await run(pipelineListCommand, { instance: 'nope' }, [], twoInstances());
    expect(calls).toEqual([]);
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect(envelope.error?.message).toContain('"nope"');
  });

  it('refuses an instance with no baseUrl, before any request', async () => {
    const broken = twoInstances();
    // A hand-edited entry with no host, as the old instance list allowed.
    delete broken.ephemeral!.baseUrl;
    const { calls, envelope } = await run(pipelineListCommand, { instance: 'ephemeral' }, [], broken);
    expect(calls).toEqual([]);
    expect(envelope.ok).toBe(false);
    expect(JSON.stringify(envelope.error)).toContain('baseUrl');
  });
});

describe('pipeline get', () => {
  it('GETs the job with the detail tree', async () => {
    const { envelope, calls } = await run(pipelineGetCommand, { name: 'platform/api-build' }, [json(jobDetail)]);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/job/platform/job/api-build/api/json');
    expect(url.searchParams.get('tree')).toBe(JOB_DETAIL_TREE);
    expect(envelope.data).toEqual(jobDetail);
  });

  it('turns a 404 into NOT_FOUND', async () => {
    const { envelope } = await run(pipelineGetCommand, { name: 'gone' }, [{ url: /.*/, respond: { status: 404, text: '<html>Not Found</html>' } }]);
    expect(envelope.error).toMatchObject({ code: 'NOT_FOUND', message: expect.stringMatching(/^HTTP 404/) });
  });
});

describe('pipeline run', () => {
  const trigger = (path: string, id: number): Route => ({ method: 'POST', path, respond: queued(id) });

  it('POSTs /build with no body and returns the queue item id from Location', async () => {
    const { envelope, calls } = await run(pipelineRunCommand, { name: 'api-build', allowWrite: true }, [trigger('/job/api-build/build', 501)]);
    expect(calls).toEqual([{ method: 'POST', url: `${JENKINS}/job/api-build/build`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({ queueItemId: 501 });
  });

  it('sends parameters to buildWithParameters in the query, splitting on the first =', async () => {
    const { calls } = await run(pipelineRunCommand, { name: 'a/b', parameter: ['BRANCH=main', 'EXPR=x=1'], allowWrite: true }, [trigger('/job/a/job/b/buildWithParameters', 7)]);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/job/a/job/b/buildWithParameters');
    expect(Object.fromEntries(url.searchParams)).toEqual({ BRANCH: 'main', EXPR: 'x=1' });
  });

  it('suspected bug #80 item 4: a run with no parameters always POSTs /build, parameterized job or not', async () => {
    const { calls } = await run(pipelineRunCommand, { name: 'parameterized', parameter: [], allowWrite: true }, [trigger('/job/parameterized/build', 9)]);
    expect(new URL(calls[0]!.url).pathname).toBe('/job/parameterized/build');
  });

  it('refuses a parameter without =, before any request', async () => {
    const { envelope, calls } = await run(pipelineRunCommand, { name: 'api-build', parameter: ['BRANCH'], allowWrite: true }, []);
    expect(calls).toEqual([]);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Invalid --parameter "BRANCH". Expected format: key=value' });
  });

  it('fails when Jenkins sends no queue Location', async () => {
    const { envelope } = await run(pipelineRunCommand, { name: 'api-build', allowWrite: true }, [{ method: 'POST', url: /.*/, respond: { status: 201, text: '' } }]);
    expect(envelope.error?.message).toBe('Build queued but Jenkins did not return a Location header — cannot track queue item');
  });

  it('with --wait, polls the queue then the build, and returns the finished build', async () => {
    const routes: Route[] = [
      trigger('/job/api-build/build', 501),
      { path: '/queue/item/501/api/json', respond: { json: queueItem(501, 42) } },
      { path: '/job/api-build/42/api/json', respond: { json: build(42) } },
    ];
    const { envelope, calls } = await run(pipelineRunCommand, { name: 'api-build', wait: true, poll: '1', allowWrite: true }, routes);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['POST /job/api-build/build', 'GET /queue/item/501/api/json', 'GET /job/api-build/42/api/json']);
    expect(envelope.data).toEqual(build(42));
    expect(envelope.meta.warnings).toBeUndefined();
  });

  it('keeps polling while the build waits in the queue and while it builds', async () => {
    let queueChecks = 0;
    let buildChecks = 0;
    const routes: Route[] = [
      trigger('/job/api-build/build', 501),
      { path: '/queue/item/501/api/json', respond: () => ({ json: ++queueChecks < 2 ? queueItem(501) : queueItem(501, 42) }) },
      { path: '/job/api-build/42/api/json', respond: () => ({ json: build(42, { building: ++buildChecks < 2, result: buildChecks < 2 ? null : 'SUCCESS' }) }) },
    ];
    const { envelope } = await run(pipelineRunCommand, { name: 'api-build', wait: true, poll: '1', allowWrite: true }, routes);
    expect([queueChecks, buildChecks]).toEqual([2, 2]);
    expect(envelope.ok).toBe(true);
  }, 10_000);

  it('returns the build as a success with a warning when the build did not succeed, as the predecessor did', async () => {
    const routes: Route[] = [
      trigger('/job/api-build/build', 501),
      { path: '/queue/item/501/api/json', respond: { json: queueItem(501, 42) } },
      { path: '/job/api-build/42/api/json', respond: { json: build(42, { result: 'FAILURE' }) } },
    ];
    const { envelope } = await run(pipelineRunCommand, { name: 'api-build', wait: true, allowWrite: true }, routes);
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual(build(42, { result: 'FAILURE' }));
    expect(envelope.meta.warnings).toEqual([{ code: 'JENKINS_BUILD_NOT_SUCCESSFUL', message: 'Build #42 of api-build finished with result FAILURE.' }]);
  });

  // Waiting for KF2: core can't yet return a success envelope with a non-zero
  // exit code. The predecessor exited 1 here; flip to it() once KF2 lands.
  it.skip('exits 1 on the CLI, with the success envelope, for a build that did not succeed (waiting for KF2)', async () => {
    const routes: Route[] = [
      trigger('/job/api-build/build', 501),
      { path: '/queue/item/501/api/json', respond: { json: queueItem(501, 42) } },
      { path: '/job/api-build/42/api/json', respond: { json: build(42, { result: 'UNSTABLE' }) } },
    ];
    const t = testContext({ config: fixtureConfig, routes });
    const result = await runCli(['jenkins', 'pipeline', 'run', '--name', 'api-build', '--wait', '--allow-write'], { commands: [pipelineRunCommand], context: t.context });
    expect(result.envelope?.ok).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('reports a build cancelled in the queue', async () => {
    const routes: Route[] = [
      trigger('/job/api-build/build', 501),
      { path: '/queue/item/501/api/json', respond: { json: { id: 501, why: null, blocked: false, buildable: false, cancelled: true } } },
    ];
    const { envelope } = await run(pipelineRunCommand, { name: 'api-build', wait: true, allowWrite: true }, routes);
    expect(envelope.error?.message).toBe('Build was cancelled while in queue');
  });

  it('times out on the queue with the predecessor\'s message', async () => {
    const routes: Route[] = [trigger('/job/api-build/build', 501), { path: '/queue/item/501/api/json', respond: { json: queueItem(501) } }];
    const { envelope } = await run(pipelineRunCommand, { name: 'api-build', wait: true, timeout: '1', poll: '1', allowWrite: true }, routes);
    expect(envelope.error).toMatchObject({ code: 'TIMEOUT', message: 'Timed out waiting for build to leave queue after 1s' });
  }, 10_000);

  it('suspected bug #80 item 2: an invalid --timeout or --poll fails only after the build was triggered', async () => {
    for (const bad of [{ timeout: 'abc' }, { poll: '0' }]) {
      const { envelope, calls } = await run(pipelineRunCommand, { name: 'api-build', wait: true, ...bad, allowWrite: true }, [trigger('/job/api-build/build', 501)]);
      expect(calls.map((c) => c.method)).toEqual(['POST']);
      expect(envelope.error?.code).toBe('INVALID_INPUT');
    }
    const { envelope } = await run(pipelineRunCommand, { name: 'api-build', wait: true, timeout: 'abc', allowWrite: true }, [trigger('/job/api-build/build', 501)]);
    expect(envelope.error?.message).toBe('Invalid --timeout "abc". Expected a positive number of seconds.');
  });

  it('ignores --timeout and --poll without --wait, however invalid', async () => {
    const { envelope } = await run(pipelineRunCommand, { name: 'api-build', timeout: 'abc', allowWrite: true }, [trigger('/job/api-build/build', 501)]);
    expect(envelope.data).toEqual({ queueItemId: 501 });
  });

  it('needs --allow-write', async () => {
    const { envelope, calls } = await run(pipelineRunCommand, { name: 'api-build' }, []);
    expect(calls).toEqual([]);
    expect(envelope.error?.code).toBe('WRITE_DISABLED');
  });
});

describe('pipeline list-runs', () => {
  it('GETs builds with the tree range, default 25, and returns them', async () => {
    const builds = [{ number: 1 }];
    const { envelope, calls } = await run(pipelineListRunsCommand, { name: 'my-folder/my-job' }, [json({ builds })]);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/job/my-folder/job/my-job/api/json');
    expect(url.searchParams.get('tree')).toBe(buildsTree(25));
    expect(envelope.data).toEqual(builds);
  });

  it('returns [] when Jenkins sends no builds', async () => {
    const { envelope } = await run(pipelineListRunsCommand, { name: 'empty' }, [json({})]);
    expect(envelope.data).toEqual([]);
  });

  it('suspected bug #80 item 3: --top above 100 asks builds{0,N}, which Jenkins caps at 100', async () => {
    const { calls } = await run(pipelineListRunsCommand, { name: 'job', top: '500' }, [json({ builds: [] })]);
    expect(new URL(calls[0]!.url).searchParams.get('tree')).toBe(buildsTree(500));
  });

  it('refuses a top that is not a positive integer, before any request', async () => {
    for (const top of ['0', '-1', 'abc']) {
      const { envelope, calls } = await run(pipelineListRunsCommand, { name: 'job', top }, []);
      expect(calls).toEqual([]);
      expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: `Invalid --top "${top}". Expected a positive integer.` });
    }
  });
});

describe('pipeline get-run and logs', () => {
  it('GETs one build with no tree', async () => {
    const { envelope, calls } = await run(pipelineGetRunCommand, { name: 'api-build', number: '42' }, [json(build(42))]);
    expect(calls).toEqual([{ method: 'GET', url: `${JENKINS}/job/api-build/42/api/json`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual(build(42));
  });

  it('suspected bug #80 item 5: --number is read with parseInt, so 12abc is 12 and -3 reaches Jenkins', async () => {
    const a = await run(pipelineGetRunCommand, { name: 'job', number: '12abc' }, [json(build(12))]);
    expect(new URL(a.calls[0]!.url).pathname).toBe('/job/job/12/api/json');
    const b = await run(pipelineGetRunCommand, { name: 'job', number: '-3' }, [{ url: /.*/, respond: { status: 404, text: '' } }]);
    expect(new URL(b.calls[0]!.url).pathname).toBe('/job/job/-3/api/json');
    expect(b.envelope.error?.code).toBe('NOT_FOUND');
  });

  it('refuses a --number that is no integer at all', async () => {
    const { envelope, calls } = await run(pipelineLogsCommand, { name: 'job', number: 'abc' }, []);
    expect(calls).toEqual([]);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Invalid --number "abc". Expected an integer.' });
  });

  it('logs GETs consoleText and returns it whole as { log }', async () => {
    const { envelope, calls } = await run(pipelineLogsCommand, { name: 'platform/api-build', number: 42 }, [{ url: /.*/, respond: { text: CONSOLE } }]);
    expect(calls).toEqual([{ method: 'GET', url: `${JENKINS}/job/platform/job/api-build/42/consoleText`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({ log: CONSOLE });
  });

  it("uses the server's JSON message for a failure", async () => {
    const { envelope } = await run(pipelineLogsCommand, { name: 'job', number: '1' }, [{ url: /.*/, respond: { status: 500, json: { message: 'boom' } } }]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'boom' });
  });

  it('turns a rejected token into AUTH with where to make a new one', async () => {
    const { envelope } = await run(pipelineLogsCommand, { name: 'job', number: '1' }, [{ url: /.*/, respond: { status: 401, text: '' } }]);
    expect(envelope.error?.code).toBe('AUTH');
    expect(envelope.error?.fix).toContain('TOIL_JENKINS_API_TOKEN');
  });
});

describe('instance commands', () => {
  it('list shows every jenkins connection with the token masked', async () => {
    const { envelope } = await run(instanceListCommand, {}, [], { ...twoInstances(), other: { area: 'sonar', baseUrl: 'https://sonar.imagile.dev', token: 'x' } });
    expect(envelope.data).toEqual({
      instances: [
        { name: 'jenkins', baseUrl: JENKINS, username: 'ci-bot', apiToken: '***' },
        { name: 'ephemeral', baseUrl: 'https://jenkins-tmp.imagile.dev', username: 'tmp-user', apiToken: '***', instance: 'Ephemeral Box' },
      ],
    });
    expect(JSON.stringify(envelope)).not.toContain('tmp-token');
  });

  it('list leaves apiToken unset when a connection has none', async () => {
    const { envelope } = await run(instanceListCommand, {}, [], { jenkins: { area: 'jenkins', baseUrl: JENKINS } });
    expect((envelope.data as { instances: Array<Record<string, unknown>> }).instances[0]!.apiToken).toBeUndefined();
  });

  it('add and remove change nothing and name the toil connections command to run', async () => {
    const add = await run(instanceAddCommand, { name: 'prod', baseUrl: 'https://jenkins.imagile.dev' }, []);
    expect(add.envelope.error?.code).toBe('INVALID_INPUT');
    expect(add.envelope.error?.fix).toContain('toil connections add prod --area jenkins');
    const remove = await run(instanceRemoveCommand, { name: 'prod' }, []);
    expect(remove.envelope.error?.fix).toContain('toil connections remove prod');
  });
});
