---
name: integrations
description: Rules for toil's enterprise-tool integrations (Jira, Confluence, Bitbucket, SonarQube and every other service area). Use when adding, changing or reviewing an integration or one of its commands, judging whether a requested service can be supported (its authentication), recording or raising a verification level, adding a vendor's Cloud variant (each variant is its own area), reviewing an integration's site documentation page, or touching anything covered by the migration command contract (docs/command-contract.json, docs/command-contract.md, `toil config import`, command paths, flags, env var and config key names). Not needed for databases, code intelligence or the MCP server alone.
---

# Integrations

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

## Adding an Enterprise Integration

Confirm the Authentication Bar first. Then, in one change: `src/areas/<area>/` with
its `defineArea` (connection schema, secrets, CI fallbacks) and its commands, a
`test/fixtures/<area>.fixture.ts`, `config init`/`check`/`test` entries,
`skills/toil/<service>.md`, and its row in `SKILL.md`. This skill holds the
checklist; a test fails when a registered service has no skill file.

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
`--from <file>` (see the dependency-analysis section of `docs/integrations.md`).

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
  - **Rewrite it for toil's style and flow:** one `defineCommand` per command,
    `ctx.fetch`, `ToilError` with a fix, examples for the parity suite, and HTTP
    mocked with `fakeFetch`. Comments use the deadpan voice in CLAUDE.md's Code
    Comments section.
  - **Where it has a bug, fix it and say so in the PR.** Don't port the bug.
  - Its verification level there is context, not a level here. A port still starts
    at `unit`.
  - Cloud variants have no tested predecessor. They're built against the vendor's
    documented API, and the PR says what they were run against.
- **The old surface is frozen** in `docs/command-contract.json`: every command path,
  its arguments, and its flags, captured from the old CLI's own help output. That
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
  in `docs/command-contract.md` with what to use instead. One example: `deps frisk`
  splits into per-source commands under *principle 3*.
- **A test enforces this.** It diffs toil's registered commands and flags against the
  contract and fails on any divergence not listed in `docs/command-contract.md`.
- **Config is rebuilt, not copied.** `toil config import` reads the old global config
  once, writes toil's config, and moves every secret into the OS credential store
  (see the `secrets` skill). It never modifies or deletes the old files, and it leaves
  repository config files from the old CLI alone.
