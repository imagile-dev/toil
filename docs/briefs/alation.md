# Alation (`alation`)

Wave 2 · Integration issue #41 · Suspected bugs #77 · 18 contract commands

## Commands

- Token: `alation token status`
- Catalog: `datasource list|get <id>`, `schema list|get <id>`, `table list|get <id> [--columns]`,
  `column list|get <id>`, `search <query>`
- Document Hubs: `folder list|get <id>`, `document list|get <id>`, `document schema`,
  `document create`, `document update <id>`
- Jobs: `job get <id>`

IDs are positional and must be positive integers. Lists wrap results:
`{ count, limit, skip, <plural>: [] }` (`datasource list` has only `count, datasources`).

## Auth

`alation.baseUrl` (`TOIL_ALATION_BASE_URL`, e.g. `https://alation.imagile.dev`),
`alation.refreshToken` (`TOIL_ALATION_REFRESH_TOKEN`, secret, 60-day default life),
`alation.userId` (`TOIL_ALATION_USER_ID`, the numeric ID shown with the token). `userId`
may be a number or string in config; anything not a positive integer is a config error.

Exchange: `POST <base>/integration/v1/createAPIAccessToken/` with JSON
`{ refresh_token, user_id }`, returning `api_access_token` and `token_expires_at`. The
access token goes in the `TOKEN` header on every data request. Cache in memory per
connection, refresh within 60 s of `token_expires_at`, default to 24 h when it is missing
or unparseable. A failed exchange is a `ToilError` naming the endpoint, with the fix
"check refreshToken and userId; refresh tokens expire after 60 days".

`token status` mints a fresh token, then `POST integration/v1/validateAPIAccessToken/`
with `{ api_access_token, user_id }`, and returns the response minus the token
(`user_id`, `created_at`, `token_expires_at`, `token_status`). Under dry-run it mints nothing.

## Paging

Skip/limit on `integration/v2/{schema,table,column,folder,document}/`: `--limit` default 100,
range 1 to 1000 (Alation's cap), `--skip` default 0. One page per call, no loop.
`search` uses `--limit` (default 20, max 10000) and `--offset`. `datasource list`
(`integration/v1/datasource/`) is unpaged. `table get --columns` fetches one page of
`limit=1000, order_by=id`.

## Special HTTP needs

- `TOKEN` is a custom auth header: core must refuse a cross-origin redirect.
- Django routes: the trailing slash on every path is significant.
- `search --otype a,b` sends `filters={"otypes":["a","b"]}` as one query value; otypes are
  checked against a fixed list in the source.
- Writes are async. `document create` POSTs a one-element array, `document update` PUTs
  `[{ id, ...fields }]`; both return `{ jobId, document, overrides? }`. `job get` reads
  `api/v1/bulk_metadata/job/?id=<id>`. No polling in the predecessor.
- `--input-file` (or `-` for stdin) carries title, description, hub, folder, template,
  parentDocument, navLinkFolders and `fields` keyed by numeric field ID; `@path` values are
  read from files, so they need the file workspace. Flags override the file, with a warning.

## Context inputs

None at group level; filters (`--ds`, `--schema`, `--hub`, `--folder`) are per command.

## Supported version

Not established. Hints: Document Hub endpoints (`integration/v2/document/`, `folder/`) and
the token APIs under `integration/v1/` are required; older releases with only Articles lack
the former.

## Watch for

- Match exactly: create requires title, hub and folder; custom fields require a template;
  update refuses `hub` and an empty payload; `column list` refuses no filter at all;
  `document schema --example-only` prints raw JSON (check this against decision 4 and the
  envelope rule).
- Pin: the `get` commands query the list endpoint with `id=<n>&limit=1` and, when no row
  matches, fall back to `rows[0]`, which can return a different object.
- Pin: `table get --columns` truncates at 1000 columns with no notice.
- Pin: `search --limit 0` is accepted; `navLinkFolders` is passed through unvalidated.
- `token status` and `config test` each create a server-side token that accumulates.
- The predecessor named meta commands `token-status`, `table-get` and so on, not the
  contract's spaced paths.
