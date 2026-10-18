---
area: db
description: Schemas, tables, describe, row previews, read-only queries with paging, and gated writes on databases (SQLite, PostgreSQL, Oracle)
---

# toil db

One set of commands for every database engine. Each connection says which engine it
uses, and the commands work the same way on all of them.

| Engine | `engine` value | Status |
|--------|----------------|--------|
| SQLite | `sqlite` | `integration`: automated tests run against the real engine (Node's built-in `node:sqlite`) |
| PostgreSQL | `postgres` | `integration`: automated tests run against PostgreSQL 17 (the official `postgres:17` image) |
| Oracle | `oracle` | `integration`: automated tests run against Oracle Database 23ai Free (the `gvenzl/oracle-free:23.26.3-slim-faststart` image) |
| MySQL/MariaDB, SQL Server | | Planned |

**Supported versions:** The oldest SQLite version toil supports hasn't been established. toil
uses the SQLite built into Node, so the version is whichever your Node ships.
PostgreSQL is tested against 17; the catalog columns toil reads need 11 or later.
Oracle is tested against 23ai; Thin mode and the dictionary columns toil reads need
12.1 or later. No release older than 23ai has been run.

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

## PostgreSQL connections

toil speaks PostgreSQL's wire protocol in plain JavaScript (the `pg` driver, bundled
into toil): no libpq, no `psql`, nothing to install.

| Key | Required | Meaning |
|-----|----------|---------|
| `engine` | yes | `postgres` |
| `host` | yes | Server host name or address |
| `port` | no | TCP port. Default `5432`. |
| `database` | yes | The database to connect to |
| `user` | yes | The login role |
| `password` | no | The role's password. A secret: an env var or the OS credential store, never the config file. |
| `ssl` | no | `true` connects over TLS and verifies the server's certificate against the OS certificate store. Off by default. |
| `writes` | no | `true` lets `db execute` change data on this connection. Off by default. |

**Environment variables**, for the default `db` connection:

```bash
export TOIL_DB_ENGINE=postgres
export TOIL_DB_HOST=db.imagile.dev
export TOIL_DB_PORT=5432
export TOIL_DB_DATABASE=app
export TOIL_DB_USER=reader
export TOIL_DB_PASSWORD=<the role's password>
export TOIL_DB_SSL=true
```

Or keep the connection in config and the password in the OS credential store:

```json
{
  "version": 2,
  "connections": {
    "app-pg": { "area": "db", "engine": "postgres", "host": "db.imagile.dev", "database": "app", "user": "reader", "ssl": true }
  },
  "defaults": { "db": { "connection": "app-pg" } }
}
```

```bash
toil connections login app-pg   # prompts for the password and stores it
```

A named connection's password can also come from `TOIL_CONN_APP_PG_PASSWORD`.

toil ignores the libpq environment (`PGHOST`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE`,
`PGOPTIONS` and the rest) and `~/.pgpass`: a connection reaches only the host its own
settings name, with only its own password.

**Connect with an ordinary role** that can read what the agent should see, ideally
one with only `SELECT` grants. See the known limit under "Reads are read-only at the
engine".

## Oracle connections

toil speaks Oracle Net in plain JavaScript (the `oracledb` driver in Thin mode, bundled
into toil): no Instant Client, no `sqlplus`, no native library, nothing to install.
toil never switches the driver to Thick mode.

| Key | Required | Meaning |
|-----|----------|---------|
| `engine` | yes | `oracle` |
| `host` | yes | Listener host name or IP address. Nothing else: no port, scheme or descriptor. |
| `port` | no | Listener port. Default `1521`. |
| `database` | yes | The **service name** (`FREEPDB1`, `ORCLPDB1`). Not a SID, and not a TNS alias. |
| `user` | yes | The user. Unquoted, it's read in upper case, as Oracle does; wrap it in double quotes for a case-sensitive one. |
| `password` | no | The user's password. A secret: an env var or the OS credential store, never the config file. |
| `ssl` | no | `true` connects over TCPS and verifies the server's certificate, and that its name matches `host`, against the OS certificate store. Off by default. |
| `writes` | no | `true` lets `db execute` change data on this connection. Off by default. |

```bash
export TOIL_DB_ENGINE=oracle
export TOIL_DB_HOST=db.imagile.dev
export TOIL_DB_PORT=1521
export TOIL_DB_DATABASE=ORCLPDB1
export TOIL_DB_USER=reader
export TOIL_DB_PASSWORD=<the user's password>
```

```json
{
  "version": 2,
  "connections": {
    "app-ora": { "area": "db", "engine": "oracle", "host": "db.imagile.dev", "database": "ORCLPDB1", "user": "reader" }
  },
  "defaults": { "db": { "connection": "app-ora" } }
}
```

```bash
toil connections login app-ora   # prompts for the password and stores it
```

toil builds the connect descriptor itself from `host`, `port` and `database`, so it
reads no `tnsnames.ora`, `sqlnet.ora`, `TNS_ADMIN` or wallet. Thin mode needs the
user's password to have an 11G or 12C verifier; an older one fails with `AUTH`,
saying so.

**Connect with a read-only account**: a user granted `SELECT` (or `READ`) on what the
agent should see, and nothing that writes. On Oracle this matters more than on the
other engines; see the known limit under "Reads are read-only at the engine".

## Commands

| Command | MCP tool | Returns |
|---------|----------|---------|
| `toil db list-schemas` | `db_list_schemas` | `{ schemas: [{ name }] }`. For SQLite, the attached databases (`main`); for PostgreSQL, the schemas, without `pg_*` and `information_schema`; for Oracle, the users the login can see that Oracle doesn't maintain. |
| `toil db list-tables [--schema <name>]` | `db_list_tables` | `{ schema, tables: [{ name, type }] }`, `type` being `table` or `view` |
| `toil db describe-table <table> [--schema <name>]` | `db_describe_table` | `{ schema, name, type, columns, primaryKey, indexes, foreignKeys }` |
| `toil db preview-table <table> [--schema] [--limit] [--cursor]` | `db_preview_table` | A page of rows: `{ columns, rows }` |
| `toil db query <sql> [--limit] [--cursor]` | `db_query` | A page of rows from one read-only statement: `{ columns, rows }` |
| `toil db execute <sql> --allow-write` | `db_execute` | `{ changes }`: rows inserted, updated or deleted |

Every command takes `--connection <name>`. `--schema` defaults to the engine's
default schema (`main` for SQLite, `public` for PostgreSQL, the user's own schema for
Oracle). PostgreSQL names are case-sensitive as stored: an unquoted `CREATE TABLE
People` is stored as `people`. Oracle stores an unquoted name in upper case and
reports names as stored (`PEOPLE`, `ID`); a schema or table you name that doesn't
exist as written is looked up again in upper case, so `describe-table people` finds
`PEOPLE`. A quoted mixed-case name (`"People"`) must be typed exactly.

Rows come back as arrays in the order of `columns`, so a join's two `id` columns both
survive:

```json
{ "columns": [{ "name": "id", "type": "INTEGER" }, { "name": "name", "type": "TEXT" }],
  "rows": [[1, "Ada"], [2, "Grace"]] }
```

`type` is the column's declared type, or null for an expression. Integers too large
for JavaScript come back as strings, and binary values as base64.

PostgreSQL names every result column's type (`integer`, `character varying(100)`,
`timestamp with time zone`). `numeric` comes back as a string, so no digits are lost;
`json` and `jsonb` as JSON; arrays as arrays. Dates, times, timestamps and intervals
come back as the text the server sent, never shifted into the local time zone.

Oracle names each result column's type (`NUMBER`, `VARCHAR2`, `DATE`), and
`describe-table` gives the declared form (`NUMBER(10,2)`, `VARCHAR2(100)`). A `NUMBER`
is a JSON number when that's exactly its value, and a string otherwise, so no digits
are lost. `CLOB` comes back as text, `BLOB` and `RAW` as base64, `BOOLEAN` as a
boolean, and `BINARY_DOUBLE`'s NaN and infinities as strings. `DATE` and `TIMESTAMP`
come back as the server holds them, with no zone (`2026-01-02T03:04:05`, and a
`TIMESTAMP` with milliseconds); `TIMESTAMP WITH TIME ZONE` as the instant it names, in
UTC (`...Z`). Two limits come from the driver: fractional seconds keep only
milliseconds, and a `DATE` or `TIMESTAMP` whose time falls in the daylight-saving gap
of the machine running toil (02:30 on the spring-forward night) reads an hour later.

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

**PostgreSQL** runs every read in a transaction begun with `SET TRANSACTION READ ONLY`
and rolled back, on a connection opened for that one call. The server refuses any
write (`INSERT`, `UPDATE`, DDL, `nextval`, a data-modifying `WITH`) with SQLSTATE
25006, which comes back as `WRITE_DISABLED`. `db query` sends its statement on the
extended protocol, which refuses a second one, so several statements are
`INVALID_INPUT` here too.

`COPY` and `DO` are refused on every read with `INVALID_INPUT`, before they reach the
server: `COPY ... TO '<file>'` writes a file on the server, and `TO PROGRAM` runs one,
even in a read-only transaction, for a role allowed to, and a `DO` block can run the
same `COPY`. Neither returns rows a query could page. To run them, use `db execute`.

Known limit: functions with effects outside the database still run in a read-only
transaction for a role allowed to call them. `lo_export` writes a server file,
`pg_terminate_backend` ends sessions, `pg_reload_conf` reloads the server's config,
and an extension such as `dblink` can reach another database. They can't be refused
by name, so connect with an ordinary role: not a superuser, and not a member of
`pg_write_server_files`, `pg_execute_server_program` or `pg_signal_backend`.

**Oracle** runs every read in a transaction begun with `SET TRANSACTION READ ONLY` and
rolled back, on a connection opened for that one call. The server refuses `INSERT`,
`UPDATE`, `DELETE`, `MERGE` and `SELECT ... FOR UPDATE` with ORA-01456, which comes
back as `WRITE_DISABLED`, as do a read-only user or session (ORA-28193) and a database
open read-only (ORA-16000). `db query` runs one statement; several are `INVALID_INPUT`.

That transaction doesn't hold everything, so some statements are refused on every read
before they reach the server:

- **DDL** (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `RENAME`, `GRANT`, `REVOKE`,
  `COMMENT`, `ANALYZE`, `PURGE`, `FLASHBACK`, `NOAUDIT`, `ASSOCIATE`,
  `DISASSOCIATE`) is `WRITE_DISABLED`: Oracle commits before and after DDL, so it runs,
  and stays, inside a read-only transaction.
- **PL/SQL** (`BEGIN`, `DECLARE`, `CALL`, and `WITH FUNCTION` or `WITH PROCEDURE`) is
  `INVALID_INPUT`: a block can `COMMIT`, `EXECUTE IMMEDIATE` DDL, or run an autonomous
  transaction, and `CALL` reaches built-ins such as `DBMS_UTILITY.EXEC_DDL_STATEMENT`.

To run any of them, use `db execute`.

Known limit: a stored function that runs an autonomous transaction (`PRAGMA
AUTONOMOUS_TRANSACTION`) still writes when a `SELECT` calls it, and a function can't be
refused by name. **Connect with an account that can't write**: then nothing a query
calls can either. `AUDIT` isn't refused either: it needs the audit privileges an
ordinary account doesn't have.

### Writes

`db execute` is the only command that changes data. It needs both:

1. `writes: true` on the connection (`TOIL_DB_WRITES=true`, or
   `TOIL_CONN_<NAME>_WRITES=true`), set by the person who owns the config, and
2. `--allow-write` on the call (`allowWrite: true` over MCP).

Without either it fails with `WRITE_DISABLED` and changes nothing. It runs one or more
statements, separated by semicolons, in one transaction that commits only if every
statement succeeds. A script that starts or ends a transaction of its own (`BEGIN`,
`COMMIT`, `END`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`, and for PostgreSQL also `START`,
`ABORT` and `PREPARE TRANSACTION`) is refused with `INVALID_INPUT` before any of it runs.

On PostgreSQL, statements that can't run inside a transaction (`VACUUM`, `CREATE
DATABASE`, `CREATE INDEX CONCURRENTLY`) fail with `DATABASE`; run those with your own
tools. A connection that reaches a read-only standby, or a role whose transactions
default to read-only, fails writes with `DATABASE`, saying so.

On Oracle, a script's statements are separated by semicolons, and a PL/SQL unit (a
`BEGIN` or `DECLARE` block, `CREATE FUNCTION`, `PROCEDURE`, `PACKAGE`, `TRIGGER` or
`TYPE`) runs to a line holding only `/`, as in SQL*Plus, or to the end of the script.
`COMMIT`, `ROLLBACK`, `SAVEPOINT` and `SET TRANSACTION` are refused before any of it
runs. Two things Oracle does break all-or-nothing, and toil can't stop them: **DDL
commits** everything before it, and itself, as it runs, and a PL/SQL block can commit
inside. When a script with DDL fails, the error says which statements stayed committed
(`statements 1 to 2 of 4 were committed`). Keep DDL in a script of its own, or first.

### Time limits and cancelling

Every command stops at `TOIL_TIMEOUT_MS` (default 120000) with `TIMEOUT`, and on
Ctrl+C or an MCP cancel with `CANCELLED`. The answer comes back straight away.
SQLite can only be stopped between rows, though: a statement that computes for a long
time before producing its first row keeps running in the background until it
finishes, and the CLI process exits only then. Prefer `LIMIT` and indexed filters on
large tables.

PostgreSQL stops the statement on the server: on a time limit or a cancel, toil asks
the server to cancel it (`pg_cancel_backend`, from a second short connection), so a
long sort or `pg_sleep` doesn't keep running after toil has answered. `db query`
reads rows a batch at a time from a server-side portal, so the server stops
producing rows once the page is full.

Oracle is sent a break (`connection.break()`) on a time limit or a cancel, which stops
the statement on the server at its next check: a long join or sort stops at once.
Thin mode's break travels in the data stream, so a session parked in
`DBMS_SESSION.SLEEP` hears it only when the sleep ends; toil still answers straight
away. `db query` reads rows a batch at a time from a server-side cursor.

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
| `CONFIG_INVALID` | A connection is missing `engine` or a key its engine needs (`path`; `host`, `database`, `user`), `path` is relative, the file isn't a SQLite database, or an Oracle `host` or `database` holds more than a host name or service name |
| `AUTH` | PostgreSQL or Oracle refused the login: check `user` and `password`; on Oracle, also a locked or expired account, or a password verifier too old for Thin mode |
| `NETWORK` | The server or listener couldn't be reached, didn't answer, or its TLS certificate wasn't trusted |
| `NOT_FOUND` | The file, database, Oracle service, schema or table doesn't exist |
| `WRITE_DISABLED` | A write was refused: by `db query` (DDL included, on Oracle), or by the write gate on `db execute` |
| `INVALID_INPUT` | Bad flags, a cursor from another query, several statements in `db query`, or `VACUUM` (SQLite), `COPY` and `DO` (PostgreSQL) or PL/SQL (Oracle) on a read |
| `DATABASE` | The engine refused or failed the statement: bad SQL, a constraint, a lock |
| `TIMEOUT`, `CANCELLED` | Stopped waiting; for `db execute`, check whether the change was made before retrying |
