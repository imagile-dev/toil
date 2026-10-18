# Agent decisions

Decisions an agent made by default while building the integrations, under the
maintainer's standing instruction (2026-10-17): take the recommended option, prefer
the simpler one, and write each one down here. The maintainer's own decisions are on
issue #68 and the integration issues. This file records only what an agent decided,
so the maintainer can review any of it and overturn it.

Each entry says what was decided, why, and where it applies. The newest entries go at
the bottom of their section.

## Integration kit (#68)

- **Brief writers' open questions were settled from the maintainer's decisions**, not
  sent back to the maintainer:
  - **`artifactory outdated` and `license-check` don't call OSV.** The predecessor pinged
    OSV and never used the answer. Principle 9 allows public API traffic only when the
    command names the service, so the integration drops the call. It's a listed divergence.
  - **`GIT_NOT_FOUND` overrides the predecessor's empty results.** The predecessor's
    `git diff`, `log` and `report` swallowed every git failure and returned an empty
    result. A missing git is now `GIT_NOT_FOUND`, because the maintainer required it to
    be unmistakable (principle 4). Other git failures keep the predecessor's behaviour.
  - **The workspace limits `deps scan`.** When the repo root is above the workspace,
    only the workspace subtree is scanned. Decision 2 on #68 allows only `.git`
    metadata to be read above the workspace.
  - **`ado work schema --example-only`** returns its example as `data` inside the
    envelope, the same divergence `jira schema --example-only` has. No command prints
    outside the envelope.
  - **LogScale** follows the vendor docs, not the predecessor (#37). The board's
    "saved searches" entry was dropped because no command exists for it.
  - **Jenkins #80 item 1 doesn't apply.** toil has no repository config.
- **The ADO brief's three new suspected bugs** were added to #69 as items 27–29 rather
  than fixed.
- **Merge order for the kit PRs:** K1, then K3 and K2 (whichever was approved first),
  then K4, merging `main` into the rest after each. A merge from `main` doesn't count as
  a review round, so no round marker is posted for it.
- **The PR watcher skips dismissed reviews** (#108). The review bot dismisses its own
  previous review when it starts a new round, which caused false round-limit alarms.
- **A stale review thread is resolved by the coordinator** when the approving review of
  a later commit confirms the fix. The reply names the fixing commit.
- **Wording:** principle 9 says "the proxy the environment names" rather than "your
  environment", to match the rest of the list (#105).
- **The pilot integrations' kit gaps (#110 Jira, #111 SonarQube) go into one kit-fix PR**
  before wave 1, so no integration works around them on its own. In it:
  - an input-file context source
  - offset paging reading `total` from empty pages
  - an optional `total` for the page style
  - per-area wording for a missing context input
  - a docs check and a generic precedence test for CI fallbacks
  - not-configured fixes that name the fallback variables
  - `--verbose` redacting only real secret parameter names and showing URLs as sent
  - the docs page showing every key and hiding Writes for read-only areas
  - the per-area table removed from the briefs README
- **Not changed in core:**
  - **A target flag that never fell back to a setting stays an ordinary option.**
    Examples are Jira's `fields`, `list-boards` and `list-sprints`; a context input
    always falls back.
  - **Jira search keeps its own page sizing** inside the area, because the offset
    style's cap doesn't fit it.
  - **The stub generator** keeps making target flags ordinary options; the integration author
    decides which become context inputs.
- **The 1,000-page paging cap stays** as a safety bound, though the predecessor had
  none. Each area lists it in `docs/divergences/<area>.json`, and the error names what
  was being paged.
- **MCP field descriptions never mention CLI-only flags** (`--output-file`), since the
  description is the same text on both front doors. The rule itself is in the `mcp`
  skill.
- **The kit-fix PR's own choices** (#68):
  - **`ctx.supply` takes only the source `file`.** It's the one case the pilots
    met; another source is a one-word addition when an integration needs it.
  - **`paginate` returns the last `total` a page reported**, as `Paged.total`,
    rather than only calling the callback on empty pages, so a count needs no
    side effect in the callback.
  - **A `page` style's cursor carries the count of items before its page.** With
    `total`, a page needn't be full to have a next one, so the page number alone
    can't restore the count on resume (review of #113).
  - **A missing context input's own wording**: the first missing input that
    declares `missing` words the error; its `fix` defaults to core's.
  - **`redactUrl` fails closed** (the coordinator's decision on #113's review,
    replacing an exact-name list). It redacts any name containing token, secret,
    passw, pwd, signature or credential; exactly sig, jwt, key or code; and any
    name ending in key, except a key right after project, component, metric, issue,
    rule, branch, repo, space, board, sprint, file or entity. Names ending in keys
    and `projectKeyOrId` show. Why: being wrong toward redaction hides one
    identifier; the other way prints a token.
  - **The docs page's settings come from the connection schema**, written to
    `site/src/data/settings/<area>.json` by the site test, one file per area. A
    planned area's page keeps its Writes section, since its commands aren't known.
  - **The pilots' workarounds stay in `src/areas/jira/` and `src/areas/sonar/`** for
    now; this PR doesn't edit area code. The PR lists what each can drop.
- **The second kit-fix PR's choices** (KF2, #68), from the wave-1 integrations. Every item is
  additive: no existing command's envelope, error code or exit code changes.
  - **Area error codes go into core's `ErrorCode` list**, as `DATABASE` and
    `GIT_NOT_FOUND` did, rather than a typed escape hatch. With `ctx.setExitCode`,
    Jenkins no longer needs one, and the list keeps a misspelt code a type error.
  - **The exit code is `ctx.setExitCode(n)`**, kept beside the envelope (a
    `WeakMap` in `run.ts`) rather than in it, so `ok` and `data` stay exactly the
    predecessor's. MCP has no exit code and doesn't flag the result as an error.
  - **A core alias is declared by the area** (`defineArea({ coreAliases })`) and
    attached by the registry to the core command, which must take an `area` input.
    One generic mechanism, a preset alias (`{ path, input }`), carries the fixed
    `--area`. An unknown `--area` is `INVALID_INPUT`, not an empty list.
  - **A cross-group alias hears its host group's flags**, so a group flag it doesn't
    take is refused instead of ignored (`toil jenkins --instance x instance list`).
  - **`mcp: false` is a field on the command, not a new kind.** The command keeps
    everything `area` gives it; `cli-only` stays the config-command kind with no time
    limit. The docs data gives such a command `tool: null` and a `connection` flag,
    and the page marks it CLI only.
  - **`connectionOptional` applies only when the area has no connection and the call
    names none (or selects none).** A named, misconfigured or ambiguous connection
    still fails. Such a command must be a read with no required context input.
  - **stdin on a terminal is refused in the file service** (`stdin: 'terminal'`), so
    every reader of `-` gets it without a change of its own.
  - **A missing key's example is `defineArea({ examples })`**, not schema metadata:
    a plain map is easier to find and to check against the schema.
  - **Removed contract paths are `"removed": true` on a divergence**, which may then
    list only command paths. The stub generator reads the same flag instead of
    treating every path-only entry as removed; `git credentials` and `deps
    connectivity` were the only such entries and are both marked.
  - **Git readers get the resolved connection**; to make that possible, a
    non-selecting input's git step runs after the connection resolves. A selecting
    input's still runs first, with no connection, since it may pick it.
  - **`ctx.repo()`**, not `ctx.git()`, because `ctx.git` is already the runner. Its
    http(s) remotes drop their userinfo, which can be a token (principle 9, from this
    PR's own principle review); ssh remotes keep `git@`.
  - **A `connectionOptional` command is an MCP tool with its area unconfigured**, as
    a command with no connection is, since it answers for that case itself.
  - **A group flag satisfies a contract leaf flag** in the contract harness. It
    can't tell an alias in another area's group from a real command, so in that rare
    case it may pass a flag that the alias refuses.
  - **Article fix**: messages naming an area use `withArticle` (`an elasticsearch`).
  - **A plain-text error body becomes `HTTP <status>: <text>`**, trimmed onto one
    line, capped at 500 characters, with URLs in it redacted as `--verbose` does.
    JSON bodies go through `errorMessageFrom` exactly as before, and an HTML body (a
    sign-in or proxy page) is still left out, since it says nothing about the
    request. Codes and status are unchanged.
  - **Tests that spawn the real git get 30 s**, named once per file
    (`REAL_GIT_TIMEOUT_MS`), not a raised suite-wide timeout.
  - **The docs page's config example lists every setting** when no key is required
    on its own (sde: a base URL and token, or a connection string), and says so.
  - **A network error names `baseUrl` only when its host failed.** `apiRequest`
    passes the connection's `baseUrl` setting to `restRequest`; another host
    (Dynatrace's `platformUrl`) gets "Check the connection's URL settings". A caller
    with no connection (a token exchange) keeps the old wording.
  - **A renamed key keeps its tier** (principle 5): with both names set, env, then CI,
    beat the connection in the file, which beats `defaults.<area>`, which beats
    provider defaults; a tie goes to the new name, as before. So SDE's old
    `TOIL_SDE_CONNECTION` beats a `connectionString` in the file. An env var ranks
    above a CI fallback (review of #128). Left as is: `TOIL_CONN_<NAME>_<OLD>`
    (rule 1) against `TOIL_<AREA>_<NEW>` (rule 2) is a tie, because the loader
    records both as `env`, so the new name wins. Telling them apart would need a new
    source kind for one rare pairing.
  - **`scripts/shoot.mjs` retries removing its Chrome profile** for about three
    seconds, then warns and leaves the exit code alone.
  - **Not done here:** `statusText` on `apiResponse`, and an opt-out of the 429
    retry. Neither had an integration blocked on it.
- **On Windows, a locked db test folder is left in temp with a warning** instead of
  failing the test (#112). A SQLite worker stopped mid-statement holds the file
  until the statement returns; that's not what any test checks
  (`test/harness/db.ts`).
- **`redactUrl` fails closed**: substring credential words plus names ending in key,
  exempting clear identifiers. This overturned an earlier explicit-list call after
  #113's review.

- **The third kit-fix PR's choices** (KF3, #68), from the wave-2 integrations. Each
  is additive for every command on `main`, with one exception a principle requires
  (the dot-segment refusal below).
  - **Core's token exchange is told apart by a watcher**, `watchTokenExchanges()`
    in `src/core/token.ts`, not by a fixture flag or a URL list. The parity suite
    removes one recorded call per exchange core made, so a read that POSTs to the
    token URL itself still fails, and it clears the token cache before each CLI and
    MCP run. Checkmarx and alation can drop their `queryByPost` workaround.
  - **`tokenScope(area, connection)`** is exported for an area that forgets its own
    token; `apiRequest` builds its scope with the same function.
  - **`deps frisk` is a declared table, `ROUTED_ALIASES` in `src/registry.ts`**,
    resolved against the registry: a route whose command isn't registered is
    skipped, calling it says "this build of toil doesn't have it yet", and with no
    route registered (main today) the path isn't there. osv and sonatypeiq fill it
    in by existing, with no edit to the table. A routed path's leaf carries every
    present target's flags; a flag another route owns is refused by name. Targets
    may not write or take positional arguments. The contract test checks its row
    only once every route is registered, since `--application-id` arrives with
    sonatypeiq.
  - **An area's own not-configured wording** replaces core's message only; the fix
    stays core's unless the area gives one.
  - **A removed key is a `CONFIG_REMOVED_KEY` warning in the area's words, not an
    error.** The value is dropped and never sent; a missing replacement key still
    fails as `CONFIG_INVALID` from the schema, as before.
  - **Two selecting inputs pick a connection together only when each alone is
    ambiguous.** A value that picks one connection on its own keeps doing so, and
    contradictions keep their errors.
  - **Typed examples** drop the index signature `z.object({})` reads as, so a
    command with only context inputs needs no cast.
  - **One inventory reader** in `src/core/inventory.ts`. Artifactory's
    `readInventory` now calls it with `pipeTo: 'toil artifactory <command>'`, so its
    messages are unchanged; that file's only edit.
  - **`poll({ backoff: 'linear' })`** waits the interval times the attempt number,
    capped as before.
  - **A request path with a `.` or `..` segment is refused** (`requests.path` in
    `docs/bounds.md`, a global divergence, principle 2), in `apiRequest` and in
    `restResponse`, before anything is sent, including `%2e` spellings. It changes
    one pinned contrast test (`findings list --app ../../x` now refuses instead of
    sending to a collapsed path). The github and confluence area checks stay.
  - **`connections remove --area`**, refusing a connection of another area before
    changing anything, so `jenkins instance remove` can be a `coreAliases` entry.
  - **A fixture's `repo`** is handed to `ctx.repo()` on both front doors in the
    parity and contract suites.
  - **`connectionOptional` also covers a default connection that only lacks keys**
    (every rejected key unset): the command runs with no connection and a
    `CONFIG_INCOMPLETE` warning names what's missing. A key set wrongly, or a
    connection named outright, still fails. No shipped command uses
    `connectionOptional` yet, so no envelope on main changes.
  - **`retryRateLimit: false`** on `apiRequest` hands a 429 back at once, through
    the usual error path or `accept`.
  - **Not done here:** the docs page for an area with no credential or base URL
    (osv), which was on the coordinator's list for this batch but not in its brief.

- **Flaky Windows cleanup in the db tests leaves a locked temp folder** rather than
  failing the run (#112). The folder is in the OS temp directory, and failing on it
  tested Windows' file locking, not toil.
- **Over MCP, input errors still name CLI flags** (`--query`). A known limitation,
  recorded rather than fixed: rewording every area's input errors per front door
  isn't worth its complexity yet. Fixed once in core by KF6, below.

- **The fourth kit-fix PR's choices** (KF4, #68):
  - **Dot segments are checked after the URL parser's own first step**: tabs, LF
    and CR dropped, and leading and trailing C0 controls and spaces trimmed, so
    `.\t.`, `.\n.`, `.\r.`, a trailing `.. ` and `..` before `\u0000` or `\u001f` are
    refused like `..` (principle 2; found by #119). The github and confluence
    area checks stay.
  - **A group flag on a path in another group is refused in the words the user
    typed** (`toil openshift --env prod cluster list` says `toil openshift cluster
    list` doesn't take `--env`, and runs `toil connections list --area
    openshift`), rather than dropped. Dropping it would quietly ignore a flag the
    user meant (principle 4); refusing was already the behaviour, only the
    message named a command and field they never typed (#132).

- **KF5 (#68): a dot segment followed by `;params` is refused** (`..;x`, `.;`,
  `%2e%2e;x`, `.%2e;jsessionid=1`), since servlet containers strip `;params` before
  resolving dots, which made `confluence remove-label --label "..;x"` a page
  delete (principles 2 and 9; found by #117's review). Only the part before the
  first `;` is checked, so `a;b` and `v1;rev=2` still pass. An encoded `%3b` isn't
  a separator to the container, so it isn't treated as one.

- **The sixth kit-fix PR's choices (KF6, #68)**, closing the kit gaps the
  integration builds reported. `ok`, `data`, the error code and the exit code stay
  as they were for every command, with the one exception the maintainer approved
  (ado `--save`, below).
  - **Every status line carries its reason phrase** (`HTTP 503 Service
    Unavailable`), through one helper, `statusLine()` in `src/core/rest.ts`: the
    response's `statusText`, or Node's standard phrase when the server sent none
    (HTTP/2 has none, and neither do the test fakes). `RestResponse` gains
    `statusText`, so an area reading a status as an answer (kibana, artifactory's
    ping) words it the same way. The areas that built `returned HTTP <n>` from an
    error's status (osv, ossindex, sonatypeiq) use the helper too. Only message text
    changes; 16 pinned tests were updated.
  - **A network error's fix names the setting the host came from**: `baseUrl`
    when it holds the host, else the first setting whose value names it
    (Dynatrace's `platformUrl`, SDE's `<token>@<host>` `connectionString`), else
    "the connection's URL". Found by matching the value, so no area declares
    anything; only the key is ever printed. A caller with no connection keeps
    `baseUrl`.
  - **Input errors over MCP name fields, once, in `runCommand`**: the MCP server
    passes `'mcp'`, and an `INVALID_INPUT` envelope's message and fix have each of
    the command's long flags (and `--allow-write` on a write) replaced by its field.
    A plain text swap over the declared flags, longest first, rather than a second
    wording in every area; `--no-` flags are left alone. A quoted command line
    keeps its flags (review of #149): `toil …` in backticks, or plain text from
    `toil ` to the next `,` or `;`, a sentence-ending `.`, a backtick or the end,
    which covers every command line the areas' fixes quote today. Code, details and `data`
    don't change. Tested through alation over both front doors.
  - **The git reader hands over every remote, `origin` first**, then the rest in
    `git remote -v` order, and the first one the area's parser accepts wins; the
    parsers still trust only the connection's host. Bitbucket's "origin only"
    divergence is gone (github and ado had no entry for it). The predecessor took
    the first match in `git remote -v` order, which is sorted by name, so the two
    differ only when `origin` and a remote sorting before it are both on the host;
    each of the three areas lists that one narrow case.
  - **osv, ossindex and sonatypeiq read inventories with core's reader.** Their
    own wording (the MCP hint, the fixes, sonatypeiq's "to evaluate") is kept
    through optional `InventoryOptions` words, so every message stays identical and
    their tests pass unchanged. osv's thin wrapper only supplies those words.
  - **The splitio example cast was simply unneeded** since KF3's typed examples;
    no other area had one.
  - **`scripts/stub-area.mjs` stubs an area with no contract entry from command
    names on the command line** (`node scripts/stub-area.mjs jira-cloud search
    "issue get"`), each with no flags, or one `example` command when none are named.
    Names on the command line over a list file: one fewer format. Naming commands
    for an area the contract has is refused.
  - **The docs page follows what an area has**: a board entry may say `"local":
    true` (git), which replaces the hardcoded area check; a shipped area with no
    settings shows no Configuration section and says it has no credential (osv); one
    with no `baseUrl` says which fixed host it calls (ossindex); and the
    `--connection` sentence appears only when a command takes it. git's status text
    says its tests stub git, not HTTP. osv and ossindex got board entries in the
    security group.
  - **ado's `work fields --save` and `work types --save` are removed**, on the
    maintainer's instruction of 2026-10-17. The saved `fieldAliases` were the
    built-in aliases filtered to fields the server has, merged over those same
    built-ins when used, so saving never changed what a name resolved to, and
    nothing read `discoveredFields` or `discoveredTypes`. Passing `--save` is now
    core's unknown-option `INVALID_INPUT` (an accepted envelope change, listed in
    ado's divergence file with an `allows` entry); every call without it returns the
    same `data`. No area writes config, and core gains no way to. A custom alias is
    `fieldAliases` on the connection: asked for by `toil connections add`, or set in
    the config file or `TOIL_ADO_FIELD_ALIASES` as JSON. There is no `toil
    connections set`, so the skill names those three rather than an invented
    command.

## Integration process

- **Integration agents run the `ship` skill's four local reviews themselves**, one after
  another, instead of starting sub-agents. Sub-agents' results were being delivered to
  the coordinating session instead of the agent that asked, which stalled integrations. The
  rule itself is in the `ship` skill.
- **About six integrations run at a time**, each an Opus agent in its own worktree, so GitHub's
  API rate limit and the review bot keep up.
- **A review finding may be skipped when fixing it would add undue complexity**, on
  the maintainer's instruction of 2026-10-17. The rule is in CLAUDE.md's Delivery
  section. Each skip and its reason are recorded here, and in the thread.
- **Wave 1 started before the first kit-fix PR (#113) merged.** Integration PRs merged `main`
  afterwards and adopted its fixes, rather than waiting on it.
- **An approved PR at its round limit with only a cosmetic nit left is merged**, and
  the nit goes into the next follow-up PR (#112: a blank line in the
  `test/harness/db.ts` imports). A fourth round for a blank line costs more than it
  fixes.
- **Squash merges pass an explicit subject and body**, the PR description as it
  stands, because the repository's default (`COMMIT_MESSAGES`) would copy the
  branch's commit history into `main`. The coordinator merges only after checking
  approval at the head commit, no open threads and `CI ok`.
- **Envelope calls were reversed to match the maintainer's rule** that a proven
  envelope (`ok`, `data`, error code, exit code) never changes: where an agent had
  chosen a better-looking error, the predecessor's envelope came back with an
  additive warning instead (Jenkins below).
- **Integration PRs blocked on a kit gap are held for the kit PR**, not given a workaround:
  checkmarx (#129) and alation (#133) for core's token exchange in the parity
  suite, osv/ossindex (#130) and sonatypeiq (#131) for `deps frisk`'s routing.
  KF3 (#68) carries each.
- **Placeholders on Atlassian and Dynatrace use `<service>.imagile.dev`, not a
  vendor tenant** (#142's build, principle 1). Both vendors answer for every
  subdomain, so an `imagile` tenant on `atlassian.net` and an `abc12345` environment
  on `live.dynatrace.com` were real hosts someone could register, and a copied
  example would send them the credential. Prose names the shape as
  `<environment-id>.live.dynatrace.com`. CLAUDE.md's Placeholders rule says so, and
  `test/repo-hygiene.test.ts` refuses a tenant-shaped name on those domains.
- **A PR past its three review rounds gets one more when the findings are
  converging**, not looping: #134, whose only new findings were wording that
  merges from main brought in, and #117, where a security finding (`..;x` reaching
  a servlet container as `..`) moved into core (KF5) and the area only needs its
  tests. The cap is there to stop a reviewer and an agent going in circles; it
  isn't a reason to ship a known security gap or an unfinished sweep.
- **"Port" in the sense of porting software is dropped from history, issues and
  docs** (#68), on the maintainer's instruction of 2026-10-17, so toil doesn't read
  as derivative. Main's 12 affected commit messages were reworded and force-pushed
  with identical content, and open branches were relinked with a merge commit. The
  repository's own wording now says "integration", "build" or "match": the
  integration kit, building an integration, matching the predecessor bug for bug, and
  CLAUDE.md's **Matching the predecessor** section. Network ports keep their name.
  One later squash merge (#132) landed with a garbled subject from that rewording;
  on the maintainer's go-ahead, main was force-pushed once more to fix that one
  message, after a backup branch and a check that every commit's files were
  unchanged. The coordinator's merge script now refuses such a title.
- **Approved PRs are merged together locally and gated before any of them merges.**
  Each PR's CI runs against `main` as it was, so two green PRs can still break `main`
  together (KF2 with three integrations; KF3 with openshift). The batch of ten on
  2026-10-17 was combined, gated (typecheck, lint, tests, build, `check:pure`,
  smoke), merged in that order, and `main` checked against the tested tree. A PR
  whose rewording touches every file (#134) goes last, so the others don't conflict
  on it.
- **A small kit change with one user can ride in the area PR** instead of its own
  kit-fix PR: #143 (git) adds the harness's `git?: GitRunner` field and rewords
  `GitCall.options` in `src/core/git.ts`. A separate PR would have cost a review cycle
  for a change only git uses.
- **A security finding found in one area's review is fixed in core when it applies
  to every area**: KF4 (#139, dot segments hidden by tab, newline or trailing
  control characters) and KF5 (#141, `..;x` path parameters that a servlet container
  resolves as `..`), each from a reviewer's run against confluence or github. The
  areas that had added a local check keep only what core doesn't cover.

## Per-integration decisions

Added as each integration lands.

### Jira and SonarQube

- **Jira and SonarQube adopt #113's kit** (pilot cleanup, #68):
  - Jira `create-issue` reports a project from `--input-file` through `ctx.supply`,
    source `file`. The file's value is still used as written, so an empty one gets
    create-issue's own error, as the predecessor's `??` gave it.
  - Jira `search` keeps its own `total`. `Paged.total` there is the end offset
    clamped to `--max-results`, and it drops a total the server left out, where the
    predecessor returned the server's value as sent.
  - SonarQube `--all` uses the `page` style with `total`; its four project commands
    mark `project` required, with the predecessor's message as `missing` and core's
    fix. The hand-written `SONAR_TOKEN` precedence tests went, since
    `test/fallbacks.test.ts` covers them.

### Jira

- **Supported minimum is 8.14**, the release that added personal access tokens.
  Unverified against a live server.

### Confluence

- **Deletes are CLI only**, never MCP tools (CLAUDE.md, Writes); the write gate
  still applies.
- **An invalid `--limit` returns `[]` as before**, plus a `meta.warnings` entry
  (principle 4).
- **A Jira token is reused only through an explicit `apiTokenFrom` pairing**
  (decision 7). `TOIL_JIRA_API_TOKEN` beating a stored Confluence token is a listed
  divergence.
- **Supported minimum is 7.9**, the release that added personal access tokens.
  Unverified.

### Figma

- **An ignored `--as-of` and an unread later page of versions each get a
  `meta.warnings` entry** (additive, principle 4). Behaviour stays bug for bug.

### Jenkins

- **`pipeline run --wait` on a failed build returns the predecessor's success
  envelope and exits 1**, plus an additive warning. This reverses the agent's first
  call, an error envelope, after the maintainer's envelope rule. It uses KF2's
  `ctx.setExitCode`.
- **`instance list` is a core alias of `connections list --area jenkins`**, so the
  area never sees the whole config. `instance add` and `remove` stay CLI-only
  pointers to `toil connections`; `remove` can become a core alias now that
  `connections remove` takes `--area` (KF3).
- **A 429 is retried like every other area's, and progress shows only under
  `--debug`.** Both accepted as they are.

### Artifactory

- **The old `REPO_*` env names still work through `renamed`**, with its warning.
- **The pre-lookup ping is sent on every call**, as before.
- **The inventory accepts `deps scan`'s envelope, its `data` or a bare list**; the
  reader is core's since KF3.

### GitHub

- **`diff` retries a 429 like everything else**: core had no opt-out, so #72 item 11
  couldn't be kept, and it's listed. KF3 adds `retryRateLimit: false` should the
  area want the old behaviour back.
- **The review-thread truncation warning moved from stderr to `meta.warnings`**
  (additive).

### Bitbucket

- **`create-prs` keeps the predecessor's per-repo error recording.** `create-prs`
  with every repo failed, and `merge-pr` with the branch not deleted, each get a
  `meta.warnings` entry (additive).
- **`create-prs` declares a long `timeLimitMs`** (about 30 minutes), so a batch run
  keeps the predecessor's per-repo result instead of ending in core's 120 s
  `TIMEOUT`.

### Elasticsearch

- **#84 items 1 and 3 were fixed from the vendor docs; item 2 was kept.**
- **Commands with `--timeout-ms` declare a ten-minute `timeLimitMs`.**
- **The error-shape workaround stays in the area.**

### Split.IO

- **The global `--workspace` clash:** Split's own workspace is `--ws` (MCP
  `workspace`) or a connection `workspace` setting.
- **`--environment` stays an ordinary flag**: a Split environment id isn't toil's
  `--env`.
- **`--yes` is removed**; the write gate replaces it.
- **`flags archive` is CLI only** (delete-like), and a toggle-off that restores
  gets a warning.

### Contrast

- **`--app` stays an ordinary required flag**: it never fell back to a setting.
- **Only `apiKey` and `serviceKey` are secrets**; `username` wasn't one.
- **A dot segment in `--app` is now refused** by core (KF3, `requests.path`), which
  changes one pinned test.

### LogScale

- **Synchronous search, not query jobs.**
- **`--limit` is applied client-side**, with a `LOGSCALE_LIMIT` warning; nothing is
  appended to the user's query.
- **`--timeout-ms` is capped at 600000**, with a `timeLimitMs` of 605000.

### SDE

- **One connection string, `<token>@<host>`, in a single secret `connectionString`.**
  The old `connection` key comes in through `renamed`, since core reserves
  `connection`. The split `baseUrl`/`token` keys were dropped, so there is no
  mixed-form case and an env value always beats the file (principle 5), with no
  core change.
- **The `TOIL_SDE_CONNECTION` tier gap** (the old env name losing to a
  `connectionString` in the file) was tracked as KF2's #128 item 20; the pinned
  test in `src/areas/sde/sde.test.ts` flips once core ranks a renamed key by tier.

### Dynatrace

- **Each old environment is a connection, selected by `--env`** (its name or an
  `env` setting).
- **#83 item 6 is not reproduced** (security): stored values over env, and a token
  sent to other connections.
- **`trace` polls at a fixed 1 s.**
- **A second area object carries `platformUrl`'s request hook.**

### Sauce Labs

- **`session appium` needs `--allow-write`**: it can start a server (principle 2,
  listed).
- **`session create` gets a one-hour time limit** for `--wait`.
- **An additive `--instrumentation` flag** works around the harness's `--no-` gap.
- **`job`, `rdc-job` and `session delete`, and `tunnel stop`, are CLI only.**

### Checkmarx

- **Client credentials are dropped**: `clientId` and `clientSecret` give warnings
  (KF3's `removed` lets the area word them), and a missing `apiKey` is
  `CONFIG_INVALID` naming it.
- **The token goes only to `*.checkmarx.net` over HTTPS, or to the connection's own
  host.**
- **A truncated list warns as `CHECKMARX_TRUNCATED`**; there is no offset paging, and
  `data` is unchanged.
- **Token renewal uses core's refresh margin.**

### OSV and OSS Index

- **#91 items 5 and 7 are fixed as declared changes**, since a live run confirmed
  them (CLAUDE.md, Matching the predecessor): OSV fetches each full record, and OSS Index takes a
  username and token (Basic, sent only to `ossindex.sonatype.org`), with a plain
  error without them.
- **`deps frisk --source osv` (and no `--source`) and `--source sonatype`** come
  from KF3's routed alias table, not from the area.

### Sonatype IQ

- **`tier` is fixed at `"full"`**: the OSV and Artifactory pings are dropped
  (principle 9). The evaluation no longer contacts either, so no lower tier can
  arise; the field stays so the envelope keeps its shape.
- **IDs stay ordinary flags** (`--organization-id`, `--public-id`,
  `--application-id`), not context inputs, because the predecessor never filled
  them from a setting (#131).
- **`SONATYPEIQ_NO_COMPONENTS` and `SONATYPEIQ_UNMATCHED_RESULT` warnings.**
- **`resultsUrl` is re-pointed at the configured origin** (security).
- **The evaluation polls with core's `poll`, `backoff: 'linear'`** (KF3): 10 tries,
  waiting 2 s up to 18 s, as before.

### OpenShift

- **Each cluster is a connection** with `env` and `instance` settings.
- **#88 item 3 is not reproduced** (security, as for Dynatrace).
- **`resource-usage --csv --out` returns the rows plus the file.**
- **The 429 retry on `logs` is accepted.**
- **`--env` alone now succeeds** where it picks one connection (more permissive,
  accepted); since KF3, `--env` with `--instance` pick one together.
- **`cluster list` becomes `connections list --area openshift`** (a core alias).

### Alation

- **Warnings `ALATION_ID_MISMATCH`, `ALATION_COLUMNS_TRUNCATED` and
  `ALATION_INPUT_OVERRIDDEN`** move what went to stderr into `meta.warnings`
  (additive).
- **The token is renewed 60 s before expiry**, as before.
- **`token status` mints a new token on every run**, kept.
- **Its cached token is dropped with KF3's `tokenScope()`**, not a copy of core's
  key format.

### Kibana

- **An Elasticsearch key is shared only through an explicit `apiKeyFrom` pairing**,
  as confluence borrows a Jira token. The default connection still reads
  `TOIL_ELASTICSEARCH_API_KEY`, as before; a stored Elasticsearch key is no longer
  borrowed without the pairing (a principle 9 divergence).
- **A missing key is `NOT_CONFIGURED`**, whose fix names `TOIL_KIBANA_API_KEY`,
  `toil connections login` and `apiKeyFrom`. A rejected borrowed key points at
  `toil connections login <name>`, never a plaintext `kibana.apiKey`, and names the
  env var only for the default connection.
- **`status` and `dashboards export` answer a 429 at once** (`retryRateLimit:
  false`), as the brief says; the other commands retry.
- **`--space` is a context input** that falls back to the connection's `space`.

### Azure DevOps Server

- **The self-hosted Server shape**, a PAT only. `--organization` is its own context
  input; `where()` checks collection, then project, then repo, in the predecessor's
  order, with `--collection` beating `--organization`, which beats the git remote and
  the connection setting.
- **`work fields --save` and `work types --save` are gone** (KF6): they saved only
  the built-in aliases, so nothing needed writing. `fieldAliases` on the connection
  is how a custom alias is set.
- **`pipeline run --wait` times out as `TIMEOUT` at an 11-minute limit**, as Jenkins
  does, and the divergence says so.
- **#69 is reproduced and pinned except item 1**, fixed as a security divergence.

### Git

- **git is the one spawned executable**, only through `src/core/git.ts`. Outside a
  repo, a command checks for git first, so a machine without it always gets
  `GIT_NOT_FOUND`.
- **`report` reads the branch from `ctx.repo()`** rather than spawning `rev-parse`.
- **Only a git that ran and failed becomes an empty result**; a cancel or an
  argument core refuses still errors.
- **The predecessor's 1 MB output limit is kept**; core's 64 MB cap replaces
  report's 200 MB. `--file` stays relative to the repo root.
- **`status`, `diff` and `:(top)` cover the whole repository** even when the
  workspace is below its root, as `docs/bounds.md` already says.

### Jira Cloud

- **Built from Atlassian's REST API v3 and Agile 1.0**, with no predecessor, at
  verification level `unit`; never run against a live site.
- **It reuses `jira`'s command names, flags and output keys**, differing where the
  API does: users are `accountId`s, found with `search-users`.
- **Rich text goes in as plain text** (blank lines between paragraphs), and output
  keeps Jira's ADF plus plain-text `descriptionText` and `bodyText` fields.
- **Search uses `/rest/api/3/search/jql`**, which reports no total, so `data` is
  `{ issues, maxResults, isLast }` and `--cursor` replaces `--start-at`.
- **Every #20 operation Cloud supports is built**, worklogs, attachments, custom
  fields, `--input-file` and `schema` included; a multi-user picker gets its own
  `multi-user` field type.

### Confluence Cloud

- **Built from Atlassian's v2 API**, with v1 for CQL search, at verification level
  `unit`; never run against a live site.
- **All 20 of `confluence`'s commands exist under the same names.** Three flags are
  dropped where Cloud has no equivalent: `--markdown`, `get-page --expand`, and
  `--start` (cursor paging replaces it).
- **Bodies are storage format both ways**, with `--representation wiki` on writes
  and a plain-text `bodyText` added.
- **`update-page` with no body resends the current one**, since v2 requires it.
- **A `baseUrl` ending in `/wiki` is refused**, saying to drop it, since the area adds
  `/wiki` itself.
- **A Jira Cloud token is shared only through an explicit `apiTokenFrom: jira-cloud`
  pairing** (token only), as `confluence` pairs with `jira`.
- **`download-attachment` follows Atlassian's redirect to its media host with every
  header dropped** (core's `follow-without-auth`), so the credential stays on the
  configured site.

### SQL Server

- **Read-only on an engine with no read-only transaction** (#49): every read runs in
  `BEGIN TRANSACTION` on a connection opened for that call and is never committed,
  and a statement the server's TDS DONE token reports as a write (its `CurCmd`:
  INSERT, UPDATE, DELETE, MERGE, SELECT INTO, CREATE/DROP TABLE and INDEX, CREATE
  VIEW, ALTER TABLE, CREATE/DROP PROCEDURE, TRUNCATE, UPDATE STATISTICS) is
  `WRITE_DISABLED`. Why: asking the server whether the transaction wrote
  (`sys.dm_tran_*`) needs VIEW SERVER (PERFORMANCE) STATE, which a reader login lacks.
  A denylist of observed codes, each rerun by `test/db/sqlserver.test.ts`; an unknown
  code still rolls back. Where: `src/core/db/sqlserver/index.ts`.
- **Reads refuse `COMMIT`, `ROLLBACK`, `BEGIN TRANSACTION` and `SAVE TRANSACTION` by
  name** (`INVALID_INPUT`), because a COMMIT ends the transaction toil rolls back and
  keeps the write before it (proved by a test). T-SQL needs no semicolons, so
  `script.ts` only finds those reserved words, tracking `BEGIN…END` and `CASE…END`
  nesting; it never splits statements. `db execute` refuses the same words before any
  of its script runs.
- **Reads refuse an `OUTPUT` clause only beside INSERT, UPDATE, DELETE or MERGE**:
  its rows stream before the DONE token, so a full page would stop it before the
  write was reported. OUTPUT isn't reserved, so a column or alias named `output` in a
  plain SELECT still reads, and the fix says to bracket-quote `[output]`.
- **Error 262 is a write refusal only when the permission it names is CREATE, ALTER
  or DROP**; 3701 (DROP) always is. Other 262s, and 229, 230, 297 and 300 (a reader
  querying a `sys.dm_db_*` view), are `DATABASE` saying the login lacks that
  permission. Why: a refused DDL statement reports the generic statement type 253.
- **Known limit, documented and pinned**: transaction control or an OUTPUT clause
  inside dynamic SQL or a procedure can't be refused by name. toil reports the
  transaction ending (ENVCHANGE, or error 266) as `DATABASE` saying a change may
  have been saved; a read-only login is what stops it.
- **One result per query**: a second result set is `INVALID_INPUT`. A full page
  sends a TDS attention, so the server stops producing rows and nothing after the
  first result runs.
- **`ssl` keeps PostgreSQL's meaning**: off by default; `true` encrypts and verifies
  against `trustedCertificates` (passed to tedious as `cryptoCredentialsDetails.ca`).
  No trust-any-certificate setting.
- **No named-instance lookup** (no SQL Browser query): put the instance's port in
  `port`.
- **`preview-table` orders by the primary key**, else `(SELECT NULL)`.
- **The Azure SDK tedious imports is stubbed out of the bundle**
  (`src/shims/no-azure.ts`, a tsup alias), since toil never uses Entra sign-in or
  Always Encrypted. It also dropped a `supports-color` external `check:pure` caught.
- **tedious's DONE handler is wrapped once at runtime** to emit each statement's
  type, which tedious otherwise drops.
- **Value conversion**: bigint to BigInt (a number when it fits); date and time types
  as the server's wall-clock text, to the millisecond, never shifted; datetimeoffset
  as UTC ISO; decimal and money as JSON numbers (precision past about 15 digits is
  lost; the docs say to CAST to varchar).
- **The test image is pinned to `mcr.microsoft.com/mssql/server:2022-CU27-ubuntu-22.04`**
  in CI and the databases skill, never `2022-latest`.
