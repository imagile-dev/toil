# Plan

toil is a structured-JSON CLI and MCP server that gives AI agents and humans one
interface to the work around the code: enterprise tools, databases, and the codebase
itself.

## Approaches

- **One core, two front doors.** Every capability is a command in one .NET library,
  exposed as a CLI (`toil <area> <verb>`, JSON envelope on stdout) and as an MCP server
  (`toil mcp`, stdio). Tools are generated from the command definitions, so the two
  never drift.
- **Ship as a single binary.** Native AOT for win/linux/osx plus `dotnet tool install`.
  No runtime, no other CLI, no browser needed at use time.
- **Enterprise tools behind one auth bar.** Long-lived token pasted once, header or a
  plain-HTTP exchange, no interactive login. Env vars beat config files, always.
- **Databases, read-only by default.** Providers for SQL Server, PostgreSQL, MySQL and
  SQLite: list connections, test, list schemas, describe objects, preview rows, run a
  query with a row cap and paging, cancel. Writes need `--allow-write` on the call *and*
  `allowWrite` on the connection. Mirrors Rider's database toolset without the IDE.
- **Code intelligence without an IDE.** Roslyn `MSBuildWorkspace` for .NET solutions:
  symbol search, symbol info, find references, call hierarchy, diagnostics, rename,
  build and test with structured errors. This is what Rider's MCP does best; doing it
  headless means it runs in CI too.
- **Automated delivery from day one.** Conventional Commits → release-please → tagged
  release, published to GitHub Releases and NuGet. CI gate: build, format check,
  tests, AOT publish smoke.
- **Agent review loop.** Claude review on every PR submits a formal review;
  `CHANGES_REQUESTED` dispatches a fix agent that pushes to the branch. Opt-out label
  `no-auto-fix`, stop label `needs-human` after 3 rounds, explicit reviewer and bot
  allowlists, and agents never edit the rules that constrain them.
- **Triage with redaction.** Issues from outside are redacted (secrets, internal hosts,
  org names from a secret-only denylist) before any agent reads them.
- **Repo-internal skills.** `ship` (gate + PR), `new-integration` (the checklist below
  as a skill), `db-provider` (adding a database provider). One distributed skill for
  users.
- **Testing honesty.** Unit tests stub HTTP and use SQLite/Testcontainers for DB;
  each integration carries a `testing` level that only a live run can raise.

## Start

1. `.gitignore`, `README.md`, `CLAUDE.md` ← this change
2. Solution skeleton: `src/Toil.Core`, `src/Toil.Cli`, `src/Toil.Mcp`, `tests/`
3. CI + release-please + `ship` skill
4. First vertical slice: `db` area on SQLite and PostgreSQL, CLI + MCP, tests
5. Second slice: `code` area (symbol search, references, diagnostics)
6. Review/feedback/triage workflows
