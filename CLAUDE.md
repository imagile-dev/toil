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
- CI enforces this: `npm ci --ignore-scripts`, then fail if `node_modules` contains any
  `*.node` file, any `binding.gyp`, or any package with an install script, and fail if
  the packed tarball contains anything but JS, JSON, Markdown and the license.

Before adding a dependency, check it against this rule. If the only good library is
native, find a pure-JS or WASM alternative or implement the protocol directly.

The rule protects what users install, so it covers the published package and its
runtime dependencies. `site/` is a separate private package that only ever builds in
GitHub Actions; its build tooling is out of scope.

## Layout

- `src/core/` — every capability: command definitions, config, HTTP, database providers, code analysis
- `src/cli.ts` — the `toil` command line; thin, no logic
- `src/mcp/` — the MCP server (`toil mcp`, stdio); tools generated from the command definitions
- `src/**/*.test.ts` — Vitest, next to the code
- `skills/toil/` — the one skill shipped to users; `SKILL.md` indexes per-area files
- `.claude/skills/` — repo-internal skills only
- `docs/` — plans and decisions
- `site/` — the GitHub Pages site (Astro), its own private package; see **Site**

A command is defined once in `src/core/` with a schema (zod) for its input and output.
The CLI and MCP surfaces never implement behavior of their own; if one needs something
the other lacks, the gap is in core. Every definition declares whether it writes.

## MCP Server

`toil mcp` serves over stdio. `--areas jira,confluence` limits it to those areas, so
an agent sees a small, focused tool list and one config entry stands in for one vendor
server. With no `--areas`, it serves every area that has config. Write tools are not
registered at all unless the area has writes enabled (see **Writes**), so an agent
cannot discover them, let alone call them. Tool descriptions are written for a model
choosing between tools: what it returns, when to use it, and which sibling tool to use
instead.

## Build & Test

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm test            # Vitest
npm run build       # tsup → dist/toil.js, single bundle
npm run check:pure  # the No Executables gate
```

All five pass before a PR opens.

## Output Contract

Every command writes exactly one JSON envelope to stdout: `{ ok, data, error, meta }`.
Errors are a `ToilError` with a code and a fix the user can act on, never a raw
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

## Writes

*Principle 2.* Every command that changes something outside the local machine —
creating or transitioning an issue, commenting on a PR, writing a row — needs both:

1. `writes: true` on that service or connection in config, set by a human, and
2. `--allow-write` on the call.

Without either, the command fails with a `ToilError` naming the missing one. Env vars
can enable writes for CI (`TOIL_<AREA>_WRITES=true`), following normal precedence.
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

Confirm the Authentication Bar first. Then, in one change: config type and env-var
resolution, HTTP client methods, commands in core, `config init`/`check`/`test`
entries, `skills/toil/<service>.md`, and its row in `SKILL.md`. The
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

Unit tests stub `fetch` and never need the network. Database tests use `node:sqlite`
in-process; tests against real PostgreSQL, MySQL and SQL Server run as CI service
containers under `npm run test:integration`, which offline developers can skip.
Fixtures use placeholder hosts.

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
- PRs are vertical slices (core → CLI → MCP → tests → skill doc), sized large enough
  to avoid process overhead, fully verified before opening. Use the `ship` skill.
- Before changing behavior users rely on, check config already on disk, existing
  flags, the envelope, and precedence. Say what you checked in the PR.

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
- The release workflow, when it's built, posts each npm publish (version, release
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
