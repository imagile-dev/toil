# Dossiers (design)

Tracking: [#16](https://github.com/imagile-dev/toil/issues/16). Builds on named
connections, [#51](https://github.com/imagile-dev/toil/issues/51).

A **dossier** is everything toil needs to work on one body of work, whether that's
one service or fifty microservices: its repositories, issue-tracker keys and field
names, boards, documentation spaces, quality-gate keys, and the runtime resources of
each environment. Users build one once, usually with an agent doing the discovery,
and toil works out which dossier applies from the folder they're in.

## Three kinds of configuration

| | Holds | Where | Who edits it |
|---|---|---|---|
| **Connections** (#51) | One instance of a service: area, host, credential, `writes` | `~/.toil/config.json` | The user, via `toil connections`. Never an agent over MCP. |
| **Dossiers** | Repos, keys, field names, boards, environments. Names connections; never a host or a secret. | `~/.toil/dossiers/<name>.json` | The user or an agent, via `toil dossier` |
| **Env vars** | Any connection setting, including whole connections, for CI | The process environment | The pipeline |

A dossier is safe to share because it contains nothing secret and points nowhere by
itself: an imported dossier only resolves against connections the importer already has.

There is no repository-level config file. It was removed before the first release
(#13): a file in a repository could switch on writes or send credentials to a host of
its choosing. Dossiers carry the project knowledge it used to, from the user's own
folder. Nothing has been released, so this breaks no one.

## Connections

The connection model, including where secrets live, is specified in #51. What
dossiers rely on:

```jsonc
// ~/.toil/config.json
{
  "version": 2,
  "connections": {
    "corp-jira":  { "area": "jira",       "baseUrl": "https://jira.imagile.dev" },
    "jira-cloud": { "area": "jira-cloud", "baseUrl": "https://imagile.atlassian.net", "email": "you@example.com", "writes": true },
    "ocp-prod":   { "area": "openshift",  "baseUrl": "https://api.ocp.imagile.dev:6443" }
  },
  "defaults": { "jira": "corp-jira" }
}
```

- An area can have any number of connections. `defaults` picks one per area when
  nothing else does.
- `writes` is per connection, so writes can be on for a sandbox and off for production.
- **Version 1 still loads**, as one connection per area named after the area and set
  as its default.

### Connections from env vars alone

CI has no config file, so env vars can define a connection from scratch:

```
TOIL_CONN_OCP_PROD_AREA=openshift
TOIL_CONN_OCP_PROD_BASE_URL=https://api.ocp.imagile.dev:6443
TOIL_CONN_OCP_PROD_TOKEN=...
```

- **`TOIL_CONN_<NAME>_AREA` creates the connection.** Other `TOIL_CONN_<NAME>_*`
  variables set its keys, overriding config for a connection that also exists there.
- **Names can't be ambiguous.** A connection name is lowercase letters, digits and
  single hyphens (`corp-jira`, never `corp_jira`), so its env form (`CORP_JIRA`) maps
  back to exactly one name. A variable is matched to the longest known connection name
  first, then its remainder must be a key the connection's area declares. A remainder
  that isn't a declared key is a `CONFIG_UNKNOWN_KEY` warning, never a guess. When two
  names could both claim a variable (`corp` with a key `jiraBaseUrl`, and `corp-jira`),
  `toil config check` reports it.
- **Writes:** `TOIL_CONN_<NAME>_WRITES` is per connection. `TOIL_<AREA>_WRITES` applies
  only to the area's default connection.

## A dossier

```jsonc
// ~/.toil/dossiers/payments.json
{
  "name": "payments",
  "description": "Payments platform",
  "repos": [
    { "name": "payments-api", "path": "C:/Code/payments-api", "remotes": ["https://bitbucket.imagile.dev/scm/pay/payments-api.git"] },
    { "name": "ledger-svc", "remotes": ["https://bitbucket.imagile.dev/scm/pay/ledger-svc.git"] }
  ],
  "jira": {
    "connection": "corp-jira",
    "projects": ["PAY", "LEDG"],
    "fields": { "acceptanceCriteria": "customfield_10234", "storyPoints": "customfield_10002" }
  },
  "ado": { "connection": "corp-ado", "project": "Payments", "boards": ["Payments Team"], "areaPath": "Payments\\API" },
  "confluence": { "connection": "corp-confluence", "spaces": ["PAY"] },
  "sonar": { "connection": "corp-sonar", "projectKeys": { "payments-api": "pay-payments-api" } },
  "environments": {
    "test": { "openshift": { "connection": "ocp-nonprod", "namespace": "payments-test" } },
    "prod": {
      "openshift": { "connection": "ocp-prod", "namespace": "payments-prod", "deployments": ["payments-api", "ledger-svc"] },
      "dynatrace": { "connection": "corp-dt", "entities": ["SERVICE-abc12345"] }
    }
  }
}
```

- Each area defines the shape of its own section with a zod schema, registered next to
  its commands. A dossier is validated section by section, so an unknown area's section
  is kept but reported by `toil dossier check`, never dropped.
- `connection` is optional where the area's default will do.
- **Remotes are only for matching.** toil never contacts a remote URL. Before storing,
  comparing or printing one, toil strips any userinfo
  (`https://user:<token>@host/...` becomes `https://host/...`), so a token embedded in
  `.git/config` never reaches a dossier or an envelope. A dossier that still contains
  a remote with userinfo, hand-edited or imported, fails `dossier check`.

### Field aliases

`fields` maps friendly names to the service's field ids, so field ids never leak into
prompts. The names are used through **one fixed input**, never through generated flags:

- Commands that take custom fields have a `fields` input: an object of alias to value.
  On the CLI it's `--field <alias>=<value>`, repeatable. The schema is the same
  whichever dossier resolves, so MCP tool schemas stay fixed and the CLI and MCP stay
  identical.
- Aliases live in their own namespace, so `--field project=...` can never collide with
  `--project`. An alias is a camelCase identifier; anything else fails `dossier check`.
- An alias the resolved dossier doesn't define is `INVALID_INPUT`, with a fix naming
  the aliases it does define.

## Resolving context

For each command, toil works out the dossier, the repo and the environment from one
resolver, fed the same way by both front doors:

1. Explicit input: `dossier` and `env` (`--dossier`, `--env` on the CLI), or
   `TOIL_DOSSIER` and `TOIL_ENV`.
2. Otherwise a **path**. The CLI passes its working directory. MCP has no meaningful
   working directory, since a stdio server starts wherever its client launched it, so
   it takes an explicit `path` input when given, and otherwise the client's MCP root
   if the client reports exactly one. With neither, there is no path, and step 3
   applies.
3. From a path, toil finds the git root and matches a repo by `path`, then by
   `remotes` against the folder's origin, so a fresh clone anywhere still resolves.
4. Otherwise there is no dossier, and commands need their keys as inputs, exactly as
   without dossiers.

Explicit inputs always beat dossier defaults. `meta.context` in the envelope reports
what was resolved and from where (dossier, repo, environment, connection per area,
and whether the path came from the cwd, an input or an MCP root), so an agent can see
why a command used the keys it did. Dossiers are read on every call, so an edit made
while `toil mcp` is running applies from the next call; the tool list never depends
on dossier content.

### Reading git without git

*No Executables*: toil never runs `git` to find a root or a remote. It parses the
files directly:

- `.git` may be a directory, or a **file** containing `gitdir: <path>` (worktrees and
  submodules). For worktrees, `commondir` points at the shared config.
- `config` is read with `[include] path` and `[includeIf "gitdir:..."]` honoured.
  Other `includeIf` conditions are skipped and reported in `meta.warnings`.
- Remotes are normalised before comparison: userinfo stripped, scp-style
  `git@host:path` read as `ssh://host/path`, host lowercased, a trailing `.git` and
  `/` dropped, and the scheme ignored, so the SSH and HTTPS remotes of one repo match.

## Commands

- **Building a dossier:**
  - `toil dossier init <name>` creates one.
  - `toil dossier add-repo <name> <path|remote>` adds a repo.
  - `toil dossier link <name> <area> [--connection ...] [--project ...]` attaches an
    area. Each area defines which link inputs it takes.
  - `toil dossier field <name> <area> <alias> <field-id>` names a field.
  - `toil dossier env <name> <env> <area> ...` adds an environment resource.
- **Reading and checking:**
  - `toil dossier list` lists dossiers.
  - `toil dossier show <name>` prints one.
  - `toil dossier check <name>` checks **locally only**: the schema, that every named
    connection exists, unknown sections, aliases, and remotes free of userinfo. It
    contacts no service.
  - `toil dossier context` shows what the current folder resolves to.
- **Checking against the services** is one area at a time, because a command talks to
  one service: `toil <area> check-dossier <name>` verifies that area's section
  (projects and fields exist in Jira, namespaces are reachable in OpenShift), using
  and reporting the connection it resolved. An agent or a script composes them.
- **Sharing:** `toil dossier export <name>` and `toil dossier import <file>`. An import
  never creates connections; any connection it names that doesn't exist yet is
  reported as one to create.
- **Discovery** is read-only and runs through ordinary connections. It's ordinary area
  commands, not dossier magic: `toil repos scan <folder>` (local git repos and their
  remotes), `toil jira fields --project PAY`, `toil ado boards`,
  `toil openshift namespaces`, `toil sonar projects --search payments`.

## Agents and the write gate

The intended setup is a conversation. The agent runs discovery, proposes a dossier,
the user confirms, and the agent applies it with the `dossier` commands.

- **Agents may** read and write dossiers. They are local and non-secret, and every
  edit goes through the same validated commands. Writing a dossier is a local write,
  so it doesn't need `--allow-write`, which governs changes to remote systems.
- **Agents never** create or change connections, credentials or `writes`
  (*principle 2*). No tool for those exists over MCP.
- **Agents can't point a dossier at writes.** Over MCP, `dossier link` and the other
  dossier edits refuse to set a `connection` to one with `writes: true`, or to change
  a binding that currently points at one. Binding a dossier to a writes-enabled
  connection is done on the CLI, by a human. Otherwise an agent could repoint
  `payments` from `corp-jira` to a writes-enabled `jira-cloud` and loosen its own
  limits without touching a single gate.

**When write tools are registered:** an area's write tools are listed over MCP when
**any** of that area's connections has `writes: true`. Listing a tool grants nothing:
every call still resolves its one connection, and the gate is checked against that
connection (`writes: true` on it, plus `allowWrite` on the call). A write that
resolves to a read-only connection fails with `WRITE_DISABLED`, naming the connection.
Turning writes on for a connection is a human decision about that connection
wherever it's used, including dossiers already bound to it.

## Security notes

- A dossier can't introduce a host or a credential, so importing one from a teammate,
  or an agent editing one, can't redirect where secrets go. Remotes are URLs, but toil
  only compares them and never contacts them.
- Dossier files are written with user-only permissions, as is the config.
- Paths are stored as given and compared after normalising case and separators on
  Windows (*principle 8*).

## Open questions

1. **Where a dossier names a connection the user doesn't have:** a hard error, or a
   warning, with the area falling back to explicit inputs?
2. **Precedence among several dossiers containing the same repo:** a repo shared by
   two dossiers is possible (a platform library, say). The proposal is that the
   explicit `dossier` input wins, otherwise the most recently used.
3. **Team-level sharing beyond files:** is there a need to load dossiers from a shared
   location (a git repo of dossiers)? Not in v1.
