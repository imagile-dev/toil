import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Figma REST API responses for every request the figma examples send,
 * so the parity suite runs each command offline through both front doors.
 * Routes match on path and the whole query.
 *
 * Provenance: the nodes and whole-file shapes follow the canonical
 * implementation's tests (name, lastModified, version, nodes keyed by a colon
 * ID); every other field, and the comments, versions, project-files and me
 * shapes, are invented from Figma's REST API reference
 * (developers.figma.com/docs/rest-api), trimmed to the fields that matter.
 */

export const FIGMA = 'https://figma.imagile.dev';
export const FILE_KEY = 'abc12345';
export const PROJECT_ID = '12345';
const CDN = 'https://figma-cdn.imagile.dev';

export const config = { figma: { baseUrl: FIGMA, token: 'test-token' } };

const user = { id: 'abc12345', handle: 'Imagile Designer', img_url: `${CDN}/profile/abc12345` };

export const wholeFile = {
  name: 'Checkout',
  lastModified: '2026-09-01T10:00:00Z',
  version: '4200000001',
  thumbnailUrl: `${CDN}/thumbnails/abc12345`,
  role: 'editor',
  editorType: 'figma',
  schemaVersion: 0,
  document: { id: '0:0', name: 'Document', type: 'DOCUMENT', children: [{ id: '0:1', name: 'Page 1', type: 'CANVAS' }] },
  components: { '1:2': { key: 'c1', name: 'Button' }, '1:3': { key: 'c2', name: 'Input' } },
  styles: { '2:1': { key: 's1', name: 'Brand/Primary', styleType: 'FILL' } },
};

export const nodes = {
  name: 'Checkout',
  lastModified: '2026-09-01T10:00:00Z',
  thumbnailUrl: `${CDN}/thumbnails/abc12345`,
  err: null,
  nodes: { '12:34': { document: { id: '12:34', name: 'Frame', type: 'FRAME' }, components: { '1:2': { key: 'c1', name: 'Button' } }, styles: {} } },
};

export const comments = {
  comments: [
    { id: '101', file_key: FILE_KEY, user, created_at: '2026-09-02T09:00:00Z', resolved_at: null, message: 'Spacing looks off here.', order_id: '1', client_meta: { node_id: '12:34' } },
    { id: '102', file_key: FILE_KEY, parent_id: '101', user, created_at: '2026-09-03T09:00:00Z', resolved_at: null, message: 'Fixed.', order_id: '2' },
  ],
};

export const versions = {
  versions: [
    { id: '4200000001', created_at: '2026-09-01T10:00:00Z', label: 'Handoff', description: 'Ready for build', user },
    { id: '4200000000', created_at: '2026-08-30T10:00:00Z', label: null, description: null, user },
  ],
  pagination: { prev_page: `${FIGMA}/v1/files/${FILE_KEY}/versions?after=4200000001`, next_page: `${FIGMA}/v1/files/${FILE_KEY}/versions?before=4200000000` },
};

export const projectFiles = {
  name: 'Payments',
  files: [{ key: FILE_KEY, name: 'Checkout', thumbnail_url: `${CDN}/thumbnails/abc12345`, last_modified: '2026-09-01T10:00:00Z' }],
};

export const me = { id: 'abc12345', email: 'you@example.com', handle: 'Imagile Designer', img_url: `${CDN}/profile/abc12345` };

export const fixture = defineFixture({
  area: 'figma',
  routes: [
    { path: `/v1/files/${FILE_KEY}`, query: { depth: '1' }, respond: { json: wholeFile } },
    { path: `/v1/files/${FILE_KEY}`, query: {}, respond: { json: wholeFile } },
    { path: `/v1/files/${FILE_KEY}/nodes`, query: { ids: '12:34' }, respond: { json: nodes } },
    { path: `/v1/files/${FILE_KEY}/comments`, respond: { json: comments } },
    { path: `/v1/files/${FILE_KEY}/versions`, query: {}, respond: { json: versions } },
    { path: `/v1/projects/${PROJECT_ID}/files`, query: {}, respond: { json: projectFiles } },
    { path: '/v1/me', query: {}, respond: { json: me } },
  ],
  config,
});
