import { beforeEach, describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { ALATION, column, config as fixtureConfig, document, exchanged, jobStatus, searchResult, table, validated } from '../../../test/fixtures/alation.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { clearTokenCache } from '../../core/token.js';
import { columnListCommand, datasourceGetCommand, datasourceListCommand, schemaGetCommand, schemaListCommand, searchCommand, tableGetCommand, tableListCommand } from './catalog.js';
import { documentCreateCommand, documentGetCommand, documentSchemaCommand, documentUpdateCommand, jobGetCommand } from './documents.js';
import { lifetimeFor } from './area.js';
import { tokenStatusCommand } from './token.js';

/**
 * Request building and response reshaping, command by command: the exact
 * request toil sends and what it makes of the answer, as the canonical
 * implementation had them. Suspected bugs (#77) are pinned here, not fixed,
 * in keeping with how most defects are handled once they have a ticket.
 */

const EXCHANGE = `${ALATION}/integration/v1/createAPIAccessToken/`;
const DATA_HEADERS = { accept: 'application/json', 'content-type': 'application/json', token: 'short-tok' };
const JSON_HEADERS = { accept: 'application/json', 'content-type': 'application/json' };
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

type Config = Record<string, Record<string, unknown>>;

function exchangeRoute(body: unknown = { ...exchanged, token_expires_at: inAnHour() }): Route {
  return { method: 'POST', path: '/integration/v1/createAPIAccessToken/', respond: { json: body } };
}

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], options: { config?: Config; files?: Record<string, string> } = {}) {
  const t = testContext({ config: options.config ?? fixtureConfig, routes: [exchangeRoute(), ...routes], ...(options.files ? { files: options.files } : {}) });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls, data: t.http.calls.filter((c) => c.url !== EXCHANGE) };
}

const get = (path: string, body: unknown): Route => ({ path, respond: { json: body } });

beforeEach(() => clearTokenCache());

describe('the token exchange', () => {
  it('POSTs refresh_token and user_id to createAPIAccessToken, then sends the access token as TOKEN and nothing else', async () => {
    const { envelope, calls } = await run(schemaListCommand, {}, [get('/integration/v2/schema/', [])]);
    expect(envelope.ok).toBe(true);
    expect(calls[0]).toEqual({ method: 'POST', url: EXCHANGE, headers: JSON_HEADERS, body: JSON.stringify({ refresh_token: 'refresh-abc', user_id: 102 }) });
    expect(calls[1]).toEqual({ method: 'GET', url: `${ALATION}/integration/v2/schema/?limit=100&skip=0`, headers: DATA_HEADERS, body: undefined });
    expect(JSON.stringify(calls[1])).not.toContain('refresh-abc');
  });

  it('keeps a context path and tolerates a trailing slash on baseUrl', async () => {
    const config = { alation: { ...fixtureConfig.alation, baseUrl: `${ALATION}/alation/` } };
    const { calls } = await run(schemaListCommand, {}, [get('/alation/integration/v2/schema/', [])].concat({ method: 'POST', path: '/alation/integration/v1/createAPIAccessToken/', respond: { json: exchanged } }), { config });
    expect(calls.map((c) => c.url)).toEqual([`${ALATION}/alation/integration/v1/createAPIAccessToken/`, `${ALATION}/alation/integration/v2/schema/?limit=100&skip=0`]);
  });

  it('reuses the token per connection until a minute before token_expires_at', async () => {
    const t = testContext({ config: fixtureConfig, routes: [exchangeRoute(), get('/integration/v2/schema/', [])] });
    await execute(schemaListCommand, {}, t.context);
    await execute(schemaListCommand, {}, t.context);
    expect(t.http.calls.filter((c) => c.url === EXCHANGE)).toHaveLength(1);

    // Within a minute of expiry, every request exchanges again; five minutes out, it doesn't.
    for (const [leftMs, exchanges] of [[30_000, 3], [300_000, 1]] as const) {
      clearTokenCache();
      const t2 = testContext({ config: fixtureConfig, routes: [exchangeRoute({ ...exchanged, token_expires_at: new Date(Date.now() + leftMs).toISOString() }), get('/integration/v2/schema/', [])] });
      for (let i = 0; i < 3; i++) await execute(schemaListCommand, {}, t2.context);
      expect(t2.http.calls.filter((c) => c.url === EXCHANGE), `${leftMs} ms left`).toHaveLength(exchanges);
    }
  });

  it('reports a lifetime that makes core renew exactly 60 s before expiry', () => {
    const renewsAt = (remainingMs: number) => {
      const lifetimeMs = lifetimeFor(remainingMs) * 1000;
      return lifetimeMs - Math.min(60_000, lifetimeMs / 10);
    };
    for (const remaining of [3_600_000, 600_000, 300_000, 90_000]) expect(renewsAt(remaining)).toBeCloseTo(remaining - 60_000, 6);
    expect(lifetimeFor(60_000)).toBe(0);
    expect(lifetimeFor(-5_000)).toBe(0);
  });

  it('assumes a 24-hour lifetime when token_expires_at is missing or unreadable', async () => {
    for (const expiry of [undefined, 'not a date']) {
      clearTokenCache();
      const t = testContext({ config: fixtureConfig, routes: [exchangeRoute({ api_access_token: 'short-tok', user_id: 102, ...(expiry ? { token_expires_at: expiry } : {}) }), get('/integration/v2/schema/', [])] });
      await execute(schemaListCommand, {}, t.context);
      await execute(schemaListCommand, {}, t.context);
      expect(t.http.calls.filter((c) => c.url === EXCHANGE)).toHaveLength(1);
    }
  });

  it('a refused refresh token is AUTH naming the endpoint, with the 60-day fix', async () => {
    const t = testContext({ config: fixtureConfig, routes: [{ method: 'POST', path: '/integration/v1/createAPIAccessToken/', respond: { status: 401, json: { detail: 'Invalid refresh token' } } }] });
    const envelope = await execute(schemaListCommand, {}, t.context);
    expect(envelope.error).toMatchObject({ code: 'AUTH', message: `Alation token exchange at ${EXCHANGE} failed with HTTP 401 Unauthorized: Invalid refresh token` });
    expect(envelope.error?.fix).toContain('TOIL_ALATION_REFRESH_TOKEN');
    expect(envelope.error?.fix).toContain('TOIL_ALATION_USER_ID');
    expect(envelope.error?.fix).toContain('60 days');
    expect(t.http.calls).toHaveLength(1);
  });

  it('an answer without api_access_token is AUTH', async () => {
    const t = testContext({ config: fixtureConfig, routes: [exchangeRoute({ user_id: 102 })] });
    const envelope = await execute(schemaListCommand, {}, t.context);
    expect(envelope.error).toMatchObject({ code: 'AUTH', message: expect.stringContaining('answered without an access token') });
  });

  it('accepts userId as a number or a padded string, and refuses anything else as CONFIG_INVALID before any request', async () => {
    for (const userId of [102, ' 102 ']) {
      clearTokenCache();
      const { calls } = await run(schemaListCommand, {}, [get('/integration/v2/schema/', [])], { config: { alation: { ...fixtureConfig.alation, userId } } });
      expect(JSON.parse(calls[0]!.body!)).toEqual({ refresh_token: 'refresh-abc', user_id: 102 });
    }
    for (const userId of ['you@example.com', '0', '000', 0]) {
      const { envelope, calls } = await run(schemaListCommand, {}, [], { config: { alation: { ...fixtureConfig.alation, userId } } });
      expect(envelope.error).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_ALATION_USER_ID') });
      expect(calls).toEqual([]);
    }
  });

  it('with no connection set up, NOT_CONFIGURED names all three variables', async () => {
    const t = testContext({ config: {}, routes: [] });
    const envelope = await execute(schemaListCommand, {}, t.context);
    expect(envelope.error).toMatchObject({ code: 'NOT_CONFIGURED' });
    for (const name of ['TOIL_ALATION_BASE_URL', 'TOIL_ALATION_REFRESH_TOKEN', 'TOIL_ALATION_USER_ID']) expect(envelope.error?.fix).toContain(name);
    expect(envelope.error?.fix).toContain('TOIL_ALATION_BASE_URL (e.g. https://alation.imagile.dev)');
    expect(envelope.error?.fix).toContain('TOIL_ALATION_USER_ID (e.g. 102)');
  });

  it('refuses a cross-origin redirect on a data request, so TOKEN stays on the configured host (#77 item 1, a security divergence)', async () => {
    const { envelope, calls } = await run(schemaListCommand, {}, [{ path: '/integration/v2/schema/', respond: { status: 307, headers: { location: 'https://elsewhere.imagile.dev/integration/v2/schema/' } } }]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining('https://elsewhere.imagile.dev, a different host') });
    expect(calls.map((c) => new URL(c.url).origin)).toEqual([ALATION, ALATION]);
  });

  it('refuses a cross-origin redirect on the exchange, so the refresh token is never re-posted (#77 item 1)', async () => {
    const t = testContext({ config: { alation: { ...fixtureConfig.alation, baseUrl: 'http://alation.imagile.dev' } }, routes: [{ method: 'POST', path: '/integration/v1/createAPIAccessToken/', respond: { status: 308, headers: { location: `${EXCHANGE}` } } }] });
    const envelope = await execute(schemaListCommand, {}, t.context);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining('a different host') });
    expect(t.http.calls).toHaveLength(1);
  });
});

describe('token status', () => {
  it('mints a token, validates it, and returns the answer without the token', async () => {
    const { envelope, calls } = await run(tokenStatusCommand, {}, [{ method: 'POST', path: '/integration/v1/validateAPIAccessToken/', respond: { json: validated } }]);
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['POST', EXCHANGE],
      ['POST', `${ALATION}/integration/v1/validateAPIAccessToken/`],
    ]);
    expect(calls[1]).toMatchObject({ headers: JSON_HEADERS, body: JSON.stringify({ api_access_token: 'short-tok', user_id: 102 }) });
    expect(envelope.data).toEqual({ user_id: 102, created_at: validated.created_at, token_expires_at: validated.token_expires_at, token_status: 'ACTIVE' });
    expect(JSON.stringify(envelope)).not.toContain('short-tok');
  });

  it('mints a new token even when one is cached, leaving another on the server (suspected bug, #77 item 3)', async () => {
    const t = testContext({ config: fixtureConfig, routes: [exchangeRoute(), get('/integration/v2/schema/', []), { method: 'POST', path: '/integration/v1/validateAPIAccessToken/', respond: { json: validated } }] });
    await execute(schemaListCommand, {}, t.context);
    await execute(tokenStatusCommand, {}, t.context);
    expect(t.http.calls.filter((c) => c.url === EXCHANGE)).toHaveLength(2);
  });

  it('a refused validation is AUTH', async () => {
    const { envelope } = await run(tokenStatusCommand, {}, [{ method: 'POST', path: '/integration/v1/validateAPIAccessToken/', respond: { status: 401, json: { detail: 'Token expired' } } }]);
    expect(envelope.error).toMatchObject({ code: 'AUTH', message: 'Token expired' });
  });
});

describe('catalog', () => {
  it('datasource list sends include flags only when set, and wraps the rows unpaged', async () => {
    const plain = await run(datasourceListCommand, {}, [get('/integration/v1/datasource/', [{ id: 3, title: 'Warehouse' }])]);
    expect(plain.data[0]!.url).toBe(`${ALATION}/integration/v1/datasource/`);
    expect(plain.envelope.data).toEqual({ count: 1, datasources: [{ id: 3, title: 'Warehouse' }] });
    const flagged = await run(datasourceListCommand, { includeUndeployed: true }, [get('/integration/v1/datasource/', [])]);
    expect(flagged.data[0]!.url).toBe(`${ALATION}/integration/v1/datasource/?include_undeployed=true`);
  });

  it('table list sends v2 filters with paging and reports limit and skip (from --offset) as numbers', async () => {
    const { envelope, data } = await run(tableListCommand, { ds: '3', schemaName: 'public', search: 'cust', limit: '50', offset: '10' }, [get('/integration/v2/table/', [table(1)])]);
    expect(data[0]!.url).toBe(`${ALATION}/integration/v2/table/?limit=50&skip=10&ds_id=3&schema_name=public&name__icontains=cust`);
    expect(envelope.data).toEqual({ count: 1, limit: 50, skip: 10, tables: [table(1)] });
  });

  it('checks --limit, --offset and IDs as the contract specifies, before any request', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ limit: '1001' }, "--limit must be between 1 and 1000 (Alation's per-request cap)."],
      [{ limit: '0' }, "--limit must be between 1 and 1000 (Alation's per-request cap)."],
      [{ offset: '-1' }, 'Invalid --offset "-1". Expected a non-negative integer.'],
      [{ limit: 'abc' }, 'Invalid --limit "abc". Expected a non-negative integer.'],
      [{ ds: '0' }, 'Invalid --ds "0". Expected a positive integer ID.'],
    ];
    for (const [input, message] of cases) {
      const { envelope, calls } = await run(tableListCommand, input, []);
      expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message });
      expect(calls).toEqual([]);
    }
    const id = await run(schemaGetCommand, { id: 'x' }, []);
    expect(id.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Invalid schema ID "x". Expected a positive integer ID.' });
  });

  it('datasource get puts its ID into the path as a positive integer, and refuses one with path or query syntax in it before any request', async () => {
    const ok = await run(datasourceGetCommand, { id: '3' }, [get('/integration/v1/datasource/3/', { id: 3 })]);
    expect(ok.data[0]!.url).toBe(`${ALATION}/integration/v1/datasource/3/`);
    for (const id of ['x/../y', '3/?a=b', '3#hot']) {
      const { envelope, calls } = await run(datasourceGetCommand, { id }, []);
      expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: `Invalid data source ID "${id}". Expected a positive integer ID.` });
      expect(calls).toEqual([]);
    }
  });

  it('an empty filter is skipped, as the contract specifies for an empty string', async () => {
    const { data } = await run(schemaListCommand, { ds: '', name: '' }, [get('/integration/v2/schema/', [])]);
    expect(data[0]!.url).toBe(`${ALATION}/integration/v2/schema/?limit=100&skip=0`);
  });

  it('get reads the list endpoint with id and limit=1, and is NOT_FOUND on no rows', async () => {
    const { envelope, data } = await run(tableGetCommand, { id: '7' }, [get('/integration/v2/table/', [table(7)])]);
    expect(data[0]!.url).toBe(`${ALATION}/integration/v2/table/?id=7&limit=1`);
    expect(envelope.data).toEqual(table(7));
    const missing = await run(tableGetCommand, { id: '99' }, [get('/integration/v2/table/', [])]);
    expect(missing.envelope.error).toMatchObject({ code: 'NOT_FOUND', message: 'Table 99 not found' });
  });

  it('get returns the first row when none has the ID (suspected bug, #77 item 4)', async () => {
    const { envelope } = await run(schemaGetCommand, { id: '11' }, [get('/integration/v2/schema/', [{ id: 12, name: 'other' }])]);
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({ id: 12, name: 'other' });
    expect(envelope.meta.warnings).toEqual([{ code: 'ALATION_ID_MISMATCH', message: 'Alation returned no schema with ID 11; data is the first row it returned instead (ID 12).' }]);
  });

  it('table get --columns warns when it reached the 1000-column page', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => column(i + 1, `c${i + 1}`));
    const { envelope } = await run(tableGetCommand, { id: '7', columns: true }, [get('/integration/v2/table/', [table(7)]), get('/integration/v2/column/', many)]);
    expect(envelope.data).toMatchObject({ columnCount: 1000 });
    expect(envelope.meta.warnings).toEqual([{ code: 'ALATION_COLUMNS_TRUNCATED', message: expect.stringContaining('--offset 1000') }]);
  });

  it('table get --columns adds one page of 1000 columns by id, and no warning below the cap (suspected bug, #77 item 5)', async () => {
    const { envelope, data } = await run(tableGetCommand, { id: '7', columns: true }, [get('/integration/v2/table/', [table(7)]), get('/integration/v2/column/', [column(70, 'id'), column(71, 'total')])]);
    expect(data.map((c) => c.url)).toEqual([`${ALATION}/integration/v2/table/?id=7&limit=1`, `${ALATION}/integration/v2/column/?table_id=7&limit=1000&order_by=id`]);
    expect(envelope.data).toEqual({ ...table(7), columnCount: 2, columns: [column(70, 'id'), column(71, 'total')] });
    expect(envelope.meta.warnings).toBeUndefined();
  });

  it('column list refuses to list the whole catalog, before any request', async () => {
    const { envelope, calls } = await run(columnListCommand, {}, []);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('Pass at least one filter') });
    expect(calls).toEqual([]);
  });

  it('search sends q, limit, offset and the otypes filter as one JSON value', async () => {
    const { envelope, data } = await run(searchCommand, { query: 'customer', otype: 'table, column' }, [get('/integration/v1/search/', searchResult)]);
    const url = new URL(data[0]!.url);
    expect(url.pathname).toBe('/integration/v1/search/');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'customer', limit: '20', offset: '0', filters: '{"otypes":["table","column"]}' });
    expect(envelope.data).toEqual({ query: 'customer', total: 1, limit: 20, offset: 0, fullSearchUrl: searchResult.full_search_url, results: searchResult.results });
  });

  it('search checks otypes and the 10000 cap, and accepts --limit 0 (suspected bug, #77 item 6)', async () => {
    const bad = await run(searchCommand, { query: 'x', otype: 'table,widget' }, []);
    expect(bad.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('Unknown --otype value(s): widget') });
    const empty = await run(searchCommand, { query: 'x', otype: ' , ' }, []);
    expect(empty.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '--otype cannot be empty' });
    const big = await run(searchCommand, { query: 'x', limit: '10001' }, []);
    expect(big.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '--limit must be at most 10000' });
    const zero = await run(searchCommand, { query: 'x', limit: '0' }, [get('/integration/v1/search/', { ...searchResult, limit: 0 })]);
    expect(zero.envelope.ok).toBe(true);
    expect(new URL(zero.data[0]!.url).searchParams.get('limit')).toBe('0');
  });
});

describe('documents', () => {
  const post = (body: unknown): Route => ({ method: 'POST', path: '/integration/v2/document/', respond: { json: body } });
  const put = (body: unknown): Route => ({ method: 'PUT', path: '/integration/v2/document/', respond: { json: body } });
  const config = fixtureConfig;
  const allowWrite = true;

  it('create POSTs a one-element array and returns the job id and the payload', async () => {
    const { envelope, data } = await run(documentCreateCommand, { title: 'Notes', hub: '1', folder: '42', description: 'Hi', allowWrite }, [post({ job_id: 555 })], { config });
    expect(data[0]).toEqual({ method: 'POST', url: `${ALATION}/integration/v2/document/`, headers: DATA_HEADERS, body: JSON.stringify([{ title: 'Notes', description: 'Hi', document_hub_id: 1, parent_folder_id: 42 }]) });
    expect(envelope.data).toEqual({ jobId: 555, document: { title: 'Notes', description: 'Hi', document_hub_id: 1, parent_folder_id: 42 } });
  });

  it('create requires a title, --hub and --folder, before any request', async () => {
    const { envelope, calls } = await run(documentCreateCommand, { title: 'x', allowWrite }, [], { config });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '--hub is required to create a document (or set it in --input-file)' });
    expect(calls).toEqual([]);
  });

  it('create merges --input-file with flags winning, warns about the override, and reads @file values', async () => {
    const files = { 'doc.json': JSON.stringify({ title: 'From file', description: '@notes.md', hub: 1, folder: 2, template: 9, fields: { '10001': 'v', '10002': '@notes.md' } }), 'notes.md': '# Hello' };
    const { envelope, data } = await run(documentCreateCommand, { inputFile: 'doc.json', title: 'From flag', allowWrite }, [post({ job_id: 7 })], { config, files });
    const sent = { title: 'From flag', description: '# Hello', document_hub_id: 1, parent_folder_id: 2, template_id: 9, custom_fields: [{ field_id: 10001, value: 'v' }, { field_id: 10002, value: '# Hello' }] };
    expect(JSON.parse(data[0]!.body!)).toEqual([sent]);
    expect(envelope.data).toEqual({ jobId: 7, document: sent, overrides: ['title'] });
    expect(envelope.meta.warnings).toEqual([{ code: 'ALATION_INPUT_OVERRIDDEN', message: '--input-file values overridden by flags: title' }]);
  });

  it('custom fields need a template, and their keys must be numeric field IDs', async () => {
    const files = { 'doc.json': JSON.stringify({ title: 'T', hub: 1, folder: 2, fields: { '10001': 'v' } }), 'named.json': JSON.stringify({ title: 'T', hub: 1, folder: 2, template: 9, fields: { body: 'v' } }), 'list.json': '[1]' };
    const noTemplate = await run(documentCreateCommand, { inputFile: 'doc.json', allowWrite }, [], { config, files });
    expect(noTemplate.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('requires template_id') });
    const named = await run(documentCreateCommand, { inputFile: 'named.json', allowWrite }, [], { config, files });
    expect(named.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '--input-file "fields" key "body" is not a numeric Alation field_id' });
    const list = await run(documentCreateCommand, { inputFile: 'list.json', allowWrite }, [], { config, files });
    expect(list.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '--input-file must contain a JSON object. Run: toil alation document schema' });
  });

  it('passes navLinkFolders and file values through unchecked (suspected bug, #77 item 7)', async () => {
    const files = { 'doc.json': JSON.stringify({ title: 'T', hub: 'one', folder: 2, navLinkFolders: 'not-a-list' }) };
    const { data } = await run(documentCreateCommand, { inputFile: 'doc.json', allowWrite }, [post({ job_id: 1 })], { config, files });
    expect(JSON.parse(data[0]!.body!)).toEqual([{ title: 'T', document_hub_id: 'one', parent_folder_id: 2, nav_link_folder_ids: 'not-a-list' }]);
  });

  it('update PUTs the id plus only what changed', async () => {
    const { envelope, data } = await run(documentUpdateCommand, { id: '12', description: 'New', allowWrite }, [put({ job_id: 9 })], { config });
    expect(data[0]).toMatchObject({ method: 'PUT', url: `${ALATION}/integration/v2/document/`, body: JSON.stringify([{ id: 12, description: 'New' }]) });
    expect(envelope.data).toEqual({ jobId: 9, document: { id: 12, description: 'New' } });
  });

  it('update refuses an empty change and a hub move, before any request', async () => {
    const empty = await run(documentUpdateCommand, { id: '12', allowWrite }, [], { config });
    expect(empty.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Nothing to update. Pass --title, --description, --folder, or --input-file.' });
    const hub = await run(documentUpdateCommand, { id: '12', inputFile: 'doc.json', allowWrite }, [], { config, files: { 'doc.json': JSON.stringify({ hub: 2 }) } });
    expect(hub.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'A document cannot change hubs; remove "hub" from --input-file.' });
    expect([...empty.calls, ...hub.calls]).toEqual([]);
  });

  it('writes need writes on the connection and --allow-write', async () => {
    const off = await run(documentCreateCommand, { title: 'Notes', hub: '1', folder: '42' }, [], { config });
    expect(off.envelope.error).toMatchObject({ code: 'WRITE_DISABLED' });
    expect(off.calls).toEqual([]);
  });

  it('schema returns the schema and example; --example-only returns the example as data, in the envelope', async () => {
    const t = testContext({ config: {} });
    const full = await execute(documentSchemaCommand, {}, t.context);
    expect(full.data).toMatchObject({ schema: { type: 'object' }, example: { hub: 1, folder: 42 } });
    const example = await execute(documentSchemaCommand, { exampleOnly: true }, t.context);
    expect(example).toMatchObject({ ok: true, data: { title: 'Customer table onboarding notes', hub: 1, folder: 42, template: 7 } });
    expect(t.http.calls).toEqual([]);
  });

  it('document get returns the row with its custom fields', async () => {
    const { envelope } = await run(documentGetCommand, { id: '12' }, [get('/integration/v2/document/', [document(12)])]);
    expect(envelope.data).toEqual(document(12));
  });

  it('job get reads bulk_metadata/job with the id and puts jobId first', async () => {
    const { envelope, data } = await run(jobGetCommand, { id: '555' }, [get('/api/v1/bulk_metadata/job/', jobStatus)]);
    expect(data[0]!.url).toBe(`${ALATION}/api/v1/bulk_metadata/job/?id=555`);
    expect(envelope.data).toEqual({ jobId: 555, ...jobStatus });
  });
});
