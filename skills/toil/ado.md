---
area: ado
description: Work items, git repositories, pull requests and pipelines on Azure DevOps Server
---

# Azure DevOps Server (`ado`)

Work items, git repositories, pull requests and pipelines on **Azure DevOps Server**
(on-premises), through its REST API with `api-version=7.1`. Verification level:
`unit`.

**Supported versions:** Azure DevOps Server 2022.1 or later (REST API 7.1). Requests
send `api-version=7.1` (`7.1-preview.1` for connection data, `7.1-preview.4` for work
item comments), which newer servers also accept. Azure DevOps Server 2022 RTM, 2020
and 2019 are out of scope: an older server's "REST API version out of range" answer
comes back as an error saying the server is too old for toil and naming 2022.1.

## Credential

An Azure DevOps **personal access token**: in Azure DevOps, User settings → Personal
access tokens → New Token. Give it the scopes the commands you'll use need (Work
Items, Code, Build; Read & write for the write commands). toil sends it as
`Authorization: Basic base64(":" + token)`, with an empty user name. There is no
password or browser login.

In an Azure Pipelines job, the job's own token, `SYSTEM_ACCESSTOKEN`, is read when
`TOIL_ADO_PAT` isn't set (for the default connection, and before anything in the
config file), so a pipeline step needs only `TOIL_ADO_BASE_URL`. Map it into the
step's environment (`env: SYSTEM_ACCESSTOKEN: $(System.AccessToken)`).

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_ADO_BASE_URL` | yes | Server root, e.g. `https://ado.imagile.dev` (keep any context path, such as `/tfs`) |
| `pat` | `TOIL_ADO_PAT` (or `SYSTEM_ACCESSTOKEN`) | yes | Personal access token |
| `collection` | `TOIL_ADO_COLLECTION` | no | Default collection, when `--collection` isn't given |
| `project` | `TOIL_ADO_PROJECT` | no | Default team project, when `--project` isn't given |
| `repo` | `TOIL_ADO_REPO` | no | Default git repository, when `--repo` isn't given |
| `fieldAliases` | `TOIL_ADO_FIELD_ALIASES` | no | Work item field aliases as a JSON object, friendly name to reference name, e.g. `{"storypoints": "Microsoft.VSTS.Scheduling.StoryPoints"}` |
| `discoveredFields` | `TOIL_ADO_DISCOVERED_FIELDS` | no | Fields an earlier discovery recorded; kept, not read |
| `discoveredTypes` | `TOIL_ADO_DISCOVERED_TYPES` | no | Work item types an earlier discovery recorded; kept, not read |
| `writes` | `TOIL_ADO_WRITES` | no | `true` lets write commands run (with `--allow-write`) |

Environment variables (CI, or a one-off shell):

```bash
export TOIL_ADO_BASE_URL=https://ado.imagile.dev
export TOIL_ADO_PAT=<your personal access token>
```

Or `~/.toil/config.json`, with `collection`, `project` and `repo` usually set once
under `defaults.ado`:

```json
{
  "version": 2,
  "connections": {
    "corp-ado": { "area": "ado", "baseUrl": "https://ado.imagile.dev", "writes": true }
  },
  "defaults": { "ado": { "connection": "corp-ado", "collection": "DefaultCollection", "project": "Imagile", "repo": "imagile-api" } }
}
```

The token never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add corp-ado --area ado` (or
`toil connections login corp-ado` for an existing connection) to keep it in the OS
credential store, or set `TOIL_ADO_PAT`.

## Where a command acts

`--collection <name>` (or its alias `--organization <name>`), `--project <name>` and
`--repo <name>` are group flags, accepted before or after the command
(`toil ado --project Imagile work get --id 42`). Without them, toil reads them from
the first of the workspace's remotes on the connection's host, of any name, trying
`origin` first
(`https://<host>[/tfs]/<collection>/<project>/_git/<repo>`, or the `_ssh` forms with
`ssh://git@<host>` or `git@<host>:`), then the connection's `collection`, `project`
and `repo` settings. `--collection` beats `--organization`, which beats the remote and
the settings. An `ssh://` remote with no user, an HTTPS remote with a user name, and
the short `<collection>/_git/<project>` form aren't read correctly. `meta.context`
says where each came from.

**Every command needs a collection and a project**, even the ones that don't use
them (`whoami`, `project list-collections`), and fails with "Could not determine Azure
DevOps collection" (or project) when either is missing. Every `repo` command except
`list` and `create` also needs a repo.

Ids are read as whole numbers from the start of the text: `12abc` is 12, and `abc` is
sent as `NaN`.

## Commands

Server and projects:

- `whoami`, `connection-data`: The collection's connection data: the authenticated
  user (`authenticatedUser.id` is the identity id the vote commands use), the instance
  and the deployment. The two return the same thing.
- `project list-collections`: The server's project collections.
- `project list`: Every team project in the collection.
- `project get`: One team project by `--name`.

Work items (`--id <n>`):

- `work get`: A work item with every field and relation.
- `work create`: Create one (`--type`, `--title`, `--description`, `--assignee`,
  `--priority`, `--field name=value` repeatable, `--input-file`). `--parent <id>`
  adds a parent link afterwards; the result is the item as created, and a failed link
  is only an `ADO_PARENT_LINK_FAILED` warning, with the item already created.
- `work update`: Set fields (`--field name=value` repeatable, or `--input-file`).
- `work transition`: Set `--state`.
- `work assign`: Assign `--to` a display name or email.
- `work link`: Link `--id` to `--to`, `--type related` (default), `parent`, `child`,
  `duplicate`, `duplicate-of`, or a raw relation name.
- `work search`: Run `--wiql`; returns the matching ids and urls, not their fields.
  `--updated-since <iso>` keeps only items changed at or after that instant: a date
  (`2026-10-01`, UTC midnight) or a date-time with its zone (`2026-10-01T09:00:00Z`).
  toil ANDs `[System.ChangedDate] >= '<instant>'` onto the query's own `WHERE`, in
  parentheses so an `OR` keeps its meaning, and asks the server for time precision.
  Time precision applies to the whole query, so with `--updated-since` an `=` on a
  date field (`[System.CreatedDate] = @Today`) matches one exact instant, not a day;
  write date conditions with `>=` and `<` instead.
  It and `--limit` work on flat queries (`FROM WorkItems`) only; a link query is
  refused. With `--limit`, each page runs the query again, so an item changed in
  between can move. A query returns at most 20,000 items, so a page can't end past
  that.
- `work get-batch --id <n> --id <n>`: Several work items through the batch endpoint,
  200 ids per request, at most 1,000 per call. Returns `{ count, value, missing }`:
  `value` holds the items found in the order asked, with every field and relation,
  or only `--fields System.Title,System.State`; `missing` lists each id that doesn't
  exist or the token can't see, with an `ADO_WORK_ITEMS_MISSING` warning.
- `work revisions --id <n>`: Every revision of a work item, oldest first; each is the
  whole item as it stood after that change, so neighbours show what changed and when.
- `work list-comments`, `work add-comment` (`--body`): Comments; listing reads the
  first page only.
- `work add-tag`, `work remove-tag`: `--tags a;b` or `a,b`, matched ignoring case. The
  tag list is read and written back, with no revision check.
- `work list-attachments`: The attached files (id, name, url, size, dates).
- `work add-attachment`: Upload `--file` (a path in the workspace), then link it
  (`--comment` optional). Returns the uploaded attachment's `{ id, url }`. If the link
  fails, the upload stays on the server.
- `work download-attachment`: Save `--attachment-id` to `--dir` (default `.toil`) in
  the workspace; returns `{ saved, name, size }`. It never overwrites a file. The
  token only goes to the configured host: an attachment URL naming another host is
  fetched from the configured one, with an `ADO_ATTACHMENT_HOST` warning.
- `work list-areas`, `work list-iterations`: The area or iteration tree, `--depth`
  (default 10).
- `work types`: The work item types with their states and required fields.
- `work list-states`: The states of `--type`.
- `work fields`: The collection's fields, or with `--type` a type's (those have no
  `type` or `readOnly`); `--custom-only` drops `System.*` and `Microsoft.VSTS.*`.
- `work schema`: The `--input-file` JSON schema and an example; `--example-only`
  returns just the example as `data`. Needs no connection.

`work types` and `work fields` have no `--save`; passing it is an unknown option.
The aliases `--save` would store are the built-in ones below, which apply anyway.
`--discover` is accepted and changes nothing.

Field names in `--field` and `--input-file` resolve through the connection's
`fieldAliases`, then the built-in aliases (`title`, `state`, `description`,
`priority`, `storypoints`, `acceptancecriteria`, `reprosteps` and others), matched
ignoring case, spaces and dashes; anything else is sent as a reference name
(`MyOrg.Team`). To add your own alias, set `fieldAliases` as a JSON object:
`toil connections add <name> --area ado` asks for it when setting up a connection;
on one that exists, add `"fieldAliases": { "effortdays": "MyOrg.EffortDays" }` to it
in `~/.toil/config.json`, or set `TOIL_ADO_FIELD_ALIASES` (or
`TOIL_CONN_<NAME>_FIELD_ALIASES`) to the JSON. An `--input-file` is
`{ "type": "Bug", "fields": { "Title": "...", "Description": "@desc.html" } }`: a value
starting with `@` is read from that file. Flags win over the file, with an
`ADO_INPUT_OVERRIDDEN` warning naming the keys.

Repositories and pull requests:

- `repo list`, `repo create` (`--name`), `repo get`: Repositories in the project.
- `repo list-prs`: Every pull request, `--state active` (default), `abandoned`,
  `completed` or `all`. `--creator` and `--reviewer` are sent as identity id filters,
  so pass an id (from `whoami`), not an alias. `--created-after` and
  `--created-before` take ISO 8601 dates; a date alone is UTC midnight, a date-time
  without a zone is local time.
- `repo get-pr`: One by `--id`.
- `repo create-pr`: `--title`, `--source`, `--target` (default `main`),
  `--description`, `--reviewers <id,id>` (identity ids), `--draft`. Give branch names
  without `refs/heads/`, which toil adds (a full ref gets it twice).
- `repo update-pr`: `--title`, `--description`, `--reviewers`, `--draft true|false`,
  in one PATCH.
- `repo merge-pr`: Ask the server to complete it, `--strategy noFastForward`
  (default), `squash`, `rebase` or `rebaseMerge`, `--delete-source`. Completion is
  asynchronous; check `data.status`.
- `repo abandon-pr`: Abandon it.
- `repo list-comments --pr <n>`: Every comment of every thread, oldest first, with
  `threadId` and `threadContext` (null for a general comment); system comments
  included. `--inline-only` or `--general-only` narrows it.
- `repo add-comment`, `repo add-inline-comment` (`--file /src/a.ts --line 12`,
  `--line-type left|right`, default `right`), `repo reply-comment --thread-id`,
  `repo resolve-comment --thread-id` (status `fixed`).
- `repo delete-comment --thread-id --comment-id`: Returns `{ "deleted": true }`. CLI
  only: deletes are never exposed through MCP.
- `repo list-files --pr <n>`: Changed files of the latest iteration, at most 100.
- `repo diff --pr <n>`: Changed files between the last merge commits, at most 100;
  `--path` keeps one file (a leading `/` is added).
- `repo get-build-status --commit <sha>`: Statuses posted to a commit.
- `repo list-reviewers --pr <n>`: Reviewers and their votes.
- `repo list-default-reviewers`: Required reviewers policies covering the repository.
- `repo approve`, `repo unapprove`, `repo wait-for-author` (`--pr <n>`): Vote 10, 0 or
  -5 as the token's own user.
- `repo list-builds --pr <n>`: Builds of the pull request's source branch (not of its
  merge ref).

Pipelines:

- `pipeline list`, `pipeline get --id`: Pipelines (build definitions).
- `pipeline run --id`: Queue a run, `--branch` (a short name gets `refs/heads/`),
  `--parameter k=v` repeatable. `--wait` polls every `--poll` seconds (10) for up to
  `--timeout` seconds (600). A result other than `succeeded` still returns the build,
  with an `ADO_BUILD_NOT_SUCCEEDED` warning, and the CLI exits 1. The command's own
  time limit is 11 minutes, so a longer `--timeout` also needs `TOIL_TIMEOUT_MS`.
- `pipeline list-runs`: Runs, `--definition <id>` or `--name <pipeline>`, `--branch`
  (as given, e.g. `refs/heads/main`), `--status`, `--top` (default 50; `--top 0`
  lists every run).
- `pipeline get-run --id`, `pipeline cancel-run --id`: One run; cancel it.
- `pipeline logs --build-id <n>` (or `--id`): The run's logs; with `--log-id`, that
  log's text as `{ "log": "..." }`.

Paging: `project list`, `pipeline list`, `pipeline list-runs`, `repo list-prs`,
`repo list-builds`, `work search` and `work revisions` return the whole list by
default. With `--limit <n>` they return at most that many and set
`meta.page.nextCursor`; pass it back as `--cursor`, with the same `--limit`, for the
next page, until it's `null`. `pipeline list-runs` takes `--limit` or `--top`, not
both. Every list except `work search` (one request) reads page by page and stops
with an `HTTP` error after 1,000 pages, naming the list.

Write commands need `writes: true` on the connection and `--allow-write` on the call.

```bash
toil ado --collection DefaultCollection --project Imagile work get --id 42
toil ado work create --type Bug --title "Login broken" --field "Story Points=3" --allow-write
toil ado --repo imagile-api repo list-prs --state all
toil ado work search --wiql "SELECT [System.Id] FROM WorkItems" --updated-since 2026-10-01 --limit 200
toil ado work get-batch --id 42 --id 7 --fields System.Title,System.State
toil ado pipeline run --id 5 --branch main --wait --allow-write
```

## Checking a dossier

`check-dossier` checks the call's dossier against the server: each team project it names (`project`, per repo or not, and `projects`) exists in its collection, and each repository (`repo`) in its project. The collection is the section's `collection`, else `--collection` or the connection's; a value with no collection anywhere is `INVALID_INPUT`. It's `toil ado check-dossier` (`--dossier <name|file>`, or the dossier the folder resolves to), and it returns `{ dossier, connection, env, ok, checked, checks, unchecked }`, one check per value with its key path. The CLI exits 1 when one is missing. A failure other than not-found (a bad token, an unreachable host) fails the command. Read only.
