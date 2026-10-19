# Toil UI

A local web app for seeing work across Jira, Azure DevOps and GitHub, read through
[toil](https://www.npmjs.com/package/@imagile-dev/toil): one dashboard per dossier,
with its stories, pull requests, builds and deployments side by side.

**Status: alpha, local only.** It runs on your own machine, binds loopback, and
reads through toil with your own connections and dossiers, read-only. Its
settings pages are the one place it changes anything, and only toil's own
connections and dossiers. Its Feedback dialog sends a report to Imagile through
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
Syncing through toil, read-only, with your own connections and dossiers. Only its Settings pages change anything: toil's own connections and dossiers, when you ask. Feedback goes to Imagile only when you send it.
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
project board, and the OpenShift namespace of each environment. Every call runs
in-process through `@imagile-dev/toil/api`, read-only, and toil's audit log
records it with `via: "api"` and `caller: "toil-ui"`. A call that fails shows on
its own panel with toil's message and fix.

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
  show and check any of them. A link to a connection with writes on is refused
  here, as over MCP: make it on the CLI.
- **Bounds and time limit:** toil has no command for these, so they are shown
  read-only, with the file or env var that sets them.

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

- **Incremental.** After the first sync, Jira and Azure DevOps searches ask only for
  what changed since the last good sync (`updatedSince`, five minutes early in
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
  through Node's built-in `node:sqlite`, so there's no native module. It holds
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
never made from the page.

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
- **Read-only tools, one dossier.** The agent gets `owi_query`, `owi_get` and
  `owi_history` over the cache, `proposal_fields` (a write command's input fields,
  from toil's registry), and `toil mcp`'s read tools for live lookups, called through
  toil's `execute()` with `readOnly: true`. The dossier is fixed to the one on screen.
  There is no write tool, and each SDK's own tools (shell, files, web, plugins, other
  MCP servers) are switched off.
- **Citations are checked.** Every answer cites the work items it used as links.
  The server holds each id it names to what its tools returned, and flags any other
  as unverified above the answer.
- **Writes are proposals.** A change the agent suggests comes back as a card with the
  `toil … --allow-write` command line for you to run through toil's write gate. The
  agent can't run it.
- **Codex takes tools only from an MCP server**, so for the length of one question
  Toil UI serves them at `api/agent/mcp` on its own loopback port, behind a token made
  for that question. The token reaches Codex in its environment, never on its command
  line, and the endpoint refuses any request carrying a browser's `Origin`.

- **Your own instructions.** Under **Settings, Agent**, general instructions (for
  example "answer in British English") and a custom voice, each up to 4,000
  characters, kept in `agent.json` beside the adapter. They come after the rules in
  the prompt, and the rules win: they change phrasing, never the citations, the
  proposals or what the tools can do. **Show the full prompt** shows exactly what
  the agent is sent.

With no adapter chosen, the chat says so and names the three. `toil-ui --sample`
keeps the scripted agent, which answers its starter questions from the sample data.

## Themes

Five built-in themes: Plain, Crate (the default), Harvest, Starship and Realm. Pick
one from the header, or under **Settings, General**, where two checkboxes say how far
it goes, both on by default:

- **Themed wording:** the theme's own empty states, loading lines, eyebrows and
  notes. Buttons, links, headings, figures, ids, commands and errors read the same
  in every theme.
- **Themed agent voice:** the agent answers in the theme's register, a terse
  dockworker in Crate, a patient farmhand in Harvest, a ship's log in Starship, a
  herald in Realm. It changes phrasing only.

Plain has neither, so both are off while it's chosen. The choice is kept in this
browser. Toil UI doesn't install themes from anywhere else: to ask for one, send a
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
the cache. A `~` at the start of `TOIL_UI_DATA_DIR` means your home folder, on
Windows too.

## Not in this alpha

- **Serving other machines.** It is local only.

## The package

`@imagile-dev/toil-ui` ships the server (`dist/server/toil-ui.js`) and the built app
(`dist/app/`), and nothing else. It has no install scripts and no native addons,
spawns no program of its own (an agent SDK you install starts its CLI), and its
front end's framework is built in rather than installed. The agent SDKs are
optional peer dependencies: none is installed with it.

Apache-2.0. See `NOTICE` for what the app bundles.
