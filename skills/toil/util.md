---
area: util
description: Local utilities with no connection or network, decoding a JWT, inventorying dependencies from manifests and lockfiles, and sizing files and folders before reading them
---

# Local utilities (`util`)

Commands that work on what's on this machine: a token you paste, the
manifests and lockfiles in the workspace, or any file or folder in it. They aren't integrations. There is no
server, no connection to add, no `TOIL_UTIL_*` variable, no credential and no
`--connection` flag, and none of them sends anything over the network. Every
command reads; none changes anything. Verification level: `unit`.

The older commands have two paths that do the same thing, with the same flags
and output. The `util` path is the main one, and the short path is an alias.
Newer commands have the `util` path only:

| Command | Alias | MCP tool |
|---------|-------|----------|
| `toil util jwt decode` | `toil jwt decode` | `util_jwt_decode` |
| `toil util deps scan` | `toil deps scan` | `util_deps_scan` |
| `toil util deps diff` | `toil deps diff` | `util_deps_diff` |
| `toil util size` | (none) | `util_size` |

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

### `toil util size`

How big a file or folder is before you read it, so an agent can budget its
context: bytes, lines and an estimated token count, and for one file an outline
with line ranges, so you can read just the part you need.

```bash
toil util size src/areas/util/size.ts
toil util size src --depth 2 --top 5
git show HEAD:README.md | toil util size - --language markdown
```

| Argument / flag | Meaning |
|-----------------|---------|
| `[file]` | A file or folder inside the workspace. `-` (or nothing) reads stdin |
| `--text <text>` | The content itself, instead of a file |
| `--language <language>` | Outline it as this language: `typescript`, `javascript`, `python`, `csharp`, `java`, `go`, `markdown`, `json` or `yaml`. Needed for stdin and `--text`; for a file it overrides the extension |
| `--top <n>` | For a folder: how many of the largest files to list (default 10) |
| `--depth <n>` | For a folder: how many levels of subfolders the tree shows (default 3). Deeper folders still count in their parent's totals, and `foldersHidden` says how many were left out |

**Tokens are an estimate**: `ceil(characters / 4)` per file, counting Unicode code
points. No model's tokenizer is bundled, and real counts vary by model and
content. Every result says so in `tokenMethod` and with an `APPROXIMATED` warning.

**For a file**: `{ kind: "file", path, language, bytes, lines, tokens, tokenMethod,
outline, notOutlined, verified }`. `outline` is `{ precision, method, symbols }`,
each symbol `{ name, kind, startLine, endLine, container }` (headings add `level`):

- **Code** (`precision: "syntactic"`): TypeScript and JavaScript (`.ts`, `.tsx`,
  `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`), Python, C#, Java and Go. Functions,
  classes, interfaces, types, enums, namespaces, methods, constructors, C#
  properties and exported names. It's a pure-JavaScript scan that skips comments
  and strings and matches braces (indentation for Python), not a compiler, so
  `method` says what each language covers. Function bodies aren't searched, and
  fields aren't listed. `container` is the enclosing class or namespace.
- **Markdown**: ATX and setext headings, outside code fences and front matter.
- **JSON and YAML** (`precision: "parsed"`): the top-level keys, found by scanning
  and held against what the parser returns.

When there's no outline, `outline` is null and `notOutlined` says why: `binary` (a
NUL byte in the first 8,000 bytes; lines and tokens are null too),
`unsupported-language`, `parse-error` (with the line, never the text; also a
`SIZE_PARSE_ERROR` warning) or `too-large` (over 8 MiB; it's still counted).

**For a folder**: `{ kind: "folder", path, tokenMethod, totals, tree, largest,
skipped, verified }`. It lists files the way `deps scan` does, skipping what
`.gitignore` ignores. `totals` and every `tree` node hold `files`, `bytes`, `lines`,
`tokens` and `binaryFiles`; binary files count in files and bytes only. Folders are
sorted largest first. `largest` names the biggest files with their language.
`skipped` lists what wasn't counted, with the reason: `unreadable` (with a
`SIZE_FILES_SKIPPED` warning), `not-a-file` or `nested-repository`.

**What it checks**, in `data.verified`:

- `outline.start`: each symbol's start line, re-read from the input, names it.
- `outline.range` and `outline.nesting`: each range is inside the file and in
  order, and a member sits inside its container.
- `outline.keys`: JSON and YAML keys match the parser's.
- `counts.reread`: the outline's full read gives the same bytes and lines.
- `totals.sum` and `tree.sum`: the totals equal the files added up, and each
  folder equals its own files plus its subfolders.
- `input.complete`: every file was read to its size on disk.

A failed check sets `verified.passed` to false and warns `SIZE_OUTLINE_MISMATCH`,
`SIZE_TOTALS_MISMATCH` or `SIZE_COUNTS_MISMATCH`.
