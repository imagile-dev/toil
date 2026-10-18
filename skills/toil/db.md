---
area: db
description: Schemas, tables, describe, row previews, read-only queries with paging, and gated writes on databases (SQLite, PostgreSQL, MySQL/MariaDB, SQL Server, Oracle)
---

# Databases (`db`)

One set of commands for every database engine. Each connection says which engine it
uses, and the commands work the same way on all of them.

| Engine | `engine` value | Status |
|--------|----------------|--------|
| SQLite | `sqlite` | `live`: automated tests run against the real engine (Node's built-in `node:sqlite`) |
| PostgreSQL | `postgres` | `live`: automated tests run against PostgreSQL 17 (the official `postgres:17` image) |
| MySQL / MariaDB | `mysql` | `live`: automated tests run against MySQL 8.4 and MariaDB 11.8 (the official `mysql:8.4` and `mariadb:11.8` images) |
| SQL Server | `sqlserver` | `live`: automated tests run against SQL Server 2022 (the official `mcr.microsoft.com/mssql/server:2022-CU27-ubuntu-22.04` image) |
| Oracle | `oracle` | `live`: automated tests run against Oracle Database 23ai Free (the `gvenzl/oracle-free:23.26.3-slim-faststart` image) |

**Supported versions:** The oldest SQLite version toil supports hasn't been established. toil
uses the SQLite built into Node, so the version is whichever your Node ships.
PostgreSQL is tested against 17; the catalog columns toil reads need 11 or later.
MySQL is tested against 8.4 and MariaDB against 11.8; the oldest versions toil
supports haven't been established.
SQL Server is tested against 2022; the catalog views and `OFFSET ... FETCH` toil uses
need 2012 or later. Azure SQL Database speaks the same protocol but hasn't been tested.
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
| `ssl` | no | `true` connects over TLS and verifies the server's certificate against Node's CAs, `NODE_EXTRA_CA_CERTS` and the OS certificate store, so a corporate root in the OS store is trusted. Off by default. |
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

## SQL Server connections

toil speaks TDS, SQL Server's wire protocol, in plain JavaScript (the `tedious`
driver, bundled into toil): no ODBC driver, no `sqlcmd`, nothing to install. It signs
in with a SQL Server login (user name and password), which needs the server to allow
SQL Server authentication (mixed mode), or, on Windows only, with Windows
authentication (`"auth": "windows"`, below).

| Key | Required | Meaning |
|-----|----------|---------|
| `engine` | yes | `sqlserver` |
| `host` | yes | Server host name or address |
| `port` | no | TCP port. Default `1433`. A named instance needs its own port here: toil doesn't ask the SQL Browser service. |
| `database` | yes | The database to connect to |
| `user` | for a SQL login | The SQL Server login; with `"auth": "windows"`, another domain account to sign in as |
| `password` | no | The login's password. A secret: an env var or the OS credential store, never the config file. |
| `ssl` | no | `true` encrypts the connection with TLS and verifies the server's certificate against the OS certificate store. Off by default, which sends the login and every result unencrypted, so turn it on unless the network is trusted. There is no setting to trust any certificate: add the server's certificate, or your organization's CA, to the OS store instead. |
| `auth` | no | `sql` (a SQL Server login, the default) or `windows` (Windows authentication, Windows only) |
| `domain` | no | With `"auth": "windows"` and `user`: the account's domain |
| `writes` | no | `true` lets `db execute` change data on this connection. Off by default. |

**Environment variables**, for the default `db` connection:

```bash
export TOIL_DB_ENGINE=sqlserver
export TOIL_DB_HOST=sql.imagile.dev
export TOIL_DB_PORT=1433
export TOIL_DB_DATABASE=app
export TOIL_DB_USER=toil_reader
export TOIL_DB_PASSWORD=<the login's password>
export TOIL_DB_SSL=true
```

Or keep the connection in config and the password in the OS credential store:

```json
{
  "version": 2,
  "connections": {
    "app-sql": { "area": "db", "engine": "sqlserver", "host": "sql.imagile.dev", "database": "app", "user": "toil_reader", "ssl": true }
  },
  "defaults": { "db": { "connection": "app-sql" } }
}
```

```bash
toil connections login app-sql   # prompts for the password and stores it
```

A named connection's password can also come from `TOIL_CONN_APP_SQL_PASSWORD`.

### Windows authentication (Windows only)

`"auth": "windows"` signs in as the Windows user running toil, with no password
stored anywhere: Windows proves who you are with the Kerberos ticket (or NTLM) it
already holds from your logon.

```json
{
  "version": 2,
  "connections": {
    "app-sql": { "area": "db", "engine": "sqlserver", "host": "sql.imagile.dev", "database": "app", "auth": "windows", "ssl": true }
  }
}
```

From the environment, for the default `db` connection, as the current Windows user:

```bash
export TOIL_DB_ENGINE=sqlserver
export TOIL_DB_HOST=sql.imagile.dev
export TOIL_DB_DATABASE=app
export TOIL_DB_AUTH=windows
```

To sign in as a different domain account, add `domain` and `user` (`TOIL_DB_DOMAIN`,
`TOIL_DB_USER`), and store that account's password with `toil connections login
app-sql` (Windows Credential Manager), or set `TOIL_CONN_APP_SQL_PASSWORD`.

| Platform | `"auth": "windows"` |
|----------|---------------------|
| Windows | Supported |
| macOS, Linux | Refused before connecting (`CONFIG_INVALID`); use a SQL Server login |

How it works: Node has no way to ask Windows for a sign-in token, so for each
connection toil runs one Windows PowerShell (`powershell.exe` from the Windows
folder, `-NoProfile -NonInteractive`), which asks Windows' SSPI `Negotiate` package
for tokens for the server's SPN, `MSSQLSvc/<host>:<port>`. The script and every token
pass over the process's stdin and stdout, never its command line. Use the server's
fully qualified name in `host`, the name its SPN is registered under; with any other
name Kerberos can't find the SPN, and Windows falls back to NTLM if the server and
domain allow it.

Windows PowerShell must run in Full Language mode. Where an AppLocker or WDAC
policy puts it in Constrained Language mode, `Add-Type` is blocked, and toil says so
with `AUTH` naming the mode instead of failing the login vaguely. Windows PowerShell
5.1's `Add-Type` also compiles a small helper with `csc.exe` into `TEMP`, so `TEMP`
must be writable.

Windows authentication is `untested` against a real server: its tests run the
helper against Windows' own SSPI, and a full multi-step handshake completes, but
no run against SQL Server on a domain has happened yet, nor one under a
Constrained Language Mode policy.

**Connect with a read-only login.** SQL Server has no read-only transaction, so toil
can't ask the server to refuse writes the way it does for PostgreSQL. It rolls back
every read instead (see "Reads are read-only at the engine"), and the login is what
makes the server itself refuse a write. A login whose database user is only in
`db_datareader` is enough:

```sql
CREATE LOGIN toil_reader WITH PASSWORD = '<a strong password>';
USE app;
CREATE USER toil_reader FOR LOGIN toil_reader;
ALTER ROLE db_datareader ADD MEMBER toil_reader;
```

Use a second connection, with a login that may write and `writes: true`, for `db
execute`.

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
| `toil db list-schemas` | `db_list_schemas` | `{ schemas: [{ name }] }`. For SQLite, the attached databases (`main`); for PostgreSQL, the schemas, without `pg_*` and `information_schema`; for MySQL, the databases the account can see, without `mysql`, `sys`, `performance_schema` and `information_schema`; for SQL Server, the schemas, without `sys`, `INFORMATION_SCHEMA`, `guest` and the `db_*` role schemas; for Oracle, the users the login can see that Oracle doesn't maintain. |
| `toil db list-tables [--schema <name>]` | `db_list_tables` | `{ schema, tables: [{ name, type }] }`, `type` being `table` or `view` |
| `toil db describe-table <table> [--schema <name>]` | `db_describe_table` | `{ schema, name, type, columns, primaryKey, indexes, foreignKeys }` |
| `toil db preview-table <table> [--schema] [--limit] [--cursor]` | `db_preview_table` | A page of rows: `{ columns, rows }` |
| `toil db query <sql> [--limit] [--cursor]` | `db_query` | A page of rows from one read-only statement: `{ columns, rows }` |
| `toil db execute <sql> --allow-write` | `db_execute` | `{ changes }`: rows inserted, updated or deleted |

Every command takes `--connection <name>`. `--schema` defaults to the engine's
default schema (`main` for SQLite, `public` for PostgreSQL, the connection's database
for MySQL, where a schema is a database, `dbo` for SQL Server, and the user's own
schema for Oracle). PostgreSQL names are case-sensitive as stored: an unquoted
`CREATE TABLE People` is stored as `people`. MySQL table names are case-sensitive on
most Linux servers. Oracle stores an unquoted name in upper case and reports names as
stored (`PEOPLE`, `ID`); a schema or table you name that doesn't exist as written is
looked up again in upper case, so `describe-table people` finds `PEOPLE`. A quoted
mixed-case name (`"People"`) must be typed exactly.

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
SQL Server names every result column's type as you'd write it in DDL (`int`,
`varchar(100)`, `nvarchar(max)`, `decimal(10,2)`, `datetime2(7)`). `bigint` comes back
as a number when it fits and a string when it doesn't; `bit` as true or false;
`uniqueidentifier` as a string; binary as base64. `date`, `time`, `datetime`,
`datetime2` and `smalldatetime` come back as the text of the value the server holds,
never shifted into a time zone (`2026-01-02 03:04:05.123`), to the millisecond: digits
past that are dropped. `datetimeoffset` comes back as the instant in UTC
(`2026-01-02T01:04:05.000Z`), without its original offset. `decimal`, `numeric` and
`money` come back as JSON numbers, so a value with more than about 15 significant
digits loses the rest; `CAST` it to `varchar` in the query when every digit matters.
`preview-table` pages in primary-key order, or in the engine's own order for a table
without one.

Oracle names each result column's type (`NUMBER`, `VARCHAR2`, `DATE`), and
`describe-table` gives the declared form (`NUMBER(10,2)`, `VARCHAR2(100)`). A `NUMBER`
is a JSON number when that's exactly its value, and a string otherwise, so no digits
are lost. `CLOB` comes back as text, `BLOB` and `RAW` as base64, `BOOLEAN` as a
boolean, and `BINARY_DOUBLE`'s NaN and infinities as strings. Dates and
timestamps come back exactly as stored, in the shape PostgreSQL and MySQL use, never
through the local time zone of the machine running toil: `DATE` as
`2026-01-02 03:04:05`, `TIMESTAMP` with every fractional digit it holds
(`2026-01-02 03:04:05.123456`), and `TIMESTAMP WITH TIME ZONE` with its offset
(`2026-01-02 03:04:05+02`, `+05:30`). A value stored with a named region
(`Europe/Paris`) and `TIMESTAMP WITH LOCAL TIME ZONE` come back as the same instant in
UTC (`+00`).

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
**SQL Server** has no read-only transaction. toil runs every read in a transaction,
on a connection opened for that one call, and always rolls it back, so nothing a read
does is kept. The server reports the type of every statement it runs, and a read whose
statement the server reports as changing data or schema (`INSERT`, `UPDATE`,
`DELETE`, `MERGE`, `SELECT INTO`, `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `UPDATE
STATISTICS`, including inside `EXEC`) comes back as `WRITE_DISABLED`. With a
read-only login the server refuses the write itself, which comes back as
`WRITE_DISABLED` too. `db query` returns one result: SQL that returns a second result
is `INVALID_INPUT`. When the first result fills the page, toil stops the batch there
with a TDS attention, so anything after it in the same SQL never runs.

`COMMIT`, `ROLLBACK`, `BEGIN TRANSACTION` and `SAVE TRANSACTION` are refused on every
read with `INVALID_INPUT`, before they reach the server: a `COMMIT` would end the
transaction toil rolls back, and keep the write before it. An `OUTPUT` clause is refused
on reads too: an `INSERT`, `UPDATE`, `DELETE` or `MERGE` with `OUTPUT` sends its rows
before the server reports the change, so a full page could stop it before toil learns it
was a write. A column or alias named `output` in a plain `SELECT` is fine; in SQL that
also holds one of those words, bracket-quote it as `[output]`. A read-only login's refusal of a permission that only reads (a `sys.dm_db_*`
view needing `VIEW DATABASE STATE`, `SHOWPLAN`) comes back as `DATABASE`, naming the
permission.

Known limit: transaction control inside dynamic SQL or a procedure (an `EXEC` whose
text holds a `COMMIT`) can't be refused by name, and neither can an `OUTPUT` clause
there (`EXEC('UPDATE ... OUTPUT ...')`): its changed rows can fill a page and come back
as an ordinary result, though the change is still rolled back. A write under `SET
NOCOUNT ON` isn't reported by the server. toil notices the transaction ending and says so with
`DATABASE` ("anything it changed may have been saved"), but by then the change is
made. That is why a SQL Server connection for reads should use a read-only login:
with one, the server refuses the write whatever the SQL does.

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
ordinary account doesn't have. A trigger or stored function with an autonomous
transaction commits on its own; toil can't see it, so "nothing was applied" after a
failed `db execute` covers only the script's own transaction.

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
On SQL Server that means `BEGIN TRANSACTION`, `COMMIT`, `ROLLBACK` and `SAVE
TRANSACTION`; `BEGIN ... END` blocks, `TRY ... CATCH` and `CASE` are fine. A SQL
Server script runs as one batch, so leave out `GO`, and a statement that must start a
batch (`CREATE VIEW`, `CREATE PROCEDURE`) goes in a call of its own. `changes` counts
the rows `INSERT`, `UPDATE`, `DELETE`, `MERGE` and `SELECT INTO` reported; under `SET
NOCOUNT ON` the server reports none.

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
inside. When a script fails after Oracle has committed part of it (a DDL statement
that ran, or failed after parsing), the error says which
statements stayed committed (`Oracle committed statements 1 to 2 of 4`). After a
PL/SQL block or a `CALL` ran, toil can't see whether it committed, so the error says the statements
up to the failure may have committed; check before running the script again. Only when
nothing in the script could have committed does it say nothing was applied (an
autonomous-transaction trigger or function is the exception; see the known limit above). Keep DDL in a
script of its own, or first.

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
SQL Server stops the statement on the server too: on a time limit or a cancel, toil
sends a TDS attention, which ends the running batch, and the read's transaction is
rolled back when its connection closes.

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
| `CONFIG_INVALID` | A connection is missing `engine` or a key its engine needs (`path`; `host`, `database`, `user`), `path` is relative, the file isn't a SQLite database, `"auth": "windows"` is set off Windows, or an Oracle `host` or `database` holds more than a host name or service name |
| `AUTH` | The server refused the login: check `user` and `password` (for SQL Server, also that SQL Server logins are allowed; for Oracle, also a locked or expired account, or a password verifier too old for Thin mode); or Windows authentication couldn't start (Constrained Language mode, SSPI refused) |
| `NETWORK` | The server or listener couldn't be reached, didn't answer, or its TLS certificate wasn't trusted; or SQL Server requires encryption and `ssl` is off |
| `NOT_FOUND` | The file, database, Oracle service, schema or table doesn't exist |
| `WRITE_DISABLED` | A write was refused: by `db query` (DDL included, on Oracle), or by the write gate on `db execute` |
| `INVALID_INPUT` | Bad flags, a cursor from another query, several statements in `db query`, or on a read `VACUUM` (SQLite), `COPY` and `DO` (PostgreSQL), `INTO OUTFILE` and `SET` (MySQL), transaction control and `OUTPUT` (SQL Server), or PL/SQL (Oracle) |
| `DATABASE` | The engine refused or failed the statement: bad SQL, a constraint, a lock, a permission; on SQL Server, also SQL that ended toil's transaction itself |
| `TIMEOUT`, `CANCELLED` | Stopped waiting; for `db execute`, check whether the change was made before retrying |
