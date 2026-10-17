---
area: confluence-cloud
description: Pages, spaces, CQL search, comments, labels and attachments on Confluence Cloud
---

# Confluence Cloud (`confluence-cloud`)

Pages, spaces, CQL search, comments, labels and attachments on **Confluence Cloud**
(`https://<your-site>.atlassian.net`, REST API v2, with v1 where v2 has no
endpoint). Built from Atlassian's API documentation and never run against a live
site. Verification level: `unit`.

For Confluence Data Center or Server, use the `confluence` area instead. The two are
separate areas because their APIs differ: Cloud's v2 API has different paths, pages
by cursor rather than offset, and addresses spaces by a numeric id rather than their
key.

**Supported versions:** The oldest Confluence Cloud version toil supports hasn't been established.
Confluence Cloud is always current. toil calls REST API v2
(`/wiki/api/v2`) and, where v2 has no endpoint, v1 (`/wiki/rest/api`: CQL search,
adding and removing labels, attachment uploads), with an Atlassian account email and
API token sent as Basic auth. Nothing has been run against a live site yet.

## Credential

An **Atlassian account API token** plus that account's **email address**. Create
the token at https://id.atlassian.com/manage-profile/security/api-tokens (Atlassian
account → Security → API tokens → Create API token). toil sends
`Authorization: Basic base64(<email>:<apiToken>)`, as Atlassian documents for
scripts. There is no password, OAuth app or browser login. The token acts with the
account's own permissions, so a read sees what that account can see.

The same account token works for Jira Cloud on the same site, but this area never
borrows one: give each connection its own `email` and `apiToken`.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_CONFLUENCE_CLOUD_BASE_URL` | yes | Confluence Cloud site root, without `/wiki`: `https://<your-site>.atlassian.net` |
| `email` | `TOIL_CONFLUENCE_CLOUD_EMAIL` | yes | Email address of the Atlassian account the token belongs to |
| `apiToken` | `TOIL_CONFLUENCE_CLOUD_API_TOKEN` | yes | Atlassian account API token (a secret) |
| `writes` | `TOIL_CONFLUENCE_CLOUD_WRITES` | no | `true` lets write commands run (with `--allow-write`) |

toil adds `/wiki/api/v2` and `/wiki/rest/api` itself, so `baseUrl` is the site root.
There is no CI fallback variable. The examples use the placeholder
`https://confluence-cloud.imagile.dev`, which never resolves; your own site is
`https://<your-site>.atlassian.net`.

```bash
export TOIL_CONFLUENCE_CLOUD_BASE_URL=https://confluence-cloud.imagile.dev
export TOIL_CONFLUENCE_CLOUD_EMAIL=you@example.com
export TOIL_CONFLUENCE_CLOUD_API_TOKEN=<your API token>
```

Or `~/.toil/config.json`:

```json
{
  "version": 2,
  "connections": {
    "imagile-wiki": { "area": "confluence-cloud", "baseUrl": "https://confluence-cloud.imagile.dev", "email": "you@example.com", "writes": true }
  },
  "defaults": { "confluence-cloud": { "connection": "imagile-wiki" } }
}
```

The token never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add imagile-wiki --area confluence-cloud` (or
`toil connections login imagile-wiki`) to keep it in the OS credential store, or set
`TOIL_CONFLUENCE_CLOUD_API_TOKEN`. Env vars always win over the file.

## Commands

Every command also takes `--connection <name>`. Write commands (marked ✎) need
`writes: true` on the connection **and** `--allow-write`. Names and flags match
`confluence` wherever the operation is the same. MCP tools are
`confluence_cloud_<command>` (`confluence_cloud_get_page`). The two deletes are CLI
only: they are never MCP tools.

| Command | Flags | Returns |
|---------|-------|---------|
| `get-page` | `--id` | The page with its storage body, plus `bodyText` |
| `get-page-by-title` | `--space <key> --title` | The page with that exact title, plus `bodyText` |
| `list-pages` | `--space <key> --limit --cursor` | Pages in the space (no bodies) |
| `get-page-children` | `--id` | Direct children, each with its `type` |
| `get-page-history` | `--id` | Every version of the page |
| `search` | `--cql --limit --cursor --expand` | One page of CQL results, as Confluence returns it |
| `create-page` ✎ | `--space <key> --title --body --body-file --parent-id --representation` | The created page, plus `bodyText` |
| `update-page` ✎ | `--id --title --body --body-file --status --representation` | The updated page, plus `bodyText` |
| `delete-page` ✎ (CLI only) | `--id` | `{ deleted }` |
| `list-comments` | `--id` | Top-level footer comments, each with `bodyText` |
| `add-comment` ✎ | `--id --body --representation` | The comment, plus `bodyText` |
| `get-labels` | `--id` | The page's labels |
| `add-label` ✎ | `--id --labels <a,b>` | The labels Confluence reports |
| `remove-label` ✎ | `--id --label` | `{ removed, from }` |
| `list-spaces` | `--type --limit --cursor` | Spaces the account can see |
| `get-space` | `--key` | The space, with its plain-text description |
| `list-attachments` | `--id <page-id>` | The page's attachments |
| `upload-attachment` ✎ | `--id <page-id> --file --comment` | The attachments Confluence created |
| `download-attachment` | `--id <attachment-id> --dir` | `{ saved, filename, size }` |
| `delete-attachment` ✎ (CLI only) | `--id <attachment-id>` | `{ deleted }` |

```bash
toil confluence-cloud get-page-by-title --space DOCS --title "Release notes"
toil confluence-cloud search --cql 'space=DOCS AND type=page AND text~"runbook"' --limit 10
toil confluence-cloud create-page --space DOCS --title Runbook --body-file runbook.html --parent-id 12345 --allow-write
toil confluence-cloud update-page --id 12345 --title "Release notes (archived)" --allow-write
toil confluence-cloud download-attachment --id att98765 --dir downloads
```

### Ids and keys

Page ids are numbers (`12345`); attachment ids carry an `att` prefix (`att98765`).
Commands that take `--space` take the space **key** (`DOCS`), as `confluence` does;
toil looks up the numeric space id v2 needs with one extra request, and a key that
matches nothing is `NOT_FOUND`. An id containing `/`, `\`, `?` or `#` is refused with
`INVALID_INPUT` before anything is sent, and the rest is percent-encoded as one path
segment.

### Body format: storage

Bodies are **storage format**, the XHTML Confluence keeps pages in, both ways:

- **Out**: every page and comment is read with `body-format=storage`, so
  `body.storage.value` is the XHTML. Beside it, `bodyText` is a plain-text rendering:
  tags dropped, blocks on their own lines, list items as `- `, table cells joined
  with ` | `, code macro text kept, macro parameters dropped. It's for reading, not
  for writing back.
- **In** (`--body`, `--body-file`): storage-format XHTML, or wiki markup with
  `--representation wiki`, which Confluence converts to storage. Atlassian Document
  Format isn't offered.

`confluence`'s `--markdown` isn't here: Confluence Cloud documents no synchronous
Markdown converter. Write storage XHTML, or wiki markup, instead. `get-page` has no
`--expand`: v2 has no expansions, and the body always comes back.

### Paging

Lists page by cursor. Without `--limit`, `list-pages` and `list-spaces` read every
page of results. With `--limit N` they return at most N, and `meta.page.nextCursor`
resumes: pass it back as `--cursor` with `--limit`. Every other list
(`get-page-children`, `get-page-history`, `list-comments`, `get-labels`,
`list-attachments`) is read in full. Paging stops after 1,000 requests with an error
naming the list.

`search` returns one page, as Confluence returns it (`results`, `size`, `totalSize`,
`_links`), 25 results unless `--limit` says otherwise. When there are more,
`meta.page.nextCursor` is the cursor from its `_links.next`: pass it as `--cursor`
(with the same `--cql`) for the next page. `confluence`'s `--start` isn't here: Cloud
search pages by cursor.

## Notes

- `update-page` reads the page first and sends the next version number, keeping the
  title unless `--title` is given. Confluence Cloud requires a body on every update,
  so with no `--body` or `--body-file` the current storage body is sent back
  unchanged (a rename). `--status draft` sends version 1, as Atlassian documents for
  a change to draft. `--representation` without a body is `INVALID_INPUT`.
- `create-page` without `--parent-id` puts the page under the space's homepage, as
  the API does.
- `get-page-children` uses v2's direct children, which lists folders, whiteboards,
  databases and embeds beside child pages; each result's `type` says which.
- `get-page-history` returns the version list (`number`, `createdAt`, `authorId`,
  `message`, `minorEdit`), where `confluence` returns Data Center's history object.
- `list-comments` reads footer comments only, top level only: no replies and no inline
  comments. `add-comment` adds a footer comment.
- `add-label` and `remove-label` use v1, since v2 can't write labels. Labels are added
  with the `global` prefix. `remove-label` sends the label as a query parameter, so any
  label can be removed.
- `upload-attachment` uses v1 multipart with `X-Atlassian-Token: nocheck`, and always
  adds a new attachment. The file name is the path's last segment, with `/` or `\`
  splitting it on every platform.
- `download-attachment` reads the attachment, then fetches its `downloadLink` under
  `baseUrl/wiki` with the credential. Confluence answers with a redirect to a signed
  URL on Atlassian's media host; toil follows it with **every header dropped**, so the
  credential stays on your site. It saves under `.toil/` (or `--dir`), keeping only the
  file name, and never replaces a file that's already there.
- `delete-page` and `delete-attachment` move the item to the trash; neither purges.
- A 429 is retried after the delay Confluence asks for, as in every area.
