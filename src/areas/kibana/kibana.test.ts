import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { config as fixtureConfig, dataViews, exportNdjson, find, KIBANA, rule, spaces, status } from '../../../test/fixtures/kibana.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { spacePath } from './client.js';
import { dashboardsExportCommand, dashboardsListCommand } from './dashboards.js';
import { dataViewsListCommand } from './data-views.js';
import { rulesGetCommand, rulesListCommand } from './rules.js';
import { spacesListCommand } from './spaces.js';
import { statusCommand } from './status.js';

/**
 * Request building and response reshaping, command by command, against
 * Elastic's documented Kibana API: the exact request toil sends, what it makes
 * of the answer, and whose key went with it. The #81 notes are settled here,
 * each test saying which way it went, so the audit trail doubles as a test plan.
 */

const HEADERS = { authorization: 'ApiKey test-api-key', 'kbn-xsrf': 'true', 'content-type': 'application/json', accept: 'application/json', connection: 'close' };
const NDJSON_HEADERS = { ...HEADERS, accept: 'application/x-ndjson, application/json' };
const ES_KEY = { elasticsearch: { apiKey: 'es-encoded-key' } };

// The resolved config's own types live in core, which area code may not import; the test borrows the harness's.
type ResolvedConfig = ReturnType<typeof testContext>['context']['config'];
type Settings = Record<string, unknown>;
type Config = Record<string, Settings>;

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], config: Config | ResolvedConfig = fixtureConfig) {
  const resolved = 'connections' in config ? (config as ResolvedConfig) : undefined;
  const t = testContext({ config: resolved ? {} : (config as Config), routes });
  const envelope = await execute(def, input, resolved ? { ...t.context, config: resolved } : t.context);
  return { envelope, calls: t.http.calls };
}

const any = (respond: Route['respond'], method = 'GET'): Route => ({ method, url: /.*/, respond });
const json = (body: unknown, status = 200, method = 'GET'): Route => any({ status, json: body }, method);
const text = (body: string, status = 200, method = 'GET', contentType = 'text/html'): Route => any({ status, text: body, headers: { 'content-type': contentType } }, method);
const kibanaOnly = (extra: Settings = {}): Config => ({ kibana: { baseUrl: KIBANA, ...extra } });

describe('status', () => {
  it('GETs /api/status with the ApiKey and kbn-xsrf headers and maps the 8.x level/summary', async () => {
    const { envelope, calls } = await run(statusCommand, {}, [json(status)]);
    expect(calls).toEqual([{ method: 'GET', url: `${KIBANA}/api/status`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({ name: 'kb', uuid: status.uuid, version: '8.15.0', buildFlavor: 'default', status: 'available', summary: 'All services and plugins are available' });
  });

  it('falls back to the 7.x state/title', async () => {
    const { envelope } = await run(statusCommand, {}, [json({ version: { number: '7.17.0' }, status: { overall: { state: 'green', title: 'Green' } } })]);
    expect(envelope.data).toMatchObject({ version: '7.17.0', status: 'green', summary: 'Green' });
  });

  it('reports an unhealthy Kibana from its 503 body instead of failing', async () => {
    const body = { version: { number: '8.15.0' }, status: { overall: { level: 'unavailable', summary: 'Elasticsearch is unavailable' } } };
    const { envelope } = await run(statusCommand, {}, [json(body, 503)]);
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toMatchObject({ status: 'unavailable', summary: 'Elasticsearch is unavailable' });
  });

  it("keeps a 503 without Kibana's status (a proxy's) as an HTTP error with its message", async () => {
    const { envelope } = await run(statusCommand, {}, [json({ message: 'Service unavailable' }, 503)]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'Service unavailable', details: { status: 503 } });
  });

  it('keeps a non-JSON 503 as HTTP 503', async () => {
    const { envelope } = await run(statusCommand, {}, [text('<html>upstream down</html>', 503)]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'HTTP 503 Service Unavailable' });
  });

  it('a 200 that is not JSON says baseUrl may not point at Kibana, quoting the start of the body', async () => {
    const { envelope } = await run(statusCommand, {}, [text('<html>sign in</html>')]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'Kibana returned a non-JSON response (is baseUrl pointing at Kibana?): <html>sign in</html>' });
  });

  it('#81 note kept: a 429 is handed back at once, without the retry the JSON calls get', async () => {
    const { envelope, calls } = await run(statusCommand, {}, [json({ message: 'Too many requests' }, 429)]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'Too many requests' });
    expect(calls).toHaveLength(1);
  });

  it('keeps a base URL context path', async () => {
    const { calls } = await run(statusCommand, {}, [json(status)], { kibana: { ...fixtureConfig.kibana, baseUrl: `${KIBANA}/kibana` } });
    expect(calls[0]!.url).toBe(`${KIBANA}/kibana/api/status`);
  });
});

describe('the API key', () => {
  it("the default connection takes TOIL_ELASTICSEARCH_API_KEY when it has no key, sends it only to Kibana's host, and says so", async () => {
    const { envelope, calls } = await run(statusCommand, {}, [json(status)], { ...kibanaOnly(), ...ES_KEY });
    expect(calls.map((c) => [c.url, c.headers.authorization])).toEqual([[`${KIBANA}/api/status`, 'ApiKey es-encoded-key']]);
    expect(envelope.meta.context?.shared).toEqual({ apiKey: { area: 'elasticsearch', connection: 'elasticsearch', source: 'env', via: 'env-fallback' } });
  });

  it("Kibana's own key wins over the Elasticsearch one", async () => {
    const { envelope, calls } = await run(statusCommand, {}, [json(status)], { ...fixtureConfig, ...ES_KEY });
    expect(calls[0]!.headers.authorization).toBe('ApiKey test-api-key');
    expect(envelope.meta.context).not.toHaveProperty('shared');
  });

  it('a non-default connection borrows only when paired with apiKeyFrom', async () => {
    const cfg = (pairing: Settings): ResolvedConfig => {
      const connections: ResolvedConfig['connections'] = {
        'kb-a': { area: 'kibana', baseUrl: KIBANA },
        'kb-b': { area: 'kibana', baseUrl: KIBANA, ...pairing },
        'es-prod': { area: 'elasticsearch', baseUrl: 'https://elasticsearch.imagile.dev', apiKey: 'es-encoded-key' },
      };
      const sources: ResolvedConfig['sources'] = {};
      for (const [name, conn] of Object.entries(connections)) for (const key of Object.keys(conn)) sources[`${name}.${key}`] = 'env';
      return { connections, defaults: { kibana: { connection: 'kb-a' }, elasticsearch: { connection: 'es-prod' } }, sources, files: { global: '/home/test/.toil/config.json' }, warnings: [] };
    };
    const unpaired = await run(statusCommand, { connection: 'kb-b' }, [json(status)], cfg({}));
    expect(unpaired.calls).toEqual([]);
    expect(unpaired.envelope.error).toMatchObject({ code: 'NOT_CONFIGURED', message: 'Kibana credentials not configured on connection "kb-b".' });
    expect(unpaired.envelope.error?.fix).toContain('apiKeyFrom');

    const paired = await run(statusCommand, { connection: 'kb-b' }, [json(status)], cfg({ apiKeyFrom: 'es-prod' }));
    expect(paired.calls[0]!.headers.authorization).toBe('ApiKey es-encoded-key');
    expect(paired.envelope.meta.context?.shared).toEqual({ apiKey: { area: 'elasticsearch', connection: 'es-prod', source: 'env', via: 'pairing' } });

    const rejected = await run(spacesListCommand, { connection: 'kb-b' }, [json({ message: 'Unauthorized' }, 401)], cfg({ apiKeyFrom: 'es-prod' }));
    expect(rejected.envelope.error).toMatchObject({
      code: 'AUTH',
      message: 'Unauthorized (sent the shared Elasticsearch API key from connection es-prod; if it lacks Kibana privileges, give connection kb-b its own key: toil connections login kb-b, or TOIL_KIBANA_API_KEY for the default connection)',
    });
    expect(rejected.envelope.error?.message).not.toContain('kibana.apiKey');
  });

  it('with no key at all, nothing is sent and the error names both ways to set one', async () => {
    const { envelope, calls } = await run(spacesListCommand, {}, [json(spaces)], kibanaOnly());
    expect(calls).toEqual([]);
    expect(envelope.error).toMatchObject({ code: 'NOT_CONFIGURED', fix: expect.stringContaining('TOIL_KIBANA_API_KEY') });
    expect(envelope.error?.fix).toContain('apiKeyFrom');
  });

  it('a 403 on the shared Elasticsearch key says which key was sent', async () => {
    const { envelope } = await run(spacesListCommand, {}, [json({ statusCode: 403, error: 'Forbidden', message: 'Unauthorized' }, 403)], { ...kibanaOnly(), ...ES_KEY });
    expect(envelope.error).toMatchObject({
      code: 'AUTH',
      message: 'Unauthorized (sent the shared Elasticsearch API key from connection elasticsearch; if it lacks Kibana privileges, give connection kibana its own key: toil connections login kibana, or TOIL_KIBANA_API_KEY for the default connection)',
      fix: expect.stringContaining('Stack Management → API keys'),
    });
  });

  it("a 403 on Kibana's own key carries Kibana's message alone", async () => {
    const { envelope } = await run(spacesListCommand, {}, [json({ message: 'Unauthorized' }, 403)]);
    expect(envelope.error).toMatchObject({ code: 'AUTH', message: 'Unauthorized' });
  });

  it('with no Kibana connection at all, the error says the base URL is missing', async () => {
    const { envelope } = await run(statusCommand, {}, [], {});
    expect(envelope.error).toMatchObject({ code: 'NOT_CONFIGURED', message: 'Kibana baseUrl not configured.' });
  });
});

describe('space list', () => {
  it('GETs /api/spaces/space, never space-prefixed, and keeps four fields per space', async () => {
    const { envelope, calls } = await run(spacesListCommand, {}, [json([...spaces, { id: 'bare', name: 'Bare' }])], { kibana: { ...fixtureConfig.kibana, space: 'ops' } });
    expect(calls).toEqual([{ method: 'GET', url: `${KIBANA}/api/spaces/space`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({
      count: 3,
      spaces: [
        { id: 'default', name: 'Default', description: 'This is your default space!', disabledFeatures: [] },
        { id: 'ops', name: 'Ops', description: 'Operations dashboards', disabledFeatures: ['dev_tools'] },
        { id: 'bare', name: 'Bare', disabledFeatures: [] },
      ],
    });
  });
});

describe('dashboard list', () => {
  it('GETs one page of _find for dashboards in the default space, echoing the paging', async () => {
    const { envelope, calls } = await run(dashboardsListCommand, {}, [json(find(1, 100))]);
    expect(calls).toEqual([{ method: 'GET', url: `${KIBANA}/api/saved_objects/_find?type=dashboard&page=1&per_page=100`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toMatchObject({ space: 'default', total: 2, page: 1, perPage: 100, count: 2 });
    expect((envelope.data as { dashboards: unknown[] }).dashboards[0]).toEqual({ id: 'abc12345', title: 'Payments', description: 'Card and transfer volumes', updatedAt: '2026-10-01T00:00:00Z' });
  });

  it("searches titles in the connection's space, and an empty description is left out", async () => {
    const body = find(1, 100);
    body.saved_objects[0]!.attributes.description = '';
    const { envelope, calls } = await run(dashboardsListCommand, { search: 'pay*' }, [json(body)], { kibana: { ...fixtureConfig.kibana, space: 'ops' } });
    expect(calls[0]!.url).toBe(`${KIBANA}/s/ops/api/saved_objects/_find?type=dashboard&search=pay*&search_fields=title&page=1&per_page=100`);
    expect(envelope.data).toMatchObject({ space: 'ops' });
    expect((envelope.data as { dashboards: Array<Record<string, unknown>> }).dashboards[0]!.description).toBeUndefined();
    expect(envelope.meta.context?.inputs?.space).toEqual({ value: 'ops', source: 'connection' });
  });

  it('--space default overrides the configured space and leaves the path unprefixed; another id is encoded', async () => {
    const configured = { kibana: { ...fixtureConfig.kibana, space: 'ops' } };
    expect((await run(dashboardsListCommand, { space: 'default' }, [json(find(1, 100))], configured)).calls[0]!.url).toContain(`${KIBANA}/api/saved_objects/_find?`);
    expect((await run(dashboardsListCommand, { space: 'team a/b' }, [json(find(1, 100))])).calls[0]!.url).toContain(`${KIBANA}/s/team%20a%2Fb/api/saved_objects/_find?`);
  });

  it('refuses a --page or --page-size that is not a positive integer, before any request', async () => {
    for (const [input, flag] of [[{ page: '0' }, '--page'], [{ pageSize: '1.5' }, '--page-size'], [{ pageSize: 'ten' }, '--page-size']] as const) {
      const { envelope, calls } = await run(dashboardsListCommand, input, []);
      expect(calls).toEqual([]);
      expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: `${flag} must be a positive integer.` });
    }
  });

  it('takes --page and --page-size as numbers over MCP too', async () => {
    const { calls } = await run(dashboardsListCommand, { page: 3, pageSize: 10 }, [json(find(3, 10))]);
    expect(calls[0]!.url).toBe(`${KIBANA}/api/saved_objects/_find?type=dashboard&page=3&per_page=10`);
  });
});

describe('dashboard export', () => {
  it('POSTs the ids with deep references, reads NDJSON, and splits off the export details line', async () => {
    const { envelope, calls } = await run(dashboardsExportCommand, { id: ['abc12345'] }, [text(exportNdjson, 200, 'POST', 'application/ndjson')]);
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `${KIBANA}/api/saved_objects/_export`,
        headers: NDJSON_HEADERS,
        body: JSON.stringify({ objects: [{ type: 'dashboard', id: 'abc12345' }], includeReferencesDeep: true }),
      },
    ]);
    expect(envelope.data).toMatchObject({ space: 'default', count: 2, exportDetails: { exportedCount: 2, missingRefCount: 0 } });
    expect((envelope.data as { objects: unknown[] }).objects).toEqual([
      { id: 'dv1', type: 'index-pattern', attributes: { title: 'logs-*' } },
      { id: 'abc12345', type: 'dashboard', attributes: { title: 'Payments' } },
    ]);
  });

  it('--no-references turns off deep references; CRLF lines and blank lines are fine', async () => {
    const { envelope, calls } = await run(dashboardsExportCommand, { id: ['a', 'b'], references: false, space: 'ops' }, [text('{"id":"a","type":"dashboard"}\r\n\r\n{"exportedCount":1}\r\n', 200, 'POST')]);
    expect(calls[0]!.url).toBe(`${KIBANA}/s/ops/api/saved_objects/_export`);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ objects: [{ type: 'dashboard', id: 'a' }, { type: 'dashboard', id: 'b' }], includeReferencesDeep: false });
    expect(envelope.data).toEqual({ space: 'ops', count: 1, exportDetails: { exportedCount: 1 }, objects: [{ id: 'a', type: 'dashboard' }] });
  });

  it("surfaces a non-OK export with Kibana's message", async () => {
    const { envelope } = await run(dashboardsExportCommand, { id: ['x'] }, [json({ statusCode: 400, message: 'Bad Request: unknown id' }, 400, 'POST')]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'Bad Request: unknown id' });
  });

  it('rejects a body that is not NDJSON (a proxy sign-in page) with a clear error', async () => {
    const { envelope } = await run(dashboardsExportCommand, { id: ['x'] }, [text('<html>login</html>', 200, 'POST')]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'Kibana returned a non-JSON response (is baseUrl pointing at Kibana?): <html>login</html>' });
  });

  it('#81 note kept: a 429 is not retried on export', async () => {
    const { calls } = await run(dashboardsExportCommand, { id: ['x'] }, [json({ message: 'slow down' }, 429, 'POST')]);
    expect(calls).toHaveLength(1);
  });

  it('needs at least one id', async () => {
    const { envelope, calls } = await run(dashboardsExportCommand, { id: [] }, []);
    expect(calls).toEqual([]);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('data-view list', () => {
  it('GETs /api/data_views and names a view with no name by its pattern', async () => {
    const { envelope, calls } = await run(dataViewsListCommand, {}, [json(dataViews)]);
    expect(calls).toEqual([{ method: 'GET', url: `${KIBANA}/api/data_views`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({
      space: 'default',
      count: 2,
      dataViews: [
        { id: 'dv1', name: 'Logs', pattern: 'logs-*', namespaces: ['default'] },
        { id: 'dv2', name: 'metrics-*', pattern: 'metrics-*', namespaces: ['ops'] },
      ],
    });
  });

  it('an answer with no data_view is an empty list', async () => {
    expect((await run(dataViewsListCommand, { space: 'ops' }, [json({})])).envelope.data).toEqual({ space: 'ops', count: 0, dataViews: [] });
  });

  it('#81 note: on Kibana 7.x the endpoint does not exist, so it is NOT_FOUND (a version floor, not a bug)', async () => {
    const { envelope } = await run(dataViewsListCommand, {}, [json({ statusCode: 404, error: 'Not Found', message: 'Not Found' }, 404)]);
    expect(envelope.error).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('rule list and rule get', () => {
  it('list GETs one page of _find, searching names, and flattens each rule', async () => {
    const { envelope, calls } = await run(rulesListCommand, { search: 'High*', pageSize: '20' }, [json({ page: 1, per_page: 20, total: 1, data: [rule] })]);
    expect(calls).toEqual([{ method: 'GET', url: `${KIBANA}/api/alerting/rules/_find?search=High*&search_fields=name&page=1&per_page=20`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({
      space: 'default',
      total: 1,
      page: 1,
      perPage: 20,
      count: 1,
      rules: [
        {
          id: rule.id,
          name: 'High error rate',
          ruleTypeId: '.es-query',
          consumer: 'alerts',
          enabled: true,
          muted: false,
          tags: ['payments'],
          interval: '1m',
          executionStatus: 'error',
          lastExecutionDate: '2026-10-09T00:00:00Z',
          lastRunOutcome: 'failed',
          error: 'boom',
          nextRun: '2026-10-09T00:01:00Z',
          updatedAt: '2026-10-08T00:00:00Z',
        },
      ],
    });
  });

  it('a rule with no tags or mute flag reads as untagged and unmuted', async () => {
    const { envelope } = await run(rulesListCommand, {}, [json({ page: 1, per_page: 100, total: 1, data: [{ id: 'r', name: 'n', rule_type_id: 't', enabled: false }] })]);
    expect((envelope.data as { rules: unknown[] }).rules[0]).toEqual({ id: 'r', name: 'n', ruleTypeId: 't', enabled: false, muted: false, tags: [] });
  });

  it('list refuses a non-positive --page-size before any request', async () => {
    const { envelope, calls } = await run(rulesListCommand, { pageSize: '0' }, []);
    expect(calls).toEqual([]);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '--page-size must be a positive integer.' });
  });

  it('get encodes the id into the space path and adds params and actions', async () => {
    const { envelope, calls } = await run(rulesGetCommand, { id: 'r 1/x', space: 'ops' }, [json(rule)]);
    expect(calls).toEqual([{ method: 'GET', url: `${KIBANA}/s/ops/api/alerting/rule/r%201%2Fx`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toMatchObject({ id: rule.id, executionStatus: 'error', params: { size: 100 }, actions: [] });
  });

  it("get refuses an id of '..', which would reach another endpoint", async () => {
    const { envelope, calls } = await run(rulesGetCommand, { id: '..' }, []);
    expect(calls).toEqual([]);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('spacePath', () => {
  it('leaves the default space unprefixed and prefixes any other with /s/<id>', () => {
    expect(spacePath(undefined, '/api/data_views')).toBe('/api/data_views');
    expect(spacePath('default', '/api/data_views')).toBe('/api/data_views');
    expect(spacePath('ops-team', '/api/data_views')).toBe('/s/ops-team/api/data_views');
  });
});
