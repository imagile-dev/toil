import { ToilError } from '../../errors.js';
import { trustedCertificates } from '../../network.js';
import { serverTooOld, type SupportedVersion } from '../../supported.js';
import type { ColumnInfo, DbCall, DbConnection, DbProvider, ForeignKeyInfo, ResultColumn, RowSet, RowWindow, TableRef } from '../provider.js';
import { Hs2Link, LinkFailed, ProtocolFailed, SaslRefused, T, type Hs2Status, type Method, type OperationHandle, type Responses } from './hs2.js';
import { decodeRows, int64ToBigInt, rowCount, typeName } from './rows.js';
import { splitStatements } from './split.js';

/**
 * Hive and Impala through one provider, because both speak HiveServer2's
 * Thrift protocol: Hive natively, Impala on its HiveServer2 port. `hs2.ts`
 * is the connection; this file is everything the db area asks of it.
 *
 * **Read-only is the account's job here, not toil's.** Neither engine has a
 * read-only session or transaction, and there is nothing to roll back: a
 * statement that writes has written by the time it returns. So toil can't
 * make the server refuse a write the way it does on PostgreSQL, and it doesn't
 * parse SQL to decide (the pre-flight lint still refuses the obvious write on
 * `db query` before anything is sent). The docs require a read-only account,
 * a Ranger or Sentry role with SELECT only, and a write that account is
 * refused comes back as WRITE_DISABLED. A write that gets through anyway is
 * reported for what it is, after the fact.
 *
 * For the same reason `db execute` runs one statement per call: with no
 * transaction, a script that failed halfway would leave its first half
 * applied, and "all or nothing" would be a promise toil can't keep.
 *
 * Each call opens its own connection and session and closes both. A cancel or
 * time limit sends CancelOperation for the running statement on the same
 * connection, so the server stops it, then closes the session. Introspection
 * uses the protocol's own catalog calls (GetSchemas, GetTables, GetColumns,
 * GetPrimaryKeys, GetCrossReference), which both engines answer the same way.
 * Their name arguments are patterns in which `_` matches any character, so
 * every answer is filtered to the exact name; a schema called `a_b` has been
 * known to bring `axb` to the meeting.
 */

const CONNECT_TIMEOUT_MS = 15_000;
/** How long a cancel or a closing call may take before toil stops waiting for it. */
const CLOSE_TIMEOUT_MS = 5_000;
/** Rows per FetchResults while filling a page, and while skipping to its offset. */
const FETCH_BATCH = 1000;
/** Columnar results arrived in protocol V6, Hive 0.13. Older servers send rows toil doesn't read. */
const MIN_PROTOCOL = T.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V6!;
const REQUEST_PROTOCOL = T.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V10!;

const STATE = T.TOperationState as Record<string, number>;
const STATE_NAMES = new Map(Object.entries(STATE).map(([name, n]) => [n, name.replace(/_STATE$/, '').toLowerCase()]));

type Mode = 'read' | 'write';

interface Engine {
  engine: 'hive' | 'impala';
  label: 'Hive' | 'Impala';
  port: number;
  verification: DbProvider['verification'];
  /** Schemas the engine keeps for itself, left out of `schema list`. */
  system: ReadonlySet<string>;
  /** Session settings sent with OpenSession. */
  configuration(conn: DbConnection): Record<string, string>;
  supported: SupportedVersion;
}

/** `use:database` picks the session's database on both engines. */
function useDatabase(conn: DbConnection): Record<string, string> {
  return conn.database ? { 'use:database': conn.database } : {};
}

const HIVE: Engine = {
  engine: 'hive',
  label: 'Hive',
  port: 10000,
  verification: 'live',
  system: new Set(['sys', 'information_schema']),
  // Without this Hive names a `SELECT *` column `table.column`, and a second `id` `id_1`.
  configuration: (conn) => ({ ...useDatabase(conn), 'set:hiveconf:hive.resultset.use.unique.column.names': 'false' }),
  supported: { product: 'Apache Hive', minimum: null, note: 'Tested against Hive 4.2. HiveServer2 protocol V6 (Hive 0.13) or later is required.' },
};

const IMPALA: Engine = {
  engine: 'impala',
  label: 'Impala',
  port: 21050,
  verification: 'live',
  system: new Set(['_impala_builtins']),
  // Impala reads any other key as a query option and refuses one it doesn't know.
  configuration: useDatabase,
  supported: { product: 'Apache Impala', minimum: null, note: "Tested against Impala 4.5 on its HiveServer2 port. HiveServer2 protocol V6 or later is required." },
};

/** A statement or catalog call the server refused: its status, as HiveServer2 reports it. */
class StatementFailed extends Error {
  constructor(readonly status: Pick<Hs2Status, 'sqlState' | 'errorCode' | 'errorMessage' | 'infoMessages'>) {
    super(status.errorMessage || status.infoMessages?.join(' ') || 'the server reported an error and gave no message');
  }
}

function checkStatus(status: Hs2Status | null | undefined): void {
  if (!status) return;
  if (status.statusCode === T.TStatusCode.ERROR_STATUS || status.statusCode === T.TStatusCode.INVALID_HANDLE_STATUS) throw new StatementFailed(status);
}

/** A signal that aborts after `ms`, for the calls made while closing, when the call's own signal may already have fired. */
function deadline(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** What a finished statement reported. `modified` is the server's count of rows it changed, when it gave one. */
interface Finished {
  handle: OperationHandle;
  hasResultSet: boolean;
  modified: number | undefined;
}

/** One HiveServer2 session on one connection, for one call. */
class Session {
  /** The statement or catalog call running now, which a cancel stops. */
  private operation: OperationHandle | undefined;

  constructor(
    private readonly engine: Engine,
    private readonly conn: DbConnection,
    private readonly link: Hs2Link,
    private readonly handle: object,
    private readonly call: DbCall,
  ) {}

  private request(method: Method, fields: Record<string, unknown>): object {
    const Struct = (T as unknown as Record<string, new (fields: Record<string, unknown>) => object>)[`T${method}Req`]!;
    return new Struct(fields);
  }

  /** One call, with the server's error status raised as StatementFailed. */
  async rpc<M extends Method>(method: M, fields: Record<string, unknown>, signal: AbortSignal = this.call.signal): Promise<Responses[M]> {
    const response = await this.link.call(method, this.request(method, fields), signal);
    checkStatus(response.status);
    return response;
  }

  /** Runs one statement to the end, polling until the server says it's finished. */
  async run(sql: string): Promise<Finished> {
    const started = await this.rpc('ExecuteStatement', { sessionHandle: this.handle, statement: sql, runAsync: true });
    const handle = started.operationHandle!;
    this.operation = handle;
    // Hive holds each status call for up to its long-polling timeout; Impala answers at once, so back off.
    for (let wait = 10; ; wait = Math.min(wait * 2, 500)) {
      const status = await this.rpc('GetOperationStatus', { operationHandle: handle, getProgressUpdate: false });
      const state = status.operationState;
      if (state === STATE.FINISHED_STATE) {
        const modified = status.numModifiedRows ? Number(int64ToBigInt(status.numModifiedRows)) : (handle.modifiedRowCount ?? undefined);
        return { handle, hasResultSet: status.hasResultSet ?? handle.hasResultSet, modified: modified ?? undefined };
      }
      if (state === STATE.ERROR_STATE) throw new StatementFailed(status);
      if (state !== STATE.INITIALIZED_STATE && state !== STATE.RUNNING_STATE && state !== STATE.PENDING_STATE) {
        throw new StatementFailed({ errorMessage: `the server reports the statement ${STATE_NAMES.get(state ?? -1) ?? `in state ${state}`}${status.errorMessage ? `: ${status.errorMessage}` : ''}` });
      }
      await sleep(wait, this.call.signal);
    }
  }

  /** The result columns of a finished operation, in order. */
  async columns(handle: OperationHandle): Promise<ResultColumn[]> {
    const meta = await this.rpc('GetResultSetMetadata', { operationHandle: handle });
    return [...(meta.schema?.columns ?? [])].sort((a, b) => a.position - b.position).map((c) => ({ name: c.columnName, type: typeName(c) }));
  }

  /** A window of an operation's rows: skip `offset`, keep at most `max`. Then closes the operation, so the server stops producing more. */
  async rows(handle: OperationHandle, window: RowWindow): Promise<RowSet> {
    const columns = await this.columns(handle);
    const rows: unknown[][] = [];
    let skip = window.offset;
    while (rows.length < window.max) {
      const want = skip > 0 ? Math.min(skip, FETCH_BATCH) : Math.min(window.max - rows.length, FETCH_BATCH);
      const fetched = await this.rpc('FetchResults', { operationHandle: handle, orientation: T.TFetchOrientation.FETCH_NEXT, maxRows: want });
      const count = rowCount(fetched.results);
      // Hive leaves hasMoreRows false while rows remain, so only an empty batch means the end.
      if (count === 0) break;
      if (count <= skip) {
        skip -= count;
        continue;
      }
      rows.push(...decodeRows(fetched.results).slice(skip));
      skip = 0;
    }
    await this.closeOperation(handle);
    return { columns, rows: rows.slice(0, window.max) };
  }

  /** A catalog call's whole answer, each row keyed by the column names the protocol gives it. */
  async catalog(method: 'GetSchemas' | 'GetTables' | 'GetColumns' | 'GetPrimaryKeys' | 'GetCrossReference', fields: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
    const started = (await this.rpc(method, { sessionHandle: this.handle, ...fields })) as { operationHandle?: OperationHandle | null };
    const handle = started.operationHandle!;
    this.operation = handle;
    const { columns, rows } = await this.rows(handle, { offset: 0, max: Number.MAX_SAFE_INTEGER });
    return rows.map((row) => Object.fromEntries(columns.map((c, i) => [c.name.toUpperCase(), row[i]])));
  }

  async closeOperation(handle: OperationHandle): Promise<void> {
    if (this.operation === handle) this.operation = undefined;
    await this.rpc('CloseOperation', { operationHandle: handle });
  }

  /** On abort: stop the running statement on the server, then end the session. Best effort; core has already answered. */
  async stop(): Promise<void> {
    const running = this.operation;
    this.operation = undefined;
    if (running) {
      try {
        await this.rpc('CancelOperation', { operationHandle: running }, deadline(CLOSE_TIMEOUT_MS));
        this.call.debug(`${this.engine.engine}: connection ${this.conn.name}: cancelled the statement on the server`);
      } catch (err) {
        this.call.debug(`${this.engine.engine}: connection ${this.conn.name}: couldn't cancel the statement on the server (${(err as Error).message}); it may still be running`);
      }
    }
    await this.end();
  }

  /** Closes the session, which also closes anything still open in it. */
  async end(): Promise<void> {
    try {
      await this.rpc('CloseSession', { sessionHandle: this.handle }, deadline(CLOSE_TIMEOUT_MS));
    } catch (err) {
      this.call.debug(`${this.engine.engine}: connection ${this.conn.name}: couldn't close the session (${(err as Error).message})`);
    }
  }
}

function port(engine: Engine, conn: DbConnection): number {
  return conn.port ?? engine.port;
}

/**
 * One connection, one session, one call. On abort the running statement is
 * cancelled on the server and the session closed; the work's own error is
 * dropped, because core has already answered TIMEOUT or CANCELLED.
 */
async function session<R>(engine: Engine, conn: DbConnection, mode: Mode, call: DbCall, work: (s: Session) => Promise<R>): Promise<R> {
  if (call.signal.aborted) throw call.signal.reason;
  const nosasl = conn.auth === 'nosasl';
  call.debug(
    `${engine.engine}: connection ${conn.name}, ${mode === 'read' ? 'read (no read-only mode on this engine: the account decides)' : 'read-write'}, ${nosasl ? 'no SASL' : 'SASL PLAIN'}${conn.ssl ? ', TLS' : ''}`,
  );
  const ca = conn.ssl === true ? trustedCertificates(call.debug).certificates : undefined;
  let link: Hs2Link | undefined;
  let s: Session | undefined;
  let stopping: Promise<void> | undefined;
  const onAbort = () => {
    stopping = s ? s.stop() : Promise.resolve();
  };
  call.signal.addEventListener('abort', onAbort, { once: true });
  try {
    link = await Hs2Link.open({
      host: conn.host!,
      port: port(engine, conn),
      ...(conn.ssl === true ? { tls: { ca } } : {}),
      ...(nosasl ? {} : { sasl: { user: conn.user ?? '', password: conn.password ?? '' } }),
      signal: call.signal,
      timeoutMs: CONNECT_TIMEOUT_MS,
    });
    const opened = await link.call(
      'OpenSession',
      new T.TOpenSessionReq({
        client_protocol: REQUEST_PROTOCOL,
        ...(conn.user ? { username: conn.user } : {}),
        ...(nosasl || conn.password === undefined ? {} : { password: conn.password }),
        configuration: engine.configuration(conn),
      }),
      call.signal,
    );
    checkStatus(opened.status);
    s = new Session(engine, conn, link, opened.sessionHandle, call);
    if (opened.serverProtocolVersion < MIN_PROTOCOL) {
      throw serverTooOld(engine.supported, { code: 'DATABASE', found: `HiveServer2 protocol V${opened.serverProtocolVersion + 1}` });
    }
    return await work(s);
  } catch (err) {
    if (call.signal.aborted) throw call.signal.reason;
    throw toToilError(err, engine, conn, mode);
  } finally {
    call.signal.removeEventListener('abort', onAbort);
    if (stopping) await stopping;
    else await s?.end();
    link?.close();
  }
}

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE']);

/** Privileges whose refusal means the statement would have changed something. */
const WRITE_PRIVILEGES = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|INDEX|LOCK|WRITE|ALL|OBJECT OWNERSHIP|REFRESH|UPSERT)\b/i;

/**
 * The privilege an authorization refusal names, from the three forms in use:
 * Hive's SQL standard authorization (`does not have following privileges for
 * operation QUERY [[INSERT, DELETE] on Object ...`), Ranger's (`does not have
 * [UPDATE] privilege on [db/table]`) and Impala's (`does not have privileges
 * to execute 'INSERT' on: db.table`). Undefined when the message isn't one.
 */
export function refusedPrivilege(message: string): string | undefined {
  const hive = /does not have following privileges for operation \w+ \[\[([^\]]*)\]/i.exec(message);
  if (hive) return hive[1]!;
  const ranger = /does not have \[([^\]]+)\] privilege/i.exec(message);
  if (ranger) return ranger[1]!;
  const impala = /does not have privileges (?:to execute|to access) '([^']+)'/i.exec(message);
  if (impala) return impala[1]!;
  return undefined;
}

function writeRefused(engine: Engine, conn: DbConnection): ToilError {
  return new ToilError('WRITE_DISABLED', `The statement tried to change data, and the account on connection ${conn.name} may not: ${engine.label} refused it before it ran. Nothing was changed.`, {
    fix: `To make a change, use toil db execute with --allow-write on a connection whose account may write, with writes on.`,
  });
}

/** HiveServer2's errors and Node's network errors to toil's codes. Exported for tests. */
export function toToilError(err: unknown, engine: Engine, conn: DbConnection, mode: Mode): unknown {
  if (err instanceof ToilError) return err;
  const where = `${conn.host}:${port(engine, conn)}`;
  const label = engine.label;

  if (err instanceof StatementFailed) {
    const message = err.message;
    const privilege = refusedPrivilege(message);
    if (privilege !== undefined) {
      if (mode === 'read' && WRITE_PRIVILEGES.test(privilege)) return writeRefused(engine, conn);
      return new ToilError('DATABASE', `${label}: ${message}`, {
        fix: `The account on connection ${conn.name} lacks that privilege. Ask the cluster's administrators to grant it (in Ranger or Sentry), or read something the account can see.`,
      });
    }
    // A missing database from "use:database", Hive's and Impala's wording.
    if (/Database does not exist|Database '[^']*' does not exist|database does not exist/i.test(message) && conn.database && message.includes(conn.database)) {
      return new ToilError('NOT_FOUND', `${label} at ${where} has no database "${conn.database}" for connection ${conn.name}.`, {
        fix: `Check "database" on connection ${conn.name}, or remove it to start in the default database.`,
      });
    }
    return new ToilError('DATABASE', `${label}: ${message}`, { fix: 'Check the SQL against toil db table describe for the tables it uses.' });
  }

  if (err instanceof SaslRefused) {
    if (/mechanism|GSSAPI|KERBEROS/i.test(err.message)) {
      return new ToilError('AUTH', `${label} at ${where} refused a user name and password for connection ${conn.name} (${err.message}). It expects Kerberos, which toil doesn't support.`, {
        fix: `Ask the cluster's administrators for a HiveServer2 endpoint that accepts LDAP or PLAIN sign-in (often another port, or a gateway), and point connection ${conn.name} at it.`,
      });
    }
    return new ToilError('AUTH', `${label} refused the sign-in for connection ${conn.name}: ${err.message}`, {
      fix: `Check "user" and "password" on connection ${conn.name} (toil connections login ${conn.name}, or the env var for its password).`,
    });
  }

  if (err instanceof LinkFailed) {
    const code = err.code ?? '';
    if (/CERT|SELF_SIGNED|ERR_TLS|UNABLE_TO_|ERR_SSL/.test(code)) {
      return new ToilError('NETWORK', `The TLS certificate of ${label} at ${where} wasn't trusted for connection ${conn.name} (${code}).`, {
        fix: "toil trusts Node's CAs, NODE_EXTRA_CA_CERTS and the operating system's certificate store. Add your organization's CA, or the server's certificate, to one of them, and check that \"host\" matches the certificate's name.",
      });
    }
    if (err.during === 'sign-in' || (err.during === 'call' && code === '')) {
      const how = conn.auth === 'nosasl' ? 'without SASL ("auth": "nosasl")' : 'with SASL PLAIN';
      return new ToilError('NETWORK', `${label} at ${where} ended the conversation while connection ${conn.name} was signing in ${how}: ${err.message}`, {
        fix:
          conn.auth === 'nosasl'
            ? `The server expects a sign-in: remove "auth" from connection ${conn.name} and set "user" and "password". If it expects TLS, set "ssl": true.`
            : `If the server runs without authentication (Impala's default, or Hive's NOSASL), set "auth": "nosasl" on connection ${conn.name}. If it expects TLS, set "ssl": true. A Kerberos-only server can't be reached: toil doesn't support Kerberos.`,
      });
    }
    if (code === 'ETIMEDOUT') {
      return new ToilError('NETWORK', `${label} at ${where} didn't answer within ${CONNECT_TIMEOUT_MS / 1000}s for connection ${conn.name}.`, {
        fix: `Check "host" and "port" on connection ${conn.name} (${label}'s HiveServer2 port is ${engine.port} by default), and that a firewall isn't dropping the connection.`,
      });
    }
    if (NETWORK_CODES.has(code) || err.during === 'connect') {
      return new ToilError('NETWORK', `Couldn't reach ${label} at ${where} for connection ${conn.name}${code ? ` (${code})` : ''}.`, {
        fix: `Check "host" and "port" on connection ${conn.name} (${label}'s HiveServer2 port is ${engine.port} by default), and that this machine can reach the server.`,
      });
    }
    return new ToilError('NETWORK', `The connection to ${label} at ${where} failed for connection ${conn.name}: ${err.message}`, {
      fix: 'Retry. If it persists, run with --debug and report it.',
    });
  }

  if (err instanceof ProtocolFailed) {
    return new ToilError('DATABASE', `${label} answered with a protocol error: ${err.message}`, {
      fix: `Check that connection ${conn.name} points at a HiveServer2 port (${engine.port} by default for ${label}). If it does, run with --debug and report it.`,
    });
  }
  return new ToilError('DATABASE', `${label}: ${(err as Error)?.message ?? String(err)}`, { fix: 'Check the connection settings and the SQL. If it persists, run with --debug and report it.' });
}

/** Both engines fold unquoted names to lower case, and store them so. */
function stored(name: string): string {
  return name.toLowerCase();
}

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

function notFoundSchema(conn: DbConnection, schema: string): ToilError {
  return new ToilError('NOT_FOUND', `Connection ${conn.name} has no schema "${schema}".`, { fix: 'Run toil db schema list to see the schemas it has.' });
}

function notFoundTable(conn: DbConnection, ref: TableRef): ToilError {
  return new ToilError('NOT_FOUND', `Schema "${ref.schema}" on connection ${conn.name} has no table or view "${ref.table}".`, {
    fix: `Run toil db table list --schema ${ref.schema} to see what it has.`,
  });
}

function emptyStatement(): ToilError {
  return new ToilError('INVALID_INPUT', 'The SQL holds no statement, only comments or semicolons.', { fix: 'Pass the statement to run.' });
}

/** The one statement in `sql`, or the reason there isn't exactly one. */
function oneStatement(engine: Engine, sql: string, purpose: 'query' | 'execute'): string {
  const statements = splitStatements(sql);
  if (statements.length === 0) throw emptyStatement();
  if (statements.length > 1) {
    throw purpose === 'query'
      ? new ToilError('INVALID_INPUT', `db query runs exactly one statement, and this SQL holds ${statements.length}.`, {
          fix: 'Send one statement per call. To make a change, use toil db execute.',
        })
      : new ToilError('INVALID_INPUT', `db execute runs one statement per call on ${engine.label}, and this SQL holds ${statements.length}. Nothing was run.`, {
          fix: `${engine.label} has no transactions, so several statements can't be all or nothing: if a later one failed, the earlier ones would stay applied. Send each statement in its own toil db execute call, in order.`,
        });
  }
  return statements[0]!.text;
}

async function schemaExists(s: Session, schema: string): Promise<boolean> {
  const rows = await s.catalog('GetSchemas', { schemaName: schema });
  return rows.some((r) => String(r.TABLE_SCHEM).toLowerCase() === schema);
}

/** The table or view as the catalog names it, or undefined. */
async function findTable(s: Session, ref: TableRef): Promise<{ schema: string; name: string; type: 'table' | 'view' } | undefined> {
  const rows = await s.catalog('GetTables', { schemaName: ref.schema, tableName: ref.table });
  const row = rows.find((r) => String(r.TABLE_SCHEM).toLowerCase() === ref.schema && String(r.TABLE_NAME).toLowerCase() === ref.table);
  return row ? { schema: String(row.TABLE_SCHEM), name: String(row.TABLE_NAME), type: tableType(row.TABLE_TYPE) } : undefined;
}

function tableType(value: unknown): 'table' | 'view' {
  return /VIEW/i.test(String(value)) ? 'view' : 'table';
}

async function requireTable(s: Session, conn: DbConnection, ref: TableRef) {
  const folded = { schema: stored(ref.schema), table: stored(ref.table) };
  if (!(await schemaExists(s, folded.schema))) throw notFoundSchema(conn, ref.schema);
  const table = await findTable(s, folded);
  if (!table) throw notFoundTable(conn, ref);
  return table;
}

/** A column's declared type from GetColumns: `VARCHAR(100)`, `DECIMAL(10,2)`, `array<int>` as the server spells it. */
function declaredType(row: Record<string, unknown>): string | null {
  const name = row.TYPE_NAME === null || row.TYPE_NAME === undefined ? null : String(row.TYPE_NAME);
  if (name === null) return null;
  const size = row.COLUMN_SIZE;
  if (/^(VAR)?CHAR$/i.test(name) && typeof size === 'number') return `${name}(${size})`;
  if (/^DECIMAL$/i.test(name) && typeof size === 'number') return `${name}(${size},${typeof row.DECIMAL_DIGITS === 'number' ? row.DECIMAL_DIGITS : 0})`;
  return name;
}

/** Catalog calls an engine may not have: Impala answers GetPrimaryKeys and GetCrossReference only from 4.0. */
async function optionalCatalog(s: Session, call: DbCall, engine: Engine, method: 'GetPrimaryKeys' | 'GetCrossReference', fields: Record<string, unknown>) {
  try {
    return await s.catalog(method, fields);
  } catch (err) {
    if (!(err instanceof StatementFailed)) throw err;
    call.debug(`${engine.engine}: ${method} failed (${err.message}); reporting none`);
    return [];
  }
}

function provider(engine: Engine): DbProvider {
  return {
    engine: engine.engine,
    label: engine.label,
    requires: ['host'],
    defaultSchema: (conn) => (conn.database ? stored(conn.database) : 'default'),
    verification: engine.verification,

    check(settings) {
      if (settings.auth !== undefined && settings.auth !== 'nosasl') {
        return [{ key: 'auth', message: `${engine.label} connections take "auth": "nosasl" (a server with no authentication) or no auth at all (SASL PLAIN, with user and password); "${settings.auth}" is for SQL Server.` }];
      }
      if (settings.auth === 'nosasl') return settings.password !== undefined ? [{ key: 'password', message: `"auth": "nosasl" sends no password, so this connection's password would never be used. Remove it, or remove "auth" to sign in with it.` }] : [];
      return settings.user ? [] : [{ key: 'user', message: `${engine.label} connections need user, a read-only account the server signs in with LDAP or PLAIN (or "auth": "nosasl" for a server with no authentication).` }];
    },

    listSchemas(conn, call) {
      return session(engine, conn, 'read', call, async (s) => {
        const rows = await s.catalog('GetSchemas', {});
        const names = rows.map((r) => String(r.TABLE_SCHEM)).filter((name) => !engine.system.has(name.toLowerCase()));
        return [...new Set(names)].sort().map((name) => ({ name }));
      });
    },

    listTables(conn, schema, call) {
      return session(engine, conn, 'read', call, async (s) => {
        const folded = stored(schema);
        if (!(await schemaExists(s, folded))) throw notFoundSchema(conn, schema);
        const rows = await s.catalog('GetTables', { schemaName: folded, tableName: '%' });
        return rows
          .filter((r) => String(r.TABLE_SCHEM).toLowerCase() === folded)
          .map((r) => ({ name: String(r.TABLE_NAME), type: tableType(r.TABLE_TYPE) }))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      });
    },

    describeTable(conn, ref, call) {
      return session(engine, conn, 'read', call, async (s) => {
        const table = await requireTable(s, conn, ref);
        const where = { schemaName: table.schema, tableName: table.name };
        const columnRows = (await s.catalog('GetColumns', where))
          .filter((r) => String(r.TABLE_SCHEM) === table.schema && String(r.TABLE_NAME) === table.name)
          .sort((a, b) => Number(a.ORDINAL_POSITION) - Number(b.ORDINAL_POSITION));
        const keyRows = await optionalCatalog(s, call, engine, 'GetPrimaryKeys', where);
        const keyOf = new Map(keyRows.filter((r) => String(r.TABLE_NAME) === table.name).map((r) => [String(r.COLUMN_NAME), Number(r.KEY_SEQ)]));
        const columns: ColumnInfo[] = columnRows.map((r) => {
          const name = String(r.COLUMN_NAME);
          return {
            name,
            type: declaredType(r),
            nullable: Number(r.NULLABLE) !== 0,
            default: r.COLUMN_DEF === null || r.COLUMN_DEF === undefined ? null : String(r.COLUMN_DEF),
            primaryKey: keyOf.get(name) ?? null,
          };
        });
        const primaryKey = [...keyOf].sort((a, b) => a[1] - b[1]).map(([name]) => name);
        const fkRows = (await optionalCatalog(s, call, engine, 'GetCrossReference', { foreignSchemaName: table.schema, foreignTableName: table.name }))
          .filter((r) => String(r.FKTABLE_NAME) === table.name)
          // Hive spells the sequence column KEQ_SEQ; JDBC and Impala, KEY_SEQ.
          .sort((a, b) => String(a.FK_NAME).localeCompare(String(b.FK_NAME)) || Number(a.KEQ_SEQ ?? a.KEY_SEQ) - Number(b.KEQ_SEQ ?? b.KEY_SEQ));
        const foreignKeys: ForeignKeyInfo[] = [];
        const byName = new Map<string, ForeignKeyInfo>();
        for (const r of fkRows) {
          const name = String(r.FK_NAME);
          let fk = byName.get(name);
          if (!fk) {
            // Neither engine enforces a foreign key, so there is no action to report.
            fk = { columns: [], references: { schema: String(r.PKTABLE_SCHEM), table: String(r.PKTABLE_NAME), columns: [] }, onUpdate: null, onDelete: null };
            byName.set(name, fk);
            foreignKeys.push(fk);
          }
          fk.columns.push(String(r.FKCOLUMN_NAME));
          fk.references.columns.push(String(r.PKCOLUMN_NAME));
        }
        // Neither engine has indexes: Hive dropped them in 3.0, and Impala never had them.
        return { schema: table.schema, name: table.name, type: table.type, columns, primaryKey, indexes: [], foreignKeys };
      });
    },

    previewTable(conn, ref, window, call) {
      return session(engine, conn, 'read', call, async (s) => {
        const table = await requireTable(s, conn, ref);
        // LIMIT lets both engines read only what the page needs; Hive answers it without starting a job.
        const finished = await s.run(`SELECT * FROM ${quoteIdent(table.schema)}.${quoteIdent(table.name)} LIMIT ${window.offset + window.max}`);
        return s.rows(finished.handle, window);
      });
    },

    query(conn, sql, window, call) {
      let statement: string;
      try {
        statement = oneStatement(engine, sql, 'query');
      } catch (err) {
        return Promise.reject(err);
      }
      return session(engine, conn, 'read', call, async (s) => {
        const finished = await s.run(statement);
        if (finished.modified !== undefined && finished.modified > 0) {
          await s.closeOperation(finished.handle);
          throw new ToilError(
            'DATABASE',
            `${engine.label} reports the statement changed ${finished.modified} row${finished.modified === 1 ? '' : 's'} on connection ${conn.name}. ${engine.label} has no read-only mode, so db query couldn't stop it: the change has been made.`,
            { fix: `Check the data it touched. Connect with a read-only account (a Ranger or Sentry role with SELECT only), so the server refuses writes from db query, and use toil db execute for changes.` },
          );
        }
        if (!finished.hasResultSet) {
          await s.closeOperation(finished.handle);
          return { columns: [], rows: [] };
        }
        return s.rows(finished.handle, window);
      });
    },

    async execute(conn, sql, call) {
      const statement = oneStatement(engine, sql, 'execute');
      return session(engine, conn, 'write', call, async (s) => {
        const finished = await s.run(statement);
        await s.closeOperation(finished.handle);
        return { changes: finished.modified ?? 0 };
      });
    },
  };
}

export const hiveProvider = provider(HIVE);
export const impalaProvider = provider(IMPALA);
