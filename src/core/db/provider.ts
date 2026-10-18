import type { Connection } from '../area.js';

/**
 * The contract every database engine implements: SQLite and PostgreSQL now,
 * MySQL, SQL Server and Oracle later. The `db` area's commands call only this, so an
 * engine is added by writing one provider and registering it in `engines.ts`,
 * never by touching a command.
 *
 * Every method gets the one connection the call resolved and a signal, and
 * returns plain data: no driver objects, no live handles, no connection
 * strings. Paging, row caps and cursors live above this line, in the commands,
 * so a provider only answers "these rows, from here, at most this many".
 * Responsibilities have been allocated. A RACI matrix was considered and
 * found to have one row.
 */
export interface DbProvider {
  /** The `engine` value that selects this provider on a connection. */
  readonly engine: string;
  /** Display name for docs and errors. */
  readonly label: string;
  /** Connection keys this engine needs, besides `engine`. Checked when the connection resolves. */
  readonly requires: ReadonlyArray<keyof DbSettings>;
  /** The schema commands use when the caller names none (`main`, `public`, `dbo`). */
  readonly defaultSchema: string;
  /** How far this provider has been verified (the `integrations` skill's levels). */
  readonly verification: 'unit' | 'integration' | 'live';

  listSchemas(conn: DbConnection, call: DbCall): Promise<SchemaInfo[]>;
  /** Tables and views in one schema. NOT_FOUND when the schema doesn't exist. */
  listTables(conn: DbConnection, schema: string, call: DbCall): Promise<TableInfo[]>;
  /** NOT_FOUND when the schema or table doesn't exist. */
  describeTable(conn: DbConnection, ref: TableRef, call: DbCall): Promise<TableDescription>;
  /** Rows of a table or view in the engine's natural order. Read-only. */
  previewTable(conn: DbConnection, ref: TableRef, window: RowWindow, call: DbCall): Promise<RowSet>;
  /**
   * One statement, run so the engine itself refuses any write: a read-only
   * connection, session or transaction, rolled back. Never decided by parsing
   * the SQL. A refused write is a WRITE_DISABLED ToilError.
   */
  query(conn: DbConnection, sql: string, window: RowWindow, call: DbCall): Promise<RowSet>;
  /**
   * One or more statements with writes allowed, in one transaction that commits
   * only if every statement succeeds. Core's write gate has already passed.
   */
  execute(conn: DbConnection, sql: string, call: DbCall): Promise<ExecuteResult>;
}

/**
 * Every key any engine's connection can hold. The area's connection schema
 * is the zod form of this; each provider says which keys it needs. Server
 * engines add host, port, database, user and a secret here.
 */
export interface DbSettings {
  engine: string;
  /** SQLite: absolute path to the database file. */
  path?: string;
  /** Server engines: host name or address. */
  host?: string;
  /** Server engines: TCP port; each engine has its own default. */
  port?: number;
  /** Server engines: the database to connect to. */
  database?: string;
  /** Server engines: the login. */
  user?: string;
  /** Server engines: the login's password. A secret: from env or the OS credential store, never a file. */
  password?: string;
  /** Server engines: connect over TLS, verifying the server's certificate. */
  ssl?: boolean;
}

export type DbConnection = Connection<DbSettings>;

/** What a provider gets besides the connection: the call's signal, and debug output that never carries a credential. */
export interface DbCall {
  signal: AbortSignal;
  debug: (message: string) => void;
}

export interface TableRef {
  schema: string;
  table: string;
}

/** Skip `offset` rows, then return at most `max`. Commands ask for one more than they show, to learn whether there's a next page. */
export interface RowWindow {
  offset: number;
  max: number;
}

export interface SchemaInfo {
  name: string;
}

export interface TableInfo {
  name: string;
  type: 'table' | 'view';
}

export interface ColumnInfo {
  name: string;
  /** The declared type, as the engine reports it; null when it has none. */
  type: string | null;
  nullable: boolean;
  /** The default expression as SQL text, or null. */
  default: string | null;
  /** 1-based position in the primary key, or null. */
  primaryKey: number | null;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface ForeignKeyInfo {
  columns: string[];
  references: { schema: string; table: string; columns: string[] };
  onUpdate: string | null;
  onDelete: string | null;
}

export interface TableDescription {
  schema: string;
  name: string;
  type: 'table' | 'view';
  columns: ColumnInfo[];
  primaryKey: string[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

/** A result column: its name, and its declared type where the engine knows one. */
export interface ResultColumn {
  name: string;
  type: string | null;
}

/**
 * Rows as arrays in column order, so two columns with the same name (a join's
 * two `id`s) both survive. Values are JSON-safe: see `toJsonValue`.
 */
export interface RowSet {
  columns: ResultColumn[];
  rows: unknown[][];
}

export interface ExecuteResult {
  /** Rows inserted, updated or deleted across every statement. */
  changes: number;
}
