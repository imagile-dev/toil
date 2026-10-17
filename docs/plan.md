# Plan

toil is a structured-JSON CLI and MCP server that gives AI agents and humans one
interface to the work around the code: enterprise tools, databases, and the codebase
itself. The principles behind every choice here are in [CLAUDE.md](../CLAUDE.md).

## Approaches

- **npm and Node, nothing else.** TypeScript bundled into one JS file, published as
  `@imagile-dev/toil` with no runtime dependencies and no install scripts. Works where
  executables are blocked: `npx -y @imagile-dev/toil mcp` is the whole setup. A CI gate
  fails on any native addon, binary or install script.
- **Windows, macOS and Linux, all first-class.** No shell spawning, `node:path` everywhere,
  LF in the repo, and the full CI gate on all three.
- **One core, two front doors.** Each command is defined once with zod schemas and
  exposed as a CLI (`toil <area> <verb>`, JSON envelope on stdout) and as an MCP tool
  (`toil mcp`, stdio). The two never drift. The CLI is primary; MCP is the alternative,
  in the same package, in-process, and never listening on a port.
- **MCP gateway, later and separate.** A shared Streamable HTTP endpoint with mandatory
  auth, shipped as its own opt-in package on the same core
  ([design note](mcp-gateway.md), issue #4). Not v1.
- **Migration by find-and-replace.** Integration commands, flags, envelope fields
  and env var names match the predecessor CLI's frozen surface
  ([command contract](command-contract.md)), so moving a skill or script is one
  case-insensitive replace. A test diffs the two. Config is rebuilt keychain-first and
  imported once with `toil config import`.
- **Enterprise tools behind one auth bar.** Long-lived token pasted once, header or a
  plain-HTTP exchange, no interactive login. Env vars beat config files, always.
- **Databases, read-only by default.** Pure-JS drivers for PostgreSQL, MySQL, SQL
  Server, SQLite (built into Node) and Oracle (Thin mode). List connections, test,
  list schemas, describe objects, preview rows, run a query with a row cap and paging,
  cancel. Writes need a standing opt-in on the connection and `--allow-write` on the
  call. Covers what an IDE's database tools give an agent, without the IDE.
- **Code intelligence without executables.** Semantic answers for TypeScript and
  JavaScript from the TypeScript language service; syntax-level answers for every
  other language from tree-sitter WASM grammars; optional semantic answers from a
  JetBrains IDE's MCP server over localhost when one is running. Every result is
  labelled with its precision.
- **Automated delivery from day one.** Conventional Commits → release-please → npm
  publish with provenance. The release also attaches the packed `.tgz` to the GitHub
  release for offline and mirrored installs. CI gate: typecheck, lint, tests, build,
  purity check, and a smoke run of the packed tarball on Node 22 and 24.
- **Agent review loop.** An agent reviews every PR and submits a formal review;
  `CHANGES_REQUESTED` dispatches a fix agent that pushes to the branch. Opt-out label
  `no-auto-fix`, stop label `needs-human` after 3 rounds, explicit reviewer and bot
  allowlists, and agents never edit the rules that constrain them.
- **Triage with redaction.** Issues from outside are redacted (secrets, internal hosts,
  org names from a secret-only denylist) before any agent reads them.
- **Repo-internal skills.** `ship` (gate + PR), `integrations`, `databases`,
  `code-intelligence`, `mcp`, `secrets`, `automation`. One distributed skill for users.
- **Testing honesty.** Unit tests stub `fetch` and use `node:sqlite`; real database
  engines run as CI service containers. Each integration carries a verification level
  (`unit` → `integration` → `live`) that the unit suite alone can never raise.

## Start

1. `.gitignore`, `README.md`, `CLAUDE.md`, this plan, the integrations list
2. Package skeleton: `src/core`, `src/cli.ts`, `src/mcp`, tsup bundle, `check:pure`
3. CI + release-please + `ship` skill
4. First vertical slice: `db` area on SQLite and PostgreSQL, CLI + MCP, tests
5. Second slice: `code` area (TypeScript semantic, tree-sitter syntactic)
6. Review/feedback/triage workflows
