---
area: figma
description: Figma files and nodes from a link, comments, version history and project files
---

# Figma (`figma`)

Files and single nodes (from a key or a pasted Figma link), comments, version
history and project file lists, through the **Figma REST API** (`/v1/...`). Every
command reads; none changes anything. Verification level: `unit`.

**Supported versions:** The oldest Figma version toil supports hasn't been established. toil
calls the Figma REST API v1 with a personal access token in `X-Figma-Token`. Nothing
has been run against a live account yet.

## Credential

A Figma **personal access token**: in Figma, Settings → Security → Personal access
tokens. toil sends it as the `X-Figma-Token` header, to the configured `baseUrl` and
nowhere else. A redirect to another host is refused rather than followed, so the
token never travels with it. There is no OAuth app, password or browser login.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_FIGMA_BASE_URL` | yes | Figma API root: `https://api.figma.com` (toil has no built-in default) |
| `token` | `TOIL_FIGMA_TOKEN` | yes | Personal access token |

There's no CI fallback variable.

Environment variables (CI, or a one-off shell):

```bash
export TOIL_FIGMA_BASE_URL=https://api.figma.com
export TOIL_FIGMA_TOKEN=<your personal access token>
```

Or `~/.toil/config.json`:

```json
{
  "version": 2,
  "connections": {
    "figma": { "area": "figma", "baseUrl": "https://api.figma.com" }
  },
  "defaults": { "figma": { "connection": "figma" } }
}
```

The token never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add figma --area figma` (or
`toil connections login figma` for an existing connection) to keep it in the OS
credential store, or set `TOIL_FIGMA_TOKEN`.

## Links, keys and node IDs

Wherever a command takes `<file-key-or-url>`, pass the file key or a link. A link
(anything starting `http://` or `https://`) must contain `figma.com/design/<key>` or
`figma.com/file/<key>`; anything else fails with "Could not extract Figma file key
from URL". A value that isn't a link is used as the key as it stands. The link is
parsed locally and never opened.

- A branch link (`/design/<key>/branch/<branch-key>/...`) resolves to the main
  file's key, not the branch's.
- FigJam (`/board/`), prototype (`/proto/`) and Slides (`/slides/`) links are
  refused; pass the bare key instead.
- A node ID is `12:34` or `12-34` (dashes become colons), or for a layer inside an
  instance `I12:34;56:78`. `file get` takes it from `--node-id`, else from the link's
  `node-id` query parameter. A malformed one fails with "Invalid Figma node ID".

## Commands

- `file get <file-key-or-url>`: Get a Figma file — metadata, structure, and component/style inventory (or a
  single node with `--node-id`).
  - Whole file: `data` is `fileKey`, `name`, `lastModified`, `version`,
    `thumbnailUrl`, `role`, `editorType`, `schemaVersion`, `componentCount` and
    `styleCount`. The request sends `depth=1`, so component and style counts may be
    lower than with `--document`. `--document` drops `depth` and adds the full
    `document` tree, which can be large.
  - One node (`--node-id`, or a link with `node-id`): `GET /v1/files/<key>/nodes`;
    `data` is `fileKey`, `nodeId`, `name`, `lastModified`, `thumbnailUrl`, the node's
    whole `document` subtree (with or without `--document`), `componentCount` and
    `styleCount`. A node the answer doesn't hold is `NOT_FOUND` ("Node 12:34 not
    found in file ...").
- `file comments <file-key-or-url>`: Get comments on a Figma file. `data` is `fileKey`, `count` and
  `comments` as Figma returns them. `--as-of <date>` is sent as `as_of`, a parameter
  Figma doesn't document, so every comment comes back regardless, and
  `meta.warnings` says so (`FIGMA_AS_OF_IGNORED`).
- `file versions <file-key-or-url>`: Get the version history of a Figma file. `data` is `fileKey`, `count`
  and `versions`. Only the first page Figma returns is read; when Figma has more,
  `meta.warnings` says so (`FIGMA_MORE_VERSIONS`) and older versions are missing.
- `project files <project-id>`: List files in a Figma project. `data` is `projectId`, `count` and
  `files`. The project ID is in the project's URL.
- `whoami`: Get the current Figma user (useful for verifying credentials). `data` is
  Figma's answer as it came.

Image links in the answers (`thumbnailUrl`, `thumbnail_url`, `img_url`) are returned
as they are and never fetched; they're on Figma's image host, not the API.

```bash
toil figma file get "https://www.figma.com/design/abc12345/Checkout?node-id=12-34"
toil figma file get abc12345 --document
toil figma file comments abc12345
toil figma whoami
```
