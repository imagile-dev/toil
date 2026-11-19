# Triage takes the maintainer's comments as direction, and fixes when unsure (#671)

- **Every comment from `kolatts` on a triaged issue re-runs triage**, with no keyword
  or slash command. The maintainer asked for "any comment from only kolatts"; a
  keyword would be one more thing to remember. The cost is a run for a comment that
  only says thanks, which spends no slot of the daily cap (a comment is a re-triage,
  like a dispatch). Where: `.github/workflows/triage.yml`, `select` in
  `scripts/triage/steps.mjs`.
- **The login is matched, not the author association.** `OWNER` would let any future
  owner steer triage without a decision to add them; the login is one place to change
  (`MAINTAINER` and the job's `if`).
- **A comment on triage's draft PR re-triages its issue**, so direction can be changed
  on the PR, as the maintainer asked. Only a PR whose head is `claude/issue-<n>` in
  this repository and that carries `from-triage` counts. The re-run starts from `main`
  and force-pushes the branch, as `open-pr` always has, so the earlier fix is replaced
  rather than amended. Inline review comments on the PR aren't read; conversation
  comments are.
- **The direction includes triage's own earlier comments**, so the agent sees the
  question the maintainer is answering. Nobody else's comment is included, even a
  member's, so the direction is one person's. It is redacted like the issue, cut to 20
  comments of 4,000 characters, and sits outside the untrusted fence. It never
  overrides a principle or widens what triage may touch.
- **Unsure is a `fix`.** An unconfirmed API detail or an open design choice now opens a
  draft PR built on what can be confirmed, choosing the option that relies on nothing
  unconfirmed, with the assumption and the live check stated. `maintainer` stays for the
  site, the Azure Function backend, dependencies, a new area, and a bug with no plausible
  fix.
- **A re-triage that fixes removes `needs-maintainer`**, so the label says what is true
  now rather than what an earlier run decided.
