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
  - **The stub generator** keeps making target flags ordinary options; the integration
    author decides which become context inputs.
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
- **"Port" in the sense of porting software is dropped from history, issues and
  docs** (#68), on the maintainer's instruction of 2026-10-17, so toil doesn't read
  as derivative. Main's 12 affected commit messages were reworded and force-pushed
  with identical content, and open branches were relinked with a merge commit. The
  repository's own wording now says "integration", "build" or "match": the
  integration kit, building an integration, matching the predecessor bug for bug, and
  CLAUDE.md's **Matching the predecessor** section. Network ports keep their name.

## Per-integration decisions

Added as each integration lands.
