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

The same account token works for Jira Cloud. With no token of its own, the default
connection uses `TOIL_JIRA_CLOUD_API_TOKEN` (the default `jira-cloud` connection's env
value). Any other connection borrows a `jira-cloud` connection's token, env or stored,
only by naming it: `"apiTokenFrom": "imagile-cloud"`. Its own token always wins, and
`meta.context.shared` says when the token came from Jira Cloud. Only the token is
borrowed: `email` is always this connection's own, and must be the address the token
belongs to.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_CONFLUENCE_CLOUD_BASE_URL` | yes | Confluence Cloud site root, without `/wiki`: `https://<your-site>.atlassian.net` |
| `email` | `TOIL_CONFLUENCE_CLOUD_EMAIL` | yes | Email address of the Atlassian account the token belongs to |
| `apiToken` | `TOIL_CONFLUENCE_CLOUD_API_TOKEN` | yes | Atlassian account API token (a secret), unless borrowed from Jira Cloud |
| `apiTokenFrom` | `TOIL_CONFLUENCE_CLOUD_API_TOKEN_FROM` | no | A `jira-cloud` connection whose token this connection uses |
| `writes` | `TOIL_CONFLUENCE_CLOUD_WRITES` | no | `true` lets write commands run (with `--allow-write`) |

toil adds `/wiki/api/v2` and `/wiki/rest/api` itself, so `baseUrl` is the site root. A
`baseUrl` ending in `/wiki` (as the browser shows it) is refused with `CONFIG_INVALID`
before anything is sent: drop the `/wiki`.
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
`confluence` wherever the operation is the same. MCP tools are named
after the path, with spaces and hyphens as underscores (`confluence_cloud_page_get`). The two deletes are CLI
only: they are never MCP tools.

| Command | Arguments and flags | Returns |
|---------|-------|---------|
| `page get` | `<id>` | The page with its storage body, plus `bodyText` |
| `page find` | `--space <key> --title` | The page with that exact title, plus `bodyText` |
| `page list` | `--space <key> --limit --cursor` | Pages in the space (no bodies) |
| `page children` | `<id>` | Direct children, each with its `type` |
| `page history` | `<id>` | Every version of the page |
| `page search` | `--cql --limit --cursor --expand` | One page of CQL results, as Confluence returns it |
| `page create` ✎ | `--space <key> --title --body --body-file --parent-id --representation` | The created page, plus `bodyText` |
| `page update` ✎ | `<id> --title --body --body-file --status --representation` | The updated page, plus `bodyText` |
| `page delete` ✎ (CLI only) | `<id>` | `{ deleted }` |
| `page comments` | `<id>` | Top-level footer comments, each with `bodyText` |
| `page comment` ✎ | `<id> --body --representation` | The comment, plus `bodyText` |
| `page labels` | `<id>` | The page's labels |
| `page label` ✎ | `<id> --labels <a,b>` | The labels Confluence reports |
| `page unlabel` ✎ | `<id> --label` | `{ removed, from }` |
| `space list` | `--type --limit --cursor` | Spaces the account can see |
| `space get` | `<key>` | The space, with its plain-text description |
| `page attachments` | `<page-id>` | The page's attachments |
| `page attach` ✎ | `<page-id> --file --comment` | The attachments Confluence created |
| `attachment download` | `<attachment-id> --dir` | `{ saved, filename, size }` |
| `attachment delete` ✎ (CLI only) | `<attachment-id>` | `{ deleted }` |

```bash
toil confluence-cloud page find --space DOCS --title "Release notes"
toil confluence-cloud page search --cql 'space=DOCS AND type=page AND text~"runbook"' --limit 10
toil confluence-cloud page create --space DOCS --title Runbook --body-file runbook.html --parent-id 12345 --allow-write
toil confluence-cloud page update 12345 --title "Release notes (archived)" --allow-write
toil confluence-cloud attachment download att98765 --dir downloads
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
Markdown converter. Write storage XHTML, or wiki markup, instead. `page get` has no
`--expand`: v2 has no expansions, and the body always comes back.

### Paging

Lists page by cursor. Without `--limit`, `page list` and `space list` read every
page of results. With `--limit N` they return at most N, and `meta.page.nextCursor`
resumes: pass it back as `--cursor` with `--limit`. Every other list
(`page children`, `page history`, `page comments`, `page labels`,
`page attachments`) is read in full. Paging stops after 1,000 requests with an error
naming the list.

`page search` returns one page, as Confluence returns it (`results`, `size`, `totalSize`,
`_links`), 25 results unless `--limit` says otherwise. When there are more,
`meta.page.nextCursor` is the cursor from its `_links.next`: pass it as `--cursor`
(with the same `--cql`) for the next page. `confluence`'s `--offset` isn't here: Cloud
search pages by cursor.

## Notes

- `page update` reads the page first and sends the next version number, keeping the
  title unless `--title` is given. Confluence Cloud requires a body on every update,
  so with no `--body` or `--body-file` the current storage body is sent back
  unchanged (a rename). `--status draft` sends version 1, as Atlassian documents for
  a change to draft, and deletes any draft the page already has. `--representation` without a body is `INVALID_INPUT`.
- `page create` without `--parent-id` puts the page under the space's homepage, as
  the API does.
- `page children` uses v2's direct children, which lists folders, whiteboards,
  databases and embeds beside child pages; each result's `type` says which.
- `page history` returns the version list (`number`, `createdAt`, `authorId`,
  `message`, `minorEdit`), where `confluence` returns Data Center's history object.
- `page comments` reads footer comments only, top level only: no replies and no inline
  comments. `page comment` adds a footer comment.
- `page label` and `page unlabel` use v1, since v2 can't write labels. Labels are added
  with the `global` prefix. `page unlabel` sends the label as a query parameter, so any
  label can be removed.
- `page attach` uses v1 multipart with `X-Atlassian-Token: nocheck`, and always
  adds a new attachment. The file name is the path's last segment, with `/` or `\`
  splitting it on every platform.
- `attachment download` reads the attachment, then fetches its `downloadLink` under
  `baseUrl/wiki` with the credential. Confluence answers with a redirect to a signed
  URL on Atlassian's media host; toil follows it with **every header dropped**, so the
  credential stays on your site. It saves under `.toil/` (or `--dir`), keeping only the
  file name, and never replaces a file that's already there. A name Windows would read
  as another file is saved as one it won't: a device name such as `CON` gets a leading
  `_`, a `:` and what follows it is dropped, as are trailing dots and spaces.
- `page delete` and `attachment delete` move the item to the trash; neither purges.
- A 429 is retried after the delay Confluence asks for, as in every area.
