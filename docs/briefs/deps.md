# Dependency inventory (`deps`)

Wave 3 · Integration issue #42 · Suspected bugs #91 · 6 contract commands

## Commands

Decision 6 narrows `deps` to the local inventory:

- **Built here:** `deps scan [--ecosystem] [--include-transitive] [--include-dev]`, `deps diff --from [--to] [--ecosystem] [--include-dev]`
- **Aliases to other areas (they own the code):** `deps frisk --source osv` and `--source sonatype` to the OSV and OSS Index commands (#103), `deps frisk --source sonatypeiq --application-id` to `sonatypeiq evaluate` (#34), `deps outdated` to `artifactory outdated` and `deps license-check` to `artifactory license-check` (#27). Core's cross-group alias (K1) carries them; the contract test checks them.
- **Dropped:** `deps frisk --source all` and `deps connectivity`, both in `docs/divergences/deps.json`.

## Auth

None for `scan` and `diff`; they make no network calls. The alias targets use their own areas' connections.

## Paging

None.

## Special HTTP needs

No HTTP. Local operations:

- **Repo root:** the contract ran `git rev-parse --show-toplevel` from the working directory and scanned from that root, not from the subdirectory. Outside a repo: `scan` fails with "Not inside a git repository. deps commands require a git repo root."; `diff` with "Not inside a git repository."; exit 1. In toil the root comes from core's pure-JS reader.
- **`scan` file list:** matches `git ls-files --cached --others --exclude-standard`: tracked files (including tracked ones that match `.gitignore`) plus untracked, non-ignored ones, and nested repositories are not walked into. Use K3's directory listing in `ctx.files`, which is built to give that same set (it may run git when git is present); don't list files in the area.
- **`diff` (spawns git):** for each ref, `git ls-tree -r --name-only <ref>` for the file list and `git show <ref>:<path>` for each file, 10 MB buffer each. `--to` omitted means the working tree, scanned as `scan` does. Through `src/core/git.ts`, with `GIT_NOT_FOUND` when git is missing.
- **Discovery:** npm `package.json` (not under `node_modules`) with a sibling `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml`, first found in that order; NuGet `.csproj`/`.fsproj`/`.vbproj`, `packages.config` and `Directory.Packages.props`, with a same-directory `packages.lock.json` (one manifest kept per lock file); Maven/Gradle `pom.xml`, `build.gradle`, `build.gradle.kts` with a sibling `gradle.lockfile`. NuGet looks up to 10 directories upward for `Directory.Packages.props`.
- **Lock first:** a lockfile wins over the manifest. For npm, an empty `package-lock.json` result (lockfile v1 or no `packages`) falls back to `package.json`; yarn and pnpm results do not.
- **Workspace bound (K3, decided):** the workspace limits `scan`. Only `.git` metadata may be read above the workspace (decision 2), so when the repo root is above the workspace, `scan` covers the workspace subtree only. That is a security-class divergence, listed in `docs/divergences/deps.json`.

## Context inputs

- `--ecosystem` defaults to `all` (`npm`, `nuget`, `maven`); `scan` defaults to direct and production only; `diff` always includes transitive and takes `--include-dev`.
- No config is read (the contract loaded config and ignored it).

## Supported version

Not applicable to a server. Lockfile formats handled: npm `package-lock.json` v2+, yarn v1, pnpm (versions per #91 item 12), NuGet `packages.lock.json`, `gradle.lockfile`.

## Watch for

- **Dedup:** packages are de-duplicated on `ecosystem:name@version:source`. `diff` then keys on `ecosystem:name:source`, keeping one version per key (#91 item 19). Names are recovered by splitting the key on `:`, so Maven `group:artifact` names survive.
- **`diff` output:** `{from, to: <ref> or "working tree", changes, summary}`. Unchanged packages are omitted from `changes` but counted in `summary.unchanged`. `upgraded` versus `downgraded` comes from `isDowngrade`.
- **Errors swallowed:** a failed `ls-files` gives an empty scan; a failed `ls-tree` gives an empty scan for that ref, so a bad `--from` reports every package as `added` (#91 item 20); unreadable files are skipped.
- **Pin from #91:** parser items 8 to 18 (npm hoisting as `direct`, workspace folders as packages, yarn multi-range headers, Yarn Berry gives zero, pnpm peer suffixes and v9, non-semver specs, `.csproj` self-closing tags, `CentralTransitive` as `direct`, gradle test deps and `direct`, `build.gradle` two-colon strings, `pom.xml` plugin dependencies), 19, 20, 24 (`--ecosystem` accepts anything; a typo scans nothing) and 25 (non-ASCII or quoted paths skipped, since `ls-files` quotes them).
- **Not here:** items 1 to 7 and 21 to 23 belong to the OSV, OSS Index, Sonatype IQ and Artifactory integrations. Item 1 (Basic credentials sent to any absolute IQ `resultsUrl`) is security-class and is fixed at once by core's URL re-pointing.
