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
- **`--set` refuses a pairing key (`<key>From`, such as `tokenFrom`) as it does a
  secret.** A pairing points a connection at another connection's credential, which
  moves a secret and could send it to a host the agent chose (principle 9). The person
  adds it themselves. Review round 1 on the PR found it.
- **The agent path leads the hero**, in place of the npm command and the Get started
  button, with the two manual installs one link away (`#start-npm`, `#start-clone`)
  rather than competing for the first screen. Each word of a command is an unbreakable
  piece, so a flag never splits across lines, and the prompt block wraps.
- **Examples use `jira.imagile.dev`** for Jira, since Atlassian answers for every
  subdomain. `test/repo-hygiene.test.ts` reads only tracked files, so it missed the
  new file until it was added; its pattern is unchanged and now has a test of its own.
- **`secretNeeded` lists only the secrets this connection cannot work without** (review
  round 2). Each secret is tested against the area's schema, variants included, with
  the other secrets present: a database password is optional in the schema (trust
  auth exists), so postgres lists none and sqlite lists none, and the warning is
  skipped when the list is empty. This is the simplest accurate rule: toil cannot
  tell that Teradata alone uses `token`, so it says nothing about optional secrets
  rather than guess, and `setup.md` says a sign-in that fails needs one.
- **A secret already supplied by env is not "needed".** For a connection that is or
  becomes the area's default, `TOIL_<AREA>_<KEY>` or a CI fallback such as
  `GITHUB_TOKEN`; for any connection, `TOIL_CONN_<NAME>_<KEY>`. Presence is checked,
  never the value. The result's `secretFromEnv` names the variable, so a person sees
  why nothing is asked of them.
- **`connections add --set` asks the real resolver what is still missing** (review
  round 3), on the config as the next call will load it (`reloadConfig`, shared with
  `dossiers onboard`). A mirror of the loader's rules (CI fallbacks and their
  `fallbackWhen`, `TOIL_CONN_*`, `TOIL_<AREA>_*`, renamed keys, area defaults, `<key>From`
  pairings, the shared-env chain) had already drifted once, so there is no mirror: the
  resolver's answer is the answer, and `secretFromEnv` names the variable the loader
  recorded as the source (names only). If the config can't be loaded, every required
  secret is reported as needed.
