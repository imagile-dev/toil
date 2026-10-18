---
area: util
description: Local utilities with no connection or network, decoding a JWT, inventorying dependencies from manifests and lockfiles, and triaging a large log
---

# Local utilities (`util`)

Commands that work on what's on this machine: a token you paste, the
manifests and lockfiles in the workspace, or a log file. They aren't integrations. There is no
server, no connection to add, no `TOIL_UTIL_*` variable, no credential and no
`--connection` flag, and none of them sends anything over the network. Every
command reads; none changes anything. Verification level: `unit`.

The older commands have two paths that do the same thing, with the same flags
and output. The `util` path is the main one, and the short path is an alias:

| Command | Alias | MCP tool |
|---------|-------|----------|
| `toil util jwt decode` | `toil jwt decode` | `util_jwt_decode` |
| `toil util deps scan` | `toil deps scan` | `util_deps_scan` |
| `toil util deps diff` | `toil deps diff` | `util_deps_diff` |
| `toil util log` | none | `util_log` |

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

### `toil util log`

Triages a large log (a CI console, a Maven, npm or dotnet build, a test run) into
what's worth reading: its error and warning lines grouped by signature, each with the
stack trace that follows it. It reads the file only, streams it, and holds memory
constant however large the log is.

```bash
toil util log build.log
toil util log console.log --level error --context 3
toil util log console.log --since 2026-10-14T09:12:00Z --grep 'Failed to execute'
some-build 2>&1 | toil util log -
```

| Argument or flag | Meaning |
|------------------|---------|
| `[file]` | The log, inside the workspace. `-`, or no file and no `--text`, reads stdin |
| `--text <text>` | The log itself, instead of a file |
| `--since <timestamp>` | Only lines dated at or after this ISO 8601 time (`2026-10-14`, `2026-10-14T09:12:00Z`, `"2026-10-14 09:12:00"`). A line with no date takes the date of the last dated line before it. Without a zone, a time is read as UTC |
| `--level <level>` | `warning` (default) reports errors and warnings; `error` reports errors only |
| `--grep <regex>` | Only error and warning lines matching this JavaScript regular expression (case-sensitive, no slashes or flags). An error also matches when the exception line heading its trace does (`--grep IllegalStateException`). Frames aren't searched; `LOG_GREP_STACK_ONLY` says when only they matched |
| `--max-groups <n>` | The most groups to return, default 50, up to 1000 |
| `--context <n>` | Lines to show before and after each group's sample, default 0, up to 20 |

Over MCP the tool is `util_log`, with `file` (a path in the workspace) or `text`, and
the same fields: `since`, `level`, `grep`, `maxGroups`, `context`.

How it reads a log:

- **Timestamps:** a leading timestamp, bracketed (Jenkins' timestamper) or bare (CI
  runners, log4j, Serilog), is set aside before anything else, so it never splits a
  group.
- **Levels:** the first level word decides (`ERROR`, `FATAL`, `SEVERE`, `WARN`,
  `WARNING`, `INFO`, `DEBUG` …, and npm's `npm error` / `npm warn`). A line tagged
  `INFO`, or with no tag, is still an error by its shape: `BUILD FAILURE`, `FAILED`,
  `error CS0246:`, `error TS2322:`, `TypeError: …`, `Unhandled exception.`, an eslint
  or vstest failure line. A tag with nothing after it (`[ERROR] `) is not a group.
- **Signatures:** dates and times, UUIDs, hex and every number are replaced, and
  spaces collapsed. Codes such as `CS0246` and `TS2322` keep their digits, and paths
  and quoted names stay, so two different errors stay apart.
- **Stack traces:** Java (`at …(File.java:12)`, `Caused by:`, `... 14 more`), .NET
  (`at … in file:line 9`, `--->`, `--- End of inner exception stack trace ---`), Node
  (`at fn (file:12:3)`) and Python (`Traceback (most recent call last):`, printed
  before its exception) are joined to the error they belong to, with the exception
  line that heads one. An exception line joins an error, never a warning: after a
  warning it's an error of its own. A trace is reported for each group's first occurrence, up to
  50 lines.

Output:

```json
{
  "lines": { "total": 76, "error": 20, "warning": 5, "other": 35, "stack": 12, "unclassified": 4 },
  "matched": 25, "filtered": 0, "groupsTotal": 18, "truncated": false, "ungrouped": 0, "unjoinedFrames": 0,
  "groups": [{
    "level": "error",
    "signature": "[ERROR] /build/ledger/Reconciler.java:[<n>] cannot find symbol",
    "count": 4, "firstLine": 27, "lastLine": 52,
    "sample": "[ERROR] /build/ledger/Reconciler.java:[54,38] cannot find symbol",
    "trace": { "kind": "java", "firstLine": 57, "lastLine": 68, "frames": 12, "lines": ["…"] },
    "context": { "before": [{ "line": 26, "text": "…" }], "after": [{ "line": 28, "text": "…" }] }
  }],
  "verified": { "passed": true, "checks": [{ "check": "lines.reread", "status": "passed", "checked": 36, "failed": 0 }] }
}
```

Groups are errors first, then warnings, each in order of first appearance. `lines`
classes every line once: `other` is a level below warning, `stack` a trace line, and
`unclassified` a line with no level at all. `filtered` counts the error and warning
lines `--since`, `--level` or `--grep` left out.

It checks its own answer, in `data.verified`:

- **`lines.reread`:** every group's first line is read again from the file and must
  be its sample, and its last line must still have its signature. `trace.reread`
  does the same for every trace line shown. A mismatch is `LOG_LINE_MISMATCH`, which
  usually means the file changed while it was read.
- **`groups.sum`, `lines.sum`, `filter.sum`:** the group counts add up to the matched
  lines, the line classes to the lines read, and matched plus filtered to the error
  and warning lines. A mismatch is `LOG_COUNT_MISMATCH`.
- **`input.complete`:** the bytes read equal the file's size. It's `unchecked` for
  stdin and text.

What it reports in `meta.warnings` rather than leave out: `LOG_UNCLASSIFIED` (lines
with no level, in no group), `LOG_GROUPS_TRUNCATED` (more groups than
`--max-groups`), `LOG_UNGROUPED` (matched lines whose signature came after the first
2,000 distinct ones, counted but not grouped, which is what keeps memory constant),
`LOG_TRACE_UNJOINED` (trace lines with no error before them), `LOG_GREP_STACK_ONLY`
(`--grep` matched only stack trace lines), `LOG_SINCE_UNDATED`
(lines `--since` couldn't date, kept), and `APPROXIMATED` for a line longer than
4,096 characters (grouped by its start) or a `--since` compared with times that had
no zone.

A file streams with no size limit. stdin and `--text` are held in memory, up to
64 MiB, so pass a file for anything bigger.
