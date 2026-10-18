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
  - **`artifactory outdated` and `license-check` don't call OSV.** The contract records a
    ping to OSV whose answer is never used. Principle 9 allows public API traffic only when the
    command names the service, so the integration drops the call. It's a listed divergence.
  - **`GIT_NOT_FOUND` overrides the empty results the contract records.** There,
    `git diff`, `log` and `report` swallow every git failure and return an empty
    result. A missing git is now `GIT_NOT_FOUND`, because the maintainer required it to
    be unmistakable (principle 4). Other git failures keep the recorded behaviour.
  - **The workspace limits `deps scan`.** When the repo root is above the workspace,
    only the workspace subtree is scanned. Decision 2 on #68 allows only `.git`
    metadata to be read above the workspace.
  - **`ado work schema --example-only`** returns its example as `data` inside the
    envelope, the same divergence `jira schema --example-only` has. No command prints
    outside the envelope.
  - **LogScale** follows the vendor docs, not the contract (#37). The board's
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
- **The 1,000-page paging cap stays** as a safety bound, though the contract records
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
    `WeakMap` in `run.ts`) rather than in it, so `ok` and `data` stay exactly as the
    contract records them. MCP has no exit code and doesn't flag the result as an error.
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
    with no connection (a token exchange) keeps the recorded wording.
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
    divergence is gone (github and ado had no entry for it). In the contract,
    the first match in `git remote -v` order wins, which is sorted by name, so the two
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
  chosen a better-looking error, the envelope the contract records came back with an
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
- **Approved PRs are merged together locally and gated before any of them merges.**
  Each PR's CI runs against `main` as it was, so two green PRs can still break `main`
  together (KF2 with three integrations; KF3 with openshift). The batch of ten on
  2026-10-17 was combined, gated (typecheck, lint, tests, build, `check:pure`,
  smoke), merged in that order, and `main` checked against the tested tree. A PR
  that touches every file (#134) goes last, so the others don't conflict
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
- **Each PR records its own decisions here**, under its own heading, as the Delivery
  section says. For a while the coordinator kept this file to itself to avoid merge
  conflicts; review (#160) caught that this broke the rule. A conflict in this file
  keeps both sides.
- **The utility group is named `util`** (`toil util jwt decode`, `toil util deps
  scan|diff`), the coordinator's pick when the maintainer asked for one.
- **Each database provider's local Docker run uses a uniquely named container on its
  own port**, removed afterwards, so parallel builds never collide.
- **Scratch files shared by parallel agents are named after their branch**, after one
  agent's PR description was overwritten by another's (#158).

## Per-integration decisions

Added as each integration lands.

### Jira and SonarQube

- **Jira and SonarQube adopt #113's kit** (pilot cleanup, #68):
  - Jira `create-issue` reports a project from `--input-file` through `ctx.supply`,
    source `file`. The file's value is still used as written, so an empty one gets
    create-issue's own error, as the contract records (a `??` fallback).
  - Jira `search` keeps its own `total`. `Paged.total` there is the end offset
    clamped to `--max-results`, and it drops a total the server left out, where the
    contract records the server's value as sent.
  - SonarQube `--all` uses the `page` style with `total`; its four project commands
    mark `project` required, with the message the contract records as `missing` and
    core's fix. The hand-written `SONAR_TOKEN` precedence tests went, since
    `test/fallbacks.test.ts` covers them.

### Jira

- **Supported minimum is 8.14**, the release that added personal access tokens.
  Unverified against a live server.

### Confluence

- **Deletes are CLI only**, never MCP tools (CLAUDE.md, Writes); the write gate
  still applies.
- **An invalid `--limit` returns `[]`, as the contract records**, plus a `meta.warnings` entry
  (principle 4).
- **A Jira token is reused only through an explicit `apiTokenFrom` pairing**
  (decision 7). `TOIL_JIRA_API_TOKEN` beating a stored Confluence token is a listed
  divergence.
- **Supported minimum is 7.9**, the release that added personal access tokens.
  Unverified.

### Figma

- **An ignored `--as-of` and an unread later page of versions each get a
  `meta.warnings` entry** (additive, principle 4). Behaviour otherwise matches the contract exactly.

### Jenkins

- **`pipeline run --wait` on a failed build returns the success envelope
  the contract records and exits 1**, plus an additive warning. This reverses the agent's first
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
- **The pre-lookup ping is sent on every call**, as the contract records.
- **The inventory accepts `deps scan`'s envelope, its `data` or a bare list**; the
  reader is core's since KF3.

### GitHub

- **`diff` retries a 429 like everything else**: core had no opt-out, so #72 item 11
  couldn't be kept, and it's listed. KF3 adds `retryRateLimit: false` should the
  area want the recorded behaviour back.
- **The review-thread truncation warning moved from stderr to `meta.warnings`**
  (additive).

### Bitbucket

- **`create-prs` keeps per-repo error recording, as the contract records it.** `create-prs`
  with every repo failed, and `merge-pr` with the branch not deleted, each get a
  `meta.warnings` entry (additive).
- **`create-prs` declares a long `timeLimitMs`** (about 30 minutes), so a batch run
  keeps the per-repo result the contract records instead of ending in core's 120 s
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

- **Each named environment the contract records is a connection, selected by `--env`** (its name or an
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
  them (CLAUDE.md, The command contract): OSV fetches each full record, and OSS Index takes a
  username and token (Basic, sent only to `ossindex.sonatype.org`), with a plain
  error without them.
- **`deps frisk --source osv` (and no `--source`) and `--source sonatype`** come
  from KF3's routed alias table, not from the area.

### Sonatype IQ

- **`tier` is fixed at `"full"`**: the OSV and Artifactory pings are dropped
  (principle 9). The evaluation no longer contacts either, so no lower tier can
  arise; the field stays so the envelope keeps its shape.
- **IDs stay ordinary flags** (`--organization-id`, `--public-id`,
  `--application-id`), not context inputs, because the contract records none of
  them filled from a setting (#131).
- **`SONATYPEIQ_NO_COMPONENTS` and `SONATYPEIQ_UNMATCHED_RESULT` warnings.**
- **`resultsUrl` is re-pointed at the configured origin** (security).
- **The evaluation polls with core's `poll`, `backoff: 'linear'`** (KF3): 10 tries,
  waiting 2 s up to 18 s, as the contract records.

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
- **The token is renewed 60 s before expiry**, as the contract records.
- **`token status` mints a new token on every run**, kept.
- **Its cached token is dropped with KF3's `tokenScope()`**, not a copy of core's
  key format.

### Kibana

- **An Elasticsearch key is shared only through an explicit `apiKeyFrom` pairing**,
  as confluence borrows a Jira token. The default connection still reads
  `TOIL_ELASTICSEARCH_API_KEY`, as the contract records; a stored Elasticsearch key
  isn't borrowed without the pairing (a principle 9 divergence).
- **A missing key is `NOT_CONFIGURED`**, whose fix names `TOIL_KIBANA_API_KEY`,
  `toil connections login` and `apiKeyFrom`. A rejected borrowed key points at
  `toil connections login <name>`, never a plaintext `kibana.apiKey`, and names the
  env var only for the default connection.
- **`status` and `dashboards export` answer a 429 at once** (`retryRateLimit:
  false`), as the brief says; the other commands retry.
- **`--space` is a context input** that falls back to the connection's `space`.

### Azure DevOps Server

- **The self-hosted Server shape**, a PAT only. `--organization` is its own context
  input; `where()` checks collection, then project, then repo, in the order the
  contract records, with `--collection` beating `--organization`, which beats the git remote and
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
- **The 1 MB output limit the contract records is kept**; core's 64 MB cap replaces
  report's 200 MB. `--file` stays relative to the repo root.
- **`status`, `diff` and `:(top)` cover the whole repository** even when the
  workspace is below its root, as `docs/bounds.md` already says.

### Jira Cloud

- **Built from Atlassian's REST API v3 and Agile 1.0**, with no contract, at
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

### Brick breaker

- **It runs on a fixed 33 ms tick, not wall-clock time** (`src/welcome/brick/play.ts`),
  so a slow machine plays slower rather than skipping frames, and tests are
  deterministic.
- **Ctrl+C pauses the game and counts as the first press of the menu's
  two-press exit**, so Ctrl+C means the same thing everywhere in the menu.
- **It plays only on a window of at least 46 by 23 and a console that can redraw
  in place** (`movesCursor`: a TTY, not the legacy Windows console, not
  `TERM=dumb`); anything less gets a polite refusal. `NO_COLOR` and
  `TOIL_NO_ANIMATION` only change how it looks.
- **A lobby screen comes before the game**, with the keys, the size it needs and
  the session's scores, which live in memory only.

### Welcome: dossiers

The Dossiers module of the menu (#56), `src/welcome/views/dossiers.ts`.

- **The create wizard saves as it goes.** Each step runs its own `toil dossiers`
  command (`init`, `add-repo`, `link`, `field`, `env`), and step 6 reviews the
  whole dossier with `dossiers show` and `check`. Holding everything in memory to
  write at the end would mean the menu building a dossier the commands never
  checked step by step. A wizard left halfway leaves a valid, smaller dossier,
  which Edit or Delete can finish.
- **Edit shows the section and the exact commands before saving**; that's its
  "review the diff". The create wizard and the fixes in Review run at once.
- **Binding to a connection with writes on asks for the connection's name typed**,
  as turning writes on does, for a `--connection` and for a `--host` that matches
  one of yours with writes on. **Importing a dossier whose bindings land on writes
  asks for the dossier's name**, found from `dossiers check`'s
  `DOSSIER_WRITES_BINDING` warnings, which runs before every import. Unbinding to
  your default asks nothing: your default was always yours.
- **The menu imports one `.json` file at a time.** `check` takes a file, not a
  folder, and the writes question needs it first. A folder stays `toil dossiers
  import <folder>` on the CLI.
- **A dossier's screens read the last `show` and `check` from the session**
  (`Session.dossiers`, recorded by `finish` in `menu.ts`), and every edit runs `show`
  again after it, so screens never show a stale file. One-off reads (context, list,
  scan, discovery) go to the next screen as a parameter, as the Skills module does.
- **Discovery runs the area's own read with `--dossier <name>`**, so the dossier's
  binding picks the connection: `jira fields --discover --custom-only` (ticked
  fields become `dossiers field` aliases named from the field, `Story Points` to
  `storyPoints`), `confluence list-spaces`, `sonar projects` and `ado project list`
  (ticked values added with `link --add spaces=` or `projects=`). Values already
  there start ticked and are never added twice. Jira has no project-list command
  and ADO no boards command, so those are a typed `project=PAY`, through Set a value.
- **"Add a connection" reuses the connections wizard's name step** with two new
  optional parameters, `suggest` (the name a dossier expects) and `then` (where to
  go after), so it returns to the picker, the review or the import. It then skips
  the "make it the default?" question, which isn't what the user came for.
- **The first environment added becomes the dossier's default** (`dossiers env
  --default`), so calls without `--env` have one.
- **Review offers a fix for every finding a command can fix:** relink, add the
  connection, adopt, set a value after `<area> check-dossier`, remove a section
  (`dossiers unlink`, after typing the area's name), and take a credential out of a
  stored remote (re-add the repo as it is). A duplicate key or a broken file still
  needs the file edited by hand, and Review says so.
- **`toil dossiers unlink <dossier> --area <area> [--env <env>]` removes a section**
  (round 1). It's CLI only, as `remove` is, because taking something out is a
  delete; the menu asks for the area's name typed first. It accepts a section for an
  area toil doesn't have, which is the case Review needs. An environment left with
  no areas is removed too, and stops being the dossier's default, so the file never
  names a default that isn't there.
- **Every dossier write says when it took a credential out of the file** (round 1).
  Remotes are read with userinfo stripped, so any save already wrote them clean,
  silently; now the result carries `credentialsRemoved` (the key paths) and a
  `DOSSIER_REMOTE_USERINFO` warning. Any edit that reaches the save writes the file
  when it holds a credential, even one that changes nothing else, and reports
  `changed: true`. `add-repo` with a remote the repo already lists (and its path, or
  none) adds nothing and needs no `--replace`, so re-adding a repo by its first remote
  cleans a credential in any of them and keeps them all; Review's fix runs exactly
  that. A credential is never written back.
- **The menu matches host selectors with core's own `hostMatches`** (now exported
  from `src/core/dossier.ts`), so `jira.imagile.dev:443` finds a connection with
  writes on exactly as the resolver does and the typed confirmation can't be
  skipped by spelling the default port (round 1, review).
- **The import confirmation is decided by the `DOSSIER_WRITES_BINDING` code alone**;
  the connection names on screen come from its message and fall back to "a
  connection", so rewording the message can't drop the question (round 1, review).
- **Adding a connection from Review runs `dossiers check` and `show` before
  returning**, through a `thenRun` parameter on the connections wizard's name step,
  so Review never shows the finding it just fixed (round 1, review).
- **Dossiers sits after Plugins on home**, so the existing rows keep their numbers.
- **AreaSummary gains `context` and `checksDossier`**, derived in `cli.ts` from the
  registry, so the screens name an area's context inputs and offer `check-dossier`
  only where it exists.
### Databases: PostgreSQL

- **`pg` with `pg-cursor`**, so the row cap stops the server producing rows, not
  only toil reading them.
- **Reads run in `SET TRANSACTION READ ONLY` and roll back**; SQLSTATE 25006 is
  `WRITE_DISABLED`.
- **`COPY` and `DO` are refused on reads**: in a read-only transaction a superuser
  can still write server files with them, which a test shows. A `--` comment ending
  in a carriage return can't hide them (#150's review).
- **Functions such as `lo_export` are a documented known limit**, not refused by
  name: connect with an ordinary role.
- **Cancel is `pg_cancel_backend` from a second connection**; the conformance suite
  checks no statement is still running on the server afterwards.
- **toil ignores the `PG*` environment variables and `~/.pgpass`**, so a connection
  is only what its toil config says.
- **TLS trusts the OS certificate store** as HTTP does (#159), through
  `trustedCertificates`; a certificate failure is `NETWORK`.

### Databases: MySQL and MariaDB

- **One engine, `mysql`, covers both.** `database` is required and is also the
  default schema.
- **Reads also set `SESSION TRANSACTION READ ONLY`**: DDL commits implicitly, so a
  read-only transaction alone let `DROP TABLE` through.
- **`SELECT … INTO OUTFILE/DUMPFILE` and any `SET` are refused on reads**, each with a
  test proving it escapes; `LOAD DATA` is already refused by the engine.
- **A stored procedure that commits and turns itself read-write** is a pinned,
  documented known limit.
- **`db execute` with DDL isn't all or nothing**, because MySQL commits DDL; that's
  documented. A cancel or timeout checks before every statement and before
  `COMMIT`, and sends `KILL <connection>`, so nothing after an abort commits.
- **`preview-table` orders by the primary key**, so pages are stable.

### `--select` and `<area> api` (#95)

- **`--select` is JMESPath**, applied to `data` in `execute()`. All 908 cases of the
  compliance suite pass; the suite is vendored from jmespath.py's MIT-licensed copy.
  An expression nested deeper than 500 levels, or any error while applying one, is
  `INVALID_INPUT`, never `INTERNAL`.
- **`<area> api` is one generic command per HTTP area**, built by `apiCommand()` on
  the area's request hook, starting with `jira api`. Writes are gated per method
  (`writesWhen`), DELETE never goes over MCP (`offMcpWhen`), and `meta.response`
  carries the status and content type.
- **A header value with CR, LF or NUL is refused before sending.** A binary body comes
  back as base64 with an `API_BINARY` warning, never as corrupted text.
- **`jira_api` is marked not read-only over MCP**, because it can write, so MCP
  clients ask before every call, a GET included. Recorded as a rough edge.

### Utilities: `util jwt` and `util deps` (#42, #43)

- **No connection, host or network**, and not on the integrations board.
- **`jwt decode` keeps the argument the contract records** and also reads `-` from stdin on the
  CLI; `-` is refused over MCP.
- **`deps scan` normalises CRLF once in its reader**, so every manifest parser and
  `deps diff`'s `git show` blobs agree. A manifest that can't be read is a
  `DEPS_FILE_SKIPPED` warning.
- **`deps diff` reads files at a ref with `git show <ref>:./<path>`**, through core's
  git.

### `skills` commands (#54, #55)

- **Only the commands the welcome menu needs are built**; the rest of the `skills`
  group the contract records is listed in `docs/divergences/skills.json` with a reason each.
  `git-auth` is gone for good: it rewrote the user's global git config.
- **A marketplace is a connection of the `skills` area**, so its token lives in the
  OS store or a `TOIL_CONN_<NAME>_TOKEN` variable and reaches git only through git's
  environment, scoped to that URL. Clones allow https and local paths only, with
  hooks and submodules off.
- **`skills marketplace add` registers a marketplace with writes off** (coordinator,
  principle 2). CLI only isn't human only: an agent with a shell could otherwise add
  a marketplace and grant itself installs. Writes are turned on the same way as for
  any connection; `add` reports the value the write gate will resolve.

### Welcome menu (#52, #53, #54, #55)

- **Every menu action runs a real command in-process and shows the line it ran.**
  The menu needed `connections test`, `connections writes` and `connections
  default`, so #161 builds them as real `toil connections` commands; `writes` and
  `default` are CLI only, and turning writes on needs the connection's name typed.
- **`connections test` uses an area `probe` that needs the credential**, read as JSON
  through core, so a revoked token or an SSO page served with a 200 is not "healthy".
  Where no cheap authenticated read exists, `authenticated: false` says so.
- **Opening the menu sends nothing over the network.**

### The toil skill (#58)

- **The skill installs from npm, a clone, or a skill manager**, with an MCP reference
  and a check that every command and flag it names exists.
- **Node 24.14, toil's floor**, not the issue's Node 22, which toil refuses.
- **`toil setup alias`** adds a `toil` function to the bash, zsh or PowerShell
  profile, with documented exceptions to the `files.no-overwrite` and
  `files.workspace` bounds.


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

## Dossiers (#16)

- **The model and resolution (#152):**
  - **The commands are `toil dossiers`, plural**, like `toil connections`, as the maintainer's `toil dossiers import` and `show` are.
  - **No area declares a section schema.** A section's keys are the area's context inputs, plus `connection`, `host` and `fields`; any other key is reference data, kept but never applied. `host` and `fields` are reserved as context-input names.
  - **Adopted means "in your own folder"** (`~/.toil/dossiers/`). A loose file named by path never is, so CI passes `--connection` to write.
  - **A dossier's environment fills `--env` only for the areas it lists**, so a default environment can't fail an area that has none by that name.
  - **The default folder is the workspace**, the folder the git step already read.
  - **Remotes are matched without scheme, userinfo or port.**
  - **A dossier naming a connection you don't have is a hard error**, as an unknown `--connection` is (the design's open question 1).
  - **Choosing the dossier is lazy for a folder match only.** The ambiguity of two matches is raised only when the resolver reaches the dossier step. A dossier named by `--dossier` or `TOIL_DOSSIER` is chosen at once, so a bad one fails the call that named it.
  - **With `--connection` named, an input that selects a connection isn't looked up in the dossier**: it could only agree or give way.
  - **A path a call names is bounds-checked before it's looked at**, so over MCP it can't probe whether a file or folder exists.
- **Building and sharing (#164):**
  - **`link` takes context inputs as `--set key=value`**, repeatable, so tool schemas stay fixed; `--add` builds reference lists, and `--for-repo` makes a value one repo's.
  - **`--set env` is refused**, pointing at `dossiers env … --default`: a call never reads a section's own `env`, and a hand-written one is a `DOSSIER_UNUSED_KEY` warning.
  - **`dossiers env` takes `link`'s flags plus `--default`.**
  - **`dossiers remove` exists for #56's Delete**, CLI only, and only touches your own folder.
  - **The MCP write rule asks the call's own resolver** (`dossierConnection`), through `connection`, `host` and every input that selects a connection, for no repo and each of the dossier's repos. A non-default environment's binding is allowed, since a call reaches it only with an explicit `--env`, which picks the connection itself.
  - **`dossiers.replace` is kept as an exception to `files.no-overwrite`** (the maintainer's condition: only where a person asked to replace a file). An edit rewrites the dossier it read. `import --replace` and `export --replace` replace a dossier only with the flag. A file that isn't a valid dossier is never replaced.
  - **Export to `--file` stays inside the workspace or a dossier folder**; `--repo` must be a working tree's root.
  - **Your own copy of a checked-in dossier wins wherever the checked-in one applies**, even when it lists no repos, so `import` adopts in the repository it came from.
  - **`repos scan` is a `config` command on the dossier catalog**, capped at 20,000 folders, saying `truncated` past that.
  - **Field aliases go through the area's existing `--field`** (Jira, Jira Cloud), asked for only when the call names a field; a name the connection already uses keeps the connection's meaning.
  - **A fixture can carry a `dossier`** for its area's `check-dossier`, holding only keys the other examples don't read.
- **Checks for every area (the last #16 PR):**
  - **`check-dossier` reads values as a call does**: the area's own section and the call's environment's only (`--env`, else the dossier's `env`), with a key the environment sets shadowing the area's own. Another environment's section may select another connection, so it's checked by a call in that environment. The result names the environment it checked.
  - **Values that belong together pair up per repo, across sections** (`viewScopes`): a repo with its project (bitbucket, ado) or owner (github), the environment's section first.
  - **A value that can't be looked up is `unchecked`**, with a `DOSSIER_UNCHECKED` warning and `ok` false: a repo with no project or owner, a deployment with no namespace, an ado value with no collection (the dossier's, else the call's). Never skipped (principle 4), and not a refusal, which would block checking the rest.
  - **openshift checks a namespace as a project** (`project.openshift.io`), which an ordinary token can read; the namespace object needs cluster rights. Deployments take their namespace as a call finds it.
  - **Only not-found counts as missing**, in every area. Any other failure (a bad token, an unreachable host) fails the command, rather than reporting every value missing.
  - **Fixtures keep the dossier out of other examples** by giving context inputs per repo: no example's folder is that repo, so only `check-dossier` sees them.
- **Windows authentication** (`auth: "windows"`, #165): the alternate account reuses
  `user` with a new `domain` key, not a separate `username`. A provider `check` hook
  (run by the area schema's `superRefine`) requires `user` for SQL logins and refuses
  `auth: "windows"` off Windows; the reason is in the error's `details`, since core's
  message names only the key.
- **tedious is patched at runtime, not vendored or patched at bundle time**: a
  marked connection is configured as `ntlm`, and `sendLogin7Packet`,
  `performSentLogin7WithNTLMLogin` and the token parser are wrapped once, for marked
  connections and short Negotiate tokens only. A test fails if a tedious upgrade
  renames any of them. Where: `src/core/db/sqlserver/windows-login.ts`.
- **The SSPI helper** (`src/os/windows-sspi.ts`) is Windows PowerShell 5.1 by absolute
  path, with its script and every token on stdin, `ISC_REQ_CONNECTION` only (no
  mutual authentication), an allowlisted env, and the SPN `MSSQLSvc/<host>:<port>`
  as configured (the docs say to use the FQDN). It starts only after the
  `Connection` is built.
- **Constrained Language Mode is `AUTH` with a message naming the mode**, not a new
  error code.
- **Spawners are one reviewed list**, `scripts/spawners.mjs`, read by tsup, `check:pure`
  and ESLint.
- **Windows authentication is documented as `untested`** until it runs against a
  domain; the provider stays at `integration` for SQL logins.


### Oracle

- **`oracledb` 7.0.1 in Thin mode only**, built from the driver's and Oracle's docs
  with no contract, at verification level `integration`. ESLint refuses
  `initOracleClient`, the one way into Thick mode, and a test shows no native addon
  loads.
- **`database` is the service name, and nothing else.** toil builds the connect
  descriptor itself from `host`, `port` and `database`, so it reads no
  `tnsnames.ora`, `sqlnet.ora`, `TNS_ADMIN`, wallet or config provider. SIDs and TNS
  aliases aren't supported, and a host or service that could add a clause to the
  descriptor is `CONFIG_INVALID`. TCPS gets the OS certificate store through
  `trustOsStoreByDefault`, since Thin mode's TLS takes no `ca` option.
- **`DbProvider.defaultSchema` is a function of the connection**, because Oracle's
  default is the login's own schema. Names are reported as Oracle stores them
  (upper case unless quoted), and a schema or table not found as typed is looked up
  again in upper case.
- **Reads run in `SET TRANSACTION READ ONLY`, rolled back.** ORA-01456, ORA-28193 and
  ORA-16000 are `WRITE_DISABLED`. DDL on a read is refused as `WRITE_DISABLED`,
  because Oracle commits DDL inside a read-only transaction. PL/SQL (`BEGIN`,
  `DECLARE`, `CALL`, `WITH FUNCTION` / `WITH PROCEDURE`) is refused as
  `INVALID_INPUT`, because a block can commit or run an autonomous transaction. Each
  keyword is proven to write through a read-only transaction in
  `test/db/oracle.test.ts`.
- **No session-level read-only.** 23ai's `ALTER SESSION SET READ_ONLY` would close
  more holes, but 19c, where most enterprises are, doesn't have it. One mechanism
  plus the proven denies is the simpler choice.
- **Dates are exact strings**, read from the wire bytes rather than the local-time
  `Date` Thin mode builds. Thin mode formats dates on the client, so session NLS
  formats can't apply. The shape is PostgreSQL's and MySQL's:
  `2026-01-02 03:04:05.123456`, `+02` / `+05:30` for a zoned value, and `+00` for a
  named region or `WITH LOCAL TIME ZONE`.
- **The commit claim on a failed `db execute`:** toil names statements as committed
  only when it knows they are: DDL that ran, or a change followed by a closed
  transaction (`DBMS_TRANSACTION`). After any PL/SQL block or `CALL` ran, the
  failing one included, or when that check fails, the error says the statements up to the
  failure may have committed. "Nothing was applied" is said only when nothing could
  have committed. `COMMIT`, `ROLLBACK`, `SAVEPOINT` and `SET TRANSACTION` are refused
  before any of the script runs.
- **The image is pinned to `gvenzl/oracle-free:23.26.3-slim-faststart`**, a CI
  service in `Databases (integration)`. It is healthy in about a minute, and the
  Oracle target sets a 30 s test and hook limit for slow runners.
- **Known limits, pinned by tests and documented:**
  - A stored function with an autonomous transaction still writes when a `SELECT`
    calls it.
  - DDL commits mid-script, and a block can commit inside one.
  - Thin mode's in-band break can't wake `DBMS_SESSION.SLEEP`.
  - `AUDIT` isn't denied, because the escape can't be proven without audit
    privileges.
  - Only 23ai has been run.

### toil wait and MCP resources (#97)

- **A wait isn't a command `execute()` runs; its attempts are.** `runCommand()` hands
  a command marked `dispatches` to `runWait()` (`src/core/wait.ts`), which checks the
  wait's own input and then calls `execute()` for the read once per attempt. So each
  attempt has its own validation, connection, time limit, cancel and audit line, and
  the wait itself writes no line of its own (a refused wait, like a refused argv,
  records nothing). The envelope is the last attempt's, with `meta.wait` (`until`,
  `attempts`, `elapsedMs`) added and `durationMs` covering the whole wait, so
  `meta.command` names the read and `meta.context`, warnings and `--verbose` requests
  are the read's. A refusal before the first attempt has `meta.command: "wait"`.
- **Defaults and limits:** `--interval` 15s, floor 5s; `--timeout` floor 5s (an
  explicit one under it is `INVALID_INPUT`), default 30m, or
  `TOIL_TIMEOUT_MS` when it's set and `--timeout` isn't; the maximum is
  `"wait": { "maxTimeout": "<duration>" }` in the config file (default 1h, allowed 1m
  to 24h), read from whichever file loaded, like `bounds`, with no env var: it limits
  how long a caller may keep asking a service, so it is a person's setting, as a
  relaxed bound is (principle 5 still holds for `TOIL_TIMEOUT_MS`, which sets the
  default). A `TOIL_TIMEOUT_MS` above the maximum is cut to it with a
  `WAIT_TIMEOUT_CAPPED` warning naming both, not refused, since it's every command's
  default rather than this wait's request. A `--timeout` over the maximum is
  `INVALID_INPUT` naming the setting. Durations are `<n>ms|s|m|h` text on both doors.
- **Each attempt keeps its own limit** (the read's `timeLimitMs` or 120 s), cut to the
  time the wait has left. An attempt that times out while the wait still has time is
  retried like `NETWORK`; one cut off by the wait's deadline ends it as the wait's
  `TIMEOUT`.
- **Transient means** `NETWORK`, `HTTP` with status 429 or 5xx, and that attempt
  timeout. There's no `RATE_LIMITED` code; a 429 that outlasts `restRequest`'s own
  retries is `HTTP` 429. Backoff doubles the interval per consecutive transient
  failure, capped at the larger of the interval and 5 minutes, and resets on success.
- **`TIMEOUT` and `CANCELLED` carry the last data in `error.details.data`**, since a
  failure envelope's `data` is always null.
- **Writes are refused by definition and by input**: a `writes` command, or a
  `writesWhen` command whose input writes (`<area> api POST`), is `INVALID_INPUT`. A
  passthrough GET can be waited on.
- **What a wait can repeat:** on the CLI any command but a CLI-only one or another
  wait; over MCP only the tools that server lists, so `--areas` scopes it. The MCP
  `wait` tool is served whenever a read tool is, `--areas` or not.
- **CLI shape:** the command after `--` is parsed by the same program in a capture
  mode, so it takes exactly its own flags and reaches core as `{ tool, input }`, as
  MCP sends it. `--select` after `--` is the read's (so `--until` sees it); before
  `wait` it applies to the final data. Other global flags after `--` are
  `INVALID_INPUT` ("goes before wait"), never ignored. The parity suite maps
  `tool`/`input` through `argvFor`'s wait form rather than flags.
- **Progress:** MCP sends `notifications/progress` after each attempt that doesn't end
  the wait, only when the call carried a progress token; the CLI writes the same line
  to stderr.
- **Resources:** `toil://connections` is name, area, `isDefault` and `writes` (no host:
  a host isn't a secret, but the issue asked for names and areas, and less is safer).
  `toil://dossiers[/<name>]` run the `dossiers list` / `show` commands through
  `runCommand()`, so they match the tools exactly and are served only when those
  tools are; reading one writes an audit line, as the tool would. A dossier resource
  takes a name only, checked against the dossier-name rule (`CONNECTION_NAME`) before
  the catalog sees it, so no spelling of a path (`x.JSON`) is ever read as a file. `toil://skill/<area>` serves `skills/toil/<area>.md`,
  built into the bundle as `src/skill-pages.generated.ts` by `scripts/gen-areas.mjs`
  (gitignored, about 220 KB), for each area the server has a tool for, or exactly
  `--areas`. A resource that fails or doesn't exist is an MCP `InvalidParams` /
  `InternalError` with toil's message and fix.
- **`dossiers` commands already on main** cover the dossiers resources, so nothing
  waited on #164.

### The `util` kit (#175 to #184)

- **What's shared, and only that:** a piece goes in the kit when two or more of
  the ten `util` issues need it, or an issue asks to reuse it. The input reader
  and self-verification serve all ten; XML serves `report` and `md`; YAML serves
  `openapi` and `size`; JSON Schema serves `md` and `openapi`; the secret rules
  serve the audit log and `secrets scan`; the version comparison serves
  Artifactory, `deps diff` and `semver`. Entropy, time zones, cron, certificates,
  hashing and code outlines stay with their one command.
- **Where it lives:** what only `util` commands use is in `src/areas/util/kit/`;
  what core or another area uses too is in `src/core/` (`secret-shapes.ts`,
  `versions.ts`, `files.readStream`). Conventions are `docs/util.md`.
- **XML is built in** rather than a dependency, as JMESPath and strict JSON are:
  the reports and storage format need elements, attributes, text, CDATA and five
  entities, streamed and with positions. The candidate library, fast-xml-parser,
  now has six dependencies of its own and doesn't stream. Not processing DTDs at
  all is what keeps entity expansion and external fetches out.
- **YAML is js-yaml 5.4.2** (MIT, pure JS, about 95 KB in the bundle). 5.4.3 and
  5.5.0 were under 14 days old. The `yaml` package is ISC, outside the
  MIT/Apache/BSD list. js-yaml depends on argparse (Python-2.0) for its own
  command-line tool only; nothing toil bundles imports it, which a build check
  confirmed.
- **JSON Schema is @cfworker/json-schema 4.1.1** (MIT, no dependencies, about
  43 KB). zod can't validate a document against an arbitrary schema. ajv already
  ships inside the MCP SDK, but it reads draft-07 only out of the box: ADF,
  Swagger 2.0 and OpenAPI 3.0 are draft-04 and OpenAPI 3.1 is 2020-12, which
  would take `ajv-draft-04` plus `Ajv2020` for about the same size. cfworker reads
  all four drafts with one class and interprets schemas instead of generating
  code.
- **Lazy loading is a convention plus an ESLint rule**, not a build change: the
  bundle stays one file, and esbuild evaluates a module reached only through
  `import()` on first use. Neither library is in the bundle until a command
  imports its wrapper, so this PR adds nothing to `dist/toil.js`.
- **stdin is held in memory, capped**, because a self-check has to re-read it; a
  file streams. A line longer than 64 KiB is cut and marked rather than held.
- **`findSecrets` reads the original text** and reports each secret's own
  characters; the long-random rule reads it with the other rules' matches blanked,
  which is what `redactText`'s order amounts to. A test holds the two to the same
  answer on every sample.
- **YAML aliases are counted, not refused**: real OpenAPI documents reuse anchors,
  so `parseYaml` counts only what aliases add beyond the document as written, and
  refuses a document where that passes 1,000,000 values (`INVALID_INPUT`). A
  document without aliases is held by the input cap alone. js-yaml has no switch
  to reject aliases, and the count also stops a cycle.

### util encode (#182)

- **One command, the scheme as its first argument:** `toil util encode <scheme>`,
  with `--decode`, and the three hashes as schemes too (`util encode sha256`), rather
  than a command per scheme or a separate hash command. One MCP tool, `util_encode`.
- **`--out` follows `git report --out` and the attachment downloads:** a new file
  inside the workspace through `ctx.files.writeBytes`, which never overwrites, and
  `writes: false`. It changes nothing outside this machine, which is what the
  `--allow-write` gate is for, and a standalone command has no connection to hold
  `writes`. The file is read back and compared (`output.file`).
- **Decoded bytes that aren't valid UTF-8 are refused without `--out`**
  (`INVALID_INPUT`, the fix naming `--out`), rather than returned as base64 or hex.
  The caller asked for a decode; a second encoding they didn't ask for would be a
  guess. Valid UTF-8, NUL bytes included, is returned as text, since JSON carries
  it unchanged.
- **The decoders are strict where Buffer is lenient:** a character outside the
  alphabet, misplaced padding, an impossible length, an odd number of hex digits or
  a `%` without two hex digits is `INVALID_INPUT`, naming the offset but never the
  character. Whitespace is ignored in base64 and hex (MIME wraps lines), and one
  trailing line ending is dropped before any decode.
- **Normalization for the re-encode check** is whitespace, padding (base64 padded,
  base64url not, as each is written), hex and `%XX` case, and `%20` for `+` in a
  form. Anything else that decodes but doesn't re-encode the same (base64 `QR==`, a
  raw space in a URL) fails `roundtrip.encode` and warns `ENCODE_ROUNDTRIP_MISMATCH`;
  the decoded result is still returned, as the kit reports rather than refuses.
- **`url` is `encodeURIComponent`'s set** (`-_.!~*'()` unescaped), so what
  JavaScript writes reads back unchanged; **`form`** is the WHATWG
  `application/x-www-form-urlencoded` set. Both work over bytes, so input that isn't
  UTF-8 encodes too.
- **A file hash has no size cap**, since it streams; stdin and encode/decode keep
  the reader's 64 MiB. A hash whose read stopped short still returns its digest,
  with `input.complete` failed, `verified.passed` false and `INPUT_INCOMPLETE`, as
  the kit reports every failed check.
- **Kit addition:** `utf8: 'skip'` on the input reader, so a command that treats
  content as bytes doesn't warn `INPUT_NOT_UTF8` about bytes it never shows as text.
- **The work isn't lazily loaded.** `encode/run.ts` reads through `kit/input.ts`,
  which imports zod, and reaching zod through `import()` made esbuild defer zod's
  setup, so the built bundle failed at startup (`toil version` included) while
  every unit test passed. It's small and uses only Node built-ins, so it's a
  static import; `docs/util.md` now warns about the trap under Lazy loading.
- **The audit log keeps only a hash of `text`** (`auditInput`), since the content
  may be a credential on its way into a header.
- **The utilities page shows a short path only for `jwt` and `deps`,** the commands
  that have one, instead of assuming every `util` command does.
