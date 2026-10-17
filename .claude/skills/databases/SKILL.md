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
  error code, never from reading the SQL.
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
  (`pg_cancel_backend`, a TDS attention, `KILL QUERY`), not just stop reading.

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
  governs what toil ships, not how it's tested.
  SQLite has no server to run: `node:sqlite` is the real engine, so its in-process
  tests plus the built CLI and MCP driven against a real file stand in for this step.
