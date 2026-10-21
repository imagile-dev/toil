# Onboarding to a repo's dossiers, host matching, and shareable dossiers (#333)

- **`init --shared` creates the dossier in a repository.** `init` records no
  bindings of its own, so "records `host`" is read as: `--shared` writes
  `<repo>/.toil/dossiers/<name>.json` (`--repo`, else the folder's own repository),
  and every `--connection` later linked into that file records the connection's host.
  No `"shared"` key was added to the dossier schema: where the file lives already says
  who reads it.
- **A dossier "others read" is any one whose source isn't `user`** (checked in,
  listed, or a loose file). `link`/`env --connection` on one records the host after
  a y/n on a terminal; with no terminal (a pipe, MCP, the API) it records the host and
  warns `DOSSIER_HOST_RECORDED`, since there's no one to ask and shareable is the
  default. A connection with no host to record keeps its name, with a warning.
- **`siteApis` on `defineArea`** maps a host people know to the base URL its API is
  on: GitHub's `github.com` to `https://api.github.com` and Bitbucket Cloud's
  `bitbucket.org` to `https://api.bitbucket.org/2.0`. Without it a dossier's
  `host: github.com`, which the issue names, would match no GitHub connection. It is
  matched only for a selector with no port, used for the base URL `onboard` offers,
  and used in reverse when sharing, so `export` and `link` record `github.com`.
- **`dossiers onboard` is `cli-only` and a person's command** (`PERSON_COMMANDS`), so
  Toil UI can run it with a `person`, as it runs `connections add`. With no prompter,
  or `--plan`, it adds nothing and reports each area's need with a `fix` and a
  `suggest`; `--pin` still applies under `--plan`, which is how Toil UI pins.
  `writesLocal` is decided by input (`writesLocalWhen`): a plan with no pin writes
  nothing.
- **Pinning writes the reader's own copy.** When several connections match, the one
  picked is written as `connection` into `~/.toil/dossiers/<name>.json`: the dossier
  itself if it's already theirs, their copy of that name if they have one, else a new
  copy. That copy is adopted (writes may follow it), which a warning says; outside the
  CLI one that selects a connection with writes on is refused, as `import` refuses it.
- **The test read is `connections test`'s probe**, once per distinct connection, on
  the config reloaded after any connection was added. `connections add` and `test`
  were extracted into `addConnection` and `testConnection` so onboarding runs the same
  flow rather than a copy. A base URL that isn't on the section's host is refused
  before anything is saved.
- **`dossiers check` warns `DOSSIER_CONNECTION_SHARED`** only when the named
  connection exists (so the host can be shown); an unknown one is already the
  `DOSSIER_UNKNOWN_CONNECTION` error.
- **Toil UI's step is its own file**, `ui/src/views/settings/RepoSetup.tsx`, rendered
  at the top of Settings → Dossiers, so the dossier pages work in flight (#342) keeps
  `DossierSetup.tsx` to one added line. It runs the plan, adds a missing connection
  with `connections add` (the form extracted from Connections as `NewConnectionForm`,
  filled from `suggest`), pins with `--pin`, and runs the plan again after each. The
  preview answers the plan, which changes nothing, like a read.
- **The welcome menu** has Set up this repo on the Dossiers screen when the folder is a
  repository, and on This folder when a dossier applies; both run `dossiers onboard`
  on the terminal.
- **`--pin` takes an area or one section's key path** (`environments.prod.github`),
  and the path wins over its area's. Asked for in review: a dossier with both an area
  section and an environment's section for the same area could otherwise pin only one
  connection for both.
