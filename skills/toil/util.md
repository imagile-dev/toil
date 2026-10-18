---
area: util
description: Local utilities with no connection or network, decoding a JWT, inventorying dependencies from manifests and lockfiles, and converting Markdown to and from Jira and Confluence formats
---

# Local utilities (`util`)

Commands that work on what's on this machine: a token you paste, a document
to convert, or the manifests and lockfiles in the workspace. They aren't integrations. There is no
server, no connection to add, no `TOIL_UTIL_*` variable, no credential and no
`--connection` flag, and none of them sends anything over the network. Every
command reads; none changes anything. Verification level: `unit`.

Most commands have two paths that do the same thing, with the same flags and
output. The `util` path is the main one, and the short path is an alias:

| Command | Alias | MCP tool |
|---------|-------|----------|
| `toil util jwt decode` | `toil jwt decode` | `util_jwt_decode` |
| `toil util deps scan` | `toil deps scan` | `util_deps_scan` |
| `toil util deps diff` | `toil deps diff` | `util_deps_diff` |
| `toil util md` | none | `util_md` |

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

### `toil util md`

Converts a document between Markdown and the rich-text formats the Atlassian
areas send: Jira wiki markup (Jira Data Center), Atlassian Document Format
(Jira Cloud, Confluence Cloud) and Confluence storage format (Confluence Data
Center). One side is always Markdown. Every result is checked by converting it
back, so you're told exactly what didn't survive.

```bash
toil util md description.md --to wiki
toil util md page.md --to storage
toil util md description.md --to adf --select output
toil util md PROJ-142.wiki --from wiki
toil util md description.adf.json --from adf
```

ADF input is the document itself, `{ "type": "doc", "version": 1, "content": [...] }`:
an issue's `fields.description` or a comment's `body`, not the issue around it.

| Argument / flag | Meaning |
|-----------------|---------|
| `[file]` | A file inside the workspace. `-`, or no file and no `--text`, reads stdin |
| `--text <text>` | The document itself, instead of a file |
| `--to <format>` | `wiki`, `adf` or `storage`, to convert Markdown into it |
| `--from <format>` | `wiki`, `adf` or `storage`, to convert it into Markdown |

Over MCP the tool is `util_md`, with `file` or `text` plus `from` or `to`.

Output:

```json
{
  "from": "md",
  "to": "wiki",
  "output": "h2. Steps\n\n# Open the login page\n...",
  "lossless": false,
  "losses": [{ "construct": "task list", "at": "line 12", "detail": "Jira wiki markup has no task lists; each task is written as [ ] or [x] text" }],
  "roundTrip": { "blocks": 9, "differences": [] },
  "verified": { "passed": true, "checks": [{ "check": "roundTrip.blocks", "status": "passed", "checked": 9, "failed": 0 }] }
}
```

- **`output`** is the converted document: an ADF document object for `adf`,
  text for the others. Markdown output is in one canonical spelling (`-` bullets,
  `*emphasis*`, `**strong**`, fenced code, one line per paragraph).
- **`losses`** lists every construct that has no equivalent in the target, with
  its position: `line N` in Markdown, wiki markup and storage format, a JSON
  pointer (`/content/6/content/2`) in ADF. Each kind is also an `MD_LOSSY`
  warning. Words are kept wherever there are words to keep: a panel becomes a
  quote, a mention becomes `@name` text, a merged cell is unmerged with the cells
  it covered left empty.
- **`roundTrip`**: the output is read back and compared with the input, block by
  block, as canonical Markdown. `differences` shows each block that changed, and
  whether a loss explains it. A change no loss explains fails the
  `roundTrip.blocks` check and warns `MD_ROUNDTRIP_MISMATCH`: that's a bug in the
  converter, so check the output before you send it.
- **`lossless`** is true only when nothing was lost and every block came back the same.
- **ADF output is validated against the ADF JSON schema** (Atlassian's
  `@atlaskit/adf-schema`, bundled) before it's returned, and storage output is
  read back as XML. Output that fails either is never returned; the command fails
  instead. ADF input the schema refuses is converted as far as it reads, with an
  `ADF_INPUT_INVALID` warning.

What Markdown means here: CommonMark plus GFM tables, task lists, strikethrough
and bare-URL links. Raw HTML (other than `<br>`), link reference definitions and
footnotes aren't read; they're kept as text and reported as losses.

Known losses, by format:

- **Wiki markup:** no task lists (written as `[ ]` / `[x]` text), no table
  alignment, no link or image titles, lists always start at 1, and a list item is
  one line, so a code block or second paragraph in one is joined with line breaks.
  Underline, colour, sub/superscript, citations, panels, mentions, attachments and
  other macros don't come back into Markdown. Text such as `(y)` that Jira shows as
  an emoticon, and a URL written as text, which Jira links, are reported too.
- **ADF:** a quote can't hold a heading, table, task list or another quote, and a
  list item can't hold a heading, quote or table, so those are brought down and
  reported. Inline images become links; explicit left alignment is the default.
  Panels, expands, mentions, emoji, dates, statuses, smart links, decisions,
  attachments, layouts, extensions and merged cells don't come back.
- **Storage format:** a list mixing tasks and ordinary items becomes a task list.
  Info, note, tip and warning panels, expand, layouts, page and user links,
  attachments, emoticons, colour, merged cells and other macros don't come back.
  Only XML's entities and HTML's common named ones (`&nbsp;`, `&mdash;` and so on)
  are read; any other is refused with `INVALID_INPUT`, as is XML that isn't
  well-formed, with its line and column.

To send the result, pass it to the area's own command: wiki markup as
`toil jira create-issue --description`, storage format as
`toil confluence create-page --body` (or `confluence-cloud`), and ADF as
`fields.description` in a `toil jira-cloud create-issue --input-file`. How each product's own renderer displays it hasn't
been checked against a live instance.
