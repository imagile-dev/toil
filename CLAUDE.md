# CLAUDE.md

## Project

toil is a structured-JSON CLI and MCP server, owned by Imagile, that gives AI agents
and humans one interface to enterprise tools and databases. TypeScript on
Node.js (24.14 or later), published to npm as `@imagile-dev/toil`.

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

Principles 1 to 7 and 9 govern **toil itself**: the npm package and what it does on a
user's machine. This repository's own tooling (`scripts/`, the tests, workflows, and
the skills under `.claude/skills/`) is never published or installed by toil. It may
run `git` and `gh` and call GitHub. It still follows principle 8, because every
contributor runs it, and principle 2 where an agent does the work.

**When feedback or a correction arrives, find the principle under it before changing
anything.** Add or sharpen the principle here, then update every rule that follows
from it, not only the one instance that prompted it. A fix with no principle recorded
gets made again in the next place it applies.

1. **Adoptable inside a locked-down enterprise.** Installs from npm, runs on Node, and
   needs nothing else: no executable, no native library, no other CLI, no browser
   login. The only things a security team should need to approve are Node and one npm
   package. The one optional exception is git, which only the commands that are git
   need (#68); everything else, area context from a repository included, works without
   it. → No Executables, the Authentication Bar and no hardcoded hosts
   (`integrations` skill), placeholders that never resolve.
2. **Safe by default when an agent is driving.** Reads are free. Anything that writes,
   to a database or an enterprise tool, needs a human's standing opt-in in config
   plus an explicit flag on the call. Agents never loosen the rules that constrain
   them, and humans merge. The same holds for agents working on this repository:
   they act only on feedback from its own people and named bots, stop after three
   pushed rounds with `needs-human`, and stay off any PR labelled `no-auto-fix`.
   → Writes; the `databases`, `mcp`, `automation` and `ship` skills.
3. **One command does one thing against one source; the caller composes.** No
   aggregate command that decides on the caller's behalf which services to ask. →
   dependency analysis split by source, stdin / `--from` composition (`integrations`
   skill).
4. **Honest and obvious.** Every result says where it came from and how precise it
   is; every integration says how far it has been verified. Errors are unmistakable:
   they say plainly what went wrong and what to do about it. Nothing fails silently,
   and nothing important hides behind `--debug`. → Verification Levels
   (`integrations` skill), source on every finding, the fix on every error.
5. **The environment wins without editing files.** CI and agents configure through
   env vars that override anything on disk. → Configuration Precedence.
6. **This repository stands alone.** Docs, code and skills never name another
   repository or another CLI as a reference, ancestor or comparison. The one
   exception is the frozen migration contract (**Migration Compatibility** in the
   `integrations` skill), which must name its source to be checkable.
7. **Never break what users already rely on silently.** Config on disk, flags, the
   JSON envelope and precedence are contracts; changing them is a declared,
   documented breaking change. → Output Contract, Delivery. **This starts at toil's
   first npm release**, which waits until every integration is built. Until then
   no one can rely on anything, so contract changes need no breaking-change checks,
   declarations or migration notes. Migration Compatibility with the predecessor (the
   `integrations` skill) is a separate requirement and still applies.
8. **Same behavior on Windows, macOS and Linux.** None is second-class; a feature
   that works on one and not the others is not done. → Cross-Platform; the site
   is mobile responsive for the same reason (`site` skill).
9. **toil talks only to what the user pointed it at.** No telemetry, no update checks,
   no call home. The only network traffic is to hosts in the user's config, or to a
   public API that a command the user ran names in its own name (`toil osv vulns`),
   plus the proxy the environment names. A credential goes only to the connection
   it's configured on, or to one the user paired it with; the one exception is an
   area's default connection taking another area's default env value, which keeps
   the old env chain.

## Cross-Platform

*Principle 8.* Windows, macOS and Linux are all first-class.

- Build paths with `node:path` and resolve home with `os.homedir()`; never hardcode a
  separator, a drive letter, or `~`. Paths in JSON output use forward slashes;
  paths on disk use the platform's own form.
- Never spawn through a shell (`shell: true`, `exec`), and never assume bash,
  PowerShell, or a POSIX utility. toil itself runs only git and the OS credential
  stores; repo tooling may also run tools developers already have (git, gh, a
  browser, node), never through a shell. The credential stores are in
  `src/core/keychain.ts`, each behind a platform check (`secrets` skill), and git
  is in `src/core/git.ts` (No Executables).
- Read files as UTF-8 and accept both CRLF and LF; write LF. `.gitattributes` keeps
  the repo LF so Windows checkouts produce identical bundles.
- Config lives in `~/.toil/` on every platform, so instructions are identical.
- CI runs the full gate on `windows-latest`, `macos-latest` and `ubuntu-latest`, on
  Node 24.14 (the floor) and 26, the current release. 24.14 is the first release
  where toil can trust the OS certificate store and honour `HTTPS_PROXY` /
  `NO_PROXY` from code, with no flag and no package (`src/core/network.ts`). On an
  older Node the CLI prints one `UNSUPPORTED_NODE` envelope and exits 1
  (`src/core/runtime.ts`). A test that is skipped on one platform says why in its name.

## No Executables

*Principle 1.* toil runs as JavaScript on the user's existing Node runtime and nothing else. Many
organizations block unsigned or unapproved executables and native libraries but allow
Node, and toil has to work there. This is the most important rule in the repo.

- Every runtime dependency is pure JavaScript or WebAssembly. No native addons (`.node`
  files), no `node-gyp`, no `prebuild`, no package that downloads a binary on install,
  no `install` / `postinstall` scripts.
- toil never spawns a bundled or downloaded binary. Spawning a program the OS already
  ships is allowed only for credential storage (see the `secrets` skill). The one
  other program toil may run is git, below.
- The published package is one bundled JS file plus `package.json`, with no runtime
  `dependencies`. It installs with `npm install --ignore-scripts` and runs offline.
- CI enforces it on what ships, not on the dev toolchain:
  - `npm run check:pure` fails if `package.json` has runtime `dependencies` or any
    install/prepare script, or if the bundle imports anything but Node built-ins.
    That's read from esbuild's metafile, never by scanning text. It also fails on
    a native addon, on `child_process` imported by any file but
    `src/core/keychain.ts` and `src/core/git.ts` (stubbed or not), or if the
    tarball holds anything beyond `dist/toil.js`, `package.json`, `README.md`,
    `LICENSE` and `NOTICE`.
  - `npm run smoke` installs the packed tarball with `--ignore-scripts` into a
    throwaway prefix and drives the installed bin through the CLI and MCP.
- Bundled dependencies can drag in a spawning API (commander imports `child_process`
  for subcommands toil never uses). The build resolves `child_process` to
  `src/shims/no-spawn.ts`, a stub that throws, for every importer but one.
- **There are two exceptions, and only two files get the real
  `node:child_process`** (the tsup `no-spawn` plugin decides by importer path,
  `check:pure` verifies it from the metafile, and ESLint allows the import in those
  files only, apart from repo tooling and tests, which never ship). Any other spawn, or a third file allowed to spawn, needs this section
  changed first.
  - **The OS credential store**, `src/core/keychain.ts`. It runs only what the OS
    ships (`security`, Windows PowerShell, `secret-tool`), never through a shell,
    with secrets on stdin.
  - **git**, `src/core/git.ts`, the one optional exception to principle 1 (#68,
    decision 1). Only the commands that are git (the `git` area and `deps diff`, once
    built) run it;
    repository root, HEAD, branch and remotes are read from `.git` in pure JS
    (`src/core/git-repo.ts`), so area context needs no git. Without git on PATH those
    commands return `GIT_NOT_FOUND`, with a fix naming the PATH searched, and nothing
    else is affected. toil finds git's absolute path itself, skipping relative PATH
    entries and the working directory; runs it with no shell, a fixed subcommand
    list, and `--end-of-options` / `--` before user values; turns off what
    repository config can make it run (`-c core.fsmonitor=`,
    `-c log.showSignature=false`, `--no-ext-diff`, `--no-textconv`, no pager); sets
    `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0`; passes git only an
    allowlist of the caller's env (PATH, home, locale, temp, the Windows system
    variables, and the two that pick git's global config), so no token reaches it; and cancels it with the command's signal. It needs git 2.24 or later (`--end-of-options`); an older git
    gets `GIT_NOT_FOUND` saying so.

## Secrets

**A secret comes from the OS credential store or from an env var, never from a
file.** For every key an area lists in `defineArea({ secrets })`, a value in the
config file must be a `keychain:<ref>` reference; a plaintext one is
`CONFIG_INVALID` (fix: `toil connections login <name>`, or the env var), and the
value is never echoed. Config then holds nothing worth stealing, so a command that
reads or uploads files can't leak a credential by reading `~/.toil/config.json`.
Env vars are the path for CI, containers and machines with no store (headless Linux
without `secret-tool`). There is no `--plaintext`. Details are in the `secrets`
skill.

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
  (validation, connection and context resolution in `call-context.ts`, write gate,
  envelope), errors, config loading and
  writing, the OS credential store (`keychain.ts`), the terminal prompter, and
  JMESPath (`query/`, behind `--select`)
- `src/connections/` — `toil connections add | login | list | remove`
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
  `test/fixtures/` one `<area>.fixture.ts` per area plus the test-only demo commands;
  `test/live/` is the real-credential-store suite, kept out of `npm test` (`secrets`
  skill)
- `scripts/` — area registration, the purity gate, the tarball smoke test, contract
  capture (`capture-command-contract.mjs`, with output fields from
  `contract-output.mjs`), the area stub generator (`stub-area.mjs`), the divergence
  table (`divergences.mjs`), PR screenshots (`shoot.mjs`), and the PR watcher the
  `ship` skill runs (dev tooling; none of it ships)
- `skills/toil/` — the one skill shipped to users; `SKILL.md` indexes per-area files
- `.claude/skills/` — repo-internal skills only. They're for working in this
  repository; they're never published or installed by toil (that's `skills/toil/`)
- `docs/` — plans and decisions; `docs/divergences/<area>.json` holds the migration
  contract's allowed divergences, and `docs/briefs/<area>.md` the integration brief for each
  area still to build
- `site/` — the GitHub Pages site (Astro), its own private package; see the `site`
  skill

An area is declared once with `defineArea({ name, connection, secrets, defaults,
fallbacks, renamed, variants, context })`: `connection` is the zod schema of what a
connection to it holds; `secrets` lists its secret keys, or maps each to `token` or
`password`; `variants` names the keys each value of one field requires (`db`'s
`engine`); and `area.envName(key)` gives a setting's env var for fix text, so no
area spells out `TOIL_<AREA>_…` by hand. Its commands come from `area.command({ ...
})`: a path, a zod input schema, whether it writes, CLI arguments and flags (each
mapped to an input field), and at least one example input. Core adds the
`connection` input (`--connection <name>`) to every area command. A write command
spreads `allowWriteField` into its input. The CLI and MCP surfaces never implement
behavior of their own; if one needs something the other lacks, the gap is in core.

**Every command has one `kind`**, which decides what core hands it and which front
doors serve it: `standalone` (`defineCommand`: no area, no config, e.g. `version`),
`area` (the default for `area.command`), `area-local` (under an area's path with no
connection or config, e.g. `jira schema`), `config` (`defineConfigCommand`: gets
`ctx.manage`) and `cli-only` (a config command never served over MCP).

**Context inputs** say where in the service a command acts (`--project`, `--repo`,
`--instance`). An area declares them once in `context`; a `group` input (the default)
is a flag on the area's group (`toil github --owner o get-pr`, accepted before or
after the leaf) and a field on every one of its MCP tools, and a `command` input
belongs to the commands that list it in their own `context`, which also marks any
input `required`. Core resolves each in one order: the call's own value, then the
dossier (empty until #16), then the git remotes where the area declares how to read
them (`origin` first, then the others; the first one on the connection's host that
the area's parser accepts), then the
connection's `setting`, then the area's `default`. A command that reads one from a
file the call named (an `--input-file`) reports it with `ctx.supply`, which ranks
it just below the call's own value. An input with `selectsConnection`
picks the connection (`--env staging` selects the one named `staging` or whose `env`
is `staging`), and `--connection` goes through the same chain: at each source in
turn, a named connection and a selecting input must agree. `run` reads
`ctx.context.<input>`, and `ctx.resolved` is the same report `meta.context` carries:
the connection, each input, and where each came from. `--help` and each MCP field
say where an input defaults from, in that order.

**`--env` is one concept:** "which environment", everywhere. It's the context input
on areas that have environments (`openshift`, `dynatrace`), and the dossier's
environment is the same input: an explicit `--env` wins, otherwise the dossier
supplies it through the resolver. There is no separate global `--env`. An
environment the area doesn't know is a loud `INVALID_INPUT` listing the ones it has,
never a guess.

**A write on a connection that the dossier or the git remote chose is refused** until
the user adopts that binding (`WRITE_DISABLED`, naming the connection; adopting is
#16's `toil dossiers import`, and until then the fix says to pass `--connection`).
Reads may follow the suggestion; once adopted, writes work normally. A connection the
user named, selected with an explicit input, or set as the default is theirs already.

**Cross-area credentials are paired explicitly** (*principle 9*). `defineArea({
shares: { area, keys } })` only declares which keys may be paired; core adds a
`<key>From` setting, and a connection borrows only when the user set it (a Kibana
connection with `"apiKeyFrom": "es-prod"`), and only from that connection. Between
the two, the env tier beats the file tier, and the own connection wins a tie. With
no pairing a connection uses only its own key, with one exception that keeps the old
env chain: the area's default connection takes the other area's default
connection's env value (`TOIL_KIBANA_API_KEY`, then `TOIL_ELASTICSEARCH_API_KEY`),
matching precedence rule 2. A shared key is a secret in both areas or in neither.
`meta.context.shared` names the connection, whether it was paired, and whether the
value came from env or the store, never the value.

**Aliases** add CLI paths onto a command: a word is a sibling in its group, a path
may sit in another group (`deps outdated` for `artifactory outdated`); MCP still has
one tool per command, and `meta.command` names the command. An area's `coreAliases`
put a path in its group onto a core command fixed to that area (`jenkins instance
list` is `connections list --area jenkins`). A **routed alias** is an old path
whose flag value picks the command (`deps frisk --source sonatype` runs `ossindex
vulns`), declared once in `ROUTED_ALIASES` in `src/registry.ts`
(`src/core/routed-alias.ts`); a route whose command isn't registered is skipped,
and calling it says so.

Local files go through `ctx.files` (`src/core/files.ts`), never `node:fs`: input
files, uploads, downloads and CSV reports resolve inside the workspace on both
front doors (**Bounds**), `-` means stdin only on the CLI (over MCP stdin carries
the protocol, and on an interactive terminal it refuses at once rather than wait), saved paths in output are absolute with forward slashes, and tests
get an in-memory copy. It also answers `exists`, `stat`, a `.gitignore`-respecting
`list` and `findUp`, and writes CSV with `writeCsv`. git runs only through `ctx.git` (`src/core/git.ts`). HTTP to a REST API
goes through `apiRequest` in `src/core/api.ts`, built from the area's
`defineArea({ request })` hook, on `restRequest` in `src/core/rest.ts`. Together they
turn failures into `AUTH`, `NOT_FOUND`, `HTTP` or `NETWORK` errors with the server's
own message, retry a 429, keep a base URL's context path, and keep credentials on the
connection's host: a redirect elsewhere is refused, unless a GET opts into following a
signed download URL with every header dropped. argv is typed from the schema by the
same rule env vars follow (`fromText` in `src/core/schema.ts`): numbers, `true` and
`false`, enums, JSON for an object, and an array field's flag is repeatable with each
value typed as its element. A union stays text, which is how Jira keeps the
predecessor's `parseInt` reading of `--max-results`.

**Commands never read config or env.** `run` gets `ctx.connection`, the one
connection this call resolved, plus any setting from a connection the user paired
it with, resolved by core, validated and typed from the area's schema, and a
context with no `config` and no `env` (which carries every `TOIL_*` credential and
every CI token on the runner), so no area can reach another area's or another
connection's credentials on its own. ESLint bans importing config, the credential store
(`core/keychain`) and the prompter (`core/prompt`) under `src/areas/`, and
`process.env` stays out of area code for the same reason. The store and the
prompter are withheld from the context too. The only commands that see the whole config are the
`toil connections` commands, defined with `defineConfigCommand`, which get
`ctx.manage` (config, store, prompter); no area command can.

A `cli-only` command is never an MCP tool: it prompts on a terminal (stdin is
the protocol under MCP) or changes connections, which agents never do. It has no
time limit, since it may be waiting on someone typing. An area command that must
stay off MCP but keeps its connection and time limit, a delete, sets `mcp: false`.

## Bounds

A bound is a limit every command is held to, whoever drives it: the file
workspace, toil's own files, credentials only to their host, secrets only in the
store or env, CLI-only commands, time limits, read-only commands staying read-only,
and spawning only the credential store and git. `docs/bounds.md` lists each one,
what it protects, where it's enforced, its error and whether it can be relaxed;
`src/core/bounds.ts` is the same list in code, and `test/bounds.test.ts` keeps them
in step. A new bound, or a change to one, updates both. Only a setting in the user's
own config file relaxes a bound (today only `"bounds": { "files": "unbounded" }`),
security-class bounds never, and every envelope says so in `meta.warnings` while
one is relaxed. Reading git metadata above the workspace is the one documented
exception.

**The file workspace.** Every path a command reads or writes resolves inside one
folder: `--workspace <dir>`, else `TOIL_WORKSPACE`, else the CLI's working
directory, else the MCP client's single root; with none, file commands refuse with
`NOT_CONFIGURED`. It's checked after realpath, like the rule below.

**The file service refuses toil's own config and credentials.** `ctx.files` won't
read or write anything at or under `~/.toil/` or the `--config` file, resolved
through realpath (so `..`, symlinks and junctions don't get round it) and compared
case-insensitively on Windows. A command handed a path by an agent would otherwise
send every connection's token to its own host. For the same reason it refuses
anything under `/proc/` and `/sys/`, where `/proc/<pid>/environ` holds the env vars
that carry tokens.

## Build & Test

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm test            # Vitest
npm run build       # tsup → dist/toil.js, single bundle
npm run check:pure  # the No Executables gate (after build)
npm run smoke       # install the tarball with scripts off; drive CLI and MCP (after build)
```

All six pass before a PR opens. CI runs them on Windows, macOS and Linux, on Node 24.14
and 26. Its `CI ok` job passes only when every one of those passed, and it's the one
check `main`'s ruleset requires, so nothing merges on a red gate. Other checks stay
optional: the review job (approval is required separately, and it skips the release
PR) and path-filtered jobs, which would block PRs they never run on.

## Output Contract

Every command writes exactly one JSON envelope to stdout: `{ ok, data, error, meta }`.
Errors are a `ToilError` with a code and a fix the user can act on, never a raw
stack trace. Logs and progress go to stderr. Removing or renaming a field in `data` is
a breaking change.

- **Usage errors are envelopes too.** An unknown command or flag, or a missing
  argument, gets an `INVALID_INPUT` envelope on stdout (`runProgram` in
  `src/program.ts`). Only `--help` and `--version` print plain text.
- **`--verbose` adds `meta.requests`**: method, URL as sent with credential
  parameters and userinfo redacted (`redactUrl` fails closed on credential-shaped
  names, and leaves identifiers such as `projectKey` and `componentKeys`), status and timing for every request. It never includes headers or bodies.
- `--verbose` lives in core: `execute()` hands every command an instrumented
  `ctx.fetch`, so no command implements it and no front door can forget it. Commands
  under `src/areas/` may not call `fetch` directly, and ESLint enforces it.
- **Input is strict.** `execute()` parses with the schema's `.strict()`, so an
  unknown or misspelt field is `INVALID_INPUT` through MCP exactly as an unknown flag
  is on the CLI. Never silently ignore a field.
- **`--select <expression>`** (`select` in every MCP tool's input) is core's, on every
  command: a JMESPath expression `execute()` compiles before anything runs and
  applies to `data` after `run`, leaving `meta` alone. The language lives in
  `src/core/query/`, built in rather than a dependency, and passes the official
  compliance suite (`test/fixtures/jmespath/`). A bad expression, or one nested more
  than 500 levels deep, is `INVALID_INPUT` with its position in the fix, and so is
  any failure applying it; one that selects nothing is `data: null` plus a
  `SELECT_EMPTY` warning. No command may declare a `select` field.
- **`meta.warnings`** carries things worth saying that aren't failures (a reserved
  config key, a truncated result), from config loading or a command's `ctx.warn()`.
  **`meta.page`** is `{ nextCursor, limit }`, set with `ctx.setPage()` by any command
  that pages. Both are absent when empty.
- **`meta.context`**, on area commands only, says where the call acted: `{ connection,
  inputs, shared }`. `connection` and each of `inputs` is `{ value, source }`, the
  source one of `input`, `file` (a value the command read from a file the call
  named, through `ctx.supply`), `dossier`, `git`, `connection` or `default`, plus `via` (the
  input that selected the connection) or `default` (`named`, `area-name` or `only`).
  `shared` lists settings taken from another area's connection, with where each
  lived, never the value. It's set on a failure too, as far as resolution got.
- **Every command has a time limit and can be cancelled.** `execute()` aborts at
  `TOIL_TIMEOUT_MS` (default 120 s, or a longer `timeLimitMs` the command declares;
  `TOIL_TIMEOUT_MS`, when set, overrides both) with `TIMEOUT`, and on Ctrl+C or an
  MCP cancel with `CANCELLED`. Commands pass `ctx.signal` to anything long-running that isn't
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
4. The connection in `~/.toil/config.json`, or the file passed with `--config`. A
   secret there must be a `keychain:<ref>` reference to the OS credential store,
   read when the connection is resolved; a plaintext secret in a file is refused
   (**Secrets**)
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
one; with both names set, the higher tier wins (an old env var over a new name in the
file), and the new name wins a tie.

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
`TOIL_TIMEOUT_MS`, `TOIL_WORKSPACE`.

**The config file is versioned.** `"version"` is a whole number; a file without one
is version 1. Every format change adds a step to `migrateConfig()` with a test, so an
old file always loads. A file from a newer toil is refused with an upgrade fix rather
than half-read. Version 1 is a map of area to settings and reads as one connection
per area, named after it and set as its default. Version 2 holds `connections` and
`defaults`; using them needs `"version": 2`. Standalone and area-local commands
(`version`, `jira schema`) don't load config at all, so a broken or newer file can't stop a user finding out which
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
Deletes are never exposed through MCP: a delete command sets `mcp: false`.

## Matching the predecessor

*Principles 4 and 7.* Until toil has run an integration against a live instance, the
predecessor's observable behavior **is** the specification: the requests it sends,
whether a call succeeds or fails, the error, and the `data` it returns. Toil's unit
suite has never met a real server, so an integration that "fixes" what looks wrong is
guessing, and it silently breaks callers who rely on the old result.

- **Match behavior exactly, bugs included,** until a live instance proves otherwise.
  That covers validation, defaults, paging, id-or-name detection, encoding and error
  messages too, not just the happy path.
- **Suspected bugs are recorded, not fixed.** Each integration has one issue labelled
  `suspected-bug` (`Suspected predecessor bugs: <name> (`<area>`)`). The integration appends
  anything new it finds there, with where, what, why, confidence, the observable
  change if fixed, and a live check. Tests pin the predecessor's behavior and say it's
  a suspected bug.
- **Two kinds of change are allowed.** One is a change another principle or the
  Output Contract requires, such as a credential reaching a host the user didn't
  configure, or a path an agent passes reaching toil's own credentials. It's made at
  once and listed as a divergence in `docs/divergences/<area>.json`, naming the
  principle.
  The other is additive output the contract already allows (a new `data` field,
  `meta.warnings`, `meta.page`).
- **The first live run checks every item** in the area's issue. A confirmed bug is
  fixed as a declared change (`fix:` or `feat:`, and `feat!:` once toil has been
  released, per Delivery); a refuted one is closed.

## Testing

Tests never need the network: a developer offline gets the same result as CI.

Repository hygiene has its own suite, `test/repo-hygiene.test.ts` (see Delivery).

- **Mock HTTP with `fakeFetch`** (`test/harness/fake-fetch.ts`), injected through
  `Context.fetch`. Routes match on the method and the full URL, or on the method,
  `path` and `query` (in any order). A request with no route throws, so a test can't pass against a
  real server by accident. Every integration test asserts both sides: the exact
  request toil sent (method, URL, headers, body) and how the canned response was
  reshaped. Build contexts with `testContext()` (with `secrets: fakeStore()` and
  `prompt: scriptedPrompter()` for commands that use them); run the real CLI in-process with
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
  - for every example, identical envelopes, HTTP requests and operations (the log
    of traced non-HTTP calls, such as the db area's provider) through both front
    doors; only GET/HEAD/OPTIONS from a command that doesn't write (plus POST from
    a read marked `queryByPost`, such as a search whose query may be too long for
    a URL), and no traced write operation. A token exchange core makes for the
    area (`watchTokenExchanges` in `src/core/token.ts`) doesn't count against a
    read, and the token cache is cleared before each CLI and MCP run, so both
    exchange and send the same requests
  - an unknown field refused as `INVALID_INPUT` on both sides before any request
  - a config failure building the context gives the same envelope on both sides
  - per area with a command that takes a connection, `--connection <name>` and
    MCP's `connection` field selecting the same connection, and an unknown
    connection refused the same way
  - for every write command, the write gate holding on both sides

  New commands are covered on registration; never add a command without examples,
  and never exempt one from this suite. The only exclusion is `cli-only` commands,
  which aren't MCP tools; the suite finds them by their `kind` and proves MCP never
  serves them. Every alias is run against its command's MCP tool too. When changing the harness, prove the suite
  still bites: break the mapping on purpose and watch it fail.
- **Each area has a fixture**, `test/fixtures/<area>.fixture.ts`, exporting
  `defineFixture({ area, routes, config })`: canned responses for every request its
  examples send, a config keyed by area (read as one connection named after the
  area, as if set by `TOIL_<AREA>_*` env vars) with credentials set and writes on,
  and any local `files` the examples read. Local state (a seeded database) is made in
  `setup` and removed in `teardown`, never at import, and an area that isn't HTTP
  names what to `trace` for the operations log. The suite finds a fixture by file
  name and fails when a registered area has none.
- **Four more suites cover every area with no per-area code:** `test/contract.test.ts`
  (the migration contract's commands, flags and output field names, see the
  `integrations` skill), `test/skills.test.ts` (a `skills/toil/<area>.md` with
  frontmatter, naming every command, every env var, every CI fallback and the area's
  supported versions), `test/fallbacks.test.ts` (each declared CI fallback in its
  precedence position, through the real config loader), and
  `test/site-commands.test.ts`, which writes `site/src/data/commands/<area>.json` and
  `site/src/data/settings/<area>.json` for the docs pages (`npx vitest run -u` after
  changing a command or a connection key) and checks the board's
  `site/src/data/integrations/<area>.json`.
- **No file every integration edits.** Each area has its own fixture, skill file, divergence
  file, board entry and command list; the lists that span areas (the registry, the
  areas in `SKILL.md`, the CLI-only commands) are derived or generic. A change that
  makes parallel integrations edit one shared file is a review finding.
- `test/fixtures/demo-commands.ts` holds test-only commands (a read and a write
  against a fake API) that exercise the harness before real integrations exist, and
  `demo-context-commands.ts` a test-only area that uses context inputs, a setting
  shared from `demo`, a cross-group alias and every typed flag. They're never
  registered in the shipped CLI.
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
`<service>.imagile.dev`; SaaS keeps the vendor domain with `imagile` as tenant, unless
the vendor answers for every subdomain (Atlassian, Dynatrace), where any tenant name is
a real host someone could register: those use `<service>.imagile.dev` too; opaque
IDs use `abc12345` or `abc12345-0000-0000-0000-000000000000`; email uses
`you@example.com`. Never add wildcard DNS to `imagile.dev`.

## Delivery

- Conventional Commits: `fix:`, `feat:`, `feat!:` with a `BREAKING CHANGE:` footer
  that says why and how to migrate. release-please builds the changelog from them.
  **Before the first npm release, don't use `feat!:` or `BREAKING CHANGE:`**
  (principle 7): a contract change is a plain `feat:` or `fix:`, and a breaking
  marker would put a migration note for a change no user ever saw into the first
  changelog.
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
- **No npm release until every integration is built.** The release job is off until
  a maintainer sets the repository variable `TOIL_RELEASES` to `on`; until then
  there's no release PR, tag or publish. Turning it on is a human's call, made once
  the last integration merges. release-please then opens one release PR covering every
  commit since the start.
- **Releases** come from release-please (`.github/workflows/release.yml`): Conventional
  Commits on `main` become a release PR, and merging it, which is always a human's
  call, tags, publishes `@imagile-dev/toil` to npm with provenance, attaches the
  tarball to the GitHub release, and posts to Discord, loudly if the publish fails.
  Publishing uses the `NPM_TOKEN` secret until npm trusted publishing is configured
  for the package, then OIDC with no token. The release PR is opened by the Imagile
  Bot App, not `GITHUB_TOKEN`, so CI runs on it. The agent review skips it, because
  the App can't review its own PR; the human who merges it is the review.
- **Until 1.0, every release is an alpha prerelease** (`0.1.0-alpha.1`, then
  `-alpha.2` …), marked as a prerelease on GitHub and published under npm's `alpha`
  dist-tag. Until a stable release exists, `latest` also follows the newest alpha,
  so a plain `npm install @imagile-dev/toil` gets the current alpha rather than a
  stale first one; once 1.0 ships, prereleases only move their own tag. Going
  to beta or 1.0 is a deliberate change to `release-please-config.json`, made by a
  human.
- PRs are vertical slices (core → CLI → MCP → tests → skill doc), sized large enough
  to avoid process overhead, fully verified before opening. Use the `ship` skill, which
  reviews locally, fixes, and watches the PR until it's ready to merge.
- **Commit only what the change needs.** Before every commit, read `git status` and
  the staged file list, and leave out what's accidental: an empty file a shell
  redirect made (`{}`, `nul`), scratch scripts, logs, screenshots, local config.
  Scratch work goes in a temp folder outside the repo, never at its root.
  `test/repo-hygiene.test.ts` fails on an empty tracked file or an unexpected
  top-level entry. A new top-level file goes on its allowlist on purpose.
- After the first npm release, before changing behavior users rely on, check config
  already on disk, existing flags, the envelope, and precedence, and say what you
  checked in the PR. Before it, skip that: the PR has no section for it, and reviews
  don't ask.
- **Decisions an agent makes by default go in `AGENT_DECISIONS.md`**, with what, why
  and where, so the maintainer can review or overturn them. The maintainer's own
  decisions stay on the issues.
- **Fix every review finding in the round it arrives, non-blocking ones included**,
  with the simplest fix that is easy to understand. A finding left for later piles up
  another round; an elaborate fix makes the design harder to follow than the problem
  did. Defer one only when it's genuinely out of scope, or when fixing it would add
  complexity out of proportion to what it fixes (the maintainer's call, 2026-10-17).
  Either way, say so in its thread, and record the skip in `AGENT_DECISIONS.md`.
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
| `integrations` | Adding or changing an enterprise integration: the Authentication Bar, verification levels, Data Center vs Cloud variants as separate areas, the site docs review, matching the predecessor, the migration command contract |
| `databases` | Working on the `db` area, a database provider, or database tests, including the local Docker run |
| `code-intelligence` | Someone proposes code navigation or a language-analysis dependency: why there is no `code` area, and what reopening it takes |
| `mcp` | Changing `toil mcp`, tool registration and descriptions, transports, or the MCP gateway |
| `secrets` | Storing, resolving, moving or logging a secret; the OS credential store |
| `automation` | Editing workflows under `.github/`: the review agent, the fix agent, action pins, Discord notifications, redaction |
| `site` | Changing anything under `site/`, or the brand it shares with the terminal splash and menu in `src/welcome/`: responsive rules, palette, the mark and its motion, art, status honesty, screenshots |
| `ship` | Opening, updating or shepherding a PR: four local reviews (gate, code, docs, principles), fixing all but principle findings, and the four-minute PR watch that replaces the app's Auto-fix |

## Cloud Cost

No standing cloud resources without approval. Anything this repo provisions states its
monthly cost in the PR, and trial infrastructure is torn down in the same change.
