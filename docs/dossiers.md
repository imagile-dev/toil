# Dossiers (design)

Tracking: [#16](https://github.com/imagile-dev/toil/issues/16)

A **dossier** is everything toil needs to work on one body of work, whether that's
one service or fifty microservices: its repositories, issue-tracker keys and field
names, boards, documentation spaces, quality-gate keys, and the runtime resources of
each environment. Users build one once, usually with an agent doing the discovery,
and toil works out which dossier applies from the folder they're in.

## Three kinds of configuration

| | Holds | Where | Who edits it |
|---|---|---|---|
| **Connections** | One instance of a service: area, host, credential reference, `writes` | `~/.toil/config.json` | The user, via `toil config`. Never an agent over MCP. |
| **Dossiers** | Repos, keys, field names, boards, environments. Names connections; never a host or a secret. | `~/.toil/dossiers/<name>.json` | The user or an agent, via `toil dossier` |
| **Env vars** | Any connection setting, for CI | The process environment | The pipeline |

Credentials stay in the OS credential store; connections hold `keychain:` references.
A dossier is safe to share because it contains nothing secret and points nowhere by
itself: an imported dossier only resolves against connections the importer already has.

## Connections

```jsonc
// ~/.toil/config.json
{
  "version": 2,
  "connections": {
    "corp-jira":  { "area": "jira",       "baseUrl": "https://jira.imagile.dev",      "token": "keychain:corp-jira" },
    "jira-cloud": { "area": "jira-cloud", "baseUrl": "https://imagile.atlassian.net", "email": "you@example.com", "token": "keychain:jira-cloud", "writes": true },
    "ocp-prod":   { "area": "openshift",  "baseUrl": "https://api.ocp.imagile.dev:6443", "token": "keychain:ocp-prod" }
  },
  "defaults": { "jira": "corp-jira" }
}
```

- An area can have any number of connections. `defaults` picks one per area when
  nothing else does.
- `writes` is per connection, so writes can be on for a sandbox and off for production.
- **Version 1 still loads.** The flat `{ "jira": { "baseUrl": ... } }` file reads as one
  connection per area, named after the area and set as that area's default.
  `toil config migrate` rewrites it as version 2, carrying every key through.
- Env vars address the default connection of an area (`TOIL_JIRA_TOKEN`), or a named
  one (`TOIL_CONN_CORP_JIRA_TOKEN`).

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
- `fields` maps friendly names to the service's field ids. Commands accept the friendly
  name (`--acceptance-criteria`) and translate it, so field ids never leak into prompts.

## Resolving context

For each command, toil works out the dossier, the repo and the environment:

1. `--dossier` and `--env`, or `TOIL_DOSSIER` and `TOIL_ENV`
2. Otherwise, the current folder: toil finds the git root, then the repo whose `path`
   matches. Failing that, it matches a repo whose `remotes` include the folder's
   origin, so a fresh clone anywhere still resolves.
3. Otherwise there is no dossier, and commands need their keys as flags, exactly as
   today.

Explicit flags always beat dossier defaults. `meta.context` in the envelope reports
what was resolved (dossier, repo, environment, connection per area), so an agent can
see why a command used the keys it did.

## Commands

- **Building a dossier:**
  - `toil dossier init <name>` creates one.
  - `toil dossier add-repo <name> <path|remote>` adds a repo.
  - `toil dossier link <name> <area> [--connection ...] [--project ...]` attaches an
    area. Each area defines which link flags it takes.
  - `toil dossier field <name> <area> <alias> <field-id>` names a field.
  - `toil dossier env <name> <env> <area> ...` adds an environment resource.
- **Reading and checking:**
  - `toil dossier list` lists dossiers.
  - `toil dossier show <name>` prints one.
  - `toil dossier check <name>` verifies every reference: connections exist, keys and
    fields exist on the service, namespaces are reachable.
  - `toil dossier context` shows what the current folder resolves to.
- **Sharing:** `toil dossier export <name>` and `toil dossier import <file>`. An import
  never creates connections; any connection it names that doesn't exist yet is
  reported as one to create.
- **Discovery** is read-only and runs through ordinary connections. It's ordinary area
  commands, not dossier magic: `toil repos scan <folder>` (local git repos and their
  remotes), `toil jira fields --project PAY`, `toil ado boards`,
  `toil openshift namespaces`, `toil sonar projects --search payments`.

## Agents

The intended setup is a conversation. The agent runs discovery, proposes a dossier,
the user confirms, and the agent applies it with the `dossier` commands. Over MCP:

- **Agents may** read and write dossiers. They are local and non-secret, and every
  edit goes through the same validated commands.
- **Agents never** create or change connections, credentials or `writes`
  (*principle 2*). No tool for those exists over MCP.
- Writing a dossier is a local write, so it does not need `--allow-write`, which
  governs changes to remote systems. `--dry-run` still previews it.

## Security notes

- A dossier can't introduce a host or a credential, so importing one from a teammate,
  or an agent editing one, can't redirect where secrets go. This is the same rule
  that removed the repository-level config file.
- Dossier files are written with user-only permissions, as is the config.
- Paths are stored as given and compared after normalising case and separators on
  Windows (*principle 8*).

## Open questions

1. **Where a dossier names a connection the user doesn't have:** a hard error, or a
   warning, with the area falling back to flags?
2. **Precedence among several dossiers containing the same repo:** a repo shared by
   two dossiers is possible (a platform library, say). The proposal is that the
   explicit `--dossier` wins, otherwise the most recently used.
3. **Env-var addressing for named connections:** `TOIL_CONN_<NAME>_<KEY>` reads
   awkwardly. Is it acceptable?
4. **Team-level sharing beyond files:** is there a need to load dossiers from a shared
   location (a git repo of dossiers)? Not in v1.
