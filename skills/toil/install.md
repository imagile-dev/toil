# Installing toil

Check first: if `toil version` prints an envelope with `"ok": true`, toil is installed
and nothing here is needed. If `toil` isn't found but a clone of the toil repository is
on the machine, `node <clone>/dist/toil.js version` is the same thing.

toil needs **Node.js 24.14 or later** (`node --version`) and nothing else: no
executable, no native module, no install script and no admin rights. On an older Node
every command returns `UNSUPPORTED_NODE`. Windows, macOS and Linux all work the same.

## From npm (recommended)

```bash
npm install -g @imagile-dev/toil
toil version
```

With no global install, `npx -y @imagile-dev/toil version` runs it on demand. Each
GitHub release also carries the packed `.tgz` for offline or mirrored installs:
`npm install -g ./imagile-dev-toil-<version>.tgz`.

**toil is not on npm yet.** Until its first release, these fail with a 404; install
from a clone instead.

## From a clone, with no npm install

For a machine that can reach the git host but not the npm registry. Needs Node and
git.

```bash
git clone https://github.com/imagile-dev/toil.git
node toil/dist/toil.js version
```

`dist/toil.js` is committed, and it is the **last released toil**: each release rebuilds
it, and nothing else changes it, so it is the same file that release ships on npm.
Newer commits on `main` are in a clone's source but not in its bundle until the next
release; before the first release, it is the bundle committed with this skill. It
imports only Node's built-ins, so there is nothing to install.
To type `toil` instead of `node <clone>/dist/toil.js`, add an alias to the shell
profile, once:

| Shell | Run | Edits |
|-------|-----|-------|
| bash, zsh | `node toil/dist/toil.js setup alias` | `~/.bashrc` or `~/.zshrc`, by `SHELL` (`--shell bash` or `--shell zsh` to choose) |
| PowerShell | `node toil/dist/toil.js setup alias --profile $PROFILE` | The profile of the PowerShell you ran it in |

Then open a new terminal and run `toil version`. `--profile <file>` names any other
profile (macOS bash login shells read `~/.bash_profile`). The alias is a shell
function between two marker lines; nothing else in the file changes, and running it
again updates it in place. `node toil/dist/toil.js setup remove-alias`, with the same
flags, takes it out.

- **An agent's shell may not read the profile.** When `toil` isn't found there, run
  `node <clone>/dist/toil.js` with the same arguments; it's the same command.
- **Windows PowerShell's default execution policy runs no profile.** If `toil` isn't
  found after opening a new PowerShell, call `node <clone>/dist/toil.js` directly.
- **Update** with `git -C toil pull`, which brings the newest release. There is
  nothing to rebuild.

## Installing this skill

The skill is the `skills/toil` folder of the repository, in the Agent Skills format, so
any skill manager can install it:

- **Claude Code**, from the plugin marketplace in the repository:
  `claude plugin marketplace add imagile-dev/toil`, then
  `claude plugin install toil@toil` (or `/plugin marketplace add imagile-dev/toil` and
  `/plugin install toil@toil` in a session). From a clone, pass its path instead of
  `imagile-dev/toil`.
- **Codex, GitHub Copilot and other agents that read `.agents/skills`**: copy the folder
  to `.agents/skills/toil` in a repository.
- **Claude Code without a marketplace**: copy it to `.claude/skills/toil` in a
  repository, or `~/.claude/skills/toil` for every project.
- **Any installer that reads `skills/<name>/SKILL.md` from a git repository**: point it
  at `https://github.com/imagile-dev/toil`.

## Next

Connect toil to a tool: each area's file (`jira.md`, `db.md`, …) gives its credential,
its env vars and its config. To run toil as an MCP server, see `mcp.md`.
