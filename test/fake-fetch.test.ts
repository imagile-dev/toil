import { describe, expect, it } from 'vitest';
import { execute } from '../src/core/run.js';
import { getThing, renameThing } from './fixtures/demo-commands.js';
import { testContext } from './harness/context.js';
import { fakeFetch } from './harness/fake-fetch.js';

describe('fakeFetch', () => {
  it('fails loudly on a request with no route', async () => {
    const { fetch } = fakeFetch();
    await expect(fetch('https://jira.imagile.dev/rest/api/2/myself')).rejects.toThrow(/no route for GET https:\/\/jira\.imagile\.dev/);
  });

  it('records method, URL, headers and body', async () => {
    const http = fakeFetch([{ method: 'POST', url: 'https://demo.imagile.dev/x', respond: { status: 201, json: { ok: 1 } } }]);
    const res = await http.fetch('https://demo.imagile.dev/x', { method: 'POST', headers: { 'X-Test': 'yes' }, body: '{"a":1}' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: 1 });
    expect(http.calls).toEqual([{ method: 'POST', url: 'https://demo.imagile.dev/x', headers: { 'x-test': 'yes', 'content-type': 'text/plain;charset=UTF-8' }, body: '{"a":1}' }]);
  });
});

describe('a command against mocked HTTP (demo fixture)', () => {
  it('sends the auth header and query, and reshapes the response', async () => {
    const { context, http } = testContext({
      config: { demo: { token: 'secret-token' } },
      routes: [{ url: 'https://demo.imagile.dev/api/things/THING-7?fields=name', respond: { json: { id: 'THING-7', attributes: { name: 'Seven' } } } }],
    });
    const envelope = await execute(getThing, { id: 'THING-7', fields: 'name' }, context);
    expect(http.calls[0]).toMatchObject({ method: 'GET', headers: { authorization: 'Bearer secret-token', accept: 'application/json' } });
    expect(envelope).toMatchObject({ ok: true, data: { id: 'THING-7', name: 'Seven', owner: null } });
  });

  it('maps a 404 to NOT_FOUND with a fix', async () => {
    const { context } = testContext({
      config: { demo: { token: 't' } },
      routes: [{ url: /things\/THING-404/, respond: { status: 404, json: {} } }],
    });
    const envelope = await execute(getThing, { id: 'THING-404' }, context);
    expect(envelope.error).toMatchObject({ code: 'NOT_FOUND', fix: 'Check the id.' });
  });

  it('reports NOT_CONFIGURED before any request when the credential is missing', async () => {
    const { context, http } = testContext();
    const envelope = await execute(getThing, { id: 'THING-1' }, context);
    expect(envelope.error?.code).toBe('NOT_CONFIGURED');
    expect(http.calls).toHaveLength(0);
  });

  it('sends the write body only when writes are enabled and allowed', async () => {
    const { context, http } = testContext({
      config: { demo: { token: 't', writes: true } },
      routes: [{ method: 'PUT', url: 'https://demo.imagile.dev/api/things/THING-1', respond: { json: { id: 'THING-1', attributes: { name: 'New' } } } }],
    });
    const envelope = await execute(renameThing, { id: 'THING-1', name: 'New', allowWrite: true }, context);
    expect(envelope).toMatchObject({ ok: true, data: { name: 'New' } });
    expect(JSON.parse(http.calls[0]!.body!)).toEqual({ name: 'New' });
  });
});
