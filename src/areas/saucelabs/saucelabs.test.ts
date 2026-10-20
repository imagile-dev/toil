import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../../../test/harness/cli.js';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { ACCESS_KEY, config as fixtureConfig, SAUCE, session, USER } from '../../../test/fixtures/saucelabs.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { concurrencyCommand, platformsCommand } from './account.js';
import { buildJobsCommand, buildListCommand } from './build.js';
import { parseUnixTime } from './client.js';
import { deviceListCommand } from './device.js';
import { commands } from './index.js';
import { jobDeleteCommand, jobListCommand, jobUpdateCommand } from './job.js';
import { rdcJobListCommand, rdcJobStopCommand } from './rdc-job.js';
import {
  SESSION_CREATE_LIMIT_MS,
  sessionAppiumCommand,
  sessionCreateCommand,
  sessionEndTestCommand,
  sessionInstallAppCommand,
  sessionLaunchAppCommand,
  sessionNetworkCommand,
  sessionShellCommand,
} from './session.js';
import { tunnelGetCommand, tunnelListCommand } from './tunnel.js';

/**
 * Request building and response reshaping, command by command: the exact
 * request toil sends Sauce Labs and what it makes of the answer, as the
 * command contract specifies. The parity suite proves both front doors
 * agree; this proves what they agree on. Suspected bugs (#71) are pinned
 * here, not fixed, pending the usual review by a live account.
 */

const BASIC = `Basic ${Buffer.from(`${USER}:${ACCESS_KEY}`).toString('base64')}`;
const HEADERS = { authorization: BASIC, 'content-type': 'application/json', accept: 'application/json', connection: 'close' };
const write = { allowWrite: true };

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], config: Record<string, Record<string, unknown>> = fixtureConfig) {
  const t = testContext({ config, routes });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

const ok = (body: unknown, method = 'GET'): Route => ({ method, url: /.*/, respond: { json: body } });
const noContent = (method: string): Route => ({ method, url: /.*/, respond: { status: 204 } });
const query = (url: string) => [...new URL(url).searchParams];

afterEach(() => vi.useRealTimers());

describe('auth and errors', () => {
  it('sends Basic username:accessKey with the JSON headers, and scopes concurrency to the username', async () => {
    const { envelope, calls } = await run(concurrencyCommand, {}, [ok({ concurrency: {} })]);
    expect(calls).toEqual([{ method: 'GET', url: `${SAUCE}/rest/v1.2/users/${USER}/concurrency`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({ concurrency: {} });
  });

  it('trims and encodes the username and ids in paths', async () => {
    const config = { saucelabs: { ...fixtureConfig.saucelabs, username: ' imagile qa ' } };
    const { calls } = await run(tunnelGetCommand, { tunnelId: ' a/b ' }, [ok({})], config);
    expect(calls[0]!.url).toBe(`${SAUCE}/rest/v1/imagile%20qa/tunnels/a%2Fb`);
  });

  it('encodes an id with path, query or fragment syntax in it as one path segment, for a write and a read, and refuses a dot segment inside one', async () => {
    const del = await run(jobDeleteCommand, { jobId: 'a/b?c=d', ...write }, [noContent('DELETE')]);
    expect(del.calls[0]!.url).toBe(`${SAUCE}/rest/v1/${USER}/jobs/a%2Fb%3Fc%3Dd`);
    const read = await run(tunnelGetCommand, { tunnelId: 'p1#hot' }, [ok({})]);
    expect(read.calls[0]!.url).toBe(`${SAUCE}/rest/v1/${USER}/tunnels/p1%23hot`);
    const dots = await run(jobDeleteCommand, { jobId: 'x/../y', ...write }, []);
    expect(dots.envelope.error?.code).toBe('INVALID_INPUT');
    expect(dots.calls).toEqual([]);
  });

  it('an id of .. is refused before any request, so a delete cannot climb out of the job path (core bound requests.path)', async () => {
    const { envelope, calls } = await run(jobDeleteCommand, { jobId: '..', ...write }, []);
    expect(calls).toEqual([]);
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect((await run(tunnelGetCommand, { tunnelId: ' . ' }, [])).envelope.error?.code).toBe('INVALID_INPUT');
  });

  it("reads a FastAPI-style { detail } body as the error message", async () => {
    const { envelope } = await run(sessionCreateCommand, write, [{ method: 'POST', url: /.*/, respond: { status: 409, json: { type: 'about:blank', title: 'Conflict', detail: 'Concurrency limit reached' } } }]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'Concurrency limit reached' });
  });

  it('a 401 is AUTH, with where to find the access key and the variables that set it', async () => {
    const { envelope } = await run(concurrencyCommand, {}, [{ url: /.*/, respond: { status: 401, text: '' } }]);
    expect(envelope.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('User settings → Access key') });
    expect(envelope.error?.fix).toContain('TOIL_SAUCELABS_ACCESS_KEY, or SAUCE_ACCESS_KEY');
  });

  it('a missing access key is CONFIG_INVALID before any request, naming its variable', async () => {
    const config = { saucelabs: { baseUrl: SAUCE, username: USER } };
    const { envelope, calls } = await run(concurrencyCommand, {}, [], config);
    expect(calls).toEqual([]);
    expect(envelope.error).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_SAUCELABS_ACCESS_KEY') });
  });

  it('keeps the deletes off MCP: job delete, rdc-job delete, session delete and tunnel stop', () => {
    expect(commands.filter((c) => c.mcp === false).map((c) => c.path.join(' ')).sort()).toEqual(['saucelabs job delete', 'saucelabs rdc-job delete', 'saucelabs session delete', 'saucelabs tunnel stop']);
  });

  it('only session create declares a time limit above the default, an hour, to cover --wait', () => {
    expect(commands.filter((c) => c.timeLimitMs !== undefined).map((c) => c.path.join(' '))).toEqual(['saucelabs session create']);
    expect(SESSION_CREATE_LIMIT_MS).toBe(3_600_000);
  });
});

describe('input parsing', () => {
  it('refuses a negative or fractional integer before any request, with the wording the contract specifies', async () => {
    const { envelope, calls } = await run(jobListCommand, { limit: '-1' }, []);
    expect(calls).toEqual([]);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Invalid --limit "-1". Expected a non-negative integer.' });
    expect((await run(jobListCommand, { offset: 2.5 }, [])).envelope.error?.message).toBe('Invalid --offset "2.5". Expected a non-negative integer.');
  });

  it('matches enums ignoring case and sends the canonical spelling', async () => {
    const { calls } = await run(deviceListCommand, { os: 'ios', type: 'Phone', name: 'iPhone.*' }, [ok([])]);
    expect(query(calls[0]!.url)).toEqual([['deviceName', 'iPhone.*'], ['os', 'IOS'], ['deviceType', 'PHONE']]);
    const bad = await run(deviceListCommand, { os: 'windows' }, []);
    expect(bad.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Invalid --os "windows". Expected one of: ANDROID, IOS.' });
  });

  it('a time is Unix seconds as-is, or a date floored to seconds; anything else is refused', () => {
    expect(parseUnixTime('1790000000', '--from')).toBe(1790000000);
    expect(parseUnixTime('2026-09-01T00:00:00Z', '--from')).toBe(Date.UTC(2026, 8, 1) / 1000);
    expect(parseUnixTime('2026-09-01T00:00:00.999Z', '--from')).toBe(Date.UTC(2026, 8, 1) / 1000);
    expect(() => parseUnixTime('last tuesday', '--from')).toThrow('Invalid --from "last tuesday". Expected Unix seconds or an ISO 8601 date such as 2026-09-01T00:00:00Z.');
  });

  it('suspected bug (#71 item 4): a date-time without an offset is read in local time, a date alone in UTC', () => {
    expect(parseUnixTime('2026-09-01', '--from')).toBe(Date.UTC(2026, 8, 1) / 1000);
    expect(parseUnixTime('2026-09-01T00:00', '--from')).toBe(Math.floor(new Date(2026, 8, 1).getTime() / 1000));
  });
});

describe('jobs', () => {
  it('job list: under the username, with converted timestamps; count is the array length', async () => {
    const { envelope, calls } = await run(jobListCommand, { limit: '5', from: '2026-09-01T00:00:00Z' }, [ok([{ id: 'j1' }, { id: 'j2' }])]);
    expect(calls[0]!.url).toBe(`${SAUCE}/rest/v1/${USER}/jobs?limit=5&from=${Date.UTC(2026, 8, 1) / 1000}`);
    expect(envelope.data).toEqual({ count: 2, jobs: [{ id: 'j1' }, { id: 'j2' }] });
  });

  it('job list: count drops out when the answer is not an array', async () => {
    const { envelope } = await run(jobListCommand, {}, [ok({ unexpected: true })]);
    expect(envelope.data).toEqual({ count: undefined, jobs: { unexpected: true } });
  });

  it('job update: PUTs only the fields passed, tags split on commas, visibility canonical', async () => {
    const { calls } = await run(jobUpdateCommand, { jobId: 'job-1', failed: true, tags: ['smoke,email', ' ui '], public: 'TEAM', ...write }, [ok({}, 'PUT')]);
    expect(calls[0]!).toMatchObject({ method: 'PUT', url: `${SAUCE}/rest/v1/${USER}/jobs/job-1`, headers: HEADERS });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ tags: ['smoke', 'email', 'ui'], passed: false, public: 'team' });
  });

  it('job update: nothing to change, or --passed with --failed, is refused before any request', async () => {
    const empty = await run(jobUpdateCommand, { jobId: 'job-1', ...write }, []);
    expect(empty.calls).toEqual([]);
    expect(empty.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Nothing to update. Pass at least one of --name, --build, --tags, --passed/--failed, --public.' });
    const both = await run(jobUpdateCommand, { jobId: 'job-1', passed: true, failed: true, ...write }, []);
    expect(both.calls).toEqual([]);
    expect(both.envelope.error?.message).toBe('Pass only one of --passed or --failed.');
  });

  it('job delete: a 204 is reported as { jobId, deleted: true }, with the id as typed', async () => {
    const { envelope, calls } = await run(jobDeleteCommand, { jobId: 'job-1', ...write }, [noContent('DELETE')]);
    expect(calls[0]!.method).toBe('DELETE');
    expect(envelope.data).toEqual({ jobId: 'job-1', deleted: true });
  });

  it('rdc-job stop: PUT, then { jobId, stopped: true }', async () => {
    const { envelope, calls } = await run(rdcJobStopCommand, { jobId: 'rdc1', ...write }, [noContent('PUT')]);
    expect(calls[0]!.url).toBe(`${SAUCE}/v1/rdc/jobs/rdc1/stop`);
    expect(envelope.data).toEqual({ jobId: 'rdc1', stopped: true });
  });

  it('suspected bug (#71 item 6): rdc-job --offset is sent as typed, though Sauce documents it as defaulting to 1', async () => {
    const { calls } = await run(rdcJobListCommand, { limit: '3', offset: '0', live: true }, [ok({ entities: [] })]);
    expect(calls[0]!.url).toBe(`${SAUCE}/v1/rdc/jobs?limit=3&offset=0&type=LIVE`);
  });

  it('writes are gated: no --allow-write, no request', async () => {
    const { envelope, calls } = await run(jobDeleteCommand, { jobId: 'job-1' }, []);
    expect(calls).toEqual([]);
    expect(envelope.error?.code).toBe('WRITE_DISABLED');
  });
});

describe('builds', () => {
  it('build list: repeated status keys first, then the rest, on the trailing-slash path', async () => {
    const { envelope, calls } = await run(buildListCommand, { source: 'RDC', status: ['failed,error', 'running'], limit: '10', sort: 'DESC' }, [ok({ builds: [{ id: 'b1' }] })]);
    expect(calls[0]!.url).toBe(`${SAUCE}/v2/builds/rdc/?status=failed&status=error&status=running&limit=10&sort=desc`);
    expect(envelope.data).toEqual({ source: 'rdc', count: 1, builds: [{ id: 'b1' }] });
  });

  it('build list: defaults to vdc; no builds key is an empty list with count undefined', async () => {
    const { envelope, calls } = await run(buildListCommand, {}, [ok({})]);
    expect(calls[0]!.url).toBe(`${SAUCE}/v2/builds/vdc/`);
    expect(envelope.data).toEqual({ source: 'vdc', count: undefined, builds: [] });
  });

  it('build list: an unknown status is refused before any request', async () => {
    const { envelope, calls } = await run(buildListCommand, { status: ['flaky'] }, []);
    expect(calls).toEqual([]);
    expect(envelope.error?.message).toBe('Invalid --status "flaky". Expected one of: running, error, failed, complete, success.');
  });

  it('suspected bug (#71 item 3): --sort keeps the help "Sort by creation time", which Sauce documents as alphabetical', () => {
    expect(buildListCommand.options?.find((o) => o.field === 'sort')?.description).toBe('Sort by creation time: asc or desc');
  });

  it('build jobs: state flags become =true; suspected bug (#71 item 5): --modified-since is sent raw', async () => {
    const { envelope, calls } = await run(buildJobsCommand, { buildId: 'b1', failed: true, errored: true, modifiedSince: '2026-09-01T00:00:00Z' }, [ok({ jobs: [] })]);
    expect(calls[0]!.url).toBe(`${SAUCE}/v2/builds/vdc/b1/jobs/?modified_since=2026-09-01T00%3A00%3A00Z&failed=true&errored=true`);
    expect(envelope.data).toEqual({ buildId: 'b1', source: 'vdc', count: 0, jobs: [] });
  });
});

describe('sessions', () => {
  it('session create: device query in lower case, tunnel and duration; returns the PENDING session', async () => {
    const { envelope, calls } = await run(
      sessionCreateCommand,
      { deviceName: 'Samsung Galaxy.*', os: 'Android', tunnelName: 'sc-proxy', duration: 'PT30M', ...write },
      [ok(session('PENDING'), 'POST')],
    );
    expect(calls[0]!).toMatchObject({ method: 'POST', url: `${SAUCE}/rdc/v2/sessions` });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ device: { deviceName: 'Samsung Galaxy.*', os: 'android' }, configuration: { tunnel: { name: 'sc-proxy' }, sessionDuration: 'PT30M' } });
    expect(envelope.data).toEqual(session('PENDING'));
  });

  it('session create: --tunnel-owner needs --tunnel-name, and a bad --timeout is refused even without --wait', async () => {
    const owner = await run(sessionCreateCommand, { tunnelOwner: 'imagile-qa', ...write }, []);
    expect(owner.calls).toEqual([]);
    expect(owner.envelope.error?.message).toBe('--tunnel-owner requires --tunnel-name.');
    expect((await run(sessionCreateCommand, { timeout: 'soon', ...write }, [])).envelope.error?.message).toBe('Invalid --timeout "soon". Expected a non-negative integer.');
  });

  function pollingRoutes(states: string[]): Route[] {
    let n = 0;
    return [
      ok(session('PENDING'), 'POST'),
      { method: 'GET', url: `${SAUCE}/rdc/v2/sessions/abc12345`, respond: () => ({ json: session(states[Math.min(n++, states.length - 1)]!) }) },
    ];
  }

  it('session create --wait: polls every 5 s until ACTIVE', async () => {
    vi.useFakeTimers();
    const t = testContext({ config: fixtureConfig, routes: pollingRoutes(['CREATING', 'ACTIVE']) });
    const done = execute(sessionCreateCommand, { wait: true, ...write }, t.context);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(t.http.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    const envelope = await done;
    expect(t.http.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST https://saucelabs.imagile.dev/rdc/v2/sessions', ...Array(2).fill('GET https://saucelabs.imagile.dev/rdc/v2/sessions/abc12345')]);
    expect(envelope.data).toEqual(session('ACTIVE'));
  });

  it('session create --wait: a closed or errored session fails at once', async () => {
    const { envelope } = await run(sessionCreateCommand, { wait: true, ...write }, pollingRoutes(['ERRORED']));
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'Session abc12345 ended in state ERRORED before becoming ACTIVE.' });
  });

  it('suspected bug (#71 item 7): --wait gives up when the next poll would pass the timeout, so --timeout 3 fails after one poll', async () => {
    const { envelope, calls } = await run(sessionCreateCommand, { wait: true, timeout: '3', ...write }, pollingRoutes(['PENDING']));
    expect(calls).toHaveLength(2);
    expect(envelope.error).toMatchObject({
      code: 'TIMEOUT',
      message: 'Session abc12345 still PENDING after 3s. It keeps starting in the background — check it with: toil saucelabs session get abc12345',
    });
  });

  it('session shell: posts adbShellCommand and returns { sessionId, command, stdout }', async () => {
    const { envelope, calls } = await run(sessionShellCommand, { sessionId: 's1', command: 'getprop ro.build.version.release', ...write }, [ok({ stdout: '14\n' }, 'POST')]);
    expect(calls[0]!.url).toBe(`${SAUCE}/rdc/v2/sessions/s1/device/executeShellCommand`);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ adbShellCommand: 'getprop ro.build.version.release' });
    expect(envelope.data).toEqual({ sessionId: 's1', command: 'getprop ro.build.version.release', stdout: '14\n' });
  });

  it('session install-app: instrumentation is on unless --no-instrumentation, on the CLI as over MCP', async () => {
    const plain = await run(sessionInstallAppCommand, { sessionId: 's1', app: 'storage:filename=imagile.apk', ...write }, [ok({}, 'POST')]);
    expect(JSON.parse(plain.calls[0]!.body!)).toEqual({ app: 'storage:filename=imagile.apk', enableInstrumentation: true, launchAfterInstall: false });
    const off = await run(sessionInstallAppCommand, { sessionId: 's1', app: 'storage:abc12345', instrumentation: false, launch: true, ...write }, [ok({}, 'POST')]);
    expect(JSON.parse(off.calls[0]!.body!)).toEqual({ app: 'storage:abc12345', enableInstrumentation: false, launchAfterInstall: true });

    const t = testContext({ config: fixtureConfig, routes: [ok({}, 'POST')] });
    const cli = await runCli(['saucelabs', 'session', 'install-app', 's1', 'storage:abc12345', '--no-instrumentation', '--allow-write'], { commands, context: t.context });
    expect(cli.envelope?.ok, cli.stdout).toBe(true);
    expect(JSON.parse(t.http.calls[0]!.body!)).toEqual({ app: 'storage:abc12345', enableInstrumentation: false, launchAfterInstall: false });
  });

  it('session launch-app: exactly one of --bundle-id or --package-name, and --activity needs --package-name', async () => {
    const none = await run(sessionLaunchAppCommand, { sessionId: 's1', ...write }, []);
    expect(none.envelope.error?.message).toBe('Pass exactly one of --bundle-id (iOS) or --package-name (Android).');
    const activity = await run(sessionLaunchAppCommand, { sessionId: 's1', bundleId: 'dev.imagile.app', activity: '.Main', ...write }, []);
    expect(activity.envelope.error?.message).toBe('--activity requires --package-name.');
    expect([...none.calls, ...activity.calls]).toEqual([]);
    const { envelope, calls } = await run(sessionLaunchAppCommand, { sessionId: 's1', packageName: 'com.google.android.gm', activity: '.ConversationListActivityGmail', ...write }, [noContent('POST')]);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ packageName: 'com.google.android.gm', activityName: '.ConversationListActivityGmail' });
    expect(envelope.data).toEqual({ sessionId: 's1', packageName: 'com.google.android.gm', activityName: '.ConversationListActivityGmail', launched: true });
  });

  it('session network: explicit conditions, the range checks, one mode only, and --reset as a DELETE', async () => {
    const { calls } = await run(sessionNetworkCommand, { sessionId: 's1', download: '1500', latency: '300', ...write }, [ok({}, 'POST')]);
    expect(calls[0]!.url).toBe(`${SAUCE}/rdc/v2/sessions/s1/network/condition`);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ networkConditions: { downloadSpeed: 1500, latency: 300 } });
    expect((await run(sessionNetworkCommand, { sessionId: 's1', loss: '101', ...write }, [])).envelope.error?.message).toBe('--loss must be between 0 and 100.');
    expect((await run(sessionNetworkCommand, { sessionId: 's1', profile: '4G-fast', latency: '10', ...write }, [])).envelope.error?.message).toBe(
      'Pass exactly one of --profile, --reset, or explicit conditions (--download/--upload/--latency/--loss).',
    );
    const reset = await run(sessionNetworkCommand, { sessionId: 's1', reset: true, ...write }, [noContent('DELETE')]);
    expect(reset.calls[0]!).toMatchObject({ method: 'DELETE', url: `${SAUCE}/rdc/v2/sessions/s1/network/condition` });
    expect(reset.envelope.data).toEqual({ sessionId: 's1', reset: true });
  });

  it('suspected bug (#71 item 8): end-test sends the result as { status }', async () => {
    const { calls } = await run(sessionEndTestCommand, { sessionId: 's1', passed: true, ...write }, [ok({}, 'POST')]);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ status: 'passed' });
    const bare = await run(sessionEndTestCommand, { sessionId: 's1', ...write }, [ok({}, 'POST')]);
    expect(JSON.parse(bare.calls[0]!.body!)).toEqual({});
  });

  it('session appium: GET without --start, POST with it; --appium-version needs --start; gated even to read', async () => {
    expect((await run(sessionAppiumCommand, { sessionId: 's1', ...write }, [ok({})])).calls[0]!.method).toBe('GET');
    const start = await run(sessionAppiumCommand, { sessionId: 's1', start: true, ...write }, [ok({}, 'POST')]);
    expect(start.calls[0]!.body).toBe('{}');
    expect((await run(sessionAppiumCommand, { sessionId: 's1', appiumVersion: '2.11.0', ...write }, [])).envelope.error?.message).toBe('--appium-version requires --start.');
    expect((await run(sessionAppiumCommand, { sessionId: 's1' }, [])).envelope.error?.code).toBe('WRITE_DISABLED');
  });
});

describe('tunnels and platforms', () => {
  it('tunnel list: always full=true; --all adds all=true', async () => {
    const { envelope, calls } = await run(tunnelListCommand, {}, [ok([{ id: 't1' }])]);
    expect(calls[0]!.url).toBe(`${SAUCE}/rest/v1/${USER}/tunnels?full=true`);
    expect(envelope.data).toEqual({ count: 1, tunnels: [{ id: 't1' }] });
  });

  it('suspected bug (#71 item 1): tunnel list --all passes an owner-keyed object through as tunnels, with no count', async () => {
    const byOwner = { imagile: [{ id: 't1' }], 'imagile-qa': [{ id: 't2' }] };
    const { envelope, calls } = await run(tunnelListCommand, { all: true }, [ok(byOwner)]);
    expect(calls[0]!.url).toBe(`${SAUCE}/rest/v1/${USER}/tunnels?full=true&all=true`);
    expect(envelope.data).toEqual({ count: undefined, tunnels: byOwner });
  });

  it('suspected bug (#71 item 2): tunnel get is always filed under your own username', async () => {
    const { calls } = await run(tunnelGetCommand, { tunnelId: 'shared-by-teammate' }, [ok({})]);
    expect(calls[0]!.url).toBe(`${SAUCE}/rest/v1/${USER}/tunnels/shared-by-teammate`);
  });

  it('platforms: defaults to all and wraps the list as { api, count, platforms }', async () => {
    const { envelope, calls } = await run(platformsCommand, {}, [ok([{ os: 'Linux' }])]);
    expect(calls[0]!.url).toBe(`${SAUCE}/rest/v1/info/platforms/all`);
    expect(envelope.data).toEqual({ api: 'all', count: 1, platforms: [{ os: 'Linux' }] });
  });
});
