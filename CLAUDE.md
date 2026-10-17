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
   package. → No Executables, the Authentication Bar and no hardcoded hosts
   (`integrations` skill), placeholders that never resolve.
2. **Safe by default when an agent is driving.** Reads are free. Anything that writes,
   to a database, an enterprise tool, or the codebase, needs a human's standing opt-in
   in config plus an explicit flag on the call. Agents never loosen the rules that
   constrain them, and humans merge. → Writes; the `databases`, `code-intelligence`
   (rename preview), `mcp` and `automation` skills.
3. **One command does one thing against one source; the caller composes.** No
   aggregate command that decides on the caller's behalf which services to ask. →
   dependency analysis split by source, stdin / `--from` composition (`integrations`
   skill).
4. **Honest about what is known.** Every result says where it came from and how
   precise it is; every integration says how far it has been verified. → Verification
   Levels (`integrations` skill), `precision` on code results (`code-intelligence`
   skill), source on every finding.
5. **The environment wins without editing files.** CI and agents configure through
   env vars that override anything on disk. → Configuration Precedence.
6. **This repository stands alone.** Docs, code and skills never name another
   repository or another CLI as a reference, ancestor or comparison. The one
   exception is the frozen migration contract (**Migration Compatibility** in the
   `integrations` skill), which must name its source to be checkable.
7. **Never break what users already rely on silently.** Config on disk, flags, the
   JSON envelope and precedence are contracts; changing them is a declared,
   documented breaking change. → Output Contract, Delivery.
8. **Same behavior on Windows, macOS and Linux.** None is second-class; a feature
   that works on one and not the others is not done. → Cross-Platform; the site
   is mobile responsive for the same reason (`site` skill).
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
  stores in the `secrets` skill, each behind a platform check.
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
  ships is allowed only for credential storage (see the `secrets` skill).
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
- `src/welcome/` — the splash and menu that bare `toil` opens on an interactive
  terminal. Plain ANSI over Node's own `readline`, no package. Anything else (args,
  a pipe, CI, MCP) gets the JSON CLI untouched. Every screen is a pure function of
  data and every animation frame a pure function of time, so both are unit-tested.
- `src/shims/` — build-time stand-ins (the no-spawn stub)
- `src/**/*.test.ts`, `test/` — Vitest; `test/harness/` holds the shared fakes,
  `test/fixtures/` one `<area>.fixture.ts` per area plus the test-only demo commands
- `scripts/` — the purity gate, the tarball smoke test, contract capture
- `skills/toil/` — the one skill shipped to users; `SKILL.md` indexes per-area files
- `.claude/skills/` — repo-internal skills only
- `docs/` — plans and decisions
- `site/` — the GitHub Pages site (Astro), its own private package; see the `site`
  skill

An area is declared once with `defineArea({ name, connection, secrets, defaults,
fallbacks, renamed })`: `connection` is the zod schema of what a connection to it
holds. Its commands come from `area.command({ ... })`: a path, a zod input schema,
whether it writes, CLI arguments and flags (each mapped to an input field), and at
least one example input. Core adds the `connection` input (`--connection <name>`)
to every area command. A write command spreads `allowWriteField` into its input.
Commands with no area and no config (`version`) use `defineCommand`. The CLI and MCP
surfaces never implement behavior of their own; if one needs something the other
lacks, the gap is in core.

**Commands never read config or env.** `run` gets `ctx.connection`, the one
connection this call resolved, validated and typed from the area's schema, and a
context with no `config` and no `env` (which carries every `TOIL_*` credential and
every CI token on the runner), so no area can reach another area's or another
connection's credentials. ESLint bans importing config under `src/areas/`, and
`process.env` stays out of area code for the same reason.

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
a warning, as is a connection for an area toil doesn't have. Env-only connections are
created before an area's default is chosen, so `TOIL_CONN_CI_AREA=jira` plus
`TOIL_JIRA_TOKEN` is one connection. Env values stay strings until the area's schema types them (`"5432"` to a number,
`"true"` to a boolean only where the schema says boolean), keys
an area doesn't declare are dropped with a warning, and renamed keys still work, with
one.

CI must be able to override anything without editing files. Lowering env-var priority
for any field is a breaking change. Anything that rewrites the global config carries
through keys it did not prompt for.

**There is no repository-level config file, and there won't be one.** Anyone who
can push to a repo, or an agent editing the working tree, could use such a file to
switch on writes or send the user's credentials to a host of its choosing
(*principles 2 and 9*). Hosts to talk to, credentials and `writes` come only from env
vars and the user's own config.

Knowledge about a body of work (its repos, Jira keys and fields, boards,
environments) belongs in **dossiers** (`docs/dossiers.md`). A dossier holds no secret
and no `writes`, and it can't create a connection: it only selects among the reader's
own connections, by name or by a host that toil uses purely as a selector and never
contacts. That's why a dossier may be checked into a repository when config may not.

Env var names map onto areas through the registry, using the longest match, so
`TOIL_JIRA_CLOUD_TOKEN` is `jira-cloud.token`, not `jira.cloudToken`. A `TOIL_*` name
that matches no registered area is ignored, never guessed at, so a variable can't
change meaning when an area is added. `envName()` and `parseEnvName()` in
`src/core/config.ts` are the only places the mapping lives. These names are reserved
and never map onto an area: `TOIL_CONN_*`, `TOIL_DOSSIER*`, `TOIL_ENV`, `TOIL_CONFIG*`,
`TOIL_TIMEOUT_MS`.

**The config file is versioned.** `"version"` is a whole number; a file without one
is version 1. Every format change adds a step to `migrateConfig()` with a test, so an
old file always loads. A file from a newer toil is refused with an upgrade fix rather
than half-read. Version 1 is a map of area to settings and reads as one connection
per area, named after it and set as its default. Version 2 holds `connections` and
`defaults`; using them needs `"version": 2`. Standalone commands (`version`) don't
load config at all, so a broken or newer file can't stop a user finding out which
toil they have.

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
- Database testing, including the local Docker run every provider PR needs, is in
  the `databases` skill.
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
  "lol". Most comments have no joke, but **every new module carries at least one**,
  usually in its header comment or beside the decision most worth explaining. A
  module that ships without one is a review finding.
- **Comments only.** None of it goes on the site, in `--help` text, error messages,
  `fix` hints, the JSON envelope, MCP tool descriptions, docs, skills, commit
  messages or PR descriptions. Those are read by people mid-task, or by models
  choosing a tool, and both deserve a straight answer. The site keeps its own,
  gentler register (see the `site` skill).

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
- **Fix every review finding in the round it arrives, non-blocking ones included**,
  with the simplest fix that is easy to understand. A finding left for later piles up
  another round; an elaborate fix makes the design harder to follow than the problem
  did. Defer one only when it's genuinely out of scope, and say so in its thread.
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
    (see the `databases` skill), including the image and tag.
  - **Screenshots** for anything visual: desktop and 375px (see the `site` skill).
  - **What wasn't verified**, said plainly, and why.

  Refresh the proof whenever the description is rewritten.

## Skills

CLAUDE.md holds only guidance that applies to every task: the principles and the
rules that are always relevant. Anything needed only for a particular kind of work
lives in a repo-internal skill under `.claude/skills/<name>/SKILL.md`.

- Keep the set to 4–8 skills. Fold new guidance into an existing skill before creating
  one, and split a skill only when it grows past a single coherent job.
- When a new rule arrives, decide first whether it is global (CLAUDE.md) or
  task-specific (a skill), and put it in exactly one place.
- Keep this index current: one line per skill, its name and when to use it.

| Skill | Use when |
|-------|----------|
| `integrations` | Adding or changing an enterprise integration: the Authentication Bar, verification levels, Data Center vs Cloud variants as separate areas, the site docs review, porting from the predecessor, the migration command contract |
| `databases` | Working on the `db` area, a database provider, or database tests, including the local Docker run |
| `code-intelligence` | Working on the `code` area: language service, tree-sitter, IDE bridge, `precision` |
| `mcp` | Changing `toil mcp`, tool registration and descriptions, transports, or the MCP gateway |
| `secrets` | Storing, resolving, moving or logging a secret; the OS credential store |
| `automation` | Editing workflows under `.github/`: the review agent, the fix agent, action pins, Discord notifications, redaction |
| `site` | Changing anything under `site/`: responsive rules, palette, house style, art, status honesty, screenshots |

The `ship` skill (gate and PR, named under **Delivery**) becomes the eighth.

## Cloud Cost

No standing cloud resources without approval. Anything this repo provisions states its
monthly cost in the PR, and trial infrastructure is torn down in the same change.
