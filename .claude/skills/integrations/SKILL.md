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
diverges. Every one of those files is the area's own; no port edits a shared list.
`test/skills.test.ts` fails when a registered area has no skill file, the file has no
frontmatter, or it misses a command, a connection key's env var or the supported
versions.

### Porting an area, step by step

1. **Read the brief**, `docs/briefs/<area>.md`: auth, paging, special HTTP needs,
   context inputs, the suspected-bug issue and the supported version. Then read the
   predecessor's `src/services/<area>/`, which the brief summarizes and which wins
   where they disagree.
2. **Stub it**: `node scripts/stub-area.mjs <area>` writes `src/areas/<area>/` with
   one `area.command()` per contract command (exact path, arguments and flags, each
   `run` throwing until ported), plus the fixture and skill file. It never
   overwrites, and it leaves out commands a divergence removes. Group-level flags
   become the area's context inputs in `area.ts`, with a TODO for where each value
   comes from (a connection setting, the git remote, or selecting the connection).
3. **Port each command**: request, paging, errors and `data` exactly as the
   predecessor had them, through `ctx.fetch` and core's helpers. Set `writes`
   from what the old command does; the stub only guessed from the verb.
4. **Fixture**: canned responses for every request the examples send, as routes on
   method, `path` and `query`. Local state goes in `setup`/`teardown`; a non-HTTP
   area names what to `trace`.
5. **Supported version**: export `supported` from `index.ts`, set the same value in
   the board entry, and state it in the skill file. An error that means the server
   is too old uses `serverTooOld()` from `src/core/supported.ts`, so its message says so and names
   the minimum.
6. **Contract**: `test/contract.test.ts` checks paths, flags and output field names.
   Anything a principle makes you change goes in `docs/divergences/<area>.json`.
7. **Docs**: `npx vitest run -u` writes `site/src/data/commands/<area>.json`; set the
   board entry's `status` to `unit`; review the docs page and take its screenshots
   with `node scripts/shoot.mjs docs/integrations/<area>/` (the `site` skill).
8. **Suspected bugs** go in the area's issue, never fixed in the port (below).
9. **Delete the brief**, `docs/briefs/<area>.md`, in the same PR. Briefs are the only
   docs that point at the predecessor's source; shipped docs, code and skills never
   do, so a brief goes once its area is ported.

`src/areas/jira/` is the reference port. Follow its shape:

- `area.ts` (the `defineArea`), `client.ts` (every request, built on `restRequest`
  and `buildUrl` from `src/core/rest.ts`, with the area's headers and auth fix), and
  command files grouped by subject, each exporting a list that `index.ts` spreads.
- A command that needs no connection at all (`jira schema`) is `area.command({
  kind: 'area-local', ... })`; it works with no config.
- Files through `ctx.files`, never `node:fs`. Numbers, booleans, enums, JSON objects
  and repeatable flags come from the schema (`z.number()`, `z.boolean()`,
  `z.object()`, `z.array()`); don't parse argv by hand. Where the predecessor read a
  number with `parseInt`, keep the field a `z.union([z.number(), z.string()])` so it
  stays text, and port the `parseInt`.
- **Where a command acts** (`--project`, `--repo`, `--owner`, `--instance`, `--env`)
  is a context input in `defineArea({ context })`, never an ordinary flag, so core
  resolves it from the call, the dossier, the git remote and the connection in one
  order (the dossier step is empty until #16, and the git step needs the git reader,
  which isn't wired in yet). The predecessor's group-level flags (`bitbucket --project --repo`, `github
  --owner --repo`, `ado --collection --organization --project --repo`, `jenkins
  --instance`, `openshift --env --instance`, `dynatrace --env`) are `group` inputs,
  with the contract's spelling in `flags`; a per-command one (`jira --project`) is a
  `command` input the command lists in its `context`, marked `required` where the
  predecessor failed without it. Give it a `setting` when the connection can hold a
  default, `git` when the remote names it, and `selectsConnection` when the old CLI
  picked an instance or environment by it. Read it from `ctx.context`.
- **Another area's credential** (Kibana on Elasticsearch's key) is `defineArea({
  shares: { area, keys } })`. It declares which keys a connection may pair, nothing
  more: the user pairs one with `<key>From` (`"apiKeyFrom": "es-prod"`), and the
  area's default connection alone also takes the other area's default env value, as
  the old env chain did. Document the `<key>From` setting in the area's skill file.
  `ctx.resolved.shared` says whether the key came from the other area, for an auth
  error that names which key was sent.
- **`--env` means which environment**, and it's the same input the dossier supplies.
  Name it `env`, give it `selectsConnection` (or an enum schema), and never add a
  second environment flag.
- **A path the old CLI had in another group** (`deps outdated`, now `artifactory
  outdated`) is an `aliases` entry on the new command; the contract test checks the
  old row against it.
- **Engines or variants** whose connections need different keys use `variants`, not a
  hand-built `superRefine`. A password (a database) goes in `secrets` as `{ password:
  'password' }`; a token is the default.
- Fix text names env vars with `area.envName(key)`, never a hard-coded
  `TOIL_<AREA>_…`.
- A read sent as POST (a search) sets `queryByPost: true` and stays `writes: false`.
- Every connection key keeps the predecessor's name, so its env var does too
  (`apiToken` is `TOIL_JIRA_API_TOKEN`).
- Unit tests assert exact requests through `execute()` and `testContext()`; the
  fixture's canned responses say which shapes came from the predecessor's tests and
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

## Migration Compatibility

This is a requirement, not a principle. toil succeeds an earlier CLI, and people have
skills, scripts and pipelines built on it. Moving them to toil must take **one
case-insensitive find-and-replace** of the old CLI's name with `toil`. That same
replace also turns its `<OLD>_*` env vars into `TOIL_*`.

- **The predecessor's implementation is canonical for behavior.** It has been run
  against real systems; toil's unit suite hasn't. Its source is the package named in
  `docs/command-contract.json` (`source.package`), and each integration's issue points
  at the exact directory.
  - **Port, don't reinvent.** Keep its requests, payloads, response shaping and
    edge-case handling.
  - **Rewrite it for toil's style and flow:** one `area.command` per command,
    `ctx.fetch`, `ToilError` with a fix, examples for the parity suite, and HTTP
    mocked with `fakeFetch`. Comments use the deadpan voice in CLAUDE.md's Code
    Comments section.
  - **Port its bugs too, until a live instance proves them** (*principles 4 and 7*;
    **Porting** in CLAUDE.md). Its observable behavior, meaning requests, success
    or failure, the error and `data`, is the specification while toil has no live
    instance, because the unit suite can't tell a bug from a server quirk the old
    code was written around. Validation, defaults, paging, id-or-name detection and
    encoding stay exactly as they were.
  - **Record each suspected bug** in the area's one `suspected-bug` issue (template:
    title `Suspected predecessor bugs: <name> (`<area>`)`, label `suspected-bug`),
    appending to it if it exists: where, what, why, confidence, the observable change
    if fixed, and a live check. The test that covers it pins the old behavior and
    says so.
  - **The only changes allowed** are a change another principle or the Output
    Contract requires, such as a credential reaching a host the user didn't configure
    (flagged `**Security:**` in the issue) or a path an agent passes reaching toil's
    own credentials, made at once and listed as a divergence in
    `docs/divergences/<area>.json` naming the principle; and additive output the contract
    allows, such as `meta.warnings`.
  - **The first live run checks every item.** A confirmed bug is fixed as a declared
    change; a refuted one is closed.
  - Its verification level there is context, not a level here. A port still starts
    at `unit`.
  - Cloud variants have no tested predecessor. They're built against the vendor's
    documented API, and the PR says what they were run against.
- **The old surface is frozen** in `docs/command-contract.json`: every command path,
  its arguments and its flags, captured from the old CLI's own help output, and the
  field names of each command's `data`, read from its source by the TypeScript
  checker. That
  file is the only place the predecessor is named in the repository; issues may name
  it, because porting needs the source location.
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
  `docs/divergences/` allows. Optional fields and output the old code typed as
  `any` can't be checked that way: compare those with the predecessor's code by
  hand, and keep its names even where they're awkward (jira's
  `fields --discover` keeps the predecessor-named `pncliType` beside `suggestedType`).
- **Config is rebuilt, not copied.** `toil config import` reads the old global config
  once, writes toil's config, and moves every secret into the OS credential store
  (see the `secrets` skill). It never modifies or deletes the old files, and it leaves
  repository config files from the old CLI alone.
