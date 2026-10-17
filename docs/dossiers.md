# Dossiers (design)

Tracking: [#16](https://github.com/imagile-dev/toil/issues/16). Builds on named
connections, [#51](https://github.com/imagile-dev/toil/issues/51) (core in #59).

A **dossier** is everything toil needs to work on one body of work, whether that's
one service or fifty microservices: its repositories, issue-tracker keys and field
names, boards, documentation spaces, quality-gate keys, and the runtime resources of
each environment. Users build one once, usually with an agent doing the discovery,
and toil works out which dossier applies from the folder they're in. A dossier can be
kept privately or checked into a repository for a whole team to share.

## Three kinds of configuration

| | Holds | Where | Who edits it |
|---|---|---|---|
| **Connections** (#51) | One instance of a service: area, host, credential, `writes` | `~/.toil/config.json` | The user, via `toil connections`. Never an agent over MCP. |
| **Dossiers** | Repos, keys, field names, boards, environments. Selects connections; never holds a secret or turns on writes. | `~/.toil/dossiers/`, or `.toil/dossiers/` in a repository | The user or an agent, via `toil dossier` |
| **Env vars** | Any connection setting, including whole connections, for CI | The process environment | The pipeline |

**Why a dossier may live in a repository when config may not.** There is no
repository-level config file (#13): a file in a repository could switch on writes or
send credentials to a host of its choosing. A dossier can do neither. It holds no
secret and no `writes`, and it only *selects among connections the reader already
has*; it can never create one or send anything to a host. So a checked-in dossier is
project knowledge, reviewable like any other file, and it can't change where
credentials go.

## Connections

The connection model, including where secrets live, is specified in #51 and
implemented in #59. What dossiers rely on:

```jsonc
// ~/.toil/config.json
{
  "version": 2,
  "connections": {
    "corp-jira":  { "area": "jira",       "baseUrl": "https://jira.imagile.dev" },
    "jira-cloud": { "area": "jira-cloud", "baseUrl": "https://imagile.atlassian.net", "email": "you@example.com", "writes": true },
    "ocp-prod":   { "area": "openshift",  "baseUrl": "https://api.ocp.imagile.dev:6443" }
  },
  "defaults": { "jira": { "connection": "corp-jira" } }
}
```

- An area can have any number of connections. `defaults.<area>.connection` picks one
  when nothing else does; other keys under `defaults.<area>` are shared by every
  connection to that area, **except `writes`, which is never read from `defaults`**.
- `writes` is per connection, so writes can be on for a sandbox and off for
  production. It is the control that matters: since #59 every area command takes a
  `connection` input, so whoever runs a command can already choose any connection.
  The dossier rules below stop a dossier from *silently* redirecting a write; they
  aren't what keeps production safe. Per-connection `writes` is.
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
// ~/.toil/dossiers/payments.json, or .toil/dossiers/payments.json in a repository
{
  "name": "payments",
  "description": "Payments platform",
  "repos": [
    { "name": "payments-api", "path": "C:/Code/payments-api", "remotes": ["https://bitbucket.imagile.dev/scm/pay/payments-api.git"] },
    { "name": "ledger-svc", "remotes": ["https://bitbucket.imagile.dev/scm/pay/ledger-svc.git"] }
  ],
  "jira": {
    "host": "jira.imagile.dev",
    "projects": ["PAY", "LEDG"],
    "fields": { "acceptanceCriteria": "customfield_10234", "storyPoints": "customfield_10002" }
  },
  "ado": { "connection": "corp-ado", "project": "Payments", "boards": ["Payments Team"], "areaPath": "Payments\\API" },
  "confluence": { "host": "confluence.imagile.dev", "spaces": ["PAY"] },
  "sonar": { "host": "sonar.imagile.dev", "projectKeys": { "payments-api": "pay-payments-api" } },
  "environments": {
    "test": { "openshift": { "host": "api.ocp-nonprod.imagile.dev", "namespace": "payments-test" } },
    "prod": {
      "openshift": { "host": "api.ocp.imagile.dev", "namespace": "payments-prod", "deployments": ["payments-api", "ledger-svc"] },
      "dynatrace": { "host": "abc12345.live.dynatrace.com", "entities": ["SERVICE-abc12345"] }
    }
  }
}
```

- Each area defines the shape of its own section with a zod schema, registered next to
  its commands. A dossier is validated section by section, so an unknown area's section
  is kept but reported by `toil dossier check`, never dropped.
- **Remotes are only for matching.** toil never contacts a remote URL. Before storing,
  comparing or printing one, toil strips any userinfo
  (`https://user:<token>@host/...` becomes `https://host/...`), so a token embedded in
  `.git/config` never reaches a dossier or an envelope. A dossier that still contains
  a remote with userinfo, hand-edited or imported, fails `dossier check`.

### Selecting a connection

Each area section says which of the reader's connections it means, in one of two ways:

- **`connection`: a name.** Right for a private dossier: `"connection": "corp-ado"`.
- **`host`: a selector.** Right for a shared one, because teammates name their
  connections differently. `"host": "jira.imagile.dev"` picks the reader's `jira`
  connection whose `baseUrl` has that host (compared case-insensitively, scheme and
  port ignored unless the selector gives a port).
- **Neither:** the area's default connection.

A host in a dossier is **only a selector**. toil never sends a request to it, never
creates a connection from it, and never uses it as a `baseUrl`. When no connection
matches, the call fails with `NOT_CONFIGURED`, naming the host and the command to add
a connection for it. When several match, it fails with `INVALID_INPUT`, listing them
and saying to pick one with `connection`. A selector never falls back to the default
connection, because a silent fallback could point the dossier somewhere the author
didn't mean.

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

## Where dossiers live

toil reads dossiers from three kinds of place, and every listing says which one a
dossier came from (`source`: `user`, `repo`, `listed`, or `file` for one passed by
path):

1. **Your own**, in `~/.toil/dossiers/<name>.json`.
2. **Checked into the repository you're in**, in `.toil/dossiers/*.json` at its git
   root. A service's repo can carry its own dossier.
3. **Folders you list**, for a team that shares dossiers for many services from one
   repository: clone it once and list its folder. Only folders you list are read;
   toil never searches for them.
   - In config, a top-level `"dossierPaths": ["C:/Code/team-dossiers/.toil/dossiers"]`
     in a version 2 file. It's added to the reserved top-level keys when dossiers are
     built, so it's never read as an area.
   - From env, `TOIL_DOSSIER_PATHS`, separated by the platform's path delimiter (`;`
     on Windows, `:` elsewhere). It replaces the config's list, as env always wins.
     Every `TOIL_DOSSIER*` name is reserved, so no area can ever claim it.

A checked-in dossier applies only when you're in its repository, or when its folder
is listed.

**Which dossier applies is never a guess.**
- **Same name in two places:** your own wins, then a listed folder, then the
  repository you're in. So you can override a teammate's copy without editing it.
- **Different dossiers that both match** (two files in one repository, or your own
  `payments` and the repo's `payments-team`), with no explicit `dossier`: the call
  fails with `INVALID_INPUT` listing the candidates and saying to pass `dossier`.
  The answer never depends on hidden state such as which was used last.

## Validation on every read

A dossier is checked **every time toil reads it**, not only by `dossier check`, and
problems show up where they'll be seen. That means a warning in `meta.warnings` on
whatever command read it, and the same list from `dossier check`. A dossier with a
problem still loads where it safely can. A broken one doesn't, and the error says
which file and which key.

**A key added twice is always reported:**
- **Twice in the file.** `JSON.parse` keeps the last of two identical keys and drops
  the first without a word. toil reads dossiers with a parser that sees duplicates,
  and reports `DOSSIER_DUPLICATE_KEY` with the key path (`jira.fields.storyPoints`).
- **Twice in a list:** the same repo name, remote, project, field id, board or
  deployment. Remotes are compared after normalising.
- **Twice across files:** the same dossier name in two places (see **Where dossiers
  live**) is a warning naming both files, even when precedence settles which one
  wins.

**The commands never add a duplicate.** `dossier add-repo`, `field`, `link` and `env`
refuse a key that's already there with `INVALID_INPUT`, naming the existing entry.
Changing it is an explicit replace (`--replace`), never a silent second copy.

## Resolving context

For each command, toil works out the dossier, the repo and the environment from one
resolver, **fed identically by both front doors**:

1. **Explicit input:** `dossier` and `env` (`--dossier`, `--env` on the CLI), or
   `TOIL_DOSSIER` and `TOIL_ENV`. `dossier` is a name, or a path to a dossier file, so
   a pipeline can use a checked-in dossier with no home folder.
2. **Otherwise a folder, `cwd`.** `cwd` is an input on every command that resolves
   context, on both front doors (`--cwd <dir>` on the CLI, `cwd` over MCP). The name
   says what it stands in for, and it can't clash with a command's own path input
   (a folder for `repos scan`). Only its default differs: the CLI
   uses its working directory, and MCP uses the client's MCP root if the client
   reports exactly one. A stdio server starts wherever its client launched it, so its
   own working directory means nothing. With neither, there is no folder, and step 4
   applies.
3. **From that folder,** toil finds the git root and matches a repo by `path`, then by
   `remotes` against the folder's origin, so a fresh clone anywhere still resolves. A
   dossier checked into that repository is a candidate too (see **Where dossiers
   live**).
4. **Otherwise** there is no dossier, and commands need their keys as inputs, exactly
   as without dossiers.

Explicit inputs always beat dossier defaults. `meta.context` in the envelope reports
what was resolved and from where: the dossier and its `source`, the repo, the
environment, the connection per area and how it was selected (name, host or default),
and whether the folder came from the `cwd` input, the CLI's working directory or an
MCP root. Dossiers are
read on every call, so an edit made while `toil mcp` is running applies from the next
call; the tool list never depends on dossier content.

### The filesystem the server sees

Every file location is an explicit input on both front doors: `cwd`, `--repo`, a
dossier file, an import source. That keeps the CLI and MCP 1:1. The defaults are the
only difference, and `meta.context` names them. The server can only use paths on its
own filesystem, so:

- MCP roots arrive as `file://` URIs and are converted with Node's own URL handling,
  never by string slicing.
- A path that doesn't exist on the server's side is an `INVALID_INPUT` that says so.
  It isn't a silent "no dossier". That's what an agent in a sandbox, a container, or
  WSL talking to a Windows server will see, and it can then pass `dossier` by name.
- The planned MCP gateway (#4) shares no filesystem with its clients. There, path
  inputs are refused with that explanation, and dossiers are selected by name.

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
  - `toil dossier link <name> <area> [--connection <name> | --host <host>] [--project ...]`
    attaches an area. Each area defines which link inputs it takes.
  - `toil dossier field <name> <area> <alias> <field-id>` names a field.
  - `toil dossier env <name> <env> <area> ...` adds an environment resource.
- **Reading and checking:**
  - `toil dossier list` lists every dossier toil can see, with its `source`.
  - `toil dossier show <name|file>` prints one.
  - `toil dossier check <name|file>` checks **locally only**:
    - the schema, unknown sections and aliases
    - every `connection` exists and every `host` selects exactly one connection
    - remotes are free of userinfo

    It contacts no service.
  - `toil dossier context [--cwd <dir>]` shows what a folder resolves to.
- **Checking against the services** is one area at a time, because a command talks to
  one service: `toil <area> check-dossier <name>` verifies that area's section
  (projects and fields exist in Jira, namespaces are reachable in OpenShift), using
  and reporting the connection it resolved. An agent or a script composes them.
- **Sharing through a repository:**
  - `toil dossier export <name> --repo <dir>` writes `.toil/dossiers/<name>.json`
    into that working tree. It's written for sharing: a `connection` name is replaced
    by a `host` selector taken from that connection's `baseUrl`, and `path` entries,
    which are machine-specific, are dropped. toil writes the file and stops; it never
    stages or commits. Committing is the agent's or user's own git workflow.
  - `toil dossier export <name> --file <path>` writes a single file, for any other kind
    of sharing.
  - `toil dossier import <file|dir>` copies a dossier into your own folder, so you
    can adapt it. An import never creates connections; any connection or host it
    can't resolve is reported as one to set up.
- **Where export may write.** Exports are bounded, because over MCP an agent chooses
  the path:
  - `--repo` must be a git root, found the way **Reading git without git** finds one.
  - `--file` must end in `.json`, and may not be inside `~/.toil/` unless it's under
    `~/.toil/dossiers/`, so an export can never replace the config.
  - Neither overwrites a file that isn't already a valid dossier. Replacing an
    existing dossier needs `--replace`.
- **What import reveals.** An import that fails reports schema problems only, by key
  path, and never echoes the file's content. Pointing it at `config.json` can't read
  connections back out.
- **Discovery** is read-only and runs through ordinary connections. It's ordinary area
  commands, not dossier magic: `toil repos scan <folder>` (local git repos and their
  remotes), `toil jira fields --project PAY`, `toil ado boards`,
  `toil openshift namespaces`, `toil sonar projects --search payments`.

## Agents and the write gate

The intended setup is a conversation. The agent runs discovery, proposes a dossier,
the user confirms, and the agent applies it with the `dossier` commands, including
exporting it into a repository for the team.

- **Agents may** read and write dossiers, in your folder and in a repository working
  tree. They are non-secret and every edit goes through the same validated commands.
  Writing a dossier is a local write, so it doesn't need `--allow-write`, which
  governs changes to remote systems.
- **Agents never** create or change connections, credentials or `writes`
  (*principle 2*). No tool for those exists over MCP.
- **A dossier never silently points a write somewhere new.** Over MCP, the dossier
  commands refuse any change that would make a section select a connection with
  `writes: true` when it didn't before:
  - setting `connection` or `host` to one that selects such a connection
  - changing or clearing a binding when the result is a writes-enabled connection,
    including a fall-back to the area's default
  - importing or exporting a dossier with such a binding

  Binding a dossier to a writes-enabled connection is done on the CLI, by a human.
  **Checked-in and listed-folder dossiers** follow the same rule when they're read: a
  section whose `connection` or `host` lands on a writes-enabled connection is
  reported by `dossier check`, and a write through it fails until the user adopts the
  dossier with `toil dossier import`. Then the binding is theirs.
- **Only an explicit binding counts.** A section with no `connection` or `host`, or no
  section at all, selected nothing: the call uses your own default connection, which
  was always yours to set, and a checked-in dossier doesn't change that. An explicit
  `connection` input on the call also goes through, since you chose it. So the error
  for a blocked write offers both fixes: pass `--connection`, or `dossier import`.

**When write tools are registered:** an area's write tools are listed over MCP when
**any** of that area's connections has `writes: true`. Listing grants nothing: every
call still resolves its one connection, and the gate is checked against that
connection (`writes: true` on it, plus `allowWrite` on the call). A write that
resolves to a read-only connection fails with `WRITE_DISABLED`, naming the connection.
Turning writes on for a connection is a human decision about that connection
wherever it's used, including dossiers already bound to it.

## Security notes

- **A dossier can't introduce a host to talk to or a credential.** Importing one from a
  teammate, checking one into a repo, or an agent editing one can't redirect where
  secrets go. Hosts in a dossier are selectors among the reader's own connections, and
  remotes are only compared. toil contacts neither.
- **Repository dossiers are read only from the repository you're in and from folders you
  list.** toil never scans the disk for them.
- **File permissions:** dossier files in `~/.toil/` are written with user-only
  permissions, as is the config. Files in a repository take the repository's.
- **Paths** are stored as given and compared after normalising case and separators on
  Windows (*principle 8*).

## Open questions

1. **Where a dossier names a connection the user doesn't have:** a hard error, or a
   warning, with the area falling back to explicit inputs?
