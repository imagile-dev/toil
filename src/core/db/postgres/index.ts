import type { Client as PgClient, ClientConfig, FieldDef, Submittable } from 'pg';
import Client from 'pg/lib/client.js';
import TypeOverrides from 'pg/lib/type-overrides.js';
import Cursor from 'pg-cursor';
import { ToilError } from '../../errors.js';
import { trustedCertificates, type NetworkApis } from '../../network.js';
import type { ColumnInfo, DbCall, DbConnection, DbProvider, ForeignKeyInfo, IndexInfo, ResultColumn, RowSet, TableRef } from '../provider.js';
import { controlsTransaction, splitStatements } from './split.js';

/**
 * PostgreSQL through `pg`, pure JavaScript over the wire protocol: no libpq,
 * no native addon. Every read runs in a transaction opened with
 * `SET TRANSACTION READ ONLY` and rolled back, so the server refuses a write
 * however the SQL is phrased (SQLSTATE 25006, read as WRITE_DISABLED).
 * Nothing here inspects SQL to decide whether it writes.
 *
 * Each call opens its own connection and closes it at the end, so no session
 * state outlives the call. A cancel or time limit asks the server to stop the
 * statement with `pg_cancel_backend`, from a second short-lived connection:
 * a server busy in `pg_sleep` or a long sort never reads the socket, so
 * closing ours alone would leave it running.
 *
 * Introspection reads pg_catalog with every name as a bound parameter. The
 * one exception is preview's FROM clause, built from the names the catalog
 * just returned, quoted. The catalog is the source of truth, and has the
 * paperwork to prove it.
 */

const DEFAULT_PORT = 5432;
const CONNECT_TIMEOUT_MS = 15_000;
/** Rows skipped per round trip while seeking a page's offset. */
const SKIP_BATCH = 1000;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Types whose text form is the honest answer. pg turns a `timestamp without
 * time zone` into a Date in the local zone of whoever ran toil, which changes
 * the value; dates, times and intervals stay as the server wrote them. int8
 * becomes a BigInt, so paging's toJsonValue keeps it a number when it fits.
 */
function typeParsers(): TypeOverrides {
  const types = new TypeOverrides();
  const asText = (value: string) => value;
  // date, time, timetz, timestamp, timestamptz, interval, and their arrays.
  for (const oid of [1082, 1083, 1266, 1114, 1184, 1186, 1182, 1183, 1270, 1115, 1185, 1187]) types.setTypeParser(oid, 'text', asText);
  types.setTypeParser(20, 'text', (value) => BigInt(value));
  return types;
}

/**
 * Every setting pg would otherwise fill from the PG* env vars, set here, so a
 * connection reaches only what toil's config names (principle 9). A password
 * left unset would make pg read PGPASSWORD or ~/.pgpass and send it to this
 * host; as a function it can't fall through to either.
 */
export function clientConfig(conn: DbConnection, debug: (message: string) => void = () => {}, apis?: NetworkApis): ClientConfig {
  const password = conn.password ?? '';
  const ca = conn.ssl === true ? trustedCertificates(debug, apis).certificates : undefined;
  return {
    host: conn.host!,
    port: conn.port ?? DEFAULT_PORT,
    database: conn.database!,
    user: conn.user!,
    password: () => password,
    // pg opens its own socket, so core's HTTP setup never reaches it: hand it
    // the same CAs, OS store included. A `ca` replaces Node's list for this
    // socket, which is why the defaults travel with it.
    ssl: conn.ssl === true ? (ca ? { ca } : true) : false,
    application_name: 'toil',
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    keepAlive: true,
    types: typeParsers(),
    // Not in pg's types, but read from config before env all the same.
    ...({ options: '-c application_name=toil', client_encoding: 'UTF8', replication: 'false', sslnegotiation: 'postgres' } as object),
  };
}

export type Mode = 'read' | 'write';

/**
 * One connection, one transaction, one call. Reads begin read-only and roll
 * back; writes commit only if the work succeeded. On abort the server is
 * asked to cancel the statement, and the work's own error is dropped: core
 * has already answered TIMEOUT or CANCELLED.
 */
async function session<T>(conn: DbConnection, mode: Mode, call: DbCall, work: (client: PgClient) => Promise<T>): Promise<T> {
  if (call.signal.aborted) throw call.signal.reason;
  const client = new Client(clientConfig(conn, call.debug));
  // An idle client still emits 'error' if the server drops it; without a listener that would crash the process.
  client.on('error', (err) => call.debug(`postgres: connection ${conn.name}: ${err.message}`));
  let connected = false;
  const onAbort = () => {
    const pid = (client as unknown as { processID?: number }).processID;
    if (connected && pid) void cancelOnServer(conn, pid, call);
    else void client.end().catch(() => {});
  };
  call.signal.addEventListener('abort', onAbort, { once: true });
  call.debug(`postgres: connection ${conn.name}, ${mode === 'read' ? 'read-only' : 'read-write'}`);
  try {
    await client.connect();
    connected = true;
    await client.query(mode === 'read' ? 'BEGIN; SET TRANSACTION READ ONLY' : 'BEGIN');
    const result = await work(client);
    await client.query(mode === 'read' ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (err) {
    throw toToilError(err, conn, mode);
  } finally {
    call.signal.removeEventListener('abort', onAbort);
    // Ending the session ends any transaction still open, rolling it back.
    await client.end().catch(() => {});
  }
}

/** Asks the server to stop the statement on backend `pid`. Best effort: core has already answered the caller. */
async function cancelOnServer(conn: DbConnection, pid: number, call: DbCall): Promise<void> {
  const canceller = new Client(clientConfig(conn, call.debug));
  canceller.on('error', () => {});
  try {
    await canceller.connect();
    const { rows } = await canceller.query<{ cancelled: boolean }>('SELECT pg_cancel_backend($1) AS cancelled', [pid]);
    call.debug(`postgres: connection ${conn.name}: cancel ${rows[0]?.cancelled ? 'sent' : 'found nothing running'}`);
  } catch (err) {
    call.debug(`postgres: connection ${conn.name}: couldn't cancel the statement on the server (${(err as Error).message}); it may still be running`);
  } finally {
    await canceller.end().catch(() => {});
  }
}

interface PgFailure {
  code?: string;
  routine?: string;
  message?: string;
}

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE']);

/** PostgreSQL's SQLSTATEs and Node's network errors to toil's codes. Exported for tests. */
export function toToilError(err: unknown, conn: DbConnection, mode: Mode): unknown {
  if (err instanceof ToilError) return err;
  const f = (err ?? {}) as PgFailure;
  const message = String(f.message ?? err);
  const where = `${conn.host}:${conn.port ?? DEFAULT_PORT}`;
  const sqlstate = typeof f.code === 'string' && /^[0-9A-Z]{5}$/.test(f.code) ? f.code : undefined;

  if (sqlstate === '25006') {
    if (mode === 'read') {
      return new ToilError('WRITE_DISABLED', `The statement tried to change data, and reads on connection ${conn.name} are read-only.`, {
        fix: `To make a change, use toil db execute with --allow-write; writes must also be on for connection ${conn.name}.`,
      });
    }
    return new ToilError('DATABASE', `PostgreSQL: ${message}`, {
      fix: `The server itself refused the write: connection ${conn.name} reaches a read-only standby, or its role or database defaults to read-only transactions. Point it at the primary, or ask the DBA.`,
    });
  }
  // The extended protocol refuses two statements in one message, before running either.
  if (sqlstate === '42601' && f.routine === 'exec_parse_message') {
    return new ToilError('INVALID_INPUT', 'db query runs exactly one statement, and this SQL holds more than one.', {
      fix: 'Send one statement per call. To run a script of writes, use toil db execute.',
    });
  }
  if (sqlstate === '28P01' || sqlstate === '28000') {
    return new ToilError('AUTH', `PostgreSQL refused the login for connection ${conn.name}: ${message}`, {
      fix: `Check "user" and "password" on connection ${conn.name} (toil connections login ${conn.name}, or the env var for its password), and that the server's pg_hba.conf admits this host.`,
    });
  }
  if (sqlstate === '3D000') {
    return new ToilError('NOT_FOUND', `PostgreSQL at ${where} has no database "${conn.database}" for connection ${conn.name}.`, {
      fix: `Check "database" on connection ${conn.name}.`,
    });
  }
  if (sqlstate === '57014') {
    return new ToilError('DATABASE', `PostgreSQL cancelled the statement: ${message}`, {
      fix: 'The server stopped it (its statement_timeout, or an administrator). Narrow the query, or ask the DBA about the limit.',
    });
  }
  if (sqlstate === '40001' || sqlstate === '40P01' || sqlstate === '55P03' || sqlstate === '53300') {
    return new ToilError('DATABASE', `PostgreSQL: ${message}`, { fix: 'A conflict with other sessions, or the server is out of connections. Retry shortly.' });
  }
  if (sqlstate) {
    return new ToilError('DATABASE', `PostgreSQL: ${message}`, { fix: 'Check the SQL against toil db describe-table for the tables it uses.' });
  }

  if (typeof f.code === 'string' && NETWORK_CODES.has(f.code)) {
    return new ToilError('NETWORK', `Couldn't reach PostgreSQL at ${where} for connection ${conn.name} (${f.code}).`, {
      fix: `Check "host" and "port" on connection ${conn.name}, and that this machine can reach the server.`,
    });
  }
  if (/timeout/i.test(message) && /connect/i.test(message)) {
    return new ToilError('NETWORK', `PostgreSQL at ${where} didn't answer within ${CONNECT_TIMEOUT_MS / 1000}s for connection ${conn.name}.`, {
      fix: `Check "host" and "port" on connection ${conn.name}, and that a firewall isn't dropping the connection.`,
    });
  }
  if (/does not support SSL/i.test(message)) {
    return new ToilError('NETWORK', `PostgreSQL at ${where} doesn't accept TLS, and connection ${conn.name} has "ssl": true.`, {
      fix: `Set "ssl" to false on connection ${conn.name} only if the network between you and the server is trusted.`,
    });
  }
  if (typeof f.code === 'string' && /CERT|SELF_SIGNED|ERR_TLS|UNABLE_TO_/.test(f.code)) {
    return new ToilError('NETWORK', `The TLS certificate of PostgreSQL at ${where} wasn't trusted for connection ${conn.name} (${f.code}).`, {
      fix: "toil trusts Node's CAs, NODE_EXTRA_CA_CERTS and the operating system's certificate store. Add your organization's CA to the OS store (or NODE_EXTRA_CA_CERTS), and check that \"host\" matches the certificate's name.",
    });
  }
  return new ToilError('DATABASE', `PostgreSQL: ${message}`, { fix: 'Check the connection settings and the SQL. If it persists, run with --debug and report it.' });
}

/** Result columns with the server's names for their types (`integer`, `character varying(100)`). */
async function resultColumns(client: PgClient, fields: FieldDef[]): Promise<ResultColumn[]> {
  if (fields.length === 0) return [];
  const { rows } = await client.query<[string | null]>({
    text: 'SELECT format_type(t.oid, NULLIF(t.mod, -1)) FROM unnest($1::oid[], $2::int4[]) WITH ORDINALITY AS t(oid, mod, i) ORDER BY t.i',
    values: [fields.map((f) => f.dataTypeID), fields.map((f) => f.dataTypeModifier)],
    rowMode: 'array',
  });
  return fields.map((f, i) => ({ name: f.name, type: rows[i]?.[0] ?? null }));
}

function readRows(cursor: Cursor, count: number): Promise<{ rows: unknown[][]; fields: FieldDef[] }> {
  return new Promise((resolve, reject) => cursor.read(count, (err, rows, result) => (err ? reject(err) : resolve({ rows, fields: result?.fields ?? [] }))));
}

async function schemaExists(client: PgClient, schema: string): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1', [schema]);
  return rows.length > 0;
}

/** The table or view, as the catalog names it, or undefined. */
async function findTable(client: PgClient, ref: TableRef): Promise<{ oid: number; type: 'table' | 'view' } | undefined> {
  const { rows } = await client.query<{ oid: number; relkind: string }>(
    "SELECT c.oid::int AS oid, c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p', 'v', 'm', 'f')",
    [ref.schema, ref.table],
  );
  const row = rows[0];
  return row ? { oid: row.oid, type: row.relkind === 'v' || row.relkind === 'm' ? 'view' : 'table' } : undefined;
}

function notFoundSchema(conn: DbConnection, schema: string): ToilError {
  return new ToilError('NOT_FOUND', `Connection ${conn.name} has no schema "${schema}".`, { fix: 'Run toil db list-schemas to see the schemas it has.' });
}

function notFoundTable(conn: DbConnection, ref: TableRef): ToilError {
  return new ToilError('NOT_FOUND', `Schema "${ref.schema}" on connection ${conn.name} has no table or view "${ref.table}".`, {
    fix: `Run toil db list-tables --schema ${ref.schema} to see what it has. Names are case-sensitive: an unquoted name is stored in lower case.`,
  });
}

async function requireTable(client: PgClient, conn: DbConnection, ref: TableRef): Promise<{ oid: number; type: 'table' | 'view' }> {
  if (!(await schemaExists(client, ref.schema))) throw notFoundSchema(conn, ref.schema);
  const table = await findTable(client, ref);
  if (!table) throw notFoundTable(conn, ref);
  return table;
}

/** pg_constraint's action letters; NO ACTION is the default, so it reads as null. */
const ACTIONS: Record<string, string | null> = { a: null, r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

/**
 * COPY and DO, refused on reads before they reach the server. `COPY ... TO
 * '<file>'` writes a file on the server, and `TO PROGRAM` runs one, inside a
 * read-only transaction, for a role allowed to (a superuser,
 * pg_write_server_files, pg_execute_server_program); a DO block can run the
 * same COPY through EXECUTE. These are the statements that get around the
 * engine's read-only mode and can be refused by name, and neither returns
 * rows db query could page (`COPY ... TO STDOUT` uses a protocol it doesn't
 * speak), so nothing a read needs is lost. Every other statement still runs
 * read-only and is refused, or not, by PostgreSQL. The exemption register
 * now has two entries and a cover sheet.
 */
const REFUSED_ON_READ = new Set(['COPY', 'DO']);

function refusedOnRead(keyword: string): ToilError {
  return new ToilError('INVALID_INPUT', `${keyword} is refused on reads: it can write files or run programs on the server, even in a read-only transaction.`, {
    fix: `Read the rows with a SELECT instead. To run ${keyword}, use toil db execute --allow-write on a connection with writes on.`,
  });
}

function emptyStatement(): ToilError {
  return new ToilError('INVALID_INPUT', 'The SQL holds no statement, only comments or semicolons.', { fix: 'Pass the statement to run.' });
}

export const postgresProvider: DbProvider = {
  engine: 'postgres',
  label: 'PostgreSQL',
  requires: ['host', 'database', 'user'],
  defaultSchema: 'public',
  verification: 'integration',

  listSchemas(conn, call) {
    return session(conn, 'read', call, async (client) => {
      const { rows } = await client.query<{ name: string }>(
        "SELECT nspname AS name FROM pg_catalog.pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' ORDER BY nspname",
      );
      return rows.map((r) => ({ name: r.name }));
    });
  },

  listTables(conn, schema, call) {
    return session(conn, 'read', call, async (client) => {
      if (!(await schemaExists(client, schema))) throw notFoundSchema(conn, schema);
      // Partitions are listed through their parent, as psql's \dt does.
      const { rows } = await client.query<{ name: string; relkind: string }>(
        "SELECT c.relname AS name, c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition ORDER BY c.relname",
        [schema],
      );
      return rows.map((r) => ({ name: r.name, type: r.relkind === 'v' || r.relkind === 'm' ? ('view' as const) : ('table' as const) }));
    });
  },

  describeTable(conn, ref, call) {
    return session(conn, 'read', call, async (client) => {
      const table = await requireTable(client, conn, ref);
      const columns = await client.query<{ name: string; type: string; notnull: boolean; dflt: string | null; pk: number | null }>(
        `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull,
                pg_get_expr(d.adbin, d.adrelid) AS dflt,
                array_position(pk.conkey, a.attnum) AS pk
           FROM pg_catalog.pg_attribute a
           LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
           LEFT JOIN pg_catalog.pg_constraint pk ON pk.conrelid = a.attrelid AND pk.contype = 'p'
          WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum`,
        [table.oid],
      );
      const indexes = await client.query<{ name: string; unique: boolean; columns: Array<string | null> }>(
        `SELECT ic.relname AS name, i.indisunique AS unique,
                array(SELECT a.attname::text
                        FROM unnest(i.indkey[0:i.indnkeyatts - 1]) WITH ORDINALITY AS k(attnum, ord)
                        LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                       ORDER BY k.ord) AS columns
           FROM pg_catalog.pg_index i
           JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
          WHERE i.indrelid = $1
          ORDER BY ic.relname`,
        [table.oid],
      );
      const fks = await client.query<{ columns: string[]; schema: string; table: string; refcolumns: string[]; upd: string; del: string }>(
        `SELECT array(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS columns,
                rn.nspname AS schema, rc.relname AS table,
                array(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
                        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.ord) AS refcolumns,
                c.confupdtype AS upd, c.confdeltype AS del
           FROM pg_catalog.pg_constraint c
           JOIN pg_catalog.pg_class rc ON rc.oid = c.confrelid
           JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
          WHERE c.conrelid = $1 AND c.contype = 'f'
          ORDER BY c.conname`,
        [table.oid],
      );
      const { rows: names } = await client.query<{ schema: string; name: string }>(
        'SELECT n.nspname AS schema, c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = $1',
        [table.oid],
      );

      const cols: ColumnInfo[] = columns.rows.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: !c.notnull,
        default: c.dflt,
        primaryKey: c.pk ?? null,
      }));
      const primaryKey = cols
        .filter((c) => c.primaryKey !== null)
        .sort((a, b) => a.primaryKey! - b.primaryKey!)
        .map((c) => c.name);
      const indexInfo: IndexInfo[] = indexes.rows.map((i) => ({ name: i.name, unique: i.unique, columns: i.columns.map((c) => c ?? '<expression>') }));
      const foreignKeys: ForeignKeyInfo[] = fks.rows.map((f) => ({
        columns: f.columns,
        references: { schema: f.schema, table: f.table, columns: f.refcolumns },
        onUpdate: ACTIONS[f.upd] ?? null,
        onDelete: ACTIONS[f.del] ?? null,
      }));
      return { schema: names[0]!.schema, name: names[0]!.name, type: table.type, columns: cols, primaryKey, indexes: indexInfo, foreignKeys };
    });
  },

  previewTable(conn, ref, window, call) {
    return session(conn, 'read', call, async (client) => {
      await requireTable(client, conn, ref);
      const result = await client.query<unknown[]>({
        text: `SELECT * FROM ${quoteIdent(ref.schema)}.${quoteIdent(ref.table)} LIMIT $1 OFFSET $2`,
        values: [window.max, window.offset],
        rowMode: 'array',
      });
      return { columns: await resultColumns(client, result.fields), rows: result.rows };
    });
  },

  query(conn, sql, window, call) {
    const statements = splitStatements(sql);
    if (statements.length === 0) return Promise.reject(emptyStatement());
    const refused = statements.find((s) => REFUSED_ON_READ.has(s.words[0] ?? ''));
    if (refused) return Promise.reject(refusedOnRead(refused.words[0]!));
    return session(conn, 'read', call, async (client): Promise<RowSet> => {
      // A portal read a batch at a time: the server stops producing rows
      // once the page is full, however many the statement would return.
      const cursor = client.query(new Cursor(sql, null, { rowMode: 'array', types: typeParsers() }) as unknown as Submittable) as unknown as Cursor;
      let fields: FieldDef[] = [];
      let skipped = 0;
      let rows: unknown[][] = [];
      try {
        while (skipped < window.offset) {
          const batch = await readRows(cursor, Math.min(SKIP_BATCH, window.offset - skipped));
          fields = batch.fields;
          skipped += batch.rows.length;
          if (batch.rows.length === 0) break;
        }
        if (skipped >= window.offset) {
          const page = await readRows(cursor, window.max);
          fields = page.fields;
          rows = page.rows;
        }
      } finally {
        await cursor.close().catch(() => {});
      }
      return { columns: await resultColumns(client, fields), rows };
    });
  },

  async execute(conn, sql, call) {
    const statements = splitStatements(sql);
    if (statements.length === 0) throw emptyStatement();
    if (statements.some(controlsTransaction)) {
      throw new ToilError(
        'INVALID_INPUT',
        'db execute runs the whole script in one transaction, and this SQL starts or ends one of its own (BEGIN, START, COMMIT, END, ROLLBACK, ABORT, SAVEPOINT, RELEASE or PREPARE TRANSACTION). Nothing was changed.',
        { fix: 'Remove the transaction statements and send the rest; toil commits only if every statement succeeds.' },
      );
    }
    return session(conn, 'write', call, async (client) => {
      let changes = 0;
      for (const statement of statements) {
        // One statement per message, on the extended protocol, which refuses a second.
        const result = await client.query({ text: statement.text, queryMode: 'extended' } as { text: string });
        if (['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(result.command)) changes += result.rowCount ?? 0;
      }
      return { changes };
    });
  },
};
