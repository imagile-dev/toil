---
area: db
description: Schemas, tables, describe, row previews, read-only queries with paging, and gated writes on databases (SQLite)
---

# toil db

One set of commands for every database engine. Each connection says which engine it
uses, and the commands work the same way on all of them.

| Engine | `engine` value | Status |
|--------|----------------|--------|
| SQLite | `sqlite` | `integration`: automated tests run against the real engine (Node's built-in `node:sqlite`) |
| PostgreSQL, MySQL/MariaDB, SQL Server, Oracle | | Planned |

**Supported versions:** The oldest SQLite version toil supports hasn't been established. toil
uses the SQLite built into Node, so the version is whichever your Node ships.

## SQLite connections

There is nothing to install: toil uses the SQLite built into Node.

| Key | Required | Meaning |
|-----|----------|---------|
| `engine` | yes | `sqlite` |
| `path` | yes | Absolute path to an existing database file. toil never creates one. |
| `writes` | no | `true` lets `db execute` change data on this connection. Off by default. |

**Environment variables**, for the default `db` connection:

```bash
export TOIL_DB_ENGINE=sqlite
export TOIL_DB_PATH=/srv/data/app.db
# Only if this connection may be written to:
export TOIL_DB_WRITES=true
```

A named connection, defined entirely from the environment (handy in CI):

```bash
export TOIL_CONN_SCRATCH_AREA=db
export TOIL_CONN_SCRATCH_ENGINE=sqlite
export TOIL_CONN_SCRATCH_PATH=/tmp/scratch.db
export TOIL_CONN_SCRATCH_WRITES=true
```

**Config file** (`~/.toil/config.json`), with a read-only connection as the default
and a writable scratch copy beside it:

```json
{
  "version": 2,
  "connections": {
    "app": { "area": "db", "engine": "sqlite", "path": "/srv/data/app.db" },
    "scratch": { "area": "db", "engine": "sqlite", "path": "/tmp/scratch.db", "writes": true }
  },
  "defaults": { "db": { "connection": "app" } }
}
```

On Windows, write the path with forward slashes or escaped backslashes in JSON:
`"C:/data/app.db"`.

## Commands

| Command | MCP tool | Returns |
|---------|----------|---------|
| `toil db list-schemas` | `db_list_schemas` | `{ schemas: [{ name }] }`. For SQLite, the attached databases (`main`). |
| `toil db list-tables [--schema <name>]` | `db_list_tables` | `{ schema, tables: [{ name, type }] }`, `type` being `table` or `view` |
| `toil db describe-table <table> [--schema <name>]` | `db_describe_table` | `{ schema, name, type, columns, primaryKey, indexes, foreignKeys }` |
| `toil db preview-table <table> [--schema] [--limit] [--cursor]` | `db_preview_table` | A page of rows: `{ columns, rows }` |
| `toil db query <sql> [--limit] [--cursor]` | `db_query` | A page of rows from one read-only statement: `{ columns, rows }` |
| `toil db execute <sql> --allow-write` | `db_execute` | `{ changes }`: rows inserted, updated or deleted |

Every command takes `--connection <name>`. `--schema` defaults to the engine's
default schema (`main` for SQLite).

Rows come back as arrays in the order of `columns`, so a join's two `id` columns both
survive:

```json
{ "columns": [{ "name": "id", "type": "INTEGER" }, { "name": "name", "type": "TEXT" }],
  "rows": [[1, "Ada"], [2, "Grace"]] }
```

`type` is the column's declared type, or null for an expression. Integers too large
for JavaScript come back as strings, and binary values as base64.

### Paging and row caps

`preview-table` and `query` return 100 rows per page unless you pass `--limit`
(1 to 1000). When there are more, `meta.page.nextCursor` holds a cursor; pass it
back with `--cursor`, along with the same SQL or table, to get the next page. A
cursor only works with the query it came from. Use `ORDER BY` in a query you page
through, so the pages are stable.

### Reads are read-only at the engine

`db query`, `preview-table` and the listing commands open SQLite read-only with
`PRAGMA query_only` on. A statement that tries to write fails with `WRITE_DISABLED`,
whatever the connection's `writes` setting. `db query` runs exactly one statement;
SQL holding several is refused with `INVALID_INPUT`.

`VACUUM` is refused on every read with `INVALID_INPUT`, before it reaches SQLite.
`VACUUM INTO '<file>'` creates its target file even on a read-only connection, so
reads never get the chance. To vacuum or to write a copy, use `db execute` with
writes on; it runs a lone `VACUUM` outside the usual transaction, because SQLite
can't vacuum inside one, and refuses `VACUUM` mixed with other statements.

One known gap remains: `ATTACH DATABASE` from a read-only query can open another
existing SQLite file for reading (it can't create one). If the files a connection
can reach matter, run toil as a user that can read only what it should.

### Writes

`db execute` is the only command that changes data. It needs both:

1. `writes: true` on the connection (`TOIL_DB_WRITES=true`, or
   `TOIL_CONN_<NAME>_WRITES=true`), set by the person who owns the config, and
2. `--allow-write` on the call (`allowWrite: true` over MCP).

Without either it fails with `WRITE_DISABLED` and changes nothing. It runs one or more
statements, separated by semicolons, in one transaction that commits only if every
statement succeeds. A script that starts or ends a transaction of its own (`BEGIN`,
`COMMIT`, `END`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`) is refused with `INVALID_INPUT`
before any of it runs.

### Time limits and cancelling

Every command stops at `TOIL_TIMEOUT_MS` (default 120000) with `TIMEOUT`, and on
Ctrl+C or an MCP cancel with `CANCELLED`. The answer comes back straight away.
SQLite can only be stopped between rows, though: a statement that computes for a long
time before producing its first row keeps running in the background until it
finishes, and the CLI process exits only then. Prefer `LIMIT` and indexed filters on
large tables.

## Examples

```bash
toil db list-tables
toil db describe-table people
toil db preview-table people --limit 20
toil db query "SELECT id, name FROM people WHERE active = 1 ORDER BY id" --limit 50
toil db query "SELECT id, name FROM people WHERE active = 1 ORDER BY id" --limit 50 --cursor <meta.page.nextCursor>
toil db execute "UPDATE people SET active = 0 WHERE id = 7" --allow-write --connection scratch
```

Over MCP:

```json
{ "name": "db_query", "arguments": { "sql": "SELECT id, name FROM people ORDER BY id", "limit": 50 } }
```

## Errors

| Code | Means |
|------|-------|
| `NOT_CONFIGURED` | No db connection set up |
| `CONFIG_INVALID` | A connection is missing `engine` or `path`, `path` is relative, or the file isn't a SQLite database |
| `NOT_FOUND` | The file, schema or table doesn't exist |
| `WRITE_DISABLED` | A write was refused: by `db query`, or by the write gate on `db execute` |
| `INVALID_INPUT` | Bad flags, a cursor from another query, or several statements in `db query` |
| `DATABASE` | SQLite refused or failed the statement: bad SQL, a constraint, a lock |
| `TIMEOUT`, `CANCELLED` | Stopped waiting; for `db execute`, check whether the change was made before retrying |
