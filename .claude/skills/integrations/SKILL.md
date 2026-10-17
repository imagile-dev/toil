---
name: integrations
description: Rules for toil's enterprise-tool integrations (Jira, Confluence, Bitbucket, SonarQube and every other service area). Use when adding, changing or reviewing an integration or one of its commands, judging whether a requested service can be supported (its authentication), recording or raising a verification level, adding a vendor's Cloud variant (each variant is its own area), reviewing an integration's site documentation page, or touching anything covered by the migration command contract (docs/command-contract.json, docs/command-contract.md, docs/divergences/, `toil config import`, command paths, flags, env var and config key names). Not needed for databases or the MCP server alone.
---

# Integrations

## Authentication Bar

An enterprise integration authenticates with a long-lived credential the user
generates once in the vendor's UI and gives to toil through `toil connections add` (the
OS credential store) or an env var, never a config file. toil gets from
it to an authenticated request with no interactive step: a header, or a plain-HTTP
exchange for a short-lived token that toil caches in memory and never writes to disk.

Out of scope regardless of usefulness: interactive OAuth, SSO/SAML/OIDC at use time,
username + password, app registrations for client credentials, cloud IAM chains, mTLS,
and anything that shells out to another CLI for a token. If that is a tool's only auth,
decline and name the blocking mechanism.

No hardcoded vendor base URLs; every host is user-supplied.

## Adding an Enterprise Integration

Confirm the Authentication Bar first. Then, in one change: `src/areas/<area>/` with
its `defineArea` (connection schema, secrets, CI fallbacks), its commands and its
`supported` export, a `test/fixtures/<area>.fixture.ts`, `config init`/`check`/`test`
entries (once the `config` commands exist), `skills/toil/<area>.md`, its board entry
`site/src/data/integrations/<area>.json`, and `docs/divergences/<area>.json` if it
diverges. Every one of those files is the area's own; no integration edits a shared list.
`test/skills.test.ts` fails when a registered area has no skill file, the file has no
frontmatter, or it misses a command, a connection key's env var or the supported
versions.

### Building an area, step by step

1. **Read the brief**, `docs/briefs/<area>.md`: auth, paging, special HTTP needs,
   context inputs, the suspected-bug issue and the supported version. Then read the
   contract, which the brief summarizes and which wins
   where they disagree.
2. **Stub it**: `node scripts/stub-area.mjs <area>` writes `src/areas/<area>/` with
   a `defineArea` with a `request` hook to fill in, one `area.command()` per
   contract command (exact path, arguments and flags, each `run` throwing until built), plus the fixture and skill file. It never
   overwrites, and it leaves out commands a divergence removes. Group-level flags
   become the area's context inputs in `area.ts`, with a TODO for where each value
   comes from (a connection setting, the git remote, or selecting the connection).
3. **Build each command**: request, paging, errors and `data` exactly as the
   contract had them, through `ctx.fetch` and core's helpers. Set `writes`
   from what the contract does; the stub only guessed from the verb.
   - **Paging** goes through `paginate`. A `p`/`ps`/`total` API (SonarQube) is
     the `page` style with a `total` callback: it stops once the items read reach
     the total or a page is empty, never on a short page. The result's `total` is
     the last one the server reported, an empty page's included, so a command
     asked for zero items (`--max-results 0`) still returns the count.
   - **The 1,000-page bound** (`MAX_PAGES`) is new to toil, and the contract
     had none: list it in the area's `docs/divergences/<area>.json` (principle 4)
     for every area that pages, and pass `what` so the error names the list.
   - **A context value read from a file** (Jira's `project` in `--input-file`)
     goes through `ctx.supply('project', value, 'file')`. It ranks below the
     call's own flag and above the dossier, git and the connection, returns the
     value to use, and `meta.context` reports source `file`. Keep the input
     `optional` in the command's `context` when the file may supply it, since a
     required one is checked before `run`.
4. **Fixture**: canned responses for every request the examples send, as routes on
   method, `path` and `query`. Local state goes in `setup`/`teardown`; a non-HTTP
   area names what to `trace`.
5. **CI fallback**: where the service's own tooling reads a well-known variable
   (`SONAR_TOKEN`), declare it in `defineArea({ fallbacks })` and name it in the
   skill file; `test/skills.test.ts` fails if the file doesn't. Don't write a
   precedence test for it: `test/fallbacks.test.ts` checks every declared
   fallback against the real config loader (below `TOIL_<AREA>_<KEY>`, above the
   file, default connection only), and the not-configured errors name it beside
   the `TOIL_` variable on their own.
6. **Supported version**: export `supported` from `index.ts`, set the same value in
   the board entry, and state it in the skill file. An error that means the server
   is too old uses `serverTooOld()` from `src/core/supported.ts`, so its message says so and names
   the minimum.
7. **Contract**: `test/contract.test.ts` checks paths, flags and output field names.
   Anything a principle makes you change goes in `docs/divergences/<area>.json`. A
   contract command toil drops altogether (`git credentials`) is an entry with
   `"removed": true` listing its paths: the test then accepts their absence and fails
   if one is still registered, and the stub generator leaves them out. A group flag
   (`bitbucket --project`) satisfies a contract leaf flag of the same spelling, so
   moving a target flag to the group needs no divergence.
8. **Docs**: `npx vitest run -u` writes `site/src/data/commands/<area>.json` and
   `site/src/data/settings/<area>.json`; set the
   board entry's `status` to `unit`; review the docs page and take its screenshots
   with `node scripts/shoot.mjs docs/integrations/<area>/` (the `site` skill).
9. **Suspected bugs** go in the area's issue, never fixed in the integration (below).
10. **Delete the brief**, `docs/briefs/<area>.md`, in the same PR. Briefs are the only
   docs that point at the contract's source; shipped docs, code and skills never
   do, so a brief goes once its area is built.

`src/areas/jira/` is the reference integration. Follow its shape:

- `area.ts` (the `defineArea`, with its `request` hook: the base URL, auth headers,
  service name and auth fix for a connection), `client.ts` (every request, sent with
  `apiRequest` from `src/core/api.ts`, which builds it from the hook), and command
  files grouped by subject, each exporting a list that `index.ts` spreads.
- HTTP helpers live in core, so an area never writes its own: a token exchange with
  a cache (the hook's `token`, sent only to the connection's origin or a
  `vendorDomain` named in the area's code), redirects that never leave the
  connection's host (`redirect: 'follow-without-auth'` for a signed download URL,
  with every header dropped), `repointUrl` for a URL the server hands back,
  `as: 'text' | 'ndjson' | 'bytes'`, `apiResponse` for headers, `accept` for a
  non-OK status that's an answer, `multipart` and raw uploads, `apiGraphql`, `paginate`
  (`src/core/paginate.ts`), `poll` (`src/core/poll.ts`), a per-request `timeoutMs`
  and a command's `timeLimitMs` above the 120 s default.
- A command that needs no connection at all (`jira schema`) is `area.command({
  kind: 'area-local', ... })`; it works with no config.
- Files through `ctx.files`, never `node:fs`. Numbers, booleans, enums, JSON objects
  and repeatable flags come from the schema (`z.number()`, `z.boolean()`,
  `z.object()`, `z.array()`); don't parse argv by hand. Where the contract read a
  number with `parseInt`, keep the field a `z.union([z.number(), z.string()])` so it
  stays text, and keep the `parseInt`.
- **Where a command acts** (`--project`, `--repo`, `--owner`, `--instance`, `--env`)
  is a context input in `defineArea({ context })`, never an ordinary flag, so core
  resolves it from the call, the dossier, the git remote and the connection in one
  order (the dossier step is empty until #16, and the git step needs the git reader,
  which isn't wired in yet). The contract's group-level flags (`bitbucket --project --repo`, `github
  --owner --repo`, `ado --collection --organization --project --repo`, `jenkins
  --instance`, `openshift --env --instance`, `dynatrace --env`) are `group` inputs,
  with the contract's spelling in `flags`; a per-command one (`jira --project`) is a
  `command` input the command lists in its `context`, marked `required` where the
  contract failed without it, unless the command has its own fallback (a project in
  `--input-file`); then keep it optional and fill that step with `ctx.supply` (step 3).
  A flag that names a target but never fell back to a setting stays an ordinary
  option (Jira's `fields`, `list-boards`, `list-sprints`); a context input always
  falls back. Give it a `setting` when the connection can hold a
  default, `git` when the remote names it, and `selectsConnection` when the contract
  picked an instance or environment by it. Read it from `ctx.context`. When the
  contract had its own wording for a missing one ("No project specified. Use
  --project or set defaults.sonar.project in config."), keep it with the input's
  `missing: { message, fix? }`; the fix defaults to core's, which names the flag,
  the setting and its env var.
- **Another area's credential** (Kibana on Elasticsearch's key) is `defineArea({
  shares: { area, keys } })`. It declares which keys a connection may pair, nothing
  more: the user pairs one with `<key>From` (`"apiKeyFrom": "es-prod"`), and the
  area's default connection alone also takes the other area's default env value, as
  the documented env chain did. Document the `<key>From` setting in the area's skill file.
  `ctx.resolved.shared` says whether the key came from the other area, for an auth
  error that names which key was sent.
- **`--env` means which environment**, and it's the same input the dossier supplies.
  Name it `env`, give it `selectsConnection` (or an enum schema), and never add a
  second environment flag.
- **A path the contract had in another group** (`deps outdated`, now `artifactory
  outdated`) is an `aliases` entry on the new command; the contract test checks the
  old row against it.
- **A path in the area that a core command answers** (`jenkins instance list`, which
  lists the area's connections) is `defineArea({ coreAliases: { 'instance list':
  'connections list' } })`. Core registers it as an alias of `connections list
  --area jenkins`, with no `--area` flag of its own, so the area's code never sees the
  config. The target must be a core command that takes an `area` input. MCP has the
  core tool, with its `area` field. The area's group flags (`openshift --env`)
  are refused on it by name, in the path the user typed.
- **An error code the area needs** (`JENKINS_BUILD_FAILED`) goes into core's
  `ErrorCode` list in `src/core/errors.ts`, with a one-line comment, the way
  `DATABASE` and `GIT_NOT_FOUND` did. Codes are an open set to callers, not to the
  type: the list keeps a misspelt code a type error, so there's no cast and no
  escape hatch. Prefer an existing code when one fits.
- **A success the contract exited non-zero on** (`jenkins pipeline run --wait` on a
  failed build) calls `ctx.setExitCode(1)` and returns its data. The envelope stays
  `ok: true` with the same `data`; the CLI exits 1; MCP returns the same envelope and
  doesn't mark it as an error. Never turn such a success into an error envelope.
- **A command an agent must never call** (a delete) sets `mcp: false`. It keeps its
  connection, context, write gate and time limit on the CLI, is never an MCP tool,
  and its docs page marks it CLI only. The parity suite runs its examples and write
  gate on the CLI.
- **A command the contract ran with the service unconfigured** (`git current-pr`
  answering that Bitbucket isn't set up) sets `connectionOptional: true`. When the
  area has no connection and the call names none, `run` gets `ctx.connection`
  undefined and no context inputs, and answers itself; any other connection problem
  still fails as usual. Only for a read with no required context input.
- **The working repository** (root, current branch, remote URLs) is `ctx.repo()`,
  read from `.git` in pure JS; it spawns nothing and needs no git. Use `ctx.git` only
  for a command that is git.
- **A git remote parser** gets the call's resolved connection as its second
  argument, so it accepts only a remote on the connection's own host
  (`connection.baseUrl`). An input that `selectsConnection` is read before there is a
  connection, and gets `undefined`.
- **Reading stdin** (`ctx.files.readText('-')`, or an inventory read with no
  `--from`) needs nothing more: on an interactive terminal core refuses at once with
  `INVALID_INPUT` ("Nothing was piped in"), and over MCP `-` refuses too. Never wait
  on a terminal.
- **A required key whose value is the same for everyone** (Figma's `baseUrl`,
  `https://api.figma.com`) gets `defineArea({ examples: { baseUrl: '…' } })`. The
  not-configured and missing-key fixes then say `Set TOIL_FIGMA_BASE_URL (e.g.
  https://api.figma.com)`. It's text for a person, never a default: toil still has
  no hardcoded host.
- **A plain-text error body** (LogScale's query errors) needs nothing: `apiRequest`
  puts its trimmed text after the status (`HTTP 400: <text>`), capped and with URLs
  redacted. A JSON body is read as before.
- **A negated flag** (`--no-with-replies`) maps to its field (`withReplies`) with a
  `.default(true)` schema, since commander sets it true unless the flag is given;
  the parity suite sends `--no-<flag>` for `false`.
- **Engines or variants** whose connections need different keys use `variants`, not a
  hand-built `superRefine`. A password (a database) goes in `secrets` as `{ password:
  'password' }`; a token is the default.
- Fix text names env vars with `area.envName(key)`, never a hard-coded
  `TOIL_<AREA>_…`.
- A read sent as POST (a search) sets `queryByPost: true` and stays `writes: false`.
  A token exchange is not such a POST: the parity suite leaves core's exchange out
  of the read-only check on its own, so don't mark a read `queryByPost` for it.
- An area that drops its cached token itself builds the key with
  `tokenKey(tokenScope(area, ctx.connection), exchange)` from `src/core/token.ts`,
  never by copying the format.
- **Not-configured wording of the area's own** ("OSS Index needs an account…") is
  `defineArea({ notConfigured: { message, fix? } })`; the fix defaults to core's.
- **A key the area no longer accepts** (checkmarx's `clientId`) is `defineArea({
  removed: { clientId: '<what to do instead>' } })`: a `CONFIG_REMOVED_KEY` warning
  in the area's words, and the value is dropped.
- **An old path whose flag value picks the command** (`deps frisk --source <x>`) is
  a row in `ROUTED_ALIASES` in `src/registry.ts`, never an area's own alias. A
  route whose command isn't on `main` yet is skipped; the contract test checks
  the row once every route is registered.
- **An inventory from `deps scan`** (`--from <file>` or stdin) is read with
  `readInventory` from `src/core/inventory.ts`, never parsed in the area.
- **A wait that grows by a fixed step** (`2 s × attempt`) is `poll` with
  `backoff: 'linear'`.
- **A 429 the contract returned at once** is `apiRequest(..., {
  retryRateLimit: false })`, with `accept: [429]` if it's an answer.
- **A request path never takes a `.` or `..` segment**: core refuses one with
  `INVALID_INPUT` before sending (`requests.path` in `docs/bounds.md`), so an
  area needn't check ids for it.
- **A `connectionOptional` command** also runs with `ctx.connection` undefined
  when the default connection exists but only lacks a key (a missing `pat`), with
  a `CONFIG_INCOMPLETE` warning; a key set to something wrong still fails.
- **A fixture whose examples read the repository** (`current-pr`) sets `repo`
  (root, branch, remotes) in `defineFixture`, and `ctx.repo()` returns it on both
  front doors.
- **Two selecting inputs** (`--env prod --instance east`) pick the one connection
  matching both when each alone matches several.
- `jenkins instance remove`-style paths are `coreAliases` onto `connections
  remove`, which takes `--area`.
- Every connection key keeps the contract's name, so its env var does too
  (`apiToken` is `TOIL_JIRA_API_TOKEN`).
- Unit tests assert exact requests through `execute()` and `testContext()`; the
  fixture's canned responses say which shapes came from the contract's tests and
  which were invented from the vendor's docs.
- After registering, run `npx vitest run -u` once to write the site's command list.

Once dossiers are built (`docs/dossiers.md`), an area also declares the zod schema
of its dossier section and a read-only `toil <area> check-dossier` command, and its
section selects a connection by `connection` name or `host`, never by anything else.

**Every change to an integration reviews its site documentation in the same PR.**
That covers a new integration, a new or changed command, a changed credential or
config key, and a raised verification level. Each integration has its own page in
the site's documentation section, and its tile on the integrations board links to
that page:
- **A new integration** adds its page and its board tile with the deep link.
- **A changed integration** reads its page against the change and updates whatever
  is now wrong: setup, credentials, config keys, commands, the verification level.
- **"How it works"** stays high-level. Update it only when a change alters the big
  picture, such as configuration precedence or how credentials are stored.

The PR says which pages it reviewed. A change with no documentation impact says so
explicitly rather than skipping the check.

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
`--from <file>` (see the dependency-analysis section of `docs/integrations.md`). A
group that holds only aliases onto other areas' commands (`deps outdated`) is a
compatibility path, never a place for a command that calls more than one of them.

### Deployment Variants

**Each deployment variant whose API diverges is its own area.** Jira Data Center is
`jira` and Jira Cloud is `jira-cloud`; likewise `confluence` and `confluence-cloud`,
and any other vendor that ships both. Variants never share an area behind a `--cloud`
flag, a config switch or auto-detection. That would mean two code paths behind one
schema, one MCP tool describing two payload shapes, and fixes for one variant quietly
breaking the other.

- Each variant has its own module, config section, credentials, commands, MCP tools
  (`jira_get_issue`, `jira_cloud_get_issue`), skill file, site page and verification
  level. They share only generic HTTP helpers.
- The unsuffixed area is the self-hosted variant, matching the migration command
  contract, so the find-and-replace migration keeps working.
- A Cloud area reuses command names and flags where the operation is the same, and
  differs where the API does (for example, `accountId` where Data Center uses a
  username).
- When the variants differ only in host (GitHub.com and GitHub Enterprise Server),
  they stay one area with a configurable `baseUrl`.
- Env vars follow the area name: `TOIL_JIRA_CLOUD_TOKEN` configures `jira-cloud`.

## Compatibility

This is a requirement, not a principle. toil succeeds an earlier CLI, and people have
skills, scripts and pipelines built on it. Moving them to toil must take **one
case-insensitive find-and-replace** of the contract's name with `toil`. That same
replace also turns its `<OLD>_*` env vars into `TOIL_*`.

- **The contract's implementation is canonical for behavior.** It has been run
  against real systems; toil's unit suite hasn't. Its source is the package named in
  `docs/command-contract.json` (`source.package`), and each integration's issue points
  at the exact directory.
  - **Match, don't reinvent.** Keep its requests, payloads, response shaping and
    edge-case handling.
  - **Rewrite it for toil's style and flow:** one `area.command` per command,
    `ctx.fetch`, `ToilError` with a fix, examples for the parity suite, and HTTP
    mocked with `fakeFetch`. Comments use the deadpan voice in CLAUDE.md's Code
    Comments section.
  - **Match its bugs too, until a live instance proves them** (*principles 4 and 7*;
    **Matching the contract** in CLAUDE.md). Its observable behavior, meaning
    requests, success or failure, the error and `data`, is the specification while
    toil has no live instance, because the unit suite can't tell a bug from a server
    quirk the contract was written around. Validation, defaults, paging, id-or-name
    detection and encoding stay exactly as they were.
  - **Record each suspected bug** in the area's one `suspected-bug` issue (template:
    title `Suspected bugs to verify: <name> (`<area>`)`, label `suspected-bug`),
    appending to it if it exists: where, what, why, confidence, the observable change
    if fixed, and a live check. The test that covers it pins the documented behavior and
    says so.
  - **The only changes allowed** are a change another principle or the Output
    Contract requires, such as a credential reaching a host the user didn't configure
    (flagged `**Security:**` in the issue) or a path an agent passes reaching toil's
    own credentials, made at once and listed as a divergence in
    `docs/divergences/<area>.json` naming the principle; and additive output the contract
    allows, such as `meta.warnings`.
  - **The first live run checks every item.** A confirmed bug is fixed as a declared
    change; a refuted one is closed.
  - Its verification level there is context, not a level here. A new integration still
    starts at `unit`.
  - Cloud variants have no tested contract. They're built against the vendor's
    documented API, and the PR says what they were run against.
- **The documented surface is frozen** in `docs/command-contract.json`: every command path,
  its arguments and its flags, captured from the contract's own help output, and the
  field names of each command's `data`, read from its source by the TypeScript
  checker. That
  file is the only place the contract is named in the repository; issues may name
  it, because building an integration needs the source location.
- **Every integration command in the contract exists in toil at the same path**,
  with the same positional arguments, the same long and short flags, and the same
  accepted values. Output uses the same envelope with the same `data` field names.
  Global flags (`--pretty`, `--verbose`, `--debug`, `--config`,
  `--output-file`) carry over too.
- **Env vars and config keys keep their names** apart from the prefix:
  `<OLD>_JIRA_BASE_URL` becomes `TOIL_JIRA_BASE_URL`, and `jira.baseUrl` stays
  `jira.baseUrl`.
- **toil may add** commands, flags and output fields freely. It may drop or change a
  contract command only where a principle requires it. Each such divergence is listed
  in `docs/divergences/<area>.json` with what to use instead (the format is in
  `docs/command-contract.md`). One example: `deps frisk`
  splits into per-source commands under *principle 3*.
- **A test enforces this.** `test/contract.test.ts` diffs every registered area's
  command paths, aliases, positional arguments and flag spellings against the
  contract, runs every example in the area's fixture and checks the `data` has the
  old command's required field names, and fails on any divergence no file in
  `docs/divergences/` allows. Optional fields and output the contract typed as
  `any` can't be checked that way: compare those with the contract's code by
  hand, and keep its names even where they're awkward (jira's
  `fields --discover` keeps the contract-named `toilType` beside `suggestedType`).
- **Config is rebuilt, not copied.** `toil config import` reads the documented global config
  once, writes toil's config, and moves every secret into the OS credential store
  (see the `secrets` skill). It never modifies or deletes the old files, and it leaves
  repository config files from the contract alone.
