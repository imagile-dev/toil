---
area: util
description: Local utilities with no connection or network, decoding a JWT, inventorying dependencies from manifests and lockfiles, checked encoding and hashing, and summarising test, SARIF and coverage reports
---

# Local utilities (`util`)

Commands that work on what's on this machine: a token you paste, a file in the
workspace, the manifests and lockfiles there, or a report a build left behind.
They aren't integrations. There is no server, no connection to add, no
`TOIL_UTIL_*` variable, no credential and no `--connection` flag, and none of them
sends anything over the network. None changes anything: the only file one writes
is a new one you name with `--out`, inside the workspace, and it never replaces a
file. Verification level: `unit`.

`jwt` and `deps` also have a short path, an alias that does the same thing with
the same flags and output:

| Command | Alias | MCP tool |
|---------|-------|----------|
| `toil util jwt decode` | `toil jwt decode` | `util_jwt_decode` |
| `toil util deps scan` | `toil deps scan` | `util_deps_scan` |
| `toil util deps diff` | `toil deps diff` | `util_deps_diff` |
| `toil util encode` | | `util_encode` |
| `toil util report` | | `util_report` |

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

### `toil util encode`

Encodes or decodes base64, base64url, hex and URL percent-encoding, and hashes a
file with SHA-256, SHA-1 or MD5. Each result is checked before it's returned, and
`data.verified` says how.

```bash
toil util encode base64 --text 'you@example.com:abc12345'
toil util encode base64 --decode mail-part.b64 --out logo.png
toil util encode url --text 'project = PAY AND assignee = "you@example.com"'
toil util encode form --decode --text 'project+%3D+PAY+AND+assignee+%3D+%22you%40example.com%22'
printf 'hello' | toil util encode hex
toil util encode sha256 release.tgz
```

| Argument or flag | Meaning |
|------------------|---------|
| `<scheme>` | `base64`, `base64url`, `hex`, `url`, `form`, or a hash: `sha256`, `sha1`, `md5`. Required |
| `[file]` | A file inside the workspace. `-`, or leaving out both the file and `--text`, reads stdin |
| `--text <text>` | The content itself, instead of a file. It's encoded as UTF-8 |
| `--decode` | Decode instead of encode. Not for a hash |
| `--out <file>` | Write the result to this new file inside the workspace instead of returning it. Never replaces a file. Not for a hash |

The schemes:

- **`base64`** is written padded. Decoding accepts it with or without padding, and
  ignores spaces and line breaks, so MIME-wrapped base64 reads as it is.
- **`base64url`** (`-` and `_`) is written without padding, as JWTs use it, and
  read with or without.
- **`hex`** is written in lower case and read in either. Spaces and line breaks are
  ignored; a `0x` prefix or `:` separators are not.
- **`url`** is a URL component, written as JavaScript's `encodeURIComponent` writes
  it: letters, digits and `-_.!~*'()` stay, every other byte becomes `%XX`.
- **`form`** is one name or value of an `application/x-www-form-urlencoded` body:
  letters, digits and `*-._` stay, a space becomes `+`, and every other byte becomes
  `%XX`. Decode a body one field at a time. A whole body decodes, but its `=` and
  `&` come back the same as an encoded `%3D` and `%26`, so `roundtrip.encode`
  fails, as it should.

Output:

- **Encode:** `{ operation: "encode", scheme, inputBytes, outputBytes, output, verified }`.
- **Decode:** `{ operation: "decode", scheme, inputBytes, outputBytes, utf8, output, verified }`.
  `utf8` says whether the decoded bytes are valid UTF-8.
- **Hash:** `{ operation: "hash", scheme, inputBytes, hex, base64, verified }`, the
  digest both ways.
- With `--out`, `file` (the absolute path written) replaces `output`.

The input is bytes: a file or stdin is encoded or hashed exactly as it is, so
`echo hello | toil util encode base64` includes the newline `echo` adds. Use
`printf` or `--text` to leave it out. When decoding, one trailing line ending is
dropped.

**Decoded bytes that aren't valid UTF-8 are refused** with `INVALID_INPUT` unless
`--out` names a file to write them to. JSON can only carry them as text, and any
text would be different bytes. Valid UTF-8 comes back as the text it is.

What `data.verified` checks:

| Check | What it means |
|-------|---------------|
| `roundtrip.decode` | An encode was decoded back, and gave exactly the input |
| `roundtrip.encode` | A decode was encoded again, and gave the input, allowing for whitespace, padding, the case of hex and `%XX`, and `%20` for `+` in a form |
| `input.complete` | The bytes read equal the file's size on disk, so a read that stopped short can't pass. Unchecked for stdin, which has no size |
| `output.file` | The file written was read back, and holds exactly the bytes written |

A failed check sets `verified.passed` to `false` and adds a warning:
`ENCODE_ROUNDTRIP_MISMATCH`, `INPUT_INCOMPLETE` or `ENCODE_OUTPUT_MISMATCH`. Input
that decodes but fails `roundtrip.encode` isn't how the scheme writes those bytes.
For example, base64 `QR==` decodes to `A`, but base64 writes `A` as `QQ==`, and a URL
with a space left in it isn't encoded. Check that it wasn't changed on the way.

Errors:

- Text that isn't the scheme is `INVALID_INPUT`, naming the offset of the first
  character that's wrong but never the character, in case the text is a credential.
  A base64 character that only base64url uses (or the other way round) says to try
  the other scheme.
- A file to decode that looks binary (a NUL byte), `--decode` or `--out` with a hash,
  and a scheme toil doesn't have are `INVALID_INPUT`.
- Encoding or decoding reads at most 64 MiB. A hash of a file streams, with no
  limit; stdin is held in memory, so it keeps the 64 MiB limit.

MD5 and SHA-1 are here to match checksums that other tools publish, not to protect
anything. The audit log keeps only a hash of `--text`.

### `toil util report`

One JSON summary of a report that CI or a scanner wrote: JUnit XML, TRX, SARIF
2.1.0, lcov or Cobertura. It reads the file and nothing else, and checks the report
against its own declared totals.

```bash
toil util report target/surefire-reports/TEST-dev.imagile.OrderTest.xml
toil util report TestResults/build.trx
toil util report coverage/lcov.info --lowest 5
toil util report results.sarif
cat coverage.xml | toil util report --format cobertura
```

| Argument / flag | Meaning |
|-----------------|---------|
| `[file]` | The report, inside the workspace. `-`, or no file and no `--text`, reads stdin |
| `--text <text>` | The report itself, instead of a file |
| `--format <format>` | `junit`, `trx`, `sarif`, `lcov` or `cobertura`. Left out, it's detected from the content: the root element for XML (`<testsuites>` or `<testsuite>`, `<TestRun>`, `<coverage>`), `"runs"` for SARIF, a first `TN:` or `SF:` line for lcov |
| `--lowest <n>` | How many of the lowest-covered files to list (default 10, up to 1000) |

Over MCP the tool is `util_report`, with `file` or `text`, `format` and `lowest`.

Output: `{ format, formatFrom, tests, findings, coverage, skipped, verified }`.
`formatFrom` is `content` or `flag`. One of `tests`, `findings` and `coverage` is
filled in, by format, and the other two are `null`.

- **`tests`** (JUnit, TRX): `{ suites, totals: { tests, passed, failures, errors,
  skipped, flaky, other }, failures: [{ suite, name, className, kind, type,
  message, file, line, location, stack, stackLines }] }`. The totals are recounted
  from the cases, never copied from the report. `kind` is `failure` or `error`.
  `stack` is the first 15 lines, and `stackLines` how many there were. `location` is
  `report` when the report states `file` or `line`, and `stack` when they were read
  from the first stack frame naming the test's class or method (an `APPROXIMATED`
  warning says how many). It's `null` when neither has one.
- **`findings`** (SARIF): `{ runs: [{ tool, version, results }], total, byLevel,
  results: [{ tool, rule, level, kind, file, line, message, suppressed }] }`. `level`
  follows the spec: the result's own, else its rule's default, else `warning` for a
  failing result and `none` for any other. `file` is the first location's URI as
  written, and `line` its `startLine`.
- **`coverage`** (lcov, Cobertura): `{ sources, totals: { lines, branches }, files:
  [{ file, lines, branches }], lowest }`. Each figure is `{ covered, total, percent }`,
  with `percent` rounded to two places (`null` when there's nothing to cover).
  `branches` is `null` where the report has no branch data. `lowest` lists the
  `--lowest` files with the lowest line coverage, leaving out files with no lines.
- **`skipped`**: `{ count, elements: [{ element, count, reason }] }`, every element
  (or lcov record) the reader met and didn't read, also warned as
  `REPORT_ELEMENTS_SKIPPED`. Known parts that hold nothing it summarises
  (`system-out`, `properties`, TRX's settings and lists, Cobertura's per-method copies
  of the lines) aren't counted.

What `verified` checks:

| Format | Check | Warning when it fails |
|--------|-------|-----------------------|
| JUnit | Each suite's (and `<testsuites>`') declared `tests`, `failures`, `errors` and `skipped`, recounted from its cases, nested suites included | `REPORT_TOTALS_MISMATCH`, naming both numbers |
| TRX | `<Counters>`' `total` and each outcome counter, recounted from the results' `outcome` | `REPORT_TOTALS_MISMATCH` |
| Cobertura | Every stated `line-rate` and `branch-rate` (class, package and root), to within one unit of its last written decimal, and the root's `lines-covered`, `lines-valid`, `branches-covered` and `branches-valid` | `REPORT_COVERAGE_MISMATCH` |
| lcov | Each record's `LF`, `LH`, `BRF`, `BRH`, `FNF` and `FNH`, recounted from its `DA`, `BRDA`, `FN` and `FNDA` lines | `REPORT_COVERAGE_MISMATCH` |
| SARIF | Each `ruleIndex` points at the rule its `ruleId` names | `REPORT_SARIF_INCONSISTENT` |
| All | The whole input was read (`input.complete`) | `INPUT_INCOMPLETE`, or `INPUT_TRUNCATED` at the cap |

What it can't check is reported as `UNVERIFIED`, never as passed: a JUnit report
that declares no totals, SARIF (which declares none), a TRX counter left at `0` over
results with that outcome (VSTest leaves `notExecuted` at 0, for one), and the size
of stdin. TRX's `executed` isn't compared, because writers disagree on what it
counts.

Formats it reads:

- **JUnit:** Maven Surefire's, the Jenkins shape (nested `<testsuite>`s, `status`,
  `assertions`, `disabled`) and the Azure DevOps shape (the VSTest JUnit logger's).
  Surefire's `flakyFailure` and `flakyError` mean a rerun passed: the case counts as
  passed and in `flaky`. A case with `<error>` is an error, else one with
  `<failure>` is a failure, else one with `<skipped>` is skipped.
- **TRX:** `dotnet test --logger trx` and Visual Studio's. Top-level results are
  counted, as the counters count them, and a data-driven test's inner rows aren't.
  `failures` is `Failed`; `errors` is `Error`, `Timeout` and `Aborted`; `skipped` is
  `NotExecuted` and `NotRunnable`; any other outcome is `other`. `suites` is the
  number of test classes, and a failure's `suite` is its class.
- **SARIF 2.1.0:** any tool's. A rule reference with a `toolComponent` index is
  looked up in that entry of `tool.extensions` (CodeQL query packs); one that names
  its component only by `guid` can't be found, so `sarif.ruleIndex` is `UNVERIFIED`
  and the level falls back to `warning`. A file with another `version` is read as
  2.1.0, with an `APPROXIMATED` warning. A run whose invocation says it failed warns
  `REPORT_TOOL_FAILED`.
- **lcov:** `SF` to `end_of_record` records, including lcov 2's `FNL` and `FNA`.
  `FNH` is recounted as distinct functions hit: `FNA` by index, so a function's
  aliases count once, and `FNDA` by name. A file in several records is merged, and a
  line is covered when any record hit it.
- **Cobertura:** coverlet's, coverage.py's and others'. Classes in the same file are
  added together, and branch counts come from `condition-coverage="50% (1/2)"`.

Limits: XML and lcov stream, so memory stays flat for a report of any size, apart
from the failures it lists, up to the 64 MiB input cap. At the cap the read stops,
`INPUT_TRUNCATED` says so, `input.complete` fails, and what came before the cut is
summarised; a suite the cut left open isn't compared. SARIF is JSON and is read
whole, so a SARIF file over the cap is `INVALID_INPUT`. Malformed XML or JSON is
`INVALID_INPUT` with the line and column. So is a document whose format can't be
detected, or whose root doesn't match `--format`, with a fix naming `--format`.
