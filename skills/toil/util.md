---
area: util
description: Local utilities with no connection or network, decoding a JWT, inventorying dependencies from manifests and lockfiles, and reading OpenAPI documents
---

# Local utilities (`util`)

Commands that work on what's on this machine: a token you paste, an API
description in the workspace, or its manifests and lockfiles. They aren't integrations. There is no
server, no connection to add, no `TOIL_UTIL_*` variable, no credential and no
`--connection` flag, and none of them sends anything over the network. Every
command reads; none changes anything. Verification level: `unit`.

The `jwt` and `deps` commands also have a short path that does the same thing, with
the same flags and output. The `util` path is the main one:

| Command | Alias | MCP tool |
|---------|-------|----------|
| `toil util jwt decode` | `toil jwt decode` | `util_jwt_decode` |
| `toil util deps scan` | `toil deps scan` | `util_deps_scan` |
| `toil util deps diff` | `toil deps diff` | `util_deps_diff` |
| `toil util openapi list` | | `util_openapi_list` |
| `toil util openapi show` | | `util_openapi_show` |
| `toil util openapi example` | | `util_openapi_example` |

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

### `toil util openapi`: read an API description before calling it

Three commands that read an OpenAPI 3.0, 3.1 or 3.2 or Swagger 2.0 document, in JSON
or YAML, so you can call an endpoint right the first time, usually through
`toil <area> api`. The document is a file in the workspace, `-` for stdin, or
`--text` (`file` or `text` over MCP). Nothing is fetched: the official schemas
each version is checked against are bundled.

```bash
toil util openapi list jira-platform.json --tag Issues
toil util openapi list github.yaml --path pulls
toil util openapi show jira-platform.json --operation createIssue
toil util openapi show bitbucket.json --method POST --path /repositories/{workspace}/{repo_slug}/pullrequests --depth 1
toil util openapi example jira-platform.json --operation createIssue
toil util openapi example github.yaml --operation pulls/get --response 200
```

| Flag | Meaning |
|------|---------|
| `[file]` | The document: a file in the workspace, or `-` (or nothing) for stdin |
| `--text <text>` | The document itself, instead of a file |
| `--tag <tag>` | `list`: only operations with this tag (any case) |
| `--path <text>` | `list`: only operations whose path contains this text. `show` and `example`: the path exactly as the document writes it, with `--method` |
| `--operation <operationId>` | `show`, `example`: the operation, by its operationId |
| `--method <method>` | `show`, `example`: the method, with `--path`, for an operation with no operationId |
| `--depth <n>` | `show`: how many `$ref`s deep to expand schemas (default 3, at most 20) |
| `--response <status>` | `example`: build that response's body (`200`, `201`, `default`) instead of the request body |
| `--content-type <type>` | `example`: which of the body's content types (default: the first JSON one) |

In Git Bash on Windows, leave the leading `/` off `--path`
(`--path repos/{owner}/{repo}/pulls`): the shell rewrites `/repos/...` into a file
path. Both forms match.

- **`list`** returns `{ document, count, operations: [{ method, path, operationId,
  summary, tags, deprecated }] }`.
- **`show`** returns `{ document, operation, parameters, requestBody, responses,
  call, expansion }`. Each parameter has `name`, `in` (path, query, header, cookie),
  `required` and `schema`. The request body and each response have `contentTypes`,
  the `contentType` the `schema` is for (the first JSON one), and `schemaPointer`.
  Swagger 2.0's `body` and `formData` parameters come out as the request body, so
  both versions have one shape.
- **Expanded schemas:** `$ref`s are replaced by what they point at, `--depth` refs
  deep, and an expanded one says where it came from in `x-toil-ref`. One left in
  place says why in `x-toil-stop`: `depth`, `circular` (it loops back), `external`
  (another file or a URL) or `broken`. `expansion.stopped` counts each. In 3.0 and
  Swagger 2.0 a `$ref`'s sibling keys are dropped, as the spec says. From 3.1
  they're kept, over the target's keys.
- **`example`** returns `{ document, operation, body, status, contentType,
  schemaPointer, example }`. The example is the smallest body the schema accepts:
  required properties only (read-only ones left out of a request, write-only ones
  out of a response), the first enum value, the lowest number in range, a string in
  the right format with placeholder values (`you@example.com`, `api.imagile.dev`),
  the first branch of a `oneOf`. It's minimal, not complete: Jira's `createIssue`
  gives `{}`, because its schema requires nothing. Use `show` to see the fields you
  want to add.

#### Calling the endpoint with `<area> api`

`show`'s `call` is the operation as `<area> api` takes it: `method`, `path` (the
server's base path plus the operation's, with `{name}` for each of
`pathParameters`), `query` (each required query parameter as `name=<name>`),
`bodyFile`, `contentType` (set only when it isn't `application/json`), whether it
`writes`, and the CLI line. Over MCP the same fields are `<area>_api`'s inputs.

```bash
toil util openapi show jira-platform.json --operation editIssue --select call
# { "method": "PUT", "path": "/rest/api/2/issue/{issueIdOrKey}", "bodyFile": "body.json", "writes": true,
#   "cli": "toil <area> api PUT /rest/api/2/issue/{issueIdOrKey} --body-file body.json --allow-write", ... }
toil util openapi example jira-platform.json --operation editIssue --select example
toil jira api PUT /rest/api/2/issue/ABC-123 --body-file body.json --allow-write
```

Save the example as `body.json`, fill in the placeholders, and put the area the
document describes for `<area>`. The path is relative to the connection's
`baseUrl`: when `baseUrl` already ends with the server's base path (`/2.0` for
Bitbucket Cloud's), leave that part off. `call.unsupported` lists required header and
cookie parameters, which `<area> api` doesn't send. `call` is null for a method it
doesn't send (OPTIONS, TRACE, QUERY).

#### What every command checks

Each one reads the whole document and checks it before answering, and
`data.verified` says what it checked:

| Check | What it is | Warning when it fails |
|-------|------------|-----------------------|
| `document.schema` | The document against the official schema for its version (Swagger 2.0, OpenAPI 3.0, 3.1 or 3.2), bundled. Every problem is in `document.problems` by JSON pointer (`/paths/~1pets/get/responses`), at most 50, with `problemCount` | `OPENAPI_INVALID` |
| `refs.resolve` | Every local `$ref` points at something. Broken ones are in `document.refs.broken` as `{ at, ref }`, `at` being where the `$ref` sits | `OPENAPI_REF_BROKEN` |
| `operations.uniqueIds` | No operationId is used twice | `OPENAPI_DUPLICATE_OPERATION_ID` |
| `operations.pathParameters` | Every `{name}` in a path is declared as a path parameter | `OPENAPI_PATH_PARAMETER_MISSING` |
| `example.valid` | `example` only: the generated body validates against its own schema, `$ref`s and all, before it's returned | `OPENAPI_EXAMPLE_INVALID` |
| `input.complete` | The whole file was read | `INPUT_INCOMPLETE` |

An invalid document is still listed and shown, since real vendor documents aren't
always valid, but `verified.passed` is false. `document.refs.circular` lists each
loop of references (a recursive schema), which is legal; nothing follows one
forever. What can't be checked is reported, never assumed:

- A `$ref` to another file or a URL isn't followed (`refs.external`, `UNVERIFIED`),
  and an example whose schema reaches one isn't validated.
- The 3.1 and 3.2 schemas leave Schema Objects to the JSON Schema 2020-12 dialect,
  which isn't checked (`document.schemaObjects`, `UNVERIFIED`). Swagger 2.0 and 3.0
  documents are checked all the way down.
- Some schemas have no value that satisfies them (two `allOf` branches that
  disagree, a property required and forbidden at once). The example is returned
  anyway, with `example.valid` failed at the pointer that doesn't fit, so you fill
  that value in by hand.

A document that isn't an object, has no `openapi` or `swagger` field, declares a
version these commands don't read (OpenAPI 4, Swagger 1.2), or isn't valid JSON or
YAML fails with `INVALID_INPUT`. So does an operation that isn't there (the fix names
close operationIds), `example` on an operation with no request body (pass
`--response`), and a status or content type the operation doesn't list.
