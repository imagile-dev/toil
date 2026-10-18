---
description: Installing toil from npm or from a clone with no npm install, the toil alias for a clone, and installing this skill for Codex, GitHub Copilot or Claude Code
---

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
release. **Until the first release, the committed bundle is the one built when the
skill and the clone path were added to `main`; after that, it is always the last
release.** It imports only Node's built-ins, so there is nothing to install.

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

toil carries this skill inside itself, so the copy it installs always matches the
toil that runs it. Install it once, for the agent you use:

```bash
toil skill install --allow-write
toil skill install --agent github-copilot --scope project --allow-write
toil skill install --claude --allow-write
```

| `--agent` | `--scope user` (the default) | `--scope project` |
|-----------|------------------------------|-------------------|
| `codex` (the default; GitHub Copilot reads it too) | `~/.agents/skills/toil` | `.agents/skills/toil` |
| `github-copilot` | `~/.copilot/skills/toil` | `.github/skills/toil` |
| `claude-code` (`--claude`) | `~/.claude/skills/toil` | `.claude/skills/toil` |

Project scope is the root of the repository you're in. Installing writes files
outside the workspace, so it's CLI only and needs `--allow-write`. Every reference
file is installed, so an area you set up later is already documented.

**There is nothing to update by hand.** The description in the installed `SKILL.md`
names the areas and database engines you have connections for (names only, never a
host or a credential), so an agent reaches for toil when a task touches one of them.
toil rewrites every copy it installed when a connection is added, changed or
removed, and when a toil of another version runs, and says so in `meta.warnings`
(`SKILL_REWRITTEN`); a rewrite that fails is a `SKILL_REWRITE_FAILED` warning, never
a failed command. Connections that only `TOIL_*` env vars define are named when
they're set in the process that writes the skill, and the output says which. With no
connections, the description is the general one.

`toil skill show` (`skill_show` over MCP) prints the description toil would write now
and every installed copy, with its version and whether it's current.

toil only ever rewrites a `toil` folder it installed itself. One copied by hand, or
installed by a marketplace, is left exactly as it is, and `toil skill install` refuses
to replace it: move it aside first.

Other ways in, for agents toil doesn't write to:

- **Claude Code**, from the plugin marketplace in the repository:
  `claude plugin marketplace add imagile-dev/toil`, then
  `claude plugin install toil@toil` (or `/plugin marketplace add imagile-dev/toil` and
  `/plugin install toil@toil` in a session). From a clone, pass its path instead of
  `imagile-dev/toil`. This copy carries the general description, and toil doesn't
  keep it current.
- **Any installer that reads `skills/<name>/SKILL.md` from a git repository**: point it
  at `https://github.com/imagile-dev/toil`.

## Next

Connect toil to a tool: each area's file (`jira.md`, `db.md`, …) gives its credential,
its env vars and its config. To run toil as an MCP server, see `mcp.md`.
