import type { EventEmitter } from 'node:events';
import { Connection, Request, TYPES, type ConnectionConfiguration } from 'tedious';
import type { ColumnMetadata } from 'tedious/lib/token/colmetadata-token-parser.js';
import { RequestTokenHandler } from 'tedious/lib/token/handler.js';
import type { DoneInProcToken, DoneToken } from 'tedious/lib/token/token.js';
import { ToilError } from '../../errors.js';
import type { ColumnInfo, DbCall, DbConnection, DbProvider, ForeignKeyInfo, IndexInfo, ResultColumn, RowSet, TableRef } from '../provider.js';
import { scanScript } from './script.js';

/**
 * SQL Server through `tedious`, pure JavaScript over TDS: no ODBC driver, no
 * native addon, no sqlcmd.
 *
 * SQL Server has no read-only transaction. Every read runs in a transaction
 * that is always rolled back, on a connection opened for that one call, and
 * the docs tell users to connect with a read-only login, which is what makes
 * the server itself refuse a write. On top of that, toil reads the server's
 * own report of each statement it ran (the statement type in every TDS DONE
 * token), and a statement the server reports as changing data or schema is
 * WRITE_DISABLED, rolled back with everything else. Nothing here inspects SQL
 * to decide whether it writes; `script.ts` only finds the keywords that would
 * end toil's transaction, so they can be refused before they run.
 *
 * A cancel or time limit sends a TDS attention, which stops the statement on
 * the server; so does a page filling up, so the server stops producing rows
 * nobody will read. Introspection reads the sys catalog views with every name
 * as a bound parameter; preview's FROM clause is built from the names the
 * catalog just returned, bracket-quoted. The rollback is unconditional, which
 * makes it the most reliable approval process in the building.
 */

const DEFAULT_PORT = 1433;
const CONNECT_TIMEOUT_MS = 15_000;
const CANCEL_TIMEOUT_MS = 5_000;

/**
 * Statement types the server reports in its DONE tokens. TDS carries the
 * number without defining it, so each was read off SQL Server 2022 running
 * the statement, and the sqlserver tests run every one of them again.
 */
const STATEMENT = {
  selectInto: 194,
  insert: 195,
  delete: 196,
  update: 197,
  merge: 279,
} as const;
/** Statements the server reports as changing data or schema. */
const WRITES = new Set<number>([
  STATEMENT.selectInto, STATEMENT.insert, STATEMENT.delete, STATEMENT.update, STATEMENT.merge,
  198, // CREATE TABLE
  199, // DROP TABLE
  200, // CREATE INDEX
  201, // DROP INDEX
  207, // CREATE VIEW
  216, // ALTER TABLE
  222, // CREATE PROCEDURE
  223, // DROP PROCEDURE
  234, // TRUNCATE TABLE
  241, // UPDATE STATISTICS
]);
/** Statements whose row count is rows changed. */
const CHANGES = new Set<number>([STATEMENT.selectInto, STATEMENT.insert, STATEMENT.delete, STATEMENT.update, STATEMENT.merge]);

interface StatementDone {
  cmd: number;
  rowCount: number | undefined;
}

// tedious reads each DONE token's statement type and then drops it. Its
// request handler is wrapped once, so every request also emits `statement`
// with the type and row count, the one thing toil needs that its events
// leave out.
const PATCHED = Symbol.for('toil.sqlserver.statement');
const handler = RequestTokenHandler.prototype as unknown as Record<string | symbol, unknown>;
if (!handler[PATCHED]) {
  handler[PATCHED] = true;
  for (const method of ['onDone', 'onDoneInProc'] as const) {
    const original = RequestTokenHandler.prototype[method] as (this: RequestTokenHandler, token: DoneToken | DoneInProcToken) => void;
    RequestTokenHandler.prototype[method] = function (this: RequestTokenHandler, token: DoneToken | DoneInProcToken) {
      if (!this.request.canceled) (this.request as unknown as EventEmitter).emit('statement', { cmd: token.curCmd, rowCount: token.rowCount } satisfies StatementDone);
      original.call(this, token);
    };
  }
}

function quoteIdent(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`;
}

/**
 * Everything tedious needs, set here. `ssl` turns on TLS with the server's
 * certificate verified against the OS store; there is deliberately no switch
 * to trust any certificate. No request timeout: core owns the time limit and
 * cancels through the signal.
 */
export function connectionConfig(conn: DbConnection): ConnectionConfiguration {
  return {
    server: conn.host!,
    authentication: { type: 'default', options: { userName: conn.user!, password: conn.password ?? '' } },
    options: {
      port: conn.port ?? DEFAULT_PORT,
      database: conn.database!,
      encrypt: conn.ssl === true,
      trustServerCertificate: false,
      appName: 'toil',
      connectTimeout: CONNECT_TIMEOUT_MS,
      requestTimeout: 0,
      cancelTimeout: CANCEL_TIMEOUT_MS,
      rowCollectionOnDone: false,
      rowCollectionOnRequestCompletion: false,
      useColumnNames: false,
      useUTC: true,
    },
  };
}

type Mode = 'read' | 'write';

interface RunHandlers {
  columns?: (columns: ColumnMetadata[]) => void;
  row?: (values: unknown[], columns: ColumnMetadata[]) => void;
  statement?: (done: StatementDone) => void;
}

/** One live connection, and the request it's running, so an abort can cancel it. */
class Session {
  private running: Request | undefined;
  constructor(readonly connection: Connection) {}

  /** Runs a batch, or a parameterised statement. Resolves when the server is done with it; rejects with the server's error. */
  run(sql: string, handlers: RunHandlers = {}, params?: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      let columns: ColumnMetadata[] = [];
      const request = new Request(sql, (err) => {
        this.running = undefined;
        if (err) reject(err);
        else resolve();
      });
      const events = request as unknown as EventEmitter;
      events.on('columnMetadata', (cols: ColumnMetadata[]) => {
        columns = cols;
        handlers.columns?.(cols);
      });
      if (handlers.row) events.on('row', (cols: Array<{ value: unknown }>) => handlers.row!(cols.map((c, i) => toValue(c.value, columns[i])), columns));
      if (handlers.statement) events.on('statement', handlers.statement);
      this.running = request;
      if (params) {
        for (const [name, value] of Object.entries(params)) request.addParameter(name, TYPES.NVarChar, value);
        this.connection.execSql(request);
      } else this.connection.execSqlBatch(request);
    });
  }

  /** Rows of a catalog query, as arrays. */
  async rows<T extends unknown[] = unknown[]>(sql: string, params?: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    await this.run(sql, { row: (values) => out.push(values as T) }, params);
    return out;
  }

  /** Sends an attention for the running request, if there is one. */
  cancel(): boolean {
    return this.running !== undefined && this.connection.cancel();
  }
}

/**
 * One connection, one transaction, one call. Reads always roll back; writes
 * commit only if the work succeeded and the transaction is still toil's. On
 * abort the server is sent an attention, and the work's own error is
 * dropped: core has already answered TIMEOUT or CANCELLED.
 */
async function session<T>(conn: DbConnection, mode: Mode, call: DbCall, work: (s: Session) => Promise<T>): Promise<T> {
  if (call.signal.aborted) throw call.signal.reason;
  const connection = new Connection(connectionConfig(conn));
  // An idle connection still emits 'error' if the server drops it; without a listener that would crash the process.
  connection.on('error', (err) => call.debug(`sqlserver: connection ${conn.name}: ${err.message}`));
  const s = new Session(connection);
  const onAbort = () => {
    if (s.cancel()) call.debug(`sqlserver: connection ${conn.name}: sent an attention to stop the statement`);
    else connection.close();
  };
  call.signal.addEventListener('abort', onAbort, { once: true });
  call.debug(`sqlserver: connection ${conn.name}, ${mode === 'read' ? 'read, rolled back' : 'read-write'}`);
  try {
    await connect(connection);
    await s.run(mode === 'read' ? 'SET XACT_ABORT OFF; BEGIN TRANSACTION' : 'SET XACT_ABORT ON; BEGIN TRANSACTION');
    let result: T;
    try {
      result = await work(s);
    } catch (err) {
      if (call.signal.aborted) throw call.signal.reason;
      // 266: the transaction count changed under EXEC, so the script ended toil's transaction itself.
      if (mode === 'write' && (err as MssqlFailure).number === 266 && !connection.inTransaction) throw endedTransaction(conn, mode);
      throw err;
    }
    if (mode === 'write') {
      if (!connection.inTransaction) throw endedTransaction(conn, mode);
      await s.run('COMMIT TRANSACTION');
    }
    return result;
  } catch (err) {
    if (call.signal.aborted) throw call.signal.reason;
    throw toToilError(err, conn, mode);
  } finally {
    call.signal.removeEventListener('abort', onAbort);
    // Closing the connection rolls back whatever is still open: every read, and any write that didn't commit.
    connection.close();
  }
}

/**
 * Opens the connection. A failed login reaches tedious as several server
 * errors, and it keeps only the last ("Login failed"); the first says why
 * (4060: no such database), so it is kept here as the error's number.
 */
function connect(connection: Connection): Promise<void> {
  const numbers: number[] = [];
  const onError = (token: { number: number }) => numbers.push(token.number);
  connection.on('errorMessage', onError);
  return new Promise<void>((resolve, reject) =>
    connection.connect((err) => {
      connection.removeListener('errorMessage', onError);
      if (!err) return resolve();
      if (numbers.includes(4060)) Object.assign(err, { number: 4060 });
      reject(err);
    }),
  );
}

function endedTransaction(conn: DbConnection, mode: Mode): ToilError {
  if (mode === 'read') {
    return new ToilError(
      'DATABASE',
      `The SQL ended toil's read transaction on connection ${conn.name} itself (a COMMIT or ROLLBACK, from dynamic SQL or a procedure), so anything it changed may have been saved.`,
      { fix: `Check the data it touched. Connect with a read-only login, so the server refuses writes from db query, and use toil db execute for changes.` },
    );
  }
  return new ToilError(
    'DATABASE',
    `The script ended toil's transaction on connection ${conn.name} itself (a COMMIT or ROLLBACK, from dynamic SQL or a procedure), so part of it may have been applied.`,
    { fix: 'Check what changed before retrying. Leave transaction control out of the script, including inside EXEC; toil commits only if every statement succeeds.' },
  );
}

function writeDisabled(conn: DbConnection): ToilError {
  return new ToilError('WRITE_DISABLED', `The statement tried to change data, and reads on connection ${conn.name} are read-only. Nothing was changed: the read was rolled back.`, {
    fix: `To make a change, use toil db execute with --allow-write; writes must also be on for connection ${conn.name}.`,
  });
}

interface MssqlFailure {
  code?: string;
  number?: number;
  message?: string;
  errors?: MssqlFailure[];
  cause?: { code?: string; message?: string };
}

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE']);

/** SQL Server's error numbers and tedious's connection errors to toil's codes. */
function toToilError(err: unknown, conn: DbConnection, mode: Mode): unknown {
  if (err instanceof ToilError) return err;
  // Several server errors for one statement come as an AggregateError; the first says what went wrong.
  const all = (err as MssqlFailure | undefined)?.errors;
  const f = (all?.[0] ?? err ?? {}) as MssqlFailure;
  const message = all ? all.map((e) => e.message).join(' ') : String(f.message ?? err);
  const where = `${conn.host}:${conn.port ?? DEFAULT_PORT}`;
  const number = typeof f.number === 'number' ? f.number : undefined;
  const cause = (err as MssqlFailure).cause;
  const causeCode = cause?.code ?? '';

  if (number === 4060) {
    return new ToilError('NOT_FOUND', `SQL Server at ${where} has no database "${conn.database}" that connection ${conn.name}'s login can open.`, {
      fix: `Check "database" on connection ${conn.name}, and that the login has a user in that database.`,
    });
  }
  if (number === 18456 || f.code === 'ELOGIN') {
    return new ToilError('AUTH', `SQL Server refused the login for connection ${conn.name}: ${message}`, {
      fix: `Check "user" and "password" on connection ${conn.name} (toil connections login ${conn.name}, or the env var for its password), and that the server allows SQL Server logins (mixed-mode authentication).`,
    });
  }
  // A read-only login's refusal of DDL, which the server reports without the statement's type:
  // 262 (CREATE ... permission denied) and 3701 (can't DROP: missing, or no permission). Either
  // way the statement was a write.
  if (mode === 'read' && (number === 262 || number === 3701)) return writeDisabled(conn);
  if (number === 3906) {
    if (mode === 'read') return writeDisabled(conn);
    return new ToilError('DATABASE', `SQL Server: ${message}`, {
      fix: `The server itself refused the write: connection ${conn.name} reaches a read-only database or a readable secondary. Point it at the primary, or ask the DBA.`,
    });
  }
  if (number === 1205 || number === 1222) {
    return new ToilError('DATABASE', `SQL Server: ${message}`, { fix: 'A conflict with other sessions (a deadlock or a lock wait). Retry shortly.' });
  }
  if (number !== undefined) {
    return new ToilError('DATABASE', `SQL Server: ${message}`, { fix: 'Check the SQL against toil db describe-table for the tables it uses.' });
  }

  if (f.code === 'EENCRYPT') {
    return new ToilError('NETWORK', `SQL Server at ${where} requires encryption, and connection ${conn.name} doesn't have "ssl": true.`, {
      fix: `Set "ssl" to true on connection ${conn.name}. toil checks the server's certificate against the operating system's store.`,
    });
  }
  if (/CERT|SELF_SIGNED|ERR_TLS|UNABLE_TO_VERIFY/.test(causeCode)) {
    return new ToilError('NETWORK', `The TLS certificate of SQL Server at ${where} wasn't trusted for connection ${conn.name} (${causeCode}).`, {
      fix: "toil trusts the operating system's certificate store. Add your organization's CA, or the server's certificate, there, and check that \"host\" matches the certificate's name.",
    });
  }
  if (f.code === 'ETIMEOUT') {
    return new ToilError('NETWORK', `SQL Server at ${where} didn't answer within ${CONNECT_TIMEOUT_MS / 1000}s for connection ${conn.name}.`, {
      fix: `Check "host" and "port" on connection ${conn.name}, and that a firewall isn't dropping the connection.`,
    });
  }
  if (f.code === 'ESOCKET' || NETWORK_CODES.has(causeCode) || NETWORK_CODES.has(f.code ?? '')) {
    return new ToilError('NETWORK', `Couldn't reach SQL Server at ${where} for connection ${conn.name}${causeCode ? ` (${causeCode})` : ''}.`, {
      fix: `Check "host" and "port" on connection ${conn.name}, and that this machine can reach the server. A named instance needs its TCP port in "port".`,
    });
  }
  return new ToilError('DATABASE', `SQL Server: ${message}`, { fix: 'Check the connection settings and the SQL. If it persists, run with --debug and report it.' });
}

/** The type as SQL Server names it in DDL (`int`, `nvarchar(50)`, `decimal(10,2)`), from a result column's metadata. */
export function typeName(meta: ColumnMetadata | undefined): string | null {
  if (!meta) return null;
  const name = meta.type.name;
  const len = meta.dataLength;
  const sized = (base: string, unit: number) => `${base}(${len === undefined || len === 0xffff || len > 8000 ? 'max' : len / unit})`;
  switch (name) {
    case 'IntN':
      return ({ 1: 'tinyint', 2: 'smallint', 4: 'int', 8: 'bigint' } as Record<number, string>)[len ?? 4] ?? 'int';
    case 'FloatN':
      return len === 4 ? 'real' : 'float';
    case 'MoneyN':
      return len === 4 ? 'smallmoney' : 'money';
    case 'DateTimeN':
      return len === 4 ? 'smalldatetime' : 'datetime';
    case 'BitN':
      return 'bit';
    case 'DecimalN':
    case 'Decimal':
      return `decimal(${meta.precision},${meta.scale})`;
    case 'NumericN':
    case 'Numeric':
      return `numeric(${meta.precision},${meta.scale})`;
    case 'VarChar':
    case 'Char':
    case 'VarBinary':
    case 'Binary':
      return sized(name.toLowerCase(), 1);
    case 'NVarChar':
    case 'NChar':
      return sized(name.toLowerCase(), 2);
    case 'Time':
    case 'DateTime2':
    case 'DateTimeOffset':
      return `${name.toLowerCase()}(${meta.scale})`;
    case 'UDT':
      return meta.udtInfo?.typeName ?? 'udt';
    case 'Variant':
      return 'sql_variant';
    default:
      return name.toLowerCase();
  }
}

/**
 * Values as JSON can carry them without shifting. tedious reads a date or
 * time with no zone as if it were UTC, so its UTC fields are the server's
 * wall clock, written back without a zone; datetimeoffset is an instant, in
 * UTC. bigint arrives as a string and becomes a BigInt, so paging keeps it a
 * number when it fits.
 */
function toValue(value: unknown, meta: ColumnMetadata | undefined): unknown {
  if (value === null || value === undefined || !meta) return value ?? null;
  const name = meta.type.name;
  if (typeof value === 'string' && (name === 'BigInt' || (name === 'IntN' && meta.dataLength === 8))) return BigInt(value);
  if (value instanceof Date) {
    const iso = value.toISOString();
    if (name === 'Date') return iso.slice(0, 10);
    if (name === 'Time') return iso.slice(11, 23);
    if (name === 'DateTimeOffset') return iso;
    return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`;
  }
  return value;
}

function resultColumns(columns: ColumnMetadata[]): ResultColumn[] {
  return columns.map((c) => ({ name: c.colName, type: typeName(c) }));
}

async function schemaExists(s: Session, schema: string): Promise<boolean> {
  return (await s.rows('SELECT 1 FROM sys.schemas WHERE name = @schema', { schema })).length > 0;
}

/** The table or view, as the catalog names it, or undefined. */
async function findTable(s: Session, ref: TableRef): Promise<{ id: number; schema: string; name: string; type: 'table' | 'view' } | undefined> {
  const [row] = await s.rows<[number, string, string, string]>(
    "SELECT o.object_id, sc.name, o.name, RTRIM(o.type) FROM sys.objects o JOIN sys.schemas sc ON sc.schema_id = o.schema_id WHERE sc.name = @schema AND o.name = @table AND o.type IN ('U', 'V')",
    { schema: ref.schema, table: ref.table },
  );
  return row ? { id: row[0], schema: row[1], name: row[2], type: row[3] === 'V' ? 'view' : 'table' } : undefined;
}

function notFoundSchema(conn: DbConnection, schema: string): ToilError {
  return new ToilError('NOT_FOUND', `Connection ${conn.name} has no schema "${schema}".`, { fix: 'Run toil db list-schemas to see the schemas it has.' });
}

function notFoundTable(conn: DbConnection, ref: TableRef): ToilError {
  return new ToilError('NOT_FOUND', `Schema "${ref.schema}" on connection ${conn.name} has no table or view "${ref.table}".`, {
    fix: `Run toil db list-tables --schema ${ref.schema} to see what it has.`,
  });
}

async function requireTable(s: Session, conn: DbConnection, ref: TableRef) {
  if (!(await schemaExists(s, ref.schema))) throw notFoundSchema(conn, ref.schema);
  const table = await findTable(s, ref);
  if (!table) throw notFoundTable(conn, ref);
  return table;
}

/** sys.foreign_keys' action names; NO ACTION is the default, so it reads as null. */
function action(desc: string): string | null {
  return desc === 'NO_ACTION' ? null : desc.replace(/_/g, ' ');
}

function emptyStatement(): ToilError {
  return new ToilError('INVALID_INPUT', 'The SQL holds no statement, only comments or semicolons.', { fix: 'Pass the statement to run.' });
}

function tooManyResults(): ToilError {
  return new ToilError('INVALID_INPUT', 'db query runs exactly one statement, and this SQL returned more than one result.', {
    fix: 'Send one statement per call. To run a script of writes, use toil db execute.',
  });
}

/** The column list of one type, in order, for an index or a key. */
function grouped<K, V>(rows: Array<[K, V]>): Map<K, V[]> {
  const out = new Map<K, V[]>();
  for (const [k, v] of rows) out.set(k, [...(out.get(k) ?? []), v]);
  return out;
}

export const sqlserverProvider: DbProvider = {
  engine: 'sqlserver',
  label: 'SQL Server',
  requires: ['host', 'database', 'user'],
  defaultSchema: 'dbo',
  verification: 'integration',

  listSchemas(conn, call) {
    return session(conn, 'read', call, async (s) => {
      // Not sys, INFORMATION_SCHEMA, guest, or the db_* schemas every database is created with (ids 16384 and up).
      const rows = await s.rows<[string]>(
        "SELECT name FROM sys.schemas WHERE schema_id < 16384 AND name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest') ORDER BY name COLLATE Latin1_General_BIN2",
      );
      return rows.map(([name]) => ({ name }));
    });
  },

  listTables(conn, schema, call) {
    return session(conn, 'read', call, async (s) => {
      if (!(await schemaExists(s, schema))) throw notFoundSchema(conn, schema);
      const rows = await s.rows<[string, string]>(
        "SELECT o.name, RTRIM(o.type) FROM sys.objects o JOIN sys.schemas sc ON sc.schema_id = o.schema_id WHERE sc.name = @schema AND o.type IN ('U', 'V') AND o.is_ms_shipped = 0 ORDER BY o.name COLLATE Latin1_General_BIN2",
        { schema },
      );
      return rows.map(([name, type]) => ({ name, type: type === 'V' ? ('view' as const) : ('table' as const) }));
    });
  },

  describeTable(conn, ref, call) {
    return session(conn, 'read', call, async (s) => {
      const table = await requireTable(s, conn, ref);
      const id = String(table.id);
      const columns = await s.rows<[string, string, number, number, number, boolean, string | null, number | null]>(
        `SELECT c.name, t.name, c.max_length, c.precision, c.scale, c.is_nullable, dc.definition, pk.key_ordinal
           FROM sys.columns c
           JOIN sys.types t ON t.user_type_id = c.user_type_id
           LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
           LEFT JOIN (SELECT ic.column_id, ic.key_ordinal FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                       WHERE i.object_id = CAST(@id AS int) AND i.is_primary_key = 1) pk ON pk.column_id = c.column_id
          WHERE c.object_id = CAST(@id AS int)
          ORDER BY c.column_id`,
        { id },
      );
      const indexRows = await s.rows<[string, boolean, string]>(
        `SELECT i.name, i.is_unique, c.name
           FROM sys.indexes i
           JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0 AND ic.key_ordinal > 0
           JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
          WHERE i.object_id = CAST(@id AS int) AND i.name IS NOT NULL
          ORDER BY i.name COLLATE Latin1_General_BIN2, ic.key_ordinal`,
        { id },
      );
      const fkRows = await s.rows<[string, string, string, string, string, string, string]>(
        `SELECT fk.name, pc.name, rs.name, rt.name, rc.name, fk.update_referential_action_desc, fk.delete_referential_action_desc
           FROM sys.foreign_keys fk
           JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
           JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
           JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
           JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
           JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
          WHERE fk.parent_object_id = CAST(@id AS int)
          ORDER BY fk.name COLLATE Latin1_General_BIN2, fkc.constraint_column_id`,
        { id },
      );

      const cols: ColumnInfo[] = columns.map(([name, type, maxLength, precision, scale, nullable, dflt, pk]) => ({
        name,
        type: declaredType(type, maxLength, precision, scale),
        nullable,
        default: dflt,
        primaryKey: pk ?? null,
      }));
      const primaryKey = cols
        .filter((c) => c.primaryKey !== null)
        .sort((a, b) => a.primaryKey! - b.primaryKey!)
        .map((c) => c.name);
      const unique = new Map(indexRows.map(([name, isUnique]) => [name, isUnique]));
      const indexes: IndexInfo[] = [...grouped(indexRows.map(([name, , column]) => [name, column] as [string, string]))].map(([name, columns]) => ({
        name,
        columns,
        unique: unique.get(name) ?? false,
      }));
      const foreignKeys: ForeignKeyInfo[] = [];
      const byKey = new Map<string, ForeignKeyInfo>();
      for (const [name, column, schema, refTable, refColumn, onUpdate, onDelete] of fkRows) {
        let fk = byKey.get(name);
        if (!fk) {
          fk = { columns: [], references: { schema, table: refTable, columns: [] }, onUpdate: action(onUpdate), onDelete: action(onDelete) };
          byKey.set(name, fk);
          foreignKeys.push(fk);
        }
        fk.columns.push(column);
        fk.references.columns.push(refColumn);
      }
      return { schema: table.schema, name: table.name, type: table.type, columns: cols, primaryKey, indexes, foreignKeys };
    });
  },

  previewTable(conn, ref, window, call) {
    return session(conn, 'read', call, async (s): Promise<RowSet> => {
      const table = await requireTable(s, conn, ref);
      let columns: ColumnMetadata[] = [];
      const rows: unknown[][] = [];
      // OFFSET needs an ORDER BY. The primary key gives pages that never
      // overlap; a table without one keeps the engine's natural order.
      const key = await s.rows<[string]>(
        `SELECT c.name FROM sys.indexes i
           JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
           JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
          WHERE i.object_id = CAST(@id AS int) AND i.is_primary_key = 1 ORDER BY ic.key_ordinal`,
        { id: String(table.id) },
      );
      const orderBy = key.length > 0 ? key.map(([name]) => quoteIdent(name)).join(', ') : '(SELECT NULL)';
      await s.run(
        `SELECT * FROM ${quoteIdent(table.schema)}.${quoteIdent(table.name)} ORDER BY ${orderBy} OFFSET ${window.offset} ROWS FETCH NEXT ${window.max} ROWS ONLY`,
        { columns: (c) => (columns = c), row: (values) => rows.push(values) },
      );
      return { columns: resultColumns(columns), rows };
    });
  },

  query(conn, sql, window, call) {
    const scan = scanScript(sql);
    if (scan.empty) return Promise.reject(emptyStatement());
    if (scan.transactionControl) {
      return Promise.reject(
        new ToilError('INVALID_INPUT', `${scan.transactionControl} is refused on reads: it would end the transaction that keeps a read from changing anything.`, {
          fix: 'Leave transaction control out of the query. To change data, use toil db execute --allow-write on a connection with writes on.',
        }),
      );
    }
    return session(conn, 'read', call, async (s): Promise<RowSet> => {
      let columns: ColumnMetadata[] = [];
      let results = 0;
      let seen = 0;
      const rows: unknown[][] = [];
      let stopped: 'full' | 'write' | 'results' | undefined;
      let failure: unknown;
      const stop = (why: typeof stopped) => {
        if (stopped) return;
        stopped = why;
        // An attention: the server stops the batch here, and nothing after it runs.
        s.cancel();
      };
      try {
        await s.run(sql, {
          columns: (c) => {
            results++;
            if (results === 1) columns = c;
            else stop('results');
          },
          row: (values) => {
            if (results !== 1 || stopped) return;
            if (seen++ < window.offset) return;
            rows.push(values);
            if (rows.length >= window.max) stop('full');
          },
          statement: (done) => {
            if (WRITES.has(done.cmd)) stop('write');
          },
        });
      } catch (err) {
        // The attention toil sent itself ends the request with ECANCEL; anything else is the server's answer.
        if (!(stopped && (err as MssqlFailure).code === 'ECANCEL')) failure = err;
      }
      // Checked first: a COMMIT inside dynamic SQL can follow a write before the attention lands,
      // and then "nothing was changed" would be untrue. Any other failed statement may end the
      // transaction on its own (a deadlock), which is the server's doing, not the SQL's.
      // Error 266 is the server noticing the transaction count changed under EXEC: the same ending, reported.
      if ((failure === undefined || (failure as MssqlFailure).number === 266) && !s.connection.inTransaction) throw endedTransaction(conn, 'read');
      if (stopped === 'write') throw writeDisabled(conn);
      if (failure !== undefined) throw failure;
      if (stopped === 'results') throw tooManyResults();
      return { columns: resultColumns(columns), rows };
    });
  },

  async execute(conn, sql, call) {
    const scan = scanScript(sql);
    if (scan.empty) throw emptyStatement();
    if (scan.transactionControl) {
      throw new ToilError(
        'INVALID_INPUT',
        `db execute runs the whole script in one transaction, and this SQL starts or ends one of its own (${scan.transactionControl}). Nothing was changed.`,
        { fix: 'Remove the transaction statements (BEGIN TRANSACTION, COMMIT, ROLLBACK, SAVE TRANSACTION) and send the rest; toil commits only if every statement succeeds.' },
      );
    }
    return session(conn, 'write', call, async (s) => {
      let changes = 0;
      await s.run(sql, { statement: (done) => void (CHANGES.has(done.cmd) && (changes += done.rowCount ?? 0)) });
      return { changes };
    });
  },
};

/** A column's declared type from sys.columns: `varchar(100)`, `nvarchar(max)`, `decimal(10,2)`, `datetime2(7)`. */
function declaredType(type: string, maxLength: number, precision: number, scale: number): string {
  if (['varchar', 'char', 'varbinary', 'binary'].includes(type)) return `${type}(${maxLength === -1 ? 'max' : maxLength})`;
  if (['nvarchar', 'nchar'].includes(type)) return `${type}(${maxLength === -1 ? 'max' : maxLength / 2})`;
  if (['decimal', 'numeric'].includes(type)) return `${type}(${precision},${scale})`;
  if (['datetime2', 'time', 'datetimeoffset'].includes(type)) return `${type}(${scale})`;
  return type;
}
