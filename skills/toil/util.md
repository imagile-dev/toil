---
area: util
description: Local utilities with no connection or network, decoding a JWT, inventorying dependencies from manifests and lockfiles, checked encoding and hashing, decoding certificates and checking a chain, and comparing versions and ranges for npm, NuGet and Maven
---

# Local utilities (`util`)

Commands that work on what's on this machine: a token or version you paste, a file in the
workspace (a certificate, say), or the manifests and lockfiles there. They
aren't integrations. There is no server, no connection to add, no `TOIL_UTIL_*`
variable, no credential and no `--connection` flag, and none of them sends
anything over the network. None
changes anything: the only file one writes is a new one you name with `--out`,
inside the workspace, and it never replaces a file. Verification level: `unit`.

`jwt` and `deps` also have a short path, an alias that does the same thing with
the same flags and output:

| Command | Alias | MCP tool |
|---------|-------|----------|
| `toil util jwt decode` | `toil jwt decode` | `util_jwt_decode` |
| `toil util deps scan` | `toil deps scan` | `util_deps_scan` |
| `toil util deps diff` | `toil deps diff` | `util_deps_diff` |
| `toil util encode` | none | `util_encode` |
| `toil util cert` | none | `util_cert` |
| `toil util semver compare` | none | `util_semver_compare` |
| `toil util semver satisfies` | none | `util_semver_satisfies` |
| `toil util semver sort` | none | `util_semver_sort` |
| `toil util semver bump` | none | `util_semver_bump` |

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

### `toil util semver`

Versions and ranges in the grammar of the ecosystem they come from. Pick it with
`--ecosystem`: `npm` (the default), `nuget` or `maven`.

- **npm:** SemVer 2.0.0 versions (`1.2.3`, `1.2.3-rc.1+build.5`; a leading `v` is
  allowed) and npm's ranges, as `package.json` takes them: `^1.2.3`, `~1.2`, `1.x`, `>=1.0.0 <2.0.0`,
  `1.0.0 - 2.0.0`, joined with `||`. A prerelease satisfies a range only when the
  range names a prerelease of the same `major.minor.patch`, unless you pass
  `--include-prerelease`. There's no loose mode that turns text that isn't a
  version into one.
- **nuget:** one to four numbers (`1`, `1.0` and `1.0.0.0` are one version), then
  an optional `-prerelease` and `+metadata`. Labels compare case-insensitively.
  Ranges are interval notation: `1.0` (at least 1.0), `[1.0]`, `[1.0,2.0)`,
  `(,2.0]`. A prerelease inside the bounds satisfies the range. Floating versions
  (`1.*`, `1.0.0-*`) are refused, because what one picks depends on the feed.
- **maven:** Maven's own ordering: `alpha < beta < milestone < rc < snapshot <
  release < sp`, `1`, `1.0` and `1.0.0.Final` are one version, and `1a1` is
  `1-alpha-1`. A version is letters, digits, `.`, `-`, `_` and `+` with at least
  one digit, so an unresolved `${property}` is reported, not ordered. Ranges are
  `[1.0,2.0)`, `[1.0]` and `(,1.0],[1.2,)`. A bare version is a soft requirement
  that any version satisfies, and says so in a `MAVEN_SOFT_REQUIREMENT` warning.

A version or range that doesn't parse in the chosen grammar is `INVALID_INPUT`,
with the reason and an example of what fits. Build metadata never affects order.

```bash
toil util semver compare 1.0.0-rc.10 1.0.0-rc.9
toil util semver satisfies 1.3.0-rc.1 '^1.2.0' --include-prerelease
toil util semver satisfies 5.3.39 '[5.0,6.0)' --ecosystem maven
toil util semver sort versions.txt --range '^5.0.0'
toil util semver bump 1.2.3 prerelease --preid rc
```

| Command | Arguments and flags | Output |
|---------|---------------------|--------|
| `compare <a> <b>` | `--ecosystem <ecosystem>` | `{ ecosystem, a, b, order, higher, difference, normalized: { a, b }, verified }`. `order` is -1, 0 or 1 for a against b, `higher` is `a`, `b` or null, and `difference` is the most significant part they differ in: `major`, `minor`, `patch`, `revision` (NuGet's fourth part, or Maven's), `prerelease`, `qualifier` (Maven) or null |
| `satisfies <version> <range>` | `--ecosystem <ecosystem>`, `--include-prerelease` | `{ ecosystem, version, range, normalizedRange, satisfies, verified }` |
| `sort [file]` | `--text <text>`, `--ecosystem <ecosystem>`, `--range <range>`, `--include-prerelease` | `{ ecosystem, count, sorted, invalid, verified }`, lowest first, plus `{ range, normalizedRange, satisfying, highest }` with `--range` |
| `bump <version> <release>` | `--ecosystem <ecosystem>`, `--preid <id>` | `{ ecosystem, version, release, preid, result, verified }` |

- **`sort`** reads a file in the workspace, stdin (`-`, or no file), or `--text`.
  Versions go one per line or separated by spaces. An entry that doesn't parse is
  left out of the sort and listed in `invalid` with its line and the reason, with a
  `SEMVER_INVALID_VERSION` warning.
- **`bump`** takes `major`, `minor` or `patch` in every ecosystem. npm also takes
  `premajor`, `preminor`, `prepatch`, `prerelease` and `release`, the bumps npm
  publishes with, and `--preid` names the prerelease (`1.2.3` `prerelease --preid rc` is
  `1.2.4-rc.0`). A NuGet result has three parts, with the revision and labels
  dropped. Maven bumps the leading numbers and drops the qualifier
  (`1.2.3-SNAPSHOT` `minor` is `1.3.0`).

**What it checks** (`verified`, with failures as warnings):

- `sort.transitive`: every pair in the sorted list is in order, so a comparison
  where a < b and b < c but not a < c can't hide. Up to 2,000 versions; past that,
  each against its neighbour, reported as `APPROXIMATED`.
- `sort.antisymmetric`, `sort.complete`: each neighbouring pair compares the same
  both ways round, and every entry is either sorted or listed as invalid.
- `range.boundaries`, `range.answers`: each answer agrees with the range's
  intervals, worked out by comparison alone, at the range's boundary versions and
  at every version asked about. A range with no bounds (`*`) has none to test, and
  says so with `UNVERIFIED`.
- `compare.antisymmetric`, `diff.consistent`, `bump.increases`,
  `version.normalized`: b against a is the reverse of a against b, a difference is
  named exactly when the versions differ, a bump goes up, and a normalised version
  reads back as the same version.
- `input.complete`: the whole file was read. stdin has no size to compare with, so
  it's `UNVERIFIED`.

`diff` names the most significant part that changed, the same rule in every
ecosystem; it never answers `premajor` or the like.
