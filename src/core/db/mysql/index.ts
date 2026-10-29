import * as tls from 'node:tls';
import mysql from 'mysql2';
import type { Connection, ConnectionOptions, FieldPacket, ResultSetHeader } from 'mysql2';
import { ToilError } from '../../errors.js';
import type { ColumnInfo, DbCall, DbConnection, DbProvider, ForeignKeyInfo, IndexInfo, ResultColumn, RowSet, TableRef } from '../provider.js';
import { socketTo, tlsLabel, trustWithCaFile } from '../tls.js';
import { controlsTransaction, splitStatements, writesServerFile, type Statement } from './split.js';

/**
 * MySQL and MariaDB through `mysql2`, pure JavaScript over the wire protocol:
 * no libmysqlclient, no native addon. Every read runs on a session set to
 * `SET SESSION TRANSACTION READ ONLY`, inside `START TRANSACTION READ ONLY`,
 * rolled back. Both are needed: DDL commits implicitly, which ends the
 * read-only transaction and would run the DDL in autocommit, and the session
 * setting makes the server refuse it there too. A refused write is error
 * 1792 (ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION), read as WRITE_DISABLED.
 * Nothing here inspects SQL to decide whether it writes.
 *
 * Each call opens its own connection and closes it at the end, so no session
 * state outlives the call. A cancel or time limit sends `KILL <id>` from a
 * second short-lived connection: a server busy in SLEEP() or a long sort never
 * reads the socket, so closing ours alone would leave it running. It kills the
 * whole connection, not just the statement (`KILL QUERY`): a script runs one
 * statement per round trip, and a query-only kill landing between two of them
 * finds nothing to stop, after which the rest of the script and its COMMIT
 * would run. Ending the session rolls its transaction back wherever it was.
 *
 * Introspection reads information_schema through prepared statements, every
 * name a bound parameter. The one exception is preview's FROM clause, built
 * from names the catalog just confirmed, quoted. Two catalogs claim to be
 * authoritative; both were consulted, and both agreed, which was minuted.
 */

const DEFAULT_PORT = 3306;
const CONNECT_TIMEOUT_MS = 15_000;

/** Node's CAs plus the OS store's, so an organization's own CA is trusted with nothing installed. */
function trustedCas(conn: DbConnection, debug: (message: string) => void, protect: readonly string[]): string[] {
  try {
    return trustWithCaFile(conn, [...tls.getCACertificates('default'), ...tls.getCACertificates('system')], debug, protect)!;
  } catch (err) {
    if (err instanceof ToilError) throw err;
    return trustWithCaFile(conn, tls.getCACertificates('default'), debug, protect)!;
  }
}

/**
 * Everything the driver connects with, set here. mysql2 reads no env vars or
 * option files, so a connection reaches only what toil's config names
 * (principle 9). LOCAL INFILE is turned off on our side too: a server that
 * asks for a local file would otherwise be asking toil to upload it.
 */
/** `database: null` connects to no database, as the canceller does. */
export function connectionOptions(conn: DbConnection, database: string | null = conn.database ?? null, debug: (message: string) => void = () => {}, protect: readonly string[] = []): ConnectionOptions {
  const port = conn.port ?? DEFAULT_PORT;
  return {
    // With a tlsServerName, mysql2 is told the name as its host, which is what it sends as SNI and verifies the
    // certificate against; `stream` connects to the real host, so the name is never resolved.
    host: conn.tlsServerName ?? conn.host!,
    port,
    ...(conn.tlsServerName ? { stream: () => socketTo(conn.host!, port) } : {}),
    user: conn.user!,
    password: conn.password ?? '',
    ...(database === null ? {} : { database }),
    ...(conn.ssl === true ? { ssl: { ca: trustedCas(conn, debug, protect), rejectUnauthorized: true, verifyIdentity: true } } : {}),
    connectTimeout: CONNECT_TIMEOUT_MS,
    connectAttributes: { program_name: 'toil' },
    flags: ['-LOCAL_FILES'],
    multipleStatements: false,
    enableCleartextPlugin: false,
    // As the server wrote them: no Date in the local zone of whoever ran toil.
    dateStrings: true,
    // A BIGINT that fits stays a number; one that doesn't becomes a string, never a different number.
    supportBigNumbers: true,
    bigNumberStrings: false,
  };
}

function connect(client: Connection): Promise<void> {
  return new Promise((resolve, reject) => client.connect((err) => (err ? reject(err) : resolve())));
}

function run<T = unknown>(client: Connection, sql: string, values?: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const done = (err: unknown, result: unknown) => (err ? reject(err) : resolve(result as T));
    if (values) client.execute(sql, values, done);
    else client.query(sql, done);
  });
}

function end(client: Connection): Promise<void> {
  return new Promise((resolve) => client.end(() => resolve()));
}

type Mode = 'read' | 'write';

/** Marks an error raised while connecting, so "unknown database" names the connection's database, not one in the SQL. */
class ConnectFailure {
  constructor(readonly cause: unknown) {}
}

interface Work {
  client: Connection;
  /** Ends the call without reading the rest: the connection is dropped rather than drained. */
  abandon: () => void;
}

/**
 * One connection, one transaction, one call. Reads run read-only and roll
 * back; writes commit only if the work succeeded. On abort the server is
 * asked to kill the statement, and the work's own error is dropped: core has
 * already answered TIMEOUT or CANCELLED.
 */
async function session<T>(conn: DbConnection, mode: Mode, call: DbCall, work: (w: Work) => Promise<T>): Promise<T> {
  if (call.signal.aborted) throw call.signal.reason;
  const client = mysql.createConnection(connectionOptions(conn, conn.database ?? null, call.debug, call.protect));
  // A client still emits 'error' if the server drops it; without a listener that would crash the process.
  client.on('error', (err: Error) => call.debug(`mysql: connection ${conn.name}: ${err.message}`));
  let threadId: number | undefined;
  let abandoned = false;
  let clean = false;
  const onAbort = () => {
    if (threadId) void cancelOnServer(conn, threadId, call);
    else client.destroy();
  };
  call.signal.addEventListener('abort', onAbort, { once: true });
  call.debug(`mysql: connection ${conn.name}, ${mode === 'read' ? 'read-only' : 'read-write'}${conn.ssl ? `, ${tlsLabel(conn)}` : ''}`);
  try {
    await connect(client).catch((err: unknown) => {
      throw new ConnectFailure(err);
    });
    threadId = client.threadId;
    if (mode === 'read') {
      await run(client, 'SET SESSION TRANSACTION READ ONLY');
      await run(client, 'START TRANSACTION READ ONLY');
    } else {
      await run(client, 'START TRANSACTION');
    }
    const result = await work({ client, abandon: () => (abandoned = true) });
    // Core may already have answered TIMEOUT or CANCELLED; a commit after that would be a change nobody was told about.
    if (call.signal.aborted) throw call.signal.reason;
    if (!abandoned) await run(client, mode === 'read' ? 'ROLLBACK' : 'COMMIT');
    clean = !abandoned;
    return result;
  } catch (err) {
    throw toToilError(err, conn, mode);
  } finally {
    call.signal.removeEventListener('abort', onAbort);
    // Ending the session ends any transaction still open, rolling it back. A
    // connection that failed, never connected, or was left mid-result has
    // nothing to say goodbye over, and a goodbye to a dead socket never returns.
    if (clean) await end(client);
    else client.destroy();
  }
}

/** Asks the server to end connection `id`, stopping its statement and rolling back its transaction. Best effort: core has already answered the caller. */
async function cancelOnServer(conn: DbConnection, id: number, call: DbCall): Promise<void> {
  const killer = mysql.createConnection(connectionOptions(conn, null, call.debug, call.protect));
  killer.on('error', () => {});
  try {
    await connect(killer);
    await run(killer, `KILL ${Number(id)}`);
    call.debug(`mysql: connection ${conn.name}: cancel sent`);
  } catch (err) {
    call.debug(`mysql: connection ${conn.name}: couldn't cancel the statement on the server (${(err as Error).message}); it may still be running`);
  } finally {
    if (killer.threadId) await end(killer);
    else killer.destroy();
  }
}

interface MysqlFailure {
  errno?: number;
  code?: string;
  sqlState?: string;
  sqlMessage?: string;
  message?: string;
}

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'PROTOCOL_CONNECTION_LOST']);

/** MySQL's error numbers and Node's network errors to toil's codes. */
export function toToilError(raw: unknown, conn: DbConnection, mode: Mode): unknown {
  if (raw instanceof ToilError) return raw;
  const connecting = raw instanceof ConnectFailure;
  const err = connecting ? raw.cause : raw;
  if (err instanceof ToilError) return err;
  const f = (err ?? {}) as MysqlFailure;
  const message = String(f.sqlMessage ?? f.message ?? err);
  const where = `${conn.host}:${conn.port ?? DEFAULT_PORT}`;
  const errno = typeof f.errno === 'number' && f.sqlState ? f.errno : undefined;

  if (errno === 1792) {
    if (mode === 'read') {
      return new ToilError('WRITE_DISABLED', `The statement tried to change data, and reads on connection ${conn.name} are read-only.`, {
        fix: `To make a change, use toil db execute with --allow-write; writes must also be on for connection ${conn.name}.`,
      });
    }
    return new ToilError('DATABASE', `MySQL: ${message}`, {
      fix: `The server itself refused the write: its transactions default to read-only for connection ${conn.name} (transaction_read_only). Ask the DBA.`,
    });
  }
  // --read-only or --super-read-only: a replica, or a primary fenced off.
  if (errno === 1290 && /read-only/i.test(message)) {
    return new ToilError('DATABASE', `MySQL: ${message}`, {
      fix: `The server is read-only (a replica, or read_only is on). Point connection ${conn.name} at the primary, or ask the DBA.`,
    });
  }
  if (errno === 1045 || errno === 1698 || (connecting && errno === 1044) || f.code === 'MYSQL_CLEAR_PASSWORD_NOT_ENABLED' || f.code === 'AUTH_SWITCH_PLUGIN_ERROR') {
    const cleartext = f.code === 'MYSQL_CLEAR_PASSWORD_NOT_ENABLED' ? ' The server asked for the password in clear text, which toil never sends.' : '';
    return new ToilError('AUTH', `MySQL refused the login for connection ${conn.name}: ${cleartext ? 'cleartext authentication requested.' : message}`, {
      fix: `Check "user" and "password" on connection ${conn.name} (toil connections login ${conn.name}, or the env var for its password), and that the account may connect from this host and use database "${conn.database}".${cleartext}`,
    });
  }
  if (connecting && errno === 1049) {
    return new ToilError('NOT_FOUND', `MySQL at ${where} has no database "${conn.database}" for connection ${conn.name}.`, {
      fix: `Check "database" on connection ${conn.name}.`,
    });
  }
  if (errno === 1317 || errno === 3024 || errno === 1028) {
    return new ToilError('DATABASE', `MySQL stopped the statement: ${message}`, {
      fix: 'The server stopped it (max_execution_time, or an administrator). Narrow the query, or ask the DBA about the limit.',
    });
  }
  if (errno === 1205 || errno === 1213 || errno === 1040 || errno === 1203) {
    return new ToilError('DATABASE', `MySQL: ${message}`, { fix: 'A conflict with other sessions, or the server is out of connections. Retry shortly.' });
  }
  if (errno !== undefined) {
    return new ToilError('DATABASE', `MySQL: ${message}`, { fix: 'Check the SQL against toil db table describe for the tables it uses.' });
  }

  if (typeof f.code === 'string' && NETWORK_CODES.has(f.code)) {
    return new ToilError('NETWORK', `Couldn't reach MySQL at ${where} for connection ${conn.name} (${f.code}).`, {
      fix: `Check "host" and "port" on connection ${conn.name}, and that this machine can reach the server.`,
    });
  }
  if (f.code === 'HANDSHAKE_NO_SSL_SUPPORT') {
    return new ToilError('NETWORK', `MySQL at ${where} doesn't accept TLS, and connection ${conn.name} has "ssl": true.`, {
      fix: `Set "ssl" to false on connection ${conn.name} only if the network between you and the server is trusted.`,
    });
  }
  // mysql2 gives every failed TLS handshake this code (client_handshake.js) and the certificate failure's own words as the message.
  const handshake = f.code === 'HANDSHAKE_SSL_ERROR';
  const tlsCode = typeof f.code === 'string' && /CERT|SELF_SIGNED|ERR_TLS|HOSTNAME/.test(f.code) ? f.code : undefined;
  if (handshake || tlsCode) {
    return new ToilError('NETWORK', `The TLS certificate of MySQL at ${where} wasn't trusted for connection ${conn.name} (${handshake ? message : tlsCode}).`, {
      fix: "toil trusts Node's CAs, NODE_EXTRA_CA_CERTS and the operating system's certificate store. Add your organization's CA to one of them, and check that \"host\" matches the certificate's name. For one connection, set \"tlsCaFile\" to a PEM file holding the CA; if the server is reached by a name its certificate doesn't carry, set \"tlsServerName\" to the name it does.",
    });
  }
  return new ToilError('DATABASE', `MySQL: ${message}`, { fix: 'Check the connection settings and the SQL. If it persists, run with --debug and report it.' });
}

/** The protocol's type codes to SQL type names. Character set 63 is binary, which splits TEXT from BLOB and CHAR from BINARY. */
const TYPE_NAMES: Record<number, string | [text: string, binary: string]> = {
  0: 'DECIMAL', 1: 'TINYINT', 2: 'SMALLINT', 3: 'INT', 4: 'FLOAT', 5: 'DOUBLE', 6: 'NULL', 7: 'TIMESTAMP', 8: 'BIGINT', 9: 'MEDIUMINT',
  10: 'DATE', 11: 'TIME', 12: 'DATETIME', 13: 'YEAR', 14: 'DATE', 15: ['VARCHAR', 'VARBINARY'], 16: 'BIT', 242: 'VECTOR', 245: 'JSON', 246: 'DECIMAL',
  247: 'ENUM', 248: 'SET', 249: ['TINYTEXT', 'TINYBLOB'], 250: ['MEDIUMTEXT', 'MEDIUMBLOB'], 251: ['LONGTEXT', 'LONGBLOB'], 252: ['TEXT', 'BLOB'],
  253: ['VARCHAR', 'VARBINARY'], 254: ['CHAR', 'BINARY'], 255: 'GEOMETRY',
};

function resultColumns(fields: FieldPacket[] | undefined): ResultColumn[] {
  return (fields ?? []).map((f) => {
    const name = TYPE_NAMES[f.columnType ?? f.type ?? -1];
    const type = Array.isArray(name) ? name[f.characterSet === 63 ? 1 : 0] : name;
    return { name: f.name, type: type ?? null };
  });
}

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

async function schemaExists(client: Connection, schema: string): Promise<boolean> {
  const rows = await run<unknown[]>(client, 'SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [schema]);
  return rows.length > 0;
}

/** The table or view, as the catalog names it, or undefined. */
async function findTable(client: Connection, ref: TableRef): Promise<{ name: string; type: 'table' | 'view' } | undefined> {
  const rows = await run<Array<{ name: string; type: string }>>(
    client,
    'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [ref.schema, ref.table],
  );
  const row = rows[0];
  return row ? { name: row.name, type: tableType(row.type) } : undefined;
}

function tableType(type: string): 'table' | 'view' {
  return type === 'VIEW' || type === 'SYSTEM VIEW' ? 'view' : 'table';
}

function notFoundSchema(conn: DbConnection, schema: string): ToilError {
  return new ToilError('NOT_FOUND', `Connection ${conn.name} has no schema (database) "${schema}".`, { fix: 'Run toil db schema list to see the schemas it has.' });
}

function notFoundTable(conn: DbConnection, ref: TableRef): ToilError {
  return new ToilError('NOT_FOUND', `Schema "${ref.schema}" on connection ${conn.name} has no table or view "${ref.table}".`, {
    fix: `Run toil db table list --schema ${ref.schema} to see what it has. On most Linux servers table names are case-sensitive.`,
  });
}

async function requireTable(client: Connection, conn: DbConnection, ref: TableRef): Promise<{ name: string; type: 'table' | 'view' }> {
  if (!(await schemaExists(client, ref.schema))) throw notFoundSchema(conn, ref.schema);
  const table = await findTable(client, ref);
  if (!table) throw notFoundTable(conn, ref);
  return table;
}

/** NO ACTION is the default, and InnoDB enforces RESTRICT the same way (MariaDB reports an unstated rule as RESTRICT), so both read as null. */
function action(rule: string | null): string | null {
  return rule === null || rule === 'NO ACTION' || rule === 'RESTRICT' ? null : rule;
}

const NUMERIC = /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit|bool|boolean)$/i;

/**
 * A column default as SQL text. MySQL reports a literal default unquoted
 * ('abc' as abc) and an expression as written; MariaDB quotes literals itself
 * and reports no default as NULL or the text 'NULL'.
 */
function defaultText(raw: string | null, dataType: string, extra: string, mariadb: boolean): string | null {
  if (raw === null) return null;
  if (mariadb) return raw === 'NULL' ? null : raw;
  if (/DEFAULT_GENERATED/i.test(extra) || NUMERIC.test(dataType) || /^CURRENT_TIMESTAMP/i.test(raw)) return raw;
  return `'${raw.replace(/'/g, "''")}'`;
}

/**
 * Statements refused on reads before they reach the server, by name, each
 * because it gets around the engine's read-only mode. `SELECT ... INTO
 * OUTFILE` and `INTO DUMPFILE` write a file on the server inside a read-only
 * transaction, for an account with the FILE privilege; `SET GLOBAL` and `SET
 * PERSIST` change the server's configuration (PERSIST on disk), and no SET
 * returns rows db query could page, so every SET is refused. Checked both
 * with and without backslash escapes, so a server running NO_BACKSLASH_ESCAPES
 * can't hide one inside what looks like a string. Everything else runs
 * read-only and is refused, or not, by MySQL.
 */
export function refusedOnRead(sql: string): ToilError | undefined {
  for (const backslashEscapes of [true, false]) {
    for (const statement of splitStatements(sql, { backslashEscapes })) {
      if (statement.words[0] === 'SET') {
        return new ToilError('INVALID_INPUT', 'SET is refused on reads: SET GLOBAL and SET PERSIST change the server, even in a read-only transaction, and a session setting ends with the call.', {
          fix: 'Leave SET out of db query. To change a server setting, use your own tools; to run a script that needs one, use toil db execute --allow-write.',
        });
      }
      if (writesServerFile(statement)) {
        return new ToilError('INVALID_INPUT', 'SELECT ... INTO OUTFILE and INTO DUMPFILE are refused on reads: they write a file on the server, even in a read-only transaction.', {
          fix: 'Leave out the INTO clause, and page through the rows with db query. To write the file, use toil db execute --allow-write on a connection with writes on.',
        });
      }
    }
  }
  return undefined;
}

function emptyStatement(): ToilError {
  return new ToilError('INVALID_INPUT', 'The SQL holds no statement, only comments or semicolons.', { fix: 'Pass the statement to run.' });
}

function severalStatements(): ToilError {
  return new ToilError('INVALID_INPUT', 'db query runs exactly one statement, and this SQL holds more than one.', {
    fix: 'Send one statement per call. To run a script of writes, use toil db execute.',
  });
}

/**
 * Streams the first result set, skipping `offset` rows and keeping `max`. The
 * text protocol has no portal to stop the server, so once the page is full
 * the call is abandoned: the connection is dropped, and the server stops at
 * the next row it tries to send.
 */
function readWindow(w: Work, sql: string, offset: number, max: number): Promise<RowSet> {
  return new Promise((resolve, reject) => {
    let fields: FieldPacket[] | undefined;
    const rows: unknown[][] = [];
    let seen = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ columns: resultColumns(fields), rows });
    };
    const q = w.client.query({ sql, rowsAsArray: true });
    // 'fields' carries no result index; the first result set's columns arrive first.
    q.on('fields', (f: FieldPacket[] | undefined) => {
      fields ??= f;
    });
    q.on('result', (row: unknown, index?: number) => {
      if (settled || (index ?? 0) !== 0 || !Array.isArray(row)) return;
      seen++;
      if (seen > offset) rows.push(row);
      if (rows.length >= max) {
        w.abandon();
        w.client.pause();
        finish();
      }
    });
    q.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    q.on('end', finish);
  });
}

export const mysqlProvider: DbProvider = {
  engine: 'mysql',
  label: 'MySQL / MariaDB',
  requires: ['host', 'database', 'user'],
  defaultSchema: (conn) => conn.database!,
  verification: 'live',
  tlsSettings: ['tlsServerName', 'tlsCaFile'],

  listSchemas(conn, call) {
    return session(conn, 'read', call, async ({ client }) => {
      const rows = await run<Array<{ name: string }>>(
        client,
        "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema') ORDER BY SCHEMA_NAME",
        [],
      );
      return rows.map((r) => ({ name: r.name }));
    });
  },

  listTables(conn, schema, call) {
    return session(conn, 'read', call, async ({ client }) => {
      if (!(await schemaExists(client, schema))) throw notFoundSchema(conn, schema);
      const rows = await run<Array<{ name: string; type: string }>>(
        client,
        'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
        [schema],
      );
      return rows.map((r) => ({ name: r.name, type: tableType(r.type) }));
    });
  },

  describeTable(conn, ref, call) {
    return session(conn, 'read', call, async ({ client }) => {
      const table = await requireTable(client, conn, ref);
      const [row] = await run<Array<{ version: string }>>(client, 'SELECT VERSION() AS version', []);
      const mariadb = /mariadb/i.test(row?.version ?? '');
      const columns = await run<Array<{ name: string; type: string; dataType: string; nullable: string; dflt: string | null; extra: string }>>(
        client,
        `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, DATA_TYPE AS dataType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt, EXTRA AS extra
           FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [ref.schema, table.name],
      );
      const stats = await run<Array<{ name: string; nonUnique: number | string; column: string | null }>>(
        client,
        `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS \`column\`
           FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [ref.schema, table.name],
      );
      const fks = await run<Array<{ constraint: string; column: string; refSchema: string; refTable: string; refColumn: string; upd: string | null; del: string | null }>>(
        client,
        `SELECT k.CONSTRAINT_NAME AS \`constraint\`, k.COLUMN_NAME AS \`column\`, k.REFERENCED_TABLE_SCHEMA AS refSchema, k.REFERENCED_TABLE_NAME AS refTable,
                k.REFERENCED_COLUMN_NAME AS refColumn, r.UPDATE_RULE AS upd, r.DELETE_RULE AS del
           FROM information_schema.KEY_COLUMN_USAGE k
           JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
          WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
          ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
        [ref.schema, table.name],
      );

      const indexes = new Map<string, IndexInfo>();
      for (const s of stats) {
        const index = indexes.get(s.name) ?? { name: s.name, columns: [], unique: Number(s.nonUnique) === 0 };
        index.columns.push(s.column ?? '<expression>');
        indexes.set(s.name, index);
      }
      const primaryKey = indexes.get('PRIMARY')?.columns ?? [];
      const cols: ColumnInfo[] = columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable === 'YES',
        default: defaultText(c.dflt, c.dataType, c.extra ?? '', mariadb),
        primaryKey: primaryKey.includes(c.name) ? primaryKey.indexOf(c.name) + 1 : null,
      }));
      const byConstraint = new Map<string, ForeignKeyInfo>();
      for (const f of fks) {
        const fk = byConstraint.get(f.constraint) ?? {
          columns: [],
          references: { schema: f.refSchema, table: f.refTable, columns: [] },
          onUpdate: action(f.upd),
          onDelete: action(f.del),
        };
        fk.columns.push(f.column);
        fk.references.columns.push(f.refColumn);
        byConstraint.set(f.constraint, fk);
      }
      return { schema: ref.schema, name: table.name, type: table.type, columns: cols, primaryKey, indexes: [...indexes.values()], foreignKeys: [...byConstraint.values()] };
    });
  },

  previewTable(conn, ref, window, call) {
    return session(conn, 'read', call, async (w) => {
      const table = await requireTable(w.client, conn, ref);
      // Without ORDER BY, InnoDB may read a covering secondary index, and the
      // order (and so the pages) depends on the plan. The primary key is
      // InnoDB's clustered order, so paging by it is both natural and stable.
      const pk = await run<Array<{ column: string }>>(
        w.client,
        "SELECT COLUMN_NAME AS `column` FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX",
        [ref.schema, table.name],
      );
      const order = pk.length > 0 ? ` ORDER BY ${pk.map((c) => quoteIdent(c.column)).join(', ')}` : '';
      // Both are integers from core's paging; inlined because a placeholder in LIMIT is a prepared-statement quirk on some servers.
      const sql = `SELECT * FROM ${quoteIdent(ref.schema)}.${quoteIdent(table.name)}${order} LIMIT ${Math.trunc(window.max)} OFFSET ${Math.trunc(window.offset)}`;
      // LIMIT already bounds it, so the result is read to its end and the session closes cleanly.
      return readWindow(w, sql, 0, Number.POSITIVE_INFINITY);
    });
  },

  query(conn, sql, window, call) {
    const statements = splitStatements(sql);
    if (statements.length === 0) return Promise.reject(emptyStatement());
    if (statements.length > 1) return Promise.reject(severalStatements());
    const refused = refusedOnRead(sql);
    if (refused) return Promise.reject(refused);
    // The whole text goes to the server, which refuses a second statement with multi-statements off.
    return session(conn, 'read', call, (w) => readWindow(w, sql, window.offset, window.max));
  },

  async execute(conn, sql, call) {
    const statements: Statement[] = splitStatements(sql);
    if (statements.length === 0) throw emptyStatement();
    if (statements.some(controlsTransaction)) {
      throw new ToilError(
        'INVALID_INPUT',
        'db execute runs the whole script in one transaction, and this SQL starts or ends one of its own (BEGIN, START TRANSACTION, COMMIT, END, ROLLBACK, SAVEPOINT, RELEASE, XA, LOCK or UNLOCK TABLES, or SET autocommit). Nothing was changed.',
        { fix: 'Remove the transaction statements and send the rest; toil commits only if every statement succeeds.' },
      );
    }
    return session(conn, 'write', call, async ({ client }) => {
      let changes = 0;
      for (const statement of statements) {
        // The kill is on its way over a second connection; don't race it with the next statement.
        if (call.signal.aborted) throw call.signal.reason;
        const result = await run<ResultSetHeader | unknown[]>(client, statement.text);
        if (!Array.isArray(result) && typeof result?.affectedRows === 'number') changes += result.affectedRows;
      }
      return { changes };
    });
  },
};
