# Demo reset

How to bring the demo data back to "a real team's week" before a recording. All of
it is made-up work: **Deliverables Unlimited**, a consultancy, on an engagement at
**Overdraft Federal**, a large US bank. Neither exists. The
story, the cast and which video uses what are in [demo-story.md](demo-story.md). It
lives in the three test projects (CLAUDE.md, **Test Projects**), a local Postgres in
Docker, a SQLite file and one Figma draft, and nothing else.

## Before each recording

Run from the repository root. Each step looks first and skips what's already done,
so running it twice is safe. To roll the week forward, change `--sprint` and `--ends`.

```bash
node ui/scripts/demo-postgres.mjs
```
```bash
node ui/scripts/demo-week.mjs --sprint "Sprint 44" --ends 2026-11-27
```
```bash
node ui/scripts/demo-confluence/seed.mjs
```
```bash
node ui/scripts/demo-home.mjs --fresh
```

Then start Toil UI in the demo home. The GitHub token comes from `gh` for this one
process and is never written to a file:

```bash
GT=$(gh auth token) && TOIL_GITHUB_TOKEN=$GT HOME=~/toil-demo-home npx @imagile-dev/toil-ui
```

Read the token before changing `HOME`: `gh` keeps its login under the real home. On
macOS, `demo-home.mjs` links `~/Library/Keychains` into the demo home, because
`security` finds the login keychain under `$HOME/Library`; without the link, every
`keychain:` reference reads as missing.

For CLI and MCP shots, use the same home: `HOME=~/toil-demo-home node dist/toil.js …`.
Every connection in the demo home has writes off, whatever your own config says (your
`confluence` connection has writes on for the seed), so video 5's agent is stopped by
the write gate until you turn writes on in the demo home. To show a write going through,
turn it on for one sandbox connection on camera
(`toil connections writes jira on`, which asks you to type the name).

## First-time setup (once per machine)

1. Connections in your own config, settings only (an agent may add these):
   `jira`, `confluence` (Cloud, the Atlassian site), `ado` (Cloud,
   `https://dev.azure.com/<org>`), `figma` (`https://api.figma.com`) and
   `payments-db` (Postgres on `127.0.0.1:55432`, database `payments`, user
   `postgres`, trust auth, no password).
2. Tokens, typed by a person in their own terminal:
   ```bash
   node dist/toil.js connections login jira
   ```
   ```bash
   node dist/toil.js connections login confluence
   ```
   ```bash
   node dist/toil.js connections login ado
   ```
   ```bash
   node dist/toil.js connections login figma
   ```
   Jira and Confluence take the same Atlassian API token. The ADO token is scoped to
   the one organization with Work Items (Read & write) and Code (Read & write). The
   Figma token is a personal access token with read access to files.
3. Writes on the two sandboxes the seeds write to (each asks you to type the name):
   ```bash
   node dist/toil.js connections writes jira on
   ```
   ```bash
   node dist/toil.js connections writes ado on
   ```
4. The first seeds, if a sandbox is empty: `node ui/scripts/seed-sandbox.mjs`
   (GitHub), `node ui/scripts/jira-seed.mjs --project SCRUM`, and
   `node ui/scripts/ado-seed/apply.mjs --project "Toil Sandbox"` (with
   `TOIL_ADO_BASE_URL` and `TOIL_ADO_PAT` set in your own shell).

## What's seeded where

| Where | What |
|---|---|
| GitHub [`imagile-dev/toil-sandbox`](https://github.com/imagile-dev/toil-sandbox) | Milestone [Sprint 44](https://github.com/imagile-dev/toil-sandbox/milestone/4) (due 27 Nov), with 15 open issues carried over. Done today: PR #27 merged, which closed #9. In progress: #7 and #11, each with a comment from today. Code reviews: #37 waits on review, #29 waits on checks (it fails on purpose), #28 is a draft. Blocker chain: #11 → #12 → #17 → #18. Agent-ready: [#38](https://github.com/imagile-dev/toil-sandbox/issues/38). Code: `src/money.js`, `src/logger.js`, `src/refunds.js` and tests (`npm test`); `package.json` pins `express` 4.19.2 and `jsonwebtoken` 8.5.1, which have real advisories |
| Jira `SCRUM` (`https://<your-site>.atlassian.net`) | Active sprint renamed **Sprint 44**, 16 to 27 Nov, goal "Stored cards end to end". The placeholders SCRUM-1 to 3 renamed to real payments tasks. Done today: SCRUM-31. In progress: SCRUM-20 (picked up today), SCRUM-14 and SCRUM-16, each with a comment from today. Critical chain: SCRUM-14 blocks SCRUM-15 and SCRUM-17, and SCRUM-17 blocks SCRUM-18, SCRUM-21 and SCRUM-30. Agent-ready: **SCRUM-55**, `maskPan()` in `src/mask.js` of the GitHub sandbox |
| Azure DevOps `Toil Sandbox` (`https://dev.azure.com/<org>`) | The 45 ado-seed items. Sprint 1 is current, 16 to 27 Nov, and Sprints 2 to 6 follow in two-week steps. Done today: #157. In progress: #172 (picked up today). Comments from today on #152 and #176. Repository `settlement-service` with the demo code; PR 1, "cut settlement batches at the merchant's midnight", waits on review and is linked to bug #176. The seed's dependency links, such as #152 → #169, are kept. Agent-ready: **#194**, refund reason validation in `src/refunds.js` |
| Postgres `payments-db` (Docker `toil-demo-pg`) | Schema `payments`: 4,000+ payments (some duplicate captures on one idempotency key), refunds (about one in twenty $0.01 short, because fees are worked out per transaction and rounded down; see view `refund_shortfalls`), six US merchants, all in USD, disputes waiting on a response, payouts (Lumen Games' split payout after its schedule change), and `job_runs` (nightly reconciliation failing on a lock the statement export holds, including last night) |
| Confluence space `OD`, "Overdraft Federal Engineering" | 22 pages, each labelled `toil-seed` and `kb`: teams and ownership, how money moves, runbooks (the reconciliation lock, #22; double charges, #11, PR #37 and SCRUM-20; Lumen Games' schedule change, #15), ADR-007, 009 and 011, standards (money, #38; logging, SCRUM-55; refund reasons, ADO #194), releases (the checklist template, the Black Friday freeze), two incident reviews (one tied to ADO #176) and a glossary. There's no "Black Friday readiness" page on purpose: the agent writes it in video 5. The source is `ui/scripts/demo-confluence/pages/*.html` and `manifest.json`. The older space `KW` from the first draft stays until it's deleted in Confluence's own UI (toil has no space delete) |
| Figma draft "Overdraft Federal: Payout preview" | One frame, "Payout preview / Lumen Games" (50 editable text layers, built from the replica's numbers), and two comments from Ana: the split payout question (GitHub #15) and the reserve link (#18). GitHub #17 links to it. It was made once in the browser and isn't reseeded; `toil figma file get <key> --document` and `toil figma file comments <key>` read it |
| SQLite `~/toil-demo-home/ledger.db` | 6 merchants, 60 settlements, 12 chargebacks |
| Toil project `payments-team` (demo home) | Ties GitHub, Jira, ADO, `payments-db`, Confluence and Figma together |

The agent-ready items are GitHub #38, SCRUM-55 and ADO #194. Each is about 30 minutes of work, names its files, and lists acceptance criteria that `npm test` checks.

## Demo stories

Each story crosses several tools on purpose.

1. **From a chargeback to a merged fix.** Ask Toil UI why refunds come up a cent
   short. It reads `refund_shortfalls`, and the agent-ready GitHub #38 (format amounts as
   US dollars) follows the money standard in Confluence. Start an agent
   with `toil mcp --areas db,jira,github`; it fixes `formatAmount`, opens a PR, and
   the PR shows in Code reviews waiting on checks.
2. **Design to ticket to code.** A Figma mockup of "Payout preview" (#17): the agent
   reads its frames and comments (`toil figma file get`, `toil figma file comments`),
   writes acceptance criteria onto the story, and builds the page.
3. **Release readiness.** `toil deps scan --output-file inv.json` in a clone of the
   sandbox, then `toil osv vulns --from inv.json` (two real advisories), the open
   blockers, and GitHub checks. The agent drafts a release page in Confluence; the
   write gate stops it until you allow it.
4. **The 2 a.m. incident.** "Why did reconciliation fail last night?" Ask joins the
   lock-timeout story to `payments.job_runs` and the overlapping statement export.
5. **Writes, honestly.** An agent tries to fix a row and gets `WRITE_DISABLED` with
   its fix. Turn writes on for one sandbox connection and it goes through.

## Names on screen

The seeds can only assign the token's own identity. Before recording, set the
Atlassian, Azure DevOps and GitHub profile display names to a demo name (for example
"Sam Rivera (demo)"), and keep the Jira site address out of shot.

## Stop and clean up

```bash
node ui/scripts/demo-postgres.mjs --stop
```

`node ui/scripts/ado-seed/cleanup.mjs --project "Toil Sandbox"` removes the seeded
ADO work items. The agent-ready item #194 is tagged `demo-week`, not `toil-seed`, so
remove it by hand if you clean up.

## Stopgaps

On Azure DevOps Services, `demo-week-ado.mjs` uses `toil ado api` for things toil has
no command for yet: creating a repository, setting sprint dates, pushing files, and
linking a work item to a PR. Assigning goes through `work-item update`. A session is
adding these as `ado` commands; switch the script over once they land. The GitHub and Jira seeds have no cleanup: they're sandboxes, and
the seeds pick up from whatever state they find.
