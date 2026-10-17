import { describe, expect, it } from 'vitest';
import { fakeFetch, type Route } from '../../test/harness/fake-fetch.js';
import { ToilError } from './errors.js';
import { buildUrl, errorMessageFrom, parseRetryAfter, restRequest } from './rest.js';

const opts = { service: 'Jira', authFix: 'Make a new token.' };
const ctxWith = (routes: Route[], fetchImpl?: typeof fetch) => {
  const http = fakeFetch(routes);
  return { http, ctx: { fetch: fetchImpl ?? http.fetch, signal: new AbortController().signal } };
};
const failure = async (p: Promise<unknown>): Promise<ToilError> => {
  try {
    await p;
  } catch (err) {
    return err as ToilError;
  }
  throw new Error('expected a failure');
};

describe('buildUrl', () => {
  it('keeps a context path on the base and literal commas in the query', () => {
    expect(buildUrl('https://jira.imagile.dev/jira', '/rest/api/2/issue/A-1', { expand: 'a,b', skip: undefined })).toBe(
      'https://jira.imagile.dev/jira/rest/api/2/issue/A-1?expand=a,b',
    );
    expect(buildUrl('https://jira.imagile.dev/', 'rest/x', { n: 1, b: false })).toBe('https://jira.imagile.dev/rest/x?n=1&b=false');
  });

  it('leaves an encoded comma in the path alone', () => {
    expect(buildUrl('https://jira.imagile.dev', '/a%2Cb')).toBe('https://jira.imagile.dev/a%2Cb');
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates, and ignores anything else', () => {
    expect(parseRetryAfter('5')).toBe(5);
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:28:10 GMT', Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'))).toBe(10);
    expect(parseRetryAfter('-1')).toBeUndefined();
    expect(parseRetryAfter('1.5')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe('errorMessageFrom', () => {
  it('reads errorMessages and errors, then message and detail', () => {
    expect(errorMessageFrom(JSON.stringify({ errorMessages: ['Issue does not exist'], errors: { summary: 'required' } }))).toBe('Issue does not exist; summary: required');
    expect(errorMessageFrom(JSON.stringify({ errors: [{ msg: 'bad' }, { message: 'worse' }] }))).toBe('bad; worse');
    expect(errorMessageFrom(JSON.stringify({ message: 'nope' }))).toBe('nope');
    expect(errorMessageFrom(JSON.stringify({ detail: 'why' }))).toBe('why');
    expect(errorMessageFrom('<html>')).toBeUndefined();
  });
});

describe('restRequest', () => {
  const url = 'https://jira.imagile.dev/rest/api/2/issue/A-1';

  it('returns parsed JSON, undefined for 204 and empty bodies, and bytes on request', async () => {
    const { ctx } = ctxWith([
      { url, respond: { json: { key: 'A-1' } } },
      { method: 'PUT', url, respond: { status: 204 } },
      { method: 'POST', url, respond: { status: 201 } },
      { url: `${url}/raw`, respond: { text: 'abc' } },
    ]);
    expect(await restRequest(ctx, url, {}, opts)).toEqual({ key: 'A-1' });
    expect(await restRequest(ctx, url, { method: 'PUT' }, opts)).toBeUndefined();
    expect(await restRequest(ctx, url, { method: 'POST' }, opts)).toBeUndefined();
    expect(await restRequest(ctx, `${url}/raw`, {}, { ...opts, as: 'bytes' })).toEqual(new TextEncoder().encode('abc'));
  });

  it('maps 401/403 to AUTH with the area fix, 404 to NOT_FOUND, others to HTTP, with the server message', async () => {
    const { ctx } = ctxWith([
      { url: `${url}/401`, respond: { status: 401, json: { errorMessages: ['You are not authenticated'] } } },
      { url: `${url}/403`, respond: { status: 403, text: '' } },
      { url: `${url}/404`, respond: { status: 404, json: { errorMessages: ['Issue Does Not Exist'], errors: {} } } },
      { url: `${url}/400`, respond: { status: 400, json: { errorMessages: [], errors: { customfield_10016: 'Number required' } } } },
    ]);
    expect(await failure(restRequest(ctx, `${url}/401`, {}, opts))).toMatchObject({
      code: 'AUTH',
      message: 'Jira: You are not authenticated',
      fix: 'Make a new token.',
      details: { status: 401 },
    });
    expect(await failure(restRequest(ctx, `${url}/403`, {}, opts))).toMatchObject({ code: 'AUTH', message: 'Jira: HTTP 403' });
    expect(await failure(restRequest(ctx, `${url}/404`, {}, opts))).toMatchObject({ code: 'NOT_FOUND', message: 'Jira: Issue Does Not Exist' });
    expect(await failure(restRequest(ctx, `${url}/400`, {}, opts))).toMatchObject({ code: 'HTTP', message: 'Jira: customfield_10016: Number required' });
  });

  it('retries a 429 after the wait the server asks for, then succeeds', async () => {
    let calls = 0;
    const { ctx, http } = ctxWith([{ url, respond: () => (++calls < 3 ? { status: 429, headers: { 'Retry-After': '0' } } : { json: { ok: 1 } }) }]);
    expect(await restRequest(ctx, url, {}, opts)).toEqual({ ok: 1 });
    expect(http.calls).toHaveLength(3);
  });

  it('gives up on a 429 after three attempts, or at once when the wait is over the cap', async () => {
    const { ctx, http } = ctxWith([
      { url, respond: { status: 429, headers: { 'Retry-After': '0' } } },
      { url: `${url}/long`, respond: { status: 429, headers: { 'Retry-After': '3600' } } },
    ]);
    expect(await failure(restRequest(ctx, url, {}, opts))).toMatchObject({ code: 'HTTP', details: { status: 429 } });
    expect(http.calls).toHaveLength(3);
    expect(await failure(restRequest(ctx, `${url}/long`, {}, opts))).toMatchObject({
      code: 'HTTP',
      message: expect.stringContaining('3600s'),
      details: { retryAfterSeconds: 3600 },
    });
    expect(http.calls).toHaveLength(4);
  });

  it('reports an unreachable host as NETWORK with the cause, and a certificate problem with the CA fix', async () => {
    const dns = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND jira.imagile.dev' } });
    const tls = Object.assign(new TypeError('fetch failed'), { cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } });
    const reject = (err: Error) =>
      (async () => {
        throw err;
      }) as unknown as typeof fetch;
    expect(await failure(restRequest(ctxWith([], reject(dns)).ctx, url, {}, opts))).toMatchObject({
      code: 'NETWORK',
      message: 'Could not reach Jira at https://jira.imagile.dev: ENOTFOUND.',
      fix: expect.stringContaining('baseUrl'),
    });
    expect((await failure(restRequest(ctxWith([], reject(tls)).ctx, url, {}, opts))).fix).toContain('NODE_EXTRA_CA_CERTS');
  });

  it('says so when a 200 is not JSON, as a sign-in page would be', async () => {
    const { ctx } = ctxWith([{ url, respond: { text: '<html>Sign in</html>', headers: { 'content-type': 'text/html' } } }]);
    expect(await failure(restRequest(ctx, url, {}, opts))).toMatchObject({ code: 'HTTP', fix: expect.stringContaining('login page'), details: { contentType: 'text/html' } });
  });

  it('lets an abort through for execute() to report', async () => {
    const controller = new AbortController();
    controller.abort(new ToilError('CANCELLED', 'cancelled'));
    const aborting = (async () => {
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    const err = await failure(restRequest({ fetch: aborting, signal: controller.signal }, url, {}, opts));
    expect(err).toBeInstanceOf(DOMException);
  });
});
