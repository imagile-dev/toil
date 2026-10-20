import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { comments, config as fixtureConfig, FIGMA, FILE_KEY, me, nodes, PROJECT_ID, projectFiles, versions, wholeFile } from '../../../test/fixtures/figma.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { commentsCommand, fileCommand, meCommand, projectFilesCommand, versionsCommand } from './commands.js';
import { findNodeIdInUrl, parseFileKey, parseNodeId } from './links.js';

/**
 * The exact request each figma command sends and what it makes of the answer,
 * as the command contract specifies. Suspected bugs (#73) are pinned here,
 * each citing its item, and left exactly as found pending a live inspection.
 */

const HEADERS = { 'x-figma-token': 'test-token', 'content-type': 'application/json', accept: 'application/json', connection: 'close' };

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], config: Record<string, Record<string, unknown>> = fixtureConfig) {
  const t = testContext({ config, routes });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

const ok = (body: unknown): Route => ({ url: /.*/, respond: { json: body } });

describe('parseFileKey', () => {
  it('reads the key from /design/ and legacy /file/ links, any case of figma.com, and passes a raw key through', () => {
    expect(parseFileKey('https://www.figma.com/design/ABC123XYZ/My-Design-File')).toBe('ABC123XYZ');
    expect(parseFileKey('https://www.figma.com/file/DEF456UVW/Old-Design')).toBe('DEF456UVW');
    expect(parseFileKey('https://www.FIGMA.COM/design/JKL012MNO/Test')).toBe('JKL012MNO');
    expect(parseFileKey('GHI789RST')).toBe('GHI789RST');
    expect(parseFileKey('not a key/at all')).toBe('not a key/at all');
  });

  it('refuses a link that is not a Figma file link, as INVALID_INPUT with its documented message', () => {
    expect(() => parseFileKey('https://www.notion.so/some-page-id')).toThrow(
      'Could not extract Figma file key from URL: https://www.notion.so/some-page-id\nExpected format: https://www.figma.com/design/<file-key>/...',
    );
    expect(() => parseFileKey('https://www.notion.so/x')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

  it('suspected bug #73 item 4: a branch link resolves to the main file key', () => {
    expect(parseFileKey('https://www.figma.com/design/abc12345/branch/def67890/Checkout')).toBe('abc12345');
  });

  it('suspected bug #73 item 5: FigJam, prototype and Slides links are refused', () => {
    for (const kind of ['board', 'proto', 'slides']) {
      expect(() => parseFileKey(`https://www.figma.com/${kind}/abc12345/x`), kind).toThrow('Could not extract Figma file key from URL');
    }
  });
});

describe('parseNodeId and findNodeIdInUrl', () => {
  it('normalizes dashes to colons, from a link or raw, including instance IDs, and trims', () => {
    expect(parseNodeId('https://www.figma.com/design/ABC123XYZ/My-Design?node-id=12-34')).toBe('12:34');
    expect(parseNodeId('12-34')).toBe('12:34');
    expect(parseNodeId('12:34')).toBe('12:34');
    expect(parseNodeId('I12-34;56-78')).toBe('I12:34;56:78');
    expect(parseNodeId('  12-34 ')).toBe('12:34');
  });

  it('refuses a link with no node-id, and an unparseable link, rather than returning nothing', () => {
    expect(() => parseNodeId('https://www.figma.com/design/ABC123XYZ/My-Design')).toThrow(
      'Could not extract a Figma node ID from URL: https://www.figma.com/design/ABC123XYZ/My-Design\nExpected a node ID like 12:34 or 12-34, or a Figma URL with a node-id query param',
    );
    expect(() => parseNodeId('https://')).toThrow('Could not extract a Figma node ID from URL: https://');
  });

  it.each(['', '   ', '1234', 'abc', '12:', ':34', '12:34;', 'https://www.figma.com/design/ABC123XYZ/My-Design?node-id=nope'])('refuses malformed node ID %j', (value) => {
    expect(() => parseNodeId(value)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('Invalid Figma node ID') }));
  });

  it('findNodeIdInUrl: undefined without node-id, the ID with one, and still an error when it is malformed', () => {
    expect(findNodeIdInUrl('https://www.figma.com/design/ABC123XYZ/My-Design')).toBeUndefined();
    expect(findNodeIdInUrl('https://www.figma.com/design/ABC123XYZ/My-Design?node-id=12-34')).toBe('12:34');
    expect(() => findNodeIdInUrl('https://www.figma.com/design/ABC123XYZ/My-Design?node-id=nope')).toThrow('Invalid Figma node ID');
  });
});

describe('file get', () => {
  it('whole file: GETs /v1/files/<key>?depth=1 with the token and reshapes the answer, leaving document out', async () => {
    const { envelope, calls } = await run(fileCommand, { fileKeyOrUrl: FILE_KEY }, [ok(wholeFile)]);
    expect(calls).toEqual([{ method: 'GET', url: `${FIGMA}/v1/files/${FILE_KEY}?depth=1`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({
      fileKey: FILE_KEY,
      name: 'Checkout',
      lastModified: wholeFile.lastModified,
      version: wholeFile.version,
      thumbnailUrl: wholeFile.thumbnailUrl,
      role: 'editor',
      editorType: 'figma',
      schemaVersion: 0,
      componentCount: 2,
      styleCount: 1,
    });
  });

  it('--document drops depth and adds the document tree; a link without node-id is the whole file', async () => {
    const { envelope, calls } = await run(fileCommand, { fileKeyOrUrl: `https://www.figma.com/design/${FILE_KEY}/Checkout`, document: true }, [ok(wholeFile)]);
    expect(calls[0]!.url).toBe(`${FIGMA}/v1/files/${FILE_KEY}`);
    expect(envelope.data).toMatchObject({ fileKey: FILE_KEY, document: wholeFile.document, componentCount: 2 });
  });

  it('counts are 0 when the answer has no components or styles, and missing fields stay out', async () => {
    const { envelope } = await run(fileCommand, { fileKeyOrUrl: FILE_KEY }, [ok({ name: 'n', lastModified: 'l', version: 'v' })]);
    expect(JSON.parse(JSON.stringify(envelope.data))).toEqual({ fileKey: FILE_KEY, name: 'n', lastModified: 'l', version: 'v', componentCount: 0, styleCount: 0 });
  });

  it('suspected bug #73 item 7: the counts come from the depth=1 answer, whatever --document would show', async () => {
    const shallow = { ...wholeFile, components: {}, styles: {} };
    const { envelope, calls } = await run(fileCommand, { fileKeyOrUrl: FILE_KEY }, [ok(shallow)]);
    expect(new URL(calls[0]!.url).searchParams.get('depth')).toBe('1');
    expect(envelope.data).toMatchObject({ componentCount: 0, styleCount: 0 });
  });

  it('a node-id in the link: GETs the nodes endpoint with a colon ID and returns the node', async () => {
    const { envelope, calls } = await run(fileCommand, { fileKeyOrUrl: `https://www.figma.com/design/${FILE_KEY}/Checkout?node-id=12-34` }, [ok(nodes)]);
    expect(calls).toEqual([{ method: 'GET', url: `${FIGMA}/v1/files/${FILE_KEY}/nodes?ids=12%3A34`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({
      fileKey: FILE_KEY,
      nodeId: '12:34',
      name: 'Checkout',
      lastModified: nodes.lastModified,
      thumbnailUrl: nodes.thumbnailUrl,
      document: nodes.nodes['12:34'].document,
      componentCount: 1,
      styleCount: 0,
    });
  });

  it('--node-id overrides the link and must parse; a link given as --node-id with no node-id fails before any request', async () => {
    const { calls } = await run(fileCommand, { fileKeyOrUrl: `https://www.figma.com/design/${FILE_KEY}/x?node-id=1-1`, nodeId: '12-34' }, [ok(nodes)]);
    expect(new URL(calls[0]!.url).searchParams.get('ids')).toBe('12:34');
    const bad = await run(fileCommand, { fileKeyOrUrl: FILE_KEY, nodeId: `https://www.figma.com/design/${FILE_KEY}/x` }, []);
    expect(bad.calls).toEqual([]);
    expect(bad.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('Could not extract a Figma node ID from URL') });
  });

  it('an empty --node-id is no node ID, as specified: the whole file', async () => {
    const { calls } = await run(fileCommand, { fileKeyOrUrl: FILE_KEY, nodeId: '' }, [ok(wholeFile)]);
    expect(calls[0]!.url).toBe(`${FIGMA}/v1/files/${FILE_KEY}?depth=1`);
  });

  it('a malformed node-id in the link still fails, and a bad link fails, before any request', async () => {
    const malformed = await run(fileCommand, { fileKeyOrUrl: `https://www.figma.com/design/${FILE_KEY}/x?node-id=nope` }, []);
    expect(malformed.calls).toEqual([]);
    expect(malformed.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('Invalid Figma node ID') });
    const notFigma = await run(fileCommand, { fileKeyOrUrl: 'https://www.notion.so/x' }, []);
    expect(notFigma.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('Could not extract Figma file key from URL') });
  });

  it('suspected bug #73 item 6: in node mode --document is ignored and the whole subtree comes back', async () => {
    const { envelope, calls } = await run(fileCommand, { fileKeyOrUrl: FILE_KEY, nodeId: '12:34' }, [ok(nodes)]);
    expect(calls[0]!.url).not.toContain('depth');
    expect(envelope.data).toHaveProperty('document', nodes.nodes['12:34'].document);
  });

  it('suspected bug #73 item 8: a node missing from the answer is NOT_FOUND, and Figma\'s err is discarded', async () => {
    const { envelope } = await run(fileCommand, { fileKeyOrUrl: FILE_KEY, nodeId: '12-34' }, [ok({ ...nodes, err: 'Node too large', nodes: { '12:34': null } })]);
    expect(envelope.error).toMatchObject({ code: 'NOT_FOUND', message: `Node 12:34 not found in file ${FILE_KEY}` });
    expect(envelope.error?.message).not.toContain('too large');
  });

  it('encodes the file key in the path', async () => {
    const { calls } = await run(fileCommand, { fileKeyOrUrl: 'a/b c' }, [ok(wholeFile)]);
    expect(calls[0]!.url).toBe(`${FIGMA}/v1/files/a%2Fb%20c?depth=1`);
  });

  it('encodes a file key with query or fragment syntax in it as one path segment, and refuses one with a dot segment before sending', async () => {
    const query = await run(fileCommand, { fileKeyOrUrl: 'a/b?c=d' }, [ok(wholeFile)]);
    expect(query.calls[0]!.url).toBe(`${FIGMA}/v1/files/a%2Fb%3Fc%3Dd?depth=1`);
    const hash = await run(commentsCommand, { fileKeyOrUrl: 'p1#hot' }, [ok(comments)]);
    expect(hash.calls[0]!.url).toBe(`${FIGMA}/v1/files/p1%23hot/comments`);
    const dots = await run(fileCommand, { fileKeyOrUrl: 'x/../y' }, [ok(wholeFile)]);
    expect(dots.envelope.error?.code).toBe('INVALID_INPUT');
    expect(dots.calls).toEqual([]);
  });

  it('returns CDN image URLs as data and never fetches them', async () => {
    const { envelope, calls } = await run(fileCommand, { fileKeyOrUrl: FILE_KEY }, [ok(wholeFile)]);
    expect(calls).toHaveLength(1);
    expect((envelope.data as { thumbnailUrl: string }).thumbnailUrl).toBe(wholeFile.thumbnailUrl);
  });
});

describe('file comments', () => {
  it('GETs /comments and returns fileKey, count and the comments as they came', async () => {
    const { envelope, calls } = await run(commentsCommand, { fileKeyOrUrl: FILE_KEY }, [ok(comments)]);
    expect(calls).toEqual([{ method: 'GET', url: `${FIGMA}/v1/files/${FILE_KEY}/comments`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({ fileKey: FILE_KEY, count: 2, comments: comments.comments });
  });

  it('suspected bug #73 item 2: --as-of is sent as as_of, which Figma ignores, so every comment comes back', async () => {
    const { envelope, calls } = await run(commentsCommand, { fileKeyOrUrl: `https://www.figma.com/file/${FILE_KEY}/x`, asOf: '2026-09-02T12:00:00Z' }, [ok(comments)]);
    expect(calls[0]!.url).toBe(`${FIGMA}/v1/files/${FILE_KEY}/comments?as_of=2026-09-02T12%3A00%3A00Z`);
    expect(envelope.data).toMatchObject({ count: 2 });
    expect(envelope.meta.warnings).toEqual([{ code: 'FIGMA_AS_OF_IGNORED', message: "Figma's API doesn't filter comments by --as-of; every comment was returned." }]);
  });

  it('warns about --as-of only when it is given', async () => {
    const { envelope } = await run(commentsCommand, { fileKeyOrUrl: FILE_KEY }, [ok(comments)]);
    expect(envelope.meta.warnings).toBeUndefined();
  });
});

describe('file versions', () => {
  it('suspected bug #73 item 3: one GET, no paging parameters, and the pagination object is dropped', async () => {
    const { envelope, calls } = await run(versionsCommand, { fileKeyOrUrl: FILE_KEY }, [ok(versions)]);
    expect(calls).toEqual([{ method: 'GET', url: `${FIGMA}/v1/files/${FILE_KEY}/versions`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({ fileKey: FILE_KEY, count: 2, versions: versions.versions });
    expect(envelope.meta.warnings).toEqual([{ code: 'FIGMA_MORE_VERSIONS', message: 'Figma has more versions than this page; only the first page was read.' }]);
  });

  it('#73 item 3: no warning when the answer has no next_page', async () => {
    const last = await run(versionsCommand, { fileKeyOrUrl: FILE_KEY }, [ok({ ...versions, pagination: { prev_page: null, next_page: null } })]);
    expect(last.envelope.meta.warnings).toBeUndefined();
    const bare = await run(versionsCommand, { fileKeyOrUrl: FILE_KEY }, [ok({ versions: versions.versions })]);
    expect(bare.envelope.meta.warnings).toBeUndefined();
  });
});

describe('project files', () => {
  it('suspected bug #73 item 9: lists through the deprecated /v1/projects/<id>/files, encoding the ID', async () => {
    const { envelope, calls } = await run(projectFilesCommand, { projectId: PROJECT_ID }, [ok(projectFiles)]);
    expect(calls).toEqual([{ method: 'GET', url: `${FIGMA}/v1/projects/${PROJECT_ID}/files`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({ projectId: PROJECT_ID, count: 1, files: projectFiles.files });
    const odd = await run(projectFilesCommand, { projectId: '1/2' }, [ok(projectFiles)]);
    expect(odd.calls[0]!.url).toBe(`${FIGMA}/v1/projects/1%2F2/files`);
  });
});

describe('whoami', () => {
  it('GETs /v1/me and passes the answer through', async () => {
    const { envelope, calls } = await run(meCommand, {}, [ok(me)]);
    expect(calls).toEqual([{ method: 'GET', url: `${FIGMA}/v1/me`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual(me);
  });

  it('keeps a base URL context path', async () => {
    const { calls } = await run(meCommand, {}, [ok(me)], { figma: { ...fixtureConfig.figma, baseUrl: `${FIGMA}/proxy` } });
    expect(calls[0]!.url).toBe(`${FIGMA}/proxy/v1/me`);
  });

  it('a 403 is AUTH with where to make a token and the env var', async () => {
    const { envelope } = await run(meCommand, {}, [{ url: /.*/, respond: { status: 403, json: { status: 403, err: 'Invalid token' } } }]);
    expect(envelope.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('Settings → Security → Personal access tokens') });
    expect(envelope.error?.fix).toContain('TOIL_FIGMA_TOKEN');
  });

  it("suspected bug #73 item 10: Figma's { err } error body is not read, so the message is the bare status", async () => {
    const { envelope } = await run(meCommand, {}, [{ url: /.*/, respond: { status: 400, json: { status: 400, err: 'Invalid parameter' } } }]);
    expect(envelope.error?.code).toBe('HTTP');
    expect(envelope.error?.message).not.toContain('Invalid parameter');
  });

  it('is CONFIG_INVALID naming TOIL_FIGMA_BASE_URL when there is no base URL, with no request sent', async () => {
    const { envelope, calls } = await run(meCommand, {}, [], { figma: { token: 'test-token' } });
    expect(calls).toEqual([]);
    expect(envelope.error).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_FIGMA_BASE_URL') });
  });
});

describe('redirects (docs/divergences/figma.json, #73 item 1)', () => {
  it('refuses a cross-origin redirect, so X-Figma-Token never reaches the other host', async () => {
    const routes: Route[] = [
      { path: '/v1/me', origin: FIGMA, respond: { status: 302, headers: { location: 'https://other.imagile.dev/v1/me' } } },
      { path: '/v1/me', origin: 'https://other.imagile.dev', respond: { json: me } },
    ];
    const { envelope, calls } = await run(meCommand, {}, routes);
    expect(calls.map((c) => c.url)).toEqual([`${FIGMA}/v1/me`]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining('https://other.imagile.dev, a different host') });
  });

  it('still follows a redirect within the configured origin, with the token', async () => {
    const routes: Route[] = [
      { path: '/v1/me', respond: { status: 301, headers: { location: `${FIGMA}/v1/me/` } } },
      { path: '/v1/me/', respond: { json: me } },
    ];
    const { envelope, calls } = await run(meCommand, {}, routes);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers['x-figma-token']).toBe('test-token');
    expect(envelope.data).toEqual(me);
  });
});
