# Demo data for the launch recordings (#623)

- **GitHub writes go through `gh`, Jira and Azure DevOps through toil.** toil's
  github area has no milestone command, and the demo home keeps every connection's
  writes off, so `demo-week.mjs` writes GitHub the way `seed-sandbox.mjs` already
  does. Jira and ADO go through toil with `--allow-write`, so the connection's
  `writes` decides. Where: `ui/scripts/demo-week*.mjs`.
- **ADO Services stopgaps use `toil ado api`.** Repo creation, sprint dates, pushes
  and the PR-to-work-item link have no Services command yet; #621 adds them, and the
  script should switch once it lands. Assigning goes through `work-item update`.
  Where: `ui/scripts/demo-week-ado.mjs`, and `docs/demo-reset.md`, **Stopgaps**.
- **The active Jira sprint is renamed and re-dated, not completed and replaced.**
  Completing would move issues and close history; renaming keeps the board as it
  was and is what the 10 Nov run did. The three placeholder issues a new Jira site
  starts with ("Task 1/2/3") get real titles, but only while they still have the
  placeholder title.
- **ADO keeps its own sprint names** (Sprint 1 is the current one) instead of
  renaming to "Sprint 44": renaming iterations would break `ado-seed/apply.mjs`,
  which looks sprints up by name, and teams in different tools rarely share sprint
  names anyway.
- **Each seeded comment carries a marker** (`(Sprint 44 update, …)`), so a re-run
  finds it and doesn't post twice.
- **The Postgres replica uses trust authentication on loopback only**, so no
  password exists anywhere and nothing goes through the credential store. Where:
  `ui/scripts/demo-postgres.mjs`.
- **The sandbox's demo `package.json` pins two old releases with real advisories**
  (`express` 4.19.2, `jsonwebtoken` 8.5.1), so `toil deps scan` and `toil osv vulns`
  have something true to report. Nothing installs or runs them.
- **The demo home links `~/Library/Keychains` on macOS**, because `security` finds
  the login keychain under `$HOME/Library`; without it every `keychain:` reference
  reads as missing. The toil-side fix (and an honest error) is in #617.
- **The Confluence pages are the source; the Python generator that first wrote them
  stays out of the repository**, because repo tooling runs only node, git, gh and a
  browser. Where: `ui/scripts/demo-confluence/`.
- **The Figma mockup was made once in the browser and isn't reseeded**: Figma's REST
  API can't write a file. `docs/demo-reset.md` says so, and toil reads it back.
- **The story is fictional and American**: Deliverables Unlimited (a consultancy) at
  Overdraft Federal (a US bank), merchants in US states, every amount in USD, the
  maintainer's call. People other than the protagonist appear only in text, since
  the seeds can assign only the token's identity. Where: `docs/demo-story.md`.
