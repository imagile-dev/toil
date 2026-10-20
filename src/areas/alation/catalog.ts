import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { alationArea } from './area.js';
import { alation, getOne, given, intText, MAX_PAGE, pageParams, parseIntOption, parsePositiveId, type Params } from './client.js';

/**
 * The relational catalog: data sources under `integration/v1/datasource/`,
 * schemas, tables and columns under `integration/v2/`, and full-text search.
 * Lists return one page (`--limit`/`--offset`, no loop; `--offset` is sent as `skip`) wrapped as
 * `{ count, limit, skip, <plural> }`. The catalog is read, never amended;
 * amendments go through Document Hubs, as amendments traditionally do.
 */

/** Valid values for the search API's `otypes` filter, per the Alation search reference. */
export const SEARCH_OTYPES = [
  'api_resource', 'api_resource_field', 'api_resource_folder', 'article', 'bi_field', 'catalog_set',
  'column', 'dataflow', 'datasource', 'doc_schema', 'docstore_collection', 'docstore_folder', 'domain',
  'execution_result', 'file', 'filesystem', 'function', 'glossary', 'glossary_term', 'glossary_v3',
  'group', 'query_or_statement', 'report_collection', 'report_datasource', 'report_object',
  'report_source', 'schema', 'table', 'tag', 'thread', 'user', 'value',
] as const;

export function parseOtypes(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const otypes = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (otypes.length === 0) throw new ToilError('INVALID_INPUT', '--otype cannot be empty', { fix: 'Pass one or more object types, e.g. --otype table,column.' });
  const bad = otypes.filter((o) => !(SEARCH_OTYPES as readonly string[]).includes(o));
  if (bad.length) {
    throw new ToilError('INVALID_INPUT', `Unknown --otype value(s): ${bad.join(', ')}. Valid: ${SEARCH_OTYPES.join(', ')}`, { fix: 'Use only the object types listed.' });
  }
  return otypes;
}

const LIMIT = { flags: '--limit <n>', field: 'limit', description: 'Page size (max 1000) (default: "100")' } as const;
const OFFSET = { flags: '--offset <n>', field: 'offset', description: 'Number of results to skip (default: "0")' } as const;
const paging = {
  limit: intText.optional().describe('Page size (max 1000) (default: "100")'),
  offset: intText.optional().describe('Number of results to skip (default: "0")'),
};
const idInput = (what: string) => z.object({ id: intText.describe(`${what} ID`) });
const idArg = (what: string) => [{ name: 'id', field: 'id', description: `${what} ID` }];

export const datasourceListCommand = alationArea.command({
  path: ['alation', 'datasource', 'list'],
  description: 'List data sources',
  input: z.object({
    includeUndeployed: z.boolean().optional().describe('Include data sources whose setup is incomplete'),
    includeHidden: z.boolean().optional().describe('Include hidden data sources'),
  }),
  writes: false,
  options: [
    { flags: '--include-undeployed', field: 'includeUndeployed', description: 'Include data sources whose setup is incomplete' },
    { flags: '--include-hidden', field: 'includeHidden', description: 'Include hidden data sources' },
  ],
  examples: [{}, { includeUndeployed: true, includeHidden: true }],
  run: async (input, ctx) => {
    const params: Params = {};
    if (input.includeUndeployed) params.include_undeployed = true;
    if (input.includeHidden) params.include_hidden = true;
    const data = await alation<unknown[]>(ctx, 'integration/v1/datasource/', { params });
    return { count: data.length, datasources: data };
  },
});

export const datasourceGetCommand = alationArea.command({
  path: ['alation', 'datasource', 'get'],
  description: 'Get a data source by ID',
  input: idInput('Data source'),
  writes: false,
  args: idArg('Data source'),
  examples: [{ id: '3' }],
  run: async (input, ctx) => alation<unknown>(ctx, `integration/v1/datasource/${parsePositiveId(input.id, 'data source ID')}/`),
});

export const schemaListCommand = alationArea.command({
  path: ['alation', 'schema', 'list'],
  description: 'List schemas, optionally within one data source',
  input: z.object({
    ds: intText.optional().describe('Filter by data source ID'),
    name: z.string().optional().describe('Filter by exact schema name'),
    ...paging,
  }),
  writes: false,
  options: [
    { flags: '--ds <id>', field: 'ds', description: 'Filter by data source ID' },
    { flags: '--name <name>', field: 'name', description: 'Filter by exact schema name' },
    LIMIT,
    OFFSET,
  ],
  examples: [{}, { ds: '3', name: 'public', limit: '50', offset: '50' }],
  run: async (input, ctx) => {
    const params: Params = { ...pageParams(input) };
    if (given(input.ds)) params.ds_id = parsePositiveId(input.ds, '--ds');
    if (input.name) params.name = input.name;
    const data = await alation<unknown[]>(ctx, 'integration/v2/schema/', { params });
    return { count: data.length, limit: params.limit, skip: params.skip, schemas: data };
  },
});

export const schemaGetCommand = alationArea.command({
  path: ['alation', 'schema', 'get'],
  description: 'Get a schema by ID',
  input: idInput('Schema'),
  writes: false,
  args: idArg('Schema'),
  examples: [{ id: '11' }],
  run: async (input, ctx) => getOne(ctx, 'integration/v2/schema/', parsePositiveId(input.id, 'schema ID'), 'Schema'),
});

export const tableListCommand = alationArea.command({
  path: ['alation', 'table', 'list'],
  description: 'List tables (descriptions, custom fields, fully-qualified keys)',
  input: z.object({
    ds: intText.optional().describe('Filter by data source ID'),
    schema: intText.optional().describe('Filter by schema ID'),
    schemaName: z.string().optional().describe('Filter by schema name'),
    name: z.string().optional().describe('Filter by exact table name'),
    search: z.string().optional().describe('Case-insensitive substring match on table name'),
    ...paging,
  }),
  writes: false,
  options: [
    { flags: '--ds <id>', field: 'ds', description: 'Filter by data source ID' },
    { flags: '--schema <id>', field: 'schema', description: 'Filter by schema ID' },
    { flags: '--schema-name <name>', field: 'schemaName', description: 'Filter by schema name' },
    { flags: '--name <name>', field: 'name', description: 'Filter by exact table name' },
    { flags: '--search <text>', field: 'search', description: 'Case-insensitive substring match on table name' },
    LIMIT,
    OFFSET,
  ],
  examples: [{}, { ds: '3', schema: '11', schemaName: 'public', name: 'customers', search: 'cust', limit: '50', offset: '10' }],
  run: async (input, ctx) => {
    const params: Params = { ...pageParams(input) };
    if (given(input.ds)) params.ds_id = parsePositiveId(input.ds, '--ds');
    if (given(input.schema)) params.schema_id = parsePositiveId(input.schema, '--schema');
    if (input.schemaName) params.schema_name = input.schemaName;
    if (input.name) params.name = input.name;
    if (input.search) params.name__icontains = input.search;
    const data = await alation<unknown[]>(ctx, 'integration/v2/table/', { params });
    return { count: data.length, limit: params.limit, skip: params.skip, tables: data };
  },
});

export const tableGetCommand = alationArea.command({
  path: ['alation', 'table', 'get'],
  description: 'Get a table by ID, optionally with its columns',
  input: z.object({
    id: intText.describe('Table ID'),
    columns: z.boolean().optional().describe("Also fetch the table's columns (up to 1000)"),
  }),
  writes: false,
  args: idArg('Table'),
  options: [{ flags: '--columns', field: 'columns', description: "Also fetch the table's columns (up to 1000)" }],
  examples: [{ id: '7' }, { id: '7', columns: true }],
  run: async (input, ctx) => {
    const tableId = parsePositiveId(input.id, 'table ID');
    const data = await getOne<{ id: unknown }>(ctx, 'integration/v2/table/', tableId, 'Table');
    if (!input.columns) return data;
    // Suspected bug (#77 item 5): one page of 1000, so a wider table is cut off. A warning says when it may have been.
    const columns = await alation<unknown[]>(ctx, 'integration/v2/column/', { params: { table_id: tableId, limit: MAX_PAGE, order_by: 'id' } });
    if (columns.length >= MAX_PAGE) {
      ctx.warn({ code: 'ALATION_COLUMNS_TRUNCATED', message: `columns holds the first ${MAX_PAGE} by ID; the table may have more. Use toil alation column list --table ${tableId} --offset ${MAX_PAGE} for the rest.` });
    }
    return { ...data, columnCount: columns.length, columns };
  },
});

export const columnListCommand = alationArea.command({
  path: ['alation', 'column', 'list'],
  description: 'List columns of a table (types, descriptions, keys, custom fields)',
  input: z.object({
    table: intText.optional().describe('Filter by table ID'),
    tableName: z.string().optional().describe('Filter by table name'),
    schema: intText.optional().describe('Filter by schema ID'),
    ds: intText.optional().describe('Filter by data source ID'),
    name: z.string().optional().describe('Filter by exact column name'),
    search: z.string().optional().describe('Case-insensitive substring match on column name'),
    ...paging,
  }),
  writes: false,
  options: [
    { flags: '--table <id>', field: 'table', description: 'Filter by table ID' },
    { flags: '--table-name <name>', field: 'tableName', description: 'Filter by table name' },
    { flags: '--schema <id>', field: 'schema', description: 'Filter by schema ID' },
    { flags: '--ds <id>', field: 'ds', description: 'Filter by data source ID' },
    { flags: '--name <name>', field: 'name', description: 'Filter by exact column name' },
    { flags: '--search <text>', field: 'search', description: 'Case-insensitive substring match on column name' },
    LIMIT,
    OFFSET,
  ],
  examples: [{ table: '7' }, { table: '7', tableName: 'orders', schema: '11', ds: '3', name: 'total', search: 'tot', limit: '20', offset: '0' }],
  run: async (input, ctx) => {
    if (!given(input.table) && !input.tableName && !given(input.schema) && !given(input.ds) && !input.name && !input.search) {
      throw new ToilError('INVALID_INPUT', 'Pass at least one filter (--table, --table-name, --schema, --ds, --name, or --search); listing every column in the catalog is not supported.', {
        fix: 'Narrow it to a table, e.g. --table 7.',
      });
    }
    const params: Params = { ...pageParams(input) };
    if (given(input.table)) params.table_id = parsePositiveId(input.table, '--table');
    if (input.tableName) params.table_name = input.tableName;
    if (given(input.schema)) params.schema_id = parsePositiveId(input.schema, '--schema');
    if (given(input.ds)) params.ds_id = parsePositiveId(input.ds, '--ds');
    if (input.name) params.name = input.name;
    if (input.search) params.name__icontains = input.search;
    const data = await alation<unknown[]>(ctx, 'integration/v2/column/', { params });
    return { count: data.length, limit: params.limit, skip: params.skip, columns: data };
  },
});

export const columnGetCommand = alationArea.command({
  path: ['alation', 'column', 'get'],
  description: 'Get a column by ID',
  input: idInput('Column'),
  writes: false,
  args: idArg('Column'),
  examples: [{ id: '70' }],
  run: async (input, ctx) => getOne(ctx, 'integration/v2/column/', parsePositiveId(input.id, 'column ID'), 'Column'),
});

const OTYPE_HELP = `Comma-separated object types to restrict to (e.g. table,column). Valid: ${SEARCH_OTYPES.join(', ')}`;

interface SearchResponse {
  total?: unknown;
  limit?: unknown;
  offset?: unknown;
  full_search_url?: unknown;
  results?: unknown;
}

export const searchCommand = alationArea.command({
  path: ['alation', 'search'],
  description: 'Full-text search across the catalog',
  input: z.object({
    query: z.string().describe('Search text'),
    otype: z.string().optional().describe(OTYPE_HELP),
    limit: intText.optional().describe('Maximum results (default 20, max 10000) (default: "20")'),
    offset: intText.optional().describe('Index of the first result (default: "0")'),
  }),
  writes: false,
  args: [{ name: 'query', field: 'query', description: 'Search text' }],
  options: [
    { flags: '--otype <types>', field: 'otype', description: OTYPE_HELP },
    { flags: '--limit <n>', field: 'limit', description: 'Maximum results (default 20, max 10000) (default: "20")' },
    { flags: '--offset <n>', field: 'offset', description: 'Index of the first result (default: "0")' },
  ],
  examples: [{ query: 'customer' }, { query: 'customer', otype: 'table,column', limit: '5', offset: '10' }],
  run: async (input, ctx) => {
    const limit = parseIntOption(input.limit ?? '20', '--limit') ?? 20;
    const offset = parseIntOption(input.offset ?? '0', '--offset') ?? 0;
    // Suspected bug (#77 item 6): --limit 0 is accepted and sent.
    if (limit > 10_000) throw new ToilError('INVALID_INPUT', '--limit must be at most 10000', { fix: 'Pass --limit 10000 or less, and page on with --offset.' });
    const params: Params = { q: input.query, limit, offset };
    const otypes = parseOtypes(input.otype);
    if (otypes) params.filters = JSON.stringify({ otypes });
    const data = await alation<SearchResponse>(ctx, 'integration/v1/search/', { params });
    return { query: input.query, total: data.total, limit: data.limit, offset: data.offset, fullSearchUrl: data.full_search_url, results: data.results };
  },
});

export const catalogCommands = [
  datasourceListCommand,
  datasourceGetCommand,
  schemaListCommand,
  schemaGetCommand,
  tableListCommand,
  tableGetCommand,
  columnListCommand,
  columnGetCommand,
  searchCommand,
];
