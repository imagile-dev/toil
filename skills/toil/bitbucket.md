---
area: bitbucket
description: Repositories, pull requests, comments, reviewers and build statuses on Bitbucket Data Center
---

# Bitbucket Data Center (`bitbucket`)

Repositories, pull requests, comments, reviewers and build statuses on **Bitbucket
Data Center / Server**, through REST API 1.0 (`/rest/api/1.0`, plus
`/rest/build-status/1.0` and `/rest/default-reviewers/1.0`). Verification level:
`unit`.

**Supported versions:** The oldest Bitbucket Data Center version toil supports hasn't been established. toil
calls REST API 1.0 with an HTTP access token sent as a Bearer header. No release has
been verified yet.

## Credential

A Bitbucket **HTTP access token**: in Bitbucket, your profile picture → Manage
account → HTTP access tokens → Create token. Give it repository write (or admin, for
`create-repo`) permission if you'll use the write commands. toil sends it as
`Authorization: Bearer <token>`. There is no username, password or browser login.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_BITBUCKET_BASE_URL` | yes | Bitbucket server root, e.g. `https://bitbucket.imagile.dev` (keep any context path) |
| `pat` | `TOIL_BITBUCKET_PAT` | yes | HTTP access token |
| `project` | `TOIL_BITBUCKET_PROJECT` | no | Default project key, when `--project` isn't given |
| `repo` | `TOIL_BITBUCKET_REPO` | no | Default repository slug, when `--repo` isn't given |
| `targetBranch` | `TOIL_BITBUCKET_TARGET_BRANCH` | no | Default target branch for `create-pr` (`main` when unset) |
| `writes` | `TOIL_BITBUCKET_WRITES` | no | `true` lets write commands run (with `--allow-write`) |

There's no CI fallback variable.

Environment variables (CI, or a one-off shell):

```bash
export TOIL_BITBUCKET_BASE_URL=https://bitbucket.imagile.dev
export TOIL_BITBUCKET_PAT=<your HTTP access token>
```

Or `~/.toil/config.json`, with `project`, `repo` and `targetBranch` usually set once
under `defaults.bitbucket`:

```json
{
  "version": 2,
  "connections": {
    "corp-bitbucket": { "area": "bitbucket", "baseUrl": "https://bitbucket.imagile.dev", "writes": true }
  },
  "defaults": { "bitbucket": { "connection": "corp-bitbucket", "project": "PROJ", "repo": "imagile-api", "targetBranch": "develop" } }
}
```

The token never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add corp-bitbucket --area bitbucket` (or
`toil connections login corp-bitbucket` for an existing connection) to keep it in the
OS credential store, or set `TOIL_BITBUCKET_PAT`.

## Where a command acts

`--project <key>` and `--repo <slug>` are group flags, accepted before or after the
command (`toil bitbucket --project PROJ list-prs`, or
`toil bitbucket create-pr --project ~jdoe --repo scratch ...` for a personal
repository). Without them, toil reads them from the workspace's `origin` remote when
it's on the connection's host (`git@<host>:PROJ/repo.git` or
`https://<host>/scm/PROJ/repo.git`; `ssh://` URLs and HTTPS with a user name aren't
recognised), then the connection's `project` and `repo` settings. `create-repo` and `create-prs` need
only a project; every other command needs both, and fails with "Could not determine
Bitbucket project/repo" when either is missing. `meta.context` says where each came
from.

Pull request and comment ids are read as whole numbers from the start of the text:
`12abc` is 12, and `abc` is sent as `NaN`.

## Commands

Repositories and pull requests:

- `create-repo`: Create a git repository in a project (`--name`, `--description`).
- `list-prs`: List pull requests, every page. `--state` is `OPEN` (default),
  `MERGED`, `DECLINED` or `ALL`; `--author` and `--reviewer` take usernames;
  `--created-after` (inclusive) and `--created-before` (exclusive) take ISO 8601
  dates and filter after fetching. A date alone is UTC midnight; a date-time without a
  zone is local time.
- `get-pr`: Get a pull request by `--id`.
- `create-pr`: Create a pull request (`--title`, `--source`, `--target`,
  `--description`, `--reviewers a,b`). Without `--reviewers`, Bitbucket's
  default-reviewer conditions apply.
- `create-prs`: Promote `--from` to `--to` in every repository in `--repos a,b`, one
  at a time, skipping repositories with nothing to promote. Each one reports
  `created`, `nothing_to_promote` or `error`, with counts in `summary`. The command
  succeeds even when every repository failed, so check `summary.error`; that case
  also carries a `BITBUCKET_ALL_FAILED` warning in `meta.warnings`. Its time limit is 30
  minutes rather than 2, so a long batch still reports every repository. The title
  defaults to `Promote <from> to <to>`.
- `update-pr`: Change `--title`, `--description` or `--reviewers` (which replaces the
  whole list). Anything not given is resent as it is now, so nothing is cleared.
- `merge-pr`: Merge at the current version. `--strategy` is sent as Bitbucket's merge
  strategy id (`squash`, `ff`; Bitbucket calls a merge commit `no-ff`).
  `--delete-branch` sets Bitbucket's `autoSubject` and doesn't delete the branch; the
  merge still succeeds, with a `BITBUCKET_BRANCH_NOT_DELETED` warning.
- `decline-pr`: Decline at the current version.

Comments (`--pr <id>`):

- `list-comments`: Comments, oldest first, replies flattened in with `parentId`.
  `--no-with-replies` returns top-level comments only (replies stay nested under
  `comments`), `--inline-only` only file comments, `--general-only` only general ones.
- `add-comment`: A general comment (`--body`).
- `add-inline-comment`: A comment on a line (`--file`, `--line`, `--body`,
  `--line-type ADDED|REMOVED|CONTEXT`, default `ADDED`). The line is anchored to the
  new version of the file.
- `reply-comment`: Reply to `--comment-id` (`--body`).
- `resolve-comment`: Resolve a thread by its root `--comment-id`, at
  `--comment-version` (default `0`; `list-comments` reports each comment's `version`).
  Returns `{ "resolved": true }`.
- `delete-comment`: Delete `--comment-id` at `--comment-version` (default `0`).
  Returns `{ "deleted": true }`. CLI only: deletes are never exposed through MCP.

Review and builds (`--pr <id>`):

- `diff`: `data.diff` is Bitbucket's JSON diff structure as a string, not unified
  diff text. `--file` limits it to one path; `--context-lines` sets the context.
- `list-files`: The changed paths, from one request of up to 1000 changes. An entry
  that Bitbucket returns as a path object comes back as that object in a JSON string.
- `approve`, `unapprove`: Approve, or withdraw approval, as the token's user.
- `needs-work`: Mark needs-work as the token's user, adding them as a reviewer first
  when they aren't one. That addition stays if the status change then fails.
- `list-reviewers`: The pull request's reviewers and their status.
- `list-default-reviewers`: The repository's default-reviewer conditions (no `--pr`).
- `add-reviewer`: Add `--user` as a reviewer.
- `list-builds`: Build statuses of the pull request's newest commit.
- `get-build-status`: Build statuses of `--commit <sha>`. It still needs a project
  and repo, though it doesn't use them.

`list-builds` and `get-build-status` return one page of statuses, at Bitbucket's
default size (25).

Write commands need `writes: true` on the connection and `--allow-write` on the call.

```bash
toil bitbucket --project PROJ --repo imagile-api list-prs --state OPEN --author jdoe
toil bitbucket get-pr --id 42
toil bitbucket create-pr --title "Add retries" --source feature/retries --allow-write
toil bitbucket list-comments --pr 42 --no-with-replies
```
