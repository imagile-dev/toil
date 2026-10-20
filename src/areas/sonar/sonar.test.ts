import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { config as fixtureConfig, hotspot, hotspotsPage, issuesPage, PROJECT, projectsPage, qualityGate, SONAR, sonarIssue, sonarProject } from '../../../test/fixtures/sonar.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { hotspotsCommand, issuesCommand, measuresCommand, projectsCommand, qualityGateCommand } from './commands.js';

/**
 * Request building and response reshaping, command by command: the exact
 * request toil sends and what it makes of the answer. The parity suite proves
 * both front doors agree; this proves what they agree on is what the command
 * contract specifies sending SonarQube Server. Suspected bugs (#92) are
 * pinned here, not fixed, which is the usual fate of a reported defect.
 */

const HEADERS = { authorization: 'Bearer test-token', 'content-type': 'application/json', accept: 'application/json', connection: 'close' };

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], config: Record<string, Record<string, unknown>> = fixtureConfig) {
  const t = testContext({ config, routes });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

const ok = (body: unknown): Route => ({ url: /.*/, respond: { json: body } });

describe('quality-gate get', () => {
  it('GETs project_status with projectKey and the token, and returns the server body as data', async () => {
    const { envelope, calls } = await run(qualityGateCommand, { project: PROJECT }, [ok(qualityGate)]);
    expect(calls).toEqual([{ method: 'GET', url: `${SONAR}/api/qualitygates/project_status?projectKey=${PROJECT}`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual(qualityGate);
  });

  it('sends branch only when given, and keeps a base URL context path', async () => {
    const config = { sonar: { ...fixtureConfig.sonar, baseUrl: `${SONAR}/sonarqube` } };
    const { calls } = await run(qualityGateCommand, { project: PROJECT, branch: 'release-1.2' }, [ok(qualityGate)], config);
    expect(calls[0]!.url).toBe(`${SONAR}/sonarqube/api/qualitygates/project_status?projectKey=${PROJECT}&branch=release-1.2`);
  });

  it('takes the project from the connection (defaults.sonar.project) and says so in meta.context', async () => {
    const config = { sonar: { ...fixtureConfig.sonar, project: 'from-defaults' } };
    const { envelope, calls } = await run(qualityGateCommand, {}, [ok(qualityGate)], config);
    expect(calls[0]!.url).toBe(`${SONAR}/api/qualitygates/project_status?projectKey=from-defaults`);
    expect(envelope.meta.context?.inputs?.project).toEqual({ value: 'from-defaults', source: 'connection' });
  });

  it('fails with the contract\'s specified message, before any request, when there is no project', async () => {
    const { envelope, calls } = await run(qualityGateCommand, {}, []);
    expect(calls).toEqual([]);
    expect(envelope.error).toMatchObject({
      code: 'INVALID_INPUT',
      message: 'No project specified. Use --project or set defaults.sonar.project in config.',
      fix: expect.stringContaining('TOIL_SONAR_PROJECT'),
    });
  });

  it("a 401 is AUTH with where to make a token; a 400 carries SonarQube's errors[].msg joined with '; '", async () => {
    const denied = await run(qualityGateCommand, { project: PROJECT }, [{ url: /.*/, respond: { status: 401, text: '' } }]);
    expect(denied.envelope.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('My Account → Security → Generate Tokens') });
    expect(denied.envelope.error?.fix).toContain('TOIL_SONAR_TOKEN, or SONAR_TOKEN, for the default connection');
    const bad = await run(qualityGateCommand, { project: 'nope' }, [{ url: /.*/, respond: { status: 404, json: { errors: [{ msg: "Project 'nope' not found" }, { msg: 'second' }] } } }]);
    expect(bad.envelope.error).toMatchObject({ code: 'NOT_FOUND', message: "Project 'nope' not found; second" });
  });
});

describe('issue list', () => {
  it('sends componentKeys, every filter with literal commas, then p and ps, leaving unset ones out', async () => {
    const body = issuesPage([sonarIssue(1)], 1, 2, 50);
    const { envelope, calls } = await run(
      issuesCommand,
      { project: PROJECT, severities: 'BLOCKER,CRITICAL', types: 'BUG', branch: 'main', resolved: 'true', page: '2', pageSize: '50' },
      [ok(body)],
    );
    expect(calls).toEqual([
      { method: 'GET', url: `${SONAR}/api/issues/search?componentKeys=${PROJECT}&severities=BLOCKER,CRITICAL&types=BUG&branch=main&resolved=true&p=2&ps=50`, headers: HEADERS, body: undefined },
    ]);
    // Without --all, data is the server's page, paging fields and all.
    expect(envelope.data).toEqual(body);
  });

  it('defaults to p=1 and ps=100', async () => {
    const { calls } = await run(issuesCommand, { project: PROJECT }, [ok(issuesPage([], 0, 1, 100))]);
    expect(calls[0]!.url).toBe(`${SONAR}/api/issues/search?componentKeys=${PROJECT}&p=1&ps=100`);
  });

  it('suspected bug #92 item 4: --resolved anything but the exact string "true" is sent as false', async () => {
    for (const value of ['TRUE', 'yes', '1', 'false']) {
      const { calls } = await run(issuesCommand, { project: PROJECT, resolved: value }, [ok(issuesPage([], 0, 1, 100))]);
      expect(new URL(calls[0]!.url).searchParams.get('resolved'), value).toBe('false');
    }
  });

  it('suspected bug #92 item 5: --page and --page-size go through parseInt unvalidated, NaN and all', async () => {
    const { calls } = await run(issuesCommand, { project: PROJECT, page: 'abc', pageSize: '10x' }, [ok(issuesPage([], 0, 1, 100))]);
    expect(calls[0]!.url).toBe(`${SONAR}/api/issues/search?componentKeys=${PROJECT}&p=NaN&ps=10`);
    const big = await run(issuesCommand, { project: PROJECT, pageSize: 1000 }, [ok(issuesPage([], 0, 1, 100))]);
    expect(new URL(big.calls[0]!.url).searchParams.get('ps')).toBe('1000');
  });

  it('--all pages 500 at a time, ignores --page/--page-size, goes past a short page until the total, and returns a flat list', async () => {
    const routes: Route[] = [
      { path: '/api/issues/search', query: { componentKeys: PROJECT, p: '1', ps: '500' }, respond: { json: issuesPage([sonarIssue(1), sonarIssue(2)], 3, 1, 500) } },
      { path: '/api/issues/search', query: { componentKeys: PROJECT, p: '2', ps: '500' }, respond: { json: issuesPage([sonarIssue(3)], 3, 2, 500) } },
    ];
    const { envelope, calls } = await run(issuesCommand, { project: PROJECT, all: true, page: '7', pageSize: '9' }, routes);
    expect(calls.map((c) => c.url)).toEqual([`${SONAR}/api/issues/search?componentKeys=${PROJECT}&p=1&ps=500`, `${SONAR}/api/issues/search?componentKeys=${PROJECT}&p=2&ps=500`]);
    expect(envelope.data).toEqual([sonarIssue(1), sonarIssue(2), sonarIssue(3)]);
    expect(envelope.meta.page).toBeUndefined();
  });

  it('--all stops on the total without asking for an empty page, and on an empty page when the total is never reached', async () => {
    const full = Array.from({ length: 500 }, (_, i) => sonarIssue(i));
    const exact = await run(issuesCommand, { project: PROJECT, all: true }, [ok(issuesPage(full, 500, 1, 500))]);
    expect(exact.calls).toHaveLength(1);
    const short = await run(issuesCommand, { project: PROJECT, all: true }, [
      { path: '/api/issues/search', query: { componentKeys: PROJECT, p: '1', ps: '500' }, respond: { json: issuesPage([sonarIssue(1)], 9, 1, 500) } },
      { path: '/api/issues/search', query: { componentKeys: PROJECT, p: '2', ps: '500' }, respond: { json: issuesPage([], 9, 2, 500) } },
    ]);
    expect(short.calls).toHaveLength(2);
    expect(short.envelope.data).toEqual([sonarIssue(1)]);
  });

  it('suspected bug #92 item 1: --all past 10,000 results fails on the refused page and returns nothing fetched', async () => {
    let p = 0;
    const page = () => {
      p += 1;
      return p <= 20 ? { json: issuesPage(Array.from({ length: 500 }, (_, i) => sonarIssue(i)), 10_500, p, 500) } : { status: 400, json: { errors: [{ msg: 'Can return only the first 10000 results. 10500th result asked.' }] } };
    };
    const { envelope, calls } = await run(issuesCommand, { project: PROJECT, all: true }, [{ url: /.*/, respond: page }]);
    expect(calls).toHaveLength(21);
    expect(envelope.ok).toBe(false);
    expect(envelope.data).toBeNull();
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'Can return only the first 10000 results. 10500th result asked.' });
  });
});

describe('measure list', () => {
  it('sends component and the default metric list with literal commas', async () => {
    const { calls } = await run(measuresCommand, { project: PROJECT }, [ok({ component: { key: PROJECT, name: PROJECT, qualifier: 'TRK', measures: [] } })]);
    expect(calls[0]!.url).toBe(
      `${SONAR}/api/measures/component?component=${PROJECT}&metricKeys=coverage,duplicated_lines_density,bugs,vulnerabilities,code_smells,sqale_rating,reliability_rating,security_rating,ncloc`,
    );
  });

  it('sends --metrics as given, and branch only when given', async () => {
    const { calls } = await run(measuresCommand, { project: PROJECT, metrics: 'coverage,bugs', branch: 'main' }, [ok({ component: {} })]);
    expect(calls[0]!.url).toBe(`${SONAR}/api/measures/component?component=${PROJECT}&metricKeys=coverage,bugs&branch=main`);
  });
});

describe('project list', () => {
  it('suspected bug #92 item 2: lists through api/projects/search, with q, p and ps, and needs no project', async () => {
    const body = projectsPage([sonarProject(PROJECT)], 1, 1, 100);
    const { envelope, calls } = await run(projectsCommand, { query: 'imagile' }, [ok(body)]);
    expect(calls).toEqual([{ method: 'GET', url: `${SONAR}/api/projects/search?q=imagile&p=1&ps=100`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual(body);
    expect(envelope.meta.context?.inputs).toBeUndefined();
  });

  it('--all reads the total from paging.total and returns the components', async () => {
    const routes: Route[] = [
      { path: '/api/projects/search', query: { p: '1', ps: '500' }, respond: { json: projectsPage([sonarProject('a')], 2, 1, 500) } },
      { path: '/api/projects/search', query: { p: '2', ps: '500' }, respond: { json: projectsPage([sonarProject('b')], 2, 2, 500) } },
    ];
    const { envelope, calls } = await run(projectsCommand, { all: true }, routes);
    expect(calls).toHaveLength(2);
    expect(envelope.data).toEqual([sonarProject('a'), sonarProject('b')]);
  });
});

describe('hotspot list', () => {
  it('suspected bug #92 item 3: sends projectKey, status and a comma-list resolution as one value', async () => {
    const { calls } = await run(hotspotsCommand, { project: PROJECT, status: 'REVIEWED', resolution: 'FIXED,SAFE', page: 3 }, [ok(hotspotsPage([], 0, 3, 100))]);
    expect(calls[0]!.url).toBe(`${SONAR}/api/hotspots/search?projectKey=${PROJECT}&status=REVIEWED&resolution=FIXED,SAFE&p=3&ps=100`);
  });

  it('--all reads paging.total across pages and returns the hotspots', async () => {
    const routes: Route[] = [
      { path: '/api/hotspots/search', query: { projectKey: PROJECT, p: '1', ps: '500' }, respond: { json: hotspotsPage([hotspot(1)], 2, 1, 500) } },
      { path: '/api/hotspots/search', query: { projectKey: PROJECT, p: '2', ps: '500' }, respond: { json: hotspotsPage([hotspot(2)], 2, 2, 500) } },
    ];
    const { envelope, calls } = await run(hotspotsCommand, { project: PROJECT, all: true }, routes);
    expect(calls.map((c) => c.url)).toEqual([`${SONAR}/api/hotspots/search?projectKey=${PROJECT}&p=1&ps=500`, `${SONAR}/api/hotspots/search?projectKey=${PROJECT}&p=2&ps=500`]);
    expect(envelope.data).toEqual([hotspot(1), hotspot(2)]);
  });

  it('--all stops after 1,000 pages with an error naming what was paged (docs/divergences/sonar.json)', async () => {
    const endless = { paging: { pageIndex: 1, pageSize: 500, total: 1_000_000 }, hotspots: [hotspot(1)] };
    const { envelope, calls } = await run(hotspotsCommand, { project: PROJECT, all: true }, [ok(endless)]);
    expect(calls).toHaveLength(1000);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: `Paging SonarQube hotspots for ${PROJECT} didn't end after 1000 pages; toil stopped.` });
  });

  it('--all compares with the total as JavaScript coerces it: null stops after one page, "3" is 3', async () => {
    const nullTotal = await run(hotspotsCommand, { project: PROJECT, all: true }, [ok({ paging: { pageIndex: 1, pageSize: 500, total: null }, hotspots: [hotspot(1)] })]);
    expect(nullTotal.calls).toHaveLength(1);
    const text = await run(issuesCommand, { project: PROJECT, all: true }, [ok({ total: '1', issues: [sonarIssue(1)] })]);
    expect(text.calls).toHaveLength(1);
  });
});
