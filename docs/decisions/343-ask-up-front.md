# Ask up front, live agent switching, and one-press SDK install (#343, #344)

- **The npm exception (#344; the maintainer's decision, 2026-10-20, recorded here
  because `AGENT_DECISIONS.md` is frozen).** Toil UI may run exactly one kind of
  command: `npm install` of one adapter's SDK at the version Toil UI was tested with
  (`ui/server/agents/tested.ts`), beside Toil UI, after the person has seen the exact
  command and pressed Install. It runs `node <npm-cli.js> install …` through the npm
  that came with the Node running Toil UI, with no shell, `--ignore-scripts`,
  `--before=<14 days ago>`, and the person's own environment and npm config (less
  toil's `TOIL_*` variables). The server builds the command from an adapter name
  alone, never a package name the page sends, and runs it only if it matches the
  command the dialog showed. `ui/server/agents/install.ts` is the one server module
  that may import `child_process`: the server bundle's metafile records importers as
  `spawners`, and `check:package` fails on any other (`SPAWNERS`,
  `ui/scripts/package-rules.mjs`). This replaces the #249 rule that the server imports
  `child_process` nowhere (`AGENT_DECISIONS.md`, #249 UI server, "No browser is
  opened"). Nothing else may grow from it: a second command, package or caller needs
  this entry changed first.
- **The Ask bar is above every dossier page**, rendered by the App inside the
  dossier's data and keyed by dossier, so a conversation lasts across that dossier's
  views and resets on another dossier or a reload. Nothing is stored: the chat is the
  page's state. The docked pane and the narrow-screen sheet are gone, and the
  dashboard is one column.
- **The focused view is a React Aria modal.** Opening on a click (not on focus, which
  would move a keyboard user somewhere they didn't ask to go: WCAG 3.2.1); Enter in
  the bar asks and opens it. Escape and Close dismiss it. Below 640px it is the whole
  screen.
- **Status comes from the tools, not the SDKs' event streams.** The host wraps every
  tool it hands an adapter, so a call reports `{ phase: 'tool', tool, source }` on
  the next partial answer whichever adapter made it (Claude and Copilot in-process,
  Codex over the MCP endpoint); text reports `writing`. A live read names its toil
  command (`github issue list`), a cache read its tool name. The timer and "Done in
  12 s" are the page's own clock. One parser instead of three, and nothing an SDK
  version can rename.
- **Codex streams a message at a time.** The Codex SDK at 0.160.0 emits no text deltas
  (`item.updated` / `item.completed` for whole agent messages), so Codex already ran
  on `runStreamed()` and the status line is what moves between its messages.
- **Every question carries the chat so far**, its last 8 turns with each answer cut
  to 1,500 characters (`withHistory`, prompts.ts), sent by the page as `history`
  and checked by the server (20 turns, 20,000 characters an answer at most). Before,
  each question stood alone, so neither Analyze's follow-ups nor a switched adapter
  could continue. "As a summary" is this shortened transcript, not a model-written
  summary, which would cost a call per switch. Ids from it are still held to the new
  question's tool results.
- **Each adapter has its own model and CLI path** (`models`, `cliPaths` in
  agent.json). `model` and `cliPath` stay the chosen adapter's and are kept in
  step, so a file from before still loads. Without this a chat switched to Claude ran
  Claude Code's default model, never the cheap one a person picked.
- **Starters are offered with no adapter chosen**, since the switcher can choose one
  for the chat.
- **Analyze is not a starter chip**: its own button, the fixed prompt `analyze`
  (prompts.ts). In the sample it is the risk, attention, people and review scripts in
  that order, so every line is one the agent tests already hold to the data.
- **Install's command depends on how Toil UI is installed** (install.ts): global into
  the same prefix with `--omit=optional`; a project's install with `--save-exact`; a
  clone's root with `--no-save`, restating the SDKs already there; npx refused with a
  fix. Toil UI's own folder doesn't work: npm treats the optional peers as satisfied
  ("up to date") and installs nothing, and a saving install rewrites Toil UI's
  package.json (checked by hand with npm 11).
- **zod is installed with Claude's SDK at toil's own pin (4.6.5)**, since the Claude
  adapter builds its tool schemas with it; it is the one package Install names that
  isn't an SDK, and it is already in the peer list.
- **`--before` rather than pins for the SDKs' own dependencies.** The SDKs pin some
  and range others, and Claude's has non-optional peers (`@anthropic-ai/sdk`,
  `@modelcontextprotocol/sdk`) npm would otherwise resolve to their newest. `--before`
  applies the 14-day rule to everything resolved, without Toil UI naming packages it
  doesn't use.
- **Copilot's `copilot.cmd` resolves to its script.** Copilot's SDK (1.0.16,
  `client.js`) runs a `.js` path with `process.execPath`, so `findCli` follows an
  npm shim's `%dp0%\…\x.js` (or the sh twin's `$basedir/…`) for Copilot only,
  never out of the shim's folder. Claude and Codex still refuse a shim, with the fix.
- **An SDK installed while Toil UI runs loads without a restart.** Node remembers a
  bare specifier it failed to resolve for the life of the process, so after Install
  `import('@openai/codex-sdk')` kept failing (seen live, and reproduced with a scoped
  package in a plain `node` script). `ui/server/agents/package-path.ts` walks up
  from Toil UI's folder as Node would, reads the package's `.` export for `import`,
  and imports that file by URL, only after the ordinary import has failed.
- **A successful install doesn't remount the App.** Settings' `onChange` remounts
  it (a new agent brings new starters); an install changes no choice, and the
  remount closed the Install dialog before its result could be read. The chat asks
  for the adapters each time it opens, so its switcher sees a new SDK anyway.
- **Skipped: the site's Toil UI figures.** `site/src/figures/ui-theme-settings.html`,
  `ui-themes.html` and `ui-voice.html` show the docked Ask pane this PR replaces, in
  images under `site/public/images/`. Regenerating site art follows the `site` skill
  and is outside this PR's chat and adapter files (the coordinator's scope for #343
  and #344, with other UI work in flight), so the figures are left for a follow-up.
  Their alt text still describes what those images show.
- **The npm exception isn't named in CLAUDE.md.** No Executables governs toil, the
  published CLI; Toil UI's own rules live in its README and in these decisions, where
  the exception is recorded with its exact command. Whether CLAUDE.md should also
  name it under Layout's `ui/` entry is the maintainer's call, so it is raised in the
  PR rather than written into CLAUDE.md here.
