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
`repo create`) permission if you'll use the write commands. toil sends it as
`Authorization: Bearer <token>`. There is no username, password or browser login.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_BITBUCKET_BASE_URL` | yes | Bitbucket server root, e.g. `https://bitbucket.imagile.dev` (keep any context path) |
| `pat` | `TOIL_BITBUCKET_PAT` | yes | HTTP access token |
| `project` | `TOIL_BITBUCKET_PROJECT` | no | Default project key, when `--project` isn't given |
| `repo` | `TOIL_BITBUCKET_REPO` | no | Default repository slug, when `--repo` isn't given |
| `targetBranch` | `TOIL_BITBUCKET_TARGET_BRANCH` | no | Default target branch for `pr create` (`main` when unset) |
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
command (`toil bitbucket --project PROJ pr list`, or
`toil bitbucket pr create --project ~jdoe --repo scratch ...` for a personal
repository). Without them, toil reads them from the first of the workspace's remotes
on the connection's host, of any name, trying `origin` first (`git@<host>:PROJ/repo.git` or
`https://<host>/scm/PROJ/repo.git`; `ssh://` URLs and HTTPS with a user name aren't
recognised), so a fork whose Bitbucket remote is `upstream` works too, then the connection's
`project` and `repo` settings. `repo create` and `pr create-many` need
only a project; every other command needs both, and fails with "Could not determine
Bitbucket project/repo" when either is missing. `meta.context` says where each came
from.

Pull request and comment ids are read as whole numbers from the start of the text:
`12abc` is 12, and `abc` is sent as `NaN`.

## Commands

Every command is `toil bitbucket <resource> <action> [ids...]`, and its MCP tool is the
path with underscores (`bitbucket_pr_get`, `bitbucket_pr_comment_inline`).

Repositories:

- `repo create`: Create a git repository in a project (`--name`, `--description`).
- `repo default-reviewers`: The repository's default-reviewer conditions.

Pull requests (`<id>` is the pull request id):

- `pr list`: List pull requests, every page unless `--limit` says otherwise. `--state`
  is `OPEN` (default), `MERGED`, `DECLINED` or `ALL`; `--author` and `--reviewer`
  take usernames; `--created-after` (inclusive), `--created-before` (exclusive) and
  `--updated-since` (inclusive, on the last update) take ISO 8601 dates. Bitbucket has
  no date filter, so toil applies them to each page as it reads it. A date alone is UTC
  midnight; a date-time without a zone is local time. With `--limit N` it returns at
  most N of the pull requests that pass, and `meta.page.nextCursor` resumes: pass it
  back as `--cursor`, with `--limit`.
- `pr get <id>`: Get a pull request. `--include reviews,checks,commits,files` adds an
  `included` object holding only the lists named, each as Bitbucket returns it, every
  page read: `reviews` (the `APPROVED`, `UNAPPROVED` and `REVIEWED` activities;
  `REVIEWED` is needs-work), `checks` (the build statuses `pr builds` returns, which is one page),
  `commits`, and `files` (the changes, as Bitbucket sends them). Each list costs more
  requests; an unknown name is refused before any is sent.
- `pr create`: Create a pull request (`--title`, `--source`, `--target`,
  `--description`, `--reviewers a,b`). Without `--reviewers`, Bitbucket's
  default-reviewer conditions apply.
- `pr create-many`: Promote `--from` to `--to` in every repository in `--repos a,b`, one
  at a time, skipping repositories with nothing to promote. Each one reports
  `created`, `nothing_to_promote` or `error`, with counts in `summary`. The command
  succeeds even when every repository failed, so check `summary.error`; that case
  also carries a `BITBUCKET_ALL_FAILED` warning in `meta.warnings`. Its time limit is 30
  minutes rather than 2, so a long batch still reports every repository. The title
  defaults to `Promote <from> to <to>`.
- `pr update <id>`: Change `--title`, `--description` or `--reviewers` (which replaces
  the whole list). Anything not given is resent as it is now, so nothing is cleared.
- `pr merge <id>`: Merge at the current version. `--strategy` is sent as Bitbucket's
  merge strategy id (`squash`, `ff`; Bitbucket calls a merge commit `no-ff`).
  `--delete-branch` sets Bitbucket's `autoSubject` and doesn't delete the branch; the
  merge still succeeds, with a `BITBUCKET_BRANCH_NOT_DELETED` warning.
- `pr decline <id>`: Decline at the current version.
- `pr current`: The open pull request whose source branch is the workspace's current
  git branch, or `null`. `toil git current-pr` is the same command. The branch is read
  from `.git` (no git needed). With no Bitbucket connection, or one missing its
  `pat`, it succeeds with `{ "message": "Requires Bitbucket config. ..." }` (the
  latter with a `CONFIG_INCOMPLETE` warning).

Comments:

- `pr comments <id>`: Comments, oldest first, replies flattened in with `parentId`.
  `--no-with-replies` returns top-level comments only (replies stay nested under
  `comments`), `--inline-only` only file comments, `--general-only` only general ones.
- `pr comment <id>`: A general comment (`--body`).
- `pr comment-inline <id>`: A comment on a line (`--file`, `--line`, `--body`,
  `--line-type ADDED|REMOVED|CONTEXT`, default `ADDED`). The line is anchored to the
  new version of the file.
- `pr reply <id> <comment-id>`: Reply to a comment (`--body`).
- `pr resolve <id> <comment-id>`: Resolve a thread by its root comment, at
  `--comment-version` (default `0`; `pr comments` reports each comment's `version`).
  Returns `{ "resolved": true }`.
- `pr delete-comment <id> <comment-id>`: Delete a comment at `--comment-version`
  (default `0`). Returns `{ "deleted": true }`. CLI only: deletes are never exposed
  through MCP.

Review and builds:

- `pr diff <id>`: `data.diff` is Bitbucket's JSON diff structure as a string, not
  unified diff text. `--file` limits it to one path; `--context-lines` sets the context.
- `pr files <id>`: The changed paths, from one request of up to 1000 changes. An entry
  that Bitbucket returns as a path object comes back as that object in a JSON string.
- `pr approve <id>`, `pr unapprove <id>`: Approve, or withdraw approval, as the
  token's user.
- `pr needs-work <id>`: Mark needs-work as the token's user, adding them as a reviewer
  first when they aren't one. That addition stays if the status change then fails.
- `pr reviewers <id>`: The pull request's reviewers and their status.
- `pr add-reviewer <id>`: Add `--user` as a reviewer.
- `pr builds <id>`: Build statuses of the pull request's newest commit.
- `commit status <commit>`: Build statuses of a commit. It still needs a project and
  repo, though it doesn't use them.

`pr builds` and `commit status` return one page of statuses, at Bitbucket's default
size (25).

Write commands need `writes: true` on the connection and `--allow-write` on the call.

```bash
toil bitbucket --project PROJ --repo imagile-api pr list --state OPEN --author jdoe
toil bitbucket pr get 42
toil bitbucket pr get 42 --include reviews,checks
toil bitbucket pr list --updated-since 2026-10-01 --limit 20
toil bitbucket pr create --title "Add retries" --source feature/retries --allow-write
toil bitbucket pr comments 42 --no-with-replies
```

## Checking a dossier

`check-dossier` checks the call's dossier: each project key it names (`project`, per repo or not, and `projects`) exists, and each repository (`repo`) in its project. It's `toil bitbucket check-dossier` (`--dossier <name|file>`, or the dossier the folder resolves to), and it returns `{ dossier, connection, env, ok, checked, checks, unchecked }`, one check per value with its key path. The CLI exits 1 when one is missing. A failure other than not-found (a bad token, an unreachable host) fails the command. Read only.
