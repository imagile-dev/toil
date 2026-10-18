---
area: util
description: Local utilities with no connection or network, decoding a JWT, inventorying dependencies from manifests and lockfiles, and scanning for secrets before a commit or post
---

# Local utilities (`util`)

Commands that work on what's on this machine: a token you paste, the
manifests and lockfiles in the workspace, or text you're about to commit or
post. They aren't integrations. There is no
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
| `toil util secrets scan` | none | `util_secrets_scan` |

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
| `--diff <kind>` | `staged` scans what the next commit holds (`git diff --staged`); `working` scans unstaged changes (`git diff`). Added lines only. Runs the git on PATH |
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

Known limits:

- A diff and a file are scanned line by line, so a secret split across two lines
  (other than a private key) isn't found.
- A bare `key=` isn't treated as a secret's name, because in toil's inputs it's
  an issue, space or project key. A real key there is still caught by its shape
  or its entropy.
