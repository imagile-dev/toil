---
area: skills
description: Agent skills from git-hosted marketplaces, installed into the folders Codex, GitHub Copilot and Claude Code read, and switched on and off
---

# Skills marketplaces (`skills`)

A skills marketplace is a git repository of plugins, each a folder of agent skills
(`plugins/<plugin>/skills/<skill>/SKILL.md`, optionally listed in
`.claude-plugin/marketplace.json`). toil clones it, copies plugin skills into the
skills folder an agent host reads, and switches plugins on and off without deleting
them. Verification level: `unit`.

**Supported versions:** git 2.24 or later. toil runs the git already on PATH to clone
and pull a marketplace, and nothing else. A private marketplace needs git 2.31 or
later, which takes its token from the environment rather than the command line;
an older git gets `GIT_NOT_FOUND` saying so.

## Where skills go

| `--agent` | Project scope (`--scope project`) | User scope (`--scope user`, the default) |
|-----------|-----------------------------------|------------------------------------------|
| `codex` (the default) | `.agents/skills` | `~/.agents/skills` |
| `github-copilot` | `.github/skills` | `~/.copilot/skills` |
| `claude-code` (`--claude`) | `.claude/skills` | `~/.claude/skills` |

`.agents/skills` is read by Codex and GitHub Copilot alike, which is why it's the
default. Project scope is the root of the repository the workspace is in, or the
workspace outside one. `--all-agents` (on `add` and `sync`) installs for all three.

Each skills folder keeps an index, `.toil-installed.json`, recording which skills toil
installed and from where; each installed skill also gets a `toil-origin.json`. A
switched-off skill moves to `.toil-disabled/` in the same folder, which agent hosts
don't read. toil replaces only skill folders it installed from the same marketplace
and plugin: a folder of the same name it didn't install is left alone, listed in
`failed`, with a `SKILLS_NOT_REPLACED` warning. Symlinks in a marketplace are never
copied.

## Credential and configuration

Each marketplace is a connection of the `skills` area. `toil skills marketplace add`
sets one up from a terminal; in CI, define one with env vars.

| Key | Env var (default connection) | Meaning |
|-----|------------------------------|---------|
| `repoUrl` | `TOIL_SKILLS_REPO_URL` | Clone URL: `https://…`, or a local path. ssh isn't supported |
| `localPath` | `TOIL_SKILLS_LOCAL_PATH` | Where the clone lives (default `~/.agents/marketplaces/<repo-name>`) |
| `branch` | `TOIL_SKILLS_BRANCH` | Branch to clone (default: the remote HEAD) |
| `username` | `TOIL_SKILLS_USERNAME` | User name sent with the token (default `x-access-token` on GitHub, `x-token-auth` elsewhere; Bitbucket Data Center personal tokens usually need your username) |
| `provider` | `TOIL_SKILLS_PROVIDER` | `github`, `bitbucket`, `ado` or `git`, when the URL doesn't say |
| `token` | `TOIL_SKILLS_TOKEN` | HTTP access token for a private marketplace: a secret |
| `writes` | `TOIL_SKILLS_WRITES` | `true` lets `sync`, `enable` and `disable` change skills folders from this marketplace |

A named connection uses `TOIL_CONN_<NAME>_<KEY>` instead (`TOIL_CONN_CORP_SKILLS_TOKEN`).
A whole marketplace from env alone:

```bash
export TOIL_CONN_CORP_SKILLS_AREA=skills
export TOIL_CONN_CORP_SKILLS_REPO_URL=https://bitbucket.imagile.dev/scm/ai/skills.git
export TOIL_CONN_CORP_SKILLS_TOKEN=<token>
export TOIL_CONN_CORP_SKILLS_WRITES=true
toil skills marketplace sync all --marketplace corp-skills --allow-write
```

The token lives in the OS credential store (config holds only a `keychain:`
reference) or an env var, never in the file and never on a command line. Replace it
with `toil connections login <name>`. toil hands it to git for that marketplace's
clone and pull only, as an `http.<url>.extraHeader` in git's environment, which git
sends to that URL and nowhere else. With no token, git uses your own git credentials.

`--marketplace <name>` picks the marketplace by connection name or clone URL;
without it, the area's default (the first one added), else the only one.

## Writes

Installing, refreshing and switching plugins changes files on this machine, so `sync`,
`enable` and `disable` need `"writes": true` on the marketplace and `--allow-write` on
the call. `add` is CLI only, needs `--allow-write` because it clones, and leaves writes
off: adding a marketplace never grants installs from it. Turn them on as for any
connection: `"writes": true` on it in `~/.toil/config.json`, or
`TOIL_CONN_<NAME>_WRITES=true`. `remove` is CLI only.

## From the menu

Bare `toil` on a terminal opens a menu with **Skills** (add, update and remove a
marketplace, turn its writes on, install a plugin for the agent and place you pick)
and **Plugins** (tick what should be on; it shows the changes before running them).
Every screen runs the commands below and prints each one, so the menu writes exactly
what the command would.

## Commands

### `toil skills marketplace add <url> [localPath]`

Registers a marketplace and clones it, with writes off; it installs nothing. CLI only;
`setup` is an alias. On a terminal it asks for an access token (leave it empty for a
public repository) and keeps it in the OS credential store. The first marketplace
becomes the default. Adding it again keeps whatever `writes` you set.

```bash
toil skills marketplace add https://bitbucket.imagile.dev/scm/ai/skills.git --name corp-skills --allow-write
# then set "writes": true on corp-skills in ~/.toil/config.json, and:
toil skills marketplace sync all --marketplace corp-skills --claude --scope project --allow-write
```

| Flag | Meaning |
|------|---------|
| `--name <name>` | Its connection name (default: from the URL) |
| `--branch <branch>` | Branch to clone |
| `--username <username>` | User name sent with the token |
| `--provider <provider>` | `github`, `bitbucket`, `ado` or `git` |

Output: `{ name, repoUrl, localPath, branch, tokenConfigured, tokenStorage, provider,
writes, cloned, available: [{ name, description }], total, next }`, `next` saying how
to turn writes on and install.

### `toil skills marketplace list`

Every registered marketplace: `{ marketplaces: [{ name, repoUrl, localPath,
tokenConfigured, tokenStorage, provider, username, upstreamRemote, writes }], total }`.
`tokenStorage` is `keychain`, `env` or `null`; the token itself is never shown. MCP
tool: `skills_marketplace_list`.

### `toil skills marketplace plugins <name>`

The plugins a marketplace offers, from its clone: `{ marketplace, plugins: [{ name,
description }], total }`. MCP tool: `skills_marketplace_plugins`.

### `toil skills marketplace sync [plugin]`

Clones the marketplace if it isn't yet, otherwise pulls it (fast-forward only), then
installs: one plugin by name, every plugin with `all`, or with no plugin the ones
already installed in the target folder. A switched-off plugin stays off; its stashed
copy is refreshed. MCP tool: `skills_marketplace_sync`.

```bash
toil skills marketplace sync review --allow-write
toil skills marketplace sync all --marketplace corp-skills --claude --scope project --allow-write
```

| Flag | Meaning |
|------|---------|
| `--marketplace <name>` | Which marketplace |
| `--agent <agent>`, `--claude`, `--all-agents` | Which agent hosts |
| `--scope <scope>` | `user` (default) or `project` |
| `--installed-only` | With `all`, skip plugins not installed yet |

Output: `{ marketplace, plugins: { <plugin>: { installed, failed } }, total, target,
marketplaceUpdated }`; for one plugin `{ marketplace, plugin, installed, failed, total,
target, marketplaceUpdated }`; for several agents `targets`.

### `toil skills marketplace disable <plugin>`

Switches a plugin off in one skills folder: its skills move to `.toil-disabled/` and
their records to `disabled` in `.toil-installed.json`. Nothing else in the index
changes. MCP tool: `skills_marketplace_disable`.

```bash
toil skills marketplace disable review --claude --allow-write
```

Output: `{ disabled, alreadyDisabled, skipped, total, target, plugin, stash,
marketplace }`.

### `toil skills marketplace enable <plugin>`

Switches a plugin back on. A skill whose stashed copy has gone is listed in
`stashMissing`, with a `warning`; `sync <plugin>` restores it. MCP tool:
`skills_marketplace_enable`.

Output: `{ enabled, skipped, total, target, plugin, marketplace }`.

`enable` and `disable` take `--marketplace`, `--agent`, `--claude` and `--scope`.

### `toil skills marketplace remove <name>`

Unregisters a marketplace and deletes its token from the OS credential store. Its
clone and the skills installed from it stay on disk. CLI only.

Output: `{ removed: { name, repoUrl, localPath }, keychainEntryDeleted, remaining }`.

### `toil skills status`

Every skill in every agent skills folder, at both scopes: `{ skills: [{ skill, path,
agent, scope, location, enabled, source, plugin, marketplace, repoUrl, localPath,
upstreamRemote, branch, installedAt, toilVersion, stale }], total, enabled, disabled,
untracked, stale, toilVersion, byMarketplace, locations }`. `source` is `marketplace`,
`bundled` or `untracked` (a skill toil didn't install). Filter with `--marketplace`,
`--plugin`, `--source`, `--agent` and `--scope`. MCP tool: `skills_status`.

## Not built yet

`skills install` (toil's own skill, with #58), `skills list`, `uninstall`,
`locations`, `guide`, `purge-user`, `marketplace update` (use `toil connections login`
for a token), `marketplace instructions`, `marketplace purge-plugin` and
`marketplace manage` (the welcome menu replaces it). `skills git-auth` is not coming:
toil gives git a marketplace's token per call instead of changing your git config.
