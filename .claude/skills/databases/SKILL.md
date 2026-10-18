---
name: databases
description: Rules for toil's `db` area and its database providers (PostgreSQL, MySQL/MariaDB, SQL Server, SQLite, Oracle). Use when adding or changing a database provider or driver under src/core/db/, changing how queries run (read-only transactions, rollback, row caps, timeouts, paging, cancellation), handling database connection strings, or writing database tests including `npm run test:integration` service containers.
---

# Databases

- **Read-only by default**, per **Writes** in CLAUDE.md: `writes: true` on the
  connection and `--allow-write` on the call.
- Statements run in a read-only transaction or session where the engine supports it,
  then rolled back. Do not rely on parsing SQL to decide whether it writes.
- Every query has a row cap (default 100) and a timeout, returns a cursor for paging,
  and can be cancelled.
- Connection strings resolve like any other secret: env var, then keychain reference,
  then config. Never log a connection string; log the connection name.
- Drivers are pure JS: `pg` (PostgreSQL), `mysql2` (MySQL/MariaDB), `tedious` (SQL
  Server), `node:sqlite` (built into Node), `oracledb` in Thin mode only (Oracle).
  SQL Server has no read-only transaction, so its queries always roll back, and its
  docs tell users to connect with a read-only login.
- **TLS trusts what HTTP trusts.** Core loads the OS certificate store on the first
  HTTP request, and a driver's own socket never makes one. A provider with TLS
  passes `trustedCertificates(call.debug).certificates` from `src/core/network.ts`
  (Node's defaults, `NODE_EXTRA_CA_CERTS`, then the OS store) as the driver's `ca`,
  and keeps the driver's defaults when it's undefined (the store couldn't be read).
- Providers live in `src/core/db/<engine>/`. Adding one follows this skill, and each
  provider records a verification level (see the `integrations` skill).

## The framework

The `db` area (`src/areas/db/`) has one set of commands for every engine:
`list-schemas`, `list-tables`, `describe-table`, `preview-table`, `query` (read-only,
one statement, paged) and `execute` (the only write, `writes: true`). A connection
names its `engine`; commands look up that engine's provider and never know which
one they got.

- **`DbProvider`** (`src/core/db/provider.ts`) is the whole contract: list schemas,
  list tables, describe, preview a window of rows, query a window of rows read-only,
  execute in one transaction. Providers return plain data; they never see cursors,
  and never return driver objects or connection strings.
- **Paging is not a provider's job.** `src/core/db/paging.ts` asks for
  `limit + 1` rows from an offset, trims the extra row into `meta.page.nextCursor`,
  and makes values JSON-safe (big integers to strings, binary to base64). Cursors
  carry a fingerprint of the SQL or table and are refused against any other.
- **Read-only is the engine's job.** `query` must run where the engine itself
  refuses writes, and a refused write maps to `WRITE_DISABLED` from the engine's
  error code, never from reading the SQL. The one exception is a narrow deny for a
  statement that gets around the engine's own read-only mode: SQLite's `VACUUM INTO`
  creates its target file before the read-only refusal, so SQLite reads refuse any
  statement whose first keyword is `VACUUM` (`INVALID_INPUT`, pointing at
  `db execute`), and PostgreSQL reads refuse `COPY` and `DO`: `COPY ... TO '<file>'` and `TO PROGRAM`
  write a server file or run a program inside a read-only transaction, and a `DO` block can run that `COPY`. MySQL reads refuse `SELECT ... INTO OUTFILE` / `INTO DUMPFILE` (a server file) and any `SET` (`SET GLOBAL` and `SET PERSIST` change the server), checked with and without backslash escapes so `NO_BACKSLASH_ESCAPES` can't hide one.
  Oracle reads refuse DDL (`WRITE_DISABLED`), because Oracle commits DDL inside a
  read-only transaction, and PL/SQL (`BEGIN`, `DECLARE`, `CALL`, `WITH FUNCTION`;
  `INVALID_INPUT`), because a block can commit, run DDL or an autonomous transaction;
  `test/db/oracle.test.ts` proves each keyword writes through `SET TRANSACTION READ ONLY`. Each denies one statement by name; it does not decide whether SQL
  writes, and everything else still relies on the engine. Add another such deny only
  for a statement proven to escape the engine's read-only mode, with a test showing
  the escape. A hole that can't be closed (SQLite's read-only `ATTACH` of other
  files, PostgreSQL's server-side functions such as `lo_export` for a privileged role, a MySQL procedure that commits and turns read-write itself,
  an Oracle stored function with an autonomous transaction called from a `SELECT`) is
  pinned with a test and documented as a known limit.
- **`execute` is all or nothing.** A script that starts or ends its own transaction
  is refused before any of it runs, so a mid-script `COMMIT` can't leave half a
  change applied.
- **Adding an engine:** write `src/core/db/<engine>/` implementing `DbProvider`,
  add it to `providers` in `src/core/db/engines.ts`, add its connection keys
  (optional in the zod schema in `src/areas/db/index.ts`, listed in the provider's
  `requires`, and secrets in the area's `secrets`), add a target to
  `test/db/targets.ts`, and add its section to `skills/toil/db.md` and its tile to
  the site's Databases group.
- **Cancellation:** a provider passes `call.signal` to its driver. SQLite's driver is
  synchronous and has no interrupt, so `src/core/db/sqlite/worker.ts` runs each job
  on a worker thread and terminates it on abort; that stops the statement at its
  next row. A statement that computes for a long time before producing a row keeps
  the thread busy until it finishes. Server engines should cancel on the server
  (`pg_cancel_backend`, a TDS attention, `KILL`), not just stop reading.
  PostgreSQL opens one connection per call and, on abort, sends
  `pg_cancel_backend(<pid>)` from a second short-lived one
  (`src/core/db/postgres/index.ts`); the abandoned call's own error is dropped,
  because core has already answered `TIMEOUT` or `CANCELLED`. MySQL sends
  `KILL <id>` (`src/core/db/mysql/index.ts`), ending the whole connection: a
  script goes one statement per round trip, so a `KILL QUERY` landing between two
  statements would stop nothing and the rest would commit. It also checks the
  signal before each statement and before `COMMIT`. MySQL sets the session as
  well as the transaction read-only, because DDL commits implicitly and would
  otherwise run in autocommit. Oracle sends
  `connection.break()` on the call's own connection (`src/core/db/oracle/index.ts`).
  Thin mode's break is in band, so the server hears it at its next check: a working
  statement stops at once, but `DBMS_SESSION.SLEEP` only when it wakes. Oracle's
  conformance target therefore uses a long cartesian count as its slow statement.

## Testing

- Database tests use `node:sqlite` in-process against a temp file per test
  (`test/harness/db.ts`). Tests against real PostgreSQL, MySQL and SQL Server run as
  CI service containers under `npm run test:integration`, which offline developers
  can skip.
- **Every provider passes the conformance suite**, `test/db/conformance.test.ts`:
  connections, schemas, describe, preview, query with row cap, paging and cancel,
  and read-only enforcement, all through `execute()`. It runs once per entry in
  `test/db/targets.ts`; a server engine's target seeds `SEED_SQL` into a fresh
  database and returns `skip` when its container isn't reachable. Engine-only
  behaviour (value conversion, file handling) goes in `test/db/<engine>.test.ts`.
- **A server engine's target** (PostgreSQL's is the one to copy) reads one URL
  from `TOIL_TEST_<ENGINE>_URL` (`TOIL_TEST_PG_URL`), defaulting to the CI service
  container's. `skip` probes it: unset and unreachable skips, so offline
  `npm test` stays green; set and unreachable throws, so a run someone asked for
  can't pass by skipping. `setup` creates a fresh database per test and seeds
  `SEED_SQL`; `cleanup` drops it. The target also returns `running()`, the count of
  toil's statements still executing on the server against that database, and the
  conformance suite polls it to 0 after a cancel and a time limit. That is how a
  server-side cancel is tested: the slow statement sleeps on the server without
  producing a row (`pg_sleep`, `SLEEP`, `WAITFOR DELAY`; on Oracle a cartesian count,
  since Thin mode's in-band break can't wake `DBMS_SESSION.SLEEP`), so
  only a real cancel stops it. Break the cancel on purpose once and watch both
  tests fail.
- **Engines that fold names.** A target can set `stored` (how an unquoted name is
  stored: Oracle upper-cases it), a per-database `defaultSchema` (Oracle's is the
  test user, one per test), and `sql.transactionControl` (the engine's own
  transaction statements); the suite reads expected names through them.
- **`npm run test:integration`** is `vitest run test/db/`. CI's `integration` job
  (`.github/workflows/ci.yml`) runs it on Linux with each server engine as a
  service container from its official image at a pinned tag, and sets each URL
  variable. A new engine adds its service and its variable to that job.
- The parity suite runs the `db` examples against a seeded SQLite file made by
  `test/fixtures/db.fixture.ts` (removed by its `cleanup`). The examples name the
  seed's tables (`people`, `teams`), so keep them in step with `SEED_SQL`. Parity
  sees no HTTP from the db area, so its "same requests" check is vacuous there; the
  conformance suite is what proves read-only.
- **Before opening a PR that touches a database provider, run it against the real
  engine locally in Docker.** Pull the same official image CI uses (`postgres`,
  `mysql`/`mariadb`, `mcr.microsoft.com/mssql/server`, `gvenzl/oracle-free`), seed
  it, and drive the actual `toil db` commands through both the CLI and MCP. Remove
  the containers afterwards. The PR names the image and tag and shows the output.
  Docker is a development tool here, never a runtime dependency: No Executables
  governs what toil ships, not how it's tested. The steps, with PostgreSQL:

  ```bash
  name=toil-test-postgres-$RANDOM   # unique, so parallel runs never collide
  docker run -d --name $name -e POSTGRES_PASSWORD=postgres -p 55437:5432 \
    --health-cmd "pg_isready -U postgres" --health-interval 2s postgres:17
  until [ "$(docker inspect -f '{{.State.Health.Status}}' $name)" = healthy ]; do sleep 1; done
  TOIL_TEST_PG_URL=postgres://postgres:postgres@localhost:55437/postgres npm run test:integration
  # ...then seed a database and drive node dist/toil.js db ... and toil mcp against it
  docker rm -f $name; docker ps -a --filter name=toil-test-postgres   # must list nothing
  ```

  MySQL and MariaDB share the `mysql` engine, and each has its own target and URL
  (`TOIL_TEST_MYSQL_URL`, `TOIL_TEST_MARIADB_URL`), so run both:

  ```bash
  r=$RANDOM
  docker run -d --name toil-test-mysql-$r -e MYSQL_ROOT_PASSWORD=mysql -p 53316:3306 \
    --health-cmd "mysqladmin ping -h 127.0.0.1 -pmysql --silent" --health-interval 2s mysql:8.4
  docker run -d --name toil-test-mariadb-$r -e MARIADB_ROOT_PASSWORD=mysql -p 53317:3306 \
    --health-cmd "healthcheck.sh --connect --innodb_initialized" --health-interval 2s mariadb:11.8
  # wait for both to be healthy, as above
  TOIL_TEST_MYSQL_URL=mysql://root:mysql@localhost:53316/ TOIL_TEST_MARIADB_URL=mysql://root:mysql@localhost:53317/ npm run test:integration
  docker rm -f toil-test-mysql-$r toil-test-mariadb-$r; docker ps -a --filter name=toil-test-m   # must list nothing
  ```

  Use a host port other than the engine's default, and remove the container even
  when something failed.
  SQLite has no server to run: `node:sqlite` is the real engine, so its in-process
  tests plus the built CLI and MCP driven against a real file stand in for this step.
