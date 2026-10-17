import type { Route } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Alation responses for every request the alation examples send, so
 * the parity suite runs every command offline through both front doors.
 * Routes match on method, path and the whole query.
 *
 * Provenance: the token exchange, the table, column, search, document create
 * and job shapes come from the canonical implementation's tests; the rest are
 * invented from Alation's documented Integration API
 * (https://developer.alation.com/dev/reference), trimmed to the fields the
 * canonical implementation declared. Nothing here was obtained by filing a
 * data access request, which is why it arrived the same day.
 */

export const ALATION = 'https://alation.imagile.dev';

export const config = { alation: { baseUrl: ALATION, refreshToken: 'refresh-abc', userId: '102', writes: true } };

// From the canonical tests: POST integration/v1/createAPIAccessToken/.
export const exchanged = { api_access_token: 'short-tok', user_id: 102, created_at: '2026-10-17T09:00:00.000000Z', token_expires_at: '2099-01-01T00:00:00Z', token_status: 'ACTIVE' };

// Invented from the docs: POST integration/v1/validateAPIAccessToken/.
export const validated = { api_access_token: 'short-tok', user_id: 102, created_at: '2026-10-17T09:00:00.000000Z', token_expires_at: '2026-10-18T09:00:00.000000Z', token_status: 'ACTIVE' };

// Invented from the docs: GET integration/v1/datasource/.
export const datasource = (id: number) => ({
  id,
  title: 'Warehouse',
  dbtype: 'postgresql',
  uri: 'postgresql://warehouse.imagile.dev:5432/analytics',
  description: 'Analytics warehouse',
  is_virtual: false,
  deployment_setup_complete: true,
  private: false,
  is_gone: false,
  latest_extraction_time: '2026-10-16T02:00:00Z',
});

// Invented from the docs: one row of integration/v2/schema/.
export const schema = (id: number) => ({ id, name: 'public', title: 'Public', description: 'Default schema', ds_id: 3, key: '3.public', url: `/schema/${id}/`, custom_fields: [{ field_id: 10001, field_name: 'Steward', value: 'Team Data Platform' }] });

// From the canonical tests, filled out from the docs: rows of integration/v2/table/ and column/.
export const table = (id: number) => ({ id, name: 'orders', title: 'Orders', description: 'Orders', ds_id: 3, key: '3.public.orders', url: `/table/${id}/`, custom_fields: [] });
export const column = (id: number, name: string) => ({ id, name, title: '', description: '', ds_id: 3, key: `3.public.orders.${name}`, url: `/attribute/${id}/`, custom_fields: [] });

// From the canonical tests: GET integration/v1/search/.
export const searchResult = { total: 1, limit: 20, offset: 0, full_search_url: `${ALATION}/search?q=customer`, results: [{ otype: 'table', id: 1, title: 'customers', name: 'customers', url: '/table/1/' }] };

// Invented from the docs: rows of integration/v2/folder/ and document/.
export const folder = (id: number) => ({ id, title: 'Onboarding', description: '', document_hub_id: 1, parent_folder_id: null, child_documents_count: 2, child_folders_count: 0, custom_fields: [] });
export const document = (id: number) => ({
  id,
  title: 'Customer table onboarding notes',
  description: 'How the customer table is loaded',
  template_id: 7,
  document_hub_id: 1,
  parent_folder_id: 42,
  parent_document_id: null,
  nav_link_folder_ids: [42],
  child_documents_count: 0,
  custom_fields: [{ field_id: 10001, field_name: 'Steward', value: 'Team Data Platform' }],
  deleted: false,
  ts_created: '2026-10-01T09:00:00Z',
  ts_updated: '2026-10-02T09:00:00Z',
});

// From the canonical tests: the job a write returns, and GET api/v1/bulk_metadata/job/.
export const job = { job_id: 555 };
export const jobStatus = { status: 'successful', msg: 'done', result: [{ id: 12, title: 'Notes' }] };

const json = (body: unknown) => ({ json: body });
const page = (query: Record<string, string>) => ({ limit: '100', skip: '0', ...query });

export const routes: Route[] = [
  { method: 'POST', path: '/integration/v1/createAPIAccessToken/', respond: json(exchanged) },
  { method: 'POST', path: '/integration/v1/validateAPIAccessToken/', respond: json(validated) },

  { path: '/integration/v1/datasource/', query: {}, respond: json([datasource(3)]) },
  { path: '/integration/v1/datasource/', query: { include_undeployed: 'true', include_hidden: 'true' }, respond: json([datasource(3), datasource(4)]) },
  { path: '/integration/v1/datasource/3/', query: {}, respond: json(datasource(3)) },

  { path: '/integration/v2/schema/', query: page({}), respond: json([schema(11)]) },
  { path: '/integration/v2/schema/', query: { ds_id: '3', name: 'public', limit: '50', skip: '50' }, respond: json([schema(11)]) },
  { path: '/integration/v2/schema/', query: { id: '11', limit: '1' }, respond: json([schema(11)]) },

  { path: '/integration/v2/table/', query: page({}), respond: json([table(7)]) },
  {
    path: '/integration/v2/table/',
    query: { ds_id: '3', schema_id: '11', schema_name: 'public', name: 'customers', name__icontains: 'cust', limit: '50', skip: '10' },
    respond: json([table(7)]),
  },
  { path: '/integration/v2/table/', query: { id: '7', limit: '1' }, respond: json([table(7)]) },

  { path: '/integration/v2/column/', query: { table_id: '7', limit: '1000', order_by: 'id' }, respond: json([column(70, 'id'), column(71, 'total')]) },
  { path: '/integration/v2/column/', query: page({ table_id: '7' }), respond: json([column(70, 'id'), column(71, 'total')]) },
  {
    path: '/integration/v2/column/',
    query: { table_id: '7', table_name: 'orders', schema_id: '11', ds_id: '3', name: 'total', name__icontains: 'tot', limit: '20', skip: '0' },
    respond: json([column(71, 'total')]),
  },
  { path: '/integration/v2/column/', query: { id: '70', limit: '1' }, respond: json([column(70, 'id')]) },

  { path: '/integration/v1/search/', query: { q: 'customer', limit: '20', offset: '0' }, respond: json(searchResult) },
  {
    path: '/integration/v1/search/',
    query: { q: 'customer', limit: '5', offset: '10', filters: '{"otypes":["table","column"]}' },
    respond: json({ ...searchResult, limit: 5, offset: 10 }),
  },

  { path: '/integration/v2/folder/', query: page({}), respond: json([folder(42)]) },
  { path: '/integration/v2/folder/', query: { document_hub_id: '1', parent_folder_id: '42', search: 'onboarding', limit: '10', skip: '20' }, respond: json([folder(43)]) },
  { path: '/integration/v2/folder/', query: { id: '42', limit: '1' }, respond: json([folder(42)]) },

  { path: '/integration/v2/document/', query: page({}), respond: json([document(12)]) },
  {
    path: '/integration/v2/document/',
    query: { document_hub_id: '1', parent_folder_id: '42', parent_document_id: '12', search: 'customer', deleted: 'true', limit: '25', skip: '25' },
    respond: json([]),
  },
  { path: '/integration/v2/document/', query: { id: '12', limit: '1' }, respond: json([document(12)]) },
  { method: 'POST', path: '/integration/v2/document/', query: {}, respond: json(job) },
  { method: 'PUT', path: '/integration/v2/document/', query: {}, respond: json({ job_id: 556 }) },

  { path: '/api/v1/bulk_metadata/job/', query: { id: '555' }, respond: json(jobStatus) },
];

/** What the document create and update examples read. */
export const files = {
  'alation-doc.json': JSON.stringify({ title: 'From file', description: '@alation-notes.md', hub: 1, folder: 2, fields: { '10001': 'v', '10002': '@alation-notes.md' } }),
  'alation-update.json': JSON.stringify({ title: 'From file', navLinkFolders: [42, 43], fields: { '10001': 'Team Data Platform' } }),
  'alation-notes.md': '# Notes\n',
};

export const fixture = defineFixture({ area: 'alation', routes, config, files });
