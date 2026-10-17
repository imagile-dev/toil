# Confluence Data Center (`confluence`)

Wave 1 · Integration issue #21 · Suspected bugs #78 · 20 contract commands

## Commands

- Pages, read: `confluence get-page`, `get-page-by-title`, `list-pages`, `get-page-children`, `get-page-history`
- Pages, write: `confluence create-page`, `update-page`, `delete-page`
- Search: `confluence search` (CQL)
- Comments: `confluence list-comments`, `add-comment`
- Labels: `confluence get-labels`, `add-label`, `remove-label`
- Spaces: `confluence list-spaces`, `get-space`
- Attachments: `confluence list-attachments`, `upload-attachment`, `download-attachment`, `delete-attachment`

Everything is under `/rest/api` (Server REST v1). The contract has `commands.test.ts` covering the error hints and attachment-name containment. The integration was marked `beta`, so the common read paths have run live.

## Auth

- Credential: a Data Center personal access token (Settings, Personal Access Tokens).
- Config keys: `confluence.baseUrl` (`TOIL_CONFLUENCE_BASE_URL`), `confluence.apiToken` (`TOIL_CONFLUENCE_API_TOKEN`).
- Token fallback, in order: `TOIL_CONFLUENCE_API_TOKEN`, stored `confluence.apiToken`, `TOIL_JIRA_API_TOKEN`, stored `jira.apiToken`. The connection check reported an inherited token as "ok (inherited from Jira token)". A stored Confluence token outranks the Jira env var. No CI fallback.
- Header: `Authorization: Bearer <token>`. No exchange.
- The contract's connectivity check was `GET /rest/api/space?limit=1` with a 10 s timeout.

## Paging

- Scheme: `start` / `limit` with `_links.next`. The loop requests 25 per page, advances `start` by the response's `size`, and stops when `_links.next` is absent.
- `list-pages` and `list-spaces` take `--limit` as a total cap (default: all) and `list-pages` takes `--start` as an initial offset. The last page's `limit` shrinks so the total isn't exceeded.
- `get-page-children`, `get-labels`, `list-comments` and `list-attachments` always fetch everything, uncapped.
- `search` is one page: `--start 0`, `--limit 25` by default, `data` is the raw search result.

## Special HTTP needs

- Multipart upload: `upload-attachment` POSTs `multipart/form-data` to `content/<id>/child/attachment` with field `file` (filename from the path, MIME type guessed from the extension) and optional field `comment`. It needs the header `X-Atlassian-Token: no-check`, and the timeout is 60 s.
- Binary download: `download-attachment` reads the attachment with `GET content/<id>`, then fetches `_links.download`. That is a server-supplied path, normally relative (`/download/attachments/...`), resolved under the base URL including its context path. An absolute link would carry the token to another host (#78 item 1, security). Core re-points it at the configured origin, a listed divergence. A content item with no download link is an error naming the ID and title. Timeout 60 s.
- `expand` values are comma lists that must be sent with literal commas. The contract un-encodes `%2C` in every query string, and core must do the same.
- `--markdown` makes an extra `POST contentbody/convert/storage` with `{value, representation: "markdown"}` before the write.

## Context inputs

- No group flags, no config defaults, no git remote use. Every command takes its IDs and keys explicitly (`--id`, `--space`, `--key`).
- `--body-file <path>` (`-` reads stdin) on `create-page` / `update-page`. `--file` on upload and `--dir` on download are files the workspace bound now governs.

## Supported version

Not established. The source targets Data Center's `/rest/api` and PAT Bearer auth. It names no minimum version.

## Watch for

- `get-page` default `--expand` is `body.storage,version,space,ancestors`. `get-page-by-title` uses `body.storage,version,space` with `type=page`, takes the first result, and fails with exit 1 `Page not found: "<title>" in space <KEY>` when there is none.
- `update-page` first GETs `expand=version`, sends `version.number + 1`, keeps the current title unless `--title`, and status defaults to `current`. With only `--title`, the PUT has no body (#78 item 6, pin).
- Write bodies always go in `body.storage` with `representation` set to the flag (`storage` or `wiki`); `--markdown` forces `storage` (#78 items 2 and 7, pin).
- On a failed create or update, the contract appends hints to the error message: the offending line for an XML parse error (`at [row,col]={R,C}`), and storage-format hints on HTTP 500. Port both exactly.
- `add-label` sends `[{prefix: "global", name}]` and returns `results`. `remove-label` puts the label name in the path unencoded (#78 item 4, pin). IDs and keys are unencoded everywhere.
- `list-comments` sends no `depth`, so replies are likely missing (#78 item 3, pin). `upload-attachment` can't add a new version of an existing file name (#78 item 5, pin).
- `download-attachment` names the file from the attachment title with every path segment dropped except the last (both `/` and `\`), with `attachment` as the fallback, and returns `{saved, filename, size}`. The contract wrote to its own dot-folder under the working directory (or `--dir`) and overwrote existing files. The workspace bound and the never-overwrite rule (#68, K3) replace both.
- Deletes return `{deleted: <id>}`; `remove-label` returns `{removed, from}`. `delete-attachment` moves the attachment to the trash.
