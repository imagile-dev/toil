---
area: ado-cloud
description: Work items, git repositories and pull requests on Azure DevOps Services (dev.azure.com)
---

# Azure DevOps Services (`ado-cloud`)

Work items, git repositories and pull requests on **Azure DevOps Services**
(`https://dev.azure.com/<organization>`, or the older
`https://<organization>.visualstudio.com`), through its REST API with
`api-version=7.1`. Built from Microsoft's REST API reference and never run against a
live organization. Verification level: `unit`.

For Azure DevOps Server (on-premises), use the `ado` area instead. The two are
separate areas so that neither one's fixes can change the other: a Services
connection is one organization, where a Server connection is a server holding
several collections.

**Supported versions:** The oldest Azure DevOps Services version toil supports hasn't been established.
Azure DevOps Services is always current. toil sends `api-version=7.1`, the newest
released version (7.2 is preview only), with `7.1-preview.1` for connection data and
`7.1-preview.4` for work item comments, which exist only as previews.

## Credential

An **organization-scoped personal access token**: in Azure DevOps, User settings →
Personal access tokens → New Token, with **Organization** set to the one organization
this connection is for. Give it the scopes the commands you'll use need: Work Items
and Code, Read (or Read & write for the write commands), plus Project and Team Read
for `project list`. toil sends it as `Authorization: Basic base64(":" + token)`, with
an empty user name.

**Don't create a global token** ("All accessible organizations"). Microsoft is retiring
global personal access tokens: every existing one stops working on **December 1,
2026**. A connection is one organization, so an organization-scoped token is all it
needs. A `401` or `403` is `AUTH`, and its fix says to create an organization-scoped
token and that global ones are being retired.

There is no OAuth, Microsoft Entra ID or service principal sign-in: those need a
browser login or an app registration, and toil takes only a token you create once.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_ADO_CLOUD_BASE_URL` | yes | Organization URL: `https://dev.azure.com/<organization>` (or `https://<organization>.visualstudio.com`) |
| `pat` | `TOIL_ADO_CLOUD_PAT` | yes | Organization-scoped personal access token (a secret) |
| `project` | `TOIL_ADO_CLOUD_PROJECT` | no | Default project, when `--project` isn't given |
| `repo` | `TOIL_ADO_CLOUD_REPO` | no | Default git repository, when `--repo` isn't given |
| `fieldAliases` | `TOIL_ADO_CLOUD_FIELD_ALIASES` | no | Work item field aliases as a JSON object, friendly name to reference name, e.g. `{"effortdays": "MyOrg.EffortDays"}` |
| `writes` | `TOIL_ADO_CLOUD_WRITES` | no | `true` lets write commands run (with `--allow-write`) |

A `baseUrl` that doesn't name exactly one organization is refused with
`CONFIG_INVALID` before anything is sent: `https://dev.azure.com` with no organization
or with more after it (a project), or a `visualstudio.com` URL with any path other
than the legacy `/DefaultCollection`.

```bash
export TOIL_ADO_CLOUD_BASE_URL=https://dev.azure.com/imagile
export TOIL_ADO_CLOUD_PAT=<your organization-scoped token>
```

Or `~/.toil/config.json`, with `project` and `repo` usually set once under
`defaults.ado-cloud`:

```json
{
  "version": 2,
  "connections": {
    "imagile-ado": { "area": "ado-cloud", "baseUrl": "https://dev.azure.com/imagile", "writes": true }
  },
  "defaults": { "ado-cloud": { "connection": "imagile-ado", "project": "Imagile", "repo": "imagile-api" } }
}
```

The token never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add imagile-ado --area ado-cloud` (or
`toil connections login imagile-ado`) to keep it in the OS credential store, or set
`TOIL_ADO_CLOUD_PAT`. Env vars always win over the file. For a second organization,
add a second connection with its own token.

**In Azure Pipelines**, map the job's own token and organization URL into the step:

```yaml
- script: toil ado-cloud work get --id 42
  env:
    TOIL_ADO_CLOUD_PAT: $(System.AccessToken)
    TOIL_ADO_CLOUD_BASE_URL: $(System.CollectionUri)
```

`ado-cloud` doesn't read `SYSTEM_ACCESSTOKEN` or `SYSTEM_COLLECTIONURI` on its own.
Azure Pipelines sets both under the same names on Server and on Services, and the
`ado` area already takes `SYSTEM_ACCESSTOKEN`, so if both areas read them, one job's
token would configure both. The job token has to be mapped into the step's
environment anyway, so naming it `TOIL_ADO_CLOUD_PAT` costs nothing. On Services,
`System.CollectionUri` is the organization URL with a trailing slash
(`https://dev.azure.com/imagile/`), which `baseUrl` accepts.

## Where a command acts

`--project <name>` and `--repo <name>` are group flags, accepted before or after the
command (`toil ado-cloud --project Imagile work search --wiql ...`). Without them,
toil uses a dossier, then the connection's `project` and `repo`. The git remote isn't
read. Over MCP they're the `project` and `repo` fields. `meta.context` says where each
came from.

- A work item belongs to the organization, so `work get`, `work update`,
  `work revisions` and `work get-batch` need neither.
- `work create`, `work search`, `work list-comments`, `work add-comment`,
  `work list-iterations` and `repo list` need a project.
- Every other `repo` command needs a project and a repo.
- `whoami`, `project list` and `project get` need neither.

## Commands

Every command also takes `--connection <name>`. Write commands (marked ✎) need
`writes: true` on the connection **and** `--allow-write`. Names and flags match
`ado` wherever the operation is the same. MCP tools are `ado_cloud_<command>`
(`ado_cloud_work_get`). There are no deletes.

| Command | Flags | Returns |
|---------|-------|---------|
| `whoami` | | The token's connection data; `authenticatedUser.id` is the identity id the vote commands use |
| `project list` | `--limit --cursor` | Projects in the organization |
| `project get` | `--name` | One project by name or id |
| `repo list` | | Git repositories in the project |
| `repo get` | | The repository |
| `work get` | `--id` | A work item with every field and relation |
| `work get-batch` | `--id --fields` | `{ count, value, missing }` for several ids |
| `work create` ✎ | `--type --title --description --assignee --priority --field` | The created work item |
| `work update` ✎ | `--id --field --rev` | The updated work item |
| `work search` | `--wiql --updated-since --limit --cursor` | The WIQL answer: matching ids and urls, not fields |
| `work revisions` | `--id --limit --cursor` | Every revision, oldest first |
| `work list-comments` | `--id --limit --cursor` | Every comment on the work item |
| `work add-comment` ✎ | `--id --body` | The new comment |
| `work list-iterations` | `--depth` | The iteration tree, with dates |
| `repo list-prs` | `--state --creator --reviewer --created-after --created-before --limit --cursor` | Pull requests |
| `repo get-pr` | `--id` | One pull request |
| `repo create-pr` ✎ | `--title --source --target --description --reviewers --draft` | The created pull request |
| `repo update-pr` ✎ | `--id --title --description --target --draft` | The updated pull request |
| `repo merge-pr` ✎ | `--id --strategy --delete-source --message` | The pull request, with completion requested |
| `repo abandon-pr` ✎ | `--id` | The abandoned pull request |
| `repo list-reviewers` | `--pr` | Reviewers and their votes |
| `repo approve` ✎ | `--pr` | Your reviewer entry, vote 10 |
| `repo unapprove` ✎ | `--pr` | Your reviewer entry, vote 0 |
| `repo wait-for-author` ✎ | `--pr` | Your reviewer entry, vote -5 |
| `repo list-threads` | `--pr` | Comment threads, as the server returns them |
| `repo list-comments` | `--pr --inline-only --general-only --include-system` | Every comment, flattened from the threads |
| `repo add-comment` ✎ | `--pr --body` | The new thread |
| `repo add-inline-comment` ✎ | `--pr --file --line --body --line-type` | The new thread, on one line of a file |
| `repo reply-comment` ✎ | `--pr --thread-id --body` | The new reply |
| `repo resolve-comment` ✎ | `--pr --thread-id --status` | The thread, with its new status |
| `api` | `--query --body-file --content-type` | Any endpoint (below) |

```bash
toil ado-cloud --project Imagile work search --wiql "SELECT [System.Id] FROM WorkItems" --updated-since 2026-10-01 --limit 200
toil ado-cloud work get-batch --id 42 --id 7 --fields System.Title,System.State
toil ado-cloud --project Imagile work create --type Bug --title "Login broken" --field storypoints=3 --allow-write
toil ado-cloud work update --id 42 --field state=Active --rev 3 --allow-write
toil ado-cloud --project Imagile --repo imagile-api repo list-prs --state all --limit 50
toil ado-cloud --project Imagile --repo imagile-api repo merge-pr --id 42 --strategy squash --delete-source --allow-write
```

### Paging

`project list`, `repo list-prs`, `work search`, `work revisions` and
`work list-comments` return the whole list by default. With `--limit <n>` they return
at most that many and set `meta.page.nextCursor`; pass it back as `--cursor`, with the
same `--limit`, for the next page, until it's `null`. Every list except `work search`
reads page by page (continuation tokens for projects and comments, `$top` and `$skip`
for pull requests and revisions) and stops with an `HTTP` error after 1,000 pages,
naming the list.

### Work items

- **Fields.** `--field name=value` takes a reference name
  (`Microsoft.VSTS.Scheduling.StoryPoints=5`) or an alias, matched ignoring case,
  spaces and dashes: the connection's `fieldAliases` first, then the built-in ones
  (`title`, `state`, `assignedto`, `description`, `areapath`, `iterationpath`,
  `iteration`, `tags`, `priority`, `severity`, `effort`, `storypoints`,
  `remainingwork`, `remaining`, `acceptancecriteria`, `reprosteps`). Anything else is
  sent as given. Values are sent as text; the server converts them.
- **`work update --rev <n>`** adds a JSON Patch `test` of the revision first, so the
  server refuses the whole change if someone else changed the item since you read it.
- **`work search`** returns the matching ids and urls, not their fields; fetch those
  with `work get-batch`. `--updated-since <iso>` keeps only items changed at or after
  that instant: a date (`2026-10-01`, UTC midnight) or a date-time with its zone
  (`2026-10-01T09:00:00Z`). toil ANDs `[System.ChangedDate] >= '<instant>'` onto the
  query's own `WHERE`, in parentheses so an `OR` keeps its meaning, and asks for time
  precision. Time precision applies to the whole query, so with `--updated-since` an
  `=` on a date field matches one exact instant, not a day; write date conditions with
  `>=` and `<` instead. It and `--limit` work on flat queries (`FROM WorkItems`) only;
  a link query is refused. With `--limit`, each page runs the query again, so an item
  changed in between can move. A query returns at most 20,000 items.
- **`work get-batch --id <n> --id <n>`** reads 200 ids per request, at most 1,000 per
  call. `value` holds the items found in the order asked, with every field and
  relation, or only `--fields`; `missing` lists each id that doesn't exist or the
  token can't see, with an `ADO_CLOUD_WORK_ITEMS_MISSING` warning.
- **`work revisions`** returns each revision as the whole item as it stood after that
  change, oldest first, so neighbours show what changed and when.

### Pull requests

- Branch names get `refs/heads/`; a full ref (`refs/heads/x`, `refs/tags/x`) is sent as
  given. `--reviewers` and `--creator` / `--reviewer` take identity ids (from
  `whoami`, or a pull request's `reviewers[].id`), not names or emails.
- `--created-after` and `--created-before` take a date (UTC midnight) or a date-time
  with its zone, as `--updated-since` does.
- `merge-pr` reads the pull request for its source commit, then asks the server to
  complete it with `--strategy noFastForward` (default), `squash`, `rebase` or
  `rebaseMerge`. A pull request with no source commit yet is refused with
  `INVALID_INPUT` before anything is changed. Completion is asynchronous: check `data.status` and
  `data.mergeStatus`, which stay `active` and `queued` while policies or conflicts
  hold it.
- `update-pr` doesn't change reviewers: the API doesn't take them on that call.
- `repo list-comments` flattens every live thread's comments, oldest first, each with
  `threadId` and `threadContext` (null for a general comment). System comments (votes,
  pushes) are left out unless `--include-system`. `repo list-threads` returns the
  threads themselves, system ones included.
- `repo add-inline-comment` anchors on the right (new) side of `--line` unless
  `--line-type left`; a path without a leading `/` gets one.
- `repo resolve-comment` sets `--status fixed` (resolved) by default; `wontFix`,
  `closed`, `byDesign`, `pending`, or `active` to reopen.

## Output, compared with `ado`

`data` is the server's own JSON, so where Services and Server agree it has the same
shape as `ado`'s, and `toil util owi map` reads `work get`, `work get-batch`,
`work revisions` and `work list-iterations` output from either area into Open Work
Items. The differences, for anything that reads both:

- **Work items** (`work get`, `work get-batch`, `work revisions`, `work search`) have
  the same shape: `id`, `rev`, `fields` keyed by reference name, `relations`, `url`.
  On Services every `url` is under the organization (`https://dev.azure.com/<org>/_apis/...`)
  with no collection segment. `work get-batch` returns `{ count, value, missing }`,
  the same as `ado`'s.
- **Identities** (`System.AssignedTo`, `System.CreatedBy`, `createdBy`, `reviewers`)
  are the same object, `{ displayName, id, uniqueName, url, imageUrl, descriptor }`,
  but on Services `uniqueName` is the user's sign-in email, `descriptor` starts with
  `aad.` (or `msa.`), and `url` is on `vssps.dev.azure.com`. On Server `uniqueName` is
  often `DOMAIN\user`.
- **`work list-comments`** returns every comment, following continuation tokens;
  `ado`'s returns only the server's first page. Each comment has the same shape.
- **`work create`** takes `--type`, `--title` and the other flags, and `--field`; it
  has no `--input-file` or `--parent`, which `ado`'s has.
- **`work update`** takes `--field` (and `--rev`); it has no `--input-file`.
- **`repo list-comments`** leaves system comments out unless `--include-system`;
  `ado`'s includes them.
- **Ids** are whole numbers, checked by the schema: `--id 12abc` is refused, where
  `ado` reads it as 12.

## Any endpoint: `ado-cloud api`

When no command above covers an endpoint, `ado-cloud api` calls it directly. It sends
the connection's own token, the same way every other `ado-cloud` command does, to a
path under the organization URL. Add `api-version` yourself:

```bash
toil ado-cloud api GET _apis/projects --query api-version=7.1
toil ado-cloud api GET Imagile/_apis/wit/workitemtypes --query api-version=7.1 --query '$expand=states'
toil ado-cloud api PATCH _apis/wit/workitems/42 --query api-version=7.1 --body-file patch.json --content-type application/json-patch+json --allow-write
```

- **The path** is relative to `baseUrl`, with or without a leading `/` (in Git Bash
  on Windows, leave it off: the shell rewrites `/_apis/...` into a file path, which is
  refused). A full URL, a scheme, `//host`, a leading backslash or a `.` / `..`
  segment is refused with `INVALID_INPUT` before anything is sent, so the token never
  leaves the connection's host.
- **The method decides the gate.** `GET` and `HEAD` are reads. `POST`, `PUT`,
  `PATCH` and `DELETE` are writes: they need `writes: true` on the connection
  **and** `--allow-write`. `DELETE` works only on the CLI: over MCP,
  `ado_cloud_api` refuses it with `INVALID_INPUT`.
- **`--query key=value`** adds a query parameter; repeat it for more, or to repeat
  a key. **`--body-file <path>`** sends that file (inside the workspace, or `-` for
  stdin) as the body, as `application/json` unless `--content-type` says otherwise.
  A work item change is `application/json-patch+json`.
- **Output:** a JSON body is `data`, parsed. A text body (`text/*`, XML, or no content
  type) is `data` as text. Any other body is binary: `data` is its bytes as base64,
  with an `API_BINARY` warning. Text and binary are capped at 1 MB, with an
  `API_TRUNCATED` warning when the body was longer. An empty body (a `204`, a `HEAD`)
  is `null`. `meta.response` is `{ status, contentType }`. Errors use the usual codes
  (`AUTH`, `NOT_FOUND`, `HTTP`, `NETWORK`) with Azure DevOps's own message. A body
  labelled JSON that doesn't parse comes back as text, with an `API_NOT_JSON` warning.
- **Over MCP** it's the `ado_cloud_api` tool, with `method`, `path`, `query` (an array
  of `key=value` strings), `bodyFile`, `contentType` and `allowWrite`.

Prefer a wrapped command when one exists: it knows the endpoint's paging and quirks,
and `ado-cloud api` doesn't.

## Notes

- `toil connections test` reads the organization's connection data, which names the
  token's own user.
- A 429 is retried after the delay Azure DevOps asks for, as in every area.
- Not covered yet: pipelines and builds, attachments, work item types, states and
  fields, areas, links, tags, and PR files and diffs. `ado-cloud api` reaches all of
  them.
