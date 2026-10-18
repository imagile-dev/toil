---
area: util
description: Local utilities with no connection or network, decoding a JWT, inventorying dependencies from manifests and lockfiles, and decoding certificates and checking a chain
---

# Local utilities (`util`)

Commands that work on what's on this machine: a token you paste, the
manifests and lockfiles in the workspace, or a certificate file. They aren't integrations. There is no
server, no connection to add, no `TOIL_UTIL_*` variable, no credential and no
`--connection` flag, and none of them sends anything over the network. Every
command reads; none changes anything. Verification level: `unit`.

The first three commands have two paths that do the same thing, with the same
flags and output. The `util` path is the main one, and the short path is an alias:

| Command | Alias | MCP tool |
|---------|-------|----------|
| `toil util jwt decode` | `toil jwt decode` | `util_jwt_decode` |
| `toil util deps scan` | `toil deps scan` | `util_deps_scan` |
| `toil util deps diff` | `toil deps diff` | `util_deps_diff` |
| `toil util cert` | none | `util_cert` |

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
