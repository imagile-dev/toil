---
area: alation
description: Data sources, schemas, tables, columns, catalog search and Document Hub folders and documents on Alation
---

# Alation (`alation`)

The **Alation** data catalog (data sources, schemas, tables, columns and full-text
search) and its **Document Hubs** (folders and documents), through the Integration
API under `/integration/v1` and `/integration/v2`. Document `create` and `update`
write; everything else reads. Verification level: `unit`.

**Supported versions:** The oldest Alation version toil supports hasn't been established. toil needs
the token APIs under `integration/v1` and the Document Hub endpoints under
`integration/v2` (document, folder); releases with only Articles lack the latter. No
release has been verified yet.

## Credential

An Alation **refresh token** and the **numeric user ID** it belongs to: in Alation,
your profile → Account Settings → Authentication → Create Refresh Token. Alation shows the
user ID with the token. Refresh tokens last 60 days by default.

toil never sends the refresh token to the data API. It POSTs it, with the user ID, to
`integration/v1/createAPIAccessToken/` on the connection's own host, and sends the
24-hour API access token it gets back as the `TOKEN` header. The access token is kept
in memory only, per connection, and renewed a minute before it expires; under
`toil mcp` one exchange serves every call until then. There is no username, password
or browser login.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_ALATION_BASE_URL` | yes | Alation instance root, e.g. `https://alation.imagile.dev` (keep any context path) |
| `refreshToken` | `TOIL_ALATION_REFRESH_TOKEN` | yes | Refresh token |
| `userId` | `TOIL_ALATION_USER_ID` | yes | Numeric ID of the token's user; a number or a string of digits, anything else is `CONFIG_INVALID` |
| `writes` | `TOIL_ALATION_WRITES` | no | `true` lets `document create` and `document update` run (with `--allow-write`) |

Environment variables (CI, or a one-off shell):

```bash
export TOIL_ALATION_BASE_URL=https://alation.imagile.dev
export TOIL_ALATION_REFRESH_TOKEN=<your refresh token>
export TOIL_ALATION_USER_ID=102
```

Or `~/.toil/config.json`:

```json
{
  "version": 2,
  "connections": {
    "corp-alation": { "area": "alation", "baseUrl": "https://alation.imagile.dev", "userId": 102 }
  },
  "defaults": { "alation": { "connection": "corp-alation" } }
}
```

The refresh token never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add corp-alation --area alation` (or
`toil connections login corp-alation` for an existing connection) to keep it in the
OS credential store, or set `TOIL_ALATION_REFRESH_TOKEN`. There's no CI fallback
variable.

A refused exchange is `AUTH`, naming the endpoint: check the refresh token and user ID,
or make a new refresh token if it's past its 60 days. Alation's paths are Django
routes, so every path keeps its trailing slash. A redirect to another host is refused,
so the token stays on the configured one.

## Commands

IDs are positional and must be positive integers. Lists return one page: `--limit`
(default 100, 1 to 1000) and `--skip` (default 0), as `{ count, limit, skip, <items> }`.

- `token status`: Mint an API access token from the configured refresh token and
  report its expiry (verifies credentials). It mints a new token each time, then
  validates it, and returns `user_id`, `created_at`, `token_expires_at` and
  `token_status`, never the token.
- `datasource list`: List data sources (`--include-undeployed`, `--include-hidden`),
  as `{ count, datasources }`; not paged.
- `datasource get`: Get a data source by ID.
- `schema list`: List schemas, optionally within one data source (`--ds`, `--name`).
- `schema get`: Get a schema by ID.
- `table list`: List tables (descriptions, custom fields, fully-qualified keys):
  `--ds`, `--schema`, `--schema-name`, `--name`, and `--search` for a
  case-insensitive substring of the name.
- `table get`: Get a table by ID, optionally with its columns. `--columns` adds
  `columnCount` and `columns`, the first 1000 by ID, with an
  `ALATION_COLUMNS_TRUNCATED` warning when it reaches 1000.
- `column list`: List columns of a table (types, descriptions, keys, custom fields):
  `--table`, `--table-name`, `--schema`, `--ds`, `--name`, `--search`. At least one
  filter is required.
- `column get`: Get a column by ID.
- `search`: Full-text search across the catalog. `--otype table,column` restricts
  the object types (checked against Alation's list), `--limit` (default 20, at most
  10000) and `--offset` page it. Returns `{ query, total, limit, offset,
  fullSearchUrl, results }`.
- `folder list`: List folders in a Document Hub (`--hub`, `--parent`, `--search`).
- `folder get`: Get a Document Hub folder by ID.
- `document list`: List documents in a Document Hub or folder (`--hub`, `--folder`,
  `--parent-document`, `--search`, `--deleted`).
- `document get`: Get a document by ID, including its custom field values.
- `document schema`: Print the `--input-file` JSON schema and an example for
  document create/update. With `--example-only`, `data` is the example itself, ready
  to save as an input file. It needs no connection.
- `document create`: Create a document (async: returns a job ID; check it with
  `alation job get`). Needs a title, `--hub` and `--folder`, from flags or
  `--input-file`.
- `document update`: Update a document (async: returns a job ID; custom field values
  replace existing values per field). It can't change hubs, and needs at least one
  change.
- `job get`: Get the status of a bulk job (returned by document create/update).

`get` commands read the list endpoint with `id=<n>&limit=1`. If no row has that ID
they return the first row anyway, with an `ALATION_ID_MISMATCH` warning in
`meta.warnings`; check `data.id`.

### Document input files

`--input-file <path>` (`-` reads stdin on the CLI) holds `title`, `description`,
`hub`, `folder`, `template`, `parentDocument`, `navLinkFolders`, and `fields`: custom
field values keyed by numeric field ID. Custom fields need a template. A string value
starting with `@` is read from that file, inside the workspace. Flags win over the
file, and a `meta.warnings` entry names each value they overrode. Create and update
return `{ jobId, document, overrides? }`, where `document` is the payload sent.

```bash
toil alation search customer --otype table,column
toil alation table get 7 --columns
toil alation document schema --example-only > doc.json
toil alation document create --input-file doc.json --allow-write
toil alation job get 555
```
