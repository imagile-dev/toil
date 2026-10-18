---
area: util
description: Local utilities with no connection or network, decoding a JWT, inventorying dependencies from manifests and lockfiles, and comparing versions and ranges for npm, NuGet and Maven
---

# Local utilities (`util`)

Commands that work on what's on this machine: a token or version you paste,
or the manifests and lockfiles in the workspace. They aren't integrations. There is no
server, no connection to add, no `TOIL_UTIL_*` variable, no credential and no
`--connection` flag, and none of them sends anything over the network. Every
command reads; none changes anything. Verification level: `unit`.

The `jwt` and `deps` commands also have a short path, an alias that does the
same thing with the same flags and output:

| Command | Alias | MCP tool |
|---------|-------|----------|
| `toil util jwt decode` | `toil jwt decode` | `util_jwt_decode` |
| `toil util deps scan` | `toil deps scan` | `util_deps_scan` |
| `toil util deps diff` | `toil deps diff` | `util_deps_diff` |
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
