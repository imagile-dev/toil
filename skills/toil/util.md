---
area: util
description: Local utilities with no connection or network, decoding a JWT, inventorying dependencies from manifests and lockfiles, and time zone, duration, business-day and cron arithmetic
---

# Local utilities (`util`)

Commands that work on what's on this machine: a token you paste, the manifests
and lockfiles in the workspace, or a time and a time zone. They aren't integrations. There is no
server, no connection to add, no `TOIL_UTIL_*` variable, no credential and no
`--connection` flag, and none of them sends anything over the network. Every
command reads; none changes anything. Verification level: `unit`.

The `jwt` and `deps` commands each have two paths that do the same thing, with the
same flags and output. The `util` path is the main one, and the short path is an
alias:

| Command | Alias | MCP tool |
|---------|-------|----------|
| `toil util jwt decode` | `toil jwt decode` | `util_jwt_decode` |
| `toil util deps scan` | `toil deps scan` | `util_deps_scan` |
| `toil util deps diff` | `toil deps diff` | `util_deps_diff` |
| `toil util time convert` | none | `util_time_convert` |
| `toil util time duration` | none | `util_time_duration` |
| `toil util time business-days add` | none | `util_time_business_days_add` |
| `toil util time business-days diff` | none | `util_time_business_days_diff` |
| `toil util time cron` | none | `util_time_cron` |

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

### Time: `toil util time`

Date and time arithmetic on the time zone data Node ships (IANA, through `Intl`);
toil bundles no zone database of its own, and nothing reads the network. Each
command checks its own answer a second way and reports the checks in
`data.verified` (`{ passed, checks }`), with anything it couldn't check or had to
approximate in `meta.warnings` as `UNVERIFIED` or `APPROXIMATED`.

Times are ISO 8601: a date (`2026-03-08`), a wall clock (`2026-03-08T02:30`), or an
instant with `Z` or an offset (`2026-03-08T07:30:00Z`, `2026-03-08T02:30:00-05:00`).
`@1760000000` is epoch seconds, and `now` is the current time, read once per call.
Fields out of range (`2026-02-29`, `24:00`, a leap second) are `INVALID_INPUT`,
never rolled over. Digits below a millisecond are dropped with an `APPROXIMATED`
warning. Zones are IANA names (`America/New_York`); an unknown one is
`INVALID_INPUT`.

**DST.** A wall clock a zone skipped (spring forward) or showed twice (fall back) is
always reported, in `data` as a `dst` object and in `meta.warnings` as
`TIME_DST_GAP` or `TIME_DST_OVERLAP`. A gap is read as the time the clocks showed
after the jump (02:30 becomes 03:30) and an overlap as the earlier of the two. Give
the time an offset to choose otherwise.

#### `toil util time convert`

```bash
toil util time convert 2026-03-08T02:30 --zone America/New_York --to UTC --to Europe/London
toil util time convert now --to Asia/Kolkata
```

| Argument or flag | Meaning |
|------------------|---------|
| `<time>` | The time to convert |
| `--zone <zone>` | The zone of a time written without an offset. Required for one; refused for a time that has an offset |
| `--to <zone>` | A zone to convert to (repeatable; default `UTC`) |

Output: `{ input, instant, epochMs, source: { kind, zone, offset, dst? }, results:
[{ zone, local, offset, offsetSeconds, dst? }], verified }`. `local` is the time in
that zone with its offset. Checks: each result reads back as the same instant
(`convert.roundtrip`), the zone shows that wall clock then (`convert.zone`), and a
wall-clock input is what its zone shows at the instant found (`convert.source`). A
failure warns `TIME_ROUNDTRIP_MISMATCH`.

#### `toil util time duration`

```bash
toil util time duration P1DT2H30M
toil util time duration --seconds 93784.5
```

| Argument or flag | Meaning |
|------------------|---------|
| `<duration>` | An ISO 8601 duration to read: `PT1H30M`, `P1Y2M10DT2H`, `PT0.5S`, `-PT15M`. Only the last part may have a fraction |
| `--seconds <seconds>` | Instead, a number of seconds to write as a duration |

Output: `{ input, iso, negative, parts: { years, months, weeks, days, hours,
minutes, seconds }, totalSeconds, text, verified }`. `iso` is the canonical text.
Seconds are written in hours, minutes and seconds only (`PT26H3M4.5S`), since a day
isn't always 24 hours. Years and months have no fixed length, so `totalSeconds` is
`null` with an `UNVERIFIED` warning; days and weeks count as 24 hours and 7 days,
with an `APPROXIMATED` warning. Check: the canonical text reads back as the same
parts (`duration.roundtrip`, warning `DURATION_ROUNDTRIP_MISMATCH`).

#### `toil util time business-days add` and `diff`

```bash
toil util time business-days add 2026-12-23 3 --holidays holidays-2026.txt
toil util time business-days add 2026-12-28 -1
toil util time business-days diff 2026-12-24T15:00 2026-12-29T10:00 --zone America/Chicago --holiday 2026-12-25
```

| Argument or flag | Meaning |
|------------------|---------|
| `<start>` | The start time or date |
| `<days>` | `add`: business days to add; negative subtracts |
| `<end>` | `diff`: the end time or date |
| `--zone <zone>` | The zone whose calendar days count, and the zone of a time without an offset (default `UTC`) |
| `--holidays <file>` | A file in the workspace: one `YYYY-MM-DD` per line, optionally followed by a name; `#` lines are comments. Any other line is `INVALID_INPUT` naming it |
| `--holiday <date>` | A holiday as `YYYY-MM-DD` (repeatable) |

Business days are Monday to Friday, less the holidays given. No country's holidays
are built in: list the dates the office is actually shut (the observed Friday, not
the Saturday it stands in for).

`add` counts as a spreadsheet's `WORKDAY` does: the start never counts, each step
lands on the next business day, and `0` returns the start unchanged. A time of day
is kept, and a result in a DST gap or overlap is warned about. Output: `{ start,
days, zone, result, weekday, skipped: { weekendDays, holidays }, holidaysListed,
dst?, verified }`. Checks: the business days between start and result, counted
again day by day, number `days` (`business.count`); the result is a business day
(`business.landing`); and it's on the right side of the start
(`business.direction`). A failure warns `BUSINESS_DAYS_MISMATCH`.

`diff` measures the time between two times that falls on business days in the
zone. A date means midnight. Output: `{ start, end, zone, negative, businessDays,
hours, duration, totalBusinessSeconds, elapsedSeconds, holidays, verified }`:
`businessDays` is whole 24-hour days of business time, `hours` what's left over,
and `duration` the same, exactly (`PT43H`). DST days count as the 23 or 25 hours
they are. Checks: business time plus the rest adds up to the elapsed time
(`business.partition`), and the days and hours make the business time
(`business.total`), warning `BUSINESS_TIME_MISMATCH`.

#### `toil util time cron`

```bash
toil util time cron "*/15 9-17 * * 1-5" --zone Europe/London --count 10
toil util time cron "0 0 12 ? * MON#2" --dialect quartz
toil util time cron "H H(0-7) * * 1-5" --dialect jenkins --job platform/api-build
```

| Argument or flag | Meaning |
|------------------|---------|
| `<expression>` | The cron expression, quoted |
| `--dialect <dialect>` | `standard`, `quartz` or `jenkins` (default: detected: 6 or 7 fields is `quartz`, an `H` is `jenkins`, otherwise `standard`) |
| `--zone <zone>` | The zone the schedule runs in (default `UTC`) |
| `--from <time>` | List runs after this time (default `now`) |
| `--count <n>` | How many run times to list, 1 to 100 (default 5) |
| `--job <name>` | The Jenkins job's full name (`folder/job`), which `H` is hashed from. Required when the expression uses `H` |

The dialects:

- **standard**: five fields, minute hour day-of-month month day-of-week, as the classic
  crontab reads them. Names (`JAN`, `MON`), ranges, lists and steps (`*/15`,
  `1-30/5`, `5/15`); day-of-week 0 to 7, with 0 and 7 both Sunday. Macros `@yearly`,
  `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight` and `@hourly`; `@reboot`
  is refused, since it has no times. When neither day field starts with `*`, a day
  matching **either** runs. A detected standard expression with both day fields set
  warns `CRON_DIALECT_ASSUMED`, since Jenkins reads it differently.
- **quartz**: six or seven fields, second first and an optional year (1970 to 2099)
  last. Day-of-week is 1 to 7 from Sunday. One of the day fields must be `?`.
  Day-of-month takes `L`, `L-3`, `15W` (the weekday nearest the 15th, inside the
  month) and `LW`; day-of-week takes `6L` (the last Friday) and `6#3` (the third
  Friday). A backwards range wraps (`FRI-MON`, `22-2`).
- **jenkins**: five fields like standard, plus `H`, `H(0-7)` and `H/15`, placed as
  Jenkins places them from the job's full name. An unbounded `H` in day-of-month
  stays within 1 to 28. Both day fields must match. The macros use `H` (`@daily` is
  `H H * * *`, `@midnight` is `H H(0-2) * * *`), so pass `--dialect jenkins` for a
  Jenkins macro: a bare macro is detected as standard.

Output: `{ expression, dialect, dialectSource, zone, from, explanation, fields,
runs: [{ instant, local, offset, dst? }], skipped, verified }`. `fields` holds what
each field expanded to, with day-of-week 0 for Sunday in every dialect.

DST: a run time the zone skipped isn't listed; it's in `skipped`, with a
`CRON_DST_GAP` warning. A run time that happened twice is listed once, at the first,
with a `dst` object and a `CRON_DST_OVERLAP` warning. Schedulers differ on both, so
check yours. Fewer runs than `--count` in the next 100 years (or in Quartz's listed
years) warns `CRON_FEW_RUNS`; `0 0 30 2 *` never runs.

Checks: each run, read back as the wall clock its zone shows then, matches every
field again (`cron.rematch`); the runs come after `--from` and in order
(`cron.order`); `local` is the same instant (`cron.local`); and each skipped time
really is in a gap (`cron.gap`). A failure warns `CRON_RUN_MISMATCH`. The
explanation's wording isn't checked, and says so (`UNVERIFIED`): it's built from the
same fields the run times come from, and the run times are what's checked.
