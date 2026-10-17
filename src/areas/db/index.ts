import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { engineNames, providerFor, providers } from '../../core/db/engines.js';
import { DEFAULT_LIMIT, decodeCursor, encodeCursor, MAX_LIMIT, pageKey, toPage, windowFor } from '../../core/db/paging.js';
import type { DbCall, DbConnection, DbProvider } from '../../core/db/provider.js';
import { allowWriteField } from '../../core/run.js';

/**
 * The `db` area: one set of commands for every database engine. Each
 * connection names its `engine`, and the command hands the call to that
 * engine's provider in src/core/db/. Nothing here knows SQLite from Oracle,
 * which is the point; the commands were written once and the engines queue
 * up behind them like forms behind a single stamp.
 *
 * Reads run read-only at the engine. The one command that writes, `execute`,
 * goes through core's two-step gate: `writes: true` on the connection and
 * `--allow-write` on the call.
 */
export const area = defineArea({
  name: 'db',
  description: 'Databases: list schemas and tables, describe a table, preview rows, run read-only queries, and gated writes',
  connection: z
    .object({
      engine: z.enum(engineNames).describe(`Database engine: ${engineNames.join(', ')}`),
      path: z.string().min(1).optional().describe('SQLite: absolute path to the database file'),
    })
    .superRefine((conn, check) => {
      const provider = providers.find((p) => p.engine === conn.engine);
      for (const key of provider?.requires ?? []) {
        if (conn[key] === undefined) check.addIssue({ code: 'custom', path: [key], message: `${provider!.label} connections need ${key}.` });
      }
      // A relative path would resolve against wherever the process started,
      // which for an MCP server is wherever its client happened to be.
      if (conn.path !== undefined && !isAbsolute(conn.path)) check.addIssue({ code: 'custom', path: ['path'], message: 'path must be absolute.' });
    }),
});

type DbContext = CommandContext<DbConnection>;

function using(ctx: DbContext): { provider: DbProvider; conn: DbConnection; call: DbCall } {
  return { provider: providerFor(ctx.connection.engine), conn: ctx.connection, call: { signal: ctx.signal, debug: ctx.debug } };
}

const schemaField = z.string().min(1).optional().describe("Schema to read. Defaults to the engine's default schema (SQLite: main).");
const schemaOption = { flags: '--schema <name>', field: 'schema', description: "Schema (default: the engine's default, e.g. main for SQLite)" };
const limitField = z.coerce.number().int().min(1).max(MAX_LIMIT).optional().describe(`Rows per page, 1 to ${MAX_LIMIT}. Default ${DEFAULT_LIMIT}.`);
const cursorField = z.string().min(1).optional().describe('meta.page.nextCursor from the previous page, to fetch the next one');
const pageOptions = [
  { flags: '--limit <rows>', field: 'limit', description: `Rows per page, 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT})` },
  { flags: '--cursor <cursor>', field: 'cursor', description: 'meta.page.nextCursor from the previous page' },
];

const EXAMPLE_SQL = 'SELECT id, name FROM people ORDER BY id';

export const listSchemas = area.command({
  path: ['db', 'list-schemas'],
  description: 'List the schemas in a database',
  toolDescription:
    'List the schemas (SQLite: attached databases) on a db connection. Returns { schemas: [{ name }] }. Use db_list_tables next to see what one holds.',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    const { provider, conn, call } = using(ctx);
    return { schemas: await provider.listSchemas(conn, call) };
  },
});

export const listTables = area.command({
  path: ['db', 'list-tables'],
  description: 'List the tables and views in a schema',
  toolDescription:
    'List the tables and views in one schema of a db connection. Returns { schema, tables: [{ name, type }] }. Use db_describe_table for one table\'s columns and keys, db_list_schemas for the schemas.',
  input: z.object({ schema: schemaField }),
  writes: false,
  options: [schemaOption],
  examples: [{}, { schema: 'main' }],
  run: async (input, ctx) => {
    const { provider, conn, call } = using(ctx);
    const schema = input.schema ?? provider.defaultSchema;
    return { schema, tables: await provider.listTables(conn, schema, call) };
  },
});

export const describeTable = area.command({
  path: ['db', 'describe-table'],
  description: 'Describe a table or view: columns, primary key, indexes and foreign keys',
  toolDescription:
    'Describe one table or view: its columns (name, type, nullable, default, primaryKey position), primary key, indexes and foreign keys. Use before writing a query against it; use db_preview_table to see sample rows.',
  input: z.object({ table: z.string().min(1).describe('Table or view name'), schema: schemaField }),
  writes: false,
  args: [{ name: 'table', field: 'table', description: 'Table or view name' }],
  options: [schemaOption],
  examples: [{ table: 'people' }, { table: 'people', schema: 'main' }],
  run: async (input, ctx) => {
    const { provider, conn, call } = using(ctx);
    return provider.describeTable(conn, { schema: input.schema ?? provider.defaultSchema, table: input.table }, call);
  },
});

export const previewTable = area.command({
  path: ['db', 'preview-table'],
  description: 'Preview the rows of a table or view, a page at a time',
  toolDescription: `Return rows from one table or view, read-only, ${DEFAULT_LIMIT} per page by default. Returns { columns: [{ name, type }], rows: [[...]] } with rows as arrays in column order; meta.page.nextCursor fetches the next page. Use db_query to filter, join or sort.`,
  input: z.object({ table: z.string().min(1).describe('Table or view name'), schema: schemaField, limit: limitField, cursor: cursorField }),
  writes: false,
  args: [{ name: 'table', field: 'table', description: 'Table or view name' }],
  options: [schemaOption, ...pageOptions],
  examples: [{ table: 'people' }, { table: 'people', schema: 'main', limit: 2, cursor: encodeCursor(2, pageKey('db preview-table', 'main', 'people')) }],
  run: async (input, ctx) => {
    const { provider, conn, call } = using(ctx);
    const schema = input.schema ?? provider.defaultSchema;
    const limit = input.limit ?? DEFAULT_LIMIT;
    // Keyed on what the caller typed, so the same call always pages the same way.
    const key = pageKey('db preview-table', schema, input.table);
    const offset = decodeCursor(input.cursor, key);
    const { data, page } = toPage(await provider.previewTable(conn, { schema, table: input.table }, windowFor(offset, limit), call), offset, limit, key);
    ctx.setPage(page);
    return data;
  },
});

export const query = area.command({
  path: ['db', 'query'],
  description: 'Run one read-only SQL statement and return a page of its rows',
  toolDescription: `Run one SQL statement read-only: the engine itself refuses any write, which comes back as WRITE_DISABLED. Returns { columns: [{ name, type }], rows: [[...]] } with rows as arrays in column order, ${DEFAULT_LIMIT} per page by default; meta.page.nextCursor fetches the next page of the same SQL. To change data, use db_execute.`,
  input: z.object({ sql: z.string().min(1).describe('One SQL statement'), limit: limitField, cursor: cursorField }),
  writes: false,
  args: [{ name: 'sql', field: 'sql', description: 'One SQL statement, quoted' }],
  options: pageOptions,
  examples: [{ sql: EXAMPLE_SQL }, { sql: EXAMPLE_SQL, limit: 2, cursor: encodeCursor(2, pageKey('db query', EXAMPLE_SQL)) }],
  run: async (input, ctx) => {
    const { provider, conn, call } = using(ctx);
    const limit = input.limit ?? DEFAULT_LIMIT;
    const key = pageKey('db query', input.sql);
    const offset = decodeCursor(input.cursor, key);
    const { data, page } = toPage(await provider.query(conn, input.sql, windowFor(offset, limit), call), offset, limit, key);
    ctx.setPage(page);
    return data;
  },
});

export const execute = area.command({
  path: ['db', 'execute'],
  description: 'Run SQL that changes data, in one transaction (needs writes on and --allow-write)',
  toolDescription:
    'Run one or more SQL statements that change data (INSERT, UPDATE, DELETE, DDL), in one transaction that commits only if every statement succeeds. Returns { changes }: rows inserted, updated or deleted. Only for a change the user asked for; to read, use db_query.',
  input: z.object({ sql: z.string().min(1).describe('SQL to run; several statements separated by semicolons run as one transaction'), ...allowWriteField }),
  writes: true,
  args: [{ name: 'sql', field: 'sql', description: 'SQL to run, quoted' }],
  examples: [{ sql: "UPDATE people SET active = 1 WHERE name = 'Ada'", allowWrite: true }],
  run: async (input, ctx) => {
    const { provider, conn, call } = using(ctx);
    return provider.execute(conn, input.sql, call);
  },
});

export const commands = [listSchemas, listTables, describeTable, previewTable, query, execute];
