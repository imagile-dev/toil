---
area: confluence
description: Pages, spaces, CQL search, comments, labels and attachments on Confluence Data Center
---

# Confluence Data Center (`confluence`)

Pages, spaces, CQL search, comments, labels and attachments on **Confluence Data
Center / Server** (the Server REST API under `/rest/api`). Verification level: `unit`.

**Supported versions:** Confluence Data Center 7.9 or later (Server REST API). toil
authenticates with a personal access token, which Confluence Data Center added in 7.9.
No release has been verified yet.

## Credential

A Confluence **personal access token**: in Confluence, your profile picture → Settings →
Personal Access Tokens → Create token. toil sends it as `Authorization: Bearer <token>`.
There is no username, password or browser login.

**The Jira token works too.** When the default Confluence connection has no token of
its own in env (`TOIL_CONFLUENCE_API_TOKEN`), it uses `TOIL_JIRA_API_TOKEN`, the default
Jira connection's env value. Any Confluence connection can instead borrow a Jira
connection's token, env or stored, by naming it: `"apiTokenFrom": "corp-jira"`.
`meta.context.shared` says when the token came from Jira, never the value.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_CONFLUENCE_BASE_URL` | yes | Confluence server root, e.g. `https://confluence.imagile.dev` (keep any context path, e.g. `https://confluence.imagile.dev/confluence`) |
| `apiToken` | `TOIL_CONFLUENCE_API_TOKEN` | yes, unless borrowed from Jira | Personal access token |
| `apiTokenFrom` | `TOIL_CONFLUENCE_API_TOKEN_FROM` | no | A Jira connection whose token this connection uses |
| `writes` | `TOIL_CONFLUENCE_WRITES` | no | `true` lets write commands run (with `--allow-write`) |

Environment variables (CI, or a one-off shell):

```bash
export TOIL_CONFLUENCE_BASE_URL=https://confluence.imagile.dev
export TOIL_CONFLUENCE_API_TOKEN=<your personal access token>
```

Or `~/.toil/config.json`:

```json
{
  "version": 2,
  "connections": {
    "corp-wiki": { "area": "confluence", "baseUrl": "https://confluence.imagile.dev", "apiTokenFrom": "corp-jira" }
  }
}
```

The token never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add corp-wiki --area confluence` (or
`toil connections login corp-wiki`) to keep it in the OS credential store, or set
`TOIL_CONFLUENCE_API_TOKEN`. Env vars always win over the file.

## Commands

Every command also takes `--connection <name>`. Write commands (marked ✎) need
`writes: true` on the connection **and** `--allow-write`; over MCP `allowWrite: true`
stands in for the flag. `delete-page` and `delete-attachment` run on the CLI only; they are
not MCP tools.

Ids, space keys and labels go into URL paths as given. One that is a `.` or `..`
segment, in any spelling (`%2e%2e` too), or contains `/`, `\`, `?` or `#`, is refused
with `INVALID_INPUT` before anything is sent.

| Command | Flags | Returns |
|---------|-------|---------|
| `get-page` | `--id --expand` | The page (default expand `body.storage,version,space,ancestors`) |
| `get-page-by-title` | `--space --title` | The first page with that exact title, or `NOT_FOUND` |
| `list-pages` | `--space --limit --start` | Every page in the space (or `--limit` of them, from `--start`) |
| `get-page-children` | `--id` | Every child page |
| `get-page-history` | `--id` | The page's history metadata |
| `search` | `--cql --limit --start --expand` | Confluence's search result, one page (25 by default) |
| `create-page` ✎ | `--space --title --body or --body-file --markdown --parent-id --representation` | The created page |
| `update-page` ✎ | `--id --title --body or --body-file --markdown --status --representation` | The updated page |
| `delete-page` ✎ | `--id` | `{ deleted }` |
| `list-comments` | `--id` | Top-level comments, with storage bodies |
| `add-comment` ✎ | `--id --body --representation` | The comment |
| `get-labels` | `--id` | Every label |
| `add-label` ✎ | `--id --labels a,b` | The labels Confluence reports |
| `remove-label` ✎ | `--id --label` | `{ removed, from }` |
| `list-spaces` | `--type --limit` | Every space (or `--limit` of them) |
| `get-space` | `--key` | The space, with its plain-text description |
| `list-attachments` | `--id` | Every attachment on the page |
| `upload-attachment` ✎ | `--id --file --comment` | The attachments created |
| `download-attachment` | `--id --dir` | `{ saved, filename, size }`; saves to `.toil/` by default |
| `delete-attachment` ✎ | `--id` | `{ deleted }`; the attachment goes to the trash |
| `check-dossier` | `--dossier <name\|file>` (or the folder's dossier) | `{ dossier, connection, ok, checked, checks }`: each space the dossier names (`space`, `spaces`), found or not; exit 1 when one is missing |

Over MCP the same commands are tools named `confluence_<command>` with hyphens as
underscores (`confluence_get_page`, `confluence_download_attachment`), taking camelCase
fields (`id`, `bodyFile`, `parentId`).

## Examples

```bash
toil confluence get-page --id 12345
toil confluence get-page-by-title --space DOCS --title "Release notes"
toil confluence search --cql 'space=DOCS AND type=page AND text~"runbook"' --limit 10
toil confluence list-pages --space DOCS --limit 50
toil confluence create-page --space DOCS --title "Runbook" --body-file runbook.html --parent-id 12345 --allow-write
toil confluence update-page --id 12345 --body-file runbook.html --allow-write
toil confluence add-label --id 12345 --labels runbook,ops --allow-write
toil confluence upload-attachment --id 12345 --file diagram.png --allow-write
toil confluence download-attachment --id 98765 --dir downloads
```

## Notes

- Bodies are Confluence **storage format** (XHTML). `--representation wiki` sends the
  value under `body.storage` with `representation: "wiki"`. `--markdown` asks
  Confluence's converter (`/rest/api/contentbody/convert/storage`) to turn Markdown into
  storage format first; whether your server accepts that hasn't been verified.
- `--body-file -` reads the body from stdin on the CLI. Over MCP, `-` is refused because
  stdin carries the protocol; pass a file path. Files resolve inside the workspace.
- When Confluence rejects a body, the error adds the offending line of an XML parse
  error, and known storage-format mistakes behind an HTTP 500 (`<ac:parameter name=…>`,
  a macro with no `ac:macro-id`).
- `update-page` reads the current version and sends the next one, keeping the title
  unless `--title` is given. With no body it sends none.
- `list-pages` and `list-spaces` without `--limit`, and the other lists always, page
  through everything, 25 at a time. A `--limit` that isn't a positive whole number
  (`abc`, `0`) usually returns an empty list, with a `CONFLUENCE_LIMIT_INVALID` warning.
- `download-attachment` never replaces a file: one of the same name in the target
  directory fails with `INVALID_INPUT`. The file name is the attachment title's last
  path segment. The token only ever goes to `baseUrl`'s host: a download link naming
  another host is fetched from `baseUrl` instead, with a `CONFLUENCE_ATTACHMENT_HOST`
  warning.
- `upload-attachment` always creates a new attachment; a file name already on the page
  isn't added as a new version.

## Data Center, not Cloud

This area targets Confluence Data Center and Server. Confluence Cloud is a separate
area, `confluence-cloud`, with its own `TOIL_CONFLUENCE_CLOUD_*` settings; don't
point this one at a Cloud site.
