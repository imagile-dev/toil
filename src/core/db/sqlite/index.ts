import { existsSync } from 'node:fs';
import { ToilError } from '../../errors.js';
import type { ColumnInfo, DbCall, DbConnection, DbProvider, ForeignKeyInfo, IndexInfo, RowSet, TableDescription, TableRef } from '../provider.js';
import { runSqliteJob, SqliteWorkerError, type SqliteJob, type SqliteStep, type SqliteStepResult } from './worker.js';

/**
 * SQLite through `node:sqlite`, which ships inside Node: no driver package,
 * no native addon, nothing for a security review to approve beyond Node
 * itself. Reads open the file read-only with `PRAGMA query_only` on, so the
 * engine refuses writes however the SQL is phrased; nothing here inspects SQL
 * to decide whether it writes.
 *
 * Introspection uses SQLite's table-valued pragmas (`pragma_table_list`,
 * `pragma_table_xinfo`, ...) so every name the caller typed is a bound
 * parameter, never spliced into SQL. The one exception is preview's FROM
 * clause, which can't be a parameter; it is quoted, and only runs after the
 * same job has confirmed the schema and table exist. Free text in a FROM
 * clause is the database equivalent of a form field labelled "Other".
 */

/** How long a statement waits on another process's write lock before failing. */
const BUSY_TIMEOUT_MS = 5000;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const SCHEMA_STEP = (schema: string): SqliteStep => ({
  sql: "SELECT name FROM pragma_database_list WHERE name = ? COLLATE NOCASE AND name <> 'temp'",
  params: [schema],
  mode: 'rows',
  stopIfEmpty: true,
});

const TABLE_STEP = (ref: TableRef): SqliteStep => ({
  sql: "SELECT name, type FROM pragma_table_list WHERE schema = ? COLLATE NOCASE AND name = ? COLLATE NOCASE AND type IN ('table', 'view', 'virtual')",
  params: [ref.schema, ref.table],
  mode: 'rows',
  stopIfEmpty: true,
});

/** The first Node with every node:sqlite API used here (statement columns, array rows, isTransaction, busy timeout). */
const MIN_NODE: [number, number] = [22, 16];

export function assertNodeSupportsSqlite(version = process.versions.node): void {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])) return;
  throw new ToilError('NOT_CONFIGURED', `SQLite needs Node ${MIN_NODE.join('.')} or later, and this is Node ${version}.`, {
    fix: `Upgrade Node to ${MIN_NODE.join('.')} or later (toil's package.json "engines" says the same).`,
  });
}

/**
 * VACUUM, after any leading comments. `VACUUM INTO '<file>'` creates its
 * target file before SQLite notices the connection is read-only, so a
 * refused read could still leave a file behind wherever the process can
 * write, and Node 22.16 has no authorizer to stop it at the engine.
 *
 * This is a narrow deny for the one statement that gets around the engine's
 * own read-only mode. It is not toil deciding whether SQL writes by parsing
 * it: every other statement still runs read-only and is refused, or not, by
 * SQLite itself. An exception to the policy, filed in triplicate, with the
 * policy unchanged.
 */
const VACUUM = /^(?:\s|;|--[^\n]*(?:\n|$)|\/\*(?:[^*]|\*(?!\/))*\*\/)*VACUUM\b/i;

/** Refuses VACUUM on a read-only job before it reaches SQLite. Exported for tests. */
export function assertNoVacuumOnRead(sql: string): void {
  if (!VACUUM.test(sql)) return;
  throw new ToilError('INVALID_INPUT', 'VACUUM is refused on reads: it can create files even on a read-only connection.', {
    fix: 'Run it with toil db execute --allow-write, on a connection with writes on.',
  });
}

async function run(conn: DbConnection, job: Omit<SqliteJob, 'path' | 'busyTimeoutMs'>, call: DbCall): Promise<SqliteStepResult[]> {
  assertNodeSupportsSqlite();
  if (!job.write) for (const step of job.steps) assertNoVacuumOnRead(step.sql);
  const path = conn.path!;
  // Opening a missing file read-write would create an empty database and
  // report success. Refuse instead, for reads and writes alike.
  if (!existsSync(path)) {
    throw new ToilError('NOT_FOUND', `The SQLite file for connection ${conn.name} doesn't exist.`, {
      fix: `Check "path" on connection ${conn.name}: it must be the absolute path to an existing SQLite database file.`,
    });
  }
  call.debug(`sqlite: connection ${conn.name}, ${job.write ? 'read-write' : 'read-only'}, ${job.steps.length} statement(s)`);
  try {
    return await runSqliteJob({ ...job, path, busyTimeoutMs: BUSY_TIMEOUT_MS }, call);
  } catch (err) {
    throw err instanceof SqliteWorkerError ? toToilError(err, conn, job.write) : err;
  }
}

/** SQLite's own result codes to toil's. The primary code is the low byte of an extended one. */
function toToilError(err: SqliteWorkerError, conn: DbConnection, write: boolean): ToilError {
  const f = err.failure;
  if (f.kind === 'multiple') {
    return new ToilError('INVALID_INPUT', 'db query runs exactly one statement, and this SQL holds more than one.', {
      fix: 'Send one statement per call. To run a script of writes, use toil db execute.',
    });
  }
  if (f.kind === 'transaction') {
    return new ToilError('INVALID_INPUT', 'db execute runs the whole script in one transaction, and this SQL starts or ends one of its own (BEGIN, COMMIT, END, ROLLBACK, SAVEPOINT or RELEASE). Nothing was changed.', {
      fix: 'Remove the transaction statements and send the rest; toil commits only if every statement succeeds.',
    });
  }
  if (f.kind === 'empty') return new ToilError('INVALID_INPUT', 'The SQL holds no statement, only comments or semicolons.', { fix: 'Pass the statement to run.' });
  const primary = (f.errcode ?? -1) & 0xff;
  if (primary === 8 && !write) {
    return new ToilError('WRITE_DISABLED', `The statement tried to change data, and reads on connection ${conn.name} are read-only.`, {
      fix: `To make a change, use toil db execute with --allow-write; writes must also be on for connection ${conn.name}.`,
    });
  }
  if (primary === 14) {
    return new ToilError('NOT_FOUND', `SQLite couldn't open the database file for connection ${conn.name}.`, {
      fix: `Check that "path" on connection ${conn.name} is readable${write ? ' and writable, along with its folder' : ''}.`,
    });
  }
  if (primary === 26) {
    return new ToilError('CONFIG_INVALID', `The file for connection ${conn.name} isn't a SQLite database.`, { fix: `Point "path" on connection ${conn.name} at a SQLite database file.` });
  }
  if (primary === 5 || primary === 6) {
    return new ToilError('DATABASE', `SQLite: ${f.message}`, { fix: 'Another process holds a lock on the database. Retry once it has finished.' });
  }
  if (f.errcode === undefined) {
    return new ToilError('DATABASE', `SQLite: ${f.message}`, { fix: 'Check the SQL and the database file. If it persists, run with --debug and report it.' });
  }
  return new ToilError('DATABASE', `SQLite: ${f.message}`, { fix: 'Check the SQL against toil db describe-table for the tables it uses.' });
}

function rowsOf(result: SqliteStepResult | undefined): unknown[][] {
  return result?.mode === 'rows' ? result.rows : [];
}

function notFoundSchema(conn: DbConnection, schema: string): ToilError {
  return new ToilError('NOT_FOUND', `Connection ${conn.name} has no schema "${schema}".`, { fix: 'Run toil db list-schemas to see the schemas it has.' });
}

function notFoundTable(conn: DbConnection, ref: TableRef): ToilError {
  return new ToilError('NOT_FOUND', `Schema "${ref.schema}" on connection ${conn.name} has no table or view "${ref.table}".`, {
    fix: `Run toil db list-tables --schema ${ref.schema} to see what it has.`,
  });
}

export const sqliteProvider: DbProvider = {
  engine: 'sqlite',
  label: 'SQLite',
  requires: ['path'],
  defaultSchema: () => 'main',
  verification: 'integration',

  async listSchemas(conn, call) {
    const [result] = await run(conn, { write: false, steps: [{ sql: "SELECT name FROM pragma_database_list WHERE name <> 'temp' ORDER BY seq", mode: 'rows' }] }, call);
    return rowsOf(result).map(([name]) => ({ name: String(name) }));
  },

  async listTables(conn, schema, call) {
    const results = await run(
      conn,
      {
        write: false,
        steps: [
          SCHEMA_STEP(schema),
          {
            sql: "SELECT name, type FROM pragma_table_list WHERE schema = ? COLLATE NOCASE AND type IN ('table', 'view', 'virtual') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
            params: [schema],
            mode: 'rows',
          },
        ],
      },
      call,
    );
    if (rowsOf(results[0]).length === 0) throw notFoundSchema(conn, schema);
    return rowsOf(results[1]).map(([name, type]) => ({ name: String(name), type: type === 'view' ? ('view' as const) : ('table' as const) }));
  },

  async describeTable(conn, ref, call) {
    const results = await run(
      conn,
      {
        write: false,
        steps: [
          SCHEMA_STEP(ref.schema),
          TABLE_STEP(ref),
          { sql: 'SELECT name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?, ?) ORDER BY cid', params: [ref.table, ref.schema], mode: 'rows' },
          {
            sql: 'SELECT il.name, il."unique", ii.name FROM pragma_index_list(?, ?) AS il JOIN pragma_index_info(il.name, ?) AS ii ORDER BY il.name, ii.seqno',
            params: [ref.table, ref.schema, ref.schema],
            mode: 'rows',
          },
          { sql: 'SELECT id, "table", "from", "to", on_update, on_delete FROM pragma_foreign_key_list(?, ?) ORDER BY id, seq', params: [ref.table, ref.schema], mode: 'rows' },
        ],
      },
      call,
    );
    const [schemaRow] = rowsOf(results[0]);
    if (!schemaRow) throw notFoundSchema(conn, ref.schema);
    const [tableRow] = rowsOf(results[1]);
    if (!tableRow) throw notFoundTable(conn, ref);
    const schema = String(schemaRow[0]);

    // hidden: 0 normal, 1 hidden column of a virtual table, 2 and 3 generated columns (kept).
    const columnRows = rowsOf(results[2]).filter((r) => Number(r[5]) !== 1);
    const pkCount = columnRows.filter((r) => Number(r[4]) > 0).length;
    // SQLite lets a primary key column hold NULL unless it says NOT NULL, a
    // long-standing quirk kept for compatibility. The exception is a lone
    // INTEGER PRIMARY KEY, which is the rowid and can't.
    const columns: ColumnInfo[] = columnRows
      .map(([name, type, notnull, dflt, pk]) => ({
        name: String(name),
        type: type ? String(type) : null,
        nullable: Number(notnull) === 0 && !(Number(pk) > 0 && pkCount === 1 && String(type).toUpperCase() === 'INTEGER'),
        default: dflt === null || dflt === undefined ? null : String(dflt),
        primaryKey: Number(pk) > 0 ? Number(pk) : null,
      }));
    const primaryKey = columns
      .filter((c) => c.primaryKey !== null)
      .sort((a, b) => a.primaryKey! - b.primaryKey!)
      .map((c) => c.name);

    const indexes = new Map<string, IndexInfo>();
    for (const [name, unique, column] of rowsOf(results[3])) {
      const key = String(name);
      const index = indexes.get(key) ?? { name: key, columns: [], unique: Number(unique) === 1 };
      // An expression index has no column name for that position.
      index.columns.push(column === null ? '<expression>' : String(column));
      indexes.set(key, index);
    }

    const fks = new Map<number, ForeignKeyInfo>();
    for (const [id, table, from, to, onUpdate, onDelete] of rowsOf(results[4])) {
      const key = Number(id);
      const fk = fks.get(key) ?? { columns: [], references: { schema, table: String(table), columns: [] }, onUpdate: action(onUpdate), onDelete: action(onDelete) };
      fk.columns.push(String(from));
      // `to` is null when the reference names only the table, meaning its primary key.
      if (to !== null) fk.references.columns.push(String(to));
      fks.set(key, fk);
    }

    const description: TableDescription = {
      schema,
      name: String(tableRow[0]),
      type: tableRow[1] === 'view' ? 'view' : 'table',
      columns,
      primaryKey,
      indexes: [...indexes.values()],
      foreignKeys: [...fks.values()],
    };
    return description;
  },

  async previewTable(conn, ref, window, call) {
    const results = await run(
      conn,
      {
        write: false,
        steps: [
          SCHEMA_STEP(ref.schema),
          TABLE_STEP(ref),
          { sql: `SELECT * FROM ${quoteIdent(ref.schema)}.${quoteIdent(ref.table)} LIMIT ? OFFSET ?`, params: [window.max, window.offset], mode: 'rows' },
        ],
      },
      call,
    );
    if (rowsOf(results[0]).length === 0) throw notFoundSchema(conn, ref.schema);
    if (rowsOf(results[1]).length === 0) throw notFoundTable(conn, ref);
    return rowSet(results[2]);
  },

  async query(conn, sql, window, call) {
    const [result] = await run(conn, { write: false, steps: [{ sql, mode: 'rows', window, single: true }] }, call);
    return rowSet(result);
  },

  async execute(conn, sql, call) {
    const [result] = await run(conn, { write: true, steps: [{ sql, mode: 'exec' }] }, call);
    return { changes: result?.mode === 'exec' ? result.changes : 0 };
  },
};

function rowSet(result: SqliteStepResult | undefined): RowSet {
  return result?.mode === 'rows' ? { columns: result.columns, rows: result.rows } : { columns: [], rows: [] };
}

/** SQLite reports "NO ACTION" for an unstated action; that's the default, so it reads as null. */
function action(value: unknown): string | null {
  const text = value === null || value === undefined ? '' : String(value);
  return text === '' || text === 'NO ACTION' ? null : text;
}
