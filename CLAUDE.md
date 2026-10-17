# CLAUDE.md

## Project

toil is a structured-JSON CLI and MCP server, owned by Imagile, that gives AI agents
and humans one interface to enterprise tools, databases, and codebases. TypeScript on
Node.js (22 LTS or later), published to npm as `@imagile-dev/toil`.

Who it is for, in priority order:

1. **Engineers at locked-down organizations** who install it themselves from npm and
   let an agent drive it. Every default is chosen for them.
2. **A stand-in for vendor MCP servers** that are blocked, need an OAuth login, or
   don't exist. `toil mcp --areas <list>` replaces one vendor server with one config
   entry.
3. **CI pipelines and headless agents**, configured entirely through env vars.

## Principles

The rules in this file are consequences of a few principles. When a rule and a
situation disagree, or a case is not covered, reason from the principle.

**When feedback or a correction arrives, find the principle under it before changing
anything.** Add or sharpen the principle here, then update every rule that follows
from it, not only the one instance that prompted it. A fix with no principle recorded
gets made again in the next place it applies.

1. **Adoptable inside a locked-down enterprise.** Installs from npm, runs on Node, and
   needs nothing else: no executable, no native library, no other CLI, no browser
   login. The only things a security team should need to approve are Node and one npm
   package. → No Executables, the Authentication Bar, no hardcoded hosts,
   placeholders that never resolve.
2. **Safe by default when an agent is driving.** Reads are free. Anything that writes,
   to a database, an enterprise tool, or the codebase, needs a human's standing opt-in
   in config plus an explicit flag on the call. Agents never loosen the rules that
   constrain them, and humans merge. → Writes, Databases, rename preview, MCP Server,
   Automation.
3. **One command does one thing against one source; the caller composes.** No
   aggregate command that decides on the caller's behalf which services to ask. →
   dependency analysis split by source, stdin / `--from` composition.
4. **Honest about what is known.** Every result says where it came from and how
   precise it is; every integration says how far it has been verified. → Verification
   Levels, `precision` on code results, source on every finding.
5. **The environment wins without editing files.** CI and agents configure through
   env vars that override anything on disk. → Configuration Precedence.
6. **This repository stands alone.** Docs, code and skills never name another
   repository or another CLI as a reference, ancestor or comparison.
7. **Never break what users already rely on silently.** Config on disk, flags, the
   JSON envelope and precedence are contracts; changing them is a declared,
   documented breaking change. → Output Contract, Delivery.
8. **Same behavior on Windows, macOS and Linux.** None is second-class; a feature
   that works on one and not the others is not done. → Cross-Platform.
9. **toil talks only to what the user pointed it at.** No telemetry, no update checks,
   no call home. The only network traffic is to hosts in the user's config, or to a
   public API that a command the user ran names in its own name (`toil osv vulns`).

## Cross-Platform

*Principle 8.* Windows, macOS and Linux are all first-class.

- Build paths with `node:path` and resolve home with `os.homedir()`; never hardcode a
  separator, a drive letter, or `~`. Paths in JSON output use forward slashes;
  paths on disk use the platform's own form.
- Never spawn through a shell (`shell: true`, `exec`), and never assume bash,
  PowerShell, or a POSIX utility. The only spawns allowed are the OS credential
  stores under **Secrets**, each behind a platform check.
- Read files as UTF-8 and accept both CRLF and LF; write LF. `.gitattributes` keeps
  the repo LF so Windows checkouts produce identical bundles.
- Config lives in `~/.toil/` on every platform, so instructions are identical.
- CI runs the full gate on `windows-latest`, `macos-latest` and `ubuntu-latest`, on
  Node 22 and 24. A test that is skipped on one platform says
  why in its name.

## No Executables

*Principle 1.* toil runs as JavaScript on the user's existing Node runtime and nothing else. Many
organizations block unsigned or unapproved executables and native libraries but allow
Node, and toil has to work there. This is the most important rule in the repo.

- Every runtime dependency is pure JavaScript or WebAssembly. No native addons (`.node`
  files), no `node-gyp`, no `prebuild`, no package that downloads a binary on install,
  no `install` / `postinstall` scripts.
- toil never spawns a bundled or downloaded binary. Spawning a program the OS already
  ships is allowed only for opt-in credential storage (see **Secrets**).
- The published package is one bundled JS file plus `package.json`, with no runtime
  `dependencies`. It installs with `npm install --ignore-scripts` and runs offline.
- CI enforces it on what ships, not on the dev toolchain:
  - `npm run check:pure` fails if `package.json` has runtime `dependencies` or any
    install/prepare script, or if the bundle imports anything but Node built-ins.
    That's read from esbuild's metafile, never by scanning text. It also fails on
    `child_process` or a native addon, or if the tarball holds anything beyond
    `dist/toil.js`, `package.json`, `README.md`, `LICENSE` and `NOTICE`.
  - `npm run smoke` installs the packed tarball with `--ignore-scripts` into a
    throwaway prefix and drives the installed bin through the CLI and MCP.
- Bundled dependencies can drag in a spawning API (commander imports `child_process`
  for subcommands toil never uses). The build resolves `child_process` to
  `src/shims/no-spawn.ts`, a stub that throws. Keep it that way; if a future area
  genuinely needs the OS credential store, it gets its own narrowly scoped module
  and the gate gains an explicit, reviewed exception.

Before adding a dependency, check it against this rule. If the only good library is
native, find a pure-JS or WASM alternative or implement the protocol directly.

**Dependencies are pinned exactly** (`.npmrc` sets `save-exact`) and must be at least
14 days old when added or bumped, so a compromised release has time to be caught
before it lands here. Everything lives in `devDependencies`, because it all gets
bundled. npm 11.5's resolver can crash (`Cannot read properties of null (reading
'edgesOut')`) when resolving this tree from scratch. Installs from
`package-lock.json` are fine, so keep the lockfile, and if a fresh resolve crashes,
add the new package with `--legacy-peer-deps` and confirm `npm ls` reports no
invalid peers.

The rule protects what users install, so it covers the published package and its
runtime dependencies. `site/` is a separate private package that only ever builds in
GitHub Actions; its build tooling is out of scope.

## Layout

- `src/core/` — the machinery: `defineArea`, `defineCommand`, `execute`
  (validation, connection, write gate, envelope), errors, config loading
- `src/areas/<area>/index.ts` — one folder per area, exporting `area` and
  `commands` (standalone commands export only `commands`)
- `src/registry.ts` — every shipped area and command, read by both front doors. It
  imports `src/areas.generated.ts`, which `scripts/gen-areas.mjs` writes before
  typecheck, build and tests and git ignores. **Areas register by existing:** adding
  one never edits a shared list, so parallel area PRs don't conflict.
- `src/program.ts` — builds the CLI from the registry; `src/cli.ts` is the bundle
  entry that wires it to the real process
- `src/mcp/` — the MCP server (`toil mcp`, stdio); tools generated from the registry
- `src/shims/` — build-time stand-ins (the no-spawn stub)
- `src/**/*.test.ts`, `test/` — Vitest; `test/harness/` holds the shared fakes,
  `test/fixtures/` one `<area>.fixture.ts` per area plus the test-only demo commands
- `scripts/` — the purity gate, the tarball smoke test, contract capture
- `skills/toil/` — the one skill shipped to users; `SKILL.md` indexes per-area files
- `.claude/skills/` — repo-internal skills only
- `docs/` — plans and decisions
- `site/` — the GitHub Pages site (Astro), its own private package; see **Site**

An area is declared once with `defineArea({ name, connection, secrets, defaults,
fallbacks, renamed })`: `connection` is the zod schema of what a connection to it
holds. Its commands come from `area.command({ ... })`: a path, a zod input schema,
whether it writes, CLI arguments and flags (each mapped to an input field), and at
least one example input. Core adds the `connection` input (`--connection <name>`)
to every area command. A write command spreads `allowWriteField` into its input.
Commands with no area and no config (`version`) use `defineCommand`. The CLI and MCP
surfaces never implement behavior of their own; if one needs something the other
lacks, the gap is in core.

**Commands never read config.** `run` gets `ctx.connection`, the one connection this
call resolved, validated and typed from the area's schema, and a context with no
`config` at all, so no area can reach another area's or another connection's
credentials. ESLint bans importing config under `src/areas/`.

## MCP Server

`toil mcp` serves over stdio. `--areas jira,confluence` limits it to those areas, so
an agent sees a small, focused tool list and one config entry stands in for one vendor
server. With no `--areas`, it serves every area that has config, plus `standalone` commands that need none (like `version`). Write tools are not
registered at all unless at least one of the area's connections has writes
enabled (see **Writes**), so an agent cannot discover them, let alone call them.
Listing grants nothing: every call is still gated against the connection it
resolves.

The server is built on the SDK's low-level `Server`, not `McpServer.registerTool`,
because `registerTool` validates arguments before our code runs: it drops unknown
fields and answers a missing one with plain text. toil advertises each tool's strict
JSON Schema and passes raw arguments to `execute()`, which is the only validator, so
bad input gets the same envelope through MCP as on the CLI. The server takes a
context *factory*, called per tool call with the command and that call's cancel
signal; never share one context across calls. Both front doors run commands through
`runCommand()`, which turns a failure building the context (config that broke while
the server was up) into an envelope too. Tool descriptions are written for a model
choosing between tools: what it returns, when to use it, and which sibling tool to use
instead.

## Build & Test

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm test            # Vitest
npm run build       # tsup → dist/toil.js, single bundle
npm run check:pure  # the No Executables gate (after build)
npm run smoke       # install the tarball with scripts off; drive CLI and MCP (after build)
```

All six pass before a PR opens. CI runs them on Windows, macOS and Linux, on Node 22
and 24.

## Output Contract

Every command writes exactly one JSON envelope to stdout: `{ ok, data, error, meta }`.
Errors are a `ToilError` with a code and a fix the user can act on, never a raw
stack trace. Logs and progress go to stderr. Removing or renaming a field in `data` is
a breaking change.

- **Usage errors are envelopes too.** An unknown command or flag, or a missing
  argument, gets an `INVALID_INPUT` envelope on stdout (`runProgram` in
  `src/program.ts`). Only `--help` and `--version` print plain text.
- **`--verbose` adds `meta.requests`**: method, URL with credentials redacted, status
  and timing for every request. It never includes headers or bodies.
- `--verbose` lives in core: `execute()` hands every command an instrumented
  `ctx.fetch`, so no command implements it and no front door can forget it. Commands
  under `src/areas/` may not call `fetch` directly, and ESLint enforces it.
- **Input is strict.** `execute()` parses with the schema's `.strict()`, so an
  unknown or misspelt field is `INVALID_INPUT` through MCP exactly as an unknown flag
  is on the CLI. Never silently ignore a field.
- **`meta.warnings`** carries things worth saying that aren't failures (a reserved
  config key, a truncated result), from config loading or a command's `ctx.warn()`.
  **`meta.page`** is `{ nextCursor, limit }`, set with `ctx.setPage()` by any command
  that pages. Both are absent when empty.
- **Every command has a time limit and can be cancelled.** `execute()` aborts at
  `TOIL_TIMEOUT_MS` (default 120 s) with `TIMEOUT`, and on Ctrl+C or an MCP cancel
  with `CANCELLED`. Commands pass `ctx.signal` to anything long-running that isn't
  `ctx.fetch` (which already carries it). Aborting stops toil waiting, not the
  server: for a write command both errors say the change may already have been
  applied, and to check before retrying. Never word them as "stopped" for a write.
  `toil mcp` exits on the first Ctrl+C.
- **Error codes are an open set.** New codes may appear in any release; callers
  branch on the ones they know and treat the rest as a generic failure. Removing or
  repurposing a code is breaking.
- **There is no `--dry-run`.** It was dropped as low value for its complexity: it
  could only intercept HTTP writes, and showed only the first of several. Writes
  are governed by the two-step gate under **Writes** and nothing else.

## Configuration Precedence

Config is a set of named **connections**, each one instance of an area's service
(`"corp-jira": { "area": "jira", "baseUrl": ... }`), plus per-area **defaults**
(`"defaults": { "jira": { "connection": "corp-jira", ... } }`): `connection` names
the area's default connection, and any other key is shared by every connection to
that area. A value on a connection resolves from, highest first:

1. `TOIL_CONN_<NAME>_<KEY>`, for that connection
2. `TOIL_<AREA>_<KEY>`, for the area's default connection only
3. A well-known CI-provided variable the area declares (`fallbacks`), for its default
   connection, only where the service's own tooling treats it as canonical
   (`GITHUB_TOKEN`, `SYSTEM_ACCESSTOKEN`). Never invent one.
4. The connection in `~/.toil/config.json`, or the file passed with `--config`
5. `defaults.<area>` in that file
6. The area's provider defaults (`defineArea({ defaults })`, e.g. a port)

Each call uses one connection: `--connection`, otherwise the area's default (named in
`defaults`, else the one named after the area, else the only one). Several and no
default is an `INVALID_INPUT` with a fix, never a guess. `TOIL_CONN_<NAME>_AREA`
creates a connection with no file at all, which is how CI defines one; an area with
no connection gets one named after it from `TOIL_<AREA>_*`. Connection names are
lowercase letters, digits and single hyphens, so each maps to exactly one env form;
variables match the longest connection name first, and one naming no connection is
a warning. Env strings are coerced to the schema's types (`"5432"` to a number), keys
an area doesn't declare are dropped with a warning, and renamed keys still work, with
one.

CI must be able to override anything without editing files. Lowering env-var priority
for any field is a breaking change. Anything that rewrites the global config carries
through keys it did not prompt for.

**There is no repository-level config file, and there won't be one.** Anyone who
can push to a repo, or an agent editing the working tree, could use such a file to
switch on writes or send the user's credentials to a host of its choosing
(*principles 2 and 9*). Hosts, credentials and `writes` come only from env vars and
the user's own config. Knowledge about a body of work (its repos, Jira keys and
fields, boards, environments) belongs in the user's dossiers, which hold no secrets
and no hosts and name connections instead.

Env var names map onto areas through the registry, using the longest match, so
`TOIL_JIRA_CLOUD_TOKEN` is `jira-cloud.token`, not `jira.cloudToken`. A `TOIL_*` name
that matches no registered area is ignored, never guessed at, so a variable can't
change meaning when an area is added. `envName()` and `parseEnvName()` in
`src/core/config.ts` are the only places the mapping lives. These names are reserved
and never map onto an area: `TOIL_CONN_*`, `TOIL_DOSSIER`, `TOIL_ENV`, `TOIL_CONFIG*`,
`TOIL_TIMEOUT_MS`.

**The config file is versioned.** `"version"` is a whole number; a file without one
is version 1. Every format change adds a step to `migrateConfig()` with a test, so an
old file always loads. A file from a newer toil is refused with an upgrade fix rather
than half-read. Version 1 is a map of area to settings and reads as one connection
per area, named after it and set as its default. Version 2 holds `connections` and
`defaults`; using them needs `"version": 2`. Standalone commands (`version`) don't
load config at all, so a broken or newer file can't stop a user finding out which
toil they have.

## Authentication Bar

An enterprise integration authenticates with a long-lived credential the user
generates once in the vendor's UI and pastes into an env var or config. toil gets from
it to an authenticated request with no interactive step: a header, or a plain-HTTP
exchange for a short-lived token that toil caches in memory and never writes to disk.

Out of scope regardless of usefulness: interactive OAuth, SSO/SAML/OIDC at use time,
username + password, app registrations for client credentials, cloud IAM chains, mTLS,
and anything that shells out to another CLI for a token. If that is a tool's only auth,
decline and name the blocking mechanism.

No hardcoded vendor base URLs; every host is user-supplied.

## Writes

*Principle 2.* Every command that changes something outside the local machine —
creating or transitioning an issue, commenting on a PR, writing a row — needs both:

1. `writes: true` on the connection the call resolves, set by a human, and
2. `--allow-write` on the call.

Without either, the command fails with a `ToilError` naming the missing one and the
connection. `writes` is per connection, so writes can be on for a sandbox and off
for production; it is never read from `defaults.<area>`. Env vars can enable writes
for CI (`TOIL_CONN_<NAME>_WRITES=true`, or `TOIL_<AREA>_WRITES=true` for the
default connection), following normal precedence.
Deletes are never exposed through MCP.

## Databases

- **Read-only by default**, per **Writes**: `writes: true` on the connection and
  `--allow-write` on the call.
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
- Providers live in `src/core/db/<engine>/`. Adding one follows the `db-provider` skill.

## Code Intelligence

`code` commands answer questions about a codebase (symbol search, symbol info,
definitions, references, call hierarchy, diagnostics, rename preview) without
executables. Each result says how precise it is:

- `semantic` — TypeScript and JavaScript, via the TypeScript compiler's language
  service, which is pure JS. The MCP server keeps one warm per project.
- `syntactic` — every other language (C#, Java, Python, Go, SQL, …), via tree-sitter
  grammars compiled to WebAssembly (`web-tree-sitter`). Definitions and outlines are
  exact; references are name-matched and say so.
- `ide` — when the user has a JetBrains IDE open with its MCP server enabled, `code`
  can query it over localhost HTTP for semantic answers in any language the IDE
  understands. Opt-in per project, never required, and off when the IDE isn't running.

Results carry file, line and column. Rename previews by default and applies with
`--apply`. Building and testing are left to the project's own toolchain; toil does not
wrap them.

## Secrets

Secrets resolve from env vars, then keychain references, then plaintext config.
Keychain storage is opt-in and uses only what the OS already ships (`security` on
macOS, PowerShell on Windows, `secret-tool` on Linux). Secrets travel to that process
on stdin, never argv. An unresolvable reference is treated as unset, never sent as a
literal. Nothing may require the keychain.

## Adding an Enterprise Integration

Confirm the Authentication Bar first. Then, in one change: `src/areas/<area>/` with
its `defineArea` (connection schema, secrets, CI fallbacks) and its commands, a
`test/fixtures/<area>.fixture.ts`, `config init`/`check`/`test` entries,
`skills/toil/<service>.md`, and its row in `SKILL.md`. The
`new-integration` skill holds the checklist; a test fails when a registered service
has no skill file.

### Verification Levels

*Principle 4.* Every integration and database provider records how far it has been
verified, shown in `toil config check` and the skill docs:

| Level | Means | How it is raised |
|-------|-------|------------------|
| `unit` | Logic tested with stubbed `fetch`; skill doc written | The minimum to merge |
| `integration` | Automated tests pass against a real instance (a CI service container or a sandbox tenant) | A PR adding those tests to `npm run test:integration` |
| `live` | Used against a real organization's instance in day-to-day work | A PR saying what was run, against what kind of instance |

Never raise a level on the strength of the unit suite.

A command talks to one service. Do not build an aggregate command that fans out to
several sources; give each source its own area and let them compose through stdin or
`--from <file>` (see the dependency-analysis section of `docs/integrations.md`).

Where a vendor ships self-hosted and SaaS with diverging APIs, implement the
self-hosted shape and only that.

## Testing

Tests never need the network: a developer offline gets the same result as CI.

- **Mock HTTP with `fakeFetch`** (`test/harness/fake-fetch.ts`), injected through
  `Context.fetch`. A request with no route throws, so a test can't pass against a
  real server by accident. Every integration test asserts both sides: the exact
  request toil sent (method, URL, headers, body) and how the canned response was
  reshaped. Build contexts with `testContext()`; run the real CLI in-process with
  `runCli()`; connect a real MCP client over an in-memory transport with
  `connectMcp()`.
- **Canned responses are shaped like the real API**, captured from a live instance
  where possible and sanitized to placeholders (see **Placeholders**). A response
  invented from the docs is labelled as such in the fixture.
- **The CLI and MCP stay 1:1 because `test/parity.test.ts` proves it.** It walks
  every registered command, one suite per area, and checks:
  - one tool per command, with an identical, strict JSON Schema
  - every input field reachable from the CLI and vice versa, and set by at least
    one example
  - for every example, identical envelopes and identical HTTP requests through both
    front doors, and only GET/HEAD/OPTIONS from a command that doesn't write
  - an unknown field refused as `INVALID_INPUT` on both sides before any request
  - a config failure building the context gives the same envelope on both sides
  - per area, `--connection <name>` and MCP's `connection` field selecting the same
    connection, and an unknown connection refused the same way
  - for every write command, the write gate holding on both sides

  New commands are covered on registration; never add a command without examples,
  and never exempt one from this suite. When changing the harness, prove the suite
  still bites: break the mapping on purpose and watch it fail.
- **Each area has a fixture**, `test/fixtures/<area>.fixture.ts`, exporting
  `defineFixture({ area, routes, config })`: canned responses for every request its
  examples send, and a config keyed by area (read as one connection named after the
  area, as a version 1 file is) with credentials set and writes on. The suite finds it
  by file name and fails when a registered area has none.
- `test/fixtures/demo-commands.ts` holds test-only commands (a read and a write
  against a fake API) that exercise the harness before real integrations exist.
  They're never registered in the shipped CLI.
- Database tests use `node:sqlite` in-process. Tests against real PostgreSQL, MySQL
  and SQL Server run as CI service containers under `npm run test:integration`,
  which offline developers can skip.
- **Before opening a PR that touches a database provider, run it against the real
  engine locally in Docker.** Pull the same official image CI uses (`postgres`,
  `mysql`/`mariadb`, `mcr.microsoft.com/mssql/server`, `gvenzl/oracle-free`), seed
  it, and drive the actual `toil db` commands through both the CLI and MCP. Remove
  the containers afterwards. Docker is a development tool here, never a runtime
  dependency: No Executables governs what toil ships, not how it's tested.
- Fixtures use placeholder hosts.

## Code Comments

Comments explain *why*, and they're also the one place toil is allowed to be funny.
The voice is deadpan bureaucratic satire: the flat, mock-official tone of a compliance
notice, aimed at the paperwork toil exists to route around. For example:

```ts
// Approval to spawn a process requires a change ticket, a CAB slot and a
// sponsor who has since left the company. We skipped the queue by never asking.
```

- **The explanation comes first and stands alone.** Delete the joke and the comment
  still tells the next engineer what they need. A joke never replaces a reason.
- **Aim at the bureaucracy, never at people.** Not at users, their employers, a real
  company or vendor, a colleague, or the reader. Stand-ups, CAB, RACI matrices,
  spreadsheets of record and tickets about tickets are all fair game.
- **One dry line, not a bit.** Understatement over exclamation marks; no emoji, no
  "lol". Most comments have no joke at all, and that's fine.
- **Comments only.** None of it goes on the site, in `--help` text, error messages,
  `fix` hints, the JSON envelope, MCP tool descriptions, docs, skills, commit
  messages or PR descriptions. Those are read by people mid-task, or by models
  choosing a tool, and both deserve a straight answer. The site keeps its own,
  gentler register (see **Site**).

## Placeholders

Never commit a real hostname, tenant ID, account, or connection string from any
environment — not in code, tests, docs, issues, or PRs. Self-hosted services use
`<service>.imagile.dev`; SaaS keeps the vendor domain with `imagile` as tenant; opaque
IDs use `abc12345` or `abc12345-0000-0000-0000-000000000000`; email uses
`you@example.com`. Never add wildcard DNS to `imagile.dev`.

## Delivery

- Conventional Commits: `fix:`, `feat:`, `feat!:` with a `BREAKING CHANGE:` footer
  that says why and how to migrate. release-please builds the changelog from them.
- **Every major item starts with a GitHub issue, created before the branch.** Keep it
  concise: a short paragraph on what and why, and one "Done when" line.
  - **What counts as a major item:** the foundation, the site, the gateway,
    dossiers, **each integration area** (labelled `integration`) and **each database
    provider** (labelled `database`).
  - **What never gets its own issue:** individual commands or features inside an
    area. They're part of their area's issue, never sub-issues.
  - **Data Center/Cloud pairs** are labelled `data-center` and `cloud` and link to
    each other. The Cloud issue starts after its Data Center issue.
  - **PR links:** many PRs can serve one issue. They use `Refs #n`, and the PR that
    finishes it uses `Closes #n`.
- Branches: `kolatts/<issue#>-<description>`.
- **Releases** come from release-please (`.github/workflows/release.yml`): Conventional
  Commits on `main` become a release PR, and merging it, which is always a human's
  call, tags, publishes `@imagile-dev/toil` to npm with provenance, attaches the
  tarball to the GitHub release, and posts to Discord, loudly if the publish fails.
  Publishing uses the `NPM_TOKEN` secret until npm trusted publishing is configured
  for the package, then OIDC with no token.
- PRs are vertical slices (core → CLI → MCP → tests → skill doc), sized large enough
  to avoid process overhead, fully verified before opening. Use the `ship` skill.
- Before changing behavior users rely on, check config already on disk, existing
  flags, the envelope, and precedence. Say what you checked in the PR.
- **The PR description describes the PR as it is now, not as it was opened.**
  Reviewers, the review bot and the squash commit all read it, so a description
  that lags the code misleads all three. Rewrite it (`gh pr edit --body-file`)
  after every review round you act on and every change in direction: what it
  does, what was verified and on what, test counts, and what's still open. Don't
  append a changelog of rounds; the commits and review threads already hold that.
- **Every PR carries proof a human can check of how it was verified locally**, not
  just the claim "tests pass". Include:
  - **The gate results**: the summary lines from typecheck, lint, test, build,
    `check:pure` and `smoke`, with the OS and Node version.
  - **Real runs**: the commands you ran against real things, with their output.
    That means the CLI, and the MCP server driven by a real agent client (the
    local Codex CLI), with the envelopes they returned, sanitized to placeholders.
  - **Databases**: for a database provider, its run against the engine in Docker
    (see **Testing**), including the image and tag.
  - **Screenshots** for anything visual (see **Site**).
  - **What wasn't verified**, said plainly, and why.

  Refresh the proof whenever the description is rewritten.

## Automation

An agent reviews every PR and submits a formal review. `CHANGES_REQUESTED` dispatches
a fix agent that pushes to the PR branch. A human merges every PR, including the
release PR; no agent merges, approves its own work into `main`, or enables auto-merge.

- **The review** is `.github/workflows/claude-review.yml`. It runs on same-repo,
  non-draft PRs from humans and `claude[bot]`, authenticated by the
  `CLAUDE_CODE_OAUTH_TOKEN` secret.
  - It acts as the **Imagile Bot GitHub App** (`imagile-bot[bot]`), with a token
    minted per run from the `IMAGILE_BOT_APP_ID` variable and the
    `IMAGILE_BOT_PRIVATE_KEY` secret. The token gets read-only contents plus
    pull-request and issue writes. The workflow's own `GITHUB_TOKEN` stays
    read-only. Formal APPROVE needs no extra repo setting, because that setting
    only gates `GITHUB_TOKEN`. The App can't approve its own PRs, so those are
    skipped.
  - It reviews against this file and can run the gate (`npm test`, `typecheck`,
    `lint`, `build`, `check:pure`), so findings are backed by inputs it ran.
  - A last step fails the job if no formal review by the bot landed on the head
    commit, so a silent agent can't read as green.
  - Subagents are disallowed, because in headless mode they get killed when the turn
    ends. Bash allow-rules with a mid-pattern `*` use the trailing-space form.
- **Every action is pinned to a full commit SHA**, with its version as a trailing
  comment (`uses: actions/checkout@<sha> # v4.4.0`), in every workflow. Tags can be
  moved after review; SHAs can't, and these jobs hold tokens. A new or bumped pin must
  be a release at least 14 days old, so a compromised release has time to be caught
  before it runs here with those tokens.
- **The fix agent** (`claude-pr-feedback.yml`) isn't wired yet. App-authored reviews
  raise `pull_request_review` events, so when it lands it triggers on a
  `CHANGES_REQUESTED` review from `imagile-bot[bot]` directly. That bot must be named
  in its reviewer allowlist and in `allowed_bots`, never `*`.

- `no-auto-fix` label: the fix agent leaves the PR alone.
- `needs-human` label: set after 3 pushed rounds; the loop stops.
- Only `OWNER`/`MEMBER`/`COLLABORATOR` reviews and explicitly named bots trigger it.
  Never use `allowed_bots: "*"`.
- The fix agent never edits: `on:` triggers, actor allowlists, `permissions:`, token
  minting inputs, secrets, `uses:` pins, agent prompts and tool allowlists, or new
  `run:` steps in agent workflows. Agents do not edit the rules that constrain them.
- Externally filed issues are redacted (secrets, internal hosts, private IPs, org names
  from the `REDACT_TERMS` secret) before any agent reads them. The denylist lives only
  in that secret.

### Discord

A Discord channel follows the project through one webhook, the `DISCORD_WEBHOOK`
repository secret. Without the secret, every notify step logs a skip and exits 0, so
forks and fresh clones never fail on it.

- `.github/workflows/discord-notify.yml` posts every issue as it opens and closes.
  Each post sets `username: toil` and its avatar from
  `https://imagile-dev.github.io/toil/brand/toil-avatar-512.png`, so moving or
  renaming that file breaks the bot's avatar.
- `.github/workflows/release.yml` posts each npm publish (version, release
  notes, npm link). It **also posts loudly when a publish fails**, because a silent
  publish failure is the one that goes unnoticed. Both steps are non-fatal:
  `|| echo "Discord notify failed (non-fatal)"`.
- Event text such as issue titles reaches the script through `env:` and goes into the
  payload with `jq --arg`, never by interpolating `${{ }}` into `run:`. An issue
  title is attacker-controlled.

## Site

`site/` is an Astro site deployed to https://imagile-dev.github.io/toil/ by
`.github/workflows/pages.yml` (it builds on every PR that touches `site/` and deploys
from `main`).

- **Always mobile responsive.** The site is read wherever a shared link lands, and
  that is often a phone, so a page that only works on a desktop isn't finished, the
  same way *principle 8* treats platforms. Every page and component works from 320px
  up with a 16px side gutter: nothing scrolls sideways, text stays readable without
  zooming, standalone tap targets (buttons, nav and footer links, "see all" links; not
  links inside a sentence) are at least 44px tall, and multi-column layouts collapse to one
  column. Wide content (code, tables) scrolls inside its own container, never the
  page. Grid children get `min-width: 0` so one long line can't widen the layout.
- **Dark only.** It uses the Imagile design system's bones (type, grid, spacing,
  drafting-style iconography) in a dark finish with toil's own, brighter palette:
  all warm, with a flame-to-amber accent gradient and amber on its own for values,
  "live" states and small highlights, as tokens in `site/src/styles/global.css`.
  There's no second hue: no green, teal, blue or purple, in the site or in
  generated art. No light palette, no theme toggle. The background stays
  `#16130f` because the generated art is painted on it.
- **Imagile is credited prominently**: a byline in the header, a linked "By Imagile"
  in the hero eyebrow, and a feature panel in the footer, all pointing to
  https://www.imagile.dev. Imagile's mark keeps its own colours.
- **Honest about status** (*principle 4*). Until a version is on npm, the site says
  pre-release, labels sample output as planned, and marks every integration
  `planned`. Statuses on `/integrations/` use the same levels as **Verification
  Levels**, plus `planned`.
- **One source per fact.** `site/src/data/integrations.ts` and `docs/integrations.md`
  change together; `site/src/data/principles.ts` restates the **Principles** above for
  users and keeps their numbering.
- **Motion everywhere, never required.** Every animation sits behind
  `prefers-reduced-motion: no-preference`, and scroll reveals only hide content after
  `motion.js` has armed them, so with no JS or reduced motion everything is visible.
  A reveal never clips the observed element itself (a fully clipped element never
  intersects, and a lazy image inside it never loads); clip its children.
- **House style has three registers; pick by job, never mix them in one image.**
  - *The mark* is toil's logo, and the central integrator drawn literally. A
    terminal (a sheet with a `>_` prompt) is the hub. Three branches leave each
    side of it and fan out to six tools, dots on an outer ring at 0° and 38° either
    side of horizontal. It's flat, symbolic, serious, and hand-built SVG: the
    component is `site/src/components/Logo.astro`, the static copies are
    `public/favicon.svg` and `public/brand/toil-avatar.svg` (circular, with
    transparent corners, exported to 512 and 256 PNG for avatars). All three share
    one geometry; change them together. It never comes from an image model, and
    has no characters and no jokes.
  - *Its motion is "Command".* The ring and branches draw in, and the tools pop
    on. Then, every 4.5s, the cursor types two keystrokes, a signal fires down all
    six branches at once, and each tool bumps as it arrives. The motion is pure
    CSS, so reduced motion turns it off.
  - *Diagrams* are precise drafting-style line drawings for how-it-works art (the
    hero), generated with `.claude/image-generation/style.md`.
  - *Cartoons* are lighthearted spot illustrations, generated with
    `.claude/image-generation/style-cartoon.md` (pass `--style-file`). The recurring
    character is the crate, a package box in an amber-striped hard hat. The crate is
    always competent; the joke is on the bureaucracy around it, never on users or
    their employers.
- **Generated art** sits on the page colour `#16130f` (or darker) and shows with
  `mix-blend-mode: lighten` on its wrapper, so the grid shows through. Ship WebP at
  960 and 1536 wide; the PNG masters stay in the ignored run folders. Every cartoon
  gets real alt text describing the joke.
- Internal links go through `url()` in `site/src/lib/url.ts` because the site is
  served under `/toil/`.
- Any change under `site/src/` is checked in a browser at desktop width, 375px and
  320px before the PR opens (`document.documentElement.scrollWidth` must equal the
  viewport width), with desktop and 375px screenshots in the PR.

```bash
npm --prefix site ci
npm --prefix site run dev     # http://localhost:4321/toil/
npm --prefix site run build
```

## Cloud Cost

No standing cloud resources without approval. Anything this repo provisions states its
monthly cost in the PR, and trial infrastructure is torn down in the same change.
