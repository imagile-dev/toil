# CLAUDE.md

## Project

toil is a structured-JSON CLI and MCP server, owned by Imagile, that gives AI agents
and humans one interface to enterprise tools, databases, and codebases. .NET 10, C#,
shipped as a Native AOT binary and a `dotnet tool`.

## Layout

- `src/Toil.Core/` — every capability: commands, config, HTTP, database providers, code analysis
- `src/Toil.Cli/` — the `toil` command line; thin, no logic
- `src/Toil.Mcp/` — the MCP server (`toil mcp`); thin, tools generated from Core command definitions
- `tests/` — xUnit, mirrors `src/`
- `skills/toil/` — the one skill shipped to users; `SKILL.md` indexes per-area files
- `.claude/skills/` — repo-internal skills only
- `docs/` — plans and decisions

A command is defined once in Core. The CLI and MCP surfaces never implement behavior
of their own; if one needs something the other lacks, the gap is in Core.

## Build & Test

```bash
dotnet build
dotnet test
dotnet format --verify-no-changes
dotnet publish src/Toil.Cli -c Release -r win-x64   # AOT smoke; must stay warning-free
```

All four pass before a PR opens. AOT trim warnings are errors, not noise.

## Output Contract

Every command writes exactly one JSON envelope to stdout: `{ ok, data, error, meta }`.
Errors are a `ToilException` with a code and a fix the user can act on, never a raw
stack trace. Logs and progress go to stderr. Removing or renaming a field in `data` is
a breaking change.

## Configuration Precedence

1. `TOIL_*` environment variable
2. A well-known CI-provided variable for that service, only where the service's own
   tooling treats it as canonical (`GITHUB_TOKEN`, `SYSTEM_ACCESSTOKEN`). Never invent one.
3. `.toil.json` in the repository
4. `~/.toil/config.json`

CI must be able to override anything without editing files. Lowering env-var priority
for any field is a breaking change. Anything that rewrites the global config carries
through keys it did not prompt for.

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

## Databases

- **Read-only by default.** A write needs `allowWrite: true` on the connection *and*
  `--allow-write` on the call. MCP tools never pass `--allow-write` on the agent's
  behalf; the connection setting is the user's decision.
- Statements run in a read-only transaction or session where the engine supports it,
  then rolled back. Do not rely on parsing SQL to decide whether it writes.
- Every query has a row cap (default 100) and a timeout, returns a cursor for paging,
  and can be cancelled.
- Connection strings resolve like any other secret: env var, then keychain reference,
  then config. Never log a connection string; log the connection name.
- Providers live in `src/Toil.Core/Data/<Engine>/`. Adding one follows the
  `db-provider` skill.

## Code Intelligence

`code` commands load the solution with Roslyn `MSBuildWorkspace` and answer from the
semantic model, not text search: symbol search, symbol info, references, call
hierarchy, diagnostics, rename, build, test. Results carry file, line, and column so an
agent can jump straight to them. Rename previews by default and applies with `--apply`.
Workspace load is the expensive step; the MCP server keeps one warm per solution.

## Adding an Enterprise Integration

Confirm the Authentication Bar first. Then, in one change: config type and env-var
resolution, HTTP client methods, commands in Core, `config init`/`check`/`test`
entries, `skills/toil/<service>.md`, and its row in `SKILL.md`. The
`new-integration` skill holds the checklist; a test fails when a registered service
has no skill file.

Each integration records a testing level — `untested`, `basic`, `beta`, `live` —
measured against a real instance, not the unit suite. New integrations start
`untested`. Raise a level only after a live run, and say in the PR what was run.

A command talks to one service. Do not build an aggregate command that fans out to
several sources; give each source its own area and let them compose through stdin or
`--from <file>` (see the dependency-analysis section of `docs/integrations.md`).

Where a vendor ships self-hosted and SaaS with diverging APIs, implement the
self-hosted shape and only that.

## Testing

Unit tests stub HTTP (`HttpMessageHandler` fakes) and never need the network. Database
tests use SQLite in-process, or Testcontainers behind the `Integration` trait, which CI
runs and offline developers can skip. Fixtures use placeholder hosts.

## Placeholders

Never commit a real hostname, tenant ID, account, or connection string from any
environment — not in code, tests, docs, issues, or PRs. Self-hosted services use
`<service>.imagile.dev`; SaaS keeps the vendor domain with `imagile` as tenant; opaque
IDs use `abc12345` or `abc12345-0000-0000-0000-000000000000`; email uses
`you@example.com`. Never add wildcard DNS to `imagile.dev`.

## Delivery

- Conventional Commits: `fix:`, `feat:`, `feat!:` with a `BREAKING CHANGE:` footer
  that says why and how to migrate. release-please builds the changelog from them.
- Branches: `kolatts/<issue#>-<description>`. Every branch has an issue.
- PRs are vertical slices (Core → CLI → MCP → tests → skill doc), sized large enough
  to avoid process overhead, fully verified before opening. Use the `ship` skill.
- Before changing behavior users rely on, check config already on disk, existing
  flags, the envelope, and precedence. Say what you checked in the PR.

## Automation

An agent reviews every PR and submits a formal review. `CHANGES_REQUESTED` dispatches
a fix agent that pushes to the PR branch.

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

## Cloud Cost

No standing cloud resources without approval. Anything this repo provisions states its
monthly cost in the PR, and trial infrastructure is torn down in the same change.
