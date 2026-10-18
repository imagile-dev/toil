---
area: db
description: Schemas, tables, describe, row previews, read-only queries with paging, and gated writes on databases (SQLite, PostgreSQL, MySQL/MariaDB)
---

# toil db

One set of commands for every database engine. Each connection says which engine it
uses, and the commands work the same way on all of them.

| Engine | `engine` value | Status |
|--------|----------------|--------|
| SQLite | `sqlite` | `integration`: automated tests run against the real engine (Node's built-in `node:sqlite`) |
| PostgreSQL | `postgres` | `integration`: automated tests run against PostgreSQL 17 (the official `postgres:17` image) |
| MySQL / MariaDB | `mysql` | `integration`: automated tests run against MySQL 8.4 and MariaDB 11.8 (the official `mysql:8.4` and `mariadb:11.8` images) |
| SQL Server, Oracle | | Planned |

**Supported versions:** The oldest SQLite version toil supports hasn't been established. toil
uses the SQLite built into Node, so the version is whichever your Node ships.
PostgreSQL is tested against 17; the catalog columns toil reads need 11 or later.
MySQL is tested against 8.4 and MariaDB against 11.8; the oldest versions toil
supports haven't been established.

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

## MySQL and MariaDB connections

One engine, `mysql`, covers both. toil speaks their wire protocol in plain
JavaScript (the `mysql2` driver, bundled into toil): no client library, no `mysql`
CLI, nothing to install.

| Key | Required | Meaning |
|-----|----------|---------|
| `engine` | yes | `mysql` |
| `host` | yes | Server host name or address |
| `port` | no | TCP port. Default `3306`. |
| `database` | yes | The database to connect to. It is also the default schema. |
| `user` | yes | The account |
| `password` | no | The account's password. A secret: an env var or the OS credential store, never the config file. |
| `ssl` | no | `true` connects over TLS and verifies the server's certificate and host name against Node's and the OS's certificate stores. Off by default. |
| `writes` | no | `true` lets `db execute` change data on this connection. Off by default. |

**Environment variables**, for the default `db` connection:

```bash
export TOIL_DB_ENGINE=mysql
export TOIL_DB_HOST=db.imagile.dev
export TOIL_DB_PORT=3306
export TOIL_DB_DATABASE=app
export TOIL_DB_USER=reader
export TOIL_DB_PASSWORD=<the account's password>
export TOIL_DB_SSL=true
```

Or in config, with the password in the OS credential store:

```json
{
  "version": 2,
  "connections": {
    "app-mysql": { "area": "db", "engine": "mysql", "host": "db.imagile.dev", "database": "app", "user": "reader", "ssl": true }
  },
  "defaults": { "db": { "connection": "app-mysql" } }
}
```

```bash
toil connections login app-mysql   # prompts for the password and stores it
```

toil reads no option file (`my.cnf`, `~/.mylogin.cnf`) and no `MYSQL_*` variable. It
never sends the password in clear text (an account using `mysql_clear_password`
fails with `AUTH`), and it never uploads a local file: `LOAD DATA LOCAL` is off.

**Connect with an account that has only `SELECT`** on what the agent should see. See
the known limits under "Reads are read-only at the engine".

## Commands

| Command | MCP tool | Returns |
|---------|----------|---------|
| `toil db list-schemas` | `db_list_schemas` | `{ schemas: [{ name }] }`. For SQLite, the attached databases (`main`); for PostgreSQL, the schemas, without `pg_*` and `information_schema`; for MySQL, the databases the account can see, without `mysql`, `sys`, `performance_schema` and `information_schema`. |
| `toil db list-tables [--schema <name>]` | `db_list_tables` | `{ schema, tables: [{ name, type }] }`, `type` being `table` or `view` |
| `toil db describe-table <table> [--schema <name>]` | `db_describe_table` | `{ schema, name, type, columns, primaryKey, indexes, foreignKeys }` |
| `toil db preview-table <table> [--schema] [--limit] [--cursor]` | `db_preview_table` | A page of rows: `{ columns, rows }` |
| `toil db query <sql> [--limit] [--cursor]` | `db_query` | A page of rows from one read-only statement: `{ columns, rows }` |
| `toil db execute <sql> --allow-write` | `db_execute` | `{ changes }`: rows inserted, updated or deleted |

Every command takes `--connection <name>`. `--schema` defaults to the engine's
default schema (`main` for SQLite, `public` for PostgreSQL, the connection's database
for MySQL, where a schema is a database). PostgreSQL names are
case-sensitive as stored: an unquoted `CREATE TABLE People` is stored as `people`.
MySQL table names are case-sensitive on most Linux servers.

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

MySQL names each result column's type from the protocol (`INT`, `BIGINT`, `VARCHAR`,
`DECIMAL`, `DATETIME`), without lengths; `describe-table` gives the full column type
(`varchar(100)`). `DECIMAL` comes back as a string; dates, times and timestamps as the
text the server sent; `JSON` as JSON; `BLOB`, `BINARY` and `BIT` as base64.
`preview-table` orders a table by its primary key, so pages stay stable. In
`describe-table`, a foreign key's `NO ACTION` and `RESTRICT` both read as null: InnoDB
enforces them the same way, and MariaDB reports an unstated rule as `RESTRICT`.

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

**MySQL and MariaDB** run every read on a session set to `SET SESSION TRANSACTION READ
ONLY`, inside `START TRANSACTION READ ONLY`, rolled back, on a connection opened for
that one call. Both are needed: DDL commits the transaction implicitly, and the session
setting makes the server refuse it all the same. Any write (`INSERT`, `UPDATE`, DDL,
`LOAD DATA`) fails with error 1792, which comes back as `WRITE_DISABLED`. `db query`
sends one statement with multi-statements off; several are `INVALID_INPUT`.

`SELECT ... INTO OUTFILE`, `INTO DUMPFILE` and every `SET` are refused on reads with
`INVALID_INPUT`, before they reach the server: `INTO OUTFILE` writes a server file even
in a read-only transaction, for an account with `FILE`, and `SET GLOBAL` or `SET
PERSIST` changes the server's configuration. To run them, use `db execute`.

Known limits: a stored procedure that commits and switches its own session to read-write
can still write when a read `CALL`s it, and administrative statements that aren't
writes (`KILL`, `FLUSH`, `SHUTDOWN`) run for an account allowed to. Neither can be
refused by name without refusing ordinary reads, so connect with an account that has
`SELECT` only: no `FILE`, `SUPER`, `SYSTEM_VARIABLES_ADMIN` or `CONNECTION_ADMIN`, and no
`EXECUTE` on procedures that change data.

### Writes

`db execute` is the only command that changes data. It needs both:

1. `writes: true` on the connection (`TOIL_DB_WRITES=true`, or
   `TOIL_CONN_<NAME>_WRITES=true`), set by the person who owns the config, and
2. `--allow-write` on the call (`allowWrite: true` over MCP).

Without either it fails with `WRITE_DISABLED` and changes nothing. It runs one or more
statements, separated by semicolons, in one transaction that commits only if every
statement succeeds. A script that starts or ends a transaction of its own (`BEGIN`,
`COMMIT`, `END`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`, and for PostgreSQL also `START`,
`ABORT` and `PREPARE TRANSACTION`; for MySQL also `START TRANSACTION`, `XA`, `LOCK` and
`UNLOCK TABLES`, and `SET autocommit`) is refused with `INVALID_INPUT` before any of it runs.

On MySQL and MariaDB, DDL (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`) commits implicitly,
so a script holding DDL isn't all or nothing: what ran before the DDL is committed
even if a later statement fails. Keep DDL in a script of its own. A server running
`read_only`, or an account whose transactions default to read-only, fails writes with
`DATABASE`, saying so.

On PostgreSQL, statements that can't run inside a transaction (`VACUUM`, `CREATE
DATABASE`, `CREATE INDEX CONCURRENTLY`) fail with `DATABASE`; run those with your own
tools. A connection that reaches a read-only standby, or a role whose transactions
default to read-only, fails writes with `DATABASE`, saying so.

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

MySQL stops the statement on the server too, with `KILL <id>` from a second short
connection. That ends the whole session, so a cancelled `db execute` rolls back and
runs none of its remaining statements. Its protocol has no portal, so `db query` reads rows as they stream and,
once the page is full, drops the connection; the server stops at the next row it
tries to send.

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
| `CONFIG_INVALID` | A connection is missing `engine` or a key its engine needs (`path`; `host`, `database`, `user`), `path` is relative, or the file isn't a SQLite database |
| `AUTH` | PostgreSQL or MySQL refused the login: check `user` and `password` |
| `NETWORK` | The PostgreSQL or MySQL server couldn't be reached, didn't answer, or its TLS certificate wasn't trusted |
| `NOT_FOUND` | The file, database, schema or table doesn't exist |
| `WRITE_DISABLED` | A write was refused: by `db query`, or by the write gate on `db execute` |
| `INVALID_INPUT` | Bad flags, a cursor from another query, several statements in `db query`, or `VACUUM` (SQLite) `COPY` and `DO` (PostgreSQL), or `INTO OUTFILE` and `SET` (MySQL) on a read |
| `DATABASE` | The engine refused or failed the statement: bad SQL, a constraint, a lock |
| `TIMEOUT`, `CANCELLED` | Stopped waiting; for `db execute`, check whether the change was made before retrying |
