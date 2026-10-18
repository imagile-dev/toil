---
area: util
description: Local utilities with no connection or network, decoding a JWT, inventorying dependencies from manifests and lockfiles, and drawing C4 architecture diagrams from a JSON model
---

# Local utilities (`util`)

Commands that work on what's on this machine: a token you paste, the
manifests and lockfiles in the workspace, or a C4 model you describe in JSON. They aren't integrations. There is no
server, no connection to add, no `TOIL_UTIL_*` variable, no credential and no
`--connection` flag, and none of them sends anything over the network. Every
command reads; none changes anything. Verification level: `unit`.

The older commands have two paths that do the same thing, with the same flags
and output. The `util` path is the main one, and the short path is an alias.
The `util c4` commands have only the `util` path:

| Command | Alias | MCP tool |
|---------|-------|----------|
| `toil util jwt decode` | `toil jwt decode` | `util_jwt_decode` |
| `toil util deps scan` | `toil deps scan` | `util_deps_scan` |
| `toil util deps diff` | `toil deps diff` | `util_deps_diff` |
| `toil util c4 render` | | `util_c4_render` |
| `toil util c4 mermaid` | | `util_c4_mermaid` |
| `toil util c4 d2` | | `util_c4_d2` |

Over MCP the tools are served without any configuration. `toil mcp --areas util`
serves just these.

## Commands

### `toil util jwt decode`

Decodes a JWT's header and claims **without verifying it**. There's no key and no
network call, and nothing here says whether the token is valid, expired or trusted.

```bash
toil util jwt decode eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMxMjM0NSJ9.c2ln
echo "$TOKEN" | toil util jwt decode -
```

| Argument | Meaning |
|----------|---------|
| `<token>` | The token, `header.payload.signature`. `-` reads it from stdin, which keeps it out of the process list and your shell history; one trailing line ending is dropped |

Output: `{ header, payload, signature }`, the header and claims as parsed JSON and
the signature segment as the text it is.

- A token that isn't three dot-separated parts (an encrypted 5-part JWE, say) fails
  with `INVALID_INPUT`, `Invalid JWT: expected 3 dot-separated parts`.
- A header or payload that doesn't decode to JSON fails with `Invalid JWT: header is
  not valid JSON` (or `payload`). A `Bearer ` prefix gives this error too, so strip it.
- The decoding is lenient, as it has always been. A segment that is JSON but not an
  object (`null`, a number) comes back as it is. Characters outside base64url are
  skipped. Invalid UTF-8 shows as `�`. Whitespace in a token passed as an argument
  is kept, so a trailing newline ends up in `signature`.

The token goes nowhere but the decoder. toil doesn't log it, and no error message
repeats it.

### `toil util deps scan`

The dependency inventory of the workspace, from its manifests and lockfiles. It
reads files only and needs no git. It must be inside a git repository, though, or it
fails with `Not inside a git repository. deps commands require a git repo root.`

```bash
toil util deps scan
toil util deps scan --ecosystem npm --include-transitive --include-dev
toil util deps scan | toil osv vulns
```

| Flag | Meaning |
|------|---------|
| `--ecosystem <ecosystem>` | `npm`, `nuget`, `maven` or `all` (default). Any other value matches nothing and scans nothing |
| `--include-transitive` | Include transitive dependencies (left out by default) |
| `--include-dev` | Include dev and test dependencies (left out by default) |

Which files it reads:

- **Which files:** every file in the workspace that `git ls-files --cached --others
  --exclude-standard` would list. That's tracked files plus untracked ones `.gitignore`
  and `.git/info/exclude` don't cover. A nested repository isn't walked into. Your
  global git excludes file isn't read, so a file only it ignores is scanned.
- **npm:** `package.json` (not under `node_modules`), with the first of
  `package-lock.json` (v2 or later), `yarn.lock` (v1) or `pnpm-lock.yaml` beside it.
  A `package-lock.json` with no packages falls back to `package.json`.
- **NuGet:** `.csproj`, `.fsproj`, `.vbproj`, `packages.config` and
  `Directory.Packages.props`, with a `packages.lock.json` in the same folder. Project
  files that share one lock file count once. A project with no version on a
  `PackageReference` takes it from the nearest `Directory.Packages.props`, up to 10
  folders up.
- **Maven/Gradle:** `pom.xml`, `build.gradle` and `build.gradle.kts`, with a
  `gradle.lockfile` beside them.

A lockfile wins over its manifest. Packages are de-duplicated on ecosystem, name,
version and source file. A manifest that can't be read is skipped. One that exists
but can't be read (a link out of the workspace, say) also gets a
`DEPS_FILE_SKIPPED` warning in `meta.warnings`.

Output:

```json
{
  "ecosystems": ["npm", "nuget", "maven"],
  "manifests": [{ "file": "package.json", "ecosystem": "npm", "lockFile": "package-lock.json" }],
  "packages": [{ "name": "lodash", "version": "4.17.21", "ecosystem": "npm", "source": "package-lock.json", "type": "direct", "scope": "production" }],
  "summary": { "totalPackages": 1, "byEcosystem": { "npm": 1 }, "byType": { "direct": 1, "transitive": 0 }, "byScope": { "production": 1, "dev": 0 } }
}
```

Paths are relative to the workspace, with forward slashes. Maven names are
`group:artifact`. When the repository's root is above the workspace, only the
workspace is scanned: run it from the root, or pass `--workspace <root>`, to scan
everything.

Known quirks, which stay until they're checked against real repositories:

- In an npm v7+ lockfile, `direct` means hoisted to the top `node_modules`, so most
  transitive packages count as direct. Workspace folders show up as packages.
- Yarn 1 headers with several ranges give a garbled name. Yarn 2+ lockfiles give no
  packages.
- pnpm peer suffixes stay in the version, and pnpm 9's scoped packages are missed.
- `CentralTransitive` NuGet packages count as direct.
- `gradle.lockfile` test dependencies are always included.
- Any `word 'a:b:c'` string in `build.gradle` reads as a dependency.
- `pom.xml` plugin dependencies count as the project's.

The output is the inventory the vulnerability and licence commands read from stdin
or `--from <file>`: `toil osv vulns`, `toil ossindex vulns`, `toil sonatypeiq
evaluate`, and `toil artifactory outdated` / `license-check`. Over MCP, save it to a
file in the workspace and pass that file's path as `from`.

### `toil util deps diff`

How the inventory changed between two git refs. This command runs the git on PATH:
`git ls-tree` for each ref's files and `git show` for each one it reads. Without git
it fails with `GIT_NOT_FOUND`.

```bash
toil util deps diff --from main
toil util deps diff --from v1.0.0 --to main --ecosystem npm --include-dev
```

| Flag | Meaning |
|------|---------|
| `--from <ref>` | The base ref: a commit, tag or branch. Required |
| `--to <ref>` | The target ref (default: the working tree, scanned as `deps scan` does) |
| `--ecosystem <ecosystem>` | `npm`, `nuget`, `maven` or `all` (default) |
| `--include-dev` | Include dev and test dependencies |

Transitive dependencies are always included. Output: `{ from, to, changes: [{ name,
ecosystem, change, from, to, source }], summary: { added, removed, upgraded,
downgraded, unchanged } }`. `change` is `added`, `removed`, `upgraded` or
`downgraded`. Unchanged packages are counted, not listed. `to` reads `working tree`
when `--to` is left out.

Known quirks:

- A ref git can't read (a typo, or one you haven't fetched) gives an empty
  inventory for that side, so a bad `--from` reports every package as `added`.
  Check the ref first.
- Each package is keyed on ecosystem, name and source file, and one version per key
  survives. A package present at two versions can show a change that didn't happen.
- Paths that git quotes (non-ASCII names) aren't read at a ref.
- A ref that starts with `-`, or an empty `--from`, is refused with `INVALID_INPUT` before git runs. An empty `--to` means the working tree.

### `toil util c4 render`, `toil util c4 mermaid`, `toil util c4 d2`

One view of a C4 architecture model: `render` draws it as SVG, `mermaid` writes it
as Mermaid's C4 syntax (GitHub draws a ```` ```mermaid ```` block inline), and `d2`
writes it as D2 text. `render` lays the diagram out itself, with a layered layout
made for C4 views: people on the top row, the scope's children together inside
their dashed boundary, and each relationship's label placed clear of the boxes.
Nothing is installed or run, and nothing goes over the network.

```bash
toil util c4 render --model docs/c4/bookshop.c4.json --view containers --out containers.svg
toil util c4 mermaid --model docs/c4/bookshop.c4.json --view context
cat model.json | toil util c4 d2 --model - --view components
```

| Flag | Meaning |
|------|---------|
| `--model <file>` | A JSON file holding the model, inside the workspace. `-` reads it from stdin |
| `--model-json <json>` | The model itself, as a JSON string, instead of `--model`. Over MCP this is the `model` field, which takes the JSON object |
| `--view <key>` | The view to draw. It can be left out when the model has only one |
| `--out <file>` | `render` only: write the SVG to this new file inside the workspace instead of returning it. toil never overwrites a file |

The model:

```json
{
  "title": "Online bookshop",
  "people": [{ "id": "customer", "name": "Customer", "description": "Buys books" }],
  "systems": [{
    "id": "bookshop", "name": "Online Bookshop", "description": "Sells books at bookshop.imagile.dev",
    "containers": [
      { "id": "web", "name": "Web shop", "technology": "React",
        "components": [{ "id": "cart", "name": "Cart", "technology": "TypeScript" }] },
      { "id": "db", "name": "Database", "technology": "PostgreSQL", "database": true }
    ]
  }, { "id": "payments", "name": "Payment provider", "external": true }],
  "relationships": [{ "source": "customer", "destination": "web", "description": "Buys books using", "technology": "HTTPS" }],
  "views": [
    { "key": "context", "type": "systemContext", "scope": "bookshop" },
    { "key": "containers", "type": "container", "scope": "bookshop" },
    { "key": "components", "type": "component", "scope": "web", "include": ["*", "payments"] }
  ]
}
```

- **Elements** are people and software systems at the top, containers inside a
  system, and components inside a container. Each has an `id`, a `name`, and
  optionally a `description`, a `technology` (containers and components) and
  `external: true`, which draws it grey. A container with `database: true` is drawn
  as a cylinder. Ids start with a letter and hold only letters, digits and
  underscores, and are unique across the whole model.
- **Relationships** join any two elements, at any level: `source`, `destination`,
  and optionally `description` and `technology`.
- **Views** have a `key`, a `type` (`systemContext`, `container` or `component`), a
  `scope` (a system for the first two, a container for `component`), an optional
  `title`, and an optional `include` list of ids. `"*"` in it stands for the default
  set, which is also what you get with no `include`: for `systemContext`, the scope
  and every person and system related to it; for `container`, the scope's
  containers inside a dashed boundary and what they relate to; for `component`, the
  scope's components and what they relate to.
- A relationship is drawn between the nearest elements a view shows, so one between
  two containers shows up between their systems in a system context view. Model
  relationships at the most detailed level you know. One that ends on a view's own
  boundary from outside can't be drawn there; a `C4_RELATIONSHIP_NOT_DRAWN` warning
  in `meta.warnings` names it, unless that outside element already has a drawn
  relationship into the boundary.

Output: `{ view, type, title, elements, relationships, verified, format, svg }` for
`render`, where `elements` lists the ids drawn and `relationships` counts the arrows.
`render` checks its own drawing before returning it, and `verified` says what held:
`{ boxesApart, childrenInBoundary, edgesTouchBoxes, labelsClearOfBoxes }`. Each
check that fails is a `C4_LAYOUT_CHECK` warning in `meta.warnings` naming the boxes
or arrow involved, so a bad drawing is never returned without saying so. The
layout is meant for C4-sized views; past about 25 boxes, arrows start to cross more
often and can pass behind boxes, which no check covers. With
`--out`, `{ file, bytes }` take the place of `svg`, and `file` is the absolute path
written. `mermaid` and `d2` return `text` in place of `svg`.

A model with mistakes fails with `INVALID_INPUT` before anything is drawn. The
message names each problem by its path in the model, such as
`relationships[2].destination: no element has the id "warehose"`, and
`error.details` lists them all. An unknown `--view` lists the keys the model has.

A sample model, an online bookshop with all three views, is
`docs/c4/bookshop.c4.json` in toil's source, and `docs/c4/busy.c4.json` is a busier
view of 25 boxes.
