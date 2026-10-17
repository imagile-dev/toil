# Bitbucket Data Center (`bitbucket`)

Wave 1 · Integration issue #23 · Suspected bugs #76 · 24 contract commands

## Commands

- **Repositories:** `create-repo`
- **Pull requests:** `list-prs`, `get-pr`, `create-pr`, `create-prs`, `update-pr`, `merge-pr`, `decline-pr`
- **Comments:** `list-comments`, `add-comment`, `add-inline-comment`, `reply-comment`, `resolve-comment`, `delete-comment`
- **Diff and files:** `diff`, `list-files`
- **Review:** `approve`, `unapprove`, `needs-work`, `list-reviewers`, `list-default-reviewers`, `add-reviewer`
- **Builds:** `list-builds`, `get-build-status`
- **Moved in (#68 decision 1):** `git current-pr` becomes a `bitbucket` command, and `git current-pr` stays as an alias. It is the 25th command this port ships; the contract still lists it under `git`.

## Auth

- `bitbucket.baseUrl` (`TOIL_BITBUCKET_BASE_URL`) and `bitbucket.pat` (`TOIL_BITBUCKET_PAT`). No CI fallback var. Both come from env or the global config; there is no default host.
- Header: `Authorization: Bearer <pat>`, plus `Accept` and `Content-Type: application/json`. No token exchange.
- The predecessor's connection test is `GET /rest/api/1.0/application-properties`.

## Paging

- **`isLastPage`/`nextPageStart`, start/limit:** `limit=100`, `start` from 0, next start is `nextPageStart` (or `start + limit`). No cap. Used by `list-prs`, `list-comments` (over `/activities`) and `current-pr` (all OPEN PRs).
- **Single request, no paging:** `list-files` (`/changes?limit=1000`), `list-builds` (`/commits?limit=1`, then the build status of that SHA), `get-build-status` (`/rest/build-status/1.0/commits/{sha}`, first page at the server's default size), `list-default-reviewers`, and `create-prs`' per-repo compare (`/commits?until=<from>&since=<to>&limit=1`).
- `list-prs --created-after/--created-before` filter client-side, after every page is fetched.

## Special HTTP needs

- **Response header:** `needs-work` resolves the caller from `X-AUSERNAME` on `GET /rest/api/1.0/application-properties`, then `GET /users/{username}`. A missing header is an error naming that path.
- **Indexed query keys, not repeated ones:** `list-prs` sends `username.1`/`role.1=AUTHOR` and `username.2`/`role.2=REVIEWER`.
- **Query on writes:** `merge-pr` and `decline-pr` POST with `?version=<n>`; `delete-comment` is `DELETE ...?version=<n>`.
- **Other REST roots:** `/rest/build-status/1.0` and `/rest/default-reviewers/1.0`, besides `/rest/api/1.0`.
- The predecessor's query builder turns `%2C` back into `,`. Empty and 204 bodies return nothing (`resolve-comment`, `delete-comment` then report `{resolved: true}` / `{deleted: true}`).
- No multipart, binary downloads, server-supplied URLs, GraphQL or polling.

## Context inputs

- Group flags `--project <key>` and `--repo <slug>`. `create-repo` and `create-prs` take `--project` only; `create-pr` repeats both as per-command overrides (`~username` for personal repos).
- Old order: per-command flag, group flag, git remote, then `defaults.bitbucket.project`/`.repo` (repository config defaults merged over global ones). That matches K1's resolver.
- Git remote parsing (`parseRemote`): SSH `git@host[:port]:PROJ/repo(.git)` or `git@host/PROJ/repo`, and HTTPS `https://host/scm/PROJ/repo(.git)`. The host matches when the base URL string *contains* it. Not matched: `ssh://` URLs, HTTPS with userinfo or a context path. Project key case is kept as written in the remote.
- `create-pr --target` defaults to `defaults.bitbucket.targetBranch`, then `main`.
- `current-pr` took no flags: git remote, then defaults; the branch comes from HEAD.

## Supported version

Not established. It calls REST API `1.0` (`/rest/api/1.0`, `/rest/build-status/1.0`, `/rest/default-reviewers/1.0`). A code comment cites a Bitbucket Server 9.4.16 instance as the reason for using `X-AUSERNAME`.

## Watch for

- Pin every #76 item: `--delete-branch` sends `autoSubject: true`; `--strategy` is sent verbatim as `strategyId` (`merge` is not a Bitbucket id); `list-files` returns `JSON.stringify` of each path object and reads one page; `diff` returns the JSON diff structure stringified, not a unified diff; `diff --file` puts the path into the URL unencoded; `add-inline-comment` always sends `fileType: 'TO'`; `list-comments` takes every `COMMENTED` activity without deduping.
- `update-pr` GETs the PR first and resends current title, description and reviewers (`user.name`) with its `version`, because a PUT without them wipes them. `merge-pr`/`decline-pr` also GET first for `version`.
- `create-pr` omits `reviewers` entirely when none are given, so default-reviewer conditions apply.
- `needs-work` adds the caller as a REVIEWER first when they aren't one, then PUTs `participants/{slug}` with `NEEDS_WORK`.
- `list-comments` flattens replies with `parentId` and sorts by `createdDate`; `--no-with-replies` returns top-level only.
- `resolve-comment`/`delete-comment --comment-version` default to `0`. IDs go through `parseInt` with no NaN check.
- `create-prs` runs repos one at a time, records `created`/`nothing_to_promote`/`error` per repo and never fails as a whole; default title `Promote <from> to <to>`.
- `get-build-status` still demands a project and repo it never uses.
- `current-pr` with no Bitbucket URL or PAT is a *success* carrying a `message`, not an error. It returns the first OPEN PR whose `fromRef.displayId` equals the branch, or `null`.
- Project and repo are not URL-encoded in paths, except in `list-default-reviewers`.
