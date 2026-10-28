# Agent-led setup (#516)

- **The maintainer's decisions (2026-10-28, on #516), implemented as given.**
  1. An agent may set up connections: on the person's approval, it creates one with
     its non-secret settings. Only a person enters a secret, in their own terminal
     (`toil connections login`) or in Toil UI's Settings. The agent never sees, types,
     pastes, stores or moves one, and `writes` stays off unless the person turns it
     on. Principle 2, the `cli-only` paragraph, `docs/bounds.md` (`commands.cli-only`)
     and the `secrets` skill say so.
  2. The skill may mention and suggest Toil UI. `setup.md` asks the Toil UI question
     first, and the rest follows from the answer.
- **Flag shape: one repeatable `--set <key>=<value>`, not a flag per setting.**
  `connections add` had `--area` and prompts only, and areas differ in their keys
  (`baseUrl`, `deployment`, `email`, `project`), so a flag per key would be a new
  flag set for every area (principle 10 wants one idea, one flag). `--set` is the
  flag `dossiers link` already uses for the same kind of key=value setting, and an
  array field's flag is already repeatable. The issue's example `--base-url` is
  therefore `--set baseUrl=…`.
- **`--set` is a mode, not an add-on.** With it, `add` asks nothing (no area, no
  settings, no confirmation, no secret), needs `--area`, and works on a non-TTY.
  The person's yes is the one given in chat, which the skill requires before the
  call. A prompted flow that also took flags would have to decide which answers to
  skip, and an agent's shell is not a terminal anyway.
- **A secret key in `--set` is refused (`INVALID_INPUT`), by the area's declared
  `secrets`, not by looking at the value.** Nothing is saved and the value is not
  echoed. The result lists `secretNeeded` and a `SECRET_NEEDED` warning names
  `toil connections login <name>`, so the hand-off is in the envelope as well as
  the skill.
- **The rest of the connection is validated at `add`, with stand-in strings for the
  secrets that are never stored.** A bad URL is reported when the connection is made,
  not at the first read. Writes are not set, so they stay off, and the first
  connection to an area becomes its default, as in the prompted flow.
- **No new MCP tool.** `add` stays `cli-only`: an agent reaches it through its shell,
  and `execute()` over MCP and `./api` refuse it as before.
- **Home page and Install page lead with the agent path.** The home page gets one
  card above the two manual installs, with the prompt as copyable text; the copy
  button appears only where the clipboard exists. The "You work with an agent" path
  ends at the setup page in place of "Connect MCP", which stays under Agents. The
  Install page is `install.md`, so its first section is the agent path. The manual
  installs stay visible, below.
- **Toil UI README sample output is version-agnostic** (`<version>`), so it does not
  go stale on each beta.
- **`setup.md` has no jokes and no dossier-creation detail of its own**: it points at
  `dossiers.md`, **Create**, and `toil dossiers onboard --plan` (which adds no
  connection) so the dossier commands have one place to be documented.
