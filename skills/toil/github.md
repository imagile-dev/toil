---
area: github
description: Pull requests, reviews, comments, checks, labels, assignees and issues on GitHub and GitHub Enterprise Server
---

# GitHub and GitHub Enterprise Server (`github`)

Pull requests, reviews, comments, checks, labels, assignees and issues on
**GitHub.com** and **GitHub Enterprise Server**, through the REST API and, for
review threads, PR status, auto-merge, the merge queue and drafts, the GraphQL API.
The two differ only in host, so they're one area with a configurable `baseUrl`.
Verification level: `unit`.

**Supported versions:** The oldest GitHub Enterprise Server version toil supports hasn't been established. toil pins
REST API version 2022-11-28 and uses GraphQL for review threads, PR status, auto-merge,
the merge queue and drafts. GitHub.com is always current; no Enterprise Server release
has been verified yet, and the auto-merge and merge-queue commands need a release that
has those features.

## Credential

A **fine-grained personal access token**: Settings → Developer settings → Personal
access tokens → Fine-grained tokens, with access to the repositories you work on
(pull requests, issues, contents and checks, read or write as needed). toil sends it as
`Authorization: Bearer <token>`, with `Accept: application/vnd.github+json` and
`X-GitHub-Api-Version: 2022-11-28`. There is no OAuth app, username, password or
browser login.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_GITHUB_BASE_URL`, then `GITHUB_API_URL` | yes | The REST API root: `https://api.github.com`, or `https://ghe.imagile.dev/api/v3` for Enterprise Server |
| `token` | `TOIL_GITHUB_TOKEN`, then `GITHUB_TOKEN` | yes | Fine-grained personal access token |
| `owner` | `TOIL_GITHUB_OWNER` | no | Default owner (user or org) |
| `repo` | `TOIL_GITHUB_REPO` | no | Default repository name |
| `targetBranch` | `TOIL_GITHUB_TARGET_BRANCH` | no | Default base branch for `create-pr` (`main` when unset) |
| `writes` | `TOIL_GITHUB_WRITES` | no | `true` lets write commands run (with `--allow-write`) |

**CI fallbacks:** in GitHub Actions, the default connection takes its token from
`GITHUB_TOKEN` when `TOIL_GITHUB_TOKEN` isn't set, and its base URL from
`GITHUB_API_URL` when `TOIL_GITHUB_BASE_URL` isn't set. Each sits directly below its
`TOIL_GITHUB_*` variable and above the config file.

The GraphQL endpoint is derived from `baseUrl`: a trailing `/v3` is dropped and
`/graphql` appended, so `https://api.github.com` uses `https://api.github.com/graphql`
and `https://ghe.imagile.dev/api/v3` uses `https://ghe.imagile.dev/api/graphql`.

Environment variables (CI, or a one-off shell):

```bash
export TOIL_GITHUB_BASE_URL=https://ghe.imagile.dev/api/v3
export TOIL_GITHUB_TOKEN=<your fine-grained token>
```

Or `~/.toil/config.json`, with `owner`, `repo` and `targetBranch` usually set once
under `defaults.github`:

```json
{
  "version": 2,
  "connections": {
    "corp-github": { "area": "github", "baseUrl": "https://ghe.imagile.dev/api/v3" }
  },
  "defaults": { "github": { "connection": "corp-github", "owner": "imagile", "repo": "toil-probe" } }
}
```

The token never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add corp-github --area github` (or
`toil connections login corp-github` for an existing connection) to keep it in the OS
credential store, or set `TOIL_GITHUB_TOKEN`.

## Owner and repository

Every command except `create-repo` needs an owner and a repository, which come
from, in order:

1. `--owner` and `--repo`, before or after the command (`toil github --owner imagile
   --repo toil-probe get-pr --number 7`); on `create-pr` the ones after the command win
2. the first of the working folder's remotes whose host is this connection's host,
   of any name, trying `origin` first (so a fork's `upstream` counts)
   (`api.github.com` counts as `github.com`). `git@host:o/r`, `ssh://git@host[:port]/o/r`
   and `https://host[:port]/o/r` remotes are read, each with or without `.git`; an
   HTTPS remote with a user name in it isn't
3. the connection's `owner` and `repo` (usually `defaults.github`)

With neither found, the command fails with "Could not determine GitHub owner/repo".
`resolve-thread` needs them too, though it acts by thread id alone. `create-repo`
reads only an explicit `--owner`, always as an organization (`POST /orgs/<owner>/repos`);
without it the repository is created under the token's user.

## Commands

Numbers (`--number`, `--comment-id`, `--line`) are read as whole numbers from the
start of the text, so `12abc` is 12. Write commands need `writes` on the connection
and `--allow-write`. The deletes (`delete-comment`, `delete-review-comment`,
`remove-label`, `remove-reviewers`, `remove-assignees`) run on the CLI only and are
never MCP tools. Owner, repo, labels and refs go into request paths as typed; a value
that would make a `.` or `..` path segment is refused with `INVALID_INPUT`.

- **Repositories and issues:** `create-repo` (`--name`, `--description`, `--private`,
  `--auto-init`); `create-issue` (`--title`, `--body` or `--body-file <path>` with `-`
  for stdin, repeatable `--label` and `--assignee`).
- **Pull requests:** `list-prs` (`--state open|closed|all`, default `open`; `--head
  user:branch`, `--base`; `--author` and `--created-after`/`--created-before`, ISO 8601,
  are filtered after every page is in, the author case-insensitively; a date alone is
  UTC midnight, a date-time with no zone local time), `get-pr`, `create-pr` (`--title`,
  `--head`, `--base` defaulting to `targetBranch` then `main`, `--body`/`--body-file`,
  `--draft`), `update-pr` (`--title`, `--body`, `--base`), `merge-pr` (`--method
  merge|squash|rebase`, default `merge`, always sent; `--commit-title`,
  `--commit-message`), `close-pr`, `reopen-pr`, `convert-to-draft`, `ready-for-review`.
- **Merging:** `enable-auto-merge` and `enqueue-pr` (`--method`, `--match-head-commit
  <sha>`), `disable-auto-merge`.
- **Comments:** `list-comments`, `add-comment`, `list-review-comments`,
  `add-inline-comment` (`--commit`, `--file`, `--line`, `--side LEFT|RIGHT`, default
  `RIGHT`), `reply-comment` (`--comment-id`), `delete-comment`,
  `delete-review-comment`.
- **Diff and files:** `diff` returns `{ diff }`, the unified diff as text;
  `list-files`.
- **Reviews:** `list-reviews`, `approve` (`--body` optional), `request-changes`
  (`--body` required), `list-reviewers`, `list-review-threads` (thread ids for
  `resolve-thread`; the first 100 threads with a `GITHUB_REVIEW_THREADS_TRUNCATED`
  warning past that, and the first 10 comments of each), `resolve-thread
  --thread-id`, `add-reviewers` and `remove-reviewers` (repeatable `--reviewer` and
  `--team-reviewer`, at least one).
- **Status:** `get-status --ref` (the combined status; GitHub's first 30 statuses),
  `list-checks --ref`, `pr-status` (review decision, mergeability, draft and
  auto-merge state, and the first 100 checks counted into `checks.passed`, `failed`,
  `pending` and `other`).
- **Labels and assignees:** `add-labels` (repeatable `--label`), `remove-label
  --label`, `add-assignees` and `remove-assignees` (repeatable `--assignee`).

Lists page 100 at a time until a short page, and stop with an error after 1,000 pages.

```bash
toil github list-prs --state all --author octo-dev
toil github --owner imagile --repo toil-probe pr-status --number 7
toil github create-pr --title "Add the probe" --head feature --body-file pr.md --allow-write
```

## Checking a dossier

`check-dossier` checks the call's dossier: each owner it names (`owner`, per repo or not, and `owners`) is a user or organization, and each repository (`repo`) exists under its owner. It's `toil github check-dossier` (`--dossier <name|file>`, or the dossier the folder resolves to), and it returns `{ dossier, connection, env, ok, checked, checks, unchecked }`, one check per value with its key path. The CLI exits 1 when one is missing. A failure other than not-found (a bad token, an unreachable host) fails the command. Read only.
