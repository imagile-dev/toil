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

### Two Weeks' Notice

The welcome menu's game (#198), which replaced brick breaker. A turn-based roguelike:
a developer climbs five floors of bureaucrats and MUNDANE's robots to hand in their
notice. `src/welcome/rogue/`.

- **Brick breaker is gone, not kept beside it.** Real-time play in a terminal is a
  coarse grid with key-repeat lag, so the paddle never felt good. A turn-based game
  avoids all of that, and one game is enough for a menu.
- **It is hidden.** No menu row: typing `resign` on the home screen opens it. The
  site's welcome page says only that there may be something else in the menu.
- **Rules are pure and seeded** (`start`, `act` in `game.ts`), with every random draw
  from a seed the game carries, so a run replays from its seed and keys. Two bots in
  the tests play whole runs. The balance test pins the spread: careless wins about
  6 in 30, careful about 18, careful with every benefit about 26.
- **Effects are data, not timers.** `act` lists what happened (`fx`) and queues cards;
  the renderer animates them as pure functions of a tick count, and the loop only
  advances a 30 ms clock. Nothing in the game moves on its own.
- **Progress is sealed in the user's config**, under `"game"`, with AES-256-GCM and a
  key derived from the account name and home folder. That is tamper-evidence, not
  secrecy, and the code says so. A save that fails to open starts fresh with a notice;
  an older (version 1) config file is never rewritten for a game, so progress isn't
  kept there and the lobby says why. `"game"` is a reserved config key, so loading
  config elsewhere never warns about it.
- **Benefits Enrollment opens on "Take the stairs again"**, selected, so Enter starts
  the next run; the perks sit below it. A first playtest found the way on from the
  shop hard to see when starting a run was only a key named in the footer.
- **Quitting mid-run forfeits it.** PTO is booked when a run ends, win or lose, and
  saved at once, so closing the menu loses nothing already earned.
- **The cast is context-overflow.dev's**: MUNDANE, MAVERICK and the five robots, used
  with the maintainer's blessing, since both sites are imagile's.
- **Playtested in a real console**, through ConPTY with a screen-reading bot, not only
  through the fake terminal in the tests; that found the overlapping card border and
  the robots named with "the".

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

### bitbucket-cloud

Bitbucket Cloud (#201), built from Atlassian's REST API 2.0 reference with no live
workspace. `bitbucket` (Data Center) is untouched.

- **Credentials: one per connection.** `apiToken` with `email` (Basic) or
  `accessToken` (Bearer); both set is `CONFIG_INVALID`, rather than toil picking one.
  The API token isn't shared with `jira-cloud`/`confluence-cloud`: a Bitbucket API
  token is created with Bitbucket scopes, so pairing would mostly pair the wrong token.
- **410 is AUTH, and Bitbucket's error body is read**, through two additive request
  hook options in core (`authStatuses`, `errorMessage` on `AreaEndpoint` and
  `RestOptions`). Unset, nothing changes for any other area; the obvious fix of
  teaching core's common error reader `{ error: { message } }` would have changed
  Dynatrace's recorded behaviour (#83 item 1). The passthrough gets both too.
- **`baseUrl` is required and includes `/2.0`** (`https://api.bitbucket.org/2.0`),
  given as an example, never a default: no hardcoded hosts.
- **Workspace is `--ws`**, as `splitio` does, because `--workspace` is core's.
- **CI fallbacks are `BITBUCKET_WORKSPACE` and `BITBUCKET_REPO_SLUG`**, which Pipelines
  sets on every step. Pipelines sets no API credential, so the tokens have none.
- **No git remote parsing.** Workspace and repo come from the flag, a dossier or the
  connection. A parser for `bitbucket.org` remotes would mean a host mapping
  (`api.bitbucket.org` to `bitbucket.org`) for one convenience; left out as the
  simpler option. `current-pr` reads only the branch from `.git`.
- **No `check-dossier`, `create-prs` or `add-reviewer`.** Cloud has no single-reviewer
  endpoint (`update-pr --reviewers` replaces the list), and the batch and dossier
  commands weren't in the issue's list. `list-default-reviewers` returns Cloud's plain
  list of users, since Cloud has no default-reviewer conditions.
- **`needs-work` is `request-changes`**, Cloud's name, with no alias.
- **Paging follows the `next` link**, which Atlassian calls opaque, but only when it's
  on the connection's origin and the same path as the first request; the same check
  applies to a `--cursor`. Lists read everything by default, as `confluence-cloud`'s
  do, except `list-commits` and `list-pipelines`, which default to the newest 100.
- **`diff --pr` and `list-files` build the spec from the PR** (`source..destination`,
  `topic=true`) instead of following `/pullrequests/{id}/diff`'s redirect, which may
  drop `path` and `context`. A fork's PR isn't covered; the skill says so.
- **`get-file` and `list-dir` resolve a branch or tag to a hash** with
  `commits?include=<ref>&pagelen=1`, because a branch name with `/` can't go in the
  `src/{commit}` segment. `list-commits` sends the branch as `include` for the same
  reason.
- **`update-pr` resends the current title, description and reviewers**, since it's
  unclear whether Cloud's PUT clears what's left out.
- **`merge-pr`** maps `--delete-branch` to `close_source_branch`, takes Cloud's
  strategy names only, sends no `type` field, and answers a 202 with
  `{ pending, taskStatus }` and a warning instead of polling.
- **The board status is `unit`**, toil's lowest shipped level, which is what "untested"
  means here: no live instance.
- **The fixture serves two items a page** whatever `pagelen` asks, so the parity
  suite follows `next` links on every list with more than two items.

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

### util semver (#180)

- **Four commands, not six:** `compare` (which also answers "diff two", as
  `difference`), `satisfies`, `sort` (which, with `--range`, also gives the
  versions that satisfy it and the highest), and `bump`.
- **One home for comparisons, two behaviours:** `compareSemver` in
  `src/core/versions.ts` stays exactly as `artifactory outdated` and
  `util deps diff` recorded it (prereleases as plain text, quirks included).
  The ecosystems' own grammars sit beside it behind one interface,
  `VersionGrammar`, in `src/core/versions/` (npm, NuGet, Maven), loaded only
  through `grammarFor`. No dependency: node-semver is ISC (outside the
  MIT/Apache/BSD list), and NuGet and Maven have no JavaScript library at all.
- **npm follows node-semver's strict mode exactly**, desugaring included, and
  passes its range-include, range-exclude, range-parse, comparison, equality,
  valid, invalid and increment tables. Loose mode (73 rows across the tables)
  is left out on purpose, since it coerces text into versions; so is `inc`'s
  identifier base (34 rows). `includePrerelease` is offered as
  `--include-prerelease`. One deliberate difference: numeric prerelease
  identifiers compare by value at any size, as SemVer 2.0.0 says, where
  node-semver stops at 2^53.
- **NuGet follows NuGet.Versioning** (`NuGetVersion.TryParse`,
  `VersionComparer.Default`, `VersionRange.TryParse` and `Satisfies`).
  Floating versions (`1.*`) are refused: their meaning depends on a feed. A
  prerelease inside a range's bounds satisfies it, as `Satisfies` has it; the
  restore-time rule that skips prereleases is resolution, not a range.
- **Maven follows Maven 3.9's ComparableVersion and VersionRange**, but
  ComparableVersion orders any string, so here a version is letters, digits,
  `.`, `-`, `_` and `+` with at least one digit. A bare version is a soft
  requirement any version satisfies (as Maven has it), with a
  `MAVEN_SOFT_REQUIREMENT` warning.
- **`difference` uses one rule everywhere:** the most significant part that
  differs (`major`, `minor`, `patch`, `revision`, then `prerelease` or
  `qualifier`), not node-semver's `premajor`-style answers.
- **Bump:** npm is `inc` without the identifier base. NuGet and Maven take
  major, minor and patch only; NuGet drops the revision and labels, Maven
  bumps the leading numbers and drops the qualifier.
- **Self-checks:** `sort.transitive` checks every pair of the sorted list up
  to 2,000 versions (about 2 million comparisons), and neighbours only past
  that, reported as `APPROXIMATED`. Range answers are checked against the
  range's intervals, which each grammar works out by comparison alone, at
  the boundary versions and at every version asked about. For NuGet and
  Maven, whose ranges are intervals already, that check is close to the
  computation itself; it's still run, and a test shows it catching a broken
  `satisfies`.
- **The run module is a static import** (#188: a lazy module that imports
  zod breaks the bundle). Only the grammars, which import nothing, are lazy.
- **The utilities page** shows each command's short paths from the registry:
  the generated `site/src/data/commands/<area>.json` gains an `aliases` field,
  present only on commands that have one.
- **A Maven or NuGet version is at most 256 characters**, as an npm one is.
  Maven's parse nests one list per letter-digit switch, so a long `1a1a…` would
  otherwise recurse past the stack when compared.

### util secrets scan (#178)

- **One input field for a file or a folder.** The path argument (`file` over
  MCP, the kit's field) takes either; a folder is walked with `ctx.files.list`.
  `--diff staged|working` is the third input, and two at once is refused.
- **"Working tree" means `git diff`**, the unstaged changes, as git uses the
  words; `staged` is `git diff --staged`. Both run with `--unified=0
  --relative` and fixed prefixes, and only added lines are scanned. Untracked
  files aren't in either, so `working` counts them in a warning rather than
  scan them.
- **Findings exit 1 with `ok: true`** (`ctx.setExitCode`), as a failed build
  does, so the findings stay in `data`. The parity examples allow-list every
  sample secret so they exit 0, which the suite requires; the tests with
  findings cover exit 1 through both doors.
- **Fingerprints are a salted scrypt** (N 2^14, 16 bytes, four groups of 8
  hex), not a SHA-256: a hash of a short password in a CI log is a lookup
  away from the password. About 20 ms per distinct value. The value alone is
  hashed, not its path, so one allow entry covers a test value wherever it
  appears. Four hex groups don't look like a secret to the shared rules, so the
  allow file scans clean.
- **The allow file defaults to `.toil/secrets-allow`**, beside `.toil/dossiers/`,
  one fingerprint per line. A line that isn't one is reported by number only.
- **Previews keep 4 characters at each end from 24 characters, 2 from 16, none
  below**, and a preview that fails its own check is replaced by `…`.
- **Set aside and counted, not reported:** SRI checksums (`sha512-…`), which
  every npm lockfile is full of, and values that are references
  (`${{ secrets.X }}`, `$VAR`, `<token>`, `xxx`), which every CI workflow is.
  Without both, a staged lockfile or workflow change would always fail the gate.
- **Entropy stays in this command** (per the kit decision): a `high-entropy`
  rule for base64 runs of 20 or more the shared rules don't reach (they stop
  at `/` and `-`), at 4.2 bits per character, and a `confidence` on every
  finding. `findSecrets` itself is unchanged.
- **Line by line**, with 4 MiB lines and 64 MiB files; a private key whose END
  is on a later line is one finding with `endLine`. Longer lines and files are
  listed in `unreadable`.
- **A single named file that can't be read fails the call** (`INVALID_INPUT`, as
  every kit reader does); inside a folder it's listed in `unreadable` instead.
- **Planted test tokens are joined from pieces** (`plant('AKIA', '…')`) in the
  tests and samples. GitHub's push protection refuses a commit holding a whole
  vendor-shaped token, invented or not, and bypassing it is a human's call.


### util report (#175)

- **One of `tests`, `findings` and `coverage` is filled in, the other two are
  `null`**, so every format returns the same keys and a caller branches on which one
  is set rather than on `format`.
- **Totals are always the recount.** The report's own figures are only what the
  checks compare against, so a report that lies about its totals still gets a true
  summary, plus the warning.
- **No JUnit "variant" field.** Surefire, Jenkins and Azure DevOps reports differ in
  where totals sit and which extra elements appear, not in how a case passes or
  fails, so one reader takes all three and nothing is guessed about which tool wrote
  the file.
- **Surefire's `flakyFailure`/`flakyError` count as passed**, as Surefire's own
  `failures` count and Jenkins treat them, and are also counted in `flaky`.
- **A failure's file and line come from the stack when the report states none**:
  the first frame naming the test's class or method, else the first frame that isn't
  a framework or runtime one. Each such failure says `location: "stack"`, and an
  `APPROXIMATED` warning gives the count.
- **TRX:** only top-level results are counted (a data-driven test's inner rows
  aren't), since that's what `<Counters>` counts. `executed` isn't compared, and a
  counter declared 0 over results that have its outcome is `UNVERIFIED` rather than
  failed, because VSTest leaves `notExecuted` at 0 when tests are skipped. A real
  `dotnet test` report would otherwise fail its own check every time it skipped one.
  Outcomes map to totals as `Failed` to failures, `Error`/`Timeout`/`Aborted` to
  errors, `NotExecuted`/`NotRunnable` to skipped, and the rest to `other`.
- **A Cobertura rate is allowed one unit in its last written decimal place** (half a
  ten-thousandth for a whole number such as `"1"`), which covers writers that round
  (coverlet, coverage.py's `%.4g`) and ones that truncate, without accepting a rate
  that is really wrong.
- **Cobertura lines are counted from each class's `<lines>`**, and classes that share
  a file are added together, which is what the root's `lines-valid` sums. The copies
  under `<methods>` are read past.
- **lcov records for the same file are merged**, a line covered when any record hit
  it. The checks run per record, against each record's own figures.
- **SARIF is read whole**, within the 64 MiB input cap, because the kit has no
  streaming JSON reader and SARIF has no line structure to stream by. The cap is
  reported as `INVALID_INPUT`. SARIF declares no totals, so `findings.totals` is
  always `UNVERIFIED`; what is checked is that each `ruleIndex` points at the rule
  its `ruleId` names.
- **At the size cap, a streamed report is summarised up to the cut** rather than
  refused: `INPUT_TRUNCATED` and a failed `input.complete` say it's partial, and a
  suite the cut left open isn't compared against its declared totals.
- **Known parts that hold nothing summarised aren't "skipped"** (`system-out`,
  `properties`, TRX's settings, lists and output, Cobertura's `<methods>` and
  `<conditions>`). Only an element the reader doesn't know is counted in
  `data.skipped`, so the count means something.
- **No kit addition.** The input reader, `Verifier` and the streaming XML reader
  covered everything.
- **The readers are a static import, not `import()`**, because they reach zod
  through `kit/input.ts`, and a lazily loaded module that does breaks the built
  bundle at startup (found on #188). They have no dependency of their own.

### util cert (#181)

- **A small built-in DER reader, no ASN.1 dependency.** `node:crypto`'s
  `X509Certificate` gives every field the issue lists except two: the key usage
  bits (its `keyUsage` is the extended key usage) and the basic constraints' path
  length (it gives only `ca`). `src/areas/util/cert/der.ts` reads just the
  certificate's outline, serial and extensions, about 150 lines, rather than adding
  a library that reads all of ASN.1. It also splits DER bundles. Its serial and CA
  flag are checked against Node's on every certificate (`decode.matchesNode`).
- **The chain is checked in the order given, leaf first**, as servers send it. The
  signature check runs only on links whose names match; a link whose names don't is
  already a `chain.order` failure, and there's no issuer to verify against. When
  the bundle is one chain in another order, the right order is suggested.
- **No trust store.** A bundle whose last certificate is self-signed ends at its
  root (`chain.root: included`); one whose last issuer isn't in the bundle is
  `UNVERIFIED`, never assumed. Checking against the system's or Node's roots would
  make the answer depend on the machine.
- **`--host` matches SANs only, as browsers do**, never the subject CN, with
  single-label wildcards and no partial ones (`f*.imagile.dev`). It checks the first
  certificate.
- **No alias.** The three older commands keep their top-level paths because they had
  them; `cert` never did, so it's `toil util cert` only.
- **A private key in the input is skipped unread**, with its own warning, and a PEM
  block that isn't a certificate is skipped and named rather than refused, so a
  `fullchain.pem` with a key beside it still decodes.
- **Test certificates are made per run** (`test/harness/x509.ts`, a DER writer that
  signs with keys generated in memory), so none expires and no key is committed. The
  real public chains are two cross-signed CA certificates and the roots that signed
  them (`test/fixtures/certs/`), exported from a Windows intermediate store and
  Node's bundled roots: public CA certificates, with no host of anyone's. The text
  example is a self-signed Ed25519 certificate for `example.imagile.dev`, valid to
  9999-12-31, whose key was discarded.
- **The lazy module stays free of zod.** `cert/decode.ts` and what it loads
  (`core/errors`, `kit/verify`, `cert/der`) import no zod; it takes `UtilInput` as a
  type only, and `cert.ts`, which imports `kit/input`, is static. A lazily loaded
  module that reaches zod breaks the built bundle, which only `npm run smoke` shows.
- **Kit:** none in the end. DER input is read with `binary: 'allow'` and
  `utf8: 'skip'`, the switch `util encode` added, rather than making `binary`
  silence the UTF-8 warning too: one switch per check.

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
- **A SARIF rule reference whose `toolComponent` can't be found by index** (named
  only by `guid`) leaves `sarif.ruleIndex` `UNVERIFIED` and the level at the spec's
  fallback, rather than guessing which component it means (review of #191).

### util log (#176)

- **Lines with no level are counted, not grouped.** "Couldn't classify" means a line
  with no level word and no error or warning shape (a `[Pipeline]` step, a shell
  echo). They're `lines.unclassified` in `data` and one `LOG_UNCLASSIFIED` warning;
  `--context` shows the ones around each sample.
- **Signatures keep paths, quoted names and error codes.** Only dates, times, UUIDs,
  hex and numbers are replaced, as the issue lists. `CS0246` and `TS2322` keep their
  digits (no word boundary before them), so two compiler errors in one file stay two
  groups; the same warning on two properties stays two groups as well.
- **A trace is reported for each group's first occurrence**, up to 50 lines, and its
  text comes from the re-read pass, so the streaming pass holds only line ranges. A
  later occurrence's trace is counted as stack lines.
- **An exception line directly after an error joins that error's trace** (Maven's `-e`
  trace under `[ERROR] -> [Help 1]`, a JUnit failure under surefire's `<<< FAILURE!`);
  with no error just before it, or after a warning, it's an error of its own (review
  round 1 on #190). Up to 8 lines with no level
  may sit between an error and its first frame, for vstest's message block.
- **Memory is bounded by a cap on distinct signatures (2,000), not by the log.** Matched
  lines past it are counted as `ungrouped` with `LOG_UNGROUPED`, and the sum check
  includes them. Lines are cut at 4,096 characters for grouping (`APPROXIMATED`).
- **A file streams with no size cap**; stdin and text keep the reader's 64 MiB cap,
  since they're held in memory for the re-read.
- **Order:** errors first, then warnings, each by first appearance, because the first
  error is usually the cause. `--max-groups` defaults to 50.
- **`--since`:** a line with no date takes the last date before it; lines before any
  date are kept and counted (`LOG_SINCE_UNDATED`). Times without a zone are read as
  UTC and marked `APPROXIMATED`. Time-only prefixes (`09:12:01`) carry no date and
  don't count.
- **`--level` is a floor** (`warning`, the default, or `error`), and **`--grep` is a
  case-sensitive JavaScript regex** on the whole line, with no flag syntax. An error
  line also matches by the exception line that heads its trace, since that's where
  the exception's name is; frames aren't searched, and `LOG_GREP_STACK_ONLY` says
  when only they matched (review round 1 on #190).
- **No short alias.** `util log` is new, so it has only its `util` path.
- **The work is lazily loaded, with zod kept out of it:** `log.ts` opens the input
  (`runLog`) and `log/triage.ts` imports only types from `kit/input.ts`, so the
  triage code stays out of startup without tripping the trap #188 found.

### util size (#184)

- **Code intelligence: the maintainer's framing (2026-10-18).** The
  `code-intelligence` decision is about heavy dependencies, not code intelligence:
  small pure-JS code intelligence is welcome, and the TypeScript language service
  or compiler at runtime, tree-sitter WASM grammars, ast-grep, Pyright and IDE
  bridges are what's ruled out. Reopening is needed only to add one of those. The
  skill now says so and cites this outliner as an example that fits.
- **Code outlines are a pure-JS syntactic scan, not the TypeScript compiler.**
  `typescript.js` is 9.1 MB unminified, more than the whole bundle today, and is
  one of the heavy dependencies the `code-intelligence` skill rules out. A small
  lexer per language (comments and every string form skipped) plus brace matching,
  or indentation for Python, finds functions, classes, types, methods and exported
  names. The tests hold the TypeScript and JavaScript outlines to the compiler's
  syntax tree (a devDependency, never shipped); on toil's 424 own source files they
  agree on every symbol and line, and on 1,500 random `node_modules` JavaScript
  files they differ on 6 symbols in 5 files, all compiled or minified code (mostly a
  constant set to an immediately invoked function, which the scan calls a function). Each result
  says `precision: "syntactic"` and warns `APPROXIMATED`.
- **Tokens are `ceil(characters / 4)`** in Unicode code points, the simplest
  estimate, stated in `tokenMethod` and warned `APPROXIMATED`. No tokenizer is
  bundled.
- **Folders get counts, not outlines.** A per-file outline of a whole tree would be
  larger than reading it. `largest` gives each file's language, and one `size` call
  on a file outlines it.
- **The folder tree stops at `--depth` (default 3)**, with deeper folders still in
  their parent's totals and `foldersHidden` counting them, so a large repository
  doesn't produce a tree bigger than its files. `--top` defaults to 10.
- **One input field, `file`, takes a file or a folder**, so the kit's input reader
  (`file`, `text`, stdin) is reused unchanged. `language` with a folder, and `top` or
  `depth` with a file, are `INVALID_INPUT` rather than ignored.
- **A binary file in a folder is sniffed, not read**: the first 8,000 bytes through
  `ctx.files.readStream`. It counts in files and bytes (from its size), with null
  lines and tokens, and isn't sent through the reader, which would warn
  `INPUT_NOT_UTF8` for every image in the tree.
- **Files are counted with no size cap** (counting streams); only stdin keeps the
  reader's 64 MiB cap. Outlines skip files over 8 MiB with `too-large`.
- **A parse error is a reason, not a failure**: the counts still come back, with
  `notOutlined.reason: "parse-error"`, the line, and a `SIZE_PARSE_ERROR` warning.
  A JSON error gives line and column only, never V8's quote of the text.
- **The measuring module is imported statically**, since it reads input through
  `kit/input.ts` and so zod (#188's finding); the outliners load through `import()`.
- No kit additions.

### util time (#179)

- **Intl only, not Temporal.** Node 24.14 has no `Temporal`, and using it only where
  it exists would let the same call answer differently on Node 24 and 26. Every
  zone operation is `Intl.DateTimeFormat` over the IANA data Node ships.
- **Five commands under `util time`:** `convert`, `duration`, `business-days add`,
  `business-days diff` and `cron`, one MCP tool each, with no short alias.
- **A DST gap resolves forward and an overlap to the earlier instant**, Temporal's
  "compatible" choice, always with a `TIME_DST_GAP` / `TIME_DST_OVERLAP` warning and
  a `dst` object in `data`. There's no flag to choose otherwise; an offset does that.
- **Cron lists a skipped run time in `skipped`, not as a run**, and a repeated one
  once, at its first occurrence. Schedulers differ on both, and the warnings say so.
- **A time without an offset needs `zone` in `convert`**, and is refused without
  one. The other commands' `zone` defaults to UTC, which `data.zone` reports.
- **Durations from seconds are written in hours** (`PT26H`), never days, so they
  stay exact. A day in a parsed duration counts as 24 hours, flagged `APPROXIMATED`;
  years and months give `totalSeconds: null`, flagged `UNVERIFIED`.
- **Business days are Monday to Friday**, with no configurable weekend and no
  built-in holidays; the caller lists holidays (a file or `--holiday`). `add`
  counts as a spreadsheet's WORKDAY does. `diff` reports business time as whole
  24-hour days plus hours, with no working-hours window.
- **Cron dialects:** standard follows the classic crontab's OR rule for the two day fields (AND
  when either starts with `*`); Jenkins ANDs them, as its `CronTab.check` does;
  Quartz requires `?` in one. Detected when not given; a detected standard
  expression with both day fields set warns `CRON_DIALECT_ASSUMED`.
- **Jenkins `H` needs `--job`** and is otherwise `INVALID_INPUT`, rather than
  explaining an expression it can't place. Only one expression line is read: no
  `TZ=` line and no multi-line specs.
- **Quartz `nW` in a month without day n doesn't run that month**, as plain `31`
  doesn't.
- **The cron explanation is reported `unchecked`** on every call: its wording is
  built from the same fields as the run times, which are what's checked.
- **The search horizon is 100 years** (or Quartz's last listed year), with
  `CRON_FEW_RUNS` when fewer runs than asked are found.
- **Skipped run times are capped** (review of #194): `skipped` lists the first 100
  and `skippedTotal` counts every one, and the walk stops after 5,000 skipped run
  times with `CRON_SEARCH_STOPPED`. 5,000 covers a whole every-second gap hour
  (3,600), and a schedule that only ever lands in gaps ends at once.
- **The reference table is computed in Java** (`test/fixtures/util-time/CronReference.java`),
  with java.time, its own zone data and the real `java.util.Random`, and committed
  as JSON, so `npm test` needs no JDK.
- **The holiday file is read in `time.ts`, not in the lazily loaded engine**,
  following #188: lazily loaded code must not import zod, and `kit/input.ts` does.
  No kit change.
- **The skill checker reads `-1` as an argument, not a flag**, as commander 15 does,
  so `toil util time business-days add 2026-12-28 -1` passes `test/skills.test.ts`.

### util md (#177)

- **One command, `util md`, with `--to` or `--from`**, one of them Markdown: four
  formats, three directions each way, and no Markdown-free pair (wiki to ADF),
  which the issue doesn't ask for. No `--out`: the result is in `data.output`,
  and `--select output` gives it alone, so no write rules apply.
- **The Markdown reader is written here**, a focused CommonMark plus GFM subset
  (tables, task lists, strikethrough, bare URLs), not a dependency. Converting
  needs one tree that all four formats share, with positions; a library's tree
  would still need its own conversion, and its HTML output nothing. Raw HTML
  other than `<br>`, link reference definitions and footnotes aren't read; each
  is kept as text and reported as a loss.
- **The round trip compares canonical Markdown, block by block** (an LCS over
  top-level blocks). A block that changed with a loss reported in it is expected;
  one without fails `roundTrip.blocks` (`MD_ROUNDTRIP_MISMATCH`). `lossless` is
  true only when nothing was lost and nothing changed: a wiki task list comes back
  as a task list, but Jira shows `[ ]` text, so it still counts as a loss.
- **A loss explains only its own block.** Where a run of changed blocks has as many
  blocks after the round trip as before, each is judged against its counterpart on
  its own. A run that gained or lost blocks is explained only if every block in it
  had a loss, and a block from nowhere never is. A loss in a block that produced
  nothing, or that became an empty paragraph, stays in `losses` but explains none.
- **Normalization:** whitespace runs are one space, a soft line break is a space,
  `_x_` is `*x*`, list markers and numbering are canonical, empty paragraphs go.
  None of these show when the document is rendered.
- **Positions:** `line N` in Markdown, wiki markup and storage format; a JSON
  pointer in ADF.
- **The ADF schema is vendored**, `@atlaskit/adf-schema` 57.6.21's `full.json`
  (Apache-2.0, 74 KB, published 2026-10-02), loaded with the JSON Schema helper
  only when ADF is read or written. ADF output the schema refuses is never
  returned: the command fails with `INTERNAL`, since it's a bug. ADF input it
  refuses is converted with an `ADF_INPUT_INVALID` failed check, because Jira
  returns documents newer than any bundled schema.
- **Wiki markup:** a single line break is a break, as Jira renders it; a task is
  `[ ]` / `[x]` text; a literal backslash is `&#92;` (two are Jira's line break);
  emphasis inside a word uses the braced `{*}` form. How Jira's renderer treats
  each escape is unverified.
- **Storage format** is read with the kit's XML reader in fragment mode, with
  HTML's common named entities; any other entity is `INVALID_INPUT`. A code block
  is written as the code macro, strikethrough as the line-through span.
- **Reuse:** the ADF node types are jira-cloud's (`src/areas/jira-cloud/adf.ts`);
  `textToAdf` / `adfToText` and confluence-cloud's `storageToText` stay as they
  are, since they're the plain-text forms those areas' fields promise. The area
  flags (`--markdown` on create commands) are not part of this.
- **The input is read in `md.ts`**, which loads statically; only the converters
  load lazily, so zod stays out of the lazy module (the encode build's finding).
- **The corpus round-trip test is split, one test per sample** (#195). As a single
  test it took 4,421 ms (Node 24.14) and 4,560 ms (Node 26) on windows-latest against
  vitest's 5 s default, about 1.2 s locally, and the bounded worker's small cost
  tipped it over. The ADF sample, about 560 ms locally and so past 2 s on that runner,
  has an explicit 15 s timeout with a comment giving those numbers; the code wasn't
  changed to fit the test.

### util docs and coverage (#186)

- **`deps` goes under Safety.** Its inventory is what the vulnerability and licence
  commands read, so it sits with the other checks made before something is trusted
  (secrets, certificates, tokens), not with CI output or arithmetic.
- **One page entry per family, not per command.** `site/src/data/utilities/<family>.json`
  covers `time`'s five commands, `semver`'s four and `deps`' two in one entry each,
  with an example for every command, so the page doesn't repeat the same paragraph
  per subcommand. One file per family keeps parallel util PRs off a shared list.
- **The page is data plus the registry.** The prose is in the family files; flags,
  aliases, MCP tools and the command count come from `data/commands/util.json`.
  Prose is plain text with backticks for code; nothing else is rendered as markup.
- **The tag check is a small stack parser** over the template, skipping
  frontmatter, `<style>`, `<script>` and attribute values, rather than a
  `<section>` count, so a misplaced `</div>` is caught too.
- **The example check reuses the skill test's command-line walker**, moved to
  `test/harness/cli-lines.ts`, so the page, util.md and the rest of the skill hold
  examples to one definition of a real flag. A `--flag` in an entry's prose must be
  a flag of one of the entry's own commands.
- **util.md's command table is checked against the registry** (one row per
  command, its aliases or `none`, its MCP tool), and every command needs an example
  in a shell block, not only a mention.
- **Fixed on the way:** util.md's `md` section carried a copy of `log`'s output and
  checks from a merge, and the `md` row had an empty alias cell.
### util openapi (#183)

- **Three commands, `list`, `show` and `example`**, one per operation the issue
  names, each reading and checking the whole document before it answers, so all
  three carry the same `verified`. No short path: these have no earlier one.
- **An invalid document is still listed and shown**, with every problem by
  pointer and `verified.passed` false (`OPENAPI_INVALID`). Real vendor documents
  aren't always valid; refusing them would leave the agent with nothing.
- **Schemas bundled:** OpenAPI 3.0 (2024-10-18), 3.1 and 3.2 (2025-11-23),
  Swagger 2.0, and the draft-04 meta-schema Swagger 2.0 refers to, as published
  (NOTICE). cfworker doesn't implement `$dynamicRef`, which the 3.1 and 3.2
  schemas use to hand Schema Objects to the 2020-12 dialect, so that part is
  `document.schemaObjects`, `UNVERIFIED`, not a pass. An unknown version (3.3,
  4.0) is refused rather than checked against a near one.
- **`$ref` expansion:** `--depth` counts ref hops along a branch (default 3, at
  most 20). Expanded nodes say `x-toil-ref`; kept ones `x-toil-stop` (`depth`,
  `circular`, `external`, `broken`). In 3.0 and 2.0 a ref's siblings are dropped,
  as the spec says; from 3.1 they're merged over the target, not wrapped in
  `allOf`. A path item or parameter `$ref` is always followed, whatever the depth.
  A budget of 250,000 objects and arrays built per `show` (and 250,000 values
  generated per `example`) stops a fan-out from hanging the MCP server. It
  counts nodes, not refs, because each ref copies its whole target, so a fan-out
  of wide schemas blew past a ref count (review rounds 1 and 2). Past it the rest
  stay in place as `depth`, with `expansion.truncated` and a warning. A cut-short
  example fails `example.valid` without being validated, since its nulls can't be
  valid and validating 250,000 values only costs time. `minItems` builds no more
  items than the budget has left, and a string is at most 10,000 characters: a
  longer `minLength` is cut (and the example marked cut short), and a pattern's
  `{n}` past 10,000 isn't read (review round 3). The two caps multiply, so all of one
  example's strings share a total of 1,000,000 characters too (review round 4).
- **A fourth review round**, past the usual three, at the coordinator's call: each
  round found a narrower way round the same budget (refs, then nodes, then
  items and string length, then the product of the caps), so the loop was
  converging rather than circling.
- **Round 5 fixed the class, not the keyword.** `const` and `enum` returned the
  document's own value uncharged, the fourth budget bypass in a row. Every value
  an example holds now passes one choke point, `emit`, which charges its
  serialised length (plus each property name and each array's brackets) to the
  1,000,000-character budget and returns null past it. A `default`, `example` or
  `examples` is never copied into an example at all. The sweep found the same
  hole in `show`: a description, `example`, `default` or `enum` is copied whole
  wherever its schema is expanded, so `expand` charges every copied value the
  same way against 4,000,000 characters, and past it stops refs and nulls the
  rest (the largest real operation, GitHub's issue timeline at depth 20, is
  about 470,000). Validator messages, which quote a whole `enum`, are cut to 300
  characters in `document.problems` and `example.valid`.
- **Round 6: the budget is checked before anything is serialised.** `emit` and
  `show`'s `spend` used to stringify a value to price it and then find the budget
  already spent, so an `allOf` diamond reaching a 1 MB `const` 250,000 times
  took 65 s. Both now check first, and `spend` takes the cost as a function, so
  a spent budget serialises nothing.
- **Round 7: every phase has a stated bound.** Validating an example had none:
  cfworker tries every `anyOf`/`oneOf` branch, so a diamond of refs validated in
  2^n time (an hour at n=30), and a `oneOf` diamond overflowed the stack into
  `INTERNAL`. (Replaced in round 9 by a worker with a deadline, below.) The kit's `validateSchema` measured the schema's fan-out first
  (`schemaFanOut`: memoised, iterative, counting every path through `$ref`,
  allOf, anyOf, oneOf, not and if/then/else, a loop back counting 1). Past
  100,000 it returns `unchecked` with the reason instead of running. A
  `RangeError` from the validator also becomes `unchecked`, never a crash.
  `document.schema`, `example.valid` and util md's ADF checks all report it as
  `UNVERIFIED`. The official OpenAPI schemas fan out to at most 31, and ADF's to
  90. None of the 3,713 bodies across the full Jira, GitHub and Bitbucket specs
  hits the guard. After six rounds on one class (work that grows faster than
  its input, run synchronously), every phase was gone through deliberately for
  what bounds it:

  | Phase | What bounds it | Test |
  |---|---|---|
  | Parse | Input at most 64 MiB (kit). JSON.parse is linear. YAML aliases add at most 1,000,000 values (kit). Nesting is at most 256 levels, checked iteratively, else `INVALID_INPUT`, so no later recursion can go deeper | 10,000-deep document refused in under 5 s |
  | `$ref` resolution | Iterative walk, `O(nodes + refs × depth)`. Tarjan's cycle search is iterative, `O(V + E)` | 200,000 refs in 20,000 operations in about 2 s |
  | Document validation | Runs in a bounded worker: 2 s and 256 MB, then terminated and reported unchecked with the reason (deadline, memory, stack, or worker threads not allowed). Nesting is at most 256 levels. 50 problems listed, each message at most 300 characters | Kit worker tests; invalid-document tests; smoke runs it from the built bundle |
  | List | `O(operations × parameters)`; output is never more than the document | Listing tests, the 200,000-ref document |
  | Show | `--depth` at most 20. 250,000 nodes, 4,000,000 characters and 1,000 levels of nesting, all checked before work is done | Diamond, wide diamond, long text, deep nesting |
  | Example generation | In-process: 250,000 values, 1,000,000 characters through one choke point, strings of 10,000 characters, items limited to the budget left, 1,000 levels, a ref repeated at most twice on a path. A document's patterns are never run in-process: candidate strings are matched in one bounded worker beforehand (2 s, at most 5,000 patterns and 5,000,000 characters of candidates) | `it.each` of bypasses, diamonds, a 3,000-schema chain; backtracking patterns stopped at the deadline |
  | Example validation | Copies only what the schema reaches, then validates in a bounded worker (2 s, 256 MB). A cut-short example isn't validated | anyOf diamond stopped at the deadline; oneOf diamond out of stack reported unchecked |

  **Round 9: a deadline instead of guesses (the maintainer's decision).** Rounds 7 and 8
  guessed what validation and a regex would cost from their shape (`schemaFanOut`,
  `regexRisk`). Each guess missed cases, so both are gone, and everything whose cost a
  document controls runs in a worker thread with a deadline instead: `kit/bounded.ts`,
  `runBounded`. That covers every JSON Schema validation (the document, the example,
  util md's ADF) and every run of a document's own `pattern`.

  - **The worker** evaluates a small script, `kit/bounded-task.ts` bundled with the
    validator by `scripts/gen-worker.mjs` (about 30 KB), not the CLI.
  - **Limits:** 2 s by default (`BOUNDED_TIMEOUT_MS`) and 256 MB of heap
    (`BOUNDED_MEMORY_MB`, through `resourceLimits`). Past either, the worker is
    terminated.
  - **Failures:** a timeout, memory limit, stack overflow or `ERR_ACCESS_DENIED` (Node
    run with `--permission` and no `--allow-worker`) comes back `unchecked`, with a reason
    naming which. It is never `INTERNAL`.
  - **Not spawning:** a worker thread is part of this process, so No Executables holds;
    `check:pure` passes, and the bundle imports only `node:worker_threads` for it.
  - **Generation stays in-process**, keeping its value, character, node and nesting
    budgets. It no longer runs a pattern itself: it sends each pattern's candidate
    strings to one bounded worker first and uses the first that matches.
  - **Measured on this Windows laptop:**
    - a worker round trip takes 19 ms
    - terminating a busy worker takes about 10 ms
    - the full GitHub description (13 MB) validates in 735 ms in a worker, Jira in
      241 ms, Bitbucket in 118 ms
    - an example is generated and validated in about 18 ms
    - 811 of 812, 1316 of 1317, 1309 of 1317 and 263 of 267 bodies still validate, as
      before
  - **Smoke** runs a validation, a backtracking pattern and a worker-denied Node through
    the installed bundle.
  - **Nothing is left unbounded.**
- **Round 10: the worker script is gated, and cancellable.** It ships as a string
  inside the bundle, so `check:pure` couldn't see its imports. `scripts/gen-worker.mjs`
  now builds it with the CLI's no-spawn plugin (moved to `scripts/no-spawn.mjs` so
  both builds share one) and writes `dist/metafile-worker.json`, which `check:pure`
  holds to the same rules with no spawner allowed: built-ins only, no
  `child_process`, no `.node` file. Tried on purpose: an `execSync` import added to
  `bounded-task.ts` failed `check:pure`, naming the file; then it was reverted. tsup
  cleans `dist/` except that metafile. `runBounded` takes the command's `signal`:
  a cancel terminates the worker at once, as `cancelled` (`util openapi` and `util md`
  pass `ctx.signal`).
- **Round 11: one warm worker, not one per task.** CI on windows-latest / Node 26
  timed out util md's corpus round trip at 5 s. Each validation had started its
  own worker, sent the whole ADF schema and built a validator from it again.
  `runBounded` now keeps one worker per process, made on first use: tasks queue
  and run one at a time, each with its own deadline. A timeout, memory limit,
  crash or cancel terminates that worker, and the next task starts a fresh one
  (tested: a task stopped at its deadline, then the next passing). A cancel
  removes a queued task without touching the running one. The worker is unref'd
  while idle, so it never keeps a command's process alive, and is terminated on
  exit. A schema used repeatedly is sent under a key (`adf`, the OpenAPI version)
  and built once per worker. On this laptop, one ADF validation went from about
  24 ms to about 1 ms once warm (the first, cold, about 60 ms). The corpus test
  went from 1,256 ms to 1,232 ms: locally its time is the conversions, not the
  validations, which are where the slow runner's cost was.
- **Not data:** a `$ref` under `example`, `default`, `enum`, `const`, an Example
  Object's `value`, a 3.1 `examples` array, Swagger's `examples` or an `x-*`
  extension isn't a reference; under `properties` and the other name maps every
  key is a name.
- **One schema per body:** `show` lists every content type and expands the schema
  of the first JSON one (`contentType` says which). Swagger 2.0's `body` and
  `formData` parameters become `requestBody`, so both versions share one shape.
- **`call`** maps the operation onto `<area> api`'s inputs: the first server's
  path (Swagger `basePath`) plus the operation's, required query parameters as
  `name=<name>`, `bodyFile: body.json`, a non-JSON content type, and `writes`. The
  area is left as `<area>`: nothing in a document names a toil area. Required
  header and cookie parameters, which the passthrough can't send, are listed in
  `unsupported`. OPTIONS, TRACE and QUERY give `call: null`.
- **The minimal example** takes required properties only, `const`, then the
  first non-null `enum` value, then a value by type; it never copies a
  document's own `example` or `default`, which may hold real data. A branch of
  `oneOf`/`anyOf`/`allOf` may require a property its parent describes, so the
  parent's properties are passed down. A `pattern` is met by reading the regex's
  simplest path (`sampleOfPattern`), then a short list of candidates; lookaround
  and backreferences give up. A schema that loops through required properties
  stops after two turns, and validation reports it. Against the full published
  documents: Jira 811 of 812 bodies validate, GitHub 3.0 1316 of 1317, GitHub 3.1
  1309 of 1317, Bitbucket 263 of 267. The rest are schemas no value satisfies
  (GitHub 3.1's `type: [null]` beside `allOf: [user]`, overlapping `oneOf`
  branches, `additionalProperties: false` beside an `allOf`), reported as
  `example.valid` failed, with the example still returned.
- **The example is validated against the schema it came from**, by copying only
  what the schema reaches to the same pointers in a small document, so its
  `$ref`s resolve as in the original. 3.0 and 2.0 schemas become draft-04 with
  `nullable` (and `x-nullable`) as a `null` type; a read-only property isn't
  required in a request, nor a write-only one in a response.
- **`--path` on `show` and `example` takes the path with or without its leading
  slash**, since Git Bash rewrites `/repos/...` into a file path. On `list` it's a
  substring filter, as the issue asks.
- **Kit change:** `validateSchema` now returns JSON pointers decoded from
  cfworker's URI-fragment form (`/paths/~1pets~1{id}`, not `%7Bid%7D`), so a
  pointer can be followed into the document as written. A new
  `leafProblems` keeps only what is wrong: cfworker also reports every enclosing
  keyword that failed because of a deeper one ("A subschema had errors" at the
  root), which buried the one real problem among twenty. It drops only
  applicators and `false` schemas; a `required` at a node whose child fails
  `type` is kept, since those are two problems (review round 1).
- **The input is opened in the command's small module** and handed to the lazy
  one, which keeps zod out of everything loaded through `import()` (docs/util.md).

### levels and README

Issue #211. The maintainer set the three levels and their meanings, and the README's
shape; these are the calls made around that.

- **The meanings live in `site/src/data/levels.json`**, the one place they're
  written. `site/src/data/integrations.ts` renders the board's legend and each
  integration page's Status from it, and `test/site-commands.test.ts` reads it to
  check that the levels are exactly `unit`, `live` and `stable` and that every board
  entry and database provider uses one. JSON rather than TypeScript because the test
  suite and the site are separate packages. The skills and docs name the levels and
  point at the file instead of repeating the wording; the `integrations` skill keeps
  only how each level is raised.
- **git keeps its local `unit` wording** as `localMeaning` on the `unit` entry, and
  `statusMeaning()` picks it for a `local` area.
- **The five database providers moved from `integration` to `live`, not `unit`.**
  Their tests run against the real engines in CI's service containers, so `unit`'s
  new meaning ("Never run against a real instance") would be false for them, and
  `live` ("Run against a real instance; its common commands work there") is what
  was already true. No board integration changed level. The maintainer may prefer
  `unit` here; it's a one-word change in each `src/core/db/<engine>/index.ts` and
  `site/src/pages/docs/databases.astro`.
- **`planned` went with every path that served it**: `shippedCount` (the homepage
  stat and both "N shipped" lines now use the integration count), the docs page's
  "appears when the integration ships" fallback and its `shipped` guards, and the
  dashed badge style. The board test now fails a board file whose area isn't
  registered, which is what `planned` used to allow.
- **Colours:** `live` takes the accent and the pulsing dot that `integration` had;
  `stable` takes the amber `--color-ok` that `live` had.
- **`/how-it-works/`'s pre-release note said no integration had shipped and that
  dossiers were still a design**; both were false, so it now says the core and every
  integration on the board are built and tested, and nothing is on npm yet.
- **The README's quick start says the first alpha isn't on npm yet** (the package
  404s today), and sends the reader to the clone path until it is. Its example
  command is `toil deps scan`, which the committed bundle has; newer `util`
  commands aren't in it until a release rebuilds it.
- **The README's agent setup** registers MCP as `node <clone>/dist/toil.js mcp` and
  installs the skill with `toil skill install` (#205), with the Claude Code
  marketplace as the other way in. The committed bundle predates `skill`, so the
  README says to run it from a bundle built in the clone until the next release.
- **After #205, integration pages are the skill files rendered**, so the level's
  meaning sits under the badge in the facts panel, drawn from `levels.json` by
  `statusMeaning()`. The meanings aren't copied into `skills/toil/`; each area file
  names its level, and the site and board say what it means.


### toil skill

- **Both writes are recorded exceptions, by the maintainer's decision on #205**
  ("agree with 1a and 2a", 2026-10-18): the automatic rewrite is the second
  exception in CLAUDE.md, **Writes**, beside the welcome game save, and
  `toil skill install` is the exception to "`add` installs nothing". The
  maintainer also asked that the exceptions, and why they were chosen, be
  documented where users read about writes: `skills/toil/core.md`, **Writes**,
  **Exceptions** is that statement (also `/docs/core/` on the site), with how to
  avoid each; `SKILL.md`, `install.md` and `docs/bounds.md` point to it.

- **`toil skill install` is CLI only and needs `--allow-write`.** It writes outside
  the workspace and has no connection to hold a standing opt-in, so it follows the
  rule for CLI-only writes (`skills marketplace add`): the person typing it gives the
  opt-in there and then. Over MCP there is `skill show` instead, a read: the
  description toil would write now and every installed copy, with whether it's
  current. `install` takes one agent at a time (`--agent`, `--claude`, `--scope`,
  default user scope), with no `--all-agents`.
- **The automatic rewrite runs after every command that loads config**, from a hook
  core calls (`ctx.skillUpkeep`, set only by the real node context), not from each
  connections command. It compares the config file before and after the command,
  so any command that changes the file rewrites the description, including ones
  added later, and a version check rides on the same pass. Commands that load no
  config (`version`, `util …`) don't run it, so "the next run" means the next one
  that reads config.
- **A different environment alone never rewrites the skill.** Only a change to the
  config file, or another toil version, does. Otherwise a run without CI's
  `TOIL_*` vars would strip the env-only areas a CI install named, and the next CI
  run would put them back. Env-only connections count when a rewrite or an install
  happens, and the output says which (`envOnly`, `SKILL_ENV_ONLY`, and the
  `SKILL_REWRITTEN` message).
- **A call with `--config` never rewrites it.** The installed skill describes the
  user's own config; a call naming another file is about that file.
- **There is no repository config to read at project scope.** The issue mentions a
  `.toil.json`, which toil doesn't have and won't (CLAUDE.md, Configuration
  Precedence). Both scopes describe the same config: the user's file and env.
- **Areas by name, engines by name.** The description lists area names (`jira`,
  `github`) and, for `db`, the engines (`databases (postgres and sqlite)`), as a plain
  YAML scalar with no `: ` in it. The installed `SKILL.md` also gets a short
  "Configured here" list of those areas' files with their descriptions; with no
  connections it is the repository's file unchanged.
- **The swap is one rename.** The new copy is written to a hidden
  `.toil-staging-toil-<pid>` folder beside the old one, which is then replaced, so
  a file dropped from the skill disappears from the installed copy too.
- **A `toil` folder toil didn't record as `bundled` is refused, not merged.** A copy
  made by hand from the old instructions fails `skill install` with a fix to move it
  aside; it is never rewritten.
- **`core.md` takes everything SKILL.md had beyond the rules every call needs:**
  `--select`, `toil wait`, paging, errors, files, configuration, the `api`
  passthrough, dossiers, the audit log, certificates and proxies. `SKILL.md` keeps
  short versions of the rules and a table of where to look, capped at 4 KB (8 KB as
  installed with every area configured).
- **The site renders the files with Astro's own Markdown**, read from
  `skills/toil/` by an `import.meta.glob`, and a small remark plugin
  (`site/src/lib/skill-pages.mjs`) turns `` `core.md` `` style references into
  links and drops each file's first heading, which the hero shows. New pages:
  `/docs/core/`, `/docs/install/`, `/docs/mcp/`; every existing URL stays. The
  integration pages are generated from the area files (frontmatter `area`), so
  a new area needs no page code; a board entry adds its name, status and
  credential when there is one. Each page keeps the registry's "at a glance"
  lists of commands and settings below the rendered file.
- **"Reference prose" is a run of more than eight literal words** in a docs page's
  markup, a hero or layout attribute, or a frontmatter string
  (`test/site-docs.test.ts`). `/docs/welcome/` is left out: it describes the
  terminal menu for people, and no agent reads it, so it has no skill file.
- **The utilities page's family files moved into util.md as "By job"**: the four
  groups with their leads, and each family's title, commands and purpose. Their
  inputs, checks and limits were already in util.md's command sections, in more
  detail. `test/util-docs.test.ts` now holds that section to the registry instead
  of the JSON files.
- **`db.md`'s heading is now "Databases (`db`)"**, like every other area file, so
  its page title reads as one.
- **Menu labels:** home has one **Agent skills** row in place of Skills and Plugins.
  Skill plugins holds the marketplaces and a "Switch skill plugins on and off" row,
  which is the old Plugins module; every label that meant a marketplace plugin says
  "skill plugin".

### util c4 (#174)

- **Kept under `util`, not a new `c4` group**: it's local and has no connection,
  like the other util commands, so it shares their fixture, skill page and site
  data. Three commands, `render` (SVG), `mermaid` and `d2` (text).
- **toil's own layered layout, no layout library** (the maintainer's decision on
  the trial). No new dependency, nothing in `NOTICE`.
- **The model is read through the kit's input reader**: `[file]`, stdin or
  `--text` on the CLI, `file` or `text` over MCP, like every util command. The
  trial's `--model`, `--model-json` and MCP `model` object are gone: one reader,
  one set of refusals, and the JSON is parsed and checked by path either way.
- **Self-check through the kit's `Verifier`.** `render` reports `input.complete`,
  `boxes.apart`, `children.inBoundary`, `edges.touchBoxes`,
  `edges.clearOfBoxes`, `labels.clearOfBoxes` and `text.width` (always
  `approximated`, since text is sized from Helvetica's widths), each failure as one
  `C4_LAYOUT_CHECK` warning. A check with nothing to check (no boundary, one box)
  is left out rather than reported as passed. `mermaid` and `d2` re-read their own
  text: each element declared once and one line per arrow (`C4_TEXT_CHECK`), and
  `text.renders` `UNVERIFIED`, since toil runs neither renderer.
- **Edges behind boxes: checked, and the routing changed so they don't happen.**
  `edges.clearOfBoxes` tests every segment of every arrow against every box it
  doesn't join. Run on the trial's routing it found five (four in the busy view, one
  in the bookshop container view). Arrows now leave a box from its bottom, run
  straight down through every row they pass at their dummy's place, and enter the
  target from the top, so they bend only in the gaps between rows, where there are
  no boxes. Every sample view and the worst case at the limits pass. Many parallel
  arrows between one pair (six or more) can still fan out into a neighbour; the
  check reports it.
- **Bounds, one per phase:**

  | Phase | What bounds it |
  |---|---|
  | Read | The kit's reader, capped at 4 MiB |
  | Parse and check | `JSON.parse`, then a count before the schema walks it: at most 1,000 elements, 2,000 relationships and 100 views, else `INVALID_INPUT`. Schema and reference checks are linear |
  | Compute a view | Linear in relationships, times a nesting depth of at most three |
  | Mermaid, D2 | One linear pass over the view |
  | Layout, check and SVG (`render`) | At most 100 boxes and 250 arrows in the view, else `INVALID_INPUT` naming both. Then the bounded worker (`runBounded`, 2 s, 256 MB): a long edge gets a dummy per row it passes, so the layout grows with arrows × rows, and crossing counts are quadratic per row. Past the deadline it's `TIMEOUT`, a cancel is `CANCELLED`, and the worker is terminated, so `toil mcp` can't hang. The worst view at the limits (a 100-box chain with 250 long arrows) lays out in about 0.4 s |

- **Kit addition:** `runBounded` takes a `c4-draw` task, and the worker script
  bundles the C4 layout (`c4/draw.ts`): the worker string grows from 24 KB to
  41 KB. The layout's types moved to `c4/view.ts`, which has no zod, so the worker
  carries no schema library.
- **The neighbour lookups in ordering and placement use an adjacency map** built
  once, instead of scanning every edge for every node, which was quadratic in the
  edges once long edges add their dummies.
- **No PNG.** A WASM rasterizer and a font would outweigh everything else here.
- **Review round 1.** Characters XML 1.0 forbids (C0 controls other than tab, LF
  and CR; U+FFFE, U+FFFF; lone surrogates) become U+FFFD before escaping, and
  `svg.wellFormed` checks the output itself: it parses with the kit's XML reader,
  plus a scan for those characters, since that reader doesn't refuse them. D2 keys
  and paths are always quoted, so there's no keyword list to keep in step with D2.

### #212 core

- **One bundle of code, two thin entries** (the coordinator's round-1 decision on
  #219, replacing the first version's "run the CLI when `argv[1]` is this file",
  which a host bundling the API into its own output would have tripped). The code is
  `dist/toil-lib.js`, built from `src/cli.ts`, which exports the API and `main()` and
  runs nothing when loaded. `dist/toil.js` (the bin, and what a clone runs) is two
  lines that import it and call `main()`; `dist/api.js` (`exports["./api"]`)
  re-exports the API and nothing else. Both entries are defined in
  `scripts/entries.mjs`, written by tsup's `onSuccess`, and checked byte for byte by
  `check:pure`, which also fails on a second emitted bundle, so it's still one bundle
  of code in #212's sense. `test/api.test.ts` holds `API_EXPORTS` to `src/api.ts`, and
  smoke runs `node dist/toil-lib.js version` to prove it prints nothing. Types are
  `dist/api.d.ts`, built by tsup's `dts` (with `ignoreDeprecations: "6.0"`, since
  tsup still sets `baseUrl`); they import nothing. Cost, all paid here:
  `dist/toil-lib.js` is committed beside `dist/toil.js` (`.gitignore`), release-please's
  `extra-files` moves to it (the version banner lives there), the release PR's rebuild
  step commits both, `check:dist` checks both, smoke's clone run copies both, and
  `setup alias` points at the `toil.js` beside the bundle. The committed `dist/` isn't
  touched by this PR: the clone keeps running the last release's single file until the
  release PR rebuilds both. A host may bundle the API: it runs nothing on import.
- **release-please needs one change: `extra-files` now names `dist/toil-lib.js`**,
  where the version banner moved. Nothing else: the research note's "no change" held
  for the export itself. `dist/api.js` and `dist/api.d.ts` carry no version and stay
  ignored build output, like the metafiles, so a clone has the CLI but not the API
  entry, which only an npm install needs. The publish job runs `npm run build` at
  the tag before `npm publish`, so the tarball gets fresh thin entries and
  declarations, and its `check:pure` and `smoke` steps check them.
- **`execute(command, input, options)` takes the command's name and its MCP
  fields**, the same strict input MCP sends, and always returns an envelope: an
  unknown command, a person-only command or a bad caller label is `INVALID_INPUT`,
  never a throw, and isn't audited (like a call the CLI parser refuses).
- **The API serves exactly what MCP would with every area set up**: no `cli-only`
  commands (they prompt, or change connections) and no `mcp: false` deletes;
  `offMcpWhen` applies; the dossier commands refuse over the API what they refuse
  over MCP. Its caller is a program, which an agent may be driving, so it gets the
  agent's rules. Unlike MCP, its workspace is the working directory, as on the CLI.
- **The registry is a stable descriptor, not the internal command objects**: name,
  tool name, path, area, kind, description, `writes`, `writesDependOnInput` and the
  input's JSON Schema (as MCP advertises it), built on first read. Exposing the zod
  definitions would have made every internal field part of the contract.
- **The options are `readOnly`, `caller`, `signal`, `onProgress`, `config`,
  `workspace` and `verbose`.** No `env`, `cwd`, `home` or `fetch`: the program's own
  process supplies those, as it does for the CLI, and each can be added later
  without changing a meaning. Internally `CallOptions` (`readOnly`, `caller`) is one
  object passed to `execute()`, which is where a later `actor` goes.
- **`readOnly` refuses every command that changes anything** (the coordinator's
  decision on #219, overriding the first version, which refused only `writes` /
  `writesWhen`). A UI in read-only mode must not change local state either. The
  signal is a new pair beside `writes` / `writesWhen`: `writesLocal` (every call
  changes something on this machine: toil's config, the credential store, dossiers,
  a skills folder, a shell profile, a downloaded file) and `writesLocalWhen` (the
  input decides: `--out`, `--csv`). `defineConfigCommand` requires `writesLocal`, so
  every `config` and `cli-only` command declares it, `false` included, because those
  write with node:fs where no guard can see. Area, area-local and standalone commands
  reach files only through `ctx.files`, so their writers are marked (the five
  `download-attachment`s, `git report`, `openshift resource-usage`, `util c4 render`,
  `util encode`), and under readOnly `ctx.files.writeBytes` / `writeCsv` refuse as a
  backstop, so an unmarked one fails loudly and never writes. The parity suite runs
  every registered command's every example under readOnly: a marked one must be
  refused before any request or operation; any other must succeed, send only reads,
  call no traced write, and (for the dossiers commands) leave the disk as it was.
  A `writes: true` or `writesLocal: true` command is refused before its input is
  parsed, a `*When` one once its input says so; a GET through the passthrough
  still runs. The refusal reuses `WRITE_DISABLED`. A read-only call also skips the
  bundled skill's upkeep, so it writes nothing but its audit line.
- **The caller label is 1 to 64 lowercase letters, digits, `.`, `_` and `-`,
  starting with a letter or digit** (`CALLER_LABEL`), checked by
  the API before the call runs and recorded as `caller` on the audit line, absent
  when not given. Narrow so it can't carry a token or a path. `toil audit list` shows
  it but has no filter for it yet.
- **`contractVersion` is a whole number, 1 until the first release**, in
  `CONTRACT_VERSION` (`src/core/envelope.ts`) and `docs/command-contract.json`, held
  equal by `test/api.test.ts`. It's bumped by one with every breaking change, never
  for an additive one (`docs/command-contract.md`). It's stamped by `success()` /
  `failure()`, so every envelope builder gets it, and sits right after `version`.
  Tied to the contract by an equality test rather than by fingerprinting the file:
  a fingerprint would fail on every additive edit, which mustn't bump it.
- **Progress through AsyncLocalStorage, so no area changes.** `execute()` runs
  `def.run` under a listener; `instrumentFetch` reports each request, `paginate()`
  each page and `restResponse` each 429 retry. Areas that page inside a command
  without `paginate()` (Jira's own loops today) still report their requests, and
  report pages once they move to `paginate()`. A listener that throws is dropped for
  the rest of the call with one `PROGRESS_LISTENER_FAILED` warning; the command
  isn't failed by a progress bar.
- **Who hears what.** The API's `onProgress` hears every event. The CLI and MCP show
  only pages and retries (requests are `--debug`'s and `--verbose`'s). On the CLI
  (`cliProgress`, the coordinator's decision on #219): every 429 retry, with how long
  toil waits, is one plain `[toil] …` line on stderr, piped or not, so a run never
  sits silent for a minute (principle 4); a page is said only when stderr is a
  terminal, so an agent piping the CLI isn't sent a line per page. stdout is never
  touched. MCP sends `notifications/progress` only when the call carried a progress
  token, with the same messages, and one counter per call shared with `wait`'s
  attempts so `progress` only goes up. `toil wait`'s own stderr line is unchanged.
- **Docs: a section in `skills/toil/core.md`** (**Using toil from a program**, and
  **Progress**), not a new skill page, since a new page needs a site route, a nav
  entry and the general-pages list for one section's worth of text.
- **The example consumer runs in `npm run smoke`**, not Vitest: it needs the packed
  tarball installed, which only smoke has. `scripts/api-consumer/consumer.mjs`
  imports `@imagile-dev/toil/api` by name from the install and runs against a stub
  Bitbucket on loopback (one 429, two pages); `consumer.ts` is type-checked, strict,
  against the installed `dist/api.d.ts`.

### #212 Jira

Items 5, 6, 7 and 9 for `jira` (Data Center) and `jira-cloud`. Each area keeps its own
payload shapes; nothing existing changed shape.

- **Paging is `--limit` and `--cursor`, the house pattern** (as on `bitbucket-cloud`):
  without a limit a list returns everything as before, with no `meta.page`; with one it
  stops there and `meta.page.nextCursor` is the next `startAt`. Added to `list-comments`,
  `list-boards`, `list-sprints` and the new `get-changelog` in both areas, and
  `list-projects` on Cloud. Lists Jira sends whole (`list-transitions`,
  `list-attachments`, `fields`) get no paging: a cursor over a list that is never paged
  would only pretend.
- **`list-sprints` pages only with `--board`.** With `--project` it merges and
  de-duplicates sprints across boards, so no single startAt resumes it; `--limit` or
  `--cursor` with `--project` is `INVALID_INPUT` saying so.
- **DC `search` takes `--cursor` beside `--start-at`**, the same number, so a caller
  pages every list one way. Both at once is `INVALID_INPUT`. Cloud `search` already
  had `--cursor`.
- **`search-users` (Cloud) always sets `meta.page`.** The endpoint answers a bare list
  with no total, so a full page hands out the next startAt and a short page ends it; the
  last full page can lead to one empty page. `startAt` is sent only with a cursor, so
  the existing request is unchanged.
- **`--updated-since` is written in the user's Jira time zone, read from `/myself`.**
  JQL's absolute dates have no zone and are read in the profile's zone, so an instant
  written in UTC would be hours off for most users. One extra GET, only when the flag is
  given. Unknown or missing zone: UTC plus a `JIRA_TIME_ZONE` / `JIRA_CLOUD_TIME_ZONE`
  warning. The instant is rounded down to the minute (JQL's finest), so a sync overlaps
  rather than leaves a gap.
- **`--updated-since` accepts a date (midnight UTC) or a date-time with a zone, nothing
  else.** A zone-less date-time would mean the machine's zone, which differs between a
  laptop and CI (principle 8).
- **The clause goes before a top-level `ORDER BY`, and the caller's JQL is
  parenthesised**, so `a OR b` can't swallow it. Quoted strings and parentheses are
  skipped when looking for `ORDER BY`. With only `--updated-since`, the clause is the
  whole query, rather than demanding `--jql`.
- **DC `get-changelog` uses `GET /rest/api/2/issue/{key}?expand=changelog&fields=summary`.**
  Data Center's REST API (checked against the 9.12 reference) has no
  `/issue/{key}/changelog`; that is Cloud only. The history arrives whole, and
  `--limit` / `--cursor` page it locally with the same cursor rules. If `changelog.total`
  is larger than the histories sent, `JIRA_CHANGELOG_TRUNCATED` says so. The `jira api`
  example in `skills/toil/jira.md` that called the Cloud-only changelog path on Data
  Center now calls `/remotelink`.
- **Bulk get is `--key` repeated, through a one-or-many field.** `key` is
  `string | string[]`: a string returns the issue as before, a list returns
  `{ issues, errors }`, decided by type so both front doors agree. Core gained one
  general rule for it (`repeatable` in `src/core/schema.ts`): a union of a value and an
  array of that value is a repeatable flag that stays a single value when given once.
  So on the CLI one `--key` is the single read, and a one-element bulk read is MCP only.
- **Bulk limits:** at most 100 keys (Cloud's bulkfetch ceiling with `*all` fields, used
  for DC too), duplicates read once, `INVALID_INPUT` before any request beyond that. DC
  sends one GET per key, 5 at a time.
- **Per-key failures are `NOT_FOUND` and `HTTP` only.** `AUTH`, `NETWORK`, a time limit
  or a cancel fail the whole call: a rejected token isn't a fact about one issue. Each
  failed key is in `data.errors` as `{ key, code, message }` and a
  `JIRA_BULK_PARTIAL` / `JIRA_CLOUD_BULK_PARTIAL` warning counts them.
- **Cloud bulkfetch results are matched back to the keys asked** (by key,
  case-insensitively, or by id), since Jira answers in id order and silently omits keys
  it can't find or won't show. An `issueErrors` entry whose id is a key asked for is
  that key's `HTTP` error. An unmatched key is `NOT_FOUND` only when every returned
  issue and error is accounted for; otherwise it is `UNMATCHED` (review round 1),
  its message naming the issues returned under other keys and the ids Jira couldn't
  fetch, so there is at most one error per key. Matching a moved issue for certain
  would mean expanding every issue's changelog (heavier answers, and only the 40
  latest changes), so toil describes the ambiguity instead. Issues that matched no
  key are still returned, after the others. Cloud `get-issue` is marked
  `queryByPost`, since the bulk read is a POST that only reads.
- **One repeatable-flag mechanism in core** (reconciled with #217): `repeatedFlag`
  (always a list) and `oneOrMany` (one value, or a list when repeated) are built in
  `src/core/schema.ts`, and `flagRepeats` there is the one rule the CLI reads for
  both. GitHub's area-local `repeatable` helper became `repeatedFlag`.
- **The contract gets a second output shape for `jira get-issue`**
  (`{ issues, errors }`), added, not replacing the recorded one.

### #212 github

GitHub's slice of #212 (items 5 to 9): issue work items, issue timelines, Projects (v2),
bulk get and paging on every GitHub list.

- **Issues are read over REST, and `data` is GitHub's issue as it came.** `list-issues`,
  `search-issues` and `get-issue` all return the REST Issue object, which carries
  `type` (issue type), `sub_issues_summary` and `parent_issue_url`, so one OWI mapper
  reads all three. GraphQL would have fetched issue type, parent and sub-issues in one
  query, but in a second shape. Docs: https://docs.github.com/en/rest/issues/issues and
  https://docs.github.com/en/rest/issues/sub-issues, checked 2026-10-18.
- **`list-issues` leaves out pull requests.** The issues endpoint mixes them in, marked
  by a `pull_request` key; `list-prs` already lists them. Dropping them needed a filter
  that doesn't end paging early, which is the core change below.
- **Core: `paginate` gained a general `keep` filter** (`src/core/paginate.ts`). It's
  applied after the style reads a page, so the short-page stop still sees GitHub's own
  page size, and `cap` and the cursor's skip count kept items. An offset style refuses
  it, since its cursor counts the server's items. `list-prs` uses it too, so `--limit`
  works with `--author` and the date filters and counts what passes them; without
  `--limit` the result is the same as before.
- **Paging (item 5) is `--limit` and `--cursor` on every GitHub list,** the same pair
  and the same `--cursor needs --limit` rule Bitbucket Cloud and Confluence Cloud use.
  The default stays every page, as the contract records, so the change is additive.
  GraphQL lists (`projects …`) map `pageInfo.endCursor` into the same
  `meta.page.nextCursor` through the `nextPageKey` style.
- **`--updated-since` (item 6)** is on `list-issues` (GitHub's `since`) and
  `search-issues` (`updated:>=`). It's read like the area's other date flags (a date
  alone is UTC midnight) and sent as UTC to the second.
- **`search-issues` adds `is:issue` and nothing else.** It doesn't add `repo:` from
  `--owner`/`--repo` or the git remote: the query scopes itself, which is what makes it
  useful across an org. The resolved owner and repo are dropped from `meta.context`, as
  `create-repo` does. Past GitHub's 1,000-result ceiling it stops without asking for
  page 11 (which GitHub answers with 422) and warns `GITHUB_SEARCH_CAPPED`;
  `incomplete_results` warns `GITHUB_SEARCH_INCOMPLETE`. `advanced_search` isn't sent,
  since an older Enterprise Server may not know it.
- **`issue-events` (item 7) reads the timeline, not the events endpoint.** The timeline
  has what the events endpoint has (closed, reopened, labeled, assigned) plus
  `cross-referenced` (the PRs that mention the issue, OWI's `ChangeRef`), issue type and
  sub-issue changes, and comments. Docs: https://docs.github.com/en/rest/issues/timeline.
- **Bulk get (item 9) is a repeatable `--number` on `get-issue`, read four at a time.**
  Bounded concurrency rather than GraphQL aliases, so the shape stays the REST issue.
  One number returns the issue itself; several (up to 100) return `{ issues, errors }`
  in the order asked, with `NOT_FOUND` and `HTTP` failures per item and a
  `GITHUB_ISSUES_FAILED` warning. Anything else (AUTH, NETWORK, TIMEOUT, UNSUPPORTED)
  fails the call, because it isn't one issue's problem.
- **Sub-issues are on request** (`--sub-issues`, one more request per issue), since the
  summary and parent are already on the issue.
- **A new error code, `UNSUPPORTED`** (`src/core/errors.ts`), for a server release
  without an API a command needs. `get-issue --sub-issues` raises it when `sub_issues`
  is a 404 for an issue that exists; the `projects` commands raise it on a GraphQL
  `undefinedField`/`undefinedType` error. Issue types need no error: an older server
  just has no `type`. No Enterprise Server version numbers are named, because GitHub's
  docs for the Enterprise Server releases don't document the sub-issues endpoints and
  none has been checked live.
- **Projects read only `--owner`,** through `repositoryOwner(login:) { ... on
  ProjectV2Owner }`, so one query serves organizations and users. `INSUFFICIENT_SCOPES`
  (a classic token) and `FORBIDDEN` (a fine-grained one, "Resource not accessible by
  personal access token") both become `AUTH` naming `read:project` and the fine-grained Projects permission (which
  covers organization projects only); a GraphQL `NOT_FOUND` stays `NOT_FOUND`.
  `list-items` reads an item's first 100 field values and flattens `fieldValues` to
  that list, warning `GITHUB_PROJECT_VALUES_TRUNCATED` past it.

### #212 ado

Items 5, 6, 7 and 9 for Azure DevOps Server, on REST 7.1 (Server 2022.1). Every
endpoint used exists at 7.1 in the Server reference: Wiql - Query By Wiql (`$top`,
`timePrecision`), Revisions - List (`$top`, `$skip`) and Work Items - Get Work Items
Batch (`ids`, `fields`, `$expand`, `errorPolicy`, at most 200 ids),
`learn.microsoft.com/en-us/rest/api/azure/devops/wit/…?view=azure-devops-server-rest-7.1`.

- **Which lists page (item 5).** The ones that already read more than one page:
  `project list`, `pipeline list`, `pipeline list-runs`, `repo list-prs`,
  `repo list-builds`, plus `work search` and the new `work revisions`. Each gains
  `--limit` and `--cursor` through core's `paginate` cap, so `meta.page.nextCursor`
  is core's own cursor; core is unchanged. Without `--limit` each returns the whole
  list as the contract records. The one-request lists (`repo list`, comments,
  `list-files`, `list-default-reviewers`, the metadata lists) are left alone: several
  are recorded suspected bugs (#69), and paging them changes behavior the contract
  pins until a live run.
- **`pipeline list-runs`:** `--limit` pages by continuation token; `--top` keeps its
  one request (default 50). Both together is `INVALID_INPUT`, the simpler rule than
  deciding which wins.
- **`work search` paging.** WIQL has no continuation token, so the cursor is an
  offset into the result and each page reruns the query with `$top` set to one past
  the page end (to know whether more exist). Items that change between pages can
  move; the skill page says so. A page ending past the server's 20,000-item limit is
  refused with a fix to narrow the query. `--limit` needs a flat query, like
  `--updated-since`.
- **`--updated-since` (item 6).** A date (UTC midnight) or a date-time with Z or an
  offset; a zoneless date-time or a calendar date that doesn't exist is refused, so
  the flag means one instant everywhere. It is formatted by toil as
  `'YYYY-MM-DDTHH:mm:ss.sssZ'` and ANDed as `[System.ChangedDate] >= …` onto the
  query's top-level WHERE, wrapped in parentheses, found by a scan that steps over
  string literals and brackets (`wiql.ts`). `timePrecision=true` is sent, since the
  server refuses a time in a date literal without it. Link queries (`FROM
  WorkItemLinks`) are refused rather than guessing which of `[Source]` or
  `[Target]` the date belongs to.
- **`work revisions` (item 7)** pages by `$top=100` and `$skip` under the project
  path, returning every revision by default, bounded by core's 1,000-page limit
  (an `HTTP` error naming the list). 100 stays under any server page maximum, so a
  full page is never mistaken for the last.
- **Bulk get (item 9)** is a new command, `work get-batch --id <n>` (repeatable),
  rather than making `work get --id` repeatable, which would repurpose a recorded
  flag. Ids are de-duplicated in order, sent 200 per request, at most 1,000 per
  call (`INVALID_INPUT` above that). `errorPolicy: omit`, so a missing or
  invisible id doesn't fail the batch; `data` is `{ count, value, missing }`, with
  an `ADO_WORK_ITEMS_MISSING` warning naming the ids. `--fields` (comma-separated)
  replaces `$expand: all`, as the server takes only one of the two.

### #212 OWI

Items 10 and 11: the OWI spec (`docs/owi/spec.md`, v0.1) and its JSON Schema
(`docs/owi/schema.json`), the mappers in `src/core/owi/`, `toil util owi map`, and
`mapOwi`, `owiVersion` and `owiSchema` in `@imagile-dev/toil/api`.

- **Dossier overrides come in as input, not a dossier lookup.** `util` commands are
  standalone: they load no config and get no dossier (`usesConnection` gates the
  dossier in `src/core/run.ts`), and giving a util command dossier access is a core
  change out of proportion to this item. So the override keys are a dossier
  section's `fields` keys (`estimate`, `estimateUnit`, `priority`, `type`, `team`,
  `dueDate`, `iteration`), passed as `--field name=field` (the shape Jira's
  `--field` already has, safe in every shell) or `fields` to `mapOwi`, which a host
  that reads the dossier through `./api` hands over unchanged. Automatic lookup from
  the call's dossier is a possible later core change.
- **`estimateUnit` defaults to `points`** for an override, documented, except
  Jira's `timeoriginalestimate`, which is seconds and so always hours.
- **`UNKNOWN` is upper case**, beside `TODO`, `IN_PROGRESS` and `DONE` (#206's enum
  style); the brief's "a documented `unknown` category" is that value.
- **Additions to #206's model**, each additive: `typeName` (the source's own word,
  principle 4), `resolution`, `team` and `dueDate` (they were already override
  targets), `history` with `transitions` and iteration moves (#206's Transition, plus
  sprint moves for scope-added and carried-over), and `unmapped` per item. Board and
  ChangeRef are left for a later version: no mapped command returns PR links yet.
- **Removed (Azure DevOps) and `not_planned` (GitHub) are `DONE`**, with the reason
  in `resolution`, rather than a fifth category.
- **A Jira changelog's statuses take their category from items in the same input**,
  since the changelog names statuses only; one that no item is in is `UNKNOWN`, and
  the item lists `history.transitions` in `unmapped`.
- **A GitHub open issue with no board is `TODO`**; a closed one is `DONE` whatever
  its board says.
- **Keyless histories** (Jira changelog, GitHub timeline) take `--key`, or a
  `{ key, history }` wrapper in a multi-document input; a history whose item isn't in
  the input is returned in `histories` rather than dropped.
- **One mapper per shape, keyed by family** (`OWI_SOURCES` in
  `src/core/owi/types.ts`): `jira-cloud` shares the Jira mapper, and Azure DevOps
  Services (#222, `ado-cloud`) is one line there once it lands; a skipped test in
  `test/owi.test.ts` names it. `source.area` in the schema is a pattern, not an
  enum, so a new area isn't a schema change.
- **Work-item areas are marked in `OWI_SOURCES`, and a test keeps the mark
  honest** (the maintainer's requirement: OWI is inspected whenever a work-item
  integration is added or changed). The rule is written once, in the `integrations`
  skill (**Open Work Items**), with a one-line pointer from CLAUDE.md. Rather than a
  second flag on `defineArea`, the mapper's own registry is the mark, so there is
  one list. `test/owi.test.ts` fails when an area has a command whose name is issue-
  or work-item-shaped (`(create|get|update|list|search|transition|link)-issue(s)`,
  `-ticket(s)`, `issue-events`, `get-changelog`, `work get|get-batch|revisions|search|create|update`)
  and isn't marked, when a marked area isn't registered or has no fixture, or when a
  marked command isn't registered; the mapped-examples test then validates each
  marked area's fixture output against the schema. `sonar issues` (code findings) and
  `bitbucket needs-work` don't match the pattern, on purpose. `ado-cloud` is in the
  test's `PENDING` list citing #222: its test is skipped until the area registers,
  then fails until it is a line in `OWI_SOURCES`. Proven by a scratch run with
  `github` removed from `OWI_SOURCES`: the marking test failed (and so did every
  sprint test that maps GitHub output), then passed again once restored.
- **Schema validation is per item**, keyed, through `validateBounded`, so a 5,000-item
  call (the bound, `OWI_ITEMS_CAPPED`) never puts one large task past the 2 s
  deadline.

Research notes on #212 and #206, checked against the vendors' docs on 2026-10-18:

- **ADO estimates: confirmed** StoryPoints (Agile), Effort (Scrum), Size (CMMI),
  OriginalEstimate for tasks, all `Microsoft.VSTS.Scheduling.*`
  (https://learn.microsoft.com/en-us/azure/devops/boards/queries/query-numeric).
  **Effort on Basic is not confirmed:** neither that page nor the Basic process page
  says what Basic's Issue estimates with. Nothing pins it: the mapper tries
  StoryPoints, Effort, Size, then OriginalEstimate on any process, so a Basic Issue
  with Effort maps, and one without lists `estimate` as unmapped.
- **ADO state categories: confirmed** from Microsoft's table
  (https://learn.microsoft.com/en-us/azure/devops/boards/work-items/workflow-and-state-categories),
  including Basic's To Do, Doing and Done, which the research didn't list.
- **Jira estimate names: consistent but secondary.** "Story Points" (company-managed
  and Data Center) and "Story point estimate" (team-managed) are what Atlassian's
  community and vendor docs say; I found no first-party Atlassian page stating both.
  The mapper finds them by name (a registered custom field name or an expanded
  `names` map), never by id, as the research said; a site that names them otherwise
  uses `--field estimate=…`.
- **GitHub issue fields: changed.** GitHub's changelog says they went generally
  available on 2026-07-02, and the REST API documents
  `/repos/{owner}/{repo}/issues/{number}/issue-field-values`. No toil command reads
  them, so OWI 0.1 doesn't map them; the spec says so. Projects number fields,
  issue types and sub-issues are documented and mapped.
- **OSLC CM: changed.** CM 3.0 is an OASIS Standard (26 May 2021), not CS01 of
  2018; the state predicates are `closed`, `inProgress`, `fixed`, `approved`,
  `reviewed` and `verified` (six, `reviewed` was missing), and `oslc_cm:status` is
  deprecated in favour of `oslc_cm:state`
  (https://docs.oasis-open-projects.org/oslc-op/cm/v3.0/os/change-mgt-spec.html and
  the vocabulary beside it). The mapping maps `closed` and `inProgress` and says why
  the other four are left out.
- **Preview fixtures: done** as `test/fixtures/owi/` (spec, **The sprint fixture**).

### #206 preview

Milestones 3 and 4: the `ui/` workspace (`@imagile-dev/toil-ui`, private, its own
package and lockfile like `site/`), a fixture `Store` and a scripted `Agent`, the
board, sprint health and traceability views in Plain and Crate, served by the site
at `/ui-preview/`.

- **Stack: React 19 + Vite + TypeScript, no component library yet.** It is #206's
  recommendation minus React Aria: the three views need only native elements
  (links, checkboxes, buttons, selects, tables), which are accessible as they come,
  so React Aria waits for the first widget that needs it (the board's drag and drop,
  a dialog). React stays because the theming design's skins are a slot registry in
  context, and the dependency graph and board libraries #206 names are React-first.
  Everything is a dev dependency of `ui/`, built into static files; the CLI package
  gains nothing (`check:pure` is untouched). No Tailwind, as #206 says.
- **Hash routes and relative asset URLs** (`base: './'`), so the same build works at
  `/toil/ui-preview/` on Pages and at whatever base path the local app gets, with no
  rewrite rule.
- **The site builds the preview itself.** `site/scripts/ui-preview.mjs` runs `vite
  build` in `ui/` (through node, no shell) and copies `ui/dist` into
  `site/public/ui-preview/` (git-ignored) before `astro dev` and `astro build`. A
  site build without `npm --prefix ui ci` fails saying so. A small Vite middleware in
  `astro.config.mjs` serves the folder's `index.html` in dev, as Pages does.
- **CI:** the `gate` job runs `ui/`'s `npm ci --ignore-scripts`, typecheck, lint,
  test and build on all three OSes and both Node versions, so it is inside `CI ok`;
  `pages.yml` also triggers on `ui/**`, `src/core/owi/**` and `test/fixtures/owi/**`.
- **One source for OWI.** `ui/` imports the types from `src/core/owi/types.ts`, the
  sprint from `test/fixtures/owi/sprint-42.owi.json` and the schema from
  `docs/owi/schema.json` by relative path; `ui/test/store.test.ts` validates every
  item the fixture Store serves against the schema.
- **`ChangeRef` is the UI's own shape for now.** OWI 0.1 leaves pull requests and
  builds out, so the traceability view's changes are a UI fixture
  (`ui/src/fixtures/changes.ts`: Bitbucket and Jenkins for Jira, Azure Repos and
  Pipelines, GitHub PRs and checks). It moves into OWI when the spec carries it.
- **Sprint health rules** (`ui/src/model/sprint.ts`): a sprint is matched across
  trackers by name, its range the earliest start to the latest end. An iteration
  change whose `from` names another sprint (not a parent area path) is a carry-over;
  one after the item's own sprint start is scope added. GitHub Projects keeps no
  iteration history, so the board item's `createdAt` from `native` stands in and the
  view names it as the source. That makes `payments-web#45` (added 11:05 on day one)
  scope added as well as `#43`, which the data supports. Points totals count only
  `points` estimates and list the rest. A blocked item is one with an inward
  `blocks` link from an unfinished item.
- **OWI 0.1 has no "removed" category.** Azure DevOps' Removed maps to `DONE`, so
  2307 counts as done in the totals (1 point) and traceability flags it "Done with no
  linked change", with its own status word beside it. Worth a look for OWI 0.2.
- **The scripted Agent's figures are tested against the model**
  (`ui/test/agent.test.ts`): every number and citation in its three answers is
  recomputed from the fixture, so the script can't drift from the data.
- **Themes are JSON tokens plus scoped CSS and assets**; tokens become custom
  properties at runtime (`tokenCss`). Skins (script) live in `ui/src/skins/`, built-in
  only. Crate reuses the site's 404 cartoon (`crate-lost.webp`) for empty and loading
  states and the site's fonts through Fontsource; `test/brand-sync.test.ts` holds its
  colours and fonts to `global.css`. Its `line` token is the UI's own (the site's is
  translucent). The theme choice is remembered in `localStorage` and can be set with
  `?theme=` and `?scheme=`.
- **`scripts/shoot.mjs` loads `about:blank` before each shot**, so pages that differ
  only after `#` (the preview's views) get a fresh document each time.
- **The site doesn't link to the preview yet.** Where it goes in the navigation is
  the maintainer's call at the launch.

### #228 dossier dashboard

The preview reworked around dossiers: it opens on the dossier list, and each dossier
has one dashboard with its stories, pull requests, builds and deployments together.
Some of the #206 preview decisions above are replaced here (the fixture `Store`, the
board, the separate health and traceability views).

- **The seam is toil itself.** The `Store` interface is gone. The App takes an
  `execute` with the signature of `@imagile-dev/toil/api`'s `execute()`
  (`ui/src/toil.ts`), and calls it read-only with `caller: 'toil-ui'`. The local app
  will pass the real one. The preview passes a **fixture `execute()`**
  (`ui/src/fixtures/execute.ts`): canned, sanitized envelopes keyed by command and
  input (key order ignored). It answers an unknown call or one without `readOnly`
  with a refusal envelope and a fix, as the real one would, and never throws.
- **Three dossiers, each with its own sources:** `card-payments` (Jira DC, Bitbucket
  DC, Jenkins multibranch, OpenShift dev and prod); `settlement` (Azure DevOps Server
  Boards, Repos, and Pipelines, one pipeline for CI and one for deploys); and
  `checkout-web` (GitHub Enterprise, Projects, Actions checks, OpenShift staging and
  prod). ado-cloud isn't used, because ADO Server covers the same commands and has
  the pipeline ones.
- **What a dashboard calls is decided by `dossiers show`.** The Jira project gives
  the JQL (`jira search`), with `jira get-changelog` per issue. For ADO it's `ado work
  list-iterations`, `ado work search` (WIQL), `ado work get-batch` and `ado work
  revisions` per item. For GitHub, `github projects list-items` for each board in
  the dossier's `projects`, then `github get-issue` and `github issue-events` per
  issue. Pull requests come from `bitbucket list-prs`, `ado repo list-prs` and
  `github list-prs`. Builds come from `jenkins pipeline list-runs` (`<job>/PR-<id>`
  for each `jenkins.jobs` entry), `ado pipeline list-runs` (the `ado.builds`
  pipelines) and `github list-checks` (each PR head). Deployments come from
  `openshift deployments` (each environment's `openshift.namespace`) and `ado
  pipeline list-runs` (the `ado.deployments` pipelines). `jobs`, `builds`,
  `deployments` and `projects` are dossier reference data, which a dossier keeps as
  written. Every call is kept with the panel it fed. A panel shows "Fed by" with each
  command, how many calls, and their exact inputs. A failed call is a `role="alert"`
  on its own panel with toil's message and fix, and the other panels still load.
- **Tested against the registry.** `ui/test/registry.test.ts` imports `registry`
  from `src/api.ts`, so the test reads the source. Every canned call must be a
  command `execute()` serves that never writes (`writes`, `writesLocal` and
  `writesDependOnInput` all false), and its input must validate against the
  command's strict input schema. The test also checks that the dashboards ask only
  for calls the fixture answers, ask for every one of them, and pass `{ readOnly:
  true, caller: 'toil-ui' }`. It assigns the fixture to `typeof execute` and back,
  so the two signatures can't drift apart. That file needs the CLI's Node-only
  sources, so `ui/tsconfig.registry.json` type-checks it with the CLI's module
  settings, and `ui/tsconfig.json` leaves it out. `npm run typecheck` in `ui/` runs
  both.
- **Work items go through `mapOwi`.** The API's entry loads Node-only code, so a
  page can't import it. `ui/src/owi.ts` is the same three-line wrapper over
  `src/core/owi/`, and the registry test checks that it maps each dossier exactly as
  the API's `mapOwi` does. The canned work envelopes are the OWI sprint fixture's own
  input (`test/fixtures/owi/sprint.ts`), read in place and split by dossier. The
  three dossiers hold exactly the items of `sprint-42.owi.json`, and a test checks
  that. Jira is read with `jira search` instead of `get-issue`, since a dashboard
  queries a project.
- **Every item's history is fetched, so the fixture adds the missing ones.** Where
  the sprint fixture has no history, the fixture serves one that agrees with the
  item: an empty Jira changelog or GitHub timeline, or Azure DevOps revisions from
  creation onward. This changes one figure: 2305, a task created in the sprint on
  day one, now counts as scope added.
- **Pull requests, builds and deployments use small UI shapes** (`ChangeRef` and
  `Deployment` in `ui/src/toil.ts`, mapped in `ui/src/model/delivery.ts`), until OWI
  carries them. A PR names its items by Jira key, or by `#n` for an ADO work item or
  a GitHub issue in the same repository. A build joins its PR by the Jenkins job
  `PR-<id>`, by `triggerInfo["pr.number"]` (or `refs/pull/<id>/merge`), or by the
  checks on the PR's head. A GitHub head's checks count as one build: failed if any
  check failed. A deployment names a commit: the trailing hex of the image tag, or a
  deploy run's `sourceVersion`. It includes the merged PR with that merge commit and
  every PR merged before it into the same repository, assuming a linear target
  branch. A missing commit, or one no listed PR merged as, is shown as unknown, not
  guessed. OpenShift is read once per dossier, after every code host's PRs are in.
  A date that's missing or won't parse shows as unknown on its own row, and the rest
  of the dashboard still loads. An ADO environment is a deploy run's
  `templateParameters.environment`, and the dashboard shows the newest successful
  run for each environment.
- **What was folded in and what was removed.** Sprint health is now the dashboard's
  first panel, with its figures, risks, scope added and carry-over. Traceability is
  the second panel, now with a "Deployed to" column. The item page stays, inside its
  dossier (`#/dossier/<name>/item/<id>`). **Removed:** the board view, along with
  its source filter and cards, since a dossier has one tracker. The trace table now
  shows status words and estimates. Also removed: the "each tracker's sprint" table,
  which has one row per dossier now, and the fixture `Store`, `changes.ts` and the
  separate `#/board`, `#/health` and `#/trace` routes.
- **The scripted Agent answers about the selected dossier.** `Agent.starters(dossier)`
  and `ask(dossier, prompt)` each offer two starters per dossier: what's at risk, and
  where the work is deployed. `ui/test/agent.test.ts` recomputes from the loaded
  dossier every figure, every environment and commit, the items each environment
  runs, and the items with open PRs.

### #252 views and #253 insights, charts and chat

The dossier dashboard gains the board, aging work in progress, the dependency graph,
throughput and cycle time (#252), plus #253's items 1 to 3: charts, insights on
tickets and a docked chat. #253's configuration page waits for the local server; the
preview has a Settings entry that says so.

- **Every figure is a pure, tested function** of OWI items, transitions and
  `ChangeRef`s: `ui/src/model/flow.ts` (cycle time, aging, throughput), `burnup.ts`,
  `graph.ts`, `board.ts` and `insights.ts`. Cycle time runs from the first move into
  In progress to the last move into Done; aging from the start of the current spell in
  progress; throughput counts an item in the week (Monday, UTC) of its last move into
  Done. Anything the history can't show is listed as unknown with its reason, never
  guessed: GitHub's timeline records only open and closed, so a GitHub issue never has
  a cycle time or an age. Epics and `OTHER` items are left out, as the trace table
  leaves them out.
- **The board is one column per OWI status category,** across trackers, each card with
  its own status word. A drag (dnd-kit, pointer and keyboard) or the card's Move menu
  (the single-pointer alternative WCAG 2.5.7 asks for) makes a proposal and changes
  nothing. A proposal names the toil write command and its exact input:
  `jira transition-issue` or `ado work transition`, with the status word other items
  in that column use. GitHub has no toil command for a Projects status, so its
  proposals say so instead of inventing one. `ui/test/registry.test.ts` holds every
  proposal the board and the scripted agent can make to the real registry: the
  command exists, writes, and its input validates.
- **A proposal's command line is single quoted, never double quoted** (#255 review):
  every value in `'…'`, which neither POSIX shells nor PowerShell expand (no `$(…)`,
  backticks, variables or backslash escapes). POSIX writes a quote inside as `'\''`;
  PowerShell doubles each character it reads as a single quote, the typographic
  ones included. A value starting with `-` is attached to its flag
  (`'--summary=-x'`), and one holding a line break is refused with the reason. The
  card shows the viewer's shell (PowerShell on Windows, from `userAgentData` or
  `platform`, else bash/zsh), with a toggle that switches every card and is remembered;
  Copy copies what is shown. `ui/test/views-model.test.ts` round-trips hostile values
  through `sh -s` and `pwsh -EncodedCommand` where each is installed, feeding the
  script past argv so Windows' argument quoting can't mask a bug.
- **PowerShell refuses what cmd.exe would act on** (#255 round 2). On Windows npm
  installs `toil` as a `toil.cmd` shim, so PowerShell hands the arguments to cmd.exe,
  which re-reads `& | < > ^` and expands `%VAR%`; Windows PowerShell 5.1 also mangles
  an embedded `"`. A value holding any of those (or a line break, in either shell)
  gets no PowerShell line, only the reason and advice that is true for that command
  (#255 round 3): `--input-file` only where the command takes one (`INPUT_FILE_COMMANDS`,
  which the registry test holds to every command whose input has `inputFile`);
  switching the card to bash/zsh where only PowerShell refused; and always the MCP
  call, its tool name and input shown as JSON, which needs no shell quoting. The board's
  transitions (`jira transition-issue`, `ado work transition`) take no input file, so a
  column named "Code Review & QA" is offered bash/zsh and MCP.
  Every toil command line the UI shows, the board's read-only hints (`jira
  list-transitions`, `ado work list-states`) included, goes through the one renderer
  in `ui/src/proposal.ts`; a hint is a `{ command, input }` the registry test holds
  to a real read command.
- **The dependency graph's layout is in the model:** each item's column is the
  longest `blocks` chain leading to it, so no layout library. xyflow draws it,
  lazy-loaded (it is a third of the bundle), with nothing draggable or connectable,
  no scroll-wheel zoom, and its own labelled zoom buttons, because xyflow's control
  panel puts an `aria-label` on a div with no role. Every link is also listed in words.
- **Insights** (stale after 5 days, aging past p85 once there are 3 cycle times,
  blocked, blocking, failing build, unestimated, scope added, carried over, PR open with
  no build, merged but not deployed, deployed but still open) each carry a weight and
  the data they rest on. "Needs attention" ranks open items by total weight.
- **Charts are hand-written SVG,** no chart library: a burn-up, a throughput sparkline
  and a cycle-time scatter, each an image with a summary and a "Show the figures" table.
- **The chat** is docked and sticky on a wide screen and a bottom sheet under 1000px.
  `Agent` gains an optional `stream()` and `Answer.proposals`; the scripted agent
  streams word by word (never splitting a citation) and has a third starter, "What
  needs attention first?", which `ui/test/agent.test.ts` holds to the insight ranking.
- **React Aria Components** now carry the controls: the theme and appearance selects,
  the gaps checkbox, the chat's buttons and text field, and the board's Move menu.
- **Dependencies:** `@dnd-kit/core` 6.3.1 (MIT), `@xyflow/react` 12.12.0 (MIT) and
  `react-aria-components` 1.21.1 (Apache-2.0), dev dependencies of `ui/` and installed
  with `--before` a date 14 days back so the whole tree is that old. None ships a NOTICE
  file. Since #254 the UI ships its own `ui/NOTICE`, which now lists them and what
  they bring into the built app (zustand, classcat, clsx, aria-hidden,
  use-sync-external-store, the d3 modules under ISC and BSD-3-Clause, the
  @internationalized packages, @swc/helpers and tslib), with each licence's text.
- **Fixtures:** nine items finished in Sprints 40 and 41 join the OWI sprint fixture
  (PAY-92, PAY-95, PAY-97, PAY-98, 2290, 2294, 2297, payments-web#36 and #38), so
  throughput and cycle time have weeks to show; Sprint 42 is unchanged. The UI's own
  fixture adds PAY-106's changelog, which agrees with its created and resolved dates.

### #222 ado-cloud

Azure DevOps Services (#222), built from Microsoft's REST API 7.1 reference
(`learn.microsoft.com/en-us/rest/api/azure/devops/…?view=azure-devops-rest-7.1`) with
no live organization. `ado` (Server) is untouched: no file under `src/areas/ado/`, its
skill file, fixture, board entry, site data or contract entries changed.

- **A separate area that shares nothing with `ado`.** `wiql.ts` (the `--updated-since`
  WHERE-clause amendment) is copied rather than imported or moved to core: moving it
  would change `ado`'s files, and importing it would let a fix for one variant change
  the other's recorded behaviour. The copy takes the flag name, so
  `--created-after` errors name the right flag. Field aliases are ado-cloud's own small
  module with the same built-in list.
- **A connection is one organization.** `baseUrl` is the organization URL
  (`https://dev.azure.com/<org>`, or `https://<org>.visualstudio.com`), matching the
  organization-scoped token. There is no `--organization`/`--collection` input. A
  `dev.azure.com` URL without exactly one path segment is `CONFIG_INVALID` before
  anything is sent.
- **Auth.** An organization-scoped PAT as Basic with an empty user name. The 401/403
  fix and the skill say global PATs stop working on December 1, 2026. The issue also
  says creation was blocked on March 15, 2026; Microsoft's retirement post was updated
  on 2026-03-05 to say that block was cancelled ("You may continue creating global
  PATs until December 1"), so the docs give only the December 1 date.
- **No CI fallbacks.** Azure Pipelines sets `SYSTEM_ACCESSTOKEN` and
  `SYSTEM_COLLECTIONURI` under the same names on Server and Services, and `ado`
  already reads `SYSTEM_ACCESSTOKEN`. A fallback creates the area's default
  connection by itself, so if ado-cloud read them too, one job's token and URL would
  configure both areas, and on a Server agent `ado-cloud` would point at the Server.
  A host-checked fallback would need a new core mechanism. The job token must be
  mapped into a step's env explicitly anyway, so the skill shows mapping
  `$(System.AccessToken)` and `$(System.CollectionUri)` to `TOIL_ADO_CLOUD_PAT` and
  `TOIL_ADO_CLOUD_BASE_URL`; `System.CollectionUri`'s trailing slash is accepted.
- **API version 7.1** on every request: the docs' default and newest released
  version; 7.2 exists only as `7.2-preview.N`. Work item comments are
  `7.1-preview.4` (no released version exists) and connection data `7.1-preview.1`.
- **Work items by id are organization-level** (`work get`, `update`, `revisions`,
  `get-batch` need no project), as the reference allows; create, search, comments and
  iterations need one.
- **Scope**: the issue's list, with `ado`'s command names and flags where the operation
  is the same. Added beyond `ado`: `work update --rev` (a JSON Patch `test`),
  `repo list-threads`, `repo list-comments --include-system`, `repo resolve-comment
  --status`, `repo merge-pr --message`, `repo update-pr --target`, and the `api`
  passthrough. Left out for now: `work create --input-file`/`--parent`, `work
  update --input-file`, `update-pr --reviewers` (the endpoint doesn't take them,
  #69 item 9 on `ado`), pipelines, attachments, and the metadata lists; `api`
  reaches them.
- **Paging**: `project list` (header token), `repo list-prs` and `work revisions`
  (`$top`/`$skip`, 100), `work list-comments` (body `continuationToken`, 200 asked
  per page) and `work search` (offset into one WIQL answer, as `ado`'s) all take
  `--limit`/`--cursor` through core's `paginate`. `ado`'s `work list-comments` reads
  one page (a recorded suspected bug); ado-cloud's reads them all.
- **Ids and enums are schema-typed** (`z.number()`, `z.enum`), not `parseInt` text as
  the `ado` contract records: there is no contract for Services to keep.
- **`repo list-comments` drops system comments by default**, unlike `ado`'s
  (#69 item 22 records that as a suspected bug there).
- **OWI**: ado-cloud's work item output is the server's own JSON, the same shape as
  `ado`'s where Services and Server agree; each difference is listed in the skill's
  "Output, compared with `ado`" section. It is one line in `OWI_SOURCES`
  (`'ado-cloud': ADO`, after #224): the same commands (`work get`, `work get-batch`,
  `work revisions`, `work list-iterations`) and shapes, so `ado`'s mapper reads it with
  no change. The differences (an email `uniqueName`, organization-level URLs, from
  which the web link builds the same way) need no mapper change; `docs/owi/spec.md`
  names both areas and says so. `test/owi.test.ts`'s `PENDING` entry is gone.
- **Probe**: `GET /_apis/connectionData?api-version=7.1-preview.1`, which names the
  token's user. It's undocumented on Services; the first live run checks it.
- **No git remote parsing**, as `bitbucket-cloud`: project and repo come from the
  flag, a dossier or the connection.
- **The board status is `unit`.**

### #223 feedback

- **`toil version` reports `commit`** next to `contractVersion`, stamped at bundle
  time on its own banner line (`tsup.config.ts`): `TOIL_BUILD_COMMIT` when set, else
  git's `HEAD`, else `null`. A bundle can't contain the hash of the commit that holds
  it, so `scripts/check-dist.mjs` sets that one line aside when it compares the
  committed bundle with a rebuild. The npm tarball is built from the release tag, so
  it reports a commit on `main`; the committed `dist/` reports the release branch's
  commit. Not added to `@imagile-dev/toil/api`'s exports.
- **No deploy in this PR.** Azure's own forecast for Imagile Paid in October 2026 was
  $50.08 (actual $8.88 plus $41.20 forecast) before anything here was added, over the
  $50 gate, though the last week's actual run rate (~$0.66/day) projects ~$19. The gate
  is the maintainer's, so the deploy waits for them; `what-if` ran clean.
- **The agent runs no code and holds no write credential** (review round 1). The issue
  listed `git push`, `npm test` and `gh issue …` among the agent's tools. `main`'s
  ruleset currently applies to no branch (its `include` is empty, so
  `GET /rules/branches/main` is `[]`), so any `contents: write` token can push straight
  to `main`, and anything the agent's tests ran would inherit its step's
  `CLAUDE_CODE_OAUTH_TOKEN` and `GH_TOKEN`. So the agent has `Read`, `Glob`, `Grep`,
  `Edit` and `Write` only (no Bash at all, so not even the scoped `gh issue` commands
  the review allowed), and writes its decision, comment and PR text to `.triage-out/`.
  Three jobs: `select` (claim, redact), `triage` (the agent, one matrix job per issue;
  workflow token read-only; handover by shell utilities only, as a ustar archive) and
  `finish` (main's scripts only; applies the decision, and for a fix pushes and opens a
  **draft** PR). The table is in the `automation` skill.
- **No in-workflow test job** (review round 2). A `gate` job briefly ran the agent's
  code with no secrets, but on a hosted runner that code could still reach the
  runner's cache token in `main`'s scope. The draft PR gets the whole gate from
  `ci.yml` under `pull_request` instead: all three OSes, the PR's own cache scope, no
  secrets. A human marks it ready and merges it.
- **The daily run triages the queue itself, as a matrix** (review round 2), rather than
  dispatching a run per issue: a run dispatched with `GITHUB_TOKEN` has
  `github-actions[bot]` as its actor, which claude-code-action refuses, so `allowed_bots`
  stays `imagile-bot` alone.
- **A failed agent run is not a decision** (review round 2). The agent job writes
  `agent-ok` only when the agent step succeeded; with it or `decision.json` missing,
  `finish` puts the issue back in `triage-queued`, adds no label and no comment, and
  fails the run. A decision the agent made but `decision.mjs` refuses is `invalid`: a
  comment for a maintainer and `triaged`, so it isn't retried forever.
- **`claude-triage` from the Imagile Bot** counts only on an issue that already carries
  `from-website` or `from-terminal`, and still goes through the cap.
- **The client address is the last `X-Forwarded-For` entry** (review round 1), the hop
  Azure's front end appends; Microsoft documents the append for Front Door, not in so
  many words for App Service, so the first deploy confirms it. No platform-only header
  (`X-Azure-ClientIP`, `X-Azure-SocketIP`) is documented for Flex Consumption itself, and
  a client could send one directly, so neither is trusted. Limits that hold whatever a
  caller claims: `MAX_PENDING_SUBMISSIONS` (100), `REPORT_DAILY_LIMIT` (30) and
  `COMMIT_LOOKUP_DAILY_LIMIT` (50), each a plain 429.
- **The path check also allows** the two generated per-area site files
  (`site/src/data/commands/<area>.json`, `site/src/data/settings/<area>.json`), which
  `npx vitest run -u` rewrites when a command changes; without them a command fix
  fails CI.
- **The cap is counted from label events** (`triage-claimed`, ranked by event id), so
  concurrent runs agree without a global lock. The daily run also picks up issues a
  run missed and claims left by a run that died.
- **`/api/report` spends the per-IP limit before the commit lookup**, so random
  hashes can't spend the App's GitHub quota; a mistyped hash costs one of the three
  daily reports. A hash that isn't a commit is a 422. A commit found but not on
  `main` (a fork's or a local build's) is accepted and labelled `unverified-build`.
- **Two installation tokens**: `issues: write` for filing and `contents: read` for the
  commit lookup, so the filing token stays exactly as the issue scoped it.
- **Smoke runs on `/api/report` too.** The key marks a report as a smoke run (recorded
  on the persistent issue) but skips nothing there, since that route has no CAPTCHA.
- **Email:** every address except reserved example domains and GitHub noreply is
  redacted from triaged issues (the issue named secrets, hosts, IPs and the denylist).
  The issue → email row is deleted once the closed notice is sent, so a reopened and
  re-closed issue sends nothing more. The closed notice quotes only the last comment
  by an owner, member, collaborator or the Imagile Bot. `@mentions` in submitted text
  get a zero-width space so filing an issue can't ping accounts.
- **Storage is identity-only** (shared-key access off), which needs the deploy identity
  to hold `Role Based Access Control Administrator` on the resource group; listed as a
  manual step.
- **Alerts reuse the existing `ag-cost-email` action group** in `rg-alerts` rather
  than a new one, so no address is committed. Three log alerts every 15 minutes
  ($0.50 each). Log ingestion is capped at 0.2 GB a day.
- **At most 2 on-demand instances** (Flex allows 1–1000), to bound what a flood of
  requests can cost.
- **The webhook secret is a new Key Vault secret, `TOIL-WEBHOOK-SECRET`**, made by
  hand; nothing in `imagile-keyvault` was created or changed.
- **Triage PRs skip `claude-review.yml`**, which skips PRs `imagile-bot[bot]` authored
  because the App can't approve its own PR. A maintainer reviews them.
- **Site form:** the honeypot field is named `website`; the Turnstile widget is the
  existing one, which needs `imagile-dev.github.io` added to its hostnames.
- **The triage steps live in `scripts/triage/steps.mjs`** (review round 3), next to
  `redact.mjs` and the other triage scripts, rather than a new `.github/scripts/`
  folder: `scripts/` is where this repository's tooling lives (CLAUDE.md, Layout), and
  ESLint's tooling rules already cover it. The YAML passes inputs as env and reads
  outputs from `steps.<id>.outputs`; `test/triage-steps.test.ts` runs the steps in
  order through real `GITHUB_OUTPUT` files, and `test/workflow-wiring.test.ts` checks
  every handed-on output in `triage.yml` and `feedback-deploy.yml`. `act` isn't
  installed here, so the select job was not run through it; `handover.sh` was run in
  `node:24.14.0-bookworm-slim` (Docker), since its test runs on Linux only.
- **Review round 4 went past the three-round limit** (the maintainer's coordinator
  continued it because the rounds were converging: each found a narrower issue than the
  last). Round 4: agent-written text and added lines are checked for anything
  credential-shaped before posting (`leak`: nothing posted, `needs-human`, the run
  fails); the agent's file tools are scoped to the checkout with deny rules for `/proc`,
  `/sys`, `/etc` and the runner's temp and home dot-folders; a failed issue gets
  `triage-failed` once and `needs-human` the second time, and a failed manual re-triage
  is never queued. The scoped `Read(./**)` rule follows Claude Code's documented
  permission syntax; it wasn't run locally (the local CLI's sign-in had expired), so the
  first triage run confirms the agent can still read the checkout.
- **The leak check matches token shapes and the job's own secret values, not key
  names** (review round 5): `tokenShaped` applies only the prefixed-token, JWT and
  private-key patterns, so code such as `token: z.string()` passes, and the handover
  compares the agent's output byte for byte with the agent job's OAuth and workflow
  tokens, emptying it and marking `secret-match` on a hit. The key-name rules stay in
  the redactor for incoming issue text. `xox…` tokens joined the shape list.
- **The one-time setup is `infra/bootstrap.sh`** (the maintainer's request, after review
  round 5), run once for real and once more to show it changes nothing. Key Vault
  references resolve through a user-assigned identity (`id-toil-feedback-kv`) the script
  makes and grants Key Vault Secrets User before the first deploy, so the first smoke
  test can pass; the system identity keeps the two storage roles, which needed no
  change. The deploy identity's Role Based Access Control Administrator carries a
  condition limiting it to Storage Blob Data Owner and Storage Table Data Contributor.
  Generated secrets pass through a private temp file (az on Windows can't read
  `/dev/stdin`), removed on exit. The first run stored `TOIL-WEBHOOK-SECRET` with a
  trailing carriage return (Windows' openssl ends lines with CRLF); the webhook got the
  value without it, and the function trims settings, so both sides sign with the same
  64 characters. It was left as it is rather than rewriting a secret, and the script
  now strips `\r` too. The deploy is approved past the $50 rule, to a $60 budget.

### #231 bootstrap fixes

- **Both OIDC subjects are trusted.** This repository issues GitHub's ID-based subject
  (`repo:<owner>@<owner-id>/<repo>@<repo-id>:...`), so the name-based credential alone
  failed sign-in (AADSTS700213). `infra/bootstrap.sh` reads the format from
  `repos/<repo>/actions/oidc/customization/sub` (its `sub_claim_prefix`, or
  `use_immutable_subject` with the owner and repo IDs from `repos/<repo>`) and makes a
  credential for it, `github-feedback-env-ids`, keeping the name-based
  `github-feedback` in case the setting changes back. Custom claim keys can't be
  derived, so the script says so instead of guessing. No ID is written in the
  repository.
- **Monitoring Reader on the one action group.** The alert rules link to the existing
  `ag-cost-email` (`rg-alerts`), which needs read on it (LinkedAuthorizationFailed
  otherwise); the role is scoped to that action group and nothing wider.
- **Role assignments are found with `--all` and compared without case.** `az role
  assignment list --scope` failed ("list index out of range") on the action group id
  as ARM returns it (`microsoft.insights`, upper-case subscription), so the check read
  nothing and the create then hit RoleAssignmentExists. The script now builds that
  scope itself and filters assignments by scope in jq, case-insensitively.
  `MSYS_NO_PATHCONV=1` is set before the first az call, for Git Bash.

### #236 rebrand

- **No token numbers.** The positioning ("the token-efficient alternative to MCP") is
  argued from mechanisms only: compact envelopes, `--select`, `toil wait`, and the
  skill read a file at a time. Nothing was measured, so no figure appears anywhere;
  a measured comparison (one task, CLI plus skill against the same tools over MCP)
  can add one later with its method.
- **The scan line is removed, not replaced.** The beacon behind the crate and the
  drawing's float stay; that was enough motion.
- **Mobile hero:** below 980px the hero's bottom padding drops to `--space-sm` and the
  drawing is cropped to its lines (`aspect-ratio: 960 / 560`, `object-fit: cover`
  from the top), which removes the blank band above the ticker.
- **Feedback is a primary nav link**, not a `wide` one, so it stays inline from
  720px up (measured: no overflow at 720 and 768) and is in the phone menu. The
  footer already linked it.
- **The CLI's own `--help` description** (`src/program.ts`) carries the new line too,
  so the terminal and the site say the same thing.
- **The MCP section stays**, renamed "Still speaks MCP", since `toil mcp` remains for
  clients that want it; "runs where executables are blocked" stays in the
  locked-down section and the README, below the new lead.
- **Two ways to start, from one list.** The homepage's npm and clone cards render
  `site/src/data/start.json` (JSON, so the root test suite never loads `site/`'s
  tsconfig, which needs `site/node_modules`); the README stays the prose source, and
  `test/start-commands.test.ts` fails when a line there isn't in README.md word for
  word. A test rather than one shared file, because the README is plain Markdown.
- **Alpha, not pre-release.** The hero eyebrow, the start section's badge, the
  how-it-works note, the CTA, the README and `install.md` say "Alpha: APIs and flags
  may change before 1.0". The hero's separate install line is gone (the eyebrow says
  Alpha, and the commands moved to the start section). The terminal recording's
  sample version is now `alpha`.
- **`scripts/setup.mjs` keeps its build.** The request said to restore `dist/` after
  building, but the build is the point: the alias runs `dist/toil.js`, so restoring it
  would run the last release instead. The script leaves the build in place and says
  plainly to run `git checkout -- dist/` before `git pull`; the README says the same.
  `--skip-build` is the path that leaves the clone untouched.
- **PowerShell profile:** the script runs `setup alias` as it is, so toil's own
  `pickShell` decides the shell. Only when it answers that PowerShell needs a profile
  does the script ask PowerShell for `$PROFILE` (`pwsh` when PSModulePath names
  PowerShell 7, else Windows PowerShell) and run it again with `--profile`.

### #241 triage bubblewrap

- **The scrub stays on, and the runner gets bubblewrap.** The agent step refused to
  start on #240 because `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` needs bubblewrap. The agent
  job now installs `bubblewrap` from Ubuntu's archive and sets
  `kernel.apparmor_restrict_unprivileged_userns=0` for the runner. A probe on
  `ubuntu-24.04` (run 39177581062, since removed from the branch) showed bwrap 0.9.0
  failing with the restriction on and working with it off. The job then runs
  `bwrap --ro-bind / / true`, and the same with new PID and user namespaces, before
  the agent. The job is pinned to `ubuntu-24.04`, the image the setup was proven on.
- **A decision clears the failure labels.** `apply` now takes off `triage-queued` and
  `triage-failed` with the claim. A manual re-triage of an issue that failed earlier,
  like #240, leaves neither label behind.

### #200 bounded work

Each CPU-heavy synchronous util step, measured on Node 24.14 on a Windows laptop
against the 2 s / 256 MB defaults, with the realistic worst input and the input cap.
"Worker heap" is the bounded worker's peak used heap; "RSS" is the whole process.

| Step | Measured before | Outcome | Limits |
|------|-----------------|---------|--------|
| `util openapi`, JSON parse | 13 MB: 75 ms, 26 MB retained. 62 MB (cap 64 MiB): 330 ms, 124 MB | **Not moved.** JSON.parse is linear and bounded by the input cap, and the command needs the value on its own thread; a worker would add a clone that costs more than the parse | n/a |
| `util openapi`, YAML parse | 18 MB YAML (the 13 MB spec): 0.7 s, needs >256 MB (305 MB worker heap). 58 MB: 2.3 s, 1.35 GB RSS, needs >512 MB | **Moved** (`parse` task). The bytes are copied once and moved to the worker; the value comes back | `DOCUMENT_LIMITS` 15 s / 1,536 MB |
| `util openapi`, schema check | Already bounded (#195), but it cloned the parsed document into the worker: a 62 MB JSON spec crashed the whole process (`FATAL ERROR: Reached heap limit`, inside the worker's deserializer), and a 13 MB spec (3.7 s to validate) came back unchecked at 2 s | **Changed:** the document's bytes are moved to the worker (`source`, `transfer`), which parses its own copy. The 62 MB spec now ends unchecked at the deadline with the process alive; the 13 MB spec validates (4.2 s command, 119 MB worker heap; YAML 5.4 s, 521 MB) | `DOCUMENT_LIMITS`, shared with the parse so both use one warm worker |
| `util report`, SARIF | 62 MB: JSON.parse 260 ms, 90 MB retained; whole command 0.7 s, 473 MB RSS | **Not moved.** Linear, bounded by the 64 MiB cap, and the summary needs the value here | n/a |
| `util size`, one file's outline | 8 MiB (the cap): TS 0.8 s, Python 1.4 s, one-line functions 1.7 s / 611 MB RSS. Nested template literals: `INTERNAL` stack overflow. 8 MB of `# h` headings: never finished (quadratic `slice().find()`, 100 KB took 0.5 s) | **Moved** (`outline` task, `size/outline.ts`). A stack overflow is `parse-error` (counted, not outlined); a deadline or memory limit is an error. Worst real file now 1.8 s / 310 MB worker heap; 2M headings 6.6 s. The headings scan was made linear too | `OUTLINE_LIMITS` 10 s / 512 MB |
| `util size`, outline check (main thread) | 4 MB one-line JSON, 2,000 keys: 15 s, all in `redactText` on every passing line. 600,000 keys on one line: 231 s (a RegExp per symbol over the line) | **Fixed, not moved:** redact only the failures the verifier keeps (5), and match identifiers against one word set per line. 0.39 s and 1.8 s | n/a |
| `util size`, folder totals | 5,000 files, 41 MB: 5.9 s, 219 MB RSS | **Not moved.** Async reads file by file, so it never holds the thread for long; no outline is made | n/a |
| `util md` conversion | 4 MiB (the cap) of ordinary Markdown: 2.3 s, 609 MB RSS. 600 KB of `*a `, `[`…`]`, `[a](` or `_a `: over 60 s each. 100,000 nested `>`: `INTERNAL` stack overflow | **Moved** (`md-convert` and `md-read`, `md/core.ts`): the conversion, then the read back, each sends back printed blocks, not trees. 4 MiB now peaks at 445 MB worker heap (storage), under 4 s; the pathological inputs stop at 10 s with `TIMEOUT`, the nesting is `INVALID_INPUT` | `MD_LIMITS` 10 s / 1,024 MB |
| `util c4` layout | Already bounded (#174). Worst view the limits allow (100 boxes, 250 arrows): 0.54 s, 43 MB worker heap | **Confirmed;** a memory or stack limit was `INTERNAL`, now `INVALID_INPUT` through `boundedError` | defaults |
| `util log --grep` | The only flag that compiles user input as a RegExp (audited: `new RegExp`, `RegExp(`, `.match`/`.search`/`matchAll` with a string, across `src/`). `(a+)+b` against 40 a's: never finished. 200 MB log with `TS\d+`: 3.8 s | **Moved** (`grep` task, `grepBounded`): lines go in batches of 4,096 (or 1 MiB of text), each batch under the deadline. `(a+)+b` now stops at 2 s with `TIMEOUT` naming the lines. 200 MB log: 4.8 s (+1 s), 390 MB RSS | defaults, per batch |

Decisions:

- **Errors.** `boundedError` / `boundedStep` in `kit/bounded.ts` turn a step that
  couldn't finish into the error its command fails with, naming the step and the
  limit: `TIMEOUT`, `INVALID_INPUT` (memory or stack: the input asked for more than
  one step may use), `CANCELLED`, `NOT_CONFIGURED` (Node's permission model denying
  workers). Only an unplanned failure is `INTERNAL`. A `ToilError` thrown inside the
  worker (YAML's line and column, md's storage refusal) comes back as `refused` and is
  rethrown as it was. No new error code.
- **Per-step limits** are constants beside each step, with the measurements, rather
  than options: the defaults stopped real input for YAML, md and outlines. Tests pass
  shorter ones.
- **New shared modules** `md/core.ts` and `size/outline.ts` hold the synchronous
  halves the worker runs, so the worker bundle never reaches `kit/bounded.ts` (its own
  source string) or zod. `check:pure` covers them through the worker's metafile, as
  before; nothing changed in it.
- **Out of scope, found:** `src/core/wildmatch.ts` compiles `.gitignore` globs to
  backtracking regexes, so a line like `*a*a*a*a*a*a*b` in a repository's
  `.gitignore` takes 0.6 s on a 50-character file name and over 20 s on 100, in any
  command that walks files. It's core and runs per path, so a worker is the wrong
  fix; a non-backtracking glob matcher is. Left for its own issue.
- **Review round 1.** `validateAdf` runs under `MD_LIMITS.maxMemoryMb`, so an ADF
  conversion's steps share one warm worker instead of restarting it for each memory
  limit (a test counts one start). Only V8's "Maximum call stack size exceeded" is
  `stack` (`kit/stack.ts`, used by the worker and its host); `Invalid string length`
  and other RangeErrors are failures, reported through `boundedError`.

### #249 UI server

`ui/` becomes the publishable `@imagile-dev/toil-ui` package with its local server,
as #206's Local first, Packaging and release, and Hosting-ready by design sections
describe.

- **The server is `node:http`** (`ui/server/server.ts`), no framework, so the
  package's one runtime dependency is `@imagile-dev/toil`, pinned exactly. Vite's
  SSR build bundles `ui/server/main.ts` into `ui/dist/server/toil-ui.js` (the
  bin), with the preview's fixtures inside for `--sample`. Only Node built-ins and
  `@imagile-dev/toil` stay external; a build plugin records the bundle's imports,
  as the bundler resolved them, in `ui/dist/metafile-server.json` for
  `check:package`. The server type-checks against the pinned toil's published
  `dist/api.d.ts` (`ui/tsconfig.server.json`), which is what the bundle runs with.
- **Two app builds from one `index.html`.** `vite build` is the site preview
  (`ui/dist/preview/`, `src/main.tsx`, unchanged); `vite build --mode app` is what
  the package serves (`ui/dist/app/`, `src/local.tsx`). The site's
  `scripts/ui-preview.mjs` copies `dist/preview/` and finds vite through the
  workspace's resolution instead of `ui/node_modules`.
- **The seam stays `execute()`.** The App is unchanged: `src/server-client.ts`
  gives it an `execute()` that POSTs to `/api/execute`, and an `Agent` over
  `/api/agent/*`. The Agent's starters are fetched for each dossier before the App
  mounts, because the App asks for them while it renders and the browser interface
  is synchronous; changing that interface would have touched the views being built
  in parallel.
- **`Store` and `Agent` are the server's interfaces** (`ui/server/store.ts`,
  `ui/server/agent.ts`), each taking the `RequestContext`. Stores: `toilStore`
  (toil's own `execute()` from `@imagile-dev/toil/api`) and `fixtureStore` (the
  preview's fixture). #250's SQLite cache is a third Store answering the same toil
  calls. Agents: `fixtureAgent` (scripted) and `noAgent`, which offers no starters
  and answers a question with a plain "no agent is set up yet"; #251's adapters
  implement the same interface. `toil-ui` picks toil and no agent; `toil-ui
  --sample` picks the fixture pair, and the App shows the preview banner.
- **The request `viewer`** (`ui/server/context.ts`): every API request gets a
  `RequestContext` with the viewer and an abort signal (the browser going away
  cancels the call), and the Store and Agent read the viewer from there, never from
  a global. In v1 it is always `{ id: 'local', name: <OS user>, via: 'launch-token' }`.
- **The launch token, and no cookie (review round 1).** A random 32-byte token per
  start, printed once in the URL. The page (`src/server-client.ts`) POSTs it to
  `api/session` and gets back a fresh session id and a CSRF token. It keeps both in
  memory only, sends the id as `X-Toil-UI-Session` on every API call, and takes the
  token out of the address bar with `history.replaceState`. The API refuses any call
  without the header; a session id in a cookie counts for nothing. No response ever
  sets a cookie. The first version used a session cookie, but cookies ignore ports,
  so the browser would hand it to any other server on `127.0.0.1`. On a shared host,
  that server could be another account's, which could then read through the
  user's connections. The static files hold no data, so they're served with no
  session at all.
  - **The trade-off:** a reload, or a new tab, forgets the session. It needs the
    launch URL again, and the page says so. Keeping the id in `sessionStorage`
    would survive a reload, but it would put a credential on disk-backed storage
    that any script on the origin can read, for no gain a launch URL can't give.
  - **The token** stays good for the whole launch, so the URL can be opened again.
    Each sign-in is its own session, and a launch holds at most 32 (the oldest is
    dropped).
- **The Host check** is exact: only `127.0.0.1:<port>` (or `[::1]:<port>`), the
  host it printed. `localhost` is refused too. No CORS header is ever sent; OPTIONS is a 405. Every response carries a
  CSP (`script-src 'self'`; inline styles allowed, because the App writes its theme
  tokens into a `<style>` element), `Referrer-Policy: no-referrer`, `X-Frame-Options:
  DENY` and `Cache-Control: no-store`.
- **Ready for the config pages (#253).** Every POST needs the page's own `Origin`, a
  JSON content type, and the session's CSRF token in `X-Toil-UI-CSRF` (given at
  sign-in). `/api/execute` runs only `READ_COMMANDS`, the 18 commands the
  views read (a test holds the list to every command the fixture answers), always
  `readOnly: true`. `/api/config` is the one path where `readOnly` is false: it
  runs only commands in the server's `configCommands` allowlist, empty in this
  release, so #253 adds its config commands there and nowhere else. Anything else
  is a 403 with toil's own refusal envelope, before a Store sees it. Every call, read
  or config, is `caller: 'toil-ui'`, so the audit log names it. The page can't
  loosen any of this: the client never sends `readOnly` or `caller`.
- **Settings:** `--host`, `--port`, `--base-path`, `--data-dir`, each with a
  `TOIL_UI_*` env var; a flag beats its env var, which beats the default
  (`127.0.0.1`, port 0 so the OS picks a free one, `/`, `~/.toil-ui`). Any host but
  `127.0.0.1` or `::1` is refused with a fix. The data folder is resolved but not
  created yet; #250 is its first user.
- **No browser is opened.** That would mean spawning a program; `check:package`
  fails if the server imports `child_process` at all.
- **Packaging.** `"workspaces": ["ui"]` at the root and one lockfile (the old
  `ui/package-lock.json` and `ui/.npmrc` are gone; the root's `.npmrc` already sets
  `save-exact` and `engine-strict`). The tarball is `dist/server/toil-ui.js`,
  `dist/app/`, `README.md`, `LICENSE` (toil's, held equal by a test) and its own
  `NOTICE` (React, and the three fonts under the OFL). `ui/scripts/package-rules.mjs`
  holds the allowlist and package.json rules; `ui/test/package.test.ts` packs on
  every test run, and `npm run check:package -w ui` checks the build. `npm run smoke
  -w ui` packs both tarballs, installs them offline with scripts off, and drives the
  installed bin over HTTP, with `--sample` and against the installed toil. CI runs
  all of it inside `CI ok` on every OS and Node version.
- **The toil pin is exempt from the 14-day rule.** It names this repository's own
  release, which the node-workspace plugin rewrites on every toil release.
- **The workspace doesn't link the root.** npm workspaces link only workspace
  members, never the root package, and npm ignores an `overrides` entry for the
  root's own name (tried: `"@imagile-dev/toil": "file:."` had no effect). So the dev
  tree holds the registry's toil at the pinned version; only the server's
  type-check and a run from a clone use it. On a release PR the node-workspace
  plugin rewrites the pin and the lockfile's version for it while the resolved
  tarball still names the previous release; a local simulation of release-please
  17.11.2's updaters on this lockfile showed `npm ci` still succeeds on that branch,
  so the release PR's CI and its `dist/` rebuild keep working. `publish-ui` then
  checks that npm serves the pinned toil before it publishes, and its smoke installs
  the UI beside the freshly packed toil.
- **Release.** `release-please-config.json` adds the `node-workspace` plugin, `ui`
  as a second package (`component: toil-ui`, tag `toil-ui-v…`, toil's alpha
  settings), and `"exclude-paths": ["ui"]` on the root; the manifest gets `"ui":
  "0.0.0"`. The root's `extra-files`, tag and the committed `dist/` are untouched.
  `release.yml`'s `publish` job is renamed `publish-toil` with no other change, and
  `publish-ui` needs it, runs when toil published or had nothing to release, and is
  skipped when toil's publish failed. It uses the same `NPM_TOKEN`, provenance,
  alpha dist-tag script (`test/release-workflow.test.ts` holds it word for word to
  toil's, but the package name) and Discord notices. The dry run
  (`release-please release-pr --dry-run`, 17.11.2, against the pushed branch)
  proposed one PR: toil 0.1.0-alpha.3 with only the commits outside `ui/`, and
  toil-ui 0.1.0-alpha.1 with the UI commits and "@imagile-dev/toil bumped from
  0.1.0-alpha.2 to 0.1.0-alpha.3".
- **Docs.** A `skills/toil/ui.md` doesn't fit: the skill's tests take a file only
  for a registered area, and the UI isn't one, nor should toil's skill carry a
  separate product. `ui/README.md` is the reference instead, its npm page, and
  `/docs/ui/` renders it (the remark plugin drops its first heading as it does for
  skill files), with the package's description as the lead, so the page has no prose
  of its own. The docs index links it; the root README says "alpha, local only".
- **Local review.** Fixed: `publish-ui` gates on `!cancelled()` rather than
  `always()`; its check that npm serves the pinned toil retries six times, ten
  seconds apart, for registry lag; a file name that only starts with `..` is
  served, and any path with a colon is refused (a Windows stream such as
  `index.html::$DATA`). Two findings kept as they are: the release PR's `npm ci` was said to
  fail once the pin names an unpublished toil, but the simulation above (the real
  updaters on this lockfile, then `npm ci`) passes; and the launch token stays
  reusable for the launch, as Jupyter's is, so a second browser, or the same one
  after it closes, can sign in again without a restart. Whoever can read the
  printed URL can already use the UI, so a single-use token would cost the user
  restarts and protect nothing new. Review round 1 replaced the cookie with the
  header session above, and gave `vite.server.config.ts` its dry line.

### #250 UI sync

Toil UI's sync and SQLite cache (#206 point 2), on the server #249 built.

- **The sync replays the dashboards' own calls.** `ui/server/sync.ts` loads each
  dossier with the views' loader (`src/load.ts`, unchanged), through an `execute()`
  that goes to toil's real one (`readOnly: true`, `caller: 'toil-ui'`, the progress
  callback, an abort signal). So the cache holds exactly the calls the views make,
  and the new `sqliteStore` answers them by `(dossier, command, input)`. The
  dashboards render from the cache unchanged; a test loads every sample dossier
  both ways and compares items, changes and deployments. The other choice, a sync
  with its own list of calls, would drift from the views on every new panel.
- **Incremental where toil can say "since".** `jira search` and `ado work search`
  get `updatedSince` (the source's watermark: the last good sync's start, minus five
  minutes for clock skew) and are merged into the last copy by key. The GitHub board
  (`projects list-items`) has no `updatedSince`, so it is read whole and an item
  counts as changed when its issue's `updatedAt` moved. Batches (`ado work
  get-batch`, `github get-issue`) and histories (`jira get-changelog`, `ado work
  revisions`, `github issue-events`) are fetched only for changed and new items. Pull
  requests, builds, deployments and iterations are read again every sync. Every call
  follows `meta.page.nextCursor` up to 200 pages and fails its source past that,
  saying so. A full sync happens when a source has no watermark or no last copy. Not
  handled: an item deleted in its tracker stays until retention or a wipe (an
  incremental search can't report deletions); the README says so.
- **A failing source never blanks.** A source is one area of one dossier. When a
  call fails, the loader gets that call's last good copy, so items, changes and the
  normalized tables keep it. The source is marked `failed` with toil's message and
  fix, its watermark doesn't move (the next sync asks from the old one), and the
  Store adds a `STALE` warning to its envelopes. A source that worked drops its
  responses the sync didn't touch. A failed `dossiers show` keeps the dossier's
  data. A dossier toil no longer lists is forgotten.
- **Schema.** `responses`, `items` (OWI JSON plus indexed columns), `transitions`,
  `change_refs` (pull requests, builds and deployments), `sources` (per dossier and
  area) and `dossiers` (last sync time). Versioned with `PRAGMA user_version`, one
  migration per step in a transaction. A file from a newer Toil UI is refused with a
  fix (`toil-ui wipe`) instead of read wrongly.
- **`node:sqlite` still prints an ExperimentalWarning on Node 24.14.** It is
  imported dynamically (`ui/server/sqlite.ts`), with `process.emitWarning` filtering
  that one warning for the import and restored after. Every other warning still
  prints. The smoke test checks stderr has no such line.
- **Data folder.** `<dataDir>/cache/toil-ui.db`, created owner-only (0700 where POSIX
  modes exist). `--retention-days` / `TOIL_UI_RETENTION_DAYS`, default 30, 1 to
  3650; rows not synced within it are deleted at start and after each sync.
  `toil-ui wipe` removes the `cache/` folder. The page's **Wipe the cache** closes
  the file, removes the folder and opens an empty one inside the server.
- **A lock file, not the OS's file locking (review round 1).** Windows refuses to
  delete an open database, but macOS and Linux unlink it, and the server went on
  serving the "wiped" rows from the unlinked file. So the open cache holds
  `<dataDir>/toil-ui.lock` (pid, a random token, start time; created with `wx`).
  `toil-ui wipe` refuses with the same "Toil UI is running; stop it, or use Wipe in
  the UI." on every OS while the lock's pid is alive (`process.kill(pid, 0)`, with
  EPERM counting as alive), and takes over a lock whose process has gone. Only the
  holder's token passes, which is how the in-app wipe gets through. A second server
  on the same data folder is refused at start for the same reason, unless the lock names this process's own pid: that is a crash's lock with the pid reused (review round 2), and the refusal names the lock file to delete. `~` at the start of
  `TOIL_UI_DATA_DIR` is expanded, since env vars don't go through a shell. Path
  handling is tested with `path.win32` and `path.posix`.
- **Progress by polling, not SSE.** The API's session is a header, never a cookie
  (#249), and `EventSource` can't send headers, so the page polls `GET api/sync`
  once a second while a sync runs. `POST api/sync` starts one (409 while one runs);
  `POST api/cache/wipe` needs `{ "confirm": "wipe" }` and is refused while syncing.
  With `--sample` there's no sync: those routes are 404 and the panel is hidden.
- **The SPA hook is one new component.** `src/sync-panel.tsx` (its own CSS) renders
  under the App from `src/local.tsx`, so `src/views/` and `App.tsx` are untouched
  for #255. The App is remounted after a sync or wipe, and its `now` is the newest
  dossier sync, so the header line ("Data read … through toil") says when the data
  was synced. The wipe confirmation is inline, with Cancel focused and Escape to back
  out, not a modal.
- **Verified end to end** with the built `toil-ui` and the real toil against a local
  Jira Data Center stub: the first sync read three search pages and seven
  changelogs; after one issue changed, the second sent `(project = LAB) AND updated
  >= "…"` and one changelog; with the stub returning 503, the source showed failed
  and stale, and the dashboard kept all seven items.

### #253 configuration

#253's item 4: Settings pages for Connections, Dossiers, and Bounds and time limit,
driving toil's own config commands through `@imagile-dev/toil/api` on the local
server.

- **The allowlist** (`ui/src/config.ts`, enforced in `ui/server/config.ts`) is
  `connections list`, `test`, `add`, `login`, `default`, `writes` and `remove`, and
  `dossiers list`, `show`, `check`, `init`, `add-repo`, `link` and `field`.
  `connections login` is in it because "replace a secret" is toil's login path. The
  reads run `readOnly` even on the config path; only the changes run with readOnly
  off, each through its own checks. `ui/test/config.test.ts` holds the list to the
  registry: every read writes nothing, every change is `writesLocal` and never
  `writes`. Anything else, a tracker write included, is a 403 before a Store sees it.
- **A core change: `person` on `execute()`.** The connections commands that change
  connections were CLI only and ask their questions on a terminal, and the API
  refused them, so nothing could take a secret without a TTY. `ExecuteOptions.person`
  (`{ ask(question) }`) is the general way: with one, `execute()` also runs
  `connections add`, `login`, `remove`, `writes` and `default`
  (`registry.personCommands`) and asks every question through it. The `Prompter`
  gained a question id (`area`, `setting:<key>`, `secret:<key>`, `confirm`,
  `confirm-name`), so a host can match a question to a field. The terminal ignores
  the id. An unanswered question is `CANCELLED`, with nothing saved. Turning writes
  on still asks for the typed name: the command's own gate, unchanged. The other
  CLI-only commands (`setup alias`, `dossiers remove`, `skills marketplace remove`)
  stay refused. `docs/bounds.md`'s `commands.cli-only` row says so.
  **This loosens a security-class bound for API hosts, which is the maintainer's
  call:** a program could pass a `person` that answers by itself. The program is
  in-process code the user installed and runs, which could already write
  `~/.toil/config.json` itself. No agent can reach this path: MCP is unchanged.
- **Two additive registry fields:** `registry.areas[].connection` (what
  `connections add` asks for, in order, with `secret`, `password`, `default` and
  `required`), so the add form needs no copy of each area's schema; and
  `registry.personCommands`. `connections list` adds `definedIn: file | env`, so an
  env-only connection is shown read-only. With an older toil it falls back to "every
  value from env or CI".
- **Secrets:** the page sends them in the one request's `secrets` object, never in
  `input`, so they never reach the audit log's input. The server's `personFrom()`
  answers a hidden question only from `secrets` and a visible one only from
  `answers`. The page clears each password field when it submits. The test sweeps
  every response, the audit log, the config file and everything the process printed
  for the typed secrets.
- **Bounds and time limit have no command**, so they're shown read-only. The bound
  comes from toil's own `BOUND_RELAXED` warning on `connections list`. The time
  limit is `TOIL_TIMEOUT_MS` in the server's env (the env toil runs in), with toil's
  default, which the test holds to `DEFAULT_TIMEOUT_MS`. No file is read or edited.
- **The pinned toil.** The server type-checks and ships against the published
  0.1.0-alpha.2, which has neither `person` nor `connection`. With it, the add form
  says to use the CLI, and a person's command comes back as toil's own refusal. The
  release PR's pin bump brings both. `ui/src/toil.ts` declares `person` on the UI's
  own `ExecuteOptions`, and the registry test still holds that type to the source's.
- **Preview:** `ui/src/fixtures/config.ts` answers the reads from sample data. The
  areas come from `config-areas.json`, which the test holds equal to the registry,
  and the probes are held to each area's own probe. Every change button is
  disabled, with a note on the page and beside each button saying why. `toil-ui
  --sample` serves the same. The App takes `config` as a prop, so the fixtures stay
  out of the app bundle.
- **Forms are native elements** (`input`, `select`, `textarea`, `button`), which are
  accessible as they come. Each change is a `form` named by its heading, saying what
  it does and the command it runs, with a live `status` or `alert` for toil's
  answer.
- **One canonical form for dossier folders (round 2).** `src/core/dossier.ts`'s
  `real()` real-pathed a folder only once it existed, and otherwise returned it as
  spelled. So the first `dossiers init` under a home spelled another way (macOS's
  `/var` for `/private/var`, a Windows 8.3 name such as `RUNNER~1`) compared a
  real-pathed file against an unresolved `~/.toil/dossiers`, and was refused as
  "one of toil's own files". `real()` now resolves through the nearest existing
  folder, as the write check's `realish()` did, and the two are one function.
  `test/api-person.test.ts` covers it with a home reached through a junction.

### #208 #209 #210 UI themes

Harvest, Starship and Realm, built as theme packs on the skin registry #206
describes, in one PR because they share the registry, the rules and the bar.

- **The skin registry has all seven slots** (`ui/src/skins.tsx`): `Card`, `Panel`,
  `Avatar`, `ChatMessage`, `EmptyState`, `Loading` and `Header`, through context.
  A wrapping slot is handed the default content as `children` and must render it,
  so a skin can add art but never take away a word, link or button. Skins exist
  only in `BUILT_IN_SKINS`; nothing reads one from a theme folder.
- **Renamed words carry the real one** (`terms` in `theme.json`, `useTerm()`): six
  keys (`epic`, `board`, `dependencies`, `sprint`, `agent`, `blocked`), always shown
  as "Quest (Epic)". Plain renames nothing. The graph now says "Blocked" on a blocked
  node in every theme, where it was colour alone before.
- **User themes are checked, not yet served** (`ui/server/user-themes.ts`, rules in
  `ui/src/theme-rules.ts`, shared with the built-in themes' test). A theme in
  `~/.toil-ui/themes/<name>/` is refused whole, with each reason, if it holds any
  file other than CSS, JSON, SVG, WebP, PNG, AVIF or WOFF2, anything that runs
  script in its CSS or SVG, a `skins` key, an `@import`, a `url()` outside its own
  folder (a remote `url()` on an attribute selector would read the page out), fonts
  or a radius that could break out of the stylesheet, a link, or a built-in theme's
  name. The picker and a route for these files come with milestone 8; the gate came
  first so it can't be skipped later. (Superseded by #283: user themes were removed,
  and the milestone 8 plan for them dropped.)
- **The boundary is the Content-Security-Policy, the checker explains** (#259 review; the checker and the tokenizer were removed in #283, and the policy stands).
  Regular expressions over raw CSS were walked past five ways (a quoted `)`, escapes
  in `url` and in a scheme, `image-set()` strings, an escaped `@import`). Two layers
  now. `ui/server/csp.ts` sets one policy on every response the toil-ui server sends,
  and the built page carries it as a `<meta>` (less `frame-ancestors`) for the site
  preview: `default-src 'none'`, script, style, font and connect from `'self'` only,
  images from `'self'` and `data:`, `base-uri`, `form-action`, `frame-ancestors`,
  `object-src`, `worker-src`, `media-src` and `manifest-src` all `'none'`. No
  `'unsafe-inline'`: the theme tokens are a constructed stylesheet
  (`adoptedStyleSheets`, CSSOM rather than markup), the build keeps fonts as files
  (`assetsInlineLimit`), and the one `<style>` React Aria adds (`touch-action` for
  presses) is allowed by its SHA-256, which `ui/test/server.test.ts` recomputes from
  React Aria's source. The checker (`userCssProblems`) reads a user's CSS through
  `ui/src/css-tokens.ts`, a tokenizer written to CSS Syntax 3 section 4 (escapes
  decoded, strings and `url()` whole, bad strings and urls refused), with no new
  dependency. It allows only `@media`, `@supports`, `@font-face` and `@keyframes`,
  and refuses any `url()`, or string inside `src()`, `image()`, `image-set()` or
  `cross-fade()`, that isn't a plain relative path in the theme folder
  (`[A-Za-z0-9_.-]` segments, no `.` or `..`, no `%`, `\`, `?` or `#`).
- **`site/dist/` is git-ignored** beside `site/.astro/`; it was committed by mistake.
- **Each theme's stylesheet loads when it's picked** (`loadThemeStyles`): Plain is the
  only one in the first load; Crate, Harvest, Starship and Realm are their own CSS
  chunks, with their fonts and art. Manifests stay up front, since the picker lists
  them.
- **One scheme each:** Harvest and Realm are light, Starship dark. Harvest's day and
  night is a sky strip that follows the sprint instead (`--sprint-progress`, set by
  the dashboard, 0 on day one to 1 on the last; midday elsewhere). The sprint panel
  says the day in words, so the sky is decoration.
- **Crops grow by column:** a seed in To do, a growing plant in In progress, a basket
  in Done, so each move to the next column is a stage. Realm's cards name the quest
  (epic) they belong to. Starship's and Realm's dependency graphs are CSS over the
  same xyflow drawing: stars and lanes, and a map with roads and mountain passes.
- **Art is SVG drawn for the themes** (pixel grids for Harvest, line art for the
  others), from a scratch script, not the image-generation skill: SVG stays small,
  sharp at any size and themeable, and the repository's style rules are toil's own
  brand, which these themes deliberately aren't. Every image is `alt=""` or
  `aria-hidden`. Assets are capped at 64 KB a file and 160 KB a theme by a test.
- **Fonts, all SIL OFL 1.1 through Fontsource 5.3.0** (installed `--before` a date 14
  days back): Pixelify Sans; Orbitron and Exo 2; Cinzel, Cinzel Decorative and EB
  Garamond. Recorded in `ui/NOTICE`.
- **The bar, as tests:** `ui/test/themes.test.ts` holds every theme to the file rules,
  token contrast (WCAG AA), listed assets, size caps, motion only inside
  `prefers-reduced-motion: no-preference`, and no sound. `ui/test/theme-bar.test.tsx`
  runs every theme and scheme through axe on every route and requires the same click
  targets (role and name) as Plain, plus the sync panel's stale and wipe states.
  No theme plays sound; none of the three issues asks for it.

### #251 agent adapters

Toil UI's agent (#206 point 4): one server-side `Agent`, three adapters, read-only
tools, checked citations and proposals, on the server #249 built and the cache #250
fills.

- **Packages, checked against the registry and each package's own `.d.ts`** (not
  guessed): `@anthropic-ai/claude-agent-sdk` 0.3.289 (licence "SEE LICENSE IN
  README.md", Anthropic's commercial terms), `@github/copilot-sdk` 1.0.16 (MIT) and
  `@openai/codex-sdk` 0.160.0 (Apache-2.0), each the newest release at least 14
  days old. They are optional `peerDependencies` (`>=` those versions), with `zod`
  `^4.0.0`, the Claude SDK's own peer, which its tool schemas are built with. None
  is installed, bundled or listed in `NOTICE`; `check:package` now holds the peer
  list to exactly these four, each optional. The server loads one with a dynamic
  `import()` of a variable specifier only when it's chosen, so the bundle's recorded
  imports are unchanged.
- **One `Runtime` per adapter, one `AgentHost`** (`ui/server/agents/`). The host
  loads the SDK, finds the CLI, builds the dossier's tools and ledger, streams, and
  runs the checks; each runtime only maps that onto its SDK. The server's `Agent`
  gains an optional `stream()`; the browser's gains `notice`, and `Answer` gains
  `unverified` and `warnings` (all additive).
- **The CLI already on the machine, never a download.** `findCli` takes the path set
  in Settings, else searches `PATH` (on Windows a `.exe` first; a `.cmd` or `.bat`
  shim is refused with a fix, because the SDKs spawn without a shell), and hands the
  path to the SDK: `pathToClaudeCodeExecutable`, `RuntimeConnection.forStdio({ path })`,
  `codexPathOverride`. So no SDK falls back to its bundled copy. Not found is a plain
  `AgentError` with a fix.
- **Locked down per SDK.** Claude: `tools: []`, `settingSources: []`,
  `strictMcpConfig`, an in-process MCP server with only Toil UI's tools,
  `allowedTools` naming exactly those, `permissionMode: 'dontAsk'`,
  `persistSession: false`, and a working folder of its own (`<data>/agent/`). A
  result marked `is_error` (a failed sign-in) is an error, not an answer. Copilot:
  `availableTools` is only `custom:<name>` for Toil UI's tools, each
  `skipPermission`, every permission request rejected, and the system message
  replaced. Codex: read-only sandbox, approvals never, web search off, and
  `features.*=false` for the shell, unified exec, apps, plugins, sub-agents, browser,
  computer use, image generation and memories (names from `codex features list`,
  codex-cli 0.156.0).
- **Codex takes tools only from MCP servers,** so Toil UI serves them on its own
  loopback server (`POST api/agent/mcp`, the plain-JSON form of streamable HTTP:
  `initialize`, `tools/list`, `tools/call`, `ping`) for one question at a time,
  behind a random bearer token made for it and dropped when it ends. The token
  reaches Codex through `bearer_token_env_var`, in its environment, never its argv.
  The whole `mcp_servers` table is replaced with an inline table, so no server from
  the user's Codex config comes along. The route has no session (the caller is the
  CLI) and refuses any request with an `Origin`. Claude and Copilot take in-process
  tools, so they don't use it.
- **Tools.** `owi_query`, `owi_get` and `owi_history` over the cache (no `native`
  record, bodies cut at 4000 characters, at most 200 items with a "more" note);
  `proposal_fields`, a write command's input fields from the registry, so a
  proposal's input is one toil accepts (added after the smoke run, where the model
  guessed `fields: { parent }` for `jira update-issue`); and `toil mcp`'s read tools,
  by their MCP names, for 19 listed commands, each only if the registry says it
  never writes (`writes`, `writesLocal` and `writesDependOnInput` all false). A live
  tool hides `dossier`, `cwd`, `connection`, `select` and any `*File` field, forces
  the dossier, and calls `execute()` with `readOnly: true` and `caller: 'toil-ui'`;
  a result over 60,000 characters is cut and says so. One tool spec serves all three
  SDKs: JSON Schema for Copilot and Codex, turned into zod for Claude.
- **Citations held to the tool results.** Every tool call adds the ids it returned
  to a ledger: items, their parents, children and link targets, and the pull
  requests, builds and deployments `owi_get` returns (live results through
  `mapOwi`). After the answer, every id it names must be in the ledger: cited as
  `[[id]]`, written bare as `<connection>:<key>` for a connection the ledger has, or
  a tracker key such as `PAY-999` in a project the ledger has (so `UTF-8` isn't
  one). Anything else is listed in `unverified`, and the pane flags it above the
  answer. An answer that read items and cites none is warned too.
- **Writes are proposals, parsed from fenced `proposal` JSON blocks.** A proposal
  must name a command the registry marks `writes`, with input whose fields the
  command has and whose required fields are there; otherwise the card says why and
  shows no command line. The dossier is forced to the one on screen and
  `allowWrite` is dropped from the model's input; the card's line comes from #255's
  `commandLine`. At most 10 per answer. Nothing in the agent path can run one: there
  is no write tool, and the tests assert the tool list and that `execute()` saw only
  read-only reads.
- **Streaming is NDJSON over fetch** (`stream: true` on `POST api/agent/ask`), one
  line per version of the answer, each the whole of it so far, then `{ "done": true }`
  or `{ "error": { message, fix } }`. Not SSE, for #250's reason: the session is a
  header. Half-written citations and proposal blocks are held back until they
  close, and Markdown bold is taken off, since the pane shows plain text.
- **Starters:** stand-up digest, "Why is this sprint at risk?", backlog hygiene,
  dependency risk, and release notes, each written for the dossier on screen. The
  cross-team roll-up #206 lists is left out: it spans dossiers, and an answer is
  about one dossier.
- **Settings** (`<data folder>/agent.json`, owner-only, written through a temporary
  file): `adapter` (`none`, `claude`, `copilot`, `codex`), `model`, `cliPath`
  (absolute) and, for Claude only, `endpoint` (`anthropic`, `bedrock`, `foundry` or
  `vertex`, which set `CLAUDE_CODE_USE_BEDROCK`, `_FOUNDRY` or `_VERTEX` and unset
  the others). Any other field, such as `apiKey`, is refused with a fix: there is no
  place for a secret, because each SDK signs in the way its CLI does. Copilot's BYOK
  needs a key in the session config, so it isn't offered. `GET` and `POST
  api/agent/settings` sit behind the session and CSRF like every POST, and answer
  404 with `--sample`, which always uses the scripted agent. The Settings view gets
  an Agent panel from its own file (`ui/src/agent-settings.tsx`), so #253's work on
  that view merges cleanly; the preview shows what the local app offers and changes
  nothing.
- **Bounds:** two questions at a time, an 8000-character prompt, 30 turns for
  Claude, and 10 minutes for Copilot's wait.
- **Smoke run (real).** `claude`, `codex` and a `copilot` shim are on this machine's
  `PATH`. The `copilot` there is a VS Code shim (`.bat`) that prints "Cannot find
  GitHub Copilot CLI", which `findCli` reports as a shim. Claude Code's own sign-in
  had expired ("OAuth session expired"), and Toil UI can't sign in for the user; that
  run is what found the `is_error` result. The Codex run worked end to end: the real
  server on loopback, the real Codex SDK 0.160.0 installed with `--omit=optional` (so
  no bundled binary), the `codex.exe` on `PATH`, the sample dossiers synced into a
  throwaway cache, and `POST api/agent/ask` with `stream: true`. It answered
  "Backlog hygiene" in about 75 seconds with ten cited items, none unverified, and
  six proposals (`jira add-comment`, and `jira update-issue` with
  `--field 'Epic Link=…'`), none run.
- **Review round 1.**
  - **An environment allowlist for the agent CLI** (`ui/server/agents/env.ts`), the
    approach git takes: PATH and PATHEXT, the home, profile, AppData and temp folders,
    SystemRoot, windir and ComSpec, locale and TZ, the XDG folders, the proxy
    variables and the CA variables (`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`,
    `SSL_CERT_DIR`). On top of that, each CLI's own sign-in and config: Claude
    `ANTHROPIC_*`, `CLAUDE_CODE_*`, `CLAUDE_CONFIG_DIR`, and Bedrock's `AWS_*` and
    Vertex's `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`,
    `CLOUD_ML_REGION` and `VERTEX_REGION_*`; Copilot `COPILOT_*` and `GH_HOST`;
    Codex `CODEX_*` and `OPENAI_*`. Nothing else is passed: no `TOIL_*`, no
    `GITHUB_TOKEN` or `GH_TOKEN` (Copilot's own variable is `COPILOT_GITHUB_TOKEN`),
    and no CI tokens. Copilot now gets an explicit `env` on its stdio connection
    instead of inheriting.
  - **`findCli` skips relative `PATH` entries and the working directory,** git's rule
    from `src/core/git.ts`: an empty or relative entry, the working directory and
    anything under it are never searched, except that a home folder inside the
    working directory stays searchable. Case is folded on Windows.
  - **The run count** is taken right after the `MAX_RUNS` check and given back in a
    `finally` that covers the SDK load and the CLI search too, so a failed load can't
    leak a place.
  - **A CLI path in Settings must name the adapter's own CLI:** its basename is
    `claude`, `copilot` or `codex`, or on Windows that name with `.exe`, in any case.
    So Settings can't point the agent's arguments at another program. A `.cmd` is
    refused here too (review round 2), since `findCli` would refuse it as a shim the
    SDKs can't start, and the shim fix names only the `.exe`. A
    path with no adapter chosen is refused. The check sits in `checkAgentSettings`,
    which `POST api/agent/settings` runs, and also when the saved file is read.

### #244 linear wildmatch

- **The matcher walks a set of live positions instead of compiling to a RegExp**
  (`src/core/wildmatch.ts`). The pattern becomes a list of steps (one character, a run
  of `*`, a mid-pattern `**/`), and each path character moves every live position at
  once, deduplicated, so a match costs O(steps x path length) with no backtracking.
  A set walk was chosen over a memoised (pattern index, path index) table because it
  needs no recursion and no table the size of both inputs.
- **Semantics are kept by reusing the old pieces, not by re-deriving them.** The
  compiler reads the pattern exactly as before; a bracket class, and a literal under
  `caseFold`, become a one-character RegExp, anchored at both ends with the old flags, which can't
  backtrack and folds case exactly as the whole-pattern RegExp did. A reversed range
  such as `[b-a]` still throws the same `SyntaxError` when the pattern is compiled.
- **`wildmatch()` returns `{ test(path) }` instead of a `RegExp`**, and
  `IgnoreRule.regex` is now `IgnoreRule.match`. Both callers only ever called `test`.
- **A check on the pattern's plain first and last characters runs before the walk**,
  because most paths a walk meets fail there (`*.log` against `index.ts`). Under
  `caseFold`, an ASCII literal compares against its two cases instead of asking a
  RegExp (review round 1): without the `u` flag no non-ASCII character folds onto an
  ASCII one, so that is exact, and the differential test includes `ſ` and the Kelvin
  sign to keep it so. Measured on Windows, Node 24.14, seven typical `.gitignore`
  patterns against six paths, best of five: the old RegExp about 12 ns a test (14 ns
  folded), the walk about 35 ns (40 ns folded). Before the check, the walk alone took
  about 220 ns, and folded literals about 100 ns on Linux in review.
- **The old compiler is kept, verbatim, as the test oracle**
  (`test/harness/wildmatch-regex.ts`). A seeded differential test compares the two on
  4,000 patterns from a small alphabet, 12 paths each, across `pathname` and
  `caseFold`. The oracle only sees short inputs.
- **The timing test races each hostile pattern against a baseline** with the same
  number of steps on the same path, one that matches and that a RegExp settles at
  once, and allows 25 times the baseline (measured: about 1x). The first two cases are
  sized so the old matcher fails them in about a second instead of hanging the suite;
  the long ones (2,000 characters, 30 stars) run after them. Each hostile pattern ends
  in a class so the suffix check can't answer for the walk. Pointed at the old
  matcher, the test fails on its first case.
- **Out of scope, found:** a `.gitignore` line with a reversed range (`[b-a]`) throws
  when compiled, and `listTree` in `src/core/files.ts` catches that and drops every
  rule in that file without a warning, so the walk lists what the file ignores. That
  is silent (principle 4), but #244 asked for the matcher's semantics unchanged. Left
  for its own issue.

### #262 a bad .gitignore line

- **One line that won't compile is skipped on its own, and the rest of its file
  applies** (`parseIgnore` in `src/core/gitignore.ts`). It used to throw out of
  `parseIgnore`, and `listTree` in `src/core/files.ts` caught that and dropped every
  rule in the file. `listTree` now catches only the read (a missing `.gitignore` is
  still no rules), and `parseIgnore` reports each skipped line through an `onSkip`
  callback with its 1-based line number, comments and blanks counted.
- **Each skipped line is a `GITIGNORE_LINE_SKIPPED` warning in `meta.warnings`**,
  through the listing's existing `warn` path (the one `GIT_INCLUDE_REFUSED` takes), so
  every command that walks a folder reports it without passing anything. The message
  names the file (absolute, forward slashes), the line, the pattern as written, the
  reason and the fix. `Warning` has no `fix` field, so the fix is in the message.
  The wording is in `skippedLineWarning`, which the in-memory test files use too.
- **The reason is worded in the pattern's own terms.** The only failure wildmatch has
  is a reversed range, which arrives as the RegExp engine's "Range out of order" about
  a class the user never wrote, such as `/^[^z-a/]$/s`; it's said as "a range in
  brackets runs backwards". Any other error keeps its own message. wildmatch itself
  is unchanged, so #244's oracle and differential test still hold.
- **Not quite git's behaviour, found:** git doesn't reject `[b-a]`. Its wildmatch
  compares the range's first character before it sees the `-`, so `[b-a]` matches `b`
  alone and `[z-a].txt` matches `z.txt`. A skipped line matches nothing, so a file
  named after a reversed range's first character is listed by toil and not by git, and
  the warning says so. #262 asked for the skip; matching git exactly (compiling a
  reversed range as its first character, still with a warning) is left for the
  maintainer. The real-git differential test adds a reversed-range line whose first
  character no file in the tree is named after, so both agree.

### #267 UI theme art

- **The accessibility bar, the maintainer's call (2026-10-19).** Plain (light and
  dark) and Crate are held to 0 axe violations at WCAG 2.2 AA. Harvest, Starship and
  Realm may deviate for style: their axe findings are reported on the PR but don't
  block, their text stays readable, and overflow and layout stay clean in every
  theme. `ui/test/theme-bar.test.tsx` still asserts 0 violations for every theme;
  this PR leaves it as it is, and a separate change scopes it to Plain. Every theme
  here still has 0 violations at 1440px and 375px.
- **Crate changes only subtly, and anything major is proposed first** (the
  maintainer's call). It gains the crate's head in the header and a new loading
  scene (the crate wheeling a hand truck of paperwork) in the slot it already had.
  A warehouse backdrop was generated and tried, then left out as a new background;
  it's on the PR as a proposal with a mockup.
- **Plain stays plain.** No art at all; the empty-state illustration the brief
  allowed would be the one picture in the accessibility baseline, so it waits for
  the maintainer to ask.
- **WebP only, one size each, no fallback.** Every browser Toil UI runs in already
  needs constructed stylesheets and CSS `sin()`, so each supports WebP, and
  `ui/scripts/package-rules.mjs` doesn't allow `.avif` in the tarball, so AVIF
  would mean widening the package rules for a second copy of every image. Each image
  is encoded at twice the size it renders, and backgrounds at one size: a CSS
  background can't take a width-based `srcset`.
- **The existing art budget holds** (`ui/test/themes.test.ts`: 64 KB a file, 160 KB a
  theme). Realm's `parchment.svg` and `map.svg` are replaced by the generated
  parchment and map rather than kept beside them, which keeps Realm at 124 KB.
- **Text over art is checked on the image itself.** axe can't measure contrast over
  a background image (it reports it as incomplete), so each scrim was chosen by
  compositing it over every pixel of the image and taking the worst case: Starship's
  nebula under a 75% scrim leaves muted text at 4.5:1 at its single brightest pixel;
  Realm's parchment under a 35% wash leaves muted text at 6.2:1. Harvest's farm
  strip sits in padding below the page, so no text ever lies on it. Emblems are CSS
  backgrounds on `.brand::before`, so they never reach the accessibility tree.
- **Generation.** gpt-image-2 can't return a transparent background, so the emblems
  and cut-out art use gpt-image-1.5 and the opaque scenes gpt-image-2, through the
  OpenAI Images API. The masters and prompts stay in `.claude/image-generation/`,
  which git ignores apart from the two style files. Starship's scanner came back
  in dark navy, invisible on the console, so its lines were recoloured to the
  theme's ice blue after generation.

### #265 consented feedback

- **Principle 9 doesn't forbid `toil feedback`; it is sharpened to name it.** "No call
  home" is about traffic toil starts on its own. A report the person writes, sees in
  full and approves is theirs, sent to a host the command names in its own name, as
  `toil osv vulns` does. Principle 9 now says so, and `docs/bounds.md` records it as the
  exception `feedback.send` to `commands.read-only` (no connection holds `writes: true`
  for it; the per-report approval is its gate). CLAUDE.md, **Writes**, lists it as the
  one write to a service with no connection. If the maintainer reads "no call home" as
  covering this too, the command is one file to remove (`src/feedback/`).
- **One text, versioned, held identical by a test.** `src/feedback/consent.ts` is toil's
  copy (`CONSENT_VERSION = 1`, `DISCLAIMER`). The function and the site are packages of
  their own and keep copies; `test/feedback-consent.test.ts` holds them, the skill's
  quoted text and the README's curl field to it. Toil UI has no copy: it shows the text
  `toil feedback` returns, so it can't drift from the toil it runs. A change to the text
  is a new version; the function accepts only the current one.
- **On the wire, consent is the version number** (`"consent": 1`), not a boolean, so a
  report says which text was agreed to. The function stores it as `consentVersion` and
  the issue footer says the reporter accepted that version. Rows queued before this
  change have none, and their footer says they predate the disclaimer rather than claim
  an agreement.
- **The function checks consent after field validation and before Turnstile and every
  limit**, so a refused report costs no allowance and no commit lookup. The refusal
  quotes the disclaimer, so a curl user sees what they are agreeing to. The deploy smoke
  test gains a stage posting without consent and expecting that 400.
- **`toil feedback` is a `cli-only` config command** (it needs the prompter for the
  terminal's yes, and only config commands get one). It loads config like any of them,
  so a broken config file stops it; the site's form is the way out then, and the error
  already says how to fix the config.
- **Without approval it succeeds with `sent: false`**, the exact report, the disclaimer
  and how to approve, plus a `FEEDBACK_NOT_SENT` warning, rather than failing: a preview
  is the expected first step for an agent, not an error. A terminal "no" is the same;
  Ctrl+C (or a host's unanswered question) is `CANCELLED`.
- **`@imagile-dev/toil/api` runs it only for a `person`** (it joins
  `PERSON_COMMANDS`). The `consent` field is refused there (`offMcpWhen`, which the API
  shares), so a program can't approve a report itself: the approval is the person's
  `yes` to the `consent` question, whose text is the report and the disclaimer. A
  `readOnly` call gets no prompter, so it only previews; that is how Toil UI previews.
- **Nothing toil holds is added to a report**: only kind, title, body, email, `consent`,
  `version` and `commit`. The audit line hashes the title and body and drops the email.
- **A build with no commit previews but can't send**, since `/api/report` needs one.
  It returns the preview with a `FEEDBACK_NOT_SENT` warning naming the cause, without
  asking first (a yes it would then refuse wastes the person's time), and `--consent`
  on it is `UNSUPPORTED`. Source runs and builds without git get the site's form.
- **Left for the maintainer: no standing opt-in (principle 2).** Every other outbound
  write needs `writes: true`, set by a person, plus a flag; this needs only
  `--consent`, which an agent with a shell can pass itself, so a prompt injection
  could publish what is in its context as a public issue past everything but the
  skill's steps. Options the review raised: ask on a terminal even with `--consent`,
  or add a config opt-in an agent can't set. Not changed here; the trade-off is
  written into `docs/bounds.md`, `feedback.send`, and the review thread stays open
  (#270).
- **`TOIL_FEEDBACK_URL`, loopback only**, exists to drive the command against a local
  copy of the function. Any other value is `CONFIG_INVALID` before anything is sent, so
  it can't redirect a report elsewhere. It is a reserved env name.
- **The terminal prompter writes a multi-line question whole** and prompts on its last
  line, so readline's redraw stays on one line while the report above it stays visible.
- **Toil UI: a header button and a modal dialog**, not a Settings page, since feedback
  isn't configuration. Its server route is `POST api/feedback`, separate from
  `api/config`: four text fields, `consent: true` or nothing, and only `toil feedback`.
  The preview is the command run read-only, debounced 300 ms; any edit clears the
  checkbox, so the yes belongs to the report on screen. The disclaimer and checkbox
  appear once toil has returned a preview, since the text is toil's; until then the
  dialog says what to fill in.

### #271 UI theme motion

- **Crate keeps its grid and gains the warehouse, the maintainer's call
  (2026-10-19).** Crate's tokens are held to the site by `test/brand-sync.test.ts`,
  so the warehouse proposal's palette (kraft cardboard, rack steel, the dark
  floor) lives in `ui/themes/crate/theme.css` as `--wh-*` custom properties and
  reaches the page through the backdrop and gradients, never through the
  tokens. The drafting grid moved off `body` onto the backdrop's middle layer,
  unchanged in size and colour.
- **Parallax is three layers behind the page** (`ui/src/ambient/Ambient.tsx`):
  racking far off (6% of the scroll), the grid (20%) and pallets of boxes nearest
  (40%). Each is a CSS scroll-driven animation of `transform` where the browser
  has them, on the compositor: an iteration of a scroll-driven animation spans
  an equal share of its range, so 50 iterations each `--tile / --depth` long move
  a layer exactly `--depth` px per px scrolled and wrap every tile, keeping each
  layer no taller than the window plus one tile. Elsewhere a passive scroll
  listener and one `requestAnimationFrame` per scroll frame do the same from the
  same custom properties. Only Crate has parallax; the maintainer asked for it
  there and nowhere else.
- **Contrast over the backdrop is measured on the images.** The proposal's 55%
  scrim held muted text but not `danger`, which can sit straight on the page
  (a failed load). The racking now sits under a 90% scrim and the pallets are
  baked to a fifth of their brightness, as silhouettes in shadow. At the single
  brightest pixel of every layer at once (racking, the light shaft's peak, the
  grid, the brightest pallet pixel), ink is 11.7:1, muted 5.7:1, link 7.7:1 and
  danger 4.6:1. The racking reads darker than the mockup as a result; a lighter
  backdrop would need `danger` text kept off the page background.
- **One particle engine, one canvas, 30 frames a second**
  (`ui/src/ambient/engine.ts`). Each frame books the next with a timer and only
  then asks for an animation frame, so the page wakes 30 times a second whatever
  the display's refresh rate. Sprites are painted once into small offscreen
  canvases. The canvas sits at `z-index: -1` behind the page, so particles pass
  behind text and never cross a panel; it is `aria-hidden`, takes no pointer,
  stops in a hidden tab, and is never created when motion is unwelcome. Presets
  live in code (`presets.ts`), not in `theme.json`, because they are script and
  only built-in themes ship script.
- **Reduce motion and effects is Toil UI's own setting,** on the General page
  (renamed from "Bounds and time limit", which it still holds), kept in this
  browser as `toil-ui.motion` beside `toil-ui.theme`. It mirrors onto the root
  as `data-motion`, and `app.css` stops every animation and transition under it,
  the same rule as the OS setting. The OS setting wins when it asks for less, and
  the page says so. A browser that can't answer the media query counts as
  reduced.
- **Gradients go through the tokens** with `color-mix()` and, for charts, a
  per-chart `<linearGradient>` whose stops a theme colours in CSS and opts into
  as `fill: var(--chart-fill)`. Plain never opts in and stays flat. Each new
  stop was checked against every text colour that can sit on it: the lowest is
  Crate's `danger` on its header at 4.7:1.
- **The running week stays muted in every theme's throughput chart** (review on
  #275). A theme rule on `.chart .bar` outranks the base `.bar--partial`, which
  had already hidden the partial week in Crate and Starship on main, so each of
  the four themes restates it, and `ui/test/themes.test.ts` requires that of any
  theme that recolours chart bars.
- **Two overflows from before this change are fixed,** since the bar is clean
  layout in every theme: a long field name in a Connections label at 375px
  (`overflow-wrap: anywhere`), and Harvest's Bounds terms at 375px, which now
  stack under their values below 480px.
- **Starship's lanes are left as they are.** Its animated hyperspace lanes
  (#209, `stroke-dashoffset` on every graph edge) cost about 10% of a core at
  idle in headless Chrome at 240 Hz, before and after this change; the particles
  add about 1%. Making them cheaper changes Starship's design, which is the
  maintainer's call.
- **Generation.** The racking wall (gpt-image-2, medium) was cut to an exact
  four-bay, three-shelf repeat with its seams cross-faded, so it tiles; the
  pallets (gpt-image-1.5, transparent) were three cut-outs scattered on one
  sparse tile. Both are WebP; Crate's art is 83 KB of its 160 KB budget. The
  proposal's original master was gone, so the racking was regenerated.

### #272 wordmark

The maintainer picked the face, Fredoka 600, from four candidates (Fredoka, Bagel Fat
One, Shrikhand, DynaPuff), and asked for "UI" as a separate sticker. The rest was
decided here.

- **One weight, Latin only.** Both packages import `@fontsource/fredoka/latin-600.css`,
  the static 600 file (16.5 KB as WOFF2), not the variable font: the word "toil" needs
  one weight and four Latin letters, and the static file is the smaller of the two.
- **`--font-brand` sets only the word "toil".** It's a token of its own on the site
  (`global.css`) and in Toil UI (`app.css`), not a theme token, so no theme can swap
  it. Headings, the hero and body text keep their faces.
- **The word keeps its shape in every theme; only its colour follows the theme.**
  Harvest, Starship and Realm no longer restyle `.brand`'s font, letter-spacing or
  case (Starship uppercased it). Crate keeps the flame-to-amber gradient, Starship its
  glow and Realm its crimson, on `.wordmark` only.
- **The sticker uses the theme's own accent and accent-ink**, the pair every theme
  already passes for the current nav link, so a new theme needs no sticker rule.
  Crate makes it amber (`--sticker-bg: var(--link)`, 11.3:1) so it doesn't match
  the flame "Dossiers" pill beside it. It's pure CSS: a cream border, two drop
  shadows, a -8° tilt and a clipped corner with a peeled flap.
- **The accessible name is "Toil UI", from an `aria-label` on the link.** The word
  and the sticker are separate boxes with no space between, so the name computed from
  the text would be "toilUI"; a hidden space isn't reliable either, since whitespace
  between flex items isn't rendered and browsers differ on whether it counts. The
  label holds the visible words, so voice control still finds it.
- **Only Toil UI's favicon changes.** The site's stays the mark, per the site rules.
  Toil UI had none; it gets Fredoka's "t", outlined to a path (an SVG favicon can't
  load a font), on the brand's near-black, with the sticker's corner. Vite emits it
  as an asset, which the tarball rules already allow.
- **The terminal's wordmark is hand-drawn**, 28 columns by 7 lines of half-blocks,
  after Fredoka's shapes. It fits beside the logo at 80 columns; the existing rule
  doubles it from 97 columns, which is what that rule gives for 28.

### #277 layout primitives, the overflow check and the sweep fixes

- **The wordmark's name is its own text, "toil UI"** (overturns #272's `aria-label`).
  axe's `label-content-name-mismatch` (WCAG 2.5.3) failed on every view: the label
  "Toil UI" didn't contain the visible "toil" + "UI". The link now has no label; the
  word and the sticker are inline text in one span with a real space between them,
  narrowed with `word-spacing` to the width the sticker's margin had. The board's
  Drag and Move… buttons, which the stricter rule also flagged, now carry the item
  in visually hidden text instead of an `aria-label`.
- **Crate is the default theme; the system's light or dark preference doesn't
  change that.** Crate is dark only, so following `prefers-color-scheme` would mean
  defaulting light-preferring browsers to Plain, two defaults to explain for one
  choice. A saved choice and `?theme=` still win, and the scheme preference still
  applies to Plain once someone picks it. Crate's stylesheet is now in the first
  load beside Plain's. The local app keeps `?theme=` and `?scheme=` when it drops the
  launch token from the address, so a themed link works there too.
- **The compact header starts below 1024px**, not only on phones: at 960px the
  inline header (name, three links, Feedback, Theme and Appearance) measured about
  970px in Crate and Starship, so it would have wrapped on a tablet. The menu is a
  React Aria `DialogTrigger` with a `Popover`; Feedback closes the menu before its
  dialog opens, so focus returns to the Menu button.
- **`Card` is the surface themes style**: themes that dressed `.panel` and
  `.dossier-card` together now dress `.l-card`, which also brings the Settings
  connection and dossier cards into each theme. Board cards, sprint stats and
  attention rows stay their own small tiles, not `Card`s.
- **The settings tabs wrap evenly** (two by two below 600px) rather than scroll:
  four short labels fit in two even rows, and a scroller would hide one of them.
- **Long values:** file paths, the config file and repository remotes use `Path` /
  `Url` (cut in the middle, whole value in the tooltip, the text and a copy button);
  a call's JSON input under "Fed by" and the feedback page's curl command wrap at
  any character instead.
- **The layout check runs inside `npm run smoke -w ui`** against the installed
  package (`toil-ui --sample`), so it sees the real build under the real CSP. It
  needs Chrome, Edge or Chromium (every GitHub runner has Chrome) and says so plainly
  when there's none. It adds about three and a half minutes on a laptop. It runs
  with reduced motion so an animation can't fail a run; a full-motion run by hand
  found the same nothing. It enables axe's experimental
  `label-content-name-mismatch` explicitly (it is off by default in axe-core 4.13),
  as `ui/test/theme-bar.test.tsx` now does too, which also gives each of its cases a
  30-second limit (one timed out at 5s on macOS).
- **Not reproduced, and why:** the graph nodes' 3px (xyflow's invisible handles
  hung half outside each node; they now sit inside, so the measurement is clean,
  but no text was ever clipped); the DOM-flagged overlaps on the item page, the
  Connections forms, General and the dashboard (bounding boxes of wrapped inline
  text, nothing overlaps on screen); the Feedback dialog's backdrop (it dims, at
  55% black, which reads faintly on Plain dark's near-black page; the check now
  asserts a backdrop); the site's 400px gap on the home page at 375px (the reserved
  box of the lazy cartoon, which a full-page capture never scrolls to; it loads on a
  real scroll with and without reduced motion); and the hero art at 820 to 900px.
- **Site contrast through the token:** `--color-faint` goes from `#857a6c` to
  `#998d7e` (4.7:1 on the raised surface, the darkest it sits on), with the terminal
  palette to match (`test/brand-sync.test.ts`). Shiki's comment grey takes that
  token site-wide, so the dossiers page's local overrides are gone. Doc tables are
  wrapped in focusable, labelled scrollers by a rehype plugin, so the skill files
  stay plain markdown.

### #281 the badge as toil's mark

- **The badge replaces the terminal-hub mark everywhere**, from the maintainer's
  pick among the mockups. The cut corner (parallel to the page's fold), the 45°
  gradient and the deep-flame cursor came out of a similarity check against
  terminal, developer-tool and agent-CLI icons: the `>_` alone matched macOS
  Terminal, Windows Terminal and Lucide's square-terminal, and a cursor on a warm
  gradient tile was close to JetBrains', so the silhouette carries the identity.
- **The cursor is `#c43d12`, not the accent.** The accent on the page is 2.5:1,
  under even the 3:1 for graphics; the deeper flame is 4.6:1. It's a literal in
  the mark's files rather than a new site token, since nothing else uses it.
- **The site's mark blinks its cursor three times, on load and on hover or focus**,
  instead of blinking forever, so it stops well inside five seconds (WCAG 2.2.2)
  without a pause control.
- **The CLI splash is the badge in an orbit of six dots**, half a turn, then still.
  Six read at 80 columns; eight touched and four looked like a compass. The colours
  repeat every three dots, so half a turn lands on the starting picture and the
  still frame needs no special case. The splash runs 3.2 timeline seconds (2.6 real),
  down from 4.05. A one-pixel gap separates the tile from the page in braille, or
  the two solid areas would read as one block.
- **Toil UI's theme emblems are gone; the badge skins take their place.** Each
  generated emblem (#269) sat in `.brand::before`, the only place it was used, so
  `emblem.webp` is deleted from Crate, Harvest, Starship and Realm and `mark.svg`
  takes its slot in each `theme.json`. The skins are hand-built SVG, no generated
  art. Harvest's is drawn on the same 16-cell grid, so the badge sits at 32px in
  the header, twice the grid, where the pixels stay crisp.
- **Toil UI's favicon follows the theme** (`ui/src/favicon.ts`, called where the
  theme is applied). It replaces #274's Fredoka "t". A theme from the user's folder
  has no mark the build knows, so it shows the standard badge.
- **The README banner and social preview aren't re-rendered here.** They live on
  #268's branch, which hasn't merged; they follow once it does.
- **Plain's badge is blue** (the maintainer's call on #282): the tile takes the
  scheme's `accent` (`#0b5cad` light, `#8cc4ff` dark) instead of the gradient, so
  Plain has two marks and its favicon follows the scheme, including `system` as the
  OS changes. On the light accent the page is white; on the dark accent's light
  blue a white page would barely separate, so the dark mark has a dark page
  (`#0b1220`, Plain dark's accent ink) with Plain's ink for the chevron. The
  cursor is the accent in both: 6.7:1 and 10.2:1 on the page. Plain's sticker and
  wordmark needed no change: the sticker already takes the theme's accent and the
  word its ink.
- **The terminal wordmark is generated from Fredoka itself** (#282, the
  maintainer's note that the hand-drawn one didn't read as Fredoka).
  `scripts/gen-wordmark.mjs` rasterises the real glyphs in headless Chrome (already
  how the repo's screenshot and layout tools run) rather than adding opentype.js
  for a one-off; Chrome's text rasteriser is the one the site's wordmark goes
  through too. Quadrant blocks (U+2596 to U+259F, in the same Block Elements range
  the half-blocks were) rather than sextants or octants, which many terminal fonts
  still lack. The sampler's output needed no hand-tuning, so `TUNE` is empty.
- **The splash no longer doubles the word's width on a wide window.** That was
  the "fatter" logo: from 97 columns the splash drew "toil" at twice its width
  while the menu didn't. The word now has one size everywhere, and a test holds
  the splash's and the menu's to the same lines and columns. The badge itself was
  already square (a test now measures it, dot by dot, at 1:1 within 5%).
- **The wordmark's shadow is foreground-only**: it shows in cells the word
  doesn't touch, and is dropped where a cell holds both, rather than adding a
  background colour to every cell, the recording's encoder and the site's player.
- **The README banner and social preview wear the badge and the Fredoka wordmark**
  (#286, the follow-up the entry above promised). #268's background master wasn't
  kept in any worktree's `.claude/image-generation/`, so the background was lifted
  out of #268's own renders rather than regenerated: left of the art, the plate is a
  flat gradient, so inside the text's rows each column was replaced by its median
  over the rows with no text, and every other pixel is #268's. The art is unchanged
  and nothing was image-generated. The badge is the hand-built SVG from
  `site/src/components/Logo.astro`, "toil" is Fredoka 600 in the ink colour, and the
  eyebrow, pitch and sub-line keep #268's words and faces. The banner is WebP at
  quality 85 (47 KB); the social preview is a 256-colour PNG from pngquant (221 KB),
  because a plain median-cut palette banded the badge's gradient.

### #283 theme depth

- **User-installed themes are removed, whole** (the maintainer's decision on #283:
  new themes are requested through feedback). `ui/server/user-themes.ts`, its tests,
  the CSS tokenizer (`ui/src/css-tokens.ts`) and the user-only rules in
  `theme-rules.ts` (`userCssProblems`, `isThemePath`, the at-rule and `url()`
  allowlists) are gone; nothing served them, so no route, setting or UI went with
  them. What the built-in themes are held to (file types, no script, scoped
  selectors, plain manifest values) moved to `ui/test/theme-rules.ts`, since only the
  test reads it now. The Content-Security-Policy is unchanged: its one hash is React
  Aria's press style, which the new popover and buttons still need, and it never
  depended on user themes.
- **A leftover `~/.toil-ui/themes/` gets a notice, once per start** (`themesNotice`
  in `ui/server/settings.ts`), on stderr after the launch URL, naming the folder and
  how to ask for a theme. It's never read and never deleted. "Once per start" rather
  than once ever, because remembering that it was said would mean another file in
  the data folder; the maintainer may prefer a marker. A saved theme name the app
  doesn't know already falls back to Crate.
- **Wording is microcopy only** (`ui/src/wording.ts`, 21 keys): the dossier list's
  lede, eyebrows, the dashboard's notes, empty states and loading lines. The
  Settings pages and the Sync panel keep the standard text, and so does a not-found
  notice (an item the dossier doesn't have), which principle 4 keeps plain. No button, link, field label or
  section heading is themed, beyond the existing `terms`, which keep the real word
  beside them. The brief listed "button microcopy"; I read that as the text around
  controls ("Thinking…", the Ask note), because every control's name is what the
  theme bar test, the layout check, scripts, voice control and the docs use to find
  it, and the theme bar already fails any theme whose controls differ from Plain's.
  Themeing button labels is the maintainer's call. Themed wording off also drops
  the `terms`, so "off" means the standard words everywhere.
- **The lexicon keeps placeholders and commands** (`ui/test/theme-rules.ts`,
  `lexiconProblems`): a themed line must carry every `{id}` or `{name}` and every
  `toil …` command its standard text has, and holds no markup. Each game theme
  defines all 21 keys.
- **Both preferences live with the theme in `localStorage`** (`toil-ui.theme`, now
  `{ theme, scheme, wording, voice }`), with `?wording=off|on` and `?voice=off|on`
  for links, remembered once used, as `?theme=` is. A value that isn't a boolean
  reads as on. The server never stores the
  voice flag: each question sends `theme` and `voice`, and the server looks the
  voice up in its own bundled copy of the theme (`ui/server/agents/voices.ts`), so
  the page can't put text into the prompt through the style. An unknown theme or a
  non-boolean voice is a 400. A question with neither (an older page) gets the
  voice off.
- **The prompt's order and its precedence lines** (`ui/server/agents/prompts.ts`):
  the rules unchanged, then `Style:` with the voice and `STYLE_RULE`, then
  `Instructions from the person asking:` with `INSTRUCTIONS_RULE`. The precedence is
  said after each part rather than added to the rules, so the rules stay word for
  word what they were. All three adapters already took `r.system`, so none changed.
- **Custom instructions are fields of `agent.json`** (`instructions`, `voice`), saved
  through `POST api/agent/settings` and its field allowlist, rather than a new file
  and route: the brief asked for the existing write path. Each is trimmed, CRLF
  becomes LF, at most 4,000 characters (`MAX_INSTRUCTIONS`), and a control or
  invisible format character (`\p{Cc}`, `\p{Cf}`: zero-width and bidi marks) other
  than a line break or tab is refused. An `agent.json` from before has neither
  and loads with both empty. The instructions card saves the saved adapter fields
  with its own, so an unsaved edit in the adapter form is neither sent nor lost.
- **`GET api/agent/prompt`** (`?dossier=&theme=&voice=on|off`) returns the system
  prompt as the next question would get it, with the saved instructions and the
  time now; the Settings page asks it for the first dossier toil lists. The preview
  and `--sample` have no agent settings, so there the card composes the prompt in the
  page from the same function and what is typed, with saving off.
- **A custom voice applies only while the voice is on and the theme has one**, so
  with Plain chosen it is ignored, as the theme's own voice is; the card says which
  case is current.
- **The (i) is a popover, not a tooltip** (`AskInfo` in `ui/src/components/ask.tsx`):
  it holds two links, which a tooltip can't, and opens on press only. Its name,
  "About these answers", is sr-only text inside the button beside an `aria-hidden`
  "i", so WCAG 2.5.3 holds without an `aria-label`.
- **The preview's voiced answers cover the risk question only** (`VOICED` in
  `ui/src/fixtures/agent.ts`, three dossiers by four themes). `ui/test/agent.test.ts`
  holds each to its standard answer: the same citations in order, the same figures,
  the same proposals.
- **The docs page is Toil UI's, not the skill's** (`ui/docs/themes.md`, rendered at
  `/docs/themes/` like the README is at `/docs/ui/`): an agent driving toil has no
  theme. Its screenshots are figures placed with `<!-- figure: -->`, which the remark
  plugin now also reads in `ui/docs/`, and `test/site-docs.test.ts` checks them the
  same way. `ui/test/prompts.test.ts` fails if the prompt the page shows drifts from
  what the server composes.

### #279 object projections

- **An object projection takes every field after it** (`led` for `.*` in
  `src/core/query/parser.ts`): its right-hand side binds at the star's power, as
  `[*]`'s does, not the dot's. `a.*.b.c` on `{"a":{"x":{"b":{"c":1}},"y":{"b":{"c":2}}}}`
  is now `[1,2]`; it was null.
- **This follows the specification over both reference implementations.** The
  specification says that once a projection is made, "all subsequent expressions
  are projected onto the resulting list". jmespath.js 0.16.0 and jmespath.py 1.0.1
  both return null for `a.*.b.c`, because both bind at the dot's power, and the
  vendored compliance suite has no case that reaches it. The new cases in
  `src/core/query/query.test.ts` were checked against the Python reference by
  rewriting each `a.*.<rest>` as `values(a)[*].<rest>`, which it projects
  correctly, and a test holds the two forms equal in toil.

### #264 an unreadable .gitignore

- **Only a missing ignore file is silently no rules** (`readRules` in `listTree`,
  `src/core/files.ts`). `ENOENT` and `ENOTDIR` (a parent of the path is a file)
  count as missing. Any other read error (permission, a lock, a folder named
  `.gitignore`) applies no rules from that file and is a `GITIGNORE_UNREADABLE`
  warning through the listing's `warn` path, as #262's skipped line is. The message
  names the file, Node's error, what it means for the listing, and a fix chosen by
  the error code. The same holds for `.git/info/exclude` and for the `.gitignore`
  files above the listing root.
- **A file that isn't UTF-8 still applies, and is reported as `GITIGNORE_NOT_UTF8`**,
  its own code, because the file was read and its rules apply (review on #312).
  It's decoded with each bad byte replaced, which is what reading it as `'utf8'`
  did before without a word. Throwing the file out instead would lose its ASCII
  lines, which are most of any real `.gitignore`. A byte-order mark is kept in the
  text, as before; whether to drop it, as git does, is left for the maintainer.
- **The test fails reads through a stand-in for `readFileSync`**
  (`src/core/files-unreadable.test.ts`, `vi.mock('node:fs')`), since a permission
  or a lock can't be set up the same way on every OS. The folder and the bad
  encoding are made for real.

### #287 Toil UI on real data

- **A GitHub section with no `projects` reads the repository's issues**
  (`ui/src/load.ts`): `github list-issues --state all`, then `issue-events` per
  issue, rather than showing no work. The sync treats `list-issues` as a search
  (`ui/server/sync.ts`): after the first sync it asks with `updatedSince` and
  refetches only the changed issues' timelines. Timelines are read for every open
  issue and the 50 most recently closed (`historyNumbers`, review round 1), so a
  first sync of a repository with thousands of closed issues doesn't spend the
  token's hourly budget; older closed issues are listed with no history.
  `get-issue --sub-issues` isn't
  called on this path, so a repository's sub-issues aren't followed yet (#298 is
  the wider mapping gap). The sample has no GitHub dossier without a board, so
  `github list-issues` is the one read command the fixture doesn't answer;
  `ui/test/server.test.ts` names it, and `ui/test/github-repo.test.ts` proves the
  path through toil's own `execute()` with only `fetch` stubbed. A fourth sample
  dossier would have changed the site's preview, which is the maintainer's call.
- **Checks are read for open pull requests and the 20 newest closed ones**
  (`checkedPrs`, `CHECKED_CLOSED_PRS`). `imagile-dev/toil` has nearly 300 pull
  requests, and one `list-checks` each made a sync take minutes and spend
  hundreds of requests on builds nobody looks at. Every pull request is still
  listed and linked to its items.
- **An item with no type at all flows** (`flows` in `ui/src/model/flow.ts`): a
  GitHub issue in a repository without issue types maps to `OTHER` with no
  `typeName`, and the board, throughput, cycle time and aging all left every one
  out, so a real repository's board was empty. An `OTHER` item with a type name
  (a Feature) is still a container and still left out.
- **A check run is named once per build** (`githubBuild`): GitHub Actions runs a
  job for the push and again for the pull request, and the title read "test,
  build, build, test".
- **The agent's tools report a GitHub assignee by login** (`assigneeOf` in
  `ui/server/agents/tools.ts`): OWI keeps a GitHub login as the person's `id` with
  no `name`, and the tools reported every item unassigned, which Codex then said.
- **Codex runs with the user's own MCP servers switched off by name**
  (`codexUserServers`, `codexOverrides` in `ui/server/agents/codex.ts`). Codex
  merges a `--config` table into the user's config, so on a real machine the
  user's servers started beside Toil UI's. Toil UI reads `$CODEX_HOME/config.toml`
  (else `~/.codex/config.toml`) only to name them, and refuses an inline
  `mcp_servers = { … }` it can't name servers from. Profiles and plugin servers,
  and a durable isolation, are #300.
- **The lockfile's toil tarball is fixed by hand**: it named alpha.3 with the
  alpha.2 tarball's URL and integrity, so `npm ci` installed alpha.2. Preventing
  it at release time is #299.
- **`ui/scripts/dev-real.mjs` writes the scratch home with plain JSON for the
  connection and toil's own commands for the dossiers.** `toil connections add`
  prompts on a terminal, and the connection holds nothing secret (the token is
  only in Toil UI's environment). It sets `CODEX_HOME` to the real `~/.codex`,
  because Codex on Windows finds its home from the OS rather than `USERPROFILE`,
  and Toil UI must read the same config Codex does. It doesn't install the Codex
  SDK; it prints the `npm install --no-save` line, since a script that quietly adds
  an optional peer and its bundled CLI to a clone would be a surprise.
- **`ui/scripts/seed-sandbox.mjs` writes through `gh`, never toil**, so toil stays
  read-only and its write gate isn't loosened for test data. It skips a Projects
  board (the maintainer's `gh` token has no `project` scope, and changing the gh
  login was out of bounds) and deployments (toil's `github` area doesn't read
  them), and says so when it runs.
- **Headless Chrome gets `--disable-gpu`** (`ui/scripts/chrome.mjs`): on the
  maintainer's machine headless Chromium drew no frames with the GPU process, so
  `requestAnimationFrame` and screenshots waited forever. Software rendering is all
  the layout check needs. The installed Chrome there still hangs even so, for a
  reason not found; Playwright's Chromium, through `CHROME_PATH`, works.

## Command shape (jira, jira-cloud, ado, ado-cloud)

The maintainer asked for one streamlined interface, a clean break with no aliases,
standardised flags, and no change to the client code (principle 10). These are the
choices made by default inside that:

- **A sub-collection's read is a plural noun under its resource**, `jira issue comments
  <key>` and `ado pr threads <id>`, not a resource of its own (`jira comment list`).
  Everything about one issue or PR is then under one `--help` and one menu screen.
- **Compound verbs where one word would mislead**: `issue log-work`, `issue set-sprint`,
  `work-item get-many`, `pr comment-inline`, `pr delete-comment`, `pr wait-for-author`.
- **Vendor words stay where the concepts differ**: Jira's `--transition` (a transition
  name) and ADO's `--state` aren't merged into one flag.
- **`ado run list` keeps `--top` beside `--limit`.** They aren't the same idea: `--top`
  is one request with a cap (`0` lists every run, as the contract records), `--limit`
  pages with a cursor. `jira issue search` keeps `--start-at` for the same reason.
- **Positional arguments are ids only.** The other end of a link (`--target`), a
  sprint, a state and a person are flags, so a line reads the same in every area.
- **One positional value for a one-or-many field stays one value**
  (`src/program.ts`): `jira issue get PAY-1` returns the issue, as `--key PAY-1` did,
  and `jira issue get PAY-1 PAY-2` the bulk shape.
- **The contract's jira and ado entries were regenerated from the registry**, each
  carrying its old entry's recorded `output`; commands the contract never recorded
  (`issue history`, `work-item get-many`, `api`, `check-dossier`) stay out of it, as
  before. The `--save` divergence on `work-item fields` and `types` keeps its record
  with empty `allows`, since the flag is no longer in the contract to excuse.
- **The welcome menu's Services module is its first entry**: service, resource,
  action, then a form for the positional ids and a flags line with the required ones
  filled in. A write shows its line with `--allow-write` and asks before running; the
  connection's own writes setting still decides. A result shows the first 24 lines of
  `data`.
- **A resource's row in `--help` lists its actions** (`issue  get, history, create,
  ...`) instead of "jira issue commands".

## Transitions by intent (#302)

`--to <intent>` on `jira issue transition`, `jira-cloud issue transition`, `ado
work-item transition` and the new `ado-cloud work-item transition`, resolved in core
(`src/core/transition-intent.ts`). Choices made by default inside the issue's shape:

- **When the category step finds several moves, the name step narrows within them**
  rather than refusing outright (Done and Won't Do are both in Jira's Done category;
  `--to done` takes the one named Done). Anything still not exactly one is refused.
  It stays deterministic: the same moves in any order give the same answer.
- **"Contains the intent's word" is a word that starts with the intent**, in the
  transition's name or its target status: `Submit for Review` and `Reopened` match,
  `Undone` doesn't. It applies only to the four intents, never to a status name.
- **An exact name matches a transition's name or its target status**, ignoring case,
  so `--to "In Review"` works whether the workflow names the move or only the status.
- **An item already in the intent's category is refused**, not moved to a sibling
  status in the same category and not reported as a no-op success: `--to start` on an
  issue In Progress is `INVALID_INPUT` saying it's already there, with the moves it
  offers. Moves into the item's current status are left out of the category and name
  steps for the same reason.
- **Jira's categories serve `reopen` (To Do), `start` (In Progress) and `done`;
  Jira has no review category,** so `--to review` on Jira resolves only by pin, exact
  name or a name that says review. ADO's Proposed, InProgress, Resolved and Completed
  serve `reopen`, `start`, `review` and `done`; Removed serves none, so only its name
  reaches it.
- **Pins are a core dossier key, `transitions`**, validated on every read like
  `fields` (`DOSSIER_INVALID` for a wrong shape or a key that isn't one of the four
  intents), and read through `ctx.dossierTransitions()` only when the call gives an
  intent. Types are compared ignoring case. A pin naming nothing the item offers is
  refused, never passed over to the next rule, because it's the author's word.
- **Jira reads the issue once** (`issue/{key}?fields=issuetype,status&expand=transitions`)
  for its type, status and transitions, rather than `/transitions` plus a second read
  for the type. `--transition` keeps the recorded `/transitions` lookup unchanged.
- **ADO reads the item's own project for its type's states** (`System.TeamProject`),
  falling back to the call's project on Server, since a work item's id lives in the
  collection or organization while its process lives in its project.
- **`ado-cloud work-item transition` is new.** The issue named it, and `ado-cloud`
  had only `work-item update --field state=…`. It takes `--state` or `--to` like `ado`'s.
- **`meta.transition` is a new envelope key** (`ctx.setTransition`), set only on
  success, as additive output the contract allows. `data` keeps its recorded shape;
  for Jira, `transition` is the resolved transition's name when `--to` was used.
- **`--to <intent-or-status>` is recorded in the command contract** for `jira issue
  transition` and `ado work-item transition`, beside the existing flags.
