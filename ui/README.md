# Toil UI

A local web app for seeing work across Jira, Azure DevOps and GitHub, read through
[toil](https://www.npmjs.com/package/@imagile-dev/toil): one dashboard per dossier,
with its stories, pull requests, builds and deployments side by side, a pull
requests view for what is waiting on review, and a daily worklog of what happened.

**Status: alpha, local only.** It runs on your own machine, binds loopback, and
reads through toil with your own connections and dossiers, read-only. Its
settings pages, and a dossier's name and description edited in place, are the only
places it changes anything of toil's, and only toil's own connections and dossiers. The worklog keeps its pages and the notes you add in its own
data folder, and writes anywhere else only when you export a page. Its Feedback dialog sends a report to Imagile through
`toil feedback`, only when you approve it. It is a separate package from toil: installing toil
never installs it.

## Start it

```bash
npx @imagile-dev/toil-ui
```

It needs Node 24.14 or later and installs one dependency, `@imagile-dev/toil`, at
the exact version it was built with. Until a version shows on
[npm](https://www.npmjs.com/package/@imagile-dev/toil-ui), run it from a clone of
the repository:

```bash
npm ci --ignore-scripts
npm run build -w ui
node ui/dist/server/toil-ui.js
```

It prints one URL and keeps running until you press Ctrl+C:

```text
Toil UI 0.1.0-alpha.1 (alpha, local only), on toil 0.1.0-alpha.3
Syncing through toil, read-only, with your own connections and dossiers. Only its Settings pages, and a dossier's name and description edited in place, change anything: toil's own connections and dossiers, when you ask. The worklog keeps its pages and your notes in its data folder, and writes anywhere else only when you export one. Feedback goes to Imagile only when you send it.
The cache is /home/you/.toil-ui/cache/toil-ui.db, kept 30 days after each sync; toil-ui wipe deletes it.

Open this URL in your browser. It carries this launch's token, so keep it to yourself:
  http://127.0.0.1:53117/?token=<token>
```

Open that URL. The page trades the token for a session it keeps in memory, and the
token leaves the address bar. A reloaded page forgets its session, so open the URL
again to get back in. Each start prints a new token. Toil UI opens no browser
itself.

`toil-ui --sample` serves the sample dossiers and the scripted agent the site's
preview uses, with nothing connected to a tracker.

## What it reads

Each dashboard reads its dossier the way `toil dossiers show` describes it: the
Jira project, the Azure DevOps project and pipelines, the GitHub repository and
project board, and the OpenShift namespace of each environment. A GitHub section
with no `projects` reads the repository's own issues, open and closed, as its work
items, with the history of every open one and the 50 most recently closed. Pull
requests are read from every code host the dossier names (GitHub, Bitbucket Data
Center and Cloud, Azure DevOps Server and Services) with `pr list`, then `pr get
--include reviews,checks,commits,files` for every open one and the 20 newest closed or
merged ones, and mapped to OWI 0.2 changes; a GitHub repository's CODEOWNERS is read
with `github repo file` when an open pull request has no reviewer. Every call runs
in-process through `@imagile-dev/toil/api`, read-only, and toil's audit log
records it with `via: "api"` and `caller: "toil-ui"`. A call that fails shows on
its own panel with toil's message and fix.

## The Dossiers view

Toil UI opens on its dossiers, one card each, read from the same data the dashboards
read, so it asks no tracker anything: in the local app that is the cache a sync
filled, plus `dossiers list` and `dossiers show` for the dossiers themselves.

- **What each card shows:** the current sprint with its working days left, points
  done and a small burn-up; how many items are in progress and blocked, and how many
  pull requests wait on a review; the people with work in it, as avatars; its sources
  as badges; when it was last synced; and how many work items and pull requests
  changed since this browser last opened its dashboard.
- **Which card leads:** the dossier opened most recently in this browser, or, before
  any was opened, the one with the most in motion (in progress, blocked and waiting on
  review together), takes two columns where they fit. On a wide screen the grid goes
  wider than the dashboards and fits more cards across; at 375px it is one column.
- **What this browser remembers:** when each dashboard was last opened, in
  `localStorage`, never sent anywhere. Without it (a private window) the cards just
  say nothing about "since".
- **The dashboard's header** uses the same parts: the description under the name, the
  sources as badges, and the counts in one strip, so the panels start higher.

### Renaming and describing a dossier

The name and the description have a pencil beside them, on the card and in the
dashboard's header. It opens an inline field: Enter saves through
`toil dossiers describe <dossier> --name <new name>` or `--description <text>`, run
on the settings pages' path (below), so toil's own checks apply and the change is in
its audit log as `caller: "toil-ui"`. Escape cancels, and a refusal shows toil's
message and fix under the field. Only a dossier in your own folder can be renamed or
described; a checked-in one is refused with the `toil dossiers import` fix.

A rename keeps everything Toil UI holds for the dossier: the server moves its cache
(responses, items, history, sources, sync runs, notes and agent runs), its assignments
and its worklog pages to the new name once toil has renamed the file, so its
dashboard opens straight away with no new sync. A rename waits, refused with a
message, while a sync or an assignment of that dossier is running, since both read it
by name as they go. What can't be moved is said beside toil's result, and the next
sync reads the dossier afresh under its new name.

## Pull requests

Each dossier has a **Pull requests** view (`#/dossier/<name>/prs`, linked from its
dashboard and the header), built from OWI 0.2 changes:

- **Waiting now:** the open pull requests, longest wait first, each with what it
  waits on (review, changes, checks, merge, or a draft its author holds), since when
  in working days and why, who wrote it (a person, an agent or a bot, with the signal
  that said so), the work items it names, and its size, XS to XL by changed lines.
- **Flags:** no first review in 2 working days, checks failing for over a day, a merge
  conflict, no linked work item, a work item done while its pull request is open, and
  a merged pull request whose item isn't done, each with what it rests on.
- **Flow:** pickup (opened to first review), review (first review to approval) and
  merge (approval to merge) times, review rounds, sizes and merges per week, over six
  weeks, each split by people, agents and bots and each with its sample size and what
  couldn't be measured.
- **Suggested reviewers:** for an open pull request with nobody asked, the CODEOWNERS
  of its paths and the earlier reviewers of the same files and folders, each as a
  proposal with the `toil … --allow-write` line to ask them.

The dossier's work item keys are matched in each pull request's title, branch and
description (a Jira project's `PAY-101`, Azure Boards' `AB#2302`, a GitHub
repository's `owner/repo#41`). A code host's section may set author kinds by hand,
`"authorKinds": { "release-bot": "BOT" }`, which win over every other signal.

## People

Each dossier has a **People** view (`#/dossier/<name>/people`, in the header), built
from the same OWI work items and changes as the dashboard and the pull requests view,
and from the dossier's `people` section, which says who each person is in every
system (`toil dossiers person`, or **Settings, Dossiers**):

- **A card per person**, agents included, in name order: their work in progress by
  status with how long each item has sat in it, their open pull requests and what
  each waits on, the reviews waiting on them (oldest first), their blocked items and
  what blocks each, and what they did in the last 14 days. A link opens their items
  on the dashboard's board, filtered to them.
- **A team strip:** work in progress against the dossier's `wipLimit` and who is over
  it, the review queue, and the current sprint's unassigned items.
- **Agents:** a person with `kind: "agent"`, matched by the same signals as a pull
  request's author kind (its account, a Co-Authored-By trailer, a branch prefix) where
  the signal names it. A person's own pull request written with an agent says so.
- **Accounts the dossier doesn't map** get cards of their own, so no work goes
  missing. One that shares an email with a person, or with an account in another
  system, is suggested as a match with the `toil dossiers person` line that applies
  it; it is applied only when someone presses the button, and an email that fits more
  than one candidate suggests nothing and says why. Accounts that only wrote bots'
  pull requests are left out and counted.

It shows what is on each plate and never scores anyone: no ranking, no productivity
figure, no person-to-person comparison and no line or commit counts. Flow metrics
stay team-level, in the pull requests view.

## Readiness and the Command Center

Before a work item goes to an agent, Toil UI checks whether it is ready for one. The
check uses no model and no premium request: only the item's cached OWI record, the
dossier's other items, and at most one live read, made when you press for it
(`ui/src/model/readiness.ts`). Its verdict is **ready**, **thin** or **blocked**, with
one row per check:

| Check | Passes when | Otherwise |
|---|---|---|
| Acceptance criteria | The field the dossier names has them, or the description has an "Acceptance criteria", "Definition of done" or "Done when" heading with text under it, or a checklist | thin |
| Description | At least `minWords` words (25 by default) of real text, not counting the dossier's template lines, placeholder lines (TBD, N/A, lorem ipsum) or unfilled `<slots>` | thin |
| Done state | It isn't done, and a way to Done is known: a GitHub issue closes from any state; otherwise an item of the same type in the dossier reached Done, or the live read finds a Done state (Azure DevOps) or a move into Done (Jira) | blocked when it's already done, or the workflow has no Done state; thin when it isn't known |
| Blockers | No open item blocks it | blocked by an open item; thin for a blocker the dossier doesn't hold |
| Scope | It comes from one of the dossier's sources, and the dossier names a repository | blocked from outside the dossier; thin with no repository |

The verdict is blocked when any row is, thin when any row is, and ready only when every
row passes. Each area's section in the dossier sets it up:

```json
"jira": {
  "project": "PAY",
  "fields": { "acceptanceCriteria": "customfield_10500" },
  "readiness": { "minWords": 20, "templates": ["## What\n## Why\n## Acceptance criteria"] }
}
```

`fields.acceptanceCriteria` is also the area's `--field` alias. An Azure DevOps section
that names none uses `Microsoft.VSTS.Common.AcceptanceCriteria`.

- **On each item's page**, a **Ready for an agent?** panel shows the verdict and its
  rows, each with where its answer came from. **Check the workflow live** makes the one
  live read, read-only: `jira issue transitions` for a Jira issue, `ado work-item
  states` for an Azure DevOps type. A GitHub issue needs none.
- **The Command Center** (`#/dossier/<name>/command-center`, in the header) lists every
  work item with its verdict and, for each one that isn't ready, the rows that say why.
  It filters by verdict, status, type, assignee and source, and makes no live read.
  It is strict: only ready items are slated, in the dossier's order, under a plan id
  that changes when anything in the plan does.
- **Starting the plan comes with assign-to-agent (#293).** Until then the start button
  is disabled and says so; the plan it would start is shown above it.
- **The agent** gets `readiness_list` and `readiness_get` and a starter, "Which items
  are ready for an agent?" (The agent, below).
## Worklog

Each dossier has a **Worklog** (`#/dossier/<name>/worklog`, linked from the header):
one page a day, folded by code from what the cache holds, facts only. No model writes
a line of it. A calendar shows the days that have a page, with how many lines each
has; a day opens as `#/dossier/<name>/worklog/<yyyy-mm-dd>`. Days and times are UTC,
as everywhere else in Toil UI.

A page has:

- **Work items** that changed status (from, to, who and when), were added to or
  dropped from a sprint, or got a new blocker.
- **Pull requests** opened, reviewed (approved, changes requested, commented), merged
  or declined.
- **Builds and deployments** that failed or recovered (deployments from OpenShift,
  whose state a sync can see change): a build is recovered when a
  passing run follows a failing one of the same pull request or pipeline.
- **Agent runs:** each question an agent adapter answers in the Ask pane, when it
  started and ended,
  whether it finished, failed, was stopped or was stopped at a usage cap, what it
  cited, and its proposals, each
  with whether toil's audit log (`toil audit list`) shows a person ran that write on
  the same item afterwards. Each run's transcript is kept beside the pages and shown
  under the run, labelled as the agent's.
- **Notes** a person added that day, on today's page.
- **Sources:** each source's syncs that day.

Every line links to its item, pull request, build or transcript, where the source has a
page for it. Two kinds of fact
come in differently. Status and sprint changes, pull requests, reviews and builds
carry their own times in the sources' history, so a page can be built for any past
day the cache covers. A new blocker and a deployment that failed or came back have
no time in the trackers, so a sync sees them by comparing what it read with the last
sync, and the line says which sync first saw it and when the one before ran.

**What a page can't vouch for is said at the top:** a day before the earliest sync the
cache holds, a day no sync of a source ran on, a sync that failed, a source whose latest
sync failed, today so far, and a day older than the retention period.

**How it's kept.** Each sync records its facts in the cache, one row per fact by a key
that never changes, so the same fact synced twice is one row. After each sync every
page is folded again from the cache and written where its text changed, as Markdown
in the data folder:

```text
<data folder>/cache/worklog/<dossier>/<yyyy-mm>/<yyyy-mm-dd>.md
<data folder>/cache/worklog/<dossier>/runs/<run id>.md
```

The pages live under the cache's retention: a day whose rows are gone loses its page,
and a wipe deletes them all. **Rebuild this day** folds the day again and says whether
it came out the same as the page kept; the same cache always gives the same page.

**Export** writes the day's or the month's Markdown into a folder you name, through
toil's own file service: `toil util encode base64 --decode --out <file>`, run with that
folder as its workspace, which writes a new file only and never into toil's own
config. Publishing an exported page is a proposal: `toil confluence page create
--body-file <file> --markdown` in the dossier's Confluence space, or `toil github issue
create --body-file <file>` in its repository, for you to run through toil's write gate.
Toil UI posts nothing. With sample data, notes and export are off.

### Stand-up

**Stand-up since the last working day**, on the Worklog
(`#/dossier/<name>/worklog/standup`), reshapes the worklog for a meeting: since the last
working day through today (Friday through Monday on a Monday), or any range of up to 31
days you pick (`#/dossier/<name>/worklog/standup/<from>/<to>`, or `/<day>` for one), and each day's page has a
**Stand-up for this day**. It is a fold of those days' pages by code, with no model, so the
same days always give the same report.

- **Team lines first:** the sprint's working days left, items added to or dropped from a
  sprint, and builds and deployments that broke or recovered.
- **Then each person, agents included,** in four lists: **Done** (items moved into a done
  status, pull requests merged or closed), **In progress** (every other status change,
  pull requests opened or reviewed), **Blocked** (a new blocker on an item they hold, a
  failed build of their pull request, a pull request of theirs waiting on review for 2
  working days or more) and **Next** (current-sprint items assigned to them and not
  started). A line belongs to whoever the fact names: who moved the item, who wrote or
  reviewed the pull request. A pull request a dossier agent wrote goes under the agent.
- **People** come from the dossier's `people`, so one person's Jira, Azure DevOps and
  GitHub accounts land under one name. An account the dossier doesn't map gets its own
  card, named with its area and id; the People view suggests where it belongs.
- **What the worklog can't vouch for** in the range is said at the top. Review waits, the
  sprint and Next aren't on any worklog page, so they are as of the latest sync, and the
  report says which.
- **Every line links** to its item, pull request or build, and is numbered (F1, F2, ...).

It copies as **Markdown** (for Slack, Teams or a wiki) or **plain text**, line for line as
shown. **Export** writes the Markdown through toil's file service, as a page's export does,
to `standup-<dossier>-<from>-to-<to>.md`, and publishing it to Confluence or GitHub is a
proposal for you to run.

**Write it up** is optional: it asks the agent for a short narrative of the same report,
in the theme's voice when that is on. The agent reads the report through its
`standup_report` tool and ends each sentence with the fact numbers it rests on; the
write-up is labelled as the agent's, the lines it names are marked in the report, and its
usage counts like any chat's.

## Toil's configuration

The Settings pages manage what `toil connections` and `toil dossiers` manage, by
running those commands through `@imagile-dev/toil/api`, never by editing a file:

- **Connections:** list, add, test, set the default, turn writes on or off,
  replace a secret (`toil connections login`) and remove. A secret goes from a
  password field to toil, which keeps it in the OS credential store; the page
  clears the field, and it is never logged, stored by Toil UI, or sent back.
  Turning writes on asks you to type the connection's name, as the CLI does. A
  connection made by `TOIL_*` env vars alone is shown read-only, with where it
  came from.
- **Dossiers:** create one, add a repository, link an area, name a field, and
  show and check any of them. A dossier's name and description are edited in place
  on its card and dashboard, through `toil dossiers describe`. A link to a connection with writes on is refused
  here, as over MCP: make it on the CLI.
- **Bounds and time limit:** toil has no command for these, so they are shown
  read-only, with the file or env var that sets them.
- **Usage:** how toil is used on this machine, from `toil audit stats`, which
  reads only toil's local audit log: calls per day, the split between Toil UI, the
  CLI and MCP, the commands used most, the ones that fail most with their top
  error code and its usual fix (and, on request, their recent failures from
  `toil audit list`), and the commands nothing called. It needs a toil with
  `audit stats`, newer than 0.1.0-alpha.3; with an older one the page shows toil's
  error.

Every change is an explicit action, runs the command's own checks, and is in
toil's audit log as `caller: "toil-ui"`. The page can run no other command on this
path, and never a tracker write. Adding or changing connections needs a toil
newer than 0.1.0-alpha.2; with that one, use the CLI.

## Feedback

The **Feedback** button in the header opens a dialog for a bug report or a feature
request: the kind, a title, the details and your email. It sends through
`toil feedback` (toil's `skills/toil/core.md`, **Feedback**), never on its own:

- **A live preview.** As you type, the page asks toil for the report it would send,
  read-only, and shows it exactly, with the endpoint. Nothing is sent to show it.
- **toil's disclaimer, and a checkbox.** The report goes to Imagile LLC, which files
  it as a public GitHub issue; your email stays private; you remove company data
  first. Send works only while the box is ticked, and any edit clears it, so you
  agree to the report on screen and no other.
- **Only what you typed.** toil adds its version and commit, nothing else: no
  dossier, connection, host or cached data.
- **The same lock as Settings.** `api/feedback` needs the session, the page's
  Origin and the CSRF token, takes the four fields and nothing else, and runs
  `toil feedback` and no other command. Your tick becomes the yes to the command's
  own consent question. With sample data it sends nothing. With a toil that has no
  `feedback` command (0.1.0-alpha.2), the dialog says so and points at the site's
  form.

## Sync and the cache

The dashboards read from a local cache, which a sync fills. Press **Sync now** in
the Sync panel at the foot of the page. The sync makes the same toil calls the
dashboards make, for every dossier, and stores the answers. The work items go
through toil's Open Work Item mapping, with their status changes and the pull
requests, builds and deployments that name them.

- **Incremental.** After the first sync, Jira and Azure DevOps searches, and a
  GitHub repository's issues, ask only for what changed since the last good sync (`updatedSince`, five minutes early in
  case the clocks disagree), and the GitHub board marks the issues whose
  `updatedAt` moved. Only those items and their histories are fetched again.
  Pull requests, builds, deployments and iterations have no "changed since" in
  toil, so they're read again each time, bounded as the dashboards bound them.
- **Every page.** Each call follows `meta.page.nextCursor` to the end, up to 200
  pages, and fails that source, saying so, rather than keep part of a listing.
- **Each source on its own.** Each area a dossier reads (Jira, Bitbucket, Jenkins,
  OpenShift and so on) is a source with its own state. A source that fails shows
  toil's message and fix in the Sync panel, and keeps its last good data, marked
  stale. The other sources and dossiers aren't touched. The next sync asks it
  for everything since its last good sync, so nothing is missed.
- **When.** The line under the header says when the data was synced. The panel
  says when each dossier was synced, and shows a running sync's progress
  (requests, pages and retries, from toil's own progress events).
- **Where.** The cache is one SQLite file, `cache/toil-ui.db` in the data folder,
  through Node's built-in `node:sqlite`, so there's no native module. While Toil
  UI runs, its write-ahead log (`toil-ui.db-wal` and `toil-ui.db-shm`) sits beside
  it, and closing folds the log back into the file. It holds
  ticket content, so it stays on this machine and is readable by your account
  only.
- **For how long.** Anything not synced again within the retention period (30
  days by default) is deleted, at start and after each sync.
- **Wiping it.** **Wipe the cache** in the Sync panel deletes it after asking
  first. `toil-ui wipe` does the same from a terminal, once `toil-ui` has
  stopped: a running Toil UI holds `toil-ui.lock` in the data folder, and the
  command refuses while it does. Your trackers are never touched. The next sync fetches everything again.
- **Deleted tickets.** An item deleted in its tracker stays in the cache until
  the retention period ends or you wipe it, since an incremental search only
  returns items that still exist.

The page can run only the reads the dashboards make: `dossiers list` and `dossiers
show`, and each area's search, history, pull request, build and deployment reads.
Any other command is refused before it reaches toil, and a change to a tracker is
never made from the page. The worklog's own calls are made by the server, never named
by the page: `toil audit list`, read-only, to see whether a proposal was applied, and
`toil util encode` for an export you asked for.

## The agent

The docked chat answers with the agent your organization already approved, on the
subscription you already have. Toil UI has three adapters, each an optional peer
dependency that is loaded only when you choose it:

| Adapter | Package | Starts | Signs in with |
|---|---|---|---|
| Claude | `@anthropic-ai/claude-agent-sdk` (and its peer `zod`) | `claude` (Claude Code) | Claude Code's own login, or Bedrock, Foundry or Vertex through Claude Code's environment switches |
| GitHub Copilot | `@github/copilot-sdk` | `copilot` (the Copilot CLI) | your Copilot seat, through the CLI |
| Codex | `@openai/codex-sdk` | `codex` (the Codex CLI) | the CLI's ChatGPT sign-in or its own API key setup |

```bash
npm install -g @anthropic-ai/claude-agent-sdk zod   # beside a global toil-ui
```

Then choose it under **Settings, Agent**: the adapter, the model (empty for the CLI's
default), the CLI's path (empty to use the one on `PATH`) and, for Claude, the
endpoint. The choice is kept in `<data folder>/agent.json`, never in toil's config,
and has no field for a key: each SDK signs in the way its CLI does. Install the SDK
with `--omit=optional` if you don't want its bundled copy of the CLI on disk; Toil UI
never starts that copy anyway.

- **Only the CLI already on this machine.** Toil UI finds it on `PATH` (skipping
  relative entries and the working directory) or at the path you set, which must
  name that CLI, hands that path to the SDK, and never downloads one.
- **An environment of its own.** The CLI gets only what it needs to run (paths, home
  and temp folders, proxy and CA settings) and its own sign-in variables. toil's
  `TOIL_*` variables, `GITHUB_TOKEN` and CI tokens never reach it. Not found is a plain
  error naming the CLI and the fix. On Windows a `.cmd` shim can't be started by the
  SDKs, so point at the `.exe`.
- **Read-only tools, one dossier.** The agent gets `owi_query`, `owi_get`,
  `owi_similar` (likely duplicates, scored as `toil util owi similar` scores them)
  and `owi_history` over the cache, `pr_query`, `pr_get` and `pr_metrics` over its
  pull requests (what each waits on, its flags, and flow figures by author kind with
  their sample sizes), `people_list` and `person_get` (each person's plate as the
  People view works it out, with the dossier read live through `dossiers show`, and
  told it describes load, never performance), `readiness_list` and
  `readiness_get` (each item's readiness verdict and its rows, as the Command Center
  works them out), `proposal_fields` (a write command's input fields,
  told it describes load, never performance), `worklog_day` (one day's worklog page,
  with what it can't vouch for), `standup_report` (a range of days as the Stand-up folds
  them, each line numbered), `proposal_fields` (a write command's input fields,
  from toil's registry), and `toil mcp`'s read tools for live lookups, called through
  toil's `execute()` with `readOnly: true`. The dossier is fixed to the one on screen.
  There is no write tool, and each SDK's own tools (shell, files, web, plugins, other
  MCP servers) are switched off.
- **Citations are checked.** Every answer cites the work items and pull requests it
  used as links.
  The server holds each id it names to what its tools returned, and flags any other
  as unverified above the answer.
- **Writes are proposals.** A change the agent suggests comes back as a card with the
  `toil … --allow-write` command line for you to run through toil's write gate. The
  agent can't run it.
- **Codex takes tools only from an MCP server**, so for the length of one question
  Toil UI serves them at `api/agent/mcp` on its own loopback port, behind a token made
  for that question. The token reaches Codex in its environment, never on its command
  line, and the endpoint refuses any request carrying a browser's `Origin`.
- **Codex runs in a Codex home of Toil UI's own**, `<data folder>/cache/codex`, not
  yours. Codex adds whatever its home's config names (MCP servers, profiles, plugins,
  hooks, skills) to what it's given, so with your own home your servers would start
  beside Toil UI's. Toil UI's home holds a `config.toml` it rewrites before every
  question, so `codex mcp list` there shows only `toil_ui`, and `auth.json`, a hard
  link to the one in your Codex home (`$CODEX_HOME`, else `~/.codex`). A hard link is
  the same file under a second name, not a copy: a token Codex refreshes is refreshed
  for both, and once you sign out of Codex the next question removes the link and says
  so. With no `auth.json` (a sign-in kept in the OS keyring, or none), `CODEX_API_KEY`
  in Toil UI's environment signs in instead. Your data folder and your Codex home must
  be on the same drive. `toil-ui wipe` deletes this home with the cache, along with
  Codex's record of Toil UI's questions, and leaves your own `auth.json` alone.

- **Your own instructions.** Under **Settings, Agent**, general instructions (for
  example "answer in British English") and a custom voice, each up to 4,000
  characters, kept in `agent.json` beside the adapter. They come after the rules in
  the prompt, and the rules win: they can't change the citations, the figures, the
  proposals or what the tools can do. **Show the full prompt** shows exactly what
  the agent is sent.

With no adapter chosen, the chat says so and names the three. `toil-ui --sample`
keeps the scripted agent, which answers its starter questions from the sample data.

### What the agent's models used

Each SDK reports what a question used, and Toil UI keeps that report, one record per
model call or running total, read only from the SDK's own events (no billing API is
called):

| Adapter | What the SDK reports | What Toil UI shows |
|---|---|---|
| Claude | each step's `usage` by message id, then the result's `modelUsage` per model and its `costUSD` | tokens (in, out, cache read, cache write) per model, and the dollar figure as the SDK's estimate; on a Claude plan (no API key, Anthropic's own API) it says "API-equivalent", since the plan isn't billed per token |
| Codex | `turn.completed`'s `usage`: input (which holds the cached input), cached input, cache writes, output | tokens; a dollar figure only from rates you enter, labelled "computed from your rates". The SDK names no model, so a Codex record names the model you chose, or says it wasn't named |
| GitHub Copilot | one `assistant.usage` event per model call, with `cost` as the premium-request multiplier, and `session.usage_info` for the context | tokens and premium requests, never dollars; premium requests left from the SDK's experimental `account.getQuota`, marked experimental |

- **Under each answer**, one line per model: `2.1k in · 380 out · 14k cached · cache
  write not reported · ~$0.012 (SDK estimate)`. A figure the SDK didn't report reads
  "not reported", never 0.
- **In the chat's heading**, the chat's running total, split by model, and how full
  the last answer's context got, where the SDK says (Claude and Copilot; Codex's SDK
  doesn't).
- **Settings, Agent usage** (beside Usage, which counts toil's own commands): the last
  30 days by day, adapter, model and dossier, the chats that used the most, and an
  **Export as CSV** download made in the page.
- **One adding-up rule**, `addUp` in `src/model-usage.ts`, read by the server's caps,
  the footer, the heading and Settings: reports with one id are one report, merged to
  the highest of each figure (a running total), and different ids are summed.
- **The ledger** is the cache's `usage` table, apart from everything a sync writes: a
  sync's cleanup or a dossier leaving never lowers a total. It follows the cache's
  retention, `toil-ui wipe` clears it, and it is never sent anywhere.

**Caps** are optional and off until you turn one on, under Settings, Agent usage: a
per-chat and a per-day (UTC) cap for each adapter, in tokens, dollars (Claude's SDK
estimate, or Codex from your rates) or Copilot premium requests. At 80% the answer
says so; at 100% the question stops, naming the cap and how to raise it. Claude and
Copilot report each call as it happens, so their caps stop a run partway; Codex
reports when an answer ends, so its cap refuses the next question. They live in
`<data folder>/usage.json`, with the Codex rates. A value that doesn't parse is
refused, naming the setting, and while the file can't be read the agent answers
nothing, so a typo can never turn a cap off. A cap counts only what the SDK reports:
the vendor's own bill is the authority.

## Assigning work to an agent

From an item's page, or **Assign to an agent…** in its card's menu on the board
(right-click the card, long-press it, or press M while it has focus), a work item can be
assigned to Claude, GitHub Copilot or Codex in one of three modes. The agent works on
the subscription you already have, and nothing it proposes leaves this machine until
you apply it.

| Mode | What the agent does | What it can change |
|---|---|---|
| **Refine** | Checks for duplicates, drafts acceptance criteria, suggests an estimate, splits the item into children where it is too big, and asks its open questions | Nothing: every change is a proposal |
| **Investigate** | Reads the item, its parent, children, links, likely duplicates, pull requests and toil's live reads, and writes a report that cites each source | Nothing: the report is kept with the assignment, and posting it as a comment is a proposal |
| **Implement** | Works in a copy of the dossier repository's git folder that Toil UI makes in a folder of its own, fills it from the last commit, makes the branch `agent/<key>`, changes and tests the code, and stages the change | Only that clone, with no network. Committing, pushing and opening a pull request are proposals |

- **Refine and investigate** get the same read-only tools as the chat (`owi_*`, `pr_*`,
  `proposal_fields` and toil's live reads), with no shell and no file writes.
- **Implement runs on Codex only, for now.** Codex's own sandbox, `workspace-write`,
  holds the agent's commands and writes to the clone, with no network and none of the
  temp folders Codex adds by default, on Windows (its `unelevated` restricted-token sandbox), macOS and Linux. The clone is
  `<data folder>/cache/work/<assignment>/repo`, so `toil-ui wipe` deletes it; before any git runs there outside the sandbox, Toil UI rewrites its git config and removes its hooks. The dossier's
  repository needs a local path (`toil dossiers add-repo <dossier> <folder>`). The agent stages its change and never commits, pushes or fetches; the
  staged diff is shown through toil's own `git status` and `git diff`, and the commit
  and push are a proposal of the exact git lines to run, since toil has no command
  that pushes.
- **States**: `queued` (waiting for a free slot, or for a person to press Start),
  `working`, `needs you` (proposals or questions to review, or an item the agent
  thought was trying to instruct it), `done` and `failed`. The **Agents** lane on the
  dashboard shows each assignment's state, mode, adapter, run time and what it used,
  and the People view shows each agent's assignments.
- **From the Command Center**, "Start every ready item" assigns each slated item in
  implement mode, in order, on Codex (or the adapter chosen in Settings, when it can
  implement), in the dossier's one repository with a local path, and says what it
  queued or why it started nothing.
- **The tracker only queues.** An item labelled `agent:refine`, `agent:investigate` or
  `agent:implement`, or assigned to one of the dossier's agents (its `people` with
  `kind: agent`, which queues a refine), appears in the **Agent inbox** on the next
  read. It runs only when a person presses Start.
- **Applying a proposal** runs its toil command, the one the server stored when the
  run ended, through toil's write gate: the connection needs `writes: true`, and your
  press of Apply is the call's `--allow-write`. Each call toil makes for an assignment
  is in toil's audit log with `caller: "toil-ui"` and `actor: "assignment-<id>"`.
- **Tracker text is untrusted.** The item is fenced off in the prompt as data, and an
  item that tells the agent to do anything else stops the run, marked `needs you`.
- **Limits.** One assignment runs at a time and each has 20 minutes, both changeable
  in the lane's **Limits** (1 to 3 at once, 1 to 240 minutes), kept in
  `<data folder>/assignments.json`. An assignment is one chat to the usage caps under
  **Settings, Agent usage**, so a per-chat cap is a per-assignment cap. Either limit
  stops a run cleanly, saying which.
- **The transcript** keeps the prompts, every tool call, the agent's text, the
  commands and file changes Codex reports, and each proposal and what came of it.
  Each assignment also records what it started on: the toil and Toil UI versions, the
  adapter and model, the tools, and SHA-256 fingerprints of the dossier, the item and
  the prompt. Assignments are kept under the cache, in
  `<data folder>/cache/assignments/`, so a wipe deletes them.
- **For programs on the same server**, `api/assignments` lists, assigns, starts,
  stops, applies and dismisses, and `api/assignments/events?since=<n>` streams every
  change of state as NDJSON.

## Themes

Five built-in themes: Plain, Crate (the default), Harvest, Starship and Realm. Pick
one from the header, or under **Settings, General**, where two checkboxes say how far
it goes, both on by default:

- **Themed wording:** the theme's own lede, eyebrows, dashboard notes, empty
  states and loading lines, and its names for a sprint, a board or an epic beside
  the real ones ("Campaign (Epic)"). Buttons, links, figures, ids, commands and errors
  read the same in every theme.
- **Themed agent voice:** the agent answers in the theme's register, a terse
  dockworker in Crate, a patient farmhand in Harvest, a ship's log in Starship, a
  house's steward in Realm. It changes phrasing only.

A theme with particles also gets **Particles and ambient effects**, kept for each
theme on its own: off, that theme's particles are gone entirely, while its other
motion keeps following **Reduce motion and effects** (and the operating system's
reduced-motion setting, which stops everything).

Plain has neither wording nor voice, so both are off while it's chosen. It sets
headings and figures in Fredoka, toil's wordmark face, on IBM Plex Sans. The choice
is kept in this browser. Toil UI doesn't install themes from anywhere else: to ask for one, send a
feature request from **Feedback** or with `toil feedback feature`. A `themes/` folder
left in the data folder by an earlier alpha is not read, and Toil UI says so when it
starts. [Themes](https://imagile-dev.github.io/toil/docs/themes/) has the whole
story, the composed prompt included.

## The lock on the door

Any program on the machine, or a web page using DNS rebinding, can reach a local
port, so the server lets in only the browser holding this launch's token:

- **The token.** A random token per start, in the URL it prints. The page trades it
  for a session id, which it keeps in memory and sends as a header on every API
  call. Nothing is kept in a cookie: a browser would send one to any other server
  on `127.0.0.1`, whatever its port.
- **The Host header.** Only the exact `127.0.0.1:<port>` it printed is answered.
- **No CORS.** No `Access-Control-*` header is ever sent. Every POST also needs the
  page's own `Origin`, a JSON body, and the session's CSRF token.
- **No network but toil's.** It talks to the hosts in your toil connections, and
  nothing else, apart from a feedback report you send, which toil sends to Imagile. The agent CLI you choose talks to its own model endpoint.

## Run against a real repository

From a clone, one command starts Toil UI on a real GitHub repository, in a home
folder of its own (`.scratch/home` in the clone, ignored by git), so your own
`~/.toil` and `~/.toil-ui` are never read or written:

```bash
npm ci --ignore-scripts
npm run build -w ui
node ui/scripts/dev-real.mjs
```

It works the same in PowerShell, Git Bash and a macOS or Linux shell. It needs the
GitHub CLI signed in (`gh auth login`), or `TOIL_GITHUB_TOKEN` set in the shell.

- **toil's config**, written once: one connection, `github`, to
  `https://api.github.com`, with writes off and no token in the file.
- **The token** comes from `gh auth token` each time it starts and goes only into
  Toil UI's environment, as `TOIL_GITHUB_TOKEN`. It's never written to a file or
  printed. `GITHUB_TOKEN` and other `TOIL_*` variables in your shell are left out.
- **The dossiers**, made with `toil dossiers init` and `link` and checked with
  `toil dossiers check`: one for `--repo`, and `toil-self` for the public
  `imagile-dev/toil` unless `--no-self`. `--repo` defaults to
  `imagile-dev/toil-sandbox` (as `sandbox`), which is private to Imagile's
  maintainers; anyone else passes their own repository, or seeds a sandbox of their
  own (below).
- **toil from this checkout.** Each start builds toil from the clone into
  `.scratch/toil` (`npm run build` with `TOIL_BUILD_DIR`, a few seconds), and both the
  dossier setup and Toil UI run on that build, not on the published toil
  `ui/package.json` pins. Toil UI is started with `node --import
  ui/scripts/local-toil-hook.mjs`, which resolves `@imagile-dev/toil/api` to
  `.scratch/toil/api.js` and says so on stderr. So a command `ui/` calls before its
  release works here. The committed `dist/` and `node_modules` are left alone, and a
  plain `node ui/dist/server/toil-ui.js` still runs on the pinned toil.
- **Then** it starts `ui/dist/server/toil-ui.js` on loopback and prints its URL.
  Press **Sync now**, then open a dossier. `--port <n>` fixes the port, and
  `--home <dir>` uses another folder.
- **Ask with Codex.** Install the SDK in the clone without saving it
  (`npm install --no-save --ignore-scripts @openai/codex-sdk@0.160.0`), then choose
  Codex under **Settings, Agent**. The script points `CODEX_HOME` at your real
  `~/.codex`, which is where Toil UI finds the `auth.json` it links into its own
  Codex home.

## Verify before you open a PR: `npm run verify:ui`

One command checks Toil UI the way a reviewer would, and writes what it found to
`ui/.verify/report.md` with screenshots beside it (git ignores the folder). Run it
from the root or from `ui/`, and paste the report's table into the PR.

```bash
npm run verify:ui                 # build, sample data, real data
npm run verify:ui -- --ask        # and one Codex question
npm run verify:ui -- --no-build --starter standup
```

- **It builds Toil UI and toil**, unless `--no-build`: toil from this checkout into
  `.scratch/toil`, which Toil UI runs on, as `dev-real.mjs` does (above). The report's
  header and its **Toil** row name that toil: its version, the commit it was built
  at, and whether `src/` had uncommitted changes. The run fails if Toil UI didn't
  resolve `@imagile-dev/toil/api` to it. It also confirms that the toil `npm ci`
  installs is the one `ui/package.json` pins (`npm run check:lockfile -w ui`), which
  is what the published package runs on.
- **Sample data:** `toil-ui --sample` in a throwaway home, every view through the
  layout check (`scripts/layout-check.mjs`) in every theme and scheme at 375, 768 and
  1440px. It needs only a browser, so it runs anywhere, CI included.
- **Real data:** the home `dev-real.mjs` sets up, made fresh at
  `.scratch/verify/home`, on `imagile-dev/toil-sandbox` with the token from `gh auth
  token` in Toil UI's environment only. It syncs the `sandbox` dossier and runs the
  same check over the home page, the dossier, one of its items and the settings pages.
  Without a GitHub sign-in it skips this part and says so; nothing else depends on it.
- **`--ask`** asks Codex one starter question (`hygiene` unless `--starter <id>`) and
  checks that an answer arrived, that the server verified every `[[id]]` it cites,
  that its proposals parsed, that nothing ran (no write in toil's audit log for the
  run), and that `codex mcp list` in Toil UI's Codex home shows only `toil_ui`. It
  needs the Codex CLI signed in and the SDK installed in the clone (above).
- **What fails it:** any layout problem in any theme, and any axe violation at WCAG
  2.2 AA in Plain and Crate. Axe findings in the other themes are listed in the report
  and never fail it. Screenshots are of Plain and Crate.
- **It stops** every server and browser it started, and exits 1 on any problem.

`--source ado` runs the real-data part against an Azure DevOps Services board
instead (the `ado-board` dossier, as `dev-real.mjs --source ado` makes it below),
with `TOIL_ADO_CLOUD_BASE_URL`, `TOIL_ADO_CLOUD_PAT` and `--project <name>` (else
`TOIL_ADO_CLOUD_PROJECT`); without them it skips that part and says why. Each source is
one entry in `SOURCES` in `scripts/verify.mjs`. Set `CHROME_PATH` if the browser it finds doesn't draw headless; Playwright's
Chromium works where an installed Chrome doesn't.

### The sandbox repository

`imagile-dev/toil-sandbox` is a private repository of made-up work for trying
this, and the seed below makes the same in a repository of yours: labels for type, priority, points and blocked; three milestones as sprints
(41 closed, 42 current, 43 next); 25 issues, open and closed, some assigned, some
blocked by others, a few unestimated, one with a very long title; a workflow that
only echoes, with one branch that fails on purpose; four pull requests that
close issues (merged, open, draft, and one with a failing build); and comment
reviews on two of them. GitHub won't let a pull request's author approve it or be
asked to review it, so review requests are seeded only when the repository has a
second collaborator to ask; with one, the seed says it skipped them.

```bash
gh repo create <owner>/toil-sandbox --private --add-readme
node ui/scripts/seed-sandbox.mjs --owner <owner> --repo toil-sandbox
```

The seed writes through the GitHub CLI's own login, never through toil, and is
safe to run again: what exists is found by name or title and left alone. To start
over, delete the repository (`gh repo delete <owner>/toil-sandbox`, which needs the
`delete_repo` scope), create it again and re-run the seed. It adds no Projects
board, which needs the `project` scope on the token, and no deployments, which
toil's `github` area doesn't read.

### An Azure DevOps Services board

`--source ado` runs the same way against an Azure DevOps Services project, through
toil's `ado-cloud` area, with a dossier named `ado-board`:

```bash
node ui/scripts/dev-real.mjs --source ado --project "<project>"
```

It needs `TOIL_ADO_CLOUD_BASE_URL` (`https://dev.azure.com/<organization>`) and
`TOIL_ADO_CLOUD_PAT` (an organization-scoped token with Work Items, Read) in the
shell. They go into Toil UI's environment only: toil makes its `ado-cloud`
connection from them, with writes off, and nothing about the organization is
written to the config file. `--project`, or `TOIL_ADO_CLOUD_PROJECT`, names the
project; the dossier in the scratch home holds it. The dossier names no repository,
so no pull requests are read; add `repo` to its `ado-cloud` section for them.

To fill a board with made-up work, `ui/scripts/ado-seed/` seeds one from Open Work
Items. `items.owi.json` holds 45 of them across the three sample products
(`card-payments`, `settlement`, `checkout-web`): Scrum epics, features, backlog
items, tasks and bugs, in a mix of states, in Sprints 1 to 3 and the backlog, with
efforts (some missing), acceptance criteria (some missing), parents, dependencies,
related pairs, long titles and two stale items. It's written by a seeded generator,
so the same seed always gives the same file:

```bash
node ui/scripts/ado-seed/generate.mjs                                   # writes items.owi.json, checked against docs/owi/schema.json
node ui/scripts/ado-seed/apply.mjs --project "<project>" --dry-run      # what it would create; sends no write
node ui/scripts/ado-seed/apply.mjs --project "<project>"                # creates what's missing
node ui/scripts/ado-seed/cleanup.mjs --project "<project>"              # lists the seeded items, deletes nothing
node ui/scripts/ado-seed/cleanup.mjs --project "<project>" --confirm <code>   # sends exactly that list to the recycle bin
```

The scripts read the same two variables, create and change work items only, in
sprints that already exist (a missing sprint stops the run; none is ever created),
and touch only items tagged `toil-seed` with one `seed:<key>` tag. Every item gets
both. Running `apply.mjs` again creates only what's missing. Each item's history is
backdated to its timeline when the token's identity may bypass rules, and seeded with
ordinary transitions dated today when not, which the run says. `cleanup.mjs` deletes
only after a dry run has listed the items: the code it prints is made from their ids,
and `--confirm` refuses a code for any other list. Deleted items can be restored from
the project's recycle bin. To start over, clean up and apply again.

To check what toil reads back, map the board's output and compare it with the file:
`compare.mjs` matches each item to its record by its `seed:` tag and prints every
difference, leaving out what the server assigns.

```bash
toil ado-cloud work-item iterations --project "<project>" > board.jsonl
toil ado-cloud work-item get-many <ids…> >> board.jsonl
toil ado-cloud work-item history <id> >> board.jsonl        # once for each id
toil util owi map board.jsonl > mapped.json
node ui/scripts/ado-seed/compare.mjs mapped.json --project "<project>" --backdated
```

## Settings

| Setting | Flag | Env var | Default |
|---|---|---|---|
| Bind address | `--host` | `TOIL_UI_HOST` | `127.0.0.1` (`::1` is the other choice) |
| Port | `--port` | `TOIL_UI_PORT` | `0`: the OS picks a free one |
| Base path | `--base-path` | `TOIL_UI_BASE_PATH` | `/` |
| Data folder | `--data-dir` | `TOIL_UI_DATA_DIR` | `~/.toil-ui` |
| Retention | `--retention-days` | `TOIL_UI_RETENTION_DAYS` | `30` (1 to 3650) |

A flag beats its env var. Any bind address other than loopback is refused in this
release. The data folder is Toil UI's own, apart from toil's `~/.toil/`, and holds
the cache, `agent.json` and `usage.json`. A `~` at the start of `TOIL_UI_DATA_DIR` means your home folder, on
Windows too.

## Not in this alpha

- **Serving other machines.** It is local only.
- **Implement mode on Claude or Copilot**, and **answering an agent's questions in the assignment** itself: answer on the item and assign it again.

## The package

`@imagile-dev/toil-ui` ships the server (`dist/server/toil-ui.js`) and the built app
(`dist/app/`), and nothing else. It has no install scripts and no native addons,
spawns no program of its own (an agent SDK you install starts its CLI), and its
front end's framework is built in rather than installed. The agent SDKs are
optional peer dependencies: none is installed with it.

Apache-2.0. See `NOTICE` for what the app bundles.
