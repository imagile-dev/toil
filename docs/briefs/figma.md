# Figma (`figma`)

Wave 1 · Integration issue #40 · Suspected bugs #73 · 5 contract commands

## Commands

- **Files:** `file <file-key-or-url>`, `versions <file-key-or-url>`, `project-files <project-id>`
- **Comments:** `comments <file-key-or-url>`
- **Account:** `me`

All but `me` take a positional argument. The predecessor ran these against real Figma.

## Auth

- `figma.token` (`TOIL_FIGMA_TOKEN`) and `figma.baseUrl` (`TOIL_FIGMA_BASE_URL`). No CI fallback var.
- Header: `X-Figma-Token: <token>`, plus JSON `Accept`/`Content-Type`. No exchange.
- Config resolution has no default host. The predecessor's setup wrote `https://api.figma.com`, and a missing base URL errors with the fix `config set figma.baseUrl https://api.figma.com`.
- Connection test: `GET /v1/me`.

## Paging

None. Every command is one GET, and the response arrays are returned as they come:
- `versions` reads only the first page of history (#73 item 3).
- `comments` and `project-files` are single requests.

## Special HTTP needs

- **Custom auth header on redirect:** fetch strips `Authorization` on a cross-origin redirect but keeps `X-Figma-Token`. That is #73 item 1, the one Security item. Core's manual redirect handling (K2) refuses the cross-origin hop, and the integration lists it as a divergence instead of pinning it.
- **Server-supplied URLs:** `thumbnailUrl`, `img_url` and `thumbnail_url` are passed through in the output and never fetched. Nothing to re-point.
- **Node query:** `file` in node mode calls `GET /v1/files/{key}/nodes?ids=<id>`, with a colon-form ID.
- No multipart, binary downloads, text responses, GraphQL or polling.

## Context inputs

None. There are no group flags, and nothing defaults from config or the git remote.
- The file key comes from the positional value. A value starting `http://` or `https://` must match `figma.com/(design|file)/<key>`, or the command errors. Anything else is used as the key verbatim.
- The node ID comes from `--node-id`, or else the URL's `node-id` query param. Dashes become colons, and the result must match `<id>:<id>(;<id>:<id>)*`.

## Supported version

Not established. It calls Figma REST `v1` on `api.figma.com`.

## Watch for

- Pin #73 items 2 to 8:
  - `comments --as-of` sends `as_of`, which Figma ignores.
  - `versions` reads one page.
  - A branch URL resolves to the main file key.
  - FigJam, prototype and Slides URLs are rejected.
  - Node mode ignores `--document` and always returns the node tree.
  - Counts may undercount at `depth=1`.
  - A nodes-endpoint `err` is reported as "node not found".
- `file` without `--document` sends `depth=1` and leaves `document` out of the output. With `--document` there's no depth param, and `document` is included.
- The `file` output is reshaped, not passed through:
  - Whole-file mode returns `{fileKey, name, lastModified, version, thumbnailUrl, role, editorType, schemaVersion, [document], componentCount, styleCount}`.
  - Node mode returns `{fileKey, nodeId, name, lastModified, thumbnailUrl, document, componentCount, styleCount}`.
- The other outputs:
  - `comments` returns `{fileKey, count, comments}`.
  - `versions` returns `{fileKey, count, versions}`.
  - `project-files` returns `{projectId, count, files}`.
  - `me` passes the response through.
- An explicit `--node-id` must parse, or the command errors. A URL with no `node-id` param fetches the whole file. A malformed `node-id` in the URL still errors.
- The parse errors and the node-not-found error are plain `Error`s, not typed ones. The predecessor's `fail()` reported them with `status: 1` and `url: null`.
- The file key and project ID are `encodeURIComponent`-encoded in the path.
