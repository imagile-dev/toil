import { apiPath } from '../../api-path.js';
import { ToilError } from '../../errors.js';
import { redactUrl } from '../../http.js';
import { buildUrl, restResponse, type RestOptions } from '../../rest.js';
import type { ColumnInfo, DbCall, DbConnection, DbProvider, ForeignKeyInfo, IndexInfo, ResultColumn, RowSet, RowWindow, TableRef } from '../provider.js';
import { scanSql } from './split.js';

/**
 * Teradata through the Teradata Query Service: SQL over HTTPS, JSON back. The
 * official Node driver loads a native library, which toil can't ship; the
 * Query Service is plain HTTP, so every request goes through the command's
 * own fetch, and with it the proxy, the OS certificate store, --verbose and
 * the audit log, as for any HTTP area.
 *
 * Teradata has no read-only transaction, and the Query Service has no
 * read-only session. What it does have is an explicit session in ANSI mode
 * with auto-commit off (`transaction_mode: ANSI`, `auto_commit: false` on
 * `POST /systems/<system>/sessions`): in ANSI mode a transaction is open from
 * the first statement until a COMMIT or ROLLBACK, and logging off rolls back
 * whatever is still open. So each call opens a session of its own, runs its
 * statements there, and a read ends with ROLLBACK and a closed session, as
 * SQL Server's reads do. A read whose result the service reports as an
 * update count rather than rows (an INSERT, an UPDATE, DDL) is WRITE_DISABLED,
 * rolled back with the rest. The docs still tell users to connect as a
 * read-only user, which is what makes the database itself refuse a write.
 *
 * A cancel or time limit asks the service to abort the session's running
 * queries (`DELETE /systems/<system>/queries/<id>`), then closes the session,
 * on the cleanup fetch, since the command's own signal has already fired.
 * Introspection reads the DBC views with every name as a bound parameter;
 * preview's FROM clause is built from the names the catalog just returned,
 * quoted. Every session is closed on the way out, which is more than can be
 * said for most meetings.
 */

const ACCEPT = 'application/vnd.com.teradata.rest-v1.0+json';
const SERVICE = 'Teradata Query Service';
/** How long a cleanup request (a cancel, a ROLLBACK, closing the session) may take. Nothing else bounds it. */
const CLEANUP_TIMEOUT_MS = 10_000;

/**
 * Databases Teradata creates and maintains itself, left out of `schema list`
 * as other engines leave out their catalogs. Compared upper-cased. They can
 * still be read by name (`--schema DBC`).
 */
const SYSTEM_DATABASES = [
  'ALL', 'CRASHDUMPS', 'DBC', 'DBCMNGR', 'DEFAULT', 'EXTERNAL_AP', 'EXTUSER', 'LOCKLOGSHREDDER', 'PUBLIC', 'SQLJ', 'SYSADMIN', 'SYSBAR', 'SYSJDBC',
  'SYSLIB', 'SYSSPATIAL', 'SYSTEMFE', 'SYSUDTLIB', 'SYSXML', 'SYS_CALENDAR', 'TDMAPS', 'TDPUSER', 'TDQCD', 'TDSTATS', 'TDWM', 'TD_ANALYTICS_DB',
  'TD_SERVER_DB', 'TD_SYSFNLIB', 'TD_SYSGPL', 'TD_SYSXML',
];

/** One element of an answer's `results`: a result set, or an update count. */
interface QsResult {
  resultSet?: boolean;
  columns?: Array<{ name?: unknown; type?: unknown }>;
  data?: unknown[];
  rowCount?: number;
}

interface QsAnswer {
  results?: QsResult[];
  /** An error the service hit after it had already sent a 200. */
  responseError?: unknown;
}

/** An error body: `{ "error": "3802", "message": "Database 'x' does not exist." }`. */
interface QsError {
  error?: unknown;
  message?: unknown;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * JSON with numbers kept exact. The service writes BIGINT and DECIMAL values
 * as JSON numbers, and JSON.parse would round one past 2^53 or 15 significant
 * digits without a word. The reviver sees each number's source text (Node 24)
 * and keeps an integer that doesn't fit as a BigInt, which paging turns into a
 * string, and a longer decimal as its text.
 */
export function parseExactJson(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    const source = context?.source;
    if (typeof value !== 'number' || source === undefined) return value;
    if (/^-?\d+$/.test(source)) return Number.isSafeInteger(value) ? value : BigInt(source);
    const digits = source.replace(/^-/, '').replace(/[eE].*$/, '').replace('.', '').replace(/^0+/, '');
    return digits.length > 15 ? source : value;
  });
}

/** The request settings that never change for a connection: where, and as whom. */
function endpoint(conn: DbConnection) {
  const headers: Record<string, string> = {
    accept: ACCEPT,
    authorization: conn.token !== undefined ? `Bearer ${conn.token}` : `Basic ${Buffer.from(`${conn.user ?? ''}:${conn.password ?? ''}`, 'utf8').toString('base64')}`,
  };
  const authFix =
    conn.token !== undefined
      ? `The Query Service refused connection ${conn.name}'s token; it may have expired. Get a new one and store it (toil connections login ${conn.name}, or the token's env var).`
      : `Check "user" and "password" on connection ${conn.name} (toil connections login ${conn.name}, or the password's env var), and "logMech": a directory account needs LDAP.`;
  return { headers, authFix };
}

/** One explicit session on the Query Service, and what's needed to stop it. */
class Session {
  constructor(
    private readonly conn: DbConnection,
    private readonly call: DbCall,
    readonly id: number,
  ) {}

  /** Runs SQL on this session; `window` sets the rows to skip and keep, and none means every row. */
  async run(sql: string, mode: Mode, options: { params?: unknown[]; window?: RowWindow } = {}): Promise<QsResult[]> {
    const body = {
      query: sql,
      format: 'ARRAY',
      include_columns: true,
      session: this.id,
      // 0 is the service's "no limit"; left out, it stops at 1000 rows.
      row_limit: options.window?.max ?? 0,
      ...(options.window && options.window.offset > 0 ? { row_offset: options.window.offset } : {}),
      ...(options.params ? { params: [options.params] } : {}),
    };
    const answer = (await send(this.conn, this.call, 'POST', apiPath`systems/${this.conn.system!}/queries`, body, mode)) as QsAnswer | undefined;
    if (answer?.responseError !== undefined && answer.responseError !== null) {
      throw new ToilError('DATABASE', `Teradata: ${errorText(answer.responseError)}`, { fix: 'The statement failed while its rows were being sent. Run it again; if it keeps failing, narrow it.' });
    }
    if (!Array.isArray(answer?.results)) throw unexpected(this.conn, 'a query answer with no results');
    return answer.results;
  }

  /** Rows of a catalog query, as arrays. */
  async rows<T extends unknown[] = unknown[]>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [result] = await this.run(sql, 'read', params.length > 0 ? { params } : {});
    return (result?.data ?? []) as T[];
  }

  /** Asks the service to abort whatever this session is running. Best effort: it reports through debug, never throws. */
  async cancel(): Promise<void> {
    const system = this.conn.system!;
    try {
      const queries = (await send(this.conn, this.call, 'GET', apiPath`systems/${system}/queries?session=${this.id}`, undefined, 'read', true)) as unknown;
      for (const q of Array.isArray(queries) ? queries : []) {
        const id = (q as { queryId?: unknown; query_id?: unknown }).queryId ?? (q as { query_id?: unknown }).query_id;
        if (typeof id !== 'number') continue;
        await send(this.conn, this.call, 'DELETE', apiPath`systems/${system}/queries/${id}`, undefined, 'read', true);
        this.call.debug(`teradata: connection ${this.conn.name}: asked the Query Service to abort query ${id}`);
      }
    } catch (err) {
      this.call.debug(`teradata: connection ${this.conn.name}: couldn't abort session ${this.id}'s queries: ${(err as Error).message}`);
    }
  }

  /** ROLLBACK, then close the session, which rolls back anything still open. Best effort, on the cleanup fetch. */
  async close(rollback: boolean): Promise<void> {
    const system = this.conn.system!;
    if (rollback) {
      try {
        await send(this.conn, this.call, 'POST', apiPath`systems/${system}/queries`, { query: 'ROLLBACK', session: this.id }, 'read', true);
      } catch (err) {
        this.call.debug(`teradata: connection ${this.conn.name}: ROLLBACK on session ${this.id} failed (${(err as Error).message}); closing the session rolls it back`);
      }
    }
    try {
      await send(this.conn, this.call, 'DELETE', apiPath`systems/${system}/sessions/${this.id}`, undefined, 'read', true);
    } catch (err) {
      this.call.debug(`teradata: connection ${this.conn.name}: closing session ${this.id} failed (${(err as Error).message}); the Query Service closes it once it's idle`);
    }
  }
}

type Mode = 'read' | 'write';

/**
 * One request to the Query Service. Statuses the service gives a meaning of
 * its own (404, 412, 420, 429) come back as an answer and are mapped here;
 * the rest fail as any REST call does. `cleanup` sends on the cleanup fetch,
 * with a timeout of its own, because the command's signal may have fired.
 */
async function send(conn: DbConnection, call: DbCall, method: 'GET' | 'POST' | 'DELETE', path: string, json: unknown, mode: Mode, cleanup = false): Promise<unknown> {
  const { headers, authFix } = endpoint(conn);
  const url = buildUrl(conn.baseUrl!, path);
  const init: RequestInit = { method, headers: json === undefined ? headers : { ...headers, 'content-type': 'application/json' } };
  if (json !== undefined) init.body = JSON.stringify(json);
  const options: RestOptions = {
    service: SERVICE,
    authFix,
    as: 'text',
    accept: [404, 412, 420, 429],
    // A session limit frees up when someone else's work ends, not in the seconds a retry waits.
    retryRateLimit: false,
    urlKey: 'baseUrl',
    ...(cleanup ? { timeoutMs: CLEANUP_TIMEOUT_MS } : {}),
  };
  const ctx = cleanup ? { fetch: call.cleanupFetch, signal: new AbortController().signal } : { fetch: call.fetch, signal: call.signal };
  const response = await restResponse<string>(ctx, url, init, options);
  let body: unknown;
  try {
    body = response.data === '' ? undefined : parseExactJson(response.data);
  } catch {
    throw new ToilError('HTTP', `${SERVICE} answered ${redactUrl(response.url)} with something that isn't JSON.`, {
      fix: 'Check "baseUrl" points at the Query Service itself, not a sign-in page or proxy in front of it.',
      details: { status: response.status, url: redactUrl(response.url) },
    });
  }
  if (response.status >= 200 && response.status < 300) return body;
  throw failure(conn, response.status, body as QsError | undefined, mode, redactUrl(response.url));
}

function errorText(body: unknown): string {
  if (typeof body === 'string') return body;
  const e = (body ?? {}) as QsError;
  const message = typeof e.message === 'string' ? e.message : JSON.stringify(body);
  return e.error !== undefined && e.error !== null && e.error !== '' ? `${String(e.error)} ${message}` : message;
}

/** Teradata's access-right refusal: "user ... does not have INSERT access to ...". */
const WRITE_ACCESS = /does not have (?:INSERT|UPDATE|DELETE|CREATE \w+|DROP \w+|ALTER \w+|INDEX|EXECUTE PROCEDURE) access/i;

function failure(conn: DbConnection, status: number, body: QsError | undefined, mode: Mode, url: string): ToilError {
  const details = { status, url, ...(body?.error !== undefined ? { teradataError: String(body.error) } : {}) };
  const text = errorText(body);
  if (status === 429) {
    return new ToilError('HTTP', `${SERVICE} refused a new session for connection ${conn.name}: the user already has as many sessions as it's allowed (HTTP 429 Too Many Sessions). ${text}`, {
      fix: "Try again once the user's other sessions have ended; each toil call opens one session and closes it when it's done. If it keeps happening, ask the Query Service administrator to raise the user's session limit.",
      details: { ...details, retryable: true },
    });
  }
  if (status === 412) {
    return new ToilError('HTTP', `${SERVICE} couldn't run the request for connection ${conn.name}: the session was in use, or no thread was free before the queue timeout (HTTP 412). ${text}`, {
      fix: 'Try again shortly; the Query Service is busy.',
      details: { ...details, retryable: true },
    });
  }
  if (status === 404) {
    return new ToilError('NOT_FOUND', `${SERVICE} at ${new URL(conn.baseUrl!).origin} has no system "${conn.system}" for connection ${conn.name} (HTTP 404). ${text}`, {
      fix: `Check "system" on connection ${conn.name}: it's the alias the Query Service administrator gave the system. Check "baseUrl" too, including any path in front of /systems (such as /api/query).`,
      details,
    });
  }
  // 420: the database itself refused or failed the statement.
  if (mode === 'read' && WRITE_ACCESS.test(text)) return writeDisabled(conn);
  const code = String(body?.error ?? '');
  if (code === '2631') {
    return new ToilError('DATABASE', `Teradata: ${text}`, { fix: 'The transaction was aborted in a deadlock with another session. Retry shortly.', details });
  }
  if (code === '3523' || code === '3524') {
    return new ToilError('DATABASE', `Teradata: ${text}`, { fix: `The user on connection ${conn.name} lacks that access right. Ask the DBA to grant it, or read something the user can see.`, details });
  }
  return new ToilError('DATABASE', `Teradata: ${text}`, { fix: 'Check the SQL against toil db table describe for the tables it uses.', details });
}

function unexpected(conn: DbConnection, what: string): ToilError {
  return new ToilError('HTTP', `${SERVICE} sent connection ${conn.name} ${what}.`, {
    fix: 'Check "baseUrl" points at the Query Service; if it does, run with --debug and report it.',
  });
}

function writeDisabled(conn: DbConnection): ToilError {
  return new ToilError('WRITE_DISABLED', `The statement tried to change data, and reads on connection ${conn.name} are read-only. Nothing was changed: the read was rolled back.`, {
    fix: `To make a change, use toil db execute with --allow-write; writes must also be on for connection ${conn.name}.`,
  });
}

/**
 * One explicit ANSI-mode session, one transaction, one call. Reads always
 * roll back; a write commits only if every statement succeeded. On abort the
 * service is asked to stop the session's queries, and the work's own error is
 * dropped: core has already answered TIMEOUT or CANCELLED. The session is
 * closed whatever happens.
 */
async function session<T>(conn: DbConnection, mode: Mode, call: DbCall, work: (s: Session) => Promise<T>): Promise<T> {
  if (call.signal.aborted) throw call.signal.reason;
  const request = {
    transaction_mode: 'ANSI',
    auto_commit: false,
    ...(conn.database ? { default_database: conn.database } : {}),
    ...(conn.logMech ? { log_mech: conn.logMech } : {}),
  };
  call.debug(`teradata: connection ${conn.name}, system ${conn.system}: opening an ANSI session, ${mode === 'read' ? 'read, rolled back' : 'read-write'}`);
  let opened: unknown;
  try {
    opened = await send(conn, call, 'POST', apiPath`systems/${conn.system!}/sessions`, request, mode);
  } catch (err) {
    if (call.signal.aborted) throw call.signal.reason;
    throw err;
  }
  const id = (opened as { sessionId?: unknown; session_id?: unknown } | undefined)?.sessionId ?? (opened as { session_id?: unknown } | undefined)?.session_id;
  if (typeof id !== 'number') throw unexpected(conn, 'a session with no session id');
  const s = new Session(conn, call, id);
  let cancelling: Promise<void> | undefined;
  const onAbort = () => {
    cancelling = s.cancel();
  };
  call.signal.addEventListener('abort', onAbort, { once: true });
  let committed = false;
  try {
    const result = await work(s);
    if (mode === 'write') {
      await s.run('COMMIT', 'write');
      committed = true;
    }
    return result;
  } catch (err) {
    if (call.signal.aborted) throw call.signal.reason;
    throw err;
  } finally {
    call.signal.removeEventListener('abort', onAbort);
    if (cancelling) await cancelling;
    // An aborted session has nothing to roll back on top of closing it, which does that anyway.
    await s.close(!committed && !cancelling);
  }
}

/** A column's declared type from DBC.ColumnsV's two-letter code: `VARCHAR(100)`, `DECIMAL(10,2)`, `TIMESTAMP(6)`. */
export function declaredType(code: string | null, length: number | null, digits: number | null, fraction: number | null, charType: number | null): string | null {
  if (code === null) return null;
  const c = code.trim();
  const chars = length === null ? null : charType === 2 ? length / 2 : length;
  const sized = (base: string, n: number | null) => (n === null ? base : `${base}(${n})`);
  switch (c) {
    case 'CV': return sized('VARCHAR', chars);
    case 'CF': return sized('CHAR', chars);
    case 'CO': return 'CLOB';
    case 'BV': return sized('VARBYTE', length);
    case 'BF': return sized('BYTE', length);
    case 'BO': return 'BLOB';
    case 'I1': return 'BYTEINT';
    case 'I2': return 'SMALLINT';
    case 'I': return 'INTEGER';
    case 'I8': return 'BIGINT';
    case 'F': return 'FLOAT';
    case 'D': return digits === null ? 'DECIMAL' : `DECIMAL(${digits},${fraction ?? 0})`;
    // NUMBER with no precision is reported with -128 digits.
    case 'N': return digits === null || digits < 0 ? 'NUMBER' : `NUMBER(${digits},${fraction ?? 0})`;
    case 'DA': return 'DATE';
    case 'AT': return sized('TIME', fraction);
    case 'TZ': return `${sized('TIME', fraction)} WITH TIME ZONE`;
    case 'TS': return sized('TIMESTAMP', fraction);
    case 'SZ': return `${sized('TIMESTAMP', fraction)} WITH TIME ZONE`;
    case 'JN': return 'JSON';
    case 'XM': return 'XML';
    case 'PD': return 'PERIOD(DATE)';
    case 'PS': return 'PERIOD(TIMESTAMP)';
    case 'PM': return 'PERIOD(TIMESTAMP WITH TIME ZONE)';
    case 'PT': return 'PERIOD(TIME)';
    case 'PZ': return 'PERIOD(TIME WITH TIME ZONE)';
    case 'YR': return 'INTERVAL YEAR';
    case 'YM': return 'INTERVAL YEAR TO MONTH';
    case 'MO': return 'INTERVAL MONTH';
    case 'DY': return 'INTERVAL DAY';
    case 'DH': return 'INTERVAL DAY TO HOUR';
    case 'DM': return 'INTERVAL DAY TO MINUTE';
    case 'DS': return 'INTERVAL DAY TO SECOND';
    case 'HR': return 'INTERVAL HOUR';
    case 'HM': return 'INTERVAL HOUR TO MINUTE';
    case 'HS': return 'INTERVAL HOUR TO SECOND';
    case 'MI': return 'INTERVAL MINUTE';
    case 'MS': return 'INTERVAL MINUTE TO SECOND';
    case 'SC': return 'INTERVAL SECOND';
    case 'UT': return 'UDT';
    default: return c;
  }
}

function resultColumns(conn: DbConnection, result: QsResult): ResultColumn[] {
  const columns = (result.columns ?? []).map((c) => ({ name: String(c.name ?? ''), type: typeof c.type === 'string' ? c.type : null }));
  if (columns.length === 0 && (result.data?.length ?? 0) > 0) throw unexpected(conn, 'rows without column names');
  return columns;
}

function rowSet(conn: DbConnection, result: QsResult): RowSet {
  return { columns: resultColumns(conn, result), rows: (result.data ?? []).map((row) => (Array.isArray(row) ? row : [row])) };
}

/** The database as the catalog names it, or undefined. Names compare case-blind, as Teradata's do. */
async function findDatabase(s: Session, name: string): Promise<string | undefined> {
  const [row] = await s.rows<[string]>('SELECT DatabaseName FROM DBC.DatabasesV WHERE UPPER(DatabaseName) = UPPER(?)', [name]);
  return row?.[0];
}

/** The table or view, as the catalog names it, or undefined. */
async function findTable(s: Session, ref: TableRef): Promise<{ schema: string; name: string; type: 'table' | 'view' } | undefined> {
  const [row] = await s.rows<[string, string, string]>(
    "SELECT DatabaseName, TableName, TableKind FROM DBC.TablesV WHERE UPPER(DatabaseName) = UPPER(?) AND UPPER(TableName) = UPPER(?) AND TableKind IN ('T', 'O', 'Q', 'V')",
    [ref.schema, ref.table],
  );
  return row ? { schema: row[0], name: row[1], type: row[2].trim() === 'V' ? 'view' : 'table' } : undefined;
}

function notFoundSchema(conn: DbConnection, schema: string): ToilError {
  return new ToilError('NOT_FOUND', `Connection ${conn.name} has no database "${schema}".`, { fix: 'Run toil db schema list to see the databases it has.' });
}

function notFoundTable(conn: DbConnection, ref: TableRef): ToilError {
  return new ToilError('NOT_FOUND', `Database "${ref.schema}" on connection ${conn.name} has no table or view "${ref.table}".`, {
    fix: `Run toil db table list --schema ${ref.schema} to see what it has.`,
  });
}

async function requireTable(s: Session, conn: DbConnection, ref: TableRef) {
  if ((await findDatabase(s, ref.schema)) === undefined) throw notFoundSchema(conn, ref.schema);
  const table = await findTable(s, ref);
  if (!table) throw notFoundTable(conn, ref);
  return table;
}

interface IndexRow {
  number: number;
  type: string;
  unique: boolean;
  name: string | null;
  column: string;
}

async function indexRows(s: Session, table: { schema: string; name: string }): Promise<IndexRow[]> {
  const rows = await s.rows<[number, string, string, string | null, string]>(
    'SELECT IndexNumber, IndexType, UniqueFlag, IndexName, ColumnName FROM DBC.IndicesV WHERE DatabaseName = ? AND TableName = ? ORDER BY IndexNumber, ColumnPosition',
    [table.schema, table.name],
  );
  return rows.map(([number, type, unique, name, column]) => ({ number: Number(number), type: String(type).trim(), unique: String(unique).trim() === 'Y', name, column }));
}

/**
 * The primary key: a PRIMARY KEY constraint's columns (index type K), or,
 * when there is none, a unique primary index's (P or Q). Teradata turns a
 * PRIMARY KEY declared without a PRIMARY INDEX into the unique primary
 * index, and reports no K for it.
 */
function primaryKeyOf(rows: IndexRow[]): string[] {
  const k = rows.filter((r) => r.type === 'K');
  if (k.length > 0) return k.map((r) => r.column);
  return rows.filter((r) => (r.type === 'P' || r.type === 'Q') && r.unique).map((r) => r.column);
}

function emptyStatement(): ToilError {
  return new ToilError('INVALID_INPUT', 'The SQL holds no statement, only comments or semicolons.', { fix: 'Pass the statement to run.' });
}

function tooManyStatements(): ToilError {
  return new ToilError('INVALID_INPUT', 'db query runs exactly one statement, and this SQL holds more than one.', {
    fix: 'Send one statement per call. To run a script of writes, use toil db execute.',
  });
}

export const teradataProvider: DbProvider = {
  engine: 'teradata',
  label: 'Teradata',
  requires: ['baseUrl', 'system'],
  // A Teradata user's default database is, unless the DBA set another, the user's own.
  defaultSchema: (conn) => conn.database ?? conn.user ?? '',
  verification: 'unit',
  check(settings) {
    const issues: Array<{ key: 'baseUrl' | 'user' | 'token' | 'database'; message: string }> = [];
    if (settings.baseUrl !== undefined && !/^https?:\/\//i.test(settings.baseUrl)) {
      issues.push({ key: 'baseUrl', message: 'Teradata connections need baseUrl to be the http(s) URL of the Query Service, such as https://teradata.imagile.dev:1443.' });
    }
    if (settings.token !== undefined && settings.user !== undefined) {
      issues.push({ key: 'token', message: 'Teradata connections sign in with user and password, or with token, not both: remove one.' });
    } else if (settings.token === undefined && settings.user === undefined) {
      issues.push({ key: 'user', message: 'Teradata connections need user (and its password), or token, a bearer token for the Query Service.' });
    }
    if (settings.token !== undefined && settings.database === undefined) {
      issues.push({ key: 'database', message: 'Teradata connections that sign in with token need database, the database to read when a command names none.' });
    }
    return issues;
  },

  listSchemas(conn, call) {
    return session(conn, 'read', call, async (s) => {
      const rows = await s.rows<[string]>(
        `SELECT DatabaseName FROM DBC.DatabasesV WHERE UPPER(DatabaseName) NOT IN (${SYSTEM_DATABASES.map(() => '?').join(', ')}) ORDER BY DatabaseName`,
        SYSTEM_DATABASES,
      );
      return rows.map(([name]) => ({ name }));
    });
  },

  listTables(conn, schema, call) {
    return session(conn, 'read', call, async (s) => {
      const database = await findDatabase(s, schema);
      if (database === undefined) throw notFoundSchema(conn, schema);
      const rows = await s.rows<[string, string]>("SELECT TableName, TableKind FROM DBC.TablesV WHERE DatabaseName = ? AND TableKind IN ('T', 'O', 'Q', 'V') ORDER BY TableName", [database]);
      return rows.map(([name, kind]) => ({ name, type: String(kind).trim() === 'V' ? ('view' as const) : ('table' as const) }));
    });
  },

  describeTable(conn, ref, call) {
    return session(conn, 'read', call, async (s) => {
      const table = await requireTable(s, conn, ref);
      const columns = await s.rows<[string, string | null, number | null, number | null, number | null, number | null, string | null, string | null]>(
        'SELECT ColumnName, ColumnType, ColumnLength, DecimalTotalDigits, DecimalFractionalDigits, CharType, Nullable, DefaultValue FROM DBC.ColumnsV WHERE DatabaseName = ? AND TableName = ? ORDER BY ColumnId',
        [table.schema, table.name],
      );
      const indexes = table.type === 'view' ? [] : await indexRows(s, table);
      const primaryKey = primaryKeyOf(indexes);
      const fkRows =
        table.type === 'view'
          ? []
          : await s.rows<[number, string | null, string, string, string, string]>(
              'SELECT IndexID, IndexName, ChildKeyColumn, ParentDB, ParentTable, ParentKeyColumn FROM DBC.All_RI_ChildrenV WHERE ChildDB = ? AND ChildTable = ? ORDER BY IndexID',
              [table.schema, table.name],
            );
      const cols: ColumnInfo[] = columns.map(([name, type, length, digits, fraction, charType, nullable, dflt]) => ({
        name,
        type: declaredType(type, length === null ? null : Number(length), digits === null ? null : Number(digits), fraction === null ? null : Number(fraction), charType === null ? null : Number(charType)),
        nullable: String(nullable ?? 'Y').trim() !== 'N',
        default: dflt ?? null,
        primaryKey: primaryKey.findIndex((k) => k.toUpperCase() === name.toUpperCase()) + 1 || null,
      }));
      const byNumber = new Map<number, IndexInfo>();
      for (const row of indexes) {
        const existing = byNumber.get(row.number);
        if (existing) existing.columns.push(row.column);
        else byNumber.set(row.number, { name: row.name ?? ((row.type === 'P' || row.type === 'Q') ? 'primary index' : `index ${row.number}`), columns: [row.column], unique: row.unique });
      }
      const foreignKeys: ForeignKeyInfo[] = [];
      const byKey = new Map<number, ForeignKeyInfo>();
      for (const [key, , column, parentDb, parentTable, parentColumn] of fkRows) {
        let fk = byKey.get(Number(key));
        if (!fk) {
          // Teradata's referential integrity has no ON UPDATE or ON DELETE actions.
          fk = { columns: [], references: { schema: parentDb, table: parentTable, columns: [] }, onUpdate: null, onDelete: null };
          byKey.set(Number(key), fk);
          foreignKeys.push(fk);
        }
        fk.columns.push(column);
        fk.references.columns.push(parentColumn);
      }
      return { schema: table.schema, name: table.name, type: table.type, columns: cols, primaryKey, indexes: [...byNumber.values()], foreignKeys };
    });
  },

  previewTable(conn, ref, window, call) {
    return session(conn, 'read', call, async (s): Promise<RowSet> => {
      const table = await requireTable(s, conn, ref);
      // The primary key gives pages that never overlap; a table without one keeps the engine's own order.
      const key = table.type === 'view' ? [] : primaryKeyOf(await indexRows(s, table));
      const orderBy = key.length > 0 ? ` ORDER BY ${key.map(quoteIdent).join(', ')}` : '';
      const [result] = await s.run(`SELECT * FROM ${quoteIdent(table.schema)}.${quoteIdent(table.name)}${orderBy}`, 'read', { window });
      return result ? rowSet(conn, result) : { columns: [], rows: [] };
    });
  },

  query(conn, sql, window, call) {
    const scan = scanSql(sql);
    if (scan.empty) return Promise.reject(emptyStatement());
    if (scan.statements > 1) return Promise.reject(tooManyStatements());
    if (scan.transactionControl) {
      return Promise.reject(
        new ToilError('INVALID_INPUT', `${scan.transactionControl} is refused on reads: it would end the transaction that keeps a read from changing anything.`, {
          fix: 'Leave transaction control out of the query. To change data, use toil db execute --allow-write on a connection with writes on.',
        }),
      );
    }
    return session(conn, 'read', call, async (s): Promise<RowSet> => {
      const results = await s.run(sql, 'read', { window });
      // An update count where rows were expected: the statement changed something, which the rollback undoes.
      if (results.some((r) => r.resultSet === false)) throw writeDisabled(conn);
      if (results.length !== 1) throw tooManyStatements();
      return rowSet(conn, results[0]!);
    });
  },

  async execute(conn, sql, call) {
    const scan = scanSql(sql);
    if (scan.empty) throw emptyStatement();
    if (scan.transactionControl) {
      throw new ToilError(
        'INVALID_INPUT',
        `db execute runs the whole script in one transaction, and this SQL starts or ends one of its own (${scan.transactionControl}). Nothing was changed.`,
        { fix: 'Remove the transaction statements (BT, ET, BEGIN TRANSACTION, END TRANSACTION, COMMIT, ROLLBACK, ABORT) and send the rest; toil commits only if every statement succeeds.' },
      );
    }
    return session(conn, 'write', call, async (s) => {
      const results = await s.run(sql, 'write');
      return { changes: results.reduce((n, r) => n + (r.resultSet === false && typeof r.rowCount === 'number' ? r.rowCount : 0), 0) };
    });
  },
};
