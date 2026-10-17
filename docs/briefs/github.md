# GitHub & GitHub Enterprise (`github`)

Wave 1 · Integration issue #24 · Suspected bugs #72 · 38 contract commands

## Commands

- **Repositories and issues:** `create-repo`, `create-issue`
- **Pull requests:** `list-prs`, `get-pr`, `create-pr`, `update-pr`, `merge-pr`, `close-pr`, `reopen-pr`, `convert-to-draft`, `ready-for-review`
- **Merging:** `enable-auto-merge`, `disable-auto-merge`, `enqueue-pr`
- **Comments:** `list-comments`, `add-comment`, `delete-comment`, `list-review-comments`, `add-inline-comment`, `reply-comment`, `delete-review-comment`
- **Diff and files:** `diff`, `list-files`
- **Reviews:** `list-reviews`, `approve`, `request-changes`, `list-reviewers`, `list-review-threads`, `resolve-thread`, `add-reviewers`, `remove-reviewers`
- **Status:** `get-status`, `list-checks`, `pr-status`
- **Labels and assignees:** `add-labels`, `remove-label`, `add-assignees`, `remove-assignees`

## Auth

- `github.baseUrl`: `TOIL_GITHUB_BASE_URL`, then CI fallback `GITHUB_API_URL`, then config. `github.token`: `TOIL_GITHUB_TOKEN`, then CI fallback `GITHUB_TOKEN`, then config.
- Base URL is the REST root: `https://api.github.com`, or `https://ghe.imagile.dev/api/v3` for Enterprise Server.
- Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`. No exchange.
- Every command except `create-repo` checks both settings up front and lists whichever are missing in one error. Connection test: `GET /user`.

## Paging

- **page/per_page:** `per_page=100` from page 1, stop on a short page, no cap. Used by `list-prs`, `list-comments`, `list-review-comments`, `list-files`, `list-reviews`, and `list-checks` (its own loop over the `check_runs` wrapper).
- **Single request:** `get-status` (server default 30 statuses), `list-reviewers` (`requested_reviewers`).
- **GraphQL fixed sizes:** review threads `first: 100` (stderr warning when `hasNextPage`), thread comments `first: 10`, status contexts `first: 100`, all without paging.
- `list-prs --author` and `--created-after/--created-before` filter client-side after all pages; author match is case-insensitive.

## Special HTTP needs

- **Text response:** `diff` GETs `/repos/{o}/{r}/pulls/{n}` with `Accept: application/vnd.github.v3.diff`. A non-OK body's `message` becomes the error.
- **GraphQL:** endpoint derived from the base URL: trailing slashes trimmed, a trailing `/v3` dropped, `/graphql` appended (`api.github.com/graphql`, `ghe.imagile.dev/api/graphql`). `errors` joins messages with `; `; null or absent `data` fails with "GraphQL response contained no data". Used by `list-review-threads`, `resolve-thread`, `pr-status`, the auto-merge and merge-queue commands, and the draft toggles.
- **DELETE with a JSON body:** `remove-reviewers` (`requested_reviewers`) and `remove-assignees`.
- **Repeatable flags:** `--label`, `--assignee`, `--reviewer`, `--team-reviewer` collect arrays; they become JSON bodies, never repeated query keys.
- **File or stdin input:** `create-issue` and `create-pr --body-file <path>` (`-` reads stdin); `--body` wins.
- No multipart, downloads, server-supplied URLs or polling.

## Context inputs

- Group flags `--owner <owner>` and `--repo <repo>`; `create-pr` repeats both as overrides.
- Order: per-command flag, group flag, git remote, `defaults.github.owner`/`.repo`.
- Remote parsing (`parseGitHubRemote`): the host must equal the base URL's hostname, with `api.github.com` mapped to `github.com`; no base URL means `github.com`. Accepts `git@host:o/r`, `ssh://git@host[:port]/o/r` and `https://host[:port]/o/r`, each with optional `.git`.
- `create-pr --base` defaults to `defaults.github.targetBranch`, then `main`.
- `create-repo` reads only the group `--owner` (no remote, no defaults) and treats it as an org.

## Supported version

Not established. It pins REST API version `2022-11-28` and uses GraphQL. Nothing in the source names a minimum Enterprise Server release. Auto-merge and merge-queue mutations need a server that has them, which is unchecked.

## Watch for

- Pin every #72 item: `pr-status` compares check states in lowercase while GraphQL returns uppercase enums, so every check counts as `other`; contexts capped at 100 silently; thread comments capped at 10 silently; `remove-label` puts the label in the path unencoded; `get-status` reads one page; `create-repo --owner <your-login>` calls `/orgs/{login}/repos`; `--dry-run` on node-id commands prints the `GET /pulls/{n}` lookup and stops before the mutation; `resolve-thread` requires owner and repo it never uses.
- Node-id commands (`enable-auto-merge`, `disable-auto-merge`, `enqueue-pr`, `convert-to-draft`, `ready-for-review`) GET the PR for `node_id` first. `--method` is upper-cased; `--match-head-commit` becomes `expectedHeadOid`.
- `merge-pr --method` defaults to `merge`; `list-prs --state` defaults to `open`; `add-inline-comment --side` defaults to `RIGHT`.
- `close-pr`/`reopen-pr` are PATCHes of `state`. `approve`/`request-changes` POST a review with `event`; `request-changes` requires `--body`.
- `pr-status` reshapes into `{number, title, state, ..., checks: {total, passed, failed, pending, other, details}}`, with `autoMergeRequest.enabledBy` flattened to a login.
- `--head` is passed as given; GitHub expects `user:branch`.
- `delete-comment`, `remove-label` and `remove-reviewers` return fixed `{deleted|removed: true}` shapes.
