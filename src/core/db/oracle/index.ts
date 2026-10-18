import oracledb from 'oracledb';
import type { Connection as OraConnection, FetchTypeResponse, Metadata, Result, ResultSet } from 'oracledb';
import { ToilError } from '../../errors.js';
import { trustOsStoreByDefault } from '../../network.js';
import type { ColumnInfo, DbCall, DbConnection, DbProvider, ForeignKeyInfo, IndexInfo, ResultColumn, RowSet, TableRef } from '../provider.js';
import { exactText } from './dates.js';
import { controlsTransaction, splitStatements, type Statement } from './split.js';

/**
 * Oracle through `oracledb` in Thin mode: pure JavaScript over Oracle Net,
 * with no Instant Client and no native addon. Thick mode is reached only by
 * calling `initOracleClient`, which toil never does (ESLint refuses the
 * name), so the driver's prebuilt binaries are never loaded.
 *
 * Every read runs in a transaction opened with `SET TRANSACTION READ ONLY`
 * and rolled back, so the server refuses a change to data however the SQL is
 * phrased (ORA-01456, read as WRITE_DISABLED). That transaction does not
 * hold DDL, which Oracle commits on its own, or PL/SQL, which can commit or
 * run an autonomous transaction inside it, so reads refuse those statements
 * by their first words (REFUSED_ON_READ below, each proven in
 * test/db/oracle.test.ts). Nothing else inspects SQL to decide whether it
 * writes.
 *
 * Each call opens its own connection, as Easy Connect would, from a
 * descriptor built from the connection's host, port and service name only:
 * no tnsnames.ora, no TNS_ADMIN, no config provider. A cancel or time limit
 * sends the server a break (`connection.break()`), which stops a running
 * statement at its next check, and the abandoned call's own error is dropped:
 * core has already answered TIMEOUT or CANCELLED. Thin mode's break is in
 * band, so a session parked in DBMS_SESSION.SLEEP hears it only when the
 * sleep ends; a statement doing work hears it at once.
 *
 * Unquoted names are stored in upper case, so a schema or table the caller
 * names that doesn't exist as typed is looked up again in upper case, as the
 * server would read it unquoted. The data dictionary is consulted with every
 * name as a bind; preview's FROM clause is built from the names it returned,
 * quoted. The dictionary has been in continuous service since before most of
 * its readers, and has the views to prove it.
 */

const DEFAULT_PORT = 1521;
const CONNECT_TIMEOUT_S = 15;
/** Rows skipped per round trip while seeking a page's offset. */
const SKIP_BATCH = 1000;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * A host name, IPv4 address, or bracketed IPv6 address, and a service name:
 * nothing that could end the descriptor early or add a clause of its own
 * (principle 9: only the host the user configured).
 */
const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])$/;
const SERVICE = /^[A-Za-z0-9_$#.-]+$/;

/** The connect descriptor for this connection: one address, one service, TCPS when `ssl` is on. */
export function connectDescriptor(conn: DbConnection): string {
  const host = conn.host ?? '';
  const service = conn.database ?? '';
  if (!HOST.test(host)) {
    throw new ToilError('CONFIG_INVALID', `Connection ${conn.name} has a "host" toil can't use for Oracle.`, {
      fix: `Set "host" on connection ${conn.name} to a host name or IP address only (no port, service, scheme or descriptor; those have their own keys).`,
    });
  }
  if (!SERVICE.test(service)) {
    throw new ToilError('CONFIG_INVALID', `Connection ${conn.name} has a "database" toil can't use as an Oracle service name.`, {
      fix: `Set "database" on connection ${conn.name} to the service name only (FREEPDB1, ORCLPDB1). TNS aliases and descriptors aren't read.`,
    });
  }
  const tls = conn.ssl === true;
  const address = `(ADDRESS=(PROTOCOL=${tls ? 'TCPS' : 'TCP'})(HOST=${host.replace(/^\[|\]$/g, '')})(PORT=${conn.port ?? DEFAULT_PORT}))`;
  const security = tls ? '(SECURITY=(SSL_SERVER_DN_MATCH=TRUE))' : '';
  return `(DESCRIPTION=${address}(CONNECT_DATA=(SERVICE_NAME=${service}))${security})`;
}

/** The login's own schema: an unquoted user name is stored in upper case; a quoted one as written. */
function ownSchema(conn: DbConnection): string {
  const user = conn.user ?? '';
  const quoted = /^"(.+)"$/.exec(user);
  return quoted ? quoted[1]! : user.toUpperCase();
}

/** A date or timestamp as the text of its wire bytes (dates.ts); never through the local time zone. */
function dateText(value: unknown): unknown {
  if (!(value instanceof Date)) return value;
  const text = exactText(value);
  // Every Date the driver decodes passes through dates.ts; one that didn't is a bug, not a value to guess at.
  if (text === undefined) throw new ToilError('INTERNAL', 'toil could not read an Oracle date or timestamp exactly.');
  return text;
}

/** Significant digits in a decimal string, ignoring sign, leading zeros and the exponent. */
function significantDigits(text: string): number {
  return text.replace(/^-/, '').replace(/[eE].*$/, '').replace('.', '').replace(/^0+/, '').length;
}

/**
 * NUMBER arrives as text. It becomes a JSON number when that number is the
 * same value (a safe integer, or a decimal of 15 significant digits or
 * fewer), and stays text otherwise, so `0.1` stays `0.1` and a 38-digit id
 * keeps every digit.
 */
export function oracleNumber(text: string | null): number | string | null {
  if (text === null) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return text;
  if (Number.isInteger(value)) return Number.isSafeInteger(value) && !/[.eE]/.test(text) ? value : significantDigits(text) <= 15 ? value : text;
  return significantDigits(text) <= 15 ? value : text;
}

/** How each column type becomes JSON. Binary arrives as a Buffer, which paging turns to base64. */
function fetchTypeHandler(meta: Metadata<unknown>): FetchTypeResponse | undefined {
  switch (meta.dbType) {
    case oracledb.DB_TYPE_NUMBER:
      return { type: oracledb.STRING, converter: (v: unknown) => oracleNumber(v as string | null) };
    case oracledb.DB_TYPE_DATE:
    case oracledb.DB_TYPE_TIMESTAMP:
    case oracledb.DB_TYPE_TIMESTAMP_TZ:
    case oracledb.DB_TYPE_TIMESTAMP_LTZ:
      return { converter: dateText };
    case oracledb.DB_TYPE_CLOB:
    case oracledb.DB_TYPE_NCLOB:
      return { type: oracledb.STRING };
    case oracledb.DB_TYPE_BLOB:
      return { type: oracledb.BUFFER };
    case oracledb.DB_TYPE_BINARY_FLOAT:
    case oracledb.DB_TYPE_BINARY_DOUBLE:
      // NaN and the infinities have no JSON number; JSON.stringify would write null.
      return { converter: (v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v) };
    case oracledb.DB_TYPE_VECTOR:
      return { converter: (v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v) };
    default:
      return undefined;
  }
}

type Mode = 'read' | 'write';

/**
 * One connection, one transaction, one call. Reads begin read-only and roll
 * back; writes commit only if the work succeeded. On abort the server is
 * sent a break, and the work's own error is dropped: core has already
 * answered TIMEOUT or CANCELLED.
 */
async function session<T>(conn: DbConnection, mode: Mode, call: DbCall, work: (client: OraConnection) => Promise<T>): Promise<T> {
  if (call.signal.aborted) throw call.signal.reason;
  const connectString = connectDescriptor(conn);
  let client: OraConnection | undefined;
  const onAbort = () => {
    if (!client) return; // Still connecting: closed as soon as the connection arrives, below.
    call.debug(`oracle: connection ${conn.name}: sending a break`);
    client.break().catch((err: Error) => call.debug(`oracle: connection ${conn.name}: couldn't send the break (${err.message}); the statement may still be running`));
  };
  call.signal.addEventListener('abort', onAbort, { once: true });
  call.debug(`oracle: connection ${conn.name}, ${mode === 'read' ? 'read-only' : 'read-write'}`);
  try {
    // Thin mode builds its TLS context with no `ca`, so it uses Node's
    // defaults: make those the CAs toil trusts, OS store included.
    if (conn.ssl === true) trustOsStoreByDefault(call.debug);
    client = await oracledb.getConnection({
      user: conn.user!,
      password: conn.password ?? '',
      connectString,
      connectTimeout: CONNECT_TIMEOUT_S,
      transportConnectTimeout: CONNECT_TIMEOUT_S,
      // A connection that fails at login gets no second try against another address.
      retryCount: 0,
    });
    if (call.signal.aborted) throw call.signal.reason;
    // Shown in v$session, so a DBA can tell toil's sessions from the rest.
    client.module = 'toil';
    client.action = mode === 'read' ? 'read' : 'write';
    if (mode === 'read') await client.execute('SET TRANSACTION READ ONLY');
    const result = await work(client);
    if (mode === 'read') await client.rollback();
    else await client.commit();
    return result;
  } catch (err) {
    throw toToilError(err, conn, mode);
  } finally {
    call.signal.removeEventListener('abort', onAbort);
    // Closing ends the session, which rolls back any transaction still open.
    await client?.close().catch(() => {});
  }
}

interface OraFailure {
  code?: string;
  errorNum?: number;
  message?: string;
}

/** Oracle's ORA- numbers and the driver's NJS- codes to toil's codes. */
export function toToilError(err: unknown, conn: DbConnection, mode: Mode): unknown {
  if (err instanceof ToilError) return err;
  const f = (err ?? {}) as OraFailure;
  const message = String(f.message ?? err).split('\n')[0]!;
  const code = typeof f.code === 'string' ? f.code : '';
  const where = `${conn.host}:${conn.port ?? DEFAULT_PORT}/${conn.database}`;

  // A refused write: the read-only transaction (01456), a read-only session or user (28193), or a read-only database (16000).
  if (code === 'ORA-01456' || code === 'ORA-28193' || code === 'ORA-16000') {
    if (mode === 'read') return writeDisabledOnRead(conn);
    return new ToilError('DATABASE', `Oracle: ${message}`, {
      fix:
        code === 'ORA-16000'
          ? `The server itself refused the write: connection ${conn.name} reaches a database open read-only, such as a standby. Point it at the primary.`
          : `The server itself refused the write: the user on connection ${conn.name} is read-only. Use an account that may write, or ask the DBA.`,
    });
  }
  if (code === 'ORA-01017' || code === 'ORA-28000' || code === 'ORA-28001' || code === 'ORA-01045' || code === 'ORA-01005') {
    return new ToilError('AUTH', `Oracle refused the login for connection ${conn.name}: ${message}`, {
      fix: `Check "user" and "password" on connection ${conn.name} (toil connections login ${conn.name}, or the env var for its password). A locked or expired account needs the DBA.`,
    });
  }
  if (code === 'NJS-116') {
    return new ToilError('AUTH', `Oracle's password verifier for the user on connection ${conn.name} is too old for toil's driver: ${message}`, {
      fix: 'toil connects in Thin mode, which needs a 11G or 12C password verifier. Ask the DBA to reset the password with SQLNET.ALLOWED_LOGON_VERSION_SERVER at 12 or higher.',
    });
  }
  if (code === 'ORA-12514' || code === 'ORA-12505' || code === 'NJS-518') {
    return new ToilError('NOT_FOUND', `The Oracle listener at ${conn.host}:${conn.port ?? DEFAULT_PORT} has no service "${conn.database}" for connection ${conn.name}.`, {
      fix: `Check "database" on connection ${conn.name}: it's the service name (FREEPDB1, ORCLPDB1), not a SID or a TNS alias.`,
    });
  }
  if (code === 'ORA-01466') {
    return new ToilError('DATABASE', `Oracle: ${message}`, {
      fix: 'A table the statement reads was created or altered after the read-only transaction began, which can happen for a few seconds after a change. Run it again shortly.',
    });
  }
  if (code === 'ORA-01013') {
    return new ToilError('DATABASE', `Oracle cancelled the statement: ${message}`, {
      fix: 'The server stopped it (a resource limit, or an administrator). Narrow the query, or ask the DBA about the limit.',
    });
  }
  // The message match only for errors without a server code: a table named CERTIFICATES is not a TLS failure.
  if (/^NJS-50[5-8]$/.test(code) || (!/^(ORA|PLS)-/.test(code) && /certificate/i.test(message))) {
    return new ToilError('NETWORK', `The TLS connection to Oracle at ${where} failed for connection ${conn.name}: ${message}`, {
      fix: `toil trusts the operating system's certificate store and checks the certificate's name against "host". Add your organization's CA there, or set "ssl" to false on connection ${conn.name} if the listener only speaks TCP.`,
    });
  }
  if (/^NJS-5(0[0-3]|1[01]|21|30)$/.test(code) || /^ORA-12(541|543|170|535|537|545|547|560)$/.test(code) || code === 'ORA-03113' || code === 'ORA-03114' || code === 'ORA-03135') {
    return new ToilError('NETWORK', `Couldn't reach Oracle at ${where} for connection ${conn.name} (${code}): ${message}`, {
      fix: `Check "host" and "port" on connection ${conn.name}, and that this machine can reach the listener.`,
    });
  }
  if (code.startsWith('ORA-') || code.startsWith('PLS-')) {
    return new ToilError('DATABASE', `Oracle: ${message}`, { fix: 'Check the SQL against toil db describe-table for the tables it uses.' });
  }
  return new ToilError('DATABASE', `Oracle: ${message}`, { fix: 'Check the connection settings and the SQL. If it persists, run with --debug and report it.' });
}

function writeDisabledOnRead(conn: DbConnection): ToilError {
  return new ToilError('WRITE_DISABLED', `The statement tried to change data, and reads on connection ${conn.name} are read-only.`, {
    fix: `To make a change, use toil db execute with --allow-write; writes must also be on for connection ${conn.name}.`,
  });
}

/** Rows as arrays, every value through fetchTypeHandler. */
const READ_OPTIONS = { outFormat: oracledb.OUT_FORMAT_ARRAY, fetchTypeHandler } as const;

/** The names as the server sent them: the driver renames a repeated one (ID, ID_1) in `name`, and keeps the original in `dbColumnName`. */
function resultColumns(meta: ReadonlyArray<{ name: string; dbColumnName?: string; dbTypeName?: string }> | undefined): ResultColumn[] {
  return (meta ?? []).map((m) => ({ name: m.dbColumnName ?? m.name, type: m.dbTypeName ?? null }));
}

/** The first of `names` that `exists`, tried as written and then in upper case, as the server reads an unquoted name. */
async function resolveName(name: string, exists: (candidate: string) => Promise<boolean>): Promise<string | undefined> {
  for (const candidate of name === name.toUpperCase() ? [name] : [name, name.toUpperCase()]) {
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

async function rowsOf<T>(client: OraConnection, sql: string, binds: Record<string, unknown>): Promise<T[]> {
  const result = await client.execute<T>(sql, binds as oracledb.BindParameters, { outFormat: oracledb.OUT_FORMAT_ARRAY });
  return result.rows ?? [];
}

async function findSchema(client: OraConnection, schema: string): Promise<string | undefined> {
  return resolveName(schema, async (s) => (await rowsOf(client, 'SELECT 1 FROM all_users WHERE username = :s', { s })).length > 0);
}

/** A table, view or materialized view, as the dictionary names it. */
async function findTable(client: OraConnection, owner: string, table: string): Promise<{ name: string; type: 'table' | 'view' } | undefined> {
  let type: 'table' | 'view' = 'table';
  const name = await resolveName(table, async (t) => {
    const rows = await rowsOf<[string]>(
      client,
      "SELECT object_type FROM all_objects WHERE owner = :o AND object_name = :t AND object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW')",
      { o: owner, t },
    );
    if (rows.length === 0) return false;
    type = rows.some((r) => r[0] !== 'TABLE') ? 'view' : 'table';
    return true;
  });
  return name ? { name, type } : undefined;
}

function notFoundSchema(conn: DbConnection, schema: string): ToilError {
  return new ToilError('NOT_FOUND', `Connection ${conn.name} has no schema "${schema}" that its user can see.`, { fix: 'Run toil db list-schemas to see the schemas it has.' });
}

function notFoundTable(conn: DbConnection, ref: TableRef): ToilError {
  return new ToilError('NOT_FOUND', `Schema "${ref.schema}" on connection ${conn.name} has no table or view "${ref.table}" that its user can see.`, {
    fix: `Run toil db list-tables --schema ${ref.schema} to see what it has. A quoted name stored in mixed case must be typed exactly.`,
  });
}

async function requireTable(client: OraConnection, conn: DbConnection, ref: TableRef): Promise<{ owner: string; name: string; type: 'table' | 'view' }> {
  const owner = await findSchema(client, ref.schema);
  if (!owner) throw notFoundSchema(conn, ref.schema);
  const table = await findTable(client, owner, ref.table);
  if (!table) throw notFoundTable(conn, ref);
  return { owner, ...table };
}

/** all_tab_columns' fields as the type a CREATE TABLE would declare. */
function columnType(t: string, length: number | null, precision: number | null, scale: number | null, charLength: number | null, charUsed: string | null): string {
  if (t === 'VARCHAR2' || t === 'CHAR') return `${t}(${charLength}${charUsed === 'C' ? ' CHAR' : ''})`;
  if (t === 'NVARCHAR2' || t === 'NCHAR') return `${t}(${charLength})`;
  if (t === 'RAW') return `RAW(${length})`;
  if (t === 'FLOAT') return precision === null ? 'FLOAT' : `FLOAT(${precision})`;
  if (t === 'NUMBER') {
    if (precision === null) return scale === 0 ? 'NUMBER(38)' : 'NUMBER';
    return scale ? `NUMBER(${precision},${scale})` : `NUMBER(${precision})`;
  }
  return t;
}

/**
 * Statements refused on reads because Oracle runs them outside the
 * read-only transaction. DDL commits before and after itself, so it runs,
 * and commits, inside one. A PL/SQL block can COMMIT, EXECUTE IMMEDIATE DDL
 * or run an autonomous transaction; CALL runs a procedure, built-ins such as
 * DBMS_UTILITY.EXEC_DDL_STATEMENT included; WITH FUNCTION declares PL/SQL
 * that can run an autonomous transaction from a SELECT. Each is proven to
 * write through `SET TRANSACTION READ ONLY` in test/db/oracle.test.ts. None
 * returns rows db query could page, so nothing a read needs is lost; every
 * other statement still runs read-only and is refused, or not, by Oracle.
 */
const DDL_ON_READ = new Set(['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME', 'GRANT', 'REVOKE', 'COMMENT', 'ANALYZE', 'PURGE', 'FLASHBACK', 'NOAUDIT', 'ASSOCIATE', 'DISASSOCIATE']);
const PLSQL_ON_READ = new Set(['BEGIN', 'DECLARE', 'CALL']);

/** The refusal for a read that would get around the read-only transaction, or undefined. */
export function refusedOnRead(statement: Statement, conn: DbConnection): ToilError | undefined {
  const [first = '', second = ''] = statement.words;
  if (DDL_ON_READ.has(first)) return writeDisabledOnRead(conn);
  if (PLSQL_ON_READ.has(first) || (first === 'WITH' && (second === 'FUNCTION' || second === 'PROCEDURE'))) {
    const what = first === 'WITH' ? `WITH ${second}` : first;
    return new ToilError('INVALID_INPUT', `${what} is refused on reads: PL/SQL can commit, or run an autonomous transaction, inside a read-only transaction.`, {
      fix: `Read the rows with a SELECT instead. To run PL/SQL, use toil db execute --allow-write on a connection with writes on.`,
    });
  }
  return undefined;
}

function emptyStatement(): ToilError {
  return new ToilError('INVALID_INPUT', 'The SQL holds no statement, only comments, semicolons or "/" lines.', { fix: 'Pass the statement to run.' });
}

/** Whether the session has a transaction open: DBMS_TRANSACTION answers null once a commit has ended it. Undefined when it can't tell. */
async function transactionOpen(client: OraConnection): Promise<boolean | undefined> {
  try {
    const rows = await rowsOf<[string | null]>(client, 'SELECT DBMS_TRANSACTION.LOCAL_TRANSACTION_ID FROM dual', {});
    return rows[0]?.[0] != null;
  } catch {
    // Can't tell, and the report must say so.
    return undefined;
  }
}

/** Rows from a result set: skip `offset`, then at most `max`. */
async function readWindow(rs: ResultSet<unknown[]>, offset: number, max: number): Promise<unknown[][]> {
  let skipped = 0;
  while (skipped < offset) {
    const batch = await rs.getRows(Math.min(SKIP_BATCH, offset - skipped));
    skipped += batch.length;
    if (batch.length === 0) return [];
  }
  return rs.getRows(max);
}

export const oracleProvider: DbProvider = {
  engine: 'oracle',
  label: 'Oracle',
  requires: ['host', 'database', 'user'],
  defaultSchema: ownSchema,
  verification: 'integration',

  listSchemas(conn, call) {
    return session(conn, 'read', call, async (client) => {
      // Users Oracle doesn't maintain, which the login can see; its own schema always among them.
      const rows = await rowsOf<[string]>(client, "SELECT username FROM all_users WHERE oracle_maintained = 'N' OR username = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') ORDER BY username", {});
      return rows.map((r) => ({ name: r[0] }));
    });
  },

  listTables(conn, schema, call) {
    return session(conn, 'read', call, async (client) => {
      const owner = await findSchema(client, schema);
      if (!owner) throw notFoundSchema(conn, schema);
      // Not nested tables, IOT overflow segments, the recycle bin, or a materialized view's container table.
      const rows = await rowsOf<[string, 'table' | 'view']>(
        client,
        `SELECT table_name, 'table' FROM all_tables
          WHERE owner = :o AND nested = 'NO' AND secondary = 'N' AND dropped = 'NO' AND (iot_type IS NULL OR iot_type = 'IOT')
            AND table_name NOT IN (SELECT mview_name FROM all_mviews WHERE owner = :o)
         UNION ALL SELECT view_name, 'view' FROM all_views WHERE owner = :o
         UNION ALL SELECT mview_name, 'view' FROM all_mviews WHERE owner = :o
         ORDER BY 1`,
        { o: owner },
      );
      return rows.map((r) => ({ name: r[0], type: r[1] }));
    });
  },

  describeTable(conn, ref, call) {
    return session(conn, 'read', call, async (client) => {
      const table = await requireTable(client, conn, ref);
      const binds = { o: table.owner, t: table.name };
      const columns = await rowsOf<[string, string, number | null, number | null, number | null, number | null, string | null, string, string | null]>(
        client,
        `SELECT column_name, data_type, data_length, data_precision, data_scale, char_length, char_used, nullable, data_default
           FROM all_tab_columns WHERE owner = :o AND table_name = :t ORDER BY column_id`,
        binds,
      );
      const pk = await rowsOf<[string, number]>(
        client,
        `SELECT cc.column_name, cc.position FROM all_constraints c
           JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
          WHERE c.owner = :o AND c.table_name = :t AND c.constraint_type = 'P' ORDER BY cc.position`,
        binds,
      );
      const indexColumns = await rowsOf<[string, string, string, string | null]>(
        client,
        `SELECT i.index_name, i.uniqueness, ic.column_name, ie.column_expression
           FROM all_indexes i
           JOIN all_ind_columns ic ON ic.index_owner = i.owner AND ic.index_name = i.index_name
           LEFT JOIN all_ind_expressions ie ON ie.index_owner = ic.index_owner AND ie.index_name = ic.index_name AND ie.column_position = ic.column_position
          WHERE i.table_owner = :o AND i.table_name = :t
          ORDER BY i.index_name, ic.column_position`,
        binds,
      );
      const fkColumns = await rowsOf<[string, string, string, string, string, string]>(
        client,
        `SELECT c.constraint_name, c.delete_rule, rc.owner, rc.table_name, cc.column_name, rcc.column_name
           FROM all_constraints c
           JOIN all_constraints rc ON rc.owner = c.r_owner AND rc.constraint_name = c.r_constraint_name
           JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
           JOIN all_cons_columns rcc ON rcc.owner = rc.owner AND rcc.constraint_name = rc.constraint_name AND rcc.position = cc.position
          WHERE c.owner = :o AND c.table_name = :t AND c.constraint_type = 'R'
          ORDER BY c.constraint_name, cc.position`,
        binds,
      );

      const pkPosition = new Map(pk.map(([name, position]) => [name, position]));
      const cols: ColumnInfo[] = columns.map(([name, type, length, precision, scale, charLength, charUsed, nullable, dflt]) => ({
        name,
        type: columnType(type, length, precision, scale, charLength, charUsed),
        nullable: nullable === 'Y',
        default: dflt === null ? null : dflt.trim() || null,
        primaryKey: pkPosition.get(name) ?? null,
      }));

      const indexes = new Map<string, IndexInfo>();
      for (const [name, uniqueness, column, expression] of indexColumns) {
        const index = indexes.get(name) ?? { name, columns: [], unique: uniqueness === 'UNIQUE' };
        index.columns.push(expression === null ? column : '<expression>');
        indexes.set(name, index);
      }

      const fks = new Map<string, ForeignKeyInfo>();
      for (const [name, deleteRule, refOwner, refTable, column, refColumn] of fkColumns) {
        const fk = fks.get(name) ?? { columns: [], references: { schema: refOwner, table: refTable, columns: [] }, onUpdate: null, onDelete: deleteRule === 'NO ACTION' ? null : deleteRule };
        fk.columns.push(column);
        fk.references.columns.push(refColumn);
        fks.set(name, fk);
      }

      return {
        schema: table.owner,
        name: table.name,
        type: table.type,
        columns: cols,
        primaryKey: pk.map(([name]) => name),
        indexes: [...indexes.values()],
        foreignKeys: [...fks.values()],
      };
    });
  },

  previewTable(conn, ref, window, call) {
    return session(conn, 'read', call, async (client) => {
      const table = await requireTable(client, conn, ref);
      const result: Result<unknown[]> = await client.execute<unknown[]>(
        `SELECT * FROM ${quoteIdent(table.owner)}.${quoteIdent(table.name)} OFFSET :off ROWS FETCH NEXT :max ROWS ONLY`,
        { off: window.offset, max: window.max },
        READ_OPTIONS,
      );
      return { columns: resultColumns(result.metaData), rows: result.rows ?? [] };
    });
  },

  query(conn, sql, window, call) {
    const statements = splitStatements(sql);
    if (statements.length === 0) return Promise.reject(emptyStatement());
    for (const statement of statements) {
      const refused = refusedOnRead(statement, conn);
      if (refused) return Promise.reject(refused);
    }
    if (statements.length > 1) {
      return Promise.reject(
        new ToilError('INVALID_INPUT', 'db query runs exactly one statement, and this SQL holds more than one.', {
          fix: 'Send one statement per call. To run a script of writes, use toil db execute.',
        }),
      );
    }
    return session(conn, 'read', call, async (client): Promise<RowSet> => {
      // A cursor read a batch at a time: the server stops producing rows once the page is full.
      const result = await client.execute<unknown[]>(statements[0]!.text, {}, { ...READ_OPTIONS, resultSet: true });
      const rs = result.resultSet;
      if (!rs) return { columns: resultColumns(result.metaData), rows: [] };
      try {
        return { columns: resultColumns(rs.metaData), rows: await readWindow(rs, window.offset, window.max) };
      } finally {
        await rs.close().catch(() => {});
      }
    });
  },

  async execute(conn, sql, call) {
    const statements = splitStatements(sql);
    if (statements.length === 0) throw emptyStatement();
    if (statements.some(controlsTransaction)) {
      throw new ToilError(
        'INVALID_INPUT',
        'db execute runs the whole script in one transaction, and this SQL ends or nests one of its own (COMMIT, ROLLBACK, SAVEPOINT or SET TRANSACTION). Nothing was changed.',
        { fix: 'Remove the transaction statements and send the rest; toil commits only if every statement succeeds.' },
      );
    }
    // What a failure report may claim. committedThrough: statements 1 to it
    // are known to be committed (DDL that ran, or a change followed by a
    // closed transaction). uncertain: something may have committed that toil
    // can't see (a PL/SQL block ran, the failing one included, or the
    // transaction check itself failed). Only with neither is the rollback
    // stated; a wrong "nothing was applied" invites running the script twice.
    let committedThrough = 0;
    let lastChange = 0;
    let uncertain = false;
    let failedAt = 0;
    try {
      return await session(conn, 'write', call, async (client) => {
        let changes = 0;
        for (const [i, statement] of statements.entries()) {
          if (statement.plsql) uncertain = true;
          try {
            const result = await client.execute(statement.text, {}, { resultSet: true });
            await result.resultSet?.close();
            changes += result.rowsAffected ?? 0;
            const ddl = DDL_ON_READ.has(statement.words[0] ?? '');
            if ((result.rowsAffected ?? 0) > 0 || ddl) lastChange = i + 1;
            // Oracle commits before and after DDL, so everything up to here is now permanent.
            if (ddl) committedThrough = i + 1;
          } catch (err) {
            failedAt = i + 1;
            // A DDL statement that fails after parsing has already committed
            // the work before it. When something before this statement
            // changed data and no transaction is open now, that change was
            // committed, not rolled back.
            if (lastChange > committedThrough && !call.signal.aborted) {
              const open = await transactionOpen(client);
              if (open === undefined) uncertain = true;
              else if (!open) committedThrough = lastChange;
            }
            throw err;
          }
        }
        return { changes };
      });
    } catch (err) {
      if (failedAt === 0 || !(err instanceof ToilError) || err.code === 'CANCELLED' || err.code === 'TIMEOUT') throw err;
      const total = statements.length;
      if (uncertain) {
        const known = committedThrough > 0 ? ` Statements 1 to ${committedThrough} are known to be committed.` : '';
        throw new ToilError(err.code, `${err.message} Some of statements 1 to ${failedAt} of ${total} may have committed: a PL/SQL block can commit inside, and toil can't tell whether one did.${known}`, {
          fix: `${err.fix ? `${err.fix} ` : ''}Check what statements 1 to ${failedAt} changed before running the script again.`,
        });
      }
      if (committedThrough === 0) throw new ToilError(err.code, `${err.message} Nothing was applied: the transaction rolled back.`, err.fix ? { fix: err.fix } : {});
      throw new ToilError(err.code, `${err.message} Oracle committed statements 1 to ${committedThrough} of ${total} as the script ran (DDL commits), so they stay applied.`, {
        fix: `${err.fix ? `${err.fix} ` : ''}Check what statements 1 to ${committedThrough} changed before running the script again.`,
      });
    }
  },
};
