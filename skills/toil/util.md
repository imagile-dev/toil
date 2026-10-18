---
area: util
description: Local utilities with no connection or network, decoding a JWT, inventorying dependencies from manifests and lockfiles, checked encoding and hashing, decoding certificates and checking a chain, summarising test, SARIF and coverage reports, triaging a large log, scanning for secrets before a commit or post, and converting Markdown to and from Jira and Confluence formats
---

# Local utilities (`util`)

Commands that work on what's on this machine: a token you paste, a file in the
workspace (a certificate, a log or a document to convert, say), the manifests and lockfiles there, a
report a build left behind, or text you're about to commit or post. They aren't
integrations. There is no server, no connection to add, no `TOIL_UTIL_*`
variable, no credential and no `--connection` flag, and none of them sends
anything over the network. None changes anything: the only file one writes is a
new one you name with `--out`, inside the workspace, and it never replaces a
file. Verification level: `unit`.

`jwt` and `deps` also have a short path, an alias that does the same thing with
the same flags and output:

| Command | Alias | MCP tool |
|---------|-------|----------|
| `toil util jwt decode` | `toil jwt decode` | `util_jwt_decode` |
| `toil util deps scan` | `toil deps scan` | `util_deps_scan` |
| `toil util deps diff` | `toil deps diff` | `util_deps_diff` |
| `toil util secrets scan` | | `util_secrets_scan` |
| `toil util encode` | | `util_encode` |
| `toil util cert` | | `util_cert` |
| `toil util report` | | `util_report` |
| `toil util log` | | `util_log` |
| `toil util md` | | `util_md` |

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

### `toil util secrets scan`

Finds credential-shaped strings before an agent or a person commits, pushes,
comments or posts them. It reads a file, a folder, stdin, text, or the
repository's staged or working-tree diff, and talks to nothing.

```bash
toil util secrets scan --diff staged          # before git commit
toil util secrets scan src/                   # a folder, .gitignore respected
toil util secrets scan notes.md
gh pr view 12 --json body -q .body | toil util secrets scan -
toil util secrets scan --text "$COMMENT"
```

| Argument / flag | Meaning |
|-----------------|---------|
| `[path]` | A file or folder inside the workspace. A folder is walked as `git ls-files --cached --others --exclude-standard` would list it. `-`, or nothing at all, reads stdin |
| `--text <text>` | The content itself, instead of a file |
| `--diff <kind>` | `staged` scans what the next commit holds (`git diff --staged`); `working` scans unstaged changes (`git diff`). Added lines only, in the workspace only. Runs the git on PATH |
| `--allow-file <file>` | The allow file (default: `.toil/secrets-allow` at the workspace's top, when it exists) |

Pass one of a path, `--text` or `--diff`; two at once is `INVALID_INPUT`. Over
MCP, pass `file`, `text` or `diff`.

**The exit code is 1 when anything is found**, and 0 when nothing is, so a hook
or a pipeline can gate on it. The envelope stays `ok: true` either way; `ok:
false` (also exit 1) means the scan itself failed.

**What it looks for:**

- The rules the audit log redacts with, so toil has one definition of a
  secret: GitHub, GitLab, Slack, AWS, SonarQube, `sk-` and Atlassian tokens,
  JWTs, private keys, credentials in URLs, `Bearer` / `Basic` / `Token`
  values, `name=value` pairs whose name says secret (`password=`,
  `"apiToken":`, `--token=`), `curl -u user:pass`, and long random runs of
  letters and digits.
- `high-entropy`: a run of 20 or more base64 or base64url characters, holding
  letters and digits, that those rules didn't catch and whose Shannon entropy
  is at least 4.2 bits per character.

Two things are set aside and counted instead of reported: Subresource Integrity
checksums (`sha512-…` in lockfiles, counted in `summary.checksums`), and a named
value that is a reference to a secret rather than one (`token: ${{ secrets.X }}`,
`password=$DB_PASSWORD`, `<your-token>`, `xxx`, counted in
`summary.placeholders`). Commits, digests and UUIDs aren't findings.

Output:

```json
{
  "source": { "kind": "staged", "path": null },
  "findings": [{ "file": "config/application.properties", "line": 4, "column": 28, "length": 14, "rule": "name-value", "confidence": "high", "entropy": 3.18, "preview": "…", "fingerprint": "e594506f-49ad270a-55b41205-70d9b059" }],
  "allowed": [],
  "unreadable": [{ "file": "logo.png", "reason": "binary", "message": "logo.png is binary in the diff; its content wasn't scanned." }],
  "allowList": null,
  "summary": { "files": 1, "lines": 5, "findings": 1, "allowed": 0, "unreadable": 1, "checksums": 0, "placeholders": 0, "byRule": { "name-value": 1 } },
  "verified": { "passed": true, "checks": [] }
}
```

- `file` is relative to the workspace, with forward slashes, or `null` for
  stdin and text. `line` and `column` start at 1; columns count UTF-16 code
  units. A private key spanning lines is one finding, with `endLine`.
- `source.kind` is `file`, `folder`, `stdin`, `text`, `staged` or `working`.
- `confidence` is `high` for a vendor's token format, `high` or `medium` for a
  value a name or scheme marks as secret (medium when it's short and plain),
  and graded by entropy for a random run (`low` below 3.5 bits per character).
- **The full secret is never in the output**, nor in a warning, an error or the
  audit log, which keeps no copy of `text`. `preview` keeps at most 4
  characters at each end of a secret of 24 or more, 2 of one of 16 to 23, and
  none of a shorter one: `ghp_…c9vB`, `…`.
- `fingerprint` identifies the value without revealing it: a salted scrypt,
  four groups of 8 hex digits. It's slow on purpose, so a short password can't
  be recovered from it by guessing at speed.

**The allow file** lists known false positives, one fingerprint per line, copied
from a finding. `#` starts a comment. It's matched by fingerprint only, never by
the raw value, so it's safe to check in. A finding it names goes in `allowed`
instead of `findings` and doesn't set the exit code. `allowList` says which file
was read, how many entries it had, how many lines weren't fingerprints, and how
many entries matched nothing. A line that isn't a fingerprint is ignored with a
`SECRETS_ALLOW_INVALID` warning that gives its line number and never its text. A
named `--allow-file` that doesn't exist is `INVALID_INPUT`.

```text
# .toil/secrets-allow
e594506f-49ad270a-55b41205-70d9b059  # the test fixture's dummy password
```

**What it checks of its own result** (`verified`):

- `finding.reread`: every finding is read again at its reported line, from the
  file on disk, from the index (`git show :<path>`) for a staged diff, or from
  what stdin or the text held. The same characters must be at the same column,
  with the same rule finding them. A mismatch warns `SECRETS_REREAD_MISMATCH`.
- `preview.masked`: every preview is checked to hold none of the secret's
  middle. One that fails warns `SECRETS_PREVIEW_LEAK` and is replaced by `…`.
- `input.complete`: each file was read to its size on disk. For a diff this is
  `unchecked`, with an `UNVERIFIED` warning, since git's output has no size to
  compare with; the re-read checks each finding instead.

**What it couldn't read is listed**, never skipped silently. `unreadable` holds
each binary file, each file over 64 MiB, each one it couldn't open (a permission
error, say), each nested repository a folder scan didn't walk into, and each line
over 4 MiB, of which only the start was scanned. Any of them adds a
`SECRETS_UNREADABLE` warning. A single file named on the call that can't be read
is an `INVALID_INPUT` error instead. `--diff working` also warns
`SECRETS_UNTRACKED_NOT_SCANNED` with the number of untracked files, which no diff
holds: scan the folder, or stage them, to include them.

**A diff covers the workspace, not the whole repository.** When the workspace is
a folder inside the repository, changes outside it aren't scanned, and a
`SECRETS_DIFF_PARTIAL` warning gives the number of changed files left out. To
check a whole commit, run it with `--workspace` at the repository's top.

Known limits:

- A diff and a file are scanned line by line, so a secret split across two lines
  (other than a private key) isn't found.
- A private key spans lines only when its BEGIN line stands alone and an END
  line follows its body (base64, blank, `Proc-Type:` and `DEK-Info:` lines). It's
  then one finding, with `endLine`. When no END comes (another line, a gap
  between diff hunks, or the end of the file), the BEGIN line is reported on its
  own and the lines below it are scanned as usual.
- A bare `key=` isn't treated as a secret's name, because in toil's inputs it's
  an issue, space or project key. A real key there is still caught by its shape
  or its entropy.

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

### `toil util cert`

Decodes X.509 certificates, one or a chain bundle, in PEM or DER, so you can
explain a TLS failure from the files. It never connects to the host the certificate
is for: pass the file the server is configured with, or the chain a client saved.

```bash
toil util cert chain.pem
toil util cert chain.pem --host api.imagile.dev
toil util cert server.der
cat chain.pem | toil util cert -
```

| Argument or flag | Meaning |
|------------------|---------|
| `[file]` | A file in the workspace, PEM or DER. `-`, or leaving it out, reads stdin |
| `--text <text>` | The PEM itself, instead of a file. Over MCP, `text` is read as UTF-8, so a DER certificate goes as `file` |
| `--host <host>` | A host name or IP address: do the first certificate's SANs cover it? |

Output: `{ format, certificates, skipped, chain, host, verified }`. Each
certificate is `{ position, line, offset, subject, issuer, sans, serial, validity:
{ notBefore, notAfter, daysLeft, status }, key: { type, bits, curve },
signatureAlgorithm: { name, oid }, selfSigned, basicConstraints: { ca, pathLength },
keyUsage, extendedKeyUsage, fingerprints: { sha1, sha256 } }`. `position` counts
every block in a PEM bundle (or element in a DER one) from 1, `line` is where a PEM
block starts and `offset` where a DER certificate does. `status` is `valid`,
`expired` or `not-yet-valid`, and `daysLeft` is negative once expired.
`basicConstraints`, `keyUsage` and `extendedKeyUsage` are null when the certificate
doesn't have that extension.

What it checks, in `data.verified` (a failure also warns under its code):

| Check | Means | Fails with |
|-------|-------|------------|
| `bundle.readable` | Every block meant to be a certificate decodes | `CERT_UNREADABLE` |
| `decode.matchesNode` | toil's DER reader and `node:crypto` agree on the serial and CA flag, and nothing follows the certificate in its block | `CERT_DECODE_MISMATCH` |
| `validity.notExpired`, `validity.started` | Each certificate is inside its validity window now | `CERT_EXPIRED`, `CERT_NOT_YET_VALID` |
| `chain.order` | Each certificate's issuer is the next one's subject | `CERT_CHAIN_ORDER` |
| `chain.signature` | Where the names match, each signature verifies with the next certificate's key, and a self-issued last certificate with its own | `CERT_SIGNATURE_MISMATCH` |
| `chain.root` | Unchecked (`UNVERIFIED`) when the last certificate isn't self-signed, so its issuer doesn't follow it: the chain is checked only as far as the bundle goes | |
| `host.covered` | With `--host`, a DNS or IP SAN of the first certificate covers it | `CERT_HOST_MISMATCH` |
| `input.complete` | The whole file was read (unchecked for stdin) | `INPUT_INCOMPLETE` |

- The chain is checked in the order given, leaf first. When it's out of order but
  is one chain in another order, `chain.suggestedOrder` lists the positions in the
  right order and `CERT_CHAIN_REORDER` says so.
- `chain.inOrder` is true when every link's names match and every signature
  checked verifies. `chain.root` is `included` when the last certificate is
  self-signed. Nothing is checked against a trust store: a chain that verifies to
  a root in the bundle isn't thereby trusted.
- `--host` follows what browsers do: SANs only, never the subject CN, and a
  wildcard covers exactly one label (`*.imagile.dev` covers `api.imagile.dev`, not
  `imagile.dev` or `a.api.imagile.dev`). `host.explanation` says why it's covered
  or not.
- A PEM block that isn't a certificate is skipped, listed in `skipped` and named in
  a `CERT_BLOCK_SKIPPED` warning. A private key is never read, and
  `CERT_PRIVATE_KEY_IN_INPUT` says one was there. `CERTIFICATE` and
  `X509 CERTIFICATE` blocks are read; `TRUSTED CERTIFICATE`, PKCS#7 (`.p7b`) and
  PKCS#12 (`.pfx`) are not.
- In DER input a damaged certificate ends the reading, since nothing says where the
  next one starts; it's reported at its byte offset.
- Input with no certificate that can be read fails with `INVALID_INPUT`, naming
  each block and why.

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
