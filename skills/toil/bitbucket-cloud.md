---
area: bitbucket-cloud
description: Repositories, branches, tags, commits, diffs, files, pull requests, comments, build statuses and Pipelines on Bitbucket Cloud
---

# Bitbucket Cloud (`bitbucket-cloud`)

Repositories, branches and tags, commits, diffs, files, pull requests, comments,
build statuses and Pipelines on **Bitbucket Cloud** (`https://api.bitbucket.org/2.0`,
REST API 2.0). Built from Atlassian's API documentation and never run against a live
workspace. Verification level: `unit`.

For Bitbucket Data Center or Server, use the `bitbucket` area instead. The two are
separate areas because their APIs differ: Cloud has workspaces where Data Center has
projects, identifies people by Atlassian account id rather than username, keeps no
pull request version, and pages by a `next` link.

**Supported versions:** The oldest Bitbucket Cloud version toil supports hasn't been established.
Bitbucket Cloud is always current. toil calls REST API 2.0
(`https://api.bitbucket.org/2.0`) with an Atlassian API token sent as Basic auth with
the account email, or a workspace, project or repository access token sent as Bearer.
Nothing has been run against a live workspace yet.

## Credential

One of two, each generated once in Atlassian's UI. A connection holds exactly one;
setting both is refused with `CONFIG_INVALID`.

- **An Atlassian API token with Bitbucket scopes**, plus that account's **email
  address**. Create it at https://id.atlassian.com/manage-profile/security/api-tokens
  → Create API token with scopes → Bitbucket. toil sends
  `Authorization: Basic base64(<email>:<apiToken>)`, as Atlassian documents. The
  token acts as you. Scopes:
  - reads: `read:repository:bitbucket`, `read:pullrequest:bitbucket` and
    `read:pipeline:bitbucket`, plus `read:user:bitbucket` for `toil connections test`
  - writes: `write:pullrequest:bitbucket` (pull requests and comments),
    `write:repository:bitbucket` (`branch create`, `tag create`) and
    `admin:repository:bitbucket` (`repo create`)
- **A workspace, project or repository access token**, from Repository settings,
  Project settings or Workspace settings → Access tokens. toil sends
  `Authorization: Bearer <accessToken>`. The token acts as itself, named after the
  token, on only what it was made for. Scopes: `repository`, `pullrequest` and
  `pipeline` to read; `pullrequest:write` and `repository:write` to write.
  `toil connections test` checks it against the connection's `workspace` and `repo`,
  and can't check one with neither.

**App passwords no longer work** and toil doesn't take them. A `401`, `403` or `410`
from Bitbucket Cloud is `AUTH`, and its fix names the credential to create and the
scopes it needs. There is no OAuth app, Connect app or browser login.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_BITBUCKET_CLOUD_BASE_URL` | yes | REST API root: `https://api.bitbucket.org/2.0` |
| `email` | `TOIL_BITBUCKET_CLOUD_EMAIL` | with `apiToken` | Email address of the Atlassian account the API token belongs to |
| `apiToken` | `TOIL_BITBUCKET_CLOUD_API_TOKEN` | one of the two | Atlassian API token with Bitbucket scopes (a secret) |
| `accessToken` | `TOIL_BITBUCKET_CLOUD_ACCESS_TOKEN` | one of the two | Workspace, project or repository access token (a secret) |
| `workspace` | `TOIL_BITBUCKET_CLOUD_WORKSPACE` | no | Default workspace slug, when `--ws` isn't given |
| `repo` | `TOIL_BITBUCKET_CLOUD_REPO` | no | Default repository slug, when `--repo` isn't given |
| `writes` | `TOIL_BITBUCKET_CLOUD_WRITES` | no | `true` lets write commands run (with `--allow-write`) |

**CI fallback:** in Bitbucket Pipelines, the default connection takes `workspace` from
`BITBUCKET_WORKSPACE` and `repo` from `BITBUCKET_REPO_SLUG`, which Pipelines sets on
every step, when `TOIL_BITBUCKET_CLOUD_WORKSPACE` and `TOIL_BITBUCKET_CLOUD_REPO`
aren't set. Pipelines sets no API credential, so the token is still yours to supply as
a secured variable.

```bash
export TOIL_BITBUCKET_CLOUD_BASE_URL=https://api.bitbucket.org/2.0
export TOIL_BITBUCKET_CLOUD_EMAIL=you@example.com
export TOIL_BITBUCKET_CLOUD_API_TOKEN=<your API token>
# or, instead of the two above:
export TOIL_BITBUCKET_CLOUD_ACCESS_TOKEN=<your access token>
```

Or `~/.toil/config.json`, with `workspace` and `repo` usually set once under
`defaults.bitbucket-cloud`:

```json
{
  "version": 2,
  "connections": {
    "imagile-bbc": { "area": "bitbucket-cloud", "baseUrl": "https://api.bitbucket.org/2.0", "email": "you@example.com", "writes": true }
  },
  "defaults": { "bitbucket-cloud": { "connection": "imagile-bbc", "workspace": "imagile", "repo": "toil" } }
}
```

Neither token ever goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add imagile-bbc --area bitbucket-cloud` (or
`toil connections login imagile-bbc`) to keep it in the OS credential store, or set
the env var. Env vars always win over the file.

## Workspace and repository

Every command takes `--ws <slug>` and `--repo <slug>`, before or after the command
name: `toil bitbucket-cloud --ws imagile --repo toil pr list`. It's `--ws`, not
`--workspace`, because toil's own `--workspace` is the folder commands may read and
write files in. Each falls back to a dossier, then the connection's `workspace` and
`repo`. The git remote is not read. `repo list` and `repo create` need only the
workspace; everything else needs both. Over MCP they're the `workspace` and `repo`
fields.

## Commands

Commands are `toil bitbucket-cloud <resource> <action> [ids...] [--flags]`; ids are
positional. Every command also takes `--connection <name>`. Write commands (marked ✎)
need `writes: true` on the connection **and** `--allow-write`. Names and flags match
`bitbucket` wherever the operation is the same. MCP tools are
`bitbucket_cloud_<command>` (`bitbucket_cloud_pr_get`), and a positional id is the
field of the same name (`id` for a pull request). `pr delete-comment` is CLI only: it
is never an MCP tool.

| Command | Flags | Returns |
|---------|-------|---------|
| `repo list` | `--filter --limit --cursor` | Repositories in the workspace |
| `repo get` | | The repository |
| `repo create` ✎ | `--name --description --project --public` | The created repository (private unless `--public`) |
| `repo default-reviewers` | | The repository's default reviewers |
| `branch list` | `--filter --limit --cursor` | Branches, each with its target commit |
| `branch create` ✎ | `--name --commit` | The created branch |
| `tag list` | `--filter --limit --cursor` | Tags, each with its target commit |
| `tag create` ✎ | `--name --commit --message` | The created annotated tag |
| `commit list` | `--branch --path --limit --cursor` | Commits, newest first (100 unless `--limit` says otherwise) |
| `commit get <commit>` | | The commit |
| `commit status <commit>` | | Build statuses on the commit |
| `file get <path>` | `--ref` | `{ path, commit, content }` |
| `file list [path]` | `--ref` | The folder's files and subfolders (the repository root without a path) |
| `pr list` | `--state --query --limit --cursor` | Pull requests in one state (`OPEN` unless `--state` says otherwise) |
| `pr get <id>` | | The pull request, with participants |
| `pr create` ✎ | `--title --source --target --description --reviewers --close-source-branch --draft` | The created pull request |
| `pr update <id>` ✎ | `--title --description --reviewers --target` | The updated pull request |
| `pr merge <id>` ✎ | `--strategy --message --delete-branch` | The merged pull request, or `{ pending, taskStatus }` |
| `pr decline <id>` ✎ | | The declined pull request |
| `pr current` | | The open pull request from the current git branch, or `null` |
| `pr diff [id]` | `--spec --file --context-lines` | `{ diff }`, unified diff text |
| `pr files <id>` | | Paths the pull request changes |
| `pr approve <id>` ✎ | | The participant record |
| `pr unapprove <id>` ✎ | | `{ unapproved }` |
| `pr request-changes <id>` ✎ | | The participant record |
| `pr reviewers <id>` | | Reviewer participants, with `approved` and `state` |
| `pr builds <id>` | | Build statuses on the pull request |
| `pr comments <id>` | `--no-with-replies --inline-only --general-only` | Comments, oldest first, replies included |
| `pr comment <id>` ✎ | `--body` | The comment |
| `pr comment-inline <id>` ✎ | `--file --line --body --line-type` | The comment |
| `pr reply <id> <comment-id>` ✎ | `--body` | The reply |
| `pr resolve <id> <comment-id>` ✎ | | The resolution record |
| `pr delete-comment <id> <comment-id>` ✎ (CLI only) | | `{ deleted }` |
| `pipeline list` | `--branch --limit --cursor` | Pipeline runs, newest first (100 unless `--limit` says otherwise) |
| `pipeline get <pipeline>` | | The pipeline run |
| `pipeline steps <pipeline>` | | Its steps |
| `pipeline logs <pipeline> <step>` | | `{ log }`, the step's log text |

```bash
toil bitbucket-cloud --ws imagile --repo toil pr list --state ALL --limit 20
toil bitbucket-cloud --ws imagile --repo toil file get src/retry.ts --ref feature/retries
toil bitbucket-cloud --ws imagile --repo toil pr diff 42 --file src/retry.ts
toil bitbucket-cloud --ws imagile --repo toil pr create --title "Add retries" --source feature/retries --allow-write
toil bitbucket-cloud --ws imagile --repo toil pipeline list --branch main --limit 5
```

### People

Bitbucket Cloud has no usernames in its API. `--reviewers` takes a comma-separated
list of **Atlassian account ids** (`557058:abc12345-…`), or `{uuid}`s in braces, as
`pr get` and `repo default-reviewers` show them. `pr list --query` filters with
Bitbucket's query language, for example `--query 'author.account_id = "557058:abc12345"'`
or `--query 'source.branch.name = "feature/retries"'`, where `bitbucket` had
`--author` and `--reviewer`.

### Paging

Lists follow Bitbucket's `next` link, 100 items a request, and toil follows a link
only when it's on the connection's own host and names the same list. Without
`--limit`, `repo list`, `branch list`, `tag list` and `pr list` read every page;
`commit list` and `pipeline list` return the newest 100, since a history has no end
worth reaching. With `--limit N` they return at most N, and `meta.page.nextCursor`
resumes: pass it back as `--cursor` (with `--limit` on the lists that read every page).
Every other list is read in full. Paging stops after 1,000 requests with an error
naming the list.

## Any endpoint: `bitbucket-cloud api`

When no command above covers an endpoint, `bitbucket-cloud api` calls it directly. It
sends the connection's own credential, the same way every other `bitbucket-cloud`
command does, to a path under the connection's `baseUrl` (so the path starts after
`/2.0`):

```bash
toil bitbucket-cloud api GET repositories/imagile/toil
toil bitbucket-cloud api GET repositories/imagile/toil/refs/branches --query 'q=name ~ "release"' --query pagelen=10
toil bitbucket-cloud api GET repositories/imagile/toil/pullrequests/42/merge/task-status/abc12345
toil bitbucket-cloud api POST repositories/imagile/toil/pullrequests/42/comments --body-file comment.json --allow-write
```

- **The path** is relative to `baseUrl`, with or without a leading `/` (in Git Bash
  on Windows, leave it off: the shell rewrites `/repositories/...` into a file path,
  which is refused). A full URL, a scheme, `//host`, a leading backslash or a `.` /
  `..` segment is refused with `INVALID_INPUT` before anything is sent, so the token
  never leaves the connection's host.
- **The method decides the gate.** `GET` and `HEAD` are reads. `POST`, `PUT`,
  `PATCH` and `DELETE` are writes: they need `writes: true` on the connection
  **and** `--allow-write`. `DELETE` works only on the CLI: over MCP,
  `bitbucket_cloud_api` refuses it with `INVALID_INPUT`.
- **`--query key=value`** adds a query parameter; repeat it for more, or to repeat
  a key. **`--body-file <path>`** sends that file (inside the workspace, or `-` for
  stdin) as the body, as `application/json` unless `--content-type` says
  otherwise.
- **Output:** a JSON body is `data`, parsed. A text body (`text/*`, XML, or no content
  type) is `data` as text. Any other body is binary: `data` is its bytes as base64,
  with an `API_BINARY` warning. Text and binary are capped at 1 MB, with an
  `API_TRUNCATED` warning when the body was longer. An empty body (a `204`, a `HEAD`)
  is `null`. `meta.response` is `{ status, contentType }`. Errors use the usual codes
  (`AUTH`, `NOT_FOUND`, `HTTP`, `NETWORK`) with Bitbucket's own message; a `410` here
  is `AUTH`, as it is on every other command. A body labelled JSON that doesn't parse comes back as text,
  with an `API_NOT_JSON` warning.
- **Over MCP** it's the `bitbucket_cloud_api` tool, with `method`, `path`, `query` (an
  array of `key=value` strings), `bodyFile`, `contentType` and `allowWrite`.

Prefer a wrapped command when one exists: it knows the endpoint's paging and quirks,
and `bitbucket-cloud api` doesn't.

## Notes

- `file get` and `file list` read at `--ref`, a branch, tag or commit hash (the
  repository's main branch without it). A branch or tag is first resolved to its
  newest commit, which `data.commit` reports, so a branch name with a `/` works. A
  file comes back as text; read a folder with `file list`, not `file get`.
- `pr diff <id>` and `pr files` read the pull request first and diff its source commit
  against its destination with `topic=true`, the three-dot diff Bitbucket shows on
  the pull request, so `--file` and `--context-lines` apply. `pr diff --spec` takes one
  commit (against its first parent) or `a..b`. Pass exactly one of an id and `--spec`.
  A pull request from a fork isn't diffed this way: use `--spec` in the fork, or `api`.
- `pr update` reads the pull request first and sends back its current title,
  description and reviewers for anything not given, so nothing is cleared by
  omission. `--reviewers` replaces the whole list.
- `pr merge --delete-branch` sends `close_source_branch`, which deletes the source
  branch after the merge. `--strategy` is one of `merge_commit`, `squash`,
  `fast_forward`, `squash_fast_forward`, `rebase_fast_forward` or `rebase_merge`; left
  out, the repository's default applies. When Bitbucket queues the merge or takes
  longer than it waits (`202`), `data` is `{ pending: true, taskStatus }` with a
  `BITBUCKET_CLOUD_MERGE_PENDING` warning: read `taskStatus` with
  `bitbucket-cloud api GET` until its `task_status` is `SUCCESS`.
- `pr request-changes` is Cloud's needs-work. `pr unapprove` withdraws an approval.
  Adding a single reviewer is `pr update --reviewers` with the whole list.
- `pr comment-inline` anchors `ADDED` and `CONTEXT` lines in the new file (`to`) and
  `REMOVED` lines in the old one (`from`).
- `pr resolve` takes the thread's root comment; one that's already resolved is
  an HTTP `409`.
- `pr current` matches the current git branch against open pull requests' source
  branch. It reads the branch from `.git`, and the workspace and repository from
  `--ws` and `--repo` or the connection, never from the remote.
- `pipeline logs` follows a redirect to signed storage with every header dropped, so
  the credential stays on `baseUrl`'s host. Pipeline and step uuids are taken with or
  without their braces.
- Not covered: Issues and Wikis (removed from Bitbucket Cloud in August 2026), the
  cross-workspace APIs (retired in April 2026), anything only a Connect app can
  reach, starting or stopping a pipeline, and deleting branches, tags or
  repositories.
- A 429 is retried after the delay Bitbucket asks for, as in every area.
