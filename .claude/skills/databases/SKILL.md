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

## Testing

- Database tests use `node:sqlite` in-process. Tests against real PostgreSQL, MySQL
  and SQL Server run as CI service containers under `npm run test:integration`,
  which offline developers can skip.
- **Before opening a PR that touches a database provider, run it against the real
  engine locally in Docker.** Pull the same official image CI uses (`postgres`,
  `mysql`/`mariadb`, `mcr.microsoft.com/mssql/server`, `gvenzl/oracle-free`), seed
  it, and drive the actual `toil db` commands through both the CLI and MCP. Remove
  the containers afterwards. The PR names the image and tag and shows the output.
  Docker is a development tool here, never a runtime dependency: No Executables
  governs what toil ships, not how it's tested.
